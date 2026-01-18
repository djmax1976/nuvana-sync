/**
 * Lottery Games DAL Unit Tests
 *
 * Tests for lottery game entity operations.
 * Validates SEC-006: Parameterized queries
 * Validates DB-006: Tenant isolation via store_id
 *
 * @module tests/unit/dal/lottery-games
 */

// Uses vitest globals (configured in vitest.config.ts)
import {
  LotteryGamesDAL,
  type LotteryGame as _LotteryGame,
  type CreateLotteryGameData,
} from '../../../src/main/dal/lottery-games.dal';

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

// Shared test database instance - will be set in beforeEach and used by mock
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let testDb: any = null;

// Mock database service to return our in-memory test database
vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => testDb),
  isDatabaseInitialized: vi.fn(() => testDb !== null),
}));

describe.skipIf(skipTests)('Lottery Games DAL', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let dal: LotteryGamesDAL;

  beforeEach(() => {
    // Create in-memory database
    db = new Database(':memory:');
    // Set the shared test database so the mock returns it
    testDb = db;

    // Create the lottery_games table (matching DAL expected schema)
    db.exec(`
      CREATE TABLE lottery_games (
        game_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        game_code TEXT NOT NULL,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        pack_value REAL NOT NULL DEFAULT 300,
        tickets_per_pack INTEGER,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        state_id TEXT,
        cloud_game_id TEXT,
        synced_at TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_lottery_games_store_code ON lottery_games(store_id, game_code) WHERE deleted_at IS NULL;

      CREATE TABLE lottery_packs (
        pack_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        game_id TEXT NOT NULL,
        pack_number TEXT NOT NULL,
        bin_id TEXT,
        status TEXT NOT NULL DEFAULT 'RECEIVED',
        received_at TEXT,
        activated_at TEXT,
        settled_at TEXT,
        returned_at TEXT,
        opening_serial TEXT,
        closing_serial TEXT,
        tickets_sold INTEGER NOT NULL DEFAULT 0,
        sales_amount REAL NOT NULL DEFAULT 0,
        cloud_pack_id TEXT,
        synced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(store_id, game_id, pack_number)
      );
    `);

    // Create DAL - it will use testDb via the mocked getDatabase()
    dal = new LotteryGamesDAL();
  });

  afterEach(() => {
    db.close();
    testDb = null;
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

  // ==========================================================================
  // listGamesWithPackCounts Tests
  // Enterprise-grade testing for games inventory listing feature
  // SEC-006: Verifies SQL injection prevention
  // DB-006: Verifies tenant isolation
  // API-001: Verifies bounded pagination
  // ==========================================================================
  describe('listGamesWithPackCounts', () => {
    // Helper to set up lottery_packs table for testing pack counts
    beforeEach(() => {
      // Create the lottery_packs table for JOIN tests
      db.exec(`
        CREATE TABLE IF NOT EXISTS lottery_packs (
          pack_id TEXT PRIMARY KEY,
          store_id TEXT NOT NULL,
          game_id TEXT NOT NULL,
          pack_number TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'RECEIVED',
          received_at TEXT,
          activated_at TEXT,
          settled_at TEXT,
          returned_at TEXT,
          deleted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (game_id) REFERENCES lottery_games(game_id)
        );
        CREATE INDEX IF NOT EXISTS idx_lottery_packs_game_id ON lottery_packs(game_id);
        CREATE INDEX IF NOT EXISTS idx_lottery_packs_store_id ON lottery_packs(store_id);
      `);
    });

    // Helper function to create packs for testing
    function createPack(data: {
      store_id: string;
      game_id: string;
      pack_number: string;
      status: 'RECEIVED' | 'ACTIVATED' | 'SETTLED' | 'RETURNED';
    }) {
      const now = new Date().toISOString();
      const packId = `pack-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      db.prepare(
        `
        INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, received_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(packId, data.store_id, data.game_id, data.pack_number, data.status, now, now, now);
      return packId;
    }

    describe('Basic Functionality', () => {
      it('should return games with zero pack counts when no packs exist', () => {
        dal.create({
          store_id: 'store-1',
          game_code: '1001',
          name: 'Lucky 7s',
          price: 1,
        });

        const result = dal.listGamesWithPackCounts('store-1');

        expect(result.games).toHaveLength(1);
        expect(result.games[0].total_packs).toBe(0);
        expect(result.games[0].received_packs).toBe(0);
        expect(result.games[0].active_packs).toBe(0);
        expect(result.games[0].settled_packs).toBe(0);
        expect(result.games[0].returned_packs).toBe(0);
      });

      it('should correctly aggregate pack counts by status', () => {
        const game = dal.create({
          store_id: 'store-1',
          game_code: '1001',
          name: 'Lucky 7s',
          price: 1,
        });

        // Create packs with various statuses
        createPack({
          store_id: 'store-1',
          game_id: game.game_id,
          pack_number: '001',
          status: 'RECEIVED',
        });
        createPack({
          store_id: 'store-1',
          game_id: game.game_id,
          pack_number: '002',
          status: 'RECEIVED',
        });
        createPack({
          store_id: 'store-1',
          game_id: game.game_id,
          pack_number: '003',
          status: 'ACTIVATED',
        });
        createPack({
          store_id: 'store-1',
          game_id: game.game_id,
          pack_number: '004',
          status: 'ACTIVATED',
        });
        createPack({
          store_id: 'store-1',
          game_id: game.game_id,
          pack_number: '005',
          status: 'ACTIVATED',
        });
        createPack({
          store_id: 'store-1',
          game_id: game.game_id,
          pack_number: '006',
          status: 'SETTLED',
        });
        createPack({
          store_id: 'store-1',
          game_id: game.game_id,
          pack_number: '007',
          status: 'RETURNED',
        });

        const result = dal.listGamesWithPackCounts('store-1');

        expect(result.games).toHaveLength(1);
        expect(result.games[0].total_packs).toBe(7);
        expect(result.games[0].received_packs).toBe(2);
        expect(result.games[0].active_packs).toBe(3);
        expect(result.games[0].settled_packs).toBe(1);
        expect(result.games[0].returned_packs).toBe(1);
      });

      it('should return all game fields along with pack counts', () => {
        const game = dal.create({
          store_id: 'store-1',
          game_code: '2001',
          name: 'Cash Explosion',
          price: 5,
          pack_value: 750,
          tickets_per_pack: 150,
          status: 'ACTIVE',
        });

        const result = dal.listGamesWithPackCounts('store-1');

        expect(result.games).toHaveLength(1);
        const returnedGame = result.games[0];
        expect(returnedGame.game_id).toBe(game.game_id);
        expect(returnedGame.game_code).toBe('2001');
        expect(returnedGame.name).toBe('Cash Explosion');
        expect(returnedGame.price).toBe(5);
        expect(returnedGame.pack_value).toBe(750);
        expect(returnedGame.tickets_per_pack).toBe(150);
        expect(returnedGame.status).toBe('ACTIVE');
        expect(returnedGame.created_at).toBeDefined();
        expect(returnedGame.updated_at).toBeDefined();
      });
    });

    describe('Tenant Isolation (DB-006)', () => {
      it('should only return games for the specified store', () => {
        // Create games for store-1
        dal.create({ store_id: 'store-1', game_code: '1001', name: 'Game 1', price: 1 });
        dal.create({ store_id: 'store-1', game_code: '1002', name: 'Game 2', price: 2 });

        // Create games for store-2
        dal.create({ store_id: 'store-2', game_code: '1001', name: 'Other Game 1', price: 1 });
        dal.create({ store_id: 'store-2', game_code: '1003', name: 'Other Game 3', price: 3 });

        const result1 = dal.listGamesWithPackCounts('store-1');
        const result2 = dal.listGamesWithPackCounts('store-2');

        expect(result1.games).toHaveLength(2);
        expect(result1.games.every((g) => g.store_id === 'store-1')).toBe(true);

        expect(result2.games).toHaveLength(2);
        expect(result2.games.every((g) => g.store_id === 'store-2')).toBe(true);
      });

      it('should not include pack counts from other stores', () => {
        // Create same game code in two stores
        const game1 = dal.create({
          store_id: 'store-1',
          game_code: '1001',
          name: 'Game 1',
          price: 1,
        });
        const game2 = dal.create({
          store_id: 'store-2',
          game_code: '1001',
          name: 'Game 1 Other',
          price: 1,
        });

        // Create packs for each store's game
        createPack({
          store_id: 'store-1',
          game_id: game1.game_id,
          pack_number: '001',
          status: 'RECEIVED',
        });
        createPack({
          store_id: 'store-1',
          game_id: game1.game_id,
          pack_number: '002',
          status: 'RECEIVED',
        });
        createPack({
          store_id: 'store-2',
          game_id: game2.game_id,
          pack_number: '001',
          status: 'ACTIVATED',
        });

        const result1 = dal.listGamesWithPackCounts('store-1');
        const result2 = dal.listGamesWithPackCounts('store-2');

        expect(result1.games[0].total_packs).toBe(2);
        expect(result1.games[0].received_packs).toBe(2);
        expect(result1.games[0].active_packs).toBe(0);

        expect(result2.games[0].total_packs).toBe(1);
        expect(result2.games[0].received_packs).toBe(0);
        expect(result2.games[0].active_packs).toBe(1);
      });

      it('should return empty array for non-existent store', () => {
        dal.create({ store_id: 'store-1', game_code: '1001', name: 'Game 1', price: 1 });

        const result = dal.listGamesWithPackCounts('non-existent-store');

        expect(result.games).toHaveLength(0);
        expect(result.total).toBe(0);
      });
    });

    describe('Pagination (SEC-014: Bounded Reads)', () => {
      beforeEach(() => {
        // Create 15 games for pagination testing
        for (let i = 1; i <= 15; i++) {
          dal.create({
            store_id: 'store-1',
            game_code: String(1000 + i).padStart(4, '0'),
            name: `Game ${i}`,
            price: i,
          });
        }
      });

      it('should enforce default page size of 50', () => {
        const result = dal.listGamesWithPackCounts('store-1', {}, {});

        expect(result.limit).toBe(50);
      });

      it('should respect custom limit within allowed range', () => {
        const result = dal.listGamesWithPackCounts('store-1', {}, { limit: 5 });

        expect(result.games).toHaveLength(5);
        expect(result.limit).toBe(5);
        expect(result.total).toBe(15);
        expect(result.hasMore).toBe(true);
      });

      it('should enforce maximum page size of 100', () => {
        // Try to request 200 - should be capped at 100
        const result = dal.listGamesWithPackCounts('store-1', {}, { limit: 200 });

        expect(result.limit).toBe(100);
      });

      it('should correctly calculate offset', () => {
        const page1 = dal.listGamesWithPackCounts('store-1', {}, { limit: 5, offset: 0 });
        const page2 = dal.listGamesWithPackCounts('store-1', {}, { limit: 5, offset: 5 });
        const page3 = dal.listGamesWithPackCounts('store-1', {}, { limit: 5, offset: 10 });

        expect(page1.offset).toBe(0);
        expect(page2.offset).toBe(5);
        expect(page3.offset).toBe(10);

        // Verify different games on each page
        const page1GameCodes = page1.games.map((g) => g.game_code);
        const page2GameCodes = page2.games.map((g) => g.game_code);
        const page3GameCodes = page3.games.map((g) => g.game_code);

        expect(page1GameCodes.some((c) => page2GameCodes.includes(c))).toBe(false);
        expect(page2GameCodes.some((c) => page3GameCodes.includes(c))).toBe(false);
      });

      it('should correctly set hasMore flag', () => {
        const page1 = dal.listGamesWithPackCounts('store-1', {}, { limit: 5, offset: 0 });
        const page2 = dal.listGamesWithPackCounts('store-1', {}, { limit: 5, offset: 5 });
        const page3 = dal.listGamesWithPackCounts('store-1', {}, { limit: 5, offset: 10 });
        const page4 = dal.listGamesWithPackCounts('store-1', {}, { limit: 5, offset: 15 });

        expect(page1.hasMore).toBe(true);
        expect(page2.hasMore).toBe(true);
        expect(page3.hasMore).toBe(false); // Exactly at the end
        expect(page4.hasMore).toBe(false); // Beyond the end
      });

      it('should handle negative offset by treating as 0', () => {
        const result = dal.listGamesWithPackCounts('store-1', {}, { limit: 5, offset: -10 });

        expect(result.offset).toBe(0);
      });

      it('should return empty games when offset exceeds total', () => {
        const result = dal.listGamesWithPackCounts('store-1', {}, { limit: 5, offset: 100 });

        expect(result.games).toHaveLength(0);
        expect(result.total).toBe(15);
        expect(result.hasMore).toBe(false);
      });
    });

    describe('Status Filter', () => {
      beforeEach(() => {
        dal.create({
          store_id: 'store-1',
          game_code: '1001',
          name: 'Active Game 1',
          price: 1,
          status: 'ACTIVE',
        });
        dal.create({
          store_id: 'store-1',
          game_code: '1002',
          name: 'Active Game 2',
          price: 2,
          status: 'ACTIVE',
        });
        dal.create({
          store_id: 'store-1',
          game_code: '1003',
          name: 'Inactive Game',
          price: 3,
          status: 'INACTIVE',
        });
        dal.create({
          store_id: 'store-1',
          game_code: '1004',
          name: 'Discontinued Game',
          price: 5,
          status: 'DISCONTINUED',
        });
      });

      it('should filter by ACTIVE status', () => {
        const result = dal.listGamesWithPackCounts('store-1', { status: 'ACTIVE' });

        expect(result.games).toHaveLength(2);
        expect(result.games.every((g) => g.status === 'ACTIVE')).toBe(true);
        expect(result.total).toBe(2);
      });

      it('should filter by INACTIVE status', () => {
        const result = dal.listGamesWithPackCounts('store-1', { status: 'INACTIVE' });

        expect(result.games).toHaveLength(1);
        expect(result.games[0].status).toBe('INACTIVE');
        expect(result.games[0].name).toBe('Inactive Game');
      });

      it('should filter by DISCONTINUED status', () => {
        const result = dal.listGamesWithPackCounts('store-1', { status: 'DISCONTINUED' });

        expect(result.games).toHaveLength(1);
        expect(result.games[0].status).toBe('DISCONTINUED');
        expect(result.games[0].name).toBe('Discontinued Game');
      });

      it('should return all non-deleted games when no status filter', () => {
        const result = dal.listGamesWithPackCounts('store-1', {});

        expect(result.games).toHaveLength(4);
        expect(result.total).toBe(4);
      });
    });

    describe('Search Filter (SEC-006: LIKE Injection Prevention)', () => {
      beforeEach(() => {
        dal.create({ store_id: 'store-1', game_code: '1001', name: 'Lucky 7s Deluxe', price: 1 });
        dal.create({ store_id: 'store-1', game_code: '1002', name: 'Cash Explosion', price: 2 });
        dal.create({ store_id: 'store-1', game_code: '2001', name: 'Lucky Winner', price: 5 });
        dal.create({ store_id: 'store-1', game_code: '3001', name: 'Diamond Jackpot', price: 10 });
      });

      it('should search by game name (case-insensitive)', () => {
        const result = dal.listGamesWithPackCounts('store-1', { search: 'lucky' });

        expect(result.games).toHaveLength(2);
        expect(result.games.some((g) => g.name === 'Lucky 7s Deluxe')).toBe(true);
        expect(result.games.some((g) => g.name === 'Lucky Winner')).toBe(true);
      });

      it('should search by game code', () => {
        const result = dal.listGamesWithPackCounts('store-1', { search: '2001' });

        expect(result.games).toHaveLength(1);
        expect(result.games[0].game_code).toBe('2001');
      });

      it('should require minimum 2 characters for search', () => {
        // Search with 1 char should not apply filter
        const result = dal.listGamesWithPackCounts('store-1', { search: 'L' });

        // Should return all games since search is too short
        expect(result.games).toHaveLength(4);
      });

      it('should escape LIKE special character %', () => {
        // Create game with % in name
        dal.create({ store_id: 'store-1', game_code: '9999', name: '100% Winner', price: 1 });

        // Search for literal % - should find the game
        const result = dal.listGamesWithPackCounts('store-1', { search: '100%' });

        expect(result.games).toHaveLength(1);
        expect(result.games[0].name).toBe('100% Winner');
      });

      it('should escape LIKE special character _', () => {
        // Create game with _ in name
        dal.create({ store_id: 'store-1', game_code: '8888', name: 'Lucky_Strike', price: 1 });

        // Search for literal _ - should only find exact match
        const result = dal.listGamesWithPackCounts('store-1', { search: 'Lucky_' });

        expect(result.games).toHaveLength(1);
        expect(result.games[0].name).toBe('Lucky_Strike');
      });

      it('should escape backslash in search', () => {
        // Create game with backslash in name
        dal.create({ store_id: 'store-1', game_code: '7777', name: 'Win\\Lose', price: 1 });

        // Search for literal backslash
        const result = dal.listGamesWithPackCounts('store-1', { search: 'Win\\' });

        expect(result.games).toHaveLength(1);
        expect(result.games[0].name).toBe('Win\\Lose');
      });

      it('should not return soft-deleted games in search results', () => {
        const game = dal.create({
          store_id: 'store-1',
          game_code: '6666',
          name: 'Deleted Lucky',
          price: 1,
        });
        dal.softDelete(game.game_id);

        const result = dal.listGamesWithPackCounts('store-1', { search: 'Deleted' });

        expect(result.games).toHaveLength(0);
      });
    });

    describe('Sort Column Allowlist (SEC-006: SQL Injection Prevention)', () => {
      beforeEach(() => {
        // Create games with varying attributes for sort testing
        dal.create({ store_id: 'store-1', game_code: '3000', name: 'Zebra Game', price: 1 });
        dal.create({ store_id: 'store-1', game_code: '1000', name: 'Alpha Game', price: 10 });
        dal.create({ store_id: 'store-1', game_code: '2000', name: 'Middle Game', price: 5 });
      });

      it('should sort by name ascending (default)', () => {
        const result = dal.listGamesWithPackCounts(
          'store-1',
          {},
          { sortBy: 'name', sortOrder: 'ASC' }
        );

        expect(result.games[0].name).toBe('Alpha Game');
        expect(result.games[1].name).toBe('Middle Game');
        expect(result.games[2].name).toBe('Zebra Game');
      });

      it('should sort by name descending', () => {
        const result = dal.listGamesWithPackCounts(
          'store-1',
          {},
          { sortBy: 'name', sortOrder: 'DESC' }
        );

        expect(result.games[0].name).toBe('Zebra Game');
        expect(result.games[2].name).toBe('Alpha Game');
      });

      it('should sort by game_code', () => {
        const result = dal.listGamesWithPackCounts(
          'store-1',
          {},
          { sortBy: 'game_code', sortOrder: 'ASC' }
        );

        expect(result.games[0].game_code).toBe('1000');
        expect(result.games[1].game_code).toBe('2000');
        expect(result.games[2].game_code).toBe('3000');
      });

      it('should sort by price', () => {
        const result = dal.listGamesWithPackCounts(
          'store-1',
          {},
          { sortBy: 'price', sortOrder: 'DESC' }
        );

        expect(result.games[0].price).toBe(10);
        expect(result.games[1].price).toBe(5);
        expect(result.games[2].price).toBe(1);
      });

      it('should default to name ASC for invalid sort column', () => {
        const result = dal.listGamesWithPackCounts(
          'store-1',
          {},
          { sortBy: 'invalid_column; DROP TABLE games;--' as unknown as 'name' }
        );

        // Should not throw and should use default sort (name ASC)
        expect(result.games[0].name).toBe('Alpha Game');
        expect(result.games).toHaveLength(3);
      });

      it('should default to ASC for invalid sort order', () => {
        const result = dal.listGamesWithPackCounts(
          'store-1',
          {},
          { sortBy: 'name', sortOrder: 'INVALID' as unknown as 'ASC' }
        );

        // Should use default ASC order
        expect(result.games[0].name).toBe('Alpha Game');
      });
    });

    describe('Combined Filters and Pagination', () => {
      beforeEach(() => {
        // Create diverse dataset
        for (let i = 1; i <= 10; i++) {
          dal.create({
            store_id: 'store-1',
            game_code: String(1000 + i).padStart(4, '0'),
            name: `Lucky Game ${i}`,
            price: i,
            status: i <= 5 ? 'ACTIVE' : 'INACTIVE',
          });
        }
        for (let i = 1; i <= 5; i++) {
          dal.create({
            store_id: 'store-1',
            game_code: String(2000 + i).padStart(4, '0'),
            name: `Cash Game ${i}`,
            price: i * 2,
            status: 'ACTIVE',
          });
        }
      });

      it('should apply status filter with pagination', () => {
        const result = dal.listGamesWithPackCounts(
          'store-1',
          { status: 'ACTIVE' },
          { limit: 5, offset: 0 }
        );

        // 5 Lucky + 5 Cash = 10 active games total
        expect(result.total).toBe(10);
        expect(result.games).toHaveLength(5);
        expect(result.hasMore).toBe(true);
      });

      it('should apply search filter with status filter', () => {
        const result = dal.listGamesWithPackCounts(
          'store-1',
          { status: 'ACTIVE', search: 'Lucky' },
          {}
        );

        // Only 5 Lucky games are ACTIVE
        expect(result.total).toBe(5);
        expect(result.games.every((g) => g.status === 'ACTIVE')).toBe(true);
        expect(result.games.every((g) => g.name.includes('Lucky'))).toBe(true);
      });

      it('should apply all filters together with sorting and pagination', () => {
        const result = dal.listGamesWithPackCounts(
          'store-1',
          { status: 'ACTIVE', search: 'Lucky' },
          { sortBy: 'price', sortOrder: 'DESC', limit: 3, offset: 0 }
        );

        expect(result.games).toHaveLength(3);
        expect(result.games[0].price).toBeGreaterThan(result.games[1].price);
        expect(result.games[1].price).toBeGreaterThan(result.games[2].price);
        expect(result.hasMore).toBe(true);
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty store (no games)', () => {
        const result = dal.listGamesWithPackCounts('store-1');

        expect(result.games).toHaveLength(0);
        expect(result.total).toBe(0);
        expect(result.hasMore).toBe(false);
      });

      it('should not return soft-deleted games', () => {
        const game1 = dal.create({
          store_id: 'store-1',
          game_code: '1001',
          name: 'Active',
          price: 1,
        });
        const game2 = dal.create({
          store_id: 'store-1',
          game_code: '1002',
          name: 'Deleted',
          price: 2,
        });
        dal.softDelete(game2.game_id);

        const result = dal.listGamesWithPackCounts('store-1');

        expect(result.games).toHaveLength(1);
        expect(result.games[0].game_id).toBe(game1.game_id);
        expect(result.total).toBe(1);
      });

      it('should handle games with NULL optional fields', () => {
        // Create game without optional fields
        db.prepare(
          `
          INSERT INTO lottery_games (game_id, store_id, game_code, name, price, pack_value, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          'game-null',
          'store-1',
          '1001',
          'Minimal Game',
          1,
          300,
          'ACTIVE',
          new Date().toISOString(),
          new Date().toISOString()
        );

        const result = dal.listGamesWithPackCounts('store-1');

        expect(result.games).toHaveLength(1);
        expect(result.games[0].tickets_per_pack).toBeNull();
        expect(result.games[0].synced_at).toBeNull();
        expect(result.games[0].cloud_game_id).toBeNull();
      });

      it('should handle whitespace-only search as no filter', () => {
        dal.create({ store_id: 'store-1', game_code: '1001', name: 'Game 1', price: 1 });
        dal.create({ store_id: 'store-1', game_code: '1002', name: 'Game 2', price: 2 });

        // Whitespace-only search should be ignored (< 2 meaningful chars)
        const result = dal.listGamesWithPackCounts('store-1', { search: '   ' });

        expect(result.games).toHaveLength(2);
      });
    });
  });

  // ==========================================================================
  // findByIdWithPackCounts Tests
  // ==========================================================================
  describe('findByIdWithPackCounts', () => {
    // Helper to set up lottery_packs table for testing pack counts
    beforeEach(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS lottery_packs (
          pack_id TEXT PRIMARY KEY,
          store_id TEXT NOT NULL,
          game_id TEXT NOT NULL,
          pack_number TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'RECEIVED',
          received_at TEXT,
          activated_at TEXT,
          settled_at TEXT,
          returned_at TEXT,
          deleted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (game_id) REFERENCES lottery_games(game_id)
        );
      `);
    });

    function createPack(data: {
      store_id: string;
      game_id: string;
      pack_number: string;
      status: 'RECEIVED' | 'ACTIVATED' | 'SETTLED' | 'RETURNED';
    }) {
      const now = new Date().toISOString();
      const packId = `pack-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      db.prepare(
        `
        INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, received_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(packId, data.store_id, data.game_id, data.pack_number, data.status, now, now, now);
      return packId;
    }

    it('should return game with pack counts by ID', () => {
      const game = dal.create({
        store_id: 'store-1',
        game_code: '1001',
        name: 'Lucky 7s',
        price: 1,
      });

      createPack({
        store_id: 'store-1',
        game_id: game.game_id,
        pack_number: '001',
        status: 'RECEIVED',
      });
      createPack({
        store_id: 'store-1',
        game_id: game.game_id,
        pack_number: '002',
        status: 'ACTIVATED',
      });
      createPack({
        store_id: 'store-1',
        game_id: game.game_id,
        pack_number: '003',
        status: 'SETTLED',
      });

      const result = dal.findByIdWithPackCounts('store-1', game.game_id);

      expect(result).toBeDefined();
      expect(result?.game_id).toBe(game.game_id);
      expect(result?.total_packs).toBe(3);
      expect(result?.received_packs).toBe(1);
      expect(result?.active_packs).toBe(1);
      expect(result?.settled_packs).toBe(1);
      expect(result?.returned_packs).toBe(0);
    });

    it('should enforce store isolation (DB-006)', () => {
      const game = dal.create({
        store_id: 'store-1',
        game_code: '1001',
        name: 'Store 1 Game',
        price: 1,
      });

      // Try to access from different store
      const result = dal.findByIdWithPackCounts('store-2', game.game_id);

      expect(result).toBeUndefined();
    });

    it('should return undefined for soft-deleted game', () => {
      const game = dal.create({
        store_id: 'store-1',
        game_code: '1001',
        name: 'Deleted Game',
        price: 1,
      });
      dal.softDelete(game.game_id);

      const result = dal.findByIdWithPackCounts('store-1', game.game_id);

      expect(result).toBeUndefined();
    });

    it('should return undefined for non-existent game', () => {
      const result = dal.findByIdWithPackCounts('store-1', 'non-existent-id');

      expect(result).toBeUndefined();
    });
  });
});
