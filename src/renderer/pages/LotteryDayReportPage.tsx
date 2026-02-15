/**
 * Lottery Day Report Page
 *
 * Read-only report page showing lottery close data for a specific business day.
 * Navigated to from Reports page via "View Day" button.
 *
 * Layout Features:
 * - Full-width gradient hero header with date, totals, and breakdown cards
 * - Responsive tables with auto layout (no fixed minWidth)
 * - Collapsible pack sections (Returned, Depleted/Sold, Activated)
 * - Responsive breakpoints: sm (640px), md (768px), lg (1024px)
 * - Max content width: 1600px for ultrawide screens
 *
 * Responsive Design:
 * - Tables shrink on mobile with responsive padding (px-2/px-3/px-5)
 * - Text sizes adapt (text-xs on mobile, text-sm on tablet+)
 * - Hero header stacks vertically on mobile, horizontal on md+
 * - Breakdown cards use flex-wrap with responsive min/max widths
 *
 * Route: /lottery-day-report?date=YYYY-MM-DD
 *
 * @module renderer/pages/LotteryDayReportPage
 * @security FE-001: XSS prevention via React's automatic JSX escaping
 * @security SEC-004: No dangerouslySetInnerHTML, all output escaped
 * @security API-008: Only whitelisted fields displayed from API response
 * @security SEC-014: Type-safe IPC communication
 * @performance PERF-002: useMemo for computed values, useCallback for handlers
 */

import { useMemo, useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Loader2,
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  RotateCcw,
  Package,
  Zap,
} from 'lucide-react';
import { useLotteryDayReport } from '../lib/hooks/useLotteryDayReport';
import { useDateFormat } from '../hooks/useDateFormat';
import type {
  LotteryDayReportBin,
  LotteryDayReportActivatedPack,
  LotteryDayReportDepletedPack,
  LotteryDayReportReturnedPack,
  DayClosingSession,
} from '../lib/transport';
import { Clock } from 'lucide-react';

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

/**
 * Returns ordinal label for closing session numbers: 1→"1st", 2→"2nd", etc.
 * SEC-014: Only numeric input, output is a safe string via lookup table
 */
