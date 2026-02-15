/**
 * Lottery Ticket Calculations - Single Source of Truth
 *
 * Centralized, enterprise-grade calculation functions for lottery ticket operations.
 * This module is the ONLY place where ticket counting formulas should be implemented.
 *
 * @module shared/lottery/ticket-calculations
 *
 * ## Business Rules
 *
 * ### Serial Number Semantics (0-Based)
 * - Ticket serial numbers start at 0 (e.g., 000, 001, 002...)
 * - Serial 0 is a REAL ticket, not "nothing"
 * - A pack with serials 000-059 contains 60 physical tickets
 *
 * ### Two Calculation Modes
 *
 * 1. **POSITION Mode** (Day Close / Normal Sales)
 *    - `ending_serial` = NEXT ticket to sell (pointer position)
 *    - Formula: `ending - starting`
 *    - Example: Starting=0, Ending=15 → 15 tickets sold (tickets #0-14)
 *
 * 2. **INDEX Mode** (Depletion / Sold Out)
 *    - `closing_serial` = LAST ticket INDEX (0-based)
 *    - Formula: `(closing + 1) - starting`
 *    - Example: Starting=0, Closing=14 → 15 tickets sold (tickets #0-14)
 *
 * ### Why +1 in INDEX Mode?
 * When a pack is sold out, the closing serial is the LAST ticket number (index).
 * Since serial 0 is a real ticket, we add 1 to convert from index to count.
 * Example: Pack 000-029 (30 tickets), closing=029 → (29+1)-0 = 30 tickets
 *
 * @security SEC-014: INPUT_VALIDATION - All inputs validated with strict schemas
 * @security API-001: VALIDATION - Zod schemas for all parameters
 * @see Database: lottery_day_packs.starting_serial, lottery_day_packs.ending_serial
 * @see Cloud API: LotteryPackClosing.ending_serial
 */

import { z } from 'zod';

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum valid serial number (3 digits: 000-999)
 * SEC-014: Bounds validation constant
 */
export const MAX_SERIAL_NUMBER = 999;

/**
 * Minimum valid serial number
 * SEC-014: Bounds validation constant
 */
export const MIN_SERIAL_NUMBER = 0;

/**
 * Serial number string length (always 3 digits with leading zeros)
 */
export const SERIAL_STRING_LENGTH = 3;

// ============================================================================
// Enums and Types
// ============================================================================

/**
 * Calculation mode for ticket sales
 *
 * - POSITION: ending_serial is the NEXT ticket to sell (pointer)
 * - INDEX: closing_serial is the LAST ticket sold (0-based index)
 */
export const CalculationModeSchema = z.enum(['POSITION', 'INDEX']);
export type CalculationMode = z.infer<typeof CalculationModeSchema>;

/**
 * Calculation modes as constants for convenience
 */
export const CalculationModes = {
  /** Day close, normal sales - ending is next position to sell */
  POSITION: 'POSITION' as const,
  /** Depletion, sold out - closing is last ticket index */
  INDEX: 'INDEX' as const,
} as const;

// ============================================================================
// Input Validation Schemas
// ============================================================================

/**
 * Schema for serial number as string (3-digit format)
 * SEC-014: Strict format validation
 */
export const SerialStringSchema = z
  .string()
  .regex(/^\d{1,3}$/, 'Serial must be 1-3 digit numeric string')
  .transform((val) => val.padStart(3, '0'));

/**
 * Schema for serial number as integer
 * SEC-014: Bounds validation
 */
export const SerialNumberSchema = z
  .number()
  .int('Serial must be an integer')
  .min(MIN_SERIAL_NUMBER, `Serial must be >= ${MIN_SERIAL_NUMBER}`)
  .max(MAX_SERIAL_NUMBER, `Serial must be <= ${MAX_SERIAL_NUMBER}`);

/**
 * Schema for price per ticket (non-negative)
 * SEC-014: Bounds validation
 */
export const PriceSchema = z
  .number()
  .min(0, 'Price must be non-negative')
  .max(1000, 'Price exceeds reasonable maximum');

/**
 * Schema for ticket count (non-negative integer)
 * SEC-014: Type and bounds validation
 */
export const TicketCountSchema = z
  .number()
  .int('Ticket count must be an integer')
  .min(0, 'Ticket count must be non-negative')
  .max(1000, 'Ticket count exceeds reasonable maximum');

// ============================================================================
// Input Parsing Utilities
// ============================================================================

/**
 * Parse a serial number from string or number to validated integer
 *
 * SEC-014: INPUT_VALIDATION - Strict type coercion with validation
 *
 * @param serial - Serial as string (e.g., "015") or number (e.g., 15)
 * @returns Validated integer or null if invalid
 *
 * @example
 * parseSerial("015") // returns 15
 * parseSerial(15)    // returns 15
 * parseSerial("abc") // returns null
 * parseSerial(-1)    // returns null
 * parseSerial(1000)  // returns null (exceeds MAX_SERIAL_NUMBER)
 */
