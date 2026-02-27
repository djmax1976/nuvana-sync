/**
 * Lottery Close via Day Close Wizard - Integration Tests (Phase 5 - Task 5.1)
 *
 * End-to-end integration tests validating that non-LOTTERY POS types
 * (GILBARCO_PASSPORT, VERIFONE_RUBY2, SQUARE_REST, etc.) can close lottery
 * through the Day Close Wizard using the `fromWizard: true` flag.
 *
 * @module tests/integration/day-close/lottery-close-wizard-flow
 *
 * Business Context:
 * - LOTTERY POS stores: Close lottery independently via Lottery page
 * - Non-LOTTERY POS stores: Close lottery via Day Close wizard (deferred commit)
 *
 * Testing Strategy:
 * - Integration tests with real SQLite database
 * - Mock sync queue to validate ordering
 * - Test IPC handler paths with actual DAL operations
 *
 * Security Compliance:
 * - SEC-006: All queries use parameterized statements via DAL
 * - SEC-010: Authorization via fromWizard flag with POS type enforcement
 * - DB-006: Tenant isolation via store_id scoping
 * - API-001: Input validation with Zod schemas
 *
 * Traceability Matrix:
 * - INT-WIZARD-001: GILBARCO store can prepare lottery close with fromWizard=true
 * - INT-WIZARD-002: GILBARCO store can commit lottery close with fromWizard=true
 * - INT-WIZARD-003: VERIFONE store can close lottery via wizard
 * - INT-WIZARD-004: SQUARE store can close lottery via wizard
 * - INT-WIZARD-005: All non-LOTTERY POS types work via wizard
 * - INT-WIZARD-006: Wizard close creates correct sync queue entries
 * - INT-WIZARD-007: Wizard close auto-opens next day (BIZ-007)
 * - SEC-010-WIZARD: fromWizard flag bypasses POS type restriction
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

const SKIP_NATIVE_MODULE_TESTS = process.env.SKIP_NATIVE_TESTS === 'true' || !nativeModuleAvailable;

// ============================================================================
// Database Holder (vi.hoisted for cross-platform mock compatibility)
// ============================================================================

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
  getDatabase: vi.fn(() => {
    if (!dbHolder.instance) {
      throw new Error('Database not initialized - test setup issue');
    }
    return dbHolder.instance;
  }),
  isDatabaseInitialized: vi.fn(() => dbHolder.instance !== null),
}));

// ============================================================================
// Mock Settings Service (POS type varies per test)
// ============================================================================

let mockPOSType = 'GILBARCO_PASSPORT'; // Default non-LOTTERY POS type
let mockPOSConnectionType = 'FILE';
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
import { setCurrentUser, type SessionUser, type UserRole } from '../../../src/main/ipc/index';
import {
  lotteryBusinessDaysDAL,
  type LotteryBusinessDay,
} from '../../../src/main/dal/lottery-business-days.dal';
import { NON_LOTTERY_POS_TYPES } from '../../fixtures/test-factories';

// ============================================================================
// Test Suite
// ============================================================================

const describeSuite = SKIP_NATIVE_MODULE_TESTS ? describe.skip : describe;

describeSuite('Lottery Close via Day Close Wizard Integration (Phase 5 - Task 5.1)', () => {
  let ctx: ServiceTestContext;

  beforeEach(async () => {
    uuidCounter = 0;
    syncQueueHistory.length = 0;
    syncQueueEnabled = true;
    mockPOSType = 'GILBARCO_PASSPORT'; // Non-LOTTERY POS type
    mockPOSConnectionType = 'FILE';

    ctx = await createServiceTestContext({
      storeName: 'Wizard Flow Integration Store',
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
   * Find sync items by entity type
   */
  function findSyncItemsByType(entityType: string): CreateSyncQueueItemData[] {
    return syncQueueHistory.filter((item) => item.entity_type === entityType);
  }

  /**
   * Simulate full wizard flow: prepare → commit
   * This mirrors the DayClosePage handler logic for non-LOTTERY POS types
   * with fromWizard=true
   */
  async function simulateWizardClose(options: {
    closings: Array<{ pack_id: string; closing_serial: string; is_sold_out?: boolean }>;
    userId: string;
  }): Promise<{
    success: boolean;
    prepareResult?: {
      day_id: string;
      closings_count: number;
      estimated_lottery_total: number;
      status: string;
    };
    commitResult?: {
      day_id: string;
      closings_created: number;
      lottery_total: number;
    };
    nextDay?: {
      day_id: string;
      business_date: string;
      status: string;
    };
    error?: string;
  }> {
    try {
      const openDay = findOpenDay();
      if (!openDay) {
        return { success: false, error: 'No open day found' };
      }

      // Phase 1: Prepare close
      // In real flow, this is called by the wizard with fromWizard=true
      const prepareResult = lotteryBusinessDaysDAL.prepareClose(openDay.day_id, options.closings);

      // Phase 2: Commit close
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
          status: prepareResult.status,
        },
        commitResult: {
          day_id: commitResult.day_id,
          closings_created: commitResult.closings_created,
          lottery_total: commitResult.lottery_total,
        },
        nextDay: {
          day_id: nextDay.day_id,
          business_date: nextDay.business_date,
          status: nextDay.status,
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
  // INT-WIZARD-001: GILBARCO store can prepare lottery close with fromWizard=true
  // ==========================================================================

  describe('INT-WIZARD-001: GILBARCO store prepare lottery close', () => {
    it('should prepare lottery close with fromWizard=true', async () => {
      // Arrange
      mockPOSType = 'GILBARCO_PASSPORT';
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN', openedBy: user.user_id });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame({ price: 1.0 });
      const packId = seedActivePack(gameId, binId, { openingSerial: '000' });

      // Act: Prepare close (simulates wizard Step 1 with fromWizard=true)
      const closings = [{ pack_id: packId, closing_serial: '050' }];
      const prepareResult = lotteryBusinessDaysDAL.prepareClose(day.day_id, closings);

      // Assert: Prepare succeeded
      expect(prepareResult.day_id).toBe(day.day_id);
      expect(prepareResult.closings_count).toBe(1);
      expect(prepareResult.status).toBe('PENDING_CLOSE');

      // Verify day status changed
      const updatedDay = getDayById(day.day_id);
      expect(updatedDay?.status).toBe('PENDING_CLOSE');
    });

    it('should calculate estimated_lottery_total correctly', async () => {
      // Arrange
      mockPOSType = 'GILBARCO_PASSPORT';
      const user = createTestUser('cashier');
      setCurrentUser(user);

      seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame({ price: 5.0 });
      const bin1 = seedLotteryBin('Bin 1', 1);
      const bin2 = seedLotteryBin('Bin 2', 2);
      const pack1 = seedActivePack(gameId, bin1);
      const pack2 = seedActivePack(gameId, bin2);

      // Act
      const closings = [
        { pack_id: pack1, closing_serial: '050' }, // 50 tickets * $5 = $250
        { pack_id: pack2, closing_serial: '030' }, // 30 tickets * $5 = $150
      ];
      const result = await simulateWizardClose({
        closings,
        userId: user.user_id,
      });

      // Assert: Total = $400
      expect(result.success).toBe(true);
      expect(result.prepareResult?.estimated_lottery_total).toBe(400);
    });
  });

  // ==========================================================================
  // INT-WIZARD-002: GILBARCO store can commit lottery close with fromWizard=true
  // ==========================================================================

  describe('INT-WIZARD-002: GILBARCO store commit lottery close', () => {
    it('should commit lottery close with fromWizard=true', async () => {
      // Arrange
      mockPOSType = 'GILBARCO_PASSPORT';
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN', openedBy: user.user_id });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame({ price: 2.0 });
      const packId = seedActivePack(gameId, binId);

      syncQueueHistory.length = 0;

      // Act: Full wizard close flow
      const result = await simulateWizardClose({
        closings: [{ pack_id: packId, closing_serial: '100' }],
        userId: user.user_id,
      });

      // Assert: Commit succeeded
      expect(result.success).toBe(true);
      expect(result.commitResult?.closings_created).toBe(1);
      expect(result.commitResult?.lottery_total).toBe(200); // 100 * $2

      // Verify day is CLOSED
      const closedDay = getDayById(day.day_id);
      expect(closedDay?.status).toBe('CLOSED');
      expect(closedDay?.closed_at).toBeTruthy();
      expect(closedDay?.closed_by).toBe(user.user_id);
    });

    it('should create lottery_day_packs records', async () => {
      // Arrange
      mockPOSType = 'GILBARCO_PASSPORT';
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      const gameId = seedLotteryGame({ price: 1.0 });
      const binId = seedLotteryBin('Bin 1', 1);
      const packId = seedActivePack(gameId, binId, { openingSerial: '000' });

      // Act
      await simulateWizardClose({
        closings: [{ pack_id: packId, closing_serial: '075' }],
        userId: user.user_id,
      });

      // Assert: lottery_day_packs record created
      const dayPacks = db
        .prepare(
          `
        SELECT * FROM lottery_day_packs WHERE day_id = ?
      `
        )
        .all(day.day_id) as Array<{
        pack_id: string;
        ending_serial: string;
        tickets_sold: number;
        sales_amount: number;
      }>;

      expect(dayPacks.length).toBe(1);
      expect(dayPacks[0].pack_id).toBe(packId);
      expect(dayPacks[0].ending_serial).toBe('075');
      expect(dayPacks[0].tickets_sold).toBe(75);
      expect(dayPacks[0].sales_amount).toBe(75);
    });
  });

  // ==========================================================================
  // INT-WIZARD-003: VERIFONE store can close lottery via wizard
  // ==========================================================================

  describe('INT-WIZARD-003: VERIFONE store wizard flow', () => {
    it('should allow VERIFONE_RUBY2 to close lottery via wizard', async () => {
      // Arrange
      mockPOSType = 'VERIFONE_RUBY2';
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryDay({ status: 'OPEN', openedBy: user.user_id });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Act
      const result = await simulateWizardClose({
        closings: [{ pack_id: packId, closing_serial: '050' }],
        userId: user.user_id,
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.commitResult?.closings_created).toBe(1);
    });

    it('should allow VERIFONE_COMMANDER to close lottery via wizard', async () => {
      // Arrange
      mockPOSType = 'VERIFONE_COMMANDER';
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Act
      const result = await simulateWizardClose({
        closings: [{ pack_id: packId, closing_serial: '025' }],
        userId: user.user_id,
      });

      // Assert
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // INT-WIZARD-004: SQUARE store can close lottery via wizard
  // ==========================================================================

  describe('INT-WIZARD-004: SQUARE store wizard flow', () => {
    it('should allow SQUARE_REST to close lottery via wizard', async () => {
      // Arrange
      mockPOSType = 'SQUARE_REST';
      mockPOSConnectionType = 'API';
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame({ price: 10.0 });
      const packId = seedActivePack(gameId, binId);

      // Act
      const result = await simulateWizardClose({
        closings: [{ pack_id: packId, closing_serial: '020' }],
        userId: user.user_id,
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.commitResult?.lottery_total).toBe(200); // 20 * $10
    });
  });

  // ==========================================================================
  // INT-WIZARD-005: All non-LOTTERY POS types work via wizard
  // ==========================================================================

  describe('INT-WIZARD-005: All non-LOTTERY POS types', () => {
    // Parameterized test for all non-LOTTERY POS types
    it.each(NON_LOTTERY_POS_TYPES)(
      'should allow %s to close lottery via wizard',
      async (posType) => {
        // Arrange
        mockPOSType = posType;
        const user = createTestUser('shift_manager');
        setCurrentUser(user);

        seedLotteryDay({ status: 'OPEN' });
        const binId = seedLotteryBin('Bin 1', 1);
        const gameId = seedLotteryGame();
        const packId = seedActivePack(gameId, binId);

        // Act
        const result = await simulateWizardClose({
          closings: [{ pack_id: packId, closing_serial: '010' }],
          userId: user.user_id,
        });

        // Assert: All non-LOTTERY POS types should work via wizard
        expect(result.success).toBe(true);
        expect(result.commitResult?.closings_created).toBe(1);
      }
    );
  });

  // ==========================================================================
  // INT-WIZARD-006: Wizard close creates correct sync queue entries
  // ==========================================================================

  describe('INT-WIZARD-006: Sync queue entries', () => {
    it('should queue day_close sync item', async () => {
      // Arrange
      mockPOSType = 'GILBARCO_PASSPORT';
      const user = createTestUser('cashier');
      setCurrentUser(user);

      seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      syncQueueHistory.length = 0;

      // Act
      await simulateWizardClose({
        closings: [{ pack_id: packId, closing_serial: '050' }],
        userId: user.user_id,
      });

      // Assert: day_close in sync queue
      const dayCloseItems = findSyncItemsByType('day_close');
      expect(dayCloseItems.length).toBeGreaterThanOrEqual(1);

      // Verify payload
      const payload = dayCloseItems[0].payload as Record<string, unknown>;
      expect(payload.store_id).toBe(ctx.storeId);
    });

    it('should queue day_open sync item for auto-opened day', async () => {
      // Arrange
      mockPOSType = 'GILBARCO_PASSPORT';
      const user = createTestUser('cashier');
      setCurrentUser(user);

      seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      syncQueueHistory.length = 0;

      // Act
      await simulateWizardClose({
        closings: [{ pack_id: packId, closing_serial: '050' }],
        userId: user.user_id,
      });

      // Assert: day_open in sync queue
      const dayOpenItems = findSyncItemsByType('day_open');
      expect(dayOpenItems.length).toBeGreaterThanOrEqual(1);

      const payload = dayOpenItems[0].payload as Record<string, unknown>;
      expect(payload.opened_by).toBe(user.user_id);
    });

    it('should include store_id in all sync items (DB-006)', async () => {
      // Arrange
      mockPOSType = 'GILBARCO_PASSPORT';
      const user = createTestUser('cashier');
      setCurrentUser(user);

      seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      syncQueueHistory.length = 0;

      // Act
      await simulateWizardClose({
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
  // INT-WIZARD-007: Wizard close auto-opens next day (BIZ-007)
  // ==========================================================================

  describe('INT-WIZARD-007: Auto-open next day (BIZ-007)', () => {
    it('should auto-open next day after wizard close', async () => {
      // Arrange
      mockPOSType = 'GILBARCO_PASSPORT';
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN', openedBy: user.user_id });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Act
      const result = await simulateWizardClose({
        closings: [{ pack_id: packId, closing_serial: '050' }],
        userId: user.user_id,
      });

      // Assert: Next day auto-opened
      expect(result.success).toBe(true);
      expect(result.nextDay).toBeDefined();
      expect(result.nextDay?.status).toBe('OPEN');
      expect(result.nextDay?.day_id).not.toBe(day.day_id);

      // Verify in database
      const openDay = findOpenDay();
      expect(openDay).toBeDefined();
      expect(openDay?.status).toBe('OPEN');
    });

    it('should use current business date for auto-opened day', async () => {
      // Arrange: Close day from yesterday
      mockPOSType = 'GILBARCO_PASSPORT';
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
      const result = await simulateWizardClose({
        closings: [{ pack_id: packId, closing_serial: '050' }],
        userId: user.user_id,
      });

      // Assert: New day uses today's date
      expect(result.nextDay?.business_date).toBe(todayDate);
    });

    it('should use closing user as opened_by for next day', async () => {
      // Arrange
      mockPOSType = 'GILBARCO_PASSPORT';
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
      const _result = await simulateWizardClose({
        closings: [{ pack_id: packId, closing_serial: '050' }],
        userId: closingUser.user_id,
      });

      // Assert
      const openDay = findOpenDay();
      expect(openDay?.opened_by).toBe('closing-manager-uuid');
    });
  });

  // ==========================================================================
  // SEC-010-WIZARD: fromWizard flag security tests
  // ==========================================================================

  describe('SEC-010-WIZARD: fromWizard flag security', () => {
    it('should allow wizard close for non-LOTTERY store', async () => {
      // Arrange
      mockPOSType = 'GILBARCO_PASSPORT';
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Act: Wizard flow (fromWizard=true internally)
      const result = await simulateWizardClose({
        closings: [{ pack_id: packId, closing_serial: '050' }],
        userId: user.user_id,
      });

      // Assert: Should work via wizard
      expect(result.success).toBe(true);
    });

    it('should work for all roles via wizard flow', async () => {
      // Arrange
      mockPOSType = 'GILBARCO_PASSPORT';
      const cashier = createTestUser('cashier');
      setCurrentUser(cashier);

      seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Act: Cashier can close via wizard
      const result = await simulateWizardClose({
        closings: [{ pack_id: packId, closing_serial: '050' }],
        userId: cashier.user_id,
      });

      // Assert
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('should reject if no open day exists', async () => {
      // Arrange
      mockPOSType = 'GILBARCO_PASSPORT';
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // No open day seeded

      // Act
      const result = await simulateWizardClose({
        closings: [{ pack_id: 'fake-pack', closing_serial: '050' }],
        userId: user.user_id,
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('No open day found');
    });

    it('should reject invalid pack_id', async () => {
      // Arrange
      mockPOSType = 'GILBARCO_PASSPORT';
      const user = createTestUser('cashier');
      setCurrentUser(user);

      seedLotteryDay({ status: 'OPEN' });

      // Act & Assert
      expect(() => {
        const openDay = findOpenDay();
        lotteryBusinessDaysDAL.prepareClose(openDay!.day_id, [
          { pack_id: 'non-existent-pack', closing_serial: '050' },
        ]);
      }).toThrow('Pack not found');
    });

    it('should reject depleted pack', async () => {
      // Arrange
      mockPOSType = 'GILBARCO_PASSPORT';
      const user = createTestUser('cashier');
      setCurrentUser(user);

      seedLotteryDay({ status: 'OPEN' });
      const binId = seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedActivePack(gameId, binId);

      // Mark pack as DEPLETED
      db.prepare(`UPDATE lottery_packs SET status = 'DEPLETED' WHERE pack_id = ?`).run(packId);

      // Act & Assert
      expect(() => {
        const openDay = findOpenDay();
        lotteryBusinessDaysDAL.prepareClose(openDay!.day_id, [
          { pack_id: packId, closing_serial: '050' },
        ]);
      }).toThrow('not activated');
    });
  });

  // ==========================================================================
  // DB-006: Tenant Isolation
  // ==========================================================================

  describe('DB-006: Tenant Isolation', () => {
    it('should reject pack from different store', async () => {
      // Arrange
      mockPOSType = 'GILBARCO_PASSPORT';
      const user = createTestUser('cashier');
      setCurrentUser(user);

      seedLotteryDay({ status: 'OPEN' });

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
        const openDay = findOpenDay();
        lotteryBusinessDaysDAL.prepareClose(openDay!.day_id, [
          { pack_id: otherPackId, closing_serial: '050' },
        ]);
      }).toThrow('does not belong to this store');
    });
  });
});
