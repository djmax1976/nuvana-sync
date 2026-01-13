/**
 * Frontend Date Formatting Utilities
 *
 * Provides timezone-aware date formatting for UI components.
 * All dates are received from API as ISO 8601 UTC strings and
 * converted to store timezone for display.
 */

import { format, isValid, parseISO } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";

// =============================================================================
// BUSINESS DATE UTILITIES
// =============================================================================
//
// Business dates are conceptual day identifiers (YYYY-MM-DD), NOT timestamps.
// They represent a logical business day independent of timezone.
//
// CRITICAL: Never use `new Date("YYYY-MM-DD")` directly - it interprets as
// UTC midnight, which displays as the wrong date in local timezones.
//
// Example of the bug:
//   new Date("2026-01-06")          → 2026-01-06T00:00:00.000Z (UTC midnight)
//   In Eastern Time (UTC-5):        → January 5, 2026 at 7:00 PM (WRONG!)
//
// =============================================================================

/**
 * Regular expression to validate business date format (YYYY-MM-DD).
 *
 * Matches:
 * - 4 digit year (1000-9999)
 * - 2 digit month (01-12)
 * - 2 digit day (01-31)
 *
 * Note: This validates format only, not semantic validity (e.g., 2026-02-31).
 * Use `isValidBusinessDate()` for full validation.
 */
const BUSINESS_DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Type guard to check if a string is a valid business date format.
 *
 * Validates both format (YYYY-MM-DD) and semantic validity (actual date exists).
 *
 * @param value - String to validate
 * @returns True if valid business date format
 *
 * @example
 * isValidBusinessDate("2026-01-06"); // true
 * isValidBusinessDate("2026-02-31"); // false (invalid day)
 * isValidBusinessDate("01-06-2026"); // false (wrong format)
 * isValidBusinessDate("2026-1-6");   // false (must be zero-padded)
 */
export function isValidBusinessDate(value: string): boolean {
  if (!value || typeof value !== "string") {
    return false;
  }

  // Check format first (fast path)
  if (!BUSINESS_DATE_REGEX.test(value)) {
    return false;
  }

  // Validate semantic correctness (the date actually exists)
  // Parse with time component to avoid UTC interpretation issues
  const parsed = new Date(value + "T12:00:00");
  if (!isValid(parsed)) {
    return false;
  }

  // Verify the parsed date matches the input (catches invalid dates like Feb 31)
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const reconstructed = `${year}-${month}-${day}`;

  return reconstructed === value;
}

/**
 * Format business date (YYYY-MM-DD) for display.
 *
 * Business dates are conceptual day identifiers, NOT timestamps.
 * They must be displayed AS-IS without timezone conversion.
 *
 * Why this exists:
 * - `new Date("2026-01-06")` → UTC midnight → Wrong date in local time
 * - This function treats the date as local noon → Correct date display
 *
 * Security: Returns fallback for invalid input, never throws to prevent DoS.
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param formatString - date-fns format string (default: "MMMM d, yyyy")
 * @returns Formatted date string, or em-dash for invalid/empty input
 *
 * @example
 * formatBusinessDate("2026-01-06");
 * // Returns: "January 6, 2026" (CORRECT - not January 5!)
 *
 * formatBusinessDate("2026-01-06", "MMM d, yyyy");
 * // Returns: "Jan 6, 2026"
 *
 * formatBusinessDate("invalid");
 * // Returns: "—"
 */
export function formatBusinessDate(
  dateStr: string | null | undefined,
  formatString: string = "MMMM d, yyyy",
): string {
  // Handle null/undefined/empty
  if (!dateStr) {
    return "—";
  }

  // Type check for runtime safety
  if (typeof dateStr !== "string") {
    return "—";
  }

  // Validate format before processing
  if (!isValidBusinessDate(dateStr)) {
    // Return original string for display if it looks date-like but invalid format
    // This prevents data loss while indicating something is wrong
    return dateStr;
  }

  // Parse as local noon to avoid any timezone edge cases
  // Using T12:00:00 ensures we're solidly in the middle of the day
  // regardless of the browser's timezone
  const localDate = new Date(dateStr + "T12:00:00");

  // Final safety check (should never fail after isValidBusinessDate)
  if (!isValid(localDate)) {
    return dateStr;
  }

  return format(localDate, formatString);
}

