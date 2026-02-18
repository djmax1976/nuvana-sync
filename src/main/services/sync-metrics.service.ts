/**
 * Sync Metrics Service
 *
 * Emits structured metrics for sync queue observability.
 * Implements Phase 6 (D6.1) of SYNC-5000: Observability, SLOs, and Operational Controls.
 *
 * Key metrics:
 * - Queue depth (pending, backoff, dead-lettered)
 * - Oldest item age
 * - Retry rates
 * - Success/failure rates by operation
 * - Throughput metrics
 * - SLO compliance indicators
 *
 * @module main/services/sync-metrics
 * @security LM-002: Structured metrics for observability
 * @security API-008: Only non-sensitive metrics exposed
 * @security DB-006: Store-scoped queries for tenant isolation
 * @security SEC-006: Parameterized queries via DAL
 */

import { createLogger } from '../utils/logger';
import { syncQueueDAL, type SyncOperation, type ErrorCategory } from '../dal/sync-queue.dal';
import { eventBus, MainEvents } from '../utils/event-bus';

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('sync-metrics');

// ============================================================================
// Types
// ============================================================================

/**
 * Queue depth metrics snapshot
 * LM-002: Core queue health indicators
 */
export interface QueueDepthMetrics {
  /** Total pending items (awaiting sync) */
  pending: number;
  /** Items in backoff (waiting for retry) */
  inBackoff: number;
  /** Items in dead letter queue */
  deadLettered: number;
  /** Items actively being processed (estimate) */
  inFlight: number;
  /** Depth by entity type */
  byEntityType: Record<string, number>;
  /** Depth by operation type */
  byOperation: Record<SyncOperation, number>;
}

/**
 * Queue age metrics snapshot
 * LM-002: Staleness indicators
 */
export interface QueueAgeMetrics {
  /** Oldest pending item age in milliseconds */
  oldestPendingAgeMs: number | null;
  /** Oldest pending item timestamp */
  oldestPendingTimestamp: string | null;
  /** Average age of pending items in milliseconds */
  averagePendingAgeMs: number | null;
  /** P95 age of pending items in milliseconds (approximated) */
  p95PendingAgeMs: number | null;
}

/**
 * Retry metrics snapshot
 * LM-002: Retry behavior indicators
 */
export interface RetryMetrics {
  /** Total retry attempts in the measurement window */
  totalRetries: number;
  /** Retry rate (retries per minute) */
  retryRatePerMinute: number;
  /** Items that have exceeded retry threshold */
  exhaustedRetries: number;
  /** Breakdown by error category */
  byErrorCategory: Record<ErrorCategory, number>;
  /** Average retries per failed item */
  averageRetriesPerFailure: number;
}

/**
 * Success/failure metrics snapshot
 * LM-002: Outcome tracking
 */
export interface OutcomeMetrics {
  /** Items successfully synced in measurement window */
  succeeded: number;
  /** Items failed in measurement window */
  failed: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Breakdown by operation type */
  byOperation: Record<SyncOperation, { succeeded: number; failed: number; rate: number }>;
  /** Breakdown by entity type */
  byEntityType: Record<string, { succeeded: number; failed: number; rate: number }>;
}

/**
 * Throughput metrics snapshot
 * LM-002: Processing rate indicators
 */
export interface ThroughputMetrics {
  /** Items processed per minute (rolling average) */
  itemsPerMinute: number;
  /** Items synced in last hour */
  syncedLastHour: number;
  /** Items synced today */
  syncedToday: number;
  /** Peak throughput observed (items per minute) */
  peakThroughputPerMinute: number;
  /** Current processing state */
  processingState: 'idle' | 'active' | 'backpressure' | 'paused';
}

/**
 * SLO compliance metrics
 * LM-002: Service level tracking
 */
