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
  status: 'ACTIVE' | 'INACTIVE';
  updated_at: string;
}

/**
 * Bins sync response
 */
export interface CloudBinsResponse {
  bins: CloudBin[];
}

/**
 * Games sync response
 */
export interface CloudGamesResponse {
  games: CloudGame[];
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

        // Don't retry for certain errors
        if (
          lastError.name === 'AbortError' ||
          lastError.message.includes('API key') ||
          lastError.message.includes('HTTPS') ||
          lastError.message.includes('suspended') ||
          lastError.message.includes('cancelled')
        ) {
          throw lastError;
        }

        // Retry on network errors
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

    return this.request('POST', '/api/v1/sync/bins', { bins });
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
   * Pull users/cashiers from cloud with full sync session management
   * SEC-001: PIN hashes are pulled, never plaintext PINs
   * API: Follows documented sync flow (start -> cashiers -> complete)
   *
   * This method handles the complete sync flow per API documentation:
   * 1. Start sync session (POST /api/v1/sync/start)
   * 2. Pull all cashiers with pagination (GET /api/v1/sync/cashiers)
   * 3. Complete sync session with stats (POST /api/v1/sync/complete)
   *
   * @returns Cloud users in legacy format for local storage
   */
  async pullUsers(): Promise<CloudUsersResponse> {
    log.debug('Pulling cashiers from cloud');

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
      // Pull all cashiers with pagination
      const allCashiers: CloudCashier[] = [];
      let hasMore = true;
      let sinceSequence: number | undefined;

      while (hasMore) {
        const response = await this.pullCashiers(session.sessionId, {
          sinceSequence,
          limit: 500, // API max is 500
        });

        allCashiers.push(...response.cashiers);
        hasMore = response.syncMetadata.hasMore;
        lastSequence = response.syncMetadata.lastSequence;
        // Use lastSequence for next page
        sinceSequence = lastSequence;
      }

      totalPulled = allCashiers.length;

      // Complete sync session with stats (required per API documentation)
      await this.completeSyncSession(session.sessionId, lastSequence, {
        pulled: totalPulled,
        pushed: 0,
        conflictsResolved: 0,
      });

      // Convert to legacy format
      const users: CloudUser[] = allCashiers.map((cashier) => ({
        userId: cashier.cashierId,
        name: cashier.name,
        role: 'cashier' as StoreRole,
        pinHash: cashier.pinHash,
        active: cashier.isActive,
      }));

      log.info('Cashiers pulled successfully', { count: users.length });

      return { users };
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
   * Pull bins from cloud
   *
   * @param since - Optional timestamp for delta sync
   * @returns Cloud bins
   */
  async pullBins(since?: string): Promise<CloudBinsResponse> {
    const path = since
      ? `/api/v1/sync/bins?since=${encodeURIComponent(since)}`
      : '/api/v1/sync/bins';

    log.debug('Pulling bins from cloud', { since: since || 'full' });

    const response = await this.request<CloudBinsResponse>('GET', path);

    log.info('Bins pulled successfully', { count: response.bins.length });

    return response;
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
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for cloud API operations
 */
export const cloudApiService = new CloudApiService();