/**
 * Extract the day number from a business date string.
 *
 * Business dates are conceptual day identifiers, NOT timestamps.
 * This function extracts the day of month without timezone conversion issues.
 *
 * Why this exists:
 * - `new Date("2026-01-06").getDate()` → UTC midnight → Wrong day in local time
 * - This function parses as local noon → Correct day extraction
 *
 * Security: Returns null for invalid input, never throws to prevent DoS.
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Day of month (1-31), or null if invalid
 *
 * @example
 * extractDayFromBusinessDate("2026-01-06");
 * // Returns: 6 (CORRECT - not 5!)
 *
 * extractDayFromBusinessDate("2026-01-31");
 * // Returns: 31
 *
 * extractDayFromBusinessDate("invalid");
 * // Returns: null
 */
export function extractDayFromBusinessDate(
  dateStr: string | null | undefined,
): number | null {
  // Handle null/undefined/empty
  if (!dateStr) {
    return null;
  }

  // Type check for runtime safety
  if (typeof dateStr !== "string") {
    return null;
  }

  // Validate format before processing
  if (!isValidBusinessDate(dateStr)) {
    return null;
  }

  // Parse as local noon to avoid any timezone edge cases
  // Using T12:00:00 ensures we're solidly in the middle of the day
  // regardless of the browser's timezone
  const localDate = new Date(dateStr + "T12:00:00");

  // Final safety check (should never fail after isValidBusinessDate)
  if (!isValid(localDate)) {
    return null;
  }

  return localDate.getDate();
}

/**
 * Format business date in full format with day of week.
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Formatted date string (e.g., "Monday, January 6, 2026")
 *
 * @example
 * formatBusinessDateFull("2026-01-06");
 * // Returns: "Tuesday, January 6, 2026"
 */
export function formatBusinessDateFull(
  dateStr: string | null | undefined,
): string {
  return formatBusinessDate(dateStr, "EEEE, MMMM d, yyyy");
}

/**
 * Format business date in short format.
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Formatted date string (e.g., "Jan 6, 2026")
 *
 * @example
 * formatBusinessDateShort("2026-01-06");
 * // Returns: "Jan 6, 2026"
 */
export function formatBusinessDateShort(
  dateStr: string | null | undefined,
): string {
  return formatBusinessDate(dateStr, "MMM d, yyyy");
}

/**
 * Format business date for compact display (MM/DD/YYYY).
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Formatted date string (e.g., "01/06/2026")
 *
 * @example
 * formatBusinessDateCompact("2026-01-06");
 * // Returns: "01/06/2026"
 */
export function formatBusinessDateCompact(
  dateStr: string | null | undefined,
): string {
  return formatBusinessDate(dateStr, "MM/dd/yyyy");
}

/**
 * Get today's date as a business date string (YYYY-MM-DD).
 *
 * Uses store timezone to determine "today" correctly. This is critical for
 * overnight operations where the browser's local time may differ from the
 * store's local time.
 *
 * @param storeTimezone - IANA timezone string (e.g., "America/New_York")
 * @returns Today's date in YYYY-MM-DD format in the store's timezone
 *
 * @example
 * // At 11 PM UTC on Jan 5, 2026:
 * getTodayBusinessDate("America/New_York");
 * // Returns: "2026-01-05" (6 PM in NYC)
 *
 * getTodayBusinessDate("Asia/Tokyo");
 * // Returns: "2026-01-06" (8 AM in Tokyo)
 */
export function getTodayBusinessDate(storeTimezone: string): string {
  if (!storeTimezone || typeof storeTimezone !== "string") {
    // Fallback to UTC if timezone is invalid - log would be ideal here
    // but we avoid side effects in utility functions
    return formatInTimeZone(new Date(), "UTC", "yyyy-MM-dd");
  }

  try {
    return formatInTimeZone(new Date(), storeTimezone, "yyyy-MM-dd");
  } catch {
    // Invalid timezone string - fallback to UTC
    return formatInTimeZone(new Date(), "UTC", "yyyy-MM-dd");
  }
}

/**
 * Check if a business date is "today" in the store's timezone.
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param storeTimezone - IANA timezone string (e.g., "America/New_York")
 * @returns True if the date matches today in the store's timezone
 *
 * @example
 * // At 11 PM UTC on Jan 5, 2026:
 * isBusinessDateToday("2026-01-05", "America/New_York");
 * // Returns: true (it's 6 PM on Jan 5 in NYC)
 *
 * isBusinessDateToday("2026-01-06", "America/New_York");
 * // Returns: false
 */