export interface SLOMetrics {
  /** P99 sync latency target (items synced within X ms) */
  p99LatencyTargetMs: number;
  /** Current P99 latency (estimated) */
  currentP99LatencyMs: number | null;
  /** Whether P99 target is being met */
  p99TargetMet: boolean;
  /** Queue depth target (max pending items) */
  queueDepthTarget: number;
  /** Whether queue depth target is being met */
  queueDepthTargetMet: boolean;
  /** Error rate target (max failure rate) */
  errorRateTarget: number;
  /** Whether error rate target is being met */
  errorRateTargetMet: boolean;
  /** Overall SLO compliance (true if all targets met) */
  overallCompliant: boolean;
  /** Time in compliance (last N hours) */
  compliancePercentage24h: number;
}

/**
 * Circuit breaker metrics
 * ERR-008: Circuit breaker state tracking
 */
export interface CircuitBreakerMetrics {
  /** Current circuit state */
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  /** Failures in current window */
  failuresInWindow: number;
  /** Time until circuit resets (ms, if open) */
  resetTimeMs: number | null;
  /** Successes in half-open state */
  halfOpenSuccesses: number;
  /** Total trips (times circuit opened) */
  totalTrips: number;
  /** Time since last state change */
  timeSinceLastStateChangeMs: number;
}

/**
 * Complete metrics snapshot
 * LM-002: Full observability data
 */
export interface SyncMetricsSnapshot {
  /** Timestamp of metrics collection */
  timestamp: string;
  /** Store identifier */
  storeId: string;
  /** Queue depth metrics */
  queueDepth: QueueDepthMetrics;
  /** Queue age metrics */
  queueAge: QueueAgeMetrics;
  /** Retry metrics */
  retry: RetryMetrics;
  /** Outcome metrics */
  outcome: OutcomeMetrics;
  /** Throughput metrics */
  throughput: ThroughputMetrics;
  /** SLO compliance metrics */
  slo: SLOMetrics;
  /** Circuit breaker metrics */
  circuitBreaker: CircuitBreakerMetrics;
  /** Collection duration in ms */
  collectionDurationMs: number;
}

/**
 * Metric event for structured logging
 */
export interface MetricEvent {
  name: string;
  value: number;
  unit: string;
  tags: Record<string, string>;
  timestamp: string;
}

/**
 * SLO configuration
 */
export interface SLOConfig {
  /** P99 latency target in milliseconds */
  p99LatencyTargetMs: number;
  /** Maximum queue depth */
  queueDepthTarget: number;
  /** Maximum error rate (0-1) */
  errorRateTarget: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Default SLO configuration */
const DEFAULT_SLO_CONFIG: SLOConfig = {
  p99LatencyTargetMs: 30000, // 30 seconds
  queueDepthTarget: 1000, // 1000 items max
  errorRateTarget: 0.05, // 5% max error rate
};

/** Metrics collection interval in milliseconds */
const METRICS_INTERVAL_MS = 60000; // 1 minute

/** Throughput calculation window in minutes */
const THROUGHPUT_WINDOW_MINUTES = 5;

/** Maximum stored metric events for history */
const MAX_METRIC_HISTORY = 1440; // 24 hours at 1-minute intervals

// ============================================================================
// Sync Metrics Service
// ============================================================================

/**
 * Sync Metrics Service
 *
 * Collects and emits structured metrics for sync queue observability.
 * Implements enterprise-grade monitoring patterns per LM-002.
 */
export class SyncMetricsService {
  private sloConfig: SLOConfig;
  private metricHistory: MetricEvent[] = [];
  private metricsIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastSnapshot: SyncMetricsSnapshot | null = null;

  // Tracking state for calculations
  private syncedCountLastCheck: number = 0;
  private failedCountLastCheck: number = 0;
  private lastCheckTime: number = Date.now();
  private peakThroughput: number = 0;
  private complianceHistory: boolean[] = [];

