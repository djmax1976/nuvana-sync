/**
 * Settings Service
 *
 * Manages application settings with separation between:
 * - Cloud settings (read-only, from API validation)
 * - Local settings (editable by MANAGER role)
 * - Lottery settings (bi-directional sync)
 *
 * @module main/services/settings
 * @security SEC-007: API keys encrypted via safeStorage
 * @security SEC-014: Input validation with Zod schemas
 * @security API-003: Centralized error handling
 * @security LM-001: Structured logging with secret redaction
 */

import { safeStorage } from 'electron';
import Store from 'electron-store';
import { z } from 'zod';
import { storesDAL } from '../dal/stores.dal';
import { usersDAL } from '../dal/users.dal';
import { cloudApiService, ValidateApiKeyResponse, type InitialManager } from './cloud-api.service';
import { createLogger } from '../utils/logger';
import path from 'path';
import fs from 'fs';
// ConfigService has been consolidated into SettingsService - this is now the single source of truth

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('settings-service');

// ============================================================================
// Validation Schemas (SEC-014: Input Validation)
// ============================================================================

/**
 * API Key validation schema
 * SEC-014: Pattern validation for store sync keys
 * Supports formats:
 * - nuvpos_sk_str_<id>_<secret> (production format)
 * - nsk_live_<chars> or nsk_test_<chars> (legacy format)
 */
const ApiKeySchema = z
  .string()
  .min(1, 'API key is required')
  .max(500, 'API key too long')
  .regex(
    /^(nuvpos_sk_str_[a-z0-9]+_[A-Za-z0-9]+|nsk_(live|test)_[a-zA-Z0-9]{20,})$/,
    'API key must be a valid Nuvana Store Sync Key'
  );

/**
 * Watch folder path validation schema
 * SEC-014: Path traversal prevention
 */
const WatchFolderSchema = z
  .string()
  .min(1, 'Watch folder path is required')
  .max(500, 'Path too long')
  .refine((p) => !p.includes('..'), 'Path cannot contain parent directory references (..)')
  .refine((p) => path.isAbsolute(p), 'Path must be absolute');

/**
 * Sync interval validation schema
 * SEC-014: Bounded numeric input
 */
const SyncIntervalSchema = z
  .number()
  .int('Sync interval must be an integer')
  .min(30, 'Sync interval must be at least 30 seconds')
  .max(3600, 'Sync interval cannot exceed 3600 seconds (1 hour)');

/**
 * Business day cutoff time validation schema
 * SEC-014: Strict time format validation (HH:MM in 24-hour format)
 *
 * This setting determines when overnight shifts are assigned to the previous business day.
 * Any shift that closes BEFORE this time will be assigned to yesterday's date.
 *
 * Example: If set to "06:00", a shift closing at 3:00 AM belongs to yesterday's business day.
 * Default: "06:00" (6:00 AM) - standard convenience store overnight cutoff
 *
 * Valid range: "00:00" to "23:59"
 */
const BusinessDayCutoffTimeSchema = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):([0-5]\d)$/,
    'Cutoff time must be in HH:MM format (24-hour, e.g., "06:00")'
  )
  .refine((time) => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
  }, 'Cutoff time must be a valid time between 00:00 and 23:59');

/**
 * Local settings update schema
 */
const LocalSettingsUpdateSchema = z
  .object({
    xmlWatchFolder: WatchFolderSchema.optional(),
    syncIntervalSeconds: SyncIntervalSchema.optional(),
    businessDayCutoffTime: BusinessDayCutoffTimeSchema.optional(),
  })
  .strict();

/**
 * Cloud endpoint validation schema
 * SEC-008: HTTPS enforcement
 */
const CloudEndpointSchema = z
  .string()
  .url('Invalid URL format')
  .refine((url) => url.startsWith('https://'), 'Cloud endpoint must use HTTPS');

// ============================================================================
// Types
// ============================================================================

/**
 * Complete application settings
 */
export interface AppSettings {
  // From cloud (read-only after setup)
  storeId: string;
  storeName: string;
  companyId: string;
  companyName: string;
  timezone: string;
  features: string[];

  // Local (editable by MANAGER)
  xmlWatchFolder: string;
  syncIntervalSeconds: number;
  /**
   * Business day cutoff time in HH:MM 24-hour format.
   * Shifts closing BEFORE this time are assigned to the previous business day.
   * Default: "06:00" (6:00 AM)
   */
  businessDayCutoffTime: string;

  // Lottery (bi-directional)
  lottery: {
    enabled: boolean;
    binCount: number;
  };

  // Setup status
  setupCompletedAt: string | null;
}

/**
 * Local settings update data
 */
export interface LocalSettingsUpdate {
  xmlWatchFolder?: string;
  syncIntervalSeconds?: number;
  /**
   * Business day cutoff time in HH:MM 24-hour format.
   * Shifts closing BEFORE this time are assigned to the previous business day.
   */
  businessDayCutoffTime?: string;
}

/**
 * API key validation result
 */
export interface ApiKeyValidationResult {
  valid: boolean;
  store?: ValidateApiKeyResponse;
  error?: string;
}

/**
 * Folder validation result
 */
export interface FolderValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Settings store schema for type safety
 * UNIFIED SCHEMA: All app config in one place (nuvana.json)
 */
interface SettingsStoreSchema {
  // ========== API Connection ==========
  /** API URL (e.g., https://api.nuvanaapp.com) */
  apiUrl?: string;
  /** Encrypted API key bytes */
  encryptedApiKey?: number[];

  // ========== Store Info (from cloud validation) ==========
  storeId?: string;
  storeName?: string;
  storePublicId?: string;
  companyId?: string;
  companyName?: string;
  timezone?: string;
  stateCode?: string;
  features?: string[];

  // ========== Offline Capabilities ==========
  offlinePermissions?: string[];
  encryptedOfflineToken?: number[];
  offlineTokenExpiresAt?: string;

  // ========== Initial Manager (from API key validation) ==========
  'initialManager.userId'?: string;
  'initialManager.name'?: string;
  'initialManager.role'?: string;
  'initialManager.pinHash'?: string;

  // ========== Lottery ==========
  'lottery.enabled'?: boolean;
  'lottery.binCount'?: number;

