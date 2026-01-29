/**
 * Sync Queue DAL Unit Tests
 *
 * @module tests/unit/dal/sync-queue.dal.spec
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database service
const mockPrepare = vi.fn();
const mockTransaction = vi.fn((fn) => () => fn());

vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-uuid-1234'),
}));

import { SyncQueueDAL, type SyncQueueItem } from '../../../src/main/dal/sync-queue.dal';

describe('SyncQueueDAL', () => {
  let dal: SyncQueueDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new SyncQueueDAL();
  });

  describe('enqueue', () => {
    it('should create new sync queue item', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockItem: SyncQueueItem = {
        id: 'mock-uuid-1234',
        store_id: 'store-123',
        entity_type: 'transaction',
        entity_id: 'txn-456',
        operation: 'CREATE',
        payload: '{"amount":100}',
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-01T00:00:00.000Z',
        synced_at: null,
        sync_direction: 'PUSH',
        api_endpoint: null,
        http_status: null,
        response_body: null,
        // v046 DLQ fields
        dead_lettered: 0,
        dead_letter_reason: null,
        dead_lettered_at: null,
        error_category: null,
        retry_after: null,
      };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockItem) });

      const result = dal.enqueue({
        store_id: 'store-123',
        entity_type: 'transaction',
        entity_id: 'txn-456',
        operation: 'CREATE',
        payload: { amount: 100 },
      });

      expect(result).toEqual(mockItem);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO sync_queue'));
    });

    it('should serialize payload to JSON', () => {
      const mockRun = vi.fn();
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({}) });

      dal.enqueue({
        store_id: 'store-123',
        entity_type: 'transaction',
        entity_id: 'txn-456',
        operation: 'UPDATE',
        payload: { complex: { nested: 'data' } },
      });

      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String), // id
        'store-123',
        'transaction',
        'txn-456',
        'UPDATE',
        '{"complex":{"nested":"data"}}', // JSON serialized
        expect.any(Number), // priority
        expect.any(Number), // max_attempts
        expect.any(String), // created_at
        'PUSH' // sync_direction (default)
      );
    });
  });

  describe('getUnsynced', () => {
    it('should return unsynced items ordered by priority and created_at', () => {
      const mockItems: SyncQueueItem[] = [
        {
          id: '1',
          store_id: 'store-123',
          entity_type: 'transaction',
          entity_id: 'txn-1',
          operation: 'CREATE',
          payload: '{}',
          priority: 1,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-01T00:00:00.000Z',
          synced_at: null,
          sync_direction: 'PUSH',
          api_endpoint: null,
          http_status: null,
          response_body: null,
          // v046 DLQ fields
          dead_lettered: 0,
          dead_letter_reason: null,
          dead_lettered_at: null,
          error_category: null,
          retry_after: null,
        },
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockItems),
      });

      const result = dal.getUnsynced(100);

      expect(result).toEqual(mockItems);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE synced = 0'));
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('sync_attempts < max_attempts')
      );
    });

    it('should respect limit parameter', () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValue({ all: mockAll });

      dal.getUnsynced(50);

      expect(mockAll).toHaveBeenCalledWith(50);
    });

    it('should cap limit at maximum batch size', () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValue({ all: mockAll });

      dal.getUnsynced(1000); // Request more than max

      expect(mockAll).toHaveBeenCalledWith(500); // Should be capped
    });
  });

  describe('markSynced', () => {
    it('should update synced flag and timestamp', () => {
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.markSynced('item-123');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE sync_queue SET'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('synced = 1'));
      // markSynced now includes: synced_at, last_attempt_at, api_endpoint, http_status, response_body, id
      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String), // synced_at
        expect.any(String), // last_attempt_at
        null, // api_endpoint (no apiContext provided)
        null, // http_status
        null, // response_body
        'item-123' // id
      );
    });

    it('should include API context when provided', () => {
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.markSynced('item-123', {
        api_endpoint: '/api/sync',
        http_status: 200,
        response_body: '{"success":true}',
      });

      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String), // synced_at
        expect.any(String), // last_attempt_at
        '/api/sync', // api_endpoint
        200, // http_status
        '{"success":true}', // response_body
        'item-123' // id
      );
    });
  });

  describe('markManySynced', () => {
    it('should update multiple items', () => {
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.markManySynced(['id-1', 'id-2', 'id-3']);

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE id IN (?, ?, ?)'));
    });

    it('should handle empty array', () => {
      dal.markManySynced([]);

      expect(mockPrepare).not.toHaveBeenCalled();
    });
  });

  describe('incrementAttempts', () => {
    it('should increment attempt count and record error', () => {
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.incrementAttempts('item-123', 'Connection timeout');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('sync_attempts = sync_attempts + 1')
      );
      // incrementAttempts now includes: error, last_attempt_at, api_endpoint, http_status, response_body, id
      expect(mockRun).toHaveBeenCalledWith(
        'Connection timeout', // error
        expect.any(String), // last_attempt_at
        null, // api_endpoint (no apiContext provided)
        null, // http_status
        null, // response_body
        'item-123' // id
      );
    });

    it('should include API context when provided', () => {
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.incrementAttempts('item-123', 'API error', {
        api_endpoint: '/api/sync',
        http_status: 500,
        response_body: '{"error":"Internal server error"}',
      });

      expect(mockRun).toHaveBeenCalledWith(
        'API error', // error
        expect.any(String), // last_attempt_at
        '/api/sync', // api_endpoint
        500, // http_status
        '{"error":"Internal server error"}', // response_body
        'item-123' // id
      );
    });
  });

  describe('getPendingCount', () => {
    it('should return count of unsynced items for store', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ count: 42 }),
      });

      const result = dal.getPendingCount('store-123');

      expect(result).toBe(42);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE store_id = ? AND synced = 0')
      );
    });

    it('should return global count when no store specified', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ count: 100 }),
      });

      const result = dal.getPendingCount();

      expect(result).toBe(100);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE synced = 0'));
    });
  });

  describe('getFailedCount', () => {
    it('should return count of failed items', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ count: 5 }),
      });

      const result = dal.getFailedCount('store-123');

      expect(result).toBe(5);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('sync_attempts >= max_attempts')
      );
    });
  });

  describe('retryFailed', () => {
    it('should reset attempt counts for specified items', () => {
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.retryFailed(['id-1', 'id-2']);

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('sync_attempts = 0'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('last_sync_error = NULL'));
    });
  });

  describe('deleteOldSynced', () => {
    it('should delete synced items older than date', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 10 }),
      });

      const result = dal.deleteOldSynced('2024-01-01');

      expect(result).toBe(10);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE synced = 1 AND synced_at < ?')
      );
    });
  });

  describe('getQueuedCount', () => {
    it('should return count of items still retryable (sync_attempts < max_attempts)', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ count: 15 }),
      });

      const result = dal.getQueuedCount('store-123');

      expect(result).toBe(15);
      // SEC-006: Verify parameterized query
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining(
          'WHERE store_id = ? AND synced = 0 AND sync_attempts < max_attempts'
        )
      );
    });

    it('should return 0 when no queued items exist', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ count: 0 }),
      });

      const result = dal.getQueuedCount('store-123');

      expect(result).toBe(0);
    });

    // DB-006: Tenant isolation test
    it('should be scoped to store_id for tenant isolation', () => {
      const mockGet = vi.fn().mockReturnValue({ count: 5 });
      mockPrepare.mockReturnValue({ get: mockGet });

      dal.getQueuedCount('tenant-store-abc');

      expect(mockGet).toHaveBeenCalledWith('tenant-store-abc');
    });
  });

  describe('getExclusiveCounts', () => {
    it('should return mutually exclusive counts in single query', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          queued: 74,
          failed: 1,
          total_pending: 75,
          synced_today: 303,
        }),
      });

      const result = dal.getExclusiveCounts('store-123');

      expect(result).toEqual({
        queued: 74,
        failed: 1,
        totalPending: 75,
        syncedToday: 303,
      });
    });

    it('should satisfy invariant: queued + failed = totalPending', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          queued: 74,
          failed: 1,
          total_pending: 75,
          synced_today: 303,
        }),
      });

      const result = dal.getExclusiveCounts('store-123');

      // Enterprise invariant verification
      expect(result.queued + result.failed).toBe(result.totalPending);
    });

    it('should handle null results gracefully (empty table)', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          queued: null,
          failed: null,
          total_pending: null,
          synced_today: null,
        }),
      });

      const result = dal.getExclusiveCounts('store-123');

      expect(result).toEqual({
        queued: 0,
        failed: 0,
        totalPending: 0,
        syncedToday: 0,
      });
    });

    // SEC-006: SQL injection prevention test
    it('should use parameterized query for security', () => {
      const mockGet = vi.fn().mockReturnValue({
        queued: 10,
        failed: 2,
        total_pending: 12,
        synced_today: 50,
      });
      mockPrepare.mockReturnValue({ get: mockGet });

      dal.getExclusiveCounts('store-123');

      // Verify store_id is passed as parameter, not interpolated
      expect(mockGet).toHaveBeenCalledWith('store-123');
    });

    // Performance: Single query optimization test
    it('should use single optimized query (no N+1 pattern)', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          queued: 10,
          failed: 2,
          total_pending: 12,
          synced_today: 50,
        }),
      });

      dal.getExclusiveCounts('store-123');

      // Should only call prepare once (single query)
      expect(mockPrepare).toHaveBeenCalledTimes(1);
    });

    // Edge case: Large numbers
    it('should handle large counts correctly', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          queued: 999999,
          failed: 1,
          total_pending: 1000000,
          synced_today: 5000000,
        }),
      });

      const result = dal.getExclusiveCounts('store-123');

      expect(result.queued).toBe(999999);
      expect(result.totalPending).toBe(1000000);
      expect(result.queued + result.failed).toBe(result.totalPending);
    });
  });

  describe('getStats', () => {
    it('should return comprehensive sync statistics with mutually exclusive counts', () => {
      // getStats now calls getExclusiveCounts internally
      mockPrepare
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({
            queued: 8,
            failed: 2,
            total_pending: 10,
            synced_today: 50,
          }), // getExclusiveCounts
        })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ created_at: '2024-01-01T00:00:00Z' }), // oldest
        });

      const stats = dal.getStats('store-123');

      expect(stats).toEqual({
        pending: 10, // Total unsynced (backward compatible)
        queued: 8, // NEW: Items still retryable
        failed: 2, // Items exceeded max retries
        syncedToday: 50,
        oldestPending: '2024-01-01T00:00:00Z',
      });
    });

    it('should satisfy invariant: queued + failed = pending', () => {
      mockPrepare
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({
            queued: 74,
            failed: 1,
            total_pending: 75,
            synced_today: 303,
          }),
        })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ created_at: '2024-01-01T00:00:00Z' }),
        });

      const stats = dal.getStats('store-123');

      // Enterprise invariant verification
      expect(stats.queued + stats.failed).toBe(stats.pending);
    });

    it('should return null for oldestPending when queue is empty', () => {
      mockPrepare
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({
            queued: 0,
            failed: 0,
            total_pending: 0,
            synced_today: 100,
          }),
        })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue(undefined), // No pending items
        });

      const stats = dal.getStats('store-123');

      expect(stats.oldestPending).toBeNull();
      expect(stats.pending).toBe(0);
      expect(stats.queued).toBe(0);
      expect(stats.failed).toBe(0);
    });
  });

  describe('deleteAll', () => {
    it('should delete all sync queue records and return count', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 150 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deleteAll();

      expect(result).toBe(150);
      expect(mockPrepare).toHaveBeenCalledWith('DELETE FROM sync_queue');
      expect(mockRun).toHaveBeenCalledWith();
    });

    it('should return 0 when queue is empty', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deleteAll();

      expect(result).toBe(0);
    });

    it('should use static query with no user input for security', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.deleteAll();

      // Verify static query with no parameters (SEC-006 compliant)
      expect(mockPrepare).toHaveBeenCalledWith('DELETE FROM sync_queue');
      expect(mockRun).toHaveBeenCalledWith();
    });
  });

  describe('cleanupStalePullTracking', () => {
    it('should delete stale PULL tracking items with valid action pattern', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 3 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.cleanupStalePullTracking('store-123', 'pull_bins', 'current-id');

      expect(result).toBe(3);
      expect(mockPrepare).toHaveBeenCalled();
      // Verify parameterized query with proper LIKE pattern
      const prepareCall = mockPrepare.mock.calls[0][0];
      expect(prepareCall).toContain('DELETE FROM sync_queue');
      expect(prepareCall).toContain('store_id = ?');
      expect(prepareCall).toContain("sync_direction = 'PULL'");
      expect(prepareCall).toContain('synced = 0');
      expect(prepareCall).toContain('id != ?');
      expect(prepareCall).toContain('payload LIKE ?');
    });

    it('should reject invalid action patterns (SEC-006 allowlist)', () => {
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({ run: mockRun });

      // Attempt injection via action pattern
      const result = dal.cleanupStalePullTracking('store-123', 'malicious_action', 'current-id');

      expect(result).toBe(0);
      expect(mockPrepare).not.toHaveBeenCalled();
      expect(mockRun).not.toHaveBeenCalled();
    });

    it('should accept all valid action patterns', () => {
      const validActions = [
        'pull_bins',
        'pull_games',
        'pull_received_packs',
        'pull_activated_packs',
      ];
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      for (const action of validActions) {
        vi.clearAllMocks();
        mockPrepare.mockReturnValue({ run: mockRun });

        const result = dal.cleanupStalePullTracking('store-123', action, 'current-id');

        expect(result).toBe(1);
        expect(mockPrepare).toHaveBeenCalled();
      }
    });

    it('should exclude current item from cleanup', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 2 });
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.cleanupStalePullTracking('store-123', 'pull_bins', 'exclude-this-id');

      // Verify the excludeId is passed as parameter
      expect(mockRun).toHaveBeenCalled();
      const runArgs = mockRun.mock.calls[0];
      expect(runArgs).toContain('exclude-this-id');
    });

    it('should scope cleanup to store_id (DB-006 tenant isolation)', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.cleanupStalePullTracking('tenant-store-456', 'pull_games', 'current-id');

      // Verify store_id is first parameter (tenant scoping)
      const runArgs = mockRun.mock.calls[0];
      expect(runArgs[0]).toBe('tenant-store-456');
    });

    it('should return 0 when no items to cleanup', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.cleanupStalePullTracking('store-123', 'pull_bins', 'current-id');

      expect(result).toBe(0);
    });

    it('should use LIKE pattern for JSON payload matching', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.cleanupStalePullTracking('store-123', 'pull_bins', 'current-id');

      // Verify LIKE pattern is constructed correctly
      const runArgs = mockRun.mock.calls[0];
      expect(runArgs).toContain('%"action":"pull_bins"%');
    });
  });
});