  // Circuit breaker tracking (imported from circuit-breaker.service if available)
  private circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private circuitFailures: number = 0;
  private circuitTrips: number = 0;
  private circuitLastStateChange: number = Date.now();
  private circuitHalfOpenSuccesses: number = 0;
  private circuitResetTime: number | null = null;

  constructor(config?: Partial<SLOConfig>) {
    this.sloConfig = { ...DEFAULT_SLO_CONFIG, ...config };
    log.info('SyncMetricsService initialized', { sloConfig: this.sloConfig });
  }

  // ==========================================================================
  // Core Metrics Collection
  // ==========================================================================

  /**
   * Collect complete metrics snapshot
   *
   * @security DB-006: Store-scoped queries
   * @security SEC-006: Parameterized queries via DAL
   *
   * @param storeId - Store identifier for tenant isolation
   * @returns Complete metrics snapshot
   */
  collectMetrics(storeId: string): SyncMetricsSnapshot {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // Collect all metric categories
    const queueDepth = this.collectQueueDepthMetrics(storeId);
    const queueAge = this.collectQueueAgeMetrics(storeId);
    const retry = this.collectRetryMetrics(storeId);
    const outcome = this.collectOutcomeMetrics(storeId);
    const throughput = this.collectThroughputMetrics(storeId);
    const slo = this.calculateSLOMetrics(queueDepth, outcome, queueAge);
    const circuitBreaker = this.getCircuitBreakerMetrics();

    const collectionDurationMs = Date.now() - startTime;

    const snapshot: SyncMetricsSnapshot = {
      timestamp,
      storeId,
      queueDepth,
      queueAge,
      retry,
      outcome,
      throughput,
      slo,
      circuitBreaker,
      collectionDurationMs,
    };

    // Store for history
    this.lastSnapshot = snapshot;

    // Emit structured metric events
    this.emitMetricEvents(snapshot);

    // Update compliance history (keep last 24 hours)
    this.complianceHistory.push(slo.overallCompliant);
    if (this.complianceHistory.length > MAX_METRIC_HISTORY) {
      this.complianceHistory.shift();
    }

    log.debug('Metrics collected', {
      storeId,
      pending: queueDepth.pending,
      sloCompliant: slo.overallCompliant,
      durationMs: collectionDurationMs,
    });

    return snapshot;
  }

  /**
   * Collect queue depth metrics
   */
  private collectQueueDepthMetrics(storeId: string): QueueDepthMetrics {
    const pendingCount = syncQueueDAL.getPendingCount(storeId);
    const backoffCount = syncQueueDAL.getBackoffCount(storeId);
    const deadLetterCount = syncQueueDAL.getDeadLetterCount(storeId);
    const partitionDepths = syncQueueDAL.getPartitionDepths(storeId);

    // Get breakdown by operation (using detailed stats)
    const detailedStats = syncQueueDAL.getDetailedStats(storeId);

    // Build operation breakdown from stats (byOperation is an array)
    const byOperation: Record<SyncOperation, number> = {
      CREATE: 0,
      UPDATE: 0,
      DELETE: 0,
      ACTIVATE: 0,
    };

    for (const op of detailedStats.byOperation) {
      if (op.operation in byOperation) {
        byOperation[op.operation as SyncOperation] = op.pending;
      }
    }

    return {
      pending: pendingCount,
      inBackoff: backoffCount,
      deadLettered: deadLetterCount,
      inFlight: 0, // Would need processing state tracking
      byEntityType: partitionDepths,
      byOperation,
    };
  }

