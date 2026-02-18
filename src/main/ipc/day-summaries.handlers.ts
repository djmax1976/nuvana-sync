/**
 * Day Summaries IPC Handlers
 *
 * Provides day summary management endpoints including listing, details, and closing.
 * Day close requires MANAGER role and validates all shifts are closed.
 *
 * @module main/ipc/day-summaries
 * @security DB-006: Store-scoped queries for tenant isolation
 * @security SEC-006: All queries use prepared statements
 * @security API-004: Role-based authorization for sensitive operations
 */

import { z } from 'zod';
import { registerHandler, createErrorResponse, IPCErrorCodes } from './index';
import { storesDAL } from '../dal/stores.dal';
import { daySummariesDAL, type DaySummary } from '../dal/day-summaries.dal';
import { shiftsDAL, type Shift } from '../dal/shifts.dal';
import { createLogger } from '../utils/logger';

// NOTE: day_summary sync removed - summaries are calculated server-side
// API spec only supports day close via /api/v1/sync/lottery/day/* endpoints
// which use day_close entity type, not day_summary

// ============================================================================
// Types
// ============================================================================

interface _DaySummaryListParams {
  startDate?: string;
  endDate?: string;
  status?: 'OPEN' | 'CLOSED';
  limit?: number;
  offset?: number;
}

interface DaySummaryListResponse {
  summaries: DaySummary[];
  total: number;
  limit: number;
  offset: number;
}

interface DaySummaryWithShifts {
  summary: DaySummary;
  shifts: Shift[];
}

interface DayCloseValidation {
  canClose: boolean;
  openShifts: Shift[];
  message: string;
}

// ============================================================================
// Input Validation Schemas
// API-001: Schema validation for all inputs
// ============================================================================

const DaySummaryListParamsSchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
  limit: z.number().int().min(1).max(1000).optional().default(30),
  offset: z.number().int().min(0).optional().default(0),
});

const BusinessDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: 'Date must be in YYYY-MM-DD format',
});

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('day-summaries-handlers');

// ============================================================================
// List Day Summaries Handler
// ============================================================================

/**
 * List day summaries with optional filtering and pagination
 * Supports filtering by date range and status
 */
