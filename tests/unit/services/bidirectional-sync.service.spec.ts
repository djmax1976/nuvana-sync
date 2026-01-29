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
  // Sync queue mocks - hoisted for assertion in tests
  mockSyncQueueEnqueue,
  mockSyncQueueMarkSynced,
  mockSyncQueueIncrementAttempts,
  mockSyncQueueCleanupStalePullTracking,
  mockSyncQueueCleanupAllStalePullTracking,
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
  // Sync queue mocks
  mockSyncQueueEnqueue: vi.fn(),
  mockSyncQueueMarkSynced: vi.fn(),
  mockSyncQueueIncrementAttempts: vi.fn(),
  mockSyncQueueCleanupStalePullTracking: vi.fn(),
  mockSyncQueueCleanupAllStalePullTracking: vi.fn().mockReturnValue(0),
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
    enqueue: mockSyncQueueEnqueue,
    markSynced: mockSyncQueueMarkSynced,
    incrementAttempts: mockSyncQueueIncrementAttempts,
    cleanupStalePullTracking: mockSyncQueueCleanupStalePullTracking,
    cleanupAllStalePullTracking: mockSyncQueueCleanupAllStalePullTracking,
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
    // Initialize sync queue mock with deterministic queue item for assertions
    mockSyncQueueEnqueue.mockReturnValue({
      id: 'mock-queue-id-bins',
      store_id: 'store-123',
      entity_type: 'bin',
      entity_id: 'pull-1234567890',
      operation: 'UPDATE',
      payload: JSON.stringify({ action: 'pull_bins' }),
      sync_direction: 'PULL',
      synced: 0,
      sync_attempts: 0,
      created_at: '2024-01-01T00:00:00.000Z',
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

    // =========================================================================
    // Enterprise-Grade Queue Item Tracking Tests
    // Requirement: PULL tracking items must ALWAYS be marked as synced or failed
    // This prevents queue item accumulation that causes UI clutter and confusion
    // =========================================================================

    describe('sync queue item tracking (PULL tracking records)', () => {
      it('CRITICAL: should mark queue item as synced when cloud returns empty bins array', async () => {
        // This is the EXACT bug scenario - empty bins response was leaving queue items pending
        // Business impact: Queue accumulates "stuck" PULL tracking items every 5 minutes
        mockGetLastPullAt.mockReturnValue('2024-01-01T00:00:00Z');
        mockPullBins.mockResolvedValue({ bins: [] }); // Empty response - no bins to sync

        await service.syncBins();

        // CRITICAL ASSERTION: Queue item MUST be marked as synced even with empty response
        expect(mockSyncQueueMarkSynced).toHaveBeenCalledTimes(1);
        expect(mockSyncQueueMarkSynced).toHaveBeenCalledWith(
          'mock-queue-id-bins',
          expect.objectContaining({
            api_endpoint: '/api/v1/sync/lottery/bins',
            http_status: 200,
          })
        );
        // incrementAttempts should NOT be called on success
        expect(mockSyncQueueIncrementAttempts).not.toHaveBeenCalled();
      });

      it('CRITICAL: should mark queue item as synced when bins are successfully pulled', async () => {
        // Normal success path - verify queue tracking works correctly
        mockGetLastPullAt.mockReturnValue(null);
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
        mockBinsBatchUpsertFromCloud.mockReturnValue({
          created: 1,
          updated: 0,
          errors: [],
        });
        mockBinsBatchSoftDeleteNotInCloudIds.mockReturnValue(0);

        await service.syncBins();

        // Queue item must be marked synced after successful processing
        expect(mockSyncQueueMarkSynced).toHaveBeenCalledTimes(1);
        expect(mockSyncQueueMarkSynced).toHaveBeenCalledWith(
          'mock-queue-id-bins',
          expect.objectContaining({
            api_endpoint: '/api/v1/sync/lottery/bins',
            http_status: 200,
            response_body: expect.stringContaining('"pulled":1'),
          })
        );
      });

      it('CRITICAL: should increment attempts (not mark synced) on API failure', async () => {
        // Error handling - queue item should track failure for retry logic
        mockGetLastPullAt.mockReturnValue(null);
        mockPullBins.mockRejectedValue(new Error('HTTP 503: Service Unavailable'));

        await service.syncBins();

        // On failure: incrementAttempts called, markSynced NOT called
        expect(mockSyncQueueIncrementAttempts).toHaveBeenCalledTimes(1);
        expect(mockSyncQueueIncrementAttempts).toHaveBeenCalledWith(
          'mock-queue-id-bins',
          'HTTP 503: Service Unavailable',
          expect.objectContaining({
            api_endpoint: '/api/v1/sync/lottery/bins',
            http_status: 503, // Extracted from error message
          })
        );
        expect(mockSyncQueueMarkSynced).not.toHaveBeenCalled();
      });

      it('should create PULL queue item with correct entity metadata', async () => {
        // Verify queue item creation has correct metadata for monitoring/debugging
        mockGetLastPullAt.mockReturnValue('2024-01-01T00:00:00Z');
        mockPullBins.mockResolvedValue({ bins: [] });

        await service.syncBins();

        // Verify enqueue was called with correct PULL tracking metadata
        expect(mockSyncQueueEnqueue).toHaveBeenCalledTimes(1);
        expect(mockSyncQueueEnqueue).toHaveBeenCalledWith(
          expect.objectContaining({
            store_id: 'store-123',
            entity_type: 'bin',
            entity_id: expect.stringMatching(/^pull-\d+$/), // pull-{timestamp}
            operation: 'UPDATE',
            sync_direction: 'PULL',
            payload: expect.objectContaining({
              action: 'pull_bins',
              lastPull: '2024-01-01T00:00:00Z',
            }),
          })
        );
      });

      it('should handle network timeout errors with proper queue tracking', async () => {
        // Network resilience - timeout errors should be tracked for retry
        mockGetLastPullAt.mockReturnValue(null);
        mockPullBins.mockRejectedValue(new Error('ETIMEDOUT: Connection timed out'));

        const result = await service.syncBins();

        expect(result.errors).toContain('Pull failed: ETIMEDOUT: Connection timed out');
        expect(mockSyncQueueIncrementAttempts).toHaveBeenCalledWith(
          'mock-queue-id-bins',
          'ETIMEDOUT: Connection timed out',
          expect.objectContaining({
            api_endpoint: '/api/v1/sync/lottery/bins',
          })
        );
      });

      it('should handle HTTP 401 unauthorized with proper queue tracking', async () => {
        // Security scenario - auth failures tracked for alerting
        mockGetLastPullAt.mockReturnValue(null);
        mockPullBins.mockRejectedValue(new Error('HTTP 401: Unauthorized'));

        await service.syncBins();

        expect(mockSyncQueueIncrementAttempts).toHaveBeenCalledWith(
          'mock-queue-id-bins',
          'HTTP 401: Unauthorized',
          expect.objectContaining({
            http_status: 401,
          })
        );
      });

      it('should handle HTTP 500 server error with proper queue tracking', async () => {
        // Server error scenario - should be tracked for retry
        mockGetLastPullAt.mockReturnValue(null);
        mockPullBins.mockRejectedValue(new Error('HTTP 500: Internal Server Error'));

        await service.syncBins();

        expect(mockSyncQueueIncrementAttempts).toHaveBeenCalledWith(
          'mock-queue-id-bins',
          'HTTP 500: Internal Server Error',
          expect.objectContaining({
            http_status: 500,
          })
        );
      });
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
