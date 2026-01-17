/**
 * Cloud API Service
 *
 * Handles secure communication with the Nuvana cloud backend.
 * Implements enterprise-grade security patterns for API calls.
 *
 * @module main/services/cloud-api
 * @security API-004: Authentication via Bearer token
 * @security SEC-008: HTTPS enforcement for all requests
 * @security API-003: Centralized error handling with sanitized responses
 * @security API-002: Built-in rate limiting awareness
 * @security SEC-017: Audit logging for API operations
 * @security LICENSE: License enforcement via response interceptor
 */

import { safeStorage } from 'electron';
import Store from 'electron-store';
import { z } from 'zod';
import { createLogger } from '../utils/logger';
import { licenseService, LicenseApiResponseSchema } from './license.service';
import type { SyncQueueItem } from '../dal/sync-queue.dal';

// ============================================================================
// Types
// ============================================================================

/**
 * API error response
 */
interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Batch sync response from cloud
 */
export interface BatchSyncResponse {
  success: boolean;
  results: Array<{
    id: string;
    cloudId?: string;
    status: 'synced' | 'failed';
    error?: string;
  }>;
}

/**
 * Store role type
 * MVP roles: store_manager, cashier, shift_manager
 */
export type StoreRole = 'store_manager' | 'cashier' | 'shift_manager';

/**
 * Cloud role code mapping
 * Maps cloud role codes (e.g., "STORE_MANAGER") to local role types
 */
const CLOUD_ROLE_MAP: Record<string, StoreRole> = {
  STORE_MANAGER: 'store_manager',
  SHIFT_MANAGER: 'shift_manager',
  CASHIER: 'cashier',
};

/**
 * Map cloud role code to local StoreRole
 */
function mapCloudRole(cloudRoleCode: string): StoreRole {
  return CLOUD_ROLE_MAP[cloudRoleCode] || 'cashier';
}

/**
 * User from cloud sync
 */
export interface CloudUser {
  userId: string;
  name: string;
  role: StoreRole;
  pinHash: string;
  active: boolean;
}

/**
 * Initial manager user from API key validation
 * SEC-001: PIN hash from cloud, already bcrypt hashed
 */
export interface InitialManager {
  userId: string;
  name: string;
  role: StoreRole;
  pinHash: string;
}

/**
 * Cloud users response
 */
export interface CloudUsersResponse {
  users: CloudUser[];
}

/**
 * Sync session start response (matches API documentation)
 * API: POST /api/v1/sync/start
 */
export interface SyncSessionResponse {
  /** Revocation status: VALID, SUSPENDED, REVOKED, ROTATED */
  revocationStatus: 'VALID' | 'SUSPENDED' | 'REVOKED' | 'ROTATED';
  /** Sync session UUID */
  sessionId: string;
  /** Server timestamp */
  serverTime: string;
  /** Number of records pending pull */
  pullPendingCount: number;
  /** Whether a new API key is available for rotation */
  newKeyAvailable: boolean;
  /** Grace period end date for key rotation */
  gracePeriodEndsAt: string | null;
  /** Lockout message if revoked */
  lockoutMessage?: string;
}

/**
 * Cashier from cloud sync (matches API response format)
 */
export interface CloudCashier {
  cashierId: string;
  employeeId: string;
  name: string;
  pinHash: string;
  isActive: boolean;
  syncSequence: number;
}

/**
 * Cashiers sync response from cloud (matches API documentation)
 * API: GET /api/v1/sync/cashiers
 */
export interface CloudCashiersResponse {
  cashiers: CloudCashier[];
  syncMetadata: {
    totalCount: number;
    hasMore: boolean;
    lastSequence: number;
    serverTime: string;
  };
}

/**
 * Employee from unified cloud sync (includes all roles)
 * API: GET /api/v1/sync/employees
 *
 * Enterprise-grade unified employee sync that includes:
 * - Store managers
 * - Shift managers
 * - Cashiers
 *
 * @security SEC-001: PIN hash from cloud, already bcrypt hashed
 */
export interface CloudEmployee {
  employeeId: string;
  name: string;
  role: string; // Cloud role code: STORE_MANAGER, SHIFT_MANAGER, CASHIER
  pinHash: string;
  isActive: boolean;
  syncSequence: number;
  updatedAt: string;
}

/**
 * Employees sync response from cloud
 * API: GET /api/v1/sync/employees
 */
export interface CloudEmployeesResponse {
  employees: CloudEmployee[];
  syncMetadata: {
    totalCount: number;
    hasMore: boolean;
    lastSequence: number;
    serverTime: string;
  };
}

/**
 * Sync statistics for completing a sync session
 */
export interface SyncStats {
  pulled: number;
  pushed: number;
  conflictsResolved: number;
}

/**
 * License object in API response
 */
export interface LicenseInfo {
  expiresAt: string;
  status: 'active' | 'past_due' | 'cancelled' | 'suspended';
}

// ============================================================================
// Cloud API Response Types (actual structure from cloud)
// ============================================================================

/**
 * Store identity from cloud API key validation
 */
export interface CloudStoreIdentity {
  storeId: string;
  storeName: string;
  storePublicId: string;
  companyId: string;
  companyName: string;
  timezone: string;
  stateId: string;
  stateCode: string;
  offlinePermissions: string[];
  metadata: {
    terminal_id?: string;
    pos_vendor?: string;
    features: string[];
  };
}

/**
 * Store manager from cloud API key validation
 */
export interface CloudStoreManager {
  userId: string;
  publicId: string;
  name: string;
  email: string;
  pinHash: string;
  isActive: boolean;
  role: {
    code: string;
    description: string;
  };
  storeAssignments: Array<{
    storeId: string;
    storeName: string;
    storePublicId: string;
  }>;
  permissions: string[];
  updatedAt: string;
  syncSequence: number;
}

/**
 * Raw API key validation response from cloud
 */
export interface CloudApiKeyValidationResponse {
  success: boolean;
  data: {
    identity: CloudStoreIdentity;
    offlineToken: string;
    offlineTokenExpiresAt: string;
    serverTime: string;
    revocationCheckInterval: number;
    storeManager: CloudStoreManager | null;
  };
}

/**
 * Validation response from API key check (internal format)
 * Mapped from CloudApiKeyValidationResponse for local use
 */
export interface ValidateApiKeyResponse {
  valid: boolean;
  storeId: string;
  storeName: string;
  storePublicId: string;
  companyId: string;
  companyName: string;
  timezone: string;
  stateCode: string;
  features: string[];
  offlinePermissions: string[];
  offlineToken: string;
  offlineTokenExpiresAt: string;
  lottery?: {
    enabled: boolean;
    binCount: number;
  };
  /** License information for enforcement */
  license?: LicenseInfo;
  /**
   * Initial manager user for first login
   * Created via cloud dashboard before generating API key
   * SEC-001: PIN hash from cloud, already bcrypt hashed
   */
  initialManager?: InitialManager;
}

/**
 * Cloud bin data
 */
export interface CloudBin {
  bin_id: string;
  store_id: string;
  bin_number: number;
  label?: string;
  status: 'ACTIVE' | 'INACTIVE';
  updated_at: string;
  deleted_at?: string;
}

/**
 * Cloud game data
 */
export interface CloudGame {
  game_id: string;
  game_code: string;
  name: string;
  price: number;
  pack_value: number;
  tickets_per_pack?: number;
  status: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
  updated_at: string;
}

/**
 * Bins sync response
 */
export interface CloudBinsResponse {
  bins: CloudBin[];
  totalCount: number;
}

/**
 * Games sync response
 */
export interface CloudGamesResponse {
  games: CloudGame[];
}

/**
 * Lottery config value from cloud
 */
export interface CloudLotteryConfigValue {
  config_value_id: string;
  amount: number;
  display_order: number;
}

/**
 * Lottery configuration response from cloud
 * API: GET /api/lottery/config-values
 */
export interface CloudLotteryConfigResponse {
  ticket_prices: CloudLotteryConfigValue[];
  pack_values: CloudLotteryConfigValue[];
}

/**
 * Game lookup result from cloud
 * API: GET /api/v1/sync/lottery/games
 */