export function parseSerial(serial: string | number | null | undefined): number | null {
  if (serial === null || serial === undefined) {
    return null;
  }

  let num: number;

  if (typeof serial === 'string') {
    // SEC-014: Reject strings that aren't pure integers (e.g., "12.5", "12abc")
    // Only allow digits (with optional leading zeros)
    if (!/^\d+$/.test(serial)) {
      return null;
    }
    // SEC-014: Use radix 10 to prevent octal interpretation of "007", "010", etc.
    num = parseInt(serial, 10);
  } else if (typeof serial === 'number') {
    num = serial;
  } else {
    return null;
  }

  // SEC-014: Strict validation using Number.isNaN (not global isNaN)
  if (Number.isNaN(num)) {
    return null;
  }

  // SEC-014: Bounds check
  if (num < MIN_SERIAL_NUMBER || num > MAX_SERIAL_NUMBER) {
    return null;
  }

  // Ensure integer
  if (!Number.isInteger(num)) {
    return null;
  }

  return num;
}

/**
 * Format a serial number as a 3-digit string with leading zeros
 *
 * @param serial - Serial number (0-999)
 * @returns Formatted string (e.g., "007") or null if invalid
 *
 * @example
 * formatSerial(7)   // returns "007"
 * formatSerial(15)  // returns "015"
 * formatSerial(150) // returns "150"
 */
export function formatSerial(serial: number | null | undefined): string | null {
  if (serial === null || serial === undefined) {
    return null;
  }

  if (!Number.isInteger(serial) || serial < MIN_SERIAL_NUMBER || serial > MAX_SERIAL_NUMBER) {
    return null;
  }

  return serial.toString().padStart(SERIAL_STRING_LENGTH, '0');
}

// ============================================================================
// Core Calculation Functions
// ============================================================================

/**
 * Result type for calculation functions
 * Includes success flag, value, and optional error message
 */
export interface CalculationResult<T> {
  success: boolean;
  value: T;
  error?: string;
}

/**
 * Calculate total tickets in a pack (inclusive range)
 *
 * Formula: (serialEnd - serialStart) + 1
 *
 * This accounts for 0-based serial numbering where serial 0 is a real ticket.
 *
 * @param serialStart - First ticket serial (0-based index, e.g., 0 or "000")
 * @param serialEnd - Last ticket serial (0-based index, e.g., 59 or "059")
 * @returns CalculationResult with total ticket count
 *
 * @example
 * // Pack with serials 000-059 (60 tickets)
 * calculateTotalTicketsInPack(0, 59)   // { success: true, value: 60 }
 * calculateTotalTicketsInPack("000", "059") // { success: true, value: 60 }
 *
 * // Pack with serials 000-299 (300 tickets)
 * calculateTotalTicketsInPack(0, 299)  // { success: true, value: 300 }
 *
 * @security SEC-014: All inputs validated before calculation
 */
export function calculateTotalTicketsInPack(
  serialStart: string | number | null | undefined,
  serialEnd: string | number | null | undefined
): CalculationResult<number> {
  const start = parseSerial(serialStart);
  const end = parseSerial(serialEnd);

  if (start === null) {
    return { success: false, value: 0, error: 'Invalid starting serial' };
  }

  if (end === null) {
    return { success: false, value: 0, error: 'Invalid ending serial' };
  }

  if (end < start) {
    return { success: false, value: 0, error: 'Ending serial cannot be less than starting serial' };
  }

  // Inclusive range formula: (end - start) + 1
  // Example: 0 to 59 = (59 - 0) + 1 = 60 tickets
  const total = end - start + 1;

  return { success: true, value: total };
}

/**
 * Calculate tickets sold during a period
 *
 * This is the PRIMARY function for ticket sales calculations.
 * It handles BOTH calculation modes with explicit mode parameter.
 *
 * @param startingSerial - Serial position at start of period (0-based)
 * @param endingSerial - Serial position at end of period (interpretation depends on mode)
 * @param mode - Calculation mode:
 *   - POSITION: endingSerial is NEXT position to sell (day close)
 *   - INDEX: endingSerial is LAST ticket INDEX sold (depletion)
 * @returns CalculationResult with tickets sold count
 *
 * @example
 * // POSITION mode (day close): ending is next position to sell
 * // Starting at 0, ending at 15 means tickets 0-14 were sold
 * calculateTicketsSold(0, 15, 'POSITION') // { success: true, value: 15 }
 *
 * // INDEX mode (depletion): ending is last ticket index
 * // Starting at 0, closing at 14 means tickets 0-14 were sold (15 tickets)
 * calculateTicketsSold(0, 14, 'INDEX') // { success: true, value: 15 }
 *
 * // Full pack sold out (30-ticket pack, serials 000-029)
 * calculateTicketsSold(0, 29, 'INDEX') // { success: true, value: 30 }
 *
 * @security SEC-014: All inputs validated before calculation
 */
