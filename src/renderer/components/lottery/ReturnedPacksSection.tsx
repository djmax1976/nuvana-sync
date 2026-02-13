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
 * @module renderer/components/lottery/ReturnedPacksSection
 * @security FE-001: XSS prevention via React JSX auto-escaping
 * @security SEC-004: No dangerouslySetInnerHTML, all output escaped
 * @security SEC-014: Type-safe props with TypeScript interfaces
 * @security API-008: Only whitelisted fields displayed from API response
 */

import { useState, useCallback } from 'react';
import { RotateCcw, AlertTriangle } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SectionIcon, BinBadge, PackSectionHeader } from './SectionPrimitives';
import type { ReturnedPackDay, OpenBusinessPeriod } from '@/lib/api/lottery';
import { useDateFormat } from '@/hooks/useDateFormat';

// ============================================================================
// TYPE DEFINITIONS
// SEC-014: Strict type definitions for component props
// ============================================================================

export interface ReturnedPacksSectionProps {
  /** Returned packs since last day close (enterprise close-to-close model) */
  returnedPacks: ReturnedPackDay[];
  /** Open business period metadata for context display */
  openBusinessPeriod?: OpenBusinessPeriod;
  /** Default open state */
  defaultOpen?: boolean;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ReturnedPacksSection({
  returnedPacks,
  openBusinessPeriod,
  defaultOpen = false,
}: ReturnedPacksSectionProps) {
  const { formatCustom } = useDateFormat();

  const [isOpen, setIsOpen] = useState(defaultOpen);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  // SEC-014: Defensive null/undefined check
  if (!returnedPacks || !Array.isArray(returnedPacks) || returnedPacks.length === 0) {
    return null;
  }

  // Compute total return sales for header badge
  const totalReturnSales = returnedPacks.reduce((sum, pack) => {
    if (typeof pack.return_sales_amount === 'number') {
      return sum + pack.return_sales_amount;
    }
    return sum;
  }, 0);

  // Multi-day warning computation
  const daysSinceClose = openBusinessPeriod?.days_since_last_close;
  const isMultipleDays =
    daysSinceClose !== null &&
    daysSinceClose !== undefined &&
    typeof daysSinceClose === 'number' &&
    daysSinceClose > 1;

  const sectionTitle = openBusinessPeriod?.is_first_period
    ? 'Returned Packs'
    : isMultipleDays
      ? 'Returned Packs - Current Period'
      : 'Returned Packs';

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

      <div
        className="border border-border rounded-lg overflow-hidden"
        data-testid="returned-packs-section"
      >
        <PackSectionHeader
          icon={
            <SectionIcon colorTheme="orange">
              <RotateCcw className="w-4 h-4" />
            </SectionIcon>
          }
          title={sectionTitle}
          count={returnedPacks.length}
          isOpen={isOpen}
          onToggle={toggle}
          rightBadge={
            totalReturnSales > 0 ? (
              <span className="text-sm font-semibold text-foreground">
                {formatCurrency(totalReturnSales)}
              </span>
            ) : undefined
          }
        />
        {isOpen && (
          <div
            className="overflow-x-auto"
            data-testid="returned-packs-content"
            role="region"
            aria-label="Returned packs table"
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
                  <TableHead scope="col">
                    Game
                  </TableHead>
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
                    Sold
                  </TableHead>
                  <TableHead scope="col" className="text-right whitespace-nowrap">
                    Amount
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {returnedPacks.map((pack) => {
                  // SEC-014: Validate pack object structure
                  if (!pack || typeof pack.pack_id !== 'string') {
                    return null;
                  }
                  return (
                    <TableRow
                      key={pack.pack_id}
                      data-testid={`returned-pack-row-${pack.pack_id}`}
                      className="group hover:bg-orange-50 dark:hover:bg-orange-950/30"
                    >
                      <TableCell className="text-center border-b border-border/50">
                        <div className="flex justify-center">
                          <BinBadge number={typeof pack.bin_number === 'number' ? pack.bin_number : 0} />
                        </div>
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm font-semibold text-foreground border-b border-border/50 truncate max-w-[200px]">
                        {typeof pack.game_name === 'string' ? pack.game_name : '--'}
                      </TableCell>
                      <TableCell className="text-right text-xs sm:text-sm font-mono border-b border-border/50 whitespace-nowrap">
                        {typeof pack.game_price === 'number'
                          ? formatCurrency(pack.game_price)
                          : '--'}
                      </TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm text-muted-foreground border-b border-border/50 truncate">
                        {typeof pack.pack_number === 'string' ? pack.pack_number : '--'}
                      </TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm text-center border-b border-border/50 whitespace-nowrap">
                        000
                      </TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm text-center border-b border-border/50 whitespace-nowrap">
                        {typeof pack.last_sold_serial === 'string' && pack.last_sold_serial
                          ? pack.last_sold_serial
                          : '000'}
                      </TableCell>
                      <TableCell className="text-center text-xs sm:text-sm border-b border-border/50 whitespace-nowrap">
                        {typeof pack.tickets_sold_on_return === 'number'
                          ? pack.tickets_sold_on_return
                          : '--'}
                      </TableCell>
                      <TableCell className="text-right text-xs sm:text-sm font-bold border-b border-border/50 whitespace-nowrap">
                        <div className="whitespace-nowrap">
                          {typeof pack.return_sales_amount === 'number'
                            ? formatCurrency(pack.return_sales_amount)
                            : '--'}
                        </div>
                        <div className="flex flex-col leading-tight">
                          <span className="text-[10px] sm:text-[11px] text-muted-foreground font-normal whitespace-nowrap">
                            {(() => {
                              try {
                                return pack.returned_at
                                  ? formatCustom(pack.returned_at, 'MMM d, h:mm a')
                                  : '--';
                              } catch {
                                return '--';
                              }
                            })()}
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
    </div>
  );
}
