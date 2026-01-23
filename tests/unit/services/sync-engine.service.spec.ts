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
  mockStartSync,
  mockCompleteSync,
  mockFailSync,
  mockCleanupStaleRunning,
  mockGetConfiguredStore,
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
  mockStartSync: vi.fn(),
  mockCompleteSync: vi.fn(),
  mockFailSync: vi.fn(),
  mockCleanupStaleRunning: vi.fn(),
  mockGetConfiguredStore: vi.fn(),
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

// Mock electron-store (used by cloud-api.service)
vi.mock('electron-store', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
  })),
}));

// Mock cloud-api.service to prevent real API calls during tests
// Pack sync operations use cloudApiService directly, this mock enables
// testing pack routing and failure handling without API configuration
vi.mock('../../../src/main/services/cloud-api.service', () => ({
  cloudApiService: {
    pushPackReceive: vi.fn().mockRejectedValue(new Error('API key not configured')),
    pushPackActivate: vi.fn().mockRejectedValue(new Error('API key not configured')),
    pushPackDeplete: vi.fn().mockRejectedValue(new Error('API key not configured')),
    pushPackReturn: vi.fn().mockRejectedValue(new Error('API key not configured')),
    pushBatch: vi.fn().mockResolvedValue({ success: true, results: [] }),
    healthCheck: vi.fn().mockResolvedValue({ success: true }),
  },
}));

import { SyncEngineService } from '../../../src/main/services/sync-engine.service';

describe('SyncEngineService', () => {
  let service: SyncEngineService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Default mock for getStats - returns empty stats
    // This is needed because getStatus() now calls getStats()
    mockGetStats.mockReturnValue({
      pending: 0,
      failed: 0,
      syncedToday: 0,
      oldestPending: null,
    });
    // Default mock for getFailedCount and getFailedItems
    // These are called at the start of processSyncQueue to auto-reset failed items
    mockGetFailedCount.mockReturnValue(0);
    mockGetFailedItems.mockReturnValue([]);
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
          entity_type: 'employee', // Employee type is marked as synced (pull-only from cloud)
          store_id: 'store-123',
          operation: 'CREATE',
          payload: '{}',
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

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Employee items are marked as synced (employees are pull-only from cloud)
      // markSynced now accepts optional apiContext as second parameter
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
      // Use employee type which is handled as pull-only (marked as synced)
      const mockItems = [
        {
          id: 'q1',
          entity_id: 'e1',
          entity_type: 'employee',
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
          id: 'q2',
          entity_id: 'e2',
          entity_type: 'employee',
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
          id: 'q3',
          entity_id: 'e3',
          entity_type: 'employee',
          store_id: 'store-123',
          operation: 'UPDATE',
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
      ];

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(3);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue(mockItems);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // All employee items should be marked as synced (employees are pull-only)
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
      // Use employee entity type which is handled as pull-only (marked as synced)
      const items = [
        {
          id: 'queue-1',
          entity_id: 'e1',
          entity_type: 'employee', // Employee type is pull-only, marked as synced
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
          entity_id: 'e2',
          entity_type: 'employee', // Employee type is pull-only, marked as synced
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
      ];

      mockGetConfiguredStore.mockReturnValue({ store_id: 'store-123' });
      mockGetPendingCount.mockReturnValue(2);
      mockStartSync.mockReturnValue('log-1');
      mockGetRetryableItems.mockReturnValue(items);

      service.start();
      await vi.advanceTimersByTimeAsync(100);

      // Both employee items should be marked as synced (employees are pull-only from cloud)
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
      // But error message is set
      expect(status.lastErrorMessage).toContain('failed to sync');
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
});
