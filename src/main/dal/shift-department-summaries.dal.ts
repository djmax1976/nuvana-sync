/**
 * Shift Department Summaries Data Access Layer
 *
 * Sales by department per shift. Replaces merchandise_movements table.
 * Child of shift_summaries.
 *
 * @module main/dal/shift-department-summaries
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
 * Shift department summary entity
 */
export interface ShiftDepartmentSummary extends BaseEntity {
  id: string;
  shift_summary_id: string;

  // Department identification
  department_id: string | null;
  department_code: string;
  department_name: string | null;

  // Sales totals
  gross_sales: number;
  returns_total: number;
  discounts_total: number;
  net_sales: number;

  // Tax
  tax_collected: number;

  // Counts
  transaction_count: number;
  items_sold_count: number;
  items_returned_count: number;

  // Audit
  created_at: string;
}

/**
 * Shift department summary creation data
 */
export interface CreateShiftDepartmentSummaryData {
  shift_summary_id: string;
  department_id?: string;
  department_code: string;
  department_name?: string;
  gross_sales?: number;
  returns_total?: number;
  discounts_total?: number;
  net_sales?: number;
  tax_collected?: number;
  transaction_count?: number;
  items_sold_count?: number;
  items_returned_count?: number;
}

/**
 * NAXML MCM input for creating from parsed data
 */
export interface NAXMLDepartmentInput {
  departmentCode: string;
  departmentName?: string;
  grossSales?: number;
  returnsTotal?: number;
  discountsTotal?: number;
  taxCollected?: number;
  transactionCount?: number;
  itemsSoldCount?: number;
}

/**
 * Department aggregation result
 */