export function isBusinessDateToday(
  dateStr: string | null | undefined,
  storeTimezone: string,
): boolean {
  if (!dateStr || !isValidBusinessDate(dateStr)) {
    return false;
  }

  const today = getTodayBusinessDate(storeTimezone);
  return dateStr === today;
}

/**
 * Compare two business dates.
 *
 * @param dateA - First date string in YYYY-MM-DD format
 * @param dateB - Second date string in YYYY-MM-DD format
 * @returns -1 if dateA < dateB, 0 if equal, 1 if dateA > dateB, or null if invalid
 *
 * @example
 * compareBusinessDates("2026-01-05", "2026-01-06"); // -1
 * compareBusinessDates("2026-01-06", "2026-01-06"); // 0
 * compareBusinessDates("2026-01-07", "2026-01-06"); // 1
 * compareBusinessDates("invalid", "2026-01-06");   // null
 */
export function compareBusinessDates(
  dateA: string | null | undefined,
  dateB: string | null | undefined,
): -1 | 0 | 1 | null {
  if (!dateA || !dateB) {
    return null;
  }

  if (!isValidBusinessDate(dateA) || !isValidBusinessDate(dateB)) {
    return null;
  }

  // String comparison works for YYYY-MM-DD format
  if (dateA < dateB) return -1;
  if (dateA > dateB) return 1;
  return 0;
}

/**
 * Extract business date from an ISO timestamp using store timezone.
 *
 * This is the correct way to get a business date from a timestamp.
 * The timestamp is converted to the store's timezone before extracting the date.
 *
 * @param isoTimestamp - ISO 8601 timestamp string (e.g., "2026-01-06T22:05:45Z")
 * @param storeTimezone - IANA timezone string (e.g., "America/New_York")
 * @returns Business date in YYYY-MM-DD format, or null if invalid
 *
 * @example
 * // A shift opened at 10 PM UTC on Jan 6
 * extractBusinessDateFromTimestamp("2026-01-06T22:05:45Z", "America/New_York");
 * // Returns: "2026-01-06" (5:05 PM ET on Jan 6)
 *
 * // Same timestamp in Tokyo is already Jan 7
 * extractBusinessDateFromTimestamp("2026-01-06T22:05:45Z", "Asia/Tokyo");
 * // Returns: "2026-01-07" (7:05 AM JST on Jan 7)
 */
export function extractBusinessDateFromTimestamp(
  isoTimestamp: string | null | undefined,
  storeTimezone: string,
): string | null {
  if (!isoTimestamp || typeof isoTimestamp !== "string") {
    return null;
  }

  if (!storeTimezone || typeof storeTimezone !== "string") {
    return null;
  }

  try {
    // Parse the ISO timestamp
    const date = parseISO(isoTimestamp);
    if (!isValid(date)) {
      return null;
    }

    // Format in store timezone to get the business date
    return formatInTimeZone(date, storeTimezone, "yyyy-MM-dd");
  } catch {
    return null;
  }
}

/**
 * Format date in store timezone with custom format string
 *
 * @param date - Date object or ISO 8601 string
 * @param storeTimezone - IANA timezone string (e.g., "America/Denver")
 * @param formatString - date-fns format string
 * @returns Formatted date string
 *
 * @example
 * formatInStoreTime(
 *   '2025-11-26T05:00:00Z',
 *   'America/Denver',
 *   'MMM d, yyyy h:mm a zzz'
 * );
 * // Returns: "Nov 25, 2025 10:00 PM MST"
 */
export function formatInStoreTime(
  date: Date | string,
  storeTimezone: string,
  formatString: string,
): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(dateObj, storeTimezone, formatString);
}

/**
 * Format date and time with timezone abbreviation
 *
 * @param date - Date object or ISO 8601 string
 * @param storeTimezone - IANA timezone string
 * @returns Formatted string: "Nov 25, 2025 10:30 PM MST"
 *
 * @example
 * formatDateTime('2025-11-26T05:30:00Z', 'America/Denver');
 * // Returns: "Nov 25, 2025 10:30 PM MST"
 */
export function formatDateTime(
  date: Date | string,
  storeTimezone: string,
): string {
  return formatInStoreTime(date, storeTimezone, "MMM d, yyyy h:mm a zzz");
}

