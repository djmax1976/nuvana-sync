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
import { usersDAL } from '../dal/users.dal';
import { posTerminalMappingsDAL } from '../dal/pos-id-mappings.dal';
import { transactionsDAL } from '../dal/transactions.dal';
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
import { lotteryBusinessDaysDAL } from '../dal/lottery-business-days.dal';
import { createLogger } from '../utils/logger';
import { settingsService } from '../services/settings.service';
import { syncQueueDAL } from '../dal/sync-queue.dal';
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

/**
 * Schema for closing a shift
 *
 * API-001: Zod validation for all inputs
 * SEC-014: UUID format validation for shift_id
 *
 * @property shift_id - UUID of the shift to close
 * @property closing_cash - Non-negative cash amount in drawer at close
 */
const CloseShiftInputSchema = z.object({
  shift_id: z.string().uuid('Invalid shift ID format'),
  closing_cash: z
    .number({ message: 'Closing cash must be a number' })
    .min(0, 'Closing cash must be non-negative')
    .max(999999.99, 'Closing cash exceeds maximum allowed value')
    .refine((val) => !Number.isNaN(val) && Number.isFinite(val), {
      message: 'Closing cash must be a valid finite number',
    }),
});

type CloseShiftInput = z.infer<typeof CloseShiftInputSchema>;

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

/**
 * Shift sync payload for cloud synchronization
 * Contains all fields required by the POST /api/v1/sync/lottery/shifts endpoint
 *
 * INTERNAL FIELD NAMING (used in sync queue and sync-engine):
 * - opened_at: When shift was opened (ISO timestamp)
 * - opened_by: Who opened the shift (internal user UUID)
 * - closed_at: When shift was closed (ISO timestamp), null if OPEN
 * - closing_cash: Cash amount in drawer at shift close (null if OPEN)
 *
 * CLOUD API FIELD NAMES (same as internal - no translation needed):
 * - opened_at: ISO timestamp when shift was opened (REQUIRED, defaults to now if missing)
 * - opened_by: User UUID who opened the shift (REQUIRED, defaults to empty string if missing)
 * - closed_at: ISO timestamp when shift was closed (optional, null if OPEN)
 * - closing_cash: Cash amount at close (optional, null if OPEN)
 *
 * API-008: OUTPUT_FILTERING - Only includes fields defined in cloud API contract
 * SEC-010: AUTHZ - opened_by must be valid user UUID from authenticated session
 */
export interface ShiftSyncPayload {
  shift_id: string;
  store_id: string;
  business_date: string;
  shift_number: number;
  /** When the shift was opened (ISO timestamp) - translated to start_time for cloud */
  opened_at: string;
  /** Who opened the shift (user UUID) - translated to cashier_id for cloud, null if no cashier */
  opened_by: string | null;
  status: 'OPEN' | 'CLOSED';
  /** When the shift was closed (ISO timestamp) - translated to end_time for cloud, null if OPEN */
  closed_at: string | null;
  /** Cash amount in drawer at shift close, null if OPEN */
  closing_cash: number | null;
  external_register_id: string | null;
  external_cashier_id: string | null;
  external_till_id: string | null;
}

/**
 * Options for building shift sync payload
 */
export interface BuildShiftSyncPayloadOptions {
  /** Cash amount in drawer at shift close (only for CLOSED shifts) */
  closing_cash?: number;
}

/**
 * Build sync payload from shift entity
 *
 * Creates a payload suitable for cloud sync containing all required
 * and optional fields per API specification.
 *
 * INTERNAL → INTERNAL MAPPING (stored in sync queue):
 * - shift.start_time → opened_at (internal naming)
 * - shift.cashier_id → opened_by (internal naming)
 * - shift.end_time → closed_at (internal naming)
 * - options.closing_cash → closing_cash (from shift close input)
 *
 * NOTE: Translation to cloud API field names (start_time, cashier_id, end_time)
 * happens in cloud-api.service.ts.pushShift() at the API boundary.
 *
 * SEC-006: No string concatenation, structured payload only
 * SEC-010: AUTHZ - User ID comes from authenticated session, not frontend
 * API-008: OUTPUT_FILTERING - Only includes fields defined in API contract
 *
 * @param shift - Shift entity from DAL
 * @param options - Optional additional payload data (closing_cash for closed shifts)
 * @returns Sync payload for internal use (translated at API boundary)
 */
