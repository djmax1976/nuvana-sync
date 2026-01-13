
/**
 * Close Day Modal Component
 * Modal for scanning/entering ending serial numbers for all active lottery packs at end of day
 *
 * Story: Lottery Day Closing Feature
 *
 * @requirements
 * - Single auto-focused input field for 24-digit serial number scanning
 * - Parse serial using parseSerializedNumber and match to active pack/bin
 * - Show list of scanned bins with remove functionality
 * - Show pending bins that still need scanning
 * - Save button disabled until ALL active bins are scanned
 * - Validate ending_serial >= starting_serial and <= serial_end
 */

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type ChangeEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useNotificationSound } from "@/hooks/use-notification-sound";
import { Loader2, Volume2, VolumeX } from "lucide-react";
import {
  closeLotteryDay,
  type DayBin,
  type CloseLotteryDayResponse,
} from "@/lib/api/lottery";
import { parseSerializedNumber } from "@/lib/utils/lottery-serial-parser";

/**
 * Lottery close result data passed to parent on success
 */
export interface LotteryCloseResult {
  closings_created: number;
  business_day: string;
  lottery_total: number;
  bins_closed: CloseLotteryDayResponse["bins_closed"];
}

/**
 * Props interface
 */
interface CloseDayModalProps {
  storeId: string;
  bins: DayBin[]; // From useLotteryDayBins hook
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Simple success callback (legacy) */
  onSuccess?: () => void;
  /** Enhanced success callback with lottery data for Day Close page integration */
  onSuccessWithData?: (data: LotteryCloseResult) => void;
  /**
   * External scanned bins state (controlled component pattern)
   * When provided, scanned bins persist when modal is closed and reopened
   * This allows users to continue scanning after closing the modal
   */
  scannedBins?: ScannedBin[];
  /** Callback to update external scanned bins state */
  onScannedBinsChange?: (bins: ScannedBin[]) => void;
  /** Current shift ID - excluded from open shifts check when closing lottery */
  currentShiftId?: string;
}

/**
 * Scanned bin state - exported for use by parent components
 * that manage scanned bins state externally
 */
export interface ScannedBin {
  bin_id: string;
  bin_number: number;
  pack_id: string;
  pack_number: string;
  game_name: string;
  closing_serial: string; // 3-digit ending number
}

/**
 * CloseDayModal component
 * Dialog modal for closing lottery day with serial number scanning
 */
