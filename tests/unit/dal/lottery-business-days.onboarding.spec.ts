/**
 * Lottery Business Days DAL - Onboarding State Unit Tests
 *
 * Tests for BIZ-012-FIX onboarding state persistence in database.
 * Validates:
 * - setOnboardingFlag() correctly updates the is_onboarding column
 * - findOnboardingDay() correctly queries onboarding days
 * - SEC-006: All queries use parameterized statements (no SQL injection)
 * - DB-006: Tenant isolation - stores cannot see each other's onboarding state
 *
 * Test IDs per Phase 1 plan:
 * - DAL-ONB-001: setOnboardingFlag updates is_onboarding to 1
 * - DAL-ONB-002: setOnboardingFlag updates is_onboarding to 0
 * - DAL-ONB-003: findOnboardingDay returns day where is_onboarding=1
 * - DAL-ONB-004: findOnboardingDay returns null when no onboarding day
 * - DAL-ONB-005: Tenant isolation: Store A cannot see Store B's onboarding
 * - DAL-ONB-006: SQL injection attempt in dayId rejected
 *
 * @module tests/unit/dal/lottery-business-days.onboarding
 * @security SEC-006, DB-006
 * @business BIZ-012-FIX
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LotteryBusinessDaysDAL } from '../../../src/main/dal/lottery-business-days.dal';

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

// Use vi.hoisted() with a container object for mutable testDb reference
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { testDbContainer, mockSyncQueueEnqueue } = vi.hoisted(() => ({
  testDbContainer: { db: null as any },
  mockSyncQueueEnqueue: vi.fn(),
}));

// Mock database service to return our in-memory test database
vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => testDbContainer.db),
  isDatabaseInitialized: vi.fn(() => testDbContainer.db !== null),
}));

// Mock sync-queue.dal to prevent sync side effects during tests
vi.mock('../../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: {
    enqueue: mockSyncQueueEnqueue,
  },
}));

// Mock lottery dependencies (not testing them here)
vi.mock('../../../src/main/dal/lottery-games.dal', () => ({
  lotteryGamesDAL: {
    findById: vi.fn().mockReturnValue({
      game_id: 'game-1',
      game_code: '1001',
      tickets_per_pack: 300,
    }),
  },
}));

vi.mock('../../../src/main/dal/lottery-packs.dal', () => ({
  lotteryPacksDAL: {
    getPackWithDetails: vi.fn(),
    calculateSales: vi.fn(),
    settle: vi.fn(),
  },
}));

// ============================================================================
// Test Constants
// ============================================================================

const STORE_A_ID = 'store-a-uuid-0001';
const STORE_B_ID = 'store-b-uuid-0002';
const STORE_C_ID = 'store-c-uuid-0003';
const USER_ID = 'user-uuid-0001';

// SEC-006: SQL Injection test payloads
// These should never cause SQL execution - only be treated as literal strings
const SQL_INJECTION_PAYLOADS = [
  "'; DROP TABLE lottery_business_days; --",
  "' OR '1'='1",
  "'; SELECT * FROM stores; --",
  '1; DELETE FROM lottery_business_days;',
  "' UNION SELECT * FROM lottery_business_days --",
  "'); DROP TABLE stores; --",
  "' OR 1=1 --",
  '1 OR 1=1',
  "'; TRUNCATE TABLE lottery_business_days; --",
  "' AND (SELECT COUNT(*) FROM lottery_business_days) > 0 --",
];

// ============================================================================
// Test Suite
// ============================================================================

describe.skipIf(skipTests)('Lottery Business Days DAL - Onboarding State', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let dal: LotteryBusinessDaysDAL;

  beforeEach(() => {
    // Create in-memory database
    db = new Database(':memory:');
    testDbContainer.db = db;

    // Create required tables with proper schema including is_onboarding column
    db.exec(`
      -- DB-006: stores table for tenant isolation validation
      CREATE TABLE stores (
        store_id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        name TEXT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'America/New_York',
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE lottery_business_days (
        day_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        business_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN',
        is_onboarding INTEGER NOT NULL DEFAULT 0,
        opened_at TEXT,
        closed_at TEXT,
        opened_by TEXT,
        closed_by TEXT,
        total_sales REAL NOT NULL DEFAULT 0,
        total_packs_sold INTEGER NOT NULL DEFAULT 0,
        total_packs_activated INTEGER NOT NULL DEFAULT 0,
        day_summary_id TEXT,
        synced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX idx_lottery_days_store ON lottery_business_days(store_id);
      CREATE INDEX idx_lottery_days_date ON lottery_business_days(business_date);
      CREATE INDEX idx_lottery_days_status ON lottery_business_days(store_id, status);
      CREATE INDEX idx_lottery_days_onboarding ON lottery_business_days(store_id, is_onboarding);

      -- DB-006: Insert test stores for multi-tenant tests
      INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
      VALUES
        ('${STORE_A_ID}', 'company-1', 'Store A', 'America/New_York', 'ACTIVE', datetime('now'), datetime('now')),
        ('${STORE_B_ID}', 'company-1', 'Store B', 'America/New_York', 'ACTIVE', datetime('now'), datetime('now')),
        ('${STORE_C_ID}', 'company-2', 'Store C', 'America/Los_Angeles', 'ACTIVE', datetime('now'), datetime('now'));
    `);

    // Create DAL instance - uses testDb via mocked getDatabase()
    dal = new LotteryBusinessDaysDAL();

    // Reset mocks
    mockSyncQueueEnqueue.mockReturnValue({ id: 'sync-queue-item-1' });
  });

  afterEach(() => {
    db.close();
    testDbContainer.db = null;
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  /**
   * Insert a test business day
   * @param dayId - Day ID
   * @param storeId - Store ID
   * @param options - Additional options
   */
  function insertTestDay(
    dayId: string,
    storeId: string,
    options: {
      businessDate?: string;
      status?: string;
      isOnboarding?: boolean;
    } = {}
  ) {
    const { businessDate = '2026-02-16', status = 'OPEN', isOnboarding = false } = options;

    db.prepare(
      `
      INSERT INTO lottery_business_days
        (day_id, store_id, business_date, status, is_onboarding, opened_at, opened_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
    `
    ).run(dayId, storeId, businessDate, status, isOnboarding ? 1 : 0, USER_ID);
  }

  /**
   * Get the raw is_onboarding value from database
   */
  function getRawOnboardingValue(dayId: string): number | undefined {
    const result = db
      .prepare('SELECT is_onboarding FROM lottery_business_days WHERE day_id = ?')
      .get(dayId) as { is_onboarding: number } | undefined;
    return result?.is_onboarding;
  }

  // ==========================================================================
  // setOnboardingFlag() Tests
  // ==========================================================================

  describe('setOnboardingFlag', () => {
    // DAL-ONB-001: setOnboardingFlag updates is_onboarding to 1
    describe('DAL-ONB-001: updates is_onboarding to 1', () => {
      it('sets is_onboarding to 1 (true) for existing day', () => {
        // Arrange: Create a day with is_onboarding = 0
        insertTestDay('day-1', STORE_A_ID, { isOnboarding: false });
        expect(getRawOnboardingValue('day-1')).toBe(0);

        // Act: Set onboarding flag to true
        const result = dal.setOnboardingFlag(STORE_A_ID, 'day-1', true);

        // Assert
        expect(result).toBe(true);
        expect(getRawOnboardingValue('day-1')).toBe(1);
      });

      it('returns true when update succeeds', () => {
        insertTestDay('day-1', STORE_A_ID);

        const result = dal.setOnboardingFlag(STORE_A_ID, 'day-1', true);

        expect(result).toBe(true);
      });

      it('updates the updated_at timestamp', () => {
        insertTestDay('day-1', STORE_A_ID);
        const beforeUpdate = db
          .prepare('SELECT updated_at FROM lottery_business_days WHERE day_id = ?')
          .get('day-1') as { updated_at: string };

        // Small delay to ensure timestamp difference
        const originalNow = Date.now;
        Date.now = () => originalNow() + 1000;

        dal.setOnboardingFlag(STORE_A_ID, 'day-1', true);

        const afterUpdate = db
          .prepare('SELECT updated_at FROM lottery_business_days WHERE day_id = ?')
          .get('day-1') as { updated_at: string };

        Date.now = originalNow;

        expect(afterUpdate.updated_at).not.toBe(beforeUpdate.updated_at);
      });
    });

    // DAL-ONB-002: setOnboardingFlag updates is_onboarding to 0
    describe('DAL-ONB-002: updates is_onboarding to 0', () => {
      it('sets is_onboarding to 0 (false) for existing day', () => {
        // Arrange: Create a day with is_onboarding = 1
        insertTestDay('day-1', STORE_A_ID, { isOnboarding: true });
        expect(getRawOnboardingValue('day-1')).toBe(1);

        // Act: Set onboarding flag to false
        const result = dal.setOnboardingFlag(STORE_A_ID, 'day-1', false);

        // Assert
        expect(result).toBe(true);
        expect(getRawOnboardingValue('day-1')).toBe(0);
      });

      it('can toggle onboarding flag multiple times', () => {
        insertTestDay('day-1', STORE_A_ID);

        // Enable
        dal.setOnboardingFlag(STORE_A_ID, 'day-1', true);
        expect(getRawOnboardingValue('day-1')).toBe(1);

        // Disable
        dal.setOnboardingFlag(STORE_A_ID, 'day-1', false);
        expect(getRawOnboardingValue('day-1')).toBe(0);

        // Enable again
        dal.setOnboardingFlag(STORE_A_ID, 'day-1', true);
        expect(getRawOnboardingValue('day-1')).toBe(1);
      });
    });

    // DB-006: Tenant Isolation
    describe('tenant isolation (DB-006)', () => {
      it('returns false when dayId does not exist', () => {
        const result = dal.setOnboardingFlag(STORE_A_ID, 'non-existent-day', true);

        expect(result).toBe(false);
      });

      it('returns false when dayId belongs to different store', () => {
        // Day belongs to Store B
        insertTestDay('day-b-1', STORE_B_ID);

        // Try to update it using Store A's context
        const result = dal.setOnboardingFlag(STORE_A_ID, 'day-b-1', true);

        // Should fail - wrong store
        expect(result).toBe(false);
        // Verify the value was NOT changed
        expect(getRawOnboardingValue('day-b-1')).toBe(0);
      });

      it('only updates day for the correct store', () => {
        // Create days for both stores
        insertTestDay('day-a-1', STORE_A_ID);
        insertTestDay('day-b-1', STORE_B_ID);

        // Update Store A's day
        dal.setOnboardingFlag(STORE_A_ID, 'day-a-1', true);

        // Store A's day should be updated
        expect(getRawOnboardingValue('day-a-1')).toBe(1);
        // Store B's day should NOT be affected
        expect(getRawOnboardingValue('day-b-1')).toBe(0);
      });
    });

    // SEC-006: SQL Injection Prevention
    describe('SQL injection prevention (SEC-006)', () => {
      it.each(SQL_INJECTION_PAYLOADS)('handles SQL injection in dayId safely: %s', (payload) => {
        insertTestDay('day-1', STORE_A_ID);

        // Attempt SQL injection via dayId parameter
        const result = dal.setOnboardingFlag(STORE_A_ID, payload, true);

        // Should return false (no matching day)
        expect(result).toBe(false);

        // Verify table still exists and original data is intact
        const tableCheck = db
          .prepare('SELECT COUNT(*) as count FROM sqlite_master WHERE type = ? AND name = ?')
          .get('table', 'lottery_business_days');
        expect(tableCheck.count).toBe(1);

        // Original day should be unchanged
        expect(getRawOnboardingValue('day-1')).toBe(0);
      });

      it.each(SQL_INJECTION_PAYLOADS)('handles SQL injection in storeId safely: %s', (payload) => {
        insertTestDay('day-1', STORE_A_ID);

        // Attempt SQL injection via storeId parameter
        const result = dal.setOnboardingFlag(payload, 'day-1', true);

        // Should return false (no matching store)
        expect(result).toBe(false);

        // Original day should be unchanged
        expect(getRawOnboardingValue('day-1')).toBe(0);
      });

      it('uses parameterized queries (no string interpolation)', () => {
        insertTestDay('day-1', STORE_A_ID);

        // Spy on db.prepare to capture SQL
        const originalPrepare = db.prepare.bind(db);
        const preparedStatements: string[] = [];
        db.prepare = (sql: string) => {
          preparedStatements.push(sql);
          return originalPrepare(sql);
        };

        dal.setOnboardingFlag(STORE_A_ID, 'day-1', true);

        // Find the UPDATE statement
        const updateQuery = preparedStatements.find(
          (sql) => sql.includes('UPDATE') && sql.includes('lottery_business_days')
        );
        expect(updateQuery).toBeDefined();
        expect(updateQuery).toContain('is_onboarding = ?');
        expect(updateQuery).toContain('day_id = ?');
        expect(updateQuery).toContain('store_id = ?');
        // Should NOT contain literal values
        expect(updateQuery).not.toContain(STORE_A_ID);
        expect(updateQuery).not.toContain('day-1');

        db.prepare = originalPrepare;
      });
    });
  });

  // ==========================================================================
  // findOnboardingDay() Tests
  // ==========================================================================

  describe('findOnboardingDay', () => {
    // DAL-ONB-003: findOnboardingDay returns day where is_onboarding=1
    describe('DAL-ONB-003: returns day where is_onboarding=1', () => {
      it('returns the onboarding day when one exists', () => {
        // Arrange: Create a day with is_onboarding = 1
        insertTestDay('day-1', STORE_A_ID, { isOnboarding: true });

        // Act
        const result = dal.findOnboardingDay(STORE_A_ID);

        // Assert
        expect(result).not.toBeNull();
        expect(result?.day_id).toBe('day-1');
        expect(result?.store_id).toBe(STORE_A_ID);
        expect(result?.is_onboarding).toBe(1);
      });

      it('returns the day with all expected fields populated', () => {
        insertTestDay('day-1', STORE_A_ID, {
          isOnboarding: true,
          businessDate: '2026-02-16',
          status: 'OPEN',
        });

        const result = dal.findOnboardingDay(STORE_A_ID);

        expect(result).not.toBeNull();
        expect(result).toMatchObject({
          day_id: 'day-1',
          store_id: STORE_A_ID,
          business_date: '2026-02-16',
          status: 'OPEN',
          is_onboarding: 1,
        });
        expect(result?.created_at).toBeDefined();
        expect(result?.updated_at).toBeDefined();
      });

      it('returns the onboarding day even if other non-onboarding days exist', () => {
        // Create multiple days, only one is onboarding
        insertTestDay('day-1', STORE_A_ID, { isOnboarding: false });
        insertTestDay('day-2', STORE_A_ID, { isOnboarding: true });
        insertTestDay('day-3', STORE_A_ID, { isOnboarding: false });

        const result = dal.findOnboardingDay(STORE_A_ID);

        expect(result).not.toBeNull();
        expect(result?.day_id).toBe('day-2');
        expect(result?.is_onboarding).toBe(1);
      });
    });

    // DAL-ONB-004: findOnboardingDay returns null when no onboarding day
    describe('DAL-ONB-004: returns null when no onboarding day', () => {
      it('returns null when store has no days at all', () => {
        const result = dal.findOnboardingDay(STORE_A_ID);

        expect(result).toBeNull();
      });

      it('returns null when store has days but none are onboarding', () => {
        // Create days with is_onboarding = 0
        insertTestDay('day-1', STORE_A_ID, { isOnboarding: false });
        insertTestDay('day-2', STORE_A_ID, { isOnboarding: false });

        const result = dal.findOnboardingDay(STORE_A_ID);

        expect(result).toBeNull();
      });

      it('returns null for non-existent store', () => {
        const result = dal.findOnboardingDay('non-existent-store-uuid');

        expect(result).toBeNull();
      });

      it('returns null after onboarding is completed (flag set to 0)', () => {
        // Start with onboarding day
        insertTestDay('day-1', STORE_A_ID, { isOnboarding: true });
        expect(dal.findOnboardingDay(STORE_A_ID)).not.toBeNull();

        // Complete onboarding
        dal.setOnboardingFlag(STORE_A_ID, 'day-1', false);

        // Should now return null
        expect(dal.findOnboardingDay(STORE_A_ID)).toBeNull();
      });
    });

    // DAL-ONB-005: Tenant isolation
    describe('DAL-ONB-005: tenant isolation', () => {
      it('Store A cannot see Store B onboarding day', () => {
        // Store B has an onboarding day
        insertTestDay('day-b-1', STORE_B_ID, { isOnboarding: true });

        // Store A queries for onboarding - should NOT see Store B's day
        const resultA = dal.findOnboardingDay(STORE_A_ID);
        expect(resultA).toBeNull();

        // Store B queries - SHOULD see its own day
        const resultB = dal.findOnboardingDay(STORE_B_ID);
        expect(resultB).not.toBeNull();
        expect(resultB?.day_id).toBe('day-b-1');
      });

      it('each store only sees its own onboarding day', () => {
        // Both stores have onboarding days
        insertTestDay('day-a-1', STORE_A_ID, { isOnboarding: true });
        insertTestDay('day-b-1', STORE_B_ID, { isOnboarding: true });
        insertTestDay('day-c-1', STORE_C_ID, { isOnboarding: true });

        // Each store only sees its own
        const resultA = dal.findOnboardingDay(STORE_A_ID);
        expect(resultA?.day_id).toBe('day-a-1');

        const resultB = dal.findOnboardingDay(STORE_B_ID);
        expect(resultB?.day_id).toBe('day-b-1');

        const resultC = dal.findOnboardingDay(STORE_C_ID);
        expect(resultC?.day_id).toBe('day-c-1');
      });

      it('changing onboarding state in one store does not affect others', () => {
        // Both stores start with onboarding days
        insertTestDay('day-a-1', STORE_A_ID, { isOnboarding: true });
        insertTestDay('day-b-1', STORE_B_ID, { isOnboarding: true });

        // Complete onboarding for Store A
        dal.setOnboardingFlag(STORE_A_ID, 'day-a-1', false);

        // Store A no longer onboarding
        expect(dal.findOnboardingDay(STORE_A_ID)).toBeNull();

        // Store B still onboarding
        expect(dal.findOnboardingDay(STORE_B_ID)).not.toBeNull();
        expect(dal.findOnboardingDay(STORE_B_ID)?.day_id).toBe('day-b-1');
      });
    });

    // DAL-ONB-006: SQL Injection Prevention
    describe('DAL-ONB-006: SQL injection prevention', () => {
      it.each(SQL_INJECTION_PAYLOADS)('handles SQL injection in storeId safely: %s', (payload) => {
        insertTestDay('day-1', STORE_A_ID, { isOnboarding: true });

        // Attempt SQL injection via storeId parameter
        const result = dal.findOnboardingDay(payload);

        // Should return null (no matching store)
        expect(result).toBeNull();

        // Verify table still exists
        const tableCheck = db
          .prepare('SELECT COUNT(*) as count FROM sqlite_master WHERE type = ? AND name = ?')
          .get('table', 'lottery_business_days');
        expect(tableCheck.count).toBe(1);

        // Original data intact
        const originalDay = dal.findOnboardingDay(STORE_A_ID);
        expect(originalDay).not.toBeNull();
      });

      it('uses parameterized queries (no string interpolation)', () => {
        insertTestDay('day-1', STORE_A_ID, { isOnboarding: true });

        // Spy on db.prepare to capture SQL
        const originalPrepare = db.prepare.bind(db);
        const preparedStatements: string[] = [];
        db.prepare = (sql: string) => {
          preparedStatements.push(sql);
          return originalPrepare(sql);
        };

        dal.findOnboardingDay(STORE_A_ID);

        // Find the SELECT statement
        const selectQuery = preparedStatements.find(
          (sql) =>
            sql.includes('SELECT') &&
            sql.includes('lottery_business_days') &&
            sql.includes('is_onboarding')
        );
        expect(selectQuery).toBeDefined();
        expect(selectQuery).toContain('WHERE store_id = ?');
        expect(selectQuery).toContain('is_onboarding = 1');
        expect(selectQuery).toContain('LIMIT 1');
        // Should NOT contain literal store_id value
        expect(selectQuery).not.toContain(STORE_A_ID);

        db.prepare = originalPrepare;
      });

      it('uses efficient LIMIT 1 pattern', () => {
        // Spy on db.prepare
        const originalPrepare = db.prepare.bind(db);
        const preparedStatements: string[] = [];
        db.prepare = (sql: string) => {
          preparedStatements.push(sql);
          return originalPrepare(sql);
        };

        dal.findOnboardingDay(STORE_A_ID);

        // Verify LIMIT 1 is used for efficiency
        const selectQuery = preparedStatements.find((sql) => sql.includes('is_onboarding = 1'));
        expect(selectQuery).toContain('LIMIT 1');

        db.prepare = originalPrepare;
      });
    });
  });

  // ==========================================================================
  // Integration: setOnboardingFlag + findOnboardingDay Consistency
  // ==========================================================================

  describe('method consistency', () => {
    it('setOnboardingFlag(true) makes findOnboardingDay return the day', () => {
      insertTestDay('day-1', STORE_A_ID, { isOnboarding: false });

      // Initially no onboarding day
      expect(dal.findOnboardingDay(STORE_A_ID)).toBeNull();

      // Enable onboarding
      dal.setOnboardingFlag(STORE_A_ID, 'day-1', true);

      // Now findOnboardingDay should return it
      const result = dal.findOnboardingDay(STORE_A_ID);
      expect(result).not.toBeNull();
      expect(result?.day_id).toBe('day-1');
    });

    it('setOnboardingFlag(false) makes findOnboardingDay return null', () => {
      insertTestDay('day-1', STORE_A_ID, { isOnboarding: true });

      // Initially has onboarding day
      expect(dal.findOnboardingDay(STORE_A_ID)).not.toBeNull();

      // Disable onboarding
      dal.setOnboardingFlag(STORE_A_ID, 'day-1', false);

      // Now findOnboardingDay should return null
      expect(dal.findOnboardingDay(STORE_A_ID)).toBeNull();
    });

    it('only one onboarding day returned even if multiple exist (LIMIT 1)', () => {
      // Edge case: Create multiple days with is_onboarding = 1
      // (This shouldn't happen in practice, but tests robustness)
      insertTestDay('day-1', STORE_A_ID, { isOnboarding: true });
      insertTestDay('day-2', STORE_A_ID, { isOnboarding: true });

      // Should return exactly one day (LIMIT 1)
      const result = dal.findOnboardingDay(STORE_A_ID);
      expect(result).not.toBeNull();
      // We don't care which one, just that it's only one
      expect(['day-1', 'day-2']).toContain(result?.day_id);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('handles empty string storeId gracefully', () => {
      insertTestDay('day-1', STORE_A_ID, { isOnboarding: true });

      const findResult = dal.findOnboardingDay('');
      expect(findResult).toBeNull();

      const setResult = dal.setOnboardingFlag('', 'day-1', true);
      expect(setResult).toBe(false);
    });

    it('handles empty string dayId gracefully', () => {
      insertTestDay('day-1', STORE_A_ID);

      const result = dal.setOnboardingFlag(STORE_A_ID, '', true);
      expect(result).toBe(false);

      // Original day unchanged
      expect(getRawOnboardingValue('day-1')).toBe(0);
    });

    it('setting same value twice is idempotent', () => {
      insertTestDay('day-1', STORE_A_ID, { isOnboarding: true });

      // Set to true (already true)
      const result1 = dal.setOnboardingFlag(STORE_A_ID, 'day-1', true);
      expect(result1).toBe(true);
      expect(getRawOnboardingValue('day-1')).toBe(1);

      // Set to true again
      const result2 = dal.setOnboardingFlag(STORE_A_ID, 'day-1', true);
      expect(result2).toBe(true);
      expect(getRawOnboardingValue('day-1')).toBe(1);
    });

    it('works with CLOSED days (not just OPEN)', () => {
      insertTestDay('day-1', STORE_A_ID, {
        isOnboarding: true,
        status: 'CLOSED',
      });

      const result = dal.findOnboardingDay(STORE_A_ID);
      expect(result).not.toBeNull();
      expect(result?.status).toBe('CLOSED');
      expect(result?.is_onboarding).toBe(1);
    });

    it('works with PENDING_CLOSE days', () => {
      insertTestDay('day-1', STORE_A_ID, {
        isOnboarding: true,
        status: 'PENDING_CLOSE',
      });

      const result = dal.findOnboardingDay(STORE_A_ID);
      expect(result).not.toBeNull();
      expect(result?.status).toBe('PENDING_CLOSE');
    });
  });
});
