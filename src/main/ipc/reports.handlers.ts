/**
 * Reports IPC Handlers
 *
 * Provides report generation endpoints for weekly, monthly, and custom date ranges.
 * Reports are accessible without PIN authentication - API key is sufficient.
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
import { lotteryBusinessDaysDAL, type LotteryBusinessDay } from '../dal/lottery-business-days.dal';
import { getDatabase } from '../services/database.service';
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
    requiresAuth: false,
    description: 'Generate weekly report',
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
    requiresAuth: false,
    description: 'Generate monthly report',
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
    requiresAuth: false,
    description: 'Generate custom date range report',
  }
);

// ============================================================================
// Shifts By Days Report Types
// ============================================================================

/**
 * Individual shift data for reports with employee and register info
 */
interface ShiftByDayData {
  shiftId: string;
  shiftNumber: number;
  registerName: string;
  employeeName: string;
  startTime: string;
  endTime: string | null;
  status: 'OPEN' | 'CLOSED';
}

/**
 * Day data with shifts for the shifts-by-day report
 */
interface DayWithShifts {
  businessDate: string;
  dayStatus: 'OPEN' | 'CLOSED';
  shifts: ShiftByDayData[];
}

/**
 * Response for shifts-by-day report
 */
interface ShiftsByDayResponse {
  days: DayWithShifts[];
}

/**
 * Raw row from JOIN query (lottery_business_days LEFT JOIN shifts)
 */
interface ShiftJoinRow {
  shift_id: string | null;
  business_date: string;
  shift_number: number | null;
  start_time: string | null;
  end_time: string | null;
  shift_status: 'OPEN' | 'CLOSED' | null;
  external_register_id: string | null;
  employee_name: string | null;
  day_status: 'OPEN' | 'PENDING_CLOSE' | 'CLOSED';
}

// ============================================================================
// Shifts By Days Input Validation Schema
// API-001: Schema validation for all inputs
// ============================================================================

const ShiftsByDaysParamsSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Start date must be in YYYY-MM-DD format',
  }),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'End date must be in YYYY-MM-DD format',
  }),
  limit: z.number().int().min(1).max(100).optional().default(90),
});

// ============================================================================
// Shifts By Days Report Handler
// ============================================================================

/**
 * Get shifts grouped by day with employee and register information
 *
 * Returns days from lottery_business_days for a date range, with any
 * associated shifts. Days without shifts still appear (collapsed in UI).
 * - Employee names (from users table)
 * - Register names (from external_register_id)
 * - Day status (from lottery_business_days)
 *
 * @security SEC-006: Uses prepared statements with parameter binding
 * @security DB-006: Store-scoped for tenant isolation
 * @security API-001: Input validated with Zod schema
 * @security API-002: Limited to max 100 days
 */