export function calculateTicketsSold(
  startingSerial: string | number | null | undefined,
  endingSerial: string | number | null | undefined,
  mode: CalculationMode
): CalculationResult<number> {
  const start = parseSerial(startingSerial);
  const end = parseSerial(endingSerial);

  if (start === null) {
    return { success: false, value: 0, error: 'Invalid starting serial' };
  }

  if (end === null) {
    return { success: false, value: 0, error: 'Invalid ending serial' };
  }

  // Validate mode
  const modeValidation = CalculationModeSchema.safeParse(mode);
  if (!modeValidation.success) {
    return { success: false, value: 0, error: 'Invalid calculation mode' };
  }

  let ticketsSold: number;

  if (mode === CalculationModes.POSITION) {
    // POSITION mode: ending is the NEXT position to sell
    // Formula: ending - starting
    // Example: starting=0, ending=15 → tickets 0-14 sold = 15 tickets
    ticketsSold = end - start;
  } else {
    // INDEX mode: ending is the LAST ticket INDEX (0-based)
    // Formula: (ending + 1) - starting
    // Example: starting=0, ending=14 → (14+1)-0 = 15 tickets (0-14 sold)
    ticketsSold = end + 1 - start;
  }

  // Sanity check: tickets sold cannot be negative
  if (ticketsSold < 0) {
    return {
      success: false,
      value: 0,
      error: `Ending serial (${end}) cannot be less than starting serial (${start}) in ${mode} mode`,
    };
  }

  return { success: true, value: ticketsSold };
}

/**
 * Calculate tickets remaining in a pack
 *
 * @param totalTickets - Total tickets in the pack
 * @param ticketsSold - Number of tickets already sold
 * @returns CalculationResult with tickets remaining
 *
 * @example
 * calculateTicketsRemaining(60, 59) // { success: true, value: 1 }
 * calculateTicketsRemaining(300, 150) // { success: true, value: 150 }
 *
 * @security SEC-014: All inputs validated before calculation
 */
export function calculateTicketsRemaining(
  totalTickets: number,
  ticketsSold: number
): CalculationResult<number> {
  const totalValidation = TicketCountSchema.safeParse(totalTickets);
  if (!totalValidation.success) {
    return { success: false, value: 0, error: 'Invalid total tickets count' };
  }

  const soldValidation = TicketCountSchema.safeParse(ticketsSold);
  if (!soldValidation.success) {
    return { success: false, value: 0, error: 'Invalid tickets sold count' };
  }

  const remaining = totalTickets - ticketsSold;

  if (remaining < 0) {
    return { success: false, value: 0, error: 'Tickets sold exceeds total tickets' };
  }

  return { success: true, value: remaining };
}

/**
 * Calculate tickets remaining using serial numbers directly
 *
 * This is a convenience function that combines total calculation and remaining calculation.
 *
 * @param serialStart - First ticket serial in pack (e.g., 0 or "000")
 * @param serialEnd - Last ticket serial in pack (e.g., 59 or "059")
 * @param currentPosition - Current selling position (POSITION mode semantics)
 * @returns CalculationResult with tickets remaining
 *
 * @example
 * // Pack 000-059 (60 tickets), currently at position 59 (1 ticket left)
 * calculateTicketsRemainingFromSerials(0, 59, 59) // { success: true, value: 1 }
 *
 * // Pack 000-299 (300 tickets), currently at position 150 (150 left)
 * calculateTicketsRemainingFromSerials(0, 299, 150) // { success: true, value: 150 }
 *
 * @security SEC-014: All inputs validated before calculation
 */
export function calculateTicketsRemainingFromSerials(
  serialStart: string | number | null | undefined,
  serialEnd: string | number | null | undefined,
  currentPosition: string | number | null | undefined
): CalculationResult<number> {
  const start = parseSerial(serialStart);
  const end = parseSerial(serialEnd);
  const current = parseSerial(currentPosition);

  if (start === null) {
    return { success: false, value: 0, error: 'Invalid starting serial' };
  }

  if (end === null) {
    return { success: false, value: 0, error: 'Invalid ending serial' };
  }

  if (current === null) {
    return { success: false, value: 0, error: 'Invalid current position' };
  }

  // Validate current position is within valid range
  if (current < start) {
    return { success: false, value: 0, error: 'Current position cannot be before starting serial' };
  }

  // Calculate remaining: from current position to end (inclusive)
  // remaining = (serialEnd + 1) - currentPosition
  // Example: end=59, current=59 → (59+1)-59 = 1 ticket remaining
  const remaining = end + 1 - current;

  if (remaining < 0) {
    return { success: false, value: 0, error: 'Current position exceeds pack serial range' };
  }

  return { success: true, value: remaining };
}

