/**
 * MSM Outside Dispenser Records Data Access Layer
 *
 * Stores outside dispenser records from Period 98 MSM files.
 * These records appear after the closing </MiscellaneousSummaryMovement> tag
 * and contain shift-level outside fuel totals (but not by grade).
 *
 * @module main/dal/msm-outside-dispenser-records
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
 * Valid tender types for outside dispenser records
 */
export type OutsideTenderType = 'outsideCredit' | 'outsideDebit';

/**
 * MSM outside dispenser record entity
 */
export interface MSMOutsideDispenserRecord extends StoreEntity {
  outside_record_id: string;
  store_id: string;
  business_date: string;
  shift_id: string | null;
  register_id: string;
  till_id: string | null;
  cashier_id: string | null;
  tender_type: OutsideTenderType;
  amount: number;
  transaction_count: number;
  source_file_hash: string | null;
  created_at: string;
}

/**
 * MSM outside dispenser record creation data
 */
export interface CreateOutsideDispenserData {
  store_id: string;
  business_date: string;
  shift_id?: string;
  register_id: string;
  till_id?: string;
  cashier_id?: string;
  tender_type: OutsideTenderType;
  amount: number;
  transaction_count?: number;
  source_file_hash?: string;
}

/**
 * Aggregated outside fuel totals
 */
