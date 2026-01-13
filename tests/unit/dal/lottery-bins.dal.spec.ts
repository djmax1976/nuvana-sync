/**
 * Lottery Bins DAL Unit Tests
 *
 * Tests for lottery bin entity operations.
 * Validates SEC-006: Parameterized queries
 * Validates DB-006: Tenant isolation via store_id
 *
 * @module tests/unit/dal/lottery-bins
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { LotteryBinsDAL, type LotteryBin, type CreateLotteryBinData } from '../../../src/main/dal/lottery-bins.dal';

// Mock the database service
vi.mock('../../../src/main/services/database.service', () => ({
  databaseService: {
    getDatabase: vi.fn(),
    isReady: vi.fn().mockReturnValue(true),
  },
}));

describe('Lottery Bins DAL', () => {
  let db: Database.Database;
  let dal: LotteryBinsDAL;

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
        cloud_bin_id TEXT,
        synced_at TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE lottery_packs (
        pack_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        game_id TEXT NOT NULL,
        bin_id TEXT,
        pack_number TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'RECEIVED',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Insert test game
    db.exec(`
      INSERT INTO lottery_games (game_id, store_id, name, price, created_at, updated_at)
      VALUES ('game-1', 'store-1', 'Lucky 7s', 1, datetime('now'), datetime('now'));
    `);

    // Create DAL with mocked db
    dal = new LotteryBinsDAL();
    // @ts-expect-error - accessing protected member for testing
    dal.db = db;
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new lottery bin', () => {
      const data: CreateLotteryBinData = {
        store_id: 'store-1',
        bin_number: 1,
        label: 'Bin 1',
      };

      const bin = dal.create(data);

      expect(bin).toBeDefined();
      expect(bin.bin_id).toBeDefined();
      expect(bin.store_id).toBe('store-1');
      expect(bin.bin_number).toBe(1);
      expect(bin.label).toBe('Bin 1');
      expect(bin.status).toBe('ACTIVE');
    });

    it('should use default status if not provided', () => {
      const data: CreateLotteryBinData = {
        store_id: 'store-1',
        bin_number: 1,
      };

      const bin = dal.create(data);

      expect(bin.status).toBe('ACTIVE');
    });

    it('should use provided bin_id if given', () => {
      const data: CreateLotteryBinData = {
        bin_id: 'custom-bin-id',
        store_id: 'store-1',
        bin_number: 1,
      };

      const bin = dal.create(data);

      expect(bin.bin_id).toBe('custom-bin-id');
    });
  });

  describe('update', () => {
    it('should update bin properties', () => {
      const bin = dal.create({
        store_id: 'store-1',
        bin_number: 1,
        label: 'Bin 1',
      });

      const updated = dal.update(bin.bin_id, { label: 'Updated Bin 1' });

      expect(updated).toBeDefined();
      expect(updated?.label).toBe('Updated Bin 1');
    });

    it('should update bin number', () => {
      const bin = dal.create({
        store_id: 'store-1',
        bin_number: 1,
      });

      const updated = dal.update(bin.bin_id, { bin_number: 2 });

      expect(updated?.bin_number).toBe(2);
    });

    it('should update status', () => {
      const bin = dal.create({
        store_id: 'store-1',
        bin_number: 1,
      });

      const updated = dal.update(bin.bin_id, { status: 'INACTIVE' });

      expect(updated?.status).toBe('INACTIVE');
    });

    it('should return undefined for non-existent bin', () => {
      const result = dal.update('non-existent-id', { label: 'Test' });

      expect(result).toBeUndefined();
    });
  });

  describe('findActiveByStore (DB-006)', () => {
    it('should return only active bins for the specified store', () => {
      // Create bins for store-1
      dal.create({ store_id: 'store-1', bin_number: 1, label: 'Bin 1' });
      dal.create({ store_id: 'store-1', bin_number: 2, label: 'Bin 2' });

      // Create bin for store-2
      dal.create({ store_id: 'store-2', bin_number: 1, label: 'Other Bin' });

      const bins = dal.findActiveByStore('store-1');

      expect(bins.length).toBe(2);
      expect(bins.every(b => b.store_id === 'store-1')).toBe(true);
    });

    it('should exclude inactive bins', () => {
      const bin = dal.create({ store_id: 'store-1', bin_number: 1 });
      dal.create({ store_id: 'store-1', bin_number: 2 });
      dal.update(bin.bin_id, { status: 'INACTIVE' });

      const bins = dal.findActiveByStore('store-1');

      expect(bins.length).toBe(1);
      expect(bins[0].bin_number).toBe(2);
    });

    it('should exclude soft-deleted bins', () => {
      const bin = dal.create({ store_id: 'store-1', bin_number: 1 });
      dal.create({ store_id: 'store-1', bin_number: 2 });
      dal.softDelete(bin.bin_id);

      const bins = dal.findActiveByStore('store-1');

      expect(bins.length).toBe(1);
      expect(bins[0].bin_number).toBe(2);
    });

    it('should return bins ordered by bin_number', () => {
      dal.create({ store_id: 'store-1', bin_number: 3 });
      dal.create({ store_id: 'store-1', bin_number: 1 });
      dal.create({ store_id: 'store-1', bin_number: 2 });

      const bins = dal.findActiveByStore('store-1');

      expect(bins[0].bin_number).toBe(1);
      expect(bins[1].bin_number).toBe(2);
      expect(bins[2].bin_number).toBe(3);
    });
  });

  describe('findAllByStore', () => {
    it('should include inactive bins but exclude deleted', () => {
      const bin1 = dal.create({ store_id: 'store-1', bin_number: 1 });
      const bin2 = dal.create({ store_id: 'store-1', bin_number: 2 });
      const bin3 = dal.create({ store_id: 'store-1', bin_number: 3 });

      dal.update(bin1.bin_id, { status: 'INACTIVE' });
      dal.softDelete(bin3.bin_id);

      const bins = dal.findAllByStore('store-1');

      expect(bins.length).toBe(2);
      expect(bins.some(b => b.status === 'INACTIVE')).toBe(true);
    });
  });

  describe('findByBinNumber', () => {
    it('should find bin by number within a store', () => {
      dal.create({ store_id: 'store-1', bin_number: 1, label: 'Bin 1' });

      const bin = dal.findByBinNumber('store-1', 1);

      expect(bin).toBeDefined();
      expect(bin?.label).toBe('Bin 1');
    });

    it('should not find bin from different store', () => {
      dal.create({ store_id: 'store-1', bin_number: 1, label: 'Bin 1' });

      const bin = dal.findByBinNumber('store-2', 1);

      expect(bin).toBeUndefined();
    });

    it('should not find soft-deleted bins', () => {
      const bin = dal.create({ store_id: 'store-1', bin_number: 1 });
      dal.softDelete(bin.bin_id);

      const found = dal.findByBinNumber('store-1', 1);

      expect(found).toBeUndefined();
    });
  });

  describe('getPackCount', () => {
    it('should return count of activated packs in bin', () => {
      const bin = dal.create({ store_id: 'store-1', bin_number: 1 });

      // Insert test packs directly
      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, bin_id, pack_number, status, created_at, updated_at)
        VALUES
          ('pack-1', 'store-1', 'game-1', '${bin.bin_id}', 'PKG001', 'ACTIVATED', datetime('now'), datetime('now')),
          ('pack-2', 'store-1', 'game-1', '${bin.bin_id}', 'PKG002', 'ACTIVATED', datetime('now'), datetime('now')),
          ('pack-3', 'store-1', 'game-1', '${bin.bin_id}', 'PKG003', 'RECEIVED', datetime('now'), datetime('now'));
      `);

      const count = dal.getPackCount(bin.bin_id);

      expect(count).toBe(2); // Only ACTIVATED packs
    });

    it('should return 0 for empty bin', () => {
      const bin = dal.create({ store_id: 'store-1', bin_number: 1 });

      const count = dal.getPackCount(bin.bin_id);

      expect(count).toBe(0);
    });
  });

  describe('softDelete', () => {
    it('should set deleted_at timestamp', () => {
      const bin = dal.create({ store_id: 'store-1', bin_number: 1 });

      const result = dal.softDelete(bin.bin_id);

      expect(result.success).toBe(true);

      // Verify it's not found in active bins
      const found = dal.findActiveByStore('store-1');
      expect(found.length).toBe(0);
    });

    it('should fail when bin has active packs', () => {
      const bin = dal.create({ store_id: 'store-1', bin_number: 1 });

      // Insert active pack
      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, bin_id, pack_number, status, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', '${bin.bin_id}', 'PKG001', 'ACTIVATED', datetime('now'), datetime('now'));
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
      const bin = dal.create({ store_id: 'store-1', bin_number: 1 });
      dal.softDelete(bin.bin_id);

      const result = dal.restore(bin.bin_id);

      expect(result).toBe(true);

      // Verify it's found in active bins again
      const found = dal.findActiveByStore('store-1');
      expect(found.length).toBe(1);
    });
  });

  describe('activate/deactivate', () => {
    it('should set status to ACTIVE', () => {
      const bin = dal.create({ store_id: 'store-1', bin_number: 1 });
      dal.update(bin.bin_id, { status: 'INACTIVE' });

      const result = dal.activate(bin.bin_id);

      expect(result).toBe(true);
      const updated = dal.findById(bin.bin_id);
      expect(updated?.status).toBe('ACTIVE');
    });

    it('should set status to INACTIVE', () => {
      const bin = dal.create({ store_id: 'store-1', bin_number: 1 });

      const result = dal.deactivate(bin.bin_id);

      expect(result).toBe(true);
      const updated = dal.findById(bin.bin_id);
      expect(updated?.status).toBe('INACTIVE');
    });
  });

  describe('bulkCreate', () => {
    it('should create multiple bins at once', () => {
      const bins = dal.bulkCreate('store-1', 5);

      expect(bins.length).toBe(5);
      expect(bins[0].bin_number).toBe(1);
      expect(bins[4].bin_number).toBe(5);
    });

    it('should throw error for count > 200', () => {
      expect(() => dal.bulkCreate('store-1', 201)).toThrow();
    });

    it('should throw error for count <= 0', () => {
      expect(() => dal.bulkCreate('store-1', 0)).toThrow();
      expect(() => dal.bulkCreate('store-1', -1)).toThrow();
    });

    it('should create bins with default labels', () => {
      const bins = dal.bulkCreate('store-1', 3);

      expect(bins[0].label).toBe('Bin 1');
      expect(bins[1].label).toBe('Bin 2');
      expect(bins[2].label).toBe('Bin 3');
    });
  });

  describe('getNextBinNumber', () => {
    it('should return 1 for empty store', () => {
      const next = dal.getNextBinNumber('store-1');

      expect(next).toBe(1);
    });

    it('should return next available number', () => {
      dal.create({ store_id: 'store-1', bin_number: 1 });
      dal.create({ store_id: 'store-1', bin_number: 2 });
      dal.create({ store_id: 'store-1', bin_number: 3 });

      const next = dal.getNextBinNumber('store-1');

      expect(next).toBe(4);
    });

    it('should not consider deleted bins', () => {
      const bin = dal.create({ store_id: 'store-1', bin_number: 1 });
      dal.create({ store_id: 'store-1', bin_number: 2 });
      dal.softDelete(bin.bin_id);

      const next = dal.getNextBinNumber('store-1');

      expect(next).toBe(3);
    });
  });

  describe('upsertFromCloud', () => {
    it('should create new bin from cloud data', () => {
      const cloudData = {
        cloud_bin_id: 'cloud-123',
        store_id: 'store-1',
        bin_number: 1,
        label: 'Bin 1',
      };

      const bin = dal.upsertFromCloud(cloudData);

      expect(bin.cloud_bin_id).toBe('cloud-123');
      expect(bin.synced_at).toBeDefined();
    });

    it('should update existing bin matched by cloud_bin_id', () => {
      const cloudData = {
        cloud_bin_id: 'cloud-123',
        store_id: 'store-1',
        bin_number: 1,
        label: 'Bin 1',
      };

      dal.upsertFromCloud(cloudData);

      // Update with new data
      const updated = dal.upsertFromCloud({
        ...cloudData,
        label: 'Updated Bin 1',
      });

      expect(updated.label).toBe('Updated Bin 1');

      // Should only have one bin
      const allBins = dal.findActiveByStore('store-1');
      expect(allBins.length).toBe(1);
    });
  });

  describe('findBinsWithPacks', () => {
    it('should return bins with active pack info', () => {
      const bin = dal.create({ store_id: 'store-1', bin_number: 1, label: 'Bin 1' });

      // Insert pack with game
      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, bin_id, pack_number, status, created_at, updated_at)
        VALUES ('pack-1', 'store-1', 'game-1', '${bin.bin_id}', 'PKG001', 'ACTIVATED', datetime('now'), datetime('now'));
      `);

      const binsWithPacks = dal.findBinsWithPacks('store-1');

      expect(binsWithPacks.length).toBe(1);
      expect(binsWithPacks[0].pack_id).toBe('pack-1');
      expect(binsWithPacks[0].pack_number).toBe('PKG001');
      expect(binsWithPacks[0].game_name).toBe('Lucky 7s');
      expect(binsWithPacks[0].game_price).toBe(1);
    });

    it('should return bins without packs with null pack info', () => {
      dal.create({ store_id: 'store-1', bin_number: 1, label: 'Bin 1' });

      const binsWithPacks = dal.findBinsWithPacks('store-1');

      expect(binsWithPacks.length).toBe(1);
      expect(binsWithPacks[0].pack_id).toBeNull();
      expect(binsWithPacks[0].pack_number).toBeNull();
    });
  });

  describe('findByCloudId', () => {
    it('should find bin by cloud ID', () => {
      dal.upsertFromCloud({
        cloud_bin_id: 'cloud-123',
        store_id: 'store-1',
        bin_number: 1,
      });

      const found = dal.findByCloudId('cloud-123');

      expect(found).toBeDefined();
      expect(found?.bin_number).toBe(1);
    });

    it('should return undefined for non-existent cloud ID', () => {
      const found = dal.findByCloudId('non-existent');

      expect(found).toBeUndefined();
    });
  });
});
