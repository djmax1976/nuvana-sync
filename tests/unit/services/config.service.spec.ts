/**
 * Config Service Unit Tests
 *
 * Tests for configuration management functionality.
 * Validates SEC-007: Secrets stored encrypted via safeStorage
 * Validates SEC-014: Input validation via Zod schemas
 *
 * @module tests/unit/services/config.service
 */

// Using vitest globals (configured in vitest.config.ts)

// Mock electron
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((str: string) => Buffer.from(`encrypted:${str}`)),
    decryptString: vi.fn((buf: Buffer) => {
      const str = buf.toString();
      if (str.startsWith('encrypted:')) {
        return str.replace('encrypted:', '');
      }
      throw new Error('Decryption failed');
    }),
  },
}));

// Mock electron-store with internal store
vi.mock('electron-store', () => {
  const internalStore = new Map<string, unknown>();
  class MockStore {
    static __store = internalStore;
    get store() {
      return Object.fromEntries(internalStore);
    }
    set store(val: Record<string, unknown>) {
      internalStore.clear();
      Object.entries(val).forEach(([k, v]) => internalStore.set(k, v));
    }
    get(key: string, defaultVal?: unknown) {
      return internalStore.get(key) ?? defaultVal;
    }
    set(key: string, value: unknown) {
      internalStore.set(key, value);
    }
    clear() {
      internalStore.clear();
    }
  }
  return { default: MockStore };
});

// Mock the logger
vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { ConfigService } from '../../../src/main/services/config.service';
import { DEFAULT_CONFIG } from '../../../src/shared/types/config.types';
import { safeStorage } from 'electron';
import MockStore from 'electron-store';

// Get access to the internal store
const mockStore = (MockStore as unknown as { __store: Map<string, unknown> }).__store;
const mockedSafeStorage = vi.mocked(safeStorage);

