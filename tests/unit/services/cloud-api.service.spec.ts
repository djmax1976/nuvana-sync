/**
 * Cloud API Service Unit Tests
 *
 * @module tests/unit/services/cloud-api.service.spec
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use global for shared state to avoid hoisting issues
declare global {
  // eslint-disable-next-line no-var
  var __mockStoreData: Map<string, unknown>;
}

globalThis.__mockStoreData = new Map<string, unknown>();

// Mock electron
vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/tmp'),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    decryptString: vi.fn(() => 'decrypted-api-key'),
    encryptString: vi.fn((str: string) => Buffer.from('encrypted')),
  },
}));

// Mock electron-store as a class that uses the global store
vi.mock('electron-store', () => {
  return {
    default: class MockStore {
      private store: Map<string, unknown>;

      constructor() {
        this.store = globalThis.__mockStoreData;
      }

      get(key: string) {
        return this.store.get(key);
      }

      set(key: string, value: unknown) {
        this.store.set(key, value);
      }

      delete(key: string) {
        this.store.delete(key);
      }

      clear() {
        this.store.clear();
      }
    },
  };
});

// Mock license service
vi.mock('../../../src/main/services/license.service', () => ({
  licenseService: {
    isValid: vi.fn(() => true),
    getState: vi.fn(() => ({
      valid: true,
      expiresAt: '2025-12-31T00:00:00Z',
      lastCheckedAt: new Date().toISOString(),
    })),
    markSuspended: vi.fn(),
    markCancelled: vi.fn(),
    updateFromApiResponse: vi.fn(),
  },
  LicenseApiResponseSchema: {
    safeParse: vi.fn(() => ({ success: true, data: {} })),
  },
}));

// Mock logger
vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { CloudApiService } from '../../../src/main/services/cloud-api.service';

describe('CloudApiService', () => {
  let service: CloudApiService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up mock store data
    globalThis.__mockStoreData.clear();
    globalThis.__mockStoreData.set('apiUrl', 'https://api.nuvanaapp.com');
    globalThis.__mockStoreData.set('encryptedApiKey', Array.from(Buffer.from('encrypted-key')));

    service = new CloudApiService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('healthCheck', () => {
    it('should return true when API is healthy', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      const result = await service.healthCheck();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.nuvanaapp.com/api/v1/health',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should return false when API is unreachable', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await service.healthCheck();

      expect(result).toBe(false);
    });

    it('should return false on non-OK response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ message: 'Service unavailable' }),
      });

      const result = await service.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('validateApiKey', () => {
    // Helper to create the proper cloud API response structure
    const createIdentityResponse = (overrides?: {
      storeId?: string;
      storeName?: string;
      companyId?: string;
      companyName?: string;
      features?: string[];
    }) => ({
      success: true,
      data: {
        identity: {
          storeId: overrides?.storeId ?? 'store-123',
          storeName: overrides?.storeName ?? 'Test Store',
          storePublicId: 'TEST001',
          companyId: overrides?.companyId ?? 'company-456',
          companyName: overrides?.companyName ?? 'Test Company',
          timezone: 'America/New_York',
          stateId: 'state-1',
          stateCode: 'NY',
          offlinePermissions: [],
          metadata: { features: overrides?.features ?? ['lottery', 'reports'] },
        },
        offlineToken: 'token',
        offlineTokenExpiresAt: '2025-12-31T00:00:00Z',
        storeManager: null,
      },
    });

    it('should validate API key and return store info', async () => {
      const mockResponse = createIdentityResponse();

      mockFetch
        // Activate call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })
        // Identity call
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        });

      const result = await service.validateApiKey();

      expect(result.valid).toBe(true);
      expect(result.storeId).toBe('store-123');
      expect(result.storeName).toBe('Test Store');
      // Check that identity call was made (second call)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.nuvanaapp.com/api/v1/keys/identity',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'X-API-Key': 'decrypted-api-key',
          }),
        })
      );
    });

    it('should return valid response with minimal data', async () => {
      // The service maps responses with proper cloud structure
      const mockResponse = createIdentityResponse({
        storeId: 'store-123',
      });

      mockFetch
        // Activate call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })
        // Identity call
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        });

      const result = await service.validateApiKey();

      // Should return a valid response
      expect(result.valid).toBe(true);
      expect(result.storeId).toBe('store-123');
    });
  });

  describe('pushBatch', () => {
    it('should push batch of items to cloud', async () => {
      const mockResponse = {
        success: true,
        results: [
          { id: 'entity-1', status: 'synced', cloudId: 'cloud-1' },
          { id: 'entity-2', status: 'synced', cloudId: 'cloud-2' },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const items = [
        {
          id: 'queue-1',
          entity_id: 'entity-1',
          entity_type: 'transaction',
          store_id: 'store-123',
          operation: 'CREATE' as const,
          payload: '{"amount":100}',
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
          entity_id: 'entity-2',
          entity_type: 'transaction',
          store_id: 'store-123',
          operation: 'UPDATE' as const,
          payload: '{"amount":200}',
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

      const result = await service.pushBatch('transaction', items);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.nuvanaapp.com/api/v1/sync/batch',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
        })
      );
    });

    it('should return empty results for empty items', async () => {
      const result = await service.pushBatch('transaction', []);

      expect(result).toEqual({ success: true, results: [] });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('pullUsers', () => {
    // Helper to set up mocks for the full sync flow
    const setupSyncFlowMocks = (
      cashiers: Array<{
        cashierId: string;
        name: string;
        pinHash: string;
        isActive: boolean;
      }>
    ) => {
      mockFetch
        // 1. POST /api/v1/sync/start
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                sessionId: 'session-123',
                revocationStatus: 'VALID',
                pullPendingCount: cashiers.length,
              },
            }),
        })
        // 2. GET /api/v1/sync/cashiers
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                cashiers,
                syncMetadata: {
                  hasMore: false,
                  lastSequence: 100,
                  serverTimestamp: new Date().toISOString(),
                },
              },
            }),
        })
        // 3. POST /api/v1/sync/complete
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
    };

    it('should pull users from cloud', async () => {
      const mockCashiers = [
        {
          cashierId: 'user-1',
          name: 'John Doe',
          pinHash: '$2b$12$hashedpin123',
          isActive: true,
        },
      ];

      setupSyncFlowMocks(mockCashiers);

      const result = await service.pullUsers();

      expect(result.users).toHaveLength(1);
      expect(result.users[0].name).toBe('John Doe');
      // All users pulled via pullUsers are mapped to 'cashier' role
      expect(result.users[0].role).toBe('cashier');
    });

    it('should handle multiple cashiers', async () => {
      const mockCashiers = [
        {
          cashierId: 'user-1',
          name: 'Manager',
          pinHash: '$2b$12$...',
          isActive: true,
        },
        {
          cashierId: 'user-2',
          name: 'Shift Lead',
          pinHash: '$2b$12$...',
          isActive: true,
        },
        {
          cashierId: 'user-3',
          name: 'Cashier',
          pinHash: '$2b$12$...',
          isActive: true,
        },
      ];

      setupSyncFlowMocks(mockCashiers);

      const result = await service.pullUsers();

      expect(result.users).toHaveLength(3);
      // All users pulled via pullUsers/pullCashiers are cashiers
      expect(result.users[0].role).toBe('cashier');
      expect(result.users[1].role).toBe('cashier');
      expect(result.users[2].role).toBe('cashier');
    });
  });

  describe('validateApiKey with initial manager', () => {
    // Helper to create the proper cloud API response structure
    const createValidateResponse = (
      storeManager?: {
        userId: string;
        name: string;
        role: { code: string };
        pinHash: string;
        isActive: boolean;
      } | null
    ) => ({
      success: true,
      data: {
        identity: {
          storeId: 'store-123',
          storeName: 'Test Store',
          storePublicId: 'TEST001',
          companyId: 'company-456',
          companyName: 'Test Company',
          timezone: 'America/New_York',
          stateId: 'state-1',
          stateCode: 'NY',
          offlinePermissions: [],
          metadata: { features: ['lottery', 'reports'] },
        },
        offlineToken: 'token',
        offlineTokenExpiresAt: '2025-12-31T00:00:00Z',
        storeManager: storeManager ?? null,
      },
    });

    it('should parse initial manager from response - SEC-001', async () => {
      const mockResponse = createValidateResponse({
        userId: 'init-mgr-001',
        name: 'Initial Manager',
        role: { code: 'STORE_MANAGER' },
        pinHash: '$2b$12$initialmanagerhash',
        isActive: true,
      });

      mockFetch
        // Activate call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })
        // Identity call
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        });

      const result = await service.validateApiKey();

      expect(result.initialManager).toBeDefined();
      expect(result.initialManager?.userId).toBe('init-mgr-001');
      expect(result.initialManager?.name).toBe('Initial Manager');
      expect(result.initialManager?.role).toBe('store_manager');
      expect(result.initialManager?.pinHash).toBe('$2b$12$initialmanagerhash');
    });

    it('should handle different role codes', async () => {
      const mockResponse = createValidateResponse({
        userId: 'snake-case-mgr',
        name: 'Shift Manager',
        role: { code: 'SHIFT_MANAGER' },
        pinHash: '$2b$12$snakecasehash',
        isActive: true,
      });

      mockFetch
        // Activate call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })
        // Identity call
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        });

      const result = await service.validateApiKey();

      expect(result.initialManager).toBeDefined();
      expect(result.initialManager?.userId).toBe('snake-case-mgr');
      expect(result.initialManager?.role).toBe('shift_manager');
      expect(result.initialManager?.pinHash).toBe('$2b$12$snakecasehash');
    });

    it('should handle response without initial manager', async () => {
      const mockResponse = createValidateResponse(null);

      mockFetch
        // Activate call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })
        // Identity call
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        });

      const result = await service.validateApiKey();

      expect(result.initialManager).toBeUndefined();
    });

    it('should ignore incomplete initial manager data', async () => {
      const mockResponse = createValidateResponse({
        userId: 'partial-mgr',
        name: '', // Empty name
        role: { code: 'STORE_MANAGER' },
        pinHash: '', // Empty pin hash
        isActive: true,
      });

      mockFetch
        // Activate call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })
        // Identity call
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        });

      const result = await service.validateApiKey();

      // Should be undefined because required fields are empty
      expect(result.initialManager).toBeUndefined();
    });

    it('should handle all valid initial manager roles', async () => {
      const roleMappings = [
        { cloudCode: 'STORE_MANAGER', localRole: 'store_manager' },
        { cloudCode: 'SHIFT_MANAGER', localRole: 'shift_manager' },
        { cloudCode: 'CASHIER', localRole: 'cashier' },
      ] as const;

      for (const { cloudCode, localRole } of roleMappings) {
        vi.clearAllMocks();

        const mockResponse = createValidateResponse({
          userId: `mgr-${localRole}`,
          name: `${localRole} User`,
          role: { code: cloudCode },
          pinHash: '$2b$12$rolehash',
          isActive: true,
        });

        mockFetch
          // Activate call
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ success: true }),
          })
          // Identity call
          .mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockResponse),
          });

        const result = await service.validateApiKey();

        expect(result.initialManager?.role).toBe(localRole);
      }
    });
  });

  describe('pullBins', () => {
    it('should pull all bins when no since parameter', async () => {
      const mockResponse = {
        bins: [
          {
            bin_id: 'bin-1',
            store_id: 'store-123',
            bin_number: 1,
            status: 'ACTIVE',
            updated_at: '2024-01-01T00:00:00Z',
          },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.pullBins();

      expect(result.bins).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.nuvanaapp.com/api/v1/sync/bins',
        expect.any(Object)
      );
    });

    it('should include since parameter for delta sync', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ bins: [] }),
      });

      await service.pullBins('2024-01-01T00:00:00Z');

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('since='), expect.any(Object));
    });
  });

  describe('HTTPS enforcement', () => {
    it('should allow HTTPS URL', async () => {
      // Verify HTTPS URLs work normally
      globalThis.__mockStoreData.clear();
      globalThis.__mockStoreData.set('apiUrl', 'https://api.nuvanaapp.com');
      globalThis.__mockStoreData.set('encryptedApiKey', Array.from(Buffer.from('encrypted-key')));

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      const httpsService = new CloudApiService();
      const result = await httpsService.healthCheck();

      expect(result).toBe(true);
    });

    it('should use configured API URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      await service.healthCheck();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.nuvanaapp.com/api/v1/health',
        expect.any(Object)
      );
    });
  });

  describe('error handling', () => {
    it('should handle rate limiting with retry-after on validateApiKey', async () => {
      // Mock Headers.get for rate limiting
      const mockHeaders = {
        get: vi.fn((name: string) => (name === 'Retry-After' ? '1' : null)),
      };

      // Mock response with proper cloud API structure
      const validResponse = {
        success: true,
        data: {
          identity: {
            storeId: 'store-123',
            storeName: 'Test',
            storePublicId: 'TEST001',
            companyId: 'comp-1',
            companyName: 'Test Co',
            timezone: 'UTC',
            stateId: 'state-1',
            stateCode: 'NY',
            offlinePermissions: [],
            metadata: { features: [] },
          },
          offlineToken: 'token',
          offlineTokenExpiresAt: '2025-12-31T00:00:00Z',
          storeManager: null,
        },
      };

      mockFetch
        // First call: activate (may fail or succeed)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })
        // Second call: identity with rate limit
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: mockHeaders,
          json: () => Promise.resolve({ message: 'Rate limited' }),
        })
        // Third call: identity succeeds
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(validResponse),
        });

      // validateApiKey retries on rate limit, unlike healthCheck which catches errors
      const result = await service.validateApiKey();

      expect(result.valid).toBe(true);
    });

    it('should retry on server errors', async () => {
      // Mock response with proper cloud API structure
      const validResponse = {
        success: true,
        data: {
          identity: {
            storeId: 'store-123',
            storeName: 'Test',
            storePublicId: 'TEST001',
            companyId: 'comp-1',
            companyName: 'Test Co',
            timezone: 'UTC',
            stateId: 'state-1',
            stateCode: 'NY',
            offlinePermissions: [],
            metadata: { features: [] },
          },
          offlineToken: 'token',
          offlineTokenExpiresAt: '2025-12-31T00:00:00Z',
          storeManager: null,
        },
      };

      mockFetch
        // First call: activate
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })
        // Second call: identity with server error
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: () => Promise.resolve({ message: 'Service unavailable' }),
        })
        // Third call: identity succeeds
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(validResponse),
        });

      const result = await service.validateApiKey();

      expect(result.valid).toBe(true);
      // 1 activate + 2 identity attempts (first fails, second succeeds)
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });
});
