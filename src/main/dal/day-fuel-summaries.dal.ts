/**
 * Day Fuel Summaries Data Access Layer
 *
 * Daily fuel summary data by grade. Child of day_summaries.
 * Enhanced in v014 to support MSM Period 1 (Daily) data with inside/outside breakdown.
 *
 * MSM Period 1 files contain complete daily fuel data:
 * - Inside fuel (cash) by grade with volume
 * - Outside fuel (credit/debit) by grade with volume
 * - Fuel discounts
 *
 * @module main/dal/day-fuel-summaries
 * @security SEC-006: All queries use prepared statements with parameter binding
 * @security DB-006: Store-scoped via parent day_summary
 * @security DB-001: ORM-like patterns with safe query building
 */

import { BaseDAL, type BaseEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Valid fuel data source types
 */
export type DayFuelSource = 'FGM' | 'MSM' | 'CALCULATED' | 'MANUAL';

/**
 * Day fuel summary entity
 */
export interface DayFuelSummary extends BaseEntity {
  day_fuel_summary_id: string;
  day_summary_id: string;
  fuel_grade_id: string | null;

  // Aggregated totals
  total_volume: number;
  total_sales: number;
  total_discount: number;

  // Tender breakdown (existing)
  cash_volume: number;
  cash_sales: number;
  credit_volume: number;
  credit_sales: number;
  debit_volume: number;
  debit_sales: number;

  // MSM inside/outside breakdown (v014)
  inside_volume: number;
  inside_amount: number;
  outside_volume: number;
  outside_amount: number;
  fuel_discount_amount: number;

  // Reconciliation (book vs meter)
  meter_volume: number | null;
  book_volume: number | null;
  variance_volume: number | null;
  variance_amount: number | null;

  // Data source and tracking (v014)
  fuel_source: DayFuelSource;
  source_file_hash: string | null;

  // Legacy fields
  grade_id: string | null;
  grade_name: string | null;

  // Audit
  created_at: string;
  updated_at: string;
}

/**
 * Day fuel summary creation data
 */
export interface CreateDayFuelSummaryData {
  day_summary_id: string;
  fuel_grade_id?: string;
  // Totals
  total_volume: number;
  total_sales: number;
  total_discount?: number;
  // Tender breakdown
  cash_volume?: number;
  cash_sales?: number;
  credit_volume?: number;
  credit_sales?: number;
  debit_volume?: number;
  debit_sales?: number;
  // MSM inside/outside (v014)
  inside_volume?: number;
  inside_amount?: number;
  outside_volume?: number;
  outside_amount?: number;
  fuel_discount_amount?: number;
  // Reconciliation
  meter_volume?: number;
  book_volume?: number;
  variance_volume?: number;
  variance_amount?: number;
  // Source
  fuel_source?: DayFuelSource;
  source_file_hash?: string;
  // Legacy
  grade_id?: string;
  grade_name?: string;
}

/**
 * MSM-specific daily fuel input
 * Used for Period 1 MSM files which contain complete daily fuel data
 */
export interface MSMDayFuelInput {
  gradeId: string;
  gradeName?: string;
  // Total values (inside + outside)
  totalVolume: number;
  totalAmount: number;
  // Inside (cash) fuel
  insideVolume: number;
  insideAmount: number;
  // Outside (credit/debit) fuel
  outsideVolume: number;
  outsideAmount: number;
  // Discounts
  discountAmount?: number;
}

/**
 * Daily fuel totals with MSM breakdown
 */
export interface DayFuelTotals {
  // Totals
  totalVolume: number;
  totalAmount: number;
  totalDiscount: number;
  // Inside breakdown
  insideVolume: number;
  insideAmount: number;
  // Outside breakdown
  outsideVolume: number;
  outsideAmount: number;
  // Average price
  averagePrice: number;
  // Source
  fuelSource: DayFuelSource;
}

/**
 * Daily fuel by grade with MSM breakdown
 */
export interface DayFuelByGrade {
  gradeId: string | null;
  gradeName: string | null;
  // Totals
  totalVolume: number;
  totalAmount: number;
  // Inside/outside
  insideVolume: number;
  insideAmount: number;
  outsideVolume: number;
  outsideAmount: number;
  // Discount
  discountAmount: number;
  // Calculated
  averagePrice: number;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('day-fuel-summaries-dal');

// ============================================================================
// Day Fuel Summaries DAL
// ============================================================================

/**
 * Data Access Layer for day fuel summaries
 *
 * Handles daily fuel data. Child of day_summaries.
 * SEC-006: All SQL uses prepared statements
 */
export class DayFuelSummariesDAL extends BaseDAL<DayFuelSummary> {
  protected readonly tableName = 'day_fuel_summaries';
  protected readonly primaryKey = 'day_fuel_summary_id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'total_volume',
    'total_sales',
  ]);

  /**
   * Create a day fuel summary record
   * SEC-006: Parameterized INSERT
   *
   * @param data - Summary creation data
   * @returns Created summary record
   */
  create(data: CreateDayFuelSummaryData): DayFuelSummary {
    const id = this.generateId();
    const now = this.now();

    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      INSERT INTO day_fuel_summaries (
        day_fuel_summary_id, day_summary_id, fuel_grade_id,
        total_volume, total_sales, total_discount,
        cash_volume, cash_sales, credit_volume, credit_sales,
        debit_volume, debit_sales,
        inside_volume, inside_amount, outside_volume, outside_amount,
        fuel_discount_amount, fuel_source, source_file_hash,
        meter_volume, book_volume, variance_volume, variance_amount,
        grade_id, grade_name,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.day_summary_id,
      data.fuel_grade_id || null,
      data.total_volume,
      data.total_sales,
      data.total_discount || 0,
      data.cash_volume || 0,
      data.cash_sales || 0,
      data.credit_volume || 0,
      data.credit_sales || 0,
      data.debit_volume || 0,
      data.debit_sales || 0,
      data.inside_volume || 0,
      data.inside_amount || 0,
      data.outside_volume || 0,
      data.outside_amount || 0,
      data.fuel_discount_amount || 0,
      data.fuel_source || 'FGM',
      data.source_file_hash || null,
      data.meter_volume || null,
      data.book_volume || null,
      data.variance_volume || null,
      data.variance_amount || null,
      data.grade_id || null,
      data.grade_name || null,
      now,
      now
    );

    log.debug('Day fuel summary created', {
      id,
      daySummaryId: data.day_summary_id,
      fuelGradeId: data.fuel_grade_id,
      fuelSource: data.fuel_source || 'FGM',
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created day fuel summary: ${id}`);
    }
    return created;
  }

  /**
   * Create or skip if duplicate exists (upsert - skip on conflict)
   * SEC-006: Parameterized queries
   *
   * @param data - Summary data
   * @returns Existing or created record
   */
  upsert(data: CreateDayFuelSummaryData): DayFuelSummary {
    // Check for existing by unique constraint (day_summary_id, fuel_grade_id)
    const existing = this.findByDaySummaryAndGrade(
      data.day_summary_id,
      data.fuel_grade_id || data.grade_id || null
    );

    if (existing) {
      log.debug('Day fuel summary already exists, skipping duplicate', {
        daySummaryId: data.day_summary_id,
        gradeId: data.fuel_grade_id || data.grade_id,
      });
      return existing;
    }

    return this.create(data);
  }

  /**
   * Create from MSM Period 1 parsed data
   * SEC-006: Uses parameterized create method
   *
   * @param daySummaryId - Parent day summary ID
   * @param input - Parsed MSM daily fuel data
   * @param sourceFileHash - File hash for deduplication
   * @returns Created record ID
   */
  createFromMSM(daySummaryId: string, input: MSMDayFuelInput, sourceFileHash?: string): string {
    const record = this.upsert({
      day_summary_id: daySummaryId,
      fuel_grade_id: undefined, // Will be resolved by mapping layer
      // Totals
      total_volume: input.totalVolume,
      total_sales: input.totalAmount,
      total_discount: input.discountAmount || 0,
      // MSM inside/outside
      inside_volume: input.insideVolume,
      inside_amount: input.insideAmount,
      outside_volume: input.outsideVolume,
      outside_amount: input.outsideAmount,
      fuel_discount_amount: input.discountAmount || 0,
      // Source
      fuel_source: 'MSM',
      source_file_hash: sourceFileHash,
      // Legacy
      grade_id: input.gradeId,
      grade_name: input.gradeName,
    });

    log.debug('MSM day fuel summary created', {
      id: record.day_fuel_summary_id,
      daySummaryId,
      gradeId: input.gradeId,
      totalVolume: input.totalVolume,
    });

    return record.day_fuel_summary_id;
  }

  /**
   * Find by day summary ID and fuel grade
   * SEC-006: Parameterized query
   *
   * @param daySummaryId - Day summary ID
   * @param fuelGradeId - Fuel grade ID (can be null)
   * @returns Record or undefined
   */
  findByDaySummaryAndGrade(
    daySummaryId: string,
    fuelGradeId: string | null
  ): DayFuelSummary | undefined {
    // SEC-006: Parameterized query prevents SQL injection
    if (fuelGradeId === null) {
      const stmt = this.db.prepare(`
        SELECT * FROM day_fuel_summaries
        WHERE day_summary_id = ? AND fuel_grade_id IS NULL
      `);
      return stmt.get(daySummaryId) as DayFuelSummary | undefined;
    }

    const stmt = this.db.prepare(`
      SELECT * FROM day_fuel_summaries
      WHERE day_summary_id = ? AND (fuel_grade_id = ? OR grade_id = ?)
    `);
    return stmt.get(daySummaryId, fuelGradeId, fuelGradeId) as DayFuelSummary | undefined;
  }

  /**
   * Find all fuel summaries for a day
   * SEC-006: Parameterized query
   *
   * @param daySummaryId - Day summary ID
   * @returns Array of fuel summaries
   */
  findByDaySummary(daySummaryId: string): DayFuelSummary[] {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      SELECT * FROM day_fuel_summaries
      WHERE day_summary_id = ?
      ORDER BY grade_id ASC
    `);
    return stmt.all(daySummaryId) as DayFuelSummary[];
  }

  /**
   * Get MSM daily fuel totals with inside/outside breakdown
   * SEC-006: Parameterized aggregate query
   *
   * @param daySummaryId - Day summary ID
   * @returns Daily fuel totals with MSM breakdown
   */
  getMSMDailyTotals(daySummaryId: string): DayFuelTotals {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(total_volume), 0) as total_volume,
        COALESCE(SUM(total_sales), 0) as total_amount,
        COALESCE(SUM(total_discount), 0) as total_discount,
        COALESCE(SUM(inside_volume), 0) as inside_volume,
        COALESCE(SUM(inside_amount), 0) as inside_amount,
        COALESCE(SUM(outside_volume), 0) as outside_volume,
        COALESCE(SUM(outside_amount), 0) as outside_amount,
        fuel_source
      FROM day_fuel_summaries
      WHERE day_summary_id = ?
      GROUP BY fuel_source
    `);

    const result = stmt.get(daySummaryId) as
      | {
          total_volume: number;
          total_amount: number;
          total_discount: number;
          inside_volume: number;
          inside_amount: number;
          outside_volume: number;
          outside_amount: number;
          fuel_source: DayFuelSource;
        }
      | undefined;

    if (!result) {
      return {
        totalVolume: 0,
        totalAmount: 0,
        totalDiscount: 0,
        insideVolume: 0,
        insideAmount: 0,
        outsideVolume: 0,
        outsideAmount: 0,
        averagePrice: 0,
        fuelSource: 'FGM',
      };
    }

    return {
      totalVolume: result.total_volume,
      totalAmount: result.total_amount,
      totalDiscount: result.total_discount,
      insideVolume: result.inside_volume,
      insideAmount: result.inside_amount,
      outsideVolume: result.outside_volume,
      outsideAmount: result.outside_amount,
      averagePrice: result.total_volume > 0 ? result.total_amount / result.total_volume : 0,
      fuelSource: result.fuel_source,
    };
  }

  /**
   * Get MSM daily fuel breakdown by grade
   * SEC-006: Parameterized aggregate query
   *
   * @param daySummaryId - Day summary ID
   * @returns Array of fuel data by grade with MSM breakdown
   */
  getMSMFuelByGrade(daySummaryId: string): DayFuelByGrade[] {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(fuel_grade_id, grade_id) as grade_id,
        grade_name,
        SUM(total_volume) as total_volume,
        SUM(total_sales) as total_amount,
        SUM(inside_volume) as inside_volume,
        SUM(inside_amount) as inside_amount,
        SUM(outside_volume) as outside_volume,
        SUM(outside_amount) as outside_amount,
        SUM(COALESCE(fuel_discount_amount, total_discount)) as discount_amount,
        CASE WHEN SUM(total_volume) > 0
          THEN SUM(total_sales) / SUM(total_volume)
          ELSE 0
        END as average_price
      FROM day_fuel_summaries
      WHERE day_summary_id = ?
      GROUP BY COALESCE(fuel_grade_id, grade_id), grade_name
      ORDER BY total_amount DESC
    `);

    const results = stmt.all(daySummaryId) as Array<{
      grade_id: string | null;
      grade_name: string | null;
      total_volume: number;
      total_amount: number;
      inside_volume: number;
      inside_amount: number;
      outside_volume: number;
      outside_amount: number;
      discount_amount: number;
      average_price: number;
    }>;

    return results.map((r) => ({
      gradeId: r.grade_id,
      gradeName: r.grade_name,
      totalVolume: r.total_volume,
      totalAmount: r.total_amount,
      insideVolume: r.inside_volume,
      insideAmount: r.inside_amount,
      outsideVolume: r.outside_volume,
      outsideAmount: r.outside_amount,
      discountAmount: r.discount_amount,
      averagePrice: r.average_price,
    }));
  }

  /**
   * Find fuel summaries by store and date range (via day_summaries join)
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   *
   * @param storeId - Store ID (from auth context)
   * @param startDate - Start date (inclusive)
   * @param endDate - End date (inclusive)
   * @param limit - Maximum records (default 100, max 1000)
   * @returns Array of day fuel summaries
   */
  findByStoreAndDateRange(
    storeId: string,
    startDate: string,
    endDate: string,
    limit: number = 100
  ): DayFuelSummary[] {
    // Enforce max limit to prevent unbounded reads
    const boundedLimit = Math.min(limit, 1000);

    // SEC-006: Parameterized query prevents SQL injection
    // DB-006: Store-scoped via join to day_summaries
    const stmt = this.db.prepare(`
      SELECT dfs.*
      FROM day_fuel_summaries dfs
      INNER JOIN day_summaries ds ON dfs.day_summary_id = ds.day_summary_id
      WHERE ds.store_id = ?
        AND ds.business_date >= ?
        AND ds.business_date <= ?
      ORDER BY ds.business_date ASC, dfs.grade_id ASC
      LIMIT ?
    `);
    return stmt.all(storeId, startDate, endDate, boundedLimit) as DayFuelSummary[];
  }

  /**
   * Find fuel summaries by store and business date
   * SEC-006: Parameterized query
   * DB-006: Store-scoped via join to day_summaries
   *
   * Direct single-date lookup for fuel data by store and business date.
   * This method joins to day_summaries for tenant isolation.
   *
   * @param storeId - Store ID (from auth context)
   * @param businessDate - Business date (YYYY-MM-DD)
   * @returns Array of day fuel summaries for the date
   */
  findByBusinessDate(storeId: string, businessDate: string): DayFuelSummary[] {
    // SEC-006: Parameterized query prevents SQL injection
    // DB-006: Store-scoped via join to day_summaries
    const stmt = this.db.prepare(`
      SELECT dfs.*
      FROM day_fuel_summaries dfs
      INNER JOIN day_summaries ds ON dfs.day_summary_id = ds.day_summary_id
      WHERE ds.store_id = ? AND ds.business_date = ?
      ORDER BY dfs.grade_id ASC
    `);
    return stmt.all(storeId, businessDate) as DayFuelSummary[];
  }

  /**
   * Get daily fuel totals by store and business date
   * SEC-006: Parameterized aggregate query
   * DB-006: Store-scoped via join to day_summaries
   *
   * Returns aggregated fuel totals for a specific store and date,
   * with inside/outside breakdown for MSM data.
   *
   * @param storeId - Store ID (from auth context)
   * @param businessDate - Business date (YYYY-MM-DD)
   * @returns Daily fuel totals with MSM breakdown
   */
  getDailyTotalsByStoreAndDate(storeId: string, businessDate: string): DayFuelTotals {
    // SEC-006: Parameterized query prevents SQL injection
    // DB-006: Store-scoped via join to day_summaries
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(dfs.total_volume), 0) as total_volume,
        COALESCE(SUM(dfs.total_sales), 0) as total_amount,
        COALESCE(SUM(dfs.total_discount), 0) as total_discount,
        COALESCE(SUM(dfs.inside_volume), 0) as inside_volume,
        COALESCE(SUM(dfs.inside_amount), 0) as inside_amount,
        COALESCE(SUM(dfs.outside_volume), 0) as outside_volume,
        COALESCE(SUM(dfs.outside_amount), 0) as outside_amount,
        MAX(dfs.fuel_source) as fuel_source
      FROM day_fuel_summaries dfs
      INNER JOIN day_summaries ds ON dfs.day_summary_id = ds.day_summary_id
      WHERE ds.store_id = ? AND ds.business_date = ?
    `);

    const result = stmt.get(storeId, businessDate) as
      | {
          total_volume: number;
          total_amount: number;
          total_discount: number;
          inside_volume: number;
          inside_amount: number;
          outside_volume: number;
          outside_amount: number;
          fuel_source: DayFuelSource | null;
        }
      | undefined;

    if (!result || result.fuel_source === null) {
      return {
        totalVolume: 0,
        totalAmount: 0,
        totalDiscount: 0,
        insideVolume: 0,
        insideAmount: 0,
        outsideVolume: 0,
        outsideAmount: 0,
        averagePrice: 0,
        fuelSource: 'FGM',
      };
    }

    return {
      totalVolume: result.total_volume,
      totalAmount: result.total_amount,
      totalDiscount: result.total_discount,
      insideVolume: result.inside_volume,
      insideAmount: result.inside_amount,
      outsideVolume: result.outside_volume,
      outsideAmount: result.outside_amount,
      averagePrice: result.total_volume > 0 ? result.total_amount / result.total_volume : 0,
      fuelSource: result.fuel_source,
    };
  }

  /**
   * Get fuel breakdown by grade for a specific store and date
   * SEC-006: Parameterized aggregate query
   * DB-006: Store-scoped via join to day_summaries
   *
   * @param storeId - Store ID (from auth context)
   * @param businessDate - Business date (YYYY-MM-DD)
   * @returns Array of fuel data by grade with inside/outside split
   */
  getFuelByGradeForStoreAndDate(storeId: string, businessDate: string): DayFuelByGrade[] {
    // SEC-006: Parameterized query prevents SQL injection
    // DB-006: Store-scoped via join to day_summaries
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(dfs.fuel_grade_id, dfs.grade_id) as grade_id,
        dfs.grade_name,
        SUM(dfs.total_volume) as total_volume,
        SUM(dfs.total_sales) as total_amount,
        SUM(dfs.inside_volume) as inside_volume,
        SUM(dfs.inside_amount) as inside_amount,
        SUM(dfs.outside_volume) as outside_volume,
        SUM(dfs.outside_amount) as outside_amount,
        SUM(COALESCE(dfs.fuel_discount_amount, dfs.total_discount)) as discount_amount,
        CASE WHEN SUM(dfs.total_volume) > 0
          THEN SUM(dfs.total_sales) / SUM(dfs.total_volume)
          ELSE 0
        END as average_price
      FROM day_fuel_summaries dfs
      INNER JOIN day_summaries ds ON dfs.day_summary_id = ds.day_summary_id
      WHERE ds.store_id = ? AND ds.business_date = ?
      GROUP BY COALESCE(dfs.fuel_grade_id, dfs.grade_id), dfs.grade_name
      ORDER BY total_amount DESC
    `);

    const results = stmt.all(storeId, businessDate) as Array<{
      grade_id: string | null;
      grade_name: string | null;
      total_volume: number;
      total_amount: number;
      inside_volume: number;
      inside_amount: number;
      outside_volume: number;
      outside_amount: number;
      discount_amount: number;
      average_price: number;
    }>;

    return results.map((r) => ({
      gradeId: r.grade_id,
      gradeName: r.grade_name,
      totalVolume: r.total_volume,
      totalAmount: r.total_amount,
      insideVolume: r.inside_volume,
      insideAmount: r.inside_amount,
      outsideVolume: r.outside_volume,
      outsideAmount: r.outside_amount,
      discountAmount: r.discount_amount,
      averagePrice: r.average_price,
    }));
  }

  /**
   * Check if MSM data exists for a day
   * SEC-006: Parameterized query
   *
   * @param daySummaryId - Day summary ID
   * @returns True if MSM data exists
   */
  hasMSMData(daySummaryId: string): boolean {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      SELECT 1 FROM day_fuel_summaries
      WHERE day_summary_id = ? AND fuel_source = 'MSM'
      LIMIT 1
    `);
    return stmt.get(daySummaryId) !== undefined;
  }

  /**
   * Delete summaries by source file hash (for reprocessing)
   * SEC-006: Parameterized DELETE
   *
   * @param sourceFileHash - Source file hash
   * @returns Number of records deleted
   */
  deleteBySourceFileHash(sourceFileHash: string): number {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      DELETE FROM day_fuel_summaries WHERE source_file_hash = ?
    `);
    const result = stmt.run(sourceFileHash);

    log.debug('Day fuel summaries deleted by source file', {
      sourceFileHash,
      count: result.changes,
    });

    return result.changes;
  }

  /**
   * Delete all fuel summaries for a day
   * SEC-006: Parameterized DELETE
   *
   * @param daySummaryId - Day summary ID
   * @returns Number of records deleted
   */
  deleteByDaySummary(daySummaryId: string): number {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      DELETE FROM day_fuel_summaries WHERE day_summary_id = ?
    `);
    const result = stmt.run(daySummaryId);
    return result.changes;
  }

  /**
   * Delete MSM-sourced fuel summaries for a day (for reprocessing)
   * SEC-006: Parameterized DELETE
   *
   * @param daySummaryId - Day summary ID
   * @returns Number of records deleted
   */
  deleteMSMByDaySummary(daySummaryId: string): number {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      DELETE FROM day_fuel_summaries
      WHERE day_summary_id = ? AND fuel_source = 'MSM'
    `);
    const result = stmt.run(daySummaryId);

    log.debug('MSM day fuel summaries deleted', {
      daySummaryId,
      count: result.changes,
    });

    return result.changes;
  }

  /**
   * Delete all fuel summaries for a store (for data reset)
   * SEC-006: Parameterized DELETE
   * DB-006: Store-scoped
   *
   * @param storeId - Store ID
   * @returns Number of records deleted
   */
  deleteAllForStore(storeId: string): number {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      DELETE FROM day_fuel_summaries
      WHERE day_summary_id IN (
        SELECT day_summary_id FROM day_summaries WHERE store_id = ?
      )
    `);
    const result = stmt.run(storeId);

    log.info('All day fuel summaries deleted for store', {
      storeId,
      count: result.changes,
    });

    return result.changes;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for day fuel summary operations
 */
export const dayFuelSummariesDAL = new DayFuelSummariesDAL();
