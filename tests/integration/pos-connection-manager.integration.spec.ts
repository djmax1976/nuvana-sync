/**
 * POS Connection Manager Integration Tests
 *
 * Tests the POSConnectionManagerService with REAL database and settings.
 * These tests validate the actual service behavior without mocking internal components.
 *
 * Test Coverage:
 * - PCM-I-001: Service lifecycle with real database
 * - PCM-I-002: Configuration refresh after settings change
 * - PCM-I-003: Status transitions for different POS types
 * - PCM-I-004: File path validation with real filesystem checks
 *
 * Security Compliance:
 * - SEC-014: POS configuration validation
 * - DB-006: Tenant isolation (store-scoped settings)
 *
 * @module tests/integration/pos-connection-manager.integration.spec
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServiceTestContext, type ServiceTestContext } from '../helpers/test-context';

// ============================================================================
// Native Module Check
// ============================================================================

/**
 * Check if native SQLite module is available and compatible.
 * Tests are skipped if:
 * - Running in CI without native bindings
 * - SKIP_NATIVE_TESTS environment variable is set
 * - Native module fails to load (version mismatch, missing bindings, etc.)
 */
let nativeModuleAvailable = true;
try {
  // Attempt to create a database to verify the native module works
  // This catches version mismatches that only manifest when actually using the module
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3-multiple-ciphers');
  const testDb = new Database(':memory:');
  testDb.close();
} catch {
  // Native module not available or incompatible with current Node version
  nativeModuleAvailable = false;
}

/**
 * Skip native module tests in CI environments or when native bindings unavailable
 */
const SKIP_NATIVE_MODULE_TESTS = process.env.SKIP_NATIVE_TESTS === 'true' || !nativeModuleAvailable;

// ============================================================================
// Mock External Dependencies Only
// ============================================================================

// Mock Electron (external dependency)
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'C:\\mock\\userData'),
    isPackaged: false,
    getName: vi.fn(() => 'nuvana-sync'),
    getVersion: vi.fn(() => '1.0.0'),
  },
  safeStorage: {
    encryptString: vi.fn((str) => Buffer.from(`encrypted:${str}`)),
    decryptString: vi.fn((buf) => buf.toString().replace('encrypted:', '')),
    isEncryptionAvailable: vi.fn(() => true),
  },
}));

// Mock electron-store - must be a proper constructor class
const mockStores = new Map<string, Map<string, unknown>>();

// Pre-create the 'nuvana' store (used by settings service)
const mockStore = new Map<string, unknown>();
mockStores.set('nuvana', mockStore);

