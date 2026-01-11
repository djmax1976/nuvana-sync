/**
 * Base DAL Unit Tests
 *
 * Tests for base Data Access Layer patterns.
 *
 * @module tests/unit/base.dal.spec
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database service
const mockPrepare = vi.fn();
const mockTransaction = vi.fn((fn) => () => fn());

vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-uuid-1234'),
}));

import {
  BaseDAL,
  StoreBasedDAL,
  type BaseEntity,
  type StoreEntity,
  type PaginatedResult,
} from '../../src/main/dal/base.dal';

// Test implementations
interface TestEntity extends BaseEntity {
  id: string;
  name: string;
  created_at: string;
  updated_at?: string;
}

interface TestStoreEntity extends StoreEntity {
  id: string;
  store_id: string;
  name: string;
  created_at: string;
  updated_at?: string;
}

class TestDAL extends BaseDAL<TestEntity> {
  protected readonly tableName = 'test_table';
  protected readonly primaryKey = 'id';
  protected readonly sortableColumns = new Set(['created_at', 'name']);
}

class TestStoreDAL extends StoreBasedDAL<TestStoreEntity> {
  protected readonly tableName = 'test_store_table';
  protected readonly primaryKey = 'id';
  protected readonly sortableColumns = new Set(['created_at', 'name']);
}

describe('BaseDAL', () => {
  let dal: TestDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new TestDAL();
  });

  describe('findById', () => {
    it('should return entity by primary key', () => {
      const mockEntity = { id: '123', name: 'Test', created_at: '2024-01-01' };
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockEntity),
      });

      const result = dal.findById('123');

      expect(result).toEqual(mockEntity);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM test_table WHERE id = ?')
      );
    });

    it('should return undefined for non-existent id', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.findById('nonexistent');

      expect(result).toBeUndefined();
    });

    it('should use parameterized query for injection prevention', () => {
      const mockGet = vi.fn();
      mockPrepare.mockReturnValue({ get: mockGet });

      dal.findById("'; DROP TABLE users; --");

      // Verify the query uses ? placeholder
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE id = ?'));
      // Verify the malicious input is passed as parameter
      expect(mockGet).toHaveBeenCalledWith("'; DROP TABLE users; --");
    });
  });

  describe('findAll', () => {
    it('should return all entities', () => {
      const mockEntities = [
        { id: '1', name: 'First', created_at: '2024-01-01' },
        { id: '2', name: 'Second', created_at: '2024-01-02' },
      ];
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(mockEntities),
      });

      const result = dal.findAll();

      expect(result).toEqual(mockEntities);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when table is empty', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const result = dal.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('findPaginated', () => {
    it('should return paginated results with total count', () => {
      mockPrepare
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ count: 100 }),
        })
        .mockReturnValueOnce({
          all: vi.fn().mockReturnValue([{ id: '1', name: 'First', created_at: '2024-01-01' }]),
        });

      const result = dal.findPaginated({ limit: 10, offset: 0 });

      expect(result.total).toBe(100);
      expect(result.data).toHaveLength(1);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
      expect(result.hasMore).toBe(true);
    });

    it('should enforce maximum page size', () => {
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 10 }) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) });

      dal.findPaginated({ limit: 5000 }); // Request more than max

      // Verify limit was capped
      expect(mockPrepare).toHaveBeenLastCalledWith(expect.stringMatching(/LIMIT \? OFFSET \?/));
    });

    it('should apply sort options', () => {
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 10 }) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) });

      dal.findPaginated({}, { column: 'name', direction: 'ASC' });

      expect(mockPrepare).toHaveBeenLastCalledWith(expect.stringContaining('ORDER BY name ASC'));
    });

    it('should reject invalid sort columns', () => {
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 10 }) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) });

      // Try to sort by non-allowed column
      dal.findPaginated({}, { column: 'malicious_column', direction: 'ASC' });

      // Should fall back to default sort
      expect(mockPrepare).toHaveBeenLastCalledWith(
        expect.stringContaining('ORDER BY created_at DESC')
      );
    });
  });

  describe('count', () => {
    it('should return total count', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ count: 42 }),
      });

      const result = dal.count();

      expect(result).toBe(42);
    });
  });

  describe('exists', () => {
    it('should return true when entity exists', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ 1: 1 }),
      });

      const result = dal.exists('123');

      expect(result).toBe(true);
    });

    it('should return false when entity does not exist', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.exists('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete entity and return true', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 1 }),
      });

      const result = dal.delete('123');

      expect(result).toBe(true);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM test_table WHERE id = ?')
      );
    });

    it('should return false when entity not found', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      const result = dal.delete('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('deleteMany', () => {
    it('should delete multiple entities', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 3 }),
      });

      const result = dal.deleteMany(['1', '2', '3']);

      expect(result).toBe(3);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE id IN (?, ?, ?)'));
    });

    it('should return 0 for empty array', () => {
      const result = dal.deleteMany([]);

      expect(result).toBe(0);
      expect(mockPrepare).not.toHaveBeenCalled();
    });
  });
});

describe('StoreBasedDAL', () => {
  let dal: TestStoreDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new TestStoreDAL();
  });

  describe('findByStore', () => {
    it('should return entities scoped to store', () => {
      const mockEntities = [
        { id: '1', store_id: 'store-1', name: 'First', created_at: '2024-01-01' },
      ];

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 1 }) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue(mockEntities) });

      const result = dal.findByStore('store-1');

      expect(result.data).toEqual(mockEntities);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE store_id = ?'));
    });
  });

  describe('findByIdForStore', () => {
    it('should validate store ownership', () => {
      const mockEntity = {
        id: '123',
        store_id: 'store-1',
        name: 'Test',
        created_at: '2024-01-01',
      };
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockEntity),
      });

      const result = dal.findByIdForStore('store-1', '123');

      expect(result).toEqual(mockEntity);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = ? AND store_id = ?')
      );
    });

    it('should return undefined for wrong store', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.findByIdForStore('wrong-store', '123');

      expect(result).toBeUndefined();
    });
  });

  describe('countByStore', () => {
    it('should return count for specific store', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ count: 15 }),
      });

      const result = dal.countByStore('store-1');

      expect(result).toBe(15);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE store_id = ?'));
    });
  });

  describe('deleteForStore', () => {
    it('should only delete if entity belongs to store', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 1 }),
      });

      const result = dal.deleteForStore('store-1', '123');

      expect(result).toBe(true);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = ? AND store_id = ?')
      );
    });

    it('should return false when entity not in store', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      const result = dal.deleteForStore('wrong-store', '123');

      expect(result).toBe(false);
    });
  });
});
