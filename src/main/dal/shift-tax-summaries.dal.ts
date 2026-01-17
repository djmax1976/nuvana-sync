/**
 * Shift Tax Summaries Data Access Layer
 *
 * Tax collection by rate per shift. Replaces tax_level_movements table.
 * Child of shift_summaries.
 *
 * @module main/dal/shift-tax-summaries
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
 * Shift tax summary entity
 */
export interface ShiftTaxSummary extends BaseEntity {
  id: string;
  shift_summary_id: string;

  // Tax identification
  tax_rate_id: string | null;
  tax_code: string;
  tax_display_name: string | null;
  tax_rate_snapshot: number | null;

  // Totals
  taxable_amount: number;
  tax_collected: number;
  exempt_amount: number;

  // Counts
  transaction_count: number;

  // Audit
  created_at: string;
}

/**
 * Shift tax summary creation data
 */
export interface CreateShiftTaxSummaryData {
  shift_summary_id: string;
  tax_rate_id?: string;
  tax_code: string;
  tax_display_name?: string;
  tax_rate_snapshot?: number;
  taxable_amount?: number;
  tax_collected?: number;
  exempt_amount?: number;
  transaction_count?: number;
}

/**
 * NAXML TLM input for creating from parsed data
 */
export interface NAXMLTaxInput {
  taxCode: string;
  taxDisplayName?: string;
  taxRate?: number;
  taxableAmount?: number;
  taxCollected?: number;
  exemptAmount?: number;
  transactionCount?: number;
}

/**
 * Tax aggregation result
 */
