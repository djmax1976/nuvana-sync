/**
 * Lottery Games DAL Unit Tests
 *
 * Tests for lottery game entity operations.
 * Validates SEC-006: Parameterized queries
 * Validates DB-006: Tenant isolation via store_id
 *
 * @module tests/unit/dal/lottery-games
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LotteryGamesDAL,
  type LotteryGame as _LotteryGame,
  type CreateLotteryGameData,
} from '../../../src/main/dal/lottery-games.dal';

// Hoist mock functions so they're available when vi.mock factory runs
const { mockPrepare, mockTransaction } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn((fn: () => unknown) => () => fn()),
}));

vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

// Dynamic import for better-sqlite3 (native module)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Database: any;
let skipTests = false;

// Try to load better-sqlite3 - skip tests if not available (CI environment)
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3');
} catch {
  skipTests = true;
}

describe.skipIf(skipTests)('Lottery Games DAL', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let dal: LotteryGamesDAL;

  beforeEach(() => {
    // Create in-memory database
    db = new Database(':memory:');

    // Create the lottery_games table
    db.exec(`
      CREATE TABLE lottery_games (
        game_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        game_code TEXT NOT NULL,
        name TEXT NOT NULL,
        price REAL,
        tickets_per_pack INTEGER NOT NULL DEFAULT 300,
        pack_value REAL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        cloud_game_id TEXT,
        synced_at TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_lottery_games_store_code ON lottery_games(store_id, game_code) WHERE deleted_at IS NULL;
    `);

    // Create DAL with mocked db
    dal = new LotteryGamesDAL();
    // @ts-expect-error - accessing protected member for testing
    dal.db = db;
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new lottery game', () => {
      const data: CreateLotteryGameData = {
        store_id: 'store-1',
        game_code: '1001',
        name: 'Lucky 7s',
        price: 1,
        tickets_per_pack: 300,
      };

      const game = dal.create(data);

      expect(game).toBeDefined();
      expect(game.game_id).toBeDefined();
      expect(game.store_id).toBe('store-1');
      expect(game.game_code).toBe('1001');
      expect(game.name).toBe('Lucky 7s');
      expect(game.price).toBe(1);
      expect(game.status).toBe('ACTIVE');
    });

    it('should calculate pack_value from price and tickets_per_pack', () => {
      const data: CreateLotteryGameData = {
        store_id: 'store-1',
        game_code: '1002',
        name: 'Cash Explosion',
        price: 2,
        tickets_per_pack: 150,
      };

      const game = dal.create(data);

      expect(game.pack_value).toBe(300); // 2 * 150
    });

    it('should use provided pack_value if given', () => {
      const data: CreateLotteryGameData = {
        store_id: 'store-1',
        game_code: '1003',
        name: 'Diamond Deluxe',
        price: 5,
        tickets_per_pack: 60,
        pack_value: 250, // Custom value
      };

      const game = dal.create(data);

      expect(game.pack_value).toBe(250);
    });

    it('should use provided game_id if given', () => {
      const data: CreateLotteryGameData = {
        game_id: 'custom-id-123',
        store_id: 'store-1',
        game_code: '1004',
        name: 'Golden Jackpot',
        price: 10,
      };

      const game = dal.create(data);

      expect(game.game_id).toBe('custom-id-123');
    });
  });

  describe('update', () => {
    it('should update game properties', () => {
      const game = dal.create({
        store_id: 'store-1',
        game_code: '1001',
        name: 'Lucky 7s',
        price: 1,
      });

      const updated = dal.update(game.game_id, { name: 'Super Lucky 7s', price: 2 });

      expect(updated).toBeDefined();
      expect(updated?.name).toBe('Super Lucky 7s');
      expect(updated?.price).toBe(2);
    });

    it('should return undefined for non-existent game', () => {
      const result = dal.update('non-existent-id', { name: 'Test' });

      expect(result).toBeUndefined();
    });

    it('should update status', () => {
      const game = dal.create({
        store_id: 'store-1',
        game_code: '1001',
        name: 'Lucky 7s',
        price: 1,
      });

      const updated = dal.update(game.game_id, { status: 'INACTIVE' });

      expect(updated?.status).toBe('INACTIVE');
    });
  });

  describe('findActiveByStore (DB-006)', () => {
    it('should return only active games for the specified store', () => {
      // Create games for store-1
      dal.create({ store_id: 'store-1', game_code: '1001', name: 'Game 1', price: 1 });
      dal.create({ store_id: 'store-1', game_code: '1002', name: 'Game 2', price: 2 });

      // Create game for store-2
      dal.create({ store_id: 'store-2', game_code: '1001', name: 'Other Game', price: 1 });

      const games = dal.findActiveByStore('store-1');

      expect(games.length).toBe(2);
      expect(games.every((g) => g.store_id === 'store-1')).toBe(true);
    });

    it('should exclude inactive games', () => {
      const game = dal.create({ store_id: 'store-1', game_code: '1001', name: 'Game 1', price: 1 });
      dal.create({ store_id: 'store-1', game_code: '1002', name: 'Game 2', price: 2 });
      dal.update(game.game_id, { status: 'INACTIVE' });

      const games = dal.findActiveByStore('store-1');

      expect(games.length).toBe(1);
      expect(games[0].game_code).toBe('1002');
    });

    it('should exclude soft-deleted games', () => {
      const game = dal.create({ store_id: 'store-1', game_code: '1001', name: 'Game 1', price: 1 });
      dal.create({ store_id: 'store-1', game_code: '1002', name: 'Game 2', price: 2 });
      dal.softDelete(game.game_id);

      const games = dal.findActiveByStore('store-1');

      expect(games.length).toBe(1);
      expect(games[0].game_code).toBe('1002');
    });
  });

  describe('findByGameCode', () => {
    it('should find game by code within a store', () => {
      dal.create({ store_id: 'store-1', game_code: '1001', name: 'Lucky 7s', price: 1 });

      const game = dal.findByGameCode('store-1', '1001');

      expect(game).toBeDefined();
      expect(game?.name).toBe('Lucky 7s');
    });

    it('should not find game from different store', () => {
      dal.create({ store_id: 'store-1', game_code: '1001', name: 'Lucky 7s', price: 1 });

      const game = dal.findByGameCode('store-2', '1001');

      expect(game).toBeUndefined();
    });

    it('should not find soft-deleted games', () => {
      const game = dal.create({
        store_id: 'store-1',
        game_code: '1001',
        name: 'Lucky 7s',
        price: 1,
      });
      dal.softDelete(game.game_id);

      const found = dal.findByGameCode('store-1', '1001');

      expect(found).toBeUndefined();
    });
  });

  describe('softDelete', () => {
    it('should set deleted_at timestamp', () => {
      const game = dal.create({
        store_id: 'store-1',
        game_code: '1001',
        name: 'Lucky 7s',
        price: 1,
      });

      const result = dal.softDelete(game.game_id);

      expect(result).toBe(true);

      // Verify it's not found in active games
      const found = dal.findActiveByStore('store-1');
      expect(found.length).toBe(0);
    });

    it('should return false for non-existent game', () => {
      const result = dal.softDelete('non-existent-id');

      expect(result).toBe(false);
    });
  });

  describe('restore', () => {
    it('should clear deleted_at timestamp', () => {
      const game = dal.create({
        store_id: 'store-1',
        game_code: '1001',
        name: 'Lucky 7s',
        price: 1,
      });
      dal.softDelete(game.game_id);

      const result = dal.restore(game.game_id);

      expect(result).toBe(true);

      // Verify it's found in active games again
      const found = dal.findActiveByStore('store-1');
      expect(found.length).toBe(1);
    });
  });

  describe('activate/deactivate', () => {
    it('should set status to ACTIVE', () => {
      const game = dal.create({
        store_id: 'store-1',
        game_code: '1001',
        name: 'Lucky 7s',
        price: 1,
      });
      dal.update(game.game_id, { status: 'INACTIVE' });

      const result = dal.activate(game.game_id);

      expect(result).toBe(true);
      const updated = dal.findById(game.game_id);
      expect(updated?.status).toBe('ACTIVE');
    });

    it('should set status to INACTIVE', () => {
      const game = dal.create({
        store_id: 'store-1',
        game_code: '1001',
        name: 'Lucky 7s',
        price: 1,
      });

      const result = dal.deactivate(game.game_id);

      expect(result).toBe(true);
      const updated = dal.findById(game.game_id);
      expect(updated?.status).toBe('INACTIVE');
    });
  });

  describe('upsertFromCloud', () => {
    it('should create new game from cloud data', () => {
      const cloudData = {
        cloud_game_id: 'cloud-123',
        store_id: 'store-1',
        game_code: '1001',
        name: 'Lucky 7s',
        price: 1,
        pack_value: 300,
        tickets_per_pack: 300,
      };

      const game = dal.upsertFromCloud(cloudData);

      expect(game.cloud_game_id).toBe('cloud-123');
      expect(game.synced_at).toBeDefined();
    });

    it('should update existing game matched by cloud_game_id', () => {
      const cloudData = {
        cloud_game_id: 'cloud-123',
        store_id: 'store-1',
        game_code: '1001',
        name: 'Lucky 7s',
        price: 1,
        pack_value: 300,
        tickets_per_pack: 300,
      };

      dal.upsertFromCloud(cloudData);

      // Update with new data
      const updated = dal.upsertFromCloud({
        ...cloudData,
        name: 'Super Lucky 7s',
        price: 2,
      });

      expect(updated.name).toBe('Super Lucky 7s');
      expect(updated.price).toBe(2);

      // Should only have one game
      const allGames = dal.findActiveByStore('store-1');
      expect(allGames.length).toBe(1);
    });
  });

  describe('findById (inherited from BaseDAL)', () => {
    it('should find game by ID', () => {
      const game = dal.create({
        store_id: 'store-1',
        game_code: '1001',
        name: 'Lucky 7s',
        price: 1,
      });

      const found = dal.findById(game.game_id);

      expect(found).toBeDefined();
      expect(found?.game_id).toBe(game.game_id);
    });

    it('should return undefined for non-existent ID', () => {
      const found = dal.findById('non-existent-id');

      expect(found).toBeUndefined();
    });
  });
});
