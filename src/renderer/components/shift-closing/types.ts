/**
 * Shift/Day Closing Shared Types
 *
 * Type definitions for shift and day closing workflows.
 * These types ensure consistency between Day Close and Shift End pages.
 *
 * New dual-column layout:
 * - Reports Totals: Manual input for items that need verification
 * - POS Totals: Read-only values from POS system
 *
 * @security
 * - FE-005: UI_SECURITY - No secrets exposed in these display types
 * - API-008: OUTPUT_FILTERING - Types mirror whitelisted API response fields only
 */

import type { LotteryCloseResult } from "@/components/lottery/CloseDayModal";

/**
 * Closing workflow mode - determines lottery requirement
 */
export type ClosingMode = "day" | "shift";

/**
 * Lottery status for the current business day
 * - not_closed: Lottery bins haven't been scanned yet
 * - pending: Lottery bins scanned, awaiting day close commit (two-phase commit)
 * - closed: Lottery day fully committed/closed
 * - closed_earlier: Lottery was closed before current session started
 */
export type LotteryStatus =
  | "not_closed"
  | "pending"
  | "closed"
  | "closed_earlier";

/**
 * Money received line item for cash reconciliation
 */
export interface MoneyReceivedItem {
  /** Unique identifier for the line item */
  id: string;
  /** Display label */
  label: string;
  /** Current value in dollars */
  value: number;
  /** Whether this is a payout (negative value display) */
  isNegative?: boolean;
  /** Whether field is editable */
  readOnly?: boolean;
}

/**
 * Sales breakdown line item
 */
export interface SalesBreakdownItem {
  /** Unique identifier for the line item */
  id: string;
  /** Display label (e.g., "Grocery", "Tobacco", "Scratch Off") */
  label: string;
  /** Current value in dollars */
  value: number;
  /** Whether field is editable */
  readOnly?: boolean;
  /** Whether to highlight this row (used for lottery) */
  highlight?: boolean;
}

/**
 * State for money received section - POS Totals (read-only from POS)
 */
export interface MoneyReceivedPOSState {
  cash: number;
  creditCard: number;
  debitCard: number;
  ebt: number;
  cashPayouts: number;
  lotteryPayouts: number;
  gamingPayouts: number;
}

/**
 * State for money received section - Reports Totals (manual input for payouts only)
 */
export interface MoneyReceivedReportsState {
  cashPayouts: number;
  lotteryPayouts: number;
  gamingPayouts: number;
}

/**
 * Combined state for money received section
 */
export interface MoneyReceivedState {
  pos: MoneyReceivedPOSState;
  reports: MoneyReceivedReportsState;
}

/**
 * State for sales breakdown section - POS Totals (read-only from POS)
 *
 * @security FE-005: UI_SECURITY - Display-only values, no sensitive data
 */
export interface SalesBreakdownPOSState {
  gasSales: number;
  grocery: number;
  tobacco: number;
  beverages: number;
  snacks: number;
  other: number;
  /** Instant (scratch-off) ticket sales from POS */
  scratchOff: number;
  /** Instant ticket cashes/redemptions from POS */
  instantCashes: number;
  /** Online lottery sales from POS */
  onlineLottery: number;
  /** Online lottery cashes/redemptions from POS */
  onlineCashes: number;
  salesTax: number;
}

/**
 * State for sales breakdown section - Reports Totals (manual input for lottery only)
 *
 * These values come from the lottery terminal report entered in Step 1 (Report Scanning).
 * Separated from POS data for reconciliation purposes.
 *
 * @security SEC-014: INPUT_VALIDATION - All values validated via sanitizeNumericInput
 */
export interface SalesBreakdownReportsState {
  /** Instant (scratch-off) ticket sales from lottery report */
  scratchOff: number;
  /** Instant ticket cashes/redemptions from lottery report */
  instantCashes: number;
  /** Online lottery sales from lottery report */
  onlineLottery: number;
  /** Online lottery cashes/redemptions from lottery report */
  onlineCashes: number;
}

/**
 * Combined state for sales breakdown section
 */
export interface SalesBreakdownState {
  pos: SalesBreakdownPOSState;
  reports: SalesBreakdownReportsState;
}

/**
 * Props for the LotteryStatusBanner component
 */