  // ========== File Watcher ==========
  /** Path to watch for XML files */
  watchPath?: string;
  /** Path to archive processed files */
  archivePath?: string;
  /** Path to move failed files */
  errorPath?: string;
  /** Poll interval in seconds for file watcher */
  pollInterval?: number;
  /** Which file types to process */
  enabledFileTypes?: {
    pjr: boolean;
    fgm: boolean;
    msm: boolean;
    fpm: boolean;
    mcm: boolean;
    tlm: boolean;
  };

  // ========== Sync Settings ==========
  /** Sync interval in seconds */
  syncIntervalSeconds?: number;
  /** Business day cutoff time in HH:MM 24-hour format */
  businessDayCutoffTime?: string;

  // ========== App Behavior ==========
  /** Start app on login */
  startOnLogin?: boolean;
  /** Minimize to tray instead of closing */
  minimizeToTray?: boolean;
  /** Show desktop notifications */
  showNotifications?: boolean;
  /** Process files in order */
  processInOrder?: boolean;

  // ========== Setup State ==========
  /** Timestamp when setup was completed */
  setupCompletedAt?: string;
  /** Whether app is fully configured */
  isConfigured?: boolean;

  // ========== Legacy (deprecated, kept for migration) ==========
  /** @deprecated Use watchPath instead */
  xmlWatchFolder?: string;
  /** @deprecated Use apiUrl instead */
  cloudEndpoint?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Default sync interval in seconds */
const DEFAULT_SYNC_INTERVAL = 60;

/** Default poll interval for file watcher in seconds */
const DEFAULT_POLL_INTERVAL = 5;

/**
 * Default API URL
 * - Development: localhost for testing
 * - Production: Nuvana cloud API
 */
const DEFAULT_API_URL =
  process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : 'https://api.nuvanaapp.com';

/** @deprecated Use DEFAULT_API_URL instead */
const DEFAULT_CLOUD_ENDPOINT = DEFAULT_API_URL;

/** Default enabled file types */
const DEFAULT_ENABLED_FILE_TYPES = {
  pjr: true,
  fgm: true,
  msm: true,
  fpm: true,
  mcm: false,
  tlm: false,
};

/**
 * Default business day cutoff time (6:00 AM)
 *
 * Any shift that closes BEFORE this time will be assigned to yesterday's business day.
 * This is the standard convention for convenience stores and gas stations where
 * overnight shifts may close after midnight but belong to the previous day's business.
 *
 * Examples with default "06:00":
 * - Shift closing at 3:00 AM → belongs to yesterday's business day
 * - Shift closing at 7:00 AM → belongs to today's business day
 */
const DEFAULT_BUSINESS_DAY_CUTOFF_TIME = '06:00';

// ============================================================================
// Settings Service
// ============================================================================

/**
 * Settings Service
 *
 * Manages application configuration with:
 * - Cloud settings (read-only, from API key validation)
 * - Local settings (editable by MANAGER)
 * - Secure API key storage (encrypted via safeStorage)
 *
 * @security SEC-007: API key encrypted before storage
 * @security SEC-014: All inputs validated via Zod schemas
 * @security LM-001: Structured logging with secret redaction
 */
export class SettingsService {
  private readonly configStore: Store<SettingsStoreSchema>;

  constructor() {
    this.configStore = new Store<SettingsStoreSchema>({
      name: 'nuvana',
      // SEC-007: Config store uses secure defaults
      clearInvalidConfig: false,
    });

    // Run migration from legacy nuvana-config.json
    this.migrateFromLegacyConfig();

    log.info('Settings service initialized');
  }

  // ==========================================================================
  // Migration from Legacy Config
  // ==========================================================================

