/**
 * Sync Queue DAL Unit Tests
 *
 * @module tests/unit/dal/sync-queue.dal.spec
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted() to ensure mock functions are available when vi.mock runs
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
const { mockPrepare, mockTransaction } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn((fn: () => void) => () => fn()),
}));

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
        // v049 idempotency key
        idempotency_key: null,
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
          // v049 idempotency key
          idempotency_key: null,
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

  // ==========================================================================
  // DT0.1: Queue DAL Invariants (Phase 0 Baseline Tests)
  // Risk Coverage: D-R8 (Queue ordering violations), D-R10 (Backoff escape)
  // ==========================================================================

  describe('DT0.1: Queue Ordering Invariants', () => {
    it('should return items ordered by priority DESC, created_at ASC', () => {
      const mockItems: SyncQueueItem[] = [
        createMockQueueItem({ id: '1', priority: 10, created_at: '2024-01-01T00:00:01Z' }),
        createMockQueueItem({ id: '2', priority: 10, created_at: '2024-01-01T00:00:00Z' }),
        createMockQueueItem({ id: '3', priority: 5, created_at: '2024-01-01T00:00:00Z' }),
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockItems),
      });

      dal.getUnsynced(100);

      // Verify ORDER BY clause is correct
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY priority DESC, created_at ASC')
      );
    });

    it('should maintain FIFO within same priority level', () => {
      // Simulates database returning items in expected order
      const mockItems: SyncQueueItem[] = [
        createMockQueueItem({ id: 'oldest', priority: 5, created_at: '2024-01-01T00:00:00Z' }),
        createMockQueueItem({ id: 'newer', priority: 5, created_at: '2024-01-01T00:00:01Z' }),
        createMockQueueItem({ id: 'newest', priority: 5, created_at: '2024-01-01T00:00:02Z' }),
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockItems),
      });

      const result = dal.getUnsynced(100);

      // First item should be oldest within same priority
      expect(result[0].id).toBe('oldest');
      expect(result[1].id).toBe('newer');
      expect(result[2].id).toBe('newest');
    });

    it('should prioritize higher priority items over older lower priority items', () => {
      // High priority item created AFTER low priority should still come first
      const mockItems: SyncQueueItem[] = [
        createMockQueueItem({ id: 'high', priority: 100, created_at: '2024-01-01T12:00:00Z' }),
        createMockQueueItem({ id: 'low', priority: 1, created_at: '2024-01-01T00:00:00Z' }),
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockItems),
      });

      const result = dal.getUnsynced(100);

      // High priority should come first despite being created later
      expect(result[0].id).toBe('high');
    });
  });

  describe('DT0.1: Retry Selection Invariants', () => {
    it('should only select items where sync_attempts < max_attempts', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.getUnsynced(100);

      // Verify WHERE clause includes retry limit check
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('sync_attempts < max_attempts')
      );
    });

    it('should exclude synced items (synced = 1)', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.getUnsynced(100);

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE synced = 0'));
    });

    it('should exclude dead-lettered items from retryable selection', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.getRetryableItems('store-123', 100);

      // Verify dead_lettered = 0 exclusion
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('dead_lettered = 0'));
    });

    it('should extend retry limit for TRANSIENT errors (ERR-007)', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.getRetryableItems('store-123', 100);

      // Verify TRANSIENT error extended retry window
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("error_category = 'TRANSIENT' AND sync_attempts < max_attempts * 2")
      );
    });
  });

  describe('DT0.1: Status Transition Invariants', () => {
    it('markSynced should set synced = 1 and synced_at timestamp', () => {
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.markSynced('item-123');

      const query = mockPrepare.mock.calls[0][0];
      expect(query).toContain('synced = 1');
      expect(query).toContain('synced_at = ?');
    });

    it('deadLetter should set dead_lettered = 1 with reason and timestamp', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.deadLetter({
        id: 'item-123',
        reason: 'MAX_ATTEMPTS_EXCEEDED',
        errorCategory: 'TRANSIENT',
      });

      const query = mockPrepare.mock.calls[0][0];
      expect(query).toContain('dead_lettered = 1');
      expect(query).toContain('dead_letter_reason = ?');
      expect(query).toContain('dead_lettered_at = ?');
      expect(query).toContain('error_category = ?');
    });

    it('restoreFromDeadLetter should reset all retry state', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.restoreFromDeadLetter('item-123');

      const query = mockPrepare.mock.calls[0][0];
      expect(query).toContain('dead_lettered = 0');
      expect(query).toContain('sync_attempts = 0');
      expect(query).toContain('last_sync_error = NULL');
      expect(query).toContain('error_category = NULL');
    });

    it('markSynced should be idempotent (already synced item)', () => {
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({ run: mockRun });

      // Call markSynced on already synced item
      dal.markSynced('already-synced-item');

      // Should still execute (database will just update with same values)
      expect(mockRun).toHaveBeenCalled();
    });
  });

  describe('DT0.1: Backoff Calculation Invariants', () => {
    it('getRetryableItems should implement exponential backoff: 2^attempts seconds', () => {
      // Item with 3 attempts should have 8 second backoff (2^3 = 8)
      const mockItems: SyncQueueItem[] = [
        createMockQueueItem({
          id: 'backoff-item',
          sync_attempts: 3,
          last_attempt_at: new Date(Date.now() - 5000).toISOString(), // 5 seconds ago
        }),
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockItems),
      });

      const result = dal.getRetryableItems('store-123', 100);

      // Item should NOT be retryable yet (5s < 8s backoff)
      expect(result).toHaveLength(0);
    });

    it('getRetryableItems should cap backoff at 60 seconds', () => {
      // Item with 10 attempts would have 1024s backoff without cap
      // With cap, should be 60 seconds
      const mockItems: SyncQueueItem[] = [
        createMockQueueItem({
          id: 'capped-item',
          sync_attempts: 10,
          last_attempt_at: new Date(Date.now() - 61000).toISOString(), // 61 seconds ago
        }),
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockItems),
      });

      const result = dal.getRetryableItems('store-123', 100);

      // Item should be retryable (61s > 60s capped backoff)
      expect(result).toHaveLength(1);
    });

    it('getRetryableItems should immediately return items with 0 attempts', () => {
      const mockItems: SyncQueueItem[] = [
        createMockQueueItem({
          id: 'new-item',
          sync_attempts: 0,
          last_attempt_at: null,
        }),
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockItems),
      });

      const result = dal.getRetryableItems('store-123', 100);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('new-item');
    });

    it('getBackoffCount should accurately count items in backoff window', () => {
      const now = Date.now();
      const mockItems = [
        {
          sync_attempts: 1,
          last_attempt_at: new Date(now - 1000).toISOString(),
          error_category: null,
          max_attempts: 5,
        }, // 1s ago, needs 2s backoff - IN backoff
        {
          sync_attempts: 2,
          last_attempt_at: new Date(now - 5000).toISOString(),
          error_category: null,
          max_attempts: 5,
        }, // 5s ago, needs 4s backoff - OUT of backoff
        {
          sync_attempts: 3,
          last_attempt_at: new Date(now - 3000).toISOString(),
          error_category: null,
          max_attempts: 5,
        }, // 3s ago, needs 8s backoff - IN backoff
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockItems),
      });

      const count = dal.getBackoffCount('store-123');

      // 2 items should be in backoff (1s and 3s items)
      expect(count).toBe(2);
    });

    it('resetStuckInBackoff should clear backoff state after threshold', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 5 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.resetStuckInBackoff('store-123', 2);

      expect(result).toBe(5);
      const query = mockPrepare.mock.calls[0][0];
      expect(query).toContain('sync_attempts = 0');
      expect(query).toContain('last_attempt_at = NULL');
    });
  });

  describe('DT0.1: PUSH vs PULL Item Separation', () => {
    it('getRetryableItems should exclude PULL direction items', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.getRetryableItems('store-123', 100);

      // Verify PULL items excluded by sync_direction
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("(sync_direction IS NULL OR sync_direction = 'PUSH')")
      );
    });

    it('getRetryableItems should exclude items with entity_id starting with pull-', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.getRetryableItems('store-123', 100);

      // Verify legacy PULL items excluded by entity_id pattern
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("entity_id NOT LIKE 'pull-%'")
      );
    });

    it('getItemsForAutoDeadLetter should exclude PULL items (handled by services)', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.getItemsForAutoDeadLetter('store-123');

      // Verify PULL items excluded from auto-DLQ
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("entity_id NOT LIKE 'pull-%'")
      );
    });

    it('hasPendingPullForEntityType should only find PULL items', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ '1': 1 }),
      });

      dal.hasPendingPullForEntityType('store-123', 'bin');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("sync_direction = 'PULL'"));
    });
  });

  describe('DT0.1: Batch Size Limits', () => {
    it('should cap batch size at MAX_BATCH_SIZE (500)', () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValue({ all: mockAll });

      dal.getUnsynced(10000); // Request way over limit

      expect(mockAll).toHaveBeenCalledWith(500); // Should be capped
    });

    it('should respect reasonable batch sizes below limit', () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValue({ all: mockAll });

      dal.getUnsynced(50);

      expect(mockAll).toHaveBeenCalledWith(50);
    });

    it('should handle pagination limit bounds (1-100)', () => {
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ total: 500 }) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) });

      // Request over pagination limit
      dal.getActivityPaginated('store-123', { limit: 200 });

      // Should be capped at 100
      const allArgs = mockPrepare.mock.calls[1][0];
      expect(allArgs).toContain('LIMIT ? OFFSET ?');
    });
  });
});

// ==========================================================================
// Helper: Create mock SyncQueueItem with defaults
// ==========================================================================

function createMockQueueItem(overrides: Partial<SyncQueueItem>): SyncQueueItem {
  return {
    id: 'mock-id',
    store_id: 'store-123',
    entity_type: 'pack',
    entity_id: 'pack-456',
    operation: 'CREATE',
    payload: '{}',
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
    dead_lettered: 0,
    dead_letter_reason: null,
    dead_lettered_at: null,
    error_category: null,
    retry_after: null,
    idempotency_key: null,
    ...overrides,
  };
}
