
/**
 * Terminal Authentication Modal Component
 * Dialog form for cashier authentication when selecting a terminal
 *
 * Story: 4.9 - MyStore Terminal Dashboard
 *
 * @requirements
 * - AC #3: Modal with cashier authentication form
 * - Cashier Name dropdown (for new shifts) or display-only (for resuming shifts)
 * - PIN Number masked input field
 * - Cancel and Submit buttons
 * - Form validation (cashier name required for new shifts, PIN required)
 * - Security: Only the cashier who owns an active shift can resume it
 */

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Loader2, User, DollarSign } from "lucide-react";
import { useEffect, useState } from "react";
import { useCashiers, useAuthenticateCashier } from "@/lib/api/cashiers";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useActiveShift, useShiftStart } from "@/lib/api/shifts";
import { useNavigate } from "react-router-dom";
import { useCashierSession } from "@/contexts/CashierSessionContext";

/**
 * Form validation schema for terminal authentication
 * - cashier_name: Required for new shifts, optional for resume mode
 * - pin_number: Always required, exactly 4 numeric digits
 * - starting_cash: Optional, non-negative number for new shifts only
 *
 * @security
 * - SEC-014: Input validation with strict constraints
 * - FE-002: Schema validation mirrors backend validation
 */
const terminalAuthFormSchema = z.object({
  cashier_name: z.string().optional(),
  pin_number: z
    .string({ message: "PIN number is required" })
    .min(1, { message: "PIN number is required" })
    .regex(/^\d{4}$/, { message: "PIN must be exactly 4 numeric digits" }),
  starting_cash: z
    .number()
    .nonnegative("Starting cash must be a non-negative number")
    .optional(),
});

type TerminalAuthFormValues = z.infer<typeof terminalAuthFormSchema>;

/** Form values for onSubmit callback (new shift mode) */
interface NewShiftFormValues {
  cashier_name: string;
  pin_number: string;
  starting_cash?: number;
}

interface TerminalAuthModalProps {
  terminalId: string;
  terminalName: string;
  storeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit?: (values: NewShiftFormValues) => void | Promise<void>;
}

/**
 * TerminalAuthModal component
 * Dialog form for cashier authentication when selecting a terminal
 * Uses React Hook Form with Zod validation
 *
 * Two modes:
 * 1. New Shift Mode: Shows cashier dropdown + PIN input
 * 2. Resume Shift Mode: Shows cashier name (read-only) + PIN input only
 *
 * Security: When resuming a shift, verifies the authenticated cashier
 * matches the shift owner before allowing access.
 */
