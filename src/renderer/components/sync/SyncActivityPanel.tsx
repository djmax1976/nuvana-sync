/**
 * Sync Activity Panel Component
 *
 * Development/debug panel showing sync queue activity in real-time.
 * Displays queued items waiting to sync and recently synced items.
 *
 * @module renderer/components/sync/SyncActivityPanel
 * @security SEC-004: XSS prevention via React's automatic escaping
 * @security FE-005: No sensitive data exposed in DOM
 * @security API-008: Only whitelisted fields displayed
 */

import { memo, useCallback, useEffect, useState } from 'react';
import { cn } from '../../lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import { ScrollArea } from '../ui/scroll-area';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import {
  syncAPI,
  type SyncActivityItem,
  type SyncActivityResponse,
} from '../../lib/api/ipc-client';

// ============================================================================
// Constants
// ============================================================================

/** LocalStorage key for dev panel enabled state */
const STORAGE_KEY = 'nuvana:sync-activity-panel-enabled';

/** Polling interval in milliseconds */
const POLL_INTERVAL_MS = 5000;

// ============================================================================
// Types
// ============================================================================

export interface SyncActivityPanelProps {
  className?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format relative time for display
 * SEC-004: No user input, safe string formatting
 */
function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return '-';

  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '-';

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 60) return 'Just now';
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

/**
 * Get status badge variant and icon
 */
function getStatusDisplay(item: SyncActivityItem): {
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  icon: React.ReactNode;
  label: string;
} {
  switch (item.status) {
    case 'synced':
      return {
        variant: 'default',
        icon: <CheckCircle2 className="h-3 w-3" />,
        label: 'Synced',
      };
    case 'failed':
      return {
        variant: 'destructive',
        icon: <XCircle className="h-3 w-3" />,
        label: `Failed (${item.sync_attempts}/${item.max_attempts})`,
      };
    case 'queued':
    default:
      return {
        variant: 'secondary',
        icon: <Clock className="h-3 w-3" />,
        label: item.sync_attempts > 0 ? `Retry ${item.sync_attempts}` : 'Queued',
      };
  }
}

/**
 * Format operation type for display
 * SEC-004: Uses explicit switch to avoid object injection warning
 */
