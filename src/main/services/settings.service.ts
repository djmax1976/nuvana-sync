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
import { posTerminalMappingsDAL } from '../dal/pos-id-mappings.dal';
import { cloudApiService, ValidateApiKeyResponse } from './cloud-api.service';
import { licenseService } from './license.service';
import { createLogger } from '../utils/logger';
import path from 'path';
import fs from 'fs';
import {
  TerminalSyncRecord,
  POSConnectionType,
  POSSystemType,
  FileConnectionConfig,
  POSConnectionConfig,
  validatePOSConnectionConfig,
  formatPOSConnectionValidationErrors,
  convertTerminalToPOSConnectionConfig,
} from '../../shared/types/config.types';
import type { CloudRegister } from '../../shared/types/config.types';
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

  /**
   * POS Connection Configuration (Version 8.0)
   * Store-level POS connection settings from cloud.
   * Determines how the app connects to the POS system.
   *
   * @security SEC-014: Validated against POSConnectionConfigSchema
   */
  posConnectionConfig: POSConnectionConfig | null;

  // Local (editable by MANAGER/SUPPORT)
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
 * Version 7.0: Now includes terminal validation status
 */
export interface ApiKeyValidationResult {
  valid: boolean;
  store?: ValidateApiKeyResponse;
  error?: string;
  /**
   * Terminal validation errors if terminal config is missing or invalid
   * MANDATORY: If present, setup must be blocked
   */
  terminalValidationErrors?: string[];
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

  // ========== One-Time Migration Tracking (CRON-001: Idempotency) ==========
  /**
   * Tracks completion of the v007 terminal backfill migration.
   * ISO timestamp when backfill was completed, or undefined if not run.
   * CRITICAL: Once set, backfill MUST NOT run again to preserve user deletions.
   */
  'migrations.terminalBackfillV007CompletedAt'?: string;

  // ========== Terminal Configuration (Version 7.0 - DEPRECATED) ==========
  // NOTE: Terminal config is deprecated. Use posConnection.* for new implementations.
  // These fields are kept for backward compatibility during migration.
  /** Terminal UUID from cloud */
  'terminal.posTerminalId'?: string;
  /** Terminal display name */
  'terminal.name'?: string;
  /** Device identifier */
  'terminal.deviceId'?: string;
  /** Connection type: NETWORK, API, WEBHOOK, FILE, MANUAL */
  'terminal.connectionType'?: POSConnectionType;
  /** Connection config (JSON stringified) */
  'terminal.connectionConfig'?: string;
  /** POS system type */
  'terminal.posType'?: POSSystemType;
  /** Terminal status */
  'terminal.terminalStatus'?: string;
  /** Sync status */
  'terminal.syncStatus'?: string;
  /** Last sync timestamp */
  'terminal.lastSyncAt'?: string;
  /** Updated timestamp */
  'terminal.updatedAt'?: string;

  // ========== POS Connection Configuration (Store-Level - NEW) ==========
  // This is the new store-level POS connection config from cloud API.
  // Terminals/registers are now discovered dynamically from POS data.
  /** POS system type (e.g., GILBARCO_NAXML, SQUARE_REST) */
  'posConnection.posType'?: POSSystemType;
  /** Connection type: NETWORK, API, WEBHOOK, FILE, MANUAL */
  'posConnection.connectionType'?: POSConnectionType;
  /** Connection config (JSON stringified) - structure depends on connectionType */
  'posConnection.connectionConfig'?: string;
  /** Whether store-level POS connection config is set (vs legacy terminal config) */
  'posConnection.isConfigured'?: boolean;
  /** Timestamp when POS connection config was last updated */
  'posConnection.updatedAt'?: string;
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

/**
 * POS types that support NAXML file-based data ingestion.
 *
 * These are the ONLY POS types for which the file watcher should run.
 * All other POS types use different data ingestion methods (API, Network, etc.)
 * which are not yet implemented.
 *
 * SEC-014: Strict allowlist validation - only these types enable file watcher
 *
 * @see POSSystemType for all possible POS types
 */
const NAXML_COMPATIBLE_POS_TYPES: readonly POSSystemType[] = [
  'GILBARCO_NAXML',
  'GILBARCO_PASSPORT',
  'FILE_BASED',
] as const;

/**
 * Phase 8: Rollback Feature Flag
 *
 * Environment variable to disable POS type checks if problems arise.
 * When set to 'false', bypasses POS type validation and allows file watcher
 * to start for any configuration with a watchPath (emergency rollback behavior).
 *
 * Usage:
 *   - Default (not set or any value except 'false'): POS type checks ENABLED
 *   - ENABLE_POS_TYPE_CHECKS=false: POS type checks DISABLED (rollback mode)
 *
 * @security OPS-012: Feature flag loaded from environment variable
 * @security SEC-017: Audit logging when flag is used
 *
 * @example
 * // In production, enable checks (default behavior)
 * // ENABLE_POS_TYPE_CHECKS is not set → checks enabled
 *
 * // Emergency rollback: disable checks
 * // set ENABLE_POS_TYPE_CHECKS=false
 */
const ENABLE_POS_TYPE_CHECKS: boolean = process.env.ENABLE_POS_TYPE_CHECKS !== 'false';

// Log feature flag status at module load (only if disabled - notable event)
if (!ENABLE_POS_TYPE_CHECKS) {
  // Use console.warn since logger may not be initialized yet at module load time
  // This is logged again via structured logging when the flag is actually used
  console.warn(
    '[settings-service] WARNING: POS type checks DISABLED via ENABLE_POS_TYPE_CHECKS=false environment variable'
  );
}

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
        // Version 8.0: POS connection configuration
        posConnectionConfig: this.getPOSConnectionConfig(),
        xmlWatchFolder: this.getWatchPath(),
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

