/**
 * Fuel Grade Movements Data Access Layer
 *
 * CRUD operations for fuel sales by grade (regular, plus, premium, diesel).
 * Parsed from NAXML FGM documents.
 *
 * @module main/dal/fuel-grade-movements
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Fuel grade movement entity
 */
export interface FuelGradeMovement extends StoreEntity {
  id: string;
  store_id: string;
  business_date: string;
  shift_id: string | null;
  grade_id: string | null;
  grade_name: string | null;
  volume_sold: number;
  amount_sold: number;
  volume_unit: string;
  transaction_count: number;
  average_price_per_unit: number | null;
  file_id: string | null;
  created_at: string;
}

/**
 * Fuel grade movement creation data
 */
export interface CreateFuelGradeMovementData {
  store_id: string;
  business_date: string;
  shift_id?: string;
  grade_id?: string;
  grade_name?: string;
  volume_sold?: number;
  amount_sold?: number;
  volume_unit?: string;
  transaction_count?: number;
  average_price_per_unit?: number;
  file_id?: string;
}

/**
 * NAXML FGM Detail structure for createFromNAXML
 */
export interface NAXMLFGMInput {
  fuelGradeId: string;
  fgmTenderSummary?: {
    tender: { tenderCode: string; tenderSubCode?: string };
    fgmSellPriceSummary: {
      actualSalesPrice: number;
      fgmServiceLevelSummary: {
        serviceLevelCode: string;
        fgmSalesTotals: {
          fuelGradeSalesVolume: number;
          fuelGradeSalesAmount: number;
          discountAmount?: number;
          discountCount?: number;
        };
      };
    };
  };
  fgmPositionSummary?: {
    fuelPositionId: string;
    fgmPriceTierSummaries?: Array<{
      priceTierCode: string;
      fgmSalesTotals: {
        fuelGradeSalesVolume: number;
        fuelGradeSalesAmount: number;
        discountAmount?: number;
        discountCount?: number;
      };
    }>;
  };
}

/**
 * Fuel grade aggregation result
 */
