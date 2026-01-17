/**
 * Transactions Data Access Layer
 *
 * CRUD operations for POS transactions, line items, and payments.
 * Supports creating transactions with nested line items and payments.
 *
 * @module main/dal/transactions
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 */

import { StoreBasedDAL, type StoreEntity, type PaginatedResult } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Transaction entity
 */
export interface Transaction extends StoreEntity {
  transaction_id: string;
  store_id: string;
  shift_id: string | null;
  business_date: string;
  transaction_number: number | null;
  transaction_time: string | null;
  register_id: string | null;
  cashier_id: string | null;
  total_amount: number;
  payment_type: string | null;
  voided: number;
  void_reason: string | null;
  created_at: string;
}

/**
 * Transaction line item entity
 */
export interface TransactionLineItem extends StoreEntity {
  line_item_id: string;
  store_id: string;
  transaction_id: string;
  line_number: number;
  item_code: string | null;
  description: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  department_id: string | null;
  tax_amount: number;
  discount_amount: number;
  voided: number;
  created_at: string;
}

/**
 * Transaction payment entity
 */
export interface TransactionPayment extends StoreEntity {
  payment_id: string;
  store_id: string;
  transaction_id: string;
  payment_type: string;
  amount: number;
  tender_id: string | null;
  reference_number: string | null;
  created_at: string;
}

/**
 * Transaction with line items and payments
 */
export interface TransactionWithDetails extends Transaction {
  lineItems: TransactionLineItem[];
  payments: TransactionPayment[];
}

/**
 * Line type discriminator for fuel vs merchandise
 */
export type LineType = 'fuel' | 'merchandise' | 'prepay';

/**
 * Line status for voided/cancelled items
 */
export type LineStatus = 'normal' | 'void' | 'cancel' | 'refund';

/**
 * Service level codes for fuel transactions
 */
export type ServiceLevel = 'self' | 'full' | 'mini';

/**
 * Line item creation data (enhanced for PJR parsing)
 */
export interface CreateLineItemData {
  line_number: number;
  line_type?: LineType;
  line_status?: LineStatus;
  item_code?: string;
  description?: string;
  quantity?: number;
  unit_price?: number;
  total_price?: number;
  department_id?: string;
  tax_amount?: number;
  discount_amount?: number;
  // Fuel-specific fields
  fuel_grade_id?: string;
  fuel_position_id?: string;
  service_level?: ServiceLevel;
  actual_price?: number;
  entry_method?: string;
  tax_level_id?: string;
}

/**
 * Payment creation data (enhanced for PJR parsing)
 */
export interface CreatePaymentData {
  payment_type: string;
  amount: number;
  tender_id?: string;
  tender_sub_code?: string;
  reference_number?: string;
  change_amount?: number;
}

/**
 * Tax summary creation data (from PJR TransactionTax elements)
 */
export interface CreateTaxSummaryData {
  tax_level_id: string;
  taxable_sales_amount?: number;
  tax_collected_amount?: number;
  taxable_sales_refunded_amount?: number;
  tax_refunded_amount?: number;
  tax_exempt_sales_amount?: number;
  tax_exempt_sales_refunded_amount?: number;
  tax_forgiven_sales_amount?: number;
  tax_forgiven_sales_refunded_amount?: number;
  tax_forgiven_amount?: number;
}

/**
 * Transaction creation data (enhanced for PJR parsing)
 */
