/**
 * Bidirectional Sync Service Unit Tests
 *
 * @module tests/unit/services/bidirectional-sync.service.spec
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mock functions so they're available when vi.mock factory runs
const {
  mockPullBins,
  mockPullGames,
  mockPushBins,
  mockPushGames,
  mockBinsFindAllByStore,
  mockBinsFindByCloudId,
  mockBinsUpsertFromCloud,
  mockBinsSoftDelete,
  mockGamesFindAllByStore,
  mockGamesFindByCloudId,
  mockGamesUpsertFromCloud,
  mockGetLastPullAt,
  mockSetLastPullAt,
  mockReset,
  mockGetConfiguredStore,
} = vi.hoisted(() => ({
  mockPullBins: vi.fn(),
  mockPullGames: vi.fn(),
  mockPushBins: vi.fn(),
  mockPushGames: vi.fn(),
  mockBinsFindAllByStore: vi.fn(),
  mockBinsFindByCloudId: vi.fn(),
  mockBinsUpsertFromCloud: vi.fn(),
  mockBinsSoftDelete: vi.fn(),
  mockGamesFindAllByStore: vi.fn(),
  mockGamesFindByCloudId: vi.fn(),
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
    pullGames: mockPullGames,
    pushBins: mockPushBins,
    pushGames: mockPushGames,
  },
}));

// Mock DALs
vi.mock('../../../src/main/dal/lottery-bins.dal', () => ({
  lotteryBinsDAL: {
    findAllByStore: mockBinsFindAllByStore,
    findByCloudId: mockBinsFindByCloudId,
    upsertFromCloud: mockBinsUpsertFromCloud,
    softDelete: mockBinsSoftDelete,
  },
}));

vi.mock('../../../src/main/dal/lottery-games.dal', () => ({
  lotteryGamesDAL: {
    findAllByStore: mockGamesFindAllByStore,
    findByCloudId: mockGamesFindByCloudId,
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
            bin_number: 1,
            status: 'ACTIVE',
            updated_at: '2024-01-01T00:00:00Z',
          },
        ],
      });
      mockBinsFindByCloudId.mockReturnValue(undefined);

      const result = await service.syncBins();

      expect(result.pulled).toBe(1);
      expect(mockBinsUpsertFromCloud).toHaveBeenCalled();
      expect(mockSetLastPullAt).toHaveBeenCalledWith('store-123', 'bins', expect.any(String));
    });

    it('should push local changes to cloud', async () => {
      const lastPull = '2024-01-01T00:00:00Z';
      mockGetLastPullAt.mockReturnValue(lastPull);
      mockBinsFindAllByStore.mockReturnValue([
        {
          bin_id: 'local-bin-1',
          store_id: 'store-123',
          bin_number: 1,
          status: 'ACTIVE',
          updated_at: '2024-01-02T00:00:00Z', // After last pull
        },
      ]);
      mockPushBins.mockResolvedValue({
        results: [{ bin_id: 'local-bin-1', status: 'synced' }],
      });
      mockPullBins.mockResolvedValue({ bins: [] });

      const result = await service.syncBins();

      expect(result.pushed).toBe(1);
      expect(mockPushBins).toHaveBeenCalled();
    });

    it('should apply last-write-wins for conflicts', async () => {
      mockGetLastPullAt.mockReturnValue('2024-01-01T00:00:00Z');
      mockBinsFindAllByStore.mockReturnValue([]);
      mockPullBins.mockResolvedValue({
        bins: [
          {
            bin_id: 'cloud-bin-1',
            store_id: 'store-123',
            bin_number: 1,
            status: 'ACTIVE',
            updated_at: '2024-01-01T00:00:00Z', // Same as local
          },
        ],
      });
      mockBinsFindByCloudId.mockReturnValue({
        bin_id: 'local-bin-1',
        cloud_bin_id: 'cloud-bin-1',
        updated_at: '2024-01-02T00:00:00Z', // Local is newer
      });

      const result = await service.syncBins();

      expect(result.conflicts).toBe(1);
      expect(result.pulled).toBe(0);
      expect(mockBinsUpsertFromCloud).not.toHaveBeenCalled();
    });

    it('should handle deleted bins from cloud', async () => {
      mockGetLastPullAt.mockReturnValue(null);
      mockBinsFindAllByStore.mockReturnValue([]);
      mockPullBins.mockResolvedValue({
        bins: [
          {
            bin_id: 'cloud-bin-1',
            store_id: 'store-123',
            bin_number: 1,
            status: 'ACTIVE',
            updated_at: '2024-01-02T00:00:00Z',
            deleted_at: '2024-01-02T00:00:00Z',
          },
        ],
      });
      mockBinsFindByCloudId.mockReturnValue({
        bin_id: 'local-bin-1',
        updated_at: '2024-01-01T00:00:00Z',
      });

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
      mockPullGames.mockResolvedValue({
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
      mockGamesFindByCloudId.mockReturnValue(undefined);

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
      mockPullGames.mockResolvedValue({ games: [] });

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
      mockPullGames.mockResolvedValue({ games: [] });

      const result = await service.syncAll();

      expect(result).toHaveProperty('bins');
      expect(result).toHaveProperty('games');
      expect(mockPullBins).toHaveBeenCalled();
      expect(mockPullGames).toHaveBeenCalled();
    });
  });

  describe('forceFullSync', () => {
    it('should reset timestamps and perform full sync', async () => {
      mockGetLastPullAt.mockReturnValue(null);
      mockBinsFindAllByStore.mockReturnValue([]);
      mockGamesFindAllByStore.mockReturnValue([]);
      mockPullBins.mockResolvedValue({ bins: [] });
      mockPullGames.mockResolvedValue({ games: [] });

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
