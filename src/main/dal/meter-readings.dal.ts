/**
 * Meter Readings Data Access Layer
 *
 * Pump totalizer readings from NAXML FPM documents.
 * Replaces fuel_product_movements table.
 *
 * FPM = Fuel Product Movement (pump meter totalizers - never reset)
 * Used for fuel inventory reconciliation.
 *
 * @module main/dal/meter-readings
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
 * Reading type - when the reading was taken
 */
export type MeterReadingType = 'OPEN' | 'CLOSE' | 'INTERIM';

/**
 * Meter reading entity
 */
export interface MeterReading extends StoreEntity {
  meter_reading_id: string;
  store_id: string;
  fuel_position_id: string | null;
  shift_id: string | null;
  day_summary_id: string | null;

  // Product identification
  fuel_product_id: string;

  // Reading type
  reading_type: MeterReadingType;

  // Timing
  reading_timestamp: string | null;
  business_date: string;

  // Meter values (cumulative totalizers - never reset)
  volume_reading: number;
  amount_reading: number;

  // Legacy fields for migration
  pump_id: string | null;
  product_name: string | null;

  // Source tracking
  source_file_hash: string | null;

  // Audit
  created_at: string;
}

/**
 * Meter reading creation data
 */
export interface CreateMeterReadingData {
  store_id: string;
  fuel_position_id?: string;
  shift_id?: string;
  day_summary_id?: string;
  fuel_product_id: string;
  reading_type: MeterReadingType;
  reading_timestamp?: string;
  business_date: string;
  volume_reading: number;
  amount_reading?: number;
  pump_id?: string;
  product_name?: string;
  source_file_hash?: string;
}

/**
 * NAXML FPM input for creating from parsed data
 */
export interface NAXMLMeterReadingInput {
  fuelProductId: string;
  fuelPositionId: string;
  volumeReading: number;
  amountReading?: number;
}

/**
 * Variance calculation result
 */
