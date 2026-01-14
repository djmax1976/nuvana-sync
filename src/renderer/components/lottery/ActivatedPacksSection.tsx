/**
 * Activated Packs Section Component
 *
 * Story: MyStore Lottery Page Redesign
 * Enhancement: Enterprise Close-to-Close Business Day Model
 *
 * Displays activated packs for the current OPEN business period (close-to-close model).
 * Shows bin number, game name, price, pack number, activated datetime, and current status.
 *
 * Enterprise Pattern:
 * - Business day = period from last day close to next day close (not midnight-to-midnight)
 * - Shows ALL packs activated since last closed day, regardless of current status
 * - Includes packs that were activated then depleted (auto-replaced or sold out)
 * - Status badge indicates if pack is still active or has been sold out
 * - Displays warning when multiple calendar days have passed without day close
 * - Always shows full date+time with year since packs can span multiple days
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
 * - FE-005: UI_SECURITY - No sensitive data exposed, safe enum display
 * - API-008: OUTPUT_FILTERING - Only whitelisted fields displayed from API response
 */

import { useState, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ActivatedPackDay, OpenBusinessPeriod } from '@/lib/api/lottery';
import { useDateFormat } from '@/hooks/useDateFormat';

// ============================================================================
// TYPE DEFINITIONS
// MCP: SEC-014 INPUT_VALIDATION - Strict type definitions for component props
// ============================================================================

/**
 * Props for ActivatedPacksSection component
 *
 * MCP Guidance Applied:
 * - SEC-014: INPUT_VALIDATION - Strict type definitions for component props
 * - FE-001: STATE_MANAGEMENT - Immutable data structure for safe consumption
 */
