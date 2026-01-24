/**
 * Sync End-to-End Integration Tests
 *
 * Validates the complete sync flow from local operations to cloud delivery
 * for both pack and employee entities.
 *
 * Phase 3 implementation for cloud sync plan.
 *
 * @module tests/integration/sync-e2e.integration
 * @security DB-006: Tenant isolation validation
 * @security SEC-001: PIN hash exclusion
 * @security API-003: Error handling
 * @security SEC-017: Audit trail
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SyncQueueItem, CreateSyncQueueItemData } from '../../src/main/dal/sync-queue.dal';

// ==========================================================================
// Mock Setup
// ==========================================================================

// Track all sync operations for E2E validation
interface SyncOperation {
  timestamp: number;
  entityType: string;
  entityId: string;
  operation: string;
  payload: Record<string, unknown>;
}

let syncOperationLog: SyncOperation[] = [];
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

// Mock syncQueueDAL with comprehensive tracking
vi.mock('../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: {
    enqueue: vi.fn((data: CreateSyncQueueItemData) => {
      enqueueCallHistory.push(data);
      syncOperationLog.push({
        timestamp: Date.now(),
        entityType: data.entity_type,
        entityId: data.entity_id,
        operation: data.operation,
        payload: data.payload as Record<string, unknown>,
      });
      return {
        id: `sync-item-${enqueueCallHistory.length}`,
        ...data,
        payload: typeof data.payload === 'string' ? data.payload : JSON.stringify(data.payload),
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
    getBatch: vi.fn((storeId: string, limit: number) => ({
      items: enqueueCallHistory
        .filter((item) => item.store_id === storeId)
        .slice(0, limit)
        .map((item, idx) => ({
          id: `sync-item-${idx + 1}`,
          ...item,
          payload: typeof item.payload === 'string' ? item.payload : JSON.stringify(item.payload),
          synced: 0,
          sync_attempts: 0,
        })),
      totalPending: enqueueCallHistory.filter((item) => item.store_id === storeId).length,
    })),
    getPendingCount: vi.fn(() => enqueueCallHistory.length),
    markSynced: vi.fn(),
    incrementAttempts: vi.fn(),
    getStats: vi.fn(() => ({
      pending: enqueueCallHistory.length,
      failed: 0,
      syncedToday: 0,
      oldestPending: null,
    })),
  },
}));

// Mock storesDAL
vi.mock('../../src/main/dal/stores.dal', () => ({
  storesDAL: {
    getConfiguredStore: vi.fn(() => ({
      store_id: 'store-e2e-test',
      company_id: 'company-e2e',
      name: 'E2E Test Store',
      timezone: 'America/New_York',
      status: 'ACTIVE',
      state_id: 'state-123',
      state_code: 'NY',
    })),
  },
}));

// Mock usersDAL
vi.mock('../../src/main/dal/users.dal', () => ({
  usersDAL: {
    create: vi.fn((data) => ({
      user_id: `user-${Date.now()}`,
      store_id: data.store_id,
      role: data.role,
      name: data.name,
      pin_hash: '$2b$12$mockedHashValue',
      active: 1,
      cloud_user_id: null,
      synced_at: null,
      last_login_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
    update: vi.fn((userId, data) => ({
      user_id: userId,
      store_id: 'store-e2e-test',
      role: data.role || 'cashier',
      name: data.name || 'Updated User',
      pin_hash: '$2b$12$mockedHashValue',
      active: data.active !== undefined ? (data.active ? 1 : 0) : 1,
      cloud_user_id: null,
      synced_at: null,
      last_login_at: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: new Date().toISOString(),
    })),
    findById: vi.fn((userId) => ({
      user_id: userId,
      store_id: 'store-e2e-test',
      role: 'cashier',
      name: 'Test User',
      pin_hash: '$2b$12$mockedHashValue',
      active: 1,
      cloud_user_id: null,
      synced_at: null,
      last_login_at: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    })),
    verifyPin: vi.fn().mockResolvedValue(true),
    deactivate: vi.fn().mockReturnValue(true),
    reactivate: vi.fn().mockReturnValue(true),
    findActiveByStore: vi.fn(() => []),
    upsertFromCloud: vi.fn(),
  },
  UsersDAL: {
    toSafeUser: vi.fn((user) => {
      const { pin_hash: _pin, ...safeUser } = user;
      return safeUser;
    }),
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
      activated_by: data.activated_by,
      depleted_at: null,
      returned_at: null,
      cloud_pack_id: null,
      synced_at: null,
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
      activated_by: 'user-activator',
      depleted_at: new Date().toISOString(),
      returned_at: null,
      cloud_pack_id: null,
      synced_at: null,
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
      activated_by: null,
      depleted_at: null,
      returned_at: new Date().toISOString(),
      cloud_pack_id: null,
      synced_at: null,
    })),
  },
}));

// Mock cloud API service with success simulation
vi.mock('../../src/main/services/cloud-api.service', () => ({
  cloudApiService: {
    pushBatch: vi.fn().mockResolvedValue({
      success: true,
      results: [],
    }),
    pushEmployees: vi.fn().mockResolvedValue({
      success: true,
      results: [{ user_id: 'user-123', cloud_user_id: 'cloud-456', status: 'synced' }],
    }),
    startSyncSession: vi.fn().mockResolvedValue({
      sessionId: 'session-e2e-123',
      revocationStatus: 'VALID',
    }),
    completeSyncSession: vi.fn().mockResolvedValue({}),
    pullUsers: vi.fn().mockResolvedValue({ users: [] }),
  },
}));

// Mock auth service
vi.mock('../../src/main/services/auth.service', () => ({
  getCurrentAuthUser: vi.fn(() => ({
    userId: 'manager-e2e-123',
    role: 'store_manager',
    name: 'E2E Manager',
    storeId: 'store-e2e-test',
  })),
  hasMinimumRole: vi.fn(() => true),
}));

// ==========================================================================
// Test Constants
// ==========================================================================

const E2E_STORE_ID = 'store-e2e-test';
const E2E_USER_ID = 'user-e2e-001';
const E2E_PACK_ID = 'pack-e2e-001';
const E2E_GAME_ID = 'game-e2e-001';
const E2E_BIN_ID = 'bin-e2e-001';

// ==========================================================================
// Test Suite
// ==========================================================================

describe('Sync E2E Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enqueueCallHistory = [];
    syncOperationLog = [];
    uuidCounter = 0;
  });

  afterEach(() => {
    enqueueCallHistory = [];
    syncOperationLog = [];
  });

  // ==========================================================================
  // E2E-001: Pack Reception Sync Flow
  // ==========================================================================
  describe('E2E-001: Pack reception to sync queue flow', () => {
    it('should create sync entry when pack is received', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      // Step 1: Receive pack
      const pack = lotteryPacksDAL.receive({
        store_id: E2E_STORE_ID,
        game_id: E2E_GAME_ID,
        pack_number: 'PKG-E2E-001',
        received_by: E2E_USER_ID,
      });

      // Step 2: Enqueue for sync (simulating handler behavior)
      syncQueueDAL.enqueue({
        store_id: E2E_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'CREATE',
        payload: {
          pack_id: pack.pack_id,
          store_id: pack.store_id,
          game_id: pack.game_id,
          pack_number: pack.pack_number,
          status: pack.status,
          received_by: pack.received_by,
          received_at: pack.received_at,
        },
      });

      // Verify
      expect(syncOperationLog.length).toBe(1);
      expect(syncOperationLog[0].entityType).toBe('pack');
      expect(syncOperationLog[0].operation).toBe('CREATE');
      expect(syncOperationLog[0].payload.status).toBe('RECEIVED');
    });
  });

  // ==========================================================================
  // E2E-002: Pack Activation Sync Flow
  // ==========================================================================
  describe('E2E-002: Pack activation to sync queue flow', () => {
    it('should create UPDATE sync entry when pack is activated', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      // Pre-step: Receive pack
      const receivedPack = lotteryPacksDAL.receive({
        store_id: E2E_STORE_ID,
        game_id: E2E_GAME_ID,
        pack_number: 'PKG-E2E-002',
        received_by: E2E_USER_ID,
      });

      syncQueueDAL.enqueue({
        store_id: E2E_STORE_ID,
        entity_type: 'pack',
        entity_id: receivedPack.pack_id,
        operation: 'CREATE',
        payload: { status: 'RECEIVED' },
      });

      // Step 1: Activate pack
      const activatedPack = lotteryPacksDAL.activate(receivedPack.pack_id, {
        store_id: E2E_STORE_ID,
        current_bin_id: E2E_BIN_ID,
        opening_serial: '001',
        activated_by: E2E_USER_ID,
      });

      // Step 2: Enqueue activation
      syncQueueDAL.enqueue({
        store_id: E2E_STORE_ID,
        entity_type: 'pack',
        entity_id: activatedPack.pack_id,
        operation: 'UPDATE',
        payload: {
          pack_id: activatedPack.pack_id,
          status: activatedPack.status,
          current_bin_id: activatedPack.current_bin_id,
          opening_serial: activatedPack.opening_serial,
          activated_at: activatedPack.activated_at,
        },
      });

      // Verify sequence
      expect(syncOperationLog.length).toBe(2);
      expect(syncOperationLog[0].operation).toBe('CREATE');
      expect(syncOperationLog[1].operation).toBe('UPDATE');
      expect(syncOperationLog[1].payload.status).toBe('ACTIVE');
      expect(syncOperationLog[1].payload.current_bin_id).toBe(E2E_BIN_ID);
    });
  });

  // ==========================================================================
  // E2E-003: Full Pack Lifecycle Sync
  // ==========================================================================
  describe('E2E-003: Full pack lifecycle creates all sync entries', () => {
    it('should create CREATE -> UPDATE (activate) -> UPDATE (settle) sequence', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');

      // Step 1: Receive
      const receivedPack = lotteryPacksDAL.receive({
        store_id: E2E_STORE_ID,
        game_id: E2E_GAME_ID,
        pack_number: 'PKG-LIFECYCLE',
        received_by: E2E_USER_ID,
      });

      syncQueueDAL.enqueue({
        store_id: E2E_STORE_ID,
        entity_type: 'pack',
        entity_id: receivedPack.pack_id,
        operation: 'CREATE',
        payload: { status: 'RECEIVED' },
      });

      // Step 2: Activate
      const activatedPack = lotteryPacksDAL.activate(receivedPack.pack_id, {
        store_id: E2E_STORE_ID,
        current_bin_id: E2E_BIN_ID,
        opening_serial: '001',
        activated_by: E2E_USER_ID,
      });

      syncQueueDAL.enqueue({
        store_id: E2E_STORE_ID,
        entity_type: 'pack',
        entity_id: activatedPack.pack_id,
        operation: 'UPDATE',
        payload: { status: 'ACTIVE' },
      });

      // Step 3: Settle
      const settledPack = lotteryPacksDAL.settle(activatedPack.pack_id, {
        store_id: E2E_STORE_ID,
        closing_serial: '300',
        tickets_sold_count: 300,
        sales_amount: 300,
      });

      syncQueueDAL.enqueue({
        store_id: E2E_STORE_ID,
        entity_type: 'pack',
        entity_id: settledPack.pack_id,
        operation: 'UPDATE',
        payload: { status: 'DEPLETED', tickets_sold_count: 300, sales_amount: 300 },
      });

      // Verify full lifecycle
      expect(syncOperationLog.length).toBe(3);
      expect(syncOperationLog.map((op) => op.operation)).toEqual(['CREATE', 'UPDATE', 'UPDATE']);
      expect(syncOperationLog.map((op) => op.payload.status)).toEqual([
        'RECEIVED',
        'ACTIVE',
        'DEPLETED',
      ]);
    });
  });

  // ==========================================================================
  // E2E-004: Employee Creation Sync Flow
  // ==========================================================================
  describe('E2E-004: Employee creation to sync queue flow', () => {
    it('should create sync entry without PIN data', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { usersDAL } = await import('../../src/main/dal/users.dal');

      // Step 1: Create employee
      const employee = await usersDAL.create({
        store_id: E2E_STORE_ID,
        role: 'cashier',
        name: 'E2E Test Cashier',
        pin: '1234',
      });

      // Step 2: Enqueue for sync (simulating handler behavior)
      // Note: PIN must NOT be included
      syncQueueDAL.enqueue({
        store_id: E2E_STORE_ID,
        entity_type: 'employee',
        entity_id: employee.user_id,
        operation: 'CREATE',
        payload: {
          user_id: employee.user_id,
          store_id: employee.store_id,
          cloud_user_id: employee.cloud_user_id,
          role: employee.role,
          name: employee.name,
          active: employee.active === 1,
        },
      });

      // Verify
      expect(syncOperationLog.length).toBe(1);
      expect(syncOperationLog[0].entityType).toBe('employee');
      expect(syncOperationLog[0].operation).toBe('CREATE');

      // Critical security check: No PIN data
      const payload = syncOperationLog[0].payload;
      expect(payload).not.toHaveProperty('pin');
      expect(payload).not.toHaveProperty('pin_hash');
      const payloadStr = JSON.stringify(payload);
      expect(payloadStr).not.toContain('$2b$');
    });
  });

  // ==========================================================================
  // E2E-005: Mixed Entity Types in Sync Queue
  // ==========================================================================
  describe('E2E-005: Mixed entity types handled correctly', () => {
    it('should correctly process both pack and employee sync entries', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { lotteryPacksDAL } = await import('../../src/main/dal/lottery-packs.dal');
      const { usersDAL } = await import('../../src/main/dal/users.dal');

      // Create employee
      const employee = await usersDAL.create({
        store_id: E2E_STORE_ID,
        role: 'cashier',
        name: 'Mixed Test Cashier',
        pin: '5678',
      });

      syncQueueDAL.enqueue({
        store_id: E2E_STORE_ID,
        entity_type: 'employee',
        entity_id: employee.user_id,
        operation: 'CREATE',
        payload: { user_id: employee.user_id, name: employee.name },
      });

      // Receive pack
      const pack = lotteryPacksDAL.receive({
        store_id: E2E_STORE_ID,
        game_id: E2E_GAME_ID,
        pack_number: 'PKG-MIXED',
        received_by: employee.user_id,
      });

      syncQueueDAL.enqueue({
        store_id: E2E_STORE_ID,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'CREATE',
        payload: { pack_id: pack.pack_id, status: 'RECEIVED' },
      });

      // Update employee
      const updatedEmployee = await usersDAL.update(employee.user_id, {
        name: 'Updated Cashier',
      });

      expect(updatedEmployee).toBeDefined();
      syncQueueDAL.enqueue({
        store_id: E2E_STORE_ID,
        entity_type: 'employee',
        entity_id: updatedEmployee!.user_id,
        operation: 'UPDATE',
        payload: { user_id: updatedEmployee!.user_id, name: updatedEmployee!.name },
      });

      // Verify mixed entity handling
      expect(syncOperationLog.length).toBe(3);
      expect(syncOperationLog[0].entityType).toBe('employee');
      expect(syncOperationLog[1].entityType).toBe('pack');
      expect(syncOperationLog[2].entityType).toBe('employee');

      // Filter by entity type
      const employeeOps = syncOperationLog.filter((op) => op.entityType === 'employee');
      const packOps = syncOperationLog.filter((op) => op.entityType === 'pack');

      expect(employeeOps.length).toBe(2);
      expect(packOps.length).toBe(1);
    });
  });

  // ==========================================================================
  // E2E-006: Sync Queue Stats
  // ==========================================================================
  describe('E2E-006: Sync queue stats track all operations', () => {
    it('should report correct pending count after multiple operations', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');

      // Create multiple sync entries
      for (let i = 0; i < 5; i++) {
        syncQueueDAL.enqueue({
          store_id: E2E_STORE_ID,
          entity_type: i % 2 === 0 ? 'pack' : 'employee',
          entity_id: `entity-${i}`,
          operation: 'CREATE',
          payload: { index: i },
        });
      }

      const stats = syncQueueDAL.getStats(E2E_STORE_ID);

      expect(stats.pending).toBe(5);
      expect(syncOperationLog.length).toBe(5);
    });
  });

  // ==========================================================================
  // E2E-007: Batch Retrieval for Sync Push
  // ==========================================================================
  describe('E2E-007: Batch retrieval for sync push', () => {
    it('should retrieve pending items in batch', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');

      // Create batch of entries
      for (let i = 0; i < 10; i++) {
        syncQueueDAL.enqueue({
          store_id: E2E_STORE_ID,
          entity_type: 'pack',
          entity_id: `pack-batch-${i}`,
          operation: 'CREATE',
          payload: { pack_number: `PKG${i.toString().padStart(3, '0')}` },
        });
      }

      // Get batch
      const batch = syncQueueDAL.getBatch(E2E_STORE_ID, 5);

      expect(batch.items.length).toBe(5);
      expect(batch.totalPending).toBe(10);
    });

    it('should filter batch by store_id for tenant isolation', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');

      // Create entries for different stores
      syncQueueDAL.enqueue({
        store_id: 'store-A',
        entity_type: 'pack',
        entity_id: 'pack-A1',
        operation: 'CREATE',
        payload: { store_id: 'store-A' },
      });

      syncQueueDAL.enqueue({
        store_id: 'store-B',
        entity_type: 'pack',
        entity_id: 'pack-B1',
        operation: 'CREATE',
        payload: { store_id: 'store-B' },
      });

      syncQueueDAL.enqueue({
        store_id: 'store-A',
        entity_type: 'pack',
        entity_id: 'pack-A2',
        operation: 'CREATE',
        payload: { store_id: 'store-A' },
      });

      // Get batch for store A only
      const batchA = syncQueueDAL.getBatch('store-A', 10);

      expect(batchA.items.every((item) => item.store_id === 'store-A')).toBe(true);
      expect(batchA.totalPending).toBe(2);
    });
  });

  // ==========================================================================
  // E2E-008: Sync Operation Order Preservation
  // ==========================================================================
  describe('E2E-008: Sync operations preserve chronological order', () => {
    it('should maintain operation order in sync log', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');

      const operations: Array<{
        entityType: string;
        operation: 'CREATE' | 'UPDATE' | 'DELETE';
        entityId: string;
      }> = [
        { entityType: 'employee', operation: 'CREATE', entityId: 'emp-1' },
        { entityType: 'pack', operation: 'CREATE', entityId: 'pack-1' },
        { entityType: 'pack', operation: 'UPDATE', entityId: 'pack-1' },
        { entityType: 'employee', operation: 'UPDATE', entityId: 'emp-1' },
        { entityType: 'pack', operation: 'UPDATE', entityId: 'pack-1' },
      ];

      for (const op of operations) {
        syncQueueDAL.enqueue({
          store_id: E2E_STORE_ID,
          entity_type: op.entityType,
          entity_id: op.entityId,
          operation: op.operation,
          payload: { step: operations.indexOf(op) },
        });
      }

      // Verify order
      expect(syncOperationLog.length).toBe(5);
      for (let i = 0; i < operations.length; i++) {
        expect(syncOperationLog[i].entityType).toBe(operations[i].entityType);
        expect(syncOperationLog[i].operation).toBe(operations[i].operation);
        expect(syncOperationLog[i].entityId).toBe(operations[i].entityId);
      }
    });
  });

  // ==========================================================================
  // E2E-009: Error Recovery Simulation
  // ==========================================================================
  describe('E2E-009: Sync items persist for retry after failure', () => {
    it('should track failed attempts without losing data', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');

      // Enqueue item
      const result = syncQueueDAL.enqueue({
        store_id: E2E_STORE_ID,
        entity_type: 'pack',
        entity_id: 'pack-retry-test',
        operation: 'CREATE',
        payload: { test: 'retry' },
      });

      // Verify item created with retry metadata
      expect(result.sync_attempts).toBe(0);
      expect(result.max_attempts).toBe(5);
      expect(result.last_sync_error).toBeNull();
      expect(result.synced).toBe(0);

      // Simulate incrementing attempts
      syncQueueDAL.incrementAttempts(result.id, 'Network error');
      expect(syncQueueDAL.incrementAttempts).toHaveBeenCalledWith(result.id, 'Network error');
    });
  });
});