export interface LotteryStatusBannerProps {
  /** Current lottery status */
  status: LotteryStatus;
  /** Lottery data if closed in current session */
  lotteryData: LotteryCloseResult | null;
  /** Lottery total to display */
  lotteryTotal: number;
  /** Whether lottery is required (day close) or optional (shift close) */
  isRequired: boolean;
  /** Callback when user clicks to open lottery modal (optional when status is closed) */
  onOpenLotteryModal?: () => void;
}

/**
 * Props for shared MoneyReceivedCard component
 */
export interface MoneyReceivedCardProps {
  /** Current state values */
  state: MoneyReceivedState;
  /** Callback to update reports state (manual inputs) - optional in readOnly mode */
  onReportsChange?: (newState: Partial<MoneyReceivedReportsState>) => void;
  /** Callback to update POS state (for testing purposes) */
  onPOSChange?: (newState: Partial<MoneyReceivedPOSState>) => void;
  /** Whether inputs are disabled */
  disabled?: boolean;
  /** Whether to allow editing POS values (for testing) */
  editablePOS?: boolean;
  /** Whether to render in read-only mode (plain text instead of inputs) */
  readOnly?: boolean;
}

/**
 * Props for shared SalesBreakdownCard component
 */
export interface SalesBreakdownCardProps {
  /** Current state values */
  state: SalesBreakdownState;
  /** Callback to update reports state (manual inputs) - optional in readOnly mode */
  onReportsChange?: (newState: Partial<SalesBreakdownReportsState>) => void;
  /** Callback to update POS state (for testing purposes) */
  onPOSChange?: (newState: Partial<SalesBreakdownPOSState>) => void;
  /** Whether inputs are disabled */
  disabled?: boolean;
  /** Whether to allow editing POS values (for testing) */
  editablePOS?: boolean;
  /** Whether to render in read-only mode (plain text instead of inputs) */
  readOnly?: boolean;
}

/**
 * Props for LotterySalesDetails table component
 */
export interface LotterySalesDetailsProps {
  /** Lottery close result data */
  data: LotteryCloseResult;
}

/**
 * Calculated totals for display
 */
export interface ClosingTotals {
  /** Net cash from reports = receipts - payouts */
  netCashReports: number;
  /** Net cash from POS = receipts - payouts */
  netCashPOS: number;
  /** Total sales from reports */
  totalSalesReports: number;
  /** Total sales from POS */
  totalSalesPOS: number;
}

/**
 * Calculate net cash from money received state (Reports column)
 * Formula: POS(Cash+Credit+Debit+EBT) - REPORTS(Payouts)
 *
 * @security SEC-014: INPUT_VALIDATION - Defensive null checks for API data
 * @param state - Money received state
 * @returns Net cash amount for reports, or 0 if state is invalid
 */
export function calculateNetCashReports(state: MoneyReceivedState): number {
  // SEC-014: Defensive null checks - return 0 if state structure is invalid
  if (!state?.pos || !state?.reports) {
    return 0;
  }

  const posReceipts =
    (state.pos.cash ?? 0) +
    (state.pos.creditCard ?? 0) +
    (state.pos.debitCard ?? 0) +
    (state.pos.ebt ?? 0);
  const reportsPayouts =
    (state.reports.cashPayouts ?? 0) +
    (state.reports.lotteryPayouts ?? 0) +
    (state.reports.gamingPayouts ?? 0);
  return posReceipts - reportsPayouts;
}

/**
 * Calculate net cash from money received state (POS column)
 *
 * @security SEC-014: INPUT_VALIDATION - Defensive null checks for API data
 * @param state - Money received state
 * @returns Net cash amount for POS, or 0 if state is invalid
 */
export function calculateNetCashPOS(state: MoneyReceivedState): number {
  // SEC-014: Defensive null checks - return 0 if state structure is invalid
  if (!state?.pos) {
    return 0;
  }

  return (
    (state.pos.cash ?? 0) +
    (state.pos.creditCard ?? 0) +
    (state.pos.debitCard ?? 0) +
    (state.pos.ebt ?? 0) -
    (state.pos.cashPayouts ?? 0) -
    (state.pos.lotteryPayouts ?? 0) -
    (state.pos.gamingPayouts ?? 0)
  );
}

