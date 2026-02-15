/**
 * Batch Dispatcher Service Unit Tests
 *
 * Phase 3: Batching, Partitioned Dispatch, and Backpressure (SYNC-5000)
 *
 * @module tests/unit/services/batch-dispatcher.service.spec
 * @security TEST-003: Test isolation with fresh mocks per test
 * @security TEST-004: Deterministic tests with controlled mocks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted() to ensure mock functions are available when vi.mock runs
const {
  mockGetPendingCount,
  mockGetBackoffCount,
  mockGetDeadLetterCount,
  mockGetPartitionDepths,
  mockGetOldestPendingTimestamp,
  mockGetRetryableItemsByEntityType,
  mockEnqueue,
  mockEnqueueWithIdempotency,
  mockFindPendingByIdempotencyKey,
  mockUpdatePayload,
  mockMarkDeferred,
  mockFindById,
} = vi.hoisted(() => ({
  mockGetPendingCount: vi.fn(),
  mockGetBackoffCount: vi.fn(),
  mockGetDeadLetterCount: vi.fn(),
  mockGetPartitionDepths: vi.fn(),
  mockGetOldestPendingTimestamp: vi.fn(),
  mockGetRetryableItemsByEntityType: vi.fn(),
  mockEnqueue: vi.fn(),
  mockEnqueueWithIdempotency: vi.fn(),
  mockFindPendingByIdempotencyKey: vi.fn(),
  mockUpdatePayload: vi.fn(),
  mockMarkDeferred: vi.fn(),
  mockFindById: vi.fn(),
}));

vi.mock('../../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: {
    getPendingCount: mockGetPendingCount,
    getBackoffCount: mockGetBackoffCount,
    getDeadLetterCount: mockGetDeadLetterCount,
    getPartitionDepths: mockGetPartitionDepths,
    getOldestPendingTimestamp: mockGetOldestPendingTimestamp,
    getRetryableItemsByEntityType: mockGetRetryableItemsByEntityType,
    enqueue: mockEnqueue,
    enqueueWithIdempotency: mockEnqueueWithIdempotency,
    findPendingByIdempotencyKey: mockFindPendingByIdempotencyKey,
    updatePayload: mockUpdatePayload,
    markDeferred: mockMarkDeferred,
    findById: mockFindById,
  },
}));

vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: {
    getConfiguredStore: vi.fn(() => ({ store_id: 'test-store-123' })),
  },
}));

import {
  BatchDispatcherService,
  type BatchConfig,
  type OverloadPolicy,
  type PartitionBatch,
  type QueueHealthStatus,
} from '../../../src/main/services/batch-dispatcher.service';
import type { SyncQueueItem } from '../../../src/main/dal/sync-queue.dal';

// ============================================================================
// Test Fixtures
// ============================================================================

const STORE_ID = 'test-store-123';

function createMockSyncQueueItem(overrides: Partial<SyncQueueItem> = {}): SyncQueueItem {
  return {
    id: 'item-' + Math.random().toString(36).substring(7),
    store_id: STORE_ID,
    entity_type: 'pack',
    entity_id: 'pack-123',
    operation: 'CREATE',
    payload: '{"pack_id":"pack-123"}',
    priority: 0,
    synced: 0,
    sync_attempts: 0,
    max_attempts: 5,
    last_sync_error: null,
    last_attempt_at: null,
    created_at: new Date().toISOString(),
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

// ============================================================================
// Tests
// ============================================================================

describe('BatchDispatcherService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations
    mockGetPendingCount.mockReturnValue(100);
    mockGetBackoffCount.mockReturnValue(10);
    mockGetDeadLetterCount.mockReturnValue(5);
    mockGetPartitionDepths.mockReturnValue({ pack: 50, shift: 30, day_close: 20 });
    mockGetOldestPendingTimestamp.mockReturnValue('2026-02-15T00:00:00.000Z');
    mockGetRetryableItemsByEntityType.mockReturnValue([]);
  });

  // ==========================================================================
  // Constructor and Configuration Tests
  // ==========================================================================

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      const dispatcher = new BatchDispatcherService();
      const config = dispatcher.getConfig();

      // SYNC-5000 Phase 3: Updated defaults for production scale
      expect(config.maxBatchSize).toBe(100);
      expect(config.maxConcurrentPartitions).toBe(4);
      expect(config.maxQueueDepth).toBe(10000);
      expect(config.maxQueueSizeBytes).toBe(50 * 1024 * 1024);
      expect(config.batchTimeoutMs).toBe(30000);
    });

    it('should accept custom configuration', () => {
      const customConfig: Partial<BatchConfig> = {
        maxBatchSize: 100,
        maxConcurrentPartitions: 6,
        maxQueueDepth: 5000,
      };

      const dispatcher = new BatchDispatcherService(customConfig);
      const config = dispatcher.getConfig();

      expect(config.maxBatchSize).toBe(100);
      expect(config.maxConcurrentPartitions).toBe(6);
      expect(config.maxQueueDepth).toBe(5000);
    });

    it('should enforce maximum batch size limit', () => {
      const dispatcher = new BatchDispatcherService({ maxBatchSize: 2000 });
      const config = dispatcher.getConfig();

      // SYNC-5000 Phase 3: Should be capped at ABSOLUTE_MAX_BATCH_SIZE (1000)
      expect(config.maxBatchSize).toBe(1000);
    });

    it('should enforce maximum concurrent partitions limit', () => {
      const dispatcher = new BatchDispatcherService({ maxConcurrentPartitions: 20 });
      const config = dispatcher.getConfig();

      // Should be capped at ABSOLUTE_MAX_CONCURRENT_PARTITIONS (8)
      expect(config.maxConcurrentPartitions).toBe(8);
    });

    it('should default to COALESCE overload policy', () => {
      const dispatcher = new BatchDispatcherService();
      expect(dispatcher.getOverloadPolicy()).toBe('COALESCE');
    });

    it('should accept custom overload policy', () => {
      const dispatcher = new BatchDispatcherService({}, 'REJECT');
      expect(dispatcher.getOverloadPolicy()).toBe('REJECT');
    });
  });

  describe('updateConfig', () => {
    it('should update configuration values', () => {
      const dispatcher = new BatchDispatcherService();

      dispatcher.updateConfig({ maxBatchSize: 75 });

      expect(dispatcher.getConfig().maxBatchSize).toBe(75);
    });

    it('should preserve non-updated values', () => {
      const dispatcher = new BatchDispatcherService({ maxQueueDepth: 8000 });

      dispatcher.updateConfig({ maxBatchSize: 75 });

      const config = dispatcher.getConfig();
      expect(config.maxBatchSize).toBe(75);
      expect(config.maxQueueDepth).toBe(8000); // Unchanged
    });
  });

  // ==========================================================================
  // Queue Health Monitoring Tests
  // ==========================================================================

  describe('getQueueHealth', () => {
    it('should return comprehensive queue health status', () => {
      mockGetPendingCount.mockReturnValue(500);
      mockGetBackoffCount.mockReturnValue(50);
      mockGetDeadLetterCount.mockReturnValue(10);
      mockGetPartitionDepths.mockReturnValue({ pack: 300, shift: 200 });
      mockGetOldestPendingTimestamp.mockReturnValue('2026-02-15T00:00:00.000Z');

      const dispatcher = new BatchDispatcherService();
      const health = dispatcher.getQueueHealth(STORE_ID);

      expect(health.pendingCount).toBe(500);
      expect(health.backoffCount).toBe(50);
      expect(health.deadLetterCount).toBe(10);
      expect(health.partitionDepths).toEqual({ pack: 300, shift: 200 });
      expect(health.overloadState).toBe('NORMAL');
    });

    it('should detect WARNING state at 80% queue depth', () => {
      mockGetPendingCount.mockReturnValue(8000); // 80% of 10000 default

      const dispatcher = new BatchDispatcherService({ maxQueueDepth: 10000 });
      const health = dispatcher.getQueueHealth(STORE_ID);

      expect(health.overloadState).toBe('WARNING');
    });

    it('should detect CRITICAL state at 95% queue depth', () => {
      mockGetPendingCount.mockReturnValue(9500); // 95% of 10000 default

      const dispatcher = new BatchDispatcherService({ maxQueueDepth: 10000 });
      const health = dispatcher.getQueueHealth(STORE_ID);

      expect(health.overloadState).toBe('CRITICAL');
    });

    it('should flag queue depth exceeded', () => {
      mockGetPendingCount.mockReturnValue(12000); // Exceeds 10000 default

      const dispatcher = new BatchDispatcherService({ maxQueueDepth: 10000 });
      const health = dispatcher.getQueueHealth(STORE_ID);

      expect(health.isQueueDepthExceeded).toBe(true);
    });

    it('should calculate oldest item age', () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      mockGetOldestPendingTimestamp.mockReturnValue(tenMinutesAgo);

      const dispatcher = new BatchDispatcherService();
      const health = dispatcher.getQueueHealth(STORE_ID);

      // Should be approximately 10 minutes in milliseconds
      expect(health.oldestItemAgeMs).toBeGreaterThan(590000); // 9.8 minutes
      expect(health.oldestItemAgeMs).toBeLessThan(610000); // 10.2 minutes
    });

    it('should return null oldest age when no pending items', () => {
      mockGetOldestPendingTimestamp.mockReturnValue(null);

      const dispatcher = new BatchDispatcherService();
      const health = dispatcher.getQueueHealth(STORE_ID);

      expect(health.oldestItemAgeMs).toBeNull();
    });
  });

  describe('canEnqueue', () => {
    it('should return true when queue has capacity', () => {
      mockGetPendingCount.mockReturnValue(500); // Well under 10000

      const dispatcher = new BatchDispatcherService();
      expect(dispatcher.canEnqueue(STORE_ID)).toBe(true);
    });

    it('should return false when queue depth exceeded', () => {
      mockGetPendingCount.mockReturnValue(15000); // Exceeds 10000

      const dispatcher = new BatchDispatcherService({ maxQueueDepth: 10000 });
      expect(dispatcher.canEnqueue(STORE_ID)).toBe(false);
    });
  });

  // ==========================================================================
  // Enqueue with Backpressure Tests
  // ==========================================================================

  describe('enqueueWithBackpressure', () => {
    const createData = {
      store_id: STORE_ID,
      entity_type: 'pack',
      entity_id: 'pack-123',
      operation: 'CREATE' as const,
      payload: { pack_id: 'pack-123' },
    };

    it('should enqueue normally when queue has capacity', () => {
      mockGetPendingCount.mockReturnValue(100);
      const mockItem = createMockSyncQueueItem();
      mockEnqueue.mockReturnValue(mockItem);

      const dispatcher = new BatchDispatcherService();
      const result = dispatcher.enqueueWithBackpressure(createData);

      expect(result.success).toBe(true);
      expect(result.item).toBe(mockItem);
      expect(result.coalesced).toBe(false);
      expect(result.deferred).toBe(false);
      expect(mockEnqueue).toHaveBeenCalledWith(createData);
    });

    it('should use idempotency key when provided', () => {
      mockGetPendingCount.mockReturnValue(100);
      const mockItem = createMockSyncQueueItem();
      mockEnqueueWithIdempotency.mockReturnValue({ item: mockItem, deduplicated: false });

      const dispatcher = new BatchDispatcherService();
      const result = dispatcher.enqueueWithBackpressure(createData, 'idempotency-key-123');

      expect(result.success).toBe(true);
      expect(result.coalesced).toBe(false);
      expect(mockEnqueueWithIdempotency).toHaveBeenCalledWith(createData, 'idempotency-key-123');
    });

    it('should report coalesced when deduplicated', () => {
      mockGetPendingCount.mockReturnValue(100);
      const mockItem = createMockSyncQueueItem();
      mockEnqueueWithIdempotency.mockReturnValue({ item: mockItem, deduplicated: true });

      const dispatcher = new BatchDispatcherService();
      const result = dispatcher.enqueueWithBackpressure(createData, 'idempotency-key-123');

      expect(result.success).toBe(true);
      expect(result.coalesced).toBe(true);
    });

    describe('REJECT policy', () => {
      it('should reject when queue full', () => {
        mockGetPendingCount.mockReturnValue(15000); // Exceeds 10000

        const dispatcher = new BatchDispatcherService({ maxQueueDepth: 10000 }, 'REJECT');
        const result = dispatcher.enqueueWithBackpressure(createData);

        expect(result.success).toBe(false);
        expect(result.item).toBeNull();
        expect(result.error).toContain('Queue full');
        expect(mockEnqueue).not.toHaveBeenCalled();
      });
    });

    describe('COALESCE policy', () => {
      it('should coalesce when existing item found with idempotency key', () => {
        mockGetPendingCount.mockReturnValue(15000); // Queue full
        const existingItem = createMockSyncQueueItem({ id: 'existing-item' });
        const updatedItem = { ...existingItem, payload: '{"updated":true}' };
        mockFindPendingByIdempotencyKey.mockReturnValue(existingItem);
        mockFindById.mockReturnValue(updatedItem);

        const dispatcher = new BatchDispatcherService({ maxQueueDepth: 10000 }, 'COALESCE');
        const result = dispatcher.enqueueWithBackpressure(createData, 'idempotency-key-123');

        expect(result.success).toBe(true);
        expect(result.coalesced).toBe(true);
        expect(mockUpdatePayload).toHaveBeenCalledWith('existing-item', expect.any(String));
      });

      it('should reject when no existing item to coalesce', () => {
        mockGetPendingCount.mockReturnValue(15000); // Queue full
        mockFindPendingByIdempotencyKey.mockReturnValue(null);

        const dispatcher = new BatchDispatcherService({ maxQueueDepth: 10000 }, 'COALESCE');
        const result = dispatcher.enqueueWithBackpressure(createData, 'idempotency-key-123');

        expect(result.success).toBe(false);
        expect(result.error).toContain('no existing item to coalesce');
      });

      it('should reject when no idempotency key provided', () => {
        mockGetPendingCount.mockReturnValue(15000); // Queue full

        const dispatcher = new BatchDispatcherService({ maxQueueDepth: 10000 }, 'COALESCE');
        const result = dispatcher.enqueueWithBackpressure(createData); // No idempotency key

        expect(result.success).toBe(false);
      });
    });

    describe('DEFER policy', () => {
      it('should enqueue with deferred flag when queue full', () => {
        mockGetPendingCount.mockReturnValue(15000); // Queue full
        const mockItem = createMockSyncQueueItem();
        mockEnqueue.mockReturnValue(mockItem);

        const dispatcher = new BatchDispatcherService({ maxQueueDepth: 10000 }, 'DEFER');
        const result = dispatcher.enqueueWithBackpressure(createData);

        expect(result.success).toBe(true);
        expect(result.deferred).toBe(true);
        expect(mockMarkDeferred).toHaveBeenCalledWith(mockItem.id);
      });
    });
  });

  // ==========================================================================
  // Partition Batch Tests
  // ==========================================================================

  describe('getPartitionBatches', () => {
    it('should return batches for each entity type with pending items', () => {
      mockGetPartitionDepths.mockReturnValue({
        pack: 50,
        shift: 30,
        day_close: 20,
      });

      const packItems = [createMockSyncQueueItem({ entity_type: 'pack' })];
      const shiftItems = [createMockSyncQueueItem({ entity_type: 'shift' })];
      const dayCloseItems = [createMockSyncQueueItem({ entity_type: 'day_close' })];

      mockGetRetryableItemsByEntityType
        .mockReturnValueOnce(shiftItems) // shift (priority)
        .mockReturnValueOnce(packItems) // pack
        .mockReturnValueOnce(dayCloseItems); // day_close

      const dispatcher = new BatchDispatcherService();
      const batches = dispatcher.getPartitionBatches(STORE_ID);

      expect(batches.length).toBe(3);
    });

    it('should prioritize dependency entity types', () => {
      mockGetPartitionDepths.mockReturnValue({
        pack: 100, // Large, but not priority
        shift: 10, // Small, but priority
        day_open: 5, // Small, but priority
      });

      const packItems = [createMockSyncQueueItem({ entity_type: 'pack' })];
      const shiftItems = [createMockSyncQueueItem({ entity_type: 'shift' })];
      const dayOpenItems = [createMockSyncQueueItem({ entity_type: 'day_open' })];

      mockGetRetryableItemsByEntityType
        .mockReturnValueOnce(shiftItems)
        .mockReturnValueOnce(dayOpenItems)
        .mockReturnValueOnce(packItems);

      const dispatcher = new BatchDispatcherService();
      const batches = dispatcher.getPartitionBatches(STORE_ID);

      // Priority types should come first
      expect(batches[0].partitionKey.entityType).toBe('shift');
      expect(batches[1].partitionKey.entityType).toBe('day_open');
      expect(batches[2].partitionKey.entityType).toBe('pack');
    });

    it('should skip partitions with no retryable items', () => {
      mockGetPartitionDepths.mockReturnValue({
        pack: 50,
        shift: 30,
      });

      mockGetRetryableItemsByEntityType
        .mockReturnValueOnce([]) // shift - all in backoff
        .mockReturnValueOnce([createMockSyncQueueItem({ entity_type: 'pack' })]); // pack

      const dispatcher = new BatchDispatcherService();
      const batches = dispatcher.getPartitionBatches(STORE_ID);

      expect(batches.length).toBe(1);
      expect(batches[0].partitionKey.entityType).toBe('pack');
    });

    it('should set hasMore flag when partition has more items', () => {
      mockGetPartitionDepths.mockReturnValue({ pack: 100 }); // 100 total

      // Return only 50 items (batch size)
      const items = Array.from({ length: 50 }, () =>
        createMockSyncQueueItem({ entity_type: 'pack' })
      );
      mockGetRetryableItemsByEntityType.mockReturnValue(items);

      const dispatcher = new BatchDispatcherService({ maxBatchSize: 50 });
      const batches = dispatcher.getPartitionBatches(STORE_ID);

      expect(batches[0].hasMore).toBe(true);
      expect(batches[0].totalPending).toBe(100);
    });
  });

  // ==========================================================================
  // Partitioned Processing Tests
  // ==========================================================================

  describe('processPartitionedBatches', () => {
    it('should process items from multiple partitions', async () => {
      mockGetPartitionDepths.mockReturnValue({
        pack: 2,
        shift: 1,
      });

      const packItems = [
        createMockSyncQueueItem({ id: 'pack-1', entity_type: 'pack' }),
        createMockSyncQueueItem({ id: 'pack-2', entity_type: 'pack' }),
      ];
      const shiftItems = [createMockSyncQueueItem({ id: 'shift-1', entity_type: 'shift' })];

      mockGetRetryableItemsByEntityType
        .mockReturnValueOnce(shiftItems) // shift (priority)
        .mockReturnValueOnce(packItems); // pack

      const processor = vi.fn().mockResolvedValue({ success: true });

      const dispatcher = new BatchDispatcherService();
      const result = await dispatcher.processPartitionedBatches(STORE_ID, processor);

      expect(result.totalProcessed).toBe(3);
      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);
      expect(processor).toHaveBeenCalledTimes(3);
    });

    it('should track partition-level results', async () => {
      mockGetPartitionDepths.mockReturnValue({
        pack: 2,
        shift: 1,
      });

      const packItems = [
        createMockSyncQueueItem({ id: 'pack-1', entity_type: 'pack' }),
        createMockSyncQueueItem({ id: 'pack-2', entity_type: 'pack' }),
      ];
      const shiftItems = [createMockSyncQueueItem({ id: 'shift-1', entity_type: 'shift' })];

      mockGetRetryableItemsByEntityType
        .mockReturnValueOnce(shiftItems)
        .mockReturnValueOnce(packItems);

      const processor = vi.fn().mockResolvedValue({ success: true });

      const dispatcher = new BatchDispatcherService();
      const result = await dispatcher.processPartitionedBatches(STORE_ID, processor);

      expect(result.partitionResults).toHaveProperty('pack');
      expect(result.partitionResults).toHaveProperty('shift');
      expect(result.partitionResults.pack).toEqual({ succeeded: 2, failed: 0 });
      expect(result.partitionResults.shift).toEqual({ succeeded: 1, failed: 0 });
    });

    it('should handle processor failures', async () => {
      mockGetPartitionDepths.mockReturnValue({ pack: 3 });

      const packItems = [
        createMockSyncQueueItem({ id: 'pack-1', entity_type: 'pack' }),
        createMockSyncQueueItem({ id: 'pack-2', entity_type: 'pack' }),
        createMockSyncQueueItem({ id: 'pack-3', entity_type: 'pack' }),
      ];

      mockGetRetryableItemsByEntityType.mockReturnValue(packItems);

      const processor = vi
        .fn()
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'API error' })
        .mockResolvedValueOnce({ success: true });

      const dispatcher = new BatchDispatcherService();
      const result = await dispatcher.processPartitionedBatches(STORE_ID, processor);

      expect(result.totalProcessed).toBe(3);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);
    });

    it('should handle processor exceptions', async () => {
      mockGetPartitionDepths.mockReturnValue({ pack: 2 });

      const packItems = [
        createMockSyncQueueItem({ id: 'pack-1', entity_type: 'pack' }),
        createMockSyncQueueItem({ id: 'pack-2', entity_type: 'pack' }),
      ];

      mockGetRetryableItemsByEntityType.mockReturnValue(packItems);

      const processor = vi
        .fn()
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce(new Error('Network timeout'));

      const dispatcher = new BatchDispatcherService();
      const result = await dispatcher.processPartitionedBatches(STORE_ID, processor);

      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
    });

    it('should prevent concurrent processing', async () => {
      mockGetPartitionDepths.mockReturnValue({ pack: 1 });

      const slowItem = createMockSyncQueueItem({ entity_type: 'pack' });
      mockGetRetryableItemsByEntityType.mockReturnValue([slowItem]);

      // Slow processor that takes 100ms
      const slowProcessor = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ success: true }), 100);
          })
      );

      const dispatcher = new BatchDispatcherService();

      // Start first processing
      const firstProcess = dispatcher.processPartitionedBatches(STORE_ID, slowProcessor);

      // Immediately try second processing (should be blocked)
      const secondProcess = dispatcher.processPartitionedBatches(STORE_ID, slowProcessor);

      const [firstResult, secondResult] = await Promise.all([firstProcess, secondProcess]);

      expect(firstResult.totalProcessed).toBe(1);
      expect(secondResult.totalProcessed).toBe(0); // Blocked
    });

    it('should return empty result when no batches', async () => {
      mockGetPartitionDepths.mockReturnValue({});

      const processor = vi.fn();

      const dispatcher = new BatchDispatcherService();
      const result = await dispatcher.processPartitionedBatches(STORE_ID, processor);

      expect(result.totalProcessed).toBe(0);
      expect(processor).not.toHaveBeenCalled();
    });

    it('should track processing duration', async () => {
      mockGetPartitionDepths.mockReturnValue({ pack: 1 });
      mockGetRetryableItemsByEntityType.mockReturnValue([
        createMockSyncQueueItem({ entity_type: 'pack' }),
      ]);

      const processor = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ success: true }), 50);
          })
      );

      const dispatcher = new BatchDispatcherService();
      const result = await dispatcher.processPartitionedBatches(STORE_ID, processor);

      expect(result.durationMs).toBeGreaterThanOrEqual(50);
    });
  });

  // ==========================================================================
  // Edge Cases and Security Tests
  // ==========================================================================

  describe('security and edge cases', () => {
    it('should be store-scoped (DB-006 compliance)', () => {
      const dispatcher = new BatchDispatcherService();
      dispatcher.getQueueHealth(STORE_ID);

      expect(mockGetPendingCount).toHaveBeenCalledWith(STORE_ID);
      expect(mockGetBackoffCount).toHaveBeenCalledWith(STORE_ID);
      expect(mockGetDeadLetterCount).toHaveBeenCalledWith(STORE_ID);
    });

    it('should not expose configuration internals in queue health', () => {
      const dispatcher = new BatchDispatcherService();
      const health = dispatcher.getQueueHealth(STORE_ID);

      // Health status should contain observable metrics, not internal config
      expect(health).not.toHaveProperty('maxBatchSize');
      expect(health).not.toHaveProperty('maxConcurrentPartitions');
    });

    it('should handle enqueue errors gracefully', () => {
      mockGetPendingCount.mockReturnValue(100);
      mockEnqueue.mockImplementation(() => {
        throw new Error('Database connection lost');
      });

      const dispatcher = new BatchDispatcherService();
      const result = dispatcher.enqueueWithBackpressure({
        store_id: STORE_ID,
        entity_type: 'pack',
        entity_id: 'pack-123',
        operation: 'CREATE',
        payload: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database connection lost');
    });
  });
});
