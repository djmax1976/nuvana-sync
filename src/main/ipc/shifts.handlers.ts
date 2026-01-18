/**
 * Shifts IPC Handlers
 *
 * Provides shift management endpoints including listing, details, and closing.
 * Shift close requires MANAGER role for authorization.
 *
 * @module main/ipc/shifts
 * @security DB-006: Store-scoped queries for tenant isolation
 * @security SEC-006: All queries use prepared statements
 * @security API-004: Role-based authorization for sensitive operations
 */

import { z } from 'zod';
import { registerHandler, createErrorResponse, IPCErrorCodes } from './index';
import { storesDAL } from '../dal/stores.dal';
import { shiftsDAL, type Shift } from '../dal/shifts.dal';
import { transactionsDAL } from '../dal/transactions.dal';
import { syncQueueDAL } from '../dal/sync-queue.dal';
import {
  shiftSummariesDAL,
  shiftFuelSummariesDAL,
  shiftDepartmentSummariesDAL,
  shiftTenderSummariesDAL,
  dayFuelSummariesDAL,
  daySummariesDAL,
  msmOutsideDispenserRecordsDAL,
  type MSMFuelTotals,
  type MSMFuelByGrade,
} from '../dal';
import { createLogger } from '../utils/logger';
import type { ShiftCloseType } from '../../shared/types/shift-events';

// ============================================================================
// Types
// ============================================================================

interface ShiftListParams {
  startDate?: string;
  endDate?: string;
  status?: 'OPEN' | 'CLOSED';
  limit?: number;
  offset?: number;
}

interface ShiftListResponse {
  shifts: Shift[];
  total: number;
  limit: number;
  offset: number;
}

interface ShiftSummary {
  shift: Shift;
  transactionCount: number;
  totalSales: number;
  totalVoided: number;
  // Enhanced summary data from shift_summaries table
  grossSales?: number;
  netSales?: number;
  taxCollected?: number;
  fuelGallons?: number;
  fuelSales?: number;
  lotteryNet?: number;
  departmentBreakdown?: Array<{
    departmentCode: string;
    departmentName: string | null;
    netSales: number;
    transactionCount: number;
  }>;
  tenderBreakdown?: Array<{
    tenderCode: string;
    tenderDisplayName: string | null;
    netAmount: number;
    transactionCount: number;
  }>;
  fuelByGrade?: Array<{
    gradeId: string;
    gradeName: string | null;
    volumeSold: number;
    amountSold: number;
  }>;
}

// ============================================================================
// Input Validation Schemas
// API-001: Schema validation for all inputs
// ============================================================================

const ShiftListParamsSchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
  limit: z.number().int().min(1).max(1000).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

const ShiftIdSchema = z.string().uuid();

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('shifts-handlers');

// ============================================================================
// Helper Functions (Exported for use by parser service)
// ============================================================================

/**
 * Result of determining shift close type
 */
export interface ShiftCloseTypeResult {
  /** Type of close - SHIFT_CLOSE or DAY_CLOSE */
  closeType: ShiftCloseType;
  /** Number of remaining open shifts (0 = day close) */
  remainingOpenShifts: number;
}

/**
 * Determine if closing a shift results in a day close or shift close
 *
 * Day Close = when this shift closes, no other shifts remain open for this business date
 * Shift Close = other registers still have open shifts
 *
 * SEC-006: Uses parameterized DAL method
 * DB-006: Store-scoped via storeId parameter
 *
 * @param storeId - Store identifier
 * @param closingShiftId - ID of the shift being closed
 * @param businessDate - Business date (YYYY-MM-DD)
 * @returns Object with close type and count of remaining open shifts
 */
export function determineShiftCloseType(
  storeId: string,
  closingShiftId: string,
  businessDate: string
): ShiftCloseTypeResult {
  // Query for open shifts excluding the one being closed
  const remainingOpenShifts = shiftsDAL.countOpenShiftsExcluding(
    storeId,
    businessDate,
    closingShiftId
  );

  const closeType: ShiftCloseType = remainingOpenShifts === 0 ? 'DAY_CLOSE' : 'SHIFT_CLOSE';

  log.debug('Determined shift close type', {
    storeId,
    closingShiftId,
    businessDate,
    remainingOpenShifts,
    closeType,
  });

  return { closeType, remainingOpenShifts };
}

