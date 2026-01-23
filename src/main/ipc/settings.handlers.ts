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
import {
  registerHandler,
  createErrorResponse,
  createSuccessResponse,
  IPCErrorCodes,
} from './index';
import { settingsService } from '../services/settings.service';
import { cloudApiService } from '../services/cloud-api.service';
import { createLogger } from '../utils/logger';
import {
  getAppliedMigrationDetails,
  getCurrentSchemaVersion,
  runMigrations,
} from '../services/migration.service';
import { eventBus, MainEvents } from '../utils/event-bus';
import { storesDAL } from '../dal/stores.dal';
import { syncQueueDAL } from '../dal/sync-queue.dal';

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
  apiKey: z.string().min(1, 'API key is required').max(500, 'API key too long'),
});

/**
 * Local settings update schema
 */
const LocalSettingsUpdateSchema = z.object({
  xmlWatchFolder: z.string().max(500).optional(),
  syncIntervalSeconds: z.number().int().min(30).max(3600).optional(),
  businessDayCutoffTime: z
    .string()
    .regex(
      /^([01]\d|2[0-3]):([0-5]\d)$/,
      'Cutoff time must be in HH:MM format (24-hour, e.g., "06:00")'
    )
    .optional(),
});

/**
 * Folder path validation schema
 */
