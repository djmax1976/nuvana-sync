/**
 * User Sync Service Unit Tests
 *
 * Tests for enterprise-grade user synchronization with:
 * - Batch operations to eliminate N+1 queries
 * - Proper tenant isolation validation
 * - Comprehensive error handling
 *
 * @module tests/unit/services/user-sync.service.spec
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock cloud API service
vi.mock('../../../src/main/services/cloud-api.service', () => ({
  cloudApiService: {
    pullUsers: vi.fn(),
  },
}));

// Mock users DAL with batch methods
// Note: After cloud_id consolidation, findByCloudId -> findById, findByCloudIds -> findByUserIds
vi.mock('../../../src/main/dal/users.dal', () => ({
  usersDAL: {
    findById: vi.fn(),
    findByUserIds: vi.fn(),
    findActiveByStore: vi.fn(),
    upsertFromCloud: vi.fn(),
    batchUpsertFromCloud: vi.fn(),
    batchDeactivateNotInUserIds: vi.fn(),
    deactivate: vi.fn(),
    reactivate: vi.fn(),
  },
}));

// Mock stores DAL
vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: {
    getConfiguredStore: vi.fn(),
  },
}));

// Hoist sync queue mocks for assertion in tests
const {
  mockSyncQueueEnqueue,
  mockSyncQueueMarkSynced,
  mockSyncQueueIncrementAttempts,
  mockSyncQueueDeadLetter,
  mockSyncQueueGetPendingPullItem,
} = vi.hoisted(() => ({
  mockSyncQueueEnqueue: vi.fn().mockReturnValue({
    id: 'mock-queue-id-users',
    store_id: 'store-123',
    entity_type: 'user',
    entity_id: 'pull-1234567890',
    operation: 'UPDATE',
    payload: JSON.stringify({ action: 'pull_users' }),
    sync_direction: 'PULL',
    synced: 0,
    sync_attempts: 0,
    created_at: new Date().toISOString(),
  }),
  mockSyncQueueMarkSynced: vi.fn(),
  mockSyncQueueIncrementAttempts: vi.fn(),
  mockSyncQueueDeadLetter: vi.fn().mockReturnValue(true),
  mockSyncQueueGetPendingPullItem: vi.fn().mockReturnValue(null),
}));

// Mock sync queue DAL (used by UserSyncService for PULL tracking)
vi.mock('../../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: {
    enqueue: mockSyncQueueEnqueue,
    markSynced: mockSyncQueueMarkSynced,
    incrementAttempts: mockSyncQueueIncrementAttempts,
    deadLetter: mockSyncQueueDeadLetter,
    getBatch: vi.fn().mockReturnValue({ items: [], totalPending: 0 }),
    cleanupAllStalePullTracking: vi.fn().mockReturnValue(0),
    cleanupStalePullTracking: vi.fn().mockReturnValue(0),
    getPendingPullItem: mockSyncQueueGetPendingPullItem,
    getPendingPullItemByAction: vi.fn().mockReturnValue(null),
  },
}));

// Mock database
vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn().mockReturnValue({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
    }),
    transaction: vi.fn((fn) => () => fn()),
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

import { UserSyncService } from '../../../src/main/services/user-sync.service';
import { cloudApiService } from '../../../src/main/services/cloud-api.service';
import { usersDAL } from '../../../src/main/dal/users.dal';
import { storesDAL } from '../../../src/main/dal/stores.dal';

// Get mock references
// Note: After cloud_id consolidation, user_id IS the cloud ID
const mockPullUsers = vi.mocked(cloudApiService.pullUsers);
const mockFindById = vi.mocked(usersDAL.findById);
const mockFindByUserIds = vi.mocked(usersDAL.findByUserIds);
const mockFindActiveByStore = vi.mocked(usersDAL.findActiveByStore);
const mockBatchUpsertFromCloud = vi.mocked(usersDAL.batchUpsertFromCloud);
const mockBatchDeactivateNotInUserIds = vi.mocked(usersDAL.batchDeactivateNotInUserIds);
const mockDeactivate = vi.mocked(usersDAL.deactivate);
const mockReactivate = vi.mocked(usersDAL.reactivate);
const mockGetConfiguredStore = vi.mocked(storesDAL.getConfiguredStore);

describe('UserSyncService', () => {
  let service: UserSyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfiguredStore.mockReturnValue({
      store_id: 'store-123',
      name: 'Test Store',
    } as ReturnType<typeof storesDAL.getConfiguredStore>);

    // Default mock implementations
    mockBatchUpsertFromCloud.mockReturnValue({ created: 0, updated: 0, errors: [] });
    mockBatchDeactivateNotInUserIds.mockReturnValue(0);
    mockFindByUserIds.mockReturnValue(new Map());

    service = new UserSyncService();
  });

  describe('syncUsers', () => {
    it('should throw if store not configured', async () => {
      mockGetConfiguredStore.mockReturnValue(undefined);

      await expect(service.syncUsers()).rejects.toThrow('Store not configured');
    });

    it('should return early if no users from cloud', async () => {
      mockPullUsers.mockResolvedValue({ users: [] });

      const result = await service.syncUsers();

      expect(result.synced).toBe(0);
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(mockBatchUpsertFromCloud).not.toHaveBeenCalled();
    });

    it('should batch upsert active users from cloud', async () => {
      mockPullUsers.mockResolvedValue({
        users: [
          {
            userId: 'cloud-user-1',
            role: 'cashier',
            name: 'John Doe',
            pinHash: '$2b$10$abcdef',
            active: true,
          },
          {
            userId: 'cloud-user-2',
            role: 'store_manager',
            name: 'Jane Smith',
            pinHash: '$2b$10$ghijkl',
            active: true,
          },
        ],
      });
      mockBatchUpsertFromCloud.mockReturnValue({ created: 2, updated: 0, errors: [] });

      const result = await service.syncUsers();

      expect(result.synced).toBe(2);
      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);
      expect(mockBatchUpsertFromCloud).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            user_id: 'cloud-user-1',
            store_id: 'store-123',
            role: 'cashier',
            name: 'John Doe',
          }),
          expect.objectContaining({
            user_id: 'cloud-user-2',
            store_id: 'store-123',
            role: 'store_manager',
            name: 'Jane Smith',
          }),
        ]),
        'store-123'
      );
    });

    it('should batch update existing users from cloud', async () => {
      mockPullUsers.mockResolvedValue({
        users: [
          {
            userId: 'cloud-user-1',
            role: 'store_manager',
            name: 'John Doe Updated',
            pinHash: '$2b$10$newHash',
            active: true,
          },
        ],
      });
      mockBatchUpsertFromCloud.mockReturnValue({ created: 0, updated: 1, errors: [] });
      // Note: After cloud_id consolidation, user_id IS the cloud ID
      mockFindByUserIds.mockReturnValue(
        new Map([
          [
            'cloud-user-1',
            {
              user_id: 'cloud-user-1', // user_id IS the cloud ID
              name: 'John Doe',
              active: true,
            } as any,
          ],
        ])
      );

      const result = await service.syncUsers();

      expect(result.synced).toBe(1);
      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
    });

    it('should batch deactivate users removed from cloud', async () => {
      // When cloud returns some users, we should deactivate local users
      // that are no longer in the cloud response
      mockPullUsers.mockResolvedValue({
        users: [
          {
            userId: 'cloud-user-1',
            role: 'cashier',
            name: 'Active User',
            pinHash: '$2b$10$hash',
            active: true,
          },
        ],
      });
      mockBatchUpsertFromCloud.mockReturnValue({ created: 1, updated: 0, errors: [] });
      mockBatchDeactivateNotInUserIds.mockReturnValue(2);

      const result = await service.syncUsers();

      expect(result.deactivated).toBe(2);
      expect(mockBatchDeactivateNotInUserIds).toHaveBeenCalledWith('store-123', expect.any(Set));
    });

    it('should NOT deactivate when cloud returns no users (safety guard)', async () => {
      // This is a safety feature - if cloud returns empty, don't deactivate all users
      // This could indicate an API issue rather than all users being removed
      mockPullUsers.mockResolvedValue({ users: [] });

      const result = await service.syncUsers();

      // Should return early without calling batch deactivate
      expect(result.deactivated).toBe(0);
      expect(mockBatchDeactivateNotInUserIds).not.toHaveBeenCalled();
    });

    it('should deactivate users marked inactive in cloud', async () => {
      mockPullUsers.mockResolvedValue({
        users: [
          {
            userId: 'cloud-user-1',
            role: 'cashier',
            name: 'Deactivated User',
            pinHash: '$2b$10$hash',
            active: false, // Now inactive
          },
        ],
      });
      // Note: After cloud_id consolidation, user_id IS the cloud ID
      mockFindById.mockReturnValue({
        user_id: 'cloud-user-1', // user_id IS the cloud ID
        name: 'Deactivated User',
        active: true, // Was active locally
      } as unknown as ReturnType<typeof usersDAL.findById>);

      const result = await service.syncUsers();

      expect(result.deactivated).toBeGreaterThanOrEqual(1);
      // Note: After cloud_id consolidation, user_id IS the cloud ID
      expect(mockDeactivate).toHaveBeenCalledWith('cloud-user-1');
    });

    it('should reactivate users reactivated in cloud', async () => {
      mockPullUsers.mockResolvedValue({
        users: [
          {
            userId: 'cloud-user-1',
            role: 'cashier',
            name: 'Reactivated User',
            pinHash: '$2b$10$hash',
            active: true,
          },
        ],
      });
      mockBatchUpsertFromCloud.mockReturnValue({ created: 0, updated: 1, errors: [] });
      // User exists but is inactive locally
      // Note: After cloud_id consolidation, user_id IS the cloud ID
      mockFindByUserIds.mockReturnValue(
        new Map([
          [
            'cloud-user-1',
            {
              user_id: 'cloud-user-1', // user_id IS the cloud ID
              name: 'Reactivated User',
              active: false, // Was inactive locally
            } as any,
          ],
        ])
      );

      const result = await service.syncUsers();

      expect(result.reactivated).toBe(1);
      // Note: After cloud_id consolidation, user_id IS the cloud ID
      expect(mockReactivate).toHaveBeenCalledWith('cloud-user-1');
    });

    it('should track batch errors and include in result', async () => {
      mockPullUsers.mockResolvedValue({
        users: [
          {
            userId: 'cloud-user-1',
            role: 'cashier',
            name: 'User 1',
            pinHash: '$2b$10$hash1',
            active: true,
          },
          {
            userId: 'cloud-user-2',
            role: 'store_manager',
            name: 'User 2',
            pinHash: '$2b$10$hash2',
            active: true,
          },
        ],
      });
      mockBatchUpsertFromCloud.mockReturnValue({
        created: 1,
        updated: 0,
        errors: ['User cloud-user-2: DB error'],
      });

      const result = await service.syncUsers();

      expect(result.synced).toBe(1);
      expect(result.created).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('cloud-user-2');
    });

    it('should handle cloud API errors', async () => {
      mockPullUsers.mockRejectedValue(new Error('Network error'));

      await expect(service.syncUsers()).rejects.toThrow('Network error');
    });

    // =========================================================================
    // Enterprise-Grade DLQ Tests for Users PULL Sync
    // Business requirement: Users PULL errors go directly to DLQ (no retries)
    // =========================================================================

    describe('sync queue DLQ tracking (users PULL sync - no retries)', () => {
      it('should record API failure for retry on users sync', async () => {
        // API failures should be recorded for retry on next sync cycle
        mockPullUsers.mockRejectedValue(new Error('HTTP 503: Service Unavailable'));

        await expect(service.syncUsers()).rejects.toThrow('HTTP 503: Service Unavailable');

        // incrementAttempts called to record error context
        expect(mockSyncQueueIncrementAttempts).toHaveBeenCalledTimes(1);
        expect(mockSyncQueueIncrementAttempts).toHaveBeenCalledWith(
          'mock-queue-id-users',
          'HTTP 503: Service Unavailable',
          expect.objectContaining({
            api_endpoint: '/api/v1/sync/users',
            http_status: 503,
          })
        );

        // Should NOT immediately dead-letter - allow retry
        expect(mockSyncQueueDeadLetter).not.toHaveBeenCalled();
      });

      it('CRITICAL: should mark queue item as synced when no users to sync', async () => {
        // Empty response should still mark as synced (not leave pending)
        mockPullUsers.mockResolvedValue({ users: [] });

        await service.syncUsers();

        // Queue item must be marked synced even with empty response
        expect(mockSyncQueueMarkSynced).toHaveBeenCalledTimes(1);
        expect(mockSyncQueueMarkSynced).toHaveBeenCalledWith(
          'mock-queue-id-users',
          expect.objectContaining({
            api_endpoint: '/api/v1/sync/users',
            http_status: 200,
          })
        );
        // No dead-letter on success
        expect(mockSyncQueueDeadLetter).not.toHaveBeenCalled();
      });

      it('should handle HTTP 401 unauthorized and record for retry', async () => {
        mockPullUsers.mockRejectedValue(new Error('HTTP 401: Unauthorized'));

        await expect(service.syncUsers()).rejects.toThrow('HTTP 401: Unauthorized');

        // Should record failure for retry, not immediately dead-letter
        expect(mockSyncQueueIncrementAttempts).toHaveBeenCalled();
        expect(mockSyncQueueDeadLetter).not.toHaveBeenCalled();
      });

      it('should handle network timeout and record for retry', async () => {
        mockPullUsers.mockRejectedValue(new Error('ETIMEDOUT: Connection timed out'));

        await expect(service.syncUsers()).rejects.toThrow('ETIMEDOUT: Connection timed out');

        // Should record failure for retry, not immediately dead-letter
        expect(mockSyncQueueIncrementAttempts).toHaveBeenCalled();
        expect(mockSyncQueueDeadLetter).not.toHaveBeenCalled();
      });

      it('CRITICAL: should mark queue item as synced after successful user sync', async () => {
        mockPullUsers.mockResolvedValue({
          users: [
            {
              userId: 'cloud-user-1',
              role: 'cashier',
              name: 'John Doe',
              pinHash: '$2b$10$abcdef',
              active: true,
            },
          ],
        });
        mockBatchUpsertFromCloud.mockReturnValue({ created: 1, updated: 0, errors: [] });

        await service.syncUsers();

        // Queue item must be marked synced after successful processing
        expect(mockSyncQueueMarkSynced).toHaveBeenCalledTimes(1);
        expect(mockSyncQueueMarkSynced).toHaveBeenCalledWith(
          'mock-queue-id-users',
          expect.objectContaining({
            api_endpoint: '/api/v1/sync/users',
            http_status: 200,
          })
        );
        // No dead-letter on success
        expect(mockSyncQueueDeadLetter).not.toHaveBeenCalled();
      });
    });

    it('should handle batch upsert failure gracefully', async () => {
      mockPullUsers.mockResolvedValue({
        users: [
          {
            userId: 'cloud-user-1',
            role: 'cashier',
            name: 'User 1',
            pinHash: '$2b$10$hash1',
            active: true,
          },
        ],
      });
      mockBatchUpsertFromCloud.mockImplementation(() => {
        throw new Error('Tenant isolation violation');
      });

      const result = await service.syncUsers();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Batch upsert failed');
    });

    it('should handle batch deactivate failure gracefully', async () => {
      // Need to return at least one user so we don't exit early
      mockPullUsers.mockResolvedValue({
        users: [
          {
            userId: 'cloud-user-1',
            role: 'cashier',
            name: 'User',
            pinHash: '$2b$10$hash',
            active: true,
          },
        ],
      });
      mockBatchUpsertFromCloud.mockReturnValue({ created: 1, updated: 0, errors: [] });
      mockBatchDeactivateNotInUserIds.mockImplementation(() => {
        throw new Error('DB connection failed');
      });

      const result = await service.syncUsers();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Batch deactivate failed');
    });

    it('should sync users with proper roles from unified endpoint', async () => {
      mockPullUsers.mockResolvedValue({
        users: [
          {
            userId: 'cloud-sm-1',
            role: 'store_manager',
            name: 'Store Manager',
            pinHash: '$2b$10$hash1',
            active: true,
          },
          {
            userId: 'cloud-shm-1',
            role: 'shift_manager',
            name: 'Shift Manager',
            pinHash: '$2b$10$hash2',
            active: true,
          },
          {
            userId: 'cloud-c-1',
            role: 'cashier',
            name: 'Cashier',
            pinHash: '$2b$10$hash3',
            active: true,
          },
        ],
      });
      mockBatchUpsertFromCloud.mockReturnValue({ created: 3, updated: 0, errors: [] });

      const result = await service.syncUsers();

      expect(result.synced).toBe(3);
      expect(mockBatchUpsertFromCloud).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'store_manager' }),
          expect.objectContaining({ role: 'shift_manager' }),
          expect.objectContaining({ role: 'cashier' }),
        ]),
        'store-123'
      );
    });
  });

  describe('needsSync', () => {
    it('should return false if store not configured', () => {
      mockGetConfiguredStore.mockReturnValue(undefined);

      expect(service.needsSync()).toBe(false);
    });

    // Note: After cloud_id consolidation, needsSync() checks synced_at field
    it('should return true if no users have synced_at', () => {
      mockFindActiveByStore.mockReturnValue([
        { user_id: 'user-1', synced_at: null, name: 'Local Only' },
      ] as unknown as ReturnType<typeof usersDAL.findActiveByStore>);

      expect(service.needsSync()).toBe(true);
    });

    it('should return false if synced users exist', () => {
      mockFindActiveByStore.mockReturnValue([
        { user_id: 'user-1', synced_at: '2024-01-01T00:00:00.000Z', name: 'Synced User' },
      ] as unknown as ReturnType<typeof usersDAL.findActiveByStore>);

      expect(service.needsSync()).toBe(false);
    });

    it('should return true if no users at all', () => {
      mockFindActiveByStore.mockReturnValue([]);

      expect(service.needsSync()).toBe(true);
    });
  });

  describe('getSyncedUserCount', () => {
    it('should return 0 if store not configured', () => {
      mockGetConfiguredStore.mockReturnValue(undefined);

      expect(service.getSyncedUserCount()).toBe(0);
    });

    // Note: After cloud_id consolidation, getSyncedUserCount() checks synced_at field
    it('should count only users with synced_at', () => {
      mockFindActiveByStore.mockReturnValue([
        { user_id: 'user-1', synced_at: '2024-01-01T00:00:00.000Z', name: 'Synced 1' },
        { user_id: 'user-2', synced_at: null, name: 'Local Only' },
        { user_id: 'user-3', synced_at: '2024-01-01T00:00:00.000Z', name: 'Synced 2' },
      ] as unknown as ReturnType<typeof usersDAL.findActiveByStore>);

      expect(service.getSyncedUserCount()).toBe(2);
    });

    it('should return 0 if no synced users', () => {
      mockFindActiveByStore.mockReturnValue([
        { user_id: 'user-1', synced_at: null, name: 'Local Only' },
      ] as unknown as ReturnType<typeof usersDAL.findActiveByStore>);

      expect(service.getSyncedUserCount()).toBe(0);
    });
  });
});
