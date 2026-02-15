/**
 * Deferred Commit Flow Integration Tests (Phase 4.1)
 *
 * Integration tests validating the complete Day Close wizard flow for
 * non-LOTTERY POS types. Tests the deferred commit pattern where lottery
 * closings are collected in Step 1 and committed in Step 3.
 *
 * @module tests/integration/day-close/deferred-commit-flow
 *
 * Security Compliance:
 * - SEC-006: All queries use parameterized statements via DAL
 * - SEC-010: Authorization via session with fromWizard flag
 * - DB-006: Tenant isolation via store_id scoping
 * - API-001: Input validation with Zod schemas
 *
 * Traceability Matrix:
 * - INT-DEFERRED-001: Full wizard flow for non-LOTTERY POS type
 * - INT-DEFERRED-002: Lottery day status changes to CLOSED
 * - INT-DEFERRED-003: New day auto-opens with correct business_date (BIZ-007)
 * - INT-DEFERRED-004: Lottery closings records created in database
 * - INT-DEFERRED-005: Day appears in reports after close
 * - INT-DEFERRED-006: Sync queue contains correct entries
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
// Database Holder (vi.hoisted for cross-platform mock compatibility)
// ============================================================================

// Use vi.hoisted() to ensure the database holder is available when vi.mock runs
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
const { dbHolder } = vi.hoisted(() => ({
  dbHolder: { instance: null as Database.Database | null },
}));

// ============================================================================
// Sync Queue Tracking
// ============================================================================

const syncQueueHistory: CreateSyncQueueItemData[] = [];
let syncQueueEnabled = true;

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
  getDatabase: () => {
    if (!dbHolder.instance) {
      throw new Error('Database not initialized - test setup issue');
    }
    return dbHolder.instance;
  },
  isDatabaseInitialized: () => dbHolder.instance !== null,
}));

// ============================================================================
// Mock Settings Service
// ============================================================================

let mockPOSType = 'MANUAL'; // Non-LOTTERY POS type for deferred commit tests
let mockPOSConnectionType = 'MANUAL';
vi.mock('../../../src/main/services/settings.service', () => ({
  settingsService: {
    getPOSType: () => mockPOSType,
    getPOSConnectionType: () => mockPOSConnectionType,
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
      if (!syncQueueEnabled) {
        throw new Error('Sync queue unavailable - offline mode');
      }
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
    getPendingCount: vi.fn(() => syncQueueHistory.filter((i) => i).length),
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
// Database Reference (after mocks)
// ============================================================================

let db: Database.Database;

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { createServiceTestContext, type ServiceTestContext } from '../../helpers/test-context';
import {
  setCurrentUser,
  getCurrentUser,
  type SessionUser,
  type UserRole,
} from '../../../src/main/ipc/index';
import {
  lotteryBusinessDaysDAL,
  type LotteryBusinessDay,
} from '../../../src/main/dal/lottery-business-days.dal';
import { lotteryPacksDAL } from '../../../src/main/dal/lottery-packs.dal';
import { shiftsDAL } from '../../../src/main/dal/shifts.dal';
import { daySummariesDAL } from '../../../src/main/dal/day-summaries.dal';

// ============================================================================
// Test Suite
// ============================================================================

const describeSuite = SKIP_NATIVE_MODULE_TESTS ? describe.skip : describe;

describeSuite('Deferred Commit Flow Integration (Phase 4.1)', () => {
  let ctx: ServiceTestContext;

  beforeEach(async () => {
    uuidCounter = 0;
    syncQueueHistory.length = 0;
    syncQueueEnabled = true;
    mockPOSType = 'MANUAL'; // Non-LOTTERY POS type
    mockPOSConnectionType = 'MANUAL';

    ctx = await createServiceTestContext({
      storeName: 'Deferred Commit Flow Integration Store',
    });
    db = ctx.db;
    dbHolder.instance = db;

    // Clear any existing session
    setCurrentUser(null);
  });

  afterEach(() => {
    ctx?.cleanup();
    dbHolder.instance = null;
    vi.clearAllMocks();
    setCurrentUser(null);
    syncQueueHistory.length = 0;
  });

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  /**
   * Create a session user for testing
   * SEC-010: Role-based authorization setup
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
   * DB-006: Store-scoped
   */
  function seedLotteryDay(options: {
    status?: 'OPEN' | 'PENDING_CLOSE' | 'CLOSED';
    businessDate?: string;
    openedBy?: string;
  }): { day_id: string; business_date: string; status: string } {
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

    return { day_id: dayId, business_date: businessDate, status };
  }

  /**
   * Seed a lottery bin
   * SEC-006: Parameterized queries
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
   * SEC-006: Parameterized queries
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
   * SEC-006: Parameterized queries
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
   * SEC-006: Parameterized query
   */
  function getDayById(dayId: string): LotteryBusinessDay | undefined {
    const stmt = db.prepare(`SELECT * FROM lottery_business_days WHERE day_id = ?`);
    return stmt.get(dayId) as LotteryBusinessDay | undefined;
  }

  /**
   * Find open lottery day for store
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   */
  function findOpenDay(): LotteryBusinessDay | undefined {
    const stmt = db.prepare(`
      SELECT * FROM lottery_business_days
      WHERE store_id = ? AND status = 'OPEN'
      ORDER BY business_date DESC
      LIMIT 1
    `);
    return stmt.get(ctx.storeId) as LotteryBusinessDay | undefined;
  }

  /**
   * Get lottery day packs for a day
   * SEC-006: Parameterized query
   */
  function getDayPacks(dayId: string): Array<{
    day_pack_id: string;
    pack_id: string;
    starting_serial: string;
    ending_serial: string | null;
    tickets_sold: number | null;
    sales_amount: number | null;
  }> {
    const stmt = db.prepare(`
      SELECT * FROM lottery_day_packs WHERE day_id = ?
    `);
    return stmt.all(dayId) as Array<{
      day_pack_id: string;
      pack_id: string;
      starting_serial: string;
      ending_serial: string | null;
      tickets_sold: number | null;
      sales_amount: number | null;
    }>;
  }

  /**
   * Find sync items by entity type
   */
  function findSyncItemsByType(entityType: string): CreateSyncQueueItemData[] {
    return syncQueueHistory.filter((item) => item.entity_type === entityType);
  }

  /**
   * Simulate the full deferred commit flow (Steps 1-3 of wizard)
   * This mirrors the DayClosePage behavior for non-LOTTERY POS types
   */
  async function simulateDeferredCommitFlow(options: {
    closings: Array<{ pack_id: string; closing_serial: string; is_sold_out?: boolean }>;
    userId: string;
  }): Promise<{
    success: boolean;
    prepareResult?: {
      day_id: string;
      closings_count: number;
      estimated_lottery_total: number;
    };
    commitResult?: {
      day_id: string;
      closings_created: number;
      lottery_total: number;
      next_day?: {
        day_id: string;
        business_date: string;
        status: string;
      };
    };
    error?: string;
  }> {
    try {
      // Phase 1: Prepare - validates closings and transitions to PENDING_CLOSE
      // SEC-010: fromWizard=true allows non-LOTTERY POS types
      const prepareResult = lotteryBusinessDaysDAL.prepareClose(
        findOpenDay()!.day_id,
        options.closings
      );

      // Phase 2: Commit - applies settlements, sets CLOSED status
      // BIZ-007: Backend auto-opens next day after successful commit
      const commitResult = lotteryBusinessDaysDAL.commitClose(prepareResult.day_id, options.userId);

      // Auto-open next day (BIZ-007)
      const today = ctx.utils.today();
      const nextDay = lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, today, options.userId);

      return {
        success: true,
        prepareResult: {
          day_id: prepareResult.day_id,
          closings_count: prepareResult.closings_count,
          estimated_lottery_total: prepareResult.estimated_lottery_total,
        },
        commitResult: {
          day_id: commitResult.day_id,
          closings_created: commitResult.closings_created,
          lottery_total: commitResult.lottery_total,
          next_day: {
            day_id: nextDay.day_id,
            business_date: nextDay.business_date,
            status: nextDay.status,
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ==========================================================================
  // INT-DEFERRED-001: Full wizard flow for non-LOTTERY POS type
  // ==========================================================================

  describe('INT-DEFERRED-001: Full wizard flow for non-LOTTERY POS type', () => {
    it('should complete full flow: scanner → pending closings → commit', async () => {
      // Arrange: Set up user, day, bins, games, and packs
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN', openedBy: user.user_id });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame({ price: 1.0 });
      const packId = seedActivePack(gameId, binId, { openingSerial: '000' });

      // Clear sync queue to track only new items
      syncQueueHistory.length = 0;

      // Simulate Step 1: Scanner completes with deferred commit
      // (In real flow, scanner calls onPendingClosings with closings data)
      const closings = [{ pack_id: packId, closing_serial: '050', is_sold_out: false }];

      // Act: Simulate Steps 2-3 (lottery commit + shift close)
      const result = await simulateDeferredCommitFlow({
        closings,
        userId: user.user_id,
      });

      // Assert: Flow completed successfully
      expect(result.success).toBe(true);
      expect(result.prepareResult).toBeDefined();
      expect(result.prepareResult?.closings_count).toBe(1);
      expect(result.commitResult).toBeDefined();
      expect(result.commitResult?.closings_created).toBe(1);

      // Verify original day is CLOSED
      const closedDay = getDayById(day.day_id);
      expect(closedDay?.status).toBe('CLOSED');
      expect(closedDay?.closed_at).toBeTruthy();
      expect(closedDay?.closed_by).toBe(user.user_id);
    });

    it('should handle multiple packs in single commit', async () => {
      // Arrange: Multiple bins/packs
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryDay({ status: 'OPEN', openedBy: user.user_id });

      const gameId = seedLotteryGame({ price: 2.0 });
      const bin1 = seedLotteryBin('Bin 1', 1);
      const bin2 = seedLotteryBin('Bin 2', 2);
      const bin3 = seedLotteryBin('Bin 3', 3);
      const pack1 = seedActivePack(gameId, bin1);
      const pack2 = seedActivePack(gameId, bin2);
      const pack3 = seedActivePack(gameId, bin3);

      syncQueueHistory.length = 0;

      const closings = [
        { pack_id: pack1, closing_serial: '050', is_sold_out: false },
        { pack_id: pack2, closing_serial: '100', is_sold_out: false },
        { pack_id: pack3, closing_serial: '075', is_sold_out: false },
      ];

      // Act
      const result = await simulateDeferredCommitFlow({
        closings,
        userId: user.user_id,
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.prepareResult?.closings_count).toBe(3);
      expect(result.commitResult?.closings_created).toBe(3);
      // Total: (50 + 100 + 75) * $2.00 = $450.00
      expect(result.commitResult?.lottery_total).toBe(450);
    });

    it('should handle sold out packs correctly (marks as DEPLETED)', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryDay({ status: 'OPEN', openedBy: user.user_id });

      const gameId = seedLotteryGame({ price: 1.0, ticketsPerPack: 100 });
      const binId = seedLotteryBin('Bin 1', 1);
      const packId = seedActivePack(gameId, binId);

      syncQueueHistory.length = 0;

      // Mark pack as sold out (ending at last ticket)
      const closings = [{ pack_id: packId, closing_serial: '099', is_sold_out: true }];

      // Act
      const result = await simulateDeferredCommitFlow({
        closings,
        userId: user.user_id,
      });

      // Assert: Pack should be DEPLETED
      expect(result.success).toBe(true);

      const pack = db.prepare(`SELECT status FROM lottery_packs WHERE pack_id = ?`).get(packId) as {
        status: string;
      };
      expect(pack.status).toBe('DEPLETED');

      // Verify sync queue has pack depletion
      const packSyncItems = findSyncItemsByType('pack');
      expect(packSyncItems.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // INT-DEFERRED-002: Lottery day status changes to CLOSED
  // ==========================================================================

  describe('INT-DEFERRED-002: Lottery day status changes to CLOSED', () => {
    it('should transition day from OPEN → PENDING_CLOSE → CLOSED', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN', openedBy: user.user_id });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Verify initial state
      expect(getDayById(day.day_id)?.status).toBe('OPEN');

      // Act: Prepare (transitions to PENDING_CLOSE)
      const prepareResult = lotteryBusinessDaysDAL.prepareClose(day.day_id, [
        { pack_id: packId, closing_serial: '050' },
      ]);

      // Assert: PENDING_CLOSE
      expect(getDayById(day.day_id)?.status).toBe('PENDING_CLOSE');
      expect(prepareResult.status).toBe('PENDING_CLOSE');

      // Act: Commit (transitions to CLOSED)
      const commitResult = lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert: CLOSED
      const closedDay = getDayById(day.day_id);
      expect(closedDay?.status).toBe('CLOSED');
      expect(closedDay?.closed_at).toBeTruthy();
      expect(closedDay?.closed_by).toBe(user.user_id);
      expect(commitResult.closings_created).toBe(1);
    });

    it('should set closed_at timestamp', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      const beforeClose = new Date().toISOString();

      // Act
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '025' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert
      const closedDay = getDayById(day.day_id);
      expect(closedDay?.closed_at).toBeTruthy();
      expect(closedDay?.closed_at && closedDay.closed_at >= beforeClose).toBe(true);
    });

    it('should set closed_by to authenticated user', async () => {
      // Arrange
      const user = createTestUser('cashier', { user_id: 'specific-user-uuid' });
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Act
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '030' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert
      const closedDay = getDayById(day.day_id);
      expect(closedDay?.closed_by).toBe('specific-user-uuid');
    });
  });

  // ==========================================================================
  // INT-DEFERRED-003: New day auto-opens with correct business_date (BIZ-007)
  // ==========================================================================

  describe('INT-DEFERRED-003: New day auto-opens (BIZ-007)', () => {
    it('should auto-open next day after commit', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN', openedBy: user.user_id });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      syncQueueHistory.length = 0;

      // Act
      const result = await simulateDeferredCommitFlow({
        closings: [{ pack_id: packId, closing_serial: '050' }],
        userId: user.user_id,
      });

      // Assert: Next day auto-opened
      expect(result.success).toBe(true);
      expect(result.commitResult?.next_day).toBeDefined();
      expect(result.commitResult?.next_day?.status).toBe('OPEN');

      // Verify new OPEN day exists
      const openDay = findOpenDay();
      expect(openDay).toBeDefined();
      expect(openDay?.status).toBe('OPEN');
      expect(openDay?.day_id).not.toBe(day.day_id);
    });

    it('should use current business date for auto-opened day', async () => {
      // Arrange: Create day with yesterday's date
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      const yesterdayDate = ctx.utils.businessDate(-1);
      const todayDate = ctx.utils.today();

      seedLotteryDay({
        status: 'OPEN',
        businessDate: yesterdayDate,
        openedBy: user.user_id,
      });

      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Act
      const result = await simulateDeferredCommitFlow({
        closings: [{ pack_id: packId, closing_serial: '050' }],
        userId: user.user_id,
      });

      // Assert: New day uses today's date
      expect(result.commitResult?.next_day?.business_date).toBe(todayDate);
    });

    it('should use closing user as opened_by for next day', async () => {
      // Arrange
      const closingUser = createTestUser('shift_manager', {
        user_id: 'closing-manager-uuid',
        username: 'Closing Manager',
      });
      setCurrentUser(closingUser);

      seedLotteryDay({ status: 'OPEN', openedBy: 'original-opener' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Act
      const result = await simulateDeferredCommitFlow({
        closings: [{ pack_id: packId, closing_serial: '050' }],
        userId: closingUser.user_id,
      });

      // Assert
      const openDay = findOpenDay();
      expect(openDay?.opened_by).toBe('closing-manager-uuid');
    });

    it('should allow shift start after day auto-opens', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryDay({ status: 'OPEN', openedBy: user.user_id });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Act: Close day to trigger auto-open
      const result = await simulateDeferredCommitFlow({
        closings: [{ pack_id: packId, closing_serial: '050' }],
        userId: user.user_id,
      });

      expect(result.success).toBe(true);

      // Verify open day exists
      const openDay = findOpenDay();
      expect(openDay).toBeDefined();

      // Act: Start shift (should work because open day exists)
      const today = ctx.utils.today();
      daySummariesDAL.getOrCreateForDate(ctx.storeId, today);
      const shift = shiftsDAL.getOrCreateForDate(ctx.storeId, today, {
        externalRegisterId: 'register-1',
        internalUserId: user.user_id,
        startTime: new Date().toISOString(),
      });

      // Assert: Shift created
      expect(shift.status).toBe('OPEN');
    });
  });

  // ==========================================================================
  // INT-DEFERRED-004: Lottery closings records created in database
  // ==========================================================================

  describe('INT-DEFERRED-004: Lottery closings records created', () => {
    it('should create lottery_day_packs records for each closing', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame({ price: 5.0 });
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

      // Assert: lottery_day_packs records created
      const dayPacks = getDayPacks(day.day_id);
      expect(dayPacks.length).toBe(2);

      const pack1Record = dayPacks.find((p) => p.pack_id === pack1);
      expect(pack1Record?.ending_serial).toBe('050');
      expect(pack1Record?.tickets_sold).toBe(50);
      expect(pack1Record?.sales_amount).toBe(250); // 50 * $5

      const pack2Record = dayPacks.find((p) => p.pack_id === pack2);
      expect(pack2Record?.ending_serial).toBe('075');
      expect(pack2Record?.tickets_sold).toBe(75);
      expect(pack2Record?.sales_amount).toBe(375); // 75 * $5
    });

    it('should calculate tickets_sold correctly (POSITION mode)', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame({ price: 1.0 });
      const binId = seedLotteryBin('Bin 1', 1);
      const packId = seedActivePack(gameId, binId, { openingSerial: '000' });

      // Act: closing_serial is next ticket to sell (POSITION mode)
      // ending = 100 means tickets 000-099 sold = 100 tickets
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '100' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert
      const dayPacks = getDayPacks(day.day_id);
      expect(dayPacks[0].tickets_sold).toBe(100);
    });

    it('should aggregate total_sales on lottery_business_days', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame({ price: 2.0 });
      const bin1 = seedLotteryBin('Bin 1', 1);
      const bin2 = seedLotteryBin('Bin 2', 2);
      const pack1 = seedActivePack(gameId, bin1);
      const pack2 = seedActivePack(gameId, bin2);

      // Act
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [
        { pack_id: pack1, closing_serial: '050' }, // 50 * $2 = $100
        { pack_id: pack2, closing_serial: '030' }, // 30 * $2 = $60
      ]);
      const result = lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert: Total $160
      expect(result.lottery_total).toBe(160);
    });
  });

  // ==========================================================================
  // INT-DEFERRED-005: Day appears in reports after close
  // ==========================================================================

  describe('INT-DEFERRED-005: Day appears in reports', () => {
    it('should be queryable as CLOSED day', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Act
      lotteryBusinessDaysDAL.prepareClose(day.day_id, [{ pack_id: packId, closing_serial: '025' }]);
      lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);

      // Assert: Can find day by CLOSED status
      const closedDays = db
        .prepare(
          `
        SELECT * FROM lottery_business_days
        WHERE store_id = ? AND status = 'CLOSED'
      `
        )
        .all(ctx.storeId) as LotteryBusinessDay[];

      expect(closedDays.length).toBe(1);
      expect(closedDays[0].day_id).toBe(day.day_id);
    });

    it('should include closed_at for report sorting', async () => {
      // Arrange: Create and close multiple days
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Day 1
      const day1 = seedLotteryDay({
        status: 'OPEN',
        businessDate: ctx.utils.businessDate(-2),
      });
      let binId = seedLotteryBin('Bin 1', 1);
      let gameId = seedLotteryGame();
      let packId = seedActivePack(gameId, binId);
      lotteryBusinessDaysDAL.prepareClose(day1.day_id, [
        { pack_id: packId, closing_serial: '010' },
      ]);
      lotteryBusinessDaysDAL.commitClose(day1.day_id, user.user_id);

      // Day 2 (auto-opened from day 1 close, but let's create explicitly)
      const day2 = seedLotteryDay({
        status: 'OPEN',
        businessDate: ctx.utils.businessDate(-1),
      });
      binId = seedLotteryBin('Bin 2', 2);
      gameId = seedLotteryGame();
      packId = seedActivePack(gameId, binId);
      lotteryBusinessDaysDAL.prepareClose(day2.day_id, [
        { pack_id: packId, closing_serial: '020' },
      ]);
      lotteryBusinessDaysDAL.commitClose(day2.day_id, user.user_id);

      // Assert: Both have closed_at for sorting
      const closedDays = db
        .prepare(
          `
        SELECT day_id, closed_at FROM lottery_business_days
        WHERE store_id = ? AND status = 'CLOSED'
        ORDER BY closed_at DESC
      `
        )
        .all(ctx.storeId) as Array<{ day_id: string; closed_at: string }>;

      expect(closedDays.length).toBe(2);
      expect(closedDays[0].day_id).toBe(day2.day_id); // Most recently closed
      expect(closedDays[1].day_id).toBe(day1.day_id);
      expect(closedDays[0].closed_at > closedDays[1].closed_at).toBe(true);
    });
  });

  // ==========================================================================
  // INT-DEFERRED-006: Sync queue contains correct entries
  // ==========================================================================

  describe('INT-DEFERRED-006: Sync queue entries', () => {
    it('should queue day_close sync item', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      syncQueueHistory.length = 0;

      // Act
      const result = await simulateDeferredCommitFlow({
        closings: [{ pack_id: packId, closing_serial: '050' }],
        userId: user.user_id,
      });

      // Assert: day_close in sync queue
      expect(result.success).toBe(true);
      const dayCloseItems = findSyncItemsByType('day_close');
      expect(dayCloseItems.length).toBeGreaterThanOrEqual(1);

      // Verify payload contains required fields
      const payload = dayCloseItems[0].payload as Record<string, unknown>;
      expect(payload.store_id).toBe(ctx.storeId);
    });

    it('should queue day_open sync item for auto-opened day', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      syncQueueHistory.length = 0;

      // Act
      const result = await simulateDeferredCommitFlow({
        closings: [{ pack_id: packId, closing_serial: '050' }],
        userId: user.user_id,
      });

      // Assert: day_open in sync queue
      expect(result.success).toBe(true);
      const dayOpenItems = findSyncItemsByType('day_open');
      expect(dayOpenItems.length).toBeGreaterThanOrEqual(1);

      // Verify opened_by in payload
      const payload = dayOpenItems[0].payload as Record<string, unknown>;
      expect(payload.opened_by).toBe(user.user_id);
    });

    it('should include store_id in all sync items (DB-006)', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      syncQueueHistory.length = 0;

      // Act
      await simulateDeferredCommitFlow({
        closings: [{ pack_id: packId, closing_serial: '050', is_sold_out: true }],
        userId: user.user_id,
      });

      // Assert: All sync items have store_id
      for (const item of syncQueueHistory) {
        expect(item.store_id).toBe(ctx.storeId);
        const payload = item.payload as Record<string, unknown>;
        expect(payload.store_id).toBe(ctx.storeId);
      }
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('should reject prepare if no open day exists', async () => {
      // Arrange: No OPEN day
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Act & Assert
      expect(() => {
        lotteryBusinessDaysDAL.prepareClose('non-existent-day', [
          { pack_id: packId, closing_serial: '050' },
        ]);
      }).toThrow();
    });

    it('should reject commit if day not in PENDING_CLOSE status', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' }); // Still OPEN

      // Act & Assert
      expect(() => {
        lotteryBusinessDaysDAL.commitClose(day.day_id, user.user_id);
      }).toThrow('not in PENDING_CLOSE status');
    });

    it('should reject if pack not found', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });

      // Act & Assert
      expect(() => {
        lotteryBusinessDaysDAL.prepareClose(day.day_id, [
          { pack_id: 'non-existent-pack', closing_serial: '050' },
        ]);
      }).toThrow('Pack not found');
    });

    it('should reject if pack not active', async () => {
      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Mark pack as DEPLETED
      db.prepare(`UPDATE lottery_packs SET status = 'DEPLETED' WHERE pack_id = ?`).run(packId);

      // Act & Assert
      expect(() => {
        lotteryBusinessDaysDAL.prepareClose(day.day_id, [
          { pack_id: packId, closing_serial: '050' },
        ]);
      }).toThrow('not activated');
    });
  });

  // ==========================================================================
  // Tenant Isolation (DB-006)
  // ==========================================================================

  describe('DB-006: Tenant Isolation', () => {
    it('should reject pack from different store', async () => {
      // Arrange: Create pack in different store
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });

      // Create pack in different store
      const otherStoreId = 'other-store-uuid';
      const now = new Date().toISOString();

      db.prepare(
        `
        INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
        VALUES (?, 'other-company', 'Other Store', 'America/New_York', 'ACTIVE', ?, ?)
      `
      ).run(otherStoreId, now, now);

      const gameId = seedLotteryGame();
      const otherPackId = `other-pack-${++uuidCounter}`;
      db.prepare(
        `
        INSERT INTO lottery_packs (
          pack_id, store_id, game_id, pack_number, status, opening_serial,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'OTHER001', 'ACTIVE', '000', ?, ?)
      `
      ).run(otherPackId, otherStoreId, gameId, now, now);

      // Act & Assert
      expect(() => {
        lotteryBusinessDaysDAL.prepareClose(day.day_id, [
          { pack_id: otherPackId, closing_serial: '050' },
        ]);
      }).toThrow('does not belong to this store');
    });
  });
});
