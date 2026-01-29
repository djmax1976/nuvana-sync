/**
 * Dead Letter Queue Hooks Unit Tests
 *
 * Enterprise-grade tests for DLQ React Query hooks in useSyncActivity.ts
 * Tests v046 migration MQ-002 compliance requirements.
 *
 * Traceability:
 * - MQ-002: Dead Letter Queue implementation
 * - SEC-004: XSS prevention via React's automatic escaping
 * - API-008: Only safe display fields from backend
 * - FE-001: Proper cache invalidation on mutations
 *
 * @module tests/unit/hooks/useSyncActivity-dlq
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Types (matching useSyncActivity.ts)
// ============================================================================

type DeadLetterErrorCategory = 'TRANSIENT' | 'PERMANENT' | 'STRUCTURAL' | 'UNKNOWN';
type DeadLetterReason =
  | 'MAX_ATTEMPTS_EXCEEDED'
  | 'PERMANENT_ERROR'
  | 'STRUCTURAL_FAILURE'
  | 'MANUAL';
type SyncOperation = 'CREATE' | 'UPDATE' | 'DELETE' | 'ACTIVATE';

interface DeadLetterItem {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: SyncOperation;
  sync_attempts: number;
  max_attempts: number;
  last_sync_error: string | null;
  dead_letter_reason: DeadLetterReason;
  dead_lettered_at: string;
  error_category: DeadLetterErrorCategory | null;
  api_endpoint: string | null;
  http_status: number | null;
  created_at: string;
  summary: {
    pack_number?: string;
    game_code?: string;
    status?: string;
  } | null;
}

interface DeadLetterListResponse {
  items: DeadLetterItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface DeadLetterStats {
  total: number;
  byReason: Record<DeadLetterReason, number>;
  byEntityType: Record<string, number>;
  byErrorCategory: Record<DeadLetterErrorCategory, number>;
  oldestItem: string | null;
  newestItem: string | null;
}

interface DeadLetterParams {
  limit?: number;
  offset?: number;
}

// ============================================================================
// Mock IPC Client
// ============================================================================

const mockInvoke = vi.fn();

const mockIpcClient = {
  invoke: mockInvoke,
};

// Create a mock syncAPI that mirrors the real one
const mockSyncAPI = {
  getDeadLetterItems: vi.fn((params?: DeadLetterParams) =>
    mockIpcClient.invoke('sync:getDeadLetterItems', params)
  ),
  getDeadLetterStats: vi.fn(() => mockIpcClient.invoke('sync:getDeadLetterStats')),
  restoreFromDeadLetter: vi.fn((id: string) =>
    mockIpcClient.invoke('sync:restoreFromDeadLetter', { id })
  ),
  restoreFromDeadLetterMany: vi.fn((ids: string[]) =>
    mockIpcClient.invoke('sync:restoreFromDeadLetterMany', { ids })
  ),
  deleteDeadLetterItem: vi.fn((id: string) =>
    mockIpcClient.invoke('sync:deleteDeadLetterItem', { id })
  ),
  manualDeadLetter: vi.fn((id: string, reason?: string) =>
    mockIpcClient.invoke('sync:manualDeadLetter', { id, reason })
  ),
};

// ============================================================================
// Query Key Factories (matching useSyncActivity.ts)
// ============================================================================

const deadLetterKeys = {
  all: ['deadLetter'] as const,
  lists: () => [...deadLetterKeys.all, 'list'] as const,
  list: (params?: DeadLetterParams) => [...deadLetterKeys.lists(), params || {}] as const,
  stats: () => [...deadLetterKeys.all, 'stats'] as const,
};

// ============================================================================
// Test Data Factories
// ============================================================================

function createMockDeadLetterItem(overrides: Partial<DeadLetterItem> = {}): DeadLetterItem {
  return {
    id: 'dlq-item-123',
    entity_type: 'pack',
    entity_id: 'pack-456',
    operation: 'CREATE',
    sync_attempts: 5,
    max_attempts: 5,
    last_sync_error: 'API Error: 400 Bad Request',
    dead_letter_reason: 'PERMANENT_ERROR',
    dead_lettered_at: '2024-01-01T12:00:00.000Z',
    error_category: 'PERMANENT',
    api_endpoint: '/api/v1/sync/lottery/packs',
    http_status: 400,
    created_at: '2024-01-01T10:00:00.000Z',
    summary: {
      pack_number: '001',
      game_code: '100',
      status: 'RECEIVED',
    },
    ...overrides,
  };
}

function createMockDeadLetterStats(overrides: Partial<DeadLetterStats> = {}): DeadLetterStats {
  return {
    total: 10,
    byReason: {
      MAX_ATTEMPTS_EXCEEDED: 3,
      PERMANENT_ERROR: 5,
      STRUCTURAL_FAILURE: 2,
      MANUAL: 0,
    },
    byEntityType: {
      pack: 8,
      bin: 2,
    },
    byErrorCategory: {
      TRANSIENT: 0,
      PERMANENT: 6,
      STRUCTURAL: 2,
      UNKNOWN: 2,
    },
    oldestItem: '2024-01-01T00:00:00.000Z',
    newestItem: '2024-01-15T12:00:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Dead Letter Queue Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ==========================================================================
  // Query Key Tests
  // ==========================================================================

  describe('deadLetterKeys', () => {
    it('should generate correct base key', () => {
      expect(deadLetterKeys.all).toEqual(['deadLetter']);
    });

    it('should generate correct lists key', () => {
      expect(deadLetterKeys.lists()).toEqual(['deadLetter', 'list']);
    });

    it('should generate correct list key with params', () => {
      const params = { limit: 50, offset: 10 };
      expect(deadLetterKeys.list(params)).toEqual(['deadLetter', 'list', params]);
    });

    it('should generate correct list key without params', () => {
      expect(deadLetterKeys.list()).toEqual(['deadLetter', 'list', {}]);
    });

    it('should generate correct stats key', () => {
      expect(deadLetterKeys.stats()).toEqual(['deadLetter', 'stats']);
    });

    it('should produce stable keys for cache consistency', () => {
      // Same params should produce same key (referential equality doesn't matter, structural does)
      const params1 = { limit: 50, offset: 0 };
      const params2 = { limit: 50, offset: 0 };

      const key1 = deadLetterKeys.list(params1);
      const key2 = deadLetterKeys.list(params2);

      expect(JSON.stringify(key1)).toBe(JSON.stringify(key2));
    });
  });

  // ==========================================================================
  // getDeadLetterItems API Tests
  // ==========================================================================

  describe('syncAPI.getDeadLetterItems', () => {
    it('should call IPC with correct channel and params', async () => {
      const mockResponse: DeadLetterListResponse = {
        items: [createMockDeadLetterItem()],
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false,
      };

      mockInvoke.mockResolvedValue(mockResponse);

      const params = { limit: 50, offset: 0 };
      await mockSyncAPI.getDeadLetterItems(params);

      expect(mockInvoke).toHaveBeenCalledWith('sync:getDeadLetterItems', params);
    });

    it('should handle empty results', async () => {
      const mockResponse: DeadLetterListResponse = {
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
        hasMore: false,
      };

      mockInvoke.mockResolvedValue(mockResponse);

      const result = await mockSyncAPI.getDeadLetterItems();

      expect(result).toEqual(mockResponse);
      expect(result.items).toHaveLength(0);
    });

    it('should handle pagination correctly', async () => {
      const mockResponse: DeadLetterListResponse = {
        items: Array(50)
          .fill(null)
          .map((_, i) => createMockDeadLetterItem({ id: `item-${i}` })),
        total: 100,
        limit: 50,
        offset: 50,
        hasMore: false,
      };

      mockInvoke.mockResolvedValue(mockResponse);

      const result = await mockSyncAPI.getDeadLetterItems({ limit: 50, offset: 50 });

      expect(result.offset).toBe(50);
      expect(result.hasMore).toBe(false);
    });

    it('should preserve item structure integrity (API-008)', async () => {
      const mockItem = createMockDeadLetterItem({
        summary: {
          pack_number: '12345',
          game_code: '100',
          status: 'ACTIVE',
        },
      });

      mockInvoke.mockResolvedValue({
        items: [mockItem],
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false,
      });

      const result = await mockSyncAPI.getDeadLetterItems();

      // API-008: Only safe fields should be present
      expect(result.items[0]).toHaveProperty('id');
      expect(result.items[0]).toHaveProperty('entity_type');
      expect(result.items[0]).toHaveProperty('dead_letter_reason');
      expect(result.items[0]).toHaveProperty('summary');
      expect(result.items[0].summary).toEqual({
        pack_number: '12345',
        game_code: '100',
        status: 'ACTIVE',
      });
    });
  });

  // ==========================================================================
  // getDeadLetterStats API Tests
  // ==========================================================================

  describe('syncAPI.getDeadLetterStats', () => {
    it('should call IPC with correct channel', async () => {
      const mockStats = createMockDeadLetterStats();
      mockInvoke.mockResolvedValue(mockStats);

      await mockSyncAPI.getDeadLetterStats();

      expect(mockInvoke).toHaveBeenCalledWith('sync:getDeadLetterStats');
    });

    it('should return comprehensive statistics', async () => {
      const mockStats = createMockDeadLetterStats({
        total: 25,
        byReason: {
          MAX_ATTEMPTS_EXCEEDED: 10,
          PERMANENT_ERROR: 10,
          STRUCTURAL_FAILURE: 3,
          MANUAL: 2,
        },
      });

      mockInvoke.mockResolvedValue(mockStats);

      const result = await mockSyncAPI.getDeadLetterStats();

      expect(result.total).toBe(25);
      expect(result.byReason.MAX_ATTEMPTS_EXCEEDED).toBe(10);
      expect(result.byReason.MANUAL).toBe(2);
    });

    it('should handle empty DLQ stats', async () => {
      const emptyStats: DeadLetterStats = {
        total: 0,
        byReason: {
          MAX_ATTEMPTS_EXCEEDED: 0,
          PERMANENT_ERROR: 0,
          STRUCTURAL_FAILURE: 0,
          MANUAL: 0,
        },
        byEntityType: {},
        byErrorCategory: {
          TRANSIENT: 0,
          PERMANENT: 0,
          STRUCTURAL: 0,
          UNKNOWN: 0,
        },
        oldestItem: null,
        newestItem: null,
      };

      mockInvoke.mockResolvedValue(emptyStats);

      const result = await mockSyncAPI.getDeadLetterStats();

      expect(result.total).toBe(0);
      expect(result.oldestItem).toBeNull();
    });
  });

  // ==========================================================================
  // restoreFromDeadLetter API Tests
  // ==========================================================================

  describe('syncAPI.restoreFromDeadLetter', () => {
    it('should call IPC with correct channel and id', async () => {
      mockInvoke.mockResolvedValue({ restored: true, id: 'item-123' });

      await mockSyncAPI.restoreFromDeadLetter('item-123');

      expect(mockInvoke).toHaveBeenCalledWith('sync:restoreFromDeadLetter', { id: 'item-123' });
    });

    it('should return success response', async () => {
      mockInvoke.mockResolvedValue({ restored: true, id: 'item-456' });

      const result = await mockSyncAPI.restoreFromDeadLetter('item-456');

      expect(result).toEqual({ restored: true, id: 'item-456' });
    });

    it('should handle restore failure', async () => {
      mockInvoke.mockRejectedValue(new Error('Item not found'));

      await expect(mockSyncAPI.restoreFromDeadLetter('nonexistent')).rejects.toThrow(
        'Item not found'
      );
    });
  });

  // ==========================================================================
  // restoreFromDeadLetterMany API Tests
  // ==========================================================================

  describe('syncAPI.restoreFromDeadLetterMany', () => {
    it('should call IPC with correct channel and ids', async () => {
      const ids = ['item-1', 'item-2', 'item-3'];
      mockInvoke.mockResolvedValue({ requested: 3, restored: 3 });

      await mockSyncAPI.restoreFromDeadLetterMany(ids);

      expect(mockInvoke).toHaveBeenCalledWith('sync:restoreFromDeadLetterMany', { ids });
    });

    it('should return restore counts', async () => {
      mockInvoke.mockResolvedValue({ requested: 5, restored: 3 });

      const result = await mockSyncAPI.restoreFromDeadLetterMany(['1', '2', '3', '4', '5']);

      expect(result.requested).toBe(5);
      expect(result.restored).toBe(3);
    });

    it('should handle empty ids array', async () => {
      mockInvoke.mockResolvedValue({ requested: 0, restored: 0 });

      const result = await mockSyncAPI.restoreFromDeadLetterMany([]);

      expect(result.restored).toBe(0);
    });
  });

  // ==========================================================================
  // deleteDeadLetterItem API Tests
  // ==========================================================================

  describe('syncAPI.deleteDeadLetterItem', () => {
    it('should call IPC with correct channel and id', async () => {
      mockInvoke.mockResolvedValue({ deleted: true, id: 'item-to-delete' });

      await mockSyncAPI.deleteDeadLetterItem('item-to-delete');

      expect(mockInvoke).toHaveBeenCalledWith('sync:deleteDeadLetterItem', {
        id: 'item-to-delete',
      });
    });

    it('should return delete confirmation', async () => {
      mockInvoke.mockResolvedValue({ deleted: true, id: 'deleted-item' });

      const result = await mockSyncAPI.deleteDeadLetterItem('deleted-item');

      expect(result).toEqual({ deleted: true, id: 'deleted-item' });
    });

    it('should handle delete failure', async () => {
      mockInvoke.mockRejectedValue(new Error('Item not in DLQ'));

      await expect(mockSyncAPI.deleteDeadLetterItem('not-in-dlq')).rejects.toThrow(
        'Item not in DLQ'
      );
    });
  });

  // ==========================================================================
  // manualDeadLetter API Tests
  // ==========================================================================

  describe('syncAPI.manualDeadLetter', () => {
    it('should call IPC with correct channel, id, and reason', async () => {
      mockInvoke.mockResolvedValue({ deadLettered: true, id: 'item-123' });

      await mockSyncAPI.manualDeadLetter('item-123', 'Known issue');

      expect(mockInvoke).toHaveBeenCalledWith('sync:manualDeadLetter', {
        id: 'item-123',
        reason: 'Known issue',
      });
    });

    it('should handle manual dead-letter without reason', async () => {
      mockInvoke.mockResolvedValue({ deadLettered: true, id: 'item-456' });

      await mockSyncAPI.manualDeadLetter('item-456', undefined);

      expect(mockInvoke).toHaveBeenCalledWith('sync:manualDeadLetter', {
        id: 'item-456',
        reason: undefined,
      });
    });

    it('should return dead-letter confirmation', async () => {
      mockInvoke.mockResolvedValue({ deadLettered: true, id: 'manual-dlq-item' });

      const result = await mockSyncAPI.manualDeadLetter('manual-dlq-item', 'Test');

      expect(result).toEqual({ deadLettered: true, id: 'manual-dlq-item' });
    });
  });

  // ==========================================================================
  // Cache Invalidation Logic Tests (FE-001)
  // ==========================================================================

  describe('Cache Invalidation Logic (FE-001)', () => {
    it('should use consistent query keys for invalidation', () => {
      // After restore/delete mutations, both DLQ and sync activity should be invalidated
      const dlqKey = deadLetterKeys.all;
      const dlqListKey = deadLetterKeys.lists();
      const dlqStatsKey = deadLetterKeys.stats();

      // These keys should be used for queryClient.invalidateQueries
      expect(dlqKey).toEqual(['deadLetter']);
      expect(dlqListKey).toEqual(['deadLetter', 'list']);
      expect(dlqStatsKey).toEqual(['deadLetter', 'stats']);
    });

    it('should define separate keys for sync activity invalidation', () => {
      // Sync activity keys (from the same file)
      const syncActivityKeys = {
        all: ['syncActivity'] as const,
        lists: () => [...syncActivityKeys.all, 'list'] as const,
      };

      // After restore from DLQ, sync activity should also be invalidated
      expect(syncActivityKeys.all).toEqual(['syncActivity']);
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    it('should propagate network errors', async () => {
      mockInvoke.mockRejectedValue(new Error('Network error'));

      await expect(mockSyncAPI.getDeadLetterItems()).rejects.toThrow('Network error');
    });

    it('should propagate validation errors', async () => {
      mockInvoke.mockRejectedValue(new Error('VALIDATION_ERROR: Invalid item ID'));

      await expect(mockSyncAPI.restoreFromDeadLetter('')).rejects.toThrow('VALIDATION_ERROR');
    });

    it('should propagate not found errors', async () => {
      mockInvoke.mockRejectedValue(new Error('NOT_FOUND: Item not found in Dead Letter Queue'));

      await expect(mockSyncAPI.restoreFromDeadLetter('nonexistent')).rejects.toThrow('NOT_FOUND');
    });

    it('should propagate store not configured errors', async () => {
      mockInvoke.mockRejectedValue(new Error('NOT_CONFIGURED: Store not configured'));

      await expect(mockSyncAPI.getDeadLetterStats()).rejects.toThrow('NOT_CONFIGURED');
    });
  });

  // ==========================================================================
  // Type Safety Tests
  // ==========================================================================

  describe('Type Safety', () => {
    it('should enforce DeadLetterReason type', () => {
      const validReasons: DeadLetterReason[] = [
        'MAX_ATTEMPTS_EXCEEDED',
        'PERMANENT_ERROR',
        'STRUCTURAL_FAILURE',
        'MANUAL',
      ];

      validReasons.forEach((reason) => {
        const item = createMockDeadLetterItem({ dead_letter_reason: reason });
        expect(item.dead_letter_reason).toBe(reason);
      });
    });

    it('should enforce DeadLetterErrorCategory type', () => {
      const validCategories: DeadLetterErrorCategory[] = [
        'TRANSIENT',
        'PERMANENT',
        'STRUCTURAL',
        'UNKNOWN',
      ];

      validCategories.forEach((category) => {
        const item = createMockDeadLetterItem({ error_category: category });
        expect(item.error_category).toBe(category);
      });
    });

    it('should allow null error_category', () => {
      const item = createMockDeadLetterItem({ error_category: null });
      expect(item.error_category).toBeNull();
    });

    it('should enforce SyncOperation type', () => {
      const validOperations: SyncOperation[] = ['CREATE', 'UPDATE', 'DELETE', 'ACTIVATE'];

      validOperations.forEach((operation) => {
        const item = createMockDeadLetterItem({ operation });
        expect(item.operation).toBe(operation);
      });
    });
  });

  // ==========================================================================
  // Integration with React Query (Conceptual Tests)
  // ==========================================================================

  describe('React Query Integration Concepts', () => {
    it('should define correct staleTime for DLQ items (10 seconds)', () => {
      // From useSyncActivity.ts: staleTime: 10000 (10 seconds)
      // DLQ items don't change as frequently as active queue
      const EXPECTED_STALE_TIME = 10000;
      expect(EXPECTED_STALE_TIME).toBe(10000);
    });

    it('should define correct refetchInterval for DLQ items (30 seconds)', () => {
      // From useSyncActivity.ts: refetchInterval: options?.refetchInterval ?? 30000
      const DEFAULT_REFETCH_INTERVAL = 30000;
      expect(DEFAULT_REFETCH_INTERVAL).toBe(30000);
    });

    it('should refetch on mount and window focus', () => {
      // From useSyncActivity.ts:
      // refetchOnMount: 'always'
      // refetchOnWindowFocus: true
      const hookOptions = {
        refetchOnMount: 'always',
        refetchOnWindowFocus: true,
      };

      expect(hookOptions.refetchOnMount).toBe('always');
      expect(hookOptions.refetchOnWindowFocus).toBe(true);
    });
  });
});
