/**
 * User Sync Service Unit Tests
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

// Mock users DAL
vi.mock('../../../src/main/dal/users.dal', () => ({
  usersDAL: {
    findByCloudId: vi.fn(),
    findActiveByStore: vi.fn(),
    upsertFromCloud: vi.fn(),
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
}));

import { UserSyncService } from '../../../src/main/services/user-sync.service';
import { cloudApiService } from '../../../src/main/services/cloud-api.service';
import { usersDAL } from '../../../src/main/dal/users.dal';
import { storesDAL } from '../../../src/main/dal/stores.dal';

// Get mock references
const mockPullUsers = vi.mocked(cloudApiService.pullUsers);
const mockFindByCloudId = vi.mocked(usersDAL.findByCloudId);
const mockFindActiveByStore = vi.mocked(usersDAL.findActiveByStore);
const mockUpsertFromCloud = vi.mocked(usersDAL.upsertFromCloud);
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
    service = new UserSyncService();
  });

  describe('syncUsers', () => {
    it('should throw if store not configured', async () => {
      mockGetConfiguredStore.mockReturnValue(undefined);

      await expect(service.syncUsers()).rejects.toThrow('Store not configured');
    });

    it('should create new users from cloud', async () => {
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
      mockFindByCloudId.mockReturnValue(undefined);
      mockFindActiveByStore.mockReturnValue([]);

      const result = await service.syncUsers();

      expect(result.synced).toBe(1);
      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(mockUpsertFromCloud).toHaveBeenCalledWith({
        cloud_user_id: 'cloud-user-1',
        store_id: 'store-123',
        role: 'cashier',
        name: 'John Doe',
        pin_hash: '$2b$10$abcdef',
      });
    });

    it('should update existing users from cloud', async () => {
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
      mockFindByCloudId.mockReturnValue({
        user_id: 'local-user-1',
        cloud_user_id: 'cloud-user-1',
        name: 'John Doe',
        active: true,
      } as unknown as ReturnType<typeof usersDAL.findByCloudId>);
      mockFindActiveByStore.mockReturnValue([]);

      const result = await service.syncUsers();

      expect(result.synced).toBe(1);
      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(mockUpsertFromCloud).toHaveBeenCalled();
    });

    it('should deactivate users removed from cloud', async () => {
      mockPullUsers.mockResolvedValue({ users: [] });
      mockFindActiveByStore.mockReturnValue([
        {
          user_id: 'local-user-1',
          cloud_user_id: 'cloud-user-removed',
          name: 'Removed User',
          active: true,
        },
      ] as unknown as ReturnType<typeof usersDAL.findActiveByStore>);

      const result = await service.syncUsers();

      expect(result.deactivated).toBe(1);
      expect(mockDeactivate).toHaveBeenCalledWith('local-user-1');
    });

    it('should preserve local users without cloud_user_id', async () => {
      mockPullUsers.mockResolvedValue({ users: [] });
      mockFindActiveByStore.mockReturnValue([
        {
          user_id: 'local-only-user',
          cloud_user_id: null,
          name: 'Local Admin',
          active: true,
        },
      ] as unknown as ReturnType<typeof usersDAL.findActiveByStore>);

      const result = await service.syncUsers();

      expect(result.deactivated).toBe(0);
      expect(mockDeactivate).not.toHaveBeenCalled();
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
      mockFindByCloudId.mockReturnValue({
        user_id: 'local-user-1',
        cloud_user_id: 'cloud-user-1',
        name: 'Reactivated User',
        active: false, // Was inactive
      } as unknown as ReturnType<typeof usersDAL.findByCloudId>);
      mockFindActiveByStore.mockReturnValue([]);

      const result = await service.syncUsers();

      expect(result.updated).toBe(1);
      expect(mockReactivate).toHaveBeenCalledWith('local-user-1');
    });

    it('should deactivate users deactivated in cloud', async () => {
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
      mockFindByCloudId.mockReturnValue({
        user_id: 'local-user-1',
        cloud_user_id: 'cloud-user-1',
        name: 'Deactivated User',
        active: true, // Was active
      } as unknown as ReturnType<typeof usersDAL.findByCloudId>);
      mockFindActiveByStore.mockReturnValue([]);

      const result = await service.syncUsers();

      expect(result.updated).toBe(1);
      expect(mockDeactivate).toHaveBeenCalledWith('local-user-1');
    });

    it('should track errors but continue syncing', async () => {
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
      mockFindByCloudId.mockReturnValue(undefined);
      mockFindActiveByStore.mockReturnValue([]);

      // First call succeeds, second throws
      mockUpsertFromCloud
        .mockImplementationOnce(() => ({}) as ReturnType<typeof usersDAL.upsertFromCloud>)
        .mockImplementationOnce(() => {
          throw new Error('DB error');
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
  });

  describe('needsSync', () => {
    it('should return false if store not configured', () => {
      mockGetConfiguredStore.mockReturnValue(undefined);

      expect(service.needsSync()).toBe(false);
    });

    it('should return true if no users with cloud_user_id', () => {
      mockFindActiveByStore.mockReturnValue([
        { user_id: 'local-1', cloud_user_id: null, name: 'Local Only' },
      ] as unknown as ReturnType<typeof usersDAL.findActiveByStore>);

      expect(service.needsSync()).toBe(true);
    });

    it('should return false if synced users exist', () => {
      mockFindActiveByStore.mockReturnValue([
        { user_id: 'local-1', cloud_user_id: 'cloud-1', name: 'Synced User' },
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

    it('should count only users with cloud_user_id', () => {
      mockFindActiveByStore.mockReturnValue([
        { user_id: 'local-1', cloud_user_id: 'cloud-1', name: 'Synced 1' },
        { user_id: 'local-2', cloud_user_id: null, name: 'Local Only' },
        { user_id: 'local-3', cloud_user_id: 'cloud-3', name: 'Synced 2' },
      ] as unknown as ReturnType<typeof usersDAL.findActiveByStore>);

      expect(service.getSyncedUserCount()).toBe(2);
    });

    it('should return 0 if no synced users', () => {
      mockFindActiveByStore.mockReturnValue([
        { user_id: 'local-1', cloud_user_id: null, name: 'Local Only' },
      ] as unknown as ReturnType<typeof usersDAL.findActiveByStore>);

      expect(service.getSyncedUserCount()).toBe(0);
    });
  });
});
