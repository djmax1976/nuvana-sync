
/**
 * Return Pack Dialog Component
 *
 * Story: Lottery Pack Return Feature
 *
 * Dialog for returning a lottery pack to supplier with sales tracking.
 * Captures return reason (enum), last sold serial, and optional notes.
 * Calculates tickets sold and sales amount from serial information.
 *
 * Business Rules:
 * - ACTIVATED and RECEIVED packs can be returned
 * - DEPLETED and already RETURNED packs cannot be returned
 * - Last sold serial is required for sales calculation
 * - Notes are required when return_reason is OTHER
 *
 * MCP Guidance Applied:
 * - FE-001: STATE_MANAGEMENT - Controlled form state with useState
 * - FE-002: FORM_VALIDATION - Client-side validation before API call
 * - SEC-004: XSS - React auto-escapes all text content
 * - SEC-014: INPUT_VALIDATION - Enum validation, serial format, length limits
 * - API-001: VALIDATION - Server validates all fields
 * - API-003: ERROR_HANDLING - Graceful error handling with user feedback
 */

import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertTriangle, Undo2, Calculator } from "lucide-react";
import { usePackDetails, useReturnPack } from "@/hooks/useLottery";
import type {
  LotteryPackResponse,
  ReturnPackInput,
} from "@/lib/api/lottery";

/**
 * Return reason type for lottery packs
 */
type LotteryPackReturnReason =
  | "SUPPLIER_RECALL"
  | "DAMAGED"
  | "DEFECTIVE"
  | "EXPIRED"
  | "INVENTORY_ADJUSTMENT"
  | "STORE_CLOSURE"
  | "OTHER";

// ============================================================================
// TYPE DEFINITIONS
// MCP: SEC-014 INPUT_VALIDATION - Strict type definitions
// ============================================================================

/**
 * Props interface for ReturnPackDialog component
 *
 * MCP Guidance Applied:
 * - FE-002: FORM_VALIDATION - Props interface for validated component input
 * - SEC-014: INPUT_VALIDATION - Strict type definitions
 */
interface ReturnPackDialogProps {
  /** Whether the dialog is open */
  readonly open: boolean;
  /** Callback when dialog open state changes */
  readonly onOpenChange: (open: boolean) => void;
  /** Pack ID to return (null if no pack selected) */
  readonly packId: string | null;
  /** Pack data passed from parent (optional, avoids extra API call) */
  readonly packData?: LotteryPackResponse | null;
  /** Callback on successful return */
  readonly onSuccess?: () => void;
}

// ============================================================================
// CONSTANTS
// MCP: SEC-014 INPUT_VALIDATION - Constrained lookup tables for safe display
// ============================================================================

/**
 * Return reason options for dropdown
 * MCP: SEC-014 INPUT_VALIDATION - Constrained enum values
 */
const RETURN_REASON_OPTIONS: ReadonlyArray<{
  value: LotteryPackReturnReason;
  label: string;
  description: string;
}> = [
  {
    value: "SUPPLIER_RECALL",
    label: "Supplier Recall",
    description: "Supplier has recalled this pack",
  },
  {
    value: "DAMAGED",
    label: "Damaged",
    description: "Pack is damaged and cannot be sold",
  },
  {
    value: "EXPIRED",
    label: "Expired",
    description: "Pack has expired before being sold",
  },
  {
    value: "INVENTORY_ADJUSTMENT",
    label: "Inventory Adjustment",
    description: "Inventory correction or reconciliation",
  },
  {
    value: "STORE_CLOSURE",
    label: "Store Closure",
    description: "Store is closing or relocating",
  },
  {
    value: "OTHER",
    label: "Other",
    description: "Other reason (notes required)",
  },
] as const;

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * ReturnPackDialog component
 * Dialog for returning a lottery pack to supplier with sales tracking
 *
 * @example
 * <ReturnPackDialog
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   packId={selectedPackId}
 *   packData={selectedPack}
 *   onSuccess={handleRefresh}
 * />
 */
