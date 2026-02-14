/**
 * Database State Verification Integration Tests (Phase 4.2)
 *
 * Integration tests validating database state after day close operations.
 * Verifies data integrity across lottery_business_days, lottery_day_packs,
 * lottery_packs, and sync_queue tables.
 *
 * @module tests/integration/day-close/database-state
 *
 * Security Compliance:
 * - SEC-006: All queries use parameterized statements
 * - DB-006: Tenant isolation via store_id scoping
 * - BIZ-006: POSITION mode ticket calculations
 *
 * Traceability Matrix:
 * - INT-DBSTATE-001: lottery_business_days record updated to CLOSED
 * - INT-DBSTATE-002: lottery_day_packs records created for each closing
 * - INT-DBSTATE-003: tickets_sold calculated correctly (POSITION vs INDEX mode)
 * - INT-DBSTATE-004: total_sales_amount aggregated correctly
 * - INT-DBSTATE-005: New OPEN day created with correct opened_by
 * - INT-DBSTATE-006: DB-006 tenant isolation maintained
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import type { CreateSyncQueueItemData } from '../../../src/main/dal/sync-queue.dal';

// ============================================================================
// Native Module Check
// ============================================================================

let nativeModuleAvailable = true;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Db = require('better-sqlite3-multiple-ciphers');
  const testDb = new Db(':memory:');
  testDb.close();
} catch {
  nativeModuleAvailable = false;
}

const SKIP_NATIVE_MODULE_TESTS =
  process.env.CI === 'true' || process.env.SKIP_NATIVE_TESTS === 'true' || !nativeModuleAvailable;

// ============================================================================
// Database Reference
// ============================================================================

let db: Database.Database;

// ============================================================================
// Sync Queue Tracking
// ============================================================================

const syncQueueHistory: CreateSyncQueueItemData[] = [];

// ============================================================================
// Mock Electron IPC
// ============================================================================

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

// ============================================================================
// Mock Database Service
// ============================================================================

vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: () => db,
  isDatabaseInitialized: () => true,
}));

// ============================================================================
// Mock Settings Service
// ============================================================================

vi.mock('../../../src/main/services/settings.service', () => ({
  settingsService: {
    getPOSType: () => 'MANUAL',
    getPOSConnectionType: () => 'MANUAL',
    getSetting: vi.fn(),
    setSetting: vi.fn(),
    hasApiKey: vi.fn(() => true),
  },
}));

// ============================================================================
// Mock Sync Queue DAL
// ============================================================================

vi.mock('../../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: {
    enqueue: vi.fn((data: CreateSyncQueueItemData) => {
      syncQueueHistory.push(data);
      return {
        id: `sync-item-${syncQueueHistory.length}`,
        ...data,
        payload: JSON.stringify(data.payload),
        priority: data.priority ?? 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: new Date().toISOString(),
        synced_at: null,
        dead_lettered: 0,
        dead_letter_reason: null,
        dead_lettered_at: null,
        error_category: null,
        retry_after: null,
        sync_direction: data.sync_direction || 'PUSH',
        api_endpoint: null,
        http_status: null,
        response_body: null,
      };
    }),
    getUnsyncedByStore: vi.fn(() => []),
    getPendingCount: vi.fn(() => syncQueueHistory.length),
    markSynced: vi.fn(),
    getRetryableItems: vi.fn(() => []),
    cleanupAllStalePullTracking: vi.fn().mockReturnValue(0),
  },
}));

// ============================================================================
// Mock Logger
// ============================================================================

vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// ============================================================================
// Mock UUID
// ============================================================================

let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { createServiceTestContext, type ServiceTestContext } from '../../helpers/test-context';
import { setCurrentUser, type SessionUser, type UserRole } from '../../../src/main/ipc/index';
import {
  lotteryBusinessDaysDAL,
  type LotteryBusinessDay,
  type LotteryDayPack,
} from '../../../src/main/dal/lottery-business-days.dal';
import { lotteryPacksDAL } from '../../../src/main/dal/lottery-packs.dal';

// ============================================================================
// Test Suite
// ============================================================================

const describeSuite = SKIP_NATIVE_MODULE_TESTS ? describe.skip : describe;

describeSuite('Database State Verification (Phase 4.2)', () => {
  let ctx: ServiceTestContext;

  beforeEach(async () => {
    uuidCounter = 0;
    syncQueueHistory.length = 0;

    ctx = await createServiceTestContext({
      storeName: 'Database State Verification Store',
    });
    db = ctx.db;

    setCurrentUser(null);
  });

  afterEach(() => {
    ctx?.cleanup();
    vi.clearAllMocks();
    setCurrentUser(null);
    syncQueueHistory.length = 0;
  });

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  /**
   * Create a session user for testing
   */
  function createTestUser(role: UserRole, overrides?: Partial<SessionUser>): SessionUser {
    return {
      user_id: `user-${role}-${++uuidCounter}`,
      username: `Test ${role}`,
      role,
      store_id: ctx.storeId,
      ...overrides,
    };
  }

  /**
   * Seed a lottery business day
   * SEC-006: Parameterized queries
   */
  function seedLotteryDay(options: {
    status?: 'OPEN' | 'PENDING_CLOSE' | 'CLOSED';
    businessDate?: string;
    openedBy?: string;
  }): LotteryBusinessDay {
    const dayId = `day-${++uuidCounter}`;
    const businessDate = options.businessDate ?? ctx.utils.today();
    const status = options.status ?? 'OPEN';
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO lottery_business_days (
        day_id, store_id, business_date, status, opened_at, opened_by,
        total_sales, total_packs_sold, total_packs_activated,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)
    `);
    stmt.run(
      dayId,
      ctx.storeId,
      businessDate,
      status,
      now,
      options.openedBy ?? `user-opener-${uuidCounter}`,
      now,
      now
    );

    return db
      .prepare(`SELECT * FROM lottery_business_days WHERE day_id = ?`)
      .get(dayId) as LotteryBusinessDay;
  }

  /**
   * Seed a lottery bin
   */
  function seedLotteryBin(name: string, displayOrder: number): string {
    const binId = `bin-${++uuidCounter}`;
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO lottery_bins (
        bin_id, store_id, name, display_order, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?)
    `);
    stmt.run(binId, ctx.storeId, name, displayOrder, now, now);
    return binId;
  }

  /**
   * Seed a lottery game
   */
  function seedLotteryGame(options?: {
    gameCode?: string;
    price?: number;
    ticketsPerPack?: number;
  }): string {
    const gameId = `game-${++uuidCounter}`;
    const gameCode = options?.gameCode ?? `100${uuidCounter}`;
    const price = options?.price ?? 1.0;
    const ticketsPerPack = options?.ticketsPerPack ?? 300;
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO lottery_games (
        game_id, store_id, game_code, name, price, tickets_per_pack,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
    `);
    stmt.run(
      gameId,
      ctx.storeId,
      gameCode,
      `Test Game ${gameCode}`,
      price,
      ticketsPerPack,
      now,
      now
    );
    return gameId;
  }

  /**
   * Seed a lottery pack in ACTIVE status
   */
  function seedActivePack(
    gameId: string,
    binId: string,
    options?: {
      packNumber?: string;
      openingSerial?: string;
    }
  ): string {
    const packId = `pack-${++uuidCounter}`;
    const packNumber = options?.packNumber ?? `PKG${String(uuidCounter).padStart(7, '0')}`;
    const openingSerial = options?.openingSerial ?? '000';
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO lottery_packs (
        pack_id, store_id, game_id, pack_number, current_bin_id,
        status, opening_serial, activated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
    `);
    stmt.run(packId, ctx.storeId, gameId, packNumber, binId, openingSerial, now, now, now);
    return packId;
  }

  /**
   * Get lottery day by ID
   */
  function getDayById(dayId: string): LotteryBusinessDay | undefined {
    const stmt = db.prepare(`SELECT * FROM lottery_business_days WHERE day_id = ?`);
    return stmt.get(dayId) as LotteryBusinessDay | undefined;
  }

  /**
   * Get lottery day packs for a day
   */
  function getDayPacks(dayId: string): LotteryDayPack[] {
    const stmt = db.prepare(`SELECT * FROM lottery_day_packs WHERE day_id = ?`);
    return stmt.all(dayId) as LotteryDayPack[];
  }

  /**
   * Get pack by ID
   */
  function getPackById(packId: string):
    | {
        pack_id: string;
        status: string;
        closing_serial: string | null;
      }
    | undefined {
    const stmt = db.prepare(`
      SELECT pack_id, status, closing_serial FROM lottery_packs WHERE pack_id = ?
    `);
    return stmt.get(packId) as
      | {
          pack_id: string;
          status: string;
          closing_serial: string | null;
        }
      | undefined;
  }

  /**
   * Count open days for store
   */
  function countOpenDays(): number {
    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM lottery_business_days
      WHERE store_id = ? AND status = 'OPEN'
    `);
    const result = stmt.get(ctx.storeId) as { count: number };
    return result.count;
  }

  /**
   * Get all days for store
   */
  function getAllDays(): LotteryBusinessDay[] {
    const stmt = db.prepare(`
      SELECT * FROM lottery_business_days
      WHERE store_id = ?
      ORDER BY created_at ASC
    `);
    return stmt.all(ctx.storeId) as LotteryBusinessDay[];
  }

  // ==========================================================================
  // INT-DBSTATE-001: lottery_business_days record updated to CLOSED
  // ==========================================================================

  describe('INT-DBSTATE-001: lottery_business_days updated to CLOSED', () => {
    it('should set status to CLOSED', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Act
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '050' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert
      const closedDay = getDayById(day.day_id);
      expect(closedDay?.status).toBe('CLOSED');
    });

    it('should set closed_at to current timestamp', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      const beforeClose = new Date();

      // Act
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '050' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      const afterClose = new Date();

      // Assert
      const closedDay = getDayById(day.day_id);
      expect(closedDay?.closed_at).toBeTruthy();

      const closedAtDate = new Date(closedDay!.closed_at!);
      expect(closedAtDate >= beforeClose).toBe(true);
      expect(closedAtDate <= afterClose).toBe(true);
    });

    it('should set closed_by to user ID', async () => {
      // Arrange
      const user = createTestUser('shift_manager', { user_id: 'closing-user-123' });
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Act
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '050' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert
      const closedDay = getDayById(day.day_id);
      expect(closedDay?.closed_by).toBe('closing-user-123');
    });

    it('should update total_sales with calculated amount', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame({ price: 5.0 });
      const bin1 = seedLotteryBin('Bin 1', 1);
      const bin2 = seedLotteryBin('Bin 2', 2);
      const pack1 = seedActivePack(gameId, bin1);
      const pack2 = seedActivePack(gameId, bin2);

      // Act: 50 tickets @ $5 + 30 tickets @ $5 = $400
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [
        { pack_id: pack1, closing_serial: '050' },
        { pack_id: pack2, closing_serial: '030' },
      ]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert
      const closedDay = getDayById(day.day_id);
      expect(closedDay?.total_sales).toBe(400);
    });

    it('should update updated_at timestamp', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const originalUpdatedAt = day.updated_at;

      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Act
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '050' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert
      const closedDay = getDayById(day.day_id);
      expect(closedDay?.updated_at).not.toBe(originalUpdatedAt);
      expect(new Date(closedDay!.updated_at) > new Date(originalUpdatedAt)).toBe(true);
    });
  });

  // ==========================================================================
  // INT-DBSTATE-002: lottery_day_packs records created for each closing
  // ==========================================================================

  describe('INT-DBSTATE-002: lottery_day_packs records created', () => {
    it('should create one record per pack closing', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame();
      const bin1 = seedLotteryBin('Bin 1', 1);
      const bin2 = seedLotteryBin('Bin 2', 2);
      const bin3 = seedLotteryBin('Bin 3', 3);
      const pack1 = seedActivePack(gameId, bin1);
      const pack2 = seedActivePack(gameId, bin2);
      const pack3 = seedActivePack(gameId, bin3);

      // Act
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [
        { pack_id: pack1, closing_serial: '050' },
        { pack_id: pack2, closing_serial: '075' },
        { pack_id: pack3, closing_serial: '025' },
      ]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert
      const dayPacks = getDayPacks(day.day_id);
      expect(dayPacks.length).toBe(3);
    });

    it('should set day_id correctly on all records', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame();
      const binId = seedLotteryBin('Bin 1', 1);
      const packId = seedActivePack(gameId, binId);

      // Act
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '050' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert
      const dayPacks = getDayPacks(day.day_id);
      expect(dayPacks.length).toBe(1);
      expect(dayPacks[0].day_id).toBe(day.day_id);
    });

    it('should set pack_id correctly on each record', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame();
      const bin1 = seedLotteryBin('Bin 1', 1);
      const bin2 = seedLotteryBin('Bin 2', 2);
      const pack1 = seedActivePack(gameId, bin1);
      const pack2 = seedActivePack(gameId, bin2);

      // Act
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [
        { pack_id: pack1, closing_serial: '050' },
        { pack_id: pack2, closing_serial: '075' },
      ]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert
      const dayPacks = getDayPacks(day.day_id);
      const packIds = dayPacks.map((p) => p.pack_id).sort();
      expect(packIds).toContain(pack1);
      expect(packIds).toContain(pack2);
    });

    it('should set ending_serial from closing data', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame();
      const binId = seedLotteryBin('Bin 1', 1);
      const packId = seedActivePack(gameId, binId, { openingSerial: '000' });

      // Act
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '123' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert
      const dayPacks = getDayPacks(day.day_id);
      expect(dayPacks[0].ending_serial).toBe('123');
    });

    it('should set store_id for tenant isolation (DB-006)', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame();
      const binId = seedLotteryBin('Bin 1', 1);
      const packId = seedActivePack(gameId, binId);

      // Act
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '050' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert
      const dayPacks = getDayPacks(day.day_id);
      expect(dayPacks[0].store_id).toBe(ctx.storeId);
    });
  });

  // ==========================================================================
  // INT-DBSTATE-003: tickets_sold calculated correctly
  // ==========================================================================

  describe('INT-DBSTATE-003: tickets_sold calculation', () => {
    it('should calculate tickets_sold using POSITION mode (end - start)', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame({ price: 1.0 });
      const binId = seedLotteryBin('Bin 1', 1);
      // Pack starts at serial 000
      const packId = seedActivePack(gameId, binId, { openingSerial: '000' });

      // Act: closing_serial 100 means position 100 (tickets 0-99 sold)
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '100' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert: POSITION mode: 100 - 0 = 100 tickets
      const dayPacks = getDayPacks(day.day_id);
      expect(dayPacks[0].tickets_sold).toBe(100);
    });

    it('should handle non-zero starting serial', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame({ price: 1.0 });
      const binId = seedLotteryBin('Bin 1', 1);
      // Pack starts at serial 050 (continuing from previous day)
      const packId = seedActivePack(gameId, binId, { openingSerial: '050' });

      // Update pack to have prev_ending_serial for carryforward
      db.prepare(
        `
        UPDATE lottery_packs SET prev_ending_serial = '050' WHERE pack_id = ?
      `
      ).run(packId);

      // Act: closing at 150 means tickets 50-149 sold (100 tickets)
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '150' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert: 150 - 50 = 100 tickets
      const dayPacks = getDayPacks(day.day_id);
      expect(dayPacks[0].tickets_sold).toBe(100);
    });

    it('should handle zero tickets sold (no sales)', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame({ price: 1.0 });
      const binId = seedLotteryBin('Bin 1', 1);
      const packId = seedActivePack(gameId, binId, { openingSerial: '000' });

      // Act: closing at 000 means no tickets sold
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '000' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert: 0 - 0 = 0 tickets
      const dayPacks = getDayPacks(day.day_id);
      expect(dayPacks[0].tickets_sold).toBe(0);
    });

    it('should handle all tickets sold (sold out pack)', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame({ price: 1.0, ticketsPerPack: 100 });
      const binId = seedLotteryBin('Bin 1', 1);
      const packId = seedActivePack(gameId, binId, { openingSerial: '000' });

      // Act: Pack with 100 tickets, sold out at 100 (tickets 0-99)
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [
        { pack_id: packId, closing_serial: '100', is_sold_out: true },
      ]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert
      const dayPacks = getDayPacks(day.day_id);
      expect(dayPacks[0].tickets_sold).toBe(100);
    });
  });

  // ==========================================================================
  // INT-DBSTATE-004: total_sales_amount aggregated correctly
  // ==========================================================================

  describe('INT-DBSTATE-004: sales_amount aggregation', () => {
    it('should calculate sales_amount as tickets_sold * game_price', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame({ price: 5.0 }); // $5 per ticket
      const binId = seedLotteryBin('Bin 1', 1);
      const packId = seedActivePack(gameId, binId);

      // Act: 50 tickets * $5 = $250
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '050' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert
      const dayPacks = getDayPacks(day.day_id);
      expect(dayPacks[0].sales_amount).toBe(250);
    });

    it('should aggregate total across multiple packs', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      // Different price games
      const game1 = seedLotteryGame({ price: 1.0 });
      const game2 = seedLotteryGame({ price: 2.0 });
      const game3 = seedLotteryGame({ price: 5.0 });

      const bin1 = seedLotteryBin('Bin 1', 1);
      const bin2 = seedLotteryBin('Bin 2', 2);
      const bin3 = seedLotteryBin('Bin 3', 3);

      const pack1 = seedActivePack(game1, bin1); // $1 game
      const pack2 = seedActivePack(game2, bin2); // $2 game
      const pack3 = seedActivePack(game3, bin3); // $5 game

      // Act
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [
        { pack_id: pack1, closing_serial: '100' }, // 100 * $1 = $100
        { pack_id: pack2, closing_serial: '050' }, // 50 * $2 = $100
        { pack_id: pack3, closing_serial: '020' }, // 20 * $5 = $100
      ]);
      const result = lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert: Total = $300
      expect(result.lottery_total).toBe(300);

      // Verify individual records
      const dayPacks = getDayPacks(day.day_id);
      const totalFromRecords = dayPacks.reduce((sum, p) => sum + (p.sales_amount || 0), 0);
      expect(totalFromRecords).toBe(300);
    });

    it('should handle zero sales amount', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame({ price: 10.0 });
      const binId = seedLotteryBin('Bin 1', 1);
      const packId = seedActivePack(gameId, binId, { openingSerial: '000' });

      // Act: No tickets sold
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '000' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert
      const dayPacks = getDayPacks(day.day_id);
      expect(dayPacks[0].sales_amount).toBe(0);
    });

    it('should handle fractional prices correctly', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame({ price: 0.5 }); // 50 cents
      const binId = seedLotteryBin('Bin 1', 1);
      const packId = seedActivePack(gameId, binId);

      // Act: 25 tickets * $0.50 = $12.50
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '025' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert
      const dayPacks = getDayPacks(day.day_id);
      expect(dayPacks[0].sales_amount).toBe(12.5);
    });
  });

  // ==========================================================================
  // INT-DBSTATE-005: New OPEN day created with correct opened_by
  // ==========================================================================

  describe('INT-DBSTATE-005: New OPEN day creation', () => {
    it('should create new OPEN day after commit', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Close the day
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '050' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Act: Auto-open next day
      const today = ctx.utils.today();
      const nextDay = lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, today, user.user_id);

      // Assert
      expect(nextDay.status).toBe('OPEN');
      expect(nextDay.day_id).not.toBe(day.day_id);
    });

    it('should set opened_by to closing user', async () => {
      // Arrange
      const closingUser = createTestUser('shift_manager', {
        user_id: 'closer-user-id',
      });
      setCurrentUser(closingUser);

      const day = seedLotteryDay({ status: 'OPEN', openedBy: 'original-opener' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Close the day
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '050' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, closingUser.user_id);

      // Act
      const today = ctx.utils.today();
      const nextDay = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        today,
        closingUser.user_id
      );

      // Assert
      expect(nextDay.opened_by).toBe('closer-user-id');
    });

    it('should use current business date', async () => {
      // Arrange: Close day from yesterday
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const yesterdayDate = ctx.utils.businessDate(-1);
      const todayDate = ctx.utils.today();

      const day = seedLotteryDay({ status: 'OPEN', businessDate: yesterdayDate });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Close yesterday's day
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '050' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Act
      const nextDay = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        todayDate,
        user.user_id
      );

      // Assert: New day uses today's date
      expect(nextDay.business_date).toBe(todayDate);
    });

    it('should set opened_at timestamp', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      const beforeOpen = new Date();

      // Close the day
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '050' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Act
      const today = ctx.utils.today();
      const nextDay = lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, today, user.user_id);

      const afterOpen = new Date();

      // Assert
      expect(nextDay.opened_at).toBeTruthy();
      const openedAtDate = new Date(nextDay.opened_at!);
      expect(openedAtDate >= beforeOpen).toBe(true);
      expect(openedAtDate <= afterOpen).toBe(true);
    });

    it('should maintain exactly one OPEN day per store', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Assert: One open day initially
      expect(countOpenDays()).toBe(1);

      // Act: Close and auto-open
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '050' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      const today = ctx.utils.today();
      lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, today, user.user_id);

      // Assert: Still exactly one open day (the new one)
      expect(countOpenDays()).toBe(1);

      // Verify total days = 2 (1 closed + 1 open)
      const allDays = getAllDays();
      expect(allDays.length).toBe(2);
      expect(allDays.filter((d) => d.status === 'CLOSED').length).toBe(1);
      expect(allDays.filter((d) => d.status === 'OPEN').length).toBe(1);
    });
  });

  // ==========================================================================
  // INT-DBSTATE-006: DB-006 tenant isolation maintained
  // ==========================================================================

  describe('INT-DBSTATE-006: DB-006 Tenant Isolation', () => {
    it('should scope all records to correct store_id', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Act
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '050' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert: All records have correct store_id
      const closedDay = getDayById(day.day_id);
      expect(closedDay?.store_id).toBe(ctx.storeId);

      const dayPacks = getDayPacks(day.day_id);
      dayPacks.forEach((p) => {
        expect(p.store_id).toBe(ctx.storeId);
      });
    });

    it('should not affect data in other stores', async () => {
      // Arrange: Create second store
      const otherStoreId = 'other-store-uuid';
      const now = new Date().toISOString();

      db.prepare(
        `
        INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
        VALUES (?, 'other-company', 'Other Store', 'America/New_York', 'ACTIVE', ?, ?)
      `
      ).run(otherStoreId, now, now);

      // Create day in other store
      db.prepare(
        `
        INSERT INTO lottery_business_days (
          day_id, store_id, business_date, status, opened_at, opened_by,
          total_sales, total_packs_sold, total_packs_activated,
          created_at, updated_at
        ) VALUES ('other-day-id', ?, ?, 'OPEN', ?, 'other-user', 0, 0, 0, ?, ?)
      `
      ).run(otherStoreId, ctx.utils.today(), now, now, now);

      // Set up our store
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Act: Close our store's day
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '050' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert: Other store's day unaffected
      const otherDay = db
        .prepare(
          `
        SELECT * FROM lottery_business_days WHERE day_id = 'other-day-id'
      `
        )
        .get() as LotteryBusinessDay;

      expect(otherDay.status).toBe('OPEN'); // Still open
      expect(otherDay.closed_at).toBeNull();
      expect(otherDay.closed_by).toBeNull();
    });

    it('should reject cross-store pack in closings', async () => {
      // Arrange: Create pack in different store
      const otherStoreId = 'other-store-uuid';
      const now = new Date().toISOString();

      db.prepare(
        `
        INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
        VALUES (?, 'other-company', 'Other Store', 'America/New_York', 'ACTIVE', ?, ?)
      `
      ).run(otherStoreId, now, now);

      const gameId = seedLotteryGame();
      const otherPackId = 'other-pack-uuid';
      db.prepare(
        `
        INSERT INTO lottery_packs (
          pack_id, store_id, game_id, pack_number, status, opening_serial,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'OTHER001', 'ACTIVE', '000', ?, ?)
      `
      ).run(otherPackId, otherStoreId, gameId, now, now);

      // Set up our store
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });

      // Act & Assert: Should reject other store's pack
      expect(() => {
        lotteryBusinessDaysDAL.prepareClose(day.day_id, [
          { pack_id: otherPackId, closing_serial: '050' },
        ]);
      }).toThrow('does not belong to this store');
    });
  });

  // ==========================================================================
  // Pack Status Updates
  // ==========================================================================

  describe('Pack Status Updates', () => {
    it('should mark sold-out packs as DEPLETED', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame({ ticketsPerPack: 100 });
      const binId = seedLotteryBin('Bin 1', 1);
      const packId = seedActivePack(gameId, binId);

      // Act: Mark as sold out
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [
        { pack_id: packId, closing_serial: '100', is_sold_out: true },
      ]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert
      const pack = getPackById(packId);
      expect(pack?.status).toBe('DEPLETED');
    });

    it('should keep non-sold-out packs as ACTIVE', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame({ ticketsPerPack: 300 });
      const binId = seedLotteryBin('Bin 1', 1);
      const packId = seedActivePack(gameId, binId);

      // Act: NOT sold out (still has tickets remaining)
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [
        { pack_id: packId, closing_serial: '100', is_sold_out: false },
      ]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert
      const pack = getPackById(packId);
      expect(pack?.status).toBe('ACTIVE');
    });

    it('should set closing_serial on DEPLETED packs', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame({ ticketsPerPack: 100 });
      const binId = seedLotteryBin('Bin 1', 1);
      const packId = seedActivePack(gameId, binId);

      // Act
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [
        { pack_id: packId, closing_serial: '099', is_sold_out: true },
      ]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert
      const pack = getPackById(packId);
      expect(pack?.closing_serial).toBe('099');
    });
  });
});
