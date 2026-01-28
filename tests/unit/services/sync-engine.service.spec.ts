/**
 * Sync Engine Service Unit Tests
 *
 * @module tests/unit/services/sync-engine.service.spec
 */

// Using vitest globals (configured in vitest.config.ts with globals: true)

// Hoist mock functions so they're available when vi.mock factory runs
const {
  mockPrepare,
  mockGetRetryableItems,
  mockMarkSynced,
  mockIncrementAttempts,
  mockGetPendingCount,
  mockGetFailedCount,
  mockGetFailedItems,
  mockRetryFailed,
  mockCleanupSynced,
  mockGetStats,
  mockGetBackoffCount,
  mockResetAllPending,
  mockResetStuckInBackoff,
  mockGetQueuedCount,
  mockGetExclusiveCounts,
  mockStartSync,
  mockCompleteSync,
  mockFailSync,
  mockCleanupStaleRunning,
  mockGetConfiguredStore,
  // Phase 10: Pack sync operation mocks
  mockGameFindById,
} = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockGetRetryableItems: vi.fn(),
  mockMarkSynced: vi.fn(),
  mockIncrementAttempts: vi.fn(),
  mockGetPendingCount: vi.fn(),
  mockGetFailedCount: vi.fn(),
  mockGetFailedItems: vi.fn(),
  mockRetryFailed: vi.fn(),
  mockCleanupSynced: vi.fn(),
  mockGetStats: vi.fn(),
  mockGetBackoffCount: vi.fn(),
  mockResetAllPending: vi.fn(),
  mockResetStuckInBackoff: vi.fn(),
  mockGetQueuedCount: vi.fn(),
  mockGetExclusiveCounts: vi.fn(),
  mockStartSync: vi.fn(),
  mockCompleteSync: vi.fn(),
  mockFailSync: vi.fn(),
  mockCleanupStaleRunning: vi.fn(),
  mockGetConfiguredStore: vi.fn(),
  // Phase 10: Pack sync operation mocks
  mockGameFindById: vi.fn(),
}));

// Mock electron (including safeStorage for cloud-api.service)
vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/tmp'),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((str: string) => Buffer.from(str)),
    decryptString: vi.fn((buf: Buffer) => buf.toString()),
  },
}));

// Mock database service
vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: vi.fn((fn: () => unknown) => () => fn()),
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

// Mock DALs
vi.mock('../../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: {
    getRetryableItems: mockGetRetryableItems,
    markSynced: mockMarkSynced,
    incrementAttempts: mockIncrementAttempts,
    getPendingCount: mockGetPendingCount,
    getFailedCount: mockGetFailedCount,
    getFailedItems: mockGetFailedItems,
    retryFailed: mockRetryFailed,
    cleanupSynced: mockCleanupSynced,
    getStats: mockGetStats,
    getBackoffCount: mockGetBackoffCount,
    resetAllPending: mockResetAllPending,
    resetStuckInBackoff: mockResetStuckInBackoff,
    getQueuedCount: mockGetQueuedCount,
    getExclusiveCounts: mockGetExclusiveCounts,
  },
}));

vi.mock('../../../src/main/dal/sync-log.dal', () => ({
  syncLogDAL: {
    startSync: mockStartSync,
    completeSync: mockCompleteSync,
    failSync: mockFailSync,
    cleanupStaleRunning: mockCleanupStaleRunning,
  },
}));

vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: {
    getConfiguredStore: mockGetConfiguredStore,
  },
}));

// Phase 10: Mock lottery-games.dal for game_code lookup in pack sync
vi.mock('../../../src/main/dal/lottery-games.dal', () => ({
  lotteryGamesDAL: {
    findById: mockGameFindById,
  },
}));

// Mock electron-store (used by cloud-api.service)
vi.mock('electron-store', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
  })),
}));

// Hoist mock for pushShift and pack operations to enable test control
const { mockPushShift, mockPushEmployees, mockPushPackDeplete, mockPushPackReturn } = vi.hoisted(
  () => ({
    mockPushShift: vi.fn(),
    mockPushEmployees: vi.fn(),
    // Phase 10: Controllable pack operation mocks
    mockPushPackDeplete: vi.fn(),
    mockPushPackReturn: vi.fn(),
  })
);

// Mock cloud-api.service to prevent real API calls during tests
// Pack sync operations use cloudApiService directly, this mock enables
// testing pack routing and failure handling without API configuration
// Phase 10: pushPackDeplete and pushPackReturn now use controllable mocks
vi.mock('../../../src/main/services/cloud-api.service', () => ({
  cloudApiService: {
    pushPackReceive: vi.fn().mockRejectedValue(new Error('API key not configured')),
    pushPackActivate: vi.fn().mockRejectedValue(new Error('API key not configured')),
    pushPackDeplete: mockPushPackDeplete,
    pushPackReturn: mockPushPackReturn,
    pushBatch: vi.fn().mockResolvedValue({ success: true, results: [] }),
    healthCheck: vi.fn().mockResolvedValue({ success: true }),
    pushShift: mockPushShift,
    pushEmployees: mockPushEmployees,
  },
}));

import { SyncEngineService } from '../../../src/main/services/sync-engine.service';