export interface TaxAggregation {
  taxCode: string;
  taxDisplayName: string | null;
  taxRate: number | null;
  totalTaxable: number;
  totalCollected: number;
  totalExempt: number;
  effectiveRate: number;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('shift-tax-summaries-dal');

// ============================================================================
// Shift Tax Summaries DAL
// ============================================================================

/**
 * Data Access Layer for shift tax summaries
 *
 * Handles TLM (Tax Level Movement) data per shift.
 * SEC-006: All SQL uses prepared statements
 */
export class ShiftTaxSummariesDAL extends BaseDAL<ShiftTaxSummary> {
  protected readonly tableName = 'shift_tax_summaries';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'tax_code',
    'taxable_amount',
    'tax_collected',
  ]);

  /**
   * Create a shift tax summary record
   * SEC-006: Parameterized INSERT
   *
   * @param data - Summary creation data
   * @returns Created summary record
   */
  create(data: CreateShiftTaxSummaryData): ShiftTaxSummary {
    const id = this.generateId();
    const now = this.now();

    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      INSERT INTO shift_tax_summaries (
        id, shift_summary_id, tax_rate_id, tax_code, tax_display_name,
        tax_rate_snapshot, taxable_amount, tax_collected, exempt_amount,
        transaction_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.shift_summary_id,
      data.tax_rate_id || null,
      data.tax_code,
      data.tax_display_name || null,
      data.tax_rate_snapshot ?? null,
      data.taxable_amount || 0,
      data.tax_collected || 0,
      data.exempt_amount || 0,
      data.transaction_count || 0,
      now
    );

    log.debug('Shift tax summary created', {
      id,
      shiftSummaryId: data.shift_summary_id,
      taxCode: data.tax_code,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created shift tax summary: ${id}`);
    }
    return created;
  }

  /**
   * Create or update shift tax summary (upsert)
   * SEC-006: Parameterized queries
   *
   * @param data - Summary data
   * @returns Created or updated record
   */
  upsert(data: CreateShiftTaxSummaryData): ShiftTaxSummary {
    // Check for existing record by unique constraint
    const existing = this.findByShiftAndTaxCode(data.shift_summary_id, data.tax_code);

    if (existing) {
      // Update existing record - add to totals
      const stmt = this.db.prepare(`
        UPDATE shift_tax_summaries
        SET taxable_amount = taxable_amount + ?,
            tax_collected = tax_collected + ?,
            exempt_amount = exempt_amount + ?,
            transaction_count = transaction_count + ?
        WHERE id = ?
      `);

      stmt.run(
        data.taxable_amount || 0,
        data.tax_collected || 0,
        data.exempt_amount || 0,
        data.transaction_count || 0,
        existing.id
      );

      return this.findById(existing.id)!;
    }

    return this.create(data);
  }

  /**
   * Create from NAXML TLM parsed data
   * SEC-006: Uses parameterized create method
   *
   * @param shiftSummaryId - Parent shift summary ID
   * @param input - Parsed NAXML TLM data
   * @returns Created record ID
   */
  createFromNAXML(shiftSummaryId: string, input: NAXMLTaxInput): string {
    const record = this.upsert({
      shift_summary_id: shiftSummaryId,
      tax_code: input.taxCode,
      tax_display_name: input.taxDisplayName,
      tax_rate_snapshot: input.taxRate,
      taxable_amount: input.taxableAmount,
      tax_collected: input.taxCollected,
      exempt_amount: input.exemptAmount,
      transaction_count: input.transactionCount,
    });

    return record.id;
  }

  /**
   * Find by shift summary and tax code
   * SEC-006: Parameterized query
   *
   * @param shiftSummaryId - Shift summary ID
   * @param taxCode - Tax code
   * @returns Record or undefined
   */
  findByShiftAndTaxCode(shiftSummaryId: string, taxCode: string): ShiftTaxSummary | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM shift_tax_summaries
      WHERE shift_summary_id = ? AND tax_code = ?
    `);
    return stmt.get(shiftSummaryId, taxCode) as ShiftTaxSummary | undefined;
  }

  /**
   * Find all summaries for a shift
   * SEC-006: Parameterized query
   *
   * @param shiftSummaryId - Shift summary ID
   * @returns Array of tax summaries
   */
  findByShiftSummary(shiftSummaryId: string): ShiftTaxSummary[] {
    const stmt = this.db.prepare(`
      SELECT * FROM shift_tax_summaries
      WHERE shift_summary_id = ?
      ORDER BY tax_collected DESC
    `);
    return stmt.all(shiftSummaryId) as ShiftTaxSummary[];
  }

  /**
   * Get aggregated totals by tax code for a shift
   * SEC-006: Parameterized aggregate query
   *
   * @param shiftSummaryId - Shift summary ID
   * @returns Array of tax aggregations
   */
  getAggregateByTaxCode(shiftSummaryId: string): TaxAggregation[] {
    const stmt = this.db.prepare(`
      SELECT
        tax_code,
        tax_display_name,
        AVG(tax_rate_snapshot) as tax_rate,
        SUM(taxable_amount) as total_taxable,
        SUM(tax_collected) as total_collected,
        SUM(exempt_amount) as total_exempt,
        CASE WHEN SUM(taxable_amount) > 0
          THEN (SUM(tax_collected) / SUM(taxable_amount)) * 100
          ELSE 0
        END as effective_rate
      FROM shift_tax_summaries
      WHERE shift_summary_id = ?
      GROUP BY tax_code, tax_display_name
      ORDER BY total_collected DESC
    `);

    const results = stmt.all(shiftSummaryId) as Array<{
      tax_code: string;
      tax_display_name: string | null;
      tax_rate: number | null;
      total_taxable: number;
      total_collected: number;
      total_exempt: number;
      effective_rate: number;
    }>;

    return results.map((r) => ({
      taxCode: r.tax_code,
      taxDisplayName: r.tax_display_name,
      taxRate: r.tax_rate,
      totalTaxable: r.total_taxable,
      totalCollected: r.total_collected,
      totalExempt: r.total_exempt,
      effectiveRate: r.effective_rate,
    }));
  }

  /**
   * Get shift totals
   * SEC-006: Parameterized query
   *
   * @param shiftSummaryId - Shift summary ID
   * @returns Total tax metrics
   */
  getShiftTotals(shiftSummaryId: string): {
    totalTaxable: number;
    totalCollected: number;
    totalExempt: number;
    taxCodeCount: number;
  } {
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(taxable_amount), 0) as total_taxable,
        COALESCE(SUM(tax_collected), 0) as total_collected,
        COALESCE(SUM(exempt_amount), 0) as total_exempt,
        COUNT(DISTINCT tax_code) as tax_code_count
      FROM shift_tax_summaries
      WHERE shift_summary_id = ?
    `);

    const result = stmt.get(shiftSummaryId) as {
      total_taxable: number;
      total_collected: number;
      total_exempt: number;
      tax_code_count: number;
    };

    return {
      totalTaxable: result.total_taxable,
      totalCollected: result.total_collected,
      totalExempt: result.total_exempt,
      taxCodeCount: result.tax_code_count,
    };
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
      DELETE FROM shift_tax_summaries WHERE shift_summary_id = ?
    `);
    const result = stmt.run(shiftSummaryId);
    return result.changes;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for shift tax summary operations
 */
export const shiftTaxSummariesDAL = new ShiftTaxSummariesDAL();
