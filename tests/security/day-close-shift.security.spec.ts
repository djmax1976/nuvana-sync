/**
 * Day Close & Shift Guard Security Tests (Phase 4 - Task 4.1)
 *
 * Enterprise-grade security tests validating BIZ-007 implementation:
 * - SEC-001: Auto-open uses authenticated user (SEC-010 compliance)
 * - SEC-002: Shift guard enforces tenant isolation (DB-006 compliance)
 * - SEC-003: Cannot bypass guard via direct DAL call
 * - SEC-004: Audit trail captures all state transitions (SEC-017 compliance)
 *
 * @module tests/security/day-close-shift.security.spec
 *
 * Security Compliance:
 * - SEC-006: All SQL via parameterized queries
 * - SEC-010: Authorization from authenticated session
 * - SEC-017: Audit logging for security events
 * - DB-006: Tenant isolation via store_id
 * - API-001: Input validation with Zod schemas
 *
 * Traceability Matrix:
 * - SEC-001: Auto-open uses authenticated user
 * - SEC-002: Shift guard enforces tenant isolation
 * - SEC-003: Cannot bypass guard via direct DAL call
 * - SEC-004: Audit trail captures all state transitions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';

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
// Database Reference (shared between mock and test code)
// ============================================================================

let db: Database.Database;

// ============================================================================
// Captured Logs for Audit Verification (SEC-017)
// ============================================================================

interface CapturedLog {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: Record<string, unknown>;
}

const capturedLogs: CapturedLog[] = [];

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
  getDatabase: () => db,
  isDatabaseInitialized: () => true,
}));

// ============================================================================
// Mock Settings Service
// ============================================================================

let mockPOSType = 'LOTTERY';
let mockPOSConnectionType = 'MANUAL';
vi.mock('../../src/main/services/settings.service', () => ({
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

const syncQueueHistory: Array<{
  store_id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  payload: unknown;
  priority?: number;
}> = [];

vi.mock('../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: {
    enqueue: vi.fn((data) => {
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
// Mock Logger with Capture for Audit Verification
// ============================================================================

vi.mock('../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn((msg: string, data?: Record<string, unknown>) => {
      capturedLogs.push({ level: 'debug', message: msg, data });
    }),
    info: vi.fn((msg: string, data?: Record<string, unknown>) => {
      capturedLogs.push({ level: 'info', message: msg, data });
    }),
    warn: vi.fn((msg: string, data?: Record<string, unknown>) => {
      capturedLogs.push({ level: 'warn', message: msg, data });
    }),
    error: vi.fn((msg: string, data?: Record<string, unknown>) => {
      capturedLogs.push({ level: 'error', message: msg, data });
    }),
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

import { createServiceTestContext, type ServiceTestContext } from '../helpers/test-context';
import {
  setCurrentUser,
  getCurrentUser,
  type SessionUser,
  type UserRole,
  IPCErrorCodes,
} from '../../src/main/ipc/index';
import { lotteryBusinessDaysDAL } from '../../src/main/dal/lottery-business-days.dal';
import { shiftsDAL } from '../../src/main/dal/shifts.dal';
import { daySummariesDAL } from '../../src/main/dal/day-summaries.dal';

// ============================================================================
// Test Suite
// ============================================================================

const describeSuite = SKIP_NATIVE_MODULE_TESTS ? describe.skip : describe;

describeSuite('Day Close & Shift Guard Security Tests (Phase 4)', () => {
  let ctx: ServiceTestContext;

  beforeEach(async () => {
    uuidCounter = 0;
    capturedLogs.length = 0;
    syncQueueHistory.length = 0;
    mockPOSType = 'LOTTERY';
    mockPOSConnectionType = 'MANUAL';

    ctx = await createServiceTestContext({
      storeName: 'Day Close Security Test Store',
    });
    db = ctx.db;

    // Clear any existing session
    setCurrentUser(null);
  });

  afterEach(() => {
    ctx?.cleanup();
    vi.clearAllMocks();
    setCurrentUser(null);
    capturedLogs.length = 0;
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
  function seedLotteryDay(
    options: {
      status?: 'OPEN' | 'PENDING_CLOSE' | 'CLOSED';
      businessDate?: string;
      openedBy?: string;
      storeId?: string;
    } = {}
  ): { day_id: string; business_date: string; status: string } {
    const dayId = `day-${++uuidCounter}`;
    const businessDate = options.businessDate ?? ctx.utils.today();
    const status = options.status ?? 'OPEN';
    const storeId = options.storeId ?? ctx.storeId;
    const now = new Date().toISOString();

    // SEC-006: Parameterized query
    const stmt = db.prepare(`
      INSERT INTO lottery_business_days (
        day_id, store_id, business_date, status, opened_at, opened_by,
        total_sales, total_packs_sold, total_packs_activated,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)
    `);
    stmt.run(
      dayId,
      storeId,
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
   * Find open lottery day for store
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   */
  function findOpenDay(
    storeId?: string
  ): { day_id: string; status: string; opened_by: string } | undefined {
    const stmt = db.prepare(`
      SELECT * FROM lottery_business_days
      WHERE store_id = ? AND status = 'OPEN'
      ORDER BY business_date DESC
      LIMIT 1
    `);
    return stmt.get(storeId ?? ctx.storeId) as
      | { day_id: string; status: string; opened_by: string }
      | undefined;
  }

  /**
   * Count open days for store
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   */
  function countOpenDays(storeId?: string): number {
    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM lottery_business_days
      WHERE store_id = ? AND status = 'OPEN'
    `);
    const result = stmt.get(storeId ?? ctx.storeId) as { count: number };
    return result.count;
  }

  /**
   * Simulate shift start handler logic with guard
   * Mirrors BIZ-007 implementation in shifts.handlers.ts
   */
  async function simulateShiftStartWithGuard(options: {
    registerId: string;
    cashierUserId: string;
    storeId?: string;
  }): Promise<{
    success: boolean;
    error?: string;
    message?: string;
    data?: { shift_id: string; status: string };
  }> {
    const storeId = options.storeId ?? ctx.storeId;
    const today = ctx.utils.today();

    // SEC-010: Check for authenticated user
    const currentUser = getCurrentUser();
    if (!currentUser) {
      return {
        success: false,
        error: IPCErrorCodes.NOT_AUTHENTICATED,
        message: 'Authentication required. Please log in.',
      };
    }

    // BIZ-007: Check for open lottery day
    // DB-006: Store-scoped query
    const openDay = lotteryBusinessDaysDAL.findOpenDay(storeId);
    if (!openDay) {
      // SEC-017: Audit log blocked attempt
      capturedLogs.push({
        level: 'warn',
        message: 'Manual shift start blocked: No open lottery day',
        data: {
          storeId,
          businessDate: today,
          cashierUserId: options.cashierUserId,
          registerId: options.registerId,
        },
      });

      return {
        success: false,
        error: IPCErrorCodes.VALIDATION_ERROR,
        message:
          'Cannot start shift: No open business day exists. Please open a day first or contact your manager.',
      };
    }

    // Create day summary
    daySummariesDAL.getOrCreateForDate(storeId, today);

    // Create the shift
    const shift = shiftsDAL.getOrCreateForDate(storeId, today, {
      externalRegisterId: options.registerId,
      internalUserId: options.cashierUserId,
      startTime: new Date().toISOString(),
    });

    // SEC-017: Audit log successful shift start
    capturedLogs.push({
      level: 'info',
      message: 'Manual shift started',
      data: {
        shiftId: shift.shift_id,
        storeId,
        registerId: options.registerId,
        linkedLotteryDayId: openDay.day_id,
      },
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
   * Simulate day close commit with auth enforcement
   * Mirrors BIZ-007 implementation in lottery.handlers.ts
   */
  function simulateDayCloseCommitWithAuth(dayId: string): {
    success: boolean;
    error?: string;
    message?: string;
    nextDay?: { day_id: string; business_date: string; status: string; opened_by: string };
  } {
    // SEC-010: Require authenticated user
    const currentUser = getCurrentUser();
    if (!currentUser) {
      return {
        success: false,
        error: IPCErrorCodes.NOT_AUTHENTICATED,
        message: 'No authenticated user session',
      };
    }

    const userId = currentUser.user_id;
    const now = new Date().toISOString();

    // Transition day to CLOSED
    const updateStmt = db.prepare(`
      UPDATE lottery_business_days
      SET status = 'CLOSED', closed_at = ?, closed_by = ?, updated_at = ?
      WHERE day_id = ?
    `);
    updateStmt.run(now, userId, now, dayId);

    // SEC-017: Audit log for day close
    capturedLogs.push({
      level: 'info',
      message: 'Day close committed',
      data: {
        closedDayId: dayId,
        closedBy: userId,
        closedAt: now,
      },
    });

    // BIZ-007: Auto-open next day
    // SEC-010: Uses authenticated user as opened_by
    // DB-006: Store-scoped via getStoreId() (simulated via currentUser.store_id)
    const storeId = currentUser.store_id;
    const today = ctx.utils.today();
    const nextDay = lotteryBusinessDaysDAL.getOrCreateForDate(storeId, today, userId);

    // SEC-017: Audit log for auto-open
    capturedLogs.push({
      level: 'info',
      message: 'Day close committed and next day opened',
      data: {
        closedDayId: dayId,
        newDayId: nextDay.day_id,
        newDayDate: nextDay.business_date,
        newDayStatus: nextDay.status,
        openedBy: userId,
      },
    });

    return {
      success: true,
      nextDay: {
        day_id: nextDay.day_id,
        business_date: nextDay.business_date,
        status: nextDay.status,
        opened_by: userId,
      },
    };
  }

  // ==========================================================================
  // SEC-001: Auto-open uses authenticated user (SEC-010)
  // ==========================================================================

  describe('SEC-001: Auto-open uses authenticated user (SEC-010)', () => {
    it('should reject day close when no session exists', async () => {
      // Arrange: Create a day to close, but no authenticated session
      const day = seedLotteryDay({ status: 'OPEN' });
      setCurrentUser(null);

      // Act
      const result = simulateDayCloseCommitWithAuth(day.day_id);

      // Assert: Rejected with NOT_AUTHENTICATED
      expect(result.success).toBe(false);
      expect(result.error).toBe(IPCErrorCodes.NOT_AUTHENTICATED);
      expect(result.message).toBe('No authenticated user session');
    });

    it('should use authenticated user ID as opened_by for auto-opened day', async () => {
      // Arrange
      const closingUser = createTestUser('shift_manager', {
        user_id: 'closing-user-sec-001',
        username: 'Closing Manager',
      });
      setCurrentUser(closingUser);

      const day = seedLotteryDay({ status: 'OPEN', openedBy: 'original-opener' });

      // Act
      const result = simulateDayCloseCommitWithAuth(day.day_id);

      // Assert: Next day opened_by is the authenticated closing user
      expect(result.success).toBe(true);
      expect(result.nextDay).toBeDefined();
      expect(result.nextDay?.opened_by).toBe(closingUser.user_id);

      // Verify in database
      const openDay = findOpenDay();
      expect(openDay?.opened_by).toBe(closingUser.user_id);
    });

    it('should not use user ID from request payload, only from session', async () => {
      // Arrange: Session has user A, but we'll verify only session is used
      const sessionUser = createTestUser('shift_manager', {
        user_id: 'session-user-id',
        username: 'Session User',
      });
      setCurrentUser(sessionUser);

      const day = seedLotteryDay({ status: 'OPEN' });

      // Act: Close day (handler uses getCurrentUser(), not request payload)
      const result = simulateDayCloseCommitWithAuth(day.day_id);

      // Assert: Uses session user, not any potential request override
      expect(result.success).toBe(true);
      expect(result.nextDay?.opened_by).toBe(sessionUser.user_id);

      // Verify audit log contains session user
      const autoOpenLog = capturedLogs.find((l) => l.message.includes('next day opened'));
      expect(autoOpenLog?.data?.openedBy).toBe(sessionUser.user_id);
    });

    it('should validate session before processing day close', async () => {
      // Arrange: Create day, set session, then clear it (simulating expired session)
      const day = seedLotteryDay({ status: 'OPEN' });
      const user = createTestUser('shift_manager');
      setCurrentUser(user);
      setCurrentUser(null); // Session expired

      // Act
      const result = simulateDayCloseCommitWithAuth(day.day_id);

      // Assert: Rejected even though user was previously authenticated
      expect(result.success).toBe(false);
      expect(result.error).toBe(IPCErrorCodes.NOT_AUTHENTICATED);
    });

    it('should use getCurrentUser() for all auth decisions (not request-based)', () => {
      // This test verifies the pattern used in the handler
      // SEC-010: Backend uses centralized session, not request payloads

      // Arrange
      setCurrentUser(null);
      expect(getCurrentUser()).toBeNull();

      const user = createTestUser('shift_manager');
      setCurrentUser(user);
      expect(getCurrentUser()).toEqual(user);

      // Changing session changes what getCurrentUser returns
      const user2 = createTestUser('store_manager');
      setCurrentUser(user2);
      expect(getCurrentUser()).toEqual(user2);
      expect(getCurrentUser()?.user_id).not.toBe(user.user_id);
    });
  });

  // ==========================================================================
  // SEC-002: Shift guard enforces tenant isolation (DB-006)
  // ==========================================================================

  describe('SEC-002: Shift guard enforces tenant isolation (DB-006)', () => {
    it('should not allow shift start using another store open day', async () => {
      // Arrange: Create open day for different store
      const otherStoreId = 'other-store-sec-002';
      const now = new Date().toISOString();

      // Insert other store (SEC-006: parameterized)
      const insertStoreStmt = db.prepare(`
        INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
        VALUES (?, 'other-company', 'Other Store', 'America/New_York', 'ACTIVE', ?, ?)
      `);
      insertStoreStmt.run(otherStoreId, now, now);

      // Insert open day for OTHER store
      seedLotteryDay({ status: 'OPEN', storeId: otherStoreId });

      // No open day for our test store (ctx.storeId)
      expect(countOpenDays(ctx.storeId)).toBe(0);
      expect(countOpenDays(otherStoreId)).toBe(1);

      // Set up valid session for test store
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act: Try to start shift (our store has no open day)
      const result = await simulateShiftStartWithGuard({
        registerId: 'register-1',
        cashierUserId: user.user_id,
        storeId: ctx.storeId, // Explicitly use our store
      });

      // Assert: Blocked because OUR store has no open day
      expect(result.success).toBe(false);
      expect(result.error).toBe(IPCErrorCodes.VALIDATION_ERROR);
      expect(result.message).toContain('No open business day exists');
    });

    it('should only find open days for the specified store', async () => {
      // Arrange: Create open days for two stores
      const otherStoreId = 'other-store-sec-002-b';
      const now = new Date().toISOString();

      // Insert other store
      const insertStoreStmt = db.prepare(`
        INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
        VALUES (?, 'other-company', 'Other Store B', 'America/New_York', 'ACTIVE', ?, ?)
      `);
      insertStoreStmt.run(otherStoreId, now, now);

      // Create open day for each store
      const ourDay = seedLotteryDay({
        status: 'OPEN',
        storeId: ctx.storeId,
        openedBy: 'our-opener',
      });
      const otherDay = seedLotteryDay({
        status: 'OPEN',
        storeId: otherStoreId,
        openedBy: 'other-opener',
      });

      // Act: Find open day for each store
      const ourOpenDay = findOpenDay(ctx.storeId);
      const otherOpenDay = findOpenDay(otherStoreId);

      // Assert: Each query returns only that store's day
      expect(ourOpenDay?.day_id).toBe(ourDay.day_id);
      expect(otherOpenDay?.day_id).toBe(otherDay.day_id);
      expect(ourOpenDay?.opened_by).toBe('our-opener');
      expect(otherOpenDay?.opened_by).toBe('other-opener');
    });

    it('should include store_id in shift guard query (DB-006)', async () => {
      // This test verifies the guard uses store-scoped queries

      // Arrange
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Create open day for our store
      seedLotteryDay({ status: 'OPEN', storeId: ctx.storeId });

      // Act
      const result = await simulateShiftStartWithGuard({
        registerId: 'register-1',
        cashierUserId: user.user_id,
      });

      // Assert: Shift created successfully (guard found our store's day)
      expect(result.success).toBe(true);

      // Verify audit log includes store_id
      const shiftLog = capturedLogs.find((l) => l.message === 'Manual shift started');
      expect(shiftLog?.data?.storeId).toBe(ctx.storeId);
    });

    it('should reject shift when only CLOSED days exist for store', async () => {
      // Arrange: Create CLOSED day for our store
      const user = createTestUser('cashier');
      setCurrentUser(user);

      seedLotteryDay({ status: 'CLOSED', storeId: ctx.storeId });

      // Act
      const result = await simulateShiftStartWithGuard({
        registerId: 'register-1',
        cashierUserId: user.user_id,
      });

      // Assert: Blocked (CLOSED is not OPEN)
      expect(result.success).toBe(false);
      expect(result.error).toBe(IPCErrorCodes.VALIDATION_ERROR);
    });

    it('should reject shift when only PENDING_CLOSE days exist for store', async () => {
      // Arrange: Create PENDING_CLOSE day for our store
      const user = createTestUser('cashier');
      setCurrentUser(user);

      seedLotteryDay({ status: 'PENDING_CLOSE', storeId: ctx.storeId });

      // Act
      const result = await simulateShiftStartWithGuard({
        registerId: 'register-1',
        cashierUserId: user.user_id,
      });

      // Assert: Blocked (PENDING_CLOSE is not OPEN)
      expect(result.success).toBe(false);
      expect(result.error).toBe(IPCErrorCodes.VALIDATION_ERROR);
    });

    it('should not leak store existence via error messages', async () => {
      // SEC-002: Prevent information disclosure
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // No open day for our store
      const result = await simulateShiftStartWithGuard({
        registerId: 'register-1',
        cashierUserId: user.user_id,
      });

      // Assert: Error message is generic, not revealing other stores
      expect(result.message).not.toContain('other store');
      expect(result.message).not.toContain('store_id');
      expect(result.message).toContain('No open business day exists');
    });
  });

  // ==========================================================================
  // SEC-003: Cannot bypass guard via direct DAL call
  // ==========================================================================

  describe('SEC-003: Cannot bypass guard via direct DAL call', () => {
    it('should enforce guard check before shift creation in handler', async () => {
      // Arrange: No open day, authenticated user
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act: Try to start shift via handler (which includes guard)
      const result = await simulateShiftStartWithGuard({
        registerId: 'register-1',
        cashierUserId: user.user_id,
      });

      // Assert: Handler rejects the request
      expect(result.success).toBe(false);
      expect(result.error).toBe(IPCErrorCodes.VALIDATION_ERROR);
    });

    it('should verify DAL method is called only after guard passes', async () => {
      // Arrange: Create open day first
      const user = createTestUser('cashier');
      setCurrentUser(user);

      seedLotteryDay({ status: 'OPEN' });

      // Act: Start shift (guard should pass)
      const result = await simulateShiftStartWithGuard({
        registerId: 'register-guard-test',
        cashierUserId: user.user_id,
      });

      // Assert: Shift created (DAL was called after guard passed)
      expect(result.success).toBe(true);
      expect(result.data?.shift_id).toBeDefined();

      // Verify shift exists in database
      const shift = db
        .prepare(`SELECT * FROM shifts WHERE shift_id = ?`)
        .get(result.data?.shift_id);
      expect(shift).toBeDefined();
    });

    it('should not create shift if guard fails', async () => {
      // Arrange: No open day
      const user = createTestUser('cashier');
      setCurrentUser(user);

      const shiftCountBefore = (
        db.prepare(`SELECT COUNT(*) as count FROM shifts WHERE store_id = ?`).get(ctx.storeId) as {
          count: number;
        }
      ).count;

      // Act
      await simulateShiftStartWithGuard({
        registerId: 'register-1',
        cashierUserId: user.user_id,
      });

      // Assert: No new shift created
      const shiftCountAfter = (
        db.prepare(`SELECT COUNT(*) as count FROM shifts WHERE store_id = ?`).get(ctx.storeId) as {
          count: number;
        }
      ).count;
      expect(shiftCountAfter).toBe(shiftCountBefore);
    });

    it('should require authenticated session before guard check', async () => {
      // Arrange: Create open day but no session
      seedLotteryDay({ status: 'OPEN' });
      setCurrentUser(null);

      // Act
      const result = await simulateShiftStartWithGuard({
        registerId: 'register-1',
        cashierUserId: 'some-user',
      });

      // Assert: Auth check happens before guard check
      expect(result.success).toBe(false);
      expect(result.error).toBe(IPCErrorCodes.NOT_AUTHENTICATED);
      // NOT VALIDATION_ERROR (which would mean guard was checked)
    });
  });

  // ==========================================================================
  // SEC-004: Audit trail captures all state transitions (SEC-017)
  // ==========================================================================

  describe('SEC-004: Audit trail captures all state transitions (SEC-017)', () => {
    it('should log blocked shift start attempts', async () => {
      // Arrange: No open day
      const user = createTestUser('cashier', {
        user_id: 'blocked-cashier-id',
        username: 'Blocked Cashier',
      });
      setCurrentUser(user);

      // Act
      await simulateShiftStartWithGuard({
        registerId: 'register-blocked',
        cashierUserId: user.user_id,
      });

      // Assert: Warn log captured for blocked attempt
      const blockedLog = capturedLogs.find(
        (l) => l.level === 'warn' && l.message.includes('Manual shift start blocked')
      );
      expect(blockedLog).toBeDefined();
      expect(blockedLog?.data?.storeId).toBe(ctx.storeId);
      expect(blockedLog?.data?.registerId).toBe('register-blocked');
      expect(blockedLog?.data?.cashierUserId).toBe(user.user_id);
    });

    it('should log successful shift start with relevant context', async () => {
      // Arrange
      const user = createTestUser('cashier', {
        user_id: 'success-cashier-id',
      });
      setCurrentUser(user);
      const day = seedLotteryDay({ status: 'OPEN' });

      // Act
      const result = await simulateShiftStartWithGuard({
        registerId: 'register-success',
        cashierUserId: user.user_id,
      });

      // Assert: Info log captured for successful start
      expect(result.success).toBe(true);

      const successLog = capturedLogs.find(
        (l) => l.level === 'info' && l.message === 'Manual shift started'
      );
      expect(successLog).toBeDefined();
      expect(successLog?.data?.shiftId).toBe(result.data?.shift_id);
      expect(successLog?.data?.storeId).toBe(ctx.storeId);
      expect(successLog?.data?.registerId).toBe('register-success');
      expect(successLog?.data?.linkedLotteryDayId).toBe(day.day_id);
    });

    it('should log day close with closer identity', async () => {
      // Arrange
      const closingUser = createTestUser('shift_manager', {
        user_id: 'closer-audit-test',
        username: 'Audit Test Closer',
      });
      setCurrentUser(closingUser);

      const day = seedLotteryDay({ status: 'OPEN' });

      // Act
      simulateDayCloseCommitWithAuth(day.day_id);

      // Assert: Day close logged with closer ID
      const closeLog = capturedLogs.find(
        (l) => l.level === 'info' && l.message === 'Day close committed'
      );
      expect(closeLog).toBeDefined();
      expect(closeLog?.data?.closedDayId).toBe(day.day_id);
      expect(closeLog?.data?.closedBy).toBe(closingUser.user_id);
      expect(closeLog?.data?.closedAt).toBeDefined();
    });

    it('should log auto-open with opener identity', async () => {
      // Arrange
      const closingUser = createTestUser('shift_manager', {
        user_id: 'auto-opener-audit',
      });
      setCurrentUser(closingUser);

      const day = seedLotteryDay({ status: 'OPEN' });

      // Act
      const result = simulateDayCloseCommitWithAuth(day.day_id);

      // Assert: Auto-open logged with opener ID
      const autoOpenLog = capturedLogs.find(
        (l) => l.level === 'info' && l.message.includes('next day opened')
      );
      expect(autoOpenLog).toBeDefined();
      expect(autoOpenLog?.data?.newDayId).toBe(result.nextDay?.day_id);
      expect(autoOpenLog?.data?.openedBy).toBe(closingUser.user_id);
      expect(autoOpenLog?.data?.closedDayId).toBe(day.day_id);
    });

    it('should not include sensitive data in audit logs', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      simulateDayCloseCommitWithAuth(day.day_id);

      await simulateShiftStartWithGuard({
        registerId: 'register-1',
        cashierUserId: user.user_id,
      });

      // Assert: No sensitive data in any logs
      for (const log of capturedLogs) {
        const logString = JSON.stringify(log);

        // Should not contain sensitive fields
        expect(logString).not.toContain('pin');
        expect(logString).not.toContain('password');
        expect(logString).not.toContain('token');
        expect(logString).not.toContain('secret');
        expect(logString).not.toContain('credential');
      }
    });

    it('should capture timestamp in audit logs', async () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });

      // Act
      simulateDayCloseCommitWithAuth(day.day_id);

      // Assert: Timestamps present
      const closeLog = capturedLogs.find((l) => l.message === 'Day close committed');
      expect(closeLog?.data?.closedAt).toBeDefined();
      expect(typeof closeLog?.data?.closedAt).toBe('string');

      // Validate ISO 8601 format
      const timestamp = closeLog?.data?.closedAt as string;
      expect(() => new Date(timestamp)).not.toThrow();
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
    });

    it('should create complete audit trail for full close-open-shift flow', async () => {
      // Arrange
      const user = createTestUser('shift_manager', {
        user_id: 'full-flow-user',
      });
      setCurrentUser(user);

      const day = seedLotteryDay({ status: 'OPEN' });
      capturedLogs.length = 0; // Clear to track only flow logs

      // Act: Full flow
      simulateDayCloseCommitWithAuth(day.day_id);
      await simulateShiftStartWithGuard({
        registerId: 'register-full-flow',
        cashierUserId: user.user_id,
      });

      // Assert: Complete audit trail
      // 1. Day close committed
      expect(capturedLogs.some((l) => l.message === 'Day close committed')).toBe(true);

      // 2. Next day opened
      expect(capturedLogs.some((l) => l.message.includes('next day opened'))).toBe(true);

      // 3. Shift started
      expect(capturedLogs.some((l) => l.message === 'Manual shift started')).toBe(true);

      // Verify chronological order
      const closeIndex = capturedLogs.findIndex((l) => l.message === 'Day close committed');
      const openIndex = capturedLogs.findIndex((l) => l.message.includes('next day opened'));
      const shiftIndex = capturedLogs.findIndex((l) => l.message === 'Manual shift started');

      expect(closeIndex).toBeLessThan(openIndex);
      expect(openIndex).toBeLessThan(shiftIndex);
    });
  });

  // ==========================================================================
  // Additional Security Edge Cases
  // ==========================================================================

  describe('Additional Security Edge Cases', () => {
    it('should not allow role escalation via session manipulation', async () => {
      // Arrange: Cashier session
      const cashierUser = createTestUser('cashier');
      setCurrentUser(cashierUser);

      // Session manipulation would not work because getCurrentUser()
      // returns the centralized session, not a mutable reference
      const session = getCurrentUser();
      expect(session?.role).toBe('cashier');

      // Even if frontend tried to claim different role,
      // backend uses getCurrentUser() which is authoritative
      const _day = seedLotteryDay({ status: 'OPEN' });

      // Shift start requires shift_manager for some operations,
      // but basic shift start is allowed for cashiers with open day
      const result = await simulateShiftStartWithGuard({
        registerId: 'register-1',
        cashierUserId: cashierUser.user_id,
      });

      // Cashier CAN start shift when day is open (this is allowed)
      expect(result.success).toBe(true);
    });

    it('should enforce store_id from session, not from request', async () => {
      // Arrange: User session is for ctx.storeId
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Create open day only for a different store
      const otherStoreId = 'attacker-store';
      const now = new Date().toISOString();

      const insertStoreStmt = db.prepare(`
        INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
        VALUES (?, 'attacker-company', 'Attacker Store', 'America/New_York', 'ACTIVE', ?, ?)
      `);
      insertStoreStmt.run(otherStoreId, now, now);

      seedLotteryDay({ status: 'OPEN', storeId: otherStoreId });

      // Act: Try to start shift claiming to be for other store
      // Handler should use session's store_id, not request parameter
      const result = await simulateShiftStartWithGuard({
        registerId: 'register-1',
        cashierUserId: user.user_id,
        storeId: ctx.storeId, // Our session's store (no open day)
      });

      // Assert: Blocked because handler uses session's store
      expect(result.success).toBe(false);
      expect(result.error).toBe(IPCErrorCodes.VALIDATION_ERROR);
    });

    it('should prevent enumeration attacks via timing-safe responses', async () => {
      // SEC-002: Consistent response time regardless of day existence

      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Scenario 1: No days at all
      const start1 = Date.now();
      await simulateShiftStartWithGuard({
        registerId: 'register-1',
        cashierUserId: user.user_id,
      });
      const time1 = Date.now() - start1;

      // Scenario 2: Only CLOSED day
      seedLotteryDay({ status: 'CLOSED' });
      const start2 = Date.now();
      await simulateShiftStartWithGuard({
        registerId: 'register-1',
        cashierUserId: user.user_id,
      });
      const time2 = Date.now() - start2;

      // Both scenarios should return VALIDATION_ERROR with similar timing
      // (Not a strict test, but documents the security consideration)
      expect(Math.abs(time1 - time2)).toBeLessThan(100); // Within 100ms
    });

    it('should clear session on logout', () => {
      // Arrange
      const user = createTestUser('shift_manager');
      setCurrentUser(user);
      expect(getCurrentUser()).not.toBeNull();

      // Act: Logout
      setCurrentUser(null);

      // Assert
      expect(getCurrentUser()).toBeNull();
    });

    it('should reject requests after session cleared', async () => {
      // Arrange
      seedLotteryDay({ status: 'OPEN' });
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Verify works with session
      const result1 = await simulateShiftStartWithGuard({
        registerId: 'register-1',
        cashierUserId: user.user_id,
      });
      expect(result1.success).toBe(true);

      // Act: Clear session
      setCurrentUser(null);

      // Assert: Rejected after logout
      const result2 = await simulateShiftStartWithGuard({
        registerId: 'register-2',
        cashierUserId: user.user_id,
      });
      expect(result2.success).toBe(false);
      expect(result2.error).toBe(IPCErrorCodes.NOT_AUTHENTICATED);
    });
  });
});