export function ReturnPackDialog({
  open,
  onOpenChange,
  packId,
  packData: initialPackData,
  onSuccess,
}: ReturnPackDialogProps) {
  const { toast } = useToast();
  const returnPackMutation = useReturnPack();

  // ========================================================================
  // FORM STATE
  // MCP: FE-001 STATE_MANAGEMENT - Controlled form state
  // ========================================================================
  const [returnReason, setReturnReason] =
    useState<LotteryPackReturnReason | null>(null);
  const [lastSoldSerial, setLastSoldSerial] = useState("");
  const [returnNotes, setReturnNotes] = useState("");

  // Fetch pack details only if not provided by parent
  const {
    data: fetchedPackData,
    isLoading: isLoadingPack,
    isError: isPackError,
    error: packError,
  } = usePackDetails(packId, {
    enabled: open && !!packId && !initialPackData,
  });

  // Use provided data or fetched data
  const packData = initialPackData || fetchedPackData;

  // ========================================================================
  // COMPUTED VALUES
  // ========================================================================

  /**
   * Calculate tickets sold from serial numbers
   * Uses fencepost counting: last_sold - starting + 1
   * MCP: SEC-014 INPUT_VALIDATION - Safe numeric parsing with fallback
   */
  const salesCalculation = useMemo(() => {
    if (!packData || !lastSoldSerial || lastSoldSerial.length !== 3) {
      return null;
    }

    const lastSoldNum = parseInt(lastSoldSerial, 10);
    const serialStartNum = parseInt(packData.opening_serial || "000", 10);

    // Validate parsing succeeded
    if (Number.isNaN(lastSoldNum) || Number.isNaN(serialStartNum)) {
      return null;
    }

    // Validate serial is within valid range
    const serialEndNum = parseInt(packData.closing_serial || "299", 10);
    if (lastSoldNum < serialStartNum || lastSoldNum > serialEndNum) {
      return null;
    }

    // Calculate tickets sold (fencepost: last - start + 1)
    const ticketsSold = lastSoldNum - serialStartNum + 1;

    // Calculate sales amount
    const gamePrice = packData.game?.price ? Number(packData.game.price) : 0;
    const salesAmount = ticketsSold * gamePrice;

    return {
      ticketsSold,
      salesAmount,
      gamePrice,
    };
  }, [packData, lastSoldSerial]);

  // ========================================================================
  // VALIDATION
  // MCP: FE-002 FORM_VALIDATION - Client-side validation
  // ========================================================================

  const isReasonSelected = returnReason !== null;
  const isSerialValid = /^[0-9]{3}$/.test(lastSoldSerial);
  const isNotesValid =
    returnReason !== "OTHER" || returnNotes.trim().length >= 3;
  const isSerialInRange =
    salesCalculation !== null || lastSoldSerial.length !== 3;

  const canSubmit =
    isReasonSelected &&
    isSerialValid &&
    isNotesValid &&
    isSerialInRange &&
    !returnPackMutation.isPending &&
    packData !== null;

  // ========================================================================
  // EVENT HANDLERS
  // ========================================================================

  /**
   * Handle last sold serial input change
   * MCP: SEC-014 INPUT_VALIDATION - Only allow digits, max 3 chars
   */
  const handleSerialChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value.replace(/[^0-9]/g, "");
      if (value.length <= 3) {
        setLastSoldSerial(value);
      }
    },
    [],
  );

  /**
   * Handle return notes input change
   * MCP: SEC-014 INPUT_VALIDATION - Limit input length
   */
  const handleNotesChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      if (value.length <= 500) {
        setReturnNotes(value);
      }
    },
    [],
  );

  /**
   * Handle form submission
   * MCP: FE-002 FORM_VALIDATION - Validate before API call
   * MCP: API-001 VALIDATION - Server validates all fields
   */
  const handleReturn = async () => {
    if (!packId || !packData || !returnReason) {
      toast({
        title: "Error",
        description: "Pack information and return reason are required",
        variant: "destructive",
      });
      return;
    }

    // FE-002: FORM_VALIDATION - Validate serial format
    if (!isSerialValid) {
      toast({
        title: "Validation Error",
        description: "Last sold serial must be exactly 3 digits",
        variant: "destructive",
      });
      return;
    }

    // FE-002: FORM_VALIDATION - Validate notes for OTHER reason
    if (returnReason === "OTHER" && returnNotes.trim().length < 3) {
      toast({
        title: "Validation Error",
        description: "Notes are required when reason is 'Other'",
        variant: "destructive",
      });
      return;
    }

    try {
      const input: Omit<ReturnPackInput, 'pack_id'> = {
        return_reason: returnReason,
        ...(returnNotes.trim() && { notes: returnNotes.trim() }),
      };

      const response = await returnPackMutation.mutateAsync({
        packId,
        data: input,
      });

      if (response.success) {
        const salesText = salesCalculation?.salesAmount
          ? ` ($${salesCalculation.salesAmount.toFixed(2)} in sales calculated)`
          : "";

        toast({
          title: "Pack returned successfully",
          description: `Pack ${packData.pack_number} has been marked as returned.${salesText}`,
        });

        // Reset form state
        setReturnReason(null);
        setLastSoldSerial("");
        setReturnNotes("");

        onOpenChange(false);
        onSuccess?.();
      } else {
        throw new Error("Failed to return pack");
      }
    } catch (error) {
      // API-003: ERROR_HANDLING - Handle API errors gracefully
      const errorMessage =
        error instanceof Error ? error.message : "Failed to return pack";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  /**
   * Handle dialog close
   * Prevents closing while operation is in progress
   */
  const handleOpenChange = (newOpen: boolean) => {
    if (!returnPackMutation.isPending) {
      if (!newOpen) {
        // Reset form when closing
        setReturnReason(null);
        setLastSoldSerial("");
        setReturnNotes("");
      }
      onOpenChange(newOpen);
    }
  };

  // ========================================================================
  // LOADING STATE
  // ========================================================================

  if (isLoadingPack && open && packId && !initialPackData) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Return Lottery Pack</DialogTitle>
            <DialogDescription>Loading pack details...</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ========================================================================
  // ERROR STATE
  // ========================================================================

  if (isPackError && open && packId && !initialPackData) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Return Lottery Pack</DialogTitle>
            <DialogDescription>Failed to load pack details</DialogDescription>
          </DialogHeader>
          <div className="p-4 text-center">
            <p className="text-destructive">
              {packError?.message || "Unknown error"}
            </p>
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="mt-4"
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ========================================================================
  // RENDER
  // ========================================================================

  // SEC-004: XSS - React auto-escapes all text content
  const packNumber = packData?.pack_number || "Unknown";
  const gameName = packData?.game?.name || "Unknown";
  const gamePrice = packData?.game?.price
    ? `$${Number(packData.game.price).toFixed(2)}`
    : "N/A";
  const serialRange = packData
    ? `${packData.opening_serial || "000"} - ${packData.closing_serial || "299"}`
    : "N/A";
  const currentStatus = packData?.status || "Unknown";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto"
        aria-describedby="return-lottery-description"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-5 w-5" aria-hidden="true" />
            Return Lottery Pack
          </DialogTitle>
          <DialogDescription id="return-lottery-description">
            Mark this pack as returned to supplier. Enter the last sold ticket
            serial to calculate sales before return.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Warning for non-returnable packs (only ACTIVATED and RECEIVED can be returned) */}
          {packData &&
            packData.status !== "ACTIVATED" &&
            packData.status !== "RECEIVED" && (
              <div
                className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4"
                role="alert"
                aria-live="polite"
              >
                <AlertTriangle
                  className="h-5 w-5 text-destructive mt-0.5"
                  aria-hidden="true"
                />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium text-destructive">
                    Cannot Return Pack
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Only ACTIVATED or RECEIVED packs can be returned. This pack is
                    currently <strong>{currentStatus}</strong>.
                  </p>
                </div>
              </div>
            )}

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
                <span className="text-muted-foreground">Price per Ticket:</span>
                <span className="font-medium">{gamePrice}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Serial Range:</span>
                <span className="font-medium font-mono">{serialRange}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current Status:</span>
                <span className="font-medium">{currentStatus}</span>
              </div>
            </div>
          </div>

          {/* Return Reason Select */}
          <div className="space-y-2">
            <Label htmlFor="return-reason" className="text-sm font-medium">
              Return Reason <span className="text-destructive">*</span>
            </Label>
            <Select
              value={returnReason || ""}
              onValueChange={(value) =>
                setReturnReason(value as LotteryPackReturnReason)
              }
            >
              <SelectTrigger
                id="return-reason"
                data-testid="return-reason-select"
              >
                <SelectValue placeholder="Select a reason..." />
              </SelectTrigger>
              <SelectContent>
                {RETURN_REASON_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <div className="flex flex-col">
                      <span>{option.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Last Sold Serial Input */}
          <div className="space-y-2">
            <Label htmlFor="last-sold-serial" className="text-sm font-medium">
              Last Sold Serial <span className="text-destructive">*</span>
            </Label>
            <Input
              id="last-sold-serial"
              type="text"
              inputMode="numeric"
              placeholder="e.g., 025"
              value={lastSoldSerial}
              onChange={handleSerialChange}
              maxLength={3}
              className="font-mono"
              data-testid="last-sold-serial-input"
              aria-describedby="serial-help"
            />
            <p id="serial-help" className="text-xs text-muted-foreground">
              Enter the 3-digit serial number of the last ticket sold before
              returning this pack
            </p>
            {lastSoldSerial.length === 3 && !salesCalculation && (
              <p className="text-xs text-destructive">
                Serial must be within range {packData?.opening_serial || "000"} -{" "}
                {packData?.closing_serial || "299"}
              </p>
            )}
          </div>

          {/* Sales Calculation Preview */}
          {salesCalculation && (
            <div
              className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4"
              data-testid="sales-calculation-preview"
            >
              <Calculator
                className="h-5 w-5 text-primary mt-0.5"
                aria-hidden="true"
              />
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium text-primary">
                  Sales Calculation
                </p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Tickets Sold:</span>
                    <span className="ml-2 font-medium">
                      {salesCalculation.ticketsSold}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Sales Amount:</span>
                    <span className="ml-2 font-medium">
                      ${salesCalculation.salesAmount.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Return Notes Input */}
          <div className="space-y-2">
            <Label htmlFor="return-notes" className="text-sm font-medium">
              Notes{" "}
              {returnReason === "OTHER" && (
                <span className="text-destructive">*</span>
              )}
            </Label>
            <Textarea
              id="return-notes"
              placeholder={
                returnReason === "OTHER"
                  ? "Enter reason details (required for 'Other')..."
                  : "Optional: Enter additional notes..."
              }
              value={returnNotes}
              onChange={handleNotesChange}
              className="min-h-[80px]"
              maxLength={500}
              data-testid="return-notes-input"
              aria-describedby="notes-help"
            />
            <div
              id="notes-help"
              className="flex justify-between text-xs text-muted-foreground"
            >
              <span>
                {returnReason === "OTHER" && returnNotes.trim().length < 3
                  ? "Notes are required when reason is 'Other'"
                  : "Notes will be recorded in audit log"}
              </span>
              <span>{returnNotes.length}/500</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={returnPackMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={handleReturn}
            disabled={
              !canSubmit ||
              (packData?.status !== "ACTIVATED" && packData?.status !== "RECEIVED")
            }
            data-testid="confirm-return-button"
            aria-label={
              returnPackMutation.isPending
                ? "Returning pack..."
                : `Return pack ${packNumber}`
            }
          >
            {returnPackMutation.isPending && (
              <Loader2
                className="mr-2 h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            )}
            Return Pack
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