      // Version 8.0: POS connection configuration (store-level)
      posConnectionConfig: this.getPOSConnectionConfig(),

      // Local settings
      xmlWatchFolder: this.getWatchPath(),
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

    // Process xmlWatchFolder if provided (maps to watchPath internally)
    if (validatedUpdates.xmlWatchFolder !== undefined) {
      // Additional runtime validation: folder must exist and be accessible
      const folderValidation = this.validateFolder(validatedUpdates.xmlWatchFolder);
      if (!folderValidation.valid) {
        throw new Error(`Invalid watch folder: ${folderValidation.error}`);
      }

      // Store as watchPath (single source of truth)
      this.configStore.set('watchPath', validatedUpdates.xmlWatchFolder);
      log.info('Watch folder updated', {
        // Don't log full path, just confirmation
        pathLength: validatedUpdates.xmlWatchFolder.length,
      });
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
   * @param options - Validation options
   * @param options.isInitialSetup - If true (default), terminal config is MANDATORY.
   *                                  If false (resync), terminal is optional - updates if present.
   * @returns Validation result with store info on success
   * @security SEC-007: API key encrypted via safeStorage
   * @security SEC-008: HTTPS enforced for validation
   */
  async validateAndSaveApiKey(
    apiKey: string,
    options: { isInitialSetup?: boolean } = {}
  ): Promise<ApiKeyValidationResult> {
    const { isInitialSetup = true } = options;
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

      // =========================================================================
      // Version 8.0: POS Connection Configuration Storage (NEW)
      // SEC-014: Validated POS config from cloud
      //
      // Priority: posConnectionConfig (new) > terminal (legacy)
      //
      // Behavior differs based on isInitialSetup:
      // - Initial Setup (wizard): POS config MANDATORY - block if missing
      // - Re-sync/Refresh: POS config optional - update if present, keep existing
      // =========================================================================

      // Check for validation errors (prefer posConnectionConfig errors over terminal errors)
      const validationErrors =
        validation.posConnectionValidationErrors ?? validation.terminalValidationErrors;
      const hasPosConfig = Boolean(validation.posConnectionConfig);
      const hasTerminalConfig = Boolean(validation.terminal);

      if (validationErrors && validationErrors.length > 0) {
        if (isInitialSetup) {
          // Initial setup - validation failed, block setup
          log.error('POS connection configuration validation failed, blocking setup', {
            storeId: validation.storeId,
            errors: validationErrors,
            source: validation.posConnectionValidationErrors ? 'posConnectionConfig' : 'terminal',
          });
          return {
            valid: false,
            store: validation,
            error: `Store setup cannot continue: ${validationErrors[0]}`,
            terminalValidationErrors: validationErrors,
          };
        } else {
          // Resync - log warning but continue with existing config
          log.warn(
            'POS connection configuration validation failed during resync, keeping existing config',
            {
              storeId: validation.storeId,
              errors: validationErrors,
            }
          );
        }
      }

      // Process POS connection config (prefer new format, fall back to legacy)
      if (hasPosConfig && validation.posConnectionConfig) {
        // New store-level POS connection config available
        this.savePOSConnectionConfig(validation.posConnectionConfig);
        log.info('POS connection configuration saved (new format)', {
          posType: validation.posConnectionConfig.pos_type,
          connectionType: validation.posConnectionConfig.pos_connection_type,
        });

        // Also save to legacy terminal config for backward compatibility with existing code
        if (hasTerminalConfig && validation.terminal) {
          this.saveTerminalConfig(validation.terminal);
        }
      } else if (hasTerminalConfig && validation.terminal) {
        // Legacy terminal config only - store it and convert to new format
        this.saveTerminalConfig(validation.terminal);

        // Auto-configure file watching paths for FILE connection type
        if (
          validation.terminal.connection_type === 'FILE' &&
          validation.terminal.connection_config
        ) {
          const fileConfig = validation.terminal.connection_config as FileConnectionConfig;
          if (fileConfig.import_path) {
            this.configStore.set('watchPath', fileConfig.import_path);
            log.info('Watch path auto-configured from terminal', {
              pathLength: fileConfig.import_path.length,
            });
          }
          if (fileConfig.export_path) {
            this.configStore.set('archivePath', fileConfig.export_path);
            log.info('Archive path auto-configured from terminal', {
              pathLength: fileConfig.export_path.length,
            });
          }
          if (fileConfig.poll_interval_seconds) {
            this.configStore.set('pollInterval', fileConfig.poll_interval_seconds);
            log.info('Poll interval auto-configured from terminal', {
              interval: fileConfig.poll_interval_seconds,
            });
          }
        }
      } else if (isInitialSetup) {
        // Initial setup - POS config MANDATORY, block setup
        log.error('POS connection configuration is missing, blocking setup', {
          storeId: validation.storeId,
        });
        return {
          valid: false,
          store: validation,
          error:
            'Store setup cannot continue: POS connection configuration is missing. Please contact your administrator to configure the POS settings in the cloud portal.',
          terminalValidationErrors: ['POS connection configuration is missing'],
        };
      } else {
        // Resync - config not provided, keep existing config
        log.info(
          'POS connection configuration not provided during resync, keeping existing config',
          {
            storeId: validation.storeId,
            hasExistingPosConfig: this.hasPOSConnectionConfig(),
            hasExistingTerminal: this.hasTerminalConfig(),
          }
        );
      }

      // =========================================================================
      // MANUAL Mode: Sync pre-configured registers from cloud
      // DB-006: Store-scoped register operations
      // SEC-014: Registers already validated via CloudRegisterSchema in cloud-api.service
      //
      // Register sync is non-blocking: failures are logged but do not
      // prevent API key setup or resync from completing successfully.
      // =========================================================================
      if (validation.registers && validation.registers.length > 0) {
        try {
          const storeId = this.configStore.get('storeId') as string | undefined;
          if (storeId) {
            const syncResult = this.syncRegistersFromCloud(storeId, validation.registers);
            log.info('Cloud register sync completed', {
              storeId,
              registerCount: validation.registers.length,
              created: syncResult.created,
              updated: syncResult.updated,
            });
          } else {
            log.warn('Cannot sync registers from cloud: storeId not available in config store');
          }
        } catch (registerError) {
          log.error('Failed to sync registers from cloud', {
            error: registerError instanceof Error ? registerError.message : String(registerError),
          });
          // Non-blocking: do not fail API key setup/resync on register sync failure
        }
      }

      log.info('API key validated and store configured', {
        storeId: validation.storeId,
        storeName: validation.storeName,
        hasInitialManager: Boolean(validation.initialManager),
        hasPosConnectionConfig: hasPosConfig,
        posConnectionType: validation.posConnectionConfig?.pos_connection_type,
        posType: validation.posConnectionConfig?.pos_type,
        hasTerminal: hasTerminalConfig,
        terminalConnectionType: validation.terminal?.connection_type,
        terminalPosType: validation.terminal?.pos_type,
        registersCount: validation.registers?.length ?? 0,
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
   * Sync registers from cloud POS configuration.
   * Used during API key setup/resync for MANUAL mode stores.
   *
   * For each register from the cloud:
   * - If it already exists locally (matched by store_id + external_register_id): update it
   * - If it does not exist locally: create it via getOrCreate
   *
   * @security DB-006: Store-scoped operations — storeId passed to all DAL calls
   * @security SEC-006: All DAL methods use parameterized queries
   *
   * @param storeId - Store ID for tenant isolation
   * @param registers - Register definitions from cloud response
   * @returns Counts of created and updated registers
   */
  private syncRegistersFromCloud(
    storeId: string,
    registers: CloudRegister[]
  ): { created: number; updated: number; deactivated: number; total: number } {
    let created = 0;
    let updated = 0;

    // Track which external IDs are in the current cloud response
    const activeExternalIds = new Set<string>();

    for (const register of registers) {
      activeExternalIds.add(register.external_register_id);

      // DB-006: Store-scoped lookup via storeId
      const existing = posTerminalMappingsDAL.findByExternalId(
        storeId,
        register.external_register_id,
        'generic'
      );

      if (existing) {
        // Update existing mapping with cloud data
        posTerminalMappingsDAL.update(existing.id, {
          terminal_type: register.terminal_type,
          description: register.description,
          active: register.active ? 1 : 0,
        });
        updated++;
      } else {
        // Create new mapping
        posTerminalMappingsDAL.getOrCreate(storeId, register.external_register_id, {
          terminalType: register.terminal_type,
          description: register.description ?? undefined,
          posSystemType: 'generic',
        });
        created++;
      }
    }

    // Deactivate cloud-sourced registers no longer in the cloud response.
    // Only affects pos_system_type = 'generic' (cloud-synced).
    // Parser-created registers (gilbarco, verifone, etc.) are never touched.
    const deactivated = posTerminalMappingsDAL.deactivateStaleCloudRegisters(
      storeId,
      activeExternalIds
    );

    log.info('Registers synced from cloud for MANUAL mode', {
      storeId,
      created,
      updated,
      deactivated,
      total: registers.length,
    });

    return { created, updated, deactivated, total: registers.length };
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
  // Terminal Configuration (Version 7.0)
  // ==========================================================================

  /**
   * Save terminal configuration from cloud API
   *
   * SEC-014: Terminal config is pre-validated before this method is called
   * DB-006: Store-scoped terminal configuration
   *
   * @param terminal - Validated terminal configuration
   */
  private saveTerminalConfig(terminal: TerminalSyncRecord): void {
    this.configStore.set('terminal.posTerminalId', terminal.pos_terminal_id);
    this.configStore.set('terminal.name', terminal.name);
    if (terminal.device_id) {
      this.configStore.set('terminal.deviceId', terminal.device_id);
    }
    this.configStore.set('terminal.connectionType', terminal.connection_type);
    if (terminal.connection_config) {
      // Store connection config as JSON string for complex objects
      this.configStore.set('terminal.connectionConfig', JSON.stringify(terminal.connection_config));
    }
    this.configStore.set('terminal.posType', terminal.pos_type);
    this.configStore.set('terminal.terminalStatus', terminal.terminal_status);
    this.configStore.set('terminal.syncStatus', terminal.sync_status);
    if (terminal.last_sync_at) {
      this.configStore.set('terminal.lastSyncAt', terminal.last_sync_at);
    }
    this.configStore.set('terminal.updatedAt', terminal.updated_at);

    log.info('Terminal configuration saved', {
      terminalId: terminal.pos_terminal_id,
      name: terminal.name,
      connectionType: terminal.connection_type,
      posType: terminal.pos_type,
    });
  }

  /**
   * Get terminal configuration
   *
   * @returns Terminal configuration or null if not configured
   */
  getTerminalConfig(): TerminalSyncRecord | null {
    const posTerminalId = this.configStore.get('terminal.posTerminalId') as string | undefined;
    if (!posTerminalId) {
      return null;
    }

    const connectionConfigStr = this.configStore.get('terminal.connectionConfig') as
      | string
      | undefined;
    let connectionConfig = null;
    if (connectionConfigStr) {
      try {
        connectionConfig = JSON.parse(connectionConfigStr);
      } catch {
        log.warn('Failed to parse terminal connection config');
      }
    }

    return {
      pos_terminal_id: posTerminalId,
      name: (this.configStore.get('terminal.name') as string) || '',
      device_id: (this.configStore.get('terminal.deviceId') as string) || null,
      connection_type:
        (this.configStore.get('terminal.connectionType') as POSConnectionType) || 'MANUAL',
      connection_config: connectionConfig,
      pos_type: (this.configStore.get('terminal.posType') as POSSystemType) || 'UNKNOWN',
      terminal_status:
        (this.configStore.get('terminal.terminalStatus') as
          | 'ACTIVE'
          | 'INACTIVE'
          | 'MAINTENANCE'
          | 'OFFLINE') || 'OFFLINE',
      sync_status:
        (this.configStore.get('terminal.syncStatus') as
          | 'PENDING'
          | 'SUCCESS'
          | 'FAILED'
          | 'IN_PROGRESS') || 'PENDING',
      last_sync_at: (this.configStore.get('terminal.lastSyncAt') as string) || null,
      updated_at: (this.configStore.get('terminal.updatedAt') as string) || '',
    };
  }

  /**
   * Check if terminal configuration is present
   *
   * @returns true if terminal is configured
   */
  hasTerminalConfig(): boolean {
    return !!this.configStore.get('terminal.posTerminalId');
  }

  /**
   * Get terminal connection type
   *
   * @returns Connection type or null if not configured
   */
  getTerminalConnectionType(): POSConnectionType | null {
    return (this.configStore.get('terminal.connectionType') as POSConnectionType) || null;
  }

  /**
   * Get terminal POS type
   *
   * @returns POS system type or null if not configured
   */
  getTerminalPosType(): POSSystemType | null {
    return (this.configStore.get('terminal.posType') as POSSystemType) || null;
  }

  /**
   * Clear terminal configuration
   *
   * Used during reset or reconfiguration.
   *
   * @security SEC-017: May be called during authorized FULL_RESET
   */
  clearTerminalConfig(): void {
    this.configStore.delete('terminal.posTerminalId');
    this.configStore.delete('terminal.name');
    this.configStore.delete('terminal.deviceId');
    this.configStore.delete('terminal.connectionType');
    this.configStore.delete('terminal.connectionConfig');
    this.configStore.delete('terminal.posType');
    this.configStore.delete('terminal.terminalStatus');
    this.configStore.delete('terminal.syncStatus');
    this.configStore.delete('terminal.lastSyncAt');
    this.configStore.delete('terminal.updatedAt');
    log.info('Terminal configuration cleared');
  }

  // ==========================================================================
  // POS Connection Configuration (Store-Level - NEW)
  // ==========================================================================

  /**
   * Save POS connection configuration from cloud API (new store-level format)
   *
   * This is the new format where POS connection is at the store level.
   * Terminals/registers are discovered dynamically from POS data.
   *
   * @security SEC-014: Defense-in-depth validation including path traversal prevention
   * @security SEC-017: Audit logging for POS configuration changes
   * @security DB-006: Store-scoped POS connection configuration
   *
   * @param config - POS connection configuration (validated here for defense-in-depth)
   * @throws Error if validation fails (path traversal, invalid format, etc.)
   */
  savePOSConnectionConfig(config: POSConnectionConfig): void {
    const timestamp = new Date().toISOString();

    // SEC-014: Defense-in-depth - validate config even if pre-validated by caller
    try {
      validatePOSConnectionConfig(config);
    } catch (error) {
      const errors =
        error instanceof z.ZodError ? formatPOSConnectionValidationErrors(error) : [String(error)];

      // SEC-017: Audit log failed configuration attempts
      log.error('SEC-014: POS connection configuration validation failed', {
        timestamp,
        action: 'SAVE_POS_CONFIG_REJECTED',
        posType: config.pos_type,
        connectionType: config.pos_connection_type,
        validationErrors: errors,
        reason: 'defense_in_depth_validation_failure',
      });

      throw new Error(`Invalid POS connection configuration: ${errors.join(', ')}`);
    }

    // SEC-014: Additional explicit path traversal check for FILE connection type
    if (config.pos_connection_type === 'FILE' && config.pos_connection_config) {
      const fileConfig = config.pos_connection_config as {
        import_path?: string;
        export_path?: string;
      };

      // Validate import_path for path traversal
      if (fileConfig.import_path) {
        if (fileConfig.import_path.includes('..')) {
          log.error('SEC-014: Path traversal attempt detected in import_path', {
            timestamp,
            action: 'SAVE_POS_CONFIG_REJECTED',
            posType: config.pos_type,
            connectionType: config.pos_connection_type,
            pathAttempt: fileConfig.import_path.substring(0, 50), // Truncate for logging
            reason: 'path_traversal_detected',
          });
          throw new Error(
            'Invalid import_path: Path cannot contain parent directory references (..)'
          );
        }
      }

      // Validate export_path for path traversal
      if (fileConfig.export_path && fileConfig.export_path.includes('..')) {
        log.error('SEC-014: Path traversal attempt detected in export_path', {
          timestamp,
          action: 'SAVE_POS_CONFIG_REJECTED',
          posType: config.pos_type,
          connectionType: config.pos_connection_type,
          pathAttempt: fileConfig.export_path.substring(0, 50), // Truncate for logging
          reason: 'path_traversal_detected',
        });
        throw new Error(
          'Invalid export_path: Path cannot contain parent directory references (..)'
        );
      }
    }

    // Save validated configuration
    this.configStore.set('posConnection.posType', config.pos_type);
    this.configStore.set('posConnection.connectionType', config.pos_connection_type);

    if (config.pos_connection_config) {
      // Store connection config as JSON string for complex objects
      this.configStore.set(
        'posConnection.connectionConfig',
        JSON.stringify(config.pos_connection_config)
      );
    } else {
      this.configStore.delete('posConnection.connectionConfig');
    }

    this.configStore.set('posConnection.isConfigured', true);
    this.configStore.set('posConnection.updatedAt', timestamp);

    // SEC-017: Audit log successful configuration save
    log.info('SEC-017: POS connection configuration saved', {
      timestamp,
      action: 'SAVE_POS_CONFIG_SUCCESS',
      posType: config.pos_type,
      connectionType: config.pos_connection_type,
      hasConnectionConfig: config.pos_connection_config !== null,
    });

    // Auto-configure file watching paths for FILE connection type
    if (config.pos_connection_type === 'FILE' && config.pos_connection_config) {
      const fileConfig = config.pos_connection_config as {
        import_path?: string;
        export_path?: string;
        poll_interval_seconds?: number;
      };

      if (fileConfig.import_path) {
        this.configStore.set('watchPath', fileConfig.import_path);
        log.info('Watch path auto-configured from POS connection config', {
          pathLength: fileConfig.import_path.length,
        });
      }
      if (fileConfig.export_path) {
        this.configStore.set('archivePath', fileConfig.export_path);
        log.info('Archive path auto-configured from POS connection config', {
          pathLength: fileConfig.export_path.length,
        });
      }
      if (fileConfig.poll_interval_seconds) {
        this.configStore.set('pollInterval', fileConfig.poll_interval_seconds);
        log.info('Poll interval auto-configured from POS connection config', {
          interval: fileConfig.poll_interval_seconds,
        });
      }
    }
  }

  /**
   * Update POS connection configuration (local edits by SUPPORT)
   *
   * Allows updating the connection_config portion while preserving
   * the pos_type and pos_connection_type from the cloud.
   *
   * SEC-014: Validates input against POSConnectionConfigSchema
   * API-001: Schema validation for all inputs
   *
   * @param updates - Partial config updates (only pos_connection_config is editable)
   * @throws Error if validation fails or no config exists
   */
  updatePOSConnectionConfig(updates: {
    pos_connection_config: Record<string, unknown> | null;
  }): void {
    // Get current config to preserve pos_type and pos_connection_type
    const currentConfig = this.getPOSConnectionConfig();
    if (!currentConfig) {
      throw new Error('No POS connection configuration exists to update');
    }

    // Build the updated config
    const updatedConfig: POSConnectionConfig = {
      pos_type: currentConfig.pos_type,
      pos_connection_type: currentConfig.pos_connection_type,
      pos_connection_config: updates.pos_connection_config,
    };

    // SEC-014: Validate the complete config
    try {
      const validated = validatePOSConnectionConfig(updatedConfig);

      // Save the validated config
      if (validated.pos_connection_config) {
        this.configStore.set(
          'posConnection.connectionConfig',
          JSON.stringify(validated.pos_connection_config)
        );
      } else {
        this.configStore.delete('posConnection.connectionConfig');
      }
      this.configStore.set('posConnection.updatedAt', new Date().toISOString());

      log.info('POS connection configuration updated', {
        posType: validated.pos_type,
        connectionType: validated.pos_connection_type,
        hasConnectionConfig: validated.pos_connection_config !== null,
      });

      // Auto-update legacy fields for FILE connection type
      if (validated.pos_connection_type === 'FILE' && validated.pos_connection_config) {
        const fileConfig = validated.pos_connection_config as {
          import_path?: string;
          export_path?: string;
          poll_interval_seconds?: number;
        };

        if (fileConfig.import_path) {
          this.configStore.set('watchPath', fileConfig.import_path);
          log.info('Watch path auto-updated from POS connection config');
        }
        if (fileConfig.export_path) {
          this.configStore.set('archivePath', fileConfig.export_path);
          log.info('Archive path auto-updated from POS connection config');
        }
        if (fileConfig.poll_interval_seconds) {
          this.configStore.set('pollInterval', fileConfig.poll_interval_seconds);
          log.info('Poll interval auto-updated from POS connection config');
        }
      }

      // Auto-update for API connection type
      if (validated.pos_connection_type === 'API' && validated.pos_connection_config) {
        // API config is stored in posConnection.connectionConfig, no legacy fields to update
        log.info('API connection configuration updated');
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = formatPOSConnectionValidationErrors(error);
        log.error('POS connection config update validation failed', { errors });
        throw new Error(`Validation failed: ${errors.join(', ')}`);
      }
      throw error;
    }
  }

  /**
   * Get POS connection configuration (store-level)
   *
   * Returns the new store-level POS connection config if configured,
   * or converts from legacy terminal config for backward compatibility.
   *
   * @returns POS connection configuration or null if not configured
   */
  getPOSConnectionConfig(): POSConnectionConfig | null {
    // First check if new format is configured
    const isNewConfigured = this.configStore.get('posConnection.isConfigured') as boolean;

    if (isNewConfigured) {
      const connectionConfigStr = this.configStore.get('posConnection.connectionConfig') as
        | string
        | undefined;
      let connectionConfig = null;

      if (connectionConfigStr) {
        try {
          connectionConfig = JSON.parse(connectionConfigStr);
        } catch {
          log.warn('Failed to parse POS connection config');
        }
      }

      return {
        pos_type: (this.configStore.get('posConnection.posType') as POSSystemType) || 'UNKNOWN',
        pos_connection_type:
          (this.configStore.get('posConnection.connectionType') as POSConnectionType) || 'MANUAL',
        pos_connection_config: connectionConfig,
      };
    }

    // Fall back to legacy terminal config for backward compatibility
    const terminalConfig = this.getTerminalConfig();
    if (terminalConfig) {
      log.debug('Converting legacy terminal config to POS connection config');
      return convertTerminalToPOSConnectionConfig(terminalConfig);
    }

    return null;
  }

  /**
   * Check if POS connection configuration is present (either new or legacy format)
   *
   * @returns true if POS connection is configured
   */
  hasPOSConnectionConfig(): boolean {
    // Check new format first
    if (this.configStore.get('posConnection.isConfigured')) {
      return true;
    }
    // Fall back to legacy terminal config
    return this.hasTerminalConfig();
  }

  /**
   * Get POS connection type (from new config or legacy terminal)
   *
   * @returns Connection type or null if not configured
   */
  getPOSConnectionType(): POSConnectionType | null {
    // Check new format first
    const isConfigured = this.configStore.get('posConnection.isConfigured');
    const newConnectionType = this.configStore.get('posConnection.connectionType');
    const legacyConnectionType = this.getTerminalConnectionType();

    log.debug('getPOSConnectionType check', {
      isConfigured,
      newConnectionType,
      legacyConnectionType,
    });

    if (isConfigured) {
      return (newConnectionType as POSConnectionType) || null;
    }
    // Fall back to legacy
    return legacyConnectionType;
  }

  /**
   * Get POS system type (from new config or legacy terminal)
   *
   * @returns POS system type or null if not configured
   */
  getPOSType(): POSSystemType | null {
    // Check new format first
    if (this.configStore.get('posConnection.isConfigured')) {
      return (this.configStore.get('posConnection.posType') as POSSystemType) || null;
    }
    // Fall back to legacy
    return this.getTerminalPosType();
  }

  /**
   * Clear POS connection configuration
   *
   * Used during reset or reconfiguration.
   *
   * @security SEC-017: May be called during authorized FULL_RESET
   */
  clearPOSConnectionConfig(): void {
    this.configStore.delete('posConnection.posType');
    this.configStore.delete('posConnection.connectionType');
    this.configStore.delete('posConnection.connectionConfig');
    this.configStore.delete('posConnection.isConfigured');
    this.configStore.delete('posConnection.updatedAt');
    log.info('POS connection configuration cleared');
  }

  // ==========================================================================
  // NAXML Compatibility (POS Type Validation for File Watcher)
  // ==========================================================================

  /**
   * Check if the current POS configuration supports NAXML file-based data ingestion.
   *
   * This method determines whether the file watcher should be started based on:
   * 1. POS type must be in NAXML_COMPATIBLE_POS_TYPES (GILBARCO_NAXML, GILBARCO_PASSPORT, FILE_BASED)
   * 2. Connection type must be FILE
   *
   * **Backward Compatibility**: If no POS connection config exists but a watchPath
   * is configured (legacy installations), assumes NAXML compatibility to avoid
   * breaking existing setups during migration.
   *
   * @returns true if POS type is NAXML-compatible AND connection type is FILE
   *
   * @security SEC-014: Strict allowlist validation for POS types
   * @security LM-001: Audit logging for file watcher decisions
   *
   * @example
   * // GILBARCO_NAXML + FILE → true (file watcher starts)
   * // SQUARE_REST + API → false (file watcher skipped)
   * // No config + watchPath exists → true (legacy mode)
   */
  isNAXMLCompatible(): boolean {
    const timestamp = new Date().toISOString();

    // ========================================================================
    // Phase 8: Feature Flag Rollback Check
    // If POS type checks are DISABLED via environment variable, bypass validation
    // and return true if there's a watchPath configured (emergency rollback)
    // ========================================================================
    if (!ENABLE_POS_TYPE_CHECKS) {
      const watchPath = this.getWatchPath();
      const hasWatchPath = !!watchPath;

      // SEC-017: Audit log for feature flag bypass - this is a notable security event
      log.warn('SEC-017: POS type checks DISABLED via feature flag', {
        timestamp,
        action: 'POS_TYPE_DECISION',
        decision: hasWatchPath ? 'NAXML_COMPATIBLE' : 'NOT_COMPATIBLE',
        mode: 'feature_flag_bypass',
        featureFlag: 'ENABLE_POS_TYPE_CHECKS',
        featureFlagValue: 'false',
        hasWatchPath,
        reason: hasWatchPath
          ? 'feature_flag_bypass_with_watchPath'
          : 'feature_flag_bypass_without_watchPath',
        securityNote:
          'POS type validation bypassed - ensure this is intentional for rollback purposes',
      });

      // When feature flag is disabled, allow file watcher if watchPath exists
      return hasWatchPath;
    }

    const posConfig = this.getPOSConnectionConfig();

    if (!posConfig) {
      // Backward compatibility: No POS config exists
      // If watchPath is configured, assume NAXML compatibility (legacy mode)
      const watchPath = this.getWatchPath();
      if (watchPath) {
        // SEC-017: Audit log for legacy mode decision
        log.info('SEC-017: POS type decision - legacy mode NAXML compatible', {
          timestamp,
          action: 'POS_TYPE_DECISION',
          decision: 'NAXML_COMPATIBLE',
          mode: 'legacy',
          hasWatchPath: true,
          watchPathConfigured: true,
          reason: 'existing_watchPath_implies_NAXML_compatibility',
        });
        return true;
      }
      // No config and no watchPath - not compatible
      // SEC-017: Audit log for no-config decision
      log.info('SEC-017: POS type decision - no configuration', {
        timestamp,
        action: 'POS_TYPE_DECISION',
        decision: 'NOT_COMPATIBLE',
        mode: 'unconfigured',
        hasWatchPath: false,
        reason: 'no_POS_config_and_no_watchPath',
      });
      return false;
    }

    // SEC-014: Strict allowlist check for POS type
    const isCompatiblePOSType = NAXML_COMPATIBLE_POS_TYPES.includes(posConfig.pos_type);
    const isFileConnectionType = posConfig.pos_connection_type === 'FILE';

    const isCompatible = isCompatiblePOSType && isFileConnectionType;

    // SEC-017: Audit log for POS type compatibility decision
    log.info('SEC-017: POS type decision - compatibility check', {
      timestamp,
      action: 'POS_TYPE_DECISION',
      decision: isCompatible ? 'NAXML_COMPATIBLE' : 'NOT_COMPATIBLE',
      mode: 'configured',
      posType: posConfig.pos_type,
      connectionType: posConfig.pos_connection_type,
      isCompatiblePOSType,
      isFileConnectionType,
      allowedPOSTypes: NAXML_COMPATIBLE_POS_TYPES,
      reason: isCompatible
        ? 'POS_type_and_connection_type_match_allowlist'
        : isCompatiblePOSType
          ? 'connection_type_not_FILE'
          : 'POS_type_not_in_allowlist',
    });

    return isCompatible;
  }

  /**
   * Get human-readable reason why file watcher is unavailable.
   *
   * Returns null if file watcher should run (NAXML-compatible configuration).
   * Returns a descriptive string explaining why file watcher won't start for
   * non-compatible configurations.
   *
   * @returns Reason string or null if file watcher should run
   *
   * @security LM-001: Structured logging for audit trail
   *
   * @example
   * // GILBARCO_NAXML + FILE → null (file watcher should run)
   * // SQUARE_REST + API → "SQUARE_REST uses API-based data ingestion (coming soon)"
   * // MANUAL_ENTRY + MANUAL → "Manual entry mode - no automated data ingestion"
   */
  getFileWatcherUnavailableReason(): string | null {
    const timestamp = new Date().toISOString();

    // ========================================================================
    // Phase 8: Feature Flag Rollback Check
    // If POS type checks are DISABLED, allow file watcher if watchPath exists
    // ========================================================================
    if (!ENABLE_POS_TYPE_CHECKS) {
      const watchPath = this.getWatchPath();
      if (watchPath) {
        // Feature flag bypass with watchPath - file watcher should run
        return null;
      }
      // Feature flag bypass but no watchPath - still can't run
      return 'No watch path configured (POS type checks disabled via feature flag)';
    }

    const posConfig = this.getPOSConnectionConfig();

    if (!posConfig) {
      // Check for legacy mode (watchPath without POS config)
      const watchPath = this.getWatchPath();
      if (watchPath) {
        // Legacy mode - file watcher should run
        return null;
      }
      // SEC-017: Audit log for file watcher unavailability
      log.info('SEC-017: File watcher unavailable - no configuration', {
        timestamp,
        action: 'FILE_WATCHER_STATUS',
        available: false,
        reason: 'POS connection not configured',
        hasWatchPath: false,
      });
      return 'POS connection not configured';
    }

    let reason: string | null = null;

    // Check connection type first (most common differentiator)
    switch (posConfig.pos_connection_type) {
      case 'MANUAL':
        reason = 'Manual entry mode - no automated data ingestion';
        break;

      case 'API':
        reason = `${posConfig.pos_type} uses API-based data ingestion (coming soon)`;
        break;

      case 'NETWORK':
        reason = `${posConfig.pos_type} uses network-based data ingestion (coming soon)`;
        break;

      case 'WEBHOOK':
        reason = `${posConfig.pos_type} uses webhook-based data ingestion (coming soon)`;
        break;

      case 'FILE':
        // FILE connection type - check if POS type is compatible
        if (!NAXML_COMPATIBLE_POS_TYPES.includes(posConfig.pos_type)) {
          reason = `${posConfig.pos_type} is not yet supported for file-based ingestion`;
        }
        // reason remains null if compatible - file watcher should run
        break;

      default:
        // Unknown connection type - defensive handling
        reason = `Unknown connection type: ${posConfig.pos_connection_type}`;
    }

    // SEC-017: Audit log for file watcher availability decision
    if (reason) {
      log.info('SEC-017: File watcher unavailable', {
        timestamp,
        action: 'FILE_WATCHER_STATUS',
        available: false,
        posType: posConfig.pos_type,
        connectionType: posConfig.pos_connection_type,
        reason,
      });
    }

    return reason;
  }

  /**
   * Check if POS type checks are enabled.
   *
   * Phase 8: Rollback feature flag status getter.
   * Returns true when POS type validation is active (normal operation).
   * Returns false when POS type checks are disabled via ENABLE_POS_TYPE_CHECKS=false
   * environment variable (rollback mode).
   *
   * @returns true if POS type checks are enabled, false if disabled (rollback mode)
   *
   * @security OPS-012: Feature flag status exposure for monitoring
   */
  isPOSTypeChecksEnabled(): boolean {
    return ENABLE_POS_TYPE_CHECKS;
  }

  // ==========================================================================
  // Setup Status
  // ==========================================================================

  /**
   * Mark setup as complete
   *
   * Called after user completes the setup wizard.
   */
  completeSetup(): void {
    const now = new Date().toISOString();
    this.configStore.set('setupCompletedAt', now);
    this.configStore.set('isConfigured', true);
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
   *
   * @returns Configured API URL or environment-appropriate default
   */
  getApiUrl(): string {
    return (this.configStore.get('apiUrl') as string) || DEFAULT_API_URL;
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

  // ==========================================================================
  // File Watcher Configuration
  // ==========================================================================

  /**
   * Get watch path for XML files
   */
  getWatchPath(): string {
    return (this.configStore.get('watchPath') as string) || '';
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

  // ==========================================================================
  // One-Time Migration Tracking (CRON-001: Idempotency)
  // ==========================================================================

  /**
   * Check if the v007 terminal backfill migration has been completed.
   *
   * CRON-001 Compliance: This check ensures the backfill operation is idempotent.
   * Once completed, the backfill MUST NOT run again to preserve user deletions.
   *
   * @returns true if backfill has been completed, false otherwise
   */
  isTerminalBackfillV007Completed(): boolean {
    const completedAt = this.configStore.get('migrations.terminalBackfillV007CompletedAt');
    return !!completedAt;
  }

  /**
   * Mark the v007 terminal backfill migration as completed.
   *
   * CRON-001 Compliance: Records completion timestamp for audit trail.
   * Once marked, backfill will not run on subsequent startups.
   *
   * @security LM-001: Logs completion for audit trail
   */
  markTerminalBackfillV007Completed(): void {
    const timestamp = new Date().toISOString();
    this.configStore.set('migrations.terminalBackfillV007CompletedAt', timestamp);
    log.info('Terminal backfill v007 migration marked as completed', {
      completedAt: timestamp,
    });
  }

  /**
   * Get the completion timestamp for the v007 terminal backfill migration.
   *
   * @returns ISO timestamp of completion, or null if not completed
   */
  getTerminalBackfillV007CompletedAt(): string | null {
    return (this.configStore.get('migrations.terminalBackfillV007CompletedAt') as string) || null;
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

    // Check if user already exists
    // Note: After cloud_id consolidation (v043), user_id IS the cloud user ID
    const existingUser = usersDAL.findById(userId);
    if (existingUser) {
      log.debug('syncInitialManagerToDatabase: Initial manager already exists', {
        userId: existingUser.user_id,
      });
      // Clear config store data since user is already in database
      this.clearInitialManager();
      return false;
    }

    // Sync initial manager to database
    // Note: After cloud_id consolidation (v043), user_id IS the cloud user ID
    try {
      usersDAL.upsertFromCloud({
        user_id: userId, // user_id IS the cloud user ID after consolidation
        store_id: storeId,
        role: (role as 'store_manager' | 'cashier' | 'shift_manager') || 'store_manager',
        name,
        pin_hash: pinHash,
      });

      log.info('Initial manager synced from config to database', {
        userId,
        name,
        role,
        storeId,
      });

      // Clear config store data after successful sync
      this.clearInitialManager();

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
   *
   * Used when store changes to prevent old user syncing, or after
   * successful sync to database.
   *
   * @security SEC-017: May be called during authorized FULL_RESET
   * @security LM-001: Structured logging for audit trail
   */
  clearInitialManager(): void {
    this.configStore.delete('initialManager.userId');
    this.configStore.delete('initialManager.name');
    this.configStore.delete('initialManager.role');
    this.configStore.delete('initialManager.pinHash');
    log.info('Initial manager cleared from config');
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
    hasPOSConnectionConfig: boolean;
    posConnectionType: POSConnectionType | null;
    posType: POSSystemType | null;
    // Deprecated - kept for backward compatibility
    hasTerminalConfig: boolean;
    terminalConnectionType: POSConnectionType | null;
    terminalPosType: POSSystemType | null;
  } {
    return {
      databaseReady: storesDAL.isDatabaseReady(),
      hasStore: storesDAL.isConfigured(),
      hasApiKey: this.hasApiKey(),
      setupComplete: this.isSetupComplete(),
      hasWatchFolder: !!this.getWatchPath(),
      // New POS connection config status
      hasPOSConnectionConfig: this.hasPOSConnectionConfig(),
      posConnectionType: this.getPOSConnectionType(),
      posType: this.getPOSType(),
      // Deprecated - kept for backward compatibility
      hasTerminalConfig: this.hasTerminalConfig(),
      terminalConnectionType: this.getTerminalConnectionType(),
      terminalPosType: this.getTerminalPosType(),
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

  /**
   * Delete the settings file completely
   *
   * Used for FULL_RESET to remove the nuvana.json file entirely.
   * The file will be recreated on next app startup.
   *
   * @returns Path to deleted file, or null if file didn't exist
   */
  deleteSettingsFile(): string | null {
    const configPath = this.configStore.path;

    if (fs.existsSync(configPath)) {
      // Clear store first to release any handles
      this.configStore.clear();
      // Delete the file
      fs.unlinkSync(configPath);
      log.warn('Settings file deleted', { path: configPath });
      return configPath;
    }

    log.debug('Settings file does not exist, nothing to delete', { path: configPath });
    return null;
  }

  /**
   * Delete ALL config files (for FULL_RESET)
   *
   * This method deletes both configuration files:
   * - nuvana.json (settings file)
   * - nuvana-license.json (license file)
   *
   * Both files will be recreated on next app startup when the user
   * enters their API key and validates their license.
   *
   * @security SEC-017: Only called during authorized FULL_RESET operations
   * @security LM-001: Structured logging for audit trail
   * @security API-003: Centralized error handling with sanitized responses
   *
   * @returns Object with paths of deleted files (null if file didn't exist)
   */
  deleteAllConfigFiles(): { settingsDeleted: string | null; licenseDeleted: string | null } {
    const result: { settingsDeleted: string | null; licenseDeleted: string | null } = {
      settingsDeleted: null,
      licenseDeleted: null,
    };

    // Delete settings file (nuvana.json)
    try {
      result.settingsDeleted = this.deleteSettingsFile();
    } catch (error) {
      // API-003: Log error server-side, continue with license deletion
      log.error('Failed to delete settings file during FULL_RESET', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // Delete license file (nuvana-license.json)
    try {
      result.licenseDeleted = licenseService.deleteLicenseFile();
    } catch (error) {
      // API-003: Log error server-side
      log.error('Failed to delete license file during FULL_RESET', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    log.warn('All config files deleted for FULL_RESET', {
      settingsDeleted: result.settingsDeleted !== null,
      licenseDeleted: result.licenseDeleted !== null,
      operation: 'FULL_RESET',
    });

    return result;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for settings operations
 */
export const settingsService = new SettingsService();
