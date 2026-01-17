/**
 * Tank Readings Data Access Layer
 *
 * ATG (Automatic Tank Gauge) tank inventory readings.
 * Replaces tender_product_movements table (which was misnamed).
 *
 * TPM = Tank Product Movement (ATG readings), NOT Tender!
 *
 * @module main/dal/tank-readings
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
 * Tank reading entity
 */
export interface TankReading extends StoreEntity {
  tank_reading_id: string;
  store_id: string;

  // Report context
  business_date: string;
  shift_id: string | null;
  day_summary_id: string | null;

  // Tank identification
  tank_id: number;
  fuel_grade_id: string | null;

  // Reading timestamp
  reading_date: string | null;
  reading_time: string | null;

  // Tank measurements
  fuel_product_volume: number | null;
  water_volume: number | null;
  water_depth: number | null;
  fuel_temperature: number | null;
  ullage: number | null;
  product_height: number | null;

  // Source tracking
  source_file_hash: string | null;

  // Audit
  created_at: string;
}

/**
 * Tank reading creation data
 */
export interface CreateTankReadingData {
  store_id: string;
  business_date: string;
  shift_id?: string;
  day_summary_id?: string;
  tank_id: number;
  fuel_grade_id?: string;
  reading_date?: string;
  reading_time?: string;
  fuel_product_volume?: number;
  water_volume?: number;
  water_depth?: number;
  fuel_temperature?: number;
  ullage?: number;
  product_height?: number;
  source_file_hash?: string;
}

/**
 * NAXML TPM input for creating from parsed data
 */
export interface NAXMLTankReadingInput {
  tankId: number;
  fuelProductId?: string;
  tankVolume?: number;
  waterVolume?: number;
  waterDepth?: number;
  fuelTemperature?: number;
  ullage?: number;
  productHeight?: number;
  readingDate?: string;
  readingTime?: string;
}

/**
 * Tank inventory summary
 */
