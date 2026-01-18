/**
 * Lottery Packs Data Access Layer
 *
 * CRUD operations for lottery pack lifecycle management.
 * Manages pack states: RECEIVED -> ACTIVATED -> SETTLED or RETURNED
 *
 * @module main/dal/lottery-packs
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Lottery pack status lifecycle
 * RECEIVED: Pack received from distributor, not yet in use
 * ACTIVATED: Pack is active in a bin, being sold
 * SETTLED: Pack finished during day close, sales recorded
 * RETURNED: Pack returned to distributor
 */
export type LotteryPackStatus = 'RECEIVED' | 'ACTIVATED' | 'SETTLED' | 'RETURNED';

/**
 * Lottery pack entity
 */
export interface LotteryPack extends StoreEntity {
  pack_id: string;
  store_id: string;
  game_id: string;
  pack_number: string;
  bin_id: string | null;
  status: LotteryPackStatus;
  received_at: string | null;
  received_by: string | null;
  activated_at: string | null;
  settled_at: string | null;
  returned_at: string | null;
  opening_serial: string | null;
  closing_serial: string | null;
  tickets_sold: number;
  sales_amount: number;
  cloud_pack_id: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Pack creation data (receive)
 */
export interface ReceivePackData {
  pack_id?: string;
  store_id: string;
  game_id: string;
  pack_number: string;
  cloud_pack_id?: string;
  /** User ID of who received the pack (for audit trail) */
  received_by?: string;
}

/**
 * Pack activation data
 * DB-006: Requires store_id for tenant isolation validation
 */
export interface ActivatePackData {
  store_id: string;
  bin_id: string;
  opening_serial: string;
  activated_by?: string;
}

/**
 * Pack settle data (day close)
 * DB-006: Requires store_id for tenant isolation validation
 */
export interface SettlePackData {
  store_id: string;
  closing_serial: string;
  tickets_sold: number;
  sales_amount: number;
}

/**
 * Pack return data
 * DB-006: Requires store_id for tenant isolation validation
 */
export interface ReturnPackData {
  store_id: string;
  closing_serial?: string;
  tickets_sold?: number;
  sales_amount?: number;
  return_reason?: string;
}

/**
 * Pack with game and bin information
 */
export interface PackWithDetails extends LotteryPack {
  game_code: string | null;
  game_name: string | null;
  game_price: number | null;
  game_tickets_per_pack: number | null;
  game_status: string | null;
  bin_number: number | null;
  bin_label: string | null;
}

/**
 * Pack status filter options
 */
export interface PackFilterOptions {
  status?: LotteryPackStatus;
  game_id?: string;
  bin_id?: string;
  /** Search by pack_number or game name (case-insensitive) */
  search?: string;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('lottery-packs-dal');

// ============================================================================
// Lottery Packs DAL
// ============================================================================

/**
 * Data Access Layer for lottery pack lifecycle management
 *
 * SEC-006: All queries use prepared statements
 * DB-006: All queries scoped by store_id
 */
export class LotteryPacksDAL extends StoreBasedDAL<LotteryPack> {
  protected readonly tableName = 'lottery_packs';
  protected readonly primaryKey = 'pack_id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'pack_number',
    'status',
    'received_at',
    'activated_at',
    'settled_at',
  ]);

  // ==========================================================================
  // Lifecycle Operations
  // ==========================================================================

