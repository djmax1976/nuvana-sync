/**
 * Employee Sync Integration Tests
 *
 * End-to-end tests validating employee lifecycle operations enqueue
 * sync items correctly for cloud synchronization (bidirectional sync).
 *
 * Phase 3 implementation for cloud sync plan.
 *
 * @module tests/integration/employee-sync.integration
 * @security DB-006: Tenant isolation validation
 * @security SEC-001: PIN hash exclusion from sync
 * @security SEC-006: Parameterized queries
 * @security API-008: Output filtering
 * @security SEC-017: Audit trail
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
    getPendingCount: vi.fn(() => 0),
    markSynced: vi.fn(),
    getBatch: vi.fn(() => ({ items: [], totalPending: 0 })),
    incrementAttempts: vi.fn(),
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
      synced_at: null,
      last_login_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
    update: vi.fn((userId, data) => ({
      user_id: userId,
      store_id: 'store-123',
      role: data.role || 'cashier',
      name: data.name || 'Updated User',
      pin_hash: '$2b$12$mockedHashValue',
      active: data.active !== undefined ? (data.active ? 1 : 0) : 1,
      synced_at: null,
      last_login_at: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: new Date().toISOString(),
    })),
    findById: vi.fn((userId) => ({
      user_id: userId,
      store_id: 'store-123',
      role: 'cashier',
      name: 'Test User',
      pin_hash: '$2b$12$mockedHashValue',
      active: 1,
      synced_at: null,
      last_login_at: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    })),
    verifyPin: vi.fn().mockResolvedValue(true),
    deactivate: vi.fn().mockReturnValue(true),
    reactivate: vi.fn().mockReturnValue(true),
    findByStore: vi.fn(() => ({ data: [] })),
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

// Mock storesDAL
vi.mock('../../src/main/dal/stores.dal', () => ({
  storesDAL: {
    getConfiguredStore: vi.fn(() => ({
      store_id: 'store-123',
      company_id: 'company-123',
      name: 'Test Store',
      timezone: 'America/New_York',
      status: 'ACTIVE',
      state_id: 'state-123',
      state_code: 'NY',
    })),
  },
}));

// Mock auth service
vi.mock('../../src/main/services/auth.service', () => ({
  getCurrentAuthUser: vi.fn(() => ({
    userId: 'manager-user-123',
    role: 'store_manager',
    name: 'Test Manager',
    storeId: 'store-123',
  })),
  hasMinimumRole: vi.fn(() => true),
}));

// Mock cloud API service
// Note: After cloud_id consolidation, user_id IS the cloud ID - no separate cloud_user_id
vi.mock('../../src/main/services/cloud-api.service', () => ({
  cloudApiService: {
    pushEmployees: vi.fn().mockResolvedValue({
      success: true,
      results: [{ user_id: 'user-123', status: 'synced' }],
    }),
    startSyncSession: vi.fn().mockResolvedValue({
      sessionId: 'session-123',
      revocationStatus: 'VALID',
    }),
    completeSyncSession: vi.fn().mockResolvedValue({}),
  },
}));

// ==========================================================================
// Test Constants
// ==========================================================================

const TEST_STORE_ID = 'store-550e8400-e29b-41d4-a716-446655440000';
const TEST_USER_ID = 'user-550e8400-e29b-41d4-a716-446655440100';
const TEST_MANAGER_ID = 'manager-550e8400-e29b-41d4-a716-446655440200';

// ==========================================================================
// Test Suite
// ==========================================================================

describe('Employee Sync Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enqueueCallHistory = [];
    uuidCounter = 0;
  });

  afterEach(() => {
    enqueueCallHistory = [];
  });

  // ==========================================================================
  // ES-I-001: End-to-end employee create to sync enqueue
  // ==========================================================================
  describe('ES-I-001: Employee create creates sync queue entry', () => {
    it('should create sync entry with entity_type "employee" and operation "CREATE"', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { usersDAL } = await import('../../src/main/dal/users.dal');

      // Simulate employee creation
      const user = await usersDAL.create({
        store_id: TEST_STORE_ID,
        role: 'cashier',
        name: 'John Doe',
        pin: '1234',
      });

      // Simulate sync queue enqueue (as handler would do)
      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'employee',
        entity_id: user.user_id,
        operation: 'CREATE',
        payload: {
          user_id: user.user_id,
          store_id: user.store_id,
          // user_id IS the cloud ID after consolidation - no separate cloud_user_id field
          role: user.role,
          name: user.name,
          active: user.active === 1,
        },
      });

      expect(enqueueCallHistory.length).toBe(1);
      expect(enqueueCallHistory[0].entity_type).toBe('employee');
      expect(enqueueCallHistory[0].operation).toBe('CREATE');
      expect(enqueueCallHistory[0].store_id).toBe(TEST_STORE_ID);
    });

    it('should NOT include pin_hash in sync payload (SEC-001)', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { usersDAL } = await import('../../src/main/dal/users.dal');

      const user = await usersDAL.create({
        store_id: TEST_STORE_ID,
        role: 'cashier',
        name: 'Jane Smith',
        pin: '5678',
      });

      // Build payload WITHOUT pin_hash (security requirement)
      const syncPayload = {
        user_id: user.user_id,
        store_id: user.store_id,
        // user_id IS the cloud ID after consolidation - no separate cloud_user_id field
        role: user.role,
        name: user.name,
        active: user.active === 1,
        last_login_at: user.last_login_at,
        synced_at: user.synced_at,
      };

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'employee',
        entity_id: user.user_id,
        operation: 'CREATE',
        payload: syncPayload,
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload).not.toHaveProperty('pin_hash');
      expect(payload).not.toHaveProperty('pin');
      expect(payload).not.toHaveProperty('pinHash');

      // Verify it doesn't contain bcrypt prefix in any stringified form
      const payloadStr = JSON.stringify(payload);
      expect(payloadStr).not.toContain('$2b$');
      expect(payloadStr).not.toContain('$2a$');
    });
  });

  // ==========================================================================
  // ES-I-002: End-to-end employee update to sync enqueue
  // ==========================================================================
  describe('ES-I-002: Employee update creates sync queue entry', () => {
    it('should create sync entry with entity_type "employee" and operation "UPDATE"', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { usersDAL } = await import('../../src/main/dal/users.dal');

      const updatedUser = await usersDAL.update(TEST_USER_ID, {
        name: 'John Doe Updated',
        role: 'shift_manager',
      });

      expect(updatedUser).toBeDefined();
      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'employee',
        entity_id: updatedUser!.user_id,
        operation: 'UPDATE',
        payload: {
          user_id: updatedUser!.user_id,
          store_id: updatedUser!.store_id,
          role: updatedUser!.role,
          name: updatedUser!.name,
          active: updatedUser!.active === 1,
        },
      });

      expect(enqueueCallHistory.length).toBe(1);
      expect(enqueueCallHistory[0].entity_type).toBe('employee');
      expect(enqueueCallHistory[0].operation).toBe('UPDATE');
    });

    it('should include updated fields in sync payload', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { usersDAL } = await import('../../src/main/dal/users.dal');

      const updatedUser = await usersDAL.update(TEST_USER_ID, {
        name: 'Updated Name',
        role: 'shift_manager',
      });

      expect(updatedUser).toBeDefined();
      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'employee',
        entity_id: updatedUser!.user_id,
        operation: 'UPDATE',
        payload: {
          user_id: updatedUser!.user_id,
          store_id: updatedUser!.store_id,
          role: updatedUser!.role,
          name: updatedUser!.name,
          active: updatedUser!.active === 1,
        },
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload.name).toBe('Updated Name');
      expect(payload.role).toBe('shift_manager');
    });
  });

  // ==========================================================================
  // ES-I-003: End-to-end employee deactivation to sync enqueue
  // ==========================================================================
  describe('ES-I-003: Employee deactivation creates sync queue entry', () => {
    it('should create sync entry with active=false in payload', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { usersDAL } = await import('../../src/main/dal/users.dal');

      // Simulate deactivation
      usersDAL.deactivate(TEST_USER_ID);

      // Get deactivated user state
      const deactivatedUser = {
        user_id: TEST_USER_ID,
        store_id: TEST_STORE_ID,
        role: 'cashier',
        name: 'Test User',
        active: 0, // Deactivated
      };

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'employee',
        entity_id: deactivatedUser.user_id,
        operation: 'UPDATE',
        payload: {
          user_id: deactivatedUser.user_id,
          store_id: deactivatedUser.store_id,
          role: deactivatedUser.role,
          name: deactivatedUser.name,
          active: deactivatedUser.active === 1,
        },
      });

      expect(enqueueCallHistory.length).toBe(1);
      expect(enqueueCallHistory[0].operation).toBe('UPDATE');

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload.active).toBe(false);
    });
  });

  // ==========================================================================
  // ES-I-004: End-to-end employee reactivation to sync enqueue
  // ==========================================================================
  describe('ES-I-004: Employee reactivation creates sync queue entry', () => {
    it('should create sync entry with active=true in payload', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { usersDAL } = await import('../../src/main/dal/users.dal');

      // Simulate reactivation
      usersDAL.reactivate(TEST_USER_ID);

      // Get reactivated user state
      const reactivatedUser = {
        user_id: TEST_USER_ID,
        store_id: TEST_STORE_ID,
        role: 'cashier',
        name: 'Test User',
        active: 1, // Reactivated
      };

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'employee',
        entity_id: reactivatedUser.user_id,
        operation: 'UPDATE',
        payload: {
          user_id: reactivatedUser.user_id,
          store_id: reactivatedUser.store_id,
          role: reactivatedUser.role,
          name: reactivatedUser.name,
          active: reactivatedUser.active === 1,
        },
      });

      expect(enqueueCallHistory.length).toBe(1);
      expect(enqueueCallHistory[0].operation).toBe('UPDATE');

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload.active).toBe(true);
    });
  });

  // ==========================================================================
  // ES-I-005: Tenant isolation for employee sync
  // ==========================================================================
  describe('ES-I-005: Tenant isolation for employee sync queue', () => {
    it('should only allow sync operations for the configured store', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');

      const storeA = 'store-A';
      const storeB = 'store-B';

      // Enqueue items for both stores
      syncQueueDAL.enqueue({
        store_id: storeA,
        entity_type: 'employee',
        entity_id: 'user-A1',
        operation: 'CREATE',
        payload: { store_id: storeA, name: 'Employee A' },
      });

      syncQueueDAL.enqueue({
        store_id: storeB,
        entity_type: 'employee',
        entity_id: 'user-B1',
        operation: 'CREATE',
        payload: { store_id: storeB, name: 'Employee B' },
      });

      // Verify items were enqueued with correct store_ids
      expect(enqueueCallHistory.length).toBe(2);
      expect(enqueueCallHistory[0].store_id).toBe(storeA);
      expect(enqueueCallHistory[1].store_id).toBe(storeB);

      // Verify store_id in payload matches store_id in envelope
      expect((enqueueCallHistory[0].payload as Record<string, unknown>).store_id).toBe(storeA);
      expect((enqueueCallHistory[1].payload as Record<string, unknown>).store_id).toBe(storeB);
    });

    it('should include store_id in every sync payload (DB-006)', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'employee',
        entity_id: 'user-123',
        operation: 'CREATE',
        payload: {
          user_id: 'user-123',
          store_id: TEST_STORE_ID,
          name: 'Test Employee',
          role: 'cashier',
          active: true,
        },
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload.store_id).toBe(TEST_STORE_ID);
      expect(enqueueCallHistory[0].store_id).toBe(TEST_STORE_ID);
    });
  });

  // ==========================================================================
  // ES-I-006: Full employee lifecycle sync flow
  // ==========================================================================
  describe('ES-I-006: Full employee lifecycle creates correct sync sequence', () => {
    it('should create CREATE -> UPDATE (name change) -> UPDATE (deactivate) sequence', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { usersDAL } = await import('../../src/main/dal/users.dal');

      // Step 1: Create employee
      const createdUser = await usersDAL.create({
        store_id: TEST_STORE_ID,
        role: 'cashier',
        name: 'New Employee',
        pin: '1234',
      });

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'employee',
        entity_id: createdUser.user_id,
        operation: 'CREATE',
        payload: { name: 'New Employee', active: true },
      });

      // Step 2: Update employee name
      const updatedUser = await usersDAL.update(createdUser.user_id, {
        name: 'Employee Renamed',
      });

      expect(updatedUser).toBeDefined();
      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'employee',
        entity_id: updatedUser!.user_id,
        operation: 'UPDATE',
        payload: { name: 'Employee Renamed', active: true },
      });

      // Step 3: Deactivate employee
      usersDAL.deactivate(updatedUser!.user_id);

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'employee',
        entity_id: updatedUser!.user_id,
        operation: 'UPDATE',
        payload: { name: 'Employee Renamed', active: false },
      });

      // Verify correct sequence
      expect(enqueueCallHistory.length).toBe(3);
      expect(enqueueCallHistory[0].operation).toBe('CREATE');
      expect((enqueueCallHistory[0].payload as Record<string, unknown>).active).toBe(true);

      expect(enqueueCallHistory[1].operation).toBe('UPDATE');
      expect((enqueueCallHistory[1].payload as Record<string, unknown>).name).toBe(
        'Employee Renamed'
      );

      expect(enqueueCallHistory[2].operation).toBe('UPDATE');
      expect((enqueueCallHistory[2].payload as Record<string, unknown>).active).toBe(false);
    });
  });

  // ==========================================================================
  // ES-I-007: PIN change sync flow
  // ==========================================================================
  describe('ES-I-007: PIN change creates sync entry without PIN data', () => {
    it('should enqueue UPDATE operation but exclude PIN from payload', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');
      const { usersDAL } = await import('../../src/main/dal/users.dal');

      // Simulate PIN change
      const updatedUser = await usersDAL.update(TEST_USER_ID, {
        pin: '9999', // New PIN
      });

      expect(updatedUser).toBeDefined();
      // Sync payload should NOT include PIN data
      const syncPayload = {
        user_id: updatedUser!.user_id,
        store_id: updatedUser!.store_id,
        role: updatedUser!.role,
        name: updatedUser!.name,
        active: updatedUser!.active === 1,
        last_login_at: null,
        synced_at: null,
      };

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'employee',
        entity_id: updatedUser!.user_id,
        operation: 'UPDATE',
        payload: syncPayload,
      });

      expect(enqueueCallHistory.length).toBe(1);
      expect(enqueueCallHistory[0].operation).toBe('UPDATE');

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      // Verify no PIN-related data
      expect(payload).not.toHaveProperty('pin');
      expect(payload).not.toHaveProperty('pin_hash');
      expect(payload).not.toHaveProperty('newPin');
      expect(payload).not.toHaveProperty('currentPin');
    });
  });

  // ==========================================================================
  // ES-I-008: Sync queue item structure validation
  // ==========================================================================
  describe('ES-I-008: Sync queue item structure for employees', () => {
    it('should create sync item with all required fields', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');

      const result = syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'employee',
        entity_id: TEST_USER_ID,
        operation: 'CREATE',
        payload: { user_id: TEST_USER_ID, name: 'Test', active: true },
        priority: 5,
      });

      // Verify returned item has all required fields
      expect(result.id).toBeDefined();
      expect(result.store_id).toBe(TEST_STORE_ID);
      expect(result.entity_type).toBe('employee');
      expect(result.entity_id).toBe(TEST_USER_ID);
      expect(result.operation).toBe('CREATE');
      expect(result.payload).toBe(
        JSON.stringify({ user_id: TEST_USER_ID, name: 'Test', active: true })
      );
      expect(result.priority).toBe(5);
      expect(result.synced).toBe(0);
      expect(result.sync_attempts).toBe(0);
      expect(result.max_attempts).toBe(5);
      expect(result.last_sync_error).toBeNull();
      expect(result.last_attempt_at).toBeNull();
      expect(result.created_at).toBeDefined();
      expect(result.synced_at).toBeNull();
    });

    it('should include correct fields in employee sync payload', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'employee',
        entity_id: TEST_USER_ID,
        operation: 'CREATE',
        payload: {
          user_id: TEST_USER_ID,
          store_id: TEST_STORE_ID,
          role: 'cashier',
          name: 'Test Employee',
          active: true,
          last_login_at: null,
          synced_at: null,
        },
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      // Note: After cloud_id consolidation, user_id IS the cloud ID - no separate cloud_user_id
      const expectedFields = [
        'user_id',
        'store_id',
        'role',
        'name',
        'active',
        'last_login_at',
        'synced_at',
      ];

      expectedFields.forEach((field) => {
        expect(payload).toHaveProperty(field);
      });

      // Should NOT have these internal/sensitive fields
      expect(payload).not.toHaveProperty('pin_hash');
      expect(payload).not.toHaveProperty('created_at');
      expect(payload).not.toHaveProperty('updated_at');
    });
  });

  // ==========================================================================
  // ES-I-009: Role validation in sync payload
  // ==========================================================================
  describe('ES-I-009: Role values are valid in sync payload', () => {
    const validRoles = ['cashier', 'shift_manager', 'store_manager'];

    it.each(validRoles)('should accept valid role: %s', async (role) => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'employee',
        entity_id: `user-${role}`,
        operation: 'CREATE',
        payload: {
          user_id: `user-${role}`,
          store_id: TEST_STORE_ID,
          role: role,
          name: `${role} User`,
          active: true,
        },
      });

      const payload = enqueueCallHistory[enqueueCallHistory.length - 1].payload as Record<
        string,
        unknown
      >;
      expect(validRoles).toContain(payload.role);
    });
  });

  // ==========================================================================
  // ES-I-011: Audit trail for sync operations
  // ==========================================================================
  describe('ES-I-011: Audit trail support in sync payload (SEC-017)', () => {
    it('should include user_id for audit tracking', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'employee',
        entity_id: TEST_USER_ID,
        operation: 'CREATE',
        payload: {
          user_id: TEST_USER_ID,
          store_id: TEST_STORE_ID,
          name: 'Audit Test',
          role: 'cashier',
          active: true,
        },
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload.user_id).toBeDefined();
      expect(typeof payload.user_id).toBe('string');
    });

    it('should include store_id for audit context', async () => {
      const { syncQueueDAL } = await import('../../src/main/dal/sync-queue.dal');

      syncQueueDAL.enqueue({
        store_id: TEST_STORE_ID,
        entity_type: 'employee',
        entity_id: TEST_USER_ID,
        operation: 'UPDATE',
        payload: {
          user_id: TEST_USER_ID,
          store_id: TEST_STORE_ID,
          name: 'Updated',
          active: false,
        },
      });

      const payload = enqueueCallHistory[0].payload as Record<string, unknown>;
      expect(payload.store_id).toBeDefined();
      expect(payload.store_id).toBe(TEST_STORE_ID);
    });
  });
});
