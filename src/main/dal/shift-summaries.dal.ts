/**
 * Shift Summaries Data Access Layer
 *
 * Parent table for all shift-level summary data.
 * Links to shifts table and serves as FK target for:
 * - shift_fuel_summaries
 * - shift_department_summaries
 * - shift_tender_summaries
 * - shift_tax_summaries
 *
 * @module main/dal/shift-summaries
 * @security SEC-006: All queries use prepared statements with parameter binding
 * @security DB-006: Store-scoped for tenant isolation
 * @security DB-001: ORM-like patterns with safe query building
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Shift summary entity
 */
export interface ShiftSummary extends StoreEntity {
  shift_summary_id: string;
  shift_id: string;
  store_id: string;
  business_date: string;

  // Timing
  shift_opened_at: string | null;
  shift_closed_at: string | null;
  shift_duration_mins: number | null;

  // Personnel
  opened_by_user_id: string | null;
  closed_by_user_id: string | null;
  cashier_user_id: string | null;

  // Sales totals
  gross_sales: number;
  returns_total: number;
  discounts_total: number;
  net_sales: number;

  // Tax
  tax_collected: number;
  tax_exempt_sales: number;
  taxable_sales: number;

  // Transaction counts
  transaction_count: number;
  void_count: number;
  refund_count: number;
  no_sale_count: number;

  // Item counts
  items_sold_count: number;
  items_returned_count: number;

  // Averages
  avg_transaction: number | null;
  avg_items_per_txn: number | null;

  // Cash drawer reconciliation
  opening_cash: number;
  closing_cash: number;
  expected_cash: number;
  cash_variance: number;
  variance_percentage: number | null;
  variance_approved: number;
  variance_approved_by: string | null;
  variance_approved_at: string | null;
  variance_reason: string | null;

  // Lottery totals
  lottery_sales: number | null;
  lottery_cashes: number | null;
  lottery_net: number | null;
  lottery_packs_sold: number | null;
  lottery_tickets_sold: number | null;

  // Fuel totals
  fuel_gallons: number | null;
  fuel_sales: number | null;

  // Metadata
  extra_data: string | null;
  created_at: string;
}

/**
 * Shift summary creation data
 */
export interface CreateShiftSummaryData {
  shift_id: string;
  store_id: string;
  business_date: string;
  shift_opened_at?: string;
  shift_closed_at?: string;
  opened_by_user_id?: string;
  closed_by_user_id?: string;
  cashier_user_id?: string;
}

/**
 * Shift summary update data
 */
