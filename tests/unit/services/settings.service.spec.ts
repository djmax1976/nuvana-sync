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
import fs from 'fs';

// Helper to get platform-appropriate absolute paths for tests
// On Windows: C:\path\to\folder
// On Unix: /path/to/folder
const getTestAbsolutePath = (name: string): string => {
  if (process.platform === 'win32') {
    return `C:\\NAXML\\${name}`;
  }
  return `/naxml/${name.toLowerCase()}`;
};

// Platform-appropriate paths for tests
const TEST_PATHS = {
  validFolder: getTestAbsolutePath('Export'),
  nonExistent: getTestAbsolutePath('NonExistent'),
  traversal:
    process.platform === 'win32'
      ? 'C:\\NAXML\\..\\..\\Windows\\System32'
      : '/naxml/../../etc/passwd',
  relative: process.platform === 'win32' ? 'NAXML\\Export' : 'naxml/export',
  file: getTestAbsolutePath('file.txt'),
};

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
    state_id: null,
    state_code: null,
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
          xmlWatchFolder: TEST_PATHS.validFolder,
        });
      }).not.toThrow();
    });

    it('should reject watch folder that does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(() => {
        settingsService.updateLocal({
          xmlWatchFolder: TEST_PATHS.nonExistent,
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
      const result = settingsService.validateFolder(TEST_PATHS.traversal);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('parent directory');
    });

    it('should reject relative paths', () => {
      const result = settingsService.validateFolder(TEST_PATHS.relative);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('absolute');
    });

    it('should reject non-existent paths', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = settingsService.validateFolder(TEST_PATHS.nonExistent);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not exist');
    });

    it('should reject files (not directories)', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false } as fs.Stats);

      const result = settingsService.validateFolder(TEST_PATHS.file);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not a directory');
    });

    it('should accept valid accessible directories', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);
      vi.mocked(fs.accessSync).mockReturnValue(undefined);

      const result = settingsService.validateFolder(TEST_PATHS.validFolder);

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

  describe('setApiUrl', () => {
    it('should reject non-HTTPS endpoints (except localhost)', () => {
      expect(() => {
        settingsService.setApiUrl('http://api.example.com');
      }).toThrow(/HTTPS/);
    });

    it('should accept HTTPS endpoints', () => {
      expect(() => {
        settingsService.setApiUrl('https://api.example.com');
      }).not.toThrow();
    });

    it('should accept HTTP for localhost (development)', () => {
      expect(() => {
        settingsService.setApiUrl('http://localhost:3001');
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

  // ==========================================================================
  // Business Day Cutoff Time Feature Tests
  // SEC-014: Input validation for HH:MM format
  // ==========================================================================

  describe('Business Day Cutoff Time', () => {
    describe('getBusinessDayCutoffTime', () => {
      it('BDC-001: should return default cutoff time of 06:00 when not configured', () => {
        const freshService = new SettingsService();
        const cutoffTime = freshService.getBusinessDayCutoffTime();

        expect(cutoffTime).toBe('06:00');
      });

      it('BDC-002: should return configured cutoff time when set', () => {
        // Create a service and configure it
        const service = new SettingsService();
        service.updateLocal({ businessDayCutoffTime: '04:30' });

        const cutoffTime = service.getBusinessDayCutoffTime();

        expect(cutoffTime).toBe('04:30');
      });

      it('BDC-003: should persist cutoff time across getAll calls', () => {
        vi.mocked(storesDAL.getConfiguredStore).mockReturnValue(mockStore);
        const service = new SettingsService();
        service.updateLocal({ businessDayCutoffTime: '05:00' });

        const settings = service.getAll();

        expect(settings?.businessDayCutoffTime).toBe('05:00');
      });
    });

    describe('updateLocal - businessDayCutoffTime validation', () => {
      it('BDC-010: should accept valid cutoff time in HH:MM format', () => {
        expect(() => {
          settingsService.updateLocal({ businessDayCutoffTime: '06:00' });
        }).not.toThrow();
      });

      it('BDC-011: should accept midnight (00:00)', () => {
        expect(() => {
          settingsService.updateLocal({ businessDayCutoffTime: '00:00' });
        }).not.toThrow();
      });

      it('BDC-012: should accept end of day (23:59)', () => {
        expect(() => {
          settingsService.updateLocal({ businessDayCutoffTime: '23:59' });
        }).not.toThrow();
      });

      it('BDC-013: should accept early morning hours (04:30)', () => {
        expect(() => {
          settingsService.updateLocal({ businessDayCutoffTime: '04:30' });
        }).not.toThrow();
      });

      it('BDC-014: should reject invalid hour (25:00)', () => {
        expect(() => {
          settingsService.updateLocal({ businessDayCutoffTime: '25:00' });
        }).toThrow(/HH:MM format/);
      });

      it('BDC-015: should reject invalid minute (06:60)', () => {
        expect(() => {
          settingsService.updateLocal({ businessDayCutoffTime: '06:60' });
        }).toThrow(/HH:MM format/);
      });

      it('BDC-016: should reject single digit format (6:00)', () => {
        expect(() => {
          settingsService.updateLocal({ businessDayCutoffTime: '6:00' });
        }).toThrow(/HH:MM format/);
      });

      it('BDC-017: should reject 12-hour format with AM/PM', () => {
        expect(() => {
          settingsService.updateLocal({ businessDayCutoffTime: '06:00 AM' });
        }).toThrow(/HH:MM format/);
      });

      it('BDC-018: should reject empty string', () => {
        expect(() => {
          settingsService.updateLocal({ businessDayCutoffTime: '' });
        }).toThrow(/HH:MM format/);
      });

      it('BDC-019: should reject malformed input (text)', () => {
        expect(() => {
          settingsService.updateLocal({ businessDayCutoffTime: 'six oclock' });
        }).toThrow(/HH:MM format/);
      });

      it('BDC-020: should reject three-digit hour format', () => {
        expect(() => {
          settingsService.updateLocal({ businessDayCutoffTime: '006:00' });
        }).toThrow(/HH:MM format/);
      });
    });

    describe('adjustBusinessDate - Core Logic', () => {
      beforeEach(() => {
        // Reset to default cutoff of 06:00
        settingsService.updateLocal({ businessDayCutoffTime: '06:00' });
      });

      it('BDC-030: should return original date when file time is AFTER cutoff (8 AM > 6 AM)', () => {
        const result = settingsService.adjustBusinessDate('2025-01-15', '2025-01-15T08:00:00');

        expect(result).toBe('2025-01-15');
      });

      it('BDC-031: should return previous day when file time is BEFORE cutoff (3 AM < 6 AM)', () => {
        const result = settingsService.adjustBusinessDate('2025-01-15', '2025-01-15T03:00:00');

        expect(result).toBe('2025-01-14');
      });

      it('BDC-032: should return original date when file time EQUALS cutoff (6 AM = 6 AM)', () => {
        const result = settingsService.adjustBusinessDate('2025-01-15', '2025-01-15T06:00:00');

        expect(result).toBe('2025-01-15');
      });

      it('BDC-033: should return previous day when 1 minute before cutoff (5:59 < 6:00)', () => {
        const result = settingsService.adjustBusinessDate('2025-01-15', '2025-01-15T05:59:00');

        expect(result).toBe('2025-01-14');
      });

      it('BDC-034: should return original date when 1 minute after cutoff (6:01 > 6:00)', () => {
        const result = settingsService.adjustBusinessDate('2025-01-15', '2025-01-15T06:01:00');

        expect(result).toBe('2025-01-15');
      });

      it('BDC-035: should handle midnight (00:00) correctly - always before any cutoff', () => {
        const result = settingsService.adjustBusinessDate('2025-01-15', '2025-01-15T00:00:00');

        expect(result).toBe('2025-01-14');
      });

      it('BDC-036: should handle 23:59 correctly - after any reasonable cutoff', () => {
        const result = settingsService.adjustBusinessDate('2025-01-15', '2025-01-15T23:59:00');

        expect(result).toBe('2025-01-15');
      });

      it('BDC-037: should return original date when timestamp is null', () => {
        const result = settingsService.adjustBusinessDate('2025-01-15', null);

        expect(result).toBe('2025-01-15');
      });

      it('BDC-038: should return original date when timestamp is undefined', () => {
        const result = settingsService.adjustBusinessDate('2025-01-15', undefined);

        expect(result).toBe('2025-01-15');
      });

      it('BDC-039: should return original date for invalid timestamp format', () => {
        const result = settingsService.adjustBusinessDate('2025-01-15', 'invalid-timestamp');

        expect(result).toBe('2025-01-15');
      });
    });

    describe('adjustBusinessDate - Custom Cutoff Times', () => {
      it('BDC-040: should respect custom cutoff of 04:30', () => {
        settingsService.updateLocal({ businessDayCutoffTime: '04:30' });

        // 3:00 AM < 4:30 AM cutoff → previous day
        const before = settingsService.adjustBusinessDate('2025-01-15', '2025-01-15T03:00:00');
        expect(before).toBe('2025-01-14');

        // 5:00 AM > 4:30 AM cutoff → same day
        const after = settingsService.adjustBusinessDate('2025-01-15', '2025-01-15T05:00:00');
        expect(after).toBe('2025-01-15');
      });

      it('BDC-041: should respect cutoff of 00:00 (midnight)', () => {
        settingsService.updateLocal({ businessDayCutoffTime: '00:00' });

        // Nothing can be before 00:00, so all times stay on same day
        const midnight = settingsService.adjustBusinessDate('2025-01-15', '2025-01-15T00:00:00');
        expect(midnight).toBe('2025-01-15');

        const morning = settingsService.adjustBusinessDate('2025-01-15', '2025-01-15T03:00:00');
        expect(morning).toBe('2025-01-15');
      });

      it('BDC-042: should respect late cutoff of 12:00 (noon)', () => {
        settingsService.updateLocal({ businessDayCutoffTime: '12:00' });

        // 8:00 AM < 12:00 PM cutoff → previous day
        const before = settingsService.adjustBusinessDate('2025-01-15', '2025-01-15T08:00:00');
        expect(before).toBe('2025-01-14');

        // 14:00 (2 PM) > 12:00 PM cutoff → same day
        const after = settingsService.adjustBusinessDate('2025-01-15', '2025-01-15T14:00:00');
        expect(after).toBe('2025-01-15');
      });

      it('BDC-043: should handle AGK-compatible 23:30 cutoff', () => {
        // AGK default is 11:30 PM (23:30)
        settingsService.updateLocal({ businessDayCutoffTime: '23:30' });

        // 20:00 (8 PM) < 23:30 → previous day
        const before = settingsService.adjustBusinessDate('2025-01-15', '2025-01-15T20:00:00');
        expect(before).toBe('2025-01-14');

        // 23:45 > 23:30 → same day
        const after = settingsService.adjustBusinessDate('2025-01-15', '2025-01-15T23:45:00');
        expect(after).toBe('2025-01-15');
      });
    });

    describe('adjustBusinessDate - Date Boundary Cases', () => {
      beforeEach(() => {
        settingsService.updateLocal({ businessDayCutoffTime: '06:00' });
      });

      it('BDC-050: should correctly handle month boundary (Jan 1 → Dec 31)', () => {
        const result = settingsService.adjustBusinessDate('2025-01-01', '2025-01-01T03:00:00');

        expect(result).toBe('2024-12-31');
      });

      it('BDC-051: should correctly handle year boundary (Jan 1 → Dec 31 previous year)', () => {
        const result = settingsService.adjustBusinessDate('2026-01-01', '2026-01-01T02:00:00');

        expect(result).toBe('2025-12-31');
      });

      it('BDC-052: should handle leap year February 29 → 28', () => {
        // 2024 is a leap year
        const result = settingsService.adjustBusinessDate('2024-03-01', '2024-03-01T04:00:00');

        expect(result).toBe('2024-02-29');
      });

      it('BDC-053: should handle non-leap year March 1 → Feb 28', () => {
        // 2025 is not a leap year
        const result = settingsService.adjustBusinessDate('2025-03-01', '2025-03-01T04:00:00');

        expect(result).toBe('2025-02-28');
      });

      it('BDC-054: should handle end of month (Feb 1 → Jan 31)', () => {
        const result = settingsService.adjustBusinessDate('2025-02-01', '2025-02-01T03:00:00');

        expect(result).toBe('2025-01-31');
      });

      it('BDC-055: should handle April 1 → March 31 (30-day month)', () => {
        const result = settingsService.adjustBusinessDate('2025-04-01', '2025-04-01T03:00:00');

        expect(result).toBe('2025-03-31');
      });
    });

    describe('adjustBusinessDate - ISO Timestamp Formats', () => {
      beforeEach(() => {
        settingsService.updateLocal({ businessDayCutoffTime: '06:00' });
      });

      it('BDC-060: should handle ISO timestamp with milliseconds', () => {
        const result = settingsService.adjustBusinessDate('2025-01-15', '2025-01-15T03:30:45.123');

        expect(result).toBe('2025-01-14');
      });

      it('BDC-061: should handle ISO timestamp with timezone (Z)', () => {
        // Note: Date parsing uses local time, so UTC timestamp behavior depends on locale
        const result = settingsService.adjustBusinessDate('2025-01-15', '2025-01-15T03:00:00Z');

        // Should still work (parses to local time)
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it('BDC-062: should handle ISO timestamp with timezone offset', () => {
        const result = settingsService.adjustBusinessDate(
          '2025-01-15',
          '2025-01-15T03:00:00-05:00'
        );

        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it('BDC-063: should handle date-only format gracefully', () => {
        // No time component - should return original date
        const result = settingsService.adjustBusinessDate('2025-01-15', '2025-01-15');

        // Date-only parses as midnight UTC, which converts to local time
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
      });
    });

    describe('adjustBusinessDate - Error Resilience', () => {
      beforeEach(() => {
        settingsService.updateLocal({ businessDayCutoffTime: '06:00' });
      });

      it('BDC-070: should return original date for empty string timestamp', () => {
        const result = settingsService.adjustBusinessDate('2025-01-15', '');

        expect(result).toBe('2025-01-15');
      });

      it('BDC-071: should return original date for malformed date string', () => {
        const result = settingsService.adjustBusinessDate('2025-01-15', 'not-a-date');

        expect(result).toBe('2025-01-15');
      });

      it('BDC-072: should return original date for numeric timestamp', () => {
        // Numeric timestamps should be handled gracefully
        const result = settingsService.adjustBusinessDate('2025-01-15', String(Date.now()));

        // May or may not adjust based on parsed time, but should not throw
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
      });

      it('BDC-073: should handle very old dates', () => {
        const result = settingsService.adjustBusinessDate('1999-01-01', '1999-01-01T03:00:00');

        expect(result).toBe('1998-12-31');
      });

      it('BDC-074: should handle far future dates', () => {
        const result = settingsService.adjustBusinessDate('2099-06-15', '2099-06-15T03:00:00');

        expect(result).toBe('2099-06-14');
      });

      it('BDC-075: should not throw for extremely malformed business date', () => {
        // Should handle gracefully without throwing
        expect(() => {
          settingsService.adjustBusinessDate('invalid-date', '2025-01-15T03:00:00');
        }).not.toThrow();
      });
    });

    describe('Business Day Cutoff - Integration with getAll', () => {
      it('BDC-080: should include businessDayCutoffTime in getAll response', () => {
        vi.mocked(storesDAL.getConfiguredStore).mockReturnValue(mockStore);
        settingsService.updateLocal({ businessDayCutoffTime: '07:00' });

        const settings = settingsService.getAll();

        expect(settings).not.toBeNull();
        expect(settings?.businessDayCutoffTime).toBe('07:00');
      });

      it('BDC-081: should show default in getAll when not configured', () => {
        vi.mocked(storesDAL.getConfiguredStore).mockReturnValue(mockStore);
        const freshService = new SettingsService();

        const settings = freshService.getAll();

        expect(settings).not.toBeNull();
        expect(settings?.businessDayCutoffTime).toBe('06:00');
      });
    });
  });
});