export function TerminalAuthModal({
  terminalId,
  terminalName,
  storeId,
  open,
  onOpenChange,
  onSubmit,
}: TerminalAuthModalProps) {
  const navigate = useNavigate();
  const { setSession } = useCashierSession();
  const [ownershipError, setOwnershipError] = useState<string | null>(null);

  // Check for active shift when modal opens
  const {
    data: activeShift,
    isLoading: isLoadingActiveShift,
    error: activeShiftError,
  } = useActiveShift(terminalId, { enabled: open });

  // Determine if we're in resume mode (active shift exists)
  const isResumeMode = !!activeShift && !isLoadingActiveShift;

  // Shift start mutation
  const startShiftMutation = useShiftStart();

  // Single form for both new shift and resume modes
  const form = useForm<TerminalAuthFormValues>({
    resolver: zodResolver(terminalAuthFormSchema),
    mode: "onSubmit",
    reValidateMode: "onChange",
    shouldFocusError: true,
    defaultValues: {
      cashier_name: "",
      pin_number: "",
      starting_cash: undefined,
    },
  });

  // Fetch cashiers for the store (only needed for new shift mode)
  const {
    data: cashiers = [],
    isLoading: isLoadingCashiers,
    error: cashiersError,
  } = useCashiers(
    storeId,
    { is_active: true },
    { enabled: open && !isResumeMode },
  );

  // Authenticate cashier mutation
  const authenticateMutation = useAuthenticateCashier();

  const isSubmitting =
    form.formState.isSubmitting === true ||
    authenticateMutation.isPending === true ||
    startShiftMutation.isPending === true;

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      form.reset({
        cashier_name: "",
        pin_number: "",
        starting_cash: undefined,
      });
      authenticateMutation.reset();
      startShiftMutation.reset();
      setOwnershipError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * Handle form submission
   * Routes to appropriate handler based on resume mode
   */
  const handleSubmit = async (values: TerminalAuthFormValues) => {
    if (isResumeMode) {
      await handleResumeSubmit(values);
    } else {
      await handleNewShiftSubmit(values);
    }
  };

  /**
   * Handle form submission for resuming an existing shift
   * Authenticates the cashier and verifies they own the shift
   */
  const handleResumeSubmit = async (values: TerminalAuthFormValues) => {
    if (!activeShift) return;

    setOwnershipError(null);

    try {
      // Authenticate cashier using the name from the active shift
      const authResult = await authenticateMutation.mutateAsync({
        storeId,
        identifier: { name: activeShift.cashier_name! },
        pin: values.pin_number,
        terminalId,
      });

      // Verify session was created
      if (!authResult.session?.session_token) {
        form.setError("root", {
          type: "manual",
          message: "Failed to create cashier session",
        });
        return;
      }

      // SECURITY CHECK: Verify the authenticated cashier owns this shift
      if (authResult.cashier_id !== activeShift.cashier_id) {
        setOwnershipError(
          "Access denied. Only the cashier who started this shift can resume it.",
        );
        return;
      }

      // Store session in context
      setSession({
        sessionId: authResult.session.session_id,
        sessionToken: authResult.session.session_token,
        cashierId: authResult.cashier_id,
        cashierName: activeShift.cashier_name!,
        terminalId,
        expiresAt: authResult.session.expires_at,
      });

      // Navigate to shift page
      navigate(`/terminal/${terminalId}/shift`);
      onOpenChange(false);
    } catch {
      // Errors are handled by mutation state
    }
  };

  /**
   * Handle form submission for starting a new shift
   */
  const handleNewShiftSubmit = async (values: TerminalAuthFormValues) => {
    // Validate cashier_name is provided for new shifts
    if (!values.cashier_name) {
      form.setError("cashier_name", {
        type: "manual",
        message: "Cashier name is required",
      });
      return;
    }

    if (onSubmit) {
      await onSubmit({
        cashier_name: values.cashier_name,
        pin_number: values.pin_number,
        starting_cash: values.starting_cash,
      });
      return;
    }

    try {
      // Authenticate cashier and create session token
      const authResult = await authenticateMutation.mutateAsync({
        storeId,
        identifier: { name: values.cashier_name },
        pin: values.pin_number,
        terminalId,
      });

      // Verify session was created
      if (!authResult.session?.session_token) {
        form.setError("root", {
          type: "manual",
          message: "Failed to create cashier session",
        });
        return;
      }

      // Store session in context
      setSession({
        sessionId: authResult.session.session_id,
        sessionToken: authResult.session.session_token,
        cashierId: authResult.cashier_id,
        cashierName: values.cashier_name,
        terminalId,
        expiresAt: authResult.session.expires_at,
      });

      // Start a new shift with optional starting cash
      await startShiftMutation.mutateAsync({
        terminalId,
        sessionToken: authResult.session.session_token,
        openingCash: values.starting_cash,
      });

      // Navigate to shift page
      navigate(`/terminal/${terminalId}/shift`);
      onOpenChange(false);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Failed to create cashier session"
      ) {
        form.setError("root", {
          type: "manual",
          message: error.message,
        });
      }
    }
  };

  const handleCancel = () => {
    form.reset();
    setOwnershipError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[425px]"
        data-testid="terminal-auth-modal"
      >
        <DialogHeader>
          <DialogTitle>Terminal Authentication</DialogTitle>
          <DialogDescription>
            {isResumeMode
              ? `Resume shift on terminal: ${terminalName}`
              : `Authenticate to access terminal: ${terminalName}`}
          </DialogDescription>
        </DialogHeader>

        {/* Error Alerts */}
        {cashiersError && !isResumeMode && (
          <Alert variant="destructive">
            <AlertDescription>
              Failed to load cashiers. Please try again.
            </AlertDescription>
          </Alert>
        )}

        {isLoadingActiveShift && (
          <Alert>
            <AlertDescription>Checking for active shift...</AlertDescription>
          </Alert>
        )}

        {activeShiftError && (
          <Alert variant="destructive">
            <AlertDescription>
              Failed to check for active shift. Please try again.
            </AlertDescription>
          </Alert>
        )}

        {startShiftMutation.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {startShiftMutation.error instanceof Error
                ? startShiftMutation.error.message
                : "Failed to start shift. Please try again."}
            </AlertDescription>
          </Alert>
        )}

        {authenticateMutation.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {authenticateMutation.error instanceof Error
                ? authenticateMutation.error.message === "Authentication failed"
                  ? "Invalid PIN. Please try again."
                  : authenticateMutation.error.message
                : "Authentication failed. Please check your credentials."}
            </AlertDescription>
          </Alert>
        )}

        {ownershipError && (
          <Alert variant="destructive" data-testid="ownership-error">
            <AlertDescription>{ownershipError}</AlertDescription>
          </Alert>
        )}

        {/* Single Form for both resume and new shift modes */}
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4"
          >
            {/* Resume Mode: Display cashier name (read-only) */}
            {isResumeMode && activeShift && (
              <div className="space-y-2">
                <Label>Cashier</Label>
                <div
                  className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2"
                  data-testid="shift-owner-display"
                >
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium" data-testid="shift-owner-name">
                    {activeShift.cashier_name}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  This terminal has an active shift. Enter your PIN to resume.
                </p>
              </div>
            )}

            {/* New Shift Mode: Cashier dropdown */}
            {!isResumeMode && (
              <FormField
                control={form.control}
                name="cashier_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cashier Name</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value || ""}
                      disabled={isSubmitting || isLoadingCashiers}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="cashier-name-select">
                          <SelectValue
                            placeholder={
                              isLoadingCashiers
                                ? "Loading cashiers..."
                                : "Select cashier name"
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {cashiers.map((cashier) => (
                          <SelectItem
                            key={cashier.cashier_id}
                            value={cashier.name}
                          >
                            {cashier.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage data-testid="cashier-name-error" />
                  </FormItem>
                )}
              />
            )}

            {/* Starting Cash field - only shown for new shifts */}
            {!isResumeMode && (
              <FormField
                control={form.control}
                name="starting_cash"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Starting Cash (Optional)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          className="pl-9"
                          disabled={isSubmitting}
                          data-testid="starting-cash-input"
                          value={field.value === undefined ? "" : field.value}
                          onChange={(e) => {
                            const value = e.target.value;
                            field.onChange(
                              value === "" ? undefined : parseFloat(value) || 0,
                            );
                          }}
                        />
                      </div>
                    </FormControl>
                    <FormMessage data-testid="starting-cash-error" />
                  </FormItem>
                )}
              />
            )}

            {/* PIN Number field - always shown */}
            <FormField
              control={form.control}
              name="pin_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>PIN Number</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={
                        isResumeMode ? "Enter your PIN" : "Enter PIN number"
                      }
                      autoComplete="off"
                      autoFocus={isResumeMode}
                      disabled={isSubmitting}
                      data-testid="pin-number-input"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage data-testid="pin-number-error" />
                </FormItem>
              )}
            />

            {form.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>
                  {form.formState.errors.root.message}
                </AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={isSubmitting}
                data-testid="terminal-auth-cancel-button"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || isLoadingActiveShift}
                data-testid="terminal-auth-submit-button"
              >
                {isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {isResumeMode ? "Resume Shift" : "Start Shift"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
