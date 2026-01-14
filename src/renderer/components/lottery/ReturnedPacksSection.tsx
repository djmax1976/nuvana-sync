/**
 * Returned Packs Section Component
 *
 * Story: Lottery Pack Return Feature
 * Enhancement: Enterprise Close-to-Close Business Day Model
 *
 * Displays returned packs for the current OPEN business period (close-to-close model).
 * Shows bin number, game name, price, pack number, return reason, tickets sold,
 * sales amount, and return datetime.
 *
 * Enterprise Pattern:
 * - Business day = period from last day close to next day close (not midnight-to-midnight)
 * - Shows ALL packs returned since last closed day, preventing orphaned data
 * - Displays warning when multiple calendar days have passed without day close
 * - Always shows full date+time with year since packs can span multiple days
 * - Includes return reason categorization for audit trail
 *
 * Responsive Design:
 * - All screen sizes use horizontal scroll table (no card view)
 * - Stacked date/time format: "Jan 25th, 2026" on first line, "3:45 PM" on second line
 *
 * MCP Guidance Applied:
 * - FE-001: STATE_MANAGEMENT - Secure state with useState for collapse state
 * - FE-002: FORM_VALIDATION - Strict type checking on props
 * - SEC-004: XSS - React auto-escapes all output, no dangerouslySetInnerHTML
 * - SEC-014: INPUT_VALIDATION - Type-safe props with TypeScript interfaces
 * - FE-005: UI_SECURITY - No sensitive data exposed
 * - API-008: OUTPUT_FILTERING - Only whitelisted fields displayed from API response
 */

import { useState, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronRight, Undo2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import type { ReturnedPackDay, OpenBusinessPeriod } from '@/lib/api/lottery';
import { useDateFormat } from '@/hooks/useDateFormat';

// ============================================================================
// TYPE DEFINITIONS
// MCP: SEC-014 INPUT_VALIDATION - Strict type definitions for component props
// ============================================================================

/**
 * Props for ReturnedPacksSection component
 *
 * MCP Guidance Applied:
 * - SEC-014: INPUT_VALIDATION - Strict type definitions for component props
 * - FE-001: STATE_MANAGEMENT - Immutable data structure for safe consumption
 */
export interface ReturnedPacksSectionProps {
  /** Returned packs since last day close (enterprise close-to-close model) */
  returnedPacks: ReturnedPackDay[];
  /** Open business period metadata for context display */
  openBusinessPeriod?: OpenBusinessPeriod;
  /** Default open state */
  defaultOpen?: boolean;
}

/**
 * Parsed datetime structure for stacked display
 * MCP: SEC-014 INPUT_VALIDATION - Strongly typed output structure
 */
interface ParsedDateTime {
  /** Formatted date string: "Jan 25th, 2026" */
  date: string;
  /** Formatted time string: "3:45 PM" */
  time: string;
  /** Whether parsing was successful */
  isValid: boolean;
}

// ============================================================================
// CONSTANTS
// MCP: SEC-014 INPUT_VALIDATION - Constrained lookup tables for safe display
// ============================================================================

/**
 * Ordinal suffix lookup for day numbers
 */
const ORDINAL_SUFFIXES: Readonly<Record<number, string>> = {
  1: 'st',
  2: 'nd',
  3: 'rd',
  21: 'st',
  22: 'nd',
  23: 'rd',
  31: 'st',
} as const;

/**
 * Return reason display labels
 * MCP: SEC-014 INPUT_VALIDATION - Constrained lookup for safe string display
 */
const RETURN_REASON_LABELS: Readonly<Record<string, string>> = {
  SUPPLIER_RECALL: 'Supplier Recall',
  DAMAGED: 'Damaged',
  EXPIRED: 'Expired',
  INVENTORY_ADJUSTMENT: 'Inventory Adjustment',
  STORE_CLOSURE: 'Store Closure',
  OTHER: 'Other',
} as const;

/**
 * Return reason badge variants for visual differentiation
 * MCP: SEC-004 XSS - Only uses safe badge variant values
 */
const RETURN_REASON_VARIANTS: Readonly<
  Record<string, 'default' | 'secondary' | 'destructive' | 'outline'>
> = {
  SUPPLIER_RECALL: 'destructive',
  DAMAGED: 'destructive',
  EXPIRED: 'secondary',
  INVENTORY_ADJUSTMENT: 'outline',
  STORE_CLOSURE: 'secondary',
  OTHER: 'outline',
} as const;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get ordinal suffix for a day number (1st, 2nd, 3rd, 4th, etc.)
 * MCP: SEC-014 INPUT_VALIDATION - Validates numeric input with safe fallback
 *
 * @param day - Day of month (1-31)
 * @returns Ordinal suffix string ("st", "nd", "rd", or "th")
 */
function getOrdinalSuffix(day: number): string {
  // Validate input is within expected range
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return 'th';
  }

  // Check lookup table first for special cases
  // eslint-disable-next-line security/detect-object-injection -- Safe: day is validated integer 1-31, lookup table has numeric keys
  if (ORDINAL_SUFFIXES[day]) {
    // eslint-disable-next-line security/detect-object-injection -- Safe: same validation as above
    return ORDINAL_SUFFIXES[day];
  }

  // Default to "th" for all other cases (4th-20th, 24th-30th)
  return 'th';
}

