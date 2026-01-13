
/**
 * Unscanned Bin Warning Modal Component
 *
 * Compact dialog for handling bins that have not been scanned during day close.
 * Displays a simple table with checkbox to mark packs as sold out.
 *
 * Story: Lottery Day Close - Edge Case Handling
 *
 * @requirements
 * - Display warning when bins have no ending serial at day close
 * - Compact table layout: Bin #, Game, Price, Pack, Sold Out checkbox
 * - User marks sold out packs or returns to scan remaining tickets
 * - Maintain audit trail of user decisions
 *
 * MCP Guidance Applied:
 * - FE-002: FORM_VALIDATION - Track selections before proceeding
 * - SEC-014: INPUT_VALIDATION - Strict validation of user choices
 * - SEC-004: XSS - React auto-escapes all output
 * - FE-005: UI_SECURITY - No sensitive data exposed in DOM
 * - FE-001: STATE_MANAGEMENT - Secure state management with explicit types
 */

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Action types for unscanned bins
 * Each action has clear business meaning and audit implications
 */
export type UnscannedBinAction =
  | "SOLD_OUT" // Pack fully sold - ending = serial_end, mark DEPLETED
  | "RETURN_TO_SCAN"; // User wants to go back and scan/enter

/**
 * Decision record for a single bin
 * Used for audit trail and processing
 */
export interface BinDecision {
  bin_id: string;
  bin_number: number;
  pack_id: string;
  pack_number: string;
  game_name: string;
  game_price: number;
  starting_serial: string;
  serial_end: string;
  action: UnscannedBinAction;
  /** Computed ending serial based on action */
  ending_serial: string;
  /** Number of tickets sold (ending - starting) */
  tickets_sold: number;
  /** Total sales amount (tickets_sold × game_price) */
  sales_amount: number;
}

/**
 * Unscanned bin data passed to the modal
 *
 * SEC-014: INPUT_VALIDATION - All serial values are validated before use
 */
export interface UnscannedBinInfo {
  bin_id: string;
  bin_number: number;
  pack_id: string;
  pack_number: string;
  game_name: string;
  game_price: number;
  /** Starting serial position (3 digits, e.g., "000" or "045") */
  starting_serial: string;
  /** Pack's last serial number (e.g., "299") */
  serial_end: string;
}

/**
 * Modal result returned to parent component
 */
export interface UnscannedBinModalResult {
  /** User chose to return to scanning */
  returnToScan: boolean;
  /** Decisions for bins (only present if not returning to scan) */
  decisions?: BinDecision[];
}

interface UnscannedBinWarningModalProps {
  /** Modal open state */
  open: boolean;
  /** Callback to change modal open state */
  onOpenChange: (open: boolean) => void;
  /** List of bins without ending serials */
  unscannedBins: UnscannedBinInfo[];
  /** Callback when user confirms decisions */
  onConfirm: (result: UnscannedBinModalResult) => void;
  /** Callback when user cancels (closes modal without action) */
  onCancel: () => void;
}

/**
 * Truncate game name if too long
 */
function truncateGameName(name: string, maxLength: number = 18): string {
  if (name.length <= maxLength) return name;
  return name.substring(0, maxLength - 3) + "...";
}

/**
 * UnscannedBinWarningModal Component
 *
 * Displays a compact warning modal when attempting to close lottery day with bins
 * that have no ending serial. Simple table with sold out checkboxes.
 *
 * @example
 * <UnscannedBinWarningModal
 *   open={showWarningModal}
 *   onOpenChange={setShowWarningModal}
 *   unscannedBins={binsWithoutEnding}
 *   onConfirm={handleConfirm}
 *   onCancel={handleCancel}
 * />
 */
