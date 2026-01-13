/**
 * useDateFormat Hook
 *
 * Provides timezone-aware date formatting functions that automatically
 * use the current store's timezone from context.
 *
 * This hook simplifies date formatting in components by removing the need
 * to pass timezone explicitly to every formatting call.
 */

"use client";

import { useStoreTimezone } from "@/contexts/StoreContext";
import {
  formatDateTime,
  formatDate,
  formatDateFull,
  formatTime,
  formatTimeWithSeconds,
  formatDateISO,
  formatDateTimeISO,
  formatDateShort,
  formatRelative,
  formatInStoreTime,
  formatDateRange,
  formatDateTimeRange,
  getTimezoneAbbr,
  toStoreTimezone,
  // Business date utilities (for YYYY-MM-DD conceptual dates, NOT timestamps)
  formatBusinessDate,
  formatBusinessDateFull,
  formatBusinessDateShort,
  formatBusinessDateCompact,
  getTodayBusinessDate,
  isBusinessDateToday,
  isValidBusinessDate,
  compareBusinessDates,
  extractBusinessDateFromTimestamp,
} from "@/utils/date-format.utils";

/**
 * Date formatting hook
 *
 * Returns formatting functions that automatically use the store's timezone.
 * All functions accept Date objects or ISO 8601 strings.
 *
 * **Note:** Functions like `formatDate` will throw `RangeError` for invalid date strings.
 * Wrap calls in try/catch blocks when dealing with potentially invalid input.
 *
 * @returns Object with formatting functions and timezone info
 *
 * @example
 * ```tsx
 * function TransactionRow({ transaction }: { transaction: Transaction }) {
 *   const { formatDateTime, formatDate, timezone } = useDateFormat();
 *
 *   return (
 *     <tr>
 *       <td>{formatDateTime(transaction.timestamp)}</td>
 *       <td>
 *         {(() => {
 *           try {
 *             return formatDate(transaction.created_at);
 *           } catch (error) {
 *             return 'Invalid date';
 *           }
 *         })()}
 *       </td>
 *       <td>Store Timezone: {timezone}</td>
 *     </tr>
 *   );
 * }
 * ```
 */