/**
 * Create a timezone-aware datetime parser
 * Returns a function that parses ISO datetime strings using the store's timezone
 *
 * MCP Guidance Applied:
 * - FE-001: STATE_MANAGEMENT - Uses centralized timezone from StoreContext
 * - SEC-014: INPUT_VALIDATION - Validates input before processing
 * - API-003: ERROR_HANDLING - Returns safe fallback structure on error
 * - SEC-004: XSS - Only uses safe formatting methods, no HTML injection possible
 *
 * @param formatCustom - Custom format function from useDateFormat hook
 * @returns Parser function for ISO datetime strings
 */
function createDateTimeParser(
  formatCustom: (date: Date | string, formatStr: string) => string
): (isoString: string | null | undefined) => ParsedDateTime {
  return (isoString: string | null | undefined): ParsedDateTime => {
    // Input validation - check for null/undefined/empty
    if (!isoString || typeof isoString !== 'string') {
      return { date: '--', time: '--', isValid: false };
    }

    // Trim whitespace to prevent parsing issues
    const trimmedInput = isoString.trim();
    if (trimmedInput.length === 0) {
      return { date: '--', time: '--', isValid: false };
    }

    try {
      const dateObj = new Date(trimmedInput);

      // Validate date is valid (not NaN)
      // Using Number.isNaN for strict NaN check (SEC-014)
      if (Number.isNaN(dateObj.getTime())) {
        return { date: '--', time: '--', isValid: false };
      }

      // Validate date is within reasonable range (not year 0 or far future)
      const year = dateObj.getFullYear();
      if (year < 2000 || year > 2100) {
        return { date: '--', time: '--', isValid: false };
      }

      // Use store timezone for formatting via useDateFormat hook
      // Format: "Jan 25th, 2026" for date
      const day = parseInt(formatCustom(trimmedInput, 'd'), 10);
      const ordinalSuffix = getOrdinalSuffix(day);
      const monthName = formatCustom(trimmedInput, 'MMM');
      const formattedYear = formatCustom(trimmedInput, 'yyyy');
      const dateString = `${monthName} ${day}${ordinalSuffix}, ${formattedYear}`;

      // Format time: "3:45 PM" using store timezone
      const timeString = formatCustom(trimmedInput, 'h:mm a');

      return {
        date: dateString,
        time: timeString,
        isValid: true,
      };
    } catch {
      // Catch any parsing errors and return safe fallback
      // MCP: API-003 ERROR_HANDLING - Graceful degradation
      return { date: '--', time: '--', isValid: false };
    }
  };
}

/**
 * Get human-readable label for return reason
 * MCP: SEC-014 INPUT_VALIDATION - Safe lookup with fallback
 *
 * @param reason - Return reason code from API
 * @returns Human-readable label
 */
function getReturnReasonLabel(reason: string | null | undefined): string {
  if (!reason || typeof reason !== 'string') {
    return 'Unknown';
  }
  // eslint-disable-next-line security/detect-object-injection -- Safe: reason is validated string, lookup returns undefined for invalid keys
  return RETURN_REASON_LABELS[reason] || reason;
}

