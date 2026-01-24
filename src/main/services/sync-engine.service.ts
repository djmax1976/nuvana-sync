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
import { syncQueueDAL, type SyncQueueItem, type SyncApiContext } from '../dal/sync-queue.dal';
import { syncLogDAL } from '../dal/sync-log.dal';
import { storesDAL } from '../dal/stores.dal';
import { lotteryGamesDAL } from '../dal/lottery-games.dal';
import { lotteryPacksDAL } from '../dal/lottery-packs.dal';
import { createLogger } from '../utils/logger';
import { cloudApiService } from './cloud-api.service';
import {
  bidirectionalSyncService,
  type BidirectionalSyncResult,
} from './bidirectional-sync.service';

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

    // Auto-reset failed items so they can be retried
    // This ensures items that exceeded max_attempts get another chance
    const failedCount = syncQueueDAL.getFailedCount(storeId);
    if (failedCount > 0) {
      const failedItems = syncQueueDAL.getFailedItems(storeId, 100);
      if (failedItems.length > 0) {
        const failedIds = failedItems.map((item) => item.id);
        syncQueueDAL.retryFailed(failedIds);
        log.info('Auto-reset failed items for retry', {
          storeId,
          count: failedIds.length,
        });
        // Immediately broadcast status change after auto-reset
        // This ensures UI reflects the reset state before items are retried
        // Fixes discrepancy where sidebar shows stale failedCount
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
            // v040: Pass API context for troubleshooting display
            syncQueueDAL.incrementAttempts(item.id, error, result?.apiContext);
            failed++;
            this.currentProgress.failedItems = failed;
            // Track error for display
            this.addRecentError(entityType, this.sanitizeErrorMessage(error));
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

        // v040: Extract HTTP status from error message if available
        const httpStatus = this.extractHttpStatusFromError(errorMessage);
        const batchApiContext: SyncApiContext = {
          api_endpoint: this.getEndpointForEntityType(entityType),
          http_status: httpStatus,
          response_body: errorMessage.substring(0, 500),
        };

        // Mark all items in batch as failed with API context
        for (const item of batchItems) {
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

    // Employee entity type - PULL-ONLY per API specification
    // Cloud API only supports GET /api/v1/sync/employees (no POST endpoint)
    // Employees are cloud-managed: created in portal, pulled to local for offline auth
    // If employee items reach this code path, they are legacy queue items - mark as synced
    if (entityType === 'employee') {
      log.info('Employee sync skipped - employees are cloud-managed (pull only per API spec)', {
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

    // Route shift_opening entity type to specialized endpoint
    if (entityType === 'shift_opening') {
      return this.pushShiftOpeningBatch(items);
    }

    // Route shift_closing entity type to specialized endpoint
    if (entityType === 'shift_closing') {
      return this.pushShiftClosingBatch(items);
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
          depletion_reason?: string | null;
          // Mark-sold at activation fields (only if pack was mark-sold at activation time)
          mark_sold_tickets?: number;
          mark_sold_reason?: string;
          mark_sold_approved_by?: string | null;
        };

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
          try {
            const response = await cloudApiService.pushPackReceive({
              pack_id: payload.pack_id,
              store_id: payload.store_id,
              game_id: payload.game_id,
              game_code: gameCode,
              pack_number: payload.pack_number,
              received_at: payload.received_at || new Date().toISOString(),
              received_by: payload.received_by,
            });

            // Store cloud_pack_id locally for future activate/deplete/return calls
            if (response.success && response.cloud_pack_id) {
              lotteryPacksDAL.updateCloudPackId(payload.pack_id, response.cloud_pack_id);
            }

            results.push({
              id: item.id, // Use queue item ID, not entity_id (supports multiple items per entity)
              cloudId: response.cloud_pack_id,
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

              // Try to extract cloud_pack_id from error response if available
              // Some APIs return the existing resource ID in conflict responses
              let cloudPackId: string | undefined;
              try {
                // Error message may contain JSON with existing pack details
                const jsonMatch = errorMessage.match(/\{.*\}/);
                if (jsonMatch) {
                  const errorData = JSON.parse(jsonMatch[0]);
                  cloudPackId =
                    errorData.cloud_pack_id || errorData.pack_id || errorData.data?.pack_id;
                }
              } catch {
                // Ignore JSON parse errors
              }

              // If we got a cloud_pack_id, store it locally
              if (cloudPackId) {
                lotteryPacksDAL.updateCloudPackId(payload.pack_id, cloudPackId);
                log.info('Stored cloud_pack_id from duplicate response', {
                  packId: payload.pack_id,
                  cloudPackId,
                });
              }

              results.push({
                id: item.id, // Use queue item ID, not entity_id
                cloudId: cloudPackId,
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

          // Look up the pack to get cloud_pack_id (required by API)
          const pack = lotteryPacksDAL.findById(payload.pack_id);
          if (!pack?.cloud_pack_id) {
            log.warn('Pack missing cloud_pack_id, cannot sync UPDATE', {
              packId: payload.pack_id,
              status: payload.status,
            });
            results.push({
              id: item.id,
              status: 'failed',
              error: 'Pack not synced to cloud yet (missing cloud_pack_id)',
            });
            continue;
          }

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
                const activatePayload: Parameters<typeof cloudApiService.pushPackActivate>[0] = {
                  pack_id: pack.cloud_pack_id, // Use cloud ID, not local ID
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
                  local_id: payload.pack_id, // Send local ID for reference
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
              if (payload.closing_serial && payload.depleted_at) {
                const depleteResponse = await cloudApiService.pushPackDeplete({
                  pack_id: pack.cloud_pack_id, // Use cloud ID, not local ID
                  store_id: payload.store_id,
                  closing_serial: payload.closing_serial,
                  tickets_sold: payload.tickets_sold,
                  sales_amount: payload.sales_amount,
                  depleted_at: payload.depleted_at,
                  // v019: Include shift context for cloud audit trail
                  shift_id: payload.depleted_shift_id,
                  local_id: payload.pack_id, // Send local ID for reference
                });
                success = depleteResponse.success;
              } else {
                log.warn('Pack depletion missing required fields', {
                  packId: payload.pack_id,
                  hasClosingSerial: Boolean(payload.closing_serial),
                  hasDepletedAt: Boolean(payload.depleted_at),
                });
                success = false;
              }
              break;

            case 'RETURNED':
              // Pack was returned
              // v019 Schema Alignment: Now includes shift context for audit trail
              if (payload.returned_at) {
                const returnResponse = await cloudApiService.pushPackReturn({
                  pack_id: pack.cloud_pack_id, // Use cloud ID, not local ID
                  store_id: payload.store_id,
                  closing_serial: payload.closing_serial,
                  tickets_sold: payload.tickets_sold,
                  sales_amount: payload.sales_amount,
                  returned_at: payload.returned_at,
                  // v019: Include shift context for cloud audit trail
                  shift_id: payload.returned_shift_id,
                  local_id: payload.pack_id, // Send local ID for reference
                });
                success = returnResponse.success;
              } else {
                log.warn('Pack return missing required fields', {
                  packId: payload.pack_id,
                  hasReturnedAt: Boolean(payload.returned_at),
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
          });
        } else if (item.operation === 'ACTIVATE') {
          // Direct activation - calls POST /api/v1/sync/lottery/packs/activate
          // Per API spec, this endpoint handles create-and-activate in one call:
          // 1. Pack doesn't exist: Create it and activate
          // 2. Pack exists with RECEIVED status: Activate it
          // 3. Pack already ACTIVE in same bin: Idempotent success
          // This bypasses the cloud_pack_id requirement since we send pack_id directly

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
              });
            } catch (activateError) {
              const errorMsg =
                activateError instanceof Error ? activateError.message : String(activateError);
              log.error('Failed to activate pack', {
                packId: payload.pack_id,
                error: errorMsg,
              });
              results.push({
                id: item.id,
                status: 'failed',
                error: errorMsg,
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
        // v040: Extract HTTP status from error and include API context
        const httpStatus = this.extractHttpStatusFromError(errorMessage);
        results.push({
          id: item.id, // Use queue item ID, not entity_id
          status: 'failed',
          error: errorMessage,
          apiContext: {
            api_endpoint: '/api/v1/sync/lottery/packs',
            http_status: httpStatus,
            response_body: errorMessage.substring(0, 500),
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
        log.error('Failed to sync shift opening item', {
          itemId: item.id,
          entityId: item.entity_id,
          error: errorMessage,
        });
        results.push({
          id: item.id, // Use queue item ID, not entity_id
          status: 'failed',
          error: errorMessage,
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
        log.error('Failed to sync shift closing item', {
          itemId: item.id,
          entityId: item.entity_id,
          error: errorMessage,
        });
        results.push({
          id: item.id, // Use queue item ID, not entity_id
          status: 'failed',
          error: errorMessage,
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
      day_close: '/api/v1/sync/day-close',
      variance_approval: '/api/v1/sync/variances/approve',
      employee: '/api/v1/sync/employees',
    };
    return endpointMap[entityType] || `/api/v1/sync/${entityType}`;
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
        const payload = JSON.parse(item.payload) as {
          operation_type: 'PREPARE' | 'COMMIT' | 'CANCEL';
          store_id: string;
          business_date: string;
          // For PREPARE operation
          expected_inventory?: Array<{
            bin_id: string;
            pack_id: string;
            closing_serial: string;
          }>;
          prepared_by?: string | null;
          // For COMMIT operation
          validation_token?: string;
          closed_by?: string | null;
          // For CANCEL operation
          reason?: string | null;
          cancelled_by?: string | null;
        };

        // API-001: Validate required fields based on operation type
        if (!payload.operation_type || !payload.store_id) {
          log.warn('Day close payload missing required fields', {
            hasOperationType: Boolean(payload.operation_type),
            hasStoreId: Boolean(payload.store_id),
          });
          results.push({
            id: item.id,
            status: 'failed',
            error: 'Missing required fields in day close payload',
          });
          continue;
        }

        let success = false;

        switch (payload.operation_type) {
          case 'PREPARE': {
            // API-001: Validate PREPARE-specific fields
            if (!payload.business_date || !payload.expected_inventory) {
              log.warn('Day close PREPARE missing required fields', {
                hasBusinessDate: Boolean(payload.business_date),
                hasInventory: Boolean(payload.expected_inventory),
              });
              results.push({
                id: item.id,
                status: 'failed',
                error: 'Missing business_date or expected_inventory for PREPARE',
              });
              continue;
            }

            const prepareResponse = await cloudApiService.prepareDayClose({
              store_id: payload.store_id,
              business_date: payload.business_date,
              expected_inventory: payload.expected_inventory,
              prepared_by: payload.prepared_by || null,
            });

            success = prepareResponse.success;

            // SEC-017: Log with validation token info (not the token itself)
            if (success) {
              log.info('Day close PREPARE synced', {
                storeId: payload.store_id,
                businessDate: payload.business_date,
                inventoryCount: payload.expected_inventory.length,
                hasDiscrepancies: Boolean(prepareResponse.discrepancies?.length),
              });
            }
            break;
          }

          case 'COMMIT': {
            // API-001: Validate COMMIT-specific fields
            if (!payload.validation_token) {
              log.warn('Day close COMMIT missing validation token', {
                storeId: payload.store_id,
              });
              results.push({
                id: item.id,
                status: 'failed',
                error: 'Missing validation_token for COMMIT',
              });
              continue;
            }

            const commitResponse = await cloudApiService.commitDayClose({
              store_id: payload.store_id,
              validation_token: payload.validation_token,
              closed_by: payload.closed_by || null,
            });

            success = commitResponse.success;

            // SEC-017: Log with summary info
            if (success) {
              log.info('Day close COMMIT synced', {
                storeId: payload.store_id,
                daySummaryId: commitResponse.day_summary_id,
                totalSales: commitResponse.total_sales,
                totalTicketsSold: commitResponse.total_tickets_sold,
              });
            }
            break;
          }

          case 'CANCEL': {
            // API-001: Validate CANCEL-specific fields
            if (!payload.validation_token) {
              log.warn('Day close CANCEL missing validation token', {
                storeId: payload.store_id,
              });
              results.push({
                id: item.id,
                status: 'failed',
                error: 'Missing validation_token for CANCEL',
              });
              continue;
            }

            const cancelResponse = await cloudApiService.cancelDayClose({
              store_id: payload.store_id,
              validation_token: payload.validation_token,
              reason: payload.reason,
              cancelled_by: payload.cancelled_by || null,
            });

            success = cancelResponse.success;

            // SEC-017: Log cancellation
            if (success) {
              log.info('Day close CANCEL synced', {
                storeId: payload.store_id,
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
        log.error('Failed to sync day close item', {
          itemId: item.id,
          entityId: item.entity_id,
          error: errorMessage,
        });
        results.push({
          id: item.id, // Use queue item ID, not entity_id
          status: 'failed',
          error: errorMessage,
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
        log.error('Failed to sync variance approval item', {
          itemId: item.id,
          entityId: item.entity_id,
          error: errorMessage,
        });
        results.push({
          id: item.id, // Use queue item ID, not entity_id
          status: 'failed',
          error: errorMessage,
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
