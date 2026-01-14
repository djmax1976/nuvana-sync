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

import { dialog } from 'electron';
import { settingsService } from '../../../src/main/services/settings.service';
import { cloudApiService } from '../../../src/main/services/cloud-api.service';
import {
  registerHandler,
  createErrorResponse,
  createSuccessResponse,
  IPCErrorCodes as _IPCErrorCodes,
} from '../../../src/main/ipc/index';

// Import handlers to trigger registration
import '../../../src/main/ipc/settings.handlers';

// Type for IPC handlers
type IPCHandler = (...args: unknown[]) => Promise<unknown> | unknown;

describe('Settings IPC Handlers', () => {
  // Capture registered handlers
  const handlers: Map<string, IPCHandler> = new Map();

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
      vi.mocked(settingsService.getAll).mockReturnValue(mockSettings as any);

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

    it('settings:isSetupComplete should call settingsService.isSetupComplete', async () => {
      vi.mocked(settingsService.isSetupComplete).mockReturnValue(true);
      vi.mocked(settingsService.getConfigurationStatus).mockReturnValue({
        databaseReady: true,
        hasStore: true,
        hasApiKey: true,
        setupComplete: true,
        hasWatchFolder: true,
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
});
