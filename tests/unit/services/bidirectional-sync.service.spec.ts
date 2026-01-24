/**
 * Bidirectional Sync Service Unit Tests
 *
 * @module tests/unit/services/bidirectional-sync.service.spec
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mock functions so they're available when vi.mock factory runs
const {
  mockPullBins,
  mockPullLotteryGames,
  mockPushBins,
  mockPushGames,
  mockBinsFindAllByStore,
  mockBinsFindByCloudId,
  mockBinsFindByCloudIds,
  mockBinsUpsertFromCloud,
  mockBinsBatchUpsertFromCloud,
  mockBinsSoftDelete,
  mockBinsBatchSoftDeleteNotInCloudIds,
  mockGamesFindAllByStore,
  mockGamesFindById,
  mockGamesUpsertFromCloud,
  mockGetLastPullAt,
  mockSetLastPullAt,
  mockReset,
  mockGetConfiguredStore,
} = vi.hoisted(() => ({
  mockPullBins: vi.fn(),
  mockPullLotteryGames: vi.fn(),
  mockPushBins: vi.fn(),
  mockPushGames: vi.fn(),
  mockBinsFindAllByStore: vi.fn(),
  mockBinsFindByCloudId: vi.fn(),
  mockBinsFindByCloudIds: vi.fn(),
  mockBinsUpsertFromCloud: vi.fn(),
  mockBinsBatchUpsertFromCloud: vi.fn(),
  mockBinsSoftDelete: vi.fn(),
  mockBinsBatchSoftDeleteNotInCloudIds: vi.fn(),
  mockGamesFindAllByStore: vi.fn(),
  mockGamesFindById: vi.fn(),
  mockGamesUpsertFromCloud: vi.fn(),
  mockGetLastPullAt: vi.fn(),
  mockSetLastPullAt: vi.fn(),
  mockReset: vi.fn(),
  mockGetConfiguredStore: vi.fn(),
}));

// Mock cloud API service
vi.mock('../../../src/main/services/cloud-api.service', () => ({
  cloudApiService: {
    pullBins: mockPullBins,
    pullLotteryGames: mockPullLotteryGames,
    pushBins: mockPushBins,
    pushGames: mockPushGames,
  },
}));

// Mock DALs
vi.mock('../../../src/main/dal/lottery-bins.dal', () => ({
  lotteryBinsDAL: {
    findAllByStore: mockBinsFindAllByStore,
    findByCloudId: mockBinsFindByCloudId,
    findByCloudIds: mockBinsFindByCloudIds,
    upsertFromCloud: mockBinsUpsertFromCloud,
    batchUpsertFromCloud: mockBinsBatchUpsertFromCloud,
    softDelete: mockBinsSoftDelete,
    batchSoftDeleteNotInCloudIds: mockBinsBatchSoftDeleteNotInCloudIds,
  },
}));

vi.mock('../../../src/main/dal/lottery-games.dal', () => ({
  lotteryGamesDAL: {
    findAllByStore: mockGamesFindAllByStore,
    findById: mockGamesFindById,
    upsertFromCloud: mockGamesUpsertFromCloud,
  },
}));

vi.mock('../../../src/main/dal/sync-timestamps.dal', () => ({
  syncTimestampsDAL: {
    getLastPullAt: mockGetLastPullAt,
    setLastPullAt: mockSetLastPullAt,
    reset: mockReset,
  },
}));

vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: {
    getConfiguredStore: mockGetConfiguredStore,
  },
}));

// Mock sync queue DAL (used by BidirectionalSyncService for PULL tracking)
vi.mock('../../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: {
    enqueue: vi.fn().mockReturnValue({
      id: 'mock-queue-id',
      store_id: 'store-123',
      entity_type: 'bin_sync',
      entity_id: 'bin-sync-batch',
      operation: 'PULL',
      payload: '{}',
      synced: 0,
      sync_attempts: 0,
      created_at: new Date().toISOString(),
    }),
    markSynced: vi.fn(),
    incrementAttempts: vi.fn(),
    getBatch: vi.fn().mockReturnValue({ items: [], totalPending: 0 }),
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
    transaction: vi.fn((fn: () => unknown) => () => fn()),
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

import { BidirectionalSyncService } from '../../../src/main/services/bidirectional-sync.service';

describe('BidirectionalSyncService', () => {
  let service: BidirectionalSyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfiguredStore.mockReturnValue({
      store_id: 'store-123',
      name: 'Test Store',
    });
    service = new BidirectionalSyncService();
  });

  describe('syncBins', () => {
    it('should throw if store not configured', async () => {
      mockGetConfiguredStore.mockReturnValue(undefined);

      await expect(service.syncBins()).rejects.toThrow('Store not configured');
    });

    it('should pull bins from cloud and apply locally', async () => {
      mockGetLastPullAt.mockReturnValue(null);
      mockBinsFindAllByStore.mockReturnValue([]);
      mockPullBins.mockResolvedValue({
        bins: [
          {
            bin_id: 'cloud-bin-1',
            store_id: 'store-123',
            name: 'Bin 1',
            display_order: 1,
            is_active: true,
            updated_at: '2024-01-01T00:00:00Z',
          },
        ],
      });
      mockBinsFindByCloudId.mockReturnValue(undefined);
      // Mock batch upsert to return success result
      mockBinsBatchUpsertFromCloud.mockReturnValue({
        created: 1,
        updated: 0,
        errors: [],
      });
      mockBinsBatchSoftDeleteNotInCloudIds.mockReturnValue(0);

      const result = await service.syncBins();

      expect(result.pulled).toBe(1);
      expect(mockBinsBatchUpsertFromCloud).toHaveBeenCalled();
      expect(mockSetLastPullAt).toHaveBeenCalledWith('store-123', 'bins', expect.any(String));
    });

    it('should NOT push local changes (bins are pull-only)', async () => {
      // Bins have no push endpoint in the API spec
      // Local bin changes are for offline operation only
      const lastPull = '2024-01-01T00:00:00Z';
      mockGetLastPullAt.mockReturnValue(lastPull);
      mockBinsFindAllByStore.mockReturnValue([
        {
          bin_id: 'local-bin-1',
          store_id: 'store-123',
          name: 'Bin 1',
          display_order: 1,
          is_active: 1,
          updated_at: '2024-01-02T00:00:00Z', // After last pull
        },
      ]);
      mockPullBins.mockResolvedValue({ bins: [] });

      const result = await service.syncBins();

      // Pushed should always be 0 for bins (pull-only)
      expect(result.pushed).toBe(0);
      // pushBins should NOT be called - there's no push endpoint
      expect(mockPushBins).not.toHaveBeenCalled();
    });

    it('should always apply cloud data (cloud is authoritative for bins)', async () => {
      // For bins, cloud is always authoritative - no conflict resolution needed
      // Cloud data should always overwrite local data
      mockGetLastPullAt.mockReturnValue('2024-01-01T00:00:00Z');
      mockPullBins.mockResolvedValue({
        bins: [
          {
            bin_id: 'cloud-bin-1',
            store_id: 'store-123',
            name: 'Bin 1',
            display_order: 1,
            is_active: true,
            updated_at: '2024-01-01T00:00:00Z',
          },
        ],
      });
      // Even if local bin exists and is "newer", cloud should overwrite
      // After v037 migration: bin_id IS the cloud's UUID (no separate cloud_bin_id)
      mockBinsFindByCloudId.mockReturnValue({
        bin_id: 'cloud-bin-1', // bin_id is now the cloud's UUID
        updated_at: '2024-01-02T00:00:00Z', // Local is "newer" but doesn't matter
      });
      // Mock batch upsert to return success result
      mockBinsBatchUpsertFromCloud.mockReturnValue({
        created: 0,
        updated: 1,
        errors: [],
      });
      mockBinsBatchSoftDeleteNotInCloudIds.mockReturnValue(0);

      const result = await service.syncBins();

      // Cloud is authoritative, so it should be applied
      expect(result.pulled).toBe(1);
      expect(result.conflicts).toBe(0); // No conflict resolution for pull-only entities
      expect(mockBinsBatchUpsertFromCloud).toHaveBeenCalled();
    });

    it('should handle deleted bins from cloud', async () => {
      mockGetLastPullAt.mockReturnValue(null);
      mockBinsFindAllByStore.mockReturnValue([]);
      mockPullBins.mockResolvedValue({
        bins: [
          {
            bin_id: 'cloud-bin-1',
            store_id: 'store-123',
            name: 'Bin 1',
            display_order: 1,
            is_active: true,
            updated_at: '2024-01-02T00:00:00Z',
            deleted_at: '2024-01-02T00:00:00Z',
          },
        ],
      });
      // Mock findByCloudIds to return a Map with the existing bin
      // After v037 migration: bin_id IS the cloud's UUID (no separate cloud_bin_id)
      mockBinsFindByCloudIds.mockReturnValue(
        new Map([
          [
            'cloud-bin-1',
            {
              bin_id: 'cloud-bin-1', // bin_id is now the cloud's UUID
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
        ])
      );
      mockBinsSoftDelete.mockReturnValue({ success: true });
      mockBinsBatchSoftDeleteNotInCloudIds.mockReturnValue(0);

      const result = await service.syncBins();

      expect(result.pulled).toBe(1);
      expect(mockBinsSoftDelete).toHaveBeenCalled();
    });

    it('should not update timestamp on errors', async () => {
      mockGetLastPullAt.mockReturnValue(null);
      mockBinsFindAllByStore.mockReturnValue([]);
      mockPullBins.mockRejectedValue(new Error('Network error'));

      const result = await service.syncBins();

      expect(result.errors).toHaveLength(1);
      expect(mockSetLastPullAt).not.toHaveBeenCalled();
    });
  });

  describe('syncGames', () => {
    it('should throw if store not configured', async () => {
      mockGetConfiguredStore.mockReturnValue(undefined);

      await expect(service.syncGames()).rejects.toThrow('Store not configured');
    });

    it('should pull games from cloud and apply locally', async () => {
      mockGetLastPullAt.mockReturnValue(null);
      mockGamesFindAllByStore.mockReturnValue([]);
      mockPullLotteryGames.mockResolvedValue({
        games: [
          {
            game_id: 'cloud-game-1',
            game_code: 'G001',
            name: 'Test Game',
            price: 5,
            pack_value: 300,
            status: 'ACTIVE',
            updated_at: '2024-01-01T00:00:00Z',
          },
        ],
      });
      mockGamesFindById.mockReturnValue(undefined);

      const result = await service.syncGames();

      expect(result.pulled).toBe(1);
      expect(mockGamesUpsertFromCloud).toHaveBeenCalled();
      expect(mockSetLastPullAt).toHaveBeenCalledWith('store-123', 'games', expect.any(String));
    });

    it('should push local game changes to cloud', async () => {
      const lastPull = '2024-01-01T00:00:00Z';
      mockGetLastPullAt.mockReturnValue(lastPull);
      mockGamesFindAllByStore.mockReturnValue([
        {
          game_id: 'local-game-1',
          game_code: 'G001',
          name: 'Local Game',
          price: 5,
          pack_value: 300,
          status: 'ACTIVE',
          updated_at: '2024-01-02T00:00:00Z',
        },
      ]);
      mockPushGames.mockResolvedValue({
        results: [{ game_id: 'local-game-1', status: 'synced' }],
      });
      mockPullLotteryGames.mockResolvedValue({ games: [] });

      const result = await service.syncGames();

      expect(result.pushed).toBe(1);
      expect(mockPushGames).toHaveBeenCalled();
    });
  });

  describe('syncAll', () => {
    it('should sync both bins and games', async () => {
      mockGetLastPullAt.mockReturnValue(null);
      mockBinsFindAllByStore.mockReturnValue([]);
      mockGamesFindAllByStore.mockReturnValue([]);
      mockPullBins.mockResolvedValue({ bins: [] });
      mockPullLotteryGames.mockResolvedValue({ games: [] });

      const result = await service.syncAll();

      expect(result).toHaveProperty('bins');
      expect(result).toHaveProperty('games');
      expect(mockPullBins).toHaveBeenCalled();
      expect(mockPullLotteryGames).toHaveBeenCalled();
    });
  });

  describe('forceFullSync', () => {
    it('should reset timestamps and perform full sync', async () => {
      mockGetLastPullAt.mockReturnValue(null);
      mockBinsFindAllByStore.mockReturnValue([]);
      mockGamesFindAllByStore.mockReturnValue([]);
      mockPullBins.mockResolvedValue({ bins: [] });
      mockPullLotteryGames.mockResolvedValue({ games: [] });

      await service.forceFullSync();

      expect(mockReset).toHaveBeenCalledWith('store-123', 'bins');
      expect(mockReset).toHaveBeenCalledWith('store-123', 'games');
    });

    it('should throw if store not configured', async () => {
      mockGetConfiguredStore.mockReturnValue(undefined);

      await expect(service.forceFullSync()).rejects.toThrow('Store not configured');
    });
  });
});
