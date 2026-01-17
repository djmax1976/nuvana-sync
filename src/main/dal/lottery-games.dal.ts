/**
 * Lottery Games Data Access Layer
 *
 * CRUD operations for lottery game management.
 * Games are synced from cloud and define ticket prices and pack configurations.
 *
 * @module main/dal/lottery-games
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Lottery game status
 */
export type LotteryGameStatus = 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';

/**
 * Filter options for games listing
 * SEC-014: Validated enum constraints for status filter
 */
export interface GameListFilters {
  /** Filter by game status */
  status?: LotteryGameStatus;
  /** Search by game name or code (min 2 chars) */
  search?: string;
}

/**
 * Pagination options for games listing
 * SEC-014: Enforces max page size to prevent unbounded reads
 */
export interface GameListPagination {
  /** Number of records per page (max 100) */
  limit?: number;
  /** Number of records to skip */
  offset?: number;
  /** Sort column (must be in allowlist) */
  sortBy?: 'name' | 'game_code' | 'price' | 'status' | 'created_at';
  /** Sort direction */
  sortOrder?: 'ASC' | 'DESC';
}

/**
 * Game with aggregated pack counts
 * API-008: OUTPUT_FILTERING - Controlled response shape
 */
export interface GameWithPackCounts extends LotteryGame {
  /** Total packs ever received for this game */
  total_packs: number;
  /** Currently received but not activated */
  received_packs: number;
  /** Currently active in bins */
  active_packs: number;
  /** Settled/sold packs */
  settled_packs: number;
  /** Returned packs */
  returned_packs: number;
}

/**
 * Paginated games list response
 */
export interface GameListResult {
  games: GameWithPackCounts[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Lottery game entity
 */
export interface LotteryGame extends StoreEntity {
  game_id: string;
  store_id: string;
  game_code: string;
  name: string;
  price: number;
  pack_value: number;
  tickets_per_pack: number | null;
  status: LotteryGameStatus;
  deleted_at: string | null;
  cloud_game_id: string | null;
  state_id: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Game creation data
 */
export interface CreateLotteryGameData {
  game_id?: string;
  store_id: string;
  game_code: string;
  name: string;
  price: number;
  pack_value?: number;
  tickets_per_pack?: number;
  status?: LotteryGameStatus;
  cloud_game_id?: string;
}

/**
 * Game update data
 */
export interface UpdateLotteryGameData {
  game_code?: string;
  name?: string;
  price?: number;
  pack_value?: number;
  tickets_per_pack?: number;
  status?: LotteryGameStatus;
}

/**
 * Cloud game sync data
 */
export interface CloudGameData {
  cloud_game_id: string;
  store_id: string;
  game_code: string;
  name: string;
  price: number;
  pack_value: number;
  tickets_per_pack?: number;
  status?: LotteryGameStatus;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('lottery-games-dal');

// ============================================================================
// Lottery Games DAL
// ============================================================================

/**
 * Data Access Layer for lottery game management
 *
 * SEC-006: All queries use prepared statements
 * DB-006: All queries scoped by store_id
 */
export class LotteryGamesDAL extends StoreBasedDAL<LotteryGame> {
  protected readonly tableName = 'lottery_games';
  protected readonly primaryKey = 'game_id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'name',
    'game_code',
    'price',
    'status',
  ]);

  /**
   * Create a new lottery game
   * SEC-006: Parameterized INSERT
   *
   * @param data - Game creation data
   * @returns Created game
   */
  create(data: CreateLotteryGameData): LotteryGame {
    const gameId = data.game_id || this.generateId();
    const now = this.now();

    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      INSERT INTO lottery_games (
        game_id, store_id, game_code, name, price, pack_value,
        tickets_per_pack, status, cloud_game_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      gameId,
      data.store_id,
      data.game_code,
      data.name,
      data.price,
      data.pack_value || 300,
      data.tickets_per_pack || null,
      data.status || 'ACTIVE',
      data.cloud_game_id || null,
      now,
      now
    );

    log.info('Lottery game created', {
      gameId,
      storeId: data.store_id,
      gameCode: data.game_code,
    });

    const created = this.findById(gameId);
    if (!created) {
      throw new Error(`Failed to retrieve created game: ${gameId}`);
    }
    return created;
  }

  /**
   * Update an existing game
   * SEC-006: Parameterized UPDATE
   *
   * @param gameId - Game ID to update
   * @param data - Fields to update
   * @returns Updated game or undefined
   */
  update(gameId: string, data: UpdateLotteryGameData): LotteryGame | undefined {
    const now = this.now();

    const updates: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (data.game_code !== undefined) {
      updates.push('game_code = ?');
      params.push(data.game_code);
    }
    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.price !== undefined) {
      updates.push('price = ?');
      params.push(data.price);
    }
    if (data.pack_value !== undefined) {
      updates.push('pack_value = ?');
      params.push(data.pack_value);
    }
    if (data.tickets_per_pack !== undefined) {
      updates.push('tickets_per_pack = ?');
      params.push(data.tickets_per_pack);
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(data.status);
    }

    params.push(gameId);

    const stmt = this.db.prepare(`
      UPDATE lottery_games SET ${updates.join(', ')} WHERE game_id = ?
    `);

    const result = stmt.run(...params);

    if (result.changes === 0) {
      return undefined;
    }

    log.info('Lottery game updated', { gameId });
    return this.findById(gameId);
  }

  /**
   * Find active games by store (not deleted)
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @returns Array of active games
   */
  findActiveByStore(storeId: string): LotteryGame[] {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_games
      WHERE store_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL
      ORDER BY name ASC
    `);
    return stmt.all(storeId) as LotteryGame[];
  }

  /**
   * Find all games by store (including inactive, excluding deleted)
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @returns Array of games
   */
  findAllByStore(storeId: string): LotteryGame[] {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_games
      WHERE store_id = ? AND deleted_at IS NULL
      ORDER BY name ASC
    `);
    return stmt.all(storeId) as LotteryGame[];
  }

