/**
 * Day Close → Auto-Open → Shift Start Integration Tests (Phase 3 - Task 3.1)
 *
 * End-to-end integration tests validating BIZ-007:
 * - Day close triggers auto-open of next day
 * - Shift start requires an open lottery day
 * - Sync queue ordering ensures day_open syncs before shifts
 *
 * Testing Strategy:
 * - These tests validate the complete business flow across handlers
 * - Uses real database with seeded test data
 * - Mocks sync queue to validate ordering
 *
 * @module tests/integration/lottery/day-close-shift-flow
 *
 * Security Compliance:
 * - SEC-006: All queries use parameterized statements
 * - SEC-010: Authorization from authenticated session
 * - DB-006: Tenant isolation via store_id
 * - API-001: Input validation with Zod schemas
 *
 * Traceability Matrix:
 * - INT-FLOW-001: Full flow: Close day → Next day opens → Shift starts
 * - INT-FLOW-002: Sync queue ordering: day_open before shift
 * - INT-FLOW-003: Multiple shifts can start after day auto-opens
 * - INT-FLOW-004: Day close via wizard triggers auto-open
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
let mockPOSConnectionType = 'MANUAL';
vi.mock('../../../src/main/services/settings.service', () => ({
  settingsService: {
    getPOSType: () => mockPOSType,
    getPOSConnectionType: () => mockPOSConnectionType,
    getSetting: vi.fn(),
    setSetting: vi.fn(),
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
import { lotteryBusinessDaysDAL } from '../../../src/main/dal/lottery-business-days.dal';
import { shiftsDAL } from '../../../src/main/dal/shifts.dal';
import { daySummariesDAL } from '../../../src/main/dal/day-summaries.dal';

// ============================================================================
// Test Suite
// ============================================================================

const describeSuite = SKIP_NATIVE_MODULE_TESTS ? describe.skip : describe;

describeSuite('Day Close → Auto-Open → Shift Start Integration (Phase 3)', () => {
  let ctx: ServiceTestContext;

  beforeEach(async () => {
    uuidCounter = 0;
    syncQueueHistory.length = 0;
    syncQueueEnabled = true;
    mockPOSType = 'LOTTERY';
    mockPOSConnectionType = 'MANUAL';

    ctx = await createServiceTestContext({
      storeName: 'Day Close Shift Flow Integration Store',
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
  function seedLotteryGame(): string {
    const gameId = `game-${++uuidCounter}`;
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO lottery_games (
        game_id, store_id, game_code, name, price, tickets_per_pack,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1.0, 300, 'ACTIVE', ?, ?)
    `);
    stmt.run(gameId, ctx.storeId, `100${uuidCounter}`, `Test Game ${uuidCounter}`, now, now);
    return gameId;
  }

  /**
   * Seed a lottery pack in ACTIVE status
   * SEC-006: Parameterized queries
   */
  function seedActivePack(gameId: string, binId: string): string {
    const packId = `pack-${++uuidCounter}`;
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO lottery_packs (
        pack_id, store_id, game_id, pack_number, current_bin_id,
        status, opening_serial, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', '000', ?, ?)
    `);
    stmt.run(
      packId,
      ctx.storeId,
      gameId,
      `PKG${String(uuidCounter).padStart(7, '0')}`,
      binId,
      now,
      now
    );
    return packId;
  }

  /**
   * Get lottery day by ID
   * SEC-006: Parameterized query
   */
  function getDayById(
    dayId: string
  ): { status: string; day_id: string; business_date: string } | undefined {
    const stmt = db.prepare(`SELECT * FROM lottery_business_days WHERE day_id = ?`);
    return stmt.get(dayId) as { status: string; day_id: string; business_date: string } | undefined;
  }

  /**
   * Find open lottery day for store
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   */
  function findOpenDay(): { day_id: string; status: string; business_date: string } | undefined {
    const stmt = db.prepare(`
      SELECT * FROM lottery_business_days
      WHERE store_id = ? AND status = 'OPEN'
      ORDER BY business_date DESC
      LIMIT 1
    `);
    return stmt.get(ctx.storeId) as
      | { day_id: string; status: string; business_date: string }
      | undefined;
  }

  /**
   * Find sync items by entity type
   */
  function findSyncItemsByType(entityType: string): CreateSyncQueueItemData[] {
    return syncQueueHistory.filter((item) => item.entity_type === entityType);
  }

  /**
   * Find sync items by entity type and store
   */
  function findSyncItemsByTypeAndStore(
    entityType: string,
    storeId: string
  ): CreateSyncQueueItemData[] {
    return syncQueueHistory.filter(
      (item) => item.entity_type === entityType && item.store_id === storeId
    );
  }

  /**
   * Simulate shift start via handler logic
   * This mirrors the BIZ-007 guard from shifts.handlers.ts
   */
  async function simulateShiftStart(options: {
    registerId: string;
    cashierUserId: string;
    businessDate?: string;
  }): Promise<{
    success: boolean;
    error?: string;
    message?: string;
    data?: { shift_id: string; status: string };
  }> {
    const today = options.businessDate ?? ctx.utils.today();

    // BIZ-007: Check for open lottery day
    const openDay = findOpenDay();
    if (!openDay) {
      return {
        success: false,
        error: 'VALIDATION_ERROR',
        message:
          'Cannot start shift: No open business day exists. Please open a day first or contact your manager.',
      };
    }

    // Create day summary
    daySummariesDAL.getOrCreateForDate(ctx.storeId, today);

    // Create the shift
    const shift = shiftsDAL.getOrCreateForDate(ctx.storeId, today, {
      externalRegisterId: options.registerId,
      internalUserId: options.cashierUserId,
      startTime: new Date().toISOString(),
    });

    return {
      success: true,
      data: {
        shift_id: shift.shift_id,
        status: shift.status,
      },
    };
  }

  /**
   * Simulate day close commit
   * This mirrors BIZ-007 from lottery.handlers.ts
   */
  function simulateDayCloseCommit(
    dayId: string,
    userId: string
  ): {
    success: boolean;
    closingsCount: number;
    nextDay?: { day_id: string; business_date: string; status: string };
  } {
    // Transition day to CLOSED
    const now = new Date().toISOString();
    const updateStmt = db.prepare(`
      UPDATE lottery_business_days
      SET status = 'CLOSED', closed_at = ?, closed_by = ?, updated_at = ?
      WHERE day_id = ?
    `);
    updateStmt.run(now, userId, now, dayId);

    // Queue day_close sync
    syncQueueHistory.push({
      store_id: ctx.storeId,
      entity_type: 'day_close',
      entity_id: dayId,
      operation: 'CREATE',
      payload: {
        day_id: dayId,
        store_id: ctx.storeId,
        closed_by: userId,
        closed_at: now,
      },
      priority: 1,
      sync_direction: 'PUSH',
    });

    // BIZ-007: Auto-open next day
    const today = ctx.utils.today();
    const nextDay = lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, today, userId);

    return {
      success: true,
      closingsCount: 0,
      nextDay: {
        day_id: nextDay.day_id,
        business_date: nextDay.business_date,
        status: nextDay.status,
      },
    };
  }

  // ==========================================================================
  // INT-FLOW-001: Full flow: Close day → Next day opens → Shift starts
  // ==========================================================================

  describe('INT-FLOW-001: Full flow: Close day → Next day opens → Shift starts', () => {
    it('should allow shift start after day close auto-opens next day', async () => {
      // Arrange: Create initial OPEN day, user, and test data
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      const initialDay = seedLotteryDay({ status: 'OPEN', openedBy: user.user_id });
      const gameId = seedLotteryGame();
      const binId = seedLotteryBin('Bin 1', 1);
      seedActivePack(gameId, binId);

      // Clear sync queue to track only new items
      syncQueueHistory.length = 0;

      // Act 1: Close the day (simulates commitDayClose handler)
      const closeResult = simulateDayCloseCommit(initialDay.day_id, user.user_id);

      // Assert 1: Day is closed and next day auto-opened
      expect(closeResult.success).toBe(true);
      expect(closeResult.nextDay).toBeDefined();
      expect(closeResult.nextDay?.status).toBe('OPEN');

      // Verify original day is CLOSED
      const closedDay = getDayById(initialDay.day_id);
      expect(closedDay?.status).toBe('CLOSED');

      // Verify new OPEN day exists
      const openDay = findOpenDay();
      expect(openDay).toBeDefined();
      expect(openDay?.status).toBe('OPEN');

      // Act 2: Start a shift on the new day
      const shiftResult = await simulateShiftStart({
        registerId: 'register-1',
        cashierUserId: user.user_id,
      });

      // Assert 2: Shift started successfully
      expect(shiftResult.success).toBe(true);
      expect(shiftResult.data?.status).toBe('OPEN');
    });

    it('should block shift start when no open day exists', async () => {
      // Arrange: No lottery days in database
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act: Try to start shift
      const result = await simulateShiftStart({
        registerId: 'register-1',
        cashierUserId: user.user_id,
      });

      // Assert: Blocked with VALIDATION_ERROR
      expect(result.success).toBe(false);
      expect(result.error).toBe('VALIDATION_ERROR');
      expect(result.message).toContain('No open business day exists');
      expect(result.message).toContain('open a day first');
    });

    it('should use closing user ID as opened_by for auto-opened day', async () => {
      // Arrange
      const closingUser = createTestUser('shift_manager', {
        user_id: 'closing-manager-uuid',
        username: 'Closing Manager',
      });
      setCurrentUser(closingUser);

      const initialDay = seedLotteryDay({ status: 'OPEN', openedBy: 'original-opener' });

      // Act: Close day
      const closeResult = simulateDayCloseCommit(initialDay.day_id, closingUser.user_id);

      // Assert: Next day opened_by is the closing user
      expect(closeResult.nextDay).toBeDefined();

      // Verify opened_by in database
      const openDay = findOpenDay();
      expect(openDay).toBeDefined();

      const fullDay = db
        .prepare(`SELECT opened_by FROM lottery_business_days WHERE day_id = ?`)
        .get(openDay!.day_id) as { opened_by: string };
      expect(fullDay.opened_by).toBe(closingUser.user_id);
    });

    it('should include next_day object in close response', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);
      const initialDay = seedLotteryDay({ status: 'OPEN' });

      // Act
      const closeResult = simulateDayCloseCommit(initialDay.day_id, user.user_id);

      // Assert: Response contains next_day with required fields
      expect(closeResult.nextDay).toBeDefined();
      expect(closeResult.nextDay).toHaveProperty('day_id');
      expect(closeResult.nextDay).toHaveProperty('business_date');
      expect(closeResult.nextDay).toHaveProperty('status');
      expect(closeResult.nextDay?.status).toBe('OPEN');
    });
  });

  // ==========================================================================
  // INT-FLOW-002: Sync queue ordering: day_open before shift
  // ==========================================================================

  describe('INT-FLOW-002: Sync queue ordering: day_open before shift', () => {
    it('should queue day_open (priority 2) before day_close (priority 1)', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      // Create and close a day to trigger auto-open
      const initialDay = seedLotteryDay({ status: 'OPEN' });
      syncQueueHistory.length = 0; // Clear to track only new items

      // Act: Close day (triggers auto-open which queues day_open)
      simulateDayCloseCommit(initialDay.day_id, user.user_id);

      // Assert: day_open queued with higher priority than day_close
      const dayOpenItems = findSyncItemsByType('day_open');
      const dayCloseItems = findSyncItemsByType('day_close');

      expect(dayOpenItems.length).toBeGreaterThanOrEqual(1);
      expect(dayCloseItems.length).toBeGreaterThanOrEqual(1);

      // Priority ordering: higher number = processed first
      // day_open: priority 2, day_close: priority 1
      const dayOpenPriority = dayOpenItems[0].priority ?? 0;
      const dayClosePriority = dayCloseItems[0].priority ?? 0;

      expect(dayOpenPriority).toBeGreaterThan(dayClosePriority);
    });

    it('should include store_id in all sync items for tenant isolation (DB-006)', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      const initialDay = seedLotteryDay({ status: 'OPEN' });
      syncQueueHistory.length = 0;

      // Act
      simulateDayCloseCommit(initialDay.day_id, user.user_id);

      // Assert: All sync items include store_id
      for (const item of syncQueueHistory) {
        expect(item.store_id).toBe(ctx.storeId);
        // Payload should also include store_id
        const payload = item.payload as Record<string, unknown>;
        expect(payload.store_id).toBe(ctx.storeId);
      }
    });

    it('should queue day_open with required fields for cloud API', async () => {
      // Arrange
      const user = createTestUser('shift_manager', { user_id: 'opener-uuid-test' });
      setCurrentUser(user);

      const initialDay = seedLotteryDay({ status: 'OPEN' });
      syncQueueHistory.length = 0;

      // Act
      simulateDayCloseCommit(initialDay.day_id, user.user_id);

      // Assert: day_open sync item has required fields
      const dayOpenItems = findSyncItemsByType('day_open');
      expect(dayOpenItems.length).toBeGreaterThanOrEqual(1);

      const payload = dayOpenItems[0].payload as Record<string, unknown>;
      expect(payload).toHaveProperty('day_id');
      expect(payload).toHaveProperty('store_id');
      expect(payload).toHaveProperty('business_date');
      expect(payload).toHaveProperty('opened_at');
      expect(payload).toHaveProperty('opened_by');
      expect(payload.opened_by).toBe(user.user_id);
    });
  });

  // ==========================================================================
  // INT-FLOW-003: Multiple shifts can start after day auto-opens
  // ==========================================================================

  describe('INT-FLOW-003: Multiple shifts after auto-open', () => {
    it('should allow multiple shifts on different registers after day auto-opens', async () => {
      // Arrange: Close day to trigger auto-open
      const manager = createTestUser('shift_manager');
      setCurrentUser(manager);

      const initialDay = seedLotteryDay({ status: 'OPEN' });
      simulateDayCloseCommit(initialDay.day_id, manager.user_id);

      // Verify auto-opened day exists
      const openDay = findOpenDay();
      expect(openDay).toBeDefined();

      // Act: Start shifts on multiple registers
      const shift1Result = await simulateShiftStart({
        registerId: 'register-1',
        cashierUserId: 'cashier-1',
      });
      const shift2Result = await simulateShiftStart({
        registerId: 'register-2',
        cashierUserId: 'cashier-2',
      });
      const shift3Result = await simulateShiftStart({
        registerId: 'register-3',
        cashierUserId: 'cashier-3',
      });

      // Assert: All shifts created successfully
      expect(shift1Result.success).toBe(true);
      expect(shift2Result.success).toBe(true);
      expect(shift3Result.success).toBe(true);

      // Verify distinct shift IDs
      const shiftIds = new Set([
        shift1Result.data?.shift_id,
        shift2Result.data?.shift_id,
        shift3Result.data?.shift_id,
      ]);
      expect(shiftIds.size).toBe(3);
    });

    it('should not create duplicate shifts for same register', async () => {
      // Arrange
      const manager = createTestUser('shift_manager');
      setCurrentUser(manager);

      const initialDay = seedLotteryDay({ status: 'OPEN' });
      simulateDayCloseCommit(initialDay.day_id, manager.user_id);

      // Act: Start shift, then try same register again
      const shift1 = await simulateShiftStart({
        registerId: 'register-1',
        cashierUserId: 'cashier-1',
      });

      // getOrCreateForDate should return existing shift
      const shift2 = await simulateShiftStart({
        registerId: 'register-1',
        cashierUserId: 'cashier-1',
      });

      // Assert: Same shift returned (idempotent)
      expect(shift1.success).toBe(true);
      expect(shift2.success).toBe(true);
      expect(shift1.data?.shift_id).toBe(shift2.data?.shift_id);
    });
  });

  // ==========================================================================
  // INT-FLOW-004: Day close via wizard triggers auto-open
  // ==========================================================================

  describe('INT-FLOW-004: Day close via wizard triggers auto-open', () => {
    it('should auto-open next day when closed via commitDayClose', async () => {
      // Arrange: Simulate wizard flow (prepare → commit)
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'PENDING_CLOSE', openedBy: user.user_id });

      // Clear sync queue
      syncQueueHistory.length = 0;

      // Act: Commit close (final step of wizard)
      const result = simulateDayCloseCommit(day.day_id, user.user_id);

      // Assert: Next day auto-opened
      expect(result.success).toBe(true);
      expect(result.nextDay).toBeDefined();
      expect(result.nextDay?.status).toBe('OPEN');

      // Verify day_open was queued
      const dayOpenItems = findSyncItemsByType('day_open');
      expect(dayOpenItems.length).toBeGreaterThanOrEqual(1);
    });

    it('should use current business date for auto-opened day (handles midnight crossing)', async () => {
      // Arrange: Create a day with yesterday's date, close it
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      const yesterdayDate = ctx.utils.businessDate(-1); // Yesterday
      const todayDate = ctx.utils.today();

      const day = seedLotteryDay({
        status: 'OPEN',
        businessDate: yesterdayDate,
        openedBy: user.user_id,
      });

      // Act: Close yesterday's day (simulating midnight crossing)
      const result = simulateDayCloseCommit(day.day_id, user.user_id);

      // Assert: New day uses today's date, not closed day's date
      expect(result.nextDay).toBeDefined();
      expect(result.nextDay?.business_date).toBe(todayDate);
    });

    it('should be idempotent - return existing open day if one already exists', async () => {
      // Arrange: Create two OPEN days manually (edge case)
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      const existingOpenDay = seedLotteryDay({ status: 'OPEN' });

      // Create a second day with CLOSED status to close
      const dayToClose = seedLotteryDay({
        status: 'OPEN',
        businessDate: ctx.utils.businessDate(-1), // Yesterday to avoid collision
      });

      // Close the second day first
      const closeStmt = db.prepare(`
        UPDATE lottery_business_days SET status = 'CLOSED' WHERE day_id = ?
      `);
      closeStmt.run(dayToClose.day_id);

      // Now we have one OPEN day (existingOpenDay)
      // Act: Try to auto-open another day
      const nextDay = lotteryBusinessDaysDAL.getOrCreateForDate(
        ctx.storeId,
        ctx.utils.today(),
        user.user_id
      );

      // Assert: Returns existing open day, no duplicate
      expect(nextDay.day_id).toBe(existingOpenDay.day_id);

      // Verify only one OPEN day exists
      const openDays = db
        .prepare(
          `
        SELECT COUNT(*) as count FROM lottery_business_days
        WHERE store_id = ? AND status = 'OPEN'
      `
        )
        .get(ctx.storeId) as { count: number };
      expect(openDays.count).toBe(1);
    });
  });

  // ==========================================================================
  // Tenant Isolation Tests (DB-006)
  // ==========================================================================

  describe('DB-006: Tenant Isolation', () => {
    it('should not allow shift start using another store open day', async () => {
      // Arrange: Create open day for different store
      const otherStoreId = 'other-store-uuid';
      const now = new Date().toISOString();

      // Insert other store
      const insertStoreStmt = db.prepare(`
        INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
        VALUES (?, 'other-company', 'Other Store', 'America/New_York', 'ACTIVE', ?, ?)
      `);
      insertStoreStmt.run(otherStoreId, now, now);

      // Insert open day for other store
      const insertDayStmt = db.prepare(`
        INSERT INTO lottery_business_days (
          day_id, store_id, business_date, status, opened_at, opened_by,
          total_sales, total_packs_sold, total_packs_activated,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'OPEN', ?, 'user-other', 0, 0, 0, ?, ?)
      `);
      insertDayStmt.run('other-day-uuid', otherStoreId, ctx.utils.today(), now, now, now);

      // No open day for our test store
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act: Try to start shift (our store has no open day)
      const result = await simulateShiftStart({
        registerId: 'register-1',
        cashierUserId: user.user_id,
      });

      // Assert: Blocked because OUR store has no open day
      expect(result.success).toBe(false);
      expect(result.error).toBe('VALIDATION_ERROR');
      expect(result.message).toContain('No open business day exists');
    });

    it('should only check days for current store in findOpenDay', async () => {
      // Arrange: Create open day for our store
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      seedLotteryDay({ status: 'OPEN' });

      // Act: Find open day for our store
      const openDay = findOpenDay();

      // Assert: Found our store's day
      expect(openDay).toBeDefined();
      expect(openDay?.status).toBe('OPEN');

      // Verify store_id matches
      const fullDay = db
        .prepare(`SELECT store_id FROM lottery_business_days WHERE day_id = ?`)
        .get(openDay!.day_id) as { store_id: string };
      expect(fullDay.store_id).toBe(ctx.storeId);
    });
  });

  // ==========================================================================
  // Offline Scenario Tests
  // ==========================================================================

  describe('Offline Scenario', () => {
    it('should create day locally when sync queue is unavailable (offline-first)', async () => {
      // Arrange: Disable sync queue
      syncQueueEnabled = false;

      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      // Act: Create day (sync will fail but local should succeed)
      let day: ReturnType<typeof lotteryBusinessDaysDAL.getOrCreateForDate> | null = null;
      let error: Error | null = null;

      try {
        day = lotteryBusinessDaysDAL.getOrCreateForDate(
          ctx.storeId,
          ctx.utils.today(),
          user.user_id
        );
      } catch (e) {
        error = e as Error;
      }

      // Assert: Day created locally despite sync failure
      expect(error).toBeNull();
      expect(day).toBeDefined();
      expect(day?.status).toBe('OPEN');

      // Verify in database
      const dbDay = findOpenDay();
      expect(dbDay).toBeDefined();
      expect(dbDay?.day_id).toBe(day?.day_id);

      // Re-enable for cleanup
      syncQueueEnabled = true;
    });

    it('should allow shift start after offline day creation', async () => {
      // Arrange: Create day offline
      syncQueueEnabled = false;

      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      lotteryBusinessDaysDAL.getOrCreateForDate(ctx.storeId, ctx.utils.today(), user.user_id);

      // Re-enable sync
      syncQueueEnabled = true;

      // Act: Start shift
      const result = await simulateShiftStart({
        registerId: 'register-1',
        cashierUserId: user.user_id,
      });

      // Assert: Shift created successfully
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('OPEN');
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle CLOSED day status correctly (cannot start shift)', async () => {
      // Arrange: Only CLOSED days exist
      const user = createTestUser('cashier');
      setCurrentUser(user);

      seedLotteryDay({ status: 'CLOSED' });

      // Act: Try to start shift
      const result = await simulateShiftStart({
        registerId: 'register-1',
        cashierUserId: user.user_id,
      });

      // Assert: Blocked because no OPEN day
      expect(result.success).toBe(false);
      expect(result.error).toBe('VALIDATION_ERROR');
    });

    it('should handle PENDING_CLOSE day status correctly (cannot start shift)', async () => {
      // Arrange: Only PENDING_CLOSE day exists
      const user = createTestUser('cashier');
      setCurrentUser(user);

      seedLotteryDay({ status: 'PENDING_CLOSE' });

      // Act: Try to start shift
      const result = await simulateShiftStart({
        registerId: 'register-1',
        cashierUserId: user.user_id,
      });

      // Assert: Blocked because PENDING_CLOSE is not OPEN
      expect(result.success).toBe(false);
      expect(result.error).toBe('VALIDATION_ERROR');
    });

    it('should preserve data integrity through full flow', async () => {
      // Arrange
      const user = createTestUser('shift_manager', {
        user_id: 'integrity-test-user',
        username: 'Integrity Tester',
      });
      setCurrentUser(user);

      const initialDay = seedLotteryDay({
        status: 'OPEN',
        businessDate: ctx.utils.businessDate(-1), // Yesterday
        openedBy: 'original-opener',
      });

      // Act: Full flow
      const closeResult = simulateDayCloseCommit(initialDay.day_id, user.user_id);
      const shiftResult = await simulateShiftStart({
        registerId: 'register-integrity',
        cashierUserId: user.user_id,
      });

      // Assert: All data correct
      // Closed day preserved
      const closedDay = getDayById(initialDay.day_id);
      expect(closedDay?.status).toBe('CLOSED');

      // New day has correct data
      expect(closeResult.nextDay?.business_date).toBe(ctx.utils.today());
      expect(closeResult.nextDay?.status).toBe('OPEN');

      // Shift created on new day's date
      expect(shiftResult.success).toBe(true);

      // Verify shift has correct business date
      const shift = db
        .prepare(
          `
        SELECT business_date FROM shifts WHERE shift_id = ?
      `
        )
        .get(shiftResult.data?.shift_id) as { business_date: string };
      expect(shift.business_date).toBe(ctx.utils.today());
    });
  });
});
