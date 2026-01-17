/**
 * PIN Verification Dialog
 *
 * A dialog that prompts for PIN entry to access protected pages.
 * Only allows users with the specified minimum role to access.
 *
 * FE-001: Session caching - If user already authenticated within 15 minutes
 * with sufficient role, automatically bypasses PIN entry.
 *
 * SEC-011: Shows remaining attempts with visual warnings (yellow at 2, red at 1)
 *
 * @module renderer/components/auth/PinVerificationDialog
 * @security FE-001: STATE_MANAGEMENT - Session validation in memory, not storage
 * @security SEC-010: AUTHZ - Role validation performed server-side
 * @security SEC-011: ACCOUNT_LOCKOUT - Visual feedback on remaining attempts
 */

import React, { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { AlertCircle, Lock, AlertTriangle, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

/**
 * Verified user information returned on successful PIN verification
 */
export interface VerifiedUser {
  userId: string;
  name: string;
  role: string;
}

export interface PinVerificationDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog should close */
  onClose: () => void;
  /** Callback when PIN is verified successfully - receives verified user info */
  onVerified: (user: VerifiedUser) => void;
  /** Title to display in the dialog */
  title?: string;
  /** Description text */
  description?: string;
  /** Minimum role required (defaults to store_manager) */
  requiredRole?: 'cashier' | 'shift_manager' | 'store_manager';
}

interface VerifyResponse {
  success: boolean;
  data?: {
    user: {
      userId: string;
      name: string;
      role: string;
    };
  };
  error?: string;
  message?: string;
  errorCode?: string;
  attemptsRemaining?: number;
  maxAttempts?: number;
}

/**
 * Attempts state for tracking lockout warnings
 */
interface AttemptsState {
  remaining: number;
  max: number;
}

// ============================================================================
// Role Hierarchy
// ============================================================================

const ROLE_HIERARCHY: Record<string, number> = {
  cashier: 1,
  shift_manager: 2,
  store_manager: 3,
};

// ============================================================================
// Component
// ============================================================================

export function PinVerificationDialog({
  open,
  onClose,
  onVerified,
  title = 'Authentication Required',
  description = 'Please enter your PIN to continue.',
  requiredRole = 'store_manager',
}: PinVerificationDialogProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [attempts, setAttempts] = useState<AttemptsState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when dialog opens
  // Note: Session validation is handled by parent via useAuthGuard BEFORE opening this dialog
  useEffect(() => {
    if (open) {
      setPin('');
      setError(null);
      setAttempts(null);
      // Focus PIN input
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setPin(value);
    // Clear error when user starts typing again
    if (error) {
      setError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (pin.length < 4) {
      setError('PIN must be at least 4 digits');
      return;
    }

    setIsVerifying(true);
    setError(null);

    try {
      // Call auth:login to verify PIN
      const response = await window.electronAPI.invoke<VerifyResponse>('auth:login', { pin });

      if (!response.success) {
        // Update attempts state for visual feedback
        if (response.attemptsRemaining !== undefined && response.maxAttempts !== undefined) {
          setAttempts({
            remaining: response.attemptsRemaining,
            max: response.maxAttempts,
          });
        }

        // Set appropriate error message
        if (response.errorCode === 'ACCOUNT_LOCKED') {
          setError(response.error || 'Account locked');
        } else {
          setError('Invalid PIN');
        }

        setPin('');
        inputRef.current?.focus();
        return;
      }

      // Check if user has required role
      const userRole = response.data?.user?.role?.toLowerCase();
      const userRoleLevel = ROLE_HIERARCHY[userRole || ''] || 0;
      const requiredRoleLevel = ROLE_HIERARCHY[requiredRole] || 0;

      if (userRoleLevel < requiredRoleLevel) {
        setError(`Access denied. ${formatRole(requiredRole)} role required.`);
        setPin('');
        inputRef.current?.focus();
        // Logout since we logged them in but they don't have access
        await window.electronAPI.invoke('auth:logout');
        return;
      }

      // Success - user verified and has required role
      const verifiedUser: VerifiedUser = {
        userId: response.data?.user?.userId || '',
        name: response.data?.user?.name || '',
        role: response.data?.user?.role || '',
      };
      console.log('[PinVerificationDialog] === PIN VERIFICATION SUCCESS ===');
      console.log('[PinVerificationDialog] User authenticated:', verifiedUser);
      console.log('[PinVerificationDialog] Session created - next bypass check should succeed');
      onVerified(verifiedUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
      setPin('');
      inputRef.current?.focus();
    } finally {
      setIsVerifying(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  // Determine warning level based on remaining attempts
  const getWarningLevel = (): 'none' | 'warning' | 'critical' | 'locked' => {
    if (!attempts) return 'none';
    if (attempts.remaining === 0) return 'locked';
    if (attempts.remaining === 1) return 'critical';
    if (attempts.remaining === 2) return 'warning';
    return 'none';
  };

  const warningLevel = getWarningLevel();

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* SEC-011: Attempts remaining indicator with color coding */}
          {attempts && (
            <div
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-md text-sm',
                warningLevel === 'locked' && 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
                warningLevel === 'critical' && 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
                warningLevel === 'warning' && 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
                warningLevel === 'none' && 'bg-muted text-muted-foreground'
              )}
            >
              {warningLevel === 'locked' ? (
                <>
                  <ShieldAlert className="h-4 w-4 flex-shrink-0" />
                  <span className="font-medium">Account locked. Please wait and try again.</span>
                </>
              ) : warningLevel === 'critical' ? (
                <>
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span className="font-medium">
                    Last attempt! Account will be locked after next failure.
                  </span>
                </>
              ) : warningLevel === 'warning' ? (
                <>
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  <span>
                    {attempts.remaining} attempt{attempts.remaining !== 1 ? 's' : ''} remaining
                  </span>
                </>
              ) : (
                <span>
                  {attempts.remaining} of {attempts.max} attempts remaining
                </span>
              )}
            </div>
          )}

          {/* Error message (only show if no attempts indicator or for non-PIN errors) */}
          {error && !attempts && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md text-sm bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="pin" className="text-sm font-medium">
              Enter PIN
            </label>
            <Input
              ref={inputRef}
              id="pin"
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="Enter your PIN"
              value={pin}
              onChange={handlePinChange}
              disabled={isVerifying || warningLevel === 'locked'}
              className={cn(
                'text-center text-2xl tracking-widest',
                warningLevel === 'critical' && 'border-red-500 focus-visible:ring-red-500',
                warningLevel === 'warning' && 'border-yellow-500 focus-visible:ring-yellow-500'
              )}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground text-center">
              {formatRole(requiredRole)} access required
            </p>
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose} disabled={isVerifying}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isVerifying || pin.length < 4 || warningLevel === 'locked'}
            >
              {isVerifying ? 'Verifying...' : 'Verify'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatRole(role: string): string {
  switch (role) {
    case 'store_manager':
      return 'Store Manager';
    case 'shift_manager':
      return 'Shift Manager';
    case 'cashier':
      return 'Cashier';
    default:
      return role;
  }
}

export default PinVerificationDialog;