export interface OutsideFuelTotals {
  creditAmount: number;
  creditCount: number;
  debitAmount: number;
  debitCount: number;
  totalAmount: number;
  totalCount: number;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('msm-outside-dispenser-dal');

// ============================================================================
// MSM Outside Dispenser Records DAL
// ============================================================================

/**
 * Data Access Layer for MSM outside dispenser records
 *
 * Handles outside fuel dispenser data from Period 98 MSM files.
 * SEC-006: All SQL uses prepared statements
 * DB-006: All queries are store-scoped
 */
export class MSMOutsideDispenserRecordsDAL extends StoreBasedDAL<MSMOutsideDispenserRecord> {
  protected readonly tableName = 'msm_outside_dispenser_records';
  protected readonly primaryKey = 'outside_record_id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'business_date',
    'amount',
    'transaction_count',
  ]);

  /**
   * Allowed tender types for validation
   */
  private readonly allowedTenderTypes = new Set<OutsideTenderType>([
    'outsideCredit',
    'outsideDebit',
  ]);

  /**
   * Create an outside dispenser record
   * SEC-006: Parameterized INSERT
   *
   * @param data - Record creation data
   * @returns Created record
   */
  create(data: CreateOutsideDispenserData): MSMOutsideDispenserRecord {
    // Validate tender type against allowlist
    if (!this.allowedTenderTypes.has(data.tender_type)) {
      throw new Error(`Invalid tender type: ${data.tender_type}`);
    }

    const id = this.generateId();
    const now = this.now();

    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      INSERT INTO msm_outside_dispenser_records (
        outside_record_id, store_id, business_date, shift_id,
        register_id, till_id, cashier_id, tender_type,
        amount, transaction_count, source_file_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.store_id,
      data.business_date,
      data.shift_id || null,
      data.register_id,
      data.till_id || null,
      data.cashier_id || null,
      data.tender_type,
      data.amount,
      data.transaction_count || 0,
      data.source_file_hash || null,
      now
    );

    log.debug('MSM outside dispenser record created', {
      id,
      storeId: data.store_id,
      businessDate: data.business_date,
      registerId: data.register_id,
      tenderType: data.tender_type,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created MSM outside dispenser record: ${id}`);
    }
    return created;
  }

  /**
   * Create or skip if duplicate exists (upsert - skip on conflict)
   * SEC-006: Parameterized queries
   *
   * @param data - Record data
   * @returns Existing or created record
   */
  upsert(data: CreateOutsideDispenserData): MSMOutsideDispenserRecord {
    // Check for existing by unique constraint
    const existing = this.findByUniqueKey(
      data.store_id,
      data.business_date,
      data.register_id,
      data.till_id || null,
      data.tender_type
    );

    if (existing) {
      log.debug('MSM outside dispenser record already exists, skipping duplicate', {
        storeId: data.store_id,
        businessDate: data.business_date,
        registerId: data.register_id,
        tenderType: data.tender_type,
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
   * @param registerId - Register ID
   * @param tillId - Till ID (nullable)
   * @param tenderType - Tender type
   * @returns Record or undefined
   */
  findByUniqueKey(
    storeId: string,
    businessDate: string,
    registerId: string,
    tillId: string | null,
    tenderType: OutsideTenderType
  ): MSMOutsideDispenserRecord | undefined {
    // SEC-006: Parameterized query prevents SQL injection
    if (tillId === null) {
      const stmt = this.db.prepare(`
        SELECT * FROM msm_outside_dispenser_records
        WHERE store_id = ? AND business_date = ? AND register_id = ?
          AND till_id IS NULL AND tender_type = ?
      `);
      return stmt.get(storeId, businessDate, registerId, tenderType) as
        | MSMOutsideDispenserRecord
        | undefined;
    }

    const stmt = this.db.prepare(`
      SELECT * FROM msm_outside_dispenser_records
      WHERE store_id = ? AND business_date = ? AND register_id = ?
        AND till_id = ? AND tender_type = ?
    `);
    return stmt.get(storeId, businessDate, registerId, tillId, tenderType) as
      | MSMOutsideDispenserRecord
      | undefined;
  }

  /**
   * Find all outside records for a business date
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   *
   * @param storeId - Store ID (from auth context)
   * @param businessDate - Business date
   * @returns Array of outside dispenser records
   */
  findByBusinessDate(storeId: string, businessDate: string): MSMOutsideDispenserRecord[] {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      SELECT * FROM msm_outside_dispenser_records
      WHERE store_id = ? AND business_date = ?
      ORDER BY register_id ASC, till_id ASC, tender_type ASC
    `);
    return stmt.all(storeId, businessDate) as MSMOutsideDispenserRecord[];
  }

  /**
   * Find records by register and date
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   *
   * @param storeId - Store ID (from auth context)
   * @param businessDate - Business date
   * @param registerId - Register ID
   * @returns Array of outside dispenser records
   */
  findByRegister(
    storeId: string,
    businessDate: string,
    registerId: string
  ): MSMOutsideDispenserRecord[] {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      SELECT * FROM msm_outside_dispenser_records
      WHERE store_id = ? AND business_date = ? AND register_id = ?
      ORDER BY till_id ASC, tender_type ASC
    `);
    return stmt.all(storeId, businessDate, registerId) as MSMOutsideDispenserRecord[];
  }

  /**
   * Find records by shift
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   *
   * @param storeId - Store ID (from auth context)
   * @param shiftId - Shift ID
   * @returns Array of outside dispenser records
   */
  findByShift(storeId: string, shiftId: string): MSMOutsideDispenserRecord[] {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      SELECT * FROM msm_outside_dispenser_records
      WHERE store_id = ? AND shift_id = ?
      ORDER BY register_id ASC, tender_type ASC
    `);
    return stmt.all(storeId, shiftId) as MSMOutsideDispenserRecord[];
  }

  /**
   * Get aggregated outside fuel totals for a business date
   * SEC-006: Parameterized aggregate query
   * DB-006: Store-scoped
   *
   * @param storeId - Store ID (from auth context)
   * @param businessDate - Business date
   * @returns Aggregated outside fuel totals by tender type
   */
  getDailyTotals(storeId: string, businessDate: string): OutsideFuelTotals {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN tender_type = 'outsideCredit' THEN amount ELSE 0 END), 0) as credit_amount,
        COALESCE(SUM(CASE WHEN tender_type = 'outsideCredit' THEN transaction_count ELSE 0 END), 0) as credit_count,
        COALESCE(SUM(CASE WHEN tender_type = 'outsideDebit' THEN amount ELSE 0 END), 0) as debit_amount,
        COALESCE(SUM(CASE WHEN tender_type = 'outsideDebit' THEN transaction_count ELSE 0 END), 0) as debit_count,
        COALESCE(SUM(amount), 0) as total_amount,
        COALESCE(SUM(transaction_count), 0) as total_count
      FROM msm_outside_dispenser_records
      WHERE store_id = ? AND business_date = ?
    `);

    const result = stmt.get(storeId, businessDate) as {
      credit_amount: number;
      credit_count: number;
      debit_amount: number;
      debit_count: number;
      total_amount: number;
      total_count: number;
    };

    return {
      creditAmount: result.credit_amount,
      creditCount: result.credit_count,
      debitAmount: result.debit_amount,
      debitCount: result.debit_count,
      totalAmount: result.total_amount,
      totalCount: result.total_count,
    };
  }

  /**
   * Get shift-level outside fuel totals
   * SEC-006: Parameterized aggregate query
   * DB-006: Store-scoped
   *
   * @param storeId - Store ID (from auth context)
   * @param shiftId - Shift ID
   * @returns Aggregated outside fuel totals
   */
  getShiftTotals(storeId: string, shiftId: string): OutsideFuelTotals {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN tender_type = 'outsideCredit' THEN amount ELSE 0 END), 0) as credit_amount,
        COALESCE(SUM(CASE WHEN tender_type = 'outsideCredit' THEN transaction_count ELSE 0 END), 0) as credit_count,
        COALESCE(SUM(CASE WHEN tender_type = 'outsideDebit' THEN amount ELSE 0 END), 0) as debit_amount,
        COALESCE(SUM(CASE WHEN tender_type = 'outsideDebit' THEN transaction_count ELSE 0 END), 0) as debit_count,
        COALESCE(SUM(amount), 0) as total_amount,
        COALESCE(SUM(transaction_count), 0) as total_count
      FROM msm_outside_dispenser_records
      WHERE store_id = ? AND shift_id = ?
    `);

    const result = stmt.get(storeId, shiftId) as {
      credit_amount: number;
      credit_count: number;
      debit_amount: number;
      debit_count: number;
      total_amount: number;
      total_count: number;
    };

    return {
      creditAmount: result.credit_amount,
      creditCount: result.credit_count,
      debitAmount: result.debit_amount,
      debitCount: result.debit_count,
      totalAmount: result.total_amount,
      totalCount: result.total_count,
    };
  }

  /**
   * Delete records by source file hash (for reprocessing)
   * SEC-006: Parameterized DELETE
   *
   * @param sourceFileHash - Source file hash
   * @returns Number of records deleted
   */
  deleteBySourceFileHash(sourceFileHash: string): number {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      DELETE FROM msm_outside_dispenser_records WHERE source_file_hash = ?
    `);
    const result = stmt.run(sourceFileHash);

    log.debug('MSM outside dispenser records deleted by source file', {
      sourceFileHash,
      count: result.changes,
    });

    return result.changes;
  }

  /**
   * Delete all records for a store (for data reset)
   * SEC-006: Parameterized DELETE
   * DB-006: Store-scoped
   *
   * @param storeId - Store ID
   * @returns Number of records deleted
   */
  deleteAllForStore(storeId: string): number {
    // SEC-006: Parameterized query prevents SQL injection
    const stmt = this.db.prepare(`
      DELETE FROM msm_outside_dispenser_records WHERE store_id = ?
    `);
    const result = stmt.run(storeId);

    log.info('All MSM outside dispenser records deleted for store', {
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
 * Singleton instance for MSM outside dispenser record operations
 */
export const msmOutsideDispenserRecordsDAL = new MSMOutsideDispenserRecordsDAL();
