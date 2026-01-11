/**
 * Tax Level Movements Data Access Layer
 *
 * CRUD operations for tax collection by tax level/rate.
 * Parsed from NAXML TLM documents.
 *
 * @module main/dal/tax-level-movements
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Tax level movement entity
 */
export interface TaxLevelMovement extends StoreEntity {
  id: string;
  store_id: string;
  business_date: string;
  shift_id: string | null;
  tax_level: string;
  tax_level_name: string | null;
  tax_rate: number | null;
  taxable_amount: number;
  tax_amount: number;
  exempt_amount: number;
  transaction_count: number;
  file_id: string | null;
  created_at: string;
}

/**
 * Tax level movement creation data
 */
export interface CreateTaxLevelMovementData {
  store_id: string;
  business_date: string;
  shift_id?: string;
  tax_level: string;
  tax_level_name?: string;
  tax_rate?: number;
  taxable_amount?: number;
  tax_amount?: number;
  exempt_amount?: number;
  transaction_count?: number;
  file_id?: string;
}

/**
 * NAXML TLM input structure for createFromNAXML
 */
export interface NAXMLTLMInput {
  taxLevel: string;
  taxLevelName?: string;
  taxRate?: number;
  taxableAmount?: number;
  taxAmount?: number;
  exemptAmount?: number;
  transactionCount?: number;
}

/**
 * Tax level aggregation result
 */
