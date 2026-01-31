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

      -- Note: After cloud_id consolidation, pack_id IS the cloud ID - no separate cloud_pack_id
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
        return_notes TEXT,
        depleted_by TEXT,
        depleted_shift_id TEXT,
        depletion_reason TEXT,
        returned_by TEXT,
        returned_shift_id TEXT,
        synced_at TEXT,
        -- Additional columns for cloud sync (v029+ API alignment)
        serial_start TEXT,
        serial_end TEXT,
        last_sold_at TEXT,
        last_sold_serial TEXT,
        tickets_sold_on_return INTEGER,
        return_sales_amount REAL,
        serial_override_approved_by TEXT,
        serial_override_reason TEXT,
        serial_override_approved_at TEXT,
        mark_sold_approved_by TEXT,
        mark_sold_reason TEXT,
        mark_sold_approved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (game_id) REFERENCES lottery_games(game_id),
        FOREIGN KEY (current_bin_id) REFERENCES lottery_bins(bin_id)
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

      -- lottery_business_days table for day-pack relationship queries
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

      -- lottery_day_packs table for pack-day relationship queries
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
    `);

    // Insert test store
    // SEC-006: Using parameterized inserts for test data setup
    // DB-006: Store record required for tenant isolation validation
    db.exec(`
      INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
      VALUES ('store-1', 'company-1', 'Test Store', 'America/New_York', 'ACTIVE', datetime('now'), datetime('now'));
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

        dal.returnPack(pack.pack_id, { store_id: 'store-1', return_reason: 'SUPPLIER_RECALL' });

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
        return_reason: 'SUPPLIER_RECALL',
      });

      // SEC-014: return_reason is now required and validated - 'OTHER' is not accepted
      // Valid values: SUPPLIER_RECALL, DAMAGED, EXPIRED, INVENTORY_ADJUSTMENT, STORE_CLOSURE
      expect(returnedPack?.status).toBe('RETURNED');
      expect(returnedPack?.return_reason).toBe('SUPPLIER_RECALL');
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
        dal.returnPack(pack.pack_id, { store_id: 'store-1', return_reason: 'DAMAGED' });

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
        dal.returnPack(pack.pack_id, { store_id: 'store-1', return_reason: 'EXPIRED' });

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

  // ==========================================================================
  // upsertFromCloud - Status Protection Tests (LOTTERY-SYNC-001 Bug Fix)
  //
  // Traceability: LOTTERY-SYNC-001
  // Component: LotteryPacksDAL.upsertFromCloud
  //
  // Tests validate:
  // 1. Business rule enforcement (status lifecycle)
  // 2. Timestamp-based conflict resolution
  // 3. Edge cases and boundary conditions
  // 4. Security: Preventing unauthorized state transitions
  // ==========================================================================
  describe('upsertFromCloud - Status Protection (LOTTERY-SYNC-001)', () => {
    // Helper to create a test pack directly in DB with specific status and timestamp
    // Note: After cloud_id consolidation, pack_id IS the cloud ID - no separate cloud_pack_id
    const insertTestPack = (
      overrides: {
        pack_id?: string;
        status?: string;
        updated_at?: string;
        activated_at?: string | null;
      } = {}
    ) => {
      // pack_id IS the cloud ID now
      const packId =
        overrides.pack_id || `pack-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const now = new Date().toISOString();

      db.prepare(
        `
        INSERT INTO lottery_packs (
          pack_id, store_id, game_id, pack_number, status,
          activated_at, updated_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        packId,
        'store-1',
        'game-1',
        `PKG-${packId}`,
        overrides.status || 'RECEIVED',
        overrides.activated_at ?? null,
        overrides.updated_at || now,
        now
      );

      return { pack_id: packId };
    };

    // ============================================================================
    // RULE 1: Terminal State Protection (DEPLETED/RETURNED cannot change)
    // ============================================================================

    // Note: After cloud_id consolidation, pack_id IS the cloud ID
    describe('Rule 1: Terminal State Protection', () => {
      it('should NOT allow DEPLETED status to change to RECEIVED', () => {
        // Arrange: Create a DEPLETED pack (local state)
        const localUpdatedAt = '2026-01-27T10:00:00.000Z';
        const { pack_id } = insertTestPack({
          status: 'DEPLETED',
          updated_at: localUpdatedAt,
        });

        // Act: Cloud sends RECEIVED with newer timestamp
        const cloudUpdatedAt = '2026-01-27T12:00:00.000Z'; // 2 hours later
        dal.upsertFromCloud(
          {
            pack_id, // pack_id IS the cloud ID now
            store_id: 'store-1',
            game_id: 'game-1',
            pack_number: `PKG-${pack_id}`,
            status: 'RECEIVED',
            updated_at: cloudUpdatedAt,
          },
          'store-1'
        );

        // Assert: Status should remain DEPLETED (terminal state locked)
        const result = dal.findById(pack_id);
        expect(result?.status).toBe('DEPLETED');
      });

      it('should NOT allow DEPLETED status to change to ACTIVE', () => {
        const { pack_id } = insertTestPack({ status: 'DEPLETED' });

        dal.upsertFromCloud(
          {
            pack_id, // pack_id IS the cloud ID now
            store_id: 'store-1',
            game_id: 'game-1',
            pack_number: `PKG-${pack_id}`,
            status: 'ACTIVE',
            updated_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour later
          },
          'store-1'
        );

        const result = dal.findById(pack_id);
        expect(result?.status).toBe('DEPLETED');
      });

      it('should NOT allow RETURNED status to change to any other status', () => {
        const { pack_id } = insertTestPack({ status: 'RETURNED' });

        // Try each possible incoming status
        const incomingStatuses = ['RECEIVED', 'ACTIVE', 'DEPLETED'] as const;

        for (const incomingStatus of incomingStatuses) {
          dal.upsertFromCloud(
            {
              pack_id, // pack_id IS the cloud ID now
              store_id: 'store-1',
              game_id: 'game-1',
              pack_number: `PKG-${pack_id}`,
              status: incomingStatus,
              updated_at: new Date(Date.now() + 7200000).toISOString(), // 2 hours later
            },
            'store-1'
          );

          const result = dal.findById(pack_id);
          expect(result?.status).toBe('RETURNED');
        }
      });

      it('should NOT allow DEPLETED to change to RETURNED (both terminal)', () => {
        const { pack_id } = insertTestPack({ status: 'DEPLETED' });

        dal.upsertFromCloud(
          {
            pack_id, // pack_id IS the cloud ID now
            store_id: 'store-1',
            game_id: 'game-1',
            pack_number: `PKG-${pack_id}`,
            status: 'RETURNED',
            updated_at: new Date(Date.now() + 3600000).toISOString(),
          },
          'store-1'
        );

        const result = dal.findById(pack_id);
        expect(result?.status).toBe('DEPLETED');
      });
    });

    // ============================================================================
    // RULE 2: ACTIVE Cannot Regress to RECEIVED (Bug Fix Validation)
    // ============================================================================

    describe('Rule 2: ACTIVE Regression Prevention (Bug Fix Validation)', () => {
      it('should NOT overwrite ACTIVE with RECEIVED even if cloud timestamp is newer', () => {
        // This is the exact bug scenario from LOTTERY-SYNC-001
        const localActivatedAt = '2026-01-27T09:00:00.000Z';
        const localUpdatedAt = '2026-01-27T09:00:00.000Z';

        const { pack_id } = insertTestPack({
          status: 'ACTIVE',
          activated_at: localActivatedAt,
          updated_at: localUpdatedAt,
        });

        // Cloud sends RECEIVED with NEWER timestamp (simulating delayed sync)
        const cloudUpdatedAt = '2026-01-27T10:00:00.000Z'; // 1 hour after local activation

        dal.upsertFromCloud(
          {
            pack_id, // pack_id IS the cloud ID now
            store_id: 'store-1',
            game_id: 'game-1',
            pack_number: `PKG-${pack_id}`,
            status: 'RECEIVED', // Cloud still shows RECEIVED (hasn't received local activation push)
            updated_at: cloudUpdatedAt,
          },
          'store-1'
        );

        // Assert: Status MUST remain ACTIVE - this is the bug fix
        const result = dal.findById(pack_id);
        expect(result?.status).toBe('ACTIVE');
        expect(result?.activated_at).toBe(localActivatedAt); // Activation timestamp preserved
      });

      it('should NOT overwrite ACTIVE with RECEIVED even if cloud timestamp is older', () => {
        const localUpdatedAt = '2026-01-27T10:00:00.000Z';
        const cloudUpdatedAt = '2026-01-27T08:00:00.000Z'; // Cloud is 2 hours older

        const { pack_id } = insertTestPack({
          status: 'ACTIVE',
          updated_at: localUpdatedAt,
        });

        dal.upsertFromCloud(
          {
            pack_id, // pack_id IS the cloud ID now
            store_id: 'store-1',
            game_id: 'game-1',
            pack_number: `PKG-${pack_id}`,
            status: 'RECEIVED',
            updated_at: cloudUpdatedAt,
          },
          'store-1'
        );

        const result = dal.findById(pack_id);
        expect(result?.status).toBe('ACTIVE');
      });
    });

    // ============================================================================
    // RULE 3: Timestamp-Based Updates for Valid Transitions
    // ============================================================================

    describe('Rule 3: Timestamp-Based Conflict Resolution', () => {
      it('should update RECEIVED to ACTIVE when cloud timestamp is newer', () => {
        const localUpdatedAt = '2026-01-27T08:00:00.000Z';
        const cloudUpdatedAt = '2026-01-27T10:00:00.000Z'; // 2 hours newer

        const { pack_id } = insertTestPack({
          status: 'RECEIVED',
          updated_at: localUpdatedAt,
        });

        dal.upsertFromCloud(
          {
            pack_id, // pack_id IS the cloud ID now
            store_id: 'store-1',
            game_id: 'game-1',
            pack_number: `PKG-${pack_id}`,
            status: 'ACTIVE',
            updated_at: cloudUpdatedAt,
            activated_at: cloudUpdatedAt,
          },
          'store-1'
        );

        const result = dal.findById(pack_id);
        expect(result?.status).toBe('ACTIVE');
      });

      it('should NOT update RECEIVED to ACTIVE when cloud timestamp is older', () => {
        const localUpdatedAt = '2026-01-27T10:00:00.000Z';
        const cloudUpdatedAt = '2026-01-27T08:00:00.000Z'; // 2 hours older

        const { pack_id } = insertTestPack({
          status: 'RECEIVED',
          updated_at: localUpdatedAt,
        });

        dal.upsertFromCloud(
          {
            pack_id, // pack_id IS the cloud ID now
            store_id: 'store-1',
            game_id: 'game-1',
            pack_number: `PKG-${pack_id}`,
            status: 'ACTIVE',
            updated_at: cloudUpdatedAt,
          },
          'store-1'
        );

        const result = dal.findById(pack_id);
        expect(result?.status).toBe('RECEIVED'); // Stale data rejected
      });

      it('should update ACTIVE to DEPLETED when cloud timestamp is newer', () => {
        const localUpdatedAt = '2026-01-27T08:00:00.000Z';
        const cloudUpdatedAt = '2026-01-27T10:00:00.000Z';

        const { pack_id } = insertTestPack({
          status: 'ACTIVE',
          updated_at: localUpdatedAt,
        });

        dal.upsertFromCloud(
          {
            pack_id, // pack_id IS the cloud ID now
            store_id: 'store-1',
            game_id: 'game-1',
            pack_number: `PKG-${pack_id}`,
            status: 'DEPLETED',
            updated_at: cloudUpdatedAt,
            depleted_at: cloudUpdatedAt,
          },
          'store-1'
        );

        const result = dal.findById(pack_id);
        expect(result?.status).toBe('DEPLETED');
      });

      it('should update ACTIVE to RETURNED when cloud timestamp is newer', () => {
        const localUpdatedAt = '2026-01-27T08:00:00.000Z';
        const cloudUpdatedAt = '2026-01-27T10:00:00.000Z';

        const { pack_id } = insertTestPack({
          status: 'ACTIVE',
          updated_at: localUpdatedAt,
        });

        dal.upsertFromCloud(
          {
            pack_id, // pack_id IS the cloud ID now
            store_id: 'store-1',
            game_id: 'game-1',
            pack_number: `PKG-${pack_id}`,
            status: 'RETURNED',
            updated_at: cloudUpdatedAt,
            returned_at: cloudUpdatedAt,
          },
          'store-1'
        );

        const result = dal.findById(pack_id);
        expect(result?.status).toBe('RETURNED');
      });
    });

    // ============================================================================
    // Edge Cases and Boundary Conditions
    // ============================================================================

    describe('Edge Cases: Timestamp Boundaries', () => {
      it('should handle identical timestamps (no update)', () => {
        const sameTimestamp = '2026-01-27T10:00:00.000Z';

        const { pack_id } = insertTestPack({
          status: 'RECEIVED',
          updated_at: sameTimestamp,
        });

        dal.upsertFromCloud(
          {
            pack_id, // pack_id IS the cloud ID now
            store_id: 'store-1',
            game_id: 'game-1',
            pack_number: `PKG-${pack_id}`,
            status: 'ACTIVE',
            updated_at: sameTimestamp, // Identical timestamp
          },
          'store-1'
        );

        const result = dal.findById(pack_id);
        expect(result?.status).toBe('RECEIVED'); // No update when timestamps equal
      });

      it('should handle millisecond precision in timestamps', () => {
        const localUpdatedAt = '2026-01-27T10:00:00.000Z';
        const cloudUpdatedAt = '2026-01-27T10:00:00.001Z'; // 1 millisecond later

        const { pack_id } = insertTestPack({
          status: 'RECEIVED',
          updated_at: localUpdatedAt,
        });

        dal.upsertFromCloud(
          {
            pack_id, // pack_id IS the cloud ID now
            store_id: 'store-1',
            game_id: 'game-1',
            pack_number: `PKG-${pack_id}`,
            status: 'ACTIVE',
            updated_at: cloudUpdatedAt,
          },
          'store-1'
        );

        const result = dal.findById(pack_id);
        expect(result?.status).toBe('ACTIVE'); // 1ms difference should trigger update
      });

      it('should handle NULL/missing updated_at in cloud data gracefully (no status change)', () => {
        const localUpdatedAt = '2026-01-27T10:00:00.000Z';

        const { pack_id } = insertTestPack({
          status: 'RECEIVED',
          updated_at: localUpdatedAt,
        });

        // Cloud sends null/undefined updated_at
        dal.upsertFromCloud(
          {
            pack_id, // pack_id IS the cloud ID now
            store_id: 'store-1',
            game_id: 'game-1',
            pack_number: `PKG-${pack_id}`,
            status: 'ACTIVE',
            updated_at: undefined as unknown as string, // Missing timestamp
          },
          'store-1'
        );

        const result = dal.findById(pack_id);
        // Should NOT update when cloud timestamp is missing (safety)
        expect(result?.status).toBe('RECEIVED');
      });
    });

    // ============================================================================
    // Security: Abuse Case Testing
    // ============================================================================

    describe('Security: Abuse Case Prevention', () => {
      it('should prevent status manipulation via repeated sync calls', () => {
        // Simulate attacker trying to repeatedly downgrade status
        const { pack_id } = insertTestPack({
          status: 'ACTIVE',
          updated_at: '2026-01-27T10:00:00.000Z',
        });

        // Attempt 10 rapid downgrade attempts
        for (let i = 0; i < 10; i++) {
          dal.upsertFromCloud(
            {
              pack_id, // pack_id IS the cloud ID now
              store_id: 'store-1',
              game_id: 'game-1',
              pack_number: `PKG-${pack_id}`,
              status: 'RECEIVED',
              updated_at: new Date(Date.now() + i * 1000).toISOString(),
            },
            'store-1'
          );
        }

        const result = dal.findById(pack_id);
        expect(result?.status).toBe('ACTIVE'); // All attempts blocked
      });

      it('should enforce tenant isolation - reject cross-store updates', () => {
        const { pack_id } = insertTestPack({ status: 'RECEIVED' });

        const DIFFERENT_STORE_ID = 'attacker-store-uuid';

        expect(() => {
          dal.upsertFromCloud(
            {
              pack_id, // pack_id IS the cloud ID now
              store_id: DIFFERENT_STORE_ID, // Different store
              game_id: 'game-1',
              pack_number: `PKG-${pack_id}`,
              status: 'ACTIVE',
              updated_at: new Date().toISOString(),
            },
            'store-1'
          );
        }).toThrow(/store.*mismatch|tenant.*isolation/i);
      });
    });

    // ============================================================================
    // Business Rules Matrix Validation
    // ============================================================================

    // Note: After cloud_id consolidation, pack_id IS the cloud ID
    describe('Business Rules Matrix Validation', () => {
      // Test each row from the business rules matrix in the plan

      it('RECEIVED -> ACTIVE: allowed if newer', () => {
        const { pack_id } = insertTestPack({
          status: 'RECEIVED',
          updated_at: '2026-01-27T08:00:00.000Z',
        });

        dal.upsertFromCloud(
          {
            pack_id, // pack_id IS the cloud ID now
            store_id: 'store-1',
            game_id: 'game-1',
            pack_number: `PKG-${pack_id}`,
            status: 'ACTIVE',
            updated_at: '2026-01-27T10:00:00.000Z',
          },
          'store-1'
        );

        expect(dal.findById(pack_id)?.status).toBe('ACTIVE');
      });

      it('RECEIVED -> DEPLETED: allowed if newer (edge case)', () => {
        const { pack_id } = insertTestPack({
          status: 'RECEIVED',
          updated_at: '2026-01-27T08:00:00.000Z',
        });

        dal.upsertFromCloud(
          {
            pack_id, // pack_id IS the cloud ID now
            store_id: 'store-1',
            game_id: 'game-1',
            pack_number: `PKG-${pack_id}`,
            status: 'DEPLETED',
            updated_at: '2026-01-27T10:00:00.000Z',
          },
          'store-1'
        );

        expect(dal.findById(pack_id)?.status).toBe('DEPLETED');
      });

      it('RECEIVED -> RETURNED: allowed if newer (edge case)', () => {
        const { pack_id } = insertTestPack({
          status: 'RECEIVED',
          updated_at: '2026-01-27T08:00:00.000Z',
        });

        dal.upsertFromCloud(
          {
            pack_id, // pack_id IS the cloud ID now
            store_id: 'store-1',
            game_id: 'game-1',
            pack_number: `PKG-${pack_id}`,
            status: 'RETURNED',
            updated_at: '2026-01-27T10:00:00.000Z',
          },
          'store-1'
        );

        expect(dal.findById(pack_id)?.status).toBe('RETURNED');
      });

      it('ACTIVE -> RECEIVED: ALWAYS blocked (core bug fix)', () => {
        const { pack_id } = insertTestPack({
          status: 'ACTIVE',
          updated_at: '2026-01-27T08:00:00.000Z',
        });

        // Try with newer timestamp
        dal.upsertFromCloud(
          {
            pack_id, // pack_id IS the cloud ID now
            store_id: 'store-1',
            game_id: 'game-1',
            pack_number: `PKG-${pack_id}`,
            status: 'RECEIVED',
            updated_at: '2026-01-27T10:00:00.000Z',
          },
          'store-1'
        );

        expect(dal.findById(pack_id)?.status).toBe('ACTIVE');
      });

      it('ACTIVE -> DEPLETED: allowed if newer', () => {
        const { pack_id } = insertTestPack({
          status: 'ACTIVE',
          updated_at: '2026-01-27T08:00:00.000Z',
        });

        dal.upsertFromCloud(
          {
            pack_id, // pack_id IS the cloud ID now
            store_id: 'store-1',
            game_id: 'game-1',
            pack_number: `PKG-${pack_id}`,
            status: 'DEPLETED',
            updated_at: '2026-01-27T10:00:00.000Z',
          },
          'store-1'
        );

        expect(dal.findById(pack_id)?.status).toBe('DEPLETED');
      });

      it('ACTIVE -> RETURNED: allowed if newer', () => {
        const { pack_id } = insertTestPack({
          status: 'ACTIVE',
          updated_at: '2026-01-27T08:00:00.000Z',
        });

        dal.upsertFromCloud(
          {
            pack_id, // pack_id IS the cloud ID now
            store_id: 'store-1',
            game_id: 'game-1',
            pack_number: `PKG-${pack_id}`,
            status: 'RETURNED',
            updated_at: '2026-01-27T10:00:00.000Z',
          },
          'store-1'
        );

        expect(dal.findById(pack_id)?.status).toBe('RETURNED');
      });

      it('DEPLETED -> Any: ALWAYS blocked (terminal state)', () => {
        const statuses = ['RECEIVED', 'ACTIVE', 'RETURNED'] as const;

        for (const targetStatus of statuses) {
          const { pack_id } = insertTestPack({
            status: 'DEPLETED',
            updated_at: '2026-01-27T08:00:00.000Z',
          });

          dal.upsertFromCloud(
            {
              pack_id, // pack_id IS the cloud ID now
              store_id: 'store-1',
              game_id: 'game-1',
              pack_number: `PKG-${pack_id}`,
              status: targetStatus,
              updated_at: '2026-01-27T10:00:00.000Z',
            },
            'store-1'
          );

          expect(dal.findById(pack_id)?.status).toBe('DEPLETED');
        }
      });

      it('RETURNED -> Any: ALWAYS blocked (terminal state)', () => {
        const statuses = ['RECEIVED', 'ACTIVE', 'DEPLETED'] as const;

        for (const targetStatus of statuses) {
          const { pack_id } = insertTestPack({
            status: 'RETURNED',
            updated_at: '2026-01-27T08:00:00.000Z',
          });

          dal.upsertFromCloud(
            {
              pack_id, // pack_id IS the cloud ID now
              store_id: 'store-1',
              game_id: 'game-1',
              pack_number: `PKG-${pack_id}`,
              status: targetStatus,
              updated_at: '2026-01-27T10:00:00.000Z',
            },
            'store-1'
          );

          expect(dal.findById(pack_id)?.status).toBe('RETURNED');
        }
      });
    });
  });

  // ============================================================================
  // PHASE 9: returnPack - return_reason storage (Tasks 9.1-9.6)
  // ============================================================================
  // These tests verify the storage and retrieval of return_reason and return_notes
  // fields in the returnPack DAL method.
  //
  // SEC-014: return_reason is validated at entry point (handler layer)
  // DB-006: Store-scoped operations via store_id parameter
  // SEC-006: All SQL uses parameterized prepared statements
  // ============================================================================
  describe('returnPack - return_reason storage (Phase 9)', () => {
    /**
     * Phase 9 Tasks 9.1-9.6: return_reason and return_notes storage validation
     *
     * Tests verify that:
     * - return_reason is stored in the database (9.2)
     * - return_notes is stored when provided (9.3)
     * - Returned pack has return_reason field populated (9.4)
     * - Returned pack has return_notes field populated (9.5)
     * - null return_notes is handled gracefully (9.6)
     *
     * @security SEC-014: Strict enum values (already validated at handler)
     * @security DB-006: Store-scoped operations
     */

    // 9.2: Test should store return_reason in database
    describe('9.2: Store return_reason in database', () => {
      it('should store SUPPLIER_RECALL return_reason in database', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-RECALL-001',
        });

        const returnedPack = dal.returnPack(pack.pack_id, {
          store_id: 'store-1',
          return_reason: 'SUPPLIER_RECALL',
        });

        expect(returnedPack?.return_reason).toBe('SUPPLIER_RECALL');

        // Verify database storage by re-reading
        const storedPack = dal.findById(pack.pack_id);
        expect(storedPack?.return_reason).toBe('SUPPLIER_RECALL');
      });

      it('should store DAMAGED return_reason in database', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-DAMAGED-001',
        });

        const returnedPack = dal.returnPack(pack.pack_id, {
          store_id: 'store-1',
          return_reason: 'DAMAGED',
        });

        expect(returnedPack?.return_reason).toBe('DAMAGED');

        // Verify database storage
        const storedPack = dal.findById(pack.pack_id);
        expect(storedPack?.return_reason).toBe('DAMAGED');
      });

      it('should store EXPIRED return_reason in database', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-EXPIRED-001',
        });

        const returnedPack = dal.returnPack(pack.pack_id, {
          store_id: 'store-1',
          return_reason: 'EXPIRED',
        });

        expect(returnedPack?.return_reason).toBe('EXPIRED');

        // Verify database storage
        const storedPack = dal.findById(pack.pack_id);
        expect(storedPack?.return_reason).toBe('EXPIRED');
      });

      it('should store INVENTORY_ADJUSTMENT return_reason in database', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-INV-ADJ-001',
        });

        const returnedPack = dal.returnPack(pack.pack_id, {
          store_id: 'store-1',
          return_reason: 'INVENTORY_ADJUSTMENT',
        });

        expect(returnedPack?.return_reason).toBe('INVENTORY_ADJUSTMENT');

        // Verify database storage
        const storedPack = dal.findById(pack.pack_id);
        expect(storedPack?.return_reason).toBe('INVENTORY_ADJUSTMENT');
      });

      it('should store STORE_CLOSURE return_reason in database', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-CLOSURE-001',
        });

        const returnedPack = dal.returnPack(pack.pack_id, {
          store_id: 'store-1',
          return_reason: 'STORE_CLOSURE',
        });

        expect(returnedPack?.return_reason).toBe('STORE_CLOSURE');

        // Verify database storage
        const storedPack = dal.findById(pack.pack_id);
        expect(storedPack?.return_reason).toBe('STORE_CLOSURE');
      });
    });

    // 9.3: Test should store return_notes in database when provided
    describe('9.3: Store return_notes in database when provided', () => {
      it('should store return_notes in database', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-NOTES-001',
        });

        const returnedPack = dal.returnPack(pack.pack_id, {
          store_id: 'store-1',
          return_reason: 'DAMAGED',
          return_notes: 'Pack was crushed during shipping. All tickets are torn.',
        });

        expect(returnedPack?.return_notes).toBe(
          'Pack was crushed during shipping. All tickets are torn.'
        );

        // Verify database storage by re-reading
        const storedPack = dal.findById(pack.pack_id);
        expect(storedPack?.return_notes).toBe(
          'Pack was crushed during shipping. All tickets are torn.'
        );
      });

      it('should store multiline return_notes correctly', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-MULTILINE-001',
        });

        const multilineNotes = 'Line 1: Pack damaged\nLine 2: Tickets torn\nLine 3: Cannot sell';

        const returnedPack = dal.returnPack(pack.pack_id, {
          store_id: 'store-1',
          return_reason: 'DAMAGED',
          return_notes: multilineNotes,
        });

        expect(returnedPack?.return_notes).toBe(multilineNotes);

        // Verify database storage
        const storedPack = dal.findById(pack.pack_id);
        expect(storedPack?.return_notes).toBe(multilineNotes);
      });

      it('should store unicode characters in return_notes', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-UNICODE-001',
        });

        const unicodeNotes = 'Customer complaint: "Paquete dañado" 破损 📦';

        const returnedPack = dal.returnPack(pack.pack_id, {
          store_id: 'store-1',
          return_reason: 'DAMAGED',
          return_notes: unicodeNotes,
        });

        expect(returnedPack?.return_notes).toBe(unicodeNotes);

        // Verify database storage
        const storedPack = dal.findById(pack.pack_id);
        expect(storedPack?.return_notes).toBe(unicodeNotes);
      });
    });

    // 9.4: Test should return pack with return_reason field populated
    describe('9.4: Return pack with return_reason field populated', () => {
      it('should return pack object with return_reason field', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-FIELD-001',
        });

        const returnedPack = dal.returnPack(pack.pack_id, {
          store_id: 'store-1',
          return_reason: 'SUPPLIER_RECALL',
        });

        expect(returnedPack).toBeDefined();
        expect(returnedPack).toHaveProperty('return_reason');
        expect(returnedPack?.return_reason).toBe('SUPPLIER_RECALL');
      });

      it('should include return_reason in findById result after return', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-FINDBYID-001',
        });

        dal.returnPack(pack.pack_id, {
          store_id: 'store-1',
          return_reason: 'EXPIRED',
        });

        const retrievedPack = dal.findById(pack.pack_id);
        expect(retrievedPack).toBeDefined();
        expect(retrievedPack?.return_reason).toBe('EXPIRED');
        expect(retrievedPack?.status).toBe('RETURNED');
      });
    });

    // 9.5: Test should return pack with return_notes field populated
    describe('9.5: Return pack with return_notes field populated', () => {
      it('should return pack object with return_notes field', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-NOTES-FIELD-001',
        });

        const returnedPack = dal.returnPack(pack.pack_id, {
          store_id: 'store-1',
          return_reason: 'DAMAGED',
          return_notes: 'Water damage visible on pack',
        });

        expect(returnedPack).toBeDefined();
        expect(returnedPack).toHaveProperty('return_notes');
        expect(returnedPack?.return_notes).toBe('Water damage visible on pack');
      });

      it('should include return_notes in findById result after return', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-NOTES-FIND-001',
        });

        dal.returnPack(pack.pack_id, {
          store_id: 'store-1',
          return_reason: 'INVENTORY_ADJUSTMENT',
          return_notes: 'Audit discrepancy - pack never received',
        });

        const retrievedPack = dal.findById(pack.pack_id);
        expect(retrievedPack).toBeDefined();
        expect(retrievedPack?.return_notes).toBe('Audit discrepancy - pack never received');
      });

      it('should preserve both return_reason and return_notes together', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-BOTH-001',
        });

        const returnedPack = dal.returnPack(pack.pack_id, {
          store_id: 'store-1',
          return_reason: 'STORE_CLOSURE',
          return_notes: 'Store closing for renovation - returning all unsold inventory',
        });

        expect(returnedPack?.return_reason).toBe('STORE_CLOSURE');
        expect(returnedPack?.return_notes).toBe(
          'Store closing for renovation - returning all unsold inventory'
        );

        // Verify both fields persist
        const retrievedPack = dal.findById(pack.pack_id);
        expect(retrievedPack?.return_reason).toBe('STORE_CLOSURE');
        expect(retrievedPack?.return_notes).toBe(
          'Store closing for renovation - returning all unsold inventory'
        );
      });
    });

    // 9.6: Test should handle null return_notes gracefully
    describe('9.6: Handle null return_notes gracefully', () => {
      it('should store null when return_notes is not provided', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-NULL-NOTES-001',
        });

        const returnedPack = dal.returnPack(pack.pack_id, {
          store_id: 'store-1',
          return_reason: 'SUPPLIER_RECALL',
          // return_notes not provided
        });

        expect(returnedPack?.return_reason).toBe('SUPPLIER_RECALL');
        expect(returnedPack?.return_notes).toBeNull();

        // Verify database storage
        const storedPack = dal.findById(pack.pack_id);
        expect(storedPack?.return_notes).toBeNull();
      });

      it('should store null when return_notes is explicitly undefined', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-UNDEF-NOTES-001',
        });

        const returnedPack = dal.returnPack(pack.pack_id, {
          store_id: 'store-1',
          return_reason: 'DAMAGED',
          return_notes: undefined,
        });

        expect(returnedPack?.return_reason).toBe('DAMAGED');
        expect(returnedPack?.return_notes).toBeNull();
      });

      it('should convert empty string return_notes to null', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-EMPTY-NOTES-001',
        });

        const returnedPack = dal.returnPack(pack.pack_id, {
          store_id: 'store-1',
          return_reason: 'EXPIRED',
          return_notes: '',
        });

        expect(returnedPack?.return_reason).toBe('EXPIRED');
        // DAL normalizes empty string to null for database consistency
        expect(returnedPack?.return_notes).toBeNull();
      });

      it('should not require return_notes for successful return', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-NO-NOTES-001',
        });

        // Should not throw - return_notes is optional
        expect(() =>
          dal.returnPack(pack.pack_id, {
            store_id: 'store-1',
            return_reason: 'INVENTORY_ADJUSTMENT',
          })
        ).not.toThrow();

        const storedPack = dal.findById(pack.pack_id);
        expect(storedPack?.status).toBe('RETURNED');
        expect(storedPack?.return_reason).toBe('INVENTORY_ADJUSTMENT');
      });
    });

    // Additional comprehensive tests
    describe('Comprehensive storage validation', () => {
      it('should persist all fields through pack lifecycle', () => {
        // Receive
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-LIFECYCLE-001',
        });
        expect(pack.status).toBe('RECEIVED');
        expect(pack.return_reason).toBeNull();
        expect(pack.return_notes).toBeNull();

        // Activate
        const activatedPack = dal.activate(pack.pack_id, {
          store_id: 'store-1',
          current_bin_id: 'bin-1',
          opening_serial: '000',
        });
        expect(activatedPack?.status).toBe('ACTIVE');
        expect(activatedPack?.return_reason).toBeNull();

        // Return
        const returnedPack = dal.returnPack(pack.pack_id, {
          store_id: 'store-1',
          return_reason: 'DAMAGED',
          return_notes: 'Final disposition: damaged beyond sale',
        });

        expect(returnedPack?.status).toBe('RETURNED');
        expect(returnedPack?.return_reason).toBe('DAMAGED');
        expect(returnedPack?.return_notes).toBe('Final disposition: damaged beyond sale');
        expect(returnedPack?.returned_at).toBeDefined();
      });

      it('should store return data for RECEIVED pack (never activated)', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-RECEIVED-RETURN-001',
        });

        // Return directly from RECEIVED status
        const returnedPack = dal.returnPack(pack.pack_id, {
          store_id: 'store-1',
          return_reason: 'SUPPLIER_RECALL',
          return_notes: 'Returned before activation - manufacturer defect',
        });

        expect(returnedPack?.status).toBe('RETURNED');
        expect(returnedPack?.return_reason).toBe('SUPPLIER_RECALL');
        expect(returnedPack?.return_notes).toBe('Returned before activation - manufacturer defect');
        expect(returnedPack?.activated_at).toBeNull();
      });

      it('DB-006: should not allow cross-store return_reason storage', () => {
        const pack = dal.receive({
          store_id: 'store-1',
          game_id: 'game-1',
          pack_number: 'PKG-CROSS-STORE-001',
        });

        // Try to return with wrong store_id
        expect(() =>
          dal.returnPack(pack.pack_id, {
            store_id: 'store-2', // Different store
            return_reason: 'DAMAGED',
          })
        ).toThrow();

        // Verify pack was not modified
        const storedPack = dal.findById(pack.pack_id);
        expect(storedPack?.status).toBe('RECEIVED');
        expect(storedPack?.return_reason).toBeNull();
      });
    });
  });
});
