/**
 * Sync Status Indicator Component
 *
 * Enterprise-grade status indicator for the application status bar.
 * Displays real-time sync status with color-coded visual feedback.
 *
 * @module renderer/components/layout/SyncStatusIndicator
 * @security SEC-004: XSS prevention via React's automatic escaping
 * @security FE-005: No sensitive data exposed in DOM
 * @security FE-001: No tokens or secrets in component state
 * @security API-008: Only whitelisted status fields displayed
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { Button } from '../ui/button';
import { RefreshCw, AlertCircle, X } from 'lucide-react';

// ============================================================================
// Types - SEC-014: Strict type definitions
// ============================================================================

/**
 * Sync progress data for real-time feedback
 */
interface SyncProgress {
  totalItems: number;
  completedItems: number;
  succeededItems: number;
  failedItems: number;
  currentEntityType: string | null;
  recentErrors: Array<{ entityType: string; error: string; timestamp: string }>;
}

/**
 * Sync status data from the sync engine
 * API-008: Only safe, non-sensitive fields exposed to UI
 */
interface SyncStatusData {
  isRunning: boolean;
  isStarted: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: 'success' | 'partial' | 'failed' | null;
  /** Total pending items (queued + failed) - for backward compatibility */
  pendingCount: number;
  /** Items still being retried (sync_attempts < max_attempts) */
  queuedCount: number;
  /** Number of items successfully synced today */
  syncedTodayCount: number;
  /** Number of permanently failed items (exceeded max retries) */
  failedCount: number;
  nextSyncIn: number;
  isOnline: boolean;
  lastHeartbeatStatus: 'ok' | 'suspended' | 'revoked' | 'failed' | null;
  lastErrorMessage: string | null;
  consecutiveFailures: number;
  progress: SyncProgress | null;
}

/**
 * IPC response wrapper
 * API-003: Standardized error response format
 */
interface IPCResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Visual status states for the indicator
 */
type IndicatorState =
  | 'connected'
  | 'syncing'
  | 'error'
  | 'partial'
  | 'offline'
  | 'paused'
  | 'suspended';

export interface SyncStatusIndicatorProps {
  /** Additional CSS classes */
  className?: string;
  /** Show detailed tooltip on hover */
  showTooltip?: boolean;
  /** Compact mode - icon only */
  compact?: boolean;
}

// ============================================================================
// Constants - Design tokens
// ============================================================================

/**
 * Status configuration mapping
 * Each state has: color, label, description, and CSS classes
 */
/**
 * Get dynamic label for syncing state based on progress
 * Only used when state is 'syncing' - shows progress feedback
 */
function getSyncingLabel(progress: SyncProgress | null): string {
  // When actively syncing with progress data, show X/Y progress
  if (progress && progress.totalItems > 0) {
    return `Syncing ${progress.completedItems}/${progress.totalItems}`;
  }
  // No progress data yet, just show "Syncing..."
  return 'Syncing...';
}

const STATUS_CONFIG: Record<
  IndicatorState,
  {
    dotClass: string;
    label: string;
    description: string;
    ariaLabel: string;
  }
