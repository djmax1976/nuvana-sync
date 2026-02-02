/**
 * Mark Sold Out Dialog Component
 *
 * Story: Lottery Pack Auto-Depletion Feature
 *
 * Confirmation dialog for manually marking a lottery pack as sold out (depleted).
 * This is used when the last ticket has been sold but not yet recorded.
 *
 * @requirements
 * - Display pack details for confirmation
 * - Calculate and display tickets sold and sales amount BEFORE confirmation
 * - Show warning that action cannot be undone
 * - Require explicit confirmation before marking as sold
 * - Show loading state during API call
 * - Show toast on success/failure
 *
 * MCP Guidance Applied:
 * - SEC-004: XSS - React auto-escapes output
 * - SEC-014: INPUT_VALIDATION - Validates closing_serial before submission
 * - FE-001: STATE_MANAGEMENT - Proper loading/error states with calculation preview
 * - FE-020: REACT_OPTIMIZATION - useMemo for expensive calculations
 * - SEC-009: TRANSACTION - Backend handles atomic updates
 * - SEC-017: AUDIT_TRAILS - Displays calculated values for user verification
 */

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, AlertTriangle, CheckCircle, DollarSign, Ticket } from 'lucide-react';
import { usePackDetails, useMarkPackAsSoldOut } from '@/hooks/useLottery';

interface MarkSoldOutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packId: string | null;
  onSuccess?: () => void;
}

/**
 * Calculate tickets sold for DEPLETED packs (sold out)
 *
 * Formula: tickets_sold = (serial_end + 1) - starting_serial
 *
 * This is the DEPLETION formula where:
 * - serial_end is the LAST ticket INDEX (e.g., "029" for a 30-ticket pack)
 * - We add 1 to convert from last-index to count
 * - This matches the day close wizard calculation in DayCloseModeScanner.tsx
 *
 * @param serialEnd - The pack's last ticket INDEX (3 digits, e.g., "029")
 * @param startingSerial - The starting serial position (3 digits, e.g., "000")
 * @returns Number of tickets sold (never negative, 0 for invalid input)
 *
 * MCP Guidance Applied:
 * - SEC-014: INPUT_VALIDATION - Strict numeric validation with NaN guard
 * - FE-020: REACT_OPTIMIZATION - Pure function for memoization
 */
function calculateTicketsSoldForDepletion(
  serialEnd: string | null | undefined,
  startingSerial: string | null | undefined
): number {
  // SEC-014: Validate input types before processing
  if (
    typeof serialEnd !== 'string' ||
    typeof startingSerial !== 'string' ||
    !serialEnd ||
    !startingSerial
  ) {
    return 0;
  }

  // SEC-014: Parse with explicit radix to prevent octal interpretation
  const serialEndNum = parseInt(serialEnd, 10);
  const startingNum = parseInt(startingSerial, 10);

  // SEC-014: Strict NaN validation using Number.isNaN (not global isNaN)
  if (Number.isNaN(serialEndNum) || Number.isNaN(startingNum)) {
    return 0;
  }

  // SEC-014: Validate serial range (reasonable bounds check)
  const MAX_SERIAL = 999;
  if (
    serialEndNum < 0 ||
    serialEndNum > MAX_SERIAL ||
    startingNum < 0 ||
    startingNum > MAX_SERIAL
  ) {
    return 0;
  }

  // Depletion formula: (serial_end + 1) - starting = tickets sold
  // serial_end is the LAST ticket index, so +1 converts to count
  // Example: serial_end=29, starting=0 → (29+1)-0 = 30 tickets (full 30-ticket pack)
  const ticketsSold = serialEndNum + 1 - startingNum;

  // Ensure non-negative result
  return Math.max(0, ticketsSold);
}

/**
 * MarkSoldOutDialog component
 *
 * Confirmation dialog for marking a lottery pack as sold out.
 * Displays pack details, calculated tickets sold, and sales amount
 * for user verification before confirming the action.
 *
 * MCP Guidance Applied:
 * - SEC-017: AUDIT_TRAILS - Shows calculation preview for user verification
 * - FE-001: STATE_MANAGEMENT - Proper loading/error/calculation states
 */
