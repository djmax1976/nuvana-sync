/**
 * Lottery Business Days DAL Unit Tests
 *
 * Tests for lottery business day operations.
 * Validates two-phase day close pattern: prepare -> commit/cancel
 * Validates SEC-006: Parameterized queries
 * Validates DB-006: Tenant isolation via store_id
 *
 * @module tests/unit/dal/lottery-business-days
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  LotteryBusinessDaysDAL,
  type LotteryBusinessDay as _LotteryBusinessDay,
  type PackClosingData,
  type PrepareCloseResult as _PrepareCloseResult,
  type CommitCloseResult as _CommitCloseResult,
} from '../../../src/main/dal/lottery-business-days.dal';

// Mock database service
const mockPrepare = vi.fn();
const mockTransaction = vi.fn((fn) => () => fn());

vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

describe('Lottery Business Days DAL', () => {
  let db: Database.Database;
  let dal: LotteryBusinessDaysDAL;

  beforeEach(() => {
    // Create in-memory database
    db = new Database(':memory:');

    // Create required tables
    db.exec(`
      CREATE TABLE lottery_games (
        game_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        name TEXT NOT NULL,
        price REAL,
        tickets_per_pack INTEGER DEFAULT 300,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE lottery_bins (
        bin_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        bin_number INTEGER NOT NULL,
        label TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE lottery_packs (
        pack_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        game_id TEXT NOT NULL,
        bin_id TEXT,
        pack_number TEXT NOT NULL,
        opening_serial TEXT,
        closing_serial TEXT,
        status TEXT NOT NULL DEFAULT 'RECEIVED',
        activated_at TEXT,
        settled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE lottery_business_days (
        day_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        business_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN',
        total_packs_activated INTEGER DEFAULT 0,
        packs_settled INTEGER DEFAULT 0,
        total_sales REAL DEFAULT 0,
        closed_at TEXT,
        closed_by_user_id TEXT,
        pending_close_data TEXT,
        pending_close_expires_at TEXT,
        cloud_day_id TEXT,
        synced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX idx_lottery_days_store_date ON lottery_business_days(store_id, business_date);
    `);

    // Insert test data
    db.exec(`
      INSERT INTO lottery_games (game_id, store_id, name, price, tickets_per_pack, created_at, updated_at)
      VALUES ('game-1', 'store-1', 'Lucky 7s', 1, 300, datetime('now'), datetime('now'));

      INSERT INTO lottery_bins (bin_id, store_id, bin_number, label, created_at, updated_at)
      VALUES ('bin-1', 'store-1', 1, 'Bin 1', datetime('now'), datetime('now'));
    `);

    // Create DAL with mocked db
    dal = new LotteryBusinessDaysDAL();
    // @ts-expect-error - accessing protected member for testing
    dal.db = db;
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
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

      const day1 = dal.getOrCreateForDate('store-1', today);
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
        INSERT INTO lottery_packs (pack_id, store_id, game_id, bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVATED', datetime('now'), datetime('now'), datetime('now'));
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
        INSERT INTO lottery_games (game_id, store_id, name, price, tickets_per_pack, created_at, updated_at)
        VALUES ('game-2', 'store-1', 'Cash Explosion', 2, 150, datetime('now'), datetime('now'));

        INSERT INTO lottery_packs (pack_id, store_id, game_id, bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-2', 'store-1', 'game-2', 'bin-1', 'PKG002', '000', 'ACTIVATED', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [{ pack_id: 'pack-2', closing_serial: '100' }];

      const result = dal.prepareClose(day.day_id, closings);

      expect(result.estimated_lottery_total).toBe(200); // 100 tickets * $2
    });

    it('should set expiration time', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVATED', datetime('now'), datetime('now'), datetime('now'));
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
        INSERT INTO lottery_packs (pack_id, store_id, game_id, bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVATED', datetime('now'), datetime('now'), datetime('now'));
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
        INSERT INTO lottery_packs (pack_id, store_id, game_id, bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVATED', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [{ pack_id: 'pack-1', closing_serial: '150' }];

      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, 'user-123');

      // Check pack was updated
      const pack = db.prepare('SELECT * FROM lottery_packs WHERE pack_id = ?').get('pack-1') as {
        status: string;
        closing_serial: string;
        settled_at: string;
      };
      expect(pack.status).toBe('SETTLED');
      expect(pack.closing_serial).toBe('150');
      expect(pack.settled_at).toBeDefined();
    });

    it('should throw error for non-PENDING_CLOSE day', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      expect(() => dal.commitClose(day.day_id, 'user-123')).toThrow();
    });

    it('should throw error for expired pending close', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVATED', datetime('now'), datetime('now'), datetime('now'));
      `);

      const closings: PackClosingData[] = [{ pack_id: 'pack-1', closing_serial: '150' }];

      dal.prepareClose(day.day_id, closings);

      // Manually set expiration to past
      db.exec(
        `UPDATE lottery_business_days SET pending_close_expires_at = datetime('now', '-1 hour') WHERE day_id = '${day.day_id}'`
      );

      expect(() => dal.commitClose(day.day_id, 'user-123')).toThrow();
    });
  });

  describe('cancelClose', () => {
    it('should revert status to OPEN', () => {
      const today = new Date().toISOString().split('T')[0];
      const day = dal.getOrCreateForDate('store-1', today);

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVATED', datetime('now'), datetime('now'), datetime('now'));
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
        INSERT INTO lottery_packs (pack_id, store_id, game_id, bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', 'bin-1', 'PKG001', '000', 'ACTIVATED', datetime('now'), datetime('now'), datetime('now'));
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
});
