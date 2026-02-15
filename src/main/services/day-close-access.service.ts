/**
 * Day Close Access Validation Service
 *
 * Centralized business logic for day close access control.
 * Single source of truth for all day close validation rules.
 *
 * Business Requirements:
 * - BR-001: At least one active shift - Cannot close a day with no open shifts
 * - BR-002: Exactly one active shift - Cannot close if multiple shifts are open
 * - BR-003: Cashier ownership - Only the cashier of the active shift can initiate day close
 * - BR-004: Manager override - shift_manager or store_manager can override BR-003
 * - BR-005: PIN verification first - Identity must be verified BEFORE entering wizard
 * - BR-006: Conditions 1 & 2 always enforced - Even managers cannot bypass BR-001 and BR-002
 *
 * @module main/services/day-close-access
 * @security SEC-010: All authorization decisions made server-side
 * @security SEC-006: All queries use parameterized statements via DAL
 * @security DB-006: All queries store-scoped for tenant isolation
 * @security SEC-017: Audit logging for access attempts
 */

import { shiftsDAL, type Shift } from '../dal/shifts.dal';
import { usersDAL, type User, type UserRole } from '../dal/users.dal';
import { posTerminalMappingsDAL } from '../dal/pos-id-mappings.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Reason codes for access denial
 */
export type DayCloseAccessDenialReason =
  | 'NO_OPEN_SHIFTS'
  | 'MULTIPLE_OPEN_SHIFTS'
  | 'NOT_SHIFT_OWNER'
  | 'INVALID_PIN'
  | 'NOT_AUTHENTICATED';

/**
 * How access was granted
 */
export type DayCloseAccessType = 'OWNER' | 'OVERRIDE';

/**
 * Active shift details for day close access
 */
export interface ActiveShiftDetails {
  /** Shift ID (UUID) */
  shift_id: string;
  /** Shift number for the day */
  shift_number: number;
  /** Cashier's user ID (may be null if no cashier assigned) */
  cashier_id: string | null;
  /** Resolved cashier name */
  cashier_name: string;
  /** External register ID from POS */
  external_register_id: string | null;
  /** Resolved terminal/register name */
  terminal_name: string;
  /** Business date (YYYY-MM-DD) */
  business_date: string;
  /** Start time (ISO timestamp) */
  start_time: string | null;
}

/**
 * Authenticated user info for access result
 */
export interface DayCloseAccessUser {
  /** User ID (UUID) */
  userId: string;
  /** User's display name */
  name: string;
  /** User's role */
  role: UserRole;
}

/**
 * Result of day close access check
 */
export interface DayCloseAccessResult {
  /** Whether access is allowed */
  allowed: boolean;

  /** Reason code if denied */
  reasonCode?: DayCloseAccessDenialReason;

  /** Human-readable reason if denied */
  reason?: string;

  /** The active shift (if exactly one exists) */
  activeShift?: ActiveShiftDetails;

  /** How access was granted */
  accessType?: DayCloseAccessType;

  /** The authenticated user */
  user?: DayCloseAccessUser;

  /** Open shift count (for UI messaging) */
  openShiftCount: number;
}

/**
 * Input for day close access check
 */
export interface DayCloseAccessInput {
  /** PIN for authentication (4-6 digits) */
  pin: string;
}

/**
 * Result of shift condition validation
 */
interface ShiftConditionsResult {
  /** Whether conditions are met (exactly one open shift) */
  valid: boolean;
  /** Number of open shifts */
  openShiftCount: number;
  /** The active shift (if exactly one) */
  activeShift?: Shift;
  /** Denial reason if invalid */
  reasonCode?: DayCloseAccessDenialReason;
  /** Human-readable reason if invalid */
  reason?: string;
}

/**
 * Result of user access validation
 */