export interface TankInventorySummary {
  tankId: number;
  fuelGradeId: string | null;
  currentVolume: number | null;
  waterVolume: number | null;
  ullage: number | null;
  lastReadingDate: string;
  lastReadingTime: string | null;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('tank-readings-dal');

// ============================================================================
// Tank Readings DAL
// ============================================================================

/**
 * Data Access Layer for tank readings
 *
 * Handles TPM (Tank Product Movement) ATG data.
 * SEC-006: All SQL uses prepared statements
 * DB-006: All queries are store-scoped
 */
export class TankReadingsDAL extends StoreBasedDAL<TankReading> {
  protected readonly tableName = 'tank_readings';
  protected readonly primaryKey = 'tank_reading_id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'business_date',
    'tank_id',
    'fuel_product_volume',
  ]);

  /**
   * Create a tank reading record
   * SEC-006: Parameterized INSERT
   *
   * @param data - Reading creation data
   * @returns Created reading record
   */
  create(data: CreateTankReadingData): TankReading {
    const id = this.generateId();
    const now = this.now();

    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      INSERT INTO tank_readings (
        tank_reading_id, store_id, business_date, shift_id, day_summary_id,
        tank_id, fuel_grade_id, reading_date, reading_time,
        fuel_product_volume, water_volume, water_depth,
        fuel_temperature, ullage, product_height,
        source_file_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.store_id,
      data.business_date,
      data.shift_id || null,
      data.day_summary_id || null,
      data.tank_id,
      data.fuel_grade_id || null,
      data.reading_date || null,
      data.reading_time || null,
      data.fuel_product_volume ?? null,
      data.water_volume ?? null,
      data.water_depth ?? null,
      data.fuel_temperature ?? null,
      data.ullage ?? null,
      data.product_height ?? null,
      data.source_file_hash || null,
      now
    );

    log.debug('Tank reading created', {
      id,
      storeId: data.store_id,
      businessDate: data.business_date,
      tankId: data.tank_id,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created tank reading: ${id}`);
    }
    return created;
  }

  /**
   * Create tank reading from NAXML TPM parsed data
   * SEC-006: Uses parameterized create method
   *
   * @param storeId - Store identifier (from auth context)
   * @param businessDate - Business date
   * @param input - Parsed NAXML TPM data
   * @param sourceFileHash - Optional file hash for tracking
   * @returns Created record ID
   */
  createFromNAXML(
    storeId: string,
    businessDate: string,
    input: NAXMLTankReadingInput,
    sourceFileHash?: string
  ): string {
    const record = this.create({
      store_id: storeId,
      business_date: businessDate,
      tank_id: input.tankId,
      fuel_grade_id: input.fuelProductId,
      fuel_product_volume: input.tankVolume,
      water_volume: input.waterVolume,
      water_depth: input.waterDepth,
      fuel_temperature: input.fuelTemperature,
      ullage: input.ullage,
      product_height: input.productHeight,
      reading_date: input.readingDate,
      reading_time: input.readingTime,
      source_file_hash: sourceFileHash,
    });

    return record.tank_reading_id;
  }

  /**
   * Find readings by date
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier (from auth context)
   * @param businessDate - Business date
   * @returns Array of readings
   */
  findByDate(storeId: string, businessDate: string): TankReading[] {
    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      SELECT * FROM tank_readings
      WHERE store_id = ? AND business_date = ?
      ORDER BY tank_id ASC, reading_time ASC
    `);
    return stmt.all(storeId, businessDate) as TankReading[];
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
  ): TankReading[] {
    // Enforce max limit
    const boundedLimit = Math.min(limit, 1000);

    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      SELECT * FROM tank_readings
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      ORDER BY business_date ASC, tank_id ASC, reading_time ASC
      LIMIT ?
    `);
    return stmt.all(storeId, startDate, endDate, boundedLimit) as TankReading[];
  }

  /**
   * Find readings by tank
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier (from auth context)
   * @param tankId - Tank identifier
   * @param limit - Maximum records
   * @returns Array of readings
   */
  findByTank(storeId: string, tankId: number, limit: number = 100): TankReading[] {
    // Enforce max limit
    const boundedLimit = Math.min(limit, 1000);

    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      SELECT * FROM tank_readings
      WHERE store_id = ? AND tank_id = ?
      ORDER BY business_date DESC, reading_time DESC
      LIMIT ?
    `);
    return stmt.all(storeId, tankId, boundedLimit) as TankReading[];
  }

  /**
   * Get latest reading for each tank
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier (from auth context)
   * @returns Latest reading per tank
   */
  getLatestReadings(storeId: string): TankInventorySummary[] {
    // SEC-006: Parameterized query with subquery
    const stmt = this.db.prepare(`
      SELECT
        t.tank_id,
        t.fuel_grade_id,
        t.fuel_product_volume as current_volume,
        t.water_volume,
        t.ullage,
        t.business_date as last_reading_date,
        t.reading_time as last_reading_time
      FROM tank_readings t
      INNER JOIN (
        SELECT tank_id, MAX(business_date || COALESCE(reading_time, '')) as max_dt
        FROM tank_readings
        WHERE store_id = ?
        GROUP BY tank_id
      ) latest ON t.tank_id = latest.tank_id
        AND (t.business_date || COALESCE(t.reading_time, '')) = latest.max_dt
      WHERE t.store_id = ?
      ORDER BY t.tank_id ASC
    `);

    const results = stmt.all(storeId, storeId) as Array<{
      tank_id: number;
      fuel_grade_id: string | null;
      current_volume: number | null;
      water_volume: number | null;
      ullage: number | null;
      last_reading_date: string;
      last_reading_time: string | null;
    }>;

    return results.map((r) => ({
      tankId: r.tank_id,
      fuelGradeId: r.fuel_grade_id,
      currentVolume: r.current_volume,
      waterVolume: r.water_volume,
      ullage: r.ullage,
      lastReadingDate: r.last_reading_date,
      lastReadingTime: r.last_reading_time,
    }));
  }

  /**
   * Get inventory levels for a specific date
   * DB-006: Store-scoped aggregate query
   *
   * @param storeId - Store identifier (from auth context)
   * @param businessDate - Business date
   * @returns Tank inventory for the date
   */
  getInventoryByDate(
    storeId: string,
    businessDate: string
  ): Array<{
    tankId: number;
    fuelGradeId: string | null;
    latestVolume: number | null;
    waterVolume: number | null;
    ullage: number | null;
    readingCount: number;
  }> {
    // SEC-006: Parameterized aggregate query
    const stmt = this.db.prepare(`
      SELECT
        tank_id,
        fuel_grade_id,
        (
          SELECT fuel_product_volume
          FROM tank_readings t2
          WHERE t2.store_id = ? AND t2.business_date = ? AND t2.tank_id = t1.tank_id
          ORDER BY reading_time DESC
          LIMIT 1
        ) as latest_volume,
        (
          SELECT water_volume
          FROM tank_readings t2
          WHERE t2.store_id = ? AND t2.business_date = ? AND t2.tank_id = t1.tank_id
          ORDER BY reading_time DESC
          LIMIT 1
        ) as water_volume,
        (
          SELECT ullage
          FROM tank_readings t2
          WHERE t2.store_id = ? AND t2.business_date = ? AND t2.tank_id = t1.tank_id
          ORDER BY reading_time DESC
          LIMIT 1
        ) as ullage,
        COUNT(*) as reading_count
      FROM tank_readings t1
      WHERE store_id = ? AND business_date = ?
      GROUP BY tank_id, fuel_grade_id
      ORDER BY tank_id ASC
    `);

    const results = stmt.all(
      storeId,
      businessDate,
      storeId,
      businessDate,
      storeId,
      businessDate,
      storeId,
      businessDate
    ) as Array<{
      tank_id: number;
      fuel_grade_id: string | null;
      latest_volume: number | null;
      water_volume: number | null;
      ullage: number | null;
      reading_count: number;
    }>;

    return results.map((r) => ({
      tankId: r.tank_id,
      fuelGradeId: r.fuel_grade_id,
      latestVolume: r.latest_volume,
      waterVolume: r.water_volume,
      ullage: r.ullage,
      readingCount: r.reading_count,
    }));
  }

  /**
   * Get total inventory across all tanks
   * DB-006: Store-scoped aggregate query
   *
   * @param storeId - Store identifier (from auth context)
   * @returns Total inventory summary
   */
  getTotalInventory(storeId: string): {
    totalFuelVolume: number;
    totalWaterVolume: number;
    totalUllage: number;
    tankCount: number;
    lastReadingDate: string | null;
  } {
    const latestReadings = this.getLatestReadings(storeId);

    const totalFuelVolume = latestReadings.reduce((sum, r) => sum + (r.currentVolume || 0), 0);
    const totalWaterVolume = latestReadings.reduce((sum, r) => sum + (r.waterVolume || 0), 0);
    const totalUllage = latestReadings.reduce((sum, r) => sum + (r.ullage || 0), 0);

    const lastReadingDate =
      latestReadings.length > 0
        ? latestReadings.reduce(
            (latest, r) => (r.lastReadingDate > latest ? r.lastReadingDate : latest),
            latestReadings[0].lastReadingDate
          )
        : null;

    return {
      totalFuelVolume,
      totalWaterVolume,
      totalUllage,
      tankCount: latestReadings.length,
      lastReadingDate,
    };
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
      DELETE FROM tank_readings WHERE source_file_hash = ?
    `);
    const result = stmt.run(sourceFileHash);

    log.debug('Tank readings deleted by source file', {
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
 * Singleton instance for tank reading operations
 */
export const tankReadingsDAL = new TankReadingsDAL();
