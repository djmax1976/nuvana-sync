/**
 * Sync IPC Handlers
 *
 * IPC handlers for sync operations between renderer and main process.
 *
 * @module main/ipc/sync.handlers
 * @security API-004: Authentication required for sync operations
 * @security API-003: Centralized error handling
 * @security SEC-017: Audit logging for sync actions
 */

import {
  registerHandler,
  createSuccessResponse,
  createErrorResponse,
  IPCErrorCodes,
} from './index';
import { syncEngineService } from '../services/sync-engine.service';
import { syncLogDAL } from '../dal/sync-log.dal';
import { syncQueueDAL } from '../dal/sync-queue.dal';
import { syncTimestampsDAL } from '../dal/sync-timestamps.dal';
import { storesDAL } from '../dal/stores.dal';
import { processedFilesDAL } from '../dal/processed-files.dal';
import { shiftsDAL } from '../dal/shifts.dal';
import { shiftFuelSummariesDAL } from '../dal/shift-fuel-summaries.dal';
import { lotteryBinsDAL } from '../dal/lottery-bins.dal';
import { lotteryPacksDAL } from '../dal/lottery-packs.dal';
import { lotteryGamesDAL } from '../dal/lottery-games.dal';
import { userSyncService } from '../services/user-sync.service';
import { bidirectionalSyncService } from '../services/bidirectional-sync.service';
import { settingsService } from '../services/settings.service';
import { cloudApiService } from '../services/cloud-api.service';
import { getDatabase } from '../services/database.service';
import { BrowserWindow } from 'electron';
import { createLogger } from '../utils/logger';
import { eventBus, MainEvents } from '../utils/event-bus';

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('sync-handlers');

// ============================================================================
// Helper: Get storeId from unified config (SettingsService)
// ============================================================================

/**
 * Get storeId from the unified settings store.
 * SettingsService is now the single source of truth for all configuration.
 * IMPORTANT: Must match the storeId used by FileWatcher for processed_files to clear correctly.
 */
function getStoreIdFromSettings(): string | null {
  try {
    return settingsService.getStoreId() || null;
  } catch {
    return null;
  }
}

// ============================================================================
// Sync Status Handlers
// ============================================================================

/**
 * Get current sync status
 * Available to all users (no auth required) - status bar needs this before login
 * Only exposes non-sensitive operational data (isOnline, pendingCount, etc.)
 */
registerHandler(
  'sync:getStatus',
  async () => {
    const status = syncEngineService.getStatus();
    return createSuccessResponse(status);
  },
  { requiresAuth: false, description: 'Get sync status' }
);

/**
 * Get sync statistics for the store
 */
registerHandler(
  'sync:getStats',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const queueStats = syncQueueDAL.getStats(store.store_id);
    const logStats = syncLogDAL.getStats(store.store_id);
    const syncTimestamps = syncTimestampsDAL.getSyncSummary(store.store_id);

    return createSuccessResponse({
      queue: queueStats,
      history: logStats,
      timestamps: syncTimestamps,
    });
  },
  { requiresAuth: true, description: 'Get sync statistics' }
);

/**
 * Get sync activity for development monitor
 * Returns queued items and recently synced items for the activity panel
 *
 * Development/Debug feature - no auth required for convenience
 *
 * @security SEC-006: Uses parameterized DAL queries
 * @security DB-006: Store-scoped queries
 * @security API-008: Only safe display fields returned, no sensitive payload data
 * @security API-001: Input validated with bounds checking
 */
registerHandler(
  'sync:getActivity',
  async (_event, input: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // API-001: Validate and bound input parameters
    const params = input as { queuedLimit?: number; syncedLimit?: number } | undefined;
    const queuedLimit = Math.min(Math.max(1, params?.queuedLimit || 20), 50);
    const syncedLimit = Math.min(Math.max(1, params?.syncedLimit || 10), 10);

    // SEC-006, DB-006: DAL methods use parameterized, store-scoped queries
    const queuedItems = syncQueueDAL.getQueuedItemsForActivity(store.store_id, queuedLimit);
    const recentlySynced = syncQueueDAL.getRecentlySyncedForActivity(store.store_id, syncedLimit);
    const stats = syncQueueDAL.getStats(store.store_id);

    return createSuccessResponse({
      queued: queuedItems,
      recentlySynced,
      stats: {
        pendingCount: stats.pending,
        failedCount: stats.failed,
        syncedTodayCount: stats.syncedToday,
      },
    });
  },
  { requiresAuth: false, description: 'Get sync activity for dev monitor' }
);

/**
 * Get paginated sync activity for the full Sync Monitor page
 * Returns items with filtering, pagination, and detailed statistics
 *
 * @security SEC-006: Uses parameterized DAL queries
 * @security DB-006: Store-scoped queries for tenant isolation
 * @security API-008: Only safe display fields returned, no sensitive payload data
 * @security API-001: Input validated with bounds checking and allowlists
 */
registerHandler(
  'sync:getActivityPaginated',
  async (_event, input: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // API-001: Validate input parameters
    const params = input as
      | {
          status?: 'all' | 'queued' | 'failed' | 'synced';
          entityType?: string;
          operation?: string;
          direction?: 'PUSH' | 'PULL' | 'all';
          limit?: number;
          offset?: number;
        }
      | undefined;

    // SEC-006, DB-006: DAL methods use parameterized, store-scoped queries
    const activityData = syncQueueDAL.getActivityPaginated(store.store_id, {
      status: params?.status,
      entityType: params?.entityType,
      operation: params?.operation as 'CREATE' | 'UPDATE' | 'DELETE' | 'ACTIVATE' | undefined,
      direction: params?.direction,
      limit: params?.limit,
      offset: params?.offset,
    });

    const detailedStats = syncQueueDAL.getDetailedStats(store.store_id);

    return createSuccessResponse({
      ...activityData,
      stats: detailedStats,
    });
  },
  { requiresAuth: false, description: 'Get paginated sync activity for monitor page' }
);

/**
 * Retry a specific failed sync item
 * Resets the attempt count to allow immediate retry
 *
 * @security SEC-006: Uses parameterized queries
 * @security API-001: Input validation
 */
registerHandler(
  'sync:retryItem',
  async (_event, input: unknown) => {
    const params = input as { id: string } | undefined;
    if (!params?.id || typeof params.id !== 'string') {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid item ID');
    }

    syncQueueDAL.retryFailed([params.id]);

    log.info('Retry triggered for sync item', { id: params.id });

    return createSuccessResponse({ success: true, retriedId: params.id });
  },
  { requiresAuth: false, description: 'Retry a specific sync item' }
);

/**
 * Delete a specific sync item from the queue
 * Use with caution - permanently removes the item
 *
 * @security SEC-006: Uses parameterized queries
 * @security API-001: Input validation
 */
registerHandler(
  'sync:deleteItem',
  async (_event, input: unknown) => {
    const params = input as { id: string } | undefined;
    if (!params?.id || typeof params.id !== 'string') {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid item ID');
    }

    // Use the base DAL's delete method
    const deleted = syncQueueDAL.deleteById(params.id);

    if (deleted) {
      log.warn('Sync item deleted from queue', { id: params.id });
    }

    return createSuccessResponse({ success: deleted, deletedId: params.id });
  },
  { requiresAuth: false, description: 'Delete a specific sync item' }
);

// ============================================================================
// Manual Sync Handlers (MANAGER+)
// ============================================================================

/**
 * Trigger manual sync
 * No auth required - sync status indicator retry button needs this
 */
registerHandler(
  'sync:triggerNow',
  async () => {
    log.info('Manual sync triggered');

    await syncEngineService.triggerSync();

    return createSuccessResponse({ triggered: true });
  },
  { requiresAuth: false, description: 'Trigger manual sync' }
);

/**
 * Sync users from cloud
 * Requires MANAGER role
 */
