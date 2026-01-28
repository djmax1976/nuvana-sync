/**
 * Sync Monitor Page
 *
 * Full-page sync activity monitor with filtering, pagination, and detailed statistics.
 * Replaces the compact sidebar panel with a comprehensive view.
 *
 * @module renderer/pages/SyncMonitorPage
 * @security SEC-004: XSS prevention via React's automatic escaping
 * @security FE-005: No sensitive data exposed in DOM
 * @security API-008: Only safe display fields from backend
 */

import { useState, useCallback } from 'react';
import {
  useSyncActivity,
  useRetrySyncItem,
  useDeleteSyncItem,
  useInvalidateSyncActivity,
} from '../lib/hooks';
import {
  syncAPI,
  type SyncStatusFilter,
  type SyncDirectionFilter,
  type SyncActivityItem,
} from '../lib/api/ipc-client';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RotateCcw,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Activity,
  Package,
  Zap,
  XCircle,
  Filter,
  ArrowUpRight,
  ArrowDownLeft,
  Globe,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface FilterState {
  status: SyncStatusFilter;
  entityType: string;
  direction: SyncDirectionFilter;
  limit: number;
  offset: number;
}

// ============================================================================
// Constants
// ============================================================================

const STATUS_OPTIONS: { value: SyncStatusFilter; label: string }[] = [
  { value: 'all', label: 'All Status' },
  { value: 'queued', label: 'Queued' },
  { value: 'failed', label: 'Failed' },
  { value: 'synced', label: 'Synced' },
];

const ENTITY_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'pack', label: 'Pack' },
  { value: 'game', label: 'Game' },
  { value: 'bin', label: 'Bin' },
  { value: 'shift', label: 'Shift' },
  { value: 'user', label: 'User' },
];

const DIRECTION_OPTIONS: { value: SyncDirectionFilter; label: string }[] = [
  { value: 'all', label: 'All Directions' },
  { value: 'PUSH', label: 'Push (to cloud)' },
  { value: 'PULL', label: 'Pull (from cloud)' },
];

const PAGE_SIZE_OPTIONS = [25, 50, 100];

// ============================================================================
// Component
// ============================================================================

