const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/main/services/cloud-api.service.ts');

const content = `/**
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
import {
  licenseService,
  LicenseApiResponseSchema,
  type LicenseApiResponse,
} from './license.service';
import type { SyncQueueItem } from '../dal/sync-queue.dal';

// ============================================================================
// Types
// ============================================================================

/**
 * API response wrapper
 */
interface ApiResponse<T> {
  data: T;
  success: boolean;
}

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
 * User from cloud sync
 */
export interface CloudUser {
  userId: string;
  name: string;
  role: 'CASHIER' | 'MANAGER' | 'ADMIN';
  pinHash: string;
  active: boolean;
}

/**
 * Cloud users response
 */
export interface CloudUsersResponse {
  users: CloudUser[];
}

/**
 * License object in API response
 */
export interface LicenseInfo {
  expiresAt: string;
  status: 'active' | 'past_due' | 'cancelled' | 'suspended';
}

/**
 * Validation response from API key check
 * Updated to include license information per Phase 1
 */
export interface ValidateApiKeyResponse {
  valid: boolean;
  storeId: string;
  storeName: string;
  companyId: string;
  companyName: string;
  timezone: string;
  features: string[];
  lottery?: {
    enabled: boolean;
    binCount: number;
  };
  /** License information for enforcement */
  license?: LicenseInfo;
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
const DEFAULT_API_URL = 'https://api.nuvanaapp.com';

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
 * License info schema for validation
 * API-001: Schema validation for license data
 */
const LicenseInfoSchema = z.object({
  expiresAt: z.string().datetime(),
  status: z.enum(['active', 'past_due', 'cancelled', 'suspended']),
});

const ValidateApiKeyResponseSchema = z.object({
  valid: z.boolean(),
  storeId: z.string(),
  storeName: z.string(),
  companyId: z.string(),
  companyName: z.string(),
  timezone: z.string(),
  features: z.array(z.string()),
  lottery: z
    .object({
      enabled: z.boolean(),
      binCount: z.number(),
    })
    .optional(),
  license: LicenseInfoSchema.optional(),
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
    this.configStore = new Store({ name: 'nuvana-config' });
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Get the base URL for API requests
   * SEC-008: Enforce HTTPS
   */
  private getBaseUrl(): string {
    const url = (this.configStore.get('apiUrl') as string) || DEFAULT_API_URL;

    // SEC-008: Enforce HTTPS
    if (!url.startsWith('https://')) {
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
    const encryptedKey = this.configStore.get('apiKey') as string | undefined;

    if (!encryptedKey) {
      throw new Error('API key not configured');
    }

    try {
      // SEC-007: Decrypt using safeStorage
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(encryptedKey, 'base64'));
      }
      // Fallback for development (unencrypted)
      return encryptedKey;
    } catch (error) {
      log.error('Failed to decrypt API key');
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
    const url = \`\${this.getBaseUrl()}\${path}\`;
    const { timeout = REQUEST_TIMEOUT_MS, retries = MAX_RETRIES, skipAuth = false } = options;

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client-Version': CLIENT_VERSION,
    };

    // API-004: Add authentication header
    if (!skipAuth) {
      const apiKey = this.getApiKey();
      headers['Authorization'] = \`Bearer \${apiKey}\`;
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

        // LICENSE: Handle 401 - Suspended account (immediate revocation)
        if (response.status === 401) {
          log.warn('API returned 401 - marking license as suspended', { path });
          licenseService.markSuspended();
          this.notifyLicenseStatusChange();
          throw new Error('Account suspended. Please contact support.');
        }

        // LICENSE: Handle 403 - Cancelled account (immediate revocation)
        if (response.status === 403) {
          log.warn('API returned 403 - marking license as cancelled', { path });
          licenseService.markCancelled();
          this.notifyLicenseStatusChange();
          throw new Error('Account cancelled. Please contact support.');
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
          const errorMessage = (errorBody as ApiError).message || \`HTTP \${response.status}\`;

          // API-003: Log full error server-side, return sanitized message
          log.error('API request failed', {
            path,
            status: response.status,
            // Don't log sensitive request body details
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
    if (
      typeof response !== 'object' ||
      response === null ||
      !('license' in response)
    ) {
      return;
    }

    const responseWithLicense = response as { license?: unknown; storeId?: string; companyId?: string };

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
      await this.request<{ status: string }>(
        'GET',
        '/v1/health',
        undefined,
        { timeout: HEALTH_CHECK_TIMEOUT_MS, retries: 0, skipAuth: true }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate API key and get store configuration
   * API-001: Response validated against schema
   * LICENSE: Updates license state from response
   *
   * @returns Validation result with store details
   */
  async validateApiKey(): Promise<ValidateApiKeyResponse> {
    const response = await this.request<ValidateApiKeyResponse>('GET', '/v1/sync/validate');

    // API-001: Validate response schema
    const parsed = ValidateApiKeyResponseSchema.safeParse(response);
    if (!parsed.success) {
      log.error('Invalid validateApiKey response schema', {
        errors: parsed.error.issues.map((i) => i.message),
      });
      throw new Error('Invalid API response format');
    }

    log.info('API key validated successfully', {
      storeId: parsed.data.storeId,
      storeName: parsed.data.storeName,
      hasLicense: Boolean(parsed.data.license),
    });

    return parsed.data;
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

    const response = await this.request<BatchSyncResponse>('POST', '/v1/sync/batch', {
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
  async pushBins(bins: CloudBin[]): Promise<{ results: Array<{ bin_id: string; status: string }> }> {
    if (bins.length === 0) {
      return { results: [] };
    }

    log.debug('Pushing bins to cloud', { count: bins.length });

    return this.request('POST', '/v1/sync/bins', { bins });
  }

  /**
   * Push games to cloud
   *
   * @param games - Game records to push
   * @returns Push result
   */
  async pushGames(games: CloudGame[]): Promise<{ results: Array<{ game_id: string; status: string }> }> {
    if (games.length === 0) {
      return { results: [] };
    }

    log.debug('Pushing games to cloud', { count: games.length });

    return this.request('POST', '/v1/sync/games', { games });
  }

  // ==========================================================================
  // Pull Operations (Cloud -> Local)
  // ==========================================================================

  /**
   * Pull users from cloud
   * SEC-001: PIN hashes are pulled, never plaintext PINs
   *
   * @returns Cloud users
   */
  async pullUsers(): Promise<CloudUsersResponse> {
    log.debug('Pulling users from cloud');

    const response = await this.request<CloudUsersResponse>('GET', '/v1/sync/users');

    log.info('Users pulled successfully', { count: response.users.length });

    return response;
  }

  /**
   * Pull bins from cloud
   *
   * @param since - Optional timestamp for delta sync
   * @returns Cloud bins
   */
  async pullBins(since?: string): Promise<CloudBinsResponse> {
    const path = since ? \`/v1/sync/bins?since=\${encodeURIComponent(since)}\` : '/v1/sync/bins';

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
    const path = since ? \`/v1/sync/games?since=\${encodeURIComponent(since)}\` : '/v1/sync/games';

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
`;

fs.writeFileSync(filePath, content, 'utf8');
console.log('Updated cloud-api.service.ts successfully');
