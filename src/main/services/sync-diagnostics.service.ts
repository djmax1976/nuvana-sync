/**
 * Sync Diagnostics Service
 *
 * Provides local diagnostic export for incident triage.
 * Implements Phase 6 (D6.3) of SYNC-5000: Observability, SLOs, and Operational Controls.
 *
 * Key features:
 * - Queue snapshot export
 * - Metrics history export
 * - Error summary generation
 * - DLQ analysis
 * - JSON export format for analysis
 * - Redaction of sensitive data
 *
 * @module main/services/sync-diagnostics
 * @security LM-002: Diagnostic data for incident triage
 * @security API-008: Sensitive data redacted from exports
 * @security DB-006: Store-scoped queries for tenant isolation
 * @security SEC-006: Parameterized queries via DAL
 */

import { createLogger } from '../utils/logger';
import { syncQueueDAL, type SyncQueueItem, type DeadLetterItem } from '../dal/sync-queue.dal';
import { syncLogDAL } from '../dal/sync-log.dal';
import {
  syncMetricsService,
  type SyncMetricsSnapshot,
  type MetricEvent,
} from './sync-metrics.service';
import { syncAlertsService, type SyncAlert, type AlertHistoryEntry } from './sync-alerts.service';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('sync-diagnostics');

// ============================================================================
// Types
// ============================================================================

/**
 * Diagnostic export configuration
 */
export interface DiagnosticExportConfig {
  /** Include queue snapshot */
  includeQueueSnapshot: boolean;
  /** Include DLQ items */
  includeDLQ: boolean;
  /** Include metrics history */
  includeMetricsHistory: boolean;
  /** Include alert history */
  includeAlertHistory: boolean;
  /** Include sync log history */
  includeSyncLogHistory: boolean;
  /** Include error analysis */
  includeErrorAnalysis: boolean;
  /** Maximum items per category */
  maxItemsPerCategory: number;
  /** Redact payload data */
  redactPayloads: boolean;
}

/**
 * Redacted queue item (API-008 compliant)
 */
export interface RedactedQueueItem {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  priority: number;
  synced: boolean;
  sync_attempts: number;
  max_attempts: number;
  last_sync_error: string | null;
  last_attempt_at: string | null;
  created_at: string;
  synced_at: string | null;
  sync_direction: string;
  api_endpoint: string | null;
  http_status: number | null;
  dead_lettered: boolean;
  dead_letter_reason: string | null;
  dead_lettered_at: string | null;
  error_category: string | null;
  retry_after: string | null;
  /** Payload summary (redacted) */
  payload_summary: Record<string, unknown>;
}

/**
 * Error analysis result
 */
export interface ErrorAnalysis {
  /** Total errors in analysis period */
  totalErrors: number;
  /** Errors by category */
  byCategory: Record<string, number>;
  /** Errors by entity type */
  byEntityType: Record<string, number>;
  /** Errors by operation */
  byOperation: Record<string, number>;
  /** Top error messages (deduplicated) */
  topErrors: Array<{ message: string; count: number; example_id: string }>;
  /** HTTP status code distribution */
  httpStatusDistribution: Record<number, number>;
  /** Hourly error distribution (last 24h) */
  hourlyDistribution: Array<{ hour: string; count: number }>;
}

/**
 * Queue health assessment
 */