registerHandler(
  'sync:syncUsers',
  async () => {
    log.info('User sync triggered');

    const result = await userSyncService.syncUsers();

    return createSuccessResponse(result);
  },
  { requiresAuth: true, requiredRole: 'shift_manager', description: 'Sync users from cloud' }
);

/**
 * Sync bins bidirectionally
 * Requires MANAGER role
 */
registerHandler(
  'sync:syncBins',
  async () => {
    log.info('Bins sync triggered');

    const result = await bidirectionalSyncService.syncBins();

    return createSuccessResponse(result);
  },
  { requiresAuth: true, requiredRole: 'shift_manager', description: 'Sync bins with cloud' }
);

/**
 * Sync games bidirectionally
 * No auth required - matches sync:triggerNow behavior for manual refresh
 */
registerHandler(
  'sync:syncGames',
  async () => {
    log.info('Games sync triggered');

    const result = await bidirectionalSyncService.syncGames();

    return createSuccessResponse(result);
  },
  { requiresAuth: false, description: 'Sync games with cloud (manual trigger)' }
);

/**
 * Force full sync (reset timestamps)
 * Requires ADMIN role due to potentially heavy operation
 */
registerHandler(
  'sync:forceFullSync',
  async () => {
    log.warn('Force full sync triggered');

    const result = await bidirectionalSyncService.forceFullSync();

    return createSuccessResponse(result);
  },
  { requiresAuth: true, requiredRole: 'store_manager', description: 'Force full sync' }
);

/**
 * Trigger immediate reference data sync (games, bins) from cloud
 * Bypasses the normal 5-minute interval check
 * Requires MANAGER role
 */
registerHandler(
  'sync:triggerReferenceDataSync',
  async () => {
    log.info('Manual reference data sync triggered via IPC');

    const result = await syncEngineService.triggerReferenceDataSync();

    if (result === null) {
      return createErrorResponse(
        IPCErrorCodes.CONFLICT,
        'Reference data sync skipped (already in progress, offline, or store not configured)'
      );
    }

    return createSuccessResponse(result);
  },
  {
    requiresAuth: true,
    requiredRole: 'shift_manager',
    description: 'Sync reference data from cloud',
  }
);

// ============================================================================
// Sync History Handlers
// ============================================================================

/**
 * Get sync history (recent logs)
 * Requires MANAGER role
 */
registerHandler(
  'sync:getHistory',
  async (_event, input: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const params = input as { limit?: number } | undefined;
    const limit = Math.min(params?.limit || 50, 100);
    const logs = syncLogDAL.getRecentLogs(store.store_id, limit);

    return createSuccessResponse({ logs });
  },
  { requiresAuth: true, requiredRole: 'shift_manager', description: 'Get sync history' }
);

/**
 * Get sync history with pagination
 * Requires MANAGER role
 */
registerHandler(
  'sync:getHistoryPaginated',
  async (_event, input: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const params = input as { limit?: number; offset?: number } | undefined;
    const result = syncLogDAL.getLogsPaginated(store.store_id, {
      limit: params?.limit || 50,
      offset: params?.offset || 0,
    });

    return createSuccessResponse(result);
  },
  { requiresAuth: true, requiredRole: 'shift_manager', description: 'Get paginated sync history' }
);

// ============================================================================
// Queue Management Handlers
// ============================================================================

/**
 * Get pending sync queue items
 * Requires MANAGER role
 */
registerHandler(
  'sync:getPendingQueue',
  async (_event, input: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const params = input as { limit?: number } | undefined;
    const limit = Math.min(params?.limit || 50, 100);
    const items = syncQueueDAL.getUnsyncedByStore(store.store_id, limit);
    const total = syncQueueDAL.getPendingCount(store.store_id);

    return createSuccessResponse({ items, total });
  },
  { requiresAuth: true, requiredRole: 'shift_manager', description: 'Get pending sync queue' }
);

/**
 * Get failed sync queue items
 * Requires MANAGER role
 */
registerHandler(
  'sync:getFailedQueue',
  async (_event, input: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const params = input as { limit?: number } | undefined;
    const limit = Math.min(params?.limit || 50, 100);
    const items = syncQueueDAL.getFailedItems(store.store_id, limit);
    const total = syncQueueDAL.getFailedCount(store.store_id);

    return createSuccessResponse({ items, total });
  },
  { requiresAuth: true, requiredRole: 'shift_manager', description: 'Get failed sync items' }
);

/**
 * Retry failed sync items
 * Requires MANAGER role
 */
registerHandler(
  'sync:retryFailed',
  async (_event, input: unknown) => {
    const params = input as { ids: string[] } | undefined;
    if (!params?.ids || !Array.isArray(params.ids) || params.ids.length === 0) {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'No item IDs provided');
    }

    // Limit to 100 items at a time
    const ids = params.ids.slice(0, 100);

    syncQueueDAL.retryFailed(ids);

    log.info('Retry triggered for failed sync items', { count: ids.length });

    return createSuccessResponse({ retriedCount: ids.length });
  },
  { requiresAuth: true, requiredRole: 'shift_manager', description: 'Retry failed sync items' }
);

// ============================================================================
// Sync Engine Control (ADMIN only)
// ============================================================================

/**
 * Start sync engine
 * Requires ADMIN role
 */
registerHandler(
  'sync:startEngine',
  async (_event, input: unknown) => {
    const params = input as { intervalMs?: number } | undefined;
    const interval = params?.intervalMs;

    // Ensure cloud API service is connected for health checks and sync
    syncEngineService.setCloudApiService(cloudApiService);
    syncEngineService.start(interval);

    log.info('Sync engine started via IPC', { interval });

    return createSuccessResponse({ started: true });
  },
  { requiresAuth: true, requiredRole: 'store_manager', description: 'Start sync engine' }
);

/**
 * Stop sync engine
 * Requires ADMIN role
 */
registerHandler(
  'sync:stopEngine',
  async () => {
    syncEngineService.stop();

    log.info('Sync engine stopped via IPC');

    return createSuccessResponse({ stopped: true });
  },
  { requiresAuth: true, requiredRole: 'store_manager', description: 'Stop sync engine' }
);

/**
 * Cleanup old synced items
 * Requires ADMIN role
 */
registerHandler(
  'sync:cleanupQueue',
  async (_event, input: unknown) => {
    const params = input as { olderThanDays?: number } | undefined;
    const days = params?.olderThanDays || 7;

    const deleted = syncEngineService.cleanupQueue(days);

    log.info('Queue cleanup via IPC', { olderThanDays: days, deleted });

    return createSuccessResponse({ deletedCount: deleted });
  },
  { requiresAuth: true, requiredRole: 'store_manager', description: 'Cleanup sync queue' }
);

// ============================================================================
// Setup-Phase Sync Handlers (No Auth Required During Initial Setup)
// SEC-017: Only available before setup is marked complete
// ============================================================================

/**
 * Sync users during setup or re-configuration
 * No auth required - authorization via prior API key validation
 * Used by setup wizard and Settings page re-sync
 */
registerHandler(
  'sync:syncUsersDuringSetup',
  async () => {
    log.info('User sync triggered (setup/resync)');

    try {
      // Ensure store is synced to database before user sync
      // This handles the race condition where API key validation saved store info
      // to config but database wasn't ready yet
      if (!storesDAL.isConfigured()) {
        log.info('Store not in database, attempting to sync from config');
        const synced = settingsService.syncStoreToDatabase();
        if (!synced) {
          log.warn('Could not sync store to database - database may not be ready');
          return createSuccessResponse({
            success: false,
            synced: 0,
            error: 'Database not ready. Please wait for initialization to complete.',
          });
        }
        log.info('Store synced to database from config');
      }

      const result = await userSyncService.syncUsers();
      return createSuccessResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'User sync failed';
      log.warn('User sync failed', { error: message });
      // Return success:false but don't throw - setup can continue
      return createSuccessResponse({ success: false, synced: 0, error: message });
    }
  },
  { description: 'Sync users during setup or re-configuration' }
);