> = {
  connected: {
    dotClass: 'bg-green-500',
    label: 'Sync Status',
    description: 'Connected and synced',
    ariaLabel: 'Sync status: Connected and working normally',
  },
  syncing: {
    dotClass: 'bg-yellow-500 animate-pulse',
    label: 'Syncing...', // This will be overridden dynamically
    description: 'Synchronizing data with cloud',
    ariaLabel: 'Sync status: Currently syncing data',
  },
  error: {
    dotClass: 'bg-red-500',
    label: 'Sync Error',
    description: 'Failed to sync with cloud',
    ariaLabel: 'Sync status: Error occurred during sync',
  },
  partial: {
    dotClass: 'bg-orange-500',
    label: 'Partial Sync',
    description: 'Some items failed to sync',
    ariaLabel: 'Sync status: Partial sync completed with some failures',
  },
  offline: {
    dotClass: 'bg-gray-400',
    label: 'Offline',
    description: 'No connection to cloud',
    ariaLabel: 'Sync status: Currently offline',
  },
  paused: {
    dotClass: 'bg-gray-400',
    label: 'Paused',
    description: 'Sync engine is stopped',
    ariaLabel: 'Sync status: Sync engine is paused',
  },
  suspended: {
    dotClass: 'bg-amber-500',
    label: 'Suspended',
    description: 'License suspended',
    ariaLabel: 'Sync status: License suspended',
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Runtime type guard for SyncStatusData
 * SEC-014: Validates IPC data structure before use
 * Prevents malformed data from being processed
 */
function isSyncStatusData(data: unknown): data is SyncStatusData {
  if (!data || typeof data !== 'object') return false;

  const obj = data as Record<string, unknown>;

  // Required boolean fields
  if (typeof obj.isRunning !== 'boolean') return false;
  if (typeof obj.isStarted !== 'boolean') return false;
  if (typeof obj.isOnline !== 'boolean') return false;

  // Required number fields
  if (typeof obj.pendingCount !== 'number' || !Number.isFinite(obj.pendingCount)) return false;
  if (typeof obj.nextSyncIn !== 'number' || !Number.isFinite(obj.nextSyncIn)) return false;
  // Optional fields with backward compatibility (default to 0 if missing)
  if (
    obj.queuedCount !== undefined &&
    (typeof obj.queuedCount !== 'number' || !Number.isFinite(obj.queuedCount))
  )
    return false;
  if (
    obj.syncedTodayCount !== undefined &&
    (typeof obj.syncedTodayCount !== 'number' || !Number.isFinite(obj.syncedTodayCount))
  )
    return false;
  if (
    obj.failedCount !== undefined &&
    (typeof obj.failedCount !== 'number' || !Number.isFinite(obj.failedCount))
  )
    return false;

  // Nullable string field
  if (obj.lastSyncAt !== null && typeof obj.lastSyncAt !== 'string') return false;

  // Enum fields with null allowed
  const validSyncStatuses = ['success', 'partial', 'failed', null];
  if (!validSyncStatuses.includes(obj.lastSyncStatus as string | null)) return false;

  const validHeartbeatStatuses = ['ok', 'suspended', 'revoked', 'failed', null];
  if (!validHeartbeatStatuses.includes(obj.lastHeartbeatStatus as string | null)) return false;

  // Progress field is optional (can be null)
  // Just validate it exists as object or null
  if (obj.progress !== null && obj.progress !== undefined && typeof obj.progress !== 'object')
    return false;

  return true;
}

/**
 * Determine indicator state from sync status data
 * Pure function for testability
 */
function getIndicatorState(status: SyncStatusData | null): IndicatorState {
  if (!status) return 'offline';

  // Check license status first (highest priority)
  if (status.lastHeartbeatStatus === 'suspended' || status.lastHeartbeatStatus === 'revoked') {
    return 'suspended';
  }

  // Check if engine is stopped
  if (!status.isStarted) {
    return 'paused';
  }

  // Check online status
  if (!status.isOnline) {
    return 'offline';
  }

  // Check if currently syncing
  if (status.isRunning) {
    return 'syncing';
  }

  // Check last sync status
  switch (status.lastSyncStatus) {
    case 'success':
      return 'connected';
    case 'partial':
      return 'partial';
    case 'failed':
      return 'error';
    default:
      return 'connected'; // Default to connected if online and started
  }
}

/**
 * Format last sync time as compact date and time
 * SEC-004: No user input, safe string formatting
 * Returns format: "MM/DD HH:MM" for same year, "MM/DD/YY HH:MM" for different year
 */
function formatLastSyncTime(isoString: string | null): string {
  if (!isoString) return 'Never';

  const date = new Date(isoString);
  // Validate date to prevent invalid date display
  if (isNaN(date.getTime())) return 'Unknown';

  const now = new Date();
  const isCurrentYear = date.getFullYear() === now.getFullYear();

  // Format time as HH:MM (24-hour format for compactness)
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;

  // Format date compactly
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');

  if (isCurrentYear) {
    // Same year: "MM/DD HH:MM"
    return `${month}/${day} ${timeStr}`;
  } else {
    // Different year: "MM/DD/YY HH:MM"
    const year = date.getFullYear().toString().slice(-2);
    return `${month}/${day}/${year} ${timeStr}`;
  }
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Status dot indicator
 * Memoized for performance
 */
const StatusDot = memo(function StatusDot({
  state,
  className,
}: {
  state: IndicatorState;
  className?: string;
}) {
  const config = STATUS_CONFIG[state];
  return (
    <span
      className={cn(
        'inline-block h-2.5 w-2.5 rounded-full flex-shrink-0',
        config.dotClass,
        className
      )}
      aria-hidden="true"
    />
  );
});

/**
 * Tooltip content with detailed status
 * SEC-004: All content uses React's automatic escaping
 * FE-005: No sensitive data (API keys, tokens) displayed
 */
const TooltipDetails = memo(function TooltipDetails({
  status,
  state,
  error,
  onRetry,
  onDismiss,
  isRetrying,
}: {
  status: SyncStatusData | null;
  state: IndicatorState;
  error: string | null;
  onRetry: () => void;
  onDismiss: () => void;
  isRetrying: boolean;
}) {
  const config = STATUS_CONFIG[state];
  const progress = status?.progress;

  // Get dynamic label for syncing state only
  const displayLabel = state === 'syncing' ? getSyncingLabel(progress ?? null) : config.label;

  return (
    <div className="space-y-2 min-w-[220px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusDot state={state} />
          <span className="font-medium text-sm">{displayLabel}</span>
        </div>
        {(state === 'error' || state === 'partial') && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={onDismiss}
            aria-label="Dismiss error"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground">{config.description}</p>

      {/* Progress bar when syncing */}
      {state === 'syncing' && progress && progress.totalItems > 0 && (
        <div className="space-y-1">
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-yellow-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${(progress.completedItems / progress.totalItems) * 100}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {progress.succeededItems} synced
              {progress.failedItems > 0 && (
                <span className="text-destructive"> · {progress.failedItems} failed</span>
              )}
            </span>
            {progress.currentEntityType && (
              <span className="text-muted-foreground/70">{progress.currentEntityType}</span>
            )}
          </div>
        </div>
      )}

      {/* Status details - API-008: Clear, accurate labels for mutually exclusive counts */}
      {status && (
        <div className="text-xs space-y-1 border-t pt-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Last sync:</span>
            <span>{formatLastSyncTime(status.lastSyncAt)}</span>
          </div>
          {/* Show synced today count */}
          {(status.syncedTodayCount ?? 0) > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Synced today:</span>
              <span className="text-green-600">{status.syncedTodayCount} items</span>
            </div>
          )}
          {/* Show queued count - items still being retried */}
          {(status.queuedCount ?? 0) > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Queued (retrying):</span>
              <span className="text-yellow-600">{status.queuedCount} items</span>
            </div>
          )}
          {/* Show failed count - items that exceeded max retries (permanent failures) */}
          {(status.failedCount ?? 0) > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Failed (max retries):</span>
              <span className="text-destructive">{status.failedCount} item(s)</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Connection:</span>
            <span>{status.isOnline ? 'Online' : 'Offline'}</span>
          </div>
          {status.consecutiveFailures > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Consecutive failures:</span>
              <span className="text-destructive">{status.consecutiveFailures}</span>
            </div>
          )}
        </div>
      )}

      {/* Error message - sanitized via React escaping */}
      {error && (state === 'error' || state === 'partial') && (
        <div className="flex items-start gap-2 p-2 bg-destructive/10 rounded text-xs">
          <AlertCircle className="h-3 w-3 text-destructive flex-shrink-0 mt-0.5" />
          <span className="text-destructive">{error}</span>
        </div>
      )}

      {/* Recent sync errors list */}
      {progress?.recentErrors && progress.recentErrors.length > 0 && (
        <div className="space-y-1 border-t pt-2">
          <span className="text-xs font-medium text-destructive">Recent errors:</span>
          <div className="max-h-24 overflow-y-auto space-y-1">
            {progress.recentErrors.slice(0, 3).map((err, idx) => (
              <div key={idx} className="flex items-start gap-1 text-xs">
                <span className="text-muted-foreground">{err.entityType}:</span>
                <span className="text-destructive truncate">{err.error}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Retry button for error states */}
      {(state === 'error' || state === 'partial' || state === 'offline') && status?.isStarted && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={isRetrying || status.isRunning}
          className="w-full text-xs h-7"
        >
          <RefreshCw className={cn('h-3 w-3 mr-1', isRetrying && 'animate-spin')} />
          {isRetrying ? 'Retrying...' : 'Retry Now'}
        </Button>
      )}
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

/**
 * SyncStatusIndicator Component
 *
 * Enterprise-grade sync status indicator for the application status bar.
 *
 * Features:
 * - Real-time status updates via IPC subscription
 * - Color-coded visual indicator (green/yellow/red/gray)
 * - Accessible with ARIA labels and keyboard navigation
 * - Tooltip with detailed status and retry capability
 * - Memoized for performance
 *
 * Security Compliance:
 * - SEC-004: XSS prevention via React's automatic escaping
 * - FE-005: No sensitive data exposed in DOM
 * - FE-001: No tokens stored in component state
 * - API-008: Only whitelisted status fields displayed
 *
 * Accessibility (WCAG 2.1 AA):
 * - Proper ARIA labels for screen readers
 * - Keyboard accessible tooltip
 * - Color is not the only indicator (text labels included)
 * - Focus visible styling
 */
export const SyncStatusIndicator = memo(function SyncStatusIndicator({
  className,
  showTooltip = true,
  compact = false,
}: SyncStatusIndicatorProps) {
  // State
  const [status, setStatus] = useState<SyncStatusData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRetrying, setIsRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derived state
  const indicatorState = useMemo(() => getIndicatorState(status), [status]);
  const config = STATUS_CONFIG[indicatorState];

  /**
   * Fetch current sync status from main process
   * API-003: Handles errors with sanitized messages
   */
  const fetchStatus = useCallback(async () => {
    try {
      const response =
        await window.electronAPI.invoke<IPCResponse<SyncStatusData>>('sync:getStatus');

      if (response.error) {
        // API-003: Use sanitized error message
        setError(response.message ?? 'Failed to get sync status');
        return;
      }

      if (response.data) {
        setStatus(response.data);
        // Update error state based on sync status
        if (response.data.lastSyncStatus === 'success') {
          setError(null);
        } else if (response.data.lastErrorMessage) {
          // Show the server-side error message
          setError(response.data.lastErrorMessage);
        }
      }
    } catch {
      // API-003: Generic error message, no internal details
      setError('Unable to connect to sync service');
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Handle manual retry
   */
  const handleRetry = useCallback(async () => {
    setIsRetrying(true);
    setError(null);

    try {
      const response =
        await window.electronAPI.invoke<IPCResponse<{ triggered: boolean }>>('sync:triggerNow');

      if (response.error) {
        setError(response.message ?? 'Retry failed');
        return;
      }

      // Refetch status after triggering
      await fetchStatus();
    } catch {
      setError('Failed to trigger sync');
    } finally {
      setIsRetrying(false);
    }
  }, [fetchStatus]);

  /**
   * Dismiss error state
   */
  const handleDismiss = useCallback(() => {
    setError(null);
  }, []);

  // Initial fetch and event subscription
  useEffect(() => {
    fetchStatus();

    // Subscribe to status change events
    const unsubscribe = window.electronAPI.on('sync:statusChanged', (newStatus: unknown) => {
      // SEC-014: Runtime type validation before use
      // Prevents malformed IPC data from corrupting component state
      if (isSyncStatusData(newStatus)) {
        setStatus(newStatus);
      }
    });

    // Polling fallback every 30 seconds (backup if events missed)
    const pollInterval = setInterval(fetchStatus, 30000);

    return () => {
      unsubscribe();
      clearInterval(pollInterval);
    };
  }, [fetchStatus]);

  // Loading state
  if (isLoading) {
    return (
      <div
        className={cn('flex items-center gap-2', className)}
        aria-busy="true"
        aria-label="Loading sync status"
      >
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-300 animate-pulse" />
        {!compact && <span className="text-xs text-muted-foreground">Loading...</span>}
      </div>
    );
  }

  // Get dynamic label - only show progress when syncing
  // Pending count is shown in tooltip details only, not in main display
  const displayLabel =
    indicatorState === 'syncing' ? getSyncingLabel(status?.progress ?? null) : config.label;

  // Main indicator content
  const indicatorContent = (
    <div
      className={cn(
        'flex items-center gap-2 cursor-default',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded',
        className
      )}
      role="status"
      aria-label={config.ariaLabel}
      aria-live="polite"
      tabIndex={0}
      data-testid="sync-status-indicator"
    >
      <StatusDot state={indicatorState} />
      {!compact && (
        <span className="text-xs text-muted-foreground select-none">{displayLabel}</span>
      )}
    </div>
  );

  // Without tooltip
  if (!showTooltip) {
    return indicatorContent;
  }

  // With tooltip
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{indicatorContent}</TooltipTrigger>
        <TooltipContent side="top" align="start" className="p-3">
          <TooltipDetails
            status={status}
            state={indicatorState}
            error={error}
            onRetry={handleRetry}
            onDismiss={handleDismiss}
            isRetrying={isRetrying}
          />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

export default SyncStatusIndicator;
