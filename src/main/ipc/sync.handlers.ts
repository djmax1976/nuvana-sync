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

import { registerHandler, createSuccessResponse, createErrorResponse, IPCErrorCodes } from './index';
import { syncEngineService } from '../services/sync-engine.service';
import { syncLogDAL } from '../dal/sync-log.dal';
import { syncQueueDAL } from '../dal/sync-queue.dal';
import { syncTimestampsDAL } from '../dal/sync-timestamps.dal';
import { storesDAL } from '../dal/stores.dal';
import { userSyncService } from '../services/user-sync.service';
import { bidirectionalSyncService } from '../services/bidirectional-sync.service';
import { settingsService } from '../services/settings.service';
import { createLogger } from '../utils/logger';

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('sync-handlers');

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

log.info('Sync IPC handlers registered');
