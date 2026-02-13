/**
 * Day Bins Table Component
 *
 * Story: MyStore Lottery Page Redesign
 * Story: Lottery Manual Entry Feature
 * Story: Lottery Day Close Scanner Feature - Phase 3
 *
 * Displays all bins with their active packs in a table format for day-based tracking.
 * Shows starting serial (first of day) and ending serial (last closing).
 *
 * @requirements
 * - Display table with columns (Bin, Name, Price, Pack #, Start, End, Sold, Amount, Actions)
 * - Show all bins ordered by display_order
 * - Greyed rows for empty bins
 * - Ending column is grayed out/disabled by default (read-only)
 * - When manualEntryMode is active, Ending column becomes editable input fields
 * - Auto-advance focus: After entering 3 digits, focus moves to next bin's input
 * - Clicking a row opens pack details modal (disabled in manual entry mode)
 * - Actions column with dropdown menu (Mark Sold, Return)
 * - Scanner mode: Green highlighting, checkmark icons, click-to-undo
 * - Sold column: Real-time calculation (end - start)
 * - Amount column: Dollar calculation (sold × price)
 * - Totals row with sum of tickets and amount
 *
 * MCP Guidance Applied:
 * - FE-002: FORM_VALIDATION - Strict input validation for 3-digit serial numbers
 * - SEC-014: INPUT_VALIDATION - Length, type, and format constraints on inputs
 * - SEC-004: XSS - React auto-escapes output, no dangerouslySetInnerHTML used
 * - FE-005: UI_SECURITY - No sensitive data exposed in DOM
 * - FE-001: STATE_MANAGEMENT - Proper ref and memoization for focus management
 * - PERF-002: FE_RENDER_OPTIMIZATION - useMemo for expensive calculations
 */