/**
 * Calculate sales amount from tickets sold and price
 *
 * @param ticketsSold - Number of tickets sold
 * @param pricePerTicket - Price per ticket in dollars
 * @returns CalculationResult with sales amount (rounded to 2 decimal places)
 *
 * @example
 * calculateSalesAmount(15, 5.00) // { success: true, value: 75.00 }
 * calculateSalesAmount(30, 2.50) // { success: true, value: 75.00 }
 *
 * @security SEC-014: All inputs validated before calculation
 */
export function calculateSalesAmount(
  ticketsSold: number,
  pricePerTicket: number
): CalculationResult<number> {
  const ticketsValidation = TicketCountSchema.safeParse(ticketsSold);
  if (!ticketsValidation.success) {
    return { success: false, value: 0, error: 'Invalid tickets sold count' };
  }

  const priceValidation = PriceSchema.safeParse(pricePerTicket);
  if (!priceValidation.success) {
    return { success: false, value: 0, error: 'Invalid price per ticket' };
  }

  // Calculate and round to 2 decimal places to avoid floating point issues
  const salesAmount = Math.round(ticketsSold * pricePerTicket * 100) / 100;

  return { success: true, value: salesAmount };
}

// ============================================================================
// Convenience Functions (Throw on Invalid Input)
// ============================================================================

/**
 * Calculate tickets sold (throws on invalid input)
 *
 * Use this when you're confident inputs are valid and want cleaner code.
 * For uncertain inputs, use calculateTicketsSold() instead.
 *
 * @param startingSerial - Serial position at start of period
 * @param endingSerial - Serial position at end of period
 * @param mode - Calculation mode (POSITION or INDEX)
 * @returns Number of tickets sold
 * @throws Error if inputs are invalid
 *
 * @example
 * getTicketsSold(0, 15, 'POSITION') // returns 15
 * getTicketsSold("000", "014", 'INDEX') // returns 15
 */
export function getTicketsSold(
  startingSerial: string | number,
  endingSerial: string | number,
  mode: CalculationMode
): number {
  const result = calculateTicketsSold(startingSerial, endingSerial, mode);
  if (!result.success) {
    throw new Error(result.error || 'Failed to calculate tickets sold');
  }
  return result.value;
}

/**
 * Calculate total tickets in pack (throws on invalid input)
 *
 * @param serialStart - First ticket serial in pack
 * @param serialEnd - Last ticket serial in pack
 * @returns Total ticket count
 * @throws Error if inputs are invalid
 */
export function getTotalTicketsInPack(
  serialStart: string | number,
  serialEnd: string | number
): number {
  const result = calculateTotalTicketsInPack(serialStart, serialEnd);
  if (!result.success) {
    throw new Error(result.error || 'Failed to calculate total tickets');
  }
  return result.value;
}

/**
 * Calculate tickets remaining (throws on invalid input)
 *
 * @param serialStart - First ticket serial in pack
 * @param serialEnd - Last ticket serial in pack
 * @param currentPosition - Current selling position
 * @returns Tickets remaining count
 * @throws Error if inputs are invalid
 */
export function getTicketsRemaining(
  serialStart: string | number,
  serialEnd: string | number,
  currentPosition: string | number
): number {
  const result = calculateTicketsRemainingFromSerials(serialStart, serialEnd, currentPosition);
  if (!result.success) {
    throw new Error(result.error || 'Failed to calculate tickets remaining');
  }
  return result.value;
}

// ============================================================================
// Legacy Compatibility Functions
// ============================================================================

/**
 * Calculate tickets sold for day close (POSITION mode)
 *
 * @deprecated Use calculateTicketsSold(start, end, 'POSITION') instead
 *
 * This is a compatibility wrapper for existing code that uses the old pattern.
 * Returns 0 for invalid inputs (fail-safe for UI).
 */
export function calculateTicketsSoldPosition(
  startingSerial: string | number | null | undefined,
  endingSerial: string | number | null | undefined
): number {
  const result = calculateTicketsSold(startingSerial, endingSerial, CalculationModes.POSITION);
  return result.value;
}

/**
 * Calculate tickets sold for depletion (INDEX mode)
 *
 * @deprecated Use calculateTicketsSold(start, end, 'INDEX') instead
 *
 * This is a compatibility wrapper for existing code that uses the old pattern.
 * Returns 0 for invalid inputs (fail-safe for UI).
 */
export function calculateTicketsSoldIndex(
  startingSerial: string | number | null | undefined,
  closingSerial: string | number | null | undefined
): number {
  const result = calculateTicketsSold(startingSerial, closingSerial, CalculationModes.INDEX);
  return result.value;
}
