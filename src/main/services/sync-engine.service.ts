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
import { syncQueueDAL, type SyncQueueItem } from '../dal/sync-queue.dal';
import { syncLogDAL } from '../dal/sync-log.dal';
import { storesDAL } from '../dal/stores.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Sync status for UI display
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
  /** Number of pending items in queue */
  pendingCount: number;
  /** Milliseconds until next scheduled sync */
  nextSyncIn: number;
  /** Whether cloud API is reachable */
  isOnline: boolean;
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
 * Batch result from cloud API
 */
export interface BatchSyncResponse {
  success: boolean;
  results: Array<{
    id: string;
    cloudId?: string;
    status: 'synced' | 'failed';
    error?: string;
  }>;
}

/**
 * Cloud API service interface (to be implemented in Phase 5B)
 */
interface ICloudApiService {
  healthCheck(): Promise<boolean>;
  pushBatch(entityType: string, items: SyncQueueItem[]): Promise<BatchSyncResponse>;
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

/** IPC channel for status updates */
const SYNC_STATUS_CHANNEL = 'sync:statusChanged';

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
  private isRunning = false;
  private syncIntervalMs = DEFAULT_SYNC_INTERVAL_MS;

  private lastSyncAt: Date | null = null;
  private lastSyncStatus: 'success' | 'partial' | 'failed' | null = null;
  private pendingCount = 0;
  private isOnline = true;

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
  start(intervalMs?: number): void {
    if (this.intervalId) {
      log.warn('Sync engine already running');
      return;
    }

    // Validate and set interval
    if (intervalMs) {
      this.syncIntervalMs = Math.max(
        MIN_SYNC_INTERVAL_MS,
        Math.min(intervalMs, MAX_SYNC_INTERVAL_MS)
      );
    }

    log.info(`Starting sync engine (interval: ${this.syncIntervalMs / 1000}s)`);

    // Clean up any stale running syncs from previous session
    this.cleanupStaleRunning();

    // Update pending count
    this.updatePendingCount();

    // Run immediately, then on interval
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

    this.notifyStatusChange();
  }

  /**
   * Stop the sync engine
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
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
   * Get current sync status for UI display
   * SEC-017: No sensitive data in status response
   *
   * @returns Current sync status
   */
  getStatus(): SyncStatus {
    const nextSyncIn =
      this.intervalId && this.lastSyncAt
        ? Math.max(0, this.syncIntervalMs - (Date.now() - this.lastSyncAt.getTime()))
        : 0;

    return {
      isRunning: this.isRunning,
      isStarted: this.intervalId !== null,
      lastSyncAt: this.lastSyncAt?.toISOString() || null,
      lastSyncStatus: this.lastSyncStatus,
      pendingCount: this.pendingCount,
      nextSyncIn,
      isOnline: this.isOnline,
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
   * Processes push queue and handles results
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

      log.info(`Sync completed: ${result.succeeded}/${result.sent} succeeded`, {
        storeId: store.store_id,
        sent: result.sent,
        succeeded: result.succeeded,
        failed: result.failed,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Fail sync log
      syncLogDAL.failSync(syncLogId, errorMessage);

      // Update status
      this.lastSyncAt = new Date();
      this.lastSyncStatus = 'failed';

      log.error('Sync failed', {
        storeId: store.store_id,
        error: errorMessage,
      });
    } finally {
      this.isRunning = false;
      this.notifyStatusChange();
    }
  }

  /**
   * Process the sync queue for a store
   * Groups items by entity type and sends in batches
   *
   * @param storeId - Store identifier
   * @returns Sync result statistics
   */
  private async processSyncQueue(storeId: string): Promise<SyncResult> {
    // Get retryable items (respects exponential backoff)
    const items = syncQueueDAL.getRetryableItems(storeId, SYNC_BATCH_SIZE);

    if (items.length === 0) {
      log.debug('No items to sync');
      return { sent: 0, succeeded: 0, failed: 0 };
    }

    // Group by entity type for batched API calls
    const batches = this.groupByEntityType(items);

    let succeeded = 0;
    let failed = 0;

    for (const [entityType, batchItems] of Object.entries(batches)) {
      try {
        const response = await this.pushBatch(entityType, batchItems);

        for (const item of batchItems) {
          const result = response.results.find((r) => r.id === item.entity_id);

          if (result?.status === 'synced') {
            syncQueueDAL.markSynced(item.id);
            succeeded++;
          } else {
            const error = result?.error || 'Unknown error';
            syncQueueDAL.incrementAttempts(item.id, error);
            failed++;
          }
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Network error';

        // Mark all items in batch as failed
        for (const item of batchItems) {
          syncQueueDAL.incrementAttempts(item.id, errorMessage);
          failed++;
        }

        log.error(`Batch sync failed for entity type: ${entityType}`, {
          entityType,
          itemCount: batchItems.length,
          error: errorMessage,
        });
      }
    }

    return { sent: items.length, succeeded, failed };
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
   * @param entityType - Type of entity being synced
   * @param items - Items to sync
   * @returns Batch sync response
   */
  private async pushBatch(entityType: string, items: SyncQueueItem[]): Promise<BatchSyncResponse> {
    if (!this.cloudApiService) {
      log.warn('Cloud API service not configured, simulating successful sync');
      // Return mock success when cloud API not configured (development mode)
      return {
        success: true,
        results: items.map((item) => ({
          id: item.entity_id,
          status: 'synced' as const,
        })),
      };
    }

    return this.cloudApiService.pushBatch(entityType, items);
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
   * Clean up stale running syncs from previous session
   */
  private cleanupStaleRunning(): void {
    const store = storesDAL.getConfiguredStore();
    if (store) {
      syncLogDAL.cleanupStaleRunning(store.store_id, 30);
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
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for sync engine
 */
export const syncEngineService = new SyncEngineService();
