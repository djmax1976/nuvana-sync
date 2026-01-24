/**
 * Day Summaries Query Hooks
 *
 * TanStack Query hooks for day summary management.
 * Uses IPC transport to fetch/mutate data from main process.
 *
 * @module renderer/lib/hooks/useDaySummaries
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ipc,
  type DaySummaryResponse,
  type DaySummaryListParams,
  type DaySummaryListResponse,
  type DaySummaryWithShiftsResponse,
} from '../transport';
import { shiftKeys } from './useShifts';

// ============================================================================
// Query Keys
// ============================================================================

export const daySummaryKeys = {
  all: ['daySummaries'] as const,
  lists: () => [...daySummaryKeys.all, 'list'] as const,
  list: (params?: DaySummaryListParams) => [...daySummaryKeys.lists(), params || {}] as const,
  details: () => [...daySummaryKeys.all, 'detail'] as const,
  detail: (date: string) => [...daySummaryKeys.details(), date] as const,
};

// ============================================================================
// List Hooks
// ============================================================================

/**
 * Hook to fetch day summaries with optional filters
 */
export function useDaySummaries(params?: DaySummaryListParams, options?: { enabled?: boolean }) {
  return useQuery<DaySummaryListResponse>({
    queryKey: daySummaryKeys.list(params),
    queryFn: () => ipc.daySummaries.list(params),
    enabled: options?.enabled !== false,
    staleTime: 60000, // 1 minute
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}

// ============================================================================
// Detail Hooks
// ============================================================================

/**
 * Hook to fetch day summary by date with associated shifts
 */
export function useDaySummary(date: string | null, options?: { enabled?: boolean }) {
  return useQuery<DaySummaryWithShiftsResponse>({
    queryKey: daySummaryKeys.detail(date!),
    queryFn: () => ipc.daySummaries.getByDate(date!),
    enabled: options?.enabled !== false && date !== null,
    staleTime: 60000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to close a business day
 * Requires MANAGER role
 * Will fail if there are open shifts
 */
export function useCloseDay() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (date: string) => ipc.daySummaries.close(date),
    onSuccess: (_data, date) => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: daySummaryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: daySummaryKeys.detail(date) });
      // Also invalidate shifts since closing day affects shift visibility
      queryClient.invalidateQueries({ queryKey: shiftKeys.all });
    },
  });
}

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Hook to invalidate day summary queries
 */
export function useInvalidateDaySummaries() {
  const queryClient = useQueryClient();

  return {
    invalidateAll: () => queryClient.invalidateQueries({ queryKey: daySummaryKeys.all }),
    invalidateList: () => queryClient.invalidateQueries({ queryKey: daySummaryKeys.lists() }),
    invalidateDetail: (date: string) =>
      queryClient.invalidateQueries({ queryKey: daySummaryKeys.detail(date) }),
  };
}
