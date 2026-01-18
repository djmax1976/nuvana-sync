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
import { userSyncService } from '../services/user-sync.service';
import { bidirectionalSyncService } from '../services/bidirectional-sync.service';
import { settingsService } from '../services/settings.service';
import { cloudApiService } from '../services/cloud-api.service';
import { BrowserWindow, ipcMain, app } from 'electron';
import Store from 'electron-store';
import { createLogger } from '../utils/logger';
import { eventBus, MainEvents } from '../utils/event-bus';

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('sync-handlers');

// ============================================================================
// Helper: Get storeId from legacy config (same source as FileWatcher)
// ============================================================================

/**
 * Get storeId from the legacy nuvana-config store.
 * This is the same config store used by FileWatcherService via ConfigService.
 * IMPORTANT: Must match the storeId used by FileWatcher for processed_files to clear correctly.
 */
function getLegacyStoreId(): string | null {
  try {
    const legacyConfig = new Store({ name: 'nuvana-config' });
    return (legacyConfig.get('storeId') as string) || null;
  } catch {
    return null;
  }
}

// ============================================================================
// Sync Status Handlers
// ============================================================================

/**
 * Get current sync status
 * Available to all authenticated users
 */
registerHandler(
  'sync:getStatus',
  async () => {
    const status = syncEngineService.getStatus();
    return createSuccessResponse(status);
  },
  { requiresAuth: true, description: 'Get sync status' }
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

// ============================================================================
// Manual Sync Handlers (MANAGER+)
// ============================================================================

/**
 * Trigger manual sync
 * Requires MANAGER role
 */
registerHandler(
  'sync:triggerNow',
  async () => {
    log.info('Manual sync triggered');

    await syncEngineService.triggerSync();

    return createSuccessResponse({ triggered: true });
  },
  { requiresAuth: true, requiredRole: 'shift_manager', description: 'Trigger manual sync' }
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
 * Requires MANAGER role
 */
registerHandler(
  'sync:syncGames',
  async () => {
    log.info('Games sync triggered');

    const result = await bidirectionalSyncService.syncGames();

    return createSuccessResponse(result);
  },
  { requiresAuth: true, requiredRole: 'shift_manager', description: 'Sync games with cloud' }
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
 * Sync users during initial setup
 * No auth required - authorization via prior API key validation
 * SEC-017: Only allowed when setup is not yet complete
 */
registerHandler(
  'sync:syncUsersDuringSetup',
  async () => {
    // SEC-017: Only allow during setup phase
    if (settingsService.isSetupComplete()) {
      log.warn('Attempted to use setup sync endpoint after setup complete');
      return createErrorResponse(
        IPCErrorCodes.FORBIDDEN,
        'Setup already complete. Use sync:syncUsers with authentication.'
      );
    }

    log.info('User sync triggered during setup');

    try {
      const result = await userSyncService.syncUsers();
      return createSuccessResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'User sync failed';
      log.warn('User sync during setup failed', { error: message });
      // Return success:false but don't throw - setup can continue
      return createSuccessResponse({ success: false, synced: 0, error: message });
    }
  },
  { description: 'Sync users during setup wizard' }
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
    const legacyStoreId = getLegacyStoreId();
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
    const legacyStoreId = getLegacyStoreId();
    const dbStore = storesDAL.getConfiguredStore();

    // Get config from legacy store for more details
    let legacyConfig: Record<string, unknown> = {};
    try {
      const legacyConfigStore = new Store({ name: 'nuvana-config' });
      legacyConfig = {
        storeId: legacyConfigStore.get('storeId'),
        watchPath: legacyConfigStore.get('watchPath'),
        isConfigured: legacyConfigStore.get('isConfigured'),
      };
    } catch {
      // Ignore errors reading legacy config
    }

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
      legacyStoreId,
      dbStoreId: dbStore?.store_id,
      storeIdMatch: legacyStoreId === dbStore?.store_id,
      legacyConfig,
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
      legacyStoreId,
      dbStoreId: dbStore?.store_id,
      storeIdMatch: legacyStoreId === dbStore?.store_id,
      legacyConfig,
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

log.info('Sync IPC handlers registered');
