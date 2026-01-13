/**
 * Nuvana - Electron Main Process
 *
 * Entry point for the desktop application.
 * Handles window management, system tray, and IPC communication.
 *
 * @module main
 * @security SEC-014: IPC input validation, LM-001: Structured logging
 * @security DB-005: Pre-migration backup
 * @security DB-007: Encrypted database initialization
 */

import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, IpcMainInvokeEvent } from 'electron';
import { join } from 'path';
import { FileWatcherService } from './services/file-watcher.service';
import { ConfigService } from './services/config.service';
import { SyncService } from './services/sync.service';
import { createLogger } from './utils/logger';
import { safeValidateConfigUpdate, safeValidateConfig } from '../shared/types/config.types';
import { initializeIPC } from './ipc';
import {
  bootstrapDatabase,
  shutdownDatabase,
  isDatabaseReady,
  getDatabaseState,
  performHealthCheck,
  type BootstrapResult,
} from './services/database-bootstrap.service';

import { licenseService } from './services/license.service';
import { cloudApiService } from './services/cloud-api.service';
import { settingsService } from './services/settings.service';
import { userSyncService } from './services/user-sync.service';
import { bidirectionalSyncService } from './services/bidirectional-sync.service';
// ============================================================================
// EPIPE Error Handling - Suppress broken pipe errors
// ============================================================================
// Handle stream errors silently (EPIPE happens when stdout/stderr pipe is closed)
process.stdout?.on?.('error', () => {});
process.stderr?.on?.('error', () => {});

// Catch uncaught exceptions - suppress EPIPE
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE' || err.message?.includes('EPIPE')) return;
  // Let other errors propagate to Electron's default handler
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', () => {});

