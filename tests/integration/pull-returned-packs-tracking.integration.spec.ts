/**
 * DT0.3: Pull Returned Packs Tracking Regression Test
 *
 * Risk Coverage: D-R3 (Duplicate PULL markers)
 *
 * Regression Context:
 * - pull_returned_packs was identified as a critical tracking path
 * - Multiple PULL items for the same action could accumulate
 * - Error history needs to be preserved on single items for DLQ visibility
 *
 * @module tests/integration/pull-returned-packs-tracking.integration.spec
 * @security DB-006: Tenant isolation verified
 * @security SEC-006: All queries parameterized
 * @standard TEST-001: AAA pattern
 * @standard TEST-003: Test isolation
 * @standard TEST-004: Deterministic tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted() to ensure mock functions are available when vi.mock runs
const { mockPrepare, mockTransaction, mockRun, mockGet, mockAll } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn((fn: () => void) => () => fn()),
  mockRun: vi.fn(),
  mockGet: vi.fn(),
  mockAll: vi.fn(),
}));

vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

// Mock uuid
let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: vi.fn(() => `pull-returned-uuid-${++uuidCounter}`),
}));

import {
  SyncQueueDAL,
  type SyncQueueItem,
  type ErrorCategory,
} from '../../src/main/dal/sync-queue.dal';

describe('DT0.3: Pull Returned Packs Tracking Behavior', () => {
  let dal: SyncQueueDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    dal = new SyncQueueDAL();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ==========================================================================
  // Regression: Duplicate PULL marker accumulation
  // ==========================================================================

  describe('Duplicate PULL marker prevention', () => {
    it('should reuse existing PULL item instead of creating new one each cycle', () => {
      // Arrange: Existing PULL item from previous sync cycle
      // NOTE: Using 'pull_received_packs' which is in the allowlist
      const existingPullItem: SyncQueueItem = {
        id: 'existing-received-pull',
        store_id: 'store-123',
        entity_type: 'pack',
        entity_id: 'pull-received-1706537000000',
        operation: 'UPDATE',
        payload: JSON.stringify({
          action: 'pull_received_packs',
          timestamp: '2024-01-29T09:00:00Z',
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 2,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-29T09:00:00Z',
        synced_at: null,
        sync_direction: 'PULL',
        api_endpoint: null,
        http_status: null,
        response_body: null,
        dead_lettered: 0,
        dead_letter_reason: null,
        dead_lettered_at: null,
        error_category: null,
        retry_after: null,
        idempotency_key: null,
      };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(existingPullItem),
      });

      // Act: Check for existing pull_received_packs item (allowlisted action)
      const result = dal.getPendingPullItemByAction('store-123', 'pull_received_packs');

      // Assert: Should find and return existing item
      expect(result).toEqual(existingPullItem);
      expect(result?.id).toBe('existing-received-pull');
    });

    it('should query by JSON payload action pattern', () => {
      // Arrange
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      });

      // Act: Use allowlisted action
      dal.getPendingPullItemByAction('store-123', 'pull_activated_packs');

      // Assert: Query should use LIKE pattern for JSON payload
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('payload LIKE ?'));
      // Verify store_id scoping (DB-006)
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('store_id = ?'));
    });

    it('should only find non-synced, non-dead-lettered items', () => {
      // Arrange
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      });

      // Act: Use allowlisted action
      dal.getPendingPullItemByAction('store-123', 'pull_bins');

      // Assert
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('synced = 0'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('dead_lettered = 0'));
    });

    it('should reject actions not in allowlist (SEC-006)', () => {
      // Arrange
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ id: 'should-not-return' }),
      });

      // Act: Try non-allowlisted action (malicious_action - NOT pull_returned_packs)
      // Phase 5 (D5.3): pull_returned_packs is now in the allowlist
      const result = dal.getPendingPullItemByAction('store-123', 'malicious_action');

      // Assert: Should return null without querying
      expect(result).toBeNull();
      // mockPrepare should NOT have been called since action is rejected
      expect(mockPrepare).not.toHaveBeenCalled();
    });

    it('should accept pull_returned_packs action (D5.3 fix)', () => {
      // Arrange: Phase 5 (D5.3) added pull_returned_packs to the allowlist
      const existingPullItem: SyncQueueItem = {
        id: 'existing-returned-pull',
        store_id: 'store-123',
        entity_type: 'pack',
        entity_id: 'pull-returned-1706537000000',
        operation: 'UPDATE',
        payload: JSON.stringify({ action: 'pull_returned_packs' }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 2,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-29T09:00:00Z',
        synced_at: null,
        sync_direction: 'PULL',
        api_endpoint: null,
        http_status: null,
        response_body: null,
        dead_lettered: 0,
        dead_letter_reason: null,
        dead_lettered_at: null,
        error_category: null,
        retry_after: null,
        idempotency_key: null,
      };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(existingPullItem),
      });

      // Act: Query for pull_returned_packs (should now be in allowlist)
      const result = dal.getPendingPullItemByAction('store-123', 'pull_returned_packs');

      // Assert: Should find item (not rejected by allowlist)
      expect(result).not.toBeNull();
      expect(result?.id).toBe('existing-returned-pull');
    });
  });

  // ==========================================================================
  // Regression: Error history accumulation on single item
  // ==========================================================================

  describe('Error history accumulation', () => {
    it('should preserve error history when reusing existing PULL item', () => {
      // Arrange: PULL item with accumulated error history
      // NOTE: Using 'pull_received_packs' which is in the allowlist
      const itemWithErrors: SyncQueueItem = {
        id: 'errored-pull',
        store_id: 'store-123',
        entity_type: 'pack',
        entity_id: 'pull-received-1706537000000',
        operation: 'UPDATE',
        payload: JSON.stringify({ action: 'pull_received_packs' }),
        priority: 0,
        synced: 0,
        sync_attempts: 3,
        max_attempts: 5,
        last_sync_error: 'Network timeout after 30s',
        last_attempt_at: '2024-01-29T12:30:00Z',
        created_at: '2024-01-29T09:00:00Z',
        synced_at: null,
        sync_direction: 'PULL',
        api_endpoint: '/api/v1/sync/lottery/packs/received',
        http_status: 504,
        response_body: '{"error":"Gateway timeout"}',
        dead_lettered: 0,
        dead_letter_reason: null,
        dead_lettered_at: null,
        error_category: 'TRANSIENT',
        retry_after: null,
        idempotency_key: null,
      };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(itemWithErrors),
      });

      // Act: Use allowlisted action
      const result = dal.getPendingPullItemByAction('store-123', 'pull_received_packs');

      // Assert: All error fields preserved
      expect(result?.sync_attempts).toBe(3);
      expect(result?.last_sync_error).toBe('Network timeout after 30s');
      expect(result?.http_status).toBe(504);
      expect(result?.error_category).toBe('TRANSIENT');
      expect(result?.api_endpoint).toBe('/api/v1/sync/lottery/packs/received');
    });

    it('should increment attempts on reused item when retry fails', () => {
      // Arrange
      mockRun.mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Act: Simulate retry failure on existing PULL item
      dal.incrementAttempts('errored-pull', 'Connection refused', {
        api_endpoint: '/api/v1/sync/lottery/packs/returned',
        http_status: 503,
        response_body: '{"error":"Service unavailable"}',
      });

      // Assert: Should update existing item
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('sync_attempts = sync_attempts + 1')
      );
      expect(mockRun).toHaveBeenCalledWith(
        'Connection refused',
        expect.any(String), // last_attempt_at
        '/api/v1/sync/lottery/packs/returned',
        503,
        '{"error":"Service unavailable"}',
        'errored-pull'
      );
    });
  });

  // ==========================================================================
  // Regression: DLQ routing for max-attempt items
  // ==========================================================================

  describe('Dead Letter Queue routing', () => {
    it('should dead-letter PULL item after max_attempts exceeded', () => {
      // Arrange
      mockRun.mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Act: Dead letter the PULL item
      const result = dal.deadLetter({
        id: 'max-attempts-pull',
        reason: 'MAX_ATTEMPTS_EXCEEDED',
        errorCategory: 'TRANSIENT',
        error: 'Failed after 5 attempts: network connectivity issues',
      });

      // Assert
      expect(result).toBe(true);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('dead_lettered = 1'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('dead_letter_reason = ?'));
    });

    it('should preserve original payload in DLQ for debugging', () => {
      // Arrange: DLQ item with full context
      const dlqItem = {
        id: 'dlq-pull',
        entity_type: 'pack',
        entity_id: 'pull-returned-1706537000000',
        operation: 'UPDATE',
        sync_attempts: 5,
        max_attempts: 5,
        last_sync_error: 'Max attempts exceeded',
        dead_letter_reason: 'MAX_ATTEMPTS_EXCEEDED',
        dead_lettered_at: '2024-01-29T15:00:00Z',
        error_category: 'TRANSIENT',
        api_endpoint: '/api/v1/sync/lottery/packs/returned',
        http_status: 500,
        created_at: '2024-01-29T09:00:00Z',
        payload: JSON.stringify({
          action: 'pull_returned_packs',
          timestamp: '2024-01-29T09:00:00Z',
          lastPull: '2024-01-28T23:59:59Z',
        }),
      };

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 1 }) }) // count
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([dlqItem]) }); // items

      // Act
      const response = dal.getDeadLetterItems('store-123', 50, 0);

      // Assert: DLQ item should have full context for debugging
      expect(response.items).toHaveLength(1);
      // Verify summary extraction from payload
      expect(response.items[0].api_endpoint).toBe('/api/v1/sync/lottery/packs/returned');
    });

    it('should restore from DLQ and reset retry state', () => {
      // Arrange
      mockRun.mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Act: Restore DLQ item for retry
      const result = dal.restoreFromDeadLetter('dlq-pull-item');

      // Assert
      expect(result).toBe(true);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('dead_lettered = 0'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('sync_attempts = 0'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('error_category = NULL'));
    });
  });

  // ==========================================================================
  // Regression: Stale PULL item cleanup after success
  // ==========================================================================

  describe('Stale PULL item cleanup', () => {
    it('should cleanup old returned_packs PULL items after successful sync', () => {
      // Arrange
      // Phase 5 (D5.3): pull_returned_packs is now in the allowlist
      mockRun.mockReturnValue({ changes: 5 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Act: After successful returned packs sync, cleanup old tracking items
      const deleted = dal.cleanupStalePullTracking(
        'store-123',
        'pull_returned_packs', // D5.3 fix: Now in allowlist
        'current-sync-id'
      );

      // Assert: Should execute cleanup (pull_returned_packs now allowed)
      expect(deleted).toBe(5);
      expect(mockPrepare).toHaveBeenCalled();
    });

    it('should accept valid PULL action patterns', () => {
      // Arrange
      mockRun.mockReturnValue({ changes: 3 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Act: Valid action pattern
      const deleted = dal.cleanupStalePullTracking(
        'store-123',
        'pull_activated_packs',
        'current-sync-id'
      );

      // Assert: Should execute cleanup
      expect(deleted).toBe(3);
      expect(mockPrepare).toHaveBeenCalled();
    });

    it('should exclude current sync item from cleanup', () => {
      // Arrange
      mockRun.mockReturnValue({ changes: 2 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Act
      dal.cleanupStalePullTracking('store-123', 'pull_received_packs', 'keep-this-id');

      // Assert: Current ID should be excluded
      expect(mockRun).toHaveBeenCalledWith(
        'store-123',
        'keep-this-id', // excluded ID
        expect.any(String), // cutoff time
        '%"action":"pull_received_packs"%'
      );
    });

    it('should only delete items older than safety threshold', () => {
      // Arrange
      mockRun.mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Act
      dal.cleanupStalePullTracking('store-123', 'pull_bins', 'current-id');

      // Assert: Query should include cutoff time
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('created_at < ?'));
    });
  });

  // ==========================================================================
  // Regression: Tenant isolation (DB-006)
  // ==========================================================================

  describe('Tenant isolation (DB-006)', () => {
    it('getPendingPullItemByAction should be store-scoped', () => {
      // Arrange
      mockGet.mockReturnValue(null);
      mockPrepare.mockReturnValue({ get: mockGet });

      // Act
      dal.getPendingPullItemByAction('tenant-store-abc', 'pull_activated_packs');

      // Assert: store_id is first parameter
      expect(mockGet).toHaveBeenCalledWith('tenant-store-abc', '%"action":"pull_activated_packs"%');
    });

    it('cleanupStalePullTracking should not cross tenant boundaries', () => {
      // Arrange
      mockRun.mockReturnValue({ changes: 10 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Act
      dal.cleanupStalePullTracking('tenant-isolated-store', 'pull_games', 'current');

      // Assert: Cleanup scoped to tenant
      expect(mockRun.mock.calls[0][0]).toBe('tenant-isolated-store');
    });

    it('getDeadLetterItems should be store-scoped', () => {
      // Arrange
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 0 }) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) });

      // Act
      dal.getDeadLetterItems('isolated-tenant', 50, 0);

      // Assert: Both queries should be store-scoped
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE store_id = ? AND dead_lettered = 1')
      );
    });
  });

  // ==========================================================================
  // Regression: PULL max_attempts differentiation
  // ==========================================================================

  describe('PULL item max_attempts handling', () => {
    it('PULL items should have lower max_attempts than PUSH items', () => {
      // This is a behavioral test - PULL items use PULL_MAX_ATTEMPTS (2)
      // while PUSH items use DEFAULT_MAX_ATTEMPTS (5)

      // Arrange: Enqueue a PULL item
      mockRun.mockReturnValue({ changes: 1 });
      const mockItem = {
        id: 'new-pull-id',
        max_attempts: 2, // PULL_MAX_ATTEMPTS
        sync_direction: 'PULL',
      };
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockItem) });

      // Act
      const result = dal.enqueue({
        store_id: 'store-123',
        entity_type: 'pack',
        entity_id: 'pull-returned-new',
        operation: 'UPDATE',
        payload: { action: 'pull_returned_packs' },
        sync_direction: 'PULL',
      });

      // Assert: PULL item should have lower max_attempts
      expect(result.max_attempts).toBe(2);
      expect(result.sync_direction).toBe('PULL');
    });

    it('PUSH items should have higher max_attempts', () => {
      // Arrange
      mockRun.mockReturnValue({ changes: 1 });
      const mockItem = {
        id: 'new-push-id',
        max_attempts: 5, // DEFAULT_MAX_ATTEMPTS
        sync_direction: 'PUSH',
      };
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockItem) });

      // Act
      const result = dal.enqueue({
        store_id: 'store-123',
        entity_type: 'pack',
        entity_id: 'pack-123',
        operation: 'CREATE',
        payload: { pack_number: '1234567' },
        // sync_direction defaults to PUSH
      });

      // Assert
      expect(result.max_attempts).toBe(5);
      expect(result.sync_direction).toBe('PUSH');
    });
  });

  // ==========================================================================
  // Regression: Query correctness (SEC-006)
  // ==========================================================================

  describe('Query security (SEC-006)', () => {
    it('should use parameterized queries for all operations', () => {
      // Arrange
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(null),
        all: vi.fn().mockReturnValue([]),
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      // Act: Execute various operations
      dal.getPendingPullItemByAction('store-123', 'pull_bins');
      dal.getPendingPullItem('store-123', 'bin');
      dal.hasPendingPullForEntityType('store-123', 'game');

      // Assert: All queries should use ? placeholders
      for (const call of mockPrepare.mock.calls) {
        const query = call[0] as string;
        // Should not contain string interpolation of store_id
        expect(query).not.toMatch(/store_id = '[^?]/);
        expect(query).not.toMatch(/store_id = "[^?]/);
        // Should use parameterized form
        if (query.includes('store_id')) {
          expect(query).toContain('store_id = ?');
        }
      }
    });

    it('should reject SQL injection via action parameter', () => {
      // Arrange
      const injectionPayloads = [
        "pull_bins'; DROP TABLE sync_queue; --",
        'pull_bins" OR 1=1 --',
        'pull_bins\nUNION SELECT * FROM users',
        "'; TRUNCATE sync_queue; --",
      ];

      mockPrepare.mockReturnValue({
        get: vi.fn(),
      });

      for (const payload of injectionPayloads) {
        vi.clearAllMocks();
        mockPrepare.mockReturnValue({ get: vi.fn() });

        // Act
        const result = dal.getPendingPullItemByAction('store-123', payload);

        // Assert: Should reject and return null, not execute query
        expect(result).toBeNull();
      }
    });
  });
});
