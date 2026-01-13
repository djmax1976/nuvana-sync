
/**
 * Shift Opening Form Component
 * Form for opening a new shift with cashier, terminal, and opening cash selection
 *
 * Story: 4.7 - Shift Management UI
 */

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOpenShift, useInvalidateShifts } from "@/lib/api/shifts";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Form validation schema matching backend OpenShiftSchema
 * Mirrors backend validation client-side for immediate feedback
 */
const openShiftFormSchema = z.object({
  store_id: z.string().uuid("Store ID must be a valid UUID"),
  cashier_id: z.string().uuid("Cashier must be selected"),
  pos_terminal_id: z.string().uuid("Terminal must be selected"),
  opening_cash: z
    .number({ error: "Opening cash must be a number" })
    .nonnegative({ message: "Opening cash must be a non-negative number" }),
});

type OpenShiftFormValues = z.infer<typeof openShiftFormSchema>;

/**
 * Cashier option for dropdown
 */
interface CashierOption {
  user_id: string;
  name: string;
  email: string;
}

/**
 * Terminal option for dropdown
 */
interface TerminalOption {
  pos_terminal_id: string;
  name: string;
}

interface ShiftOpeningFormProps {
  storeId: string;
  cashiers: CashierOption[];
  terminals: TerminalOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

/**
 * ShiftOpeningForm component
 * Dialog form for opening a new shift
 * Uses React Hook Form with Zod validation matching backend schema
 */
export function ShiftOpeningForm({
  storeId,
  cashiers,
  terminals,
  open,
  onOpenChange,
  onSuccess,
}: ShiftOpeningFormProps) {
  const { toast } = useToast();
  const openShiftMutation = useOpenShift();
  const { invalidateList } = useInvalidateShifts();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<OpenShiftFormValues>({
    resolver: zodResolver(openShiftFormSchema),
    mode: "onSubmit",
    reValidateMode: "onChange",
    shouldFocusError: true,
    defaultValues: {
      store_id: storeId,
      cashier_id: "",
      pos_terminal_id: "",
      opening_cash: 0,
    },
  });

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      form.reset({
        store_id: storeId,
        cashier_id: "",
        pos_terminal_id: "",
        opening_cash: 0,
      });
    }
  }, [open, storeId, form]);

  const onSubmit = async (values: OpenShiftFormValues) => {
    setIsSubmitting(true);
    try {
      await openShiftMutation.mutateAsync(values);

      toast({
        title: "Success",
        description: "Shift opened successfully",
      });

      // Invalidate shift list to refresh
      invalidateList();

      // Reset form
      form.reset();

      // Close dialog
      onOpenChange(false);

      // Call success callback if provided
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      // Handle validation errors from backend
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to open shift. Please try again.";

      // Check for specific error codes
      if (errorMessage.includes("SHIFT_ALREADY_ACTIVE")) {
        toast({
          title: "Error",
          description:
            "An active shift already exists for this terminal. Please close the existing shift first.",
          variant: "destructive",
        });
      } else if (errorMessage.includes("CASHIER_NOT_FOUND")) {
        toast({
          title: "Error",
          description: "Selected cashier is not valid for this store.",
          variant: "destructive",
        });
        form.setError("cashier_id", {
          type: "manual",
          message: "Cashier is not valid for this store",
        });
      } else if (errorMessage.includes("TERMINAL_NOT_FOUND")) {
        toast({
          title: "Error",
          description: "Selected terminal is not valid for this store.",
          variant: "destructive",
        });
        form.setError("pos_terminal_id", {
          type: "manual",
          message: "Terminal is not valid for this store",
        });
      } else if (errorMessage.includes("INVALID_OPENING_CASH")) {
        toast({
          title: "Error",
          description: "Opening cash amount is invalid.",
          variant: "destructive",
        });
        form.setError("opening_cash", {
          type: "manual",
          message: "Opening cash must be a non-negative number",
        });
      } else {
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Open New Shift</DialogTitle>
          <DialogDescription>
            Select cashier, terminal, and enter opening cash amount to open a
            new shift.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Store ID (hidden, set from prop) */}
            <FormField
              control={form.control}
              name="store_id"
              render={({ field }) => (
                <FormItem className="hidden">
                  <FormControl>
                    <Input type="hidden" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />

            {/* Cashier Selection */}
            <FormField
              control={form.control}
              name="cashier_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cashier</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={isSubmitting}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="cashier-select">
                        <SelectValue placeholder="Select a cashier" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {cashiers.length === 0 ? (
                        <SelectItem value="no-cashiers" disabled>
                          No cashiers available
                        </SelectItem>
                      ) : (
                        cashiers.map((cashier) => (
                          <SelectItem
                            key={cashier.user_id}
                            value={cashier.user_id}
                            data-testid={`cashier-option-${cashier.user_id}`}
                          >
                            {cashier.name} ({cashier.email})
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Select a cashier assigned to this store
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Terminal Selection */}
            <FormField
              control={form.control}
              name="pos_terminal_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>POS Terminal</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={isSubmitting}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="terminal-select">
                        <SelectValue placeholder="Select a terminal" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {terminals.length === 0 ? (
                        <SelectItem value="no-terminals" disabled>
                          No terminals available
                        </SelectItem>
                      ) : (
                        terminals.map((terminal) => (
                          <SelectItem
                            key={terminal.pos_terminal_id}
                            value={terminal.pos_terminal_id}
                            data-testid={`terminal-option-${terminal.pos_terminal_id}`}
                          >
                            {terminal.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Select a POS terminal for this shift
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Opening Cash */}
            <FormField
              control={form.control}
              name="opening_cash"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Opening Cash</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      {...field}
                      onChange={(e) => {
                        const value = e.target.value;
                        // Allow negative values to pass through for validation
                        // Convert empty string to 0, otherwise parse as number
                        if (value === "") {
                          field.onChange(0);
                        } else {
                          const numValue = parseFloat(value);
                          // Only update if it's a valid number (including negative)
                          if (!isNaN(numValue)) {
                            field.onChange(numValue);
                          } else {
                            field.onChange(0);
                          }
                        }
                      }}
                      value={field.value === 0 ? "" : field.value}
                      disabled={isSubmitting}
                      data-testid="opening-cash-input"
                    />
                  </FormControl>
                  <FormDescription>
                    Enter the starting cash amount (must be ≥ 0)
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
              <Button
                type="submit"
                disabled={
                  isSubmitting ||
                  cashiers.length === 0 ||
                  terminals.length === 0
                }
                data-testid="submit-shift-opening"
              >
                {isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Open Shift
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