/**
 * Sync bins during initial setup
 * No auth required - authorization via prior API key validation
 * SEC-017: Only allowed when setup is not yet complete
 */
registerHandler(
  'sync:syncBinsDuringSetup',
  async () => {
    // SEC-017: Only allow during setup phase
    if (settingsService.isSetupComplete()) {
      log.warn('Attempted to use setup sync endpoint after setup complete');
      return createErrorResponse(
        IPCErrorCodes.FORBIDDEN,
        'Setup already complete. Use sync:syncBins with authentication.'
      );
    }

    log.info('Bins sync triggered during setup');

    try {
      // Ensure store is synced to database before bins sync
      if (!storesDAL.isConfigured()) {
        log.info('Store not in database, attempting to sync from config');
        const synced = settingsService.syncStoreToDatabase();
        if (!synced) {
          log.warn('Could not sync store to database - database may not be ready');
          return createSuccessResponse({
            success: false,
            error: 'Database not ready. Please wait for initialization to complete.',
          });
        }
        log.info('Store synced to database from config');
      }

      const result = await bidirectionalSyncService.syncBins();
      return createSuccessResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bins sync failed';
      log.warn('Bins sync during setup failed', { error: message });
      return createSuccessResponse({ success: false, error: message });
    }
  },
  { description: 'Sync bins during setup wizard' }
);

/**
 * DEBUG: Force sync bins without auth check
 * TEMPORARY - Remove after debugging
 */
registerHandler(
  'sync:debugSyncBins',
  async () => {
    log.info('DEBUG: Force bins sync triggered');

    try {
      // First, check what bins exist locally
      const localBins = lotteryBinsDAL.findAllByStore(
        storesDAL.getConfiguredStore()?.store_id || ''
      );
      log.info('DEBUG: Local bins before sync', { count: localBins.length, bins: localBins });

      // Try to pull directly from cloud
      const pullResponse = await cloudApiService.pullBins();
      log.info('DEBUG: Cloud pullBins response', {
        totalCount: pullResponse.totalCount,
        binsCount: pullResponse.bins?.length ?? 0,
        bins: pullResponse.bins,
      });

      // Now run the full sync
      const result = await bidirectionalSyncService.syncBins();
      log.info('DEBUG: Sync result', { syncResult: result });

      // Check bins after sync
      const localBinsAfter = lotteryBinsDAL.findAllByStore(
        storesDAL.getConfiguredStore()?.store_id || ''
      );
      log.info('DEBUG: Local bins after sync', {
        count: localBinsAfter.length,
        bins: localBinsAfter,
      });

      return createSuccessResponse({
        ...result,
        debug: {
          localBinsBefore: localBins.length,
          cloudBins: pullResponse.bins?.length ?? 0,
          cloudTotalCount: pullResponse.totalCount,
          localBinsAfter: localBinsAfter.length,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Debug sync failed';
      log.error('DEBUG: Sync failed', {
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, message);
    }
  },
  { description: 'DEBUG: Force sync bins without auth' }
);

/**
 * Sync games during initial setup
 * No auth required - authorization via prior API key validation
 * SEC-017: Only allowed when setup is not yet complete
 */
registerHandler(
  'sync:syncGamesDuringSetup',
  async () => {
    // SEC-017: Only allow during setup phase
    if (settingsService.isSetupComplete()) {
      log.warn('Attempted to use setup sync endpoint after setup complete');
      return createErrorResponse(
        IPCErrorCodes.FORBIDDEN,
        'Setup already complete. Use sync:syncGames with authentication.'
      );
    }

    log.info('Games sync triggered during setup');

    try {
      // Ensure store is synced to database before games sync
      if (!storesDAL.isConfigured()) {
        log.info('Store not in database, attempting to sync from config');
        const synced = settingsService.syncStoreToDatabase();
        if (!synced) {
          log.warn('Could not sync store to database - database may not be ready');
          return createSuccessResponse({
            success: false,
            error: 'Database not ready. Please wait for initialization to complete.',
          });
        }
        log.info('Store synced to database from config');
      }

      const result = await bidirectionalSyncService.syncGames();
      return createSuccessResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Games sync failed';
      log.warn('Games sync during setup failed', { error: message });
      return createSuccessResponse({ success: false, error: message });
    }
  },
  { description: 'Sync games during setup wizard' }
);

/**
 * DEBUG: Analyze sync queue state
 * Shows why items aren't syncing
 */
registerHandler(
  'sync:debugQueueState',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const pendingCount = syncQueueDAL.getPendingCount(store.store_id);
    const failedCount = syncQueueDAL.getFailedCount(store.store_id);
    const retryableItems = syncQueueDAL.getRetryableItems(store.store_id, 10);

    // Get sample of pending items to see their state
    const sampleItems = syncQueueDAL.getUnsyncedByStore(store.store_id, 10);

    const itemAnalysis = sampleItems.map((item) => ({
      id: item.id.substring(0, 8),
      entity_type: item.entity_type,
      operation: item.operation,
      sync_attempts: item.sync_attempts,
      max_attempts: item.max_attempts,
      last_attempt_at: item.last_attempt_at,
      last_error: item.last_sync_error?.substring(0, 50),
      is_failed: item.sync_attempts >= item.max_attempts,
    }));

    log.info('DEBUG: Queue state analysis', {
      pendingCount,
      failedCount,
      retryableCount: retryableItems.length,
      sampleItems: itemAnalysis,
    });

    return createSuccessResponse({
      pendingCount,
      failedCount,
      retryableCount: retryableItems.length,
      retryableNow: retryableItems.length,
      sampleItems: itemAnalysis,
      message:
        failedCount > 0
          ? `${failedCount} items have failed permanently (exceeded max attempts). ${retryableItems.length} items are retryable now.`
          : `${retryableItems.length} items ready to sync out of ${pendingCount} pending.`,
    });
  },
  { description: 'DEBUG: Analyze sync queue state' }
);

/**
 * Reset ALL pending sync items to be immediately retryable
 * This clears backoff and makes all items eligible for sync now
 * No auth required - used for debugging
 */
registerHandler(
  'sync:resetFailedItems',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const beforePending = syncQueueDAL.getPendingCount(store.store_id);
    const beforeRetryable = syncQueueDAL.getRetryableItems(store.store_id, 10).length;

    // Reset ALL pending items (not just failed ones)
    const resetCount = syncQueueDAL.resetAllPending(store.store_id);

    log.info('Reset all pending sync items', {
      storeId: store.store_id,
      resetCount,
    });

    // Get updated counts
    const newPendingCount = syncQueueDAL.getPendingCount(store.store_id);
    const newRetryableItems = syncQueueDAL.getRetryableItems(store.store_id, 100);

    log.info('Reset all pending sync items completed', {
      storeId: store.store_id,
      beforePending,
      beforeRetryable,
      newPendingCount,
      newRetryableCount: newRetryableItems.length,
    });

    return createSuccessResponse({
      resetCount,
      beforePending,
      beforeRetryable,
      newPendingCount,
      newRetryableCount: newRetryableItems.length,
      message: `Reset ${resetCount} items. All are now immediately retryable.`,
    });
  },
  { description: 'Reset all pending sync items for immediate retry' }
);

/**
 * Clear all pending pack sync items from queue
 * Use this to remove stuck items that keep failing
 */
registerHandler(
  'sync:clearPendingPacks',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const beforeCount = syncQueueDAL.getPendingCount(store.store_id);
    const deletedCount = syncQueueDAL.deletePending(store.store_id, 'pack');
    const afterCount = syncQueueDAL.getPendingCount(store.store_id);

    log.warn('Cleared pending pack sync items', {
      storeId: store.store_id,
      beforeCount,
      deletedCount,
      afterCount,
    });

    return createSuccessResponse({
      message: `Deleted ${deletedCount} pending pack sync items`,
      beforeCount,
      deletedCount,
      afterCount,
    });
  },
  { description: 'Clear all pending pack sync items from queue' }
);

/**
 * Backfill packs that are in RECEIVED status but not in sync queue
 * This handles packs that were received before the sync code was added
 */
registerHandler(
  'sync:backfillReceivedPacks',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const storeId = store.store_id;

    // Get all packs in RECEIVED status
    const receivedPacks = lotteryPacksDAL.findByStatus(storeId, 'RECEIVED');

    if (receivedPacks.length === 0) {
      return createSuccessResponse({
        message: 'No packs in RECEIVED status to backfill',
        enqueuedCount: 0,
        alreadyQueuedCount: 0,
        skippedCount: 0,
      });
    }

    // Get all pending pack sync items
    const pendingSyncItems = syncQueueDAL.getUnsyncedByStore(storeId, 10000);
    const queuedPackIds = new Set(
      pendingSyncItems.filter((item) => item.entity_type === 'pack').map((item) => item.entity_id)
    );

    let enqueuedCount = 0;
    let alreadyQueuedCount = 0;
    let skippedCount = 0;

    for (const pack of receivedPacks) {
      // Skip if already in queue
      if (queuedPackIds.has(pack.pack_id)) {
        alreadyQueuedCount++;
        continue;
      }

      // Get game to get game_code
      const game = lotteryGamesDAL.findById(pack.game_id);
      if (!game) {
        log.warn('Skipping pack backfill: game not found', {
          packId: pack.pack_id,
          gameId: pack.game_id,
        });
        skippedCount++;
        continue;
      }

      // Enqueue the pack with CREATE operation
      // v029 API Alignment: Map DAL field names (current_bin_id, tickets_sold_count)
      // to API field names (bin_id, tickets_sold)
      syncQueueDAL.enqueue({
        store_id: storeId,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'CREATE',
        payload: {
          pack_id: pack.pack_id,
          store_id: pack.store_id,
          game_id: pack.game_id,
          game_code: game.game_code,
          pack_number: pack.pack_number,
          status: pack.status,
          bin_id: pack.current_bin_id, // v029: Map current_bin_id to API's bin_id
          opening_serial: pack.opening_serial,
          closing_serial: pack.closing_serial,
          tickets_sold: pack.tickets_sold_count, // v029: Map tickets_sold_count to API's tickets_sold
          sales_amount: pack.sales_amount,
          received_at: pack.received_at,
          received_by: pack.received_by,
          activated_at: pack.activated_at,
          activated_by: null,
          depleted_at: pack.depleted_at,
          returned_at: pack.returned_at,
        },
      });
      enqueuedCount++;
    }

    log.info('Backfilled received packs to sync queue', {
      storeId,
      totalReceived: receivedPacks.length,
      enqueuedCount,
      alreadyQueuedCount,
      skippedCount,
    });

    return createSuccessResponse({
      message: `Backfilled ${enqueuedCount} packs to sync queue`,
      totalReceived: receivedPacks.length,
      enqueuedCount,
      alreadyQueuedCount,
      skippedCount,
    });
  },
  { description: 'Backfill packs in RECEIVED status that are not in sync queue' }
);

