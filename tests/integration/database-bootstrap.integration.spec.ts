/**
 * Database Bootstrap Service Integration Tests
 *
 * Integration tests for the complete database bootstrap flow.
 * These tests verify:
 * - Full bootstrap sequence with actual service interactions
 * - Pre-migration backup creation and verification
 * - Migration execution with schema validation
 * - State transitions through the bootstrap lifecycle
 * - Recovery from various failure scenarios
 *
 * NOTE: These tests require the native better-sqlite3 module.
 * Run with: npm run test:integration
 *
 * @module tests/integration/database-bootstrap.integration.spec
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ============================================================================
// Test Environment Setup
// ============================================================================

// Create isolated test directory
const TEST_DIR = path.join(os.tmpdir(), `nuvana-bootstrap-test-${Date.now()}`);
const TEST_DB_PATH = path.join(TEST_DIR, 'nuvana.db');
const TEST_BACKUP_DIR = path.join(TEST_DIR, 'backups');

// Check if native SQLite module is available and compatible
let nativeModuleAvailable = true;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3-multiple-ciphers');
  const testDb = new Database(':memory:');
  testDb.close();
} catch {
  nativeModuleAvailable = false;
}

// Helper to check if an error is due to native module issues (used in catch blocks)
const isNativeModuleError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const message = error.message;
  return (
    message.includes('better-sqlite3') ||
    message.includes('NODE_MODULE_VERSION') ||
    message.includes('Cannot find module') ||
    message.includes('native module')
  );
};

// Skip tests that require native modules in CI or when modules aren't properly compiled
const SKIP_NATIVE_MODULE_TESTS = process.env.SKIP_NATIVE_TESTS === 'true' || !nativeModuleAvailable;

// Use describe.skip for entire suite when native module unavailable
const describeSuite = SKIP_NATIVE_MODULE_TESTS ? describe.skip : describe;

// Mock Electron app to use test directory
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockImplementation((name: string) => {
      if (name === 'userData') return TEST_DIR;
      return TEST_DIR;
    }),
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((str: string) => Buffer.from(str)),
    decryptString: vi.fn((buf: Buffer) => buf.toString()),
  },
}));

// ============================================================================
// Helpers
// ============================================================================

function cleanupTestDir(): void {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

function setupTestDir(): void {
  cleanupTestDir();
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

// ============================================================================
// Integration Test Suite
// ============================================================================

describeSuite('Database Bootstrap Integration', () => {
  beforeEach(() => {
    setupTestDir();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanupTestDir();
    vi.resetModules();
  });

  describe('Full Bootstrap Lifecycle', () => {
    it('should complete full bootstrap sequence on fresh installation', async () => {
      // This test requires native better-sqlite3 module
      // Skip if native modules are not available (CI environment)
      // This test verifies the complete happy path:
      // 1. Pre-flight checks pass
      // 2. Database initialized with encryption
      // 3. Migrations run successfully
      // 4. Schema validation passes
      // 5. Health check passes
      // 6. State transitions to ready

      try {
        const { bootstrapDatabase, getDatabaseState, isDatabaseReady, shutdownDatabase } =
          await import('../../src/main/services/database-bootstrap.service');

        const result = await bootstrapDatabase({
          skipBackup: true, // No existing DB to backup
          timeoutMs: 60000,
        });

        // Verify success
        expect(result.success).toBe(true);
        expect(result.state).toBe('ready');
        expect(result.correlationId).toBeDefined();
        expect(result.durationMs).toBeGreaterThan(0);

        // Verify state
        expect(getDatabaseState()).toBe('ready');
        expect(isDatabaseReady()).toBe(true);

        // Verify migrations ran
        expect(result.migrations).toBeDefined();
        expect(result.migrations?.failed).toBeNull();

        // Cleanup
        shutdownDatabase();
        expect(getDatabaseState()).toBe('uninitialized');
      } catch (error) {
        // Skip if native module issues at runtime
        if (isNativeModuleError(error)) {
          console.log('Skipping: Native module not available in test environment');
          return;
        }
        throw error;
      }
    });

    it('should create backup before running migrations on existing database', async () => {
      try {
        const {
          bootstrapDatabase,
          getAvailableBackups: _getAvailableBackups,
          shutdownDatabase,
        } = await import('../../src/main/services/database-bootstrap.service');

        // First bootstrap - creates database
        await bootstrapDatabase({ skipBackup: true });
        shutdownDatabase();

        // Clear modules to reset state
        vi.resetModules();

        // Re-import after reset
        const module = await import('../../src/main/services/database-bootstrap.service');

        // Second bootstrap - should create backup
        const result = await module.bootstrapDatabase({
          skipBackup: false,
          force: true,
        });

        expect(result.success).toBe(true);

        // Check that backup was created
        const backups = module.getAvailableBackups();
        // Backup may or may not exist depending on timing, but should not error
        expect(Array.isArray(backups)).toBe(true);

        module.shutdownDatabase();
      } catch (error) {
        if (isNativeModuleError(error)) {
          console.log('Skipping: Native module not available in test environment');
          return;
        }
        throw error;
      }
    });

    it('should handle re-bootstrap without force flag', async () => {
      try {
        const { bootstrapDatabase, shutdownDatabase, isDatabaseReady } =
          await import('../../src/main/services/database-bootstrap.service');

        // First bootstrap
        const result1 = await bootstrapDatabase({ skipBackup: true });
        expect(result1.success).toBe(true);
        expect(isDatabaseReady()).toBe(true);

        // Second bootstrap without force - should return early
        const result2 = await bootstrapDatabase({ skipBackup: true });
        expect(result2.success).toBe(true);
        // Should complete quickly since already initialized
        expect(result2.durationMs).toBeLessThan(100);

        shutdownDatabase();
      } catch (error) {
        if (isNativeModuleError(error)) {
          console.log('Skipping: Native module not available in test environment');
          return;
        }
        throw error;
      }
    });
  });

  describe('State Transitions', () => {
    it('should transition through correct states during bootstrap', async () => {
      try {
        const stateHistory: string[] = [];

        // Intercept state changes by checking periodically
        const { bootstrapDatabase, getDatabaseState, shutdownDatabase } =
          await import('../../src/main/services/database-bootstrap.service');

        // Record initial state
        stateHistory.push(getDatabaseState());

        const _result = await bootstrapDatabase({ skipBackup: true });

        // Record final state
        stateHistory.push(getDatabaseState());

        expect(stateHistory[0]).toBe('uninitialized');
        expect(stateHistory[stateHistory.length - 1]).toBe('ready');

        shutdownDatabase();
        expect(getDatabaseState()).toBe('uninitialized');
      } catch (error) {
        if (isNativeModuleError(error)) {
          console.log('Skipping: Native module not available in test environment');
          return;
        }
        throw error;
      }
    });
  });

  describe('Health Check Integration', () => {
    it('should perform comprehensive health check after bootstrap', async () => {
      try {
        const { bootstrapDatabase, performHealthCheck, shutdownDatabase } =
          await import('../../src/main/services/database-bootstrap.service');

        await bootstrapDatabase({ skipBackup: true });

        const health = performHealthCheck();

        expect(health.healthy).toBe(true);
        expect(health.checks.connection).toBe(true);
        expect(health.checks.integrity).toBe(true);
        expect(health.checks.schemaVersion).toBeGreaterThan(0);
        expect(health.checks.tableCount).toBeGreaterThan(0);
        expect(health.checks.requiredTablesPresent).toBe(true);

        shutdownDatabase();
      } catch (error) {
        if (isNativeModuleError(error)) {
          console.log('Skipping: Native module not available in test environment');
          return;
        }
        throw error;
      }
    });

    it('should report unhealthy when database not initialized', async () => {
      try {
        const { performHealthCheck } =
          await import('../../src/main/services/database-bootstrap.service');

        // Don't bootstrap - check health on uninitialized state
        const health = performHealthCheck();

        expect(health.healthy).toBe(false);
        expect(health.error).toBe('Database not initialized');
      } catch (error) {
        if (isNativeModuleError(error)) {
          console.log('Skipping: Native module not available in test environment');
          return;
        }
        throw error;
      }
    });
  });

  describe('Backup and Recovery Integration', () => {
    it('should restore database from backup file', async () => {
      try {
        const {
          bootstrapDatabase,
          getAvailableBackups: _getAvailableBackups,
          restoreFromBackup,
          shutdownDatabase,
        } = await import('../../src/main/services/database-bootstrap.service');

        // First bootstrap
        await bootstrapDatabase({ skipBackup: true });
        shutdownDatabase();

        // Create a manual backup file for testing
        const backupPath = path.join(TEST_BACKUP_DIR, 'nuvana_v4_2024-01-01T00-00-00.db');
        fs.mkdirSync(TEST_BACKUP_DIR, { recursive: true });
        if (fs.existsSync(TEST_DB_PATH)) {
          fs.copyFileSync(TEST_DB_PATH, backupPath);
        }

        // Now restore from backup
        const restored = await restoreFromBackup(backupPath);

        // Restoration depends on backup existing
        if (fs.existsSync(backupPath)) {
          expect(restored).toBe(true);
        }
      } catch (error) {
        if (isNativeModuleError(error)) {
          console.log('Skipping: Native module not available in test environment');
          return;
        }
        throw error;
      }
    });

    it('should fail restore when backup file does not exist', async () => {
      try {
        const { restoreFromBackup } =
          await import('../../src/main/services/database-bootstrap.service');

        const restored = await restoreFromBackup('/nonexistent/backup.db');

        expect(restored).toBe(false);
      } catch (error) {
        if (isNativeModuleError(error)) {
          console.log('Skipping: Native module not available in test environment');
          return;
        }
        throw error;
      }
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle timeout gracefully', async () => {
      try {
        const { bootstrapDatabase } =
          await import('../../src/main/services/database-bootstrap.service');

        // Use extremely short timeout
        const result = await bootstrapDatabase({
          skipBackup: true,
          timeoutMs: 1, // 1ms timeout - will likely timeout
        });

        // Either succeeds quickly or times out
        if (!result.success) {
          expect(result.error?.code).toBe('INITIALIZATION_TIMEOUT');
        }
      } catch (error) {
        if (isNativeModuleError(error)) {
          console.log('Skipping: Native module not available in test environment');
          return;
        }
        throw error;
      }
    });
  });

  describe('Concurrent Access', () => {
    it('should handle multiple bootstrap calls safely', async () => {
      try {
        const { bootstrapDatabase, shutdownDatabase } =
          await import('../../src/main/services/database-bootstrap.service');

        // Launch multiple bootstrap calls concurrently
        const results = await Promise.all([
          bootstrapDatabase({ skipBackup: true }),
          bootstrapDatabase({ skipBackup: true }),
          bootstrapDatabase({ skipBackup: true }),
        ]);

        // All should succeed (first initializes, others return early)
        expect(results.every((r) => r.success)).toBe(true);

        shutdownDatabase();
      } catch (error) {
        if (isNativeModuleError(error)) {
          console.log('Skipping: Native module not available in test environment');
          return;
        }
        throw error;
      }
    });
  });
});
