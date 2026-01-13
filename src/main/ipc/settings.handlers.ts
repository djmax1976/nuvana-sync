/**
 * Settings IPC Handlers
 *
 * Handles settings-related IPC requests from the renderer process.
 * All handlers validate input using Zod schemas per API-001.
 *
 * @module main/ipc/settings.handlers
 * @security API-001: Input validation with Zod schemas
 * @security API-004: Authentication/role checks for sensitive operations
 * @security SEC-014: Input validation and path security
 * @security SEC-017: Audit logging for settings changes
 */

import { z } from 'zod';
import { dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import {
  registerHandler,
  createErrorResponse,
  createSuccessResponse,
  IPCErrorCodes,
} from './index';
import { settingsService } from '../services/settings.service';
import { cloudApiService } from '../services/cloud-api.service';
import { createLogger } from '../utils/logger';

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('settings-handlers');

// ============================================================================
// Validation Schemas (API-001)
// ============================================================================

/**
 * API Key validation schema
 */
const ApiKeySchema = z.object({
  apiKey: z
    .string()
    .min(1, 'API key is required')
    .max(500, 'API key too long'),
});

/**
 * Local settings update schema
 */
const LocalSettingsUpdateSchema = z.object({
  xmlWatchFolder: z.string().max(500).optional(),
  syncIntervalSeconds: z.number().int().min(30).max(3600).optional(),
});

/**
 * Folder path validation schema
 */
const FolderPathSchema = z.object({
  folderPath: z
    .string()
    .min(1, 'Folder path is required')
    .max(500, 'Path too long'),
});

// ============================================================================
// Handlers
// ============================================================================

/**
 * Get all settings
 *
 * Returns combined cloud and local settings.
 * Returns null if not configured.
 *
 * Channel: settings:get
 */
registerHandler(
  'settings:get',
  async () => {
    const settings = settingsService.getAll();

    if (!settings) {
      return createSuccessResponse(null);
    }

    return createSuccessResponse(settings);
  },
  {
    description: 'Get all application settings',
  }
);

/**
 * Update local settings
 *
 * Only MANAGER or higher can update settings.
 * Validates all inputs before applying.
 *
 * Channel: settings:update
 */
registerHandler(
  'settings:update',
  async (_event, input: unknown) => {
    // API-001: Validate input schema
    const parseResult = LocalSettingsUpdateSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e: { message: string }) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      settingsService.updateLocal(parseResult.data);

      log.info('Settings updated by user', {
        hasWatchFolder: !!parseResult.data.xmlWatchFolder,
        hasSyncInterval: !!parseResult.data.syncIntervalSeconds,
      });

      return createSuccessResponse({ success: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.warn('Settings update failed', { error: message });
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, message);
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'shift_manager',
    description: 'Update local settings (MANAGER only)',
  }
);

/**
 * Test cloud connection
 *
 * Performs a health check against the cloud API.
 *
 * Channel: settings:testConnection
 */
registerHandler(
  'settings:testConnection',
  async () => {
    try {
      const isOnline = await cloudApiService.healthCheck();

      return createSuccessResponse({
        online: isOnline,
        timestamp: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      return createSuccessResponse({
        online: false,
        error: message,
        timestamp: new Date().toISOString(),
      });
    }
  },
  {
    description: 'Test cloud API connection',
  }
);

/**
 * Validate API key
 *
 * Validates the API key against cloud and configures store on success.
 * Used during initial setup wizard.
 *
 * Channel: settings:validateApiKey
 */
registerHandler(
  'settings:validateApiKey',
  async (_event, input: unknown) => {
    // API-001: Validate input schema
    const parseResult = ApiKeySchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e: { message: string }) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { apiKey } = parseResult.data;

    log.info('API key validation requested');

    const result = await settingsService.validateAndSaveApiKey(apiKey);

    if (!result.valid) {
      return createSuccessResponse({
        valid: false,
        error: result.error,
      });
    }

    // Return store info for confirmation step
    return createSuccessResponse({
      valid: true,
      store: {
        storeId: result.store?.storeId,
        storeName: result.store?.storeName,
        companyId: result.store?.companyId,
        companyName: result.store?.companyName,
        timezone: result.store?.timezone,
        features: result.store?.features || [],
        lottery: result.store?.lottery,
      },
    });
  },
  {
    description: 'Validate API key and configure store',
  }
);

/**
 * Complete setup
 *
 * Marks the initial setup wizard as complete.
 *
 * Channel: settings:completeSetup
 */
registerHandler(
  'settings:completeSetup',
  async () => {
    settingsService.completeSetup();

    log.info('Setup completed via IPC');

    return createSuccessResponse({ success: true });
  },
  {
    description: 'Mark setup as complete',
  }
);

/**
 * Update settings during setup wizard
 *
 * Allows updating local settings (like xmlWatchFolder) during initial setup
 * when no user is logged in yet. Authorization is implicit through prior
 * API key validation.
 *
 * SEC-017: Only allowed when setup is not yet complete (prevents bypass)
 *
 * Channel: settings:updateDuringSetup
 */
registerHandler(
  'settings:updateDuringSetup',
  async (_event, input: unknown) => {
    // SEC-017: Only allow during setup phase (before setup is marked complete)
    if (settingsService.isSetupComplete()) {
      log.warn('Attempted to use setup endpoint after setup complete');
      return createErrorResponse(
        IPCErrorCodes.FORBIDDEN,
        'Setup already complete. Use settings:update with authentication.'
      );
    }

    // API-001: Validate input schema
    const parseResult = LocalSettingsUpdateSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e: { message: string }) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      settingsService.updateLocal(parseResult.data);

      log.info('Settings updated during setup', {
        hasWatchFolder: !!parseResult.data.xmlWatchFolder,
        hasSyncInterval: !!parseResult.data.syncIntervalSeconds,
      });

      return createSuccessResponse({ success: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.warn('Settings update during setup failed', { error: message });
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, message);
    }
  },
  {
    // No auth required during setup - authorization via API key validation
    description: 'Update local settings during setup wizard',
  }
);

/**
 * Check if setup is complete
 *
 * Used to determine whether to show setup wizard.
 *
 * Channel: settings:isSetupComplete
 */
registerHandler(
  'settings:isSetupComplete',
  async () => {
    const complete = settingsService.isSetupComplete();
    const status = settingsService.getConfigurationStatus();

    return createSuccessResponse({
      complete,
      status,
    });
  },
  {
    description: 'Check if initial setup is complete',
  }
);

/**
 * Browse for folder
 *
 * Opens a native folder picker dialog.
 *
 * Channel: settings:browseFolder
 */
registerHandler(
  'settings:browseFolder',
  async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select XML Watch Folder',
      buttonLabel: 'Select Folder',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return createSuccessResponse({ selected: false });
    }

    const selectedPath = result.filePaths[0];

    // Validate the selected path
    const validation = settingsService.validateFolder(selectedPath);

    return createSuccessResponse({
      selected: true,
      path: selectedPath,
      valid: validation.valid,
      error: validation.error,
    });
  },
  {
    description: 'Open folder browser dialog',
  }
);

