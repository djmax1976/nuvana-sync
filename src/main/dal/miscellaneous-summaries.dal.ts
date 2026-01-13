/**
 * Miscellaneous Summaries Data Access Layer
 *
 * CRUD operations for various non-sales movements (payouts, payins, safe drops, etc.).
 * Parsed from NAXML MSM documents.
 *
 * @module main/dal/miscellaneous-summaries
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Miscellaneous summary entity
 */
export interface MiscellaneousSummary extends StoreEntity {
  id: string;
  store_id: string;
  business_date: string;
  shift_id: string | null;
  summary_type: string;
  summary_code: string | null;
  description: string | null;
  amount: number;
  count: number;
  tender_type: string | null;
  file_id: string | null;
  created_at: string;
}

/**
 * Miscellaneous summary creation data
 */
export interface CreateMiscellaneousSummaryData {
  store_id: string;
  business_date: string;
  shift_id?: string;
  summary_type: string;
  summary_code?: string;
  description?: string;
  amount?: number;
  count?: number;
  tender_type?: string;
  file_id?: string;
}

/**
 * NAXML MSM Detail structure for createFromNAXML
 */
export interface NAXMLMSMInput {
  miscellaneousSummaryCodes: {
    miscellaneousSummaryCode: string;
    miscellaneousSummarySubCode?: string;
    miscellaneousSummarySubCodeModifier?: string;
  };
  registerId?: string;
  cashierId?: string;
  tillId?: string;
  msmSalesTotals: {
    tender?: {
      tenderCode: string;
      tenderSubCode?: string;
    };
    miscellaneousSummaryAmount: number;
    miscellaneousSummaryCount: number;
  };
}

/**
 * Summary type aggregation
 */
