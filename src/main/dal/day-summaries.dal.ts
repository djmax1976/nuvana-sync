/**
 * Day Summaries Data Access Layer
 *
 * CRUD operations for daily business summaries.
 * Aggregates daily sales and transaction metrics.
 *
 * @module main/dal/day-summaries
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Day summary status
 */
export type DaySummaryStatus = 'OPEN' | 'CLOSED';

/**
 * Day summary entity
 */
export interface DaySummary extends StoreEntity {
  summary_id: string;
  store_id: string;
  business_date: string;
  total_sales: number;
  total_transactions: number;
  status: DaySummaryStatus;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Day summary creation data
 */
export interface CreateDaySummaryData {
  summary_id?: string;
  store_id: string;
  business_date: string;
  total_sales?: number;
  total_transactions?: number;
}

/**
 * Day summary update data
 */
export interface UpdateDaySummaryData {
  total_sales?: number;
  total_transactions?: number;
  status?: DaySummaryStatus;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('day-summaries-dal');

// ============================================================================
// Day Summaries DAL
// ============================================================================

/**
 * Data Access Layer for day summaries
 */
export class DaySummariesDAL extends StoreBasedDAL<DaySummary> {
  protected readonly tableName = 'day_summaries';
  protected readonly primaryKey = 'summary_id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'business_date',
    'total_sales',
    'total_transactions',
    'status',
  ]);

  /**
   * Create a new day summary
   * SEC-006: Parameterized INSERT
   *
   * @param data - Day summary creation data
   * @returns Created day summary
   */
  create(data: CreateDaySummaryData): DaySummary {
    const summaryId = data.summary_id || this.generateId();
    const now = this.now();

    const stmt = this.db.prepare(`
      INSERT INTO day_summaries (
        summary_id, store_id, business_date,
        total_sales, total_transactions, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?)
    `);

    stmt.run(
      summaryId,
      data.store_id,
      data.business_date,
      data.total_sales || 0,
      data.total_transactions || 0,
      now,
      now
    );

    log.info('Day summary created', {
      summaryId,
      storeId: data.store_id,
      businessDate: data.business_date,
    });

    const created = this.findById(summaryId);
    if (!created) {
      throw new Error(`Failed to retrieve created day summary: ${summaryId}`);
    }
    return created;
  }

  /**
   * Update an existing day summary
   * SEC-006: Parameterized UPDATE
   *
   * @param summaryId - Summary ID to update
   * @param data - Fields to update
   * @returns Updated day summary or undefined
   */
  update(summaryId: string, data: UpdateDaySummaryData): DaySummary | undefined {
    const now = this.now();

    const updates: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (data.total_sales !== undefined) {
      updates.push('total_sales = ?');
      params.push(data.total_sales);
    }
    if (data.total_transactions !== undefined) {
      updates.push('total_transactions = ?');
      params.push(data.total_transactions);
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(data.status);
      if (data.status === 'CLOSED') {
        updates.push('closed_at = ?');
        params.push(now);
      }
    }

    params.push(summaryId);

    const stmt = this.db.prepare(`
      UPDATE day_summaries SET ${updates.join(', ')} WHERE summary_id = ?
    `);

    const result = stmt.run(...params);

    if (result.changes === 0) {
      return undefined;
    }

    return this.findById(summaryId);
  }

  /**
   * Close a day summary
   * SEC-006: Parameterized UPDATE
   *
   * @param summaryId - Summary ID to close
   * @returns Closed day summary or undefined
   */
  close(summaryId: string): DaySummary | undefined {
    return this.update(summaryId, { status: 'CLOSED' });
  }

  /**
   * Find day summary by business date
   * DB-006: Store-scoped query
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date (YYYY-MM-DD)
   * @returns Day summary or undefined
   */
  findByDate(storeId: string, businessDate: string): DaySummary | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM day_summaries
      WHERE store_id = ? AND business_date = ?
    `);
    return stmt.get(storeId, businessDate) as DaySummary | undefined;
  }

  /**
   * Find day summaries by date range
   * DB-006: Store-scoped query
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param startDate - Start date (inclusive)
   * @param endDate - End date (inclusive)
   * @returns Array of day summaries in range
   */
  findByDateRange(storeId: string, startDate: string, endDate: string): DaySummary[] {
    const stmt = this.db.prepare(`
      SELECT * FROM day_summaries
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      ORDER BY business_date ASC
    `);
    return stmt.all(storeId, startDate, endDate) as DaySummary[];
  }

  /**
   * Get or create day summary for a date
   * Creates if not exists, returns existing if found
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @returns Day summary for the date
   */
  getOrCreateForDate(storeId: string, businessDate: string): DaySummary {
    const existing = this.findByDate(storeId, businessDate);
    if (existing) {
      return existing;
    }

    return this.create({
      store_id: storeId,
      business_date: businessDate,
    });
  }

  /**
   * Increment sales totals
   * SEC-006: Parameterized UPDATE
   *
   * @param summaryId - Summary ID
   * @param salesAmount - Amount to add to total_sales
   * @param transactionCount - Number to add to total_transactions
   * @returns Updated day summary or undefined
   */
  incrementTotals(
    summaryId: string,
    salesAmount: number,
    transactionCount: number = 1
  ): DaySummary | undefined {
    const now = this.now();

    const stmt = this.db.prepare(`
      UPDATE day_summaries SET
        total_sales = total_sales + ?,
        total_transactions = total_transactions + ?,
        updated_at = ?
      WHERE summary_id = ? AND status = 'OPEN'
    `);

    const result = stmt.run(salesAmount, transactionCount, now, summaryId);

    if (result.changes === 0) {
      log.warn('Failed to increment totals - summary not found or closed', {
        summaryId,
      });
      return undefined;
    }

    return this.findById(summaryId);
  }

  /**
   * Get sales totals for a date range
   * DB-006: Store-scoped aggregate query
   *
   * @param storeId - Store identifier
   * @param startDate - Start date
   * @param endDate - End date
   * @returns Aggregated totals
   */
  getTotalsForDateRange(
    storeId: string,
    startDate: string,
    endDate: string
  ): { totalSales: number; totalTransactions: number; dayCount: number } {
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(total_sales), 0) as total_sales,
        COALESCE(SUM(total_transactions), 0) as total_transactions,
        COUNT(*) as day_count
      FROM day_summaries
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
    `);

    const result = stmt.get(storeId, startDate, endDate) as
      | {
          total_sales: number;
          total_transactions: number;
          day_count: number;
        }
      | undefined;

    return {
      totalSales: result?.total_sales ?? 0,
      totalTransactions: result?.total_transactions ?? 0,
      dayCount: result?.day_count ?? 0,
    };
  }

  /**
   * Get the latest open day summary
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @returns Latest open day summary or undefined
   */
  getLatestOpen(storeId: string): DaySummary | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM day_summaries
      WHERE store_id = ? AND status = 'OPEN'
      ORDER BY business_date DESC
      LIMIT 1
    `);
    return stmt.get(storeId) as DaySummary | undefined;
  }

  /**
   * Count days by status
   *
   * @param storeId - Store identifier
   * @param status - Day summary status
   * @returns Count of days with status
   */
  countByStatus(storeId: string, status: DaySummaryStatus): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM day_summaries
      WHERE store_id = ? AND status = ?
    `);
    const result = stmt.get(storeId, status) as { count: number } | undefined;
    return result?.count ?? 0;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for day summary operations
 */
export const daySummariesDAL = new DaySummariesDAL();
