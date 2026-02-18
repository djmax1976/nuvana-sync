/**
 * Day Close Sync Integration Tests (v047 - Phase 3)
 *
 * End-to-end tests validating the day close operation properly queues
 * sync items for cloud synchronization. Tests cover:
 * - Full day close flow with sync queue verification (T3.3.1)
 * - Offline scenario handling (T3.3.2)
 *
 * @module tests/integration/day-close-sync
 * @security DB-006: Tenant isolation validation
 * @security SEC-006: Parameterized queries
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { CreateSyncQueueItemData } from '../../src/main/dal/sync-queue.dal';

// ==========================================================================
// Mock Setup with vi.hoisted for proper mock hoisting
// ==========================================================================

// Use vi.hoisted for state that mocks need to access
const { dbHolder, enqueueCallHistory, shouldEnqueueFail, uuidCounter, settledPacks } = vi.hoisted(
  () => ({
    dbHolder: { instance: null as Database.Database | null },
    enqueueCallHistory: [] as CreateSyncQueueItemData[],
    shouldEnqueueFail: { value: false },
    uuidCounter: { value: 0 },
    settledPacks: [] as string[],
  })
);

// Mock database service to use test database via hoisted holder
vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => {
    if (!dbHolder.instance) {
      throw new Error('Database not initialized - test setup issue');
    }
    return dbHolder.instance;
  }),
  isDatabaseInitialized: vi.fn(() => dbHolder.instance !== null),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => `mock-uuid-${++uuidCounter.value}`),
}));

// Mock syncQueueDAL with call tracking and failure simulation
vi.mock('../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: {
    enqueue: vi.fn((data: CreateSyncQueueItemData) => {
      if (shouldEnqueueFail.value) {
        throw new Error('Sync queue unavailable - offline mode');
      }
      enqueueCallHistory.push(data);
      return {
        id: `sync-item-${enqueueCallHistory.length}`,
        ...data,
        payload: JSON.stringify(data.payload),
        priority: data.priority || 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: new Date().toISOString(),
        synced_at: null,
        dead_lettered: 0,
        dead_letter_reason: null,
        dead_lettered_at: null,
        error_category: null,
        retry_after: null,
        sync_direction: data.sync_direction || 'PUSH',
        api_endpoint: null,
        http_status: null,
        response_body: null,
      };
    }),
    getUnsyncedByStore: vi.fn(() => []),
    getPendingCount: vi.fn(() => enqueueCallHistory.filter((i) => i).length),
    markSynced: vi.fn(),
    getRetryableItems: vi.fn(() => []),
    cleanupAllStalePullTracking: vi.fn().mockReturnValue(0),
  },
  _resetSyncQueueDAL: vi.fn(),
}));

// Import the mocked module after vi.mock() (Vitest hoists mocks)
import { syncQueueDAL as _syncQueueDAL } from '../../src/main/dal/sync-queue.dal';

// Mock lotteryPacksDAL with tracking
vi.mock('../../src/main/dal/lottery-packs.dal', () => ({
  lotteryPacksDAL: {
    getPackWithDetails: vi.fn((packId: string) => {
      const packNum = packId.replace('pack-', '');
      return {
        pack_id: packId,
        store_id: 'store-550e8400-e29b-41d4-a716-446655440000',
        game_id: 'game-123',
        game_code: '1001',
        pack_number: `PKG${packNum}`,
        status: settledPacks.includes(packId) ? 'DEPLETED' : 'ACTIVE',
        current_bin_id: `bin-${packNum}`,
        bin_name: `Bin ${packNum}`,
        bin_display_order: parseInt(packNum) || 1,
        game_name: 'Lucky 7s',
        game_price: 1.0,
        game_tickets_per_pack: 300,
        opening_serial: '000',
        prev_ending_serial: null,
        activated_at: '2024-01-15T09:00:00.000Z',
        activated_by: 'user-activator',
        received_at: '2024-01-15T08:00:00.000Z',
        received_by: 'user-receiver',
      };
    }),
    calculateSales: vi.fn((_packId: string, closingSerial: string) => {
      const serial = parseInt(closingSerial) || 0;
      return {
        ticketsSold: serial,
        salesAmount: serial * 1.0, // $1 per ticket
      };
    }),
    settle: vi.fn((packId: string) => {
      settledPacks.push(packId);
      return { pack_id: packId, status: 'DEPLETED' };
    }),
  },
  _resetLotteryPacksDAL: vi.fn(),
}));

// Mock lotteryGamesDAL
vi.mock('../../src/main/dal/lottery-games.dal', () => ({
  lotteryGamesDAL: {
    findById: vi.fn(() => ({
      game_id: 'game-123',
      game_code: '1001',
      name: 'Lucky 7s',
      price: 1,
      tickets_per_pack: 300,
    })),
    findByGameCode: vi.fn(() => ({
      game_id: 'game-123',
      game_code: '1001',
      name: 'Lucky 7s',
      price: 1,
      tickets_per_pack: 300,
    })),
  },
  _resetLotteryGamesDAL: vi.fn(),
}));

// Mock lotteryBinsDAL
vi.mock('../../src/main/dal/lottery-bins.dal', () => ({
  lotteryBinsDAL: {
    findById: vi.fn(() => null),
  },
  _resetLotteryBinsDAL: vi.fn(),
}));

// Mock logger
vi.mock('../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// ==========================================================================
// Test Constants
// ==========================================================================

const TEST_STORE_ID = 'store-550e8400-e29b-41d4-a716-446655440000';
const TEST_USER_ID = 'user-manager-123';
const TEST_BUSINESS_DATE = '2024-01-15';

// ==========================================================================
// Database Schema for Tests
// ==========================================================================

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS stores (
    store_id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'America/New_York',
    status TEXT NOT NULL DEFAULT 'ACTIVE'
  );

  CREATE TABLE IF NOT EXISTS lottery_business_days (
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

  CREATE TABLE IF NOT EXISTS lottery_day_packs (
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

  CREATE TABLE IF NOT EXISTS lottery_packs (
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
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lottery_bins (
    bin_id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    name TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  INSERT INTO stores (store_id, company_id, name) VALUES ('${TEST_STORE_ID}', 'company-1', 'Test Store');
`;

// ==========================================================================
// Helper Functions
// ==========================================================================

/**
 * Find sync items in the call history by entity type
 */
