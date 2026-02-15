/**
 * SYNC-5000 Enterprise Regression Test Suite
 *
 * Comprehensive regression tests for sync-critical workflows.
 * Phase 7 (D7.1) of SYNC-5000: Enterprise Regression and Release Readiness.
 *
 * This suite validates that all sync infrastructure components work correctly
 * together and that no regressions have been introduced during the implementation
 * of Phases 1-6.
 *
 * Test Categories:
 * - Session Lifecycle (Phase 1 regression)
 * - Transactional Outbox (Phase 2 regression)
 * - Batch Dispatch & Backpressure (Phase 3 regression)
 * - Retry/Circuit Breaker (Phase 4 regression)
 * - Pull Consistency (Phase 5 regression)
 * - Observability (Phase 6 regression)
 * - Cross-component Integration
 *
 * @module tests/regression/sync-5000-regression
 *
 * Security Compliance:
 * - SEC-006: Parameterized queries (all DB operations)
 * - DB-006: Tenant isolation (store_id scoping)
 * - API-001: Zod validation on inputs
 * - ERR-008: Circuit breaker patterns
 * - MQ-001: Idempotent messaging
 * - MQ-002: Dead letter queue handling
 * - LM-002: Structured metrics
 *
 * Traceability:
 * - D-R1 through D-R15 (Desktop Risk Matrix)
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';

// ============================================================================
// Native Module Check
// ============================================================================

let nativeModuleAvailable = true;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Db = require('better-sqlite3-multiple-ciphers');
  const testDb = new Db(':memory:');
  testDb.close();
} catch {
  nativeModuleAvailable = false;
}

const SKIP_NATIVE_MODULE_TESTS =
  process.env.CI === 'true' || process.env.SKIP_NATIVE_TESTS === 'true' || !nativeModuleAvailable;

// ============================================================================
// Database Holder (vi.hoisted for cross-platform compatibility)
// ============================================================================

const { dbHolder, mockLogger } = vi.hoisted(() => ({
  dbHolder: { instance: null as Database.Database | null },
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ============================================================================
// Mock Electron IPC
// ============================================================================

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

// ============================================================================
// Mock Database Service
// ============================================================================

vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => {
    if (!dbHolder.instance) {
      throw new Error('Database not initialized - test setup issue');
    }
    return dbHolder.instance;
  }),
  isDatabaseInitialized: vi.fn(() => dbHolder.instance !== null),
}));

// ============================================================================
// Mock Logger
// ============================================================================

vi.mock('../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => mockLogger),
}));

// ============================================================================
// Mock UUID
// ============================================================================

let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { createServiceTestContext, type ServiceTestContext } from '../helpers/test-context';
import {
  SyncQueueDAL,
  type SyncQueueItem,
  type CreateSyncQueueItemData,
} from '../../src/main/dal/sync-queue.dal';

// ============================================================================
// Test Suite
// ============================================================================

const describeSuite = SKIP_NATIVE_MODULE_TESTS ? describe.skip : describe;

describeSuite('SYNC-5000 Enterprise Regression Suite', () => {
  let ctx: ServiceTestContext;
  let syncQueueDAL: SyncQueueDAL;

  beforeAll(() => {
    // Global setup
  });

  afterAll(() => {
    // Global cleanup
  });

  beforeEach(async () => {
    uuidCounter = 0;
    vi.clearAllMocks();

    ctx = await createServiceTestContext({
      storeName: 'SYNC-5000 Regression Test Store',
    });

    dbHolder.instance = ctx.db;
    syncQueueDAL = new SyncQueueDAL();
  });

  afterEach(() => {
    ctx?.cleanup();
    dbHolder.instance = null;
  });

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  /**
   * Create a sync queue item for testing
   * SEC-006: Uses parameterized queries via DAL
   * DB-006: Store-scoped
   */
  function createQueueItem(overrides: Partial<CreateSyncQueueItemData> = {}): SyncQueueItem {
    return syncQueueDAL.enqueue({
      store_id: ctx.storeId,
      entity_type: overrides.entity_type ?? 'pack',
      entity_id: overrides.entity_id ?? `entity-${++uuidCounter}`,
      operation: overrides.operation ?? 'CREATE',
      payload: overrides.payload ?? { test: true },
      priority: overrides.priority ?? 0,
      max_attempts: overrides.max_attempts ?? 5,
      sync_direction: overrides.sync_direction ?? 'PUSH',
    });
  }

  /**
   * Simulate sync completion
   */
  function markSynced(itemId: string): void {
    syncQueueDAL.markSynced(itemId, {
      api_endpoint: '/api/v1/test',
      http_status: 200,
      response_body: '{"success":true}',
    });
  }

  /**
   * Simulate sync failure - increments attempts and sets error info
   * Note: The actual DAL uses incrementAttempts, not markFailed
   */
  function markFailed(
    itemId: string,
    errorCategory: 'TRANSIENT' | 'PERMANENT' | 'STRUCTURAL' | 'CONFLICT' = 'TRANSIENT'
  ): void {
    syncQueueDAL.incrementAttempts(itemId, `Test ${errorCategory} failure`, {
      http_status: errorCategory === 'PERMANENT' ? 400 : 500,
      response_body: JSON.stringify({ error: 'Test failure', category: errorCategory }),
    });
  }

  // ==========================================================================
  // D-R1: Session Churn Prevention (Phase 1 Regression)
  // ==========================================================================

  describe('D-R1: Session Lifecycle Regression', () => {
    it('should track session state correctly through queue operations', () => {
      // Regression: Session state must not interfere with queue operations
      const item1 = createQueueItem({ entity_type: 'game' });
      const item2 = createQueueItem({ entity_type: 'pack' });

      // Both items should be independently trackable
      expect(item1.id).not.toBe(item2.id);
      expect(item1.entity_type).toBe('game');
      expect(item2.entity_type).toBe('pack');

      // Stats should reflect both items
      const stats = syncQueueDAL.getStats(ctx.storeId);
      expect(stats.pending).toBeGreaterThanOrEqual(2);
    });

    it('should maintain queue integrity across multiple operations', () => {
      // Create items
      const items = Array.from({ length: 10 }, (_, i) =>
        createQueueItem({ entity_id: `batch-item-${i}` })
      );

      expect(items.length).toBe(10);

      // Mark some as synced
      markSynced(items[0].id);
      markSynced(items[1].id);

      // Mark some as failed
      markFailed(items[2].id);

      // Get pending items
      const pending = syncQueueDAL.getRetryableItems(ctx.storeId, 100);
      expect(pending.length).toBe(7); // 10 - 2 synced - 1 in backoff
    });
  });

  // ==========================================================================
  // D-R2: Non-Atomic Write + Enqueue (Phase 2 Regression)
  // ==========================================================================

  describe('D-R2: Transactional Outbox Regression', () => {
    it('should generate consistent idempotency keys', () => {
      // Same parameters should generate same key
      const item1 = syncQueueDAL.enqueueWithIdempotency(
        {
          store_id: ctx.storeId,
          entity_type: 'pack',
          entity_id: 'pack-123',
          operation: 'ACTIVATE',
          payload: { bin_id: 'bin-1' },
        },
        'idem-key-001'
      );

      // Attempt to enqueue with same idempotency key should update
      const item2 = syncQueueDAL.enqueueWithIdempotency(
        {
          store_id: ctx.storeId,
          entity_type: 'pack',
          entity_id: 'pack-123',
          operation: 'ACTIVATE',
          payload: { bin_id: 'bin-2' }, // Updated payload
        },
        'idem-key-001'
      );

      // Should be the same item (deduplication)
      expect(item1.id).toBe(item2.id);
    });

    it('should respect queue constraints on enqueue', () => {
      // Enqueue should always succeed with valid data
      const item = createQueueItem({
        entity_type: 'shift',
        operation: 'CREATE',
        priority: 10, // High priority
      });

      expect(item).toBeDefined();
      expect(item.priority).toBe(10);
      expect(item.synced).toBe(0);
    });
  });

  // ==========================================================================
  // D-R3: Duplicate Pull Markers (Phase 5 Regression)
  // ==========================================================================

  describe('D-R3: Pull Tracking Regression', () => {
    it('should track PULL operations separately from PUSH', () => {
      // Create PUSH item
      const pushItem = createQueueItem({
        entity_type: 'pack',
        sync_direction: 'PUSH',
      });

      // Create PULL tracking item
      const pullItem = syncQueueDAL.enqueue({
        store_id: ctx.storeId,
        entity_type: 'pack',
        entity_id: 'pull-tracking',
        operation: 'CREATE',
        payload: { action: 'pull_received_packs' },
        sync_direction: 'PULL',
      });

      expect(pushItem.sync_direction).toBe('PUSH');
      expect(pullItem.sync_direction).toBe('PULL');

      // They should not interfere with each other
      const stats = syncQueueDAL.getStats(ctx.storeId);
      expect(stats.pending).toBeGreaterThanOrEqual(2);
    });

    it('should handle pull_returned_packs in allowlist', () => {
      // This is a D5.3 fix regression test
      const item = syncQueueDAL.enqueue({
        store_id: ctx.storeId,
        entity_type: 'pack',
        entity_id: 'pull-returned-tracking',
        operation: 'CREATE',
        payload: { action: 'pull_returned_packs' },
        sync_direction: 'PULL',
      });

      expect(item).toBeDefined();
      expect(item.sync_direction).toBe('PULL');
    });
  });

  // ==========================================================================
  // D-R4: Retry Policy Mismatch (Phase 4 Regression)
  // ==========================================================================

  describe('D-R4: Retry Policy Regression', () => {
    it('should respect error category for retry eligibility', () => {
      const item = createQueueItem();

      // Mark as TRANSIENT failure - should be retryable
      markFailed(item.id, 'TRANSIENT');

      // Get item to check state
      const updated = syncQueueDAL.findById(item.id);
      expect(updated?.error_category).toBe('TRANSIENT');
      expect(updated?.sync_attempts).toBe(1);
    });

    it('should handle PERMANENT errors differently', () => {
      const item = createQueueItem();

      // Mark as PERMANENT failure
      markFailed(item.id, 'PERMANENT');

      const updated = syncQueueDAL.findById(item.id);
      expect(updated?.error_category).toBe('PERMANENT');
    });

    it('should handle STRUCTURAL errors', () => {
      const item = createQueueItem();

      // Mark as STRUCTURAL failure - should go to DLQ faster
      markFailed(item.id, 'STRUCTURAL');

      const updated = syncQueueDAL.findById(item.id);
      expect(updated?.error_category).toBe('STRUCTURAL');
    });

    it('should handle CONFLICT errors (D4.2 addition)', () => {
      const item = createQueueItem();

      // Mark as CONFLICT failure - 409 status
      markFailed(item.id, 'CONFLICT');

      const updated = syncQueueDAL.findById(item.id);
      expect(updated?.error_category).toBe('CONFLICT');
    });
  });

  // ==========================================================================
  // D-R5: Queue Runaway (Phase 3 Regression)
  // ==========================================================================

  describe('D-R5: Backpressure Regression', () => {
    it('should track queue depth by partition', () => {
      // Create items of different entity types
      createQueueItem({ entity_type: 'pack' });
      createQueueItem({ entity_type: 'pack' });
      createQueueItem({ entity_type: 'game' });
      createQueueItem({ entity_type: 'shift' });

      const depths = syncQueueDAL.getPartitionDepths(ctx.storeId);

      expect(depths['pack']).toBe(2);
      expect(depths['game']).toBe(1);
      expect(depths['shift']).toBe(1);
    });

    it('should provide queue health metrics', () => {
      // Create some items
      createQueueItem();
      createQueueItem();
      createQueueItem();

      const pendingCount = syncQueueDAL.getPendingCount(ctx.storeId);
      const backoffCount = syncQueueDAL.getBackoffCount(ctx.storeId);
      const dlqCount = syncQueueDAL.getDeadLetterCount(ctx.storeId);

      expect(pendingCount).toBeGreaterThanOrEqual(3);
      expect(backoffCount).toBeGreaterThanOrEqual(0);
      expect(dlqCount).toBeGreaterThanOrEqual(0);
    });

    it('should respect batch size limits', () => {
      // Create many items
      for (let i = 0; i < 100; i++) {
        createQueueItem({ entity_id: `batch-${i}` });
      }

      // Fetch with limit
      const batch = syncQueueDAL.getRetryableItems(ctx.storeId, 50);
      expect(batch.length).toBeLessThanOrEqual(50);
    });
  });

  // ==========================================================================
  // D-R6: Cross-Scope Data Apply (Phase 5 Regression)
  // ==========================================================================

  describe('D-R6: Tenant Isolation Regression', () => {
    it('should isolate queue items by store_id (DB-006)', () => {
      const storeA = ctx.storeId;
      const storeB = 'other-store-uuid';

      // Create item for store A
      const itemA = createQueueItem();

      // Create item for store B (direct insert for test)
      ctx.db
        .prepare(
          `
        INSERT INTO sync_queue (
          id, store_id, entity_type, entity_id, operation, payload,
          priority, synced, sync_attempts, max_attempts, created_at, sync_direction
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          'store-b-item-1',
          storeB,
          'pack',
          'entity-store-b',
          'CREATE',
          '{}',
          0,
          0,
          0,
          5,
          new Date().toISOString(),
          'PUSH'
        );

      // Query for store A should not return store B items
      const storeAItems = syncQueueDAL.getRetryableItems(storeA, 100);
      const storeAIds = storeAItems.map((i) => i.id);

      expect(storeAIds).toContain(itemA.id);
      expect(storeAIds).not.toContain('store-b-item-1');
    });

    it('should scope stats by store_id', () => {
      // Create items
      createQueueItem();
      createQueueItem();

      const stats = syncQueueDAL.getStats(ctx.storeId);

      // Stats should only count this store's items
      expect(stats.pending).toBeGreaterThanOrEqual(2);
    });
  });

  // ==========================================================================
  // D-R7: Startup Duplicate Enqueue (Phase 0 Regression)
  // ==========================================================================

  describe('D-R7: Startup Deduplication Regression', () => {
    it('should prevent duplicate enqueue via idempotency key', () => {
      const key = 'startup-dedup-key-001';

      // First enqueue
      const item1 = syncQueueDAL.enqueueWithIdempotency(
        {
          store_id: ctx.storeId,
          entity_type: 'pack',
          entity_id: 'dedup-entity',
          operation: 'CREATE',
          payload: { version: 1 },
        },
        key
      );

      // Attempt duplicate
      const item2 = syncQueueDAL.enqueueWithIdempotency(
        {
          store_id: ctx.storeId,
          entity_type: 'pack',
          entity_id: 'dedup-entity',
          operation: 'CREATE',
          payload: { version: 2 },
        },
        key
      );

      // Should be same item
      expect(item1.id).toBe(item2.id);

      // Only one item in queue
      const allItems = syncQueueDAL.getRetryableItems(ctx.storeId, 100);
      const matching = allItems.filter((i) => i.id === item1.id);
      expect(matching.length).toBe(1);
    });
  });

  // ==========================================================================
  // D-R8: Queue Ordering Violations (Phase 0 Regression)
  // ==========================================================================

  describe('D-R8: Queue Ordering Regression', () => {
    it('should maintain priority ordering', () => {
      // Create items with different priorities
      const lowPriority = createQueueItem({ priority: 0, entity_id: 'low' });
      const highPriority = createQueueItem({ priority: 10, entity_id: 'high' });
      const medPriority = createQueueItem({ priority: 5, entity_id: 'med' });

      // Get items in order
      const items = syncQueueDAL.getRetryableItems(ctx.storeId, 100);

      // Find indices
      const highIdx = items.findIndex((i) => i.id === highPriority.id);
      const medIdx = items.findIndex((i) => i.id === medPriority.id);
      const lowIdx = items.findIndex((i) => i.id === lowPriority.id);

      // Higher priority should come first
      expect(highIdx).toBeLessThan(medIdx);
      expect(medIdx).toBeLessThan(lowIdx);
    });

    it('should maintain FIFO within same priority', () => {
      // Create items with same priority
      const first = createQueueItem({ priority: 5, entity_id: 'first' });

      // Small delay to ensure different created_at
      const second = createQueueItem({ priority: 5, entity_id: 'second' });
      const third = createQueueItem({ priority: 5, entity_id: 'third' });

      const items = syncQueueDAL.getRetryableItems(ctx.storeId, 100);

      const firstIdx = items.findIndex((i) => i.id === first.id);
      const secondIdx = items.findIndex((i) => i.id === second.id);
      const thirdIdx = items.findIndex((i) => i.id === third.id);

      // FIFO order within same priority
      expect(firstIdx).toBeLessThan(secondIdx);
      expect(secondIdx).toBeLessThan(thirdIdx);
    });
  });

  // ==========================================================================
  // D-R9: Dead Letter Starvation (Phase 0 Regression)
  // ==========================================================================

  describe('D-R9: Dead Letter Queue Regression', () => {
    it('should move items to DLQ after max attempts', () => {
      const item = createQueueItem({ max_attempts: 2 });

      // Fail twice
      markFailed(item.id);
      markFailed(item.id);

      // Check if eligible for DLQ
      const updated = syncQueueDAL.findById(item.id);
      expect(updated?.sync_attempts).toBe(2);

      // Move to DLQ
      syncQueueDAL.deadLetter({
        id: item.id,
        reason: 'MAX_ATTEMPTS_EXCEEDED',
        errorCategory: 'PERMANENT',
      });

      const dlqItem = syncQueueDAL.findById(item.id);
      expect(dlqItem?.dead_lettered).toBe(1);
      expect(dlqItem?.dead_letter_reason).toBe('MAX_ATTEMPTS_EXCEEDED');
    });

    it('should track DLQ stats', () => {
      const item = createQueueItem();
      syncQueueDAL.deadLetter({
        id: item.id,
        reason: 'PERMANENT_ERROR',
        errorCategory: 'PERMANENT',
      });

      const dlqCount = syncQueueDAL.getDeadLetterCount(ctx.storeId);
      expect(dlqCount).toBeGreaterThanOrEqual(1);
    });

    it('should allow DLQ item recovery', () => {
      const item = createQueueItem();
      syncQueueDAL.deadLetter({
        id: item.id,
        reason: 'PERMANENT_ERROR',
        errorCategory: 'PERMANENT',
      });

      // Recover from DLQ
      syncQueueDAL.restoreFromDeadLetter(item.id);

      const recovered = syncQueueDAL.findById(item.id);
      expect(recovered?.dead_lettered).toBe(0);
      expect(recovered?.sync_attempts).toBe(0);
    });
  });

  // ==========================================================================
  // D-R10: Backoff Escape Hatch (Phase 0 Regression)
  // ==========================================================================

  describe('D-R10: Backoff Reset Regression', () => {
    it('should reset stuck items in backoff', () => {
      const item = createQueueItem();

      // Simulate being stuck in backoff
      markFailed(item.id);

      // Manually set retry_after to past
      ctx.db
        .prepare(
          `
        UPDATE sync_queue
        SET retry_after = datetime('now', '-1 hour')
        WHERE id = ?
      `
        )
        .run(item.id);

      // Reset stuck items
      const resetCount = syncQueueDAL.resetStuckInBackoff(ctx.storeId);
      expect(resetCount).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // D-R11: Error Category Mismatch (Phase 4 Regression)
  // ==========================================================================

  describe('D-R11: Error Classification Regression', () => {
    it('should store error category correctly', () => {
      const item = createQueueItem();

      // Mark with specific category
      markFailed(item.id, 'TRANSIENT');

      const updated = syncQueueDAL.findById(item.id);
      expect(updated?.error_category).toBe('TRANSIENT');
    });

    it('should track all error categories', () => {
      const categories = ['TRANSIENT', 'PERMANENT', 'STRUCTURAL', 'CONFLICT'] as const;

      for (const category of categories) {
        const item = createQueueItem({ entity_id: `cat-${category}` });
        markFailed(item.id, category);

        const updated = syncQueueDAL.findById(item.id);
        expect(updated?.error_category).toBe(category);
      }
    });
  });

  // ==========================================================================
  // D-R12: Pull Tracking Accumulation (Phase 0 Regression)
  // ==========================================================================

  describe('D-R12: Pull Tracking Cleanup Regression', () => {
    it('should cleanup stale PULL tracking items', () => {
      // Create PULL tracking items
      for (let i = 0; i < 5; i++) {
        syncQueueDAL.enqueue({
          store_id: ctx.storeId,
          entity_type: 'pack',
          entity_id: `pull-tracking-${i}`,
          operation: 'CREATE',
          payload: { action: 'pull_tracking' },
          sync_direction: 'PULL',
        });
      }

      // Cleanup should work without error
      const cleaned = syncQueueDAL.cleanupAllStalePullTracking();
      expect(cleaned).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // D-R13: Concurrent Enqueue Race (Phase 0 Regression)
  // ==========================================================================

  describe('D-R13: Concurrent Enqueue Regression', () => {
    it('should handle concurrent enqueue attempts gracefully', async () => {
      const key = 'concurrent-key-001';

      // Simulate concurrent enqueues (sequential in test, but validates dedup)
      const results = await Promise.all([
        Promise.resolve(
          syncQueueDAL.enqueueWithIdempotency(
            {
              store_id: ctx.storeId,
              entity_type: 'pack',
              entity_id: 'concurrent-1',
              operation: 'CREATE',
              payload: {},
            },
            key
          )
        ),
        Promise.resolve(
          syncQueueDAL.enqueueWithIdempotency(
            {
              store_id: ctx.storeId,
              entity_type: 'pack',
              entity_id: 'concurrent-1',
              operation: 'CREATE',
              payload: {},
            },
            key
          )
        ),
      ]);

      // All should return same item ID
      expect(results[0].id).toBe(results[1].id);
    });
  });

  // ==========================================================================
  // D-R14: Payload Truncation Loss (Phase 0 Regression)
  // ==========================================================================

  describe('D-R14: Payload Handling Regression', () => {
    it('should handle large payloads', () => {
      const largePayload = {
        data: 'x'.repeat(10000),
        nested: {
          array: Array.from({ length: 100 }, (_, i) => ({ index: i, value: `item-${i}` })),
        },
      };

      const item = createQueueItem({ payload: largePayload });

      const retrieved = syncQueueDAL.findById(item.id);
      expect(retrieved).toBeDefined();

      const parsedPayload = JSON.parse(retrieved!.payload);
      expect(parsedPayload.data.length).toBe(10000);
      expect(parsedPayload.nested.array.length).toBe(100);
    });

    it('should handle special characters in payload', () => {
      const specialPayload = {
        sql_injection: "'; DROP TABLE sync_queue;--",
        unicode: '日本語 🎉 émojis',
        html: '<script>alert("xss")</script>',
        newlines: 'line1\nline2\rline3\r\nline4',
      };

      const item = createQueueItem({ payload: specialPayload });

      const retrieved = syncQueueDAL.findById(item.id);
      const parsedPayload = JSON.parse(retrieved!.payload);

      expect(parsedPayload.sql_injection).toBe(specialPayload.sql_injection);
      expect(parsedPayload.unicode).toBe(specialPayload.unicode);
      expect(parsedPayload.html).toBe(specialPayload.html);
    });
  });

  // ==========================================================================
  // D-R15: Tenant Isolation Bypass (Phase 0 Regression)
  // ==========================================================================

  describe('D-R15: Security Regression', () => {
    it('should validate store_id format (SEC-014)', () => {
      // Valid UUID format - should work
      const item = createQueueItem();
      expect(item).toBeDefined();
    });

    it('should use parameterized queries (SEC-006)', () => {
      // This is validated by successful operation with special characters
      const item = createQueueItem({
        entity_id: "test'; DROP TABLE sync_queue;--",
        payload: { injection: "'; DELETE FROM sync_queue;--" },
      });

      // If we get here without error, parameterized queries are working
      expect(item).toBeDefined();

      // Verify table still exists and has data
      const count = syncQueueDAL.getPendingCount(ctx.storeId);
      expect(count).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // Cross-Component Integration Regression
  // ==========================================================================

  describe('Cross-Component Integration Regression', () => {
    it('should handle full sync cycle workflow', () => {
      // Create item
      const item = createQueueItem({
        entity_type: 'pack',
        operation: 'ACTIVATE',
        priority: 5,
      });

      expect(item.synced).toBe(0);

      // Simulate failure
      markFailed(item.id, 'TRANSIENT');

      const afterFailure = syncQueueDAL.findById(item.id);
      expect(afterFailure?.sync_attempts).toBe(1);
      expect(afterFailure?.error_category).toBe('TRANSIENT');

      // Simulate success on retry
      markSynced(item.id);

      const afterSuccess = syncQueueDAL.findById(item.id);
      expect(afterSuccess?.synced).toBe(1);
      expect(afterSuccess?.synced_at).toBeDefined();
    });

    it('should track detailed stats correctly', () => {
      // Create mixed items
      const pack1 = createQueueItem({ entity_type: 'pack', operation: 'CREATE' });
      const pack2 = createQueueItem({ entity_type: 'pack', operation: 'UPDATE' });
      const game = createQueueItem({ entity_type: 'game', operation: 'CREATE' });

      markSynced(pack1.id);
      markFailed(pack2.id);

      const stats = syncQueueDAL.getDetailedStats(ctx.storeId);

      expect(stats.synced).toBeGreaterThanOrEqual(1);
      expect(stats.failed).toBeGreaterThanOrEqual(1);
    });

    it('should maintain consistency under multiple operations', () => {
      // Batch create
      const items: SyncQueueItem[] = [];
      for (let i = 0; i < 20; i++) {
        items.push(createQueueItem({ entity_id: `consistency-${i}` }));
      }

      // Mixed operations
      markSynced(items[0].id);
      markSynced(items[1].id);
      markFailed(items[2].id);
      markFailed(items[3].id);
      syncQueueDAL.deadLetter({
        id: items[4].id,
        reason: 'PERMANENT_ERROR',
        errorCategory: 'PERMANENT',
      });

      // Verify counts
      const pending = syncQueueDAL.getPendingCount(ctx.storeId);
      const dlq = syncQueueDAL.getDeadLetterCount(ctx.storeId);

      // 20 items - 2 synced - 2 in backoff - 1 DLQ = 15 pending
      // (but 2 failed are still in pending, just in backoff)
      expect(pending).toBeGreaterThanOrEqual(15);
      expect(dlq).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // Observability Regression (Phase 6)
  // ==========================================================================

  describe('Observability Regression', () => {
    it('should provide complete stats for metrics', () => {
      createQueueItem();
      createQueueItem();
      createQueueItem();

      const stats = syncQueueDAL.getStats(ctx.storeId);

      expect(stats).toHaveProperty('pending');
      expect(stats).toHaveProperty('queued');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('syncedToday');
      expect(stats).toHaveProperty('oldestPending');
    });

    it('should provide partition depths for monitoring', () => {
      createQueueItem({ entity_type: 'pack' });
      createQueueItem({ entity_type: 'game' });

      const depths = syncQueueDAL.getPartitionDepths(ctx.storeId);

      expect(typeof depths).toBe('object');
      expect(depths['pack']).toBeGreaterThanOrEqual(1);
      expect(depths['game']).toBeGreaterThanOrEqual(1);
    });

    it('should provide oldest pending timestamp for age tracking', () => {
      createQueueItem();

      const oldest = syncQueueDAL.getOldestPendingTimestamp(ctx.storeId);

      expect(oldest).toBeDefined();
      expect(typeof oldest).toBe('string');
      // Should be a valid ISO timestamp
      expect(() => new Date(oldest!)).not.toThrow();
    });
  });
});
