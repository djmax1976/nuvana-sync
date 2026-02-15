/**
 * Observability IPC Handlers
 *
 * IPC handlers for sync observability, metrics, alerts, and diagnostics.
 * Implements Phase 6 (D6.4) of SYNC-5000: Observability, SLOs, and Operational Controls.
 *
 * @module main/ipc/observability.handlers
 * @security API-008: Only non-sensitive metrics exposed
 * @security DB-006: Store-scoped queries for tenant isolation
 * @security SEC-006: Parameterized queries via DAL
 * @security LM-002: Structured metrics for monitoring
 */

import { z } from 'zod';
import {
  registerHandler,
  createSuccessResponse,
  createErrorResponse,
  IPCErrorCodes,
} from './index';
import { storesDAL } from '../dal/stores.dal';
import { syncMetricsService, type SLOConfig } from '../services/sync-metrics.service';
import { syncAlertsService, type AlertThresholds } from '../services/sync-alerts.service';
import {
  syncDiagnosticsService,
  type DiagnosticExportConfig,
} from '../services/sync-diagnostics.service';
import { createLogger } from '../utils/logger';

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('observability-handlers');

// ============================================================================
// Input Validation Schemas (API-001)
// ============================================================================

/**
 * Schema for metrics history limit
 */
const MetricsHistoryParamsSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional().default(100),
});

/**
 * Schema for SLO config update
 */
const SLOConfigUpdateSchema = z.object({
  p99LatencyTargetMs: z.number().int().min(1000).max(300000).optional(),
  queueDepthTarget: z.number().int().min(10).max(100000).optional(),
  errorRateTarget: z.number().min(0.001).max(0.5).optional(),
});

/**
 * Schema for alert thresholds update
 */
const AlertThresholdsUpdateSchema = z.object({
  queueDepthWarning: z.number().int().min(1).max(50000).optional(),
  queueDepthCritical: z.number().int().min(1).max(100000).optional(),
  queueAgeWarningMs: z.number().int().min(60000).max(3600000).optional(),
  queueAgeCriticalMs: z.number().int().min(60000).max(7200000).optional(),
  errorRateWarning: z.number().min(0.01).max(0.5).optional(),
  errorRateCritical: z.number().min(0.01).max(0.9).optional(),
  dlqCountWarning: z.number().int().min(1).max(1000).optional(),
  dlqCountCritical: z.number().int().min(1).max(10000).optional(),
  throughputDegradedPercent: z.number().int().min(10).max(90).optional(),
  syncStalledMinutes: z.number().int().min(1).max(60).optional(),
});

/**
 * Schema for alert acknowledgement
 */
const AlertAcknowledgeSchema = z.object({
  alertId: z.string().min(1).max(100),
});

/**
 * Schema for diagnostic export config
 */
const DiagnosticExportConfigSchema = z.object({
  includeQueueSnapshot: z.boolean().optional(),
  includeDLQ: z.boolean().optional(),
  includeMetricsHistory: z.boolean().optional(),
  includeAlertHistory: z.boolean().optional(),
  includeSyncLogHistory: z.boolean().optional(),
  includeErrorAnalysis: z.boolean().optional(),
  maxItemsPerCategory: z.number().int().min(10).max(1000).optional(),
  redactPayloads: z.boolean().optional(),
});

/**
 * Schema for alert history limit
 */
const AlertHistoryParamsSchema = z.object({
  limit: z.number().int().min(1).max(500).optional().default(100),
});

// ============================================================================
// Metrics Handlers
// ============================================================================

/**
 * Get current sync metrics snapshot
 *
 * @security API-008: Only non-sensitive metrics exposed
 * @security DB-006: Store-scoped queries
 */
registerHandler(
  'sync:getMetrics',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const metrics = syncMetricsService.collectMetrics(store.store_id);

    return createSuccessResponse({
      metrics,
      isCollecting: syncMetricsService.isCollecting(),
    });
  },
  { requiresAuth: false, description: 'Get current sync metrics snapshot' }
);

