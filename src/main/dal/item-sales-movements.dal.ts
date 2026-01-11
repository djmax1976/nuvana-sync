/**
 * Item Sales Movements Data Access Layer
 *
 * CRUD operations for individual item sales detail.
 * Parsed from NAXML ISM documents.
 * Note: High volume table - consider pagination for large queries.
 *
 * @module main/dal/item-sales-movements
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 */

import { StoreBasedDAL, type StoreEntity, type PaginatedResult } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Item sales movement entity
 */
export interface ItemSalesMovement extends StoreEntity {
  id: string;
  store_id: string;
  business_date: string;
  shift_id: string | null;
  item_code: string;
  item_description: string | null;
  department_id: string | null;
  upc: string | null;
  quantity_sold: number;
  amount_sold: number;
  cost_amount: number | null;
  discount_amount: number;
  transaction_count: number;
  file_id: string | null;
  created_at: string;
}

/**
 * Item sales movement creation data
 */
export interface CreateItemSalesMovementData {
  store_id: string;
  business_date: string;
  shift_id?: string;
  item_code: string;
  item_description?: string;
  department_id?: string;
  upc?: string;
  quantity_sold?: number;
  amount_sold?: number;
  cost_amount?: number;
  discount_amount?: number;
  transaction_count?: number;
  file_id?: string;
}

/**
 * NAXML ISM input structure for createFromNAXML
 */
export interface NAXMLISMInput {
  itemCode: string;
  itemDescription?: string;
  departmentId?: string;
  upc?: string;
  quantitySold?: number;
  amountSold?: number;
  costAmount?: number;
  discountAmount?: number;
  transactionCount?: number;
}

/**
 * Top selling item result
 */
