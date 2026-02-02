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
import { lotteryGamesDAL } from './lottery-games.dal';
import { syncQueueDAL } from './sync-queue.dal';

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
    // Close-to-close model: Check if there's already an OPEN day for this store
    // Only one day can be OPEN at a time - return it if exists
    const openDay = this.findOpenDay(storeId);
    if (openDay) {
      return openDay;
    }

    // No OPEN day exists - create a new one with the given business_date
    // (Multiple CLOSED days can exist for the same date after v048 migration)
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

    // ==========================================================================
    // SYNC QUEUE: Queue day_open for cloud sync (Offline-first pattern)
    // ==========================================================================
    // SEC-006: Payload uses structured objects, no string interpolation
    // DB-006: Include store_id for tenant isolation
    // SEC-010: opened_by comes from authenticated session context
    // SEC-017: Audit trail for day open operation
    //
    // Priority: 2 (higher than packs=0, processed before day_close=1)
    // This ensures the cloud has the OPEN day before we try to close it.
    // ==========================================================================
    try {
      // SEC-010: opened_by is REQUIRED by cloud API - must have valid user UUID
      if (!created.opened_by) {
        throw new Error('Cannot enqueue day_open sync: opened_by is required (SEC-010)');
      }

      // Build payload with all required fields
      const dayOpenPayload: Record<string, unknown> = {
        day_id: created.day_id,
        store_id: created.store_id,
        business_date: created.business_date,
        opened_at: created.opened_at || now,
        opened_by: created.opened_by, // REQUIRED by cloud API
        // Optional fields not available at creation time
        // notes, local_id, external_day_id can be added via re-queue if needed
      };

      syncQueueDAL.enqueue({
        store_id: created.store_id,
        entity_type: 'day_open',
        entity_id: created.day_id,
        operation: 'CREATE',
        payload: dayOpenPayload,
        priority: 2, // Higher priority - day_open must sync before day_close
        sync_direction: 'PUSH',
      });

      log.info('Day open queued for cloud sync', {
        dayId: created.day_id,
        storeId: created.store_id,
        businessDate: created.business_date,
      });
    } catch (syncError) {
      // Offline-first: Sync queue failure does NOT block local operation
      // The day is created successfully locally; sync can be retried later
      log.error('Failed to queue day open for sync (local creation succeeded)', {
        dayId: created.day_id,
        error: syncError instanceof Error ? syncError.message : 'Unknown error',
      });
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
   * Check if any business day exists for the store (regardless of status)
   *
   * Uses EXISTS pattern for optimal performance - stops at first match.
   * This is used to distinguish between:
   * - First-ever initialization (no days exist)
   * - Subsequent day creation (previous days exist)
   *
   * @security SEC-006: Parameterized query prevents SQL injection
   * @security DB-006: Store-scoped query ensures tenant isolation
   * @performance Uses LIMIT 1 with indexed store_id column for O(1) lookup
   *
   * @param storeId - Store identifier
   * @returns true if any day exists, false if this would be the first day
   */
  hasAnyDay(storeId: string): boolean {
    // EXISTS pattern: SELECT 1 ... LIMIT 1 is the most efficient way to check existence
    // - Stops scanning at first match
    // - Returns minimal data (just the number 1)
    // - Uses index on store_id (primary key prefix)
    const stmt = this.db.prepare(`
      SELECT 1 FROM lottery_business_days
      WHERE store_id = ?
      LIMIT 1
    `);
    const result = stmt.get(storeId);
    return result !== undefined;
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
        // SERIAL CARRYFORWARD: Use previous day's ending as today's starting
        starting_serial: pack.prev_ending_serial || pack.opening_serial || '000',
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
   * Sync Integration (v047):
   * - Queues depleted packs for sync with entity_type 'pack' and depletion_reason 'DAY_CLOSE'
   * - Queues day close operation for sync with entity_type 'day_close'
   * - Sync failures do NOT block local commit (offline-first pattern)
   *
   * @security SEC-006: All sync payloads use structured objects, no string interpolation
   * @security DB-006: All payloads include store_id for tenant isolation
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

    // Collect data for sync queue (populated during transaction)
    const syncPackData: Array<{
      pack_id: string;
      payload: object;
    }> = [];
    // API-001: closings array per API contract (replica_end_points.md lines 2377-2382)
    // Uses ending_serial (not closing_serial) per API specification
    const closings: Array<{
      pack_id: string;
      ending_serial: string;
      entry_method?: 'SCAN' | 'MANUAL';
      bin_id?: string;
    }> = [];

    // Execute within transaction
    const result = this.withTransaction(() => {
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

        // Build closings entry for day close sync per API contract
        // API-001: Uses ending_serial field name (replica_end_points.md line 2379)
        // entry_method and bin_id are optional per API spec
        closings.push({
          pack_id: closing.pack_id,
          ending_serial: closing.closing_serial,
          entry_method: 'MANUAL', // Default - local closing data doesn't track entry method
          ...(pack.current_bin_id && { bin_id: pack.current_bin_id }),
        });

        // Only settle (mark as DEPLETED) if pack is sold out
        // Packs that continue to next day remain ACTIVE - their closing is recorded in lottery_day_packs
        if (closing.is_sold_out) {
          // Settle the pack - marks as DEPLETED
          // DB-006: Pass store_id for tenant isolation validation
          // v029 API Alignment: Uses tickets_sold_count
          // v047: Include depletion_reason for sync
          lotteryPacksDAL.settle(closing.pack_id, {
            store_id: day.store_id,
            closing_serial: closing.closing_serial,
            tickets_sold_count: ticketsSold,
            sales_amount: salesAmount,
            depletion_reason: 'DAY_CLOSE',
          });
          log.info('Pack settled (sold out)', {
            packId: closing.pack_id,
            closingSerial: closing.closing_serial,
            depletionReason: 'DAY_CLOSE',
          });

          // Collect pack sync data for queuing after transaction
          // SEC-006: Structured payload, no string interpolation
          // DB-006: Include store_id for tenant isolation
          const game = lotteryGamesDAL.findById(pack.game_id);
          const gameCode = game?.game_code || pack.game_code || 'UNKNOWN';
          const ticketsPerPack = game?.tickets_per_pack || pack.game_tickets_per_pack || 300;

          // Calculate serial_start and serial_end for API compliance
          const serialStart = '000';
          const serialEnd = String(ticketsPerPack - 1).padStart(3, '0');
          const effectiveStartingSerial = pack.prev_ending_serial || pack.opening_serial || '000';

          syncPackData.push({
            pack_id: closing.pack_id,
            payload: {
              // Pack identification
              pack_id: closing.pack_id,
              store_id: day.store_id,
              game_id: pack.game_id,
              game_code: gameCode,
              pack_number: pack.pack_number,
              status: 'DEPLETED',
              // Bin assignment
              bin_id: pack.current_bin_id,
              // Serial tracking
              opening_serial: pack.opening_serial,
              closing_serial: closing.closing_serial,
              serial_start: serialStart,
              serial_end: serialEnd,
              // Sales data
              tickets_sold: ticketsSold,
              sales_amount: salesAmount,
              // Timestamps
              received_at: pack.received_at,
              received_by: pack.received_by,
              activated_at: pack.activated_at,
              activated_by: pack.activated_by,
              depleted_at: now,
              returned_at: null,
              // Depletion context (v019 + v047 alignment)
              depletion_reason: 'DAY_CLOSE',
              depleted_by: userId,
              depleted_shift_id: null, // Day close is not shift-specific
              // Shift tracking (not applicable for day close)
              shift_id: null,
              returned_shift_id: null,
              returned_by: null,
              return_reason: null,
              return_notes: null,
            },
          });
        } else {
          log.info('Pack remains active (not sold out)', {
            packId: closing.pack_id,
            closingSerial: closing.closing_serial,
          });
        }

        // Create day pack record
        // v029 API Alignment: Uses current_bin_id from pack
        // FK-SAFETY: Only pass bin_id if the bin exists locally (bin_name is set by LEFT JOIN)
        // This handles cases where pack was synced with bin_id but bin hasn't been synced yet
        const validBinId = pack.bin_name ? pack.current_bin_id : null;
        // SERIAL CARRYFORWARD: Use previous day's ending as today's starting
        const effectiveStartingSerial = pack.prev_ending_serial || pack.opening_serial || '000';
        this.createDayPack(day.store_id, dayId, closing.pack_id, validBinId, {
          starting_serial: effectiveStartingSerial,
          ending_serial: closing.closing_serial,
          tickets_sold: ticketsSold,
          sales_amount: salesAmount,
        });

        totalSales += salesAmount;

        binsClosed.push({
          bin_display_order: pack.bin_display_order || 0,
          pack_number: pack.pack_number,
          game_name: pack.game_name || 'Unknown',
          starting_serial: effectiveStartingSerial,
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

    // ==========================================================================
    // SYNC QUEUE OPERATIONS (Offline-first: failures do NOT block local commit)
    // ==========================================================================
    // Queue sync operations AFTER transaction commits successfully
    // SEC-006: All payloads are structured objects
    // DB-006: All payloads include store_id for tenant isolation

    try {
      // Task 2.2: Queue pack depletions for sync
      for (const packSync of syncPackData) {
        try {
          syncQueueDAL.enqueue({
            store_id: day.store_id,
            entity_type: 'pack',
            entity_id: packSync.pack_id,
            operation: 'UPDATE',
            payload: packSync.payload,
            priority: 0, // Normal priority
            sync_direction: 'PUSH',
          });
          log.debug('Pack depletion queued for sync', {
            packId: packSync.pack_id,
            storeId: day.store_id,
          });
        } catch (packSyncError) {
          // Log but don't fail - offline-first pattern
          log.error('Failed to queue pack depletion for sync (continuing)', {
            packId: packSync.pack_id,
            error: packSyncError instanceof Error ? packSyncError.message : 'Unknown error',
          });
        }
      }

      // Task 2.3 & 2.4: Queue day close operation for sync
      // The sync engine will handle the two-phase commit (PREPARE then COMMIT) to cloud
      // API-001: Payload structure per replica_end_points.md lines 2374-2386
      const dayClosePayload = {
        operation_type: 'PREPARE' as const, // Sync engine will orchestrate PREPARE -> COMMIT
        day_id: dayId, // Primary identifier per API contract
        store_id: day.store_id, // Keep for sync queue operations
        closings: closings, // API field name (not expected_inventory)
        initiated_by: userId, // API field name (not prepared_by)
        closed_by: userId, // For subsequent COMMIT phase
      };

      syncQueueDAL.enqueue({
        store_id: day.store_id,
        entity_type: 'day_close',
        entity_id: dayId,
        operation: 'CREATE',
        payload: dayClosePayload,
        priority: 1, // Higher priority - day close should sync after pack depletions
        sync_direction: 'PUSH',
      });
      log.info('Day close operation queued for sync', {
        dayId,
        storeId: day.store_id,
        businessDate: day.business_date,
        packsDepletedCount: syncPackData.length,
        closingsCount: closings.length,
      });
    } catch (syncError) {
      // Log but don't fail - offline-first pattern
      // The local day close has already succeeded
      log.error('Failed to queue day close for sync (local commit succeeded)', {
        dayId,
        error: syncError instanceof Error ? syncError.message : 'Unknown error',
      });
    }

    return result;
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

  /**
   * Re-queue a closed day for sync
   * Used for recovery when sync failed or was deleted from queue
   *
   * @param dayId - Day ID to re-queue
   * @param userId - User ID for audit trail
   * @returns true if queued successfully
   */
  requeueDayCloseForSync(dayId: string, userId: string): boolean {
    const day = this.findById(dayId);

    if (!day) {
      throw new Error(`Business day not found: ${dayId}`);
    }

    if (day.status !== 'CLOSED') {
      throw new Error(`Day must be CLOSED to re-queue for sync. Current status: ${day.status}`);
    }

    // Query day_packs for closings array
    // SEC-006: Parameterized query
    const dayPacksStmt = this.db.prepare(`
      SELECT
        ldp.pack_id,
        ldp.bin_id,
        ldp.ending_serial
      FROM lottery_day_packs ldp
      WHERE ldp.day_id = ?
    `);
    const dayPacks = dayPacksStmt.all(dayId) as Array<{
      pack_id: string;
      bin_id: string | null;
      ending_serial: string;
    }>;

    // API-001: Build closings array per API contract (replica_end_points.md lines 2377-2382)
    // Uses ending_serial field name, bin_id is optional
    const closings = dayPacks.map((dp) => ({
      pack_id: dp.pack_id,
      ending_serial: dp.ending_serial,
      entry_method: 'MANUAL' as const, // Default for re-queue
      ...(dp.bin_id && { bin_id: dp.bin_id }),
    }));

    // API-001: Build day close payload per API contract (replica_end_points.md lines 2374-2386)
    const dayClosePayload = {
      operation_type: 'PREPARE' as const,
      day_id: dayId, // Primary identifier per API contract
      store_id: day.store_id, // Keep for sync queue operations
      closings: closings, // API field name (not expected_inventory)
      initiated_by: userId, // API field name (not prepared_by)
      closed_by: userId, // For subsequent COMMIT phase
    };

    try {
      syncQueueDAL.enqueue({
        store_id: day.store_id,
        entity_type: 'day_close',
        entity_id: dayId,
        operation: 'CREATE',
        payload: dayClosePayload,
        priority: 1,
        sync_direction: 'PUSH',
      });

      log.info('Day close re-queued for sync', {
        dayId,
        storeId: day.store_id,
        businessDate: day.business_date,
        closingsCount: closings.length,
      });

      return true;
    } catch (error) {
      log.error('Failed to re-queue day close for sync', {
        dayId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Re-queue an OPEN day for sync
   * Used for recovery when sync was deleted or failed
   *
   * This method allows re-pushing a day_open event to the cloud when:
   * - The original sync item was manually deleted
   * - The original sync failed and was dead-lettered
   * - The cloud needs the day re-created after data loss
   *
   * @security SEC-006: Payload uses structured objects, no string interpolation
   * @security DB-006: Include store_id for tenant isolation
   * @security SEC-010: userId for audit trail
   * @security SEC-017: Audit logging for re-queue operation
   *
   * @param dayId - Day ID to re-queue
   * @param userId - User ID for audit trail
   * @returns true if queued successfully
   */
  requeueDayOpenForSync(dayId: string, userId: string): boolean {
    const day = this.findById(dayId);

    if (!day) {
      throw new Error(`Business day not found: ${dayId}`);
    }

    // Validation: Day must be OPEN to re-queue day_open sync
    // CLOSED days should use requeueDayCloseForSync instead
    // PENDING_CLOSE days are in transition - user should commit or cancel first
    if (day.status !== 'OPEN') {
      throw new Error(
        `Day must be OPEN to re-queue day_open for sync. Current status: ${day.status}. ` +
          `For CLOSED days, use requeueDayCloseForSync instead.`
      );
    }

    // SEC-010: opened_by is REQUIRED by cloud API
    // Use stored opener if available, otherwise use the requester's userId
    const openedBy = day.opened_by || (userId && userId !== '' ? userId : null);
    if (!openedBy) {
      throw new Error('Cannot re-queue day_open sync: opened_by is required (SEC-010)');
    }

    // SEC-006: Build structured payload per API contract (replica_end_points.md lines 2408-2420)
    // DB-006: Include store_id for tenant isolation
    const dayOpenPayload: Record<string, unknown> = {
      day_id: day.day_id,
      store_id: day.store_id,
      business_date: day.business_date,
      opened_at: day.opened_at || this.now(),
      opened_by: openedBy, // REQUIRED by cloud API
      // Optional fields can be added if available
      // notes, local_id, external_day_id
    };

    try {
      syncQueueDAL.enqueue({
        store_id: day.store_id,
        entity_type: 'day_open',
        entity_id: dayId,
        operation: 'CREATE',
        payload: dayOpenPayload,
        priority: 2, // Higher priority - day_open must sync before day_close
        sync_direction: 'PUSH',
      });

      log.info('Day open re-queued for sync', {
        dayId,
        storeId: day.store_id,
        businessDate: day.business_date,
        requestedBy: userId,
      });

      return true;
    } catch (error) {
      log.error('Failed to re-queue day open for sync', {
        dayId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Delete a business day and its associated records
   * DANGER: This is a destructive operation for data cleanup only
   * Used to fix data corruption from bugs (e.g., UTC date calculation bug)
   *
   * @param dayId - Day ID to delete
   * @returns Deletion result
   */
  deleteBusinessDay(dayId: string): { deleted: boolean; dayPacksDeleted: number } {
    const day = this.findById(dayId);

    if (!day) {
      throw new Error(`Business day not found: ${dayId}`);
    }

    return this.withTransaction(() => {
      // First delete associated day_packs
      const deletePacksStmt = this.db.prepare(`
        DELETE FROM lottery_day_packs WHERE day_id = ?
      `);
      const packsResult = deletePacksStmt.run(dayId);

      // Then delete the business day
      const deleteDayStmt = this.db.prepare(`
        DELETE FROM lottery_business_days WHERE day_id = ?
      `);
      deleteDayStmt.run(dayId);

      log.warn('Business day deleted (data cleanup)', {
        dayId,
        storeId: day.store_id,
        businessDate: day.business_date,
        status: day.status,
        dayPacksDeleted: packsResult.changes,
      });

      return {
        deleted: true,
        dayPacksDeleted: packsResult.changes,
      };
    });
  }

  /**
   * Reopen a closed business day
   * Used for testing and data recovery
   *
   * @param dayId - Day ID to reopen
   * @returns Updated day
   */
  reopenDay(dayId: string): LotteryBusinessDay {
    const day = this.findById(dayId);

    if (!day) {
      throw new Error(`Business day not found: ${dayId}`);
    }

    if (day.status !== 'CLOSED') {
      throw new Error(`Day must be CLOSED to reopen. Current status: ${day.status}`);
    }

    const stmt = this.db.prepare(`
      UPDATE lottery_business_days
      SET status = 'OPEN', closed_at = NULL, closed_by = NULL, updated_at = ?
      WHERE day_id = ?
    `);
    stmt.run(this.now(), dayId);

    log.warn('Business day reopened (data recovery)', {
      dayId,
      storeId: day.store_id,
      businessDate: day.business_date,
    });

    return this.findById(dayId)!;
  }

  /**
   * List all business days for a store
   * Useful for debugging and data inspection
   *
   * @param storeId - Store ID
   * @returns All business days for the store
   */
  listAllDays(storeId: string): LotteryBusinessDay[] {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_business_days
      WHERE store_id = ?
      ORDER BY business_date DESC
    `);
    return stmt.all(storeId) as LotteryBusinessDay[];
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

    // FK-DEBUG: Log all FK values to identify which one fails
    log.debug('Creating day pack record - FK values', {
      dayPackId,
      storeId,
      dayId,
      packId,
      binId,
    });

    // FK-DEBUG: Verify each FK exists before INSERT
    const storeExists = this.db.prepare('SELECT 1 FROM stores WHERE store_id = ?').get(storeId);
    const dayExists = this.db
      .prepare('SELECT 1 FROM lottery_business_days WHERE day_id = ?')
      .get(dayId);
    const packExists = this.db.prepare('SELECT 1 FROM lottery_packs WHERE pack_id = ?').get(packId);
    const binExists = binId
      ? this.db.prepare('SELECT 1 FROM lottery_bins WHERE bin_id = ?').get(binId)
      : 'N/A (null)';

    log.debug('FK existence check results', {
      storeExists: !!storeExists,
      dayExists: !!dayExists,
      packExists: !!packExists,
      binExists: binId ? !!binExists : 'skipped (null)',
    });

    if (!storeExists) {
      throw new Error(`FK validation failed: store_id ${storeId} does not exist`);
    }
    if (!dayExists) {
      throw new Error(`FK validation failed: day_id ${dayId} does not exist`);
    }
    if (!packExists) {
      throw new Error(`FK validation failed: pack_id ${packId} does not exist`);
    }
    if (binId && !binExists) {
      log.warn('Bin does not exist, setting bin_id to null', { binId });
      binId = null;
    }

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
