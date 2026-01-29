/**
 * Sync Activity Query Hooks
 *
 * TanStack Query hooks for sync activity monitoring.
 * Uses IPC transport to fetch data from main process.
 *
 * @module renderer/lib/hooks/useSyncActivity
 * @security SEC-004: XSS prevention via React's automatic escaping
 * @security API-008: Only safe display fields from backend
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  syncAPI,
  type SyncActivityPaginatedParams,
  type SyncActivityPaginatedResponse,
  type SyncRetryItemResponse,
  type SyncDeleteItemResponse,
  type DeadLetterParams,
  type DeadLetterListResponse,
  type DeadLetterStats,
  type DeadLetterRestoreResponse,
  type DeadLetterRestoreManyResponse,
  type DeadLetterDeleteResponse,
  type DeadLetterManualResponse,
} from '../api/ipc-client';

// ============================================================================
// Query Keys
// ============================================================================

export const syncActivityKeys = {
  all: ['syncActivity'] as const,
  lists: () => [...syncActivityKeys.all, 'list'] as const,
  list: (params?: SyncActivityPaginatedParams) =>
    [...syncActivityKeys.lists(), params || {}] as const,
  stats: () => [...syncActivityKeys.all, 'stats'] as const,
};

/**
 * Dead Letter Queue query keys (v046: MQ-002)
 */
export const deadLetterKeys = {
  all: ['deadLetter'] as const,
  lists: () => [...deadLetterKeys.all, 'list'] as const,
  list: (params?: DeadLetterParams) => [...deadLetterKeys.lists(), params || {}] as const,
  stats: () => [...deadLetterKeys.all, 'stats'] as const,
};

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Hook to fetch paginated sync activity with filtering
 *
 * @param params - Filter and pagination parameters
 * @param options - Query options
 * @returns Query result with sync activity data
 */
export function useSyncActivity(
  params?: SyncActivityPaginatedParams,
  options?: { enabled?: boolean; refetchInterval?: number }
) {
  return useQuery<SyncActivityPaginatedResponse>({
    queryKey: syncActivityKeys.list(params),
    queryFn: () => syncAPI.getActivityPaginated(params),
    enabled: options?.enabled !== false,
    staleTime: 5000, // 5 seconds - sync status can change frequently
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: options?.refetchInterval ?? 10000, // Auto-refresh every 10 seconds
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to retry a specific failed sync item
 * Resets the attempt count to allow immediate retry
 */
export function useRetrySyncItem() {
  const queryClient = useQueryClient();

  return useMutation<SyncRetryItemResponse, Error, string>({
    mutationFn: (id: string) => syncAPI.retryItem(id),
    onSuccess: () => {
      // Invalidate sync activity queries to refresh the list
      queryClient.invalidateQueries({ queryKey: syncActivityKeys.all });
    },
  });
}

/**
 * Hook to delete a specific sync item from the queue
 * Use with caution - permanently removes the item
 */
export function useDeleteSyncItem() {
  const queryClient = useQueryClient();

  return useMutation<SyncDeleteItemResponse, Error, string>({
    mutationFn: (id: string) => syncAPI.deleteItem(id),
    onSuccess: () => {
      // Invalidate sync activity queries to refresh the list
      queryClient.invalidateQueries({ queryKey: syncActivityKeys.all });
    },
  });
}

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Hook to invalidate sync activity queries
 * Useful for manual refresh after sync operations
 */
export function useInvalidateSyncActivity() {
  const queryClient = useQueryClient();

  return {
    invalidateAll: () => queryClient.invalidateQueries({ queryKey: syncActivityKeys.all }),
    invalidateList: () => queryClient.invalidateQueries({ queryKey: syncActivityKeys.lists() }),
  };
}

// ============================================================================
// Dead Letter Queue Hooks (v046: MQ-002 Compliance)
// ============================================================================

/**
 * Hook to fetch paginated Dead Letter Queue items
 *
 * @param params - Pagination parameters
 * @param options - Query options
 * @returns Query result with DLQ items
 */
export function useDeadLetterItems(
  params?: DeadLetterParams,
  options?: { enabled?: boolean; refetchInterval?: number }
) {
  return useQuery<DeadLetterListResponse>({
    queryKey: deadLetterKeys.list(params),
    queryFn: () => syncAPI.getDeadLetterItems(params),
    enabled: options?.enabled !== false,
    staleTime: 10000, // 10 seconds
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: options?.refetchInterval ?? 30000, // Refresh every 30 seconds
  });
}

/**
 * Hook to fetch Dead Letter Queue statistics
 *
 * @param options - Query options
 * @returns Query result with DLQ stats
 */
export function useDeadLetterStats(options?: { enabled?: boolean; refetchInterval?: number }) {
  return useQuery<DeadLetterStats>({
    queryKey: deadLetterKeys.stats(),
    queryFn: () => syncAPI.getDeadLetterStats(),
    enabled: options?.enabled !== false,
    staleTime: 10000, // 10 seconds
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: options?.refetchInterval ?? 30000, // Refresh every 30 seconds
  });
}

/**
 * Hook to restore a single item from Dead Letter Queue
 */
export function useRestoreFromDeadLetter() {
  const queryClient = useQueryClient();

  return useMutation<DeadLetterRestoreResponse, Error, string>({
    mutationFn: (id: string) => syncAPI.restoreFromDeadLetter(id),
    onSuccess: () => {
      // Invalidate both DLQ and sync activity queries
      queryClient.invalidateQueries({ queryKey: deadLetterKeys.all });
      queryClient.invalidateQueries({ queryKey: syncActivityKeys.all });
    },
  });
}

/**
 * Hook to restore multiple items from Dead Letter Queue
 */
export function useRestoreFromDeadLetterMany() {
  const queryClient = useQueryClient();

  return useMutation<DeadLetterRestoreManyResponse, Error, string[]>({
    mutationFn: (ids: string[]) => syncAPI.restoreFromDeadLetterMany(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deadLetterKeys.all });
      queryClient.invalidateQueries({ queryKey: syncActivityKeys.all });
    },
  });
}

/**
 * Hook to delete an item from Dead Letter Queue permanently
 */
export function useDeleteDeadLetterItem() {
  const queryClient = useQueryClient();

  return useMutation<DeadLetterDeleteResponse, Error, string>({
    mutationFn: (id: string) => syncAPI.deleteDeadLetterItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deadLetterKeys.all });
    },
  });
}

/**
 * Hook to manually move an item to Dead Letter Queue
 */
export function useManualDeadLetter() {
  const queryClient = useQueryClient();

  return useMutation<DeadLetterManualResponse, Error, { id: string; reason?: string }>({
    mutationFn: ({ id, reason }) => syncAPI.manualDeadLetter(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deadLetterKeys.all });
      queryClient.invalidateQueries({ queryKey: syncActivityKeys.all });
    },
  });
}

/**
 * Hook to invalidate Dead Letter Queue queries
 */
export function useInvalidateDeadLetter() {
  const queryClient = useQueryClient();

  return {
    invalidateAll: () => queryClient.invalidateQueries({ queryKey: deadLetterKeys.all }),
    invalidateList: () => queryClient.invalidateQueries({ queryKey: deadLetterKeys.lists() }),
    invalidateStats: () => queryClient.invalidateQueries({ queryKey: deadLetterKeys.stats() }),
  };
}
