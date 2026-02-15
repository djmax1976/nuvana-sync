/**
 * Sync Alerts Service Unit Tests
 *
 * Tests for Phase 6 (D6.2): Threshold-based alerting
 *
 * Test Categories:
 * - Alert triggering
 * - Alert severity levels
 * - Alert deduplication/cooldown
 * - Alert resolution
 * - Threshold configuration
 * - Alert history
 *
 * @module tests/unit/services/sync-alerts.service.spec
 * @compliance TEST-001: AAA pattern
 * @compliance TEST-003: Test isolation
 * @compliance TEST-004: Deterministic tests
 * @compliance TEST-005: Single concept per test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock dependencies before importing the service
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

import { SyncAlertsService } from '../../../src/main/services/sync-alerts.service';
import type { SyncMetricsSnapshot } from '../../../src/main/services/sync-metrics.service';
import { eventBus, MainEvents } from '../../../src/main/utils/event-bus';

describe('SyncAlertsService', () => {
  let service: SyncAlertsService;
  const mockStoreId = '550e8400-e29b-41d4-a716-446655440000';

  /**
   * Create a base metrics snapshot with healthy defaults
   */
  function createHealthySnapshot(
    overrides: Partial<SyncMetricsSnapshot> = {}
  ): SyncMetricsSnapshot {
    return {
      timestamp: new Date().toISOString(),
      storeId: mockStoreId,
      queueDepth: {
        pending: 50,
        inBackoff: 5,
        deadLettered: 0,
        inFlight: 0,
        byEntityType: {},
        byOperation: { CREATE: 10, UPDATE: 30, DELETE: 5, ACTIVATE: 5 },
      },
      queueAge: {
        oldestPendingAgeMs: 60000, // 1 minute
        oldestPendingTimestamp: new Date(Date.now() - 60000).toISOString(),
        averagePendingAgeMs: 30000,
        p95PendingAgeMs: 54000,
      },
      retry: {
        totalRetries: 10,
        retryRatePerMinute: 2,
        exhaustedRetries: 0,
        byErrorCategory: { TRANSIENT: 5, PERMANENT: 0, STRUCTURAL: 0, CONFLICT: 0, UNKNOWN: 5 },
        averageRetriesPerFailure: 3,
      },
      outcome: {
        succeeded: 100,
        failed: 2,
        successRate: 0.98,
        byOperation: {
          CREATE: { succeeded: 30, failed: 0, rate: 1 },
          UPDATE: { succeeded: 50, failed: 1, rate: 0.98 },
          DELETE: { succeeded: 10, failed: 0, rate: 1 },
          ACTIVATE: { succeeded: 10, failed: 1, rate: 0.91 },
        },
        byEntityType: {},
      },
      throughput: {
        itemsPerMinute: 5,
        syncedLastHour: 300,
        syncedToday: 1000,
        peakThroughputPerMinute: 10,
        processingState: 'active',
      },
      slo: {
        p99LatencyTargetMs: 30000,
        currentP99LatencyMs: 25000,
        p99TargetMet: true,
        queueDepthTarget: 1000,
        queueDepthTargetMet: true,
        errorRateTarget: 0.05,
        errorRateTargetMet: true,
        overallCompliant: true,
        compliancePercentage24h: 100,
      },
      circuitBreaker: {
        state: 'CLOSED',
        failuresInWindow: 0,
        resetTimeMs: null,
        halfOpenSuccesses: 0,
        totalTrips: 0,
        timeSinceLastStateChangeMs: 3600000,
      },
      collectionDurationMs: 10,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SyncAlertsService();
  });

  afterEach(() => {
    service.reset();
  });

  // ===========================================================================
  // Queue Depth Alerts
  // ===========================================================================

  describe('Queue Depth Alerts', () => {
    it('triggers warning when queue depth exceeds warning threshold', () => {
      // Arrange
      const snapshot = createHealthySnapshot({
        queueDepth: {
          pending: 600, // Above default warning of 500
          inBackoff: 0,
          deadLettered: 0,
          inFlight: 0,
          byEntityType: {},
          byOperation: { CREATE: 0, UPDATE: 0, DELETE: 0, ACTIVATE: 0 },
        },
      });

      // Act
      const alerts = service.evaluateMetrics(snapshot);

      // Assert
      expect(alerts.length).toBe(1);
      expect(alerts[0].type).toBe('QUEUE_DEPTH_WARNING');
      expect(alerts[0].severity).toBe('WARNING');
      expect(alerts[0].currentValue).toBe(600);
    });

    it('triggers critical when queue depth exceeds critical threshold', () => {
      // Arrange
      const snapshot = createHealthySnapshot({
        queueDepth: {
          pending: 1500, // Above default critical of 1000
          inBackoff: 0,
          deadLettered: 0,
          inFlight: 0,
          byEntityType: {},
          byOperation: { CREATE: 0, UPDATE: 0, DELETE: 0, ACTIVATE: 0 },
        },
      });

      // Act
      const alerts = service.evaluateMetrics(snapshot);

      // Assert
      const criticalAlert = alerts.find((a) => a.type === 'QUEUE_DEPTH_CRITICAL');
      expect(criticalAlert).toBeDefined();
      expect(criticalAlert?.severity).toBe('CRITICAL');
    });

    it('resolves warning when queue depth returns to normal', () => {
      // Arrange
      const warningSnapshot = createHealthySnapshot({
        queueDepth: {
          pending: 600,
          inBackoff: 0,
          deadLettered: 0,
          inFlight: 0,
          byEntityType: {},
          byOperation: { CREATE: 0, UPDATE: 0, DELETE: 0, ACTIVATE: 0 },
        },
      });
      service.evaluateMetrics(warningSnapshot);

      const normalSnapshot = createHealthySnapshot();

      // Act
      service.evaluateMetrics(normalSnapshot);

      // Assert
      const activeAlerts = service.getActiveAlerts();
      expect(activeAlerts.find((a) => a.type === 'QUEUE_DEPTH_WARNING')).toBeUndefined();
    });
  });

  // ===========================================================================
  // Queue Age Alerts
  // ===========================================================================

  describe('Queue Age Alerts', () => {
    it('triggers warning when oldest item exceeds age threshold', () => {
      // Arrange
      const snapshot = createHealthySnapshot({
        queueAge: {
          oldestPendingAgeMs: 400000, // ~7 minutes, above default 5 minutes
          oldestPendingTimestamp: new Date(Date.now() - 400000).toISOString(),
          averagePendingAgeMs: 200000,
          p95PendingAgeMs: 360000,
        },
      });

      // Act
      const alerts = service.evaluateMetrics(snapshot);

      // Assert
      const ageAlert = alerts.find((a) => a.type === 'QUEUE_AGE_WARNING');
      expect(ageAlert).toBeDefined();
      expect(ageAlert?.severity).toBe('WARNING');
    });

    it('triggers critical when oldest item is very stale', () => {
      // Arrange
      const snapshot = createHealthySnapshot({
        queueAge: {
          oldestPendingAgeMs: 1000000, // ~17 minutes, above default 15 minutes critical
          oldestPendingTimestamp: new Date(Date.now() - 1000000).toISOString(),
          averagePendingAgeMs: 500000,
          p95PendingAgeMs: 900000,
        },
      });

      // Act
      const alerts = service.evaluateMetrics(snapshot);

      // Assert
      const criticalAlert = alerts.find((a) => a.type === 'QUEUE_AGE_CRITICAL');
      expect(criticalAlert).toBeDefined();
      expect(criticalAlert?.severity).toBe('CRITICAL');
    });

    it('does not trigger age alert when no pending items', () => {
      // Arrange
      const snapshot = createHealthySnapshot({
        queueAge: {
          oldestPendingAgeMs: null,
          oldestPendingTimestamp: null,
          averagePendingAgeMs: null,
          p95PendingAgeMs: null,
        },
      });

      // Act
      const alerts = service.evaluateMetrics(snapshot);

      // Assert
      const ageAlerts = alerts.filter(
        (a) => a.type === 'QUEUE_AGE_WARNING' || a.type === 'QUEUE_AGE_CRITICAL'
      );
      expect(ageAlerts.length).toBe(0);
    });
  });

  // ===========================================================================
  // Error Rate Alerts
  // ===========================================================================

  describe('Error Rate Alerts', () => {
    it('triggers warning when error rate exceeds warning threshold', () => {
      // Arrange
      const snapshot = createHealthySnapshot({
        outcome: {
          succeeded: 95,
          failed: 5, // 5% error rate = warning
          successRate: 0.95,
          byOperation: {
            CREATE: { succeeded: 0, failed: 0, rate: 1 },
            UPDATE: { succeeded: 0, failed: 0, rate: 1 },
            DELETE: { succeeded: 0, failed: 0, rate: 1 },
            ACTIVATE: { succeeded: 0, failed: 0, rate: 1 },
          },
          byEntityType: {},
        },
      });
      service.updateThresholds({ errorRateWarning: 0.03 }); // 3% threshold

      // Act
      const alerts = service.evaluateMetrics(snapshot);

      // Assert
      const errorAlert = alerts.find((a) => a.type === 'ERROR_RATE_WARNING');
      expect(errorAlert).toBeDefined();
      expect(errorAlert?.severity).toBe('WARNING');
    });

    it('triggers critical when error rate is high', () => {
      // Arrange
      const snapshot = createHealthySnapshot({
        outcome: {
          succeeded: 80,
          failed: 20, // 20% error rate = critical
          successRate: 0.8,
          byOperation: {
            CREATE: { succeeded: 0, failed: 0, rate: 1 },
            UPDATE: { succeeded: 0, failed: 0, rate: 1 },
            DELETE: { succeeded: 0, failed: 0, rate: 1 },
            ACTIVATE: { succeeded: 0, failed: 0, rate: 1 },
          },
          byEntityType: {},
        },
      });

      // Act
      const alerts = service.evaluateMetrics(snapshot);

      // Assert
      const criticalAlert = alerts.find((a) => a.type === 'ERROR_RATE_CRITICAL');
      expect(criticalAlert).toBeDefined();
      expect(criticalAlert?.severity).toBe('CRITICAL');
    });
  });

  // ===========================================================================
  // DLQ Alerts
  // ===========================================================================

  describe('DLQ Alerts', () => {
    it('triggers warning when DLQ count exceeds threshold', () => {
      // Arrange
      const snapshot = createHealthySnapshot({
        queueDepth: {
          pending: 50,
          inBackoff: 5,
          deadLettered: 20, // Above default warning of 10
          inFlight: 0,
          byEntityType: {},
          byOperation: { CREATE: 0, UPDATE: 0, DELETE: 0, ACTIVATE: 0 },
        },
      });

      // Act
      const alerts = service.evaluateMetrics(snapshot);

      // Assert
      const dlqAlert = alerts.find((a) => a.type === 'DLQ_BACKLOG_WARNING');
      expect(dlqAlert).toBeDefined();
      expect(dlqAlert?.severity).toBe('WARNING');
    });

    it('triggers critical when DLQ has large backlog', () => {
      // Arrange
      const snapshot = createHealthySnapshot({
        queueDepth: {
          pending: 50,
          inBackoff: 5,
          deadLettered: 100, // Above default critical of 50
          inFlight: 0,
          byEntityType: {},
          byOperation: { CREATE: 0, UPDATE: 0, DELETE: 0, ACTIVATE: 0 },
        },
      });

      // Act
      const alerts = service.evaluateMetrics(snapshot);

      // Assert
      const criticalAlert = alerts.find((a) => a.type === 'DLQ_BACKLOG_CRITICAL');
      expect(criticalAlert).toBeDefined();
      expect(criticalAlert?.severity).toBe('CRITICAL');
    });
  });

  // ===========================================================================
  // Circuit Breaker Alerts
  // ===========================================================================

  describe('Circuit Breaker Alerts', () => {
    it('triggers critical when circuit breaker opens', () => {
      // Arrange
      const snapshot = createHealthySnapshot({
        circuitBreaker: {
          state: 'OPEN',
          failuresInWindow: 5,
          resetTimeMs: 30000,
          halfOpenSuccesses: 0,
          totalTrips: 1,
          timeSinceLastStateChangeMs: 1000,
        },
      });

      // Act
      const alerts = service.evaluateMetrics(snapshot);

      // Assert
      const cbAlert = alerts.find((a) => a.type === 'CIRCUIT_BREAKER_OPEN');
      expect(cbAlert).toBeDefined();
      expect(cbAlert?.severity).toBe('CRITICAL');
    });

    it('triggers warning when circuit breaker is half-open', () => {
      // Arrange
      const snapshot = createHealthySnapshot({
        circuitBreaker: {
          state: 'HALF_OPEN',
          failuresInWindow: 0,
          resetTimeMs: null,
          halfOpenSuccesses: 2,
          totalTrips: 1,
          timeSinceLastStateChangeMs: 5000,
        },
      });

      // Act
      const alerts = service.evaluateMetrics(snapshot);

      // Assert
      const cbAlert = alerts.find((a) => a.type === 'CIRCUIT_BREAKER_HALF_OPEN');
      expect(cbAlert).toBeDefined();
      expect(cbAlert?.severity).toBe('WARNING');
    });

    it('does not trigger when circuit breaker is closed', () => {
      // Arrange
      const snapshot = createHealthySnapshot();

      // Act
      const alerts = service.evaluateMetrics(snapshot);

      // Assert
      const cbAlerts = alerts.filter(
        (a) => a.type === 'CIRCUIT_BREAKER_OPEN' || a.type === 'CIRCUIT_BREAKER_HALF_OPEN'
      );
      expect(cbAlerts.length).toBe(0);
    });
  });

  // ===========================================================================
  // SLO Breach Alerts
  // ===========================================================================

  describe('SLO Breach Alerts', () => {
    it('triggers warning when SLO is breached', () => {
      // Arrange
      const snapshot = createHealthySnapshot({
        slo: {
          p99LatencyTargetMs: 30000,
          currentP99LatencyMs: 50000,
          p99TargetMet: false,
          queueDepthTarget: 1000,
          queueDepthTargetMet: true,
          errorRateTarget: 0.05,
          errorRateTargetMet: true,
          overallCompliant: false,
          compliancePercentage24h: 80,
        },
      });

      // Act
      const alerts = service.evaluateMetrics(snapshot);

      // Assert
      const sloAlert = alerts.find((a) => a.type === 'SLO_BREACH');
      expect(sloAlert).toBeDefined();
      expect(sloAlert?.severity).toBe('WARNING');
      expect(sloAlert?.message).toContain('P99 latency');
    });

    it('does not trigger when SLO is compliant', () => {
      // Arrange
      const snapshot = createHealthySnapshot();

      // Act
      const alerts = service.evaluateMetrics(snapshot);

      // Assert
      const sloAlert = alerts.find((a) => a.type === 'SLO_BREACH');
      expect(sloAlert).toBeUndefined();
    });
  });

  // ===========================================================================
  // Alert Deduplication and Cooldown
  // ===========================================================================

  describe('Alert Deduplication', () => {
    it('updates existing alert instead of creating duplicate', () => {
      // Arrange
      const snapshot1 = createHealthySnapshot({
        queueDepth: {
          pending: 600,
          inBackoff: 0,
          deadLettered: 0,
          inFlight: 0,
          byEntityType: {},
          byOperation: { CREATE: 0, UPDATE: 0, DELETE: 0, ACTIVATE: 0 },
        },
      });
      const snapshot2 = createHealthySnapshot({
        queueDepth: {
          pending: 700, // Increased
          inBackoff: 0,
          deadLettered: 0,
          inFlight: 0,
          byEntityType: {},
          byOperation: { CREATE: 0, UPDATE: 0, DELETE: 0, ACTIVATE: 0 },
        },
      });

      // Act
      service.evaluateMetrics(snapshot1);
      // Second evaluation with increased value - should update existing alert
      service.evaluateMetrics(snapshot2);

      // Assert
      const activeAlerts = service.getActiveAlerts();
      const warningAlerts = activeAlerts.filter((a) => a.type === 'QUEUE_DEPTH_WARNING');
      expect(warningAlerts.length).toBe(1);
      expect(warningAlerts[0].currentValue).toBe(700);
      expect(warningAlerts[0].occurrenceCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ===========================================================================
  // Alert Management
  // ===========================================================================

  describe('Alert Management', () => {
    it('acknowledges alert by ID', () => {
      // Arrange
      const snapshot = createHealthySnapshot({
        queueDepth: {
          pending: 600,
          inBackoff: 0,
          deadLettered: 0,
          inFlight: 0,
          byEntityType: {},
          byOperation: { CREATE: 0, UPDATE: 0, DELETE: 0, ACTIVATE: 0 },
        },
      });
      service.evaluateMetrics(snapshot);
      const alerts = service.getActiveAlerts();
      const alertId = alerts[0].id;

      // Act
      const result = service.acknowledgeAlert(alertId);

      // Assert
      expect(result).toBe(true);
      const alert = service.getAlertById(alertId);
      expect(alert?.context).toHaveProperty('acknowledged', true);
    });

    it('manually resolves alert by ID', () => {
      // Arrange
      const snapshot = createHealthySnapshot({
        queueDepth: {
          pending: 600,
          inBackoff: 0,
          deadLettered: 0,
          inFlight: 0,
          byEntityType: {},
          byOperation: { CREATE: 0, UPDATE: 0, DELETE: 0, ACTIVATE: 0 },
        },
      });
      service.evaluateMetrics(snapshot);
      const alerts = service.getActiveAlerts();
      const alertId = alerts[0].id;

      // Act
      const result = service.resolveAlert(alertId);

      // Assert
      expect(result).toBe(true);
      expect(service.getActiveAlerts().length).toBe(0);
    });

    it('clears all alerts', () => {
      // Arrange
      const snapshot = createHealthySnapshot({
        queueDepth: {
          pending: 600,
          inBackoff: 0,
          deadLettered: 100,
          inFlight: 0,
          byEntityType: {},
          byOperation: { CREATE: 0, UPDATE: 0, DELETE: 0, ACTIVATE: 0 },
        },
      });
      service.evaluateMetrics(snapshot);
      expect(service.getActiveAlerts().length).toBeGreaterThan(0);

      // Act
      service.clearAllAlerts();

      // Assert
      expect(service.getActiveAlerts().length).toBe(0);
    });
  });

  // ===========================================================================
  // Alert Summary
  // ===========================================================================

  describe('Alert Summary', () => {
    it('returns correct summary counts', () => {
      // Arrange
      const snapshot = createHealthySnapshot({
        queueDepth: {
          pending: 1500, // Critical
          inBackoff: 0,
          deadLettered: 100, // Critical
          inFlight: 0,
          byEntityType: {},
          byOperation: { CREATE: 0, UPDATE: 0, DELETE: 0, ACTIVATE: 0 },
        },
      });
      service.evaluateMetrics(snapshot);

      // Act
      const summary = service.getAlertSummary();

      // Assert
      expect(summary.totalActive).toBeGreaterThan(0);
      expect(summary.bySeverity.CRITICAL).toBeGreaterThan(0);
      expect(summary.activeAlerts.length).toBe(summary.totalActive);
    });
  });

  // ===========================================================================
  // Event Emission
  // ===========================================================================

  describe('Event Emission', () => {
    it('emits alert triggered event', () => {
      // Arrange
      const snapshot = createHealthySnapshot({
        queueDepth: {
          pending: 1500,
          inBackoff: 0,
          deadLettered: 0,
          inFlight: 0,
          byEntityType: {},
          byOperation: { CREATE: 0, UPDATE: 0, DELETE: 0, ACTIVATE: 0 },
        },
      });

      // Act
      service.evaluateMetrics(snapshot);

      // Assert
      expect(eventBus.emit).toHaveBeenCalledWith(
        MainEvents.SYNC_ALERT_TRIGGERED,
        expect.objectContaining({
          type: 'QUEUE_DEPTH_CRITICAL',
          severity: 'CRITICAL',
        })
      );
    });

    it('emits alert resolved event', () => {
      // Arrange
      const warningSnapshot = createHealthySnapshot({
        queueDepth: {
          pending: 600,
          inBackoff: 0,
          deadLettered: 0,
          inFlight: 0,
          byEntityType: {},
          byOperation: { CREATE: 0, UPDATE: 0, DELETE: 0, ACTIVATE: 0 },
        },
      });
      service.evaluateMetrics(warningSnapshot);
      vi.clearAllMocks();

      const normalSnapshot = createHealthySnapshot();

      // Act
      service.evaluateMetrics(normalSnapshot);

      // Assert
      expect(eventBus.emit).toHaveBeenCalledWith(
        MainEvents.SYNC_ALERT_RESOLVED,
        expect.objectContaining({
          type: 'QUEUE_DEPTH_WARNING',
        })
      );
    });
  });

  // ===========================================================================
  // Threshold Configuration
  // ===========================================================================

  describe('Threshold Configuration', () => {
    it('returns current thresholds', () => {
      // Act
      const thresholds = service.getThresholds();

      // Assert
      expect(thresholds.queueDepthWarning).toBe(500);
      expect(thresholds.queueDepthCritical).toBe(1000);
      expect(thresholds.errorRateWarning).toBe(0.03);
    });

    it('updates thresholds', () => {
      // Act
      service.updateThresholds({
        queueDepthWarning: 300,
        queueDepthCritical: 600,
      });

      // Assert
      const thresholds = service.getThresholds();
      expect(thresholds.queueDepthWarning).toBe(300);
      expect(thresholds.queueDepthCritical).toBe(600);
    });

    it('uses updated thresholds for alerting', () => {
      // Arrange
      service.updateThresholds({ queueDepthWarning: 100 });
      const snapshot = createHealthySnapshot({
        queueDepth: {
          pending: 150,
          inBackoff: 0,
          deadLettered: 0,
          inFlight: 0,
          byEntityType: {},
          byOperation: { CREATE: 0, UPDATE: 0, DELETE: 0, ACTIVATE: 0 },
        },
      });

      // Act
      const alerts = service.evaluateMetrics(snapshot);

      // Assert
      expect(alerts.some((a) => a.type === 'QUEUE_DEPTH_WARNING')).toBe(true);
    });
  });

  // ===========================================================================
  // Reset
  // ===========================================================================

  describe('Reset', () => {
    it('clears all state on reset', () => {
      // Arrange
      const snapshot = createHealthySnapshot({
        queueDepth: {
          pending: 1500,
          inBackoff: 0,
          deadLettered: 0,
          inFlight: 0,
          byEntityType: {},
          byOperation: { CREATE: 0, UPDATE: 0, DELETE: 0, ACTIVATE: 0 },
        },
      });
      service.evaluateMetrics(snapshot);
      expect(service.getActiveAlerts().length).toBeGreaterThan(0);

      // Act
      service.reset();

      // Assert
      expect(service.getActiveAlerts().length).toBe(0);
      expect(service.getAlertHistory().length).toBe(0);
    });
  });
});