function getClosingOrdinal(n: number): string {
  if (!Number.isInteger(n) || n < 1) return `${n}th`;
  const suffix = ORDINAL_SUFFIXES[n] || 'th';
  return `${n}${suffix}`;
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
 * Breakdown card for sales category display
 * SEC-004: Only numeric values rendered, no HTML injection possible
 */
function BreakdownCard({
  label,
  value,
  colorClass,
  isEmpty = false,
}: {
  label: string;
  value: number;
  colorClass: 'blue' | 'violet' | 'orange';
  isEmpty?: boolean;
}) {
  const dotColors = {
    blue: 'bg-blue-500',
    violet: 'bg-violet-500',
    orange: 'bg-orange-500',
  };

  return (
    <div
      className={`bg-white/95 dark:bg-slate-800/95 rounded-xl px-3 sm:px-4 py-2 sm:py-3 flex-1 min-w-[100px] sm:min-w-[120px] max-w-[160px] flex items-center gap-2 sm:gap-3 shadow-md ${
        isEmpty ? 'opacity-60' : ''
      }`}
    >
      <span
        className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full flex-shrink-0 ${dotColors[colorClass]}`}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wide truncate">
          {label}
        </div>
        <div
          className={`text-sm sm:text-base font-bold truncate ${isEmpty ? 'text-muted-foreground' : 'text-foreground'}`}
        >
          {formatCurrency(value)}
        </div>
      </div>
    </div>
  );
}

/**
 * Hero header — full-width gradient banner with date, totals, and breakdown cards
 * SEC-004: All values are numeric or pre-formatted strings, JSX auto-escapes
 * API-008: Only whitelisted fields (date, totals) displayed
 *
 * Total Sales = Bin Sales + Pack Sales (depleted) + Return Sales
 * Cards for Pack Sales and Return Sales are only shown when values > 0
 */
function HeroHeader({
  businessDate,
  binsCount,
  binSales,
  packSales,
  returnSales,
  totalTickets,
  formatCustom,
}: {
  businessDate: string;
  binsCount: number;
  binSales: number;
  packSales: number;
  returnSales: number;
  totalTickets: number;
  formatCustom: (date: Date | string, fmt: string) => string;
}) {
  // Calculate total sales as sum of all categories
  // Total = Bin Sales + Pack Sales (depleted) + Return Pack Sales
  const totalSales = useMemo(
    () => binSales + packSales + returnSales,
    [binSales, packSales, returnSales]
  );

  // Parse date components for display
  // SEC-014: Input validated as YYYY-MM-DD format string
  const dateInfo = useMemo(() => {
    try {
      const parts = businessDate.split('-');
      if (parts.length !== 3) {
        return { day: '--', ordinal: '', weekday: '--', monthYear: businessDate };
      }
      const [yearStr, monthStr, dayStr] = parts;
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);
      const day = parseInt(dayStr, 10);

      if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
        return { day: '--', ordinal: '', weekday: '--', monthYear: businessDate };
      }

      const dateObj = new Date(year, month - 1, day);
      if (Number.isNaN(dateObj.getTime())) {
        return { day: '--', ordinal: '', weekday: '--', monthYear: businessDate };
      }

      const weekday = formatCustom(dateObj, 'EEEE');
      const monthName = formatCustom(dateObj, 'MMMM');

      return {
        day: String(day),
        ordinal: getOrdinalSuffix(day),
        weekday,
        monthYear: `${monthName} ${year}`,
      };
    } catch {
      return { day: '--', ordinal: '', weekday: '--', monthYear: businessDate };
    }
  }, [businessDate, formatCustom]);

  return (
    <div
      className="relative bg-gradient-to-br from-blue-600 to-blue-500 dark:from-blue-700 dark:to-blue-600 px-4 sm:px-6 lg:px-10 py-4 sm:py-6 lg:py-7 overflow-hidden"
      data-testid="hero-header"
    >
      {/* Background decorative element - hidden on mobile for performance */}
      <div className="hidden sm:block absolute -top-1/2 -right-[10%] w-[300px] md:w-[400px] lg:w-[500px] h-[300px] md:h-[400px] lg:h-[500px] bg-[radial-gradient(circle,rgba(255,255,255,0.08)_0%,transparent_70%)] pointer-events-none" />

      <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4 md:gap-6">
        {/* Left side: Date + Total */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 md:gap-8">
          {/* Date Section */}
          <div className="flex items-center gap-3 sm:gap-4 sm:pr-6 md:pr-8 sm:border-r sm:border-white/20">
            <span className="text-3xl sm:text-4xl md:text-5xl font-bold text-white leading-none">
              {dateInfo.day}
              <sup className="text-base sm:text-lg md:text-xl font-semibold">
                {dateInfo.ordinal}
              </sup>
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-white/90">
                {dateInfo.weekday}
              </span>
              <span className="text-xs sm:text-sm text-white/80">{dateInfo.monthYear}</span>
            </div>
          </div>

          {/* Total Section */}
          <div className="flex flex-col">
            <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-widest text-white/85">
              Total Lottery Sales
            </span>
            <span className="text-2xl sm:text-3xl md:text-4xl font-bold text-white tracking-tight">
              {formatCurrency(totalSales)}
            </span>
            <span className="text-[10px] sm:text-xs text-white/80 mt-0.5">
              {totalTickets} tickets sold across {binsCount} packs
            </span>
          </div>
        </div>

        {/* Right side: Breakdown Cards - responsive grid on mobile */}
        <div className="flex flex-wrap gap-2 sm:gap-3">
          <BreakdownCard label="Bin Sales" value={binSales} colorClass="blue" />
          {packSales > 0 && (
            <BreakdownCard label="Pack Sales" value={packSales} colorClass="violet" />
          )}
          {returnSales > 0 && (
            <BreakdownCard label="Return Sales" value={returnSales} colorClass="orange" />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Shared table styles - responsive layout
 * Tables use auto layout on mobile for natural sizing, fixed on larger screens
 * No minimum width constraint to allow responsive behavior
 */
const TABLE_CLASS = 'w-full border-collapse';
const TABLE_STYLE: React.CSSProperties = { tableLayout: 'fixed' };

function TableColGroup() {
  // Fixed column widths — shared across all 4 tables for vertical alignment
  // Game column takes remaining space; all others have explicit widths
  // Col 7 must fit "RETURNED"/"SOLD OUT" badges (Activated) and numbers (Bins/Returned/Depleted)
  // Col 8 must fit stacked date/time (Activated) and currency amounts (Bins/Returned/Depleted)
  return (
    <colgroup>
      <col className="w-[60px] md:w-[70px]" /> {/* Bin */}
      <col /> {/* Game — remaining space */}
      <col className="w-[80px] md:w-[95px]" /> {/* Price */}
      <col className="w-[100px] md:w-[140px]" /> {/* Pack # */}
      <col className="w-[60px] md:w-[80px]" /> {/* Start */}
      <col className="w-[65px] md:w-[90px]" /> {/* End */}
      <col className="w-[90px] md:w-[120px]" /> {/* Sold / Status */}
      <col className="w-[110px] md:w-[160px]" /> {/* Amount / Activated */}
    </colgroup>
  );
}

/** Standard 8-column header: Bin | Game | Price | Pack# | Starting | Ending | Sold | Amount */
function StandardTableHeader() {
  return (
    <thead className="bg-card border-b border-border">
      <tr>
        <th className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-center text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
          Bin
        </th>
        <th className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-left text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Game
        </th>
        <th className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-right text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
          Price
        </th>
        <th className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-left text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
          Pack #
        </th>
        <th className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-left text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
          Start
        </th>
        <th className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-left text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
          End
        </th>
        <th className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-center text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
          Sold
        </th>
        <th className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-right text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
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
        <th className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-center text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
          Bin
        </th>
        <th className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-left text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Game
        </th>
        <th className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-right text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
          Price
        </th>
        <th className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-left text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
          Pack #
        </th>
        <th className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-left text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
          Start
        </th>
        <th className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-left text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
          End
        </th>
        <th className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-center text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
          Status
        </th>
        <th className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-right text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
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
 * Bin number badge with hover effect
 * SEC-004: Only numeric value rendered
 * Sizing: 40x40px to match HTML mockup exactly
 */
function BinBadge({ number }: { number: number }) {
  return (
    <span className="rounded-lg sm:rounded-[10px] bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-bold text-[13px] sm:text-[15px] flex items-center justify-center transition-all group-hover:bg-blue-500 group-hover:text-white group-hover:scale-105 w-8 h-8 sm:w-10 sm:h-10 min-w-[32px] sm:min-w-[40px]">
      {number}
    </span>
  );
}

/**
 * Main bins table with footer totals
 * SEC-004: All values rendered via JSX auto-escaping
 * API-008: Only whitelisted fields displayed
 */
function BinsTable({ bins }: { bins: LotteryDayReportBin[] }) {
  const totalTickets = useMemo(() => bins.reduce((sum, b) => sum + b.tickets_sold, 0), [bins]);
  const totalBinSales = useMemo(() => bins.reduce((sum, b) => sum + b.sales_amount, 0), [bins]);

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
        <thead className="bg-muted/50">
          <tr>
            <th className="px-2 sm:px-3 lg:px-5 py-2.5 sm:py-3.5 text-center text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
              Bin
            </th>
            <th className="px-2 sm:px-3 lg:px-5 py-2.5 sm:py-3.5 text-left text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Game
            </th>
            <th className="px-2 sm:px-3 lg:px-5 py-2.5 sm:py-3.5 text-right text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
              Price
            </th>
            <th className="px-2 sm:px-3 lg:px-5 py-2.5 sm:py-3.5 text-left text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
              Pack #
            </th>
            <th className="px-2 sm:px-3 lg:px-5 py-2.5 sm:py-3.5 text-center text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
              Start
            </th>
            <th className="px-2 sm:px-3 lg:px-5 py-2.5 sm:py-3.5 text-center text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
              End
            </th>
            <th className="px-2 sm:px-3 lg:px-5 py-2.5 sm:py-3.5 text-center text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
              Sold
            </th>
            <th className="px-2 sm:px-3 lg:px-5 py-2.5 sm:py-3.5 text-right text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {bins.map((bin, idx) => (
            <tr
              key={`${bin.bin_number}-${bin.pack_number}-${idx}`}
              className="group hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
            >
              <td className="px-2 sm:px-3 lg:px-5 py-2 sm:py-3 lg:py-4 border-b border-border/50">
                <div className="flex justify-center">
                  <BinBadge number={bin.bin_number} />
                </div>
              </td>
              <td className="px-2 sm:px-3 lg:px-5 py-2 sm:py-3 lg:py-4 text-xs sm:text-sm font-semibold text-foreground border-b border-border/50 truncate max-w-[100px] sm:max-w-[150px] lg:max-w-none">
                {bin.game_name}
              </td>
              <td className="px-2 sm:px-3 lg:px-5 py-2 sm:py-3 lg:py-4 text-right text-xs sm:text-sm font-mono border-b border-border/50 whitespace-nowrap">
                {formatCurrency(bin.game_price)}
              </td>
              <td className="px-2 sm:px-3 lg:px-5 py-2 sm:py-3 lg:py-4 font-mono text-xs sm:text-sm text-muted-foreground border-b border-border/50 truncate">
                {bin.pack_number}
              </td>
              <td className="px-2 sm:px-3 lg:px-5 py-2 sm:py-3 lg:py-4 font-mono text-xs sm:text-sm text-center border-b border-border/50 whitespace-nowrap">
                {bin.starting_serial}
              </td>
              <td className="px-2 sm:px-3 lg:px-5 py-2 sm:py-3 lg:py-4 text-center border-b border-border/50">
                <span className="inline-flex items-center gap-0.5 sm:gap-1 text-blue-600 dark:text-blue-400 font-bold font-mono text-xs sm:text-sm">
                  <svg
                    className="w-3 h-3 sm:w-3.5 sm:h-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {bin.ending_serial}
                </span>
              </td>
              <td className="px-2 sm:px-3 lg:px-5 py-2 sm:py-3 lg:py-4 text-center text-xs sm:text-sm border-b border-border/50 whitespace-nowrap">
                {bin.tickets_sold}
              </td>
              <td className="px-2 sm:px-3 lg:px-5 py-2 sm:py-3 lg:py-4 text-right text-xs sm:text-sm font-bold text-blue-600 dark:text-blue-400 border-b border-border/50 whitespace-nowrap">
                {formatCurrency(bin.sales_amount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-muted/50">
            <td
              colSpan={6}
              className="px-2 sm:px-3 lg:px-5 py-2.5 sm:py-4 text-right text-xs sm:text-sm font-semibold text-muted-foreground"
            >
              Bin Sales Total:
            </td>
            <td className="px-2 sm:px-3 lg:px-5 py-2.5 sm:py-4 text-center text-xs sm:text-sm font-semibold whitespace-nowrap">
              {totalTickets}
            </td>
            <td className="px-2 sm:px-3 lg:px-5 py-2.5 sm:py-4 text-right text-base sm:text-lg lg:text-xl font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap">
              {formatCurrency(totalBinSales)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * Section icon container with color theme
 * SEC-004: Only safe CSS class names used
 */
function SectionIcon({
  colorTheme,
  children,
}: {
  colorTheme: 'orange' | 'violet' | 'blue';
  children: React.ReactNode;
}) {
  const themeClasses = {
    orange: 'bg-orange-100 dark:bg-orange-950 text-orange-600 dark:text-orange-400',
    violet: 'bg-violet-100 dark:bg-violet-950 text-violet-600 dark:text-violet-400',
    blue: 'bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400',
  };

  return (
    <span
      className={`w-10 h-10 rounded-[10px] flex items-center justify-center flex-shrink-0 ${themeClasses[colorTheme]}`}
    >
      {children}
    </span>
  );
}

// ============================================================================
// MULTI-CLOSING SESSION COMPONENTS
// ============================================================================

/**
 * Session tab for selecting individual closing sessions
 * SEC-004: All values rendered via JSX auto-escaping
 * Displays ordinal label only (1st, 2nd, 3rd, etc.)
 */
function SessionTab({
  session,
  isActive,
  onClick,
}: {
  session: DayClosingSession;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-md sm:rounded-lg text-[11px] sm:text-[13px] font-semibold transition-all border ${
        isActive
          ? 'bg-blue-500 text-white border-blue-500'
          : 'bg-card text-muted-foreground border-border hover:bg-muted hover:text-foreground'
      }`}
    >
      {getClosingOrdinal(session.closingNumber)}
    </button>
  );
}

