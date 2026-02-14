/**
 * Local IPC Shift Hooks
 *
 * TanStack Query hooks for shift data via local IPC transport.
 * These hooks query the local SQLite database directly without cloud API.
 *
 * Story: DayClosePage Local IPC Migration
 *
 * @module renderer/hooks/useLocalShifts
 * @security DB-006: All queries are store-scoped via backend handlers
 * @security SEC-006: All queries use parameterized statements in backend
 * @security API-001: Zod validation on all IPC inputs (backend)
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ipc,
  type OpenShiftsResponse,
  type ShiftResponse,
  type ShiftCloseResponse,
} from '../lib/transport';

// ============================================================================
// Query Keys
// ============================================================================

/**
 * Query key factory for local shift queries
 * Namespaced under 'local' to avoid collision with cloud API hooks
 */
export const localShiftsKeys = {
  all: ['local', 'shifts'] as const,
  openShifts: () => [...localShiftsKeys.all, 'open'] as const,
  detail: (shiftId: string | null | undefined) =>
    [...localShiftsKeys.all, 'detail', shiftId] as const,
};

// ============================================================================
// Types
// ============================================================================

/**
 * Open shift data for DayClosePage display
 * Pre-resolved names from backend for efficient rendering
 */
export interface LocalOpenShift {
  shift_id: string;
  terminal_name: string;
  cashier_name: string;
  shift_number: number;
  status: 'OPEN' | 'CLOSED';
  external_register_id: string | null;
  business_date: string;
  start_time: string | null;
}

/**
 * Response type for useLocalOpenShiftsCheck
 */
export interface LocalOpenShiftsData {
  open_shifts: LocalOpenShift[];
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to check for open shifts via local IPC
 *
 * Used by DayClosePage to display which shifts need to be closed before
 * closing the lottery day. Returns open shifts with pre-resolved terminal
 * and cashier names for efficient rendering.
 *
 * @security DB-006: Store-scoped via backend handler (getConfiguredStore)
 * @security SEC-006: Parameterized queries in backend DAL
 *
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with open shifts data
 *
 * @example
 * ```tsx
 * const { data, isLoading, error } = useLocalOpenShiftsCheck();
 *
 * if (data?.open_shifts.length > 0) {
 *   // Show blocking banner with open shift details
 * }
 * ```
 */
export function useLocalOpenShiftsCheck(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: localShiftsKeys.openShifts(),
    queryFn: async (): Promise<LocalOpenShiftsData> => {
      const response = await ipc.shifts.getOpenShifts();
      return response as OpenShiftsResponse;
    },
    enabled: options?.enabled !== false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 5000, // Consider stale after 5 seconds - shifts can change frequently
    retry: 2,
  });
}

/**
 * Hook to fetch shift detail by ID via local IPC
 *
 * Used by DayClosePage to display current shift information
 * (terminal, cashier, status, times).
 *
 * @security DB-006: Store-scoped via backend handler
 * @security SEC-006: Parameterized query with shift_id parameter
 *
 * @param shiftId - Shift UUID to fetch
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with shift data
 *
 * @example
 * ```tsx
 * const { data: shift, isLoading } = useLocalShiftDetail(currentShiftId);
 *
 * if (shift) {
 *   // Display shift info: shift.status, shift.start_time
 * }
 * ```
 */
export function useLocalShiftDetail(
  shiftId: string | null | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: localShiftsKeys.detail(shiftId),
    queryFn: async (): Promise<ShiftResponse> => {
      if (!shiftId) {
        throw new Error('Shift ID is required');
      }
      const response = await ipc.shifts.getById(shiftId);
      return response;
    },
    enabled: options?.enabled !== false && !!shiftId,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    staleTime: 30000, // Consider stale after 30 seconds
    retry: 2,
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Input for local shift close mutation
 *
 * @security SEC-014: shiftId must be a valid UUID (validated by backend handler)
 * @security API-001: closingCash validated as non-negative number (backend)
 */
export interface LocalCloseShiftInput {
  /** UUID of the shift to close */
  shiftId: string;
  /** Non-negative cash amount in drawer at close */
  closingCash: number;
}

/**
 * Hook to close a shift via local IPC with closing cash amount
 *
 * Used by ShiftClosingForm in the Day Close wizard (Step 3).
 * Closes the shift locally in SQLite and enqueues sync to cloud.
 *
 * Query Invalidation on Success:
 * - ['local', 'shifts'] - Refresh all local shift data
 * - ['local', 'shifts', 'open'] - Refresh open shifts check
 * - ['lottery', 'dayBins'] - Refresh lottery page (bins may depend on shift state)
 *
 * @security API-001: Input validated via Zod schema in backend handler
 * @security SEC-014: shiftId validated as UUID in backend handler
 * @security SEC-006: Parameterized queries in backend DAL
 * @security DB-006: Store-scoped via backend handler (getConfiguredStore)
 * @security SYNC-001: Closed shift enqueued for cloud sync
 *
 * @returns TanStack mutation with isPending, isSuccess, isError, error, mutate, mutateAsync
 *
 * @example
 * ```tsx
 * const { mutateAsync: closeShift, isPending, error } = useLocalCloseShift();
 *
 * const handleClose = async (values: FormValues) => {
 *   try {
 *     const result = await closeShift({
 *       shiftId: currentShiftId,
 *       closingCash: values.closingCash,
 *     });
 *     toast.success(`Shift closed with $${result.closing_cash.toFixed(2)} cash`);
 *   } catch (err) {
 *     toast.error(err instanceof Error ? err.message : 'Failed to close shift');
 *   }
 * };
 * ```
 */
export function useLocalCloseShift() {
  const queryClient = useQueryClient();

  return useMutation<ShiftCloseResponse, Error, LocalCloseShiftInput>({
    mutationFn: ({ shiftId, closingCash }: LocalCloseShiftInput) =>
      ipc.shifts.close(shiftId, closingCash),
    onSuccess: (_data, { shiftId }) => {
      // Invalidate local shift queries to refresh UI state
      // Using localShiftsKeys for consistency with other local hooks
      queryClient.invalidateQueries({ queryKey: localShiftsKeys.all });
      queryClient.invalidateQueries({ queryKey: localShiftsKeys.openShifts() });
      queryClient.invalidateQueries({ queryKey: localShiftsKeys.detail(shiftId) });

      // Invalidate lottery dayBins as they may depend on shift state
      // The lottery page shows bins for the current open shift period
      queryClient.invalidateQueries({ queryKey: ['lottery', 'dayBins'] });
    },
  });
}
