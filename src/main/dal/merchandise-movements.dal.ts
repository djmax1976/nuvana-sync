/**
 * Merchandise Movements Data Access Layer
 *
 * CRUD operations for sales by merchandise department/category.
 * Parsed from NAXML MCM documents.
 *
 * @module main/dal/merchandise-movements
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Merchandise movement entity
 */
export interface MerchandiseMovement extends StoreEntity {
  id: string;
  store_id: string;
  business_date: string;
  shift_id: string | null;
  department_id: string | null;
  department_name: string | null;
  category_id: string | null;
  category_name: string | null;
  quantity_sold: number;
  amount_sold: number;
  discount_amount: number;
  refund_amount: number;
  transaction_count: number;
  file_id: string | null;
  created_at: string;
}

/**
 * Merchandise movement creation data
 */
export interface CreateMerchandiseMovementData {
  store_id: string;
  business_date: string;
  shift_id?: string;
  department_id?: string;
  department_name?: string;
  category_id?: string;
  category_name?: string;
  quantity_sold?: number;
  amount_sold?: number;
  discount_amount?: number;
  refund_amount?: number;
  transaction_count?: number;
  file_id?: string;
}

/**
 * NAXML MCM input structure for createFromNAXML
 */
export interface NAXMLMCMInput {
  departmentId?: string;
  departmentName?: string;
  categoryId?: string;
  categoryName?: string;
  quantitySold?: number;
  amountSold?: number;
  discountAmount?: number;
  refundAmount?: number;
  transactionCount?: number;
}

/**
 * Department aggregation result
 */
