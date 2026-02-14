/**
 * Shift Closing Form Component (Simplified Single-Step Flow)
 * Simple modal form for closing a shift with cash count
 *
 * Story: Simplified Shift Closing
 * Flow: Enter cash → Click Close → OPEN/ACTIVE → CLOSED
 */

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLocalCloseShift } from '@/hooks/useLocalShifts';
import { useToast } from '@/hooks/use-toast';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { PinVerificationDialog } from '@/components/auth/PinVerificationDialog';
import { Loader2 } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';

/**
 * Form validation schema
 */
const closeShiftFormSchema = z.object({
  closing_cash: z
    .number({ message: 'Closing cash must be a number' })
    .min(0, 'Closing cash must be a non-negative number'),
});

type CloseShiftFormValues = z.infer<typeof closeShiftFormSchema>;

interface ShiftClosingFormProps {
  shiftId: string;
  storeId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  /**
   * When true, skips PIN verification (user already has manager override from parent)
   * SEC-010: Only set this when parent component (e.g., DayCloseAccessGuard) has
   * already verified user has shift_manager or store_owner role via backend.
   * @default false
   */
  preAuthorizedOverride?: boolean;
}

/**
 * ShiftClosingForm component
 * Simple single-step dialog for closing shifts
 */
export function ShiftClosingForm({
  shiftId,
  open,
  onOpenChange,
  onSuccess,
  preAuthorizedOverride = false,
}: ShiftClosingFormProps) {
  const { toast } = useToast();
  // Local IPC mutation - handles query invalidation internally on success
  // SEC-010: Backend validates session and enforces authorization
  // DB-006: Store-scoped via backend handler (getConfiguredStore)
  const closeShiftMutation = useLocalCloseShift();

  // SEC-010: Auth guard for shift_manager role validation
  // If preAuthorizedOverride is true, user already has manager auth from parent guard
  const { executeWithAuth, isChecking } = useAuthGuard('shift_manager');

  // State for PIN dialog flow
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pendingValues, setPendingValues] = useState<CloseShiftFormValues | null>(null);

  const form = useForm<CloseShiftFormValues>({
    resolver: zodResolver(closeShiftFormSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: {
      closing_cash: 0,
    },
  });

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      form.reset({
        closing_cash: 0,
      });
    }
  }, [open, form]);

  /**
   * Performs the actual shift close operation.
   * Extracted to support both direct auth (valid session) and PIN dialog flows.
   * SEC-010: Called only after successful authentication/authorization
   */
  const performClose = useCallback(
    async (values: CloseShiftFormValues) => {
      try {
        await closeShiftMutation.mutateAsync({
          shiftId,
          closingCash: values.closing_cash,
        });

        toast({
          title: 'Success',
          description: 'Shift closed successfully',
        });

        // Note: Query invalidation handled by useLocalCloseShift onSuccess callback
        // Invalidates: localShiftsKeys.all, openShifts, detail(shiftId), dayBins

        // Reset form and close dialog
        form.reset();
        onOpenChange(false);

        // Clear pending values
        setPendingValues(null);

        // Call success callback if provided
        if (onSuccess) {
          onSuccess();
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to close shift. Please try again.';

        if (errorMessage.includes('SHIFT_NOT_FOUND')) {
          toast({
            title: 'Error',
            description: 'Shift not found.',
            variant: 'destructive',
          });
        } else if (errorMessage.includes('SHIFT_ALREADY_CLOSED')) {
          toast({
            title: 'Error',
            description: 'Shift is already closed.',
            variant: 'destructive',
          });
        } else if (errorMessage.includes('SHIFT_INVALID_STATUS')) {
          toast({
            title: 'Error',
            description:
              'Shift cannot be closed in its current status. Only OPEN or ACTIVE shifts can be closed.',
            variant: 'destructive',
          });
        } else if (errorMessage.includes('INVALID_CASH_AMOUNT')) {
          toast({
            title: 'Error',
            description: 'Closing cash amount is invalid.',
            variant: 'destructive',
          });
          form.setError('closing_cash', {
            type: 'manual',
            message: 'Closing cash must be a non-negative number',
          });
        } else {
          toast({
            title: 'Error',
            description: errorMessage,
            variant: 'destructive',
          });
        }
      }
    },
    [closeShiftMutation, shiftId, toast, form, onOpenChange, onSuccess]
  );

  /**
   * Handle form submission with session-first auth guard.
   * SEC-010: Validates session before attempting protected operation.
   * Pattern: Check session → if valid proceed, else show PIN dialog.
   *
   * If preAuthorizedOverride is true (user came from DayCloseAccessGuard with
   * 'OVERRIDE' accessType), skip auth check entirely - backend already verified.
   */
  const onSubmit = async (values: CloseShiftFormValues) => {
    // SEC-010: If parent guard already verified manager override, proceed directly
    if (preAuthorizedOverride) {
      performClose(values);
      return;
    }

    await executeWithAuth(
      // onSuccess: Session is valid with shift_manager role - proceed directly
      () => {
        performClose(values);
      },
      // onNeedAuth: No valid session - store values and show PIN dialog
      () => {
        setPendingValues(values);
        setShowPinDialog(true);
      }
    );
  };

  /**
   * Handle successful PIN verification.
   * SEC-010: PIN verification confirms shift_manager role - proceed with close.
   */
  const handlePinVerified = useCallback(() => {
    setShowPinDialog(false);
    if (pendingValues) {
      performClose(pendingValues);
    }
  }, [pendingValues, performClose]);

  /**
   * Handle PIN dialog cancellation.
   * Clears pending values and closes dialog without action.
   */
  const handlePinClose = useCallback(() => {
    setShowPinDialog(false);
    setPendingValues(null);
  }, []);

  const isSubmitting = closeShiftMutation.isPending;
  // Disable form during session check or mutation
  const isDisabled = isSubmitting || isChecking;

  return (
    <>
      {/* Hide parent dialog when PIN dialog is open to avoid focus trap conflicts */}
      <Dialog open={open && !showPinDialog} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Close Shift</DialogTitle>
            <DialogDescription>
              Enter the actual cash in the drawer to close this shift.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {/* Closing Cash Input */}
              <FormField
                control={form.control}
                name="closing_cash"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cash in Drawer</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        {...field}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value === '') {
                            field.onChange(0);
                          } else {
                            const numValue = parseFloat(value);
                            if (!isNaN(numValue)) {
                              field.onChange(numValue);
                            } else {
                              field.onChange(0);
                            }
                          }
                        }}
                        value={field.value === 0 ? '' : field.value}
                        disabled={isDisabled}
                        data-testid="closing-cash-input"
                      />
                    </FormControl>
                    <FormDescription>
                      Count the cash in the register and enter the total amount
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isDisabled}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isDisabled} data-testid="close-shift-button">
                  {(isSubmitting || isChecking) && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {isChecking ? 'Checking...' : 'Close Shift'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* SEC-010: PIN verification dialog for shift_manager authentication */}
      <PinVerificationDialog
        open={showPinDialog}
        onClose={handlePinClose}
        onVerified={handlePinVerified}
        requiredRole="shift_manager"
        title="Manager Approval Required"
        description="Enter your PIN to close this shift."
      />
    </>
  );
}
