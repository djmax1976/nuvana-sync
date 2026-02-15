/**
 * Lottery Packs Data Access Layer
 *
 * CRUD operations for lottery pack lifecycle management.
 * Manages pack states: RECEIVED -> ACTIVE -> DEPLETED or RETURNED
 *
 * @module main/dal/lottery-packs
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';
import type { ReturnReason } from '../../shared/types/lottery.types';

// ============================================================================
// Types
// ============================================================================

/**
 * Lottery pack status lifecycle
 * RECEIVED: Pack received from distributor, not yet in use
 * ACTIVE: Pack is active in a bin, being sold
 * DEPLETED: Pack finished (sold out), sales recorded
 * RETURNED: Pack returned to distributor
 */
export type LotteryPackStatus = 'RECEIVED' | 'ACTIVE' | 'DEPLETED' | 'RETURNED';

/**
 * Lottery pack entity
 * v029 API Alignment: Uses current_bin_id and tickets_sold_count
 * v038 API Alignment: Added serial_override_approved_at and mark_sold_approved_at
 */
export interface LotteryPack extends StoreEntity {
  pack_id: string;
  store_id: string;
  game_id: string;
  pack_number: string;
  /** v029: Renamed from bin_id for API alignment */
  current_bin_id: string | null;
  status: LotteryPackStatus;
  received_at: string | null;
  received_by: string | null;
  activated_at: string | null;
  activated_by: string | null;
  activated_shift_id: string | null;
  depleted_at: string | null;
  depleted_by: string | null;
  depleted_shift_id: string | null;
  returned_at: string | null;
  returned_by: string | null;
  returned_shift_id: string | null;
  opening_serial: string | null;
  closing_serial: string | null;
  /** v029: Renamed from tickets_sold for API alignment */
  tickets_sold_count: number;
  sales_amount: number;
  /** v029: Serial override approval tracking */
  serial_override_approved_by: string | null;
  /** v038: Timestamp when serial override was approved */
  serial_override_approved_at: string | null;
  serial_override_reason: string | null;
  /** v029: Mark sold approval tracking */
  mark_sold_approved_by: string | null;
  /** v038: Timestamp when mark sold was approved */
  mark_sold_approved_at: string | null;
  mark_sold_reason: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
  depletion_reason: string | null;
  return_reason: string | null;
  return_notes: string | null;
}

/**
 * Pack creation data (receive)
 */
export interface ReceivePackData {
  pack_id?: string;
  store_id: string;
  game_id: string;
  pack_number: string;
  /** User ID of who received the pack (for audit trail) */
  received_by?: string;
}

/**
 * Pack activation data
 * DB-006: Requires store_id for tenant isolation validation
 *
 * v019 Schema Alignment: Added activated_shift_id for shift-level audit trail
 * - Required for cashiers (business logic enforced in handler)
 * - Optional for managers (may activate without active shift)
 */
export interface ActivatePackData {
  store_id: string;
  /** v029: Renamed from bin_id for API alignment */
  current_bin_id: string;
  opening_serial: string;
  activated_by?: string;
  /** Shift ID during which pack was activated (v019 schema alignment) */
  activated_shift_id?: string | null;
}

/**
 * Pack settle data (day close / depletion)
 * DB-006: Requires store_id for tenant isolation validation
 *
 * v019 Schema Alignment: Added shift tracking for depletion operations
 */
export interface SettlePackData {
  store_id: string;
  closing_serial: string;
  /** v029: Renamed from tickets_sold for API alignment */
  tickets_sold_count: number;
  sales_amount: number;
  /** User who depleted the pack (v019 schema alignment) */
  depleted_by?: string | null;
  /** Shift ID during which pack was depleted (v019 schema alignment) */
  depleted_shift_id?: string | null;
  /** Reason for depletion: SHIFT_CLOSE, AUTO_REPLACED, MANUAL_SOLD_OUT, POS_LAST_TICKET */
  depletion_reason?: string | null;
}

/**
 * Pack return data
 * DB-006: Requires store_id for tenant isolation validation
 * SEC-014: return_reason is required and must be a valid ReturnReason enum value
 *
 * v019 Schema Alignment: Added shift tracking for return operations
 * v020 Schema Alignment: Added return_reason and return_notes for audit trail
 */
export interface ReturnPackData {
  store_id: string;
  closing_serial?: string;
  /** v029: Renamed from tickets_sold for API alignment */
  tickets_sold_count?: number;
  sales_amount?: number;
  /**
   * Return reason - REQUIRED, must be valid enum value
   * SEC-014: Validated at entry point by ReturnReasonSchema
   * Valid values: SUPPLIER_RECALL, DAMAGED, EXPIRED, INVENTORY_ADJUSTMENT, STORE_CLOSURE
   */
  return_reason: ReturnReason;
  /** Optional notes for return context (max 500 chars, SEC-014 length validation) */
  return_notes?: string;
  /** User who returned the pack (v019 schema alignment) */
  returned_by?: string | null;
  /** Shift ID during which pack was returned (v019 schema alignment) */
  returned_shift_id?: string | null;
}

/**
 * Pack with game and bin information (cloud-aligned v039)
 */
export interface PackWithDetails extends LotteryPack {
  game_code: string | null;
  game_name: string | null;
  game_price: number | null;
  game_tickets_per_pack: number | null;
  game_status: string | null;
  /** Cloud-aligned: bin name (replaces bin_label) */
  bin_name: string | null;
  /** Cloud-aligned: bin display order (replaces bin_number) */
  bin_display_order: number | null;
  /** Serial carryforward: Previous day's ending_serial becomes today's starting */
  prev_ending_serial: string | null;
}

/**
 * Pack status filter options
 */
