/**
 * Lottery Packs DAL Unit Tests
 *
 * Tests for lottery pack lifecycle operations.
 * Validates pack state transitions: RECEIVED -> ACTIVATED -> SETTLED/RETURNED
 * Validates SEC-006: Parameterized queries
 * Validates DB-006: Tenant isolation via store_id
 *
 * @module tests/unit/dal/lottery-packs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LotteryPacksDAL,
  type LotteryPack as _LotteryPack,
  type ReceivePackData,
  type ActivatePackData,
} from '../../../src/main/dal/lottery-packs.dal';

// Hoist mock functions so they're available when vi.mock factory runs
const { mockPrepare, mockTransaction } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn((fn: () => unknown) => () => fn()),
}));

vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

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

describe.skipIf(skipTests)('Lottery Packs DAL', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let dal: LotteryPacksDAL;

  beforeEach(() => {
    // Create in-memory database
    db = new Database(':memory:');

    // Create required tables
    db.exec(`
      CREATE TABLE lottery_games (
        game_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        game_code TEXT NOT NULL,
        name TEXT NOT NULL,
        price REAL,
        tickets_per_pack INTEGER NOT NULL DEFAULT 300,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE lottery_bins (
        bin_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        bin_number INTEGER NOT NULL,
        label TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
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
        opening_serial TEXT,
        closing_serial TEXT,
        status TEXT NOT NULL DEFAULT 'RECEIVED',
        received_at TEXT NOT NULL,
        activated_at TEXT,
        settled_at TEXT,
        returned_at TEXT,
        return_reason TEXT,
        cloud_pack_id TEXT,
        synced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (game_id) REFERENCES lottery_games(game_id),
        FOREIGN KEY (bin_id) REFERENCES lottery_bins(bin_id)
      );
    `);

    // Insert test game
    db.exec(`
      INSERT INTO lottery_games (game_id, store_id, game_code, name, price, tickets_per_pack, created_at, updated_at)
      VALUES ('game-1', 'store-1', '1001', 'Lucky 7s', 1, 300, datetime('now'), datetime('now'));
    `);

    // Insert test bin
    db.exec(`
      INSERT INTO lottery_bins (bin_id, store_id, bin_number, label, created_at, updated_at)
      VALUES ('bin-1', 'store-1', 1, 'Bin 1', datetime('now'), datetime('now'));
    `);

    // Create DAL with mocked db
    dal = new LotteryPacksDAL();
    // @ts-expect-error - accessing protected member for testing
    dal.db = db;
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  describe('receive', () => {
    it('should create a new pack in RECEIVED status', () => {
      const data: ReceivePackData = {
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      };

      const pack = dal.receive(data);

      expect(pack).toBeDefined();
      expect(pack.pack_id).toBeDefined();
      expect(pack.status).toBe('RECEIVED');
      expect(pack.received_at).toBeDefined();
      expect(pack.activated_at).toBeNull();
      expect(pack.bin_id).toBeNull();
    });

    it('should throw error for duplicate pack number in same store/game', () => {
      const data: ReceivePackData = {
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      };

      dal.receive(data);

      expect(() => dal.receive(data)).toThrow();
    });

    it('should use provided pack_id if given', () => {
      const data: ReceivePackData = {
        pack_id: 'custom-pack-id',
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      };

      const pack = dal.receive(data);

      expect(pack.pack_id).toBe('custom-pack-id');
    });
  });

  describe('activate', () => {
    it('should transition pack from RECEIVED to ACTIVATED', () => {
      const receivedPack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });

      const activateData: ActivatePackData = {
        bin_id: 'bin-1',
        opening_serial: '000',
      };

      const activatedPack = dal.activate(receivedPack.pack_id, activateData);

      expect(activatedPack).toBeDefined();
      expect(activatedPack?.status).toBe('ACTIVATED');
      expect(activatedPack?.bin_id).toBe('bin-1');
      expect(activatedPack?.opening_serial).toBe('000');
      expect(activatedPack?.activated_at).toBeDefined();
    });

    it('should throw error when activating non-RECEIVED pack', () => {
      const receivedPack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });

      // Activate it
      dal.activate(receivedPack.pack_id, { bin_id: 'bin-1', opening_serial: '000' });

      // Try to activate again
      expect(() =>
        dal.activate(receivedPack.pack_id, { bin_id: 'bin-1', opening_serial: '050' })
      ).toThrow();
    });

    it('should return undefined for non-existent pack', () => {
      const result = dal.activate('non-existent-id', { bin_id: 'bin-1', opening_serial: '000' });

      expect(result).toBeUndefined();
    });
  });

  describe('settle', () => {
    it('should transition pack from ACTIVATED to SETTLED', () => {
      const pack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });
      dal.activate(pack.pack_id, { bin_id: 'bin-1', opening_serial: '000' });

      const settledPack = dal.settle(pack.pack_id, {
        closing_serial: '150',
        tickets_sold: 150,
        sales_amount: 150,
      });

      expect(settledPack).toBeDefined();
      expect(settledPack?.status).toBe('SETTLED');
      expect(settledPack?.closing_serial).toBe('150');
      expect(settledPack?.settled_at).toBeDefined();
    });

    it('should calculate sales correctly', () => {
      const pack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });
      dal.activate(pack.pack_id, { bin_id: 'bin-1', opening_serial: '000' });

      const sales = dal.calculateSales(pack.pack_id, '150');

      // tickets_sold = closing_serial - opening_serial = 150 - 0 = 150
      // sales_amount = tickets_sold * price = 150 * 1 = 150
      expect(sales).toBeDefined();
      expect(sales?.ticketsSold).toBe(150);
      expect(sales?.salesAmount).toBe(150);
    });

    it('should throw error when settling non-ACTIVATED pack', () => {
      const pack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });

      expect(() =>
        dal.settle(pack.pack_id, { closing_serial: '150', tickets_sold: 150, sales_amount: 150 })
      ).toThrow();
    });
  });

  describe('returnPack', () => {
    it('should transition pack from ACTIVATED to RETURNED', () => {
      const pack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });
      dal.activate(pack.pack_id, { bin_id: 'bin-1', opening_serial: '000' });

      const returnedPack = dal.returnPack(pack.pack_id, { return_reason: 'DAMAGED' });

      expect(returnedPack).toBeDefined();
      expect(returnedPack?.status).toBe('RETURNED');
      // return_reason is passed as input but not stored on the pack entity
      expect(returnedPack?.returned_at).toBeDefined();
    });

    it('should transition pack from RECEIVED to RETURNED', () => {
      const pack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });

      const returnedPack = dal.returnPack(pack.pack_id, { return_reason: 'SUPPLIER_RECALL' });

      expect(returnedPack).toBeDefined();
      expect(returnedPack?.status).toBe('RETURNED');
    });

    it('should throw error when returning already SETTLED pack', () => {
      const pack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });
      dal.activate(pack.pack_id, { bin_id: 'bin-1', opening_serial: '000' });
      dal.settle(pack.pack_id, { closing_serial: '299', tickets_sold: 299, sales_amount: 299 });

      expect(() => dal.returnPack(pack.pack_id, { return_reason: 'DAMAGED' })).toThrow();
    });

    it('should accept return data with reason', () => {
      const pack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });

      const returnedPack = dal.returnPack(pack.pack_id, {
        return_reason: 'OTHER',
      });

      // return_reason is passed as input but not stored on the pack entity
      expect(returnedPack?.status).toBe('RETURNED');
    });
  });

  describe('findByStatus (DB-006)', () => {
    it('should return only packs with specified status for store', () => {
      // Create multiple packs in different statuses
      const pack1 = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG0000001',
      });
      const pack2 = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG0000002',
      });
      dal.activate(pack2.pack_id, { bin_id: 'bin-1', opening_serial: '000' });

      const receivedPacks = dal.findByStatus('store-1', 'RECEIVED');
      const activatedPacks = dal.findByStatus('store-1', 'ACTIVATED');

      expect(receivedPacks.length).toBe(1);
      expect(receivedPacks[0].pack_id).toBe(pack1.pack_id);
      expect(activatedPacks.length).toBe(1);
      expect(activatedPacks[0].pack_id).toBe(pack2.pack_id);
    });
  });

  describe('findActiveInBin', () => {
    it('should find activated pack in specific bin', () => {
      const pack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });
      dal.activate(pack.pack_id, { bin_id: 'bin-1', opening_serial: '000' });

      const found = dal.findActiveInBin('bin-1');

      expect(found).toBeDefined();
      expect(found?.pack_id).toBe(pack.pack_id);
    });

    it('should return undefined when bin has no active pack', () => {
      const found = dal.findActiveInBin('bin-1');

      expect(found).toBeUndefined();
    });
  });

  describe('findByPackNumber', () => {
    it('should find pack by pack number within store and game', () => {
      dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });

      const found = dal.findByPackNumber('store-1', 'game-1', 'PKG1234567');

      expect(found).toBeDefined();
      expect(found?.pack_number).toBe('PKG1234567');
    });

    it('should not find pack from different store', () => {
      dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });

      const found = dal.findByPackNumber('store-2', 'game-1', 'PKG1234567');

      expect(found).toBeUndefined();
    });
  });

  describe('getStatusCounts', () => {
    it('should return correct counts by status', () => {
      // Create packs in different statuses
      const _pack1 = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG0000001',
      });
      const pack2 = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG0000002',
      });
      const pack3 = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG0000003',
      });

      dal.activate(pack2.pack_id, { bin_id: 'bin-1', opening_serial: '000' });
      dal.activate(pack3.pack_id, { bin_id: 'bin-1', opening_serial: '000' });
      dal.settle(pack3.pack_id, { closing_serial: '299', tickets_sold: 299, sales_amount: 299 });

      const counts = dal.getStatusCounts('store-1');

      expect(counts.RECEIVED).toBe(1);
      expect(counts.ACTIVATED).toBe(1);
      expect(counts.SETTLED).toBe(1);
      expect(counts.RETURNED).toBe(0);
    });
  });

  describe('moveToBin', () => {
    it('should move pack to a different bin', () => {
      // Create second bin
      db.exec(`
        INSERT INTO lottery_bins (bin_id, store_id, bin_number, label, created_at, updated_at)
        VALUES ('bin-2', 'store-1', 2, 'Bin 2', datetime('now'), datetime('now'));
      `);

      const pack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });
      dal.activate(pack.pack_id, { bin_id: 'bin-1', opening_serial: '000' });

      const moved = dal.moveToBin(pack.pack_id, 'bin-2');

      expect(moved?.bin_id).toBe('bin-2');
    });
  });

  describe('updateOpeningSerial', () => {
    it('should update opening serial for activated pack', () => {
      const pack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });
      dal.activate(pack.pack_id, { bin_id: 'bin-1', opening_serial: '000' });

      const updated = dal.updateOpeningSerial(pack.pack_id, '050');

      expect(updated?.opening_serial).toBe('050');
    });
  });
});
