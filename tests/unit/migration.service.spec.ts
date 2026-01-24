/**
 * Migration Service Unit Tests
 *
 * Tests for schema versioning and migration management.
 *
 * @module tests/unit/migration.service.spec
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock database service
const mockPrepare = vi.fn();
const mockExec = vi.fn();
const mockTransaction = vi.fn((fn) => () => fn());

vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    exec: mockExec,
    transaction: mockTransaction,
  })),
}));

// Mock fs
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import fs from 'fs';
import {
  initializeMigrationTable,
  getAppliedMigrations,
  applyMigration,
  runMigrations,
  runMigrationsFromArray,
  getCurrentSchemaVersion,
  isMigrationApplied,
  validateMigrations,
  type Migration,
} from '../../src/main/services/migration.service';

describe('MigrationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mockTransaction to its default behavior before each test
    mockTransaction.mockImplementation((fn) => () => fn());

    // Default mock implementations
    mockPrepare.mockReturnValue({
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn().mockReturnValue({ changes: 1 }),
    });
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('initializeMigrationTable', () => {
    it('should create schema_migrations table', () => {
      initializeMigrationTable();

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations')
      );
    });
  });

  describe('getAppliedMigrations', () => {
    it('should return array of applied migration versions', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([{ version: 1 }, { version: 2 }, { version: 3 }]),
      });

      const applied = getAppliedMigrations();

      expect(applied).toEqual([1, 2, 3]);
    });

    it('should return empty array when no migrations applied', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const applied = getAppliedMigrations();

      expect(applied).toEqual([]);
    });
  });

  describe('getCurrentSchemaVersion', () => {
    it('should return highest applied version', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ version: 5 }),
      });

      const version = getCurrentSchemaVersion();

      expect(version).toBe(5);
    });

    it('should return 0 when no migrations applied', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ version: null }),
      });

      const version = getCurrentSchemaVersion();

      expect(version).toBe(0);
    });
  });

  describe('isMigrationApplied', () => {
    it('should return true for applied migration', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ version: 1 }),
      });

      const result = isMigrationApplied(1);

      expect(result).toBe(true);
    });

    it('should return false for unapplied migration', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = isMigrationApplied(999);

      expect(result).toBe(false);
    });
  });

  describe('applyMigration', () => {
    it('should execute SQL within transaction', () => {
      const migration: Migration = {
        version: 1,
        name: 'test migration',
        sql: 'CREATE TABLE test (id TEXT)',
      };

      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = applyMigration(migration);

      expect(result.success).toBe(true);
      expect(result.version).toBe(1);
      expect(result.name).toBe('test migration');
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should record migration in schema_migrations', () => {
      const migration: Migration = {
        version: 2,
        name: 'another migration',
        sql: 'CREATE TABLE another (id TEXT)',
      };

      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      applyMigration(migration);

      // Verify INSERT was called
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO schema_migrations')
      );
    });

    it('should return failure on SQL error', () => {
      const migration: Migration = {
        version: 3,
        name: 'failing migration',
        sql: 'INVALID SQL',
      };

      mockTransaction.mockImplementation(() => () => {
        throw new Error('SQL syntax error');
      });

      const result = applyMigration(migration);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should include duration in result', () => {
      const migration: Migration = {
        version: 4,
        name: 'timed migration',
        sql: 'CREATE TABLE timed (id TEXT)',
      };

      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 1 }),
      });

      const result = applyMigration(migration);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('runMigrations', () => {
    it('should apply pending migrations in order', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs.readdirSync as any).mockReturnValue(['v001_first.sql', 'v002_second.sql']);
      vi.mocked(fs.readFileSync).mockImplementation((path) => {
        if (String(path).includes('v001')) return 'CREATE TABLE first (id TEXT)';
        if (String(path).includes('v002')) return 'CREATE TABLE second (id TEXT)';
        return '';
      });

      // No migrations applied yet - use schema_migrations to match actual SQL
      mockPrepare.mockImplementation((sql) => {
        if (sql.includes('schema_migrations') && sql.includes('SELECT')) {
          return { all: vi.fn().mockReturnValue([]), get: vi.fn(), run: vi.fn() };
        }
        return {
          run: vi.fn().mockReturnValue({ changes: 1 }),
          get: vi.fn(),
          all: vi.fn().mockReturnValue([]),
        };
      });

      const summary = runMigrations('/mock/migrations');

      expect(summary.applied.length).toBe(2);
      expect(summary.applied[0].version).toBe(1);
      expect(summary.applied[1].version).toBe(2);
    });

    it('should skip already applied migrations', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs.readdirSync as any).mockReturnValue(['v001_first.sql', 'v002_second.sql']);
      vi.mocked(fs.readFileSync).mockReturnValue('CREATE TABLE test (id TEXT)');

      // Version 1 already applied - use schema_migrations to match actual SQL
      mockPrepare.mockImplementation((sql) => {
        if (sql.includes('schema_migrations') && sql.includes('SELECT')) {
          return { all: vi.fn().mockReturnValue([{ version: 1 }]), get: vi.fn(), run: vi.fn() };
        }
        return {
          run: vi.fn().mockReturnValue({ changes: 1 }),
          get: vi.fn(),
          all: vi.fn().mockReturnValue([]),
        };
      });

      const summary = runMigrations('/mock/migrations');

      expect(summary.skipped).toContain(1);
      expect(summary.applied.length).toBe(1);
      expect(summary.applied[0].version).toBe(2);
    });

    it('should stop on first failure', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs.readdirSync as any).mockReturnValue([
        'v001_first.sql',
        'v002_failing.sql',
        'v003_third.sql',
      ]);
      vi.mocked(fs.readFileSync).mockReturnValue('CREATE TABLE test (id TEXT)');

      let callCount = 0;
      mockTransaction.mockImplementation(() => () => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Migration failed');
        }
      });

      mockPrepare.mockImplementation((sql) => {
        if (sql.includes('schema_migrations') && sql.includes('SELECT')) {
          return { all: vi.fn().mockReturnValue([]), get: vi.fn(), run: vi.fn() };
        }
        return {
          run: vi.fn().mockReturnValue({ changes: 1 }),
          get: vi.fn(),
          all: vi.fn().mockReturnValue([]),
        };
      });

      const summary = runMigrations('/mock/migrations');

      expect(summary.applied.length).toBe(1);
      expect(summary.failed).not.toBeNull();
      expect(summary.failed?.version).toBe(2);
    });

    it('should return empty result for non-existent directory', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
        run: vi.fn(),
      });

      const summary = runMigrations('/nonexistent');

      expect(summary.applied).toEqual([]);
      expect(summary.failed).toBeNull();
    });
  });

  describe('runMigrationsFromArray', () => {
    it('should apply migrations from array', () => {
      const migrations: Migration[] = [
        { version: 1, name: 'first', sql: 'CREATE TABLE first (id TEXT)' },
        { version: 2, name: 'second', sql: 'CREATE TABLE second (id TEXT)' },
      ];

      mockPrepare.mockImplementation((sql) => {
        if (sql.includes('schema_migrations') && sql.includes('SELECT')) {
          return { all: vi.fn().mockReturnValue([]), get: vi.fn(), run: vi.fn() };
        }
        return {
          run: vi.fn().mockReturnValue({ changes: 1 }),
          get: vi.fn(),
          all: vi.fn().mockReturnValue([]),
        };
      });

      const summary = runMigrationsFromArray(migrations);

      expect(summary.applied.length).toBe(2);
    });

    it('should sort migrations by version', () => {
      const migrations: Migration[] = [
        { version: 3, name: 'third', sql: 'SELECT 3' },
        { version: 1, name: 'first', sql: 'SELECT 1' },
        { version: 2, name: 'second', sql: 'SELECT 2' },
      ];

      const appliedOrder: number[] = [];

      // Reset transaction mock to execute the inner function
      mockTransaction.mockImplementation((fn) => () => fn());

      mockPrepare.mockImplementation((sql) => {
        if (sql.includes('schema_migrations') && sql.includes('SELECT')) {
          return { all: vi.fn().mockReturnValue([]), get: vi.fn(), run: vi.fn() };
        }
        if (sql.includes('INSERT INTO schema_migrations')) {
          return {
            run: vi.fn().mockImplementation((version) => {
              appliedOrder.push(version);
              return { changes: 1 };
            }),
            get: vi.fn(),
            all: vi.fn().mockReturnValue([]),
          };
        }
        return {
          run: vi.fn().mockReturnValue({ changes: 1 }),
          get: vi.fn(),
          all: vi.fn().mockReturnValue([]),
        };
      });

      runMigrationsFromArray(migrations);

      // Verify migrations were applied in version order
      expect(appliedOrder).toEqual([1, 2, 3]);
    });
  });

  describe('validateMigrations', () => {
    it('should return valid when all expected migrations applied', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([{ version: 1 }, { version: 2 }, { version: 3 }]),
      });

      const result = validateMigrations([1, 2, 3]);

      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.extra).toEqual([]);
    });

    it('should detect missing migrations', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([{ version: 1 }]),
      });

      const result = validateMigrations([1, 2, 3]);

      expect(result.valid).toBe(false);
      expect(result.missing).toEqual([2, 3]);
    });

    it('should detect extra migrations', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([{ version: 1 }, { version: 2 }, { version: 99 }]),
      });

      const result = validateMigrations([1, 2]);

      expect(result.valid).toBe(false);
      expect(result.extra).toEqual([99]);
    });
  });
});