export interface TaxLevelAggregation {
  taxLevel: string;
  taxLevelName: string | null;
  taxRate: number | null;
  totalTaxableAmount: number;
  totalTaxAmount: number;
  totalExemptAmount: number;
  effectiveRate: number;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('tax-level-movements-dal');

// ============================================================================
// Tax Level Movements DAL
// ============================================================================

/**
 * Data Access Layer for tax level movements
 *
 * Handles TLM (Tax Level Movement) data from NAXML files
 */
export class TaxLevelMovementsDAL extends StoreBasedDAL<TaxLevelMovement> {
  protected readonly tableName = 'tax_level_movements';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'business_date',
    'tax_level',
    'taxable_amount',
    'tax_amount',
    'transaction_count',
  ]);

  /**
   * Create a tax level movement record
   * SEC-006: Parameterized INSERT
   *
   * @param data - Movement creation data
   * @returns Created movement record
   */
  create(data: CreateTaxLevelMovementData): TaxLevelMovement {
    const id = this.generateId();
    const now = this.now();

    const stmt = this.db.prepare(`
      INSERT INTO tax_level_movements (
        id, store_id, business_date, shift_id, tax_level, tax_level_name,
        tax_rate, taxable_amount, tax_amount, exempt_amount,
        transaction_count, file_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.store_id,
      data.business_date,
      data.shift_id || null,
      data.tax_level,
      data.tax_level_name || null,
      data.tax_rate ?? null,
      data.taxable_amount || 0,
      data.tax_amount || 0,
      data.exempt_amount || 0,
      data.transaction_count || 0,
      data.file_id || null,
      now
    );

    log.debug('Tax level movement created', {
      id,
      storeId: data.store_id,
      businessDate: data.business_date,
      taxLevel: data.tax_level,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created tax level movement: ${id}`);
    }
    return created;
  }

  /**
   * Create tax level movement from NAXML parsed data
   * SEC-006: Uses parameterized create method
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date from movement header
   * @param tlmInput - Parsed TLM data from NAXML
   * @param fileId - Optional processed file ID for tracking
   * @param shiftId - Optional shift ID if from shift report
   * @returns Created record ID
   */
  createFromNAXML(
    storeId: string,
    businessDate: string,
    tlmInput: NAXMLTLMInput,
    fileId?: string,
    shiftId?: string
  ): string {
    const record = this.create({
      store_id: storeId,
      business_date: businessDate,
      shift_id: shiftId,
      tax_level: tlmInput.taxLevel,
      tax_level_name: tlmInput.taxLevelName,
      tax_rate: tlmInput.taxRate,
      taxable_amount: tlmInput.taxableAmount,
      tax_amount: tlmInput.taxAmount,
      exempt_amount: tlmInput.exemptAmount,
      transaction_count: tlmInput.transactionCount,
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
  findByDate(storeId: string, businessDate: string): TaxLevelMovement[] {
    const stmt = this.db.prepare(`
      SELECT * FROM tax_level_movements
      WHERE store_id = ? AND business_date = ?
      ORDER BY tax_level ASC
    `);
    return stmt.all(storeId, businessDate) as TaxLevelMovement[];
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
  findByDateRange(storeId: string, startDate: string, endDate: string): TaxLevelMovement[] {
    const stmt = this.db.prepare(`
      SELECT * FROM tax_level_movements
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      ORDER BY business_date ASC, tax_level ASC
    `);
    return stmt.all(storeId, startDate, endDate) as TaxLevelMovement[];
  }

  /**
   * Find movements by tax level
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param taxLevel - Tax level identifier
   * @param startDate - Optional start date
   * @param endDate - Optional end date
   * @returns Array of movements
   */
  findByTaxLevel(
    storeId: string,
    taxLevel: string,
    startDate?: string,
    endDate?: string
  ): TaxLevelMovement[] {
    if (startDate && endDate) {
      const stmt = this.db.prepare(`
        SELECT * FROM tax_level_movements
        WHERE store_id = ? AND tax_level = ? AND business_date >= ? AND business_date <= ?
        ORDER BY business_date DESC
      `);
      return stmt.all(storeId, taxLevel, startDate, endDate) as TaxLevelMovement[];
    }

    const stmt = this.db.prepare(`
      SELECT * FROM tax_level_movements
      WHERE store_id = ? AND tax_level = ?
      ORDER BY business_date DESC
      LIMIT 100
    `);
    return stmt.all(storeId, taxLevel) as TaxLevelMovement[];
  }

  /**
   * Find movements by shift
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param shiftId - Shift ID
   * @returns Array of movements for the shift
   */
  findByShift(storeId: string, shiftId: string): TaxLevelMovement[] {
    const stmt = this.db.prepare(`
      SELECT * FROM tax_level_movements
      WHERE store_id = ? AND shift_id = ?
      ORDER BY tax_level ASC
    `);
    return stmt.all(storeId, shiftId) as TaxLevelMovement[];
  }

  /**
   * Get aggregated totals by tax level for a date range
   * DB-006: Store-scoped aggregate query
   *
   * @param storeId - Store identifier
   * @param startDate - Start date
   * @param endDate - End date
   * @returns Array of tax level aggregations
   */
  getAggregateByTaxLevel(
    storeId: string,
    startDate: string,
    endDate: string
  ): TaxLevelAggregation[] {
    const stmt = this.db.prepare(`
      SELECT
        tax_level,
        tax_level_name,
        AVG(tax_rate) as tax_rate,
        SUM(taxable_amount) as total_taxable_amount,
        SUM(tax_amount) as total_tax_amount,
        SUM(exempt_amount) as total_exempt_amount,
        CASE WHEN SUM(taxable_amount) > 0
          THEN (SUM(tax_amount) / SUM(taxable_amount)) * 100
          ELSE 0
        END as effective_rate
      FROM tax_level_movements
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      GROUP BY tax_level, tax_level_name
      ORDER BY total_tax_amount DESC
    `);

    const results = stmt.all(storeId, startDate, endDate) as Array<{
      tax_level: string;
      tax_level_name: string | null;
      tax_rate: number | null;
      total_taxable_amount: number;
      total_tax_amount: number;
      total_exempt_amount: number;
      effective_rate: number;
    }>;

    return results.map((r) => ({
      taxLevel: r.tax_level,
      taxLevelName: r.tax_level_name,
      taxRate: r.tax_rate,
      totalTaxableAmount: r.total_taxable_amount,
      totalTaxAmount: r.total_tax_amount,
      totalExemptAmount: r.total_exempt_amount,
      effectiveRate: r.effective_rate,
    }));
  }

  /**
   * Get daily tax totals for a date range
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
    totalTaxableAmount: number;
    totalTaxAmount: number;
    totalExemptAmount: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT
        business_date,
        SUM(taxable_amount) as total_taxable_amount,
        SUM(tax_amount) as total_tax_amount,
        SUM(exempt_amount) as total_exempt_amount
      FROM tax_level_movements
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      GROUP BY business_date
      ORDER BY business_date ASC
    `);

    const results = stmt.all(storeId, startDate, endDate) as Array<{
      business_date: string;
      total_taxable_amount: number;
      total_tax_amount: number;
      total_exempt_amount: number;
    }>;

    return results.map((r) => ({
      businessDate: r.business_date,
      totalTaxableAmount: r.total_taxable_amount,
      totalTaxAmount: r.total_tax_amount,
      totalExemptAmount: r.total_exempt_amount,
    }));
  }

  /**
   * Get tax summary for a single date
   * Common operation for daily reports
   *
   * @param storeId - Store identifier
   * @param businessDate - Business date
   * @returns Tax summary
   */
  getDaySummary(
    storeId: string,
    businessDate: string
  ): {
    totalTaxableAmount: number;
    totalTaxAmount: number;
    totalExemptAmount: number;
    taxLevelCount: number;
  } {
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(taxable_amount), 0) as total_taxable_amount,
        COALESCE(SUM(tax_amount), 0) as total_tax_amount,
        COALESCE(SUM(exempt_amount), 0) as total_exempt_amount,
        COUNT(DISTINCT tax_level) as tax_level_count
      FROM tax_level_movements
      WHERE store_id = ? AND business_date = ?
    `);

    const result = stmt.get(storeId, businessDate) as {
      total_taxable_amount: number;
      total_tax_amount: number;
      total_exempt_amount: number;
      tax_level_count: number;
    };

    return {
      totalTaxableAmount: result.total_taxable_amount,
      totalTaxAmount: result.total_tax_amount,
      totalExemptAmount: result.total_exempt_amount,
      taxLevelCount: result.tax_level_count,
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
      DELETE FROM tax_level_movements WHERE file_id = ?
    `);
    const result = stmt.run(fileId);

    log.debug('Tax level movements deleted by file', {
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
 * Singleton instance for tax level movement operations
 */
export const taxLevelMovementsDAL = new TaxLevelMovementsDAL();
