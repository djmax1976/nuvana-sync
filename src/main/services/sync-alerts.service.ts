/**
 * Sync Alerts Service
 *
 * Provides threshold-based alerting for sync health monitoring.
 * Implements Phase 6 (D6.2) of SYNC-5000: Observability, SLOs, and Operational Controls.
 *
 * Key features:
 * - Configurable threshold alerts
 * - Multi-severity alert levels
 * - Alert deduplication and cooldown
 * - Alert history tracking
 * - Event bus integration
 *
 * @module main/services/sync-alerts
 * @security LM-002: Alerting for monitoring dashboards
 * @security API-008: Only non-sensitive alert data exposed
 */

import { createLogger } from '../utils/logger';
import { eventBus, MainEvents } from '../utils/event-bus';
import { type SyncMetricsSnapshot } from './sync-metrics.service';

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('sync-alerts');

// ============================================================================
// Types
// ============================================================================

/**
 * Alert severity levels
 */
export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

/**
 * Alert type identifiers
 */
export type AlertType =
  | 'QUEUE_DEPTH_WARNING'
  | 'QUEUE_DEPTH_CRITICAL'
  | 'QUEUE_AGE_WARNING'
  | 'QUEUE_AGE_CRITICAL'
  | 'ERROR_RATE_WARNING'
  | 'ERROR_RATE_CRITICAL'
  | 'DLQ_BACKLOG_WARNING'
  | 'DLQ_BACKLOG_CRITICAL'
  | 'CIRCUIT_BREAKER_OPEN'
  | 'CIRCUIT_BREAKER_HALF_OPEN'
  | 'SLO_BREACH'
  | 'THROUGHPUT_DEGRADED'
  | 'SYNC_STALLED';

/**
 * Alert definition
 */
export interface SyncAlert {
  /** Unique alert identifier */
  id: string;
  /** Alert type */
  type: AlertType;
  /** Severity level */
  severity: AlertSeverity;
  /** Human-readable title */
  title: string;
  /** Detailed message */
  message: string;
  /** Current value that triggered alert */
  currentValue: number | string;
  /** Threshold that was exceeded */
  threshold: number | string;
  /** When alert was first triggered */
  triggeredAt: string;
  /** When alert was last updated */
  updatedAt: string;
  /** Number of times this alert has fired */
  occurrenceCount: number;
  /** Whether alert is currently active */
  isActive: boolean;
  /** When alert was resolved (if resolved) */
  resolvedAt: string | null;
  /** Store identifier */
  storeId: string;
  /** Additional context */
  context: Record<string, unknown>;
}

/**
 * Alert threshold configuration
 */
export interface AlertThresholds {
  /** Queue depth warning threshold */
  queueDepthWarning: number;
  /** Queue depth critical threshold */
  queueDepthCritical: number;
  /** Queue age warning threshold (ms) */
  queueAgeWarningMs: number;
  /** Queue age critical threshold (ms) */
  queueAgeCriticalMs: number;
  /** Error rate warning threshold (0-1) */
  errorRateWarning: number;
  /** Error rate critical threshold (0-1) */
  errorRateCritical: number;
  /** DLQ count warning threshold */
  dlqCountWarning: number;
  /** DLQ count critical threshold */
  dlqCountCritical: number;
  /** Throughput degradation threshold (% of peak) */
  throughputDegradedPercent: number;
  /** Sync stalled threshold (minutes without progress) */
  syncStalledMinutes: number;
}

/**
 * Alert history entry
 */
export interface AlertHistoryEntry {
  alert: SyncAlert;
  action: 'TRIGGERED' | 'UPDATED' | 'RESOLVED';
  timestamp: string;
}

/**
 * Alert summary for UI
 */
export interface AlertSummary {
  /** Total active alerts */
  totalActive: number;
  /** Active alerts by severity */
  bySeverity: Record<AlertSeverity, number>;
  /** Active alerts */
  activeAlerts: SyncAlert[];
  /** Recent history (last N entries) */
  recentHistory: AlertHistoryEntry[];
  /** Time since last alert */
  timeSinceLastAlertMs: number | null;
}

// ============================================================================
// Constants
// ============================================================================