/**
 * Calculate total sales from sales breakdown state (Reports column)
 * Formula: POS(Gas+Grocery+Tobacco+Beverages+Snacks+Other+Tax) + REPORTS(Lottery)
 *
 * @security SEC-014: INPUT_VALIDATION - Defensive null checks for API data
 * @param state - Sales breakdown state
 * @returns Total sales amount for reports, or 0 if state is invalid
 */
export function calculateTotalSalesReports(state: SalesBreakdownState): number {
  // SEC-014: Defensive null checks - return 0 if state structure is invalid
  if (!state?.pos || !state?.reports) {
    return 0;
  }

  const posDepartments =
    (state.pos.gasSales ?? 0) +
    (state.pos.grocery ?? 0) +
    (state.pos.tobacco ?? 0) +
    (state.pos.beverages ?? 0) +
    (state.pos.snacks ?? 0) +
    (state.pos.other ?? 0) +
    (state.pos.salesTax ?? 0);
  const reportsLottery =
    (state.reports.scratchOff ?? 0) + (state.reports.onlineLottery ?? 0);
  return posDepartments + reportsLottery;
}

/**
 * Calculate total sales from sales breakdown state (POS column)
 *
 * @security SEC-014: INPUT_VALIDATION - Defensive null checks for API data
 * @param state - Sales breakdown state
 * @returns Total sales amount for POS, or 0 if state is invalid
 */
export function calculateTotalSalesPOS(state: SalesBreakdownState): number {
  // SEC-014: Defensive null checks - return 0 if state structure is invalid
  if (!state?.pos) {
    return 0;
  }

  return (
    (state.pos.gasSales ?? 0) +
    (state.pos.grocery ?? 0) +
    (state.pos.tobacco ?? 0) +
    (state.pos.beverages ?? 0) +
    (state.pos.snacks ?? 0) +
    (state.pos.other ?? 0) +
    (state.pos.scratchOff ?? 0) +
    (state.pos.onlineLottery ?? 0) +
    (state.pos.salesTax ?? 0)
  );
}

// Legacy exports for backward compatibility - keeping old function names
export function calculateNetCash(state: MoneyReceivedState): number {
  return calculateNetCashPOS(state);
}

export function calculateTotalSales(state: SalesBreakdownState): number {
  return calculateTotalSalesPOS(state);
}

/**
 * Default initial state for money received
 * Includes sample POS data for testing
 */
export const DEFAULT_MONEY_RECEIVED_STATE: MoneyReceivedState = {
  pos: {
    cash: 1234.56,
    creditCard: 890.0,
    debitCard: 456.78,
    ebt: 123.45,
    cashPayouts: 200.0,
    lotteryPayouts: 150.0,
    gamingPayouts: 75.0,
  },
  reports: {
    cashPayouts: 0,
    lotteryPayouts: 0,
    gamingPayouts: 0,
  },
};

/**
 * Default initial state for sales breakdown
 *
 * Column layout:
 * - Reports Totals: OUR data (lottery tracking, manual entries from Report Scanning step)
 * - POS Totals: 3rd party POS data (placeholder until integration)
 *
 * Data flow for lottery:
 * 1. Report Scanning Step: Lottery terminal report data → reports columns
 *    - Instant Sales, Instant Cashes, Online Sales, Online Cashes
 * 2. Lottery Close Step (Day Close only): Our calculated lottery_total → reports.scratchOff
 *
 * @business-rule All our lottery data goes to REPORTS column
 * @business-rule POS column is placeholder for future 3rd party POS integration
 *
 * @security FE-005: UI_SECURITY - Default values contain no sensitive data
 *
 * Includes sample POS data for department sales (placeholder until POS integration)
 */
export const DEFAULT_SALES_BREAKDOWN_STATE: SalesBreakdownState = {
  pos: {
    // Department sales - placeholder values until POS integration
    gasSales: 2500.0,
    grocery: 1200.0,
    tobacco: 800.0,
    beverages: 450.0,
    snacks: 320.0,
    other: 180.0,
    // Lottery POS values - populated from 3rd party POS integration (future)
    scratchOff: 0,
    instantCashes: 0,
    onlineLottery: 0,
    onlineCashes: 0,
    salesTax: 245.0,
  },
  reports: {
    // Lottery values from lottery terminal report (populated from Report Scanning step)
    scratchOff: 0,
    instantCashes: 0,
    onlineLottery: 0,
    onlineCashes: 0,
  },
};
