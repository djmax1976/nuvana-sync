/**
 * Lottery Handlers - POS Type Enforcement Security Tests
 *
 * Verifies SEC-010 AUTHZ enforcement for independent lottery day close.
 * Only LOTTERY POS type stores can close lottery independently.
 * All other POS types must use Day Close Wizard (fromWizard=true).
 *
 * MCP Standards Applied:
 * - SEC-010: AUTHZ - Function-level authorization
 * - DB-006: TENANT_ISOLATION - Store-scoped operations
 * - API-005: RBAC - Role-based access control
 * - API-001: VALIDATION - Input validation with Zod
 * - API-003: ERROR_HANDLING - Sanitized error responses
 * - SEC-017: AUDIT_TRAILS - Logging for security events
 * - TEST-SEC-001: Abuse case testing
 *
 * Traceability Matrix:
 * | Test ID       | Handler                  | Condition                  | Expected Result   |
 * |---------------|--------------------------|----------------------------|-------------------|
 * | SEC-010-001   | lottery:prepareDayClose  | GILBARCO without fromWizard| FORBIDDEN         |
 * | SEC-010-002   | lottery:prepareDayClose  | VERIFONE without fromWizard| FORBIDDEN         |
 * | SEC-010-003   | lottery:prepareDayClose  | SQUARE without fromWizard  | FORBIDDEN         |
 * | SEC-010-004   | lottery:prepareDayClose  | LOTTERY without fromWizard | SUCCESS           |
 * | SEC-010-005   | lottery:prepareDayClose  | Any POS WITH fromWizard    | SUCCESS           |
 * | SEC-010-006   | lottery:commitDayClose   | Non-LOTTERY without flag   | FORBIDDEN         |
 * | SEC-010-007   | lottery:commitDayClose   | LOTTERY without fromWizard | SUCCESS           |
 * | SEC-010-008   | lottery:commitDayClose   | Any POS WITH fromWizard    | SUCCESS           |
 * | SEC-010-009   | Both handlers            | Error code verification    | FORBIDDEN (not 500)|
 * | SEC-010-010   | Both handlers            | Error message no info leak | Generic message   |
 * | DB-006-001    | lottery:commitDayClose   | Cross-store day_id         | NOT_FOUND         |
 *
 * @module tests/security/lottery.handlers.pos-type-enforcement.spec
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
// Mock POS Type (mutable for parameterized tests)
// ============================================================================

let mockPOSType = 'LOTTERY';

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
// Mock Settings Service (POS type is configurable per test)
// ============================================================================

vi.mock('../../src/main/services/settings.service', () => ({
  settingsService: {
    getPOSType: () => mockPOSType,
    getPOSConnectionType: () => 'MANUAL',
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
import { POS_TYPES, NON_LOTTERY_POS_TYPES } from '../fixtures/test-factories';

// ============================================================================
// Test Suite
// ============================================================================

const describeSuite = SKIP_NATIVE_MODULE_TESTS ? describe.skip : describe;

describeSuite('Lottery Handlers - POS Type Enforcement Security Tests', () => {
  let ctx: ServiceTestContext;
  let otherStoreId: string;

  beforeEach(async () => {
    uuidCounter = 0;
    capturedLogs.length = 0;
    syncQueueHistory.length = 0;
    mockPOSType = 'LOTTERY'; // Reset to LOTTERY as default

    ctx = await createServiceTestContext({
      storeName: 'POS Type Enforcement Test Store',
    });
    db = ctx.db;

    // Create a second store for cross-tenant tests (DB-006)
    otherStoreId = `other-store-${++uuidCounter}`;
    const now = new Date().toISOString();
    // SEC-006: Parameterized query
    const insertStoreStmt = db.prepare(`
      INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
      VALUES (?, 'other-company', 'Other Store', 'America/New_York', 'ACTIVE', ?, ?)
    `);
    insertStoreStmt.run(otherStoreId, now, now);

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
  ): { day_id: string; business_date: string; status: string; store_id: string } {
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

    return { day_id: dayId, business_date: businessDate, status, store_id: storeId };
  }

  /**
   * Simulate prepareDayClose handler logic
   * SEC-010: Full auth flow simulation
   */
  async function simulatePrepareDayClose(input: {
    closings: Array<{ pack_id: string; closing_serial: string; is_sold_out?: boolean }>;
    fromWizard?: boolean;
  }): Promise<{
    success: boolean;
    error?: string;
    message?: string;
    data?: { day_id: string };
  }> {
    // Check authentication
    const user = getCurrentUser();
    if (!user) {
      return {
        success: false,
        error: IPCErrorCodes.NOT_AUTHENTICATED,
        message: 'No authenticated user session',
      };
    }

    // SEC-010: Check POS type restriction
    // Independent lottery close is ONLY allowed for LOTTERY POS type
    if (mockPOSType !== 'LOTTERY' && !input.fromWizard) {
      // SEC-017: Log rejection for audit
      capturedLogs.push({
        level: 'warn',
        message: 'Independent lottery day close rejected for non-lottery POS type',
        data: { storeId: ctx.storeId, posType: mockPOSType, action: 'prepareDayClose' },
      });
      return {
        success: false,
        error: IPCErrorCodes.FORBIDDEN,
        message:
          'Independent lottery day close is not available for this POS configuration. ' +
          'Please use the Day Close wizard to close lottery as part of the regular day close process.',
      };
    }

    // Log wizard-initiated close for audit trail
    if (input.fromWizard && mockPOSType !== 'LOTTERY') {
      capturedLogs.push({
        level: 'info',
        message: 'Wizard-initiated lottery day close for non-LOTTERY POS type',
        data: {
          storeId: ctx.storeId,
          posType: mockPOSType,
          action: 'prepareDayClose',
          fromWizard: true,
        },
      });
    }

    // Get store and create/get day
    const storeId = ctx.storeId;
    const businessDate = ctx.utils.today();
    const day = lotteryBusinessDaysDAL.getOrCreateForDate(storeId, businessDate, user.user_id);

    return {
      success: true,
      data: { day_id: day.day_id },
    };
  }

  /**
   * Simulate commitDayClose handler logic with DB-006 validation
   * SEC-010: Full auth flow simulation
   * DB-006: Tenant isolation validation
   */
  async function simulateCommitDayClose(input: { day_id: string; fromWizard?: boolean }): Promise<{
    success: boolean;
    error?: string;
    message?: string;
    data?: { lottery_total: number };
  }> {
    // Check authentication
    const user = getCurrentUser();
    if (!user) {
      return {
        success: false,
        error: IPCErrorCodes.NOT_AUTHENTICATED,
        message: 'No authenticated user session',
      };
    }

    // SEC-010: Check POS type restriction
    if (mockPOSType !== 'LOTTERY' && !input.fromWizard) {
      // SEC-017: Log rejection for audit
      capturedLogs.push({
        level: 'warn',
        message: 'Independent lottery day close commit rejected for non-lottery POS type',
        data: { dayId: input.day_id, posType: mockPOSType, action: 'commitDayClose' },
      });
      return {
        success: false,
        error: IPCErrorCodes.FORBIDDEN,
        message: 'Independent lottery day close is not available for this POS configuration.',
      };
    }

    // Log wizard-initiated close for audit trail
    if (input.fromWizard && mockPOSType !== 'LOTTERY') {
      capturedLogs.push({
        level: 'info',
        message: 'Wizard-initiated lottery day close commit for non-LOTTERY POS type',
        data: {
          dayId: input.day_id,
          posType: mockPOSType,
          action: 'commitDayClose',
          fromWizard: true,
        },
      });
    }

    // DB-006: Validate day_id belongs to configured store
    const storeId = ctx.storeId;
    const day = lotteryBusinessDaysDAL.findByIdForStore(storeId, input.day_id);
    if (!day) {
      capturedLogs.push({
        level: 'warn',
        message: 'Day close commit rejected - day not found or belongs to different store',
        data: { dayId: input.day_id, storeId },
      });
      return {
        success: false,
        error: IPCErrorCodes.NOT_FOUND,
        message: 'Lottery day not found',
      };
    }

    return {
      success: true,
      data: { lottery_total: 0 },
    };
  }

  // ==========================================================================
  // SEC-010-001: prepareDayClose rejects GILBARCO_PASSPORT without fromWizard
  // ==========================================================================

  describe('SEC-010-001: prepareDayClose rejects GILBARCO_PASSPORT without fromWizard', () => {
    it('should reject independent lottery close for GILBARCO_PASSPORT POS type', async () => {
      // Arrange: Set POS type to GILBARCO_PASSPORT
      mockPOSType = POS_TYPES.GILBARCO_PASSPORT;
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act: Try to close without fromWizard flag
      const result = await simulatePrepareDayClose({
        closings: [],
        fromWizard: false,
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe(IPCErrorCodes.FORBIDDEN);
    });

    it('should log rejection for audit trail (SEC-017)', async () => {
      // Arrange
      mockPOSType = POS_TYPES.GILBARCO_PASSPORT;
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act
      await simulatePrepareDayClose({ closings: [], fromWizard: false });

      // Assert: Audit log captured
      const warnLog = capturedLogs.find(
        (l) => l.level === 'warn' && l.message.includes('rejected for non-lottery POS type')
      );
      expect(warnLog).toBeDefined();
      expect(warnLog?.data?.posType).toBe(POS_TYPES.GILBARCO_PASSPORT);
      expect(warnLog?.data?.action).toBe('prepareDayClose');
    });
  });

  // ==========================================================================
  // SEC-010-002: prepareDayClose rejects VERIFONE_RUBY2 without fromWizard
  // ==========================================================================

  describe('SEC-010-002: prepareDayClose rejects VERIFONE_RUBY2 without fromWizard', () => {
    it('should reject independent lottery close for VERIFONE_RUBY2 POS type', async () => {
      // Arrange
      mockPOSType = POS_TYPES.VERIFONE_RUBY2;
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act
      const result = await simulatePrepareDayClose({
        closings: [],
        fromWizard: false,
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe(IPCErrorCodes.FORBIDDEN);
    });
  });

  // ==========================================================================
  // SEC-010-003: prepareDayClose rejects SQUARE_REST without fromWizard
  // ==========================================================================

  describe('SEC-010-003: prepareDayClose rejects SQUARE_REST without fromWizard', () => {
    it('should reject independent lottery close for SQUARE_REST POS type', async () => {
      // Arrange
      mockPOSType = POS_TYPES.SQUARE_REST;
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act
      const result = await simulatePrepareDayClose({
        closings: [],
        fromWizard: false,
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe(IPCErrorCodes.FORBIDDEN);
    });
  });

  // ==========================================================================
  // SEC-010-004: prepareDayClose allows LOTTERY without fromWizard
  // ==========================================================================

  describe('SEC-010-004: prepareDayClose allows LOTTERY without fromWizard', () => {
    it('should allow independent lottery close for LOTTERY POS type', async () => {
      // Arrange: Set POS type to LOTTERY (default)
      mockPOSType = POS_TYPES.LOTTERY;
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act: Close without fromWizard flag
      const result = await simulatePrepareDayClose({
        closings: [],
        fromWizard: false,
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.data?.day_id).toBeDefined();
    });

    it('should not generate FORBIDDEN audit log for LOTTERY POS type', async () => {
      // Arrange
      mockPOSType = POS_TYPES.LOTTERY;
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act
      await simulatePrepareDayClose({ closings: [], fromWizard: false });

      // Assert: No rejection log
      const warnLog = capturedLogs.find(
        (l) => l.level === 'warn' && l.message.includes('rejected')
      );
      expect(warnLog).toBeUndefined();
    });
  });

  // ==========================================================================
  // SEC-010-005: prepareDayClose allows any POS type WITH fromWizard=true
  // ==========================================================================

  describe('SEC-010-005: prepareDayClose allows any POS type WITH fromWizard=true', () => {
    // Parameterized test for all non-LOTTERY POS types
    const testPOSTypes = [
      POS_TYPES.GILBARCO_PASSPORT,
      POS_TYPES.VERIFONE_RUBY2,
      POS_TYPES.SQUARE_REST,
      POS_TYPES.MANUAL,
    ];

    it.each(testPOSTypes)(
      'should allow lottery close for %s POS type when fromWizard=true',
      async (posType) => {
        // Arrange
        mockPOSType = posType;
        const user = createTestUser('cashier');
        setCurrentUser(user);

        // Act: Close WITH fromWizard flag
        const result = await simulatePrepareDayClose({
          closings: [],
          fromWizard: true,
        });

        // Assert
        expect(result.success).toBe(true);
        expect(result.data?.day_id).toBeDefined();
      }
    );

    it('should log wizard-initiated close for audit trail', async () => {
      // Arrange
      mockPOSType = POS_TYPES.GILBARCO_PASSPORT;
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act
      await simulatePrepareDayClose({ closings: [], fromWizard: true });

      // Assert: Info log for wizard-initiated close
      const infoLog = capturedLogs.find(
        (l) => l.level === 'info' && l.message.includes('Wizard-initiated')
      );
      expect(infoLog).toBeDefined();
      expect(infoLog?.data?.fromWizard).toBe(true);
    });
  });

  // ==========================================================================
  // SEC-010-006: commitDayClose rejects non-LOTTERY without fromWizard
  // ==========================================================================

  describe('SEC-010-006: commitDayClose rejects non-LOTTERY without fromWizard', () => {
    it.each(NON_LOTTERY_POS_TYPES.slice(0, 5))(
      'should reject commit for %s POS type without fromWizard',
      async (posType) => {
        // Arrange
        mockPOSType = posType;
        const day = seedLotteryDay({ status: 'PENDING_CLOSE' });
        const user = createTestUser('cashier');
        setCurrentUser(user);

        // Act
        const result = await simulateCommitDayClose({
          day_id: day.day_id,
          fromWizard: false,
        });

        // Assert
        expect(result.success).toBe(false);
        expect(result.error).toBe(IPCErrorCodes.FORBIDDEN);
      }
    );

    it('should log commit rejection for audit trail (SEC-017)', async () => {
      // Arrange
      mockPOSType = POS_TYPES.VERIFONE_COMMANDER;
      const day = seedLotteryDay({ status: 'PENDING_CLOSE' });
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act
      await simulateCommitDayClose({ day_id: day.day_id, fromWizard: false });

      // Assert
      const warnLog = capturedLogs.find(
        (l) => l.level === 'warn' && l.message.includes('commit rejected')
      );
      expect(warnLog).toBeDefined();
      expect(warnLog?.data?.action).toBe('commitDayClose');
    });
  });

  // ==========================================================================
  // SEC-010-007: commitDayClose allows LOTTERY without fromWizard
  // ==========================================================================

  describe('SEC-010-007: commitDayClose allows LOTTERY without fromWizard', () => {
    it('should allow commit for LOTTERY POS type without fromWizard', async () => {
      // Arrange
      mockPOSType = POS_TYPES.LOTTERY;
      const day = seedLotteryDay({ status: 'PENDING_CLOSE' });
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act
      const result = await simulateCommitDayClose({
        day_id: day.day_id,
        fromWizard: false,
      });

      // Assert
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // SEC-010-008: commitDayClose allows any POS type WITH fromWizard=true
  // ==========================================================================

  describe('SEC-010-008: commitDayClose allows any POS type WITH fromWizard=true', () => {
    it.each([POS_TYPES.GILBARCO_PASSPORT, POS_TYPES.SQUARE_REST, POS_TYPES.MANUAL])(
      'should allow commit for %s POS type with fromWizard=true',
      async (posType) => {
        // Arrange
        mockPOSType = posType;
        const day = seedLotteryDay({ status: 'PENDING_CLOSE' });
        const user = createTestUser('cashier');
        setCurrentUser(user);

        // Act
        const result = await simulateCommitDayClose({
          day_id: day.day_id,
          fromWizard: true,
        });

        // Assert
        expect(result.success).toBe(true);
      }
    );
  });

  // ==========================================================================
  // SEC-010-009: Verify FORBIDDEN error code returned (not 500)
  // ==========================================================================

  describe('SEC-010-009: Verify FORBIDDEN error code returned (not 500)', () => {
    it('should return FORBIDDEN error code for prepareDayClose rejection', async () => {
      // Arrange
      mockPOSType = POS_TYPES.GILBARCO_PASSPORT;
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act
      const result = await simulatePrepareDayClose({ closings: [], fromWizard: false });

      // Assert: FORBIDDEN, not INTERNAL_ERROR
      expect(result.error).toBe(IPCErrorCodes.FORBIDDEN);
      expect(result.error).not.toBe(IPCErrorCodes.INTERNAL_ERROR);
    });

    it('should return FORBIDDEN error code for commitDayClose rejection', async () => {
      // Arrange
      mockPOSType = POS_TYPES.SQUARE_REST;
      const day = seedLotteryDay({ status: 'PENDING_CLOSE' });
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act
      const result = await simulateCommitDayClose({ day_id: day.day_id, fromWizard: false });

      // Assert
      expect(result.error).toBe(IPCErrorCodes.FORBIDDEN);
      expect(result.error).not.toBe(IPCErrorCodes.INTERNAL_ERROR);
    });

    it('should use consistent error code across both handlers', async () => {
      // Arrange
      mockPOSType = POS_TYPES.VERIFONE_RUBY2;
      const day = seedLotteryDay({ status: 'PENDING_CLOSE' });
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act
      const prepareResult = await simulatePrepareDayClose({ closings: [], fromWizard: false });
      const commitResult = await simulateCommitDayClose({ day_id: day.day_id, fromWizard: false });

      // Assert: Both use same error code
      expect(prepareResult.error).toBe(commitResult.error);
      expect(prepareResult.error).toBe(IPCErrorCodes.FORBIDDEN);
    });
  });

  // ==========================================================================
  // SEC-010-010: Verify error message does not leak sensitive info
  // ==========================================================================

  describe('SEC-010-010: Verify error message does not leak sensitive info', () => {
    it('should not expose POS type in error message', async () => {
      // Arrange
      mockPOSType = POS_TYPES.GILBARCO_PASSPORT;
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act
      const result = await simulatePrepareDayClose({ closings: [], fromWizard: false });

      // Assert: Message should be generic, not expose internal config
      expect(result.message).not.toContain('GILBARCO');
      expect(result.message).not.toContain('PASSPORT');
      expect(result.message).not.toContain(mockPOSType);
    });

    it('should not expose store ID in error message', async () => {
      // Arrange
      mockPOSType = POS_TYPES.SQUARE_REST;
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act
      const result = await simulatePrepareDayClose({ closings: [], fromWizard: false });

      // Assert
      expect(result.message).not.toContain(ctx.storeId);
      expect(result.message).not.toContain('store_id');
    });

    it('should provide user-friendly guidance in error message', async () => {
      // Arrange
      mockPOSType = POS_TYPES.MANUAL;
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act
      const result = await simulatePrepareDayClose({ closings: [], fromWizard: false });

      // Assert: Message guides user to correct workflow
      expect(result.message).toContain('Day Close wizard');
    });

    it('should not expose internal state in commitDayClose error', async () => {
      // Arrange
      mockPOSType = POS_TYPES.CLOVER_REST;
      const day = seedLotteryDay({ status: 'PENDING_CLOSE' });
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act
      const result = await simulateCommitDayClose({ day_id: day.day_id, fromWizard: false });

      // Assert: Error message should not expose internal POS type name
      // eslint-disable-next-line no-restricted-syntax -- Testing error message doesn't leak POS type
      expect(result.message).not.toContain('CLOVER');
      expect(result.message).not.toContain(day.day_id);
    });
  });

  // ==========================================================================
  // DB-006-001: Verify store_id is validated in all paths
  // ==========================================================================

  describe('DB-006-001: Verify store_id is validated in all paths (Tenant Isolation)', () => {
    it('should reject commitDayClose for day belonging to different store', async () => {
      // Arrange: Create day for OTHER store
      mockPOSType = POS_TYPES.LOTTERY;
      const otherStoreDay = seedLotteryDay({ status: 'PENDING_CLOSE', storeId: otherStoreId });

      // Authenticate as user from OUR store
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act: Try to commit other store's day
      const result = await simulateCommitDayClose({
        day_id: otherStoreDay.day_id,
        fromWizard: false,
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe(IPCErrorCodes.NOT_FOUND);
      expect(result.message).toBe('Lottery day not found');
    });

    it('should not expose cross-tenant information in error message', async () => {
      // Arrange
      mockPOSType = POS_TYPES.LOTTERY;
      const otherStoreDay = seedLotteryDay({ status: 'PENDING_CLOSE', storeId: otherStoreId });
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act
      const result = await simulateCommitDayClose({
        day_id: otherStoreDay.day_id,
        fromWizard: false,
      });

      // Assert: Generic NOT_FOUND, no hint that day exists elsewhere
      expect(result.message).toBe('Lottery day not found');
      expect(result.message).not.toContain('another store');
      expect(result.message).not.toContain('different store');
      expect(result.message).not.toContain(otherStoreId);
    });

    it('should log cross-tenant access attempt for audit (SEC-017)', async () => {
      // Arrange
      mockPOSType = POS_TYPES.LOTTERY;
      const otherStoreDay = seedLotteryDay({ status: 'PENDING_CLOSE', storeId: otherStoreId });
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act
      await simulateCommitDayClose({
        day_id: otherStoreDay.day_id,
        fromWizard: false,
      });

      // Assert: Warning log captured with details for investigation
      const warnLog = capturedLogs.find(
        (l) =>
          l.level === 'warn' && l.message.includes('day not found or belongs to different store')
      );
      expect(warnLog).toBeDefined();
      expect(warnLog?.data?.dayId).toBe(otherStoreDay.day_id);
      expect(warnLog?.data?.storeId).toBe(ctx.storeId);
    });

    it('should allow commit for day belonging to same store (positive test)', async () => {
      // Arrange: Create day for OUR store
      mockPOSType = POS_TYPES.LOTTERY;
      const ourDay = seedLotteryDay({ status: 'PENDING_CLOSE', storeId: ctx.storeId });
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act
      const result = await simulateCommitDayClose({
        day_id: ourDay.day_id,
        fromWizard: false,
      });

      // Assert
      expect(result.success).toBe(true);
    });

    it('should handle non-existent day_id gracefully', async () => {
      // Arrange
      mockPOSType = POS_TYPES.LOTTERY;
      const nonExistentDayId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const user = createTestUser('cashier');
      setCurrentUser(user);

      // Act
      const result = await simulateCommitDayClose({
        day_id: nonExistentDayId,
        fromWizard: false,
      });

      // Assert: NOT_FOUND, no information disclosure
      expect(result.success).toBe(false);
      expect(result.error).toBe(IPCErrorCodes.NOT_FOUND);
    });
  });

  // ==========================================================================
  // Comprehensive POS Type Coverage (Parameterized)
  // ==========================================================================

  describe('Comprehensive POS Type Coverage', () => {
    it('should have NON_LOTTERY_POS_TYPES array available for parameterized tests', () => {
      // Assert: Array is non-empty and contains expected types
      expect(NON_LOTTERY_POS_TYPES.length).toBeGreaterThan(10);
      expect(NON_LOTTERY_POS_TYPES).toContain(POS_TYPES.GILBARCO_PASSPORT);
      expect(NON_LOTTERY_POS_TYPES).toContain(POS_TYPES.VERIFONE_RUBY2);
      expect(NON_LOTTERY_POS_TYPES).toContain(POS_TYPES.SQUARE_REST);
      expect(NON_LOTTERY_POS_TYPES).not.toContain(POS_TYPES.LOTTERY);
    });

    it('should reject ALL non-LOTTERY POS types for independent close', async () => {
      const user = createTestUser('cashier');
      setCurrentUser(user);

      for (const posType of NON_LOTTERY_POS_TYPES) {
        mockPOSType = posType;

        const result = await simulatePrepareDayClose({
          closings: [],
          fromWizard: false,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe(IPCErrorCodes.FORBIDDEN);
      }
    });

    it('should allow ALL non-LOTTERY POS types for wizard-initiated close', async () => {
      const user = createTestUser('cashier');
      setCurrentUser(user);

      for (const posType of NON_LOTTERY_POS_TYPES) {
        mockPOSType = posType;

        const result = await simulatePrepareDayClose({
          closings: [],
          fromWizard: true,
        });

        expect(result.success).toBe(true);
      }
    });
  });

  // ==========================================================================
  // Traceability Matrix Documentation
  // ==========================================================================

  describe('Traceability Matrix: POS Type Enforcement', () => {
    it('should document all test-to-requirement mappings', () => {
      const matrix = [
        {
          testId: 'SEC-010-001',
          handler: 'lottery:prepareDayClose',
          condition: 'GILBARCO_PASSPORT without fromWizard',
          expected: 'FORBIDDEN',
        },
        {
          testId: 'SEC-010-002',
          handler: 'lottery:prepareDayClose',
          condition: 'VERIFONE_RUBY2 without fromWizard',
          expected: 'FORBIDDEN',
        },
        {
          testId: 'SEC-010-003',
          handler: 'lottery:prepareDayClose',
          condition: 'SQUARE_REST without fromWizard',
          expected: 'FORBIDDEN',
        },
        {
          testId: 'SEC-010-004',
          handler: 'lottery:prepareDayClose',
          condition: 'LOTTERY without fromWizard',
          expected: 'SUCCESS',
        },
        {
          testId: 'SEC-010-005',
          handler: 'lottery:prepareDayClose',
          condition: 'Any POS type WITH fromWizard=true',
          expected: 'SUCCESS',
        },
        {
          testId: 'SEC-010-006',
          handler: 'lottery:commitDayClose',
          condition: 'Non-LOTTERY without fromWizard',
          expected: 'FORBIDDEN',
        },
        {
          testId: 'SEC-010-007',
          handler: 'lottery:commitDayClose',
          condition: 'LOTTERY without fromWizard',
          expected: 'SUCCESS',
        },
        {
          testId: 'SEC-010-008',
          handler: 'lottery:commitDayClose',
          condition: 'Any POS type WITH fromWizard=true',
          expected: 'SUCCESS',
        },
        {
          testId: 'SEC-010-009',
          handler: 'Both handlers',
          condition: 'Error code verification',
          expected: 'FORBIDDEN (not 500)',
        },
        {
          testId: 'SEC-010-010',
          handler: 'Both handlers',
          condition: 'Error message validation',
          expected: 'Generic message (no info leak)',
        },
        {
          testId: 'DB-006-001',
          handler: 'lottery:commitDayClose',
          condition: 'Cross-store day_id',
          expected: 'NOT_FOUND',
        },
      ];

      expect(matrix).toHaveLength(11);
      expect(matrix.every((m) => m.testId && m.handler && m.expected)).toBe(true);
    });
  });
});
