/**
 * Sync History Page
 *
 * Displays sync operation history with pagination, filtering,
 * and queue management capabilities.
 *
 * @module renderer/pages/SyncHistoryPage
 * @security SEC-004: XSS prevention via React's automatic escaping
 * @security FE-005: No sensitive data exposed in DOM
 */

import React, { useCallback, useEffect, useState } from 'react';
import { SyncStatus } from '../components/sync';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Trash2,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface SyncLog {
  id: string;
  store_id: string;
  sync_type: 'PUSH' | 'PULL' | 'BIDIRECTIONAL';
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  records_sent: number | null;
  records_succeeded: number | null;
  records_failed: number | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  details: string | null;
  created_at: string;
}

interface SyncQueueItem {
  id: string;
  entity_id: string;
  entity_type: string;
  store_id: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  priority: number;
  sync_attempts: number;
  max_attempts: number;
  last_sync_error: string | null;
  last_attempt_at: string | null;
  created_at: string;
}

interface SyncStats {
  queue: {
    pending: number;
    failed: number;
    total: number;
  };
  history: {
    totalSyncs: number;
    successfulSyncs: number;
    failedSyncs: number;
    lastSyncAt: string | null;
    lastSyncStatus: string | null;
    totalRecordsSynced: number;
  };
  timestamps: Record<string, string | null>;
}

interface IPCResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

type TabType = 'history' | 'pending' | 'failed';

// ============================================================================
// Main Component
// ============================================================================

