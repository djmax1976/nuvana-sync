/**
 * Hooks Index
 *
 * Re-exports all TanStack Query hooks for easy importing.
 *
 * @module renderer/lib/hooks
 */

// Dashboard hooks
export { dashboardKeys, useDashboardStats, useTodaySales, useWeeklySales } from './useDashboard';

// Shifts hooks
export {
  shiftKeys,
  useShifts,
  useOpenShifts,
  useShift,
  useShiftSummary,
  useCloseShift,
  useInvalidateShifts,
  useShiftFuelData,
  useDailyFuelTotals,
} from './useShifts';

// Day summaries hooks
export {
  daySummaryKeys,
  useDaySummaries,
  useDaySummary,
  useCloseDay,
  useInvalidateDaySummaries,
} from './useDaySummaries';

// Transactions hooks
export {
  transactionKeys,
  useTransactions,
  useTransaction,
  useInvalidateTransactions,
} from './useTransactions';

// Reports hooks
export {
  reportKeys,
  useWeeklyReport,
  useMonthlyReport,
  useDateRangeReport,
  useInvalidateReports,
} from './useReports';

// Sync Activity hooks
export {
  syncActivityKeys,
  useSyncActivity,
  useRetrySyncItem,
  useDeleteSyncItem,
  useInvalidateSyncActivity,
} from './useSyncActivity';