function findSyncItemsByType(entityType: string): CreateSyncQueueItemData[] {
  return enqueueCallHistory.filter((item) => item.entity_type === entityType);
}

/**
 * Find a specific sync item by entity type and entity ID
 */
function _findSyncItem(entityType: string, entityId: string): CreateSyncQueueItemData | undefined {
  return enqueueCallHistory.find(
    (item) => item.entity_type === entityType && item.entity_id === entityId
  );
}

// ==========================================================================
// Tests
// ==========================================================================

describe('Day Close Sync Integration (v047 - Phase 3)', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Create fresh in-memory database for each test
    db = new Database(':memory:');
    dbHolder.instance = db;
    db.exec(SCHEMA);

    // Reset mock state
    vi.clearAllMocks();
    enqueueCallHistory.length = 0;
    settledPacks.length = 0;
    shouldEnqueueFail.value = false;
    uuidCounter.value = 0;
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    dbHolder.instance = null;
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // T3.3.1: Full day close flow with sync
  // ==========================================================================
  describe('T3.3.1: Full day close flow with sync', () => {
    it('should queue sync items after prepareClose -> commitClose', async () => {
      // Import DAL after mocks are set up
      const { LotteryBusinessDaysDAL } =
        await import('../../src/main/dal/lottery-business-days.dal');
      const dal = new LotteryBusinessDaysDAL();

      // Create test data - insert pack for foreign key
      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, created_at, updated_at)
        VALUES ('pack-1', '${TEST_STORE_ID}', 'game-123', 'PKG1', 'ACTIVE', datetime('now'), datetime('now'))
      `);

      // First, create and open a day
      const day = dal.getOrCreateForDate(TEST_STORE_ID, TEST_BUSINESS_DATE, TEST_USER_ID);
      expect(day).toBeDefined();
      expect(day.status).toBe('OPEN');

      // Clear enqueue history from day open
      enqueueCallHistory.length = 0;

      // Prepare closings data
      const closingsData = [
        {
          pack_id: 'pack-1',
          closing_serial: '150',
          is_sold_out: false,
        },
      ];

      // Phase 1: Prepare close
      const prepareResult = dal.prepareClose(day.day_id, closingsData);
      expect(prepareResult.status).toBe('PENDING_CLOSE');
      expect(prepareResult.closings_count).toBe(1);

      // Phase 2: Commit close
      const commitResult = dal.commitClose(day.day_id, TEST_USER_ID);
      expect(commitResult.closings_created).toBe(1);

      // Verify sync items were queued
      const dayCloseItems = findSyncItemsByType('day_close');
      expect(dayCloseItems.length).toBe(1);

      // Verify day_close sync item structure
      const dayCloseItem = dayCloseItems[0];
      expect(dayCloseItem.entity_type).toBe('day_close');
      expect(dayCloseItem.entity_id).toBe(day.day_id);
      expect(dayCloseItem.operation).toBe('CREATE');
      expect(dayCloseItem.store_id).toBe(TEST_STORE_ID);

      // Verify payload
      const payload = dayCloseItem.payload as Record<string, unknown>;
      expect(payload.day_id).toBe(day.day_id);
      expect(payload.store_id).toBe(TEST_STORE_ID);
      expect(payload.closed_by).toBe(TEST_USER_ID);
    });

    it('should queue pack depletion sync when pack is sold out', async () => {
      const { LotteryBusinessDaysDAL } =
        await import('../../src/main/dal/lottery-business-days.dal');
      const dal = new LotteryBusinessDaysDAL();

      // Create test pack
      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, created_at, updated_at)
        VALUES ('pack-sold-out', '${TEST_STORE_ID}', 'game-123', 'PKG-SOLD', 'ACTIVE', datetime('now'), datetime('now'))
      `);

      const day = dal.getOrCreateForDate(TEST_STORE_ID, TEST_BUSINESS_DATE, TEST_USER_ID);
      enqueueCallHistory.length = 0;

      // Close with sold out pack
      const closingsData = [
        {
          pack_id: 'pack-sold-out',
          closing_serial: '299', // Last ticket
          is_sold_out: true,
        },
      ];

      dal.prepareClose(day.day_id, closingsData);
      dal.commitClose(day.day_id, TEST_USER_ID);

      // Verify pack depletion sync item
      const packItems = findSyncItemsByType('pack');
      expect(packItems.length).toBe(1);

      const packItem = packItems[0];
      expect(packItem.entity_id).toBe('pack-sold-out');
      expect(packItem.operation).toBe('UPDATE');

      const payload = packItem.payload as Record<string, unknown>;
      expect(payload.status).toBe('DEPLETED');
      expect(payload.depletion_reason).toBe('DAY_CLOSE');
    });
  });

  // ==========================================================================
  // T3.3.2: Offline scenario handling
  // ==========================================================================
  describe('T3.3.2: Offline scenario handling', () => {
    it('should complete day close locally even when sync queue fails', async () => {
      const { LotteryBusinessDaysDAL } =
        await import('../../src/main/dal/lottery-business-days.dal');
      const dal = new LotteryBusinessDaysDAL();

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, created_at, updated_at)
        VALUES ('pack-offline', '${TEST_STORE_ID}', 'game-123', 'PKG-OFF', 'ACTIVE', datetime('now'), datetime('now'))
      `);

      const day = dal.getOrCreateForDate(TEST_STORE_ID, TEST_BUSINESS_DATE, TEST_USER_ID);
      enqueueCallHistory.length = 0;

      // Simulate offline mode - enqueue will fail
      shouldEnqueueFail.value = true;

      const closingsData = [
        {
          pack_id: 'pack-offline',
          closing_serial: '100',
          is_sold_out: false,
        },
      ];

      dal.prepareClose(day.day_id, closingsData);

      // This should NOT throw even though sync queue fails
      const commitResult = dal.commitClose(day.day_id, TEST_USER_ID);

      // Local commit should succeed
      expect(commitResult.closings_created).toBe(1);

      // Verify day is closed in database
      const closedDay = dal.findById(day.day_id);
      expect(closedDay?.status).toBe('CLOSED');

      // No sync items should be recorded (they failed to enqueue)
      expect(enqueueCallHistory.length).toBe(0);
    });

    it('should be able to re-queue day close for sync after recovery', async () => {
      const { LotteryBusinessDaysDAL } =
        await import('../../src/main/dal/lottery-business-days.dal');
      const dal = new LotteryBusinessDaysDAL();

      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, created_at, updated_at)
        VALUES ('pack-requeue', '${TEST_STORE_ID}', 'game-123', 'PKG-REQ', 'ACTIVE', datetime('now'), datetime('now'))
      `);

      const day = dal.getOrCreateForDate(TEST_STORE_ID, TEST_BUSINESS_DATE, TEST_USER_ID);
      enqueueCallHistory.length = 0;

      // First close with sync failure
      shouldEnqueueFail.value = true;
      const closingsData = [{ pack_id: 'pack-requeue', closing_serial: '050', is_sold_out: false }];
      dal.prepareClose(day.day_id, closingsData);
      dal.commitClose(day.day_id, TEST_USER_ID);
      expect(enqueueCallHistory.length).toBe(0);

      // Simulate recovery - sync queue available again
      shouldEnqueueFail.value = false;

      // Re-queue for sync
      const requeueResult = dal.requeueDayCloseForSync(day.day_id, TEST_USER_ID);
      expect(requeueResult).toBe(true);

      // Verify sync item was queued
      const dayCloseItems = findSyncItemsByType('day_close');
      expect(dayCloseItems.length).toBe(1);
      expect(dayCloseItems[0].entity_id).toBe(day.day_id);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================
  describe('Edge Cases', () => {
    it('should handle multiple packs in single day close', async () => {
      const { LotteryBusinessDaysDAL } =
        await import('../../src/main/dal/lottery-business-days.dal');
      const dal = new LotteryBusinessDaysDAL();

      // Create multiple packs
      db.exec(`
        INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, created_at, updated_at)
        VALUES
          ('pack-multi-1', '${TEST_STORE_ID}', 'game-123', 'PKG-M1', 'ACTIVE', datetime('now'), datetime('now')),
          ('pack-multi-2', '${TEST_STORE_ID}', 'game-123', 'PKG-M2', 'ACTIVE', datetime('now'), datetime('now')),
          ('pack-multi-3', '${TEST_STORE_ID}', 'game-123', 'PKG-M3', 'ACTIVE', datetime('now'), datetime('now'))
      `);

      const day = dal.getOrCreateForDate(TEST_STORE_ID, TEST_BUSINESS_DATE, TEST_USER_ID);
      enqueueCallHistory.length = 0;

      const closingsData = [
        { pack_id: 'pack-multi-1', closing_serial: '050', is_sold_out: false },
        { pack_id: 'pack-multi-2', closing_serial: '100', is_sold_out: true }, // Sold out
        { pack_id: 'pack-multi-3', closing_serial: '075', is_sold_out: false },
      ];

      dal.prepareClose(day.day_id, closingsData);
      const commitResult = dal.commitClose(day.day_id, TEST_USER_ID);

      expect(commitResult.closings_created).toBe(3);

      // Should have 1 day_close + 1 pack depletion (for sold out pack)
      const dayCloseItems = findSyncItemsByType('day_close');
      const packItems = findSyncItemsByType('pack');

      expect(dayCloseItems.length).toBe(1);
      expect(packItems.length).toBe(1);
      expect(packItems[0].entity_id).toBe('pack-multi-2');
    });
  });
});
