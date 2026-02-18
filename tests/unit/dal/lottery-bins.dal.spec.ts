/**
 * Lottery Bins DAL Unit Tests
 *
 * Tests for lottery bin entity operations.
 * Validates SEC-006: Parameterized queries
 * Validates DB-006: Tenant isolation via store_id
 *
 * Cloud-aligned schema (v039):
 * - name: Display name (replaces label)
 * - display_order: Sort order (replaces bin_number)
 * - is_active: Boolean (replaces status enum)
 *
 * @module tests/unit/dal/lottery-bins
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LotteryBinsDAL, type CreateLotteryBinData } from '../../../src/main/dal/lottery-bins.dal';

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { testDbContainer } = vi.hoisted(() => ({
  testDbContainer: { db: null as any },
}));

// Mock database service to return our in-memory test database
vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => testDbContainer.db),
  isDatabaseInitialized: vi.fn(() => testDbContainer.db !== null),
}));

// Alias for easier access in tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _testDb: any = null;

describe.skipIf(skipTests)('Lottery Bins DAL', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let dal: LotteryBinsDAL;

  beforeEach(() => {
    // Create in-memory database
    db = new Database(':memory:');
    // Set the shared test database so the mock returns it
    _testDb = db;
    testDbContainer.db = db;

    // Create required tables with cloud-aligned schema
    db.exec(`
      CREATE TABLE lottery_games (
        game_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        name TEXT NOT NULL,
        price REAL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
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
        current_bin_id TEXT,
        pack_number TEXT NOT NULL,
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
        synced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Insert test game
    db.exec(`
      INSERT INTO lottery_games (game_id, store_id, name, price, created_at, updated_at)
      VALUES ('game-1', 'store-1', 'Lucky 7s', 1, datetime('now'), datetime('now'));
    `);

    // Create DAL - it will use testDb via the mocked getDatabase()
    dal = new LotteryBinsDAL();
  });

  afterEach(() => {
    db.close();
    _testDb = null;
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new lottery bin', () => {
      const data: CreateLotteryBinData = {
        store_id: 'store-1',
        name: 'Bin 1',
        display_order: 1,
      };

      const bin = dal.create(data);

      expect(bin).toBeDefined();
      expect(bin.bin_id).toBeDefined();
      expect(bin.store_id).toBe('store-1');
      expect(bin.name).toBe('Bin 1');
      expect(bin.display_order).toBe(1);
      expect(bin.is_active).toBe(1);
    });

    it('should use default is_active if not provided', () => {
      const data: CreateLotteryBinData = {
        store_id: 'store-1',
        name: 'Bin 1',
      };

      const bin = dal.create(data);

      expect(bin.is_active).toBe(1);
    });

    it('should use provided bin_id if given', () => {
      const data: CreateLotteryBinData = {
        bin_id: 'custom-bin-id',
        store_id: 'store-1',
        name: 'Bin 1',
      };

      const bin = dal.create(data);

      expect(bin.bin_id).toBe('custom-bin-id');
    });
  });

  describe('update', () => {
    it('should update bin properties', () => {
      const bin = dal.create({
        store_id: 'store-1',
        name: 'Bin 1',
        display_order: 1,
      });

      const updated = dal.update(bin.bin_id, { name: 'Updated Bin 1' });

      expect(updated).toBeDefined();
      expect(updated?.name).toBe('Updated Bin 1');
    });

    it('should update display_order', () => {
      const bin = dal.create({
        store_id: 'store-1',
        name: 'Bin 1',
        display_order: 1,
      });

      const updated = dal.update(bin.bin_id, { display_order: 2 });

      expect(updated?.display_order).toBe(2);
    });

    it('should update is_active', () => {
      const bin = dal.create({
        store_id: 'store-1',
        name: 'Bin 1',
      });

      const updated = dal.update(bin.bin_id, { is_active: false });

      expect(updated?.is_active).toBe(0);
    });

    it('should return undefined for non-existent bin', () => {
      const result = dal.update('non-existent-id', { name: 'Test' });

      expect(result).toBeUndefined();
    });
  });

  describe('findActiveByStore (DB-006)', () => {
    it('should return only active bins for the specified store', () => {
      // Create bins for store-1
      dal.create({ store_id: 'store-1', name: 'Bin 1', display_order: 1 });
      dal.create({ store_id: 'store-1', name: 'Bin 2', display_order: 2 });

      // Create bin for store-2
      dal.create({ store_id: 'store-2', name: 'Other Bin', display_order: 1 });

      const bins = dal.findActiveByStore('store-1');

      expect(bins.length).toBe(2);
      expect(bins.every((b) => b.store_id === 'store-1')).toBe(true);
    });

    it('should exclude inactive bins', () => {
      const bin = dal.create({ store_id: 'store-1', name: 'Bin 1', display_order: 1 });
      dal.create({ store_id: 'store-1', name: 'Bin 2', display_order: 2 });
      dal.update(bin.bin_id, { is_active: false });

      const bins = dal.findActiveByStore('store-1');

      expect(bins.length).toBe(1);
      expect(bins[0].display_order).toBe(2);
    });

    it('should exclude soft-deleted bins', () => {
      const bin = dal.create({ store_id: 'store-1', name: 'Bin 1', display_order: 1 });
      dal.create({ store_id: 'store-1', name: 'Bin 2', display_order: 2 });
      dal.softDelete(bin.bin_id);

      const bins = dal.findActiveByStore('store-1');

      expect(bins.length).toBe(1);
      expect(bins[0].display_order).toBe(2);
    });

    it('should return bins ordered by display_order', () => {
      dal.create({ store_id: 'store-1', name: 'Bin 3', display_order: 3 });
      dal.create({ store_id: 'store-1', name: 'Bin 1', display_order: 1 });
      dal.create({ store_id: 'store-1', name: 'Bin 2', display_order: 2 });

      const bins = dal.findActiveByStore('store-1');

      expect(bins[0].display_order).toBe(1);
      expect(bins[1].display_order).toBe(2);
      expect(bins[2].display_order).toBe(3);
    });
  });

  describe('findAllByStore', () => {
    it('should include inactive bins but exclude deleted', () => {
      const bin1 = dal.create({ store_id: 'store-1', name: 'Bin 1', display_order: 1 });
      const _bin2 = dal.create({ store_id: 'store-1', name: 'Bin 2', display_order: 2 });
      const bin3 = dal.create({ store_id: 'store-1', name: 'Bin 3', display_order: 3 });

      dal.update(bin1.bin_id, { is_active: false });
      dal.softDelete(bin3.bin_id);

      const bins = dal.findAllByStore('store-1');

      expect(bins.length).toBe(2);
      expect(bins.some((b) => b.is_active === 0)).toBe(true);
    });
  });

  describe('findByName', () => {
    it('should find bin by name within a store', () => {
      dal.create({ store_id: 'store-1', name: 'Bin 1', display_order: 1 });

      const bin = dal.findByName('store-1', 'Bin 1');

      expect(bin).toBeDefined();
      expect(bin?.name).toBe('Bin 1');
    });

    it('should not find bin from different store', () => {
      dal.create({ store_id: 'store-1', name: 'Bin 1', display_order: 1 });

      const bin = dal.findByName('store-2', 'Bin 1');

      expect(bin).toBeUndefined();
    });

    it('should not find soft-deleted bins', () => {
      const bin = dal.create({ store_id: 'store-1', name: 'Bin 1', display_order: 1 });
      dal.softDelete(bin.bin_id);

      const found = dal.findByName('store-1', 'Bin 1');

      expect(found).toBeUndefined();
    });
  });

  describe('getPackCount', () => {
    it('should return count of activated packs in bin', () => {
      const bin = dal.create({ store_id: 'store-1', name: 'Bin 1', display_order: 1 });

      // Insert test packs directly using current_bin_id
      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, status, created_at, updated_at)
        VALUES
          ('pack-1', 'store-1', 'game-1', '${bin.bin_id}', 'PKG001', 'ACTIVE', datetime('now'), datetime('now')),
          ('pack-2', 'store-1', 'game-1', '${bin.bin_id}', 'PKG002', 'ACTIVE', datetime('now'), datetime('now')),
          ('pack-3', 'store-1', 'game-1', '${bin.bin_id}', 'PKG003', 'RECEIVED', datetime('now'), datetime('now'));
      `);

      const count = dal.getPackCount(bin.bin_id);

      expect(count).toBe(2); // Only ACTIVE packs
    });

    it('should return 0 for empty bin', () => {
      const bin = dal.create({ store_id: 'store-1', name: 'Bin 1', display_order: 1 });

      const count = dal.getPackCount(bin.bin_id);

      expect(count).toBe(0);
    });
  });

  describe('softDelete', () => {
    it('should set deleted_at timestamp', () => {
      const bin = dal.create({ store_id: 'store-1', name: 'Bin 1', display_order: 1 });

      const result = dal.softDelete(bin.bin_id);

      expect(result.success).toBe(true);

      // Verify it's not found in active bins
      const found = dal.findActiveByStore('store-1');
      expect(found.length).toBe(0);
    });

    it('should fail when bin has active packs', () => {
      const bin = dal.create({ store_id: 'store-1', name: 'Bin 1', display_order: 1 });

      // Insert active pack using current_bin_id
      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, status, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', '${bin.bin_id}', 'PKG001', 'ACTIVE', datetime('now'), datetime('now'));
      `);

      const result = dal.softDelete(bin.bin_id);

      expect(result.success).toBe(false);
      expect(result.error).toContain('active pack');
    });

    it('should return error for non-existent bin', () => {
      const result = dal.softDelete('non-existent-id');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('restore', () => {
    it('should clear deleted_at timestamp', () => {
      const bin = dal.create({ store_id: 'store-1', name: 'Bin 1', display_order: 1 });
      dal.softDelete(bin.bin_id);

      const result = dal.restore(bin.bin_id);

      expect(result).toBe(true);

      // Verify it's found in active bins again
      const found = dal.findActiveByStore('store-1');
      expect(found.length).toBe(1);
    });
  });

  describe('activate/deactivate', () => {
    it('should set is_active to 1', () => {
      const bin = dal.create({ store_id: 'store-1', name: 'Bin 1', display_order: 1 });
      dal.update(bin.bin_id, { is_active: false });

      const result = dal.activate(bin.bin_id);

      expect(result).toBe(true);
      const updated = dal.findById(bin.bin_id);
      expect(updated?.is_active).toBe(1);
    });

    it('should set is_active to 0', () => {
      const bin = dal.create({ store_id: 'store-1', name: 'Bin 1', display_order: 1 });

      const result = dal.deactivate(bin.bin_id);

      expect(result).toBe(true);
      const updated = dal.findById(bin.bin_id);
      expect(updated?.is_active).toBe(0);
    });
  });

  describe('bulkCreate', () => {
    it('should create multiple bins at once', () => {
      const bins = dal.bulkCreate('store-1', 5);

      expect(bins.length).toBe(5);
      expect(bins[0].display_order).toBe(1);
      expect(bins[4].display_order).toBe(5);
    });

    it('should throw error for count > 200', () => {
      expect(() => dal.bulkCreate('store-1', 201)).toThrow();
    });

    it('should throw error for count <= 0', () => {
      expect(() => dal.bulkCreate('store-1', 0)).toThrow();
      expect(() => dal.bulkCreate('store-1', -1)).toThrow();
    });

    it('should create bins with default names', () => {
      const bins = dal.bulkCreate('store-1', 3);

      expect(bins[0].name).toBe('Bin 1');
      expect(bins[1].name).toBe('Bin 2');
      expect(bins[2].name).toBe('Bin 3');
    });
  });

  describe('getNextDisplayOrder', () => {
    it('should return 1 for empty store', () => {
      const next = dal.getNextDisplayOrder('store-1');

      expect(next).toBe(1);
    });

    it('should return next available order', () => {
      dal.create({ store_id: 'store-1', name: 'Bin 1', display_order: 1 });
      dal.create({ store_id: 'store-1', name: 'Bin 2', display_order: 2 });
      dal.create({ store_id: 'store-1', name: 'Bin 3', display_order: 3 });

      const next = dal.getNextDisplayOrder('store-1');

      expect(next).toBe(4);
    });

    it('should not consider deleted bins', () => {
      const bin = dal.create({ store_id: 'store-1', name: 'Bin 1', display_order: 1 });
      dal.create({ store_id: 'store-1', name: 'Bin 2', display_order: 2 });
      dal.softDelete(bin.bin_id);

      const next = dal.getNextDisplayOrder('store-1');

      expect(next).toBe(3);
    });
  });

  describe('upsertFromCloud', () => {
    it('should create new bin from cloud data', () => {
      // After v037 migration: bin_id IS the cloud's UUID (no separate cloud_bin_id)
      const cloudData = {
        bin_id: 'cloud-123',
        store_id: 'store-1',
        name: 'Bin 1',
        display_order: 1,
      };

      const bin = dal.upsertFromCloud(cloudData);

      expect(bin.bin_id).toBe('cloud-123');
      expect(bin.name).toBe('Bin 1');
      expect(bin.synced_at).toBeDefined();
    });

    it('should update existing bin matched by bin_id', () => {
      // After v037 migration: bin_id IS the cloud's UUID
      const cloudData = {
        bin_id: 'cloud-123',
        store_id: 'store-1',
        name: 'Bin 1',
        display_order: 1,
      };

      dal.upsertFromCloud(cloudData);

      // Update with new data
      const updated = dal.upsertFromCloud({
        ...cloudData,
        name: 'Updated Bin 1',
      });

      expect(updated.name).toBe('Updated Bin 1');

      // Should only have one bin
      const allBins = dal.findActiveByStore('store-1');
      expect(allBins.length).toBe(1);
    });
  });

  describe('findBinsWithPacks', () => {
    it('should return bins with active pack info', () => {
      const bin = dal.create({ store_id: 'store-1', name: 'Bin 1', display_order: 1 });

      // Insert pack with game using current_bin_id
      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, status, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', '${bin.bin_id}', 'PKG001', 'ACTIVE', datetime('now'), datetime('now'));
      `);

      const binsWithPacks = dal.findBinsWithPacks('store-1');

      expect(binsWithPacks.length).toBe(1);
      expect(binsWithPacks[0].pack_id).toBe('pack-1');
      expect(binsWithPacks[0].pack_number).toBe('PKG001');
      expect(binsWithPacks[0].game_name).toBe('Lucky 7s');
      expect(binsWithPacks[0].game_price).toBe(1);
    });

    it('should return bins without packs with null pack info', () => {
      dal.create({ store_id: 'store-1', name: 'Bin 1', display_order: 1 });

      const binsWithPacks = dal.findBinsWithPacks('store-1');

      expect(binsWithPacks.length).toBe(1);
      expect(binsWithPacks[0].pack_id).toBeNull();
      expect(binsWithPacks[0].pack_number).toBeNull();
    });
  });

  describe('findByCloudId', () => {
    it('should find bin by cloud ID (now same as bin_id)', () => {
      // After v037 migration: bin_id IS the cloud's UUID
      dal.upsertFromCloud({
        bin_id: 'cloud-123',
        store_id: 'store-1',
        name: 'Bin 1',
        display_order: 1,
      });

      const found = dal.findByCloudId('cloud-123');

      expect(found).toBeDefined();
      expect(found?.name).toBe('Bin 1');
      expect(found?.bin_id).toBe('cloud-123');
    });

    it('should return undefined for non-existent cloud ID', () => {
      const found = dal.findByCloudId('non-existent');

      expect(found).toBeUndefined();
    });
  });
});