  /**
   * Collect queue age metrics
   */
  private collectQueueAgeMetrics(storeId: string): QueueAgeMetrics {
    const oldestTimestamp = syncQueueDAL.getOldestPendingTimestamp(storeId);

    let oldestPendingAgeMs: number | null = null;
    if (oldestTimestamp) {
      oldestPendingAgeMs = Date.now() - new Date(oldestTimestamp).getTime();
    }

    // Calculate average and P95 from pending items
    // For enterprise accuracy, would need actual item age distribution
    // Using estimation based on oldest and queue depth
    const pendingCount = syncQueueDAL.getPendingCount(storeId);

    let averagePendingAgeMs: number | null = null;
    let p95PendingAgeMs: number | null = null;

    if (oldestPendingAgeMs !== null && pendingCount > 0) {
      // Estimate average as oldest / 2 (rough approximation)
      averagePendingAgeMs = Math.round(oldestPendingAgeMs / 2);
      // Estimate P95 as 90% of oldest (conservative)
      p95PendingAgeMs = Math.round(oldestPendingAgeMs * 0.9);
    }

    return {
      oldestPendingAgeMs,
      oldestPendingTimestamp: oldestTimestamp,
      averagePendingAgeMs,
      p95PendingAgeMs,
    };
  }

  /**
   * Collect retry metrics
   */
  private collectRetryMetrics(storeId: string): RetryMetrics {
    const detailedStats = syncQueueDAL.getDetailedStats(storeId);

    // Calculate items by error category
    // Note: The DAL doesn't provide error category breakdown directly,
    // so we use DLQ stats which have error category breakdown
    const byErrorCategory: Record<ErrorCategory, number> = {
      TRANSIENT: 0,
      PERMANENT: 0,
      STRUCTURAL: 0,
      CONFLICT: 0,
      UNKNOWN: 0,
    };

    // Get DLQ stats which have error category breakdown
    const dlqStats = syncQueueDAL.getDeadLetterStats(storeId);
    if (dlqStats.byErrorCategory) {
      for (const [category, count] of Object.entries(dlqStats.byErrorCategory)) {
        if (category in byErrorCategory) {
          byErrorCategory[category as ErrorCategory] = count;
        }
      }
    }

    // Estimate total retries based on failed items
    // Each failed item has at least max_attempts retries
    const estimatedRetries = detailedStats.failed * 5; // Assume default max_attempts = 5

    // Calculate retry rate per minute over measurement window
    const windowMinutes = THROUGHPUT_WINDOW_MINUTES;
    const retryRatePerMinute = estimatedRetries / windowMinutes;

    // Items that exceeded max attempts
    const exhaustedRetries = detailedStats.failed;

    // Average retries per failure (estimate)
    const averageRetriesPerFailure = exhaustedRetries > 0 ? 5 : 0;

    return {
      totalRetries: estimatedRetries,
      retryRatePerMinute,
      exhaustedRetries,
      byErrorCategory,
      averageRetriesPerFailure,
    };
  }

  /**
   * Collect outcome metrics
   */
  private collectOutcomeMetrics(storeId: string): OutcomeMetrics {
    const stats = syncQueueDAL.getStats(storeId);
    const detailedStats = syncQueueDAL.getDetailedStats(storeId);

    const succeeded = stats.syncedToday;
    const failed = detailedStats.failed;
    const total = succeeded + failed;
    const successRate = total > 0 ? succeeded / total : 1;

    // Build operation breakdown (byOperation is an array in detailedStats)
    const byOperation: Record<SyncOperation, { succeeded: number; failed: number; rate: number }> =
      {
        CREATE: { succeeded: 0, failed: 0, rate: 1 },
        UPDATE: { succeeded: 0, failed: 0, rate: 1 },
        DELETE: { succeeded: 0, failed: 0, rate: 1 },
        ACTIVATE: { succeeded: 0, failed: 0, rate: 1 },
      };

    for (const op of detailedStats.byOperation) {
      const opKey = op.operation as SyncOperation;
      if (opKey in byOperation) {
        byOperation[opKey].succeeded = op.synced;
        byOperation[opKey].failed = op.failed;
        const opTotal = op.synced + op.failed;
        byOperation[opKey].rate = opTotal > 0 ? op.synced / opTotal : 1;
      }
    }

    // Build entity type breakdown (from partition depths)
    const byEntityType: Record<string, { succeeded: number; failed: number; rate: number }> = {};
    const partitions = syncQueueDAL.getPartitionDepths(storeId);

    for (const [entityType, count] of Object.entries(partitions)) {
      byEntityType[entityType] = {
        succeeded: 0,
        failed: count,
        rate: 0,
      };
    }

    return {
      succeeded,
      failed,
      successRate,
      byOperation,
      byEntityType,
    };
  }