  /**
   * Receive a new pack (create with RECEIVED status)
   * SEC-006: Parameterized INSERT
   *
   * @param data - Pack reception data
   * @returns Created pack
   */
  receive(data: ReceivePackData): LotteryPack {
    const packId = data.pack_id || this.generateId();
    const now = this.now();

    // Check for duplicate pack in store
    const existing = this.findByPackNumber(data.store_id, data.game_id, data.pack_number);
    if (existing) {
      throw new Error(`Pack ${data.pack_number} already exists for this game in store`);
    }

    // SEC-006: Parameterized query
    // SEC-010: AUTHZ - Track received_by for audit trail
    const stmt = this.db.prepare(`
      INSERT INTO lottery_packs (
        pack_id, store_id, game_id, pack_number, status,
        received_at, received_by, cloud_pack_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'RECEIVED', ?, ?, ?, ?, ?)
    `);

    stmt.run(
      packId,
      data.store_id,
      data.game_id,
      data.pack_number,
      now,
      data.received_by || null,
      data.cloud_pack_id || null,
      now,
      now
    );

    log.info('Lottery pack received', {
      packId,
      storeId: data.store_id,
      gameId: data.game_id,
      packNumber: data.pack_number,
      receivedBy: data.received_by,
    });

    const created = this.findById(packId);
    if (!created) {
      throw new Error(`Failed to retrieve created pack: ${packId}`);
    }
    return created;
  }

  /**
   * Activate a pack (move to bin and start selling)
   * Validates pack is in RECEIVED status and belongs to the specified store
   * SEC-006: Parameterized UPDATE with store_id in WHERE clause
   * DB-006: Tenant isolation - pack must belong to store_id
   * SEC-010: AUTHZ - Record activated_by for audit trail
   *
   * @param packId - Pack ID to activate
   * @param data - Activation data including store_id for tenant isolation
   * @returns Updated pack or throws error
   */
  activate(packId: string, data: ActivatePackData): LotteryPack {
    log.debug('Starting pack activation', {
      packId,
      storeId: data.store_id,
      binId: data.bin_id,
      openingSerial: data.opening_serial,
    });

    // DB-006: First verify pack exists AND belongs to the specified store
    const pack = this.findByIdForStore(data.store_id, packId);
    log.debug('findByIdForStore result', {
      found: !!pack,
      packStatus: pack?.status,
      packStoreId: pack?.store_id,
      packBinId: pack?.bin_id,
    });

    if (!pack) {
      throw new Error(`Pack not found: ${packId}`);
    }

    if (pack.status !== 'RECEIVED') {
      throw new Error(
        `Cannot activate pack with status ${pack.status}. Pack must be in RECEIVED status.`
      );
    }

    const now = this.now();

    // SEC-006: Parameterized UPDATE with store_id constraint
    // DB-006: Include store_id in WHERE clause for tenant isolation
    // SEC-010: AUTHZ - Store activated_by for audit trail
    const stmt = this.db.prepare(`
      UPDATE lottery_packs SET
        bin_id = ?,
        status = 'ACTIVATED',
        activated_at = ?,
        opening_serial = ?,
        activated_by = ?,
        updated_at = ?
      WHERE pack_id = ? AND store_id = ? AND status = 'RECEIVED'
    `);

    const result = stmt.run(
      data.bin_id,
      now,
      data.opening_serial,
      data.activated_by || null,
      now,
      packId,
      data.store_id
    );

    log.debug('UPDATE result', {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    });

    if (result.changes === 0) {
      throw new Error(
        'Failed to activate pack - status may have changed or pack does not belong to this store'
      );
    }

    const updated = this.findByIdForStore(data.store_id, packId);

    log.debug('After activation - pack state', {
      packId: updated?.pack_id,
      status: updated?.status,
      binId: updated?.bin_id,
      storeId: updated?.store_id,
      openingSerial: updated?.opening_serial,
    });

    if (!updated) {
      throw new Error(`Failed to retrieve activated pack: ${packId}`);
    }
    return updated;
  }