registerHandler<ShiftsByDayResponse | ReturnType<typeof createErrorResponse>>(
  'reports:getShiftsByDays',
  async (_event, paramsInput: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // API-001: Validate input parameters
    const parseResult = ShiftsByDaysParamsSchema.safeParse(paramsInput);
    if (!parseResult.success) {
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        `Invalid parameters: ${parseResult.error.issues.map((i) => i.message).join(', ')}`
      );
    }

    const { startDate, endDate, limit } = parseResult.data;

    // Validate date range order
    if (new Date(startDate) > new Date(endDate)) {
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        'Start date must be before or equal to end date'
      );
    }

    // API-002: Limit range to prevent unbounded queries
    const dayDiff =
      (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24);
    if (dayDiff > limit) {
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        `Date range cannot exceed ${limit} days`
      );
    }

    try {
      const db = getDatabase();

      // SEC-006: Parameterized query
      // DB-006: Store-scoped via WHERE lbd.store_id = ?
      // Primary source: lottery_business_days (the actual days in the system)
      // LEFT JOIN shifts to include any shift data if it exists
      const stmt = db.prepare(`
        SELECT
          s.shift_id,
          lbd.business_date,
          s.shift_number,
          s.start_time,
          s.end_time,
          s.status AS shift_status,
          s.external_register_id,
          COALESCE(u.name, 'Unknown') AS employee_name,
          lbd.status AS day_status
        FROM lottery_business_days lbd
        LEFT JOIN shifts s ON lbd.store_id = s.store_id
          AND lbd.business_date = s.business_date
        LEFT JOIN users u ON s.cashier_id = u.user_id
        WHERE lbd.store_id = ?
          AND lbd.business_date >= ?
          AND lbd.business_date <= ?
        ORDER BY lbd.business_date DESC, s.external_register_id ASC, s.shift_number ASC
      `);

      const rows = stmt.all(store.store_id, startDate, endDate) as ShiftJoinRow[];

      // Group by business date — days appear even if they have no shifts
      const dayMap = new Map<string, DayWithShifts>();

      for (const row of rows) {
        let dayData = dayMap.get(row.business_date);

        if (!dayData) {
          // Map lottery day status to the simpler OPEN/CLOSED for the UI
          const uiStatus: 'OPEN' | 'CLOSED' = row.day_status === 'CLOSED' ? 'CLOSED' : 'OPEN';
          dayData = {
            businessDate: row.business_date,
            dayStatus: uiStatus,
            shifts: [],
          };
          dayMap.set(row.business_date, dayData);
        }

        // Only add shift if the JOIN actually matched a shift row
        if (row.shift_id) {
          dayData.shifts.push({
            shiftId: row.shift_id,
            shiftNumber: row.shift_number!,
            registerName: row.external_register_id ?? 'Register',
            employeeName: row.employee_name ?? 'Unknown',
            startTime: row.start_time ?? new Date().toISOString(),
            endTime: row.end_time,
            status: row.shift_status!,
          });
        }
      }

      // Convert map to array (already sorted by SQL ORDER BY)
      const days = Array.from(dayMap.values());

      log.info('Shifts by day report generated', {
        storeId: store.store_id,
        startDate,
        endDate,
        dayCount: days.length,
        totalShifts: rows.filter((r) => r.shift_id).length,
      });

      return { days };
    } catch (error) {
      log.error('Failed to generate shifts by day report', {
        startDate,
        endDate,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  {
    requiresAuth: false,
    description: 'Get shifts grouped by day with employee info',
  }
);

// ============================================================================
// Lottery Day Report Types
// ============================================================================

/**
 * Bin closing record from lottery_day_packs joined with packs/games/bins
 * Represents a single bin's lottery close data for a business day.
 */
interface LotteryDayReportBin {
  bin_number: number;
  game_name: string;
  game_price: number;
  pack_number: string;
  starting_serial: string;
  ending_serial: string;
  tickets_sold: number;
  sales_amount: number;
}

/**
 * Activated pack record for day report
 */
interface LotteryDayReportActivatedPack {
  pack_id: string;
  bin_number: number;
  game_name: string;
  game_price: number;
  pack_number: string;
  activated_at: string;
  status: 'ACTIVE' | 'DEPLETED' | 'RETURNED';
}

/**
 * Depleted pack record for day report
 */
interface LotteryDayReportDepletedPack {
  pack_id: string;
  bin_number: number;
  game_name: string;
  game_price: number;
  pack_number: string;
  starting_serial: string;
  ending_serial: string;
  tickets_sold: number;
  sales_amount: number;
  depleted_at: string;
}

/**
 * Returned pack record for day report
 */
interface LotteryDayReportReturnedPack {
  pack_id: string;
  bin_number: number;
  game_name: string;
  game_price: number;
  pack_number: string;
  starting_serial: string;
  ending_serial: string;
  tickets_sold: number;
  sales_amount: number;
  returned_at: string;
}

/**
 * Full lottery day report response
 */
interface LotteryDayReportResponse {
  businessDate: string;
  dayStatus: 'OPEN' | 'PENDING_CLOSE' | 'CLOSED' | null;
  closedAt: string | null;
  lotteryTotal: number;
  bins: LotteryDayReportBin[];
  activatedPacks: LotteryDayReportActivatedPack[];
  depletedPacks: LotteryDayReportDepletedPack[];
  returnedPacks: LotteryDayReportReturnedPack[];
}

/**
 * Raw row from day_packs JOIN query
 */
interface DayPackJoinRow {
  bin_display_order: number | null;
  game_name: string | null;
  game_price: number | null;
  pack_number: string;
  pack_opening_serial: string | null;
  pack_closing_serial: string | null;
  starting_serial: string;
  ending_serial: string | null;
  tickets_sold: number | null;
  sales_amount: number | null;
  prev_ending_serial: string | null;
}

/**
 * Raw row for activated packs query
 */
interface ActivatedPackRow {
  pack_id: string;
  bin_display_order: number | null;
  game_name: string | null;
  game_price: number | null;
  pack_number: string;
  activated_at: string;
  status: 'ACTIVE' | 'DEPLETED' | 'RETURNED';
}

/**
 * Raw row for depleted packs query
 */
interface DepletedPackRow {
  pack_id: string;
  bin_display_order: number | null;
  game_name: string | null;
  game_price: number | null;
  pack_number: string;
  opening_serial: string | null;
  ending_serial: string | null;
  tickets_sold: number | null;
  sales_amount: number | null;
  depleted_at: string;
  prev_ending_serial: string | null;
}

/**
 * Raw row for returned packs query
 */
interface ReturnedPackRow {
  pack_id: string;
  bin_display_order: number | null;
  game_name: string | null;
  game_price: number | null;
  pack_number: string;
  opening_serial: string | null;
  ending_serial: string | null;
  tickets_sold: number | null;
  sales_amount: number | null;
  returned_at: string;
  prev_ending_serial: string | null;
}

// ============================================================================
// Lottery Day Report Input Validation Schema
// API-001: Schema validation for all inputs
// ============================================================================

const LotteryDayReportParamsSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Business date must be in YYYY-MM-DD format',
  }),
});