/** Default alert thresholds */
const DEFAULT_THRESHOLDS: AlertThresholds = {
  queueDepthWarning: 500,
  queueDepthCritical: 1000,
  queueAgeWarningMs: 300000, // 5 minutes
  queueAgeCriticalMs: 900000, // 15 minutes
  errorRateWarning: 0.03, // 3%
  errorRateCritical: 0.1, // 10%
  dlqCountWarning: 10,
  dlqCountCritical: 50,
  throughputDegradedPercent: 50,
  syncStalledMinutes: 10,
};

/** Alert cooldown period (ms) - prevent alert spam */
const ALERT_COOLDOWN_MS = 60000; // 1 minute

/** Maximum alert history entries */
const MAX_ALERT_HISTORY = 500;

/** Maximum active alerts */
const MAX_ACTIVE_ALERTS = 100;

// ============================================================================
// Sync Alerts Service
// ============================================================================

/**
 * Sync Alerts Service
 *
 * Monitors sync metrics and triggers alerts when thresholds are exceeded.
 * Implements enterprise alerting patterns per LM-002.
 */
export class SyncAlertsService {
  private thresholds: AlertThresholds;
  private activeAlerts: Map<AlertType, SyncAlert> = new Map();
  private alertHistory: AlertHistoryEntry[] = [];
  private lastAlertTime: Map<AlertType, number> = new Map();
  private lastSyncProgress: number = Date.now();
  private lastSyncedCount: number = 0;
  private alertIdCounter: number = 0;

