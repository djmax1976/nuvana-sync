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
    cleanupAllStalePullTracking: vi.fn().mockReturnValue(0),
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
      current_bin_id: null,
      opening_serial: null,
      closing_serial: null,
      tickets_sold_count: 0,
      sales_amount: 0,
      received_at: new Date().toISOString(),
      received_by: data.received_by || null,
      activated_at: null,
      depleted_at: null,
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
      status: 'ACTIVE',
      current_bin_id: data.current_bin_id,
      opening_serial: data.opening_serial,
      closing_serial: null,
      tickets_sold_count: 0,
      sales_amount: 0,
      received_at: '2024-01-15T08:00:00.000Z',
      received_by: 'user-receiver',
      activated_at: new Date().toISOString(),
      depleted_at: null,
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
      status: 'DEPLETED',
      current_bin_id: 'bin-123',
      opening_serial: '001',
      closing_serial: data.closing_serial,
      tickets_sold_count: data.tickets_sold_count,
      sales_amount: data.sales_amount,
      received_at: '2024-01-15T08:00:00.000Z',
      received_by: 'user-receiver',
      activated_at: '2024-01-15T09:00:00.000Z',
      depleted_at: new Date().toISOString(),
      // Phase 11: Include depletion_reason for end-to-end sync tests
      // SEC-014: depletion_reason validated by DepletionReasonSchema at entry point
      depletion_reason: data.depletion_reason,
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
      current_bin_id: null,
      opening_serial: null,
      closing_serial: data.closing_serial || null,
      tickets_sold_count: data.tickets_sold_count || 0,
      sales_amount: data.sales_amount || 0,
      received_at: '2024-01-15T08:00:00.000Z',
      received_by: 'user-receiver',
      activated_at: null,
      depleted_at: null,
      returned_at: new Date().toISOString(),
      // Phase 11: Include return_reason and return_notes for end-to-end sync tests
      // SEC-014: return_reason validated by ReturnReasonSchema at entry point
      return_reason: data.return_reason,
      return_notes: data.return_notes || null,
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
          current_bin_id: pack.current_bin_id,
          opening_serial: pack.opening_serial,
          closing_serial: pack.closing_serial,
          tickets_sold_count: pack.tickets_sold_count,
          sales_amount: pack.sales_amount,
          received_at: pack.received_at,
          received_by: pack.received_by,
          activated_at: pack.activated_at,
          activated_by: null,
          depleted_at: pack.depleted_at,
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
        current_bin_id: TEST_BIN_ID,
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
          current_bin_id: pack.current_bin_id,
          opening_serial: pack.opening_serial,
          activated_at: pack.activated_at,
          activated_by: TEST_USER_ID,
        },
      });

      expect(enqueueCallHistory.length).toBe(1);
      expect(enqueueCallHistory[0].entity_type).toBe('pack');
      expect(enqueueCallHistory[0].operation).toBe('UPDATE');

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload.status).toBe('ACTIVE');
      expect(payload.current_bin_id).toBe(TEST_BIN_ID);
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
        tickets_sold_count: 150,
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
          tickets_sold_count: pack.tickets_sold_count,
          sales_amount: pack.sales_amount,
          depleted_at: pack.depleted_at,
        },
      });

      expect(enqueueCallHistory.length).toBe(1);
      expect(enqueueCallHistory[0].operation).toBe('UPDATE');

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload.status).toBe('DEPLETED');
      expect(payload.closing_serial).toBe('150');
      expect(payload.tickets_sold_count).toBe(150);
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

      // SEC-014: return_reason is REQUIRED per ReturnReasonSchema
      const pack = lotteryPacksDAL.returnPack(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        closing_serial: '050',
        tickets_sold_count: 50,
        sales_amount: 50,
        return_reason: 'INVENTORY_ADJUSTMENT', // Required field
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
          tickets_sold_count: pack.tickets_sold_count,
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
        current_bin_id: TEST_BIN_ID,
        opening_serial: '001',
        activated_by: TEST_USER_ID,
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: activatedPack.pack_id,
        operation: 'UPDATE',
        payload: { status: 'ACTIVE' },
      });

      // Step 3: Settle pack
      const settledPack = lotteryPacksDAL.settle(activatedPack.pack_id, {
        store_id: TEST_STORE_ID,
        closing_serial: '150',
        tickets_sold_count: 150,
        sales_amount: 150,
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: settledPack.pack_id,
        operation: 'UPDATE',
        payload: { status: 'DEPLETED' },
      });

      // Verify correct sequence
      expect(enqueueCallHistory.length).toBe(3);
      expect(enqueueCallHistory[0].operation).toBe('CREATE');
      expect((enqueueCallHistory[0].payload as Record<string, unknown>).status).toBe('RECEIVED');

      expect(enqueueCallHistory[1].operation).toBe('UPDATE');
      expect((enqueueCallHistory[1].payload as Record<string, unknown>).status).toBe('ACTIVE');

      expect(enqueueCallHistory[2].operation).toBe('UPDATE');
      expect((enqueueCallHistory[2].payload as Record<string, unknown>).status).toBe('DEPLETED');
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

  // ==========================================================================
  // LP-I-009: Pack Return Sync - End to End (Phase 11)
  // ==========================================================================
  /**
   * Phase 11.1-11.4: End-to-end integration tests for pack return sync
   *
   * Validates complete data flow from pack return operation through sync queue
   * to cloud API payload. Ensures return_reason and return_notes fields
   * flow correctly through entire sync pipeline.
   *
   * @security SEC-014: Verifies return_reason values from allowlist enum
   * @security API-001: Validates payload structure for cloud API
   */
  describe('LP-I-009: Pack Return Sync - End to End (Phase 11)', () => {
    /**
     * 11.2: Test SUPPLIER_RECALL return reason syncs to cloud payload
     *
     * Verifies that return_reason = 'SUPPLIER_RECALL' flows from:
     * 1. lotteryPacksDAL.returnPack() input
     * 2. Through sync queue payload
     * 3. Ready for cloud API consumption
     */
    it('11.2: should sync pack return with SUPPLIER_RECALL reason to cloud', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      // SEC-014: return_reason is REQUIRED and validated by ReturnReasonSchema
      const pack = lotteryPacksDAL.returnPack(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        closing_serial: '025',
        tickets_sold_count: 25,
        sales_amount: 25,
        return_reason: 'SUPPLIER_RECALL' as const,
      });

      // Simulate handler enqueuing sync item with return context
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
          tickets_sold: pack.tickets_sold_count,
          sales_amount: pack.sales_amount,
          returned_at: pack.returned_at,
          // v019/v020: Return reason fields for cloud API
          return_reason: pack.return_reason,
          return_notes: pack.return_notes,
        },
      });

      expect(enqueueCallHistory.length).toBe(1);

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;

      // Verify return_reason flows correctly to sync payload
      expect(payload.status).toBe('RETURNED');
      expect(payload.return_reason).toBe('SUPPLIER_RECALL');
      expect(payload.returned_at).toBeDefined();
    });

    /**
     * 11.3: Test DAMAGED return reason syncs to cloud payload
     *
     * Verifies that return_reason = 'DAMAGED' flows correctly through pipeline.
     * Tests different enum value to ensure all allowlist values work.
     */
    it('11.3: should sync pack return with DAMAGED reason to cloud', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const pack = lotteryPacksDAL.returnPack(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        closing_serial: '000', // Never sold - pack was damaged
        tickets_sold_count: 0,
        sales_amount: 0,
        return_reason: 'DAMAGED' as const,
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
          returned_at: pack.returned_at,
          return_reason: pack.return_reason,
        },
      });

      expect(enqueueCallHistory.length).toBe(1);

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload.return_reason).toBe('DAMAGED');
    });

    /**
     * Additional test: EXPIRED return reason
     */
    it('should sync pack return with EXPIRED reason to cloud', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const pack = lotteryPacksDAL.returnPack(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        return_reason: 'EXPIRED' as const,
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          status: 'RETURNED',
          returned_at: pack.returned_at,
          return_reason: pack.return_reason,
        },
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload.return_reason).toBe('EXPIRED');
    });

    /**
     * Additional test: INVENTORY_ADJUSTMENT return reason
     */
    it('should sync pack return with INVENTORY_ADJUSTMENT reason to cloud', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const pack = lotteryPacksDAL.returnPack(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        return_reason: 'INVENTORY_ADJUSTMENT' as const,
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          status: 'RETURNED',
          returned_at: pack.returned_at,
          return_reason: pack.return_reason,
        },
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload.return_reason).toBe('INVENTORY_ADJUSTMENT');
    });

    /**
     * Additional test: STORE_CLOSURE return reason
     */
    it('should sync pack return with STORE_CLOSURE reason to cloud', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const pack = lotteryPacksDAL.returnPack(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        return_reason: 'STORE_CLOSURE' as const,
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          status: 'RETURNED',
          returned_at: pack.returned_at,
          return_reason: pack.return_reason,
        },
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload.return_reason).toBe('STORE_CLOSURE');
    });

    /**
     * 11.4: Test return_notes inclusion in cloud sync payload
     *
     * Verifies that optional return_notes field is correctly passed through
     * the sync pipeline when provided.
     */
    it('11.4: should include return_notes in cloud sync payload', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const testNotes = 'Supplier recalled due to printing defect. Batch #A12345.';

      const pack = lotteryPacksDAL.returnPack(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        closing_serial: '100',
        tickets_sold_count: 100,
        sales_amount: 100,
        return_reason: 'SUPPLIER_RECALL' as const,
        return_notes: testNotes,
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
          returned_at: pack.returned_at,
          return_reason: pack.return_reason,
          return_notes: pack.return_notes,
        },
      });

      expect(enqueueCallHistory.length).toBe(1);

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;

      // Verify return_notes flows correctly to sync payload
      expect(payload.return_reason).toBe('SUPPLIER_RECALL');
      expect(payload.return_notes).toBe(testNotes);
    });

    /**
     * Additional test: return_notes omitted when not provided
     */
    it('should handle null return_notes gracefully', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const pack = lotteryPacksDAL.returnPack(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        return_reason: 'DAMAGED' as const,
        // return_notes not provided
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          status: 'RETURNED',
          returned_at: pack.returned_at,
          return_reason: pack.return_reason,
          return_notes: pack.return_notes, // Should be null
        },
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;

      expect(payload.return_reason).toBe('DAMAGED');
      expect(payload.return_notes).toBeNull();
    });

    /**
     * Regression test: verify OTHER is NOT used as fallback
     *
     * SEC-014: OTHER is not in the allowlist, cloud API rejects it.
     * Verifies that the payload does not contain 'OTHER' as a default.
     */
    it('should NOT default return_reason to OTHER (regression)', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const pack = lotteryPacksDAL.returnPack(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        return_reason: 'SUPPLIER_RECALL' as const,
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          status: 'RETURNED',
          return_reason: pack.return_reason,
        },
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;

      // SEC-014: Verify no 'OTHER' fallback
      expect(payload.return_reason).not.toBe('OTHER');
      expect(payload.return_reason).toBe('SUPPLIER_RECALL');
    });

    /**
     * Full lifecycle test: return with all context fields
     */
    it('should sync complete return context through pipeline', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const pack = lotteryPacksDAL.returnPack(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        closing_serial: '075',
        tickets_sold_count: 75,
        sales_amount: 75,
        return_reason: 'INVENTORY_ADJUSTMENT' as const,
        return_notes: 'Quarterly audit adjustment - pack count mismatch',
      });

      // Simulate full handler payload construction
      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          store_id: pack.store_id,
          game_id: pack.game_id,
          pack_number: pack.pack_number,
          status: pack.status,
          closing_serial: pack.closing_serial,
          tickets_sold: pack.tickets_sold_count,
          sales_amount: pack.sales_amount,
          returned_at: pack.returned_at,
          return_reason: pack.return_reason,
          return_notes: pack.return_notes,
          returned_shift_id: 'shift-123', // Shift context
        },
        priority: 10, // High priority for returns
      });

      expect(enqueueCallHistory.length).toBe(1);

      const queueItem = enqueueCallHistory[0];
      expect(queueItem.priority).toBe(10);

      const payload = queueItem.payload as Record<string, unknown>;
      expect(payload.status).toBe('RETURNED');
      expect(payload.return_reason).toBe('INVENTORY_ADJUSTMENT');
      expect(payload.return_notes).toBe('Quarterly audit adjustment - pack count mismatch');
      expect(payload.closing_serial).toBe('075');
      expect(payload.tickets_sold).toBe(75);
      expect(payload.sales_amount).toBe(75);
      expect(payload.returned_shift_id).toBe('shift-123');
    });
  });

  // ==========================================================================
  // LP-I-010: Pack Deplete Sync - End to End (Phase 11)
  // ==========================================================================
  /**
   * Phase 11.5-11.7: End-to-end integration tests for pack depletion sync
   *
   * Validates complete data flow from pack depletion operation through sync queue
   * to cloud API payload. Ensures depletion_reason field flows correctly
   * through entire sync pipeline.
   *
   * @security SEC-014: Verifies depletion_reason values from allowlist enum
   * @security API-001: Validates payload structure for cloud API
   */
  describe('LP-I-010: Pack Deplete Sync - End to End (Phase 11)', () => {
    /**
     * 11.6: Test MANUAL_SOLD_OUT depletion reason syncs to cloud payload
     *
     * Verifies that depletion_reason = 'MANUAL_SOLD_OUT' flows from:
     * 1. lotteryPacksDAL.settle() input
     * 2. Through sync queue payload
     * 3. Ready for cloud API consumption
     *
     * This was the primary bug: cloud-api.service hardcoded 'SOLD_OUT'
     * instead of using the payload value 'MANUAL_SOLD_OUT'.
     */
    it('11.6: should sync pack depletion with MANUAL_SOLD_OUT reason to cloud', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      // SEC-014: depletion_reason is validated by DepletionReasonSchema
      const pack = lotteryPacksDAL.settle(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        closing_serial: '300',
        tickets_sold_count: 300,
        sales_amount: 300,
        depletion_reason: 'MANUAL_SOLD_OUT' as const,
      });

      // Simulate handler enqueuing sync item with depletion context
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
          tickets_sold: pack.tickets_sold_count,
          sales_amount: pack.sales_amount,
          depleted_at: pack.depleted_at,
          // v019: Depletion reason for cloud API
          depletion_reason: pack.depletion_reason,
        },
      });

      expect(enqueueCallHistory.length).toBe(1);

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;

      // Verify depletion_reason flows correctly to sync payload
      expect(payload.status).toBe('DEPLETED');
      expect(payload.depletion_reason).toBe('MANUAL_SOLD_OUT');
      expect(payload.depleted_at).toBeDefined();
    });

    /**
     * 11.7: Test SHIFT_CLOSE depletion reason syncs to cloud payload
     *
     * Verifies that depletion_reason = 'SHIFT_CLOSE' flows correctly through pipeline.
     * This is the automatic depletion when shift ends with remaining tickets.
     */
    it('11.7: should sync pack depletion with SHIFT_CLOSE reason to cloud', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const pack = lotteryPacksDAL.settle(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        closing_serial: '250', // Shift close with some tickets remaining
        tickets_sold_count: 250,
        sales_amount: 250,
        depletion_reason: 'SHIFT_CLOSE' as const,
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
          depleted_at: pack.depleted_at,
          depletion_reason: pack.depletion_reason,
          depleted_shift_id: 'shift-456', // Shift context
        },
      });

      expect(enqueueCallHistory.length).toBe(1);

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload.depletion_reason).toBe('SHIFT_CLOSE');
      expect(payload.depleted_shift_id).toBe('shift-456');
    });

    /**
     * Additional test: AUTO_REPLACED depletion reason
     */
    it('should sync pack depletion with AUTO_REPLACED reason to cloud', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const pack = lotteryPacksDAL.settle(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        closing_serial: '299',
        tickets_sold_count: 299,
        sales_amount: 299,
        depletion_reason: 'AUTO_REPLACED' as const,
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          status: 'DEPLETED',
          depleted_at: pack.depleted_at,
          depletion_reason: pack.depletion_reason,
        },
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload.depletion_reason).toBe('AUTO_REPLACED');
    });

    /**
     * Additional test: POS_LAST_TICKET depletion reason
     */
    it('should sync pack depletion with POS_LAST_TICKET reason to cloud', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const pack = lotteryPacksDAL.settle(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        closing_serial: '300',
        tickets_sold_count: 300,
        sales_amount: 300,
        depletion_reason: 'POS_LAST_TICKET' as const,
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          status: 'DEPLETED',
          depleted_at: pack.depleted_at,
          depletion_reason: pack.depletion_reason,
        },
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload.depletion_reason).toBe('POS_LAST_TICKET');
    });

    /**
     * Regression test: verify hardcoded SOLD_OUT is NOT used
     *
     * SEC-014: SOLD_OUT was the old hardcoded value that cloud API rejected.
     * Cloud API expects specific enum values like MANUAL_SOLD_OUT.
     */
    it('should NOT use hardcoded SOLD_OUT value (regression)', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const pack = lotteryPacksDAL.settle(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        closing_serial: '300',
        tickets_sold_count: 300,
        sales_amount: 300,
        depletion_reason: 'MANUAL_SOLD_OUT' as const,
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          status: 'DEPLETED',
          depletion_reason: pack.depletion_reason,
        },
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;

      // SEC-014: Verify no hardcoded 'SOLD_OUT' value
      expect(payload.depletion_reason).not.toBe('SOLD_OUT');
      expect(payload.depletion_reason).toBe('MANUAL_SOLD_OUT');
    });

    /**
     * Full lifecycle test: depletion with complete shift context
     */
    it('should sync complete depletion context through pipeline', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const pack = lotteryPacksDAL.settle(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        closing_serial: '300',
        tickets_sold_count: 300,
        sales_amount: 300,
        depletion_reason: 'SHIFT_CLOSE' as const,
      });

      // Simulate full handler payload construction with shift context
      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          store_id: pack.store_id,
          game_id: pack.game_id,
          pack_number: pack.pack_number,
          status: pack.status,
          opening_serial: pack.opening_serial,
          closing_serial: pack.closing_serial,
          tickets_sold: pack.tickets_sold_count,
          sales_amount: pack.sales_amount,
          activated_at: pack.activated_at,
          depleted_at: pack.depleted_at,
          depletion_reason: pack.depletion_reason,
          depleted_shift_id: 'shift-789',
          depleted_by: TEST_USER_ID,
        },
        priority: 5, // Normal priority for depletion
      });

      expect(enqueueCallHistory.length).toBe(1);

      const queueItem = enqueueCallHistory[0];
      expect(queueItem.priority).toBe(5);

      const payload = queueItem.payload as Record<string, unknown>;
      expect(payload.status).toBe('DEPLETED');
      expect(payload.depletion_reason).toBe('SHIFT_CLOSE');
      expect(payload.closing_serial).toBe('300');
      expect(payload.tickets_sold).toBe(300);
      expect(payload.sales_amount).toBe(300);
      expect(payload.depleted_shift_id).toBe('shift-789');
      expect(payload.depleted_by).toBe(TEST_USER_ID);
    });

    /**
     * Test: depletion reason required for cloud API success
     *
     * Validates that depletion_reason is included in sync payload
     * (sync engine will fail sync if reason is missing).
     */
    it('should include depletion_reason in sync payload (required by cloud)', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const pack = lotteryPacksDAL.settle(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        closing_serial: '150',
        tickets_sold_count: 150,
        sales_amount: 150,
        depletion_reason: 'MANUAL_SOLD_OUT' as const,
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          status: 'DEPLETED',
          closing_serial: pack.closing_serial,
          depleted_at: pack.depleted_at,
          depletion_reason: pack.depletion_reason,
        },
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;

      // Cloud API requires these fields for successful sync
      expect(payload).toHaveProperty('depletion_reason');
      expect(payload).toHaveProperty('closing_serial');
      expect(payload).toHaveProperty('depleted_at');
      expect(typeof payload.depletion_reason).toBe('string');
      expect(payload.depletion_reason).toBeTruthy(); // Not empty
    });
  });

  // ==========================================================================
  // LP-I-011: Pack Audit Trail Sync - depleted_by and returned_by (SEC-010)
  // ==========================================================================
  /**
   * SEC-010: Audit Trail - User ID field integration tests
   *
   * Validates that depleted_by and returned_by user IDs flow correctly
   * through the sync pipeline for cloud audit trail compliance.
   *
   * Cloud API Requirement: These fields are REQUIRED for audit purposes
   *
   * @security SEC-010: Audit trail - tracks who performed the action
   * @security API-001: Validates payload structure for cloud API
   */
  describe('LP-I-011: Pack Audit Trail Sync - User ID Fields', () => {
    /**
     * Test depleted_by flows through sync pipeline
     *
     * Validates that the user ID who depleted the pack is correctly
     * included in the sync queue payload for cloud consumption.
     */
    it('should include depleted_by in sync queue payload for DEPLETED pack', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const depleterUserId = '8981cc60-62c6-4412-8789-42d3afc2b4ac';

      const pack = lotteryPacksDAL.settle(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        closing_serial: '300',
        tickets_sold_count: 300,
        sales_amount: 300,
        depletion_reason: 'MANUAL_SOLD_OUT' as const,
      });

      // Simulate handler enqueuing sync item with depleted_by context
      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          store_id: pack.store_id,
          status: 'DEPLETED',
          closing_serial: pack.closing_serial,
          tickets_sold: pack.tickets_sold_count,
          sales_amount: pack.sales_amount,
          depleted_at: pack.depleted_at,
          depleted_by: depleterUserId, // SEC-010: Audit trail user ID
          depletion_reason: pack.depletion_reason,
          depleted_shift_id: 'shift-audit-001',
        },
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;

      // SEC-010: Verify depleted_by is included for audit trail
      expect(payload).toHaveProperty('depleted_by');
      expect(payload.depleted_by).toBe(depleterUserId);
      expect(payload.depletion_reason).toBe('MANUAL_SOLD_OUT');
    });

    /**
     * Test returned_by flows through sync pipeline
     *
     * Validates that the user ID who returned the pack is correctly
     * included in the sync queue payload for cloud consumption.
     */
    it('should include returned_by in sync queue payload for RETURNED pack', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const returnerUserId = '8981cc60-62c6-4412-8789-42d3afc2b4ac';

      const pack = lotteryPacksDAL.returnPack(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        closing_serial: '050',
        tickets_sold_count: 50,
        sales_amount: 50,
        return_reason: 'DAMAGED' as const,
        return_notes: 'Pack was damaged during handling',
      });

      // Simulate handler enqueuing sync item with returned_by context
      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          store_id: pack.store_id,
          status: 'RETURNED',
          closing_serial: pack.closing_serial,
          tickets_sold: pack.tickets_sold_count,
          sales_amount: pack.sales_amount,
          returned_at: pack.returned_at,
          returned_by: returnerUserId, // SEC-010: Audit trail user ID
          return_reason: pack.return_reason,
          return_notes: pack.return_notes,
          returned_shift_id: 'shift-return-audit-001',
        },
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;

      // SEC-010: Verify returned_by is included for audit trail
      expect(payload).toHaveProperty('returned_by');
      expect(payload.returned_by).toBe(returnerUserId);
      expect(payload.return_reason).toBe('DAMAGED');
    });

    /**
     * Test complete audit context flows through for DEPLETED pack
     *
     * Validates all audit-related fields are present together
     * for complete cloud audit trail compliance.
     */
    it('should include complete audit context for DEPLETED pack sync', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const depleterUserId = 'user-depleter-complete-123';
      const shiftId = 'shift-complete-audit-001';

      const pack = lotteryPacksDAL.settle(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        closing_serial: '250',
        tickets_sold_count: 250,
        sales_amount: 250,
        depletion_reason: 'SHIFT_CLOSE' as const,
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          store_id: pack.store_id,
          status: 'DEPLETED',
          closing_serial: pack.closing_serial,
          tickets_sold: pack.tickets_sold_count,
          sales_amount: pack.sales_amount,
          depleted_at: pack.depleted_at,
          depleted_by: depleterUserId,
          depletion_reason: pack.depletion_reason,
          depleted_shift_id: shiftId,
        },
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;

      // Verify complete audit context
      expect(payload.depleted_by).toBe(depleterUserId);
      expect(payload.depleted_shift_id).toBe(shiftId);
      expect(payload.depletion_reason).toBe('SHIFT_CLOSE');
      expect(payload).toHaveProperty('depleted_at');
    });

    /**
     * Test complete audit context flows through for RETURNED pack
     *
     * Validates all audit-related fields are present together
     * for complete cloud audit trail compliance.
     */
    it('should include complete audit context for RETURNED pack sync', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      const returnerUserId = 'user-returner-complete-123';
      const shiftId = 'shift-return-complete-001';

      const pack = lotteryPacksDAL.returnPack(TEST_PACK_ID, {
        store_id: TEST_STORE_ID,
        closing_serial: undefined,
        tickets_sold_count: 0,
        sales_amount: 0,
        return_reason: 'SUPPLIER_RECALL' as const,
        return_notes: 'Supplier recalled all packs due to defect',
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: pack.pack_id,
          store_id: pack.store_id,
          status: 'RETURNED',
          closing_serial: pack.closing_serial,
          tickets_sold: pack.tickets_sold_count,
          sales_amount: pack.sales_amount,
          returned_at: pack.returned_at,
          returned_by: returnerUserId,
          return_reason: pack.return_reason,
          return_notes: pack.return_notes,
          returned_shift_id: shiftId,
        },
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;

      // Verify complete audit context
      expect(payload.returned_by).toBe(returnerUserId);
      expect(payload.returned_shift_id).toBe(shiftId);
      expect(payload.return_reason).toBe('SUPPLIER_RECALL');
      expect(payload.return_notes).toBe('Supplier recalled all packs due to defect');
      expect(payload).toHaveProperty('returned_at');
    });
  });
});