  /**
   * Settle a pack (close during day close)
   * Validates pack is in ACTIVATED status and belongs to specified store
   * SEC-006: Parameterized UPDATE with store_id in WHERE clause
   * DB-006: Tenant isolation - pack must belong to store_id
   *
   * @param packId - Pack ID to settle
   * @param data - Settlement data including store_id for tenant isolation
   * @returns Updated pack or throws error
   */
  settle(packId: string, data: SettlePackData): LotteryPack {
    // DB-006: First verify pack exists AND belongs to the specified store
    const pack = this.findByIdForStore(data.store_id, packId);

    if (!pack) {
      throw new Error(`Pack not found: ${packId}`);
    }

    if (pack.status !== 'ACTIVATED') {
      throw new Error(
        `Cannot settle pack with status ${pack.status}. Pack must be in ACTIVATED status.`
      );
    }

    const now = this.now();

    // SEC-006: Parameterized UPDATE with store_id constraint
    // DB-006: Include store_id in WHERE clause for tenant isolation
    const stmt = this.db.prepare(`
      UPDATE lottery_packs SET
        status = 'SETTLED',
        settled_at = ?,
        closing_serial = ?,
        tickets_sold = ?,
        sales_amount = ?,
        updated_at = ?
      WHERE pack_id = ? AND store_id = ? AND status = 'ACTIVATED'
    `);

    const result = stmt.run(
      now,
      data.closing_serial,
      data.tickets_sold,
      data.sales_amount,
      now,
      packId,
      data.store_id
    );

    if (result.changes === 0) {
      throw new Error(
        'Failed to settle pack - status may have changed or pack does not belong to this store'
      );
    }

    log.info('Lottery pack settled', {
      packId,
      storeId: data.store_id,
      closingSerial: data.closing_serial,
      ticketsSold: data.tickets_sold,
      salesAmount: data.sales_amount,
    });

    const updated = this.findByIdForStore(data.store_id, packId);
    if (!updated) {
      throw new Error(`Failed to retrieve settled pack: ${packId}`);
    }
    return updated;
  }

  /**
   * Return a pack to distributor
   * Can return from RECEIVED or ACTIVATED status
   * SEC-006: Parameterized UPDATE with store_id in WHERE clause
   * DB-006: Tenant isolation - pack must belong to store_id
   *
   * @param packId - Pack ID to return
   * @param data - Return data including store_id for tenant isolation
   * @returns Updated pack or throws error
   */
  returnPack(packId: string, data: ReturnPackData): LotteryPack {
    // DB-006: First verify pack exists AND belongs to the specified store
    const pack = this.findByIdForStore(data.store_id, packId);

    if (!pack) {
      throw new Error(`Pack not found: ${packId}`);
    }

    if (pack.status !== 'RECEIVED' && pack.status !== 'ACTIVATED') {
      throw new Error(
        `Cannot return pack with status ${pack.status}. Pack must be in RECEIVED or ACTIVATED status.`
      );
    }

    const now = this.now();

    // SEC-006: Parameterized UPDATE with store_id constraint
    // DB-006: Include store_id in WHERE clause for tenant isolation
    const stmt = this.db.prepare(`
      UPDATE lottery_packs SET
        status = 'RETURNED',
        returned_at = ?,
        closing_serial = COALESCE(?, closing_serial),
        tickets_sold = COALESCE(?, tickets_sold),
        sales_amount = COALESCE(?, sales_amount),
        updated_at = ?
      WHERE pack_id = ? AND store_id = ? AND status IN ('RECEIVED', 'ACTIVATED')
    `);

    const result = stmt.run(
      now,
      data.closing_serial || null,
      data.tickets_sold ?? null,
      data.sales_amount ?? null,
      now,
      packId,
      data.store_id
    );

    if (result.changes === 0) {
      throw new Error(
        'Failed to return pack - status may have changed or pack does not belong to this store'
      );
    }

    log.info('Lottery pack returned', {
      packId,
      storeId: data.store_id,
      previousStatus: pack.status,
      closingSerial: data.closing_serial,
    });

    const updated = this.findByIdForStore(data.store_id, packId);
    if (!updated) {
      throw new Error(`Failed to retrieve returned pack: ${packId}`);
    }
    return updated;
  }

  // ==========================================================================
  // Query Operations
  // ==========================================================================

