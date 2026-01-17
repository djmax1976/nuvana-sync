/**
 * Day Bins Table Component
 *
 * Story: MyStore Lottery Page Redesign
 * Story: Lottery Manual Entry Feature
 *
 * Displays all bins with their active packs in a table format for day-based tracking.
 * Shows starting serial (first of day) and ending serial (last closing).
 *
 * @requirements
 * - Display table with columns (Bin, Name, Price, Pack #, Starting, Ending)
 * - Show all bins ordered by display_order
 * - Greyed rows for empty bins
 * - Ending column is grayed out/disabled by default (read-only)
 * - When manualEntryMode is active, Ending column becomes editable input fields
 * - Auto-advance focus: After entering 3 digits, focus moves to next bin's input
 * - Clicking a row opens pack details modal (disabled in manual entry mode)
 * - Actions column with "Mark Sold" button for manual pack depletion
 *
 * MCP Guidance Applied:
 * - FE-002: FORM_VALIDATION - Strict input validation for 3-digit serial numbers
 * - SEC-014: INPUT_VALIDATION - Length, type, and format constraints on inputs
 * - SEC-004: XSS - React auto-escapes output, no dangerouslySetInnerHTML used
 * - FE-005: UI_SECURITY - No sensitive data exposed in DOM
 * - FE-001: STATE_MANAGEMENT - Proper ref and memoization for focus management
 */

import { useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { DayBin } from '@/lib/api/lottery';

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
}

/**
 * DayBinsTable component
 * Displays bins with active packs in a table for day-based tracking
 * Supports manual entry mode where ending serial inputs become editable
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

  return (
    <div className="rounded-md border overflow-hidden" data-testid="day-bins-table">
      <div className="max-h-[70vh] overflow-y-auto">
        <Table size="compact">
          <TableHeader className="sticky top-0 bg-background z-10 border-b">
            <TableRow>
              <TableHead scope="col" className="w-16 md:w-20">
                Bin
              </TableHead>
              <TableHead scope="col" className="min-w-[120px]">
                Name
              </TableHead>
              <TableHead scope="col" className="w-20 md:w-24">
                Price
              </TableHead>
              <TableHead scope="col" className="w-24 md:w-28">
                Pack #
              </TableHead>
              <TableHead scope="col" className="w-20 md:w-24">
                Starting
              </TableHead>
              <TableHead scope="col" className="w-24 md:w-32">
                Ending
                {manualEntryMode && <span className="ml-1 text-xs text-primary">(Edit)</span>}
              </TableHead>
              {/* Actions column - always visible for Return, wider when manual entry active */}
              <TableHead scope="col" className={manualEntryMode ? "w-40 md:w-44 text-center" : "w-24 md:w-28 text-center"}>
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedBins.map((bin) => {
              const isEmpty = bin.pack === null;
              // Disable row click in manual entry mode to prevent accidental navigation
              const isClickable = !isEmpty && onRowClick && !manualEntryMode;
              const currentEndingValue = endingValues[bin.bin_id] || '';
              // Get validation error for this bin (if any)
              const validationError = validationErrors[bin.bin_id];
              const hasError = !!validationError;

              return (
                <TableRow
                  key={bin.bin_id}
                  data-testid={`day-bins-row-${bin.bin_id}`}
                  className={`
                    ${isEmpty ? 'opacity-50 bg-muted/30' : ''}
                    ${isClickable ? 'cursor-pointer hover:bg-muted/50' : ''}
                    ${manualEntryMode && !isEmpty ? 'bg-primary/5' : ''}
                  `}
                  onClick={() => {
                    if (isClickable && bin.pack) {
                      onRowClick(bin.pack.pack_id);
                    }
                  }}
                >
                  {/* Bin Number */}
                  <TableCell className="font-mono text-primary font-semibold text-sm md:text-base">
                    {bin.bin_number}
                  </TableCell>

                  {/* Game Name */}
                  <TableCell
                    className={`text-sm md:text-base ${isEmpty ? 'text-muted-foreground' : ''}`}
                  >
                    {isEmpty ? '(Empty)' : bin.pack!.game_name}
                  </TableCell>

                  {/* Price (per ticket) */}
                  <TableCell
                    className={`text-sm md:text-base ${isEmpty ? 'text-muted-foreground' : ''}`}
                  >
                    {isEmpty ? '--' : `$${bin.pack!.game_price.toFixed(2)}`}
                  </TableCell>

                  {/* Pack Number */}
                  <TableCell
                    className={`font-mono text-sm md:text-base ${
                      isEmpty ? 'text-muted-foreground' : ''
                    }`}
                  >
                    {isEmpty ? '--' : bin.pack!.pack_number}
                  </TableCell>

                  {/* Starting Serial */}
                  <TableCell
                    className={`font-mono text-sm md:text-base ${
                      isEmpty ? 'text-muted-foreground' : ''
                    }`}
                  >
                    {isEmpty ? '--' : bin.pack!.starting_serial}
                  </TableCell>

                  {/* Ending Serial - Editable in manual entry mode */}
                  <TableCell
                    className={`font-mono text-sm md:text-base ${
                      isEmpty
                        ? 'text-muted-foreground'
                        : manualEntryMode
                          ? ''
                          : 'text-muted-foreground/70'
                    }`}
                  >
                    {isEmpty ? (
                      '--'
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

                  {/* Actions Column
                      - Sold Out: Only in manual entry mode - marks pack as sold out (depleted)
                      - Return: ALWAYS visible - returns pack to supplier */}
                  <TableCell className="text-center">
                    {isEmpty ? (
                      '--'
                    ) : (
                      <div className="flex items-center justify-center gap-2">
                        {/* Sold Out button - only in manual entry mode */}
                        {manualEntryMode && typeof onMarkSoldOut === 'function' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation(); // Prevent row click
                              onMarkSoldOut(bin.pack!.pack_id);
                            }}
                            className="h-7 text-xs px-2 whitespace-nowrap"
                            data-testid={`mark-sold-btn-${bin.bin_id}`}
                            aria-label={`Mark pack ${bin.pack!.pack_number} as sold out`}
                          >
                            Sold Out
                          </Button>
                        )}
                        {/* Return button - ALWAYS visible
                            MCP: SEC-010 AUTHZ - ACTIVATED and RECEIVED packs can be returned */}
                        {typeof onReturnPack === 'function' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation(); // Prevent row click
                              onReturnPack(bin.pack!.pack_id);
                            }}
                            className="h-7 text-xs px-2 whitespace-nowrap"
                            data-testid={`return-pack-btn-${bin.bin_id}`}
                            aria-label={`Return pack ${bin.pack!.pack_number} to supplier`}
                          >
                            Return
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