  constructor(thresholds?: Partial<AlertThresholds>) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    log.info('SyncAlertsService initialized', { thresholds: this.thresholds });
  }

  // ==========================================================================
  // Alert Evaluation
  // ==========================================================================

  /**
   * Evaluate metrics and trigger/resolve alerts
   *
   * @param snapshot - Current metrics snapshot
   * @returns Array of triggered alerts
   */
  evaluateMetrics(snapshot: SyncMetricsSnapshot): SyncAlert[] {
    const triggeredAlerts: SyncAlert[] = [];

    // Queue depth checks
    const queueDepthAlerts = this.checkQueueDepth(snapshot);
    triggeredAlerts.push(...queueDepthAlerts);

    // Queue age checks
    const queueAgeAlerts = this.checkQueueAge(snapshot);
    triggeredAlerts.push(...queueAgeAlerts);

    // Error rate checks
    const errorRateAlerts = this.checkErrorRate(snapshot);
    triggeredAlerts.push(...errorRateAlerts);

    // DLQ checks
    const dlqAlerts = this.checkDLQ(snapshot);
    triggeredAlerts.push(...dlqAlerts);

    // Circuit breaker checks
    const circuitAlerts = this.checkCircuitBreaker(snapshot);
    triggeredAlerts.push(...circuitAlerts);

    // Throughput checks
    const throughputAlerts = this.checkThroughput(snapshot);
    triggeredAlerts.push(...throughputAlerts);

    // Sync stalled check
    const stalledAlerts = this.checkSyncStalled(snapshot);
    triggeredAlerts.push(...stalledAlerts);

    // SLO breach check
    const sloAlerts = this.checkSLOBreach(snapshot);
    triggeredAlerts.push(...sloAlerts);

    // Resolve alerts that are no longer triggered
    this.resolveInactiveAlerts(triggeredAlerts, snapshot.storeId);

    return triggeredAlerts;
  }

  /**
   * Check queue depth thresholds
   */
  private checkQueueDepth(snapshot: SyncMetricsSnapshot): SyncAlert[] {
    const alerts: SyncAlert[] = [];
    const depth = snapshot.queueDepth.pending;

    // Critical check (takes precedence)
    if (depth >= this.thresholds.queueDepthCritical) {
      const alert = this.triggerOrUpdateAlert(
        'QUEUE_DEPTH_CRITICAL',
        'CRITICAL',
        'Critical: Sync Queue Overloaded',
        `Queue depth (${depth}) has exceeded critical threshold (${this.thresholds.queueDepthCritical}). ` +
          `Immediate attention required.`,
        depth,
        this.thresholds.queueDepthCritical,
        snapshot.storeId,
        { queueDepth: snapshot.queueDepth }
      );
      if (alert) alerts.push(alert);

      // Resolve warning if critical is active
      this.resolveAlertByType('QUEUE_DEPTH_WARNING', snapshot.storeId);
    } else if (depth >= this.thresholds.queueDepthWarning) {
      const alert = this.triggerOrUpdateAlert(
        'QUEUE_DEPTH_WARNING',
        'WARNING',
        'Warning: Sync Queue Growing',
        `Queue depth (${depth}) has exceeded warning threshold (${this.thresholds.queueDepthWarning}). ` +
          `Monitor for continued growth.`,
        depth,
        this.thresholds.queueDepthWarning,
        snapshot.storeId,
        { queueDepth: snapshot.queueDepth }
      );
      if (alert) alerts.push(alert);
    }

    return alerts;
  }

  /**
   * Check queue age thresholds
   */
  private checkQueueAge(snapshot: SyncMetricsSnapshot): SyncAlert[] {
    const alerts: SyncAlert[] = [];
    const ageMs = snapshot.queueAge.oldestPendingAgeMs;

    if (ageMs === null) return alerts;

    if (ageMs >= this.thresholds.queueAgeCriticalMs) {
      const ageMinutes = Math.round(ageMs / 60000);
      const alert = this.triggerOrUpdateAlert(
        'QUEUE_AGE_CRITICAL',
        'CRITICAL',
        'Critical: Sync Items Stale',
        `Oldest pending item is ${ageMinutes} minutes old, exceeding critical threshold ` +
          `(${this.thresholds.queueAgeCriticalMs / 60000} minutes). Items may be stuck.`,
        ageMs,
        this.thresholds.queueAgeCriticalMs,
        snapshot.storeId,
        { queueAge: snapshot.queueAge }
      );
      if (alert) alerts.push(alert);

      this.resolveAlertByType('QUEUE_AGE_WARNING', snapshot.storeId);
    } else if (ageMs >= this.thresholds.queueAgeWarningMs) {
      const ageMinutes = Math.round(ageMs / 60000);
      const alert = this.triggerOrUpdateAlert(
        'QUEUE_AGE_WARNING',
        'WARNING',
        'Warning: Sync Items Aging',
        `Oldest pending item is ${ageMinutes} minutes old, exceeding warning threshold ` +
          `(${this.thresholds.queueAgeWarningMs / 60000} minutes).`,
        ageMs,
        this.thresholds.queueAgeWarningMs,
        snapshot.storeId,
        { queueAge: snapshot.queueAge }
      );
      if (alert) alerts.push(alert);
    }

    return alerts;
  }

  /**
   * Check error rate thresholds
   */
  private checkErrorRate(snapshot: SyncMetricsSnapshot): SyncAlert[] {
    const alerts: SyncAlert[] = [];
    const errorRate = 1 - snapshot.outcome.successRate;

    if (errorRate >= this.thresholds.errorRateCritical) {
      const errorPercent = Math.round(errorRate * 100);
      const alert = this.triggerOrUpdateAlert(
        'ERROR_RATE_CRITICAL',
        'CRITICAL',
        'Critical: High Sync Error Rate',
        `Error rate (${errorPercent}%) has exceeded critical threshold ` +
          `(${this.thresholds.errorRateCritical * 100}%). Many items are failing to sync.`,
        errorRate,
        this.thresholds.errorRateCritical,
        snapshot.storeId,
        { outcome: snapshot.outcome, retry: snapshot.retry }
      );
      if (alert) alerts.push(alert);

      this.resolveAlertByType('ERROR_RATE_WARNING', snapshot.storeId);
    } else if (errorRate >= this.thresholds.errorRateWarning) {
      const errorPercent = Math.round(errorRate * 100);
      const alert = this.triggerOrUpdateAlert(
        'ERROR_RATE_WARNING',
        'WARNING',
        'Warning: Elevated Sync Error Rate',
        `Error rate (${errorPercent}%) has exceeded warning threshold ` +
          `(${this.thresholds.errorRateWarning * 100}%).`,
        errorRate,
        this.thresholds.errorRateWarning,
        snapshot.storeId,
        { outcome: snapshot.outcome }
      );
      if (alert) alerts.push(alert);
    }

    return alerts;
  }

  /**
   * Check DLQ thresholds
   */
  private checkDLQ(snapshot: SyncMetricsSnapshot): SyncAlert[] {
    const alerts: SyncAlert[] = [];
    const dlqCount = snapshot.queueDepth.deadLettered;

    if (dlqCount >= this.thresholds.dlqCountCritical) {
      const alert = this.triggerOrUpdateAlert(
        'DLQ_BACKLOG_CRITICAL',
        'CRITICAL',
        'Critical: Dead Letter Queue Backlog',
        `DLQ has ${dlqCount} items, exceeding critical threshold (${this.thresholds.dlqCountCritical}). ` +
          `Manual intervention required to review and resolve failed items.`,
        dlqCount,
        this.thresholds.dlqCountCritical,
        snapshot.storeId,
        {}
      );
      if (alert) alerts.push(alert);

      this.resolveAlertByType('DLQ_BACKLOG_WARNING', snapshot.storeId);
    } else if (dlqCount >= this.thresholds.dlqCountWarning) {
      const alert = this.triggerOrUpdateAlert(
        'DLQ_BACKLOG_WARNING',
        'WARNING',
        'Warning: Dead Letter Queue Growing',
        `DLQ has ${dlqCount} items, exceeding warning threshold (${this.thresholds.dlqCountWarning}).`,
        dlqCount,
        this.thresholds.dlqCountWarning,
        snapshot.storeId,
        {}
      );
      if (alert) alerts.push(alert);
    }

    return alerts;
  }

  /**
   * Check circuit breaker state
   */
  private checkCircuitBreaker(snapshot: SyncMetricsSnapshot): SyncAlert[] {
    const alerts: SyncAlert[] = [];
    const cb = snapshot.circuitBreaker;

    if (cb.state === 'OPEN') {
      const alert = this.triggerOrUpdateAlert(
        'CIRCUIT_BREAKER_OPEN',
        'CRITICAL',
        'Critical: Sync Circuit Breaker Open',
        `Circuit breaker is OPEN due to repeated failures (${cb.failuresInWindow} in window). ` +
          `Sync operations are paused. Will retry in ${Math.round((cb.resetTimeMs || 0) / 1000)} seconds.`,
        cb.state,
        'CLOSED',
        snapshot.storeId,
        { circuitBreaker: cb }
      );
      if (alert) alerts.push(alert);
    } else if (cb.state === 'HALF_OPEN') {
      const alert = this.triggerOrUpdateAlert(
        'CIRCUIT_BREAKER_HALF_OPEN',
        'WARNING',
        'Warning: Sync Circuit Breaker Testing',
        `Circuit breaker is HALF_OPEN. Testing recovery with limited traffic. ` +
          `${cb.halfOpenSuccesses} successful test requests.`,
        cb.state,
        'CLOSED',
        snapshot.storeId,
        { circuitBreaker: cb }
      );
      if (alert) alerts.push(alert);
    }

    return alerts;
  }

  /**
   * Check throughput degradation
   */
  private checkThroughput(snapshot: SyncMetricsSnapshot): SyncAlert[] {
    const alerts: SyncAlert[] = [];
    const throughput = snapshot.throughput;

    if (throughput.peakThroughputPerMinute === 0) return alerts;

    const currentPercent = (throughput.itemsPerMinute / throughput.peakThroughputPerMinute) * 100;

    if (
      currentPercent < this.thresholds.throughputDegradedPercent &&
      throughput.processingState === 'active'
    ) {
      const alert = this.triggerOrUpdateAlert(
        'THROUGHPUT_DEGRADED',
        'WARNING',
        'Warning: Sync Throughput Degraded',
        `Current throughput (${throughput.itemsPerMinute.toFixed(1)} items/min) is ` +
          `${currentPercent.toFixed(0)}% of peak (${throughput.peakThroughputPerMinute.toFixed(1)} items/min).`,
        throughput.itemsPerMinute,
        throughput.peakThroughputPerMinute * (this.thresholds.throughputDegradedPercent / 100),
        snapshot.storeId,
        { throughput }
      );
      if (alert) alerts.push(alert);
    }

    return alerts;
  }

  /**
   * Check if sync is stalled
   */
  private checkSyncStalled(snapshot: SyncMetricsSnapshot): SyncAlert[] {
    const alerts: SyncAlert[] = [];
    const currentSyncedCount = snapshot.throughput.syncedToday;

    // Update progress tracking
    if (currentSyncedCount > this.lastSyncedCount) {
      this.lastSyncProgress = Date.now();
      this.lastSyncedCount = currentSyncedCount;
    }

    // Check if stalled (no progress and pending items exist)
    const stalledMs = Date.now() - this.lastSyncProgress;
    const stalledMinutes = stalledMs / 60000;
    const hasPending = snapshot.queueDepth.pending > 0;

    if (hasPending && stalledMinutes >= this.thresholds.syncStalledMinutes) {
      const alert = this.triggerOrUpdateAlert(
        'SYNC_STALLED',
        'CRITICAL',
        'Critical: Sync Engine Stalled',
        `No sync progress in ${stalledMinutes.toFixed(0)} minutes despite ` +
          `${snapshot.queueDepth.pending} pending items. Sync engine may be stuck.`,
        stalledMinutes,
        this.thresholds.syncStalledMinutes,
        snapshot.storeId,
        { throughput: snapshot.throughput, queueDepth: snapshot.queueDepth }
      );
      if (alert) alerts.push(alert);
    }

    return alerts;
  }

  /**
   * Check SLO breach
   */
  private checkSLOBreach(snapshot: SyncMetricsSnapshot): SyncAlert[] {
    const alerts: SyncAlert[] = [];
    const slo = snapshot.slo;

    if (!slo.overallCompliant) {
      const breaches: string[] = [];
      if (!slo.p99TargetMet) breaches.push('P99 latency');
      if (!slo.queueDepthTargetMet) breaches.push('queue depth');
      if (!slo.errorRateTargetMet) breaches.push('error rate');

      const alert = this.triggerOrUpdateAlert(
        'SLO_BREACH',
        'WARNING',
        'Warning: SLO Breach',
        `SLO targets not being met: ${breaches.join(', ')}. ` +
          `24h compliance: ${slo.compliancePercentage24h.toFixed(1)}%.`,
        slo.overallCompliant ? 1 : 0,
        1,
        snapshot.storeId,
        { slo }
      );
      if (alert) alerts.push(alert);
    }

    return alerts;
  }

  // ==========================================================================
  // Alert Management
  // ==========================================================================

  /**
   * Trigger a new alert or update existing one
   */
  private triggerOrUpdateAlert(
    type: AlertType,
    severity: AlertSeverity,
    title: string,
    message: string,
    currentValue: number | string,
    threshold: number | string,
    storeId: string,
    context: Record<string, unknown>
  ): SyncAlert | null {
    const now = Date.now();
    const existing = this.activeAlerts.get(type);

    // Check cooldown
    const lastAlert = this.lastAlertTime.get(type);
    if (lastAlert && now - lastAlert < ALERT_COOLDOWN_MS) {
      // Update existing without re-triggering event, but return alert
      // so it's not resolved by resolveInactiveAlerts
      if (existing) {
        existing.currentValue = currentValue;
        existing.updatedAt = new Date().toISOString();
        existing.occurrenceCount++;
        existing.context = context;
        return existing; // Return existing so it stays in triggeredAlerts
      }
      return null; // No existing alert to return
    }

    if (existing) {
      // Update existing alert
      existing.currentValue = currentValue;
      existing.updatedAt = new Date().toISOString();
      existing.occurrenceCount++;
      existing.context = context;

      this.addToHistory(existing, 'UPDATED');
      this.lastAlertTime.set(type, now);

      log.warn('Alert updated', {
        type,
        severity,
        currentValue,
        occurrences: existing.occurrenceCount,
      });

      return existing;
    }

    // Create new alert
    const alert: SyncAlert = {
      id: `alert_${++this.alertIdCounter}_${Date.now()}`,
      type,
      severity,
      title,
      message,
      currentValue,
      threshold,
      triggeredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      occurrenceCount: 1,
      isActive: true,
      resolvedAt: null,
      storeId,
      context,
    };

    // Enforce max active alerts
    if (this.activeAlerts.size >= MAX_ACTIVE_ALERTS) {
      // Remove oldest info alert
      const infoAlerts = Array.from(this.activeAlerts.entries()).filter(
        ([_, a]) => a.severity === 'INFO'
      );
      if (infoAlerts.length > 0) {
        this.activeAlerts.delete(infoAlerts[0][0]);
      }
    }

    this.activeAlerts.set(type, alert);
    this.addToHistory(alert, 'TRIGGERED');
    this.lastAlertTime.set(type, now);

    // Emit alert event
    eventBus.emit(MainEvents.SYNC_ALERT_TRIGGERED, alert);

    log.warn('Alert triggered', {
      type,
      severity,
      title,
      currentValue,
      threshold,
    });

    return alert;
  }

  /**
   * Resolve an alert by type
   */
  private resolveAlertByType(type: AlertType, storeId: string): void {
    const alert = this.activeAlerts.get(type);
    if (alert) {
      alert.isActive = false;
      alert.resolvedAt = new Date().toISOString();

      this.addToHistory(alert, 'RESOLVED');
      this.activeAlerts.delete(type);
      this.lastAlertTime.delete(type);

      // Emit resolution event
      eventBus.emit(MainEvents.SYNC_ALERT_RESOLVED, alert);

      log.info('Alert resolved', { type, storeId });
    }
  }

  /**
   * Resolve alerts that are no longer triggered
   */
  private resolveInactiveAlerts(triggeredAlerts: SyncAlert[], storeId: string): void {
    const triggeredTypes = new Set(triggeredAlerts.map((a) => a.type));

    for (const [type] of this.activeAlerts) {
      if (!triggeredTypes.has(type)) {
        this.resolveAlertByType(type, storeId);
      }
    }
  }

  /**
   * Add entry to alert history
   */
  private addToHistory(alert: SyncAlert, action: 'TRIGGERED' | 'UPDATED' | 'RESOLVED'): void {
    const entry: AlertHistoryEntry = {
      alert: { ...alert },
      action,
      timestamp: new Date().toISOString(),
    };

    this.alertHistory.push(entry);

    // Enforce max history size
    if (this.alertHistory.length > MAX_ALERT_HISTORY) {
      this.alertHistory.shift();
    }
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Get alert summary for UI
   */
  getAlertSummary(historyLimit: number = 20): AlertSummary {
    const activeAlerts = Array.from(this.activeAlerts.values());

    const bySeverity: Record<AlertSeverity, number> = {
      INFO: 0,
      WARNING: 0,
      CRITICAL: 0,
    };

    for (const alert of activeAlerts) {
      bySeverity[alert.severity]++;
    }

    const lastAlertEntry = this.alertHistory[this.alertHistory.length - 1];
    const timeSinceLastAlertMs = lastAlertEntry
      ? Date.now() - new Date(lastAlertEntry.timestamp).getTime()
      : null;

    return {
      totalActive: activeAlerts.length,
      bySeverity,
      activeAlerts,
      recentHistory: this.alertHistory.slice(-historyLimit),
      timeSinceLastAlertMs,
    };
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): SyncAlert[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Get alert by ID
   */
  getAlertById(id: string): SyncAlert | undefined {
    for (const alert of this.activeAlerts.values()) {
      if (alert.id === id) return alert;
    }
    return undefined;
  }

  /**
   * Get alert history
   */
  getAlertHistory(limit: number = 100): AlertHistoryEntry[] {
    return this.alertHistory.slice(-limit);
  }

  /**
   * Manually acknowledge an alert (keeps it active but marks as acknowledged)
   */
  acknowledgeAlert(alertId: string): boolean {
    for (const alert of this.activeAlerts.values()) {
      if (alert.id === alertId) {
        alert.context = {
          ...alert.context,
          acknowledged: true,
          acknowledgedAt: new Date().toISOString(),
        };
        log.info('Alert acknowledged', { alertId, type: alert.type });
        return true;
      }
    }
    return false;
  }

  /**
   * Manually resolve an alert
   */
  resolveAlert(alertId: string): boolean {
    for (const [type, alert] of this.activeAlerts) {
      if (alert.id === alertId) {
        this.resolveAlertByType(type, alert.storeId);
        return true;
      }
    }
    return false;
  }

  /**
   * Get threshold configuration
   */
  getThresholds(): Readonly<AlertThresholds> {
    return { ...this.thresholds };
  }

  /**
   * Update threshold configuration
   */
  updateThresholds(thresholds: Partial<AlertThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
    log.info('Alert thresholds updated', { thresholds: this.thresholds });
  }

  /**
   * Clear all active alerts
   */
  clearAllAlerts(): void {
    for (const [_type, alert] of this.activeAlerts) {
      alert.isActive = false;
      alert.resolvedAt = new Date().toISOString();
      alert.context = { ...alert.context, clearedManually: true };
      this.addToHistory(alert, 'RESOLVED');
    }
    this.activeAlerts.clear();
    this.lastAlertTime.clear();
    log.info('All alerts cleared');
  }

  /**
   * Reset service state
   */
  reset(): void {
    this.activeAlerts.clear();
    this.alertHistory = [];
    this.lastAlertTime.clear();
    this.lastSyncProgress = Date.now();
    this.lastSyncedCount = 0;
    this.alertIdCounter = 0;
    log.info('Alerts service reset');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/** Singleton instance of SyncAlertsService */
export const syncAlertsService = new SyncAlertsService();
