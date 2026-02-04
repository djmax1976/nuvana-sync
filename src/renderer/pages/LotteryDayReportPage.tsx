/**
 * Lottery Day Report Page
 *
 * Read-only report page showing lottery close data for a specific business day.
 * Navigated to from Reports page via "View Day" button.
 *
 * Layout is an exact replica of lottery_report_ui_aligned.html:
 * - Day info header bar
 * - Main bins table with fixed column widths (table-layout: fixed)
 * - Collapsible pack sections (Returned, Depleted/Sold, Activated)
 * - All tables share identical first-4 column widths for alignment
 *
 * Route: /lottery-day-report?date=YYYY-MM-DD
 *
 * @module renderer/pages/LotteryDayReportPage
 * @security FE-001: XSS prevention via React's automatic escaping
 * @security SEC-014: Type-safe IPC communication
 * @performance PERF-002: useMemo for computed values, useCallback for handlers
 */

import { useMemo, useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, ArrowLeft, ChevronRight } from 'lucide-react';
import { useLotteryDayReport } from '../lib/hooks/useLotteryDayReport';
import { useDateFormat } from '../hooks/useDateFormat';
import type {
  LotteryDayReportBin,
  LotteryDayReportActivatedPack,
  LotteryDayReportDepletedPack,
  LotteryDayReportReturnedPack,
} from '../lib/transport';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Ordinal suffix lookup for day numbers
 * SEC-014: Constrained lookup table for safe display
 */
const ORDINAL_SUFFIXES: Readonly<Record<number, string>> = {
  1: 'st',
  2: 'nd',
  3: 'rd',
  21: 'st',
  22: 'nd',
  23: 'rd',
  31: 'st',
};

/**
 * Status display configuration for activated packs
 * SEC-004: Only safe CSS classes used
 */
