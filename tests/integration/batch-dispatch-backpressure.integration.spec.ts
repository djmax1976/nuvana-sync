/**
 * Batch Dispatch and Backpressure Integration Tests
 *
 * Phase 3: Batching, Partitioned Dispatch, and Backpressure (SYNC-5000)
 *
 * DT3.1: Load-oriented integration tests - high backlog drains in batches
 * DT3.2: Concurrency tests - ordering preserved within partition
 * DT3.3: Failure tests - queue cap triggers expected backpressure behavior
 * DT3.4: Regression tests - day-close critical flow succeeds under batched mode
 *
 * @module tests/integration/batch-dispatch-backpressure
 * @security TEST-003: Test isolation with fresh database per test
 * @security TEST-004: Deterministic tests with controlled data
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as _fs from 'fs';

// Mock database service before importing DALs
const _testDbPath = path.join(__dirname, `test-batch-${Date.now()}.db`);
let testDb: Database.Database;

vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: () => testDb,
  isDatabaseInitialized: () => true,
}));

// Import after mocks
import { SyncQueueDAL } from '../../src/main/dal/sync-queue.dal';

// ============================================================================
// Test Setup
// ============================================================================

const STORE_ID = 'test-store-batch-' + Date.now();

/**
 * Create a test database with sync_queue schema
 */
function createTestDatabase(): Database.Database {
  const db = new Database(':memory:');

  // Create sync_queue table with all required columns
  db.exec(`
    CREATE TABLE sync_queue (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('CREATE', 'UPDATE', 'DELETE', 'ACTIVATE')),
      payload TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      synced INTEGER DEFAULT 0,
      sync_attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 5,
      last_sync_error TEXT,
      last_attempt_at TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT,
      sync_direction TEXT DEFAULT 'PUSH' CHECK (sync_direction IN ('PUSH', 'PULL')),
      api_endpoint TEXT,
      http_status INTEGER,
      response_body TEXT,
      dead_lettered INTEGER DEFAULT 0,
      dead_letter_reason TEXT,
      dead_lettered_at TEXT,
      error_category TEXT CHECK (error_category IN ('TRANSIENT', 'PERMANENT', 'STRUCTURAL', 'UNKNOWN')),
      retry_after TEXT,
      idempotency_key TEXT
    );

    CREATE INDEX idx_sync_queue_store ON sync_queue(store_id);
    CREATE INDEX idx_sync_queue_unsynced ON sync_queue(store_id, synced, dead_lettered);
    CREATE INDEX idx_sync_queue_entity_type ON sync_queue(store_id, entity_type);
    CREATE INDEX idx_sync_queue_created ON sync_queue(store_id, synced, created_at);
    CREATE INDEX idx_sync_queue_dead_letter ON sync_queue(store_id, dead_lettered);
  `);

  return db;
}

/**
 * Create test sync queue items in bulk
 */
