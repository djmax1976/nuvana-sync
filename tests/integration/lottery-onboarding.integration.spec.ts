/**
 * Lottery Onboarding Integration Tests (Phase 4)
 *
 * End-to-end integration tests validating the complete lottery onboarding flow:
 * - BIZ-010: First-ever day detection enables onboarding mode
 * - BIZ-010: Partial packs activated with correct opening_serial from barcode scan
 * - Cloud sync verification: opening_serial flows to sync queue payload
 *
 * Test Strategy:
 * - Real SQLite database with all migrations
 * - Mocked sync queue to capture payloads for verification
 * - Multi-store scenarios for tenant isolation (MT-011)
 *
 * @module tests/integration/lottery-onboarding
 *
 * Security Compliance:
 * - SEC-006: All queries use parameterized statements
 * - SEC-010: Authorization from authenticated session
 * - SEC-014: Input validation for barcode/serial format
 * - DB-006: Tenant isolation via store_id
 * - API-001: Input validation with Zod schemas
 *
 * Traceability Matrix:
 * - INT-ONB-001: Full flow: new store → initialize → onboarding → activate → complete
 * - INT-ONB-002: is_first_ever=true triggers onboarding mode
 * - INT-ONB-003: is_first_ever=false for stores with history
 * - INT-ONB-004: opening_serial from barcode flows to database
 * - INT-ONB-005: opening_serial flows to sync queue payload
 * - INT-ONB-006: Multi-store isolation (MT-011)
 * - INT-ONB-007: Partial pack activation with various serials (025, 150, 000, 299)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import type { CreateSyncQueueItemData } from '../../src/main/dal/sync-queue.dal';

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

// Use vi.hoisted() to ensure the database holder is available when vi.mock runs
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
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

vi.mock('../../src/main/services/database.service', () => ({
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
vi.mock('../../src/main/services/settings.service', () => ({
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

vi.mock('../../src/main/dal/sync-queue.dal', () => ({
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

vi.mock('../../src/main/utils/logger', () => ({
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

import { createServiceTestContext, type ServiceTestContext } from '../helpers/test-context';
import { setCurrentUser, type SessionUser, type UserRole } from '../../src/main/ipc/index';
import { lotteryBusinessDaysDAL } from '../../src/main/dal/lottery-business-days.dal';
import { lotteryPacksDAL } from '../../src/main/dal/lottery-packs.dal';

// ============================================================================
// Test Suite
// ============================================================================

const describeSuite = SKIP_NATIVE_MODULE_TESTS ? describe.skip : describe;

describeSuite('Lottery Onboarding Integration (Phase 4)', () => {
  let ctx: ServiceTestContext;

  beforeEach(async () => {
    uuidCounter = 0;
    syncQueueHistory.length = 0;
    mockPOSType = 'LOTTERY';

    ctx = await createServiceTestContext({
      storeName: 'Lottery Onboarding Integration Store',
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
   * Find sync items by entity type
   */
  function findSyncItemsByType(entityType: string): CreateSyncQueueItemData[] {
    return syncQueueHistory.filter((item) => item.entity_type === entityType);
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

  // ==========================================================================
  // INT-ONB-001: Full flow: new store → initialize → onboarding → activate → complete
  // ==========================================================================

  describe('INT-ONB-001: Full Onboarding Flow', () => {
    it('should complete full flow: new store → initialize → detect first-ever → activate with serial', async () => {
      // Arrange: Set up prerequisites (bins and games required for day init)
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      seedLotteryBin('Bin 2', 2);
      const gameId = seedLotteryGame({ gameCode: '0001', price: 5.0, ticketsPerPack: 300 });
      const packId = seedReceivedPack(gameId, '1234567');
      const binId = seedLotteryBin('Bin 3', 3);

      // Verify store has no lottery days (prerequisite for is_first_ever)
      expect(countDaysForStore(ctx.storeId)).toBe(0);

      // Act 1: Check is_first_ever before initialization
      const isFirstEver = lotteryBusinessDaysDAL.isFirstEverDay(ctx.storeId);
      expect(isFirstEver).toBe(true);

      // Act 2: Initialize the first business day
      const newDay = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );

      // Assert: Day created, now store has history
      expect(newDay.status).toBe('OPEN');
      expect(countDaysForStore(ctx.storeId)).toBe(1);
      expect(lotteryBusinessDaysDAL.isFirstEverDay(ctx.storeId)).toBe(false);

      // Act 3: Simulate onboarding pack activation with custom serial (e.g., from barcode scan)
      // In onboarding mode, serial comes from barcode (positions 12-14)
      const onboardingSerial = '025'; // Pack was at ticket #25 when scanned

      // Clear sync queue to track only activation
      syncQueueHistory.length = 0;

      const activatedPack = lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: onboardingSerial, // BIZ-010: Custom serial from onboarding
        activated_by: user.user_id,
      });

      // Assert: Pack activated with correct opening_serial
      expect(activatedPack.status).toBe('ACTIVE');
      expect(activatedPack.opening_serial).toBe(onboardingSerial);

      // Verify in database
      const dbPack = getPackById(packId);
      expect(dbPack?.status).toBe('ACTIVE');
      expect(dbPack?.opening_serial).toBe(onboardingSerial);
      expect(dbPack?.current_bin_id).toBe(binId);

      // Verify sync payload includes opening_serial
      const packSyncItems = findSyncItemsByType('pack');
      expect(packSyncItems.length).toBeGreaterThanOrEqual(1);

      const activationPayload = packSyncItems.find(
        (item) => item.entity_id === packId && item.operation === 'UPDATE'
      )?.payload as Record<string, unknown>;

      expect(activationPayload).toBeDefined();
      expect(activationPayload.opening_serial).toBe(onboardingSerial);
    });

    it('should use default serial 000 after completing onboarding (normal mode)', async () => {
      // Arrange: Complete onboarding setup
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedReceivedPack(gameId, '7654321');
      const binId = seedLotteryBin('Bin 2', 2);

      // Create first day (makes is_first_ever false afterwards)
      lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, ctx.utils.today(), user.user_id);

      // Act: Activate pack in normal mode (not onboarding) - uses default '000'
      const normalSerial = '000';

      const activatedPack = lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: normalSerial, // Default for normal mode
        activated_by: user.user_id,
      });

      // Assert: Pack activated with default serial
      expect(activatedPack.opening_serial).toBe(normalSerial);

      const dbPack = getPackById(packId);
      expect(dbPack?.opening_serial).toBe('000');
    });
  });

  // ==========================================================================
  // INT-ONB-002: is_first_ever=true triggers onboarding mode
  // ==========================================================================

  describe('INT-ONB-002: is_first_ever Detection', () => {
    it('should return is_first_ever=true for brand new store', () => {
      // Arrange: Store with no lottery history
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      // Assert: No days exist
      expect(countDaysForStore(ctx.storeId)).toBe(0);
      expect(lotteryBusinessDaysDAL.isFirstEverDay(ctx.storeId)).toBe(true);
      expect(lotteryBusinessDaysDAL.hasAnyDay(ctx.storeId)).toBe(false);
    });

    it('should return is_first_ever=false after first day is created', () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);
      seedLotteryBin('Bin 1', 1);
      seedLotteryGame();

      // Pre-check
      expect(lotteryBusinessDaysDAL.isFirstEverDay(ctx.storeId)).toBe(true);

      // Act: Create first day
      lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, ctx.utils.today(), user.user_id);

      // Assert: No longer first-ever
      expect(lotteryBusinessDaysDAL.isFirstEverDay(ctx.storeId)).toBe(false);
      expect(lotteryBusinessDaysDAL.hasAnyDay(ctx.storeId)).toBe(true);
    });

    it('should return is_first_ever=false even for closed days', () => {
      // Arrange: Create and close a day
      const user = createTestUser('shift_manager');
      setCurrentUser(user);
      seedLotteryBin('Bin 1', 1);
      seedLotteryGame();

      const day = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );

      // Close the day directly in DB
      db.prepare(`UPDATE lottery_business_days SET status = 'CLOSED' WHERE day_id = ?`).run(
        day.day_id
      );

      // Assert: Still not first-ever (closed day counts as history)
      expect(lotteryBusinessDaysDAL.isFirstEverDay(ctx.storeId)).toBe(false);
    });
  });

  // ==========================================================================
  // INT-ONB-003: is_first_ever=false for stores with history
  // ==========================================================================

  describe('INT-ONB-003: Stores with History', () => {
    it('should return is_first_ever=false for store with one OPEN day', () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);
      seedLotteryBin('Bin 1', 1);
      seedLotteryGame();

      lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, ctx.utils.today(), user.user_id);

      // Assert
      expect(lotteryBusinessDaysDAL.isFirstEverDay(ctx.storeId)).toBe(false);
    });

    it('should return is_first_ever=false for store with multiple days', () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);
      seedLotteryBin('Bin 1', 1);
      seedLotteryGame();

      // Create multiple days
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

      // Assert
      expect(lotteryBusinessDaysDAL.countAllDays(ctx.storeId)).toBe(3);
      expect(lotteryBusinessDaysDAL.isFirstEverDay(ctx.storeId)).toBe(false);
    });
  });

  // ==========================================================================
  // INT-ONB-004: opening_serial from barcode flows to database
  // ==========================================================================

  describe('INT-ONB-004: Database State Transitions', () => {
    it('should persist opening_serial 025 (25 tickets sold) to database', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedReceivedPack(gameId, '1234567');
      const binId = seedLotteryBin('Bin 2', 2);

      lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, ctx.utils.today(), user.user_id);

      // Act: Activate with serial from barcode
      lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '025',
        activated_by: user.user_id,
      });

      // Assert: Database reflects correct state
      const dbPack = getPackById(packId);
      expect(dbPack?.opening_serial).toBe('025');
      expect(dbPack?.status).toBe('ACTIVE');
    });

    it('should persist opening_serial 150 (mid-range) to database', async () => {
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedReceivedPack(gameId, '2345678');
      const binId = seedLotteryBin('Bin 2', 2);

      lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, ctx.utils.today(), user.user_id);

      lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '150',
        activated_by: user.user_id,
      });

      const dbPack = getPackById(packId);
      expect(dbPack?.opening_serial).toBe('150');
    });

    it('should persist opening_serial 000 (new pack scanned in onboarding)', async () => {
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedReceivedPack(gameId, '3456789');
      const binId = seedLotteryBin('Bin 2', 2);

      lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, ctx.utils.today(), user.user_id);

      lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '000', // New pack, no tickets sold
        activated_by: user.user_id,
      });

      const dbPack = getPackById(packId);
      expect(dbPack?.opening_serial).toBe('000');
    });

    it('should persist opening_serial 299 (near end of pack)', async () => {
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame({ ticketsPerPack: 300 });
      const packId = seedReceivedPack(gameId, '4567890');
      const binId = seedLotteryBin('Bin 2', 2);

      lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, ctx.utils.today(), user.user_id);

      lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '299', // Almost sold out
        activated_by: user.user_id,
      });

      const dbPack = getPackById(packId);
      expect(dbPack?.opening_serial).toBe('299');
    });
  });

  // ==========================================================================
  // INT-ONB-005: opening_serial flows to sync queue payload
  // ==========================================================================

  describe('INT-ONB-005: Cloud Sync Verification', () => {
    it('should include opening_serial in sync payload for pack activation', async () => {
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedReceivedPack(gameId, '5678901');
      const binId = seedLotteryBin('Bin 2', 2);

      lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, ctx.utils.today(), user.user_id);

      syncQueueHistory.length = 0;

      lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '075',
        activated_by: user.user_id,
      });

      // Find pack activation sync item
      const packSyncItems = findSyncItemsByType('pack');
      const activationItem = packSyncItems.find((item) => item.entity_id === packId);

      expect(activationItem).toBeDefined();

      const payload = activationItem?.payload as Record<string, unknown>;
      expect(payload.opening_serial).toBe('075');
      expect(payload.status).toBe('ACTIVE');
      expect(payload.store_id).toBe(ctx.storeId);
    });

    it('should include store_id in sync payload for tenant isolation (DB-006)', async () => {
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedReceivedPack(gameId, '6789012');
      const binId = seedLotteryBin('Bin 2', 2);

      lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, ctx.utils.today(), user.user_id);

      syncQueueHistory.length = 0;

      lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '100',
        activated_by: user.user_id,
      });

      // Verify all sync items have store_id
      for (const item of syncQueueHistory) {
        expect(item.store_id).toBe(ctx.storeId);
        const payload = item.payload as Record<string, unknown>;
        expect(payload.store_id).toBe(ctx.storeId);
      }
    });

    it('should include activated_by in sync payload for audit trail (SEC-010)', async () => {
      const user = createTestUser('shift_manager', { user_id: 'audit-user-123' });
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedReceivedPack(gameId, '7890123');
      const binId = seedLotteryBin('Bin 2', 2);

      lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, ctx.utils.today(), user.user_id);

      syncQueueHistory.length = 0;

      lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '050',
        activated_by: user.user_id,
      });

      const packSyncItems = findSyncItemsByType('pack');
      const activationItem = packSyncItems.find((item) => item.entity_id === packId);
      const payload = activationItem?.payload as Record<string, unknown>;

      expect(payload.activated_by).toBe('audit-user-123');
    });
  });

  // ==========================================================================
  // INT-ONB-006: Multi-store isolation (MT-011)
  // ==========================================================================

  describe('INT-ONB-006: Multi-Store Tenant Isolation (MT-011)', () => {
    it('should detect is_first_ever independently per store', async () => {
      // Arrange: Create second store in same database
      const store2Id = `store-2-${Date.now()}`;
      const now = new Date().toISOString();

      db.prepare(
        `
        INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
        VALUES (?, 'company-2', 'Store 2', 'America/Los_Angeles', 'ACTIVE', ?, ?)
      `
      ).run(store2Id, now, now);

      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      // Setup store 1
      seedLotteryBin('Bin 1', 1);
      seedLotteryGame();

      // Create day for store 1
      lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, ctx.utils.today(), user.user_id);

      // Assert: Store 1 is NOT first-ever, Store 2 IS first-ever
      expect(lotteryBusinessDaysDAL.isFirstEverDay(ctx.storeId)).toBe(false);
      expect(lotteryBusinessDaysDAL.isFirstEverDay(store2Id)).toBe(true);
    });

    it('should count days independently per store (DB-006)', async () => {
      // Arrange: Create second store
      const store2Id = `store-2-${Date.now()}`;
      const now = new Date().toISOString();

      db.prepare(
        `
        INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
        VALUES (?, 'company-2', 'Store 2', 'America/Los_Angeles', 'ACTIVE', ?, ?)
      `
      ).run(store2Id, now, now);

      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      seedLotteryGame();

      // Create 3 days for store 1
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

      // Assert: Store 1 has 3 days, Store 2 has 0
      expect(lotteryBusinessDaysDAL.countAllDays(ctx.storeId)).toBe(3);
      expect(lotteryBusinessDaysDAL.countAllDays(store2Id)).toBe(0);
    });

    it('should not allow Store A to see Store B pack activations', async () => {
      // This tests sync queue isolation
      const store2Id = `store-2-${Date.now()}`;
      const now = new Date().toISOString();

      db.prepare(
        `
        INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
        VALUES (?, 'company-2', 'Store 2', 'America/Los_Angeles', 'ACTIVE', ?, ?)
      `
      ).run(store2Id, now, now);

      const user1 = createTestUser('shift_manager');
      setCurrentUser(user1);

      // Setup and activate pack for store 1
      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedReceivedPack(gameId, '8901234');
      const binId = seedLotteryBin('Bin 2', 2);

      lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, ctx.utils.today(), user1.user_id);

      syncQueueHistory.length = 0;

      lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '050',
        activated_by: user1.user_id,
      });

      // Assert: All sync items belong to store 1, none to store 2
      const store1Items = syncQueueHistory.filter((item) => item.store_id === ctx.storeId);
      const store2Items = syncQueueHistory.filter((item) => item.store_id === store2Id);

      expect(store1Items.length).toBeGreaterThan(0);
      expect(store2Items.length).toBe(0);
    });
  });

  // ==========================================================================
  // INT-ONB-007: Partial Pack Activation Tests
  // ==========================================================================

  describe('INT-ONB-007: Partial Pack Activation (Various Serials)', () => {
    let binId: string;
    let gameId: string;

    beforeEach(() => {
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      binId = seedLotteryBin('Test Bin', 1);
      gameId = seedLotteryGame({ ticketsPerPack: 300 });

      // Ensure we have a business day
      seedLotteryBin('Prereq Bin', 99); // For day init
      lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, ctx.utils.today(), user.user_id);
    });

    it('4.2.1: should activate pack at ticket 025 (25 sold already)', async () => {
      const packId = seedReceivedPack(gameId, '0001234');

      const result = lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '025',
        activated_by: 'test-user',
      });

      expect(result.opening_serial).toBe('025');

      const dbPack = getPackById(packId);
      expect(dbPack?.opening_serial).toBe('025');
    });

    it('4.2.2: should activate pack at ticket 150 (mid-range)', async () => {
      const packId = seedReceivedPack(gameId, '0002345');

      const result = lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '150',
        activated_by: 'test-user',
      });

      expect(result.opening_serial).toBe('150');

      const dbPack = getPackById(packId);
      expect(dbPack?.opening_serial).toBe('150');
    });

    it('4.2.3: should activate pack at ticket 000 (new pack scanned in onboarding)', async () => {
      const packId = seedReceivedPack(gameId, '0003456');

      const result = lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '000',
        activated_by: 'test-user',
      });

      expect(result.opening_serial).toBe('000');

      const dbPack = getPackById(packId);
      expect(dbPack?.opening_serial).toBe('000');
    });

    it('4.2.4: should activate pack at ticket 299 (near end of pack)', async () => {
      const packId = seedReceivedPack(gameId, '0004567');

      const result = lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '299',
        activated_by: 'test-user',
      });

      expect(result.opening_serial).toBe('299');

      const dbPack = getPackById(packId);
      expect(dbPack?.opening_serial).toBe('299');
    });

    it('should verify sync payload contains correct opening_serial for each position', async () => {
      const positions = ['000', '025', '150', '299'];

      for (const position of positions) {
        const packId = seedReceivedPack(gameId, `POS${position}`);

        syncQueueHistory.length = 0;

        lotteryPacksDAL.activate(packId, {
          store_id: ctx.storeId,
          current_bin_id: binId,
          opening_serial: position,
          activated_by: 'test-user',
        });

        const syncItem = syncQueueHistory.find(
          (item) => item.entity_type === 'pack' && item.entity_id === packId
        );

        expect(syncItem).toBeDefined();
        const payload = syncItem?.payload as Record<string, unknown>;
        expect(payload.opening_serial).toBe(position);
      }
    });
  });

  // ==========================================================================
  // Error Recovery and Edge Cases
  // ==========================================================================

  describe('Error Recovery and Edge Cases', () => {
    it('should handle activation after day close and auto-open', async () => {
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();
      const packId = seedReceivedPack(gameId, '9012345');
      const binId = seedLotteryBin('Bin 2', 2);

      // Create and close first day
      const day1 = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.businessDate(-1),
        user.user_id
      );

      db.prepare(
        `
        UPDATE lottery_business_days
        SET status = 'CLOSED', closed_at = datetime('now'), closed_by = ?
        WHERE day_id = ?
      `
      ).run(user.user_id, day1.day_id);

      // Create new day (simulating auto-open)
      const day2 = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );

      expect(day2.status).toBe('OPEN');

      // Activate pack on new day with onboarding serial
      const result = lotteryPacksDAL.activate(packId, {
        store_id: ctx.storeId,
        current_bin_id: binId,
        opening_serial: '100',
        activated_by: user.user_id,
      });

      expect(result.status).toBe('ACTIVE');
      expect(result.opening_serial).toBe('100');
    });

    it('should handle idempotent day creation correctly', async () => {
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      seedLotteryGame();

      const today = ctx.utils.today();

      // First check - should be first-ever
      expect(lotteryBusinessDaysDAL.isFirstEverDay(ctx.storeId)).toBe(true);

      // Create day
      const day1 = lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, today, user.user_id);

      // Second call - should return same day (idempotent)
      const day2 = lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, today, user.user_id);

      expect(day1.day_id).toBe(day2.day_id);
      expect(lotteryBusinessDaysDAL.countAllDays(ctx.storeId)).toBe(1);
    });

    it('should handle multiple pack activations in same onboarding session', async () => {
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryBin('Bin 1', 1);
      const gameId = seedLotteryGame();

      lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, ctx.utils.today(), user.user_id);

      // Create multiple packs
      const packs = [
        { packId: seedReceivedPack(gameId, 'PACK001'), serial: '000' },
        { packId: seedReceivedPack(gameId, 'PACK002'), serial: '050' },
        { packId: seedReceivedPack(gameId, 'PACK003'), serial: '150' },
        { packId: seedReceivedPack(gameId, 'PACK004'), serial: '250' },
      ];

      // Activate each in different bins
      for (let i = 0; i < packs.length; i++) {
        const binId = seedLotteryBin(`Activation Bin ${i + 1}`, i + 10);

        lotteryPacksDAL.activate(packs[i].packId, {
          store_id: ctx.storeId,
          current_bin_id: binId,
          opening_serial: packs[i].serial,
          activated_by: user.user_id,
        });
      }

      // Verify all activations
      for (const pack of packs) {
        const dbPack = getPackById(pack.packId);
        expect(dbPack?.status).toBe('ACTIVE');
        expect(dbPack?.opening_serial).toBe(pack.serial);
      }
    });
  });

  // ==========================================================================
  // SEC-006: SQL Injection Prevention
  // ==========================================================================

  describe('SEC-006: SQL Injection Prevention', () => {
    const SQL_INJECTION_PAYLOADS = [
      "'; DROP TABLE lottery_business_days; --",
      "' OR '1'='1",
      "'; SELECT * FROM stores; --",
      '1; DELETE FROM lottery_business_days;',
      "' UNION SELECT * FROM lottery_business_days --",
    ];

    it('should safely handle SQL injection payloads in store_id for isFirstEverDay', () => {
      for (const payload of SQL_INJECTION_PAYLOADS) {
        // These should return true (no days) because payload is an invalid store_id
        // They should NOT cause SQL errors or data leakage
        expect(() => {
          const result = lotteryBusinessDaysDAL.isFirstEverDay(payload);
          expect(result).toBe(true); // No valid store_id = no days
        }).not.toThrow();
      }

      // Original store data should be intact
      const user = createTestUser('shift_manager');
      setCurrentUser(user);
      seedLotteryBin('Bin 1', 1);
      seedLotteryGame();

      lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, ctx.utils.today(), user.user_id);

      expect(lotteryBusinessDaysDAL.isFirstEverDay(ctx.storeId)).toBe(false);
      expect(lotteryBusinessDaysDAL.countAllDays(ctx.storeId)).toBe(1);
    });

    it('should safely handle SQL injection payloads in store_id for countAllDays', () => {
      for (const payload of SQL_INJECTION_PAYLOADS) {
        expect(() => {
          const result = lotteryBusinessDaysDAL.countAllDays(payload);
          expect(result).toBe(0); // No valid store_id = 0 days
        }).not.toThrow();
      }
    });
  });
});