interface UserAccessResult {
  /** Whether user can access */
  canAccess: boolean;
  /** How access was granted (owner or override) */
  accessType?: DayCloseAccessType;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Roles that can override shift ownership (BR-004)
 * shift_manager and store_manager can close any shift
 */
const OVERRIDE_ROLES: UserRole[] = ['shift_manager', 'store_manager'];

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('day-close-access');

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolve terminal name from external register ID
 * SEC-006: Uses DAL with parameterized queries
 * DB-006: Store-scoped lookup
 *
 * @param storeId - Store identifier
 * @param externalRegisterId - External register ID from POS
 * @returns Resolved terminal name or fallback
 */
function resolveTerminalName(storeId: string, externalRegisterId: string | null): string {
  if (!externalRegisterId) {
    return 'Unknown Register';
  }

  const terminals = posTerminalMappingsDAL.findRegisters(storeId);
  const terminal = terminals.find((t) => t.external_register_id === externalRegisterId);

  return terminal?.description || `Register ${externalRegisterId}`;
}

/**
 * Resolve cashier name from user ID
 * SEC-006: Uses DAL with parameterized queries
 *
 * @param cashierId - User ID (may be null)
 * @returns Resolved cashier name or fallback
 */
function resolveCashierName(cashierId: string | null): string {
  if (!cashierId) {
    return 'No Cashier Assigned';
  }

  const user = usersDAL.findById(cashierId);
  if (!user) {
    log.warn('Shift references non-existent user', { cashierId });
    return 'Unknown Cashier';
  }

  return user.name;
}

/**
 * Convert Shift to ActiveShiftDetails with resolved names
 * SEC-006: Uses DAL with parameterized queries
 * DB-006: Store-scoped lookups
 *
 * @param shift - Shift entity
 * @param storeId - Store identifier for terminal lookup
 * @returns Active shift details with resolved names
 */
function toActiveShiftDetails(shift: Shift, storeId: string): ActiveShiftDetails {
  return {
    shift_id: shift.shift_id,
    shift_number: shift.shift_number,
    cashier_id: shift.cashier_id,
    cashier_name: resolveCashierName(shift.cashier_id),
    external_register_id: shift.external_register_id,
    terminal_name: resolveTerminalName(storeId, shift.external_register_id),
    business_date: shift.business_date,
    start_time: shift.start_time,
  };
}

/**
 * Convert User to DayCloseAccessUser
 *
 * @param user - User entity
 * @returns Access user info
 */
function toAccessUser(user: User): DayCloseAccessUser {
  return {
    userId: user.user_id,
    name: user.name,
    role: user.role,
  };
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Validate shift conditions for day close (BR-001, BR-002)
 *
 * Checks:
 * - At least one open shift exists (BR-001)
 * - Exactly one open shift exists (BR-002)
 *
 * @security SEC-006: Parameterized queries via DAL
 * @security DB-006: Store-scoped query
 *
 * @param storeId - Store identifier for tenant isolation
 * @returns Validation result with shift details if valid
 */
export function validateShiftConditions(storeId: string): ShiftConditionsResult {
  // SEC-006 & DB-006: Store-scoped query via DAL
  const openShifts = shiftsDAL.getAllOpenShifts(storeId);
  const openShiftCount = openShifts.length;

  // BR-001: At least one open shift
  if (openShiftCount === 0) {
    log.info('Day close access denied: No open shifts', { storeId });
    return {
      valid: false,
      openShiftCount: 0,
      reasonCode: 'NO_OPEN_SHIFTS',
      reason: 'No open shifts to close. Please start a shift first.',
    };
  }

  // BR-002: Exactly one open shift
  if (openShiftCount > 1) {
    log.info('Day close access denied: Multiple open shifts', {
      storeId,
      openShiftCount,
      shiftIds: openShifts.map((s) => s.shift_id),
    });
    return {
      valid: false,
      openShiftCount,
      reasonCode: 'MULTIPLE_OPEN_SHIFTS',
      reason: `Cannot close day with ${openShiftCount} open shifts. Please close other shifts first.`,
    };
  }

  // Exactly one open shift - conditions met
  return {
    valid: true,
    openShiftCount: 1,
    activeShift: openShifts[0],
  };
}

/**
 * Validate user access to close the shift (BR-003, BR-004)
 *
 * Checks:
 * - User is the shift's assigned cashier (BR-003: OWNER access)
 * - OR user has shift_manager or store_manager role (BR-004: OVERRIDE access)
 *
 * @security SEC-010: Authorization decision made server-side
 *
 * @param user - Authenticated user
 * @param activeShift - The shift to close
 * @returns Access validation result
 */
export function validateUserAccess(user: User, activeShift: Shift): UserAccessResult {
  // BR-003: Check if user is shift owner
  if (activeShift.cashier_id === user.user_id) {
    return {
      canAccess: true,
      accessType: 'OWNER',
    };
  }

  // BR-004: Check if user has override role
  if (OVERRIDE_ROLES.includes(user.role)) {
    log.info('Day close access granted via override', {
      userId: user.user_id,
      role: user.role,
      shiftCashierId: activeShift.cashier_id,
    });
    return {
      canAccess: true,
      accessType: 'OVERRIDE',
    };
  }

  // Neither owner nor override
  return {
    canAccess: false,
  };
}

/**
 * Check day close access with PIN authentication
 *
 * Full access check flow:
 * 1. Validate PIN and authenticate user (BR-005)
 * 2. Validate shift conditions (BR-001, BR-002)
 * 3. Validate user access (BR-003, BR-004)
 *
 * @security SEC-010: All authorization decisions made server-side
 * @security SEC-006: Parameterized queries via DAL
 * @security DB-006: Store-scoped queries
 * @security SEC-017: Audit logging for access attempts
 *
 * @param storeId - Store identifier for tenant isolation
 * @param input - Access check input with PIN
 * @returns Complete access result
 */
export async function checkAccess(
  storeId: string,
  input: DayCloseAccessInput
): Promise<DayCloseAccessResult> {
  log.info('Day close access check initiated', { storeId });

  // Step 1: Authenticate user by PIN (BR-005)
  // SEC-001: bcrypt comparison via usersDAL.findByPin
  const user = await usersDAL.findByPin(storeId, input.pin);

  if (!user) {
    log.warn('Day close access denied: Invalid PIN', { storeId });
    return {
      allowed: false,
      reasonCode: 'INVALID_PIN',
      reason: 'Invalid PIN. Please try again.',
      openShiftCount: 0, // Don't reveal shift count on auth failure
    };
  }

  // Step 2: Validate shift conditions (BR-001, BR-002)
  // Note: These checks happen AFTER PIN validation but we return shift count
  // This is intentional - BR-006 states managers cannot bypass these either
  const shiftConditions = validateShiftConditions(storeId);

  if (!shiftConditions.valid) {
    // SEC-017: Audit log the denial
    log.info('Day close access denied after authentication', {
      storeId,
      userId: user.user_id,
      reasonCode: shiftConditions.reasonCode,
      openShiftCount: shiftConditions.openShiftCount,
    });

    return {
      allowed: false,
      reasonCode: shiftConditions.reasonCode,
      reason: shiftConditions.reason,
      openShiftCount: shiftConditions.openShiftCount,
      user: toAccessUser(user), // Include user so frontend knows who authenticated
    };
  }

  // Step 3: Validate user access (BR-003, BR-004)
  // Safe access: shiftConditions.valid guarantees activeShift exists
  const activeShift = shiftConditions.activeShift;
  if (!activeShift) {
    // Defensive: should never reach here if validateShiftConditions is correct
    log.error('Unexpected: valid shift conditions but no activeShift', { storeId });
    return {
      allowed: false,
      reasonCode: 'NO_OPEN_SHIFTS',
      reason: 'An unexpected error occurred. Please try again.',
      openShiftCount: 0,
    };
  }
  const userAccess = validateUserAccess(user, activeShift);

  if (!userAccess.canAccess) {
    // SEC-017: Audit log the denial
    log.warn('Day close access denied: Not shift owner', {
      storeId,
      userId: user.user_id,
      userRole: user.role,
      shiftCashierId: activeShift.cashier_id,
      shiftId: activeShift.shift_id,
    });

    return {
      allowed: false,
      reasonCode: 'NOT_SHIFT_OWNER',
      reason:
        'You are not the assigned cashier for this shift. Only the shift owner or a manager can close this day.',
      openShiftCount: 1,
      activeShift: toActiveShiftDetails(activeShift, storeId),
      user: toAccessUser(user),
    };
  }

  // Access granted
  // SEC-017: Audit log successful access
  log.info('Day close access granted', {
    storeId,
    userId: user.user_id,
    userRole: user.role,
    accessType: userAccess.accessType,
    shiftId: activeShift.shift_id,
    shiftCashierId: activeShift.cashier_id,
  });

  return {
    allowed: true,
    openShiftCount: 1,
    activeShift: toActiveShiftDetails(activeShift, storeId),
    accessType: userAccess.accessType,
    user: toAccessUser(user),
  };
}