vi.mock('electron-store', () => {
  class MockStore {
    private store: Map<string, unknown>;
    public path: string;

    constructor(options?: { name?: string }) {
      const name = options?.name || 'default';
      if (!mockStores.has(name)) {
        mockStores.set(name, new Map());
      }
      this.store = mockStores.get(name)!;
      this.path = `C:\\mock\\${name}.json`;
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

    has(key: string) {
      return this.store.has(key);
    }

    clear() {
      this.store.clear();
    }
  }

  return { default: MockStore };
});

// ============================================================================
// Test Suite
// ============================================================================

// Skip entire suite if native module is not available
const describeSuite = SKIP_NATIVE_MODULE_TESTS ? describe.skip : describe;

describeSuite('POSConnectionManagerService (Integration)', () => {
  let ctx: ServiceTestContext;

  beforeEach(async () => {
    // Clear all mock stores
    mockStores.forEach((store) => store.clear());

    // Create test context with real database
    ctx = await createServiceTestContext({
      storeName: 'POS Integration Test Store',
    });
  });

  afterEach(() => {
    // Guard against ctx being undefined if beforeEach failed
    ctx?.cleanup();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Basic Service Lifecycle
  // ==========================================================================

  describe('Service Lifecycle', () => {
    it('PCM-I-001: initializes with NOT_CONFIGURED status by default', async () => {
      // Import service dynamically to avoid hoisting issues with mocks
      const { POSConnectionManagerService } =
        await import('../../src/main/services/pos-connection-manager.service');

      const service = new POSConnectionManagerService();
      const state = service.getState();

      expect(state.status).toBe('NOT_CONFIGURED');
      expect(state.isInitialized).toBe(false);
      expect(state.connectionType).toBeNull();

      await service.shutdown();
    });

    it('PCM-I-002: transitions to MANUAL_MODE for MANUAL connection', async () => {
      // Configure manual mode in settings
      mockStore.set('posConnection.isConfigured', true);
      mockStore.set('posConnection.posType', 'MANUAL_ENTRY');
      mockStore.set('posConnection.connectionType', 'MANUAL');

      const { POSConnectionManagerService } =
        await import('../../src/main/services/pos-connection-manager.service');

      const service = new POSConnectionManagerService();
      const result = await service.initialize(ctx.storeId);

      expect(result.success).toBe(true);
      expect(service.getStatus()).toBe('MANUAL_MODE');
      expect(service.isConnected()).toBe(true);

      await service.shutdown();
    });

    it('PCM-I-003: transitions to CONNECTED for FILE connection with valid path', async () => {
      // Configure file-based connection
      mockStore.set('posConnection.isConfigured', true);
      mockStore.set('posConnection.posType', 'GILBARCO_NAXML');
      mockStore.set('posConnection.connectionType', 'FILE');
      mockStore.set(
        'posConnection.connectionConfig',
        JSON.stringify({
          import_path: process.cwd(), // Use current directory (exists)
          export_path: process.cwd(),
          poll_interval_seconds: 60,
        })
      );

      const { POSConnectionManagerService } =
        await import('../../src/main/services/pos-connection-manager.service');

      const service = new POSConnectionManagerService();
      const result = await service.initialize(ctx.storeId);

      expect(result.success).toBe(true);
      expect(result.connectionType).toBe('FILE');
      expect(service.getStatus()).toBe('CONNECTED');
      expect(service.isConnected()).toBe(true);

      await service.shutdown();
    });

    it('PCM-I-004: returns error when no POS config exists', async () => {
      // No configuration set
      mockStore.clear();

      const { POSConnectionManagerService } =
        await import('../../src/main/services/pos-connection-manager.service');

      const service = new POSConnectionManagerService();
      const result = await service.initialize(ctx.storeId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('POS connection not configured');

      await service.shutdown();
    });
  });

  // ==========================================================================
  // Configuration Refresh Tests
  // ==========================================================================

  describe('Configuration Refresh', () => {
    it('PCM-I-005: detects config change on refresh', async () => {
      // Start with MANUAL mode
      mockStore.set('posConnection.isConfigured', true);
      mockStore.set('posConnection.posType', 'MANUAL_ENTRY');
      mockStore.set('posConnection.connectionType', 'MANUAL');

      const { POSConnectionManagerService } =
        await import('../../src/main/services/pos-connection-manager.service');

      const service = new POSConnectionManagerService();
      await service.initialize(ctx.storeId);
      expect(service.getStatus()).toBe('MANUAL_MODE');

      // Change to FILE mode
      mockStore.set('posConnection.posType', 'GILBARCO_NAXML');
      mockStore.set('posConnection.connectionType', 'FILE');
      mockStore.set(
        'posConnection.connectionConfig',
        JSON.stringify({
          import_path: process.cwd(),
          export_path: process.cwd(),
        })
      );

      const refreshResult = await service.refreshConfig();

      expect(refreshResult.success).toBe(true);
      expect(refreshResult.configChanged).toBe(true);
      expect(service.getStatus()).toBe('CONNECTED');

      await service.shutdown();
    });

    it('PCM-I-006: handles transition from FILE to MANUAL', async () => {
      // Start with FILE mode
      mockStore.set('posConnection.isConfigured', true);
      mockStore.set('posConnection.posType', 'GILBARCO_NAXML');
      mockStore.set('posConnection.connectionType', 'FILE');
      mockStore.set(
        'posConnection.connectionConfig',
        JSON.stringify({
          import_path: process.cwd(),
          export_path: process.cwd(),
        })
      );

      const { POSConnectionManagerService } =
        await import('../../src/main/services/pos-connection-manager.service');

      const service = new POSConnectionManagerService();
      await service.initialize(ctx.storeId);
      expect(service.getStatus()).toBe('CONNECTED');

      // Change to MANUAL mode
      mockStore.set('posConnection.posType', 'MANUAL_ENTRY');
      mockStore.set('posConnection.connectionType', 'MANUAL');
      mockStore.delete('posConnection.connectionConfig');

      const refreshResult = await service.refreshConfig();

      expect(refreshResult.configChanged).toBe(true);
      expect(service.getStatus()).toBe('MANUAL_MODE');

      await service.shutdown();
    });
  });

  // ==========================================================================
  // Status and Connection Tests
  // ==========================================================================

  describe('Status Management', () => {
    it('PCM-I-007: isConnected returns false for NOT_CONFIGURED', async () => {
      const { POSConnectionManagerService } =
        await import('../../src/main/services/pos-connection-manager.service');

      const service = new POSConnectionManagerService();

      expect(service.isConnected()).toBe(false);
      expect(service.getStatus()).toBe('NOT_CONFIGURED');

      await service.shutdown();
    });

    it('PCM-I-008: getState returns complete state object', async () => {
      mockStore.set('posConnection.isConfigured', true);
      mockStore.set('posConnection.posType', 'MANUAL_ENTRY');
      mockStore.set('posConnection.connectionType', 'MANUAL');

      const { POSConnectionManagerService } =
        await import('../../src/main/services/pos-connection-manager.service');

      const service = new POSConnectionManagerService();
      await service.initialize(ctx.storeId);

      const state = service.getState();

      expect(state).toHaveProperty('status');
      expect(state).toHaveProperty('connectionType');
      expect(state).toHaveProperty('posType');
      expect(state).toHaveProperty('isInitialized');
      expect(state.status).toBe('MANUAL_MODE');
      expect(state.connectionType).toBe('MANUAL');
      expect(state.isInitialized).toBe(true);

      await service.shutdown();
    });
  });

  // ==========================================================================
  // Shutdown Tests
  // ==========================================================================

  describe('Shutdown', () => {
    it('PCM-I-009: shutdown resets to DISCONNECTED state', async () => {
      mockStore.set('posConnection.isConfigured', true);
      mockStore.set('posConnection.posType', 'MANUAL_ENTRY');
      mockStore.set('posConnection.connectionType', 'MANUAL');

      const { POSConnectionManagerService } =
        await import('../../src/main/services/pos-connection-manager.service');

      const service = new POSConnectionManagerService();
      await service.initialize(ctx.storeId);
      expect(service.getStatus()).toBe('MANUAL_MODE');

      await service.shutdown();

      expect(service.getStatus()).toBe('DISCONNECTED');
      expect(service.getState().isInitialized).toBe(false);
    });

    it('PCM-I-010: shutdown is idempotent', async () => {
      mockStore.set('posConnection.isConfigured', true);
      mockStore.set('posConnection.posType', 'MANUAL_ENTRY');
      mockStore.set('posConnection.connectionType', 'MANUAL');

      const { POSConnectionManagerService } =
        await import('../../src/main/services/pos-connection-manager.service');

      const service = new POSConnectionManagerService();
      await service.initialize(ctx.storeId);

      // Multiple shutdowns should be safe
      await service.shutdown();
      await service.shutdown();
      await service.shutdown();

      expect(service.getStatus()).toBe('DISCONNECTED');
    });
  });

  // ==========================================================================
  // API Key Resync Flow - Critical Fix Validation
  // ==========================================================================

  describe('API Key Resync Flow (File Watcher Restart Fix)', () => {
    it('PCM-I-011: complete resync from MANUAL to FILE updates status', async () => {
      // Step 1: Start with MANUAL mode (simulating initial state)
      mockStore.set('posConnection.isConfigured', true);
      mockStore.set('posConnection.posType', 'MANUAL_ENTRY');
      mockStore.set('posConnection.connectionType', 'MANUAL');

      const { POSConnectionManagerService } =
        await import('../../src/main/services/pos-connection-manager.service');

      const service = new POSConnectionManagerService();
      await service.initialize(ctx.storeId);
      expect(service.getStatus()).toBe('MANUAL_MODE');

      // Step 2: API key resync returns FILE config (cloud config)
      mockStore.set('posConnection.posType', 'GILBARCO_NAXML');
      mockStore.set('posConnection.connectionType', 'FILE');
      mockStore.set(
        'posConnection.connectionConfig',
        JSON.stringify({
          import_path: process.cwd(),
          export_path: process.cwd(),
          poll_interval_seconds: 60,
        })
      );

      // Step 3: FILE_WATCHER_RESTART handler calls refreshConfig()
      const refreshResult = await service.refreshConfig();

      // Step 4: Verify status is now CONNECTED (file watcher can start)
      expect(refreshResult.success).toBe(true);
      expect(refreshResult.configChanged).toBe(true);
      expect(service.getStatus()).toBe('CONNECTED');
      expect(service.isConnected()).toBe(true);

      await service.shutdown();
    });

    it('PCM-I-012: config path change triggers reinitialize', async () => {
      // Start with FILE connection
      mockStore.set('posConnection.isConfigured', true);
      mockStore.set('posConnection.posType', 'GILBARCO_NAXML');
      mockStore.set('posConnection.connectionType', 'FILE');
      mockStore.set(
        'posConnection.connectionConfig',
        JSON.stringify({
          import_path: process.cwd(),
          export_path: process.cwd(),
        })
      );

      const { POSConnectionManagerService } =
        await import('../../src/main/services/pos-connection-manager.service');

      const service = new POSConnectionManagerService();
      await service.initialize(ctx.storeId);

      // Change the import path
      mockStore.set(
        'posConnection.connectionConfig',
        JSON.stringify({
          import_path: process.cwd() + '/tests', // Different path
          export_path: process.cwd(),
        })
      );

      const refreshResult = await service.refreshConfig();

      expect(refreshResult.configChanged).toBe(true);
      expect(service.getStatus()).toBe('CONNECTED');

      await service.shutdown();
    });
  });
});