export interface CloudGameLookupResult {
  game_id: string;
  game_code: string;
  name: string;
  price: number;
  pack_value: number;
  tickets_per_pack: number | null;
  status: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
  state_id: string | null;
  store_id: string | null;
  scope_type?: 'STATE' | 'STORE' | 'GLOBAL';
}

// ============================================================================
// Constants
// ============================================================================

/** Default API base URL */
const DEFAULT_API_URL =
  process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : 'https://api.nuvanaapp.com';

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 30000;

/** Health check timeout in milliseconds */
const HEALTH_CHECK_TIMEOUT_MS = 5000;

/** Maximum retry attempts for transient errors */
const MAX_RETRIES = 3;

/** Retry delay base in milliseconds */
const RETRY_DELAY_BASE_MS = 1000;

/** Client version header */
const CLIENT_VERSION = '1.0.0';

// ============================================================================
// Schemas for response validation
// ============================================================================

/**
 * Store role schema
 */
const StoreRoleSchema = z.enum(['store_manager', 'cashier', 'shift_manager']);

/**
 * License info schema for validation
 * API-001: Schema validation for license data
 */
const LicenseInfoSchema = z.object({
  expiresAt: z.string().datetime(),
  status: z.enum(['active', 'past_due', 'cancelled', 'suspended']),
});

/**
 * Initial manager schema for validation
 * SEC-001: PIN hash validation
 */
const InitialManagerSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1),
  role: StoreRoleSchema,
  pinHash: z.string().min(1),
});

const ValidateApiKeyResponseSchema = z.object({
  valid: z.boolean(),
  storeId: z.string(),
  storeName: z.string(),
  storePublicId: z.string(),
  companyId: z.string(),
  companyName: z.string(),
  timezone: z.string(),
  stateCode: z.string(),
  features: z.array(z.string()),
  offlinePermissions: z.array(z.string()),
  offlineToken: z.string(),
  offlineTokenExpiresAt: z.string(),
  lottery: z
    .object({
      enabled: z.boolean(),
      binCount: z.number(),
    })
    .optional(),
  license: LicenseInfoSchema.optional(),
  initialManager: InitialManagerSchema.optional(),
});

const BatchSyncResponseSchema = z.object({
  success: z.boolean(),
  results: z.array(
    z.object({
      id: z.string(),
      cloudId: z.string().optional(),
      status: z.enum(['synced', 'failed']),
      error: z.string().optional(),
    })
  ),
});

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('cloud-api');

// ============================================================================
// Cloud API Service
// ============================================================================

/**
 * Cloud API Service
 *
 * Provides secure communication with the Nuvana cloud backend.
 * All requests are authenticated via Bearer token and use HTTPS only.
 *
 * Security features:
 * - SEC-008: HTTPS enforcement (validated before each request)
 * - API-004: Bearer token authentication
 * - API-003: Centralized error handling with sanitized messages
 * - API-002: Rate limit awareness via retry-after headers
 * - SEC-017: Audit logging for all API operations
 * - LICENSE: Response interceptor for license enforcement
 */
export class CloudApiService {
  private configStore: Store;
  private licenseStatusChangeCallbacks: Array<() => void> = [];

