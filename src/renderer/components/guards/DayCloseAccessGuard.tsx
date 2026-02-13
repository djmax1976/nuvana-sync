/**
 * Day Close Access Guard
 *
 * Route-level guard that validates day close access before rendering children.
 * Implements centralized access control for the day close wizard flow.
 *
 * Flow:
 * 1. On mount, shows PIN dialog immediately
 * 2. On PIN submit, calls backend via useDayCloseAccess() hook
 * 3. Backend validates:
 *    - PIN authentication (BR-005)
 *    - Exactly one open shift (BR-001, BR-002)
 *    - User is shift owner OR has override role (BR-003, BR-004)
 * 4. If allowed: Renders children with DayCloseAccessContext
 * 5. If denied: Shows toast with error and redirects to /terminals
 *
 * Business Requirements:
 * - BR-001: At least one active shift
 * - BR-002: Exactly one active shift
 * - BR-003: Cashier ownership
 * - BR-004: Manager override (shift_manager, store_manager)
 * - BR-005: PIN verification first
 * - BR-006: Conditions 1 & 2 always enforced (even managers)
 *
 * @module renderer/components/guards/DayCloseAccessGuard
 * @security SEC-010: Authorization enforced via backend IPC handler
 * @security FE-001: No sensitive data (PIN) stored in component state
 * @security FE-001: XSS prevention via React's built-in escaping
 */

'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { AlertCircle, Lock, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  useDayCloseAccess,
  type DayCloseAccessResult,
  type DayCloseAccessDenialReason,
} from '@/hooks/useDayCloseAccess';
import {
  DayCloseAccessProvider,
  type DayCloseAccessContextValue,
} from '@/contexts/DayCloseAccessContext';

// ============================================================================
// Types
// ============================================================================

export interface DayCloseAccessGuardProps {
  /** The protected content to render after successful access validation */
  children: React.ReactNode;
}

/**
 * Internal state for the guard
 * - 'pending': Initial state, showing PIN dialog
 * - 'verifying': PIN submitted, waiting for backend response
 * - 'granted': Access granted, rendering children
 * - 'denied': Access denied, redirecting
 * - 'cancelled': User cancelled PIN dialog
 */
type GuardState = 'pending' | 'verifying' | 'granted' | 'denied' | 'cancelled';

// ============================================================================
// Constants
// ============================================================================

/**
 * Human-readable error messages for each denial reason
 * Used in toast notifications when access is denied
 */
const DENIAL_MESSAGES: Record<DayCloseAccessDenialReason, { title: string; description: string }> =
  {
    NO_OPEN_SHIFTS: {
      title: 'No Open Shifts',
      description: 'There are no open shifts to close. Please start a shift first.',
    },
    MULTIPLE_OPEN_SHIFTS: {
      title: 'Multiple Shifts Open',
      description: 'Multiple shifts are open. Close other shifts before closing the day.',
    },
    NOT_SHIFT_OWNER: {
      title: 'Access Denied',
      description: 'Only the assigned cashier or a manager can close this shift.',
    },
    INVALID_PIN: {
      title: 'Invalid PIN',
      description: 'The PIN you entered is incorrect. Please try again.',
    },
    NOT_AUTHENTICATED: {
      title: 'Authentication Required',
      description: 'Please enter your PIN to continue.',
    },
  };

// ============================================================================
// Component
// ============================================================================

/**
 * Day Close Access Guard Component
 *
 * Route-level protection for the /day-close route.
 * Must be used in router.tsx to wrap DayClosePage.
 *
 * @example
 * ```tsx
 * // In router.tsx
 * {
 *   path: 'day-close',
 *   element: (
 *     <DayCloseAccessGuard>
 *       <Suspense fallback={<PageLoader />}>
 *         <DayClosePage />
 *       </Suspense>
 *     </DayCloseAccessGuard>
 *   ),
 * }
 * ```
 */
