/**
 * Tender Product Movements Data Access Layer
 *
 * CRUD operations for payment/tender totals by type.
 * Parsed from NAXML TPM documents.
 *
 * @module main/dal/tender-product-movements
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Tender product movement entity
 */
export interface TenderProductMovement extends StoreEntity {
  id: string;
  store_id: string;
  business_date: string;
  shift_id: string | null;
  tender_id: string | null;
  tender_name: string | null;
  tender_type: string | null;
  amount: number;
  transaction_count: number;
  refund_amount: number;
  refund_count: number;
  file_id: string | null;
  created_at: string;
}

/**
 * Tender product movement creation data
 */
export interface CreateTenderProductMovementData {
  store_id: string;
  business_date: string;
  shift_id?: string;
  tender_id?: string;
  tender_name?: string;
  tender_type?: string;
  amount?: number;
  transaction_count?: number;
  refund_amount?: number;
  refund_count?: number;
  file_id?: string;
}

/**
 * NAXML TPM input structure for createFromNAXML
 */
export interface NAXMLTPMInput {
  tenderId?: string;
  tenderName?: string;
  tenderType?: string;
  amount?: number;
  transactionCount?: number;
  refundAmount?: number;
  refundCount?: number;
}

/**
 * Tender aggregation result
 */
export interface TenderAggregation {
  tenderId: string;
  tenderName: string | null;
  tenderType: string | null;
  totalAmount: number;
  transactionCount: number;
  totalRefundAmount: number;
  refundCount: number;
  netAmount: number;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('tender-product-movements-dal');

// ============================================================================
// Tender Product Movements DAL
// ============================================================================

/**
 * Data Access Layer for tender product movements
 *
 * Handles TPM (Tender Product Movement) data from NAXML files
 */
export class TenderProductMovementsDAL extends StoreBasedDAL<TenderProductMovement> {
  protected readonly tableName = 'tender_product_movements';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'business_date',
    'tender_id',
    'tender_type',
    'amount',
    'transaction_count',
  ]);

  /**
   * Create a tender product movement record
   * SEC-006: Parameterized INSERT
   *
   * @param data - Movement creation data
   * @returns Created movement record
   */
  create(data: CreateTenderProductMovementData): TenderProductMovement {
    const id = this.generateId();
    const now = this.now();

    const stmt = this.db.prepare(`
      INSERT INTO tender_product_movements (
        id, store_id, business_date, shift_id, tender_id, tender_name,
        tender_type, amount, transaction_count, refund_amount,
        refund_count, file_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.store_id,
      data.business_date,
      data.shift_id || null,
      data.tender_id || null,
      data.tender_name || null,
      data.tender_type || null,
      data.amount || 0,
      data.transaction_count || 0,
      data.refund_amount || 0,
      data.refund_count || 0,
      data.file_id || null,
      now
    );

    log.debug('Tender product movement created', {
      id,
      storeId: data.store_id,
      businessDate: data.business_date,
      tenderId: data.tender_id,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created tender product movement: ${id}`);
    }
    return created;
  }

  /**
   * Create tender product movement from NAXML parsed data
   * SEC-006: Uses parameterized create method
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date from movement header
   * @param tpmInput - Parsed TPM data from NAXML
   * @param fileId - Optional processed file ID for tracking
   * @param shiftId - Optional shift ID if from shift report
   * @returns Created record ID
   */
  createFromNAXML(
    storeId: string,
    businessDate: string,
    tpmInput: NAXMLTPMInput,
    fileId?: string,
    shiftId?: string
  ): string {
    const record = this.create({
      store_id: storeId,
      business_date: businessDate,
      shift_id: shiftId,
      tender_id: tpmInput.tenderId,
      tender_name: tpmInput.tenderName,
      tender_type: tpmInput.tenderType,
      amount: tpmInput.amount,
      transaction_count: tpmInput.transactionCount,
      refund_amount: tpmInput.refundAmount,
      refund_count: tpmInput.refundCount,
      file_id: fileId,
    });

    return record.id;
  }

  /**
   * Find movements by date
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @returns Array of movements for the date
   */
  findByDate(storeId: string, businessDate: string): TenderProductMovement[] {
    const stmt = this.db.prepare(`
      SELECT * FROM tender_product_movements
      WHERE store_id = ? AND business_date = ?
      ORDER BY tender_id ASC
    `);
    return stmt.all(storeId, businessDate) as TenderProductMovement[];
  }

  /**
   * Find movements by date range
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param startDate - Start date (inclusive)
   * @param endDate - End date (inclusive)
   * @returns Array of movements
   */
  findByDateRange(storeId: string, startDate: string, endDate: string): TenderProductMovement[] {
    const stmt = this.db.prepare(`
      SELECT * FROM tender_product_movements
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      ORDER BY business_date ASC, tender_id ASC
    `);
    return stmt.all(storeId, startDate, endDate) as TenderProductMovement[];
  }

  /**
   * Find movements by tender type
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param tenderType - Tender type (e.g., 'CASH', 'CREDIT')
   * @param startDate - Optional start date
   * @param endDate - Optional end date
   * @returns Array of movements
   */
  findByTenderType(
    storeId: string,
    tenderType: string,
    startDate?: string,
    endDate?: string
  ): TenderProductMovement[] {
    if (startDate && endDate) {
      const stmt = this.db.prepare(`
        SELECT * FROM tender_product_movements
        WHERE store_id = ? AND tender_type = ? AND business_date >= ? AND business_date <= ?
        ORDER BY business_date DESC
      `);
      return stmt.all(storeId, tenderType, startDate, endDate) as TenderProductMovement[];
    }

    const stmt = this.db.prepare(`
      SELECT * FROM tender_product_movements
      WHERE store_id = ? AND tender_type = ?
      ORDER BY business_date DESC
      LIMIT 100
    `);
    return stmt.all(storeId, tenderType) as TenderProductMovement[];
  }

  /**
   * Find movements by shift
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param shiftId - Shift ID
   * @returns Array of movements for the shift
   */
  findByShift(storeId: string, shiftId: string): TenderProductMovement[] {
    const stmt = this.db.prepare(`
      SELECT * FROM tender_product_movements
      WHERE store_id = ? AND shift_id = ?
      ORDER BY tender_id ASC
    `);
    return stmt.all(storeId, shiftId) as TenderProductMovement[];
  }

  /**
   * Get aggregated totals by tender for a date range
   * DB-006: Store-scoped aggregate query
   *
   * @param storeId - Store identifier
   * @param startDate - Start date
   * @param endDate - End date
   * @returns Array of tender aggregations
   */
  getAggregateByTender(storeId: string, startDate: string, endDate: string): TenderAggregation[] {
    const stmt = this.db.prepare(`
      SELECT
        tender_id,
        tender_name,
        tender_type,
        SUM(amount) as total_amount,
        SUM(transaction_count) as transaction_count,
        SUM(refund_amount) as total_refund_amount,
        SUM(refund_count) as refund_count,
        SUM(amount) - SUM(refund_amount) as net_amount
      FROM tender_product_movements
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      GROUP BY tender_id, tender_name, tender_type
      ORDER BY net_amount DESC
    `);

    const results = stmt.all(storeId, startDate, endDate) as Array<{
      tender_id: string;
      tender_name: string | null;
      tender_type: string | null;
      total_amount: number;
      transaction_count: number;
      total_refund_amount: number;
      refund_count: number;
      net_amount: number;
    }>;

    return results.map((r) => ({
      tenderId: r.tender_id,
      tenderName: r.tender_name,
      tenderType: r.tender_type,
      totalAmount: r.total_amount,
      transactionCount: r.transaction_count,
      totalRefundAmount: r.total_refund_amount,
      refundCount: r.refund_count,
      netAmount: r.net_amount,
    }));
  }

  /**
   * Get daily tender breakdown
   * DB-006: Store-scoped aggregate query
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @returns Daily tender breakdown
   */
  getDayBreakdown(
    storeId: string,
    businessDate: string
  ): Array<{
    tenderId: string;
    tenderName: string | null;
    tenderType: string | null;
    amount: number;
    transactionCount: number;
    refundAmount: number;
    netAmount: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT
        tender_id,
        tender_name,
        tender_type,
        SUM(amount) as amount,
        SUM(transaction_count) as transaction_count,
        SUM(refund_amount) as refund_amount,
        SUM(amount) - SUM(refund_amount) as net_amount
      FROM tender_product_movements
      WHERE store_id = ? AND business_date = ?
      GROUP BY tender_id, tender_name, tender_type
      ORDER BY net_amount DESC
    `);

    const results = stmt.all(storeId, businessDate) as Array<{
      tender_id: string;
      tender_name: string | null;
      tender_type: string | null;
      amount: number;
      transaction_count: number;
      refund_amount: number;
      net_amount: number;
    }>;

    return results.map((r) => ({
      tenderId: r.tender_id,
      tenderName: r.tender_name,
      tenderType: r.tender_type,
      amount: r.amount,
      transactionCount: r.transaction_count,
      refundAmount: r.refund_amount,
      netAmount: r.net_amount,
    }));
  }

  /**
   * Get tender totals summary for a date
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @returns Tender totals
   */
  getDaySummary(
    storeId: string,
    businessDate: string
  ): {
    totalAmount: number;
    transactionCount: number;
    refundAmount: number;
    refundCount: number;
    netAmount: number;
    tenderTypeCount: number;
  } {
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) as total_amount,
        COALESCE(SUM(transaction_count), 0) as transaction_count,
        COALESCE(SUM(refund_amount), 0) as refund_amount,
        COALESCE(SUM(refund_count), 0) as refund_count,
        COALESCE(SUM(amount), 0) - COALESCE(SUM(refund_amount), 0) as net_amount,
        COUNT(DISTINCT tender_type) as tender_type_count
      FROM tender_product_movements
      WHERE store_id = ? AND business_date = ?
    `);

    const result = stmt.get(storeId, businessDate) as {
      total_amount: number;
      transaction_count: number;
      refund_amount: number;
      refund_count: number;
      net_amount: number;
      tender_type_count: number;
    };

    return {
      totalAmount: result.total_amount,
      transactionCount: result.transaction_count,
      refundAmount: result.refund_amount,
      refundCount: result.refund_count,
      netAmount: result.net_amount,
      tenderTypeCount: result.tender_type_count,
    };
  }

  /**
   * Get cash total for reconciliation
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @returns Cash totals
   */
  getCashTotal(
    storeId: string,
    businessDate: string
  ): { cashIn: number; cashOut: number; netCash: number } {
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) as cash_in,
        COALESCE(SUM(refund_amount), 0) as cash_out,
        COALESCE(SUM(amount), 0) - COALESCE(SUM(refund_amount), 0) as net_cash
      FROM tender_product_movements
      WHERE store_id = ? AND business_date = ? AND tender_type = 'CASH'
    `);

    const result = stmt.get(storeId, businessDate) as {
      cash_in: number;
      cash_out: number;
      net_cash: number;
    };

    return {
      cashIn: result.cash_in,
      cashOut: result.cash_out,
      netCash: result.net_cash,
    };
  }

  /**
   * Delete movements for a processed file (for reprocessing)
   *
   * @param fileId - Processed file ID
   * @returns Number of records deleted
   */
  deleteByFileId(fileId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM tender_product_movements WHERE file_id = ?
    `);
    const result = stmt.run(fileId);

    log.debug('Tender product movements deleted by file', {
      fileId,
      count: result.changes,
    });

    return result.changes;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for tender product movement operations
 */
export const tenderProductMovementsDAL = new TenderProductMovementsDAL();
