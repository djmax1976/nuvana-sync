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
 * @module renderer/components/lottery/ActivatedPacksSection
 * @security FE-001: XSS prevention via React JSX auto-escaping
 * @security SEC-004: No dangerouslySetInnerHTML, all output escaped
 * @security SEC-014: Type-safe props with TypeScript interfaces
 * @security API-008: Only whitelisted fields displayed from API response
 */

import { useState, useCallback, useMemo } from 'react';
import { Zap } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SectionIcon, BinBadge, PackSectionHeader } from './SectionPrimitives';
import type { ActivatedPackDay, OpenBusinessPeriod } from '@/lib/api/lottery';
import { useDateFormat } from '@/hooks/useDateFormat';

// ============================================================================
// TYPE DEFINITIONS
// SEC-014: Strict type definitions for component props
// ============================================================================

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
 * SEC-014: Strongly typed output structure
 */
interface ParsedDateTime {
  date: string;
  time: string;
  isValid: boolean;
}

// ============================================================================
// CONSTANTS
// SEC-014: Constrained lookup tables — no user input interpolation
// ============================================================================

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
 * Status display configuration for pack statuses
 * SEC-014: Constrained allowlist with safe defaults
 * SEC-004: Only safe CSS class names
 */
const STATUS_DISPLAY_CONFIG: Readonly<
  Record<
    string,
    Readonly<{
      label: string;
      className: string;
    }>
  >
