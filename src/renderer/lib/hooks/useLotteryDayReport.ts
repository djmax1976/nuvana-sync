/**
 * Lottery Day Report Hook
 *
 * Fetches lottery day report data for a specific business date.
 * Returns read-only data for the lottery day report page including
 * bin closings, activated/depleted/returned packs.
 *
 * @module renderer/lib/hooks/useLotteryDayReport
 * @security FE-001: XSS prevention via React's automatic escaping
 * @security SEC-014: Type-safe IPC communication
 * @performance PERF-002: Uses staleTime for caching, refetchOnMount for freshness
 */

import { useQuery } from '@tanstack/react-query';
import { ipc, type LotteryDayReportResponse } from '../transport';

// ============================================================================
// Query Keys
// ============================================================================

export const lotteryDayReportKeys = {
  all: ['lotteryDayReport'] as const,
  byDate: (businessDate: string) => [...lotteryDayReportKeys.all, businessDate] as const,
};

// ============================================================================
// Hook
// ============================================================================

export interface UseLotteryDayReportParams {
  businessDate: string; // YYYY-MM-DD
}

export interface UseLotteryDayReportReturn {
  data: LotteryDayReportResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * Hook to fetch lottery day report for a specific business date
 *
 * @param params - Contains businessDate in YYYY-MM-DD format
 * @returns Query result with lottery day report data
 *
 * @security SEC-014: Input validated by IPC handler (Zod schema)
 * @security DB-006: Store-scoped queries enforced by IPC handler
 */
export function useLotteryDayReport({
  businessDate,
}: UseLotteryDayReportParams): UseLotteryDayReportReturn {
  const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(businessDate);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: lotteryDayReportKeys.byDate(businessDate),
    queryFn: () => ipc.reports.getLotteryDayReport({ businessDate }),
    enabled: isValidDate,
    staleTime: 60000, // 1 minute — report data for closed days rarely changes
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  return {
    data,
    isLoading,
    isError,
    error: error instanceof Error ? error : null,
  };
}