  /**
   * Collect throughput metrics
   */
  private collectThroughputMetrics(storeId: string): ThroughputMetrics {
    const stats = syncQueueDAL.getStats(storeId);
    const _detailedStats = syncQueueDAL.getDetailedStats(storeId);

    // Calculate items per minute
    const now = Date.now();
    const elapsedMinutes = (now - this.lastCheckTime) / 60000;
    const syncedDelta = stats.syncedToday - this.syncedCountLastCheck;

    let itemsPerMinute = 0;
    if (elapsedMinutes > 0 && syncedDelta > 0) {
      itemsPerMinute = syncedDelta / elapsedMinutes;
    }

    // Update tracking
    this.syncedCountLastCheck = stats.syncedToday;
    this.lastCheckTime = now;

    // Update peak throughput
    if (itemsPerMinute > this.peakThroughput) {
      this.peakThroughput = itemsPerMinute;
    }

    // Determine processing state
    let processingState: 'idle' | 'active' | 'backpressure' | 'paused' = 'idle';
    const pendingCount = syncQueueDAL.getPendingCount(storeId);

    if (pendingCount === 0) {
      processingState = 'idle';
    } else if (pendingCount > this.sloConfig.queueDepthTarget) {
      processingState = 'backpressure';
    } else if (itemsPerMinute > 0) {
      processingState = 'active';
    }

    // Estimate syncedLastHour from throughput (itemsPerMinute * 60)
    // This is an approximation since we don't have exact hourly data
    const syncedLastHourEstimate = Math.round(itemsPerMinute * 60);

    return {
      itemsPerMinute: Math.round(itemsPerMinute * 100) / 100,
      syncedLastHour: syncedLastHourEstimate,
      syncedToday: stats.syncedToday,
      peakThroughputPerMinute: Math.round(this.peakThroughput * 100) / 100,
      processingState,
    };
  }

  /**
   * Calculate SLO compliance metrics
   */
  private calculateSLOMetrics(
    queueDepth: QueueDepthMetrics,
    outcome: OutcomeMetrics,
    queueAge: QueueAgeMetrics
  ): SLOMetrics {
    // P99 latency check (using oldest pending age as proxy)
    const currentP99LatencyMs = queueAge.p95PendingAgeMs;
    const p99TargetMet =
      currentP99LatencyMs === null || currentP99LatencyMs <= this.sloConfig.p99LatencyTargetMs;

    // Queue depth check
    const queueDepthTargetMet = queueDepth.pending <= this.sloConfig.queueDepthTarget;

    // Error rate check
    const errorRateTargetMet = outcome.successRate >= 1 - this.sloConfig.errorRateTarget;

    // Overall compliance
    const overallCompliant = p99TargetMet && queueDepthTargetMet && errorRateTargetMet;

    // Calculate 24h compliance percentage INCLUDING the current check
    // This ensures the returned snapshot reflects the current state
    const recentCompliance =
      this.complianceHistory.filter(Boolean).length + (overallCompliant ? 1 : 0);
    const totalChecks = this.complianceHistory.length + 1;
    const compliancePercentage24h = (recentCompliance / totalChecks) * 100;

    return {
      p99LatencyTargetMs: this.sloConfig.p99LatencyTargetMs,
      currentP99LatencyMs,
      p99TargetMet,
      queueDepthTarget: this.sloConfig.queueDepthTarget,
      queueDepthTargetMet,
      errorRateTarget: this.sloConfig.errorRateTarget,
      errorRateTargetMet,
      overallCompliant,
      compliancePercentage24h: Math.round(compliancePercentage24h * 100) / 100,
    };
  }

