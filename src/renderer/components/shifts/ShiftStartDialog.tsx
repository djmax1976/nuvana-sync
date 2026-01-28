/**
 * Shift Start Dialog
 *
 * A simple PIN entry dialog for starting a manual shift.
 * The employee is automatically identified by their unique PIN.
 *
 * @module renderer/components/shifts/ShiftStartDialog
 * @security SEC-001: PIN entry for cashier authentication
 * @security SEC-011: Lockout protection via backend
 */

import React, { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { AlertCircle, Loader2, Play } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

export interface ShiftStartResult {
  pin: string;
}

export interface ShiftStartDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Register display name for context */
  registerName: string;
  /** Callback when dialog should close */
  onClose: () => void;
  /** Callback when PIN is submitted */
  onStart: (result: ShiftStartResult) => void;
  /** Whether the shift start is in progress */
  isLoading?: boolean;
  /** Error message from the parent (e.g., from mutation) */
  error?: string | null;
}

// ============================================================================
// Component
// ============================================================================

export function ShiftStartDialog({
  open,
  registerName,
  onClose,
  onStart,
  isLoading = false,
  error: externalError,
}: ShiftStartDialogProps) {
  const [pin, setPin] = useState('');
  const [internalError, setInternalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog opens/closes
  const prevOpenRef = useRef(open);
  useEffect(() => {
    // Only reset when transitioning from closed to open
    if (open && !prevOpenRef.current) {
      // Use requestAnimationFrame to batch state updates outside the effect
      requestAnimationFrame(() => {
        setPin('');
        setInternalError(null);
      });
      // Focus PIN input
      setTimeout(() => inputRef.current?.focus(), 100);
    }
    prevOpenRef.current = open;
  }, [open]);

  // Clear internal error when external error is set
  const prevExternalErrorRef = useRef(externalError);
  useEffect(() => {
    // Only clear when external error transitions from null to a value
    if (externalError && !prevExternalErrorRef.current) {
      requestAnimationFrame(() => {
        setInternalError(null);
      });
    }
    prevExternalErrorRef.current = externalError;
  }, [externalError]);

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setPin(value);
    // Clear error when user starts typing
    if (internalError) {
      setInternalError(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (pin.length < 4) {
      setInternalError('PIN must be at least 4 digits');
      return;
    }

    // Call parent's onStart with just the PIN
    // Backend will identify the employee by their unique PIN
    onStart({ pin });
  };

  const error = externalError || internalError;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Start Shift
          </DialogTitle>
          <DialogDescription>Enter your PIN to start a shift on {registerName}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Error message */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md text-sm bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="shift-pin" className="text-sm font-medium">
              Enter your PIN
            </label>
            <Input
              ref={inputRef}
              id="shift-pin"
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="Enter PIN"
              value={pin}
              onChange={handlePinChange}
              disabled={isLoading}
              className="text-center text-2xl tracking-widest"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground text-center">
              Your PIN uniquely identifies you as the cashier
            </p>
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || pin.length < 4}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                'Start Shift'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ShiftStartDialog;
