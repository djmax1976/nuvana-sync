/**
 * Sync Log DAL Unit Tests
 *
 * @module tests/unit/dal/sync-log.dal.spec
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database service
const mockPrepare = vi.fn();
const mockTransaction = vi.fn((fn) => () => fn());

vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

import { SyncLogDAL, type SyncLog } from '../../../src/main/dal/sync-log.dal';

describe('SyncLogDAL', () => {
  let dal: SyncLogDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new SyncLogDAL();
  });

  describe('startSync', () => {
    it('should create new sync log entry with RUNNING status', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.startSync('store-123', 'PUSH');

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO sync_log'));
      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String), // id
        'store-123',
        'PUSH',
        expect.any(String), // started_at
        expect.any(String) // created_at
      );
    });

    it('should support PULL sync type', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.startSync('store-123', 'PULL');

      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String),
        'store-123',
        'PULL',
        expect.any(String),
        expect.any(String)
      );
    });
  });

  describe('completeSync', () => {
    it('should update sync log with COMPLETED status and results', () => {
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.completeSync('log-123', {
        records_sent: 100,
        records_succeeded: 95,
        records_failed: 5,
      });

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE sync_log SET'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("status = 'COMPLETED'"));
      expect(mockRun).toHaveBeenCalledWith(
        100, // records_sent
        95, // records_succeeded
        5, // records_failed
        expect.any(String), // completed_at
        null, // details (no details provided)
        'log-123'
      );
    });

    it('should serialize details to JSON when provided', () => {
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.completeSync('log-123', {
        records_sent: 50,
        records_succeeded: 50,
        records_failed: 0,
        details: { batchId: 'batch-456', entityTypes: ['transaction', 'shift'] },
      });

      expect(mockRun).toHaveBeenCalledWith(
        50,
        50,
        0,
        expect.any(String),
        expect.stringContaining('batch-456'), // JSON serialized details
        'log-123'
      );
    });
  });

  describe('failSync', () => {
    it('should update sync log with FAILED status and error message', () => {
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.failSync('log-123', 'Connection timeout');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("status = 'FAILED'"));
      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String), // completed_at
        'Connection timeout',
        null, // details
        'log-123'
      );
    });

    it('should truncate long error messages', () => {
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({ run: mockRun });

      const longError = 'a'.repeat(2000);
      dal.failSync('log-123', longError);

      const [, errorArg] = mockRun.mock.calls[0];
      expect(errorArg.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('getRecentLogs', () => {
    it('should return recent sync logs ordered by started_at DESC', () => {
      const mockLogs: SyncLog[] = [
        {
          id: 'log-2',
          store_id: 'store-123',
          sync_type: 'PUSH',
          status: 'COMPLETED',
          records_sent: 50,
          records_succeeded: 50,
          records_failed: 0,
          started_at: '2024-01-02T00:00:00.000Z',
          completed_at: '2024-01-02T00:01:00.000Z',
          error_message: null,
          details: null,
          created_at: '2024-01-02T00:00:00.000Z',
        },
        {
          id: 'log-1',
          store_id: 'store-123',
          sync_type: 'PUSH',
          status: 'COMPLETED',
          records_sent: 100,
          records_succeeded: 95,
          records_failed: 5,
          started_at: '2024-01-01T00:00:00.000Z',
          completed_at: '2024-01-01T00:01:00.000Z',
          error_message: null,
          details: null,
          created_at: '2024-01-01T00:00:00.000Z',
        },
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockLogs),
      });

      const result = dal.getRecentLogs('store-123', 50);

      expect(result).toEqual(mockLogs);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ORDER BY started_at DESC'));
    });

    it('should respect limit parameter', () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValue({ all: mockAll });

      dal.getRecentLogs('store-123', 25);

      expect(mockAll).toHaveBeenCalledWith('store-123', 25);
    });

    it('should cap limit at maximum', () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValue({ all: mockAll });

      dal.getRecentLogs('store-123', 1000);

      expect(mockAll).toHaveBeenCalledWith('store-123', 500);
    });
  });

  describe('getLastSync', () => {
    it('should return most recent sync log', () => {
      const mockLog: SyncLog = {
        id: 'log-1',
        store_id: 'store-123',
        sync_type: 'PUSH',
        status: 'COMPLETED',
        records_sent: 50,
        records_succeeded: 50,
        records_failed: 0,
        started_at: '2024-01-01T00:00:00.000Z',
        completed_at: '2024-01-01T00:01:00.000Z',
        error_message: null,
        details: null,
        created_at: '2024-01-01T00:00:00.000Z',
      };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockLog),
      });

      const result = dal.getLastSync('store-123');

      expect(result).toEqual(mockLog);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('LIMIT 1'));
    });

    it('should filter by sync type when provided', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(null),
      });

      dal.getLastSync('store-123', 'PULL');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('sync_type = ?'));
    });

    it('should return undefined when no logs exist', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.getLastSync('store-123');

      expect(result).toBeUndefined();
    });
  });

  describe('getLastSuccessfulSync', () => {
    it('should return most recent successful sync', () => {
      const mockLog: SyncLog = {
        id: 'log-1',
        store_id: 'store-123',
        sync_type: 'PUSH',
        status: 'COMPLETED',
        records_sent: 50,
        records_succeeded: 50,
        records_failed: 0,
        started_at: '2024-01-01T00:00:00.000Z',
        completed_at: '2024-01-01T00:01:00.000Z',
        error_message: null,
        details: null,
        created_at: '2024-01-01T00:00:00.000Z',
      };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockLog),
      });

      const result = dal.getLastSuccessfulSync('store-123');

      expect(result).toEqual(mockLog);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("status = 'COMPLETED'"));
    });
  });

  describe('getStats', () => {
    it('should return comprehensive sync statistics', () => {
      mockPrepare
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ count: 100 }), // total
        })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ count: 95 }), // successful
        })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ count: 5 }), // failed
        })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ total: 5000 }), // records synced
        })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({
            id: 'log-1',
            status: 'COMPLETED',
            started_at: '2024-01-01T00:00:00.000Z',
            completed_at: '2024-01-01T00:01:00.000Z',
          }), // last sync
        });

      const stats = dal.getStats('store-123');

      expect(stats).toEqual({
        totalSyncs: 100,
        successfulSyncs: 95,
        failedSyncs: 5,
        lastSyncAt: '2024-01-01T00:01:00.000Z',
        lastSyncStatus: 'COMPLETED',
        totalRecordsSynced: 5000,
      });
    });
  });

  describe('getRunningCount', () => {
    it('should return count of running syncs', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ count: 1 }),
      });

      const result = dal.getRunningCount('store-123');

      expect(result).toBe(1);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("status = 'RUNNING'"));
    });
  });

  describe('cleanupStaleRunning', () => {
    it('should mark stale running syncs as failed', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 2 }),
      });

      const result = dal.cleanupStaleRunning('store-123', 30);

      expect(result).toBe(2);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("status = 'FAILED'"));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("status = 'RUNNING'"));
    });
  });

  describe('deleteOldLogs', () => {
    it('should delete logs older than specified days', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 50 }),
      });

      const result = dal.deleteOldLogs('store-123', 90);

      expect(result).toBe(50);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM sync_log'));
    });
  });
});
