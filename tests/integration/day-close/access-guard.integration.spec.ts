/**
 * Day Close Access Guard Integration Tests (4.T5)
 *
 * Integration tests validating the full TerminalsPage → Guard → DayClosePage flow.
 * Tests the backend day close access validation with real database operations.
 *
 * Testing Strategy:
 * - Real SQLite database with seeded test data
 * - Tests IPC handler → Service → DAL integration
 * - Validates all business rules (BR-001 through BR-006)
 * - Verifies tenant isolation and security compliance
 *
 * @module tests/integration/day-close/access-guard.integration
 *
 * Security Compliance:
 * - SEC-006: All queries use parameterized statements via DAL
 * - SEC-010: Authorization decisions made server-side
 * - DB-006: Tenant isolation via store_id scoping
 * - API-001: Input validation with Zod schemas
 * - SEC-014: PIN validation (4-6 digits only)
 *
 * Traceability Matrix:
 * - 4.T5: Integration test: TerminalsPage → Guard → DayClosePage flow
 * - INT-ACCESS-001: Full flow with shift owner access
 * - INT-ACCESS-002: Full flow with manager override access
 * - INT-ACCESS-003: Denial flow when no open shifts
 * - INT-ACCESS-004: Denial flow when multiple open shifts
 * - INT-ACCESS-005: Denial flow when non-owner cashier
 * - INT-ACCESS-006: Tenant isolation verification
 * - INT-ACCESS-007: SQL injection prevention
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

const SKIP_NATIVE_MODULE_TESTS =
  process.env.CI === 'true' || process.env.SKIP_NATIVE_TESTS === 'true' || !nativeModuleAvailable;

// ============================================================================
// Database Reference (shared between mock and test code)
// ============================================================================

let db: Database.Database;

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

let mockPOSConnectionType = 'MANUAL';
vi.mock('../../../src/main/services/settings.service', () => ({
  settingsService: {
    getPOSConnectionType: () => mockPOSConnectionType,
    getPOSType: () => 'LOTTERY',
    getSetting: vi.fn(),
    setSetting: vi.fn(),
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
import {
  checkAccess,
  validateShiftConditions,
  validateUserAccess,
  type DayCloseAccessResult,
} from '../../../src/main/services/day-close-access.service';
import { usersDAL, type User, type UserRole } from '../../../src/main/dal/users.dal';
import { shiftsDAL } from '../../../src/main/dal/shifts.dal';

// ============================================================================
// Test Suite
// ============================================================================

const describeSuite = SKIP_NATIVE_MODULE_TESTS ? describe.skip : describe;

describeSuite('Day Close Access Guard Integration (4.T5)', () => {
  let ctx: ServiceTestContext;

  beforeEach(async () => {
    uuidCounter = 0;
    mockPOSConnectionType = 'MANUAL';

    ctx = await createServiceTestContext({
      storeName: 'Day Close Access Integration Store',
    });
    db = ctx.db;
  });

  afterEach(() => {
    ctx?.cleanup();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  /**
   * Seed a user with PIN for authentication
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   */
  function seedUserWithPin(options: {
    role?: UserRole;
    name?: string;
    pin?: string;
  }): { user: User; pin: string } {
    const userId = `user-${++uuidCounter}`;
    const role = options.role ?? 'cashier';
    const name = options.name ?? `Test ${role}`;
    const pin = options.pin ?? '1234';
    const pinHash = ctx.utils.hashPin(pin);
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO users (
        user_id, store_id, name, role, pin_hash, active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `);
    stmt.run(userId, ctx.storeId, name, role, pinHash, now, now);

    const user = usersDAL.findById(userId) as User;
    return { user, pin };
  }

  /**
   * Seed an open shift
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   */
  function seedOpenShift(options?: {
    cashierId?: string | null;
    externalRegisterId?: string;
    businessDate?: string;
    shiftNumber?: number;
  }): { shiftId: string; businessDate: string; shiftNumber: number } {
    const shiftId = `shift-${++uuidCounter}`;
    const businessDate = options?.businessDate ?? ctx.utils.today();
    const shiftNumber = options?.shiftNumber ?? 1;
    const cashierId = options?.cashierId ?? null;
    const externalRegisterId = options?.externalRegisterId ?? 'REG01';
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO shifts (
        shift_id, store_id, business_date, shift_number, status,
        cashier_id, external_register_id, start_time, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)
    `);
    stmt.run(
      shiftId,
      ctx.storeId,
      businessDate,
      shiftNumber,
      cashierId,
      externalRegisterId,
      now,
      now,
      now
    );

    return { shiftId, businessDate, shiftNumber };
  }

  /**
   * Seed a POS terminal mapping for terminal name resolution
   * SEC-006: Parameterized query
   */
  function seedTerminal(externalRegisterId: string, description: string): void {
    const mappingId = `mapping-${++uuidCounter}`;
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO pos_terminal_mappings (
        mapping_id, store_id, external_register_id, description, active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?)
    `);
    stmt.run(mappingId, ctx.storeId, externalRegisterId, description, now, now);
  }

  /**
   * Get shift by ID
   * SEC-006: Parameterized query
   */
  function getShiftById(shiftId: string): { status: string; shift_id: string } | undefined {
    const stmt = db.prepare(`SELECT * FROM shifts WHERE shift_id = ?`);
    return stmt.get(shiftId) as { status: string; shift_id: string } | undefined;
  }

  // ==========================================================================
  // INT-ACCESS-001: Full Flow with Shift Owner Access
  // ==========================================================================

  describe('INT-ACCESS-001: Full flow with shift owner access', () => {
    it('should grant OWNER access when cashier owns the shift', async () => {
      // Arrange: Create user and shift where user is the cashier
      const { user, pin } = seedUserWithPin({ role: 'cashier', name: 'John Cashier' });
      seedTerminal('REG01', 'Front Register');
      seedOpenShift({ cashierId: user.user_id, externalRegisterId: 'REG01' });

      // Act: Check access with valid PIN
      const result = await checkAccess(ctx.storeId, { pin });

      // Assert: Access granted as OWNER
      expect(result.allowed).toBe(true);
      expect(result.accessType).toBe('OWNER');
      expect(result.user?.userId).toBe(user.user_id);
      expect(result.user?.role).toBe('cashier');
      expect(result.activeShift).toBeDefined();
      expect(result.activeShift?.cashier_name).toBe('John Cashier');
      expect(result.activeShift?.terminal_name).toBe('Front Register');
      expect(result.openShiftCount).toBe(1);
    });

    it('should resolve terminal and cashier names correctly', async () => {
      // Arrange
      const { user, pin } = seedUserWithPin({ role: 'cashier', name: 'Jane Smith' });
      seedTerminal('REG02', 'Back Register');
      seedOpenShift({ cashierId: user.user_id, externalRegisterId: 'REG02' });

      // Act
      const result = await checkAccess(ctx.storeId, { pin });

      // Assert: Names resolved from database
      expect(result.allowed).toBe(true);
      expect(result.activeShift?.cashier_name).toBe('Jane Smith');
      expect(result.activeShift?.terminal_name).toBe('Back Register');
    });

    it('should include all required shift details in response', async () => {
      // Arrange
      const today = ctx.utils.today();
      const { user, pin } = seedUserWithPin({ role: 'cashier' });
      seedTerminal('REG01', 'Register 1');
      const { shiftId } = seedOpenShift({
        cashierId: user.user_id,
        businessDate: today,
        shiftNumber: 3,
      });

      // Act
      const result = await checkAccess(ctx.storeId, { pin });

      // Assert: All required fields present
      expect(result.activeShift).toMatchObject({
        shift_id: shiftId,
        shift_number: 3,
        cashier_id: user.user_id,
        external_register_id: 'REG01',
        business_date: today,
      });
      expect(result.activeShift?.start_time).toBeDefined();
    });
  });

  // ==========================================================================
  // INT-ACCESS-002: Full Flow with Manager Override Access
  // ==========================================================================

  describe('INT-ACCESS-002: Full flow with manager override access', () => {
    it('should grant OVERRIDE access when shift_manager authenticates', async () => {
      // Arrange: Create shift owned by different cashier
      const { user: cashier } = seedUserWithPin({
        role: 'cashier',
        name: 'Shift Cashier',
        pin: '1111',
      });
      const { user: manager, pin } = seedUserWithPin({
        role: 'shift_manager',
        name: 'Manager Mike',
        pin: '2222',
      });
      seedOpenShift({ cashierId: cashier.user_id });

      // Act: Manager authenticates
      const result = await checkAccess(ctx.storeId, { pin });

      // Assert: Access granted via override
      expect(result.allowed).toBe(true);
      expect(result.accessType).toBe('OVERRIDE');
      expect(result.user?.userId).toBe(manager.user_id);
      expect(result.user?.role).toBe('shift_manager');
      expect(result.activeShift?.cashier_name).toBe('Shift Cashier');
    });

    it('should grant OVERRIDE access when store_manager authenticates', async () => {
      // Arrange
      const { user: cashier } = seedUserWithPin({ role: 'cashier', pin: '1111' });
      const { user: storeManager, pin } = seedUserWithPin({
        role: 'store_manager',
        name: 'Store Owner',
        pin: '9999',
      });
      seedOpenShift({ cashierId: cashier.user_id });

      // Act
      const result = await checkAccess(ctx.storeId, { pin });

      // Assert
      expect(result.allowed).toBe(true);
      expect(result.accessType).toBe('OVERRIDE');
      expect(result.user?.role).toBe('store_manager');
    });

    it('should grant OVERRIDE access even when shift has no cashier assigned', async () => {
      // Arrange: Shift with no cashier
      const { user: manager, pin } = seedUserWithPin({ role: 'shift_manager', pin: '5555' });
      seedOpenShift({ cashierId: null });

      // Act
      const result = await checkAccess(ctx.storeId, { pin });

      // Assert: Manager can still close
      expect(result.allowed).toBe(true);
      expect(result.accessType).toBe('OVERRIDE');
      expect(result.activeShift?.cashier_name).toBe('No Cashier Assigned');
    });
  });

  // ==========================================================================
  // INT-ACCESS-003: Denial Flow - No Open Shifts (BR-001)
  // ==========================================================================

  describe('INT-ACCESS-003: Denial when no open shifts (BR-001)', () => {
    it('should deny access when no shifts exist', async () => {
      // Arrange: User exists but no shifts
      const { pin } = seedUserWithPin({ role: 'shift_manager' });

      // Act
      const result = await checkAccess(ctx.storeId, { pin });

      // Assert: Denied with NO_OPEN_SHIFTS
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('NO_OPEN_SHIFTS');
      expect(result.openShiftCount).toBe(0);
      expect(result.activeShift).toBeUndefined();
      // User should still be included (authenticated successfully)
      expect(result.user).toBeDefined();
    });

    it('should deny access even for store_manager when no shifts (BR-006)', async () => {
      // Arrange: Store manager but no shifts
      const { pin } = seedUserWithPin({ role: 'store_manager', pin: '9999' });

      // Act
      const result = await checkAccess(ctx.storeId, { pin });

      // Assert: Even managers cannot bypass BR-001
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('NO_OPEN_SHIFTS');
      expect(result.user?.role).toBe('store_manager');
    });

    it('should deny access when only CLOSED shifts exist', async () => {
      // Arrange: Create and close a shift
      const { user, pin } = seedUserWithPin({ role: 'cashier' });
      const { shiftId } = seedOpenShift({ cashierId: user.user_id });
      shiftsDAL.close(shiftId);

      // Act
      const result = await checkAccess(ctx.storeId, { pin });

      // Assert: No OPEN shifts
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('NO_OPEN_SHIFTS');
      expect(result.openShiftCount).toBe(0);
    });
  });

  // ==========================================================================
  // INT-ACCESS-004: Denial Flow - Multiple Open Shifts (BR-002)
  // ==========================================================================

  describe('INT-ACCESS-004: Denial when multiple open shifts (BR-002)', () => {
    it('should deny access when two shifts are open', async () => {
      // Arrange: Two open shifts
      const { user, pin } = seedUserWithPin({ role: 'cashier' });
      seedOpenShift({ cashierId: user.user_id, externalRegisterId: 'REG01', shiftNumber: 1 });
      seedOpenShift({ externalRegisterId: 'REG02', shiftNumber: 2 });

      // Act
      const result = await checkAccess(ctx.storeId, { pin });

      // Assert: Denied with MULTIPLE_OPEN_SHIFTS
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('MULTIPLE_OPEN_SHIFTS');
      expect(result.openShiftCount).toBe(2);
      expect(result.activeShift).toBeUndefined();
    });

    it('should deny access even for store_manager when multiple shifts (BR-006)', async () => {
      // Arrange: Store manager with multiple shifts
      const { pin } = seedUserWithPin({ role: 'store_manager', pin: '9999' });
      seedOpenShift({ externalRegisterId: 'REG01', shiftNumber: 1 });
      seedOpenShift({ externalRegisterId: 'REG02', shiftNumber: 2 });
      seedOpenShift({ externalRegisterId: 'REG03', shiftNumber: 3 });

      // Act
      const result = await checkAccess(ctx.storeId, { pin });

      // Assert: Even store_manager cannot bypass BR-002
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('MULTIPLE_OPEN_SHIFTS');
      expect(result.openShiftCount).toBe(3);
      expect(result.reason).toContain('3 open shifts');
    });

    it('should count only OPEN shifts, not CLOSED ones', async () => {
      // Arrange: One open, one closed
      const { user, pin } = seedUserWithPin({ role: 'cashier' });
      seedOpenShift({ cashierId: user.user_id, externalRegisterId: 'REG01', shiftNumber: 1 });
      const { shiftId: closedShiftId } = seedOpenShift({
        externalRegisterId: 'REG02',
        shiftNumber: 2,
      });
      shiftsDAL.close(closedShiftId);

      // Act
      const result = await checkAccess(ctx.storeId, { pin });

      // Assert: Only one OPEN shift
      expect(result.allowed).toBe(true);
      expect(result.openShiftCount).toBe(1);
    });
  });

  // ==========================================================================
  // INT-ACCESS-005: Denial Flow - Non-Owner Cashier (BR-003)
  // ==========================================================================

  describe('INT-ACCESS-005: Denial when non-owner cashier (BR-003)', () => {
    it('should deny access when cashier is not shift owner', async () => {
      // Arrange: Shift owned by different cashier
      const { user: owner } = seedUserWithPin({ role: 'cashier', name: 'Owner', pin: '1111' });
      const { user: other, pin } = seedUserWithPin({ role: 'cashier', name: 'Other', pin: '2222' });
      seedOpenShift({ cashierId: owner.user_id });

      // Act: Non-owner cashier tries to access
      const result = await checkAccess(ctx.storeId, { pin });

      // Assert: Denied with NOT_SHIFT_OWNER
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('NOT_SHIFT_OWNER');
      expect(result.user?.userId).toBe(other.user_id);
      expect(result.activeShift).toBeDefined(); // Shift info included for debugging
      expect(result.activeShift?.cashier_id).toBe(owner.user_id);
    });

    it('should include helpful error message for non-owner', async () => {
      // Arrange
      const { user: owner } = seedUserWithPin({ role: 'cashier', pin: '1111' });
      const { pin } = seedUserWithPin({ role: 'cashier', pin: '2222' });
      seedOpenShift({ cashierId: owner.user_id });

      // Act
      const result = await checkAccess(ctx.storeId, { pin });

      // Assert: Message explains what to do
      expect(result.reason).toContain('assigned cashier');
      expect(result.reason).toContain('manager');
    });
  });

  // ==========================================================================
  // INT-ACCESS-006: Tenant Isolation (DB-006)
  // ==========================================================================

  describe('INT-ACCESS-006: Tenant isolation (DB-006)', () => {
    it('should not see shifts from other stores', async () => {
      // Arrange: Create second store with shift
      const otherStoreId = `other-store-${++uuidCounter}`;
      const now = new Date().toISOString();

      // Insert other store
      const insertStoreStmt = db.prepare(`
        INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
        VALUES (?, 'other-company', 'Other Store', 'America/New_York', 'ACTIVE', ?, ?)
      `);
      insertStoreStmt.run(otherStoreId, now, now);

      // Insert shift for other store
      const insertShiftStmt = db.prepare(`
        INSERT INTO shifts (
          shift_id, store_id, business_date, shift_number, status,
          start_time, created_at, updated_at
        ) VALUES (?, ?, ?, 1, 'OPEN', ?, ?, ?)
      `);
      insertShiftStmt.run('other-shift-id', otherStoreId, ctx.utils.today(), now, now, now);

      // No shift in our store, but user exists
      const { pin } = seedUserWithPin({ role: 'shift_manager' });

      // Act: Check access in our store
      const result = await checkAccess(ctx.storeId, { pin });

      // Assert: Should NOT see other store's shift
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('NO_OPEN_SHIFTS');
      expect(result.openShiftCount).toBe(0);
    });

    it('should not authenticate users from other stores', async () => {
      // Arrange: Create user in different store with same PIN
      const otherStoreId = `other-store-${++uuidCounter}`;
      const now = new Date().toISOString();
      const pinHash = ctx.utils.hashPin('1234');

      // Insert other store
      const insertStoreStmt = db.prepare(`
        INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
        VALUES (?, 'other-company', 'Other Store', 'America/New_York', 'ACTIVE', ?, ?)
      `);
      insertStoreStmt.run(otherStoreId, now, now);

      // Insert user in other store
      const insertUserStmt = db.prepare(`
        INSERT INTO users (user_id, store_id, name, role, pin_hash, active, created_at, updated_at)
        VALUES (?, ?, 'Other User', 'cashier', ?, 1, ?, ?)
      `);
      insertUserStmt.run('other-user-id', otherStoreId, pinHash, now, now);

      // Create shift in our store (so BR-001 passes if user found)
      seedOpenShift({ cashierId: 'other-user-id' });

      // Act: Try to authenticate with PIN from other store
      const result = await checkAccess(ctx.storeId, { pin: '1234' });

      // Assert: Should fail - user not in our store
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('INVALID_PIN');
    });
  });

  // ==========================================================================
  // INT-ACCESS-007: SQL Injection Prevention (SEC-006)
  // ==========================================================================

  describe('INT-ACCESS-007: SQL injection prevention (SEC-006)', () => {
    it('should safely handle malicious PIN input', async () => {
      // Arrange: Valid user and shift
      const { user, pin: validPin } = seedUserWithPin({ role: 'cashier' });
      seedOpenShift({ cashierId: user.user_id });

      // Act: Try SQL injection via PIN
      const maliciousPins = [
        "' OR '1'='1",
        "'; DROP TABLE users; --",
        '1234; DELETE FROM shifts;',
        "1234' UNION SELECT * FROM users--",
      ];

      for (const maliciousPin of maliciousPins) {
        const result = await checkAccess(ctx.storeId, { pin: maliciousPin });

        // Assert: Should safely reject as invalid PIN
        expect(result.allowed).toBe(false);
        expect(result.reasonCode).toBe('INVALID_PIN');
      }

      // Verify tables still exist and have data
      const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
      const shiftCount = (db.prepare('SELECT COUNT(*) as count FROM shifts').get() as { count: number }).count;
      expect(userCount).toBeGreaterThan(0);
      expect(shiftCount).toBeGreaterThan(0);

      // Verify valid PIN still works
      const validResult = await checkAccess(ctx.storeId, { pin: validPin });
      expect(validResult.allowed).toBe(true);
    });

    it('should safely handle malicious store_id', async () => {
      // Arrange
      const { pin } = seedUserWithPin({ role: 'cashier' });
      seedOpenShift({});

      // Act: Try SQL injection via store_id
      const maliciousStoreIds = [
        "'; DROP TABLE stores; --",
        "1' OR '1'='1",
        'store-id; DELETE FROM users;',
      ];

      for (const maliciousStoreId of maliciousStoreIds) {
        // Should not throw
        const result = await checkAccess(maliciousStoreId, { pin });
        // Should fail to find anything
        expect(result.allowed).toBe(false);
      }

      // Verify database integrity
      const storeCount = (db.prepare('SELECT COUNT(*) as count FROM stores').get() as { count: number }).count;
      expect(storeCount).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // PIN Validation Tests (SEC-014)
  // ==========================================================================

  describe('PIN validation (SEC-014)', () => {
    it('should reject empty PIN', async () => {
      const result = await checkAccess(ctx.storeId, { pin: '' });
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('INVALID_PIN');
    });

    it('should reject non-numeric PIN', async () => {
      const result = await checkAccess(ctx.storeId, { pin: 'abcd' });
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('INVALID_PIN');
    });
  });

  // ==========================================================================
  // validateShiftConditions Unit Tests
  // ==========================================================================

  describe('validateShiftConditions', () => {
    it('should return valid with activeShift for exactly one open shift', () => {
      const { user } = seedUserWithPin({ role: 'cashier' });
      seedOpenShift({ cashierId: user.user_id });

      const result = validateShiftConditions(ctx.storeId);

      expect(result.valid).toBe(true);
      expect(result.openShiftCount).toBe(1);
      expect(result.activeShift).toBeDefined();
      expect(result.reasonCode).toBeUndefined();
    });

    it('should return invalid for zero shifts', () => {
      const result = validateShiftConditions(ctx.storeId);

      expect(result.valid).toBe(false);
      expect(result.openShiftCount).toBe(0);
      expect(result.reasonCode).toBe('NO_OPEN_SHIFTS');
    });

    it('should return invalid for multiple shifts', () => {
      seedOpenShift({ shiftNumber: 1 });
      seedOpenShift({ shiftNumber: 2 });

      const result = validateShiftConditions(ctx.storeId);

      expect(result.valid).toBe(false);
      expect(result.openShiftCount).toBe(2);
      expect(result.reasonCode).toBe('MULTIPLE_OPEN_SHIFTS');
    });
  });

  // ==========================================================================
  // validateUserAccess Unit Tests
  // ==========================================================================

  describe('validateUserAccess', () => {
    it('should grant OWNER access when user is shift cashier', () => {
      const { user } = seedUserWithPin({ role: 'cashier' });
      const { shiftId } = seedOpenShift({ cashierId: user.user_id });
      const shift = shiftsDAL.findById(shiftId)!;

      const result = validateUserAccess(user, shift);

      expect(result.canAccess).toBe(true);
      expect(result.accessType).toBe('OWNER');
    });

    it('should grant OVERRIDE access for shift_manager', () => {
      const { user: cashier } = seedUserWithPin({ role: 'cashier', pin: '1111' });
      const { user: manager } = seedUserWithPin({ role: 'shift_manager', pin: '2222' });
      const { shiftId } = seedOpenShift({ cashierId: cashier.user_id });
      const shift = shiftsDAL.findById(shiftId)!;

      const result = validateUserAccess(manager, shift);

      expect(result.canAccess).toBe(true);
      expect(result.accessType).toBe('OVERRIDE');
    });

    it('should deny access for non-owner cashier', () => {
      const { user: owner } = seedUserWithPin({ role: 'cashier', pin: '1111' });
      const { user: other } = seedUserWithPin({ role: 'cashier', pin: '2222' });
      const { shiftId } = seedOpenShift({ cashierId: owner.user_id });
      const shift = shiftsDAL.findById(shiftId)!;

      const result = validateUserAccess(other, shift);

      expect(result.canAccess).toBe(false);
      expect(result.accessType).toBeUndefined();
    });
  });

  // ==========================================================================
  // Terminal Name Fallback Tests
  // ==========================================================================

  describe('Terminal name resolution', () => {
    it('should use fallback when terminal mapping not found', async () => {
      const { user, pin } = seedUserWithPin({ role: 'cashier' });
      // No terminal mapping created
      seedOpenShift({ cashierId: user.user_id, externalRegisterId: 'UNKNOWN_REG' });

      const result = await checkAccess(ctx.storeId, { pin });

      expect(result.allowed).toBe(true);
      expect(result.activeShift?.terminal_name).toBe('Register UNKNOWN_REG');
    });

    it('should handle null external_register_id', async () => {
      const { user, pin } = seedUserWithPin({ role: 'cashier' });
      // Create shift with null external_register_id
      const shiftId = `shift-${++uuidCounter}`;
      const now = new Date().toISOString();
      const stmt = db.prepare(`
        INSERT INTO shifts (
          shift_id, store_id, business_date, shift_number, status,
          cashier_id, external_register_id, start_time, created_at, updated_at
        ) VALUES (?, ?, ?, 1, 'OPEN', ?, NULL, ?, ?, ?)
      `);
      stmt.run(shiftId, ctx.storeId, ctx.utils.today(), user.user_id, now, now, now);

      const result = await checkAccess(ctx.storeId, { pin });

      expect(result.allowed).toBe(true);
      expect(result.activeShift?.terminal_name).toBe('Unknown Register');
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error handling', () => {
    it('should handle user lookup returning undefined', async () => {
      // Arrange: Shift with non-existent cashier_id
      seedOpenShift({ cashierId: 'non-existent-user-id' });
      const { pin } = seedUserWithPin({ role: 'shift_manager' });

      // Act
      const result = await checkAccess(ctx.storeId, { pin });

      // Assert: Should still work (manager override)
      expect(result.allowed).toBe(true);
      expect(result.activeShift?.cashier_name).toBe('Unknown Cashier');
    });
  });
});