/**
 * Format date only (no time)
 *
 * @param date - Date object or ISO 8601 string
 * @param storeTimezone - IANA timezone string
 * @returns Formatted string: "Nov 25, 2025"
 * @throws {RangeError} If the date string is invalid or cannot be parsed
 *
 * @example
 * formatDate('2025-11-26T05:00:00Z', 'America/Denver');
 * // Returns: "Nov 25, 2025"
 *
 * @example
 * // Invalid dates will throw RangeError
 * try {
 *   formatDate('invalid', 'America/Denver');
 * } catch (error) {
 *   // Handle RangeError
 * }
 */
export function formatDate(date: Date | string, storeTimezone: string): string {
  return formatInStoreTime(date, storeTimezone, "MMM d, yyyy");
}

/**
 * Format date in full format
 *
 * @param date - Date object or ISO 8601 string
 * @param storeTimezone - IANA timezone string
 * @returns Formatted string: "Monday, November 25, 2025"
 *
 * @example
 * formatDateFull('2025-11-26T05:00:00Z', 'America/Denver');
 * // Returns: "Monday, November 25, 2025"
 */
export function formatDateFull(
  date: Date | string,
  storeTimezone: string,
): string {
  return formatInStoreTime(date, storeTimezone, "EEEE, MMMM d, yyyy");
}

/**
 * Format time only (no date)
 *
 * @param date - Date object or ISO 8601 string
 * @param storeTimezone - IANA timezone string
 * @returns Formatted string: "10:30 PM"
 *
 * @example
 * formatTime('2025-11-26T05:30:00Z', 'America/Denver');
 * // Returns: "10:30 PM"
 */
export function formatTime(date: Date | string, storeTimezone: string): string {
  return formatInStoreTime(date, storeTimezone, "h:mm a");
}

/**
 * Format time with seconds
 *
 * @param date - Date object or ISO 8601 string
 * @param storeTimezone - IANA timezone string
 * @returns Formatted string: "10:30:45 PM"
 *
 * @example
 * formatTimeWithSeconds('2025-11-26T05:30:45Z', 'America/Denver');
 * // Returns: "10:30:45 PM"
 */
export function formatTimeWithSeconds(
  date: Date | string,
  storeTimezone: string,
): string {
  return formatInStoreTime(date, storeTimezone, "h:mm:ss a");
}

/**
 * Format date for API (YYYY-MM-DD)
 *
 * @param date - Date object or ISO 8601 string
 * @param storeTimezone - IANA timezone string
 * @returns Formatted string: "2025-11-25"
 *
 * @example
 * formatDateISO('2025-11-26T05:00:00Z', 'America/Denver');
 * // Returns: "2025-11-25"
 */
export function formatDateISO(
  date: Date | string,
  storeTimezone: string,
): string {
  return formatInStoreTime(date, storeTimezone, "yyyy-MM-dd");
}

/**
 * Format date and time for API (ISO 8601 format in store timezone)
 *
 * @param date - Date object or ISO 8601 string
 * @param storeTimezone - IANA timezone string
 * @returns Formatted string: "2025-11-25T22:00:00"
 *
 * @example
 * formatDateTimeISO('2025-11-26T05:00:00Z', 'America/Denver');
 * // Returns: "2025-11-25T22:00:00"
 */
export function formatDateTimeISO(
  date: Date | string,
  storeTimezone: string,
): string {
  return formatInStoreTime(date, storeTimezone, "yyyy-MM-dd'T'HH:mm:ss");
}

/**
 * Format short date (MM/DD/YYYY)
 *
 * @param date - Date object or ISO 8601 string
 * @param storeTimezone - IANA timezone string
 * @returns Formatted string: "11/25/2025"
 *
 * @example
 * formatDateShort('2025-11-26T05:00:00Z', 'America/Denver');
 * // Returns: "11/25/2025"
 */
export function formatDateShort(
  date: Date | string,
  storeTimezone: string,
): string {
  return formatInStoreTime(date, storeTimezone, "MM/dd/yyyy");
}

/**
 * Format relative time (e.g., "2 hours ago")
 *
 * Note: This uses browser's local time for relative calculation,
 * but formats the absolute time in store timezone for display.
 *
 * @param date - Date object or ISO 8601 string
 * @param storeTimezone - IANA timezone string
 * @returns Formatted string: "2 hours ago" or absolute time if > 24 hours
 *
 * @example
 * formatRelative(new Date(Date.now() - 2 * 60 * 60 * 1000), 'America/Denver');
 * // Returns: "2 hours ago"
 */
