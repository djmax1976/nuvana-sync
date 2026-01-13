/**
 * Reports Query Hooks
 *
 * TanStack Query hooks for report generation.
 * Uses IPC transport to fetch data from main process.
 *
 * @module renderer/lib/hooks/useReports
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ipc,
  type WeeklyReportResponse,
  type MonthlyReportResponse,
  type DateRangeReportResponse,
} from '../transport';

// ============================================================================
// Query Keys
// ============================================================================

export const reportKeys = {
  all: ['reports'] as const,
  weekly: (weekStartDate: string) => [...reportKeys.all, 'weekly', weekStartDate] as const,
  monthly: (year: number, month: number) => [...reportKeys.all, 'monthly', year, month] as const,
  dateRange: (startDate: string, endDate: string) =>
    [...reportKeys.all, 'dateRange', startDate, endDate] as const,
};

// ============================================================================
// Report Hooks
// ============================================================================

/**
 * Hook to fetch weekly report
 * Requires MANAGER role
 */
export function useWeeklyReport(weekStartDate: string | null, options?: { enabled?: boolean }) {
  return useQuery<WeeklyReportResponse>({
    queryKey: reportKeys.weekly(weekStartDate!),
    queryFn: () => ipc.reports.weekly(weekStartDate!),
    enabled: options?.enabled !== false && weekStartDate !== null,
    staleTime: 300000, // 5 minutes
    refetchOnMount: true,
    refetchOnWindowFocus: false, // Don't refetch on focus since reports are expensive
  });
}

/**
 * Hook to fetch monthly report
 * Requires MANAGER role
 */
export function useMonthlyReport(
  year: number | null,
  month: number | null,
  options?: { enabled?: boolean }
) {
  return useQuery<MonthlyReportResponse>({
    queryKey: reportKeys.monthly(year!, month!),
    queryFn: () => ipc.reports.monthly({ year: year!, month: month! }),
    enabled: options?.enabled !== false && year !== null && month !== null,
    staleTime: 300000, // 5 minutes
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch date range report
 * Requires MANAGER role
 */
export function useDateRangeReport(
  startDate: string | null,
  endDate: string | null,
  options?: { enabled?: boolean }
) {
  return useQuery<DateRangeReportResponse>({
    queryKey: reportKeys.dateRange(startDate!, endDate!),
    queryFn: () => ipc.reports.dateRange({ startDate: startDate!, endDate: endDate! }),
    enabled: options?.enabled !== false && startDate !== null && endDate !== null,
    staleTime: 300000, // 5 minutes
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
}

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Hook to invalidate report queries
 */
export function useInvalidateReports() {
  const queryClient = useQueryClient();

  return {
    invalidateAll: () => queryClient.invalidateQueries({ queryKey: reportKeys.all }),
    invalidateWeekly: (weekStartDate: string) =>
      queryClient.invalidateQueries({ queryKey: reportKeys.weekly(weekStartDate) }),
    invalidateMonthly: (year: number, month: number) =>
      queryClient.invalidateQueries({ queryKey: reportKeys.monthly(year, month) }),
  };
}
