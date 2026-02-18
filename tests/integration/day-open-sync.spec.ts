/**
 * Day Open Sync Integration Tests (day_open_push - Phase 5 Task 5.4)
 *
 * End-to-end tests validating the day open operation properly queues
 * sync items for cloud synchronization. Tests cover:
 * - Full day open flow with sync queue verification (T5.4.1)
 * - Day open then close flow (T5.4.2)
 * - Offline scenario handling (T5.4.3)
 * - Multiple stores isolation (T5.4.4)
 * - Recovery from failed sync (T5.4.5)
 *
 * @module tests/integration/day-open-sync
 * @security DB-006: Tenant isolation validation
 * @security SEC-006: Parameterized queries
 * @security SEC-010: User identity for audit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CreateSyncQueueItemData } from '../../src/main/dal/sync-queue.dal';
import type { PackClosingData } from '../../src/main/dal/lottery-business-days.dal';

// ==========================================================================
// Mock Setup with vi.hoisted for proper mock hoisting
// ==========================================================================

// Use vi.hoisted for state that mocks need to access
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const {
  enqueueCallHistory,
  shouldEnqueueFail,
  uuidCounter,
  settledPacks,
  mockPrepare,
  mockTransaction,
} = vi.hoisted(() => ({
  enqueueCallHistory: [] as any[],
  shouldEnqueueFail: { value: false },
  uuidCounter: { value: 0 },
  settledPacks: [] as string[],
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn((fn: () => unknown) => () => fn()),
}));

vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
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
}));

// Import the mocked module after vi.mock() (Vitest hoists mocks)
import { syncQueueDAL } from '../../src/main/dal/sync-queue.dal';

// Mock lotteryPacksDAL with tracking (settledPacks from vi.hoisted)
vi.mock('../../src/main/dal/lottery-packs.dal', () => ({
  lotteryPacksDAL: {
    getPackWithDetails: vi.fn((packId: string) => {
      const packNum = packId.replace('pack-', '');
      return {
        pack_id: packId,
        store_id: 'store-550e8400-e29b-41d4-a716-446655440000', // TEST_STORE_ID
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
}));

// ==========================================================================
// Test Constants
// ==========================================================================

const TEST_STORE_ID = 'store-550e8400-e29b-41d4-a716-446655440000';
const TEST_STORE_ID_2 = 'store-660e8400-e29b-41d4-a716-446655440001';
const TEST_USER_ID = 'user-manager-123';
const TEST_BUSINESS_DATE = '2024-01-15';

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

/**
 * Find sync items by store_id
 */
function findSyncItemsByStore(storeId: string): CreateSyncQueueItemData[] {
  return enqueueCallHistory.filter((item) => item.store_id === storeId);
}

// ==========================================================================
// Tests
// ==========================================================================

