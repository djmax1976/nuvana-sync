/**
 * Sync IPC Handlers Unit Tests
 *
 * @module tests/unit/ipc/sync.handlers.spec
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks (before imports to support hoisting)
// ============================================================================

// Mock sync engine service
vi.mock('../../../src/main/services/sync-engine.service', () => ({
  syncEngineService: {
    getStatus: vi.fn(),
    triggerSync: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    cleanupQueue: vi.fn(),
    setCloudApiService: vi.fn(),
  },
}));

// Mock user sync service
vi.mock('../../../src/main/services/user-sync.service', () => ({
  userSyncService: {
    syncUsers: vi.fn(),
  },
}));

// Mock bidirectional sync service
vi.mock('../../../src/main/services/bidirectional-sync.service', () => ({
  bidirectionalSyncService: {
    syncBins: vi.fn(),
    syncGames: vi.fn(),
    forceFullSync: vi.fn(),
  },
}));

// Mock sync log DAL
vi.mock('../../../src/main/dal/sync-log.dal', () => ({
  syncLogDAL: {
    getRecentLogs: vi.fn(),
    getLogsPaginated: vi.fn(),
    getStats: vi.fn(),
  },
}));

// Mock sync queue DAL
vi.mock('../../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: {
    getUnsyncedByStore: vi.fn(),
    getPendingCount: vi.fn(),
    getFailedItems: vi.fn(),
    getFailedCount: vi.fn(),
    retryFailed: vi.fn(),
    getStats: vi.fn(),
  },
}));

// Mock sync timestamps DAL
vi.mock('../../../src/main/dal/sync-timestamps.dal', () => ({
  syncTimestampsDAL: {
    getSyncSummary: vi.fn(),
  },
}));

// Mock stores DAL
vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: {
    getConfiguredStore: vi.fn(),
  },
}));

// Type for IPC handler results
interface IPCResult {
  data?: unknown;
  error?: string;
  message?: string;
}

// Type for IPC handlers - eslint-disable needed for test flexibility
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IPCHandler = (...args: any[]) => Promise<IPCResult> | IPCResult;

// Handler registry - global so it survives hoisting
const _handlerRegistry: Map<string, IPCHandler> = new Map();

// Mock IPC handler registration - capture handlers
vi.mock('../../../src/main/ipc/index', () => {
  // Use the outer handlerRegistry defined above
  return {
    registerHandler: vi.fn((channel: string, handler: IPCHandler) => {
      // Store directly in module state
      (globalThis as Record<string, unknown>).__syncHandlers =
        (globalThis as Record<string, unknown>).__syncHandlers || new Map();
      ((globalThis as Record<string, unknown>).__syncHandlers as Map<string, IPCHandler>).set(
        channel,
        handler
      );
    }),
    createSuccessResponse: vi.fn((data: unknown) => ({ data })),
    createErrorResponse: vi.fn((code: string, message: string) => ({ error: code, message })),
    IPCErrorCodes: {
      NOT_CONFIGURED: 'NOT_CONFIGURED',
      VALIDATION_ERROR: 'VALIDATION_ERROR',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    },
  };
});

// Helper to get registered handlers
function getHandler(channel: string): IPCHandler | undefined {
  const handlers = (globalThis as Record<string, unknown>).__syncHandlers as
    | Map<string, IPCHandler>
    | undefined;
  return handlers?.get(channel);
}

// Import handlers (triggers registration)
import '../../../src/main/ipc/sync.handlers';

// Import the mocked modules to get references
import { syncEngineService } from '../../../src/main/services/sync-engine.service';
import { userSyncService } from '../../../src/main/services/user-sync.service';
import { bidirectionalSyncService } from '../../../src/main/services/bidirectional-sync.service';
import { syncLogDAL } from '../../../src/main/dal/sync-log.dal';
import { syncQueueDAL } from '../../../src/main/dal/sync-queue.dal';
import { syncTimestampsDAL } from '../../../src/main/dal/sync-timestamps.dal';
import { storesDAL } from '../../../src/main/dal/stores.dal';

// Get mock references
const mockGetStatus = vi.mocked(syncEngineService.getStatus);
const mockTriggerSync = vi.mocked(syncEngineService.triggerSync);
const mockStart = vi.mocked(syncEngineService.start);
const mockStop = vi.mocked(syncEngineService.stop);
const mockCleanupQueue = vi.mocked(syncEngineService.cleanupQueue);
const mockSyncUsers = vi.mocked(userSyncService.syncUsers);
const mockSyncBins = vi.mocked(bidirectionalSyncService.syncBins);
const mockSyncGames = vi.mocked(bidirectionalSyncService.syncGames);
const mockForceFullSync = vi.mocked(bidirectionalSyncService.forceFullSync);
const mockGetRecentLogs = vi.mocked(syncLogDAL.getRecentLogs);
const mockGetLogsPaginated = vi.mocked(syncLogDAL.getLogsPaginated);
const mockGetLogStats = vi.mocked(syncLogDAL.getStats);
const mockGetUnsyncedByStore = vi.mocked(syncQueueDAL.getUnsyncedByStore);
const mockGetPendingCount = vi.mocked(syncQueueDAL.getPendingCount);
const mockGetFailedItems = vi.mocked(syncQueueDAL.getFailedItems);
const mockGetFailedCount = vi.mocked(syncQueueDAL.getFailedCount);
const mockRetryFailed = vi.mocked(syncQueueDAL.retryFailed);
const mockGetQueueStats = vi.mocked(syncQueueDAL.getStats);
const mockGetSyncSummary = vi.mocked(syncTimestampsDAL.getSyncSummary);
const mockGetConfiguredStore = vi.mocked(storesDAL.getConfiguredStore);

// ============================================================================
// Tests
// ============================================================================

describe('Sync IPC Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfiguredStore.mockReturnValue({
      store_id: 'store-123',
      name: 'Test Store',
    } as ReturnType<typeof storesDAL.getConfiguredStore>);
  });

  describe('sync:getStatus', () => {
    it('should return sync status', async () => {
      const status = {
        isRunning: false,
        isStarted: true,
        lastSyncAt: '2024-01-01T00:00:00.000Z',
        lastSyncStatus: 'success',
        pendingCount: 5,
        nextSyncIn: 30000,
        isOnline: true,
      };

      mockGetStatus.mockReturnValue(status as ReturnType<typeof syncEngineService.getStatus>);

      const handler = getHandler('sync:getStatus');
      expect(handler).toBeDefined();

      const result = await handler!({});

      expect(result.data).toEqual(status);
      expect(mockGetStatus).toHaveBeenCalled();
    });
  });

  describe('sync:getStats', () => {
    it('should return combined sync stats', async () => {
      mockGetQueueStats.mockReturnValue({ pending: 5, failed: 1 } as ReturnType<
        typeof syncQueueDAL.getStats
      >);
      mockGetLogStats.mockReturnValue({
        totalSyncs: 100,
        successfulSyncs: 95,
        failedSyncs: 5,
      } as ReturnType<typeof syncLogDAL.getStats>);
      mockGetSyncSummary.mockReturnValue({
        bins: { lastPushAt: '2024-01-01T00:00:00.000Z', lastPullAt: null },
      });

      const handler = getHandler('sync:getStats');
      expect(handler).toBeDefined();

      const result = await handler!({});

      expect(result.data).toHaveProperty('queue');
      expect(result.data).toHaveProperty('history');
      expect(result.data).toHaveProperty('timestamps');
    });

    it('should return error if store not configured', async () => {
      mockGetConfiguredStore.mockReturnValue(undefined);

      const handler = getHandler('sync:getStats');
      const result = await handler!({});

      expect(result.error).toBe('NOT_CONFIGURED');
    });
  });

  describe('sync:triggerNow', () => {
    it('should trigger manual sync', async () => {
      mockTriggerSync.mockResolvedValue(undefined);

      const handler = getHandler('sync:triggerNow');
      expect(handler).toBeDefined();

      const result = await handler!({});

      expect(result.data).toEqual({ triggered: true });
      expect(mockTriggerSync).toHaveBeenCalled();
    });
  });

  describe('sync:syncUsers', () => {
    it('should sync users and return result', async () => {
      const syncResult = {
        synced: 5,
        created: 2,
        updated: 3,
        deactivated: 0,
        reactivated: 0,
        errors: [],
      };

      mockSyncUsers.mockResolvedValue(syncResult);

      const handler = getHandler('sync:syncUsers');
      expect(handler).toBeDefined();

      const result = await handler!({});

      expect(result.data).toEqual(syncResult);
      expect(mockSyncUsers).toHaveBeenCalled();
    });
  });

  describe('sync:syncBins', () => {
    it('should sync bins and return result', async () => {
      const syncResult = {
        pulled: 10,
        pushed: 5,
        conflicts: 1,
        errors: [],
      };

      mockSyncBins.mockResolvedValue(syncResult);

      const handler = getHandler('sync:syncBins');
      expect(handler).toBeDefined();

      const result = await handler!({});

      expect(result.data).toEqual(syncResult);
      expect(mockSyncBins).toHaveBeenCalled();
    });
  });

  describe('sync:syncGames', () => {
    it('should sync games and return result', async () => {
      const syncResult = {
        pulled: 20,
        pushed: 0,
        conflicts: 0,
        errors: [],
      };

      mockSyncGames.mockResolvedValue(syncResult);

      const handler = getHandler('sync:syncGames');
      expect(handler).toBeDefined();

      const result = await handler!({});

      expect(result.data).toEqual(syncResult);
      expect(mockSyncGames).toHaveBeenCalled();
    });
  });

  describe('sync:forceFullSync', () => {
    it('should trigger full sync and return result', async () => {
      const syncResult = {
        bins: { pulled: 10, pushed: 5, conflicts: 0, errors: [] },
        games: { pulled: 20, pushed: 0, conflicts: 0, errors: [] },
      };

      mockForceFullSync.mockResolvedValue(syncResult);

      const handler = getHandler('sync:forceFullSync');
      expect(handler).toBeDefined();

      const result = await handler!({});

      expect(result.data).toEqual(syncResult);
      expect(mockForceFullSync).toHaveBeenCalled();
    });
  });

  describe('sync:getHistory', () => {
    it('should return sync history logs', async () => {
      const logs = [
        {
          id: 'log-1',
          sync_type: 'PUSH',
          status: 'COMPLETED',
          started_at: '2024-01-01T00:00:00.000Z',
        },
      ];

      mockGetRecentLogs.mockReturnValue(logs as ReturnType<typeof syncLogDAL.getRecentLogs>);

      const handler = getHandler('sync:getHistory');
      expect(handler).toBeDefined();

      const result = await handler!({}, { limit: 50 });

      expect(result.data).toEqual({ logs });
    });

    it('should cap limit at 100', async () => {
      mockGetRecentLogs.mockReturnValue([]);

      const handler = getHandler('sync:getHistory');
      await handler!({}, { limit: 500 });

      expect(mockGetRecentLogs).toHaveBeenCalledWith('store-123', 100);
    });

    it('should return error if store not configured', async () => {
      mockGetConfiguredStore.mockReturnValue(undefined);

      const handler = getHandler('sync:getHistory');
      const result = await handler!({}, {});

      expect(result.error).toBe('NOT_CONFIGURED');
    });
  });

  describe('sync:getHistoryPaginated', () => {
    it('should return paginated sync history', async () => {
      const paginatedResult = {
        data: [{ id: 'log-1' }],
        total: 100,
        limit: 25,
        offset: 0,
        hasMore: true,
      };

      mockGetLogsPaginated.mockReturnValue(
        paginatedResult as unknown as ReturnType<typeof syncLogDAL.getLogsPaginated>
      );

      const handler = getHandler('sync:getHistoryPaginated');
      expect(handler).toBeDefined();

      const result = await handler!({}, { limit: 25, offset: 0 });

      expect(result.data).toEqual(paginatedResult);
    });
  });

  describe('sync:getPendingQueue', () => {
    it('should return pending queue items', async () => {
      const items = [{ id: 'q-1', entity_type: 'transaction', operation: 'CREATE' }];

      mockGetUnsyncedByStore.mockReturnValue(
        items as ReturnType<typeof syncQueueDAL.getUnsyncedByStore>
      );
      mockGetPendingCount.mockReturnValue(10);

      const handler = getHandler('sync:getPendingQueue');
      expect(handler).toBeDefined();

      const result = await handler!({}, { limit: 50 });

      expect(result.data).toEqual({ items, total: 10 });
    });

    it('should cap limit at 100', async () => {
      mockGetUnsyncedByStore.mockReturnValue([]);
      mockGetPendingCount.mockReturnValue(0);

      const handler = getHandler('sync:getPendingQueue');
      await handler!({}, { limit: 500 });

      expect(mockGetUnsyncedByStore).toHaveBeenCalledWith('store-123', 100);
    });
  });

  describe('sync:getFailedQueue', () => {
    it('should return failed queue items', async () => {
      const items = [{ id: 'q-1', entity_type: 'shift', last_sync_error: 'Network error' }];

      mockGetFailedItems.mockReturnValue(items as ReturnType<typeof syncQueueDAL.getFailedItems>);
      mockGetFailedCount.mockReturnValue(1);

      const handler = getHandler('sync:getFailedQueue');
      expect(handler).toBeDefined();

      const result = await handler!({}, { limit: 50 });

      expect(result.data).toEqual({ items, total: 1 });
    });
  });

  describe('sync:retryFailed', () => {
    it('should retry failed items and return count', async () => {
      const handler = getHandler('sync:retryFailed');
      expect(handler).toBeDefined();

      const result = await handler!({}, { ids: ['q-1', 'q-2', 'q-3'] });

      expect(result.data).toEqual({ retriedCount: 3 });
      expect(mockRetryFailed).toHaveBeenCalledWith(['q-1', 'q-2', 'q-3']);
    });

    it('should return validation error if no ids provided', async () => {
      const handler = getHandler('sync:retryFailed');

      const result = await handler!({}, { ids: [] });

      expect(result.error).toBe('VALIDATION_ERROR');
    });

    it('should return validation error if ids is not an array', async () => {
      const handler = getHandler('sync:retryFailed');

      const result = await handler!({}, { ids: null });

      expect(result.error).toBe('VALIDATION_ERROR');
    });

    it('should limit to 100 items', async () => {
      const manyIds = Array.from({ length: 150 }, (_, i) => `q-${i}`);

      const handler = getHandler('sync:retryFailed');
      await handler!({}, { ids: manyIds });

      expect(mockRetryFailed).toHaveBeenCalledWith(manyIds.slice(0, 100));
    });
  });

  describe('sync:startEngine', () => {
    it('should start sync engine with default interval', async () => {
      const handler = getHandler('sync:startEngine');
      expect(handler).toBeDefined();

      const result = await handler!({}, {});

      expect(result.data).toEqual({ started: true });
      expect(mockStart).toHaveBeenCalledWith(undefined);
    });

    it('should start sync engine with custom interval', async () => {
      const handler = getHandler('sync:startEngine');

      const result = await handler!({}, { intervalMs: 60000 });

      expect(result.data).toEqual({ started: true });
      expect(mockStart).toHaveBeenCalledWith(60000);
    });
  });

  describe('sync:stopEngine', () => {
    it('should stop sync engine', async () => {
      const handler = getHandler('sync:stopEngine');
      expect(handler).toBeDefined();

      const result = await handler!({});

      expect(result.data).toEqual({ stopped: true });
      expect(mockStop).toHaveBeenCalled();
    });
  });

  describe('sync:cleanupQueue', () => {
    it('should cleanup queue with default days', async () => {
      mockCleanupQueue.mockReturnValue(50);

      const handler = getHandler('sync:cleanupQueue');
      expect(handler).toBeDefined();

      const result = await handler!({}, {});

      expect(result.data).toEqual({ deletedCount: 50 });
      expect(mockCleanupQueue).toHaveBeenCalledWith(7);
    });

    it('should cleanup queue with custom days', async () => {
      mockCleanupQueue.mockReturnValue(100);

      const handler = getHandler('sync:cleanupQueue');

      const result = await handler!({}, { olderThanDays: 14 });

      expect(result.data).toEqual({ deletedCount: 100 });
      expect(mockCleanupQueue).toHaveBeenCalledWith(14);
    });
  });
});