export default function SyncHistoryPage() {
  const [activeTab, setActiveTab] = useState<TabType>('history');
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [pendingItems, setPendingItems] = useState<SyncQueueItem[]>([]);
  const [failedItems, setFailedItems] = useState<SyncQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isRetrying, setIsRetrying] = useState(false);

  /**
   * Fetch sync statistics
   */
  const fetchStats = useCallback(async () => {
    try {
      const response = await window.electronAPI.invoke<IPCResponse<SyncStats>>('sync:getStats');
      if (response.data) {
        setStats(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch sync stats:', err);
    }
  }, []);

  /**
   * Fetch sync history logs
   */
  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await window.electronAPI.invoke<IPCResponse<{ logs: SyncLog[] }>>(
        'sync:getHistory',
        { limit: 100 }
      );

      if (response.error) {
        setError(response.message ?? 'Failed to load history');
        return;
      }

      if (response.data) {
        setLogs(response.data.logs);
      }
    } catch (err) {
      setError('Failed to connect to sync service');
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Fetch pending queue items
   */
  const fetchPending = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await window.electronAPI.invoke<
        IPCResponse<{ items: SyncQueueItem[]; total: number }>
      >('sync:getPendingQueue', { limit: 100 });

      if (response.error) {
        setError(response.message ?? 'Failed to load pending items');
        return;
      }

      if (response.data) {
        setPendingItems(response.data.items);
      }
    } catch (err) {
      setError('Failed to connect to sync service');
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Fetch failed queue items
   */
  const fetchFailed = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await window.electronAPI.invoke<
        IPCResponse<{ items: SyncQueueItem[]; total: number }>
      >('sync:getFailedQueue', { limit: 100 });

      if (response.error) {
        setError(response.message ?? 'Failed to load failed items');
        return;
      }

      if (response.data) {
        setFailedItems(response.data.items);
      }
    } catch (err) {
      setError('Failed to connect to sync service');
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Retry selected failed items
   */
  const handleRetrySelected = useCallback(async () => {
    if (selectedItems.size === 0) return;

    setIsRetrying(true);

    try {
      const response = await window.electronAPI.invoke<IPCResponse<{ retriedCount: number }>>(
        'sync:retryFailed',
        { ids: Array.from(selectedItems) }
      );

      if (response.data) {
        setSelectedItems(new Set());
        await fetchFailed();
        await fetchStats();
      }
    } catch (err) {
      console.error('Failed to retry items:', err);
    } finally {
      setIsRetrying(false);
    }
  }, [selectedItems, fetchFailed, fetchStats]);

  /**
   * Toggle item selection
   */
  const toggleSelection = useCallback((id: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  /**
   * Select all failed items
   */
  const selectAllFailed = useCallback(() => {
    setSelectedItems(new Set(failedItems.map((item) => item.id)));
  }, [failedItems]);

  /**
   * Clear selection
   */
  const clearSelection = useCallback(() => {
    setSelectedItems(new Set());
  }, []);

  // Initial load
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Tab-specific data loading
  useEffect(() => {
    switch (activeTab) {
      case 'history':
        fetchHistory();
        break;
      case 'pending':
        fetchPending();
        break;
      case 'failed':
        fetchFailed();
        break;
    }
    setSelectedItems(new Set());
  }, [activeTab, fetchHistory, fetchPending, fetchFailed]);

  return (
    <div className="space-y-6" data-testid="sync-history-page">
      {/* Header with Sync Status */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Sync History</h1>
        <SyncStatus size="compact" showSyncButton />
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total Syncs"
            value={stats.history.totalSyncs.toString()}
            icon={<RefreshCw className="w-4 h-4" />}
          />
          <StatCard
            label="Success Rate"
            value={`${stats.history.totalSyncs > 0 ? Math.round((stats.history.successfulSyncs / stats.history.totalSyncs) * 100) : 0}%`}
            icon={<CheckCircle className="w-4 h-4 text-green-500" />}
          />
          <StatCard
            label="Pending"
            value={stats.queue.pending.toString()}
            icon={<Clock className="w-4 h-4 text-yellow-500" />}
          />
          <StatCard
            label="Failed"
            value={stats.queue.failed.toString()}
            icon={<XCircle className="w-4 h-4 text-destructive" />}
            variant={stats.queue.failed > 0 ? 'destructive' : 'default'}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="bg-card border border-border rounded-lg">
        <div className="flex border-b border-border">
          <TabButton active={activeTab === 'history'} onClick={() => setActiveTab('history')}>
            History
          </TabButton>
          <TabButton active={activeTab === 'pending'} onClick={() => setActiveTab('pending')}>
            Pending {stats && stats.queue.pending > 0 && `(${stats.queue.pending})`}
          </TabButton>
          <TabButton active={activeTab === 'failed'} onClick={() => setActiveTab('failed')}>
            Failed {stats && stats.queue.failed > 0 && `(${stats.queue.failed})`}
          </TabButton>
        </div>

        {/* Tab Content */}
        <div className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <LoadingSpinner size="lg" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-destructive">{error}</div>
          ) : (
            <>
              {activeTab === 'history' && <HistoryTab logs={logs} />}
              {activeTab === 'pending' && <PendingTab items={pendingItems} />}
              {activeTab === 'failed' && (
                <FailedTab
                  items={failedItems}
                  selectedItems={selectedItems}
                  onToggleSelection={toggleSelection}
                  onSelectAll={selectAllFailed}
                  onClearSelection={clearSelection}
                  onRetrySelected={handleRetrySelected}
                  isRetrying={isRetrying}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Tab Components
// ============================================================================

interface HistoryTabProps {
  logs: SyncLog[];
}

function HistoryTab({ logs }: HistoryTabProps) {
  if (logs.length === 0) {
    return <div className="text-center py-8 text-muted-foreground">No sync history available</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border">
        <thead>
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
              Time
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
              Type
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase">
              Status
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
              Records
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
              Duration
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {logs.map((log) => (
            <tr key={log.id} className="hover:bg-muted/50">
              <td className="px-4 py-3 text-sm text-foreground">
                {formatDateTime(log.started_at)}
              </td>
              <td className="px-4 py-3 text-sm">
                <SyncTypeBadge type={log.sync_type} />
              </td>
              <td className="px-4 py-3 text-center">
                <SyncStatusBadge status={log.status} error={log.error_message} />
              </td>
              <td className="px-4 py-3 text-sm text-right text-foreground">
                {log.records_sent ?? 0}
                {log.records_failed && log.records_failed > 0 && (
                  <span className="text-destructive ml-1">({log.records_failed} failed)</span>
                )}
              </td>
              <td className="px-4 py-3 text-sm text-right text-muted-foreground">
                {formatDuration(log.started_at, log.completed_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface PendingTabProps {
  items: SyncQueueItem[];
}

function PendingTab({ items }: PendingTabProps) {
  if (items.length === 0) {
    return <div className="text-center py-8 text-muted-foreground">No pending items in queue</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border">
        <thead>
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
              Entity
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
              Operation
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase">
              Attempts
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
              Created
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-muted/50">
              <td className="px-4 py-3 text-sm">
                <div className="font-medium text-foreground">{item.entity_type}</div>
                <div className="text-xs text-muted-foreground">{truncateId(item.entity_id)}</div>
              </td>
              <td className="px-4 py-3 text-sm">
                <OperationBadge operation={item.operation} />
              </td>
              <td className="px-4 py-3 text-center text-sm text-foreground">
                {item.sync_attempts} / {item.max_attempts}
              </td>
              <td className="px-4 py-3 text-sm text-right text-muted-foreground">
                {formatRelativeTime(item.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface FailedTabProps {
  items: SyncQueueItem[];
  selectedItems: Set<string>;
  onToggleSelection: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onRetrySelected: () => void;
  isRetrying: boolean;
}

function FailedTab({
  items,
  selectedItems,
  onToggleSelection,
  onSelectAll,
  onClearSelection,
  onRetrySelected,
  isRetrying,
}: FailedTabProps) {
  if (items.length === 0) {
    return <div className="text-center py-8 text-muted-foreground">No failed items</div>;
  }

  return (
    <div>
      {/* Action bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onSelectAll}>
            Select All
          </Button>
          {selectedItems.size > 0 && (
            <Button variant="ghost" size="sm" onClick={onClearSelection}>
              Clear ({selectedItems.size})
            </Button>
          )}
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={onRetrySelected}
          disabled={selectedItems.size === 0 || isRetrying}
        >
          <RotateCcw className={`w-4 h-4 mr-2 ${isRetrying ? 'animate-spin' : ''}`} />
          Retry Selected
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase w-8">
                <span className="sr-only">Select</span>
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Entity
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                Error
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase">
                Attempts
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                Last Attempt
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item) => (
              <tr
                key={item.id}
                className={`hover:bg-muted/50 ${selectedItems.has(item.id) ? 'bg-muted/30' : ''}`}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedItems.has(item.id)}
                    onChange={() => onToggleSelection(item.id)}
                    className="rounded border-input"
                    aria-label={`Select ${item.entity_type} ${truncateId(item.entity_id)}`}
                  />
                </td>
                <td className="px-4 py-3 text-sm">
                  <div className="font-medium text-foreground">{item.entity_type}</div>
                  <div className="text-xs text-muted-foreground">{truncateId(item.entity_id)}</div>
                </td>
                <td className="px-4 py-3 text-sm text-destructive max-w-xs truncate">
                  {item.last_sync_error ?? 'Unknown error'}
                </td>
                <td className="px-4 py-3 text-center text-sm text-foreground">
                  {item.sync_attempts} / {item.max_attempts}
                </td>
                <td className="px-4 py-3 text-sm text-right text-muted-foreground">
                  {item.last_attempt_at ? formatRelativeTime(item.last_attempt_at) : 'Never'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-medium transition-colors ${
        active
          ? 'border-b-2 border-primary text-primary'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  variant?: 'default' | 'destructive';
}

function StatCard({ label, value, icon, variant = 'default' }: StatCardProps) {
  return (
    <div
      className={`bg-card border rounded-lg p-4 ${
        variant === 'destructive' ? 'border-destructive/50' : 'border-border'
      }`}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        {icon}
      </div>
      <p
        className={`text-2xl font-bold mt-2 ${
          variant === 'destructive' ? 'text-destructive' : 'text-foreground'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function SyncTypeBadge({ type }: { type: SyncLog['sync_type'] }) {
  const variants: Record<
    SyncLog['sync_type'],
    { label: string; icon: React.ReactNode; variant: 'default' | 'secondary' | 'outline' }
  > = {
    PUSH: { label: 'Push', icon: <ArrowUp className="w-3 h-3" />, variant: 'default' },
    PULL: { label: 'Pull', icon: <ArrowDown className="w-3 h-3" />, variant: 'secondary' },
    BIDIRECTIONAL: { label: 'Bi-Dir', icon: <RefreshCw className="w-3 h-3" />, variant: 'outline' },
  };

  const config = variants[type];

  return (
    <Badge variant={config.variant} className="gap-1">
      {config.icon}
      {config.label}
    </Badge>
  );
}

function SyncStatusBadge({ status, error }: { status: SyncLog['status']; error: string | null }) {
  const variants: Record<
    SyncLog['status'],
    { icon: React.ReactNode; variant: 'default' | 'success' | 'destructive' | 'warning' }
  > = {
    COMPLETED: { icon: <CheckCircle className="w-3 h-3" />, variant: 'success' },
    FAILED: { icon: <XCircle className="w-3 h-3" />, variant: 'destructive' },
    RUNNING: { icon: <Clock className="w-3 h-3" />, variant: 'warning' },
  };

  const config = variants[status];

  return (
    <Badge variant={config.variant} className="gap-1" title={error ?? undefined}>
      {config.icon}
      {status}
    </Badge>
  );
}

function OperationBadge({ operation }: { operation: SyncQueueItem['operation'] }) {
  const variants: Record<
    SyncQueueItem['operation'],
    { variant: 'default' | 'success' | 'destructive' }
  > = {
    CREATE: { variant: 'success' },
    UPDATE: { variant: 'default' },
    DELETE: { variant: 'destructive' },
  };

  return <Badge variant={variants[operation].variant}>{operation}</Badge>;
}

// ============================================================================
// Helpers
// ============================================================================

function formatDateTime(isoString: string): string {
  return new Date(isoString).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return 'In progress';

  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  const durationMs = end - start;

  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${(durationMs / 60000).toFixed(1)}m`;
}

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}