export function formatRelative(
  date: Date | string,
  storeTimezone: string,
): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) {
    return "Just now";
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  } else {
    // For older dates, show absolute time in store timezone
    return formatDateTime(dateObj, storeTimezone);
  }
}

/**
 * Convert UTC date to store timezone Date object
 *
 * @param date - Date object or ISO 8601 string
 * @param storeTimezone - IANA timezone string
 * @returns Date object in store timezone
 *
 * @example
 * const storeDate = toStoreTimezone('2025-11-26T05:00:00Z', 'America/Denver');
 * // storeDate represents 10 PM on Nov 25 in Denver
 */
export function toStoreTimezone(
  date: Date | string,
  storeTimezone: string,
): Date {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  return toZonedTime(dateObj, storeTimezone);
}

/**
 * Format date range
 *
 * @param startDate - Start date
 * @param endDate - End date
 * @param storeTimezone - IANA timezone string
 * @returns Formatted string: "Nov 25, 2025 - Nov 26, 2025"
 * @throws {RangeError} If either date string is invalid or cannot be parsed
 *
 * @example
 * formatDateRange(
 *   '2025-11-25T13:00:00Z',
 *   '2025-11-26T13:00:00Z',
 *   'America/Denver'
 * );
 * // Returns: "Nov 25, 2025 - Nov 26, 2025"
 */
export function formatDateRange(
  startDate: Date | string,
  endDate: Date | string,
  storeTimezone: string,
): string {
  try {
    const start = formatDate(startDate, storeTimezone);
    const end = formatDate(endDate, storeTimezone);

    // If same date, only show once
    if (start === end) {
      return start;
    }

    return `${start} - ${end}`;
  } catch (error) {
    // Re-throw RangeError from formatDate to maintain consistent error behavior
    throw error;
  }
}

/**
 * Format datetime range
 *
 * @param startDate - Start date
 * @param endDate - End date
 * @param storeTimezone - IANA timezone string
 * @returns Formatted string: "Nov 25, 10:00 PM - Nov 26, 6:00 AM MST"
 *
 * @example
 * formatDateTimeRange(
 *   '2025-11-26T05:00:00Z',
 *   '2025-11-26T13:00:00Z',
 *   'America/Denver'
 * );
 * // Returns: "Nov 25, 10:00 PM - Nov 26, 6:00 AM MST"
 */
export function formatDateTimeRange(
  startDate: Date | string,
  endDate: Date | string,
  storeTimezone: string,
): string {
  const startFormatted = formatInStoreTime(
    startDate,
    storeTimezone,
    "MMM d, h:mm a",
  );
  const endFormatted = formatDateTime(endDate, storeTimezone);

  return `${startFormatted} - ${endFormatted}`;
}

/**
 * Get timezone abbreviation for display
 *
 * @param storeTimezone - IANA timezone string
 * @param date - Optional date to get abbreviation for (handles DST)
 * @returns Timezone abbreviation (e.g., "MST", "MDT")
 *
 * @example
 * getTimezoneAbbr('America/Denver', new Date('2025-11-25'));
 * // Returns: "MST" (winter)
 *
 * getTimezoneAbbr('America/Denver', new Date('2025-07-25'));
 * // Returns: "MDT" (summer, daylight saving)
 */
export function getTimezoneAbbr(
  storeTimezone: string,
  date: Date = new Date(),
): string {
  return formatInTimeZone(date, storeTimezone, "zzz");
}

/**
 * Format date and time in short format without timezone abbreviation
 *
 * Useful for compact displays where timezone context is already known
 * or displayed elsewhere.
 *
 * @param date - Date object or ISO 8601 string
 * @param storeTimezone - IANA timezone string
 * @returns Formatted string: "Jan 6 at 2:30 PM"
 *
 * @example
 * formatDateTimeShort('2025-11-26T05:30:00Z', 'America/Denver');
 * // Returns: "Nov 25 at 10:30 PM"
 */
export function formatDateTimeShort(
  date: Date | string,
  storeTimezone: string,
): string {
  return formatInStoreTime(date, storeTimezone, "MMM d 'at' h:mm a");
}
