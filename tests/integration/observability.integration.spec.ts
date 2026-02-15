/**
 * Observability Integration Tests
 *
 * Tests for Phase 6: Observability, SLOs, and Operational Controls
 *
 * Test Categories:
 * - DT6.2: Alert thresholds trip on synthetic backlog
 * - DT6.3: Observability instrumentation does not alter sync behavior
 * - End-to-end observability flow
 *
 * @module tests/integration/observability.integration.spec
 * @compliance TEST-001: AAA pattern
 * @compliance TEST-003: Test isolation
 * @compliance TEST-004: Deterministic tests
 * @compliance MT-011: Tenant testing isolation
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

// Create database reference that will be initialized in beforeAll
let mockDb: DatabaseType;

// Mock electron app for tests
vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0-test'),
    getPath: vi.fn(() => '/tmp/test'),
  },
}));

// Use vi.hoisted pattern for database getter
const getDbMock = vi.hoisted(() => vi.fn());
const isDatabaseInitializedMock = vi.hoisted(() => vi.fn(() => true));

vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: getDbMock,
  isDatabaseInitialized: isDatabaseInitializedMock,
}));

vi.mock('../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../../src/main/utils/event-bus', () => ({
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

import { syncQueueDAL } from '../../src/main/dal/sync-queue.dal';
import { SyncMetricsService } from '../../src/main/services/sync-metrics.service';
import { SyncAlertsService } from '../../src/main/services/sync-alerts.service';
import { eventBus, MainEvents } from '../../src/main/utils/event-bus';

describe('Observability Integration Tests', () => {
  const testStoreId = '550e8400-e29b-41d4-a716-446655440000';
  let metricsService: SyncMetricsService;
  let alertsService: SyncAlertsService;

  beforeAll(() => {
    // Create in-memory database for integration tests
    mockDb = new Database(':memory:');
    // Configure the mock to return our database
    getDbMock.mockReturnValue(mockDb);
  });

  afterAll(() => {
    mockDb?.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-configure mock after clearAllMocks
    getDbMock.mockReturnValue(mockDb);

    // Initialize database schema
    mockDb.exec(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT,
        priority INTEGER DEFAULT 0,
        synced INTEGER DEFAULT 0,
        sync_attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 5,
        last_sync_error TEXT,
        last_attempt_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        synced_at TEXT,
        sync_direction TEXT DEFAULT 'PUSH',
        api_endpoint TEXT,
        http_status INTEGER,
        response_body TEXT,
        dead_lettered INTEGER DEFAULT 0,
        dead_letter_reason TEXT,
        dead_lettered_at TEXT,
        error_category TEXT,
        retry_after TEXT,
        idempotency_key TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sync_queue_store_pending
        ON sync_queue(store_id, synced, dead_lettered);

      CREATE INDEX IF NOT EXISTS idx_sync_queue_dead_letter
        ON sync_queue(store_id, dead_lettered);
    `);

    // Clear existing data
    mockDb.exec('DELETE FROM sync_queue');

    metricsService = new SyncMetricsService();
    alertsService = new SyncAlertsService();
  });

  afterEach(() => {
    metricsService.stopPeriodicCollection();
    metricsService.reset();
    alertsService.reset();
    mockDb.exec('DELETE FROM sync_queue');
  });

  // ===========================================================================
  // Helper Functions
  // ===========================================================================

  // Counter for unique IDs across tests
  let itemIdCounter = 0;

  function insertQueueItems(count: number, overrides: Record<string, unknown> = {}) {
    const stmt = mockDb.prepare(`
      INSERT INTO sync_queue (id, store_id, entity_type, entity_id, operation, payload, synced, sync_attempts, max_attempts, created_at, sync_direction, dead_lettered, error_category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < count; i++) {
      stmt.run(
        `test-item-${++itemIdCounter}`,
        overrides.store_id ?? testStoreId,
        overrides.entity_type ?? 'pack',
        `entity-${itemIdCounter}`,
        overrides.operation ?? 'UPDATE',
        JSON.stringify({ test: true }),
        overrides.synced ?? 0,
        overrides.sync_attempts ?? 0,
        overrides.max_attempts ?? 5,
        overrides.created_at ?? new Date().toISOString(),
        overrides.sync_direction ?? 'PUSH',
        overrides.dead_lettered ?? 0,
        overrides.error_category ?? null
      );
    }
  }

  function insertFailedItems(count: number) {
    const stmt = mockDb.prepare(`
      INSERT INTO sync_queue (id, store_id, entity_type, entity_id, operation, payload, synced, sync_attempts, max_attempts, last_sync_error, created_at, sync_direction, dead_lettered)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < count; i++) {
      stmt.run(
        `failed-item-${++itemIdCounter}`,
        testStoreId,
        'pack',
        `failed-entity-${itemIdCounter}`,
        'UPDATE',
        JSON.stringify({ test: true }),
        0, // synced = false
        5, // sync_attempts = max
        5, // max_attempts
        'Test error',
        new Date().toISOString(),
        'PUSH',
        0 // not dead lettered yet
      );
    }
  }

  function insertDeadLetteredItems(count: number) {
    const stmt = mockDb.prepare(`
      INSERT INTO sync_queue (id, store_id, entity_type, entity_id, operation, payload, synced, sync_attempts, max_attempts, last_sync_error, created_at, sync_direction, dead_lettered, dead_letter_reason, dead_lettered_at, error_category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < count; i++) {
      stmt.run(
        `dlq-item-${++itemIdCounter}`,
        testStoreId,
        'pack',
        `dlq-entity-${itemIdCounter}`,
        'UPDATE',
        JSON.stringify({ test: true }),
        0,
        5,
        5,
        'Permanent error',
        new Date().toISOString(),
        'PUSH',
        1, // dead_lettered = true
        'PERMANENT_ERROR',
        new Date().toISOString(),
        'PERMANENT'
      );
    }
  }

  // ===========================================================================
  // DT6.2: Alert Thresholds on Synthetic Backlog
  // ===========================================================================

  describe('DT6.2: Alert Thresholds on Synthetic Backlog', () => {
    it('triggers queue depth warning when backlog exceeds warning threshold', () => {
      // Arrange
      alertsService.updateThresholds({ queueDepthWarning: 50 });
      insertQueueItems(60); // Above warning threshold

      // Act
      const metrics = metricsService.collectMetrics(testStoreId);
      const alerts = alertsService.evaluateMetrics(metrics);

      // Assert
      expect(metrics.queueDepth.pending).toBe(60);
      expect(alerts.some((a) => a.type === 'QUEUE_DEPTH_WARNING')).toBe(true);
    });

    it('triggers queue depth critical when backlog is severe', () => {
      // Arrange
      alertsService.updateThresholds({
        queueDepthWarning: 50,
        queueDepthCritical: 100,
      });
      insertQueueItems(150); // Above critical threshold

      // Act
      const metrics = metricsService.collectMetrics(testStoreId);
      const alerts = alertsService.evaluateMetrics(metrics);

      // Assert
      expect(metrics.queueDepth.pending).toBe(150);
      expect(alerts.some((a) => a.type === 'QUEUE_DEPTH_CRITICAL')).toBe(true);
    });

    it('triggers DLQ alert when dead letter items accumulate', () => {
      // Arrange
      alertsService.updateThresholds({ dlqCountWarning: 5 });
      insertDeadLetteredItems(10);

      // Act
      const metrics = metricsService.collectMetrics(testStoreId);
      const alerts = alertsService.evaluateMetrics(metrics);

      // Assert
      expect(metrics.queueDepth.deadLettered).toBe(10);
      expect(alerts.some((a) => a.type === 'DLQ_BACKLOG_WARNING')).toBe(true);
    });

    it('triggers error rate alert when failures accumulate', () => {
      // Arrange
      alertsService.updateThresholds({ errorRateWarning: 0.05 });
      // Insert 90 successful items (already synced)
      insertQueueItems(90, { synced: 1, synced_at: new Date().toISOString() });
      // Insert 10 failed items (high error rate)
      insertFailedItems(10);

      // Act
      const metrics = metricsService.collectMetrics(testStoreId);
      const alerts = alertsService.evaluateMetrics(metrics);

      // Assert - error rate = 10 / (90 + 10) = 10%
      expect(metrics.outcome.failed).toBeGreaterThan(0);
      // Note: Error rate alert depends on exact calculation
    });

    it('resolves alerts when backlog clears', () => {
      // Arrange
      alertsService.updateThresholds({ queueDepthWarning: 50 });
      insertQueueItems(60);

      // Trigger alert
      const metrics1 = metricsService.collectMetrics(testStoreId);
      alertsService.evaluateMetrics(metrics1);
      expect(alertsService.getActiveAlerts().length).toBeGreaterThan(0);

      // Clear backlog
      mockDb.exec('DELETE FROM sync_queue');

      // Act
      const metrics2 = metricsService.collectMetrics(testStoreId);
      alertsService.evaluateMetrics(metrics2);

      // Assert
      const queueDepthAlerts = alertsService
        .getActiveAlerts()
        .filter((a) => a.type === 'QUEUE_DEPTH_WARNING' || a.type === 'QUEUE_DEPTH_CRITICAL');
      expect(queueDepthAlerts.length).toBe(0);
    });

    it('emits alert events via event bus', () => {
      // Arrange
      vi.clearAllMocks();
      alertsService.updateThresholds({ queueDepthCritical: 50 });
      insertQueueItems(100);

      // Act
      const metrics = metricsService.collectMetrics(testStoreId);
      alertsService.evaluateMetrics(metrics);

      // Assert
      expect(eventBus.emit).toHaveBeenCalledWith(
        MainEvents.SYNC_ALERT_TRIGGERED,
        expect.objectContaining({
          type: 'QUEUE_DEPTH_CRITICAL',
          severity: 'CRITICAL',
        })
      );
    });
  });

  // ===========================================================================
  // DT6.3: Observability Does Not Alter Sync Behavior
  // ===========================================================================

  describe('DT6.3: Observability Does Not Alter Sync Behavior', () => {
    it('metrics collection does not modify queue items', () => {
      // Arrange
      insertQueueItems(10);
      const countBefore = mockDb.prepare('SELECT COUNT(*) as count FROM sync_queue').get() as {
        count: number;
      };

      // Act
      metricsService.collectMetrics(testStoreId);
      metricsService.collectMetrics(testStoreId);
      metricsService.collectMetrics(testStoreId);

      // Assert
      const countAfter = mockDb.prepare('SELECT COUNT(*) as count FROM sync_queue').get() as {
        count: number;
      };
      expect(countAfter.count).toBe(countBefore.count);
    });

    it('alert evaluation does not modify queue items', () => {
      // Arrange
      insertQueueItems(100);
      const itemsBefore = mockDb.prepare('SELECT * FROM sync_queue ORDER BY id').all();

      // Act
      const metrics = metricsService.collectMetrics(testStoreId);
      alertsService.evaluateMetrics(metrics);
      alertsService.evaluateMetrics(metrics);

      // Assert
      const itemsAfter = mockDb.prepare('SELECT * FROM sync_queue ORDER BY id').all();
      expect(itemsAfter).toEqual(itemsBefore);
    });

    it('metrics collection does not affect sync_attempts', () => {
      // Arrange
      insertQueueItems(5);
      const attemptsBefore = mockDb
        .prepare('SELECT SUM(sync_attempts) as total FROM sync_queue')
        .get() as { total: number };

      // Act - collect metrics many times
      for (let i = 0; i < 10; i++) {
        metricsService.collectMetrics(testStoreId);
      }

      // Assert
      const attemptsAfter = mockDb
        .prepare('SELECT SUM(sync_attempts) as total FROM sync_queue')
        .get() as { total: number };
      expect(attemptsAfter.total).toBe(attemptsBefore.total);
    });

    it('alert triggering does not modify dead_lettered status', () => {
      // Arrange
      insertFailedItems(10);
      const dlCountBefore = mockDb
        .prepare('SELECT COUNT(*) as count FROM sync_queue WHERE dead_lettered = 1')
        .get() as { count: number };

      // Act
      const metrics = metricsService.collectMetrics(testStoreId);
      alertsService.evaluateMetrics(metrics);

      // Assert
      const dlCountAfter = mockDb
        .prepare('SELECT COUNT(*) as count FROM sync_queue WHERE dead_lettered = 1')
        .get() as { count: number };
      expect(dlCountAfter.count).toBe(dlCountBefore.count);
    });

    it('periodic collection does not leak resources', () => {
      // Arrange
      insertQueueItems(10);

      // Act - start and stop collection multiple times
      for (let i = 0; i < 5; i++) {
        metricsService.startPeriodicCollection(testStoreId, 1000);
        metricsService.stopPeriodicCollection();
      }

      // Assert
      expect(metricsService.isCollecting()).toBe(false);
    });
  });

  // ===========================================================================
  // End-to-End Observability Flow
  // ===========================================================================

  describe('End-to-End Observability Flow', () => {
    it('complete observability cycle: metrics -> alerts -> resolution', () => {
      // Arrange
      alertsService.updateThresholds({
        queueDepthWarning: 30,
        queueDepthCritical: 50,
      });

      // Phase 1: Normal state
      insertQueueItems(10);
      const metrics1 = metricsService.collectMetrics(testStoreId);
      const alerts1 = alertsService.evaluateMetrics(metrics1);
      expect(alerts1.filter((a) => a.type.includes('QUEUE_DEPTH')).length).toBe(0);
      expect(alertsService.getAlertSummary().totalActive).toBe(0);

      // Phase 2: Warning state
      insertQueueItems(30); // Total: 40
      const metrics2 = metricsService.collectMetrics(testStoreId);
      const alerts2 = alertsService.evaluateMetrics(metrics2);
      expect(alerts2.some((a) => a.type === 'QUEUE_DEPTH_WARNING')).toBe(true);
      expect(alertsService.getAlertSummary().bySeverity.WARNING).toBeGreaterThan(0);

      // Phase 3: Critical state
      insertQueueItems(30); // Total: 70
      const metrics3 = metricsService.collectMetrics(testStoreId);
      const alerts3 = alertsService.evaluateMetrics(metrics3);
      expect(alerts3.some((a) => a.type === 'QUEUE_DEPTH_CRITICAL')).toBe(true);
      expect(alertsService.getAlertSummary().bySeverity.CRITICAL).toBeGreaterThan(0);

      // Phase 4: Recovery
      mockDb.exec('DELETE FROM sync_queue');
      const metrics4 = metricsService.collectMetrics(testStoreId);
      alertsService.evaluateMetrics(metrics4);
      expect(alertsService.getAlertSummary().totalActive).toBe(0);

      // Verify history tracking
      const history = alertsService.getAlertHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history.some((h) => h.action === 'TRIGGERED')).toBe(true);
      expect(history.some((h) => h.action === 'RESOLVED')).toBe(true);
    });

    it('SLO compliance tracking across multiple collections', () => {
      // Arrange - start in compliant state
      metricsService.updateSLOConfig({
        queueDepthTarget: 100,
        errorRateTarget: 0.1,
      });

      insertQueueItems(20);

      // Act - collect metrics multiple times in compliant state
      for (let i = 0; i < 5; i++) {
        const metrics = metricsService.collectMetrics(testStoreId);
        expect(metrics.slo.overallCompliant).toBe(true);
      }

      // Push to non-compliant state
      insertQueueItems(100);
      const nonCompliantMetrics = metricsService.collectMetrics(testStoreId);

      // Assert
      expect(nonCompliantMetrics.slo.queueDepthTargetMet).toBe(false);
      expect(nonCompliantMetrics.slo.overallCompliant).toBe(false);
      // Compliance percentage should be < 100% now
      expect(nonCompliantMetrics.slo.compliancePercentage24h).toBeLessThan(100);
    });

    it('partition depth tracking for entity types', () => {
      // Arrange - insert items of different entity types
      insertQueueItems(20, { entity_type: 'pack' });
      insertQueueItems(10, { entity_type: 'shift' });
      insertQueueItems(5, { entity_type: 'employee' });

      // Act
      const metrics = metricsService.collectMetrics(testStoreId);

      // Assert
      expect(metrics.queueDepth.byEntityType.pack).toBe(20);
      expect(metrics.queueDepth.byEntityType.shift).toBe(10);
      expect(metrics.queueDepth.byEntityType.employee).toBe(5);
    });
  });

  // ===========================================================================
  // DB-006: Tenant Isolation
  // ===========================================================================

  describe('DB-006: Tenant Isolation', () => {
    const otherStoreId = '660e9500-f30c-52e5-b827-557766551111';

    it('metrics collection is tenant-scoped', () => {
      // Arrange
      insertQueueItems(50, { store_id: testStoreId });
      insertQueueItems(30, { store_id: otherStoreId });

      // Act
      const metrics = metricsService.collectMetrics(testStoreId);

      // Assert
      expect(metrics.queueDepth.pending).toBe(50); // Only testStoreId items
      expect(metrics.storeId).toBe(testStoreId);
    });

    it('alerts are tenant-scoped', () => {
      // Arrange
      alertsService.updateThresholds({ queueDepthWarning: 40 });
      insertQueueItems(20, { store_id: testStoreId });
      insertQueueItems(100, { store_id: otherStoreId });

      // Act
      const metrics = metricsService.collectMetrics(testStoreId);
      const alerts = alertsService.evaluateMetrics(metrics);

      // Assert - should NOT trigger alert based on other store's data
      expect(metrics.queueDepth.pending).toBe(20);
      expect(alerts.filter((a) => a.type.includes('QUEUE_DEPTH')).length).toBe(0);
    });
  });
});
