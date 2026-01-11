/**
 * Stores DAL Unit Tests
 *
 * @module tests/unit/dal/stores.dal.spec
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
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-uuid-1234'),
}));

import { StoresDAL, type Store } from '../../../src/main/dal/stores.dal';

describe('StoresDAL', () => {
  let dal: StoresDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new StoresDAL();
  });

  describe('create', () => {
    it('should create store with all fields', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockStore: Store = {
        store_id: 'store-123',
        company_id: 'company-456',
        name: 'Test Store',
        timezone: 'America/New_York',
        status: 'ACTIVE',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockStore) });

      const result = dal.create({
        store_id: 'store-123',
        company_id: 'company-456',
        name: 'Test Store',
      });

      expect(result).toEqual(mockStore);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO stores'));
    });

    it('should use default timezone when not provided', () => {
      const mockRun = vi.fn();
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({}) });

      dal.create({
        store_id: 'store-123',
        company_id: 'company-456',
        name: 'Test Store',
      });

      expect(mockRun).toHaveBeenCalledWith(
        'store-123',
        'company-456',
        'Test Store',
        'America/New_York', // Default timezone
        'ACTIVE',
        expect.any(String),
        expect.any(String)
      );
    });
  });

  describe('update', () => {
    it('should update store fields', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const updatedStore: Store = {
        store_id: 'store-123',
        company_id: 'company-456',
        name: 'Updated Name',
        timezone: 'America/Los_Angeles',
        status: 'ACTIVE',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-02T00:00:00.000Z',
      };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(updatedStore) });

      const result = dal.update('store-123', {
        name: 'Updated Name',
        timezone: 'America/Los_Angeles',
      });

      expect(result?.name).toBe('Updated Name');
    });

    it('should return undefined for non-existent store', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      const result = dal.update('nonexistent', { name: 'New Name' });

      expect(result).toBeUndefined();
    });
  });

  describe('getConfiguredStore', () => {
    it('should return first active store', () => {
      const mockStore: Store = {
        store_id: 'store-123',
        company_id: 'company-456',
        name: 'Test Store',
        timezone: 'America/New_York',
        status: 'ACTIVE',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockStore),
      });

      const result = dal.getConfiguredStore();

      expect(result).toEqual(mockStore);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("status = 'ACTIVE'"));
    });

    it('should return undefined when no store configured', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.getConfiguredStore();

      expect(result).toBeUndefined();
    });
  });

  describe('isConfigured', () => {
    it('should return true when store exists', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ 1: 1 }),
      });

      const result = dal.isConfigured();

      expect(result).toBe(true);
    });

    it('should return false when no stores', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.isConfigured();

      expect(result).toBe(false);
    });
  });

  describe('upsertFromCloud', () => {
    it('should create new store if not exists', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockStore: Store = {
        store_id: 'store-123',
        company_id: 'company-456',
        name: 'Cloud Store',
        timezone: 'America/New_York',
        status: 'ACTIVE',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      };

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) }) // findById returns undefined
        .mockReturnValueOnce({ run: mockRun }) // create
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockStore) }); // findById after create

      const result = dal.upsertFromCloud({
        store_id: 'store-123',
        company_id: 'company-456',
        name: 'Cloud Store',
      });

      expect(result).toEqual(mockStore);
    });

    it('should update existing store', () => {
      const existingStore: Store = {
        store_id: 'store-123',
        company_id: 'company-456',
        name: 'Old Name',
        timezone: 'America/New_York',
        status: 'ACTIVE',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      };

      const updatedStore: Store = {
        ...existingStore,
        name: 'New Name',
        updated_at: '2024-01-02T00:00:00.000Z',
      };

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(existingStore) }) // findById
        .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) }) // update
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(updatedStore) }); // findById

      const result = dal.upsertFromCloud({
        store_id: 'store-123',
        company_id: 'company-456',
        name: 'New Name',
      });

      expect(result.name).toBe('New Name');
    });
  });
});
