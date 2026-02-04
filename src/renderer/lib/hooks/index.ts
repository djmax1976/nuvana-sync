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

// Reports Data hooks (shifts by day view)
export {
  reportsDataKeys,
  useReportsData,
  type ReportDay,
  type UseReportsDataParams,
  type UseReportsDataReturn,
} from './useReportsData';

// Lottery Day Report hook (read-only report page)
export {
  lotteryDayReportKeys,
  useLotteryDayReport,
  type UseLotteryDayReportParams,
  type UseLotteryDayReportReturn,
} from './useLotteryDayReport';

// Sync Activity hooks
export {
  syncActivityKeys,
  useSyncActivity,
  useRetrySyncItem,
  useDeleteSyncItem,
  useInvalidateSyncActivity,
} from './useSyncActivity';

// Dead Letter Queue hooks (v046: MQ-002 Compliance)
export {
  deadLetterKeys,
  useDeadLetterItems,
  useDeadLetterStats,
  useRestoreFromDeadLetter,
  useRestoreFromDeadLetterMany,
  useDeleteDeadLetterItem,
  useManualDeadLetter,
  useInvalidateDeadLetter,
} from './useSyncActivity';