function formatOperation(op: string): string {
  switch (op) {
    case 'CREATE':
      return 'Create';
    case 'UPDATE':
      return 'Update';
    case 'DELETE':
      return 'Delete';
    case 'ACTIVATE':
      return 'Activate';
    default:
      return op;
  }
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Single activity item row
 */
const ActivityItemRow = memo(function ActivityItemRow({ item }: { item: SyncActivityItem }) {
  const statusDisplay = getStatusDisplay(item);
  const summary = item.summary;

  return (
    <div
      className={cn(
        'flex flex-col gap-1 p-2 rounded-md text-xs',
        item.status === 'failed' && 'bg-destructive/5',
        item.status === 'queued' && 'bg-muted/50',
        item.status === 'synced' && 'bg-green-500/5'
      )}
    >
      {/* Top row: entity info and status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="font-medium text-foreground truncate">
            {summary?.pack_number || item.entity_id.substring(0, 8)}
          </span>
          {summary?.game_code && (
            <span className="text-muted-foreground">#{summary.game_code}</span>
          )}
        </div>
        <Badge variant={statusDisplay.variant} className="h-5 gap-1 text-[10px] shrink-0">
          {statusDisplay.icon}
          {statusDisplay.label}
        </Badge>
      </div>

      {/* Bottom row: operation and timing */}
      <div className="flex items-center justify-between text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="capitalize">{item.entity_type}</span>
          <span className="text-muted-foreground/60">/</span>
          <span>{formatOperation(item.operation)}</span>
          {summary?.status && (
            <>
              <span className="text-muted-foreground/60">/</span>
              <span className="uppercase text-[10px]">{summary.status}</span>
            </>
          )}
        </div>
        <span className="text-[10px]">
          {item.status === 'synced'
            ? formatRelativeTime(item.synced_at)
            : formatRelativeTime(item.created_at)}
        </span>
      </div>

      {/* Error message for failed items */}
      {item.status === 'failed' && item.last_sync_error && (
        <div className="flex items-start gap-1 mt-1 text-destructive">
          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
          <span className="text-[10px] line-clamp-2">{item.last_sync_error}</span>
        </div>
      )}
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

/**
 * Sync Activity Panel Component
 *
 * Development/debug panel showing sync queue activity.
 * Toggle-able via localStorage for persistence across sessions.
 *
 * Features:
 * - Collapsible panel that can be enabled/disabled
 * - Shows queued items (pending + failed)
 * - Shows recently synced items (last 10)
 * - Real-time updates via polling
 * - Color-coded status badges
 *
 * Security Compliance:
 * - SEC-004: XSS prevention via React's automatic escaping
 * - FE-005: No sensitive data exposed in DOM
 * - API-008: Only whitelisted fields from backend displayed
 */
export const SyncActivityPanel = memo(function SyncActivityPanel({
  className,
}: SyncActivityPanelProps) {
  // State
  const [isEnabled, setIsEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [isOpen, setIsOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<SyncActivityResponse | null>(null);

  /**
   * Fetch sync activity data
   */
  const fetchActivity = useCallback(async () => {
    if (!isEnabled) return;

    try {
      setIsLoading(true);
      const response = await syncAPI.getActivity({ queuedLimit: 20, syncedLimit: 10 });
      setData(response);
    } catch (error) {
      // Log but don't show error to user - this is a dev tool
      console.warn('[SyncActivityPanel] Failed to fetch activity:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isEnabled]);

  /**
   * Toggle enabled state and persist to localStorage
   */
  const handleToggleEnabled = useCallback((checked: boolean) => {
    setIsEnabled(checked);
    try {
      localStorage.setItem(STORAGE_KEY, String(checked));
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Fetch on mount and set up polling
  useEffect(() => {
    if (!isEnabled) {
      setData(null);
      return;
    }

    fetchActivity();
    const interval = setInterval(fetchActivity, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isEnabled, fetchActivity]);

  // If not enabled, show minimal toggle
  if (!isEnabled) {
    return (
      <div className={cn('border-t px-4 py-2', className)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            <span>Sync Monitor</span>
          </div>
          <Switch
            checked={isEnabled}
            onCheckedChange={handleToggleEnabled}
            className="scale-75"
            aria-label="Enable sync activity monitor"
          />
        </div>
      </div>
    );
  }

  const queuedCount = data?.queued.length || 0;
  const failedCount = data?.stats.failedCount || 0;
  const syncedTodayCount = data?.stats.syncedTodayCount || 0;

  return (
    <div className={cn('border-t', className)}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        {/* Header with toggle */}
        <div className="flex items-center justify-between px-4 py-2">
          <CollapsibleTrigger className="flex items-center gap-2 text-xs font-medium hover:text-foreground transition-colors">
            <Activity className="h-3.5 w-3.5 text-primary" />
            <span>Sync Monitor</span>
            {queuedCount > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                {queuedCount}
              </Badge>
            )}
            {failedCount > 0 && (
              <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                {failedCount} failed
              </Badge>
            )}
            {isOpen ? (
              <ChevronUp className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            )}
          </CollapsibleTrigger>
          <div className="flex items-center gap-2">
            {isLoading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
            <Switch
              checked={isEnabled}
              onCheckedChange={handleToggleEnabled}
              className="scale-75"
              aria-label="Disable sync activity monitor"
            />
          </div>
        </div>

        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-3">
            {/* Stats summary */}
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground px-1">
              <span>
                <CheckCircle2 className="h-3 w-3 inline mr-1 text-green-500" />
                {syncedTodayCount} today
              </span>
              <span>
                <Clock className="h-3 w-3 inline mr-1" />
                {data?.stats.pendingCount || 0} pending
              </span>
            </div>

            {/* Queued items */}
            {queuedCount > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide px-1">
                  Queue ({queuedCount})
                </div>
                <ScrollArea className="max-h-32">
                  <div className="space-y-1">
                    {data?.queued.map((item) => (
                      <ActivityItemRow key={item.id} item={item} />
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Recently synced */}
            {data?.recentlySynced && data.recentlySynced.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide px-1">
                  Recently Synced
                </div>
                <ScrollArea className="max-h-24">
                  <div className="space-y-1">
                    {data.recentlySynced.map((item) => (
                      <ActivityItemRow key={item.id} item={item} />
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Empty state */}
            {queuedCount === 0 && (!data?.recentlySynced || data.recentlySynced.length === 0) && (
              <div className="text-center py-4 text-xs text-muted-foreground">
                <Activity className="h-6 w-6 mx-auto mb-2 opacity-30" />
                <p>No sync activity</p>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
});

export default SyncActivityPanel;