  /**
   * Find packs by status for a store
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param status - Pack status to filter
   * @returns Array of packs
   */
  findByStatus(storeId: string, status: LotteryPackStatus): LotteryPack[] {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_packs
      WHERE store_id = ? AND status = ?
      ORDER BY updated_at DESC
    `);
    return stmt.all(storeId, status) as LotteryPack[];
  }

  /**
   * Find packs with filters
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param filters - Filter options
   * @returns Array of packs
   */
  findWithFilters(storeId: string, filters: PackFilterOptions = {}): LotteryPack[] {
    const conditions: string[] = ['store_id = ?'];
    const params: unknown[] = [storeId];

    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters.game_id) {
      conditions.push('game_id = ?');
      params.push(filters.game_id);
    }
    if (filters.bin_id) {
      conditions.push('bin_id = ?');
      params.push(filters.bin_id);
    }

    const whereClause = conditions.join(' AND ');

    const stmt = this.db.prepare(`
      SELECT * FROM lottery_packs
      WHERE ${whereClause}
      ORDER BY updated_at DESC
    `);
    return stmt.all(...params) as LotteryPack[];
  }

  /**
   * Find the active pack in a specific bin
   * SEC-006: Parameterized query
   *
   * @param binId - Bin identifier
   * @returns Active pack or undefined
   */
  findActiveInBin(binId: string): LotteryPack | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_packs
      WHERE bin_id = ? AND status = 'ACTIVATED'
      LIMIT 1
    `);
    return stmt.get(binId) as LotteryPack | undefined;
  }

  /**
   * Find pack by pack number within a store and game
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param gameId - Game identifier
   * @param packNumber - Pack number
   * @returns Pack or undefined
   */
  findByPackNumber(storeId: string, gameId: string, packNumber: string): LotteryPack | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_packs
      WHERE store_id = ? AND game_id = ? AND pack_number = ?
    `);
    return stmt.get(storeId, gameId, packNumber) as LotteryPack | undefined;
  }

  /**
   * Find pack by cloud ID
   * SEC-006: Parameterized query
   *
   * @param cloudPackId - Cloud pack identifier
   * @returns Pack or undefined
   */
  findByCloudId(cloudPackId: string): LotteryPack | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_packs WHERE cloud_pack_id = ?
    `);
    return stmt.get(cloudPackId) as LotteryPack | undefined;
  }

  /**
   * Get pack with game and bin details
   * SEC-006: Parameterized query with JOINs
   *
   * @param packId - Pack identifier
   * @returns Pack with details or undefined
   */
  getPackWithDetails(packId: string): PackWithDetails | undefined {
    const stmt = this.db.prepare(`
      SELECT
        p.*,
        g.game_code,
        g.name as game_name,
        g.price as game_price,
        b.bin_number,
        b.label as bin_label
      FROM lottery_packs p
      LEFT JOIN lottery_games g ON p.game_id = g.game_id
      LEFT JOIN lottery_bins b ON p.bin_id = b.bin_id
      WHERE p.pack_id = ?
    `);
    return stmt.get(packId) as PackWithDetails | undefined;
  }

  /**
   * Get packs with details for a store
   * SEC-006: Parameterized query with JOINs
   *
   * @param storeId - Store identifier
   * @param filters - Filter options
   * @returns Array of packs with details
   */
  findPacksWithDetails(storeId: string, filters: PackFilterOptions = {}): PackWithDetails[] {
    const conditions: string[] = ['p.store_id = ?'];
    const params: unknown[] = [storeId];

    if (filters.status) {
      conditions.push('p.status = ?');
      params.push(filters.status);
    }
    if (filters.game_id) {
      conditions.push('p.game_id = ?');
      params.push(filters.game_id);
    }
    if (filters.bin_id) {
      conditions.push('p.bin_id = ?');
      params.push(filters.bin_id);
    }
    // SEC-006: Search uses parameterized LIKE query to prevent SQL injection
    // Searches pack_number (exact prefix match) or game name (case-insensitive contains)
    if (filters.search && filters.search.trim().length >= 2) {
      const searchTerm = filters.search.trim();
      // Use LIKE with parameterized values - % wildcards added to param, not SQL string
      conditions.push('(p.pack_number LIKE ? OR g.name LIKE ? COLLATE NOCASE)');
      params.push(`${searchTerm}%`); // pack_number prefix match
      params.push(`%${searchTerm}%`); // game name contains match
    }

    const whereClause = conditions.join(' AND ');

    const stmt = this.db.prepare(`
      SELECT
        p.*,
        g.game_code,
        g.name as game_name,
        g.price as game_price,
        g.tickets_per_pack as game_tickets_per_pack,
        g.status as game_status,
        b.bin_number,
        b.label as bin_label
      FROM lottery_packs p
      LEFT JOIN lottery_games g ON p.game_id = g.game_id
      LEFT JOIN lottery_bins b ON p.bin_id = b.bin_id
      WHERE ${whereClause}
      ORDER BY p.updated_at DESC
    `);
    return stmt.all(...params) as PackWithDetails[];
  }

  /**
   * Get all activated packs for a store (for day close)
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @returns Array of activated packs with details
   */
  getActivatedPacksForDayClose(storeId: string): PackWithDetails[] {
    return this.findPacksWithDetails(storeId, { status: 'ACTIVATED' });
  }

  /**
   * Find packs activated since a specific date (enterprise close-to-close model)
   *
   * This method returns ALL packs that were activated on or after the specified date,
   * regardless of their current status. This supports the enterprise close-to-close
   * business day model where:
   * - A pack activated yesterday that was returned today should still appear
   * - A pack activated yesterday that was settled (sold out) today should still appear
   * - The UI shows the full history of the open business period
   *
   * Performance: Uses indexed activated_at column with parameterized date filter.
   * Query is bounded by date range and store_id (both indexed).
   *
   * @security SEC-006: Parameterized query prevents SQL injection
   * @security DB-006: store_id in WHERE clause enforces tenant isolation
   *
   * @param storeId - Store identifier for tenant isolation
   * @param sinceDate - ISO date string (YYYY-MM-DD) for the start of the period
   * @returns Array of packs with game and bin details, ordered by activated_at DESC
   */
  findPacksActivatedSince(storeId: string, sinceDate: string): PackWithDetails[] {
    // Validate sinceDate format to prevent malformed queries
    // Format: YYYY-MM-DD (ISO 8601 date)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceDate)) {
      throw new Error('Invalid date format. Expected YYYY-MM-DD');
    }

    const sinceDatetime = `${sinceDate}T00:00:00`;

    // SEC-006: Fully parameterized query
    // DB-006: store_id enforces tenant isolation
    // Performance: Uses indexed columns (store_id, activated_at) with bounded result set
    const stmt = this.db.prepare(`
      SELECT
        p.*,
        g.game_code,
        g.name as game_name,
        g.price as game_price,
        g.tickets_per_pack as game_tickets_per_pack,
        g.status as game_status,
        b.bin_number,
        b.label as bin_label
      FROM lottery_packs p
      LEFT JOIN lottery_games g ON p.game_id = g.game_id
      LEFT JOIN lottery_bins b ON p.bin_id = b.bin_id
      WHERE p.store_id = ?
        AND p.activated_at IS NOT NULL
        AND p.activated_at >= ?
      ORDER BY p.activated_at DESC
    `);

    return stmt.all(storeId, sinceDatetime) as PackWithDetails[];
  }

  /**
   * Find packs settled since a specific date (enterprise close-to-close model)
   *
   * Returns packs that were settled (sold out / depleted) on or after the specified date.
   *
   * @security SEC-006: Parameterized query prevents SQL injection
   * @security DB-006: store_id in WHERE clause enforces tenant isolation
   *
   * @param storeId - Store identifier for tenant isolation
   * @param sinceDate - ISO date string (YYYY-MM-DD) for the start of the period
   * @returns Array of packs with game and bin details
   */
  findPacksSettledSince(storeId: string, sinceDate: string): PackWithDetails[] {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceDate)) {
      throw new Error('Invalid date format. Expected YYYY-MM-DD');
    }

    const sinceDatetime = `${sinceDate}T00:00:00`;

    const stmt = this.db.prepare(`
      SELECT
        p.*,
        g.game_code,
        g.name as game_name,
        g.price as game_price,
        g.tickets_per_pack as game_tickets_per_pack,
        g.status as game_status,
        b.bin_number,
        b.label as bin_label
      FROM lottery_packs p
      LEFT JOIN lottery_games g ON p.game_id = g.game_id
      LEFT JOIN lottery_bins b ON p.bin_id = b.bin_id
      WHERE p.store_id = ?
        AND p.status = 'SETTLED'
        AND p.settled_at IS NOT NULL
        AND p.settled_at >= ?
      ORDER BY p.settled_at DESC
    `);

    return stmt.all(storeId, sinceDatetime) as PackWithDetails[];
  }

  /**
   * Find packs returned since a specific date (enterprise close-to-close model)
   *
   * Returns packs that were returned on or after the specified date.
   *
   * @security SEC-006: Parameterized query prevents SQL injection
   * @security DB-006: store_id in WHERE clause enforces tenant isolation
   *
   * @param storeId - Store identifier for tenant isolation
   * @param sinceDate - ISO date string (YYYY-MM-DD) for the start of the period
   * @returns Array of packs with game and bin details
   */
  findPacksReturnedSince(storeId: string, sinceDate: string): PackWithDetails[] {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceDate)) {
      throw new Error('Invalid date format. Expected YYYY-MM-DD');
    }

    const sinceDatetime = `${sinceDate}T00:00:00`;

    const stmt = this.db.prepare(`
      SELECT
        p.*,
        g.game_code,
        g.name as game_name,
        g.price as game_price,
        g.tickets_per_pack as game_tickets_per_pack,
        g.status as game_status,
        b.bin_number,
        b.label as bin_label
      FROM lottery_packs p
      LEFT JOIN lottery_games g ON p.game_id = g.game_id
      LEFT JOIN lottery_bins b ON p.bin_id = b.bin_id
      WHERE p.store_id = ?
        AND p.status = 'RETURNED'
        AND p.returned_at IS NOT NULL
        AND p.returned_at >= ?
      ORDER BY p.returned_at DESC
    `);

    return stmt.all(storeId, sinceDatetime) as PackWithDetails[];
  }

  // ==========================================================================
  // Sales Calculation
  // ==========================================================================

  /**
   * Calculate sales for a pack given closing serial
   * Uses opening_serial and game price for calculation
   *
   * @param packId - Pack identifier
   * @param closingSerial - Ending serial number
   * @returns Object with tickets sold and sales amount
   */
  calculateSales(
    packId: string,
    closingSerial: string
  ): { ticketsSold: number; salesAmount: number } {
    const pack = this.getPackWithDetails(packId);

    if (!pack) {
      throw new Error(`Pack not found: ${packId}`);
    }

    if (!pack.opening_serial) {
      throw new Error(`Pack has no opening serial: ${packId}`);
    }

    if (!pack.game_price) {
      throw new Error(`Game has no price: ${pack.game_id}`);
    }

    // Calculate tickets sold (closing - opening)
    const openingNum = parseInt(pack.opening_serial, 10);
    const closingNum = parseInt(closingSerial, 10);

    if (isNaN(openingNum) || isNaN(closingNum)) {
      throw new Error('Invalid serial number format');
    }

    const ticketsSold = closingNum - openingNum;

    if (ticketsSold < 0) {
      throw new Error('Closing serial cannot be less than opening serial');
    }

    const salesAmount = ticketsSold * pack.game_price;

    return { ticketsSold, salesAmount };
  }

  // ==========================================================================
  // Utility Operations
  // ==========================================================================

  /**
   * Move pack to a different bin
   * Only for ACTIVATED packs
   * SEC-006: Parameterized UPDATE
   *
   * @param packId - Pack ID
   * @param newBinId - New bin ID
   * @returns Updated pack or throws error
   */
  moveToBin(packId: string, newBinId: string): LotteryPack {
    const pack = this.findById(packId);

    if (!pack) {
      throw new Error(`Pack not found: ${packId}`);
    }

    if (pack.status !== 'ACTIVATED') {
      throw new Error(`Cannot move pack with status ${pack.status}. Pack must be ACTIVATED.`);
    }

    const stmt = this.db.prepare(`
      UPDATE lottery_packs SET bin_id = ?, updated_at = ?
      WHERE pack_id = ? AND status = 'ACTIVATED'
    `);

    const result = stmt.run(newBinId, this.now(), packId);

    if (result.changes === 0) {
      throw new Error('Failed to move pack');
    }

    log.info('Lottery pack moved', { packId, newBinId });

    const updated = this.findById(packId);
    if (!updated) {
      throw new Error(`Failed to retrieve moved pack: ${packId}`);
    }
    return updated;
  }

  /**
   * Update opening serial (correction)
   * Only for ACTIVATED packs
   * SEC-006: Parameterized UPDATE
   *
   * @param packId - Pack ID
   * @param openingSerial - New opening serial
   * @returns Updated pack or throws error
   */
  updateOpeningSerial(packId: string, openingSerial: string): LotteryPack {
    const pack = this.findById(packId);

    if (!pack) {
      throw new Error(`Pack not found: ${packId}`);
    }

    if (pack.status !== 'ACTIVATED') {
      throw new Error('Can only update opening serial on activated packs');
    }

    const stmt = this.db.prepare(`
      UPDATE lottery_packs SET opening_serial = ?, updated_at = ?
      WHERE pack_id = ?
    `);

    stmt.run(openingSerial, this.now(), packId);

    log.info('Lottery pack opening serial updated', {
      packId,
      oldSerial: pack.opening_serial,
      newSerial: openingSerial,
    });

    const updated = this.findById(packId);
    if (!updated) {
      throw new Error(`Failed to retrieve updated pack: ${packId}`);
    }
    return updated;
  }

  /**
   * Find pack by pack number only (across all games in store)
   * Used for checking if a pack exists before reception
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param packNumber - Pack number
   * @returns Pack with game details or undefined
   */
  findByPackNumberOnly(
    storeId: string,
    packNumber: string
  ): (LotteryPack & { game_code: string | null; game_name: string | null }) | undefined {
    const stmt = this.db.prepare(`
      SELECT lp.*, lg.game_code, lg.name as game_name
      FROM lottery_packs lp
      LEFT JOIN lottery_games lg ON lp.game_id = lg.game_id
      WHERE lp.store_id = ? AND lp.pack_number = ?
      LIMIT 1
    `);
    return stmt.get(storeId, packNumber) as
      | (LotteryPack & { game_code: string | null; game_name: string | null })
      | undefined;
  }

  /**
   * Count packs by status for a store
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @returns Object with counts per status
   */
  getStatusCounts(storeId: string): Record<LotteryPackStatus, number> {
    const stmt = this.db.prepare(`
      SELECT status, COUNT(*) as count
      FROM lottery_packs
      WHERE store_id = ?
      GROUP BY status
    `);

    const results = stmt.all(storeId) as Array<{ status: LotteryPackStatus; count: number }>;

    const counts: Record<LotteryPackStatus, number> = {
      RECEIVED: 0,
      ACTIVATED: 0,
      SETTLED: 0,
      RETURNED: 0,
    };

    for (const row of results) {
      counts[row.status] = row.count;
    }

    return counts;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for lottery pack operations
 */
export const lotteryPacksDAL = new LotteryPacksDAL();