import { useCallback, useRef, useEffect, useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { BinBadge } from './SectionPrimitives';
import { BinActionsMenu } from './BinActionsMenu';
import type { DayBin } from '@/lib/api/lottery';
import type { ScannedBin } from '@/hooks/useScannedBins';

/**
 * Validation error for a single bin
 */
export interface BinValidationError {
  message: string;
}

/**
 * Props for DayBinsTable component
 */
export interface DayBinsTableProps {
  /** Bins with pack information, ordered by display_order */
  bins: DayBin[];
  /** Callback when a row is clicked (to open pack details) */
  onRowClick?: (packId: string) => void;
  /** Whether manual entry mode is active - enables editable ending serial inputs */
  manualEntryMode?: boolean;
  /** Current ending values keyed by bin_id (for manual entry mode) */
  endingValues?: Record<string, string>;
  /** Callback when ending value changes (for manual entry mode) */
  onEndingChange?: (binId: string, value: string) => void;
  /** Callback when an input is complete (3 digits entered) */
  onInputComplete?: (binId: string) => void;
  /** Validation errors keyed by bin_id - controls error styling */
  validationErrors?: Record<string, BinValidationError>;
  /**
   * Callback to validate ending value on blur
   * Parent should call validateManualEntryEnding and update validationErrors state
   */
  onValidateEnding?: (
    binId: string,
    value: string,
    packData: { starting_serial: string; serial_end: string }
  ) => void;
  /**
   * Callback when Mark Sold button is clicked for a pack
   * Opens confirmation dialog to mark the pack as sold out (depleted)
   */
  onMarkSoldOut?: (packId: string) => void;
  /**
   * Callback when Return Pack button is clicked for a pack
   * Opens dialog to return pack to supplier with sales tracking
   * MCP: SEC-010 AUTHZ - ACTIVE and RECEIVED packs can be returned
   */
  onReturnPack?: (packId: string) => void;

  // ============================================================================
  // Scanner Mode Props (Phase 3)
  // ============================================================================

  /** Scanned bins with closing serial data (for scanner mode visual feedback) */
  scannedBins?: ScannedBin[];
  /** ID of the most recently scanned bin (for pulse animation) */
  lastScannedBinId?: string | null;
  /** Callback when a scanned row is clicked to undo the scan */
  onUndoScan?: (binId: string) => void;
  /** Whether scanner mode is active (different from manualEntryMode) */
  scannerModeActive?: boolean;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format a number as USD currency
 * Matches ReturnedPacksSection and DepletedPacksSection implementation
 *
 * SEC-014: Input is typed as number, no user input interpolation
 */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Calculate tickets sold from starting and ending serial
 *
 * @param startingSerial - 3-digit starting serial (e.g., "000")
 * @param endingSerial - 3-digit ending serial (e.g., "015")
 * @param isSoldOut - Whether pack is sold out (uses different formula)
 * @returns Number of tickets sold, or null if calculation not possible
 *
 * SEC-014: Input validation - returns null for invalid inputs
 */
function calculateTicketsSold(
  startingSerial: string | null | undefined,
  endingSerial: string | null | undefined,
  isSoldOut: boolean = false
): number | null {
  if (!startingSerial || !endingSerial) {
    return null;
  }

  // SEC-014: Validate format - must be 3-digit numeric strings
  if (!/^\d{3}$/.test(startingSerial) || !/^\d{3}$/.test(endingSerial)) {
    return null;
  }

  const startNum = parseInt(startingSerial, 10);
  const endNum = parseInt(endingSerial, 10);

  if (isNaN(startNum) || isNaN(endNum)) {
    return null;
  }

  // Business rule: ending must be >= starting
  if (endNum < startNum) {
    return null;
  }

  // For sold out packs, ending_serial is the last ticket index (0-based)
  // Formula: (ending_serial - starting_serial) + 1
  // For normal scans, ending is the "next position" pointer
  // Formula: ending_serial - starting_serial
  if (isSoldOut) {
    return endNum - startNum + 1;
  }

  return endNum - startNum;
}

/**
 * DayBinsTable component
 * Displays bins with active packs in a table for day-based tracking
 * Supports manual entry mode where ending serial inputs become editable
 * Supports scanner mode with visual feedback (green highlighting, checkmarks)
 */
export function DayBinsTable({
  bins,
  onRowClick,
  manualEntryMode = false,
  endingValues = {},
  onEndingChange,
  onInputComplete,
  validationErrors = {},
  onValidateEnding,
  onMarkSoldOut,
  onReturnPack,
  scannedBins = [],
  lastScannedBinId = null,
  onUndoScan,
  scannerModeActive = false,
}: DayBinsTableProps) {
  // Refs for input focus management (auto-advance to next input)
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Track whether initial focus has been applied to prevent re-focusing on every render
  const hasAppliedInitialFocus = useRef(false);

  // Track previous manualEntryMode to detect activation
  const prevManualEntryMode = useRef(manualEntryMode);

  // Handle null/undefined bins early (before spreading)
  // Memoize to maintain stable reference when bins is null/undefined
  const safeBins = useMemo(() => bins || [], [bins]);

  // Sort bins by bin_number (display_order + 1)
  // Memoize to prevent unnecessary recalculations
  const sortedBins = useMemo(
    () => [...safeBins].sort((a, b) => a.bin_number - b.bin_number),
    [safeBins]
  );

  // Get active bins (bins with packs) for focus management
  // Memoize to maintain stable reference and prevent useEffect/useCallback re-runs
  const activeBinIds = useMemo(
    () => sortedBins.filter((bin) => bin.pack !== null).map((bin) => bin.bin_id),
    [sortedBins]
  );

  // Create a Map for fast scannedBin lookup by bin_id
  // PERF-002: Memoize map creation for O(1) lookups
  const scannedBinMap = useMemo(() => {
    const map = new Map<string, ScannedBin>();
    for (const scanned of scannedBins) {
      map.set(scanned.bin_id, scanned);
    }
    return map;
  }, [scannedBins]);

  /**
   * Calculate totals for the footer row
   * PERF-002: Memoize expensive calculation
   */
  const totals = useMemo(() => {
    let totalTickets = 0;
    let totalAmount = 0;
    let scannedTickets = 0;
    let scannedAmount = 0;

    for (const bin of sortedBins) {
      if (!bin.pack) continue;

      const scannedBin = scannedBinMap.get(bin.bin_id);

      // Get ending serial - prefer scanned, then manual entry, then existing
      const endingSerial =
        scannedBin?.closing_serial ||
        endingValues[bin.bin_id] ||
        bin.pack.ending_serial;

      if (endingSerial) {
        const isSoldOut = scannedBin?.is_sold_out ?? false;
        const ticketsSold = calculateTicketsSold(
          bin.pack.starting_serial,
          endingSerial,
          isSoldOut
        );

        if (ticketsSold !== null && ticketsSold > 0) {
          const amount = ticketsSold * bin.pack.game_price;
          totalTickets += ticketsSold;
          totalAmount += amount;

          // Track scanned totals separately for scanner mode
          if (scannedBin) {
            scannedTickets += ticketsSold;
            scannedAmount += amount;
          }
        }
      }
    }

    return { totalTickets, totalAmount, scannedTickets, scannedAmount };
  }, [sortedBins, scannedBinMap, endingValues]);

  /**
   * Handle input change with strict validation
   * Only allows numeric input, max 3 digits
   * MCP: SEC-014 INPUT_VALIDATION - Strict format constraints
   */
  const handleInputChange = useCallback(
    (binId: string, value: string) => {
      // Strip non-numeric characters (SEC-014: sanitize input)
      const sanitizedValue = value.replace(/\D/g, '');

      // Enforce max length of 3 digits
      const truncatedValue = sanitizedValue.slice(0, 3);

      onEndingChange?.(binId, truncatedValue);

      // Auto-advance when 3 digits entered
      if (truncatedValue.length === 3) {
        onInputComplete?.(binId);

        // Find next active bin and focus its input
        const currentIndex = activeBinIds.indexOf(binId);
        if (currentIndex !== -1 && currentIndex < activeBinIds.length - 1) {
          const nextBinId = activeBinIds[currentIndex + 1];
          const nextInput = inputRefs.current.get(nextBinId);
          if (nextInput) {
            // Small delay to ensure state update completes
            setTimeout(() => nextInput.focus(), 50);
          }
        }
      }
    },
    [onEndingChange, onInputComplete, activeBinIds]
  );

  /**
   * Handle input blur - validate ending serial against pack range
   * MCP: FE-002 FORM_VALIDATION - Validate on blur for immediate feedback
   */
  const handleInputBlur = useCallback(
    (binId: string, value: string, pack: { starting_serial: string; serial_end: string }) => {
      // Only validate if we have 3 digits (complete entry)
      if (value.length === 3 && onValidateEnding) {
        onValidateEnding(binId, value, {
          starting_serial: pack.starting_serial,
          serial_end: pack.serial_end,
        });
      }
    },
    [onValidateEnding]
  );

  /**
   * Store input ref for focus management
   */
  const setInputRef = useCallback((binId: string, element: HTMLInputElement | null) => {
    if (element) {
      inputRefs.current.set(binId, element);
    } else {
      inputRefs.current.delete(binId);
    }
  }, []);

  /**
   * Handle scanned row click for undo
   */
  const handleScannedRowClick = useCallback(
    (binId: string) => {
      if (onUndoScan) {
        onUndoScan(binId);
      }
    },
    [onUndoScan]
  );

  // Focus first active input when manual entry mode is activated (only once on activation)
  useEffect(() => {
    // Detect transition from false -> true (mode activation)
    const wasJustActivated = manualEntryMode && !prevManualEntryMode.current;

    // Update the ref for next render comparison
    prevManualEntryMode.current = manualEntryMode;

    // Reset focus tracking when mode is deactivated
    if (!manualEntryMode) {
      hasAppliedInitialFocus.current = false;
      return;
    }

    // Only apply initial focus once when mode is first activated
    if (wasJustActivated && !hasAppliedInitialFocus.current && activeBinIds.length > 0) {
      hasAppliedInitialFocus.current = true;
      const firstBinId = activeBinIds[0];
      // Small delay to ensure DOM is ready after mode change
      setTimeout(() => {
        const firstInput = inputRefs.current.get(firstBinId);
        if (firstInput) {
          firstInput.focus();
        }
      }, 100);
    }
  }, [manualEntryMode, activeBinIds]);

  if (safeBins.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground" data-testid="day-bins-table-empty">
        No bins configured for this store.
      </div>
    );
  }

  // Determine if we should show scanned totals in footer
  const showScannedTotals = scannerModeActive && scannedBins.length > 0;

  return (
    <TooltipProvider>
      <div
        className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm"
        data-testid="day-bins-table"
      >
        {/* Card Header — matches report page Bin Closings card style */}
        <div className="flex items-center px-4 sm:px-6 py-4 sm:py-5 border-b border-border">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-[10px] bg-blue-100 dark:bg-blue-950 flex items-center justify-center">
              <svg
                className="w-[18px] h-[18px] text-blue-600 dark:text-blue-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            </span>
            <span className="text-base font-bold text-foreground">Bins</span>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto">
          <Table size="compact" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col className="w-[60px] md:w-[70px]" />
              <col />
              <col className="w-[80px] md:w-[95px]" />
              <col className="w-[100px] md:w-[140px]" />
              <col className="w-[60px] md:w-[80px]" />
              <col className="w-[65px] md:w-[90px]" />
              <col className="w-[70px] md:w-[90px]" />
              <col className="w-[90px] md:w-[120px]" />
              <col className="w-[50px] md:w-[60px]" />
            </colgroup>
            <TableHeader className="sticky top-0 bg-muted/50 z-10 border-b">
              <TableRow>
                <TableHead scope="col" className="text-center text-[10px] sm:text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                  Bin
                </TableHead>
                <TableHead scope="col" className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider">
                  Game
                </TableHead>
                <TableHead scope="col" className="text-right text-[10px] sm:text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                  Price
                </TableHead>
                <TableHead scope="col" className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                  Pack #
                </TableHead>
                <TableHead scope="col" className="text-center text-[10px] sm:text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                  Start
                </TableHead>
                <TableHead scope="col" className="text-center text-[10px] sm:text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                  End
                  {manualEntryMode && <span className="ml-1 text-xs text-primary normal-case tracking-normal">(Edit)</span>}
                </TableHead>
                <TableHead scope="col" className="text-center text-[10px] sm:text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                  Sold
                </TableHead>
                <TableHead scope="col" className="text-right text-[10px] sm:text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                  Amount
                </TableHead>
                <TableHead scope="col" className="text-center text-[10px] sm:text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedBins.map((bin) => {
                const isEmpty = bin.pack === null;

                // Check if this bin is scanned
                const scannedBin = isEmpty ? undefined : scannedBinMap.get(bin.bin_id);
                const isScanned = !!scannedBin;
                const isLastScanned = lastScannedBinId === bin.bin_id;

                // Disable row click in manual entry mode to prevent accidental navigation
                // In scanner mode, clicking a scanned row undoes the scan
                const isClickable =
                  !isEmpty &&
                  onRowClick &&
                  !manualEntryMode &&
                  !scannerModeActive;

                const isUndoClickable = isScanned && onUndoScan && scannerModeActive;

                const currentEndingValue = endingValues[bin.bin_id] || '';
                // Get validation error for this bin (if any)
                const validationError = validationErrors[bin.bin_id];
                const hasError = !!validationError;

                // Calculate ending serial for display and calculations
                // Priority: scanned > manual entry > existing
                const displayEndingSerial =
                  scannedBin?.closing_serial ||
                  currentEndingValue ||
                  bin.pack?.ending_serial ||
                  null;

                // Calculate tickets sold
                const ticketsSold = !isEmpty
                  ? calculateTicketsSold(
                      bin.pack!.starting_serial,
                      displayEndingSerial,
                      scannedBin?.is_sold_out ?? false
                    )
                  : null;

                // Calculate amount
                const salesAmount =
                  ticketsSold !== null && !isEmpty
                    ? ticketsSold * bin.pack!.game_price
                    : null;

                // Determine row styling
                let rowClassName = 'group transition-colors';
                if (isEmpty) {
                  rowClassName += ' opacity-50 bg-muted/30';
                } else if (isScanned) {
                  rowClassName += ' bg-green-50 dark:bg-green-950/20';
                  if (isLastScanned) {
                    rowClassName += ' animate-pulse';
                  }
                  if (isUndoClickable) {
                    rowClassName += ' cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30';
                  }
                } else if (isClickable) {
                  rowClassName += ' cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/30';
                } else if (manualEntryMode && !isEmpty) {
                  rowClassName += ' bg-primary/5';
                }

                return (
                  <TableRow
                    key={bin.bin_id}
                    id={`bin-row-${bin.bin_id}`}
                    data-testid={`day-bins-row-${bin.bin_id}`}
                    className={rowClassName}
                    onClick={() => {
                      if (isUndoClickable) {
                        handleScannedRowClick(bin.bin_id);
                      } else if (isClickable && bin.pack) {
                        onRowClick(bin.pack.pack_id);
                      }
                    }}
                  >
                    {/* Bin Number — BinBadge matches report page styling */}
                    <TableCell className="border-b border-border/50">
                      <div className="flex justify-center">
                        <BinBadge number={bin.bin_number} />
                      </div>
                    </TableCell>

                    {/* Game Name */}
                    <TableCell
                      className={`text-xs sm:text-sm border-b border-border/50 ${isEmpty ? 'text-muted-foreground' : 'font-semibold text-foreground'}`}
                    >
                      {isEmpty ? '(Empty)' : bin.pack!.game_name}
                    </TableCell>

                    {/* Price (per ticket) */}
                    <TableCell
                      className={`text-right text-xs sm:text-sm font-mono border-b border-border/50 whitespace-nowrap ${isEmpty ? 'text-muted-foreground' : ''}`}
                    >
                      {isEmpty ? '--' : `$${bin.pack!.game_price.toFixed(2)}`}
                    </TableCell>

                    {/* Pack Number */}
                    <TableCell
                      className={`font-mono text-xs sm:text-sm border-b border-border/50 ${
                        isEmpty ? 'text-muted-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {isEmpty ? '--' : bin.pack!.pack_number}
                    </TableCell>

                    {/* Starting Serial */}
                    <TableCell
                      className={`font-mono text-xs sm:text-sm text-center border-b border-border/50 whitespace-nowrap ${
                        isEmpty ? 'text-muted-foreground' : ''
                      }`}
                    >
                      {isEmpty ? '--' : bin.pack!.starting_serial}
                    </TableCell>

                    {/* Ending Serial - Editable in manual entry mode, checkmark in scanner mode */}
                    <TableCell
                      className={`font-mono text-xs sm:text-sm text-center border-b border-border/50 ${
                        isEmpty
                          ? 'text-muted-foreground'
                          : isScanned
                            ? 'text-green-700 dark:text-green-400'
                            : manualEntryMode
                              ? ''
                              : 'text-muted-foreground/70'
                      }`}
                    >
                      {isEmpty ? (
                        '--'
                      ) : isScanned ? (
                        // Scanner mode: Show checkmark with serial
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className="flex items-center justify-center gap-1"
                              data-testid={`scanned-serial-${bin.bin_id}`}
                            >
                              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                              <span className="font-bold">{scannedBin!.closing_serial}</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Click row to undo scan</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : manualEntryMode ? (
                        <div className="flex flex-col gap-1">
                          <Input
                            ref={(el) => setInputRef(bin.bin_id, el)}
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={3}
                            value={currentEndingValue}
                            onChange={(e) => handleInputChange(bin.bin_id, e.target.value)}
                            onBlur={() =>
                              handleInputBlur(bin.bin_id, currentEndingValue, {
                                starting_serial: bin.pack!.starting_serial,
                                serial_end: bin.pack!.serial_end,
                              })
                            }
                            onClick={(e) => e.stopPropagation()}
                            placeholder="000"
                            className={`w-16 h-8 text-center font-mono font-bold text-sm ${
                              hasError
                                ? 'border-red-500 bg-red-50 dark:bg-red-950/20 focus:border-red-500 focus:ring-red-500'
                                : currentEndingValue.length === 3
                                  ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
                                  : 'border-primary'
                            }`}
                            data-testid={`ending-input-${bin.bin_id}`}
                            aria-label={`Ending serial for bin ${bin.bin_number}`}
                            aria-invalid={hasError}
                            aria-describedby={hasError ? `ending-error-${bin.bin_id}` : undefined}
                          />
                          {hasError && (
                            <span
                              id={`ending-error-${bin.bin_id}`}
                              className="text-xs text-red-600 dark:text-red-400 whitespace-nowrap"
                              data-testid={`ending-error-${bin.bin_id}`}
                              role="alert"
                            >
                              {validationError.message}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span data-testid={`ending-display-${bin.bin_id}`}>
                          {bin.pack!.ending_serial || '--'}
                        </span>
                      )}
                    </TableCell>

                    {/* Sold Column - Calculated tickets sold */}
                    <TableCell
                      className={`text-center text-xs sm:text-sm border-b border-border/50 whitespace-nowrap ${
                        isScanned ? 'font-semibold text-green-700 dark:text-green-400' : 'text-muted-foreground'
                      }`}
                      data-testid={`sold-${bin.bin_id}`}
                    >
                      {isEmpty
                        ? '--'
                        : ticketsSold !== null && ticketsSold > 0
                          ? ticketsSold
                          : '--'}
                    </TableCell>

                    {/* Amount Column - Calculated sales amount */}
                    <TableCell
                      className={`text-right text-xs sm:text-sm font-bold border-b border-border/50 whitespace-nowrap ${
                        isScanned ? 'text-green-700 dark:text-green-400' : ''
                      }`}
                      data-testid={`amount-${bin.bin_id}`}
                    >
                      {isEmpty
                        ? '--'
                        : salesAmount !== null && salesAmount > 0
                          ? formatCurrency(salesAmount)
                          : '--'}
                    </TableCell>

                    {/* Actions Column - DropdownMenu with Mark Sold and Return */}
                    <TableCell className="text-center border-b border-border/50">
                      {isEmpty ? (
                        <span className="text-muted-foreground">--</span>
                      ) : (
                        <BinActionsMenu
                          packId={bin.pack!.pack_id}
                          packNumber={bin.pack!.pack_number}
                          onMarkSold={onMarkSoldOut}
                          onReturn={onReturnPack}
                          testIdPrefix={`bin-${bin.bin_id}-`}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>

            {/* Totals Footer */}
            {(totals.totalTickets > 0 || totals.scannedTickets > 0) && (
              <TableFooter>
                <TableRow className="bg-muted/50" data-testid="totals-row">
                  <TableCell colSpan={6} className="text-right text-xs sm:text-sm font-bold uppercase tracking-wider">
                    {showScannedTotals ? 'Scanned Total:' : 'Total:'}
                  </TableCell>
                  <TableCell
                    className={`text-center text-xs sm:text-sm font-bold ${showScannedTotals ? 'text-green-700 dark:text-green-400' : ''}`}
                    data-testid="total-tickets"
                  >
                    {showScannedTotals ? totals.scannedTickets : totals.totalTickets}
                  </TableCell>
                  <TableCell
                    className={`text-right text-xs sm:text-sm font-bold ${showScannedTotals ? 'text-green-700 dark:text-green-400' : ''}`}
                    data-testid="total-amount"
                  >
                    {formatCurrency(showScannedTotals ? totals.scannedAmount : totals.totalAmount)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      </div>
    </TooltipProvider>
  );
}