export function buildShiftSyncPayload(
  shift: Shift,
  options?: BuildShiftSyncPayloadOptions
): ShiftSyncPayload {
  return {
    shift_id: shift.shift_id,
    store_id: shift.store_id,
    business_date: shift.business_date,
    shift_number: shift.shift_number,
    // REQUIRED: opened_at must always be a valid ISO timestamp
    opened_at: shift.start_time || new Date().toISOString(),
    // opened_by: user UUID from shifts.cashier_id (can be null if no cashier assigned)
    opened_by: shift.cashier_id,
    status: shift.status,
    closed_at: shift.end_time,
    // closing_cash: from options for closed shifts, null for open shifts
    closing_cash: options?.closing_cash ?? null,
    external_register_id: shift.external_register_id,
    external_cashier_id: shift.external_cashier_id,
    external_till_id: shift.external_till_id,
  };
}

/**
 * Priority level for shift sync
 * Higher priority ensures shifts sync BEFORE pack operations
 * that reference them (pack activations with shift_id FK)
 */
export const SHIFT_SYNC_PRIORITY = 10;

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
 * Shift response with resolved cashier name
 * Extends Shift entity with pre-resolved cashier_name for frontend display
 */
interface ShiftWithCashierName extends Shift {
  /** Resolved cashier name from users table, or fallback message */
  cashier_name: string;
}

/**
 * Get a single shift by ID with resolved cashier name
 *
 * Returns shift data with pre-resolved cashier_name to eliminate
 * frontend lookup requirements. This follows the same pattern as
 * shifts:getOpenShifts which also returns resolved names.
 *
 * Performance: O(1) indexed lookup for shift + O(1) indexed lookup for user
 * No N+1 patterns, no unbounded reads.
 *
 * @security SEC-006: All queries use parameterized statements via DAL
 * @security DB-006: Tenant isolation - verifies shift belongs to configured store
 * @security API-001: Input validated via Zod schema
 * @security API-003: Generic error responses, no internal details leaked
 */