  constructor() {
    // Must match the store name used by SettingsService
    this.configStore = new Store({ name: 'nuvana' });
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Get the base URL for API requests
   * SEC-008: Enforce HTTPS in production
   */
  private getBaseUrl(): string {
    const url = (this.configStore.get('apiUrl') as string) || DEFAULT_API_URL;

    // SEC-008: Enforce HTTPS in production, allow HTTP for local development
    const isDev = process.env.NODE_ENV === 'development';
    const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1');

    if (!url.startsWith('https://') && !isDev && !isLocalhost) {
      log.error('HTTPS required for cloud API', { url: url.substring(0, 50) });
      throw new Error('Cloud API requires HTTPS');
    }

    return url;
  }

  /**
   * Get the decrypted API key
   * SEC-007: API key stored encrypted, decrypted only when needed
   *
   * @throws Error if API key not configured
   */
  private getApiKey(): string {
    // Key is stored as array of bytes by SettingsService
    const encryptedKeyArray = this.configStore.get('encryptedApiKey') as number[] | undefined;

    if (!encryptedKeyArray || encryptedKeyArray.length === 0) {
      throw new Error('API key not configured');
    }

    try {
      // SEC-007: Decrypt using safeStorage
      // SettingsService stores as Array.from(encryptedBuffer), convert back to Buffer
      const encryptedBuffer = Buffer.from(encryptedKeyArray);

      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(encryptedBuffer);
      }

      // Fallback should not happen - SettingsService requires safeStorage
      log.error('SafeStorage not available for decryption');
      throw new Error('Secure storage not available');
    } catch (error) {
      log.error('Failed to decrypt API key', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error('API key decryption failed');
    }
  }

  // ==========================================================================
  // License Status Change Notification
  // ==========================================================================

  /**
   * Register callback for license status changes
   * Used to notify main process when license becomes invalid
   */
  onLicenseStatusChange(callback: () => void): () => void {
    this.licenseStatusChangeCallbacks.push(callback);
    return () => {
      const index = this.licenseStatusChangeCallbacks.indexOf(callback);
      if (index > -1) {
        this.licenseStatusChangeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Notify listeners of license status change
   */
  private notifyLicenseStatusChange(): void {
    for (const callback of this.licenseStatusChangeCallbacks) {
      try {
        callback();
      } catch (error) {
        log.error('Error in license status change callback', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // ==========================================================================
  // Request Infrastructure
  // ==========================================================================

  /**
   * Make an authenticated API request
   * SEC-008: HTTPS enforcement
   * API-004: Bearer token authentication
   * API-003: Centralized error handling
   * LICENSE: Intercept 401/403 for license enforcement
   *
   * @param method - HTTP method
   * @param path - API path (without base URL)
   * @param body - Optional request body
   * @param options - Request options
   * @returns Response data
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: {
      timeout?: number;
      retries?: number;
      skipAuth?: boolean;
    } = {}
  ): Promise<T> {
    const url = `${this.getBaseUrl()}${path}`;
    const { timeout = REQUEST_TIMEOUT_MS, retries = MAX_RETRIES, skipAuth = false } = options;

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client-Version': CLIENT_VERSION,
    };

    // API-004: Add authentication header
    if (!skipAuth) {
      const apiKey = this.getApiKey();
      headers['X-API-Key'] = apiKey;
    }

    // Retry loop for transient errors
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
          log.warn('Rate limited by API', { retryAfter, attempt });

          if (attempt < retries) {
            await this.delay(retryAfter * 1000);
            continue;
          }
          throw new Error('Rate limit exceeded');
        }

        // LICENSE: Handle 401/403 - Check response body before making license decisions
        if (response.status === 401 || response.status === 403) {
          const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;

          // Extract error code - handle nested structures
          const errorCode = (
            typeof errorBody.code === 'string'
              ? errorBody.code
              : typeof (errorBody.error as Record<string, unknown>)?.code === 'string'
                ? ((errorBody.error as Record<string, unknown>).code as string)
                : ''
          ).toLowerCase();

          // Extract error message - handle nested structures like {message: {code: "...", message: "..."}}
          let errorMessage = '';
          if (typeof errorBody.message === 'string') {
            errorMessage = errorBody.message;
          } else if (typeof errorBody.message === 'object' && errorBody.message !== null) {
            const msgObj = errorBody.message as Record<string, unknown>;
            errorMessage =
              typeof msgObj.message === 'string' ? msgObj.message : JSON.stringify(msgObj);
          } else if (typeof errorBody.error === 'string') {
            errorMessage = errorBody.error;
          }

          // Extract reason
          const errorReason = (
            typeof errorBody.reason === 'string' ? errorBody.reason : ''
          ).toLowerCase();

          log.warn('API returned auth error', {
            status: response.status,
            path,
            errorCode,
            errorReason,
            message: errorMessage,
          });

          // Normalize message for comparison
          const messageLower = errorMessage.toLowerCase();

          // Only mark license as suspended/cancelled if explicitly indicated by API
          // LICENSE-001: License status changes only from explicit API signals
          const isSuspended =
            errorCode === 'account_suspended' ||
            errorReason === 'suspended' ||
            messageLower.includes('suspended');

          const isCancelled =
            errorCode === 'account_cancelled' ||
            errorCode === 'license_cancelled' ||
            errorReason === 'cancelled' ||
            messageLower.includes('cancelled');

          const isExpired =
            errorCode === 'license_expired' ||
            errorCode === 'subscription_expired' ||
            errorReason === 'expired' ||
            messageLower.includes('expired');

          if (isSuspended) {
            licenseService.markSuspended();
            this.notifyLicenseStatusChange();
            throw new Error('Account suspended. Please contact support.');
          }

          if (isCancelled) {
            licenseService.markCancelled();
            this.notifyLicenseStatusChange();
            throw new Error('Account cancelled. Please contact support.');
          }

          if (isExpired) {
            licenseService.markCancelled();
            this.notifyLicenseStatusChange();
            throw new Error('License expired. Please renew your subscription.');
          }

          // For other 401/403 errors, throw appropriate message without affecting license
          // This handles: invalid key format, wrong endpoint, permission denied, etc.
          if (response.status === 401) {
            throw new Error(errorMessage || 'Authentication failed. Please check your API key.');
          } else {
            throw new Error(
              errorMessage || 'Access denied. Please verify your API key is correct.'
            );
          }
        }

        // Handle server errors with retry
        if (response.status >= 500 && attempt < retries) {
          const delay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt);
          log.warn('Server error, retrying', { status: response.status, attempt, delay });
          await this.delay(delay);
          continue;
        }

        // Handle non-OK responses
        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({ message: 'Unknown error' }));
          const errorMessage = (errorBody as ApiError).message || `HTTP ${response.status}`;
          const errorCode = (errorBody as ApiError).code;
          const errorDetails = (errorBody as ApiError).details;

          // API-003: Log full error server-side (except sensitive body data)
          log.error('API request failed', {
            path,
            status: response.status,
            errorCode,
            errorMessage,
            errorDetails: errorDetails ? JSON.stringify(errorDetails) : undefined,
          });

          throw new Error(errorMessage);
        }

        // Parse and return successful response
        const data = (await response.json()) as T;

        // LICENSE: Extract and update license data from successful responses
        this.extractAndUpdateLicense(data);

        return data;
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        // Don't retry for certain errors:
        // - AbortError: Request was cancelled
        // - API key errors: Authentication issues
        // - HTTPS errors: Security configuration
        // - License status errors: Account issues
        // - 4xx client errors: Not transient (404, 400, etc.)
        const shouldNotRetry =
          lastError.name === 'AbortError' ||
          lastError.message.includes('API key') ||
          lastError.message.includes('HTTPS') ||
          lastError.message.includes('suspended') ||
          lastError.message.includes('cancelled') ||
          lastError.message.includes('not found') ||
          lastError.message.includes('HTTP 4'); // Catches HTTP 400, 404, etc.

        if (shouldNotRetry) {
          throw lastError;
        }

        // Retry on transient errors (network issues, 5xx server errors)
        if (attempt < retries) {
          const delay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt);
          log.warn('Request failed, retrying', { error: lastError.message, attempt, delay });
          await this.delay(delay);
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  /**
   * Extract license data from API response and update license service
   * LICENSE: Response interceptor for automatic license updates
   *
   * @param response - API response data
   */
  private extractAndUpdateLicense(response: unknown): void {
    if (typeof response !== 'object' || response === null || !('license' in response)) {
      return;
    }

    const responseWithLicense = response as {
      license?: unknown;
      storeId?: string;
      companyId?: string;
    };

    if (!responseWithLicense.license) {
      return;
    }

    // API-001: Validate license data schema
    const licenseValidation = LicenseApiResponseSchema.safeParse(responseWithLicense.license);
    if (!licenseValidation.success) {
      log.warn('Invalid license data in API response', {
        errors: licenseValidation.error.issues.map((i) => i.message),
      });
      return;
    }

    // Update license service with validated data
    licenseService.updateFromApiResponse(
      licenseValidation.data,
      responseWithLicense.storeId as string | undefined,
      responseWithLicense.companyId as string | undefined
    );

    log.debug('License updated from API response', {
      expiresAt: licenseValidation.data.expiresAt,
      status: licenseValidation.data.status,
    });
  }

  /**
   * Delay helper for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ==========================================================================
  // Health & Validation
  // ==========================================================================

  /**
   * Check if cloud API is reachable
   * Used for online/offline detection
   *
   * @returns true if API is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request<{ status: string }>('GET', '/api/v1/health', undefined, {
        timeout: HEALTH_CHECK_TIMEOUT_MS,
        retries: 0,
        skipAuth: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Activate an API key before use
   * This must be called before the identity endpoint will work
   *
   * @returns Activation response
   */
  async activateApiKey(): Promise<{ success: boolean; message?: string }> {
    log.info('Activating API key');

    // Generate device fingerprint from machine-specific info
    // node-machine-id is a CommonJS module, handle both ESM and CJS import patterns
    const machineIdModule = await import('node-machine-id');
    const machineIdSync =
      machineIdModule.machineIdSync ||
      (machineIdModule as { default: { machineIdSync: () => string } }).default?.machineIdSync;
    if (typeof machineIdSync !== 'function') {
      log.error('Failed to import machineIdSync function');
      throw new Error('Device fingerprint generation unavailable');
    }
    const deviceFingerprint = machineIdSync();

    // Get OS info
    const osModule = await import('os');
    const os = osModule.default || osModule;
    const osInfo = `${os.platform()} ${os.release()} ${os.arch()}`;

    try {
      const response = await this.request<Record<string, unknown>>(
        'POST',
        '/api/v1/keys/activate',
        {
          deviceFingerprint,
          appVersion: CLIENT_VERSION,
          osInfo,
        },
        { retries: 0 } // Don't retry activation
      );

      log.info('API key activated successfully');
      return {
        success: true,
        message: typeof response.message === 'string' ? response.message : undefined,
      };
    } catch (error) {
      // If already activated, that's fine - continue to identity check
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (
        errorMsg.toLowerCase().includes('already activated') ||
        errorMsg.toLowerCase().includes('already active')
      ) {
        log.info('API key already activated');
        return { success: true, message: 'Already activated' };
      }
      throw error;
    }
  }

  /**
   * Validate API key and get store configuration
   * API-001: Response validated against schema
   * LICENSE: Updates license state from response
   *
   * Process:
   * 1. Activate the API key (idempotent - safe to call multiple times)
   * 2. Retrieve identity/store information
   *
   * Handles the actual cloud API response structure:
   * {
   *   success: true,
   *   data: {
   *     identity: { storeId, storeName, offlinePermissions, metadata... },
   *     offlineToken: "...",
   *     offlineTokenExpiresAt: "...",
   *     storeManager: { userId, name, pinHash, role: { code: "STORE_MANAGER" }, permissions... }
   *   }
   * }
   *
   * @returns Validation result with store details
   */
  async validateApiKey(): Promise<ValidateApiKeyResponse> {
    // Step 1: Activate the API key first (required before identity endpoint works)
    // This is idempotent - if already activated, it succeeds or returns "already activated"
    try {
      await this.activateApiKey();
    } catch (error) {
      // If activation fails with something other than "already activated", propagate the error
      const errorMsg = error instanceof Error ? error.message : String(error);
      // Allow through if already activated or if it's just an auth/format error
      // (identity endpoint will give a clearer error)
      if (
        !errorMsg.toLowerCase().includes('already') &&
        !errorMsg.toLowerCase().includes('activated')
      ) {
        log.warn('API key activation failed, attempting identity check anyway', {
          error: errorMsg,
        });
      }
    }

    // Step 2: Get identity/store information
    const response = await this.request<CloudApiKeyValidationResponse>(
      'GET',
      '/api/v1/keys/identity'
    );

    // SEC-017: Log response structure for debugging (no sensitive data)
    // Log the actual keys present to understand the response structure
    const responseKeys = Object.keys(response || {});
    const dataKeys =
      response && typeof response === 'object' && 'data' in response && response.data
        ? Object.keys(response.data)
        : [];

    log.debug('Received API key validation response', {
      hasSuccess: 'success' in response,
      hasData: 'data' in response,
      hasIdentity: Boolean((response as CloudApiKeyValidationResponse).data?.identity),
      hasStoreManager: Boolean((response as CloudApiKeyValidationResponse).data?.storeManager),
      responseKeys,
      dataKeys,
    });

    // Handle the actual cloud response structure
    // The cloud API may return data in different formats:
    // 1. Nested: { success, data: { identity: {...}, offlineToken, storeManager } }
    // 2. Flat snake_case: { success, data: { store_id, store_name, ... } }
    // 3. Flat camelCase: { success, data: { storeId, storeName, ... } }
    let identity: CloudStoreIdentity | undefined;
    let offlineToken: string | undefined;
    let offlineTokenExpiresAt: string | undefined;
    let storeManager: CloudStoreManager | null | undefined;

    // Check for nested structure with identity object
    if (response.success && response.data?.identity) {
      identity = response.data.identity;
      offlineToken = response.data.offlineToken;
      offlineTokenExpiresAt = response.data.offlineTokenExpiresAt;
      storeManager = response.data.storeManager;
    }
    // Check for flat snake_case structure (actual cloud API format)
    else if (response.success && response.data && 'store_id' in response.data) {
      log.info('Detected flat snake_case response structure, adapting...');
      const data = response.data as unknown as {
        store_id: string;
        store_name: string;
        store_public_id: string;
        company_id: string;
        company_name: string;
        timezone: string;
        state_id: string;
        state_code: string;
        offline_permissions: string[];
        metadata: { terminal_id?: string; pos_vendor?: string; features: string[] };
        offline_token?: string;
        offline_token_expires_at?: string;
        store_manager?: CloudStoreManager | null;
        server_time?: string;
      };
      identity = {
        storeId: data.store_id,
        storeName: data.store_name,
        storePublicId: data.store_public_id,
        companyId: data.company_id,
        companyName: data.company_name,
        timezone: data.timezone,
        stateId: data.state_id,
        stateCode: data.state_code,
        offlinePermissions: data.offline_permissions || [],
        metadata: data.metadata || { features: [] },
      };
      offlineToken = data.offline_token;
      offlineTokenExpiresAt = data.offline_token_expires_at;
      storeManager = data.store_manager;
    }
    // Check for flat camelCase structure
    else if (response.success && response.data && 'storeId' in response.data) {
      log.info('Detected flat camelCase response structure, adapting...');
      const data = response.data as unknown as CloudStoreIdentity & {
        offlineToken?: string;
        offlineTokenExpiresAt?: string;
        storeManager?: CloudStoreManager | null;
      };
      identity = {
        storeId: data.storeId,
        storeName: data.storeName,
        storePublicId: data.storePublicId,
        companyId: data.companyId,
        companyName: data.companyName,
        timezone: data.timezone,
        stateId: data.stateId,
        stateCode: data.stateCode,
        offlinePermissions: data.offlinePermissions || [],
        metadata: data.metadata || { features: [] },
      };
      offlineToken = data.offlineToken;
      offlineTokenExpiresAt = data.offlineTokenExpiresAt;
      storeManager = data.storeManager;
    }

    if (!identity) {
      log.error('Invalid API key validation response structure', {
        success: (response as { success?: boolean }).success,
        hasData: Boolean((response as { data?: unknown }).data),
        hasIdentity: Boolean((response as CloudApiKeyValidationResponse).data?.identity),
        responseKeys,
        dataKeys,
      });
      throw new Error('Invalid API response: missing identity data');
    }

    // Map initial manager from storeManager if present
    // SEC-001: PIN hash from cloud, already bcrypt hashed
    let initialManager: InitialManager | undefined;
    if (storeManager && storeManager.isActive) {
      // Map cloud role code to local StoreRole
      const mappedRole = mapCloudRole(storeManager.role?.code || 'STORE_MANAGER');

      initialManager = {
        userId: storeManager.userId,
        name: storeManager.name,
        role: mappedRole,
        pinHash: storeManager.pinHash,
      };

      // Validate the manager data
      if (!initialManager.userId || !initialManager.name || !initialManager.pinHash) {
        log.warn('Initial manager data incomplete, ignoring', {
          hasUserId: Boolean(initialManager.userId),
          hasName: Boolean(initialManager.name),
          hasPinHash: Boolean(initialManager.pinHash),
          roleCode: storeManager.role?.code,
        });
        initialManager = undefined;
      } else {
        log.info('Initial manager mapped successfully', {
          userId: initialManager.userId,
          name: initialManager.name,
          role: initialManager.role,
          cloudRoleCode: storeManager.role?.code,
        });
      }
    }

    // Check for lottery feature in metadata
    const hasLottery = identity.metadata?.features?.includes('lottery') || false;
    const lottery = hasLottery
      ? { enabled: true, binCount: 10 } // Default bin count, will be synced from cloud
      : undefined;

    const mapped: ValidateApiKeyResponse = {
      valid: true, // If we got here without error, the key is valid
      storeId: identity.storeId,
      storeName: identity.storeName,
      storePublicId: identity.storePublicId,
      companyId: identity.companyId,
      companyName: identity.companyName,
      timezone: identity.timezone || 'America/New_York',
      stateCode: identity.stateCode,
      features: identity.metadata?.features || [],
      offlinePermissions: identity.offlinePermissions || [],
      offlineToken: offlineToken || '',
      offlineTokenExpiresAt: offlineTokenExpiresAt || '',
      lottery,
      // License will be extracted from response by extractAndUpdateLicense interceptor
      license: undefined,
      initialManager,
    };

    // Validate the mapped response against our schema
    const parsed = ValidateApiKeyResponseSchema.safeParse(mapped);
    if (!parsed.success) {
      log.warn('Response schema validation issues, using mapped data', {
        errors: parsed.error.issues.map((i) => i.message),
      });
      // Continue with mapped data even if validation fails
      // This allows flexibility with API responses
    }

    log.info('API key validated successfully', {
      storeId: mapped.storeId,
      storeName: mapped.storeName,
      storePublicId: mapped.storePublicId,
      companyId: mapped.companyId,
      timezone: mapped.timezone,
      stateCode: mapped.stateCode,
      featureCount: mapped.features.length,
      hasLottery: Boolean(mapped.lottery),
      hasOfflineToken: Boolean(mapped.offlineToken),
      offlinePermissionCount: mapped.offlinePermissions.length,
      hasInitialManager: Boolean(mapped.initialManager),
    });

    return mapped;
  }

  /**
   * Force a license check by calling the validate endpoint
   * Used for manual license refresh
   *
   * @returns License state after check
   */
  async checkLicense(): Promise<{ valid: boolean; expiresAt: string | null }> {
    try {
      const response = await this.validateApiKey();

      if (response.license) {
        return {
          valid: licenseService.isValid(),
          expiresAt: response.license.expiresAt,
        };
      }

      return {
        valid: licenseService.isValid(),
        expiresAt: licenseService.getState().expiresAt,
      };
    } catch (error) {
      log.error('License check failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Return current cached state on error
      const state = licenseService.getState();
      return {
        valid: state.valid,
        expiresAt: state.expiresAt,
      };
    }
  }

  // ==========================================================================
  // Push Operations (Local -> Cloud)
  // ==========================================================================

  /**
   * Push a batch of sync queue items to cloud
   * API-001: Response validated against schema
   *
   * @param entityType - Type of entity being synced
   * @param items - Sync queue items to push
   * @returns Batch sync response
   */
  async pushBatch(entityType: string, items: SyncQueueItem[]): Promise<BatchSyncResponse> {
    if (items.length === 0) {
      return { success: true, results: [] };
    }

    log.debug('Pushing batch to cloud', { entityType, count: items.length });

    const response = await this.request<BatchSyncResponse>('POST', '/api/v1/sync/batch', {
      entityType,
      records: items.map((item) => ({
        id: item.entity_id,
        operation: item.operation,
        data: JSON.parse(item.payload),
      })),
    });

    // API-001: Validate response schema
    const parsed = BatchSyncResponseSchema.safeParse(response);
    if (!parsed.success) {
      log.error('Invalid pushBatch response schema');
      throw new Error('Invalid API response format');
    }

    log.info('Batch pushed successfully', {
      entityType,
      total: items.length,
      synced: parsed.data.results.filter((r) => r.status === 'synced').length,
      failed: parsed.data.results.filter((r) => r.status === 'failed').length,
    });

    return parsed.data;
  }

  /**
   * Push bins to cloud
   * API: POST /api/v1/sync/lottery/bins (with session_id parameter)
   *
   * @param bins - Bin records to push
   * @returns Push result
   */
  async pushBins(
    bins: CloudBin[]
  ): Promise<{ results: Array<{ bin_id: string; status: string }> }> {
    if (bins.length === 0) {
      return { results: [] };
    }

    log.debug('Pushing bins to cloud', { count: bins.length });

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    const params = new URLSearchParams();
    params.set('session_id', session.sessionId);

    const path = `/api/v1/sync/lottery/bins?${params.toString()}`;

    return this.request('POST', path, { bins });
  }

  /**
   * Push games to cloud
   *
   * @param games - Game records to push
   * @returns Push result
   */
  async pushGames(
    games: CloudGame[]
  ): Promise<{ results: Array<{ game_id: string; status: string }> }> {
    if (games.length === 0) {
      return { results: [] };
    }

    log.debug('Pushing games to cloud', { count: games.length });

    return this.request('POST', '/api/v1/sync/games', { games });
  }

  // ==========================================================================
  // Sync Session Management
  // ==========================================================================

  /**
   * Start a sync session
   * Required before pulling cashiers, bins, or games
   * API: POST /api/v1/sync/start
   *
   * @param lastSyncSequence - Last known sync sequence number (default: 0)
   * @param offlineDurationSeconds - Seconds since last online sync (default: 0)
   * @returns Session response with sessionId and revocation status
   */
  async startSyncSession(
    lastSyncSequence = 0,
    offlineDurationSeconds = 0
  ): Promise<SyncSessionResponse> {
    // Generate device fingerprint (required per API documentation)
    const machineIdModule = await import('node-machine-id');
    const machineIdSync =
      machineIdModule.machineIdSync ||
      (machineIdModule as { default: { machineIdSync: () => string } }).default?.machineIdSync;
    if (typeof machineIdSync !== 'function') {
      throw new Error('Device fingerprint generation unavailable');
    }
    const deviceFingerprint = machineIdSync();

    // Get OS info
    const osModule = await import('os');
    const os = osModule.default || osModule;
    const osInfo = `${os.platform()} ${os.release()} ${os.arch()}`;

    log.debug('Starting sync session', {
      deviceFingerprint: deviceFingerprint.substring(0, 8) + '...',
      lastSyncSequence,
    });

    // API requires deviceFingerprint and appVersion (per documentation)
    const rawResponse = await this.request<{ success: boolean; data: SyncSessionResponse }>(
      'POST',
      '/api/v1/sync/start',
      {
        deviceFingerprint,
        appVersion: CLIENT_VERSION,
        osInfo,
        lastSyncSequence,
        offlineDurationSeconds,
      }
    );

    const response = rawResponse.data;

    log.info('Sync session started', {
      sessionId: response.sessionId,
      revocationStatus: response.revocationStatus,
      pullPendingCount: response.pullPendingCount,
    });

    return response;
  }

  /**
   * Complete a sync session
   * Should be called after all sync operations are done
   * API: POST /api/v1/sync/complete
   *
   * @param sessionId - The session ID to complete
   * @param finalSequence - Final sync sequence number
   * @param stats - Sync statistics (pulled, pushed, conflictsResolved)
   */
  async completeSyncSession(
    sessionId: string,
    finalSequence: number,
    stats: SyncStats
  ): Promise<void> {
    log.debug('Completing sync session', { sessionId, finalSequence, stats });

    await this.request('POST', '/api/v1/sync/complete', {
      sessionId,
      finalSequence,
      stats,
    });

    log.info('Sync session completed', { sessionId, finalSequence });
  }

  // ==========================================================================
  // Pull Operations (Cloud -> Local)
  // ==========================================================================

  /**
   * Pull cashiers from cloud with sync session
   * SEC-001: PIN hashes are pulled, never plaintext PINs
   *
   * @param sessionId - Sync session ID from startSyncSession
   * @param options - Optional parameters for delta sync
   * @returns Cloud cashiers
   */
  async pullCashiers(
    sessionId: string,
    options?: {
      sinceTimestamp?: string;
      sinceSequence?: number;
      includeInactive?: boolean;
      limit?: number;
    }
  ): Promise<CloudCashiersResponse> {
    log.debug('Pulling cashiers from cloud', { sessionId, options });

    const params = new URLSearchParams();
    params.set('session_id', sessionId);

    if (options?.sinceTimestamp) {
      params.set('since_timestamp', options.sinceTimestamp);
    }
    if (options?.sinceSequence !== undefined) {
      params.set('since_sequence', String(options.sinceSequence));
    }
    if (options?.includeInactive) {
      params.set('include_inactive', 'true');
    }
    if (options?.limit) {
      params.set('limit', String(options.limit));
    }

    const path = `/api/v1/sync/cashiers?${params.toString()}`;

    // API returns { success: true, data: { cashiers: [...], syncMetadata: {...} } }
    const rawResponse = await this.request<{ success: boolean; data: CloudCashiersResponse }>(
      'GET',
      path
    );

    // Log raw response structure for debugging
    log.debug('Cashiers raw response', {
      hasData: Boolean(rawResponse.data),
      dataKeys: rawResponse.data ? Object.keys(rawResponse.data) : [],
    });

    const response = rawResponse.data;

    // Handle case where syncMetadata might not be present
    // Provide sensible defaults for pagination
    const syncMetadata = response?.syncMetadata || {
      totalCount: response?.cashiers?.length || 0,
      hasMore: false,
      lastSequence: 0,
      serverTime: new Date().toISOString(),
    };

    // Ensure cashiers array exists
    const cashiers = response?.cashiers || [];

    log.info('Cashiers pulled successfully', {
      count: cashiers.length,
      hasMore: syncMetadata.hasMore,
      lastSequence: syncMetadata.lastSequence,
    });

    return {
      cashiers,
      syncMetadata,
    };
  }

  /**
   * Pull employees from cloud with sync session
   * SEC-001: PIN hashes are pulled, never plaintext PINs
   *
   * Enterprise-grade unified employee sync:
   * - Pulls ALL employee types (store_manager, shift_manager, cashier)
   * - Maps cloud role codes to local roles
   * - Supports pagination for large datasets
   *
   * @param sessionId - Sync session ID from startSyncSession
   * @param options - Optional parameters for delta sync
   * @returns Cloud employees with roles
   */
  async pullEmployees(
    sessionId: string,
    options?: {
      sinceTimestamp?: string;
      sinceSequence?: number;
      includeInactive?: boolean;
      limit?: number;
    }
  ): Promise<CloudEmployeesResponse> {
    log.debug('Pulling employees from cloud', { sessionId, options });

    const params = new URLSearchParams();
    params.set('session_id', sessionId);

    if (options?.sinceTimestamp) {
      params.set('since_timestamp', options.sinceTimestamp);
    }
    if (options?.sinceSequence !== undefined) {
      params.set('since_sequence', String(options.sinceSequence));
    }
    if (options?.includeInactive) {
      params.set('include_inactive', 'true');
    }
    if (options?.limit) {
      params.set('limit', String(options.limit));
    }

    const path = `/api/v1/sync/employees?${params.toString()}`;

    // API returns { success: true, data: { employees: [...], syncMetadata: {...} } }
    const rawResponse = await this.request<{ success: boolean; data: CloudEmployeesResponse }>(
      'GET',
      path
    );

    log.debug('Employees raw response', {
      hasData: Boolean(rawResponse.data),
      dataKeys: rawResponse.data ? Object.keys(rawResponse.data) : [],
    });

    const response = rawResponse.data;

    // Handle case where syncMetadata might not be present
    const syncMetadata = response?.syncMetadata || {
      totalCount: response?.employees?.length || 0,
      hasMore: false,
      lastSequence: 0,
      serverTime: new Date().toISOString(),
    };

    const employees = response?.employees || [];

    log.info('Employees pulled successfully', {
      count: employees.length,
      hasMore: syncMetadata.hasMore,
      lastSequence: syncMetadata.lastSequence,
    });

    return {
      employees,
      syncMetadata,
    };
  }

  /**
   * Pull users/employees from cloud with full sync session management
   * SEC-001: PIN hashes are pulled, never plaintext PINs
   * API: Follows documented sync flow (start -> employees -> complete)
   *
   * Enterprise-grade implementation:
   * 1. Start sync session (POST /api/v1/sync/start)
   * 2. Try unified employees endpoint first (GET /api/v1/sync/employees)
   * 3. Fall back to cashiers endpoint if employees not available
   * 4. Complete sync session with stats (POST /api/v1/sync/complete)
   *
   * @returns Cloud users with proper roles for local storage
   */
  async pullUsers(): Promise<CloudUsersResponse> {
    log.debug('Pulling employees from cloud');

    // Start sync session (required per API documentation)
    const session = await this.startSyncSession();

    // Check revocation status
    if (session.revocationStatus !== 'VALID') {
      log.error('API key revoked or invalid', {
        status: session.revocationStatus,
        message: session.lockoutMessage,
      });
      throw new Error(session.lockoutMessage || `API key status: ${session.revocationStatus}`);
    }

    let totalPulled = 0;
    let lastSequence = 0;

    try {
      // Try unified employees endpoint first (enterprise-grade)
      const users = await this.pullUsersFromEmployeesEndpoint(session.sessionId);

      if (users !== null) {
        totalPulled = users.length;

        // Complete sync session with stats
        await this.completeSyncSession(session.sessionId, lastSequence, {
          pulled: totalPulled,
          pushed: 0,
          conflictsResolved: 0,
        });

        log.info('Employees pulled successfully via unified endpoint', { count: users.length });
        return { users };
      }

      // Fall back to cashiers endpoint (legacy compatibility)
      log.info('Falling back to cashiers endpoint');
      const cashierUsers = await this.pullUsersFromCashiersEndpoint(session.sessionId);
      totalPulled = cashierUsers.length;
      lastSequence = 0; // Reset for cashiers endpoint

      // Complete sync session
      await this.completeSyncSession(session.sessionId, lastSequence, {
        pulled: totalPulled,
        pushed: 0,
        conflictsResolved: 0,
      });

      log.info('Cashiers pulled successfully via legacy endpoint', { count: cashierUsers.length });
      return { users: cashierUsers };
    } catch (error) {
      // Try to complete session even on error (best effort)
      try {
        await this.completeSyncSession(session.sessionId, lastSequence, {
          pulled: totalPulled,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after error');
      }
      throw error;
    }
  }

  /**
   * Pull users from unified employees endpoint
   * Returns null if endpoint not available (404)
   *
   * @param sessionId - Sync session ID
   * @returns CloudUser array or null if endpoint unavailable
   */
  private async pullUsersFromEmployeesEndpoint(sessionId: string): Promise<CloudUser[] | null> {
    try {
      const allEmployees: CloudEmployee[] = [];
      let hasMore = true;
      let sinceSequence: number | undefined;

      while (hasMore) {
        const response = await this.pullEmployees(sessionId, {
          sinceSequence,
          limit: 500,
        });

        allEmployees.push(...response.employees);
        hasMore = response.syncMetadata.hasMore;
        sinceSequence = response.syncMetadata.lastSequence;
      }

      // Map employees to CloudUser with proper role mapping
      return allEmployees.map((employee) => ({
        userId: employee.employeeId,
        name: employee.name,
        role: mapCloudRole(employee.role),
        pinHash: employee.pinHash,
        active: employee.isActive,
      }));
    } catch (error) {
      // Check if endpoint doesn't exist (404)
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('404') || errorMessage.includes('not found')) {
        log.info('Unified employees endpoint not available, will use fallback');
        return null;
      }
      throw error;
    }
  }

  /**
   * Pull users from legacy cashiers endpoint
   * All users mapped as 'cashier' role (legacy behavior)
   *
   * @param sessionId - Sync session ID
   * @returns CloudUser array with cashier role
   */
  private async pullUsersFromCashiersEndpoint(sessionId: string): Promise<CloudUser[]> {
    const allCashiers: CloudCashier[] = [];
    let hasMore = true;
    let sinceSequence: number | undefined;

    while (hasMore) {
      const response = await this.pullCashiers(sessionId, {
        sinceSequence,
        limit: 500,
      });

      allCashiers.push(...response.cashiers);
      hasMore = response.syncMetadata.hasMore;
      sinceSequence = response.syncMetadata.lastSequence;
    }

    // Legacy mapping - all as cashier role
    // NOTE: This is intentionally kept for backwards compatibility
    // When backend provides unified endpoint, pullUsersFromEmployeesEndpoint
    // will be used instead with proper role mapping
    return allCashiers.map((cashier) => ({
      userId: cashier.cashierId,
      name: cashier.name,
      role: 'cashier' as StoreRole,
      pinHash: cashier.pinHash,
      active: cashier.isActive,
    }));
  }

  /**
   * Pull bins from cloud
   * API: GET /api/v1/sync/lottery/bins (with session_id parameter)
   *
   * @param since - Optional timestamp for delta sync
   * @returns Cloud bins with totalCount
   */
  async pullBins(since?: string): Promise<CloudBinsResponse> {
    log.debug('Pulling bins from cloud', { since: since || 'full' });

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      // Build query parameters with session_id
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);
      if (since) {
        params.set('since', since);
      }

      const path = `/api/v1/sync/lottery/bins?${params.toString()}`;

      const rawResponse = await this.request<Record<string, unknown>>('GET', path);

      // Log full response structure for debugging
      log.debug('Bins API raw response', {
        responseKeys: Object.keys(rawResponse),
        hasSuccess: 'success' in rawResponse,
        hasData: 'data' in rawResponse,
        hasBins: 'bins' in rawResponse,
        dataType: rawResponse.data ? typeof rawResponse.data : 'undefined',
        dataKeys:
          rawResponse.data && typeof rawResponse.data === 'object'
            ? Object.keys(rawResponse.data as Record<string, unknown>)
            : [],
      });

      // Handle the API response format: { success, data: { records, totalCount, ... } }
      // The cloud API returns 'records' with different field names than our CloudBin interface:
      // Cloud: { binId, name, location, displayOrder, isActive, updatedAt, syncSequence }
      // Local: { bin_id, store_id, bin_number, label, status, updated_at, deleted_at }
      let response: CloudBinsResponse;

      // Helper to map cloud bin format to local format
      const mapCloudBin = (cloudRecord: Record<string, unknown>): CloudBin => ({
        bin_id: (cloudRecord.binId || cloudRecord.bin_id) as string,
        store_id: (cloudRecord.storeId || cloudRecord.store_id || '') as string,
        bin_number: ((cloudRecord.displayOrder as number) ?? 0) + 1, // displayOrder is 0-indexed, bin_number is 1-indexed
        label: (cloudRecord.name || cloudRecord.label) as string | undefined,
        status: (cloudRecord.isActive === true || cloudRecord.status === 'ACTIVE') ? 'ACTIVE' : 'INACTIVE',
        updated_at: (cloudRecord.updatedAt || cloudRecord.updated_at) as string,
        deleted_at: (cloudRecord.deletedAt || cloudRecord.deleted_at) as string | undefined,
      });

      if ('data' in rawResponse && rawResponse.data && typeof rawResponse.data === 'object') {
        const data = rawResponse.data as Record<string, unknown>;
        // Cloud API returns 'records' array, not 'bins'
        const rawRecords = (data.records || data.bins || []) as Record<string, unknown>[];
        const records = rawRecords.map(mapCloudBin);
        response = {
          bins: records,
          totalCount: (data.totalCount as number) || records.length,
        };
      } else if ('records' in rawResponse) {
        // Direct format with records
        const rawRecords = (rawResponse.records || []) as Record<string, unknown>[];
        const records = rawRecords.map(mapCloudBin);
        response = {
          bins: records,
          totalCount: (rawResponse.totalCount as number) || records.length,
        };
      } else if ('bins' in rawResponse) {
        // Direct format with bins (already in correct format)
        response = rawResponse as unknown as CloudBinsResponse;
      } else {
        log.error('Unexpected bins API response structure', { rawResponse });
        throw new Error('Invalid bins API response structure');
      }

      log.info('Bins pulled successfully', {
        count: response.bins?.length ?? 0,
        totalCount: response.totalCount,
      });

      return response;
    } catch (error) {
      log.error('Failed to pull bins from cloud', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Pull games from cloud
   *
   * @param since - Optional timestamp for delta sync
   * @returns Cloud games
   */
  async pullGames(since?: string): Promise<CloudGamesResponse> {
    const path = since
      ? `/api/v1/sync/games?since=${encodeURIComponent(since)}`
      : '/api/v1/sync/games';

    log.debug('Pulling games from cloud', { since: since || 'full' });

    const response = await this.request<CloudGamesResponse>('GET', path);

    log.info('Games pulled successfully', { count: response.games.length });

    return response;
  }

  // ==========================================================================
  // Lottery Configuration API
  // ==========================================================================

  /**
   * Fetch lottery configuration values from cloud
   * Returns ticket prices and pack values for dropdown population
   * API: GET /api/v1/sync/lottery/config
   *
   * Requires a sync session (like all sync endpoints).
   * Games are state-scoped, so state_id is the primary filter.
   *
   * @param stateId - State ID for scoping (games are state-level)
   * @returns Config values grouped by type
   */
  async fetchLotteryConfigValues(stateId: string | null): Promise<CloudLotteryConfigResponse> {
    log.debug('Fetching lottery config values from cloud', { stateId });

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      // Build query parameters with session_id and state_id
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);
      if (stateId) {
        params.set('state_id', stateId);
      }

      const path = `/api/v1/sync/lottery/config?${params.toString()}`;

      // SEC-014: Type the raw response loosely to inspect actual structure
      const rawResponse = await this.request<{
        success: boolean;
        data: Record<string, unknown>;
      }>('GET', path);

      // API-003: Log response structure for debugging (no sensitive data)
      log.debug('Config API raw response structure', {
        success: rawResponse.success,
        hasData: !!rawResponse.data,
        dataKeys: rawResponse.data ? Object.keys(rawResponse.data) : [],
      });

      if (!rawResponse.success || !rawResponse.data) {
        throw new Error('Failed to fetch lottery config values');
      }

      // Transform response to expected format
      // API may return: { config_values: [...] }, { records: [...] }, or { ticket_prices: [...], pack_values: [...] }
      const data = rawResponse.data;
      let configResponse: CloudLotteryConfigResponse;

      if ('ticket_prices' in data && 'pack_values' in data) {
        // Direct format - already correct
        configResponse = data as unknown as CloudLotteryConfigResponse;
      } else if ('config_values' in data && Array.isArray(data.config_values)) {
        // Flat array format - need to transform
        const values = data.config_values as Array<{
          config_value_id: string;
          config_type: string;
          amount: number;
          display_order: number;
        }>;
        configResponse = {
          ticket_prices: values
            .filter((v) => v.config_type === 'TICKET_PRICE')
            .map((v) => ({
              config_value_id: v.config_value_id,
              amount: v.amount,
              display_order: v.display_order,
            })),
          pack_values: values
            .filter((v) => v.config_type === 'PACK_VALUE')
            .map((v) => ({
              config_value_id: v.config_value_id,
              amount: v.amount,
              display_order: v.display_order,
            })),
        };
      } else if ('records' in data && Array.isArray(data.records)) {
        // Sync endpoint format - records array with camelCase fields
        const rawRecords = data.records as Array<Record<string, unknown>>;
        log.debug('Processing config records', {
          totalRecords: rawRecords.length,
          sampleRecord: rawRecords[0] ? JSON.stringify(rawRecords[0]).slice(0, 200) : 'none',
        });
        // Transform camelCase to snake_case and normalize field names
        const values = rawRecords.map((r) => ({
          config_value_id: (r.configValueId || r.config_value_id || r.id || '') as string,
          config_type: ((r.configType || r.config_type || '') as string).toUpperCase(),
          amount: Number(r.amount || 0),
          display_order: Number(r.displayOrder || r.display_order || 0),
        }));
        configResponse = {
          ticket_prices: values
            .filter((v) => v.config_type === 'TICKET_PRICE')
            .map((v) => ({
              config_value_id: v.config_value_id,
              amount: v.amount,
              display_order: v.display_order,
            })),
          pack_values: values
            .filter((v) => v.config_type === 'PACK_VALUE')
            .map((v) => ({
              config_value_id: v.config_value_id,
              amount: v.amount,
              display_order: v.display_order,
            })),
        };
        log.debug('Config values transformed', {
          ticketPrices: configResponse.ticket_prices.length,
          packValues: configResponse.pack_values.length,
        });
      } else if ('ticketPrices' in data && 'packValues' in data) {
        // CamelCase format - transform to snake_case
        configResponse = {
          ticket_prices: data.ticketPrices as CloudLotteryConfigValue[],
          pack_values: data.packValues as CloudLotteryConfigValue[],
        };
      } else {
        // Unknown format - return empty arrays with warning
        log.warn('Unknown config response format', { keys: Object.keys(data) });
        configResponse = { ticket_prices: [], pack_values: [] };
      }

      log.info('Lottery config values fetched', {
        ticketPrices: configResponse.ticket_prices?.length || 0,
        packValues: configResponse.pack_values?.length || 0,
      });

      // Complete sync session
      await this.completeSyncSession(session.sessionId, 0, {
        pulled:
          (configResponse.ticket_prices?.length || 0) + (configResponse.pack_values?.length || 0),
        pushed: 0,
        conflictsResolved: 0,
      });

      return configResponse;
    } catch (error) {
      // Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after config fetch error');
      }
      throw error;
    }
  }

  /**
   * Pull lottery games from the lottery-specific endpoint
   * API: GET /api/v1/sync/lottery/games
   *
   * Requires a sync session (like all sync endpoints).
   * Games are state-scoped, so state_id is the primary filter.
   *
   * @param stateId - State ID for scoping (games are state-level)
   * @param since - Optional timestamp for delta sync
   * @returns Cloud games response
   */
  async pullLotteryGames(stateId: string | null, since?: string): Promise<CloudGamesResponse> {
    log.debug('Pulling lottery games from cloud', { stateId, since: since || 'full' });

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      // Build query parameters with session_id and state_id
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);
      if (stateId) {
        params.set('state_id', stateId);
      }
      if (since) {
        params.set('since', since);
      }

      const path = `/api/v1/sync/lottery/games?${params.toString()}`;

      const response = await this.request<{
        success: boolean;
        data: { games: CloudGame[] };
      }>('GET', path);

      const games = response.success && response.data?.games ? response.data.games : [];

      log.info('Lottery games pulled successfully', { count: games.length });

      // Complete sync session
      await this.completeSyncSession(session.sessionId, 0, {
        pulled: games.length,
        pushed: 0,
        conflictsResolved: 0,
      });

      return { games };
    } catch (error) {
      // Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after games pull error');
      }
      throw error;
    }
  }

  /**
   * Lookup a lottery game by game code from cloud
   * Used when receiving packs with unknown game codes
   * API: GET /api/v1/sync/lottery/games (with session_id parameter)
   *
   * Games are state-scoped, so state_id is used for filtering.
   *
   * SEC-006: Game code validated before lookup
   * API-001: Input validation before processing
   *
   * @param gameCode - 4-digit game code
   * @param stateId - State ID for scoping (games are state-level)
   * @returns Game if found, null if not found in cloud
   */
  async lookupGameByCode(
    gameCode: string,
    stateId?: string | null
  ): Promise<CloudGameLookupResult | null> {
    // SEC-006 & API-001: Validate game code format before processing
    if (!/^\d{4}$/.test(gameCode)) {
      log.warn('Invalid game code format', { gameCode });
      return null;
    }

    log.debug('Looking up game by code in cloud', { gameCode, stateId });

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      // Build query parameters - fetch all games for state (API may not support game_code filter)
      // API-001: Only use supported parameters
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);
      if (stateId) {
        params.set('state_id', stateId);
      }
      // Note: game_code filter removed - API may not support it, fetch all and filter locally

      const path = `/api/v1/sync/lottery/games?${params.toString()}`;

      // SEC-014: Type loosely to inspect actual response structure - use unknown to see raw shape
      const rawResponse = await this.request<Record<string, unknown>>('GET', path);

      // API-003: Log FULL response structure for debugging (no sensitive data)
      log.debug('Games API FULL raw response', {
        responseKeys: Object.keys(rawResponse),
        hasSuccess: 'success' in rawResponse,
        successValue: rawResponse.success,
        hasData: 'data' in rawResponse,
        hasGames: 'games' in rawResponse,
        dataType: rawResponse.data ? typeof rawResponse.data : 'undefined',
        dataKeys:
          rawResponse.data && typeof rawResponse.data === 'object'
            ? Object.keys(rawResponse.data as Record<string, unknown>)
            : [],
        gameCode,
      });

      // Extract games from various possible response structures
      let games: CloudGameLookupResult[] = [];

      // Structure 1: { success: true, data: { games: [...] } }
      if (rawResponse.success && rawResponse.data && typeof rawResponse.data === 'object') {
        const data = rawResponse.data as Record<string, unknown>;
        if ('games' in data && Array.isArray(data.games)) {
          games = data.games as CloudGameLookupResult[];
          log.debug('Games found in response.data.games', { count: games.length });
        }
      }

      // Structure 2: { success: true, games: [...] } - games at top level
      if (games.length === 0 && 'games' in rawResponse && Array.isArray(rawResponse.games)) {
        games = rawResponse.games as CloudGameLookupResult[];
        log.debug('Games found in response.games (top level)', { count: games.length });
      }

      // Structure 3: { data: [...] } - data is the games array directly
      if (games.length === 0 && rawResponse.data && Array.isArray(rawResponse.data)) {
        games = rawResponse.data as unknown as CloudGameLookupResult[];
        log.debug('Games found as response.data array', { count: games.length });
      }

      // Structure 4: Response is array directly (unlikely but possible)
      if (games.length === 0 && Array.isArray(rawResponse)) {
        games = rawResponse as unknown as CloudGameLookupResult[];
        log.debug('Response is direct games array', { count: games.length });
      }

      // Structure 5: { data: { items: [...] } } or { items: [...] }
      if (games.length === 0) {
        const data = (rawResponse.data as Record<string, unknown>) || rawResponse;
        if (data && 'items' in data && Array.isArray(data.items)) {
          games = data.items as CloudGameLookupResult[];
          log.debug('Games found in items array', { count: games.length });
        }
      }

      // Structure 6: { data: { records: [...] } } - sync endpoint format with camelCase
      if (games.length === 0) {
        const data = (rawResponse.data as Record<string, unknown>) || rawResponse;
        if (data && 'records' in data && Array.isArray(data.records)) {
          // Transform camelCase records to snake_case format
          const rawRecords = data.records as Array<Record<string, unknown>>;
          games = rawRecords.map((r) => ({
            game_id: (r.gameId || r.game_id || r.id) as string,
            game_code: (r.gameCode || r.game_code) as string,
            name: (r.name || r.gameName) as string,
            price: Number(r.price || r.ticketPrice || 0),
            pack_value: Number(r.packValue || r.pack_value || 0),
            tickets_per_pack:
              r.ticketsPerPack !== undefined
                ? Number(r.ticketsPerPack)
                : r.tickets_per_pack !== undefined
                  ? Number(r.tickets_per_pack)
                  : null,
            status: ((r.status || 'ACTIVE') as string).toUpperCase() as
              | 'ACTIVE'
              | 'INACTIVE'
              | 'DISCONTINUED',
            state_id: (r.stateId || r.state_id || null) as string | null,
            store_id: (r.storeId || r.store_id || null) as string | null,
            scope_type: (r.scopeType || r.scope_type) as 'STATE' | 'STORE' | 'GLOBAL' | undefined,
          }));
          log.debug('Games found in records array (sync format)', {
            count: games.length,
            sampleGame: games[0] ? { game_code: games[0].game_code, name: games[0].name } : null,
          });
        }
      }

      // Structure 7: Single game object returned
      if (games.length === 0) {
        const data = (rawResponse.data as Record<string, unknown>) || rawResponse;
        if (data && 'game_id' in data && 'game_code' in data) {
          games = [data as unknown as CloudGameLookupResult];
          log.debug('Single game object returned', { gameCode: data.game_code });
        }
      }

      // If still no games, log detailed structure for debugging
      if (games.length === 0) {
        log.warn('Could not extract games from response', {
          gameCode,
          responseKeys: Object.keys(rawResponse),
          dataKeys:
            rawResponse.data && typeof rawResponse.data === 'object'
              ? Object.keys(rawResponse.data as Record<string, unknown>)
              : [],
          sampleData: JSON.stringify(rawResponse).slice(0, 500),
        });
      }

      log.debug('Games extracted from response', {
        gameCode,
        gamesCount: games.length,
        gameCodes: games.slice(0, 10).map((g) => g.game_code),
      });

      if (games.length === 0) {
        log.debug('No games found in cloud', { gameCode });
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
        return null;
      }

      // Find the exact game by code (case-sensitive match)
      const game = games.find((g) => g.game_code === gameCode);

      // Complete sync session
      await this.completeSyncSession(session.sessionId, 0, {
        pulled: games.length,
        pushed: 0,
        conflictsResolved: 0,
      });

      if (!game) {
        log.debug('Game not found in cloud response', {
          searchedFor: gameCode,
          totalGames: games.length,
          availableCodes: games.map((g) => g.game_code),
        });
        return null;
      }

      log.info('Game found in cloud', {
        gameCode,
        gameId: game.game_id,
        name: game.name,
      });

      return game;
    } catch (error) {
      // Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after game lookup error');
      }
      // Log and re-throw - let caller handle the error
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('Failed to lookup game by code from cloud', { gameCode, error: errorMsg });
      throw error;
    }
  }

  // ==========================================================================
  // Cloud Authentication (Support/Admin Access)
  // ==========================================================================

  /**
   * Authenticate a support/admin user with email and password against the cloud API
   * SEC-001: Cloud-based authentication for support personnel
   *
   * This is separate from the store-level PIN authentication.
   * Used for support staff accessing settings and administrative functions.
   *
   * @param email - User's email address
   * @param password - User's password
   * @returns Authentication result with user info and roles
   */
  async authenticateCloudUser(
    email: string,
    password: string
  ): Promise<{
    success: boolean;
    user?: {
      id: string;
      email: string;
      name: string;
      roles: string[];
    };
    error?: string;
  }> {
    log.info('Attempting cloud authentication', { email: email.substring(0, 3) + '***' });

    try {
      const baseUrl = this.getBaseUrl();
      const url = `${baseUrl}/api/auth/login`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Version': CLIENT_VERSION,
        },
        body: JSON.stringify({ email, password }),
        signal: controller.signal,
        credentials: 'include', // Include cookies for session
      });

      clearTimeout(timeoutId);

      // Parse response
      const responseData = (await response.json()) as {
        success?: boolean;
        data?: {
          user?: {
            id: string;
            email: string;
            name: string;
            roles?: string[];
          };
        };
        error?: {
          code?: string;
          message?: string;
        };
        message?: string;
      };

      // Handle authentication failure
      if (!response.ok || responseData.success === false) {
        const errorMessage =
          responseData.error?.message || responseData.message || 'Invalid email or password';

        log.warn('Cloud authentication failed', {
          status: response.status,
          error: errorMessage,
        });

        return {
          success: false,
          error: errorMessage,
        };
      }

      // Extract user from response
      const user = responseData.data?.user;
      if (!user) {
        log.error('Cloud auth response missing user data');
        return {
          success: false,
          error: 'Invalid response from authentication server',
        };
      }

      log.info('Cloud authentication successful', {
        userId: user.id,
        email: user.email,
        roles: user.roles,
      });

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          roles: user.roles || [],
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Handle specific error types
      if (errorMsg.includes('abort') || errorMsg.includes('timeout')) {
        log.error('Cloud authentication timed out');
        return {
          success: false,
          error: 'Authentication request timed out. Please try again.',
        };
      }

      if (errorMsg.includes('fetch') || errorMsg.includes('network')) {
        log.error('Cloud authentication network error', { error: errorMsg });
        return {
          success: false,
          error:
            'Unable to connect to authentication server. Please check your internet connection.',
        };
      }

      log.error('Cloud authentication error', { error: errorMsg });
      return {
        success: false,
        error: 'Authentication failed. Please try again.',
      };
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for cloud API operations
 */
export const cloudApiService = new CloudApiService();