// ============================================================================
// IPC Handlers
// ============================================================================

// ============================================================================
// List Shifts Handler
// ============================================================================

/**
 * List shifts with optional filtering and pagination
 * Supports filtering by date range and status
 */
registerHandler<ShiftListResponse | ReturnType<typeof createErrorResponse>>(
  'shifts:list',
  async (_event, paramsInput: unknown) => {
    // Get configured store
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // API-001: Validate input parameters
    const parseResult = ShiftListParamsSchema.safeParse(paramsInput ?? {});
    if (!parseResult.success) {
      log.warn('Invalid shift list params', { errors: parseResult.error.issues });
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        `Invalid parameters: ${parseResult.error.issues.map((i) => i.message).join(', ')}`
      );
    }

    const params = parseResult.data;

    try {
      let shifts: Shift[];
      let total: number;

      // DB-006: All queries are store-scoped
      if (params.startDate && params.endDate) {
        // Filter by date range
        shifts = shiftsDAL.findByDateRange(store.store_id, params.startDate, params.endDate);

        // Apply status filter if provided
        if (params.status) {
          shifts = shifts.filter((s) => s.status === params.status);
        }

        total = shifts.length;

        // Apply pagination in memory (for filtered results)
        shifts = shifts.slice(params.offset, params.offset + params.limit);
      } else {
        // Get paginated results from DAL
        const result = shiftsDAL.findByStore(
          store.store_id,
          { limit: params.limit, offset: params.offset },
          { column: 'business_date', direction: 'DESC' }
        );

        shifts = result.data;

        // Apply status filter if provided
        if (params.status) {
          shifts = shifts.filter((s) => s.status === params.status);
        }

        total = result.total;
      }

      log.debug('Shifts listed', {
        storeId: store.store_id,
        count: shifts.length,
        total,
      });

      return {
        shifts,
        total,
        limit: params.limit,
        offset: params.offset,
      };
    } catch (error) {
      log.error('Failed to list shifts', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'List shifts with filtering and pagination' }
);

// ============================================================================
// Get Shift by ID Handler
// ============================================================================

/**
 * Get a single shift by ID
 */
registerHandler<Shift | ReturnType<typeof createErrorResponse>>(
  'shifts:getById',
  async (_event, shiftIdInput: unknown) => {
    // API-001: Validate shift ID
    const parseResult = ShiftIdSchema.safeParse(shiftIdInput);
    if (!parseResult.success) {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid shift ID format');
    }

    const shiftId = parseResult.data;

    try {
      // SEC-006: Parameterized query via DAL
      const shift = shiftsDAL.findById(shiftId);

      if (!shift) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Shift not found');
      }

      // DB-006: Verify shift belongs to configured store
      const store = storesDAL.getConfiguredStore();
      if (!store || shift.store_id !== store.store_id) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Shift not found');
      }

      return shift;
    } catch (error) {
      log.error('Failed to get shift', {
        shiftId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Get shift by ID' }
);

// ============================================================================
// Get Shift Summary Handler
// ============================================================================

/**
 * Get shift summary with transaction totals
 * Includes aggregated sales and transaction counts from shift_summaries tables
 * Falls back to calculating from transactions if summary data not available
 */
registerHandler<ShiftSummary | ReturnType<typeof createErrorResponse>>(
  'shifts:getSummary',
  async (_event, shiftIdInput: unknown) => {
    // API-001: Validate shift ID
    const parseResult = ShiftIdSchema.safeParse(shiftIdInput);
    if (!parseResult.success) {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid shift ID format');
    }

    const shiftId = parseResult.data;

    try {
      const shift = shiftsDAL.findById(shiftId);
      if (!shift) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Shift not found');
      }

      // DB-006: Verify shift belongs to configured store
      const store = storesDAL.getConfiguredStore();
      if (!store || shift.store_id !== store.store_id) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Shift not found');
      }

      // Try to get summary from the new shift_summaries table first
      const shiftSummary = shiftSummariesDAL.findByShiftId(store.store_id, shiftId);

      if (shiftSummary) {
        // Get detailed breakdowns from child tables
        const departmentSummaries = shiftDepartmentSummariesDAL.findByShiftSummary(
          shiftSummary.shift_summary_id
        );
        const tenderSummaries = shiftTenderSummariesDAL.findByShiftSummary(
          shiftSummary.shift_summary_id
        );
        const fuelTotals = shiftFuelSummariesDAL.getShiftTotals(shiftSummary.shift_summary_id);

        // Get fuel sales by grade from shift_fuel_summaries
        const fuelByGradeAggregated = shiftFuelSummariesDAL.getAggregateByGrade(
          shiftSummary.shift_summary_id
        );

        log.debug('Fuel by grade data from shift_fuel_summaries', {
          shiftId,
          shiftSummaryId: shiftSummary.shift_summary_id,
          fuelGradeCount: fuelByGradeAggregated.length,
        });

        // Map from new schema aggregation format
        const fuelByGradeData = fuelByGradeAggregated.map((f) => ({
          grade_id: f.gradeId,
          grade_name: f.gradeName,
          volume_sold: f.totalVolume,
          amount_sold: f.totalSales,
        }));

        const summary: ShiftSummary = {
          shift,
          transactionCount: shiftSummary.transaction_count,
          totalSales: shiftSummary.net_sales,
          totalVoided: shiftSummary.void_count,
          // Enhanced summary data
          grossSales: shiftSummary.gross_sales,
          netSales: shiftSummary.net_sales,
          taxCollected: shiftSummary.tax_collected,
          fuelGallons: shiftSummary.fuel_gallons ?? fuelTotals.totalVolume,
          fuelSales: shiftSummary.fuel_sales ?? fuelTotals.totalSales,
          lotteryNet: shiftSummary.lottery_net ?? undefined,
          departmentBreakdown: departmentSummaries.map((d) => ({
            departmentCode: d.department_code,
            departmentName: d.department_name,
            netSales: d.net_sales,
            transactionCount: d.transaction_count,
          })),
          tenderBreakdown: tenderSummaries.map((t) => ({
            tenderCode: t.tender_code,
            tenderDisplayName: t.tender_display_name,
            netAmount: t.net_amount,
            transactionCount: t.transaction_count,
          })),
          fuelByGrade:
            fuelByGradeData.length > 0
              ? fuelByGradeData.map((f) => ({
                  gradeId: f.grade_id || 'UNKNOWN',
                  gradeName: f.grade_name,
                  volumeSold: f.volume_sold,
                  amountSold: f.amount_sold,
                }))
              : undefined,
        };

        log.debug('Shift summary retrieved from shift_summaries', {
          shiftId,
          transactionCount: shiftSummary.transaction_count,
          netSales: shiftSummary.net_sales,
        });

        return summary;
      }

      // Fallback: Calculate from transactions if no summary record exists
      // This maintains backward compatibility for shifts before the new schema
      const transactions = transactionsDAL.findByShift(store.store_id, shiftId);

      let totalSales = 0;
      let totalVoided = 0;
      let transactionCount = 0;

      for (const txn of transactions) {
        if (txn.voided) {
          totalVoided += txn.total_amount;
        } else {
          totalSales += txn.total_amount;
          transactionCount += 1;
        }
      }

      const summary: ShiftSummary = {
        shift,
        transactionCount,
        totalSales,
        totalVoided,
      };

      log.debug('Shift summary calculated from transactions (fallback)', {
        shiftId,
        transactionCount,
        totalSales,
      });

      return summary;
    } catch (error) {
      log.error('Failed to get shift summary', {
        shiftId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Get shift summary with transaction totals' }
);

// ============================================================================
// Find Open Shifts Handler
// ============================================================================

/**
 * Find all open shifts for the current store
 * Used for shift close validation
 */
registerHandler<Shift[] | ReturnType<typeof createErrorResponse>>(
  'shifts:findOpenShifts',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    try {
      // Get today's date
      const today = new Date().toISOString().split('T')[0];

      // DB-006: Store-scoped query
      const shifts = shiftsDAL.findByDate(store.store_id, today);
      const openShifts = shifts.filter((s) => s.status === 'OPEN');

      log.debug('Open shifts found', {
        storeId: store.store_id,
        count: openShifts.length,
      });

      return openShifts;
    } catch (error) {
      log.error('Failed to find open shifts', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Find all open shifts' }
);

// ============================================================================
// Close Shift Handler
// ============================================================================

/**
 * Close a shift
 * API-004: Requires MANAGER role for authorization
 * SEC-017: Audit logged operation
 */
registerHandler<Shift | ReturnType<typeof createErrorResponse>>(
  'shifts:close',
  async (_event, shiftIdInput: unknown) => {
    // API-001: Validate shift ID
    const parseResult = ShiftIdSchema.safeParse(shiftIdInput);
    if (!parseResult.success) {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid shift ID format');
    }

    const shiftId = parseResult.data;

    try {
      const shift = shiftsDAL.findById(shiftId);
      if (!shift) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Shift not found');
      }

      // DB-006: Verify shift belongs to configured store
      const store = storesDAL.getConfiguredStore();
      if (!store || shift.store_id !== store.store_id) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Shift not found');
      }

      // Check if already closed
      if (shift.status === 'CLOSED') {
        return createErrorResponse(IPCErrorCodes.ALREADY_CLOSED, 'Shift is already closed');
      }

      // SEC-006: Parameterized update via DAL
      const closedShift = shiftsDAL.close(shiftId);

      if (!closedShift) {
        return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, 'Failed to close shift');
      }

      // Also close the shift summary if it exists
      const shiftSummary = shiftSummariesDAL.findByShiftId(store.store_id, shiftId);
      if (shiftSummary && closedShift.end_time) {
        shiftSummariesDAL.closeShiftSummary(
          store.store_id,
          shiftSummary.shift_summary_id,
          closedShift.end_time
        );
      }

      // Enqueue for cloud sync
      syncQueueDAL.enqueue({
        store_id: store.store_id,
        entity_type: 'shift',
        entity_id: shiftId,
        operation: 'UPDATE',
        payload: closedShift,
      });

      // SEC-017: Audit log
      log.info('Shift closed', {
        shiftId,
        storeId: store.store_id,
        shiftNumber: closedShift.shift_number,
        businessDate: closedShift.business_date,
      });

      return closedShift;
    } catch (error) {
      log.error('Failed to close shift', {
        shiftId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'shift_manager',
    description: 'Close a shift (requires MANAGER role)',
  }
);

// ============================================================================
// Shift Fuel Data Types
// ============================================================================

/**
 * Fuel data response for a shift with inside/outside breakdown
 * Matches MSM data structure for accurate reporting
 */
interface ShiftFuelDataResponse {
  /** Shift identifier */
  shiftId: string;
  /** Parent shift summary ID */
  shiftSummaryId: string | null;
  /** Business date */
  businessDate: string;
  /** Aggregated fuel totals with inside/outside breakdown */
  totals: MSMFuelTotals;
  /** Fuel breakdown by grade with inside/outside split */
  byGrade: MSMFuelByGrade[];
  /** Whether this data comes from MSM (more detailed) vs FGM */
  hasMSMData: boolean;
}

/**
 * Daily fuel totals response with inside/outside breakdown
 */
interface DailyFuelTotalsResponse {
  /** Store identifier */
  storeId: string;
  /** Business date */
  businessDate: string;
  /** Aggregated daily fuel totals */
  totals: {
    totalVolume: number;
    totalAmount: number;
    totalDiscount: number;
    insideVolume: number;
    insideAmount: number;
    outsideVolume: number;
    outsideAmount: number;
    averagePrice: number;
  };
  /** Fuel breakdown by grade */
  byGrade: MSMFuelByGrade[];
  /** Data source indicator */
  fuelSource: 'FGM' | 'MSM' | 'CALCULATED' | 'MANUAL';
}

// ============================================================================
// Fuel Data Validation Schemas
// API-001: Schema validation for all inputs
// ============================================================================

const BusinessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)');

// ============================================================================
// Get Fuel Data by Shift Handler
// ============================================================================

/**
 * Get fuel data for a specific shift with inside/outside breakdown
 *
 * Returns MSM-sourced fuel data when available, which includes:
 * - Inside fuel (cash) by grade with volume
 * - Outside fuel (credit/debit) by grade with volume
 * - Total fuel by grade
 * - Fuel discounts
 *
 * @security SEC-006: Parameterized queries via DAL
 * @security DB-006: Store-scoped tenant isolation
 */
registerHandler<ShiftFuelDataResponse | ReturnType<typeof createErrorResponse>>(
  'shifts:getFuelData',
  async (_event, shiftIdInput: unknown) => {
    // API-001: Validate shift ID format
    const parseResult = ShiftIdSchema.safeParse(shiftIdInput);
    if (!parseResult.success) {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid shift ID format');
    }

    const shiftId = parseResult.data;

    try {
      // DB-006: Get store for tenant isolation
      const store = storesDAL.getConfiguredStore();
      if (!store) {
        return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
      }

      // SEC-006: Parameterized query via DAL
      const shift = shiftsDAL.findById(shiftId);
      if (!shift) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Shift not found');
      }

      // DB-006: Verify shift belongs to configured store (tenant isolation)
      if (shift.store_id !== store.store_id) {
        log.warn('Shift access denied - store mismatch', {
          requestedShiftId: shiftId,
          shiftStoreId: shift.store_id,
          configuredStoreId: store.store_id,
        });
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Shift not found');
      }

      // Get shift summary to access fuel data
      const shiftSummary = shiftSummariesDAL.findByShiftId(store.store_id, shiftId);

      if (!shiftSummary) {
        // No summary exists yet - return empty fuel data
        log.debug('No shift summary found for fuel data', { shiftId });
        return {
          shiftId,
          shiftSummaryId: null,
          businessDate: shift.business_date,
          totals: {
            totalVolume: 0,
            totalAmount: 0,
            totalDiscount: 0,
            transactionCount: 0,
            insideVolume: 0,
            insideAmount: 0,
            outsideVolume: 0,
            outsideAmount: 0,
            averagePrice: 0,
          },
          byGrade: [],
          hasMSMData: false,
        };
      }

      // Use Period 2 (Daily) data from day_fuel_summaries for accurate inside/outside breakdown
      // Period 2 files have complete data with outside volume by grade
      // Period 98 (Shift) files only have inside data + outside amount (no volume by grade)
      const dailyFuelTotals = dayFuelSummariesDAL.getDailyTotalsByStoreAndDate(
        store.store_id,
        shift.business_date
      );

      // Get fuel breakdown by grade from Period 2 daily data (has actual outside volume)
      const dailyByGrade = dayFuelSummariesDAL.getFuelByGradeForStoreAndDate(
        store.store_id,
        shift.business_date
      );

      const hasMSMData = dailyFuelTotals.fuelSource === 'MSM';

      const totals: MSMFuelTotals = {
        insideVolume: dailyFuelTotals.insideVolume,
        insideAmount: dailyFuelTotals.insideAmount,
        outsideVolume: dailyFuelTotals.outsideVolume,
        outsideAmount: dailyFuelTotals.outsideAmount,
        totalVolume: dailyFuelTotals.totalVolume,
        totalAmount: dailyFuelTotals.totalAmount,
        totalDiscount: dailyFuelTotals.totalDiscount,
        transactionCount: 0,
        averagePrice:
          dailyFuelTotals.totalVolume > 0
            ? dailyFuelTotals.totalAmount / dailyFuelTotals.totalVolume
            : 0,
      };

      // Map daily fuel by grade to expected format
      const byGrade: MSMFuelByGrade[] = dailyByGrade.map((g) => ({
        gradeId: g.gradeId,
        gradeName: g.gradeName,
        totalVolume: g.totalVolume,
        totalAmount: g.totalAmount,
        insideVolume: g.insideVolume,
        insideAmount: g.insideAmount,
        outsideVolume: g.outsideVolume,
        outsideAmount: g.outsideAmount,
        discountAmount: g.discountAmount,
        averagePrice: g.averagePrice,
      }));

      log.debug('Shift fuel data from Period 2 daily data', {
        shiftId,
        businessDate: shift.business_date,
        hasMSMData,
        insideVolume: totals.insideVolume,
        outsideVolume: totals.outsideVolume,
        totalVolume: totals.totalVolume,
        gradeCount: byGrade.length,
      });

      return {
        shiftId,
        shiftSummaryId: shiftSummary.shift_summary_id,
        businessDate: shift.business_date,
        totals,
        byGrade,
        hasMSMData,
      };
    } catch (error) {
      log.error('Failed to get shift fuel data', {
        shiftId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Get fuel data for a shift with inside/outside breakdown' }
);

// ============================================================================
// Get Daily Fuel Totals Handler
// ============================================================================

/**
 * Get daily fuel totals for a store and date with inside/outside breakdown
 *
 * Returns aggregated fuel data from day_fuel_summaries which contains:
 * - Total fuel volume and amount by grade
 * - Inside (cash) fuel breakdown
 * - Outside (credit/debit) fuel breakdown
 * - Fuel discounts
 *
 * This data comes from MSM Period 1 (Daily) files which have complete
 * fuel data including outside volume by grade.
 *
 * @security SEC-006: Parameterized queries via DAL
 * @security DB-006: Store-scoped tenant isolation
 */
registerHandler<DailyFuelTotalsResponse | ReturnType<typeof createErrorResponse>>(
  'shifts:getDailyFuelTotals',
  async (_event, dateInput: unknown) => {
    // API-001: Validate date format
    const parseResult = BusinessDateSchema.safeParse(dateInput);
    if (!parseResult.success) {
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        'Invalid date format. Expected YYYY-MM-DD.'
      );
    }

    const businessDate = parseResult.data;

    try {
      // DB-006: Get store for tenant isolation
      const store = storesDAL.getConfiguredStore();
      if (!store) {
        return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
      }

      // First check if we have day-level fuel summaries (from MSM Period 1)
      const dayFuelSummaries = dayFuelSummariesDAL.findByBusinessDate(store.store_id, businessDate);

      if (dayFuelSummaries.length > 0) {
        // Use day-level fuel data (more accurate from MSM Period 1)
        const dailyTotals = dayFuelSummariesDAL.getDailyTotalsByStoreAndDate(
          store.store_id,
          businessDate
        );
        const byGrade = dayFuelSummariesDAL.getFuelByGradeForStoreAndDate(
          store.store_id,
          businessDate
        );

        log.debug('Daily fuel totals retrieved from day_fuel_summaries', {
          storeId: store.store_id,
          businessDate,
          totalVolume: dailyTotals.totalVolume,
          gradeCount: byGrade.length,
          fuelSource: dailyTotals.fuelSource,
        });

        return {
          storeId: store.store_id,
          businessDate,
          totals: {
            totalVolume: dailyTotals.totalVolume,
            totalAmount: dailyTotals.totalAmount,
            totalDiscount: dailyTotals.totalDiscount,
            insideVolume: dailyTotals.insideVolume,
            insideAmount: dailyTotals.insideAmount,
            outsideVolume: dailyTotals.outsideVolume,
            outsideAmount: dailyTotals.outsideAmount,
            averagePrice: dailyTotals.averagePrice,
          },
          byGrade,
          fuelSource: dailyTotals.fuelSource,
        };
      }

      // Fallback: Aggregate from shift-level fuel summaries
      const shiftFuelTotals = shiftFuelSummariesDAL.getTotalsByBusinessDate(
        store.store_id,
        businessDate
      );
      const shiftFuelByGrade = shiftFuelSummariesDAL.getByGradeForBusinessDate(
        store.store_id,
        businessDate
      );

      log.debug('Daily fuel totals aggregated from shift_fuel_summaries', {
        storeId: store.store_id,
        businessDate,
        totalVolume: shiftFuelTotals.totalVolume,
        gradeCount: shiftFuelByGrade.length,
      });

      return {
        storeId: store.store_id,
        businessDate,
        totals: {
          totalVolume: shiftFuelTotals.totalVolume,
          totalAmount: shiftFuelTotals.totalAmount,
          totalDiscount: shiftFuelTotals.totalDiscount,
          insideVolume: shiftFuelTotals.insideVolume,
          insideAmount: shiftFuelTotals.insideAmount,
          outsideVolume: shiftFuelTotals.outsideVolume,
          outsideAmount: shiftFuelTotals.outsideAmount,
          averagePrice: shiftFuelTotals.averagePrice,
        },
        byGrade: shiftFuelByGrade,
        fuelSource: 'CALCULATED',
      };
    } catch (error) {
      log.error('Failed to get daily fuel totals', {
        businessDate,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Get daily fuel totals with inside/outside breakdown' }
);
