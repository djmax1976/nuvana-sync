/**
 * Key Manager Service Unit Tests
 *
 * Tests for secure key generation and storage using Electron safeStorage.
 *
 * @module tests/unit/key-manager.service.spec
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Electron modules before importing the service
vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '\\mock\\user\\data'),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

// Create a shared mock store instance that persists across tests
// This is necessary because key-manager.service uses a module-level singleton
const sharedMockStore = {
  get: vi.fn(),
  set: vi.fn(),
  has: vi.fn(),
  delete: vi.fn(),
};

vi.mock('electron-store', () => {
  return {
    default: vi.fn().mockImplementation(() => sharedMockStore),
  };
});

// Import after mocks are set up
import { safeStorage } from 'electron';

// Import the module under test
import {
  getOrCreateDatabaseKey,
  isKeyAvailable,
  clearDatabaseKey,
  hasDatabaseKey,
  rotateKey,
  commitKeyRotation,
} from '../../src/main/services/key-manager.service';

describe('KeyManagerService', () => {
  // Reference the shared mock store
  const mockStore = sharedMockStore;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock implementations (not the mock store object itself)
    mockStore.get.mockReset();
    mockStore.set.mockReset();
    mockStore.has.mockReset();
    mockStore.delete.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('isKeyAvailable', () => {
    it('should return true when safeStorage is available', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);

      const result = isKeyAvailable();

      expect(result).toBe(true);
      expect(safeStorage.isEncryptionAvailable).toHaveBeenCalled();
    });

    it('should return false when safeStorage is not available', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);

      const result = isKeyAvailable();

      expect(result).toBe(false);
    });
  });

  describe('getOrCreateDatabaseKey', () => {
    it('should generate a new 64-character hex key on first run', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      mockStore.get.mockReturnValue(undefined);
      vi.mocked(safeStorage.encryptString).mockReturnValue(Buffer.from('encrypted'));

      const key = getOrCreateDatabaseKey();

      // Key should be 64 characters (32 bytes in hex)
      expect(key).toHaveLength(64);
      // Key should be valid hex
      expect(/^[a-f0-9]+$/i.test(key)).toBe(true);
      // Should have encrypted and stored the key
      expect(safeStorage.encryptString).toHaveBeenCalledWith(key);
      expect(mockStore.set).toHaveBeenCalled();
    });

    it('should return existing key on subsequent runs', () => {
      const existingKey = 'a'.repeat(64);
      const encryptedData = [1, 2, 3, 4, 5]; // Mock encrypted buffer data

      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      mockStore.get.mockReturnValue(encryptedData);
      vi.mocked(safeStorage.decryptString).mockReturnValue(existingKey);

      const key = getOrCreateDatabaseKey();

      expect(key).toBe(existingKey);
      expect(safeStorage.decryptString).toHaveBeenCalled();
      // Should not create new key
      expect(safeStorage.encryptString).not.toHaveBeenCalled();
    });

    it('should use safeStorage for encryption', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      mockStore.get.mockReturnValue(undefined);
      vi.mocked(safeStorage.encryptString).mockReturnValue(Buffer.from('encrypted'));

      getOrCreateDatabaseKey();

      expect(safeStorage.encryptString).toHaveBeenCalled();
    });

    it('should throw if safeStorage is not available', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);

      expect(() => getOrCreateDatabaseKey()).toThrow('SafeStorage encryption is not available');
    });

    it('should generate new key if stored key is invalid format', () => {
      const invalidKey = 'not-valid-hex';
      const encryptedData = [1, 2, 3];

      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      mockStore.get.mockReturnValue(encryptedData);
      vi.mocked(safeStorage.decryptString).mockReturnValue(invalidKey);
      vi.mocked(safeStorage.encryptString).mockReturnValue(Buffer.from('new-encrypted'));

      const key = getOrCreateDatabaseKey();

      // Should generate new valid key
      expect(key).toHaveLength(64);
      expect(/^[a-f0-9]+$/i.test(key)).toBe(true);
      expect(safeStorage.encryptString).toHaveBeenCalled();
    });

    it('should generate new key if decryption fails', () => {
      const encryptedData = [1, 2, 3];

      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      mockStore.get.mockReturnValue(encryptedData);
      vi.mocked(safeStorage.decryptString).mockImplementation(() => {
        throw new Error('Decryption failed');
      });
      vi.mocked(safeStorage.encryptString).mockReturnValue(Buffer.from('new-encrypted'));

      const key = getOrCreateDatabaseKey();

      // Should generate new valid key
      expect(key).toHaveLength(64);
      expect(safeStorage.encryptString).toHaveBeenCalled();
    });
  });

  describe('hasDatabaseKey', () => {
    it('should return true when key exists in store', () => {
      mockStore.has.mockReturnValue(true);

      const result = hasDatabaseKey();

      expect(result).toBe(true);
    });

    it('should return false when no key exists', () => {
      mockStore.has.mockReturnValue(false);

      const result = hasDatabaseKey();

      expect(result).toBe(false);
    });
  });

  describe('clearDatabaseKey', () => {
    it('should delete key from store when it exists', () => {
      mockStore.has.mockReturnValue(true);

      const result = clearDatabaseKey();

      expect(result).toBe(true);
      expect(mockStore.delete).toHaveBeenCalled();
    });

    it('should return false when no key exists', () => {
      mockStore.has.mockReturnValue(false);

      const result = clearDatabaseKey();

      expect(result).toBe(false);
    });
  });

  describe('rotateKey', () => {
    it('should return old and new keys for rotation', () => {
      const existingKey = 'b'.repeat(64);
      const encryptedData = [1, 2, 3];

      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      mockStore.get.mockReturnValue(encryptedData);
      vi.mocked(safeStorage.decryptString).mockReturnValue(existingKey);

      const result = rotateKey();

      expect(result.oldKey).toBe(existingKey);
      expect(result.newKey).toHaveLength(64);
      expect(result.oldKey).not.toBe(result.newKey);
    });

    it('should throw if safeStorage not available', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);

      expect(() => rotateKey()).toThrow('SafeStorage encryption not available');
    });
  });

  describe('commitKeyRotation', () => {
    it('should store new key after rotation', () => {
      const newKey = 'c'.repeat(64);

      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.encryptString).mockReturnValue(Buffer.from('encrypted'));

      commitKeyRotation(newKey);

      expect(safeStorage.encryptString).toHaveBeenCalledWith(newKey);
      expect(mockStore.set).toHaveBeenCalled();
    });

    it('should throw for invalid key format', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);

      expect(() => commitKeyRotation('invalid')).toThrow('Invalid key format');
    });

    it('should throw if safeStorage not available', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);

      expect(() => commitKeyRotation('a'.repeat(64))).toThrow(
        'SafeStorage encryption not available'
      );
    });
  });
});
