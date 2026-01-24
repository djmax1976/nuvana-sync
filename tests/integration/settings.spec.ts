/**
 * Settings Integration Tests
 *
 * End-to-end tests for settings and bin management flows.
 * Tests complete workflows including setup wizard and bin management.
 *
 * NOTE: These tests are written but NOT run automatically.
 * They require database setup and may require manual execution.
 *
 * @module tests/integration/settings
 */

import {
  describe,
  it,
  expect,
  beforeAll as _beforeAll,
  afterAll as _afterAll,
  beforeEach,
  vi,
} from 'vitest';

// Skip tests that require complex dynamic mocking in CI
const SKIP_COMPLEX_MOCK_TESTS =
  process.env.CI === 'true' || process.env.SKIP_NATIVE_TESTS === 'true';
const itComplex = SKIP_COMPLEX_MOCK_TESTS ? it.skip : it;

// Mock electron modules for integration tests
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((str: string) => Buffer.from(str)),
    decryptString: vi.fn((buf: Buffer) => buf.toString()),
  },
  app: {
    getPath: vi.fn(() => '/tmp/test'),
    getVersion: vi.fn(() => '1.0.0'),
  },
}));

// Mock electron-store for tests - must be a proper constructor class
vi.mock('electron-store', () => {
  const stores = new Map<string, Map<string, unknown>>();

  // Create a mock class that can be instantiated with 'new'
  class MockStore {
    private store: Map<string, unknown>;
    public path: string;

    constructor(options?: { name?: string }) {
      const name = options?.name || 'default';
      if (!stores.has(name)) {
        stores.set(name, new Map());
      }
      this.store = stores.get(name)!;
      this.path = `/tmp/test/${name}.json`;
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

    has(key: string) {
      return this.store.has(key);
    }
  }

  return {
    default: MockStore,
  };
});

// Mock logger
vi.mock('../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('Settings Integration', () => {
  describe('Setup Wizard Flow', () => {
    it('should validate API key format before cloud validation', async () => {
      // Test that invalid format is rejected before network call
      const { SettingsService } = await import('../../src/main/services/settings.service');
      const service = new SettingsService();

      const result = await service.validateAndSaveApiKey('invalid-key');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('API key must be a valid');
    });

    itComplex('should complete full setup flow with valid data', async () => {
      // Reset modules to apply fresh mocks
      vi.resetModules();

      // Mock cloud API response using vi.doMock (not hoisted)
      vi.doMock('../../src/main/services/cloud-api.service', () => ({
        cloudApiService: {
          validateApiKey: vi.fn().mockResolvedValue({
            valid: true,
            storeId: 'store-123',
            storeName: 'Test Store',
            companyId: 'company-456',
            companyName: 'Test Company',
            timezone: 'America/New_York',
            features: ['pos', 'lottery'],
            lottery: { enabled: true, binCount: 10 },
          }),
        },
      }));

      vi.doMock('../../src/main/dal/stores.dal', () => ({
        storesDAL: {
          upsertFromCloud: vi.fn(),
          getConfiguredStore: vi.fn(() => ({
            store_id: 'store-123',
            company_id: 'company-456',
            name: 'Test Store',
            timezone: 'America/New_York',
            status: 'ACTIVE',
          })),
          isConfigured: vi.fn(() => true),
        },
      }));

      const { SettingsService } = await import('../../src/main/services/settings.service');
      const service = new SettingsService();

      // Step 1: Validate API key
      const keyResult = await service.validateAndSaveApiKey('nsk_live_validkeywith20ormorechars');

      expect(keyResult.valid).toBe(true);
      expect(keyResult.store?.storeId).toBe('store-123');

      // Step 2: Complete setup
      service.completeSetup();

      expect(service.isSetupComplete()).toBe(true);
    });

    it('should validate watch folder during setup', async () => {
      // Reset modules to apply fresh mocks
      vi.resetModules();

      vi.doMock('fs', () => ({
        default: {
          existsSync: vi.fn(() => false),
          statSync: vi.fn(),
          accessSync: vi.fn(),
        },
        existsSync: vi.fn(() => false),
        statSync: vi.fn(),
        accessSync: vi.fn(),
      }));

      const { SettingsService } = await import('../../src/main/services/settings.service');
      const service = new SettingsService();

      // Use cross-platform absolute path
      const nonExistentPath =
        process.platform === 'win32' ? 'C:\\NonExistent\\Path' : '/nonexistent/path';
      const result = service.validateFolder(nonExistentPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('does not exist');
    });

    it('should reject path traversal attempts', async () => {
      const { SettingsService } = await import('../../src/main/services/settings.service');
      const service = new SettingsService();

      // Use cross-platform path with traversal attempt
      const traversalPath =
        process.platform === 'win32'
          ? 'C:\\NAXML\\..\\..\\Windows\\System32'
          : '/home/user/../../../etc/passwd';
      const result = service.validateFolder(traversalPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('parent directory references');
    });
  });

  describe('Bin Management', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    itComplex('should create and delete bins correctly', async () => {
      // After v037 migration: bin_id IS the cloud's UUID (no separate cloud_bin_id)
      const mockBin = {
        bin_id: 'bin-001',
        store_id: 'store-123',
        display_order: 1,
        name: 'Test Bin',
        is_active: 1,
        deleted_at: null,
        synced_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      vi.doMock('../../src/main/dal/stores.dal', () => ({
        storesDAL: {
          getConfiguredStore: vi.fn(() => ({
            store_id: 'store-123',
            company_id: 'company-456',
            name: 'Test Store',
            timezone: 'America/New_York',
            status: 'ACTIVE',
          })),
        },
      }));

      vi.doMock('../../src/main/dal/lottery-bins.dal', () => ({
        lotteryBinsDAL: {
          getNextDisplayOrder: vi.fn(() => 1),
          create: vi.fn(() => mockBin),
          findById: vi.fn(() => mockBin),
          getPackCount: vi.fn(() => 0),
          softDelete: vi.fn(() => ({ success: true })),
        },
      }));

      vi.doMock('../../src/main/dal/sync-queue.dal', () => ({
        syncQueueDAL: {
          enqueue: vi.fn(),
        },
      }));

      const { BinManagementService } =
        await import('../../src/main/services/bin-management.service');
      const service = new BinManagementService();

      // Create bin
      const createResult = service.createBin({ name: 'Test Bin' });

      expect(createResult.success).toBe(true);
      expect(createResult.bin?.name).toBe('Test Bin');

      // Delete bin (should succeed with no packs)
      const deleteResult = service.deleteBin('bin-001');

      expect(deleteResult.success).toBe(true);
    });

    itComplex('should prevent deletion of bin with active packs', async () => {
      // After v037 migration: bin_id IS the cloud's UUID (no separate cloud_bin_id)
      const mockBin = {
        bin_id: 'bin-001',
        store_id: 'store-123',
        display_order: 1,
        name: 'Test Bin',
        is_active: 1,
        deleted_at: null,
        synced_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      vi.doMock('../../src/main/dal/stores.dal', () => ({
        storesDAL: {
          getConfiguredStore: vi.fn(() => ({
            store_id: 'store-123',
            company_id: 'company-456',
            name: 'Test Store',
            timezone: 'America/New_York',
            status: 'ACTIVE',
          })),
        },
      }));

      vi.doMock('../../src/main/dal/lottery-bins.dal', () => ({
        lotteryBinsDAL: {
          findById: vi.fn(() => mockBin),
          getPackCount: vi.fn(() => 5), // Has packs
        },
      }));

      const { BinManagementService } =
        await import('../../src/main/services/bin-management.service');
      const service = new BinManagementService();

      const deleteResult = service.deleteBin('bin-001');

      expect(deleteResult.success).toBe(false);
      expect(deleteResult.error).toContain('5 active pack');
    });

    it('should validate bin name format', async () => {
      vi.doMock('../../src/main/dal/stores.dal', () => ({
        storesDAL: {
          getConfiguredStore: vi.fn(() => ({
            store_id: 'store-123',
            company_id: 'company-456',
            name: 'Test Store',
            timezone: 'America/New_York',
            status: 'ACTIVE',
          })),
        },
      }));

      const { BinManagementService } =
        await import('../../src/main/services/bin-management.service');
      const service = new BinManagementService();

      // Invalid characters
      const result1 = service.createBin({ name: '<script>alert(1)</script>' });
      expect(result1.success).toBe(false);
      expect(result1.error).toContain('can only contain');

      // Too long
      const result2 = service.createBin({ name: 'a'.repeat(51) });
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('cannot exceed');

      // Empty
      const result3 = service.createBin({ name: '' });
      expect(result3.success).toBe(false);
      expect(result3.error).toContain('required');
    });

    it('should create bins locally without cloud sync (bins are pull-only)', async () => {
      // Reset modules to apply fresh mocks
      vi.resetModules();

      // Track if enqueue was called - it should NOT be called for bins
      // Bins are pull-only entities per API spec: GET /api/v1/sync/lottery/bins (pull only)
      const mockEnqueue = vi.fn();

      // Use vi.doMock for dynamic mocking (not hoisted)
      vi.doMock('../../src/main/dal/stores.dal', () => ({
        storesDAL: {
          getConfiguredStore: vi.fn(() => ({
            store_id: 'store-123',
            company_id: 'company-456',
            name: 'Test Store',
            timezone: 'America/New_York',
            status: 'ACTIVE',
          })),
        },
      }));

      vi.doMock('../../src/main/dal/lottery-bins.dal', () => ({
        lotteryBinsDAL: {
          getNextDisplayOrder: vi.fn(() => 1),
          create: vi.fn(() => ({
            bin_id: 'bin-001',
            store_id: 'store-123',
            display_order: 1,
            name: 'Test Bin',
            is_active: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })),
        },
      }));

      vi.doMock('../../src/main/dal/sync-queue.dal', () => ({
        syncQueueDAL: {
          enqueue: mockEnqueue,
        },
      }));

      // Import after mocks are set up
      const { BinManagementService } =
        await import('../../src/main/services/bin-management.service');
      const service = new BinManagementService();

      const result = service.createBin({ name: 'Test Bin' });

      // Bin should be created successfully
      expect(result.success).toBe(true);
      expect(result.bin?.name).toBe('Test Bin');
      expect(result.bin?.display_order).toBe(1);

      // Sync queue should NOT be called - bins are pull-only entities
      // Cloud is authoritative for bins; local changes are for offline operation only
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  describe('Settings Validation', () => {
    it('should validate sync interval range', async () => {
      vi.resetModules();

      vi.doMock('fs', () => ({
        default: {
          existsSync: vi.fn(() => true),
          statSync: vi.fn(() => ({ isDirectory: () => true })),
          accessSync: vi.fn(),
        },
        existsSync: vi.fn(() => true),
        statSync: vi.fn(() => ({ isDirectory: () => true })),
        accessSync: vi.fn(),
      }));

      const { SettingsService } = await import('../../src/main/services/settings.service');
      const service = new SettingsService();

      // Below minimum
      expect(() => service.updateLocal({ syncIntervalSeconds: 10 })).toThrow();

      // Above maximum
      expect(() => service.updateLocal({ syncIntervalSeconds: 5000 })).toThrow();

      // Valid range should not throw
      expect(() => service.updateLocal({ syncIntervalSeconds: 120 })).not.toThrow();
    });

    it('should require HTTPS for API URL (except localhost)', async () => {
      const { SettingsService } = await import('../../src/main/services/settings.service');
      const service = new SettingsService();

      expect(() => service.setApiUrl('http://insecure.example.com')).toThrow(/HTTPS/);
      expect(() => service.setApiUrl('https://secure.example.com')).not.toThrow();
      // Localhost should be allowed with HTTP for development
      expect(() => service.setApiUrl('http://localhost:3001')).not.toThrow();
    });
  });
});