export interface QueueHealthAssessment {
  /** Overall health score (0-100) */
  healthScore: number;
  /** Health status */
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  /** Issues detected */
  issues: string[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Complete diagnostic export
 */
export interface DiagnosticExport {
  /** Export metadata */
  metadata: {
    exportedAt: string;
    appVersion: string;
    storeId: string;
    platform: string;
    config: DiagnosticExportConfig;
  };
  /** Current metrics snapshot */
  currentMetrics: SyncMetricsSnapshot | null;
  /** Queue health assessment */
  healthAssessment: QueueHealthAssessment;
  /** Error analysis */
  errorAnalysis: ErrorAnalysis | null;
  /** Queue snapshot (redacted) */
  queueSnapshot: {
    pending: RedactedQueueItem[];
    recentlySynced: RedactedQueueItem[];
    totalPending: number;
    totalSynced: number;
  } | null;
  /** DLQ items (redacted) */
  dlqItems: RedactedQueueItem[] | null;
  /** Metrics history */
  metricsHistory: MetricEvent[] | null;
  /** Active alerts */
  activeAlerts: SyncAlert[];
  /** Alert history */
  alertHistory: AlertHistoryEntry[] | null;
  /** Sync log entries */
  syncLogHistory: unknown[] | null;
}

// ============================================================================
// Constants
// ============================================================================

/** Default export configuration */
const DEFAULT_EXPORT_CONFIG: DiagnosticExportConfig = {
  includeQueueSnapshot: true,
  includeDLQ: true,
  includeMetricsHistory: true,
  includeAlertHistory: true,
  includeSyncLogHistory: true,
  includeErrorAnalysis: true,
  maxItemsPerCategory: 100,
  redactPayloads: true,
};

/** Fields to extract from payload for summary */
const SAFE_PAYLOAD_FIELDS = [
  'pack_number',
  'game_code',
  'status',
  'bin_id',
  'operation',
  'employee_id',
  'shift_id',
];

// ============================================================================
// Sync Diagnostics Service
// ============================================================================

/**
 * Sync Diagnostics Service
 *
 * Generates diagnostic exports for incident triage and support.
 */
export class SyncDiagnosticsService {
  // ==========================================================================
  // Export Generation
  // ==========================================================================

  /**
   * Generate complete diagnostic export
   *
   * @security API-008: Sensitive data redacted
   * @security DB-006: Store-scoped queries
   *
   * @param storeId - Store identifier
   * @param config - Export configuration
   * @returns Complete diagnostic export
   */
  generateExport(storeId: string, config: Partial<DiagnosticExportConfig> = {}): DiagnosticExport {
    const exportConfig = { ...DEFAULT_EXPORT_CONFIG, ...config };
    const startTime = Date.now();

    log.info('Generating diagnostic export', { storeId, config: exportConfig });

    // Collect current metrics
    const currentMetrics = syncMetricsService.collectMetrics(storeId);

    // Generate health assessment
    const healthAssessment = this.assessQueueHealth(storeId, currentMetrics);

    // Generate error analysis
    const errorAnalysis = exportConfig.includeErrorAnalysis
      ? this.analyzeErrors(storeId, exportConfig.maxItemsPerCategory)
      : null;

    // Get queue snapshot
    const queueSnapshot = exportConfig.includeQueueSnapshot
      ? this.getQueueSnapshot(storeId, exportConfig)
      : null;

    // Get DLQ items
    const dlqItems = exportConfig.includeDLQ ? this.getDLQItems(storeId, exportConfig) : null;

    // Get metrics history
    const metricsHistory = exportConfig.includeMetricsHistory
      ? syncMetricsService.getMetricHistory(exportConfig.maxItemsPerCategory)
      : null;

    // Get active alerts
    const activeAlerts = syncAlertsService.getActiveAlerts();

    // Get alert history
    const alertHistory = exportConfig.includeAlertHistory
      ? syncAlertsService.getAlertHistory(exportConfig.maxItemsPerCategory)
      : null;

    // Get sync log history
    const syncLogHistory = exportConfig.includeSyncLogHistory
      ? this.getSyncLogHistory(storeId, exportConfig.maxItemsPerCategory)
      : null;

    const export_data: DiagnosticExport = {
      metadata: {
        exportedAt: new Date().toISOString(),
        appVersion: app?.getVersion?.() || '1.0.0',
        storeId,
        platform: process.platform,
        config: exportConfig,
      },
      currentMetrics,
      healthAssessment,
      errorAnalysis,
      queueSnapshot,
      dlqItems,
      metricsHistory,
      activeAlerts,
      alertHistory,
      syncLogHistory,
    };

    const durationMs = Date.now() - startTime;
    log.info('Diagnostic export generated', { storeId, durationMs });

    return export_data;
  }

  /**
   * Export diagnostics to file
   */
  async exportToFile(storeId: string, outputPath?: string): Promise<string> {
    const export_data = this.generateExport(storeId);

    // Generate default path if not provided
    const finalPath = outputPath || this.getDefaultExportPath();

    // Ensure directory exists
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write export
    fs.writeFileSync(finalPath, JSON.stringify(export_data, null, 2), 'utf-8');

    log.info('Diagnostic export written to file', { path: finalPath });

    return finalPath;
  }

  /**
   * Get default export path
   */
  private getDefaultExportPath(): string {
    const userDataPath = app?.getPath?.('userData') || '.';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(userDataPath, 'diagnostics', `sync-diagnostic-${timestamp}.json`);
  }

  // ==========================================================================
  // Health Assessment
  // ==========================================================================

  /**
   * Assess queue health and generate recommendations
   */
  assessQueueHealth(storeId: string, metrics?: SyncMetricsSnapshot): QueueHealthAssessment {
    const snapshot = metrics || syncMetricsService.collectMetrics(storeId);
    const issues: string[] = [];
    const recommendations: string[] = [];
    let healthScore = 100;

    // Check queue depth
    if (snapshot.queueDepth.pending > 1000) {
      issues.push(`High queue depth: ${snapshot.queueDepth.pending} pending items`);
      recommendations.push('Check network connectivity and cloud API health');
      healthScore -= 20;
    } else if (snapshot.queueDepth.pending > 500) {
      issues.push(`Elevated queue depth: ${snapshot.queueDepth.pending} pending items`);
      healthScore -= 10;
    }

    // Check DLQ
    if (snapshot.queueDepth.deadLettered > 50) {
      issues.push(`Large DLQ backlog: ${snapshot.queueDepth.deadLettered} items`);
      recommendations.push('Review and resolve dead-lettered items');
      healthScore -= 15;
    } else if (snapshot.queueDepth.deadLettered > 10) {
      issues.push(`DLQ items present: ${snapshot.queueDepth.deadLettered} items`);
      healthScore -= 5;
    }

    // Check oldest item age
    if (snapshot.queueAge.oldestPendingAgeMs !== null) {
      const ageMinutes = snapshot.queueAge.oldestPendingAgeMs / 60000;
      if (ageMinutes > 30) {
        issues.push(`Stale items in queue: oldest is ${Math.round(ageMinutes)} minutes old`);
        recommendations.push('Check for stuck items or retry exhaustion');
        healthScore -= 20;
      } else if (ageMinutes > 10) {
        issues.push(`Items aging: oldest is ${Math.round(ageMinutes)} minutes old`);
        healthScore -= 10;
      }
    }

    // Check error rate
    if (snapshot.outcome.successRate < 0.9) {
      issues.push(
        `High error rate: ${Math.round((1 - snapshot.outcome.successRate) * 100)}% failures`
      );
      recommendations.push('Review error logs for common failure patterns');
      healthScore -= 20;
    } else if (snapshot.outcome.successRate < 0.95) {
      issues.push(
        `Elevated error rate: ${Math.round((1 - snapshot.outcome.successRate) * 100)}% failures`
      );
      healthScore -= 10;
    }

    // Check circuit breaker
    if (snapshot.circuitBreaker.state === 'OPEN') {
      issues.push('Circuit breaker is OPEN - sync operations paused');
      recommendations.push('Wait for circuit to recover or check cloud service health');
      healthScore -= 30;
    } else if (snapshot.circuitBreaker.state === 'HALF_OPEN') {
      issues.push('Circuit breaker is testing recovery');
      healthScore -= 10;
    }

    // Check SLO compliance
    if (!snapshot.slo.overallCompliant) {
      issues.push('SLO targets not being met');
      if (!snapshot.slo.p99TargetMet) {
        recommendations.push('Investigate latency issues');
      }
      if (!snapshot.slo.queueDepthTargetMet) {
        recommendations.push('Scale sync processing or reduce load');
      }
      if (!snapshot.slo.errorRateTargetMet) {
        recommendations.push('Address root cause of errors');
      }
      healthScore -= 15;
    }

    // Check backoff items
    if (snapshot.queueDepth.inBackoff > snapshot.queueDepth.pending * 0.5) {
      issues.push(`Many items in backoff: ${snapshot.queueDepth.inBackoff} items waiting`);
      recommendations.push('Check if retries are succeeding or if there are systemic issues');
      healthScore -= 10;
    }

    // Clamp score
    healthScore = Math.max(0, healthScore);

    // Determine status
    let status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
    if (healthScore >= 80) {
      status = 'HEALTHY';
    } else if (healthScore >= 50) {
      status = 'DEGRADED';
    } else {
      status = 'CRITICAL';
    }

    return {
      healthScore,
      status,
      issues,
      recommendations,
    };
  }

  // ==========================================================================
  // Error Analysis
  // ==========================================================================

  /**
   * Analyze errors in the sync queue
   */
  analyzeErrors(storeId: string, limit: number): ErrorAnalysis {
    // Get failed items
    const failedItems = syncQueueDAL.getFailedItems(storeId, limit);

    const byCategory: Record<string, number> = {};
    const byEntityType: Record<string, number> = {};
    const byOperation: Record<string, number> = {};
    const errorCounts: Map<string, { count: number; example_id: string }> = new Map();
    const httpStatusDistribution: Record<number, number> = {};
    const hourlyMap: Map<string, number> = new Map();

    for (const item of failedItems) {
      // By category
      const cat = item.error_category || 'UNKNOWN';
      byCategory[cat] = (byCategory[cat] || 0) + 1;

      // By entity type
      byEntityType[item.entity_type] = (byEntityType[item.entity_type] || 0) + 1;

      // By operation
      byOperation[item.operation] = (byOperation[item.operation] || 0) + 1;

      // Error message tracking
      if (item.last_sync_error) {
        const normalized = this.normalizeErrorMessage(item.last_sync_error);
        const existing = errorCounts.get(normalized);
        if (existing) {
          existing.count++;
        } else {
          errorCounts.set(normalized, { count: 1, example_id: item.id });
        }
      }

      // HTTP status distribution
      if (item.http_status) {
        httpStatusDistribution[item.http_status] =
          (httpStatusDistribution[item.http_status] || 0) + 1;
      }

      // Hourly distribution
      if (item.last_attempt_at) {
        const hour = item.last_attempt_at.substring(0, 13); // YYYY-MM-DDTHH
        hourlyMap.set(hour, (hourlyMap.get(hour) || 0) + 1);
      }
    }

    // Sort top errors by count
    const topErrors = Array.from(errorCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([message, data]) => ({ message, ...data }));

    // Format hourly distribution
    const hourlyDistribution = Array.from(hourlyMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([hour, count]) => ({ hour, count }));

    return {
      totalErrors: failedItems.length,
      byCategory,
      byEntityType,
      byOperation,
      topErrors,
      httpStatusDistribution,
      hourlyDistribution,
    };
  }

  /**
   * Normalize error message for grouping
   */
  private normalizeErrorMessage(message: string): string {
    // Remove variable parts like IDs, timestamps, etc.
    return message
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '<TIMESTAMP>')
      .replace(/\d+/g, '<N>')
      .substring(0, 200); // Limit length
  }

  // ==========================================================================
  // Queue Snapshot
  // ==========================================================================

  /**
   * Get queue snapshot with redacted items
   */
  private getQueueSnapshot(
    storeId: string,
    config: DiagnosticExportConfig
  ): DiagnosticExport['queueSnapshot'] {
    const pendingItems = syncQueueDAL.getQueuedItemsForActivity(
      storeId,
      config.maxItemsPerCategory
    );
    const recentlySynced = syncQueueDAL.getRecentlySyncedForActivity(
      storeId,
      config.maxItemsPerCategory
    );
    const stats = syncQueueDAL.getStats(storeId);

    return {
      pending: this.redactItems(pendingItems as unknown as SyncQueueItem[], config.redactPayloads),
      recentlySynced: this.redactItems(
        recentlySynced as unknown as SyncQueueItem[],
        config.redactPayloads
      ),
      totalPending: stats.pending,
      totalSynced: stats.syncedToday,
    };
  }

  /**
   * Get DLQ items with redaction
   */
  private getDLQItems(storeId: string, config: DiagnosticExportConfig): RedactedQueueItem[] {
    // getDeadLetteredItems returns DeadLetterListResponse with .items array
    const response = syncQueueDAL.getDeadLetterItems(storeId, config.maxItemsPerCategory);
    return this.redactDLQItems(response.items);
  }

  /**
   * Redact queue items for export
   */
  private redactItems(items: SyncQueueItem[], redactPayloads: boolean): RedactedQueueItem[] {
    return items.map((item) => ({
      id: item.id,
      entity_type: item.entity_type,
      entity_id: item.entity_id,
      operation: item.operation,
      priority: item.priority,
      synced: item.synced === 1,
      sync_attempts: item.sync_attempts,
      max_attempts: item.max_attempts,
      last_sync_error: item.last_sync_error,
      last_attempt_at: item.last_attempt_at,
      created_at: item.created_at,
      synced_at: item.synced_at,
      sync_direction: item.sync_direction,
      api_endpoint: item.api_endpoint,
      http_status: item.http_status,
      dead_lettered: item.dead_lettered === 1,
      dead_letter_reason: item.dead_letter_reason,
      dead_lettered_at: item.dead_lettered_at,
      error_category: item.error_category,
      retry_after: item.retry_after,
      payload_summary: redactPayloads
        ? this.extractPayloadSummary(item.payload)
        : { redacted: false, size: item.payload?.length || 0 },
    }));
  }

  /**
   * Redact DLQ items for export
   * DeadLetterItem has different structure than SyncQueueItem
   */
  private redactDLQItems(items: DeadLetterItem[]): RedactedQueueItem[] {
    return items.map((item) => ({
      id: item.id,
      entity_type: item.entity_type,
      entity_id: item.entity_id,
      operation: item.operation,
      priority: 0, // DLQ items don't have priority
      synced: false,
      sync_attempts: item.sync_attempts,
      max_attempts: item.max_attempts,
      last_sync_error: item.last_sync_error,
      last_attempt_at: null, // Not in DeadLetterItem
      created_at: item.created_at,
      synced_at: null,
      sync_direction: 'PUSH', // DLQ items are typically PUSH
      api_endpoint: item.api_endpoint,
      http_status: item.http_status,
      dead_lettered: true,
      dead_letter_reason: item.dead_letter_reason,
      dead_lettered_at: item.dead_lettered_at,
      error_category: item.error_category,
      retry_after: null,
      // DeadLetterItem already has a pre-computed summary
      payload_summary: item.summary || { empty: true },
    }));
  }

  /**
   * Extract safe summary from payload
   */
  private extractPayloadSummary(payloadStr: string): Record<string, unknown> {
    if (!payloadStr) return { empty: true };

    try {
      const payload = JSON.parse(payloadStr);
      const summary: Record<string, unknown> = {};

      for (const field of SAFE_PAYLOAD_FIELDS) {
        if (field in payload) {
          summary[field] = payload[field];
        }
      }

      // Add size info
      summary._payload_size = payloadStr.length;
      summary._field_count = Object.keys(payload).length;

      return summary;
    } catch {
      return { parse_error: true, size: payloadStr.length };
    }
  }

  // ==========================================================================
  // Sync Log History
  // ==========================================================================

  /**
   * Get sync log history
   */
  private getSyncLogHistory(storeId: string, limit: number): unknown[] {
    try {
      const logs = syncLogDAL.getRecentLogs(storeId, limit);
      return logs;
    } catch {
      return [];
    }
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Generate quick health check (no file export)
   */
  quickHealthCheck(storeId: string): QueueHealthAssessment {
    return this.assessQueueHealth(storeId);
  }

  /**
   * Get export summary (metadata only, no sensitive data)
   */
  getExportSummary(storeId: string): {
    status: string;
    pendingCount: number;
    dlqCount: number;
    activeAlerts: number;
    healthScore: number;
  } {
    const stats = syncQueueDAL.getStats(storeId);
    const dlqCount = syncQueueDAL.getDeadLetterCount(storeId);
    const alerts = syncAlertsService.getActiveAlerts();
    const health = this.quickHealthCheck(storeId);

    return {
      status: health.status,
      pendingCount: stats.pending,
      dlqCount,
      activeAlerts: alerts.length,
      healthScore: health.healthScore,
    };
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/** Singleton instance of SyncDiagnosticsService */
export const syncDiagnosticsService = new SyncDiagnosticsService();