const STATUS_CONFIG: Readonly<Record<string, { label: string; className: string }>> = {
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

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/**
 * Day info header bar — single row of metadata about the business day
 */
function DayInfoHeader({
  businessDate,
  dayStatus,
  closedAt,
  lotteryTotal,
  binsCount,
  formatCustom,
}: {
  businessDate: string;
  dayStatus: string | null;
  closedAt: string | null;
  lotteryTotal: number;
  binsCount: number;
  formatCustom: (date: Date | string, fmt: string) => string;
}) {
  // Format the business date for display
  const formattedDate = useMemo(() => {
    try {
      // businessDate is YYYY-MM-DD, parse it properly
      const [year, month, day] = businessDate.split('-').map(Number);
      const dateObj = new Date(year, month - 1, day);
      if (Number.isNaN(dateObj.getTime())) return businessDate;
      const monthName = formatCustom(dateObj, 'MMM');
      const ordinal = getOrdinalSuffix(day);
      return `${monthName} ${day}${ordinal}, ${year}`;
    } catch {
      return businessDate;
    }
  }, [businessDate, formatCustom]);

  const formattedClosedAt = useMemo(() => {
    if (!closedAt) return null;
    try {
      return formatCustom(closedAt, 'h:mm a');
    } catch {
      return null;
    }
  }, [closedAt, formatCustom]);

  return (
    <div
      className="bg-card border border-border rounded-lg px-4 py-3"
      data-testid="day-info-header"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div>
          <span className="text-muted-foreground">Date:</span>{' '}
          <span className="font-semibold">{formattedDate}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Status:</span>{' '}
          <span className="font-semibold">{dayStatus || 'N/A'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Packs Closed:</span>{' '}
          <span className="font-semibold">{binsCount}</span>
        </div>
        {formattedClosedAt && (
          <div>
            <span className="text-muted-foreground">Closed At:</span>{' '}
            <span className="font-medium">{formattedClosedAt}</span>
          </div>
        )}
        <div>
          <span className="text-muted-foreground">Lottery Total:</span>{' '}
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
            {formatCurrency(lotteryTotal)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Shared table styles via CSS custom properties
 * Exact match to mockup: Bin=60px, Game=180px, Price=80px, Pack=130px
 */
const TABLE_CLASS = 'w-full border-collapse';
const TABLE_STYLE: React.CSSProperties = { tableLayout: 'fixed' };

/** Column widths matching the mockup CSS variables */
const COL_BIN = 60;
const COL_GAME = 180;
const COL_PRICE = 80;
const COL_PACK = 130;

function TableColGroup() {
  return (
    <colgroup>
      <col style={{ width: COL_BIN }} />
      <col style={{ width: COL_GAME }} />
      <col style={{ width: COL_PRICE }} />
      <col style={{ width: COL_PACK }} />
      <col />
      <col />
      <col />
      <col />
    </colgroup>
  );
}

/** Standard 8-column header: Bin | Game | Price | Pack# | Starting | Ending | Sold | Amount */
function StandardTableHeader() {
  return (
    <thead className="bg-card border-b border-border">
      <tr>
        <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Bin
        </th>
        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Game
        </th>
        <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Price
        </th>
        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Pack #
        </th>
        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Starting
        </th>
        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Ending
        </th>
        <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Sold
        </th>
        <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Amount
        </th>
      </tr>
    </thead>
  );
}

/** Activated packs header: last 2 columns differ */
function ActivatedTableHeader() {
  return (
    <thead className="bg-muted/50 border-b border-border">
      <tr>
        <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Bin
        </th>
        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Game
        </th>
        <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Price
        </th>
        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Pack #
        </th>
        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Starting
        </th>
        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Ending
        </th>
        <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Status
        </th>
        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Activated
        </th>
      </tr>
    </thead>
  );
}

/**
 * Stacked date/time display matching mockup format
 */
function StackedDateTime({
  isoString,
  formatCustom,
}: {
  isoString: string;
  formatCustom: (date: Date | string, fmt: string) => string;
}) {
  const parsed = useMemo(() => {
    if (!isoString || typeof isoString !== 'string') {
      return { date: '--', time: '--' };
    }
    try {
      const dateObj = new Date(isoString.trim());
      if (Number.isNaN(dateObj.getTime())) return { date: '--', time: '--' };
      const day = parseInt(formatCustom(isoString, 'd'), 10);
      const ordinal = getOrdinalSuffix(day);
      const monthName = formatCustom(isoString, 'MMM');
      const year = formatCustom(isoString, 'yyyy');
      return {
        date: `${monthName} ${day}${ordinal}, ${year}`,
        time: formatCustom(isoString, 'h:mm a'),
      };
    } catch {
      return { date: '--', time: '--' };
    }
  }, [isoString, formatCustom]);

  return (
    <div className="flex flex-col leading-tight">
      <span className="text-xs text-foreground">{parsed.date}</span>
      <span className="text-[11px] text-muted-foreground">{parsed.time}</span>
    </div>
  );
}

/**
 * Main bins table with footer totals
 */
function BinsTable({ bins, lotteryTotal }: { bins: LotteryDayReportBin[]; lotteryTotal: number }) {
  const totalTickets = useMemo(() => bins.reduce((sum, b) => sum + b.tickets_sold, 0), [bins]);

  if (bins.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="font-medium">No bin closings recorded</p>
        <p className="text-sm">No lottery data available for this day.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className={TABLE_CLASS} style={TABLE_STYLE}>
        <TableColGroup />
        <StandardTableHeader />
        <tbody>
          {bins.map((bin, idx) => (
            <tr
              key={`${bin.bin_number}-${bin.pack_number}-${idx}`}
              className="bg-emerald-50/60 dark:bg-emerald-950/20"
            >
              <td className="px-4 py-3 text-center font-mono font-bold text-sm border-b border-border">
                {bin.bin_number}
              </td>
              <td className="px-4 py-3 text-sm border-b border-border truncate">{bin.game_name}</td>
              <td className="px-4 py-3 text-right text-sm border-b border-border">
                {formatCurrency(bin.game_price)}
              </td>
              <td className="px-4 py-3 font-mono text-sm border-b border-border">
                {bin.pack_number}
              </td>
              <td className="px-4 py-3 font-mono text-sm border-b border-border">
                {bin.starting_serial}
              </td>
              <td className="px-4 py-3 font-mono text-sm border-b border-border">
                <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold">
                  <span className="text-emerald-600 dark:text-emerald-400">&#10004;</span>
                  {bin.ending_serial}
                </span>
              </td>
              <td className="px-4 py-3 text-right text-sm border-b border-border">
                {bin.tickets_sold}
              </td>
              <td className="px-4 py-3 text-right text-sm font-semibold text-emerald-600 dark:text-emerald-400 border-b border-border">
                {formatCurrency(bin.sales_amount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} className="px-4 py-3 text-right font-semibold bg-muted border-b-0">
              Total Lottery Sales:
            </td>
            <td className="px-4 py-3 text-right font-semibold bg-muted border-b-0">
              {totalTickets}
            </td>
            <td className="px-4 py-3 text-right text-lg font-semibold text-emerald-600 dark:text-emerald-400 bg-muted border-b-0">
              {formatCurrency(lotteryTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * Collapsible pack section header — clickable to expand/collapse
 */
function PackSectionHeader({
  icon,
  title,
  count,
  isOpen,
  onToggle,
  rightBadge,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  rightBadge?: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <button
      type="button"
      className="flex items-center justify-between w-full bg-muted px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted/80 transition-colors"
      onClick={onToggle}
      aria-expanded={isOpen}
    >
      <div className="flex items-center gap-2.5">
        <ChevronRight
          className={`h-3 w-3 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`}
        />
        <span className="text-lg">{icon}</span>
        <span>
          {title} ({count})
        </span>
        {subtitle && (
          <span className="text-xs font-normal text-muted-foreground ml-1">{subtitle}</span>
        )}
      </div>
      {rightBadge && <div className="flex items-center gap-3 text-[13px]">{rightBadge}</div>}
    </button>
  );
}

/**
 * Returned Packs section — collapsible table
 */
function ReturnedPacksSection({
  packs,
  formatCustom,
}: {
  packs: LotteryDayReportReturnedPack[];
  formatCustom: (date: Date | string, fmt: string) => string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  const totalSales = useMemo(() => packs.reduce((sum, p) => sum + p.sales_amount, 0), [packs]);

  if (packs.length === 0) return null;

  return (
    <div className="border-t border-border" data-testid="returned-packs-section">
      <PackSectionHeader
        icon="↩"
        title="Returned Packs"
        count={packs.length}
        isOpen={isOpen}
        onToggle={toggle}
        rightBadge={
          <span className="px-2.5 py-0.5 rounded-xl text-[13px] font-semibold bg-amber-50 text-amber-600 border border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800">
            Return Sales: {formatCurrency(totalSales)}
          </span>
        }
      />
      {isOpen && (
        <div className="overflow-x-auto">
          <table className={TABLE_CLASS} style={TABLE_STYLE}>
            <TableColGroup />
            <StandardTableHeader />
            <tbody>
              {packs.map((pack) => (
                <tr key={pack.pack_id}>
                  <td className="px-4 py-3 text-center font-mono text-sm border-b border-border">
                    {pack.bin_number}
                  </td>
                  <td className="px-4 py-3 text-sm border-b border-border truncate">
                    {pack.game_name}
                  </td>
                  <td className="px-4 py-3 text-right text-sm border-b border-border">
                    {formatCurrency(pack.game_price)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs border-b border-border">
                    {pack.pack_number}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm border-b border-border">
                    {pack.starting_serial}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm border-b border-border">
                    {pack.ending_serial}
                  </td>
                  <td className="px-4 py-3 text-right text-sm border-b border-border">
                    {pack.tickets_sold}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold border-b border-border">
                    <div>{formatCurrency(pack.sales_amount)}</div>
                    <div className="flex flex-col leading-tight">
                      <span className="text-[11px] text-muted-foreground">
                        {(() => {
                          try {
                            return formatCustom(pack.returned_at, 'MMM d, h:mm a');
                          } catch {
                            return '--';
                          }
                        })()}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Depleted (Packs Sold) section — collapsible table
 */
function DepletedPacksSection({
  packs,
  formatCustom,
}: {
  packs: LotteryDayReportDepletedPack[];
  formatCustom: (date: Date | string, fmt: string) => string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  const totalSales = useMemo(() => packs.reduce((sum, p) => sum + p.sales_amount, 0), [packs]);

  if (packs.length === 0) return null;

  return (
    <div className="border-t border-border" data-testid="depleted-packs-section">
      <PackSectionHeader
        icon="📦"
        title="Packs Sold"
        count={packs.length}
        isOpen={isOpen}
        onToggle={toggle}
        rightBadge={
          <span className="px-2.5 py-0.5 rounded-xl text-[13px] font-semibold bg-amber-50 text-amber-600 border border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800">
            Sold Sales: {formatCurrency(totalSales)}
          </span>
        }
      />
      {isOpen && (
        <div className="overflow-x-auto">
          <table className={TABLE_CLASS} style={TABLE_STYLE}>
            <TableColGroup />
            <StandardTableHeader />
            <tbody>
              {packs.map((pack) => (
                <tr key={pack.pack_id}>
                  <td className="px-4 py-3 text-center font-mono text-sm border-b border-border">
                    {pack.bin_number}
                  </td>
                  <td className="px-4 py-3 text-sm border-b border-border truncate">
                    {pack.game_name}
                  </td>
                  <td className="px-4 py-3 text-right text-sm border-b border-border">
                    {formatCurrency(pack.game_price)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs border-b border-border">
                    {pack.pack_number}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm border-b border-border">
                    {pack.starting_serial}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm border-b border-border">
                    {pack.ending_serial}
                  </td>
                  <td className="px-4 py-3 text-right text-sm border-b border-border">
                    {pack.tickets_sold}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold border-b border-border">
                    <div>{formatCurrency(pack.sales_amount)}</div>
                    <div className="flex flex-col leading-tight">
                      <span className="text-[11px] text-muted-foreground">
                        {(() => {
                          try {
                            return formatCustom(pack.depleted_at, 'MMM d, h:mm a');
                          } catch {
                            return '--';
                          }
                        })()}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Activated Packs section — collapsible table with status badges
 * Dimmed rows for non-ACTIVE statuses
 */
function ActivatedPacksSection({
  packs,
  formatCustom,
}: {
  packs: LotteryDayReportActivatedPack[];
  formatCustom: (date: Date | string, fmt: string) => string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  const statusCounts = useMemo(() => {
    const counts = { active: 0, depleted: 0, returned: 0 };
    for (const pack of packs) {
      if (pack.status === 'ACTIVE') counts.active++;
      else if (pack.status === 'DEPLETED') counts.depleted++;
      else if (pack.status === 'RETURNED') counts.returned++;
    }
    return counts;
  }, [packs]);

  const subtitle = useMemo(() => {
    const parts: string[] = [];
    if (statusCounts.active > 0) parts.push(`${statusCounts.active} active`);
    if (statusCounts.depleted > 0) parts.push(`${statusCounts.depleted} sold out`);
    if (statusCounts.returned > 0) parts.push(`${statusCounts.returned} returned`);
    return parts.length > 1 ? parts.join(', ') : undefined;
  }, [statusCounts]);

  if (packs.length === 0) return null;

  return (
    <div className="border-t border-border" data-testid="activated-packs-section">
      <PackSectionHeader
        icon={<span className="text-emerald-600 dark:text-emerald-400">&#10024;</span>}
        title="Activated Packs"
        count={packs.length}
        isOpen={isOpen}
        onToggle={toggle}
        subtitle={subtitle}
      />
      {isOpen && (
        <div className="overflow-x-auto">
          <table className={TABLE_CLASS} style={TABLE_STYLE}>
            <TableColGroup />
            <ActivatedTableHeader />
            <tbody>
              {packs.map((pack) => {
                const isDimmed = pack.status !== 'ACTIVE';
                const config = STATUS_CONFIG[pack.status] || STATUS_CONFIG.ACTIVE;

                return (
                  <tr key={pack.pack_id} className={isDimmed ? 'opacity-70' : ''}>
                    <td className="px-4 py-3 text-center font-mono text-sm border-b border-border">
                      {pack.bin_number}
                    </td>
                    <td className="px-4 py-3 text-sm border-b border-border truncate">
                      {pack.game_name}
                    </td>
                    <td className="px-4 py-3 text-right text-sm border-b border-border">
                      {formatCurrency(pack.game_price)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs border-b border-border">
                      {pack.pack_number}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm border-b border-border">000</td>
                    <td className="px-4 py-3 font-mono text-sm border-b border-border">---</td>
                    <td className="px-4 py-3 text-center border-b border-border">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-xl text-[11px] font-semibold uppercase tracking-wide ${config.className}`}
                      >
                        {config.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 border-b border-border">
                      <StackedDateTime isoString={pack.activated_at} formatCustom={formatCustom} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN PAGE COMPONENT
// ============================================================================

export default function LotteryDayReportPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { formatCustom } = useDateFormat();

  const businessDate = searchParams.get('date') || '';

  const { data, isLoading, isError, error } = useLotteryDayReport({ businessDate });

  const handleBack = useCallback(() => {
    navigate('/reports');
  }, [navigate]);

  // ========================================================================
  // Loading state
  // ========================================================================
  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center min-h-[400px]"
        data-testid="lottery-report-loading"
      >
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading lottery report...</p>
        </div>
      </div>
    );
  }

  // ========================================================================
  // Error state
  // ========================================================================
  if (isError || !businessDate) {
    return (
      <div className="max-w-[1200px] mx-auto p-6" data-testid="lottery-report-error">
        <div className="rounded-lg bg-card border border-destructive p-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p>{error?.message || 'Invalid or missing date parameter.'}</p>
          </div>
          <button
            type="button"
            onClick={handleBack}
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Reports
          </button>
        </div>
      </div>
    );
  }

  // ========================================================================
  // No data state
  // ========================================================================
  if (!data || (data.dayStatus === null && data.bins.length === 0)) {
    return (
      <div className="max-w-[1200px] mx-auto p-6 space-y-6" data-testid="lottery-report-empty">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Reports
        </button>
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-2xl opacity-50 mb-2">&#128202;</p>
          <p className="font-medium">No lottery data for this date</p>
          <p className="text-sm">No business day record found for {businessDate}.</p>
        </div>
      </div>
    );
  }

  // ========================================================================
  // Main render — exact mockup replica
  // ========================================================================
  return (
    <div className="max-w-[1200px] mx-auto p-6 space-y-6" data-testid="lottery-day-report">
      {/* Back button */}
      <button
        type="button"
        onClick={handleBack}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Reports
      </button>

      {/* Day Info Header */}
      <DayInfoHeader
        businessDate={data.businessDate}
        dayStatus={data.dayStatus}
        closedAt={data.closedAt}
        lotteryTotal={data.lotteryTotal}
        binsCount={data.bins.length}
        formatCustom={formatCustom}
      />

      {/* Main Scanner Card — bins table + pack sections */}
      <div
        className="bg-card border border-border rounded-lg overflow-hidden min-h-[400px] flex flex-col"
        data-testid="lottery-report-card"
      >
        {/* Bins Table */}
        <BinsTable bins={data.bins} lotteryTotal={data.lotteryTotal} />

        {/* Pack Sections */}
        {(data.returnedPacks.length > 0 ||
          data.depletedPacks.length > 0 ||
          data.activatedPacks.length > 0) && (
          <div className="mt-3">
            <ReturnedPacksSection packs={data.returnedPacks} formatCustom={formatCustom} />
            <DepletedPacksSection packs={data.depletedPacks} formatCustom={formatCustom} />
            <ActivatedPacksSection packs={data.activatedPacks} formatCustom={formatCustom} />
          </div>
        )}
      </div>
    </div>
  );
}
