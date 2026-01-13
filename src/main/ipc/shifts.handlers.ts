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
import { createLogger } from '../utils/logger';

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
 * Includes aggregated sales and transaction counts
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

      // Get transactions for this shift
      // DB-006: Store-scoped query
      const transactions = transactionsDAL.findByShift(store.store_id, shiftId);

      // Calculate summary metrics in application code
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

      log.debug('Shift summary retrieved', {
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