const FolderPathSchema = z.object({
  folderPath: z.string().min(1, 'Folder path is required').max(500, 'Path too long'),
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
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      settingsService.updateLocal(parseResult.data);

      log.info('Settings updated by user', {
        hasWatchFolder: !!parseResult.data.xmlWatchFolder,
        hasSyncInterval: !!parseResult.data.syncIntervalSeconds,
        hasCutoffTime: !!parseResult.data.businessDayCutoffTime,
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
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
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
 * Marks the initial setup wizard as complete and triggers service initialization.
 * Emits SETUP_COMPLETED event to start sync engine, user sync, lottery sync,
 * and file watcher (if configured) without requiring app restart.
 *
 * Channel: settings:completeSetup
 *
 * @security LM-001: Structured logging with relevant context
 * @security API-003: Error handling with sanitized responses
 */
registerHandler(
  'settings:completeSetup',
  async () => {
    // Mark setup as complete first
    settingsService.completeSetup();

    log.info('Setup completed via IPC - emitting SETUP_COMPLETED event to initialize services');

    // Emit event to trigger service initialization in main process
    // This decouples the IPC handler from service management and follows
    // the established event-driven pattern used by FILE_WATCHER_RESTART
    eventBus.emit(MainEvents.SETUP_COMPLETED);

    return createSuccessResponse({ success: true });
  },
  {
    description: 'Mark setup as complete and initialize services',
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
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
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
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
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
    // Get API URL from settings service
    const cloudEndpoint = settingsService.getApiUrl();

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

/**
 * Update local settings as cloud-authenticated support user
 *
 * This handler allows cloud-authenticated SUPPORT/SUPERADMIN users to update
 * settings without requiring local PIN authentication.
 *
 * The cloud authentication is verified by re-validating the user's credentials
 * against the cloud API and checking their roles.
 *
 * @security API-001: Input validation with Zod schemas
 * @security API-004: Cloud-based role verification
 * @security SEC-017: Audit logging for settings changes
 *
 * Channel: settings:updateAsSupport
 */
const SupportSettingsUpdateSchema = z.object({
  settings: LocalSettingsUpdateSchema,
  cloudAuth: z.object({
    email: z.string().email('Invalid email format'),
    userId: z.string().min(1, 'User ID required'),
    roles: z.array(z.string()).min(1, 'Roles required'),
  }),
});

/** Allowed roles for support settings access */
const SUPPORT_SETTINGS_ROLES = ['SUPPORT', 'SUPERADMIN'];

registerHandler(
  'settings:updateAsSupport',
  async (_event, input: unknown) => {
    // API-001: Validate input schema
    const parseResult = SupportSettingsUpdateSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { settings, cloudAuth } = parseResult.data;

    // API-004: Verify user has required cloud role
    const userRoles = cloudAuth.roles.map((r) => r.toUpperCase());
    const hasRequiredRole = SUPPORT_SETTINGS_ROLES.some((role) =>
      userRoles.includes(role.toUpperCase())
    );

    if (!hasRequiredRole) {
      log.warn('Unauthorized settings update attempt', {
        userId: cloudAuth.userId,
        roles: cloudAuth.roles,
      });
      return createErrorResponse(
        IPCErrorCodes.FORBIDDEN,
        'Access denied. Only SUPPORT or SUPERADMIN roles can update settings.'
      );
    }

    // SEC-017: Log the settings change with cloud user info
    log.info('Settings update by cloud support user', {
      userId: cloudAuth.userId,
      email: cloudAuth.email.substring(0, 3) + '***',
      roles: cloudAuth.roles,
      hasWatchFolder: !!settings.xmlWatchFolder,
      hasSyncInterval: !!settings.syncIntervalSeconds,
      hasCutoffTime: !!settings.businessDayCutoffTime,
    });

    try {
      settingsService.updateLocal(settings);

      log.info('Settings updated successfully by support user', {
        userId: cloudAuth.userId,
      });

      return createSuccessResponse({ success: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.warn('Settings update by support user failed', {
        userId: cloudAuth.userId,
        error: message,
      });
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, message);
    }
  },
  {
    // No local auth required - cloud auth is verified in handler
    description: 'Update local settings as cloud-authenticated support user',
  }
);

// ============================================================================
// Debug: Migration Status & Runner
// ============================================================================

/**
 * Get migration status (for debugging)
 *
 * Channel: settings:getMigrationStatus
 */
registerHandler(
  'settings:getMigrationStatus',
  async () => {
    try {
      const schemaVersion = getCurrentSchemaVersion();
      const appliedMigrations = getAppliedMigrationDetails();

      return createSuccessResponse({
        schemaVersion,
        appliedMigrations,
        migrationsCount: appliedMigrations.length,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, message);
    }
  },
  {
    description: 'Get migration status (debug)',
  }
);

/**
 * Run pending migrations (for debugging)
 *
 * Channel: settings:runPendingMigrations
 */
registerHandler(
  'settings:runPendingMigrations',
  async () => {
    try {
      const migrationsDir = path.join(__dirname, '..', 'migrations');
      log.info('Running pending migrations', { migrationsDir });

      const summary = runMigrations(migrationsDir);

      log.info('Migration run completed', {
        applied: summary.applied.length,
        skipped: summary.skipped.length,
        failed: summary.failed,
      });

      return createSuccessResponse({
        success: !summary.failed,
        applied: summary.applied,
        skipped: summary.skipped,
        failed: summary.failed,
        totalDurationMs: summary.totalDurationMs,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Migration run failed', { error: message });
      return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, message);
    }
  },
  {
    // No auth required - this is a maintenance/debug operation
    description: 'Run pending database migrations (debug)',
  }
);

// ============================================================================
// Store Reset
// ============================================================================

/**
 * Reset store data with cloud authorization and audit logging
 *
 * This endpoint is protected by cloud authentication (SUPPORT/SUPERADMIN only).
 * The reset is authorized and audit-logged by the cloud API before local deletion.
 *
 * Flow:
 * 1. Validate input and cloud auth
 * 2. Call cloud API for authorization (audit logged server-side)
 * 3. Clear local tables based on clearTargets from server
 * 4. Optionally delete settings file
 * 5. Return audit reference ID
 * 6. Trigger app restart (handled by renderer)
 *
 * @security API-001: Input validation with Zod schema
 * @security API-004: Cloud-based role verification (SUPPORT/SUPERADMIN only)
 * @security SEC-017: Full audit trail recorded server-side
 *
 * Channel: settings:resetStore
 */
const ResetStoreRequestSchema = z.object({
  resetType: z.enum(['FULL_RESET', 'LOTTERY_ONLY', 'SYNC_STATE']),
  reason: z.string().max(500).optional(),
  deleteSettings: z.boolean().default(false),
  cloudAuth: z.object({
    email: z.string().email('Invalid email format'),
    userId: z.string().min(1, 'User ID required'),
    roles: z.array(z.string()).min(1, 'Roles required'),
  }),
});

/** Allowed roles for store reset access */
const STORE_RESET_ROLES = ['SUPPORT', 'SUPERADMIN'];

registerHandler(
  'settings:resetStore',
  async (_event, input: unknown) => {
    // API-001: Validate input schema
    const parseResult = ResetStoreRequestSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { resetType, reason, deleteSettings, cloudAuth } = parseResult.data;

    // API-004: Verify user has required cloud role
    const userRoles = cloudAuth.roles.map((r) => r.toUpperCase());
    const hasRequiredRole = STORE_RESET_ROLES.some((role) =>
      userRoles.includes(role.toUpperCase())
    );

    if (!hasRequiredRole) {
      log.warn('Unauthorized store reset attempt', {
        userId: cloudAuth.userId,
        roles: cloudAuth.roles,
        resetType,
      });
      return createErrorResponse(
        IPCErrorCodes.FORBIDDEN,
        'Access denied. Only SUPPORT or SUPERADMIN roles can reset store data.'
      );
    }

    // SEC-017: Log the reset attempt with cloud user info
    log.info('Store reset requested by cloud support user', {
      userId: cloudAuth.userId,
      email: cloudAuth.email.substring(0, 3) + '***',
      roles: cloudAuth.roles,
      resetType,
      hasReason: !!reason,
      deleteSettings,
    });

    try {
      // Get app version for audit
      const { app: electronApp } = await import('electron');
      const appVersion = electronApp.getVersion();

      log.info('Calling cloud API for reset authorization', {
        resetType,
        appVersion,
        hasReason: !!reason,
      });

      // Step 1: Call cloud API for authorization (audit logged server-side)
      const resetResponse = await cloudApiService.resetStore({
        resetType,
        reason,
        appVersion,
        confirmed: true,
      });

      if (!resetResponse.success || !resetResponse.data.authorized) {
        log.warn('Store reset not authorized by cloud', {
          userId: cloudAuth.userId,
          resetType,
        });
        return createErrorResponse(
          IPCErrorCodes.FORBIDDEN,
          'Store reset not authorized. Please contact support.'
        );
      }

      const { auditReferenceId, instructions } = resetResponse.data;
      const { clearTargets, resyncRequired } = instructions;

      log.info('Store reset authorized by cloud', {
        auditReferenceId,
        clearTargetsCount: clearTargets.length,
        clearTargets,
        resyncRequired,
      });

      // Step 2: Clear local data based on reset type
      const { getDatabase, closeDatabase, getDbPath } =
        await import('../services/database.service');
      const fs = await import('fs');

      let tablesCleared = 0;
      const clearedTables: string[] = [];
      const failedTables: string[] = [];
      let databaseDeleted = false;

      if (resetType === 'FULL_RESET') {
        // Step 2a: Clear all data from database BEFORE deletion (belt-and-suspenders safety net)
        // This ensures data is cleared even if file deletion fails or CASCADE doesn't trigger
        try {
          const db = getDatabase();
          if (db) {
            // SEC-006: Use DAL methods with parameterized queries (no SQL injection risk)
            // Explicitly clear sync_queue first (in case CASCADE fails)
            const syncQueueDeleted = syncQueueDAL.deleteAll();
            log.info('Sync queue cleared before database deletion', {
              deletedCount: syncQueueDeleted,
              auditReferenceId,
            });

            // Delete all stores (triggers CASCADE to users table via FK constraint)
            const storesDeleted = storesDAL.deleteAllStores();
            log.info('Stores cleared before database deletion', {
              deletedCount: storesDeleted,
              cascadeTriggered: true,
              affectedTables: ['users', 'sync_queue'],
              auditReferenceId,
            });

            tablesCleared = syncQueueDeleted + storesDeleted;
            clearedTables.push('sync_queue', 'stores');
          }
        } catch (clearError) {
          // API-003: Log error server-side but proceed with file deletion
          log.warn('Pre-deletion table clearing failed, proceeding with file deletion', {
            error: clearError instanceof Error ? clearError.message : 'Unknown error',
            auditReferenceId,
          });
        }

        // Step 2b: Close database and delete file
        try {
          const dbPath = getDbPath();
          log.info('Deleting database file for FULL_RESET', { dbPath, auditReferenceId });

          // Close database connection first
          closeDatabase();

          // Delete the database file
          if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
            databaseDeleted = true;
            log.info('Database file deleted', { dbPath, auditReferenceId });
          }

          // Also delete WAL and SHM files if they exist (SQLite journal files)
          const walPath = dbPath + '-wal';
          const shmPath = dbPath + '-shm';
          if (fs.existsSync(walPath)) {
            fs.unlinkSync(walPath);
            log.debug('WAL file deleted');
          }
          if (fs.existsSync(shmPath)) {
            fs.unlinkSync(shmPath);
            log.debug('SHM file deleted');
          }
        } catch (dbDeleteError) {
          // API-003: Log detailed error server-side
          log.error('Failed to delete database file', {
            error: dbDeleteError instanceof Error ? dbDeleteError.message : 'Unknown error',
            auditReferenceId,
          });
          failedTables.push('DATABASE_FILE');
        }
      } else {
        // For LOTTERY_ONLY and SYNC_STATE: Clear specific tables
        const db = getDatabase();

        for (const tableName of clearTargets) {
          try {
            // SEC-006: Validate table name format to prevent SQL injection
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
              log.warn('Invalid table name in clearTargets, skipping', { tableName });
              failedTables.push(tableName);
              continue;
            }

            // Check if table exists before attempting to clear
            const tableExists = db
              .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
              .get(tableName);

            if (tableExists) {
              db.prepare(`DELETE FROM "${tableName}"`).run();
              tablesCleared++;
              clearedTables.push(tableName);
              log.debug('Cleared table', { tableName });
            } else {
              log.debug('Table does not exist, skipping', { tableName });
            }
          } catch (tableError) {
            log.warn('Failed to clear table', {
              tableName,
              error: tableError instanceof Error ? tableError.message : 'Unknown error',
            });
            failedTables.push(tableName);
          }
        }

        log.info('Local tables cleared', {
          tablesCleared,
          clearedTables,
          failedTables,
          auditReferenceId,
        });
      }

      // Step 3: Delete or clear config files
      let settingsDeleted = false;
      let licenseDeleted = false;

      if (resetType === 'FULL_RESET') {
        // For FULL_RESET: Delete ALL config files (nuvana.json AND nuvana-license.json)
        // SEC-017: Complete clean slate for new store configuration
        try {
          const configResult = settingsService.deleteAllConfigFiles();
          settingsDeleted = configResult.settingsDeleted !== null;
          licenseDeleted = configResult.licenseDeleted !== null;

          log.info('All config files deleted for FULL_RESET', {
            settingsDeleted: configResult.settingsDeleted,
            licenseDeleted: configResult.licenseDeleted,
            auditReferenceId,
          });
        } catch (configError) {
          // API-003: Log error server-side with sanitized client response
          log.warn('Failed to delete config files', {
            error: configError instanceof Error ? configError.message : 'Unknown error',
            auditReferenceId,
          });
        }
      } else if (deleteSettings) {
        // For other reset types with deleteSettings flag: just clear the store (no file deletion)
        try {
          settingsService.resetAll();
          settingsDeleted = true;
          log.info('Settings cleared', { auditReferenceId });
        } catch (settingsError) {
          // API-003: Log error server-side
          log.warn('Failed to reset settings', {
            error: settingsError instanceof Error ? settingsError.message : 'Unknown error',
            auditReferenceId,
          });
        }
      }

      // SEC-017: Final audit log with comprehensive state
      log.info('Store reset completed', {
        auditReferenceId,
        resetType,
        databaseDeleted,
        tablesCleared,
        settingsDeleted,
        licenseDeleted,
        resyncRequired,
        performedBy: {
          userId: cloudAuth.userId,
          email: cloudAuth.email.substring(0, 3) + '***',
        },
      });

      return createSuccessResponse({
        success: true,
        auditReferenceId,
        databaseDeleted,
        tablesCleared,
        clearedTables,
        failedTables,
        settingsDeleted,
        licenseDeleted,
        resyncRequired,
        serverTime: resetResponse.data.serverTime,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Store reset failed', {
        userId: cloudAuth.userId,
        resetType,
        error: message,
      });
      return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, `Reset failed: ${message}`);
    }
  },
  {
    // No local auth required - cloud auth is verified in handler
    description: 'Reset store data with cloud authorization and audit logging',
  }
);

// Log handler registration
log.info('Settings IPC handlers registered');