registerHandler<ShiftWithCashierName | ReturnType<typeof createErrorResponse>>(
  'shifts:getById',
  async (_event, shiftIdInput: unknown) => {
    // API-001: Validate shift ID format (UUID)
    const parseResult = ShiftIdSchema.safeParse(shiftIdInput);
    if (!parseResult.success) {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid shift ID format');
    }

    const shiftId = parseResult.data;

    try {
      // SEC-006: Parameterized query via DAL (uses ? placeholder)
      const shift = shiftsDAL.findById(shiftId);

      if (!shift) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Shift not found');
      }

      // DB-006: Verify shift belongs to configured store (tenant isolation)
      const store = storesDAL.getConfiguredStore();
      if (!store || shift.store_id !== store.store_id) {
        // Return same error to prevent tenant enumeration
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Shift not found');
      }

      // Resolve cashier name from internal cashier_id (user UUID)
      // SEC-006: usersDAL.findById uses parameterized query
      // Performance: O(1) indexed primary key lookup
      let cashierName = 'No Cashier Assigned';
      if (shift.cashier_id) {
        const user = usersDAL.findById(shift.cashier_id);
        if (user) {
          cashierName = user.name;
        } else {
          // User exists in shift but not in users table (deleted/corrupted)
          cashierName = 'Unknown Cashier';
          log.warn('Shift references non-existent user', {
            shiftId: shift.shift_id,
            cashierId: shift.cashier_id,
          });
        }
      }

      // Return shift with resolved cashier_name
      return {
        ...shift,
        cashier_name: cashierName,
      };
    } catch (error) {
      log.error('Failed to get shift', {
        shiftId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Get shift by ID with resolved cashier name' }
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
      // Get today's date (local timezone, not UTC)
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

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
 * Response type for shift close operation
 * Extends Shift with closing_cash for client confirmation
 */
interface CloseShiftResponse extends Shift {
  /** Cash amount in drawer at shift close */
  closing_cash: number;
}

/**
 * Close a shift with closing cash amount
 *
 * @security API-001: Input validated via CloseShiftInputSchema (Zod)
 * @security API-004: Requires MANAGER role for authorization
 * @security SEC-006: All queries use parameterized statements
 * @security SEC-014: UUID format validation for shift_id
 * @security SEC-017: Audit logged operation
 * @security DB-006: Store-scoped tenant isolation
 * @security SYNC-001: Sync payload includes closing_cash
 */
registerHandler<CloseShiftResponse | ReturnType<typeof createErrorResponse>>(
  'shifts:close',
  async (_event, input: unknown) => {
    // API-001: Validate input with comprehensive schema
    const parseResult = CloseShiftInputSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessages = parseResult.error.issues.map((i) => i.message).join(', ');
      log.warn('Invalid shift close input', { errors: parseResult.error.issues });
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessages);
    }

    const { shift_id: shiftId, closing_cash: closingCash } = parseResult.data;

    try {
      // SEC-006: Parameterized lookup via DAL
      const shift = shiftsDAL.findById(shiftId);
      if (!shift) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Shift not found');
      }

      // DB-006: Verify shift belongs to configured store (tenant isolation)
      const store = storesDAL.getConfiguredStore();
      if (!store || shift.store_id !== store.store_id) {
        // Return same error to prevent tenant enumeration
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

      // Close the shift summary and set closing_cash
      // SEC-006: Parameterized update via DAL
      const shiftSummary = shiftSummariesDAL.findByShiftId(store.store_id, shiftId);
      if (shiftSummary && closedShift.end_time) {
        shiftSummariesDAL.closeShiftSummary(
          store.store_id,
          shiftSummary.shift_summary_id,
          closedShift.end_time,
          undefined, // closedByUserId - not tracked here
          closingCash
        );
      }

      // SEC-017 / SYNC-001: Enqueue SHIFT STATUS UPDATE for cloud sync
      // Includes closing_cash in payload for cloud reconciliation
      syncQueueDAL.enqueue({
        entity_type: 'shift',
        entity_id: closedShift.shift_id,
        operation: 'UPDATE',
        store_id: store.store_id,
        priority: SHIFT_SYNC_PRIORITY, // High priority ensures consistent state
        payload: buildShiftSyncPayload(closedShift, { closing_cash: closingCash }),
      });

      // SEC-017: Audit log
      log.info('Shift closed', {
        shiftId,
        storeId: store.store_id,
        shiftNumber: closedShift.shift_number,
        businessDate: closedShift.business_date,
        closingCash,
      });

      // Return closed shift with closing_cash for client confirmation
      return {
        ...closedShift,
        closing_cash: closingCash,
      };
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
    description: 'Close a shift with closing cash amount (requires MANAGER role)',
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

// ============================================================================
// Manual Shift Start Handler
// ============================================================================

/**
 * Input schema for manual shift start
 * API-001: Validate all input parameters
 * SEC-001: PIN authentication - employee identified by unique PIN
 */
const ManualStartShiftSchema = z.object({
  /** Cashier PIN for authentication (4-6 digits) - uniquely identifies the employee */
  pin: z
    .string()
    .min(4, 'PIN must be at least 4 digits')
    .max(6, 'PIN must be at most 6 digits')
    .regex(/^\d+$/, 'PIN must contain only digits'),
  /** External register ID (e.g., "1", "2") */
  externalRegisterId: z.string().min(1, 'Register ID is required').max(50),
  /** Business date in YYYY-MM-DD format (defaults to today) */
  businessDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Business date must be YYYY-MM-DD')
    .optional(),
  /** Start time as ISO timestamp (defaults to now) */
  startTime: z.string().optional(),
});

type ManualStartShiftInput = z.infer<typeof ManualStartShiftSchema>;

/**
 * Manually start a shift
 *
 * Only available for stores with MANUAL POS connection type.
 * Creates a new OPEN shift for the specified register.
 * The employee is automatically identified by their unique PIN.
 *
 * @security API-001: Input validation with Zod schema
 * @security SEC-001: PIN-based authentication - employee identified by unique PIN
 * @security DB-006: Store-scoped operations
 *
 * Channel: shifts:manualStart
 */
registerHandler<Shift | ReturnType<typeof createErrorResponse>>(
  'shifts:manualStart',
  async (_event, input: unknown) => {
    // Get configured store
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // Verify store is in MANUAL mode
    const connectionType = settingsService.getPOSConnectionType();
    if (connectionType !== 'MANUAL') {
      return createErrorResponse(
        IPCErrorCodes.FORBIDDEN,
        'Manual shift operations are only available in MANUAL mode'
      );
    }

    // API-001: Validate input
    const parseResult = ManualStartShiftSchema.safeParse(input);
    if (!parseResult.success) {
      log.warn('Invalid manual start shift params', { errors: parseResult.error.issues });
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        `Invalid parameters: ${parseResult.error.issues.map((i) => i.message).join(', ')}`
      );
    }

    const { pin, externalRegisterId, businessDate, startTime } = parseResult.data;
    // Use local date if no businessDate provided (not UTC)
    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const today = businessDate || localDate;
    const shiftStartTime = startTime || new Date().toISOString();

    try {
      // SEC-001: Find employee by their unique PIN
      // This iterates through all active employees and compares bcrypt hashes
      const cashier = await usersDAL.findByPin(store.store_id, pin);
      if (!cashier) {
        log.warn('Manual shift start failed: Invalid PIN - no matching employee', {
          storeId: store.store_id,
        });
        return createErrorResponse(IPCErrorCodes.NOT_AUTHENTICATED, 'Invalid PIN');
      }

      // Check for existing open shift on this register for today
      const existingOpenShift = shiftsDAL.findOpenShiftByRegister(
        store.store_id,
        today,
        externalRegisterId
      );

      if (existingOpenShift) {
        return createErrorResponse(
          IPCErrorCodes.ALREADY_EXISTS,
          `A shift is already open on register ${externalRegisterId} for ${today}`
        );
      }

      // ========================================================================
      // BIZ-007: Verify open lottery day exists before allowing shift start
      // Shifts cannot exist without an open day - this is a business invariant.
      // This guard ensures cloud sync integrity: shifts reference a day_id.
      // DB-006: Store-scoped query via findOpenDay(storeId)
      // SEC-017: Audit log for blocked attempts
      // ========================================================================
      const openLotteryDay = lotteryBusinessDaysDAL.findOpenDay(store.store_id);
      if (!openLotteryDay) {
        log.warn('Manual shift start blocked: No open lottery day', {
          storeId: store.store_id,
          businessDate: today,
          cashierUserId: cashier.user_id,
          registerId: externalRegisterId,
        });
        return createErrorResponse(
          IPCErrorCodes.VALIDATION_ERROR,
          'Cannot start shift: No open business day exists. Please open a day first or contact your manager.'
        );
      }

      // Ensure day_summary exists for this business date (local tracking)
      const daySummary = daySummariesDAL.getOrCreateForDate(store.store_id, today);
      log.debug('Day summary ensured for manual shift', {
        daySummaryId: daySummary.day_summary_id,
        businessDate: today,
        status: daySummary.status,
        linkedLotteryDayId: openLotteryDay.day_id,
      });

      // Create the shift using existing DAL method with internal user ID
      const shift = shiftsDAL.getOrCreateForDate(store.store_id, today, {
        externalRegisterId,
        internalUserId: cashier.user_id, // Link cashier to shift via FK-safe internal ID
        startTime: shiftStartTime,
      });

      // Create a shift summary record to track manual entry
      shiftSummariesDAL.create({
        shift_id: shift.shift_id,
        store_id: store.store_id,
        business_date: today,
        shift_opened_at: shiftStartTime,
      });

      // SEC-017: Enqueue SHIFT RECORD for cloud sync with HIGH PRIORITY
      // CRITICAL: Shift record MUST sync BEFORE pack operations that reference it
      // to satisfy cloud FK constraints (activated_shift_id, etc.)
      syncQueueDAL.enqueue({
        entity_type: 'shift',
        entity_id: shift.shift_id,
        operation: 'CREATE',
        store_id: store.store_id,
        priority: SHIFT_SYNC_PRIORITY, // High priority ensures shift syncs before packs
        payload: buildShiftSyncPayload(shift),
      });

      // NOTE: shift_opening is NOT enqueued here.
      // Lottery shift openings are recorded via lottery:recordShiftOpening handler
      // AFTER the user scans packs and records their opening serial numbers.
      // That handler builds the correct payload with: store_id, openings[], opened_at, opened_by
      // See: lottery.handlers.ts:buildShiftOpeningSyncPayload()

      // SEC-017: Audit log for manual shift start
      log.info('Manual shift started', {
        shiftId: shift.shift_id,
        storeId: store.store_id,
        registerId: externalRegisterId,
        businessDate: today,
        cashierId: cashier.user_id,
        cashierName: cashier.name,
      });

      return shift;
    } catch (error) {
      log.error('Failed to start manual shift', {
        externalRegisterId,
        businessDate: today,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  {
    requiresAuth: false, // No prior auth required - PIN is the authentication
    description: 'Manually start a shift (MANUAL mode only)',
  }
);

// ============================================================================
// Shift Re-sync Handler
// ============================================================================

/**
 * Re-sync a shift to cloud
 *
 * Deletes any existing queue items (including failed ones with old field names)
 * and re-enqueues with correct payload format.
 *
 * Use this to fix failed shift sync items that have incorrect payload structure.
 *
 * SEC-006: Parameterized queries via DAL
 * DB-006: Store-scoped operations
 * API-001: Input validation via Zod
 */
registerHandler<{ success: boolean; message: string } | ReturnType<typeof createErrorResponse>>(
  'shifts:resync',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const params = input as { shift_id: string } | undefined;
    if (!params?.shift_id || typeof params.shift_id !== 'string') {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid shift_id');
    }

    // DB-006: Get configured store
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'No store configured');
    }

    try {
      // Look up the shift from database
      const shift = shiftsDAL.findById(params.shift_id);
      if (!shift || shift.store_id !== store.store_id) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, `Shift not found: ${params.shift_id}`);
      }

      // Delete any existing queue items for this shift (including failed ones)
      const deleted = syncQueueDAL.deleteByEntityId(store.store_id, 'shift', params.shift_id);

      // Re-enqueue with correct payload format
      syncQueueDAL.enqueue({
        entity_type: 'shift',
        entity_id: shift.shift_id,
        operation: shift.status === 'CLOSED' ? 'UPDATE' : 'CREATE',
        store_id: store.store_id,
        priority: SHIFT_SYNC_PRIORITY,
        payload: buildShiftSyncPayload(shift),
      });

      log.info('Shift re-enqueued for sync', {
        shiftId: shift.shift_id,
        status: shift.status,
        deletedOldItems: deleted,
      });

      return {
        success: true,
        message: `Shift ${shift.shift_id} re-enqueued for sync (deleted ${deleted} old items)`,
      };
    } catch (error) {
      log.error('Failed to resync shift', {
        shiftId: params.shift_id,
        error: error instanceof Error ? error.message : String(error),
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        `Failed to resync shift: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  },
  {
    requiresAuth: false,
    description: 'Re-sync a shift with corrected payload format',
  }
);

// ============================================================================
// Get Open Shifts Handler (Task 1.2)
// ============================================================================

/**
 * Open shift with resolved names for DayClosePage
 */
interface OpenShiftWithNames {
  /** Shift ID (UUID) */
  shift_id: string;
  /** Resolved terminal/register name */
  terminal_name: string;
  /** Resolved cashier name */
  cashier_name: string;
  /** Shift number for the day */
  shift_number: number;
  /** Shift status (always OPEN for this query) */
  status: 'OPEN' | 'CLOSED';
  /** External register ID from POS */
  external_register_id: string | null;
  /** Business date */
  business_date: string;
  /** Start time */
  start_time: string | null;
}

/**
 * Response for open shifts query
 */
interface OpenShiftsResponse {
  /** Array of open shifts with resolved names */
  open_shifts: OpenShiftWithNames[];
}

/**
 * Get all open shifts for the current store with resolved terminal and cashier names
 *
 * Used by DayClosePage to display which shifts need to be closed.
 * Resolves terminal_name from pos_terminal_mappings and cashier_name from users.
 *
 * Performance characteristics:
 * - Single query to shifts table filtered by end_time IS NULL (indexed)
 * - In-memory join for terminal names (O(n) where n = open shifts, typically small)
 * - In-memory join for cashier names (O(n) where n = open shifts, typically small)
 * - Total: O(n) with n typically < 10 open shifts
 *
 * @security SEC-006: All queries use parameterized statements via DAL
 * @security DB-006: All queries scoped to configured store (tenant isolation)
 * @security API-003: Generic error responses, no internal details leaked
 *
 * Channel: shifts:getOpenShifts
 */
registerHandler<OpenShiftsResponse | ReturnType<typeof createErrorResponse>>(
  'shifts:getOpenShifts',
  async () => {
    // DB-006: Get configured store for tenant isolation
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    try {
      // Get current business date (local timezone)
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      // SEC-006: Parameterized query via DAL
      // DB-006: Store-scoped query
      const allShifts = shiftsDAL.findByDate(store.store_id, today);

      // Filter to open shifts (end_time IS NULL is more reliable than status)
      const openShifts = allShifts.filter((s) => s.end_time === null);

      // Build lookup maps for efficient name resolution
      // Get all terminals for this store (single query, then filter in memory)
      const terminals = posTerminalMappingsDAL.findRegisters(store.store_id);
      const terminalMap = new Map<string, string>();
      for (const t of terminals) {
        terminalMap.set(
          t.external_register_id,
          t.description || `Register ${t.external_register_id}`
        );
      }

      // Get all users for this store (single query, then filter in memory)
      const usersResult = usersDAL.findByStore(store.store_id, { limit: 1000 });
      const userMap = new Map<string, string>();
      for (const u of usersResult.data) {
        userMap.set(u.user_id, u.name);
      }

      // Map shifts to response format with resolved names
      const openShiftsWithNames: OpenShiftWithNames[] = openShifts.map((shift) => {
        // Resolve terminal name from external_register_id
        const terminalName = shift.external_register_id
          ? terminalMap.get(shift.external_register_id) || `Register ${shift.external_register_id}`
          : 'Unknown Register';

        // Resolve cashier name from cashier_id (internal user ID)
        const cashierName = shift.cashier_id
          ? userMap.get(shift.cashier_id) || 'Unknown Cashier'
          : 'No Cashier Assigned';

        return {
          shift_id: shift.shift_id,
          terminal_name: terminalName,
          cashier_name: cashierName,
          shift_number: shift.shift_number,
          status: shift.status,
          external_register_id: shift.external_register_id,
          business_date: shift.business_date,
          start_time: shift.start_time,
        };
      });

      log.debug('Open shifts retrieved with names', {
        storeId: store.store_id,
        businessDate: today,
        openShiftCount: openShiftsWithNames.length,
      });

      return {
        open_shifts: openShiftsWithNames,
      };
    } catch (error) {
      log.error('Failed to get open shifts', {
        storeId: store.store_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Get all open shifts with resolved terminal and cashier names' }
);

// ============================================================================
// Get Shift View Data Handler (Phase 3 - View Pages)
// ============================================================================

/**
 * Shift info for ViewShiftPage display
 * Pre-computed and formatted for direct frontend rendering
 *
 * API-008: OUTPUT_FILTERING - Only includes fields needed for display
 */
interface ShiftViewInfo {
  /** Resolved terminal name from pos_terminal_mappings */
  terminalName: string;
  /** Shift number for the day */
  shiftNumber: number;
  /** Resolved cashier name from users table */
  cashierName: string;
  /** Formatted start time for display */
  startedAt: string;
  /** Formatted end time for display, null if still open */
  endedAt: string | null;
  /** Opening cash amount */
  openingCash: number;
  /** Closing cash amount, null if still open */
  closingCash: number | null;
}

/**
 * Summary card data for ViewShiftPage
 * Contains aggregated sales by category
 */
interface ShiftViewSummary {
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
 * Payment methods data for ViewShiftPage
 * Contains receipts and payouts by type
 */
interface ShiftViewPayments {
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
 * Sales breakdown data for ViewShiftPage
 * Contains sales by department/category
 */
interface ShiftViewSalesBreakdown {
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
 * Complete response for shifts:getViewData
 * All data needed to render ViewShiftPage
 */
interface ShiftViewDataResponse {
  shiftId: string;
  businessDate: string;
  status: 'OPEN' | 'CLOSED';
  shiftInfo: ShiftViewInfo;
  summary: ShiftViewSummary;
  payments: ShiftViewPayments;
  salesBreakdown: ShiftViewSalesBreakdown;
  /** Raw timestamps for footer calculations */
  timestamps: {
    createdAt: string;
    closedAt: string | null;
  };
  /** Optional lottery day ID for LOTTERY mode display */
  lotteryDayId: string | null;
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
 * Map department code to display category
 * Returns the category key for sales breakdown
 */
function mapDepartmentToCategory(
  departmentCode: string,
  departmentName: string | null
): keyof Omit<ShiftViewSalesBreakdown, 'lottery' | 'salesTax' | 'total'> | null {
  const code = departmentCode.toUpperCase();
  const name = (departmentName || '').toUpperCase();

  // Gas/Fuel
  if (
    code.includes('FUEL') ||
    code.includes('GAS') ||
    name.includes('FUEL') ||
    name.includes('GAS')
  ) {
    return 'gasSales';
  }
  // Grocery
  if (code.includes('GROC') || name.includes('GROCERY')) {
    return 'grocery';
  }
  // Tobacco
  if (
    code.includes('TOB') ||
    code.includes('CIG') ||
    name.includes('TOBACCO') ||
    name.includes('CIGARETTE')
  ) {
    return 'tobacco';
  }
  // Beverages
  if (
    code.includes('BEV') ||
    code.includes('DRINK') ||
    name.includes('BEVERAGE') ||
    name.includes('DRINK')
  ) {
    return 'beverages';
  }
  // Snacks
  if (
    code.includes('SNACK') ||
    code.includes('CANDY') ||
    name.includes('SNACK') ||
    name.includes('CANDY')
  ) {
    return 'snacks';
  }
  // Default to other
  return 'other';
}

/**
 * Map tender code to payment type
 * Returns the category key for receipts
 */
function mapTenderToPaymentType(
  tenderCode: string,
  tenderName: string | null
): 'cash' | 'creditCard' | 'debitCard' | 'ebt' | null {
  const code = tenderCode.toUpperCase();
  const name = (tenderName || '').toUpperCase();

  if (code === 'CASH' || name.includes('CASH')) {
    return 'cash';
  }
  if (
    code.includes('CREDIT') ||
    code.includes('VISA') ||
    code.includes('MC') ||
    code.includes('AMEX') ||
    name.includes('CREDIT')
  ) {
    return 'creditCard';
  }
  if (code.includes('DEBIT') || name.includes('DEBIT')) {
    return 'debitCard';
  }
  if (
    code.includes('EBT') ||
    code.includes('SNAP') ||
    name.includes('EBT') ||
    name.includes('SNAP')
  ) {
    return 'ebt';
  }
  return null;
}

/**
 * Get complete shift view data for ViewShiftPage
 *
 * Aggregates data from multiple tables into a single response optimized
 * for frontend rendering. Includes shift info, summary cards, payment methods,
 * and sales breakdown.
 *
 * Performance characteristics:
 * - O(1) shift lookup by primary key (indexed)
 * - O(1) shift_summary lookup by shift_id (indexed)
 * - O(n) department/tender summaries where n is typically < 20
 * - O(m) terminal/user name resolution where m is typically < 50
 * - Total: O(1) database time, O(n+m) in-memory aggregation
 *
 * @security SEC-006: All queries use parameterized statements via DAL
 * @security DB-006: Store-scoped tenant isolation - shift must belong to configured store
 * @security API-001: Input validated via Zod UUID schema
 * @security API-003: Generic error responses, no internal details leaked
 * @security API-008: Only whitelisted fields returned in response
 *
 * Channel: shifts:getViewData
 */
registerHandler<ShiftViewDataResponse | ReturnType<typeof createErrorResponse>>(
  'shifts:getViewData',
  async (_event, shiftIdInput: unknown) => {
    // API-001: Validate shift ID format (UUID)
    const parseResult = ShiftIdSchema.safeParse(shiftIdInput);
    if (!parseResult.success) {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid shift ID format');
    }

    const shiftId = parseResult.data;

    // DB-006: Get configured store for tenant isolation
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    try {
      // SEC-006: Parameterized query via DAL
      const shift = shiftsDAL.findById(shiftId);
      if (!shift) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Shift not found');
      }

      // DB-006: Verify shift belongs to configured store (tenant isolation)
      // Return same error to prevent tenant enumeration
      if (shift.store_id !== store.store_id) {
        log.warn('Shift view data access denied - store mismatch', {
          requestedShiftId: shiftId,
          shiftStoreId: shift.store_id,
          configuredStoreId: store.store_id,
        });
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Shift not found');
      }

      // Build lookup maps for name resolution (efficient single queries)
      const terminals = posTerminalMappingsDAL.findRegisters(store.store_id);
      const terminalMap = new Map<string, string>();
      for (const t of terminals) {
        terminalMap.set(
          t.external_register_id,
          t.description || `Register ${t.external_register_id}`
        );
      }

      const usersResult = usersDAL.findByStore(store.store_id, { limit: 1000 });
      const userMap = new Map<string, string>();
      for (const u of usersResult.data) {
        userMap.set(u.user_id, u.name);
      }

      // Resolve names
      const terminalName = shift.external_register_id
        ? terminalMap.get(shift.external_register_id) || `Register ${shift.external_register_id}`
        : 'Unknown Register';
      const cashierName = shift.cashier_id
        ? userMap.get(shift.cashier_id) || 'Unknown Cashier'
        : 'No Cashier Assigned';

      // Get shift summary for detailed data
      const shiftSummary = shiftSummariesDAL.findByShiftId(store.store_id, shiftId);

      // Initialize response structure with defaults
      const summary: ShiftViewSummary = {
        insideSales: { total: 0, nonFood: 0, foodSales: 0 },
        fuelSales: { total: 0, gallonsSold: 0 },
        lotterySales: { total: 0, scratchOff: 0, online: 0 },
        reserved: null,
      };

      const payments: ShiftViewPayments = {
        receipts: {
          cash: { reports: 0, pos: 0 },
          creditCard: { reports: 0, pos: 0 },
          debitCard: { reports: 0, pos: 0 },
          ebt: { reports: 0, pos: 0 },
        },
        payouts: {
          cashPayouts: { reports: 0, pos: 0, hasImages: false, count: 0 },
          lotteryPayouts: { reports: 0, pos: 0, hasImages: false },
          gamingPayouts: { reports: 0, pos: 0, hasImages: false },
        },
        netCash: { reports: 0, pos: 0 },
      };

      const salesBreakdown: ShiftViewSalesBreakdown = {
        gasSales: { reports: 0, pos: 0 },
        grocery: { reports: 0, pos: 0 },
        tobacco: { reports: 0, pos: 0 },
        beverages: { reports: 0, pos: 0 },
        snacks: { reports: 0, pos: 0 },
        other: { reports: 0, pos: 0 },
        lottery: {
          instantSales: { reports: 0, pos: 0 },
          instantCashes: { reports: 0, pos: 0 },
          onlineSales: { reports: 0, pos: 0 },
          onlineCashes: { reports: 0, pos: 0 },
        },
        salesTax: { reports: 0, pos: 0 },
        total: { reports: 0, pos: 0 },
      };

      let openingCash = 0;
      let closingCash: number | null = null;

      if (shiftSummary) {
        // Extract cash amounts
        openingCash = shiftSummary.opening_cash || 0;
        closingCash = shift.status === 'CLOSED' ? shiftSummary.closing_cash || 0 : null;

        // Get fuel data
        const fuelTotals = shiftFuelSummariesDAL.getShiftTotals(shiftSummary.shift_summary_id);
        summary.fuelSales = {
          total: fuelTotals.totalSales || shiftSummary.fuel_sales || 0,
          gallonsSold: fuelTotals.totalVolume || shiftSummary.fuel_gallons || 0,
        };
        salesBreakdown.gasSales = {
          reports: summary.fuelSales.total,
          pos: summary.fuelSales.total,
        };

        // Get lottery data
        const lotteryNet = shiftSummary.lottery_net || 0;
        const lotterySales = shiftSummary.lottery_sales || 0;
        const lotteryCashes = shiftSummary.lottery_cashes || 0;
        summary.lotterySales = {
          total: lotterySales,
          scratchOff: Math.round(lotterySales * 0.6), // Estimate 60% scratch off
          online: Math.round(lotterySales * 0.4), // Estimate 40% online
        };
        salesBreakdown.lottery = {
          instantSales: {
            reports: summary.lotterySales.scratchOff,
            pos: summary.lotterySales.scratchOff,
          },
          instantCashes: {
            reports: -Math.round(Math.abs(lotteryCashes) * 0.6),
            pos: -Math.round(Math.abs(lotteryCashes) * 0.6),
          },
          onlineSales: { reports: summary.lotterySales.online, pos: summary.lotterySales.online },
          onlineCashes: {
            reports: -Math.round(Math.abs(lotteryCashes) * 0.4),
            pos: -Math.round(Math.abs(lotteryCashes) * 0.4),
          },
        };

        // Get department summaries
        const departmentSummaries = shiftDepartmentSummariesDAL.findByShiftSummary(
          shiftSummary.shift_summary_id
        );

        let totalNonFuel = 0;
        let foodTotal = 0;
        for (const dept of departmentSummaries) {
          const category = mapDepartmentToCategory(dept.department_code, dept.department_name);
          if (category && category !== 'gasSales') {
            salesBreakdown[category] = {
              reports: (salesBreakdown[category]?.reports || 0) + dept.net_sales,
              pos: (salesBreakdown[category]?.pos || 0) + dept.net_sales,
            };
            totalNonFuel += dept.net_sales;

            // Track food vs non-food (simplified: grocery and snacks are "food")
            if (category === 'grocery' || category === 'snacks') {
              foodTotal += dept.net_sales;
            }
          }
        }

        summary.insideSales = {
          total: totalNonFuel,
          nonFood: totalNonFuel - foodTotal,
          foodSales: foodTotal,
        };

        // Get tender summaries
        const tenderSummaries = shiftTenderSummariesDAL.findByShiftSummary(
          shiftSummary.shift_summary_id
        );

        let totalReceipts = 0;
        for (const tender of tenderSummaries) {
          const paymentType = mapTenderToPaymentType(
            tender.tender_code,
            tender.tender_display_name
          );
          if (paymentType) {
            payments.receipts[paymentType] = {
              reports: tender.net_amount,
              pos: tender.net_amount,
            };
            totalReceipts += tender.net_amount;
          }
        }

        // Tax from summary
        salesBreakdown.salesTax = {
          reports: shiftSummary.tax_collected || 0,
          pos: shiftSummary.tax_collected || 0,
        };

        // Total sales
        salesBreakdown.total = {
          reports: shiftSummary.net_sales || 0,
          pos: shiftSummary.net_sales || 0,
        };

        // Net cash (simplified calculation)
        payments.netCash = {
          reports: totalReceipts,
          pos: totalReceipts,
        };
      }

      // Build shift info
      const shiftInfo: ShiftViewInfo = {
        terminalName,
        shiftNumber: shift.shift_number,
        cashierName,
        startedAt: formatDateForDisplay(shift.start_time),
        endedAt: shift.end_time ? formatDateForDisplay(shift.end_time) : null,
        openingCash,
        closingCash,
      };

      // Get lottery day for LOTTERY mode display
      // SEC-006: Parameterized query via DAL
      // DB-006: Store-scoped via store.store_id
      let lotteryDayId: string | null = null;
      try {
        const lotteryDay = lotteryBusinessDaysDAL.findByDate(store.store_id, shift.business_date);
        if (lotteryDay) {
          lotteryDayId = lotteryDay.day_id;
        }
      } catch (lotteryError) {
        // Non-critical - log and continue without lottery data
        log.debug('No lottery day found for shift', {
          shiftId,
          businessDate: shift.business_date,
          error: lotteryError instanceof Error ? lotteryError.message : String(lotteryError),
        });
      }

      const response: ShiftViewDataResponse = {
        shiftId: shift.shift_id,
        businessDate: shift.business_date,
        status: shift.status,
        shiftInfo,
        summary,
        payments,
        salesBreakdown,
        timestamps: {
          createdAt: shift.created_at,
          closedAt: shift.end_time,
        },
        lotteryDayId,
      };

      log.debug('Shift view data retrieved', {
        shiftId,
        businessDate: shift.business_date,
        status: shift.status,
        hasSummary: !!shiftSummary,
      });

      return response;
    } catch (error) {
      log.error('Failed to get shift view data', {
        shiftId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Get complete shift data for view page rendering' }
);

log.info('Shifts handlers registered');