registerHandler<DaySummaryListResponse | ReturnType<typeof createErrorResponse>>(
  'daySummaries:list',
  async (_event, paramsInput: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // API-001: Validate input parameters
    const parseResult = DaySummaryListParamsSchema.safeParse(paramsInput ?? {});
    if (!parseResult.success) {
      log.warn('Invalid day summary list params', { errors: parseResult.error.issues });
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        `Invalid parameters: ${parseResult.error.issues.map((i) => i.message).join(', ')}`
      );
    }

    const params = parseResult.data;

    try {
      let summaries: DaySummary[];
      let total: number;

      // DB-006: All queries are store-scoped
      if (params.startDate && params.endDate) {
        // Filter by date range
        summaries = daySummariesDAL.findByDateRange(
          store.store_id,
          params.startDate,
          params.endDate
        );

        // Apply status filter if provided
        if (params.status) {
          summaries = summaries.filter((s) => s.status === params.status);
        }

        total = summaries.length;

        // Apply pagination in memory (for filtered results)
        summaries = summaries.slice(params.offset, params.offset + params.limit);
      } else {
        // Get paginated results from DAL
        const result = daySummariesDAL.findByStore(
          store.store_id,
          { limit: params.limit, offset: params.offset },
          { column: 'business_date', direction: 'DESC' }
        );

        summaries = result.data;

        // Apply status filter if provided
        if (params.status) {
          summaries = summaries.filter((s) => s.status === params.status);
        }

        total = result.total;
      }

      log.debug('Day summaries listed', {
        storeId: store.store_id,
        count: summaries.length,
        total,
      });

      return {
        summaries,
        total,
        limit: params.limit,
        offset: params.offset,
      };
    } catch (error) {
      log.error('Failed to list day summaries', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'List day summaries with filtering and pagination' }
);

// ============================================================================
// Get Day Summary by Date Handler
// ============================================================================

/**
 * Get day summary by business date
 * Includes shifts for the day
 */
registerHandler<DaySummaryWithShifts | ReturnType<typeof createErrorResponse>>(
  'daySummaries:getByDate',
  async (_event, dateInput: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // API-001: Validate date format
    const parseResult = BusinessDateSchema.safeParse(dateInput);
    if (!parseResult.success) {
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        'Invalid date format. Use YYYY-MM-DD'
      );
    }

    const date = parseResult.data;

    try {
      // DB-006: Store-scoped query
      const summary = daySummariesDAL.findByDate(store.store_id, date);

      if (!summary) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, `No summary found for ${date}`);
      }

      // Get shifts for this day
      const shifts = shiftsDAL.findByDate(store.store_id, date);

      log.debug('Day summary retrieved', {
        storeId: store.store_id,
        date,
        shiftCount: shifts.length,
      });

      return {
        summary,
        shifts,
      };
    } catch (error) {
      log.error('Failed to get day summary', {
        date,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Get day summary by date with shifts' }
);

// ============================================================================
// Close Day Handler
// ============================================================================

/**
 * Close business day
 * API-004: Requires MANAGER role
 * Validates all shifts are closed before allowing day close
 */
registerHandler<DaySummary | DayCloseValidation | ReturnType<typeof createErrorResponse>>(
  'daySummaries:close',
  async (_event, dateInput: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // API-001: Validate date format
    const parseResult = BusinessDateSchema.safeParse(dateInput);
    if (!parseResult.success) {
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        'Invalid date format. Use YYYY-MM-DD'
      );
    }

    const date = parseResult.data;

    try {
      // DB-006: Store-scoped query
      const summary = daySummariesDAL.findByDate(store.store_id, date);

      if (!summary) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, `No summary found for ${date}`);
      }

      // Check if already closed
      if (summary.status === 'CLOSED') {
        return createErrorResponse(IPCErrorCodes.ALREADY_CLOSED, `Day ${date} is already closed`);
      }

      // Validate all shifts are closed
      const shifts = shiftsDAL.findByDate(store.store_id, date);
      const openShifts = shifts.filter((s) => s.status === 'OPEN');

      if (openShifts.length > 0) {
        // Return validation response with open shifts info
        const response: DayCloseValidation = {
          canClose: false,
          openShifts,
          message: `Cannot close day with ${openShifts.length} open shift(s). Close all shifts first.`,
        };

        log.warn('Day close blocked - open shifts exist', {
          date,
          openShiftCount: openShifts.length,
          openShiftIds: openShifts.map((s) => s.shift_id),
        });

        // Return as error for consistency
        return {
          error: IPCErrorCodes.OPEN_SHIFTS,
          message: response.message,
          data: response,
        } as unknown as ReturnType<typeof createErrorResponse>;
      }

      // SEC-006: Parameterized update via DAL
      const closedSummary = daySummariesDAL.close(summary.day_summary_id);

      if (!closedSummary) {
        return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, 'Failed to close day');
      }

      // NOTE: No sync enqueue for day_summary - summaries are calculated server-side
      // Day close is synced via lottery.handlers.ts using day_close entity type
      // with /api/v1/sync/lottery/day/prepare-close and /commit-close endpoints

      // SEC-017: Audit log
      log.info('Day closed', {
        storeId: store.store_id,
        date,
        summaryId: summary.day_summary_id,
        grossSales: closedSummary.gross_sales,
        transactionCount: closedSummary.transaction_count,
      });

      return closedSummary;
    } catch (error) {
      log.error('Failed to close day', {
        date,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'shift_manager',
    description: 'Close business day (requires MANAGER role)',
  }
);

// ============================================================================
// Get Day View Data Handler (Phase 3 - View Pages)
// ============================================================================

/**
 * Day info for ViewDayPage display
 * Pre-computed and formatted for direct frontend rendering
 *
 * API-008: OUTPUT_FILTERING - Only includes fields needed for display
 */
interface DayViewInfo {
  /** Business date formatted for display */
  businessDate: string;
  /** Total number of shifts for the day */
  shiftCount: number;
  /** First shift start time formatted for display */
  firstShiftStarted: string | null;
  /** Last shift end time formatted for display */
  lastShiftEnded: string | null;
  /** Total opening cash from first shift */
  totalOpeningCash: number;
  /** Total closing cash from last shift */
  totalClosingCash: number;
}

/**
 * Summary card data for ViewDayPage (aggregated from all shifts)
 */
interface DayViewSummary {
  insideSales: {
    total: number;
    nonFood: number;
    foodSales: number;
  };
  fuelSales: {
    total: number;
    gallonsSold: number;
  };
  lotterySales: {
    total: number;
    scratchOff: number;
    online: number;
  };
  reserved: null;
}

/**
 * Payment methods data for ViewDayPage (aggregated from all shifts)
 */
interface DayViewPayments {
  receipts: {
    cash: { reports: number; pos: number };
    creditCard: { reports: number; pos: number };
    debitCard: { reports: number; pos: number };
    ebt: { reports: number; pos: number };
  };
  payouts: {
    cashPayouts: { reports: number; pos: number; hasImages: boolean; count: number };
    lotteryPayouts: { reports: number; pos: number; hasImages: boolean };
    gamingPayouts: { reports: number; pos: number; hasImages: boolean };
  };
  netCash: { reports: number; pos: number };
}

/**
 * Sales breakdown data for ViewDayPage (aggregated from all shifts)
 */
interface DayViewSalesBreakdown {
  gasSales: { reports: number; pos: number };
  grocery: { reports: number; pos: number };
  tobacco: { reports: number; pos: number };
  beverages: { reports: number; pos: number };
  snacks: { reports: number; pos: number };
  other: { reports: number; pos: number };
  lottery: {
    instantSales: { reports: number; pos: number };
    instantCashes: { reports: number; pos: number };
    onlineSales: { reports: number; pos: number };
    onlineCashes: { reports: number; pos: number };
  };
  salesTax: { reports: number; pos: number };
  total: { reports: number; pos: number };
}

/**
 * Complete response for days:getViewData
 * All data needed to render ViewDayPage
 */
interface DayViewDataResponse {
  /** Day summary ID */
  daySummaryId: string;
  /** Business date */
  businessDate: string;
  /** Day status */
  status: 'OPEN' | 'CLOSED';
  /** Day info for header/info card */
  dayInfo: DayViewInfo;
  /** Summary cards data */
  summary: DayViewSummary;
  /** Payment methods data */
  payments: DayViewPayments;
  /** Sales breakdown data */
  salesBreakdown: DayViewSalesBreakdown;
  /** Lottery business day ID for lottery components */
  lotteryDayId: string | null;
  /** Timestamps for footer */
  timestamps: {
    createdAt: string;
    closedAt: string | null;
  };
}

/**
 * Helper to format ISO date to display format
 * Example: "Feb 17, 2026 6:00 AM"
 */
function formatDateForDisplay(isoDate: string | null): string {
  if (!isoDate) return '';
  try {
    const date = new Date(isoDate);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return isoDate;
  }
}

/**
 * DayId schema for UUID validation
 */
const DayIdSchema = z.string().uuid('Invalid day ID format');

/**
 * Get complete day view data for ViewDayPage
 *
 * Aggregates data from day_summaries and all shifts for the day into a single
 * response optimized for frontend rendering. Includes day info, summary cards,
 * payment methods, sales breakdown, and lottery day ID.
 *
 * Performance characteristics:
 * - O(1) day_summary lookup by primary key (indexed)
 * - O(n) shifts lookup where n is shifts per day (typically 1-5)
 * - O(m) shift_summaries aggregation where m is summaries per day
 * - Total: O(1) database time, O(n+m) in-memory aggregation
 *
 * @security SEC-006: All queries use parameterized statements via DAL
 * @security DB-006: Store-scoped tenant isolation - day must belong to configured store
 * @security API-001: Input validated via Zod UUID schema
 * @security API-003: Generic error responses, no internal details leaked
 * @security API-008: Only whitelisted fields returned in response
 *
 * Channel: days:getViewData
 */
registerHandler<DayViewDataResponse | ReturnType<typeof createErrorResponse>>(
  'days:getViewData',
  async (_event, dayIdInput: unknown) => {
    // API-001: Validate day ID format (UUID)
    const parseResult = DayIdSchema.safeParse(dayIdInput);
    if (!parseResult.success) {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid day ID format');
    }

    const dayId = parseResult.data;

    // DB-006: Get configured store for tenant isolation
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    try {
      // SEC-006: Parameterized query via DAL
      const daySummary = daySummariesDAL.findById(dayId);
      if (!daySummary) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Day not found');
      }

      // DB-006: Verify day belongs to configured store (tenant isolation)
      if (daySummary.store_id !== store.store_id) {
        log.warn('Day view data access denied - store mismatch', {
          requestedDayId: dayId,
          dayStoreId: daySummary.store_id,
          configuredStoreId: store.store_id,
        });
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Day not found');
      }

      // Get all shifts for this day
      const shifts = shiftsDAL.findByDate(store.store_id, daySummary.business_date);

      // Get lottery business days for this date (for lottery components)
      // BIZ-002: Multiple lottery days can exist per business_date
      // Import dynamically to avoid circular dependencies
      const { lotteryBusinessDaysDAL } = await import('../dal/lottery-business-days.dal');
      // Use findByDateRange with same date to get all lottery days for this business_date
      const lotteryDays = lotteryBusinessDaysDAL.findByDateRange(
        store.store_id,
        daySummary.business_date,
        daySummary.business_date
      );
      // Get the most recent closed lottery day for this date (BIZ-003: Sort by closed_at DESC)
      const closedLotteryDay = lotteryDays
        .filter((d) => d.status === 'CLOSED')
        .sort((a, b) => (b.closed_at || '').localeCompare(a.closed_at || ''))[0];

      // Calculate day info from shifts
      const sortedShifts = [...shifts].sort((a, b) =>
        (a.start_time || '').localeCompare(b.start_time || '')
      );
      const firstShift = sortedShifts[0];
      const lastShift = sortedShifts[sortedShifts.length - 1];

      // Get shift summaries for aggregation
      const { shiftSummariesDAL } = await import('../dal/shift-summaries.dal');
      const shiftSummaries = shiftSummariesDAL.findByDate(store.store_id, daySummary.business_date);

      // Aggregate totals from shift summaries
      let _totalOpeningCash = 0; // Calculated but not yet used in response
      let totalClosingCash = 0;
      let totalFuelGallons = 0;
      let totalFuelSales = 0;
      let totalLotterySales = 0;
      let totalLotteryCashes = 0;
      let totalTaxCollected = 0;
      let totalNetSales = 0;

      for (const ss of shiftSummaries) {
        _totalOpeningCash += ss.opening_cash || 0;
        totalClosingCash += ss.closing_cash || 0;
        totalFuelGallons += ss.fuel_gallons || 0;
        totalFuelSales += ss.fuel_sales || 0;
        totalLotterySales += ss.lottery_sales || 0;
        totalLotteryCashes += ss.lottery_cashes || 0;
        totalTaxCollected += ss.tax_collected || 0;
        totalNetSales += ss.net_sales || 0;
      }

      // Build day info
      const dayInfo: DayViewInfo = {
        businessDate: daySummary.business_date,
        shiftCount: shifts.length,
        firstShiftStarted: firstShift ? formatDateForDisplay(firstShift.start_time) : null,
        lastShiftEnded: lastShift?.end_time ? formatDateForDisplay(lastShift.end_time) : null,
        totalOpeningCash: firstShift ? shiftSummaries[0]?.opening_cash || 0 : 0,
        totalClosingCash: lastShift
          ? shiftSummaries[shiftSummaries.length - 1]?.closing_cash || 0
          : 0,
      };

      // Build summary (use day_summary values where available, else aggregate)
      const summary: DayViewSummary = {
        insideSales: {
          total: daySummary.net_sales || totalNetSales,
          nonFood: Math.round((daySummary.net_sales || totalNetSales) * 0.5), // Estimate
          foodSales: Math.round((daySummary.net_sales || totalNetSales) * 0.5), // Estimate
        },
        fuelSales: {
          total: totalFuelSales,
          gallonsSold: totalFuelGallons,
        },
        lotterySales: {
          total: totalLotterySales,
          scratchOff: Math.round(totalLotterySales * 0.6), // Estimate 60% scratch off
          online: Math.round(totalLotterySales * 0.4), // Estimate 40% online
        },
        reserved: null,
      };

      // Build payments (simplified - aggregates from summaries)
      const payments: DayViewPayments = {
        receipts: {
          cash: { reports: totalClosingCash, pos: totalClosingCash },
          creditCard: { reports: 0, pos: 0 },
          debitCard: { reports: 0, pos: 0 },
          ebt: { reports: 0, pos: 0 },
        },
        payouts: {
          cashPayouts: { reports: 0, pos: 0, hasImages: false, count: 0 },
          lotteryPayouts: {
            reports: -totalLotteryCashes,
            pos: -totalLotteryCashes,
            hasImages: false,
          },
          gamingPayouts: { reports: 0, pos: 0, hasImages: false },
        },
        netCash: { reports: totalNetSales, pos: totalNetSales },
      };

      // Build sales breakdown
      const salesBreakdown: DayViewSalesBreakdown = {
        gasSales: { reports: totalFuelSales, pos: totalFuelSales },
        grocery: { reports: 0, pos: 0 },
        tobacco: { reports: 0, pos: 0 },
        beverages: { reports: 0, pos: 0 },
        snacks: { reports: 0, pos: 0 },
        other: { reports: 0, pos: 0 },
        lottery: {
          instantSales: {
            reports: Math.round(totalLotterySales * 0.6),
            pos: Math.round(totalLotterySales * 0.6),
          },
          instantCashes: {
            reports: -Math.round(Math.abs(totalLotteryCashes) * 0.6),
            pos: -Math.round(Math.abs(totalLotteryCashes) * 0.6),
          },
          onlineSales: {
            reports: Math.round(totalLotterySales * 0.4),
            pos: Math.round(totalLotterySales * 0.4),
          },
          onlineCashes: {
            reports: -Math.round(Math.abs(totalLotteryCashes) * 0.4),
            pos: -Math.round(Math.abs(totalLotteryCashes) * 0.4),
          },
        },
        salesTax: { reports: totalTaxCollected, pos: totalTaxCollected },
        total: {
          reports: daySummary.net_sales || totalNetSales,
          pos: daySummary.net_sales || totalNetSales,
        },
      };

      const response: DayViewDataResponse = {
        daySummaryId: daySummary.day_summary_id,
        businessDate: daySummary.business_date,
        status: daySummary.status,
        dayInfo,
        summary,
        payments,
        salesBreakdown,
        lotteryDayId: closedLotteryDay?.day_id || null,
        timestamps: {
          createdAt: daySummary.created_at,
          closedAt: daySummary.closed_at,
        },
      };

      log.debug('Day view data retrieved', {
        dayId,
        businessDate: daySummary.business_date,
        status: daySummary.status,
        shiftCount: shifts.length,
        hasLotteryDay: !!closedLotteryDay,
      });

      return response;
    } catch (error) {
      log.error('Failed to get day view data', {
        dayId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Get complete day data for view page rendering' }
);
