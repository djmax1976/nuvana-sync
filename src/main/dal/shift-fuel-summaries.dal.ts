/**
 * Shift Fuel Summaries Data Access Layer
 *
 * Fuel sales by grade per shift. Replaces fuel_grade_movements table.
 * Child of shift_summaries.
 *
 * @module main/dal/shift-fuel-summaries
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
 * Valid tender types for fuel sales
 */
export type FuelTenderType = 'CASH' | 'CREDIT' | 'DEBIT' | 'FLEET' | 'OTHER' | 'ALL';

/**
 * Valid fuel data source types
 */
export type FuelSource = 'FGM' | 'MSM' | 'PJR' | 'MANUAL';

/**
 * Shift fuel summary entity
 */
export interface ShiftFuelSummary extends BaseEntity {
  shift_fuel_summary_id: string;
  shift_summary_id: string;
  fuel_grade_id: string | null;

  // Tender type
  tender_type: FuelTenderType;

  // Sales data (totals)
  sales_volume: number;
  sales_amount: number;
  discount_amount: number;
  discount_count: number;
  transaction_count: number;

  // MSM inside/outside breakdown (v014)
  inside_volume: number;
  inside_amount: number;
  outside_volume: number;
  outside_amount: number;

  // MSM metadata (v014)
  fuel_source: FuelSource;
  msm_period: number | null;
  msm_secondary_period: number | null;
  till_id: string | null;
  register_id: string | null;

  // Pricing
  unit_price: number | null;

  // Legacy fields for migration
  grade_id: string | null;
  grade_name: string | null;

  // Source tracking
  source_file_hash: string | null;

  // Audit
  created_at: string;
  updated_at: string;
}

/**
 * Shift fuel summary creation data
 */
export interface CreateShiftFuelSummaryData {
  shift_summary_id: string;
  fuel_grade_id?: string;
  tender_type: FuelTenderType;
  sales_volume: number;
  sales_amount: number;
  discount_amount?: number;
  discount_count?: number;
  transaction_count?: number;
  unit_price?: number;
  grade_id?: string;
  grade_name?: string;
  source_file_hash?: string;
  // MSM-specific fields (v014)
  inside_volume?: number;
  inside_amount?: number;
  outside_volume?: number;
  outside_amount?: number;
  fuel_source?: FuelSource;
  msm_period?: number;
  msm_secondary_period?: number;
  till_id?: string;
  register_id?: string;
}

/**
 * MSM-specific fuel input for creating from MSM parsed data
 * Used for Period 98 (Shift) MSM files
 */
export interface MSMShiftFuelInput {
  gradeId: string;
  gradeName?: string;
  tenderType?: FuelTenderType;
  // Total values (inside + outside)
  totalVolume: number;
  totalAmount: number;
  // Inside (cash) fuel breakdown
  insideVolume: number;
  insideAmount: number;
  // Outside (credit/debit) - may be 0 for Period 98
  outsideVolume?: number;
  outsideAmount?: number;
  // Discounts
  discountAmount?: number;
  discountCount?: number;
  transactionCount?: number;
  unitPrice?: number;
  // MSM context
  msmPeriod: number;
  msmSecondaryPeriod?: number;
  tillId?: string;
  registerId?: string;
}

/**
 * NAXML FGM input for creating from parsed data
 */
export interface NAXMLShiftFuelInput {
  fuelGradeId: string;
  tenderType?: FuelTenderType;
  salesVolume: number;
  salesAmount: number;
  discountAmount?: number;
  discountCount?: number;
  transactionCount?: number;
  unitPrice?: number;
}

/**
 * Fuel grade aggregation result
 */
export interface FuelGradeAggregation {
  gradeId: string | null;
  gradeName: string | null;
  totalVolume: number;
  totalSales: number;
  totalDiscount: number;
  transactionCount: number;
  averagePrice: number;
}

/**
 * MSM fuel totals with inside/outside breakdown
 */
export interface MSMFuelTotals {
  // Totals
  totalVolume: number;
  totalAmount: number;
  totalDiscount: number;
  transactionCount: number;
  // Inside breakdown
  insideVolume: number;
  insideAmount: number;
  // Outside breakdown
  outsideVolume: number;
  outsideAmount: number;
  // Average price
  averagePrice: number;
}

/**
 * MSM fuel breakdown by grade with inside/outside split
 */
