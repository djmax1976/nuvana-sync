/**
 * View Data Hooks
 *
 * TanStack Query hooks for read-only view pages (ViewShiftPage, ViewDayPage).
 * These hooks fetch comprehensive data for displaying closed shifts and days.
 *
 * Story: Shift/Day View Pages - Phase 3 Data Integration
 *
 * @module renderer/hooks/useViewData
 * @security DB-006: All queries are store-scoped via backend handlers
 * @security SEC-006: All queries use parameterized statements in backend
 * @security API-001: Zod validation on all IPC inputs (backend)
 * @security API-008: Only whitelisted fields returned (OUTPUT_FILTERING)
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { ipc, type ShiftViewDataResponse, type DayViewDataResponse } from '../lib/transport';

// ============================================================================
// Query Keys
// ============================================================================

/**
 * Query key factory for view data queries
 * Namespaced under 'view' for clarity
 */
export const viewDataKeys = {
  all: ['view'] as const,
  shifts: () => [...viewDataKeys.all, 'shifts'] as const,
  shift: (shiftId: string | null | undefined) => [...viewDataKeys.shifts(), shiftId] as const,
  days: () => [...viewDataKeys.all, 'days'] as const,
  day: (dayId: string | null | undefined) => [...viewDataKeys.days(), dayId] as const,
};

// ============================================================================
// Shift View Data Hook
// ============================================================================

/**
 * Hook to fetch comprehensive shift view data for ViewShiftPage
 *
 * Fetches all data needed to render a closed shift's details including:
 * - Shift info (terminal, cashier, times, cash amounts)
 * - Summary cards (inside sales, fuel sales, lottery sales)
 * - Payment methods (receipts, payouts, net cash)
 * - Sales breakdown (by category)
 *
 * @security DB-006: Store-scoped via backend handler (getConfiguredStore)
 * @security SEC-006: Parameterized query with shift_id parameter
 * @security API-008: Only whitelisted fields returned in response
 *
 * @param shiftId - UUID of the shift to fetch view data for
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with shift view data
 *
 * @example
 * ```tsx
 * const { data, isLoading, error } = useShiftViewData(shiftId);
 *
 * if (data) {
 *   // Render ViewShiftPage with data.shiftInfo, data.summary, etc.
 * }
 * ```
 */
export function useShiftViewData(
  shiftId: string | null | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: viewDataKeys.shift(shiftId),
    queryFn: async (): Promise<ShiftViewDataResponse> => {
      if (!shiftId) {
        throw new Error('Shift ID is required');
      }
      const response = await ipc.shifts.getViewData(shiftId);
      return response;
    },
    enabled: options?.enabled !== false && !!shiftId,
    refetchOnMount: true,
    refetchOnWindowFocus: false, // View pages are read-only, no need to refetch
    staleTime: 60000, // Consider stale after 1 minute - closed shift data doesn't change
    retry: 2,
  });
}

// ============================================================================
// Day View Data Hook
// ============================================================================

/**
 * Hook to fetch comprehensive day view data for ViewDayPage
 *
 * Fetches all data needed to render a closed day's details including:
 * - Day info (business date, shift count, times, cash amounts)
 * - Summary cards (aggregated inside sales, fuel sales, lottery sales)
 * - Payment methods (receipts, payouts, net cash)
 * - Sales breakdown (by category)
 * - Lottery day ID for lottery components
 *
 * @security DB-006: Store-scoped via backend handler (getConfiguredStore)
 * @security SEC-006: Parameterized query with day_id parameter
 * @security API-008: Only whitelisted fields returned in response
 *
 * @param dayId - UUID of the day summary to fetch view data for
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with day view data
 *
 * @example
 * ```tsx
 * const { data, isLoading, error } = useDayViewData(dayId);
 *
 * if (data) {
 *   // Render ViewDayPage with data.dayInfo, data.summary, etc.
 *   // Pass data.lotteryDayId to lottery components
 * }
 * ```
 */
export function useDayViewData(dayId: string | null | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: viewDataKeys.day(dayId),
    queryFn: async (): Promise<DayViewDataResponse> => {
      if (!dayId) {
        throw new Error('Day ID is required');
      }
      const response = await ipc.days.getViewData(dayId);
      return response;
    },
    enabled: options?.enabled !== false && !!dayId,
    refetchOnMount: true,
    refetchOnWindowFocus: false, // View pages are read-only, no need to refetch
    staleTime: 60000, // Consider stale after 1 minute - closed day data doesn't change
    retry: 2,
  });
}