export default function SyncMonitorPage() {
  // Filter state
  const [filters, setFilters] = useState<FilterState>({
    status: 'all',
    entityType: '',
    direction: 'all',
    limit: 50,
    offset: 0,
  });

  // Selected item for detail view
  const [selectedItem, setSelectedItem] = useState<SyncActivityItem | null>(null);

  // Query data
  const { data, isLoading, error, refetch, isFetching } = useSyncActivity(
    {
      status: filters.status,
      entityType: filters.entityType || undefined,
      direction: filters.direction === 'all' ? undefined : filters.direction,
      limit: filters.limit,
      offset: filters.offset,
    },
    { refetchInterval: 5000 } // Refresh every 5 seconds for live activity visibility
  );

  // Mutations
  const retryMutation = useRetrySyncItem();
  const deleteMutation = useDeleteSyncItem();
  const { invalidateAll } = useInvalidateSyncActivity();

  // Handlers
  const handleFilterChange = useCallback((key: keyof FilterState, value: string | number) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
      // Reset offset when filter changes
      offset: key !== 'offset' ? 0 : (value as number),
    }));
    setSelectedItem(null);
  }, []);

  const handleNextPage = useCallback(() => {
    if (data?.hasMore) {
      setFilters((prev) => ({ ...prev, offset: prev.offset + prev.limit }));
    }
  }, [data?.hasMore]);

  const handlePrevPage = useCallback(() => {
    if (filters.offset > 0) {
      setFilters((prev) => ({
        ...prev,
        offset: Math.max(0, prev.offset - prev.limit),
      }));
    }
  }, [filters.offset]);

  const handleRetry = useCallback(
    async (id: string) => {
      await retryMutation.mutateAsync(id);
      // Trigger immediate sync after retry
      syncAPI.triggerNow();
    },
    [retryMutation]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteMutation.mutateAsync(id);
      if (selectedItem?.id === id) {
        setSelectedItem(null);
      }
    },
    [deleteMutation, selectedItem]
  );

  const handleManualRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const handleTriggerSync = useCallback(async () => {
    await syncAPI.triggerNow();
    // Wait a bit then refresh to see new status
    setTimeout(() => invalidateAll(), 1000);
  }, [invalidateAll]);

  const handleSyncGames = useCallback(async () => {
    try {
      await syncAPI.syncGames();
      // Wait a bit then refresh to see new status
      setTimeout(() => invalidateAll(), 1000);
    } catch (error) {
      console.error('Games sync failed:', error);
    }
  }, [invalidateAll]);

  // Error state
  if (error) {
    return (
      <div className="p-6">
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
          <h3 className="text-destructive font-medium flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Error loading sync activity
          </h3>
          <p className="text-destructive/80 text-sm mt-1">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
          <button
            onClick={handleManualRefresh}
            className="mt-3 px-4 py-2 bg-destructive text-destructive-foreground rounded text-sm hover:bg-destructive/90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const stats = data?.stats;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sync Monitor</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Monitor cloud synchronization status and manage pending items
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleManualRefresh}
            disabled={isFetching}
            className="px-3 py-2 border border-border rounded-lg text-sm flex items-center gap-2 hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleSyncGames}
            className="px-3 py-2 border border-primary text-primary rounded-lg text-sm flex items-center gap-2 hover:bg-primary/10"
            title="Force sync games from cloud (bypasses rate limit)"
          >
            <ArrowDownLeft className="h-4 w-4" />
            Sync Games
          </button>
          <button
            onClick={handleTriggerSync}
            className="px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm flex items-center gap-2 hover:bg-primary/90"
          >
            <Zap className="h-4 w-4" />
            Sync Now
          </button>
        </div>
      </div>

      {/* Statistics Cards - API-008: Clear labels for mutually exclusive counts */}
      {stats && (
        <div className="space-y-4">
          {/* Main Status Cards */}
          <div className="grid grid-cols-4 gap-4">
            <StatCard
              label="Queued"
              value={stats.queued ?? stats.pending}
              icon={<Clock className="h-5 w-5 text-yellow-500" />}
              variant={(stats.queued ?? stats.pending) > 0 ? 'warning' : 'default'}
            />
            <StatCard
              label="Failed"
              value={stats.failed}
              icon={<XCircle className="h-5 w-5 text-red-500" />}
              variant={stats.failed > 0 ? 'error' : 'default'}
            />
            <StatCard
              label="Synced Today"
              value={stats.syncedToday}
              icon={<CheckCircle2 className="h-5 w-5 text-green-500" />}
              variant="success"
            />
            <StatCard
              label="Total Synced"
              value={stats.syncedTotal}
              icon={<Activity className="h-5 w-5 text-blue-500" />}
              variant="default"
            />
          </div>

          {/* Push/Pull Direction Cards */}
          {stats.byDirection && stats.byDirection.length > 0 && (
            <div className="grid grid-cols-2 gap-4">
              {stats.byDirection.map((dir) => (
                <DirectionStatCard key={dir.direction} direction={dir} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Breakdown Stats - Collapsible sections for detailed analysis */}
      {stats && (stats.byEntityType.length > 0 || stats.byOperation.length > 0) && (
        <details className="group" open>
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2 hover:text-foreground">
            <span className="transform transition-transform group-open:rotate-90">▶</span>
            Detailed Breakdown
          </summary>
          <div className="grid grid-cols-2 gap-4">
            {/* By Entity Type */}
            {stats.byEntityType.length > 0 && (
              <div className="bg-card rounded-lg border border-border p-4">
                <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  By Entity Type
                </h3>
                <div className="space-y-2">
                  {stats.byEntityType.map((item) => (
                    <div
                      key={item.entity_type}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-muted-foreground capitalize">{item.entity_type}</span>
                      <div className="flex items-center gap-3">
                        {(item.queued ?? item.pending) > 0 && (
                          <span className="text-yellow-600">
                            {item.queued ?? item.pending} queued
                          </span>
                        )}
                        {item.failed > 0 && (
                          <span className="text-red-600">{item.failed} failed</span>
                        )}
                        <span className="text-green-600">{item.synced} synced</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* By Operation */}
            {stats.byOperation.length > 0 && (
              <div className="bg-card rounded-lg border border-border p-4">
                <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  By Operation
                </h3>
                <div className="space-y-2">
                  {stats.byOperation.map((item) => (
                    <div key={item.operation} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{item.operation}</span>
                      <div className="flex items-center gap-3">
                        {(item.queued ?? item.pending) > 0 && (
                          <span className="text-yellow-600">
                            {item.queued ?? item.pending} queued
                          </span>
                        )}
                        {item.failed > 0 && (
                          <span className="text-red-600">{item.failed} failed</span>
                        )}
                        <span className="text-green-600">{item.synced} synced</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </details>
      )}

      {/* Filters */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Filter className="h-4 w-4" />
            Filters:
          </div>
          <div>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value as SyncStatusFilter)}
              className="border border-border rounded px-3 py-1.5 text-sm bg-background text-foreground"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <select
              value={filters.entityType}
              onChange={(e) => handleFilterChange('entityType', e.target.value)}
              className="border border-border rounded px-3 py-1.5 text-sm bg-background text-foreground"
            >
              {ENTITY_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <select
              value={filters.direction}
              onChange={(e) =>
                handleFilterChange('direction', e.target.value as SyncDirectionFilter)
              }
              className="border border-border rounded px-3 py-1.5 text-sm bg-background text-foreground"
            >
              {DIRECTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Show:</span>
            <select
              value={filters.limit}
              onChange={(e) => handleFilterChange('limit', parseInt(e.target.value))}
              className="border border-border rounded px-3 py-1.5 text-sm bg-background text-foreground"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} items
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex gap-6">
        {/* Activity Table */}
        <div className="flex-1 bg-card rounded-lg border border-border overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <LoadingSpinner />
            </div>
          ) : data && data.items.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        Direction
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        Type
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        Details
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        Operation
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        Created
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        Attempts
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.items.map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => setSelectedItem(item)}
                        className={`cursor-pointer hover:bg-muted/50 ${
                          selectedItem?.id === item.id ? 'bg-primary/10' : ''
                        }`}
                      >
                        <td className="px-4 py-3">
                          <StatusBadge status={item.status} />
                        </td>
                        <td className="px-4 py-3">
                          <DirectionBadge direction={item.sync_direction} />
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground capitalize">
                          {item.entity_type}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {formatItemSummary(item)}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {item.operation}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {formatPreciseTime(item.created_at)}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {item.status !== 'synced' ? (
                            <span
                              className={
                                item.sync_attempts >= item.max_attempts ? 'text-red-500' : ''
                              }
                            >
                              {item.sync_attempts}/{item.max_attempts}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {item.status === 'failed' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRetry(item.id);
                                }}
                                disabled={retryMutation.isPending}
                                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded"
                                title="Retry"
                              >
                                <RotateCcw className="h-4 w-4" />
                              </button>
                            )}
                            {item.status !== 'synced' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(item.id);
                                }}
                                disabled={deleteMutation.isPending}
                                className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded"
                                title="Delete"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="px-4 py-3 bg-muted/50 border-t border-border flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Showing {data.offset + 1} to{' '}
                  {Math.min(data.offset + data.items.length, data.total)} of {data.total}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handlePrevPage}
                    disabled={filters.offset === 0}
                    className="p-2 border border-border rounded text-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={handleNextPage}
                    disabled={!data.hasMore}
                    className="p-2 border border-border rounded text-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <Activity className="h-12 w-12 mb-4 opacity-30" />
              <p>No sync activity found</p>
              <p className="text-sm mt-1">
                {filters.status !== 'all' || filters.entityType
                  ? 'Try adjusting your filters'
                  : 'Items will appear here when sync operations occur'}
              </p>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedItem && (
          <div className="w-96 bg-card rounded-lg border border-border p-4 h-fit">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">Item Details</h3>
              <button
                onClick={() => setSelectedItem(null)}
                className="text-muted-foreground hover:text-foreground p-1"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <DetailRow label="Status">
                <StatusBadge status={selectedItem.status} />
              </DetailRow>

              <DetailRow label="Direction">
                <DirectionBadge direction={selectedItem.sync_direction} />
              </DetailRow>

              <DetailRow label="Entity Type">
                <span className="capitalize">{selectedItem.entity_type}</span>
              </DetailRow>

              <DetailRow label="Operation">{selectedItem.operation}</DetailRow>

              {selectedItem.summary?.pack_number && (
                <DetailRow label="Pack Number">{selectedItem.summary.pack_number}</DetailRow>
              )}

              {selectedItem.summary?.game_code && (
                <DetailRow label="Game Code">{selectedItem.summary.game_code}</DetailRow>
              )}

              <DetailRow label="Created">{formatPreciseTime(selectedItem.created_at)}</DetailRow>

              {selectedItem.last_attempt_at && (
                <DetailRow label="Last Attempt">
                  {formatPreciseTime(selectedItem.last_attempt_at)}
                </DetailRow>
              )}

              {selectedItem.synced_at && (
                <DetailRow label="Synced">{formatPreciseTime(selectedItem.synced_at)}</DetailRow>
              )}

              {selectedItem.status !== 'synced' && (
                <DetailRow label="Attempts">
                  <span
                    className={
                      selectedItem.sync_attempts >= selectedItem.max_attempts ? 'text-red-500' : ''
                    }
                  >
                    {selectedItem.sync_attempts} of {selectedItem.max_attempts}
                  </span>
                </DetailRow>
              )}

              {/* API Context Section */}
              {(selectedItem.api_endpoint || selectedItem.http_status) && (
                <div className="pt-3 border-t border-border">
                  <h4 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    API Details
                  </h4>
                  {selectedItem.api_endpoint && (
                    <DetailRow label="Endpoint">
                      <span className="text-xs font-mono break-all">
                        {selectedItem.api_endpoint}
                      </span>
                    </DetailRow>
                  )}
                  {selectedItem.http_status && selectedItem.http_status > 0 && (
                    <DetailRow label="HTTP Status">
                      <HttpStatusBadge status={selectedItem.http_status} />
                    </DetailRow>
                  )}
                  {selectedItem.response_body && (
                    <div className="mt-2">
                      <p className="text-sm text-muted-foreground mb-1">Response</p>
                      <div className="bg-muted/50 border border-border rounded p-2 text-xs font-mono max-h-32 overflow-y-auto break-all">
                        {selectedItem.response_body}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {selectedItem.last_sync_error && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Last Error</p>
                  <div className="bg-destructive/10 border border-destructive/20 rounded p-2 text-sm text-destructive">
                    {selectedItem.last_sync_error}
                  </div>
                </div>
              )}

              <DetailRow label="Entity ID">
                <span className="text-xs font-mono break-all">{selectedItem.entity_id}</span>
              </DetailRow>

              <DetailRow label="Queue ID">
                <span className="text-xs font-mono break-all">{selectedItem.id}</span>
              </DetailRow>

              {/* Actions */}
              {selectedItem.status !== 'synced' && (
                <div className="pt-4 border-t border-border flex gap-2">
                  {selectedItem.status === 'failed' && (
                    <button
                      onClick={() => handleRetry(selectedItem.id)}
                      disabled={retryMutation.isPending}
                      className="flex-1 px-3 py-2 bg-primary text-primary-foreground rounded text-sm flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Retry Now
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(selectedItem.id)}
                    disabled={deleteMutation.isPending}
                    className="flex-1 px-3 py-2 bg-destructive text-destructive-foreground rounded text-sm flex items-center justify-center gap-2 hover:bg-destructive/90 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  variant: 'default' | 'warning' | 'error' | 'success';
}

function StatCard({ label, value, icon, variant }: StatCardProps) {
  const variantClasses = {
    default: 'bg-card',
    warning: 'bg-yellow-500/10 border-yellow-500/20',
    error: 'bg-red-500/10 border-red-500/20',
    success: 'bg-green-500/10 border-green-500/20',
  };

  return (
    <div className={`rounded-lg border border-border p-4 ${variantClasses[variant]}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold text-foreground">{value.toLocaleString()}</p>
        </div>
        {icon}
      </div>
    </div>
  );
}

/**
 * Direction-specific stat card showing push/pull activity details
 * SEC-004: XSS prevention via React's automatic escaping
 * API-008: Only safe display fields used
 */
interface DirectionStatCardProps {
  direction: {
    direction: 'PUSH' | 'PULL';
    pending: number;
    queued: number;
    failed: number;
    synced: number;
    syncedToday: number;
  };
}

function DirectionStatCard({ direction: dir }: DirectionStatCardProps) {
  const isPush = dir.direction === 'PUSH';
  const config = isPush
    ? {
        icon: <ArrowUpRight className="h-6 w-6" />,
        label: 'Push to Cloud',
        description: 'Local changes sent to cloud',
        bgClass: 'bg-blue-500/5 border-blue-500/20',
        iconClass: 'text-blue-500',
        accentClass: 'text-blue-600',
      }
    : {
        icon: <ArrowDownLeft className="h-6 w-6" />,
        label: 'Pull from Cloud',
        description: 'Cloud changes received locally',
        bgClass: 'bg-purple-500/5 border-purple-500/20',
        iconClass: 'text-purple-500',
        accentClass: 'text-purple-600',
      };

  const hasActivity = dir.queued > 0 || dir.failed > 0 || dir.syncedToday > 0;

  return (
    <div className={`rounded-lg border p-4 ${config.bgClass}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className={`text-lg font-semibold ${config.accentClass} flex items-center gap-2`}>
            {config.icon}
            {config.label}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">{config.description}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-foreground">{dir.syncedToday.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">synced today</p>
        </div>
      </div>

      {hasActivity && (
        <div className="flex items-center gap-4 text-sm">
          {dir.queued > 0 && (
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-yellow-500" />
              <span className="text-yellow-600">{dir.queued} queued</span>
            </div>
          )}
          {dir.failed > 0 && (
            <div className="flex items-center gap-1.5">
              <XCircle className="h-3.5 w-3.5 text-red-500" />
              <span className="text-red-600">{dir.failed} failed</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 ml-auto">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            <span className="text-muted-foreground">{dir.synced.toLocaleString()} total</span>
          </div>
        </div>
      )}

      {!hasActivity && <p className="text-sm text-muted-foreground">No activity yet</p>}
    </div>
  );
}

interface StatusBadgeProps {
  status: 'queued' | 'failed' | 'synced';
}

function StatusBadge({ status }: StatusBadgeProps) {
  const config = {
    queued: {
      icon: <Clock className="h-3.5 w-3.5" />,
      label: 'Queued',
      className: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400',
    },
    failed: {
      icon: <XCircle className="h-3.5 w-3.5" />,
      label: 'Failed',
      className: 'bg-red-500/20 text-red-700 dark:text-red-400',
    },
    synced: {
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      label: 'Synced',
      className: 'bg-green-500/20 text-green-700 dark:text-green-400',
    },
  };

  const { icon, label, className } = config[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${className}`}
    >
      {icon}
      {label}
    </span>
  );
}

interface DirectionBadgeProps {
  direction: 'PUSH' | 'PULL';
}

function DirectionBadge({ direction }: DirectionBadgeProps) {
  const config = {
    PUSH: {
      icon: <ArrowUpRight className="h-3.5 w-3.5" />,
      label: 'Push',
      className: 'bg-blue-500/20 text-blue-700 dark:text-blue-400',
    },
    PULL: {
      icon: <ArrowDownLeft className="h-3.5 w-3.5" />,
      label: 'Pull',
      className: 'bg-purple-500/20 text-purple-700 dark:text-purple-400',
    },
  };

  const { icon, label, className } = config[direction] || config.PUSH;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${className}`}
    >
      {icon}
      {label}
    </span>
  );
}

interface HttpStatusBadgeProps {
  status: number;
}

function HttpStatusBadge({ status }: HttpStatusBadgeProps) {
  let className = 'bg-muted text-muted-foreground';

  if (status >= 200 && status < 300) {
    className = 'bg-green-500/20 text-green-700 dark:text-green-400';
  } else if (status >= 400 && status < 500) {
    className = 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400';
  } else if (status >= 500) {
    className = 'bg-red-500/20 text-red-700 dark:text-red-400';
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium ${className}`}
    >
      {status}
    </span>
  );
}

interface DetailRowProps {
  label: string;
  children: React.ReactNode;
}

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{children}</p>
    </div>
  );
}

// ============================================================================
// Formatters
// ============================================================================

function formatItemSummary(item: SyncActivityItem): string {
  if (item.summary?.pack_number) {
    return `Pack #${item.summary.pack_number}${item.summary.game_code ? ` (Game ${item.summary.game_code})` : ''}`;
  }
  if (item.summary?.game_code) {
    return `Game ${item.summary.game_code}`;
  }
  // Truncate entity_id for display
  return item.entity_id.length > 20
    ? `${item.entity_id.substring(0, 8)}...${item.entity_id.substring(item.entity_id.length - 8)}`
    : item.entity_id;
}

/**
 * Format timestamp in precise format: "Jan 22, 2:20 AM"
 * v040: User requested precise timestamps instead of relative time
 */
function formatPreciseTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