export function DayCloseAccessGuard({ children }: DayCloseAccessGuardProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { checkAccess, isChecking, error: accessError } = useDayCloseAccess();

  // ============================================================================
  // State
  // ============================================================================

  const [guardState, setGuardState] = useState<GuardState>('pending');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [accessResult, setAccessResult] = useState<DayCloseAccessResult | null>(null);

  // Track if PIN dialog should be shown (separate from guardState for controlled dialog)
  const [showPinDialog, setShowPinDialog] = useState(true);

  // Ref for PIN input focus management
  const pinInputRef = useRef<HTMLInputElement>(null);

  // Ref to track if component is mounted (prevent state updates after unmount)
  const isMountedRef = useRef(true);

  // ============================================================================
  // Effects
  // ============================================================================

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Focus PIN input when dialog opens
  useEffect(() => {
    if (showPinDialog && guardState === 'pending') {
      // Small delay to ensure dialog is rendered
      const timer = setTimeout(() => {
        pinInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [showPinDialog, guardState]);

  // ============================================================================
  // Handlers
  // ============================================================================

  /**
   * Handle PIN input change
   * SEC-014: Validates PIN format (digits only, max 6)
   * FE-001: PIN is only stored in local state temporarily
   */
  const handlePinChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // SEC-014: Only allow digits, max 6 characters
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setPin(value);
    // Clear error when user starts typing
    setPinError(null);
  }, []);

  /**
   * Handle access denied response
   * Shows appropriate toast and determines next action
   *
   * For INVALID_PIN: Stay on dialog, let user retry
   * For other reasons: Redirect to terminals
   */
  const handleAccessDenied = useCallback(
    (result: DayCloseAccessResult) => {
      const reasonCode = result.reasonCode || 'NOT_AUTHENTICATED';
      const message = DENIAL_MESSAGES[reasonCode];

      if (reasonCode === 'INVALID_PIN') {
        // INVALID_PIN: Allow retry
        setPinError(message.description);
        setGuardState('pending');
        pinInputRef.current?.focus();
        return;
      }

      // Other denials: Show toast and redirect
      toast({
        variant: 'destructive',
        title: message.title,
        description: message.description,
      });

      setGuardState('denied');
      setShowPinDialog(false);

      // Redirect to terminals page
      navigate('/terminals', { replace: true });
    },
    [toast, navigate]
  );

  /**
   * Handle PIN submission
   * Calls backend via useDayCloseAccess hook for authorization
   *
   * @security SEC-010: Authorization decision made server-side
   * @security FE-003: PIN cleared from state after submission
   */
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      // SEC-014: Validate PIN length
      if (pin.length < 4) {
        setPinError('PIN must be at least 4 digits');
        return;
      }

      setGuardState('verifying');
      setPinError(null);

      try {
        // SEC-010: Backend makes authorization decision
        const result = await checkAccess(pin);

        // FE-003: Clear PIN immediately after submission
        if (isMountedRef.current) {
          setPin('');
        }

        if (!isMountedRef.current) return;

        if (result.allowed) {
          // Access granted - transition to granted state
          setAccessResult(result);
          setGuardState('granted');
          setShowPinDialog(false);
        } else {
          // Access denied - handle based on reason
          handleAccessDenied(result);
        }
      } catch {
        // IPC or network error
        if (!isMountedRef.current) return;

        setPinError('Failed to verify access. Please try again.');
        setGuardState('pending');
        pinInputRef.current?.focus();
      }
    },
    [pin, checkAccess, handleAccessDenied]
  );

  /**
   * Handle dialog cancel (Escape or Cancel button)
   * Redirects back to terminals page
   */
  const handleCancel = useCallback(() => {
    setShowPinDialog(false);
    setGuardState('cancelled');
    navigate('/terminals', { replace: true });
  }, [navigate]);

  /**
   * Handle dialog open change (from Dialog component)
   */
  const handleDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        handleCancel();
      }
    },
    [handleCancel]
  );

  /**
   * Handle keydown for Escape key
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    },
    [handleCancel]
  );

  // ============================================================================
  // Context Value
  // ============================================================================

  /**
   * Memoized context value to prevent unnecessary re-renders
   * Only created when access is granted with valid result
   *
   * @security SEC-010: Context only contains data from validated backend response
   */
  const contextValue = useMemo<DayCloseAccessContextValue | null>(() => {
    if (!accessResult?.allowed || !accessResult.activeShift || !accessResult.user) {
      return null;
    }

    return {
      activeShift: accessResult.activeShift,
      user: accessResult.user,
      accessType: accessResult.accessType || 'OWNER',
    };
  }, [accessResult]);

  // ============================================================================
  // Render
  // ============================================================================

  // If access granted, render children with context
  if (guardState === 'granted' && contextValue) {
    return <DayCloseAccessProvider value={contextValue}>{children}</DayCloseAccessProvider>;
  }

  // If denied or cancelled, render nothing (redirect happening)
  if (guardState === 'denied' || guardState === 'cancelled') {
    return null;
  }

  // Show PIN dialog for pending/verifying states
  return (
    <Dialog open={showPinDialog} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Day Close Authorization
          </DialogTitle>
          <DialogDescription>
            Enter your PIN to access the Day Close wizard. The system will verify you have
            permission to close the current shift.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Error message */}
          {pinError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md text-sm bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{pinError}</span>
            </div>
          )}

          {/* IPC Error message */}
          {accessError && !pinError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md text-sm bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
              <XCircle className="h-4 w-4 flex-shrink-0" />
              <span>Connection error. Please try again.</span>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="day-close-pin" className="text-sm font-medium">
              Enter PIN
            </label>
            <Input
              ref={pinInputRef}
              id="day-close-pin"
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="Enter your PIN"
              value={pin}
              onChange={handlePinChange}
              disabled={isChecking || guardState === 'verifying'}
              className={cn(
                'text-center text-2xl tracking-widest',
                pinError && 'border-red-500 focus-visible:ring-red-500'
              )}
              autoComplete="off"
              data-testid="day-close-pin-input"
            />
            <p className="text-xs text-muted-foreground text-center">
              Shift owner or manager access required
            </p>
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isChecking || guardState === 'verifying'}
              data-testid="day-close-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isChecking || guardState === 'verifying' || pin.length < 4}
              data-testid="day-close-verify-btn"
            >
              {isChecking || guardState === 'verifying' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Verify'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default DayCloseAccessGuard;
