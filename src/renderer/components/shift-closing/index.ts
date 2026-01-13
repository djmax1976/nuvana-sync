/**
 * Shift/Day Closing Components
 *
 * Shared components for shift and day closing workflows.
 * These components provide consistent UI and behavior across both flows.
 *
 * New dual-column layout:
 * - Reports Totals: Manual input for items that need verification
 * - POS Totals: Read-only values from POS system
 *
 * @module shift-closing
 */

// Types
export type {
  ClosingMode,
  LotteryStatus,
  MoneyReceivedItem,
  SalesBreakdownItem,
  MoneyReceivedPOSState,
  MoneyReceivedReportsState,
  MoneyReceivedState,
  SalesBreakdownPOSState,
  SalesBreakdownReportsState,
  SalesBreakdownState,
  LotteryStatusBannerProps,
  MoneyReceivedCardProps,
  SalesBreakdownCardProps,
  LotterySalesDetailsProps,
  ClosingTotals,
} from "./types";

export {
  calculateNetCash,
  calculateNetCashReports,
  calculateNetCashPOS,
  calculateTotalSales,
  calculateTotalSalesReports,
  calculateTotalSalesPOS,
  DEFAULT_MONEY_RECEIVED_STATE,
  DEFAULT_SALES_BREAKDOWN_STATE,
} from "./types";

// Utilities
export {
  formatCurrency,
  sanitizeNumericInput,
  formatBusinessDate,
  truncateUuid,
  validateRequiredFields,
} from "./utils";

// Components
export { MoneyReceivedCard } from "./MoneyReceivedCard";
export { SalesBreakdownCard } from "./SalesBreakdownCard";
export { LotteryStatusBanner } from "./LotteryStatusBanner";
export { LotterySalesDetails } from "./LotterySalesDetails";