/**
 * Get badge variant for return reason
 * MCP: SEC-014 INPUT_VALIDATION - Safe lookup with fallback
 *
 * @param reason - Return reason code from API
 * @returns Badge variant string
 */
function getReturnReasonVariant(
  reason: string | null | undefined
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (!reason || typeof reason !== 'string') {
    return 'outline';
  }
  // eslint-disable-next-line security/detect-object-injection -- Safe: reason is validated string, lookup returns undefined for invalid keys
  return RETURN_REASON_VARIANTS[reason] || 'outline';
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * ReturnedPacksSection component
 * Collapsible section showing packs that were returned during the current open business period.
 * Uses enterprise close-to-close model - shows all packs since last day close.
 *
 * @example
 * <ReturnedPacksSection
 *   returnedPacks={dayBinsData.returned_packs}
 *   openBusinessPeriod={dayBinsData.open_business_period}
 *   defaultOpen={false}
 * />
 */
export function ReturnedPacksSection({
  returnedPacks,
  openBusinessPeriod,
  defaultOpen = false,
}: ReturnedPacksSectionProps) {
  // ========================================================================
  // TIMEZONE-AWARE DATE FORMATTING
  // MCP: FE-001 STATE_MANAGEMENT - Centralized timezone from StoreContext
  // ========================================================================
  const { formatCustom } = useDateFormat();

  // Create memoized datetime parser with store timezone
  // MCP: FE-001 STATE_MANAGEMENT - Memoized parser for performance
  const parseDateTime = useMemo(() => createDateTimeParser(formatCustom), [formatCustom]);

  // ========================================================================
  // STATE MANAGEMENT
  // MCP: FE-001 STATE_MANAGEMENT - Local state for collapse toggle
  // ========================================================================
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // MCP: FE-001 STATE_MANAGEMENT - useCallback for stable handler reference
  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
  }, []);

  // ========================================================================
  // EARLY RETURN - No data
  // MCP: SEC-014 INPUT_VALIDATION - Defensive null/undefined check
  // ========================================================================
  if (!returnedPacks || !Array.isArray(returnedPacks) || returnedPacks.length === 0) {
    return null;
  }

  // ========================================================================
  // COMPUTED VALUES
  // ========================================================================

  // Calculate total sales from returned packs
  const totalReturnSales = returnedPacks.reduce((sum, pack) => {
    if (typeof pack.return_sales_amount === 'number') {
      return sum + pack.return_sales_amount;
    }
    return sum;
  }, 0);

  // Determine if multiple days have passed (for warning display)
  const daysSinceClose = openBusinessPeriod?.days_since_last_close;
  const isMultipleDays =
    daysSinceClose !== null &&
    daysSinceClose !== undefined &&
    typeof daysSinceClose === 'number' &&
    daysSinceClose > 1;

  // Build the section title based on context
  // MCP: SEC-004 XSS - Only using safe numeric values in string interpolation
  const sectionTitle = openBusinessPeriod?.is_first_period
    ? `Returned Packs (${returnedPacks.length})`
    : isMultipleDays
      ? `Returned Packs - Current Period (${returnedPacks.length})`
      : `Returned Packs Today (${returnedPacks.length})`;

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div className="space-y-2">
      {/* Warning when multiple calendar days have passed without day close */}
      {isMultipleDays && (
        <Alert
          variant="default"
          className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950"
          data-testid="multi-day-return-warning"
        >
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription className="text-amber-800 dark:text-amber-200">
            <strong>{daysSinceClose} days</strong> since last day close
            {openBusinessPeriod?.last_closed_date &&
              typeof openBusinessPeriod.last_closed_date === 'string' && (
                <span className="text-amber-600 dark:text-amber-400">
                  {' '}
                  (last closed: {openBusinessPeriod.last_closed_date})
                </span>
              )}
            . Returned packs from all days in this period are shown below.
          </AlertDescription>
        </Alert>
      )}

      <Collapsible
        open={isOpen}
        onOpenChange={handleOpenChange}
        className="rounded-lg border"
        data-testid="returned-packs-section"
      >
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full flex items-center justify-between p-4 hover:bg-muted/50"
            data-testid="returned-packs-trigger"
            aria-expanded={isOpen}
            aria-controls="returned-packs-content"
          >
            <div className="flex items-center gap-2">
              <Undo2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium text-left">{sectionTitle}</span>
              {/* Show total return sales in header */}
              {totalReturnSales > 0 && (
                <span className="text-sm text-muted-foreground ml-2">
                  (${totalReturnSales.toFixed(2)} sales)
                </span>
              )}
            </div>
            {isOpen ? (
              <ChevronDown
                className="h-4 w-4 flex-shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            ) : (
              <ChevronRight
                className="h-4 w-4 flex-shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div
            id="returned-packs-content"
            className="border-t overflow-x-auto"
            data-testid="returned-packs-content"
            role="region"
            aria-label="Returned packs table"
          >
            {/* Single Table View - Horizontal scroll on all screen sizes */}
            <Table size="compact">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className="w-14 text-center whitespace-nowrap">
                    Bin
                  </TableHead>
                  <TableHead scope="col" className="min-w-[140px]">
                    Game
                  </TableHead>
                  <TableHead scope="col" className="w-20 text-right whitespace-nowrap">
                    Price
                  </TableHead>
                  <TableHead scope="col" className="w-28 whitespace-nowrap">
                    Pack #
                  </TableHead>
                  <TableHead scope="col" className="w-32 whitespace-nowrap">
                    Reason
                  </TableHead>
                  <TableHead scope="col" className="w-20 text-right whitespace-nowrap">
                    Sold
                  </TableHead>
                  <TableHead scope="col" className="w-24 text-right whitespace-nowrap">
                    Sales $
                  </TableHead>
                  <TableHead scope="col" className="w-36 whitespace-nowrap">
                    Returned
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {returnedPacks.map((pack) => {
                  // MCP: SEC-014 INPUT_VALIDATION - Validate pack object structure
                  if (!pack || typeof pack.pack_id !== 'string') {
                    return null;
                  }

                  // Parse datetime for stacked display
                  const returnedDateTime = parseDateTime(pack.returned_at);

                  return (
                    <TableRow key={pack.pack_id} data-testid={`returned-pack-row-${pack.pack_id}`}>
                      {/* Bin Number */}
                      <TableCell className="font-mono text-primary font-semibold text-center">
                        {typeof pack.bin_number === 'number' ? pack.bin_number : '--'}
                      </TableCell>

                      {/* Game Name */}
                      <TableCell className="truncate max-w-[200px]">
                        {typeof pack.game_name === 'string' ? pack.game_name : '--'}
                      </TableCell>

                      {/* Price */}
                      <TableCell className="text-right tabular-nums">
                        {typeof pack.game_price === 'number'
                          ? `$${pack.game_price.toFixed(2)}`
                          : '--'}
                      </TableCell>

                      {/* Pack Number */}
                      <TableCell className="font-mono text-sm">
                        {typeof pack.pack_number === 'string' ? pack.pack_number : '--'}
                      </TableCell>

                      {/* Return Reason with Badge */}
                      <TableCell>
                        <Badge
                          variant={getReturnReasonVariant(pack.return_reason)}
                          className="text-xs"
                          title={pack.return_notes || undefined}
                        >
                          {getReturnReasonLabel(pack.return_reason)}
                        </Badge>
                      </TableCell>

                      {/* Tickets Sold */}
                      <TableCell className="text-right tabular-nums">
                        {typeof pack.tickets_sold_on_return === 'number'
                          ? pack.tickets_sold_on_return
                          : '--'}
                      </TableCell>

                      {/* Sales Amount */}
                      <TableCell className="text-right tabular-nums font-medium">
                        {typeof pack.return_sales_amount === 'number'
                          ? `$${pack.return_sales_amount.toFixed(2)}`
                          : '--'}
                      </TableCell>

                      {/* Returned - Stacked Date/Time */}
                      <TableCell className="text-sm whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="text-foreground font-medium">
                            {returnedDateTime.date}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {returnedDateTime.time}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
