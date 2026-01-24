/**
 * Auth Guard Hook
 *
 * Enterprise-grade session validation for protected operations.
 * Checks session validity BEFORE opening any dialogs.
 *
 * Pattern: Check first, prompt only if needed.
 *
 * @module renderer/hooks/useAuthGuard
 * @security FE-001: Session caching - 15 minute auth window
 * @security SEC-010: Server-side role validation
 */

import { useCallback, useState } from 'react';

export interface AuthGuardUser {
  userId: string;
  name: string;
  role: string;
}

interface SessionCheckResponse {
  success: boolean;
  data?: {
    valid: boolean;
    user?: AuthGuardUser;
    timeoutIn?: number;
  };
}

type RequiredRole = 'cashier' | 'shift_manager' | 'store_manager';

interface UseAuthGuardReturn {
  /**
   * Execute a protected action. Checks session first, calls onNeedAuth only if session invalid.
   * @param onSuccess - Called immediately if session valid, or after successful PIN entry
   * @param onNeedAuth - Called only if PIN dialog needs to be shown
   */
  executeWithAuth: (
    onSuccess: (user: AuthGuardUser) => void,
    onNeedAuth: () => void
  ) => Promise<void>;

  /** Whether a session check is in progress */
  isChecking: boolean;
}

/**
 * Hook for guarding protected operations with session-first validation.
 *
 * @param requiredRole - Minimum role required for the operation
 * @returns Auth guard utilities
 *
 * @example
 * ```tsx
 * const { executeWithAuth, isChecking } = useAuthGuard('cashier');
 *
 * const handleReceivePackClick = () => {
 *   executeWithAuth(
 *     (user) => {
 *       // Session valid - proceed directly
 *       setReceptionDialogOpen(true);
 *     },
 *     () => {
 *       // Session invalid - show PIN dialog
 *       setPinDialogOpen(true);
 *     }
 *   );
 * };
 * ```
 */
export function useAuthGuard(requiredRole: RequiredRole): UseAuthGuardReturn {
  const [isChecking, setIsChecking] = useState(false);

  const executeWithAuth = useCallback(
    async (onSuccess: (user: AuthGuardUser) => void, onNeedAuth: () => void): Promise<void> => {
      setIsChecking(true);

      try {
        const response = await window.electronAPI.invoke<SessionCheckResponse>(
          'auth:checkSessionForRole',
          { requiredRole }
        );

        if (response.success && response.data?.valid && response.data.user) {
          // Valid session - update activity and proceed immediately
          window.electronAPI.invoke('auth:updateActivity').catch(() => {});
          onSuccess(response.data.user);
        } else {
          // No valid session - caller needs to show PIN dialog
          onNeedAuth();
        }
      } catch {
        // Session check failed - fall back to requiring auth
        onNeedAuth();
      } finally {
        setIsChecking(false);
      }
    },
    [requiredRole]
  );

  return { executeWithAuth, isChecking };
}

export default useAuthGuard;
