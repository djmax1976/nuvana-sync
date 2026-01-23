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