export interface UpdateShiftSummaryData {
  shift_closed_at?: string;
  shift_duration_mins?: number;
  closed_by_user_id?: string;
  gross_sales?: number;
  returns_total?: number;
  discounts_total?: number;
  net_sales?: number;
  tax_collected?: number;
  tax_exempt_sales?: number;
  taxable_sales?: number;
  transaction_count?: number;
  void_count?: number;
  refund_count?: number;
  no_sale_count?: number;
  items_sold_count?: number;
  items_returned_count?: number;
  avg_transaction?: number;
  avg_items_per_txn?: number;
  opening_cash?: number;
  closing_cash?: number;
  expected_cash?: number;
  cash_variance?: number;
  variance_percentage?: number;
  variance_approved?: number;
  variance_approved_by?: string;
  variance_approved_at?: string;
  variance_reason?: string;
  lottery_sales?: number;
  lottery_cashes?: number;
  lottery_net?: number;
  lottery_packs_sold?: number;
  lottery_tickets_sold?: number;
  fuel_gallons?: number;
  fuel_sales?: number;
  extra_data?: string;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('shift-summaries-dal');

// ============================================================================
// Shift Summaries DAL
// ============================================================================

/**
 * Data Access Layer for shift summaries
 *
 * Parent table for all shift-level child summary tables.
 * SEC-006: All SQL uses prepared statements
 * DB-006: All queries are store-scoped
 */
export class ShiftSummariesDAL extends StoreBasedDAL<ShiftSummary> {
  protected readonly tableName = 'shift_summaries';
  protected readonly primaryKey = 'shift_summary_id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'business_date',
    'shift_opened_at',
    'shift_closed_at',
    'gross_sales',
    'net_sales',
    'transaction_count',
  ]);

  /**
   * Create a shift summary record
   * SEC-006: Parameterized INSERT
   *
   * @param data - Summary creation data
   * @returns Created summary record
   */
  create(data: CreateShiftSummaryData): ShiftSummary {
    const id = this.generateId();
    const now = this.now();

    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      INSERT INTO shift_summaries (
        shift_summary_id, shift_id, store_id, business_date,
        shift_opened_at, shift_closed_at, opened_by_user_id,
        closed_by_user_id, cashier_user_id,
        gross_sales, returns_total, discounts_total, net_sales,
        tax_collected, tax_exempt_sales, taxable_sales,
        transaction_count, void_count, refund_count, no_sale_count,
        items_sold_count, items_returned_count,
        opening_cash, closing_cash, expected_cash, cash_variance,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.shift_id,
      data.store_id,
      data.business_date,
      data.shift_opened_at || null,
      data.shift_closed_at || null,
      data.opened_by_user_id || null,
      data.closed_by_user_id || null,
      data.cashier_user_id || null,
      0, // gross_sales
      0, // returns_total
      0, // discounts_total
      0, // net_sales
      0, // tax_collected
      0, // tax_exempt_sales
      0, // taxable_sales
      0, // transaction_count
      0, // void_count
      0, // refund_count
      0, // no_sale_count
      0, // items_sold_count
      0, // items_returned_count
      0, // opening_cash
      0, // closing_cash
      0, // expected_cash
      0, // cash_variance
      now
    );

    log.debug('Shift summary created', {
      id,
      shiftId: data.shift_id,
      storeId: data.store_id,
      businessDate: data.business_date,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created shift summary: ${id}`);
    }
    return created;
  }

  /**
   * Get or create shift summary for a shift
   * Idempotent operation - safe to call multiple times
   * SEC-006: Uses parameterized queries
   * DB-006: Store-scoped
   *
   * @param storeId - Store identifier (from auth context)
   * @param shiftId - Shift identifier
   * @param businessDate - Business date
   * @param options - Optional creation parameters
   * @returns Existing or newly created shift summary
   */
  getOrCreateForShift(
    storeId: string,
    shiftId: string,
    businessDate: string,
    options?: Partial<CreateShiftSummaryData>
  ): ShiftSummary {
    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      SELECT * FROM shift_summaries
      WHERE store_id = ? AND shift_id = ?
    `);
    const existing = stmt.get(storeId, shiftId) as ShiftSummary | undefined;

    if (existing) {
      return existing;
    }

    return this.create({
      shift_id: shiftId,
      store_id: storeId,
      business_date: businessDate,
      ...options,
    });
  }

  /**
   * Find shift summary by shift ID
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier (from auth context)
   * @param shiftId - Shift identifier
   * @returns Shift summary or undefined
   */
  findByShiftId(storeId: string, shiftId: string): ShiftSummary | undefined {
    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      SELECT * FROM shift_summaries
      WHERE store_id = ? AND shift_id = ?
    `);
    return stmt.get(storeId, shiftId) as ShiftSummary | undefined;
  }

  /**
   * Find shift summaries by date
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier (from auth context)
   * @param businessDate - Business date
   * @returns Array of shift summaries
   */
  findByDate(storeId: string, businessDate: string): ShiftSummary[] {
    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      SELECT * FROM shift_summaries
      WHERE store_id = ? AND business_date = ?
      ORDER BY shift_opened_at ASC
    `);
    return stmt.all(storeId, businessDate) as ShiftSummary[];
  }

  /**
   * Find shift summaries by date range
   * DB-006: Store-scoped query with bounded results
   *
   * @param storeId - Store identifier (from auth context)
   * @param startDate - Start date (inclusive)
   * @param endDate - End date (inclusive)
   * @param limit - Maximum records (default 100, max 1000)
   * @returns Array of shift summaries
   */
  findByDateRange(
    storeId: string,
    startDate: string,
    endDate: string,
    limit: number = 100
  ): ShiftSummary[] {
    // Enforce max limit to prevent unbounded reads
    const boundedLimit = Math.min(limit, 1000);

    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      SELECT * FROM shift_summaries
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      ORDER BY business_date ASC, shift_opened_at ASC
      LIMIT ?
    `);
    return stmt.all(storeId, startDate, endDate, boundedLimit) as ShiftSummary[];
  }

  /**
   * Update shift summary
   * SEC-006: Parameterized UPDATE
   * DB-006: Store-scoped with validation
   *
   * @param storeId - Store identifier (from auth context)
   * @param shiftSummaryId - Shift summary ID
   * @param data - Update data
   * @returns Updated summary or undefined if not found
   */
  update(
    storeId: string,
    shiftSummaryId: string,
    data: UpdateShiftSummaryData
  ): ShiftSummary | undefined {
    // Build dynamic UPDATE query with only provided fields
    const updates: string[] = [];
    const values: unknown[] = [];

    // Map of field names to their values
    const fieldMap: Record<string, unknown> = {
      shift_closed_at: data.shift_closed_at,
      shift_duration_mins: data.shift_duration_mins,
      closed_by_user_id: data.closed_by_user_id,
      gross_sales: data.gross_sales,
      returns_total: data.returns_total,
      discounts_total: data.discounts_total,
      net_sales: data.net_sales,
      tax_collected: data.tax_collected,
      tax_exempt_sales: data.tax_exempt_sales,
      taxable_sales: data.taxable_sales,
      transaction_count: data.transaction_count,
      void_count: data.void_count,
      refund_count: data.refund_count,
      no_sale_count: data.no_sale_count,
      items_sold_count: data.items_sold_count,
      items_returned_count: data.items_returned_count,
      avg_transaction: data.avg_transaction,
      avg_items_per_txn: data.avg_items_per_txn,
      opening_cash: data.opening_cash,
      closing_cash: data.closing_cash,
      expected_cash: data.expected_cash,
      cash_variance: data.cash_variance,
      variance_percentage: data.variance_percentage,
      variance_approved: data.variance_approved,
      variance_approved_by: data.variance_approved_by,
      variance_approved_at: data.variance_approved_at,
      variance_reason: data.variance_reason,
      lottery_sales: data.lottery_sales,
      lottery_cashes: data.lottery_cashes,
      lottery_net: data.lottery_net,
      lottery_packs_sold: data.lottery_packs_sold,
      lottery_tickets_sold: data.lottery_tickets_sold,
      fuel_gallons: data.fuel_gallons,
      fuel_sales: data.fuel_sales,
      extra_data: data.extra_data,
    };

    for (const [field, value] of Object.entries(fieldMap)) {
      if (value !== undefined) {
        updates.push(`${field} = ?`);
        values.push(value);
      }
    }

    if (updates.length === 0) {
      return this.findByIdForStore(storeId, shiftSummaryId);
    }

    // Add WHERE clause parameters
    values.push(shiftSummaryId, storeId);

    // SEC-006: Parameterized UPDATE with store validation
    const stmt = this.db.prepare(`
      UPDATE shift_summaries
      SET ${updates.join(', ')}
      WHERE shift_summary_id = ? AND store_id = ?
    `);

    const result = stmt.run(...values);

    if (result.changes === 0) {
      return undefined;
    }

    return this.findByIdForStore(storeId, shiftSummaryId);
  }

  /**
   * Get aggregate totals for a date range
   * DB-006: Store-scoped aggregate query
   *
   * @param storeId - Store identifier (from auth context)
   * @param startDate - Start date
   * @param endDate - End date
   * @returns Aggregated totals
   */
  getAggregateTotals(
    storeId: string,
    startDate: string,
    endDate: string
  ): {
    totalGrossSales: number;
    totalNetSales: number;
    totalTransactions: number;
    totalVoids: number;
    totalRefunds: number;
    avgTransactionValue: number;
    shiftCount: number;
  } {
    // SEC-006: Parameterized aggregate query
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(gross_sales), 0) as total_gross_sales,
        COALESCE(SUM(net_sales), 0) as total_net_sales,
        COALESCE(SUM(transaction_count), 0) as total_transactions,
        COALESCE(SUM(void_count), 0) as total_voids,
        COALESCE(SUM(refund_count), 0) as total_refunds,
        CASE WHEN SUM(transaction_count) > 0
          THEN SUM(net_sales) / SUM(transaction_count)
          ELSE 0
        END as avg_transaction_value,
        COUNT(*) as shift_count
      FROM shift_summaries
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
    `);

    const result = stmt.get(storeId, startDate, endDate) as {
      total_gross_sales: number;
      total_net_sales: number;
      total_transactions: number;
      total_voids: number;
      total_refunds: number;
      avg_transaction_value: number;
      shift_count: number;
    };

    return {
      totalGrossSales: result.total_gross_sales,
      totalNetSales: result.total_net_sales,
      totalTransactions: result.total_transactions,
      totalVoids: result.total_voids,
      totalRefunds: result.total_refunds,
      avgTransactionValue: result.avg_transaction_value,
      shiftCount: result.shift_count,
    };
  }

  /**
   * Close shift summary with final totals and closing cash
   *
   * Updates the shift summary with close timestamp, duration calculation,
   * and closing cash amount. The closing_cash is stored for cash drawer
   * reconciliation and cloud sync.
   *
   * @security SEC-006: Parameterized UPDATE via this.update()
   * @security DB-006: Store-scoped via storeId parameter
   *
   * @param storeId - Store identifier (from auth context)
   * @param shiftSummaryId - Shift summary ID
   * @param closedAt - Close timestamp (ISO format)
   * @param closedByUserId - User who closed the shift (optional)
   * @param closingCash - Cash amount in drawer at close (optional, non-negative)
   * @returns Updated summary or undefined if not found
   */
  closeShiftSummary(
    storeId: string,
    shiftSummaryId: string,
    closedAt: string,
    closedByUserId?: string,
    closingCash?: number
  ): ShiftSummary | undefined {
    // Get existing to calculate duration
    const existing = this.findByIdForStore(storeId, shiftSummaryId);
    if (!existing) {
      return undefined;
    }

    let durationMins: number | undefined;
    if (existing.shift_opened_at) {
      const openedAt = new Date(existing.shift_opened_at);
      const closedAtDate = new Date(closedAt);
      durationMins = Math.round((closedAtDate.getTime() - openedAt.getTime()) / 60000);
    }

    // Build update data with closing_cash if provided
    const updateData: UpdateShiftSummaryData = {
      shift_closed_at: closedAt,
      shift_duration_mins: durationMins,
      closed_by_user_id: closedByUserId,
    };

    // Only include closing_cash if provided (preserves existing value if not set)
    if (closingCash !== undefined) {
      updateData.closing_cash = closingCash;
    }

    return this.update(storeId, shiftSummaryId, updateData);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for shift summary operations
 */
export const shiftSummariesDAL = new ShiftSummariesDAL();
