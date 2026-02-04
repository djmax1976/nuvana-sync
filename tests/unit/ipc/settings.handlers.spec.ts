/**
 * Settings IPC Handlers Unit Tests
 *
 * Tests for settings-related IPC handler functionality.
 * Validates API-001: Input validation
 * Validates API-004: Authentication for protected operations
 *
 * @module tests/unit/ipc/settings.handlers
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  createAppSettings,
  createApiKeyValidationResult,
  POS_TYPES,
  POS_CONNECTION_TYPES,
} from '../../fixtures/test-factories';

// Mock electron modules
vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((str: string) => Buffer.from(str)),
    decryptString: vi.fn((buf: Buffer) => buf.toString()),
  },
}));

// Mock settingsService
vi.mock('../../../src/main/services/settings.service', () => ({
  settingsService: {
    getAll: vi.fn(),
    updateLocal: vi.fn(),
    validateFolder: vi.fn(),
    validateAndSaveApiKey: vi.fn(),
    completeSetup: vi.fn(),
    isSetupComplete: vi.fn(),
    isConfigured: vi.fn(),
    getConfigurationStatus: vi.fn(),
    resetAll: vi.fn(),
    // Phase 4: POS compatibility methods
    isNAXMLCompatible: vi.fn(() => true),
    getFileWatcherUnavailableReason: vi.fn(() => null),
    getPOSConnectionType: vi.fn(() => 'FILE'),
  },
}));

// Mock posConnectionManager (Phase 4)
vi.mock('../../../src/main/services/pos-connection-manager.service', () => ({
  posConnectionManager: {
    getStatus: vi.fn(() => 'CONNECTED'),
    getState: vi.fn(() => ({
      connectionType: 'FILE',
      posType: 'GILBARCO_PASSPORT',
      status: 'CONNECTED',
      isInitialized: true,
    })),
    isConnected: vi.fn(() => true),
    on: vi.fn(),
  },
}));

// Mock cloudApiService
vi.mock('../../../src/main/services/cloud-api.service', () => ({
  cloudApiService: {
    healthCheck: vi.fn(),
  },
}));

// Mock IPC registry
vi.mock('../../../src/main/ipc/index', () => ({
  registerHandler: vi.fn(),
  createErrorResponse: vi.fn((code, message) => ({ error: code, message })),
  createSuccessResponse: vi.fn((data) => ({ data })),
  IPCErrorCodes: {
    NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
    FORBIDDEN: 'FORBIDDEN',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    NOT_FOUND: 'NOT_FOUND',
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

// Mock eventBus for SETUP_COMPLETED event emission
vi.mock('../../../src/main/utils/event-bus', () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn(),
  },
  MainEvents: {
    FILE_WATCHER_RESTART: 'file-watcher:restart',
    FILE_WATCHER_PROCESS_EXISTING: 'file-watcher:process-existing',
    SHIFT_CLOSED: 'shift:closed',
    SETUP_COMPLETED: 'setup:completed',
  },
}));

import { dialog } from 'electron';
import { settingsService } from '../../../src/main/services/settings.service';
import { cloudApiService } from '../../../src/main/services/cloud-api.service';
import {
  registerHandler,
  createErrorResponse,
  createSuccessResponse,
  IPCErrorCodes as _IPCErrorCodes,
} from '../../../src/main/ipc/index';
import { eventBus } from '../../../src/main/utils/event-bus';

// Import handlers to trigger registration
import '../../../src/main/ipc/settings.handlers';

// Type for IPC handler results
interface IPCResult {
  data?: unknown;
  error?: string;
  message?: string;
}

// Type for IPC handlers - eslint-disable needed for test flexibility
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IPCHandler = (...args: any[]) => Promise<IPCResult> | IPCResult;

describe('Settings IPC Handlers', () => {
  // Capture registered handlers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Map<string, any> = new Map();

  beforeEach(() => {
    vi.clearAllMocks();

    // Capture handler registrations
    vi.mocked(registerHandler).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    // Re-import to trigger registrations
    vi.resetModules();
  });

  afterEach(() => {
    handlers.clear();
  });

  describe('Handler Registration', () => {
    it('should register all settings handlers', async () => {
      // Import fresh to trigger registrations
      await import('../../../src/main/ipc/settings.handlers');

      expect(registerHandler).toHaveBeenCalledWith(
        'settings:get',
        expect.any(Function),
        expect.any(Object)
      );

      expect(registerHandler).toHaveBeenCalledWith(
        'settings:update',
        expect.any(Function),
        expect.objectContaining({
          requiresAuth: true,
          requiredRole: 'shift_manager',
        })
      );

      expect(registerHandler).toHaveBeenCalledWith(
        'settings:validateApiKey',
        expect.any(Function),
        expect.any(Object)
      );

      expect(registerHandler).toHaveBeenCalledWith(
        'settings:browseFolder',
        expect.any(Function),
        expect.any(Object)
      );

      expect(registerHandler).toHaveBeenCalledWith(
        'settings:validateFolder',
        expect.any(Function),
        expect.any(Object)
      );
    });

    it('should require shift_manager role for settings:update', async () => {
      await import('../../../src/main/ipc/settings.handlers');

      const updateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:update');

      expect(updateCall).toBeDefined();
      expect(updateCall?.[2]).toEqual(
        expect.objectContaining({
          requiresAuth: true,
          requiredRole: 'shift_manager',
        })
      );
    });

    it('should require store_manager role for settings:reset', async () => {
      await import('../../../src/main/ipc/settings.handlers');

      const resetCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:reset');

      expect(resetCall).toBeDefined();
      expect(resetCall?.[2]).toEqual(
        expect.objectContaining({
          requiresAuth: true,
          requiredRole: 'store_manager',
        })
      );
    });
  });

  describe('Input Validation', () => {
    it('should validate API key input schema', async () => {
      await import('../../../src/main/ipc/settings.handlers');

      const validateApiKeyCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:validateApiKey');

      expect(validateApiKeyCall).toBeDefined();

      // Handler should be registered
      const handler = validateApiKeyCall?.[1] as IPCHandler;
      expect(handler).toBeDefined();
    });

    it('should validate folder path input', async () => {
      await import('../../../src/main/ipc/settings.handlers');

      const validateFolderCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:validateFolder');

      expect(validateFolderCall).toBeDefined();
    });

    it('should validate local settings update input', async () => {
      await import('../../../src/main/ipc/settings.handlers');

      const updateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:update');

      expect(updateCall).toBeDefined();
    });
  });

  describe('Service Integration', () => {
    it('settings:get should call settingsService.getAll', async () => {
      const mockSettings = {
        storeId: 'store-123',
        storeName: 'Test Store',
      };
      vi.mocked(settingsService.getAll).mockReturnValue(
        mockSettings as unknown as ReturnType<typeof settingsService.getAll>
      );

      await import('../../../src/main/ipc/settings.handlers');

      const getCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:get');

      const handler = getCall?.[1] as IPCHandler;
      await handler();

      expect(settingsService.getAll).toHaveBeenCalled();
    });

    it('settings:testConnection should call cloudApiService.healthCheck', async () => {
      vi.mocked(cloudApiService.healthCheck).mockResolvedValue(true);

      await import('../../../src/main/ipc/settings.handlers');

      const testConnectionCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:testConnection');

      const handler = testConnectionCall?.[1] as IPCHandler;
      await handler();

      expect(cloudApiService.healthCheck).toHaveBeenCalled();
    });

    it('settings:browseFolder should open dialog', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: ['C:\\NAXML\\Export'],
      });
      vi.mocked(settingsService.validateFolder).mockReturnValue({ valid: true });

      await import('../../../src/main/ipc/settings.handlers');

      const browseCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:browseFolder');

      const handler = browseCall?.[1] as IPCHandler;
      await handler();

      expect(dialog.showOpenDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: ['openDirectory'],
        })
      );
    });

    it('settings:completeSetup should call settingsService.completeSetup', async () => {
      await import('../../../src/main/ipc/settings.handlers');

      const completeCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:completeSetup');

      const handler = completeCall?.[1] as IPCHandler;
      await handler();

      expect(settingsService.completeSetup).toHaveBeenCalled();
    });

    it('settings:completeSetup should emit SETUP_COMPLETED event to trigger service initialization', async () => {
      // Reset mock to track this specific test
      vi.mocked(eventBus.emit).mockClear();

      await import('../../../src/main/ipc/settings.handlers');

      const completeCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:completeSetup');

      const handler = completeCall?.[1] as IPCHandler;
      await handler();

      // Verify event is emitted to trigger service initialization
      expect(eventBus.emit).toHaveBeenCalledWith('setup:completed');
    });

    it('settings:isSetupComplete should call settingsService.isSetupComplete', async () => {
      vi.mocked(settingsService.isSetupComplete).mockReturnValue(true);
      vi.mocked(settingsService.getConfigurationStatus).mockReturnValue({
        databaseReady: true,
        hasStore: true,
        hasApiKey: true,
        setupComplete: true,
        hasWatchFolder: true,
        // New POS connection config fields
        hasPOSConnectionConfig: true,
        posConnectionType: 'FILE',
        posType: 'GILBARCO_PASSPORT',
        // Deprecated terminal fields (kept for backward compatibility)
        hasTerminalConfig: true,
        terminalConnectionType: 'FILE',
        terminalPosType: 'GILBARCO_PASSPORT',
      });

      await import('../../../src/main/ipc/settings.handlers');

      const isCompleteCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:isSetupComplete');

      const handler = isCompleteCall?.[1] as IPCHandler;
      await handler();

      expect(settingsService.isSetupComplete).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle service errors gracefully', async () => {
      vi.mocked(settingsService.updateLocal).mockImplementation(() => {
        throw new Error('Validation failed');
      });

      await import('../../../src/main/ipc/settings.handlers');

      const updateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:update');

      const handler = updateCall?.[1] as IPCHandler;
      const _result = await handler(null, { syncIntervalSeconds: 60 });

      expect(createErrorResponse).toHaveBeenCalled();
    });

    it('should handle connection test failure', async () => {
      vi.mocked(cloudApiService.healthCheck).mockRejectedValue(new Error('Network error'));

      await import('../../../src/main/ipc/settings.handlers');

      const testConnectionCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:testConnection');

      const handler = testConnectionCall?.[1] as IPCHandler;
      const _result = await handler();

      // Should return success response with online: false
      expect(createSuccessResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          online: false,
        })
      );
    });

    it('should handle canceled folder dialog', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: true,
        filePaths: [],
      });

      await import('../../../src/main/ipc/settings.handlers');

      const browseCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:browseFolder');

      const handler = browseCall?.[1] as IPCHandler;
      const _result = await handler();

      expect(createSuccessResponse).toHaveBeenCalledWith({ selected: false });
    });
  });

  // ==========================================================================
  // Business Day Cutoff Time IPC Handler Tests
  // SEC-014: Input validation for HH:MM format
  // ==========================================================================

  describe('Business Day Cutoff Time Validation', () => {
    it('BDCH-001: should accept valid cutoff time in settings:update', async () => {
      await import('../../../src/main/ipc/settings.handlers');

      const updateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:update');

      const handler = updateCall?.[1] as IPCHandler;
      await handler(null, { businessDayCutoffTime: '06:00' });

      expect(settingsService.updateLocal).toHaveBeenCalledWith(
        expect.objectContaining({
          businessDayCutoffTime: '06:00',
        })
      );
    });

    it('BDCH-002: should accept cutoff time at midnight (00:00)', async () => {
      await import('../../../src/main/ipc/settings.handlers');

      const updateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:update');

      const handler = updateCall?.[1] as IPCHandler;
      await handler(null, { businessDayCutoffTime: '00:00' });

      expect(settingsService.updateLocal).toHaveBeenCalledWith(
        expect.objectContaining({
          businessDayCutoffTime: '00:00',
        })
      );
    });

    it('BDCH-003: should accept cutoff time at end of day (23:59)', async () => {
      await import('../../../src/main/ipc/settings.handlers');

      const updateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:update');

      const handler = updateCall?.[1] as IPCHandler;
      await handler(null, { businessDayCutoffTime: '23:59' });

      expect(settingsService.updateLocal).toHaveBeenCalledWith(
        expect.objectContaining({
          businessDayCutoffTime: '23:59',
        })
      );
    });

    it('BDCH-010: should reject invalid hour (25:00)', async () => {
      await import('../../../src/main/ipc/settings.handlers');

      const updateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:update');

      const handler = updateCall?.[1] as IPCHandler;
      await handler(null, { businessDayCutoffTime: '25:00' });

      expect(createErrorResponse).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        expect.stringContaining('HH:MM format')
      );
    });

    it('BDCH-011: should reject invalid minute (06:60)', async () => {
      await import('../../../src/main/ipc/settings.handlers');

      const updateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:update');

      const handler = updateCall?.[1] as IPCHandler;
      await handler(null, { businessDayCutoffTime: '06:60' });

      expect(createErrorResponse).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        expect.stringContaining('HH:MM format')
      );
    });

    it('BDCH-012: should reject single-digit hour format (6:00)', async () => {
      await import('../../../src/main/ipc/settings.handlers');

      const updateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:update');

      const handler = updateCall?.[1] as IPCHandler;
      await handler(null, { businessDayCutoffTime: '6:00' });

      expect(createErrorResponse).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        expect.stringContaining('HH:MM format')
      );
    });

    it('BDCH-013: should reject 12-hour format with AM/PM', async () => {
      await import('../../../src/main/ipc/settings.handlers');

      const updateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:update');

      const handler = updateCall?.[1] as IPCHandler;
      await handler(null, { businessDayCutoffTime: '06:00 AM' });

      expect(createErrorResponse).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        expect.stringContaining('HH:MM format')
      );
    });

    it('BDCH-014: should reject empty string', async () => {
      await import('../../../src/main/ipc/settings.handlers');

      const updateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:update');

      const handler = updateCall?.[1] as IPCHandler;
      await handler(null, { businessDayCutoffTime: '' });

      expect(createErrorResponse).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        expect.stringContaining('HH:MM format')
      );
    });

    it('BDCH-015: should reject non-string input', async () => {
      await import('../../../src/main/ipc/settings.handlers');

      const updateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:update');

      const handler = updateCall?.[1] as IPCHandler;
      await handler(null, { businessDayCutoffTime: 600 });

      expect(createErrorResponse).toHaveBeenCalled();
    });

    it('BDCH-020: should allow cutoff time update without other settings', async () => {
      await import('../../../src/main/ipc/settings.handlers');

      const updateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:update');

      const handler = updateCall?.[1] as IPCHandler;
      await handler(null, { businessDayCutoffTime: '05:30' });

      expect(settingsService.updateLocal).toHaveBeenCalledWith({
        businessDayCutoffTime: '05:30',
      });
    });

    it('BDCH-021: should allow cutoff time update combined with other settings', async () => {
      await import('../../../src/main/ipc/settings.handlers');

      const updateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:update');

      const handler = updateCall?.[1] as IPCHandler;
      await handler(null, {
        businessDayCutoffTime: '07:00',
        syncIntervalSeconds: 120,
      });

      expect(settingsService.updateLocal).toHaveBeenCalledWith({
        businessDayCutoffTime: '07:00',
        syncIntervalSeconds: 120,
      });
    });

    it('BDCH-030: should include businessDayCutoffTime in settings:get response', async () => {
      vi.mocked(settingsService.getAll).mockReturnValue({
        storeId: 'store-123',
        storeName: 'Test Store',
        companyId: 'company-456',
        companyName: 'Test Company',
        timezone: 'America/New_York',
        features: [],
        xmlWatchFolder: '',
        syncIntervalSeconds: 60,
        businessDayCutoffTime: '06:00',
        lottery: { enabled: false, binCount: 0 },
        setupCompletedAt: null,
        // Version 8.0: POS connection configuration
        posConnectionConfig: null,
      } as ReturnType<typeof settingsService.getAll>);

      await import('../../../src/main/ipc/settings.handlers');

      const getCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:get');

      const handler = getCall?.[1] as IPCHandler;
      await handler();

      expect(createSuccessResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          businessDayCutoffTime: '06:00',
        })
      );
    });
  });

  // ==========================================================================
  // Business Day Cutoff - Setup Flow Tests
  // ==========================================================================

  describe('Business Day Cutoff - During Setup', () => {
    it('BDCS-001: should accept cutoff time in settings:updateDuringSetup', async () => {
      vi.mocked(settingsService.isSetupComplete).mockReturnValue(false);

      await import('../../../src/main/ipc/settings.handlers');

      const updateDuringSetupCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:updateDuringSetup');

      const handler = updateDuringSetupCall?.[1] as IPCHandler;
      await handler(null, { businessDayCutoffTime: '06:00' });

      expect(settingsService.updateLocal).toHaveBeenCalledWith(
        expect.objectContaining({
          businessDayCutoffTime: '06:00',
        })
      );
    });

    it('BDCS-002: should reject cutoff time update via setup endpoint after setup complete', async () => {
      vi.mocked(settingsService.isSetupComplete).mockReturnValue(true);

      await import('../../../src/main/ipc/settings.handlers');

      const updateDuringSetupCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:updateDuringSetup');

      const handler = updateDuringSetupCall?.[1] as IPCHandler;
      await handler(null, { businessDayCutoffTime: '06:00' });

      expect(createErrorResponse).toHaveBeenCalledWith(
        'FORBIDDEN',
        expect.stringContaining('Setup already complete')
      );
    });

    it('BDCS-003: should validate cutoff time format during setup', async () => {
      vi.mocked(settingsService.isSetupComplete).mockReturnValue(false);

      await import('../../../src/main/ipc/settings.handlers');

      const updateDuringSetupCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:updateDuringSetup');

      const handler = updateDuringSetupCall?.[1] as IPCHandler;
      await handler(null, { businessDayCutoffTime: 'invalid' });

      expect(createErrorResponse).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        expect.stringContaining('HH:MM format')
      );
    });
  });

  // ==========================================================================
  // Phase 4: POS Compatibility / File Watcher Status Tests
  // ==========================================================================

  describe('Phase 4: File Watcher Status in settings:get', () => {
    it('POS4-001: should include fileWatcherStatus in settings:get response', async () => {
      vi.mocked(settingsService.getAll).mockReturnValue({
        storeId: 'store-123',
        storeName: 'Test Store',
        companyId: 'company-456',
        companyName: 'Test Company',
        timezone: 'America/New_York',
        features: [],
        xmlWatchFolder: 'C:\\NAXML\\Export',
        syncIntervalSeconds: 60,
        businessDayCutoffTime: '06:00',
        lottery: { enabled: false, binCount: 0 },
        setupCompletedAt: null,
        posConnectionConfig: {
          pos_type: 'GILBARCO_PASSPORT',
          pos_connection_type: 'FILE',
          pos_connection_config: { import_path: 'C:\\NAXML\\Export' },
        },
      } as ReturnType<typeof settingsService.getAll>);

      vi.mocked(settingsService.isNAXMLCompatible).mockReturnValue(true);
      vi.mocked(settingsService.getFileWatcherUnavailableReason).mockReturnValue(null);
      vi.mocked(settingsService.getPOSConnectionType).mockReturnValue('FILE');

      await import('../../../src/main/ipc/settings.handlers');

      const getCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:get');

      const handler = getCall?.[1] as IPCHandler;
      await handler();

      expect(createSuccessResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          fileWatcherStatus: expect.objectContaining({
            isNAXMLCompatible: true,
            unavailableReason: null,
            isRunning: true,
          }),
        })
      );
    });

    it('POS4-002: should show unavailableReason when POS is not NAXML compatible', async () => {
      vi.mocked(settingsService.getAll).mockReturnValue(
        createAppSettings({
          storeId: 'store-123',
          storeName: 'Test Store',
          companyId: 'company-456',
          companyName: 'Test Company',
          posConnectionConfig: {
            pos_type: POS_TYPES.SQUARE_REST,
            pos_connection_type: POS_CONNECTION_TYPES.API,
            pos_connection_config: { base_url: 'https://api.square.com' },
          },
        }) as ReturnType<typeof settingsService.getAll>
      );

      vi.mocked(settingsService.isNAXMLCompatible).mockReturnValue(false);
      vi.mocked(settingsService.getFileWatcherUnavailableReason).mockReturnValue(
        'Square POS uses API connection, not file-based sync'
      );
      vi.mocked(settingsService.getPOSConnectionType).mockReturnValue('API');

      await import('../../../src/main/ipc/settings.handlers');

      const getCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:get');

      const handler = getCall?.[1] as IPCHandler;
      await handler();

      expect(createSuccessResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          fileWatcherStatus: expect.objectContaining({
            isNAXMLCompatible: false,
            unavailableReason: 'Square POS uses API connection, not file-based sync',
            isRunning: false,
          }),
        })
      );
    });

    it('POS4-003: should return null if settings are not configured', async () => {
      vi.mocked(settingsService.getAll).mockReturnValue(null);

      await import('../../../src/main/ipc/settings.handlers');

      const getCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:get');

      const handler = getCall?.[1] as IPCHandler;
      await handler();

      expect(createSuccessResponse).toHaveBeenCalledWith(null);
    });
  });

  describe('Phase 4: File Watcher Compatibility in settings:validateApiKey', () => {
    it('POS4-010: should include fileWatcherCompatible in validateApiKey response', async () => {
      vi.mocked(settingsService.validateAndSaveApiKey).mockResolvedValue(
        createApiKeyValidationResult({
          valid: true,
          store: {
            storeId: 'store-123',
            storeName: 'Test Store',
            companyId: 'company-456',
            companyName: 'Test Company',
            posConnectionConfig: {
              pos_type: POS_TYPES.GILBARCO_PASSPORT,
              pos_connection_type: POS_CONNECTION_TYPES.FILE,
              pos_connection_config: { import_path: 'C:\\NAXML\\Export' },
            },
          },
        })
      );

      vi.mocked(settingsService.isNAXMLCompatible).mockReturnValue(true);
      vi.mocked(settingsService.getFileWatcherUnavailableReason).mockReturnValue(null);

      await import('../../../src/main/ipc/settings.handlers');

      const validateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:validateApiKey');

      const handler = validateCall?.[1] as IPCHandler;
      await handler(null, { apiKey: 'test-api-key-123' });

      expect(createSuccessResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          valid: true,
          store: expect.objectContaining({
            fileWatcherCompatible: true,
            fileWatcherUnavailableReason: null,
          }),
        })
      );
    });

    it('POS4-011: should include unavailableReason for non-compatible POS in validateApiKey', async () => {
      vi.mocked(settingsService.validateAndSaveApiKey).mockResolvedValue(
        createApiKeyValidationResult({
          valid: true,
          store: {
            storeId: 'store-123',
            storeName: 'Test Store',
            companyId: 'company-456',
            companyName: 'Test Company',
            posConnectionConfig: {
              pos_type: POS_TYPES.CLOVER_REST,
              pos_connection_type: POS_CONNECTION_TYPES.API,
              pos_connection_config: { base_url: 'https://api.clover.com' },
            },
          },
        })
      );

      vi.mocked(settingsService.isNAXMLCompatible).mockReturnValue(false);
      vi.mocked(settingsService.getFileWatcherUnavailableReason).mockReturnValue(
        'Clover POS requires API integration'
      );

      await import('../../../src/main/ipc/settings.handlers');

      const validateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:validateApiKey');

      const handler = validateCall?.[1] as IPCHandler;
      await handler(null, { apiKey: 'test-api-key-456' });

      expect(createSuccessResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          valid: true,
          store: expect.objectContaining({
            fileWatcherCompatible: false,
            fileWatcherUnavailableReason: 'Clover POS requires API integration',
          }),
        })
      );
    });
  });

  // ==========================================================================
  // File Watcher Restart on API Key Resync Tests
  // Bug Fix: File watcher should restart after resyncing API key from Settings
  // ==========================================================================

  describe('settings:validateApiKey - File Watcher Restart', () => {
    describe('Resync (isInitialSetup: false)', () => {
      it('FW-RESYNC-001: emits FILE_WATCHER_RESTART when POS config changes to NAXML', async () => {
        // Arrange
        vi.mocked(settingsService.validateAndSaveApiKey).mockResolvedValue(
          createApiKeyValidationResult({
            valid: true,
            store: {
              storeId: 'test-store',
              storeName: 'Test Store',
              companyId: 'test-company',
              companyName: 'Test Company',
              posConnectionConfig: {
                pos_type: POS_TYPES.GILBARCO_PASSPORT,
                pos_connection_type: POS_CONNECTION_TYPES.FILE,
                pos_connection_config: { import_path: 'C:\\NAXML' },
              },
            },
          })
        );

        vi.mocked(settingsService.isNAXMLCompatible).mockReturnValue(true);
        vi.mocked(settingsService.getFileWatcherUnavailableReason).mockReturnValue(null);
        vi.mocked(eventBus.emit).mockClear();

        await import('../../../src/main/ipc/settings.handlers');

        const validateCall = vi
          .mocked(registerHandler)
          .mock.calls.find((call) => call[0] === 'settings:validateApiKey');

        const handler = validateCall?.[1] as IPCHandler;

        // Act
        const result = await handler(null, {
          apiKey: 'nuvpos_sk_test_valid',
          isInitialSetup: false, // RESYNC
        });

        // Assert
        expect(result).toBeDefined();
        expect(eventBus.emit).toHaveBeenCalledWith('file-watcher:restart');
      });

      it('FW-RESYNC-002: emits FILE_WATCHER_RESTART when POS config changes to MANUAL', async () => {
        // Arrange
        vi.mocked(settingsService.validateAndSaveApiKey).mockResolvedValue(
          createApiKeyValidationResult({
            valid: true,
            store: {
              storeId: 'test-store',
              storeName: 'Test Store',
              companyId: 'test-company',
              companyName: 'Test Company',
              posConnectionConfig: {
                pos_type: POS_TYPES.MANUAL_ENTRY,
                pos_connection_type: POS_CONNECTION_TYPES.MANUAL,
                pos_connection_config: null,
              },
            },
          })
        );

        vi.mocked(settingsService.isNAXMLCompatible).mockReturnValue(false);
        vi.mocked(settingsService.getFileWatcherUnavailableReason).mockReturnValue(
          'Manual entry mode does not use file sync'
        );
        vi.mocked(eventBus.emit).mockClear();

        await import('../../../src/main/ipc/settings.handlers');

        const validateCall = vi
          .mocked(registerHandler)
          .mock.calls.find((call) => call[0] === 'settings:validateApiKey');

        const handler = validateCall?.[1] as IPCHandler;

        // Act
        const result = await handler(null, {
          apiKey: 'nuvpos_sk_test_valid',
          isInitialSetup: false, // RESYNC
        });

        // Assert
        expect(result).toBeDefined();
        // FILE_WATCHER_RESTART is still emitted - startFileWatcher() will no-op for MANUAL
        expect(eventBus.emit).toHaveBeenCalledWith('file-watcher:restart');
      });

      it('FW-RESYNC-003: does NOT emit FILE_WATCHER_RESTART when validation fails', async () => {
        // Arrange
        vi.mocked(settingsService.validateAndSaveApiKey).mockResolvedValue(
          createApiKeyValidationResult({
            valid: false,
            error: 'Invalid API key',
          })
        );

        vi.mocked(eventBus.emit).mockClear();

        await import('../../../src/main/ipc/settings.handlers');

        const validateCall = vi
          .mocked(registerHandler)
          .mock.calls.find((call) => call[0] === 'settings:validateApiKey');

        const handler = validateCall?.[1] as IPCHandler;

        // Act
        await handler(null, {
          apiKey: 'nuvpos_sk_test_invalid',
          isInitialSetup: false,
        });

        // Assert
        expect(eventBus.emit).not.toHaveBeenCalledWith('file-watcher:restart');
      });

      it('FW-RESYNC-004: does NOT emit FILE_WATCHER_RESTART when no posConnectionConfig', async () => {
        // Arrange - Mock return value directly without factory to explicitly have no posConnectionConfig
        vi.mocked(settingsService.validateAndSaveApiKey).mockResolvedValue({
          valid: true,
          store: {
            valid: true,
            storeId: 'test-store',
            storeName: 'Test Store',
            storePublicId: 'test-store-public-id',
            companyId: 'test-company',
            companyName: 'Test Company',
            timezone: 'America/New_York',
            stateCode: 'NY',
            features: [],
            offlinePermissions: [],
            offlineToken: 'test-token',
            offlineTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
            lottery: { enabled: false, binCount: 0 },
            // Explicitly NO posConnectionConfig
            posConnectionConfig: undefined,
          },
        });

        vi.mocked(settingsService.isNAXMLCompatible).mockReturnValue(false);
        vi.mocked(settingsService.getFileWatcherUnavailableReason).mockReturnValue(null);
        vi.mocked(eventBus.emit).mockClear();

        await import('../../../src/main/ipc/settings.handlers');

        const validateCall = vi
          .mocked(registerHandler)
          .mock.calls.find((call) => call[0] === 'settings:validateApiKey');

        const handler = validateCall?.[1] as IPCHandler;

        // Act
        await handler(null, {
          apiKey: 'nuvpos_sk_test_valid',
          isInitialSetup: false,
        });

        // Assert
        expect(eventBus.emit).not.toHaveBeenCalledWith('file-watcher:restart');
      });
    });

    describe('Initial Setup (isInitialSetup: true)', () => {
      it('FW-SETUP-001: does NOT emit FILE_WATCHER_RESTART during initial setup', async () => {
        // Arrange
        vi.mocked(settingsService.validateAndSaveApiKey).mockResolvedValue(
          createApiKeyValidationResult({
            valid: true,
            store: {
              storeId: 'test-store',
              storeName: 'Test Store',
              companyId: 'test-company',
              companyName: 'Test Company',
              posConnectionConfig: {
                pos_type: POS_TYPES.GILBARCO_PASSPORT,
                pos_connection_type: POS_CONNECTION_TYPES.FILE,
                pos_connection_config: { import_path: 'C:\\NAXML' },
              },
            },
          })
        );

        vi.mocked(settingsService.isNAXMLCompatible).mockReturnValue(true);
        vi.mocked(settingsService.getFileWatcherUnavailableReason).mockReturnValue(null);
        vi.mocked(eventBus.emit).mockClear();

        await import('../../../src/main/ipc/settings.handlers');

        const validateCall = vi
          .mocked(registerHandler)
          .mock.calls.find((call) => call[0] === 'settings:validateApiKey');

        const handler = validateCall?.[1] as IPCHandler;

        // Act
        await handler(null, {
          apiKey: 'nuvpos_sk_test_valid',
          isInitialSetup: true, // INITIAL SETUP
        });

        // Assert
        // Should NOT emit - initial setup uses completeSetup -> SETUP_COMPLETED
        expect(eventBus.emit).not.toHaveBeenCalledWith('file-watcher:restart');
      });
    });
  });

  // ==========================================================================
  // Register sync in validateApiKey handler - Phase 6 Task 6.5
  // Tests registersCount field in success response
  // ==========================================================================
  describe('Register sync in validateApiKey handler', () => {
    // 6.5.1 - Returns registersCount in success response for MANUAL mode
    it('6.5.1: should return registersCount in success response for MANUAL mode with registers', async () => {
      const resultWithRegisters = createApiKeyValidationResult({
        store: {
          storeId: 'store-manual-ipc-001',
          posConnectionConfig: {
            pos_type: POS_TYPES.MANUAL_ENTRY,
            pos_connection_type: POS_CONNECTION_TYPES.MANUAL,
            pos_connection_config: null,
          },
          registers: [
            {
              external_register_id: 'R1',
              terminal_type: 'REGISTER',
              description: 'Reg 1',
              active: true,
            },
            {
              external_register_id: 'R2',
              terminal_type: 'REGISTER',
              description: 'Reg 2',
              active: true,
            },
            {
              external_register_id: 'R3',
              terminal_type: 'KIOSK',
              description: 'Kiosk 1',
              active: true,
            },
          ],
        },
      });

      vi.mocked(settingsService.validateAndSaveApiKey).mockResolvedValue(resultWithRegisters);

      await import('../../../src/main/ipc/settings.handlers');

      const validateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:validateApiKey');

      const handler = validateCall?.[1] as IPCHandler;
      await handler(null, {
        apiKey: 'nsk_live_validkeywith20ormorechars',
        isInitialSetup: true,
      });

      expect(createSuccessResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          store: expect.objectContaining({
            registersCount: 3,
          }),
        })
      );
    });

    // 6.5.2 - Returns registersCount: 0 for non-MANUAL modes
    it('6.5.2: should return registersCount 0 for non-MANUAL modes', async () => {
      const resultWithoutRegisters = createApiKeyValidationResult({
        store: {
          posConnectionConfig: {
            pos_type: POS_TYPES.GILBARCO_PASSPORT,
            pos_connection_type: POS_CONNECTION_TYPES.FILE,
            pos_connection_config: { import_path: 'C:\\NAXML\\Export' },
          },
          // No registers field
        },
      });

      vi.mocked(settingsService.validateAndSaveApiKey).mockResolvedValue(resultWithoutRegisters);

      await import('../../../src/main/ipc/settings.handlers');

      const validateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:validateApiKey');

      const handler = validateCall?.[1] as IPCHandler;
      await handler(null, {
        apiKey: 'nsk_live_validkeywith20ormorechars',
        isInitialSetup: true,
      });

      expect(createSuccessResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          store: expect.objectContaining({
            registersCount: 0,
          }),
        })
      );
    });

    // 6.5.3 - Returns registersCount: 0 for MANUAL mode with no registers from cloud
    it('6.5.3: should return registersCount 0 for MANUAL mode with no registers from cloud', async () => {
      const resultManualNoRegisters = createApiKeyValidationResult({
        store: {
          posConnectionConfig: {
            pos_type: POS_TYPES.MANUAL_ENTRY,
            pos_connection_type: POS_CONNECTION_TYPES.MANUAL,
            pos_connection_config: null,
          },
          registers: undefined, // No registers from cloud
        },
      });

      vi.mocked(settingsService.validateAndSaveApiKey).mockResolvedValue(resultManualNoRegisters);

      await import('../../../src/main/ipc/settings.handlers');

      const validateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:validateApiKey');

      const handler = validateCall?.[1] as IPCHandler;
      await handler(null, {
        apiKey: 'nsk_live_validkeywith20ormorechars',
        isInitialSetup: true,
      });

      expect(createSuccessResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          store: expect.objectContaining({
            registersCount: 0,
          }),
        })
      );
    });

    // 6.5.4 - Still emits FILE_WATCHER_RESTART on resync with MANUAL + registers
    it('6.5.4: should emit FILE_WATCHER_RESTART on resync with MANUAL mode and registers', async () => {
      const resultWithRegisters = createApiKeyValidationResult({
        store: {
          posConnectionConfig: {
            pos_type: POS_TYPES.MANUAL_ENTRY,
            pos_connection_type: POS_CONNECTION_TYPES.MANUAL,
            pos_connection_config: null,
          },
          registers: [
            {
              external_register_id: 'R1',
              terminal_type: 'REGISTER',
              description: 'Reg 1',
              active: true,
            },
          ],
        },
      });

      vi.mocked(settingsService.validateAndSaveApiKey).mockResolvedValue(resultWithRegisters);

      await import('../../../src/main/ipc/settings.handlers');

      const validateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'settings:validateApiKey');

      const handler = validateCall?.[1] as IPCHandler;
      await handler(null, {
        apiKey: 'nsk_live_validkeywith20ormorechars',
        isInitialSetup: false, // RESYNC
      });

      // Existing behavior: FILE_WATCHER_RESTART emitted on resync
      expect(eventBus.emit).toHaveBeenCalledWith('file-watcher:restart');
    });
  });
});
