/**
 * Sync Status Component
 *
 * Displays current sync status with visual indicator, pending count,
 * last sync time, and manual sync button.
 *
 * @module renderer/components/sync/SyncStatus
 * @security SEC-004: XSS prevention via React's automatic escaping
 * @security FE-005: No sensitive data exposed in DOM
 */

import { useCallback, useEffect, useState } from 'react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  RefreshCw,
  Cloud,
  CloudOff,
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

/**
 * Sync status from the sync engine
 */
interface SyncStatusData {
  isRunning: boolean;
  isStarted: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: 'success' | 'failed' | 'running' | 'never';
  pendingCount: number;
  nextSyncIn: number;
  isOnline: boolean;
}

/**
 * IPC response wrapper
 */
interface IPCResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface SyncStatusProps {
  /** Component size variant */
  size?: 'compact' | 'full';
  /** Show manual sync button */
  showSyncButton?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Show detailed stats */
  showDetails?: boolean;
}

// ============================================================================
// Status Icon Component
// ============================================================================

function StatusIcon({
  status,
  isOnline,
  isRunning,
}: {
  status: SyncStatusData['lastSyncStatus'];
  isOnline: boolean;
  isRunning: boolean;
}) {
  if (!isOnline) {
    return <CloudOff className="w-4 h-4 text-muted-foreground" aria-hidden="true" />;
  }

  if (isRunning) {
    return <Loader2 className="w-4 h-4 text-primary animate-spin" aria-hidden="true" />;
  }

  switch (status) {
    case 'success':
      return <CheckCircle className="w-4 h-4 text-green-500" aria-hidden="true" />;
    case 'failed':
      return <AlertCircle className="w-4 h-4 text-destructive" aria-hidden="true" />;
    case 'running':
      return <Loader2 className="w-4 h-4 text-primary animate-spin" aria-hidden="true" />;
    default:
      return <Cloud className="w-4 h-4 text-muted-foreground" aria-hidden="true" />;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format relative time from ISO string
 */
function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'Never';

  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;

  return date.toLocaleDateString();
}

/**
 * Format next sync countdown
 */
function formatNextSync(nextSyncIn: number): string {
  if (nextSyncIn <= 0) return 'Now';

  const seconds = Math.floor(nextSyncIn / 1000);
  const minutes = Math.floor(seconds / 60);

  if (minutes > 0) {
    return `in ${minutes}m`;
  }
  return `in ${seconds}s`;
}

/**
 * Get status badge variant based on sync status
 */
function getStatusBadgeVariant(
  status: SyncStatusData['lastSyncStatus'],
  isOnline: boolean
): 'default' | 'secondary' | 'destructive' | 'success' | 'warning' {
  if (!isOnline) return 'secondary';

  switch (status) {
    case 'success':
      return 'success';
    case 'failed':
      return 'destructive';
    case 'running':
      return 'warning';
    default:
      return 'default';
  }
}

/**
 * Get status label text
 */
function getStatusLabel(
  status: SyncStatusData['lastSyncStatus'],
  isOnline: boolean,
  isRunning: boolean
): string {
  if (!isOnline) return 'Offline';
  if (isRunning) return 'Syncing...';

  switch (status) {
    case 'success':
      return 'Synced';
    case 'failed':
      return 'Failed';
    case 'running':
      return 'Syncing...';
    default:
      return 'Idle';
  }
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * SyncStatus Component
 *
 * Displays sync engine status with:
 * - Status indicator (icon + badge)
 * - Pending item count
 * - Last sync time
 * - Manual sync button
 *
 * Accessibility:
 * - WCAG 2.1 AA compliant
 * - Proper ARIA labels
 * - Keyboard accessible
 */
export function SyncStatus({
  size = 'compact',
  showSyncButton = true,
  showDetails = false,
  className,
}: SyncStatusProps) {
  const [status, setStatus] = useState<SyncStatusData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch current sync status
   */
  const fetchStatus = useCallback(async () => {
    try {
      const response = await window.electronAPI.invoke<IPCResponse<SyncStatusData>>(
        'sync:getStatus'
      );

      if (response.error) {
        setError(response.message ?? 'Failed to get sync status');
        return;
      }

      if (response.data) {
        setStatus(response.data);
        setError(null);
      }
    } catch (err) {
      setError('Failed to connect to sync service');
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Trigger manual sync
   */
  const handleManualSync = useCallback(async () => {
    setIsSyncing(true);
    setError(null);

    try {
      const response = await window.electronAPI.invoke<IPCResponse<{ triggered: boolean }>>(
        'sync:triggerNow'
      );

      if (response.error) {
        setError(response.message ?? 'Sync failed');
        return;
      }

      // Refetch status after triggering
      await fetchStatus();
    } catch (err) {
      setError('Failed to trigger sync');
    } finally {
      setIsSyncing(false);
    }
  }, [fetchStatus]);

  // Initial fetch and polling
  useEffect(() => {
    fetchStatus();

    // Poll every 5 seconds
    const interval = setInterval(fetchStatus, 5000);

    // Subscribe to sync status events
    const unsubscribe = window.electronAPI.on('sync:statusChanged', () => {
      fetchStatus();
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
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
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  // Error state
  if (error && !status) {
    return (
      <div
        className={cn('flex items-center gap-2', className)}
        role="alert"
        aria-live="polite"
      >
        <AlertCircle className="w-4 h-4 text-destructive" />
        <span className="text-sm text-destructive">{error}</span>
      </div>
    );
  }

  // No status available
  if (!status) {
    return null;
  }

  const statusLabel = getStatusLabel(status.lastSyncStatus, status.isOnline, status.isRunning);
  const badgeVariant = getStatusBadgeVariant(status.lastSyncStatus, status.isOnline);

  // Compact variant - minimal display
  if (size === 'compact') {
    return (
      <div
        className={cn('flex items-center gap-2', className)}
        data-testid="sync-status-compact"
        role="status"
        aria-label={`Sync status: ${statusLabel}. ${status.pendingCount} pending items.`}
      >
        <StatusIcon
          status={status.lastSyncStatus}
          isOnline={status.isOnline}
          isRunning={status.isRunning || isSyncing}
        />
        <Badge variant={badgeVariant} className="text-xs">
          {statusLabel}
        </Badge>
        {status.pendingCount > 0 && (
          <Badge variant="outline" className="text-xs">
            {status.pendingCount} pending
          </Badge>
        )}
        {showSyncButton && status.isOnline && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleManualSync}
            disabled={isSyncing || status.isRunning}
            className="h-6 w-6 p-0"
            aria-label="Sync now"
          >
            <RefreshCw
              className={cn('w-3 h-3', (isSyncing || status.isRunning) && 'animate-spin')}
            />
          </Button>
        )}
      </div>
    );
  }

  // Full variant - detailed display
  return (
    <div
      className={cn(
        'bg-card border border-border rounded-lg p-4 space-y-3',
        className
      )}
      data-testid="sync-status-full"
      role="region"
      aria-label="Sync Status"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusIcon
            status={status.lastSyncStatus}
            isOnline={status.isOnline}
            isRunning={status.isRunning || isSyncing}
          />
          <span className="font-medium text-foreground">Sync Status</span>
        </div>
        <Badge variant={badgeVariant}>{statusLabel}</Badge>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-muted-foreground block">Last Sync</span>
          <span className="text-foreground font-medium">
            {formatRelativeTime(status.lastSyncAt)}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground block">Pending</span>
          <span className="text-foreground font-medium">
            {status.pendingCount} items
          </span>
        </div>
        {showDetails && (
          <>
            <div>
              <span className="text-muted-foreground block">Next Sync</span>
              <span className="text-foreground font-medium">
                {status.isStarted ? formatNextSync(status.nextSyncIn) : 'Stopped'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">Connection</span>
              <span className="text-foreground font-medium">
                {status.isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div
          className="flex items-center gap-2 text-sm text-destructive"
          role="alert"
          aria-live="polite"
        >
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {/* Actions */}
      {showSyncButton && (
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualSync}
            disabled={isSyncing || status.isRunning || !status.isOnline}
            className="flex-1"
          >
            <RefreshCw
              className={cn(
                'w-4 h-4 mr-2',
                (isSyncing || status.isRunning) && 'animate-spin'
              )}
            />
            {isSyncing || status.isRunning ? 'Syncing...' : 'Sync Now'}
          </Button>
        </div>
      )}
    </div>
  );
}

export default SyncStatus;
