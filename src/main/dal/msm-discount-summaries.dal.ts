/**
 * MSM Discount Summaries Data Access Layer
 *
 * Stores discount data parsed from MiscellaneousSummaryMovement (MSM) files.
 * MSM files contain detailed discount breakdown not available in other report types.
 *
 * @module main/dal/msm-discount-summaries
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
 * Valid MSM discount types matching the database CHECK constraint
 */
export type MSMDiscountType =
  | 'statistics_discounts'
  | 'discount_amount_fixed'
  | 'discount_amount_percentage'
  | 'discount_promotional'
  | 'discount_fuel'
  | 'discount_store_coupons';

/**
 * MSM discount summary entity
 */
export interface MSMDiscountSummary extends StoreEntity {
  msm_discount_id: string;
  store_id: string;
  business_date: string;
  msm_period: number;
  shift_id: string | null;
  discount_type: MSMDiscountType;
  discount_amount: number;
  discount_count: number;
  source_file_hash: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * MSM discount summary creation data
 */
export interface CreateMSMDiscountData {
  store_id: string;
  business_date: string;
  msm_period: number;
  shift_id?: string;
  discount_type: MSMDiscountType;
  discount_amount: number;
  discount_count?: number;
  source_file_hash?: string;
}

/**
 * Aggregated discount totals
 */
export interface DiscountTotals {
  statisticsDiscounts: number;
  amountFixed: number;
  amountPercentage: number;
  promotional: number;
  fuel: number;
  storeCoupons: number;
  totalAmount: number;
  totalCount: number;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('msm-discount-summaries-dal');

// ============================================================================
// MSM Discount Summaries DAL
// ============================================================================

/**
 * Data Access Layer for MSM discount summaries
 *
 * Handles discount data from MSM files. Store-scoped.
 * SEC-006: All SQL uses prepared statements
 * DB-006: All queries are store-scoped
 */
export class MSMDiscountSummariesDAL extends StoreBasedDAL<MSMDiscountSummary> {
  protected readonly tableName = 'msm_discount_summaries';
  protected readonly primaryKey = 'msm_discount_id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'business_date',
    'discount_amount',
  ]);

  /**
   * Allowed discount types for validation
   */
  private readonly allowedDiscountTypes = new Set<MSMDiscountType>([
    'statistics_discounts',
    'discount_amount_fixed',
    'discount_amount_percentage',
    'discount_promotional',
    'discount_fuel',
    'discount_store_coupons',
  ]);