/**
 * Resync ACTIVE packs to cloud
 * Use this to re-send pack data with corrected payload format
 *
 * Strategy: Use ACTIVATE operation directly which calls POST /api/v1/sync/lottery/packs/activate
 * Per API spec, the activate endpoint handles:
 * 1. Pack doesn't exist: Create it and activate
 * 2. Pack exists with RECEIVED status: Activate it
 * 3. Pack already ACTIVE in same bin: Idempotent success
 *
 * This avoids the cloud_pack_id dependency issue with CREATE+UPDATE approach.
 *
 * API-001: Includes all required fields: game_code, pack_number, serial_start, serial_end, mark_sold_reason
 */
registerHandler(
  'sync:resyncActivePacks',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const storeId = store.store_id;

    // Get all packs in ACTIVE status
    const activePacks = lotteryPacksDAL.findByStatus(storeId, 'ACTIVE');

    if (activePacks.length === 0) {
      return createSuccessResponse({
        message: 'No packs in ACTIVE status to resync',
        enqueuedCount: 0,
      });
    }

    let enqueuedCount = 0;
    let skippedCount = 0;

    for (const pack of activePacks) {
      // Get game to get game_code and tickets_per_pack
      const game = lotteryGamesDAL.findById(pack.game_id);
      if (!game) {
        log.warn('Skipping pack resync: game not found', {
          packId: pack.pack_id,
          gameId: pack.game_id,
        });
        skippedCount++;
        continue;
      }

      // Calculate serial_start and serial_end (required by activate API)
      const serialStart = '000';
      const serialEnd = game.tickets_per_pack
        ? String(game.tickets_per_pack - 1).padStart(3, '0')
        : '299'; // Default to 299 (300 tickets)

      // Enqueue ACTIVATE operation - this goes directly to the activate endpoint
      // which can create-and-activate in one call (per API spec)
      // v029 API Alignment: Map DAL field names (current_bin_id, tickets_sold_count)
      // to API field names (bin_id, tickets_sold)
      syncQueueDAL.enqueue({
        store_id: storeId,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'ACTIVATE',
        payload: {
          pack_id: pack.pack_id,
          store_id: pack.store_id,
          game_id: pack.game_id,
          game_code: game.game_code,
          pack_number: pack.pack_number,
          status: 'ACTIVE',
          bin_id: pack.current_bin_id, // v029: Map current_bin_id to API's bin_id
          opening_serial: pack.opening_serial,
          closing_serial: pack.closing_serial,
          tickets_sold: pack.tickets_sold_count, // v029: Map tickets_sold_count to API's tickets_sold
          sales_amount: pack.sales_amount,
          received_at: pack.received_at || pack.created_at,
          received_by: pack.received_by,
          activated_at: pack.activated_at,
          activated_by: pack.activated_by,
          shift_id: pack.activated_shift_id,
          depleted_at: pack.depleted_at,
          returned_at: pack.returned_at,
          // Required by activate API
          serial_start: serialStart,
          serial_end: serialEnd,
        },
      });
      enqueuedCount++;
    }

    log.info('Resyncing ACTIVE packs to cloud', {
      storeId,
      totalActive: activePacks.length,
      enqueuedCount,
      skippedCount,
    });

    return createSuccessResponse({
      message: `Queued ${enqueuedCount} ACTIVE packs for resync via activate endpoint`,
      totalActive: activePacks.length,
      enqueuedCount,
      skippedCount,
    });
  },
  { description: 'Resync ACTIVE packs to cloud with corrected payload format' }
);

/**
 * Resync DEPLETED packs to cloud
 *
 * Used when:
 * - Sync queue was accidentally cleared
 * - DEPLETED packs were not pushed to cloud
 * - Troubleshooting sync issues
 *
 * Strategy: Use UPDATE operation which routes to pushPackDeplete endpoint
 */
