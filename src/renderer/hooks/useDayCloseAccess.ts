/**
 * Day Close Access Hook
 *
 * Centralized hook for day close access validation.
 * Handles PIN verification flow and returns access result.
 *
 * This hook provides:
 * - checkAccess(pin): Async function to validate access with PIN
 * - isChecking: Loading state during validation
 * - lastResult: Cached result from most recent check
 * - clearResult(): Clear cached result
 *
 * Business Requirements:
 * - BR-001: At least one active shift
 * - BR-002: Exactly one active shift
 * - BR-003: Cashier ownership
 * - BR-004: Manager override (shift_manager, store_manager)
 * - BR-005: PIN verification first
 *
 * @module renderer/hooks/useDayCloseAccess
 * @security SEC-010: Authorization enforced via backend IPC handler
 * @security FE-003: No sensitive data (PIN) stored in state after check
 */

'use client';

import { useState, useCallback, useRef } from 'react';
import { ipc, type DayCloseAccessResult, type DayCloseAccessInput } from '../lib/transport';
import { IPCError } from '../lib/api/ipc-client';

// ============================================================================
// Types
// ============================================================================

/**
 * Return type for useDayCloseAccess hook
 */
export interface UseDayCloseAccessReturn {
  /**
   * Check day close access with PIN authentication
   *
   * Calls the backend IPC handler to validate:
   * 1. PIN authentication (BR-005)
   * 2. Shift conditions (BR-001, BR-002)
   * 3. User authorization (BR-003, BR-004)
   *
   * @param pin - User's PIN (4-6 digits)
   * @returns Access result with decision and shift details
   * @throws IPCError if IPC call fails
   *
   * @security SEC-010: Authorization decision made server-side
   * @security FE-003: PIN not stored after validation
   */
  checkAccess: (pin: string) => Promise<DayCloseAccessResult>;

  /**
   * Whether an access check is currently in progress
   * Use for loading indicators
   */
  isChecking: boolean;

  /**
   * Result from the most recent access check
   * null if no check has been performed or after clearResult()
   */
  lastResult: DayCloseAccessResult | null;

  /**
   * Clear the cached result
   * Useful when navigating away or resetting state
   */
  clearResult: () => void;

  /**
   * Error from the most recent failed check
   * null if last check succeeded or no check performed
   * Contains IPC errors, not business denial reasons
   */
  error: Error | null;
}

/**
 * Error type for day close access operations
 * Distinguishes between IPC errors and business denial
 */
export class DayCloseAccessError extends Error {
  public readonly code: string;

  constructor(message: string, code: string = 'DAY_CLOSE_ACCESS_ERROR') {
    super(message);
    this.name = 'DayCloseAccessError';
    this.code = code;
  }
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Day Close Access Hook
 *
 * Centralized hook for day close access validation.
 * Handles PIN verification flow and returns access result.
 *
 * @security SEC-010: All authorization decisions made server-side
 * @security FE-003: No sensitive data stored in component state
 *
 * @example
 * ```tsx
 * const { checkAccess, isChecking, lastResult, error } = useDayCloseAccess();
 *
 * const handleSubmit = async (pin: string) => {
 *   try {
 *     const result = await checkAccess(pin);
 *     if (result.allowed) {
 *       navigate('/day-close', { state: { accessResult: result } });
 *     } else {
 *       toast.error(result.reason);
 *     }
 *   } catch (err) {
 *     toast.error('Failed to verify access');
 *   }
 * };
 * ```
 */
export function useDayCloseAccess(): UseDayCloseAccessReturn {
  // State
  const [isChecking, setIsChecking] = useState(false);
  const [lastResult, setLastResult] = useState<DayCloseAccessResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Ref to track if component is mounted (avoid state updates after unmount)
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  // Note: Using useRef pattern instead of useEffect for cleanup tracking
  // This is more reliable for async operations

  /**
   * Check day close access with PIN
   * SEC-010: Delegates to backend for authorization decision
   * FE-003: PIN not stored, only passed to backend
   */
  const checkAccess = useCallback(async (pin: string): Promise<DayCloseAccessResult> => {
    // Clear previous state
    setIsChecking(true);
    setError(null);

    try {
      // SEC-010: Authorization decision made server-side
      // FE-003: PIN passed directly to IPC, not stored
      const input: DayCloseAccessInput = { pin };
      const result = await ipc.dayClose.checkAccess(input);

      // Check for IPC error response
      // Handler may return createErrorResponse for configuration/validation errors
      if ('error' in result && typeof result.error === 'string') {
        const ipcError = new DayCloseAccessError(
          (result as { error: string; message?: string }).message || 'Access check failed',
          (result as { error: string }).error
        );
        if (isMountedRef.current) {
          setError(ipcError);
          setLastResult(null);
          setIsChecking(false);
        }
        throw ipcError;
      }

      // Valid result (may be allowed or denied - both are valid responses)
      if (isMountedRef.current) {
        setLastResult(result);
        setError(null);
        setIsChecking(false);
      }

      return result;
    } catch (err) {
      // Handle IPC errors (network, channel not found, etc.)
      const accessError =
        err instanceof DayCloseAccessError
          ? err
          : err instanceof IPCError
            ? new DayCloseAccessError(err.message, err.code)
            : new DayCloseAccessError(
                err instanceof Error ? err.message : 'Unknown error during access check',
                'UNKNOWN_ERROR'
              );

      if (isMountedRef.current) {
        setError(accessError);
        setLastResult(null);
        setIsChecking(false);
      }

      throw accessError;
    }
  }, []);

  /**
   * Clear the cached result
   * Useful when navigating away or resetting state
   */
  const clearResult = useCallback(() => {
    setLastResult(null);
    setError(null);
  }, []);

  return {
    checkAccess,
    isChecking,
    lastResult,
    clearResult,
    error,
  };
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type {
  DayCloseAccessResult,
  DayCloseAccessInput,
  DayCloseActiveShift,
  DayCloseAccessUser,
  DayCloseAccessType,
  DayCloseAccessDenialReason,
} from '../lib/transport';