export function CloseDayModal({
  storeId,
  bins,
  open,
  onOpenChange,
  onSuccess,
  onSuccessWithData,
  scannedBins: externalScannedBins,
  onScannedBinsChange,
  currentShiftId,
}: CloseDayModalProps) {
  const { toast } = useToast();
  const { playSuccess, playError, isMuted, toggleMute } =
    useNotificationSound();
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Use external state if provided (controlled), otherwise use internal state (uncontrolled)
  const [internalScannedBins, setInternalScannedBins] = useState<ScannedBin[]>(
    [],
  );
  const isControlled = externalScannedBins !== undefined;
  const scannedBins = isControlled ? externalScannedBins : internalScannedBins;

  // Keep refs to avoid stale closures in callbacks
  const externalScannedBinsRef = useRef(externalScannedBins);
  const onScannedBinsChangeRef = useRef(onScannedBinsChange);
  useEffect(() => {
    externalScannedBinsRef.current = externalScannedBins;
    onScannedBinsChangeRef.current = onScannedBinsChange;
  }, [externalScannedBins, onScannedBinsChange]);

  // Wrapper for setting scanned bins - handles both controlled and uncontrolled modes
  const setScannedBins = useCallback(
    (updater: ScannedBin[] | ((prev: ScannedBin[]) => ScannedBin[])) => {
      if (isControlled) {
        // For controlled mode, compute the new value and call the parent's callback
        const currentBins = externalScannedBinsRef.current ?? [];
        const newValue =
          typeof updater === "function" ? updater(currentBins) : updater;
        onScannedBinsChangeRef.current?.(newValue);
      } else {
        // For uncontrolled mode, use internal state
        setInternalScannedBins(updater);
      }
    },
    [isControlled],
  );
  const [inputValue, setInputValue] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  // Get bins with active packs (bins that need to be scanned)
  const activeBins = bins.filter((bin) => bin.is_active && bin.pack);

  // Get pending bins (active bins that haven't been scanned yet)
  const pendingBins = activeBins.filter(
    (bin) => !scannedBins.find((scanned) => scanned.bin_id === bin.bin_id),
  );

  // Check if all active bins have been scanned
  const allBinsScanned = activeBins.length > 0 && pendingBins.length === 0;

  // Clear debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  // Reset form when dialog closes - only reset internal state if uncontrolled
  // When controlled (external state), parent manages persistence
  useEffect(() => {
    if (!open) {
      // Only reset scanned bins for uncontrolled mode
      // In controlled mode, parent decides when to reset (e.g., after day close)
      if (!isControlled) {
        setInternalScannedBins([]);
      }
      setInputValue("");
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    }
  }, [open, isControlled]);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      const timeoutId = setTimeout(() => {
        inputRef.current?.focus();
      }, 150);
      return () => clearTimeout(timeoutId);
    }
  }, [open]);

  /**
   * Clear input and refocus for next entry
   */
  const clearInputAndFocus = useCallback(() => {
    setInputValue("");
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  }, []);

  /**
   * Parse and validate serialized number, then add to scanned list
   */
  const handleSerialComplete = useCallback(
    async (serial: string): Promise<void> => {
      // Validate format first (client-side)
      if (!/^\d{24}$/.test(serial)) {
        // Not yet 24 digits - wait for more input
        return;
      }

      try {
        // Parse serial client-side
        const parsed = parseSerializedNumber(serial);

        // Extract components
        const gameCode = parsed.game_code;
        const packNumber = parsed.pack_number;
        const closingSerial = parsed.serial_start; // Positions 12-14 contain the ending serial

        // Find matching bin with active pack
        const matchingBin = activeBins.find(
          (bin) =>
            bin.pack &&
            bin.pack.pack_number === packNumber &&
            // Compare game codes - we need to get game_code from the pack
            // Note: DayBinPack doesn't expose game_code, so we match by pack_number only
            // The backend will validate the full serial number
            true,
        );

        if (!matchingBin || !matchingBin.pack) {
          playError();
          toast({
            title: "Pack not found",
            description: `No active pack found matching serial ${serial}. Pack: ${packNumber}`,
            variant: "destructive",
          });
          clearInputAndFocus();
          return;
        }

        // Check if this bin was already scanned
        const alreadyScanned = scannedBins.find(
          (scanned) => scanned.bin_id === matchingBin.bin_id,
        );
        if (alreadyScanned) {
          playError();
          toast({
            title: "Duplicate scan",
            description: `Bin ${matchingBin.bin_number} has already been scanned`,
            variant: "destructive",
          });
          clearInputAndFocus();
          return;
        }

        // Validate closing serial is within range
        const closingSerialNum = parseInt(closingSerial, 10);
        const startingSerialNum = parseInt(
          matchingBin.pack.starting_serial,
          10,
        );
        const serialEndNum = parseInt(matchingBin.pack.serial_end, 10);

        if (closingSerialNum < startingSerialNum) {
          playError();
          toast({
            title: "Invalid ending serial",
            description: `Ending serial ${closingSerial} is less than starting serial ${matchingBin.pack.starting_serial}`,
            variant: "destructive",
          });
          clearInputAndFocus();
          return;
        }

        if (closingSerialNum > serialEndNum) {
          playError();
          toast({
            title: "Invalid ending serial",
            description: `Ending serial ${closingSerial} exceeds pack's maximum serial ${matchingBin.pack.serial_end}`,
            variant: "destructive",
          });
          clearInputAndFocus();
          return;
        }

        // Add to scanned list
        const newScannedBin: ScannedBin = {
          bin_id: matchingBin.bin_id,
          bin_number: matchingBin.bin_number,
          pack_id: matchingBin.pack.pack_id,
          pack_number: matchingBin.pack.pack_number,
          game_name: matchingBin.pack.game_name,
          closing_serial: closingSerial,
        };

        setScannedBins((prev) =>
          [...prev, newScannedBin].sort((a, b) => a.bin_number - b.bin_number),
        );
        clearInputAndFocus();

        // Success feedback
        playSuccess();
        toast({
          title: "Bin scanned",
          description: `Bin ${matchingBin.bin_number} - ${matchingBin.pack.game_name} (${closingSerial})`,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Invalid serial format";
        playError();
        toast({
          title: "Invalid serial",
          description: errorMessage,
          variant: "destructive",
        });
        clearInputAndFocus();
      }
    },
    [
      activeBins,
      scannedBins,
      setScannedBins,
      toast,
      clearInputAndFocus,
      playSuccess,
      playError,
    ],
  );

  /**
   * Handle input change with debouncing
   */
  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const cleanedValue = e.target.value.replace(/\D/g, ""); // Only allow digits
      setInputValue(cleanedValue);

      // Clear existing debounce timer
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      // Set new debounce timer (400ms delay)
      debounceTimer.current = setTimeout(() => {
        if (cleanedValue.length === 24) {
          handleSerialComplete(cleanedValue);
        }
      }, 400);
    },
    [handleSerialComplete],
  );

  /**
   * Remove scanned bin from list
   */
  const handleRemoveBin = useCallback(
    (binId: string) => {
      setScannedBins((prev) => prev.filter((bin) => bin.bin_id !== binId));
    },
    [setScannedBins],
  );

  /**
   * Submit closing data
   */
  const handleSubmit = useCallback(async () => {
    if (!allBinsScanned) {
      toast({
        title: "Incomplete scan",
        description: "Please scan all active bins before closing lottery",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // Build closings array for API
      const closings = scannedBins.map((bin) => ({
        pack_id: bin.pack_id,
        closing_serial: bin.closing_serial,
      }));

      // Submit to API
      // Pass current_shift_id so backend excludes it from open shifts check
      const response = await closeLotteryDay(storeId, {
        closings,
        entry_method: "SCAN", // Default to SCAN for now
        current_shift_id: currentShiftId,
      });

      if (response.success && response.data) {
        playSuccess();
        toast({
          title: "Lottery closed successfully",
          description: `Closed ${response.data.closings_created} pack(s) for business day ${response.data.business_day}`,
        });

        // Reset form
        setScannedBins([]);
        setInputValue("");
        onOpenChange(false);

        // Call legacy callback
        onSuccess?.();

        // Call enhanced callback with lottery data
        onSuccessWithData?.({
          closings_created: response.data.closings_created,
          business_day: response.data.business_day,
          lottery_total: response.data.lottery_total,
          bins_closed: response.data.bins_closed,
        });
      } else {
        throw new Error("Failed to close lottery");
      }
    } catch (error) {
      playError();

      // API-003: Structured error handling with user-friendly messages
      // Check for specific error codes to provide actionable feedback
      const apiError = error as {
        code?: string;
        message?: string;
        status?: number;
      };

      if (apiError.code === "SHIFTS_STILL_OPEN") {
        // Defense-in-depth: Backend rejected because shifts are open
        toast({
          title: "Cannot Close Lottery",
          description:
            "All shifts must be closed before lottery can be closed. Please close all open shifts first.",
          variant: "destructive",
        });
      } else {
        // Generic error handling for other cases
        const errorMessage =
          error instanceof Error ? error.message : "Failed to close lottery";
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    allBinsScanned,
    scannedBins,
    setScannedBins,
    storeId,
    currentShiftId,
    toast,
    onOpenChange,
    onSuccess,
    onSuccessWithData,
    playSuccess,
    playError,
  ]);

  const handleOpenChange = (newOpen: boolean) => {
    if (!isSubmitting) {
      onOpenChange(newOpen);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[750px] max-h-[90vh] overflow-y-auto"
        data-testid="close-day-modal"
      >
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Close Lottery</DialogTitle>
            <button
              type="button"
              onClick={toggleMute}
              className="p-1.5 rounded-md hover:bg-muted transition-colors"
              title={isMuted ? "Enable scan sounds" : "Disable scan sounds"}
              aria-label={
                isMuted ? "Enable scan sounds" : "Disable scan sounds"
              }
              data-testid="sound-toggle"
            >
              {isMuted ? (
                <VolumeX className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Volume2 className="h-4 w-4 text-green-600" />
              )}
            </button>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Single Input Field */}
          <div className="space-y-2">
            <label htmlFor="serial-input" className="text-sm font-medium">
              Scan Serial Number (24 digits)
            </label>
            <Input
              id="serial-input"
              ref={inputRef}
              value={inputValue}
              onChange={handleInputChange}
              placeholder="Scan serial number (24 digits)"
              disabled={isSubmitting}
              maxLength={24}
              data-testid="serial-input"
              className="font-mono"
              aria-label="Enter 24-digit serialized number"
            />
            <p className="text-xs text-muted-foreground">
              {inputValue.length}/24 digits
              {inputValue.length === 24 && " - Processing..."}
            </p>
          </div>

          {/* Bin Chips Grid - 10 columns with horizontal layout */}
          {activeBins.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  Bins ({scannedBins.length}/{activeBins.length} scanned)
                </label>
                {scannedBins.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Click scanned bin to undo
                  </span>
                )}
              </div>
              <div
                className="grid grid-cols-10 gap-1.5"
                data-testid="bin-chips-grid"
              >
                {activeBins
                  .sort((a, b) => a.bin_number - b.bin_number)
                  .map((bin) => {
                    const scannedBin = scannedBins.find(
                      (s) => s.bin_id === bin.bin_id,
                    );
                    const isScanned = !!scannedBin;

                    return (
                      <button
                        key={bin.bin_id}
                        type="button"
                        onClick={() => isScanned && handleRemoveBin(bin.bin_id)}
                        disabled={isSubmitting || !isScanned}
                        className={`
                          flex items-center h-7 rounded border transition-colors
                          ${
                            isScanned
                              ? "bg-green-100 dark:bg-green-900/40 border-green-500 dark:border-green-600 cursor-pointer hover:bg-green-200 dark:hover:bg-green-900/60"
                              : "bg-muted/50 border-muted-foreground/20 cursor-default justify-center"
                          }
                        `}
                        data-testid={`bin-chip-${bin.bin_id}`}
                        aria-label={
                          isScanned
                            ? `Bin ${bin.bin_number} scanned with serial ${scannedBin.closing_serial}. Click to undo.`
                            : `Bin ${bin.bin_number} pending scan`
                        }
                      >
                        {isScanned ? (
                          <>
                            <span className="w-[40%] text-center text-xs font-bold text-green-700 dark:text-green-300">
                              {bin.bin_number}
                            </span>
                            <span className="text-gray-300 dark:text-gray-600">
                              |
                            </span>
                            <span className="w-[60%] text-center text-xs font-mono font-black text-green-800 dark:text-green-200">
                              {scannedBin.closing_serial}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs font-medium text-muted-foreground">
                            {bin.bin_number}
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          {/* All Bins Scanned - Success Message */}
          {allBinsScanned && (
            <div className="p-2 bg-green-50 dark:bg-green-950/20 border border-green-300 dark:border-green-700 rounded-md">
              <p className="text-sm font-medium text-green-700 dark:text-green-400 text-center">
                ✓ All bins scanned - Ready to close
              </p>
            </div>
          )}

          {/* No Active Bins Message */}
          {activeBins.length === 0 && (
            <div className="p-3 bg-muted rounded-md">
              <p className="text-sm text-muted-foreground">
                No active bins to close. All bins are either empty or already
                closed.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => handleSubmit()}
            disabled={isSubmitting || !allBinsScanned}
            data-testid="save-button"
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Close Lottery
            {scannedBins.length > 0 && ` (${scannedBins.length} bins)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