/**
 * Validate folder path
 *
 * Validates a folder path for use as watch folder.
 * Checks existence, type, and accessibility.
 *
 * Channel: settings:validateFolder
 * @security SEC-014: Path traversal prevention
 */
registerHandler(
  'settings:validateFolder',
  async (_event, input: unknown) => {
    // API-001: Validate input schema
    const parseResult = FolderPathSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e: { message: string }) => e.message).join(', ');
      return createSuccessResponse({
        valid: false,
        error: errorMessage,
      });
    }

    const { folderPath } = parseResult.data;

    // SEC-014: Normalize and validate path
    const normalizedPath = path.normalize(folderPath);

    // Path traversal check
    if (normalizedPath.includes('..')) {
      log.warn('Path traversal attempt in folder validation');
      return createSuccessResponse({
        valid: false,
        error: 'Invalid path: contains directory traversal',
      });
    }

    // Use service validation
    const validation = settingsService.validateFolder(normalizedPath);

    return createSuccessResponse(validation);
  },
  {
    description: 'Validate folder path',
  }
);

/**
 * Get configuration status
 *
 * Returns status of each configuration component.
 * Used for diagnostics and status display.
 *
 * Channel: settings:getStatus
 */
registerHandler(
  'settings:getStatus',
  async () => {
    const status = settingsService.getConfigurationStatus();
    const isConfigured = settingsService.isConfigured();

    return createSuccessResponse({
      isConfigured,
      ...status,
    });
  },
  {
    description: 'Get configuration status',
  }
);

/**
 * Reset settings
 *
 * Clears all stored configuration.
 * Requires ADMIN role for security.
 *
 * Channel: settings:reset
 */
registerHandler(
  'settings:reset',
  async () => {
    log.warn('Settings reset requested');

    settingsService.resetAll();

    return createSuccessResponse({ success: true });
  },
  {
    requiresAuth: true,
    requiredRole: 'store_manager',
    description: 'Reset all settings (ADMIN only)',
  }
);

/**
 * Open cloud dashboard for user management
 *
 * Opens the cloud dashboard URL in the user's default browser.
 * Users are managed via the cloud dashboard, not locally.
 *
 * Channel: settings:openUserManagement
 * @security SEC-014: URL validated against configured API URL domain
 */
registerHandler(
  'settings:openUserManagement',
  async () => {
    // Get cloud endpoint from settings service
    const cloudEndpoint = settingsService.getCloudEndpoint();

    if (!cloudEndpoint) {
      return createErrorResponse(
        IPCErrorCodes.NOT_CONFIGURED,
        'Cloud API not configured. Complete setup first.'
      );
    }

    // SEC-014: Construct dashboard URL from configured API URL
    // This ensures we only open URLs for the configured tenant
    try {
      const apiUrl = new URL(cloudEndpoint);
      // Dashboard is typically on the same domain as API, just different path
      // e.g., API: https://api.nuvana.io/v1 -> Dashboard: https://app.nuvana.io/users
      // For now, use a subdomain swap pattern (api -> app)
      const dashboardHost = apiUrl.hostname.replace(/^api\./, 'app.');
      const dashboardUrl = `https://${dashboardHost}/users`;

      log.info('Opening cloud dashboard for user management', {
        dashboardUrl,
      });

      await shell.openExternal(dashboardUrl);

      return createSuccessResponse({
        opened: true,
        url: dashboardUrl,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to open dashboard';
      log.warn('Failed to open cloud dashboard', { error: message });
      return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, message);
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'shift_manager',
    description: 'Open cloud dashboard for user management',
  }
);

// Log handler registration
log.info('Settings IPC handlers registered');
