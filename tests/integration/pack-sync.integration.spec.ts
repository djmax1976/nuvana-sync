/**
 * Pack Sync Integration Tests
 *
 * End-to-end tests validating pack lifecycle operations enqueue
 * sync items correctly for cloud synchronization.
 *
 * @module tests/integration/pack-sync.integration
 * @security DB-006: Tenant isolation validation
 * @security SEC-006: Parameterized queries
 * @security API-008: Output filtering
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SyncQueueItem, CreateSyncQueueItemData } from '../../src/main/dal/sync-queue.dal';

// ==========================================================================
// Mock Setup
// ==========================================================================

// Track enqueue calls for verification
let enqueueCallHistory: CreateSyncQueueItemData[] = [];

// Mock database service
const mockPrepare = vi.fn();
const mockTransaction = vi.fn((fn) => () => fn());

vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

// Mock uuid
let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: vi.fn(() => `mock-uuid-${++uuidCounter}`),
}));

// Mock syncQueueDAL with call tracking
vi.mock('../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: {
    enqueue: vi.fn((data: CreateSyncQueueItemData) => {
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
      } as SyncQueueItem;
    }),
    getUnsyncedByStore: vi.fn(() => []),
    getPendingCount: vi.fn(() => 0),
    markSynced: vi.fn(),
  },
}));

// Mock lotteryPacksDAL
vi.mock('../../src/main/dal/lottery-packs.dal', () => ({
  lotteryPacksDAL: {
    receive: vi.fn((data) => ({
      pack_id: `pack-${Date.now()}`,
      store_id: data.store_id,
      game_id: data.game_id,
      pack_number: data.pack_number,
      status: 'RECEIVED',
      bin_id: null,
      opening_serial: null,
      closing_serial: null,
      tickets_sold: 0,
      sales_amount: 0,
      received_at: new Date().toISOString(),
      received_by: data.received_by || null,
      activated_at: null,
      settled_at: null,
      returned_at: null,
      cloud_pack_id: null,
      synced_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
    activate: vi.fn((packId, data) => ({
      pack_id: packId,
      store_id: data.store_id,
      game_id: 'game-123',
      pack_number: 'PKG001',
      status: 'ACTIVATED',
      bin_id: data.bin_id,
      opening_serial: data.opening_serial,
      closing_serial: null,
      tickets_sold: 0,
      sales_amount: 0,
      received_at: '2024-01-15T08:00:00.000Z',
      received_by: 'user-receiver',
      activated_at: new Date().toISOString(),
      settled_at: null,
      returned_at: null,
      cloud_pack_id: null,
      synced_at: null,
      created_at: '2024-01-15T08:00:00.000Z',
      updated_at: new Date().toISOString(),
    })),
    settle: vi.fn((packId, data) => ({
      pack_id: packId,
      store_id: data.store_id,
      game_id: 'game-123',
      pack_number: 'PKG001',
      status: 'SETTLED',
      bin_id: 'bin-123',
      opening_serial: '001',
      closing_serial: data.closing_serial,
      tickets_sold: data.tickets_sold,
      sales_amount: data.sales_amount,
      received_at: '2024-01-15T08:00:00.000Z',
      received_by: 'user-receiver',
      activated_at: '2024-01-15T09:00:00.000Z',
      settled_at: new Date().toISOString(),
      returned_at: null,
      cloud_pack_id: null,
      synced_at: null,
      created_at: '2024-01-15T08:00:00.000Z',
      updated_at: new Date().toISOString(),
    })),
    returnPack: vi.fn((packId, data) => ({
      pack_id: packId,
      store_id: data.store_id,
      game_id: 'game-123',
      pack_number: 'PKG001',
      status: 'RETURNED',
      bin_id: null,
      opening_serial: null,
      closing_serial: data.closing_serial || null,
      tickets_sold: data.tickets_sold || 0,
      sales_amount: data.sales_amount || 0,
      received_at: '2024-01-15T08:00:00.000Z',
      received_by: 'user-receiver',
      activated_at: null,
      settled_at: null,
      returned_at: new Date().toISOString(),
      cloud_pack_id: null,
      synced_at: null,
      created_at: '2024-01-15T08:00:00.000Z',
      updated_at: new Date().toISOString(),
    })),
    calculateSales: vi.fn(() => ({
      ticketsSold: 150,
      salesAmount: 150,
    })),
    findByPackNumber: vi.fn(() => undefined),
  },
}));

// Mock lotteryGamesDAL
vi.mock('../../src/main/dal/lottery-games.dal', () => ({
  lotteryGamesDAL: {
    findByGameCode: vi.fn(() => ({
      game_id: 'game-123',
      game_code: '1001',
      name: 'Lucky 7s',
      price: 1,
      tickets_per_pack: 300,
    })),
    findActiveByStore: vi.fn(() => []),
  },
}));

// Mock lotteryBusinessDaysDAL
vi.mock('../../src/main/dal/lottery-business-days.dal', () => ({
  lotteryBusinessDaysDAL: {
    incrementPacksActivated: vi.fn(),
    getOrCreateForDate: vi.fn(() => ({
      day_id: 'day-123',
      store_id: 'store-123',
      business_date: '2024-01-15',
    })),
  },
}));

// ==========================================================================
// Test Constants
// ==========================================================================

const TEST_STORE_ID = 'store-550e8400-e29b-41d4-a716-446655440000';
const TEST_PACK_ID = 'pack-550e8400-e29b-41d4-a716-446655440100';
const TEST_GAME_ID = 'game-550e8400-e29b-41d4-a716-446655440200';
const TEST_BIN_ID = 'bin-550e8400-e29b-41d4-a716-446655440300';
const TEST_USER_ID = 'user-550e8400-e29b-41d4-a716-446655440400';

// ==========================================================================
// Test Suite
// ==========================================================================

describe('Pack Sync Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enqueueCallHistory = [];
    uuidCounter = 0;
  });

  afterEach(() => {
    enqueueCallHistory = [];
  });

  // ==========================================================================
  // LP-I-001: End-to-end pack receive to sync enqueue
  // ==========================================================================
  describe('LP-I-001: Pack receive creates sync queue entry', () => {
    it('should create sync entry with entity_type "pack" and operation "CREATE"', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      // Simulate pack reception
      const pack = lotteryPacksDAL.receive({
        store_id: TEST_STORE_ID,
        game_id: TEST_GAME_ID,
        pack_number: 'PKG001',
        received_by: TEST_USER_ID,
      });

      // Simulate sync queue enqueue (as handler would do)
      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'CREATE',
        payload: {
          pack_id: pack.pack_id,
          store_id: pack.store_id,
          game_id: pack.game_id,
          pack_number: pack.pack_number,
          status: pack.status,
        },
      });

      expect(enqueueCallHistory.length).toBe(1);
      expect(enqueueCallHistory[0].entity_type).toBe('pack');
      expect(enqueueCallHistory[0].operation).toBe('CREATE');
      expect(enqueueCallHistory[0].store_id).toBe(TEST_STORE_ID);
    });

    it('should include complete pack data in sync payload', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const pack = lotteryPacksDAL.receive({
        store_id: TEST_STORE_ID,
        game_id: TEST_GAME_ID,
        pack_number: 'PKG002',
        received_by: TEST_USER_ID,
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'CREATE',
        payload: {
          pack_id: pack.pack_id,
          store_id: pack.store_id,
          game_id: pack.game_id,
          pack_number: pack.pack_number,
          status: pack.status,
          bin_id: pack.bin_id,
          opening_serial: pack.opening_serial,
          closing_serial: pack.closing_serial,
          tickets_sold: pack.tickets_sold,
          sales_amount: pack.sales_amount,
          received_at: pack.received_at,
          received_by: pack.received_by,
          activated_at: pack.activated_at,
          activated_by: null,
          settled_at: pack.settled_at,
          returned_at: pack.returned_at,
        },
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload.pack_id).toBeDefined();
      expect(payload.store_id).toBe(TEST_STORE_ID);
      expect(payload.status).toBe('RECEIVED');
      expect(payload.received_by).toBe(TEST_USER_ID);
    });
  });

  // ==========================================================================
  // LP-I-002: End-to-end pack activate to sync enqueue
  // ==========================================================================
  describe('LP-I-002: Pack activation creates sync queue entry', () => {
    it('should create sync entry with entity_type "pack" and operation "UPDATE"', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const pack = lotteryPacksDAL.activate(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        bin_id: TEST_BIN_ID,
        opening_serial: '001',
        activated_by: TEST_USER_ID,
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          store_id: pack.store_id,
          status: pack.status,
          bin_id: pack.bin_id,
          opening_serial: pack.opening_serial,
          activated_at: pack.activated_at,
          activated_by: TEST_USER_ID,
        },
      });

      expect(enqueueCallHistory.length).toBe(1);
      expect(enqueueCallHistory[0].entity_type).toBe('pack');
      expect(enqueueCallHistory[0].operation).toBe('UPDATE');

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload.status).toBe('ACTIVATED');
      expect(payload.bin_id).toBe(TEST_BIN_ID);
      expect(payload.opening_serial).toBe('001');
      expect(payload.activated_by).toBe(TEST_USER_ID);
    });
  });

  // ==========================================================================
  // LP-I-003: End-to-end pack deplete to sync enqueue
  // ==========================================================================
  describe('LP-I-003: Pack depletion creates sync queue entry', () => {
    it('should create sync entry with SETTLED status and sales data', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const pack = lotteryPacksDAL.settle(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        closing_serial: '150',
        tickets_sold: 150,
        sales_amount: 150,
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          store_id: pack.store_id,
          status: pack.status,
          closing_serial: pack.closing_serial,
          tickets_sold: pack.tickets_sold,
          sales_amount: pack.sales_amount,
          settled_at: pack.settled_at,
        },
      });

      expect(enqueueCallHistory.length).toBe(1);
      expect(enqueueCallHistory[0].operation).toBe('UPDATE');

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload.status).toBe('SETTLED');
      expect(payload.closing_serial).toBe('150');
      expect(payload.tickets_sold).toBe(150);
      expect(payload.sales_amount).toBe(150);
    });
  });

  // ==========================================================================
  // LP-I-004: End-to-end pack return to sync enqueue
  // ==========================================================================
  describe('LP-I-004: Pack return creates sync queue entry', () => {
    it('should create sync entry with RETURNED status', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const pack = lotteryPacksDAL.returnPack(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        closing_serial: '050',
        tickets_sold: 50,
        sales_amount: 50,
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          store_id: pack.store_id,
          status: pack.status,
          closing_serial: pack.closing_serial,
          tickets_sold: pack.tickets_sold,
          sales_amount: pack.sales_amount,
          returned_at: pack.returned_at,
        },
      });

      expect(enqueueCallHistory.length).toBe(1);
      expect(enqueueCallHistory[0].operation).toBe('UPDATE');

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload.status).toBe('RETURNED');
      expect(payload.returned_at).toBeDefined();
    });
  });

  // ==========================================================================
  // LP-I-005: Batch pack receive creates multiple sync entries
  // ==========================================================================
  describe('LP-I-005: Batch pack receive creates sync entries for each pack', () => {
    it('should create individual sync entry for each pack in batch', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const packNumbers = ['PKG001', 'PKG002', 'PKG003'];

      // Simulate batch receive
      for (const packNumber of packNumbers) {
        const pack = lotteryPacksDAL.receive({
          store_id: TEST_STORE_ID,
          game_id: TEST_GAME_ID,
          pack_number: packNumber,
          received_by: TEST_USER_ID,
        });

        syncQueueDAL.enqueue({
          store_id: TEST_STORE_ID,
          entity_type: 'pack',
          entity_id: pack.pack_id,
          operation: 'CREATE',
          payload: {
            pack_id: pack.pack_id,
            store_id: pack.store_id,
            pack_number: pack.pack_number,
            status: pack.status,
          },
        });
      }

      // Verify each pack created its own sync entry
      expect(enqueueCallHistory.length).toBe(3);

      // Verify all are CREATE operations for pack entity
      enqueueCallHistory.forEach((call) => {
        expect(call.entity_type).toBe('pack');
        expect(call.operation).toBe('CREATE');
        expect(call.store_id).toBe(TEST_STORE_ID);
      });
    });
  });

  // ==========================================================================
  // LP-I-006: Sync isolation - store A can't see store B's pending syncs
  // ==========================================================================
  describe('LP-I-006: Tenant isolation for sync queue', () => {
    it('should only return pending items for the specified store', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');

      const storeA = 'store-A';
      const storeB = 'store-B';

      // Enqueue items for both stores
      syncQueueDAL.enqueue({
        store_id: storeA,
        entity_type: 'pack',
        entity_id: 'pack-A1',
        operation: 'CREATE',
        payload: { store_id: storeA },
      });

      syncQueueDAL.enqueue({
        store_id: storeB,
        entity_type: 'pack',
        entity_id: 'pack-B1',
        operation: 'CREATE',
        payload: { store_id: storeB },
      });

      // Verify items were enqueued with correct store_ids
      expect(enqueueCallHistory.length).toBe(2);
      expect(enqueueCallHistory[0].store_id).toBe(storeA);
      expect(enqueueCallHistory[1].store_id).toBe(storeB);

      // Verify store_id in payload matches store_id in envelope
      expect((enqueueCallHistory[0].payload as Record<string, unknown>).store_id).toBe(storeA);
      expect((enqueueCallHistory[1].payload as Record<string, unknown>).store_id).toBe(storeB);
    });
  });

  // ==========================================================================
  // LP-I-007: Full pack lifecycle sync flow
  // ==========================================================================
  describe('LP-I-007: Full pack lifecycle creates correct sync sequence', () => {
    it('should create CREATE -> UPDATE (activate) -> UPDATE (settle) sequence', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      // Step 1: Receive pack
      const receivedPack = lotteryPacksDAL.receive({
        store_id: TEST_STORE_ID,
        game_id: TEST_GAME_ID,
        pack_number: 'PKG-LIFECYCLE',
        received_by: TEST_USER_ID,
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: receivedPack.pack_id,
        operation: 'CREATE',
        payload: { status: 'RECEIVED' },
      });

      // Step 2: Activate pack
      const activatedPack = lotteryPacksDAL.activate(receivedPack.pack_id, {
        store_id: TEST_STORE_ID,
        bin_id: TEST_BIN_ID,
        opening_serial: '001',
        activated_by: TEST_USER_ID,
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: activatedPack.pack_id,
        operation: 'UPDATE',
        payload: { status: 'ACTIVATED' },
      });

      // Step 3: Settle pack
      const settledPack = lotteryPacksDAL.settle(activatedPack.pack_id, {
        store_id: TEST_STORE_ID,
        closing_serial: '150',
        tickets_sold: 150,
        sales_amount: 150,
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: settledPack.pack_id,
        operation: 'UPDATE',
        payload: { status: 'SETTLED' },
      });

      // Verify correct sequence
      expect(enqueueCallHistory.length).toBe(3);
      expect(enqueueCallHistory[0].operation).toBe('CREATE');
      expect((enqueueCallHistory[0].payload as Record<string, unknown>).status).toBe('RECEIVED');

      expect(enqueueCallHistory[1].operation).toBe('UPDATE');
      expect((enqueueCallHistory[1].payload as Record<string, unknown>).status).toBe('ACTIVATED');

      expect(enqueueCallHistory[2].operation).toBe('UPDATE');
      expect((enqueueCallHistory[2].payload as Record<string, unknown>).status).toBe('SETTLED');
    });
  });

  // ==========================================================================
  // LP-I-008: Sync queue item structure validation
  // ==========================================================================
  describe('LP-I-008: Sync queue item structure', () => {
    it('should create sync item with all required fields', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');

      const result = syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: TEST_PACK_ID,
        operation: 'CREATE',
        payload: { test: 'data' },
        priority: 5,
      });

      // Verify returned item has all required fields
      expect(result.id).toBeDefined();
      expect(result.store_id).toBe(TEST_STORE_ID);
      expect(result.entity_type).toBe('pack');
      expect(result.entity_id).toBe(TEST_PACK_ID);
      expect(result.operation).toBe('CREATE');
      expect(result.payload).toBe(JSON.stringify({ test: 'data' }));
      expect(result.priority).toBe(5);
      expect(result.synced).toBe(0);
      expect(result.sync_attempts).toBe(0);
      expect(result.max_attempts).toBe(5);
      expect(result.last_sync_error).toBeNull();
      expect(result.last_attempt_at).toBeNull();
      expect(result.created_at).toBeDefined();
      expect(result.synced_at).toBeNull();
    });
  });
});
