/**
 * Dead Letter Queue IPC Handlers Unit Tests
 *
 * Enterprise-grade tests for DLQ IPC handlers in sync.handlers.ts
 * Tests v046 migration MQ-002 compliance requirements.
 *
 * Traceability:
 * - MQ-002: Dead Letter Queue implementation
 * - SEC-006: SQL injection prevention via parameterized queries
 * - DB-006: Tenant isolation via store_id scoping
 * - API-001: Input validation with bounds checking
 * - API-008: Safe output filtering
 *
 * @module tests/unit/ipc/dead-letter-queue.handlers.spec
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mocks (before imports to support hoisting)
// ============================================================================

// Mock sync queue DAL
vi.mock('../../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: {
    getDeadLetterItems: vi.fn(),
    getDeadLetterStats: vi.fn(),
    restoreFromDeadLetter: vi.fn(),
    restoreFromDeadLetterMany: vi.fn(),
    deleteDeadLetterItem: vi.fn(),
    deleteDeadLetterItems: vi.fn(),
    deadLetter: vi.fn(),
    getStats: vi.fn(),
    getFailedItems: vi.fn(),
    getFailedCount: vi.fn(),
    retryFailed: vi.fn(),
    getUnsyncedByStore: vi.fn(),
    getPendingCount: vi.fn(),
  },
}));

// Mock stores DAL
vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: {
    getConfiguredStore: vi.fn(),
    isConfigured: vi.fn(() => true),
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

// Mock sync timestamps DAL
vi.mock('../../../src/main/dal/sync-timestamps.dal', () => ({
  syncTimestampsDAL: {
    getSyncSummary: vi.fn(),
  },
}));

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

// Mock settings service
vi.mock('../../../src/main/services/settings.service', () => ({
  settingsService: {
    getStoreId: vi.fn(),
    getWatchPath: vi.fn(),
    isConfigured: vi.fn(() => true),
    isSetupComplete: vi.fn(() => true),
    syncStoreToDatabase: vi.fn(),
  },
}));

// Mock other services
vi.mock('../../../src/main/services/cloud-api.service', () => ({
  cloudApiService: {},
}));

vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({ prepare: vi.fn() })),
}));

// Mock other DALs that might be imported
vi.mock('../../../src/main/dal/processed-files.dal', () => ({
  processedFilesDAL: {
    clearForReprocessing: vi.fn(),
    clearAllForReprocessing: vi.fn(),
    getDistinctStoreIds: vi.fn(() => []),
    getTotalCount: vi.fn(() => 0),
    getStats: vi.fn(),
    getCountsByDocumentType: vi.fn(() => new Map()),
    findByStore: vi.fn(() => ({ data: [], total: 0 })),
  },
}));

vi.mock('../../../src/main/dal/shifts.dal', () => ({
  shiftsDAL: {
    findByStore: vi.fn(() => ({ data: [], total: 0 })),
    closeStaleOpenShifts: vi.fn(() => 0),
  },
}));

vi.mock('../../../src/main/dal/shift-fuel-summaries.dal', () => ({
  shiftFuelSummariesDAL: {
    deleteAllForStore: vi.fn(() => 0),
  },
}));

vi.mock('../../../src/main/dal/lottery-bins.dal', () => ({
  lotteryBinsDAL: {
    findAllByStore: vi.fn(() => []),
  },
}));

vi.mock('../../../src/main/dal/lottery-packs.dal', () => ({
  lotteryPacksDAL: {
    findByStatus: vi.fn(() => []),
  },
}));

vi.mock('../../../src/main/dal/lottery-games.dal', () => ({
  lotteryGamesDAL: {
    findById: vi.fn(),
  },
}));

vi.mock('../../../src/main/utils/event-bus', () => ({
  eventBus: {
    emit: vi.fn(),
  },
  MainEvents: {
    FILE_WATCHER_RESTART: 'file-watcher:restart',
  },
}));

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/mock/path'),
    getName: vi.fn(() => 'test-app'),
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

// Type for IPC handler results
interface IPCResult {
  data?: unknown;
  error?: string;
  message?: string;
}

// Type for IPC handlers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IPCHandler = (...args: any[]) => Promise<IPCResult> | IPCResult;

// Mock IPC handler registration - capture handlers
vi.mock('../../../src/main/ipc/index', () => {
  return {
    registerHandler: vi.fn((channel: string, handler: IPCHandler) => {
      (globalThis as Record<string, unknown>).__dlqHandlers =
        (globalThis as Record<string, unknown>).__dlqHandlers || new Map();
      ((globalThis as Record<string, unknown>).__dlqHandlers as Map<string, IPCHandler>).set(
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
      NOT_FOUND: 'NOT_FOUND',
      FORBIDDEN: 'FORBIDDEN',
      CONFLICT: 'CONFLICT',
    },
  };
});

// Helper to get registered handlers
function getHandler(channel: string): IPCHandler | undefined {
  const handlers = (globalThis as Record<string, unknown>).__dlqHandlers as
    | Map<string, IPCHandler>
    | undefined;
  return handlers?.get(channel);
}

// Import handlers (triggers registration)
import '../../../src/main/ipc/sync.handlers';

// Import the mocked modules to get references
import { syncQueueDAL } from '../../../src/main/dal/sync-queue.dal';
import { storesDAL } from '../../../src/main/dal/stores.dal';

// Get mock references
const mockGetDeadLetterItems = vi.mocked(syncQueueDAL.getDeadLetterItems);
const mockGetDeadLetterStats = vi.mocked(syncQueueDAL.getDeadLetterStats);
const mockRestoreFromDeadLetter = vi.mocked(syncQueueDAL.restoreFromDeadLetter);
const mockRestoreFromDeadLetterMany = vi.mocked(syncQueueDAL.restoreFromDeadLetterMany);
const mockDeleteDeadLetterItem = vi.mocked(syncQueueDAL.deleteDeadLetterItem);
const mockDeleteDeadLetterItems = vi.mocked(syncQueueDAL.deleteDeadLetterItems);
const mockDeadLetter = vi.mocked(syncQueueDAL.deadLetter);
const mockGetConfiguredStore = vi.mocked(storesDAL.getConfiguredStore);

// ============================================================================
// Tests
// ============================================================================

describe('Dead Letter Queue IPC Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfiguredStore.mockReturnValue({
      store_id: 'store-123',
      name: 'Test Store',
    } as ReturnType<typeof storesDAL.getConfiguredStore>);
  });

  // ==========================================================================
  // sync:getDeadLetterItems Tests
  // ==========================================================================

  describe('sync:getDeadLetterItems', () => {
    it('should return paginated DLQ items', async () => {
      const mockResult = {
        items: [
          {
            id: 'dlq-1',
            entity_type: 'pack',
            entity_id: 'pack-123',
            operation: 'CREATE' as const,
            dead_letter_reason: 'PERMANENT_ERROR' as const,
            dead_lettered_at: '2024-01-01T12:00:00Z',
            error_category: 'PERMANENT' as const,
            sync_attempts: 5,
            max_attempts: 5,
            last_sync_error: 'API Error 400',
            api_endpoint: '/api/sync/packs',
            http_status: 400,
            created_at: '2024-01-01T10:00:00Z',
            summary: { pack_number: '001', game_code: '100' },
          },
        ],
        total: 10,
        limit: 50,
        offset: 0,
        hasMore: true,
      };

      mockGetDeadLetterItems.mockReturnValue(mockResult);

      const handler = getHandler('sync:getDeadLetterItems');
      expect(handler).toBeDefined();

      const result = await handler!({}, { limit: 50, offset: 0 });

      expect(result.data).toEqual(mockResult);
      expect(mockGetDeadLetterItems).toHaveBeenCalledWith('store-123', 50, 0);
    });

    it('should return error if store not configured', async () => {
      mockGetConfiguredStore.mockReturnValue(undefined);

      const handler = getHandler('sync:getDeadLetterItems');
      const result = await handler!({}, {});

      expect(result.error).toBe('NOT_CONFIGURED');
    });

    // API-001: Input bounds checking
    it('should bound limit to max 100 (API-001)', async () => {
      mockGetDeadLetterItems.mockReturnValue({
        items: [],
        total: 0,
        limit: 100,
        offset: 0,
        hasMore: false,
      });

      const handler = getHandler('sync:getDeadLetterItems');
      await handler!({}, { limit: 500 });

      expect(mockGetDeadLetterItems).toHaveBeenCalledWith('store-123', 100, 0);
    });

    it('should enforce minimum limit of 1 (API-001)', async () => {
      mockGetDeadLetterItems.mockReturnValue({
        items: [],
        total: 0,
        limit: 1,
        offset: 0,
        hasMore: false,
      });

      const handler = getHandler('sync:getDeadLetterItems');
      await handler!({}, { limit: -10 });

      expect(mockGetDeadLetterItems).toHaveBeenCalledWith('store-123', 1, 0);
    });

    it('should enforce minimum offset of 0', async () => {
      mockGetDeadLetterItems.mockReturnValue({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
        hasMore: false,
      });

      const handler = getHandler('sync:getDeadLetterItems');
      await handler!({}, { offset: -100 });

      expect(mockGetDeadLetterItems).toHaveBeenCalledWith('store-123', 50, 0);
    });

    it('should use default values when no params provided', async () => {
      mockGetDeadLetterItems.mockReturnValue({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
        hasMore: false,
      });

      const handler = getHandler('sync:getDeadLetterItems');
      await handler!({}, undefined);

      expect(mockGetDeadLetterItems).toHaveBeenCalledWith('store-123', 50, 0);
    });
  });

  // ==========================================================================
  // sync:getDeadLetterStats Tests
  // ==========================================================================

  describe('sync:getDeadLetterStats', () => {
    it('should return comprehensive DLQ statistics', async () => {
      const mockStats = {
        total: 10,
        byReason: {
          PERMANENT_ERROR: 5,
          MAX_ATTEMPTS_EXCEEDED: 3,
          STRUCTURAL_FAILURE: 2,
          MANUAL: 0,
        },
        byEntityType: {
          pack: 8,
          bin: 2,
        },
        byErrorCategory: {
          PERMANENT: 6,
          STRUCTURAL: 2,
          UNKNOWN: 2,
          TRANSIENT: 0,
        },
        oldestItem: '2024-01-01T00:00:00Z',
        newestItem: '2024-01-15T12:00:00Z',
      };

      mockGetDeadLetterStats.mockReturnValue(mockStats);

      const handler = getHandler('sync:getDeadLetterStats');
      expect(handler).toBeDefined();

      const result = await handler!({});

      expect(result.data).toEqual(mockStats);
      expect(mockGetDeadLetterStats).toHaveBeenCalledWith('store-123');
    });

    it('should return error if store not configured', async () => {
      mockGetConfiguredStore.mockReturnValue(undefined);

      const handler = getHandler('sync:getDeadLetterStats');
      const result = await handler!({});

      expect(result.error).toBe('NOT_CONFIGURED');
    });
  });

  // ==========================================================================
  // sync:restoreFromDeadLetter Tests
  // ==========================================================================

  describe('sync:restoreFromDeadLetter', () => {
    it('should restore item from DLQ', async () => {
      mockRestoreFromDeadLetter.mockReturnValue(true);

      const handler = getHandler('sync:restoreFromDeadLetter');
      expect(handler).toBeDefined();

      const result = await handler!({}, { id: 'dlq-item-123' });

      expect(result.data).toEqual({ restored: true, id: 'dlq-item-123' });
      expect(mockRestoreFromDeadLetter).toHaveBeenCalledWith('dlq-item-123');
    });

    it('should return NOT_FOUND when item not in DLQ', async () => {
      mockRestoreFromDeadLetter.mockReturnValue(false);

      const handler = getHandler('sync:restoreFromDeadLetter');
      const result = await handler!({}, { id: 'nonexistent-id' });

      expect(result.error).toBe('NOT_FOUND');
    });

    // API-001: Input validation
    it('should return VALIDATION_ERROR when id is missing', async () => {
      const handler = getHandler('sync:restoreFromDeadLetter');

      const result = await handler!({}, {});

      expect(result.error).toBe('VALIDATION_ERROR');
    });

    it('should return VALIDATION_ERROR when id is not a string', async () => {
      const handler = getHandler('sync:restoreFromDeadLetter');

      const result = await handler!({}, { id: 12345 });

      expect(result.error).toBe('VALIDATION_ERROR');
    });

    it('should return VALIDATION_ERROR when id is null', async () => {
      const handler = getHandler('sync:restoreFromDeadLetter');

      const result = await handler!({}, { id: null });

      expect(result.error).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================================================
  // sync:restoreFromDeadLetterMany Tests
  // ==========================================================================

  describe('sync:restoreFromDeadLetterMany', () => {
    it('should restore multiple items from DLQ', async () => {
      mockRestoreFromDeadLetterMany.mockReturnValue(3);

      const handler = getHandler('sync:restoreFromDeadLetterMany');
      expect(handler).toBeDefined();

      const result = await handler!({}, { ids: ['id-1', 'id-2', 'id-3'] });

      expect(result.data).toEqual({ requested: 3, restored: 3 });
      expect(mockRestoreFromDeadLetterMany).toHaveBeenCalledWith(['id-1', 'id-2', 'id-3']);
    });

    it('should return actual count of restored items', async () => {
      // Only 2 of 3 were actually in DLQ
      mockRestoreFromDeadLetterMany.mockReturnValue(2);

      const handler = getHandler('sync:restoreFromDeadLetterMany');
      const result = await handler!({}, { ids: ['id-1', 'id-2', 'id-3'] });

      expect(result.data).toEqual({ requested: 3, restored: 2 });
    });

    // API-001: Input validation
    it('should return VALIDATION_ERROR when ids is empty', async () => {
      const handler = getHandler('sync:restoreFromDeadLetterMany');

      const result = await handler!({}, { ids: [] });

      expect(result.error).toBe('VALIDATION_ERROR');
    });

    it('should return VALIDATION_ERROR when ids is not an array', async () => {
      const handler = getHandler('sync:restoreFromDeadLetterMany');

      const result = await handler!({}, { ids: 'not-an-array' });

      expect(result.error).toBe('VALIDATION_ERROR');
    });

    it('should return VALIDATION_ERROR when ids is null', async () => {
      const handler = getHandler('sync:restoreFromDeadLetterMany');

      const result = await handler!({}, { ids: null });

      expect(result.error).toBe('VALIDATION_ERROR');
    });

    // API-001: Batch size limit
    it('should limit batch size to 100 items (API-001)', async () => {
      const manyIds = Array.from({ length: 150 }, (_, i) => `id-${i}`);
      mockRestoreFromDeadLetterMany.mockReturnValue(100);

      const handler = getHandler('sync:restoreFromDeadLetterMany');
      await handler!({}, { ids: manyIds });

      expect(mockRestoreFromDeadLetterMany).toHaveBeenCalledWith(manyIds.slice(0, 100));
    });

    it('should filter out non-string IDs', async () => {
      mockRestoreFromDeadLetterMany.mockReturnValue(2);

      const handler = getHandler('sync:restoreFromDeadLetterMany');
      const result = await handler!({}, { ids: ['id-1', 123, 'id-2', null, 'id-3'] });

      // Only string IDs should be passed to DAL
      expect(mockRestoreFromDeadLetterMany).toHaveBeenCalledWith(['id-1', 'id-2', 'id-3']);
      expect(result.data).toEqual({ requested: 3, restored: 2 });
    });

    it('should return VALIDATION_ERROR when all IDs are invalid', async () => {
      const handler = getHandler('sync:restoreFromDeadLetterMany');

      const result = await handler!({}, { ids: [123, null, undefined, {}] });

      expect(result.error).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================================================
  // sync:deleteDeadLetterItem Tests
  // ==========================================================================

  describe('sync:deleteDeadLetterItem', () => {
    it('should delete item from DLQ permanently', async () => {
      mockDeleteDeadLetterItem.mockReturnValue(true);

      const handler = getHandler('sync:deleteDeadLetterItem');
      expect(handler).toBeDefined();

      const result = await handler!({}, { id: 'dlq-item-to-delete' });

      expect(result.data).toEqual({ deleted: true, id: 'dlq-item-to-delete' });
      expect(mockDeleteDeadLetterItem).toHaveBeenCalledWith('dlq-item-to-delete');
    });

    it('should return NOT_FOUND when item not in DLQ', async () => {
      mockDeleteDeadLetterItem.mockReturnValue(false);

      const handler = getHandler('sync:deleteDeadLetterItem');
      const result = await handler!({}, { id: 'nonexistent-id' });

      expect(result.error).toBe('NOT_FOUND');
    });

    // API-001: Input validation
    it('should return VALIDATION_ERROR when id is missing', async () => {
      const handler = getHandler('sync:deleteDeadLetterItem');

      const result = await handler!({}, {});

      expect(result.error).toBe('VALIDATION_ERROR');
    });

    it('should return VALIDATION_ERROR when id is not a string', async () => {
      const handler = getHandler('sync:deleteDeadLetterItem');

      const result = await handler!({}, { id: 12345 });

      expect(result.error).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================================================
  // sync:cleanupDeadLetter Tests
  // ==========================================================================

  describe('sync:cleanupDeadLetter', () => {
    it('should cleanup old DLQ items with default 30 days', async () => {
      mockDeleteDeadLetterItems.mockReturnValue(15);

      const handler = getHandler('sync:cleanupDeadLetter');
      expect(handler).toBeDefined();

      const result = await handler!({}, {});

      expect(result.data).toHaveProperty('deletedCount', 15);
      expect(result.data).toHaveProperty('cutoffDate');
      // Default is 30 days
      expect(mockDeleteDeadLetterItems).toHaveBeenCalledWith('store-123', expect.any(String));
    });

    it('should accept custom olderThanDays parameter', async () => {
      mockDeleteDeadLetterItems.mockReturnValue(5);

      const handler = getHandler('sync:cleanupDeadLetter');
      const result = await handler!({}, { olderThanDays: 60 });

      expect(result.data).toHaveProperty('deletedCount', 5);
    });

    it('should return error if store not configured', async () => {
      mockGetConfiguredStore.mockReturnValue(undefined);

      const handler = getHandler('sync:cleanupDeadLetter');
      const result = await handler!({}, {});

      expect(result.error).toBe('NOT_CONFIGURED');
    });

    // API-001: Input bounds
    it('should enforce minimum of 7 days (API-001)', async () => {
      mockDeleteDeadLetterItems.mockReturnValue(0);

      const handler = getHandler('sync:cleanupDeadLetter');
      await handler!({}, { olderThanDays: 1 });

      // Calculate expected cutoff date (7 days ago minimum)
      const call = mockDeleteDeadLetterItems.mock.calls[0];
      const cutoffDate = new Date(call[1] as string);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Allow 1 minute tolerance for test execution time
      expect(Math.abs(cutoffDate.getTime() - sevenDaysAgo.getTime())).toBeLessThan(60000);
    });

    it('should enforce maximum of 365 days (API-001)', async () => {
      mockDeleteDeadLetterItems.mockReturnValue(0);

      const handler = getHandler('sync:cleanupDeadLetter');
      await handler!({}, { olderThanDays: 1000 });

      // Calculate expected cutoff date (365 days maximum)
      const call = mockDeleteDeadLetterItems.mock.calls[0];
      const cutoffDate = new Date(call[1] as string);
      const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

      // Allow 1 minute tolerance for test execution time
      expect(Math.abs(cutoffDate.getTime() - oneYearAgo.getTime())).toBeLessThan(60000);
    });
  });

  // ==========================================================================
  // sync:manualDeadLetter Tests
  // ==========================================================================

  describe('sync:manualDeadLetter', () => {
    it('should manually dead-letter an item', async () => {
      mockDeadLetter.mockReturnValue(true);

      const handler = getHandler('sync:manualDeadLetter');
      expect(handler).toBeDefined();

      const result = await handler!(
        {},
        { id: 'item-to-deadletter', reason: 'Known unfixable issue' }
      );

      expect(result.data).toEqual({ deadLettered: true, id: 'item-to-deadletter' });
      expect(mockDeadLetter).toHaveBeenCalledWith({
        id: 'item-to-deadletter',
        reason: 'MANUAL',
        errorCategory: 'UNKNOWN',
        error: 'Known unfixable issue',
      });
    });

    it('should use default error message when reason not provided', async () => {
      mockDeadLetter.mockReturnValue(true);

      const handler = getHandler('sync:manualDeadLetter');
      await handler!({}, { id: 'item-123' });

      expect(mockDeadLetter).toHaveBeenCalledWith({
        id: 'item-123',
        reason: 'MANUAL',
        errorCategory: 'UNKNOWN',
        error: 'Manually moved to Dead Letter Queue',
      });
    });

    it('should return NOT_FOUND when item not found or already dead-lettered', async () => {
      mockDeadLetter.mockReturnValue(false);

      const handler = getHandler('sync:manualDeadLetter');
      const result = await handler!({}, { id: 'already-dead-lettered' });

      expect(result.error).toBe('NOT_FOUND');
    });

    // API-001: Input validation
    it('should return VALIDATION_ERROR when id is missing', async () => {
      const handler = getHandler('sync:manualDeadLetter');

      const result = await handler!({}, {});

      expect(result.error).toBe('VALIDATION_ERROR');
    });

    it('should return VALIDATION_ERROR when id is not a string', async () => {
      const handler = getHandler('sync:manualDeadLetter');

      const result = await handler!({}, { id: 12345 });

      expect(result.error).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================================================
  // Security Tests
  // ==========================================================================

  describe('Security - SEC-006 SQL Injection Prevention', () => {
    it('should pass potentially malicious ID directly to DAL (SEC-006)', async () => {
      mockRestoreFromDeadLetter.mockReturnValue(false);

      const handler = getHandler('sync:restoreFromDeadLetter');
      await handler!({}, { id: "'; DROP TABLE sync_queue; --" });

      // ID should be passed as-is, DAL handles parameterization
      expect(mockRestoreFromDeadLetter).toHaveBeenCalledWith("'; DROP TABLE sync_queue; --");
    });

    it('should pass potentially malicious IDs in batch (SEC-006)', async () => {
      mockRestoreFromDeadLetterMany.mockReturnValue(0);

      const handler = getHandler('sync:restoreFromDeadLetterMany');
      await handler!(
        {},
        {
          ids: ["'; DELETE FROM sync_queue; --", '1 OR 1=1', '$(cat /etc/passwd)'],
        }
      );

      // IDs should be passed as-is, DAL handles parameterization
      expect(mockRestoreFromDeadLetterMany).toHaveBeenCalledWith([
        "'; DELETE FROM sync_queue; --",
        '1 OR 1=1',
        '$(cat /etc/passwd)',
      ]);
    });
  });

  // ==========================================================================
  // Tenant Isolation Tests - DB-006
  // ==========================================================================

  describe('Tenant Isolation - DB-006', () => {
    it('should use store_id from configured store for all queries', async () => {
      mockGetConfiguredStore.mockReturnValue({
        store_id: 'tenant-specific-store',
        name: 'Tenant Store',
      } as ReturnType<typeof storesDAL.getConfiguredStore>);

      mockGetDeadLetterItems.mockReturnValue({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
        hasMore: false,
      });

      const handler = getHandler('sync:getDeadLetterItems');
      await handler!({}, {});

      expect(mockGetDeadLetterItems).toHaveBeenCalledWith(
        'tenant-specific-store',
        expect.any(Number),
        expect.any(Number)
      );
    });

    it('should scope stats query to store_id', async () => {
      mockGetConfiguredStore.mockReturnValue({
        store_id: 'isolated-tenant',
        name: 'Isolated Store',
      } as ReturnType<typeof storesDAL.getConfiguredStore>);

      mockGetDeadLetterStats.mockReturnValue({
        total: 0,
        byReason: {
          MANUAL: 0,
          MAX_ATTEMPTS_EXCEEDED: 0,
          PERMANENT_ERROR: 0,
          STRUCTURAL_FAILURE: 0,
        },
        byEntityType: {},
        byErrorCategory: {
          UNKNOWN: 0,
          TRANSIENT: 0,
          PERMANENT: 0,
          STRUCTURAL: 0,
        },
        oldestItem: null,
        newestItem: null,
      });

      const handler = getHandler('sync:getDeadLetterStats');
      await handler!({});

      expect(mockGetDeadLetterStats).toHaveBeenCalledWith('isolated-tenant');
    });

    it('should scope cleanup to store_id', async () => {
      mockGetConfiguredStore.mockReturnValue({
        store_id: 'cleanup-tenant',
        name: 'Cleanup Store',
      } as ReturnType<typeof storesDAL.getConfiguredStore>);

      mockDeleteDeadLetterItems.mockReturnValue(0);

      const handler = getHandler('sync:cleanupDeadLetter');
      await handler!({}, { olderThanDays: 30 });

      expect(mockDeleteDeadLetterItems).toHaveBeenCalledWith('cleanup-tenant', expect.any(String));
    });
  });
});