export function MarkSoldOutDialog({
  open,
  onOpenChange,
  packId,
  onSuccess,
}: MarkSoldOutDialogProps) {
  const { toast } = useToast();
  const markSoldOutMutation = useMarkPackAsSoldOut();

  // Fetch pack details when dialog opens and packId is provided
  const {
    data: packData,
    isLoading: isLoadingPack,
    isError: isPackError,
    error: packError,
  } = usePackDetails(packId, { enabled: open && !!packId });

  /**
   * Calculate tickets sold and sales amount for preview
   * Uses the same depletion formula as the day close wizard
   *
   * FE-020: REACT_OPTIMIZATION - useMemo prevents recalculation on every render
   */
  const calculatedValues = useMemo(() => {
    if (!packData) {
      return { ticketsSold: 0, salesAmount: 0, isValid: false };
    }

    const serialEnd = packData.serial_end;
    const startingSerial = packData.opening_serial;
    const gamePrice = packData.game?.price ?? 0;

    // SEC-014: Validate required fields for calculation
    if (!serialEnd || !startingSerial) {
      return { ticketsSold: 0, salesAmount: 0, isValid: false };
    }

    const ticketsSold = calculateTicketsSoldForDepletion(serialEnd, startingSerial);
    const salesAmount = ticketsSold * gamePrice;

    return {
      ticketsSold,
      salesAmount,
      isValid: ticketsSold > 0 && gamePrice > 0,
    };
  }, [packData]);

  /**
   * Handle mark sold out action
   *
   * SEC-014: INPUT_VALIDATION - Validates closing_serial before submission
   * API-001: VALIDATION - Sends required closing_serial field
   */
  const handleMarkSoldOut = async () => {
    if (!packId) {
      toast({
        title: 'Error',
        description: 'Pack ID is required',
        variant: 'destructive',
      });
      return;
    }

    // SEC-014: Validate serial_end exists before submission
    const closingSerial = packData?.serial_end;
    if (!closingSerial) {
      toast({
        title: 'Error',
        description: 'Cannot determine closing serial. Pack data is incomplete.',
        variant: 'destructive',
      });
      return;
    }

    // SEC-014: Validate closing_serial format (3-digit numeric string)
    if (!/^\d{3}$/.test(closingSerial)) {
      toast({
        title: 'Error',
        description: 'Invalid closing serial format. Expected 3-digit number.',
        variant: 'destructive',
      });
      return;
    }

    try {
      // API-001: Send required closing_serial - no hardcoded defaults
      const response = await markSoldOutMutation.mutateAsync({
        packId,
        data: {
          closing_serial: closingSerial,
        },
      });

      if (response.success) {
        toast({
          title: 'Pack marked as sold out',
          description: `Pack ${packData?.pack_number || packId} has been marked as sold out. ${calculatedValues.ticketsSold} tickets, $${calculatedValues.salesAmount.toFixed(2)} total.`,
        });

        onOpenChange(false);
        onSuccess?.();
      } else {
        throw new Error(response.message || 'Failed to mark pack as sold out');
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to mark pack as sold out';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!markSoldOutMutation.isPending) {
      onOpenChange(newOpen);
    }
  };

  const isProcessing = markSoldOutMutation.isPending;

  // Loading state while fetching pack details
  if (isLoadingPack && open && packId) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Mark Pack as Sold Out</DialogTitle>
            <DialogDescription>Loading pack details...</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Error state if pack details fail to load
  if (isPackError && open && packId) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Mark Pack as Sold Out</DialogTitle>
            <DialogDescription>Failed to load pack details</DialogDescription>
          </DialogHeader>
          <div className="p-4 text-center">
            <p className="text-destructive">{packError?.message || 'Unknown error'}</p>
            <Button variant="outline" onClick={() => handleOpenChange(false)} className="mt-4">
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Pack details for display (sanitized via React's automatic escaping)
  const packNumber = packData?.pack_number || 'Unknown';
  const gameName = packData?.game?.name || 'Unknown';
  const binName = packData?.bin?.name || 'N/A';
  const gamePrice = packData?.game?.price ?? 0;
  // serial_end is the calculated last ticket number (opening_serial + tickets_per_pack - 1)
  const serialEnd = packData?.serial_end || 'N/A';
  const startingSerial = packData?.opening_serial || 'N/A';

  // SEC-014: Determine if we can proceed (have valid serial data)
  const canProceed = packData?.serial_end && /^\d{3}$/.test(packData.serial_end);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto"
        aria-describedby="mark-sold-out-description"
      >
        <DialogHeader>
          <DialogTitle>Mark Pack as Sold Out</DialogTitle>
          <DialogDescription id="mark-sold-out-description">
            Mark this pack as sold out when all tickets have been sold.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {/* Warning Banner */}
          <div
            className="flex items-start gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4"
            role="alert"
            aria-live="polite"
          >
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" aria-hidden="true" />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-500">
                This action cannot be undone
              </p>
              <p className="text-sm text-muted-foreground">
                The pack will be marked as depleted and removed from the active bin.
              </p>
            </div>
          </div>

          {/* Pack Details */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Pack Details:</p>
            <div className="rounded-md bg-muted p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pack Number:</span>
                <span className="font-medium font-mono">{packNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Game:</span>
                <span className="font-medium">{gameName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bin:</span>
                <span className="font-medium">{binName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ticket Price:</span>
                <span className="font-medium">${gamePrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Starting Serial:</span>
                <span className="font-medium font-mono">{startingSerial}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ending Serial:</span>
                <span className="font-medium font-mono">{serialEnd}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span>
                <span className="font-medium text-green-600">{packData?.status || 'ACTIVE'}</span>
              </div>
            </div>
          </div>

          {/* Calculated Sales Summary - SEC-017: AUDIT_TRAILS preview */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Calculated Sales:</p>
            <div className="rounded-md bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Ticket className="h-4 w-4 text-green-600" aria-hidden="true" />
                  <span className="text-sm text-muted-foreground">Tickets Sold:</span>
                </div>
                <span className="font-semibold text-lg">{calculatedValues.ticketsSold}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-green-600" aria-hidden="true" />
                  <span className="text-sm text-muted-foreground">Total Sales:</span>
                </div>
                <span className="font-semibold text-lg text-green-600 dark:text-green-400">
                  ${calculatedValues.salesAmount.toFixed(2)}
                </span>
              </div>
              {!calculatedValues.isValid && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Unable to calculate sales - pack data may be incomplete
                </p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isProcessing}
            className="focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleMarkSoldOut}
            disabled={isProcessing || !canProceed}
            data-testid="confirm-mark-sold-button"
            className="bg-amber-600 hover:bg-amber-700 text-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
            aria-label={
              isProcessing ? 'Marking pack as sold out...' : `Mark pack ${packNumber} as sold out`
            }
          >
            {isProcessing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            Mark as Sold Out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
