/**
 * Sync Engine Service
 *
 * Core synchronization engine for Nuvana that manages:
 * - Periodic sync cycles on configurable intervals
 * - Queue processing with batching by entity type
 * - Exponential backoff for failed items
 * - Online/offline detection
 * - Status broadcasting to renderer
 *
 * @module main/services/sync-engine
 * @security API-004: Authentication validation before sync
 * @security API-002: Rate limiting via configurable intervals and backoff
 * @security API-003: Centralized error handling with sanitized responses
 * @security DB-006: Store-scoped operations for tenant isolation
 */

import { BrowserWindow } from 'electron';
import {
  syncQueueDAL,
  type SyncQueueItem,
  type SyncApiContext,
  type ErrorCategory,
  type DeadLetterReason,
} from '../dal/sync-queue.dal';
import { classifyError } from './error-classifier.service';
import { syncLogDAL } from '../dal/sync-log.dal';
import { storesDAL } from '../dal/stores.dal';
import { lotteryGamesDAL } from '../dal/lottery-games.dal';
import { lotteryBusinessDaysDAL } from '../dal/lottery-business-days.dal';
import { usersDAL } from '../dal/users.dal';
import { createLogger } from '../utils/logger';
import { cloudApiService, CloudApiError } from './cloud-api.service';
import {
  bidirectionalSyncService,
  type BidirectionalSyncResult,
} from './bidirectional-sync.service';
import type { DepletionReason, ReturnReason } from '../../shared/types/lottery.types';

// ============================================================================
// Types
// ============================================================================

/**
 * Sync progress for real-time UI feedback
 */
export interface SyncProgress {
  /** Total items to sync in current batch */
  totalItems: number;
  /** Number of items completed (success + failed) */
  completedItems: number;
  /** Number of items successfully synced */
  succeededItems: number;
  /** Number of items that failed */
  failedItems: number;
  /** Current entity type being synced */
  currentEntityType: string | null;
  /** Recent errors (last 5) for display */
  recentErrors: Array<{ entityType: string; error: string; timestamp: string }>;
}

/**
 * Sync status for UI display
 * SEC-017: No sensitive data (API keys, tokens) in status response
 * API-008: Only whitelisted, non-sensitive fields exposed
 */
export interface SyncStatus {
  /** Whether sync is currently running */
  isRunning: boolean;
  /** Whether sync engine is started */
  isStarted: boolean;
  /** Timestamp of last sync attempt */
  lastSyncAt: string | null;
  /** Status of last sync (success/partial/failed/null) */
  lastSyncStatus: 'success' | 'partial' | 'failed' | null;
  /** Total number of pending items (queued + failed) - for backward compatibility */
  pendingCount: number;
  /** Number of queued items still retryable (sync_attempts < max_attempts) */
  queuedCount: number;
  /** Number of items successfully synced today */
  syncedTodayCount: number;
  /** Number of permanently failed items (exceeded max retry attempts) */
  failedCount: number;
  /** Number of items currently in exponential backoff (waiting for retry delay) */
  backoffCount: number;
  /** Number of items ready to sync right now (not in backoff, not failed) */
  retryableNowCount: number;
  /** Milliseconds until next scheduled sync */
  nextSyncIn: number;
  /** Whether cloud API is reachable */
  isOnline: boolean;
  /** Timestamp of last heartbeat (Phase 5) */
  lastHeartbeatAt: string | null;
  /** Status of last heartbeat (Phase 5) */
  lastHeartbeatStatus: 'ok' | 'suspended' | 'revoked' | 'failed' | null;
  /** Last known server time from heartbeat (Phase 5) */
  lastServerTime: string | null;
  /** Milliseconds until next scheduled heartbeat (Phase 5) */
  nextHeartbeatIn: number;
  /** Consecutive sync failures (for UI degradation display) */
  consecutiveFailures: number;
  /** Sanitized last error message (API-003: no internal details) */
  lastErrorMessage: string | null;
  /** Timestamp of last error */
  lastErrorAt: string | null;
  /** Current sync progress (when isRunning is true) */
  progress: SyncProgress | null;
  /** Number of items in the Dead Letter Queue (MQ-002) */
  deadLetterCount: number;
}

/**
 * Sync result statistics
 */
export interface SyncResult {
  sent: number;
  succeeded: number;
  failed: number;
}

/**
 * Batch result from cloud API with API context for troubleshooting
 * v040: Added apiContext for Sync Monitor display
 */
export interface BatchSyncResponse {
  success: boolean;
  results: Array<{
    id: string;
    cloudId?: string;
    status: 'synced' | 'failed';
    error?: string;
    /** API call context for troubleshooting (v040) */
    apiContext?: SyncApiContext;
  }>;
}

/**
 * Heartbeat response from cloud API
 * LM-002: Includes serverTime for monitoring/clock sync
 */
export interface HeartbeatResponse {
  status: 'ok' | 'suspended' | 'revoked';
  serverTime: string;
}

/**
 * Cloud API service interface (to be implemented in Phase 5B)
 */
interface ICloudApiService {
  healthCheck(): Promise<boolean>;
  heartbeat(): Promise<HeartbeatResponse>;
}

// ============================================================================
// Constants
// ============================================================================

/** Default sync interval in milliseconds (60 seconds) */
const DEFAULT_SYNC_INTERVAL_MS = 60 * 1000;

/** Minimum sync interval (10 seconds) */
const MIN_SYNC_INTERVAL_MS = 10 * 1000;

/** Maximum sync interval (5 minutes) */
const MAX_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** Batch size for sync operations */
const SYNC_BATCH_SIZE = 100;

/** Health check timeout in milliseconds */
const HEALTH_CHECK_TIMEOUT_MS = 5000;

/** Default heartbeat interval in milliseconds (5 minutes) */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

/** Minimum heartbeat interval (1 minute) */
const MIN_HEARTBEAT_INTERVAL_MS = 60 * 1000;

/** Maximum heartbeat interval (15 minutes) */
const MAX_HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;

/** Heartbeat timeout in milliseconds */
const HEARTBEAT_TIMEOUT_MS = 10000;

/** IPC channel for status updates */
const SYNC_STATUS_CHANNEL = 'sync:statusChanged';

/**
 * Default reference data sync interval in milliseconds (5 minutes)
 * Reference data (games, bins) changes infrequently, so sync less often than push queue
 * API-002: Rate limiting - avoid excessive API calls for reference data
 */
const DEFAULT_REFERENCE_DATA_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Minimum reference data sync interval (1 minute)
 * Prevents excessive polling even if misconfigured
 */
const MIN_REFERENCE_DATA_SYNC_INTERVAL_MS = 60 * 1000;

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('sync-engine');

// ============================================================================
// Sync Engine Service
// ============================================================================

/**
 * Sync Engine Service
 *
 * Manages synchronization between local database and cloud API.
 * Implements reliable outbound sync with:
 * - Automatic retries with exponential backoff
 * - Batched processing by entity type
 * - Online/offline detection
 * - Real-time status updates to UI
 */
export class SyncEngineService {
  private intervalId: NodeJS.Timeout | null = null;
  private heartbeatIntervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private syncIntervalMs = DEFAULT_SYNC_INTERVAL_MS;
  private heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS;

  private lastSyncAt: Date | null = null;
  private lastSyncStatus: 'success' | 'partial' | 'failed' | null = null;
  private lastHeartbeatAt: Date | null = null;
  private lastHeartbeatStatus: 'ok' | 'suspended' | 'revoked' | 'failed' | null = null;
  private lastServerTime: string | null = null;
  private pendingCount = 0;
  private isOnline = true;
  private consecutiveFailures = 0;
  private lastErrorMessage: string | null = null;
  private lastErrorAt: Date | null = null;

  /** Current sync progress tracking */
  private currentProgress: SyncProgress | null = null;
  /** Recent sync errors for display (capped at 5) */
  private recentSyncErrors: Array<{ entityType: string; error: string; timestamp: string }> = [];

  /**
   * Reference data sync state tracking
   * Tracks when games/bins were last synced from cloud to local
   * API-002: Rate limiting - separate interval from push queue sync
   */
  private lastReferenceDataSyncAt: Date | null = null;
  private referenceDataSyncIntervalMs = DEFAULT_REFERENCE_DATA_SYNC_INTERVAL_MS;
  private isReferenceDataSyncing = false;

  /** Cloud API service (injected for testability) */
  private cloudApiService: ICloudApiService | null = null;

  /**
   * Set the cloud API service
   * Called during initialization once the cloud API service is ready
   *
   * @param service - Cloud API service instance
   */
  setCloudApiService(service: ICloudApiService): void {
    this.cloudApiService = service;
    log.info('Cloud API service configured');
  }

  /**
   * Start the sync engine
   * API-002: Configurable interval with bounds checking
   *
   * @param intervalMs - Optional custom sync interval
   */
  start(
    intervalMs?: number,
    heartbeatIntervalMs?: number,
    referenceDataSyncIntervalMs?: number
  ): void {
    if (this.intervalId) {
      log.warn('Sync engine already running');
      return;
    }

    // Validate and set sync interval
    if (intervalMs) {
      this.syncIntervalMs = Math.max(
        MIN_SYNC_INTERVAL_MS,
        Math.min(intervalMs, MAX_SYNC_INTERVAL_MS)
      );
    }

    // Validate and set heartbeat interval (Phase 5)
    if (heartbeatIntervalMs) {
      this.heartbeatIntervalMs = Math.max(
        MIN_HEARTBEAT_INTERVAL_MS,
        Math.min(heartbeatIntervalMs, MAX_HEARTBEAT_INTERVAL_MS)
      );
    }

    // Validate and set reference data sync interval
    // API-002: Rate limiting - enforce minimum interval to prevent API abuse
    if (referenceDataSyncIntervalMs) {
      this.referenceDataSyncIntervalMs = Math.max(
        MIN_REFERENCE_DATA_SYNC_INTERVAL_MS,
        referenceDataSyncIntervalMs
      );
    }

    log.info('Starting sync engine', {
      syncIntervalSec: this.syncIntervalMs / 1000,
      heartbeatIntervalSec: this.heartbeatIntervalMs / 1000,
      referenceDataSyncIntervalSec: this.referenceDataSyncIntervalMs / 1000,
    });

    // Clean up any stale running syncs from previous session
    this.cleanupStaleRunning();

    // Clean up stale PULL tracking items that accumulated from previous sessions
    // These are tracking-only items that will never be retried (PULL creates new items each time)
    this.cleanupStalePullTrackingAtStartup();

    // Update pending count
    this.updatePendingCount();

    // Log queue diagnostic info at startup
    this.logQueueDiagnostics();

    // Run sync immediately, then on interval
    this.runSync().catch((err) => {
      log.error('Initial sync failed', { error: err instanceof Error ? err.message : 'Unknown' });
    });

    this.intervalId = setInterval(() => {
      this.runSync().catch((err) => {
        log.error('Scheduled sync failed', {
          error: err instanceof Error ? err.message : 'Unknown',
        });
      });
    }, this.syncIntervalMs);

    // Start heartbeat interval
    this.startHeartbeat();

    this.notifyStatusChange();
  }

  /**
   * Stop the sync engine
   */
  stop(): void {
    let stopped = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      stopped = true;
    }

