/**
 * Sync Metrics Service Unit Tests
 *
 * Tests for Phase 6 (D6.1): Structured metrics emission
 *
 * Test Categories:
 * - Queue depth metrics
 * - Queue age metrics
 * - Retry metrics
 * - Outcome metrics
 * - Throughput metrics
 * - SLO compliance metrics
 * - Circuit breaker metrics
 * - Metric event emission
 *
 * @module tests/unit/services/sync-metrics.service.spec
 * @compliance TEST-001: AAA pattern
 * @compliance TEST-003: Test isolation
 * @compliance TEST-004: Deterministic tests
 * @compliance TEST-005: Single concept per test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock dependencies before importing the service
vi.mock('../../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: {
    getPendingCount: vi.fn(),
    getBackoffCount: vi.fn(),
    getDeadLetterCount: vi.fn(),
    getPartitionDepths: vi.fn(),
    getDetailedStats: vi.fn(),
    getOldestPendingTimestamp: vi.fn(),
    getDeadLetterStats: vi.fn(),
    getStats: vi.fn(),
  },
}));

vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../../../src/main/utils/event-bus', () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
  MainEvents: {
    SYNC_METRIC_EMITTED: 'sync:metric:emitted',
    SYNC_ALERT_TRIGGERED: 'sync:alert:triggered',
    SYNC_ALERT_RESOLVED: 'sync:alert:resolved',
  },
}));

import { SyncMetricsService } from '../../../src/main/services/sync-metrics.service';
import { syncQueueDAL } from '../../../src/main/dal/sync-queue.dal';
import { eventBus, MainEvents } from '../../../src/main/utils/event-bus';

describe('SyncMetricsService', () => {
  let service: SyncMetricsService;
  const mockStoreId = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SyncMetricsService();

    // Default mock returns
    vi.mocked(syncQueueDAL.getPendingCount).mockReturnValue(0);
    vi.mocked(syncQueueDAL.getBackoffCount).mockReturnValue(0);
    vi.mocked(syncQueueDAL.getDeadLetterCount).mockReturnValue(0);
    vi.mocked(syncQueueDAL.getPartitionDepths).mockReturnValue({});
    vi.mocked(syncQueueDAL.getOldestPendingTimestamp).mockReturnValue(null);
    vi.mocked(syncQueueDAL.getStats).mockReturnValue({
      pending: 0,
      queued: 0,
      failed: 0,
      syncedToday: 0,
      oldestPending: null,
    });
    vi.mocked(syncQueueDAL.getDetailedStats).mockReturnValue({
      pending: 0,
      queued: 0,
      failed: 0,
      syncedToday: 0,
      syncedTotal: 0,
      oldestPending: null,
      newestSync: null,
      byEntityType: [],
      byOperation: [],
      byDirection: [],
    });
    vi.mocked(syncQueueDAL.getDeadLetterStats).mockReturnValue({
      total: 0,
      byReason: {
        MAX_ATTEMPTS_EXCEEDED: 0,
        PERMANENT_ERROR: 0,
        STRUCTURAL_FAILURE: 0,
        CONFLICT_ERROR: 0,
        MANUAL: 0,
      },
      byEntityType: {},
      byErrorCategory: {
        TRANSIENT: 0,
        PERMANENT: 0,
        STRUCTURAL: 0,
        CONFLICT: 0,
        UNKNOWN: 0,
      },
      oldestItem: null,
      newestItem: null,
    });
  });

  afterEach(() => {
    service.stopPeriodicCollection();
    service.reset();
  });

  // ===========================================================================
  // Queue Depth Metrics
  // ===========================================================================

  describe('Queue Depth Metrics', () => {
    it('collects pending count correctly', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getPendingCount).mockReturnValue(42);

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.queueDepth.pending).toBe(42);
      expect(syncQueueDAL.getPendingCount).toHaveBeenCalledWith(mockStoreId);
    });

    it('collects backoff count correctly', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getBackoffCount).mockReturnValue(10);

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.queueDepth.inBackoff).toBe(10);
      expect(syncQueueDAL.getBackoffCount).toHaveBeenCalledWith(mockStoreId);
    });

    it('collects dead letter count correctly', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getDeadLetterCount).mockReturnValue(5);

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.queueDepth.deadLettered).toBe(5);
      expect(syncQueueDAL.getDeadLetterCount).toHaveBeenCalledWith(mockStoreId);
    });

    it('collects partition depths correctly', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getPartitionDepths).mockReturnValue({
        pack: 20,
        shift: 5,
        employee: 3,
      });

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.queueDepth.byEntityType).toEqual({
        pack: 20,
        shift: 5,
        employee: 3,
      });
    });

    it('collects operation breakdown correctly', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getDetailedStats).mockReturnValue({
        pending: 10,
        queued: 8,
        failed: 2,
        syncedToday: 50,
        syncedTotal: 100,
        oldestPending: null,
        newestSync: null,
        byEntityType: [],
        byOperation: [
          { operation: 'CREATE', pending: 3, queued: 2, failed: 1, synced: 10 },
          { operation: 'UPDATE', pending: 5, queued: 4, failed: 1, synced: 30 },
          { operation: 'ACTIVATE', pending: 2, queued: 2, failed: 0, synced: 10 },
        ],
        byDirection: [],
      });

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.queueDepth.byOperation.CREATE).toBe(3);
      expect(snapshot.queueDepth.byOperation.UPDATE).toBe(5);
      expect(snapshot.queueDepth.byOperation.ACTIVATE).toBe(2);
      expect(snapshot.queueDepth.byOperation.DELETE).toBe(0);
    });
  });

  // ===========================================================================
  // Queue Age Metrics
  // ===========================================================================

  describe('Queue Age Metrics', () => {
    it('returns null age when no pending items', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getOldestPendingTimestamp).mockReturnValue(null);

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.queueAge.oldestPendingAgeMs).toBeNull();
      expect(snapshot.queueAge.oldestPendingTimestamp).toBeNull();
      expect(snapshot.queueAge.averagePendingAgeMs).toBeNull();
      expect(snapshot.queueAge.p95PendingAgeMs).toBeNull();
    });

    it('calculates age from oldest pending timestamp', () => {
      // Arrange
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      vi.mocked(syncQueueDAL.getOldestPendingTimestamp).mockReturnValue(tenMinutesAgo);
      vi.mocked(syncQueueDAL.getPendingCount).mockReturnValue(5);

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.queueAge.oldestPendingAgeMs).toBeGreaterThan(9 * 60 * 1000);
      expect(snapshot.queueAge.oldestPendingAgeMs).toBeLessThan(11 * 60 * 1000);
      expect(snapshot.queueAge.oldestPendingTimestamp).toBe(tenMinutesAgo);
    });

    it('estimates P95 age as 90% of oldest', () => {
      // Arrange
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      vi.mocked(syncQueueDAL.getOldestPendingTimestamp).mockReturnValue(fiveMinutesAgo);
      vi.mocked(syncQueueDAL.getPendingCount).mockReturnValue(10);

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert - P95 should be approximately 90% of oldest
      const expectedOldest = 5 * 60 * 1000;
      const expectedP95 = expectedOldest * 0.9;
      expect(snapshot.queueAge.p95PendingAgeMs).toBeCloseTo(expectedP95, -4);
    });
  });

  // ===========================================================================
  // Retry Metrics
  // ===========================================================================

  describe('Retry Metrics', () => {
    it('calculates exhausted retries from failed count', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getDetailedStats).mockReturnValue({
        pending: 5,
        queued: 2,
        failed: 3,
        syncedToday: 100,
        syncedTotal: 500,
        oldestPending: null,
        newestSync: null,
        byEntityType: [],
        byOperation: [],
        byDirection: [],
      });

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.retry.exhaustedRetries).toBe(3);
    });

    it('returns error category breakdown from DLQ stats', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getDeadLetterStats).mockReturnValue({
        total: 10,
        byReason: {
          MAX_ATTEMPTS_EXCEEDED: 0,
          PERMANENT_ERROR: 0,
          STRUCTURAL_FAILURE: 0,
          CONFLICT_ERROR: 0,
          MANUAL: 0,
        },
        byEntityType: {},
        byErrorCategory: {
          TRANSIENT: 3,
          PERMANENT: 5,
          STRUCTURAL: 2,
          CONFLICT: 0,
          UNKNOWN: 0,
        },
        oldestItem: null,
        newestItem: null,
      });

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.retry.byErrorCategory.TRANSIENT).toBe(3);
      expect(snapshot.retry.byErrorCategory.PERMANENT).toBe(5);
      expect(snapshot.retry.byErrorCategory.STRUCTURAL).toBe(2);
    });
  });

  // ===========================================================================
  // Outcome Metrics
  // ===========================================================================

  describe('Outcome Metrics', () => {
    it('calculates success rate correctly', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getStats).mockReturnValue({
        pending: 5,
        queued: 5,
        failed: 0,
        syncedToday: 95,
        oldestPending: null,
      });
      vi.mocked(syncQueueDAL.getDetailedStats).mockReturnValue({
        pending: 5,
        queued: 5,
        failed: 5,
        syncedToday: 95,
        syncedTotal: 100,
        oldestPending: null,
        newestSync: null,
        byEntityType: [],
        byOperation: [],
        byDirection: [],
      });

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      // success rate = 95 / (95 + 5) = 0.95
      expect(snapshot.outcome.successRate).toBe(0.95);
      expect(snapshot.outcome.succeeded).toBe(95);
      expect(snapshot.outcome.failed).toBe(5);
    });

    it('returns 100% success rate when no items processed', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getStats).mockReturnValue({
        pending: 0,
        queued: 0,
        failed: 0,
        syncedToday: 0,
        oldestPending: null,
      });
      vi.mocked(syncQueueDAL.getDetailedStats).mockReturnValue({
        pending: 0,
        queued: 0,
        failed: 0,
        syncedToday: 0,
        syncedTotal: 0,
        oldestPending: null,
        newestSync: null,
        byEntityType: [],
        byOperation: [],
        byDirection: [],
      });

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.outcome.successRate).toBe(1);
    });

    it('includes operation breakdown', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getDetailedStats).mockReturnValue({
        pending: 10,
        queued: 8,
        failed: 2,
        syncedToday: 50,
        syncedTotal: 100,
        oldestPending: null,
        newestSync: null,
        byEntityType: [],
        byOperation: [
          { operation: 'CREATE', pending: 2, queued: 1, failed: 1, synced: 20 },
          { operation: 'UPDATE', pending: 3, queued: 2, failed: 1, synced: 30 },
        ],
        byDirection: [],
      });

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.outcome.byOperation.CREATE.succeeded).toBe(20);
      expect(snapshot.outcome.byOperation.CREATE.failed).toBe(1);
      expect(snapshot.outcome.byOperation.UPDATE.succeeded).toBe(30);
      expect(snapshot.outcome.byOperation.UPDATE.failed).toBe(1);
    });
  });

  // ===========================================================================
  // Throughput Metrics
  // ===========================================================================

  describe('Throughput Metrics', () => {
    it('starts with zero throughput', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getStats).mockReturnValue({
        pending: 0,
        queued: 0,
        failed: 0,
        syncedToday: 0,
        oldestPending: null,
      });

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.throughput.itemsPerMinute).toBe(0);
      expect(snapshot.throughput.peakThroughputPerMinute).toBe(0);
    });

    it('detects idle processing state when queue empty', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getPendingCount).mockReturnValue(0);

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.throughput.processingState).toBe('idle');
    });

    it('detects backpressure when queue exceeds target', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getPendingCount).mockReturnValue(2000);
      service.updateSLOConfig({ queueDepthTarget: 1000 });

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.throughput.processingState).toBe('backpressure');
    });

    it('includes synced today count', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getStats).mockReturnValue({
        pending: 0,
        queued: 0,
        failed: 0,
        syncedToday: 150,
        oldestPending: null,
      });

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.throughput.syncedToday).toBe(150);
    });
  });

  // ===========================================================================
  // SLO Compliance Metrics
  // ===========================================================================

  describe('SLO Compliance Metrics', () => {
    it('returns compliant when all targets met', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getPendingCount).mockReturnValue(50);
      vi.mocked(syncQueueDAL.getOldestPendingTimestamp).mockReturnValue(null);
      vi.mocked(syncQueueDAL.getStats).mockReturnValue({
        pending: 50,
        queued: 50,
        failed: 0,
        syncedToday: 100,
        oldestPending: null,
      });
      vi.mocked(syncQueueDAL.getDetailedStats).mockReturnValue({
        pending: 50,
        queued: 50,
        failed: 0,
        syncedToday: 100,
        syncedTotal: 200,
        oldestPending: null,
        newestSync: null,
        byEntityType: [],
        byOperation: [],
        byDirection: [],
      });

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.slo.overallCompliant).toBe(true);
      expect(snapshot.slo.queueDepthTargetMet).toBe(true);
      expect(snapshot.slo.errorRateTargetMet).toBe(true);
    });

    it('returns non-compliant when queue depth exceeds target', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getPendingCount).mockReturnValue(2000);
      service.updateSLOConfig({ queueDepthTarget: 1000 });

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.slo.overallCompliant).toBe(false);
      expect(snapshot.slo.queueDepthTargetMet).toBe(false);
    });

    it('returns non-compliant when error rate exceeds target', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getStats).mockReturnValue({
        pending: 10,
        queued: 5,
        failed: 0,
        syncedToday: 50,
        oldestPending: null,
      });
      vi.mocked(syncQueueDAL.getDetailedStats).mockReturnValue({
        pending: 10,
        queued: 5,
        failed: 50, // High failure rate
        syncedToday: 50,
        syncedTotal: 100,
        oldestPending: null,
        newestSync: null,
        byEntityType: [],
        byOperation: [],
        byDirection: [],
      });
      service.updateSLOConfig({ errorRateTarget: 0.05 }); // 5% max

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.slo.overallCompliant).toBe(false);
      expect(snapshot.slo.errorRateTargetMet).toBe(false);
    });

    it('tracks compliance percentage over time', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getPendingCount).mockReturnValue(50);
      vi.mocked(syncQueueDAL.getDetailedStats).mockReturnValue({
        pending: 50,
        queued: 50,
        failed: 0,
        syncedToday: 100,
        syncedTotal: 200,
        oldestPending: null,
        newestSync: null,
        byEntityType: [],
        byOperation: [],
        byDirection: [],
      });

      // Act - Collect metrics multiple times
      service.collectMetrics(mockStoreId);
      service.collectMetrics(mockStoreId);
      service.collectMetrics(mockStoreId);
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.slo.compliancePercentage24h).toBe(100); // All compliant
    });
  });

  // ===========================================================================
  // Circuit Breaker Metrics
  // ===========================================================================

  describe('Circuit Breaker Metrics', () => {
    it('starts in CLOSED state', () => {
      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.circuitBreaker.state).toBe('CLOSED');
      expect(snapshot.circuitBreaker.totalTrips).toBe(0);
    });

    it('tracks state changes when updated', () => {
      // Arrange
      service.updateCircuitBreakerState('OPEN', 5, 30000);

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.circuitBreaker.state).toBe('OPEN');
      expect(snapshot.circuitBreaker.failuresInWindow).toBe(5);
      expect(snapshot.circuitBreaker.resetTimeMs).toBe(30000);
    });

    it('counts total trips when circuit opens', () => {
      // Arrange
      service.updateCircuitBreakerState('OPEN', 5, 30000);
      service.updateCircuitBreakerState('HALF_OPEN', 0, null);
      service.updateCircuitBreakerState('OPEN', 3, 30000);

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.circuitBreaker.totalTrips).toBe(2);
    });

    it('tracks half-open successes', () => {
      // Arrange
      service.updateCircuitBreakerState('HALF_OPEN', 0, null);
      service.updateCircuitBreakerState('HALF_OPEN', 0, null);
      service.updateCircuitBreakerState('HALF_OPEN', 0, null);

      // Act
      const snapshot = service.collectMetrics(mockStoreId);

      // Assert
      expect(snapshot.circuitBreaker.halfOpenSuccesses).toBe(3);
    });
  });

  // ===========================================================================
  // Metric Event Emission
  // ===========================================================================

  describe('Metric Event Emission', () => {
    it('emits queue depth pending metric', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getPendingCount).mockReturnValue(42);

      // Act
      service.collectMetrics(mockStoreId);

      // Assert
      expect(eventBus.emit).toHaveBeenCalledWith(
        MainEvents.SYNC_METRIC_EMITTED,
        expect.objectContaining({
          name: 'sync.queue.depth.pending',
          value: 42,
          unit: 'count',
        })
      );
    });

    it('emits SLO compliance metric', () => {
      // Act
      service.collectMetrics(mockStoreId);

      // Assert
      expect(eventBus.emit).toHaveBeenCalledWith(
        MainEvents.SYNC_METRIC_EMITTED,
        expect.objectContaining({
          name: 'sync.slo.compliant',
          unit: 'boolean',
        })
      );
    });

    it('stores metrics in history', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getPendingCount).mockReturnValue(10);

      // Act
      service.collectMetrics(mockStoreId);
      service.collectMetrics(mockStoreId);
      service.collectMetrics(mockStoreId);

      // Assert
      const history = service.getMetricHistory(100);
      expect(history.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Configuration Management
  // ===========================================================================

  describe('Configuration Management', () => {
    it('returns default SLO config', () => {
      // Act
      const config = service.getSLOConfig();

      // Assert
      expect(config.p99LatencyTargetMs).toBe(30000);
      expect(config.queueDepthTarget).toBe(1000);
      expect(config.errorRateTarget).toBe(0.05);
    });

    it('updates SLO config', () => {
      // Act
      service.updateSLOConfig({
        p99LatencyTargetMs: 60000,
        queueDepthTarget: 500,
      });

      // Assert
      const config = service.getSLOConfig();
      expect(config.p99LatencyTargetMs).toBe(60000);
      expect(config.queueDepthTarget).toBe(500);
      expect(config.errorRateTarget).toBe(0.05); // Unchanged
    });
  });

  // ===========================================================================
  // Periodic Collection
  // ===========================================================================

  describe('Periodic Collection', () => {
    it('tracks collection state', () => {
      // Arrange
      expect(service.isCollecting()).toBe(false);

      // Act
      service.startPeriodicCollection(mockStoreId, 10000);

      // Assert
      expect(service.isCollecting()).toBe(true);

      // Cleanup
      service.stopPeriodicCollection();
      expect(service.isCollecting()).toBe(false);
    });

    it('does not start if already running', () => {
      // Arrange
      service.startPeriodicCollection(mockStoreId, 10000);

      // Act - Try to start again
      service.startPeriodicCollection(mockStoreId, 5000);

      // Assert - Should still be collecting
      expect(service.isCollecting()).toBe(true);

      // Cleanup
      service.stopPeriodicCollection();
    });
  });

  // ===========================================================================
  // Reset and State Management
  // ===========================================================================

  describe('Reset and State Management', () => {
    it('resets all tracking state', () => {
      // Arrange
      vi.mocked(syncQueueDAL.getPendingCount).mockReturnValue(100);
      service.collectMetrics(mockStoreId);
      service.updateCircuitBreakerState('OPEN', 5, 30000);

      // Act
      service.reset();

      // Assert
      expect(service.getLastSnapshot()).toBeNull();
      expect(service.getMetricHistory()).toHaveLength(0);
      const snapshot = service.collectMetrics(mockStoreId);
      expect(snapshot.circuitBreaker.state).toBe('CLOSED');
      expect(snapshot.circuitBreaker.totalTrips).toBe(0);
    });
  });
});