export interface DepartmentAggregation {
  departmentId: string;
  departmentName: string | null;
  totalQuantity: number;
  totalAmount: number;
  totalDiscount: number;
  totalRefund: number;
  transactionCount: number;
  netAmount: number;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('merchandise-movements-dal');

// ============================================================================
// Merchandise Movements DAL
// ============================================================================

/**
 * Data Access Layer for merchandise movements
 *
 * Handles MCM (Merchandise Code Movement) data from NAXML files
 */
export class MerchandiseMovementsDAL extends StoreBasedDAL<MerchandiseMovement> {
  protected readonly tableName = 'merchandise_movements';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'business_date',
    'department_id',
    'category_id',
    'quantity_sold',
    'amount_sold',
    'transaction_count',
  ]);

  /**
   * Create a merchandise movement record
   * SEC-006: Parameterized INSERT
   *
   * @param data - Movement creation data
   * @returns Created movement record
   */
  create(data: CreateMerchandiseMovementData): MerchandiseMovement {
    const id = this.generateId();
    const now = this.now();

    const stmt = this.db.prepare(`
      INSERT INTO merchandise_movements (
        id, store_id, business_date, shift_id, department_id, department_name,
        category_id, category_name, quantity_sold, amount_sold,
        discount_amount, refund_amount, transaction_count, file_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.store_id,
      data.business_date,
      data.shift_id || null,
      data.department_id || null,
      data.department_name || null,
      data.category_id || null,
      data.category_name || null,
      data.quantity_sold || 0,
      data.amount_sold || 0,
      data.discount_amount || 0,
      data.refund_amount || 0,
      data.transaction_count || 0,
      data.file_id || null,
      now
    );

    log.debug('Merchandise movement created', {
      id,
      storeId: data.store_id,
      businessDate: data.business_date,
      departmentId: data.department_id,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created merchandise movement: ${id}`);
    }
    return created;
  }

  /**
   * Create merchandise movement from NAXML parsed data
   * SEC-006: Uses parameterized create method
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date from movement header
   * @param mcmInput - Parsed MCM data from NAXML
   * @param fileId - Optional processed file ID for tracking
   * @param shiftId - Optional shift ID if from shift report
   * @returns Created record ID
   */
  createFromNAXML(
    storeId: string,
    businessDate: string,
    mcmInput: NAXMLMCMInput,
    fileId?: string,
    shiftId?: string
  ): string {
    const record = this.create({
      store_id: storeId,
      business_date: businessDate,
      shift_id: shiftId,
      department_id: mcmInput.departmentId,
      department_name: mcmInput.departmentName,
      category_id: mcmInput.categoryId,
      category_name: mcmInput.categoryName,
      quantity_sold: mcmInput.quantitySold,
      amount_sold: mcmInput.amountSold,
      discount_amount: mcmInput.discountAmount,
      refund_amount: mcmInput.refundAmount,
      transaction_count: mcmInput.transactionCount,
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
  findByDate(storeId: string, businessDate: string): MerchandiseMovement[] {
    const stmt = this.db.prepare(`
      SELECT * FROM merchandise_movements
      WHERE store_id = ? AND business_date = ?
      ORDER BY department_id ASC, category_id ASC
    `);
    return stmt.all(storeId, businessDate) as MerchandiseMovement[];
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
  findByDateRange(storeId: string, startDate: string, endDate: string): MerchandiseMovement[] {
    const stmt = this.db.prepare(`
      SELECT * FROM merchandise_movements
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      ORDER BY business_date ASC, department_id ASC
    `);
    return stmt.all(storeId, startDate, endDate) as MerchandiseMovement[];
  }

  /**
   * Find movements by department
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param departmentId - Department ID
   * @param startDate - Optional start date
   * @param endDate - Optional end date
   * @returns Array of movements
   */
  findByDepartment(
    storeId: string,
    departmentId: string,
    startDate?: string,
    endDate?: string
  ): MerchandiseMovement[] {
    if (startDate && endDate) {
      const stmt = this.db.prepare(`
        SELECT * FROM merchandise_movements
        WHERE store_id = ? AND department_id = ? AND business_date >= ? AND business_date <= ?
        ORDER BY business_date DESC
      `);
      return stmt.all(storeId, departmentId, startDate, endDate) as MerchandiseMovement[];
    }

    const stmt = this.db.prepare(`
      SELECT * FROM merchandise_movements
      WHERE store_id = ? AND department_id = ?
      ORDER BY business_date DESC
      LIMIT 100
    `);
    return stmt.all(storeId, departmentId) as MerchandiseMovement[];
  }

  /**
   * Find movements by shift
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param shiftId - Shift ID
   * @returns Array of movements for the shift
   */
  findByShift(storeId: string, shiftId: string): MerchandiseMovement[] {
    const stmt = this.db.prepare(`
      SELECT * FROM merchandise_movements
      WHERE store_id = ? AND shift_id = ?
      ORDER BY department_id ASC
    `);
    return stmt.all(storeId, shiftId) as MerchandiseMovement[];
  }

  /**
   * Get aggregated totals by department for a date range
   * DB-006: Store-scoped aggregate query
   *
   * @param storeId - Store identifier
   * @param startDate - Start date
   * @param endDate - End date
   * @returns Array of department aggregations
   */
  getAggregateByDepartment(
    storeId: string,
    startDate: string,
    endDate: string
  ): DepartmentAggregation[] {
    const stmt = this.db.prepare(`
      SELECT
        department_id,
        department_name,
        SUM(quantity_sold) as total_quantity,
        SUM(amount_sold) as total_amount,
        SUM(discount_amount) as total_discount,
        SUM(refund_amount) as total_refund,
        SUM(transaction_count) as transaction_count,
        SUM(amount_sold) - SUM(discount_amount) - SUM(refund_amount) as net_amount
      FROM merchandise_movements
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      GROUP BY department_id, department_name
      ORDER BY net_amount DESC
    `);

    const results = stmt.all(storeId, startDate, endDate) as Array<{
      department_id: string;
      department_name: string | null;
      total_quantity: number;
      total_amount: number;
      total_discount: number;
      total_refund: number;
      transaction_count: number;
      net_amount: number;
    }>;

    return results.map((r) => ({
      departmentId: r.department_id,
      departmentName: r.department_name,
      totalQuantity: r.total_quantity,
      totalAmount: r.total_amount,
      totalDiscount: r.total_discount,
      totalRefund: r.total_refund,
      transactionCount: r.transaction_count,
      netAmount: r.net_amount,
    }));
  }

  /**
   * Get daily totals for a date range
   * DB-006: Store-scoped aggregate query
   *
   * @param storeId - Store identifier
   * @param startDate - Start date
   * @param endDate - End date
   * @returns Daily totals array
   */
  getDailyTotals(
    storeId: string,
    startDate: string,
    endDate: string
  ): Array<{
    businessDate: string;
    totalQuantity: number;
    totalAmount: number;
    totalDiscount: number;
    transactionCount: number;
    netAmount: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT
        business_date,
        SUM(quantity_sold) as total_quantity,
        SUM(amount_sold) as total_amount,
        SUM(discount_amount) as total_discount,
        SUM(transaction_count) as transaction_count,
        SUM(amount_sold) - SUM(discount_amount) - SUM(refund_amount) as net_amount
      FROM merchandise_movements
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      GROUP BY business_date
      ORDER BY business_date ASC
    `);

    const results = stmt.all(storeId, startDate, endDate) as Array<{
      business_date: string;
      total_quantity: number;
      total_amount: number;
      total_discount: number;
      transaction_count: number;
      net_amount: number;
    }>;

    return results.map((r) => ({
      businessDate: r.business_date,
      totalQuantity: r.total_quantity,
      totalAmount: r.total_amount,
      totalDiscount: r.total_discount,
      transactionCount: r.transaction_count,
      netAmount: r.net_amount,
    }));
  }

  /**
   * Get aggregation by date (single day)
   * DB-006: Store-scoped aggregate query
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @returns Array of department aggregations for the day
   */
  getAggregationByDate(
    storeId: string,
    businessDate: string
  ): Array<{
    departmentId: string;
    departmentName: string | null;
    salesQuantity: number;
    salesAmount: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT
        department_id,
        department_name,
        SUM(quantity_sold) as sales_quantity,
        SUM(amount_sold) as sales_amount
      FROM merchandise_movements
      WHERE store_id = ? AND business_date = ?
      GROUP BY department_id, department_name
    `);

    const results = stmt.all(storeId, businessDate) as Array<{
      department_id: string;
      department_name: string | null;
      sales_quantity: number;
      sales_amount: number;
    }>;

    return results.map((r) => ({
      departmentId: r.department_id,
      departmentName: r.department_name,
      salesQuantity: r.sales_quantity,
      salesAmount: r.sales_amount,
    }));
  }

  /**
   * Delete movements for a processed file (for reprocessing)
   *
   * @param fileId - Processed file ID
   * @returns Number of records deleted
   */
  deleteByFileId(fileId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM merchandise_movements WHERE file_id = ?
    `);
    const result = stmt.run(fileId);

    log.debug('Merchandise movements deleted by file', {
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
 * Singleton instance for merchandise movement operations
 */
export const merchandiseMovementsDAL = new MerchandiseMovementsDAL();