const log = createLogger('main');

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  log.warn('Another instance is running, quitting');
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let fileWatcher: FileWatcherService | null = null;
  let syncService: SyncService | null = null;
  // Auto-updater service - dynamically imported to avoid electron-updater initialization issues
  let autoUpdaterService: { setMainWindow: (w: BrowserWindow) => void; startPeriodicCheck: () => void; destroy: () => void } | null = null;
  // User sync interval (60 seconds)
  let userSyncInterval: NodeJS.Timeout | null = null;
  const USER_SYNC_INTERVAL_MS = 60 * 1000;

  // Initialize services
  const configService = new ConfigService();
  log.info('Application starting');

  // Database bootstrap result (set during initialization)
  let databaseBootstrapResult: BootstrapResult | null = null;

  const createWindow = (): void => {
    log.info('Creating main window');

    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      show: false,
      autoHideMenuBar: true,
      title: 'Nuvana',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        // SECURITY: Critical settings for context isolation
        nodeIntegration: false, // SEC-014: Never enable node integration in renderer
        contextIsolation: true, // SEC-014: Required for secure IPC
        sandbox: true, // SEC-014: Additional process isolation
        webSecurity: true, // SEC-014: Prevent loading remote content
      },
    });

    // SECURITY: Prevent navigation to external URLs
    mainWindow.webContents.on('will-navigate', (event, url) => {
      try {
        const parsedUrl = new URL(url);
        // Allow file: protocol and development server only
        if (
          parsedUrl.protocol !== 'file:' &&
          !(process.env.NODE_ENV === 'development' && parsedUrl.hostname === 'localhost')
        ) {
          event.preventDefault();
          log.warn('Blocked navigation to external URL', { url: parsedUrl.href });
        }
      } catch (error) {
        event.preventDefault();
        log.warn('Blocked navigation to invalid URL', { url });
      }
    });

    // SECURITY: Block new window creation to prevent popup attacks
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      log.warn('Blocked new window creation', { url });
      return { action: 'deny' };
    });

    mainWindow.on('ready-to-show', () => {
      mainWindow?.show();
      log.info('Main window ready');
    });

    // Minimize to tray instead of closing
    mainWindow.on('close', (event) => {
      const config = configService.getConfig();
      if (config.minimizeToTray && !(app as { isQuitting?: boolean }).isQuitting) {
        event.preventDefault();
        mainWindow?.hide();
        log.debug('Window hidden to tray');
      }
    });

    // Load the renderer
    if (process.env.NODE_ENV === 'development') {
      mainWindow.loadURL('http://localhost:5173');
      mainWindow.webContents.openDevTools();
      log.info('Loaded development server');
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
      log.info('Loaded production build');
    }
  };

  const createTray = (): void => {
    log.info('Creating system tray');

    // Load tray icon from resources
    const iconPath = join(__dirname, '../../resources/icon.ico');
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Nuvana',
        click: () => {
          mainWindow?.show();
        },
      },
      {
        label: 'Pause Sync',
        type: 'checkbox',
        checked: false,
        click: (menuItem) => {
          if (menuItem.checked) {
            fileWatcher?.stop();
            log.info('Sync paused from tray');
          } else {
            startFileWatcher();
            log.info('Sync resumed from tray');
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Settings',
        click: () => {
          mainWindow?.show();
          mainWindow?.webContents.send('navigate', '/settings');
        },
      },
      { type: 'separator' },
      {
        label: 'Exit',
        click: () => {
          (app as { isQuitting?: boolean }).isQuitting = true;
          app.quit();
        },
      },
    ]);

    tray.setToolTip('Nuvana');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
      mainWindow?.show();
    });
  };

  /**
   * Start periodic user sync from cloud
   * Syncs users on startup and every 60 seconds thereafter
   */
  const startUserSync = (): void => {
    const config = configService.getConfig();

    if (!config.isConfigured || !config.apiUrl || !config.apiKey) {
      log.info('User sync not started: not fully configured');
      return;
    }

    // Initial sync on startup
    log.info('Performing initial user sync...');
    userSyncService.syncUsers()
      .then((result) => {
        log.info('Initial user sync completed', {
          synced: result.synced,
          created: result.created,
          updated: result.updated,
          deactivated: result.deactivated,
          errors: result.errors.length,
        });
      })
      .catch((error) => {
        log.warn('Initial user sync failed - will retry on interval', {
          error: error instanceof Error ? error.message : String(error),
        });
      });

    // Initial lottery data sync (bins and games)
    // Check if lottery is enabled for this store
    const appSettings = settingsService.getAll();
    const lotteryEnabled = appSettings?.lottery?.enabled;
    if (lotteryEnabled) {
      log.info('Performing initial lottery sync (bins and games)...');

      // Sync bins first, then games
      bidirectionalSyncService.syncBins()
        .then((binsResult) => {
          log.info('Initial bins sync completed', {
            pulled: binsResult.pulled,
            pushed: binsResult.pushed,
            errors: binsResult.errors.length,
          });
          return bidirectionalSyncService.syncGames();
        })
        .then((gamesResult) => {
          log.info('Initial games sync completed', {
            pulled: gamesResult.pulled,
            pushed: gamesResult.pushed,
            errors: gamesResult.errors.length,
          });
        })
        .catch((error) => {
          log.warn('Initial lottery sync failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    } else {
      log.debug('Lottery sync skipped - lottery not enabled for this store');
    }

    // Start periodic sync
    if (userSyncInterval) {
      clearInterval(userSyncInterval);
    }

    userSyncInterval = setInterval(() => {
      log.debug('Running periodic user sync...');
      userSyncService.syncUsers()
        .then((result) => {
          if (result.created > 0 || result.updated > 0 || result.deactivated > 0) {
            log.info('Periodic user sync completed with changes', {
              created: result.created,
              updated: result.updated,
              deactivated: result.deactivated,
            });
            // Notify renderer of user changes
            mainWindow?.webContents.send('sync:usersUpdated', result);
          } else {
            log.debug('Periodic user sync completed - no changes');
          }
        })
        .catch((error) => {
          log.warn('Periodic user sync failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }, USER_SYNC_INTERVAL_MS);

    log.info('User sync scheduler started', { intervalMs: USER_SYNC_INTERVAL_MS });
  };

  /**
   * Stop user sync scheduler
   */
  const stopUserSync = (): void => {
    if (userSyncInterval) {
      clearInterval(userSyncInterval);
      userSyncInterval = null;
      log.info('User sync scheduler stopped');
    }
  };

  const startFileWatcher = (): void => {
    const config = configService.getConfig();

    if (!config.watchPath || !config.apiUrl || !config.apiKey) {
      log.warn('File watcher not started: missing configuration', {
        hasWatchPath: Boolean(config.watchPath),
        hasApiUrl: Boolean(config.apiUrl),
        hasApiKey: Boolean(config.apiKey),
      });
      return;
    }

    log.info('Starting file watcher', { watchPath: config.watchPath });

    // Local-first: FileWatcherService now uses ParserService internally
    // SyncService is kept for cloud sync operations
    syncService = new SyncService(config);
    fileWatcher = new FileWatcherService(config, config.storeId);

    fileWatcher.on('file-detected', (filePath: string) => {
      mainWindow?.webContents.send('sync-status', {
        type: 'file-detected',
        filePath,
      });
    });

    fileWatcher.on('file-processed', (data: { filePath: string; success: boolean }) => {
      mainWindow?.webContents.send('sync-status', {
        type: 'file-processed',
        ...data,
      });
    });

    fileWatcher.on('file-error', (data: { filePath: string; error: string }) => {
      mainWindow?.webContents.send('sync-status', {
        type: 'file-error',
        ...data,
      });
    });

    fileWatcher.start();
  };

  /**
   * SEC-014: Validate IPC input before processing
   */
  const setupIpcHandlers = (): void => {
    log.info('Setting up IPC handlers');

    // Get current config
    ipcMain.handle('config:get', (_event: IpcMainInvokeEvent) => {
      const config = configService.getConfig();
      return {
        isConfigured: config.isConfigured,
        config,
      };
    });

    // Save config - SEC-014: Validate input
    ipcMain.handle('config:save', (_event: IpcMainInvokeEvent, configInput: unknown) => {
      log.info('IPC: config:save received');

      // SEC-014: Validate incoming config data
      const validation = safeValidateConfigUpdate(configInput);
      if (!validation.success) {
        log.error('Config validation failed', {
          errors: validation.error.issues.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
        return {
          success: false,
          error:
            'Invalid configuration data: ' +
            validation.error.issues.map((e) => e.message).join(', '),
        };
      }

      try {
        configService.saveConfig(validation.data);

        // Restart file watcher with new config
        fileWatcher?.stop();
        startFileWatcher();

        log.info('Config saved successfully');
        return { success: true };
      } catch (error) {
        log.error('Failed to save config', {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save configuration',
        };
      }
    });

    // Test connection - SEC-014: Validate input
    ipcMain.handle(
      'config:test-connection',
      async (_event: IpcMainInvokeEvent, configInput: unknown) => {
        log.info('IPC: config:test-connection received');

        // SEC-014: Validate incoming config data
        const validation = safeValidateConfig(configInput);
        if (!validation.success) {
          log.warn('Test connection config validation failed', {
            errors: validation.error.issues,
          });
          return {
            success: false,
            message:
              'Invalid configuration: ' + validation.error.issues.map((e) => e.message).join(', '),
          };
        }

        try {
          const testSync = new SyncService(validation.data);
          const result = await testSync.testConnection();
          log.info('Test connection completed', { success: result.success });
          return result;
        } catch (error) {
          log.error('Test connection failed', {
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            success: false,
            message: error instanceof Error ? error.message : 'Connection test failed',
          };
        }
      }
    );

    // Get sync stats
    ipcMain.handle('sync:get-stats', (_event: IpcMainInvokeEvent) => {
      return (
        fileWatcher?.getStats() ?? {
          filesProcessed: 0,
          filesErrored: 0,
          lastSyncTime: null,
          isWatching: false,
        }
      );
    });

    // Get recent files
    ipcMain.handle('sync:get-recent-files', (_event: IpcMainInvokeEvent) => {
      return fileWatcher?.getRecentFiles() ?? [];
    });

    // Manual sync trigger
    ipcMain.handle('sync:trigger', async (_event: IpcMainInvokeEvent) => {
      log.info('IPC: sync:trigger received');

      if (!fileWatcher) {
        log.warn('Sync trigger failed: file watcher not running');
        return { success: false, error: 'File watcher not running' };
      }

      try {
        await fileWatcher.processExistingFiles();
        log.info('Manual sync completed');
        return { success: true };
      } catch (error) {
        log.error('Manual sync failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Sync failed',
        };
      }
    });

    // Pause/resume sync
    ipcMain.handle('sync:toggle-pause', (_event: IpcMainInvokeEvent) => {
      if (fileWatcher?.isWatching()) {
        fileWatcher.stop();
        log.info('Sync paused');
        return { paused: true };
      } else {
        startFileWatcher();
        log.info('Sync resumed');
        return { paused: false };
      }
    });

    log.info('IPC handlers registered');
  };

  // App lifecycle
  app.whenReady().then(async () => {
    log.info('Application ready');

    // ========================================================================
    // Step 1: Bootstrap Database (DB-005, DB-007)
    // CRITICAL: Database must be initialized BEFORE IPC handlers that use DALs
    // ========================================================================
    log.info('Bootstrapping database...');
    try {
      databaseBootstrapResult = await bootstrapDatabase({
        timeoutMs: 30000, // 30 second timeout
        skipBackup: false, // Always backup before migrations (DB-005)
      });

      if (databaseBootstrapResult.success) {
        log.info('Database bootstrap completed successfully', {
          correlationId: databaseBootstrapResult.correlationId,
          state: databaseBootstrapResult.state,
          migrationsApplied: databaseBootstrapResult.migrations?.applied.length ?? 0,
          durationMs: databaseBootstrapResult.durationMs,
        });

        // Sync store from config to database if needed
        // This handles the case where setup completed but store wasn't saved to DB
        const storeSynced = settingsService.syncStoreToDatabase();
        if (storeSynced) {
          log.info('Store synced from config to database after bootstrap');
        }

        // Sync initial manager from config to database if needed
        // This handles the case where API key validation provided an initial manager
        // but database wasn't ready during setup
        const managerSynced = settingsService.syncInitialManagerToDatabase();
        if (managerSynced) {
          log.info('Initial manager synced from config to database after bootstrap');
        }
      } else {
        log.error('Database bootstrap failed', {
          correlationId: databaseBootstrapResult.correlationId,
          state: databaseBootstrapResult.state,
          error: databaseBootstrapResult.error,
          durationMs: databaseBootstrapResult.durationMs,
        });
        // Continue with degraded mode - UI will show error state
      }
    } catch (error) {
      log.error('Database bootstrap threw unexpected error', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue with degraded mode
    }

    // ========================================================================
    // Step 2: Setup IPC Handlers
    // ========================================================================
    setupIpcHandlers();

    // Add database status IPC handler
    ipcMain.handle('database:status', () => {
      return {
        ready: isDatabaseReady(),
        state: getDatabaseState(),
        bootstrapResult: databaseBootstrapResult
          ? {
              success: databaseBootstrapResult.success,
              correlationId: databaseBootstrapResult.correlationId,
              state: databaseBootstrapResult.state,
              error: databaseBootstrapResult.error,
              durationMs: databaseBootstrapResult.durationMs,
            }
          : null,
        health: isDatabaseReady() ? performHealthCheck() : null,
      };
    });

    // ========================================================================
    // Step 3: Initialize IPC handlers
    // These must be registered regardless of database state so setup wizard works
    // Individual handlers that require database will check isDatabaseReady()
    // ========================================================================
    try {
      await initializeIPC();
      log.info('IPC handlers initialized', { databaseReady: isDatabaseReady() });
    } catch (error) {
      log.error('Failed to initialize IPC handlers', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // ========================================================================
    // Step 4: Create UI
    // ========================================================================
    createWindow();
    createTray();

    // ========================================================================
    // Step 5: License Enforcement Setup
    // Subscribe to license status changes and forward to renderer
    // ========================================================================
    licenseService.onStatusChange((state) => {
      if (mainWindow) {
        mainWindow.webContents.send('license:statusChanged', state);
        log.debug('License status change forwarded to renderer', {
          valid: state.valid,
          status: state.status,
        });
      }
    });

    // Perform startup license check if API is configured
    const startupConfig = configService.getConfig();
    if (startupConfig.isConfigured && startupConfig.apiUrl && startupConfig.apiKey) {
      try {
        log.info('Performing startup license check...');
        await cloudApiService.checkLicense();
        log.info('Startup license check completed');
      } catch (error) {
        log.warn('Startup license check failed - using cached license data', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with cached license data - cloudApiService handles the fallback
      }
    } else {
      log.info('Skipping startup license check: API not configured');
    }

    // Initialize auto-updater service (production only)
    if (process.env.NODE_ENV !== 'development') {
      try {
        // Dynamic import to avoid app initialization issues with electron-updater
        const { getAutoUpdaterService } = await import('./services/auto-updater.service');
        autoUpdaterService = getAutoUpdaterService();
        if (mainWindow) {
          autoUpdaterService.setMainWindow(mainWindow);
        }
        autoUpdaterService.startPeriodicCheck();
        log.info('Auto-updater service initialized');
      } catch (error) {
        log.error('Failed to initialize auto-updater', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      log.info('Auto-updater disabled in development mode');
    }

    // Start file watcher if configured
    const config = configService.getConfig();
    if (config.isConfigured && config.watchPath && config.apiUrl && config.apiKey) {
      startFileWatcher();
    } else {
      log.info('Skipping file watcher start: not fully configured');
    }

    // ========================================================================
    // Step 6: Start User Sync (if configured)
    // Syncs users from cloud on startup and periodically
    // ========================================================================
    if (config.isConfigured && config.apiUrl && config.apiKey && isDatabaseReady()) {
      startUserSync();
    } else {
      log.info('Skipping user sync start: not fully configured or database not ready');
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('second-instance', () => {
    log.info('Second instance attempted, focusing existing window');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      log.info('All windows closed, quitting');
      app.quit();
    }
  });

  app.on('before-quit', () => {
    log.info('Application quitting');
    fileWatcher?.stop();
    stopUserSync();
    autoUpdaterService?.destroy();
    // Gracefully shutdown database (checkpoint WAL, close connections)
    shutdownDatabase();
  });
}
