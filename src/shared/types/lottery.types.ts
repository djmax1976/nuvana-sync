/**
 * Lottery Types for Nuvana Desktop Application
 *
 * Centralized, type-safe enum definitions for lottery pack operations.
 * These types serve as the single source of truth for all layers:
 * - Input validation (IPC handlers)
 * - Database storage (DAL layer)
 * - Cloud API sync (sync engine, cloud API service)
 *
 * @module shared/types/lottery.types
 * @security SEC-014: Strict input validation with allowlist enums
 * @see Cloud API Spec: LotteryPackDepletionReason, LotteryPackReturnReason
 * @see Database: migrations/v019_lottery_packs_shift_tracking.sql
 * @see Database: migrations/v020_lottery_packs_return_context.sql
 */

import { z } from 'zod';

// ============================================================================
// Depletion Reason Definitions
// ============================================================================

/**
 * Valid reasons for pack depletion (sold out)
 *
 * SEC-014: Strict allowlist - only these values are accepted
 *
 * Cloud API Spec: LotteryPackDepletionReason enum
 * Database: CHECK constraint in lottery_packs.depletion_reason
 *
 * Values:
 * - SHIFT_CLOSE: Pack automatically depleted at shift close (all remaining tickets sold)
 * - AUTO_REPLACED: Pack depleted when a replacement pack was activated
 * - MANUAL_SOLD_OUT: Cashier manually marked pack as sold out via UI
 * - POS_LAST_TICKET: POS system detected last ticket sale
 *
 * @see migrations/v019_lottery_packs_shift_tracking.sql
 */
export const DepletionReasonSchema = z.enum([
  'SHIFT_CLOSE',
  'AUTO_REPLACED',
  'MANUAL_SOLD_OUT',
  'POS_LAST_TICKET',
]);

/**
 * TypeScript type for pack depletion reasons
 * Inferred from DepletionReasonSchema for type safety
 */
export type DepletionReason = z.infer<typeof DepletionReasonSchema>;

/**
 * Array of valid depletion reason values for runtime validation
 * SEC-014: Used for allowlist validation checks
 */
export const DEPLETION_REASONS: readonly DepletionReason[] = [
  'SHIFT_CLOSE',
  'AUTO_REPLACED',
  'MANUAL_SOLD_OUT',
  'POS_LAST_TICKET',
] as const;

// ============================================================================
// Return Reason Definitions
// ============================================================================

/**
 * Valid reasons for pack return
 *
 * SEC-014: Strict allowlist - only these values are accepted by cloud API
 *
 * Cloud API Spec: LotteryPackReturnReason enum
 * Database: CHECK constraint in lottery_packs.return_reason
 *
 * Values:
 * - SUPPLIER_RECALL: Supplier/lottery commission recalled the pack
 * - DAMAGED: Pack was physically damaged and cannot be sold
 * - EXPIRED: Pack expired before being fully sold
 * - INVENTORY_ADJUSTMENT: Inventory correction/audit adjustment
 * - STORE_CLOSURE: Store closing or relocating
 *
 * Note: 'OTHER' is intentionally excluded. The cloud API does not accept
 * 'OTHER' as a valid return reason. Input validation must enforce one of
 * the five specific reasons above.
 *
 * @see migrations/v020_lottery_packs_return_context.sql
 */
export const ReturnReasonSchema = z.enum([
  'SUPPLIER_RECALL',
  'DAMAGED',
  'EXPIRED',
  'INVENTORY_ADJUSTMENT',
  'STORE_CLOSURE',
]);

/**
 * TypeScript type for pack return reasons
 * Inferred from ReturnReasonSchema for type safety
 */
export type ReturnReason = z.infer<typeof ReturnReasonSchema>;

/**
 * Array of valid return reason values for runtime validation
 * SEC-014: Used for allowlist validation checks
 */
export const RETURN_REASONS: readonly ReturnReason[] = [
  'SUPPLIER_RECALL',
  'DAMAGED',
  'EXPIRED',
  'INVENTORY_ADJUSTMENT',
  'STORE_CLOSURE',
] as const;

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a depletion reason value (throws on invalid)
 *
 * SEC-014: Input validation at system boundary
 *
 * @param value - Unknown value to validate
 * @returns Validated DepletionReason
 * @throws ZodError if validation fails
 */
export function validateDepletionReason(value: unknown): DepletionReason {
  return DepletionReasonSchema.parse(value);
}

/**
 * Safely validate a depletion reason value (returns result object)
 *
 * SEC-014: Safe validation for graceful error handling
 *
 * @param value - Unknown value to validate
 * @returns SafeParseResult with success flag and data or error
 */
export function safeValidateDepletionReason(value: unknown) {
  return DepletionReasonSchema.safeParse(value);
}

/**
 * Type guard to check if value is a valid depletion reason
 *
 * @param value - Unknown value to check
 * @returns True if value is a valid DepletionReason
 */
export function isDepletionReason(value: unknown): value is DepletionReason {
  return DepletionReasonSchema.safeParse(value).success;
}

/**
 * Validate a return reason value (throws on invalid)
 *
 * SEC-014: Input validation at system boundary
 *
 * @param value - Unknown value to validate
 * @returns Validated ReturnReason
 * @throws ZodError if validation fails
 */
export function validateReturnReason(value: unknown): ReturnReason {
  return ReturnReasonSchema.parse(value);
}

/**
 * Safely validate a return reason value (returns result object)
 *
 * SEC-014: Safe validation for graceful error handling
 *
 * @param value - Unknown value to validate
 * @returns SafeParseResult with success flag and data or error
 */
export function safeValidateReturnReason(value: unknown) {
  return ReturnReasonSchema.safeParse(value);
}

/**
 * Type guard to check if value is a valid return reason
 *
 * @param value - Unknown value to check
 * @returns True if value is a valid ReturnReason
 */
export function isReturnReason(value: unknown): value is ReturnReason {
  return ReturnReasonSchema.safeParse(value).success;
}
