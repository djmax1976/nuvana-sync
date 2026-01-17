/**
 * Shift Event Types for Nuvana Desktop Application
 *
 * Type definitions for shift close events emitted from main process to renderer.
 * Used to notify cashiers when their shift has been closed by the POS.
 *
 * @module shared/types/shift-events
 * @security SEC-014: Strict input validation schemas with allowlists
 * @security API-001: Zod schemas for IPC payloads
 */

import { z } from 'zod';

// ============================================================================
// Shift Close Type Definitions
// ============================================================================

/**
 * Shift close type - determines which wizard to navigate to
 * SEC-014: Strict allowlist for close types
 *
 * - SHIFT_CLOSE: Individual register shift ending, other shifts still open
 * - DAY_CLOSE: Last shift of the day, all registers now closed
 */
export const ShiftCloseTypeSchema = z.enum(['SHIFT_CLOSE', 'DAY_CLOSE']);

export type ShiftCloseType = z.infer<typeof ShiftCloseTypeSchema>;

// ============================================================================
// Shift Closed Event Schema
// ============================================================================

/**
 * UUID validation pattern (36 characters with hyphens)
 */
const UUIDSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid UUID format');

/**
 * Business date validation pattern (YYYY-MM-DD)
 */
const BusinessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid business date format (expected YYYY-MM-DD)');

/**
 * ISO datetime validation pattern
 */
const ISODateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'Invalid ISO datetime format');

/**
 * Shift closed event payload schema
 *
 * Emitted when POS closes a shift via NAXML XML file.
 * Used to notify cashiers and navigate to appropriate wizard.
 *
 * SEC-014: Strict validation schema for IPC payloads
 * API-001: All fields validated with type constraints
 */
export const ShiftClosedEventSchema = z.object({
  /** Type of close event - determines wizard navigation */
  closeType: ShiftCloseTypeSchema,

  /** Shift ID that was closed (UUID) */
  shiftId: UUIDSchema,

  /** Business date of the shift (YYYY-MM-DD) */
  businessDate: BusinessDateSchema,

  /** External register ID from POS (optional - may be null for some POS systems) */
  externalRegisterId: z.string().max(50).optional(),

  /** External cashier ID from POS (optional) */
  externalCashierId: z.string().max(50).optional(),

  /** Shift number within the business day (positive integer) */
  shiftNumber: z.number().int().positive(),

  /** When the shift was closed (ISO timestamp) */
  closedAt: ISODateTimeSchema,

  /** Whether this is the last shift of the day (all other registers closed) */
  isLastShiftOfDay: z.boolean(),

  /** Count of remaining open shifts on other registers (0 = day close) */
  remainingOpenShifts: z.number().int().min(0),
});

export type ShiftClosedEvent = z.infer<typeof ShiftClosedEventSchema>;

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate shift closed event data (throws on invalid)
 *
 * @param data - Unknown data to validate
 * @returns Validated ShiftClosedEvent
 * @throws ZodError if validation fails
 */
export function validateShiftClosedEvent(data: unknown): ShiftClosedEvent {
  return ShiftClosedEventSchema.parse(data);
}

/**
 * Safely validate shift closed event data (returns result object)
 *
 * SEC-014: Safe validation for IPC boundary
 *
 * @param data - Unknown data to validate
 * @returns SafeParseResult with success flag and data or error
 */
export function safeValidateShiftClosedEvent(data: unknown) {
  return ShiftClosedEventSchema.safeParse(data);
}

/**
 * Check if data is a valid shift closed event (type guard)
 *
 * @param data - Unknown data to check
 * @returns True if data is a valid ShiftClosedEvent
 */
export function isShiftClosedEvent(data: unknown): data is ShiftClosedEvent {
  return ShiftClosedEventSchema.safeParse(data).success;
}