export interface PackFilterOptions {
  status?: LotteryPackStatus;
  game_id?: string;
  /** v029: Renamed from bin_id for API alignment */
  current_bin_id?: string;
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
    'depleted_at',
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
        received_at, received_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'RECEIVED', ?, ?, ?, ?)
    `);

    stmt.run(
      packId,
      data.store_id,
      data.game_id,
      data.pack_number,
      now,
      data.received_by || null,
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
      currentBinId: data.current_bin_id,
      openingSerial: data.opening_serial,
    });

    // DB-006: First verify pack exists AND belongs to the specified store
    const pack = this.findByIdForStore(data.store_id, packId);
    log.debug('findByIdForStore result', {
      found: !!pack,
      packStatus: pack?.status,
      packStoreId: pack?.store_id,
      packCurrentBinId: pack?.current_bin_id,
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
    // SEC-010: AUTHZ - Store activated_by and activated_shift_id for audit trail
    // v019 Schema Alignment: Now includes activated_shift_id
    // v029 API Alignment: Uses current_bin_id
    const stmt = this.db.prepare(`
      UPDATE lottery_packs SET
        current_bin_id = ?,
        status = 'ACTIVE',
        activated_at = ?,
        opening_serial = ?,
        activated_by = ?,
        activated_shift_id = ?,
        updated_at = ?
      WHERE pack_id = ? AND store_id = ? AND status = 'RECEIVED'
    `);

    const result = stmt.run(
      data.current_bin_id,
      now,
      data.opening_serial,
      data.activated_by || null,
      data.activated_shift_id || null,
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
      currentBinId: updated?.current_bin_id,
      storeId: updated?.store_id,
      openingSerial: updated?.opening_serial,
    });

    if (!updated) {
      throw new Error(`Failed to retrieve activated pack: ${packId}`);
    }
    return updated;
  }

  /**
   * Settle a pack (close during day close / manual depletion)
   * Validates pack is in ACTIVE status and belongs to specified store
   * SEC-006: Parameterized UPDATE with store_id in WHERE clause
   * DB-006: Tenant isolation - pack must belong to store_id
   * SEC-010: AUTHZ - Store depleted_by and depleted_shift_id for audit trail
   *
   * v019 Schema Alignment: Now stores depletion context (shift, user, reason)
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

    if (pack.status !== 'ACTIVE') {
      throw new Error(
        `Cannot settle pack with status ${pack.status}. Pack must be in ACTIVE status.`
      );
    }

    const now = this.now();

    // SEC-006: Parameterized UPDATE with store_id constraint
    // DB-006: Include store_id in WHERE clause for tenant isolation
    // SEC-010: AUTHZ - Store depleted_by and depleted_shift_id for audit trail
    // v019 Schema Alignment: Now includes depletion context
    // v029 API Alignment: Uses tickets_sold_count
    const stmt = this.db.prepare(`
      UPDATE lottery_packs SET
        status = 'DEPLETED',
        depleted_at = ?,
        closing_serial = ?,
        tickets_sold_count = ?,
        sales_amount = ?,
        depleted_by = ?,
        depleted_shift_id = ?,
        depletion_reason = ?,
        updated_at = ?
      WHERE pack_id = ? AND store_id = ? AND status = 'ACTIVE'
    `);

    const result = stmt.run(
      now,
      data.closing_serial,
      data.tickets_sold_count,
      data.sales_amount,
      data.depleted_by || null,
      data.depleted_shift_id || null,
      data.depletion_reason || null,
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
      ticketsSoldCount: data.tickets_sold_count,
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
   * Can return from RECEIVED or ACTIVE status
   * SEC-006: Parameterized UPDATE with store_id in WHERE clause
   * DB-006: Tenant isolation - pack must belong to store_id
   * SEC-010: AUTHZ - Store returned_by and returned_shift_id for audit trail
   *
   * v019 Schema Alignment: Now stores return context (shift, user)
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

    if (pack.status !== 'RECEIVED' && pack.status !== 'ACTIVE') {
      throw new Error(
        `Cannot return pack with status ${pack.status}. Pack must be in RECEIVED or ACTIVE status.`
      );
    }

    const now = this.now();

    // SEC-006: Parameterized UPDATE with store_id constraint
    // DB-006: Include store_id in WHERE clause for tenant isolation
    // SEC-010: AUTHZ - Store returned_by and returned_shift_id for audit trail
    // SEC-014: return_reason validated at entry point, stored directly
    // v019 Schema Alignment: Now includes return context
    // v020 Schema Alignment: Now includes return_reason and return_notes
    // v029 API Alignment: Uses tickets_sold_count
    const stmt = this.db.prepare(`
      UPDATE lottery_packs SET
        status = 'RETURNED',
        returned_at = ?,
        closing_serial = COALESCE(?, closing_serial),
        tickets_sold_count = COALESCE(?, tickets_sold_count),
        sales_amount = COALESCE(?, sales_amount),
        returned_by = ?,
        returned_shift_id = ?,
        return_reason = ?,
        return_notes = ?,
        updated_at = ?
      WHERE pack_id = ? AND store_id = ? AND status IN ('RECEIVED', 'ACTIVE')
    `);

    const result = stmt.run(
      now,
      data.closing_serial || null,
      data.tickets_sold_count ?? null,
      data.sales_amount ?? null,
      data.returned_by || null,
      data.returned_shift_id || null,
      data.return_reason,
      data.return_notes || null,
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
      returnedBy: data.returned_by,
      returnedShiftId: data.returned_shift_id,
      returnReason: data.return_reason,
      returnNotes: data.return_notes || null,
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
    // v029 API Alignment: Uses current_bin_id
    if (filters.current_bin_id) {
      conditions.push('current_bin_id = ?');
      params.push(filters.current_bin_id);
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
   * Find the active pack in a specific bin for a store
   * SEC-006: Parameterized query - all values bound, no string concatenation
   * DB-006: TENANT_ISOLATION - store_id required to prevent cross-tenant data access
   * v029 API Alignment: Uses current_bin_id
   *
   * @param storeId - Store identifier for tenant isolation (REQUIRED)
   * @param currentBinId - Bin identifier
   * @returns Active pack or undefined
   */
  findActiveInBin(storeId: string, currentBinId: string): LotteryPack | undefined {
    // SEC-006: Fully parameterized query prevents SQL injection
    // DB-006: store_id in WHERE clause enforces tenant isolation
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_packs
      WHERE store_id = ? AND current_bin_id = ? AND status = 'ACTIVE'
      LIMIT 1
    `);
    return stmt.get(storeId, currentBinId) as LotteryPack | undefined;
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
   * Get pack with game and bin details for a specific store
   * SEC-006: Parameterized query with JOINs
   * DB-006: TENANT_ISOLATION - Requires store_id to prevent cross-tenant data access
   *
   * @param storeId - Store identifier for tenant isolation (REQUIRED)
   * @param packId - Pack identifier
   * @returns Pack with details or undefined
   */
  getPackWithDetailsForStore(storeId: string, packId: string): PackWithDetails | undefined {
    // v029 API Alignment: JOIN on current_bin_id
    // DB-006: TENANT_ISOLATION - store_id in WHERE clause prevents cross-tenant access
    // SEC-006: Fully parameterized query prevents SQL injection
    // SERIAL CARRYFORWARD: Include previous day's ending_serial as today's starting
    const stmt = this.db.prepare(`
      SELECT
        p.*,
        g.game_code,
        g.name as game_name,
        g.price as game_price,
        g.tickets_per_pack as game_tickets_per_pack,
        g.status as game_status,
        b.name as bin_name,
        b.display_order as bin_display_order,
        -- Get the most recent ending_serial from the last CLOSED day for this pack
        (SELECT ldp.ending_serial
         FROM lottery_day_packs ldp
         JOIN lottery_business_days lbd ON ldp.day_id = lbd.day_id
         WHERE ldp.pack_id = p.pack_id
           AND lbd.status = 'CLOSED'
         ORDER BY lbd.closed_at DESC
         LIMIT 1) AS prev_ending_serial
      FROM lottery_packs p
      LEFT JOIN lottery_games g ON p.game_id = g.game_id
      LEFT JOIN lottery_bins b ON p.current_bin_id = b.bin_id
      WHERE p.store_id = ? AND p.pack_id = ?
    `);
    return stmt.get(storeId, packId) as PackWithDetails | undefined;
  }

  /**
   * @deprecated Use getPackWithDetailsForStore instead for tenant isolation compliance
   * Get pack with game and bin details (LEGACY - lacks tenant isolation)
   * SEC-006: Parameterized query with JOINs
   * WARNING: DB-006 NON-COMPLIANT - No store_id check. Only use for internal operations
   * where pack ownership has been pre-validated.
   *
   * @param packId - Pack identifier
   * @returns Pack with details or undefined
   */
  getPackWithDetails(packId: string): PackWithDetails | undefined {
    // v029 API Alignment: JOIN on current_bin_id
    // SERIAL CARRYFORWARD: Include previous day's ending_serial as today's starting
    const stmt = this.db.prepare(`
      SELECT
        p.*,
        g.game_code,
        g.name as game_name,
        g.price as game_price,
        g.tickets_per_pack as game_tickets_per_pack,
        g.status as game_status,
        b.name as bin_name,
        b.display_order as bin_display_order,
        -- Get the most recent ending_serial from the last CLOSED day for this pack
        (SELECT ldp.ending_serial
         FROM lottery_day_packs ldp
         JOIN lottery_business_days lbd ON ldp.day_id = lbd.day_id
         WHERE ldp.pack_id = p.pack_id
           AND lbd.status = 'CLOSED'
         ORDER BY lbd.closed_at DESC
         LIMIT 1) AS prev_ending_serial
      FROM lottery_packs p
      LEFT JOIN lottery_games g ON p.game_id = g.game_id
      LEFT JOIN lottery_bins b ON p.current_bin_id = b.bin_id
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
    // v029 API Alignment: Uses current_bin_id
    if (filters.current_bin_id) {
      conditions.push('p.current_bin_id = ?');
      params.push(filters.current_bin_id);
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

    // v029 API Alignment: JOIN on current_bin_id
    const stmt = this.db.prepare(`
      SELECT
        p.*,
        g.game_code,
        g.name as game_name,
        g.price as game_price,
        g.tickets_per_pack as game_tickets_per_pack,
        g.status as game_status,
        b.name as bin_name,
        b.display_order as bin_display_order
      FROM lottery_packs p
      LEFT JOIN lottery_games g ON p.game_id = g.game_id
      LEFT JOIN lottery_bins b ON p.current_bin_id = b.bin_id
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
    return this.findPacksWithDetails(storeId, { status: 'ACTIVE' });
  }

  /**
   * Normalize a date or ISO timestamp to a comparable datetime string.
   *
   * Accepts either:
   * - YYYY-MM-DD (date only) → converts to YYYY-MM-DDT00:00:00
   * - Full ISO timestamp (e.g. 2026-02-05T00:34:36.156Z) → used as-is
   *
   * @security Input validated against strict patterns; rejects malformed strings.
   * @param input - Date string or ISO timestamp
   * @returns Normalized datetime string suitable for SQLite comparison
   */
  private normalizeSinceTimestamp(input: string): string {
    // ISO date: YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      return `${input}T00:00:00`;
    }
    // Full ISO timestamp: YYYY-MM-DDTHH:MM:SS with optional fractional seconds (1-9 digits) and Z
    // SEC-014: Using bounded quantifier {1,9} to prevent ReDoS
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z?$/.test(input)) {
      return input;
    }
    throw new Error('Invalid date/timestamp format. Expected YYYY-MM-DD or ISO 8601 timestamp');
  }

  /**
   * Find packs activated since a specific timestamp (enterprise close-to-close model)
   *
   * Returns ALL packs activated on or after the specified timestamp,
   * regardless of their current status. Supports the enterprise close-to-close
   * business day model where the period starts at the previous day's actual
   * close timestamp — not at a calendar date boundary.
   *
   * Performance: Uses indexed activated_at column with parameterized filter.
   * Query is bounded by timestamp and store_id (both indexed).
   *
   * @security SEC-006: Parameterized query prevents SQL injection
   * @security DB-006: store_id in WHERE clause enforces tenant isolation
   *
   * @param storeId - Store identifier for tenant isolation
   * @param since - ISO date (YYYY-MM-DD) or ISO timestamp for the start of the period
   * @returns Array of packs with game and bin details, ordered by activated_at DESC
   */
  findPacksActivatedSince(storeId: string, since: string): PackWithDetails[] {
    const sinceTimestamp = this.normalizeSinceTimestamp(since);

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
        b.name as bin_name,
        b.display_order as bin_display_order
      FROM lottery_packs p
      LEFT JOIN lottery_games g ON p.game_id = g.game_id
      LEFT JOIN lottery_bins b ON p.current_bin_id = b.bin_id
      WHERE p.store_id = ?
        AND p.activated_at IS NOT NULL
        AND p.activated_at >= ?
      ORDER BY p.activated_at DESC
    `);

    return stmt.all(storeId, sinceTimestamp) as PackWithDetails[];
  }

  /**
   * Find packs settled since a specific timestamp (enterprise close-to-close model)
   *
   * Returns packs that were settled (sold out / depleted) on or after the specified timestamp.
   *
   * @security SEC-006: Parameterized query prevents SQL injection
   * @security DB-006: store_id in WHERE clause enforces tenant isolation
   *
   * @param storeId - Store identifier for tenant isolation
   * @param since - ISO date (YYYY-MM-DD) or ISO timestamp for the start of the period
   * @returns Array of packs with game and bin details
   */
  findPacksSettledSince(storeId: string, since: string): PackWithDetails[] {
    const sinceTimestamp = this.normalizeSinceTimestamp(since);

    const stmt = this.db.prepare(`
      SELECT
        p.*,
        g.game_code,
        g.name as game_name,
        g.price as game_price,
        g.tickets_per_pack as game_tickets_per_pack,
        g.status as game_status,
        b.name as bin_name,
        b.display_order as bin_display_order
      FROM lottery_packs p
      LEFT JOIN lottery_games g ON p.game_id = g.game_id
      LEFT JOIN lottery_bins b ON p.current_bin_id = b.bin_id
      WHERE p.store_id = ?
        AND p.status = 'DEPLETED'
        AND p.depleted_at IS NOT NULL
        AND p.depleted_at >= ?
      ORDER BY p.depleted_at DESC
    `);

    return stmt.all(storeId, sinceTimestamp) as PackWithDetails[];
  }

  /**
   * Find packs returned since a specific timestamp (enterprise close-to-close model)
   *
   * Returns packs that were returned on or after the specified timestamp.
   *
   * @security SEC-006: Parameterized query prevents SQL injection
   * @security DB-006: store_id in WHERE clause enforces tenant isolation
   *
   * @param storeId - Store identifier for tenant isolation
   * @param since - ISO date (YYYY-MM-DD) or ISO timestamp for the start of the period
   * @returns Array of packs with game and bin details
   */
  findPacksReturnedSince(storeId: string, since: string): PackWithDetails[] {
    const sinceTimestamp = this.normalizeSinceTimestamp(since);

    const stmt = this.db.prepare(`
      SELECT
        p.*,
        g.game_code,
        g.name as game_name,
        g.price as game_price,
        g.tickets_per_pack as game_tickets_per_pack,
        g.status as game_status,
        b.name as bin_name,
        b.display_order as bin_display_order
      FROM lottery_packs p
      LEFT JOIN lottery_games g ON p.game_id = g.game_id
      LEFT JOIN lottery_bins b ON p.current_bin_id = b.bin_id
      WHERE p.store_id = ?
        AND p.status = 'RETURNED'
        AND p.returned_at IS NOT NULL
        AND p.returned_at >= ?
      ORDER BY p.returned_at DESC
    `);

    return stmt.all(storeId, sinceTimestamp) as PackWithDetails[];
  }

  // ==========================================================================
  // Sales Calculation
  // ==========================================================================

  /**
   * Calculate sales for a pack given closing serial
   * Uses effective starting serial (prev day's ending or opening) and game price
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

    // SERIAL CARRYFORWARD: Use previous day's ending as today's starting
    const effectiveStartingSerial = pack.prev_ending_serial || pack.opening_serial;
    if (!effectiveStartingSerial) {
      throw new Error(`Pack has no opening serial: ${packId}`);
    }

    if (!pack.game_price) {
      throw new Error(`Game has no price: ${pack.game_id}`);
    }

    // Calculate tickets sold (closing - effective starting)
    const startingNum = parseInt(effectiveStartingSerial, 10);
    const closingNum = parseInt(closingSerial, 10);

    if (isNaN(startingNum) || isNaN(closingNum)) {
      throw new Error('Invalid serial number format');
    }

    const ticketsSold = closingNum - startingNum;

    if (ticketsSold < 0) {
      throw new Error('Closing serial cannot be less than starting serial');
    }

    const salesAmount = ticketsSold * pack.game_price;

    return { ticketsSold, salesAmount };
  }

  // ==========================================================================
  // Utility Operations
  // ==========================================================================

  /**
   * Move pack to a different bin
   * Only for ACTIVE packs
   * SEC-006: Parameterized UPDATE
   *
   * @param packId - Pack ID
   * @param newBinId - New bin ID
   * @returns Updated pack or throws error
   */
  moveToBin(packId: string, newCurrentBinId: string): LotteryPack {
    const pack = this.findById(packId);

    if (!pack) {
      throw new Error(`Pack not found: ${packId}`);
    }

    if (pack.status !== 'ACTIVE') {
      throw new Error(`Cannot move pack with status ${pack.status}. Pack must be ACTIVE.`);
    }
    // v029 API Alignment: Uses current_bin_id
    const stmt = this.db.prepare(`
      UPDATE lottery_packs SET current_bin_id = ?, updated_at = ?
      WHERE pack_id = ? AND status = 'ACTIVE'
    `);

    const result = stmt.run(newCurrentBinId, this.now(), packId);

    if (result.changes === 0) {
      throw new Error('Failed to move pack');
    }

    log.info('Lottery pack moved', { packId, newCurrentBinId });

    const updated = this.findById(packId);
    if (!updated) {
      throw new Error(`Failed to retrieve moved pack: ${packId}`);
    }
    return updated;
  }

  /**
   * Update opening serial (correction)
   * Only for ACTIVE packs
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

    if (pack.status !== 'ACTIVE') {
      throw new Error('Can only update opening serial on ACTIVE packs');
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

  // ==========================================================================
  // Cloud Sync Operations
  // ==========================================================================

  /**
   * Upsert a pack from cloud data (pull operation)
   *
   * Enterprise-grade implementation for cloud sync:
   * - Matches by pack_id (primary) or pack_number+game_id (fallback)
   * - Updates existing records with cloud data
   * - Creates new records for unknown packs
   * - Validates store_id for tenant isolation
   *
   * Note: After cloud_id consolidation, pack_id IS the cloud ID
   *
   * Field names match cloud API exactly per replica_end_points.md:
   * - current_bin_id: UUID of bin pack is currently in
   * - tickets_sold_count: Total tickets sold
   *
   * @security SEC-006: Parameterized queries prevent SQL injection
   * @security DB-006: Store-scoped operations for tenant isolation
   *
   * @param data - Cloud pack data with all fields matching API schema
   * @param storeId - Store ID for tenant isolation validation
   * @returns Created or updated pack
   */
  upsertFromCloud(
    data: {
      pack_id: string;
      store_id: string;
      game_id: string;
      pack_number: string;
      status: LotteryPackStatus;
      /** Current bin UUID - matches API field name per replica_end_points.md */
      current_bin_id?: string | null;
      opening_serial?: string | null;
      closing_serial?: string | null;
      /** Serial range from cloud API per replica_end_points.md */
      serial_start?: string | null;
      serial_end?: string | null;
      /** Total tickets sold - matches API field name per replica_end_points.md */
      tickets_sold_count?: number | null;
      /** Timestamp of last ticket sold - matches API field name per replica_end_points.md */
      last_sold_at?: string | null;
      sales_amount?: number | null;
      received_at?: string | null;
      received_by?: string | null;
      activated_at?: string | null;
      activated_by?: string | null;
      activated_shift_id?: string | null;
      depleted_at?: string | null;
      depleted_by?: string | null;
      depleted_shift_id?: string | null;
      depletion_reason?: string | null;
      returned_at?: string | null;
      returned_by?: string | null;
      returned_shift_id?: string | null;
      return_reason?: string | null;
      return_notes?: string | null;
      last_sold_serial?: string | null;
      tickets_sold_on_return?: number | null;
      return_sales_amount?: number | null;
      /** Serial override approval fields (API v029 + v038 alignment) */
      serial_override_approved_by?: string | null;
      serial_override_reason?: string | null;
      serial_override_approved_at?: string | null;
      mark_sold_approved_by?: string | null;
      mark_sold_reason?: string | null;
      mark_sold_approved_at?: string | null;
      created_at?: string;
      updated_at?: string;
    },
    storeId: string
  ): LotteryPack {
    // DB-006: Validate tenant isolation
    if (data.store_id !== storeId) {
      throw new Error('Store ID mismatch - tenant isolation violation');
    }

    const now = this.now();

    // First try to find by pack_id (which is now the cloud ID)
    let existing = this.findById(data.pack_id);

    // Fallback: find by pack_number + game_id in same store
    if (!existing) {
      existing = this.findByPackNumber(storeId, data.game_id, data.pack_number);
    }

    if (existing) {
      // DB-006: Verify existing pack belongs to this store
      if (existing.store_id !== storeId) {
        throw new Error('Pack belongs to different store - tenant isolation violation');
      }

      // Store existing state for audit logging
      const existingStatus = existing.status;
      const existingUpdatedAt = existing.updated_at;

      // Update existing pack with cloud data
      // SEC-006: Parameterized UPDATE - all values bound, no string concatenation
      // Field names match cloud API exactly per replica_end_points.md
      //
      // LOTTERY-SYNC-002 FIX: Status protection logic (updated for cross-device returns)
      // Business rules:
      //   Rule 1: Terminal states (DEPLETED/RETURNED) are locked locally - cannot change
      //   Rule 2: ACTIVE cannot regress to RECEIVED (prevents sync race condition)
      //   Rule 3: ACTIVE can progress to terminal states (RETURNED/DEPLETED) - always accept from cloud
      //           This handles cross-device returns where cloud marks pack returned but local has newer timestamp
      //   Rule 4: For other valid transitions, only accept if cloud data is newer (timestamp comparison)
      const stmt = this.db.prepare(`
        UPDATE lottery_packs SET
          status = CASE
            -- Rule 1: Terminal states (DEPLETED/RETURNED) are locked locally - cannot change
            WHEN status IN ('DEPLETED', 'RETURNED') THEN status
            -- Rule 2: ACTIVE cannot regress to RECEIVED (business rule - prevents sync race condition)
            WHEN status = 'ACTIVE' AND ? = 'RECEIVED' THEN status
            -- Rule 3: ACTIVE can always progress to terminal states from cloud (cross-device returns/depletions)
            WHEN status = 'ACTIVE' AND ? IN ('RETURNED', 'DEPLETED') THEN ?
            -- Rule 4: For other valid transitions, only accept if cloud data is newer
            WHEN ? > updated_at THEN ?
            -- Otherwise keep existing status (stale cloud data)
            ELSE status
          END,
          -- FK columns: Use validated value directly (don't COALESCE to preserve invalid FKs)
          -- API-001: FKs validated before upsert, null means entity doesn't exist locally
          current_bin_id = ?,
          opening_serial = COALESCE(?, opening_serial),
          closing_serial = COALESCE(?, closing_serial),
          serial_start = COALESCE(?, serial_start),
          serial_end = COALESCE(?, serial_end),
          tickets_sold_count = COALESCE(?, tickets_sold_count),
          last_sold_at = COALESCE(?, last_sold_at),
          sales_amount = COALESCE(?, sales_amount),
          received_at = COALESCE(?, received_at),
          received_by = ?,
          activated_at = COALESCE(?, activated_at),
          activated_by = ?,
          activated_shift_id = ?,
          depleted_at = COALESCE(?, depleted_at),
          depleted_by = ?,
          depleted_shift_id = ?,
          depletion_reason = COALESCE(?, depletion_reason),
          returned_at = COALESCE(?, returned_at),
          returned_by = ?,
          returned_shift_id = ?,
          return_reason = COALESCE(?, return_reason),
          return_notes = COALESCE(?, return_notes),
          last_sold_serial = COALESCE(?, last_sold_serial),
          tickets_sold_on_return = COALESCE(?, tickets_sold_on_return),
          return_sales_amount = COALESCE(?, return_sales_amount),
          serial_override_approved_by = ?,
          serial_override_reason = COALESCE(?, serial_override_reason),
          serial_override_approved_at = COALESCE(?, serial_override_approved_at),
          mark_sold_approved_by = ?,
          mark_sold_reason = COALESCE(?, mark_sold_reason),
          mark_sold_approved_at = COALESCE(?, mark_sold_approved_at),
          synced_at = ?,
          updated_at = ?
        WHERE pack_id = ? AND store_id = ?
      `);

      stmt.run(
        // LOTTERY-SYNC-002: Status protection CASE parameters
        data.status, // Rule 2: ACTIVE regression check (? = 'RECEIVED')
        data.status, // Rule 3: Terminal state check (? IN ('RETURNED', 'DEPLETED'))
        data.status, // Rule 3: THEN value (accept terminal state from cloud)
        data.updated_at ?? null, // Rule 4: timestamp comparison (? > updated_at)
        data.status, // Rule 4: THEN value (new status if newer)
        data.current_bin_id ?? null,
        data.opening_serial ?? null,
        data.closing_serial ?? null,
        data.serial_start ?? null,
        data.serial_end ?? null,
        data.tickets_sold_count ?? null,
        data.last_sold_at ?? null,
        data.sales_amount ?? null,
        data.received_at ?? null,
        data.received_by ?? null,
        data.activated_at ?? null,
        data.activated_by ?? null,
        data.activated_shift_id ?? null,
        data.depleted_at ?? null,
        data.depleted_by ?? null,
        data.depleted_shift_id ?? null,
        data.depletion_reason ?? null,
        data.returned_at ?? null,
        data.returned_by ?? null,
        data.returned_shift_id ?? null,
        data.return_reason ?? null,
        data.return_notes ?? null,
        data.last_sold_serial ?? null,
        data.tickets_sold_on_return ?? null,
        data.return_sales_amount ?? null,
        data.serial_override_approved_by ?? null,
        data.serial_override_reason ?? null,
        data.serial_override_approved_at ?? null,
        data.mark_sold_approved_by ?? null,
        data.mark_sold_reason ?? null,
        data.mark_sold_approved_at ?? null,
        now,
        now,
        existing.pack_id,
        storeId
      );

      // Retrieve updated pack to check final status
      const updated = this.findById(existing.pack_id);

      // LOTTERY-SYNC-002: Audit logging for blocked status updates
      if (updated && updated.status !== data.status) {
        // Status update was blocked - determine reason for audit trail
        let blockReason: string;
        if (existingStatus === 'ACTIVE' && data.status === 'RECEIVED') {
          blockReason = 'ACTIVE_REGRESSION_BLOCKED';
        } else if (['DEPLETED', 'RETURNED'].includes(existingStatus)) {
          blockReason = 'TERMINAL_STATE_LOCKED';
        } else {
          // Note: ACTIVE→RETURNED/DEPLETED should now be allowed via Rule 3
          // If we hit this, it means cloud sent a different non-terminal status
          blockReason = 'STALE_CLOUD_DATA';
        }

        log.info('Pack status update blocked by sync protection', {
          packId: existing.pack_id,
          cloudStatus: data.status,
          cloudUpdatedAt: data.updated_at,
          localStatus: updated.status,
          localUpdatedAt: existingUpdatedAt,
          reason: blockReason,
        });
      } else {
        log.debug('Pack updated from cloud', {
          packId: existing.pack_id,
          status: data.status,
        });
      }

      if (!updated) {
        throw new Error(`Failed to retrieve updated pack: ${existing.pack_id}`);
      }
      return updated;
    } else {
      // Create new pack from cloud data - pack_id is the cloud ID
      // SEC-006: Parameterized INSERT - all values bound, no string concatenation
      // Field names match cloud API exactly per replica_end_points.md
      const stmt = this.db.prepare(`
        INSERT INTO lottery_packs (
          pack_id, store_id, game_id, pack_number, status,
          current_bin_id, opening_serial, closing_serial,
          serial_start, serial_end, tickets_sold_count, last_sold_at, sales_amount,
          received_at, received_by,
          activated_at, activated_by, activated_shift_id,
          depleted_at, depleted_by, depleted_shift_id, depletion_reason,
          returned_at, returned_by, returned_shift_id,
          return_reason, return_notes,
          last_sold_serial, tickets_sold_on_return, return_sales_amount,
          serial_override_approved_by, serial_override_reason, serial_override_approved_at,
          mark_sold_approved_by, mark_sold_reason, mark_sold_approved_at,
          synced_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        data.pack_id,
        storeId,
        data.game_id,
        data.pack_number,
        data.status,
        data.current_bin_id ?? null,
        data.opening_serial ?? null,
        data.closing_serial ?? null,
        data.serial_start ?? null,
        data.serial_end ?? null,
        data.tickets_sold_count ?? 0, // NOT NULL DEFAULT 0
        data.last_sold_at ?? null,
        data.sales_amount ?? 0, // NOT NULL DEFAULT 0
        data.received_at ?? null,
        data.received_by ?? null,
        data.activated_at ?? null,
        data.activated_by ?? null,
        data.activated_shift_id ?? null,
        data.depleted_at ?? null,
        data.depleted_by ?? null,
        data.depleted_shift_id ?? null,
        data.depletion_reason ?? null,
        data.returned_at ?? null,
        data.returned_by ?? null,
        data.returned_shift_id ?? null,
        data.return_reason ?? null,
        data.return_notes ?? null,
        data.last_sold_serial ?? null,
        data.tickets_sold_on_return ?? null,
        data.return_sales_amount ?? null,
        data.serial_override_approved_by ?? null,
        data.serial_override_reason ?? null,
        data.serial_override_approved_at ?? null,
        data.mark_sold_approved_by ?? null,
        data.mark_sold_reason ?? null,
        data.mark_sold_approved_at ?? null,
        now,
        data.created_at ?? now,
        now
      );

      log.info('Pack created from cloud', {
        packId: data.pack_id,
        packNumber: data.pack_number,
        status: data.status,
      });

      const created = this.findById(data.pack_id);
      if (!created) {
        throw new Error(`Failed to retrieve created pack: ${data.pack_id}`);
      }
      return created;
    }
  }

  /**
   * Batch upsert packs from cloud (optimized for bulk sync)
   *
   * Uses SQLite transaction for atomicity and performance.
   * Each pack is validated for tenant isolation before upsert.
   *
   * Note: After cloud_id consolidation, pack_id IS the cloud ID
   *
   * @security SEC-006: Parameterized queries prevent SQL injection
   * @security DB-006: Store-scoped operations for tenant isolation
   *
   * @param packs - Array of cloud pack data matching API schema per replica_end_points.md
   * @param storeId - Store ID for tenant isolation validation
   * @returns Result with counts and any errors
   */
  batchUpsertFromCloud(
    packs: Array<{
      pack_id: string;
      store_id: string;
      game_id: string;
      pack_number: string;
      status: LotteryPackStatus;
      /** Current bin UUID - matches API field name per replica_end_points.md */
      current_bin_id?: string | null;
      opening_serial?: string | null;
      closing_serial?: string | null;
      /** Serial range from cloud API per replica_end_points.md */
      serial_start?: string | null;
      serial_end?: string | null;
      /** Total tickets sold - matches API field name per replica_end_points.md */
      tickets_sold_count?: number | null;
      /** Timestamp of last ticket sold - matches API field name per replica_end_points.md */
      last_sold_at?: string | null;
      sales_amount?: number | null;
      received_at?: string | null;
      received_by?: string | null;
      activated_at?: string | null;
      activated_by?: string | null;
      activated_shift_id?: string | null;
      depleted_at?: string | null;
      depleted_by?: string | null;
      depleted_shift_id?: string | null;
      depletion_reason?: string | null;
      returned_at?: string | null;
      returned_by?: string | null;
      returned_shift_id?: string | null;
      return_reason?: string | null;
      return_notes?: string | null;
      last_sold_serial?: string | null;
      tickets_sold_on_return?: number | null;
      return_sales_amount?: number | null;
      /** Serial override approval fields (API v029 + v038 alignment) */
      serial_override_approved_by?: string | null;
      serial_override_reason?: string | null;
      serial_override_approved_at?: string | null;
      mark_sold_approved_by?: string | null;
      mark_sold_reason?: string | null;
      mark_sold_approved_at?: string | null;
      created_at?: string;
      updated_at?: string;
    }>,
    storeId: string
  ): { created: number; updated: number; errors: string[]; missingGames: string[] } {
    const result = { created: 0, updated: 0, errors: [] as string[], missingGames: [] as string[] };

    if (packs.length === 0) {
      return result;
    }

    // Pre-check: Collect all unique game_ids from packs
    const gameIds = [...new Set(packs.map((p) => p.game_id))];

    // Check which games exist locally
    const existingGamesStmt = this.db.prepare(`
      SELECT game_id FROM lottery_games WHERE game_id IN (${gameIds.map(() => '?').join(',')})
    `);
    const existingGames = new Set(
      (existingGamesStmt.all(...gameIds) as { game_id: string }[]).map((g) => g.game_id)
    );

    // Log missing games for debugging
    const missingGameIds = gameIds.filter((id) => !existingGames.has(id));
    if (missingGameIds.length > 0) {
      log.warn('Pack sync: Some game_ids not found in local database', {
        missingGameIds,
        totalGameIds: gameIds.length,
        existingGameIds: [...existingGames],
      });
      result.missingGames = missingGameIds;
    }

    // Use transaction for atomicity and performance
    const transaction = this.db.transaction(() => {
      for (const pack of packs) {
        try {
          // DB-006: Validate tenant isolation
          if (pack.store_id !== storeId) {
            result.errors.push(`Pack ${pack.pack_number}: store_id mismatch`);
            continue;
          }

          // Check if game exists locally before attempting upsert
          if (!existingGames.has(pack.game_id)) {
            result.errors.push(
              `Pack ${pack.pack_number}: game_id ${pack.game_id} not found locally (needs game sync)`
            );
            log.error('Pack upsert skipped - game not found', {
              packNumber: pack.pack_number,
              packId: pack.pack_id,
              gameId: pack.game_id,
            });
            continue;
          }

          const existing = this.findById(pack.pack_id);

          try {
            this.upsertFromCloud(pack, storeId);
          } catch (upsertError) {
            // FK constraint failures can occur if existing record has corrupt FKs
            // from before validation was added. Delete and retry INSERT.
            const upsertMsg = upsertError instanceof Error ? upsertError.message : 'Unknown error';
            if (upsertMsg.includes('FOREIGN KEY constraint failed') && existing) {
              log.warn('FK constraint failed on existing pack, deleting and re-inserting', {
                packId: pack.pack_id,
                packNumber: pack.pack_number,
                existingStatus: existing.status,
                incomingStatus: pack.status,
              });

              // Delete corrupt record
              const deleteStmt = this.db.prepare('DELETE FROM lottery_packs WHERE pack_id = ?');
              deleteStmt.run(pack.pack_id);

              // Re-try insert (not upsert - we know it doesn't exist now)
              this.upsertFromCloud(pack, storeId);
              result.updated++; // Count as update since we replaced existing

              log.info('Pack recovered via delete-and-reinsert', {
                packId: pack.pack_id,
                packNumber: pack.pack_number,
              });
              continue;
            }
            throw upsertError; // Re-throw if not FK constraint or no existing record
          }

          if (existing) {
            result.updated++;
          } else {
            result.created++;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          const errorDetail = `Pack ${pack.pack_number}: ${message}`;
          result.errors.push(errorDetail);

          // DEBUG: Log ALL FK values to identify which one is failing
          if (message.includes('FOREIGN KEY constraint failed')) {
            log.error('FK CONSTRAINT DEBUG - Pack upsert failed with FK error', {
              packNumber: pack.pack_number,
              packId: pack.pack_id,
              status: pack.status,
              // All FK fields - one of these is invalid
              fkFields: {
                game_id: pack.game_id,
                current_bin_id: pack.current_bin_id,
                received_by: pack.received_by,
                activated_by: pack.activated_by,
                activated_shift_id: pack.activated_shift_id,
                depleted_by: pack.depleted_by,
                depleted_shift_id: pack.depleted_shift_id,
                returned_by: pack.returned_by,
                returned_shift_id: pack.returned_shift_id,
                serial_override_approved_by: pack.serial_override_approved_by,
                mark_sold_approved_by: pack.mark_sold_approved_by,
              },
              error: message,
            });
          } else {
            log.error('Pack upsert failed', {
              packNumber: pack.pack_number,
              packId: pack.pack_id,
              gameId: pack.game_id,
              error: message,
            });
          }
        }
      }
    });

    transaction();

    log.info('Batch pack upsert completed', {
      total: packs.length,
      created: result.created,
      updated: result.updated,
      errors: result.errors.length,
      errorDetails: result.errors,
      missingGames: result.missingGames,
    });

    return result;
  }

  /**
   * Find multiple packs by their pack IDs (batch operation)
   * Enterprise-grade: Eliminates N+1 queries during sync
   *
   * Note: After cloud_id consolidation, pack_id IS the cloud ID
   *
   * @security SEC-006: Parameterized query
   * @param packIds - Array of pack IDs (which are now cloud IDs)
   * @returns Map of pack_id to LotteryPack
   */
  findByPackIds(packIds: string[]): Map<string, LotteryPack> {
    const result = new Map<string, LotteryPack>();

    if (packIds.length === 0) {
      return result;
    }

    // SEC-006: Use parameterized placeholders
    const placeholders = packIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_packs
      WHERE pack_id IN (${placeholders})
    `);

    const packs = stmt.all(...packIds) as LotteryPack[];

    for (const pack of packs) {
      result.set(pack.pack_id, pack);
    }

    return result;
  }

  // ==========================================================================
  // Statistics Operations
  // ==========================================================================

  /**
   * Find the earliest pack action date for a store
   *
   * Returns the minimum date among all pack actions (activation, return, depletion).
   * Used to determine the start of the "first-ever business period" when no day close
   * has ever been performed.
   *
   * @security SEC-006: Parameterized query prevents SQL injection
   * @security DB-006: store_id in WHERE clause enforces tenant isolation
   * @performance Uses MIN aggregation on indexed timestamp columns
   *
   * @param storeId - Store identifier for tenant isolation
   * @returns ISO date string (YYYY-MM-DD) of earliest action, or null if no packs exist
   */
  findEarliestPackActionDate(storeId: string): string | null {
    // SEC-006: Fully parameterized query
    // DB-006: store_id enforces tenant isolation in all subqueries
    // Performance: Uses indexed columns (store_id, activated_at, returned_at, depleted_at)
    //              with MIN aggregation for efficient single-row result
    const stmt = this.db.prepare(`
      SELECT MIN(earliest_date) as earliest
      FROM (
        SELECT MIN(activated_at) as earliest_date
        FROM lottery_packs
        WHERE store_id = ? AND activated_at IS NOT NULL
        UNION ALL
        SELECT MIN(returned_at)
        FROM lottery_packs
        WHERE store_id = ? AND returned_at IS NOT NULL
        UNION ALL
        SELECT MIN(depleted_at)
        FROM lottery_packs
        WHERE store_id = ? AND depleted_at IS NOT NULL
      )
    `);

    const result = stmt.get(storeId, storeId, storeId) as { earliest: string | null } | undefined;

    if (!result?.earliest) {
      return null;
    }

    // Extract date portion (YYYY-MM-DD) from ISO timestamp
    return result.earliest.split('T')[0];
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
      ACTIVE: 0,
      DEPLETED: 0,
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
