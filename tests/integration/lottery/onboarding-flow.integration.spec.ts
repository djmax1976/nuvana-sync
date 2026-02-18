/**
 * Lottery Onboarding Flow Integration Tests (Phase 6)
 *
 * End-to-end integration tests validating the complete lottery onboarding workflow
 * with database persistence and state restoration across navigation.
 *
 * Business Rule: BIZ-012-FIX - Onboarding mode persists in database
 * - is_onboarding column in lottery_business_days table
 * - State survives navigation (page unmount/remount)
 * - Explicit completion via completeOnboarding handler
 *
 * Test Strategy:
 * - Real SQLite database with all migrations
 * - DAL methods invoked directly (tests database persistence)
 * - Handler logic validated against DAL state
 * - Multi-store scenarios for tenant isolation (MT-011)
 *
 * @module tests/integration/lottery/onboarding-flow
 *
 * Security Compliance:
 * - SEC-006: All queries use parameterized statements
 * - SEC-010: Authorization from authenticated session
 * - SEC-014: Input validation for UUID/serial format
 * - DB-006: Tenant isolation via store_id
 * - API-001: Input validation with Zod schemas
 *
 * Traceability Matrix:
 * - INT-ONB-001: Full onboarding workflow completes successfully
 * - INT-ONB-002: Pack created in inventory during onboarding scan
 * - INT-ONB-003: Pack serial_start from barcode used correctly
 * - INT-ONB-004: Navigation preserves onboarding state
 * - INT-ONB-005: Complete onboarding ends onboarding mode
 * - INT-ONB-006: Post-onboarding activation requires inventory
 * - INT-ONB-007: Multi-store isolation verified
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

const { dbHolder } = vi.hoisted(() => ({
  dbHolder: { instance: null as Database.Database | null },
}));

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
  getDatabase: vi.fn(() => {
    if (!dbHolder.instance) {
      throw new Error('Database not initialized - test setup issue');
    }
    return dbHolder.instance;
  }),
  isDatabaseInitialized: vi.fn(() => dbHolder.instance !== null),
}));

// ============================================================================
// Mock Settings Service
// ============================================================================

let mockPOSType = 'LOTTERY';
vi.mock('../../../src/main/services/settings.service', () => ({
  settingsService: {
    getPOSType: () => mockPOSType,
    getPOSConnectionType: () => 'MANUAL',
    getSetting: vi.fn(),
    setSetting: vi.fn(),
  },
}));

// ============================================================================
// Mock Sync Queue DAL (capture for verification)
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
// Database Reference (after mocks)
// ============================================================================

let db: Database.Database;

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { createServiceTestContext, type ServiceTestContext } from '../../helpers/test-context';
import { setCurrentUser, type SessionUser, type UserRole } from '../../../src/main/ipc/index';
import { lotteryBusinessDaysDAL } from '../../../src/main/dal/lottery-business-days.dal';
import { lotteryPacksDAL } from '../../../src/main/dal/lottery-packs.dal';

// ============================================================================
// Test Suite
// ============================================================================

const describeSuite = SKIP_NATIVE_MODULE_TESTS ? describe.skip : describe;

describeSuite('Lottery Onboarding Flow Integration (Phase 6)', () => {
  let ctx: ServiceTestContext;

  beforeEach(async () => {
    uuidCounter = 0;
    syncQueueHistory.length = 0;
    mockPOSType = 'LOTTERY';

    ctx = await createServiceTestContext({
      storeName: 'Onboarding Flow Integration Store',
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
    const now = new Date().toISOString();
    const gameCode = options?.gameCode ?? `100${uuidCounter}`;
    const price = options?.price ?? 1.0;
    const ticketsPerPack = options?.ticketsPerPack ?? 300;

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
      `Test Game ${uuidCounter}`,
      price,
      ticketsPerPack,
      now,
      now
    );
    return gameId;
  }

  /**
   * Seed a lottery pack in RECEIVED status (ready for activation)
   * SEC-006: Parameterized queries
   */
  function seedReceivedPack(gameId: string, packNumber: string): string {
    const packId = `pack-${++uuidCounter}`;
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO lottery_packs (
        pack_id, store_id, game_id, pack_number, status,
        current_bin_id, opening_serial, received_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'RECEIVED', NULL, NULL, ?, ?, ?)
    `);
    stmt.run(packId, ctx.storeId, gameId, packNumber, now, now, now);
    return packId;
  }

  /**
   * Get pack by ID from database
   * SEC-006: Parameterized query
   */
  function getPackById(packId: string):
    | {
        pack_id: string;
        status: string;
        opening_serial: string | null;
        current_bin_id: string | null;
      }
    | undefined {
    const stmt = db.prepare(`
      SELECT pack_id, status, opening_serial, current_bin_id
      FROM lottery_packs WHERE pack_id = ?
    `);
    return stmt.get(packId) as
      | {
          pack_id: string;
          status: string;
          opening_serial: string | null;
          current_bin_id: string | null;
        }
      | undefined;
  }

  /**
   * Count lottery days for store
   * SEC-006: Parameterized query, DB-006: Store-scoped
   */
  function countDaysForStore(storeId: string): number {
    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM lottery_business_days WHERE store_id = ?
    `);
    const result = stmt.get(storeId) as { count: number };
    return result.count;
  }

  /**
   * Get day by ID from database
   * SEC-006: Parameterized query
   */
  function getDayById(dayId: string):
    | {
        day_id: string;
        store_id: string;
        status: string;
        is_onboarding: number;
        business_date: string;
        opened_at: string;
      }
    | undefined {
    const stmt = db.prepare(`
      SELECT day_id, store_id, status, is_onboarding, business_date, opened_at
      FROM lottery_business_days WHERE day_id = ?
    `);
    return stmt.get(dayId) as
      | {
          day_id: string;
          store_id: string;
          status: string;
          is_onboarding: number;
          business_date: string;
          opened_at: string;
        }
      | undefined;
  }

  /**
   * Create a second store in the same database for multi-tenant tests
   * SEC-006: Parameterized query
   */
  function createSecondStore(): string {
    const store2Id = `store-2-${Date.now()}`;
    const now = new Date().toISOString();

    db.prepare(
      `
      INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
      VALUES (?, 'company-2', 'Store 2', 'America/Los_Angeles', 'ACTIVE', ?, ?)
    `
    ).run(store2Id, now, now);

    return store2Id;
  }

  // ==========================================================================
  // INT-ONB-001: Full Onboarding Workflow
  // ==========================================================================

  describe('INT-ONB-001: Full onboarding workflow completes successfully', () => {
    it('should complete full flow: initialize → is_onboarding=1 → activate → complete → is_onboarding=0', async () => {
      // Arrange: Set up prerequisites (bins and games required for day init)
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      seedLotteryBin('Bin 2', 2);
      const gameId = seedLotteryGame({ gameCode: '0001', price: 5.0, ticketsPerPack: 300 });
      const binId = seedLotteryBin('Bin 3', 3);

      // Verify store has no lottery days (prerequisite for is_first_ever)
      expect(countDaysForStore(ctx.storeId)).toBe(0);

      // Act 1: Verify is_first_ever detection
      const isFirstEver = lotteryBusinessDaysDAL.isFirstEverDay(ctx.storeId);
      expect(isFirstEver).toBe(true);

      // Act 2: Initialize the first business day
      const newDay = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );

      // Assert: Day created, now set onboarding flag (simulating handler behavior)
      expect(newDay.status).toBe('OPEN');

      // Act 3: Set onboarding flag (simulates initializeBusinessDay handler)
      const flagSet = lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, newDay.day_id, true);
      expect(flagSet).toBe(true);

      // Assert: Database reflects is_onboarding = 1
      const dayAfterFlag = getDayById(newDay.day_id);
      expect(dayAfterFlag?.is_onboarding).toBe(1);

      // Act 4: Simulate onboarding pack activation
      // In onboarding mode, we create the pack in inventory AND activate it
      const packId = seedReceivedPack(gameId, '1234567');
      const onboardingSerial = '025'; // Pack was at ticket #25 when scanned

      const activatedPack = lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: onboardingSerial,
        activated_by: user.user_id,
      });

      expect(activatedPack.status).toBe('ACTIVE');
      expect(activatedPack.opening_serial).toBe(onboardingSerial);

      // Act 5: Complete onboarding
      const completeResult = lotteryBusinessDaysDAL.setOnboardingFlag(
        ctx.storeId,
        newDay.day_id,
        false
      );
      expect(completeResult).toBe(true);

      // Assert: Database reflects is_onboarding = 0
      const dayAfterComplete = getDayById(newDay.day_id);
      expect(dayAfterComplete?.is_onboarding).toBe(0);

      // Assert: findOnboardingDay returns null (no longer in onboarding)
      const onboardingDay = lotteryBusinessDaysDAL.findOnboardingDay(ctx.storeId);
      expect(onboardingDay).toBeNull();
    });

    it('should track pack activation with correct opening_serial throughout workflow', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      void seedLotteryBin('Bin 2', 2); // Called for side effect

      // Create day and set onboarding
      const day = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, true);

      // Act: Activate multiple packs with different serials
      const packSerials = [
        { packNumber: 'PACK001', serial: '000' },
        { packNumber: 'PACK002', serial: '050' },
        { packNumber: 'PACK003', serial: '150' },
        { packNumber: 'PACK004', serial: '275' },
      ];

      for (const { packNumber, serial } of packSerials) {
        const packId = seedReceivedPack(gameId, packNumber);
        const newBinId = seedLotteryBin(`Bin for ${packNumber}`, 10 + parseInt(serial));

        lotteryPacksDAL.activate(packId, {
          store_id: ctx.storeId,
          current_bin_id: newBinId,
          opening_serial: serial,
          activated_by: user.user_id,
        });

        // Assert: Database reflects correct serial
        const dbPack = getPackById(packId);
        expect(dbPack?.opening_serial).toBe(serial);
        expect(dbPack?.status).toBe('ACTIVE');
      }

      // Complete onboarding
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, false);

      // Assert: All packs retain their opening_serial after onboarding completes
      for (const { packNumber, serial } of packSerials) {
        const stmt = db.prepare(`SELECT opening_serial FROM lottery_packs WHERE pack_number = ?`);
        const pack = stmt.get(packNumber) as { opening_serial: string } | undefined;
        expect(pack?.opening_serial).toBe(serial);
      }
    });
  });

  // ==========================================================================
  // INT-ONB-002: Pack Created During Onboarding Scan
  // ==========================================================================

  describe('INT-ONB-002: Pack created in inventory during onboarding scan', () => {
    it('should create pack in RECEIVED status then activate to ACTIVE', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame({ gameCode: '1234' });
      const binId = seedLotteryBin('Activation Bin', 2);

      const day = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, true);

      // Act: Create pack via receive (simulates onboarding_mode handler path)
      const receivedPack = lotteryPacksDAL.receive({
        store_id: ctx.storeId,
        game_id: gameId,
        pack_number: '9876543',
        received_by: user.user_id,
      });

      // Assert: Pack created with RECEIVED status
      expect(receivedPack.status).toBe('RECEIVED');
      expect(receivedPack.pack_number).toBe('9876543');

      // Act: Activate the pack
      const activatedPack = lotteryPacksDAL.activate(receivedPack.pack_id, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '025',
        activated_by: user.user_id,
      });

      // Assert: Pack now ACTIVE with correct serial
      expect(activatedPack.status).toBe('ACTIVE');
      expect(activatedPack.opening_serial).toBe('025');
      expect(activatedPack.current_bin_id).toBe(binId);

      // Verify database state
      const dbPack = getPackById(receivedPack.pack_id);
      expect(dbPack?.status).toBe('ACTIVE');
      expect(dbPack?.opening_serial).toBe('025');
    });

    it('should reuse existing RECEIVED pack if same pack_number scanned again', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame({ gameCode: '1234' });
      void seedLotteryBin('Activation Bin', 2); // Called for side effect

      const day = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, true);

      // Act: Create pack first time
      const firstPack = lotteryPacksDAL.receive({
        store_id: ctx.storeId,
        game_id: gameId,
        pack_number: '1111111',
        received_by: user.user_id,
      });

      // Act: Try to find existing pack (simulates handler logic)
      const existingPack = lotteryPacksDAL.findByPackNumber(ctx.storeId, gameId, '1111111');

      // Assert: Should find the existing pack
      expect(existingPack).not.toBeUndefined();
      expect(existingPack?.pack_id).toBe(firstPack.pack_id);
      expect(existingPack?.status).toBe('RECEIVED');
    });
  });

  // ==========================================================================
  // INT-ONB-003: Serial from Barcode Used Correctly
  // ==========================================================================

  describe('INT-ONB-003: Pack serial_start from barcode used correctly', () => {
    it('should persist serial 025 (25 tickets pre-sold)', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedReceivedPack(gameId, '2222222');
      const binId = seedLotteryBin('Bin 2', 2);

      const day = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, true);

      // Act: Activate with serial from barcode
      lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '025',
        activated_by: user.user_id,
      });

      // Assert: Database reflects exact serial
      const dbPack = getPackById(packId);
      expect(dbPack?.opening_serial).toBe('025');
    });

    it('should persist serial 150 (mid-range)', async () => {
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedReceivedPack(gameId, '3333333');
      const binId = seedLotteryBin('Bin 2', 2);

      const day = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, true);

      lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '150',
        activated_by: user.user_id,
      });

      const dbPack = getPackById(packId);
      expect(dbPack?.opening_serial).toBe('150');
    });

    it('should persist serial 000 (new pack, no tickets sold)', async () => {
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedReceivedPack(gameId, '4444444');
      const binId = seedLotteryBin('Bin 2', 2);

      const day = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, true);

      lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '000',
        activated_by: user.user_id,
      });

      const dbPack = getPackById(packId);
      expect(dbPack?.opening_serial).toBe('000');
    });

    it('should persist serial 299 (near end of 300-ticket pack)', async () => {
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame({ ticketsPerPack: 300 });
      const packId = seedReceivedPack(gameId, '5555555');
      const binId = seedLotteryBin('Bin 2', 2);

      const day = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, true);

      lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '299',
        activated_by: user.user_id,
      });

      const dbPack = getPackById(packId);
      expect(dbPack?.opening_serial).toBe('299');
    });
  });

  // ==========================================================================
  // INT-ONB-004: Navigation Preserves Onboarding State
  // ==========================================================================

  describe('INT-ONB-004: Navigation preserves onboarding state', () => {
    it('should return is_onboarding=true after day creation (simulates page mount)', async () => {
      // Arrange: Create first-ever day with onboarding flag
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      seedLotteryGame();

      const day = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, true);

      // Act: Query onboarding status (simulates getOnboardingStatus handler on page mount)
      const onboardingDay = lotteryBusinessDaysDAL.findOnboardingDay(ctx.storeId);

      // Assert: Should find the onboarding day
      expect(onboardingDay).not.toBeNull();
      expect(onboardingDay?.day_id).toBe(day.day_id);
      expect(onboardingDay?.is_onboarding).toBe(1);
    });

    it('should return same state after multiple queries (simulates navigate away and return)', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      seedLotteryGame();

      const day = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, true);

      // Act: First query (page mount)
      const firstQuery = lotteryBusinessDaysDAL.findOnboardingDay(ctx.storeId);

      // Simulate some pack activations
      const gameId = seedLotteryGame({ gameCode: '9999' });
      const packId = seedReceivedPack(gameId, '7777777');
      const binId = seedLotteryBin('Bin 2', 2);
      lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '100',
        activated_by: user.user_id,
      });

      // Act: Second query (simulates user navigated to Settings, then back to Lottery)
      const secondQuery = lotteryBusinessDaysDAL.findOnboardingDay(ctx.storeId);

      // Act: Third query (another navigation cycle)
      const thirdQuery = lotteryBusinessDaysDAL.findOnboardingDay(ctx.storeId);

      // Assert: All queries return the same onboarding day
      expect(firstQuery?.day_id).toBe(day.day_id);
      expect(secondQuery?.day_id).toBe(day.day_id);
      expect(thirdQuery?.day_id).toBe(day.day_id);

      // Assert: Still in onboarding mode
      expect(firstQuery?.is_onboarding).toBe(1);
      expect(secondQuery?.is_onboarding).toBe(1);
      expect(thirdQuery?.is_onboarding).toBe(1);
    });

    it('should preserve activated packs after navigation (visible on return)', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();

      const day = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, true);

      // Act: Activate some packs
      const activatedPacks: string[] = [];
      for (let i = 0; i < 3; i++) {
        const packId = seedReceivedPack(gameId, `NAV${i}0000`);
        const binId = seedLotteryBin(`Nav Bin ${i}`, 100 + i);
        lotteryPacksDAL.activate(packId, {
          store_id: ctx.storeId,
          current_bin_id: binId,
          opening_serial: String(i * 10).padStart(3, '0'),
          activated_by: user.user_id,
        });
        activatedPacks.push(packId);
      }

      // Simulate navigation (state should persist in DB)

      // Act: Query packs after "returning" to page
      const stmt = db.prepare(`
        SELECT pack_id, status, opening_serial
        FROM lottery_packs
        WHERE store_id = ? AND status = 'ACTIVE'
        ORDER BY pack_number
      `);
      const packsAfterNav = stmt.all(ctx.storeId) as {
        pack_id: string;
        status: string;
        opening_serial: string;
      }[];

      // Assert: All activated packs still visible
      expect(packsAfterNav.length).toBe(3);
      expect(packsAfterNav.map((p) => p.pack_id).sort()).toEqual(activatedPacks.sort());
    });
  });

  // ==========================================================================
  // INT-ONB-005: Complete Onboarding Ends Mode
  // ==========================================================================

  describe('INT-ONB-005: Complete onboarding ends onboarding mode', () => {
    it('should set is_onboarding=0 after completeOnboarding', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      seedLotteryGame();

      const day = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, true);

      // Verify in onboarding mode
      expect(lotteryBusinessDaysDAL.findOnboardingDay(ctx.storeId)).not.toBeNull();

      // Act: Complete onboarding
      const result = lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, false);

      // Assert: Update succeeded
      expect(result).toBe(true);

      // Assert: No longer in onboarding mode
      expect(lotteryBusinessDaysDAL.findOnboardingDay(ctx.storeId)).toBeNull();

      // Assert: Database reflects is_onboarding = 0
      const dayAfter = getDayById(day.day_id);
      expect(dayAfter?.is_onboarding).toBe(0);
    });

    it('should be idempotent (completing already-complete returns true)', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      seedLotteryGame();

      const day = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, true);
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, false);

      // Act: Complete again
      const result = lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, false);

      // Assert: Should succeed (idempotent)
      expect(result).toBe(true);
      expect(lotteryBusinessDaysDAL.findOnboardingDay(ctx.storeId)).toBeNull();
    });

    it('should return false for non-existent day_id', async () => {
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      // Act: Try to complete onboarding for non-existent day
      const result = lotteryBusinessDaysDAL.setOnboardingFlag(
        ctx.storeId,
        'non-existent-day-id',
        false
      );

      // Assert: Should fail
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // INT-ONB-006: Post-Onboarding Activation Requires Inventory
  // ==========================================================================

  describe('INT-ONB-006: Post-onboarding activation requires inventory', () => {
    it('should fail to activate non-existent pack after onboarding completes', async () => {
      // Arrange: Complete full onboarding workflow
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      void seedLotteryGame(); // Called for side effect
      void seedLotteryBin('Activation Bin', 2); // Called for side effect

      // Create day, set onboarding, then complete
      const day = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, true);
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, false);

      // Verify onboarding is complete
      expect(lotteryBusinessDaysDAL.findOnboardingDay(ctx.storeId)).toBeNull();

      // Act: Try to find a non-existent pack (simulates normal activation flow)
      const nonExistentPack = lotteryPacksDAL.findByIdForStore(ctx.storeId, 'non-existent-pack-id');

      // Assert: Pack not found
      expect(nonExistentPack).toBeUndefined();
    });

    it('should successfully activate existing pack after onboarding completes', async () => {
      // Arrange: Set up post-onboarding scenario with existing inventory
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const binId = seedLotteryBin('Activation Bin', 2);

      // Create day, set onboarding, then complete
      const day = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, true);
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, false);

      // Create a pack in inventory (via normal receive flow)
      const receivedPack = lotteryPacksDAL.receive({
        store_id: ctx.storeId,
        game_id: gameId,
        pack_number: '8888888',
        received_by: user.user_id,
      });

      // Act: Activate the existing pack (normal mode, not onboarding)
      const activatedPack = lotteryPacksDAL.activate(receivedPack.pack_id, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '000', // Default serial in normal mode
        activated_by: user.user_id,
      });

      // Assert: Pack activated successfully
      expect(activatedPack.status).toBe('ACTIVE');
      expect(activatedPack.opening_serial).toBe('000');
    });

    it('should require pack to exist in inventory for activation after onboarding', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      seedLotteryGame();
      void seedLotteryBin('Activation Bin', 2); // Called for side effect

      // Complete onboarding
      const day = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, true);
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, day.day_id, false);

      // Act: Try to look up pack by pack_number when not in inventory
      const packLookup = lotteryPacksDAL.findByPackNumber(ctx.storeId, 'any-game-id', '9999999');

      // Assert: Pack not found (would require onboarding_mode to create)
      expect(packLookup).toBeUndefined();
    });
  });

  // ==========================================================================
  // INT-ONB-007: Multi-Store Isolation
  // ==========================================================================

  describe('INT-ONB-007: Multi-store isolation verified (MT-011, DB-006)', () => {
    it('should detect onboarding independently per store', async () => {
      // Arrange: Set up two stores
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      seedLotteryGame();

      const store2Id = createSecondStore();

      // Act: Create onboarding day for Store A only
      const dayStoreA = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, dayStoreA.day_id, true);

      // Assert: Store A is in onboarding, Store B is not
      const onboardingStoreA = lotteryBusinessDaysDAL.findOnboardingDay(ctx.storeId);
      const onboardingStoreB = lotteryBusinessDaysDAL.findOnboardingDay(store2Id);

      expect(onboardingStoreA).not.toBeNull();
      expect(onboardingStoreA?.day_id).toBe(dayStoreA.day_id);
      expect(onboardingStoreB).toBeNull();
    });

    it('should not allow Store B to complete onboarding for Store A day', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      seedLotteryGame();

      const store2Id = createSecondStore();

      // Create onboarding day for Store A
      const dayStoreA = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, dayStoreA.day_id, true);

      // Act: Try to complete Store A's onboarding using Store B's context
      // DB-006: setOnboardingFlag requires matching store_id
      const result = lotteryBusinessDaysDAL.setOnboardingFlag(store2Id, dayStoreA.day_id, false);

      // Assert: Should fail (wrong store)
      expect(result).toBe(false);

      // Assert: Store A still in onboarding
      const stillOnboarding = lotteryBusinessDaysDAL.findOnboardingDay(ctx.storeId);
      expect(stillOnboarding).not.toBeNull();
      expect(stillOnboarding?.is_onboarding).toBe(1);
    });

    it('should allow independent onboarding for both stores', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      seedLotteryGame();

      const store2Id = createSecondStore();

      // Seed bins and games for store 2
      const now = new Date().toISOString();
      db.prepare(
        `
        INSERT INTO lottery_bins (bin_id, store_id, name, display_order, is_active, created_at, updated_at)
        VALUES (?, ?, 'Store 2 Bin', 1, 1, ?, ?)
      `
      ).run('store2-bin-1', store2Id, now, now);

      db.prepare(
        `
        INSERT INTO lottery_games (game_id, store_id, game_code, name, price, tickets_per_pack, status, created_at, updated_at)
        VALUES (?, ?, '9999', 'Store 2 Game', 1.0, 300, 'ACTIVE', ?, ?)
      `
      ).run('store2-game-1', store2Id, now, now);

      // Act: Create onboarding days for both stores
      const dayStoreA = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, dayStoreA.day_id, true);

      const dayStoreB = lotteryBusinessDaysDAL.getOrCreateForDate(
        store2Id,
        ctx.utils.today(),
        user.user_id
      );
      lotteryBusinessDaysDAL.setOnboardingFlag(store2Id, dayStoreB.day_id, true);

      // Assert: Both stores are in onboarding independently
      const onboardingA = lotteryBusinessDaysDAL.findOnboardingDay(ctx.storeId);
      const onboardingB = lotteryBusinessDaysDAL.findOnboardingDay(store2Id);

      expect(onboardingA).not.toBeNull();
      expect(onboardingB).not.toBeNull();
      expect(onboardingA?.day_id).toBe(dayStoreA.day_id);
      expect(onboardingB?.day_id).toBe(dayStoreB.day_id);

      // Act: Complete onboarding for Store A only
      lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, dayStoreA.day_id, false);

      // Assert: Store A completed, Store B still onboarding
      expect(lotteryBusinessDaysDAL.findOnboardingDay(ctx.storeId)).toBeNull();
      expect(lotteryBusinessDaysDAL.findOnboardingDay(store2Id)).not.toBeNull();
    });

    it('should count days independently per store (DB-006)', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      seedLotteryGame();

      const store2Id = createSecondStore();

      // Create multiple days for Store A
      const day1 = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.businessDate(-2),
        user.user_id
      );
      db.prepare(`UPDATE lottery_business_days SET status = 'CLOSED' WHERE day_id = ?`).run(
        day1.day_id
      );

      const day2 = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.businessDate(-1),
        user.user_id
      );
      db.prepare(`UPDATE lottery_business_days SET status = 'CLOSED' WHERE day_id = ?`).run(
        day2.day_id
      );

      lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, ctx.utils.today(), user.user_id);

      // Assert: Store A has 3 days, Store B has 0
      expect(lotteryBusinessDaysDAL.countAllDays(ctx.storeId)).toBe(3);
      expect(lotteryBusinessDaysDAL.countAllDays(store2Id)).toBe(0);

      // Assert: isFirstEverDay reflects tenant isolation
      expect(lotteryBusinessDaysDAL.isFirstEverDay(ctx.storeId)).toBe(false);
      expect(lotteryBusinessDaysDAL.isFirstEverDay(store2Id)).toBe(true);
    });
  });

  // ==========================================================================
  // Additional Security Compliance Tests
  // ==========================================================================

  describe('Security Compliance Verification', () => {
    describe('SEC-006: SQL Injection Prevention', () => {
      const SQL_INJECTION_PAYLOADS = [
        "'; DROP TABLE lottery_business_days; --",
        "' OR '1'='1",
        '1; DELETE FROM lottery_business_days;',
        "' UNION SELECT * FROM stores --",
      ];

      it('should safely handle SQL injection in setOnboardingFlag dayId', () => {
        const user = createTestUser('shift_manager');
        setCurrentUser(user);

        seedLotteryBin('Bin 1', 1);
        seedLotteryGame();

        // Create a real day first
        const day = lotteryBusinessDaysDAL.getOrCreateForDate(
          ctx.storeId,
          ctx.utils.today(),
          user.user_id
        );

        for (const payload of SQL_INJECTION_PAYLOADS) {
          // Should not throw, and should return false (no matching row)
          expect(() => {
            const result = lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, payload, true);
            expect(result).toBe(false);
          }).not.toThrow();
        }

        // Verify table still exists and data intact
        expect(countDaysForStore(ctx.storeId)).toBe(1);
        expect(getDayById(day.day_id)).not.toBeUndefined();
      });

      it('should safely handle SQL injection in findOnboardingDay storeId', () => {
        for (const payload of SQL_INJECTION_PAYLOADS) {
          expect(() => {
            const result = lotteryBusinessDaysDAL.findOnboardingDay(payload);
            expect(result).toBeNull();
          }).not.toThrow();
        }
      });
    });

    describe('DB-006: Tenant Isolation Enforcement', () => {
      it('should not expose Store A data to Store B queries', async () => {
        const user = createTestUser('shift_manager');
        setCurrentUser(user);

        seedLotteryBin('Bin 1', 1);
        const gameId = seedLotteryGame();

        const store2Id = createSecondStore();

        // Create day with onboarding for Store A
        const dayStoreA = lotteryBusinessDaysDAL.getOrCreateForDate(
          ctx.storeId,
          ctx.utils.today(),
          user.user_id
        );
        lotteryBusinessDaysDAL.setOnboardingFlag(ctx.storeId, dayStoreA.day_id, true);

        // Create a pack for Store A
        const packA = seedReceivedPack(gameId, 'STOREA01');
        const binA = seedLotteryBin('Store A Bin', 2);
        lotteryPacksDAL.activate(packA, {
          store_id: ctx.storeId,
          current_bin_id: binA,
          opening_serial: '050',
          activated_by: user.user_id,
        });

        // Assert: Store B cannot see Store A's pack
        const packFromB = lotteryPacksDAL.findByIdForStore(store2Id, packA);
        expect(packFromB).toBeUndefined();

        // Assert: Store B cannot see Store A's onboarding day
        const dayFromB = lotteryBusinessDaysDAL.findOnboardingDay(store2Id);
        expect(dayFromB).toBeNull();

        // Assert: Store B's day count is independent
        expect(lotteryBusinessDaysDAL.countAllDays(store2Id)).toBe(0);
      });
    });
  });
});
