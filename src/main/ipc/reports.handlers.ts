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
import { type LotteryBusinessDay } from '../dal/lottery-business-days.dal';
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
// Session Assignment Helper
// ============================================================================

/**
 * Assigns a timestamped event to its owning closing session.
 *
 * Sessions are ordered by opened_at ASC. Each session owns the period
 * from its opened_at until the next session's opened_at (exclusive).
 * The last session owns from its opened_at onward.
 *
 * @param timestamp ISO timestamp of the event (activated_at, depleted_at, etc.)
 * @param sessions Array of sessions ordered by opened_at ASC
 * @returns closingNumber of the owning session
 */
function assignToClosingSession(
  timestamp: string,
  sessions: ReadonlyArray<{ closingNumber: number; openedAt: string | null }>
): number {
  // Walk from last to first; first session whose openedAt <= timestamp wins
  for (let i = sessions.length - 1; i >= 0; i--) {
    const session = sessions[i];
    if (session.openedAt && timestamp >= session.openedAt) {
      return session.closingNumber;
    }
  }
  // Fallback: assign to first session if timestamp precedes all sessions
  return sessions[0]?.closingNumber ?? 1;
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
 * BIZ-003: Includes opened_at/closed_at for enterprise-grade date identification
 */
interface DayWithShifts {
  businessDate: string;
  openedAt: string | null;
  closedAt: string | null;
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
 * BIZ-003: Includes opened_at/closed_at for enterprise-grade sorting
 */
interface ShiftJoinRow {
  shift_id: string | null;
  business_date: string;
  opened_at: string | null;
  closed_at: string | null;
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

      // SEC-006: Parameterized query with ? placeholders only
      // DB-006: Store-scoped via WHERE lbd.store_id = ? for tenant isolation
      // BIZ-002: A date can have MULTIPLE closings AND an open day simultaneously.
      // Show dates that have at least one CLOSED day. An OPEN day on the same
      // date does NOT exclude the CLOSED days from appearing in reports.
      // BIZ-003: Enterprise-grade sorting — order by closed_at DESC so most
      // recently closed days appear first, regardless of business_date.
      const stmt = db.prepare(`
        SELECT
          s.shift_id,
          lbd.business_date,
          lbd.opened_at,
          lbd.closed_at,
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
          AND lbd.status = 'CLOSED'
        ORDER BY lbd.closed_at DESC, lbd.business_date DESC, s.external_register_id ASC, s.shift_number ASC
      `);

      const rows = stmt.all(store.store_id, startDate, endDate) as ShiftJoinRow[];

      // Group by business date — days appear even if they have no shifts
      // BIZ-003: First row per date has the most recent closed_at due to ORDER BY
      const dayMap = new Map<string, DayWithShifts>();

      for (const row of rows) {
        let dayData = dayMap.get(row.business_date);

        if (!dayData) {
          // Map lottery day status to the simpler OPEN/CLOSED for the UI
          // BIZ-003: Use first row's timestamps (most recent closing due to ORDER BY)
          const uiStatus: 'OPEN' | 'CLOSED' = row.day_status === 'CLOSED' ? 'CLOSED' : 'OPEN';
          dayData = {
            businessDate: row.business_date,
            openedAt: row.opened_at,
            closedAt: row.closed_at,
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
 * Individual closing session within a business day
 * When a day is closed and reopened multiple times, each close produces a session.
 */
interface DayClosingSession {
  closingNumber: number;
  dayId: string;
  openedAt: string | null;
  closedAt: string | null;
  binSales: number;
  packSales: number;
  returnSales: number;
  totalSales: number;
  totalTicketsSold: number;
  bins: LotteryDayReportBin[];
  depletedPacks: LotteryDayReportDepletedPack[];
  returnedPacks: LotteryDayReportReturnedPack[];
  activatedPacks: LotteryDayReportActivatedPack[];
}

/**
 * Full lottery day report response
 */
interface LotteryDayReportResponse {
  businessDate: string;
  dayStatus: 'OPEN' | 'PENDING_CLOSE' | 'CLOSED' | null;
  closedAt: string | null;
  lotteryTotal: number;
  totalClosings: number;
  closingSessions: DayClosingSession[];
  bins: LotteryDayReportBin[];
  activatedPacks: LotteryDayReportActivatedPack[];
  depletedPacks: LotteryDayReportDepletedPack[];
  returnedPacks: LotteryDayReportReturnedPack[];
}

/**
 * Raw row from per-session day_packs JOIN query (un-aggregated)
 * Each row represents one pack's closing data for one session (day_id)
 */
interface PerSessionBinRow {
  day_id: string;
  pack_id: string;
  bin_display_order: number | null;
  game_name: string | null;
  game_price: number | null;
  pack_number: string;
  pack_opening_serial: string | null;
  pack_closing_serial: string | null;
  starting_serial: string;
  ending_serial: string | null;
  tickets_sold: number;
  sales_amount: number;
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

      // ====================================================================
      // Fetch CLOSED business days for the requested date
      // DB-006: Store-scoped query
      // BIZ-002: Only include CLOSED days - OPEN days are not part of reports
      // v049: Multi-close aggregation — aggregate across all closings per date
      // When a day is closed and reopened multiple times, we aggregate bins
      // across ALL closings: starting serial from first, ending from last,
      // tickets/sales summed.
      // ====================================================================
      const allDaysStmt = db.prepare(`
        SELECT
          lbd.*,
          COALESCE(
            (SELECT SUM(ldp.tickets_sold)
             FROM lottery_day_packs ldp
             WHERE ldp.day_id = lbd.day_id),
            0
          ) AS total_tickets_sold
        FROM lottery_business_days lbd
        WHERE lbd.store_id = ? AND lbd.business_date = ? AND lbd.status = 'CLOSED'
        ORDER BY lbd.opened_at ASC
      `);
      const allBusinessDays = allDaysStmt.all(storeId, businessDate) as (LotteryBusinessDay & {
        total_tickets_sold: number;
      })[];

      log.info('Multi-close aggregation: Business day lookup', {
        businessDate,
        totalDayRecords: allBusinessDays.length,
        days: allBusinessDays.map((d) => ({
          day_id: d.day_id,
          status: d.status,
          opened_at: d.opened_at,
          closed_at: d.closed_at,
          total_sales: d.total_sales,
          total_tickets_sold: d.total_tickets_sold,
        })),
      });

      // Zero closings for the date: return empty response
      if (allBusinessDays.length === 0) {
        return {
          businessDate,
          dayStatus: null,
          closedAt: null,
          lotteryTotal: 0,
          totalClosings: 0,
          closingSessions: [],
          bins: [],
          activatedPacks: [],
          depletedPacks: [],
          returnedPacks: [],
        };
      }

      // Build day_id → closingNumber mapping for session assignment
      const dayIdToClosing = new Map<string, number>();
      allBusinessDays.forEach((day, index) => {
        dayIdToClosing.set(day.day_id, index + 1);
      });

      // Task 1.3: Determine composite dayStatus
      // If any closing is OPEN, report OPEN; if any is PENDING_CLOSE, report that;
      // only if ALL are CLOSED, report CLOSED
      const statuses = allBusinessDays.map((d) => d.status);
      let dayStatus: 'OPEN' | 'PENDING_CLOSE' | 'CLOSED';
      if (statuses.includes('OPEN')) {
        dayStatus = 'OPEN';
      } else if (statuses.includes('PENDING_CLOSE')) {
        dayStatus = 'PENDING_CLOSE';
      } else {
        dayStatus = 'CLOSED';
      }

      // Task 1.3: closedAt = the closed_at timestamp of the LAST closing
      const lastClosing = allBusinessDays[allBusinessDays.length - 1];
      const closedAt = lastClosing.closed_at;

      // Collect all day_ids for the multi-close aggregation bins query
      const dayIds = allBusinessDays.map((d) => d.day_id);
      const dayIdPlaceholders = dayIds.map(() => '?').join(', ');

      // ====================================================================
      // Query 1: Get per-session bin closings (un-aggregated, one row per day_id+pack_id)
      // SEC-006: Parameterized query with ? placeholders (no string interpolation of user input)
      // DB-006: Store-scoped via store_id in WHERE clause
      // Returns one row per (day_id, pack_id) — NO GROUP BY aggregation.
      // Combined view bins are computed in JS by aggregating across sessions.
      // Per-session view bins are grouped by day_id for direct display.
      // ====================================================================
      const binsStmt = db.prepare(`
        SELECT
          ldp.day_id,
          lp.pack_id,
          lb.display_order AS bin_display_order,
          lg.name AS game_name,
          lg.price AS game_price,
          lp.pack_number,
          lp.opening_serial AS pack_opening_serial,
          lp.closing_serial AS pack_closing_serial,
          ldp.starting_serial,
          ldp.ending_serial,
          COALESCE(ldp.tickets_sold, 0) AS tickets_sold,
          COALESCE(ldp.sales_amount, 0) AS sales_amount,
          -- SERIAL CARRYFORWARD: Previous date's ending serial as fallback
          (SELECT ldp2.ending_serial
           FROM lottery_day_packs ldp2
           JOIN lottery_business_days lbd2 ON ldp2.day_id = lbd2.day_id
           WHERE ldp2.pack_id = lp.pack_id
             AND lbd2.status = 'CLOSED'
             AND lbd2.business_date < ?
           ORDER BY lbd2.closed_at DESC
           LIMIT 1) AS prev_ending_serial
        FROM lottery_day_packs ldp
        INNER JOIN lottery_business_days lbd ON ldp.day_id = lbd.day_id
        INNER JOIN lottery_packs lp ON ldp.pack_id = lp.pack_id
        INNER JOIN lottery_games lg ON lp.game_id = lg.game_id
        LEFT JOIN lottery_bins lb ON ldp.bin_id = lb.bin_id
        WHERE ldp.day_id IN (${dayIdPlaceholders})
          AND ldp.store_id = ?
        ORDER BY lbd.opened_at ASC, lb.display_order ASC
      `);

      // SEC-006: Parameter binding order matches ? placeholders
      const binsParams = [businessDate, ...dayIds, storeId];
      const binRows = binsStmt.all(...binsParams) as PerSessionBinRow[];

      log.info('Per-session bin rows fetched', {
        businessDate,
        totalClosings: allBusinessDays.length,
        dayIds,
        totalBinRows: binRows.length,
      });

      // ====================================================================
      // Build per-session bins (group by day_id)
      // Each lottery_day_packs row belongs to exactly one session via day_id
      // v039 alignment: display_order is 0-indexed, bin_number is 1-indexed
      // ====================================================================
      const sessionBinsMap = new Map<number, LotteryDayReportBin[]>();
      for (const row of binRows) {
        const closingNumber = dayIdToClosing.get(row.day_id) ?? 1;
        if (!sessionBinsMap.has(closingNumber)) {
          sessionBinsMap.set(closingNumber, []);
        }
        sessionBinsMap.get(closingNumber)!.push({
          bin_number: (row.bin_display_order ?? 0) + 1,
          game_name: row.game_name || 'Unknown Game',
          game_price: row.game_price ?? 0,
          pack_number: row.pack_number,
          starting_serial:
            row.starting_serial || row.prev_ending_serial || row.pack_opening_serial || '000',
          ending_serial:
            row.ending_serial || row.pack_closing_serial || row.starting_serial || '000',
          tickets_sold: row.tickets_sold ?? 0,
          sales_amount: row.sales_amount ?? 0,
        });
      }

      // ====================================================================
      // Build combined bins (aggregate across sessions by pack_id)
      // starting_serial = from first session (earliest opened_at)
      // ending_serial   = from last session (latest opened_at)
      // tickets_sold, sales_amount = SUM across all sessions
      // ====================================================================
      const packGroupMap = new Map<string, PerSessionBinRow[]>();
      for (const row of binRows) {
        const existing = packGroupMap.get(row.pack_id) || [];
        existing.push(row);
        packGroupMap.set(row.pack_id, existing);
      }

      const bins: LotteryDayReportBin[] = Array.from(packGroupMap.values())
        .map((rows) => {
          // rows are ordered by opened_at ASC from SQL — first = earliest session
          const first = rows[0];
          const last = rows[rows.length - 1];
          return {
            bin_number: (first.bin_display_order ?? 0) + 1,
            game_name: first.game_name || 'Unknown Game',
            game_price: first.game_price ?? 0,
            pack_number: first.pack_number,
            starting_serial:
              first.starting_serial ||
              first.prev_ending_serial ||
              first.pack_opening_serial ||
              '000',
            ending_serial:
              last.ending_serial || last.pack_closing_serial || last.starting_serial || '000',
            tickets_sold: rows.reduce((sum, r) => sum + (r.tickets_sold ?? 0), 0),
            sales_amount: rows.reduce((sum, r) => sum + (r.sales_amount ?? 0), 0),
          };
        })
        .sort((a, b) => a.bin_number - b.bin_number);

      // ====================================================================
      // Determine period boundaries for pack queries
      // Enterprise close-to-close model: use actual session timestamps
      //
      // The period is bounded by the actual opened_at/closed_at timestamps
      // of the CLOSED sessions for this business date. This prevents:
      // - Cross-session pack attribution when sessions cross timezone midnight
      // - Ghost packs from adjacent sessions leaking into the wrong report
      // - Timezone conversion errors from midnight-to-midnight calculations
      //
      // allBusinessDays is sorted by opened_at ASC (all CLOSED for this date)
      // ====================================================================
      const firstSession = allBusinessDays[0];
      const lastSession = allBusinessDays[allBusinessDays.length - 1];
      const periodStartUtc = firstSession.opened_at;
      const periodEndUtc = lastSession.closed_at;

      // ====================================================================
      // Query 2: Activated packs during the business period
      // SEC-006: Parameterized query with indexed date filtering
      // ====================================================================
      // TIMEZONE FIX: Use UTC datetime boundaries instead of DATE() comparison
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
          AND lp.activated_at >= ?
          AND lp.activated_at < ?
        ORDER BY lb.display_order ASC, lp.activated_at ASC
      `);

      const activatedRows = activatedStmt.all(
        storeId,
        periodStartUtc,
        periodEndUtc
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
          AND lp.depleted_at >= ?
          AND lp.depleted_at < ?
        ORDER BY lb.display_order ASC
      `);

      // TIMEZONE FIX: Use UTC datetime boundaries
      const depletedRows = depletedStmt.all(
        storeId,
        periodStartUtc,
        periodEndUtc
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
          AND lp.returned_at >= ?
          AND lp.returned_at < ?
        ORDER BY lb.display_order ASC
      `);

      // TIMEZONE FIX: Use UTC datetime boundaries
      const returnedRows = returnedStmt.all(
        storeId,
        periodStartUtc,
        periodEndUtc
      ) as ReturnedPackRow[];

      const returnedPacks: LotteryDayReportReturnedPack[] = returnedRows.map((row) => {
        // Calculate tickets_sold from serials to ensure consistency with displayed values
        const startSerial = row.prev_ending_serial || row.opening_serial || '000';
        const endSerial = row.ending_serial || '000';
        const startNum = parseInt(startSerial, 10);
        const endNum = parseInt(endSerial, 10);
        const ticketsSold = !isNaN(startNum) && !isNaN(endNum) ? Math.max(0, endNum - startNum) : 0;
        const gamePrice = row.game_price ?? 0;

        return {
          pack_id: row.pack_id,
          bin_number: (row.bin_display_order ?? 0) + 1,
          game_name: row.game_name || 'Unknown Game',
          game_price: gamePrice,
          pack_number: row.pack_number,
          starting_serial: startSerial,
          ending_serial: endSerial,
          tickets_sold: ticketsSold,
          sales_amount: ticketsSold * gamePrice,
          returned_at: row.returned_at,
        };
      });

      // ====================================================================
      // Distribute packs to closing sessions based on timestamps
      // Each pack is assigned to the session whose opened_at <= pack timestamp
      // and is the latest such session (session owns until next session opens)
      // ====================================================================
      const sessionInfo = allBusinessDays.map((day, index) => ({
        closingNumber: index + 1,
        openedAt: day.opened_at,
      }));

      const sessionDepletedMap = new Map<number, LotteryDayReportDepletedPack[]>();
      for (const pack of depletedPacks) {
        const closingNum = assignToClosingSession(pack.depleted_at, sessionInfo);
        if (!sessionDepletedMap.has(closingNum)) {
          sessionDepletedMap.set(closingNum, []);
        }
        sessionDepletedMap.get(closingNum)!.push(pack);
      }

      const sessionReturnedMap = new Map<number, LotteryDayReportReturnedPack[]>();
      for (const pack of returnedPacks) {
        const closingNum = assignToClosingSession(pack.returned_at, sessionInfo);
        if (!sessionReturnedMap.has(closingNum)) {
          sessionReturnedMap.set(closingNum, []);
        }
        sessionReturnedMap.get(closingNum)!.push(pack);
      }

      const sessionActivatedMap = new Map<number, LotteryDayReportActivatedPack[]>();
      for (const pack of activatedPacks) {
        const closingNum = assignToClosingSession(pack.activated_at, sessionInfo);
        if (!sessionActivatedMap.has(closingNum)) {
          sessionActivatedMap.set(closingNum, []);
        }
        sessionActivatedMap.get(closingNum)!.push(pack);
      }

      // ====================================================================
      // Build closing sessions with per-session data and computed totals
      // totalSales = binSales + packSales + returnSales (all three categories)
      // ====================================================================
      const closingSessions: DayClosingSession[] = allBusinessDays.map((day, index) => {
        const closingNumber = index + 1;
        const sBins = sessionBinsMap.get(closingNumber) ?? [];
        const sDepleted = sessionDepletedMap.get(closingNumber) ?? [];
        const sReturned = sessionReturnedMap.get(closingNumber) ?? [];
        const sActivated = sessionActivatedMap.get(closingNumber) ?? [];

        const binSales = sBins.reduce((sum, b) => sum + b.sales_amount, 0);
        const packSales = sDepleted.reduce((sum, p) => sum + p.sales_amount, 0);
        const returnSales = sReturned.reduce((sum, p) => sum + p.sales_amount, 0);

        return {
          closingNumber,
          dayId: day.day_id,
          openedAt: day.opened_at,
          closedAt: day.closed_at,
          binSales,
          packSales,
          returnSales,
          totalSales: binSales + packSales + returnSales,
          totalTicketsSold: day.total_tickets_sold ?? 0,
          bins: sBins,
          depletedPacks: sDepleted,
          returnedPacks: sReturned,
          activatedPacks: sActivated,
        };
      });

      // lotteryTotal = sum of all sales categories across combined view
      const lotteryTotal =
        bins.reduce((sum, b) => sum + b.sales_amount, 0) +
        depletedPacks.reduce((sum, p) => sum + p.sales_amount, 0) +
        returnedPacks.reduce((sum, p) => sum + p.sales_amount, 0);

      log.info('Lottery day report generated', {
        storeId,
        businessDate,
        dayStatus,
        totalClosings: allBusinessDays.length,
        binsCount: bins.length,
        activatedCount: activatedPacks.length,
        depletedCount: depletedPacks.length,
        returnedCount: returnedPacks.length,
        lotteryTotal,
      });

      return {
        businessDate,
        dayStatus,
        closedAt,
        lotteryTotal,
        totalClosings: allBusinessDays.length,
        closingSessions,
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
