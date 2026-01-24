/**
 * Shift Tender Summaries Data Access Layer
 *
 * Payment totals by tender type per shift.
 * Child of shift_summaries.
 *
 * @module main/dal/shift-tender-summaries
 * @security SEC-006: All queries use prepared statements with parameter binding
 * @security DB-006: Store-scoped via parent shift_summary
 * @security DB-001: ORM-like patterns with safe query building
 */

import { BaseDAL, type BaseEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Shift tender summary entity
 */
export interface ShiftTenderSummary extends BaseEntity {
  id: string;
  shift_summary_id: string;

  // Tender identification
  tender_type_id: string | null;
  tender_code: string;
  tender_display_name: string | null;

  // Totals
  total_amount: number;
  transaction_count: number;

  // Refund breakdown
  refund_amount: number;
  refund_count: number;

  // Net
  net_amount: number;

  // Audit
  created_at: string;
}

/**
 * Shift tender summary creation data
 */
export interface CreateShiftTenderSummaryData {
  shift_summary_id: string;
  tender_type_id?: string;
  tender_code: string;
  tender_display_name?: string;
  total_amount?: number;
  transaction_count?: number;
  refund_amount?: number;
  refund_count?: number;
}

/**
 * Tender aggregation result
 */
export interface TenderAggregation {
  tenderCode: string;
  tenderDisplayName: string | null;
  totalAmount: number;
  transactionCount: number;
  refundAmount: number;
  refundCount: number;
  netAmount: number;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('shift-tender-summaries-dal');

// ============================================================================
// Shift Tender Summaries DAL
// ============================================================================

/**
 * Data Access Layer for shift tender summaries
 *
 * Handles payment/tender summary data per shift.
 * SEC-006: All SQL uses prepared statements
 */
export class ShiftTenderSummariesDAL extends BaseDAL<ShiftTenderSummary> {
  protected readonly tableName = 'shift_tender_summaries';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'tender_code',
    'total_amount',
    'net_amount',
    'transaction_count',
  ]);

  /**
   * Create a shift tender summary record
   * SEC-006: Parameterized INSERT
   *
   * @param data - Summary creation data
   * @returns Created summary record
   */
  create(data: CreateShiftTenderSummaryData): ShiftTenderSummary {
    const id = this.generateId();
    const now = this.now();

    // Calculate net_amount
    const netAmount = (data.total_amount || 0) - (data.refund_amount || 0);

    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      INSERT INTO shift_tender_summaries (
        id, shift_summary_id, tender_type_id, tender_code, tender_display_name,
        total_amount, transaction_count, refund_amount, refund_count, net_amount,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.shift_summary_id,
      data.tender_type_id || null,
      data.tender_code,
      data.tender_display_name || null,
      data.total_amount || 0,
      data.transaction_count || 0,
      data.refund_amount || 0,
      data.refund_count || 0,
      netAmount,
      now
    );

    log.debug('Shift tender summary created', {
      id,
      shiftSummaryId: data.shift_summary_id,
      tenderCode: data.tender_code,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created shift tender summary: ${id}`);
    }
    return created;
  }

  /**
   * Create or update shift tender summary (upsert)
   * SEC-006: Parameterized queries
   *
   * @param data - Summary data
   * @returns Created or updated record
   */
  upsert(data: CreateShiftTenderSummaryData): ShiftTenderSummary {
    // Check for existing record by unique constraint
    const existing = this.findByShiftAndTender(data.shift_summary_id, data.tender_code);

    if (existing) {
      // Update existing record - add to totals
      const stmt = this.db.prepare(`
        UPDATE shift_tender_summaries
        SET total_amount = total_amount + ?,
            transaction_count = transaction_count + ?,
            refund_amount = refund_amount + ?,
            refund_count = refund_count + ?,
            net_amount = (total_amount + ?) - (refund_amount + ?)
        WHERE id = ?
      `);

      stmt.run(
        data.total_amount || 0,
        data.transaction_count || 0,
        data.refund_amount || 0,
        data.refund_count || 0,
        data.total_amount || 0,
        data.refund_amount || 0,
        existing.id
      );

      return this.findById(existing.id)!;
    }

    return this.create(data);
  }

  /**
   * Find by shift summary and tender code
   * SEC-006: Parameterized query
   *
   * @param shiftSummaryId - Shift summary ID
   * @param tenderCode - Tender code
   * @returns Record or undefined
   */
  findByShiftAndTender(shiftSummaryId: string, tenderCode: string): ShiftTenderSummary | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM shift_tender_summaries
      WHERE shift_summary_id = ? AND tender_code = ?
    `);
    return stmt.get(shiftSummaryId, tenderCode) as ShiftTenderSummary | undefined;
  }

  /**
   * Find all summaries for a shift
   * SEC-006: Parameterized query
   *
   * @param shiftSummaryId - Shift summary ID
   * @returns Array of tender summaries
   */
  findByShiftSummary(shiftSummaryId: string): ShiftTenderSummary[] {
    const stmt = this.db.prepare(`
      SELECT * FROM shift_tender_summaries
      WHERE shift_summary_id = ?
      ORDER BY net_amount DESC
    `);
    return stmt.all(shiftSummaryId) as ShiftTenderSummary[];
  }

  /**
   * Get aggregated totals by tender for a shift
   * SEC-006: Parameterized aggregate query
   *
   * @param shiftSummaryId - Shift summary ID
   * @returns Array of tender aggregations
   */
  getAggregateByTender(shiftSummaryId: string): TenderAggregation[] {
    const stmt = this.db.prepare(`
      SELECT
        tender_code,
        tender_display_name,
        SUM(total_amount) as total_amount,
        SUM(transaction_count) as transaction_count,
        SUM(refund_amount) as refund_amount,
        SUM(refund_count) as refund_count,
        SUM(net_amount) as net_amount
      FROM shift_tender_summaries
      WHERE shift_summary_id = ?
      GROUP BY tender_code, tender_display_name
      ORDER BY net_amount DESC
    `);

    const results = stmt.all(shiftSummaryId) as Array<{
      tender_code: string;
      tender_display_name: string | null;
      total_amount: number;
      transaction_count: number;
      refund_amount: number;
      refund_count: number;
      net_amount: number;
    }>;

    return results.map((r) => ({
      tenderCode: r.tender_code,
      tenderDisplayName: r.tender_display_name,
      totalAmount: r.total_amount,
      transactionCount: r.transaction_count,
      refundAmount: r.refund_amount,
      refundCount: r.refund_count,
      netAmount: r.net_amount,
    }));
  }

  /**
   * Get shift totals
   * SEC-006: Parameterized query
   *
   * @param shiftSummaryId - Shift summary ID
   * @returns Total tender metrics
   */
  getShiftTotals(shiftSummaryId: string): {
    totalAmount: number;
    transactionCount: number;
    refundAmount: number;
    refundCount: number;
    netAmount: number;
    tenderTypeCount: number;
  } {
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(total_amount), 0) as total_amount,
        COALESCE(SUM(transaction_count), 0) as transaction_count,
        COALESCE(SUM(refund_amount), 0) as refund_amount,
        COALESCE(SUM(refund_count), 0) as refund_count,
        COALESCE(SUM(net_amount), 0) as net_amount,
        COUNT(DISTINCT tender_code) as tender_type_count
      FROM shift_tender_summaries
      WHERE shift_summary_id = ?
    `);

    const result = stmt.get(shiftSummaryId) as {
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
   * SEC-006: Parameterized query
   *
   * @param shiftSummaryId - Shift summary ID
   * @returns Cash totals
   */
  getCashTotal(shiftSummaryId: string): {
    cashIn: number;
    cashOut: number;
    netCash: number;
  } {
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(total_amount), 0) as cash_in,
        COALESCE(SUM(refund_amount), 0) as cash_out,
        COALESCE(SUM(net_amount), 0) as net_cash
      FROM shift_tender_summaries
      WHERE shift_summary_id = ? AND tender_code = 'CASH'
    `);

    const result = stmt.get(shiftSummaryId) as {
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
   * Delete all summaries for a shift
   * SEC-006: Parameterized DELETE
   *
   * @param shiftSummaryId - Shift summary ID
   * @returns Number of records deleted
   */
  deleteByShiftSummary(shiftSummaryId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM shift_tender_summaries WHERE shift_summary_id = ?
    `);
    const result = stmt.run(shiftSummaryId);
    return result.changes;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for shift tender summary operations
 */
export const shiftTenderSummariesDAL = new ShiftTenderSummariesDAL();
