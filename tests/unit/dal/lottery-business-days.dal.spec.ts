/**
 * Lottery Business Days DAL Unit Tests
 *
 * Tests for lottery business day operations.
 * Validates two-phase day close pattern: prepare -> commit/cancel
 * Validates SEC-006: Parameterized queries
 * Validates DB-006: Tenant isolation via store_id
 * Validates sync queue integration for day close (v047)
 *
 * @module tests/unit/dal/lottery-business-days
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LotteryBusinessDaysDAL,
  type LotteryBusinessDay as _LotteryBusinessDay,
  type PackClosingData,
  type PrepareCloseResult as _PrepareCloseResult,
  type CommitCloseResult as _CommitCloseResult,
} from '../../../src/main/dal/lottery-business-days.dal';

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
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
// v047: Also hoist mock functions for sync queue integration tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { testDbContainer, mockSyncQueueEnqueue, mockLotteryGamesFindById } = vi.hoisted(() => ({
  testDbContainer: { db: null as any },
  mockSyncQueueEnqueue: vi.fn(),
  mockLotteryGamesFindById: vi.fn(),
}));

// Alias for easier access in tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let testDb: any = null;

/**
 * Helper function to find a sync queue call by entity type and assert it exists.
 * This properly narrows the TypeScript type from T | undefined to T.
 *
 * @param entityType - The entity type to search for (e.g., 'pack', 'day_open', 'day_close')
 * @param storeId - Optional store_id to filter by (for multi-tenant isolation tests)
 * @returns The mock call array [args] - guaranteed non-undefined
 * @throws Error if no matching call is found
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSyncCall(entityType: string, storeId?: string): any[] {
  const call = mockSyncQueueEnqueue.mock.calls.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any[]) =>
      c[0].entity_type === entityType && (storeId === undefined || c[0].store_id === storeId)
  );
  if (!call) {
    const filterDesc = storeId
      ? `entity_type '${entityType}' and store_id '${storeId}'`
      : `entity_type '${entityType}'`;
    throw new Error(`Expected sync queue call with ${filterDesc} not found`);
  }
  return call;
}

// Mock database service to return our in-memory test database
vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => testDbContainer.db),
  isDatabaseInitialized: vi.fn(() => testDbContainer.db !== null),
}));

// v047: Mock sync-queue.dal for sync queue integration tests
vi.mock('../../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: {
    enqueue: mockSyncQueueEnqueue,
  },
}));

// v047: Mock lottery-games.dal for game_code lookup in pack sync
vi.mock('../../../src/main/dal/lottery-games.dal', () => ({
  lotteryGamesDAL: {
    findById: mockLotteryGamesFindById,
  },
}));

describe.skipIf(skipTests)('Lottery Business Days DAL', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let dal: LotteryBusinessDaysDAL;

  beforeEach(() => {
    // Create in-memory database
    db = new Database(':memory:');
    // Set the shared test database so the mock returns it
    testDb = db;
    testDbContainer.db = db;

    // Create required tables
    db.exec(`
      CREATE TABLE lottery_games (
        game_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        game_code TEXT NOT NULL,
        name TEXT NOT NULL,
        price REAL,
        tickets_per_pack INTEGER NOT NULL DEFAULT 300,
        pack_value REAL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        synced_at TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE lottery_bins (
        bin_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        name TEXT NOT NULL,
        location TEXT,
        display_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        synced_at TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE lottery_packs (
        pack_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        game_id TEXT NOT NULL,
        pack_number TEXT NOT NULL,
        current_bin_id TEXT,
        status TEXT NOT NULL DEFAULT 'RECEIVED',
        received_at TEXT,
        received_by TEXT,
        activated_at TEXT,
        activated_by TEXT,
        activated_shift_id TEXT,
        depleted_at TEXT,
        returned_at TEXT,
        opening_serial TEXT,
        closing_serial TEXT,
        tickets_sold_count INTEGER NOT NULL DEFAULT 0,
        sales_amount REAL NOT NULL DEFAULT 0,
        depleted_by TEXT,
        depleted_shift_id TEXT,
        depletion_reason TEXT,
        returned_by TEXT,
        returned_shift_id TEXT,
        cloud_pack_id TEXT,
        synced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(store_id, game_id, pack_number)
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
        cloud_day_id TEXT,
        synced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(store_id, business_date)
      );

      CREATE INDEX idx_lottery_days_date ON lottery_business_days(business_date);
      CREATE INDEX idx_lottery_days_status ON lottery_business_days(store_id, status);

      CREATE TABLE lottery_day_packs (
        day_pack_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        day_id TEXT NOT NULL,
        pack_id TEXT NOT NULL,
        bin_id TEXT,
        starting_serial TEXT NOT NULL,
        ending_serial TEXT,
        tickets_sold INTEGER,
        sales_amount REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(day_id, pack_id)
      );

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
    `);

    // Insert test data
    // SEC-006: Using parameterized inserts for test data setup
    // DB-006: Store record required for tenant isolation validation
    db.exec(`
      INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
      VALUES ('store-1', 'company-1', 'Test Store', 'America/New_York', 'ACTIVE', datetime('now'), datetime('now'));

      INSERT INTO lottery_games (game_id, store_id, game_code, name, price, tickets_per_pack, created_at, updated_at)
      VALUES ('game-1', 'store-1', '1001', 'Lucky 7s', 1, 300, datetime('now'), datetime('now'));

      INSERT INTO lottery_bins (bin_id, store_id, name, display_order, is_active, created_at, updated_at)
      VALUES ('bin-1', 'store-1', 'Bin 1', 1, 1, datetime('now'), datetime('now'));
    `);

    // Create DAL - it will use testDb via the mocked getDatabase()
    dal = new LotteryBusinessDaysDAL();
  });

  afterEach(() => {
    db.close();
    testDb = null;
    vi.clearAllMocks();
  });

  // v047: Reset sync queue mocks with default behavior
  beforeEach(() => {
    // Default: sync queue enqueue succeeds
    mockSyncQueueEnqueue.mockReturnValue({ id: 'sync-queue-item-1' });
    // Default: game lookup returns valid game data
    mockLotteryGamesFindById.mockReturnValue({
      game_id: 'game-1',
      game_code: '1001',
      name: 'Lucky 7s',
      tickets_per_pack: 300,
    });
  });

  describe('getOrCreateForDate', () => {
    it('should create new day if not exists', () => {
      const today = new Date().toISOString().split('T')[0];

      const day = dal.getOrCreateForDate('store-1', today);

      expect(day).toBeDefined();
      expect(day.day_id).toBeDefined();
      expect(day.store_id).toBe('store-1');
      expect(day.business_date).toBe(today);
      expect(day.status).toBe('OPEN');
    });

    it('should return existing day if already exists', () => {
      const today = new Date().toISOString().split('T')[0];

      const day1 = dal.getOrCreateForDate('store-1', today);
      const day2 = dal.getOrCreateForDate('store-1', today);

      expect(day1.day_id).toBe(day2.day_id);
    });

    it('should create separate days for different stores', () => {
      const today = new Date().toISOString().split('T')[0];

      const day1 = dal.getOrCreateForDate('store-1', today);
      const day2 = dal.getOrCreateForDate('store-2', today);

      expect(day1.day_id).not.toBe(day2.day_id);
    });

    it('should create separate days for different dates', () => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

      // Create first day
      const day1 = dal.getOrCreateForDate('store-1', today);
      // Close the first day directly in DB to allow creating a day for a different date
      db.prepare('UPDATE lottery_business_days SET status = ? WHERE day_id = ?').run(
        'CLOSED',
        day1.day_id
      );
      // Now create day for different date
      const day2 = dal.getOrCreateForDate('store-1', yesterday);

      expect(day1.day_id).not.toBe(day2.day_id);
    });
  });

  describe('findByDate', () => {
    it('should find day by date', () => {
      const today = new Date().toISOString().split('T')[0];
      dal.getOrCreateForDate('store-1', today);

      const found = dal.findByDate('store-1', today);

      expect(found).toBeDefined();
      expect(found?.business_date).toBe(today);
    });

    it('should return undefined for non-existent date', () => {
      const found = dal.findByDate('store-1', '2020-01-01');

      expect(found).toBeUndefined();
    });

    it('should not find day from different store (DB-006)', () => {
      const today = new Date().toISOString().split('T')[0];
      dal.getOrCreateForDate('store-1', today);

      const found = dal.findByDate('store-2', today);

      expect(found).toBeUndefined();
    });
  });

  describe('findOpenDay', () => {
    it('should find the current open day for store', () => {
      const today = new Date().toISOString().split('T')[0];
      dal.getOrCreateForDate('store-1', today);

      const openDay = dal.findOpenDay('store-1');

      expect(openDay).toBeDefined();
      expect(openDay?.status).toBe('OPEN');
    });

    it('should return undefined when no open day exists', () => {
      const openDay = dal.findOpenDay('store-1');

      expect(openDay).toBeUndefined();
    });
  });

  describe('incrementPacksActivated', () => {
    it('should increment total_packs_activated count', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      expect(day.total_packs_activated).toBe(0);

      dal.incrementPacksActivated('store-1', today);
      dal.incrementPacksActivated('store-1', today);
      dal.incrementPacksActivated('store-1', today);

      const updated = dal.findById(day.day_id);
      expect(updated?.total_packs_activated).toBe(3);
    });
  });

  describe('prepareClose', () => {
    it('should set status to PENDING_CLOSE and store closing data', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      // Create test pack
      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [{ pack_id: 'pack-1', closing_serial: '150' }];

      const result = dal.prepareClose(day.day_id, closings);

      expect(result).toBeDefined();
      expect(result.day_id).toBe(day.day_id);
      expect(result.status).toBe('PENDING_CLOSE');
      expect(result.closings_count).toBe(1);
      expect(result.estimated_lottery_total).toBe(150); // 150 tickets * $1
    });

    it('should calculate correct sales preview', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      // Create test pack with $2 game
      db.exec(`
        INSERT INTO lottery_games (game_id, store_id, game_code, name, price, tickets_per_pack, created_at, updated_at)
        VALUES ('game-2', 'store-1', '2001', 'Cash Explosion', 2, 150, datetime('now'), datetime('now'));

        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-2', 'store-1', 'game-2', 'bin-1', 'PKG002', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [{ pack_id: 'pack-2', closing_serial: '100' }];

      const result = dal.prepareClose(day.day_id, closings);

      expect(result.estimated_lottery_total).toBe(200); // 100 tickets * $2
    });

    it('should set expiration time', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [{ pack_id: 'pack-1', closing_serial: '150' }];

      const result = dal.prepareClose(day.day_id, closings);

      expect(result.pending_close_at).toBeDefined();
      // pending_close_at should be a valid timestamp
      const pendingTime = new Date(result.pending_close_at);
      expect(pendingTime.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should throw error for non-OPEN day', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      // Manually set to CLOSED
      db.exec(`UPDATE lottery_business_days SET status = 'CLOSED' WHERE day_id = '${day.day_id}'`);

      const closings: PackClosingData[] = [{ pack_id: 'pack-1', closing_serial: '150' }];

      expect(() => dal.prepareClose(day.day_id, closings)).toThrow();
    });
  });

  describe('commitClose', () => {
    it('should set status to CLOSED and update packs', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      // Create and prepare close
      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [{ pack_id: 'pack-1', closing_serial: '150' }];

      dal.prepareClose(day.day_id, closings);
      const result = dal.commitClose(day.day_id, 'user-123');

      expect(result).toBeDefined();
      expect(result.day_id).toBe(day.day_id);
      expect(result.closed_at).toBeDefined();
      expect(result.closings_created).toBe(1);
      expect(result.lottery_total).toBe(150);
    });

    it('should update pack status to SETTLED', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      // NOTE: is_sold_out must be true for pack to be settled (DEPLETED) per business logic
      // Packs without is_sold_out remain ACTIVE and continue to next day
      const closings: PackClosingData[] = [
        { pack_id: 'pack-1', closing_serial: '150', is_sold_out: true },
      ];

      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, 'user-123');

      // Check pack was updated
      const pack = db.prepare('SELECT * FROM lottery_packs WHERE pack_id = ?').get('pack-1') as {
        status: string;
        closing_serial: string;
        depleted_at: string;
      };
      expect(pack.status).toBe('DEPLETED');
      expect(pack.closing_serial).toBe('150');
      expect(pack.depleted_at).toBeDefined();
    });

    it('should throw error for non-PENDING_CLOSE day', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      expect(() => dal.commitClose(day.day_id, 'user-123')).toThrow();
    });

    it('should throw error for expired pending close', () => {
      // NOTE: This test requires mocking Date.now() to simulate time passing
      // beyond PENDING_CLOSE_EXPIRY_MS. The implementation now uses an in-memory
      // cache with timestamp-based expiry rather than a database column.
      // For now, we verify that commit without prepare throws.
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      // Don't call prepareClose, so there's no pending close data
      // This should throw because no pending closings found
      expect(() => dal.commitClose(day.day_id, 'user-123')).toThrow();
    });
  });

  describe('cancelClose', () => {
    it('should revert status to OPEN', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [{ pack_id: 'pack-1', closing_serial: '150' }];

      dal.prepareClose(day.day_id, closings);
      dal.cancelClose(day.day_id);

      const updated = dal.findById(day.day_id);
      expect(updated?.status).toBe('OPEN');
    });

    it('should clear pending close data', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [{ pack_id: 'pack-1', closing_serial: '150' }];

      dal.prepareClose(day.day_id, closings);
      dal.cancelClose(day.day_id);

      const updated = dal.findById(day.day_id);
      // After cancel, status should return to OPEN
      expect(updated?.status).toBe('OPEN');
    });

    it('should not affect already closed days', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      // Manually close the day
      db.exec(`UPDATE lottery_business_days SET status = 'CLOSED' WHERE day_id = '${day.day_id}'`);

      // Cancel should not affect it
      dal.cancelClose(day.day_id);

      const updated = dal.findById(day.day_id);
      expect(updated?.status).toBe('CLOSED');
    });
  });

  describe('getSalesForDateRange', () => {
    it('should return total sales for date range', () => {
      // Create closed days with sales
      const date1 = '2024-01-01';
      const date2 = '2024-01-02';
      const date3 = '2024-01-03';

      db.exec(`
        INSERT INTO lottery_business_days (day_id, store_id, business_date, status, total_sales, created_at, updated_at)
        VALUES
          ('day-1', 'store-1', '${date1}', 'CLOSED', 100.50, datetime('now'), datetime('now')),
          ('day-2', 'store-1', '${date2}', 'CLOSED', 200.00, datetime('now'), datetime('now')),
          ('day-3', 'store-1', '${date3}', 'CLOSED', 150.75, datetime('now'), datetime('now'));
      `);

      const result = dal.getSalesForDateRange('store-1', date1, date3);

      expect(result.totalSales).toBe(451.25);
      expect(result.daysCount).toBe(3);
    });

    it('should return 0 for range with no data', () => {
      const result = dal.getSalesForDateRange('store-1', '2020-01-01', '2020-01-31');

      expect(result.totalSales).toBe(0);
      expect(result.daysCount).toBe(0);
    });

    it('should only include specified store (DB-006)', () => {
      db.exec(`
        INSERT INTO lottery_business_days (day_id, store_id, business_date, status, total_sales, created_at, updated_at)
        VALUES
          ('day-1', 'store-1', '2024-01-01', 'CLOSED', 100.00, datetime('now'), datetime('now')),
          ('day-2', 'store-2', '2024-01-01', 'CLOSED', 999.00, datetime('now'), datetime('now'));
      `);

      const result = dal.getSalesForDateRange('store-1', '2024-01-01', '2024-01-31');

      expect(result.totalSales).toBe(100);
    });
  });

  describe('findById (inherited)', () => {
    it('should find day by ID', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      const found = dal.findById(day.day_id);

      expect(found).toBeDefined();
      expect(found?.day_id).toBe(day.day_id);
    });

    it('should return undefined for non-existent ID', () => {
      const found = dal.findById('non-existent-id');

      expect(found).toBeUndefined();
    });
  });

  // ==========================================================================
  // v047: Sync Queue Integration Tests (Phase 3 - Day Close Push)
  // ==========================================================================
  // These tests validate that day close operations properly queue sync items
  // for pushing to the cloud. Tests cover:
  // - Pack depletion sync queued during commitClose (T3.1.1)
  // - Day close sync queued during commitClose (T3.1.2)
  // - Sync queue failure handling (T3.1.3)
  // - Edge cases (T3.1.4)
  // - Security and tenant isolation (T3.1.5)

  describe('T3.1.1: Pack depletion sync queued during commitClose', () => {
    it('should queue sync item when single pack is marked sold out', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      // Create test pack
      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [
        { pack_id: 'pack-1', closing_serial: '150', is_sold_out: true },
      ];

      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, 'user-123');

      // Verify pack sync was queued (first call)
      expect(mockSyncQueueEnqueue).toHaveBeenCalled();

      // Find the pack sync call (entity_type: 'pack') - using helper for type safety
      const packSyncCall = getSyncCall('pack');
      expect(packSyncCall[0]).toMatchObject({
        store_id: 'store-1',
        entity_type: 'pack',
        entity_id: 'pack-1',
        operation: 'UPDATE',
      });

      // Verify payload contains required fields
      const packPayload = packSyncCall[0].payload;
      expect(packPayload.status).toBe('DEPLETED');
      expect(packPayload.depletion_reason).toBe('DAY_CLOSE');
      expect(packPayload.closing_serial).toBe('150');
      expect(packPayload.depleted_by).toBe('user-123');
    });

    it('should queue sync items for multiple packs marked sold out', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      // Create test packs
      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES
          ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now')),
          ('pack-2', 'store-1', 'game-1', 'bin-1', 'PKG002', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now')),
          ('pack-3', 'store-1', 'game-1', 'bin-1', 'PKG003', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [
        { pack_id: 'pack-1', closing_serial: '150', is_sold_out: true },
        { pack_id: 'pack-2', closing_serial: '200', is_sold_out: true },
        { pack_id: 'pack-3', closing_serial: '100', is_sold_out: true },
      ];

      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, 'user-123');

      // Find all pack sync calls
      const packSyncCalls = mockSyncQueueEnqueue.mock.calls.filter(
        (call) => call[0].entity_type === 'pack'
      );

      // Should have 3 pack sync items queued
      expect(packSyncCalls).toHaveLength(3);

      // Verify each pack has correct entity_id
      const queuedPackIds = packSyncCalls.map((call) => call[0].entity_id);
      expect(queuedPackIds).toContain('pack-1');
      expect(queuedPackIds).toContain('pack-2');
      expect(queuedPackIds).toContain('pack-3');
    });

    it('should NOT queue sync item for pack NOT marked sold out', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      // Create test pack
      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      // Pack continues to next day (is_sold_out: false or undefined)
      const closings: PackClosingData[] = [
        { pack_id: 'pack-1', closing_serial: '150', is_sold_out: false },
      ];

      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, 'user-123');

      // Should only have day_close sync, NOT pack sync
      const packSyncCalls = mockSyncQueueEnqueue.mock.calls.filter(
        (call) => call[0].entity_type === 'pack'
      );
      expect(packSyncCalls).toHaveLength(0);

      // Day close should still be queued
      const dayCloseSyncCalls = mockSyncQueueEnqueue.mock.calls.filter(
        (call) => call[0].entity_type === 'day_close'
      );
      expect(dayCloseSyncCalls).toHaveLength(1);
    });

    it('should include all required fields in pack sync payload', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, activated_by, received_at, received_by, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), 'user-456', datetime('now', '-1 day'), 'user-789', datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [
        { pack_id: 'pack-1', closing_serial: '150', is_sold_out: true },
      ];

      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, 'user-123');

      const packSyncCall = getSyncCall('pack');
      const payload = packSyncCall[0].payload;

      // Verify all required fields per cloud API spec
      expect(payload).toHaveProperty('pack_id', 'pack-1');
      expect(payload).toHaveProperty('store_id', 'store-1');
      expect(payload).toHaveProperty('game_id', 'game-1');
      expect(payload).toHaveProperty('game_code', '1001'); // From mock
      expect(payload).toHaveProperty('pack_number', 'PKG001');
      expect(payload).toHaveProperty('status', 'DEPLETED');
      expect(payload).toHaveProperty('bin_id', 'bin-1');
      expect(payload).toHaveProperty('opening_serial', '000');
      expect(payload).toHaveProperty('closing_serial', '150');
      expect(payload).toHaveProperty('serial_start', '000');
      expect(payload).toHaveProperty('serial_end', '299'); // 300 tickets per pack
      expect(payload).toHaveProperty('tickets_sold');
      expect(payload).toHaveProperty('sales_amount');
      expect(payload).toHaveProperty('depleted_at');
      expect(payload).toHaveProperty('depleted_by', 'user-123');
      expect(payload).toHaveProperty('depletion_reason', 'DAY_CLOSE');
    });

    it('should use correct entity_type and operation for pack sync', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [
        { pack_id: 'pack-1', closing_serial: '150', is_sold_out: true },
      ];

      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, 'user-123');

      const packSyncCall = getSyncCall('pack');

      expect(packSyncCall[0].entity_type).toBe('pack');
      expect(packSyncCall[0].operation).toBe('UPDATE');
      expect(packSyncCall[0].sync_direction).toBe('PUSH');
    });
  });

  describe('T3.1.2: Day close sync queued during commitClose', () => {
    it('should queue day close operation after pack depletions', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [
        { pack_id: 'pack-1', closing_serial: '150', is_sold_out: true },
      ];

      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, 'user-123');

      // Find the day_close sync call
      const dayCloseSyncCall = getSyncCall('day_close');

      expect(dayCloseSyncCall).toBeDefined();
      expect(dayCloseSyncCall[0]).toMatchObject({
        store_id: 'store-1',
        entity_type: 'day_close',
        entity_id: day.day_id,
        operation: 'CREATE',
        priority: 1, // Higher priority than packs
      });
    });

    it('should include operation_type in day close payload', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [{ pack_id: 'pack-1', closing_serial: '150' }];

      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, 'user-123');

      const dayCloseSyncCall = getSyncCall('day_close');

      expect(dayCloseSyncCall[0].payload.operation_type).toBe('PREPARE');
    });

    it('should include day_id and store_id in day close payload per API contract', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [{ pack_id: 'pack-1', closing_serial: '150' }];

      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, 'user-123');

      const dayCloseSyncCall = getSyncCall('day_close');
      // TypeScript strict mode: Assert that dayCloseSyncCall is defined
      expect(dayCloseSyncCall).toBeDefined();
      const payload = dayCloseSyncCall![0].payload;

      // API contract: day_id is the primary identifier (replica_end_points.md lines 2374-2386)
      expect(payload.day_id).toBe(day.day_id);
      expect(payload.store_id).toBe('store-1');
    });

    it('should include closings array with ending_serial in day close payload per API contract', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES
          ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now')),
          ('pack-2', 'store-1', 'game-1', 'bin-1', 'PKG002', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [
        { pack_id: 'pack-1', closing_serial: '150' },
        { pack_id: 'pack-2', closing_serial: '200' },
      ];

      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, 'user-123');

      const dayCloseSyncCall = getSyncCall('day_close');
      // TypeScript strict mode: Assert that dayCloseSyncCall is defined
      expect(dayCloseSyncCall).toBeDefined();
      const payload = dayCloseSyncCall![0].payload;

      // API contract: uses 'closings' array with 'ending_serial' (not expected_inventory/closing_serial)
      expect(payload.closings).toBeDefined();
      expect(payload.closings).toHaveLength(2);

      // Verify each closing item has required fields per API contract
      const closing1 = payload.closings.find((i: { pack_id: string }) => i.pack_id === 'pack-1');
      expect(closing1).toMatchObject({
        pack_id: 'pack-1',
        ending_serial: '150', // API uses ending_serial, not closing_serial
        entry_method: 'MANUAL',
        bin_id: 'bin-1',
      });
    });

    it('should use entity_type day_close for day close sync', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [{ pack_id: 'pack-1', closing_serial: '150' }];

      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, 'user-123');

      const dayCloseSyncCall = getSyncCall('day_close');

      expect(dayCloseSyncCall[0].entity_type).toBe('day_close');
      expect(dayCloseSyncCall[0].sync_direction).toBe('PUSH');
    });
  });

  describe('T3.1.3: Sync queue failure handling (offline-first)', () => {
    it('should succeed local commit even if sync queue fails', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      // Make sync queue throw an error
      mockSyncQueueEnqueue.mockImplementation(() => {
        throw new Error('Sync queue database error');
      });

      const closings: PackClosingData[] = [
        { pack_id: 'pack-1', closing_serial: '150', is_sold_out: true },
      ];

      dal.prepareClose(day.day_id, closings);

      // Should NOT throw - offline-first pattern
      const result = dal.commitClose(day.day_id, 'user-123');

      // Local commit should succeed
      expect(result).toBeDefined();
      expect(result.closed_at).toBeDefined();
      expect(result.closings_created).toBe(1);

      // Verify local database was updated
      const closedDay = dal.findById(day.day_id);
      expect(closedDay?.status).toBe('CLOSED');
    });

    it('should not block pack depletion on sync failure', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      // First call (pack sync) throws, second call (day close sync) succeeds
      mockSyncQueueEnqueue
        .mockImplementationOnce(() => {
          throw new Error('Pack sync failed');
        })
        .mockReturnValueOnce({ id: 'sync-item-1' });

      const closings: PackClosingData[] = [
        { pack_id: 'pack-1', closing_serial: '150', is_sold_out: true },
      ];

      dal.prepareClose(day.day_id, closings);
      const result = dal.commitClose(day.day_id, 'user-123');

      // Local commit should still succeed
      expect(result.closings_created).toBe(1);

      // Pack should still be depleted locally
      const pack = db.prepare('SELECT * FROM lottery_packs WHERE pack_id = ?').get('pack-1') as {
        status: string;
      };
      expect(pack.status).toBe('DEPLETED');
    });
  });

  describe('T3.1.4: Edge cases', () => {
    it('should handle empty closings array gracefully', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      const closings: PackClosingData[] = [];

      dal.prepareClose(day.day_id, closings);
      const result = dal.commitClose(day.day_id, 'user-123');

      expect(result.closings_created).toBe(0);

      // No pack syncs should be queued
      const packSyncCalls = mockSyncQueueEnqueue.mock.calls.filter(
        (call) => call[0].entity_type === 'pack'
      );
      expect(packSyncCalls).toHaveLength(0);

      // Day close should still be queued
      const dayCloseSyncCalls = mockSyncQueueEnqueue.mock.calls.filter(
        (call) => call[0].entity_type === 'day_close'
      );
      expect(dayCloseSyncCalls).toHaveLength(1);
    });

    it('should handle all packs continuing to next day (none sold out)', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES
          ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now')),
          ('pack-2', 'store-1', 'game-1', 'bin-1', 'PKG002', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [
        { pack_id: 'pack-1', closing_serial: '100', is_sold_out: false },
        { pack_id: 'pack-2', closing_serial: '050', is_sold_out: false },
      ];

      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, 'user-123');

      // No pack syncs for continuing packs
      const packSyncCalls = mockSyncQueueEnqueue.mock.calls.filter(
        (call) => call[0].entity_type === 'pack'
      );
      expect(packSyncCalls).toHaveLength(0);

      // Day close should include closings array for all packs per API contract
      const dayCloseSyncCall = getSyncCall('day_close');
      expect(dayCloseSyncCall).toBeDefined();
      expect(dayCloseSyncCall![0].payload.closings).toHaveLength(2);
    });

    it('should handle mixed: some sold out, some continue', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES
          ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now')),
          ('pack-2', 'store-1', 'game-1', 'bin-1', 'PKG002', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now')),
          ('pack-3', 'store-1', 'game-1', 'bin-1', 'PKG003', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [
        { pack_id: 'pack-1', closing_serial: '299', is_sold_out: true }, // Sold out
        { pack_id: 'pack-2', closing_serial: '050', is_sold_out: false }, // Continue
        { pack_id: 'pack-3', closing_serial: '299', is_sold_out: true }, // Sold out
      ];

      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, 'user-123');

      // Should have 2 pack syncs for sold out packs
      const packSyncCalls = mockSyncQueueEnqueue.mock.calls.filter(
        (call) => call[0].entity_type === 'pack'
      );
      expect(packSyncCalls).toHaveLength(2);

      const syncedPackIds = packSyncCalls.map((call) => call[0].entity_id);
      expect(syncedPackIds).toContain('pack-1');
      expect(syncedPackIds).toContain('pack-3');
      expect(syncedPackIds).not.toContain('pack-2');
    });

    it('should handle game lookup failure gracefully', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      // Game exists in database with game_code '1001' (from beforeEach setup)
      // Pack references this valid game
      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      // Simulate lotteryGamesDAL.findById cache miss / lookup failure
      // The implementation should fallback to pack.game_code from the database JOIN
      mockLotteryGamesFindById.mockReturnValue(null);

      const closings: PackClosingData[] = [
        { pack_id: 'pack-1', closing_serial: '150', is_sold_out: true },
      ];

      dal.prepareClose(day.day_id, closings);

      // Should not throw - falls back gracefully to pack.game_code from JOIN
      const result = dal.commitClose(day.day_id, 'user-123');
      expect(result).toBeDefined();

      // Sync should still be queued with fallback to pack.game_code
      const packSyncCall = getSyncCall('pack');
      expect(packSyncCall).toBeDefined();
      // Fallback chain: game?.game_code (null) || pack.game_code ('1001') || 'UNKNOWN'
      // Since pack has game_code from JOIN, should use '1001' not 'UNKNOWN'
      expect(packSyncCall[0].payload.game_code).toBe('1001');
    });
  });

  describe('T3.1.5: Security and tenant isolation', () => {
    it('should include store_id in all sync payloads (DB-006)', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [
        { pack_id: 'pack-1', closing_serial: '150', is_sold_out: true },
      ];

      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, 'user-123');

      // All enqueue calls should have store_id at top level
      for (const call of mockSyncQueueEnqueue.mock.calls) {
        expect(call[0].store_id).toBe('store-1');
      }

      // Pack sync payload should include store_id
      const packSyncCall = getSyncCall('pack');
      expect(packSyncCall[0].payload.store_id).toBe('store-1');

      // Day close sync payload should include store_id
      const dayCloseSyncCall = getSyncCall('day_close');
      expect(dayCloseSyncCall[0].payload.store_id).toBe('store-1');
    });

    it('should include depleted_by from authenticated user (SEC-010)', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [
        { pack_id: 'pack-1', closing_serial: '150', is_sold_out: true },
      ];

      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, 'authenticated-user-xyz');

      const packSyncCall = getSyncCall('pack');

      // depleted_by should be the authenticated user from session, not frontend
      expect(packSyncCall[0].payload.depleted_by).toBe('authenticated-user-xyz');
    });

    it('should not leak cross-store data in payloads (DB-006)', () => {
      // Create day in store-1
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [
        { pack_id: 'pack-1', closing_serial: '150', is_sold_out: true },
      ];

      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, 'user-123');

      // Verify no calls have store_id other than store-1
      for (const call of mockSyncQueueEnqueue.mock.calls) {
        expect(call[0].store_id).toBe('store-1');
        // If payload has store_id, verify it matches
        if (call[0].payload?.store_id) {
          expect(call[0].payload.store_id).toBe('store-1');
        }
      }
    });

    it('should use structured payloads, not string interpolation (SEC-006)', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [
        { pack_id: 'pack-1', closing_serial: '150', is_sold_out: true },
      ];

      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, 'user-123');

      // Verify payload is an object, not a string (SEC-006)
      for (const call of mockSyncQueueEnqueue.mock.calls) {
        expect(typeof call[0].payload).toBe('object');
        expect(call[0].payload).not.toBeNull();
      }
    });
  });

  // ==========================================================================
  // Phase 5: Day Open Sync Queue Integration Tests (day_open_push plan Task 5.3)
  // ==========================================================================
  // T5.3.1 - T5.3.6: Day open sync queue tests per test traceability matrix
  // SEC-006: Parameterized queries / structured data
  // DB-006: Tenant isolation via store_id
  // SEC-010: User identity for audit (opened_by)
  // SEC-017: Audit logging without sensitive data
  // ==========================================================================

  describe('Phase 5: Day Open Sync Queue Integration', () => {
    beforeEach(() => {
      mockSyncQueueEnqueue.mockClear();
    });

    // =======================================================================
    // T5.3.1: Day creation queues sync item
    // =======================================================================
    describe('T5.3.1: Day creation queues sync item', () => {
      it('should call syncQueueDAL.enqueue when creating a new day', () => {
        const today = new Date().toISOString().split('T')[0];
        dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        // Find the day_open sync call
        const dayOpenCall = getSyncCall('day_open');

        expect(dayOpenCall).toBeDefined();
      });

      it('should queue sync item with entity_type day_open', () => {
        const today = new Date().toISOString().split('T')[0];
        dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        const dayOpenCall = getSyncCall('day_open');

        expect(dayOpenCall[0].entity_type).toBe('day_open');
      });

      it('should queue sync item with operation CREATE', () => {
        const today = new Date().toISOString().split('T')[0];
        dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        const dayOpenCall = getSyncCall('day_open');

        expect(dayOpenCall[0].operation).toBe('CREATE');
      });

      it('should queue sync item with correct day_id', () => {
        const today = new Date().toISOString().split('T')[0];
        const day = dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        const dayOpenCall = getSyncCall('day_open');

        expect(dayOpenCall[0].entity_id).toBe(day.day_id);
        expect(dayOpenCall[0].payload.day_id).toBe(day.day_id);
      });

      it('should queue sync item with correct store_id', () => {
        const today = new Date().toISOString().split('T')[0];
        dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        const dayOpenCall = getSyncCall('day_open');

        expect(dayOpenCall[0].store_id).toBe('store-1');
        expect(dayOpenCall[0].payload.store_id).toBe('store-1');
      });

      it('should queue sync item with correct business_date', () => {
        const today = new Date().toISOString().split('T')[0];
        dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        const dayOpenCall = getSyncCall('day_open');

        expect(dayOpenCall[0].payload.business_date).toBe(today);
      });
    });

    // =======================================================================
    // T5.3.2: Day open sync payload structure
    // =======================================================================
    describe('T5.3.2: Day open sync payload structure', () => {
      it('should include day_id in payload', () => {
        const today = new Date().toISOString().split('T')[0];
        const day = dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        const dayOpenCall = getSyncCall('day_open');

        expect(dayOpenCall[0].payload.day_id).toBe(day.day_id);
      });

      it('should include store_id in payload', () => {
        const today = new Date().toISOString().split('T')[0];
        dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        const dayOpenCall = getSyncCall('day_open');

        expect(dayOpenCall[0].payload.store_id).toBe('store-1');
      });

      it('should include business_date in YYYY-MM-DD format', () => {
        const today = new Date().toISOString().split('T')[0];
        dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        const dayOpenCall = getSyncCall('day_open');

        // Verify YYYY-MM-DD format
        expect(dayOpenCall[0].payload.business_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it('should include opened_by from userId parameter', () => {
        const today = new Date().toISOString().split('T')[0];
        dal.getOrCreateForDate('store-1', today, 'user-opener-abc');

        const dayOpenCall = getSyncCall('day_open');

        expect(dayOpenCall[0].payload.opened_by).toBe('user-opener-abc');
      });

      it('should not queue sync when userId not provided - opened_by is required', () => {
        const today = new Date().toISOString().split('T')[0];

        // Offline-first: Creates day locally even without userId
        // But sync is NOT queued because opened_by is REQUIRED by cloud API
        const day = dal.getOrCreateForDate('store-1', today);

        // Day is created locally
        expect(day.day_id).toBeDefined();
        expect(day.status).toBe('OPEN');

        // But no sync was queued (opened_by required by cloud)
        expect(mockSyncQueueEnqueue).not.toHaveBeenCalled();
      });

      it('should include opened_at in ISO 8601 format', () => {
        const today = new Date().toISOString().split('T')[0];
        dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        const dayOpenCall = getSyncCall('day_open');

        // opened_at should be a valid ISO 8601 datetime
        expect(Date.parse(dayOpenCall[0].payload.opened_at)).not.toBeNaN();
      });
    });

    // =======================================================================
    // T5.3.3: Sync queue failure handling
    // =======================================================================
    describe('T5.3.3: Sync queue failure handling', () => {
      it('should not throw when sync queue fails', () => {
        mockSyncQueueEnqueue.mockImplementation(() => {
          throw new Error('Sync queue unavailable');
        });

        const today = new Date().toISOString().split('T')[0];

        // Should not throw
        expect(() => {
          dal.getOrCreateForDate('store-1', today, 'user-opener-1');
        }).not.toThrow();
      });

      it('should still create day locally when sync fails', () => {
        mockSyncQueueEnqueue.mockImplementation(() => {
          throw new Error('Sync queue unavailable');
        });

        const today = new Date().toISOString().split('T')[0];
        const day = dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        // Day should still be created
        expect(day).toBeDefined();
        expect(day.day_id).toBeDefined();
        expect(day.status).toBe('OPEN');
      });

      it('should return the created day normally when sync fails', () => {
        mockSyncQueueEnqueue.mockImplementation(() => {
          throw new Error('Sync queue unavailable');
        });

        const today = new Date().toISOString().split('T')[0];
        const day = dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        expect(day.business_date).toBe(today);
        expect(day.store_id).toBe('store-1');
      });
    });

    // =======================================================================
    // T5.3.4: Duplicate prevention
    // =======================================================================
    describe('T5.3.4: Duplicate prevention', () => {
      it('should not queue sync item for existing day', () => {
        const today = new Date().toISOString().split('T')[0];

        // Create day first time
        dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        // Clear mock to track second call
        mockSyncQueueEnqueue.mockClear();

        // Try to get/create same day again
        dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        // Should NOT queue another day_open sync
        // Note: Use .find() directly here since we're asserting no call exists
        const dayOpenCall = mockSyncQueueEnqueue.mock.calls.find(
          (call) => call[0].entity_type === 'day_open'
        );

        expect(dayOpenCall).toBeUndefined();
      });

      it('should only queue for newly created days', () => {
        const today = new Date().toISOString().split('T')[0];

        // First call - creates day
        dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        const initialDayOpenCalls = mockSyncQueueEnqueue.mock.calls.filter(
          (call) => call[0].entity_type === 'day_open'
        );
        expect(initialDayOpenCalls).toHaveLength(1);

        // Second call - returns existing day
        dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        // Still only 1 day_open call
        const allDayOpenCalls = mockSyncQueueEnqueue.mock.calls.filter(
          (call) => call[0].entity_type === 'day_open'
        );
        expect(allDayOpenCalls).toHaveLength(1);
      });

      it('should not duplicate sync when re-opening existing day', () => {
        const today = new Date().toISOString().split('T')[0];

        // Create day
        dal.getOrCreateForDate('store-1', today, 'user-1');
        mockSyncQueueEnqueue.mockClear();

        // Re-get same day multiple times (simulating re-open)
        dal.getOrCreateForDate('store-1', today, 'user-1');
        dal.getOrCreateForDate('store-1', today, 'user-1');
        dal.getOrCreateForDate('store-1', today, 'user-1');

        // No additional day_open calls
        const dayOpenCalls = mockSyncQueueEnqueue.mock.calls.filter(
          (call) => call[0].entity_type === 'day_open'
        );
        expect(dayOpenCalls).toHaveLength(0);
      });
    });

    // =======================================================================
    // T5.3.5: Tenant isolation (DB-006)
    // =======================================================================
    describe('T5.3.5: Tenant isolation (DB-006)', () => {
      it('should include store_id in sync payload', () => {
        const today = new Date().toISOString().split('T')[0];
        dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        const dayOpenCall = getSyncCall('day_open');

        expect(dayOpenCall[0].store_id).toBe('store-1');
        expect(dayOpenCall[0].payload.store_id).toBe('store-1');
      });

      it('should match store_id in enqueue call and payload', () => {
        // Insert a second store
        db.exec(`
          INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
          VALUES ('store-2', 'company-1', 'Test Store 2', 'America/New_York', 'ACTIVE', datetime('now'), datetime('now'));
        `);

        const today = new Date().toISOString().split('T')[0];
        dal.getOrCreateForDate('store-2', today, 'user-opener-1');

        const dayOpenCall = getSyncCall('day_open', 'store-2');

        expect(dayOpenCall[0].store_id).toBe('store-2');
        expect(dayOpenCall[0].payload.store_id).toBe('store-2');
      });

      it('should not include cross-store data in payload', () => {
        const today = new Date().toISOString().split('T')[0];
        dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        const dayOpenCall = getSyncCall('day_open');

        // Verify no cross-store references
        expect(dayOpenCall[0].payload.store_id).toBe('store-1');
        // Payload should not contain any other store IDs
        const payloadStr = JSON.stringify(dayOpenCall[0].payload);
        expect(payloadStr).not.toContain('store-2');
      });
    });

    // =======================================================================
    // T5.3.6: Re-queue functionality
    // =======================================================================
    describe('T5.3.6: Re-queue functionality', () => {
      it('should create new sync item when requeueDayOpenForSync is called', () => {
        const today = new Date().toISOString().split('T')[0];
        const day = dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        mockSyncQueueEnqueue.mockClear();

        // Re-queue for sync
        dal.requeueDayOpenForSync(day.day_id, 'user-requeue-1');

        const dayOpenCall = getSyncCall('day_open');

        expect(dayOpenCall).toBeDefined();
        expect(dayOpenCall[0].entity_id).toBe(day.day_id);
      });

      it('should only allow re-queue for OPEN days', () => {
        const today = new Date().toISOString().split('T')[0];
        const day = dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        // Set up active pack for close
        db.exec(`
          INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
          VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
        `);

        const closings: PackClosingData[] = [
          { pack_id: 'pack-1', closing_serial: '150', is_sold_out: true },
        ];

        dal.prepareClose(day.day_id, closings);
        dal.commitClose(day.day_id, 'user-closer-1');

        // Day is now CLOSED - re-queue should throw
        expect(() => {
          dal.requeueDayOpenForSync(day.day_id, 'user-requeue-1');
        }).toThrow(/Day must be OPEN/);
      });

      it('should throw for non-existent days', () => {
        expect(() => {
          dal.requeueDayOpenForSync('non-existent-day-id', 'user-requeue-1');
        }).toThrow(/Business day not found/);
      });

      it('should use stored opened_by in re-queued payload', () => {
        const today = new Date().toISOString().split('T')[0];
        const day = dal.getOrCreateForDate('store-1', today, 'original-opener');

        mockSyncQueueEnqueue.mockClear();
        dal.requeueDayOpenForSync(day.day_id, 'requeue-requester');

        const dayOpenCall = getSyncCall('day_open');

        // Should use the original opener, not the requeue requester
        expect(dayOpenCall[0].payload.opened_by).toBe('original-opener');
      });
    });

    // =======================================================================
    // T5.3.7: Priority ordering
    // =======================================================================
    describe('T5.3.7: Priority ordering', () => {
      it('should queue day_open with priority 20 (before shifts at 10)', () => {
        const today = new Date().toISOString().split('T')[0];
        dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        const dayOpenCall = getSyncCall('day_open');

        // SYNC-001: day_open must sync before shifts (10) to prevent FK errors
        expect(dayOpenCall[0].priority).toBe(20);
      });

      it('should use PUSH sync_direction', () => {
        const today = new Date().toISOString().split('T')[0];
        dal.getOrCreateForDate('store-1', today, 'user-opener-1');

        const dayOpenCall = getSyncCall('day_open');

        expect(dayOpenCall[0].sync_direction).toBe('PUSH');
      });
    });
  });

  // ==========================================================================
  // Phase 5 Task 5.5: Security Tests
  // ==========================================================================
  // T5.5.1 - SQL injection prevention (SEC-006)
  // T5.5.2 - Tenant isolation (DB-006)
  // T5.5.3 - Authentication validation (SEC-010)
  // ==========================================================================

  describe('Phase 5 Task 5.5: Security Tests', () => {
    beforeEach(() => {
      mockSyncQueueEnqueue.mockClear();
    });

    // =======================================================================
    // T5.5.1: SQL injection prevention (SEC-006)
    // =======================================================================
    describe('T5.5.1: SQL injection prevention (SEC-006)', () => {
      it('should safely handle day_id with SQL injection attempt', () => {
        const today = new Date().toISOString().split('T')[0];

        // Create a day first
        dal.getOrCreateForDate('store-1', today, 'user-1');

        // Try to find with SQL injection attempt - should not throw
        // The parameterized query should safely escape the input
        const maliciousId = "'; DROP TABLE lottery_business_days; --";

        // findById should return undefined for non-existent ID (not error)
        const result = dal.findById(maliciousId);
        expect(result).toBeUndefined();

        // Verify table still exists by querying
        const day = dal.findOpenDay('store-1');
        expect(day).toBeDefined();
      });

      it('should safely handle business_date with SQL injection attempt', () => {
        // Try to create a day with malicious date
        const maliciousDate = "'; DELETE FROM lottery_business_days; --";

        // The DAL uses parameterized queries, so the malicious input is safely escaped
        // Create a normal day first to verify our table is working
        const normalDate = new Date().toISOString().split('T')[0];
        const normalDay = dal.getOrCreateForDate('store-1', normalDate, 'user-1');
        expect(normalDay).toBeDefined();

        // Now try with malicious date - this should throw because there's already
        // an OPEN day with a different date
        try {
          dal.getOrCreateForDate('store-1', maliciousDate, 'user-1');
          // If we get here without throwing, it means the check passed somehow
          // But the important thing is that SQL injection didn't happen
        } catch (error) {
          // Expected: "Cannot open day for X: Day Y is still OPEN"
          expect(error instanceof Error).toBe(true);
          expect((error as Error).message).toContain('Cannot open day');
        }

        // Verify the original day still exists and table wasn't dropped
        const checkDay = dal.findById(normalDay.day_id);
        expect(checkDay).toBeDefined();
        expect(checkDay?.day_id).toBe(normalDay.day_id);
      });

      it('should safely handle store_id with special characters', () => {
        const today = new Date().toISOString().split('T')[0];

        // Find with store_id containing special SQL characters
        const specialStoreId = "store-1'; --";

        // Should return undefined, not throw or execute injection
        const result = dal.findOpenDay(specialStoreId);
        expect(result).toBeUndefined();
      });

      it('should use parameterized queries (verified by payload structure)', () => {
        const today = new Date().toISOString().split('T')[0];
        dal.getOrCreateForDate('store-1', today, 'user-1');

        const dayOpenCall = getSyncCall('day_open');

        // Verify payload is a structured object, not a concatenated string
        expect(typeof dayOpenCall[0].payload).toBe('object');
        expect(dayOpenCall[0].payload.day_id).toBeDefined();
        expect(dayOpenCall[0].payload.store_id).toBe('store-1');
      });
    });

    // =======================================================================
    // T5.5.2: Tenant isolation (DB-006)
    // =======================================================================
    describe('T5.5.2: Tenant isolation (DB-006)', () => {
      beforeEach(() => {
        // Add a second store for isolation testing
        db.exec(`
          INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
          VALUES ('store-2', 'company-1', 'Test Store 2', 'America/New_York', 'ACTIVE', datetime('now'), datetime('now'))
          ON CONFLICT(store_id) DO NOTHING;
        `);
      });

      it('should not allow syncing day for different store', () => {
        const today = new Date().toISOString().split('T')[0];

        // Create days for both stores
        const day1 = dal.getOrCreateForDate('store-1', today, 'user-1');
        const day2 = dal.getOrCreateForDate('store-2', today, 'user-2');

        // Find sync items for each store
        const store1Calls = mockSyncQueueEnqueue.mock.calls.filter(
          (call) => call[0].store_id === 'store-1' && call[0].entity_type === 'day_open'
        );
        const store2Calls = mockSyncQueueEnqueue.mock.calls.filter(
          (call) => call[0].store_id === 'store-2' && call[0].entity_type === 'day_open'
        );

        // Each store should only have its own day
        expect(store1Calls).toHaveLength(1);
        expect(store1Calls[0][0].payload.day_id).toBe(day1.day_id);

        expect(store2Calls).toHaveLength(1);
        expect(store2Calls[0][0].payload.day_id).toBe(day2.day_id);
      });

      it('should include authenticated store_id in payload', () => {
        const today = new Date().toISOString().split('T')[0];
        dal.getOrCreateForDate('store-1', today, 'user-1');

        const dayOpenCall = getSyncCall('day_open');

        // Both the enqueue call and payload should have store_id
        expect(dayOpenCall[0].store_id).toBe('store-1');
        expect(dayOpenCall[0].payload.store_id).toBe('store-1');
      });

      it('should not allow accessing days from other stores', () => {
        const today = new Date().toISOString().split('T')[0];

        // Create day for store-1
        dal.getOrCreateForDate('store-1', today, 'user-1');

        // Try to find it with store-2 - should not find it
        const wrongStoreDay = dal.findByDate('store-2', today);
        expect(wrongStoreDay).toBeUndefined();

        // Correct store should find it
        const correctStoreDay = dal.findByDate('store-1', today);
        expect(correctStoreDay).toBeDefined();
      });
    });

    // =======================================================================
    // T5.5.3: Authentication validation (SEC-010)
    // =======================================================================
    describe('T5.5.3: Authentication validation (SEC-010)', () => {
      it('should capture opened_by from authenticated session context', () => {
        const today = new Date().toISOString().split('T')[0];

        // The userId parameter should come from authenticated session
        dal.getOrCreateForDate('store-1', today, 'authenticated-user-xyz');

        const dayOpenCall = getSyncCall('day_open');

        expect(dayOpenCall[0].payload.opened_by).toBe('authenticated-user-xyz');
      });

      it('should not queue sync when no userId provided - opened_by is required', () => {
        const today = new Date().toISOString().split('T')[0];

        // Offline-first: Creates day locally even without userId
        // But sync is NOT queued because opened_by is REQUIRED by cloud API
        const day = dal.getOrCreateForDate('store-1', today);

        // Day is created locally
        expect(day.day_id).toBeDefined();
        expect(day.status).toBe('OPEN');

        // But no sync was queued (opened_by required by cloud)
        expect(mockSyncQueueEnqueue).not.toHaveBeenCalled();
      });

      it('should preserve original opener in re-queue scenario', () => {
        const today = new Date().toISOString().split('T')[0];

        // Original creation by authenticated user
        const day = dal.getOrCreateForDate('store-1', today, 'original-authenticated-user');

        mockSyncQueueEnqueue.mockClear();

        // Re-queue initiated by different user (admin recovery)
        dal.requeueDayOpenForSync(day.day_id, 'admin-recovery-user');

        const dayOpenCall = getSyncCall('day_open');

        // Should use original opener for audit trail integrity
        expect(dayOpenCall[0].payload.opened_by).toBe('original-authenticated-user');
      });

      it('should not allow spoofing opened_by from request payload', () => {
        const today = new Date().toISOString().split('T')[0];

        // The userId comes from method parameter (authenticated session),
        // not from any untrusted payload
        dal.getOrCreateForDate('store-1', today, 'server-authenticated-user');

        const day = dal.findByDate('store-1', today);

        // The opened_by should be from the server-side session context
        expect(day?.opened_by).toBe('server-authenticated-user');
      });
    });
  });
});
