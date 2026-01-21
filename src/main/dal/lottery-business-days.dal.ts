/**
 * Lottery Business Days Data Access Layer
 *
 * Manages lottery business day operations with two-phase day close pattern.
 * Aggregates daily lottery activity and sales.
 *
 * @module main/dal/lottery-business-days
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';
import { lotteryPacksDAL, type LotteryPack } from './lottery-packs.dal';

// ============================================================================
// Types
// ============================================================================

/**
 * Business day status
 * OPEN: Day is active, accepting transactions
 * PENDING_CLOSE: Day close initiated, awaiting commit
 * CLOSED: Day is finalized, no more changes allowed
 */
export type LotteryDayStatus = 'OPEN' | 'PENDING_CLOSE' | 'CLOSED';

/**
 * Lottery business day entity
 */
export interface LotteryBusinessDay extends StoreEntity {
  day_id: string;
  store_id: string;
  business_date: string;
  status: LotteryDayStatus;
  opened_at: string | null;
  closed_at: string | null;
  opened_by: string | null;
  closed_by: string | null;
  total_sales: number;
  total_packs_sold: number;
  total_packs_activated: number;
  cloud_day_id: string | null;
  /** v034 API Alignment: Cloud day summary reference */
  day_summary_id: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Day pack record for tracking daily pack activity
 */
export interface LotteryDayPack extends StoreEntity {
  day_pack_id: string;
  store_id: string;
  day_id: string;
  pack_id: string;
  bin_id: string | null;
  starting_serial: string;
  ending_serial: string | null;
  tickets_sold: number | null;
  sales_amount: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Pack closing data for day close
 */
export interface PackClosingData {
  pack_id: string;
  closing_serial: string;
  is_sold_out?: boolean;
}

/**
 * Day close preview result
 */
export interface PrepareCloseResult {
  day_id: string;
  business_date: string;
  status: 'PENDING_CLOSE';
  pending_close_at: string;
  closings_count: number;
  estimated_lottery_total: number;
  bins_preview: Array<{
    bin_display_order: number;
    pack_number: string;
    game_name: string;
    starting_serial: string;
    closing_serial: string;
    game_price: number;
    tickets_sold: number;
    sales_amount: number;
  }>;
  /** Temporary storage of closings data for commit */
  pending_closings: PackClosingData[];
}

/**
 * Committed day close result
 */
export interface CommitCloseResult {
  day_id: string;
  business_date: string;
  closed_at: string;
  closings_created: number;
  lottery_total: number;
  bins_closed: Array<{
    bin_display_order: number;
    pack_number: string;
    game_name: string;
    starting_serial: string;
    closing_serial: string;
    game_price: number;
    tickets_sold: number;
    sales_amount: number;
  }>;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Pending close expiration time (5 minutes)
 * After this time, pending close is automatically cancelled
 */
const PENDING_CLOSE_EXPIRY_MS = 5 * 60 * 1000;

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('lottery-business-days-dal');

// ============================================================================
// Module State
// ============================================================================

/**
 * Temporary storage for pending closings
 * Key: day_id, Value: closings data
 * This is cleared when commit or cancel is called
 */
const pendingClosingsCache = new Map<
  string,
  {
    closings: PackClosingData[];
    timestamp: number;
  }
>();

// ============================================================================
// Lottery Business Days DAL
// ============================================================================

/**
 * Data Access Layer for lottery business day management
 *
 * SEC-006: All queries use prepared statements
 * DB-006: All queries scoped by store_id
 */
export class LotteryBusinessDaysDAL extends StoreBasedDAL<LotteryBusinessDay> {
  protected readonly tableName = 'lottery_business_days';
  protected readonly primaryKey = 'day_id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'business_date',
    'status',
    'total_sales',
  ]);

  // ==========================================================================
  // Day Management
  // ==========================================================================

  /**
   * Get or create a business day for the given date
   * Creates new day if not exists, returns existing if found
   * SEC-006: Parameterized queries
   *
   * @param storeId - Store identifier
   * @param date - Business date (YYYY-MM-DD)
   * @param userId - User ID for opened_by (optional)
   * @returns Business day entity
   */
  getOrCreateForDate(storeId: string, date: string, userId?: string): LotteryBusinessDay {
    // Try to find existing day
    const existing = this.findByDate(storeId, date);
    if (existing) {
      return existing;
    }

    // Create new day
    const dayId = this.generateId();
    const now = this.now();

    const stmt = this.db.prepare(`
      INSERT INTO lottery_business_days (
        day_id, store_id, business_date, status, opened_at, opened_by,
        total_sales, total_packs_sold, total_packs_activated,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'OPEN', ?, ?, 0, 0, 0, ?, ?)
    `);

    stmt.run(dayId, storeId, date, now, userId || null, now, now);

    log.info('Lottery business day created', {
      dayId,
      storeId,
      date,
    });

    const created = this.findById(dayId);
    if (!created) {
      throw new Error(`Failed to retrieve created day: ${dayId}`);
    }
    return created;
  }

