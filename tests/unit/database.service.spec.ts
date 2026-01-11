/**
 * Database Service Unit Tests
 *
 * Tests for SQLCipher-encrypted database management.
 *
 * @module tests/unit/database.service.spec
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Electron app module
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('\\mock\\user\\data'),
    getVersion: vi.fn().mockReturnValue('1.0.0'),
  },
}));

// Mock key manager
vi.mock('../../src/main/services/key-manager.service', () => ({
  getOrCreateDatabaseKey: vi.fn().mockReturnValue('a'.repeat(64)),
  isKeyAvailable: vi.fn().mockReturnValue(true),
}));

// Mock better-sqlite3-multiple-ciphers
const mockDb = {
  pragma: vi.fn().mockReturnThis(),
  exec: vi.fn(),
  prepare: vi.fn().mockReturnValue({
    get: vi.fn(),
    all: vi.fn(),
    run: vi.fn(),
  }),
  close: vi.fn(),
  transaction: vi.fn((fn) => fn),
  backup: vi.fn().mockReturnValue({
    step: vi.fn(),
    close: vi.fn(),
  }),
};

vi.mock('better-sqlite3-multiple-ciphers', () => ({
  default: vi.fn().mockImplementation(() => mockDb),
}));

// Mock fs
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    statSync: vi.fn().mockReturnValue({ size: 1024 }),
  },
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  statSync: vi.fn().mockReturnValue({ size: 1024 }),
}));

// Import after mocks
import {
  getOrCreateDatabaseKey,
  isKeyAvailable,
} from '../../src/main/services/key-manager.service';

describe('DatabaseService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('initializeDatabase', () => {
    it('should create encrypted database file', async () => {
      // Import fresh instance
      const { initializeDatabase, closeDatabase } =
        await import('../../src/main/services/database.service');

      const db = initializeDatabase();

      expect(db).toBeDefined();
      expect(getOrCreateDatabaseKey).toHaveBeenCalled();

      closeDatabase();
    });

    it('should apply SQLCipher pragmas', async () => {
      const { initializeDatabase, closeDatabase } =
        await import('../../src/main/services/database.service');

      initializeDatabase();

      // Verify encryption pragmas were applied
      expect(mockDb.pragma).toHaveBeenCalledWith(expect.stringContaining('key'));
      expect(mockDb.pragma).toHaveBeenCalledWith(expect.stringContaining('cipher'));
      expect(mockDb.pragma).toHaveBeenCalledWith(expect.stringContaining('kdf_iter'));

      closeDatabase();
    });

    it('should return singleton instance', async () => {
      const { initializeDatabase, closeDatabase } =
        await import('../../src/main/services/database.service');

      const db1 = initializeDatabase();
      const db2 = initializeDatabase();

      expect(db1).toBe(db2);

      closeDatabase();
    });

    it('should throw if safeStorage not available', async () => {
      vi.mocked(isKeyAvailable).mockReturnValue(false);

      // Clear module cache to get fresh import
      vi.resetModules();

      // Re-apply mocks
      vi.doMock('../../src/main/services/key-manager.service', () => ({
        getOrCreateDatabaseKey: vi.fn(),
        isKeyAvailable: vi.fn().mockReturnValue(false),
      }));

      const { initializeDatabase } = await import('../../src/main/services/database.service');

      expect(() => initializeDatabase()).toThrow('SafeStorage encryption is required');
    });

    it('should verify encryption after initialization', async () => {
      vi.resetModules();

      // Re-apply mocks after reset
      vi.doMock('../../src/main/services/key-manager.service', () => ({
        getOrCreateDatabaseKey: vi.fn().mockReturnValue('a'.repeat(64)),
        isKeyAvailable: vi.fn().mockReturnValue(true),
      }));

      const { initializeDatabase, closeDatabase } =
        await import('../../src/main/services/database.service');

      initializeDatabase();

      // Verify encryption check query was executed
      expect(mockDb.exec).toHaveBeenCalledWith(expect.stringContaining('sqlite_master'));

      closeDatabase();
    });
  });

  describe('getDatabase', () => {
    it('should throw if database not initialized', async () => {
      vi.resetModules();

      // Re-apply mocks after reset
      vi.doMock('../../src/main/services/key-manager.service', () => ({
        getOrCreateDatabaseKey: vi.fn().mockReturnValue('a'.repeat(64)),
        isKeyAvailable: vi.fn().mockReturnValue(true),
      }));

      const { getDatabase } = await import('../../src/main/services/database.service');

      expect(() => getDatabase()).toThrow('Database not initialized');
    });
  });

  describe('closeDatabase', () => {
    it('should close database connection', async () => {
      vi.resetModules();

      // Re-apply mocks after reset
      vi.doMock('../../src/main/services/key-manager.service', () => ({
        getOrCreateDatabaseKey: vi.fn().mockReturnValue('a'.repeat(64)),
        isKeyAvailable: vi.fn().mockReturnValue(true),
      }));

      const { initializeDatabase, closeDatabase, isDatabaseInitialized } =
        await import('../../src/main/services/database.service');

      initializeDatabase();
      closeDatabase();

      // After closing, isDatabaseInitialized should reflect the state
      // Note: actual behavior depends on implementation
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should checkpoint WAL before closing', async () => {
      vi.resetModules();

      // Re-apply mocks after reset
      vi.doMock('../../src/main/services/key-manager.service', () => ({
        getOrCreateDatabaseKey: vi.fn().mockReturnValue('a'.repeat(64)),
        isKeyAvailable: vi.fn().mockReturnValue(true),
      }));

      const { initializeDatabase, closeDatabase } =
        await import('../../src/main/services/database.service');

      initializeDatabase();
      closeDatabase();

      expect(mockDb.pragma).toHaveBeenCalledWith(expect.stringContaining('wal_checkpoint'));
    });
  });

  describe('getDatabaseHealth', () => {
    it('should return health information', async () => {
      vi.resetModules();

      // Re-apply mocks after reset
      vi.doMock('../../src/main/services/key-manager.service', () => ({
        getOrCreateDatabaseKey: vi.fn().mockReturnValue('a'.repeat(64)),
        isKeyAvailable: vi.fn().mockReturnValue(true),
      }));

      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ count: 10 }),
      });

      const { initializeDatabase, getDatabaseHealth, closeDatabase } =
        await import('../../src/main/services/database.service');

      initializeDatabase();
      const health = getDatabaseHealth();

      expect(health).toEqual(
        expect.objectContaining({
          isOpen: true,
          isEncrypted: true,
          tableCount: expect.any(Number),
        })
      );

      closeDatabase();
    });
  });

  describe('withTransaction', () => {
    it('should execute function within transaction', async () => {
      vi.resetModules();

      // Re-apply mocks after reset
      vi.doMock('../../src/main/services/key-manager.service', () => ({
        getOrCreateDatabaseKey: vi.fn().mockReturnValue('a'.repeat(64)),
        isKeyAvailable: vi.fn().mockReturnValue(true),
      }));

      const { initializeDatabase, withTransaction, closeDatabase } =
        await import('../../src/main/services/database.service');

      initializeDatabase();

      const result = withTransaction(() => 'test-result');

      expect(result).toBe('test-result');

      closeDatabase();
    });
  });

  describe('checkDatabaseIntegrity', () => {
    it('should return true for valid database', async () => {
      vi.resetModules();

      // Re-apply mocks after reset
      vi.doMock('../../src/main/services/key-manager.service', () => ({
        getOrCreateDatabaseKey: vi.fn().mockReturnValue('a'.repeat(64)),
        isKeyAvailable: vi.fn().mockReturnValue(true),
      }));

      mockDb.pragma.mockReturnValue([{ integrity_check: 'ok' }]);

      const { initializeDatabase, checkDatabaseIntegrity, closeDatabase } =
        await import('../../src/main/services/database.service');

      initializeDatabase();
      const result = checkDatabaseIntegrity();

      expect(result).toBe(true);

      closeDatabase();
    });

    it('should return false for corrupted database', async () => {
      vi.resetModules();

      // Re-apply mocks after reset
      vi.doMock('../../src/main/services/key-manager.service', () => ({
        getOrCreateDatabaseKey: vi.fn().mockReturnValue('a'.repeat(64)),
        isKeyAvailable: vi.fn().mockReturnValue(true),
      }));

      mockDb.pragma.mockReturnValue([{ integrity_check: 'corruption found' }]);

      const { initializeDatabase, checkDatabaseIntegrity, closeDatabase } =
        await import('../../src/main/services/database.service');

      initializeDatabase();
      const result = checkDatabaseIntegrity();

      expect(result).toBe(false);

      closeDatabase();
    });
  });
});