/**
 * Get metrics history
 *
 * @security API-008: Only non-sensitive metrics exposed
 */
registerHandler(
  'sync:getMetricsHistory',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = MetricsHistoryParamsSchema.safeParse(input || {});
    if (!parseResult.success) {
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        `Invalid parameters: ${parseResult.error.message}`
      );
    }

    const { limit } = parseResult.data;
    const history = syncMetricsService.getMetricHistory(limit);

    return createSuccessResponse({ history, count: history.length });
  },
  { requiresAuth: false, description: 'Get metrics history' }
);

/**
 * Get SLO configuration
 */
registerHandler(
  'sync:getSLOConfig',
  async () => {
    const config = syncMetricsService.getSLOConfig();
    return createSuccessResponse(config);
  },
  { requiresAuth: false, description: 'Get SLO configuration' }
);

/**
 * Update SLO configuration
 *
 * @security API-001: Input validated with bounds
 */
registerHandler(
  'sync:updateSLOConfig',
  async (_event, input: unknown) => {
    const parseResult = SLOConfigUpdateSchema.safeParse(input);
    if (!parseResult.success) {
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        `Invalid parameters: ${parseResult.error.message}`
      );
    }

    syncMetricsService.updateSLOConfig(parseResult.data as Partial<SLOConfig>);
    const newConfig = syncMetricsService.getSLOConfig();

    log.info('SLO config updated via IPC', { config: newConfig });

    return createSuccessResponse({ config: newConfig, updated: true });
  },
  { requiresAuth: true, requiredRole: 'shift_manager', description: 'Update SLO configuration' }
);

/**
 * Start periodic metrics collection
 */
registerHandler(
  'sync:startMetricsCollection',
  async (_event, input: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const params = input as { intervalMs?: number } | undefined;
    const intervalMs = params?.intervalMs || 60000;

    syncMetricsService.startPeriodicCollection(store.store_id, intervalMs);

    return createSuccessResponse({ started: true, intervalMs });
  },
  { requiresAuth: false, description: 'Start periodic metrics collection' }
);

/**
 * Stop periodic metrics collection
 */
registerHandler(
  'sync:stopMetricsCollection',
  async () => {
    syncMetricsService.stopPeriodicCollection();
    return createSuccessResponse({ stopped: true });
  },
  { requiresAuth: false, description: 'Stop periodic metrics collection' }
);

// ============================================================================
// Alert Handlers
// ============================================================================

/**
 * Get active alerts and summary
 *
 * @security API-008: Only non-sensitive alert data exposed
 */
registerHandler(
  'sync:getAlerts',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // Collect fresh metrics and evaluate alerts
    const metrics = syncMetricsService.collectMetrics(store.store_id);
    syncAlertsService.evaluateMetrics(metrics);

    const summary = syncAlertsService.getAlertSummary();

    return createSuccessResponse(summary);
  },
  { requiresAuth: false, description: 'Get active alerts and summary' }
);

/**
 * Get alert history
 */
registerHandler(
  'sync:getAlertHistory',
  async (_event, input: unknown) => {
    const parseResult = AlertHistoryParamsSchema.safeParse(input || {});
    if (!parseResult.success) {
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        `Invalid parameters: ${parseResult.error.message}`
      );
    }

    const { limit } = parseResult.data;
    const history = syncAlertsService.getAlertHistory(limit);

    return createSuccessResponse({ history, count: history.length });
  },
  { requiresAuth: false, description: 'Get alert history' }
);

/**
 * Acknowledge an alert
 */
registerHandler(
  'sync:acknowledgeAlert',
  async (_event, input: unknown) => {
    const parseResult = AlertAcknowledgeSchema.safeParse(input);
    if (!parseResult.success) {
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        `Invalid parameters: ${parseResult.error.message}`
      );
    }

    const { alertId } = parseResult.data;
    const acknowledged = syncAlertsService.acknowledgeAlert(alertId);

    if (!acknowledged) {
      return createErrorResponse(IPCErrorCodes.NOT_FOUND, `Alert ${alertId} not found`);
    }

    log.info('Alert acknowledged', { alertId });

    return createSuccessResponse({ acknowledged: true, alertId });
  },
  { requiresAuth: true, description: 'Acknowledge an alert' }
);