export interface FuelGradeAggregation {
  gradeId: string;
  gradeName: string | null;
  totalVolume: number;
  totalAmount: number;
  transactionCount: number;
  averagePrice: number;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('fuel-grade-movements-dal');

// ============================================================================
// Fuel Grade Movements DAL
// ============================================================================

/**
 * Data Access Layer for fuel grade movements
 *
 * Handles FGM (Fuel Grade Movement) data from NAXML files
 */
export class FuelGradeMovementsDAL extends StoreBasedDAL<FuelGradeMovement> {
  protected readonly tableName = 'fuel_grade_movements';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'business_date',
    'grade_id',
    'volume_sold',
    'amount_sold',
    'transaction_count',
  ]);

  /**
   * Create a fuel grade movement record
   * SEC-006: Parameterized INSERT
   *
   * @param data - Movement creation data
   * @returns Created movement record
   */
  create(data: CreateFuelGradeMovementData): FuelGradeMovement {
    const id = this.generateId();
    const now = this.now();

    // Calculate average price if volume > 0
    let avgPrice = data.average_price_per_unit;
    if (!avgPrice && data.volume_sold && data.volume_sold > 0 && data.amount_sold) {
      avgPrice = data.amount_sold / data.volume_sold;
    }

    const stmt = this.db.prepare(`
      INSERT INTO fuel_grade_movements (
        id, store_id, business_date, shift_id, grade_id, grade_name,
        volume_sold, amount_sold, volume_unit, transaction_count,
        average_price_per_unit, file_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.store_id,
      data.business_date,
      data.shift_id || null,
      data.grade_id || null,
      data.grade_name || null,
      data.volume_sold || 0,
      data.amount_sold || 0,
      data.volume_unit || 'GALLONS',
      data.transaction_count || 0,
      avgPrice || null,
      data.file_id || null,
      now
    );

    log.debug('Fuel grade movement created', {
      id,
      storeId: data.store_id,
      businessDate: data.business_date,
      gradeId: data.grade_id,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created fuel grade movement: ${id}`);
    }
    return created;
  }

  /**
   * Create fuel grade movement from NAXML parsed data
   * SEC-006: Uses parameterized create method
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date from movement header
   * @param fgmDetail - Parsed FGM detail from NAXML
   * @param fileId - Optional processed file ID for tracking
   * @param shiftId - Optional shift ID if from shift report
   * @returns Created movement record ID
   */
  createFromNAXML(
    storeId: string,
    businessDate: string,
    fgmDetail: NAXMLFGMInput,
    fileId?: string,
    shiftId?: string
  ): string {
    // Extract sales totals from either tender summary or position summary
    let volume = 0;
    let amount = 0;

    if (fgmDetail.fgmTenderSummary) {
      const salesTotals =
        fgmDetail.fgmTenderSummary.fgmSellPriceSummary.fgmServiceLevelSummary.fgmSalesTotals;
      volume = salesTotals.fuelGradeSalesVolume;
      amount = salesTotals.fuelGradeSalesAmount;
    } else if (fgmDetail.fgmPositionSummary?.fgmPriceTierSummaries) {
      // Aggregate from all price tiers
      for (const tier of fgmDetail.fgmPositionSummary.fgmPriceTierSummaries) {
        volume += tier.fgmSalesTotals.fuelGradeSalesVolume;
        amount += tier.fgmSalesTotals.fuelGradeSalesAmount;
      }
    }

    const record = this.create({
      store_id: storeId,
      business_date: businessDate,
      shift_id: shiftId,
      grade_id: fgmDetail.fuelGradeId,
      volume_sold: volume,
      amount_sold: amount,
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
  findByDate(storeId: string, businessDate: string): FuelGradeMovement[] {
    const stmt = this.db.prepare(`
      SELECT * FROM fuel_grade_movements
      WHERE store_id = ? AND business_date = ?
      ORDER BY grade_id ASC
    `);
    return stmt.all(storeId, businessDate) as FuelGradeMovement[];
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
  findByDateRange(storeId: string, startDate: string, endDate: string): FuelGradeMovement[] {
    const stmt = this.db.prepare(`
      SELECT * FROM fuel_grade_movements
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      ORDER BY business_date ASC, grade_id ASC
    `);
    return stmt.all(storeId, startDate, endDate) as FuelGradeMovement[];
  }

  /**
   * Find movements by shift
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param shiftId - Shift ID
   * @returns Array of movements for the shift
   */
  findByShift(storeId: string, shiftId: string): FuelGradeMovement[] {
    const stmt = this.db.prepare(`
      SELECT * FROM fuel_grade_movements
      WHERE store_id = ? AND shift_id = ?
      ORDER BY grade_id ASC
    `);
    return stmt.all(storeId, shiftId) as FuelGradeMovement[];
  }

  /**
   * Get aggregated totals by grade for a date range
   * DB-006: Store-scoped aggregate query
   *
   * @param storeId - Store identifier
   * @param startDate - Start date
   * @param endDate - End date
   * @returns Array of grade aggregations
   */
  getAggregateByGrade(storeId: string, startDate: string, endDate: string): FuelGradeAggregation[] {
    const stmt = this.db.prepare(`
      SELECT
        grade_id,
        grade_name,
        SUM(volume_sold) as total_volume,
        SUM(amount_sold) as total_amount,
        SUM(transaction_count) as transaction_count,
        CASE WHEN SUM(volume_sold) > 0
          THEN SUM(amount_sold) / SUM(volume_sold)
          ELSE 0
        END as average_price
      FROM fuel_grade_movements
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      GROUP BY grade_id, grade_name
      ORDER BY total_amount DESC
    `);

    const results = stmt.all(storeId, startDate, endDate) as Array<{
      grade_id: string;
      grade_name: string | null;
      total_volume: number;
      total_amount: number;
      transaction_count: number;
      average_price: number;
    }>;

    return results.map((r) => ({
      gradeId: r.grade_id,
      gradeName: r.grade_name,
      totalVolume: r.total_volume,
      totalAmount: r.total_amount,
      transactionCount: r.transaction_count,
      averagePrice: r.average_price,
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
    totalVolume: number;
    totalAmount: number;
    transactionCount: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT
        business_date,
        SUM(volume_sold) as total_volume,
        SUM(amount_sold) as total_amount,
        SUM(transaction_count) as transaction_count
      FROM fuel_grade_movements
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      GROUP BY business_date
      ORDER BY business_date ASC
    `);

    const results = stmt.all(storeId, startDate, endDate) as Array<{
      business_date: string;
      total_volume: number;
      total_amount: number;
      transaction_count: number;
    }>;

    return results.map((r) => ({
      businessDate: r.business_date,
      totalVolume: r.total_volume,
      totalAmount: r.total_amount,
      transactionCount: r.transaction_count,
    }));
  }

  /**
   * Get aggregation by date (single day)
   * DB-006: Store-scoped aggregate query
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @returns Array of grade aggregations for the day
   */
  getAggregationByDate(
    storeId: string,
    businessDate: string
  ): Array<{
    gradeId: string;
    gradeName: string | null;
    salesVolume: number;
    salesAmount: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT
        grade_id,
        grade_name,
        SUM(volume_sold) as sales_volume,
        SUM(amount_sold) as sales_amount
      FROM fuel_grade_movements
      WHERE store_id = ? AND business_date = ?
      GROUP BY grade_id, grade_name
    `);

    const results = stmt.all(storeId, businessDate) as Array<{
      grade_id: string;
      grade_name: string | null;
      sales_volume: number;
      sales_amount: number;
    }>;

    return results.map((r) => ({
      gradeId: r.grade_id,
      gradeName: r.grade_name,
      salesVolume: r.sales_volume,
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
      DELETE FROM fuel_grade_movements WHERE file_id = ?
    `);
    const result = stmt.run(fileId);

    log.debug('Fuel grade movements deleted by file', {
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
 * Singleton instance for fuel grade movement operations
 */
export const fuelGradeMovementsDAL = new FuelGradeMovementsDAL();
