/**
 * Fuel Product Movements Data Access Layer
 *
 * CRUD operations for non-resettable pump meter readings.
 * Parsed from NAXML FPM documents. Used for fuel reconciliation.
 *
 * @module main/dal/fuel-product-movements
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Fuel product movement entity
 */
export interface FuelProductMovement extends StoreEntity {
  id: string;
  store_id: string;
  business_date: string;
  shift_id: string | null;
  product_id: string | null;
  product_name: string | null;
  tank_id: string | null;
  pump_id: string | null;
  volume_sold: number;
  amount_sold: number;
  opening_meter: number | null;
  closing_meter: number | null;
  volume_unit: string;
  file_id: string | null;
  created_at: string;
}

/**
 * Fuel product movement creation data
 */
export interface CreateFuelProductMovementData {
  store_id: string;
  business_date: string;
  shift_id?: string;
  product_id?: string;
  product_name?: string;
  tank_id?: string;
  pump_id?: string;
  volume_sold?: number;
  amount_sold?: number;
  opening_meter?: number;
  closing_meter?: number;
  volume_unit?: string;
  file_id?: string;
}

/**
 * NAXML FPM Detail structure for createFromNAXML
 */
export interface NAXMLFPMInput {
  fuelProductId: string;
  fpmNonResettableTotals: Array<{
    fuelPositionId: string;
    fuelProductNonResettableVolumeNumber: number;
    fuelProductNonResettableAmountNumber: number;
  }>;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('fuel-product-movements-dal');

// ============================================================================
// Fuel Product Movements DAL
// ============================================================================

/**
 * Data Access Layer for fuel product movements
 *
 * Handles FPM (Fuel Product Movement) data from NAXML files
 */
export class FuelProductMovementsDAL extends StoreBasedDAL<FuelProductMovement> {
  protected readonly tableName = 'fuel_product_movements';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'business_date',
    'product_id',
    'pump_id',
    'volume_sold',
    'amount_sold',
  ]);

  /**
   * Create a fuel product movement record
   * SEC-006: Parameterized INSERT
   *
   * @param data - Movement creation data
   * @returns Created movement record
   */
  create(data: CreateFuelProductMovementData): FuelProductMovement {
    const id = this.generateId();
    const now = this.now();

    const stmt = this.db.prepare(`
      INSERT INTO fuel_product_movements (
        id, store_id, business_date, shift_id, product_id, product_name,
        tank_id, pump_id, volume_sold, amount_sold, opening_meter,
        closing_meter, volume_unit, file_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.store_id,
      data.business_date,
      data.shift_id || null,
      data.product_id || null,
      data.product_name || null,
      data.tank_id || null,
      data.pump_id || null,
      data.volume_sold || 0,
      data.amount_sold || 0,
      data.opening_meter ?? null,
      data.closing_meter ?? null,
      data.volume_unit || 'GALLONS',
      data.file_id || null,
      now
    );

    log.debug('Fuel product movement created', {
      id,
      storeId: data.store_id,
      businessDate: data.business_date,
      productId: data.product_id,
      pumpId: data.pump_id,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created fuel product movement: ${id}`);
    }
    return created;
  }

  /**
   * Create fuel product movements from NAXML parsed data
   * SEC-006: Uses parameterized create method
   *
   * Creates one record per product/position combination
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date from movement header
   * @param fpmDetail - Parsed FPM detail from NAXML
   * @param fileId - Optional processed file ID for tracking
   * @returns Array of created record IDs
   */
  createFromNAXML(
    storeId: string,
    businessDate: string,
    fpmDetail: NAXMLFPMInput,
    fileId?: string
  ): string[] {
    const createdIds: string[] = [];

    for (const totals of fpmDetail.fpmNonResettableTotals) {
      const record = this.create({
        store_id: storeId,
        business_date: businessDate,
        product_id: fpmDetail.fuelProductId,
        pump_id: totals.fuelPositionId,
        closing_meter: totals.fuelProductNonResettableVolumeNumber,
        amount_sold: totals.fuelProductNonResettableAmountNumber,
        file_id: fileId,
      });
      createdIds.push(record.id);
    }

    return createdIds;
  }

  /**
   * Find movements by date
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @returns Array of movements for the date
   */
  findByDate(storeId: string, businessDate: string): FuelProductMovement[] {
    const stmt = this.db.prepare(`
      SELECT * FROM fuel_product_movements
      WHERE store_id = ? AND business_date = ?
      ORDER BY product_id ASC, pump_id ASC
    `);
    return stmt.all(storeId, businessDate) as FuelProductMovement[];
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
  findByDateRange(storeId: string, startDate: string, endDate: string): FuelProductMovement[] {
    const stmt = this.db.prepare(`
      SELECT * FROM fuel_product_movements
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      ORDER BY business_date ASC, product_id ASC, pump_id ASC
    `);
    return stmt.all(storeId, startDate, endDate) as FuelProductMovement[];
  }

  /**
   * Find movements by pump
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param pumpId - Pump/position ID
   * @param limit - Maximum records to return
   * @returns Array of movements for the pump
   */
  findByPump(storeId: string, pumpId: string, limit: number = 100): FuelProductMovement[] {
    const stmt = this.db.prepare(`
      SELECT * FROM fuel_product_movements
      WHERE store_id = ? AND pump_id = ?
      ORDER BY business_date DESC
      LIMIT ?
    `);
    return stmt.all(storeId, pumpId, limit) as FuelProductMovement[];
  }

  /**
   * Get latest meter readings by pump
   * Useful for variance detection
   *
   * @param storeId - Store identifier
   * @returns Latest meter reading per pump
   */
  getLatestMeterReadings(storeId: string): Array<{
    pumpId: string;
    productId: string;
    closingMeter: number;
    businessDate: string;
  }> {
    const stmt = this.db.prepare(`
      SELECT pump_id, product_id, closing_meter, business_date
      FROM fuel_product_movements
      WHERE store_id = ? AND closing_meter IS NOT NULL
        AND (pump_id, business_date) IN (
          SELECT pump_id, MAX(business_date)
          FROM fuel_product_movements
          WHERE store_id = ?
          GROUP BY pump_id
        )
      ORDER BY pump_id ASC
    `);

    const results = stmt.all(storeId, storeId) as Array<{
      pump_id: string;
      product_id: string;
      closing_meter: number;
      business_date: string;
    }>;

    return results.map((r) => ({
      pumpId: r.pump_id,
      productId: r.product_id,
      closingMeter: r.closing_meter,
      businessDate: r.business_date,
    }));
  }

  /**
   * Calculate volume variance between consecutive readings
   *
   * @param storeId - Store identifier
   * @param pumpId - Pump ID
   * @param startDate - Start date
   * @param endDate - End date
   * @returns Variance data
   */
  calculateVariance(
    storeId: string,
    pumpId: string,
    startDate: string,
    endDate: string
  ): {
    openingMeter: number | null;
    closingMeter: number | null;
    calculatedVolume: number | null;
    reportedVolume: number;
    variance: number | null;
  } {
    const readings = this.db
      .prepare(
        `
      SELECT closing_meter, volume_sold, business_date
      FROM fuel_product_movements
      WHERE store_id = ? AND pump_id = ? AND business_date >= ? AND business_date <= ?
      ORDER BY business_date ASC
    `
      )
      .all(storeId, pumpId, startDate, endDate) as Array<{
      closing_meter: number | null;
      volume_sold: number;
      business_date: string;
    }>;

    if (readings.length === 0) {
      return {
        openingMeter: null,
        closingMeter: null,
        calculatedVolume: null,
        reportedVolume: 0,
        variance: null,
      };
    }

    const firstReading = readings[0];
    const lastReading = readings[readings.length - 1];
    const totalReportedVolume = readings.reduce((sum, r) => sum + r.volume_sold, 0);

    let calculatedVolume: number | null = null;
    if (firstReading.closing_meter !== null && lastReading.closing_meter !== null) {
      calculatedVolume = lastReading.closing_meter - firstReading.closing_meter;
    }

    return {
      openingMeter: firstReading.closing_meter,
      closingMeter: lastReading.closing_meter,
      calculatedVolume,
      reportedVolume: totalReportedVolume,
      variance: calculatedVolume !== null ? calculatedVolume - totalReportedVolume : null,
    };
  }

  /**
   * Delete movements for a processed file (for reprocessing)
   *
   * @param fileId - Processed file ID
   * @returns Number of records deleted
   */
  deleteByFileId(fileId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM fuel_product_movements WHERE file_id = ?
    `);
    const result = stmt.run(fileId);

    log.debug('Fuel product movements deleted by file', {
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
 * Singleton instance for fuel product movement operations
 */
export const fuelProductMovementsDAL = new FuelProductMovementsDAL();
