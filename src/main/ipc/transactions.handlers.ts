/**
 * Transactions IPC Handlers
 *
 * Provides transaction listing and detail endpoints.
 * All operations are read-only for dashboard display.
 *
 * @module main/ipc/transactions
 * @security DB-006: Store-scoped queries for tenant isolation
 * @security SEC-006: All queries use prepared statements
 */

import { z } from 'zod';
import { registerHandler, createErrorResponse, IPCErrorCodes } from './index';
import { storesDAL } from '../dal/stores.dal';
import {
  transactionsDAL,
  type Transaction,
  type TransactionWithDetails,
} from '../dal/transactions.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

interface TransactionListParams {
  startDate?: string;
  endDate?: string;
  shiftId?: string;
  minAmount?: number;
  maxAmount?: number;
  limit?: number;
  offset?: number;
}

interface TransactionListResponse {
  transactions: Transaction[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// ============================================================================
// Input Validation Schemas
// API-001: Schema validation for all inputs
// ============================================================================

const TransactionListParamsSchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  shiftId: z.string().uuid().optional(),
  minAmount: z.number().min(0).optional(),
  maxAmount: z.number().min(0).optional(),
  limit: z.number().int().min(1).max(1000).optional().default(100),
  offset: z.number().int().min(0).optional().default(0),
});

const TransactionIdSchema = z.string().uuid();

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('transactions-handlers');

// ============================================================================
// List Transactions Handler
// ============================================================================

/**
 * List transactions with filtering and pagination
 * Supports filtering by date range, shift, and amount range
 */
registerHandler<TransactionListResponse | ReturnType<typeof createErrorResponse>>(
  'transactions:list',
  async (_event, paramsInput: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // API-001: Validate input parameters
    const parseResult = TransactionListParamsSchema.safeParse(paramsInput ?? {});
    if (!parseResult.success) {
      log.warn('Invalid transaction list params', { errors: parseResult.error.issues });
      return createErrorResponse(
        IPCErrorCodes.VALIDATION_ERROR,
        `Invalid parameters: ${parseResult.error.issues.map((i) => i.message).join(', ')}`
      );
    }

    const params = parseResult.data;

    try {
      let transactions: Transaction[];
      let total: number;

      // DB-006: All queries are store-scoped
      if (params.shiftId) {
        // Filter by shift
        transactions = transactionsDAL.findByShift(store.store_id, params.shiftId);
        total = transactions.length;

        // Apply amount filters in memory
        if (params.minAmount !== undefined) {
          transactions = transactions.filter((t) => t.total_amount >= params.minAmount!);
        }
        if (params.maxAmount !== undefined) {
          transactions = transactions.filter((t) => t.total_amount <= params.maxAmount!);
        }

        // Apply pagination
        transactions = transactions.slice(params.offset, params.offset + params.limit);
      } else if (params.startDate && params.endDate) {
        // Filter by date range with pagination
        const result = transactionsDAL.findByDateRange(
          store.store_id,
          params.startDate,
          params.endDate,
          params.limit,
          params.offset
        );

        transactions = result.data;
        total = result.total;

        // Apply amount filters in memory
        if (params.minAmount !== undefined || params.maxAmount !== undefined) {
          transactions = transactions.filter((t) => {
            if (params.minAmount !== undefined && t.total_amount < params.minAmount) {
              return false;
            }
            if (params.maxAmount !== undefined && t.total_amount > params.maxAmount) {
              return false;
            }
            return true;
          });
        }
      } else {
        // Get paginated results from DAL
        const result = transactionsDAL.findByStore(
          store.store_id,
          { limit: params.limit, offset: params.offset },
          { column: 'created_at', direction: 'DESC' }
        );

        transactions = result.data;
        total = result.total;

        // Apply amount filters in memory
        if (params.minAmount !== undefined || params.maxAmount !== undefined) {
          transactions = transactions.filter((t) => {
            if (params.minAmount !== undefined && t.total_amount < params.minAmount) {
              return false;
            }
            if (params.maxAmount !== undefined && t.total_amount > params.maxAmount) {
              return false;
            }
            return true;
          });
        }
      }

      log.debug('Transactions listed', {
        storeId: store.store_id,
        count: transactions.length,
        total,
      });

      return {
        transactions,
        total,
        limit: params.limit,
        offset: params.offset,
        hasMore: params.offset + transactions.length < total,
      };
    } catch (error) {
      log.error('Failed to list transactions', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'List transactions with filtering and pagination' }
);

// ============================================================================
// Get Transaction by ID Handler
// ============================================================================

/**
 * Get transaction by ID with full details
 * Includes line items and payments
 */
registerHandler<TransactionWithDetails | ReturnType<typeof createErrorResponse>>(
  'transactions:getById',
  async (_event, transactionIdInput: unknown) => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    // API-001: Validate transaction ID
    const parseResult = TransactionIdSchema.safeParse(transactionIdInput);
    if (!parseResult.success) {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid transaction ID format');
    }

    const transactionId = parseResult.data;

    try {
      // SEC-006: Parameterized query via DAL
      const transaction = transactionsDAL.findByIdWithDetails(transactionId);

      if (!transaction) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Transaction not found');
      }

      // DB-006: Verify transaction belongs to configured store
      if (transaction.store_id !== store.store_id) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Transaction not found');
      }

      log.debug('Transaction retrieved', {
        transactionId,
        lineItemCount: transaction.lineItems.length,
        paymentCount: transaction.payments.length,
      });

      return transaction;
    } catch (error) {
      log.error('Failed to get transaction', {
        transactionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Get transaction by ID with details' }
);
