/**
 * Sync Timestamps DAL Unit Tests
 *
 * @module tests/unit/dal/sync-timestamps.dal.spec
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

import { SyncTimestampsDAL, type SyncTimestamp } from '../../../src/main/dal/sync-timestamps.dal';

describe('SyncTimestampsDAL', () => {
  let dal: SyncTimestampsDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new SyncTimestampsDAL();
  });

  describe('getLastPushAt', () => {
    it('should return last push timestamp', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ last_push_at: '2024-01-01T00:00:00.000Z' }),
      });

      const result = dal.getLastPushAt('store-123', 'bins');

      expect(result).toBe('2024-01-01T00:00:00.000Z');
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('SELECT last_push_at'));
    });

    it('should return null if no timestamp exists', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.getLastPushAt('store-123', 'bins');

      expect(result).toBeNull();
    });

    it('should return null if timestamp is null in database', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ last_push_at: null }),
      });

      const result = dal.getLastPushAt('store-123', 'bins');

      expect(result).toBeNull();
    });
  });

  describe('setLastPushAt', () => {
    it('should insert new timestamp record', () => {
      const mockRun = vi.fn();
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) }) // findByStoreAndType
        .mockReturnValueOnce({ run: mockRun }); // insert

      dal.setLastPushAt('store-123', 'bins', '2024-01-01T00:00:00.000Z');

      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String), // id
        'store-123',
        'bins',
        '2024-01-01T00:00:00.000Z',
        expect.any(String), // created_at
        expect.any(String) // updated_at
      );
    });

    it('should update existing timestamp record', () => {
      const mockRun = vi.fn();
      mockPrepare
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ id: 'existing-id', store_id: 'store-123' }),
        })
        .mockReturnValueOnce({ run: mockRun });

      dal.setLastPushAt('store-123', 'bins', '2024-01-02T00:00:00.000Z');

      expect(mockRun).toHaveBeenCalledWith(
        '2024-01-02T00:00:00.000Z',
        expect.any(String), // updated_at
        'existing-id'
      );
    });
  });

  describe('getLastPullAt', () => {
    it('should return last pull timestamp', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ last_pull_at: '2024-01-01T12:00:00.000Z' }),
      });

      const result = dal.getLastPullAt('store-123', 'games');

      expect(result).toBe('2024-01-01T12:00:00.000Z');
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('SELECT last_pull_at'));
    });

    it('should return null if no timestamp exists', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.getLastPullAt('store-123', 'games');

      expect(result).toBeNull();
    });
  });

  describe('setLastPullAt', () => {
    it('should insert new timestamp record', () => {
      const mockRun = vi.fn();
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) })
        .mockReturnValueOnce({ run: mockRun });

      dal.setLastPullAt('store-123', 'games', '2024-01-01T00:00:00.000Z');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO sync_timestamps')
      );
      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String), // id
        'store-123',
        'games',
        '2024-01-01T00:00:00.000Z',
        expect.any(String), // created_at
        expect.any(String) // updated_at
      );
    });

    it('should update existing timestamp record', () => {
      const mockRun = vi.fn();
      mockPrepare
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ id: 'existing-id' }),
        })
        .mockReturnValueOnce({ run: mockRun });

      dal.setLastPullAt('store-123', 'games', '2024-01-02T00:00:00.000Z');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE sync_timestamps'));
      expect(mockRun).toHaveBeenCalledWith(
        '2024-01-02T00:00:00.000Z',
        expect.any(String), // updated_at
        'existing-id'
      );
    });
  });

  describe('findByStoreAndType', () => {
    it('should return sync timestamp record', () => {
      const mockRecord: SyncTimestamp = {
        id: 'ts-1',
        store_id: 'store-123',
        entity_type: 'bins',
        last_push_at: '2024-01-01T00:00:00.000Z',
        last_pull_at: '2024-01-01T12:00:00.000Z',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T12:00:00.000Z',
      };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockRecord),
      });

      const result = dal.findByStoreAndType('store-123', 'bins');

      expect(result).toEqual(mockRecord);
    });

    it('should return undefined if not found', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.findByStoreAndType('store-123', 'nonexistent');

      expect(result).toBeUndefined();
    });
  });

  describe('findAllByStore', () => {
    it('should return all sync timestamps for store', () => {
      const mockRecords: SyncTimestamp[] = [
        {
          id: 'ts-1',
          store_id: 'store-123',
          entity_type: 'bins',
          last_push_at: '2024-01-01T00:00:00.000Z',
          last_pull_at: '2024-01-01T12:00:00.000Z',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T12:00:00.000Z',
        },
        {
          id: 'ts-2',
          store_id: 'store-123',
          entity_type: 'games',
          last_push_at: null,
          last_pull_at: '2024-01-02T00:00:00.000Z',
          created_at: '2024-01-02T00:00:00.000Z',
          updated_at: '2024-01-02T00:00:00.000Z',
        },
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockRecords),
      });

      const result = dal.findAllByStore('store-123');

      expect(result).toEqual(mockRecords);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ORDER BY entity_type'));
    });
  });

  describe('reset', () => {
    it('should reset timestamps for entity type', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 1 }),
      });

      const result = dal.reset('store-123', 'bins');

      expect(result).toBe(true);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('last_push_at = NULL'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('last_pull_at = NULL'));
    });

    it('should return false if no record existed', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      const result = dal.reset('store-123', 'nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('resetAll', () => {
    it('should reset all timestamps for store', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 3 }),
      });

      const result = dal.resetAll('store-123');

      expect(result).toBe(3);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE store_id = ?'));
    });

    it('should return 0 if no records existed', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      const result = dal.resetAll('store-123');

      expect(result).toBe(0);
    });
  });

  describe('deleteByType', () => {
    it('should delete timestamp record', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 1 }),
      });

      const result = dal.deleteByType('store-123', 'bins');

      expect(result).toBe(true);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM sync_timestamps')
      );
    });

    it('should return false if no record existed', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      const result = dal.deleteByType('store-123', 'nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('getSyncSummary', () => {
    it('should return summary of all entity types', () => {
      const mockRecords: SyncTimestamp[] = [
        {
          id: 'ts-1',
          store_id: 'store-123',
          entity_type: 'bins',
          last_push_at: '2024-01-01T00:00:00.000Z',
          last_pull_at: '2024-01-01T12:00:00.000Z',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T12:00:00.000Z',
        },
        {
          id: 'ts-2',
          store_id: 'store-123',
          entity_type: 'games',
          last_push_at: null,
          last_pull_at: '2024-01-02T00:00:00.000Z',
          created_at: '2024-01-02T00:00:00.000Z',
          updated_at: '2024-01-02T00:00:00.000Z',
        },
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockRecords),
      });

      const result = dal.getSyncSummary('store-123');

      expect(result).toEqual({
        bins: {
          lastPushAt: '2024-01-01T00:00:00.000Z',
          lastPullAt: '2024-01-01T12:00:00.000Z',
        },
        games: {
          lastPushAt: null,
          lastPullAt: '2024-01-02T00:00:00.000Z',
        },
      });
    });

    it('should return empty object if no timestamps exist', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const result = dal.getSyncSummary('store-123');

      expect(result).toEqual({});
    });
  });
});