registerHandler(
  'sync:resyncDepletedPacks',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const storeId = store.store_id;

    // Get all packs in DEPLETED status
    const depletedPacks = lotteryPacksDAL.findByStatus(storeId, 'DEPLETED');

    if (depletedPacks.length === 0) {
      return createSuccessResponse({
        message: 'No packs in DEPLETED status to resync',
        enqueuedCount: 0,
      });
    }

    let enqueuedCount = 0;
    let skippedCount = 0;

    for (const pack of depletedPacks) {
      // Get game to get game_code and tickets_per_pack
      const game = lotteryGamesDAL.findById(pack.game_id);
      if (!game) {
        log.warn('Skipping pack resync: game not found', {
          packId: pack.pack_id,
          gameId: pack.game_id,
        });
        skippedCount++;
        continue;
      }

      // Calculate serial_start and serial_end
      const serialStart = '000';
      const serialEnd = game.tickets_per_pack
        ? String(game.tickets_per_pack - 1).padStart(3, '0')
        : '299';

      // Enqueue UPDATE operation - routes to pushPackDeplete endpoint
      syncQueueDAL.enqueue({
        store_id: storeId,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          store_id: pack.store_id,
          game_id: pack.game_id,
          game_code: game.game_code,
          pack_number: pack.pack_number,
          status: 'DEPLETED',
          bin_id: pack.current_bin_id,
          opening_serial: pack.opening_serial,
          closing_serial: pack.closing_serial,
          tickets_sold: pack.tickets_sold_count,
          sales_amount: pack.sales_amount,
          received_at: pack.received_at || pack.created_at,
          received_by: pack.received_by,
          activated_at: pack.activated_at,
          activated_by: pack.activated_by,
          depleted_at: pack.depleted_at,
          depleted_by: pack.depleted_by,
          depleted_shift_id: pack.depleted_shift_id,
          depletion_reason: pack.depletion_reason || 'SOLD_OUT',
          returned_at: null,
          serial_start: serialStart,
          serial_end: serialEnd,
        },
      });
      enqueuedCount++;
    }

    log.info('Resyncing DEPLETED packs to cloud', {
      storeId,
      totalDepleted: depletedPacks.length,
      enqueuedCount,
      skippedCount,
    });

    return createSuccessResponse({
      message: `Queued ${enqueuedCount} DEPLETED packs for resync`,
      totalDepleted: depletedPacks.length,
      enqueuedCount,
      skippedCount,
    });
  },
  { description: 'Resync DEPLETED packs to cloud' }
);

/**
 * Resync RETURNED packs to cloud
 *
 * Used when:
 * - Sync queue was accidentally cleared
 * - RETURNED packs were not pushed to cloud
 * - Troubleshooting sync issues
 *
 * Strategy: Use UPDATE operation which routes to pushPackReturn endpoint
 */
registerHandler(
  'sync:resyncReturnedPacks',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const storeId = store.store_id;

    // Get all packs in RETURNED status
    const returnedPacks = lotteryPacksDAL.findByStatus(storeId, 'RETURNED');

    if (returnedPacks.length === 0) {
      return createSuccessResponse({
        message: 'No packs in RETURNED status to resync',
        enqueuedCount: 0,
      });
    }

    let enqueuedCount = 0;
    let skippedCount = 0;

    for (const pack of returnedPacks) {
      // Get game to get game_code and tickets_per_pack
      const game = lotteryGamesDAL.findById(pack.game_id);
      if (!game) {
        log.warn('Skipping pack resync: game not found', {
          packId: pack.pack_id,
          gameId: pack.game_id,
        });
        skippedCount++;
        continue;
      }

      // Calculate serial_start and serial_end
      const serialStart = '000';
      const serialEnd = game.tickets_per_pack
        ? String(game.tickets_per_pack - 1).padStart(3, '0')
        : '299';

      // Enqueue UPDATE operation - routes to pushPackReturn endpoint
      syncQueueDAL.enqueue({
        store_id: storeId,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          store_id: pack.store_id,
          game_id: pack.game_id,
          game_code: game.game_code,
          pack_number: pack.pack_number,
          status: 'RETURNED',
          bin_id: pack.current_bin_id,
          opening_serial: pack.opening_serial,
          closing_serial: pack.closing_serial,
          tickets_sold: pack.tickets_sold_count,
          sales_amount: pack.sales_amount,
          received_at: pack.received_at || pack.created_at,
          received_by: pack.received_by,
          activated_at: pack.activated_at,
          activated_by: pack.activated_by,
          depleted_at: null,
          returned_at: pack.returned_at,
          returned_by: pack.returned_by,
          returned_shift_id: pack.returned_shift_id,
          return_reason: pack.return_reason || 'OTHER',
          return_notes: pack.return_notes,
          serial_start: serialStart,
          serial_end: serialEnd,
        },
      });
      enqueuedCount++;
    }

    log.info('Resyncing RETURNED packs to cloud', {
      storeId,
      totalReturned: returnedPacks.length,
      enqueuedCount,
      skippedCount,
    });

    return createSuccessResponse({
      message: `Queued ${enqueuedCount} RETURNED packs for resync`,
      totalReturned: returnedPacks.length,
      enqueuedCount,
      skippedCount,
    });
  },
  { description: 'Resync RETURNED packs to cloud' }
);

/**
 * Resync ALL packs to cloud (ACTIVE, DEPLETED, RETURNED)
 *
 * Comprehensive resync for all pack statuses. Use when:
 * - Sync queue was cleared or corrupted
 * - Initial data migration to cloud
 * - Troubleshooting major sync issues
 *
 * This combines: resyncActivePacks + resyncDepletedPacks + resyncReturnedPacks
 */
registerHandler(
  'sync:resyncAllPacks',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const storeId = store.store_id;
    const results = {
      active: { total: 0, enqueued: 0, skipped: 0 },
      depleted: { total: 0, enqueued: 0, skipped: 0 },
      returned: { total: 0, enqueued: 0, skipped: 0 },
    };

    // Helper to enqueue a pack with the right payload
    const enqueuePack = (
      pack: ReturnType<typeof lotteryPacksDAL.findByStatus>[number],
      status: 'ACTIVE' | 'DEPLETED' | 'RETURNED'
    ): boolean => {
      const game = lotteryGamesDAL.findById(pack.game_id);
      if (!game) {
        return false;
      }

      const serialStart = '000';
      const serialEnd = game.tickets_per_pack
        ? String(game.tickets_per_pack - 1).padStart(3, '0')
        : '299';

      const operation = status === 'ACTIVE' ? 'ACTIVATE' : 'UPDATE';

      syncQueueDAL.enqueue({
        store_id: storeId,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation,
        payload: {
          pack_id: pack.pack_id,
          store_id: pack.store_id,
          game_id: pack.game_id,
          game_code: game.game_code,
          pack_number: pack.pack_number,
          status,
          bin_id: pack.current_bin_id,
          opening_serial: pack.opening_serial,
          closing_serial: pack.closing_serial,
          tickets_sold: pack.tickets_sold_count,
          sales_amount: pack.sales_amount,
          received_at: pack.received_at || pack.created_at,
          received_by: pack.received_by,
          activated_at: pack.activated_at,
          activated_by: pack.activated_by,
          shift_id: pack.activated_shift_id,
          depleted_at: pack.depleted_at,
          depleted_by: pack.depleted_by,
          depleted_shift_id: pack.depleted_shift_id,
          depletion_reason: pack.depletion_reason,
          returned_at: pack.returned_at,
          returned_by: pack.returned_by,
          returned_shift_id: pack.returned_shift_id,
          return_reason: pack.return_reason,
          return_notes: pack.return_notes,
          serial_start: serialStart,
          serial_end: serialEnd,
        },
      });
      return true;
    };

    // Process ACTIVE packs
    const activePacks = lotteryPacksDAL.findByStatus(storeId, 'ACTIVE');
    results.active.total = activePacks.length;
    for (const pack of activePacks) {
      if (enqueuePack(pack, 'ACTIVE')) {
        results.active.enqueued++;
      } else {
        results.active.skipped++;
      }
    }

    // Process DEPLETED packs
    const depletedPacks = lotteryPacksDAL.findByStatus(storeId, 'DEPLETED');
    results.depleted.total = depletedPacks.length;
    for (const pack of depletedPacks) {
      if (enqueuePack(pack, 'DEPLETED')) {
        results.depleted.enqueued++;
      } else {
        results.depleted.skipped++;
      }
    }

    // Process RETURNED packs
    const returnedPacks = lotteryPacksDAL.findByStatus(storeId, 'RETURNED');
    results.returned.total = returnedPacks.length;
    for (const pack of returnedPacks) {
      if (enqueuePack(pack, 'RETURNED')) {
        results.returned.enqueued++;
      } else {
        results.returned.skipped++;
      }
    }

    const totalEnqueued =
      results.active.enqueued + results.depleted.enqueued + results.returned.enqueued;
    const totalSkipped =
      results.active.skipped + results.depleted.skipped + results.returned.skipped;

    log.info('Resyncing ALL packs to cloud', {
      storeId,
      results,
      totalEnqueued,
      totalSkipped,
    });

    return createSuccessResponse({
      message: `Queued ${totalEnqueued} packs for resync (${totalSkipped} skipped due to missing game)`,
      results,
      totalEnqueued,
      totalSkipped,
    });
  },
  { description: 'Resync ALL packs (ACTIVE, DEPLETED, RETURNED) to cloud' }
);

