/**
 * Nuvana Sync - Electron Main Process
 *
 * Entry point for the desktop application.
 * Handles window management, system tray, and IPC communication.
 *
 * @module main
 * @security SEC-014: IPC input validation, LM-001: Structured logging
 */

import {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  IpcMainInvokeEvent,
} from "electron";
import { join } from "path";
import { FileWatcherService } from "./services/file-watcher.service";
import { ConfigService } from "./services/config.service";
import { SyncService } from "./services/sync.service";
import { createLogger } from "./utils/logger";
import {
  type NuvanaSyncConfig,
  safeValidateConfigUpdate,
  safeValidateConfig,
} from "../shared/types/config.types";

const log = createLogger("main");

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  log.warn("Another instance is running, quitting");
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let fileWatcher: FileWatcherService | null = null;
  let configService: ConfigService;
  let syncService: SyncService | null = null;

  // Initialize services
  configService = new ConfigService();
  log.info("Application starting");

  function createWindow(): void {
    log.info("Creating main window");

    mainWindow = new BrowserWindow({
      width: 900,
      height: 670,
      minWidth: 800,
      minHeight: 600,
      show: false,
      autoHideMenuBar: true,
      title: "Nuvana Sync",
      webPreferences: {
        preload: join(__dirname, "../preload/index.mjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    mainWindow.on("ready-to-show", () => {
      mainWindow?.show();
      log.info("Main window ready");
    });

    // Minimize to tray instead of closing
    mainWindow.on("close", (event) => {
      const config = configService.getConfig();
      if (config.minimizeToTray && !(app as { isQuitting?: boolean }).isQuitting) {
        event.preventDefault();
        mainWindow?.hide();
        log.debug("Window hidden to tray");
      }
    });

    // Load the renderer
    if (process.env.NODE_ENV === "development") {
      mainWindow.loadURL("http://localhost:5173");
      mainWindow.webContents.openDevTools();
      log.info("Loaded development server");
    } else {
      mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
      log.info("Loaded production build");
    }
  }

  function createTray(): void {
    log.info("Creating system tray");

    // Create tray icon (use a placeholder for now)
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Open Nuvana Sync",
        click: () => {
          mainWindow?.show();
        },
      },
      {
        label: "Pause Sync",
        type: "checkbox",
        checked: false,
        click: (menuItem) => {
          if (menuItem.checked) {
            fileWatcher?.stop();
            log.info("Sync paused from tray");
          } else {
            startFileWatcher();
            log.info("Sync resumed from tray");
          }
        },
      },
      { type: "separator" },
      {
        label: "Settings",
        click: () => {
          mainWindow?.show();
          mainWindow?.webContents.send("navigate", "/settings");
        },
      },
      { type: "separator" },
      {
        label: "Exit",
        click: () => {
          (app as { isQuitting?: boolean }).isQuitting = true;
          app.quit();
        },
      },
    ]);

    tray.setToolTip("Nuvana Sync");
    tray.setContextMenu(contextMenu);

    tray.on("double-click", () => {
      mainWindow?.show();
    });
  }

  function startFileWatcher(): void {
    const config = configService.getConfig();

    if (!config.watchPath || !config.apiUrl || !config.apiKey) {
      log.warn("File watcher not started: missing configuration", {
        hasWatchPath: Boolean(config.watchPath),
        hasApiUrl: Boolean(config.apiUrl),
        hasApiKey: Boolean(config.apiKey),
      });
      return;
    }

    log.info("Starting file watcher", { watchPath: config.watchPath });

    syncService = new SyncService(config);
    fileWatcher = new FileWatcherService(config, syncService);

    fileWatcher.on("file-detected", (filePath: string) => {
      mainWindow?.webContents.send("sync-status", {
        type: "file-detected",
        filePath,
      });
    });

    fileWatcher.on("file-processed", (data: { filePath: string; success: boolean }) => {
      mainWindow?.webContents.send("sync-status", {
        type: "file-processed",
        ...data,
      });
    });

    fileWatcher.on("file-error", (data: { filePath: string; error: string }) => {
      mainWindow?.webContents.send("sync-status", {
        type: "file-error",
        ...data,
      });
    });

    fileWatcher.start();
  }

  /**
   * SEC-014: Validate IPC input before processing
   */
  function setupIpcHandlers(): void {
    log.info("Setting up IPC handlers");

    // Get current config
    ipcMain.handle("config:get", (_event: IpcMainInvokeEvent) => {
      const config = configService.getConfig();
      return {
        isConfigured: config.isConfigured,
        config,
      };
    });

    // Save config - SEC-014: Validate input
    ipcMain.handle("config:save", (_event: IpcMainInvokeEvent, configInput: unknown) => {
      log.info("IPC: config:save received");

      // SEC-014: Validate incoming config data
      const validation = safeValidateConfigUpdate(configInput);
      if (!validation.success) {
        log.error("Config validation failed", {
          errors: validation.error.issues.map((e) => ({
            path: e.path.join("."),
            message: e.message,
          })),
        });
        return {
          success: false,
          error: "Invalid configuration data: " +
            validation.error.issues.map((e) => e.message).join(", "),
        };
      }

      try {
        configService.saveConfig(validation.data);

        // Restart file watcher with new config
        fileWatcher?.stop();
        startFileWatcher();

        log.info("Config saved successfully");
        return { success: true };
      } catch (error) {
        log.error("Failed to save config", {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to save configuration",
        };
      }
    });

    // Test connection - SEC-014: Validate input
    ipcMain.handle(
      "config:test-connection",
      async (_event: IpcMainInvokeEvent, configInput: unknown) => {
        log.info("IPC: config:test-connection received");

        // SEC-014: Validate incoming config data
        const validation = safeValidateConfig(configInput);
        if (!validation.success) {
          log.warn("Test connection config validation failed", {
            errors: validation.error.issues,
          });
          return {
            success: false,
            message: "Invalid configuration: " +
              validation.error.issues.map((e) => e.message).join(", "),
          };
        }

        try {
          const testSync = new SyncService(validation.data);
          const result = await testSync.testConnection();
          log.info("Test connection completed", { success: result.success });
          return result;
        } catch (error) {
          log.error("Test connection failed", {
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            success: false,
            message: error instanceof Error ? error.message : "Connection test failed",
          };
        }
      }
    );

    // Get sync stats
    ipcMain.handle("sync:get-stats", (_event: IpcMainInvokeEvent) => {
      return fileWatcher?.getStats() ?? {
        filesProcessed: 0,
        filesErrored: 0,
        lastSyncTime: null,
        isWatching: false,
      };
    });

    // Get recent files
    ipcMain.handle("sync:get-recent-files", (_event: IpcMainInvokeEvent) => {
      return fileWatcher?.getRecentFiles() ?? [];
    });

    // Manual sync trigger
    ipcMain.handle("sync:trigger", async (_event: IpcMainInvokeEvent) => {
      log.info("IPC: sync:trigger received");

      if (!fileWatcher) {
        log.warn("Sync trigger failed: file watcher not running");
        return { success: false, error: "File watcher not running" };
      }

      try {
        await fileWatcher.processExistingFiles();
        log.info("Manual sync completed");
        return { success: true };
      } catch (error) {
        log.error("Manual sync failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Sync failed",
        };
      }
    });

    // Pause/resume sync
    ipcMain.handle("sync:toggle-pause", (_event: IpcMainInvokeEvent) => {
      if (fileWatcher?.isWatching()) {
        fileWatcher.stop();
        log.info("Sync paused");
        return { paused: true };
      } else {
        startFileWatcher();
        log.info("Sync resumed");
        return { paused: false };
      }
    });

    log.info("IPC handlers registered");
  }

  // App lifecycle
  app.whenReady().then(() => {
    log.info("Application ready");
    setupIpcHandlers();
    createWindow();
    createTray();

    // Start file watcher if configured
    const config = configService.getConfig();
    if (config.isConfigured && config.watchPath && config.apiUrl && config.apiKey) {
      startFileWatcher();
    } else {
      log.info("Skipping file watcher start: not fully configured");
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("second-instance", () => {
    log.info("Second instance attempted, focusing existing window");
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      log.info("All windows closed, quitting");
      app.quit();
    }
  });

  app.on("before-quit", () => {
    log.info("Application quitting");
    fileWatcher?.stop();
  });
}
