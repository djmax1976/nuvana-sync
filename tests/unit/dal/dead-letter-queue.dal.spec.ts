/**
 * Dead Letter Queue DAL Unit Tests
 *
 * Enterprise-grade tests for DLQ operations in sync-queue.dal.ts
 * Tests v046 migration MQ-002 compliance requirements.
 *
 * Traceability:
 * - MQ-002: Dead Letter Queue implementation
 * - SEC-006: SQL injection prevention via parameterized queries
 * - DB-006: Tenant isolation via store_id scoping
 * - API-008: Safe output filtering
 * - API-001: Input validation with bounds checking
 *
 * @module tests/unit/dal/dead-letter-queue.dal.spec
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mock Setup
// ============================================================================

const mockPrepare = vi.fn();
const mockTransaction = vi.fn((fn) => () => fn());

vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-uuid-dlq-1234'),
}));

import {
  SyncQueueDAL,
  type SyncQueueItem,
  type DeadLetterParams,
  type ErrorCategory,
  type DeadLetterReason,
} from '../../../src/main/dal/sync-queue.dal';

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Create a mock SyncQueueItem with DLQ fields
 */
function createMockSyncItem(overrides: Partial<SyncQueueItem> = {}): SyncQueueItem {
  return {
    id: 'item-123',
    store_id: 'store-123',
    entity_type: 'pack',
    entity_id: 'pack-456',
    operation: 'CREATE',
    payload: '{"pack_number":"001","game_code":"100"}',
    priority: 0,
    synced: 0,
    sync_attempts: 3,
    max_attempts: 5,
    last_sync_error: 'API Error: 400 Bad Request',
    last_attempt_at: '2024-01-01T12:00:00.000Z',
    created_at: '2024-01-01T10:00:00.000Z',
    synced_at: null,
    sync_direction: 'PUSH',
    api_endpoint: '/api/v1/sync/lottery/packs',
    http_status: 400,
    response_body: '{"error":"Invalid pack_number"}',
    // v046 DLQ fields
    dead_lettered: 0,
    dead_letter_reason: null,
    dead_lettered_at: null,
    error_category: null,
    retry_after: null,
    ...overrides,
  };
}

/**
 * Create a mock dead-lettered item
 */
