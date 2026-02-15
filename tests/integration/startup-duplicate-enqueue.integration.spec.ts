/**
 * DT0.2: Startup Duplicate Enqueue Integration Test
 *
 * Risk Coverage: D-R7 (Startup duplicate enqueue)
 *
 * Scenario: When the app starts, it may re-enqueue pending items that were
 * already in the queue from a previous session. This test verifies that
 * duplicate prevention mechanisms work correctly.
 *
 * @module tests/integration/startup-duplicate-enqueue.integration.spec
 * @security DB-006: Tenant isolation verified
 * @security SEC-006: All queries parameterized
 * @standard TEST-001: AAA pattern
 * @standard TEST-003: Test isolation
 * @standard TEST-004: Deterministic tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted() to ensure mock functions are available when vi.mock runs
const { mockPrepare, mockTransaction } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn((fn: () => void) => () => fn()),
}));

vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

// Mock uuid to return predictable values for deterministic tests
let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: vi.fn(() => `mock-uuid-${++uuidCounter}`),
}));

import { SyncQueueDAL, type SyncQueueItem } from '../../src/main/dal/sync-queue.dal';

describe('DT0.2: Startup Duplicate Enqueue Scenario', () => {
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
  // Scenario 1: PULL tracking items should reuse existing items
  // ==========================================================================

  describe('PULL tracking item reuse (prevents duplicate enqueue)', () => {
    it('should return existing PULL item instead of creating duplicate', () => {
      // Arrange: Existing PULL item from previous session
      const existingPullItem: SyncQueueItem = {
        id: 'existing-pull-id',
        store_id: 'store-123',
        entity_type: 'bin',
        entity_id: 'pull-1706537000000',
        operation: 'UPDATE',
        payload: '{"action":"pull_bins"}',
        priority: 0,
        synced: 0,
        sync_attempts: 1, // Already attempted once
        max_attempts: 2,
        last_sync_error: 'Network timeout',
        last_attempt_at: '2024-01-29T10:00:00Z',
        created_at: '2024-01-29T09:00:00Z',
        synced_at: null,
        sync_direction: 'PULL',
        api_endpoint: '/api/v1/sync/lottery/bins',
        http_status: 500,
        response_body: '{"error":"Internal server error"}',
        dead_lettered: 0,
        dead_letter_reason: null,
        dead_lettered_at: null,
        error_category: 'TRANSIENT',
        retry_after: null,
        idempotency_key: null,
      };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(existingPullItem),
      });

      // Act: Check for existing PULL item
      const result = dal.getPendingPullItem('store-123', 'bin');

      // Assert: Should return existing item, not create new
      expect(result).toEqual(existingPullItem);
      expect(result?.sync_attempts).toBe(1); // Preserves attempt history
    });

    it('should not create duplicate when hasPendingPullForEntityType returns true', () => {
      // Arrange: Simulate existing PULL item
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ '1': 1 }), // EXISTS query returns a row
      });

      // Act
      const hasPending = dal.hasPendingPullForEntityType('store-123', 'game');

      // Assert
      expect(hasPending).toBe(true);
      // Query should check for PULL direction, synced=0, dead_lettered=0
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("sync_direction = 'PULL'"));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('synced = 0'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('dead_lettered = 0'));
    });

    it('should return null when no pending PULL item exists', () => {
      // Arrange: No existing PULL item
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      // Act
      const result = dal.getPendingPullItem('store-123', 'user');

      // Assert
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // Scenario 2: Concurrent startup race conditions
  // ==========================================================================

  describe('Concurrent enqueue race condition handling', () => {
    it('should prevent duplicate by action pattern in payload', () => {
      // Arrange: Existing PULL item with specific action
      const existingItem: SyncQueueItem = {
        id: 'action-pull-id',
        store_id: 'store-123',
        entity_type: 'pack',
        entity_id: 'pull-activated-1706537000000',
        operation: 'UPDATE',
        payload: '{"action":"pull_activated_packs","timestamp":"2024-01-29T09:00:00Z"}',
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
        get: vi.fn().mockReturnValue(existingItem),
      });

      // Act: Query by action pattern
      const result = dal.getPendingPullItemByAction('store-123', 'pull_activated_packs');

      // Assert: Should find the item by JSON payload action
      expect(result).toEqual(existingItem);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('payload LIKE ?'));
    });

    it('should reject invalid action patterns (SEC-006 allowlist)', () => {
      // Arrange: Malicious action pattern
      const mockGet = vi.fn();
      mockPrepare.mockReturnValue({ get: mockGet });

      // Act: Attempt injection via action parameter
      const result = dal.getPendingPullItemByAction('store-123', "'; DROP TABLE sync_queue; --");

      // Assert: Should return null and NOT execute query
      expect(result).toBeNull();
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('should scope queries to store_id (DB-006 tenant isolation)', () => {
      // Arrange
      const mockGet = vi.fn().mockReturnValue(null);
      mockPrepare.mockReturnValue({ get: mockGet });

      // Act
      dal.getPendingPullItemByAction('tenant-abc-123', 'pull_bins');

      // Assert: store_id should be first parameter
      expect(mockGet).toHaveBeenCalledWith(
        'tenant-abc-123',
        expect.any(String) // LIKE pattern
      );
    });
  });

  // ==========================================================================
  // Scenario 3: Startup cleanup of stale PULL items
  // ==========================================================================

  describe('Startup stale PULL item cleanup', () => {
    it('should clean up old PULL items at startup (cleanupAllStalePullTracking)', () => {
      // Arrange
      const mockRun = vi.fn().mockReturnValue({ changes: 15 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Act: Startup cleanup (10 minute default)
      const deleted = dal.cleanupAllStalePullTracking('store-123', 10);

      // Assert
      expect(deleted).toBe(15);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("sync_direction = 'PULL'"));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('synced = 0'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('created_at < ?'));
    });

    it('should cleanup items after successful PULL (cleanupStalePullTracking)', () => {
      // Arrange
      const mockRun = vi.fn().mockReturnValue({ changes: 3 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Act: After successful bin sync, cleanup old bin PULL items
      const deleted = dal.cleanupStalePullTracking('store-123', 'pull_bins', 'current-item-id');

      // Assert
      expect(deleted).toBe(3);
      // Should exclude current item
      expect(mockRun).toHaveBeenCalledWith(
        'store-123',
        'current-item-id',
        expect.any(String), // cutoffTime
        '%"action":"pull_bins"%'
      );
    });

    it('should not cleanup items from other actions', () => {
      // Arrange
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Act: Cleanup bins
      dal.cleanupStalePullTracking('store-123', 'pull_bins', 'current-id');

      // Assert: Should only match pull_bins action
      const likePattern = mockRun.mock.calls[0][3];
      expect(likePattern).toBe('%"action":"pull_bins"%');
      expect(likePattern).not.toContain('pull_games');
    });
  });

  // ==========================================================================
  // Scenario 4: Failed PULL items from previous session
  // ==========================================================================

  describe('Failed PULL item handling at startup', () => {
    it('should find PULL items with attempts for dead-lettering', () => {
      // Arrange: PULL items that failed in previous session
      const failedPullItems: Array<{ sync_attempts: number; entity_id: string }> = [
        { sync_attempts: 1, entity_id: 'pull-1706537000000' },
        { sync_attempts: 2, entity_id: 'pull-1706537001000' },
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(failedPullItems),
      });

      // Act
      const result = dal.getPullItemsWithAttempts('store-123');

      // Assert
      expect(result).toHaveLength(2);
      // Query should filter for PULL items with sync_attempts >= 1
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('sync_attempts >= 1'));
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("(sync_direction = 'PULL' OR entity_id LIKE 'pull-%')")
      );
    });

    it('should scope to store_id for tenant isolation (DB-006)', () => {
      // Arrange
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValue({ all: mockAll });

      // Act
      dal.getPullItemsWithAttempts('isolated-tenant-store');

      // Assert
      expect(mockAll).toHaveBeenCalledWith('isolated-tenant-store');
    });
  });

  // ==========================================================================
  // Scenario 5: Entity deduplication invariants
  // ==========================================================================

  describe('Entity-level deduplication', () => {
    it('hasPendingSync should detect existing sync for entity', () => {
      // Arrange: Entity already has pending sync
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ '1': 1 }),
      });

      // Act
      const hasPending = dal.hasPendingSync('pack', 'pack-123');

      // Assert
      expect(hasPending).toBe(true);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('entity_type = ? AND entity_id = ? AND synced = 0')
      );
    });

    it('hasPendingSync should return false when no pending sync exists', () => {
      // Arrange
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      // Act
      const hasPending = dal.hasPendingSync('shift', 'shift-456');

      // Assert
      expect(hasPending).toBe(false);
    });

    it('deleteByEntityId should remove all pending items for entity before re-enqueue', () => {
      // Arrange
      const mockRun = vi.fn().mockReturnValue({ changes: 2 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Act: Clean up before re-enqueue (common pattern for shift resync)
      const deleted = dal.deleteByEntityId('store-123', 'shift', 'shift-789');

      // Assert
      expect(deleted).toBe(2);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM sync_queue'));
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('store_id = ? AND entity_type = ? AND entity_id = ?')
      );
    });
  });

  // ==========================================================================
  // Scenario 6: Error state preservation across restarts
  // ==========================================================================

  describe('Error state preservation', () => {
    it('should preserve error category when finding pending PULL items', () => {
      // Arrange: PULL item with error category from previous failure
      const itemWithError: SyncQueueItem = {
        id: 'error-item',
        store_id: 'store-123',
        entity_type: 'game',
        entity_id: 'pull-games-1706537000000',
        operation: 'UPDATE',
        payload: '{"action":"pull_games"}',
        priority: 0,
        synced: 0,
        sync_attempts: 1,
        max_attempts: 2,
        last_sync_error: 'Rate limited',
        last_attempt_at: '2024-01-29T10:00:00Z',
        created_at: '2024-01-29T09:00:00Z',
        synced_at: null,
        sync_direction: 'PULL',
        api_endpoint: '/api/v1/sync/lottery/games',
        http_status: 429,
        response_body: '{"error":"Too many requests"}',
        dead_lettered: 0,
        dead_letter_reason: null,
        dead_lettered_at: null,
        error_category: 'TRANSIENT',
        retry_after: '2024-01-29T10:01:00Z',
        idempotency_key: null,
      };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(itemWithError),
      });

      // Act
      const result = dal.getPendingPullItem('store-123', 'game');

      // Assert: Error state preserved
      expect(result?.error_category).toBe('TRANSIENT');
      expect(result?.http_status).toBe(429);
      expect(result?.retry_after).toBe('2024-01-29T10:01:00Z');
    });
  });
});
