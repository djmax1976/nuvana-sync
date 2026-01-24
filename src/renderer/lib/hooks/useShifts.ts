/**
 * Shifts Query Hooks
 *
 * TanStack Query hooks for shift management.
 * Uses IPC transport to fetch/mutate data from main process.
 *
 * @module renderer/lib/hooks/useShifts
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ipc,
  type ShiftResponse,
  type ShiftListParams,
  type ShiftListResponse,
  type ShiftSummaryResponse,
  type ShiftFuelDataResponse,
  type DailyFuelTotalsResponse,
} from '../transport';

// ============================================================================
// Query Keys
// ============================================================================

export const shiftKeys = {
  all: ['shifts'] as const,
  lists: () => [...shiftKeys.all, 'list'] as const,
  list: (params?: ShiftListParams) => [...shiftKeys.lists(), params || {}] as const,
  details: () => [...shiftKeys.all, 'detail'] as const,
  detail: (shiftId: string) => [...shiftKeys.details(), shiftId] as const,
  summaries: () => [...shiftKeys.all, 'summary'] as const,
  summary: (shiftId: string) => [...shiftKeys.summaries(), shiftId] as const,
  openShifts: () => [...shiftKeys.all, 'open'] as const,
  // Fuel data query keys
  fuelData: () => [...shiftKeys.all, 'fuel'] as const,
  shiftFuel: (shiftId: string) => [...shiftKeys.fuelData(), 'shift', shiftId] as const,
  dailyFuel: (businessDate: string) => [...shiftKeys.fuelData(), 'daily', businessDate] as const,
};

// ============================================================================
// List Hooks
// ============================================================================

/**
 * Hook to fetch shifts with optional filters
 */
export function useShifts(params?: ShiftListParams, options?: { enabled?: boolean }) {
  return useQuery<ShiftListResponse>({
    queryKey: shiftKeys.list(params),
    queryFn: () => ipc.shifts.list(params),
    enabled: options?.enabled !== false,
    staleTime: 30000, // 30 seconds
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to fetch open shifts for today
 */
export function useOpenShifts(options?: { enabled?: boolean }) {
  return useQuery<ShiftResponse[]>({
    queryKey: shiftKeys.openShifts(),
    queryFn: () => ipc.shifts.findOpenShifts(),
    enabled: options?.enabled !== false,
    staleTime: 10000, // 10 seconds - refresh frequently for open shifts
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}

// ============================================================================
// Detail Hooks
// ============================================================================

/**
 * Hook to fetch shift by ID
 */
export function useShift(shiftId: string | null, options?: { enabled?: boolean }) {
  return useQuery<ShiftResponse>({
    queryKey: shiftKeys.detail(shiftId!),
    queryFn: () => ipc.shifts.getById(shiftId!),
    enabled: options?.enabled !== false && shiftId !== null,
    staleTime: 30000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to fetch shift summary with transaction totals
 */
export function useShiftSummary(shiftId: string | null, options?: { enabled?: boolean }) {
  return useQuery<ShiftSummaryResponse>({
    queryKey: shiftKeys.summary(shiftId!),
    queryFn: () => ipc.shifts.getSummary(shiftId!),
    enabled: options?.enabled !== false && shiftId !== null,
    staleTime: 30000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook to close a shift
 * Requires MANAGER role
 */
export function useCloseShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shiftId: string) => ipc.shifts.close(shiftId),
    onSuccess: (_data, shiftId) => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists() });
      queryClient.invalidateQueries({ queryKey: shiftKeys.detail(shiftId) });
      queryClient.invalidateQueries({ queryKey: shiftKeys.openShifts() });
    },
  });
}

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Hook to invalidate shift queries
 */
export function useInvalidateShifts() {
  const queryClient = useQueryClient();

  return {
    invalidateAll: () => queryClient.invalidateQueries({ queryKey: shiftKeys.all }),
    invalidateList: () => queryClient.invalidateQueries({ queryKey: shiftKeys.lists() }),
    invalidateDetail: (shiftId: string) =>
      queryClient.invalidateQueries({ queryKey: shiftKeys.detail(shiftId) }),
    invalidateOpen: () => queryClient.invalidateQueries({ queryKey: shiftKeys.openShifts() }),
    invalidateFuel: () => queryClient.invalidateQueries({ queryKey: shiftKeys.fuelData() }),
    invalidateShiftFuel: (shiftId: string) =>
      queryClient.invalidateQueries({ queryKey: shiftKeys.shiftFuel(shiftId) }),
    invalidateDailyFuel: (businessDate: string) =>
      queryClient.invalidateQueries({ queryKey: shiftKeys.dailyFuel(businessDate) }),
  };
}

// ============================================================================
// Fuel Data Hooks
// ============================================================================

/**
 * Hook to fetch fuel data for a specific shift with inside/outside breakdown
 *
 * Returns MSM-sourced data when available, which includes:
 * - Inside fuel (cash) by grade with volume
 * - Outside fuel (credit/debit) by grade with volume
 * - Fuel discounts
 *
 * @param shiftId - Shift ID to get fuel data for
 * @param options - Query options
 */
export function useShiftFuelData(shiftId: string | null, options?: { enabled?: boolean }) {
  return useQuery<ShiftFuelDataResponse>({
    queryKey: shiftKeys.shiftFuel(shiftId!),
    queryFn: () => ipc.shifts.getFuelData(shiftId!),
    enabled: options?.enabled !== false && shiftId !== null,
    staleTime: 30000, // 30 seconds
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to fetch daily fuel totals with inside/outside breakdown
 *
 * Returns aggregated fuel data for a business date from:
 * - day_fuel_summaries (from MSM Period 1) - preferred
 * - shift_fuel_summaries (aggregated) - fallback
 *
 * @param businessDate - Business date (YYYY-MM-DD)
 * @param options - Query options
 */
export function useDailyFuelTotals(businessDate: string | null, options?: { enabled?: boolean }) {
  return useQuery<DailyFuelTotalsResponse>({
    queryKey: shiftKeys.dailyFuel(businessDate!),
    queryFn: () => ipc.shifts.getDailyFuelTotals(businessDate!),
    enabled: options?.enabled !== false && businessDate !== null,
    staleTime: 60000, // 1 minute - daily data changes less frequently
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}