export interface SummaryTypeAggregation {
  summaryType: string;
  totalAmount: number;
  totalCount: number;
  recordCount: number;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('miscellaneous-summaries-dal');

// ============================================================================
// Miscellaneous Summaries DAL
// ============================================================================

/**
 * Data Access Layer for miscellaneous summaries
 *
 * Handles MSM (Miscellaneous Summary Movement) data from NAXML files
 */
export class MiscellaneousSummariesDAL extends StoreBasedDAL<MiscellaneousSummary> {
  protected readonly tableName = 'miscellaneous_summaries';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'business_date',
    'summary_type',
    'amount',
    'count',
  ]);

  /**
   * Create a miscellaneous summary record
   * SEC-006: Parameterized INSERT
   *
   * @param data - Summary creation data
   * @returns Created summary record
   */
  create(data: CreateMiscellaneousSummaryData): MiscellaneousSummary {
    const id = this.generateId();
    const now = this.now();

    const stmt = this.db.prepare(`
      INSERT INTO miscellaneous_summaries (
        id, store_id, business_date, shift_id, summary_type,
        summary_code, description, amount, count, tender_type,
        file_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.store_id,
      data.business_date,
      data.shift_id || null,
      data.summary_type,
      data.summary_code || null,
      data.description || null,
      data.amount || 0,
      data.count || 0,
      data.tender_type || null,
      data.file_id || null,
      now
    );

    log.debug('Miscellaneous summary created', {
      id,
      storeId: data.store_id,
      businessDate: data.business_date,
      summaryType: data.summary_type,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created miscellaneous summary: ${id}`);
    }
    return created;
  }

  /**
   * Create miscellaneous summary from NAXML parsed data
   * SEC-006: Uses parameterized create method
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date from movement header
   * @param msmDetail - Parsed MSM detail from NAXML
   * @param fileId - Optional processed file ID for tracking
   * @param shiftId - Optional shift ID if from shift report
   * @returns Created record ID
   */
  createFromNAXML(
    storeId: string,
    businessDate: string,
    msmDetail: NAXMLMSMInput,
    fileId?: string,
    shiftId?: string
  ): string {
    const codes = msmDetail.miscellaneousSummaryCodes;
    const salesTotals = msmDetail.msmSalesTotals;

    // Build summary type from code components
    let summaryType = codes.miscellaneousSummaryCode;
    if (codes.miscellaneousSummarySubCode) {
      summaryType += `:${codes.miscellaneousSummarySubCode}`;
    }
    if (codes.miscellaneousSummarySubCodeModifier) {
      summaryType += `:${codes.miscellaneousSummarySubCodeModifier}`;
    }

    const record = this.create({
      store_id: storeId,
      business_date: businessDate,
      shift_id: shiftId,
      summary_type: summaryType,
      summary_code: codes.miscellaneousSummaryCode,
      amount: salesTotals.miscellaneousSummaryAmount,
      count: salesTotals.miscellaneousSummaryCount,
      tender_type: salesTotals.tender?.tenderCode ?? undefined,
      file_id: fileId,
    });

    return record.id;
  }

  /**
   * Find summaries by date
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @returns Array of summaries for the date
   */
  findByDate(storeId: string, businessDate: string): MiscellaneousSummary[] {
    const stmt = this.db.prepare(`
      SELECT * FROM miscellaneous_summaries
      WHERE store_id = ? AND business_date = ?
      ORDER BY summary_type ASC
    `);
    return stmt.all(storeId, businessDate) as MiscellaneousSummary[];
  }

  /**
   * Find summaries by date range
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param startDate - Start date (inclusive)
   * @param endDate - End date (inclusive)
   * @returns Array of summaries
   */
  findByDateRange(storeId: string, startDate: string, endDate: string): MiscellaneousSummary[] {
    const stmt = this.db.prepare(`
      SELECT * FROM miscellaneous_summaries
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      ORDER BY business_date ASC, summary_type ASC
    `);
    return stmt.all(storeId, startDate, endDate) as MiscellaneousSummary[];
  }

  /**
   * Find summaries by type
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param summaryType - Summary type (e.g., 'safeDrop', 'payout')
   * @param startDate - Optional start date filter
   * @param endDate - Optional end date filter
   * @returns Array of summaries
   */
  findByType(
    storeId: string,
    summaryType: string,
    startDate?: string,
    endDate?: string
  ): MiscellaneousSummary[] {
    if (startDate && endDate) {
      const stmt = this.db.prepare(`
        SELECT * FROM miscellaneous_summaries
        WHERE store_id = ? AND summary_type LIKE ? AND business_date >= ? AND business_date <= ?
        ORDER BY business_date DESC
      `);
      return stmt.all(storeId, `${summaryType}%`, startDate, endDate) as MiscellaneousSummary[];
    }

    const stmt = this.db.prepare(`
      SELECT * FROM miscellaneous_summaries
      WHERE store_id = ? AND summary_type LIKE ?
      ORDER BY business_date DESC
      LIMIT 100
    `);
    return stmt.all(storeId, `${summaryType}%`) as MiscellaneousSummary[];
  }

  /**
   * Find summaries by shift
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param shiftId - Shift ID
   * @returns Array of summaries for the shift
   */
  findByShift(storeId: string, shiftId: string): MiscellaneousSummary[] {
    const stmt = this.db.prepare(`
      SELECT * FROM miscellaneous_summaries
      WHERE store_id = ? AND shift_id = ?
      ORDER BY summary_type ASC
    `);
    return stmt.all(storeId, shiftId) as MiscellaneousSummary[];
  }

  /**
   * Get aggregated totals by summary type for a date range
   * DB-006: Store-scoped aggregate query
   *
   * @param storeId - Store identifier
   * @param startDate - Start date
   * @param endDate - End date
   * @returns Array of type aggregations
   */
  getAggregateByType(
    storeId: string,
    startDate: string,
    endDate: string
  ): SummaryTypeAggregation[] {
    const stmt = this.db.prepare(`
      SELECT
        summary_type,
        SUM(amount) as total_amount,
        SUM(count) as total_count,
        COUNT(*) as record_count
      FROM miscellaneous_summaries
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      GROUP BY summary_type
      ORDER BY total_amount DESC
    `);

    const results = stmt.all(storeId, startDate, endDate) as Array<{
      summary_type: string;
      total_amount: number;
      total_count: number;
      record_count: number;
    }>;

    return results.map((r) => ({
      summaryType: r.summary_type,
      totalAmount: r.total_amount,
      totalCount: r.total_count,
      recordCount: r.record_count,
    }));
  }

  /**
   * Get safe drop totals for a date
   * Common operation for end-of-day reconciliation
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @returns Safe drop totals
   */
  getSafeDropTotals(
    storeId: string,
    businessDate: string
  ): { totalAmount: number; dropCount: number } {
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) as total_amount,
        COALESCE(SUM(count), 0) as drop_count
      FROM miscellaneous_summaries
      WHERE store_id = ? AND business_date = ? AND summary_type LIKE 'safeDrop%'
    `);

    const result = stmt.get(storeId, businessDate) as {
      total_amount: number;
      drop_count: number;
    };

    return {
      totalAmount: result.total_amount,
      dropCount: result.drop_count,
    };
  }

  /**
   * Get tender breakdown for a date
   * Aggregates by tender type
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @returns Tender breakdown
   */
  getTenderBreakdown(
    storeId: string,
    businessDate: string
  ): Array<{ tenderType: string; amount: number; count: number }> {
    const stmt = this.db.prepare(`
      SELECT
        tender_type,
        SUM(amount) as amount,
        SUM(count) as count
      FROM miscellaneous_summaries
      WHERE store_id = ? AND business_date = ? AND tender_type IS NOT NULL
      GROUP BY tender_type
      ORDER BY amount DESC
    `);

    const results = stmt.all(storeId, businessDate) as Array<{
      tender_type: string;
      amount: number;
      count: number;
    }>;

    return results.map((r) => ({
      tenderType: r.tender_type,
      amount: r.amount,
      count: r.count,
    }));
  }

  /**
   * Delete summaries for a processed file (for reprocessing)
   *
   * @param fileId - Processed file ID
   * @returns Number of records deleted
   */
  deleteByFileId(fileId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM miscellaneous_summaries WHERE file_id = ?
    `);
    const result = stmt.run(fileId);

    log.debug('Miscellaneous summaries deleted by file', {
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
 * Singleton instance for miscellaneous summary operations
 */
export const miscellaneousSummariesDAL = new MiscellaneousSummariesDAL();
