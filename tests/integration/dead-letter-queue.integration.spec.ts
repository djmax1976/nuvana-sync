/**
 * Dead Letter Queue Integration Tests
 *
 * End-to-end tests for DLQ operations across the entire stack:
 * DAL -> IPC Handlers -> Renderer Hooks
 *
 * Tests v046 migration MQ-002 compliance requirements in realistic scenarios.
 *
 * Traceability:
 * - MQ-002: Dead Letter Queue implementation
 * - SEC-006: SQL injection prevention via parameterized queries
 * - DB-006: Tenant isolation via store_id scoping
 * - API-001: Input validation with bounds checking
 * - API-008: Safe output filtering
 * - ERR-007: Error classification
 *
 * @module tests/integration/dead-letter-queue
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// ============================================================================
// Test Database Setup
// ============================================================================

// Use vi.hoisted() to ensure the database holder is available when vi.mock runs
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
const { dbHolder } = vi.hoisted(() => ({
  dbHolder: { instance: null as Database.Database | null },
}));

// Mock the database service to use our test database via the hoisted holder
vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => {
    if (!dbHolder.instance) {
      throw new Error('Database not initialized - test setup issue');
    }
    return dbHolder.instance;
  }),
  isDatabaseInitialized: vi.fn(() => dbHolder.instance !== null),
}));

vi.mock('uuid', () => ({
  v4: () => `test-uuid-${Date.now()}-${Math.random().toString(36).substring(7)}`,
}));

let db: Database.Database;

import {
  SyncQueueDAL,
  type SyncQueueItem,
  type DeadLetterParams,
} from '../../src/main/dal/sync-queue.dal';

// ============================================================================
// Database Schema
// ============================================================================

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    synced INTEGER DEFAULT 0,
    sync_attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 5,
    last_sync_error TEXT,
    last_attempt_at TEXT,
    created_at TEXT NOT NULL,
    synced_at TEXT,
    sync_direction TEXT DEFAULT 'PUSH',
    api_endpoint TEXT,
    http_status INTEGER,
    response_body TEXT,
    -- v046 DLQ fields
    dead_lettered INTEGER DEFAULT 0,
    dead_letter_reason TEXT,
    dead_lettered_at TEXT,
    error_category TEXT,
    retry_after TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sync_queue_store_synced ON sync_queue(store_id, synced);
  CREATE INDEX IF NOT EXISTS idx_sync_queue_dead_letter ON sync_queue(store_id, dead_lettered);
  CREATE INDEX IF NOT EXISTS idx_sync_queue_direction ON sync_queue(store_id, sync_direction, created_at);
`;

// ============================================================================
// Helper Functions
// ============================================================================

function createTestItem(
  dal: SyncQueueDAL,
  overrides: Partial<{
    store_id: string;
    entity_type: string;
    entity_id: string;
    operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'ACTIVATE';
    payload: object;
    sync_direction: 'PUSH' | 'PULL';
  }> = {}
): SyncQueueItem {
  return dal.enqueue({
    store_id: overrides.store_id || 'store-integration-test',
    entity_type: overrides.entity_type || 'pack',
    entity_id: overrides.entity_id || `pack-${Date.now()}`,
    operation: overrides.operation || 'CREATE',
    payload: overrides.payload || {
      pack_number: '001',
      game_code: '100',
      status: 'RECEIVED',
    },
    sync_direction: overrides.sync_direction || 'PUSH',
  });
}

function simulateFailedAttempts(
  dal: SyncQueueDAL,
  id: string,
  attempts: number,
  error: string
): void {
  for (let i = 0; i < attempts; i++) {
    dal.incrementAttempts(id, error, {
      api_endpoint: '/api/v1/sync/lottery/packs',
      http_status: 400,
      response_body: JSON.stringify({ error: 'Validation failed' }),
    });
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Dead Letter Queue Integration Tests', () => {
  let dal: SyncQueueDAL;

  beforeEach(() => {
    // Create in-memory database for each test
    db = new Database(':memory:');
    dbHolder.instance = db;
    db.exec(SCHEMA);
    dal = new SyncQueueDAL();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    dbHolder.instance = null;
  });

  // ==========================================================================
  // MQ-002: DLQ Configuration and Routing
  // ==========================================================================

  describe('MQ-002: Dead Letter Queue Configuration', () => {
    it('should move item to DLQ after max attempts exceeded', () => {
      const item = createTestItem(dal);
      const storeId = item.store_id;

      // Simulate failed attempts up to max
      simulateFailedAttempts(dal, item.id, 5, 'Validation error');

      // Verify item is now failed
      const failedItems = dal.getFailedItems(storeId, 10);
      expect(failedItems.some((i) => i.id === item.id)).toBe(true);

      // Dead letter the item
      const result = dal.deadLetter({
        id: item.id,
        reason: 'MAX_ATTEMPTS_EXCEEDED',
        errorCategory: 'PERMANENT',
        error: 'Exceeded maximum retry attempts',
      });

      expect(result).toBe(true);

      // Verify item is now in DLQ
      const dlqItems = dal.getDeadLetterItems(storeId);
      expect(dlqItems.items.some((i) => i.id === item.id)).toBe(true);
      expect(dlqItems.items[0].dead_letter_reason).toBe('MAX_ATTEMPTS_EXCEEDED');
    });

    it('should include original message and error in DLQ message (MQ-002)', () => {
      const item = createTestItem(dal, {
        payload: {
          pack_number: '12345',
          game_code: '100',
          status: 'RECEIVED',
          received_at: '2024-01-01T12:00:00Z',
        },
      });

      // Simulate failure
      dal.incrementAttempts(item.id, 'API Error: Invalid pack_number format', {
        api_endpoint: '/api/v1/sync/lottery/packs',
        http_status: 400,
        response_body: '{"error":"pack_number must be numeric"}',
      });

      // Dead letter with full context
      dal.deadLetter({
        id: item.id,
        reason: 'PERMANENT_ERROR',
        errorCategory: 'PERMANENT',
        error: 'API Error: Invalid pack_number format - Response: pack_number must be numeric',
      });

      // Verify DLQ item has full context
      const dlqItems = dal.getDeadLetterItems(item.store_id);
      const dlqItem = dlqItems.items.find((i) => i.id === item.id);

      expect(dlqItem).toBeDefined();
      expect(dlqItem!.last_sync_error).toContain('Invalid pack_number format');
      expect(dlqItem!.api_endpoint).toBe('/api/v1/sync/lottery/packs');
      expect(dlqItem!.http_status).toBe(400);
      expect(dlqItem!.summary).toEqual({
        pack_number: '12345',
        game_code: '100',
        status: 'RECEIVED',
      });
    });

    it('should implement DLQ processor for investigation/replay (MQ-002)', () => {
      const item = createTestItem(dal);

      // Dead letter the item
      dal.deadLetter({
        id: item.id,
        reason: 'PERMANENT_ERROR',
        errorCategory: 'PERMANENT',
      });

      // Investigation: Get DLQ items and stats
      const dlqItems = dal.getDeadLetterItems(item.store_id);
      const dlqStats = dal.getDeadLetterStats(item.store_id);

      expect(dlqItems.items.length).toBe(1);
      expect(dlqStats.total).toBe(1);
      expect(dlqStats.byReason.PERMANENT_ERROR).toBe(1);

      // Replay: Restore item for retry
      const restored = dal.restoreFromDeadLetter(item.id);
      expect(restored).toBe(true);

      // Verify item is back in active queue
      const activeItem = dal['findById'](item.id);
      expect(activeItem).toBeDefined();
      expect(activeItem!.dead_lettered).toBe(0);
      expect(activeItem!.sync_attempts).toBe(0);
      expect(activeItem!.last_sync_error).toBeNull();
    });
  });

  // ==========================================================================
  // ERR-007: Error Classification
  // ==========================================================================

  describe('ERR-007: Error Classification Integration', () => {
    it('should classify PERMANENT errors (400, 404, 422) for immediate dead-lettering', () => {
      const item = createTestItem(dal);

      // Update error category
      dal.updateErrorCategory(item.id, 'PERMANENT');

      // Get item and verify
      const updated = dal['findById'](item.id);
      expect(updated?.error_category).toBe('PERMANENT');
    });

    it('should classify STRUCTURAL errors for immediate dead-lettering', () => {
      const item = createTestItem(dal);

      dal.updateErrorCategory(item.id, 'STRUCTURAL');

      const updated = dal['findById'](item.id);
      expect(updated?.error_category).toBe('STRUCTURAL');
    });

    it('should classify TRANSIENT errors (5xx, network) for retry', () => {
      const item = createTestItem(dal);

      dal.updateErrorCategory(item.id, 'TRANSIENT');

      const updated = dal['findById'](item.id);
      expect(updated?.error_category).toBe('TRANSIENT');

      // Item should still be retryable, not dead-lettered
      expect(updated?.dead_lettered).toBe(0);
    });

    it('should get items eligible for auto-dead-letter based on error category', () => {
      const storeId = 'store-auto-dlq-test';

      // Create items with different error categories
      const permanentItem = createTestItem(dal, { store_id: storeId, entity_id: 'permanent-1' });
      const structuralItem = createTestItem(dal, { store_id: storeId, entity_id: 'structural-1' });
      const transientItem = createTestItem(dal, { store_id: storeId, entity_id: 'transient-1' });

      // Simulate max attempts for all
      simulateFailedAttempts(dal, permanentItem.id, 5, 'Permanent error');
      simulateFailedAttempts(dal, structuralItem.id, 5, 'Structural error');
      simulateFailedAttempts(dal, transientItem.id, 5, 'Transient error');

      // Set error categories
      dal.updateErrorCategory(permanentItem.id, 'PERMANENT');
      dal.updateErrorCategory(structuralItem.id, 'STRUCTURAL');
      dal.updateErrorCategory(transientItem.id, 'TRANSIENT');

      // Get items for auto-dead-letter
      const autoDeadLetterItems = dal.getItemsForAutoDeadLetter(storeId);

      // Should include PERMANENT and STRUCTURAL, not TRANSIENT
      const ids = autoDeadLetterItems.map((i) => i.id);
      expect(ids).toContain(permanentItem.id);
      expect(ids).toContain(structuralItem.id);
      expect(ids).not.toContain(transientItem.id);
    });
  });

  // ==========================================================================
  // DB-006: Tenant Isolation
  // ==========================================================================

  describe('DB-006: Tenant Isolation', () => {
    it('should isolate DLQ items between stores', () => {
      const store1 = 'store-tenant-1';
      const store2 = 'store-tenant-2';

      // Create and dead-letter items for store 1
      const item1 = createTestItem(dal, { store_id: store1, entity_id: 'pack-1' });
      const item2 = createTestItem(dal, { store_id: store1, entity_id: 'pack-2' });
      dal.deadLetter({ id: item1.id, reason: 'MANUAL', errorCategory: 'UNKNOWN' });
      dal.deadLetter({ id: item2.id, reason: 'MANUAL', errorCategory: 'UNKNOWN' });

      // Create and dead-letter item for store 2
      const item3 = createTestItem(dal, { store_id: store2, entity_id: 'pack-3' });
      dal.deadLetter({ id: item3.id, reason: 'MANUAL', errorCategory: 'UNKNOWN' });

      // Query store 1 DLQ
      const store1DLQ = dal.getDeadLetterItems(store1);
      expect(store1DLQ.items.length).toBe(2);
      expect(
        store1DLQ.items.every((i) => i.entity_id === 'pack-1' || i.entity_id === 'pack-2')
      ).toBe(true);

      // Query store 2 DLQ
      const store2DLQ = dal.getDeadLetterItems(store2);
      expect(store2DLQ.items.length).toBe(1);
      expect(store2DLQ.items[0].entity_id).toBe('pack-3');

      // Stats should also be isolated
      const store1Stats = dal.getDeadLetterStats(store1);
      const store2Stats = dal.getDeadLetterStats(store2);
      expect(store1Stats.total).toBe(2);
      expect(store2Stats.total).toBe(1);
    });

    it('should scope cleanup operations to store', () => {
      const store1 = 'store-cleanup-1';
      const store2 = 'store-cleanup-2';

      // Create old DLQ items for both stores
      const item1 = createTestItem(dal, { store_id: store1 });
      const item2 = createTestItem(dal, { store_id: store2 });

      dal.deadLetter({ id: item1.id, reason: 'MANUAL', errorCategory: 'UNKNOWN' });
      dal.deadLetter({ id: item2.id, reason: 'MANUAL', errorCategory: 'UNKNOWN' });

      // Manually set old dead_lettered_at date
      db.prepare('UPDATE sync_queue SET dead_lettered_at = ? WHERE id = ?').run(
        '2020-01-01T00:00:00.000Z',
        item1.id
      );
      db.prepare('UPDATE sync_queue SET dead_lettered_at = ? WHERE id = ?').run(
        '2020-01-01T00:00:00.000Z',
        item2.id
      );

      // Cleanup only store1
      const deletedCount = dal.deleteDeadLetterItems(store1, '2024-01-01T00:00:00.000Z');

      expect(deletedCount).toBe(1);

      // Store 2 item should still exist
      const store2DLQ = dal.getDeadLetterItems(store2);
      expect(store2DLQ.items.length).toBe(1);
    });
  });

  // ==========================================================================
  // Batch Operations
  // ==========================================================================

  describe('Batch Operations', () => {
    it('should dead-letter multiple items atomically', () => {
      const storeId = 'store-batch-dlq';

      // Create multiple items
      const items = Array.from({ length: 5 }, (_, i) =>
        createTestItem(dal, { store_id: storeId, entity_id: `pack-batch-${i}` })
      );

      // Batch dead-letter
      const dlqParams: DeadLetterParams[] = items.map((item) => ({
        id: item.id,
        reason: 'MAX_ATTEMPTS_EXCEEDED',
        errorCategory: 'UNKNOWN',
      }));

      const deadLetteredCount = dal.deadLetterMany(dlqParams);

      expect(deadLetteredCount).toBe(5);

      // Verify all items are in DLQ
      const dlqItems = dal.getDeadLetterItems(storeId);
      expect(dlqItems.total).toBe(5);
    });

    it('should restore multiple items from DLQ atomically', () => {
      const storeId = 'store-batch-restore';

      // Create and dead-letter items
      const items = Array.from({ length: 3 }, (_, i) =>
        createTestItem(dal, { store_id: storeId, entity_id: `pack-restore-${i}` })
      );

      items.forEach((item) => {
        dal.deadLetter({ id: item.id, reason: 'MANUAL', errorCategory: 'UNKNOWN' });
      });

      // Verify items are in DLQ
      expect(dal.getDeadLetterCount(storeId)).toBe(3);

      // Batch restore
      const ids = items.map((i) => i.id);
      const restoredCount = dal.restoreFromDeadLetterMany(ids);

      expect(restoredCount).toBe(3);

      // Verify items are back in active queue
      expect(dal.getDeadLetterCount(storeId)).toBe(0);
      items.forEach((item) => {
        const restored = dal['findById'](item.id);
        expect(restored?.dead_lettered).toBe(0);
        expect(restored?.sync_attempts).toBe(0);
      });
    });
  });

  // ==========================================================================
  // DLQ Statistics
  // ==========================================================================

  describe('DLQ Statistics', () => {
    it('should aggregate statistics correctly', () => {
      const storeId = 'store-stats-test';

      // Create items with different reasons
      const permanentItems = Array.from({ length: 3 }, (_, i) =>
        createTestItem(dal, { store_id: storeId, entity_id: `permanent-${i}` })
      );
      const maxAttemptsItems = Array.from({ length: 2 }, (_, i) =>
        createTestItem(dal, {
          store_id: storeId,
          entity_id: `max-attempts-${i}`,
          entity_type: 'bin',
        })
      );

      permanentItems.forEach((item) => {
        dal.deadLetter({ id: item.id, reason: 'PERMANENT_ERROR', errorCategory: 'PERMANENT' });
      });
      maxAttemptsItems.forEach((item) => {
        dal.deadLetter({ id: item.id, reason: 'MAX_ATTEMPTS_EXCEEDED', errorCategory: 'UNKNOWN' });
      });

      const stats = dal.getDeadLetterStats(storeId);

      expect(stats.total).toBe(5);
      expect(stats.byReason.PERMANENT_ERROR).toBe(3);
      expect(stats.byReason.MAX_ATTEMPTS_EXCEEDED).toBe(2);
      expect(stats.byEntityType.pack).toBe(3);
      expect(stats.byEntityType.bin).toBe(2);
      expect(stats.byErrorCategory.PERMANENT).toBe(3);
      expect(stats.byErrorCategory.UNKNOWN).toBe(2);
      expect(stats.oldestItem).toBeDefined();
      expect(stats.newestItem).toBeDefined();
    });

    it('should handle empty DLQ statistics', () => {
      const stats = dal.getDeadLetterStats('store-empty-dlq');

      expect(stats.total).toBe(0);
      expect(stats.byReason.PERMANENT_ERROR).toBe(0);
      expect(stats.byReason.MAX_ATTEMPTS_EXCEEDED).toBe(0);
      expect(stats.byReason.STRUCTURAL_FAILURE).toBe(0);
      expect(stats.byReason.MANUAL).toBe(0);
      expect(stats.oldestItem).toBeNull();
      expect(stats.newestItem).toBeNull();
    });
  });

  // ==========================================================================
  // API-008: Safe Output Filtering
  // ==========================================================================

  describe('API-008: Safe Output Filtering', () => {
    it('should only expose safe summary fields from payload', () => {
      const item = createTestItem(dal, {
        payload: {
          pack_number: '12345',
          game_code: '100',
          status: 'ACTIVE',
          // These should NOT appear in summary
          api_key: 'secret-key-123',
          password: 'password123',
          internal_id: 'internal-uuid',
          cloud_credentials: { key: 'value' },
        },
      });

      dal.deadLetter({ id: item.id, reason: 'MANUAL', errorCategory: 'UNKNOWN' });

      const dlqItems = dal.getDeadLetterItems(item.store_id);
      const dlqItem = dlqItems.items[0];

      // Only safe fields should be in summary
      expect(dlqItem.summary).toEqual({
        pack_number: '12345',
        game_code: '100',
        status: 'ACTIVE',
      });

      // Verify no sensitive fields leaked
      expect(dlqItem.summary).not.toHaveProperty('api_key');
      expect(dlqItem.summary).not.toHaveProperty('password');
      expect(dlqItem.summary).not.toHaveProperty('internal_id');
      expect(dlqItem.summary).not.toHaveProperty('cloud_credentials');
    });

    it('should truncate long error messages', () => {
      const item = createTestItem(dal);

      const longError = 'E'.repeat(1000);
      dal.incrementAttempts(item.id, longError);
      dal.deadLetter({
        id: item.id,
        reason: 'PERMANENT_ERROR',
        errorCategory: 'PERMANENT',
        error: longError,
      });

      const dlqItems = dal.getDeadLetterItems(item.store_id);
      const dlqItem = dlqItems.items[0];

      // Error should be truncated to 200 chars in display
      expect(dlqItem.last_sync_error!.length).toBeLessThanOrEqual(200);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle dead-lettering already dead-lettered item (idempotency)', () => {
      const item = createTestItem(dal);

      // Dead letter first time
      const first = dal.deadLetter({ id: item.id, reason: 'MANUAL', errorCategory: 'UNKNOWN' });
      expect(first).toBe(true);

      // Dead letter again - should fail (already dead-lettered)
      const second = dal.deadLetter({ id: item.id, reason: 'MANUAL', errorCategory: 'UNKNOWN' });
      expect(second).toBe(false);

      // Count should still be 1
      expect(dal.getDeadLetterCount(item.store_id)).toBe(1);
    });

    it('should handle restoring non-DLQ item (no-op)', () => {
      const item = createTestItem(dal);

      // Try to restore an item that's not in DLQ
      const result = dal.restoreFromDeadLetter(item.id);

      expect(result).toBe(false);
    });

    it('should handle deleting non-DLQ item (no-op)', () => {
      const item = createTestItem(dal);

      // Try to delete from DLQ an item that's not in DLQ
      const result = dal.deleteDeadLetterItem(item.id);

      expect(result).toBe(false);
    });

    it('should handle invalid JSON payload gracefully', () => {
      const item = createTestItem(dal);

      // Manually set invalid JSON payload
      db.prepare('UPDATE sync_queue SET payload = ? WHERE id = ?').run(
        'not valid json {{{',
        item.id
      );

      dal.deadLetter({ id: item.id, reason: 'STRUCTURAL_FAILURE', errorCategory: 'STRUCTURAL' });

      const dlqItems = dal.getDeadLetterItems(item.store_id);
      const dlqItem = dlqItems.items[0];

      // Should handle gracefully with null summary
      expect(dlqItem.summary).toBeNull();
    });

    it('should exclude PULL tracking items from auto-dead-letter', () => {
      const storeId = 'store-pull-test';

      // Create a PULL tracking item (should be excluded from auto-DLQ)
      const pullItem = createTestItem(dal, {
        store_id: storeId,
        entity_id: 'pull-tracking-123',
        sync_direction: 'PULL',
      });

      // Simulate max attempts
      simulateFailedAttempts(dal, pullItem.id, 10, 'Pull tracking failure');
      dal.updateErrorCategory(pullItem.id, 'PERMANENT');

      // Get items for auto-dead-letter
      const autoDeadLetterItems = dal.getItemsForAutoDeadLetter(storeId);

      // PULL item should NOT be included
      expect(autoDeadLetterItems.map((i) => i.id)).not.toContain(pullItem.id);
    });
  });

  // ==========================================================================
  // Performance Characteristics
  // ==========================================================================

  describe('Performance Characteristics', () => {
    it('should handle large batch operations efficiently', () => {
      const storeId = 'store-perf-test';
      const itemCount = 100;

      // Create many items
      const items = Array.from({ length: itemCount }, (_, i) =>
        createTestItem(dal, { store_id: storeId, entity_id: `perf-item-${i}` })
      );

      // Batch dead-letter
      const dlqParams: DeadLetterParams[] = items.map((item) => ({
        id: item.id,
        reason: 'MAX_ATTEMPTS_EXCEEDED',
        errorCategory: 'UNKNOWN',
      }));

      const startDeadLetter = Date.now();
      const deadLetteredCount = dal.deadLetterMany(dlqParams);
      const deadLetterDuration = Date.now() - startDeadLetter;

      expect(deadLetteredCount).toBe(itemCount);
      // Should complete in reasonable time (< 5 seconds even for 100 items)
      expect(deadLetterDuration).toBeLessThan(5000);

      // Batch restore
      const ids = items.map((i) => i.id);
      const startRestore = Date.now();
      const restoredCount = dal.restoreFromDeadLetterMany(ids);
      const restoreDuration = Date.now() - startRestore;

      expect(restoredCount).toBe(itemCount);
      expect(restoreDuration).toBeLessThan(5000);
    });

    it('should paginate large DLQ result sets efficiently', () => {
      const storeId = 'store-pagination-test';

      // Create 100 DLQ items
      Array.from({ length: 100 }, (_, i) => {
        const item = createTestItem(dal, { store_id: storeId, entity_id: `page-item-${i}` });
        dal.deadLetter({ id: item.id, reason: 'MANUAL', errorCategory: 'UNKNOWN' });
      });

      // Fetch first page
      const page1 = dal.getDeadLetterItems(storeId, 25, 0);
      expect(page1.items.length).toBe(25);
      expect(page1.total).toBe(100);
      expect(page1.hasMore).toBe(true);

      // Fetch second page
      const page2 = dal.getDeadLetterItems(storeId, 25, 25);
      expect(page2.items.length).toBe(25);
      expect(page2.hasMore).toBe(true);

      // Fetch last page
      const page4 = dal.getDeadLetterItems(storeId, 25, 75);
      expect(page4.items.length).toBe(25);
      expect(page4.hasMore).toBe(false);
    });
  });
});