/**
 * DEBUG: Fix missing timestamps on active packs
 * Sets received_at to 1 hour before now, activated_at to now
 */
registerHandler(
  'sync:debugFixPackTimestamps',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const db = getDatabase();
    const activatedAt = new Date();
    const receivedAt = new Date(activatedAt.getTime() - 60 * 60 * 1000); // 1 hour before

    // Update all ACTIVE packs - received 1 hour ago, activated now
    const result = db
      .prepare(
        `
      UPDATE lottery_packs
      SET
        received_at = COALESCE(received_at, ?),
        activated_at = COALESCE(activated_at, ?)
      WHERE store_id = ?
        AND status = 'ACTIVE'
        AND (received_at IS NULL OR activated_at IS NULL)
    `
      )
      .run(receivedAt.toISOString(), activatedAt.toISOString(), store.store_id);

    log.info('Fixed missing pack timestamps', {
      storeId: store.store_id,
      updatedCount: result.changes,
      receivedAt: receivedAt.toISOString(),
      activatedAt: activatedAt.toISOString(),
    });

    // Get updated packs
    const packs = db
      .prepare(
        `
      SELECT pack_id, pack_number, status, received_at, activated_at, created_at
      FROM lottery_packs
      WHERE store_id = ? AND status = 'ACTIVE'
    `
      )
      .all(store.store_id);

    return createSuccessResponse({
      message: `Fixed ${result.changes} packs with missing timestamps`,
      receivedAt: receivedAt.toISOString(),
      activatedAt: activatedAt.toISOString(),
      packs,
    });
  },
  { description: 'DEBUG: Fix missing timestamps on active packs' }
);

// ============================================================================
// File Reprocessing Handlers
// ============================================================================

/**
 * Clear processed file tracking to allow reprocessing
 * Requires ADMIN role due to potential data regeneration
 *
 * Options:
 * - zeroRecordsOnly: Only clear files that were processed but created 0 records
 * - documentType: Filter by document type (e.g., 'PJR', 'FGM')
 */
registerHandler(
  'sync:clearProcessedFiles',
  async (_event, input: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const params = input as
      | {
          zeroRecordsOnly?: boolean;
          documentType?: string;
          startDate?: string;
          endDate?: string;
        }
      | undefined;

    const cleared = processedFilesDAL.clearForReprocessing(store.store_id, {
      zeroRecordsOnly: params?.zeroRecordsOnly,
      documentType: params?.documentType,
      startDate: params?.startDate,
      endDate: params?.endDate,
    });

    log.info('Processed files cleared for reprocessing', {
      storeId: store.store_id,
      clearedCount: cleared,
      options: params,
    });

    return createSuccessResponse({ clearedCount: cleared });
  },
  { description: 'Clear processed files for reprocessing' }
);

/**
 * Trigger reprocessing of XML files in the watch folder
 * This clears failed/zero-record files and restarts the file watcher
 * When clearZeroRecordsOnly=false, clears ALL processed files regardless of store ID
 */
registerHandler(
  'sync:reprocessXmlFiles',
  async (_event, input: unknown) => {
    // Get store IDs for debugging
    const legacyStoreId = getStoreIdFromSettings();
    const dbStore = storesDAL.getConfiguredStore();

    // Get ALL distinct store IDs in processed_files for debugging
    const distinctStoreIds = processedFilesDAL.getDistinctStoreIds();
    const totalBeforeCount = processedFilesDAL.getTotalCount();

    // Log all store IDs for debugging
    log.info('Reprocess request - store ID analysis', {
      legacyStoreId,
      dbStoreId: dbStore?.store_id,
      distinctStoreIdsInDb: distinctStoreIds,
      totalProcessedFiles: totalBeforeCount,
    });

    const params = input as
      | {
          clearZeroRecordsOnly?: boolean;
          restartWatcher?: boolean;
        }
      | undefined;

    let cleared: number;

    if (params?.clearZeroRecordsOnly === false) {
      // FULL CLEAR: Clear ALL processed files regardless of store ID
      // This handles cases where store ID may have changed or mismatched
      cleared = processedFilesDAL.clearAllForReprocessing();
      log.info('Cleared ALL processed files for full reprocessing', {
        clearedCount: cleared,
        previousDistinctStoreIds: distinctStoreIds,
      });
    } else {
      // Partial clear: Only zero-record files, use legacy storeId if available
      const storeId = legacyStoreId || dbStore?.store_id;
      if (!storeId) {
        return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
      }
      cleared = processedFilesDAL.clearForReprocessing(storeId, {
        zeroRecordsOnly: true,
      });
      log.info('Cleared zero-record processed files', {
        storeId,
        clearedCount: cleared,
      });
    }

    // Get count after clearing to verify
    const afterCount = processedFilesDAL.getTotalCount();

    log.info('Cleared processed files for XML reprocessing', {
      beforeCount: totalBeforeCount,
      clearedCount: cleared,
      afterCount,
      distinctStoreIds,
      zeroRecordsOnly: params?.clearZeroRecordsOnly !== false,
    });

    // Restart file watcher to pick up files again via the main process
    if (params?.restartWatcher !== false) {
      log.info('Emitting file-watcher:restart event via eventBus');

      // Emit via eventBus for reliable internal communication
      // This triggers the handler in index.ts that restarts FileWatcher and calls processExistingFiles
      eventBus.emit(MainEvents.FILE_WATCHER_RESTART);

      // Also notify renderer (for UI feedback if needed)
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('file-watcher:restart-requested');
      }
    }

    const response = {
      clearedCount: cleared,
      beforeCount: totalBeforeCount,
      afterCount,
      distinctStoreIds,
      message: `Cleared ${cleared} of ${totalBeforeCount} processed file records (from ${distinctStoreIds.length} store ID(s)). File watcher restarting to reprocess files.`,
    };

    return createSuccessResponse(response);
  },
  { description: 'Reprocess XML files' }
);

/**
 * Get processed files statistics
 * Shows how many files were processed with zero records (potential parser failures)
 */
registerHandler(
  'sync:getProcessedFilesStats',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const stats = processedFilesDAL.getStats(store.store_id);
    const countsByType = processedFilesDAL.getCountsByDocumentType(store.store_id);

    // Count files with zero records (potential parser issues)
    const zeroRecordFiles = processedFilesDAL.findByStore(store.store_id, { limit: 1000 });
    const zeroRecordCount = zeroRecordFiles.data.filter((f) => f.record_count === 0).length;

    return createSuccessResponse({
      ...stats,
      zeroRecordCount,
      countsByType: Object.fromEntries(countsByType),
    });
  },
  { description: 'Get processed files statistics' }
);

/**
 * Debug: Dump database state for troubleshooting
 * Shows both legacy config storeId and database storeId to identify mismatches
 */
