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
import { useCloseShift, useInvalidateShifts } from '@/lib/api/shifts';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';

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
}: ShiftClosingFormProps) {
  const { toast } = useToast();
  const closeShiftMutation = useCloseShift();
  const { invalidateList } = useInvalidateShifts();

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

  // Handle form submission
  const onSubmit = async (values: CloseShiftFormValues) => {
    try {
      await closeShiftMutation.mutateAsync({
        shiftId,
        closingCash: values.closing_cash,
      });

      toast({
        title: 'Success',
        description: 'Shift closed successfully',
      });

      // Invalidate shift list to refresh
      invalidateList();

      // Reset form and close dialog
      form.reset();
      onOpenChange(false);

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
  };

  const isSubmitting = closeShiftMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                      disabled={isSubmitting}
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
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} data-testid="close-shift-button">
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Close Shift
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