  /**
   * Create a discount summary record
   * SEC-006: Parameterized INSERT
   *
   * @param data - Discount creation data
   * @returns Created record
   */
  create(data: CreateMSMDiscountData): MSMDiscountSummary {
    // Validate discount type against allowlist
    if (!this.allowedDiscountTypes.has(data.discount_type)) {
      throw new Error(`Invalid discount type: ${data.discount_type}`);
    }

    const id = this.generateId();
    const now = this.now();

    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      INSERT INTO msm_discount_summaries (
        msm_discount_id, store_id, business_date, msm_period, shift_id,
        discount_type, discount_amount, discount_count,
        source_file_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.store_id,
      data.business_date,
      data.msm_period,
      data.shift_id || null,
      data.discount_type,
      data.discount_amount,
      data.discount_count || 0,
      data.source_file_hash || null,
      now,
      now
    );

    log.debug('MSM discount summary created', {
      id,
      storeId: data.store_id,
      businessDate: data.business_date,
      discountType: data.discount_type,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created MSM discount summary: ${id}`);
    }
    return created;
  }

  /**
   * Create or skip if duplicate exists (upsert - skip on conflict)
   * SEC-006: Parameterized queries
   *
   * @param data - Discount data
   * @returns Existing or created record
   */
  upsert(data: CreateMSMDiscountData): MSMDiscountSummary {
    // Check for existing by unique constraint
    const existing = this.findByUniqueKey(
      data.store_id,
      data.business_date,
      data.msm_period,
      data.shift_id || null,
      data.discount_type
    );

    if (existing) {
      log.debug('MSM discount summary already exists, skipping duplicate', {
        storeId: data.store_id,
        businessDate: data.business_date,
        discountType: data.discount_type,
      });
      return existing;
    }

    return this.create(data);
  }

  /**
   * Find by unique constraint fields
   * SEC-006: Parameterized query
   *
   * @param storeId - Store ID
   * @param businessDate - Business date
   * @param msmPeriod - MSM period (1=Daily, 98=Shift)
   * @param shiftId - Shift ID (null for daily)
   * @param discountType - Discount type
   * @returns Record or undefined
   */
  findByUniqueKey(
    storeId: string,
    businessDate: string,
    msmPeriod: number,
    shiftId: string | null,
    discountType: MSMDiscountType
  ): MSMDiscountSummary | undefined {
    // SEC-006: Parameterized query prevents SQL injection
    if (shiftId === null) {
      const stmt = this.db.prepare(`
        SELECT * FROM msm_discount_summaries
        WHERE store_id = ? AND business_date = ? AND msm_period = ?
          AND shift_id IS NULL AND discount_type = ?
      `);
      return stmt.get(storeId, businessDate, msmPeriod, discountType) as
        | MSMDiscountSummary
        | undefined;
    }

    const stmt = this.db.prepare(`
      SELECT * FROM msm_discount_summaries
      WHERE store_id = ? AND business_date = ? AND msm_period = ?
        AND shift_id = ? AND discount_type = ?
    `);
    return stmt.get(storeId, businessDate, msmPeriod, shiftId, discountType) as
      | MSMDiscountSummary
      | undefined;
  }

  /**
   * Find all discounts for a business date
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   *
   * @param storeId - Store ID (from auth context)
   * @param businessDate - Business date
   * @returns Array of discount records
   */
  findByBusinessDate(storeId: string, businessDate: string): MSMDiscountSummary[] {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      SELECT * FROM msm_discount_summaries
      WHERE store_id = ? AND business_date = ?
      ORDER BY msm_period ASC, discount_type ASC
    `);
    return stmt.all(storeId, businessDate) as MSMDiscountSummary[];
  }

  /**
   * Find discounts for a shift
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   *
   * @param storeId - Store ID (from auth context)
   * @param shiftId - Shift ID
   * @returns Array of discount records
   */
  findByShift(storeId: string, shiftId: string): MSMDiscountSummary[] {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      SELECT * FROM msm_discount_summaries
      WHERE store_id = ? AND shift_id = ?
      ORDER BY discount_type ASC
    `);
    return stmt.all(storeId, shiftId) as MSMDiscountSummary[];
  }

  /**
   * Get aggregated discount totals for a business date
   * SEC-006: Parameterized aggregate query
   * DB-006: Store-scoped
   *
   * @param storeId - Store ID (from auth context)
   * @param businessDate - Business date
   * @returns Aggregated discount totals by type
   */
  getDailyTotals(storeId: string, businessDate: string): DiscountTotals {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN discount_type = 'statistics_discounts' THEN discount_amount ELSE 0 END), 0) as statistics_discounts,
        COALESCE(SUM(CASE WHEN discount_type = 'discount_amount_fixed' THEN discount_amount ELSE 0 END), 0) as amount_fixed,
        COALESCE(SUM(CASE WHEN discount_type = 'discount_amount_percentage' THEN discount_amount ELSE 0 END), 0) as amount_percentage,
        COALESCE(SUM(CASE WHEN discount_type = 'discount_promotional' THEN discount_amount ELSE 0 END), 0) as promotional,
        COALESCE(SUM(CASE WHEN discount_type = 'discount_fuel' THEN discount_amount ELSE 0 END), 0) as fuel,
        COALESCE(SUM(CASE WHEN discount_type = 'discount_store_coupons' THEN discount_amount ELSE 0 END), 0) as store_coupons,
        COALESCE(SUM(discount_amount), 0) as total_amount,
        COALESCE(SUM(discount_count), 0) as total_count
      FROM msm_discount_summaries
      WHERE store_id = ? AND business_date = ? AND msm_period = 1
    `);

    const result = stmt.get(storeId, businessDate) as {
      statistics_discounts: number;
      amount_fixed: number;
      amount_percentage: number;
      promotional: number;
      fuel: number;
      store_coupons: number;
      total_amount: number;
      total_count: number;
    };

    return {
      statisticsDiscounts: result.statistics_discounts,
      amountFixed: result.amount_fixed,
      amountPercentage: result.amount_percentage,
      promotional: result.promotional,
      fuel: result.fuel,
      storeCoupons: result.store_coupons,
      totalAmount: result.total_amount,
      totalCount: result.total_count,
    };
  }

  /**
   * Get fuel discount amount for a date
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   *
   * @param storeId - Store ID (from auth context)
   * @param businessDate - Business date
   * @returns Fuel discount amount
   */
  getFuelDiscount(storeId: string, businessDate: string): number {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(discount_amount), 0) as fuel_discount
      FROM msm_discount_summaries
      WHERE store_id = ? AND business_date = ? AND discount_type = 'discount_fuel'
    `);

    const result = stmt.get(storeId, businessDate) as { fuel_discount: number };
    return result.fuel_discount;
  }

  /**
   * Delete discounts by source file hash (for reprocessing)
   * SEC-006: Parameterized DELETE
   *
   * @param sourceFileHash - Source file hash
   * @returns Number of records deleted
   */
  deleteBySourceFileHash(sourceFileHash: string): number {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      DELETE FROM msm_discount_summaries WHERE source_file_hash = ?
    `);
    const result = stmt.run(sourceFileHash);

    log.debug('MSM discount summaries deleted by source file', {
      sourceFileHash,
      count: result.changes,
    });

    return result.changes;
  }

  /**
   * Delete all discounts for a store (for data reset)
   * SEC-006: Parameterized DELETE
   * DB-006: Store-scoped
   *
   * @param storeId - Store ID
   * @returns Number of records deleted
   */
  deleteAllForStore(storeId: string): number {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      DELETE FROM msm_discount_summaries WHERE store_id = ?
    `);
    const result = stmt.run(storeId);

    log.info('All MSM discount summaries deleted for store', {
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
 * Singleton instance for MSM discount summary operations
 */
export const msmDiscountSummariesDAL = new MSMDiscountSummariesDAL();
