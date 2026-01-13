/**
 * Auto-Updater Service
 *
 * Enterprise-grade auto-update service for Electron application.
 * Handles update checking, downloading, and installation with secure IPC.
 *
 * @module main/services/auto-updater
 * @security SEC-014: IPC input validation, API-003: Error handling, LM-001: Structured logging
 */

import { autoUpdater, UpdateInfo, ProgressInfo, UpdateCheckResult } from 'electron-updater';
import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types and Schemas
// ============================================================================

/**
 * Update status sent to renderer
 */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

/**
 * Update status event payload
 */
export interface UpdateStatusEvent {
  status: UpdateStatus;
  version?: string;
  releaseDate?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  errorMessage?: string;
}

/**
 * IPC response types - API-003: Consistent error schema
 */
export interface UpdateCheckResponse {
  success: boolean;
  updateAvailable: boolean;
  version?: string;
  releaseDate?: string;
  error?: string;
}

export interface UpdateActionResponse {
  success: boolean;
  error?: string;
}

/**
 * Schema for version strings - SEC-014: Input validation
 */
const VersionSchema = z.string().regex(/^\d+\.\d+\.\d+/, 'Invalid version format');

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('auto-updater');

// ============================================================================
// AutoUpdaterService Class
// ============================================================================

/**
 * AutoUpdaterService - Manages application auto-updates
 *
 * Features:
 * - Secure IPC handlers with input validation
 * - Structured logging with secret redaction
 * - Enterprise error handling (no stack traces to renderer)
 * - Periodic update checks
 * - User-initiated update download
 */
