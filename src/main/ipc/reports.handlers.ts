/**
 * Reports IPC Handlers
 *
 * Provides report generation endpoints for weekly, monthly, and custom date ranges.
 * All reports require MANAGER role for authorization.
 *
 * @module main/ipc/reports
 * @security DB-006: Store-scoped queries for tenant isolation
 * @security SEC-006: All queries use prepared statements
 * @security API-004: Role-based authorization for reports
 */

import { z } from 'zod';
import { registerHandler, createErrorResponse, IPCErrorCodes } from './index';
import { storesDAL } from '../dal/stores.dal';
import { daySummariesDAL } from '../dal/day-summaries.dal';
import { shiftSummariesDAL, shiftFuelSummariesDAL, shiftDepartmentSummariesDAL } from '../dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

interface DailyReportData {
  date: string;
  totalSales: number;
  transactionCount: number;
  fuelSales: number;
  merchandiseSales: number;
  status: 'OPEN' | 'CLOSED' | 'NO_DATA';
}

interface WeeklyReportResponse {
  weekStartDate: string;
  weekEndDate: string;
  dailyData: DailyReportData[];
  totals: {
    sales: number;
    transactions: number;
    fuelSales: number;
    merchandiseSales: number;
  };
}

interface MonthlyReportResponse {
  year: number;
  month: number;
  summaries: Array<{
    date: string;
    totalSales: number;
    totalTransactions: number;
    status: 'OPEN' | 'CLOSED';
  }>;
  totals: {
    sales: number;
    transactions: number;
    closedDays: number;
    openDays: number;
  };
}

interface DateRangeReportResponse {
  startDate: string;
  endDate: string;
  summaries: Array<{
    date: string;
    totalSales: number;
    totalTransactions: number;
    status: 'OPEN' | 'CLOSED';
  }>;
  totals: {
    sales: number;
    transactions: number;
    dayCount: number;
  };
}

// ============================================================================
// Input Validation Schemas
// API-001: Schema validation for all inputs
// ============================================================================

const WeekStartDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: 'Week start date must be in YYYY-MM-DD format',
});

const MonthlyReportParamsSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
});

const DateRangeParamsSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('reports-handlers');

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate array of date strings for a range
 */
function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Get fuel sales total for a date
 * Uses shift_summaries and shift_fuel_summaries tables
 */
function getFuelSalesForDate(storeId: string, date: string): number {
  try {
    // Get all shift summaries for this date
    const shiftSummaries = shiftSummariesDAL.findByDate(storeId, date);
    let totalFuelSales = 0;

    for (const summary of shiftSummaries) {
      // Get fuel totals for each shift
      const fuelTotals = shiftFuelSummariesDAL.getShiftTotals(summary.shift_summary_id);
      totalFuelSales += fuelTotals.totalSales;
    }

    return totalFuelSales;
  } catch {
    return 0;
  }
}

/**
 * Get merchandise sales total for a date
 * Uses shift_summaries and shift_department_summaries tables
 */
function getMerchandiseSalesForDate(storeId: string, date: string): number {
  try {
    // Get all shift summaries for this date
    const shiftSummaries = shiftSummariesDAL.findByDate(storeId, date);
    let totalMerchSales = 0;

    for (const summary of shiftSummaries) {
      // Get department summaries for each shift
      const deptSummaries = shiftDepartmentSummariesDAL.findByShiftSummary(
        summary.shift_summary_id
      );
      totalMerchSales += deptSummaries.reduce((sum, d) => sum + d.net_sales, 0);
    }

    return totalMerchSales;
  } catch {
    return 0;
  }
}

// ============================================================================
// Weekly Report Handler
// ============================================================================

/**
 * Generate weekly report
 * API-004: Requires MANAGER role
 * Returns 7 days of data from the specified start date
 */