  /**
   * Get circuit breaker metrics
   */
  private getCircuitBreakerMetrics(): CircuitBreakerMetrics {
    return {
      state: this.circuitState,
      failuresInWindow: this.circuitFailures,
      resetTimeMs: this.circuitResetTime,
      halfOpenSuccesses: this.circuitHalfOpenSuccesses,
      totalTrips: this.circuitTrips,
      timeSinceLastStateChangeMs: Date.now() - this.circuitLastStateChange,
    };
  }

  // ==========================================================================
  // Metric Event Emission
  // ==========================================================================

  /**
   * Emit structured metric events
   * LM-002: Structured metrics for centralized dashboards
   */
  private emitMetricEvents(snapshot: SyncMetricsSnapshot): void {
    const tags = { storeId: snapshot.storeId };
    const timestamp = snapshot.timestamp;

    // Queue depth metrics
    this.emitMetric(
      'sync.queue.depth.pending',
      snapshot.queueDepth.pending,
      'count',
      tags,
      timestamp
    );
    this.emitMetric(
      'sync.queue.depth.backoff',
      snapshot.queueDepth.inBackoff,
      'count',
      tags,
      timestamp
    );
    this.emitMetric(
      'sync.queue.depth.dlq',
      snapshot.queueDepth.deadLettered,
      'count',
      tags,
      timestamp
    );

    // Queue age metrics
    if (snapshot.queueAge.oldestPendingAgeMs !== null) {
      this.emitMetric(
        'sync.queue.age.oldest_ms',
        snapshot.queueAge.oldestPendingAgeMs,
        'milliseconds',
        tags,
        timestamp
      );
    }

    // Retry metrics
    this.emitMetric(
      'sync.retry.rate_per_minute',
      snapshot.retry.retryRatePerMinute,
      'rate',
      tags,
      timestamp
    );
    this.emitMetric(
      'sync.retry.exhausted',
      snapshot.retry.exhaustedRetries,
      'count',
      tags,
      timestamp
    );

    // Outcome metrics
    this.emitMetric(
      'sync.outcome.success_rate',
      snapshot.outcome.successRate,
      'ratio',
      tags,
      timestamp
    );
    this.emitMetric('sync.outcome.succeeded', snapshot.outcome.succeeded, 'count', tags, timestamp);
    this.emitMetric('sync.outcome.failed', snapshot.outcome.failed, 'count', tags, timestamp);

    // Throughput metrics
    this.emitMetric(
      'sync.throughput.items_per_minute',
      snapshot.throughput.itemsPerMinute,
      'rate',
      tags,
      timestamp
    );
    this.emitMetric(
      'sync.throughput.synced_today',
      snapshot.throughput.syncedToday,
      'count',
      tags,
      timestamp
    );

    // SLO metrics
    this.emitMetric(
      'sync.slo.compliant',
      snapshot.slo.overallCompliant ? 1 : 0,
      'boolean',
      tags,
      timestamp
    );
    this.emitMetric(
      'sync.slo.compliance_24h',
      snapshot.slo.compliancePercentage24h,
      'percent',
      tags,
      timestamp
    );

    // Circuit breaker
    this.emitMetric(
      'sync.circuit.open',
      snapshot.circuitBreaker.state === 'OPEN' ? 1 : 0,
      'boolean',
      tags,
      timestamp
    );
    this.emitMetric(
      'sync.circuit.trips_total',
      snapshot.circuitBreaker.totalTrips,
      'count',
      tags,
      timestamp
    );
  }