export interface DepartmentAggregation {
  departmentCode: string;
  departmentName: string | null;
  totalGrossSales: number;
  totalNetSales: number;
  totalReturns: number;
  totalDiscounts: number;
  transactionCount: number;
  itemsSoldCount: number;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('shift-department-summaries-dal');

// ============================================================================
// Shift Department Summaries DAL
// ============================================================================

/**
 * Data Access Layer for shift department summaries
 *
 * Handles MCM (Merchandise Code Movement) data per shift.
 * SEC-006: All SQL uses prepared statements
 */
export class ShiftDepartmentSummariesDAL extends BaseDAL<ShiftDepartmentSummary> {
  protected readonly tableName = 'shift_department_summaries';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'department_code',
    'gross_sales',
    'net_sales',
    'transaction_count',
  ]);

  /**
   * Create a shift department summary record
   * SEC-006: Parameterized INSERT
   *
   * @param data - Summary creation data
   * @returns Created summary record
   */
  create(data: CreateShiftDepartmentSummaryData): ShiftDepartmentSummary {
    const id = this.generateId();
    const now = this.now();

    // Calculate net_sales if not provided
    const netSales =
      data.net_sales ??
      (data.gross_sales || 0) - (data.returns_total || 0) - (data.discounts_total || 0);

    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      INSERT INTO shift_department_summaries (
        id, shift_summary_id, department_id, department_code, department_name,
        gross_sales, returns_total, discounts_total, net_sales,
        tax_collected, transaction_count, items_sold_count, items_returned_count,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.shift_summary_id,
      data.department_id || null,
      data.department_code,
      data.department_name || null,
      data.gross_sales || 0,
      data.returns_total || 0,
      data.discounts_total || 0,
      netSales,
      data.tax_collected || 0,
      data.transaction_count || 0,
      data.items_sold_count || 0,
      data.items_returned_count || 0,
      now
    );

    log.debug('Shift department summary created', {
      id,
      shiftSummaryId: data.shift_summary_id,
      departmentCode: data.department_code,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created shift department summary: ${id}`);
    }
    return created;
  }

  /**
   * Create or update shift department summary (upsert)
   * SEC-006: Parameterized queries
   *
   * @param data - Summary data
   * @returns Created or updated record
   */
  upsert(data: CreateShiftDepartmentSummaryData): ShiftDepartmentSummary {
    // Check for existing record by unique constraint
    const existing = this.findByShiftAndDepartment(data.shift_summary_id, data.department_code);

    if (existing) {
      // Update existing record - add to totals
      const stmt = this.db.prepare(`
        UPDATE shift_department_summaries
        SET gross_sales = gross_sales + ?,
            returns_total = returns_total + ?,
            discounts_total = discounts_total + ?,
            net_sales = net_sales + ?,
            tax_collected = tax_collected + ?,
            transaction_count = transaction_count + ?,
            items_sold_count = items_sold_count + ?,
            items_returned_count = items_returned_count + ?
        WHERE id = ?
      `);

      const netSales =
        (data.gross_sales || 0) - (data.returns_total || 0) - (data.discounts_total || 0);

      stmt.run(
        data.gross_sales || 0,
        data.returns_total || 0,
        data.discounts_total || 0,
        netSales,
        data.tax_collected || 0,
        data.transaction_count || 0,
        data.items_sold_count || 0,
        data.items_returned_count || 0,
        existing.id
      );

      return this.findById(existing.id)!;
    }

    return this.create(data);
  }

  /**
   * Create from NAXML MCM parsed data
   * SEC-006: Uses parameterized create method
   *
   * @param shiftSummaryId - Parent shift summary ID
   * @param input - Parsed NAXML MCM data
   * @returns Created record ID
   */
  createFromNAXML(shiftSummaryId: string, input: NAXMLDepartmentInput): string {
    const record = this.upsert({
      shift_summary_id: shiftSummaryId,
      department_code: input.departmentCode,
      department_name: input.departmentName,
      gross_sales: input.grossSales,
      returns_total: input.returnsTotal,
      discounts_total: input.discountsTotal,
      tax_collected: input.taxCollected,
      transaction_count: input.transactionCount,
      items_sold_count: input.itemsSoldCount,
    });

    return record.id;
  }

  /**
   * Find by shift summary and department code
   * SEC-006: Parameterized query
   *
   * @param shiftSummaryId - Shift summary ID
   * @param departmentCode - Department code
   * @returns Record or undefined
   */
  findByShiftAndDepartment(
    shiftSummaryId: string,
    departmentCode: string
  ): ShiftDepartmentSummary | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM shift_department_summaries
      WHERE shift_summary_id = ? AND department_code = ?
    `);
    return stmt.get(shiftSummaryId, departmentCode) as ShiftDepartmentSummary | undefined;
  }

  /**
   * Find all summaries for a shift
   * SEC-006: Parameterized query
   *
   * @param shiftSummaryId - Shift summary ID
   * @returns Array of department summaries
   */
  findByShiftSummary(shiftSummaryId: string): ShiftDepartmentSummary[] {
    const stmt = this.db.prepare(`
      SELECT * FROM shift_department_summaries
      WHERE shift_summary_id = ?
      ORDER BY net_sales DESC
    `);
    return stmt.all(shiftSummaryId) as ShiftDepartmentSummary[];
  }

  /**
   * Get aggregated totals by department for a shift
   * SEC-006: Parameterized aggregate query
   *
   * @param shiftSummaryId - Shift summary ID
   * @returns Array of department aggregations
   */
  getAggregateByDepartment(shiftSummaryId: string): DepartmentAggregation[] {
    const stmt = this.db.prepare(`
      SELECT
        department_code,
        department_name,
        SUM(gross_sales) as total_gross_sales,
        SUM(net_sales) as total_net_sales,
        SUM(returns_total) as total_returns,
        SUM(discounts_total) as total_discounts,
        SUM(transaction_count) as transaction_count,
        SUM(items_sold_count) as items_sold_count
      FROM shift_department_summaries
      WHERE shift_summary_id = ?
      GROUP BY department_code, department_name
      ORDER BY total_net_sales DESC
    `);

    const results = stmt.all(shiftSummaryId) as Array<{
      department_code: string;
      department_name: string | null;
      total_gross_sales: number;
      total_net_sales: number;
      total_returns: number;
      total_discounts: number;
      transaction_count: number;
      items_sold_count: number;
    }>;

    return results.map((r) => ({
      departmentCode: r.department_code,
      departmentName: r.department_name,
      totalGrossSales: r.total_gross_sales,
      totalNetSales: r.total_net_sales,
      totalReturns: r.total_returns,
      totalDiscounts: r.total_discounts,
      transactionCount: r.transaction_count,
      itemsSoldCount: r.items_sold_count,
    }));
  }

  /**
   * Get shift totals
   * SEC-006: Parameterized query
   *
   * @param shiftSummaryId - Shift summary ID
   * @returns Total sales metrics
   */
  getShiftTotals(shiftSummaryId: string): {
    totalGrossSales: number;
    totalNetSales: number;
    totalReturns: number;
    totalDiscounts: number;
    totalTax: number;
    transactionCount: number;
    itemsSoldCount: number;
    departmentCount: number;
  } {
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(gross_sales), 0) as total_gross_sales,
        COALESCE(SUM(net_sales), 0) as total_net_sales,
        COALESCE(SUM(returns_total), 0) as total_returns,
        COALESCE(SUM(discounts_total), 0) as total_discounts,
        COALESCE(SUM(tax_collected), 0) as total_tax,
        COALESCE(SUM(transaction_count), 0) as transaction_count,
        COALESCE(SUM(items_sold_count), 0) as items_sold_count,
        COUNT(DISTINCT department_code) as department_count
      FROM shift_department_summaries
      WHERE shift_summary_id = ?
    `);

    const result = stmt.get(shiftSummaryId) as {
      total_gross_sales: number;
      total_net_sales: number;
      total_returns: number;
      total_discounts: number;
      total_tax: number;
      transaction_count: number;
      items_sold_count: number;
      department_count: number;
    };

    return {
      totalGrossSales: result.total_gross_sales,
      totalNetSales: result.total_net_sales,
      totalReturns: result.total_returns,
      totalDiscounts: result.total_discounts,
      totalTax: result.total_tax,
      transactionCount: result.transaction_count,
      itemsSoldCount: result.items_sold_count,
      departmentCount: result.department_count,
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
      DELETE FROM shift_department_summaries WHERE shift_summary_id = ?
    `);
    const result = stmt.run(shiftSummaryId);
    return result.changes;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for shift department summary operations
 */
export const shiftDepartmentSummariesDAL = new ShiftDepartmentSummariesDAL();