export function UnscannedBinWarningModal({
  open,
  onOpenChange,
  unscannedBins,
  onConfirm,
  onCancel,
}: UnscannedBinWarningModalProps) {
  // Track which bins are marked as sold out
  // Key: bin_id, Value: true if marked sold out
  const [soldOutBins, setSoldOutBins] = useState<Record<string, boolean>>({});

  /**
   * Compute select all state for header checkbox
   * MCP: FE-001 STATE_MANAGEMENT - Derive state from source of truth
   * Returns: true (all selected), false (none selected), "indeterminate" (partial)
   */
  const selectAllState = (() => {
    if (unscannedBins.length === 0) return false;
    const checkedCount = unscannedBins.filter(
      (bin) => soldOutBins[bin.bin_id],
    ).length;
    if (checkedCount === 0) return false;
    if (checkedCount === unscannedBins.length) return true;
    return "indeterminate" as const;
  })();

  /**
   * Handle Select All checkbox toggle
   * MCP: SEC-014 INPUT_VALIDATION - Only accept boolean values
   * When checked: mark all bins as sold out
   * When unchecked: clear all selections
   */
  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        // Select all bins
        const allSelected: Record<string, boolean> = {};
        unscannedBins.forEach((bin) => {
          allSelected[bin.bin_id] = true;
        });
        setSoldOutBins(allSelected);
      } else {
        // Deselect all bins
        setSoldOutBins({});
      }
    },
    [unscannedBins],
  );

  /**
   * Handle checkbox toggle for a bin
   * MCP: SEC-014 INPUT_VALIDATION - Only accept boolean values
   */
  const handleSoldOutToggle = useCallback((binId: string, checked: boolean) => {
    setSoldOutBins((prev) => ({
      ...prev,
      [binId]: checked,
    }));
  }, []);

  /**
   * Calculate tickets sold for DEPLETED packs (manual or auto sold-out)
   *
   * Formula: tickets_sold = (serial_end + 1) - starting_serial
   *
   * IMPORTANT: This function is specifically for DEPLETION scenarios where:
   * 1. Manual depletion - user marks pack as "sold out"
   * 2. Auto depletion - new pack activated in same bin, old pack auto-closes
   *
   * In depletion cases, serial_end represents the LAST ticket INDEX (e.g., 014 for
   * a 15-ticket pack), NOT the next position. Therefore we add 1 to convert from
   * last-index to count.
   *
   * This differs from normal scanning where the closing serial IS the next position.
   *
   * Serial Position Semantics for Depletion:
   * - Starting serial: Position of the first ticket available for sale today
   * - Serial end: LAST ticket index in the pack (needs +1 for count)
   *
   * Examples (15-ticket pack with serial_end=014):
   * - Starting: 0, serial_end: 14 → (14 + 1) - 0 = 15 tickets sold (full pack)
   * - Starting: 5, serial_end: 14 → (14 + 1) - 5 = 10 tickets sold (partial)
   * - Starting: 10, serial_end: 14 → (14 + 1) - 10 = 5 tickets sold (end of pack)
   *
   * @param serialEnd - The pack's last ticket INDEX (3 digits, e.g., "014" for 15-ticket pack)
   * @param startingSerial - The starting serial position for today (3 digits, e.g., "000")
   * @returns Number of tickets sold (never negative, 0 for invalid input)
   *
   * MCP Guidance Applied:
   * - SEC-014: INPUT_VALIDATION - Strict numeric validation with NaN guard and bounds check
   * - FE-001: STATE_MANAGEMENT - Pure function with no side effects, memoized with useCallback
   * - API-003: ERROR_HANDLING - Returns 0 for invalid input (fail-safe for UI calculations)
   * - FE-020: REACT_OPTIMIZATION - useCallback prevents unnecessary re-renders
   */
  const calculateTicketsSoldForDepletion = useCallback(
    (serialEnd: string, startingSerial: string): number => {
      // SEC-014: Validate input types before processing
      if (typeof serialEnd !== "string" || typeof startingSerial !== "string") {
        return 0;
      }

      // SEC-014: Parse with explicit radix to prevent octal interpretation
      const serialEndNum = parseInt(serialEnd, 10);
      const startingNum = parseInt(startingSerial, 10);

      // SEC-014: Strict NaN validation using Number.isNaN (not global isNaN)
      // This handles empty strings, non-numeric input, null coercion, etc.
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
      // Example: serial_end=14, starting=0 → (14+1)-0 = 15 tickets (full 15-ticket pack)
      const ticketsSold = serialEndNum + 1 - startingNum;

      // Ensure non-negative result (serial_end+1 should never be less than starting)
      // Math.max provides defense-in-depth against data integrity issues
      return Math.max(0, ticketsSold);
    },
    [],
  );

  /**
   * Handle Return to Scan button click
   * Returns user to scanning screen to scan remaining tickets
   * Calculates tickets sold and sales amount for sold out bins
   *
   * MCP Guidance Applied:
   * - FE-002: FORM_VALIDATION - Validate selections before processing
   * - SEC-014: INPUT_VALIDATION - All numeric inputs validated before calculation
   * - FE-001: STATE_MANAGEMENT - Clean state transitions with useCallback
   */
  const handleReturnToScan = useCallback(() => {
    // Build decisions for bins marked as sold out
    const decisions: BinDecision[] = unscannedBins
      .filter((bin) => soldOutBins[bin.bin_id])
      .map((bin) => {
        // For sold out pack, use depletion formula: (serial_end + 1) - starting
        // serial_end is the LAST ticket index, so +1 converts to count
        // SEC-014: INPUT_VALIDATION - Calculation uses validated helper function
        const ticketsSold = calculateTicketsSoldForDepletion(
          bin.serial_end,
          bin.starting_serial,
        );

        // FE-005: UI_SECURITY - Ensure price is valid before multiplication
        const validPrice =
          typeof bin.game_price === "number" && !Number.isNaN(bin.game_price)
            ? bin.game_price
            : 0;
        const salesAmount = ticketsSold * validPrice;

        return {
          bin_id: bin.bin_id,
          bin_number: bin.bin_number,
          pack_id: bin.pack_id,
          pack_number: bin.pack_number,
          game_name: bin.game_name,
          game_price: bin.game_price,
          starting_serial: bin.starting_serial,
          serial_end: bin.serial_end,
          action: "SOLD_OUT" as const,
          ending_serial: bin.serial_end,
          tickets_sold: ticketsSold,
          sales_amount: salesAmount,
        };
      });

    onConfirm({
      returnToScan: true,
      decisions: decisions.length > 0 ? decisions : undefined,
    });
    onOpenChange(false);
  }, [
    unscannedBins,
    soldOutBins,
    onConfirm,
    onOpenChange,
    calculateTicketsSoldForDepletion,
  ]);

  /**
   * Handle cancel - reset state and close
   */
  const handleCancel = useCallback(() => {
    setSoldOutBins({});
    onCancel();
    onOpenChange(false);
  }, [onCancel, onOpenChange]);

  /**
   * Reset state when modal opens (controlled prop change)
   * MCP: FE-001 STATE_MANAGEMENT - Reset internal state when controlled open prop changes
   */
  useEffect(() => {
    if (open) {
      // Reset selections when modal opens to ensure clean state
      setSoldOutBins({});
    }
  }, [open]);

  /**
   * Handle internal open state changes from Dialog
   */
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      // Note: State reset is handled by useEffect on `open` prop
      onOpenChange(newOpen);
    },
    [onOpenChange],
  );

  // Don't render if no unscanned bins
  if (unscannedBins.length === 0) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-xl"
        data-testid="unscanned-bin-warning-modal"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
            <AlertTriangle className="h-5 w-5" />
            Bins Without Ending Serials
          </DialogTitle>
          <DialogDescription>
            If the pack is sold please mark it sold
          </DialogDescription>
        </DialogHeader>

        {/* Compact Table */}
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="border-b">
                <th className="text-left py-2 px-3 font-medium">#</th>
                <th className="text-left py-2 px-3 font-medium">Game</th>
                <th className="text-left py-2 px-3 font-medium">$</th>
                <th className="text-left py-2 px-3 font-medium">Pack</th>
                <th className="text-center py-2 px-3 font-medium">
                  <div className="flex items-center justify-center gap-2">
                    <span>Sold Out</span>
                    <Checkbox
                      checked={
                        selectAllState === "indeterminate"
                          ? "indeterminate"
                          : selectAllState
                      }
                      onCheckedChange={(checked) =>
                        handleSelectAll(checked === true)
                      }
                      data-testid="select-all-sold-out"
                      aria-label="Select all bins as sold out"
                    />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {unscannedBins.map((bin, index) => {
                const isChecked = soldOutBins[bin.bin_id] || false;

                return (
                  <tr
                    key={bin.bin_id}
                    className={cn(
                      "border-b last:border-b-0 h-10",
                      isChecked && "bg-green-50 dark:bg-green-950/20",
                      index % 2 === 0 && !isChecked && "bg-muted/20",
                    )}
                    data-testid={`unscanned-bin-row-${bin.bin_id}`}
                  >
                    <td className="py-2 px-3 font-medium">{bin.bin_number}</td>
                    <td className="py-2 px-3" title={bin.game_name}>
                      {truncateGameName(bin.game_name)}
                    </td>
                    <td className="py-2 px-3">${bin.game_price}</td>
                    <td className="py-2 px-3 font-mono text-xs">
                      {bin.pack_number}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(checked) =>
                          handleSoldOutToggle(bin.bin_id, checked === true)
                        }
                        data-testid={`bin-sold-out-${bin.bin_id}`}
                        aria-label={`Mark bin ${bin.bin_number} as sold out`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleCancel}
            data-testid="unscanned-bin-modal-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleReturnToScan}
            data-testid="unscanned-bin-modal-return"
          >
            Return to Scan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