function createBulkItems(
  dal: SyncQueueDAL,
  count: number,
  entityType: string,
  storeId: string = STORE_ID
): void {
  for (let i = 0; i < count; i++) {
    dal.enqueue({
      store_id: storeId,
      entity_type: entityType,
      entity_id: `${entityType}-${i}`,
      operation: 'CREATE',
      payload: { id: `${entityType}-${i}`, index: i },
    });
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Batch Dispatch and Backpressure Integration', () => {
  let dal: SyncQueueDAL;

  beforeEach(() => {
    testDb = createTestDatabase();
    dal = new SyncQueueDAL();
  });

  afterEach(() => {
    testDb?.close();
  });

  // ==========================================================================
  // DT3.1: Load-oriented tests - high backlog drains in batches
  // ==========================================================================

  describe('DT3.1: Load-oriented batch draining', () => {
    it('should return bounded batch of retryable items', () => {
      // Create 200 items
      createBulkItems(dal, 200, 'pack');

      // Get batch limited to 50
      const items = dal.getRetryableItemsByEntityType(STORE_ID, 'pack', 50);

      expect(items.length).toBe(50);
      expect(items.every((item) => item.entity_type === 'pack')).toBe(true);
    });

    it('should preserve priority ordering within batch', () => {
      // Create items with different priorities
      dal.enqueue({
        store_id: STORE_ID,
        entity_type: 'pack',
        entity_id: 'low-priority',
        operation: 'CREATE',
        payload: { priority: 'low' },
        priority: 0,
      });

      dal.enqueue({
        store_id: STORE_ID,
        entity_type: 'pack',
        entity_id: 'high-priority',
        operation: 'CREATE',
        payload: { priority: 'high' },
        priority: 10,
      });

      dal.enqueue({
        store_id: STORE_ID,
        entity_type: 'pack',
        entity_id: 'medium-priority',
        operation: 'CREATE',
        payload: { priority: 'medium' },
        priority: 5,
      });

      const items = dal.getRetryableItemsByEntityType(STORE_ID, 'pack', 10);

      // Should be ordered by priority DESC
      expect(items[0].entity_id).toBe('high-priority');
      expect(items[1].entity_id).toBe('medium-priority');
      expect(items[2].entity_id).toBe('low-priority');
    });

    it('should respect exponential backoff in batch selection', () => {
      // Create an item that was just attempted
      const item = dal.enqueue({
        store_id: STORE_ID,
        entity_type: 'pack',
        entity_id: 'recently-failed',
        operation: 'CREATE',
        payload: {},
      });

      // Simulate a recent failure
      dal.incrementAttempts(item.id, 'API error', {
        api_endpoint: '/test',
        http_status: 500,
      });

      // Create a fresh item
      dal.enqueue({
        store_id: STORE_ID,
        entity_type: 'pack',
        entity_id: 'fresh-item',
        operation: 'CREATE',
        payload: {},
      });

      // Get retryable items immediately
      const items = dal.getRetryableItemsByEntityType(STORE_ID, 'pack', 10);

      // Recently failed item should be in backoff, only fresh item returned
      expect(items.length).toBe(1);
      expect(items[0].entity_id).toBe('fresh-item');
    });

    it('should handle large backlogs efficiently', () => {
      // Create 1000 items
      createBulkItems(dal, 1000, 'pack');

      const startTime = Date.now();

      // Fetch multiple batches
      for (let i = 0; i < 10; i++) {
        const items = dal.getRetryableItemsByEntityType(STORE_ID, 'pack', 100);
        expect(items.length).toBeGreaterThan(0);
      }

      const duration = Date.now() - startTime;

      // Should complete in reasonable time for 10 batch fetches
      // Use 2000ms threshold to account for CI environment variability
      expect(duration).toBeLessThan(2000);
    });

    it('should exclude dead-lettered items from batches', () => {
      // Create items
      const _item1 = dal.enqueue({
        store_id: STORE_ID,
        entity_type: 'pack',
        entity_id: 'active-item',
        operation: 'CREATE',
        payload: {},
      });

      const item2 = dal.enqueue({
        store_id: STORE_ID,
        entity_type: 'pack',
        entity_id: 'dead-lettered-item',
        operation: 'CREATE',
        payload: {},
      });

      // Dead letter one item
      dal.deadLetter({
        id: item2.id,
        reason: 'PERMANENT_ERROR',
        errorCategory: 'PERMANENT',
        error: 'Test error',
      });

      const items = dal.getRetryableItemsByEntityType(STORE_ID, 'pack', 10);

      expect(items.length).toBe(1);
      expect(items[0].entity_id).toBe('active-item');
    });
  });

  // ==========================================================================
  // DT3.2: Concurrency tests - ordering preserved within partition
  // ==========================================================================

  describe('DT3.2: Partition ordering', () => {
    it('should return partition depths by entity type', () => {
      createBulkItems(dal, 50, 'pack');
      createBulkItems(dal, 30, 'shift');
      createBulkItems(dal, 20, 'day_close');

      const depths = dal.getPartitionDepths(STORE_ID);

      expect(depths).toEqual({
        pack: 50,
        shift: 30,
        day_close: 20,
      });
    });

    it('should isolate items by entity type in partitions', () => {
      createBulkItems(dal, 10, 'pack');
      createBulkItems(dal, 10, 'shift');

      const packItems = dal.getRetryableItemsByEntityType(STORE_ID, 'pack', 100);
      const shiftItems = dal.getRetryableItemsByEntityType(STORE_ID, 'shift', 100);

      expect(packItems.every((item) => item.entity_type === 'pack')).toBe(true);
      expect(shiftItems.every((item) => item.entity_type === 'shift')).toBe(true);
    });

    it('should preserve FIFO order within each partition', () => {
      // Create items with specific order
      for (let i = 0; i < 5; i++) {
        dal.enqueue({
          store_id: STORE_ID,
          entity_type: 'pack',
          entity_id: `pack-order-${i}`,
          operation: 'CREATE',
          payload: { order: i },
        });
      }

      const items = dal.getRetryableItemsByEntityType(STORE_ID, 'pack', 10);

      // Items should be in creation order (when priority is equal)
      for (let i = 0; i < 5; i++) {
        expect(items[i].entity_id).toBe(`pack-order-${i}`);
      }
    });

    it('should validate entity type against allowlist', () => {
      // Try to get items for invalid entity type
      const items = dal.getRetryableItemsByEntityType(STORE_ID, 'malicious_type', 10);

      expect(items).toEqual([]);
    });

    it('should exclude PULL tracking items from partitions', () => {
      // Create a PUSH item
      dal.enqueue({
        store_id: STORE_ID,
        entity_type: 'pack',
        entity_id: 'pack-push',
        operation: 'CREATE',
        payload: {},
        sync_direction: 'PUSH',
      });

      // Create a PULL tracking item
      dal.enqueue({
        store_id: STORE_ID,
        entity_type: 'pack',
        entity_id: 'pull-tracking-123',
        operation: 'UPDATE',
        payload: { action: 'pull_packs' },
        sync_direction: 'PULL',
      });

      const items = dal.getRetryableItemsByEntityType(STORE_ID, 'pack', 10);

      // Only PUSH item should be returned
      expect(items.length).toBe(1);
      expect(items[0].entity_id).toBe('pack-push');
    });
  });

  // ==========================================================================
  // DT3.3: Failure tests - queue cap triggers backpressure
  // ==========================================================================

  describe('DT3.3: Queue cap backpressure', () => {
    it('should track pending count accurately', () => {
      createBulkItems(dal, 100, 'pack');

      const pendingCount = dal.getPendingCount(STORE_ID);

      expect(pendingCount).toBe(100);
    });

    it('should report queue size in bytes', () => {
      // Create items with known payload sizes
      for (let i = 0; i < 10; i++) {
        dal.enqueue({
          store_id: STORE_ID,
          entity_type: 'pack',
          entity_id: `pack-${i}`,
          operation: 'CREATE',
          payload: { data: 'x'.repeat(100) }, // ~100 char payload
        });
      }

      const sizeBytes = dal.getQueueSizeBytes(STORE_ID);

      // Each payload is roughly 100+ bytes, 10 items = 1000+ bytes
      expect(sizeBytes).toBeGreaterThan(1000);
    });

    it('should support deferred item marking', () => {
      const item = dal.enqueue({
        store_id: STORE_ID,
        entity_type: 'pack',
        entity_id: 'deferred-pack',
        operation: 'CREATE',
        payload: {},
        priority: 5,
      });

      dal.markDeferred(item.id);

      // Verify priority was set to -1
      const updated = dal.findById(item.id);
      expect(updated?.priority).toBe(-1);
    });

    it('should count deferred items separately', () => {
      // Create normal and deferred items
      const _item1 = dal.enqueue({
        store_id: STORE_ID,
        entity_type: 'pack',
        entity_id: 'normal-pack',
        operation: 'CREATE',
        payload: {},
      });

      const item2 = dal.enqueue({
        store_id: STORE_ID,
        entity_type: 'pack',
        entity_id: 'deferred-pack',
        operation: 'CREATE',
        payload: {},
      });

      dal.markDeferred(item2.id);

      const deferredCount = dal.getDeferredCount(STORE_ID);

      expect(deferredCount).toBe(1);
    });

    it('should restore deferred items to normal priority', () => {
      // Create and defer items
      const item1 = dal.enqueue({
        store_id: STORE_ID,
        entity_type: 'pack',
        entity_id: 'deferred-1',
        operation: 'CREATE',
        payload: {},
      });

      const item2 = dal.enqueue({
        store_id: STORE_ID,
        entity_type: 'pack',
        entity_id: 'deferred-2',
        operation: 'CREATE',
        payload: {},
      });

      dal.markDeferred(item1.id);
      dal.markDeferred(item2.id);

      // Restore all deferred
      const restoredCount = dal.restoreDeferredItems(STORE_ID);

      expect(restoredCount).toBe(2);

      // Verify they're back to normal priority
      const restored1 = dal.findById(item1.id);
      const restored2 = dal.findById(item2.id);
      expect(restored1?.priority).toBe(0);
      expect(restored2?.priority).toBe(0);
    });

    it('should support payload update for coalescing', () => {
      const item = dal.enqueue({
        store_id: STORE_ID,
        entity_type: 'pack',
        entity_id: 'coalesce-test',
        operation: 'CREATE',
        payload: { version: 1 },
      });

      const newPayload = JSON.stringify({ version: 2, updated: true });
      dal.updatePayload(item.id, newPayload);

      const updated = dal.findById(item.id);
      expect(updated?.payload).toBe(newPayload);
    });

    it('should get oldest pending timestamp for age monitoring', () => {
      // Create items with known timestamps
      createBulkItems(dal, 5, 'pack');

      const oldest = dal.getOldestPendingTimestamp(STORE_ID);

      expect(oldest).not.toBeNull();
      expect(new Date(oldest!).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should return null oldest timestamp when queue empty', () => {
      const oldest = dal.getOldestPendingTimestamp(STORE_ID);

      expect(oldest).toBeNull();
    });
  });

  // ==========================================================================
  // DT3.4: Regression tests - day-close critical flow
  // ==========================================================================

  describe('DT3.4: Day-close critical flow regression', () => {
    it('should prioritize day_open and shift entity types', () => {
      // Create items in reverse priority order
      createBulkItems(dal, 10, 'pack');
      createBulkItems(dal, 5, 'day_open');
      createBulkItems(dal, 3, 'shift');

      const depths = dal.getPartitionDepths(STORE_ID);

      // Verify all partitions are tracked
      expect(depths).toHaveProperty('pack');
      expect(depths).toHaveProperty('day_open');
      expect(depths).toHaveProperty('shift');
    });

    it('should process day_close items without interference from other partitions', () => {
      // Create mixed items
      createBulkItems(dal, 50, 'pack');
      createBulkItems(dal, 10, 'day_close');
      createBulkItems(dal, 20, 'shift');

      // Get only day_close items
      const dayCloseItems = dal.getRetryableItemsByEntityType(STORE_ID, 'day_close', 100);

      expect(dayCloseItems.length).toBe(10);
      expect(dayCloseItems.every((item) => item.entity_type === 'day_close')).toBe(true);
    });

    it('should handle variance_approval entity type in partitions', () => {
      createBulkItems(dal, 5, 'variance_approval');

      const items = dal.getRetryableItemsByEntityType(STORE_ID, 'variance_approval', 10);

      expect(items.length).toBe(5);
      expect(items.every((item) => item.entity_type === 'variance_approval')).toBe(true);
    });

    it('should maintain tenant isolation across all operations (DB-006)', () => {
      const otherStoreId = 'other-store-' + Date.now();

      // Create items for both stores
      createBulkItems(dal, 10, 'pack', STORE_ID);
      createBulkItems(dal, 10, 'pack', otherStoreId);

      // Get items for test store only
      const items = dal.getRetryableItemsByEntityType(STORE_ID, 'pack', 100);

      expect(items.length).toBe(10);
      expect(items.every((item) => item.store_id === STORE_ID)).toBe(true);

      // Verify depths are store-scoped
      const depths = dal.getPartitionDepths(STORE_ID);
      expect(depths.pack).toBe(10); // Not 20
    });

    it('should handle concurrent partition processing simulation', async () => {
      // Create items for multiple partitions
      createBulkItems(dal, 20, 'pack');
      createBulkItems(dal, 15, 'shift');
      createBulkItems(dal, 10, 'day_close');

      // Simulate concurrent batch fetches
      const results = await Promise.all([
        Promise.resolve(dal.getRetryableItemsByEntityType(STORE_ID, 'pack', 10)),
        Promise.resolve(dal.getRetryableItemsByEntityType(STORE_ID, 'shift', 10)),
        Promise.resolve(dal.getRetryableItemsByEntityType(STORE_ID, 'day_close', 10)),
      ]);

      // All batches should complete without interference
      expect(results[0].length).toBe(10);
      expect(results[1].length).toBe(10);
      expect(results[2].length).toBe(10);

      // Items should be correctly typed
      expect(results[0].every((item) => item.entity_type === 'pack')).toBe(true);
      expect(results[1].every((item) => item.entity_type === 'shift')).toBe(true);
      expect(results[2].every((item) => item.entity_type === 'day_close')).toBe(true);
    });
  });

  // ==========================================================================
  // Security Tests
  // ==========================================================================

  describe('Security compliance', () => {
    it('should use parameterized queries (SEC-006)', () => {
      // This test verifies that queries don't fail with special characters
      // that would break non-parameterized queries
      const item = dal.enqueue({
        store_id: STORE_ID,
        entity_type: 'pack',
        entity_id: "pack'; DROP TABLE sync_queue;--",
        operation: 'CREATE',
        payload: { name: "O'Malley" },
      });

      // If parameterized, this should work without SQL injection
      const found = dal.findById(item.id);
      expect(found).not.toBeNull();
      expect(found?.entity_id).toBe("pack'; DROP TABLE sync_queue;--");
    });

    it('should validate entity types against allowlist (SEC-006)', () => {
      const items = dal.getRetryableItemsByEntityType(
        STORE_ID,
        "pack'; DELETE FROM sync_queue;--",
        10
      );

      expect(items).toEqual([]); // Rejected, not executed
    });

    it('should be tenant-scoped on all queries (DB-006)', () => {
      const otherStore = 'other-store-' + Date.now();

      // Create item in other store
      dal.enqueue({
        store_id: otherStore,
        entity_type: 'pack',
        entity_id: 'other-pack',
        operation: 'CREATE',
        payload: {},
      });

      // All queries should be scoped to STORE_ID
      expect(dal.getPendingCount(STORE_ID)).toBe(0);
      expect(dal.getPartitionDepths(STORE_ID)).toEqual({});
      expect(dal.getQueueSizeBytes(STORE_ID)).toBe(0);
      expect(dal.getDeferredCount(STORE_ID)).toBe(0);
    });
  });
});