export interface MSMFuelByGrade {
  gradeId: string | null;
  gradeName: string | null;
  // Totals for grade
  totalVolume: number;
  totalAmount: number;
  // Inside/outside for grade
  insideVolume: number;
  insideAmount: number;
  outsideVolume: number;
  outsideAmount: number;
  // Discount for grade
  discountAmount: number;
  averagePrice: number;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('shift-fuel-summaries-dal');

// ============================================================================
// Shift Fuel Summaries DAL
// ============================================================================

/**
 * Data Access Layer for shift fuel summaries
 *
 * Handles fuel sales data per shift. Child of shift_summaries.
 * SEC-006: All SQL uses prepared statements
 */
export class ShiftFuelSummariesDAL extends BaseDAL<ShiftFuelSummary> {
  protected readonly tableName = 'shift_fuel_summaries';
  protected readonly primaryKey = 'shift_fuel_summary_id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'sales_volume',
    'sales_amount',
    'transaction_count',
  ]);

  /**
   * Create a shift fuel summary record
   * SEC-006: Parameterized INSERT
   *
   * @param data - Summary creation data
   * @returns Created summary record
   */
  create(data: CreateShiftFuelSummaryData): ShiftFuelSummary {
    const id = this.generateId();
    const now = this.now();

    // Calculate unit price if not provided
    let unitPrice = data.unit_price;
    if (!unitPrice && data.sales_volume > 0) {
      unitPrice = data.sales_amount / data.sales_volume;
    }

    // SEC-006: Parameterized query prevents SQL injection
    // v014: Added MSM-specific columns for inside/outside breakdown
    const stmt = this.db.prepare(`
      INSERT INTO shift_fuel_summaries (
        shift_fuel_summary_id, shift_summary_id, fuel_grade_id,
        tender_type, sales_volume, sales_amount,
        discount_amount, discount_count, transaction_count,
        unit_price, grade_id, grade_name, source_file_hash,
        inside_volume, inside_amount, outside_volume, outside_amount,
        fuel_source, msm_period, msm_secondary_period, till_id, register_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.shift_summary_id,
      data.fuel_grade_id || null,
      data.tender_type,
      data.sales_volume,
      data.sales_amount,
      data.discount_amount || 0,
      data.discount_count || 0,
      data.transaction_count || 0,
      unitPrice || null,
      data.grade_id || null,
      data.grade_name || null,
      data.source_file_hash || null,
      data.inside_volume || 0,
      data.inside_amount || 0,
      data.outside_volume || 0,
      data.outside_amount || 0,
      data.fuel_source || 'FGM',
      data.msm_period || null,
      data.msm_secondary_period || null,
      data.till_id || null,
      data.register_id || null,
      now,
      now
    );

    log.debug('Shift fuel summary created', {
      id,
      shiftSummaryId: data.shift_summary_id,
      fuelGradeId: data.fuel_grade_id,
      tenderType: data.tender_type,
      fuelSource: data.fuel_source || 'FGM',
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created shift fuel summary: ${id}`);
    }
    return created;
  }

  /**
   * Create or update shift fuel summary (upsert)
   * SEC-006: Parameterized queries
   *
   * @param data - Summary data
   * @returns Created or updated record
   */
  upsert(data: CreateShiftFuelSummaryData): ShiftFuelSummary {
    // Check for existing record by unique constraint
    const existing = this.findByShiftGradeTender(
      data.shift_summary_id,
      data.fuel_grade_id || data.grade_id || null,
      data.tender_type
    );

    if (existing) {
      // If a record already exists for this shift/grade/tender, SKIP it.
      // This prevents duplicate accumulation from multiple Period 98 MSM files
      // that contain the same fuel data for the same shift.
      // The first file processed wins - subsequent files are ignored.
      log.debug('Shift fuel summary already exists, skipping duplicate', {
        shiftSummaryId: data.shift_summary_id,
        gradeId: data.fuel_grade_id || data.grade_id,
        tenderType: data.tender_type,
        existingFileHash: existing.source_file_hash,
        newFileHash: data.source_file_hash,
      });
      return existing;
    }

    return this.create(data);
  }

  /**
   * Create from NAXML parsed data
   * SEC-006: Uses parameterized create method
   *
   * @param shiftSummaryId - Parent shift summary ID
   * @param input - Parsed NAXML FGM data
   * @param sourceFileHash - Optional file hash for tracking
   * @returns Created record ID
   */
  createFromNAXML(
    shiftSummaryId: string,
    input: NAXMLShiftFuelInput,
    sourceFileHash?: string
  ): string {
    const record = this.upsert({
      shift_summary_id: shiftSummaryId,
      fuel_grade_id: undefined, // Will be resolved by mapping layer
      tender_type: input.tenderType || 'ALL',
      sales_volume: input.salesVolume,
      sales_amount: input.salesAmount,
      discount_amount: input.discountAmount,
      discount_count: input.discountCount,
      transaction_count: input.transactionCount,
      unit_price: input.unitPrice,
      grade_id: input.fuelGradeId, // Store original POS code
      source_file_hash: sourceFileHash,
    });

    return record.shift_fuel_summary_id;
  }

  /**
   * Find by shift summary, grade, and tender type
   * SEC-006: Parameterized query
   *
   * @param shiftSummaryId - Shift summary ID
   * @param fuelGradeId - Fuel grade ID (can be null)
   * @param tenderType - Tender type
   * @returns Record or undefined
   */
  findByShiftGradeTender(
    shiftSummaryId: string,
    fuelGradeId: string | null,
    tenderType: FuelTenderType
  ): ShiftFuelSummary | undefined {
    if (fuelGradeId === null) {
      const stmt = this.db.prepare(`
        SELECT * FROM shift_fuel_summaries
        WHERE shift_summary_id = ? AND fuel_grade_id IS NULL AND tender_type = ?
      `);
      return stmt.get(shiftSummaryId, tenderType) as ShiftFuelSummary | undefined;
    }

    const stmt = this.db.prepare(`
      SELECT * FROM shift_fuel_summaries
      WHERE shift_summary_id = ? AND (fuel_grade_id = ? OR grade_id = ?) AND tender_type = ?
    `);
    return stmt.get(shiftSummaryId, fuelGradeId, fuelGradeId, tenderType) as
      | ShiftFuelSummary
      | undefined;
  }

  /**
   * Find all summaries for a shift
   * SEC-006: Parameterized query
   *
   * @param shiftSummaryId - Shift summary ID
   * @returns Array of fuel summaries
   */
  findByShiftSummary(shiftSummaryId: string): ShiftFuelSummary[] {
    const stmt = this.db.prepare(`
      SELECT * FROM shift_fuel_summaries
      WHERE shift_summary_id = ?
      ORDER BY grade_id ASC, tender_type ASC
    `);
    return stmt.all(shiftSummaryId) as ShiftFuelSummary[];
  }

  /**
   * Get aggregated totals by grade for a shift
   * SEC-006: Parameterized aggregate query
   *
   * @param shiftSummaryId - Shift summary ID
   * @returns Array of grade aggregations
   */
  getAggregateByGrade(shiftSummaryId: string): FuelGradeAggregation[] {
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(fuel_grade_id, grade_id) as grade_id,
        grade_name,
        SUM(sales_volume) as total_volume,
        SUM(sales_amount) as total_sales,
        SUM(discount_amount) as total_discount,
        SUM(transaction_count) as transaction_count,
        CASE WHEN SUM(sales_volume) > 0
          THEN SUM(sales_amount) / SUM(sales_volume)
          ELSE 0
        END as average_price
      FROM shift_fuel_summaries
      WHERE shift_summary_id = ?
      GROUP BY COALESCE(fuel_grade_id, grade_id), grade_name
      ORDER BY total_sales DESC
    `);

    const results = stmt.all(shiftSummaryId) as Array<{
      grade_id: string | null;
      grade_name: string | null;
      total_volume: number;
      total_sales: number;
      total_discount: number;
      transaction_count: number;
      average_price: number;
    }>;

    return results.map((r) => ({
      gradeId: r.grade_id,
      gradeName: r.grade_name,
      totalVolume: r.total_volume,
      totalSales: r.total_sales,
      totalDiscount: r.total_discount,
      transactionCount: r.transaction_count,
      averagePrice: r.average_price,
    }));
  }

  /**
   * Get shift total fuel sales
   * SEC-006: Parameterized query
   *
   * @param shiftSummaryId - Shift summary ID
   * @returns Total gallons and sales
   */
  getShiftTotals(shiftSummaryId: string): {
    totalVolume: number;
    totalSales: number;
    totalDiscount: number;
    transactionCount: number;
  } {
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(sales_volume), 0) as total_volume,
        COALESCE(SUM(sales_amount), 0) as total_sales,
        COALESCE(SUM(discount_amount), 0) as total_discount,
        COALESCE(SUM(transaction_count), 0) as transaction_count
      FROM shift_fuel_summaries
      WHERE shift_summary_id = ?
    `);

    const result = stmt.get(shiftSummaryId) as {
      total_volume: number;
      total_sales: number;
      total_discount: number;
      transaction_count: number;
    };

    return {
      totalVolume: result.total_volume,
      totalSales: result.total_sales,
      totalDiscount: result.total_discount,
      transactionCount: result.transaction_count,
    };
  }

  /**
   * Delete summaries by source file hash (for reprocessing)
   * SEC-006: Parameterized DELETE
   *
   * @param sourceFileHash - Source file hash
   * @returns Number of records deleted
   */
  deleteBySourceFileHash(sourceFileHash: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM shift_fuel_summaries WHERE source_file_hash = ?
    `);
    const result = stmt.run(sourceFileHash);

    log.debug('Shift fuel summaries deleted by source file', {
      sourceFileHash,
      count: result.changes,
    });

    return result.changes;
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
      DELETE FROM shift_fuel_summaries WHERE shift_summary_id = ?
    `);
    const result = stmt.run(shiftSummaryId);
    return result.changes;
  }

  /**
   * Delete all fuel summaries for a store (for data reset/reprocessing)
   * SEC-006: Parameterized DELETE
   *
   * @param storeId - Store ID
   * @returns Number of records deleted
   */
  deleteAllForStore(storeId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM shift_fuel_summaries
      WHERE shift_summary_id IN (
        SELECT shift_summary_id FROM shift_summaries WHERE store_id = ?
      )
    `);
    const result = stmt.run(storeId);

    log.info('All shift fuel summaries deleted for store', {
      storeId,
      count: result.changes,
    });

    return result.changes;
  }

  // ============================================================================
  // MSM-Specific Methods (v014)
  // ============================================================================

  /**
   * Create from MSM parsed data with inside/outside breakdown
   * SEC-006: Uses parameterized create method
   *
   * Use for Period 98 MSM files which contain shift-level fuel data
   * with inside (cash) and outside (credit/debit) breakdown.
   *
   * @param shiftSummaryId - Parent shift summary ID
   * @param input - Parsed MSM fuel data with inside/outside breakdown
   * @param sourceFileHash - File hash for deduplication
   * @returns Created record ID
   */
  createFromMSM(shiftSummaryId: string, input: MSMShiftFuelInput, sourceFileHash?: string): string {
    const record = this.upsert({
      shift_summary_id: shiftSummaryId,
      fuel_grade_id: undefined, // Will be resolved by mapping layer
      tender_type: input.tenderType || 'ALL',
      // Total values
      sales_volume: input.totalVolume,
      sales_amount: input.totalAmount,
      // Inside/outside breakdown
      inside_volume: input.insideVolume,
      inside_amount: input.insideAmount,
      outside_volume: input.outsideVolume || 0,
      outside_amount: input.outsideAmount || 0,
      // Discount
      discount_amount: input.discountAmount,
      discount_count: input.discountCount,
      transaction_count: input.transactionCount,
      unit_price: input.unitPrice,
      // Legacy grade ID
      grade_id: input.gradeId,
      grade_name: input.gradeName,
      // MSM metadata
      fuel_source: 'MSM',
      msm_period: input.msmPeriod,
      msm_secondary_period: input.msmSecondaryPeriod,
      till_id: input.tillId,
      register_id: input.registerId,
      source_file_hash: sourceFileHash,
    });

    log.debug('MSM shift fuel summary created', {
      id: record.shift_fuel_summary_id,
      shiftSummaryId,
      gradeId: input.gradeId,
      msmPeriod: input.msmPeriod,
      insideVolume: input.insideVolume,
      outsideVolume: input.outsideVolume,
    });

    return record.shift_fuel_summary_id;
  }

  /**
   * Get MSM fuel totals with inside/outside breakdown for a shift
   * SEC-006: Parameterized aggregate query
   *
   * Returns fuel totals split by inside (cash) and outside (credit/debit).
   * Useful for matching PDF report format which shows this breakdown.
   *
   * @param shiftSummaryId - Shift summary ID
   * @returns MSM fuel totals with inside/outside split
   */
  getMSMShiftTotals(shiftSummaryId: string): MSMFuelTotals {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(sales_volume), 0) as total_volume,
        COALESCE(SUM(sales_amount), 0) as total_amount,
        COALESCE(SUM(discount_amount), 0) as total_discount,
        COALESCE(SUM(transaction_count), 0) as transaction_count,
        COALESCE(SUM(inside_volume), 0) as inside_volume,
        COALESCE(SUM(inside_amount), 0) as inside_amount,
        COALESCE(SUM(outside_volume), 0) as outside_volume,
        COALESCE(SUM(outside_amount), 0) as outside_amount
      FROM shift_fuel_summaries
      WHERE shift_summary_id = ?
    `);

    const result = stmt.get(shiftSummaryId) as {
      total_volume: number;
      total_amount: number;
      total_discount: number;
      transaction_count: number;
      inside_volume: number;
      inside_amount: number;
      outside_volume: number;
      outside_amount: number;
    };

    return {
      totalVolume: result.total_volume,
      totalAmount: result.total_amount,
      totalDiscount: result.total_discount,
      transactionCount: result.transaction_count,
      insideVolume: result.inside_volume,
      insideAmount: result.inside_amount,
      outsideVolume: result.outside_volume,
      outsideAmount: result.outside_amount,
      averagePrice: result.total_volume > 0 ? result.total_amount / result.total_volume : 0,
    };
  }

  /**
   * Get MSM fuel breakdown by grade with inside/outside split
   * SEC-006: Parameterized aggregate query
   *
   * Returns per-grade fuel data with inside/outside breakdown.
   * Only available from MSM source data (not FGM).
   *
   * @param shiftSummaryId - Shift summary ID
   * @returns Array of fuel data by grade with inside/outside split
   */
  getMSMFuelByGrade(shiftSummaryId: string): MSMFuelByGrade[] {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(fuel_grade_id, grade_id) as grade_id,
        grade_name,
        SUM(sales_volume) as total_volume,
        SUM(sales_amount) as total_amount,
        SUM(inside_volume) as inside_volume,
        SUM(inside_amount) as inside_amount,
        SUM(outside_volume) as outside_volume,
        SUM(outside_amount) as outside_amount,
        SUM(discount_amount) as discount_amount,
        CASE WHEN SUM(sales_volume) > 0
          THEN SUM(sales_amount) / SUM(sales_volume)
          ELSE 0
        END as average_price
      FROM shift_fuel_summaries
      WHERE shift_summary_id = ?
      GROUP BY COALESCE(fuel_grade_id, grade_id), grade_name
      ORDER BY total_amount DESC
    `);

    const results = stmt.all(shiftSummaryId) as Array<{
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
   * Find all MSM-sourced fuel summaries for a shift
   * SEC-006: Parameterized query
   *
   * @param shiftSummaryId - Shift summary ID
   * @returns Array of MSM-sourced fuel summaries
   */
  findMSMByShiftSummary(shiftSummaryId: string): ShiftFuelSummary[] {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      SELECT * FROM shift_fuel_summaries
      WHERE shift_summary_id = ? AND fuel_source = 'MSM'
      ORDER BY grade_id ASC, tender_type ASC
    `);
    return stmt.all(shiftSummaryId) as ShiftFuelSummary[];
  }

  /**
   * Find fuel summaries by till ID for Period 98 linking
   * SEC-006: Parameterized query
   * DB-006: Store-scoped via parent shift_summary
   *
   * @param storeId - Store ID for tenant isolation
   * @param businessDate - Business date
   * @param tillId - Till ID from MSM file
   * @returns Array of matching fuel summaries
   */
  findByTillId(storeId: string, businessDate: string, tillId: string): ShiftFuelSummary[] {
    // SEC-006: Parameterized query prevents SQL injection
    // DB-006: Store-scoped via join to shift_summaries
    const stmt = this.db.prepare(`
      SELECT sfs.*
      FROM shift_fuel_summaries sfs
      INNER JOIN shift_summaries ss ON sfs.shift_summary_id = ss.shift_summary_id
      WHERE ss.store_id = ?
        AND ss.business_date = ?
        AND sfs.till_id = ?
      ORDER BY sfs.grade_id ASC
    `);
    return stmt.all(storeId, businessDate, tillId) as ShiftFuelSummary[];
  }

  /**
   * Delete MSM-sourced fuel summaries for reprocessing
   * SEC-006: Parameterized DELETE
   *
   * @param shiftSummaryId - Shift summary ID
   * @returns Number of records deleted
   */
  deleteMSMByShiftSummary(shiftSummaryId: string): number {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      DELETE FROM shift_fuel_summaries
      WHERE shift_summary_id = ? AND fuel_source = 'MSM'
    `);
    const result = stmt.run(shiftSummaryId);

    log.debug('MSM shift fuel summaries deleted', {
      shiftSummaryId,
      count: result.changes,
    });

    return result.changes;
  }

  /**
   * Check if MSM data exists for a shift
   * SEC-006: Parameterized query
   *
   * @param shiftSummaryId - Shift summary ID
   * @returns True if MSM data exists
   */
  hasMSMData(shiftSummaryId: string): boolean {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      SELECT 1 FROM shift_fuel_summaries
      WHERE shift_summary_id = ? AND fuel_source = 'MSM'
      LIMIT 1
    `);
    return stmt.get(shiftSummaryId) !== undefined;
  }

  // ============================================================================
  // Store/Date Query Methods (Phase 3 Plan Requirements)
  // ============================================================================

  /**
   * Find shift fuel summaries by store and business date
   * SEC-006: Parameterized query
   * DB-006: Store-scoped via join to shift_summaries
   *
   * Returns all fuel summaries for shifts on a specific business date.
   * Useful for getting all shift-level fuel data for a day.
   *
   * @param storeId - Store ID (from auth context)
   * @param businessDate - Business date (YYYY-MM-DD)
   * @returns Array of shift fuel summaries for the date
   */
  findByBusinessDate(storeId: string, businessDate: string): ShiftFuelSummary[] {
    // SEC-006: Parameterized query prevents SQL injection
    // DB-006: Store-scoped via join to shift_summaries
    const stmt = this.db.prepare(`
      SELECT sfs.*
      FROM shift_fuel_summaries sfs
      INNER JOIN shift_summaries ss ON sfs.shift_summary_id = ss.shift_summary_id
      WHERE ss.store_id = ? AND ss.business_date = ?
      ORDER BY ss.shift_summary_id ASC, sfs.grade_id ASC, sfs.tender_type ASC
    `);
    return stmt.all(storeId, businessDate) as ShiftFuelSummary[];
  }

  /**
   * Get aggregated fuel totals by store and business date
   * SEC-006: Parameterized aggregate query
   * DB-006: Store-scoped via join to shift_summaries
   *
   * Returns combined fuel totals across all shifts for a specific date.
   * Includes inside/outside breakdown from MSM data.
   *
   * @param storeId - Store ID (from auth context)
   * @param businessDate - Business date (YYYY-MM-DD)
   * @returns Aggregated fuel totals with inside/outside split
   */
  getTotalsByBusinessDate(storeId: string, businessDate: string): MSMFuelTotals {
    // SEC-006: Parameterized query prevents SQL injection
    // DB-006: Store-scoped via join to shift_summaries
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(sfs.sales_volume), 0) as total_volume,
        COALESCE(SUM(sfs.sales_amount), 0) as total_amount,
        COALESCE(SUM(sfs.discount_amount), 0) as total_discount,
        COALESCE(SUM(sfs.transaction_count), 0) as transaction_count,
        COALESCE(SUM(sfs.inside_volume), 0) as inside_volume,
        COALESCE(SUM(sfs.inside_amount), 0) as inside_amount,
        COALESCE(SUM(sfs.outside_volume), 0) as outside_volume,
        COALESCE(SUM(sfs.outside_amount), 0) as outside_amount
      FROM shift_fuel_summaries sfs
      INNER JOIN shift_summaries ss ON sfs.shift_summary_id = ss.shift_summary_id
      WHERE ss.store_id = ? AND ss.business_date = ?
    `);

    const result = stmt.get(storeId, businessDate) as {
      total_volume: number;
      total_amount: number;
      total_discount: number;
      transaction_count: number;
      inside_volume: number;
      inside_amount: number;
      outside_volume: number;
      outside_amount: number;
    };

    return {
      totalVolume: result.total_volume,
      totalAmount: result.total_amount,
      totalDiscount: result.total_discount,
      transactionCount: result.transaction_count,
      insideVolume: result.inside_volume,
      insideAmount: result.inside_amount,
      outsideVolume: result.outside_volume,
      outsideAmount: result.outside_amount,
      averagePrice: result.total_volume > 0 ? result.total_amount / result.total_volume : 0,
    };
  }

  /**
   * Get fuel breakdown by grade for a store and business date
   * SEC-006: Parameterized aggregate query
   * DB-006: Store-scoped via join to shift_summaries
   *
   * Aggregates fuel data by grade across all shifts for a date.
   * Useful for daily reporting by fuel grade.
   *
   * @param storeId - Store ID (from auth context)
   * @param businessDate - Business date (YYYY-MM-DD)
   * @returns Array of fuel data by grade with inside/outside split
   */
  getByGradeForBusinessDate(storeId: string, businessDate: string): MSMFuelByGrade[] {
    // SEC-006: Parameterized query prevents SQL injection
    // DB-006: Store-scoped via join to shift_summaries
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(sfs.fuel_grade_id, sfs.grade_id) as grade_id,
        sfs.grade_name,
        SUM(sfs.sales_volume) as total_volume,
        SUM(sfs.sales_amount) as total_amount,
        SUM(sfs.inside_volume) as inside_volume,
        SUM(sfs.inside_amount) as inside_amount,
        SUM(sfs.outside_volume) as outside_volume,
        SUM(sfs.outside_amount) as outside_amount,
        SUM(sfs.discount_amount) as discount_amount,
        CASE WHEN SUM(sfs.sales_volume) > 0
          THEN SUM(sfs.sales_amount) / SUM(sfs.sales_volume)
          ELSE 0
        END as average_price
      FROM shift_fuel_summaries sfs
      INNER JOIN shift_summaries ss ON sfs.shift_summary_id = ss.shift_summary_id
      WHERE ss.store_id = ? AND ss.business_date = ?
      GROUP BY COALESCE(sfs.fuel_grade_id, sfs.grade_id), sfs.grade_name
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
   * Find MSM fuel summaries by store and business date
   * SEC-006: Parameterized query
   * DB-006: Store-scoped via join to shift_summaries
   *
   * Returns only MSM-sourced fuel data (not FGM) for a date.
   * Use this when you specifically need MSM inside/outside breakdown.
   *
   * @param storeId - Store ID (from auth context)
   * @param businessDate - Business date (YYYY-MM-DD)
   * @returns Array of MSM-sourced shift fuel summaries
   */
  findMSMByBusinessDate(storeId: string, businessDate: string): ShiftFuelSummary[] {
    // SEC-006: Parameterized query prevents SQL injection
    // DB-006: Store-scoped via join to shift_summaries
    const stmt = this.db.prepare(`
      SELECT sfs.*
      FROM shift_fuel_summaries sfs
      INNER JOIN shift_summaries ss ON sfs.shift_summary_id = ss.shift_summary_id
      WHERE ss.store_id = ? AND ss.business_date = ? AND sfs.fuel_source = 'MSM'
      ORDER BY ss.shift_summary_id ASC, sfs.grade_id ASC
    `);
    return stmt.all(storeId, businessDate) as ShiftFuelSummary[];
  }

  /**
   * Check if MSM data exists for a store and business date
   * SEC-006: Parameterized query
   * DB-006: Store-scoped via join to shift_summaries
   *
   * @param storeId - Store ID (from auth context)
   * @param businessDate - Business date (YYYY-MM-DD)
   * @returns True if MSM data exists for any shift on this date
   */
  hasMSMDataForBusinessDate(storeId: string, businessDate: string): boolean {
    // SEC-006: Parameterized query prevents SQL injection
    // DB-006: Store-scoped via join to shift_summaries
    const stmt = this.db.prepare(`
      SELECT 1
      FROM shift_fuel_summaries sfs
      INNER JOIN shift_summaries ss ON sfs.shift_summary_id = ss.shift_summary_id
      WHERE ss.store_id = ? AND ss.business_date = ? AND sfs.fuel_source = 'MSM'
      LIMIT 1
    `);
    return stmt.get(storeId, businessDate) !== undefined;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for shift fuel summary operations
 */
export const shiftFuelSummariesDAL = new ShiftFuelSummariesDAL();
