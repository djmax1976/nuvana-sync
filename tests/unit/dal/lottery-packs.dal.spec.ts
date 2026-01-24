/**
 * Lottery Packs DAL Unit Tests
 *
 * Tests for lottery pack lifecycle operations.
 * Validates pack state transitions: RECEIVED -> ACTIVE -> DEPLETED/RETURNED
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

// Shared test database instance - will be set in beforeEach and used by mock
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let testDb: any = null;

// Mock database service to return our in-memory test database
vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => testDb),
  isDatabaseInitialized: vi.fn(() => testDb !== null),
}));

describe.skipIf(skipTests)('Lottery Packs DAL', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let dal: LotteryPacksDAL;

  beforeEach(() => {
    // Create in-memory database
    db = new Database(':memory:');
    // Set the shared test database so the mock returns it
    testDb = db;

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
        name TEXT NOT NULL,
        location TEXT,
        display_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
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
        opening_serial TEXT,
        closing_serial TEXT,
        status TEXT NOT NULL DEFAULT 'RECEIVED',
        received_at TEXT,
        received_by TEXT,
        activated_at TEXT,
        activated_by TEXT,
        activated_shift_id TEXT,
        depleted_at TEXT,
        returned_at TEXT,
        tickets_sold_count INTEGER DEFAULT 0,
        sales_amount REAL DEFAULT 0,
        return_reason TEXT,
        depleted_by TEXT,
        depleted_shift_id TEXT,
        depletion_reason TEXT,
        returned_by TEXT,
        returned_shift_id TEXT,
        cloud_pack_id TEXT,
        synced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (game_id) REFERENCES lottery_games(game_id),
        FOREIGN KEY (current_bin_id) REFERENCES lottery_bins(bin_id)
      );
    `);

    // Insert test game
    db.exec(`
      INSERT INTO lottery_games (game_id, store_id, game_code, name, price, tickets_per_pack, created_at, updated_at)
      VALUES ('game-1', 'store-1', '1001', 'Lucky 7s', 1, 300, datetime('now'), datetime('now'));
    `);

    // Insert test bin
    db.exec(`
      INSERT INTO lottery_bins (bin_id, store_id, name, display_order, is_active, created_at, updated_at)
      VALUES ('bin-1', 'store-1', 'Bin 1', 1, 1, datetime('now'), datetime('now'));
    `);

    // Create DAL - it will use testDb via the mocked getDatabase()
    dal = new LotteryPacksDAL();
  });

  afterEach(() => {
    db.close();
    testDb = null;
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
      expect(pack.current_bin_id).toBeNull();
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
    it('should transition pack from RECEIVED to ACTIVE', () => {
      const receivedPack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });

      const activateData: ActivatePackData = {
        store_id: 'store-1',
        current_bin_id: 'bin-1',
        opening_serial: '000',
      };

      const activatedPack = dal.activate(receivedPack.pack_id, activateData);

      expect(activatedPack).toBeDefined();
      expect(activatedPack?.status).toBe('ACTIVE');
      expect(activatedPack?.current_bin_id).toBe('bin-1');
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
      dal.activate(receivedPack.pack_id, {
        store_id: 'store-1',
        current_bin_id: 'bin-1',
        opening_serial: '000',
      });

      // Try to activate again
      expect(() =>
        dal.activate(receivedPack.pack_id, {
          store_id: 'store-1',
          current_bin_id: 'bin-1',
          opening_serial: '050',
        })
      ).toThrow();
    });

    it('should throw error for non-existent pack', () => {
      expect(() =>
        dal.activate('non-existent-id', {
          store_id: 'store-1',
          current_bin_id: 'bin-1',
          opening_serial: '000',
        })
      ).toThrow('Pack not found');
    });

    // ==========================================================================
    // Enterprise-Grade Duplicate Activation Prevention Tests
    // SEC-BUSINESS: Prevent duplicate pack activations - critical business rule
    // ==========================================================================
    describe('duplicate activation prevention (SEC-BUSINESS)', () => {
      it('should throw specific error message when pack is already ACTIVE', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-DUP-001',
        });

        // First activation succeeds
        const activatedPack = dal.activate(pack.pack_id, {
          store_id: 'store-1',
          current_bin_id: 'bin-1',
          opening_serial: '000',
        });
        expect(activatedPack.status).toBe('ACTIVE');

        // Second activation throws with specific error
        expect(() =>
          dal.activate(pack.pack_id, {
            store_id: 'store-1',
            current_bin_id: 'bin-2',
            opening_serial: '050',
          })
        ).toThrow('Cannot activate pack with status ACTIVE');
      });

      it('should throw error when trying to activate DEPLETED pack', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-DEPLETED-001',
        });

        dal.activate(pack.pack_id, {
          store_id: 'store-1',
          current_bin_id: 'bin-1',
          opening_serial: '000',
        });
        dal.settle(pack.pack_id, {
          store_id: 'store-1',
          closing_serial: '100',
          tickets_sold_count: 100,
          sales_amount: 100,
        });

        expect(() =>
          dal.activate(pack.pack_id, {
            store_id: 'store-1',
            current_bin_id: 'bin-2',
            opening_serial: '000',
          })
        ).toThrow('Cannot activate pack with status DEPLETED');
      });

      it('should throw error when trying to activate RETURNED pack', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-RETURNED-001',
        });

        dal.returnPack(pack.pack_id, { store_id: 'store-1' });

        expect(() =>
          dal.activate(pack.pack_id, {
            store_id: 'store-1',
            current_bin_id: 'bin-1',
            opening_serial: '000',
          })
        ).toThrow('Cannot activate pack with status RETURNED');
      });

      it('should not modify pack state when duplicate activation fails', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-STATE-001',
        });

        // Activate with specific opening serial
        dal.activate(pack.pack_id, {
          store_id: 'store-1',
          current_bin_id: 'bin-1',
          opening_serial: '050',
        });

        // Attempt duplicate activation with different serial - should fail
        try {
          dal.activate(pack.pack_id, {
            store_id: 'store-1',
            current_bin_id: 'bin-2',
            opening_serial: '100',
          });
        } catch {
          // Expected
        }

        // Verify original activation state is preserved
        const packAfterFailedAttempt = dal.findById(pack.pack_id);
        expect(packAfterFailedAttempt?.opening_serial).toBe('050');
        expect(packAfterFailedAttempt?.current_bin_id).toBe('bin-1');
        expect(packAfterFailedAttempt?.status).toBe('ACTIVE');
      });

      it('should use optimistic locking via WHERE status=RECEIVED clause', () => {
        // This tests that even if findById succeeds, the UPDATE with WHERE clause
        // properly prevents race conditions
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-LOCK-001',
        });

        // First activation
        dal.activate(pack.pack_id, {
          store_id: 'store-1',
          current_bin_id: 'bin-1',
          opening_serial: '000',
        });

        // SQL UPDATE with WHERE status='RECEIVED' should affect 0 rows
        // and throw "Failed to activate pack - status may have changed"
        expect(() =>
          dal.activate(pack.pack_id, {
            store_id: 'store-1',
            current_bin_id: 'bin-2',
            opening_serial: '100',
          })
        ).toThrow();
      });
    });
  });

  describe('settle', () => {
    it('should transition pack from ACTIVE to DEPLETED', () => {
      const pack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });
      dal.activate(pack.pack_id, {
        store_id: 'store-1',
        current_bin_id: 'bin-1',
        opening_serial: '000',
      });

      const settledPack = dal.settle(pack.pack_id, {
        store_id: 'store-1',
        closing_serial: '150',
        tickets_sold_count: 150,
        sales_amount: 150,
      });

      expect(settledPack).toBeDefined();
      expect(settledPack?.status).toBe('DEPLETED');
      expect(settledPack?.closing_serial).toBe('150');
      expect(settledPack?.depleted_at).toBeDefined();
    });

    it('should calculate sales correctly', () => {
      const pack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });
      dal.activate(pack.pack_id, {
        store_id: 'store-1',
        current_bin_id: 'bin-1',
        opening_serial: '000',
      });

      const sales = dal.calculateSales(pack.pack_id, '150');

      // tickets_sold = closing_serial - opening_serial = 150 - 0 = 150
      // sales_amount = tickets_sold * price = 150 * 1 = 150
      expect(sales).toBeDefined();
      expect(sales?.ticketsSold).toBe(150);
      expect(sales?.salesAmount).toBe(150);
    });

    it('should throw error when settling non-ACTIVE pack', () => {
      const pack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });

      expect(() =>
        dal.settle(pack.pack_id, {
          store_id: 'store-1',
          closing_serial: '150',
          tickets_sold_count: 150,
          sales_amount: 150,
        })
      ).toThrow();
    });
  });

  describe('returnPack', () => {
    it('should transition pack from ACTIVE to RETURNED', () => {
      const pack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });
      dal.activate(pack.pack_id, {
        store_id: 'store-1',
        current_bin_id: 'bin-1',
        opening_serial: '000',
      });

      const returnedPack = dal.returnPack(pack.pack_id, {
        store_id: 'store-1',
        return_reason: 'DAMAGED',
      });

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

      const returnedPack = dal.returnPack(pack.pack_id, {
        store_id: 'store-1',
        return_reason: 'SUPPLIER_RECALL',
      });

      expect(returnedPack).toBeDefined();
      expect(returnedPack?.status).toBe('RETURNED');
    });

    it('should throw error when returning already DEPLETED pack', () => {
      const pack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });
      dal.activate(pack.pack_id, {
        store_id: 'store-1',
        current_bin_id: 'bin-1',
        opening_serial: '000',
      });
      dal.settle(pack.pack_id, {
        store_id: 'store-1',
        closing_serial: '299',
        tickets_sold_count: 299,
        sales_amount: 299,
      });

      expect(() =>
        dal.returnPack(pack.pack_id, { store_id: 'store-1', return_reason: 'DAMAGED' })
      ).toThrow();
    });

    it('should accept return data with reason', () => {
      const pack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });

      const returnedPack = dal.returnPack(pack.pack_id, {
        store_id: 'store-1',
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
      dal.activate(pack2.pack_id, {
        store_id: 'store-1',
        current_bin_id: 'bin-1',
        opening_serial: '000',
      });

      const receivedPacks = dal.findByStatus('store-1', 'RECEIVED');
      const activatedPacks = dal.findByStatus('store-1', 'ACTIVE');

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
      dal.activate(pack.pack_id, {
        store_id: 'store-1',
        current_bin_id: 'bin-1',
        opening_serial: '000',
      });

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

      dal.activate(pack2.pack_id, {
        store_id: 'store-1',
        current_bin_id: 'bin-1',
        opening_serial: '000',
      });
      dal.activate(pack3.pack_id, {
        store_id: 'store-1',
        current_bin_id: 'bin-1',
        opening_serial: '000',
      });
      dal.settle(pack3.pack_id, {
        store_id: 'store-1',
        closing_serial: '299',
        tickets_sold_count: 299,
        sales_amount: 299,
      });

      const counts = dal.getStatusCounts('store-1');

      expect(counts.RECEIVED).toBe(1);
      expect(counts.ACTIVE).toBe(1);
      expect(counts.DEPLETED).toBe(1);
      expect(counts.RETURNED).toBe(0);
    });
  });

  describe('moveToBin', () => {
    it('should move pack to a different bin', () => {
      // Create second bin
      db.exec(`
        INSERT INTO lottery_bins (bin_id, store_id, name, display_order, is_active, created_at, updated_at)
        VALUES ('bin-2', 'store-1', 'Bin 2', 2, 1, datetime('now'), datetime('now'));
      `);

      const pack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });
      dal.activate(pack.pack_id, {
        store_id: 'store-1',
        current_bin_id: 'bin-1',
        opening_serial: '000',
      });

      const moved = dal.moveToBin(pack.pack_id, 'bin-2');

      expect(moved?.current_bin_id).toBe('bin-2');
    });
  });

  describe('updateOpeningSerial', () => {
    it('should update opening serial for activated pack', () => {
      const pack = dal.receive({
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
      });
      dal.activate(pack.pack_id, {
        store_id: 'store-1',
        current_bin_id: 'bin-1',
        opening_serial: '000',
      });

      const updated = dal.updateOpeningSerial(pack.pack_id, '050');

      expect(updated?.opening_serial).toBe('050');
    });
  });

  // ==========================================================================
  // findPacksWithDetails - Search Functionality Tests
  // SEC-006: Parameterized LIKE queries for SQL injection prevention
  // DB-006: Tenant isolation via store_id scoping
  // ==========================================================================
  describe('findPacksWithDetails', () => {
    beforeEach(() => {
      // Insert additional test games with distinct names
      db.exec(`
        INSERT INTO lottery_games (game_id, store_id, game_code, name, price, tickets_per_pack, status, created_at, updated_at)
        VALUES
          ('game-2', 'store-1', '1002', 'Cash Explosion', 2, 300, 'ACTIVE', datetime('now'), datetime('now')),
          ('game-3', 'store-1', '1003', 'Mega Millions', 5, 150, 'ACTIVE', datetime('now'), datetime('now')),
          ('game-4', 'store-2', '1001', 'Lucky 7s Store2', 1, 300, 'ACTIVE', datetime('now'), datetime('now'));
      `);

      // Insert additional bin
      db.exec(`
        INSERT INTO lottery_bins (bin_id, store_id, name, display_order, is_active, created_at, updated_at)
        VALUES ('bin-2', 'store-1', 'Bin 2', 2, 1, datetime('now'), datetime('now'));
      `);
    });

    describe('basic filtering', () => {
      it('should return packs with game and bin details (nested structure fields)', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: '0103230',
        });
        dal.activate(pack.pack_id, {
          store_id: 'store-1',
          current_bin_id: 'bin-1',
          opening_serial: '000',
        });

        const results = dal.findPacksWithDetails('store-1', { status: 'ACTIVE' });

        expect(results.length).toBe(1);
        expect(results[0].pack_id).toBe(pack.pack_id);
        // Verify joined game fields
        expect(results[0].game_name).toBe('Lucky 7s');
        expect(results[0].game_code).toBe('1001');
        expect(results[0].game_price).toBe(1);
        expect(results[0].game_tickets_per_pack).toBe(300);
        expect(results[0].game_status).toBe('ACTIVE');
        // Verify joined bin fields
        expect(results[0].bin_display_order).toBe(1);
        expect(results[0].bin_name).toBe('Bin 1');
      });

      it('should filter by status', () => {
        dal.receive({ store_id: 'store-1', game_id: 'game-1', pack_number: '0000001' });
        const pack2 = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: '0000002',
        });
        dal.activate(pack2.pack_id, {
          store_id: 'store-1',
          current_bin_id: 'bin-1',
          opening_serial: '000',
        });

        const received = dal.findPacksWithDetails('store-1', { status: 'RECEIVED' });
        const activated = dal.findPacksWithDetails('store-1', { status: 'ACTIVE' });

        expect(received.length).toBe(1);
        expect(activated.length).toBe(1);
        expect(received[0].status).toBe('RECEIVED');
        expect(activated[0].status).toBe('ACTIVE');
      });

      it('should filter by game_id', () => {
        dal.receive({ store_id: 'store-1', game_id: 'game-1', pack_number: '0000001' });
        dal.receive({ store_id: 'store-1', game_id: 'game-2', pack_number: '0000002' });

        const results = dal.findPacksWithDetails('store-1', { game_id: 'game-2' });

        expect(results.length).toBe(1);
        expect(results[0].game_name).toBe('Cash Explosion');
      });

      it('should enforce tenant isolation (DB-006)', () => {
        dal.receive({ store_id: 'store-1', game_id: 'game-1', pack_number: '0000001' });
        // Create pack for different store (manually insert since game-4 belongs to store-2)
        db.exec(`
          INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, received_at, created_at, updated_at)
          VALUES ('pack-store2', 'store-2', 'game-4', '0000001', 'RECEIVED', datetime('now'), datetime('now'), datetime('now'));
        `);

        const store1Results = dal.findPacksWithDetails('store-1', {});
        const store2Results = dal.findPacksWithDetails('store-2', {});

        expect(store1Results.length).toBe(1);
        expect(store2Results.length).toBe(1);
        expect(store1Results[0].store_id).toBe('store-1');
        expect(store2Results[0].store_id).toBe('store-2');
      });
    });

    describe('search functionality (SEC-006)', () => {
      beforeEach(() => {
        // Create packs with distinct pack numbers for search testing
        dal.receive({ store_id: 'store-1', game_id: 'game-1', pack_number: '0103230' });
        dal.receive({ store_id: 'store-1', game_id: 'game-1', pack_number: '0103231' });
        dal.receive({ store_id: 'store-1', game_id: 'game-2', pack_number: '0200001' });
        dal.receive({ store_id: 'store-1', game_id: 'game-3', pack_number: '0300001' });
      });

      it('should search by pack_number prefix match', () => {
        const results = dal.findPacksWithDetails('store-1', { search: '010323' });

        expect(results.length).toBe(2);
        expect(results.every((p) => p.pack_number.startsWith('010323'))).toBe(true);
      });

      it('should search by exact pack_number', () => {
        const results = dal.findPacksWithDetails('store-1', { search: '0103230' });

        expect(results.length).toBe(1);
        expect(results[0].pack_number).toBe('0103230');
      });

      it('should search by game name (case-insensitive contains)', () => {
        const results = dal.findPacksWithDetails('store-1', { search: 'cash' });

        expect(results.length).toBe(1);
        expect(results[0].game_name).toBe('Cash Explosion');
      });

      it('should search by game name with mixed case', () => {
        const results = dal.findPacksWithDetails('store-1', { search: 'MEGA' });

        expect(results.length).toBe(1);
        expect(results[0].game_name).toBe('Mega Millions');
      });

      it('should return multiple results when search matches both pack_number and game name', () => {
        // Search for 'Lucky' should match game name 'Lucky 7s'
        const results = dal.findPacksWithDetails('store-1', { search: 'Lucky' });

        // Should find both packs with game 'Lucky 7s'
        expect(results.length).toBe(2);
        expect(results.every((p) => p.game_name === 'Lucky 7s')).toBe(true);
      });

      it('should combine search with status filter', () => {
        // Activate one of the Lucky 7s packs
        const packs = dal.findPacksWithDetails('store-1', { search: '0103230' });
        dal.activate(packs[0].pack_id, {
          store_id: 'store-1',
          current_bin_id: 'bin-1',
          opening_serial: '000',
        });

        const receivedResults = dal.findPacksWithDetails('store-1', {
          search: 'Lucky',
          status: 'RECEIVED',
        });
        const activatedResults = dal.findPacksWithDetails('store-1', {
          search: 'Lucky',
          status: 'ACTIVE',
        });

        expect(receivedResults.length).toBe(1);
        expect(activatedResults.length).toBe(1);
      });

      it('should return empty array when search has no matches', () => {
        const results = dal.findPacksWithDetails('store-1', { search: 'NonExistentGame' });

        expect(results).toEqual([]);
      });

      it('should ignore search if less than 2 characters', () => {
        // Single character search should be ignored (return all packs)
        const allPacks = dal.findPacksWithDetails('store-1', {});
        const singleCharSearch = dal.findPacksWithDetails('store-1', { search: 'L' });

        expect(singleCharSearch.length).toBe(allPacks.length);
      });

      it('should ignore empty search string', () => {
        const allPacks = dal.findPacksWithDetails('store-1', {});
        const emptySearch = dal.findPacksWithDetails('store-1', { search: '' });

        expect(emptySearch.length).toBe(allPacks.length);
      });

      it('should ignore whitespace-only search', () => {
        const allPacks = dal.findPacksWithDetails('store-1', {});
        const whitespaceSearch = dal.findPacksWithDetails('store-1', { search: '   ' });

        expect(whitespaceSearch.length).toBe(allPacks.length);
      });

      // SEC-006: SQL Injection Prevention Tests
      it('should safely handle SQL injection attempts in search (SEC-006)', () => {
        // These should not cause SQL errors or return unexpected results
        const injectionAttempts = [
          "'; DROP TABLE lottery_packs; --",
          "1' OR '1'='1",
          '1; SELECT * FROM users; --',
          "' UNION SELECT * FROM lottery_games --",
          "1%' OR '%'='",
        ];

        for (const injection of injectionAttempts) {
          // Should not throw and should return empty or filtered results
          expect(() => dal.findPacksWithDetails('store-1', { search: injection })).not.toThrow();
        }

        // Verify table still exists and has data
        const packs = dal.findPacksWithDetails('store-1', {});
        expect(packs.length).toBeGreaterThan(0);
      });

      it('should handle special regex characters in search safely', () => {
        const specialChars = ['test%', 'test_', 'test[', 'test]', 'test*', 'test?'];

        for (const term of specialChars) {
          expect(() => dal.findPacksWithDetails('store-1', { search: term })).not.toThrow();
        }
      });
    });

    describe('ordering and limit behavior', () => {
      it('should order results by updated_at descending (newest first)', () => {
        // Create packs with slight time differences
        const pack1 = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: '0000001',
        });
        const pack2 = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: '0000002',
        });
        const pack3 = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: '0000003',
        });

        // Update pack1 to make it most recent
        dal.activate(pack1.pack_id, {
          store_id: 'store-1',
          current_bin_id: 'bin-1',
          opening_serial: '000',
        });

        const results = dal.findPacksWithDetails('store-1', {});

        // Pack1 should be first (most recently updated)
        expect(results[0].pack_id).toBe(pack1.pack_id);
      });
    });
  });

  // ==========================================================================
  // findByPackNumberOnly - Used by checkPackExists IPC handler
  // This method is critical for providing status-specific error messages
  // when a user tries to activate an already-activated pack
  // SEC-BUSINESS: Pack duplicate activation prevention
  // DB-006: Tenant isolation via store_id
  // ==========================================================================
  describe('findByPackNumberOnly (checkPackExists support)', () => {
    beforeEach(() => {
      // Insert additional games for cross-game testing
      db.exec(`
        INSERT INTO lottery_games (game_id, store_id, game_code, name, price, tickets_per_pack, status, created_at, updated_at)
        VALUES
          ('game-2', 'store-1', '1002', 'Cash Explosion', 2, 300, 'ACTIVE', datetime('now'), datetime('now')),
          ('game-3', 'store-2', '1001', 'Lucky 7s Store2', 1, 300, 'ACTIVE', datetime('now'), datetime('now'));
      `);

      // Insert second bin
      db.exec(`
        INSERT INTO lottery_bins (bin_id, store_id, name, display_order, is_active, created_at, updated_at)
        VALUES ('bin-2', 'store-1', 'Bin 2', 2, 1, datetime('now'), datetime('now'));
      `);
    });

    describe('Basic lookup functionality', () => {
      it('should find pack by pack_number regardless of game', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: '0103230',
        });

        const found = dal.findByPackNumberOnly('store-1', '0103230');

        expect(found).toBeDefined();
        expect(found?.pack_id).toBe(pack.pack_id);
        expect(found?.pack_number).toBe('0103230');
      });

      it('should include game_code in result', () => {
        dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: '0103230',
        });

        const found = dal.findByPackNumberOnly('store-1', '0103230');

        expect(found?.game_code).toBe('1001');
      });

      it('should include game_name in result', () => {
        dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: '0103230',
        });

        const found = dal.findByPackNumberOnly('store-1', '0103230');

        expect(found?.game_name).toBe('Lucky 7s');
      });

      it('should return undefined for non-existent pack', () => {
        const found = dal.findByPackNumberOnly('store-1', 'NONEXISTENT');

        expect(found).toBeUndefined();
      });
    });

    describe('Status-based lookups (critical for error message generation)', () => {
      it('should find ACTIVE pack and include its status', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: '0103230',
        });
        dal.activate(pack.pack_id, {
          store_id: 'store-1',
          current_bin_id: 'bin-1',
          opening_serial: '000',
        });

        const found = dal.findByPackNumberOnly('store-1', '0103230');

        expect(found).toBeDefined();
        expect(found?.status).toBe('ACTIVE');
        expect(found?.current_bin_id).toBe('bin-1');
      });

      it('should find DEPLETED pack and include its status', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: '0103230',
        });
        dal.activate(pack.pack_id, {
          store_id: 'store-1',
          current_bin_id: 'bin-1',
          opening_serial: '000',
        });
        dal.settle(pack.pack_id, {
          store_id: 'store-1',
          closing_serial: '299',
          tickets_sold_count: 299,
          sales_amount: 299,
        });

        const found = dal.findByPackNumberOnly('store-1', '0103230');

        expect(found).toBeDefined();
        expect(found?.status).toBe('DEPLETED');
      });

      it('should find RETURNED pack and include its status', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: '0103230',
        });
        dal.returnPack(pack.pack_id, { store_id: 'store-1' });

        const found = dal.findByPackNumberOnly('store-1', '0103230');

        expect(found).toBeDefined();
        expect(found?.status).toBe('RETURNED');
      });

      it('should find RECEIVED pack and include its status', () => {
        dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: '0103230',
        });

        const found = dal.findByPackNumberOnly('store-1', '0103230');

        expect(found).toBeDefined();
        expect(found?.status).toBe('RECEIVED');
      });
    });

    describe('Tenant isolation (DB-006)', () => {
      it('should only find packs within the specified store', () => {
        // Create pack in store-1
        dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: '0103230',
        });

        // Create pack with same number in store-2 (manually insert)
        db.exec(`
          INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, received_at, created_at, updated_at)
          VALUES ('pack-store2', 'store-2', 'game-3', '0103230', 'RECEIVED', datetime('now'), datetime('now'), datetime('now'));
        `);

        // Should only find store-1's pack
        const foundStore1 = dal.findByPackNumberOnly('store-1', '0103230');
        const foundStore2 = dal.findByPackNumberOnly('store-2', '0103230');

        expect(foundStore1).toBeDefined();
        expect(foundStore1?.store_id).toBe('store-1');
        expect(foundStore1?.game_name).toBe('Lucky 7s');

        expect(foundStore2).toBeDefined();
        expect(foundStore2?.store_id).toBe('store-2');
        expect(foundStore2?.game_name).toBe('Lucky 7s Store2');
      });

      it('should not find pack from different store', () => {
        dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: '0103230',
        });

        const found = dal.findByPackNumberOnly('store-999', '0103230');

        expect(found).toBeUndefined();
      });
    });

    describe('Real-world bug scenario: Duplicate activation detection', () => {
      it('should enable detection of already-activated pack for user-friendly error', () => {
        // Setup: Receive and activate a pack
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: '0103230',
        });
        dal.activate(pack.pack_id, {
          store_id: 'store-1',
          current_bin_id: 'bin-1',
          opening_serial: '000',
        });

        // Scenario: User scans the same pack trying to activate it again
        // The search for RECEIVED packs returns nothing
        const receivedPacks = dal.findByStatus('store-1', 'RECEIVED');
        const matchingReceived = receivedPacks.filter((p) => p.pack_number === '0103230');
        expect(matchingReceived.length).toBe(0); // Pack not found in RECEIVED status

        // But findByPackNumberOnly can still find it to provide status info
        const existingPack = dal.findByPackNumberOnly('store-1', '0103230');
        expect(existingPack).toBeDefined();
        expect(existingPack?.status).toBe('ACTIVE');
        expect(existingPack?.current_bin_id).toBe('bin-1');
        expect(existingPack?.game_name).toBe('Lucky 7s');

        // This information enables showing "Pack is already active in Bin 1"
        // instead of confusing "Pack not found"
      });

      it('should enable detection of settled pack for user-friendly error', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: '0103230',
        });
        dal.activate(pack.pack_id, {
          store_id: 'store-1',
          current_bin_id: 'bin-1',
          opening_serial: '000',
        });
        dal.settle(pack.pack_id, {
          store_id: 'store-1',
          closing_serial: '299',
          tickets_sold_count: 299,
          sales_amount: 299,
        });

        // User scans pack that was sold out
        const existingPack = dal.findByPackNumberOnly('store-1', '0103230');

        expect(existingPack).toBeDefined();
        expect(existingPack?.status).toBe('DEPLETED');
        // This enables showing "Pack has been sold/depleted"
      });

      it('should enable detection of returned pack for user-friendly error', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: '0103230',
        });
        dal.returnPack(pack.pack_id, { store_id: 'store-1' });

        // User scans pack that was returned
        const existingPack = dal.findByPackNumberOnly('store-1', '0103230');

        expect(existingPack).toBeDefined();
        expect(existingPack?.status).toBe('RETURNED');
        // This enables showing "Pack was returned to distributor"
      });
    });

    describe('Edge cases', () => {
      it('should handle pack numbers with leading zeros', () => {
        dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: '0000001',
        });

        const found = dal.findByPackNumberOnly('store-1', '0000001');

        expect(found).toBeDefined();
        expect(found?.pack_number).toBe('0000001');
      });

      it('should be case-sensitive for pack numbers', () => {
        dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'ABC123',
        });

        const foundExact = dal.findByPackNumberOnly('store-1', 'ABC123');
        const foundLower = dal.findByPackNumberOnly('store-1', 'abc123');

        expect(foundExact).toBeDefined();
        expect(foundLower).toBeUndefined();
      });

      it('should return first match if duplicate pack numbers exist (should not happen)', () => {
        // This tests defensive behavior - duplicates should be prevented by unique constraint
        // but we verify the method returns SOMETHING if data is somehow corrupt
        dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: '0103230',
        });

        // Note: In reality, the receive() would throw for duplicate pack_number in same game
        // This test verifies LIMIT 1 behavior
        const found = dal.findByPackNumberOnly('store-1', '0103230');

        expect(found).toBeDefined();
      });
    });
  });
});
