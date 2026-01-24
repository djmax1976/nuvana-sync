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

interface DaySummaryListParams {
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