> = {
  ACTIVE: {
    label: 'Active',
    className:
      'bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800',
  },
  DEPLETED: {
    label: 'Sold Out',
    className:
      'bg-amber-50 text-amber-600 border border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800',
  },
  RETURNED: {
    label: 'Returned',
    className: 'bg-muted text-muted-foreground border border-border',
  },
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getOrdinalSuffix(day: number): string {
  if (!Number.isInteger(day) || day < 1 || day > 31) return 'th';
  return ORDINAL_SUFFIXES[day] || 'th';
}

function createDateTimeParser(
  formatCustom: (date: Date | string, formatStr: string) => string
): (isoString: string) => ParsedDateTime {
  return (isoString: string): ParsedDateTime => {
    if (!isoString || typeof isoString !== 'string') {
      return { date: '--', time: '--', isValid: false };
    }
    const trimmedInput = isoString.trim();
    if (trimmedInput.length === 0) {
      return { date: '--', time: '--', isValid: false };
    }
    try {
      const dateObj = new Date(trimmedInput);
      if (Number.isNaN(dateObj.getTime())) {
        return { date: '--', time: '--', isValid: false };
      }
      const year = dateObj.getFullYear();
      if (year < 2000 || year > 2100) {
        return { date: '--', time: '--', isValid: false };
      }
      const day = parseInt(formatCustom(trimmedInput, 'd'), 10);
      const ordinalSuffix = getOrdinalSuffix(day);
      const monthName = formatCustom(trimmedInput, 'MMM');
      const formattedYear = formatCustom(trimmedInput, 'yyyy');
      const dateString = `${monthName} ${day}${ordinalSuffix}, ${formattedYear}`;
      const timeString = formatCustom(trimmedInput, 'h:mm a');
      return { date: dateString, time: timeString, isValid: true };
    } catch {
      return { date: '--', time: '--', isValid: false };
    }
  };
}

/**
 * Get status display configuration with safe fallback
 * SEC-014: Validates against allowlist with safe default
 */
function getStatusDisplay(
  status: string
): (typeof STATUS_DISPLAY_CONFIG)[keyof typeof STATUS_DISPLAY_CONFIG] {
  return STATUS_DISPLAY_CONFIG[status] ?? STATUS_DISPLAY_CONFIG.ACTIVE;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ActivatedPacksSection({
  activatedPacks,
  openBusinessPeriod,
  defaultOpen = false,
}: ActivatedPacksSectionProps) {
  const { formatCustom } = useDateFormat();
  const parseDateTime = useMemo(() => createDateTimeParser(formatCustom), [formatCustom]);

  const [isOpen, setIsOpen] = useState(defaultOpen);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  // Calculate status counts for subtitle
  const statusCounts = useMemo(() => {
    const counts = { active: 0, depleted: 0, returned: 0 };
    if (!Array.isArray(activatedPacks)) return counts;
    for (const pack of activatedPacks) {
      if (!pack || typeof pack.status !== 'string') continue;
      if (pack.status === 'ACTIVE') counts.active++;
      else if (pack.status === 'DEPLETED') counts.depleted++;
      else if (pack.status === 'RETURNED') counts.returned++;
    }
    return counts;
  }, [activatedPacks]);

  // Build subtitle showing status breakdown
  const subtitle = useMemo(() => {
    const parts: string[] = [];
    if (statusCounts.active > 0) parts.push(`${statusCounts.active} active`);
    if (statusCounts.depleted > 0) parts.push(`${statusCounts.depleted} sold out`);
    if (statusCounts.returned > 0) parts.push(`${statusCounts.returned} returned`);
    return parts.length > 1 ? parts.join(', ') : undefined;
  }, [statusCounts]);

  // SEC-014: Defensive null/undefined check
  if (!activatedPacks || !Array.isArray(activatedPacks) || activatedPacks.length === 0) {
    return null;
  }

  // Section title
  const daysSinceClose = openBusinessPeriod?.days_since_last_close;
  const isMultipleDays =
    daysSinceClose !== null &&
    daysSinceClose !== undefined &&
    typeof daysSinceClose === 'number' &&
    daysSinceClose > 1;

  const sectionTitle = openBusinessPeriod?.is_first_period
    ? 'Activated Packs'
    : isMultipleDays
      ? 'Activated Packs - Current Period'
      : 'Activated Packs';

  return (
    <div
      className="border border-border rounded-lg overflow-hidden"
      data-testid="activated-packs-section"
    >
      <PackSectionHeader
        icon={
          <SectionIcon colorTheme="blue">
            <Zap className="w-4 h-4" />
          </SectionIcon>
        }
        title={sectionTitle}
        count={activatedPacks.length}
        isOpen={isOpen}
        onToggle={toggle}
        subtitle={subtitle}
      />
      {isOpen && (
        <div
          className="overflow-x-auto"
          data-testid="activated-packs-content"
          role="region"
          aria-label="Activated packs table"
        >
          <Table size="compact" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col className="w-[60px] md:w-[70px]" />
              <col />
              <col className="w-[80px] md:w-[95px]" />
              <col className="w-[100px] md:w-[140px]" />
              <col className="w-[60px] md:w-[80px]" />
              <col className="w-[65px] md:w-[90px]" />
              <col className="w-[90px] md:w-[120px]" />
              <col className="w-[110px] md:w-[160px]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="text-center whitespace-nowrap">
                  Bin
                </TableHead>
                <TableHead scope="col">Game</TableHead>
                <TableHead scope="col" className="text-right whitespace-nowrap">
                  Price
                </TableHead>
                <TableHead scope="col" className="whitespace-nowrap">
                  Pack #
                </TableHead>
                <TableHead scope="col" className="text-center whitespace-nowrap">
                  Start
                </TableHead>
                <TableHead scope="col" className="text-center whitespace-nowrap">
                  End
                </TableHead>
                <TableHead scope="col" className="text-center whitespace-nowrap">
                  Status
                </TableHead>
                <TableHead scope="col" className="text-right whitespace-nowrap">
                  Activated
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activatedPacks.map((pack) => {
                // SEC-014: Validate pack object structure
                if (!pack || typeof pack.pack_id !== 'string') {
                  return null;
                }
                const statusConfig = getStatusDisplay(pack.status);
                const parsedDateTime = parseDateTime(pack.activated_at);
                const isDimmed = pack.status !== 'ACTIVE';

                return (
                  <TableRow
                    key={pack.pack_id}
                    data-testid={`activated-pack-row-${pack.pack_id}`}
                    className={`group hover:bg-blue-50 dark:hover:bg-blue-950/30 ${isDimmed ? 'opacity-70' : ''}`}
                  >
                    <TableCell className="text-center border-b border-border/50">
                      <div className="flex justify-center">
                        <BinBadge
                          number={typeof pack.bin_number === 'number' ? pack.bin_number : 0}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-xs sm:text-sm font-semibold text-foreground border-b border-border/50 truncate max-w-[200px]">
                      {typeof pack.game_name === 'string' ? pack.game_name : '--'}
                    </TableCell>
                    <TableCell className="text-right text-xs sm:text-sm font-mono border-b border-border/50 whitespace-nowrap">
                      {typeof pack.game_price === 'number'
                        ? new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: 'USD',
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          }).format(pack.game_price)
                        : '--'}
                    </TableCell>
                    <TableCell className="font-mono text-xs sm:text-sm text-muted-foreground border-b border-border/50 truncate">
                      {typeof pack.pack_number === 'string' ? pack.pack_number : '--'}
                    </TableCell>
                    <TableCell className="font-mono text-xs sm:text-sm text-center border-b border-border/50 whitespace-nowrap">
                      000
                    </TableCell>
                    <TableCell className="font-mono text-xs sm:text-sm text-center border-b border-border/50 whitespace-nowrap">
                      - - -
                    </TableCell>
                    <TableCell className="text-center border-b border-border/50">
                      <span
                        className={`inline-block px-1.5 sm:px-2 py-0.5 rounded-xl text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide ${statusConfig.className}`}
                      >
                        {statusConfig.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-right border-b border-border/50 whitespace-nowrap">
                      <div className="flex flex-col leading-tight items-end">
                        <span className="text-xs text-foreground font-medium">
                          {parsedDateTime.date}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {parsedDateTime.time}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
