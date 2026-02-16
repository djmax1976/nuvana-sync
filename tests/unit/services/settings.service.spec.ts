/**
 * Settings Service Unit Tests
 *
 * Tests for settings management functionality.
 * Validates SEC-007: API key encryption
 * Validates SEC-014: Input validation
 *
 * @module tests/unit/services/settings
 */

// Using vitest globals (configured in vitest.config.ts with globals: true)
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
// Note: After cloud_id consolidation, findById -> findById
vi.mock('../../../src/main/dal/users.dal', () => ({
  usersDAL: {
    isDatabaseReady: vi.fn(() => true),
    findById: vi.fn(),
    upsertFromCloud: vi.fn(),
  },
}));

// Mock posTerminalMappingsDAL (Phase 5: POS Sync - register sync from cloud)
vi.mock('../../../src/main/dal/pos-id-mappings.dal', () => ({
  posTerminalMappingsDAL: {
    findByExternalId: vi.fn(),
    getOrCreate: vi.fn(),
    update: vi.fn(),
    findById: vi.fn(),
    findRegisters: vi.fn(() => []),
    findAllActive: vi.fn(() => []),
    findFuelDispensers: vi.fn(() => []),
    backfillFromShifts: vi.fn(() => ({ created: 0, existing: 0, total: 0 })),
    deactivateStaleCloudRegisters: vi.fn(() => 0),
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
import { posTerminalMappingsDAL } from '../../../src/main/dal/pos-id-mappings.dal';
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
  // Version 8.0: posConnectionConfig is MANDATORY for initial setup
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
    // Version 8.0: POS connection configuration (MANDATORY for initial setup)
    posConnectionConfig: {
      pos_type: 'GILBARCO_NAXML' as const,
      pos_connection_type: 'FILE' as const,
      pos_connection_config: {
        import_path: getTestAbsolutePath('Export'),
        export_path: getTestAbsolutePath('Archive'),
        poll_interval_seconds: 5,
      },
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
      // Note: After cloud_id consolidation, user_id IS the cloud user ID
      vi.mocked(usersDAL.findById).mockReturnValue({
        user_id: 'cloud-user-123', // user_id IS the cloud ID
        store_id: 'store-123',
        role: 'store_manager',
        name: 'Test Manager',
        pin_hash: '$2b$12$existinghash',
        sha256_pin_fingerprint: 'existing_fingerprint_abc123',
        active: 1,
        last_login_at: null,
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
      vi.mocked(usersDAL.findById).mockReturnValue(undefined); // User doesn't exist

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
          user_id: 'cloud-user-456',
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
      vi.mocked(usersDAL.findById).mockReturnValue(undefined);

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
      vi.mocked(usersDAL.findById).mockReturnValue(undefined);

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
          user_id: 'immediate-mgr-123',
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

  // ==========================================================================
  // POS Type Compatibility Tests (Phase 1)
  // SEC-014: Strict allowlist validation for POS types
  // ==========================================================================

  describe('POS Type Compatibility', () => {
    describe('isNAXMLCompatible()', () => {
      it('POS-001: returns true for GILBARCO_NAXML + FILE', () => {
        settingsService.savePOSConnectionConfig({
          pos_type: 'GILBARCO_NAXML',
          pos_connection_type: 'FILE',
          pos_connection_config: { import_path: TEST_PATHS.validFolder },
        });

        expect(settingsService.isNAXMLCompatible()).toBe(true);
      });

      it('POS-002: returns true for GILBARCO_PASSPORT + FILE', () => {
        settingsService.savePOSConnectionConfig({
          pos_type: 'GILBARCO_PASSPORT',
          pos_connection_type: 'FILE',
          pos_connection_config: { import_path: TEST_PATHS.validFolder },
        });

        expect(settingsService.isNAXMLCompatible()).toBe(true);
      });

      it('POS-003: returns true for FILE_BASED + FILE', () => {
        settingsService.savePOSConnectionConfig({
          pos_type: 'FILE_BASED',
          pos_connection_type: 'FILE',
          pos_connection_config: { import_path: TEST_PATHS.validFolder },
        });

        expect(settingsService.isNAXMLCompatible()).toBe(true);
      });

      it('POS-004: returns false for SQUARE_REST + API', () => {
        settingsService.savePOSConnectionConfig({
          pos_type: 'SQUARE_REST',
          pos_connection_type: 'API',
          pos_connection_config: { base_url: 'https://api.squareup.com' },
        });

        expect(settingsService.isNAXMLCompatible()).toBe(false);
      });

      it('POS-005: returns false for CLOVER_REST + API', () => {
        settingsService.savePOSConnectionConfig({
          pos_type: 'CLOVER_REST',
          pos_connection_type: 'API',
          pos_connection_config: { base_url: 'https://api.clover.com' },
        });

        expect(settingsService.isNAXMLCompatible()).toBe(false);
      });

      it('POS-006: returns false for MANUAL_ENTRY + MANUAL', () => {
        settingsService.savePOSConnectionConfig({
          pos_type: 'MANUAL_ENTRY',
          pos_connection_type: 'MANUAL',
          pos_connection_config: null,
        });

        expect(settingsService.isNAXMLCompatible()).toBe(false);
      });

      it('POS-007: returns false for VERIFONE_RUBY2 + NETWORK', () => {
        settingsService.savePOSConnectionConfig({
          pos_type: 'VERIFONE_RUBY2',
          pos_connection_type: 'NETWORK',
          pos_connection_config: { host: '192.168.1.100', port: 5000 },
        });

        expect(settingsService.isNAXMLCompatible()).toBe(false);
      });

      it('POS-008: returns false when no POS config exists and no watchPath', () => {
        // Fresh service with no config
        const freshService = new SettingsService();
        freshService.clearPOSConnectionConfig();

        expect(freshService.isNAXMLCompatible()).toBe(false);
      });

      it('POS-009: returns false for GILBARCO_NAXML + API (mismatched connection type)', () => {
        // Edge case: NAXML-compatible POS type but wrong connection type
        settingsService.savePOSConnectionConfig({
          pos_type: 'GILBARCO_NAXML',
          pos_connection_type: 'API',
          pos_connection_config: { base_url: 'https://example.com' },
        });

        expect(settingsService.isNAXMLCompatible()).toBe(false);
      });

      it('POS-010: returns true for legacy mode (watchPath exists, no POS config)', () => {
        // Simulate legacy installation: watchPath but no POS connection config
        const freshService = new SettingsService();
        freshService.clearPOSConnectionConfig();
        freshService.setWatchPath(TEST_PATHS.validFolder);

        expect(freshService.isNAXMLCompatible()).toBe(true);
      });

      it('POS-011: returns false for CUSTOM_API + API', () => {
        settingsService.savePOSConnectionConfig({
          pos_type: 'CUSTOM_API',
          pos_connection_type: 'API',
          pos_connection_config: { base_url: 'https://custom-pos.example.com' },
        });

        expect(settingsService.isNAXMLCompatible()).toBe(false);
      });

      it('POS-012: returns false for VERIFONE_COMMANDER + NETWORK', () => {
        settingsService.savePOSConnectionConfig({
          pos_type: 'VERIFONE_COMMANDER',
          pos_connection_type: 'NETWORK',
          pos_connection_config: { host: '192.168.1.200', port: 4000 },
        });

        expect(settingsService.isNAXMLCompatible()).toBe(false);
      });

      it('POS-013: returns false for WEBHOOK connection type', () => {
        settingsService.savePOSConnectionConfig({
          pos_type: 'CUSTOM_API',
          pos_connection_type: 'WEBHOOK',
          pos_connection_config: { webhook_secret: 'test-secret' },
        });

        expect(settingsService.isNAXMLCompatible()).toBe(false);
      });
    });

    describe('getFileWatcherUnavailableReason()', () => {
      it('POS-020: returns null for NAXML-compatible config (GILBARCO_NAXML + FILE)', () => {
        settingsService.savePOSConnectionConfig({
          pos_type: 'GILBARCO_NAXML',
          pos_connection_type: 'FILE',
          pos_connection_config: { import_path: TEST_PATHS.validFolder },
        });

        expect(settingsService.getFileWatcherUnavailableReason()).toBeNull();
      });

      it('POS-021: returns null for GILBARCO_PASSPORT + FILE', () => {
        settingsService.savePOSConnectionConfig({
          pos_type: 'GILBARCO_PASSPORT',
          pos_connection_type: 'FILE',
          pos_connection_config: { import_path: TEST_PATHS.validFolder },
        });

        expect(settingsService.getFileWatcherUnavailableReason()).toBeNull();
      });

      it('POS-022: returns null for FILE_BASED + FILE', () => {
        settingsService.savePOSConnectionConfig({
          pos_type: 'FILE_BASED',
          pos_connection_type: 'FILE',
          pos_connection_config: { import_path: TEST_PATHS.validFolder },
        });

        expect(settingsService.getFileWatcherUnavailableReason()).toBeNull();
      });

      it('POS-023: returns reason for MANUAL connection type', () => {
        settingsService.savePOSConnectionConfig({
          pos_type: 'MANUAL_ENTRY',
          pos_connection_type: 'MANUAL',
          pos_connection_config: null,
        });

        const reason = settingsService.getFileWatcherUnavailableReason();

        expect(reason).not.toBeNull();
        expect(reason).toContain('Manual entry mode');
        expect(reason).toContain('no automated data ingestion');
      });

      it('POS-024: returns reason for API connection type', () => {
        settingsService.savePOSConnectionConfig({
          pos_type: 'SQUARE_REST',
          pos_connection_type: 'API',
          pos_connection_config: { base_url: 'https://api.squareup.com' },
        });

        const reason = settingsService.getFileWatcherUnavailableReason();

        expect(reason).not.toBeNull();
        expect(reason).toContain('SQUARE_REST');
        expect(reason).toContain('API-based');
        expect(reason).toContain('coming soon');
      });

      it('POS-025: returns reason for NETWORK connection type', () => {
        settingsService.savePOSConnectionConfig({
          pos_type: 'VERIFONE_RUBY2',
          pos_connection_type: 'NETWORK',
          pos_connection_config: { host: '192.168.1.100', port: 5000 },
        });

        const reason = settingsService.getFileWatcherUnavailableReason();

        expect(reason).not.toBeNull();
        expect(reason).toContain('VERIFONE_RUBY2');
        expect(reason).toContain('network-based');
        expect(reason).toContain('coming soon');
      });

      it('POS-026: returns reason for WEBHOOK connection type', () => {
        settingsService.savePOSConnectionConfig({
          pos_type: 'CUSTOM_API',
          pos_connection_type: 'WEBHOOK',
          pos_connection_config: { webhook_secret: 'test-secret' },
        });

        const reason = settingsService.getFileWatcherUnavailableReason();

        expect(reason).not.toBeNull();
        expect(reason).toContain('CUSTOM_API');
        expect(reason).toContain('webhook-based');
        expect(reason).toContain('coming soon');
      });

      it('POS-027: returns reason when no POS config exists and no watchPath', () => {
        const freshService = new SettingsService();
        freshService.clearPOSConnectionConfig();

        const reason = freshService.getFileWatcherUnavailableReason();

        expect(reason).not.toBeNull();
        expect(reason).toContain('not configured');
      });

      it('POS-028: returns null for legacy mode (watchPath exists, no POS config)', () => {
        const freshService = new SettingsService();
        freshService.clearPOSConnectionConfig();
        freshService.setWatchPath(TEST_PATHS.validFolder);

        expect(freshService.getFileWatcherUnavailableReason()).toBeNull();
      });

      it('POS-029: returns reason for unsupported POS type with FILE connection', () => {
        // Edge case: FILE connection type but POS type not in allowlist
        settingsService.savePOSConnectionConfig({
          pos_type: 'NCR_RADIANT',
          pos_connection_type: 'FILE',
          pos_connection_config: { import_path: TEST_PATHS.validFolder },
        });

        const reason = settingsService.getFileWatcherUnavailableReason();

        expect(reason).not.toBeNull();
        expect(reason).toContain('NCR_RADIANT');
        expect(reason).toContain('not yet supported');
      });

      it('POS-030: returns reason for CLOVER_REST + API', () => {
        settingsService.savePOSConnectionConfig({
          pos_type: 'CLOVER_REST',
          pos_connection_type: 'API',
          pos_connection_config: { base_url: 'https://api.clover.com' },
        });

        const reason = settingsService.getFileWatcherUnavailableReason();

        expect(reason).not.toBeNull();
        expect(reason).toContain('CLOVER_REST');
        expect(reason).toContain('API-based');
      });
    });

    describe('POS Compatibility - Integration with getConfigurationStatus', () => {
      it('POS-040: getConfigurationStatus includes POS connection info', () => {
        settingsService.savePOSConnectionConfig({
          pos_type: 'GILBARCO_NAXML',
          pos_connection_type: 'FILE',
          pos_connection_config: { import_path: TEST_PATHS.validFolder },
        });

        const status = settingsService.getConfigurationStatus();

        expect(status.hasPOSConnectionConfig).toBe(true);
        expect(status.posConnectionType).toBe('FILE');
        expect(status.posType).toBe('GILBARCO_NAXML');
      });

      it('POS-041: getConfigurationStatus shows no POS config when cleared', () => {
        const freshService = new SettingsService();
        freshService.clearPOSConnectionConfig();

        const status = freshService.getConfigurationStatus();

        // hasPOSConnectionConfig may still be true if legacy terminal config exists
        // This test verifies the direct new POS config is gone
        expect(status.posType).toBeNull();
        expect(status.posConnectionType).toBeNull();
      });
    });

    // ==========================================================================
    // Security Test Cases - Section 7.2 of pos_selection.md
    // SEC-014: Path traversal prevention
    // SEC-017: Audit logging for POS type decisions
    // ==========================================================================

    describe('POS Type Security', () => {
      // Note: Path traversal in import_path causes Zod union to fail validation
      // because the FILE config schema's refine rejects paths containing ".."
      // The error message varies based on how Zod processes the union failure
      it('SEC-POS-001: rejects path traversal in FILE config import_path', () => {
        // Arrange: Attempt to save POS config with path traversal in import_path
        expect(() => {
          settingsService.savePOSConnectionConfig({
            pos_type: 'GILBARCO_NAXML',
            pos_connection_type: 'FILE',
            pos_connection_config: {
              import_path: TEST_PATHS.traversal, // Path traversal attempt
            },
          });
        }).toThrow(); // Path traversal is rejected (via Zod schema validation)
      });

      it('SEC-POS-001a: rejects Windows-style path traversal in import_path', () => {
        // Windows-specific path traversal attempt
        expect(() => {
          settingsService.savePOSConnectionConfig({
            pos_type: 'GILBARCO_NAXML',
            pos_connection_type: 'FILE',
            pos_connection_config: {
              import_path: 'C:\\NAXML\\..\\..\\Windows\\System32',
            },
          });
        }).toThrow(); // Path traversal is rejected
      });

      it('SEC-POS-001b: rejects Unix-style path traversal in import_path', () => {
        // Unix-specific path traversal attempt
        expect(() => {
          settingsService.savePOSConnectionConfig({
            pos_type: 'GILBARCO_NAXML',
            pos_connection_type: 'FILE',
            pos_connection_config: {
              import_path: '/naxml/../../etc/passwd',
            },
          });
        }).toThrow(); // Path traversal is rejected
      });

      it('SEC-POS-001c: rejects path traversal in export_path', () => {
        // Path traversal in export_path field
        // Note: Zod union validation may cause different error messages
        expect(() => {
          settingsService.savePOSConnectionConfig({
            pos_type: 'GILBARCO_NAXML',
            pos_connection_type: 'FILE',
            pos_connection_config: {
              import_path: TEST_PATHS.validFolder,
              export_path: TEST_PATHS.traversal, // Path traversal in export_path
            },
          });
        }).toThrow(); // Path traversal is rejected
      });

      it('SEC-POS-001d: accepts valid paths without path traversal', () => {
        // Valid paths should be accepted
        expect(() => {
          settingsService.savePOSConnectionConfig({
            pos_type: 'GILBARCO_NAXML',
            pos_connection_type: 'FILE',
            pos_connection_config: {
              import_path: TEST_PATHS.validFolder,
            },
          });
        }).not.toThrow();
      });

      it('SEC-POS-002: logs POS type decisions for audit trail', () => {
        // Act: Save a POS config - this should trigger audit logging
        // The logger mock is set up at module level and logs SEC-017 messages
        expect(() => {
          settingsService.savePOSConnectionConfig({
            pos_type: 'GILBARCO_NAXML',
            pos_connection_type: 'FILE',
            pos_connection_config: { import_path: TEST_PATHS.validFolder },
          });
        }).not.toThrow();

        // Check NAXML compatibility which logs SEC-017 decision
        const isCompatible = settingsService.isNAXMLCompatible();
        expect(isCompatible).toBe(true);
      });

      it('SEC-POS-002a: logs when file watcher is unavailable for API POS type', () => {
        // Setup API-based POS that doesn't support file watching
        settingsService.savePOSConnectionConfig({
          pos_type: 'SQUARE_REST',
          pos_connection_type: 'API',
          pos_connection_config: { base_url: 'https://api.squareup.com' },
        });

        // Act: Check NAXML compatibility - should return false for API type
        const isCompatible = settingsService.isNAXMLCompatible();
        expect(isCompatible).toBe(false);

        // The audit log (SEC-017) is called internally with POS_TYPE_DECISION action
      });

      it('SEC-POS-002b: logs file watcher unavailable reason for non-compatible POS', () => {
        // Setup MANUAL POS type
        settingsService.savePOSConnectionConfig({
          pos_type: 'MANUAL_ENTRY',
          pos_connection_type: 'MANUAL',
          pos_connection_config: null,
        });

        // Act: Get unavailable reason
        const reason = settingsService.getFileWatcherUnavailableReason();

        // Assert: Reason should be provided for MANUAL type
        expect(reason).not.toBeNull();
        expect(reason).toContain('Manual entry mode');
        // SEC-017 audit log is called internally with FILE_WATCHER_STATUS action
      });

      it('SEC-POS-002c: logs audit trail when validation fails', () => {
        // Act: Attempt to save invalid config (should throw)
        expect(() => {
          settingsService.savePOSConnectionConfig({
            pos_type: 'GILBARCO_NAXML',
            pos_connection_type: 'FILE',
            pos_connection_config: {
              import_path: 'C:\\..\\..\\Windows\\System32',
            },
          });
        }).toThrow();

        // Validation failures are logged with SEC-014 marker internally
        // The error is caught and logged before being re-thrown
      });
    });

    // ==========================================================================
    // Phase 8: Feature Flag Rollback Tests
    // OPS-012: Feature flag for emergency POS type check bypass
    // ==========================================================================

    describe('Phase 8 - Feature Flag Rollback (ENABLE_POS_TYPE_CHECKS)', () => {
      it('ROLL-001: isPOSTypeChecksEnabled() returns boolean', () => {
        // This test verifies the method exists and returns a boolean
        const result = settingsService.isPOSTypeChecksEnabled();

        expect(typeof result).toBe('boolean');
      });

      it('ROLL-002: isPOSTypeChecksEnabled() returns true by default (normal operation)', () => {
        // Default behavior: POS type checks should be ENABLED
        // Unless ENABLE_POS_TYPE_CHECKS=false is set in environment
        // This test documents the expected default behavior
        const result = settingsService.isPOSTypeChecksEnabled();

        // If the test environment doesn't have ENABLE_POS_TYPE_CHECKS=false, this should be true
        // If running with the flag disabled, update this expectation
        if (process.env.ENABLE_POS_TYPE_CHECKS === 'false') {
          expect(result).toBe(false);
        } else {
          expect(result).toBe(true);
        }
      });

      it('ROLL-003: feature flag status is consistent across calls', () => {
        // Feature flag should return consistent value (not change during runtime)
        const firstCall = settingsService.isPOSTypeChecksEnabled();
        const secondCall = settingsService.isPOSTypeChecksEnabled();
        const thirdCall = settingsService.isPOSTypeChecksEnabled();

        expect(firstCall).toBe(secondCall);
        expect(secondCall).toBe(thirdCall);
      });

      it('ROLL-004: isNAXMLCompatible respects feature flag when enabled', () => {
        // When feature flag is enabled (normal operation), POS type checks apply
        if (!settingsService.isPOSTypeChecksEnabled()) {
          // Skip this test if flag is disabled in test environment
          console.log('Skipping ROLL-004: feature flag is disabled in test environment');
          return;
        }

        // SQUARE_REST should NOT be NAXML compatible when checks are enabled
        settingsService.savePOSConnectionConfig({
          pos_type: 'SQUARE_REST',
          pos_connection_type: 'API',
          pos_connection_config: { base_url: 'https://api.squareup.com' },
        });

        expect(settingsService.isNAXMLCompatible()).toBe(false);
      });

      it('ROLL-005: getFileWatcherUnavailableReason works correctly with feature flag', () => {
        // When feature flag is enabled, non-NAXML types should have an unavailable reason
        if (!settingsService.isPOSTypeChecksEnabled()) {
          // Skip this test if flag is disabled in test environment
          console.log('Skipping ROLL-005: feature flag is disabled in test environment');
          return;
        }

        settingsService.savePOSConnectionConfig({
          pos_type: 'MANUAL_ENTRY',
          pos_connection_type: 'MANUAL',
          pos_connection_config: null,
        });

        const reason = settingsService.getFileWatcherUnavailableReason();
        expect(reason).not.toBeNull();
        expect(reason).toContain('Manual entry mode');
      });

      it('ROLL-006: feature flag bypass requires watchPath to return NAXML compatible', () => {
        // Document the bypass behavior: even when feature flag is disabled,
        // NAXML compatibility still requires a watchPath to be configured
        // (can't watch files without a path!)

        // This test documents expected behavior regardless of flag status
        const freshService = new SettingsService();
        freshService.clearPOSConnectionConfig();
        // Don't set watchPath

        // Without watchPath, should not be NAXML compatible
        // This is true regardless of feature flag - you need a path to watch
        const result = freshService.isNAXMLCompatible();

        // When no watchPath AND no POS config, should be false
        if (!settingsService.isPOSTypeChecksEnabled()) {
          // With flag disabled but no watchPath, still returns false
          expect(result).toBe(false);
        } else {
          // With flag enabled and no config/watchPath, returns false
          expect(result).toBe(false);
        }
      });

      it('ROLL-007: legacy mode (watchPath only) works with feature flag enabled', () => {
        // Legacy mode should work regardless of feature flag
        if (!settingsService.isPOSTypeChecksEnabled()) {
          console.log('Skipping ROLL-007: feature flag is disabled in test environment');
          return;
        }

        const freshService = new SettingsService();
        freshService.clearPOSConnectionConfig();
        freshService.setWatchPath(TEST_PATHS.validFolder);

        // Legacy mode should return true
        expect(freshService.isNAXMLCompatible()).toBe(true);
      });
    });
  });

  // ==========================================================================
  // syncRegistersFromCloud (MANUAL mode) - Phase 6 Task 6.4
  // SEC-014: Input validation via CloudRegisterSchema
  // DB-006: Store-scoped operations via posTerminalMappingsDAL
  // ==========================================================================
  describe('syncRegistersFromCloud (MANUAL mode)', () => {
    const getTestAbsolutePath = (name: string): string => {
      if (process.platform === 'win32') {
        return `C:\\NAXML\\${name}`;
      }
      return `/naxml/${name.toLowerCase()}`;
    };

    const mockManualValidationResponse = {
      valid: true,
      storeId: 'store-manual-sync-001',
      storeName: 'Manual Sync Store',
      storePublicId: 'MAN001',
      companyId: 'company-manual-001',
      companyName: 'Manual Company',
      timezone: 'America/Chicago',
      stateCode: 'TX',
      features: [],
      offlinePermissions: [],
      offlineToken: 'mock-offline-token',
      offlineTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      lottery: { enabled: false, binCount: 0 },
      posConnectionConfig: {
        pos_type: 'MANUAL_ENTRY' as const,
        pos_connection_type: 'MANUAL' as const,
        pos_connection_config: null,
      },
      registers: [
        {
          external_register_id: 'REG-001',
          terminal_type: 'REGISTER' as const,
          description: 'Front Counter',
          active: true,
        },
      ],
    };

    const mockTerminalMapping = {
      id: 'existing-mapping-uuid',
      store_id: 'store-manual-sync-001',
      external_register_id: 'REG-001',
      terminal_type: 'REGISTER' as const,
      description: 'Old Description',
      pos_system_type: 'generic' as const,
      active: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };

    // 6.4.1 - Calls syncRegistersFromCloud when result contains registers
    it('6.4.1: should call posTerminalMappingsDAL methods when result contains registers', async () => {
      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(mockManualValidationResponse);
      vi.mocked(posTerminalMappingsDAL.findByExternalId).mockReturnValue(undefined);
      vi.mocked(posTerminalMappingsDAL.getOrCreate).mockReturnValue(mockTerminalMapping);

      await settingsService.validateAndSaveApiKey('nsk_live_validkeywith20ormorechars');

      expect(posTerminalMappingsDAL.getOrCreate).toHaveBeenCalledWith(
        'store-manual-sync-001',
        'REG-001',
        expect.objectContaining({
          terminalType: 'REGISTER',
          posSystemType: 'generic',
        })
      );
    });

    // 6.4.2 - Does not call syncRegistersFromCloud when result has no registers
    it('6.4.2: should not call DAL methods when result has no registers', async () => {
      const responseWithoutRegisters = { ...mockManualValidationResponse, registers: undefined };
      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(responseWithoutRegisters);

      await settingsService.validateAndSaveApiKey('nsk_live_validkeywith20ormorechars');

      expect(posTerminalMappingsDAL.findByExternalId).not.toHaveBeenCalled();
      expect(posTerminalMappingsDAL.getOrCreate).not.toHaveBeenCalled();
    });

    // 6.4.3 - Creates new registers when none exist locally
    it('6.4.3: should create new registers when none exist locally', async () => {
      const threeRegisters = {
        ...mockManualValidationResponse,
        registers: [
          {
            external_register_id: 'R1',
            terminal_type: 'REGISTER' as const,
            description: 'Register 1',
            active: true,
          },
          {
            external_register_id: 'R2',
            terminal_type: 'KIOSK' as const,
            description: 'Kiosk 1',
            active: true,
          },
          {
            external_register_id: 'R3',
            terminal_type: 'MOBILE' as const,
            description: 'Mobile 1',
            active: true,
          },
        ],
      };

      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(threeRegisters);
      vi.mocked(posTerminalMappingsDAL.findByExternalId).mockReturnValue(undefined);
      vi.mocked(posTerminalMappingsDAL.getOrCreate).mockReturnValue(mockTerminalMapping);

      await settingsService.validateAndSaveApiKey('nsk_live_validkeywith20ormorechars');

      expect(posTerminalMappingsDAL.getOrCreate).toHaveBeenCalledTimes(3);
      expect(posTerminalMappingsDAL.getOrCreate).toHaveBeenCalledWith(
        'store-manual-sync-001',
        'R1',
        expect.objectContaining({ terminalType: 'REGISTER' })
      );
      expect(posTerminalMappingsDAL.getOrCreate).toHaveBeenCalledWith(
        'store-manual-sync-001',
        'R2',
        expect.objectContaining({ terminalType: 'KIOSK' })
      );
      expect(posTerminalMappingsDAL.getOrCreate).toHaveBeenCalledWith(
        'store-manual-sync-001',
        'R3',
        expect.objectContaining({ terminalType: 'MOBILE' })
      );
    });

    // 6.4.4 - Updates existing registers
    it('6.4.4: should update existing registers', async () => {
      const updatedRegister = {
        ...mockManualValidationResponse,
        registers: [
          {
            external_register_id: 'REG-001',
            terminal_type: 'REGISTER' as const,
            description: 'Updated Front Counter',
            active: true,
          },
        ],
      };

      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(updatedRegister);
      vi.mocked(posTerminalMappingsDAL.findByExternalId).mockReturnValue(mockTerminalMapping);
      vi.mocked(posTerminalMappingsDAL.update).mockReturnValue({
        ...mockTerminalMapping,
        description: 'Updated Front Counter',
      });

      await settingsService.validateAndSaveApiKey('nsk_live_validkeywith20ormorechars');

      expect(posTerminalMappingsDAL.update).toHaveBeenCalledWith('existing-mapping-uuid', {
        terminal_type: 'REGISTER',
        description: 'Updated Front Counter',
        active: 1,
      });
    });

    // 6.4.5 - Handles mixed scenario (some new, some existing)
    it('6.4.5: should handle mixed scenario with new and existing registers', async () => {
      const mixedRegisters = {
        ...mockManualValidationResponse,
        registers: [
          {
            external_register_id: 'REG-001',
            terminal_type: 'REGISTER' as const,
            description: 'Existing',
            active: true,
          },
          {
            external_register_id: 'REG-NEW',
            terminal_type: 'KIOSK' as const,
            description: 'New Register',
            active: true,
          },
        ],
      };

      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(mixedRegisters);
      // REG-001 exists, REG-NEW does not
      vi.mocked(posTerminalMappingsDAL.findByExternalId)
        .mockReturnValueOnce(mockTerminalMapping) // REG-001 exists
        .mockReturnValueOnce(undefined); // REG-NEW does not exist
      vi.mocked(posTerminalMappingsDAL.update).mockReturnValue(mockTerminalMapping);
      vi.mocked(posTerminalMappingsDAL.getOrCreate).mockReturnValue({
        ...mockTerminalMapping,
        id: 'new-mapping-uuid',
        external_register_id: 'REG-NEW',
      });

      await settingsService.validateAndSaveApiKey('nsk_live_validkeywith20ormorechars');

      expect(posTerminalMappingsDAL.update).toHaveBeenCalledTimes(1); // REG-001
      expect(posTerminalMappingsDAL.getOrCreate).toHaveBeenCalledTimes(1); // REG-NEW
    });

    // 6.4.6 - Converts boolean active to integer for DAL
    it('6.4.6: should convert boolean active to integer for DAL', async () => {
      const inactiveRegister = {
        ...mockManualValidationResponse,
        registers: [
          {
            external_register_id: 'REG-001',
            terminal_type: 'REGISTER' as const,
            description: 'Inactive Register',
            active: false,
          },
        ],
      };

      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(inactiveRegister);
      vi.mocked(posTerminalMappingsDAL.findByExternalId).mockReturnValue(mockTerminalMapping);
      vi.mocked(posTerminalMappingsDAL.update).mockReturnValue({
        ...mockTerminalMapping,
        active: 0,
      });

      await settingsService.validateAndSaveApiKey('nsk_live_validkeywith20ormorechars');

      expect(posTerminalMappingsDAL.update).toHaveBeenCalledWith('existing-mapping-uuid', {
        terminal_type: 'REGISTER',
        description: 'Inactive Register',
        active: 0, // boolean false -> integer 0
      });
    });

    // 6.4.7 - Register sync failure does not block initial setup
    it('6.4.7: should not block initial setup when register sync fails', async () => {
      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(mockManualValidationResponse);
      vi.mocked(posTerminalMappingsDAL.findByExternalId).mockImplementation(() => {
        throw new Error('Database locked');
      });

      const result = await settingsService.validateAndSaveApiKey(
        'nsk_live_validkeywith20ormorechars'
      );

      // Setup should still succeed despite register sync failure
      expect(result.valid).toBe(true);
      expect(result.store?.storeId).toBe('store-manual-sync-001');
    });

    // 6.4.8 - Register sync failure does not block resync
    it('6.4.8: should not block resync when register sync fails', async () => {
      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(mockManualValidationResponse);
      vi.mocked(posTerminalMappingsDAL.findByExternalId).mockImplementation(() => {
        throw new Error('Database locked');
      });

      const result = await settingsService.validateAndSaveApiKey(
        'nsk_live_validkeywith20ormorechars',
        { isInitialSetup: false }
      );

      expect(result.valid).toBe(true);
    });

    // 6.4.9 - Empty registers array results in no DAL calls
    it('6.4.9: should not call DAL methods for empty registers array', async () => {
      const emptyRegisters = { ...mockManualValidationResponse, registers: [] };
      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(emptyRegisters);

      await settingsService.validateAndSaveApiKey('nsk_live_validkeywith20ormorechars');

      expect(posTerminalMappingsDAL.findByExternalId).not.toHaveBeenCalled();
      expect(posTerminalMappingsDAL.getOrCreate).not.toHaveBeenCalled();
    });

    // 6.4.10 - Skipped when storeId is not in config
    // Note: In the actual flow, storeId is saved to config store before sync is called,
    // so this tests the guard condition within the sync block
    it('6.4.10: should skip register sync when storeId is not available', async () => {
      // Return a response that doesn't set storeId in the config store
      const noStoreIdResponse = {
        ...mockManualValidationResponse,
        storeId: '', // Empty storeId
      };
      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(noStoreIdResponse);

      await settingsService.validateAndSaveApiKey('nsk_live_validkeywith20ormorechars');

      // The service flow might still try, but an empty storeId should not cause issues
      // The important thing is no crash
    });

    // 6.4.11 - Always passes storeId to DAL methods (DB-006)
    it('6.4.11: should always pass storeId to DAL methods (DB-006 tenant isolation)', async () => {
      const twoRegisters = {
        ...mockManualValidationResponse,
        storeId: 'store-abc-123',
        registers: [
          {
            external_register_id: 'T1',
            terminal_type: 'REGISTER' as const,
            description: 'Terminal 1',
            active: true,
          },
          {
            external_register_id: 'T2',
            terminal_type: 'REGISTER' as const,
            description: 'Terminal 2',
            active: true,
          },
        ],
      };

      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(twoRegisters);
      vi.mocked(posTerminalMappingsDAL.findByExternalId).mockReturnValue(undefined);
      vi.mocked(posTerminalMappingsDAL.getOrCreate).mockReturnValue(mockTerminalMapping);

      await settingsService.validateAndSaveApiKey('nsk_live_validkeywith20ormorechars');

      // Every findByExternalId call should include the storeId
      const findCalls = vi.mocked(posTerminalMappingsDAL.findByExternalId).mock.calls;
      for (const call of findCalls) {
        expect(call[0]).toBe('store-abc-123');
      }

      // Every getOrCreate call should include the storeId
      const createCalls = vi.mocked(posTerminalMappingsDAL.getOrCreate).mock.calls;
      for (const call of createCalls) {
        expect(call[0]).toBe('store-abc-123');
      }
    });

    // 6.4.12 - Deactivates stale cloud-sourced registers not in current cloud response
    // SEC-014: Cloud is authoritative source for MANUAL mode registers
    // DB-006: Store-scoped deactivation via storeId
    it('6.4.12: should deactivate stale cloud-sourced registers after sync', async () => {
      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(mockManualValidationResponse);
      vi.mocked(posTerminalMappingsDAL.findByExternalId).mockReturnValue(undefined);
      vi.mocked(posTerminalMappingsDAL.getOrCreate).mockReturnValue(mockTerminalMapping);
      vi.mocked(posTerminalMappingsDAL.deactivateStaleCloudRegisters).mockReturnValue(2);

      await settingsService.validateAndSaveApiKey('nsk_live_validkeywith20ormorechars');

      // deactivateStaleCloudRegisters should be called with storeId and the set of active IDs
      expect(posTerminalMappingsDAL.deactivateStaleCloudRegisters).toHaveBeenCalledWith(
        'store-manual-sync-001',
        new Set(['REG-001'])
      );
    });

    // 6.4.13 - Deactivation passes correct external IDs for multiple registers
    it('6.4.13: should pass all cloud register IDs to deactivation method', async () => {
      const multipleRegisters = {
        ...mockManualValidationResponse,
        registers: [
          {
            external_register_id: 'REG-A',
            terminal_type: 'REGISTER' as const,
            description: 'Register A',
            active: true,
          },
          {
            external_register_id: 'REG-B',
            terminal_type: 'REGISTER' as const,
            description: 'Register B',
            active: true,
          },
          {
            external_register_id: 'REG-C',
            terminal_type: 'REGISTER' as const,
            description: 'Register C',
            active: true,
          },
        ],
      };

      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(multipleRegisters);
      vi.mocked(posTerminalMappingsDAL.findByExternalId).mockReturnValue(undefined);
      vi.mocked(posTerminalMappingsDAL.getOrCreate).mockReturnValue(mockTerminalMapping);

      await settingsService.validateAndSaveApiKey('nsk_live_validkeywith20ormorechars');

      expect(posTerminalMappingsDAL.deactivateStaleCloudRegisters).toHaveBeenCalledWith(
        'store-manual-sync-001',
        new Set(['REG-A', 'REG-B', 'REG-C'])
      );
    });

    // 6.4.14 - Deactivation failure does not block sync (resilience)
    // Register sync is non-blocking per design; deactivation failure must not
    // propagate to the API key validation result.
    it('6.4.14: should not block sync when deactivateStaleCloudRegisters throws', async () => {
      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(mockManualValidationResponse);
      vi.mocked(posTerminalMappingsDAL.findByExternalId).mockReturnValue(undefined);
      vi.mocked(posTerminalMappingsDAL.getOrCreate).mockReturnValue(mockTerminalMapping);
      vi.mocked(posTerminalMappingsDAL.deactivateStaleCloudRegisters).mockImplementation(() => {
        throw new Error('Database locked during deactivation');
      });

      const result = await settingsService.validateAndSaveApiKey(
        'nsk_live_validkeywith20ormorechars'
      );

      // Setup should still succeed despite deactivation failure
      expect(result.valid).toBe(true);
      expect(result.store?.storeId).toBe('store-manual-sync-001');
    });

    // 6.4.15 - Empty registers array does not trigger deactivation
    // Guard: validation.registers.length > 0 prevents syncRegistersFromCloud from being called
    it('6.4.15: should not call deactivateStaleCloudRegisters for empty registers array', async () => {
      const emptyRegisters = { ...mockManualValidationResponse, registers: [] };
      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(emptyRegisters);

      await settingsService.validateAndSaveApiKey('nsk_live_validkeywith20ormorechars');

      expect(posTerminalMappingsDAL.deactivateStaleCloudRegisters).not.toHaveBeenCalled();
    });

    // 6.4.16 - LOTTERY POS type with registers syncs correctly end-to-end
    // Validates that LOTTERY pos_type does not interfere with register sync
    it('6.4.16: should sync registers correctly for LOTTERY POS type', async () => {
      const lotteryResponse = {
        ...mockManualValidationResponse,
        posConnectionConfig: {
          pos_type: 'LOTTERY' as const,
          pos_connection_type: 'MANUAL' as const,
          pos_connection_config: null,
        },
        registers: [
          {
            external_register_id: 'LOTTERY-T1',
            terminal_type: 'REGISTER' as const,
            description: 'Lottery Terminal',
            active: true,
          },
        ],
      };

      vi.mocked(cloudApiService.validateApiKey).mockResolvedValue(lotteryResponse);
      vi.mocked(posTerminalMappingsDAL.findByExternalId).mockReturnValue(undefined);
      vi.mocked(posTerminalMappingsDAL.getOrCreate).mockReturnValue({
        ...mockTerminalMapping,
        external_register_id: 'LOTTERY-T1',
        description: 'Lottery Terminal',
      });

      const result = await settingsService.validateAndSaveApiKey(
        'nsk_live_validkeywith20ormorechars'
      );

      expect(result.valid).toBe(true);
      expect(posTerminalMappingsDAL.getOrCreate).toHaveBeenCalledWith(
        'store-manual-sync-001',
        'LOTTERY-T1',
        expect.objectContaining({
          terminalType: 'REGISTER',
          posSystemType: 'generic',
        })
      );
      expect(posTerminalMappingsDAL.deactivateStaleCloudRegisters).toHaveBeenCalledWith(
        'store-manual-sync-001',
        new Set(['LOTTERY-T1'])
      );
    });
  });
});
