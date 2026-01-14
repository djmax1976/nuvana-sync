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

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

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

// Mock electron-store for tests
vi.mock('electron-store', () => {
  const stores = new Map<string, Map<string, unknown>>();
  return {
    default: vi.fn().mockImplementation((options) => {
      const name = options?.name || 'default';
      if (!stores.has(name)) {
        stores.set(name, new Map());
      }
      const store = stores.get(name)!;
      return {
        get: vi.fn((key: string) => store.get(key)),
        set: vi.fn((key: string, value: unknown) => store.set(key, value)),
        delete: vi.fn((key: string) => store.delete(key)),
        clear: vi.fn(() => store.clear()),
        store,
      };
    }),
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
      expect(result.error).toContain('format');
    });

    it('should complete full setup flow with valid data', async () => {
      // Mock cloud API response
      vi.mock('../../src/main/services/cloud-api.service', () => ({
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

      vi.mock('../../src/main/dal/stores.dal', () => ({
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
      vi.mock('fs', () => ({
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

      const result = service.validateFolder('C:\\NonExistent\\Path');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not exist');
    });

    it('should reject path traversal attempts', async () => {
      const { SettingsService } = await import('../../src/main/services/settings.service');
      const service = new SettingsService();

      const result = service.validateFolder('C:\\NAXML\\..\\..\\Windows\\System32');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });
  });

  describe('Bin Management', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it('should create and delete bins correctly', async () => {
      const mockBin = {
        bin_id: 'bin-001',
        store_id: 'store-123',
        bin_number: 1,
        label: 'Test Bin',
        status: 'ACTIVE' as const,
        deleted_at: null,
        cloud_bin_id: null,
        synced_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      vi.mock('../../src/main/dal/stores.dal', () => ({
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

      vi.mock('../../src/main/dal/lottery-bins.dal', () => ({
        lotteryBinsDAL: {
          getNextBinNumber: vi.fn(() => 1),
          create: vi.fn(() => mockBin),
          findById: vi.fn(() => mockBin),
          getPackCount: vi.fn(() => 0),
          softDelete: vi.fn(() => ({ success: true })),
        },
      }));

      vi.mock('../../src/main/dal/sync-queue.dal', () => ({
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
      expect(createResult.bin?.label).toBe('Test Bin');

      // Delete bin (should succeed with no packs)
      const deleteResult = service.deleteBin('bin-001');

      expect(deleteResult.success).toBe(true);
    });

    it('should prevent deletion of bin with active packs', async () => {
      const mockBin = {
        bin_id: 'bin-001',
        store_id: 'store-123',
        bin_number: 1,
        label: 'Test Bin',
        status: 'ACTIVE' as const,
        deleted_at: null,
        cloud_bin_id: null,
        synced_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      vi.mock('../../src/main/dal/stores.dal', () => ({
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

      vi.mock('../../src/main/dal/lottery-bins.dal', () => ({
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
      vi.mock('../../src/main/dal/stores.dal', () => ({
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

    it('should sync bin changes to cloud queue', async () => {
      const mockEnqueue = vi.fn();

      vi.mock('../../src/main/dal/stores.dal', () => ({
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

      vi.mock('../../src/main/dal/lottery-bins.dal', () => ({
        lotteryBinsDAL: {
          getNextBinNumber: vi.fn(() => 1),
          create: vi.fn(() => ({
            bin_id: 'bin-001',
            store_id: 'store-123',
            bin_number: 1,
            label: 'Test Bin',
            status: 'ACTIVE',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })),
        },
      }));

      vi.mock('../../src/main/dal/sync-queue.dal', () => ({
        syncQueueDAL: {
          enqueue: mockEnqueue,
        },
      }));

      const { BinManagementService } =
        await import('../../src/main/services/bin-management.service');
      const service = new BinManagementService();

      service.createBin({ name: 'Test Bin' });

      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'lottery_bin',
          operation: 'CREATE',
        })
      );
    });
  });

  describe('Settings Validation', () => {
    it('should validate sync interval range', async () => {
      vi.mock('fs', () => ({
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

    it('should require HTTPS for cloud endpoint', async () => {
      const { SettingsService } = await import('../../src/main/services/settings.service');
      const service = new SettingsService();

      expect(() => service.setCloudEndpoint('http://insecure.example.com')).toThrow(/HTTPS/);
      expect(() => service.setCloudEndpoint('https://secure.example.com')).not.toThrow();
    });
  });
});
