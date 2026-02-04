/**
 * Reports Data Hook
 *
 * Fetches and transforms shift data for the Reports page shift-by-day view.
 * Handles data transformation from IPC format to UI format including:
 * - Status mapping (DB → UI)
 * - Date string → Date object conversion
 * - Proper sorting (days desc, registers alpha, shifts by number)
 *
 * @module renderer/lib/hooks/useReportsData
 * @security FE-001: No dangerouslySetInnerHTML, all content is text
 * @security FE-003: No sensitive data exposure
 * @performance PERF-002: Uses useMemo for transformation, staleTime for caching
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ipc, type ShiftsByDayResponse, type ShiftByDayData } from '../transport';
import type { ReportShift } from '../../components/reports/ShiftTable';
import type { ReportShiftStatus } from '../../components/reports/ShiftStatusBadge';

// ============================================================================
// Query Keys
// ============================================================================

export const reportsDataKeys = {
  all: ['reportsData'] as const,
  shiftsByDays: (startDate: string, endDate: string) =>
    [...reportsDataKeys.all, 'shiftsByDays', startDate, endDate] as const,
};

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a day with its shifts for the reports view
 */
export interface ReportDay {
  /** Date object for display formatting */
  date: Date;
  /** Original business date string (YYYY-MM-DD) for use as key */
  businessDate: string;
  /** Day status from day_summaries table */
  dayStatus: 'OPEN' | 'CLOSED';
  /** Transformed shifts ready for UI components */
  shifts: ReportShift[];
}

/**
 * Parameters for the useReportsData hook
 */
export interface UseReportsDataParams {
  /** Start date in YYYY-MM-DD format */
  startDate: string;
  /** End date in YYYY-MM-DD format */
  endDate: string;
}

/**
 * Return type for the useReportsData hook
 */
export interface UseReportsDataReturn {
  /** Array of days with their shifts, sorted by date (desc) */
  days: ReportDay[];
  /** True while initial data is loading */
  isLoading: boolean;
  /** True if an error occurred */
  isError: boolean;
  /** Error object if an error occurred */
  error: Error | null;
  /** Function to manually refetch data */
  refetch: () => void;
}

// ============================================================================
// Status Mapping
// ============================================================================

/**
 * Map DB status to UI status
 *
 * Mapping rules:
 * - Shift OPEN → 'open' (shift still active, needs attention)
 * - Shift CLOSED + Day OPEN → 'closed' (shift done, day still active)
 * - Shift CLOSED + Day CLOSED → 'reconciled' (fully closed and reconciled)
 *
 * @param shiftStatus - Status from the shift record
 * @param dayStatus - Status from the day_summaries record
 * @returns UI status for display
 */
function mapShiftStatus(
  shiftStatus: 'OPEN' | 'CLOSED',
  dayStatus: 'OPEN' | 'CLOSED'
): ReportShiftStatus {
  if (shiftStatus === 'OPEN') {
    return 'open';
  }
  // Shift is CLOSED
  if (dayStatus === 'CLOSED') {
    return 'reconciled';
  }
  return 'closed';
}

// ============================================================================
// Data Transformation
// ============================================================================

/**
 * Transform a single shift from IPC format to UI format
 *
 * @param shift - Shift data from IPC response
 * @param dayStatus - Status of the day this shift belongs to
 * @returns Transformed shift ready for UI components
 */
function transformShift(shift: ShiftByDayData, dayStatus: 'OPEN' | 'CLOSED'): ReportShift {
  return {
    id: shift.shiftId,
    registerName: shift.registerName || 'Register',
    shiftNumber: shift.shiftNumber,
    // Parse time strings to Date objects
    // Use noon time (12:00:00) for date-only values to avoid timezone issues
    startTime: new Date(shift.startTime),
    // For open shifts with no end time, default to current time for display
    endTime: shift.endTime ? new Date(shift.endTime) : new Date(),
    employeeName: shift.employeeName || 'Unknown',
    status: mapShiftStatus(shift.status, dayStatus),
  };
}

/**
 * Transform IPC response to UI format
 *
 * PERF-002: Pure function for memoization
 *
 * @param data - Response from IPC channel
 * @returns Array of ReportDay objects ready for UI
 */
function transformShiftsByDays(data: ShiftsByDayResponse): ReportDay[] {
  return data.days.map((day) => ({
    date: new Date(day.businessDate + 'T12:00:00'),
    businessDate: day.businessDate,
    dayStatus: day.dayStatus,
    shifts: day.shifts.map((shift) => transformShift(shift, day.dayStatus)),
  }));
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook to fetch and transform shifts-by-day report data
 *
 * Fetches shifts for a date range with employee and register information,
 * then transforms the data to the format expected by UI components.
 *
 * @example
 * ```tsx
 * const { days, isLoading, error } = useReportsData({
 *   startDate: '2026-01-25',
 *   endDate: '2026-02-01',
 * });
 *
 * if (isLoading) return <Spinner />;
 * if (error) return <Error message={error.message} />;
 *
 * return days.map(day => (
 *   <DayAccordion key={day.businessDate} date={day.date} shifts={day.shifts} />
 * ));
 * ```
 *
 * @param params - Start and end dates for the report
 * @returns Days with shifts, loading state, and error state
 */
export function useReportsData(params: UseReportsDataParams): UseReportsDataReturn {
  const { startDate, endDate } = params;

  const query = useQuery<ShiftsByDayResponse>({
    queryKey: reportsDataKeys.shiftsByDays(startDate, endDate),
    queryFn: () => ipc.reports.getShiftsByDays({ startDate, endDate }),
    // Only run query when both dates are provided
    enabled: Boolean(startDate && endDate),
    // Cache for 1 minute - reports data doesn't change frequently
    staleTime: 60000,
    // Refresh on mount to ensure data is current
    refetchOnMount: true,
    // Refresh when window regains focus
    refetchOnWindowFocus: true,
  });

  // PERF-002: Memoize transformation to avoid recalculation on every render
  const days = useMemo(() => {
    if (!query.data) return [];
    return transformShiftsByDays(query.data);
  }, [query.data]);

  return {
    days,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