export class AutoUpdaterService {
  private mainWindow: BrowserWindow | null = null;
  private updateAvailable = false;
  private currentVersion: string | null = null;
  private currentUpdateInfo: UpdateInfo | null = null;
  private isDownloading = false;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.configureAutoUpdater();
    this.setupEventHandlers();
    this.setupIPCHandlers();
    log.info('AutoUpdaterService initialized');
  }

  /**
   * Configure auto-updater settings
   */
  private configureAutoUpdater(): void {
    // Disable automatic download - user must initiate
    autoUpdater.autoDownload = false;

    // Enable auto-install on app quit
    autoUpdater.autoInstallOnAppQuit = true;

    // Allow pre-releases if configured
    autoUpdater.allowPrerelease = process.env.ALLOW_PRERELEASE === 'true';

    // Allow downgrade (useful for testing)
    autoUpdater.allowDowngrade = false;

    // Disable differential download for reliability
    autoUpdater.disableDifferentialDownload = false;

    log.debug('Auto-updater configured', {
      autoDownload: autoUpdater.autoDownload,
      autoInstallOnAppQuit: autoUpdater.autoInstallOnAppQuit,
      allowPrerelease: autoUpdater.allowPrerelease,
    });
  }

  /**
   * Set the main window reference for IPC events
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
    log.debug('Main window reference set');
  }

  /**
   * Setup auto-updater event handlers
   * LM-001: All events logged with structured format
   */
  private setupEventHandlers(): void {
    autoUpdater.on('checking-for-update', () => {
      log.info('Checking for updates');
      this.sendStatusToWindow({ status: 'checking' });
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.updateAvailable = true;
      this.currentUpdateInfo = info;
      this.currentVersion = info.version;

      log.info('Update available', {
        version: info.version,
        releaseDate: info.releaseDate,
      });

      this.sendStatusToWindow({
        status: 'available',
        version: info.version,
        releaseDate: info.releaseDate,
      });
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.updateAvailable = false;
      this.currentUpdateInfo = info;

      log.info('No update available', {
        currentVersion: info.version,
      });

      this.sendStatusToWindow({
        status: 'not-available',
        version: info.version,
      });
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.isDownloading = true;

      log.debug('Download progress', {
        percent: progress.percent.toFixed(1),
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });

      this.sendStatusToWindow({
        status: 'downloading',
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.isDownloading = false;

      log.info('Update downloaded', {
        version: info.version,
        releaseDate: info.releaseDate,
      });

      this.sendStatusToWindow({
        status: 'downloaded',
        version: info.version,
        releaseDate: info.releaseDate,
      });
    });

    autoUpdater.on('error', (err: Error) => {
      this.isDownloading = false;

      // LM-001: Log full error server-side, send sanitized message to client
      log.error('Auto-updater error', {
        error: err.message,
        stack: err.stack,
      });

      // API-003: Return generic error message, no stack traces
      this.sendStatusToWindow({
        status: 'error',
        errorMessage: this.sanitizeErrorMessage(err.message),
      });
    });
  }

  /**
   * Setup IPC handlers for renderer communication
   * SEC-014: All handlers validate input and use allowlisted channels
   */
  private setupIPCHandlers(): void {
    // Check for updates
    ipcMain.handle(
      'updater:check',
      async (_event: IpcMainInvokeEvent): Promise<UpdateCheckResponse> => {
        log.info('IPC: updater:check received');

        try {
          const result: UpdateCheckResult | null = await autoUpdater.checkForUpdates();

          if (!result) {
            return {
              success: true,
              updateAvailable: false,
            };
          }

          return {
            success: true,
            updateAvailable: this.updateAvailable,
            version: result.updateInfo?.version,
            releaseDate: result.updateInfo?.releaseDate,
          };
        } catch (error) {
          // API-003: Log error server-side, return sanitized response
          log.error('Update check failed', {
            error: error instanceof Error ? error.message : String(error),
          });

          return {
            success: false,
            updateAvailable: false,
            error: 'Failed to check for updates. Please try again later.',
          };
        }
      }
    );

    // Download update
    ipcMain.handle(
      'updater:download',
      async (_event: IpcMainInvokeEvent): Promise<UpdateActionResponse> => {
        log.info('IPC: updater:download received');

        if (!this.updateAvailable) {
          log.warn('Download requested but no update available');
          return {
            success: false,
            error: 'No update available to download.',
          };
        }

        if (this.isDownloading) {
          log.warn('Download requested but already in progress');
          return {
            success: false,
            error: 'Download already in progress.',
          };
        }

        try {
          await autoUpdater.downloadUpdate();
          return { success: true };
        } catch (error) {
          log.error('Download failed', {
            error: error instanceof Error ? error.message : String(error),
          });

          return {
            success: false,
            error: 'Failed to download update. Please try again later.',
          };
        }
      }
    );

    // Install update (quit and install)
    ipcMain.handle(
      'updater:install',
      async (_event: IpcMainInvokeEvent): Promise<UpdateActionResponse> => {
        log.info('IPC: updater:install received');

        try {
          // isSilent: false = show installer UI
          // isForceRunAfter: true = restart app after install
          setImmediate(() => {
            autoUpdater.quitAndInstall(false, true);
          });

          return { success: true };
        } catch (error) {
          log.error('Install failed', {
            error: error instanceof Error ? error.message : String(error),
          });

          return {
            success: false,
            error: 'Failed to install update. Please restart the application manually.',
          };
        }
      }
    );

    // Get current update status
    ipcMain.handle(
      'updater:status',
      async (_event: IpcMainInvokeEvent): Promise<UpdateStatusEvent> => {
        return {
          status: this.isDownloading
            ? 'downloading'
            : this.updateAvailable
              ? 'available'
              : 'idle',
          version: this.currentVersion ?? undefined,
        };
      }
    );

    log.info('IPC handlers registered for auto-updater');
  }

  /**
   * Send status update to renderer window
   * SEC-014: Only send safe data to renderer
   */
  private sendStatusToWindow(event: UpdateStatusEvent): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('updater:status', event);
    }
  }

  /**
   * Sanitize error messages for client display
   * API-003: Never leak internal details
   */
  private sanitizeErrorMessage(message: string): string {
    // Map known error patterns to user-friendly messages
    const errorMappings: Array<{ pattern: RegExp; message: string }> = [
      { pattern: /ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i, message: 'Network connection error' },
      { pattern: /CERT|SSL|TLS/i, message: 'Secure connection error' },
      { pattern: /404|Not Found/i, message: 'Update server unavailable' },
      { pattern: /ENOSPC/i, message: 'Insufficient disk space' },
      { pattern: /EACCES|EPERM/i, message: 'Permission denied' },
      { pattern: /checksum|hash|integrity/i, message: 'Download verification failed' },
    ];

    for (const { pattern, message: friendlyMessage } of errorMappings) {
      if (pattern.test(message)) {
        return friendlyMessage;
      }
    }

    // Default generic message
    return 'An error occurred during the update process';
  }

  /**
   * Check for updates immediately
   */
  async checkForUpdates(): Promise<void> {
    try {
      log.info('Manual update check initiated');
      await autoUpdater.checkForUpdates();
    } catch (error) {
      log.error('Manual update check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Start periodic update checks
   * @param intervalMs - Interval between checks (default: 4 hours)
   */
  startPeriodicCheck(intervalMs = 4 * 60 * 60 * 1000): void {
    // Clear any existing interval
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    // Initial check after 10 seconds (let app fully initialize)
    setTimeout(() => {
      this.checkForUpdates();
    }, 10000);

    // Periodic checks
    this.checkInterval = setInterval(() => {
      this.checkForUpdates();
    }, intervalMs);

    log.info('Periodic update checks started', {
      intervalHours: intervalMs / (60 * 60 * 1000),
    });
  }

  /**
   * Stop periodic update checks
   */
  stopPeriodicCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      log.info('Periodic update checks stopped');
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopPeriodicCheck();
    this.mainWindow = null;
    log.info('AutoUpdaterService destroyed');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance of AutoUpdaterService
 * Lazily initialized to avoid issues with app lifecycle
 */
let autoUpdaterServiceInstance: AutoUpdaterService | null = null;

/**
 * Get or create the AutoUpdaterService singleton
 */
export function getAutoUpdaterService(): AutoUpdaterService {
  if (!autoUpdaterServiceInstance) {
    autoUpdaterServiceInstance = new AutoUpdaterService();
  }
  return autoUpdaterServiceInstance;
}

export { autoUpdaterServiceInstance };