  /**
   * Migrate settings from legacy nuvana-config.json to unified nuvana.json
   * This ensures existing users don't lose their settings after the consolidation
   */
  private migrateFromLegacyConfig(): void {
    try {
      const legacyStore = new Store({ name: 'nuvana-config' });
      const legacyConfig = legacyStore.store as Record<string, unknown>;

      // Skip if legacy store is empty
      if (!legacyConfig || Object.keys(legacyConfig).length === 0) {
        return;
      }

      // Skip if we've already migrated (check for a marker or if new fields exist)
      if (this.configStore.get('apiUrl')) {
        return;
      }

      let migrated = false;

      // Migrate apiUrl (from legacy apiUrl or cloudEndpoint)
      if (legacyConfig.apiUrl && !this.configStore.get('apiUrl')) {
        this.configStore.set('apiUrl', legacyConfig.apiUrl as string);
        migrated = true;
      }

      // Migrate watchPath
      if (legacyConfig.watchPath && !this.configStore.get('watchPath')) {
        this.configStore.set('watchPath', legacyConfig.watchPath as string);
        migrated = true;
      }

      // Migrate archivePath
      if (legacyConfig.archivePath && !this.configStore.get('archivePath')) {
        this.configStore.set('archivePath', legacyConfig.archivePath as string);
        migrated = true;
      }

      // Migrate errorPath
      if (legacyConfig.errorPath && !this.configStore.get('errorPath')) {
        this.configStore.set('errorPath', legacyConfig.errorPath as string);
        migrated = true;
      }

      // Migrate pollInterval
      if (legacyConfig.pollInterval && !this.configStore.get('pollInterval')) {
        this.configStore.set('pollInterval', legacyConfig.pollInterval as number);
        migrated = true;
      }

      // Migrate enabledFileTypes
      if (legacyConfig.enabledFileTypes && !this.configStore.get('enabledFileTypes')) {
        this.configStore.set(
          'enabledFileTypes',
          legacyConfig.enabledFileTypes as SettingsStoreSchema['enabledFileTypes']
        );
        migrated = true;
      }

      // Migrate app behavior settings
      if (
        legacyConfig.startOnLogin !== undefined &&
        this.configStore.get('startOnLogin') === undefined
      ) {
        this.configStore.set('startOnLogin', legacyConfig.startOnLogin as boolean);
        migrated = true;
      }

      if (
        legacyConfig.minimizeToTray !== undefined &&
        this.configStore.get('minimizeToTray') === undefined
      ) {
        this.configStore.set('minimizeToTray', legacyConfig.minimizeToTray as boolean);
        migrated = true;
      }

      if (
        legacyConfig.showNotifications !== undefined &&
        this.configStore.get('showNotifications') === undefined
      ) {
        this.configStore.set('showNotifications', legacyConfig.showNotifications as boolean);
        migrated = true;
      }

      if (
        legacyConfig.processInOrder !== undefined &&
        this.configStore.get('processInOrder') === undefined
      ) {
        this.configStore.set('processInOrder', legacyConfig.processInOrder as boolean);
        migrated = true;
      }

      // Migrate isConfigured flag
      if (
        legacyConfig.isConfigured !== undefined &&
        this.configStore.get('isConfigured') === undefined
      ) {
        this.configStore.set('isConfigured', legacyConfig.isConfigured as boolean);
        migrated = true;
      }

      // Migrate storeId if not already present
      if (legacyConfig.storeId && !this.configStore.get('storeId')) {
        this.configStore.set('storeId', legacyConfig.storeId as string);
        migrated = true;
      }

      if (migrated) {
        log.info('Migrated settings from legacy nuvana-config.json to unified nuvana.json');
      }
    } catch (error) {
      // Don't fail on migration errors - just log and continue
      log.warn('Failed to migrate from legacy config', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // ==========================================================================
  // Settings Retrieval
  // ==========================================================================

  /**
   * Get all application settings
   *
   * Combines cloud settings (from store record) with local settings (from config).
   * Returns null if no store is configured or database not ready.
   *
   * @returns Complete settings or null if not configured
   */
  getAll(): AppSettings | null {
    // Check if database is ready before querying
    if (!storesDAL.isDatabaseReady()) {
      log.debug('Database not ready, returning settings from config store only');
      // Return partial settings from config store if available
      const companyName = this.configStore.get('companyName') as string;
      if (!companyName) {
        return null;
      }
      // Return config-only settings (no database store record)
      return {
        storeId: '',
        storeName: '',
        companyId: '',
        companyName,
        timezone: 'America/New_York',
        features: (this.configStore.get('features') as string[]) || [],
        xmlWatchFolder: (this.configStore.get('xmlWatchFolder') as string) || '',
        syncIntervalSeconds:
          (this.configStore.get('syncIntervalSeconds') as number) || DEFAULT_SYNC_INTERVAL,
        businessDayCutoffTime:
          (this.configStore.get('businessDayCutoffTime') as string) ||
          DEFAULT_BUSINESS_DAY_CUTOFF_TIME,
        lottery: {
          enabled: (this.configStore.get('lottery.enabled') as boolean) ?? false,
          binCount: (this.configStore.get('lottery.binCount') as number) || 0,
        },
        setupCompletedAt: (this.configStore.get('setupCompletedAt') as string) || null,
      };
    }

    const store = storesDAL.getConfiguredStore();
    if (!store) {
      log.debug('No store configured, returning null settings');
      return null;
    }

    const settings: AppSettings = {
      // Cloud settings (from store record)
      storeId: store.store_id,
      storeName: store.name,
      companyId: store.company_id,
      companyName: (this.configStore.get('companyName') as string) || '',
      timezone: store.timezone,
      features: (this.configStore.get('features') as string[]) || [],

      // Local settings
      xmlWatchFolder: (this.configStore.get('xmlWatchFolder') as string) || '',
      syncIntervalSeconds:
        (this.configStore.get('syncIntervalSeconds') as number) || DEFAULT_SYNC_INTERVAL,
      businessDayCutoffTime:
        (this.configStore.get('businessDayCutoffTime') as string) ||
        DEFAULT_BUSINESS_DAY_CUTOFF_TIME,

      // Lottery settings
      lottery: {
        enabled: (this.configStore.get('lottery.enabled') as boolean) ?? false,
        binCount: (this.configStore.get('lottery.binCount') as number) || 0,
      },

      // Setup status
      setupCompletedAt: (this.configStore.get('setupCompletedAt') as string) || null,
    };

    log.debug('Settings retrieved', { storeId: store.store_id });
    return settings;
  }

  // ==========================================================================
  // Local Settings Management
  // ==========================================================================

  /**
   * Update local settings
   *
   * Only MANAGER role can call this (enforced by IPC handler).
   * Validates all inputs before storing.
   *
   * @param updates - Settings to update
   * @throws Error if validation fails
   * @security SEC-014: Input validation before storage
   */
  updateLocal(updates: LocalSettingsUpdate): void {
    // SEC-014: Validate input schema
    const validation = LocalSettingsUpdateSchema.safeParse(updates);
    if (!validation.success) {
      const errorMessage = validation.error.issues.map((e) => e.message).join(', ');
      log.warn('Local settings validation failed', { errors: validation.error.issues.length });
      throw new Error(`Invalid settings: ${errorMessage}`);
    }

    const validatedUpdates = validation.data;

    // Process xmlWatchFolder if provided
    if (validatedUpdates.xmlWatchFolder !== undefined) {
      // Additional runtime validation: folder must exist and be accessible
      const folderValidation = this.validateFolder(validatedUpdates.xmlWatchFolder);
      if (!folderValidation.valid) {
        throw new Error(`Invalid watch folder: ${folderValidation.error}`);
      }

      this.configStore.set('xmlWatchFolder', validatedUpdates.xmlWatchFolder);
      log.info('XML watch folder updated', {
        // Don't log full path, just confirmation
        pathLength: validatedUpdates.xmlWatchFolder.length,
      });

      // Sync to legacy nuvana-config for FileWatcher compatibility (during migration period)
      // TODO: Remove this once FileWatcher is fully migrated to read from SettingsService
      try {
        const legacyConfigStore = new Store({ name: 'nuvana-config' });
        legacyConfigStore.set('watchPath', validatedUpdates.xmlWatchFolder);
        log.debug('Synced watchPath to legacy config');
      } catch (syncError) {
        log.warn('Failed to sync watchPath to legacy config', {
          error: syncError instanceof Error ? syncError.message : String(syncError),
        });
      }
    }

    // Process syncIntervalSeconds if provided
    if (validatedUpdates.syncIntervalSeconds !== undefined) {
      this.configStore.set('syncIntervalSeconds', validatedUpdates.syncIntervalSeconds);
      log.info('Sync interval updated', { seconds: validatedUpdates.syncIntervalSeconds });
    }

    // Process businessDayCutoffTime if provided
    // SEC-014: Already validated by Zod schema (HH:MM format, valid time range)
    if (validatedUpdates.businessDayCutoffTime !== undefined) {
      this.configStore.set('businessDayCutoffTime', validatedUpdates.businessDayCutoffTime);
      log.info('Business day cutoff time updated', {
        cutoffTime: validatedUpdates.businessDayCutoffTime,
      });
    }
  }

  /**
   * Validate a folder path
   *
   * Checks:
   * - Path is absolute
   * - No path traversal attempts
   * - Folder exists
   * - Folder is readable
   *
   * @param folderPath - Path to validate
   * @returns Validation result
   * @security SEC-014: Path traversal prevention
   */
  validateFolder(folderPath: string): FolderValidationResult {
    // SEC-014: Schema validation first
    const schemaValidation = WatchFolderSchema.safeParse(folderPath);
    if (!schemaValidation.success) {
      return {
        valid: false,
        error: schemaValidation.error.issues[0]?.message || 'Invalid path format',
      };
    }

    // Normalize and validate no traversal
    const normalizedPath = path.normalize(folderPath);
    if (normalizedPath.includes('..')) {
      log.warn('Path traversal attempt detected', { pathLength: folderPath.length });
      return { valid: false, error: 'Invalid path: contains directory traversal' };
    }

    try {
      // Check existence
      if (!fs.existsSync(normalizedPath)) {
        return { valid: false, error: 'Folder does not exist' };
      }

      // Check if directory
      const stats = fs.statSync(normalizedPath);
      if (!stats.isDirectory()) {
        return { valid: false, error: 'Path is not a directory' };
      }

      // Check read access
      fs.accessSync(normalizedPath, fs.constants.R_OK);

      return { valid: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.warn('Folder validation failed', { error: message });
      return { valid: false, error: `Cannot access folder: ${message}` };
    }
  }

  // ==========================================================================
  // API Key Management
  // ==========================================================================

  /**
   * Validate and save API key
   *
   * Process:
   * 1. Validate key format
   * 2. Encrypt and temporarily store
   * 3. Validate against cloud API
   * 4. On success: persist store info (if database ready)
   * 5. On failure: clear encrypted key
   *
   * @param apiKey - Store Sync Key to validate
   * @returns Validation result with store info on success
   * @security SEC-007: API key encrypted via safeStorage
   * @security SEC-008: HTTPS enforced for validation
   */
  async validateAndSaveApiKey(apiKey: string): Promise<ApiKeyValidationResult> {
    // SEC-014: Validate key format first
    const formatValidation = ApiKeySchema.safeParse(apiKey);
    if (!formatValidation.success) {
      log.warn('API key format validation failed');
      const errorMsg = formatValidation.error.issues?.[0]?.message || 'Invalid API key format';
      return {
        valid: false,
        error: errorMsg,
      };
    }

    // SEC-007: Encrypt API key before storage
    if (!safeStorage.isEncryptionAvailable()) {
      log.error('Safe storage encryption not available');
      return { valid: false, error: 'Secure storage not available on this system' };
    }

    const encryptedKey = safeStorage.encryptString(apiKey);
    // Store as array of bytes (JSON-serializable)
    this.configStore.set('encryptedApiKey', Array.from(encryptedKey));

    try {
      // SEC-008: Validate via HTTPS
      const validation = await cloudApiService.validateApiKey();

      if (!validation.valid) {
        // Clear invalid key
        this.configStore.delete('encryptedApiKey');
        log.warn('API key validation failed: invalid key');
        return { valid: false, error: 'Invalid API key' };
      }

      // Always save store info to config store for restart recovery
      this.configStore.set('storeId', validation.storeId);
      this.configStore.set('storeName', validation.storeName);
      this.configStore.set('storePublicId', validation.storePublicId);
      this.configStore.set('companyId', validation.companyId);
      this.configStore.set('companyName', validation.companyName);
      this.configStore.set('timezone', validation.timezone);
      // Only set stateCode if it has a value (electron-store doesn't allow undefined)
      if (validation.stateCode) {
        this.configStore.set('stateCode', validation.stateCode);
      }

      // Store validated - save store info to database (if ready)
      if (storesDAL.isDatabaseReady()) {
        storesDAL.upsertFromCloud({
          store_id: validation.storeId,
          company_id: validation.companyId,
          name: validation.storeName,
          timezone: validation.timezone,
          status: 'ACTIVE',
        });
        log.info('Store saved to database');
      } else {
        // Database not ready during initial setup - store info will be synced
        // to database when syncStoreToDatabase() is called after bootstrap
        log.info('Database not ready - store info saved to config, will sync after bootstrap');
      }

      // Save additional settings from cloud
      this.configStore.set('features', validation.features);
      this.configStore.set('lottery.enabled', validation.lottery?.enabled || false);
      this.configStore.set('lottery.binCount', validation.lottery?.binCount || 0);

      // SEC-007: Store offline permissions for local authorization checks
      this.configStore.set('offlinePermissions', validation.offlinePermissions || []);
      log.info('Offline permissions stored', {
        count: validation.offlinePermissions?.length || 0,
      });

      // SEC-007: Encrypt and store offline token for offline authentication
      if (validation.offlineToken) {
        if (safeStorage.isEncryptionAvailable()) {
          const encryptedToken = safeStorage.encryptString(validation.offlineToken);
          this.configStore.set('encryptedOfflineToken', Array.from(encryptedToken));
          this.configStore.set('offlineTokenExpiresAt', validation.offlineTokenExpiresAt);
          log.info('Offline token stored (encrypted)', {
            expiresAt: validation.offlineTokenExpiresAt,
          });
        } else {
          log.warn('SafeStorage not available - offline token not stored');
        }
      }

      // Save initial manager if provided (for first login after setup)
      if (validation.initialManager) {
        this.configStore.set('initialManager.userId', validation.initialManager.userId);
        this.configStore.set('initialManager.name', validation.initialManager.name);
        this.configStore.set('initialManager.role', validation.initialManager.role);
        this.configStore.set('initialManager.pinHash', validation.initialManager.pinHash);

        log.info('Initial manager saved to config', {
          userId: validation.initialManager.userId,
          name: validation.initialManager.name,
          role: validation.initialManager.role,
        });

        // If database is ready, sync the initial manager immediately
        if (usersDAL.isDatabaseReady()) {
          this.syncInitialManagerToDatabase();
        }
      }

      log.info('API key validated and store configured', {
        storeId: validation.storeId,
        storeName: validation.storeName,
        hasInitialManager: Boolean(validation.initialManager),
      });

      return { valid: true, store: validation };
    } catch (error: unknown) {
      // Clear key on any error
      this.configStore.delete('encryptedApiKey');

      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('API key validation error', { error: message });

      return { valid: false, error: message };
    }
  }

  /**
   * Check if API key is configured
   *
   * @returns true if encrypted key exists
   */
  hasApiKey(): boolean {
    return !!this.configStore.get('encryptedApiKey');
  }

  /**
   * Clear stored API key
   *
   * Used during reset or reconfiguration.
   */
  clearApiKey(): void {
    this.configStore.delete('encryptedApiKey');
    log.info('API key cleared');
  }

  // ==========================================================================
  // Setup Status
  // ==========================================================================

  /**
   * Mark setup as complete
   *
   * Called after user completes the setup wizard.
   * Also syncs essential settings to legacy config store for App.tsx compatibility.
   */
  completeSetup(): void {
    const now = new Date().toISOString();
    this.configStore.set('setupCompletedAt', now);

    // Sync essential settings to legacy nuvana-config.json for App.tsx compatibility
    // App.tsx uses configService.getConfig().isConfigured to determine if setup is done
    try {
      const legacyConfigStore = new Store({
        name: 'nuvana-config',
      });

      // Set the fields required for isConfigured to be true
      // Only apiUrl and apiKey are required - watchPath/storeId are optional
      legacyConfigStore.set('apiUrl', this.getCloudEndpoint());
      legacyConfigStore.set('apiKey', 'configured'); // Placeholder - actual key is in settingsService
      legacyConfigStore.set('isConfigured', true);

      // Optional fields - set if available
      const storeId = this.configStore.get('storeId') as string;
      const watchPath = this.configStore.get('xmlWatchFolder') as string;
      if (storeId) legacyConfigStore.set('storeId', storeId);
      if (watchPath) legacyConfigStore.set('watchPath', watchPath);

      log.info('Legacy config synced for App.tsx compatibility');
    } catch (error) {
      log.warn('Failed to sync legacy config', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    log.info('Setup completed', { completedAt: now });
  }

  /**
   * Check if initial setup is complete
   *
   * @returns true if setup wizard has been completed
   */
  isSetupComplete(): boolean {
    return !!this.configStore.get('setupCompletedAt');
  }

  /**
   * Reset setup status
   *
   * Used during full reset or reconfiguration.
   */
  resetSetup(): void {
    this.configStore.delete('setupCompletedAt');
    log.info('Setup status reset');
  }

  // ==========================================================================
  // Cloud Endpoint Configuration
  // ==========================================================================

  /**
   * Get API URL
   * Reads from apiUrl, falls back to legacy cloudEndpoint, then defaults
   *
   * @returns Configured API URL or environment-appropriate default
   */
  getApiUrl(): string {
    // Try new field first
    const apiUrl = this.configStore.get('apiUrl') as string;
    if (apiUrl) {
      return apiUrl;
    }

    // Fall back to legacy field (migration support)
    const legacyEndpoint = this.configStore.get('cloudEndpoint') as string;
    if (legacyEndpoint) {
      // Migrate to new field
      this.configStore.set('apiUrl', legacyEndpoint);
      log.info('Migrated cloudEndpoint to apiUrl');
      return legacyEndpoint;
    }

    // Return environment-appropriate default
    return DEFAULT_API_URL;
  }

  /**
   * Set API URL
   *
   * @param url - API URL (HTTPS required for non-localhost)
   * @throws Error if validation fails
   * @security SEC-008: HTTPS enforcement for production
   */
  setApiUrl(url: string): void {
    // Allow HTTP for localhost/127.0.0.1 (development)
    const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1');
    if (!isLocalhost && !url.startsWith('https://')) {
      throw new Error('API URL must use HTTPS for security (HTTP only allowed for localhost)');
    }

    this.configStore.set('apiUrl', url);
    log.info('API URL updated');
  }

  /**
   * Get store ID
   */
  getStoreId(): string {
    return (this.configStore.get('storeId') as string) || '';
  }

  /**
   * @deprecated Use getApiUrl() instead
   */
  getCloudEndpoint(): string {
    return this.getApiUrl();
  }

  /**
   * @deprecated Use setApiUrl() instead
   */
  setCloudEndpoint(endpoint: string): void {
    // SEC-008: Validate HTTPS
    const validation = CloudEndpointSchema.safeParse(endpoint);
    if (!validation.success) {
      throw new Error(validation.error.issues[0]?.message || 'Invalid endpoint');
    }

    this.configStore.set('apiUrl', endpoint);
    log.info('Cloud endpoint updated (deprecated, use setApiUrl)');
  }

  // ==========================================================================
  // File Watcher Configuration
  // ==========================================================================

  /**
   * Get watch path for XML files
   * Falls back to legacy xmlWatchFolder field
   */
  getWatchPath(): string {
    const watchPath = this.configStore.get('watchPath') as string;
    if (watchPath) return watchPath;

    // Migration from legacy field
    const legacyPath = this.configStore.get('xmlWatchFolder') as string;
    if (legacyPath) {
      this.configStore.set('watchPath', legacyPath);
      log.info('Migrated xmlWatchFolder to watchPath');
      return legacyPath;
    }

    return '';
  }

  /**
   * Set watch path for XML files
   */
  setWatchPath(watchPath: string): void {
    if (watchPath && !path.isAbsolute(watchPath)) {
      throw new Error('Watch path must be absolute');
    }
    if (watchPath && watchPath.includes('..')) {
      throw new Error('Watch path cannot contain parent directory references');
    }
    this.configStore.set('watchPath', watchPath);
    log.info('Watch path updated');
  }

  /**
   * Get archive path for processed files
   */
  getArchivePath(): string {
    return (this.configStore.get('archivePath') as string) || '';
  }

  /**
   * Set archive path for processed files
   */
  setArchivePath(archivePath: string): void {
    if (archivePath && !path.isAbsolute(archivePath)) {
      throw new Error('Archive path must be absolute');
    }
    this.configStore.set('archivePath', archivePath);
    log.info('Archive path updated');
  }

  /**
   * Get error path for failed files
   */
  getErrorPath(): string {
    return (this.configStore.get('errorPath') as string) || '';
  }

  /**
   * Set error path for failed files
   */
  setErrorPath(errorPath: string): void {
    if (errorPath && !path.isAbsolute(errorPath)) {
      throw new Error('Error path must be absolute');
    }
    this.configStore.set('errorPath', errorPath);
    log.info('Error path updated');
  }

  /**
   * Get poll interval for file watcher (seconds)
   */
  getPollInterval(): number {
    return (this.configStore.get('pollInterval') as number) || DEFAULT_POLL_INTERVAL;
  }

  /**
   * Set poll interval for file watcher (seconds)
   */
  setPollInterval(interval: number): void {
    if (interval < 1 || interval > 3600) {
      throw new Error('Poll interval must be between 1 and 3600 seconds');
    }
    this.configStore.set('pollInterval', interval);
    log.info('Poll interval updated', { interval });
  }

  /**
   * Get enabled file types
   */
  getEnabledFileTypes(): SettingsStoreSchema['enabledFileTypes'] {
    return this.configStore.get('enabledFileTypes') || DEFAULT_ENABLED_FILE_TYPES;
  }

  /**
   * Set enabled file types
   */
  setEnabledFileTypes(types: SettingsStoreSchema['enabledFileTypes']): void {
    this.configStore.set('enabledFileTypes', types);
    log.info('Enabled file types updated');
  }

  // ==========================================================================
  // App Behavior Configuration
  // ==========================================================================

  /**
   * Get minimize to tray setting
   */
  getMinimizeToTray(): boolean {
    const value = this.configStore.get('minimizeToTray');
    return value !== undefined ? value : true; // Default true
  }

  /**
   * Set minimize to tray setting
   */
  setMinimizeToTray(value: boolean): void {
    this.configStore.set('minimizeToTray', value);
    log.info('Minimize to tray updated', { value });
  }

  /**
   * Get start on login setting
   */
  getStartOnLogin(): boolean {
    const value = this.configStore.get('startOnLogin');
    return value !== undefined ? value : true; // Default true
  }

  /**
   * Set start on login setting
   */
  setStartOnLogin(value: boolean): void {
    this.configStore.set('startOnLogin', value);
    log.info('Start on login updated', { value });
  }

  /**
   * Get show notifications setting
   */
  getShowNotifications(): boolean {
    const value = this.configStore.get('showNotifications');
    return value !== undefined ? value : true; // Default true
  }

  /**
   * Set show notifications setting
   */
  setShowNotifications(value: boolean): void {
    this.configStore.set('showNotifications', value);
    log.info('Show notifications updated', { value });
  }

  /**
   * Get process in order setting
   */
  getProcessInOrder(): boolean {
    return this.configStore.get('processInOrder') || false;
  }

  /**
   * Set process in order setting
   */
  setProcessInOrder(value: boolean): void {
    this.configStore.set('processInOrder', value);
    log.info('Process in order updated', { value });
  }

  /**
   * Get isConfigured flag from store (raw value)
   * Note: Use isConfigured() for the full check including DB state
   */
  getIsConfiguredFlag(): boolean {
    return this.configStore.get('isConfigured') || false;
  }

  /**
   * Set isConfigured flag
   */
  setIsConfiguredFlag(value: boolean): void {
    this.configStore.set('isConfigured', value);
    log.info('isConfigured flag updated', { value });
  }

  /**
   * Get complete config object (NuvanaConfig-compatible)
   * For services that need the full config type
   */
  getConfig(): {
    apiUrl: string;
    apiKey: string;
    storeId: string;
    watchPath: string;
    archivePath: string;
    errorPath: string;
    pollInterval: number;
    enabledFileTypes: NonNullable<SettingsStoreSchema['enabledFileTypes']>;
    startOnLogin: boolean;
    minimizeToTray: boolean;
    showNotifications: boolean;
    processInOrder: boolean;
    isConfigured: boolean;
  } {
    return {
      apiUrl: this.getApiUrl(),
      apiKey: '', // API key is encrypted - services use cloudApiService for auth
      storeId: this.getStoreId(),
      watchPath: this.getWatchPath(),
      archivePath: this.getArchivePath(),
      errorPath: this.getErrorPath(),
      pollInterval: this.getPollInterval(),
      enabledFileTypes: this.getEnabledFileTypes()!,
      startOnLogin: this.getStartOnLogin(),
      minimizeToTray: this.getMinimizeToTray(),
      showNotifications: this.getShowNotifications(),
      processInOrder: this.getProcessInOrder(),
      isConfigured: this.getIsConfiguredFlag(),
    };
  }

  /**
   * Save config values (partial update)
   * For IPC config:save handler
   */
  saveConfig(
    update: Partial<{
      apiUrl: string;
      storeId: string;
      watchPath: string;
      archivePath: string;
      errorPath: string;
      pollInterval: number;
      enabledFileTypes: SettingsStoreSchema['enabledFileTypes'];
      startOnLogin: boolean;
      minimizeToTray: boolean;
      showNotifications: boolean;
      processInOrder: boolean;
    }>
  ): void {
    if (update.apiUrl !== undefined) this.setApiUrl(update.apiUrl);
    if (update.storeId !== undefined) this.configStore.set('storeId', update.storeId);
    if (update.watchPath !== undefined) this.setWatchPath(update.watchPath);
    if (update.archivePath !== undefined) this.setArchivePath(update.archivePath);
    if (update.errorPath !== undefined) this.setErrorPath(update.errorPath);
    if (update.pollInterval !== undefined) this.setPollInterval(update.pollInterval);
    if (update.enabledFileTypes !== undefined) this.setEnabledFileTypes(update.enabledFileTypes);
    if (update.startOnLogin !== undefined) this.setStartOnLogin(update.startOnLogin);
    if (update.minimizeToTray !== undefined) this.setMinimizeToTray(update.minimizeToTray);
    if (update.showNotifications !== undefined) this.setShowNotifications(update.showNotifications);
    if (update.processInOrder !== undefined) this.setProcessInOrder(update.processInOrder);

    // Update isConfigured flag based on essential fields
    const hasApiUrl = !!this.getApiUrl();
    const hasApiKey = this.hasApiKey();
    this.setIsConfiguredFlag(hasApiUrl && hasApiKey);

    log.info('Config saved via saveConfig');
  }

  /**
   * Get complete file watcher config (for FileWatcherService)
   */
  getFileWatcherConfig(): {
    watchPath: string;
    archivePath: string;
    errorPath: string;
    pollInterval: number;
    enabledFileTypes: NonNullable<SettingsStoreSchema['enabledFileTypes']>;
    processInOrder: boolean;
  } {
    return {
      watchPath: this.getWatchPath(),
      archivePath: this.getArchivePath(),
      errorPath: this.getErrorPath(),
      pollInterval: this.getPollInterval(),
      enabledFileTypes: this.getEnabledFileTypes()!,
      processInOrder: this.getProcessInOrder(),
    };
  }

  // ==========================================================================
  // Offline Capabilities
  // ==========================================================================

  /**
   * Get offline permissions for local authorization checks
   *
   * @returns Array of permission strings or empty array
   */
  getOfflinePermissions(): string[] {
    return (this.configStore.get('offlinePermissions') as string[]) || [];
  }

  /**
   * Check if a specific offline permission is granted
   *
   * @param permission - Permission string to check
   * @returns true if permission is granted
   */
  hasOfflinePermission(permission: string): boolean {
    const permissions = this.getOfflinePermissions();
    return permissions.includes(permission);
  }

  /**
   * Get decrypted offline token
   *
   * SEC-007: Token stored encrypted, decrypted only when needed
   *
   * @returns Decrypted offline token or null if not available
   */
  getOfflineToken(): string | null {
    const encryptedTokenArray = this.configStore.get('encryptedOfflineToken') as
      | number[]
      | undefined;

    if (!encryptedTokenArray || encryptedTokenArray.length === 0) {
      return null;
    }

    try {
      if (!safeStorage.isEncryptionAvailable()) {
        log.error('SafeStorage not available for decryption');
        return null;
      }

      const encryptedBuffer = Buffer.from(encryptedTokenArray);
      return safeStorage.decryptString(encryptedBuffer);
    } catch (error) {
      log.error('Failed to decrypt offline token', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Check if offline token is valid (not expired)
   *
   * @returns true if token exists and is not expired
   */
  isOfflineTokenValid(): boolean {
    const expiresAt = this.configStore.get('offlineTokenExpiresAt') as string | undefined;

    if (!expiresAt) {
      return false;
    }

    try {
      const expirationDate = new Date(expiresAt);
      const now = new Date();
      return expirationDate > now;
    } catch {
      log.warn('Invalid offline token expiration date', { expiresAt });
      return false;
    }
  }

  /**
   * Get offline token expiration date
   *
   * @returns Expiration date string or null
   */
  getOfflineTokenExpiration(): string | null {
    return (this.configStore.get('offlineTokenExpiresAt') as string) || null;
  }

  // ==========================================================================
  // Configuration Status
  // ==========================================================================

  /**
   * Check if app is fully configured and ready to use
   *
   * Requires:
   * - Database ready
   * - Store configured
   * - API key stored
   * - Setup completed
   *
   * @returns true if fully configured
   */
  isConfigured(): boolean {
    const dbReady = storesDAL.isDatabaseReady();
    const hasStore = storesDAL.isConfigured();
    const hasKey = this.hasApiKey();
    const setupComplete = this.isSetupComplete();

    return dbReady && hasStore && hasKey && setupComplete;
  }

  /**
   * Sync store info from config store to database
   *
   * Called after database bootstrap to ensure store record exists in database.
   * This handles the case where API key was validated during setup when
   * the database wasn't ready yet.
   *
   * @returns true if store was synced, false if already in database or no config data
   */
  syncStoreToDatabase(): boolean {
    // Check if database is ready
    if (!storesDAL.isDatabaseReady()) {
      log.debug('syncStoreToDatabase: Database not ready, skipping');
      return false;
    }

    // Check if store already exists in database
    if (storesDAL.isConfigured()) {
      log.debug('syncStoreToDatabase: Store already in database, skipping');
      return false;
    }

    // Check if we have store info in config store
    const storeId = this.configStore.get('storeId') as string | undefined;
    const storeName = this.configStore.get('storeName') as string | undefined;
    const companyId = this.configStore.get('companyId') as string | undefined;
    const timezone = this.configStore.get('timezone') as string | undefined;

    if (!storeId || !companyId) {
      log.debug('syncStoreToDatabase: No store info in config, skipping');
      return false;
    }

    // Sync store to database
    try {
      storesDAL.upsertFromCloud({
        store_id: storeId,
        company_id: companyId,
        name: storeName || '',
        timezone: timezone || 'America/New_York',
        status: 'ACTIVE',
      });

      log.info('Store synced from config to database', {
        storeId,
        storeName,
      });

      return true;
    } catch (error) {
      log.error('Failed to sync store to database', {
        error: error instanceof Error ? error.message : String(error),
        storeId,
      });
      return false;
    }
  }

  /**
   * Sync initial manager from config store to database
   *
   * Called after database bootstrap to ensure initial manager exists in database.
   * This handles the case where API key was validated during setup when
   * the database wasn't ready yet.
   *
   * @returns true if manager was synced, false if already exists or no config data
   * @security SEC-001: PIN hash from cloud, already bcrypt hashed
   */
  syncInitialManagerToDatabase(): boolean {
    // Check if database is ready
    if (!usersDAL.isDatabaseReady()) {
      log.debug('syncInitialManagerToDatabase: Database not ready, skipping');
      return false;
    }

    // Check if we have initial manager info in config store
    const userId = this.configStore.get('initialManager.userId') as string | undefined;
    const name = this.configStore.get('initialManager.name') as string | undefined;
    const role = this.configStore.get('initialManager.role') as string | undefined;
    const pinHash = this.configStore.get('initialManager.pinHash') as string | undefined;

    if (!userId || !name || !pinHash) {
      log.debug('syncInitialManagerToDatabase: No initial manager in config, skipping');
      return false;
    }

    // Get store ID from config (needed for user creation)
    const storeId = this.configStore.get('storeId') as string | undefined;
    if (!storeId) {
      log.warn('syncInitialManagerToDatabase: No store ID in config, skipping');
      return false;
    }

    // Check if user already exists (by cloud_user_id)
    const existingUser = usersDAL.findByCloudId(userId);
    if (existingUser) {
      log.debug('syncInitialManagerToDatabase: Initial manager already exists', {
        userId: existingUser.user_id,
        cloudUserId: userId,
      });
      // Clear config store data since user is already in database
      this.clearInitialManagerFromConfig();
      return false;
    }

    // Sync initial manager to database
    try {
      usersDAL.upsertFromCloud({
        cloud_user_id: userId,
        store_id: storeId,
        role: (role as 'store_manager' | 'cashier' | 'shift_manager') || 'store_manager',
        name,
        pin_hash: pinHash,
      });

      log.info('Initial manager synced from config to database', {
        cloudUserId: userId,
        name,
        role,
        storeId,
      });

      // Clear config store data after successful sync
      this.clearInitialManagerFromConfig();

      return true;
    } catch (error) {
      log.error('Failed to sync initial manager to database', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      return false;
    }
  }

  /**
   * Clear initial manager data from config store
   * Called after successful sync to database
   */
  private clearInitialManagerFromConfig(): void {
    this.configStore.delete('initialManager.userId');
    this.configStore.delete('initialManager.name');
    this.configStore.delete('initialManager.role');
    this.configStore.delete('initialManager.pinHash');
    log.debug('Initial manager cleared from config store');
  }

  /**
   * Get configuration status for diagnostics
   *
   * @returns Object with status of each configuration component
   */
  getConfigurationStatus(): {
    databaseReady: boolean;
    hasStore: boolean;
    hasApiKey: boolean;
    setupComplete: boolean;
    hasWatchFolder: boolean;
  } {
    return {
      databaseReady: storesDAL.isDatabaseReady(),
      hasStore: storesDAL.isConfigured(),
      hasApiKey: this.hasApiKey(),
      setupComplete: this.isSetupComplete(),
      hasWatchFolder: !!(this.configStore.get('xmlWatchFolder') as string),
    };
  }

  // ==========================================================================
  // Business Day Cutoff Time
  // ==========================================================================

  /**
   * Get the configured business day cutoff time
   *
   * @returns Cutoff time in HH:MM format (24-hour), default "06:00"
   */
  getBusinessDayCutoffTime(): string {
    return (
      (this.configStore.get('businessDayCutoffTime') as string) || DEFAULT_BUSINESS_DAY_CUTOFF_TIME
    );
  }

  /**
   * Adjust business date based on file timestamp and cutoff time
   *
   * If the file's timestamp is BEFORE the cutoff time (e.g., 3:00 AM < 6:00 AM cutoff),
   * the business date is adjusted to the PREVIOUS day.
   *
   * This implements AGKSoft-compatible overnight shift handling where shifts
   * closing after midnight but before the cutoff belong to yesterday's business day.
   *
   * @param businessDate - The original business date from the NAXML file (YYYY-MM-DD)
   * @param fileTimestamp - The file's timestamp or end time from the NAXML file
   * @returns Adjusted business date (YYYY-MM-DD) - may be previous day if before cutoff
   *
   * @example
   * // With default cutoff of "06:00":
   * adjustBusinessDate("2024-01-02", "2024-01-02T03:00:00") // Returns "2024-01-01" (3 AM < 6 AM)
   * adjustBusinessDate("2024-01-02", "2024-01-02T08:00:00") // Returns "2024-01-02" (8 AM >= 6 AM)
   */
  adjustBusinessDate(businessDate: string, fileTimestamp: string | null | undefined): string {
    // If no timestamp provided, use the business date as-is
    if (!fileTimestamp) {
      return businessDate;
    }

    const cutoffTime = this.getBusinessDayCutoffTime();

    try {
      // Parse the cutoff time (HH:MM format)
      const [cutoffHours, cutoffMinutes] = cutoffTime.split(':').map(Number);
      const cutoffTotalMinutes = cutoffHours * 60 + cutoffMinutes;

      // Parse the file timestamp to extract time
      // eslint-disable-next-line no-restricted-syntax -- Parsing NAXML timestamps
      const timestamp = new Date(fileTimestamp);
      if (isNaN(timestamp.getTime())) {
        log.warn('Invalid file timestamp, using original business date', {
          businessDate,
          fileTimestamp,
        });
        return businessDate;
      }

      const fileHours = timestamp.getHours();
      const fileMinutes = timestamp.getMinutes();
      const fileTotalMinutes = fileHours * 60 + fileMinutes;

      // If file time is BEFORE the cutoff, adjust to previous day
      if (fileTotalMinutes < cutoffTotalMinutes) {
        // Parse the business date and subtract one day
        // eslint-disable-next-line no-restricted-syntax -- Parsing NAXML business dates
        const dateObj = new Date(businessDate + 'T12:00:00'); // Use noon to avoid timezone issues
        if (isNaN(dateObj.getTime())) {
          log.warn('Invalid business date, returning as-is', { businessDate });
          return businessDate;
        }

        dateObj.setDate(dateObj.getDate() - 1);
        const adjustedDate = dateObj.toISOString().split('T')[0];

        log.debug('Business date adjusted for overnight cutoff', {
          originalDate: businessDate,
          adjustedDate,
          fileTime: `${String(fileHours).padStart(2, '0')}:${String(fileMinutes).padStart(2, '0')}`,
          cutoffTime,
        });

        return adjustedDate;
      }

      // File time is at or after cutoff - use original business date
      return businessDate;
    } catch (error) {
      log.error('Error adjusting business date', {
        error: error instanceof Error ? error.message : String(error),
        businessDate,
        fileTimestamp,
      });
      // On any error, return the original business date (safe fallback)
      return businessDate;
    }
  }

  // ==========================================================================
  // Reset
  // ==========================================================================

  /**
   * Reset all settings
   *
   * Clears all stored configuration. Used for complete app reset.
   * Requires confirmation (not implemented here - enforced by caller).
   */
  resetAll(): void {
    this.configStore.clear();
    log.warn('All settings reset');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for settings operations
 */
export const settingsService = new SettingsService();