  /**
   * Emit a single metric event
   */
  private emitMetric(
    name: string,
    value: number,
    unit: string,
    tags: Record<string, string>,
    timestamp: string
  ): void {
    const event: MetricEvent = { name, value, unit, tags, timestamp };

    // Store in history (circular buffer)
    this.metricHistory.push(event);
    if (this.metricHistory.length > MAX_METRIC_HISTORY * 20) {
      // ~20 metrics per snapshot
      this.metricHistory.splice(0, 20);
    }

    // Log structured metric
    log.debug('Metric emitted', { metric: name, value, unit, ...tags });

    // Emit via event bus for real-time consumers
    eventBus.emit(MainEvents.SYNC_METRIC_EMITTED, event);
  }

  // ==========================================================================
  // Periodic Collection
  // ==========================================================================

  /**
   * Start periodic metrics collection
   */
  startPeriodicCollection(storeId: string, intervalMs: number = METRICS_INTERVAL_MS): void {
    if (this.metricsIntervalId) {
      log.warn('Periodic collection already running');
      return;
    }

    // Collect immediately
    this.collectMetrics(storeId);

    // Set up interval
    this.metricsIntervalId = setInterval(() => {
      try {
        this.collectMetrics(storeId);
      } catch (error) {
        log.error('Periodic metrics collection failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }, intervalMs);

    log.info('Periodic metrics collection started', { intervalMs });
  }

  /**
   * Stop periodic metrics collection
   */
  stopPeriodicCollection(): void {
    if (this.metricsIntervalId) {
      clearInterval(this.metricsIntervalId);
      this.metricsIntervalId = null;
      log.info('Periodic metrics collection stopped');
    }
  }

  // ==========================================================================
  // Circuit Breaker Integration
  // ==========================================================================

  /**
   * Update circuit breaker state from external source
   */
  updateCircuitBreakerState(
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN',
    failures: number,
    resetTimeMs: number | null = null
  ): void {
    const previousState = this.circuitState;
    this.circuitState = state;
    this.circuitFailures = failures;
    this.circuitResetTime = resetTimeMs;

    if (state !== previousState) {
      this.circuitLastStateChange = Date.now();
      if (state === 'OPEN') {
        this.circuitTrips++;
      } else if (state === 'HALF_OPEN') {
        this.circuitHalfOpenSuccesses = 0;
      }
    }

    if (state === 'HALF_OPEN') {
      this.circuitHalfOpenSuccesses++;
    }
  }

  // ==========================================================================
  // Getters
  // ==========================================================================

  /**
   * Get last collected snapshot
   */
  getLastSnapshot(): SyncMetricsSnapshot | null {
    return this.lastSnapshot;
  }

  /**
   * Get metric history
   */
  getMetricHistory(limit: number = 100): MetricEvent[] {
    return this.metricHistory.slice(-limit);
  }

  /**
   * Get SLO configuration
   */
  getSLOConfig(): Readonly<SLOConfig> {
    return { ...this.sloConfig };
  }

  /**
   * Update SLO configuration
   */
  updateSLOConfig(config: Partial<SLOConfig>): void {
    this.sloConfig = { ...this.sloConfig, ...config };
    log.info('SLO config updated', { sloConfig: this.sloConfig });
  }

  /**
   * Check if periodic collection is running
   */
  isCollecting(): boolean {
    return this.metricsIntervalId !== null;
  }

  /**
   * Reset all tracking state
   */
  reset(): void {
    this.syncedCountLastCheck = 0;
    this.failedCountLastCheck = 0;
    this.lastCheckTime = Date.now();
    this.peakThroughput = 0;
    this.complianceHistory = [];
    this.metricHistory = [];
    this.lastSnapshot = null;
    this.circuitState = 'CLOSED';
    this.circuitFailures = 0;
    this.circuitTrips = 0;
    this.circuitLastStateChange = Date.now();
    this.circuitHalfOpenSuccesses = 0;
    this.circuitResetTime = null;
    log.info('Metrics tracking state reset');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/** Singleton instance of SyncMetricsService */
export const syncMetricsService = new SyncMetricsService();
