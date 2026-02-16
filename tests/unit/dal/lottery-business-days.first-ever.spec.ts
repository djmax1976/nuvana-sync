/**
 * Lottery Business Days DAL - First-Ever Detection Unit Tests
 *
 * Tests for BIZ-010 Lottery Onboarding first-ever day detection.
 * Validates:
 * - isFirstEverDay() returns correct boolean for onboarding scenarios
 * - countAllDays() returns accurate counts for logging/debugging
 * - SEC-006: All queries use parameterized statements
 * - DB-006: Tenant isolation - stores cannot see each other's data
 * - MT-011: Multi-tenant testing patterns
 *
 * @module tests/unit/dal/lottery-business-days.first-ever
 * @security SEC-006, DB-006
 * @business BIZ-010
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
// These should never cause SQL execution - only return safe values
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

describe.skipIf(skipTests)('Lottery Business Days DAL - First-Ever Detection', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let dal: LotteryBusinessDaysDAL;

  beforeEach(() => {
    // Create in-memory database
    db = new Database(':memory:');
    testDbContainer.db = db;

    // Create required tables with proper schema
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
  // isFirstEverDay() Tests - Happy Path
  // ==========================================================================

  describe('isFirstEverDay', () => {
    describe('happy path', () => {
      it('returns true when store has zero lottery_business_days', () => {
        // Store A has no days
        const result = dal.isFirstEverDay(STORE_A_ID);
        expect(result).toBe(true);
      });

      it('returns false when store has one OPEN day', () => {
        // Create an OPEN day for Store A
        db.prepare(
          `
          INSERT INTO lottery_business_days
            (day_id, store_id, business_date, status, opened_at, opened_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
        `
        ).run('day-1', STORE_A_ID, '2026-02-15', 'OPEN', USER_ID);

        const result = dal.isFirstEverDay(STORE_A_ID);
        expect(result).toBe(false);
      });

      it('returns false when store has one CLOSED day', () => {
        // Create a CLOSED day for Store A
        db.prepare(
          `
          INSERT INTO lottery_business_days
            (day_id, store_id, business_date, status, opened_at, closed_at, opened_by, closed_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now', '-1 hour'), datetime('now'), ?, ?, datetime('now'), datetime('now'))
        `
        ).run('day-1', STORE_A_ID, '2026-02-14', 'CLOSED', USER_ID, USER_ID);

        const result = dal.isFirstEverDay(STORE_A_ID);
        expect(result).toBe(false);
      });

      it('returns false when store has multiple days', () => {
        // Create multiple days for Store A
        db.prepare(
          `
          INSERT INTO lottery_business_days
            (day_id, store_id, business_date, status, opened_at, opened_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
        `
        ).run('day-1', STORE_A_ID, '2026-02-13', 'CLOSED', USER_ID);

        db.prepare(
          `
          INSERT INTO lottery_business_days
            (day_id, store_id, business_date, status, opened_at, opened_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
        `
        ).run('day-2', STORE_A_ID, '2026-02-14', 'CLOSED', USER_ID);

        db.prepare(
          `
          INSERT INTO lottery_business_days
            (day_id, store_id, business_date, status, opened_at, opened_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
        `
        ).run('day-3', STORE_A_ID, '2026-02-15', 'OPEN', USER_ID);

        const result = dal.isFirstEverDay(STORE_A_ID);
        expect(result).toBe(false);
      });
    });

    // ========================================================================
    // isFirstEverDay() - Tenant Isolation Tests (DB-006)
    // ========================================================================

    describe('tenant isolation (DB-006)', () => {
      it('returns true for storeA even when storeB has days', () => {
        // Store B has a day, but Store A has none
        db.prepare(
          `
          INSERT INTO lottery_business_days
            (day_id, store_id, business_date, status, opened_at, opened_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
        `
        ).run('day-b-1', STORE_B_ID, '2026-02-15', 'OPEN', USER_ID);

        // Store A should still be first-ever
        expect(dal.isFirstEverDay(STORE_A_ID)).toBe(true);
        // Store B is not first-ever
        expect(dal.isFirstEverDay(STORE_B_ID)).toBe(false);
      });

      it('different stores have independent first-ever detection', () => {
        // All stores start as first-ever
        expect(dal.isFirstEverDay(STORE_A_ID)).toBe(true);
        expect(dal.isFirstEverDay(STORE_B_ID)).toBe(true);
        expect(dal.isFirstEverDay(STORE_C_ID)).toBe(true);

        // Add day to Store A only
        db.prepare(
          `
          INSERT INTO lottery_business_days
            (day_id, store_id, business_date, status, opened_at, opened_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
        `
        ).run('day-a-1', STORE_A_ID, '2026-02-15', 'OPEN', USER_ID);

        // Only Store A should change
        expect(dal.isFirstEverDay(STORE_A_ID)).toBe(false);
        expect(dal.isFirstEverDay(STORE_B_ID)).toBe(true);
        expect(dal.isFirstEverDay(STORE_C_ID)).toBe(true);

        // Add day to Store B
        db.prepare(
          `
          INSERT INTO lottery_business_days
            (day_id, store_id, business_date, status, opened_at, opened_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
        `
        ).run('day-b-1', STORE_B_ID, '2026-02-15', 'OPEN', USER_ID);

        // Now Store B should change, Store C still first-ever
        expect(dal.isFirstEverDay(STORE_A_ID)).toBe(false);
        expect(dal.isFirstEverDay(STORE_B_ID)).toBe(false);
        expect(dal.isFirstEverDay(STORE_C_ID)).toBe(true);
      });

      it('cross-tenant ID access returns correct isolation', () => {
        // Create days with similar patterns across stores
        db.prepare(
          `
          INSERT INTO lottery_business_days
            (day_id, store_id, business_date, status, opened_at, opened_by, created_at, updated_at)
          VALUES
            (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now')),
            (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
        `
        ).run(
          'day-a-1',
          STORE_A_ID,
          '2026-02-15',
          'OPEN',
          USER_ID,
          'day-b-1',
          STORE_B_ID,
          '2026-02-15',
          'OPEN',
          USER_ID
        );

        // Each store query only sees its own data
        expect(dal.isFirstEverDay(STORE_A_ID)).toBe(false);
        expect(dal.isFirstEverDay(STORE_B_ID)).toBe(false);
        expect(dal.isFirstEverDay(STORE_C_ID)).toBe(true);

        // Store C should have zero days (confirmed)
        expect(dal.countAllDays(STORE_C_ID)).toBe(0);
      });
    });

    // ========================================================================
    // isFirstEverDay() - Edge Cases
    // ========================================================================

    describe('edge cases', () => {
      it('handles non-existent store_id gracefully (returns true)', () => {
        // A store that doesn't exist in stores table but is queried
        // Should return true (no days exist for it)
        const result = dal.isFirstEverDay('non-existent-store-uuid');
        expect(result).toBe(true);
      });

      it('works correctly after day is created and closed', () => {
        // Initially first-ever
        expect(dal.isFirstEverDay(STORE_A_ID)).toBe(true);

        // Create and close a day
        db.prepare(
          `
          INSERT INTO lottery_business_days
            (day_id, store_id, business_date, status, opened_at, closed_at, opened_by, closed_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now', '-1 hour'), datetime('now'), ?, ?, datetime('now'), datetime('now'))
        `
        ).run('day-1', STORE_A_ID, '2026-02-15', 'CLOSED', USER_ID, USER_ID);

        // No longer first-ever
        expect(dal.isFirstEverDay(STORE_A_ID)).toBe(false);
      });

      it('works correctly after multiple open/close cycles', () => {
        expect(dal.isFirstEverDay(STORE_A_ID)).toBe(true);

        // Simulate multiple business day cycles
        for (let i = 1; i <= 5; i++) {
          db.prepare(
            `
            INSERT INTO lottery_business_days
              (day_id, store_id, business_date, status, opened_at, closed_at, opened_by, closed_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?, datetime('now'), datetime('now'))
          `
          ).run(`day-${i}`, STORE_A_ID, `2026-02-${10 + i}`, 'CLOSED', USER_ID, USER_ID);
        }

        // Still not first-ever after 5 cycles
        expect(dal.isFirstEverDay(STORE_A_ID)).toBe(false);
        expect(dal.countAllDays(STORE_A_ID)).toBe(5);
      });

      it('includes PENDING_CLOSE days in the count', () => {
        db.prepare(
          `
          INSERT INTO lottery_business_days
            (day_id, store_id, business_date, status, opened_at, opened_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
        `
        ).run('day-1', STORE_A_ID, '2026-02-15', 'PENDING_CLOSE', USER_ID);

        // PENDING_CLOSE is still a day - not first-ever
        expect(dal.isFirstEverDay(STORE_A_ID)).toBe(false);
      });
    });
  });

  // ==========================================================================
  // countAllDays() Tests
  // ==========================================================================

  describe('countAllDays', () => {
    describe('accuracy tests', () => {
      it('returns 0 for new store', () => {
        const count = dal.countAllDays(STORE_A_ID);
        expect(count).toBe(0);
      });

      it('returns exact count for stores with multiple days', () => {
        // Insert 3 days
        for (let i = 1; i <= 3; i++) {
          db.prepare(
            `
            INSERT INTO lottery_business_days
              (day_id, store_id, business_date, status, opened_at, opened_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
          `
          ).run(`day-${i}`, STORE_A_ID, `2026-02-${10 + i}`, 'CLOSED', USER_ID);
        }

        expect(dal.countAllDays(STORE_A_ID)).toBe(3);
      });

      it('counts both OPEN and CLOSED days', () => {
        // Insert 2 CLOSED and 1 OPEN
        db.prepare(
          `
          INSERT INTO lottery_business_days
            (day_id, store_id, business_date, status, opened_at, opened_by, created_at, updated_at)
          VALUES
            (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now')),
            (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now')),
            (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
        `
        ).run(
          'day-1',
          STORE_A_ID,
          '2026-02-13',
          'CLOSED',
          USER_ID,
          'day-2',
          STORE_A_ID,
          '2026-02-14',
          'CLOSED',
          USER_ID,
          'day-3',
          STORE_A_ID,
          '2026-02-15',
          'OPEN',
          USER_ID
        );

        expect(dal.countAllDays(STORE_A_ID)).toBe(3);
      });

      it('counts days across multiple business_dates', () => {
        // Insert days for different dates
        const dates = ['2026-02-10', '2026-02-11', '2026-02-12', '2026-02-13', '2026-02-14'];
        dates.forEach((date, i) => {
          db.prepare(
            `
            INSERT INTO lottery_business_days
              (day_id, store_id, business_date, status, opened_at, opened_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
          `
          ).run(`day-${i + 1}`, STORE_A_ID, date, 'CLOSED', USER_ID);
        });

        expect(dal.countAllDays(STORE_A_ID)).toBe(5);
      });

      it('counts PENDING_CLOSE days', () => {
        db.prepare(
          `
          INSERT INTO lottery_business_days
            (day_id, store_id, business_date, status, opened_at, opened_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
        `
        ).run('day-1', STORE_A_ID, '2026-02-15', 'PENDING_CLOSE', USER_ID);

        expect(dal.countAllDays(STORE_A_ID)).toBe(1);
      });

      it('counts all status types together', () => {
        db.prepare(
          `
          INSERT INTO lottery_business_days
            (day_id, store_id, business_date, status, opened_at, opened_by, created_at, updated_at)
          VALUES
            (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now')),
            (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now')),
            (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
        `
        ).run(
          'day-1',
          STORE_A_ID,
          '2026-02-13',
          'CLOSED',
          USER_ID,
          'day-2',
          STORE_A_ID,
          '2026-02-14',
          'PENDING_CLOSE',
          USER_ID,
          'day-3',
          STORE_A_ID,
          '2026-02-15',
          'OPEN',
          USER_ID
        );

        expect(dal.countAllDays(STORE_A_ID)).toBe(3);
      });
    });

    describe('tenant isolation (DB-006)', () => {
      it('only counts days for the specified store', () => {
        // Add days to different stores
        db.prepare(
          `
          INSERT INTO lottery_business_days
            (day_id, store_id, business_date, status, opened_at, opened_by, created_at, updated_at)
          VALUES
            (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now')),
            (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now')),
            (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now')),
            (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
        `
        ).run(
          'day-a-1',
          STORE_A_ID,
          '2026-02-13',
          'CLOSED',
          USER_ID,
          'day-a-2',
          STORE_A_ID,
          '2026-02-14',
          'CLOSED',
          USER_ID,
          'day-b-1',
          STORE_B_ID,
          '2026-02-15',
          'OPEN',
          USER_ID,
          'day-c-1',
          STORE_C_ID,
          '2026-02-15',
          'OPEN',
          USER_ID
        );

        // Each store should only see its own count
        expect(dal.countAllDays(STORE_A_ID)).toBe(2);
        expect(dal.countAllDays(STORE_B_ID)).toBe(1);
        expect(dal.countAllDays(STORE_C_ID)).toBe(1);
      });
    });

    // ========================================================================
    // countAllDays() - Security Tests (SEC-006)
    // ========================================================================

    describe('SQL injection prevention (SEC-006)', () => {
      it.each(SQL_INJECTION_PAYLOADS)('handles SQL injection payload safely: %s', (payload) => {
        // The payload should be treated as a literal string store_id
        // Since no store exists with this ID, count should be 0
        const result = dal.countAllDays(payload);
        expect(result).toBe(0);

        // Verify the table still exists and has expected data
        const tableCheck = db
          .prepare('SELECT COUNT(*) as count FROM sqlite_master WHERE type = ? AND name = ?')
          .get('table', 'lottery_business_days');
        expect(tableCheck.count).toBe(1);
      });

      it('does not interpolate store_id into query string', () => {
        // Create a spy on db.prepare to capture the SQL
        const originalPrepare = db.prepare.bind(db);
        const preparedStatements: string[] = [];
        db.prepare = (sql: string) => {
          preparedStatements.push(sql);
          return originalPrepare(sql);
        };

        // Call the method
        dal.countAllDays(STORE_A_ID);

        // Verify the SQL uses parameterized query
        const countQuery = preparedStatements.find(
          (sql) => sql.includes('COUNT(*)') && sql.includes('lottery_business_days')
        );
        expect(countQuery).toBeDefined();
        expect(countQuery).toContain('WHERE store_id = ?');
        expect(countQuery).not.toContain(STORE_A_ID);

        // Restore
        db.prepare = originalPrepare;
      });
    });
  });

  // ==========================================================================
  // hasAnyDay() Tests (underlying implementation)
  // ==========================================================================

  describe('hasAnyDay', () => {
    it('returns false for store with no days', () => {
      expect(dal.hasAnyDay(STORE_A_ID)).toBe(false);
    });

    it('returns true for store with at least one day', () => {
      db.prepare(
        `
        INSERT INTO lottery_business_days
          (day_id, store_id, business_date, status, opened_at, opened_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
      `
      ).run('day-1', STORE_A_ID, '2026-02-15', 'OPEN', USER_ID);

      expect(dal.hasAnyDay(STORE_A_ID)).toBe(true);
    });

    it('uses efficient EXISTS pattern (LIMIT 1)', () => {
      // Verify performance characteristics by checking query structure
      const originalPrepare = db.prepare.bind(db);
      const preparedStatements: string[] = [];
      db.prepare = (sql: string) => {
        preparedStatements.push(sql);
        return originalPrepare(sql);
      };

      dal.hasAnyDay(STORE_A_ID);

      // Check that LIMIT 1 is used (efficient EXISTS pattern)
      const existsQuery = preparedStatements.find(
        (sql) => sql.includes('lottery_business_days') && sql.includes('SELECT 1')
      );
      expect(existsQuery).toBeDefined();
      expect(existsQuery).toContain('LIMIT 1');

      db.prepare = originalPrepare;
    });

    describe('SQL injection prevention (SEC-006)', () => {
      it.each(SQL_INJECTION_PAYLOADS)('handles SQL injection payload safely: %s', (payload) => {
        // Should return false (no days exist) not cause SQL injection
        const result = dal.hasAnyDay(payload);
        expect(result).toBe(false);
      });
    });
  });

  // ==========================================================================
  // Integration: isFirstEverDay + countAllDays Consistency
  // ==========================================================================

  describe('method consistency', () => {
    it('isFirstEverDay(store) === (countAllDays(store) === 0)', () => {
      // Empty store
      expect(dal.isFirstEverDay(STORE_A_ID)).toBe(dal.countAllDays(STORE_A_ID) === 0);

      // Add a day
      db.prepare(
        `
        INSERT INTO lottery_business_days
          (day_id, store_id, business_date, status, opened_at, opened_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
      `
      ).run('day-1', STORE_A_ID, '2026-02-15', 'OPEN', USER_ID);

      // After adding day
      expect(dal.isFirstEverDay(STORE_A_ID)).toBe(dal.countAllDays(STORE_A_ID) === 0);
    });

    it('isFirstEverDay uses hasAnyDay internally (not countAllDays)', () => {
      // This test verifies the efficient implementation
      // isFirstEverDay should NOT call countAllDays (which is O(n)) but hasAnyDay (which is O(1))

      // Spy on both methods
      const hasAnyDaySpy = vi.spyOn(dal, 'hasAnyDay');
      const countAllDaysSpy = vi.spyOn(dal, 'countAllDays');

      dal.isFirstEverDay(STORE_A_ID);

      // hasAnyDay should be called (efficient)
      expect(hasAnyDaySpy).toHaveBeenCalledWith(STORE_A_ID);
      // countAllDays should NOT be called (inefficient for boolean check)
      expect(countAllDaysSpy).not.toHaveBeenCalled();

      hasAnyDaySpy.mockRestore();
      countAllDaysSpy.mockRestore();
    });
  });
});
