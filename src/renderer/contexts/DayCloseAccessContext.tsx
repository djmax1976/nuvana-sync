/**
 * Day Close Access Context
 *
 * Provides validated access result to child components of DayCloseAccessGuard.
 * Eliminates the need for DayClosePage to re-validate or read from URL/state.
 *
 * This context is populated by DayCloseAccessGuard after successful PIN
 * verification and shift condition validation. Child components can use
 * useDayCloseAccessContext() to access the active shift and user info.
 *
 * Business Requirements:
 * - BR-001: At least one active shift
 * - BR-002: Exactly one active shift
 * - BR-003: Cashier ownership
 * - BR-004: Manager override (shift_manager, store_manager)
 *
 * @module renderer/contexts/DayCloseAccessContext
 * @security SEC-010: Context only populated after backend authorization
 * @security FE-001: No sensitive data (PIN) stored in context
 */

'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { DayCloseActiveShift, DayCloseAccessUser, DayCloseAccessType } from '../lib/transport';

// ============================================================================
// Types
// ============================================================================

/**
 * Day Close Access Context Value
 *
 * Contains the validated access result from the backend.
 * Only available after successful PIN verification and authorization.
 */
export interface DayCloseAccessContextValue {
  /**
   * The active shift to be closed
   * Includes resolved terminal and cashier names for display
   *
   * @security DB-006: Data comes from store-scoped backend query
   */
  activeShift: DayCloseActiveShift;

  /**
   * The authenticated user who initiated day close
   *
   * @security SEC-001: PIN hash never exposed
   */
  user: DayCloseAccessUser;

  /**
   * How access was granted
   * - OWNER: User is the assigned cashier of the shift
   * - OVERRIDE: User has shift_manager or store_manager role
   */
  accessType: DayCloseAccessType;
}

// ============================================================================
// Context
// ============================================================================

/**
 * Day Close Access Context
 *
 * Initialized to null - only populated by DayCloseAccessGuard after
 * successful backend authorization. Using null allows type-safe
 * detection of unauthorized access attempts.
 */
export const DayCloseAccessContext = createContext<DayCloseAccessContextValue | null>(null);

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to access Day Close context
 *
 * Provides access to the validated shift and user data.
 * Must be used within a DayCloseAccessGuard component.
 *
 * @returns Day Close access context value
 * @throws Error if used outside of DayCloseAccessGuard
 *
 * @security SEC-010: Context only populated after backend authorization
 *
 * @example
 * ```tsx
 * function DayClosePage() {
 *   const { activeShift, user, accessType } = useDayCloseAccessContext();
 *
 *   return (
 *     <div>
 *       <h1>Closing Shift #{activeShift.shift_number}</h1>
 *       <p>Cashier: {activeShift.cashier_name}</p>
 *       <p>Closing as: {user.name} ({accessType})</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useDayCloseAccessContext(): DayCloseAccessContextValue {
  const context = useContext(DayCloseAccessContext);

  if (!context) {
    throw new Error(
      'useDayCloseAccessContext must be used within DayCloseAccessGuard. ' +
        'Ensure the component is rendered as a child of the guard.'
    );
  }

  return context;
}

// ============================================================================
// Provider Component
// ============================================================================

/**
 * Props for DayCloseAccessProvider
 */
export interface DayCloseAccessProviderProps {
  /** The validated access context value */
  value: DayCloseAccessContextValue;
  /** Child components that will have access to the context */
  children: ReactNode;
}

/**
 * Day Close Access Provider
 *
 * Internal component used by DayCloseAccessGuard to provide
 * the validated access context to child components.
 *
 * This provider should NOT be used directly - use DayCloseAccessGuard instead.
 *
 * @internal
 */
export function DayCloseAccessProvider({ value, children }: DayCloseAccessProviderProps) {
  return <DayCloseAccessContext.Provider value={value}>{children}</DayCloseAccessContext.Provider>;
}