describe('ConfigService', () => {
  let configService: ConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.clear();
    mockedSafeStorage.isEncryptionAvailable.mockReturnValue(true);
    // Set default values
    Object.entries(DEFAULT_CONFIG).forEach(([k, v]) => mockStore.set(k, v));
    configService = new ConfigService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize the store with default config', () => {
      expect(configService).toBeDefined();
    });
  });

  describe('getConfig', () => {
    it('should return the current configuration', () => {
      const config = configService.getConfig();
      expect(config).toBeDefined();
      expect(config.pollInterval).toBe(5);
    });

    it('should decrypt API key when encryption is available', () => {
      // Set an encrypted API key in store
      const encryptedKey = Buffer.from('encrypted:my-secret-key').toString('base64');
      mockStore.set('apiKey', encryptedKey);

      // Create a fresh instance to pick up the new store state
      const service = new ConfigService();
      const config = service.getConfig();
      expect(config.apiKey).toBe('my-secret-key');
    });

    it('should return raw API key when decryption fails', () => {
      // Set a non-encrypted key that will fail decryption
      const rawKey = Buffer.from('raw-key-not-encrypted').toString('base64');
      mockStore.set('apiKey', rawKey);

      const service = new ConfigService();
      const config = service.getConfig();
      // Should return the raw value when decryption fails
      expect(config.apiKey).toBe(rawKey);
    });

    it('should return config without decryption when encryption unavailable', () => {
      mockedSafeStorage.isEncryptionAvailable.mockReturnValue(false);
      mockStore.set('apiKey', 'plain-key');

      const service = new ConfigService();
      const config = service.getConfig();
      expect(config.apiKey).toBe('plain-key');
    });

    it('should return config when no API key is set', () => {
      mockStore.set('apiKey', '');

      const service = new ConfigService();
      const config = service.getConfig();
      expect(config.apiKey).toBe('');
    });
  });

  describe('saveConfig', () => {
    it('should save valid configuration', () => {
      const update = {
        apiUrl: 'https://api.example.com',
        apiKey: 'valid-api-key_123',
        storeId: 'store-123',
        watchPath: 'C:/data/watch',
      };

      configService.saveConfig(update);

      expect(mockStore.get('apiUrl')).toBe('https://api.example.com');
      expect(mockStore.get('storeId')).toBe('store-123');
      expect(mockStore.get('watchPath')).toBe('C:/data/watch');
    });

    it('should encrypt API key when saving', () => {
      const update = {
        apiKey: 'my-secret-key',
      };

      configService.saveConfig(update);

      // The stored value should be base64 encoded encrypted string
      const stored = mockStore.get('apiKey') as string;
      expect(stored).toContain('ZW5jcnlwdGVk'); // base64 of "encrypted"
    });

    it('should not encrypt API key when encryption unavailable', () => {
      mockedSafeStorage.isEncryptionAvailable.mockReturnValue(false);
      const update = {
        apiKey: 'plain-key',
      };

      configService.saveConfig(update);

      expect(mockStore.get('apiKey')).toBe('plain-key');
    });

    it('should throw error for invalid API URL', () => {
      const update = {
        apiUrl: 'http://insecure.com', // Not HTTPS
      };

      expect(() => configService.saveConfig(update)).toThrow('Invalid configuration');
    });

    it('should throw error for invalid store ID with special characters', () => {
      const update = {
        storeId: 'store<script>alert(1)</script>',
      };

      expect(() => configService.saveConfig(update)).toThrow('Invalid configuration');
    });

    it('should throw error for path traversal attempt', () => {
      const update = {
        watchPath: '../../../etc/passwd',
      };

      expect(() => configService.saveConfig(update)).toThrow('Invalid configuration');
    });

    it('should throw error for poll interval out of range', () => {
      const update = {
        pollInterval: 0,
      };

      expect(() => configService.saveConfig(update)).toThrow('Invalid configuration');
    });

    it('should set isConfigured to true when all required fields present', () => {
      configService.saveConfig({
        apiUrl: 'https://api.example.com',
        apiKey: 'valid-key',
        storeId: 'store-123',
        watchPath: 'C:/watch',
      });

      expect(mockStore.get('isConfigured')).toBe(true);
    });

    it('should keep isConfigured false when required fields missing', () => {
      configService.saveConfig({
        apiUrl: 'https://api.example.com',
        // Missing apiKey, storeId, watchPath
      });

      expect(mockStore.get('isConfigured')).toBe(false);
    });
  });

  describe('resetConfig', () => {
    it('should clear the store', () => {
      mockStore.set('apiUrl', 'https://api.example.com');
      mockStore.set('apiKey', 'some-key');

      configService.resetConfig();

      // After reset, store should be empty (defaults would be re-applied on next access)
      expect(mockStore.size).toBe(0);
    });
  });

  describe('isConfigured', () => {
    it('should return true when configured', () => {
      mockStore.set('isConfigured', true);

      expect(configService.isConfigured()).toBe(true);
    });

    it('should return false when not configured', () => {
      mockStore.set('isConfigured', false);

      expect(configService.isConfigured()).toBe(false);
    });

    it('should return false by default', () => {
      mockStore.delete('isConfigured');

      expect(configService.isConfigured()).toBe(false);
    });
  });

  describe('get', () => {
    it('should return specific config value', () => {
      mockStore.set('pollInterval', 10);

      const value = configService.get('pollInterval');

      expect(value).toBe(10);
    });

    it('should return enabledFileTypes', () => {
      const fileTypes = { pjr: true, fgm: false, msm: true, fpm: true, mcm: false, tlm: false };
      mockStore.set('enabledFileTypes', fileTypes);

      const value = configService.get('enabledFileTypes');

      expect(value).toEqual(fileTypes);
    });
  });

  describe('set', () => {
    it('should set specific config value with validation', () => {
      configService.set('pollInterval', 30);

      expect(mockStore.get('pollInterval')).toBe(30);
    });

    it('should throw error for invalid value', () => {
      expect(() => configService.set('pollInterval', -1)).toThrow('Invalid value');
    });

    it('should set boolean values', () => {
      configService.set('startOnLogin', false);

      expect(mockStore.get('startOnLogin')).toBe(false);
    });

    it('should set string values with validation', () => {
      configService.set('apiUrl', 'https://api.nuvana.com');

      expect(mockStore.get('apiUrl')).toBe('https://api.nuvana.com');
    });

    it('should throw for invalid API URL protocol', () => {
      expect(() => configService.set('apiUrl', 'http://insecure.com')).toThrow('Invalid value');
    });
  });

  describe('security validations', () => {
    it('should accept API keys with special characters (for encrypted storage)', () => {
      // API key field allows any characters since it stores encrypted values
      // which may contain base64 or other special characters
      expect(() =>
        configService.saveConfig({
          apiKey: 'key_with-special.chars',
        })
      ).not.toThrow();
    });

    it('should accept valid API key format', () => {
      expect(() =>
        configService.saveConfig({
          apiKey: 'valid_api-key.123',
        })
      ).not.toThrow();
    });

    it('should reject paths with tilde', () => {
      expect(() =>
        configService.saveConfig({
          watchPath: '~/Documents/data',
        })
      ).toThrow('Invalid configuration');
    });

    it('should reject paths with invalid Windows characters', () => {
      expect(() =>
        configService.saveConfig({
          watchPath: 'C:/data<>file',
        })
      ).toThrow('Invalid configuration');
    });

    it('should accept valid Windows path', () => {
      expect(() =>
        configService.saveConfig({
          watchPath: 'C:/Users/Admin/Documents/Nuvana',
        })
      ).not.toThrow();
    });
  });
});