/**
 * Resolve an alert manually
 */
registerHandler(
  'sync:resolveAlert',
  async (_event, input: unknown) => {
    const parseResult = AlertAcknowledgeSchema.safeParse(input);
    if (!parseResult.success) {
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        `Invalid parameters: ${parseResult.error.message}`
      );
    }

    const { alertId } = parseResult.data;
    const resolved = syncAlertsService.resolveAlert(alertId);

    if (!resolved) {
      return createErrorResponse(IPCErrorCodes.NOT_FOUND, `Alert ${alertId} not found`);
    }

    log.info('Alert resolved manually', { alertId });

    return createSuccessResponse({ resolved: true, alertId });
  },
  { requiresAuth: true, requiredRole: 'shift_manager', description: 'Resolve an alert manually' }
);

/**
 * Get alert thresholds configuration
 */
registerHandler(
  'sync:getAlertThresholds',
  async () => {
    const thresholds = syncAlertsService.getThresholds();
    return createSuccessResponse(thresholds);
  },
  { requiresAuth: false, description: 'Get alert thresholds' }
);

/**
 * Update alert thresholds
 *
 * @security API-001: Input validated with bounds
 */
registerHandler(
  'sync:updateAlertThresholds',
  async (_event, input: unknown) => {
    const parseResult = AlertThresholdsUpdateSchema.safeParse(input);
    if (!parseResult.success) {
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        `Invalid parameters: ${parseResult.error.message}`
      );
    }

    syncAlertsService.updateThresholds(parseResult.data as Partial<AlertThresholds>);
    const newThresholds = syncAlertsService.getThresholds();

    log.info('Alert thresholds updated via IPC', { thresholds: newThresholds });

    return createSuccessResponse({ thresholds: newThresholds, updated: true });
  },
  { requiresAuth: true, requiredRole: 'shift_manager', description: 'Update alert thresholds' }
);

/**
 * Clear all active alerts
 */
registerHandler(
  'sync:clearAllAlerts',
  async () => {
    syncAlertsService.clearAllAlerts();

    log.warn('All alerts cleared via IPC');

    return createSuccessResponse({ cleared: true });
  },
  { requiresAuth: true, requiredRole: 'store_manager', description: 'Clear all active alerts' }
);

// ============================================================================
// Diagnostics Handlers
// ============================================================================

/**
 * Get sync health assessment
 *
 * @security API-008: Only non-sensitive health data exposed
 */
registerHandler(
  'sync:getHealth',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const health = syncDiagnosticsService.quickHealthCheck(store.store_id);
    const summary = syncDiagnosticsService.getExportSummary(store.store_id);

    return createSuccessResponse({ health, summary });
  },
  { requiresAuth: false, description: 'Get sync health assessment' }
);

/**
 * Generate diagnostic export
 *
 * @security API-008: Payloads redacted by default
 * @security DB-006: Store-scoped queries
 */
registerHandler(
  'sync:exportDiagnostics',
  async (_event, input: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // Parse optional config
    let config: Partial<DiagnosticExportConfig> = {};
    if (input) {
      const parseResult = DiagnosticExportConfigSchema.safeParse(input);
      if (!parseResult.success) {
        return createErrorResponse(
          IPCErrorCodes.VALIDATION_ERROR,
          `Invalid parameters: ${parseResult.error.message}`
        );
      }
      config = parseResult.data;
    }

    const diagnostic = syncDiagnosticsService.generateExport(store.store_id, config);

    log.info('Diagnostic export generated', {
      storeId: store.store_id,
      healthScore: diagnostic.healthAssessment.healthScore,
    });

    return createSuccessResponse(diagnostic);
  },
  { requiresAuth: false, description: 'Generate diagnostic export' }
);

/**
 * Export diagnostics to file
 */