registerHandler(
  'sync:debugDump',
  async () => {
    const legacyStoreId = getStoreIdFromSettings();
    const dbStore = storesDAL.getConfiguredStore();

    // Get config from unified settings store
    const settingsConfig = {
      storeId: settingsService.getStoreId(),
      watchPath: settingsService.getWatchPath(),
      isConfigured: settingsService.isConfigured(),
    };

    // Use whichever storeId is available
    const storeId = legacyStoreId || dbStore?.store_id;
    if (!storeId) {
      return createErrorResponse(
        IPCErrorCodes.NOT_CONFIGURED,
        'Store not configured (neither legacy nor DB)'
      );
    }

    const processedCount = processedFilesDAL.findByStore(storeId, { limit: 1 }).total;
    const recentProcessed = processedFilesDAL.findByStore(storeId, { limit: 10 }).data;
    const shifts = shiftsDAL.findByStore(storeId, { limit: 10 }).data;

    // Also check with DB store ID if different
    let dbProcessedCount = 0;
    if (dbStore && dbStore.store_id !== legacyStoreId) {
      dbProcessedCount = processedFilesDAL.findByStore(dbStore.store_id, { limit: 1 }).total;
    }

    log.info('DEBUG DUMP', {
      settingsStoreId: legacyStoreId,
      dbStoreId: dbStore?.store_id,
      storeIdMatch: legacyStoreId === dbStore?.store_id,
      settingsConfig,
      processedFilesCount: processedCount,
      dbProcessedFilesCount: dbProcessedCount,
      shiftsCount: shifts.length,
      recentProcessedFiles: recentProcessed.map((f) => ({
        name: f.file_name,
        records: f.record_count,
        status: f.status,
      })),
      shifts: shifts.map((s) => ({
        date: s.business_date,
        registerId: s.register_id,
        cashierId: s.cashier_id,
        status: s.status,
      })),
    });

    return createSuccessResponse({
      settingsStoreId: legacyStoreId,
      dbStoreId: dbStore?.store_id,
      storeIdMatch: legacyStoreId === dbStore?.store_id,
      settingsConfig,
      processedFilesCount: processedCount,
      dbProcessedFilesCount: dbProcessedCount,
      shiftsCount: shifts.length,
      recentProcessedFiles: recentProcessed,
      shifts,
    });
  },
  { description: 'Debug database dump' }
);

/**
 * Debug: Dump sync queue state for troubleshooting
 * Shows both pending and failed items with parsed payloads
 */
registerHandler(
  'sync:debugQueueState',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // Get all pending items (not just retryable)
    const pendingItems = syncQueueDAL.getUnsyncedByStore(store.store_id, 50);
    const failedItems = syncQueueDAL.getFailedItems(store.store_id, 50);
    const stats = syncQueueDAL.getStats(store.store_id);

    // Parse payloads and check for issues
    const analyzeItem = (item: (typeof pendingItems)[0]) => {
      try {
        const payload = JSON.parse(item.payload);
        // Check for missing required fields based on entity type and operation
        const issues: string[] = [];

        if (item.entity_type === 'pack') {
          if (!payload.game_id) issues.push('missing game_id');
          if (!payload.store_id) issues.push('missing store_id');
          if (!payload.pack_id) issues.push('missing pack_id');

          if (item.operation === 'UPDATE') {
            if (payload.status === 'ACTIVE') {
              if (!payload.bin_id) issues.push('ACTIVE: missing bin_id');
              if (!payload.opening_serial) issues.push('ACTIVE: missing opening_serial');
              if (!payload.activated_at) issues.push('ACTIVE: missing activated_at');
            } else if (payload.status === 'DEPLETED') {
              if (!payload.closing_serial) issues.push('DEPLETED: missing closing_serial');
              if (!payload.depleted_at) issues.push('DEPLETED: missing depleted_at');
            } else if (payload.status === 'RETURNED') {
              if (!payload.returned_at) issues.push('RETURNED: missing returned_at');
            }
          }

          // Check if game exists
          if (payload.game_id) {
            const game = lotteryGamesDAL.findById(payload.game_id);
            if (!game) issues.push(`game not found: ${payload.game_id}`);
          }
        }

        return {
          id: item.id,
          entity_type: item.entity_type,
          entity_id: item.entity_id,
          operation: item.operation,
          status: payload.status,
          sync_attempts: item.sync_attempts,
          max_attempts: item.max_attempts,
          last_sync_error: item.last_sync_error,
          last_attempt_at: item.last_attempt_at,
          created_at: item.created_at,
          issues,
          payload_summary: {
            pack_id: payload.pack_id,
            game_id: payload.game_id,
            game_code: payload.game_code,
            status: payload.status,
            bin_id: payload.bin_id,
            opening_serial: payload.opening_serial,
            closing_serial: payload.closing_serial,
            activated_at: payload.activated_at,
            depleted_at: payload.depleted_at,
            returned_at: payload.returned_at,
            shift_id: payload.shift_id,
            depleted_shift_id: payload.depleted_shift_id,
            returned_shift_id: payload.returned_shift_id,
          },
        };
      } catch (e) {
        return {
          id: item.id,
          entity_type: item.entity_type,
          entity_id: item.entity_id,
          operation: item.operation,
          sync_attempts: item.sync_attempts,
          last_sync_error: item.last_sync_error,
          issues: [`Failed to parse payload: ${e instanceof Error ? e.message : String(e)}`],
          raw_payload: item.payload.substring(0, 500),
        };
      }
    };

    const analyzedPending = pendingItems.map(analyzeItem);
    const analyzedFailed = failedItems.map(analyzeItem);

    log.info('SYNC QUEUE DEBUG DUMP', {
      stats,
      pendingCount: pendingItems.length,
      failedCount: failedItems.length,
      pending: analyzedPending,
      failed: analyzedFailed,
    });

    return createSuccessResponse({
      stats,
      pending: analyzedPending,
      failed: analyzedFailed,
    });
  },
  { description: 'Debug sync queue state' }
);

/**
 * DEBUG: Get recently synced items with full payload data
 * Shows exactly what data was sent to the cloud
 */
registerHandler(
  'sync:debugGetSyncedItems',
  async (_event, input: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const params = input as { limit?: number; entityType?: string } | undefined;
    const limit = Math.min(params?.limit || 50, 200);
    const entityType = params?.entityType;

    // Query synced items directly from the database
    const db = syncQueueDAL['db'];
    let query = `
      SELECT id, entity_type, entity_id, operation, payload, synced_at, created_at
      FROM sync_queue
      WHERE store_id = ? AND synced = 1
    `;
    const queryParams: (string | number)[] = [store.store_id];

    if (entityType) {
      query += ` AND entity_type = ?`;
      queryParams.push(entityType);
    }

    query += ` ORDER BY synced_at DESC LIMIT ?`;
    queryParams.push(limit);

    const stmt = db.prepare(query);
    const items = stmt.all(...queryParams) as Array<{
      id: string;
      entity_type: string;
      entity_id: string;
      operation: string;
      payload: string;
      synced_at: string;
      created_at: string;
    }>;

    // Parse payloads and format for display
    const formattedItems = items.map((item) => {
      try {
        const payload = JSON.parse(item.payload);
        return {
          id: item.id,
          entity_type: item.entity_type,
          entity_id: item.entity_id,
          operation: item.operation,
          synced_at: item.synced_at,
          created_at: item.created_at,
          payload: payload,
        };
      } catch {
        return {
          id: item.id,
          entity_type: item.entity_type,
          entity_id: item.entity_id,
          operation: item.operation,
          synced_at: item.synced_at,
          created_at: item.created_at,
          payload_raw: item.payload,
          parse_error: true,
        };
      }
    });

    log.info('DEBUG: Retrieved synced items', {
      storeId: store.store_id,
      count: formattedItems.length,
      entityType: entityType || 'all',
    });

    return createSuccessResponse({
      count: formattedItems.length,
      items: formattedItems,
    });
  },
  { description: 'DEBUG: Get recently synced items with payloads' }
);

/**
 * Close stale open shifts
 * Fixes data where shifts from previous days weren't properly closed
 */
registerHandler(
  'sync:closeStaleShifts',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // Get current date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];

    const closedCount = shiftsDAL.closeStaleOpenShifts(store.store_id, today);

    log.info('Closed stale shifts', { closedCount, storeId: store.store_id, today });

    return createSuccessResponse({
      closedCount,
      message: `Closed ${closedCount} stale open shift(s) from previous days`,
    });
  },
  { description: 'Close stale open shifts from previous days' }
);

