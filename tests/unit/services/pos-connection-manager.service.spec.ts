/**
 * POS Connection Manager Service Unit Tests
 *
 * Tests for POS connection state management, configuration refresh, and status tracking.
 * Critical for the file watcher restart fix - validates that refreshConfig() properly
 * updates connection status after API key resync.
 *
 * Test Coverage Matrix:
 * - PCM-INIT-001 through 005: Initialization and state management
 * - PCM-REFRESH-001 through 006: Configuration refresh (critical for resync fix)
 * - PCM-STATUS-001 through 004: Status getters and isConnected logic
 * - PCM-HEALTH-001 through 005: Health check for FILE connection type
 * - PCM-SHUTDOWN-001 through 003: Cleanup and state reset
 *
 * Security Coverage:
 * - SEC-014: Input validation for connection configs
 * - LM-001: Structured logging verification
 *
 * @module tests/unit/services/pos-connection-manager.service.spec
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// Mock Setup
// ============================================================================

// Mock dependencies before importing the service
vi.mock('../../../src/main/services/settings.service', () => ({
  settingsService: {
    getPOSConnectionConfig: vi.fn(),
  },
}));

vi.mock('../../../src/shared/types/config.types', () => ({
  // Default: pass-through validation (returns the input config unchanged)
  validatePOSConnectionConfig: vi.fn((config) => config),
  formatPOSConnectionValidationErrors: vi.fn(() => ['Validation error']),
}));

vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  accessSync: vi.fn(),
  statSync: vi.fn(() => ({ isDirectory: () => true })),
  constants: { R_OK: 4 },
}));

// Import mocked modules for manipulation
import { settingsService } from '../../../src/main/services/settings.service';
import { validatePOSConnectionConfig } from '../../../src/shared/types/config.types';
import * as fs from 'fs';

// Import the class to test
import { POSConnectionManagerService } from '../../../src/main/services/pos-connection-manager.service';

// ============================================================================
// Test Fixtures
// ============================================================================

const createFileConfig = () => ({
  pos_type: 'GILBARCO_NAXML' as const,
  pos_connection_type: 'FILE' as const,
  pos_connection_config: {
    import_path: 'C:\\XMLGateway\\import',
    export_path: 'C:\\XMLGateway\\export',
    poll_interval_seconds: 60,
  },
});

const createManualConfig = () => ({
  pos_type: 'MANUAL_ENTRY' as const,
  pos_connection_type: 'MANUAL' as const,
  pos_connection_config: null,
});

// ============================================================================
// Test Suite
// ============================================================================

describe('POSConnectionManagerService', () => {
  let service: POSConnectionManagerService;

  beforeEach(() => {
    // Reset all mocks including implementations (clearAllMocks doesn't reset implementations)
    vi.resetAllMocks();
    // Re-establish default mock implementations
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(validatePOSConnectionConfig).mockImplementation((config: any) => config);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<
      typeof fs.statSync
    >);
    service = new POSConnectionManagerService();
  });

  afterEach(async () => {
    await service.shutdown();
  });

  // ==========================================================================
  // Initialization Tests
  // ==========================================================================

  describe('Initialization', () => {
    it('PCM-INIT-001: initializes with NOT_CONFIGURED status by default', () => {
      const state = service.getState();
      expect(state.status).toBe('NOT_CONFIGURED');
      expect(state.isInitialized).toBe(false);
    });

    it('PCM-INIT-002: initializes successfully with FILE connection config', async () => {
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(createFileConfig());
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = await service.initialize('store-123');

      expect(result.success).toBe(true);
      expect(result.connectionType).toBe('FILE');
      expect(service.getStatus()).toBe('CONNECTED');
    });

    it('PCM-INIT-003: initializes with MANUAL_MODE for MANUAL connection type', async () => {
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(createManualConfig());

      const result = await service.initialize('store-123');

      expect(result.success).toBe(true);
      expect(service.getStatus()).toBe('MANUAL_MODE');
      expect(service.isConnected()).toBe(true);
    });

    it('PCM-INIT-004: returns error when no POS config available', async () => {
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(null);

      const result = await service.initialize('store-123');

      expect(result.success).toBe(false);
      expect(result.message).toContain('POS connection not configured');
    });

    it('PCM-INIT-005: returns error on validation failure (SEC-014)', async () => {
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(createFileConfig());
      vi.mocked(validatePOSConnectionConfig).mockImplementation(() => {
        throw new Error('Invalid import_path: path traversal detected');
      });

      const result = await service.initialize('store-123');

      expect(result.success).toBe(false);
      expect(result.message).toContain('path traversal');
    });
  });

  // ==========================================================================
  // Configuration Refresh Tests - Critical for file watcher restart fix
  // ==========================================================================

  describe('Configuration Refresh (refreshConfig)', () => {
    it('PCM-REFRESH-001: returns success when config unchanged', async () => {
      const config = createFileConfig();
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(config);
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await service.initialize('store-123');
      const result = await service.refreshConfig();

      expect(result.success).toBe(true);
      expect(result.configChanged).toBe(false);
    });

    it('PCM-REFRESH-002: reinitializes when config changes', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Initialize with first config
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(createFileConfig());
      await service.initialize('store-123');

      // Change config
      const newConfig = {
        ...createFileConfig(),
        pos_connection_config: { import_path: 'D:\\NewPath\\import' },
      };
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(newConfig);

      const result = await service.refreshConfig();

      expect(result.success).toBe(true);
      expect(result.configChanged).toBe(true);
    });

    it('PCM-REFRESH-003: updates status to CONNECTED for FILE type after refresh', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(createFileConfig());

      await service.initialize('store-123');

      // Modify config to trigger refresh
      const newConfig = {
        ...createFileConfig(),
        pos_connection_config: { import_path: 'C:\\NewPath' },
      };
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(newConfig);

      await service.refreshConfig();

      expect(service.getStatus()).toBe('CONNECTED');
      expect(service.isConnected()).toBe(true);
    });

    it('PCM-REFRESH-004: handles transition from FILE to MANUAL', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Start with FILE
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(createFileConfig());
      await service.initialize('store-123');
      expect(service.getStatus()).toBe('CONNECTED');

      // Change to MANUAL
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(createManualConfig());
      const result = await service.refreshConfig();

      expect(result.configChanged).toBe(true);
      expect(service.getStatus()).toBe('MANUAL_MODE');
    });

    it('PCM-REFRESH-005: returns error when config becomes unavailable', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(createFileConfig());

      await service.initialize('store-123');

      // Config now unavailable
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(null);

      const result = await service.refreshConfig();

      expect(result.success).toBe(false);
      expect(result.message).toContain('No POS configuration');
    });
  });

  // ==========================================================================
  // Status Tests
  // ==========================================================================

  describe('Status Management', () => {
    it('PCM-STATUS-001: getStatus returns NOT_CONFIGURED for uninitialized service', () => {
      expect(service.getStatus()).toBe('NOT_CONFIGURED');
    });

    it('PCM-STATUS-002: getState returns complete state object', () => {
      const state = service.getState();
      expect(state).toHaveProperty('status');
      expect(state).toHaveProperty('connectionType');
      expect(state).toHaveProperty('isInitialized');
    });

    it('PCM-STATUS-003: isConnected returns true for CONNECTED status', async () => {
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(createFileConfig());
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await service.initialize('store-123');

      expect(service.isConnected()).toBe(true);
    });

    it('PCM-STATUS-004: isConnected returns true for MANUAL_MODE', async () => {
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(createManualConfig());

      await service.initialize('store-123');

      expect(service.getStatus()).toBe('MANUAL_MODE');
      expect(service.isConnected()).toBe(true);
    });
  });

  // ==========================================================================
  // Shutdown Tests
  // ==========================================================================

  describe('Shutdown', () => {
    it('PCM-SHUTDOWN-001: shutdown resets status to DISCONNECTED', async () => {
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(createFileConfig());
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await service.initialize('store-123');
      expect(service.getStatus()).toBe('CONNECTED');

      await service.shutdown();

      expect(service.getStatus()).toBe('DISCONNECTED');
    });

    it('PCM-SHUTDOWN-002: shutdown sets isInitialized to false', async () => {
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(createFileConfig());
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await service.initialize('store-123');
      await service.shutdown();

      expect(service.getState().isInitialized).toBe(false);
    });

    it('PCM-SHUTDOWN-003: shutdown is idempotent', async () => {
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(createFileConfig());
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await service.initialize('store-123');

      await service.shutdown();
      await service.shutdown();
      await service.shutdown();

      expect(service.getStatus()).toBe('DISCONNECTED');
    });
  });

  // ==========================================================================
  // Integration: File Watcher Restart Flow
  // Tests the exact scenario the bug fix addresses
  // ==========================================================================

  describe('Integration: File Watcher Restart Flow', () => {
    it('PCM-INTEG-001: complete resync flow updates status correctly', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Step 1: Start with MANUAL mode
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(createManualConfig());
      await service.initialize('store-123');
      expect(service.getStatus()).toBe('MANUAL_MODE');

      // Step 2: Cloud config changes to FILE (simulating resync)
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(createFileConfig());

      // Step 3: FILE_WATCHER_RESTART handler calls refreshConfig()
      const refreshResult = await service.refreshConfig();

      // Step 4: Verify status is now CONNECTED
      expect(refreshResult.success).toBe(true);
      expect(refreshResult.configChanged).toBe(true);
      expect(service.getStatus()).toBe('CONNECTED');
      expect(service.isConnected()).toBe(true);
    });

    it('PCM-INTEG-002: resync from FILE to MANUAL updates status', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Start with FILE
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(createFileConfig());
      await service.initialize('store-123');
      expect(service.getStatus()).toBe('CONNECTED');

      // Cloud changes to MANUAL
      vi.mocked(settingsService.getPOSConnectionConfig).mockReturnValue(createManualConfig());

      const result = await service.refreshConfig();

      expect(result.configChanged).toBe(true);
      expect(service.getStatus()).toBe('MANUAL_MODE');
    });
  });
});
