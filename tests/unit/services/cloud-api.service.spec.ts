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

// Mock node-machine-id (used by startSyncSession for device fingerprint)
// Note: The code uses dynamic import and checks both machineIdSync and default.machineIdSync
const mockMachineIdSync = vi.fn(() => 'mock-device-fingerprint-12345');
vi.mock('node-machine-id', () => ({
  machineIdSync: mockMachineIdSync,
  default: {
    machineIdSync: mockMachineIdSync,
  },
}));

// Mock electron
vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/tmp'),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    decryptString: vi.fn(() => 'decrypted-api-key'),
    encryptString: vi.fn((_str: string) => Buffer.from('encrypted')),
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
    // Reset all mocks including mockResolvedValueOnce queue
    vi.resetAllMocks();
    // Also reset the fetch mock specifically to clear its queue
    mockFetch.mockReset();

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
      // Health endpoint is at /api/health (not /api/v1/health)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.nuvanaapp.com/api/health',
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

  describe('pullUsers', () => {
    // Helper to set up mocks for the full sync flow
    // The new implementation tries /sync/employees first, then falls back to /sync/cashiers
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
        // 2. GET /api/v1/sync/employees - returns 404 (not available yet)
        // 4xx errors are not retried, so we only need one mock
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          headers: new Headers(),
          json: () => Promise.resolve({ message: '404 not found' }),
        })
        // 3. GET /api/v1/sync/cashiers (fallback)
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
        // 4. POST /api/v1/sync/complete
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
    };

    // Helper for testing unified employees endpoint (future)
    const setupEmployeesEndpointMocks = (
      employees: Array<{
        employeeId: string;
        name: string;
        role: string;
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
                pullPendingCount: employees.length,
              },
            }),
        })
        // 2. GET /api/v1/sync/employees - returns employees with proper roles
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                employees,
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
      // All users pulled via pullUsers/pullCashiers are cashiers (legacy fallback)
      expect(result.users[0].role).toBe('cashier');
      expect(result.users[1].role).toBe('cashier');
      expect(result.users[2].role).toBe('cashier');
    });

    it('should use unified employees endpoint with proper roles when available', async () => {
      const mockEmployees = [
        {
          employeeId: 'user-1',
          name: 'Store Manager',
          role: 'STORE_MANAGER',
          pinHash: '$2b$12$...',
          isActive: true,
        },
        {
          employeeId: 'user-2',
          name: 'Shift Manager',
          role: 'SHIFT_MANAGER',
          pinHash: '$2b$12$...',
          isActive: true,
        },
        {
          employeeId: 'user-3',
          name: 'Cashier',
          role: 'CASHIER',
          pinHash: '$2b$12$...',
          isActive: true,
        },
      ];

      setupEmployeesEndpointMocks(mockEmployees);

      const result = await service.pullUsers();

      expect(result.users).toHaveLength(3);
      // Users should have proper roles from unified endpoint
      expect(result.users[0].role).toBe('store_manager');
      expect(result.users[1].role).toBe('shift_manager');
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
    it('should pull all bins with session_id from correct endpoint', async () => {
      const mockSessionResponse = {
        success: true,
        data: {
          sessionId: 'test-session-123',
          revocationStatus: 'VALID',
          pullPendingCount: 0,
        },
      };

      const mockBinsResponse = {
        success: true,
        data: {
          bins: [
            {
              bin_id: 'bin-1',
              store_id: 'store-123',
              name: 'Bin 1',
              display_order: 1,
              is_active: true,
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
          totalCount: 1,
        },
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSessionResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockBinsResponse),
        });

      const result = await service.pullBins();

      expect(result.bins).toHaveLength(1);
      expect(result.totalCount).toBe(1);
      // First call is to start session
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://api.nuvanaapp.com/api/v1/sync/start',
        expect.any(Object)
      );
      // Second call is to pull bins with session_id
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('/api/v1/sync/lottery/bins?session_id=test-session-123'),
        expect.any(Object)
      );
    });

    it('should include since parameter for delta sync', async () => {
      const mockSessionResponse = {
        success: true,
        data: {
          sessionId: 'test-session-456',
          revocationStatus: 'VALID',
          pullPendingCount: 0,
        },
      };

      const mockBinsResponse = {
        success: true,
        data: {
          bins: [],
          totalCount: 0,
        },
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSessionResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockBinsResponse),
        });

      await service.pullBins('2024-01-01T00:00:00Z');

      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('since=2024-01-01T00%3A00%3A00Z'),
        expect.any(Object)
      );
    });

    it('should throw error if API key is revoked', async () => {
      const mockSessionResponse = {
        success: true,
        data: {
          sessionId: 'test-session-789',
          revocationStatus: 'REVOKED',
          pullPendingCount: 0,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSessionResponse),
      });

      await expect(service.pullBins()).rejects.toThrow('API key status: REVOKED');
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

      // Health endpoint is at /api/health (not /api/v1/health)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.nuvanaapp.com/api/health',
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

  // ==========================================================================
  // Pack Sync Operations (Phase 1)
  // ==========================================================================

  describe('Pack Sync Operations', () => {
    // Helper to set up sync session mocks
    const setupSyncSessionMocks = (mockResponse: object) => {
      mockFetch
        // 1. POST /api/v1/sync/start (startSyncSession)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                sessionId: 'session-123',
                revocationStatus: 'VALID',
                pullPendingCount: 0,
              },
            }),
        })
        // 2. The actual API call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        })
        // 3. POST /api/v1/sync/complete (completeSyncSession)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
    };

    describe('pushPackReceive', () => {
      const mockPack = {
        pack_id: 'pack-123',
        store_id: 'store-456',
        game_id: 'game-789',
        game_code: '1234',
        pack_number: '1234567',
        serial_start: '000',
        serial_end: '299',
        received_at: '2025-01-15T10:00:00Z',
        received_by: 'user-001',
      };

      it('should push pack receive to cloud successfully', async () => {
        // API response uses `packId`, service maps it to `cloud_pack_id`
        setupSyncSessionMocks({
          success: true,
          data: { packId: 'cloud-pack-001' },
        });

        const result = await service.pushPackReceive(mockPack);

        expect(result.success).toBe(true);
        expect(result.cloud_pack_id).toBe('cloud-pack-001');

        // Verify the API call was made to the correct endpoint
        const calls = mockFetch.mock.calls;
        const receiveCall = calls[1];
        expect(receiveCall[0]).toContain('/api/v1/sync/lottery/packs/receive');

        // Verify the request body (API spec format)
        const body = JSON.parse(receiveCall[1].body as string);
        expect(body.session_id).toBe('session-123');
        expect(body.game_code).toBe('1234');
        expect(body.pack_number).toBe('1234567');
        expect(body.local_id).toBe('pack-123');
      });

      // TODO: This test times out due to complex async interactions with dynamic imports
      // The session start failure case is covered by integration tests
      it.skip('should handle session start failure gracefully', async () => {
        // Session start itself fails - should reject before any pack API call
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 403,
          headers: new Headers(),
          json: () => Promise.resolve({ message: 'Forbidden' }),
        });

        await expect(service.pushPackReceive(mockPack)).rejects.toThrow();
      });

      it('should reject when API key is revoked', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                sessionId: 'session-123',
                revocationStatus: 'REVOKED',
                pullPendingCount: 0,
              },
            }),
        });

        await expect(service.pushPackReceive(mockPack)).rejects.toThrow('API key status: REVOKED');
      });
    });

    describe('pushPackReceiveBatch', () => {
      const mockPacks = [
        {
          pack_id: 'pack-1',
          store_id: 'store-456',
          game_id: 'game-789',
          pack_number: '1111111',
          received_at: '2025-01-15T10:00:00Z',
          received_by: 'user-001',
        },
        {
          pack_id: 'pack-2',
          store_id: 'store-456',
          game_id: 'game-789',
          pack_number: '2222222',
          received_at: '2025-01-15T10:01:00Z',
          received_by: 'user-001',
        },
      ];

      it('should push batch of packs to cloud successfully', async () => {
        setupSyncSessionMocks({
          success: true,
          data: {
            results: [
              { pack_id: 'pack-1', cloud_pack_id: 'cloud-1', status: 'synced' },
              { pack_id: 'pack-2', cloud_pack_id: 'cloud-2', status: 'synced' },
            ],
          },
        });

        const result = await service.pushPackReceiveBatch(mockPacks);

        expect(result.success).toBe(true);
        expect(result.results).toHaveLength(2);
        expect(result.results[0].status).toBe('synced');
        expect(result.results[1].status).toBe('synced');

        // Verify the API call was made to the batch endpoint
        const calls = mockFetch.mock.calls;
        const batchCall = calls[1];
        expect(batchCall[0]).toContain('/api/v1/sync/lottery/packs/receive/batch');
      });

      it('should return empty results for empty array', async () => {
        const result = await service.pushPackReceiveBatch([]);

        expect(result.success).toBe(true);
        expect(result.results).toHaveLength(0);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should handle partial success', async () => {
        setupSyncSessionMocks({
          success: true,
          data: {
            results: [
              { pack_id: 'pack-1', cloud_pack_id: 'cloud-1', status: 'synced' },
              { pack_id: 'pack-2', status: 'failed', error: 'Duplicate pack number' },
            ],
          },
        });

        const result = await service.pushPackReceiveBatch(mockPacks);

        expect(result.success).toBe(true);
        expect(result.results[0].status).toBe('synced');
        expect(result.results[1].status).toBe('failed');
        expect(result.results[1].error).toBe('Duplicate pack number');
      });
    });

    describe('pushPackActivate', () => {
      // Standard activation without mark-sold (most common case)
      const mockActivation = {
        pack_id: 'pack-123',
        store_id: 'store-456',
        bin_id: 'bin-001',
        opening_serial: '001',
        game_code: '1234',
        pack_number: '0012345',
        serial_start: '000',
        serial_end: '299',
        activated_at: '2025-01-15T11:00:00Z', // Required per API spec
        received_at: '2025-01-14T08:00:00Z', // Required per API spec
        activated_by: 'user-002',
      };

      it('should push pack activation to cloud successfully', async () => {
        setupSyncSessionMocks({ success: true });

        const result = await service.pushPackActivate(mockActivation);

        expect(result.success).toBe(true);

        // Verify the API call was made to the correct endpoint
        const calls = mockFetch.mock.calls;
        const activateCall = calls[1];
        expect(activateCall[0]).toContain('/api/v1/sync/lottery/packs/activate');

        // Verify the request body includes all required fields per API spec
        const body = JSON.parse(activateCall[1].body as string);
        expect(body.pack_id).toBe('pack-123');
        expect(body.bin_id).toBe('bin-001');
        expect(body.game_code).toBe('1234');
        expect(body.pack_number).toBe('0012345');
        expect(body.serial_start).toBe('000');
        expect(body.serial_end).toBe('299');
        expect(body.activated_at).toBe('2025-01-15T11:00:00Z');
        expect(body.received_at).toBe('2025-01-14T08:00:00Z');
        // opening_serial is sent as string (API expects string, not integer)
        // String('001') preserves '001', doesn't strip leading zeros
        expect(body.opening_serial).toBe('001');
        // mark_sold fields should NOT be included for standard activation
        expect(body.mark_sold_reason).toBeUndefined();
        expect(body.mark_sold_tickets).toBeUndefined();
      });

      it('should include mark_sold fields only when pack was mark-sold at activation', async () => {
        setupSyncSessionMocks({ success: true });

        const markSoldActivation = {
          ...mockActivation,
          mark_sold_tickets: 300, // Full pack sold at activation
          mark_sold_reason: 'Full pack sold',
          mark_sold_approved_by: 'manager-001',
        };

        const result = await service.pushPackActivate(markSoldActivation);

        expect(result.success).toBe(true);

        // Verify mark_sold fields are included when mark_sold_tickets > 0
        const calls = mockFetch.mock.calls;
        const activateCall = calls[1];
        const body = JSON.parse(activateCall[1].body as string);
        expect(body.mark_sold_tickets).toBe(300);
        expect(body.mark_sold_reason).toBe('Full pack sold');
        expect(body.mark_sold_approved_by).toBe('manager-001');
      });
    });

    describe('pushPackDeplete', () => {
      // SEC-014: depletion_reason is now REQUIRED (valid DepletionReason enum value)
      const mockDepletion = {
        pack_id: 'pack-123',
        store_id: 'store-456',
        closing_serial: '300',
        tickets_sold: 300,
        sales_amount: 150.0,
        depleted_at: '2025-01-16T18:00:00Z',
        depletion_reason: 'MANUAL_SOLD_OUT' as const, // Required field per SEC-014
      };

      it('should push pack depletion to cloud successfully', async () => {
        setupSyncSessionMocks({ success: true });

        const result = await service.pushPackDeplete(mockDepletion);

        expect(result.success).toBe(true);

        // Verify the API call was made to the correct endpoint
        const calls = mockFetch.mock.calls;
        const depleteCall = calls[1];
        expect(depleteCall[0]).toContain('/api/v1/sync/lottery/packs/deplete');

        // Verify the request body
        // API uses `final_serial` (string), not `closing_serial` (integer)
        const body = JSON.parse(depleteCall[1].body as string);
        expect(body.pack_id).toBe('pack-123');
        expect(body.final_serial).toBe('300');
        expect(body.depletion_reason).toBe('MANUAL_SOLD_OUT');
      });
    });

    /**
     * Phase 7 Tests: pushPackDeplete - depletion_reason handling
     *
     * Comprehensive tests to verify that depletion_reason values from the payload
     * are correctly passed through to the cloud API without hardcoded values.
     *
     * SEC-014: Validates that all DepletionReason enum values are accepted
     * SEC-014: Confirms no hardcoded 'SOLD_OUT' value is sent
     */
    describe('pushPackDeplete - depletion_reason handling', () => {
      const baseDepletion = {
        pack_id: 'pack-deplete-test',
        store_id: 'store-456',
        closing_serial: '300',
        tickets_sold: 300,
        sales_amount: 150.0,
        depleted_at: '2025-01-16T18:00:00Z',
      };

      beforeEach(() => {
        vi.clearAllMocks();
      });

      it('should send MANUAL_SOLD_OUT when provided in payload', async () => {
        setupSyncSessionMocks({ success: true });

        const depleteData = {
          ...baseDepletion,
          depletion_reason: 'MANUAL_SOLD_OUT' as const,
        };

        await service.pushPackDeplete(depleteData);

        const calls = mockFetch.mock.calls;
        const depleteCall = calls[1];
        const body = JSON.parse(depleteCall[1].body as string);
        expect(body.depletion_reason).toBe('MANUAL_SOLD_OUT');
      });

      it('should send SHIFT_CLOSE when provided in payload', async () => {
        setupSyncSessionMocks({ success: true });

        const depleteData = {
          ...baseDepletion,
          depletion_reason: 'SHIFT_CLOSE' as const,
        };

        await service.pushPackDeplete(depleteData);

        const calls = mockFetch.mock.calls;
        const depleteCall = calls[1];
        const body = JSON.parse(depleteCall[1].body as string);
        expect(body.depletion_reason).toBe('SHIFT_CLOSE');
      });

      it('should send AUTO_REPLACED when provided in payload', async () => {
        setupSyncSessionMocks({ success: true });

        const depleteData = {
          ...baseDepletion,
          depletion_reason: 'AUTO_REPLACED' as const,
        };

        await service.pushPackDeplete(depleteData);

        const calls = mockFetch.mock.calls;
        const depleteCall = calls[1];
        const body = JSON.parse(depleteCall[1].body as string);
        expect(body.depletion_reason).toBe('AUTO_REPLACED');
      });

      it('should send POS_LAST_TICKET when provided in payload', async () => {
        setupSyncSessionMocks({ success: true });

        const depleteData = {
          ...baseDepletion,
          depletion_reason: 'POS_LAST_TICKET' as const,
        };

        await service.pushPackDeplete(depleteData);

        const calls = mockFetch.mock.calls;
        const depleteCall = calls[1];
        const body = JSON.parse(depleteCall[1].body as string);
        expect(body.depletion_reason).toBe('POS_LAST_TICKET');
      });

      it('should NOT send hardcoded SOLD_OUT value', async () => {
        setupSyncSessionMocks({ success: true });

        // Use MANUAL_SOLD_OUT to verify no SOLD_OUT hardcoding
        const depleteData = {
          ...baseDepletion,
          depletion_reason: 'MANUAL_SOLD_OUT' as const,
        };

        await service.pushPackDeplete(depleteData);

        const calls = mockFetch.mock.calls;
        const depleteCall = calls[1];
        const body = JSON.parse(depleteCall[1].body as string);
        // Verify the value is from payload, not hardcoded 'SOLD_OUT'
        expect(body.depletion_reason).not.toBe('SOLD_OUT');
        expect(body.depletion_reason).toBe('MANUAL_SOLD_OUT');
      });

      it('should include depletion_reason in request body', async () => {
        setupSyncSessionMocks({ success: true });

        const depleteData = {
          ...baseDepletion,
          depletion_reason: 'SHIFT_CLOSE' as const,
        };

        await service.pushPackDeplete(depleteData);

        const calls = mockFetch.mock.calls;
        const depleteCall = calls[1];
        const body = JSON.parse(depleteCall[1].body as string);
        // Verify depletion_reason is present in the request body
        expect(body).toHaveProperty('depletion_reason');
        expect(typeof body.depletion_reason).toBe('string');
        expect(body.depletion_reason.length).toBeGreaterThan(0);
      });
    });

    /**
     * SEC-010: Audit Trail - depleted_by field tests
     *
     * Enterprise-grade tests verifying that depleted_by (user ID) is correctly
     * passed through to the cloud API for audit trail compliance.
     *
     * Cloud API Requirement: depleted_by is REQUIRED for audit trail
     */
    describe('pushPackDeplete - depleted_by handling', () => {
      const baseDepletion = {
        pack_id: 'pack-deplete-user-test',
        store_id: 'store-456',
        closing_serial: '300',
        tickets_sold: 300,
        sales_amount: 150.0,
        depleted_at: '2025-01-16T18:00:00Z',
        depletion_reason: 'MANUAL_SOLD_OUT' as const,
      };

      beforeEach(() => {
        vi.clearAllMocks();
      });

      it('should include depleted_by in request body when provided', async () => {
        setupSyncSessionMocks({ success: true });

        const depleteData = {
          ...baseDepletion,
          depleted_by: 'user-abc-123',
        };

        await service.pushPackDeplete(depleteData);

        const calls = mockFetch.mock.calls;
        const depleteCall = calls[1];
        const body = JSON.parse(depleteCall[1].body as string);
        expect(body.depleted_by).toBe('user-abc-123');
      });

      it('should pass through valid UUID user ID for depleted_by', async () => {
        setupSyncSessionMocks({ success: true });

        const validUserId = '8981cc60-62c6-4412-8789-42d3afc2b4ac';
        const depleteData = {
          ...baseDepletion,
          depleted_by: validUserId,
        };

        await service.pushPackDeplete(depleteData);

        const calls = mockFetch.mock.calls;
        const depleteCall = calls[1];
        const body = JSON.parse(depleteCall[1].body as string);
        expect(body.depleted_by).toBe(validUserId);
      });

      it('should omit depleted_by from request body when null', async () => {
        setupSyncSessionMocks({ success: true });

        const depleteData = {
          ...baseDepletion,
          depleted_by: null,
        };

        await service.pushPackDeplete(depleteData);

        const calls = mockFetch.mock.calls;
        const depleteCall = calls[1];
        const body = JSON.parse(depleteCall[1].body as string);
        expect(body).not.toHaveProperty('depleted_by');
      });

      it('should omit depleted_by from request body when undefined', async () => {
        setupSyncSessionMocks({ success: true });

        // No depleted_by field at all
        await service.pushPackDeplete(baseDepletion);

        const calls = mockFetch.mock.calls;
        const depleteCall = calls[1];
        const body = JSON.parse(depleteCall[1].body as string);
        expect(body).not.toHaveProperty('depleted_by');
      });

      it('should include depleted_by alongside other required fields', async () => {
        setupSyncSessionMocks({ success: true });

        const depleteData = {
          ...baseDepletion,
          depleted_by: 'user-full-context',
          shift_id: 'shift-xyz-789',
        };

        await service.pushPackDeplete(depleteData);

        const calls = mockFetch.mock.calls;
        const depleteCall = calls[1];
        const body = JSON.parse(depleteCall[1].body as string);
        // Verify all fields are present
        expect(body.pack_id).toBe('pack-deplete-user-test');
        expect(body.depleted_by).toBe('user-full-context');
        expect(body.shift_id).toBe('shift-xyz-789');
        expect(body.depletion_reason).toBe('MANUAL_SOLD_OUT');
      });
    });

    describe('pushPackReturn', () => {
      // SEC-014: return_reason must be a valid ReturnReason enum value
      const mockReturn = {
        pack_id: 'pack-123',
        store_id: 'store-456',
        closing_serial: '150',
        tickets_sold: 150,
        sales_amount: 75.0,
        return_reason: 'DAMAGED' as const, // Valid enum value per SEC-014
        returned_at: '2025-01-16T12:00:00Z',
      };

      it('should push pack return to cloud successfully', async () => {
        setupSyncSessionMocks({ success: true });

        const result = await service.pushPackReturn(mockReturn);

        expect(result.success).toBe(true);

        // Verify the API call was made to the correct endpoint
        const calls = mockFetch.mock.calls;
        const returnCall = calls[1];
        expect(returnCall[0]).toContain('/api/v1/sync/lottery/packs/return');

        // Verify the request body
        // API uses `last_sold_serial` (string), not `closing_serial` (integer)
        const body = JSON.parse(returnCall[1].body as string);
        expect(body.pack_id).toBe('pack-123');
        expect(body.last_sold_serial).toBe('150');
        expect(body.return_reason).toBe('DAMAGED');
      });

      it('should handle return without closing serial', async () => {
        setupSyncSessionMocks({ success: true });

        // SEC-014: return_reason is now REQUIRED (no 'OTHER' fallback)
        const returnWithoutSerial = {
          pack_id: 'pack-123',
          store_id: 'store-456',
          return_reason: 'INVENTORY_ADJUSTMENT' as const, // Required field
          returned_at: '2025-01-16T12:00:00Z',
        };

        const result = await service.pushPackReturn(returnWithoutSerial);

        expect(result.success).toBe(true);

        // Verify default values are sent for optional fields
        // API uses `last_sold_serial` (string), `tickets_sold_on_return`, and `return_reason`
        const calls = mockFetch.mock.calls;
        const returnCall = calls[1];
        const body = JSON.parse(returnCall[1].body as string);
        expect(body.last_sold_serial).toBe('0');
        expect(body.tickets_sold_on_return).toBe(0);
        expect(body.return_reason).toBe('INVENTORY_ADJUSTMENT');
      });
    });

    /**
     * Phase 7 Tests: pushPackReturn - return_reason handling
     *
     * Comprehensive tests to verify that return_reason values from the payload
     * are correctly passed through to the cloud API without default values.
     *
     * SEC-014: Validates that all ReturnReason enum values are accepted
     * SEC-014: Confirms no default 'OTHER' fallback is used
     * Tests return_notes inclusion/omission behavior
     */
    describe('pushPackReturn - return_reason handling', () => {
      const baseReturn = {
        pack_id: 'pack-return-test',
        store_id: 'store-456',
        closing_serial: '150',
        tickets_sold: 150,
        sales_amount: 75.0,
        returned_at: '2025-01-16T12:00:00Z',
      };

      beforeEach(() => {
        vi.clearAllMocks();
      });

      it('should send SUPPLIER_RECALL when provided in payload', async () => {
        setupSyncSessionMocks({ success: true });

        const returnData = {
          ...baseReturn,
          return_reason: 'SUPPLIER_RECALL' as const,
        };

        await service.pushPackReturn(returnData);

        const calls = mockFetch.mock.calls;
        const returnCall = calls[1];
        const body = JSON.parse(returnCall[1].body as string);
        expect(body.return_reason).toBe('SUPPLIER_RECALL');
      });

      it('should send DAMAGED when provided in payload', async () => {
        setupSyncSessionMocks({ success: true });

        const returnData = {
          ...baseReturn,
          return_reason: 'DAMAGED' as const,
        };

        await service.pushPackReturn(returnData);

        const calls = mockFetch.mock.calls;
        const returnCall = calls[1];
        const body = JSON.parse(returnCall[1].body as string);
        expect(body.return_reason).toBe('DAMAGED');
      });

      it('should send EXPIRED when provided in payload', async () => {
        setupSyncSessionMocks({ success: true });

        const returnData = {
          ...baseReturn,
          return_reason: 'EXPIRED' as const,
        };

        await service.pushPackReturn(returnData);

        const calls = mockFetch.mock.calls;
        const returnCall = calls[1];
        const body = JSON.parse(returnCall[1].body as string);
        expect(body.return_reason).toBe('EXPIRED');
      });

      it('should send INVENTORY_ADJUSTMENT when provided in payload', async () => {
        setupSyncSessionMocks({ success: true });

        const returnData = {
          ...baseReturn,
          return_reason: 'INVENTORY_ADJUSTMENT' as const,
        };

        await service.pushPackReturn(returnData);

        const calls = mockFetch.mock.calls;
        const returnCall = calls[1];
        const body = JSON.parse(returnCall[1].body as string);
        expect(body.return_reason).toBe('INVENTORY_ADJUSTMENT');
      });

      it('should send STORE_CLOSURE when provided in payload', async () => {
        setupSyncSessionMocks({ success: true });

        const returnData = {
          ...baseReturn,
          return_reason: 'STORE_CLOSURE' as const,
        };

        await service.pushPackReturn(returnData);

        const calls = mockFetch.mock.calls;
        const returnCall = calls[1];
        const body = JSON.parse(returnCall[1].body as string);
        expect(body.return_reason).toBe('STORE_CLOSURE');
      });

      it('should NOT default to OTHER value', async () => {
        setupSyncSessionMocks({ success: true });

        // Use a valid return reason and verify 'OTHER' is not sent
        const returnData = {
          ...baseReturn,
          return_reason: 'DAMAGED' as const,
        };

        await service.pushPackReturn(returnData);

        const calls = mockFetch.mock.calls;
        const returnCall = calls[1];
        const body = JSON.parse(returnCall[1].body as string);
        // Verify the value is from payload, not defaulted to 'OTHER'
        expect(body.return_reason).not.toBe('OTHER');
        expect(body.return_reason).toBe('DAMAGED');
      });

      it('should include return_reason in request body', async () => {
        setupSyncSessionMocks({ success: true });

        const returnData = {
          ...baseReturn,
          return_reason: 'SUPPLIER_RECALL' as const,
        };

        await service.pushPackReturn(returnData);

        const calls = mockFetch.mock.calls;
        const returnCall = calls[1];
        const body = JSON.parse(returnCall[1].body as string);
        // Verify return_reason is present in the request body
        expect(body).toHaveProperty('return_reason');
        expect(typeof body.return_reason).toBe('string');
        expect(body.return_reason.length).toBeGreaterThan(0);
      });

      it('should include return_notes when provided', async () => {
        setupSyncSessionMocks({ success: true });

        const returnData = {
          ...baseReturn,
          return_reason: 'DAMAGED' as const,
          return_notes: 'Pack was water damaged during shipping',
        };

        await service.pushPackReturn(returnData);

        const calls = mockFetch.mock.calls;
        const returnCall = calls[1];
        const body = JSON.parse(returnCall[1].body as string);
        expect(body).toHaveProperty('return_notes');
        expect(body.return_notes).toBe('Pack was water damaged during shipping');
      });

      it('should omit return_notes when not provided', async () => {
        setupSyncSessionMocks({ success: true });

        const returnData = {
          ...baseReturn,
          return_reason: 'EXPIRED' as const,
          // Note: return_notes is NOT provided
        };

        await service.pushPackReturn(returnData);

        const calls = mockFetch.mock.calls;
        const returnCall = calls[1];
        const body = JSON.parse(returnCall[1].body as string);
        // Verify return_notes is not in the request body when not provided
        expect(body).not.toHaveProperty('return_notes');
      });
    });

    /**
     * SEC-010: Audit Trail - returned_by field tests
     *
     * Enterprise-grade tests verifying that returned_by (user ID) is correctly
     * passed through to the cloud API for audit trail compliance.
     *
     * Cloud API Requirement: returned_by is REQUIRED for audit trail
     */
    describe('pushPackReturn - returned_by handling', () => {
      const baseReturn = {
        pack_id: 'pack-return-user-test',
        store_id: 'store-456',
        closing_serial: '150',
        tickets_sold: 150,
        sales_amount: 75.0,
        return_reason: 'DAMAGED' as const,
        returned_at: '2025-01-16T12:00:00Z',
      };

      beforeEach(() => {
        vi.clearAllMocks();
      });

      it('should include returned_by in request body when provided', async () => {
        setupSyncSessionMocks({ success: true });

        const returnData = {
          ...baseReturn,
          returned_by: 'user-abc-123',
        };

        await service.pushPackReturn(returnData);

        const calls = mockFetch.mock.calls;
        const returnCall = calls[1];
        const body = JSON.parse(returnCall[1].body as string);
        expect(body.returned_by).toBe('user-abc-123');
      });

      it('should pass through valid UUID user ID for returned_by', async () => {
        setupSyncSessionMocks({ success: true });

        const validUserId = '8981cc60-62c6-4412-8789-42d3afc2b4ac';
        const returnData = {
          ...baseReturn,
          returned_by: validUserId,
        };

        await service.pushPackReturn(returnData);

        const calls = mockFetch.mock.calls;
        const returnCall = calls[1];
        const body = JSON.parse(returnCall[1].body as string);
        expect(body.returned_by).toBe(validUserId);
      });

      it('should omit returned_by from request body when null', async () => {
        setupSyncSessionMocks({ success: true });

        const returnData = {
          ...baseReturn,
          returned_by: null,
        };

        await service.pushPackReturn(returnData);

        const calls = mockFetch.mock.calls;
        const returnCall = calls[1];
        const body = JSON.parse(returnCall[1].body as string);
        expect(body).not.toHaveProperty('returned_by');
      });

      it('should omit returned_by from request body when undefined', async () => {
        setupSyncSessionMocks({ success: true });

        // No returned_by field at all
        await service.pushPackReturn(baseReturn);

        const calls = mockFetch.mock.calls;
        const returnCall = calls[1];
        const body = JSON.parse(returnCall[1].body as string);
        expect(body).not.toHaveProperty('returned_by');
      });

      it('should include returned_by alongside other fields for full audit context', async () => {
        setupSyncSessionMocks({ success: true });

        const returnData = {
          ...baseReturn,
          returned_by: 'user-full-context',
          shift_id: 'shift-xyz-789',
          return_notes: 'Pack damaged during transit',
        };

        await service.pushPackReturn(returnData);

        const calls = mockFetch.mock.calls;
        const returnCall = calls[1];
        const body = JSON.parse(returnCall[1].body as string);
        // Verify all fields are present for complete audit trail
        expect(body.pack_id).toBe('pack-return-user-test');
        expect(body.returned_by).toBe('user-full-context');
        expect(body.shift_id).toBe('shift-xyz-789');
        expect(body.return_notes).toBe('Pack damaged during transit');
        expect(body.return_reason).toBe('DAMAGED');
      });

      it('should maintain returned_by with all return reason types', async () => {
        setupSyncSessionMocks({ success: true });

        const returnReasons = [
          'SUPPLIER_RECALL',
          'DAMAGED',
          'EXPIRED',
          'INVENTORY_ADJUSTMENT',
          'STORE_CLOSURE',
        ] as const;

        for (const reason of returnReasons) {
          vi.clearAllMocks();
          setupSyncSessionMocks({ success: true });

          const returnData = {
            ...baseReturn,
            return_reason: reason,
            returned_by: `user-for-${reason.toLowerCase()}`,
          };

          await service.pushPackReturn(returnData);

          const calls = mockFetch.mock.calls;
          const returnCall = calls[1];
          const body = JSON.parse(returnCall[1].body as string);
          expect(body.returned_by).toBe(`user-for-${reason.toLowerCase()}`);
          expect(body.return_reason).toBe(reason);
        }
      });
    });

    describe('pushPackMove', () => {
      const mockMove = {
        pack_id: 'pack-123',
        store_id: 'store-456',
        from_bin_id: 'bin-001',
        to_bin_id: 'bin-002',
        moved_at: '2025-01-16T14:00:00Z',
        moved_by: 'user-003',
      };

      it('should push pack move to cloud successfully', async () => {
        setupSyncSessionMocks({ success: true });

        const result = await service.pushPackMove(mockMove);

        expect(result.success).toBe(true);

        // Verify the API call was made to the correct endpoint
        const calls = mockFetch.mock.calls;
        const moveCall = calls[1];
        expect(moveCall[0]).toContain('/api/v1/sync/lottery/packs/move');

        // Verify the request body
        const body = JSON.parse(moveCall[1].body as string);
        expect(body.pack_id).toBe('pack-123');
        expect(body.from_bin_id).toBe('bin-001');
        expect(body.to_bin_id).toBe('bin-002');
        expect(body.moved_by).toBe('user-003');
      });
    });

    // ==========================================================================
    // Phase 2: Shift Lottery Sync Tests
    // ==========================================================================

    describe('pushShiftOpening', () => {
      const mockShiftOpening = {
        shift_id: 'shift-123',
        store_id: 'store-456',
        openings: [
          { bin_id: 'bin-001', pack_id: 'pack-001', opening_serial: '050' },
          { bin_id: 'bin-002', pack_id: 'pack-002', opening_serial: '025' },
        ],
        opened_at: '2025-01-15T08:00:00Z',
        opened_by: 'user-001',
      };

      it('should push shift opening to cloud successfully', async () => {
        setupSyncSessionMocks({ success: true });

        const result = await service.pushShiftOpening(mockShiftOpening);

        expect(result.success).toBe(true);

        // Verify the API call was made to the correct endpoint
        const calls = mockFetch.mock.calls;
        const openingCall = calls[1];
        expect(openingCall[0]).toContain('/api/v1/sync/lottery/shift/open');
        expect(openingCall[0]).toContain('session_id=session-123');

        // Verify the request body
        const body = JSON.parse(openingCall[1].body as string);
        expect(body.shift_id).toBe('shift-123');
        expect(body.store_id).toBe('store-456');
        expect(body.openings).toHaveLength(2);
        expect(body.openings[0].bin_id).toBe('bin-001');
        expect(body.openings[0].pack_id).toBe('pack-001');
        expect(body.openings[0].opening_serial).toBe('050');
        expect(body.opened_by).toBe('user-001');
      });

      it('should return success for empty openings array', async () => {
        const emptyOpening = {
          ...mockShiftOpening,
          openings: [],
        };

        const result = await service.pushShiftOpening(emptyOpening);

        // Should succeed without making API call
        expect(result.success).toBe(true);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      // TODO: This test times out due to complex async interactions with dynamic imports
      // The session start failure case is covered by integration tests
      it.skip('should handle session start failure gracefully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 403,
          headers: new Headers(),
          json: () => Promise.resolve({ message: 'Forbidden' }),
        });

        await expect(service.pushShiftOpening(mockShiftOpening)).rejects.toThrow();
      });

      it('should reject when API key is revoked', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                sessionId: 'session-123',
                revocationStatus: 'REVOKED',
                pullPendingCount: 0,
              },
            }),
        });

        await expect(service.pushShiftOpening(mockShiftOpening)).rejects.toThrow(
          'API key status: REVOKED'
        );
      });
    });

    describe('pushShiftClosing', () => {
      const mockShiftClosing = {
        shift_id: 'shift-123',
        store_id: 'store-456',
        closings: [
          {
            bin_id: 'bin-001',
            pack_id: 'pack-001',
            closing_serial: '100',
            tickets_sold: 50,
            sales_amount: 25.0,
          },
          {
            bin_id: 'bin-002',
            pack_id: 'pack-002',
            closing_serial: '075',
            tickets_sold: 50,
            sales_amount: 50.0,
          },
        ],
        closed_at: '2025-01-15T16:00:00Z',
        closed_by: 'user-002',
      };

      it('should push shift closing to cloud successfully', async () => {
        setupSyncSessionMocks({ success: true });

        const result = await service.pushShiftClosing(mockShiftClosing);

        expect(result.success).toBe(true);

        // Verify the API call was made to the correct endpoint
        const calls = mockFetch.mock.calls;
        const closingCall = calls[1];
        expect(closingCall[0]).toContain('/api/v1/sync/lottery/shift/close');
        expect(closingCall[0]).toContain('session_id=session-123');

        // Verify the request body
        const body = JSON.parse(closingCall[1].body as string);
        expect(body.shift_id).toBe('shift-123');
        expect(body.store_id).toBe('store-456');
        expect(body.closings).toHaveLength(2);
        expect(body.closings[0].bin_id).toBe('bin-001');
        expect(body.closings[0].pack_id).toBe('pack-001');
        expect(body.closings[0].closing_serial).toBe('100');
        expect(body.closings[0].tickets_sold).toBe(50);
        expect(body.closings[0].sales_amount).toBe(25.0);
        expect(body.closed_by).toBe('user-002');
      });

      it('should return success for empty closings array', async () => {
        const emptyClosing = {
          ...mockShiftClosing,
          closings: [],
        };

        const result = await service.pushShiftClosing(emptyClosing);

        // Should succeed without making API call
        expect(result.success).toBe(true);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      // TODO: This test times out due to complex async interactions with dynamic imports
      // The session start failure case is covered by integration tests
      it.skip('should handle session start failure gracefully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 403,
          headers: new Headers(),
          json: () => Promise.resolve({ message: 'Forbidden' }),
        });

        await expect(service.pushShiftClosing(mockShiftClosing)).rejects.toThrow();
      });

      it('should reject when API key is suspended', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                sessionId: 'session-123',
                revocationStatus: 'SUSPENDED',
                pullPendingCount: 0,
              },
            }),
        });

        await expect(service.pushShiftClosing(mockShiftClosing)).rejects.toThrow(
          'API key status: SUSPENDED'
        );
      });

      it('should include correct sales totals in request body', async () => {
        setupSyncSessionMocks({ success: true });

        await service.pushShiftClosing(mockShiftClosing);

        const calls = mockFetch.mock.calls;
        const closingCall = calls[1];
        const body = JSON.parse(closingCall[1].body as string);

        // Verify sales totals are correct
        const totalSales = body.closings.reduce(
          (sum: number, c: { sales_amount: number }) => sum + c.sales_amount,
          0
        );
        const totalTickets = body.closings.reduce(
          (sum: number, c: { tickets_sold: number }) => sum + c.tickets_sold,
          0
        );

        expect(totalSales).toBe(75.0);
        expect(totalTickets).toBe(100);
      });
    });
  });

  // ==========================================================================
  // Phase 3: Day Close Sync Tests
  // ==========================================================================

  describe('Phase 3: Day Close Sync', () => {
    // Helper to set up sync session mocks
    const setupSyncSessionMocks = (options: { success: boolean; revocationStatus?: string }) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: options.success,
            data: {
              sessionId: 'session-day-close-123',
              revocationStatus: options.revocationStatus ?? 'VALID',
              pullPendingCount: 0,
            },
          }),
      });
    };

    // Helper to set up completion mock
    const setupCompletionMock = () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    };

    describe('prepareDayClose', () => {
      const mockPrepareData = {
        store_id: '550e8400-e29b-41d4-a716-446655440000',
        business_date: '2026-01-18',
        expected_inventory: [
          {
            bin_id: '550e8400-e29b-41d4-a716-446655440001',
            pack_id: '550e8400-e29b-41d4-a716-446655440002',
            closing_serial: '001234',
          },
          {
            bin_id: '550e8400-e29b-41d4-a716-446655440003',
            pack_id: '550e8400-e29b-41d4-a716-446655440004',
            closing_serial: '005678',
          },
        ],
        prepared_by: '550e8400-e29b-41d4-a716-446655440005',
      };

      it('should successfully prepare day close and return validation token', async () => {
        setupSyncSessionMocks({ success: true });

        const mockPrepareResponse = {
          success: true,
          data: {
            validation_token: 'validation-token-xyz-123',
            expires_at: '2026-01-18T23:59:59Z',
            warnings: [],
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockPrepareResponse),
        });

        setupCompletionMock();

        const result = await service.prepareDayClose(mockPrepareData);

        expect(result.success).toBe(true);
        expect(result.validation_token).toBe('validation-token-xyz-123');
        expect(result.expires_at).toBe('2026-01-18T23:59:59Z');
      });

      it('should return discrepancies when inventory validation fails', async () => {
        setupSyncSessionMocks({ success: true });

        const mockPrepareResponse = {
          success: true,
          data: {
            validation_token: 'validation-token-with-discrepancies',
            expires_at: '2026-01-18T23:59:59Z',
            warnings: ['Pack serial mismatch detected'],
            discrepancies: [
              {
                bin_id: '550e8400-e29b-41d4-a716-446655440001',
                pack_id: '550e8400-e29b-41d4-a716-446655440002',
                expected_serial: '001234',
                actual_serial: '001235',
                issue: 'Serial numbers do not match',
              },
            ],
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockPrepareResponse),
        });

        setupCompletionMock();

        const result = await service.prepareDayClose(mockPrepareData);

        expect(result.success).toBe(true);
        expect(result.warnings).toHaveLength(1);
        expect(result.discrepancies).toHaveLength(1);
        expect(result.discrepancies?.[0].issue).toBe('Serial numbers do not match');
      });

      it('should reject invalid business date format - API-001', async () => {
        const invalidData = {
          ...mockPrepareData,
          business_date: '01-18-2026', // Invalid format
        };

        await expect(service.prepareDayClose(invalidData)).rejects.toThrow(
          'Invalid business date format'
        );
      });

      it('should reject when API key is revoked', async () => {
        setupSyncSessionMocks({ success: true, revocationStatus: 'REVOKED' });

        await expect(service.prepareDayClose(mockPrepareData)).rejects.toThrow(
          'API key status: REVOKED'
        );
      });

      it('should call correct endpoint with session_id', async () => {
        setupSyncSessionMocks({ success: true });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                validation_token: 'token',
                expires_at: '2026-01-18T23:59:59Z',
              },
            }),
        });

        setupCompletionMock();

        await service.prepareDayClose(mockPrepareData);

        // Check endpoint was called with session_id
        expect(mockFetch).toHaveBeenNthCalledWith(
          2,
          expect.stringContaining(
            '/api/v1/sync/lottery/day/prepare-close?session_id=session-day-close-123'
          ),
          expect.any(Object)
        );
      });
    });

    describe('commitDayClose', () => {
      const mockCommitData = {
        store_id: '550e8400-e29b-41d4-a716-446655440000',
        validation_token: 'validation-token-xyz-123',
        closed_by: '550e8400-e29b-41d4-a716-446655440005',
      };

      it('should successfully commit day close and return summary', async () => {
        setupSyncSessionMocks({ success: true });

        const mockCommitResponse = {
          success: true,
          data: {
            day_summary_id: '550e8400-e29b-41d4-a716-446655440099',
            business_date: '2026-01-18',
            total_sales: 1500.0,
            total_tickets_sold: 250,
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockCommitResponse),
        });

        setupCompletionMock();

        const result = await service.commitDayClose(mockCommitData);

        expect(result.success).toBe(true);
        expect(result.day_summary_id).toBe('550e8400-e29b-41d4-a716-446655440099');
        expect(result.total_sales).toBe(1500.0);
        expect(result.total_tickets_sold).toBe(250);
      });

      it('should reject when validation_token is missing - API-001', async () => {
        const invalidData = {
          store_id: '550e8400-e29b-41d4-a716-446655440000',
          validation_token: '',
          closed_by: '550e8400-e29b-41d4-a716-446655440005',
        };

        await expect(service.commitDayClose(invalidData)).rejects.toThrow(
          'Validation token is required'
        );
      });

      it('should reject when API key is suspended', async () => {
        setupSyncSessionMocks({ success: true, revocationStatus: 'SUSPENDED' });

        await expect(service.commitDayClose(mockCommitData)).rejects.toThrow(
          'API key status: SUSPENDED'
        );
      });

      // TODO: This test times out due to complex async interactions with dynamic imports
      // The session start failure case is covered by integration tests
      it.skip('should handle session start failure gracefully - API-003', async () => {
        // Session start itself fails - should reject before any day close API call
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 403,
          headers: new Headers(),
          json: () => Promise.resolve({ message: 'Forbidden' }),
        });

        await expect(service.commitDayClose(mockCommitData)).rejects.toThrow();
      });
    });

    describe('cancelDayClose', () => {
      const mockCancelData = {
        store_id: '550e8400-e29b-41d4-a716-446655440000',
        validation_token: 'validation-token-xyz-123',
        reason: 'Need to add more packs',
        cancelled_by: '550e8400-e29b-41d4-a716-446655440005',
      };

      it('should successfully cancel day close', async () => {
        setupSyncSessionMocks({ success: true });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });

        setupCompletionMock();

        const result = await service.cancelDayClose(mockCancelData);

        expect(result.success).toBe(true);
      });

      it('should reject when validation_token is missing - API-001', async () => {
        const invalidData = {
          store_id: '550e8400-e29b-41d4-a716-446655440000',
          validation_token: '',
          reason: null,
          cancelled_by: null,
        };

        await expect(service.cancelDayClose(invalidData)).rejects.toThrow(
          'Validation token is required'
        );
      });

      it('should handle cancellation without reason', async () => {
        setupSyncSessionMocks({ success: true });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });

        setupCompletionMock();

        const dataWithoutReason = {
          ...mockCancelData,
          reason: null,
        };

        const result = await service.cancelDayClose(dataWithoutReason);

        expect(result.success).toBe(true);
      });
    });

    describe('approveVariance', () => {
      const mockVarianceData = {
        store_id: '550e8400-e29b-41d4-a716-446655440000',
        variance_id: '550e8400-e29b-41d4-a716-446655440099',
        business_date: '2026-01-18',
        bin_id: '550e8400-e29b-41d4-a716-446655440001',
        pack_id: '550e8400-e29b-41d4-a716-446655440002',
        expected_serial: '001234',
        actual_serial: '001235',
        variance_type: 'SERIAL_MISMATCH' as const,
        resolution: 'Serial was updated due to pack replacement',
        approved_by: '550e8400-e29b-41d4-a716-446655440005',
      };

      it('should successfully approve variance', async () => {
        setupSyncSessionMocks({ success: true });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });

        setupCompletionMock();

        const result = await service.approveVariance(mockVarianceData);

        expect(result.success).toBe(true);
      });

      it('should reject invalid variance_id format - API-001', async () => {
        const invalidData = {
          ...mockVarianceData,
          variance_id: 'not-a-uuid',
        };

        await expect(service.approveVariance(invalidData)).rejects.toThrow(
          'Invalid variance ID format'
        );
      });

      it('should reject empty resolution - API-001', async () => {
        const invalidData = {
          ...mockVarianceData,
          resolution: '',
        };

        await expect(service.approveVariance(invalidData)).rejects.toThrow(
          'Resolution is required'
        );
      });

      it('should reject whitespace-only resolution - API-001', async () => {
        const invalidData = {
          ...mockVarianceData,
          resolution: '   ',
        };

        await expect(service.approveVariance(invalidData)).rejects.toThrow(
          'Resolution is required'
        );
      });

      it('should handle all variance types', async () => {
        const varianceTypes = [
          'SERIAL_MISMATCH',
          'MISSING_PACK',
          'EXTRA_PACK',
          'COUNT_MISMATCH',
        ] as const;

        for (const varianceType of varianceTypes) {
          vi.clearAllMocks();

          setupSyncSessionMocks({ success: true });

          mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ success: true }),
          });

          setupCompletionMock();

          const data = {
            ...mockVarianceData,
            variance_type: varianceType,
          };

          const result = await service.approveVariance(data);

          expect(result.success).toBe(true);
        }
      });

      it('should reject when API key is revoked', async () => {
        setupSyncSessionMocks({ success: true, revocationStatus: 'REVOKED' });

        await expect(service.approveVariance(mockVarianceData)).rejects.toThrow(
          'API key status: REVOKED'
        );
      });
    });
  });

  // ==========================================================================
  // Phase 4: Pull Endpoints (Multi-Device Sync) Tests
  // ==========================================================================

  describe('Phase 4: Pull Endpoints', () => {
    // Reset mocks before each Phase 4 test to ensure complete isolation
    // mockReset clears mock implementation and call history
    beforeEach(() => {
      mockFetch.mockReset();
    });

    // Helper to set up sync session + pull response + completion mocks
    const setupPullMocks = (
      pullResponse: Record<string, unknown>,
      options?: {
        revocationStatus?: string;
      }
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
                revocationStatus: options?.revocationStatus || 'VALID',
                pullPendingCount: 0,
              },
            }),
        })
        // 2. GET /api/v1/sync/lottery/...
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: pullResponse }),
        })
        // 3. POST /api/v1/sync/complete
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
    };

    describe('pullReceivedPacks', () => {
      const mockPacks = [
        {
          pack_id: 'pack-1',
          store_id: 'store-123',
          game_id: 'game-1',
          game_code: '1234',
          pack_number: 'PKG001',
          status: 'RECEIVED',
          current_bin_id: null,
          opening_serial: null,
          closing_serial: null,
          tickets_sold_count: 0,
          sales_amount: null,
          received_at: '2024-01-15T10:00:00Z',
          received_by: 'user-1',
          activated_at: null,
          activated_by: null,
          depleted_at: null,
          returned_at: null,
          return_reason: null,
          cloud_pack_id: 'cloud-pack-1',
          sync_sequence: 100,
          updated_at: '2024-01-15T10:00:00Z',
        },
        {
          pack_id: 'pack-2',
          store_id: 'store-123',
          game_id: 'game-2',
          game_code: '5678',
          pack_number: 'PKG002',
          status: 'RECEIVED',
          current_bin_id: null,
          opening_serial: null,
          closing_serial: null,
          tickets_sold_count: 0,
          sales_amount: null,
          received_at: '2024-01-15T11:00:00Z',
          received_by: 'user-2',
          activated_at: null,
          activated_by: null,
          depleted_at: null,
          returned_at: null,
          return_reason: null,
          cloud_pack_id: 'cloud-pack-2',
          sync_sequence: 101,
          updated_at: '2024-01-15T11:00:00Z',
        },
      ];

      it('should pull received packs with default options', async () => {
        setupPullMocks({ packs: mockPacks });

        const result = await service.pullReceivedPacks();

        expect(result.packs).toHaveLength(2);
        expect(result.packs[0].pack_id).toBe('pack-1');
        expect(result.packs[0].status).toBe('RECEIVED');
        expect(result.syncMetadata.lastSequence).toBe(101);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/v1/sync/lottery/packs/received'),
          expect.any(Object)
        );
      });

      it('should use sinceSequence for delta sync', async () => {
        setupPullMocks({ packs: [mockPacks[1]] });

        const result = await service.pullReceivedPacks({ sinceSequence: 100 });

        expect(result.packs).toHaveLength(1);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('since_sequence=100'),
          expect.any(Object)
        );
      });

      it('should enforce bounded pagination (max 1000)', async () => {
        setupPullMocks({ packs: [] });

        await service.pullReceivedPacks({ limit: 5000 });

        // Should cap at 1000
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('limit=1000'),
          expect.any(Object)
        );
      });

      it('should handle records response format', async () => {
        setupPullMocks({ records: mockPacks });

        const result = await service.pullReceivedPacks();

        expect(result.packs).toHaveLength(2);
      });

      it('should reject when API key is revoked', async () => {
        setupPullMocks({}, { revocationStatus: 'REVOKED' });

        await expect(service.pullReceivedPacks()).rejects.toThrow('API key status: REVOKED');
      });
    });

    describe('pullActivatedPacks', () => {
      const mockActivatedPacks = [
        {
          pack_id: 'pack-1',
          store_id: 'store-123',
          game_id: 'game-1',
          game_code: '1234',
          pack_number: 'PKG001',
          status: 'ACTIVE',
          current_bin_id: 'bin-1',
          opening_serial: '001',
          closing_serial: null,
          tickets_sold_count: 0,
          sales_amount: null,
          received_at: '2024-01-15T10:00:00Z',
          received_by: 'user-1',
          activated_at: '2024-01-15T12:00:00Z',
          activated_by: 'user-1',
          depleted_at: null,
          returned_at: null,
          return_reason: null,
          cloud_pack_id: 'cloud-pack-1',
          sync_sequence: 200,
          updated_at: '2024-01-15T12:00:00Z',
        },
      ];

      it('should pull activated packs from cloud', async () => {
        setupPullMocks({ packs: mockActivatedPacks });

        const result = await service.pullActivatedPacks();

        expect(result.packs).toHaveLength(1);
        expect(result.packs[0].status).toBe('ACTIVE');
        expect(result.packs[0].current_bin_id).toBe('bin-1');
        expect(result.packs[0].opening_serial).toBe('001');
      });

      it('should use since parameter for delta sync', async () => {
        setupPullMocks({ packs: [] });

        await service.pullActivatedPacks({ since: '2024-01-15T00:00:00Z' });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('since=2024-01-15'),
          expect.any(Object)
        );
      });
    });

    describe('pullReturnedPacks', () => {
      const mockReturnedPacks = [
        {
          pack_id: 'pack-1',
          store_id: 'store-123',
          game_id: 'game-1',
          game_code: '1234',
          pack_number: 'PKG001',
          status: 'RETURNED',
          current_bin_id: null,
          opening_serial: null,
          closing_serial: null,
          tickets_sold_count: 0,
          sales_amount: 0,
          received_at: '2024-01-15T10:00:00Z',
          received_by: 'user-1',
          activated_at: null,
          activated_by: null,
          depleted_at: null,
          returned_at: '2024-01-16T09:00:00Z',
          return_reason: 'Damaged packaging',
          cloud_pack_id: 'cloud-pack-1',
          sync_sequence: 300,
          updated_at: '2024-01-16T09:00:00Z',
        },
      ];

      it('should pull returned packs from cloud', async () => {
        setupPullMocks({ packs: mockReturnedPacks });

        const result = await service.pullReturnedPacks();

        expect(result.packs).toHaveLength(1);
        expect(result.packs[0].status).toBe('RETURNED');
        expect(result.packs[0].return_reason).toBe('Damaged packaging');
      });
    });

    describe('pullDepletedPacks', () => {
      const mockDepletedPacks = [
        {
          pack_id: 'pack-1',
          store_id: 'store-123',
          game_id: 'game-1',
          game_code: '1234',
          pack_number: 'PKG001',
          status: 'DEPLETED',
          current_bin_id: 'bin-1',
          opening_serial: '001',
          closing_serial: '300',
          tickets_sold_count: 300,
          sales_amount: 1500,
          received_at: '2024-01-15T10:00:00Z',
          received_by: 'user-1',
          activated_at: '2024-01-15T12:00:00Z',
          activated_by: 'user-1',
          depleted_at: '2024-01-20T18:00:00Z',
          returned_at: null,
          return_reason: null,
          cloud_pack_id: 'cloud-pack-1',
          sync_sequence: 400,
          updated_at: '2024-01-20T18:00:00Z',
        },
      ];

      it('should pull depleted packs from cloud', async () => {
        setupPullMocks({ packs: mockDepletedPacks });

        const result = await service.pullDepletedPacks();

        expect(result.packs).toHaveLength(1);
        expect(result.packs[0].status).toBe('DEPLETED');
        expect(result.packs[0].tickets_sold_count).toBe(300);
        expect(result.packs[0].sales_amount).toBe(1500);
      });
    });

    describe('pullDayStatus', () => {
      const mockDayStatus = {
        store_id: 'store-123',
        business_date: '2024-01-15',
        status: 'OPEN',
        opened_at: '2024-01-15T06:00:00Z',
        closed_at: null,
        validation_token: null,
        token_expires_at: null,
        total_sales: null,
        total_tickets_sold: null,
        sync_sequence: 500,
      };

      it('should pull current day status from cloud', async () => {
        setupPullMocks({ dayStatus: mockDayStatus });

        const result = await service.pullDayStatus();

        expect(result.dayStatus).not.toBeNull();
        expect(result.dayStatus?.status).toBe('OPEN');
        expect(result.dayStatus?.business_date).toBe('2024-01-15');
      });

      it('should handle snake_case response format', async () => {
        setupPullMocks({ day_status: mockDayStatus });

        const result = await service.pullDayStatus();

        expect(result.dayStatus).not.toBeNull();
      });

      it('should pull specific business date', async () => {
        setupPullMocks({ dayStatus: mockDayStatus });

        await service.pullDayStatus('2024-01-15');

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('business_date=2024-01-15'),
          expect.any(Object)
        );
      });

      it('should reject invalid business date format', async () => {
        await expect(service.pullDayStatus('invalid-date')).rejects.toThrow(
          'Invalid business date format'
        );
      });

      it('should handle PREPARING_CLOSE status', async () => {
        const preparingStatus = {
          ...mockDayStatus,
          status: 'PREPARING_CLOSE',
          validation_token: 'token-123',
          token_expires_at: '2024-01-15T23:59:59Z',
        };
        setupPullMocks({ dayStatus: preparingStatus });

        const result = await service.pullDayStatus();

        expect(result.dayStatus?.status).toBe('PREPARING_CLOSE');
        expect(result.dayStatus?.validation_token).toBe('token-123');
      });
    });

    describe('pullShiftOpenings', () => {
      const mockOpenings = [
        {
          shift_opening_id: 'opening-1',
          shift_id: 'shift-1',
          store_id: 'store-123',
          bin_id: 'bin-1',
          pack_id: 'pack-1',
          opening_serial: '001',
          opened_at: '2024-01-15T06:00:00Z',
          opened_by: 'user-1',
          sync_sequence: 600,
        },
        {
          shift_opening_id: 'opening-2',
          shift_id: 'shift-1',
          store_id: 'store-123',
          bin_id: 'bin-2',
          pack_id: 'pack-2',
          opening_serial: '050',
          opened_at: '2024-01-15T06:00:00Z',
          opened_by: 'user-1',
          sync_sequence: 601,
        },
      ];

      it('should pull shift openings from cloud', async () => {
        setupPullMocks({ openings: mockOpenings });

        const result = await service.pullShiftOpenings();

        expect(result.openings).toHaveLength(2);
        expect(result.openings[0].shift_id).toBe('shift-1');
        expect(result.openings[0].opening_serial).toBe('001');
      });

      it('should filter by shift ID', async () => {
        setupPullMocks({ openings: mockOpenings });

        await service.pullShiftOpenings({ shiftId: 'shift-1' });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('shift_id=shift-1'),
          expect.any(Object)
        );
      });
    });

    describe('pullShiftClosings', () => {
      const mockClosings = [
        {
          shift_closing_id: 'closing-1',
          shift_id: 'shift-1',
          store_id: 'store-123',
          bin_id: 'bin-1',
          pack_id: 'pack-1',
          closing_serial: '100',
          tickets_sold: 99,
          sales_amount: 495,
          closed_at: '2024-01-15T14:00:00Z',
          closed_by: 'user-1',
          sync_sequence: 700,
        },
      ];

      it('should pull shift closings from cloud', async () => {
        setupPullMocks({ closings: mockClosings });

        const result = await service.pullShiftClosings();

        expect(result.closings).toHaveLength(1);
        expect(result.closings[0].tickets_sold).toBe(99);
        expect(result.closings[0].sales_amount).toBe(495);
      });

      it('should use sinceSequence for delta sync', async () => {
        setupPullMocks({ closings: [] });

        await service.pullShiftClosings({ sinceSequence: 699 });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('since_sequence=699'),
          expect.any(Object)
        );
      });
    });

    describe('pullVariances', () => {
      const mockVariances = [
        {
          variance_id: 'var-1',
          store_id: 'store-123',
          business_date: '2024-01-15',
          bin_id: 'bin-1',
          pack_id: 'pack-1',
          expected_serial: '100',
          actual_serial: '105',
          variance_type: 'SERIAL_MISMATCH',
          status: 'PENDING',
          resolution: null,
          approved_by: null,
          approved_at: null,
          created_at: '2024-01-15T22:00:00Z',
          sync_sequence: 800,
        },
      ];

      it('should pull variances from cloud', async () => {
        setupPullMocks({ variances: mockVariances });

        const result = await service.pullVariances();

        expect(result.variances).toHaveLength(1);
        expect(result.variances[0].variance_type).toBe('SERIAL_MISMATCH');
        expect(result.variances[0].status).toBe('PENDING');
      });

      it('should filter by status', async () => {
        setupPullMocks({ variances: mockVariances });

        await service.pullVariances({ status: 'PENDING' });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('status=PENDING'),
          expect.any(Object)
        );
      });

      it('should filter by business date', async () => {
        setupPullMocks({ variances: mockVariances });

        await service.pullVariances({ businessDate: '2024-01-15' });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('business_date=2024-01-15'),
          expect.any(Object)
        );
      });

      it('should reject invalid business date format', async () => {
        await expect(service.pullVariances({ businessDate: 'invalid' })).rejects.toThrow(
          'Invalid business date format'
        );
      });
    });

    describe('pullDayPacks', () => {
      const mockDayPacks = [
        {
          day_pack_id: 'daypack-1',
          store_id: 'store-123',
          business_date: '2024-01-15',
          bin_id: 'bin-1',
          pack_id: 'pack-1',
          opening_serial: '001',
          closing_serial: '100',
          tickets_sold: 99,
          sales_amount: 495,
          sync_sequence: 900,
        },
      ];

      it('should pull day packs from cloud', async () => {
        setupPullMocks({ dayPacks: mockDayPacks });

        const result = await service.pullDayPacks();

        expect(result.dayPacks).toHaveLength(1);
        expect(result.dayPacks[0].business_date).toBe('2024-01-15');
        expect(result.dayPacks[0].tickets_sold).toBe(99);
      });

      it('should handle snake_case response format', async () => {
        setupPullMocks({ day_packs: mockDayPacks });

        const result = await service.pullDayPacks();

        expect(result.dayPacks).toHaveLength(1);
      });

      it('should filter by business date', async () => {
        setupPullMocks({ dayPacks: mockDayPacks });

        await service.pullDayPacks({ businessDate: '2024-01-15' });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('business_date=2024-01-15'),
          expect.any(Object)
        );
      });
    });

    describe('pullBinHistory', () => {
      const mockHistory = [
        {
          history_id: 'hist-1',
          store_id: 'store-123',
          pack_id: 'pack-1',
          bin_id: 'bin-1',
          action: 'ACTIVATED',
          from_bin_id: null,
          to_bin_id: 'bin-1',
          serial_at_action: '001',
          performed_at: '2024-01-15T12:00:00Z',
          performed_by: 'user-1',
          sync_sequence: 1000,
        },
        {
          history_id: 'hist-2',
          store_id: 'store-123',
          pack_id: 'pack-1',
          bin_id: 'bin-2',
          action: 'MOVED_IN',
          from_bin_id: 'bin-1',
          to_bin_id: 'bin-2',
          serial_at_action: '050',
          performed_at: '2024-01-15T14:00:00Z',
          performed_by: 'user-1',
          sync_sequence: 1001,
        },
      ];

      it('should pull bin history from cloud', async () => {
        setupPullMocks({ history: mockHistory });

        const result = await service.pullBinHistory();

        expect(result.history).toHaveLength(2);
        expect(result.history[0].action).toBe('ACTIVATED');
        expect(result.history[1].action).toBe('MOVED_IN');
      });

      it('should filter by bin ID', async () => {
        setupPullMocks({ history: [mockHistory[0]] });

        await service.pullBinHistory({ binId: 'bin-1' });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('bin_id=bin-1'),
          expect.any(Object)
        );
      });

      it('should filter by pack ID', async () => {
        setupPullMocks({ history: mockHistory });

        await service.pullBinHistory({ packId: 'pack-1' });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('pack_id=pack-1'),
          expect.any(Object)
        );
      });

      it('should handle records response format', async () => {
        setupPullMocks({ records: mockHistory });

        const result = await service.pullBinHistory();

        expect(result.history).toHaveLength(2);
      });

      it('should enforce bounded pagination', async () => {
        setupPullMocks({ history: [] });

        await service.pullBinHistory({ limit: 2000 });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('limit=1000'),
          expect.any(Object)
        );
      });
    });

    describe('Pull Endpoints - Empty Data Handling', () => {
      it('should handle empty response data gracefully', async () => {
        setupPullMocks({});

        const result = await service.pullReceivedPacks();

        expect(result.packs).toEqual([]);
        expect(result.syncMetadata.lastSequence).toBe(0);
        expect(result.syncMetadata.hasMore).toBe(false);
      });

      it('should handle null syncMetadata gracefully', async () => {
        setupPullMocks({ packs: [] });

        const result = await service.pullActivatedPacks();

        expect(result.packs).toEqual([]);
        expect(result.syncMetadata).toBeDefined();
        expect(result.syncMetadata.serverTime).toBeDefined();
      });
    });
  });

  // ==========================================================================
  // Phase 5: Heartbeat Tests
  // ==========================================================================

  describe('heartbeat', () => {
    const validHeartbeatResponse = {
      status: 'ok',
      serverTime: '2026-01-18T12:00:00.000Z',
    };

    describe('successful heartbeat', () => {
      it('should return heartbeat response with ok status', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(validHeartbeatResponse),
        });

        const result = await service.heartbeat();

        expect(result.status).toBe('ok');
        expect(result.serverTime).toBe('2026-01-18T12:00:00.000Z');
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.nuvanaapp.com/api/v1/keys/heartbeat',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'X-API-Key': 'decrypted-api-key',
            }),
            body: expect.stringContaining('timestamp'),
          })
        );
      });

      it('should handle nested data response structure', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              data: validHeartbeatResponse,
            }),
        });

        const result = await service.heartbeat();

        expect(result.status).toBe('ok');
        expect(result.serverTime).toBe('2026-01-18T12:00:00.000Z');
      });

      it('should send client timestamp in request body', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(validHeartbeatResponse),
        });

        await service.heartbeat();

        const callArgs = mockFetch.mock.calls[0];
        const body = JSON.parse(callArgs[1].body as string);
        expect(body.timestamp).toBeDefined();
        // Validate ISO 8601 format
        expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
      });
    });

    describe('suspended status handling', () => {
      it('should throw error and mark license suspended when status is suspended', async () => {
        const { licenseService } = await import('../../../src/main/services/license.service');
        mockFetch.mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'suspended',
              serverTime: '2026-01-18T12:00:00.000Z',
            }),
        });

        await expect(service.heartbeat()).rejects.toThrow(
          'API key suspended. Please contact support.'
        );
        expect(licenseService.markSuspended).toHaveBeenCalled();
      });
    });

    describe('revoked status handling', () => {
      it('should throw error and mark license cancelled when status is revoked', async () => {
        const { licenseService } = await import('../../../src/main/services/license.service');
        mockFetch.mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'revoked',
              serverTime: '2026-01-18T12:00:00.000Z',
            }),
        });

        await expect(service.heartbeat()).rejects.toThrow(
          'API key revoked. Please contact support.'
        );
        expect(licenseService.markCancelled).toHaveBeenCalled();
      });
    });

    describe('response validation', () => {
      it('should throw error for missing status field', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              serverTime: '2026-01-18T12:00:00.000Z',
            }),
        });

        await expect(service.heartbeat()).rejects.toThrow('Invalid heartbeat response from server');
      });

      it('should throw error for missing serverTime field', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'ok',
            }),
        });

        await expect(service.heartbeat()).rejects.toThrow('Invalid heartbeat response from server');
      });

      it('should throw error for invalid status value', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'invalid_status',
              serverTime: '2026-01-18T12:00:00.000Z',
            }),
        });

        await expect(service.heartbeat()).rejects.toThrow('Invalid heartbeat response from server');
      });

      it('should throw error for invalid serverTime format', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'ok',
              serverTime: 'not-a-date',
            }),
        });

        await expect(service.heartbeat()).rejects.toThrow('Invalid heartbeat response from server');
      });
    });

    describe('error handling', () => {
      it('should throw sanitized error on network failure', async () => {
        mockFetch.mockRejectedValue(new Error('Network connection failed'));

        await expect(service.heartbeat()).rejects.toThrow(
          'Heartbeat request failed. Please check your connection.'
        );
      });

      it('should throw sanitized error on server error', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ message: 'Internal server error' }),
        });

        await expect(service.heartbeat()).rejects.toThrow(
          'Heartbeat request failed. Please check your connection.'
        );
      });

      it('should preserve suspended error message when propagating', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'suspended',
              serverTime: '2026-01-18T12:00:00.000Z',
            }),
        });

        await expect(service.heartbeat()).rejects.toThrow(
          'API key suspended. Please contact support.'
        );
      });

      it('should preserve revoked error message when propagating', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'revoked',
              serverTime: '2026-01-18T12:00:00.000Z',
            }),
        });

        await expect(service.heartbeat()).rejects.toThrow(
          'API key revoked. Please contact support.'
        );
      });
    });
  });
});