/**
 * Multi-closing sessions banner — shown when totalClosings > 1
 * Merged component: combines session selection tabs with session details grid.
 * SEC-004: No HTML injection, all values JSX-escaped
 * API-008: Only whitelisted fields (times, sales) displayed
 *
 * Layout:
 *   Top row: icon + "Multiple Day Closings" | [Combined] [1st] [2nd] ...
 *   Bottom row: DAY CLOSE | Day Started/Opened At | Final Close/Closed At | Total Sales/Sales
 *
 * Responsive: tabs wrap below label on narrow screens (flex-wrap)
 */
function MultiClosingBanner({
  sessions,
  selectedSession,
  selectedSessionData,
  onSelectSession,
  onSelectCombined,
  isCombinedView,
  formatCustom,
  hasMultipleClosings,
}: {
  sessions: DayClosingSession[];
  selectedSession: number;
  selectedSessionData: DayClosingSession | null;
  onSelectSession: (sessionNumber: number) => void;
  onSelectCombined: () => void;
  isCombinedView: boolean;
  formatCustom: (date: Date | string, fmt: string) => string;
  hasMultipleClosings: boolean;
}) {
  // SEC-004: Format pattern is static, no user input injection possible
  const formatTime = useCallback(
    (isoString: string | null): string => {
      if (!isoString) return '--';
      try {
        const formatPattern = hasMultipleClosings ? 'MMM d, h:mm a' : 'h:mm a';
        return formatCustom(isoString, formatPattern);
      } catch {
        return '--';
      }
    },
    [formatCustom, hasMultipleClosings]
  );

  // Compute display data for the details grid
  const displayData = useMemo(() => {
    if (isCombinedView) {
      const firstSession = sessions[0];
      const lastSession = sessions[sessions.length - 1];
      const totalSales = sessions.reduce((sum, s) => sum + s.totalSales, 0);
      return {
        label: 'Combined',
        openedAt: formatTime(firstSession?.openedAt ?? null),
        closedAt: formatTime(lastSession?.closedAt ?? null),
        sales: totalSales,
        openLabel: 'Day Started',
        closeLabel: 'Final Close',
        salesLabel: 'Total Sales',
      };
    }
    return {
      label: getClosingOrdinal(selectedSessionData?.closingNumber ?? selectedSession),
      openedAt: formatTime(selectedSessionData?.openedAt ?? null),
      closedAt: formatTime(selectedSessionData?.closedAt ?? null),
      sales: selectedSessionData?.totalSales ?? 0,
      openLabel: 'Opened At',
      closeLabel: 'Closed At',
      salesLabel: 'Sales',
    };
  }, [isCombinedView, sessions, selectedSessionData, selectedSession, formatTime]);

  return (
    <div className="bg-gradient-to-r from-amber-50 to-amber-100 dark:from-amber-950/50 dark:to-amber-900/30 border border-amber-400 dark:border-amber-700 rounded-lg sm:rounded-xl p-3 sm:p-4 mb-4 sm:mb-6">
      {/* Top row: info label + session tabs */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 sm:gap-4">
        {/* Info Section */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-amber-400 dark:bg-amber-600 rounded-lg sm:rounded-[10px] flex items-center justify-center text-white flex-shrink-0">
            <Clock className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
          <h4 className="text-xs sm:text-sm font-bold text-foreground">Multiple Day Closings</h4>
        </div>

        {/* Combined button + Session Tabs */}
        <div className="flex flex-wrap gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={onSelectCombined}
            className={`px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-md sm:rounded-lg text-[11px] sm:text-[13px] font-semibold transition-all border ${
              isCombinedView
                ? 'bg-blue-500 text-white border-blue-500'
                : 'bg-card text-muted-foreground border-border hover:bg-muted hover:text-foreground'
            }`}
          >
            Combined
          </button>
          {sessions.map((session) => (
            <SessionTab
              key={session.closingNumber}
              session={session}
              isActive={!isCombinedView && selectedSession === session.closingNumber}
              onClick={() => onSelectSession(session.closingNumber)}
            />
          ))}
        </div>
      </div>

      {/* Details grid — merged from SessionDetailsCard */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6 mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-amber-200 dark:border-amber-800">
        <div className="flex flex-col gap-0.5 sm:gap-1">
          <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Day Close
          </span>
          <span className="text-base sm:text-lg font-bold text-foreground">
            {displayData.label}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 sm:gap-1">
          <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {displayData.openLabel}
          </span>
          <span className="text-xs sm:text-sm font-mono font-bold text-foreground">
            {displayData.openedAt}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 sm:gap-1">
          <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {displayData.closeLabel}
          </span>
          <span className="text-xs sm:text-sm font-mono font-bold text-foreground">
            {displayData.closedAt}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 sm:gap-1">
          <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {displayData.salesLabel}
          </span>
          <span className="text-base sm:text-lg font-bold text-blue-600 dark:text-blue-400">
            {formatCurrency(displayData.sales)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Collapsible pack section header — clickable to expand/collapse
 * SEC-004: No user input rendered as HTML, all values JSX-escaped
 */
function PackSectionHeader({
  icon,
  title,
  count,
  isOpen,
  onToggle,
  rightBadge,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  rightBadge?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="flex items-center justify-between w-full bg-card hover:bg-muted/50 px-4 py-4 text-sm font-semibold text-foreground transition-colors border-b border-border"
      onClick={onToggle}
      aria-expanded={isOpen}
    >
      <div className="flex items-center gap-3">
        {icon}
        <span className="font-semibold">
          {title} ({count})
        </span>
      </div>
      <div className="flex items-center gap-3">
        {rightBadge}
        <ChevronRight
          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
        />
      </div>
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
        title="Returned Packs"
        count={packs.length}
        isOpen={isOpen}
        onToggle={toggle}
        rightBadge={
          <span className="text-sm font-semibold text-foreground">
            {formatCurrency(totalSales)}
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
                <tr key={pack.pack_id} className="group">
                  <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 border-b border-border">
                    <div className="flex justify-center">
                      <BinBadge number={pack.bin_number} />
                    </div>
                  </td>
                  <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-xs sm:text-sm border-b border-border truncate max-w-[80px] sm:max-w-[120px] lg:max-w-none">
                    {pack.game_name}
                  </td>
                  <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-right text-xs sm:text-sm border-b border-border whitespace-nowrap">
                    {formatCurrency(pack.game_price)}
                  </td>
                  <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 font-mono text-[10px] sm:text-xs border-b border-border truncate">
                    {pack.pack_number}
                  </td>
                  <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 font-mono text-xs sm:text-sm border-b border-border whitespace-nowrap">
                    {pack.starting_serial}
                  </td>
                  <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 font-mono text-xs sm:text-sm border-b border-border whitespace-nowrap">
                    {pack.ending_serial}
                  </td>
                  <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-center text-xs sm:text-sm border-b border-border whitespace-nowrap">
                    {pack.tickets_sold}
                  </td>
                  <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-right text-xs sm:text-sm font-bold border-b border-border">
                    <div className="whitespace-nowrap">{formatCurrency(pack.sales_amount)}</div>
                    <div className="flex flex-col leading-tight">
                      <span className="text-[10px] sm:text-[11px] text-muted-foreground whitespace-nowrap">
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
    <div
      className="border border-border rounded-lg overflow-hidden"
      data-testid="depleted-packs-section"
    >
      <PackSectionHeader
        icon={
          <SectionIcon colorTheme="violet">
            <Package className="w-4 h-4" />
          </SectionIcon>
        }
        title="Packs Sold Out"
        count={packs.length}
        isOpen={isOpen}
        onToggle={toggle}
        rightBadge={
          <span className="text-sm font-semibold text-foreground">
            {formatCurrency(totalSales)}
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
                <tr key={pack.pack_id} className="group">
                  <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 border-b border-border">
                    <div className="flex justify-center">
                      <BinBadge number={pack.bin_number} />
                    </div>
                  </td>
                  <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-xs sm:text-sm border-b border-border truncate max-w-[80px] sm:max-w-[120px] lg:max-w-none">
                    {pack.game_name}
                  </td>
                  <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-right text-xs sm:text-sm border-b border-border whitespace-nowrap">
                    {formatCurrency(pack.game_price)}
                  </td>
                  <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 font-mono text-[10px] sm:text-xs border-b border-border truncate">
                    {pack.pack_number}
                  </td>
                  <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 font-mono text-xs sm:text-sm border-b border-border whitespace-nowrap">
                    {pack.starting_serial}
                  </td>
                  <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 font-mono text-xs sm:text-sm border-b border-border whitespace-nowrap">
                    {pack.ending_serial}
                  </td>
                  <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-center text-xs sm:text-sm border-b border-border whitespace-nowrap">
                    {pack.tickets_sold}
                  </td>
                  <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-right text-xs sm:text-sm font-bold border-b border-border">
                    <div className="whitespace-nowrap">{formatCurrency(pack.sales_amount)}</div>
                    <div className="flex flex-col leading-tight">
                      <span className="text-[10px] sm:text-[11px] text-muted-foreground whitespace-nowrap">
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

  if (packs.length === 0) return null;

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
        title="Activated Packs"
        count={packs.length}
        isOpen={isOpen}
        onToggle={toggle}
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
                  <tr key={pack.pack_id} className={`group ${isDimmed ? 'opacity-70' : ''}`}>
                    <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 border-b border-border">
                      <div className="flex justify-center">
                        <BinBadge number={pack.bin_number} />
                      </div>
                    </td>
                    <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-xs sm:text-sm border-b border-border truncate max-w-[80px] sm:max-w-[120px] lg:max-w-none">
                      {pack.game_name}
                    </td>
                    <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-right text-xs sm:text-sm border-b border-border whitespace-nowrap">
                      {formatCurrency(pack.game_price)}
                    </td>
                    <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 font-mono text-[10px] sm:text-xs border-b border-border truncate">
                      {pack.pack_number}
                    </td>
                    <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 font-mono text-xs sm:text-sm border-b border-border whitespace-nowrap">
                      000
                    </td>
                    <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 font-mono text-xs sm:text-sm border-b border-border whitespace-nowrap">
                      ---
                    </td>
                    <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-center border-b border-border">
                      <span
                        className={`inline-block px-1.5 sm:px-2 py-0.5 rounded-xl text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide ${config.className}`}
                      >
                        {config.label}
                      </span>
                    </td>
                    <td className="px-2 sm:px-3 lg:px-4 py-2 sm:py-3 text-right border-b border-border">
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

  // Multi-closing session state
  // Default to the most recent closing session (highest closingNumber)
  const [selectedSessionNumber, setSelectedSessionNumber] = useState<number>(1);
  const [isCombinedView, setIsCombinedView] = useState<boolean>(true);

  // Compute derived values with stable references
  const hasMultipleClosings = (data?.totalClosings ?? 0) > 1;
  const closingSessions = useMemo(() => data?.closingSessions ?? [], [data?.closingSessions]);

  // Find the selected session from the stable closingSessions array
  const selectedSession = useMemo(
    () => closingSessions.find((s) => s.closingNumber === selectedSessionNumber) ?? null,
    [closingSessions, selectedSessionNumber]
  );

  const handleSelectSession = useCallback((sessionNumber: number) => {
    setSelectedSessionNumber(sessionNumber);
    setIsCombinedView(false);
  }, []);

  const handleSelectCombined = useCallback(() => {
    setIsCombinedView(true);
  }, []);

  const handleBack = useCallback(() => {
    navigate('/reports');
  }, [navigate]);

  // ========================================================================
  // Session-aware data selection
  // Combined view → top-level aggregated data
  // Per-session view → selected session's per-session data from backend
  // IMPORTANT: Must be called before any conditional returns (Rules of Hooks)
  // PERF-002: useMemo for stable references
  // ========================================================================
  const viewData = useMemo(() => {
    if (!data) {
      return {
        bins: [] as LotteryDayReportBin[],
        depletedPacks: [] as LotteryDayReportDepletedPack[],
        returnedPacks: [] as LotteryDayReportReturnedPack[],
        activatedPacks: [] as LotteryDayReportActivatedPack[],
      };
    }

    if (hasMultipleClosings && !isCombinedView && selectedSession) {
      return {
        bins: selectedSession.bins,
        depletedPacks: selectedSession.depletedPacks,
        returnedPacks: selectedSession.returnedPacks,
        activatedPacks: selectedSession.activatedPacks,
      };
    }

    return {
      bins: data.bins,
      depletedPacks: data.depletedPacks,
      returnedPacks: data.returnedPacks,
      activatedPacks: data.activatedPacks,
    };
  }, [data, hasMultipleClosings, isCombinedView, selectedSession]);

  // ========================================================================
  // Computed values for hero header — derived from session-aware viewData
  // IMPORTANT: Must be called before any conditional returns (Rules of Hooks)
  // PERF-002: useMemo for aggregated calculations
  // ========================================================================
  const { binSales, packSales, returnSales, totalTickets } = useMemo(() => {
    const binTotal = viewData.bins.reduce((sum, b) => sum + b.sales_amount, 0);
    const binTickets = viewData.bins.reduce((sum, b) => sum + b.tickets_sold, 0);
    const packTotal = viewData.depletedPacks.reduce((sum, p) => sum + p.sales_amount, 0);
    const returnTotal = viewData.returnedPacks.reduce((sum, p) => sum + p.sales_amount, 0);

    return {
      binSales: binTotal,
      packSales: packTotal,
      returnSales: returnTotal,
      totalTickets: binTickets,
    };
  }, [viewData]);

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
  // Main render — modern dashboard layout
  // SEC-004: All values rendered via JSX auto-escaping
  // API-008: Only whitelisted fields from data object displayed
  // ========================================================================
  return (
    <div className="min-h-screen bg-muted/30" data-testid="lottery-day-report">
      {/* Hero Header — full width gradient */}
      <HeroHeader
        businessDate={data.businessDate}
        binsCount={viewData.bins.length}
        binSales={binSales}
        packSales={packSales}
        returnSales={returnSales}
        totalTickets={totalTickets}
        formatCustom={formatCustom}
      />

      {/* Content Area - responsive padding */}
      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-6 max-w-[1600px] mx-auto">
        {/* Back button */}
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground hover:-translate-x-0.5 transition-all"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Reports
        </button>

        {/* Multi-Closing Sessions Banner — only shown when multiple closings exist */}
        {hasMultipleClosings && (
          <MultiClosingBanner
            sessions={closingSessions}
            selectedSession={selectedSessionNumber}
            selectedSessionData={selectedSession}
            onSelectSession={handleSelectSession}
            onSelectCombined={handleSelectCombined}
            isCombinedView={isCombinedView}
            formatCustom={formatCustom}
            hasMultipleClosings={hasMultipleClosings}
          />
        )}

        {/* Main Bins Table Card */}
        <div
          className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm"
          data-testid="lottery-report-card"
        >
          {/* Card Header */}
          <div className="flex items-center px-6 py-5 border-b border-border">
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
              <span className="text-base font-bold text-foreground">
                Bin Closings
                {hasMultipleClosings && !isCombinedView && (
                  <span className="text-muted-foreground font-normal ml-2">
                    — Session #{selectedSessionNumber}
                  </span>
                )}
                {hasMultipleClosings && isCombinedView && (
                  <span className="text-muted-foreground font-normal ml-2">
                    — Combined ({data.totalClosings} Sessions)
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Bins Table */}
          <BinsTable bins={viewData.bins} />
        </div>

        {/* Pack Sections — session-aware via viewData */}
        {(viewData.returnedPacks.length > 0 ||
          viewData.depletedPacks.length > 0 ||
          viewData.activatedPacks.length > 0) && (
          <div className="space-y-3">
            {viewData.returnedPacks.length > 0 && (
              <ReturnedPacksSection packs={viewData.returnedPacks} formatCustom={formatCustom} />
            )}
            {viewData.depletedPacks.length > 0 && (
              <DepletedPacksSection packs={viewData.depletedPacks} formatCustom={formatCustom} />
            )}
            {viewData.activatedPacks.length > 0 && (
              <ActivatedPacksSection packs={viewData.activatedPacks} formatCustom={formatCustom} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