  /**
   * Find game by game code within a store
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param gameCode - Game code to search
   * @returns Game or undefined
   */
  findByGameCode(storeId: string, gameCode: string): LotteryGame | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_games
      WHERE store_id = ? AND game_code = ? AND deleted_at IS NULL
    `);
    return stmt.get(storeId, gameCode) as LotteryGame | undefined;
  }

  /**
   * Find game by cloud ID
   * Used for cloud sync matching
   * SEC-006: Parameterized query
   *
   * @param cloudGameId - Cloud game identifier
   * @returns Game or undefined
   */
  findByCloudId(cloudGameId: string): LotteryGame | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_games WHERE cloud_game_id = ?
    `);
    return stmt.get(cloudGameId) as LotteryGame | undefined;
  }

  /**
   * Upsert game from cloud sync
   * Creates if not exists, updates if exists (by cloud_game_id)
   * SEC-006: Parameterized queries
   *
   * @param data - Cloud game data
   * @returns Upserted game
   */
  upsertFromCloud(data: CloudGameData): LotteryGame {
    const existing = this.findByCloudId(data.cloud_game_id);
    const now = this.now();

    if (existing) {
      // Update existing game
      const stmt = this.db.prepare(`
        UPDATE lottery_games SET
          game_code = ?,
          name = ?,
          price = ?,
          pack_value = ?,
          tickets_per_pack = ?,
          status = ?,
          synced_at = ?,
          updated_at = ?
        WHERE cloud_game_id = ?
      `);

      stmt.run(
        data.game_code,
        data.name,
        data.price,
        data.pack_value,
        data.tickets_per_pack || null,
        data.status || 'ACTIVE',
        now,
        now,
        data.cloud_game_id
      );

      log.info('Lottery game updated from cloud', { cloudGameId: data.cloud_game_id });
      const updated = this.findByCloudId(data.cloud_game_id);
      if (!updated) {
        throw new Error(`Failed to retrieve updated game from cloud: ${data.cloud_game_id}`);
      }
      return updated;
    }

    // Create new game
    const gameId = this.generateId();

    const stmt = this.db.prepare(`
      INSERT INTO lottery_games (
        game_id, store_id, game_code, name, price, pack_value,
        tickets_per_pack, status, cloud_game_id, synced_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      gameId,
      data.store_id,
      data.game_code,
      data.name,
      data.price,
      data.pack_value,
      data.tickets_per_pack || null,
      data.status || 'ACTIVE',
      data.cloud_game_id,
      now,
      now,
      now
    );

    log.info('Lottery game created from cloud', {
      gameId,
      cloudGameId: data.cloud_game_id,
    });

    const created = this.findById(gameId);
    if (!created) {
      throw new Error(`Failed to retrieve created game from cloud: ${gameId}`);
    }
    return created;
  }

  /**
   * Soft delete a game (set deleted_at)
   * Preserves history for audit trail
   * SEC-006: Parameterized UPDATE
   *
   * @param gameId - Game ID to delete
   * @returns true if game was deleted
   */
  softDelete(gameId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE lottery_games SET deleted_at = ?, updated_at = ? WHERE game_id = ? AND deleted_at IS NULL
    `);
    const now = this.now();
    const result = stmt.run(now, now, gameId);

    if (result.changes > 0) {
      log.info('Lottery game soft deleted', { gameId });
      return true;
    }
    return false;
  }

  /**
   * Restore a soft-deleted game
   * SEC-006: Parameterized UPDATE
   *
   * @param gameId - Game ID to restore
   * @returns true if game was restored
   */
  restore(gameId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE lottery_games SET deleted_at = NULL, updated_at = ? WHERE game_id = ?
    `);
    const result = stmt.run(this.now(), gameId);

    if (result.changes > 0) {
      log.info('Lottery game restored', { gameId });
      return true;
    }
    return false;
  }

  /**
   * Set game status to inactive
   * SEC-006: Parameterized UPDATE
   *
   * @param gameId - Game ID
   * @returns true if game was deactivated
   */
  deactivate(gameId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE lottery_games SET status = 'INACTIVE', updated_at = ? WHERE game_id = ?
    `);
    const result = stmt.run(this.now(), gameId);
    return result.changes > 0;
  }

  /**
   * Set game status to active
   * SEC-006: Parameterized UPDATE
   *
   * @param gameId - Game ID
   * @returns true if game was activated
   */
  activate(gameId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE lottery_games SET status = 'ACTIVE', updated_at = ? WHERE game_id = ?
    `);
    const result = stmt.run(this.now(), gameId);
    return result.changes > 0;
  }

  /**
   * Calculate tickets per pack from pack value and price
   *
   * @param packValue - Total pack value
   * @param price - Ticket price
   * @returns Number of tickets per pack
   */
  static calculateTicketsPerPack(packValue: number, price: number): number {
    if (price <= 0) return 0;
    return Math.floor(packValue / price);
  }

  // ==========================================================================
  // Games Listing with Pack Counts
  // ==========================================================================

  /** Maximum allowed page size for games listing */
  private static readonly MAX_GAMES_PAGE_SIZE = 100;

  /** Default page size for games listing */
  private static readonly DEFAULT_GAMES_PAGE_SIZE = 50;

  /** Allowed sort columns for games listing (SEC-006: SQL injection prevention) */
  private static readonly GAMES_SORT_COLUMNS = new Set([
    'name',
    'game_code',
    'price',
    'status',
    'created_at',
  ]);

  /**
   * List games with aggregated pack counts
   *
   * Enterprise-grade query with:
   * - DB-006: Tenant isolation via store_id
   * - SEC-006: Parameterized queries prevent SQL injection
   * - Performance: Single query with LEFT JOIN and GROUP BY for efficient aggregation
   * - Bounded reads: Enforced max page size
   *
   * @param storeId - Store identifier for tenant isolation
   * @param filters - Optional filter criteria
   * @param pagination - Optional pagination and sorting
   * @returns Paginated games with pack counts
   */
  listGamesWithPackCounts(
    storeId: string,
    filters: GameListFilters = {},
    pagination: GameListPagination = {}
  ): GameListResult {
    // Enforce pagination limits to prevent unbounded reads
    const limit = Math.min(
      pagination.limit || LotteryGamesDAL.DEFAULT_GAMES_PAGE_SIZE,
      LotteryGamesDAL.MAX_GAMES_PAGE_SIZE
    );
    const offset = Math.max(pagination.offset || 0, 0);

    // Validate sort column against allowlist (SEC-006)
    const sortBy =
      pagination.sortBy && LotteryGamesDAL.GAMES_SORT_COLUMNS.has(pagination.sortBy)
        ? pagination.sortBy
        : 'name';

    // Validate sort direction (SEC-006)
    const sortOrder = pagination.sortOrder === 'DESC' ? 'DESC' : 'ASC';

    // Build WHERE conditions (SEC-006: parameterized)
    const conditions: string[] = ['g.store_id = ?', 'g.deleted_at IS NULL'];
    const params: unknown[] = [storeId];

    // Status filter (SEC-014: validated enum)
    if (filters.status) {
      conditions.push('g.status = ?');
      params.push(filters.status);
    }

    // Search filter (SEC-006: parameterized LIKE with escaped input)
    if (filters.search && filters.search.length >= 2) {
      // Escape special LIKE characters to prevent pattern injection
      const escapedSearch = filters.search.replace(/[%_\\]/g, '\\$&');
      conditions.push('(g.name LIKE ? ESCAPE \'\\\' OR g.game_code LIKE ? ESCAPE \'\\\')');
      params.push(`%${escapedSearch}%`, `%${escapedSearch}%`);
    }

    const whereClause = conditions.join(' AND ');

    // Count query for pagination (SEC-006: parameterized)
    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM lottery_games g
      WHERE ${whereClause}
    `);
    const countResult = countStmt.get(...params) as { count: number };
    const total = countResult.count;

    // Main query with pack counts aggregation
    // Performance: Single indexed JOIN with conditional aggregation
    // SEC-006: All user input is parameterized, sort column validated against allowlist
    const dataStmt = this.db.prepare(`
      SELECT
        g.game_id,
        g.store_id,
        g.game_code,
        g.name,
        g.price,
        g.pack_value,
        g.tickets_per_pack,
        g.status,
        g.deleted_at,
        g.cloud_game_id,
        g.state_id,
        g.synced_at,
        g.created_at,
        g.updated_at,
        COALESCE(COUNT(p.pack_id), 0) as total_packs,
        COALESCE(SUM(CASE WHEN p.status = 'RECEIVED' THEN 1 ELSE 0 END), 0) as received_packs,
        COALESCE(SUM(CASE WHEN p.status = 'ACTIVATED' THEN 1 ELSE 0 END), 0) as active_packs,
        COALESCE(SUM(CASE WHEN p.status = 'SETTLED' THEN 1 ELSE 0 END), 0) as settled_packs,
        COALESCE(SUM(CASE WHEN p.status = 'RETURNED' THEN 1 ELSE 0 END), 0) as returned_packs
      FROM lottery_games g
      LEFT JOIN lottery_packs p ON g.game_id = p.game_id AND p.store_id = g.store_id
      WHERE ${whereClause}
      GROUP BY g.game_id
      ORDER BY g.${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `);

    // Add pagination params
    const games = dataStmt.all(...params, limit, offset) as GameWithPackCounts[];

    log.debug('Games listed with pack counts', {
      storeId,
      filters,
      total,
      returned: games.length,
    });

    return {
      games,
      total,
      limit,
      offset,
      hasMore: offset + games.length < total,
    };
  }

  /**
   * Get a single game by ID with pack counts
   * DB-006: Store-scoped query for tenant isolation
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param gameId - Game UUID
   * @returns Game with pack counts or undefined
   */
  findByIdWithPackCounts(storeId: string, gameId: string): GameWithPackCounts | undefined {
    const stmt = this.db.prepare(`
      SELECT
        g.game_id,
        g.store_id,
        g.game_code,
        g.name,
        g.price,
        g.pack_value,
        g.tickets_per_pack,
        g.status,
        g.deleted_at,
        g.cloud_game_id,
        g.state_id,
        g.synced_at,
        g.created_at,
        g.updated_at,
        COALESCE(COUNT(p.pack_id), 0) as total_packs,
        COALESCE(SUM(CASE WHEN p.status = 'RECEIVED' THEN 1 ELSE 0 END), 0) as received_packs,
        COALESCE(SUM(CASE WHEN p.status = 'ACTIVATED' THEN 1 ELSE 0 END), 0) as active_packs,
        COALESCE(SUM(CASE WHEN p.status = 'SETTLED' THEN 1 ELSE 0 END), 0) as settled_packs,
        COALESCE(SUM(CASE WHEN p.status = 'RETURNED' THEN 1 ELSE 0 END), 0) as returned_packs
      FROM lottery_games g
      LEFT JOIN lottery_packs p ON g.game_id = p.game_id AND p.store_id = g.store_id
      WHERE g.game_id = ? AND g.store_id = ? AND g.deleted_at IS NULL
      GROUP BY g.game_id
    `);

    return stmt.get(gameId, storeId) as GameWithPackCounts | undefined;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for lottery game operations
 */
export const lotteryGamesDAL = new LotteryGamesDAL();
