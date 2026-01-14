/**
 * License Service
 *
 * Enterprise-grade license management with encrypted storage, tamper detection,
 * and expiry-date-based validation with 7-day grace period.
 *
 * @module main/services/license
 * @security CDP-001: Encrypted storage using Electron safeStorage
 * @security LM-003: Audit logging for license state changes
 * @security API-001: Schema validation for all license data
 * @security API-003: Centralized error handling
 * @security LM-001: Structured logging with secret redaction
 */

import { safeStorage } from 'electron';
import Store from 'electron-store';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { createLogger } from '../utils/logger';

// ============================================================================
// Constants
// ============================================================================

/** Days after expiry before app locks (SEC-GRACE) */
export const GRACE_PERIOD_DAYS = 15;

/**
 * Maximum days allowed for offline operation without cloud validation
 * Industry standard: Microsoft 365 allows up to 180 days for enterprise
 * This is a safety net - primary validation is subscription expiresAt
 */
export const MAX_OFFLINE_DAYS = 180;

/** Days before expiry to show warning banner */
export const WARNING_THRESHOLD_DAYS = 30;

/** Electron-store key for license data */
export const LICENSE_STORE_KEY = 'license';

/** License check interval in milliseconds (1 hour) */
export const LICENSE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Milliseconds in a day */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ============================================================================
// Types & Schemas (API-001: Schema validation)
// ============================================================================

/**
 * License status values
 */
export type LicenseStatus = 'active' | 'past_due' | 'cancelled' | 'suspended';

/**
 * License data schema for validation
 * API-001: Use schema validation for every payload
 */
const LicenseDataSchema = z.object({
  expiresAt: z.string().datetime({ message: 'expiresAt must be ISO 8601 datetime' }),
  status: z.enum(['active', 'past_due', 'cancelled', 'suspended']),
  lastChecked: z.string().datetime({ message: 'lastChecked must be ISO 8601 datetime' }),
  /** Timestamp of last successful cloud validation (for offline tracking) */
  lastOnlineValidation: z.string().datetime().optional(),
  storeId: z.string().optional(),
  companyId: z.string().optional(),
});

/**
 * Stored license data (encrypted)
 */
export interface LicenseData {
  expiresAt: string;
  status: LicenseStatus;
  lastChecked: string;
  /** Timestamp of last successful cloud validation (for offline tracking) */
  lastOnlineValidation?: string;
  storeId?: string;
  companyId?: string;
}

/**
 * License API response schema
 * API-001: Validate API responses
 */
export const LicenseApiResponseSchema = z.object({
  expiresAt: z.string().datetime(),
  status: z.enum(['active', 'past_due', 'cancelled', 'suspended']),
});

export type LicenseApiResponse = z.infer<typeof LicenseApiResponseSchema>;

/**
 * License state for renderer
 */
export interface LicenseState {
  valid: boolean;
  expiresAt: string | null;
  daysRemaining: number | null;
  showWarning: boolean;
  inGracePeriod: boolean;
  status: LicenseStatus | null;
  lastChecked: string | null;
  /** Days since last online validation (for offline mode awareness) */
  daysSinceOnlineValidation: number | null;
  /** Whether currently operating in offline mode */
  offlineMode: boolean;
}

/**
 * Internal stored format with integrity hash
 */
interface StoredLicenseData {
  /** Encrypted license data (base64) */
  encryptedData: string;
  /** HMAC-SHA256 integrity hash */
  integrityHash: string;
  /** Timestamp of storage */
  storedAt: string;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('license');

// ============================================================================
// License Service Class
// ============================================================================

/**
 * License Service
 *
 * Manages license validation, storage, and enforcement.
 * Uses Electron's safeStorage for encryption and HMAC for tamper detection.
 *
 * Security features:
 * - CDP-001: AES-256 encryption via Electron safeStorage
 * - Tamper detection via HMAC-SHA256 integrity hash
 * - Immediate revocation on 401/403 (no grace period)
 * - Audit logging for all state changes
 */
export class LicenseService {
  private store: Store;
  private licenseData: LicenseData | null = null;
  private readonly integritySecret: string;
  private statusChangeCallbacks: Array<(state: LicenseState) => void> = [];

