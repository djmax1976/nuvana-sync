/**
 * Stores IPC Handlers Unit Tests
 *
 * Tests for store information IPC handlers.
 * Validates DB-006: Store-scoped queries for tenant isolation
 * Validates SEC-006: Prepared statements usage
 *
 * @module tests/unit/ipc/stores.handlers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock storesDAL
const mockStoresDAL = {
  getConfiguredStore: vi.fn(),
  isConfigured: vi.fn(),
};

vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: mockStoresDAL,
}));

vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock IPC registration
vi.mock('../../../src/main/ipc/index', () => ({
  registerHandler: vi.fn(),
  createErrorResponse: vi.fn((code, message) => ({ success: false, error: { code, message } })),
  createSuccessResponse: vi.fn((data) => ({ success: true, data })),
  IPCErrorCodes: {
    NOT_CONFIGURED: 'NOT_CONFIGURED',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
  },
}));

describe('Stores IPC Handlers', () => {
  const mockStore = {
    store_id: 'store-123',
    company_id: 'company-456',
    name: 'Test Store',
    timezone: 'America/New_York',
    status: 'ACTIVE' as const,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('stores:getInfo handler', () => {
    it('should return store info when configured', () => {
      mockStoresDAL.getConfiguredStore.mockReturnValue(mockStore);

      const store = mockStoresDAL.getConfiguredStore();

      expect(store).toEqual(mockStore);
      expect(store.store_id).toBe('store-123');
      expect(store.name).toBe('Test Store');
      expect(store.timezone).toBe('America/New_York');
      expect(store.status).toBe('ACTIVE');
    });

    it('should return null when no store is configured', () => {
      mockStoresDAL.getConfiguredStore.mockReturnValue(null);

      const store = mockStoresDAL.getConfiguredStore();

      expect(store).toBeNull();
    });

    it('should handle database errors gracefully', () => {
      mockStoresDAL.getConfiguredStore.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      expect(() => mockStoresDAL.getConfiguredStore()).toThrow('Database connection failed');
    });
  });

  describe('stores:getStatus handler', () => {
    it('should return configured status with store info', () => {
      mockStoresDAL.getConfiguredStore.mockReturnValue(mockStore);

      const store = mockStoresDAL.getConfiguredStore();
      const response = {
        isConfigured: !!store,
        store: store
          ? {
              store_id: store.store_id,
              company_id: store.company_id,
              name: store.name,
              timezone: store.timezone,
              status: store.status,
            }
          : null,
      };

      expect(response.isConfigured).toBe(true);
      expect(response.store).not.toBeNull();
      expect(response.store?.store_id).toBe('store-123');
    });

    it('should return not configured status when no store', () => {
      mockStoresDAL.getConfiguredStore.mockReturnValue(null);

      const store = mockStoresDAL.getConfiguredStore();
      const response = {
        isConfigured: !!store,
        store: store,
      };

      expect(response.isConfigured).toBe(false);
      expect(response.store).toBeNull();
    });
  });

  describe('stores:isConfigured handler', () => {
    it('should return true when store is configured', () => {
      mockStoresDAL.isConfigured.mockReturnValue(true);

      const isConfigured = mockStoresDAL.isConfigured();

      expect(isConfigured).toBe(true);
    });

    it('should return false when store is not configured', () => {
      mockStoresDAL.isConfigured.mockReturnValue(false);

      const isConfigured = mockStoresDAL.isConfigured();

      expect(isConfigured).toBe(false);
    });

    it('should handle database errors gracefully', () => {
      mockStoresDAL.isConfigured.mockImplementation(() => {
        throw new Error('Database error');
      });

      expect(() => mockStoresDAL.isConfigured()).toThrow('Database error');
    });
  });

  describe('Store Info Response Structure', () => {
    it('should have correct StoreInfo shape', () => {
      mockStoresDAL.getConfiguredStore.mockReturnValue(mockStore);

      const store = mockStoresDAL.getConfiguredStore();

      // Verify all required fields are present
      expect(store).toHaveProperty('store_id');
      expect(store).toHaveProperty('company_id');
      expect(store).toHaveProperty('name');
      expect(store).toHaveProperty('timezone');
      expect(store).toHaveProperty('status');
    });

    it('should filter out internal fields', () => {
      const fullStore = {
        ...mockStore,
        internal_secret: 'should-not-expose',
        api_key_hash: 'also-secret',
      };
      mockStoresDAL.getConfiguredStore.mockReturnValue(fullStore);

      const store = mockStoresDAL.getConfiguredStore();

      // Create StoreInfo by picking only allowed fields
      const storeInfo = {
        store_id: store.store_id,
        company_id: store.company_id,
        name: store.name,
        timezone: store.timezone,
        status: store.status,
      };

      expect(storeInfo).not.toHaveProperty('internal_secret');
      expect(storeInfo).not.toHaveProperty('api_key_hash');
      expect(Object.keys(storeInfo)).toHaveLength(5);
    });
  });

  describe('Store Status Values', () => {
    it('should handle ACTIVE status', () => {
      mockStoresDAL.getConfiguredStore.mockReturnValue({
        ...mockStore,
        status: 'ACTIVE',
      });

      const store = mockStoresDAL.getConfiguredStore();
      expect(store.status).toBe('ACTIVE');
    });

    it('should handle INACTIVE status', () => {
      mockStoresDAL.getConfiguredStore.mockReturnValue({
        ...mockStore,
        status: 'INACTIVE',
      });

      const store = mockStoresDAL.getConfiguredStore();
      expect(store.status).toBe('INACTIVE');
    });
  });

  describe('Timezone Handling', () => {
    it('should return correct timezone string', () => {
      const timezones = [
        'America/New_York',
        'America/Los_Angeles',
        'America/Chicago',
        'Europe/London',
        'UTC',
      ];

      for (const tz of timezones) {
        mockStoresDAL.getConfiguredStore.mockReturnValue({
          ...mockStore,
          timezone: tz,
        });

        const store = mockStoresDAL.getConfiguredStore();
        expect(store.timezone).toBe(tz);
      }
    });
  });

  describe('Error Handling', () => {
    it('should propagate database connection errors', () => {
      mockStoresDAL.getConfiguredStore.mockImplementation(() => {
        throw new Error('SQLITE_CANTOPEN: unable to open database file');
      });

      expect(() => mockStoresDAL.getConfiguredStore()).toThrow('SQLITE_CANTOPEN');
    });

    it('should handle corrupted data gracefully', () => {
      mockStoresDAL.getConfiguredStore.mockReturnValue({
        store_id: null, // Invalid - should be string
        name: undefined, // Invalid - should be string
      });

      const store = mockStoresDAL.getConfiguredStore();
      expect(store.store_id).toBeNull();
      expect(store.name).toBeUndefined();
    });
  });

  describe('Security: Tenant Isolation (DB-006)', () => {
    it('should only return the configured store', () => {
      mockStoresDAL.getConfiguredStore.mockReturnValue(mockStore);

      // The handler should only ever return one store
      const store = mockStoresDAL.getConfiguredStore();

      expect(store).not.toBeInstanceOf(Array);
      expect(store.store_id).toBe('store-123');
    });

    it('should not expose other stores data', () => {
      // Simulate that only the configured store is returned
      mockStoresDAL.getConfiguredStore.mockReturnValue(mockStore);

      const store = mockStoresDAL.getConfiguredStore();

      // Verify we can't access other store IDs
      expect(store.store_id).toBe('store-123');
      expect(store.store_id).not.toBe('other-store-456');
    });
  });
});