registerHandler<WeeklyReportResponse | ReturnType<typeof createErrorResponse>>(
  'reports:weekly',
  async (_event, weekStartDateInput: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // API-001: Validate input
    const parseResult = WeekStartDateSchema.safeParse(weekStartDateInput);
    if (!parseResult.success) {
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        'Invalid week start date format. Use YYYY-MM-DD'
      );
    }

    const weekStartDate = parseResult.data;

    try {
      // Generate 7 days from start
      const dates: string[] = [];
      const startDate = new Date(weekStartDate);
      for (let i = 0; i < 7; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        dates.push(date.toISOString().split('T')[0]);
      }

      const weekEndDate = dates[dates.length - 1];

      // Build daily data array
      // DB-006: Each query is store-scoped
      const dailyData: DailyReportData[] = dates.map((date) => {
        const summary = daySummariesDAL.findByDate(store.store_id, date);
        const fuelSales = getFuelSalesForDate(store.store_id, date);
        const merchSales = getMerchandiseSalesForDate(store.store_id, date);

        return {
          date,
          totalSales: summary?.gross_sales ?? 0,
          transactionCount: summary?.transaction_count ?? 0,
          fuelSales,
          merchandiseSales: merchSales,
          status: summary?.status ?? 'NO_DATA',
        };
      });

      // Calculate totals
      const totals = {
        sales: dailyData.reduce((sum, d) => sum + d.totalSales, 0),
        transactions: dailyData.reduce((sum, d) => sum + d.transactionCount, 0),
        fuelSales: dailyData.reduce((sum, d) => sum + d.fuelSales, 0),
        merchandiseSales: dailyData.reduce((sum, d) => sum + d.merchandiseSales, 0),
      };

      log.info('Weekly report generated', {
        storeId: store.store_id,
        weekStartDate,
        totalSales: totals.sales,
      });

      return {
        weekStartDate,
        weekEndDate,
        dailyData,
        totals,
      };
    } catch (error) {
      log.error('Failed to generate weekly report', {
        weekStartDate,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'shift_manager',
    description: 'Generate weekly report (requires MANAGER role)',
  }
);

// ============================================================================
// Monthly Report Handler
// ============================================================================

/**
 * Generate monthly report
 * API-004: Requires MANAGER role
 * Returns all days in the specified month
 */
registerHandler<MonthlyReportResponse | ReturnType<typeof createErrorResponse>>(
  'reports:monthly',
  async (_event, paramsInput: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // API-001: Validate input parameters
    const parseResult = MonthlyReportParamsSchema.safeParse(paramsInput);
    if (!parseResult.success) {
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        `Invalid parameters: ${parseResult.error.issues.map((i) => i.message).join(', ')}`
      );
    }

    const { year, month } = parseResult.data;

    try {
      // Get all days in month
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0); // Last day of month
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      // DB-006: Store-scoped query
      const summaries = daySummariesDAL.findByDateRange(store.store_id, startStr, endStr);

      // Map to response format
      const mappedSummaries = summaries.map((s) => ({
        date: s.business_date,
        totalSales: s.gross_sales,
        totalTransactions: s.transaction_count,
        status: s.status,
      }));

      // Calculate totals
      const totals = {
        sales: summaries.reduce((sum, s) => sum + s.gross_sales, 0),
        transactions: summaries.reduce((sum, s) => sum + s.transaction_count, 0),
        closedDays: summaries.filter((s) => s.status === 'CLOSED').length,
        openDays: summaries.filter((s) => s.status === 'OPEN').length,
      };

      log.info('Monthly report generated', {
        storeId: store.store_id,
        year,
        month,
        dayCount: summaries.length,
        totalSales: totals.sales,
      });

      return {
        year,
        month,
        summaries: mappedSummaries,
        totals,
      };
    } catch (error) {
      log.error('Failed to generate monthly report', {
        year,
        month,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'shift_manager',
    description: 'Generate monthly report (requires MANAGER role)',
  }
);

// ============================================================================
// Custom Date Range Report Handler
// ============================================================================

/**
 * Generate custom date range report
 * API-004: Requires MANAGER role
 */
registerHandler<DateRangeReportResponse | ReturnType<typeof createErrorResponse>>(
  'reports:dateRange',
  async (_event, paramsInput: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // API-001: Validate input parameters
    const parseResult = DateRangeParamsSchema.safeParse(paramsInput);
    if (!parseResult.success) {
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        `Invalid parameters: ${parseResult.error.issues.map((i) => i.message).join(', ')}`
      );
    }

    const { startDate, endDate } = parseResult.data;

    // Validate date range
    if (new Date(startDate) > new Date(endDate)) {
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        'Start date must be before or equal to end date'
      );
    }

    // Limit range to prevent unbounded queries (max 365 days)
    const dayDiff =
      (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24);
    if (dayDiff > 365) {
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        'Date range cannot exceed 365 days'
      );
    }

    try {
      // DB-006: Store-scoped query
      const summaries = daySummariesDAL.findByDateRange(store.store_id, startDate, endDate);

      // Map to response format
      const mappedSummaries = summaries.map((s) => ({
        date: s.business_date,
        totalSales: s.gross_sales,
        totalTransactions: s.transaction_count,
        status: s.status,
      }));

      // Calculate totals
      const totals = {
        sales: summaries.reduce((sum, s) => sum + s.gross_sales, 0),
        transactions: summaries.reduce((sum, s) => sum + s.transaction_count, 0),
        dayCount: summaries.length,
      };

      log.info('Date range report generated', {
        storeId: store.store_id,
        startDate,
        endDate,
        dayCount: summaries.length,
        totalSales: totals.sales,
      });

      return {
        startDate,
        endDate,
        summaries: mappedSummaries,
        totals,
      };
    } catch (error) {
      log.error('Failed to generate date range report', {
        startDate,
        endDate,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'shift_manager',
    description: 'Generate custom date range report (requires MANAGER role)',
  }
);