describe('Day Open Sync Integration (day_open_push - Phase 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enqueueCallHistory.length = 0;
    settledPacks.length = 0;
    shouldEnqueueFail.value = false;
    uuidCounter.value = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // T5.4.1: Full day open flow with sync queue
  // ==========================================================================
  describe('T5.4.1: Full day open flow with sync queue', () => {
    it('should queue day_open sync item when creating a new day', async () => {
      // Dynamic import to get fresh DAL instance
      const { LotteryBusinessDaysDAL } =
        await import('../../src/main/dal/lottery-business-days.dal');

      // Create a mock in-memory database with proper tables
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(':memory:');

      // Set up tables
      db.exec(`
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
        CREATE TABLE stores (
          store_id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          name TEXT NOT NULL,
          timezone TEXT NOT NULL DEFAULT 'America/New_York',
          status TEXT NOT NULL DEFAULT 'ACTIVE'
        );
        INSERT INTO stores (store_id, company_id, name) VALUES ('${TEST_STORE_ID}', 'company-1', 'Test Store');
      `);

      // Override getDatabase mock to return our test DB
      const { getDatabase } = await import('../../src/main/services/database.service');
      (getDatabase as ReturnType<typeof vi.fn>).mockReturnValue(db);

      const dal = new LotteryBusinessDaysDAL();
      const day = dal.getOrCreateForDate(TEST_STORE_ID, TEST_BUSINESS_DATE, TEST_USER_ID);

      // Verify day was created
      expect(day).toBeDefined();
      expect(day.status).toBe('OPEN');

      // Verify sync item was queued
      const dayOpenItems = findSyncItemsByType('day_open');
      expect(dayOpenItems).toHaveLength(1);

      // Verify sync item has correct payload structure
      const syncItem = dayOpenItems[0];
      expect(syncItem.entity_type).toBe('day_open');
      expect(syncItem.entity_id).toBe(day.day_id);
      expect(syncItem.operation).toBe('CREATE');
      expect(syncItem.store_id).toBe(TEST_STORE_ID);

      // Verify payload fields
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload = syncItem.payload as any;
      expect(payload.day_id).toBe(day.day_id);
      expect(payload.store_id).toBe(TEST_STORE_ID);
      expect(payload.business_date).toBe(TEST_BUSINESS_DATE);
      expect(payload.opened_by).toBe(TEST_USER_ID);
      expect(payload.opened_at).toBeDefined();

      db.close();
    });

    it('should create sync item with correct priority (20 per SYNC-001)', async () => {
      const { LotteryBusinessDaysDAL } =
        await import('../../src/main/dal/lottery-business-days.dal');

      const Database = (await import('better-sqlite3')).default;
      const db = new Database(':memory:');

      db.exec(`
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
        CREATE TABLE stores (store_id TEXT PRIMARY KEY, company_id TEXT NOT NULL, name TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'America/New_York', status TEXT NOT NULL DEFAULT 'ACTIVE');
        INSERT INTO stores (store_id, company_id, name) VALUES ('${TEST_STORE_ID}', 'company-1', 'Test Store');
      `);

      const { getDatabase } = await import('../../src/main/services/database.service');
      (getDatabase as ReturnType<typeof vi.fn>).mockReturnValue(db);

      const dal = new LotteryBusinessDaysDAL();
      dal.getOrCreateForDate(TEST_STORE_ID, TEST_BUSINESS_DATE, TEST_USER_ID);

      const dayOpenItems = findSyncItemsByType('day_open');
      // SYNC-001: day_open priority = 20 (must sync before shifts at priority 10)
      expect(dayOpenItems[0].priority).toBe(20);

      db.close();
    });
  });

  // ==========================================================================
  // T5.4.2: Day open then close flow
  // ==========================================================================
  describe('T5.4.2: Day open then close flow', () => {
    it('should queue day_open before day_close based on priority', async () => {
      // SYNC-001: day_open has priority 20, shifts have priority 10, day_close has priority 1
      // Higher priority = processed first
      // This ensures day exists on cloud before shifts try to reference it

      const { LotteryBusinessDaysDAL } =
        await import('../../src/main/dal/lottery-business-days.dal');

      const Database = (await import('better-sqlite3')).default;
      const db = new Database(':memory:');

      db.exec(`
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
        CREATE TABLE lottery_packs (
          pack_id TEXT PRIMARY KEY,
          store_id TEXT NOT NULL,
          game_id TEXT NOT NULL,
          pack_number TEXT NOT NULL,
          current_bin_id TEXT,
          status TEXT NOT NULL DEFAULT 'RECEIVED',
          opening_serial TEXT,
          closing_serial TEXT,
          tickets_sold_count INTEGER NOT NULL DEFAULT 0,
          sales_amount REAL NOT NULL DEFAULT 0,
          activated_at TEXT,
          activated_by TEXT,
          depleted_at TEXT,
          depleted_by TEXT,
          depletion_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE lottery_games (
          game_id TEXT PRIMARY KEY,
          store_id TEXT NOT NULL,
          game_code TEXT NOT NULL,
          name TEXT NOT NULL,
          price REAL,
          tickets_per_pack INTEGER NOT NULL DEFAULT 300,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE lottery_bins (
          bin_id TEXT PRIMARY KEY,
          store_id TEXT NOT NULL,
          name TEXT NOT NULL,
          display_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE stores (store_id TEXT PRIMARY KEY, company_id TEXT NOT NULL, name TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'America/New_York', status TEXT NOT NULL DEFAULT 'ACTIVE');
        INSERT INTO stores (store_id, company_id, name) VALUES ('${TEST_STORE_ID}', 'company-1', 'Test Store');
        INSERT INTO lottery_games (game_id, store_id, game_code, name, price, tickets_per_pack, created_at, updated_at)
        VALUES ('game-123', '${TEST_STORE_ID}', '1001', 'Lucky 7s', 1.0, 300, datetime('now'), datetime('now'));
        INSERT INTO lottery_bins (bin_id, store_id, name, display_order, created_at, updated_at)
        VALUES ('bin-1', '${TEST_STORE_ID}', 'Bin 1', 1, datetime('now'), datetime('now'));
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', '${TEST_STORE_ID}', 'game-123', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const { getDatabase } = await import('../../src/main/services/database.service');
      (getDatabase as ReturnType<typeof vi.fn>).mockReturnValue(db);

      const dal = new LotteryBusinessDaysDAL();

      // 1. Open day - queues day_open
      const day = dal.getOrCreateForDate(TEST_STORE_ID, TEST_BUSINESS_DATE, TEST_USER_ID);

      // 2. Close day - queues day_close
      const closings: PackClosingData[] = [
        { pack_id: 'pack-1', closing_serial: '150', is_sold_out: true },
      ];
      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, TEST_USER_ID);

      // Verify both were queued
      const dayOpenItems = findSyncItemsByType('day_open');
      const dayCloseItems = findSyncItemsByType('day_close');

      expect(dayOpenItems).toHaveLength(1);
      expect(dayCloseItems).toHaveLength(1);

      // SYNC-001: day_open (20) > shift (10) > day_close (1)
      // Higher priority = processed first to prevent FK errors
      expect(dayOpenItems[0].priority).toBe(20);
      expect(dayCloseItems[0].priority).toBe(1);
      expect(dayOpenItems[0].priority!).toBeGreaterThan(dayCloseItems[0].priority!);

      db.close();
    });
  });

  // ==========================================================================
  // T5.4.3: Offline scenario
  // ==========================================================================
  describe('T5.4.3: Offline scenario', () => {
    it('should create day successfully when sync queue is unavailable', async () => {
      shouldEnqueueFail.value = true;

      const { LotteryBusinessDaysDAL } =
        await import('../../src/main/dal/lottery-business-days.dal');

      const Database = (await import('better-sqlite3')).default;
      const db = new Database(':memory:');

      db.exec(`
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
        CREATE TABLE stores (store_id TEXT PRIMARY KEY, company_id TEXT NOT NULL, name TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'America/New_York', status TEXT NOT NULL DEFAULT 'ACTIVE');
        INSERT INTO stores (store_id, company_id, name) VALUES ('${TEST_STORE_ID}', 'company-1', 'Test Store');
      `);

      const { getDatabase } = await import('../../src/main/services/database.service');
      (getDatabase as ReturnType<typeof vi.fn>).mockReturnValue(db);

      const dal = new LotteryBusinessDaysDAL();

      // Should not throw even though sync queue fails
      const day = dal.getOrCreateForDate(TEST_STORE_ID, TEST_BUSINESS_DATE, TEST_USER_ID);

      // Day should be created locally
      expect(day).toBeDefined();
      expect(day.status).toBe('OPEN');
      expect(day.store_id).toBe(TEST_STORE_ID);
      expect(day.business_date).toBe(TEST_BUSINESS_DATE);

      // Verify enqueue was called (and failed)
      expect(syncQueueDAL.enqueue).toHaveBeenCalled();

      db.close();
    });

    it('should allow subsequent day close after offline day open', async () => {
      const { LotteryBusinessDaysDAL } =
        await import('../../src/main/dal/lottery-business-days.dal');

      const Database = (await import('better-sqlite3')).default;
      const db = new Database(':memory:');

      db.exec(`
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
        CREATE TABLE lottery_packs (
          pack_id TEXT PRIMARY KEY,
          store_id TEXT NOT NULL,
          game_id TEXT NOT NULL,
          pack_number TEXT NOT NULL,
          current_bin_id TEXT,
          status TEXT NOT NULL DEFAULT 'RECEIVED',
          opening_serial TEXT,
          closing_serial TEXT,
          tickets_sold_count INTEGER NOT NULL DEFAULT 0,
          sales_amount REAL NOT NULL DEFAULT 0,
          activated_at TEXT,
          activated_by TEXT,
          depleted_at TEXT,
          depleted_by TEXT,
          depletion_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE lottery_games (
          game_id TEXT PRIMARY KEY,
          store_id TEXT NOT NULL,
          game_code TEXT NOT NULL,
          name TEXT NOT NULL,
          price REAL,
          tickets_per_pack INTEGER NOT NULL DEFAULT 300,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE lottery_bins (
          bin_id TEXT PRIMARY KEY,
          store_id TEXT NOT NULL,
          name TEXT NOT NULL,
          display_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE stores (store_id TEXT PRIMARY KEY, company_id TEXT NOT NULL, name TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'America/New_York', status TEXT NOT NULL DEFAULT 'ACTIVE');
        INSERT INTO stores (store_id, company_id, name) VALUES ('${TEST_STORE_ID}', 'company-1', 'Test Store');
        INSERT INTO lottery_games (game_id, store_id, game_code, name, price, tickets_per_pack, created_at, updated_at)
        VALUES ('game-123', '${TEST_STORE_ID}', '1001', 'Lucky 7s', 1.0, 300, datetime('now'), datetime('now'));
        INSERT INTO lottery_bins (bin_id, store_id, name, display_order, created_at, updated_at)
        VALUES ('bin-1', '${TEST_STORE_ID}', 'Bin 1', 1, datetime('now'), datetime('now'));
        INSERT INTO lottery_packs (pack_id, store_id, game_id, current_bin_id, pack_number, opening_serial, status, activated_at, created_at, updated_at)
        VALUES ('pack-1', '${TEST_STORE_ID}', 'game-123', 'bin-1', 'PKG001', '000', 'ACTIVE', datetime('now'), datetime('now'), datetime('now'));
      `);

      const { getDatabase } = await import('../../src/main/services/database.service');
      (getDatabase as ReturnType<typeof vi.fn>).mockReturnValue(db);

      const dal = new LotteryBusinessDaysDAL();

      // 1. Open day while "offline"
      shouldEnqueueFail.value = true;
      const day = dal.getOrCreateForDate(TEST_STORE_ID, TEST_BUSINESS_DATE, TEST_USER_ID);

      // 2. "Come back online" and close day
      shouldEnqueueFail.value = false;
      enqueueCallHistory.length = 0; // Clear history

      const closings: PackClosingData[] = [
        { pack_id: 'pack-1', closing_serial: '150', is_sold_out: true },
      ];
      dal.prepareClose(day.day_id, closings);
      dal.commitClose(day.day_id, TEST_USER_ID);

      // Day close should have been queued
      const dayCloseItems = findSyncItemsByType('day_close');
      expect(dayCloseItems).toHaveLength(1);

      db.close();
    });
  });

  // ==========================================================================
  // T5.4.4: Multiple stores isolation (DB-006)
  // ==========================================================================
  describe('T5.4.4: Multiple stores isolation (DB-006)', () => {
    it('should only include Store A data in Store A sync items', async () => {
      const { LotteryBusinessDaysDAL } =
        await import('../../src/main/dal/lottery-business-days.dal');

      const Database = (await import('better-sqlite3')).default;
      const db = new Database(':memory:');

      db.exec(`
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
        CREATE TABLE stores (store_id TEXT PRIMARY KEY, company_id TEXT NOT NULL, name TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'America/New_York', status TEXT NOT NULL DEFAULT 'ACTIVE');
        INSERT INTO stores (store_id, company_id, name) VALUES ('${TEST_STORE_ID}', 'company-1', 'Store A');
        INSERT INTO stores (store_id, company_id, name) VALUES ('${TEST_STORE_ID_2}', 'company-1', 'Store B');
      `);

      const { getDatabase } = await import('../../src/main/services/database.service');
      (getDatabase as ReturnType<typeof vi.fn>).mockReturnValue(db);

      const dal = new LotteryBusinessDaysDAL();

      // Create days for both stores
      const dayA = dal.getOrCreateForDate(TEST_STORE_ID, TEST_BUSINESS_DATE, TEST_USER_ID);
      const dayB = dal.getOrCreateForDate(TEST_STORE_ID_2, TEST_BUSINESS_DATE, 'user-store-b');

      // Verify both sync items exist
      const dayOpenItems = findSyncItemsByType('day_open');
      expect(dayOpenItems).toHaveLength(2);

      // Verify Store A sync item only contains Store A data
      const storeAItems = findSyncItemsByStore(TEST_STORE_ID);
      expect(storeAItems).toHaveLength(1);
      expect(storeAItems[0].entity_id).toBe(dayA.day_id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((storeAItems[0].payload as any).store_id).toBe(TEST_STORE_ID);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((storeAItems[0].payload as any).opened_by).toBe(TEST_USER_ID);

      // Verify Store B sync item only contains Store B data
      const storeBItems = findSyncItemsByStore(TEST_STORE_ID_2);
      expect(storeBItems).toHaveLength(1);
      expect(storeBItems[0].entity_id).toBe(dayB.day_id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((storeBItems[0].payload as any).store_id).toBe(TEST_STORE_ID_2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((storeBItems[0].payload as any).opened_by).toBe('user-store-b');

      // Verify no cross-store contamination
      const storeAPayload = JSON.stringify(storeAItems[0].payload);
      const storeBPayload = JSON.stringify(storeBItems[0].payload);
      expect(storeAPayload).not.toContain(TEST_STORE_ID_2);
      expect(storeBPayload).not.toContain(TEST_STORE_ID);

      db.close();
    });
  });

  // ==========================================================================
  // T5.4.5: Recovery from failed sync
  // ==========================================================================
  describe('T5.4.5: Recovery from failed sync', () => {
    it('should allow re-queuing a failed day_open sync', async () => {
      const { LotteryBusinessDaysDAL } =
        await import('../../src/main/dal/lottery-business-days.dal');

      const Database = (await import('better-sqlite3')).default;
      const db = new Database(':memory:');

      db.exec(`
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
        CREATE TABLE stores (store_id TEXT PRIMARY KEY, company_id TEXT NOT NULL, name TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'America/New_York', status TEXT NOT NULL DEFAULT 'ACTIVE');
        INSERT INTO stores (store_id, company_id, name) VALUES ('${TEST_STORE_ID}', 'company-1', 'Test Store');
      `);

      const { getDatabase } = await import('../../src/main/services/database.service');
      (getDatabase as ReturnType<typeof vi.fn>).mockReturnValue(db);

      const dal = new LotteryBusinessDaysDAL();

      // 1. Create day (initial sync queued)
      const day = dal.getOrCreateForDate(TEST_STORE_ID, TEST_BUSINESS_DATE, TEST_USER_ID);

      // 2. Simulate sync failure by clearing and re-queuing
      enqueueCallHistory.length = 0;

      // 3. Re-queue for sync recovery
      const result = dal.requeueDayOpenForSync(day.day_id, 'recovery-user');

      expect(result).toBe(true);

      // Verify new sync item was created
      const dayOpenItems = findSyncItemsByType('day_open');
      expect(dayOpenItems).toHaveLength(1);
      expect(dayOpenItems[0].entity_id).toBe(day.day_id);

      db.close();
    });

    it('should maintain data consistency after recovery', async () => {
      const { LotteryBusinessDaysDAL } =
        await import('../../src/main/dal/lottery-business-days.dal');

      const Database = (await import('better-sqlite3')).default;
      const db = new Database(':memory:');

      db.exec(`
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
        CREATE TABLE stores (store_id TEXT PRIMARY KEY, company_id TEXT NOT NULL, name TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'America/New_York', status TEXT NOT NULL DEFAULT 'ACTIVE');
        INSERT INTO stores (store_id, company_id, name) VALUES ('${TEST_STORE_ID}', 'company-1', 'Test Store');
      `);

      const { getDatabase } = await import('../../src/main/services/database.service');
      (getDatabase as ReturnType<typeof vi.fn>).mockReturnValue(db);

      const dal = new LotteryBusinessDaysDAL();

      // 1. Create day
      const day = dal.getOrCreateForDate(TEST_STORE_ID, TEST_BUSINESS_DATE, 'original-opener');

      // 2. Clear and re-queue
      enqueueCallHistory.length = 0;
      dal.requeueDayOpenForSync(day.day_id, 'recovery-user');

      // 3. Verify payload matches original day data
      const dayOpenItems = findSyncItemsByType('day_open');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload = dayOpenItems[0].payload as any;

      expect(payload.day_id).toBe(day.day_id);
      expect(payload.store_id).toBe(day.store_id);
      expect(payload.business_date).toBe(day.business_date);
      // Should use original opener, not recovery user
      expect(payload.opened_by).toBe('original-opener');

      db.close();
    });
  });
});
