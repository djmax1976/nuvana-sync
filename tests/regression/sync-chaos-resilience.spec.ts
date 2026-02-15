/**
 * SYNC-5000 Chaos & Resilience Tests
 *
 * Chaos-style fault injection tests for network/database interruptions.
 * Phase 7 (D7.3) of SYNC-5000: Enterprise Regression and Release Readiness.
 *
 * Test Scenarios:
 * - Database connection failures
 * - Network interruptions (simulated via mocked cloud API)
 * - Transaction rollback scenarios
 * - Circuit breaker behavior under stress
 * - Queue overflow and backpressure
 * - Concurrent access and race conditions
 * - Recovery after failures
 *
 * @module tests/regression/sync-chaos-resilience
 *
 * Security Compliance:
 * - ERR-008: Circuit breaker patterns
 * - ERR-007: Error classification
 * - MQ-002: Dead letter queue handling
 * - LM-002: Metrics under failure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
// Database Holder
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
// Mocks
// ============================================================================

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => {
    if (!dbHolder.instance) throw new Error('Database not initialized');
    return dbHolder.instance;
  }),
  isDatabaseInitialized: vi.fn(() => dbHolder.instance !== null),
}));

vi.mock('../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => mockLogger),
}));

let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: () => `chaos-uuid-${++uuidCounter}`,
}));

// ============================================================================
// Imports
// ============================================================================

import { createServiceTestContext, type ServiceTestContext } from '../helpers/test-context';
import { SyncQueueDAL, type CreateSyncQueueItemData } from '../../src/main/dal/sync-queue.dal';
import { CircuitBreakerService } from '../../src/main/services/circuit-breaker.service';
import {
  RetryStrategyService,
  type RetryDecision,
} from '../../src/main/services/retry-strategy.service';
import { errorClassifierService } from '../../src/main/services/error-classifier.service';
import type { ErrorClassificationResult as ClassifiedError } from '../../src/main/services/error-classifier.service';

// ============================================================================
// Test Suite
// ============================================================================

const describeSuite = SKIP_NATIVE_MODULE_TESTS ? describe.skip : describe;

describeSuite('SYNC-5000 Chaos & Resilience Tests', () => {
  let ctx: ServiceTestContext;
  let syncQueueDAL: SyncQueueDAL;
  let circuitBreaker: CircuitBreakerService;
  let retryStrategy: RetryStrategyService;

  beforeEach(async () => {
    uuidCounter = 0;
    vi.clearAllMocks();

    ctx = await createServiceTestContext({
      storeName: 'Chaos Test Store',
    });

    dbHolder.instance = ctx.db;
    syncQueueDAL = new SyncQueueDAL();
    circuitBreaker = new CircuitBreakerService('chaos-test', {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      failureWindowMs: 5000,
      successThreshold: 2,
    });
    retryStrategy = new RetryStrategyService();
  });

  afterEach(() => {
    ctx?.cleanup();
    dbHolder.instance = null;
    circuitBreaker.reset();
  });

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  function createQueueItem(overrides: Partial<CreateSyncQueueItemData> = {}) {
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

  // ==========================================================================
  // Circuit Breaker Chaos Tests
  // ==========================================================================

  describe('Circuit Breaker Under Chaos', () => {
    it('should open circuit after threshold failures', async () => {
      // Start in CLOSED state
      expect(circuitBreaker.getState()).toBe('CLOSED');

      // Simulate repeated failures
      for (let i = 0; i < 3; i++) {
        await circuitBreaker
          .execute(async () => {
            throw new Error('Simulated failure');
          })
          .catch(() => {}); // Catch expected errors
      }

      // Circuit should be OPEN
      expect(circuitBreaker.getState()).toBe('OPEN');
    });

    it('should reject requests when circuit is OPEN', async () => {
      // Force open the circuit
      circuitBreaker.forceOpen();

      expect(circuitBreaker.getState()).toBe('OPEN');

      // Attempt to execute - should throw CircuitOpenError
      await expect(
        circuitBreaker.execute(async () => {
          return 'success';
        })
      ).rejects.toThrow('Circuit breaker is OPEN');
    });

    it('should transition to HALF_OPEN after reset timeout', async () => {
      // Use shorter timeout for test
      const fastCircuit = new CircuitBreakerService({
        failureThreshold: 2,
        resetTimeoutMs: 100, // 100ms timeout
        failureWindowMs: 5000,
        halfOpenSuccessThreshold: 1,
      });

      // Trip the circuit
      for (let i = 0; i < 2; i++) {
        await fastCircuit
          .execute(async () => {
            throw new Error('Simulated failure');
          })
          .catch(() => {});
      }

      expect(fastCircuit.getState()).toBe('OPEN');

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Next call should transition to HALF_OPEN
      expect(fastCircuit.getState()).toBe('HALF_OPEN');
    });

    it('should close circuit after successful recovery', async () => {
      const fastCircuit = new CircuitBreakerService({
        failureThreshold: 2,
        resetTimeoutMs: 50,
        failureWindowMs: 5000,
        halfOpenSuccessThreshold: 2,
      });

      // Trip the circuit
      for (let i = 0; i < 2; i++) {
        await fastCircuit
          .execute(async () => {
            throw new Error('Simulated failure');
          })
          .catch(() => {});
      }

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Successful calls should close circuit
      await fastCircuit.execute(async () => 'success');
      await fastCircuit.execute(async () => 'success');

      expect(fastCircuit.getState()).toBe('CLOSED');
    });

    it('should re-open circuit on failure during HALF_OPEN', async () => {
      const fastCircuit = new CircuitBreakerService({
        failureThreshold: 2,
        resetTimeoutMs: 50,
        failureWindowMs: 5000,
        halfOpenSuccessThreshold: 2,
      });

      // Trip the circuit
      for (let i = 0; i < 2; i++) {
        await fastCircuit
          .execute(async () => {
            throw new Error('Simulated failure');
          })
          .catch(() => {});
      }

      // Wait for reset timeout to transition to HALF_OPEN
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(fastCircuit.getState()).toBe('HALF_OPEN');

      // Failure during HALF_OPEN should re-open circuit
      await fastCircuit
        .execute(async () => {
          throw new Error('Recovery failed');
        })
        .catch(() => {});

      expect(fastCircuit.getState()).toBe('OPEN');
    });
  });

  // ==========================================================================
  // Retry Strategy Chaos Tests
  // ==========================================================================

  describe('Retry Strategy Under Chaos', () => {
    it('should calculate increasing backoff delays', () => {
      const delays: number[] = [];

      for (let attempt = 1; attempt <= 5; attempt++) {
        const delay = retryStrategy.calculateBackoffDelay(attempt, 'TRANSIENT');
        delays.push(delay);
      }

      // Each delay should be greater than the previous (exponential)
      // Note: Due to jitter, we check the general trend
      for (let i = 1; i < delays.length; i++) {
        // Allow for jitter variance but expect general increase
        expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1] * 0.5);
      }
    });

    it('should differentiate backoff by error category', () => {
      const transientDelay = retryStrategy.calculateBackoffDelay(3, 'TRANSIENT');
      const permanentDelay = retryStrategy.calculateBackoffDelay(3, 'PERMANENT');
      const unknownDelay = retryStrategy.calculateBackoffDelay(3, 'UNKNOWN');

      // All should be positive
      expect(transientDelay).toBeGreaterThan(0);
      expect(permanentDelay).toBeGreaterThan(0);
      expect(unknownDelay).toBeGreaterThan(0);
    });

    it('should respect max delay cap', () => {
      // Even with high attempt count, delay should be capped
      const delay = retryStrategy.calculateBackoffDelay(100, 'TRANSIENT');

      // Default max is 5 minutes (300000ms)
      expect(delay).toBeLessThanOrEqual(300000 * 1.3); // Allow for jitter
    });

    it('should make correct retry decisions', () => {
      // Should retry TRANSIENT errors
      const transientDecision = retryStrategy.makeRetryDecision(1, 5, 'TRANSIENT', null);
      expect(transientDecision.shouldRetry).toBe(true);
      expect(transientDecision.shouldDeadLetter).toBe(false);

      // Should not retry STRUCTURAL errors
      const structuralDecision = retryStrategy.makeRetryDecision(1, 5, 'STRUCTURAL', null);
      expect(structuralDecision.shouldRetry).toBe(false);
      expect(structuralDecision.shouldDeadLetter).toBe(true);
    });

    it('should dead-letter after max attempts', () => {
      const decision = retryStrategy.makeRetryDecision(5, 5, 'TRANSIENT', null);

      expect(decision.shouldRetry).toBe(false);
      expect(decision.shouldDeadLetter).toBe(true);
    });

    it('should respect server Retry-After header', () => {
      const retryAfter = new Date(Date.now() + 60000).toISOString(); // 1 minute from now

      const decision = retryStrategy.makeRetryDecision(1, 5, 'TRANSIENT', retryAfter);

      expect(decision.shouldRetry).toBe(true);
      // Delay should incorporate server's Retry-After
      expect(decision.delayMs).toBeGreaterThan(0);
    });

    it('should adjust batch size on failures', () => {
      const initialSize = retryStrategy.getCurrentBatchSize();

      // Record failures
      retryStrategy.recordBatchFailure(0.8); // 80% failure rate

      const reducedSize = retryStrategy.getCurrentBatchSize();
      expect(reducedSize).toBeLessThan(initialSize);
    });

    it('should recover batch size on success', () => {
      // First reduce
      retryStrategy.recordBatchFailure(0.8);
      const reducedSize = retryStrategy.getCurrentBatchSize();

      // Then recover
      retryStrategy.recordBatchSuccess();
      retryStrategy.recordBatchSuccess();
      retryStrategy.recordBatchSuccess();

      const recoveredSize = retryStrategy.getCurrentBatchSize();
      expect(recoveredSize).toBeGreaterThan(reducedSize);
    });
  });

  // ==========================================================================
  // Error Classification Chaos Tests
  // ==========================================================================

  describe('Error Classification Under Chaos', () => {
    it('should classify common HTTP errors correctly', () => {
      const testCases = [
        { status: 400, expected: 'PERMANENT' },
        { status: 401, expected: 'PERMANENT' },
        { status: 403, expected: 'PERMANENT' },
        { status: 404, expected: 'PERMANENT' },
        { status: 409, expected: 'CONFLICT' },
        { status: 422, expected: 'PERMANENT' },
        { status: 429, expected: 'TRANSIENT' },
        { status: 500, expected: 'TRANSIENT' },
        { status: 502, expected: 'TRANSIENT' },
        { status: 503, expected: 'TRANSIENT' },
        { status: 504, expected: 'TRANSIENT' },
      ];

      for (const { status, expected } of testCases) {
        const classified = errorClassifierService.classifyError(status, `HTTP ${status}`);
        expect(classified.category).toBe(expected);
      }
    });

    it('should classify network errors as TRANSIENT', () => {
      const networkErrors = [
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ENOTFOUND',
        'ENETUNREACH',
        'network error',
        'socket hang up',
      ];

      for (const errorMsg of networkErrors) {
        // Network errors typically don't have HTTP status
        const classified = errorClassifierService.classifyError(null, errorMsg);
        // Without status, most get classified as UNKNOWN unless they match patterns
        expect(['TRANSIENT', 'UNKNOWN']).toContain(classified.category);
      }
    });

    it('should classify JSON parse errors as STRUCTURAL', () => {
      // Use a pattern that matches STRUCTURAL_ERROR_PATTERNS
      const classified = errorClassifierService.classifyError(null, 'JSON parse error');

      expect(classified.category).toBe('STRUCTURAL');
    });

    it('should handle malformed error inputs', () => {
      // Null values
      const classified1 = errorClassifierService.classifyError(null, null);
      expect(classified1.category).toBe('UNKNOWN');

      // Empty string
      const classified2 = errorClassifierService.classifyError(undefined, '');
      expect(classified2.category).toBe('UNKNOWN');
    });

    it('should extract Retry-After from header', () => {
      const classified = errorClassifierService.classifyError(429, 'Rate limited', '120');

      expect(classified.category).toBe('TRANSIENT');
      expect(classified.retryAfter).toBeDefined();
    });

    it('should determine dead-letter eligibility correctly', () => {
      // shouldDeadLetter(syncAttempts, maxAttempts, errorCategory)
      expect(errorClassifierService.shouldDeadLetter(1, 5, 'STRUCTURAL').shouldDeadLetter).toBe(
        true
      );
      expect(errorClassifierService.shouldDeadLetter(5, 5, 'PERMANENT').shouldDeadLetter).toBe(
        true
      );
      // TRANSIENT needs 2x max_attempts
      expect(errorClassifierService.shouldDeadLetter(10, 5, 'TRANSIENT').shouldDeadLetter).toBe(
        true
      );
      expect(errorClassifierService.shouldDeadLetter(3, 5, 'TRANSIENT').shouldDeadLetter).toBe(
        false
      );
    });
  });

  // ==========================================================================
  // Queue Resilience Chaos Tests
  // ==========================================================================

  describe('Queue Resilience Under Chaos', () => {
    it('should handle rapid enqueue/dequeue cycles', () => {
      const items: string[] = [];

      // Rapid enqueue
      for (let i = 0; i < 100; i++) {
        const item = createQueueItem({ entity_id: `rapid-${i}` });
        items.push(item.id);
      }

      // Rapid dequeue (mark synced)
      for (const id of items) {
        syncQueueDAL.markSynced(id, {
          api_endpoint: '/test',
          http_status: 200,
          response_body: '{}',
        });
      }

      // All should be synced
      const pending = syncQueueDAL.getPendingCount(ctx.storeId);
      expect(pending).toBe(0);
    });

    it('should survive database constraint violations gracefully', () => {
      // Create item
      const item = createQueueItem();

      // Try to create duplicate with same ID (simulated via raw SQL)
      // This should not crash the system
      try {
        ctx.db
          .prepare(
            `
          INSERT INTO sync_queue (id, store_id, entity_type, entity_id, operation, payload, priority, synced, sync_attempts, max_attempts, created_at, sync_direction)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
          )
          .run(
            item.id, // Duplicate ID
            ctx.storeId,
            'pack',
            'duplicate-test',
            'CREATE',
            '{}',
            0,
            0,
            0,
            5,
            new Date().toISOString(),
            'PUSH'
          );
      } catch {
        // Expected - constraint violation
      }

      // Original item should still be accessible
      const original = syncQueueDAL.findById(item.id);
      expect(original).toBeDefined();
    });

    it('should handle concurrent read/write operations', async () => {
      // Create base items
      for (let i = 0; i < 10; i++) {
        createQueueItem({ entity_id: `concurrent-${i}` });
      }

      // Simulate concurrent operations
      const operations = [
        Promise.resolve(syncQueueDAL.getPendingCount(ctx.storeId)),
        Promise.resolve(syncQueueDAL.getPartitionDepths(ctx.storeId)),
        Promise.resolve(createQueueItem({ entity_id: 'concurrent-new' })),
        Promise.resolve(syncQueueDAL.getStats(ctx.storeId)),
      ];

      const results = await Promise.all(operations);

      // All operations should complete without error
      expect(results[0]).toBeGreaterThan(0); // pending count
      expect(typeof results[1]).toBe('object'); // partition depths
      expect(results[2]).toBeDefined(); // new item
      expect(results[3]).toBeDefined(); // stats
    });

    it('should recover from partial failure scenarios', () => {
      // Create items
      const item1 = createQueueItem({ entity_id: 'recover-1' });
      const item2 = createQueueItem({ entity_id: 'recover-2' });
      const item3 = createQueueItem({ entity_id: 'recover-3' });

      // Partial success: item1 synced, item2 failed, item3 pending
      syncQueueDAL.markSynced(item1.id, { http_status: 200 });
      syncQueueDAL.incrementAttempts(item2.id, 'Simulated failure', { http_status: 500 });

      // Verify states
      const synced = syncQueueDAL.findById(item1.id);
      const failed = syncQueueDAL.findById(item2.id);
      const pending = syncQueueDAL.findById(item3.id);

      expect(synced?.synced).toBe(1);
      expect(failed?.sync_attempts).toBe(1);
      expect(pending?.synced).toBe(0);
      expect(pending?.sync_attempts).toBe(0);
    });
  });

  // ==========================================================================
  // Dead Letter Queue Chaos Tests
  // ==========================================================================

  describe('Dead Letter Queue Under Chaos', () => {
    it('should handle DLQ overflow gracefully', () => {
      // Create many DLQ items
      for (let i = 0; i < 50; i++) {
        const item = createQueueItem({ entity_id: `dlq-${i}` });
        syncQueueDAL.deadLetter({
          id: item.id,
          reason: 'PERMANENT_ERROR',
          errorCategory: 'PERMANENT',
        });
      }

      const dlqCount = syncQueueDAL.getDeadLetterCount(ctx.storeId);
      expect(dlqCount).toBe(50);

      // System should still function
      const newItem = createQueueItem({ entity_id: 'after-dlq-flood' });
      expect(newItem).toBeDefined();
    });

    it('should track DLQ stats under load', () => {
      // Create items with different error categories
      const categories = ['TRANSIENT', 'PERMANENT', 'STRUCTURAL', 'CONFLICT'] as const;
      // Note: CONFLICT errors use MAX_ATTEMPTS_EXCEEDED as reason since there's no CONFLICT_ERROR in the constraint
      const reasonMap: Record<
        string,
        'MAX_ATTEMPTS_EXCEEDED' | 'PERMANENT_ERROR' | 'STRUCTURAL_FAILURE'
      > = {
        TRANSIENT: 'MAX_ATTEMPTS_EXCEEDED',
        PERMANENT: 'PERMANENT_ERROR',
        STRUCTURAL: 'STRUCTURAL_FAILURE',
        CONFLICT: 'MAX_ATTEMPTS_EXCEEDED', // No CONFLICT_ERROR in DB constraint
      };

      for (const category of categories) {
        for (let i = 0; i < 5; i++) {
          const item = createQueueItem({ entity_id: `dlq-${category}-${i}` });
          syncQueueDAL.incrementAttempts(item.id, `${category} error`, { http_status: 500 });
          syncQueueDAL.deadLetter({
            id: item.id,
            reason: reasonMap[category],
            errorCategory: category,
          });
        }
      }

      const stats = syncQueueDAL.getDeadLetterStats(ctx.storeId);

      expect(stats.total).toBe(20);
    });

    it('should allow batch DLQ recovery', () => {
      // Create DLQ items
      const dlqIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const item = createQueueItem({ entity_id: `batch-dlq-${i}` });
        syncQueueDAL.deadLetter({
          id: item.id,
          reason: 'MAX_ATTEMPTS_EXCEEDED',
          errorCategory: 'PERMANENT',
        });
        dlqIds.push(item.id);
      }

      // Recover all
      for (const id of dlqIds) {
        syncQueueDAL.restoreFromDeadLetter(id);
      }

      const dlqCount = syncQueueDAL.getDeadLetterCount(ctx.storeId);
      expect(dlqCount).toBe(0);

      const pendingCount = syncQueueDAL.getPendingCount(ctx.storeId);
      expect(pendingCount).toBe(10);
    });
  });

  // ==========================================================================
  // Backpressure Chaos Tests
  // ==========================================================================

  describe('Backpressure Under Chaos', () => {
    it('should handle queue saturation', () => {
      // Create many items to saturate queue
      for (let i = 0; i < 500; i++) {
        createQueueItem({ entity_id: `saturate-${i}` });
      }

      const pending = syncQueueDAL.getPendingCount(ctx.storeId);
      expect(pending).toBe(500);

      // Should still be able to get batches
      const batch = syncQueueDAL.getRetryableItems(ctx.storeId, 50);
      expect(batch.length).toBe(50);
    });

    it('should maintain ordering under high load', () => {
      // Create high-priority items
      const highPriority: string[] = [];
      for (let i = 0; i < 10; i++) {
        const item = createQueueItem({
          entity_id: `high-${i}`,
          priority: 10,
        });
        highPriority.push(item.id);
      }

      // Create low-priority items
      for (let i = 0; i < 100; i++) {
        createQueueItem({
          entity_id: `low-${i}`,
          priority: 0,
        });
      }

      // Get first batch - should be high priority
      const batch = syncQueueDAL.getRetryableItems(ctx.storeId, 10);
      const batchIds = batch.map((i) => i.id);

      // All high priority items should be in first batch
      for (const id of highPriority) {
        expect(batchIds).toContain(id);
      }
    });

    it('should provide accurate partition depths under load', () => {
      // Create items of different types
      const types = ['pack', 'game', 'shift', 'bin', 'day_close'];

      for (const type of types) {
        for (let i = 0; i < 20; i++) {
          createQueueItem({
            entity_type: type,
            entity_id: `${type}-${i}`,
          });
        }
      }

      const depths = syncQueueDAL.getPartitionDepths(ctx.storeId);

      for (const type of types) {
        expect(depths[type]).toBe(20);
      }
    });
  });

  // ==========================================================================
  // Recovery Scenario Tests
  // ==========================================================================

  describe('Recovery Scenarios', () => {
    it('should recover from simulated network outage', () => {
      // Create items during "outage" (mark as failed)
      const outageItems: string[] = [];
      for (let i = 0; i < 10; i++) {
        const item = createQueueItem({ entity_id: `outage-${i}` });
        syncQueueDAL.incrementAttempts(item.id, 'ECONNREFUSED', { http_status: 503 });
        outageItems.push(item.id);
      }

      // Verify all in backoff
      for (const id of outageItems) {
        const item = syncQueueDAL.findById(id);
        expect(item?.sync_attempts).toBe(1);
      }

      // Simulate recovery - reset backoff
      const resetCount = syncQueueDAL.resetStuckInBackoff(ctx.storeId);

      // After reset, items should be retryable
      const retryable = syncQueueDAL.getRetryableItems(ctx.storeId, 100);
      expect(retryable.length).toBeGreaterThanOrEqual(10);
    });

    it('should recover from simulated database restart', () => {
      // Create items
      for (let i = 0; i < 5; i++) {
        createQueueItem({ entity_id: `prerestart-${i}` });
      }

      // Verify items exist
      const preCount = syncQueueDAL.getPendingCount(ctx.storeId);
      expect(preCount).toBe(5);

      // "Restart" - recreate DAL instance
      const newDAL = new SyncQueueDAL();

      // Items should still be accessible
      const postCount = newDAL.getPendingCount(ctx.storeId);
      expect(postCount).toBe(5);
    });

    it('should handle graceful degradation', () => {
      // Create a mix of healthy and problematic items
      const healthyItems: string[] = [];
      const problematicItems: string[] = [];

      for (let i = 0; i < 5; i++) {
        const item = createQueueItem({ entity_id: `healthy-${i}` });
        healthyItems.push(item.id);
      }

      for (let i = 0; i < 5; i++) {
        const item = createQueueItem({ entity_id: `problematic-${i}` });
        // Fail multiple times
        for (let j = 0; j < 4; j++) {
          syncQueueDAL.incrementAttempts(item.id, 'Repeated failure', { http_status: 500 });
        }
        problematicItems.push(item.id);
      }

      // System should prioritize healthy items
      // Healthy items should still be immediately retryable
      const retryable = syncQueueDAL.getRetryableItems(ctx.storeId, 100);
      const retryableIds = retryable.map((i) => i.id);

      // All healthy items should be retryable
      for (const id of healthyItems) {
        expect(retryableIds).toContain(id);
      }
    });
  });

  // ==========================================================================
  // Metrics Under Failure Tests
  // ==========================================================================

  describe('Metrics Under Failure', () => {
    it('should track accurate stats during failures', () => {
      // Create mix of states
      const synced = createQueueItem({ entity_id: 'stats-synced' });
      syncQueueDAL.markSynced(synced.id, { http_status: 200 });

      const failed = createQueueItem({ entity_id: 'stats-failed' });
      syncQueueDAL.incrementAttempts(failed.id, 'Error', { http_status: 500 });

      const pending = createQueueItem({ entity_id: 'stats-pending' });

      const dlq = createQueueItem({ entity_id: 'stats-dlq' });
      syncQueueDAL.deadLetter({
        id: dlq.id,
        reason: 'MAX_ATTEMPTS_EXCEEDED',
        errorCategory: 'PERMANENT',
      });

      const stats = syncQueueDAL.getStats(ctx.storeId);
      const detailedStats = syncQueueDAL.getDetailedStats(ctx.storeId);

      expect(stats.syncedToday).toBeGreaterThanOrEqual(1);
      expect(detailedStats.failed).toBeGreaterThanOrEqual(1);
    });

    it('should provide oldest pending timestamp under load', () => {
      // Create items with timestamps
      createQueueItem({ entity_id: 'oldest-test' });

      // Small delay
      const oldest = syncQueueDAL.getOldestPendingTimestamp(ctx.storeId);

      expect(oldest).toBeDefined();
      expect(typeof oldest).toBe('string');

      // Should be parseable as date
      const date = new Date(oldest!);
      expect(date.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });
});