export interface TopSellingItem {
  itemCode: string;
  itemDescription: string | null;
  departmentId: string | null;
  totalQuantity: number;
  totalAmount: number;
  totalDiscount: number;
  netAmount: number;
  grossMargin: number | null;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('item-sales-movements-dal');

// ============================================================================
// Item Sales Movements DAL
// ============================================================================

/**
 * Data Access Layer for item sales movements
 *
 * Handles ISM (Item Sales Movement) data from NAXML files
 */
export class ItemSalesMovementsDAL extends StoreBasedDAL<ItemSalesMovement> {
  protected readonly tableName = 'item_sales_movements';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'business_date',
    'item_code',
    'quantity_sold',
    'amount_sold',
    'transaction_count',
  ]);

  /**
   * Create an item sales movement record
   * SEC-006: Parameterized INSERT
   *
   * @param data - Movement creation data
   * @returns Created movement record
   */
  create(data: CreateItemSalesMovementData): ItemSalesMovement {
    const id = this.generateId();
    const now = this.now();

    const stmt = this.db.prepare(`
      INSERT INTO item_sales_movements (
        id, store_id, business_date, shift_id, item_code, item_description,
        department_id, upc, quantity_sold, amount_sold, cost_amount,
        discount_amount, transaction_count, file_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.store_id,
      data.business_date,
      data.shift_id || null,
      data.item_code,
      data.item_description || null,
      data.department_id || null,
      data.upc || null,
      data.quantity_sold || 0,
      data.amount_sold || 0,
      data.cost_amount ?? null,
      data.discount_amount || 0,
      data.transaction_count || 0,
      data.file_id || null,
      now
    );

    log.debug('Item sales movement created', {
      id,
      storeId: data.store_id,
      businessDate: data.business_date,
      itemCode: data.item_code,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created item sales movement: ${id}`);
    }
    return created;
  }

  /**
   * Bulk create item sales movements from NAXML
   * Uses transaction for atomicity and performance
   * SEC-006: Uses parameterized statements
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @param items - Array of parsed ISM data
   * @param fileId - Optional processed file ID
   * @param shiftId - Optional shift ID
   * @returns Number of records created
   */
  bulkCreateFromNAXML(
    storeId: string,
    businessDate: string,
    items: NAXMLISMInput[],
    fileId?: string,
    shiftId?: string
  ): number {
    if (items.length === 0) {
      return 0;
    }

    const now = this.now();

    const stmt = this.db.prepare(`
      INSERT INTO item_sales_movements (
        id, store_id, business_date, shift_id, item_code, item_description,
        department_id, upc, quantity_sold, amount_sold, cost_amount,
        discount_amount, transaction_count, file_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let count = 0;

    this.withTransaction(() => {
      for (const item of items) {
        const id = this.generateId();
        stmt.run(
          id,
          storeId,
          businessDate,
          shiftId || null,
          item.itemCode,
          item.itemDescription || null,
          item.departmentId || null,
          item.upc || null,
          item.quantitySold || 0,
          item.amountSold || 0,
          item.costAmount ?? null,
          item.discountAmount || 0,
          item.transactionCount || 0,
          fileId || null,
          now
        );
        count++;
      }
    });

    log.info('Bulk item sales movements created', {
      storeId,
      businessDate,
      count,
    });

    return count;
  }

  /**
   * Find movements by date with pagination
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @param limit - Page size
   * @param offset - Offset
   * @returns Paginated result
   */
  findByDatePaginated(
    storeId: string,
    businessDate: string,
    limit: number = 100,
    offset: number = 0
  ): PaginatedResult<ItemSalesMovement> {
    // Get count
    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM item_sales_movements
      WHERE store_id = ? AND business_date = ?
    `);
    const countResult = countStmt.get(storeId, businessDate) as { count: number };

    // Get data
    const dataStmt = this.db.prepare(`
      SELECT * FROM item_sales_movements
      WHERE store_id = ? AND business_date = ?
      ORDER BY amount_sold DESC
      LIMIT ? OFFSET ?
    `);
    const data = dataStmt.all(storeId, businessDate, limit, offset) as ItemSalesMovement[];

    return {
      data,
      total: countResult.count,
      limit,
      offset,
      hasMore: offset + data.length < countResult.count,
    };
  }

  /**
   * Find movements by item code
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param itemCode - Item code
   * @param startDate - Optional start date
   * @param endDate - Optional end date
   * @returns Array of movements
   */
  findByItemCode(
    storeId: string,
    itemCode: string,
    startDate?: string,
    endDate?: string
  ): ItemSalesMovement[] {
    if (startDate && endDate) {
      const stmt = this.db.prepare(`
        SELECT * FROM item_sales_movements
        WHERE store_id = ? AND item_code = ? AND business_date >= ? AND business_date <= ?
        ORDER BY business_date DESC
      `);
      return stmt.all(storeId, itemCode, startDate, endDate) as ItemSalesMovement[];
    }

    const stmt = this.db.prepare(`
      SELECT * FROM item_sales_movements
      WHERE store_id = ? AND item_code = ?
      ORDER BY business_date DESC
      LIMIT 100
    `);
    return stmt.all(storeId, itemCode) as ItemSalesMovement[];
  }

  /**
   * Find movements by UPC
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param upc - UPC code
   * @param limit - Maximum results
   * @returns Array of movements
   */
  findByUPC(storeId: string, upc: string, limit: number = 100): ItemSalesMovement[] {
    const stmt = this.db.prepare(`
      SELECT * FROM item_sales_movements
      WHERE store_id = ? AND upc = ?
      ORDER BY business_date DESC
      LIMIT ?
    `);
    return stmt.all(storeId, upc, limit) as ItemSalesMovement[];
  }

  /**
   * Find movements by shift
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param shiftId - Shift ID
   * @param limit - Maximum results
   * @returns Array of movements
   */
  findByShift(storeId: string, shiftId: string, limit: number = 500): ItemSalesMovement[] {
    const stmt = this.db.prepare(`
      SELECT * FROM item_sales_movements
      WHERE store_id = ? AND shift_id = ?
      ORDER BY amount_sold DESC
      LIMIT ?
    `);
    return stmt.all(storeId, shiftId, limit) as ItemSalesMovement[];
  }

  /**
   * Get top selling items for a date range
   * DB-006: Store-scoped aggregate query
   *
   * @param storeId - Store identifier
   * @param startDate - Start date
   * @param endDate - End date
   * @param limit - Number of top items to return
   * @returns Array of top selling items
   */
  getTopSellingItems(
    storeId: string,
    startDate: string,
    endDate: string,
    limit: number = 20
  ): TopSellingItem[] {
    const stmt = this.db.prepare(`
      SELECT
        item_code,
        item_description,
        department_id,
        SUM(quantity_sold) as total_quantity,
        SUM(amount_sold) as total_amount,
        SUM(discount_amount) as total_discount,
        SUM(amount_sold) - SUM(discount_amount) as net_amount,
        CASE
          WHEN SUM(cost_amount) IS NOT NULL AND SUM(amount_sold) > 0
          THEN ((SUM(amount_sold) - SUM(cost_amount)) / SUM(amount_sold)) * 100
          ELSE NULL
        END as gross_margin
      FROM item_sales_movements
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      GROUP BY item_code, item_description, department_id
      ORDER BY net_amount DESC
      LIMIT ?
    `);

    const results = stmt.all(storeId, startDate, endDate, limit) as Array<{
      item_code: string;
      item_description: string | null;
      department_id: string | null;
      total_quantity: number;
      total_amount: number;
      total_discount: number;
      net_amount: number;
      gross_margin: number | null;
    }>;

    return results.map((r) => ({
      itemCode: r.item_code,
      itemDescription: r.item_description,
      departmentId: r.department_id,
      totalQuantity: r.total_quantity,
      totalAmount: r.total_amount,
      totalDiscount: r.total_discount,
      netAmount: r.net_amount,
      grossMargin: r.gross_margin,
    }));
  }

  /**
   * Get item count by department for a date
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @returns Department item counts
   */
  getItemCountByDepartment(
    storeId: string,
    businessDate: string
  ): Array<{ departmentId: string | null; itemCount: number; totalAmount: number }> {
    const stmt = this.db.prepare(`
      SELECT
        department_id,
        COUNT(DISTINCT item_code) as item_count,
        SUM(amount_sold) as total_amount
      FROM item_sales_movements
      WHERE store_id = ? AND business_date = ?
      GROUP BY department_id
      ORDER BY total_amount DESC
    `);

    const results = stmt.all(storeId, businessDate) as Array<{
      department_id: string | null;
      item_count: number;
      total_amount: number;
    }>;

    return results.map((r) => ({
      departmentId: r.department_id,
      itemCount: r.item_count,
      totalAmount: r.total_amount,
    }));
  }

  /**
   * Get daily sales summary
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @returns Daily summary
   */
  getDaySummary(
    storeId: string,
    businessDate: string
  ): {
    totalItems: number;
    totalQuantity: number;
    totalAmount: number;
    totalDiscount: number;
    uniqueItemCount: number;
  } {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total_items,
        COALESCE(SUM(quantity_sold), 0) as total_quantity,
        COALESCE(SUM(amount_sold), 0) as total_amount,
        COALESCE(SUM(discount_amount), 0) as total_discount,
        COUNT(DISTINCT item_code) as unique_item_count
      FROM item_sales_movements
      WHERE store_id = ? AND business_date = ?
    `);

    const result = stmt.get(storeId, businessDate) as {
      total_items: number;
      total_quantity: number;
      total_amount: number;
      total_discount: number;
      unique_item_count: number;
    };

    return {
      totalItems: result.total_items,
      totalQuantity: result.total_quantity,
      totalAmount: result.total_amount,
      totalDiscount: result.total_discount,
      uniqueItemCount: result.unique_item_count,
    };
  }

  /**
   * Search items by description
   * SEC-006: Uses LIKE with parameterized value
   *
   * @param storeId - Store identifier
   * @param searchTerm - Search term
   * @param limit - Maximum results
   * @returns Matching items
   */
  searchByDescription(
    storeId: string,
    searchTerm: string,
    limit: number = 50
  ): ItemSalesMovement[] {
    const stmt = this.db.prepare(`
      SELECT * FROM item_sales_movements
      WHERE store_id = ? AND item_description LIKE ?
      ORDER BY business_date DESC, amount_sold DESC
      LIMIT ?
    `);
    return stmt.all(storeId, `%${searchTerm}%`, limit) as ItemSalesMovement[];
  }

  /**
   * Delete movements for a processed file (for reprocessing)
   *
   * @param fileId - Processed file ID
   * @returns Number of records deleted
   */
  deleteByFileId(fileId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM item_sales_movements WHERE file_id = ?
    `);
    const result = stmt.run(fileId);

    log.debug('Item sales movements deleted by file', {
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
 * Singleton instance for item sales movement operations
 */
export const itemSalesMovementsDAL = new ItemSalesMovementsDAL();
