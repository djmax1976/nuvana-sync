/**
 * Settings Service Unit Tests
 *
 * Tests for settings management functionality.
 * Validates SEC-007: API key encryption
 * Validates SEC-014: Input validation
 *
 * @module tests/unit/services/settings
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import _path from 'path';
import fs from 'fs';

// Mock electron modules before importing the service
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((str: string) => Buffer.from(str)),
    decryptString: vi.fn((buf: Buffer) => buf.toString()),
  },
}));

// Mock electron-store with a proper class
const _createMockStore = () => {
  const mockStore = new Map<string, unknown>();
  return {
    get: vi.fn((key: string) => mockStore.get(key)),
    set: vi.fn((key: string, value: unknown) => mockStore.set(key, value)),
    delete: vi.fn((key: string) => mockStore.delete(key)),
    clear: vi.fn(() => mockStore.clear()),
    store: mockStore,
  };
};

vi.mock('electron-store', () => {
  return {
    default: class MockStore {
      private store = new Map<string, unknown>();

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

// Mock storesDAL
vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: {
    getConfiguredStore: vi.fn(),
    isConfigured: vi.fn(),
    isDatabaseReady: vi.fn(() => true),
    upsertFromCloud: vi.fn(),
  },
}));

// Mock usersDAL
vi.mock('../../../src/main/dal/users.dal', () => ({
  usersDAL: {
    isDatabaseReady: vi.fn(() => true),
    findByCloudId: vi.fn(),
    upsertFromCloud: vi.fn(),
  },
}));

// Mock cloudApiService
vi.mock('../../../src/main/services/cloud-api.service', () => ({
  cloudApiService: {
    validateApiKey: vi.fn(),
    healthCheck: vi.fn(),
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

// Mock fs
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    statSync: vi.fn(),
    accessSync: vi.fn(),
    constants: {
      R_OK: 4,
      W_OK: 2,
      X_OK: 1,
      F_OK: 0,
    },
  },
  existsSync: vi.fn(),
  statSync: vi.fn(),
  accessSync: vi.fn(),
  constants: {
    R_OK: 4,
    W_OK: 2,
    X_OK: 1,
    F_OK: 0,
  },
}));

import { SettingsService } from '../../../src/main/services/settings.service';
import { storesDAL } from '../../../src/main/dal/stores.dal';
import { usersDAL } from '../../../src/main/dal/users.dal';
import { cloudApiService } from '../../../src/main/services/cloud-api.service';

describe('SettingsService', () => {
  let settingsService: SettingsService;

  // Mock store data
  const mockStore = {
    store_id: 'store-123',
    company_id: 'company-456',
    name: 'Test Store',
    timezone: 'America/New_York',
    status: 'ACTIVE' as const,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Mock validation response (matches actual cloud API response structure)
  const mockValidationResponse = {
    valid: true,
    storeId: 'store-123',
    storeName: 'Test Store',
    storePublicId: 'TEST001',
    companyId: 'company-456',
    companyName: 'Test Company',
    timezone: 'America/New_York',
    stateCode: 'NY',
    features: ['pos', 'lottery'],
    offlinePermissions: ['lottery:scan', 'lottery:activate', 'shift:view'],
    offlineToken: 'mock-offline-token-jwt',
    offlineTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    lottery: {
      enabled: true,
      binCount: 10,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    settingsService = new SettingsService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getAll', () => {
    it('should return null when no store is configured', () => {
      vi.mocked(storesDAL.getConfiguredStore).mockReturnValue(undefined);

      const settings = settingsService.getAll();

      expect(settings).toBeNull();
    });

    it('should return complete settings when store is configured', () => {
      vi.mocked(storesDAL.getConfiguredStore).mockReturnValue(mockStore);

      const settings = settingsService.getAll();

      expect(settings).not.toBeNull();
      expect(settings?.storeId).toBe(mockStore.store_id);
      expect(settings?.storeName).toBe(mockStore.name);
      expect(settings?.timezone).toBe(mockStore.timezone);
    });
  });

  describe('updateLocal', () => {
    it('should update XML watch folder when path is valid', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);
      vi.mocked(fs.accessSync).mockReturnValue(undefined);

      expect(() => {
        settingsService.updateLocal({
          xmlWatchFolder: 'C:\\NAXML\\Export',
        });
      }).not.toThrow();
    });

    it('should reject watch folder that does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(() => {
        settingsService.updateLocal({
          xmlWatchFolder: 'C:\\NonExistent\\Path',
        });
      }).toThrow(/Invalid watch folder/);
    });

    it('should reject sync interval below minimum', () => {
      expect(() => {
        settingsService.updateLocal({
          syncIntervalSeconds: 10, // Below 30 minimum
        });
      }).toThrow(/must be at least 30 seconds/);
    });

    it('should reject sync interval above maximum', () => {
      expect(() => {
        settingsService.updateLocal({
          syncIntervalSeconds: 7200, // Above 3600 maximum
        });
      }).toThrow(/cannot exceed 3600 seconds/);
    });

    it('should accept valid sync interval', () => {
      expect(() => {
        settingsService.updateLocal({
          syncIntervalSeconds: 120,
        });
      }).not.toThrow();
    });
  });

  describe('validateFolder', () => {
    it('should reject paths with path traversal', () => {
      const result = settingsService.validateFolder('C:\\NAXML\\..\\..\\Windows\\System32');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('parent directory');
    });

    it('should reject relative paths', () => {
      const result = settingsService.validateFolder('NAXML/Export');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('absolute');
    });

    it('should reject non-existent paths', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = settingsService.validateFolder('C:\\NonExistent');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not exist');
    });

    it('should reject files (not directories)', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false } as fs.Stats);

      const result = settingsService.validateFolder('C:\\file.txt');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not a directory');
    });

    it('should accept valid accessible directories', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);
      vi.mocked(fs.accessSync).mockReturnValue(undefined);

      const result = settingsService.validateFolder('C:\\NAXML\\Export');

      expect(result.valid).toBe(true);
    });
  });

  describe('validateAndSaveApiKey', () => {
    it('should reject invalid API key format', async () => {
      const result = await settingsService.validateAndSaveApiKey('invalid-key');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('valid Nuvana Store Sync Key');
    });

    it('should reject API key that fails cloud validation', async () => {
      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue({
        valid: false,
        storeId: '',
        storeName: '',
        storePublicId: '',
        companyId: '',
        companyName: '',
        timezone: '',
        stateCode: '',
        features: [],
        offlinePermissions: [],
        offlineToken: '',
        offlineTokenExpiresAt: '',
      });

      const result = await settingsService.validateAndSaveApiKey(
        'nsk_live_validformatbutinvalid12345'
      );

      expect(result.valid).toBe(false);
    });

    it('should save store info on successful validation', async () => {
      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(mockValidationResponse);

      const result = await settingsService.validateAndSaveApiKey(
        'nsk_live_validkeywith20ormorechars'
      );

      expect(result.valid).toBe(true);
      expect(result.store?.storeId).toBe(mockValidationResponse.storeId);
      expect(storesDAL.upsertFromCloud).toHaveBeenCalled();
    });

    it('should clear API key on validation error', async () => {
      vi.mocked(cloudApiService.validateApiKey).mockRejectedValue(new Error('Network error'));

      const result = await settingsService.validateAndSaveApiKey(
        'nsk_live_validkeywith20ormorechars'
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('completeSetup', () => {
    it('should mark setup as complete', () => {
      settingsService.completeSetup();

      expect(settingsService.isSetupComplete()).toBe(true);
    });
  });

  describe('isSetupComplete', () => {
    it('should return false when setup not completed', () => {
      // Fresh instance, no setup completed
      const freshService = new SettingsService();

      expect(freshService.isSetupComplete()).toBe(false);
    });
  });

  describe('isConfigured', () => {
    it('should return false when store not configured', () => {
      vi.mocked(storesDAL.isConfigured).mockReturnValue(false);

      expect(settingsService.isConfigured()).toBe(false);
    });

    it('should check all configuration components', () => {
      vi.mocked(storesDAL.isConfigured).mockReturnValue(true);

      const status = settingsService.getConfigurationStatus();

      expect(status).toHaveProperty('hasStore');
      expect(status).toHaveProperty('hasApiKey');
      expect(status).toHaveProperty('setupComplete');
      expect(status).toHaveProperty('hasWatchFolder');
    });
  });

  describe('setCloudEndpoint', () => {
    it('should reject non-HTTPS endpoints', () => {
      expect(() => {
        settingsService.setCloudEndpoint('http://api.example.com');
      }).toThrow(/HTTPS/);
    });

    it('should accept HTTPS endpoints', () => {
      expect(() => {
        settingsService.setCloudEndpoint('https://api.example.com');
      }).not.toThrow();
    });
  });

  describe('resetAll', () => {
    it('should clear all settings', () => {
      settingsService.resetAll();

      // After reset, should not be configured
      expect(settingsService.isSetupComplete()).toBe(false);
    });
  });

  describe('syncStoreToDatabase', () => {
    it('should return false when database is not ready', () => {
      vi.mocked(storesDAL.isDatabaseReady).mockReturnValue(false);

      const result = settingsService.syncStoreToDatabase();

      expect(result).toBe(false);
      expect(storesDAL.upsertFromCloud).not.toHaveBeenCalled();
    });

    it('should return false when store already exists in database', () => {
      vi.mocked(storesDAL.isDatabaseReady).mockReturnValue(true);
      vi.mocked(storesDAL.isConfigured).mockReturnValue(true);

      const result = settingsService.syncStoreToDatabase();

      expect(result).toBe(false);
      expect(storesDAL.upsertFromCloud).not.toHaveBeenCalled();
    });

    it('should return false when no store info in config', () => {
      vi.mocked(storesDAL.isDatabaseReady).mockReturnValue(true);
      vi.mocked(storesDAL.isConfigured).mockReturnValue(false);
      // Config store is empty by default

      const result = settingsService.syncStoreToDatabase();

      expect(result).toBe(false);
      expect(storesDAL.upsertFromCloud).not.toHaveBeenCalled();
    });
  });

  describe('syncInitialManagerToDatabase', () => {
    it('should return false when database is not ready', () => {
      vi.mocked(usersDAL.isDatabaseReady).mockReturnValue(false);

      const result = settingsService.syncInitialManagerToDatabase();

      expect(result).toBe(false);
      expect(usersDAL.upsertFromCloud).not.toHaveBeenCalled();
    });

    it('should return false when no initial manager in config', () => {
      vi.mocked(usersDAL.isDatabaseReady).mockReturnValue(true);
      // Config store is empty by default

      const result = settingsService.syncInitialManagerToDatabase();

      expect(result).toBe(false);
      expect(usersDAL.upsertFromCloud).not.toHaveBeenCalled();
    });

    it('should return false when initial manager already exists in database', async () => {
      vi.mocked(usersDAL.isDatabaseReady).mockReturnValue(true);
      vi.mocked(storesDAL.isDatabaseReady).mockReturnValue(true);
      vi.mocked(usersDAL.findByCloudId).mockReturnValue({
        user_id: 'local-user-123',
        store_id: 'store-123',
        role: 'store_manager',
        name: 'Test Manager',
        pin_hash: '$2b$12$existinghash',
        active: 1,
        last_login_at: null,
        cloud_user_id: 'cloud-user-123',
        synced_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // First validate an API key that includes initial manager
      const mockValidationWithManager = {
        ...mockValidationResponse,
        initialManager: {
          userId: 'cloud-user-123',
          name: 'Test Manager',
          role: 'store_manager' as const,
          pinHash: '$2b$12$testhash',
        },
      };
      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(mockValidationWithManager);
      await settingsService.validateAndSaveApiKey('nsk_live_validkeywith20ormorechars');

      // Now try to sync - should find existing user
      const result = settingsService.syncInitialManagerToDatabase();

      expect(result).toBe(false);
      // upsertFromCloud called once during validateAndSaveApiKey for store, not for duplicate user
    });

    it('should sync initial manager to database when valid config exists', async () => {
      vi.mocked(usersDAL.isDatabaseReady).mockReturnValue(true);
      vi.mocked(storesDAL.isDatabaseReady).mockReturnValue(true);
      vi.mocked(usersDAL.findByCloudId).mockReturnValue(undefined); // User doesn't exist

      // Validate API key with initial manager
      const mockValidationWithManager = {
        ...mockValidationResponse,
        initialManager: {
          userId: 'cloud-user-456',
          name: 'New Manager',
          role: 'store_manager' as const,
          pinHash: '$2b$12$newhashvalue',
        },
      };
      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(mockValidationWithManager);

      // The validateAndSaveApiKey should call syncInitialManagerToDatabase internally
      await settingsService.validateAndSaveApiKey('nsk_live_validkeywith20ormorechars');

      // Verify user was synced - SEC-001: PIN hash from cloud
      expect(usersDAL.upsertFromCloud).toHaveBeenCalledWith(
        expect.objectContaining({
          cloud_user_id: 'cloud-user-456',
          name: 'New Manager',
          role: 'store_manager',
          pin_hash: '$2b$12$newhashvalue',
          store_id: 'store-123',
        })
      );
    });

    it('should use correct role type for initial manager - SEC-001', async () => {
      vi.mocked(usersDAL.isDatabaseReady).mockReturnValue(true);
      vi.mocked(storesDAL.isDatabaseReady).mockReturnValue(true);
      vi.mocked(usersDAL.findByCloudId).mockReturnValue(undefined);

      // Test with shift_manager role
      const mockValidationWithShiftManager = {
        ...mockValidationResponse,
        initialManager: {
          userId: 'cloud-shift-mgr',
          name: 'Shift Manager',
          role: 'shift_manager' as const,
          pinHash: '$2b$12$shiftmgrhash',
        },
      };
      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(mockValidationWithShiftManager);

      await settingsService.validateAndSaveApiKey('nsk_live_validkeywith20ormorechars');

      expect(usersDAL.upsertFromCloud).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'shift_manager',
        })
      );
    });
  });

  describe('validateAndSaveApiKey with initial manager', () => {
    it('should save initial manager info to config store', async () => {
      vi.mocked(storesDAL.isDatabaseReady).mockReturnValue(false); // DB not ready
      vi.mocked(usersDAL.isDatabaseReady).mockReturnValue(false);

      const mockValidationWithManager = {
        ...mockValidationResponse,
        initialManager: {
          userId: 'init-mgr-123',
          name: 'Initial Manager',
          role: 'store_manager' as const,
          pinHash: '$2b$12$initialmgrhash',
        },
      };
      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(mockValidationWithManager);

      const result = await settingsService.validateAndSaveApiKey(
        'nsk_live_validkeywith20ormorechars'
      );

      expect(result.valid).toBe(true);
      // Manager should be saved to config store for later sync
      // (Can't directly verify config store in mock, but shouldn't call database)
      expect(usersDAL.upsertFromCloud).not.toHaveBeenCalled();
    });

    it('should sync initial manager immediately if database is ready', async () => {
      vi.mocked(storesDAL.isDatabaseReady).mockReturnValue(true);
      vi.mocked(usersDAL.isDatabaseReady).mockReturnValue(true);
      vi.mocked(usersDAL.findByCloudId).mockReturnValue(undefined);

      const mockValidationWithManager = {
        ...mockValidationResponse,
        initialManager: {
          userId: 'immediate-mgr-123',
          name: 'Immediate Manager',
          role: 'store_manager' as const,
          pinHash: '$2b$12$immediatehash',
        },
      };
      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(mockValidationWithManager);

      await settingsService.validateAndSaveApiKey('nsk_live_validkeywith20ormorechars');

      // Should sync immediately
      expect(usersDAL.upsertFromCloud).toHaveBeenCalledWith(
        expect.objectContaining({
          cloud_user_id: 'immediate-mgr-123',
          pin_hash: '$2b$12$immediatehash',
        })
      );
    });
  });
});