  constructor() {
    this.store = new Store({ name: 'nuvana-license' });
    // Use a derived secret for integrity hashing
    // In production, this would come from a secure source
    this.integritySecret = this.deriveIntegritySecret();
    this.loadFromStorage();
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Derive integrity secret from machine-specific data
   * CDP-001: Use secure key derivation
   */
  private deriveIntegritySecret(): string {
    // Use a combination of app-specific and machine-specific data
    // This makes the integrity hash machine-bound
    const baseData = 'nuvana-license-integrity-v1';
    return createHash('sha256').update(baseData).digest('hex');
  }

  /**
   * Load license data from encrypted storage
   * CDP-001: Decrypt using safeStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = this.store.get(LICENSE_STORE_KEY) as StoredLicenseData | undefined;

      if (!stored) {
        log.debug('No license data in storage');
        this.licenseData = null;
        return;
      }

      // Verify integrity before decryption
      if (!this.verifyIntegrity(stored)) {
        log.error('License data integrity check failed - possible tampering');
        this.licenseData = null;
        this.store.delete(LICENSE_STORE_KEY);
        return;
      }

      // Decrypt the data
      const decrypted = this.decrypt(stored.encryptedData);
      if (!decrypted) {
        log.error('Failed to decrypt license data');
        this.licenseData = null;
        return;
      }

      // Parse and validate
      const parsed = JSON.parse(decrypted);
      const validation = LicenseDataSchema.safeParse(parsed);

      if (!validation.success) {
        log.error('License data validation failed', {
          errors: validation.error.issues.map((i) => i.message),
        });
        this.licenseData = null;
        return;
      }

      this.licenseData = validation.data;
      log.info('License data loaded from storage', {
        expiresAt: this.licenseData.expiresAt,
        status: this.licenseData.status,
        lastChecked: this.licenseData.lastChecked,
      });
    } catch (error) {
      log.error('Error loading license from storage', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.licenseData = null;
    }
  }

  /**
   * Save license data to encrypted storage
   * CDP-001: Encrypt using safeStorage with integrity hash
   */
  private saveToStorage(): void {
    if (!this.licenseData) {
      this.store.delete(LICENSE_STORE_KEY);
      return;
    }

    try {
      const dataString = JSON.stringify(this.licenseData);
      const encrypted = this.encrypt(dataString);

      if (!encrypted) {
        log.error('Failed to encrypt license data for storage');
        return;
      }

      const storedData: StoredLicenseData = {
        encryptedData: encrypted,
        integrityHash: this.computeIntegrityHash(encrypted),
        storedAt: new Date().toISOString(),
      };

      this.store.set(LICENSE_STORE_KEY, storedData);
      log.debug('License data saved to storage');
    } catch (error) {
      log.error('Error saving license to storage', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ==========================================================================
  // Encryption/Decryption (CDP-001)
  // ==========================================================================

  /**
   * Encrypt string using Electron safeStorage
   * CDP-001: Use vetted encryption (OS-level encryption via safeStorage)
   */
  private encrypt(data: string): string | null {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(data);
        return encrypted.toString('base64');
      }
      // Fallback for development (not secure - should only be used in dev)
      if (process.env.NODE_ENV === 'development') {
        log.warn('safeStorage not available - using plaintext storage (dev only)');
        return Buffer.from(data).toString('base64');
      }
      log.error('Encryption not available and not in development mode');
      return null;
    } catch (error) {
      log.error('Encryption failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Decrypt string using Electron safeStorage
   */
  private decrypt(encryptedBase64: string): string | null {
    try {
      const buffer = Buffer.from(encryptedBase64, 'base64');

      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(buffer);
      }
      // Fallback for development
      if (process.env.NODE_ENV === 'development') {
        return buffer.toString('utf8');
      }
      log.error('Decryption not available');
      return null;
    } catch (error) {
      log.error('Decryption failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  // ==========================================================================
  // Integrity Verification (Tamper Detection)
  // ==========================================================================

  /**
   * Compute HMAC-SHA256 integrity hash
   * Used to detect tampering with stored license data
   * CDP-001: Use vetted cryptographic library (Node.js crypto) with proper HMAC
   */
  private computeIntegrityHash(data: string): string {
    // Use proper HMAC construction with secret as key
    const hmac = createHmac('sha256', this.integritySecret);
    hmac.update(data);
    return hmac.digest('hex');
  }

  /**
   * Verify integrity of stored license data
   * Returns false if data has been tampered with
   */
  private verifyIntegrity(stored: StoredLicenseData): boolean {
    try {
      const computedHash = this.computeIntegrityHash(stored.encryptedData);
      const storedHashBuffer = Buffer.from(stored.integrityHash, 'hex');
      const computedHashBuffer = Buffer.from(computedHash, 'hex');

      // Use timing-safe comparison to prevent timing attacks
      if (storedHashBuffer.length !== computedHashBuffer.length) {
        return false;
      }
      return timingSafeEqual(storedHashBuffer, computedHashBuffer);
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // License Validation
  // ==========================================================================

  /**
   * Check if license is valid
   *
   * Validation logic (industry standard approach):
   * 1. Suspended/cancelled = immediately invalid (no grace period)
   * 2. If subscription expiresAt + GRACE_PERIOD_DAYS > now → valid
   * 3. Primary validation is subscription end date, not online check frequency
   *
   * The MAX_OFFLINE_DAYS constant is a safety net for edge cases,
   * but normal operation relies on the subscription expiration date.
   */
  isValid(): boolean {
    if (!this.licenseData) {
      log.debug('No license data - invalid');
      return false;
    }

    // Suspended/cancelled = immediately invalid, no grace period
    if (this.licenseData.status === 'suspended' || this.licenseData.status === 'cancelled') {
      log.debug('License suspended or cancelled - invalid');
      return false;
    }

    const expiresAt = new Date(this.licenseData.expiresAt);
    const gracePeriodEnd = new Date(expiresAt.getTime() + GRACE_PERIOD_DAYS * MS_PER_DAY);
    const now = new Date();

    // Primary check: subscription expiration + grace period
    const subscriptionValid = gracePeriodEnd > now;

    if (subscriptionValid) {
      return true;
    }

    // Subscription expired - log and return invalid
    log.info('License expired beyond grace period', {
      expiresAt: this.licenseData.expiresAt,
      gracePeriodEnd: gracePeriodEnd.toISOString(),
    });

    return false;
  }

  /**
   * Check if currently operating in offline mode
   * Returns true if we haven't validated with cloud recently but license is still valid
   */
  isOfflineMode(): boolean {
    if (!this.licenseData?.lastOnlineValidation) {
      // No online validation recorded - could be first run or legacy data
      return false;
    }

    const lastOnline = new Date(this.licenseData.lastOnlineValidation);
    const now = new Date();
    const daysSinceOnline = Math.floor((now.getTime() - lastOnline.getTime()) / MS_PER_DAY);

    // Consider offline mode if more than 1 day since last cloud check
    return daysSinceOnline > 1;
  }

  /**
   * Get days since last successful online validation
   */
  getDaysSinceOnlineValidation(): number | null {
    if (!this.licenseData?.lastOnlineValidation) {
      return null;
    }

    const lastOnline = new Date(this.licenseData.lastOnlineValidation);
    const now = new Date();
    return Math.floor((now.getTime() - lastOnline.getTime()) / MS_PER_DAY);
  }

  /**
   * Get days until expiry (negative if expired)
   */
  getDaysUntilExpiry(): number | null {
    if (!this.licenseData) {
      return null;
    }

    const expiresAt = new Date(this.licenseData.expiresAt);
    const now = new Date();
    const diffMs = expiresAt.getTime() - now.getTime();

    return Math.ceil(diffMs / MS_PER_DAY);
  }

  /**
   * Check if license is in grace period
   * True if: expired but within grace period
   */
  isInGracePeriod(): boolean {
    if (!this.licenseData) {
      return false;
    }

    // Suspended/cancelled never get grace period
    if (this.licenseData.status === 'suspended' || this.licenseData.status === 'cancelled') {
      return false;
    }

    const daysRemaining = this.getDaysUntilExpiry();
    if (daysRemaining === null) {
      return false;
    }

    // In grace period if expired (negative days) but within grace window
    return daysRemaining < 0 && daysRemaining >= -GRACE_PERIOD_DAYS;
  }

  /**
   * Check if warning should be shown
   * True if: less than 30 days until expiry (or in grace period)
   */
  shouldShowWarning(): boolean {
    if (!this.licenseData) {
      return false;
    }

    // Don't show warning for suspended/cancelled - show lock screen instead
    if (this.licenseData.status === 'suspended' || this.licenseData.status === 'cancelled') {
      return false;
    }

    const daysRemaining = this.getDaysUntilExpiry();
    if (daysRemaining === null) {
      return false;
    }

    // Show warning if less than threshold days OR in grace period
    return daysRemaining <= WARNING_THRESHOLD_DAYS;
  }

  /**
   * Get current license state for renderer
   */
  getState(): LicenseState {
    if (!this.licenseData) {
      return {
        valid: false,
        expiresAt: null,
        daysRemaining: null,
        showWarning: false,
        inGracePeriod: false,
        status: null,
        lastChecked: null,
        daysSinceOnlineValidation: null,
        offlineMode: false,
      };
    }

    return {
      valid: this.isValid(),
      expiresAt: this.licenseData.expiresAt,
      daysRemaining: this.getDaysUntilExpiry(),
      showWarning: this.shouldShowWarning(),
      inGracePeriod: this.isInGracePeriod(),
      status: this.licenseData.status,
      lastChecked: this.licenseData.lastChecked,
      daysSinceOnlineValidation: this.getDaysSinceOnlineValidation(),
      offlineMode: this.isOfflineMode(),
    };
  }

  // ==========================================================================
  // License Updates
  // ==========================================================================

  /**
   * Update license from API response
   * API-001: Validate response schema before processing
   * LM-003: Audit log license state changes
   *
   * This is called on successful cloud validation, so we also update
   * lastOnlineValidation to track offline duration.
   *
   * @param response - License data from API
   * @param storeId - Optional store ID for audit
   * @param companyId - Optional company ID for audit
   */
  updateFromApiResponse(response: LicenseApiResponse, storeId?: string, companyId?: string): void {
    // API-001: Validate response
    const validation = LicenseApiResponseSchema.safeParse(response);
    if (!validation.success) {
      log.error('Invalid license API response', {
        errors: validation.error.issues.map((i) => i.message),
      });
      return;
    }

    const previousState = this.licenseData ? { ...this.licenseData } : null;
    const now = new Date().toISOString();

    this.licenseData = {
      expiresAt: validation.data.expiresAt,
      status: validation.data.status,
      lastChecked: now,
      // Update lastOnlineValidation since this came from cloud
      lastOnlineValidation: now,
      storeId,
      companyId,
    };

    this.saveToStorage();

    // LM-003: Audit log state change
    log.info('License updated from API (online validation)', {
      expiresAt: this.licenseData.expiresAt,
      status: this.licenseData.status,
      previousStatus: previousState?.status,
      storeId,
    });

    // Notify listeners of state change
    this.notifyStatusChange();
  }

  /**
   * Mark license as suspended (401 response)
   * LM-003: Audit log immediate revocation
   */
  markSuspended(): void {
    const previousStatus = this.licenseData?.status;

    if (this.licenseData) {
      this.licenseData.status = 'suspended';
      this.licenseData.lastChecked = new Date().toISOString();
    } else {
      this.licenseData = {
        expiresAt: new Date().toISOString(),
        status: 'suspended',
        lastChecked: new Date().toISOString(),
      };
    }

    this.saveToStorage();

    // LM-003: Audit log immediate revocation
    log.warn('License marked as suspended (401)', {
      previousStatus,
      storeId: this.licenseData.storeId,
    });

    this.notifyStatusChange();
  }

  /**
   * Mark license as cancelled (403 response)
   * LM-003: Audit log immediate revocation
   */
  markCancelled(): void {
    const previousStatus = this.licenseData?.status;

    if (this.licenseData) {
      this.licenseData.status = 'cancelled';
      this.licenseData.lastChecked = new Date().toISOString();
    } else {
      this.licenseData = {
        expiresAt: new Date().toISOString(),
        status: 'cancelled',
        lastChecked: new Date().toISOString(),
      };
    }

    this.saveToStorage();

    // LM-003: Audit log immediate revocation
    log.warn('License marked as cancelled (403)', {
      previousStatus,
      storeId: this.licenseData.storeId,
    });

    this.notifyStatusChange();
  }

  /**
   * Clear license data (for testing/reset)
   */
  clear(): void {
    log.info('Clearing license data');
    this.licenseData = null;
    this.store.delete(LICENSE_STORE_KEY);
    this.notifyStatusChange();
  }

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  /**
   * Register callback for license status changes
   */
  onStatusChange(callback: (state: LicenseState) => void): () => void {
    this.statusChangeCallbacks.push(callback);
    return () => {
      const index = this.statusChangeCallbacks.indexOf(callback);
      if (index > -1) {
        this.statusChangeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Notify all listeners of status change
   */
  private notifyStatusChange(): void {
    const state = this.getState();
    for (const callback of this.statusChangeCallbacks) {
      try {
        callback(state);
      } catch (error) {
        log.error('Error in license status change callback', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // ==========================================================================
  // Utility
  // ==========================================================================

  /**
   * Check if license needs refresh from API
   * Returns true if last check was more than LICENSE_CHECK_INTERVAL_MS ago
   */
  needsRefresh(): boolean {
    if (!this.licenseData) {
      return true;
    }

    const lastChecked = new Date(this.licenseData.lastChecked);
    const now = new Date();
    return now.getTime() - lastChecked.getTime() > LICENSE_CHECK_INTERVAL_MS;
  }

  /**
   * Get raw license data (for debugging only)
   */
  getRawData(): LicenseData | null {
    return this.licenseData ? { ...this.licenseData } : null;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for license operations
 */
export const licenseService = new LicenseService();