export interface CreateTransactionData {
  transaction_id?: string;
  store_id: string;
  shift_id?: string;
  business_date: string;
  transaction_number?: number;
  transaction_time?: string;
  register_id?: string;
  cashier_id?: string;
  total_amount?: number;
  payment_type?: string;
  // PJR-specific fields
  event_sequence_id?: number;
  training_mode?: boolean;
  outside_sale?: boolean;
  offline?: boolean;
  suspended?: boolean;
  till_id?: string;
  receipt_time?: string;
  event_start_time?: string;
  event_end_time?: string;
  gross_amount?: number;
  net_amount?: number;
  tax_amount?: number;
  tax_exempt_amount?: number;
  direction?: 'Collected' | 'Refunded';
  linked_transaction_id?: string;
  link_reason?: string;
  // Nested data
  lineItems?: CreateLineItemData[];
  payments?: CreatePaymentData[];
  taxSummaries?: CreateTaxSummaryData[];
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('transactions-dal');

// ============================================================================
// Transactions DAL
// ============================================================================

/**
 * Data Access Layer for transactions
 */
export class TransactionsDAL extends StoreBasedDAL<Transaction> {
  protected readonly tableName = 'transactions';
  protected readonly primaryKey = 'transaction_id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'business_date',
    'transaction_time',
    'transaction_number',
    'total_amount',
  ]);

  /**
   * Create a transaction with optional line items, payments, and tax summaries
   * Uses database transaction for atomicity
   * SEC-006: All queries use parameterized statements
   * Enhanced for complete PJR (POSJournal) parsing
   *
   * @param data - Transaction creation data
   * @returns Created transaction with details
   */
  createWithDetails(data: CreateTransactionData): TransactionWithDetails {
    const transactionId = data.transaction_id || this.generateId();
    const now = this.now();

    return this.withTransaction(() => {
      // Create transaction with all PJR fields
      const txnStmt = this.db.prepare(`
        INSERT INTO transactions (
          transaction_id, store_id, shift_id, business_date,
          transaction_number, transaction_time, register_id, cashier_id,
          total_amount, payment_type, voided,
          event_sequence_id, training_mode, outside_sale, offline, suspended,
          till_id, receipt_time, event_start_time, event_end_time,
          gross_amount, net_amount, tax_amount, tax_exempt_amount, direction,
          linked_transaction_id, link_reason,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      txnStmt.run(
        transactionId,
        data.store_id,
        data.shift_id || null,
        data.business_date,
        data.transaction_number || null,
        data.transaction_time || now,
        data.register_id || null,
        data.cashier_id || null,
        data.total_amount || 0,
        data.payment_type || null,
        data.event_sequence_id || null,
        data.training_mode ? 1 : 0,
        data.outside_sale ? 1 : 0,
        data.offline ? 1 : 0,
        data.suspended ? 1 : 0,
        data.till_id || null,
        data.receipt_time || null,
        data.event_start_time || null,
        data.event_end_time || null,
        data.gross_amount || 0,
        data.net_amount || 0,
        data.tax_amount || 0,
        data.tax_exempt_amount || 0,
        data.direction || 'Collected',
        data.linked_transaction_id || null,
        data.link_reason || null,
        now
      );

      // Create line items with enhanced fields for fuel/merchandise
      const lineItems: TransactionLineItem[] = [];
      if (data.lineItems && data.lineItems.length > 0) {
        const lineStmt = this.db.prepare(`
          INSERT INTO transaction_line_items (
            line_item_id, store_id, transaction_id, line_number,
            line_type, line_status,
            item_code, description, quantity, unit_price, total_price,
            department_id, tax_amount, discount_amount, voided,
            fuel_grade_id, fuel_position_id, service_level, actual_price,
            entry_method, tax_level_id,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const line of data.lineItems) {
          const lineId = this.generateId();
          lineStmt.run(
            lineId,
            data.store_id,
            transactionId,
            line.line_number,
            line.line_type || 'merchandise',
            line.line_status || 'normal',
            line.item_code || null,
            line.description || null,
            line.quantity ?? 1,
            line.unit_price ?? 0,
            line.total_price ?? 0,
            line.department_id || null,
            line.tax_amount ?? 0,
            line.discount_amount ?? 0,
            line.fuel_grade_id || null,
            line.fuel_position_id || null,
            line.service_level || null,
            line.actual_price ?? null,
            line.entry_method || null,
            line.tax_level_id || null,
            now
          );

          lineItems.push({
            line_item_id: lineId,
            store_id: data.store_id,
            transaction_id: transactionId,
            line_number: line.line_number,
            item_code: line.item_code || null,
            description: line.description || null,
            quantity: line.quantity ?? 1,
            unit_price: line.unit_price ?? 0,
            total_price: line.total_price ?? 0,
            department_id: line.department_id || null,
            tax_amount: line.tax_amount ?? 0,
            discount_amount: line.discount_amount ?? 0,
            voided: 0,
            created_at: now,
          });
        }
      }

      // Create payments with enhanced fields
      const payments: TransactionPayment[] = [];
      if (data.payments && data.payments.length > 0) {
        const payStmt = this.db.prepare(`
          INSERT INTO transaction_payments (
            payment_id, store_id, transaction_id, payment_type,
            amount, tender_id, tender_sub_code, reference_number, change_amount,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const payment of data.payments) {
          const paymentId = this.generateId();
          payStmt.run(
            paymentId,
            data.store_id,
            transactionId,
            payment.payment_type,
            payment.amount,
            payment.tender_id || null,
            payment.tender_sub_code || null,
            payment.reference_number || null,
            payment.change_amount || 0,
            now
          );

          payments.push({
            payment_id: paymentId,
            store_id: data.store_id,
            transaction_id: transactionId,
            payment_type: payment.payment_type,
            amount: payment.amount,
            tender_id: payment.tender_id || null,
            reference_number: payment.reference_number || null,
            created_at: now,
          });
        }
      }

      // Create tax summaries (from PJR TransactionTax elements)
      if (data.taxSummaries && data.taxSummaries.length > 0) {
        const taxStmt = this.db.prepare(`
          INSERT INTO transaction_tax_summaries (
            tax_summary_id, store_id, transaction_id, tax_level_id,
            taxable_sales_amount, tax_collected_amount,
            taxable_sales_refunded_amount, tax_refunded_amount,
            tax_exempt_sales_amount, tax_exempt_sales_refunded_amount,
            tax_forgiven_sales_amount, tax_forgiven_sales_refunded_amount,
            tax_forgiven_amount, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const tax of data.taxSummaries) {
          const taxId = this.generateId();
          taxStmt.run(
            taxId,
            data.store_id,
            transactionId,
            tax.tax_level_id,
            tax.taxable_sales_amount ?? 0,
            tax.tax_collected_amount ?? 0,
            tax.taxable_sales_refunded_amount ?? 0,
            tax.tax_refunded_amount ?? 0,
            tax.tax_exempt_sales_amount ?? 0,
            tax.tax_exempt_sales_refunded_amount ?? 0,
            tax.tax_forgiven_sales_amount ?? 0,
            tax.tax_forgiven_sales_refunded_amount ?? 0,
            tax.tax_forgiven_amount ?? 0,
            now
          );
        }
      }

      const transaction = this.findById(transactionId);
      if (!transaction) {
        throw new Error(`Failed to retrieve created transaction: ${transactionId}`);
      }

      log.info('Transaction created', {
        transactionId,
        lineItemCount: lineItems.length,
        paymentCount: payments.length,
        taxSummaryCount: data.taxSummaries?.length || 0,
      });

      return {
        ...transaction,
        lineItems,
        payments,
      };
    });
  }

  /**
   * Get transaction with all details
   *
   * @param transactionId - Transaction ID
   * @returns Transaction with line items and payments
   */
  findByIdWithDetails(transactionId: string): TransactionWithDetails | undefined {
    const transaction = this.findById(transactionId);
    if (!transaction) {
      return undefined;
    }

    const lineItems = this.getLineItems(transactionId);
    const payments = this.getPayments(transactionId);

    return {
      ...transaction,
      lineItems,
      payments,
    };
  }

  /**
   * Get line items for a transaction
   * SEC-006: Parameterized query
   *
   * @param transactionId - Transaction ID
   * @returns Array of line items
   */
  getLineItems(transactionId: string): TransactionLineItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM transaction_line_items
      WHERE transaction_id = ?
      ORDER BY line_number ASC
    `);
    return stmt.all(transactionId) as TransactionLineItem[];
  }

  /**
   * Get payments for a transaction
   * SEC-006: Parameterized query
   *
   * @param transactionId - Transaction ID
   * @returns Array of payments
   */
  getPayments(transactionId: string): TransactionPayment[] {
    const stmt = this.db.prepare(`
      SELECT * FROM transaction_payments
      WHERE transaction_id = ?
    `);
    return stmt.all(transactionId) as TransactionPayment[];
  }

  /**
   * Find transactions by shift
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param shiftId - Shift ID
   * @returns Array of transactions
   */
  findByShift(storeId: string, shiftId: string): Transaction[] {
    const stmt = this.db.prepare(`
      SELECT * FROM transactions
      WHERE store_id = ? AND shift_id = ?
      ORDER BY transaction_time ASC
    `);
    return stmt.all(storeId, shiftId) as Transaction[];
  }

  /**
   * Find transactions by date
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @returns Array of transactions
   */
  findByDate(storeId: string, businessDate: string): Transaction[] {
    const stmt = this.db.prepare(`
      SELECT * FROM transactions
      WHERE store_id = ? AND business_date = ?
      ORDER BY transaction_time ASC
    `);
    return stmt.all(storeId, businessDate) as Transaction[];
  }

  /**
   * Find transactions by date range with pagination
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param startDate - Start date
   * @param endDate - End date
   * @param limit - Page size
   * @param offset - Skip count
   * @returns Paginated result
   */
  findByDateRange(
    storeId: string,
    startDate: string,
    endDate: string,
    limit: number = 100,
    offset: number = 0
  ): PaginatedResult<Transaction> {
    // Get count
    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM transactions
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
    `);
    const countResult = countStmt.get(storeId, startDate, endDate) as { count: number };

    // Get data
    const dataStmt = this.db.prepare(`
      SELECT * FROM transactions
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      ORDER BY business_date ASC, transaction_time ASC
      LIMIT ? OFFSET ?
    `);
    const data = dataStmt.all(storeId, startDate, endDate, limit, offset) as Transaction[];

    return {
      data,
      total: countResult.count,
      limit,
      offset,
      hasMore: offset + data.length < countResult.count,
    };
  }

  /**
   * Void a transaction
   * SEC-006: Parameterized query
   *
   * @param transactionId - Transaction ID
   * @param reason - Void reason
   * @returns Updated transaction or undefined
   */
  voidTransaction(transactionId: string, reason: string): Transaction | undefined {
    const stmt = this.db.prepare(`
      UPDATE transactions SET voided = 1, void_reason = ? WHERE transaction_id = ?
    `);
    const result = stmt.run(reason, transactionId);

    if (result.changes === 0) {
      return undefined;
    }

    log.info('Transaction voided', { transactionId, reason });
    return this.findById(transactionId);
  }

  /**
   * Get transaction totals by date
   * DB-006: Store-scoped aggregate query
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @returns Totals for the date
   */
  getTotalsByDate(
    storeId: string,
    businessDate: string
  ): { totalAmount: number; transactionCount: number; voidedCount: number } {
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN voided = 0 THEN total_amount ELSE 0 END), 0) as total_amount,
        SUM(CASE WHEN voided = 0 THEN 1 ELSE 0 END) as transaction_count,
        SUM(CASE WHEN voided = 1 THEN 1 ELSE 0 END) as voided_count
      FROM transactions
      WHERE store_id = ? AND business_date = ?
    `);

    const result = stmt.get(storeId, businessDate) as {
      total_amount: number;
      transaction_count: number;
      voided_count: number;
    };

    return {
      totalAmount: result.total_amount,
      transactionCount: result.transaction_count,
      voidedCount: result.voided_count,
    };
  }

  /**
   * Get next transaction number for a store/date
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @returns Next transaction number
   */
  getNextTransactionNumber(storeId: string, businessDate: string): number {
    const stmt = this.db.prepare(`
      SELECT MAX(transaction_number) as max_num FROM transactions
      WHERE store_id = ? AND business_date = ?
    `);
    const result = stmt.get(storeId, businessDate) as { max_num: number | null };
    return (result.max_num || 0) + 1;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for transaction operations
 */
export const transactionsDAL = new TransactionsDAL();