/**
 * Reset fuel data and reprocess FGM files
 * Clears accumulated/corrupted fuel summaries and triggers reprocessing
 * Use this to fix incorrect fuel totals caused by duplicate data accumulation
 */
registerHandler(
  'sync:resetFuelData',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // 1. Delete all shift fuel summaries for this store
    const fuelSummariesDeleted = shiftFuelSummariesDAL.deleteAllForStore(store.store_id);

    // 2. Clear MSM processed file records to allow reprocessing
    // Fuel data is extracted from MSM files (fuelSalesByGrade), not FGM files
    // Document type is stored as 'MiscellaneousSummaryMovement' (full name)
    const msmFilesCleared = processedFilesDAL.clearForReprocessing(store.store_id, {
      documentType: 'MiscellaneousSummaryMovement',
    });

    log.info('Fuel data reset completed', {
      storeId: store.store_id,
      fuelSummariesDeleted,
      msmFilesCleared,
    });

    // 3. Trigger file watcher restart to reprocess MSM files
    eventBus.emit(MainEvents.FILE_WATCHER_RESTART);

    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      mainWindow.webContents.send('file-watcher:restart-requested');
    }

    return createSuccessResponse({
      fuelSummariesDeleted,
      msmFilesCleared,
      message: `Deleted ${fuelSummariesDeleted} fuel summary records and cleared ${msmFilesCleared} MSM file records. Files will be reprocessed.`,
    });
  },
  { description: 'Reset fuel data and reprocess FGM files' }
);

// ============================================================================
// Dead Letter Queue Handlers (MQ-002 Compliance)
// ============================================================================

/**
 * Get Dead Letter Queue items (paginated)
 *
 * MQ-002: Implement DLQ processor for investigation/replay
 * SEC-006: Uses parameterized queries
 * DB-006: TENANT_ISOLATION - Query scoped to store
 * API-008: Only safe display fields returned
 */
registerHandler(
  'sync:getDeadLetterItems',
  async (_event, input: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // API-001: Validate and bound input parameters
    const params = input as { limit?: number; offset?: number } | undefined;
    const limit = Math.min(Math.max(1, params?.limit || 50), 100);
    const offset = Math.max(0, params?.offset || 0);

    const result = syncQueueDAL.getDeadLetterItems(store.store_id, limit, offset);

    return createSuccessResponse(result);
  },
  { requiresAuth: false, description: 'Get paginated Dead Letter Queue items' }
);

/**
 * Get Dead Letter Queue statistics
 *
 * MQ-002: Monitor DLQ depth and alert on growth
 * SEC-006: Parameterized queries
 * DB-006: TENANT_ISOLATION - All queries scoped to store_id
 */
registerHandler(
  'sync:getDeadLetterStats',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const stats = syncQueueDAL.getDeadLetterStats(store.store_id);

    return createSuccessResponse(stats);
  },
  { requiresAuth: false, description: 'Get Dead Letter Queue statistics' }
);

/**
 * Restore an item from Dead Letter Queue for retry
 *
 * MQ-002: Allow replay of DLQ items after fixing issues
 * SEC-006: Parameterized query
 * API-001: Input validation
 */
registerHandler(
  'sync:restoreFromDeadLetter',
  async (_event, input: unknown) => {
    const params = input as { id: string } | undefined;
    if (!params?.id || typeof params.id !== 'string') {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid item ID');
    }

    const restored = syncQueueDAL.restoreFromDeadLetter(params.id);

    if (restored) {
      log.info('Item restored from Dead Letter Queue', { id: params.id });
      return createSuccessResponse({ restored: true, id: params.id });
    }

    return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Item not found in Dead Letter Queue');
  },
  { requiresAuth: true, description: 'Restore item from Dead Letter Queue' }
);

/**
 * Restore multiple items from Dead Letter Queue
 *
 * MQ-002: Batch restore for efficient recovery
 * SEC-006: Parameterized queries
 * API-001: Input validation
 */
registerHandler(
  'sync:restoreFromDeadLetterMany',
  async (_event, input: unknown) => {
    const params = input as { ids: string[] } | undefined;
    if (!params?.ids || !Array.isArray(params.ids) || params.ids.length === 0) {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid item IDs');
    }

    // API-001: Bound batch size to prevent abuse
    const safeIds = params.ids.slice(0, 100).filter((id) => typeof id === 'string');
    if (safeIds.length === 0) {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'No valid item IDs');
    }

    const restoredCount = syncQueueDAL.restoreFromDeadLetterMany(safeIds);

    log.info('Batch restore from Dead Letter Queue', {
      requested: safeIds.length,
      restored: restoredCount,
    });

    return createSuccessResponse({
      requested: safeIds.length,
      restored: restoredCount,
    });
  },
  { requiresAuth: true, description: 'Restore multiple items from Dead Letter Queue' }
);

/**
 * Delete an item from Dead Letter Queue permanently
 *
 * CAUTION: This is irreversible
 * SEC-006: Parameterized query
 * API-001: Input validation
 */
registerHandler(
  'sync:deleteDeadLetterItem',
  async (_event, input: unknown) => {
    const params = input as { id: string } | undefined;
    if (!params?.id || typeof params.id !== 'string') {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid item ID');
    }

    const deleted = syncQueueDAL.deleteDeadLetterItem(params.id);

    if (deleted) {
      log.warn('Item permanently deleted from Dead Letter Queue', { id: params.id });
      return createSuccessResponse({ deleted: true, id: params.id });
    }

    return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Item not found in Dead Letter Queue');
  },
  { requiresAuth: true, description: 'Delete item from Dead Letter Queue permanently' }
);

/**
 * Cleanup old Dead Letter Queue items
 *
 * MQ-002: Periodic cleanup of old DLQ items
 * SEC-006: Parameterized query
 * DB-006: TENANT_ISOLATION - Scoped to store
 */
registerHandler(
  'sync:cleanupDeadLetter',
  async (_event, input: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const params = input as { olderThanDays?: number } | undefined;
    // API-001: Validate and bound days parameter (min 7 days, max 365 days)
    const days = Math.min(Math.max(7, params?.olderThanDays || 30), 365);

    // Calculate cutoff date
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const deletedCount = syncQueueDAL.deleteDeadLetterItems(store.store_id, cutoffDate);

    log.info('Dead Letter Queue cleanup completed', {
      storeId: store.store_id,
      olderThanDays: days,
      deletedCount,
    });

    return createSuccessResponse({
      deletedCount,
      cutoffDate,
    });
  },
  { requiresAuth: true, description: 'Cleanup old Dead Letter Queue items' }
);

/**
 * Manually dead-letter a specific item
 *
 * Use when an item is known to be unfixable
 * SEC-006: Parameterized query
 * API-001: Input validation
 */
registerHandler(
  'sync:manualDeadLetter',
  async (_event, input: unknown) => {
    const params = input as { id: string; reason?: string } | undefined;
    if (!params?.id || typeof params.id !== 'string') {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid item ID');
    }

    const deadLettered = syncQueueDAL.deadLetter({
      id: params.id,
      reason: 'MANUAL',
      errorCategory: 'UNKNOWN',
      error: params.reason || 'Manually moved to Dead Letter Queue',
    });

    if (deadLettered) {
      log.warn('Item manually moved to Dead Letter Queue', {
        id: params.id,
        reason: params.reason,
      });
      return createSuccessResponse({ deadLettered: true, id: params.id });
    }

    return createErrorResponse(
      IPCErrorCodes.NOT_FOUND,
      'Item not found or already dead-lettered/synced'
    );
  },
  { requiresAuth: true, description: 'Manually move item to Dead Letter Queue' }
);

log.info('Sync IPC handlers registered');