// ============================================================================
// Lottery Day Report Handler
// ============================================================================

/**
 * Get lottery day report for a specific business date
 *
 * Returns the complete lottery close data for a given day including:
 * - Day close summary with per-bin breakdown (from lottery_day_packs)
 * - Activated packs during the business period
 * - Depleted (sold out) packs during the business period
 * - Returned packs during the business period
 *
 * @security SEC-006: Uses prepared statements with parameter binding
 * @security DB-006: Store-scoped for tenant isolation
 * @security API-001: Input validated with Zod schema
 */
registerHandler<LotteryDayReportResponse | ReturnType<typeof createErrorResponse>>(
  'reports:getLotteryDayReport',
  async (_event, paramsInput: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // API-001: Validate input parameters
    const parseResult = LotteryDayReportParamsSchema.safeParse(paramsInput);
    if (!parseResult.success) {
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        `Invalid parameters: ${parseResult.error.issues.map((i) => i.message).join(', ')}`
      );
    }

    const { businessDate } = parseResult.data;

    try {
      const db = getDatabase();
      const storeId = store.store_id;

      // Find the business day record for the requested date
      // DB-006: Store-scoped query
      // v048: Multiple days can exist per date (close-to-close model).
      // Prefer CLOSED day for report; fall back to most recent if none closed.
      const businessDayStmt = db.prepare(`
        SELECT * FROM lottery_business_days
        WHERE store_id = ? AND business_date = ?
        ORDER BY
          CASE status WHEN 'CLOSED' THEN 0 WHEN 'PENDING_CLOSE' THEN 1 ELSE 2 END,
          closed_at DESC,
          created_at DESC
        LIMIT 1
      `);
      const businessDay = businessDayStmt.get(storeId, businessDate) as
        | LotteryBusinessDay
        | undefined;

      // DIAGNOSTIC: Check how many day records exist for this date
      const allDaysForDate = db
        .prepare(
          `SELECT day_id, status, closed_at, created_at FROM lottery_business_days
           WHERE store_id = ? AND business_date = ?`
        )
        .all(storeId, businessDate);
      log.info('REPORT DIAGNOSTIC: Business day lookup', {
        businessDate,
        totalDayRecords: allDaysForDate.length,
        allDays: allDaysForDate,
        selectedDayId: businessDay?.day_id,
        selectedStatus: businessDay?.status,
      });

      if (!businessDay) {
        return {
          businessDate,
          dayStatus: null,
          closedAt: null,
          lotteryTotal: 0,
          bins: [],
          activatedPacks: [],
          depletedPacks: [],
          returnedPacks: [],
        };
      }

      // ====================================================================
      // Query 1: Get bin closings from lottery_day_packs
      // SEC-006: Parameterized query
      // DB-006: Store-scoped via day_id which is store-specific
      // ====================================================================
      const binsStmt = db.prepare(`
        SELECT
          lb.display_order AS bin_display_order,
          lg.name AS game_name,
          lg.price AS game_price,
          lp.pack_number,
          lp.opening_serial AS pack_opening_serial,
          lp.closing_serial AS pack_closing_serial,
          ldp.starting_serial,
          ldp.ending_serial,
          ldp.tickets_sold,
          ldp.sales_amount,
          -- SERIAL CARRYFORWARD: Get previous day's ending_serial as fallback
          (SELECT ldp2.ending_serial
           FROM lottery_day_packs ldp2
           JOIN lottery_business_days lbd2 ON ldp2.day_id = lbd2.day_id
           WHERE ldp2.pack_id = lp.pack_id
             AND lbd2.status = 'CLOSED'
             AND lbd2.day_id != ldp.day_id
             AND lbd2.closed_at < COALESCE(
               (SELECT lbd3.closed_at FROM lottery_business_days lbd3 WHERE lbd3.day_id = ldp.day_id),
               datetime('now')
             )
           ORDER BY lbd2.closed_at DESC
           LIMIT 1) AS prev_ending_serial
        FROM lottery_day_packs ldp
        INNER JOIN lottery_packs lp ON ldp.pack_id = lp.pack_id
        INNER JOIN lottery_games lg ON lp.game_id = lg.game_id
        LEFT JOIN lottery_bins lb ON ldp.bin_id = lb.bin_id
        WHERE ldp.day_id = ?
          AND ldp.store_id = ?
        ORDER BY lb.display_order ASC
      `);

      const binRows = binsStmt.all(businessDay.day_id, storeId) as DayPackJoinRow[];

      // DIAGNOSTIC: Log raw database values to trace serial display issues
      log.info('REPORT DIAGNOSTIC: Raw bin rows from lottery_day_packs', {
        businessDate,
        dayId: businessDay.day_id,
        dayStatus: businessDay.status,
        totalRows: binRows.length,
        rows: binRows.map((r) => ({
          pack_number: r.pack_number,
          bin_display_order: r.bin_display_order,
          starting_serial: r.starting_serial,
          ending_serial: r.ending_serial,
          pack_opening_serial: r.pack_opening_serial,
          pack_closing_serial: r.pack_closing_serial,
          prev_ending_serial: r.prev_ending_serial,
          tickets_sold: r.tickets_sold,
          sales_amount: r.sales_amount,
        })),
      });

      // Transform to response format
      // v039 alignment: display_order is 0-indexed, bin_number is 1-indexed
      // SERIAL FALLBACK: Use lottery_day_packs first, fall back to lottery_packs data
      const bins: LotteryDayReportBin[] = binRows.map((row) => ({
        bin_number: (row.bin_display_order ?? 0) + 1,
        game_name: row.game_name || 'Unknown Game',
        game_price: row.game_price ?? 0,
        pack_number: row.pack_number,
        starting_serial:
          row.starting_serial || row.prev_ending_serial || row.pack_opening_serial || '000',
        ending_serial: row.ending_serial || row.pack_closing_serial || row.starting_serial || '000',
        tickets_sold: row.tickets_sold ?? 0,
        sales_amount: row.sales_amount ?? 0,
      }));

      // ====================================================================
      // Determine period boundaries for pack queries
      // Enterprise close-to-close model: period starts day after last close
      // ====================================================================
      const closedDays = lotteryBusinessDaysDAL.findByStatus(storeId, 'CLOSED');
      // Find the previous closed day (the one before our target date)
      const previousClosedDay = closedDays.find(
        (d) => d.business_date < businessDate && d.day_id !== businessDay.day_id
      );

      let periodStartDate: string;
      if (previousClosedDay) {
        const prevDate = new Date(previousClosedDay.business_date);
        prevDate.setDate(prevDate.getDate() + 1);
        periodStartDate = prevDate.toISOString().split('T')[0];
      } else {
        periodStartDate = businessDate;
      }

      // Period ends at the business date (inclusive)
      const periodEndDate = businessDate;

      // ====================================================================
      // Query 2: Activated packs during the business period
      // SEC-006: Parameterized query with indexed date filtering
      // ====================================================================
      const activatedStmt = db.prepare(`
        SELECT
          lp.pack_id,
          lb.display_order AS bin_display_order,
          lg.name AS game_name,
          lg.price AS game_price,
          lp.pack_number,
          lp.activated_at,
          lp.status
        FROM lottery_packs lp
        INNER JOIN lottery_games lg ON lp.game_id = lg.game_id
        LEFT JOIN lottery_bins lb ON lp.current_bin_id = lb.bin_id
        WHERE lp.store_id = ?
          AND lp.activated_at IS NOT NULL
          AND DATE(lp.activated_at) >= ?
          AND DATE(lp.activated_at) <= ?
        ORDER BY lb.display_order ASC, lp.activated_at ASC
      `);

      const activatedRows = activatedStmt.all(
        storeId,
        periodStartDate,
        periodEndDate
      ) as ActivatedPackRow[];

      const activatedPacks: LotteryDayReportActivatedPack[] = activatedRows.map((row) => ({
        pack_id: row.pack_id,
        bin_number: (row.bin_display_order ?? 0) + 1,
        game_name: row.game_name || 'Unknown Game',
        game_price: row.game_price ?? 0,
        pack_number: row.pack_number,
        activated_at: row.activated_at,
        status: row.status,
      }));

      // ====================================================================
      // Query 3: Depleted (sold out) packs during the business period
      // SEC-006: Parameterized query
      // ====================================================================
      const depletedStmt = db.prepare(`
        SELECT
          lp.pack_id,
          lb.display_order AS bin_display_order,
          lg.name AS game_name,
          lg.price AS game_price,
          lp.pack_number,
          lp.opening_serial,
          lp.closing_serial AS ending_serial,
          lp.tickets_sold_count AS tickets_sold,
          lp.sales_amount,
          lp.depleted_at,
          -- SERIAL CARRYFORWARD: Get day-specific starting serial
          (SELECT ldp.ending_serial
           FROM lottery_day_packs ldp
           JOIN lottery_business_days lbd ON ldp.day_id = lbd.day_id
           WHERE ldp.pack_id = lp.pack_id
             AND lbd.status = 'CLOSED'
           ORDER BY lbd.closed_at DESC
           LIMIT 1) AS prev_ending_serial
        FROM lottery_packs lp
        INNER JOIN lottery_games lg ON lp.game_id = lg.game_id
        LEFT JOIN lottery_bins lb ON lp.current_bin_id = lb.bin_id
        WHERE lp.store_id = ?
          AND lp.status = 'DEPLETED'
          AND lp.depleted_at IS NOT NULL
          AND DATE(lp.depleted_at) >= ?
          AND DATE(lp.depleted_at) <= ?
        ORDER BY lb.display_order ASC
      `);

      const depletedRows = depletedStmt.all(
        storeId,
        periodStartDate,
        periodEndDate
      ) as DepletedPackRow[];

      const depletedPacks: LotteryDayReportDepletedPack[] = depletedRows.map((row) => ({
        pack_id: row.pack_id,
        bin_number: (row.bin_display_order ?? 0) + 1,
        game_name: row.game_name || 'Unknown Game',
        game_price: row.game_price ?? 0,
        pack_number: row.pack_number,
        starting_serial: row.prev_ending_serial || row.opening_serial || '000',
        ending_serial: row.ending_serial || '000',
        tickets_sold: row.tickets_sold ?? 0,
        sales_amount: row.sales_amount ?? 0,
        depleted_at: row.depleted_at,
      }));

      // ====================================================================
      // Query 4: Returned packs during the business period
      // SEC-006: Parameterized query
      // ====================================================================
      const returnedStmt = db.prepare(`
        SELECT
          lp.pack_id,
          lb.display_order AS bin_display_order,
          lg.name AS game_name,
          lg.price AS game_price,
          lp.pack_number,
          lp.opening_serial,
          lp.closing_serial AS ending_serial,
          lp.tickets_sold_count AS tickets_sold,
          lp.sales_amount,
          lp.returned_at,
          -- SERIAL CARRYFORWARD: Get day-specific starting serial
          (SELECT ldp.ending_serial
           FROM lottery_day_packs ldp
           JOIN lottery_business_days lbd ON ldp.day_id = lbd.day_id
           WHERE ldp.pack_id = lp.pack_id
             AND lbd.status = 'CLOSED'
           ORDER BY lbd.closed_at DESC
           LIMIT 1) AS prev_ending_serial
        FROM lottery_packs lp
        INNER JOIN lottery_games lg ON lp.game_id = lg.game_id
        LEFT JOIN lottery_bins lb ON lp.current_bin_id = lb.bin_id
        WHERE lp.store_id = ?
          AND lp.status = 'RETURNED'
          AND lp.returned_at IS NOT NULL
          AND DATE(lp.returned_at) >= ?
          AND DATE(lp.returned_at) <= ?
        ORDER BY lb.display_order ASC
      `);

      const returnedRows = returnedStmt.all(
        storeId,
        periodStartDate,
        periodEndDate
      ) as ReturnedPackRow[];

      const returnedPacks: LotteryDayReportReturnedPack[] = returnedRows.map((row) => ({
        pack_id: row.pack_id,
        bin_number: (row.bin_display_order ?? 0) + 1,
        game_name: row.game_name || 'Unknown Game',
        game_price: row.game_price ?? 0,
        pack_number: row.pack_number,
        starting_serial: row.prev_ending_serial || row.opening_serial || '000',
        ending_serial: row.ending_serial || '000',
        tickets_sold: row.tickets_sold ?? 0,
        sales_amount: row.sales_amount ?? 0,
        returned_at: row.returned_at,
      }));

      // Calculate lottery total: bins + depleted packs + returned packs
      const binsSales = bins.reduce((sum, bin) => sum + bin.sales_amount, 0);
      const depletedSales = depletedPacks.reduce((sum, p) => sum + p.sales_amount, 0);
      const returnedSales = returnedPacks.reduce((sum, p) => sum + p.sales_amount, 0);
      const lotteryTotal = binsSales + depletedSales + returnedSales;

      log.info('Lottery day report generated', {
        storeId,
        businessDate,
        dayStatus: businessDay.status,
        binsCount: bins.length,
        activatedCount: activatedPacks.length,
        depletedCount: depletedPacks.length,
        returnedCount: returnedPacks.length,
        lotteryTotal,
      });

      return {
        businessDate,
        dayStatus: businessDay.status,
        closedAt: businessDay.closed_at,
        lotteryTotal,
        bins,
        activatedPacks,
        depletedPacks,
        returnedPacks,
      };
    } catch (error) {
      log.error('Failed to generate lottery day report', {
        businessDate,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  {
    requiresAuth: false,
    description: 'Get lottery day report for a specific business date',
  }
);
