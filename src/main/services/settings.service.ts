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
import { ConfigService } from './config.service';

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
 * Local settings update schema
 */
const LocalSettingsUpdateSchema = z
  .object({
    xmlWatchFolder: WatchFolderSchema.optional(),
    syncIntervalSeconds: SyncIntervalSchema.optional(),
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
 */
interface SettingsStoreSchema {
  encryptedApiKey?: number[];
  // Store info from cloud validation (saved for database sync on restart)
  storeId?: string;
  storeName?: string;
  storePublicId?: string;
  companyId?: string;
  companyName?: string;
  timezone?: string;
  stateCode?: string;
  features?: string[];
  // Offline capabilities from cloud
  offlinePermissions?: string[];
  encryptedOfflineToken?: number[];
  offlineTokenExpiresAt?: string;
  // Initial manager from API key validation (for first login)
  'initialManager.userId'?: string;
  'initialManager.name'?: string;
  'initialManager.role'?: string;
  'initialManager.pinHash'?: string;
  'lottery.enabled'?: boolean;
  'lottery.binCount'?: number;
  xmlWatchFolder?: string;
  syncIntervalSeconds?: number;
  setupCompletedAt?: string;
  cloudEndpoint?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Default sync interval in seconds */
const DEFAULT_SYNC_INTERVAL = 60;

/** Default cloud API endpoint */
const DEFAULT_CLOUD_ENDPOINT = 'https://api.nuvanaapp.com';

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

    log.info('Settings service initialized');
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
    }

    // Process syncIntervalSeconds if provided
    if (validatedUpdates.syncIntervalSeconds !== undefined) {
      this.configStore.set('syncIntervalSeconds', validatedUpdates.syncIntervalSeconds);
      log.info('Sync interval updated', { seconds: validatedUpdates.syncIntervalSeconds });
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
      this.configStore.set('stateCode', validation.stateCode);

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
      const storeId = this.configStore.get('storeId') as string;
      const watchPath = this.configStore.get('xmlWatchFolder') as string;

      // Legacy config needs apiUrl, apiKey, storeId, watchPath for isConfigured
      legacyConfigStore.set('storeId', storeId || '');
      legacyConfigStore.set('watchPath', watchPath || '');
      legacyConfigStore.set('apiUrl', this.getCloudEndpoint());
      legacyConfigStore.set('apiKey', 'configured'); // Placeholder - actual key is in settingsService
      legacyConfigStore.set('isConfigured', true);

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
   * Get cloud API endpoint
   *
   * @returns Configured endpoint or default
   */
  getCloudEndpoint(): string {
    return (this.configStore.get('cloudEndpoint') as string) || DEFAULT_CLOUD_ENDPOINT;
  }

  /**
   * Set cloud API endpoint
   *
   * Used for development/testing with different environments.
   *
   * @param endpoint - HTTPS endpoint URL
   * @throws Error if not HTTPS
   * @security SEC-008: HTTPS enforcement
   */
  setCloudEndpoint(endpoint: string): void {
    // SEC-008: Validate HTTPS
    const validation = CloudEndpointSchema.safeParse(endpoint);
    if (!validation.success) {
      throw new Error(validation.error.issues[0]?.message || 'Invalid endpoint');
    }

    this.configStore.set('cloudEndpoint', endpoint);
    log.info('Cloud endpoint updated');
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