function createMockDeadLetteredItem(overrides: Partial<SyncQueueItem> = {}): SyncQueueItem {
  return createMockSyncItem({
    dead_lettered: 1,
    dead_letter_reason: 'PERMANENT_ERROR',
    dead_lettered_at: '2024-01-01T14:00:00.000Z',
    error_category: 'PERMANENT',
    sync_attempts: 5,
    ...overrides,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('SyncQueueDAL - Dead Letter Queue Operations', () => {
  let dal: SyncQueueDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new SyncQueueDAL();
  });

  // ==========================================================================
  // deadLetter() Tests
  // ==========================================================================

  describe('deadLetter', () => {
    it('should move item to DLQ with correct reason and category', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const params: DeadLetterParams = {
        id: 'item-123',
        reason: 'PERMANENT_ERROR',
        errorCategory: 'PERMANENT',
        error: 'API returned 400: Invalid pack_number',
      };

      const result = dal.deadLetter(params);

      expect(result).toBe(true);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE sync_queue SET'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('dead_lettered = 1'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('dead_letter_reason = ?'));
      expect(mockRun).toHaveBeenCalledWith(
        'PERMANENT_ERROR', // reason
        expect.any(String), // dead_lettered_at (timestamp)
        'PERMANENT', // error_category
        'API returned 400: Invalid pack_number', // error
        'item-123' // id
      );
    });

    it('should return false when item not found', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deadLetter({
        id: 'nonexistent-id',
        reason: 'MANUAL',
        errorCategory: 'UNKNOWN',
      });

      expect(result).toBe(false);
    });

    it('should return false when item already dead-lettered (idempotency)', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // First call succeeds
      mockRun.mockReturnValueOnce({ changes: 1 });
      expect(
        dal.deadLetter({
          id: 'item-123',
          reason: 'PERMANENT_ERROR',
          errorCategory: 'PERMANENT',
        })
      ).toBe(true);

      // Second call fails (already dead-lettered)
      mockRun.mockReturnValueOnce({ changes: 0 });
      expect(
        dal.deadLetter({
          id: 'item-123',
          reason: 'PERMANENT_ERROR',
          errorCategory: 'PERMANENT',
        })
      ).toBe(false);
    });

    it('should truncate error message to 500 chars (API-003)', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const longError = 'x'.repeat(1000);
      dal.deadLetter({
        id: 'item-123',
        reason: 'STRUCTURAL_FAILURE',
        errorCategory: 'STRUCTURAL',
        error: longError,
      });

      const errorArg = mockRun.mock.calls[0][3];
      expect(errorArg).toHaveLength(500);
    });

    it('should handle all valid DeadLetterReason values', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const reasons: DeadLetterReason[] = [
        'MAX_ATTEMPTS_EXCEEDED',
        'PERMANENT_ERROR',
        'STRUCTURAL_FAILURE',
        'MANUAL',
      ];

      for (const reason of reasons) {
        vi.clearAllMocks();
        mockPrepare.mockReturnValue({ run: mockRun });

        const result = dal.deadLetter({
          id: `item-${reason}`,
          reason,
          errorCategory: 'UNKNOWN',
        });

        expect(result).toBe(true);
        expect(mockRun.mock.calls[0][0]).toBe(reason);
      }
    });

    it('should handle all valid ErrorCategory values', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const categories: ErrorCategory[] = ['TRANSIENT', 'PERMANENT', 'STRUCTURAL', 'UNKNOWN'];

      for (const category of categories) {
        vi.clearAllMocks();
        mockPrepare.mockReturnValue({ run: mockRun });

        const result = dal.deadLetter({
          id: `item-${category}`,
          reason: 'MANUAL',
          errorCategory: category,
        });

        expect(result).toBe(true);
        expect(mockRun.mock.calls[0][2]).toBe(category);
      }
    });

    // SEC-006: SQL injection prevention
    it('should use parameterized query (SEC-006)', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Attempt injection via ID
      dal.deadLetter({
        id: "'; DROP TABLE sync_queue; --",
        reason: 'MANUAL',
        errorCategory: 'UNKNOWN',
      });

      // Verify ID is passed as parameter, not interpolated
      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String), // reason
        expect.any(String), // timestamp
        expect.any(String), // category
        null, // error (undefined becomes null)
        "'; DROP TABLE sync_queue; --" // id as parameter
      );
    });
  });

  // ==========================================================================
  // deadLetterMany() Tests
  // ==========================================================================

  describe('deadLetterMany', () => {
    it('should dead-letter multiple items atomically in transaction', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockStmt = { run: mockRun };
      mockPrepare.mockReturnValue(mockStmt);

      const items: DeadLetterParams[] = [
        { id: 'item-1', reason: 'PERMANENT_ERROR', errorCategory: 'PERMANENT' },
        { id: 'item-2', reason: 'STRUCTURAL_FAILURE', errorCategory: 'STRUCTURAL' },
        { id: 'item-3', reason: 'MAX_ATTEMPTS_EXCEEDED', errorCategory: 'UNKNOWN' },
      ];

      const result = dal.deadLetterMany(items);

      expect(result).toBe(3);
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should return 0 for empty array', () => {
      const result = dal.deadLetterMany([]);

      expect(result).toBe(0);
      expect(mockPrepare).not.toHaveBeenCalled();
    });

    it('should count only items that were actually updated', () => {
      const mockRun = vi
        .fn()
        .mockReturnValueOnce({ changes: 1 }) // First succeeds
        .mockReturnValueOnce({ changes: 0 }) // Second fails (already dead-lettered)
        .mockReturnValueOnce({ changes: 1 }); // Third succeeds
      mockPrepare.mockReturnValue({ run: mockRun });

      const items: DeadLetterParams[] = [
        { id: 'item-1', reason: 'MANUAL', errorCategory: 'UNKNOWN' },
        { id: 'item-2', reason: 'MANUAL', errorCategory: 'UNKNOWN' },
        { id: 'item-3', reason: 'MANUAL', errorCategory: 'UNKNOWN' },
      ];

      const result = dal.deadLetterMany(items);

      expect(result).toBe(2); // Only 2 actually updated
    });
  });

  // ==========================================================================
  // restoreFromDeadLetter() Tests
  // ==========================================================================

  describe('restoreFromDeadLetter', () => {
    it('should restore item from DLQ and reset retry state', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.restoreFromDeadLetter('item-123');

      expect(result).toBe(true);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE sync_queue SET'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('dead_lettered = 0'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('sync_attempts = 0'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('last_sync_error = NULL'));
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = ? AND dead_lettered = 1')
      );
      expect(mockRun).toHaveBeenCalledWith('item-123');
    });

    it('should return false when item not in DLQ', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.restoreFromDeadLetter('not-dead-lettered-item');

      expect(result).toBe(false);
    });

    it('should clear all DLQ-related fields on restore', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.restoreFromDeadLetter('item-123');

      const query = mockPrepare.mock.calls[0][0];
      expect(query).toContain('dead_letter_reason = NULL');
      expect(query).toContain('dead_lettered_at = NULL');
      expect(query).toContain('error_category = NULL');
      expect(query).toContain('retry_after = NULL');
      expect(query).toContain('last_attempt_at = NULL');
    });
  });

  // ==========================================================================
  // restoreFromDeadLetterMany() Tests
  // ==========================================================================

  describe('restoreFromDeadLetterMany', () => {
    it('should restore multiple items with parameterized IN clause', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 3 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.restoreFromDeadLetterMany(['id-1', 'id-2', 'id-3']);

      expect(result).toBe(3);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE id IN (?, ?, ?)'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('AND dead_lettered = 1'));
      expect(mockRun).toHaveBeenCalledWith('id-1', 'id-2', 'id-3');
    });

    it('should return 0 for empty array', () => {
      const result = dal.restoreFromDeadLetterMany([]);

      expect(result).toBe(0);
      expect(mockPrepare).not.toHaveBeenCalled();
    });

    it('should return actual count of restored items', () => {
      // Only 2 of 3 were in DLQ
      const mockRun = vi.fn().mockReturnValue({ changes: 2 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.restoreFromDeadLetterMany(['id-1', 'id-2', 'id-3']);

      expect(result).toBe(2);
    });
  });

  // ==========================================================================
  // getDeadLetterItems() Tests
  // ==========================================================================

  describe('getDeadLetterItems', () => {
    it('should return paginated DLQ items', () => {
      const mockCount = { count: 10 };
      const mockItems = [
        createMockDeadLetteredItem({ id: 'dlq-1' }),
        createMockDeadLetteredItem({ id: 'dlq-2' }),
      ];

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockCount) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue(mockItems) });

      const result = dal.getDeadLetterItems('store-123', 50, 0);

      expect(result.total).toBe(10);
      expect(result.items).toHaveLength(2);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
      expect(result.hasMore).toBe(true); // 10 total, 2 returned
    });

    // DB-006: Tenant isolation
    it('should scope query to store_id (DB-006)', () => {
      const mockGet = vi.fn().mockReturnValue({ count: 0 });
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValueOnce({ get: mockGet }).mockReturnValueOnce({ all: mockAll });

      dal.getDeadLetterItems('tenant-store-abc');

      expect(mockGet).toHaveBeenCalledWith('tenant-store-abc');
    });

    // API-001: Input bounds
    it('should bound limit to max 100 (API-001)', () => {
      const mockGet = vi.fn().mockReturnValue({ count: 0 });
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValueOnce({ get: mockGet }).mockReturnValueOnce({ all: mockAll });

      const result = dal.getDeadLetterItems('store-123', 500, 0);

      expect(mockAll).toHaveBeenCalledWith('store-123', 100, 0);
      expect(result.limit).toBe(100);
    });

    it('should enforce minimum limit of 1 (API-001)', () => {
      const mockGet = vi.fn().mockReturnValue({ count: 0 });
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValueOnce({ get: mockGet }).mockReturnValueOnce({ all: mockAll });

      const result = dal.getDeadLetterItems('store-123', -5, 0);

      expect(mockAll).toHaveBeenCalledWith('store-123', 1, 0);
      expect(result.limit).toBe(1);
    });

    it('should enforce minimum offset of 0', () => {
      const mockGet = vi.fn().mockReturnValue({ count: 0 });
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValueOnce({ get: mockGet }).mockReturnValueOnce({ all: mockAll });

      const result = dal.getDeadLetterItems('store-123', 50, -10);

      expect(mockAll).toHaveBeenCalledWith('store-123', 50, 0);
      expect(result.offset).toBe(0);
    });

    // API-008: Safe output filtering
    it('should truncate last_sync_error to 200 chars (API-008)', () => {
      const longError = 'E'.repeat(500);
      const mockItem = createMockDeadLetteredItem({
        last_sync_error: longError,
      });

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 1 }) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([mockItem]) });

      const result = dal.getDeadLetterItems('store-123');

      expect(result.items[0].last_sync_error).toHaveLength(200);
    });

    it('should extract safe summary from payload (API-008)', () => {
      const mockItem = createMockDeadLetteredItem({
        payload: JSON.stringify({
          pack_number: '12345',
          game_code: '100',
          status: 'ACTIVE',
          secret_field: 'should-not-appear',
          api_key: 'definitely-not-exposed',
        }),
      });

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 1 }) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([mockItem]) });

      const result = dal.getDeadLetterItems('store-123');

      expect(result.items[0].summary).toEqual({
        pack_number: '12345',
        game_code: '100',
        status: 'ACTIVE',
      });
      // Ensure sensitive fields are NOT exposed
      expect(result.items[0].summary).not.toHaveProperty('secret_field');
      expect(result.items[0].summary).not.toHaveProperty('api_key');
    });

    it('should handle invalid JSON payload gracefully', () => {
      const mockItem = createMockDeadLetteredItem({
        payload: 'invalid json {{{',
      });

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 1 }) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([mockItem]) });

      const result = dal.getDeadLetterItems('store-123');

      expect(result.items[0].summary).toBeNull();
    });

    it('should correctly calculate hasMore for pagination', () => {
      // Case 1: More items available
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 100 }) })
        .mockReturnValueOnce({
          all: vi.fn().mockReturnValue(
            Array(50)
              .fill(null)
              .map((_, i) => createMockDeadLetteredItem({ id: `item-${i}` }))
          ),
        });

      let result = dal.getDeadLetterItems('store-123', 50, 0);
      expect(result.hasMore).toBe(true);

      // Case 2: No more items
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 50 }) })
        .mockReturnValueOnce({
          all: vi.fn().mockReturnValue(
            Array(50)
              .fill(null)
              .map((_, i) => createMockDeadLetteredItem({ id: `item-${i}` }))
          ),
        });

      result = dal.getDeadLetterItems('store-123', 50, 0);
      expect(result.hasMore).toBe(false);
    });
  });

  // ==========================================================================
  // getDeadLetterStats() Tests
  // ==========================================================================

  describe('getDeadLetterStats', () => {
    it('should return comprehensive DLQ statistics', () => {
      const mainResult = {
        total: 10,
        oldest_item: '2024-01-01T00:00:00.000Z',
        newest_item: '2024-01-15T12:00:00.000Z',
      };

      const byReasonResult = [
        { dead_letter_reason: 'PERMANENT_ERROR', count: 5 },
        { dead_letter_reason: 'MAX_ATTEMPTS_EXCEEDED', count: 3 },
        { dead_letter_reason: 'STRUCTURAL_FAILURE', count: 2 },
      ];

      const byEntityTypeResult = [
        { entity_type: 'pack', count: 8 },
        { entity_type: 'bin', count: 2 },
      ];

      const byErrorCategoryResult = [
        { error_category: 'PERMANENT', count: 6 },
        { error_category: 'STRUCTURAL', count: 2 },
        { error_category: 'UNKNOWN', count: 2 },
      ];

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mainResult) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue(byReasonResult) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue(byEntityTypeResult) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue(byErrorCategoryResult) });

      const stats = dal.getDeadLetterStats('store-123');

      expect(stats.total).toBe(10);
      expect(stats.oldestItem).toBe('2024-01-01T00:00:00.000Z');
      expect(stats.newestItem).toBe('2024-01-15T12:00:00.000Z');

      expect(stats.byReason).toEqual({
        PERMANENT_ERROR: 5,
        MAX_ATTEMPTS_EXCEEDED: 3,
        STRUCTURAL_FAILURE: 2,
        MANUAL: 0, // Not in results, should default to 0
      });

      expect(stats.byEntityType).toEqual({
        pack: 8,
        bin: 2,
      });

      expect(stats.byErrorCategory).toEqual({
        PERMANENT: 6,
        STRUCTURAL: 2,
        UNKNOWN: 2,
        TRANSIENT: 0, // Not in results, should default to 0
      });
    });

    // DB-006: Tenant isolation
    it('should scope all queries to store_id (DB-006)', () => {
      const mockGet = vi.fn().mockReturnValue({ total: 0, oldest_item: null, newest_item: null });
      const mockAll = vi.fn().mockReturnValue([]);

      mockPrepare
        .mockReturnValueOnce({ get: mockGet })
        .mockReturnValueOnce({ all: mockAll })
        .mockReturnValueOnce({ all: mockAll })
        .mockReturnValueOnce({ all: mockAll });

      dal.getDeadLetterStats('tenant-isolated-store');

      // Verify all queries received the store_id
      expect(mockGet).toHaveBeenCalledWith('tenant-isolated-store');
      expect(mockAll).toHaveBeenCalledTimes(3);
      mockAll.mock.calls.forEach((call) => {
        expect(call[0]).toBe('tenant-isolated-store');
      });
    });

    it('should handle empty DLQ gracefully', () => {
      mockPrepare
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ total: 0, oldest_item: null, newest_item: null }),
        })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) });

      const stats = dal.getDeadLetterStats('store-123');

      expect(stats.total).toBe(0);
      expect(stats.oldestItem).toBeNull();
      expect(stats.newestItem).toBeNull();
      expect(stats.byReason).toEqual({
        PERMANENT_ERROR: 0,
        MAX_ATTEMPTS_EXCEEDED: 0,
        STRUCTURAL_FAILURE: 0,
        MANUAL: 0,
      });
      expect(stats.byEntityType).toEqual({});
      expect(stats.byErrorCategory).toEqual({
        TRANSIENT: 0,
        PERMANENT: 0,
        STRUCTURAL: 0,
        UNKNOWN: 0,
      });
    });
  });

  // ==========================================================================
  // getDeadLetterCount() Tests
  // ==========================================================================

  describe('getDeadLetterCount', () => {
    it('should return count of dead-lettered items', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ count: 42 }),
      });

      const result = dal.getDeadLetterCount('store-123');

      expect(result).toBe(42);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE store_id = ? AND dead_lettered = 1')
      );
    });

    // DB-006: Tenant isolation
    it('should use parameterized query for store_id (SEC-006, DB-006)', () => {
      const mockGet = vi.fn().mockReturnValue({ count: 5 });
      mockPrepare.mockReturnValue({ get: mockGet });

      dal.getDeadLetterCount('tenant-store');

      expect(mockGet).toHaveBeenCalledWith('tenant-store');
    });
  });

  // ==========================================================================
  // deleteDeadLetterItem() Tests
  // ==========================================================================

  describe('deleteDeadLetterItem', () => {
    it('should delete specific item from DLQ', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deleteDeadLetterItem('item-to-delete');

      expect(result).toBe(true);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM sync_queue'));
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = ? AND dead_lettered = 1')
      );
      expect(mockRun).toHaveBeenCalledWith('item-to-delete');
    });

    it('should return false when item not in DLQ', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deleteDeadLetterItem('not-in-dlq');

      expect(result).toBe(false);
    });

    it('should only delete items that are dead-lettered', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Try to delete an active (non-dead-lettered) item
      const result = dal.deleteDeadLetterItem('active-item');

      // Should fail because WHERE clause includes dead_lettered = 1
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // deleteDeadLetterItems() Tests (Bulk Cleanup)
  // ==========================================================================

  describe('deleteDeadLetterItems', () => {
    it('should delete DLQ items older than specified date', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 15 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deleteDeadLetterItems('store-123', '2024-01-01T00:00:00.000Z');

      expect(result).toBe(15);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM sync_queue'));
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE store_id = ? AND dead_lettered = 1 AND dead_lettered_at < ?')
      );
      expect(mockRun).toHaveBeenCalledWith('store-123', '2024-01-01T00:00:00.000Z');
    });

    // DB-006: Tenant isolation
    it('should scope deletion to store_id (DB-006)', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.deleteDeadLetterItems('tenant-store', '2024-01-01');

      expect(mockRun.mock.calls[0][0]).toBe('tenant-store');
    });

    it('should return 0 when no items match criteria', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deleteDeadLetterItems('store-123', '2020-01-01');

      expect(result).toBe(0);
    });
  });

  // ==========================================================================
  // updateErrorCategory() Tests
  // ==========================================================================

  describe('updateErrorCategory', () => {
    it('should update error category for active item', () => {
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.updateErrorCategory('item-123', 'PERMANENT');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sync_queue SET error_category = ?')
      );
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = ? AND synced = 0 AND dead_lettered = 0')
      );
      expect(mockRun).toHaveBeenCalledWith('PERMANENT', 'item-123');
    });

    it('should not update already synced or dead-lettered items', () => {
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.updateErrorCategory('item-123', 'STRUCTURAL');

      // Verify WHERE clause excludes synced and dead-lettered items
      const query = mockPrepare.mock.calls[0][0];
      expect(query).toContain('synced = 0');
      expect(query).toContain('dead_lettered = 0');
    });
  });

  // ==========================================================================
  // setRetryAfter() Tests
  // ==========================================================================

  describe('setRetryAfter', () => {
    it('should set retry_after timestamp for rate-limited items', () => {
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({ run: mockRun });

      const retryAfter = '2024-01-01T12:30:00.000Z';
      dal.setRetryAfter('item-123', retryAfter);

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sync_queue SET retry_after = ?')
      );
      expect(mockRun).toHaveBeenCalledWith(retryAfter, 'item-123');
    });

    it('should only set retry_after for active, non-dead-lettered items', () => {
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.setRetryAfter('item-123', '2024-01-01T12:30:00.000Z');

      const query = mockPrepare.mock.calls[0][0];
      expect(query).toContain('WHERE id = ? AND synced = 0 AND dead_lettered = 0');
    });
  });

  // ==========================================================================
  // getItemsForAutoDeadLetter() Tests
  // ==========================================================================

  describe('getItemsForAutoDeadLetter', () => {
    it('should return items eligible for auto-dead-lettering', () => {
      const eligibleItems = [
        createMockSyncItem({
          id: 'permanent-error-item',
          sync_attempts: 5,
          max_attempts: 5,
          error_category: 'PERMANENT',
        }),
        createMockSyncItem({
          id: 'structural-error-item',
          sync_attempts: 5,
          max_attempts: 5,
          error_category: 'STRUCTURAL',
        }),
        createMockSyncItem({
          id: 'exceeded-grace-period',
          sync_attempts: 10,
          max_attempts: 5,
          error_category: 'TRANSIENT', // Normally would retry, but exceeded 2x max
        }),
      ];

      mockPrepare.mockReturnValue({ all: vi.fn().mockReturnValue(eligibleItems) });

      const result = dal.getItemsForAutoDeadLetter('store-123');

      expect(result).toHaveLength(3);
    });

    it('should exclude PULL tracking items', () => {
      mockPrepare.mockReturnValue({ all: vi.fn().mockReturnValue([]) });

      dal.getItemsForAutoDeadLetter('store-123');

      const query = mockPrepare.mock.calls[0][0];
      expect(query).toContain("(sync_direction IS NULL OR sync_direction = 'PUSH')");
    });

    it('should only return unsynced, non-dead-lettered items', () => {
      mockPrepare.mockReturnValue({ all: vi.fn().mockReturnValue([]) });

      dal.getItemsForAutoDeadLetter('store-123');

      const query = mockPrepare.mock.calls[0][0];
      expect(query).toContain('synced = 0');
      expect(query).toContain('dead_lettered = 0');
    });

    // DB-006: Tenant isolation
    it('should scope query to store_id (DB-006)', () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValue({ all: mockAll });

      dal.getItemsForAutoDeadLetter('tenant-store-xyz');

      expect(mockAll).toHaveBeenCalledWith('tenant-store-xyz');
    });

    it('should limit results to 100 items', () => {
      mockPrepare.mockReturnValue({ all: vi.fn().mockReturnValue([]) });

      dal.getItemsForAutoDeadLetter('store-123');

      const query = mockPrepare.mock.calls[0][0];
      expect(query).toContain('LIMIT 100');
    });
  });

  // ==========================================================================
  // Edge Cases and Error Handling
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle null error_category in DLQ stats', () => {
      const byErrorCategoryResult = [
        { error_category: 'PERMANENT', count: 5 },
        { error_category: null, count: 2 }, // NULL category
      ];

      mockPrepare
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ total: 7, oldest_item: null, newest_item: null }),
        })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue(byErrorCategoryResult) });

      const stats = dal.getDeadLetterStats('store-123');

      // NULL categories should not be included in byErrorCategory
      expect(stats.byErrorCategory.PERMANENT).toBe(5);
    });

    it('should handle null dead_letter_reason in DLQ stats', () => {
      const byReasonResult = [
        { dead_letter_reason: 'MANUAL', count: 3 },
        { dead_letter_reason: null, count: 1 }, // Should not happen but handle gracefully
      ];

      mockPrepare
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ total: 4, oldest_item: null, newest_item: null }),
        })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue(byReasonResult) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) });

      const stats = dal.getDeadLetterStats('store-123');

      // NULL reasons should not throw errors
      expect(stats.byReason.MANUAL).toBe(3);
    });
  });
});
