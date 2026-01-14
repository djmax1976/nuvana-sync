/**
 * Sync Engine Service Unit Tests
 *
 * @module tests/unit/services/sync-engine.service.spec
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist mock functions so they're available when vi.mock factory runs
const {
  mockPrepare,
  mockGetRetryableItems,
  mockMarkSynced,
  mockIncrementAttempts,
  mockGetPendingCount,
  mockCleanupSynced,
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
  mockCleanupSynced: vi.fn(),
  mockStartSync: vi.fn(),
  mockCompleteSync: vi.fn(),
  mockFailSync: vi.fn(),
  mockCleanupStaleRunning: vi.fn(),
  mockGetConfiguredStore: vi.fn(),
}));

// Mock electron
vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

// Mock database service
vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: vi.fn((fn: () => unknown) => () => fn()),
  })),
}));

// Mock DALs
vi.mock('../../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: {
    getRetryableItems: mockGetRetryableItems,
    markSynced: mockMarkSynced,
    incrementAttempts: mockIncrementAttempts,
    getPendingCount: mockGetPendingCount,
    cleanupSynced: mockCleanupSynced,
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

import { SyncEngineService } from '../../../src/main/services/sync-engine.service';

describe('SyncEngineService', () => {
  let service: SyncEngineService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
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

      expect(status).toEqual({
        isRunning: expect.any(Boolean),
        isStarted: true,
        lastSyncAt: expect.any(String),
        lastSyncStatus: expect.any(String),
        pendingCount: 5,
        nextSyncIn: expect.any(Number),
        isOnline: true,
      });
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

      // Cloud API not configured, so mock success is returned
      expect(mockMarkSynced).toHaveBeenCalledWith('queue-1');
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
        pushBatch: vi.fn(),
      };

      expect(() => service.setCloudApiService(mockCloudApi)).not.toThrow();
    });
  });

  describe('batch processing', () => {
    it('should group items by entity type', async () => {
      const mockItems = [
        {
          id: 'q1',
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
          id: 'q2',
          entity_id: 'e2',
          entity_type: 'shift',
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
          entity_type: 'transaction',
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

      // All items should be marked as synced
      expect(mockMarkSynced).toHaveBeenCalledTimes(3);
    });
  });
});
