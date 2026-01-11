/**
 * Config Service
 *
 * Manages application configuration using electron-store.
 * Stores settings like API credentials, watch paths, and preferences.
 *
 * @module main/services/config.service
 * @security
 * - SEC-007: Secrets stored encrypted via safeStorage
 * - SEC-014: Input validation via Zod schemas
 * - LM-001: Structured logging with secret redaction
 */

import Store from 'electron-store';
import { safeStorage } from 'electron';
import { createLogger } from '../utils/logger';
import {
  type NuvanaSyncConfig,
  type NuvanaSyncConfigUpdate,
  DEFAULT_CONFIG,
  NuvanaSyncConfigSchema,
  safeValidateConfigUpdate,
} from '../../shared/types/config.types';

// ============================================================================
// Logger Setup (LM-001)
// ============================================================================

const log = createLogger('config-service');

// ============================================================================
// Config Service Class
// ============================================================================

export class ConfigService {
  private store: Store<NuvanaSyncConfig>;

  constructor() {
    this.store = new Store<NuvanaSyncConfig>({
      name: 'nuvana-sync-config',
      defaults: DEFAULT_CONFIG,
    });

    log.info('Config service initialized');
  }

  /**
   * Get the current configuration
   * API key is decrypted if stored encrypted
   */
  getConfig(): NuvanaSyncConfig {
    const config = this.store.store;

    // Decrypt API key if stored encrypted
    if (config.apiKey && safeStorage.isEncryptionAvailable()) {
      try {
        const decrypted = safeStorage.decryptString(Buffer.from(config.apiKey, 'base64'));
        log.debug('Config retrieved with decrypted API key');
        return { ...config, apiKey: decrypted };
      } catch (error) {
        // If decryption fails, return as-is (might be unencrypted from dev)
        log.warn('API key decryption failed, returning raw value', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return config;
      }
    }

    log.debug('Config retrieved');
    return config;
  }

  /**
   * Save configuration with validation
   *
   * @throws Error if validation fails
   * @security SEC-014: Input validation before storage
   */
  saveConfig(configUpdate: NuvanaSyncConfigUpdate): void {
    // SEC-014: Validate incoming config update
    const validation = safeValidateConfigUpdate(configUpdate);

    if (!validation.success) {
      const errors = validation.error.issues;
      const errorMessage = errors.map((e) => e.path.join('.') + ': ' + e.message).join(', ');
      log.error('Config validation failed', {
        errorCount: errors.length,
      });
      throw new Error('Invalid configuration: ' + errorMessage);
    }

    const current = this.store.store;
    const updated = { ...current, ...validation.data };

    // SEC-007: Encrypt API key if available
    if (validation.data.apiKey && safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(validation.data.apiKey);
      updated.apiKey = encrypted.toString('base64');
      log.debug('API key encrypted for storage');
    }

    // Mark as configured if essential fields are present
    updated.isConfigured = !!(
      updated.apiUrl &&
      updated.apiKey &&
      updated.storeId &&
      updated.watchPath
    );

    // Validate the final config before saving
    const finalValidation = NuvanaSyncConfigSchema.safeParse(updated);
    if (!finalValidation.success) {
      log.error('Final config validation failed');
      throw new Error('Configuration resulted in invalid state');
    }

    this.store.store = updated;
    log.info('Configuration saved successfully', {
      isConfigured: updated.isConfigured,
      hasWatchPath: !!updated.watchPath,
      hasApiUrl: !!updated.apiUrl,
    });
  }

  /**
   * Reset configuration to defaults
   */
  resetConfig(): void {
    this.store.clear();
    log.info('Configuration reset to defaults');
  }

  /**
   * Check if the app is configured
   */
  isConfigured(): boolean {
    return this.store.get('isConfigured', false);
  }

  /**
   * Get a specific config value
   */
  get<K extends keyof NuvanaSyncConfig>(key: K): NuvanaSyncConfig[K] {
    return this.store.get(key);
  }

  /**
   * Set a specific config value with validation
   * @security SEC-014: Validate individual field updates
   */
  set<K extends keyof NuvanaSyncConfig>(key: K, value: NuvanaSyncConfig[K]): void {
    // Validate the value against the schema
    const partialConfig = { [key]: value };
    const validation = safeValidateConfigUpdate(partialConfig);

    if (!validation.success) {
      log.error('Config value validation failed', { key });
      const firstError = validation.error.issues[0];
      throw new Error('Invalid value for ' + key + ': ' + (firstError?.message || 'Unknown error'));
    }

    this.store.set(key, value);
    log.debug('Config value updated', { key });
  }
}

// ============================================================================
// Type Re-exports for Convenience
// ============================================================================

export type { NuvanaSyncConfig, NuvanaSyncConfigUpdate };