  /**
   * Find business day by date
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param date - Business date (YYYY-MM-DD)
   * @returns Business day or undefined
   */
  findByDate(storeId: string, date: string): LotteryBusinessDay | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_business_days
      WHERE store_id = ? AND business_date = ?
    `);
    return stmt.get(storeId, date) as LotteryBusinessDay | undefined;
  }

  /**
   * Find the most recent open day for a store
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @returns Most recent open day or undefined
   */
  findOpenDay(storeId: string): LotteryBusinessDay | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_business_days
      WHERE store_id = ? AND status = 'OPEN'
      ORDER BY business_date DESC
      LIMIT 1
    `);
    return stmt.get(storeId) as LotteryBusinessDay | undefined;
  }

  /**
   * Find days by status
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param status - Day status
   * @returns Array of business days
   */
  findByStatus(storeId: string, status: LotteryDayStatus): LotteryBusinessDay[] {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_business_days
      WHERE store_id = ? AND status = ?
      ORDER BY business_date DESC
    `);
    return stmt.all(storeId, status) as LotteryBusinessDay[];
  }

  /**
   * Find days within date range
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param startDate - Start date (YYYY-MM-DD)
   * @param endDate - End date (YYYY-MM-DD)
   * @returns Array of business days
   */
  findByDateRange(storeId: string, startDate: string, endDate: string): LotteryBusinessDay[] {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_business_days
      WHERE store_id = ? AND business_date >= ? AND business_date <= ?
      ORDER BY business_date DESC
    `);
    return stmt.all(storeId, startDate, endDate) as LotteryBusinessDay[];
  }

  // ==========================================================================
  // Two-Phase Day Close
  // ==========================================================================

  /**
   * Phase 1: Prepare day close
   * Validates all closings, calculates totals, sets PENDING_CLOSE status
   * Does NOT commit any pack changes yet
   *
   * @param dayId - Day ID to close
   * @param closingsData - Array of pack closings
   * @returns Preview result
   */
  prepareClose(dayId: string, closingsData: PackClosingData[]): PrepareCloseResult {
    const day = this.findById(dayId);

    if (!day) {
      throw new Error(`Business day not found: ${dayId}`);
    }

    if (day.status === 'CLOSED') {
      throw new Error('Day is already closed');
    }

    if (day.status === 'PENDING_CLOSE') {
      // Check if previous pending is expired
      const cached = pendingClosingsCache.get(dayId);
      if (cached && Date.now() - cached.timestamp < PENDING_CLOSE_EXPIRY_MS) {
        throw new Error('Day close already in progress');
      }
      // Clear expired pending
      pendingClosingsCache.delete(dayId);
    }

    const now = this.now();
    let totalSales = 0;
    const binsPreview: PrepareCloseResult['bins_preview'] = [];

    // Validate and calculate each closing
    for (const closing of closingsData) {
      const pack = lotteryPacksDAL.getPackWithDetails(closing.pack_id);

      if (!pack) {
        throw new Error(`Pack not found: ${closing.pack_id}`);
      }

      if (pack.store_id !== day.store_id) {
        throw new Error(`Pack ${closing.pack_id} does not belong to this store`);
      }

      if (pack.status !== 'ACTIVE') {
        throw new Error(`Pack ${pack.pack_number} is not activated`);
      }

      // Calculate sales
      const { ticketsSold, salesAmount } = lotteryPacksDAL.calculateSales(
        closing.pack_id,
        closing.closing_serial
      );

      totalSales += salesAmount;

      binsPreview.push({
        bin_display_order: pack.bin_display_order || 0,
        pack_number: pack.pack_number,
        game_name: pack.game_name || 'Unknown',
        starting_serial: pack.opening_serial || '000',
        closing_serial: closing.closing_serial,
        game_price: pack.game_price || 0,
        tickets_sold: ticketsSold,
        sales_amount: salesAmount,
      });
    }

    // Set status to PENDING_CLOSE
    const stmt = this.db.prepare(`
      UPDATE lottery_business_days SET status = 'PENDING_CLOSE', updated_at = ?
      WHERE day_id = ?
    `);
    stmt.run(now, dayId);

    // Store closings in cache for commit
    pendingClosingsCache.set(dayId, {
      closings: closingsData,
      timestamp: Date.now(),
    });

    log.info('Day close prepared', {
      dayId,
      closingsCount: closingsData.length,
      estimatedTotal: totalSales,
    });

    return {
      day_id: dayId,
      business_date: day.business_date,
      status: 'PENDING_CLOSE',
      pending_close_at: now,
      closings_count: closingsData.length,
      estimated_lottery_total: totalSales,
      bins_preview: binsPreview,
      pending_closings: closingsData,
    };
  }

  /**
   * Phase 2: Commit day close
   * Applies all pack settlements, updates totals, sets CLOSED status
   * Must be called after prepareClose
   *
   * @param dayId - Day ID to commit
   * @param userId - User ID for closed_by
   * @returns Commit result
   */
  commitClose(dayId: string, userId: string): CommitCloseResult {
    const day = this.findById(dayId);

    if (!day) {
      throw new Error(`Business day not found: ${dayId}`);
    }

    if (day.status !== 'PENDING_CLOSE') {
      throw new Error(`Day is not in PENDING_CLOSE status. Current status: ${day.status}`);
    }

    // Get cached closings
    const cached = pendingClosingsCache.get(dayId);
    if (!cached) {
      throw new Error('No pending closings found. Please call prepareClose first.');
    }

    // Check if expired
    if (Date.now() - cached.timestamp > PENDING_CLOSE_EXPIRY_MS) {
      pendingClosingsCache.delete(dayId);
      // Reset status to OPEN
      const resetStmt = this.db.prepare(`
        UPDATE lottery_business_days SET status = 'OPEN', updated_at = ?
        WHERE day_id = ?
      `);
      resetStmt.run(this.now(), dayId);
      throw new Error('Pending close has expired. Please start over.');
    }

    const closingsData = cached.closings;
    const now = this.now();

    // Execute within transaction
    return this.withTransaction(() => {
      let totalSales = 0;
      const binsClosed: CommitCloseResult['bins_closed'] = [];

      // Process each closing
      for (const closing of closingsData) {
        const pack = lotteryPacksDAL.getPackWithDetails(closing.pack_id);

        if (!pack || pack.status !== 'ACTIVE') {
          throw new Error(`Pack ${closing.pack_id} is no longer valid for closing`);
        }

        // Calculate sales
        const { ticketsSold, salesAmount } = lotteryPacksDAL.calculateSales(
          closing.pack_id,
          closing.closing_serial
        );

        // Settle the pack
        // DB-006: Pass store_id for tenant isolation validation
        // v029 API Alignment: Uses tickets_sold_count
        lotteryPacksDAL.settle(closing.pack_id, {
          store_id: day.store_id,
          closing_serial: closing.closing_serial,
          tickets_sold_count: ticketsSold,
          sales_amount: salesAmount,
        });

        // Create day pack record
        // v029 API Alignment: Uses current_bin_id from pack
        this.createDayPack(day.store_id, dayId, closing.pack_id, pack.current_bin_id, {
          starting_serial: pack.opening_serial || '000',
          ending_serial: closing.closing_serial,
          tickets_sold: ticketsSold,
          sales_amount: salesAmount,
        });

        totalSales += salesAmount;

        binsClosed.push({
          bin_display_order: pack.bin_display_order || 0,
          pack_number: pack.pack_number,
          game_name: pack.game_name || 'Unknown',
          starting_serial: pack.opening_serial || '000',
          closing_serial: closing.closing_serial,
          game_price: pack.game_price || 0,
          tickets_sold: ticketsSold,
          sales_amount: salesAmount,
        });
      }

      // Update day status and totals
      const updateStmt = this.db.prepare(`
        UPDATE lottery_business_days SET
          status = 'CLOSED',
          closed_at = ?,
          closed_by = ?,
          total_sales = ?,
          total_packs_sold = ?,
          updated_at = ?
        WHERE day_id = ?
      `);

      updateStmt.run(now, userId, totalSales, closingsData.length, now, dayId);

      // Clear cache
      pendingClosingsCache.delete(dayId);

      log.info('Day close committed', {
        dayId,
        closingsCount: closingsData.length,
        totalSales,
        closedBy: userId,
      });

      return {
        day_id: dayId,
        business_date: day.business_date,
        closed_at: now,
        closings_created: closingsData.length,
        lottery_total: totalSales,
        bins_closed: binsClosed,
      };
    });
  }

  /**
   * Cancel pending day close
   * Reverts status to OPEN and clears cached closings
   *
   * @param dayId - Day ID to cancel
   */
  cancelClose(dayId: string): void {
    const day = this.findById(dayId);

    if (!day) {
      throw new Error(`Business day not found: ${dayId}`);
    }

    if (day.status !== 'PENDING_CLOSE') {
      log.debug('Day is not in PENDING_CLOSE status, nothing to cancel', {
        dayId,
        status: day.status,
      });
      return;
    }

    // Clear cache
    pendingClosingsCache.delete(dayId);

    // Reset status to OPEN
    const stmt = this.db.prepare(`
      UPDATE lottery_business_days SET status = 'OPEN', updated_at = ?
      WHERE day_id = ?
    `);
    stmt.run(this.now(), dayId);

    log.info('Day close cancelled', { dayId });
  }

  // ==========================================================================
  // Day Pack Records
  // ==========================================================================

  /**
   * Create a day pack record
   * SEC-006: Parameterized INSERT
   *
   * @param storeId - Store ID
   * @param dayId - Day ID
   * @param packId - Pack ID
   * @param binId - Bin ID
   * @param data - Pack activity data
   * @returns Created day pack record
   */
  private createDayPack(
    storeId: string,
    dayId: string,
    packId: string,
    binId: string | null,
    data: {
      starting_serial: string;
      ending_serial: string;
      tickets_sold: number;
      sales_amount: number;
    }
  ): LotteryDayPack {
    const dayPackId = this.generateId();
    const now = this.now();

    const stmt = this.db.prepare(`
      INSERT INTO lottery_day_packs (
        day_pack_id, store_id, day_id, pack_id, bin_id,
        starting_serial, ending_serial, tickets_sold, sales_amount,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      dayPackId,
      storeId,
      dayId,
      packId,
      binId,
      data.starting_serial,
      data.ending_serial,
      data.tickets_sold,
      data.sales_amount,
      now,
      now
    );

    const created = this.findDayPackById(dayPackId);
    if (!created) {
      throw new Error(`Failed to create day pack record: ${dayPackId}`);
    }
    return created;
  }

  /**
   * Find day pack by ID
   * SEC-006: Parameterized query
   *
   * @param dayPackId - Day pack ID
   * @returns Day pack record or undefined
   */
  findDayPackById(dayPackId: string): LotteryDayPack | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_day_packs WHERE day_pack_id = ?
    `);
    return stmt.get(dayPackId) as LotteryDayPack | undefined;
  }

  /**
   * Find day packs for a business day
   * SEC-006: Parameterized query
   *
   * @param dayId - Day ID
   * @returns Array of day pack records
   */
  findDayPacksByDay(dayId: string): LotteryDayPack[] {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_day_packs WHERE day_id = ? ORDER BY created_at ASC
    `);
    return stmt.all(dayId) as LotteryDayPack[];
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get sales totals for a date range
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param startDate - Start date (YYYY-MM-DD)
   * @param endDate - End date (YYYY-MM-DD)
   * @returns Object with total sales and counts
   */
  getSalesForDateRange(
    storeId: string,
    startDate: string,
    endDate: string
  ): { totalSales: number; totalPacksSold: number; daysCount: number } {
    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(total_sales), 0) as totalSales,
        COALESCE(SUM(total_packs_sold), 0) as totalPacksSold,
        COUNT(*) as daysCount
      FROM lottery_business_days
      WHERE store_id = ? AND business_date >= ? AND business_date <= ? AND status = 'CLOSED'
    `);

    const result = stmt.get(storeId, startDate, endDate) as {
      totalSales: number;
      totalPacksSold: number;
      daysCount: number;
    };

    return result;
  }

  /**
   * Increment pack activation count for today
   * Called when a pack is activated
   * SEC-006: Parameterized UPDATE
   *
   * @param storeId - Store identifier
   * @param date - Business date (YYYY-MM-DD)
   */
  incrementPacksActivated(storeId: string, date: string): void {
    const day = this.getOrCreateForDate(storeId, date);

    const stmt = this.db.prepare(`
      UPDATE lottery_business_days
      SET total_packs_activated = total_packs_activated + 1, updated_at = ?
      WHERE day_id = ?
    `);

    stmt.run(this.now(), day.day_id);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for lottery business day operations
 */
export const lotteryBusinessDaysDAL = new LotteryBusinessDaysDAL();