registerHandler(
  'sync:exportDiagnosticsToFile',
  async (_event, input: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const params = input as { outputPath?: string } | undefined;

    try {
      const filePath = await syncDiagnosticsService.exportToFile(
        store.store_id,
        params?.outputPath
      );

      log.info('Diagnostic export written to file', { filePath });

      return createSuccessResponse({ success: true, filePath });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Failed to export diagnostics to file', { error: message });
      return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, `Export failed: ${message}`);
    }
  },
  { requiresAuth: true, description: 'Export diagnostics to file' }
);

/**
 * Get error analysis
 *
 * @security API-008: Only aggregated error data exposed
 */
registerHandler(
  'sync:getErrorAnalysis',
  async (_event, input: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const params = input as { limit?: number } | undefined;
    const limit = Math.min(Math.max(10, params?.limit || 100), 500);

    const analysis = syncDiagnosticsService.generateExport(store.store_id, {
      includeErrorAnalysis: true,
      includeQueueSnapshot: false,
      includeDLQ: false,
      includeMetricsHistory: false,
      includeAlertHistory: false,
      includeSyncLogHistory: false,
      maxItemsPerCategory: limit,
      redactPayloads: true,
    });

    return createSuccessResponse({
      errorAnalysis: analysis.errorAnalysis,
      healthAssessment: analysis.healthAssessment,
    });
  },
  { requiresAuth: false, description: 'Get error analysis' }
);

// ============================================================================
// SLO Dashboard Handlers (D6.4)
// ============================================================================

/**
 * Get SLO dashboard data (non-sensitive)
 *
 * @security API-008: Only SLO indicators exposed, no sensitive business data
 */
registerHandler(
  'sync:getSLODashboard',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const metrics = syncMetricsService.collectMetrics(store.store_id);
    const alerts = syncAlertsService.getAlertSummary(10);
    const health = syncDiagnosticsService.quickHealthCheck(store.store_id);

    // Build SLO dashboard data
    const dashboard = {
      // Overall status
      status: health.status,
      healthScore: health.healthScore,

      // SLO compliance
      slo: {
        compliant: metrics.slo.overallCompliant,
        compliance24h: metrics.slo.compliancePercentage24h,
        p99Latency: {
          current: metrics.slo.currentP99LatencyMs,
          target: metrics.slo.p99LatencyTargetMs,
          met: metrics.slo.p99TargetMet,
        },
        queueDepth: {
          current: metrics.queueDepth.pending,
          target: metrics.slo.queueDepthTarget,
          met: metrics.slo.queueDepthTargetMet,
        },
        errorRate: {
          current: Math.round((1 - metrics.outcome.successRate) * 10000) / 100, // percentage
          target: Math.round(metrics.slo.errorRateTarget * 10000) / 100,
          met: metrics.slo.errorRateTargetMet,
        },
      },

      // Key indicators
      indicators: {
        pendingItems: metrics.queueDepth.pending,
        inBackoff: metrics.queueDepth.inBackoff,
        deadLettered: metrics.queueDepth.deadLettered,
        oldestItemAgeMs: metrics.queueAge.oldestPendingAgeMs,
        syncedToday: metrics.throughput.syncedToday,
        throughputPerMinute: metrics.throughput.itemsPerMinute,
        processingState: metrics.throughput.processingState,
      },

      // Circuit breaker
      circuitBreaker: {
        state: metrics.circuitBreaker.state,
        totalTrips: metrics.circuitBreaker.totalTrips,
      },

      // Alerts summary
      alerts: {
        critical: alerts.bySeverity.CRITICAL,
        warning: alerts.bySeverity.WARNING,
        info: alerts.bySeverity.INFO,
        totalActive: alerts.totalActive,
      },

      // Issues and recommendations
      issues: health.issues,
      recommendations: health.recommendations,

      // Timestamp
      timestamp: metrics.timestamp,
    };

    return createSuccessResponse(dashboard);
  },
  { requiresAuth: false, description: 'Get SLO dashboard data' }
);

// ============================================================================
// Export Handler Registration
// ============================================================================

log.info('Observability handlers registered');