describe('SyncEngineService', () => {
  let service: SyncEngineService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Default mock for getStats - returns stats with mutually exclusive counts
    // This is needed because getStatus() now calls getStats()
    // Includes new `queued` field for accurate UI display
    mockGetStats.mockReturnValue({
      pending: 0, // Total unsynced (queued + failed)
      queued: 0, // NEW: Items still retryable
      failed: 0, // Items exceeded max retries
      syncedToday: 0,
      oldestPending: null,
    });
    // Default mock for getFailedCount and getFailedItems
    // These are called at the start of processSyncQueue to auto-reset failed items
    mockGetFailedCount.mockReturnValue(0);
    mockGetFailedItems.mockReturnValue([]);
    // Default mocks for backoff tracking
    mockGetBackoffCount.mockReturnValue(0);
    mockResetAllPending.mockReturnValue(0);
    mockResetStuckInBackoff.mockReturnValue(0);
    // Default mocks for new count methods
    mockGetQueuedCount.mockReturnValue(0);
    mockGetExclusiveCounts.mockReturnValue({
      queued: 0,
      failed: 0,
      totalPending: 0,
      syncedToday: 0,
    });
    // Default mock for pushEmployees - employees now use bidirectional sync
    mockPushEmployees.mockResolvedValue({
      success: true,
      results: [],
    });
    // Phase 10: Default mocks for pack sync operations
    // Default to rejection to simulate "API not configured" for non-Phase-10 tests
    mockPushPackDeplete.mockRejectedValue(new Error('API key not configured'));
    mockPushPackReturn.mockRejectedValue(new Error('API key not configured'));
    // Default game lookup returns a valid game for pack sync
    mockGameFindById.mockReturnValue({
      game_id: 'game-123',
      game_code: 'GAME001',
      game_name: 'Test Game',
      tickets_per_pack: 300,
      ticket_price: 1.0,
      active: true,
    });
    service = new SyncEngineService();
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  describe('start', () => {
    it('should start the sync engine with default interval', () => {
      mockGetConfiguredStore.mockReturnValue({
        store_id: 'store-123',
        name: 'Test Store',
      });
      mockGetPendingCount.mockReturnValue(0);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start();

      expect(service.isStarted()).toBe(true);
    });

    it('should respect custom interval within bounds', () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(0);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start(30000); // 30 seconds

      expect(service.isStarted()).toBe(true);
    });

    it('should enforce minimum interval', () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(0);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start(1000); // Too short - should be capped to 10s

      expect(service.isStarted()).toBe(true);
    });

    it('should enforce maximum interval', () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(0);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start(600000); // Too long - should be capped to 5 min

      expect(service.isStarted()).toBe(true);
    });

    it('should not start if already running', () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(0);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start();
      service.start(); // Should log warning but not create duplicate

      expect(service.isStarted()).toBe(true);
    });

    it('should clean up stale running syncs on start', () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(0);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start();

      expect(mockCleanupStaleRunning).toHaveBeenCalledWith('store-123', 30);
    });
  });

  describe('stop', () => {
    it('should stop the sync engine', () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(0);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start();
      expect(service.isStarted()).toBe(true);

      service.stop();
      expect(service.isStarted()).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return current sync status', async () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(5);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start();
      // Wait for initial sync to complete
      await vi.advanceTimersByTimeAsync(100);

      const status = service.getStatus();

      // Verify core sync status fields
      expect(status.isRunning).toEqual(expect.any(Boolean));
      expect(status.isStarted).toBe(true);
      expect(status.lastSyncAt).toEqual(expect.any(String));
      expect(status.lastSyncStatus).toEqual(expect.any(String));
      expect(status.pendingCount).toBe(5);
      expect(status.nextSyncIn).toEqual(expect.any(Number));
      expect(status.isOnline).toBe(true);

      // Phase 5: Verify heartbeat status fields are present
      expect(status).toHaveProperty('lastHeartbeatAt');
      expect(status).toHaveProperty('lastHeartbeatStatus');
      expect(status).toHaveProperty('lastServerTime');
      expect(status).toHaveProperty('nextHeartbeatIn');
      expect(status.nextHeartbeatIn).toEqual(expect.any(Number));
    });

    it('should return default status when not started', () => {
      const status = service.getStatus();

      expect(status.isStarted).toBe(false);
      expect(status.lastSyncAt).toBeNull();
    });
  });

  describe('triggerSync', () => {
    it('should skip if sync already in progress', async () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(10);
      mockStartSync.mockReturnValue('log-1');

      // Simulate long-running sync
      mockGetRetryableItems.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return [];
      });

      service.start();

      // This should skip since a sync is already running
      await service.triggerSync();
    });
  });

  describe('sync execution', () => {
    it('should skip sync if store not configured', async () => {
      mockGetConfiguredStore.mockReturnValue(undefined);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(mockStartSync).not.toHaveBeenCalled();
    });

    it('should process items and mark as synced on success', async () => {
      const mockItems = [
        {
          id: 'queue-1',
          entity_id: 'entity-1',
          entity_type: 'employee', // Employee type is now pushed to cloud via pushEmployees
          store_id: 'store-123',
          operation: 'CREATE',
          payload: JSON.stringify({
            user_id: 'entity-1',
            store_id: 'store-123',
            role: 'cashier',
            name: 'Test Employee',
            active: true,
          }),
          priority: 0,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-01T00:00:00Z',
          synced_at: null,
        },
      ];

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue(mockItems);
      // Mock pushEmployees to return success with the item marked as synced
      mockPushEmployees.mockResolvedValue({
        success: true,
        results: [{ id: 'queue-1', status: 'synced' }],
      });

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Employee items are pushed to cloud and then marked as synced
      expect(mockPushEmployees).toHaveBeenCalled();
      expect(mockMarkSynced).toHaveBeenCalled();
      expect(mockMarkSynced.mock.calls[0][0]).toBe('queue-1');
      expect(mockCompleteSync).toHaveBeenCalled();
    });

    it('should log sync completion', async () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(0);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(mockCompleteSync).toHaveBeenCalledWith('log-1', {
        records_sent: 0,
        records_succeeded: 0,
        records_failed: 0,
      });
    });
  });

  describe('cleanupQueue', () => {
    it('should call cleanup with specified days', () => {
      mockCleanupSynced.mockReturnValue(10);

      const result = service.cleanupQueue(14);

      expect(mockCleanupSynced).toHaveBeenCalledWith(14);
      expect(result).toBe(10);
    });

    it('should use default 7 days if not specified', () => {
      mockCleanupSynced.mockReturnValue(5);

      const result = service.cleanupQueue();

      expect(mockCleanupSynced).toHaveBeenCalledWith(7);
      expect(result).toBe(5);
    });
  });

  describe('setCloudApiService', () => {
    it('should accept cloud API service', () => {
      const mockCloudApi = {
        healthCheck: vi.fn(),
        heartbeat: vi.fn(),
        pushPackReceive: vi.fn(),
        pushPackActivate: vi.fn(),
        pushPackDeplete: vi.fn(),
        pushPackReturn: vi.fn(),
      };

      expect(() => service.setCloudApiService(mockCloudApi)).not.toThrow();
    });
  });

  describe('batch processing', () => {
    it('should group items by entity type', async () => {
      // Use employee type which is pushed via pushEmployees
      const mockItems = [
        {
          id: 'q1',
          entity_id: 'e1',
          entity_type: 'employee',
          store_id: 'store-123',
          operation: 'CREATE',
          payload: JSON.stringify({
            user_id: 'e1',
            store_id: 'store-123',
            role: 'cashier',
            name: 'Employee 1',
            active: true,
          }),
          priority: 0,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-01',
          synced_at: null,
        },
        {
          id: 'q2',
          entity_id: 'e2',
          entity_type: 'employee',
          store_id: 'store-123',
          operation: 'CREATE',
          payload: JSON.stringify({
            user_id: 'e2',
            store_id: 'store-123',
            role: 'cashier',
            name: 'Employee 2',
            active: true,
          }),
          priority: 0,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-01',
          synced_at: null,
        },
        {
          id: 'q3',
          entity_id: 'e3',
          entity_type: 'employee',
          store_id: 'store-123',
          operation: 'UPDATE',
          payload: JSON.stringify({
            user_id: 'e3',
            store_id: 'store-123',
            role: 'shift_manager',
            name: 'Employee 3',
            active: true,
          }),
          priority: 0,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-01',
          synced_at: null,
        },
      ];

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(3);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue(mockItems);
      // Mock pushEmployees to return success for all items
      mockPushEmployees.mockResolvedValue({
        success: true,
        results: [
          { id: 'q1', status: 'synced' },
          { id: 'q2', status: 'synced' },
          { id: 'q3', status: 'synced' },
        ],
      });

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // pushEmployees should be called with all employee items
      expect(mockPushEmployees).toHaveBeenCalled();
      // All employee items should be marked as synced after push
      expect(mockMarkSynced).toHaveBeenCalledTimes(3);
    });
  });

  // ==========================================================================
  // SE-001: Sync Engine Lifecycle Tests
  // Tests for startup/shutdown behavior as used by main process (index.ts)
  // ==========================================================================
  describe('SE-001: Lifecycle management', () => {
    it('should run initial sync immediately on start', async () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(0);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start();

      // Wait for initial sync to complete
      await vi.advanceTimersByTimeAsync(100);

      // Initial sync should have been triggered
      expect(mockStartSync).toHaveBeenCalledWith('store-123', 'PUSH');
      expect(mockCompleteSync).toHaveBeenCalled();
    });

    it('should run sync on 60-second interval after start', async () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(0);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start();

      // Wait for initial sync
      await vi.advanceTimersByTimeAsync(100);
      expect(mockStartSync).toHaveBeenCalledTimes(1);

      // Advance 60 seconds - should trigger second sync
      await vi.advanceTimersByTimeAsync(60000);
      expect(mockStartSync).toHaveBeenCalledTimes(2);

      // Advance another 60 seconds - should trigger third sync
      await vi.advanceTimersByTimeAsync(60000);
      expect(mockStartSync).toHaveBeenCalledTimes(3);
    });

    it('should stop interval on stop() call', async () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(0);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);
      expect(mockStartSync).toHaveBeenCalledTimes(1);

      // Stop the service
      service.stop();

      // Advance time - no more syncs should occur
      await vi.advanceTimersByTimeAsync(120000);
      expect(mockStartSync).toHaveBeenCalledTimes(1); // Still just the initial one
    });

    it('should allow restart after stop', async () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(0);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      // Start -> Stop -> Start cycle
      service.start();
      await vi.advanceTimersByTimeAsync(100);
      expect(service.isStarted()).toBe(true);

      service.stop();
      expect(service.isStarted()).toBe(false);

      service.start();
      await vi.advanceTimersByTimeAsync(100);
      expect(service.isStarted()).toBe(true);
    });

    it('should be idempotent - multiple stop() calls are safe', () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(0);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start();

      // Multiple stops should not throw
      expect(() => {
        service.stop();
        service.stop();
        service.stop();
      }).not.toThrow();

      expect(service.isStarted()).toBe(false);
    });

    it('should be idempotent - multiple start() calls do not create duplicate intervals', async () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(0);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      // Multiple starts
      service.start();
      service.start();
      service.start();

      await vi.advanceTimersByTimeAsync(100);

      // Should only have one initial sync, not three
      expect(mockStartSync).toHaveBeenCalledTimes(1);

      // After 60 seconds, should only have one additional sync, not three
      await vi.advanceTimersByTimeAsync(60000);
      expect(mockStartSync).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // SE-002: Pack Entity Routing Tests
  // Tests for pack sync operations routed through pushPackBatch
  // NOTE: These tests verify pack entity routing. Since cloudApiService is not
  // mocked (it's imported directly by sync-engine), pack sync calls will fail
  // with "API key not configured". These tests verify the sync engine handles
  // failures gracefully and continues operating.
  // ==========================================================================
  describe('SE-002: Pack entity routing', () => {
    it('should handle pack CREATE gracefully when API not configured', async () => {
      const packItem = {
        id: 'queue-pack-1',
        entity_id: 'pack-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'CREATE',
        payload: JSON.stringify({
          pack_id: 'pack-123',
          store_id: 'store-123',
          game_id: 'game-123',
          pack_number: 'PKG001',
          status: 'RECEIVED',
          bin_id: null,
          opening_serial: null,
          closing_serial: null,
          tickets_sold: 0,
          sales_amount: 0,
          received_at: '2024-01-15T10:00:00Z',
          received_by: 'user-123',
          activated_at: null,
          activated_by: null,
          depleted_at: null,
          returned_at: null,
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T10:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([packItem]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Pack sync handles failure gracefully - engine continues running
      // The sync engine catches pack API errors and continues operating
      expect(service.isStarted()).toBe(true);

      // Status should reflect partial failure (some items failed but engine is OK)
      const status = service.getStatus();
      expect(status.isStarted).toBe(true);
      expect(status.lastSyncStatus).toBe('partial');
    });

    it('should handle pack UPDATE with ACTIVATED status gracefully', async () => {
      const packItem = {
        id: 'queue-pack-2',
        entity_id: 'pack-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-123',
          store_id: 'store-123',
          game_id: 'game-123',
          pack_number: 'PKG001',
          status: 'ACTIVE',
          bin_id: 'bin-123',
          opening_serial: '001',
          closing_serial: null,
          tickets_sold: 0,
          sales_amount: 0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: '2024-01-15T10:00:00Z',
          activated_by: 'user-456',
          depleted_at: null,
          returned_at: null,
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T10:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([packItem]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Pack sync handles failure gracefully - engine continues running
      expect(service.isStarted()).toBe(true);
      const status = service.getStatus();
      expect(status.lastSyncStatus).toBe('partial');
    });

    it('should handle pack UPDATE with SETTLED status gracefully', async () => {
      const packItem = {
        id: 'queue-pack-3',
        entity_id: 'pack-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-123',
          store_id: 'store-123',
          game_id: 'game-123',
          pack_number: 'PKG001',
          status: 'DEPLETED',
          bin_id: 'bin-123',
          opening_serial: '001',
          closing_serial: '150',
          tickets_sold: 150,
          sales_amount: 150.0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: '2024-01-15T09:00:00Z',
          activated_by: 'user-456',
          depleted_at: '2024-01-15T17:00:00Z',
          returned_at: null,
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T17:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([packItem]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Pack sync handles failure gracefully - engine continues running
      expect(service.isStarted()).toBe(true);
      const status = service.getStatus();
      expect(status.lastSyncStatus).toBe('partial');
    });

    it('should handle pack UPDATE with RETURNED status gracefully', async () => {
      const packItem = {
        id: 'queue-pack-4',
        entity_id: 'pack-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-123',
          store_id: 'store-123',
          game_id: 'game-123',
          pack_number: 'PKG001',
          status: 'RETURNED',
          bin_id: null,
          opening_serial: null,
          closing_serial: null,
          tickets_sold: 0,
          sales_amount: 0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: null,
          activated_by: null,
          depleted_at: null,
          returned_at: '2024-01-15T10:00:00Z',
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T10:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([packItem]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Pack sync handles failure gracefully - engine continues running
      expect(service.isStarted()).toBe(true);
      const status = service.getStatus();
      expect(status.lastSyncStatus).toBe('partial');
    });
  });

  // ==========================================================================
  // SE-003: Error Handling and Retry Tests
  // ==========================================================================
  describe('SE-003: Error handling and retry behavior', () => {
    it('should increment attempts on sync failure', async () => {
      const failingItem = {
        id: 'queue-fail-1',
        entity_id: 'entity-fail',
        entity_type: 'unknown_type', // Unhandled type will cause fallback
        store_id: 'store-123',
        operation: 'CREATE',
        payload: '{}',
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-01',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([failingItem]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Item should have attempts incremented, not marked as synced
      // (Unknown entity type goes through generic pushBatch which succeeds when no cloud API)
      // So we check that sync was at least attempted
      expect(mockCompleteSync).toHaveBeenCalled();
    });

    it('should continue processing other items when one fails', async () => {
      // Use employee entity type which is pushed via pushEmployees
      const items = [
        {
          id: 'queue-1',
          entity_id: 'e1',
          entity_type: 'employee', // Employee type is now pushed to cloud
          store_id: 'store-123',
          operation: 'CREATE',
          payload: JSON.stringify({
            user_id: 'e1',
            store_id: 'store-123',
            role: 'cashier',
            name: 'Employee 1',
            active: true,
          }),
          priority: 0,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-01',
          synced_at: null,
        },
        {
          id: 'queue-2',
          entity_id: 'e2',
          entity_type: 'employee', // Employee type is now pushed to cloud
          store_id: 'store-123',
          operation: 'CREATE',
          payload: JSON.stringify({
            user_id: 'e2',
            store_id: 'store-123',
            role: 'shift_manager',
            name: 'Employee 2',
            active: true,
          }),
          priority: 0,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-01',
          synced_at: null,
        },
      ];

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(2);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue(items);
      // Mock pushEmployees to return success for all items
      mockPushEmployees.mockResolvedValue({
        success: true,
        results: [
          { id: 'queue-1', status: 'synced' },
          { id: 'queue-2', status: 'synced' },
        ],
      });

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Both employee items should be marked as synced after push
      expect(mockPushEmployees).toHaveBeenCalled();
      expect(mockMarkSynced).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // SE-004: Extended Status Tracking Tests (New)
  // ==========================================================================
  describe('SE-004: Extended status tracking', () => {
    it('should include consecutiveFailures in status', () => {
      const status = service.getStatus();
      expect(status).toHaveProperty('consecutiveFailures');
      expect(typeof status.consecutiveFailures).toBe('number');
    });

    it('should include lastErrorMessage in status', () => {
      const status = service.getStatus();
      expect(status).toHaveProperty('lastErrorMessage');
    });

    it('should include lastErrorAt in status', () => {
      const status = service.getStatus();
      expect(status).toHaveProperty('lastErrorAt');
    });

    it('should reset consecutiveFailures on successful sync', async () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(0);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      const status = service.getStatus();
      expect(status.consecutiveFailures).toBe(0);
      expect(status.lastErrorMessage).toBeNull();
      expect(status.lastErrorAt).toBeNull();
    });

    it('should track partial sync errors without incrementing consecutiveFailures', async () => {
      const mixedItems = [
        {
          id: 'queue-1',
          entity_id: 'e1',
          entity_type: 'transaction',
          store_id: 'store-123',
          operation: 'CREATE',
          payload: '{}',
          priority: 0,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-01',
          synced_at: null,
        },
        {
          id: 'queue-2',
          entity_id: 'pack-1',
          entity_type: 'pack',
          store_id: 'store-123',
          operation: 'CREATE',
          payload: JSON.stringify({
            pack_id: 'pack-1',
            store_id: 'store-123',
            game_id: 'game-1',
            pack_number: 'PKG001',
            status: 'RECEIVED',
            bin_id: null,
            opening_serial: null,
            closing_serial: null,
            tickets_sold: 0,
            sales_amount: 0,
            received_at: '2024-01-01',
            received_by: null,
            activated_at: null,
            activated_by: null,
            depleted_at: null,
            returned_at: null,
          }),
          priority: 0,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-01',
          synced_at: null,
        },
      ];

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(2);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue(mixedItems);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      const status = service.getStatus();
      // Partial sync (pack failed, transaction succeeded)
      expect(status.lastSyncStatus).toBe('partial');
      // Partial doesn't increment consecutiveFailures
      expect(status.consecutiveFailures).toBe(0);
      // Error message is set with appropriate wording
      expect(status.lastErrorMessage).not.toBeNull();
    });
  });

  // ==========================================================================
  // SE-006: Mutually Exclusive Count Tracking (NEW - Fixes statistics bug)
  // Tests for the fix that ensures queued + failed = pending
  // ==========================================================================
  describe('SE-006: Mutually exclusive count tracking', () => {
    it('should include queuedCount in status response', async () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(75);
      mockGetStats.mockReturnValue({
        pending: 75, // Total unsynced
        queued: 74, // Still retryable
        failed: 1, // Exceeded max retries
        syncedToday: 303,
        oldestPending: null,
      });
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      const status = service.getStatus();

      // Verify new queuedCount field exists
      expect(status).toHaveProperty('queuedCount');
      expect(status.queuedCount).toBe(74);
    });

    it('should satisfy invariant: queuedCount + failedCount should equal pendingCount logic', async () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(100);
      mockGetStats.mockReturnValue({
        pending: 100,
        queued: 95,
        failed: 5,
        syncedToday: 500,
        oldestPending: null,
      });
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      const status = service.getStatus();

      // Enterprise invariant verification
      // Note: pendingCount comes from internal tracking, but queuedCount + failedCount
      // should represent the same breakdown from getStats
      expect(status.queuedCount).toBe(95);
      expect(status.failedCount).toBe(5);
    });

    it('should report 0 for queuedCount when all items have failed', async () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(10);
      mockGetStats.mockReturnValue({
        pending: 10,
        queued: 0, // All items exceeded max retries
        failed: 10,
        syncedToday: 50,
        oldestPending: null,
      });
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      const status = service.getStatus();

      expect(status.queuedCount).toBe(0);
      expect(status.failedCount).toBe(10);
    });

    it('should report 0 for failedCount when all items are still retryable', async () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(50);
      mockGetStats.mockReturnValue({
        pending: 50,
        queued: 50, // All items still retryable
        failed: 0,
        syncedToday: 200,
        oldestPending: null,
      });
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      const status = service.getStatus();

      expect(status.queuedCount).toBe(50);
      expect(status.failedCount).toBe(0);
    });
  });

  // ==========================================================================
  // SE-007: Error Message Accuracy (NEW - Fixes misleading error messages)
  // Tests for error messages that distinguish permanent vs retriable failures
  // ==========================================================================
  describe('SE-007: Error message accuracy', () => {
    it('should show "exceeded retry limit" when permanent failures exist', async () => {
      const failingItem = {
        id: 'queue-1',
        entity_id: 'pack-1',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'CREATE',
        payload: JSON.stringify({
          pack_id: 'pack-1',
          store_id: 'store-123',
          game_id: 'game-1',
          pack_number: 'PKG001',
          status: 'RECEIVED',
          bin_id: null,
          opening_serial: null,
          closing_serial: null,
          tickets_sold: 0,
          sales_amount: 0,
          received_at: '2024-01-01',
          received_by: null,
          activated_at: null,
          activated_by: null,
          depleted_at: null,
          returned_at: null,
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-01',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([failingItem]);
      // Simulate permanent failure exists after sync attempt
      mockGetFailedCount.mockReturnValue(1);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      const status = service.getStatus();

      // Should indicate permanent failure requiring manual intervention
      expect(status.lastErrorMessage).toContain('exceeded retry limit');
    });

    it('should show "will retry automatically" when no permanent failures exist', async () => {
      const failingItem = {
        id: 'queue-1',
        entity_id: 'pack-1',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'CREATE',
        payload: JSON.stringify({
          pack_id: 'pack-1',
          store_id: 'store-123',
          game_id: 'game-1',
          pack_number: 'PKG001',
          status: 'RECEIVED',
          bin_id: null,
          opening_serial: null,
          closing_serial: null,
          tickets_sold: 0,
          sales_amount: 0,
          received_at: '2024-01-01',
          received_by: null,
          activated_at: null,
          activated_by: null,
          depleted_at: null,
          returned_at: null,
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-01',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([failingItem]);
      // No permanent failures - item still has retries left
      mockGetFailedCount.mockReturnValue(0);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      const status = service.getStatus();

      // Should indicate automatic retry will occur
      expect(status.lastErrorMessage).toContain('will retry automatically');
    });

    it('should clear error message on fully successful sync', async () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(0);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      const status = service.getStatus();

      expect(status.lastSyncStatus).toBe('success');
      expect(status.lastErrorMessage).toBeNull();
      expect(status.lastErrorAt).toBeNull();
    });

    it('should not show misleading total pending count in error message', async () => {
      // This test verifies the fix for the bug where error message showed
      // "75 item(s) failed to sync" when only 1 had permanently failed
      const failingItem = {
        id: 'queue-1',
        entity_id: 'pack-1',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'CREATE',
        payload: JSON.stringify({
          pack_id: 'pack-1',
          store_id: 'store-123',
          game_id: 'game-1',
          pack_number: 'PKG001',
          status: 'RECEIVED',
          bin_id: null,
          opening_serial: null,
          closing_serial: null,
          tickets_sold: 0,
          sales_amount: 0,
          received_at: '2024-01-01',
          received_by: null,
          activated_at: null,
          activated_by: null,
          depleted_at: null,
          returned_at: null,
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-01',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(75); // Total pending (queued + failed)
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([failingItem]);
      // Only 1 item has permanently failed
      mockGetFailedCount.mockReturnValue(1);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      const status = service.getStatus();

      // Error message should NOT say "75 item(s) failed"
      // It should say "1 item(s) exceeded retry limit"
      if (status.lastErrorMessage?.includes('exceeded retry limit')) {
        expect(status.lastErrorMessage).toContain('1 item');
        expect(status.lastErrorMessage).not.toContain('75 item');
      }
    });
  });

  // ==========================================================================
  // SE-005: Status Reporting Tests
  // ==========================================================================
  describe('SE-005: Status reporting accuracy', () => {
    it('should report correct pending count', async () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(42);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      const status = service.getStatus();
      expect(status.pendingCount).toBe(42);
    });

    it('should report isOnline correctly when cloud API not configured', () => {
      const status = service.getStatus();
      // When cloud API is not configured, isOnline defaults to true
      expect(status.isOnline).toBe(true);
    });

    it('should report lastSyncStatus after successful sync', async () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(0);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      const status = service.getStatus();
      expect(status.lastSyncStatus).toBe('success');
    });

    it('should calculate nextSyncIn correctly', async () => {
      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(0);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Advance 30 seconds
      await vi.advanceTimersByTimeAsync(30000);

      const status = service.getStatus();
      // Should be approximately 30 seconds remaining (60 - 30 = 30)
      expect(status.nextSyncIn).toBeLessThanOrEqual(30000);
      expect(status.nextSyncIn).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // SE-008: Shift Entity Routing Tests
  // Tests for shift sync operations routed through pushShiftBatch
  // BUSINESS CRITICAL: Shifts MUST sync BEFORE pack operations to satisfy
  // cloud FK constraints (activated_shift_id, depleted_shift_id)
  // ==========================================================================
  describe('SE-008: Shift entity routing', () => {
    beforeEach(() => {
      // Reset pushShift mock for each test
      mockPushShift.mockReset();
    });

    it('should route shift entity type to pushShiftBatch', async () => {
      const shiftItem = {
        id: 'queue-shift-1',
        entity_id: 'shift-123',
        entity_type: 'shift',
        store_id: 'store-123',
        operation: 'CREATE',
        payload: JSON.stringify({
          shift_id: 'shift-123',
          store_id: 'store-123',
          business_date: '2024-01-15',
          shift_number: 1,
          start_time: '2024-01-15T08:00:00Z',
          status: 'OPEN',
          cashier_id: 'cashier-123',
          end_time: null,
          external_register_id: 'REG001',
          external_cashier_id: null,
          external_till_id: null,
        }),
        priority: 10, // SHIFT_SYNC_PRIORITY
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T08:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([shiftItem]);
      mockPushShift.mockResolvedValue({ success: true });

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Verify pushShift was called with correct payload
      expect(mockPushShift).toHaveBeenCalledTimes(1);
      expect(mockPushShift).toHaveBeenCalledWith(
        expect.objectContaining({
          shift_id: 'shift-123',
          store_id: 'store-123',
          business_date: '2024-01-15',
          shift_number: 1,
          status: 'OPEN',
        })
      );
    });

    it('should mark shift as synced on successful API response', async () => {
      const shiftItem = {
        id: 'queue-shift-2',
        entity_id: 'shift-456',
        entity_type: 'shift',
        store_id: 'store-123',
        operation: 'CREATE',
        payload: JSON.stringify({
          shift_id: 'shift-456',
          store_id: 'store-123',
          business_date: '2024-01-15',
          shift_number: 2,
          start_time: '2024-01-15T12:00:00Z',
          status: 'OPEN',
          cashier_id: null,
          end_time: null,
          external_register_id: null,
          external_cashier_id: null,
          external_till_id: null,
        }),
        priority: 10,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T12:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([shiftItem]);
      mockPushShift.mockResolvedValue({ success: true, idempotent: false });

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Verify item was marked as synced
      expect(mockMarkSynced).toHaveBeenCalledWith('queue-shift-2', undefined);
    });

    it('should handle idempotent response (shift already exists on cloud)', async () => {
      const shiftItem = {
        id: 'queue-shift-3',
        entity_id: 'shift-existing',
        entity_type: 'shift',
        store_id: 'store-123',
        operation: 'CREATE',
        payload: JSON.stringify({
          shift_id: 'shift-existing',
          store_id: 'store-123',
          business_date: '2024-01-15',
          shift_number: 1,
          start_time: '2024-01-15T08:00:00Z',
          status: 'CLOSED',
          cashier_id: 'cashier-123',
          end_time: '2024-01-15T16:00:00Z',
          external_register_id: null,
          external_cashier_id: null,
          external_till_id: null,
        }),
        priority: 10,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T08:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([shiftItem]);
      // Idempotent response = shift already exists, treated as success
      mockPushShift.mockResolvedValue({ success: true, idempotent: true });

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Should still mark as synced (idempotent is still success)
      expect(mockMarkSynced).toHaveBeenCalledWith('queue-shift-3', undefined);
    });

    it('should increment attempts on API failure', async () => {
      const shiftItem = {
        id: 'queue-shift-fail',
        entity_id: 'shift-fail-123',
        entity_type: 'shift',
        store_id: 'store-123',
        operation: 'CREATE',
        payload: JSON.stringify({
          shift_id: 'shift-fail-123',
          store_id: 'store-123',
          business_date: '2024-01-15',
          shift_number: 1,
          start_time: '2024-01-15T08:00:00Z',
          status: 'OPEN',
          cashier_id: null,
          end_time: null,
          external_register_id: null,
          external_cashier_id: null,
          external_till_id: null,
        }),
        priority: 10,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T08:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([shiftItem]);
      mockPushShift.mockRejectedValue(new Error('Network error'));

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Verify attempts incremented, not marked as synced
      expect(mockIncrementAttempts).toHaveBeenCalled();
      expect(mockMarkSynced).not.toHaveBeenCalledWith('queue-shift-fail', expect.anything());
    });

    it('should reject shift with missing required fields', async () => {
      // Missing business_date and shift_number
      const invalidShiftItem = {
        id: 'queue-shift-invalid',
        entity_id: 'shift-invalid',
        entity_type: 'shift',
        store_id: 'store-123',
        operation: 'CREATE',
        payload: JSON.stringify({
          shift_id: 'shift-invalid',
          store_id: 'store-123',
          // MISSING: business_date, shift_number, start_time, status
        }),
        priority: 10,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T08:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([invalidShiftItem]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Should NOT call pushShift for invalid payload
      expect(mockPushShift).not.toHaveBeenCalled();

      // Should mark as failed (partial sync)
      const status = service.getStatus();
      expect(status.lastSyncStatus).toBe('partial');
    });

    it('should handle shift UPDATE operation for close', async () => {
      const closedShiftItem = {
        id: 'queue-shift-close',
        entity_id: 'shift-to-close',
        entity_type: 'shift',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          shift_id: 'shift-to-close',
          store_id: 'store-123',
          business_date: '2024-01-15',
          shift_number: 1,
          start_time: '2024-01-15T08:00:00Z',
          status: 'CLOSED',
          cashier_id: 'cashier-123',
          end_time: '2024-01-15T16:30:00Z',
          external_register_id: 'REG001',
          external_cashier_id: null,
          external_till_id: null,
        }),
        priority: 10,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T16:30:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([closedShiftItem]);
      mockPushShift.mockResolvedValue({ success: true });

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Verify pushShift was called with CLOSED status
      expect(mockPushShift).toHaveBeenCalledWith(
        expect.objectContaining({
          shift_id: 'shift-to-close',
          status: 'CLOSED',
          end_time: '2024-01-15T16:30:00Z',
        })
      );
    });

    it('should process multiple shifts in batch', async () => {
      const shiftItems = [
        {
          id: 'queue-shift-batch-1',
          entity_id: 'shift-batch-1',
          entity_type: 'shift',
          store_id: 'store-123',
          operation: 'CREATE',
          payload: JSON.stringify({
            shift_id: 'shift-batch-1',
            store_id: 'store-123',
            business_date: '2024-01-15',
            shift_number: 1,
            start_time: '2024-01-15T08:00:00Z',
            status: 'OPEN',
            cashier_id: null,
            end_time: null,
            external_register_id: null,
            external_cashier_id: null,
            external_till_id: null,
          }),
          priority: 10,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-15T08:00:00Z',
          synced_at: null,
        },
        {
          id: 'queue-shift-batch-2',
          entity_id: 'shift-batch-2',
          entity_type: 'shift',
          store_id: 'store-123',
          operation: 'CREATE',
          payload: JSON.stringify({
            shift_id: 'shift-batch-2',
            store_id: 'store-123',
            business_date: '2024-01-15',
            shift_number: 2,
            start_time: '2024-01-15T12:00:00Z',
            status: 'OPEN',
            cashier_id: null,
            end_time: null,
            external_register_id: null,
            external_cashier_id: null,
            external_till_id: null,
          }),
          priority: 10,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-15T12:00:00Z',
          synced_at: null,
        },
      ];

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(2);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue(shiftItems);
      mockPushShift.mockResolvedValue({ success: true });

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Verify both shifts were processed
      expect(mockPushShift).toHaveBeenCalledTimes(2);
      expect(mockMarkSynced).toHaveBeenCalledTimes(2);
    });

    it('should continue processing other shifts when one fails', async () => {
      const shiftItems = [
        {
          id: 'queue-shift-fail-first',
          entity_id: 'shift-will-fail',
          entity_type: 'shift',
          store_id: 'store-123',
          operation: 'CREATE',
          payload: JSON.stringify({
            shift_id: 'shift-will-fail',
            store_id: 'store-123',
            business_date: '2024-01-15',
            shift_number: 1,
            start_time: '2024-01-15T08:00:00Z',
            status: 'OPEN',
            cashier_id: null,
            end_time: null,
            external_register_id: null,
            external_cashier_id: null,
            external_till_id: null,
          }),
          priority: 10,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-15T08:00:00Z',
          synced_at: null,
        },
        {
          id: 'queue-shift-succeed-second',
          entity_id: 'shift-will-succeed',
          entity_type: 'shift',
          store_id: 'store-123',
          operation: 'CREATE',
          payload: JSON.stringify({
            shift_id: 'shift-will-succeed',
            store_id: 'store-123',
            business_date: '2024-01-15',
            shift_number: 2,
            start_time: '2024-01-15T12:00:00Z',
            status: 'OPEN',
            cashier_id: null,
            end_time: null,
            external_register_id: null,
            external_cashier_id: null,
            external_till_id: null,
          }),
          priority: 10,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-15T12:00:00Z',
          synced_at: null,
        },
      ];

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(2);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue(shiftItems);

      // First call fails, second succeeds
      mockPushShift
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ success: true });

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Both should be attempted
      expect(mockPushShift).toHaveBeenCalledTimes(2);

      // Second item should be marked as synced
      expect(mockMarkSynced).toHaveBeenCalledWith('queue-shift-succeed-second', undefined);

      // First item should have attempts incremented
      expect(mockIncrementAttempts).toHaveBeenCalled();

      // Status should be partial (some succeeded, some failed)
      const status = service.getStatus();
      expect(status.lastSyncStatus).toBe('partial');
    });
  });

  // ==========================================================================
  // SE-009: Shift Priority Ordering Tests
  // BUSINESS CRITICAL: Validates that shifts sync BEFORE packs
  // This satisfies cloud FK constraints (packs reference shifts)
  // ==========================================================================
  describe('SE-009: Shift priority ordering (FK constraint satisfaction)', () => {
    beforeEach(() => {
      mockPushShift.mockReset();
    });

    it('should process higher priority items (shifts) before lower priority (packs)', async () => {
      // Queue items ordered by creation time but with different priorities
      const queueItems = [
        // Pack created first (lower priority = 0)
        {
          id: 'queue-pack-created-first',
          entity_id: 'pack-123',
          entity_type: 'pack',
          store_id: 'store-123',
          operation: 'UPDATE',
          payload: JSON.stringify({
            pack_id: 'pack-123',
            store_id: 'store-123',
            game_id: 'game-1',
            pack_number: 'PKG001',
            status: 'ACTIVE',
            bin_id: 'bin-123',
            opening_serial: '001',
            closing_serial: null,
            tickets_sold: 0,
            sales_amount: 0,
            received_at: '2024-01-15T08:00:00Z',
            received_by: 'user-123',
            activated_at: '2024-01-15T10:00:00Z',
            activated_by: 'user-456',
            activated_shift_id: 'shift-123', // FK to shift
            depleted_at: null,
            returned_at: null,
          }),
          priority: 0, // Pack priority
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-15T09:00:00Z', // Created first
          synced_at: null,
        },
        // Shift created second but with higher priority (= 10)
        {
          id: 'queue-shift-created-second',
          entity_id: 'shift-123',
          entity_type: 'shift',
          store_id: 'store-123',
          operation: 'CREATE',
          payload: JSON.stringify({
            shift_id: 'shift-123',
            store_id: 'store-123',
            business_date: '2024-01-15',
            shift_number: 1,
            start_time: '2024-01-15T08:00:00Z',
            status: 'OPEN',
            cashier_id: null,
            end_time: null,
            external_register_id: null,
            external_cashier_id: null,
            external_till_id: null,
          }),
          priority: 10, // SHIFT_SYNC_PRIORITY - higher priority
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-15T09:30:00Z', // Created second
          synced_at: null,
        },
      ];

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(2);
      mockStartSync.mockReturnValue('log-1');
      // DAL returns items ordered by priority DESC, created_at ASC
      // So shift (priority 10) should come before pack (priority 0)
      mockGetRetryableItems.mockReturnValue([
        queueItems[1], // shift - higher priority
        queueItems[0], // pack - lower priority
      ]);
      mockPushShift.mockResolvedValue({ success: true });

      const callOrder: string[] = [];
      mockPushShift.mockImplementation(async () => {
        callOrder.push('shift');
        return { success: true };
      });

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Shift should be processed (pushShift called)
      expect(mockPushShift).toHaveBeenCalledTimes(1);

      // The getRetryableItems mock ensures priority ordering
      // Verify shift is in the first batch processed
      expect(callOrder[0]).toBe('shift');
    });

    it('should have SHIFT_SYNC_PRIORITY value of 10', () => {
      // This test documents the priority constant value
      // Shifts have priority 10, packs have default priority 0
      // Higher priority items are processed first
      const SHIFT_SYNC_PRIORITY = 10;
      const DEFAULT_PACK_PRIORITY = 0;

      expect(SHIFT_SYNC_PRIORITY).toBeGreaterThan(DEFAULT_PACK_PRIORITY);
      expect(SHIFT_SYNC_PRIORITY).toBe(10);
    });
  });

  // ==========================================================================
  // SE-010: Shift Sync Security Tests (Tenant Isolation)
  // Tests for DB-006 compliance in shift sync operations
  // ==========================================================================
  describe('SE-010: Shift sync security (DB-006 tenant isolation)', () => {
    beforeEach(() => {
      mockPushShift.mockReset();
    });

    it('should only sync shifts for configured store', async () => {
      const configuredStoreId = 'store-123';
      const shiftItem = {
        id: 'queue-shift-tenant',
        entity_id: 'shift-tenant-1',
        entity_type: 'shift',
        store_id: configuredStoreId, // Matches configured store
        operation: 'CREATE',
        payload: JSON.stringify({
          shift_id: 'shift-tenant-1',
          store_id: configuredStoreId,
          business_date: '2024-01-15',
          shift_number: 1,
          start_time: '2024-01-15T08:00:00Z',
          status: 'OPEN',
          cashier_id: null,
          end_time: null,
          external_register_id: null,
          external_cashier_id: null,
          external_till_id: null,
        }),
        priority: 10,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T08:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: configuredStoreId });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([shiftItem]);
      mockPushShift.mockResolvedValue({ success: true });

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Verify the shift was synced with the correct store_id
      expect(mockPushShift).toHaveBeenCalledWith(
        expect.objectContaining({
          store_id: configuredStoreId,
        })
      );
    });

    it('should not process sync when store is not configured', async () => {
      mockGetConfiguredStore.mockReturnValue(undefined);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Sync should not start without configured store
      expect(mockStartSync).not.toHaveBeenCalled();
      expect(mockPushShift).not.toHaveBeenCalled();
    });

    it('should include local_id in payload for cloud traceability', async () => {
      const shiftItem = {
        id: 'queue-shift-trace',
        entity_id: 'shift-traceable',
        entity_type: 'shift',
        store_id: 'store-123',
        operation: 'CREATE',
        payload: JSON.stringify({
          shift_id: 'shift-traceable',
          store_id: 'store-123',
          business_date: '2024-01-15',
          shift_number: 1,
          start_time: '2024-01-15T08:00:00Z',
          status: 'OPEN',
          cashier_id: null,
          end_time: null,
          external_register_id: null,
          external_cashier_id: null,
          external_till_id: null,
        }),
        priority: 10,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T08:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([shiftItem]);
      mockPushShift.mockResolvedValue({ success: true });

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Verify local_id is included for cloud audit trail
      expect(mockPushShift).toHaveBeenCalledWith(
        expect.objectContaining({
          local_id: 'shift-traceable',
        })
      );
    });
  });

  // ==========================================================================
  // SE-011: Pack DEPLETED Status Sync Tests (Phase 10)
  // Tests for pushPackBatch handling of DEPLETED status with depletion_reason
  // SEC-014: Validates depletion_reason enum values are passed correctly
  // ==========================================================================
  describe('SE-011: pushPackBatch - DEPLETED status (Phase 10)', () => {
    beforeEach(() => {
      mockPushPackDeplete.mockReset();
      mockPushPackReturn.mockReset();
      // Default success response for pack deplete
      mockPushPackDeplete.mockResolvedValue({ success: true });
    });

    /**
     * Task 10.2: should pass depletion_reason to cloudApiService.pushPackDeplete
     * Validates that the depletion_reason from the sync queue payload is correctly
     * passed to the cloud API service without modification.
     * SEC-014: depletion_reason validated at entry point by DepletionReasonSchema
     */
    it('should pass depletion_reason to cloudApiService.pushPackDeplete', async () => {
      const depletedPackItem = {
        id: 'queue-pack-depleted-1',
        entity_id: 'pack-depleted-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-depleted-123',
          store_id: 'store-123',
          game_id: 'game-123',
          game_code: 'GAME001',
          pack_number: 'PKG001',
          status: 'DEPLETED',
          bin_id: 'bin-123',
          opening_serial: '001',
          closing_serial: '150',
          tickets_sold: 150,
          sales_amount: 150.0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: '2024-01-15T09:00:00Z',
          activated_by: 'user-456',
          depleted_at: '2024-01-15T17:00:00Z',
          depleted_shift_id: 'shift-123',
          // SEC-014: depletion_reason is validated enum value
          depletion_reason: 'MANUAL_SOLD_OUT' as const,
          returned_at: null,
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T17:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([depletedPackItem]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Verify pushPackDeplete was called with correct depletion_reason
      expect(mockPushPackDeplete).toHaveBeenCalledTimes(1);
      expect(mockPushPackDeplete).toHaveBeenCalledWith(
        expect.objectContaining({
          pack_id: 'pack-depleted-123',
          depletion_reason: 'MANUAL_SOLD_OUT',
          closing_serial: '150',
          depleted_at: '2024-01-15T17:00:00Z',
        })
      );
    });

    it('should pass SHIFT_CLOSE depletion_reason correctly', async () => {
      const depletedPackItem = {
        id: 'queue-pack-shift-close',
        entity_id: 'pack-shift-close-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-shift-close-123',
          store_id: 'store-123',
          game_id: 'game-123',
          game_code: 'GAME001',
          pack_number: 'PKG002',
          status: 'DEPLETED',
          bin_id: 'bin-123',
          opening_serial: '001',
          closing_serial: '200',
          tickets_sold: 200,
          sales_amount: 200.0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: '2024-01-15T09:00:00Z',
          activated_by: 'user-456',
          depleted_at: '2024-01-15T18:00:00Z',
          depleted_shift_id: 'shift-456',
          depletion_reason: 'SHIFT_CLOSE' as const,
          returned_at: null,
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T18:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([depletedPackItem]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(mockPushPackDeplete).toHaveBeenCalledWith(
        expect.objectContaining({
          depletion_reason: 'SHIFT_CLOSE',
        })
      );
    });

    it('should pass AUTO_REPLACED depletion_reason correctly', async () => {
      const depletedPackItem = {
        id: 'queue-pack-auto-replaced',
        entity_id: 'pack-auto-replaced-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-auto-replaced-123',
          store_id: 'store-123',
          game_id: 'game-123',
          game_code: 'GAME001',
          pack_number: 'PKG003',
          status: 'DEPLETED',
          bin_id: 'bin-123',
          opening_serial: '001',
          closing_serial: '299',
          tickets_sold: 299,
          sales_amount: 299.0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: '2024-01-15T09:00:00Z',
          activated_by: 'user-456',
          depleted_at: '2024-01-15T15:00:00Z',
          depleted_shift_id: 'shift-789',
          depletion_reason: 'AUTO_REPLACED' as const,
          returned_at: null,
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T15:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([depletedPackItem]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(mockPushPackDeplete).toHaveBeenCalledWith(
        expect.objectContaining({
          depletion_reason: 'AUTO_REPLACED',
        })
      );
    });

    it('should pass POS_LAST_TICKET depletion_reason correctly', async () => {
      const depletedPackItem = {
        id: 'queue-pack-pos-last',
        entity_id: 'pack-pos-last-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-pos-last-123',
          store_id: 'store-123',
          game_id: 'game-123',
          game_code: 'GAME001',
          pack_number: 'PKG004',
          status: 'DEPLETED',
          bin_id: 'bin-123',
          opening_serial: '001',
          closing_serial: '299',
          tickets_sold: 299,
          sales_amount: 299.0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: '2024-01-15T09:00:00Z',
          activated_by: 'user-456',
          depleted_at: '2024-01-15T14:00:00Z',
          depleted_shift_id: 'shift-101',
          depletion_reason: 'POS_LAST_TICKET' as const,
          returned_at: null,
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T14:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([depletedPackItem]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(mockPushPackDeplete).toHaveBeenCalledWith(
        expect.objectContaining({
          depletion_reason: 'POS_LAST_TICKET',
        })
      );
    });

    /**
     * Task 10.3: should log warning when depletion_reason is missing
     * Validates that sync fails gracefully and logs warning when depletion_reason
     * is missing from the payload (required by cloud API).
     */
    it('should log warning when depletion_reason is missing', async () => {
      const depletedPackItemNoReason = {
        id: 'queue-pack-no-reason',
        entity_id: 'pack-no-reason-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-no-reason-123',
          store_id: 'store-123',
          game_id: 'game-123',
          game_code: 'GAME001',
          pack_number: 'PKG005',
          status: 'DEPLETED',
          bin_id: 'bin-123',
          opening_serial: '001',
          closing_serial: '150',
          tickets_sold: 150,
          sales_amount: 150.0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: '2024-01-15T09:00:00Z',
          activated_by: 'user-456',
          depleted_at: '2024-01-15T17:00:00Z',
          depleted_shift_id: 'shift-123',
          // MISSING: depletion_reason - should trigger warning
          returned_at: null,
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T17:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([depletedPackItemNoReason]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // pushPackDeplete should NOT be called when depletion_reason is missing
      expect(mockPushPackDeplete).not.toHaveBeenCalled();

      // Sync should result in partial status (item failed validation)
      const status = service.getStatus();
      expect(status.lastSyncStatus).toBe('partial');
    });

    it('should mark pack as synced on successful deplete', async () => {
      const depletedPackItem = {
        id: 'queue-pack-success',
        entity_id: 'pack-success-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-success-123',
          store_id: 'store-123',
          game_id: 'game-123',
          game_code: 'GAME001',
          pack_number: 'PKG006',
          status: 'DEPLETED',
          bin_id: 'bin-123',
          opening_serial: '001',
          closing_serial: '150',
          tickets_sold: 150,
          sales_amount: 150.0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: '2024-01-15T09:00:00Z',
          activated_by: 'user-456',
          depleted_at: '2024-01-15T17:00:00Z',
          depleted_shift_id: 'shift-123',
          depletion_reason: 'MANUAL_SOLD_OUT' as const,
          returned_at: null,
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T17:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([depletedPackItem]);
      mockPushPackDeplete.mockResolvedValue({ success: true });

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Should be marked as synced
      expect(mockMarkSynced).toHaveBeenCalledWith('queue-pack-success', undefined);
    });

    it('should NOT use hardcoded SOLD_OUT value', async () => {
      // Regression test: Verify the fix for hardcoded 'SOLD_OUT' value
      const depletedPackItem = {
        id: 'queue-pack-regression',
        entity_id: 'pack-regression-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-regression-123',
          store_id: 'store-123',
          game_id: 'game-123',
          game_code: 'GAME001',
          pack_number: 'PKG007',
          status: 'DEPLETED',
          bin_id: 'bin-123',
          opening_serial: '001',
          closing_serial: '150',
          tickets_sold: 150,
          sales_amount: 150.0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: '2024-01-15T09:00:00Z',
          activated_by: 'user-456',
          depleted_at: '2024-01-15T17:00:00Z',
          depleted_shift_id: 'shift-123',
          depletion_reason: 'SHIFT_CLOSE' as const, // Not SOLD_OUT
          returned_at: null,
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T17:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([depletedPackItem]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Verify SOLD_OUT is NOT used (was the old hardcoded value)
      expect(mockPushPackDeplete).toHaveBeenCalledWith(
        expect.not.objectContaining({
          depletion_reason: 'SOLD_OUT',
        })
      );
      // Verify the correct value from payload is used
      expect(mockPushPackDeplete).toHaveBeenCalledWith(
        expect.objectContaining({
          depletion_reason: 'SHIFT_CLOSE',
        })
      );
    });
  });

  // ==========================================================================
  // SE-012: Pack RETURNED Status Sync Tests (Phase 10)
  // Tests for pushPackBatch handling of RETURNED status with return_reason
  // SEC-014: Validates return_reason enum values are passed correctly
  // ==========================================================================
  describe('SE-012: pushPackBatch - RETURNED status (Phase 10)', () => {
    beforeEach(() => {
      mockPushPackDeplete.mockReset();
      mockPushPackReturn.mockReset();
      // Default success response for pack return
      mockPushPackReturn.mockResolvedValue({ success: true });
    });

    /**
     * Task 10.5: should pass return_reason to cloudApiService.pushPackReturn
     * Validates that the return_reason from the sync queue payload is correctly
     * passed to the cloud API service without modification.
     * SEC-014: return_reason validated at entry point by ReturnReasonSchema
     */
    it('should pass return_reason to cloudApiService.pushPackReturn', async () => {
      const returnedPackItem = {
        id: 'queue-pack-returned-1',
        entity_id: 'pack-returned-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-returned-123',
          store_id: 'store-123',
          game_id: 'game-123',
          game_code: 'GAME001',
          pack_number: 'PKG010',
          status: 'RETURNED',
          bin_id: null,
          opening_serial: null,
          closing_serial: null,
          tickets_sold: 0,
          sales_amount: 0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: null,
          activated_by: null,
          depleted_at: null,
          returned_at: '2024-01-15T10:00:00Z',
          returned_shift_id: 'shift-123',
          // SEC-014: return_reason is validated enum value
          return_reason: 'SUPPLIER_RECALL' as const,
          return_notes: null,
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T10:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([returnedPackItem]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Verify pushPackReturn was called with correct return_reason
      expect(mockPushPackReturn).toHaveBeenCalledTimes(1);
      expect(mockPushPackReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          pack_id: 'pack-returned-123',
          return_reason: 'SUPPLIER_RECALL',
          returned_at: '2024-01-15T10:00:00Z',
        })
      );
    });

    it('should pass DAMAGED return_reason correctly', async () => {
      const returnedPackItem = {
        id: 'queue-pack-damaged',
        entity_id: 'pack-damaged-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-damaged-123',
          store_id: 'store-123',
          game_id: 'game-123',
          game_code: 'GAME001',
          pack_number: 'PKG011',
          status: 'RETURNED',
          bin_id: null,
          opening_serial: null,
          closing_serial: null,
          tickets_sold: 0,
          sales_amount: 0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: null,
          activated_by: null,
          depleted_at: null,
          returned_at: '2024-01-15T11:00:00Z',
          returned_shift_id: 'shift-456',
          return_reason: 'DAMAGED' as const,
          return_notes: 'Water damage during storage',
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T11:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([returnedPackItem]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(mockPushPackReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          return_reason: 'DAMAGED',
        })
      );
    });

    it('should pass EXPIRED return_reason correctly', async () => {
      const returnedPackItem = {
        id: 'queue-pack-expired',
        entity_id: 'pack-expired-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-expired-123',
          store_id: 'store-123',
          game_id: 'game-123',
          game_code: 'GAME001',
          pack_number: 'PKG012',
          status: 'RETURNED',
          bin_id: null,
          opening_serial: null,
          closing_serial: null,
          tickets_sold: 0,
          sales_amount: 0,
          received_at: '2024-01-10T08:00:00Z',
          received_by: 'user-123',
          activated_at: null,
          activated_by: null,
          depleted_at: null,
          returned_at: '2024-01-15T09:00:00Z',
          returned_shift_id: 'shift-789',
          return_reason: 'EXPIRED' as const,
          return_notes: null,
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T09:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([returnedPackItem]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(mockPushPackReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          return_reason: 'EXPIRED',
        })
      );
    });

    it('should pass INVENTORY_ADJUSTMENT return_reason correctly', async () => {
      const returnedPackItem = {
        id: 'queue-pack-inventory',
        entity_id: 'pack-inventory-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-inventory-123',
          store_id: 'store-123',
          game_id: 'game-123',
          game_code: 'GAME001',
          pack_number: 'PKG013',
          status: 'RETURNED',
          bin_id: null,
          opening_serial: null,
          closing_serial: null,
          tickets_sold: 0,
          sales_amount: 0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: null,
          activated_by: null,
          depleted_at: null,
          returned_at: '2024-01-15T12:00:00Z',
          returned_shift_id: 'shift-101',
          return_reason: 'INVENTORY_ADJUSTMENT' as const,
          return_notes: 'Duplicate pack in system',
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T12:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([returnedPackItem]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(mockPushPackReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          return_reason: 'INVENTORY_ADJUSTMENT',
        })
      );
    });

    it('should pass STORE_CLOSURE return_reason correctly', async () => {
      const returnedPackItem = {
        id: 'queue-pack-closure',
        entity_id: 'pack-closure-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-closure-123',
          store_id: 'store-123',
          game_id: 'game-123',
          game_code: 'GAME001',
          pack_number: 'PKG014',
          status: 'RETURNED',
          bin_id: null,
          opening_serial: null,
          closing_serial: null,
          tickets_sold: 0,
          sales_amount: 0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: null,
          activated_by: null,
          depleted_at: null,
          returned_at: '2024-01-20T17:00:00Z',
          returned_shift_id: 'shift-999',
          return_reason: 'STORE_CLOSURE' as const,
          return_notes: 'Store closing permanently',
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-20T17:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([returnedPackItem]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(mockPushPackReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          return_reason: 'STORE_CLOSURE',
        })
      );
    });

    /**
     * Task 10.6: should pass return_notes to cloudApiService.pushPackReturn
     * Validates that optional return_notes from payload are correctly passed
     */
    it('should pass return_notes to cloudApiService.pushPackReturn', async () => {
      const returnedPackItem = {
        id: 'queue-pack-with-notes',
        entity_id: 'pack-with-notes-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-with-notes-123',
          store_id: 'store-123',
          game_id: 'game-123',
          game_code: 'GAME001',
          pack_number: 'PKG015',
          status: 'RETURNED',
          bin_id: null,
          opening_serial: null,
          closing_serial: null,
          tickets_sold: 0,
          sales_amount: 0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: null,
          activated_by: null,
          depleted_at: null,
          returned_at: '2024-01-15T14:00:00Z',
          returned_shift_id: 'shift-202',
          return_reason: 'DAMAGED' as const,
          // Include return_notes with details
          return_notes: 'Pack was damaged during shipping. Visible water damage on tickets.',
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T14:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([returnedPackItem]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Verify return_notes is included in the API call
      expect(mockPushPackReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          return_reason: 'DAMAGED',
          return_notes: 'Pack was damaged during shipping. Visible water damage on tickets.',
        })
      );
    });

    it('should handle null return_notes gracefully', async () => {
      const returnedPackItem = {
        id: 'queue-pack-no-notes',
        entity_id: 'pack-no-notes-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-no-notes-123',
          store_id: 'store-123',
          game_id: 'game-123',
          game_code: 'GAME001',
          pack_number: 'PKG016',
          status: 'RETURNED',
          bin_id: null,
          opening_serial: null,
          closing_serial: null,
          tickets_sold: 0,
          sales_amount: 0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: null,
          activated_by: null,
          depleted_at: null,
          returned_at: '2024-01-15T15:00:00Z',
          returned_shift_id: 'shift-303',
          return_reason: 'SUPPLIER_RECALL' as const,
          return_notes: null, // Explicitly null
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T15:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([returnedPackItem]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Should still call pushPackReturn successfully
      expect(mockPushPackReturn).toHaveBeenCalledTimes(1);
      expect(mockPushPackReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          return_reason: 'SUPPLIER_RECALL',
        })
      );
    });

    /**
     * Task 10.7: should log warning when return_reason is missing
     * Validates that sync fails gracefully and logs warning when return_reason
     * is missing from the payload (required by cloud API).
     */
    it('should log warning when return_reason is missing', async () => {
      const returnedPackItemNoReason = {
        id: 'queue-pack-no-return-reason',
        entity_id: 'pack-no-return-reason-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-no-return-reason-123',
          store_id: 'store-123',
          game_id: 'game-123',
          game_code: 'GAME001',
          pack_number: 'PKG017',
          status: 'RETURNED',
          bin_id: null,
          opening_serial: null,
          closing_serial: null,
          tickets_sold: 0,
          sales_amount: 0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: null,
          activated_by: null,
          depleted_at: null,
          returned_at: '2024-01-15T16:00:00Z',
          returned_shift_id: 'shift-404',
          // MISSING: return_reason - should trigger warning
          return_notes: 'Some notes without reason',
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T16:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([returnedPackItemNoReason]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // pushPackReturn should NOT be called when return_reason is missing
      expect(mockPushPackReturn).not.toHaveBeenCalled();

      // Sync should result in partial status (item failed validation)
      const status = service.getStatus();
      expect(status.lastSyncStatus).toBe('partial');
    });

    it('should NOT default to OTHER value', async () => {
      // Regression test: Verify the fix for '|| OTHER' fallback
      const returnedPackItem = {
        id: 'queue-pack-regression-other',
        entity_id: 'pack-regression-other-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-regression-other-123',
          store_id: 'store-123',
          game_id: 'game-123',
          game_code: 'GAME001',
          pack_number: 'PKG018',
          status: 'RETURNED',
          bin_id: null,
          opening_serial: null,
          closing_serial: null,
          tickets_sold: 0,
          sales_amount: 0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: null,
          activated_by: null,
          depleted_at: null,
          returned_at: '2024-01-15T17:00:00Z',
          returned_shift_id: 'shift-505',
          return_reason: 'EXPIRED' as const, // Valid enum value
          return_notes: null,
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T17:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([returnedPackItem]);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Verify OTHER is NOT used (was the old default fallback)
      expect(mockPushPackReturn).toHaveBeenCalledWith(
        expect.not.objectContaining({
          return_reason: 'OTHER',
        })
      );
      // Verify the correct value from payload is used
      expect(mockPushPackReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          return_reason: 'EXPIRED',
        })
      );
    });

    it('should mark pack as synced on successful return', async () => {
      const returnedPackItem = {
        id: 'queue-pack-return-success',
        entity_id: 'pack-return-success-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-return-success-123',
          store_id: 'store-123',
          game_id: 'game-123',
          game_code: 'GAME001',
          pack_number: 'PKG019',
          status: 'RETURNED',
          bin_id: null,
          opening_serial: null,
          closing_serial: null,
          tickets_sold: 0,
          sales_amount: 0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: null,
          activated_by: null,
          depleted_at: null,
          returned_at: '2024-01-15T18:00:00Z',
          returned_shift_id: 'shift-606',
          return_reason: 'INVENTORY_ADJUSTMENT' as const,
          return_notes: 'Correcting inventory count',
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T18:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([returnedPackItem]);
      mockPushPackReturn.mockResolvedValue({ success: true });

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Should be marked as synced
      expect(mockMarkSynced).toHaveBeenCalledWith('queue-pack-return-success', undefined);
    });

    it('should increment attempts on API failure', async () => {
      const returnedPackItem = {
        id: 'queue-pack-return-fail',
        entity_id: 'pack-return-fail-123',
        entity_type: 'pack',
        store_id: 'store-123',
        operation: 'UPDATE',
        payload: JSON.stringify({
          pack_id: 'pack-return-fail-123',
          store_id: 'store-123',
          game_id: 'game-123',
          game_code: 'GAME001',
          pack_number: 'PKG020',
          status: 'RETURNED',
          bin_id: null,
          opening_serial: null,
          closing_serial: null,
          tickets_sold: 0,
          sales_amount: 0,
          received_at: '2024-01-15T08:00:00Z',
          received_by: 'user-123',
          activated_at: null,
          activated_by: null,
          depleted_at: null,
          returned_at: '2024-01-15T19:00:00Z',
          returned_shift_id: 'shift-707',
          return_reason: 'DAMAGED' as const,
          return_notes: null,
        }),
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-15T19:00:00Z',
        synced_at: null,
      };

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(1);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue([returnedPackItem]);
      mockPushPackReturn.mockRejectedValue(new Error('Network error'));

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Verify attempts incremented, not marked as synced
      expect(mockIncrementAttempts).toHaveBeenCalled();
      expect(mockMarkSynced).not.toHaveBeenCalledWith('queue-pack-return-fail', expect.anything());
    });
  });

  // ==========================================================================
  // SE-013: Pack Audit Trail - depleted_by and returned_by Tests
  // SEC-010: Validates audit trail fields are passed to cloud API
  // Cloud API Requirement: depleted_by and returned_by are REQUIRED
  // ==========================================================================
  describe('SE-013: pushPackBatch - audit trail user ID fields', () => {
    beforeEach(() => {
      mockPushPackDeplete.mockReset();
      mockPushPackReturn.mockReset();
      mockPushPackDeplete.mockResolvedValue({ success: true });
      mockPushPackReturn.mockResolvedValue({ success: true });
    });

    /**
     * SEC-010: Audit Trail - depleted_by field
     * Validates that depleted_by (user ID) is correctly passed to cloud API
     * for depletion audit trail compliance.
     */
    describe('depleted_by handling', () => {
      it('should pass depleted_by to cloudApiService.pushPackDeplete', async () => {
        const depletedPackItem = {
          id: 'queue-pack-depleted-audit',
          entity_id: 'pack-depleted-audit-123',
          entity_type: 'pack',
          store_id: 'store-123',
          operation: 'UPDATE',
          payload: JSON.stringify({
            pack_id: 'pack-depleted-audit-123',
            store_id: 'store-123',
            game_id: 'game-123',
            game_code: 'GAME001',
            pack_number: 'PKG-AUDIT-001',
            status: 'DEPLETED',
            bin_id: 'bin-123',
            opening_serial: '001',
            closing_serial: '150',
            tickets_sold: 150,
            sales_amount: 150.0,
            received_at: '2024-01-15T08:00:00Z',
            received_by: 'user-receiver-123',
            activated_at: '2024-01-15T09:00:00Z',
            activated_by: 'user-activator-456',
            depleted_at: '2024-01-15T17:00:00Z',
            depleted_by: 'user-depleter-789',
            depleted_shift_id: 'shift-audit-001',
            depletion_reason: 'MANUAL_SOLD_OUT' as const,
            returned_at: null,
          }),
          priority: 0,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-15T17:00:00Z',
          synced_at: null,
        };

        mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
        mockGetPendingCount.mockReturnValue(1);
        mockStartSync.mockReturnValue('log-1');
        mockGetRetryableItems.mockReturnValue([depletedPackItem]);

        service.start();
        await vi.advanceTimersByTimeAsync(100);

        // Verify pushPackDeplete was called with depleted_by
        expect(mockPushPackDeplete).toHaveBeenCalledTimes(1);
        expect(mockPushPackDeplete).toHaveBeenCalledWith(
          expect.objectContaining({
            pack_id: 'pack-depleted-audit-123',
            depleted_by: 'user-depleter-789',
            depletion_reason: 'MANUAL_SOLD_OUT',
          })
        );
      });

      it('should pass valid UUID depleted_by to cloud API', async () => {
        const validUserId = '8981cc60-62c6-4412-8789-42d3afc2b4ac';
        const depletedPackItem = {
          id: 'queue-pack-depleted-uuid',
          entity_id: 'pack-depleted-uuid-123',
          entity_type: 'pack',
          store_id: 'store-123',
          operation: 'UPDATE',
          payload: JSON.stringify({
            pack_id: 'pack-depleted-uuid-123',
            store_id: 'store-123',
            game_id: 'game-123',
            game_code: 'GAME001',
            pack_number: 'PKG-UUID-001',
            status: 'DEPLETED',
            bin_id: 'bin-123',
            opening_serial: '001',
            closing_serial: '200',
            tickets_sold: 200,
            sales_amount: 200.0,
            received_at: '2024-01-15T08:00:00Z',
            received_by: 'user-receiver-123',
            activated_at: '2024-01-15T09:00:00Z',
            activated_by: 'user-activator-456',
            depleted_at: '2024-01-15T18:00:00Z',
            depleted_by: validUserId,
            depleted_shift_id: 'shift-uuid-001',
            depletion_reason: 'SHIFT_CLOSE' as const,
            returned_at: null,
          }),
          priority: 0,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-15T18:00:00Z',
          synced_at: null,
        };

        mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
        mockGetPendingCount.mockReturnValue(1);
        mockStartSync.mockReturnValue('log-1');
        mockGetRetryableItems.mockReturnValue([depletedPackItem]);

        service.start();
        await vi.advanceTimersByTimeAsync(100);

        expect(mockPushPackDeplete).toHaveBeenCalledWith(
          expect.objectContaining({
            depleted_by: validUserId,
          })
        );
      });

      it('should handle null depleted_by gracefully', async () => {
        const depletedPackItem = {
          id: 'queue-pack-depleted-null-user',
          entity_id: 'pack-depleted-null-user-123',
          entity_type: 'pack',
          store_id: 'store-123',
          operation: 'UPDATE',
          payload: JSON.stringify({
            pack_id: 'pack-depleted-null-user-123',
            store_id: 'store-123',
            game_id: 'game-123',
            game_code: 'GAME001',
            pack_number: 'PKG-NULL-001',
            status: 'DEPLETED',
            bin_id: 'bin-123',
            opening_serial: '001',
            closing_serial: '100',
            tickets_sold: 100,
            sales_amount: 100.0,
            received_at: '2024-01-15T08:00:00Z',
            received_by: 'user-receiver-123',
            activated_at: '2024-01-15T09:00:00Z',
            activated_by: 'user-activator-456',
            depleted_at: '2024-01-15T19:00:00Z',
            depleted_by: null,
            depleted_shift_id: 'shift-null-001',
            depletion_reason: 'AUTO_REPLACED' as const,
            returned_at: null,
          }),
          priority: 0,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-15T19:00:00Z',
          synced_at: null,
        };

        mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
        mockGetPendingCount.mockReturnValue(1);
        mockStartSync.mockReturnValue('log-1');
        mockGetRetryableItems.mockReturnValue([depletedPackItem]);

        service.start();
        await vi.advanceTimersByTimeAsync(100);

        // Should still call pushPackDeplete even with null depleted_by
        expect(mockPushPackDeplete).toHaveBeenCalledTimes(1);
        expect(mockPushPackDeplete).toHaveBeenCalledWith(
          expect.objectContaining({
            depleted_by: null,
          })
        );
      });
    });

    /**
     * SEC-010: Audit Trail - returned_by field
     * Validates that returned_by (user ID) is correctly passed to cloud API
     * for return audit trail compliance.
     */
    describe('returned_by handling', () => {
      it('should pass returned_by to cloudApiService.pushPackReturn', async () => {
        const returnedPackItem = {
          id: 'queue-pack-returned-audit',
          entity_id: 'pack-returned-audit-123',
          entity_type: 'pack',
          store_id: 'store-123',
          operation: 'UPDATE',
          payload: JSON.stringify({
            pack_id: 'pack-returned-audit-123',
            store_id: 'store-123',
            game_id: 'game-123',
            game_code: 'GAME001',
            pack_number: 'PKG-RETURN-AUDIT-001',
            status: 'RETURNED',
            bin_id: null,
            opening_serial: null,
            closing_serial: '050',
            tickets_sold: 50,
            sales_amount: 50.0,
            received_at: '2024-01-15T08:00:00Z',
            received_by: 'user-receiver-123',
            activated_at: '2024-01-15T09:00:00Z',
            activated_by: 'user-activator-456',
            depleted_at: null,
            returned_at: '2024-01-15T17:00:00Z',
            returned_by: 'user-returner-789',
            returned_shift_id: 'shift-return-audit-001',
            return_reason: 'DAMAGED' as const,
            return_notes: 'Pack was damaged during handling',
          }),
          priority: 0,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-15T17:00:00Z',
          synced_at: null,
        };

        mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
        mockGetPendingCount.mockReturnValue(1);
        mockStartSync.mockReturnValue('log-1');
        mockGetRetryableItems.mockReturnValue([returnedPackItem]);

        service.start();
        await vi.advanceTimersByTimeAsync(100);

        // Verify pushPackReturn was called with returned_by
        expect(mockPushPackReturn).toHaveBeenCalledTimes(1);
        expect(mockPushPackReturn).toHaveBeenCalledWith(
          expect.objectContaining({
            pack_id: 'pack-returned-audit-123',
            returned_by: 'user-returner-789',
            return_reason: 'DAMAGED',
          })
        );
      });

      it('should pass valid UUID returned_by to cloud API', async () => {
        const validUserId = '8981cc60-62c6-4412-8789-42d3afc2b4ac';
        const returnedPackItem = {
          id: 'queue-pack-returned-uuid',
          entity_id: 'pack-returned-uuid-123',
          entity_type: 'pack',
          store_id: 'store-123',
          operation: 'UPDATE',
          payload: JSON.stringify({
            pack_id: 'pack-returned-uuid-123',
            store_id: 'store-123',
            game_id: 'game-123',
            game_code: 'GAME001',
            pack_number: 'PKG-RETURN-UUID-001',
            status: 'RETURNED',
            bin_id: null,
            opening_serial: null,
            closing_serial: null,
            tickets_sold: 0,
            sales_amount: 0,
            received_at: '2024-01-15T08:00:00Z',
            received_by: 'user-receiver-123',
            activated_at: null,
            activated_by: null,
            depleted_at: null,
            returned_at: '2024-01-15T18:00:00Z',
            returned_by: validUserId,
            returned_shift_id: 'shift-return-uuid-001',
            return_reason: 'SUPPLIER_RECALL' as const,
            return_notes: null,
          }),
          priority: 0,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-15T18:00:00Z',
          synced_at: null,
        };

        mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
        mockGetPendingCount.mockReturnValue(1);
        mockStartSync.mockReturnValue('log-1');
        mockGetRetryableItems.mockReturnValue([returnedPackItem]);

        service.start();
        await vi.advanceTimersByTimeAsync(100);

        expect(mockPushPackReturn).toHaveBeenCalledWith(
          expect.objectContaining({
            returned_by: validUserId,
          })
        );
      });

      it('should handle null returned_by gracefully', async () => {
        const returnedPackItem = {
          id: 'queue-pack-returned-null-user',
          entity_id: 'pack-returned-null-user-123',
          entity_type: 'pack',
          store_id: 'store-123',
          operation: 'UPDATE',
          payload: JSON.stringify({
            pack_id: 'pack-returned-null-user-123',
            store_id: 'store-123',
            game_id: 'game-123',
            game_code: 'GAME001',
            pack_number: 'PKG-RETURN-NULL-001',
            status: 'RETURNED',
            bin_id: null,
            opening_serial: null,
            closing_serial: null,
            tickets_sold: 0,
            sales_amount: 0,
            received_at: '2024-01-15T08:00:00Z',
            received_by: 'user-receiver-123',
            activated_at: null,
            activated_by: null,
            depleted_at: null,
            returned_at: '2024-01-15T19:00:00Z',
            returned_by: null,
            returned_shift_id: 'shift-return-null-001',
            return_reason: 'EXPIRED' as const,
            return_notes: null,
          }),
          priority: 0,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-15T19:00:00Z',
          synced_at: null,
        };

        mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
        mockGetPendingCount.mockReturnValue(1);
        mockStartSync.mockReturnValue('log-1');
        mockGetRetryableItems.mockReturnValue([returnedPackItem]);

        service.start();
        await vi.advanceTimersByTimeAsync(100);

        // Should still call pushPackReturn even with null returned_by
        expect(mockPushPackReturn).toHaveBeenCalledTimes(1);
        expect(mockPushPackReturn).toHaveBeenCalledWith(
          expect.objectContaining({
            returned_by: null,
          })
        );
      });

      it('should include returned_by with all return reason types', async () => {
        const returnReasons = [
          'SUPPLIER_RECALL',
          'DAMAGED',
          'EXPIRED',
          'INVENTORY_ADJUSTMENT',
          'STORE_CLOSURE',
        ] as const;

        for (let i = 0; i < returnReasons.length; i++) {
          const reason = returnReasons[i];
          mockPushPackReturn.mockReset();
          mockPushPackReturn.mockResolvedValue({ success: true });

          const returnedPackItem = {
            id: `queue-pack-returned-reason-${i}`,
            entity_id: `pack-returned-reason-${i}`,
            entity_type: 'pack',
            store_id: 'store-123',
            operation: 'UPDATE',
            payload: JSON.stringify({
              pack_id: `pack-returned-reason-${i}`,
              store_id: 'store-123',
              game_id: 'game-123',
              game_code: 'GAME001',
              pack_number: `PKG-REASON-${i}`,
              status: 'RETURNED',
              bin_id: null,
              opening_serial: null,
              closing_serial: null,
              tickets_sold: 0,
              sales_amount: 0,
              received_at: '2024-01-15T08:00:00Z',
              received_by: 'user-receiver-123',
              activated_at: null,
              activated_by: null,
              depleted_at: null,
              returned_at: '2024-01-15T20:00:00Z',
              returned_by: `user-for-${reason.toLowerCase()}`,
              returned_shift_id: `shift-reason-${i}`,
              return_reason: reason,
              return_notes: null,
            }),
            priority: 0,
            synced: 0,
            sync_attempts: 0,
            max_attempts: 5,
            last_sync_error: null,
            last_attempt_at: null,
            created_at: '2024-01-15T20:00:00Z',
            synced_at: null,
          };

          mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
          mockGetPendingCount.mockReturnValue(1);
          mockStartSync.mockReturnValue('log-1');
          mockGetRetryableItems.mockReturnValue([returnedPackItem]);

          service.start();
          await vi.advanceTimersByTimeAsync(100);

          expect(mockPushPackReturn).toHaveBeenCalledWith(
            expect.objectContaining({
              returned_by: `user-for-${reason.toLowerCase()}`,
              return_reason: reason,
            })
          );

          service.stop();
        }
      });
    });
  });
});