export interface MeterVariance {
  positionId: string;
  productId: string;
  openingMeter: number | null;
  closingMeter: number | null;
  calculatedVolume: number | null;
  variance: number | null;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('meter-readings-dal');

// ============================================================================
// Meter Readings DAL
// ============================================================================

/**
 * Data Access Layer for meter readings
 *
 * Handles FPM (Fuel Product Movement) pump totalizer data.
 * SEC-006: All SQL uses prepared statements
 * DB-006: All queries are store-scoped
 */
export class MeterReadingsDAL extends StoreBasedDAL<MeterReading> {
  protected readonly tableName = 'meter_readings';
  protected readonly primaryKey = 'meter_reading_id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'business_date',
    'reading_timestamp',
    'volume_reading',
    'fuel_product_id',
  ]);

  /**
   * Create a meter reading record
   * SEC-006: Parameterized INSERT
   *
   * @param data - Reading creation data
   * @returns Created reading record
   */
  create(data: CreateMeterReadingData): MeterReading {
    const id = this.generateId();
    const now = this.now();

    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      INSERT INTO meter_readings (
        meter_reading_id, store_id, fuel_position_id, shift_id, day_summary_id,
        fuel_product_id, reading_type, reading_timestamp, business_date,
        volume_reading, amount_reading, pump_id, product_name,
        source_file_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.store_id,
      data.fuel_position_id || null,
      data.shift_id || null,
      data.day_summary_id || null,
      data.fuel_product_id,
      data.reading_type,
      data.reading_timestamp || null,
      data.business_date,
      data.volume_reading,
      data.amount_reading || 0,
      data.pump_id || null,
      data.product_name || null,
      data.source_file_hash || null,
      now
    );

    log.debug('Meter reading created', {
      id,
      storeId: data.store_id,
      businessDate: data.business_date,
      fuelProductId: data.fuel_product_id,
      readingType: data.reading_type,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created meter reading: ${id}`);
    }
    return created;
  }

  /**
   * Create meter readings from NAXML FPM parsed data
   * SEC-006: Uses parameterized create method
   *
   * @param storeId - Store identifier (from auth context)
   * @param businessDate - Business date
   * @param readingType - Type of reading (OPEN/CLOSE/INTERIM)
   * @param inputs - Array of parsed FPM data
   * @param sourceFileHash - Optional file hash for tracking
   * @param shiftId - Optional shift ID
   * @returns Array of created record IDs
   */
  createFromNAXML(
    storeId: string,
    businessDate: string,
    readingType: MeterReadingType,
    inputs: NAXMLMeterReadingInput[],
    sourceFileHash?: string,
    shiftId?: string
  ): string[] {
    const createdIds: string[] = [];

    for (const input of inputs) {
      const record = this.create({
        store_id: storeId,
        fuel_product_id: input.fuelProductId,
        reading_type: readingType,
        business_date: businessDate,
        volume_reading: input.volumeReading,
        amount_reading: input.amountReading,
        pump_id: input.fuelPositionId, // Store in legacy field
        shift_id: shiftId,
        source_file_hash: sourceFileHash,
      });
      createdIds.push(record.meter_reading_id);
    }

    return createdIds;
  }

  /**
   * Find readings by date
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier (from auth context)
   * @param businessDate - Business date
   * @returns Array of readings
   */
  findByDate(storeId: string, businessDate: string): MeterReading[] {
    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      SELECT * FROM meter_readings
      WHERE store_id = ? AND business_date = ?
      ORDER BY fuel_product_id ASC, pump_id ASC, reading_type ASC
    `);
    return stmt.all(storeId, businessDate) as MeterReading[];
  }

  /**
   * Find readings by date range
   * DB-006: Store-scoped query with bounded results
   *
   * @param storeId - Store identifier (from auth context)
   * @param startDate - Start date (inclusive)
   * @param endDate - End date (inclusive)
   * @param limit - Maximum records (default 1000)
   * @returns Array of readings
   */
  findByDateRange(
    storeId: string,
    startDate: string,
    endDate: string,
    limit: number = 1000
  ): MeterReading[] {
    // Enforce max limit
    const boundedLimit = Math.min(limit, 1000);

    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      SELECT * FROM meter_readings
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      ORDER BY business_date ASC, fuel_product_id ASC, pump_id ASC
      LIMIT ?
    `);
    return stmt.all(storeId, startDate, endDate, boundedLimit) as MeterReading[];
  }

  /**
   * Find readings by position/pump
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier (from auth context)
   * @param pumpId - Pump/position ID
   * @param limit - Maximum records
   * @returns Array of readings
   */
  findByPump(storeId: string, pumpId: string, limit: number = 100): MeterReading[] {
    // Enforce max limit
    const boundedLimit = Math.min(limit, 1000);

    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      SELECT * FROM meter_readings
      WHERE store_id = ? AND (pump_id = ? OR fuel_position_id = ?)
      ORDER BY business_date DESC, reading_type DESC
      LIMIT ?
    `);
    return stmt.all(storeId, pumpId, pumpId, boundedLimit) as MeterReading[];
  }

  /**
   * Find readings by type
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier (from auth context)
   * @param businessDate - Business date
   * @param readingType - Reading type
   * @returns Array of readings
   */
  findByType(storeId: string, businessDate: string, readingType: MeterReadingType): MeterReading[] {
    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      SELECT * FROM meter_readings
      WHERE store_id = ? AND business_date = ? AND reading_type = ?
      ORDER BY fuel_product_id ASC, pump_id ASC
    `);
    return stmt.all(storeId, businessDate, readingType) as MeterReading[];
  }

  /**
   * Get latest meter readings by pump
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier (from auth context)
   * @returns Latest reading per pump
   */
  getLatestReadings(storeId: string): Array<{
    pumpId: string;
    productId: string;
    volumeReading: number;
    businessDate: string;
    readingType: MeterReadingType;
  }> {
    // SEC-006: Parameterized query with subquery
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(pump_id, fuel_position_id) as pump_id,
        fuel_product_id,
        volume_reading,
        business_date,
        reading_type
      FROM meter_readings m1
      WHERE store_id = ?
        AND (COALESCE(pump_id, fuel_position_id), business_date, created_at) IN (
          SELECT
            COALESCE(pump_id, fuel_position_id),
            MAX(business_date),
            MAX(created_at)
          FROM meter_readings
          WHERE store_id = ?
          GROUP BY COALESCE(pump_id, fuel_position_id)
        )
      ORDER BY pump_id ASC
    `);

    const results = stmt.all(storeId, storeId) as Array<{
      pump_id: string;
      fuel_product_id: string;
      volume_reading: number;
      business_date: string;
      reading_type: MeterReadingType;
    }>;

    return results.map((r) => ({
      pumpId: r.pump_id,
      productId: r.fuel_product_id,
      volumeReading: r.volume_reading,
      businessDate: r.business_date,
      readingType: r.reading_type,
    }));
  }

  /**
   * Calculate volume dispensed between readings for a date range
   * Used for fuel reconciliation
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier (from auth context)
   * @param pumpId - Pump/position ID
   * @param startDate - Start date
   * @param endDate - End date
   * @returns Variance calculation
   */
  calculateVariance(
    storeId: string,
    pumpId: string,
    startDate: string,
    endDate: string
  ): MeterVariance {
    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(pump_id, fuel_position_id) as position_id,
        fuel_product_id,
        volume_reading,
        business_date,
        reading_type
      FROM meter_readings
      WHERE store_id = ?
        AND (pump_id = ? OR fuel_position_id = ?)
        AND business_date >= ? AND business_date <= ?
      ORDER BY business_date ASC, created_at ASC
    `);

    const readings = stmt.all(storeId, pumpId, pumpId, startDate, endDate) as Array<{
      position_id: string;
      fuel_product_id: string;
      volume_reading: number;
      business_date: string;
      reading_type: MeterReadingType;
    }>;

    if (readings.length === 0) {
      return {
        positionId: pumpId,
        productId: '',
        openingMeter: null,
        closingMeter: null,
        calculatedVolume: null,
        variance: null,
      };
    }

    const firstReading = readings[0];
    const lastReading = readings[readings.length - 1];

    const calculatedVolume = lastReading.volume_reading - firstReading.volume_reading;

    return {
      positionId: pumpId,
      productId: firstReading.fuel_product_id,
      openingMeter: firstReading.volume_reading,
      closingMeter: lastReading.volume_reading,
      calculatedVolume,
      variance: null, // Would need sales data to calculate variance
    };
  }

  /**
   * Get daily meter deltas (volume dispensed per day per pump)
   * DB-006: Store-scoped aggregate query
   *
   * @param storeId - Store identifier (from auth context)
   * @param startDate - Start date
   * @param endDate - End date
   * @returns Daily deltas by pump
   */
  getDailyDeltas(
    storeId: string,
    startDate: string,
    endDate: string
  ): Array<{
    businessDate: string;
    pumpId: string;
    productId: string;
    openReading: number | null;
    closeReading: number | null;
    volumeDispensed: number | null;
  }> {
    // SEC-006: Parameterized query with aggregation
    const stmt = this.db.prepare(`
      SELECT
        business_date,
        COALESCE(pump_id, fuel_position_id) as pump_id,
        fuel_product_id,
        MIN(CASE WHEN reading_type = 'OPEN' THEN volume_reading END) as open_reading,
        MAX(CASE WHEN reading_type = 'CLOSE' THEN volume_reading END) as close_reading
      FROM meter_readings
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      GROUP BY business_date, COALESCE(pump_id, fuel_position_id), fuel_product_id
      ORDER BY business_date ASC, pump_id ASC
    `);

    const results = stmt.all(storeId, startDate, endDate) as Array<{
      business_date: string;
      pump_id: string;
      fuel_product_id: string;
      open_reading: number | null;
      close_reading: number | null;
    }>;

    return results.map((r) => ({
      businessDate: r.business_date,
      pumpId: r.pump_id,
      productId: r.fuel_product_id,
      openReading: r.open_reading,
      closeReading: r.close_reading,
      volumeDispensed:
        r.open_reading !== null && r.close_reading !== null
          ? r.close_reading - r.open_reading
          : null,
    }));
  }

  /**
   * Find readings by shift ID
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier (from auth context)
   * @param shiftId - Shift ID
   * @returns Array of readings for the shift
   */
  findByShiftId(storeId: string, shiftId: string): MeterReading[] {
    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      SELECT * FROM meter_readings
      WHERE store_id = ? AND shift_id = ?
      ORDER BY pump_id ASC, fuel_product_id ASC, reading_type ASC
    `);
    return stmt.all(storeId, shiftId) as MeterReading[];
  }

  /**
   * Get fuel sales by pump for a shift
   * Calculates volume dispensed per pump based on OPEN/CLOSE readings
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier (from auth context)
   * @param shiftId - Shift ID
   * @returns Array of pump fuel sales summaries
   */
  getFuelByPumpForShift(
    storeId: string,
    shiftId: string
  ): Array<{
    pumpId: string;
    productId: string;
    productName: string | null;
    openReading: number | null;
    closeReading: number | null;
    volumeDispensed: number;
    amountDispensed: number;
  }> {
    // SEC-006: Parameterized query with aggregation
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(pump_id, fuel_position_id) as pump_id,
        fuel_product_id,
        product_name,
        MIN(CASE WHEN reading_type = 'OPEN' THEN volume_reading END) as open_volume,
        MAX(CASE WHEN reading_type = 'CLOSE' THEN volume_reading END) as close_volume,
        MIN(CASE WHEN reading_type = 'OPEN' THEN amount_reading END) as open_amount,
        MAX(CASE WHEN reading_type = 'CLOSE' THEN amount_reading END) as close_amount
      FROM meter_readings
      WHERE store_id = ? AND shift_id = ?
      GROUP BY COALESCE(pump_id, fuel_position_id), fuel_product_id, product_name
      ORDER BY pump_id ASC, fuel_product_id ASC
    `);

    const results = stmt.all(storeId, shiftId) as Array<{
      pump_id: string;
      fuel_product_id: string;
      product_name: string | null;
      open_volume: number | null;
      close_volume: number | null;
      open_amount: number | null;
      close_amount: number | null;
    }>;

    return results
      .filter((r) => r.pump_id !== null)
      .map((r) => ({
        pumpId: r.pump_id,
        productId: r.fuel_product_id,
        productName: r.product_name,
        openReading: r.open_volume,
        closeReading: r.close_volume,
        volumeDispensed:
          r.open_volume !== null && r.close_volume !== null ? r.close_volume - r.open_volume : 0,
        amountDispensed:
          r.open_amount !== null && r.close_amount !== null ? r.close_amount - r.open_amount : 0,
      }));
  }

  /**
   * Delete readings by source file hash (for reprocessing)
   * SEC-006: Parameterized DELETE
   *
   * @param sourceFileHash - Source file hash
   * @returns Number of records deleted
   */
  deleteBySourceFileHash(sourceFileHash: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM meter_readings WHERE source_file_hash = ?
    `);
    const result = stmt.run(sourceFileHash);

    log.debug('Meter readings deleted by source file', {
      sourceFileHash,
      count: result.changes,
    });

    return result.changes;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for meter reading operations
 */
export const meterReadingsDAL = new MeterReadingsDAL();