export interface ActivatedPacksSectionProps {
  /** Activated packs since last day close (enterprise close-to-close model) */
  activatedPacks: ActivatedPackDay[];
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
// CONSTANTS - Status Display Configuration
// MCP: SEC-014 INPUT_VALIDATION - Allowlist of valid statuses with safe defaults
// MCP: FE-005 UI_SECURITY - No sensitive data, only display-safe values
// ============================================================================

/**
 * Status display configuration for pack statuses
 * Maps pack status to user-friendly display properties
 */
const STATUS_DISPLAY_CONFIG: Readonly<
  Record<
    string,
    Readonly<{
      label: string;
      shortLabel: string;
      variant: 'default' | 'secondary' | 'outline';
      className: string;
    }>
  >
> = {
  ACTIVE: {
    label: 'Active',
    shortLabel: 'Active',
    variant: 'default',
    className:
      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800',
  },
  DEPLETED: {
    label: 'Sold Out',
    shortLabel: 'Sold',
    variant: 'secondary',
    className:
      'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  },
  RETURNED: {
    label: 'Returned',
    shortLabel: "Ret'd",
    variant: 'outline',
    className:
      'bg-gray-100 text-gray-700 dark:bg-gray-800/30 dark:text-gray-400 border-gray-200 dark:border-gray-700',
  },
} as const;

/**
 * Ordinal suffix lookup for day numbers
 * MCP: SEC-014 INPUT_VALIDATION - Constrained lookup table for safe suffix generation
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
 * Get status display configuration with safe fallback
 * MCP: SEC-014 INPUT_VALIDATION - Validates against allowlist with safe default
 *
 * @param status - Pack status string from API
 * @returns Display configuration for the status badge
 */
function getStatusDisplay(
  status: string
): (typeof STATUS_DISPLAY_CONFIG)[keyof typeof STATUS_DISPLAY_CONFIG] {
  // Validate status against allowlist; default to ACTIVE config for unknown statuses
  // This prevents any injection or unexpected values from causing UI issues
  // eslint-disable-next-line security/detect-object-injection -- Safe: nullish coalescing provides fallback for unknown keys
  return STATUS_DISPLAY_CONFIG[status] ?? STATUS_DISPLAY_CONFIG.ACTIVE;
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
): (isoString: string) => ParsedDateTime {
  return (isoString: string): ParsedDateTime => {
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
      // Extract day for ordinal suffix (formatCustom returns string, need to extract day)
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

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * ActivatedPacksSection component
 * Collapsible section showing packs that were activated during the current open business period.
 * Uses enterprise close-to-close model - shows all packs since last day close, including
 * those that have been subsequently depleted or returned.
 *
 * @example
 * <ActivatedPacksSection
 *   activatedPacks={dayBinsData.activated_packs}
 *   openBusinessPeriod={dayBinsData.open_business_period}
 *   defaultOpen={false}
 * />
 */
export function ActivatedPacksSection({
  activatedPacks,
  openBusinessPeriod,
  defaultOpen = false,
}: ActivatedPacksSectionProps) {
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
  // DERIVED STATE
  // MCP: FE-001 STATE_MANAGEMENT - useMemo for derived state optimization
  // ========================================================================

  // Calculate count of packs by status for header subtitle
  const statusCounts = useMemo(() => {
    const counts = { active: 0, depleted: 0, returned: 0 };

    // SEC-014: Validate activatedPacks is an array before iterating
    if (!Array.isArray(activatedPacks)) {
      return counts;
    }

    for (const pack of activatedPacks) {
      // SEC-014: Validate each pack has a status property
      if (!pack || typeof pack.status !== 'string') {
        continue;
      }

      if (pack.status === 'ACTIVATED') counts.active++;
      else if (pack.status === 'SETTLED') counts.depleted++;
      else if (pack.status === 'RETURNED') counts.returned++;
    }
    return counts;
  }, [activatedPacks]);

  // ========================================================================
  // EARLY RETURN - No data
  // MCP: SEC-014 INPUT_VALIDATION - Defensive null/undefined check
  // ========================================================================
  if (!activatedPacks || !Array.isArray(activatedPacks) || activatedPacks.length === 0) {
    return null;
  }

  // ========================================================================
  // COMPUTED VALUES
  // ========================================================================

  // Determine if multiple days have passed (for title display)
  const daysSinceClose = openBusinessPeriod?.days_since_last_close;
  const isMultipleDays =
    daysSinceClose !== null &&
    daysSinceClose !== undefined &&
    typeof daysSinceClose === 'number' &&
    daysSinceClose > 1;

  // Build the section title based on context
  // MCP: SEC-004 XSS - Only using safe numeric values in string interpolation
  const sectionTitle = openBusinessPeriod?.is_first_period
    ? `Activated Packs (${activatedPacks.length})`
    : isMultipleDays
      ? `Activated Packs - Current Period (${activatedPacks.length})`
      : `Activated Packs Today (${activatedPacks.length})`;

  // Build subtitle showing status breakdown if there are non-active packs
  // MCP: SEC-004 XSS - Safe numeric interpolation only
  const hasNonActivePacks = statusCounts.depleted > 0 || statusCounts.returned > 0;
  const statusSubtitle = hasNonActivePacks
    ? `${statusCounts.active} active${statusCounts.depleted > 0 ? `, ${statusCounts.depleted} sold out` : ''}${statusCounts.returned > 0 ? `, ${statusCounts.returned} returned` : ''}`
    : null;

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={handleOpenChange}
      className="rounded-lg border"
      data-testid="activated-packs-section"
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="w-full flex items-center justify-between p-4 hover:bg-muted/50"
          data-testid="activated-packs-trigger"
          aria-expanded={isOpen}
          aria-controls="activated-packs-content"
        >
          <div className="flex items-center gap-2">
            <Sparkles
              className="h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400"
              aria-hidden="true"
            />
            <div className="flex flex-col items-start">
              <span className="font-medium text-left">{sectionTitle}</span>
              {statusSubtitle && (
                <span className="text-xs text-muted-foreground">{statusSubtitle}</span>
              )}
            </div>
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
          id="activated-packs-content"
          className="border-t overflow-x-auto"
          data-testid="activated-packs-content"
          role="region"
          aria-label="Activated packs table"
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
                <TableHead scope="col" className="w-36 whitespace-nowrap">
                  Activated
                </TableHead>
                <TableHead scope="col" className="w-36 text-center whitespace-nowrap">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activatedPacks.map((pack) => {
                // MCP: SEC-014 INPUT_VALIDATION - Validate pack object structure
                if (!pack || typeof pack.pack_id !== 'string') {
                  return null;
                }

                // MCP: SEC-014 INPUT_VALIDATION - Validate status against allowlist
                const statusConfig = getStatusDisplay(pack.status);

                // Parse datetime for stacked display
                const parsedDateTime = parseDateTime(pack.activated_at);

                return (
                  <TableRow
                    key={pack.pack_id}
                    data-testid={`activated-pack-row-${pack.pack_id}`}
                    className={pack.status === 'SETTLED' ? 'opacity-75' : undefined}
                  >
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

                    {/* Activated - Stacked Date/Time */}
                    <TableCell className="text-sm whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-foreground font-medium">{parsedDateTime.date}</span>
                        <span className="text-muted-foreground text-xs">{parsedDateTime.time}</span>
                      </div>
                    </TableCell>

                    {/* Status Badge */}
                    <TableCell className="text-center">
                      <Badge
                        variant={statusConfig.variant}
                        className={`text-xs whitespace-nowrap px-2 py-0.5 ${statusConfig.className}`}
                        data-testid={`pack-status-${pack.pack_id}`}
                      >
                        {statusConfig.label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
