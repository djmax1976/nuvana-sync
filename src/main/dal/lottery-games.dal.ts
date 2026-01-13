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
export type LotteryGameStatus = 'ACTIVE' | 'INACTIVE';

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
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for lottery game operations
 */
export const lotteryGamesDAL = new LotteryGamesDAL();