export function useDateFormat() {
  const timezone = useStoreTimezone();

  return {
    /**
     * Format date and time with timezone abbreviation
     * @example "Nov 25, 2025 10:30 PM MST"
     */
    formatDateTime: (date: Date | string) => formatDateTime(date, timezone),

    /**
     * Format date only (no time)
     * @example "Nov 25, 2025"
     * @throws {RangeError} If the date string is invalid or cannot be parsed
     */
    formatDate: (date: Date | string) => formatDate(date, timezone),

    /**
     * Format date in full format
     * @example "Monday, November 25, 2025"
     */
    formatDateFull: (date: Date | string) => formatDateFull(date, timezone),

    /**
     * Format time only (no date)
     * @example "10:30 PM"
     */
    formatTime: (date: Date | string) => formatTime(date, timezone),

    /**
     * Format time with seconds
     * @example "10:30:45 PM"
     */
    formatTimeWithSeconds: (date: Date | string) =>
      formatTimeWithSeconds(date, timezone),

    /**
     * Format date for API (YYYY-MM-DD)
     * @example "2025-11-25"
     */
    formatDateISO: (date: Date | string) => formatDateISO(date, timezone),

    /**
     * Format datetime for API (ISO 8601 in store timezone)
     * @example "2025-11-25T22:00:00"
     */
    formatDateTimeISO: (date: Date | string) =>
      formatDateTimeISO(date, timezone),

    /**
     * Format short date (MM/DD/YYYY)
     * @example "11/25/2025"
     */
    formatDateShort: (date: Date | string) => formatDateShort(date, timezone),

    /**
     * Format relative time
     * @example "2 hours ago" or absolute time if > 24 hours
     */
    formatRelative: (date: Date | string) => formatRelative(date, timezone),

    /**
     * Format with custom format string
     * @param date - Date to format
     * @param formatString - date-fns format string
     * @example formatCustom(date, 'yyyy-MM-dd HH:mm:ss')
     */
    formatCustom: (date: Date | string, formatString: string) =>
      formatInStoreTime(date, timezone, formatString),

    /**
     * Format date range
     * @example "Nov 25, 2025 - Nov 26, 2025"
     */
    formatDateRange: (startDate: Date | string, endDate: Date | string) =>
      formatDateRange(startDate, endDate, timezone),

    /**
     * Format datetime range
     * @example "Nov 25, 10:00 PM - Nov 26, 6:00 AM MST"
     */
    formatDateTimeRange: (startDate: Date | string, endDate: Date | string) =>
      formatDateTimeRange(startDate, endDate, timezone),

    /**
     * Convert UTC date to store timezone Date object
     */
    toStoreTimezone: (date: Date | string) => toStoreTimezone(date, timezone),

    /**
     * Get timezone abbreviation
     * @example "MST" or "MDT"
     */
    getTimezoneAbbr: (date?: Date) => getTimezoneAbbr(timezone, date),

    /**
     * Current store timezone (IANA format)
     * @example "America/Denver"
     */
    timezone,

    // =========================================================================
    // BUSINESS DATE UTILITIES
    // =========================================================================
    // These are for YYYY-MM-DD conceptual dates (e.g., business_date field),
    // NOT for ISO timestamps. Business dates should be displayed AS-IS without
    // timezone conversion.

    /**
     * Format business date (YYYY-MM-DD) for display.
     * Use for `business_date` fields that represent conceptual days.
     * @example formatBusinessDate("2026-01-06") → "January 6, 2026"
     */
    formatBusinessDate: (
      dateStr: string | null | undefined,
      formatString?: string,
    ) => formatBusinessDate(dateStr, formatString),

    /**
     * Format business date in full format with day of week.
     * @example formatBusinessDateFull("2026-01-06") → "Tuesday, January 6, 2026"
     */
    formatBusinessDateFull: (dateStr: string | null | undefined) =>
      formatBusinessDateFull(dateStr),

    /**
     * Format business date in short format.
     * @example formatBusinessDateShort("2026-01-06") → "Jan 6, 2026"
     */
    formatBusinessDateShort: (dateStr: string | null | undefined) =>
      formatBusinessDateShort(dateStr),

    /**
     * Format business date for compact display.
     * @example formatBusinessDateCompact("2026-01-06") → "01/06/2026"
     */
    formatBusinessDateCompact: (dateStr: string | null | undefined) =>
      formatBusinessDateCompact(dateStr),

    /**
     * Get today's date as a business date string using store timezone.
     * @example getTodayBusinessDate() → "2026-01-06"
     */
    getTodayBusinessDate: () => getTodayBusinessDate(timezone),

    /**
     * Check if a business date is "today" in the store's timezone.
     * @example isBusinessDateToday("2026-01-06") → true/false
     */
    isBusinessDateToday: (dateStr: string | null | undefined) =>
      isBusinessDateToday(dateStr, timezone),

    /**
     * Validate if a string is a valid business date format (YYYY-MM-DD).
     * @example isValidBusinessDate("2026-01-06") → true
     */
    isValidBusinessDate,

    /**
     * Compare two business dates.
     * @returns -1 if a < b, 0 if equal, 1 if a > b, null if invalid
     */
    compareBusinessDates,

    /**
     * Extract business date from an ISO timestamp using store timezone.
     * Use this when you need to derive a business date from a timestamp.
     * @example extractBusinessDateFromTimestamp("2026-01-06T22:05:45Z") → "2026-01-06"
     */
    extractBusinessDateFromTimestamp: (
      isoTimestamp: string | null | undefined,
    ) => extractBusinessDateFromTimestamp(isoTimestamp, timezone),
  };
}