    // Phase 5: Stop heartbeat interval
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
      stopped = true;
    }

    if (stopped) {
      log.info('Sync engine stopped');
      this.notifyStatusChange();
    }
  }

  /**
   * Trigger an immediate sync (manual trigger)
   * Returns immediately if sync already in progress
   */
  async triggerSync(): Promise<void> {
    if (this.isRunning) {
      log.info('Sync already in progress, skipping manual trigger');
      return;
    }
    await this.runSync();
  }

  /**
   * Trigger an immediate reference data sync (manual trigger)
   *
   * Forces immediate sync of reference data (games, bins) from cloud,
   * bypassing the normal interval check. Useful when:
   * - User knows cloud data has changed
   * - Troubleshooting sync issues
   * - Initial data refresh after reconnection
   *
   * @security API-003: Errors are logged and returned, not thrown
   * @security LM-001: Structured logging with operation metrics
   *
   * @returns BidirectionalSyncResult with sync metrics, or null if sync was skipped
   */
  async triggerReferenceDataSync(): Promise<BidirectionalSyncResult | null> {
    if (this.isReferenceDataSyncing) {
      log.info('Reference data sync already in progress, skipping manual trigger');
      return null;
    }

    if (!this.isOnline) {
      log.info('Reference data sync skipped: offline');
      return null;
    }

    const store = storesDAL.getConfiguredStore();
    if (!store) {
      log.warn('Reference data sync skipped: store not configured');
      return null;
    }

    log.info('Manual reference data sync triggered');

    this.isReferenceDataSyncing = true;
    const startTime = Date.now();

    try {
      const result = await this.syncGamesFromCloud();

      // Update last sync timestamp
      this.lastReferenceDataSyncAt = new Date();

      const elapsedMs = Date.now() - startTime;
      log.info('Manual reference data sync completed', {
        elapsedMs,
        pulled: result.pulled,
        conflicts: result.conflicts,
        errors: result.errors.length,
      });

      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const elapsedMs = Date.now() - startTime;

      log.error('Manual reference data sync failed', {
        elapsedMs,
        error: errorMessage,
      });

      // Return error result instead of throwing
      // API-003: Centralized error handling - don't propagate internal errors
      return {
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        errors: [this.sanitizeErrorMessage(errorMessage)],
      };
    } finally {
      this.isReferenceDataSyncing = false;
    }
  }

  /**
   * Get current sync status for UI display
   * SEC-017: No sensitive data in status response
   * API-008: OUTPUT_FILTERING - Only whitelisted fields exposed
   *
   * @returns Current sync status
   */
  getStatus(): SyncStatus {
    const nextSyncIn =
      this.intervalId && this.lastSyncAt
        ? Math.max(0, this.syncIntervalMs - (Date.now() - this.lastSyncAt.getTime()))
        : 0;

    // Phase 5: Calculate next heartbeat time
    const nextHeartbeatIn =
      this.heartbeatIntervalId && this.lastHeartbeatAt
        ? Math.max(0, this.heartbeatIntervalMs - (Date.now() - this.lastHeartbeatAt.getTime()))
        : 0;

    // SEC-006: Get sync queue stats via parameterized DAL query
    // DB-006: TENANT_ISOLATION - Query is scoped to current store
    // API-008: OUTPUT_FILTERING - Returns accurate, mutually exclusive counts
    let syncedTodayCount = 0;
    let failedCount = 0;
    let queuedCount = 0;
    let backoffCount = 0;
    let retryableNowCount = 0;
    let deadLetterCount = 0;
    const store = storesDAL.getConfiguredStore();
    if (store) {
      const stats = syncQueueDAL.getStats(store.store_id);
      syncedTodayCount = stats.syncedToday;
      failedCount = stats.failed;
      queuedCount = stats.queued;
      // Get backoff visibility - shows how many items are waiting for retry delay
      backoffCount = syncQueueDAL.getBackoffCount(store.store_id);
      // Retryable now = queued items minus those in backoff
      retryableNowCount = Math.max(0, queuedCount - backoffCount);
      // MQ-002: Get Dead Letter Queue count for monitoring
      deadLetterCount = syncQueueDAL.getDeadLetterCount(store.store_id);
    }

    return {
      isRunning: this.isRunning,
      isStarted: this.intervalId !== null,
      lastSyncAt: this.lastSyncAt?.toISOString() || null,
      lastSyncStatus: this.lastSyncStatus,
      pendingCount: this.pendingCount,
      queuedCount,
      syncedTodayCount,
      failedCount,
      backoffCount,
      retryableNowCount,
      nextSyncIn,
      isOnline: this.isOnline,
      // Phase 5: Heartbeat status
      lastHeartbeatAt: this.lastHeartbeatAt?.toISOString() || null,
      lastHeartbeatStatus: this.lastHeartbeatStatus,
      lastServerTime: this.lastServerTime,
      nextHeartbeatIn,
      // Extended status for UI indicator
      consecutiveFailures: this.consecutiveFailures,
      lastErrorMessage: this.lastErrorMessage,
      lastErrorAt: this.lastErrorAt?.toISOString() || null,
      // Real-time sync progress
      progress: this.currentProgress,
      // MQ-002: Dead Letter Queue count for monitoring
      deadLetterCount,
    };
  }

  /**
   * Check if sync engine is currently running a sync
   */
  isSyncing(): boolean {
    return this.isRunning;
  }

  /**
   * Check if sync engine is started
   */
  isStarted(): boolean {
    return this.intervalId !== null;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Run a sync cycle
   * Processes push queue and pulls reference data from cloud
   *
   * Enterprise-grade sync cycle:
   * 1. Process push queue (local → cloud)
   * 2. Pull reference data (cloud → local) at configured interval
   *
   * @security API-002: Rate limiting via separate intervals for push/pull
   * @security API-003: Centralized error handling with sanitized responses
   * @security DB-006: Store-scoped operations for tenant isolation
   */
  private async runSync(): Promise<void> {
    if (this.isRunning) {
      log.debug('Sync cycle skipped: already running');
      return;
    }

    const store = storesDAL.getConfiguredStore();
    if (!store) {
      log.warn('Sync skipped: Store not configured');
      return;
    }

    this.isRunning = true;
    this.notifyStatusChange();

    // Check online status
    const online = await this.checkOnline();
    this.isOnline = online;

    if (!online) {
      log.debug('Sync skipped: Offline');
      this.isRunning = false;
      this.notifyStatusChange();
      return;
    }

    // Start sync log entry
    const syncLogId = syncLogDAL.startSync(store.store_id, 'PUSH');

    try {
      const result = await this.processSyncQueue(store.store_id);

      // Complete sync log
      syncLogDAL.completeSync(syncLogId, {
        records_sent: result.sent,
        records_succeeded: result.succeeded,
        records_failed: result.failed,
      });

      // Update status
      this.lastSyncAt = new Date();
      this.lastSyncStatus = result.failed === 0 ? 'success' : 'partial';
      this.updatePendingCount();

      // Reset consecutive failures on success
      if (result.failed === 0) {
        this.consecutiveFailures = 0;
        this.lastErrorMessage = null;
        this.lastErrorAt = null;
      } else {
        // Partial success - distinguish between batch failures and permanent failures
        // API-008: OUTPUT_FILTERING - Provide accurate, actionable error message
        // SEC-006: Query uses parameterized store_id from authenticated context
        const permanentFailures = syncQueueDAL.getFailedCount(store.store_id);
        const retriableFailures = result.failed;

        if (permanentFailures > 0) {
          // Items that exceeded max retries - require manual intervention
          this.lastErrorMessage = `${permanentFailures} item(s) exceeded retry limit`;
        } else {
          // Items failed but will be retried automatically
          this.lastErrorMessage = `${retriableFailures} item(s) failed, will retry automatically`;
        }
        this.lastErrorAt = new Date();
      }

      log.info(`Sync completed: ${result.succeeded}/${result.sent} succeeded`, {
        storeId: store.store_id,
        sent: result.sent,
        succeeded: result.succeeded,
        failed: result.failed,
      });

      // Pull reference data from cloud (games, bins) at configured interval
      // API-002: Rate limiting - separate interval from push queue
      // Runs independently of push success to ensure local data stays fresh
      await this.syncReferenceDataIfDue();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Fail sync log
      syncLogDAL.failSync(syncLogId, errorMessage);

      // Update status with error tracking
      this.lastSyncAt = new Date();
      this.lastSyncStatus = 'failed';
      this.consecutiveFailures++;
      // API-003: Sanitize error message - remove internal details
      this.lastErrorMessage = this.sanitizeErrorMessage(errorMessage);
      this.lastErrorAt = new Date();

      log.error('Sync failed', {
        storeId: store.store_id,
        error: errorMessage,
        consecutiveFailures: this.consecutiveFailures,
      });
    } finally {
      this.isRunning = false;
      this.currentProgress = null; // Clear progress when sync completes
      this.notifyStatusChange();
    }
  }

  /**
   * Sync reference data from cloud if the configured interval has elapsed
   *
   * Reference data includes:
   * - Lottery games (status changes like ACTIVE → INACTIVE)
   * - Lottery bins (bin assignments and configuration)
   *
   * Enterprise-grade implementation:
   * - API-002: Rate limiting via configurable interval (default 5 minutes)
   * - API-003: Errors are logged but do not fail the main sync cycle
   * - LM-001: Structured logging with timing and result metrics
   * - DB-006: Store-scoped operations via bidirectionalSyncService
   *
   * @security Reference data sync failures are isolated from push queue processing
   */
  private async syncReferenceDataIfDue(): Promise<void> {
    // Check if reference data sync is due
    const now = Date.now();
    const lastSync = this.lastReferenceDataSyncAt?.getTime() ?? 0;
    const timeSinceLastSync = now - lastSync;

    // API-002: Rate limiting - only sync if interval has elapsed
    if (timeSinceLastSync < this.referenceDataSyncIntervalMs) {
      log.debug('Reference data sync skipped: interval not elapsed', {
        timeSinceLastSyncMs: timeSinceLastSync,
        intervalMs: this.referenceDataSyncIntervalMs,
        nextSyncInMs: this.referenceDataSyncIntervalMs - timeSinceLastSync,
      });
      return;
    }

    // Prevent concurrent reference data syncs
    if (this.isReferenceDataSyncing) {
      log.debug('Reference data sync skipped: already in progress');
      return;
    }

    this.isReferenceDataSyncing = true;
    const startTime = Date.now();

    try {
      log.info('Starting reference data sync (cloud → local)');

      // Sync games from cloud
      // This pulls any game status changes (e.g., ACTIVE → INACTIVE)
      const gamesResult = await this.syncGamesFromCloud();

      // Update last sync timestamp on success
      this.lastReferenceDataSyncAt = new Date();

      const elapsedMs = Date.now() - startTime;
      log.info('Reference data sync completed', {
        elapsedMs,
        gamesPulled: gamesResult.pulled,
        gamesConflicts: gamesResult.conflicts,
        gamesErrors: gamesResult.errors.length,
      });
    } catch (error: unknown) {
      // API-003: Log error but do not propagate to main sync cycle
      // Reference data sync failure should not block push queue processing
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const elapsedMs = Date.now() - startTime;

      log.error('Reference data sync failed', {
        elapsedMs,
        error: errorMessage,
      });

      // Do not update lastReferenceDataSyncAt - will retry on next cycle
    } finally {
      this.isReferenceDataSyncing = false;
    }
  }

  /**
   * Sync lottery games from cloud to local database
   *
   * Delegates to bidirectionalSyncService.syncGames() which implements:
   * - Delta sync using 'since' timestamp (only changed games)
   * - Last-write-wins conflict resolution
   * - Proper tenant isolation via store_id scoping
   *
   * @returns BidirectionalSyncResult with sync metrics
   * @throws Error if sync fails completely (partial failures return in result.errors)
   */
  private async syncGamesFromCloud(): Promise<BidirectionalSyncResult> {
    return bidirectionalSyncService.syncGames();
  }

  /**
   * Process the sync queue for a store
   * Groups items by entity type and sends in batches
   * Broadcasts real-time progress updates to UI
   *
   * @param storeId - Store identifier
   * @returns Sync result statistics
   */
  private async processSyncQueue(storeId: string): Promise<SyncResult> {
    log.info('Processing sync queue - checking for DLQ candidates', { storeId });

    // Reset items stuck in backoff for more than 2 minutes
    // This prevents items from being perpetually delayed when cloud recovers
    // Runs every sync cycle, not just at startup
    const stuckReset = syncQueueDAL.resetStuckInBackoff(storeId, 2);
    if (stuckReset > 0) {
      log.info('Reset items stuck in backoff during sync cycle', {
        storeId,
        resetCount: stuckReset,
      });
      this.updatePendingCount();
      this.notifyStatusChange();
    }

    // MQ-002: Process items for Dead Letter Queue
    // Items that have exceeded max attempts with PERMANENT/STRUCTURAL errors
    // or have exceeded the absolute limit (max_attempts * 2) are dead-lettered
    // NOTE: We no longer auto-reset failed items - they go to DLQ instead
    const itemsForDLQ = syncQueueDAL.getItemsForAutoDeadLetter(storeId);

    // DEBUG: Log PULL items specifically for troubleshooting
    const pullItems = itemsForDLQ.filter((item) => item.entity_id.startsWith('pull-'));
    if (pullItems.length > 0) {
      log.info('PULL items found for auto-DLQ', {
        count: pullItems.length,
        items: pullItems.map((item) => ({
          id: item.id,
          entity_id: item.entity_id,
          entity_type: item.entity_type,
          sync_attempts: item.sync_attempts,
          max_attempts: item.max_attempts,
          error_category: item.error_category,
        })),
      });
    }

    if (itemsForDLQ.length > 0) {
      const dlqParams = itemsForDLQ.map((item) => ({
        id: item.id,
        reason: (item.error_category === 'STRUCTURAL'
          ? 'STRUCTURAL_FAILURE'
          : item.error_category === 'PERMANENT'
            ? 'PERMANENT_ERROR'
            : 'MAX_ATTEMPTS_EXCEEDED') as DeadLetterReason,
        errorCategory: (item.error_category || 'UNKNOWN') as ErrorCategory,
        error: item.last_sync_error || undefined,
      }));

      const deadLetteredCount = syncQueueDAL.deadLetterMany(dlqParams);

      // DEBUG: Log the result of deadLetterMany including PULL items
      log.info('DLQ processing result', {
        storeId,
        itemsFound: itemsForDLQ.length,
        itemsDeadLettered: deadLetteredCount,
        pullItemsCount: pullItems.length,
        dlqParams: dlqParams.map((p) => ({
          id: p.id,
          reason: p.reason,
          errorCategory: p.errorCategory,
        })),
      });

      if (deadLetteredCount > 0) {
        log.warn('Items moved to Dead Letter Queue', {
          storeId,
          count: deadLetteredCount,
          byCategory: {
            structural: dlqParams.filter((p) => p.reason === 'STRUCTURAL_FAILURE').length,
            permanent: dlqParams.filter((p) => p.reason === 'PERMANENT_ERROR').length,
            maxAttempts: dlqParams.filter((p) => p.reason === 'MAX_ATTEMPTS_EXCEEDED').length,
          },
        });
        this.updatePendingCount();
        this.notifyStatusChange();
      }
    }

    // Get retryable items (respects exponential backoff)
    const items = syncQueueDAL.getRetryableItems(storeId, SYNC_BATCH_SIZE);

    // Get total pending count for progress display (includes items in backoff)
    const totalPending = this.pendingCount;

    if (items.length === 0) {
      log.debug('No items to sync');
      // Still show pending count even if none are retryable right now
      if (totalPending > 0) {
        this.currentProgress = {
          totalItems: totalPending,
          completedItems: 0,
          succeededItems: 0,
          failedItems: 0,
          currentEntityType: null,
          recentErrors: [...this.recentSyncErrors],
        };
        this.notifyStatusChange();
      } else {
        this.currentProgress = null;
      }
      return { sent: 0, succeeded: 0, failed: 0 };
    }

    // Initialize progress tracking - use total pending for better UX
    // This shows "Syncing X/673" instead of "Syncing X/10"
    this.currentProgress = {
      totalItems: totalPending,
      completedItems: 0,
      succeededItems: 0,
      failedItems: 0,
      currentEntityType: null,
      recentErrors: [...this.recentSyncErrors],
    };
    this.notifyStatusChange();

    // Group by entity type for batched API calls
    const batches = this.groupByEntityType(items);

    let succeeded = 0;
    let failed = 0;

    for (const [entityType, batchItems] of Object.entries(batches)) {
      // Update current entity type being processed
      this.currentProgress.currentEntityType = entityType;
      this.notifyStatusChange();

      try {
        const response = await this.pushBatch(entityType, batchItems);

        for (const item of batchItems) {
          // Look up result by queue item ID, not entity_id (supports multiple items per entity)
          const result = response.results.find((r) => r.id === item.id);

          if (result?.status === 'synced') {
            // v040: Pass API context for troubleshooting display
            syncQueueDAL.markSynced(item.id, result.apiContext);
            succeeded++;
            this.currentProgress.succeededItems = succeeded;
          } else {
            const error = result?.error || 'Unknown error';
            const httpStatus = result?.apiContext?.http_status || null;

            // ERR-007/MQ-002: Classify error to determine retry vs dead-letter routing
            const classification = classifyError(httpStatus, error);
            syncQueueDAL.updateErrorCategory(item.id, classification.category);

            // Handle rate limit retry-after
            if (classification.retryAfter) {
              syncQueueDAL.setRetryAfter(item.id, classification.retryAfter);
            }

            // v040: Pass API context for troubleshooting display
            syncQueueDAL.incrementAttempts(item.id, error, result?.apiContext);
            failed++;
            this.currentProgress.failedItems = failed;
            // Track error for display
            this.addRecentError(entityType, this.sanitizeErrorMessage(error));

            // Log classification for debugging
            log.debug('Error classified for sync item', {
              itemId: item.id,
              errorCategory: classification.category,
              action: classification.action,
              httpStatus,
            });
          }

          // Update completed count and broadcast progress
          this.currentProgress.completedItems = succeeded + failed;
          this.currentProgress.recentErrors = [...this.recentSyncErrors];
          this.notifyStatusChange();
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Network error';
        const sanitizedError = this.sanitizeErrorMessage(errorMessage);

        // Track batch-level error
        this.addRecentError(entityType, sanitizedError);

        // ERR-002: Extract full response body from CloudApiError for dead letter storage
        // This preserves the complete error details from the cloud API
        let httpStatus: number | null = null;
        let responseBody: string;

        if (CloudApiError.isCloudApiError(error)) {
          // CloudApiError contains full response details for debugging
          httpStatus = error.httpStatus;
          responseBody = error.getTruncatedResponseBody(2000);
          log.debug('CloudApiError captured with full response', {
            httpStatus,
            code: error.code,
            hasDetails: Boolean(error.details),
            responseBodyLength: error.responseBody.length,
          });
        } else {
          // Fallback for non-CloudApiError (network errors, etc.)
          httpStatus = this.extractHttpStatusFromError(errorMessage);
          responseBody = errorMessage.substring(0, 500);
        }

        const batchApiContext: SyncApiContext = {
          api_endpoint: this.getEndpointForEntityType(entityType),
          http_status: httpStatus,
          response_body: responseBody,
        };

        // ERR-007/MQ-002: Classify the batch error
        const batchClassification = classifyError(httpStatus, errorMessage);

        // Mark all items in batch as failed with API context and error classification
        for (const item of batchItems) {
          syncQueueDAL.updateErrorCategory(item.id, batchClassification.category);

          // Handle rate limit retry-after for entire batch
          if (batchClassification.retryAfter) {
            syncQueueDAL.setRetryAfter(item.id, batchClassification.retryAfter);
          }

          syncQueueDAL.incrementAttempts(item.id, errorMessage, batchApiContext);
          failed++;
          this.currentProgress.failedItems = failed;
          this.currentProgress.completedItems = succeeded + failed;
        }
        this.currentProgress.recentErrors = [...this.recentSyncErrors];
        this.notifyStatusChange();

        log.error(`Batch sync failed for entity type: ${entityType}`, {
          entityType,
          itemCount: batchItems.length,
          error: errorMessage,
        });
      }
    }

    // Clear progress when done (will be set to null after runSync completes)
    this.currentProgress.currentEntityType = null;

    return { sent: items.length, succeeded, failed };
  }

  /**
   * Add an error to the recent errors list (capped at 5)
   */
  private addRecentError(entityType: string, error: string): void {
    this.recentSyncErrors.unshift({
      entityType,
      error,
      timestamp: new Date().toISOString(),
    });
    // Keep only the last 5 errors
    if (this.recentSyncErrors.length > 5) {
      this.recentSyncErrors = this.recentSyncErrors.slice(0, 5);
    }
  }

  /**
   * Group items by entity type for batched processing
   *
   * @param items - Array of sync queue items
   * @returns Object with entity types as keys and items as values
   */
  private groupByEntityType(items: SyncQueueItem[]): Record<string, SyncQueueItem[]> {
    const groups: Record<string, SyncQueueItem[]> = {};

    for (const item of items) {
      if (!groups[item.entity_type]) {
        groups[item.entity_type] = [];
      }
      groups[item.entity_type].push(item);
    }

    return groups;
  }

  /**
   * Push a batch of items to the cloud API
   *
   * Enterprise-grade routing:
   * - Routes 'pack' entity types to specialized pack sync endpoints
   * - Routes 'shift_opening' entity types to pushShiftOpening endpoint
   * - Routes 'shift_closing' entity types to pushShiftClosing endpoint
   * - Falls back to generic pushBatch for other entity types
   *
   * @param entityType - Type of entity being synced
   * @param items - Items to sync
   * @returns Batch sync response
   */
  private async pushBatch(entityType: string, items: SyncQueueItem[]): Promise<BatchSyncResponse> {
    // Route pack entity type to specialized endpoints
    if (entityType === 'pack') {
      return this.pushPackBatch(items);
    }

    // Employee entity type - BIDIRECTIONAL sync enabled
    // Cloud API supports both GET and POST /api/v1/sync/employees
    // Employees can be created/updated locally and pushed to cloud
    if (entityType === 'employee') {
      return this.pushEmployeeBatch(items);
    }

    // User entity type - LOCAL-ONLY, no cloud sync endpoint
    // Users are managed locally and synced via employee records from cloud
    // Mark as synced to clear queue - no API endpoint exists for user push
    if (entityType === 'user') {
      log.info('User sync skipped - users are local-only (no push API endpoint)', {
        itemCount: items.length,
      });
      return {
        success: true,
        results: items.map((item) => ({
          id: item.id,
          status: 'synced' as const,
        })),
      };
    }

    // Bin entity type - LOCAL-ONLY, no cloud sync endpoint
    // Bins are managed locally; cloud bins are pulled via games sync
    // Mark as synced to clear queue - no API endpoint exists for bin push
    if (entityType === 'bin') {
      log.info('Bin sync skipped - bins are local-only (no push API endpoint)', {
        itemCount: items.length,
      });
      return {
        success: true,
        results: items.map((item) => ({
          id: item.id,
          status: 'synced' as const,
        })),
      };
    }

    // Game entity type - PULL-ONLY per API specification
    // Games are cloud-managed: created in portal, pulled to local
    // Mark as synced to clear queue - no API endpoint exists for game push
    if (entityType === 'game') {
      log.info('Game sync skipped - games are cloud-managed (pull only per API spec)', {
        itemCount: items.length,
      });
      return {
        success: true,
        results: items.map((item) => ({
          id: item.id,
          status: 'synced' as const,
        })),
      };
    }

    // Route shift entity type to specialized endpoint
    // IMPORTANT: Shifts MUST sync BEFORE pack operations that reference them
    // to satisfy cloud FK constraints (activated_shift_id, etc.)
    if (entityType === 'shift') {
      return this.pushShiftBatch(items);
    }

    // Route shift_opening entity type to specialized endpoint
    if (entityType === 'shift_opening') {
      return this.pushShiftOpeningBatch(items);
    }

    // Route shift_closing entity type to specialized endpoint
    if (entityType === 'shift_closing') {
      return this.pushShiftClosingBatch(items);
    }

    // Route day_open entity type to specialized endpoint
    // day_open MUST sync BEFORE day_close to satisfy cloud dependency
    // (cloud requires an OPEN day before it can be closed)
    if (entityType === 'day_open') {
      return this.pushDayOpenBatch(items);
    }

    // Route day_close entity type to specialized two-phase commit endpoints
    if (entityType === 'day_close') {
      return this.pushDayCloseBatch(items);
    }

    // Route variance_approval entity type to specialized endpoint
    if (entityType === 'variance_approval') {
      return this.pushVarianceApprovalBatch(items);
    }

    // Unsupported entity types - mark as failed
    // No generic /api/v1/sync/batch endpoint exists in the API
    log.warn('Unsupported entity type for sync - no API endpoint available', {
      entityType,
      itemCount: items.length,
    });

    return {
      success: false,
      results: items.map((item) => ({
        id: item.id,
        status: 'failed' as const,
        error: `Unsupported entity type: ${entityType}. No sync endpoint available.`,
      })),
    };
  }

  /**
   * Push pack items to specialized cloud endpoints based on operation
   *
   * Enterprise-grade pack sync implementation:
   * - Routes CREATE operations to /packs/receive
   * - Routes UPDATE operations based on pack status in payload
   * - API-001: Validates payload structure
   * - API-003: Returns per-item results for error handling
   * - SEC-017: Audit logging for all operations
   *
   * @param items - Pack sync queue items
   * @returns Batch response with per-item results
   */
  private async pushPackBatch(items: SyncQueueItem[]): Promise<BatchSyncResponse> {
    const results: BatchSyncResponse['results'] = [];

    for (const item of items) {
      // Track pack status for accurate endpoint reporting in catch block
      let packStatus: string | undefined;

      try {
        // Parse payload - check if this is actual pack data or a pull tracking marker
        const rawPayload = JSON.parse(item.payload);

        // Skip PULL tracking items - these are markers for pull operations, not actual pack data
        // They have format: { action: 'pull_activated_packs', timestamp: '...', lastPull: '...' }
        if (rawPayload.action && rawPayload.action.startsWith('pull_')) {
          log.debug('Skipping pull tracking item', {
            itemId: item.id,
            action: rawPayload.action,
          });
          results.push({
            id: item.id,
            status: 'synced' as const, // Mark as synced to clear from queue
          });
          continue;
        }

        // Cast to expected pack payload structure
        const payload = rawPayload as {
          pack_id: string;
          store_id: string;
          game_id: string;
          game_code?: string;
          pack_number: string;
          status: string;
          bin_id: string | null;
          opening_serial: string | null;
          closing_serial: string | null;
          tickets_sold: number;
          sales_amount: number;
          received_at: string | null;
          received_by: string | null;
          activated_at: string | null;
          activated_by: string | null;
          depleted_at: string | null;
          returned_at: string | null;
          // Serial range fields (required by activate API)
          serial_start?: string | null;
          serial_end?: string | null;
          // Shift tracking fields (v019 schema)
          shift_id?: string | null;
          depleted_shift_id?: string | null;
          depleted_by?: string | null;
          returned_shift_id?: string | null;
          returned_by?: string | null;
          /** v019: SEC-014 validated at entry point */
          depletion_reason?: DepletionReason | null;
          // v019: Return context fields
          /** SEC-014 validated at entry point */
          return_reason?: ReturnReason | null;
          return_notes?: string | null;
          // Mark-sold at activation fields (only if pack was mark-sold at activation time)
          mark_sold_tickets?: number;
          mark_sold_reason?: string;
          mark_sold_approved_by?: string | null;
        };

        // Track status for accurate endpoint reporting in catch block
        packStatus = payload.status;

        // Look up game_code if not in payload (legacy queue items)
        let gameCode = payload.game_code;
        if (!gameCode && payload.game_id) {
          const game = lotteryGamesDAL.findById(payload.game_id);
          if (game) {
            gameCode = game.game_code;
          } else {
            log.error('Cannot sync pack: game not found', {
              packId: payload.pack_id,
              gameId: payload.game_id,
            });
            results.push({
              id: item.id,
              status: 'failed',
              error: 'Game not found for pack',
            });
            continue;
          }
        }

        if (!gameCode) {
          log.error('Cannot sync pack: game_code missing', { packId: payload.pack_id });
          results.push({
            id: item.id,
            status: 'failed',
            error: 'game_code missing',
          });
          continue;
        }

        // Route based on operation and status
        if (item.operation === 'CREATE') {
          // New pack received - API: POST /api/v1/sync/lottery/packs/receive
          // Note: After cloud_id consolidation, pack_id IS the cloud ID
          try {
            const response = await cloudApiService.pushPackReceive({
              pack_id: payload.pack_id,
              store_id: payload.store_id,
              game_id: payload.game_id,
              game_code: gameCode,
              pack_number: payload.pack_number,
              serial_start: payload.serial_start || '000',
              serial_end: payload.serial_end || '299',
              received_at: payload.received_at || new Date().toISOString(),
              received_by: payload.received_by,
            });

            // Note: After cloud_id consolidation, pack_id IS the cloud ID
            // No need to update a separate cloud_pack_id field
            results.push({
              id: item.id, // Use queue item ID, not entity_id (supports multiple items per entity)
              cloudId: payload.pack_id, // pack_id IS the cloud ID
              status: response.success ? 'synced' : 'failed',
              apiContext: {
                api_endpoint: '/api/v1/sync/lottery/packs/receive',
                http_status: response.success ? 200 : 500,
              },
            });
          } catch (receiveError) {
            // Check if this is a duplicate pack error (HTTP 409)
            // This means the pack is already in the cloud - treat as success
            const errorMessage =
              receiveError instanceof Error ? receiveError.message : String(receiveError);
            if (errorMessage.includes('409') || errorMessage.includes('DUPLICATE_PACK')) {
              log.info('Pack already exists in cloud, marking as synced', {
                packId: payload.pack_id,
                packNumber: payload.pack_number,
              });

              // Note: After cloud_id consolidation, pack_id IS the cloud ID
              // No need to extract or store a separate cloud_pack_id
              results.push({
                id: item.id, // Use queue item ID, not entity_id
                cloudId: payload.pack_id, // pack_id IS the cloud ID
                status: 'synced',
                apiContext: {
                  api_endpoint: '/api/v1/sync/lottery/packs/receive',
                  http_status: 409,
                  response_body: 'DUPLICATE_PACK - Pack already exists in cloud',
                },
              });
            } else {
              throw receiveError; // Re-throw for non-duplicate errors
            }
          }
        } else if (item.operation === 'UPDATE') {
          // Route based on current status
          let success = false;

          // Note: After cloud_id consolidation, pack_id IS the cloud ID
          // No need to look up a separate cloud_pack_id field

          switch (payload.status) {
            case 'ACTIVE':
              // Pack was activated
              // API spec REQUIRED: pack_id, bin_id, opening_serial, game_code, pack_number,
              //                    serial_start, serial_end, activated_at, received_at
              // API spec OPTIONAL (only if mark-sold at activation): mark_sold_tickets, mark_sold_reason, mark_sold_approved_by
              if (
                payload.bin_id &&
                payload.opening_serial &&
                payload.activated_at &&
                payload.received_at &&
                gameCode
              ) {
                // Get serial_start and serial_end from payload or calculate from game
                const serialStart = payload.serial_start || '000';
                let serialEnd = payload.serial_end;

                // If serial_end not in payload, look up game to calculate it
                if (!serialEnd) {
                  const game = lotteryGamesDAL.findById(payload.game_id);
                  if (game?.tickets_per_pack) {
                    // serial_end = tickets_per_pack - 1, padded to 3 digits
                    serialEnd = String(game.tickets_per_pack - 1).padStart(3, '0');
                  } else {
                    // Default to 299 (300 tickets per pack)
                    serialEnd = '299';
                  }
                }

                // Build activation payload - mark_sold fields only included if pack was mark-sold at activation
                // Note: After cloud_id consolidation, pack_id IS the cloud ID
                const activatePayload: Parameters<typeof cloudApiService.pushPackActivate>[0] = {
                  pack_id: payload.pack_id, // pack_id IS the cloud ID
                  store_id: payload.store_id,
                  bin_id: payload.bin_id, // TODO: May also need cloud bin_id
                  opening_serial: payload.opening_serial,
                  game_code: gameCode,
                  pack_number: payload.pack_number,
                  serial_start: serialStart,
                  serial_end: serialEnd,
                  activated_at: payload.activated_at,
                  received_at: payload.received_at,
                  activated_by: payload.activated_by,
                  // v019: Include shift context for cloud audit trail
                  shift_id: payload.shift_id,
                  local_id: payload.pack_id, // Send local ID for reference (same as pack_id now)
                };

                // Only add mark_sold fields if pack was actually mark-sold at activation
                if (payload.mark_sold_tickets && payload.mark_sold_tickets > 0) {
                  activatePayload.mark_sold_tickets = payload.mark_sold_tickets;
                  activatePayload.mark_sold_reason = payload.mark_sold_reason || 'Full pack sold';
                  activatePayload.mark_sold_approved_by = payload.mark_sold_approved_by;
                }

                const activateResponse = await cloudApiService.pushPackActivate(activatePayload);
                success = activateResponse.success;
              } else {
                log.warn('Pack activation missing required fields', {
                  packId: payload.pack_id,
                  hasBinId: Boolean(payload.bin_id),
                  hasOpeningSerial: Boolean(payload.opening_serial),
                  hasActivatedAt: Boolean(payload.activated_at),
                  hasReceivedAt: Boolean(payload.received_at),
                  hasGameCode: Boolean(gameCode),
                });
                success = false;
              }
              break;

            case 'DEPLETED':
              // Pack was depleted/sold out
              // v019 Schema Alignment: Now includes shift context for audit trail
              // Note: After cloud_id consolidation, pack_id IS the cloud ID
              // SEC-014: depletion_reason validated at entry point by DepletionReasonSchema
              // depletion_reason is REQUIRED by cloud API - fail sync if missing
              if (payload.closing_serial && payload.depleted_at && payload.depletion_reason) {
                const depleteResponse = await cloudApiService.pushPackDeplete({
                  pack_id: payload.pack_id, // pack_id IS the cloud ID
                  store_id: payload.store_id,
                  closing_serial: payload.closing_serial,
                  tickets_sold: payload.tickets_sold,
                  sales_amount: payload.sales_amount,
                  depleted_at: payload.depleted_at,
                  // v019: Include depletion reason (SHIFT_CLOSE, AUTO_REPLACED, MANUAL_SOLD_OUT, POS_LAST_TICKET)
                  // SEC-014: Type narrowed by guard above
                  depletion_reason: payload.depletion_reason,
                  // SEC-010: Include depleted_by for cloud audit trail (required by cloud API)
                  depleted_by: payload.depleted_by,
                  // v019: Include shift context for cloud audit trail
                  shift_id: payload.depleted_shift_id,
                  local_id: payload.pack_id, // Send local ID for reference (same as pack_id now)
                });
                success = depleteResponse.success;
              } else {
                log.warn('Pack depletion missing required fields', {
                  packId: payload.pack_id,
                  hasClosingSerial: Boolean(payload.closing_serial),
                  hasDepletedAt: Boolean(payload.depleted_at),
                  hasDepletionReason: Boolean(payload.depletion_reason),
                });
                success = false;
              }
              break;

            case 'RETURNED':
              // Pack was returned
              // v019 Schema Alignment: Now includes shift context for audit trail
              // Note: After cloud_id consolidation, pack_id IS the cloud ID
              // SEC-014: return_reason validated at entry point by ReturnReasonSchema
              // return_reason is REQUIRED by cloud API - fail sync if missing
              if (payload.returned_at && payload.return_reason) {
                const returnResponse = await cloudApiService.pushPackReturn({
                  pack_id: payload.pack_id, // pack_id IS the cloud ID
                  store_id: payload.store_id,
                  closing_serial: payload.closing_serial,
                  tickets_sold: payload.tickets_sold,
                  sales_amount: payload.sales_amount,
                  returned_at: payload.returned_at,
                  // v019: Include return reason (SUPPLIER_RECALL, DAMAGED, EXPIRED, INVENTORY_ADJUSTMENT, STORE_CLOSURE)
                  // SEC-014: Type narrowed by guard above
                  return_reason: payload.return_reason,
                  // v019: Include optional return notes (max 500 chars)
                  return_notes: payload.return_notes,
                  // SEC-010: Include returned_by for cloud audit trail (required by cloud API)
                  returned_by: payload.returned_by,
                  // v019: Include shift context for cloud audit trail
                  shift_id: payload.returned_shift_id,
                  local_id: payload.pack_id, // Send local ID for reference (same as pack_id now)
                });
                success = returnResponse.success;
              } else {
                log.warn('Pack return missing required fields', {
                  packId: payload.pack_id,
                  hasReturnedAt: Boolean(payload.returned_at),
                  hasReturnReason: Boolean(payload.return_reason),
                });
                success = false;
              }
              break;

            default:
              log.warn('Unknown pack status for UPDATE operation', {
                packId: payload.pack_id,
                status: payload.status,
              });
              success = false;
          }

          results.push({
            id: item.id, // Use queue item ID, not entity_id
            status: success ? 'synced' : 'failed',
            error: success ? undefined : `Failed to sync pack with status: ${payload.status}`,
            apiContext: {
              api_endpoint: this.getPackEndpoint(item.operation, payload.status),
              http_status: success ? 200 : 500,
            },
          });
        } else if (item.operation === 'ACTIVATE') {
          // Direct activation - calls POST /api/v1/sync/lottery/packs/activate
          // Per API spec, this endpoint handles create-and-activate in one call:
          // 1. Pack doesn't exist: Create it and activate
          // 2. Pack exists with RECEIVED status: Activate it
          // 3. Pack already ACTIVE in same bin: Idempotent success
          // Note: After cloud_id consolidation, pack_id IS the cloud ID

          // Get serial_start and serial_end from payload or calculate from game
          const serialStart = payload.serial_start || '000';
          let serialEnd = payload.serial_end;

          if (!serialEnd) {
            const game = lotteryGamesDAL.findById(payload.game_id);
            if (game?.tickets_per_pack) {
              serialEnd = String(game.tickets_per_pack - 1).padStart(3, '0');
            } else {
              serialEnd = '299';
            }
          }

          // Required: bin_id, opening_serial, gameCode, activated_at, received_at
          if (
            payload.bin_id &&
            payload.opening_serial &&
            gameCode &&
            payload.activated_at &&
            payload.received_at
          ) {
            try {
              const activateResponse = await cloudApiService.pushPackActivate({
                pack_id: payload.pack_id,
                bin_id: payload.bin_id,
                opening_serial: payload.opening_serial,
                game_code: gameCode,
                pack_number: payload.pack_number,
                serial_start: serialStart,
                serial_end: serialEnd,
                activated_at: payload.activated_at,
                received_at: payload.received_at,
                activated_by: payload.activated_by,
                shift_id: payload.shift_id,
                local_id: payload.pack_id,
              });

              results.push({
                id: item.id,
                status: activateResponse.success ? 'synced' : 'failed',
                error: activateResponse.success ? undefined : 'Activation failed',
                apiContext: {
                  api_endpoint: '/api/v1/sync/lottery/packs/activate',
                  http_status: activateResponse.success ? 200 : 500,
                },
              });
            } catch (activateError) {
              const errorMsg =
                activateError instanceof Error ? activateError.message : String(activateError);
              log.error('Failed to activate pack', {
                packId: payload.pack_id,
                error: errorMsg,
              });

              // ERR-002: Extract full response body from CloudApiError
              let httpStatus: number | null;
              let responseBody: string;

              if (CloudApiError.isCloudApiError(activateError)) {
                httpStatus = activateError.httpStatus;
                responseBody = activateError.getTruncatedResponseBody(2000);
              } else {
                httpStatus = this.extractHttpStatusFromError(errorMsg);
                responseBody = errorMsg.substring(0, 500);
              }

              results.push({
                id: item.id,
                status: 'failed',
                error: errorMsg,
                apiContext: {
                  api_endpoint: '/api/v1/sync/lottery/packs/activate',
                  http_status: httpStatus,
                  response_body: responseBody,
                },
              });
            }
          } else {
            log.warn('Pack ACTIVATE missing required fields', {
              packId: payload.pack_id,
              hasBinId: Boolean(payload.bin_id),
              hasOpeningSerial: Boolean(payload.opening_serial),
              hasGameCode: Boolean(gameCode),
              hasActivatedAt: Boolean(payload.activated_at),
              hasReceivedAt: Boolean(payload.received_at),
            });
            results.push({
              id: item.id,
              status: 'failed',
              error: 'Missing required fields for activation',
              apiContext: {
                api_endpoint: '/api/v1/sync/lottery/packs/activate',
                http_status: 400,
              },
            });
          }
        } else if (item.operation === 'DELETE') {
          // Pack deletion - not typically supported, log warning
          log.warn('Pack DELETE operation not supported for cloud sync', {
            packId: item.entity_id,
          });
          results.push({
            id: item.id, // Use queue item ID, not entity_id
            status: 'failed',
            error: 'DELETE operation not supported for packs',
            apiContext: {
              api_endpoint: '/api/v1/sync/lottery/packs',
              http_status: 501, // Not Implemented
            },
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error('Failed to sync pack item', {
          itemId: item.id,
          entityId: item.entity_id,
          operation: item.operation,
          error: errorMessage,
        });

        // ERR-002: Extract full response body from CloudApiError for dead letter storage
        let httpStatus: number | null;
        let responseBody: string;

        if (CloudApiError.isCloudApiError(error)) {
          httpStatus = error.httpStatus;
          responseBody = error.getTruncatedResponseBody(2000);
        } else {
          httpStatus = this.extractHttpStatusFromError(errorMessage);
          responseBody = errorMessage.substring(0, 500);
        }

        // Use actual endpoint based on operation and status instead of generic fallback
        const actualEndpoint = this.getPackEndpoint(item.operation, packStatus);
        results.push({
          id: item.id, // Use queue item ID, not entity_id
          status: 'failed',
          error: errorMessage,
          apiContext: {
            api_endpoint: actualEndpoint,
            http_status: httpStatus,
            response_body: responseBody,
          },
        });
      }
    }

    return {
      success: results.every((r) => r.status === 'synced'),
      results,
    };
  }

  /**
   * Push shift records to cloud API
   *
   * Enterprise-grade shift sync implementation:
   * - API-001: Validates payload structure with required field checks
   * - API-003: Returns per-item results for error handling
   * - SEC-006: Uses structured payload, no string concatenation
   * - SEC-010: AUTHZ - opened_by/closed_by must be valid user UUIDs
   * - SEC-017: Audit logging for all operations
   * - DB-006: TENANT_ISOLATION - store_id validated in payload
   *
   * Field Mapping (ShiftSyncPayload → Cloud API):
   * - opened_at: When shift was opened (ISO timestamp) - REQUIRED
   * - opened_by: Who opened the shift (user UUID) - REQUIRED
   * - closed_at: When shift was closed - null if OPEN
   * - closed_by: Who closed the shift - null if OPEN
   *
   * IMPORTANT: Shifts MUST sync BEFORE pack operations that reference them
   * to satisfy cloud FK constraints (activated_shift_id, depleted_shift_id, etc.)
   *
   * @param items - Shift sync queue items
   * @returns Batch response with per-item results
   */
  private async pushShiftBatch(items: SyncQueueItem[]): Promise<BatchSyncResponse> {
    const results: BatchSyncResponse['results'] = [];

    for (const item of items) {
      try {
        // API-001: Parse and validate payload structure
        // Internal field names: opened_at, opened_by, closed_at
        // Cloud API translation happens in cloud-api.service.ts: opened_at→start_time, opened_by→cashier_id, closed_at→end_time
        const payload = JSON.parse(item.payload) as {
          shift_id: string;
          store_id: string;
          business_date: string;
          shift_number: number;
          status: 'OPEN' | 'CLOSED';
          opened_at: string;
          opened_by: string | null;
          closed_at: string | null;
          external_register_id?: string | null;
          external_cashier_id?: string | null;
          external_till_id?: string | null;
        };

        // API-001: Validate required fields
        // opened_at is REQUIRED by cloud API
        // opened_by can be null for shifts without assigned cashier
        if (
          !payload.shift_id ||
          !payload.store_id ||
          !payload.business_date ||
          typeof payload.shift_number !== 'number' ||
          !payload.opened_at ||
          !payload.status
        ) {
          log.warn('Shift payload missing required fields', {
            shiftId: payload.shift_id,
            hasStoreId: Boolean(payload.store_id),
            hasBusinessDate: Boolean(payload.business_date),
            hasShiftNumber: typeof payload.shift_number === 'number',
            hasOpenedAt: Boolean(payload.opened_at),
            hasStatus: Boolean(payload.status),
          });
          results.push({
            id: item.id,
            status: 'failed',
            error: 'Missing required fields in shift payload',
          });
          continue;
        }

        // Route to cloud API - field translation happens in pushShift()
        const response = await cloudApiService.pushShift({
          shift_id: payload.shift_id,
          store_id: payload.store_id,
          business_date: payload.business_date,
          shift_number: payload.shift_number,
          opened_at: payload.opened_at,
          opened_by: payload.opened_by,
          status: payload.status,
          closed_at: payload.closed_at,
          external_register_id: payload.external_register_id,
          external_cashier_id: payload.external_cashier_id,
          external_till_id: payload.external_till_id,
          local_id: payload.shift_id,
        });

        results.push({
          id: item.id,
          status: response.success ? 'synced' : 'failed',
          error: response.success ? undefined : 'Failed to sync shift',
        });

        // SEC-017: Audit log
        if (response.success) {
          log.info('Shift synced to cloud', {
            shiftId: payload.shift_id,
            businessDate: payload.business_date,
            shiftNumber: payload.shift_number,
            hasOpenedBy: Boolean(payload.opened_by),
            idempotent: response.idempotent,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // ERR-002: Extract full response body from CloudApiError
        let apiContext: SyncApiContext | undefined;
        if (CloudApiError.isCloudApiError(error)) {
          apiContext = {
            api_endpoint: '/api/v1/sync/lottery/shifts',
            http_status: error.httpStatus,
            response_body: error.getTruncatedResponseBody(2000),
          };
        }

        log.error('Failed to sync shift item', {
          itemId: item.id,
          entityId: item.entity_id,
          error: errorMessage,
          hasApiContext: Boolean(apiContext),
        });
        results.push({
          id: item.id,
          status: 'failed',
          error: errorMessage,
          apiContext,
        });
      }
    }

    return {
      success: results.every((r) => r.status === 'synced'),
      results,
    };
  }

  /**
   * Push employee items to cloud API
   *
   * Enterprise-grade employee sync implementation for bidirectional sync:
   * - API-001: Validates payload structure
   * - API-003: Returns per-item results for error handling
   * - SEC-001: NEVER includes PIN data in payload
   * - SEC-006: Uses structured payload, no string concatenation
   * - SEC-017: Audit logging for all operations
   * - DB-006: TENANT_ISOLATION - store_id validated in payload
   *
   * @param items - Employee sync queue items
   * @returns Batch response with per-item results
   */
  private async pushEmployeeBatch(items: SyncQueueItem[]): Promise<BatchSyncResponse> {
    if (items.length === 0) {
      return { success: true, results: [] };
    }

    // API-001: Parse and validate all payloads
    const employees: Array<{
      user_id: string;
      role: string;
      name: string;
      pin_hash: string;
      active: boolean;
      itemId: string;
    }> = [];

    const results: BatchSyncResponse['results'] = [];

    for (const item of items) {
      try {
        const payload = JSON.parse(item.payload) as {
          user_id: string;
          store_id: string;
          role: string;
          name: string;
          active: boolean;
        };

        // SEC-001 UPDATED: Plain text PIN must never be in payload
        // But pin_hash (bcrypt hashed) is now REQUIRED by cloud API
        const payloadObj = payload as Record<string, unknown>;
        if ('pin' in payloadObj) {
          log.error('SECURITY: Plain text PIN detected in employee sync payload - rejecting', {
            itemId: item.id,
            userId: payload.user_id,
          });
          results.push({
            id: item.id,
            status: 'failed',
            error: 'Security violation: Plain text PIN must not be in sync payload',
          });
          continue;
        }

        // API-001: Validate required fields
        if (!payload.user_id || !payload.role || !payload.name) {
          log.warn('Employee payload missing required fields', {
            itemId: item.id,
            userId: payload.user_id,
            hasRole: Boolean(payload.role),
            hasName: Boolean(payload.name),
          });
          results.push({
            id: item.id,
            status: 'failed',
            error: 'Missing required fields in employee payload',
          });
          continue;
        }

        // Fetch pin_hash from database - cloud API requires it
        // This is secure because pin_hash is already bcrypt hashed
        const user = usersDAL.findById(payload.user_id);
        if (!user || !user.pin_hash) {
          log.warn('Employee not found or missing pin_hash', {
            itemId: item.id,
            userId: payload.user_id,
            found: Boolean(user),
            hasPinHash: Boolean(user?.pin_hash),
          });
          results.push({
            id: item.id,
            status: 'failed',
            error: 'Employee not found or missing PIN hash',
          });
          continue;
        }

        employees.push({
          user_id: payload.user_id,
          role: payload.role,
          name: payload.name,
          pin_hash: user.pin_hash,
          active: payload.active ?? true,
          itemId: item.id,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error('Failed to parse employee payload', {
          itemId: item.id,
          error: errorMessage,
        });
        results.push({
          id: item.id,
          status: 'failed',
          error: `Invalid payload: ${errorMessage}`,
        });
      }
    }

    // Push all valid employees in one batch request
    if (employees.length > 0) {
      try {
        const response = await cloudApiService.pushEmployees(
          employees.map((emp) => ({
            user_id: emp.user_id,
            role: emp.role,
            name: emp.name,
            pin_hash: emp.pin_hash,
            active: emp.active,
          }))
        );

        // Map response results back to item IDs
        for (let i = 0; i < employees.length; i++) {
          const emp = employees[i];
          const apiResult = response.results[i];

          results.push({
            id: emp.itemId,
            status: apiResult?.status || (response.success ? 'synced' : 'failed'),
            error: apiResult?.error,
          });

          // SEC-017: Audit log
          if (apiResult?.status === 'synced' || response.success) {
            log.info('Employee synced to cloud', {
              userId: emp.user_id,
              name: emp.name,
              role: emp.role,
            });
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // ERR-002: Extract full response body from CloudApiError
        let apiContext: SyncApiContext | undefined;
        if (CloudApiError.isCloudApiError(error)) {
          apiContext = {
            api_endpoint: '/api/v1/sync/employees',
            http_status: error.httpStatus,
            response_body: error.getTruncatedResponseBody(2000),
          };
        }

        log.error('Failed to push employee batch to cloud', {
          count: employees.length,
          error: errorMessage,
          hasApiContext: Boolean(apiContext),
          httpStatus: apiContext?.http_status,
        });

        // Mark all items as failed with API context for dead letter storage
        for (const emp of employees) {
          results.push({
            id: emp.itemId,
            status: 'failed',
            error: errorMessage,
            apiContext,
          });
        }
      }
    }

    return {
      success: results.every((r) => r.status === 'synced'),
      results,
    };
  }

  /**
   * Push shift opening items to cloud API
   *
   * Enterprise-grade shift opening sync implementation:
   * - API-001: Validates payload structure
   * - API-003: Returns per-item results for error handling
   * - SEC-006: Uses structured payload, no string concatenation
   * - SEC-017: Audit logging for all operations
   * - DB-006: TENANT_ISOLATION - store_id validated in payload
   *
   * @param items - Shift opening sync queue items
   * @returns Batch response with per-item results
   */
  private async pushShiftOpeningBatch(items: SyncQueueItem[]): Promise<BatchSyncResponse> {
    const results: BatchSyncResponse['results'] = [];

    for (const item of items) {
      try {
        // API-001: Parse and validate payload structure
        const payload = JSON.parse(item.payload) as {
          shift_id: string;
          store_id: string;
          openings: Array<{
            bin_id: string;
            pack_id: string;
            opening_serial: string;
          }>;
          opened_at: string;
          opened_by: string | null;
        };

        // API-001: Validate required fields
        if (!payload.shift_id || !payload.store_id || !payload.openings || !payload.opened_at) {
          log.warn('Shift opening payload missing required fields', {
            shiftId: payload.shift_id,
            hasStoreId: Boolean(payload.store_id),
            hasOpenings: Boolean(payload.openings),
            hasOpenedAt: Boolean(payload.opened_at),
          });
          results.push({
            id: item.id,
            status: 'failed',
            error: 'Missing required fields in shift opening payload',
          });
          continue;
        }

        // Route to cloud API
        const response = await cloudApiService.pushShiftOpening({
          shift_id: payload.shift_id,
          store_id: payload.store_id,
          openings: payload.openings,
          opened_at: payload.opened_at,
          opened_by: payload.opened_by,
        });

        results.push({
          id: item.id,
          status: response.success ? 'synced' : 'failed',
          error: response.success ? undefined : 'Failed to sync shift opening',
        });

        // SEC-017: Audit log
        if (response.success) {
          log.info('Shift opening synced to cloud', {
            shiftId: payload.shift_id,
            openingsCount: payload.openings.length,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // ERR-002: Extract full response body from CloudApiError
        let apiContext: SyncApiContext | undefined;
        if (CloudApiError.isCloudApiError(error)) {
          apiContext = {
            api_endpoint: '/api/v1/sync/lottery/shift/open',
            http_status: error.httpStatus,
            response_body: error.getTruncatedResponseBody(2000),
          };
        }

        log.error('Failed to sync shift opening item', {
          itemId: item.id,
          entityId: item.entity_id,
          error: errorMessage,
          hasApiContext: Boolean(apiContext),
        });
        results.push({
          id: item.id, // Use queue item ID, not entity_id
          status: 'failed',
          error: errorMessage,
          apiContext,
        });
      }
    }

    return {
      success: results.every((r) => r.status === 'synced'),
      results,
    };
  }

  /**
   * Push shift closing items to cloud API
   *
   * Enterprise-grade shift closing sync implementation:
   * - API-001: Validates payload structure
   * - API-003: Returns per-item results for error handling
   * - SEC-006: Uses structured payload, no string concatenation
   * - SEC-017: Audit logging for all operations
   * - DB-006: TENANT_ISOLATION - store_id validated in payload
   *
   * @param items - Shift closing sync queue items
   * @returns Batch response with per-item results
   */
  private async pushShiftClosingBatch(items: SyncQueueItem[]): Promise<BatchSyncResponse> {
    const results: BatchSyncResponse['results'] = [];

    for (const item of items) {
      try {
        // API-001: Parse and validate payload structure
        const payload = JSON.parse(item.payload) as {
          shift_id: string;
          store_id: string;
          closings: Array<{
            bin_id: string;
            pack_id: string;
            closing_serial: string;
            tickets_sold: number;
            sales_amount: number;
          }>;
          closed_at: string;
          closed_by: string | null;
        };

        // API-001: Validate required fields
        if (!payload.shift_id || !payload.store_id || !payload.closings || !payload.closed_at) {
          log.warn('Shift closing payload missing required fields', {
            shiftId: payload.shift_id,
            hasStoreId: Boolean(payload.store_id),
            hasClosings: Boolean(payload.closings),
            hasClosedAt: Boolean(payload.closed_at),
          });
          results.push({
            id: item.id,
            status: 'failed',
            error: 'Missing required fields in shift closing payload',
          });
          continue;
        }

        // Route to cloud API
        const response = await cloudApiService.pushShiftClosing({
          shift_id: payload.shift_id,
          store_id: payload.store_id,
          closings: payload.closings,
          closed_at: payload.closed_at,
          closed_by: payload.closed_by,
        });

        results.push({
          id: item.id,
          status: response.success ? 'synced' : 'failed',
          error: response.success ? undefined : 'Failed to sync shift closing',
        });

        // SEC-017: Audit log
        if (response.success) {
          const totalSales = payload.closings.reduce((sum, c) => sum + c.sales_amount, 0);
          log.info('Shift closing synced to cloud', {
            shiftId: payload.shift_id,
            closingsCount: payload.closings.length,
            totalSalesAmount: totalSales,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // ERR-002: Extract full response body from CloudApiError
        let apiContext: SyncApiContext | undefined;
        if (CloudApiError.isCloudApiError(error)) {
          apiContext = {
            api_endpoint: '/api/v1/sync/lottery/shift/close',
            http_status: error.httpStatus,
            response_body: error.getTruncatedResponseBody(2000),
          };
        }

        log.error('Failed to sync shift closing item', {
          itemId: item.id,
          entityId: item.entity_id,
          error: errorMessage,
          hasApiContext: Boolean(apiContext),
        });
        results.push({
          id: item.id, // Use queue item ID, not entity_id
          status: 'failed',
          error: errorMessage,
          apiContext,
        });
      }
    }

    return {
      success: results.every((r) => r.status === 'synced'),
      results,
    };
  }

  /**
   * Check if cloud API is reachable
   *
   * @returns true if online
   */
  private async checkOnline(): Promise<boolean> {
    if (!this.cloudApiService) {
      // Assume online when cloud API not configured
      return true;
    }

    try {
      // Use Promise.race for timeout
      const result = await Promise.race([
        this.cloudApiService.healthCheck(),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), HEALTH_CHECK_TIMEOUT_MS)
        ),
      ]);
      return result;
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // Phase 5: Heartbeat Methods
  // ==========================================================================

  /**
   * Start the heartbeat interval
   * Phase 5: Periodic heartbeat to verify API key status and keep session alive
   *
   * LM-002: Implements health monitoring per coding standards
   * API-002: Respects rate limiting via configurable interval
   */
  private startHeartbeat(): void {
    if (this.heartbeatIntervalId) {
      log.warn('Heartbeat already running');
      return;
    }

    log.info(`Starting heartbeat (interval: ${this.heartbeatIntervalMs / 1000}s)`);

    // Run heartbeat immediately, then on interval
    this.runHeartbeat().catch((err) => {
      log.error('Initial heartbeat failed', {
        error: err instanceof Error ? err.message : 'Unknown',
      });
    });

    this.heartbeatIntervalId = setInterval(() => {
      this.runHeartbeat().catch((err) => {
        log.error('Scheduled heartbeat failed', {
          error: err instanceof Error ? err.message : 'Unknown',
        });
      });
    }, this.heartbeatIntervalMs);
  }

  /**
   * Run a single heartbeat cycle
   * Phase 5: Sends heartbeat to cloud and processes response
   *
   * Enterprise-grade implementation:
   * - LM-001: Structured logging with timestamps
   * - LM-002: Updates server time for monitoring
   * - LICENSE: Handles suspended/revoked status
   * - API-003: Sanitized error handling
   */
  private async runHeartbeat(): Promise<void> {
    if (!this.cloudApiService) {
      log.debug('Heartbeat skipped: Cloud API service not configured');
      return;
    }

    // Skip if offline (determined by health check in runSync)
    if (!this.isOnline) {
      log.debug('Heartbeat skipped: Offline');
      return;
    }

    log.debug('Running heartbeat');

    try {
      // Use Promise.race for timeout
      const response = await Promise.race([
        this.cloudApiService.heartbeat(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Heartbeat timeout')), HEARTBEAT_TIMEOUT_MS)
        ),
      ]);

      // Update heartbeat state
      this.lastHeartbeatAt = new Date();
      this.lastHeartbeatStatus = response.status;
      this.lastServerTime = response.serverTime;

      // LM-001: Log successful heartbeat
      log.debug('Heartbeat successful', {
        status: response.status,
        serverTime: response.serverTime,
      });

      this.notifyStatusChange();
    } catch (error) {
      // Update heartbeat state on failure
      this.lastHeartbeatAt = new Date();
      this.lastHeartbeatStatus = 'failed';

      // LM-001: Log heartbeat failure (error details server-side only)
      log.error('Heartbeat failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // If status is suspended/revoked, stop the heartbeat
      // The license service will handle blocking operations
      const errorMsg = error instanceof Error ? error.message.toLowerCase() : '';
      if (errorMsg.includes('suspended')) {
        this.lastHeartbeatStatus = 'suspended';
        log.warn('API key suspended, stopping heartbeat');
        this.stopHeartbeat();
      } else if (errorMsg.includes('revoked')) {
        this.lastHeartbeatStatus = 'revoked';
        log.warn('API key revoked, stopping heartbeat');
        this.stopHeartbeat();
      }

      this.notifyStatusChange();
    }
  }

  /**
   * Stop the heartbeat interval
   * Phase 5: Gracefully stops heartbeat without affecting sync
   */
  private stopHeartbeat(): void {
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
      log.info('Heartbeat stopped');
    }
  }

  /**
   * Trigger an immediate heartbeat (manual trigger)
   * Phase 5: Allows manual heartbeat verification
   *
   * @returns Promise that resolves when heartbeat completes
   */
  async triggerHeartbeat(): Promise<void> {
    await this.runHeartbeat();
  }

  /**
   * Get the last server time from heartbeat
   * Phase 5: Useful for clock synchronization
   *
   * @returns Last known server time or null if no heartbeat received
   */
  getLastServerTime(): string | null {
    return this.lastServerTime;
  }

  /**
   * Update pending count from database
   */
  private updatePendingCount(): void {
    const store = storesDAL.getConfiguredStore();
    if (store) {
      this.pendingCount = syncQueueDAL.getPendingCount(store.store_id);
    }
  }

  /**
   * Extract HTTP status code from error message
   * v040: Parses error messages for status codes like "404", "409 DUPLICATE_PACK", etc.
   *
   * @param message - Error message that may contain HTTP status
   * @returns HTTP status code or 0 if not found
   */
  private extractHttpStatusFromError(message: string): number {
    // Look for common HTTP status patterns in error messages
    const statusMatch = message.match(/\b(4\d{2}|5\d{2})\b/);
    if (statusMatch) {
      return parseInt(statusMatch[1], 10);
    }
    // Check for common error keywords
    if (message.includes('ECONNREFUSED') || message.includes('ENETUNREACH')) return 0;
    if (message.includes('timeout') || message.includes('ETIMEDOUT')) return 408;
    return 0;
  }

  /**
   * Get API endpoint path for an entity type
   * v040: Maps entity types to their API endpoints for troubleshooting display
   *
   * @param entityType - Entity type being synced
   * @returns API endpoint path
   */
  private getEndpointForEntityType(entityType: string): string {
    const endpointMap: Record<string, string> = {
      pack: '/api/v1/sync/lottery/packs',
      shift_opening: '/api/v1/sync/shifts/openings',
      shift_closing: '/api/v1/sync/shifts/closings',
      day_open: '/api/v1/sync/lottery/day/open',
      day_close: '/api/v1/sync/day-close',
      variance_approval: '/api/v1/sync/variances/approve',
      employee: '/api/v1/sync/employees',
    };
    return endpointMap[entityType] || `/api/v1/sync/${entityType}`;
  }

  /**
   * Get the actual API endpoint for a pack operation based on operation type and pack status
   * v040: Returns the specific endpoint that was/would be called for accurate error display
   *
   * @param operation - The sync operation (CREATE, UPDATE, ACTIVATE, DELETE)
   * @param status - The pack status (RECEIVED, ACTIVE, DEPLETED, RETURNED)
   * @returns The actual API endpoint path
   */
  private getPackEndpoint(operation: string, status?: string): string {
    if (operation === 'CREATE') {
      return '/api/v1/sync/lottery/packs/receive';
    }
    if (operation === 'ACTIVATE') {
      return '/api/v1/sync/lottery/packs/activate';
    }
    if (operation === 'UPDATE' && status) {
      switch (status) {
        case 'ACTIVE':
          return '/api/v1/sync/lottery/packs/activate';
        case 'DEPLETED':
          return '/api/v1/sync/lottery/packs/deplete';
        case 'RETURNED':
          return '/api/v1/sync/lottery/packs/return';
        default:
          return '/api/v1/sync/lottery/packs';
      }
    }
    return '/api/v1/sync/lottery/packs';
  }

  /**
   * Sanitize error message for UI display
   * API-003: Remove internal details, stack traces, and sensitive information
   *
   * @param message - Raw error message
   * @returns Sanitized user-friendly message
   */
  private sanitizeErrorMessage(message: string): string {
    // Map of internal error patterns to user-friendly messages
    const errorMappings: Array<{ pattern: RegExp; replacement: string }> = [
      { pattern: /ECONNREFUSED/i, replacement: 'Unable to connect to cloud service' },
      { pattern: /ETIMEDOUT/i, replacement: 'Connection timed out' },
      { pattern: /ENOTFOUND/i, replacement: 'Cloud service not reachable' },
      { pattern: /ENETUNREACH/i, replacement: 'Network unreachable' },
      { pattern: /ECONNRESET/i, replacement: 'Connection was reset' },
      { pattern: /401|unauthorized/i, replacement: 'Authentication failed' },
      { pattern: /403|forbidden/i, replacement: 'Access denied' },
      { pattern: /404|not found/i, replacement: 'Resource not found' },
      { pattern: /429|rate limit/i, replacement: 'Too many requests - please wait' },
      { pattern: /500|internal server/i, replacement: 'Cloud service error' },
      { pattern: /502|bad gateway/i, replacement: 'Cloud service temporarily unavailable' },
      { pattern: /503|service unavailable/i, replacement: 'Cloud service is down' },
      { pattern: /socket hang up/i, replacement: 'Connection interrupted' },
      { pattern: /certificate/i, replacement: 'Security certificate error' },
    ];

    // Check each pattern
    for (const { pattern, replacement } of errorMappings) {
      if (pattern.test(message)) {
        return replacement;
      }
    }

    // If no pattern matched, return a generic message
    // SEC-017: Never expose raw error messages that might contain sensitive info
    if (message.length > 100 || message.includes('at ') || message.includes('Error:')) {
      return 'Sync operation failed';
    }

    // Return truncated message if it seems safe
    return message.slice(0, 50);
  }

  /**
   * Log detailed queue diagnostics to help debug stuck items
   * Called at startup to diagnose sync queue issues
   */
  private logQueueDiagnostics(): void {
    try {
      const store = storesDAL.getConfiguredStore();
      if (!store) {
        log.warn('Cannot log queue diagnostics: Store not configured');
        return;
      }

      const pendingCount = syncQueueDAL.getPendingCount(store.store_id);
      const failedCount = syncQueueDAL.getFailedCount(store.store_id);
      const retryableItems = syncQueueDAL.getRetryableItems(store.store_id, 10);
      const inBackoff = pendingCount - failedCount - retryableItems.length;

      // AUTO-RESET: If most items are stuck (in backoff or failed), reset them all
      if (pendingCount > 10 && (inBackoff > pendingCount * 0.5 || failedCount > 0)) {
        const resetCount = syncQueueDAL.resetAllPending(store.store_id);
        log.info('Auto-reset pending items to clear backoff', {
          storeId: store.store_id,
          resetCount,
        });
        // Immediately broadcast status change after auto-reset
        // This ensures UI reflects the reset state at startup
        this.updatePendingCount();
        this.notifyStatusChange();
      }

      // Log via structured logger
      log.info('Queue diagnostics', {
        storeId: store.store_id,
        pendingCount,
        failedCount,
        retryableCount: retryableItems.length,
        inBackoff,
      });
    } catch (error) {
      log.error('Failed to log queue diagnostics', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Clean up stale running syncs from previous session
   */
  private cleanupStaleRunning(): void {
    try {
      const store = storesDAL.getConfiguredStore();
      if (store) {
        syncLogDAL.cleanupStaleRunning(store.store_id, 30);
      }
    } catch (error) {
      log.warn('Failed to cleanup stale running syncs', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Clean up stale PULL tracking items from previous sessions
   *
   * PULL tracking items are created each time a PULL operation runs with unique
   * entity_ids. If previous sessions had failed PULLs or the app crashed, these
   * items accumulate and appear as stuck "pending" items in the UI.
   *
   * This method:
   * 1. Dead-letters ALL PULL items with sync_attempts >= 1 (they already failed)
   * 2. Deletes old PULL items with sync_attempts = 0 (never tried, stale)
   *
   * Business rule: Users, Bins, Games PULL sync items should immediately
   * go to DLQ on any error (no retry attempts).
   */
  private cleanupStalePullTrackingAtStartup(): void {
    try {
      const store = storesDAL.getConfiguredStore();
      if (!store) return;

      const storeId = store.store_id;

      // CRITICAL FIX: Dead-letter ALL PULL items with sync_attempts >= 1
      // These are items that already failed but weren't dead-lettered
      // (from before the DLQ fix was implemented)
      const pullItemsToDeadLetter = syncQueueDAL.getPullItemsWithAttempts(storeId);

      if (pullItemsToDeadLetter.length > 0) {
        log.info('Found PULL items with attempts to dead-letter at startup', {
          storeId,
          count: pullItemsToDeadLetter.length,
          items: pullItemsToDeadLetter.map((item) => ({
            id: item.id,
            entity_type: item.entity_type,
            entity_id: item.entity_id,
            sync_attempts: item.sync_attempts,
          })),
        });

        const dlqParams = pullItemsToDeadLetter.map((item) => ({
          id: item.id,
          reason: 'MAX_ATTEMPTS_EXCEEDED' as DeadLetterReason,
          errorCategory: (item.error_category || 'UNKNOWN') as ErrorCategory,
          error: item.last_sync_error || 'PULL item dead-lettered at startup',
        }));

        const deadLetteredCount = syncQueueDAL.deadLetterMany(dlqParams);
        log.warn('Dead-lettered PULL items at startup (no retries for PULL sync)', {
          storeId,
          requested: pullItemsToDeadLetter.length,
          deadLettered: deadLetteredCount,
        });
      }

      // Also clean up stale PULL items with 0 attempts (never tried, just cruft)
      const deleted = syncQueueDAL.cleanupAllStalePullTracking(storeId, 10);
      if (deleted > 0) {
        log.info('Cleaned up stale PULL tracking items at startup', {
          storeId,
          deletedCount: deleted,
        });
      }
    } catch (error) {
      log.warn('Failed to cleanup stale PULL tracking items', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Broadcast status change to all renderer windows
   * SEC-017: Sanitized status data only
   */
  private notifyStatusChange(): void {
    const status = this.getStatus();

    try {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(SYNC_STATUS_CHANNEL, status);
        }
      });
    } catch (error) {
      log.debug('Failed to notify windows of status change', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
  }

  /**
   * Perform queue cleanup (maintenance operation)
   * Should be called periodically (e.g., daily)
   *
   * @param olderThanDays - Delete synced items older than this many days
   * @returns Number of items cleaned up
   */
  cleanupQueue(olderThanDays: number = 7): number {
    log.info('Running queue cleanup', { olderThanDays });
    return syncQueueDAL.cleanupSynced(olderThanDays);
  }

  // ==========================================================================
  // Phase 3: Day Close Sync Methods
  // ==========================================================================

  /**
   * Push day close items to cloud API (two-phase commit)
   *
   * Enterprise-grade day close sync implementation:
   * - API-001: Validates payload structure
   * - API-003: Returns per-item results for error handling
   * - SEC-006: Uses structured payload, no string concatenation
   * - SEC-017: Audit logging for all operations
   * - DB-006: TENANT_ISOLATION - store_id validated in payload
   *
   * Handles the two-phase commit pattern:
   * 1. PREPARE: Validates inventory and gets validation token
   * 2. COMMIT: Finalizes day close with token
   * 3. CANCEL: Rolls back if commit fails
   *
   * @param items - Day close sync queue items
   * @returns Batch response with per-item results
   */
  private async pushDayCloseBatch(items: SyncQueueItem[]): Promise<BatchSyncResponse> {
    const results: BatchSyncResponse['results'] = [];

    for (const item of items) {
      try {
        // API-001: Parse and validate payload structure
        // Per replica_end_points.md: day_id is the primary identifier (not store_id + business_date)
        const payload = JSON.parse(item.payload) as {
          operation_type: 'PREPARE' | 'COMMIT' | 'CANCEL';
          day_id: string;
          store_id: string; // Keep for logging and queue operations
          // For PREPARE operation (replica_end_points.md lines 2374-2386)
          closings?: Array<{
            pack_id: string;
            ending_serial: string;
            entry_method?: 'SCAN' | 'MANUAL';
            bin_id?: string;
          }>;
          initiated_by?: string;
          manual_entry_authorized_by?: string;
          expire_minutes?: number;
          // For COMMIT operation (replica_end_points.md lines 2415-2420)
          closed_by?: string;
          notes?: string;
          // For CANCEL operation (replica_end_points.md lines 2453-2458)
          cancelled_by?: string;
          reason?: string;
        };

        // API-001: Validate required fields - day_id is always required
        if (!payload.operation_type || !payload.day_id) {
          log.warn('Day close payload missing required fields', {
            hasOperationType: Boolean(payload.operation_type),
            hasDayId: Boolean(payload.day_id),
          });
          results.push({
            id: item.id,
            status: 'failed',
            error: 'Missing required fields in day close payload (operation_type, day_id)',
          });
          continue;
        }

        let success = false;

        switch (payload.operation_type) {
          case 'PREPARE': {
            // API-001: Validate PREPARE-specific fields per API contract
            if (!payload.closings || payload.closings.length === 0) {
              log.warn('Day close PREPARE missing required closings array', {
                dayId: payload.day_id,
                hasClosings: Boolean(payload.closings),
              });
              results.push({
                id: item.id,
                status: 'failed',
                error: 'Missing or empty closings array for PREPARE (min 1 item required)',
              });
              continue;
            }

            if (!payload.initiated_by) {
              log.warn('Day close PREPARE missing initiated_by', {
                dayId: payload.day_id,
              });
              results.push({
                id: item.id,
                status: 'failed',
                error: 'Missing initiated_by for PREPARE',
              });
              continue;
            }

            // API-001: Resolve cloud day_id before calling prepare-close
            // The cloud API requires day_id that exists on cloud with status OPEN.
            // Local day_id may not exist on cloud - we need to look up the cloud's day by business_date.
            let cloudDayId = payload.day_id;

            try {
              // Look up local day to get business_date
              const localDay = lotteryBusinessDaysDAL.findById(payload.day_id);
              if (localDay) {
                // Pull day-status from cloud for this business_date
                const cloudDayStatus = await cloudApiService.pullDayStatus(localDay.business_date);

                if (cloudDayStatus.dayStatus) {
                  // Cloud has a day for this date - use cloud's day_id
                  cloudDayId = cloudDayStatus.dayStatus.day_id;
                  log.info('Resolved cloud day_id for day close', {
                    localDayId: payload.day_id,
                    cloudDayId,
                    businessDate: localDay.business_date,
                    cloudStatus: cloudDayStatus.dayStatus.status,
                  });

                  // Verify cloud day is OPEN (required by API)
                  if (cloudDayStatus.dayStatus.status !== 'OPEN') {
                    log.warn('Cloud day is not OPEN - cannot prepare close', {
                      cloudDayId,
                      cloudStatus: cloudDayStatus.dayStatus.status,
                    });
                    results.push({
                      id: item.id,
                      status: 'failed',
                      error: `Cloud day has status ${cloudDayStatus.dayStatus.status}, expected OPEN`,
                    });
                    continue;
                  }
                } else {
                  // Cloud has no day for this date
                  log.warn('No day found on cloud for business_date', {
                    localDayId: payload.day_id,
                    businessDate: localDay.business_date,
                  });
                  results.push({
                    id: item.id,
                    status: 'failed',
                    error: `No business day found on cloud for date ${localDay.business_date}. Day must exist on cloud with status OPEN.`,
                  });
                  continue;
                }
              } else {
                log.warn('Local day not found for day close', {
                  dayId: payload.day_id,
                });
                results.push({
                  id: item.id,
                  status: 'failed',
                  error: `Local day not found: ${payload.day_id}`,
                });
                continue;
              }
            } catch (lookupError) {
              log.error('Failed to resolve cloud day_id', {
                localDayId: payload.day_id,
                error: lookupError instanceof Error ? lookupError.message : 'Unknown error',
              });
              results.push({
                id: item.id,
                status: 'failed',
                error: `Failed to resolve cloud day: ${lookupError instanceof Error ? lookupError.message : 'Unknown error'}`,
              });
              continue;
            }

            const prepareResponse = await cloudApiService.prepareDayClose({
              day_id: cloudDayId,
              closings: payload.closings,
              initiated_by: payload.initiated_by,
              manual_entry_authorized_by: payload.manual_entry_authorized_by,
              expire_minutes: payload.expire_minutes,
            });

            success = prepareResponse.success;

            // SEC-017: Log preparation result
            if (success) {
              log.info('Day close PREPARE synced', {
                dayId: prepareResponse.day_id,
                status: prepareResponse.status,
                closingsCount: payload.closings.length,
                hasWarnings: Boolean(prepareResponse.warnings?.length),
                expiresAt: prepareResponse.expires_at,
              });

              // Auto-queue COMMIT after successful PREPARE
              // The two-phase commit flow: PREPARE -> COMMIT
              // Use the cloud's day_id from the response (should match cloudDayId)
              try {
                const commitPayload = {
                  operation_type: 'COMMIT' as const,
                  day_id: prepareResponse.day_id, // Use cloud's day_id from response
                  store_id: payload.store_id,
                  closed_by: payload.closed_by || payload.initiated_by,
                };

                syncQueueDAL.enqueue({
                  store_id: payload.store_id,
                  entity_type: 'day_close',
                  entity_id: prepareResponse.day_id, // Use cloud's day_id
                  operation: 'UPDATE', // COMMIT is an update to the prepared close
                  payload: commitPayload,
                  priority: 2, // Higher priority - COMMIT should happen immediately
                  sync_direction: 'PUSH',
                });

                log.info('Day close COMMIT queued after successful PREPARE', {
                  cloudDayId: prepareResponse.day_id,
                  localDayId: payload.day_id,
                  entityId: item.entity_id,
                });
              } catch (queueError) {
                // Log but don't fail the PREPARE - it succeeded
                log.error('Failed to queue day close COMMIT after PREPARE', {
                  cloudDayId: prepareResponse.day_id,
                  localDayId: payload.day_id,
                  error: queueError instanceof Error ? queueError.message : 'Unknown error',
                });
              }
            }
            break;
          }

          case 'COMMIT': {
            // API-001: Validate COMMIT-specific fields per API contract
            if (!payload.closed_by) {
              log.warn('Day close COMMIT missing closed_by', {
                dayId: payload.day_id,
              });
              results.push({
                id: item.id,
                status: 'failed',
                error: 'Missing closed_by for COMMIT',
              });
              continue;
            }

            const commitResponse = await cloudApiService.commitDayClose({
              day_id: payload.day_id,
              closed_by: payload.closed_by,
              notes: payload.notes,
            });

            success = commitResponse.success;

            // SEC-017: Log with summary info
            if (success) {
              log.info('Day close COMMIT synced', {
                dayId: commitResponse.day_id,
                status: commitResponse.status,
                totalPacks: commitResponse.summary.total_packs,
                totalTicketsSold: commitResponse.summary.total_tickets_sold,
              });
            }
            break;
          }

          case 'CANCEL': {
            // API-001: Validate CANCEL-specific fields per API contract
            if (!payload.cancelled_by) {
              log.warn('Day close CANCEL missing cancelled_by', {
                dayId: payload.day_id,
              });
              results.push({
                id: item.id,
                status: 'failed',
                error: 'Missing cancelled_by for CANCEL',
              });
              continue;
            }

            const cancelResponse = await cloudApiService.cancelDayClose({
              day_id: payload.day_id,
              cancelled_by: payload.cancelled_by,
              reason: payload.reason,
            });

            success = cancelResponse.success;

            // SEC-017: Log cancellation
            if (success) {
              log.info('Day close CANCEL synced', {
                dayId: cancelResponse.day_id,
                status: cancelResponse.status,
                reason: payload.reason || 'No reason provided',
              });
            }
            break;
          }

          default:
            log.warn('Unknown day close operation type', {
              operationType: payload.operation_type,
            });
            results.push({
              id: item.id,
              status: 'failed',
              error: `Unknown operation type: ${payload.operation_type}`,
            });
            continue;
        }

        results.push({
          id: item.id,
          status: success ? 'synced' : 'failed',
          error: success ? undefined : `Failed to sync day close ${payload.operation_type}`,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // ERR-002: Extract full response body from CloudApiError
        let apiContext: SyncApiContext | undefined;
        if (CloudApiError.isCloudApiError(error)) {
          apiContext = {
            api_endpoint: '/api/v1/sync/lottery/day',
            http_status: error.httpStatus,
            response_body: error.getTruncatedResponseBody(2000),
          };
        }

        log.error('Failed to sync day close item', {
          itemId: item.id,
          entityId: item.entity_id,
          error: errorMessage,
          hasApiContext: Boolean(apiContext),
        });
        results.push({
          id: item.id, // Use queue item ID, not entity_id
          status: 'failed',
          error: errorMessage,
          apiContext,
        });
      }
    }

    return {
      success: results.every((r) => r.status === 'synced'),
      results,
    };
  }

  /**
   * Push day open items to cloud API
   *
   * Creates/opens a business day on the cloud. This MUST succeed before any
   * day_close sync can be processed, as the cloud requires an OPEN day to exist
   * before it can be closed.
   *
   * Enterprise-grade day open sync implementation:
   * - API-001: VALIDATION - Validates payload structure with required fields
   * - API-003: ERROR_HANDLING - Returns per-item results with error classification
   * - SEC-006: SQL_INJECTION - Uses structured payload, no string concatenation
   * - SEC-017: AUDIT - Logs sync events with non-sensitive data only
   * - DB-006: TENANT_ISOLATION - store_id validated in payload for multi-tenancy
   * - SEC-010: AUTHZ - opened_by optional (included when user session available)
   *
   * Idempotency:
   * The cloud API endpoint is idempotent. Sending the same day_id multiple times
   * will not create duplicate days. The response includes an `is_idempotent` flag
   * indicating if the day already existed.
   *
   * Priority:
   * day_open items should be queued with priority 2 (same as day_close) to ensure
   * they are processed before pack operations that might reference the day.
   *
   * @security SEC-006: No string concatenation with user input
   * @security DB-006: Tenant isolation via store_id in payload
   * @security SEC-017: Audit logging without sensitive data
   *
   * @param items - Day open sync queue items
   * @returns Batch response with per-item results
   */
  private async pushDayOpenBatch(items: SyncQueueItem[]): Promise<BatchSyncResponse> {
    const results: BatchSyncResponse['results'] = [];

    for (const item of items) {
      try {
        // API-001: Parse and validate payload structure
        // DayOpenSyncPayload interface per plan Task 3.2.3
        const payload = JSON.parse(item.payload) as {
          day_id: string;
          store_id: string;
          business_date: string;
          opened_by: string; // REQUIRED by cloud API - must have valid user UUID
          opened_at: string;
          notes?: string;
          local_id?: string;
          external_day_id?: string;
        };

        // API-001: Validate required fields - fail fast with clear errors
        // Note: No apiContext for validation failures (no API call made)
        if (!payload.day_id) {
          log.warn('Day open payload missing day_id', {
            itemId: item.id,
            entityId: item.entity_id,
          });
          results.push({
            id: item.id,
            status: 'failed',
            error: 'Missing required field: day_id',
          });
          continue;
        }

        if (!payload.store_id) {
          log.warn('Day open payload missing store_id (DB-006 violation)', {
            itemId: item.id,
            dayId: payload.day_id,
          });
          results.push({
            id: item.id,
            status: 'failed',
            error: 'Missing required field: store_id (tenant isolation required)',
          });
          continue;
        }

        if (!payload.business_date) {
          log.warn('Day open payload missing business_date', {
            itemId: item.id,
            dayId: payload.day_id,
          });
          results.push({
            id: item.id,
            status: 'failed',
            error: 'Missing required field: business_date',
          });
          continue;
        }

        // SEC-010: opened_by is REQUIRED by cloud API - validate it's present
        if (!payload.opened_by) {
          log.warn('Day open payload missing opened_by (SEC-010 violation)', {
            itemId: item.id,
            dayId: payload.day_id,
          });
          results.push({
            id: item.id,
            status: 'failed',
            error: 'Missing required field: opened_by (user identity required)',
          });
          continue;
        }

        if (!payload.opened_at) {
          log.warn('Day open payload missing opened_at', {
            itemId: item.id,
            dayId: payload.day_id,
          });
          results.push({
            id: item.id,
            status: 'failed',
            error: 'Missing required field: opened_at',
          });
          continue;
        }

        // SEC-006: Call cloud API with structured data (no string concatenation)
        // The pushDayOpen method performs additional validation (UUID format, date format, etc.)
        const response = await cloudApiService.pushDayOpen({
          day_id: payload.day_id,
          business_date: payload.business_date,
          opened_by: payload.opened_by,
          opened_at: payload.opened_at,
          notes: payload.notes,
          local_id: payload.local_id,
          external_day_id: payload.external_day_id,
        });

        // SEC-017: Audit log (non-sensitive data only)
        if (response.success) {
          log.info('Day open synced to cloud', {
            dayId: response.day_id,
            businessDate: payload.business_date,
            status: response.status,
            isIdempotent: response.is_idempotent,
            serverTime: response.server_time,
          });
        }

        results.push({
          id: item.id,
          cloudId: response.day_id,
          status: response.success ? 'synced' : 'failed',
          error: response.success ? undefined : 'Cloud API returned failure',
          apiContext: {
            api_endpoint: this.getEndpointForEntityType('day_open'),
            http_status: response.success ? 200 : 500,
            response_body: JSON.stringify({
              success: response.success,
              day_id: response.day_id,
              status: response.status,
              is_idempotent: response.is_idempotent,
            }),
          },
        });
      } catch (error) {
        // API-003: Centralized error handling with sanitized messages
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // ERR-002: Extract full response body from CloudApiError for dead letter storage
        let httpStatus: number | null = null;
        let apiContext: SyncApiContext | undefined;

        if (CloudApiError.isCloudApiError(error)) {
          httpStatus = error.httpStatus;
          apiContext = {
            api_endpoint: this.getEndpointForEntityType('day_open'),
            http_status: error.httpStatus,
            response_body: error.getTruncatedResponseBody(2000),
          };
        }

        // ERR-007/MQ-002: Classify error for retry logic
        const classification = classifyError(httpStatus, errorMessage);

        log.error('Failed to sync day open item', {
          itemId: item.id,
          entityId: item.entity_id,
          error: errorMessage,
          errorCategory: classification.category,
          hasApiContext: Boolean(apiContext),
        });

        results.push({
          id: item.id,
          status: 'failed',
          error: errorMessage,
          apiContext,
        });
      }
    }

    return {
      success: results.every((r) => r.status === 'synced'),
      results,
    };
  }

  /**
   * Push variance approval items to cloud API
   *
   * Enterprise-grade variance approval sync implementation:
   * - API-001: Validates payload structure
   * - API-003: Returns per-item results for error handling
   * - SEC-006: Uses structured payload, no string concatenation
   * - SEC-017: Audit logging for compliance (variance approvals are auditable events)
   * - DB-006: TENANT_ISOLATION - store_id validated in payload
   * - SEC-010: AUTHZ - approved_by required for audit trail
   *
   * @param items - Variance approval sync queue items
   * @returns Batch response with per-item results
   */
  private async pushVarianceApprovalBatch(items: SyncQueueItem[]): Promise<BatchSyncResponse> {
    const results: BatchSyncResponse['results'] = [];

    for (const item of items) {
      try {
        // API-001: Parse and validate payload structure
        const payload = JSON.parse(item.payload) as {
          store_id: string;
          variance_id: string;
          business_date: string;
          bin_id: string;
          pack_id: string;
          expected_serial: string;
          actual_serial: string;
          variance_type: 'SERIAL_MISMATCH' | 'MISSING_PACK' | 'EXTRA_PACK' | 'COUNT_MISMATCH';
          resolution: string;
          approved_by: string;
        };

        // API-001: Validate required fields
        if (
          !payload.store_id ||
          !payload.variance_id ||
          !payload.business_date ||
          !payload.approved_by ||
          !payload.resolution
        ) {
          log.warn('Variance approval payload missing required fields', {
            hasStoreId: Boolean(payload.store_id),
            hasVarianceId: Boolean(payload.variance_id),
            hasBusinessDate: Boolean(payload.business_date),
            hasApprovedBy: Boolean(payload.approved_by),
            hasResolution: Boolean(payload.resolution),
          });
          results.push({
            id: item.id,
            status: 'failed',
            error: 'Missing required fields in variance approval payload',
          });
          continue;
        }

        // Route to cloud API
        const response = await cloudApiService.approveVariance({
          store_id: payload.store_id,
          variance_id: payload.variance_id,
          business_date: payload.business_date,
          bin_id: payload.bin_id,
          pack_id: payload.pack_id,
          expected_serial: payload.expected_serial,
          actual_serial: payload.actual_serial,
          variance_type: payload.variance_type,
          resolution: payload.resolution,
          approved_by: payload.approved_by,
        });

        results.push({
          id: item.id,
          status: response.success ? 'synced' : 'failed',
          error: response.success ? undefined : 'Failed to sync variance approval',
        });

        // SEC-017: Audit log for compliance
        if (response.success) {
          log.info('Variance approval synced to cloud', {
            varianceId: payload.variance_id,
            varianceType: payload.variance_type,
            approvedBy: payload.approved_by,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // ERR-002: Extract full response body from CloudApiError
        let apiContext: SyncApiContext | undefined;
        if (CloudApiError.isCloudApiError(error)) {
          apiContext = {
            api_endpoint: '/api/v1/sync/lottery/variances/approve',
            http_status: error.httpStatus,
            response_body: error.getTruncatedResponseBody(2000),
          };
        }

        log.error('Failed to sync variance approval item', {
          itemId: item.id,
          entityId: item.entity_id,
          error: errorMessage,
          hasApiContext: Boolean(apiContext),
        });
        results.push({
          id: item.id, // Use queue item ID, not entity_id
          status: 'failed',
          error: errorMessage,
          apiContext,
        });
      }
    }

    return {
      success: results.every((r) => r.status === 'synced'),
      results,
    };
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for sync engine
 */
export const syncEngineService = new SyncEngineService();
