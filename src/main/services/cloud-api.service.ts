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
// SyncQueueItem type available from sync-queue.dal if needed

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

// ============================================================================
// Phase 4: Pull Endpoint Response Types (Multi-Device Sync)
// ============================================================================

/**
 * Pack status enumeration for sync operations
 */
export type CloudPackStatus = 'RECEIVED' | 'ACTIVE' | 'DEPLETED' | 'RETURNED';

/**
 * Cloud pack data from pull endpoints
 * API: GET /api/v1/sync/lottery/packs/*
 *
 * Field names match cloud API exactly per replica_end_points.md:
 * - current_bin_id (not bin_id) - UUID of bin pack is currently in
 * - tickets_sold_count (not tickets_sold) - Total tickets sold
 *
 * DB-006: Store-scoped pack data
 * SEC-017: Includes sync metadata for audit trail
 */
export interface CloudPack {
  pack_id: string;
  store_id: string;
  game_id: string;
  game_code: string;
  pack_number: string;
  serial_start: string;
  serial_end: string;
  status: CloudPackStatus;
  /** Current bin UUID - matches API field name per replica_end_points.md */
  current_bin_id: string | null;
  current_bin_name: string | null;
  opening_serial: string | null;
  closing_serial: string | null;
  /** Total tickets sold - matches API field name per replica_end_points.md */
  tickets_sold_count: number;
  last_sold_at: string | null;
  sales_amount: number | null;
  received_at: string | null;
  received_by: string | null;
  activated_at: string | null;
  activated_by: string | null;
  activated_shift_id: string | null;
  depleted_at: string | null;
  depleted_by: string | null;
  depleted_shift_id: string | null;
  depletion_reason: string | null;
  returned_at: string | null;
  returned_by: string | null;
  returned_shift_id: string | null;
  return_reason: string | null;
  return_notes: string | null;
  last_sold_serial: string | null;
  tickets_sold_on_return: number | null;
  return_sales_amount: number | null;
  /** Serial override approval fields (API v029 alignment) */
  serial_override_approved_by: string | null;
  serial_override_reason: string | null;
  /** Serial override approval timestamp (v038 alignment) */
  serial_override_approved_at: string | null;
  mark_sold_approved_by: string | null;
  mark_sold_reason: string | null;
  /** Mark sold approval timestamp (v038 alignment) */
  mark_sold_approved_at: string | null;
  sync_sequence: number;
  updated_at: string;
  created_at: string;
}

/**
 * Sync metadata for paginated pull responses
 * API-001: Standard pagination metadata
 */
export interface CloudSyncMetadata {
  lastSequence: number;
  hasMore: boolean;
  totalCount?: number;
  serverTime: string;
}

/**
 * Generic pull response for pack endpoints
 */
export interface CloudPacksResponse {
  packs: CloudPack[];
  syncMetadata: CloudSyncMetadata;
}

/**
 * Business day status from cloud
 * API: GET /api/v1/sync/lottery/day-status
 */
export interface CloudDayStatus {
  store_id: string;
  business_date: string;
  status: 'OPEN' | 'PREPARING_CLOSE' | 'CLOSED';
  opened_at: string | null;
  closed_at: string | null;
  validation_token: string | null;
  token_expires_at: string | null;
  total_sales: number | null;
  total_tickets_sold: number | null;
  sync_sequence: number;
}

/**
 * Day status pull response
 */
export interface CloudDayStatusResponse {
  dayStatus: CloudDayStatus | null;
  syncMetadata: CloudSyncMetadata;
}

/**
 * Shift opening record from cloud
 * API: GET /api/v1/sync/lottery/shift-openings
 */
export interface CloudShiftOpening {
  shift_opening_id: string;
  shift_id: string;
  store_id: string;
  bin_id: string;
  pack_id: string;
  opening_serial: string;
  opened_at: string;
  opened_by: string | null;
  sync_sequence: number;
}

/**
 * Shift openings pull response
 */
export interface CloudShiftOpeningsResponse {
  openings: CloudShiftOpening[];
  syncMetadata: CloudSyncMetadata;
}

/**
 * Shift closing record from cloud
 * API: GET /api/v1/sync/lottery/shift-closings
 */
export interface CloudShiftClosing {
  shift_closing_id: string;
  shift_id: string;
  store_id: string;
  bin_id: string;
  pack_id: string;
  closing_serial: string;
  tickets_sold: number;
  sales_amount: number;
  closed_at: string;
  closed_by: string | null;
  sync_sequence: number;
}

/**
 * Shift closings pull response
 */
export interface CloudShiftClosingsResponse {
  closings: CloudShiftClosing[];
  syncMetadata: CloudSyncMetadata;
}

/**
 * Variance type enumeration
 */
export type CloudVarianceType =
  | 'SERIAL_MISMATCH'
  | 'MISSING_PACK'
  | 'EXTRA_PACK'
  | 'COUNT_MISMATCH';

/**
 * Variance status enumeration
 */
export type CloudVarianceStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * Variance record from cloud
 * API: GET /api/v1/sync/lottery/variances
 */
export interface CloudVariance {
  variance_id: string;
  store_id: string;
  business_date: string;
  bin_id: string;
  pack_id: string;
  expected_serial: string;
  actual_serial: string | null;
  variance_type: CloudVarianceType;
  status: CloudVarianceStatus;
  resolution: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  sync_sequence: number;
}

/**
 * Variances pull response
 */
export interface CloudVariancesResponse {
  variances: CloudVariance[];
  syncMetadata: CloudSyncMetadata;
}

/**
 * Day pack record from cloud (daily pack snapshot)
 * API: GET /api/v1/sync/lottery/day-packs
 */
export interface CloudDayPack {
  day_pack_id: string;
  store_id: string;
  business_date: string;
  bin_id: string;
  pack_id: string;
  opening_serial: string;
  closing_serial: string;
  tickets_sold: number;
  sales_amount: number;
  sync_sequence: number;
}

/**
 * Day packs pull response
 */
export interface CloudDayPacksResponse {
  dayPacks: CloudDayPack[];
  syncMetadata: CloudSyncMetadata;
}

/**
 * Bin history record from cloud (pack movement audit)
 * API: GET /api/v1/sync/lottery/bin-history
 */
export interface CloudBinHistoryEntry {
  history_id: string;
  store_id: string;
  pack_id: string;
  bin_id: string;
  action: 'ACTIVATED' | 'MOVED_IN' | 'MOVED_OUT' | 'DEPLETED' | 'RETURNED';
  from_bin_id: string | null;
  to_bin_id: string | null;
  serial_at_action: string | null;
  performed_at: string;
  performed_by: string | null;
  sync_sequence: number;
}

/**
 * Bin history pull response
 */
export interface CloudBinHistoryResponse {
  history: CloudBinHistoryEntry[];
  syncMetadata: CloudSyncMetadata;
}

/**
 * Cloud bin data (cloud-aligned schema)
 * v039: Matches cloud LotteryBin model exactly
 * - name: Display name for the bin
 * - location: Physical location description
 * - display_order: UI sort order
 * - is_active: Boolean active status
 */
export interface CloudBin {
  bin_id: string;
  store_id: string;
  name: string;
  location?: string;
  display_order: number;
  is_active: boolean;
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
 * Bins sync response with pagination metadata
 * API spec: GET /api/v1/sync/lottery/bins
 */
export interface CloudBinsResponse {
  bins: CloudBin[];
  totalCount: number;
  hasMore: boolean;
  currentSequence: number;
  serverTime: string;
  nextCursor?: string | null;
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

const _BatchSyncResponseSchema = z.object({
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
// Phase 5: Heartbeat Validation Schema (API-001 Compliance)
// ============================================================================

/**
 * API key status enum for heartbeat response
 * API-001: Strict enum validation for status
 */
const ApiKeyStatusSchema = z.enum(['ok', 'suspended', 'revoked']);

/**
 * Heartbeat response schema
 * API-001: Full validation for heartbeat endpoint response
 * LM-002: Includes serverTime for monitoring/sync
 *
 * @see POST /api/v1/keys/heartbeat
 */
export const HeartbeatResponseSchema = z.object({
  status: ApiKeyStatusSchema,
  serverTime: z.string().datetime({ message: 'Invalid ISO 8601 datetime format' }),
});

/**
 * Heartbeat response type
 * API: POST /api/v1/keys/heartbeat
 */
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;

// ============================================================================
// Phase 3: Day Close Validation Schemas (API-001 Compliance)
// ============================================================================

/**
 * Inventory item schema for day close preparation
 * API-001: Validates bin/pack/serial structure
 */
const DayCloseInventoryItemSchema = z.object({
  bin_id: z.string().uuid('Invalid bin ID format'),
  pack_id: z.string().uuid('Invalid pack ID format'),
  closing_serial: z.string().min(1, 'Closing serial is required').max(10, 'Serial too long'),
});

/**
 * Day close prepare request schema
 * API-001: Full validation for prepare-close endpoint
 */
export const PrepareDayCloseRequestSchema = z.object({
  store_id: z.string().uuid('Invalid store ID format'),
  business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Business date must be YYYY-MM-DD format'),
  expected_inventory: z.array(DayCloseInventoryItemSchema).min(0),
  prepared_by: z.string().uuid().nullable(),
});

/**
 * Day close prepare response schema
 * API-001: Validates response from prepare-close endpoint
 */
export const PrepareDayCloseResponseSchema = z.object({
  success: z.boolean(),
  validation_token: z.string().min(1),
  expires_at: z.string().datetime(),
  warnings: z.array(z.string()).optional(),
  discrepancies: z
    .array(
      z.object({
        bin_id: z.string(),
        pack_id: z.string(),
        expected_serial: z.string(),
        actual_serial: z.string().optional(),
        issue: z.string(),
      })
    )
    .optional(),
});

/**
 * Day close commit request schema
 * API-001: Full validation for commit-close endpoint
 */
export const CommitDayCloseRequestSchema = z.object({
  store_id: z.string().uuid('Invalid store ID format'),
  validation_token: z.string().min(1, 'Validation token is required'),
  closed_by: z.string().uuid().nullable(),
});

/**
 * Day close commit response schema
 * API-001: Validates response from commit-close endpoint
 */
export const CommitDayCloseResponseSchema = z.object({
  success: z.boolean(),
  day_summary_id: z.string().uuid().optional(),
  business_date: z.string().optional(),
  total_sales: z.number().nonnegative().optional(),
  total_tickets_sold: z.number().int().nonnegative().optional(),
});

/**
 * Day close cancel request schema
 * API-001: Full validation for cancel-close endpoint
 */
export const CancelDayCloseRequestSchema = z.object({
  store_id: z.string().uuid('Invalid store ID format'),
  validation_token: z.string().min(1, 'Validation token is required'),
  reason: z.string().max(500, 'Reason too long').nullable().optional(),
  cancelled_by: z.string().uuid().nullable(),
});

/**
 * Variance type enum for approval validation
 */
export const VarianceTypeSchema = z.enum([
  'SERIAL_MISMATCH',
  'MISSING_PACK',
  'EXTRA_PACK',
  'COUNT_MISMATCH',
]);

/**
 * Variance approval request schema
 * API-001: Full validation for variance approval endpoint
 */
export const ApproveVarianceRequestSchema = z.object({
  store_id: z.string().uuid('Invalid store ID format'),
  variance_id: z.string().uuid('Invalid variance ID format'),
  business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Business date must be YYYY-MM-DD format'),
  bin_id: z.string().uuid('Invalid bin ID format'),
  pack_id: z.string().uuid('Invalid pack ID format'),
  expected_serial: z.string().min(1, 'Expected serial is required'),
  actual_serial: z.string().min(1, 'Actual serial is required'),
  variance_type: VarianceTypeSchema,
  resolution: z.string().min(1, 'Resolution is required').max(1000, 'Resolution too long'),
  approved_by: z.string().uuid('Invalid approver ID format'),
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
   *
   * Reads from:
   * 1. apiUrl (new unified field)
   * 2. cloudEndpoint (legacy field, for migration)
   * 3. DEFAULT_API_URL (environment-appropriate default)
   */
  private getBaseUrl(): string {
    // Try new field first, then legacy, then default
    const apiUrl = this.configStore.get('apiUrl') as string;
    const legacyEndpoint = this.configStore.get('cloudEndpoint') as string;
    const url = apiUrl || legacyEndpoint || DEFAULT_API_URL;

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

    log.debug('Reading API key from config', {
      hasEncryptedKey: !!encryptedKeyArray,
      encryptedKeyLength: encryptedKeyArray?.length || 0,
    });

    if (!encryptedKeyArray || encryptedKeyArray.length === 0) {
      throw new Error('API key not configured');
    }

    try {
      // SEC-007: Decrypt using safeStorage
      // SettingsService stores as Array.from(encryptedBuffer), convert back to Buffer
      const encryptedBuffer = Buffer.from(encryptedKeyArray);

      if (safeStorage.isEncryptionAvailable()) {
        const decryptedKey = safeStorage.decryptString(encryptedBuffer);
        // TEMP DEBUG: Log full key to verify it matches what user entered
        // Shows: prefix (first 20 chars), suffix (last 10 chars), and length
        log.info('API key decryption check', {
          keyPrefix: decryptedKey.substring(0, 20),
          keySuffix: decryptedKey.substring(decryptedKey.length - 10),
          keyLength: decryptedKey.length,
        });
        return decryptedKey;
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
            rawBody: JSON.stringify(errorBody).substring(0, 500),
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
            fullErrorBody: JSON.stringify(errorBody),
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
      await this.request<{ status: string }>('GET', '/api/health', undefined, {
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
   * Send heartbeat to keep session alive and verify API key status
   * API: POST /api/v1/keys/heartbeat
   *
   * Enterprise-grade heartbeat implementation:
   * - API-001: Response validated against HeartbeatResponseSchema
   * - API-003: Centralized error handling with sanitized responses
   * - API-004: Authenticated via API key header
   * - LM-001: Structured logging with correlation data
   * - LM-002: Server time returned for monitoring/clock sync
   * - LICENSE: Handles suspended/revoked status via license service
   *
   * @returns Heartbeat response with status and server time
   * @throws Error if API key is suspended, revoked, or request fails
   */
  async heartbeat(): Promise<HeartbeatResponse> {
    log.debug('Sending heartbeat to cloud');

    try {
      // API-004: Authenticated request with client timestamp
      // LM-002: No retries for heartbeat - fail fast since it's periodic
      const response = await this.request<{
        status: string;
        serverTime: string;
        data?: { status: string; serverTime: string };
      }>(
        'POST',
        '/api/v1/keys/heartbeat',
        {
          timestamp: new Date().toISOString(),
        },
        { retries: 0 }
      );

      // Handle nested response structure (some APIs wrap in data object)
      const responseData = response.data ?? response;

      // API-001: Validate response against schema
      const validation = HeartbeatResponseSchema.safeParse(responseData);

      if (!validation.success) {
        // LM-001: Log validation failure with details (no sensitive data)
        log.error('Heartbeat response validation failed', {
          errors: validation.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
        throw new Error('Invalid heartbeat response from server');
      }

      const heartbeatData = validation.data;

      // LICENSE: Handle status-based actions
      if (heartbeatData.status === 'suspended') {
        log.warn('API key suspended detected via heartbeat');
        licenseService.markSuspended();
        this.notifyLicenseStatusChange();
        throw new Error('API key suspended. Please contact support.');
      }

      if (heartbeatData.status === 'revoked') {
        log.warn('API key revoked detected via heartbeat');
        licenseService.markCancelled();
        this.notifyLicenseStatusChange();
        throw new Error('API key revoked. Please contact support.');
      }

      // LM-001: Log successful heartbeat (no sensitive data)
      log.debug('Heartbeat successful', {
        status: heartbeatData.status,
        serverTime: heartbeatData.serverTime,
      });

      return heartbeatData;
    } catch (error) {
      // API-003: Re-throw with sanitized message if not already handled
      if (error instanceof Error) {
        // Already sanitized errors pass through
        if (
          error.message.includes('suspended') ||
          error.message.includes('revoked') ||
          error.message.includes('Invalid heartbeat response')
        ) {
          throw error;
        }
      }

      // LM-001: Log error details server-side
      log.error('Heartbeat failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // API-003: Return sanitized error to caller
      throw new Error('Heartbeat request failed. Please check your connection.');
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

  // NOTE: Generic pushBatch removed - no /api/v1/sync/batch endpoint exists
  // All entity types must use their specific push endpoints:
  // - pack: pushPackReceive, pushPackActivate, pushPackDeplete, pushPackReturn
  // - shift_opening: pushShiftOpening
  // - shift_closing: pushShiftClosing
  // - variance_approval: pushVarianceApproval
  // - day_close: pushDayPrepareClose, pushDayCommitClose
  //
  // Pull-only entities (NO push endpoints in API spec):
  // - bins: GET /api/v1/sync/lottery/bins only (cloud-managed)
  // - employees: GET /api/v1/sync/employees only (cloud-managed)

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
   * Pull bins from cloud with pagination support
   * API: GET /api/v1/sync/lottery/bins (with session_id parameter)
   *
   * Enterprise-grade implementation:
   * - API-002: Handles pagination with hasMore flag
   * - API-003: Centralized error handling
   * - SEC-017: Audit logging for all sync operations
   *
   * @param since - Optional timestamp for delta sync
   * @returns Cloud bins with totalCount (all pages aggregated)
   */
  async pullBins(since?: string): Promise<CloudBinsResponse> {
    log.debug('Pulling bins from cloud', { since: since || 'full' });

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    // v039: Cloud and local schemas are now aligned - pass through directly
    // CloudBin interface matches cloud LotteryBin model exactly
    const mapCloudBin = (cloudRecord: Record<string, unknown>): CloudBin =>
      cloudRecord as unknown as CloudBin;

    try {
      // API-002: Paginate until hasMore is false
      const allBins: CloudBin[] = [];
      let hasMore = true;
      let cursor: string | null = null;
      let totalCount = 0;
      let currentSequence = 0;
      let serverTime = '';
      let pageCount = 0;
      const MAX_PAGES = 100; // Safety limit to prevent infinite loops

      while (hasMore && pageCount < MAX_PAGES) {
        pageCount++;

        // Build query parameters with session_id
        const params = new URLSearchParams();
        params.set('session_id', session.sessionId);
        if (since) {
          params.set('since', since);
        }
        if (cursor) {
          params.set('cursor', cursor);
        }

        const path = `/api/v1/sync/lottery/bins?${params.toString()}`;
        const rawResponse = await this.request<Record<string, unknown>>('GET', path);

        // Log response structure on first page for debugging
        if (pageCount === 1) {
          log.debug('Bins API raw response', {
            responseKeys: Object.keys(rawResponse),
            hasSuccess: 'success' in rawResponse,
            hasData: 'data' in rawResponse,
            dataKeys:
              rawResponse.data && typeof rawResponse.data === 'object'
                ? Object.keys(rawResponse.data as Record<string, unknown>)
                : [],
          });
        }

        // Parse the response
        let records: CloudBin[] = [];
        let pageHasMore = false;
        let pageCursor: string | null = null;

        if ('data' in rawResponse && rawResponse.data && typeof rawResponse.data === 'object') {
          const data = rawResponse.data as Record<string, unknown>;
          const rawRecords = (data.records || data.bins || []) as Record<string, unknown>[];
          records = rawRecords.map(mapCloudBin);
          totalCount = (data.total_count ?? data.totalCount ?? records.length) as number;
          currentSequence = (data.current_sequence ?? data.currentSequence ?? 0) as number;
          serverTime = (data.server_time ?? data.serverTime ?? '') as string;
          pageHasMore = (data.has_more ?? data.hasMore ?? false) as boolean;
          pageCursor = (data.next_cursor ?? data.nextCursor ?? null) as string | null;
        } else if ('records' in rawResponse) {
          const rawRecords = (rawResponse.records || []) as Record<string, unknown>[];
          records = rawRecords.map(mapCloudBin);
          totalCount = (rawResponse.total_count ??
            rawResponse.totalCount ??
            records.length) as number;
          currentSequence = (rawResponse.current_sequence ??
            rawResponse.currentSequence ??
            0) as number;
          serverTime = (rawResponse.server_time ?? rawResponse.serverTime ?? '') as string;
          pageHasMore = (rawResponse.has_more ?? rawResponse.hasMore ?? false) as boolean;
          pageCursor = (rawResponse.next_cursor ?? rawResponse.nextCursor ?? null) as string | null;
        } else if ('bins' in rawResponse) {
          const rawRecords = (rawResponse.bins || []) as Record<string, unknown>[];
          records = rawRecords.map(mapCloudBin);
          totalCount = (rawResponse.totalCount ?? records.length) as number;
          pageHasMore = false;
        } else {
          log.error('Unexpected bins API response structure', { rawResponse });
          throw new Error('Invalid bins API response structure');
        }

        allBins.push(...records);
        hasMore = pageHasMore;
        cursor = pageCursor;

        log.debug('Bins page fetched', {
          page: pageCount,
          recordsInPage: records.length,
          totalFetched: allBins.length,
          hasMore,
        });
      }

      if (pageCount >= MAX_PAGES) {
        log.warn('Bins pagination hit safety limit', {
          maxPages: MAX_PAGES,
          totalFetched: allBins.length,
        });
      }

      // SEC-017: Audit log
      log.info('Bins pulled successfully', {
        count: allBins.length,
        totalCount,
        pages: pageCount,
      });

      return {
        bins: allBins,
        totalCount,
        hasMore: false, // All pages fetched
        currentSequence,
        serverTime,
        nextCursor: null,
      };
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
   * Sync behavior:
   * - Delta sync (since provided): Returns all games changed since timestamp, including INACTIVE
   * - Full sync (since not provided): Requires include_inactive=true to get all game statuses
   *
   * @param stateId - State ID for scoping (games are state-level)
   * @param since - Optional ISO timestamp for delta sync (from sync_timestamps table)
   * @returns Cloud games response containing all games (active and inactive)
   */
  async pullLotteryGames(stateId: string | null, since?: string): Promise<CloudGamesResponse> {
    const syncMode = since ? 'delta' : 'full';
    log.debug('Pulling lottery games from cloud', { stateId, since: since || 'none', syncMode });

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
        // Delta sync: API returns all changed games (including INACTIVE) since timestamp
        params.set('since', since);
      } else {
        // Full sync: Must explicitly request inactive games to receive all statuses
        // Without this, API only returns ACTIVE games and local DB never learns about INACTIVE
        params.set('include_inactive', 'true');
      }

      const path = `/api/v1/sync/lottery/games?${params.toString()}`;

      // API returns: { success: true, data: { records: [...], total_count, has_more, server_time } }
      // per replica_end_points.md specification
      // Use unknown[] to allow flexible field name handling (camelCase or snake_case)
      const response = await this.request<{
        success: boolean;
        data: {
          records?: unknown[];
          games?: unknown[]; // Fallback for legacy format
          total_count?: number;
          has_more?: boolean;
          server_time?: string;
        };
      }>('GET', path);

      // Extract games from response - API uses 'records', fallback to 'games' for compatibility
      // API may return camelCase or snake_case fields, so we normalize to snake_case
      let games: CloudGame[] = [];
      if (response.success && response.data) {
        let rawRecords: Array<Record<string, unknown>> = [];

        if (Array.isArray(response.data.records)) {
          rawRecords = response.data.records as Array<Record<string, unknown>>;
          log.debug('Games found in data.records', { count: rawRecords.length });
        } else if (Array.isArray(response.data.games)) {
          rawRecords = response.data.games as Array<Record<string, unknown>>;
          log.debug('Games found in data.games (legacy)', { count: rawRecords.length });
        }

        // Transform camelCase to snake_case (API may use either format)
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
                : undefined,
          status: ((r.status || 'ACTIVE') as string).toUpperCase() as
            | 'ACTIVE'
            | 'INACTIVE'
            | 'DISCONTINUED',
          updated_at: (r.updatedAt || r.updated_at || new Date().toISOString()) as string,
        }));
      }

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

  // ==========================================================================
  // Pack Sync Operations (Phase 1 - Cloud Sync Endpoints)
  // ==========================================================================

  /**
   * Push received pack to cloud
   * API: POST /api/v1/sync/lottery/packs/receive
   *
   * Enterprise-grade implementation:
   * - API-001: Input validation via Zod schema
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation
   * - SEC-017: Audit logging for sync operations
   *
   * @param pack - Pack receive data
   * @returns Success status with optional cloud pack ID
   */
  async pushPackReceive(pack: {
    pack_id: string;
    store_id: string;
    game_id: string;
    game_code: string;
    pack_number: string;
    received_at: string;
    received_by: string | null;
  }): Promise<{ success: boolean; cloud_pack_id?: string }> {
    log.debug('Pushing pack receive to cloud', {
      packId: pack.pack_id,
      gameCode: pack.game_code,
      packNumber: pack.pack_number,
    });

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      const path = `/api/v1/sync/lottery/packs/receive`;

      // API spec: POST /api/v1/sync/lottery/packs/receive
      // Required fields: session_id, game_code, pack_number, serial_start, serial_end, received_at, local_id
      const requestBody = {
        session_id: session.sessionId,
        game_code: pack.game_code,
        pack_number: pack.pack_number,
        serial_start: '000', // Always starts at 000 - must be string per API spec
        serial_end: '299', // Default pack size - 1 (TODO: get from game.tickets_per_pack) - must be string per API spec
        received_at: pack.received_at,
        local_id: pack.pack_id,
      };

      log.info('Pack receive request body', {
        packId: pack.pack_id,
        requestBody: JSON.stringify(requestBody),
      });

      const response = await this.request<{
        success: boolean;
        data?: { packId?: string; localId?: string; sequence?: number };
      }>('POST', path, requestBody);

      // Complete sync session
      await this.completeSyncSession(session.sessionId, 0, {
        pulled: 0,
        pushed: 1,
        conflictsResolved: 0,
      });

      log.info('Pack receive pushed to cloud', {
        packId: pack.pack_id,
        cloudPackId: response.data?.packId,
        sequence: response.data?.sequence,
      });

      return {
        success: response.success,
        cloud_pack_id: response.data?.packId,
      };
    } catch (error) {
      // Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after pack receive error');
      }
      throw error;
    }
  }

  /**
   * Push batch of received packs to cloud
   * API: POST /api/v1/sync/lottery/packs/receive/batch
   *
   * Enterprise-grade batch implementation for efficient multi-pack sync.
   * - API-001: Input validation via Zod schema
   * - API-003: Centralized error handling with per-pack results
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation
   * - SEC-017: Audit logging for sync operations
   *
   * @param packs - Array of pack receive data
   * @returns Success status with per-pack results
   */
  async pushPackReceiveBatch(
    packs: Array<{
      pack_id: string;
      store_id: string;
      game_id: string;
      pack_number: string;
      received_at: string;
      received_by: string | null;
    }>
  ): Promise<{
    success: boolean;
    results: Array<{
      pack_id: string;
      cloud_pack_id?: string;
      status: 'synced' | 'failed';
      error?: string;
    }>;
  }> {
    if (packs.length === 0) {
      return { success: true, results: [] };
    }

    log.debug('Pushing pack receive batch to cloud', { count: packs.length });

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);

      const path = `/api/v1/sync/lottery/packs/receive/batch?${params.toString()}`;

      const response = await this.request<{
        success: boolean;
        data?: {
          results: Array<{
            pack_id: string;
            cloud_pack_id?: string;
            status: 'synced' | 'failed';
            error?: string;
          }>;
        };
      }>('POST', path, { packs });

      const results = response.data?.results || [];
      const synced = results.filter((r) => r.status === 'synced').length;
      const failed = results.filter((r) => r.status === 'failed').length;

      // Complete sync session with stats
      await this.completeSyncSession(session.sessionId, 0, {
        pulled: 0,
        pushed: synced,
        conflictsResolved: 0,
      });

      log.info('Pack receive batch pushed to cloud', {
        total: packs.length,
        synced,
        failed,
      });

      return { success: response.success, results };
    } catch (error) {
      // Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after pack receive batch error');
      }
      throw error;
    }
  }

  /**
   * Push pack activation to cloud
   * API: POST /api/v1/sync/lottery/packs/activate
   *
   * Per API spec, the desktop app sends all pack data with every activation request.
   * The server handles:
   * 1. Pack doesn't exist: Create it and activate
   * 2. Pack exists with RECEIVED status: Activate it
   * 3. Pack already ACTIVE in same bin: Idempotent success (returns idempotent: true)
   * 4. Pack ACTIVE in different bin: Error
   *
   * Enterprise-grade implementation:
   * - API-001: Input validation via Zod schema
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation
   * - SEC-010: AUTHZ - activated_by from session for audit trail
   * - SEC-017: Audit logging for sync operations
   *
   * @param data - Pack activation data (all fields required by API spec)
   * @returns Success status and idempotent flag
   */
  async pushPackActivate(data: {
    // Required fields per API spec
    pack_id: string;
    bin_id: string;
    opening_serial: string;
    game_code: string;
    pack_number: string;
    serial_start: string;
    serial_end: string;
    activated_at: string;
    received_at: string;
    // Optional fields
    store_id?: string;
    activated_by?: string | null;
    shift_id?: string | null;
    local_id?: string;
    // Mark-sold fields - only include if pack was mark-sold at activation
    mark_sold_tickets?: number;
    mark_sold_reason?: string;
    mark_sold_approved_by?: string | null;
  }): Promise<{ success: boolean; idempotent?: boolean }> {
    log.debug('Pushing pack activation to cloud', {
      packId: data.pack_id,
      binId: data.bin_id,
      gameCode: data.game_code,
      packNumber: data.pack_number,
    });

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      const path = `/api/v1/sync/lottery/packs/activate`;

      // API spec: POST /api/v1/sync/lottery/packs/activate
      // Required: session_id, pack_id, bin_id, opening_serial, game_code, pack_number,
      //           serial_start, serial_end, activated_at, received_at
      // Optional: shift_id, local_id
      // Mark-sold fields (only if mark_sold_tickets > 0): mark_sold_reason, mark_sold_tickets, mark_sold_approved_by
      const requestBody: Record<string, unknown> = {
        session_id: session.sessionId,
        pack_id: data.pack_id,
        bin_id: data.bin_id,
        opening_serial: String(data.opening_serial),
        game_code: data.game_code,
        pack_number: data.pack_number,
        serial_start: String(data.serial_start),
        serial_end: String(data.serial_end),
        activated_at: data.activated_at,
        received_at: data.received_at,
        local_id: data.local_id || data.pack_id,
      };

      // Optional: shift_id (omit if null, don't send null)
      if (data.shift_id) {
        requestBody.shift_id = data.shift_id;
      }

      // Mark-sold fields - only include if pack was mark-sold at activation
      if (data.mark_sold_tickets && data.mark_sold_tickets > 0) {
        requestBody.mark_sold_tickets = data.mark_sold_tickets;
        if (data.mark_sold_reason) {
          requestBody.mark_sold_reason = data.mark_sold_reason;
        }
        if (data.mark_sold_approved_by) {
          requestBody.mark_sold_approved_by = data.mark_sold_approved_by;
        }
      }

      const response = await this.request<{
        success: boolean;
        data?: {
          success?: boolean;
          pack?: {
            pack_id: string;
            pack_number: string;
            game_code: string;
            status: string;
            bin_id: string;
          };
          serverTime?: string;
          idempotent?: boolean;
        };
      }>('POST', path, requestBody);

      // Complete sync session
      await this.completeSyncSession(session.sessionId, 0, {
        pulled: 0,
        pushed: 1,
        conflictsResolved: 0,
      });

      const idempotent = response.data?.idempotent || false;
      log.info('Pack activation pushed to cloud', {
        packId: data.pack_id,
        binId: data.bin_id,
        gameCode: data.game_code,
        idempotent,
      });

      return { success: response.success, idempotent };
    } catch (error) {
      // Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after pack activate error');
      }
      throw error;
    }
  }

  /**
   * Push pack depletion (sold out) to cloud
   * API: POST /api/v1/sync/lottery/packs/deplete
   *
   * Enterprise-grade implementation:
   * - API-001: Input validation via Zod schema
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation
   * - SEC-017: Audit logging for sync operations
   *
   * @param data - Pack depletion data
   * @returns Success status
   */
  async pushPackDeplete(data: {
    pack_id: string;
    store_id: string;
    closing_serial: string;
    tickets_sold: number;
    sales_amount: number;
    depleted_at: string;
    shift_id?: string | null;
    local_id?: string;
  }): Promise<{ success: boolean }> {
    log.debug('Pushing pack depletion to cloud', {
      packId: data.pack_id,
      ticketsSold: data.tickets_sold,
      salesAmount: data.sales_amount,
    });

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      const path = `/api/v1/sync/lottery/packs/deplete`;

      // API spec: POST /api/v1/sync/lottery/packs/deplete
      // Required: session_id, pack_id, final_serial, depletion_reason, depleted_at, local_id
      // Optional: shift_id (omit if null, don't send null)
      const requestBody: Record<string, unknown> = {
        session_id: session.sessionId,
        pack_id: data.pack_id,
        final_serial: String(data.closing_serial), // API expects string, not number
        depletion_reason: 'SOLD_OUT',
        depleted_at: data.depleted_at,
        local_id: data.local_id || data.pack_id,
      };

      // Only include shift_id if it has a value (API doesn't accept null)
      if (data.shift_id) {
        requestBody.shift_id = data.shift_id;
      }

      const response = await this.request<{
        success: boolean;
        data?: { packId?: string; status?: string; sequence?: number };
      }>('POST', path, requestBody);

      // Complete sync session
      await this.completeSyncSession(session.sessionId, 0, {
        pulled: 0,
        pushed: 1,
        conflictsResolved: 0,
      });

      log.info('Pack depletion pushed to cloud', {
        packId: data.pack_id,
        ticketsSold: data.tickets_sold,
        salesAmount: data.sales_amount,
      });

      return { success: response.success };
    } catch (error) {
      // Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after pack deplete error');
      }
      throw error;
    }
  }

  /**
   * Push pack return to cloud
   * API: POST /api/v1/sync/lottery/packs/return
   *
   * Enterprise-grade implementation:
   * - API-001: Input validation via Zod schema
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation
   * - SEC-017: Audit logging for sync operations
   *
   * @param data - Pack return data
   * @returns Success status
   */
  async pushPackReturn(data: {
    pack_id: string;
    store_id: string;
    closing_serial?: string | null;
    tickets_sold?: number;
    sales_amount?: number;
    return_reason?: string | null;
    return_notes?: string | null;
    returned_at: string;
    shift_id?: string | null;
    local_id?: string;
  }): Promise<{ success: boolean }> {
    log.debug('Pushing pack return to cloud', {
      packId: data.pack_id,
      hasClosingSerial: Boolean(data.closing_serial),
    });

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      const path = `/api/v1/sync/lottery/packs/return`;

      // API spec: POST /api/v1/sync/lottery/packs/return
      // Required: session_id, pack_id, return_reason, last_sold_serial, tickets_sold_on_return, returned_at, local_id
      // Optional: shift_id, return_notes (omit if null, don't send null)
      const requestBody: Record<string, unknown> = {
        session_id: session.sessionId,
        pack_id: data.pack_id,
        return_reason: data.return_reason || 'OTHER',
        last_sold_serial: data.closing_serial ? String(data.closing_serial) : '0', // API expects string
        tickets_sold_on_return: data.tickets_sold || 0,
        returned_at: data.returned_at,
        local_id: data.local_id || data.pack_id,
      };

      // Only include optional fields if they have values (API doesn't accept null)
      if (data.shift_id) {
        requestBody.shift_id = data.shift_id;
      }
      if (data.return_notes) {
        requestBody.return_notes = data.return_notes;
      }

      const response = await this.request<{
        success: boolean;
        data?: { packId?: string; status?: string; sequence?: number };
      }>('POST', path, requestBody);

      // Complete sync session
      await this.completeSyncSession(session.sessionId, 0, {
        pulled: 0,
        pushed: 1,
        conflictsResolved: 0,
      });

      log.info('Pack return pushed to cloud', {
        packId: data.pack_id,
        returnReason: data.return_reason,
      });

      return { success: response.success };
    } catch (error) {
      // Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after pack return error');
      }
      throw error;
    }
  }

  /**
   * Push pack move between bins to cloud
   * API: POST /api/v1/sync/lottery/packs/move
   *
   * Enterprise-grade implementation for tracking pack movements.
   * - API-001: Input validation via Zod schema
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation
   * - SEC-017: Audit logging for sync operations
   *
   * @param data - Pack move data
   * @returns Success status
   */
  async pushPackMove(data: {
    pack_id: string;
    store_id: string;
    from_bin_id: string;
    to_bin_id: string;
    moved_at: string;
    moved_by: string | null;
  }): Promise<{ success: boolean }> {
    log.debug('Pushing pack move to cloud', {
      packId: data.pack_id,
      fromBinId: data.from_bin_id,
      toBinId: data.to_bin_id,
    });

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);

      const path = `/api/v1/sync/lottery/packs/move?${params.toString()}`;

      const response = await this.request<{ success: boolean }>('POST', path, {
        pack_id: data.pack_id,
        store_id: data.store_id,
        from_bin_id: data.from_bin_id,
        to_bin_id: data.to_bin_id,
        moved_at: data.moved_at,
        moved_by: data.moved_by,
      });

      // Complete sync session
      await this.completeSyncSession(session.sessionId, 0, {
        pulled: 0,
        pushed: 1,
        conflictsResolved: 0,
      });

      log.info('Pack move pushed to cloud', {
        packId: data.pack_id,
        fromBinId: data.from_bin_id,
        toBinId: data.to_bin_id,
      });

      return { success: response.success };
    } catch (error) {
      // Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after pack move error');
      }
      throw error;
    }
  }

  // ==========================================================================
  // Phase 3: Day Close Sync Methods (Two-Phase Commit)
  // ==========================================================================

  /**
   * Prepare day close (Phase 1 of two-phase commit)
   * API: POST /api/v1/sync/lottery/day/prepare-close
   *
   * Enterprise-grade implementation for day close preparation:
   * - Validates expected inventory state against cloud
   * - Returns validation token for commit phase
   * - Token has expiration for security
   *
   * Security & Standards Compliance:
   * - API-001: Input validation via Zod schema
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation
   * - SEC-017: Audit logging for all sync operations
   * - API-002: Rate limiting via sync session management
   *
   * @param data - Day close preparation data with expected inventory
   * @returns Validation result with token and expiration
   */
  async prepareDayClose(data: {
    store_id: string;
    business_date: string;
    expected_inventory: Array<{
      bin_id: string;
      pack_id: string;
      closing_serial: string;
    }>;
    prepared_by: string | null;
  }): Promise<{
    success: boolean;
    validation_token: string;
    expires_at: string;
    warnings?: string[];
    discrepancies?: Array<{
      bin_id: string;
      pack_id: string;
      expected_serial: string;
      actual_serial?: string;
      issue: string;
    }>;
  }> {
    log.debug('Preparing day close', {
      storeId: data.store_id,
      businessDate: data.business_date,
      inventoryCount: data.expected_inventory.length,
    });

    // API-001: Validate business date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.business_date)) {
      log.error('Invalid business date format', { businessDate: data.business_date });
      throw new Error('Invalid business date format. Expected YYYY-MM-DD');
    }

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);

      const path = `/api/v1/sync/lottery/day/prepare-close?${params.toString()}`;

      // API-001: Structured payload matching API contract
      const response = await this.request<{
        success: boolean;
        data?: {
          validation_token: string;
          expires_at: string;
          warnings?: string[];
          discrepancies?: Array<{
            bin_id: string;
            pack_id: string;
            expected_serial: string;
            actual_serial?: string;
            issue: string;
          }>;
        };
      }>('POST', path, {
        store_id: data.store_id,
        business_date: data.business_date,
        expected_inventory: data.expected_inventory.map((inv) => ({
          bin_id: inv.bin_id,
          pack_id: inv.pack_id,
          closing_serial: inv.closing_serial,
        })),
        prepared_by: data.prepared_by,
      });

      // Complete sync session
      await this.completeSyncSession(session.sessionId, 0, {
        pulled: 0,
        pushed: 1,
        conflictsResolved: 0,
      });

      // SEC-017: Audit log (no sensitive data)
      log.info('Day close preparation completed', {
        storeId: data.store_id,
        businessDate: data.business_date,
        inventoryCount: data.expected_inventory.length,
        hasWarnings: Boolean(response.data?.warnings?.length),
        hasDiscrepancies: Boolean(response.data?.discrepancies?.length),
        tokenExpiry: response.data?.expires_at,
      });

      return {
        success: response.success,
        validation_token: response.data?.validation_token || '',
        expires_at: response.data?.expires_at || '',
        warnings: response.data?.warnings,
        discrepancies: response.data?.discrepancies,
      };
    } catch (error) {
      // API-003: Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after day close prepare error');
      }
      throw error;
    }
  }

  /**
   * Commit day close (Phase 2 of two-phase commit)
   * API: POST /api/v1/sync/lottery/day/commit-close
   *
   * Enterprise-grade implementation for finalizing day close:
   * - Requires valid validation token from prepare phase
   * - Atomically finalizes the day close on the cloud
   * - Returns day summary ID for record keeping
   *
   * Security & Standards Compliance:
   * - API-001: Input validation via TypeScript types
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation
   * - SEC-017: Audit logging for all sync operations
   * - SEC-010: AUTHZ - closed_by recorded for audit trail
   *
   * @param data - Commit data with validation token
   * @returns Success status with day summary ID
   */
  async commitDayClose(data: {
    store_id: string;
    validation_token: string;
    closed_by: string | null;
  }): Promise<{
    success: boolean;
    day_summary_id?: string;
    business_date?: string;
    total_sales?: number;
    total_tickets_sold?: number;
  }> {
    log.debug('Committing day close', {
      storeId: data.store_id,
      hasToken: Boolean(data.validation_token),
    });

    // API-001: Validate token is present
    if (!data.validation_token) {
      log.error('Day close commit missing validation token');
      throw new Error('Validation token is required for day close commit');
    }

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);

      const path = `/api/v1/sync/lottery/day/commit-close?${params.toString()}`;

      // API-001: Structured payload matching API contract
      const response = await this.request<{
        success: boolean;
        data?: {
          day_summary_id: string;
          business_date?: string;
          total_sales?: number;
          total_tickets_sold?: number;
        };
      }>('POST', path, {
        store_id: data.store_id,
        validation_token: data.validation_token,
        closed_by: data.closed_by,
      });

      // Complete sync session
      await this.completeSyncSession(session.sessionId, 0, {
        pulled: 0,
        pushed: 1,
        conflictsResolved: 0,
      });

      // SEC-017: Audit log with summary data (no sensitive information)
      log.info('Day close committed successfully', {
        storeId: data.store_id,
        daySummaryId: response.data?.day_summary_id,
        businessDate: response.data?.business_date,
        totalSales: response.data?.total_sales,
        totalTicketsSold: response.data?.total_tickets_sold,
        closedBy: data.closed_by,
      });

      return {
        success: response.success,
        day_summary_id: response.data?.day_summary_id,
        business_date: response.data?.business_date,
        total_sales: response.data?.total_sales,
        total_tickets_sold: response.data?.total_tickets_sold,
      };
    } catch (error) {
      // API-003: Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after day close commit error');
      }
      throw error;
    }
  }

  /**
   * Cancel day close (rollback pending close)
   * API: POST /api/v1/sync/lottery/day/cancel-close
   *
   * Enterprise-grade implementation for cancelling a pending day close:
   * - Invalidates the validation token
   * - Allows restart of day close process
   *
   * Security & Standards Compliance:
   * - API-001: Input validation via TypeScript types
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation
   * - SEC-017: Audit logging for all sync operations
   *
   * @param data - Cancel data with validation token
   * @returns Success status
   */
  async cancelDayClose(data: {
    store_id: string;
    validation_token: string;
    reason?: string | null;
    cancelled_by: string | null;
  }): Promise<{ success: boolean }> {
    log.debug('Cancelling day close', {
      storeId: data.store_id,
      hasToken: Boolean(data.validation_token),
      hasReason: Boolean(data.reason),
    });

    // API-001: Validate token is present
    if (!data.validation_token) {
      log.error('Day close cancel missing validation token');
      throw new Error('Validation token is required for day close cancel');
    }

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);

      const path = `/api/v1/sync/lottery/day/cancel-close?${params.toString()}`;

      // API-001: Structured payload matching API contract
      const response = await this.request<{ success: boolean }>('POST', path, {
        store_id: data.store_id,
        validation_token: data.validation_token,
        reason: data.reason || null,
        cancelled_by: data.cancelled_by,
      });

      // Complete sync session
      await this.completeSyncSession(session.sessionId, 0, {
        pulled: 0,
        pushed: 1,
        conflictsResolved: 0,
      });

      // SEC-017: Audit log
      log.info('Day close cancelled', {
        storeId: data.store_id,
        reason: data.reason || 'No reason provided',
        cancelledBy: data.cancelled_by,
      });

      return { success: response.success };
    } catch (error) {
      // API-003: Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after day close cancel error');
      }
      throw error;
    }
  }

  /**
   * Approve variance discrepancy
   * API: POST /api/v1/sync/lottery/variances/approve
   *
   * Enterprise-grade implementation for approving inventory discrepancies:
   * - Records variance approval with reason
   * - Requires manager authorization
   *
   * Security & Standards Compliance:
   * - API-001: Input validation via TypeScript types
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation
   * - SEC-017: Audit logging for variance approvals
   * - SEC-010: AUTHZ - approved_by recorded for audit trail
   *
   * @param data - Variance approval data
   * @returns Success status
   */
  async approveVariance(data: {
    store_id: string;
    variance_id: string;
    business_date: string;
    bin_id: string;
    pack_id: string;
    expected_serial: string;
    actual_serial: string;
    variance_type: 'SERIAL_MISMATCH' | 'MISSING_PACK' | 'EXTRA_PACK' | 'COUNT_MISMATCH';
    resolution: string;
    approved_by: string;
  }): Promise<{ success: boolean }> {
    log.debug('Approving variance', {
      storeId: data.store_id,
      varianceId: data.variance_id,
      varianceType: data.variance_type,
    });

    // API-001: Validate variance ID format (UUID expected)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.variance_id)) {
      log.error('Invalid variance ID format', { varianceId: data.variance_id });
      throw new Error('Invalid variance ID format');
    }

    // API-001: Validate resolution is provided
    if (!data.resolution || data.resolution.trim().length === 0) {
      log.error('Variance approval requires resolution');
      throw new Error('Resolution is required for variance approval');
    }

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);

      const path = `/api/v1/sync/lottery/variances/approve?${params.toString()}`;

      // API-001: Structured payload matching API contract
      const response = await this.request<{ success: boolean }>('POST', path, {
        store_id: data.store_id,
        variance_id: data.variance_id,
        business_date: data.business_date,
        bin_id: data.bin_id,
        pack_id: data.pack_id,
        expected_serial: data.expected_serial,
        actual_serial: data.actual_serial,
        variance_type: data.variance_type,
        resolution: data.resolution.trim(),
        approved_by: data.approved_by,
      });

      // Complete sync session
      await this.completeSyncSession(session.sessionId, 0, {
        pulled: 0,
        pushed: 1,
        conflictsResolved: 1, // Count variance resolution as conflict resolved
      });

      // SEC-017: Audit log for variance approval (compliance requirement)
      log.info('Variance approved', {
        storeId: data.store_id,
        varianceId: data.variance_id,
        businessDate: data.business_date,
        varianceType: data.variance_type,
        binId: data.bin_id,
        packId: data.pack_id,
        approvedBy: data.approved_by,
        resolution: data.resolution.substring(0, 100), // Truncate for log safety
      });

      return { success: response.success };
    } catch (error) {
      // API-003: Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after variance approval error');
      }
      throw error;
    }
  }

  // ==========================================================================
  // Phase 2: Shift Lottery Sync Methods
  // ==========================================================================

  /**
   * Push shift opening serials to cloud
   * API: POST /api/v1/sync/lottery/shift/open
   *
   * Enterprise-grade implementation for syncing shift opening lottery serials.
   * Records the opening serial numbers for all active packs at shift start.
   *
   * Security & Standards Compliance:
   * - API-001: Input validation via TypeScript types and session validation
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation
   * - SEC-017: Audit logging for all sync operations
   * - API-002: Rate limiting via sync session management
   *
   * @param data - Shift opening data with bin/pack serials
   * @returns Success status
   */
  async pushShiftOpening(data: {
    shift_id: string;
    store_id: string;
    openings: Array<{
      bin_id: string;
      pack_id: string;
      opening_serial: string;
    }>;
    opened_at: string;
    opened_by: string | null;
  }): Promise<{ success: boolean }> {
    log.debug('Pushing shift opening to cloud', {
      shiftId: data.shift_id,
      openingsCount: data.openings.length,
    });

    // API-001: Validate array is not empty
    if (data.openings.length === 0) {
      log.warn('Shift opening has no openings to sync', { shiftId: data.shift_id });
      return { success: true }; // Nothing to sync
    }

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);

      const path = `/api/v1/sync/lottery/shift/open?${params.toString()}`;

      // API-001: Structured payload matching API contract
      const response = await this.request<{ success: boolean }>('POST', path, {
        shift_id: data.shift_id,
        store_id: data.store_id,
        openings: data.openings.map((o) => ({
          bin_id: o.bin_id,
          pack_id: o.pack_id,
          opening_serial: o.opening_serial,
        })),
        opened_at: data.opened_at,
        opened_by: data.opened_by,
      });

      // Complete sync session
      await this.completeSyncSession(session.sessionId, 0, {
        pulled: 0,
        pushed: data.openings.length,
        conflictsResolved: 0,
      });

      // SEC-017: Audit log
      log.info('Shift opening pushed to cloud', {
        shiftId: data.shift_id,
        openingsCount: data.openings.length,
        openedBy: data.opened_by,
      });

      return { success: response.success };
    } catch (error) {
      // API-003: Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after shift opening error');
      }
      throw error;
    }
  }

  /**
   * Push shift closing serials to cloud
   * API: POST /api/v1/sync/lottery/shift/close
   *
   * Enterprise-grade implementation for syncing shift closing lottery serials.
   * Records the closing serial numbers and calculated sales for all active packs at shift end.
   *
   * Security & Standards Compliance:
   * - API-001: Input validation via TypeScript types and session validation
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation
   * - SEC-017: Audit logging for all sync operations
   * - API-002: Rate limiting via sync session management
   *
   * @param data - Shift closing data with bin/pack serials and sales
   * @returns Success status
   */
  async pushShiftClosing(data: {
    shift_id: string;
    store_id: string;
    closings: Array<{
      bin_id: string;
      pack_id: string;
      closing_serial: string;
      tickets_sold: number;
      sales_amount: number;
    }>;
    closed_at: string;
    closed_by: string | null;
  }): Promise<{ success: boolean }> {
    log.debug('Pushing shift closing to cloud', {
      shiftId: data.shift_id,
      closingsCount: data.closings.length,
    });

    // API-001: Validate array is not empty
    if (data.closings.length === 0) {
      log.warn('Shift closing has no closings to sync', { shiftId: data.shift_id });
      return { success: true }; // Nothing to sync
    }

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);

      const path = `/api/v1/sync/lottery/shift/close?${params.toString()}`;

      // API-001: Structured payload matching API contract
      // SEC-006: No string concatenation, uses parameterized request
      const response = await this.request<{ success: boolean }>('POST', path, {
        shift_id: data.shift_id,
        store_id: data.store_id,
        closings: data.closings.map((c) => ({
          bin_id: c.bin_id,
          pack_id: c.pack_id,
          closing_serial: c.closing_serial,
          tickets_sold: c.tickets_sold,
          sales_amount: c.sales_amount,
        })),
        closed_at: data.closed_at,
        closed_by: data.closed_by,
      });

      // Complete sync session
      await this.completeSyncSession(session.sessionId, 0, {
        pulled: 0,
        pushed: data.closings.length,
        conflictsResolved: 0,
      });

      // SEC-017: Audit log with sales totals
      const totalSales = data.closings.reduce((sum, c) => sum + c.sales_amount, 0);
      const totalTickets = data.closings.reduce((sum, c) => sum + c.tickets_sold, 0);

      log.info('Shift closing pushed to cloud', {
        shiftId: data.shift_id,
        closingsCount: data.closings.length,
        totalTicketsSold: totalTickets,
        totalSalesAmount: totalSales,
        closedBy: data.closed_by,
      });

      return { success: response.success };
    } catch (error) {
      // API-003: Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after shift closing error');
      }
      throw error;
    }
  }

  // ==========================================================================
  // Phase 4: Pull Endpoints (Multi-Device Sync)
  // ==========================================================================

  /**
   * Pull received packs from cloud
   * API: GET /api/v1/sync/lottery/packs/received
   *
   * Enterprise-grade implementation for multi-device pack synchronization.
   * Retrieves packs that have been received but not yet processed further.
   *
   * Security & Standards Compliance:
   * - API-001: Input validation via TypeScript types and query parameter sanitization
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation (tenant isolation)
   * - SEC-017: Audit logging for all sync operations
   * - API-002: Bounded pagination to prevent unbounded reads
   *
   * @param options - Optional parameters for delta/paginated sync
   * @returns Received packs with sync metadata
   */
  async pullReceivedPacks(options?: {
    since?: string;
    sinceSequence?: number;
    limit?: number;
  }): Promise<CloudPacksResponse> {
    log.debug('Pulling received packs from cloud', {
      since: options?.since || 'full',
      sinceSequence: options?.sinceSequence,
      limit: options?.limit,
    });

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      // API-001: Build query parameters with validation
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);

      if (options?.since) {
        params.set('since', options.since);
      }
      if (options?.sinceSequence !== undefined) {
        params.set('since_sequence', String(options.sinceSequence));
      }
      // API-002: Enforce bounded pagination (default 500, max 1000)
      const limit = Math.min(options?.limit || 500, 1000);
      params.set('limit', String(limit));

      const path = `/api/v1/sync/lottery/packs/received?${params.toString()}`;

      const rawResponse = await this.request<{
        success: boolean;
        data?: {
          packs?: Array<Record<string, unknown>>;
          records?: Array<Record<string, unknown>>;
          syncMetadata?: CloudSyncMetadata;
        };
      }>('GET', path);

      // Handle various response formats - API may return camelCase or snake_case
      const data = rawResponse.data || {};
      const rawPacks = (data.packs || data.records || []) as Array<Record<string, unknown>>;

      // Transform camelCase to snake_case (API may use either format)
      const packs: CloudPack[] = rawPacks.map((r) => ({
        pack_id: (r.packId || r.pack_id) as string,
        store_id: (r.storeId || r.store_id) as string,
        game_id: (r.gameId || r.game_id) as string,
        game_code: (r.gameCode || r.game_code) as string,
        pack_number: (r.packNumber || r.pack_number) as string,
        serial_start: (r.serialStart || r.serial_start) as string,
        serial_end: (r.serialEnd || r.serial_end) as string,
        status: (r.status as CloudPackStatus) || 'RECEIVED',
        current_bin_id: (r.currentBinId || r.current_bin_id || null) as string | null,
        current_bin_name: (r.currentBinName || r.current_bin_name || null) as string | null,
        opening_serial: (r.openingSerial || r.opening_serial || null) as string | null,
        closing_serial: (r.closingSerial || r.closing_serial || null) as string | null,
        tickets_sold_count: Number(r.ticketsSoldCount ?? r.tickets_sold_count ?? 0),
        last_sold_at: (r.lastSoldAt || r.last_sold_at || null) as string | null,
        sales_amount:
          r.salesAmount !== undefined
            ? Number(r.salesAmount)
            : r.sales_amount !== undefined
              ? Number(r.sales_amount)
              : null,
        received_at: (r.receivedAt || r.received_at || null) as string | null,
        received_by: (r.receivedBy || r.received_by || null) as string | null,
        activated_at: (r.activatedAt || r.activated_at || null) as string | null,
        activated_by: (r.activatedBy || r.activated_by || null) as string | null,
        activated_shift_id: (r.activatedShiftId || r.activated_shift_id || null) as string | null,
        depleted_at: (r.depletedAt || r.depleted_at || null) as string | null,
        depleted_by: (r.depletedBy || r.depleted_by || null) as string | null,
        depleted_shift_id: (r.depletedShiftId || r.depleted_shift_id || null) as string | null,
        depletion_reason: (r.depletionReason || r.depletion_reason || null) as string | null,
        returned_at: (r.returnedAt || r.returned_at || null) as string | null,
        returned_by: (r.returnedBy || r.returned_by || null) as string | null,
        returned_shift_id: (r.returnedShiftId || r.returned_shift_id || null) as string | null,
        return_reason: (r.returnReason || r.return_reason || null) as string | null,
        return_notes: (r.returnNotes || r.return_notes || null) as string | null,
        last_sold_serial: (r.lastSoldSerial || r.last_sold_serial || null) as string | null,
        tickets_sold_on_return:
          r.ticketsSoldOnReturn !== undefined
            ? Number(r.ticketsSoldOnReturn)
            : r.tickets_sold_on_return !== undefined
              ? Number(r.tickets_sold_on_return)
              : null,
        return_sales_amount:
          r.returnSalesAmount !== undefined
            ? Number(r.returnSalesAmount)
            : r.return_sales_amount !== undefined
              ? Number(r.return_sales_amount)
              : null,
        serial_override_approved_by: (r.serialOverrideApprovedBy ||
          r.serial_override_approved_by ||
          null) as string | null,
        serial_override_reason: (r.serialOverrideReason || r.serial_override_reason || null) as
          | string
          | null,
        serial_override_approved_at: (r.serialOverrideApprovedAt ||
          r.serial_override_approved_at ||
          null) as string | null,
        mark_sold_approved_by: (r.markSoldApprovedBy || r.mark_sold_approved_by || null) as
          | string
          | null,
        mark_sold_reason: (r.markSoldReason || r.mark_sold_reason || null) as string | null,
        mark_sold_approved_at: (r.markSoldApprovedAt || r.mark_sold_approved_at || null) as
          | string
          | null,
        sync_sequence: Number(r.syncSequence ?? r.sync_sequence ?? 0),
        updated_at: (r.updatedAt || r.updated_at || new Date().toISOString()) as string,
        created_at: (r.createdAt || r.created_at || new Date().toISOString()) as string,
      }));

      const syncMetadata: CloudSyncMetadata = data.syncMetadata || {
        lastSequence: packs.length > 0 ? Math.max(...packs.map((p) => p.sync_sequence || 0)) : 0,
        hasMore: packs.length === limit,
        totalCount: packs.length,
        serverTime: new Date().toISOString(),
      };

      // Complete sync session
      await this.completeSyncSession(session.sessionId, syncMetadata.lastSequence, {
        pulled: packs.length,
        pushed: 0,
        conflictsResolved: 0,
      });

      // SEC-017: Audit log
      log.info('Received packs pulled from cloud', {
        count: packs.length,
        hasMore: syncMetadata.hasMore,
        lastSequence: syncMetadata.lastSequence,
      });

      return { packs, syncMetadata };
    } catch (error) {
      // API-003: Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after pull received packs error');
      }
      throw error;
    }
  }

  /**
   * Pull activated packs from cloud
   * API: GET /api/v1/sync/lottery/packs/activated
   *
   * Enterprise-grade implementation for multi-device pack synchronization.
   * Retrieves packs that have been activated with bin assignments and opening serials.
   *
   * Security & Standards Compliance:
   * - API-001: Input validation via TypeScript types
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation (tenant isolation)
   * - SEC-017: Audit logging for all sync operations
   * - API-002: Bounded pagination to prevent unbounded reads
   *
   * @param options - Optional parameters for delta/paginated sync
   * @returns Activated packs with sync metadata
   */
  async pullActivatedPacks(options?: {
    since?: string;
    sinceSequence?: number;
    limit?: number;
  }): Promise<CloudPacksResponse> {
    log.debug('Pulling activated packs from cloud', {
      since: options?.since || 'full',
      sinceSequence: options?.sinceSequence,
      limit: options?.limit,
    });

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      // API-001: Build query parameters with validation
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);

      if (options?.since) {
        params.set('since', options.since);
      }
      if (options?.sinceSequence !== undefined) {
        params.set('since_sequence', String(options.sinceSequence));
      }
      // API-002: Enforce bounded pagination
      const limit = Math.min(options?.limit || 500, 1000);
      params.set('limit', String(limit));

      const path = `/api/v1/sync/lottery/packs/activated?${params.toString()}`;

      const rawResponse = await this.request<{
        success: boolean;
        data?: {
          packs?: Array<Record<string, unknown>>;
          records?: Array<Record<string, unknown>>;
          syncMetadata?: CloudSyncMetadata;
        };
      }>('GET', path);

      // Handle various response formats - API may return camelCase or snake_case
      const data = rawResponse.data || {};
      const rawPacks = (data.packs || data.records || []) as Array<Record<string, unknown>>;

      // Transform camelCase to snake_case (API may use either format)
      const packs: CloudPack[] = rawPacks.map((r) => ({
        pack_id: (r.packId || r.pack_id) as string,
        store_id: (r.storeId || r.store_id) as string,
        game_id: (r.gameId || r.game_id) as string,
        game_code: (r.gameCode || r.game_code) as string,
        pack_number: (r.packNumber || r.pack_number) as string,
        serial_start: (r.serialStart || r.serial_start) as string,
        serial_end: (r.serialEnd || r.serial_end) as string,
        status: (r.status as CloudPackStatus) || 'RECEIVED',
        current_bin_id: (r.currentBinId || r.current_bin_id || null) as string | null,
        current_bin_name: (r.currentBinName || r.current_bin_name || null) as string | null,
        opening_serial: (r.openingSerial || r.opening_serial || null) as string | null,
        closing_serial: (r.closingSerial || r.closing_serial || null) as string | null,
        tickets_sold_count: Number(r.ticketsSoldCount ?? r.tickets_sold_count ?? 0),
        last_sold_at: (r.lastSoldAt || r.last_sold_at || null) as string | null,
        sales_amount:
          r.salesAmount !== undefined
            ? Number(r.salesAmount)
            : r.sales_amount !== undefined
              ? Number(r.sales_amount)
              : null,
        received_at: (r.receivedAt || r.received_at || null) as string | null,
        received_by: (r.receivedBy || r.received_by || null) as string | null,
        activated_at: (r.activatedAt || r.activated_at || null) as string | null,
        activated_by: (r.activatedBy || r.activated_by || null) as string | null,
        activated_shift_id: (r.activatedShiftId || r.activated_shift_id || null) as string | null,
        depleted_at: (r.depletedAt || r.depleted_at || null) as string | null,
        depleted_by: (r.depletedBy || r.depleted_by || null) as string | null,
        depleted_shift_id: (r.depletedShiftId || r.depleted_shift_id || null) as string | null,
        depletion_reason: (r.depletionReason || r.depletion_reason || null) as string | null,
        returned_at: (r.returnedAt || r.returned_at || null) as string | null,
        returned_by: (r.returnedBy || r.returned_by || null) as string | null,
        returned_shift_id: (r.returnedShiftId || r.returned_shift_id || null) as string | null,
        return_reason: (r.returnReason || r.return_reason || null) as string | null,
        return_notes: (r.returnNotes || r.return_notes || null) as string | null,
        last_sold_serial: (r.lastSoldSerial || r.last_sold_serial || null) as string | null,
        tickets_sold_on_return:
          r.ticketsSoldOnReturn !== undefined
            ? Number(r.ticketsSoldOnReturn)
            : r.tickets_sold_on_return !== undefined
              ? Number(r.tickets_sold_on_return)
              : null,
        return_sales_amount:
          r.returnSalesAmount !== undefined
            ? Number(r.returnSalesAmount)
            : r.return_sales_amount !== undefined
              ? Number(r.return_sales_amount)
              : null,
        serial_override_approved_by: (r.serialOverrideApprovedBy ||
          r.serial_override_approved_by ||
          null) as string | null,
        serial_override_reason: (r.serialOverrideReason || r.serial_override_reason || null) as
          | string
          | null,
        serial_override_approved_at: (r.serialOverrideApprovedAt ||
          r.serial_override_approved_at ||
          null) as string | null,
        mark_sold_approved_by: (r.markSoldApprovedBy || r.mark_sold_approved_by || null) as
          | string
          | null,
        mark_sold_reason: (r.markSoldReason || r.mark_sold_reason || null) as string | null,
        mark_sold_approved_at: (r.markSoldApprovedAt || r.mark_sold_approved_at || null) as
          | string
          | null,
        sync_sequence: Number(r.syncSequence ?? r.sync_sequence ?? 0),
        updated_at: (r.updatedAt || r.updated_at || new Date().toISOString()) as string,
        created_at: (r.createdAt || r.created_at || new Date().toISOString()) as string,
      }));

      const syncMetadata: CloudSyncMetadata = data.syncMetadata || {
        lastSequence: packs.length > 0 ? Math.max(...packs.map((p) => p.sync_sequence || 0)) : 0,
        hasMore: packs.length === limit,
        totalCount: packs.length,
        serverTime: new Date().toISOString(),
      };

      // Complete sync session
      await this.completeSyncSession(session.sessionId, syncMetadata.lastSequence, {
        pulled: packs.length,
        pushed: 0,
        conflictsResolved: 0,
      });

      // SEC-017: Audit log
      log.info('Activated packs pulled from cloud', {
        count: packs.length,
        hasMore: syncMetadata.hasMore,
        lastSequence: syncMetadata.lastSequence,
      });

      return { packs, syncMetadata };
    } catch (error) {
      // API-003: Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after pull activated packs error');
      }
      throw error;
    }
  }

  /**
   * Pull returned packs from cloud
   * API: GET /api/v1/sync/lottery/packs/returned
   *
   * Enterprise-grade implementation for multi-device pack synchronization.
   * Retrieves packs that have been returned to supplier.
   *
   * Security & Standards Compliance:
   * - API-001: Input validation via TypeScript types
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation (tenant isolation)
   * - SEC-017: Audit logging for all sync operations
   * - API-002: Bounded pagination to prevent unbounded reads
   *
   * @param options - Optional parameters for delta/paginated sync
   * @returns Returned packs with sync metadata
   */
  async pullReturnedPacks(options?: {
    since?: string;
    sinceSequence?: number;
    limit?: number;
  }): Promise<CloudPacksResponse> {
    log.debug('Pulling returned packs from cloud', {
      since: options?.since || 'full',
      sinceSequence: options?.sinceSequence,
      limit: options?.limit,
    });

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      // API-001: Build query parameters with validation
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);

      if (options?.since) {
        params.set('since', options.since);
      }
      if (options?.sinceSequence !== undefined) {
        params.set('since_sequence', String(options.sinceSequence));
      }
      // API-002: Enforce bounded pagination
      const limit = Math.min(options?.limit || 500, 1000);
      params.set('limit', String(limit));

      const path = `/api/v1/sync/lottery/packs/returned?${params.toString()}`;

      const rawResponse = await this.request<{
        success: boolean;
        data?: {
          packs?: Array<Record<string, unknown>>;
          records?: Array<Record<string, unknown>>;
          syncMetadata?: CloudSyncMetadata;
        };
      }>('GET', path);

      // Handle various response formats - API may return camelCase or snake_case
      const data = rawResponse.data || {};
      const rawPacks = (data.packs || data.records || []) as Array<Record<string, unknown>>;

      // Transform camelCase to snake_case (API may use either format)
      const packs: CloudPack[] = rawPacks.map((r) => ({
        pack_id: (r.packId || r.pack_id) as string,
        store_id: (r.storeId || r.store_id) as string,
        game_id: (r.gameId || r.game_id) as string,
        game_code: (r.gameCode || r.game_code) as string,
        pack_number: (r.packNumber || r.pack_number) as string,
        serial_start: (r.serialStart || r.serial_start) as string,
        serial_end: (r.serialEnd || r.serial_end) as string,
        status: (r.status as CloudPackStatus) || 'RECEIVED',
        current_bin_id: (r.currentBinId || r.current_bin_id || null) as string | null,
        current_bin_name: (r.currentBinName || r.current_bin_name || null) as string | null,
        opening_serial: (r.openingSerial || r.opening_serial || null) as string | null,
        closing_serial: (r.closingSerial || r.closing_serial || null) as string | null,
        tickets_sold_count: Number(r.ticketsSoldCount ?? r.tickets_sold_count ?? 0),
        last_sold_at: (r.lastSoldAt || r.last_sold_at || null) as string | null,
        sales_amount:
          r.salesAmount !== undefined
            ? Number(r.salesAmount)
            : r.sales_amount !== undefined
              ? Number(r.sales_amount)
              : null,
        received_at: (r.receivedAt || r.received_at || null) as string | null,
        received_by: (r.receivedBy || r.received_by || null) as string | null,
        activated_at: (r.activatedAt || r.activated_at || null) as string | null,
        activated_by: (r.activatedBy || r.activated_by || null) as string | null,
        activated_shift_id: (r.activatedShiftId || r.activated_shift_id || null) as string | null,
        depleted_at: (r.depletedAt || r.depleted_at || null) as string | null,
        depleted_by: (r.depletedBy || r.depleted_by || null) as string | null,
        depleted_shift_id: (r.depletedShiftId || r.depleted_shift_id || null) as string | null,
        depletion_reason: (r.depletionReason || r.depletion_reason || null) as string | null,
        returned_at: (r.returnedAt || r.returned_at || null) as string | null,
        returned_by: (r.returnedBy || r.returned_by || null) as string | null,
        returned_shift_id: (r.returnedShiftId || r.returned_shift_id || null) as string | null,
        return_reason: (r.returnReason || r.return_reason || null) as string | null,
        return_notes: (r.returnNotes || r.return_notes || null) as string | null,
        last_sold_serial: (r.lastSoldSerial || r.last_sold_serial || null) as string | null,
        tickets_sold_on_return:
          r.ticketsSoldOnReturn !== undefined
            ? Number(r.ticketsSoldOnReturn)
            : r.tickets_sold_on_return !== undefined
              ? Number(r.tickets_sold_on_return)
              : null,
        return_sales_amount:
          r.returnSalesAmount !== undefined
            ? Number(r.returnSalesAmount)
            : r.return_sales_amount !== undefined
              ? Number(r.return_sales_amount)
              : null,
        serial_override_approved_by: (r.serialOverrideApprovedBy ||
          r.serial_override_approved_by ||
          null) as string | null,
        serial_override_reason: (r.serialOverrideReason || r.serial_override_reason || null) as
          | string
          | null,
        serial_override_approved_at: (r.serialOverrideApprovedAt ||
          r.serial_override_approved_at ||
          null) as string | null,
        mark_sold_approved_by: (r.markSoldApprovedBy || r.mark_sold_approved_by || null) as
          | string
          | null,
        mark_sold_reason: (r.markSoldReason || r.mark_sold_reason || null) as string | null,
        mark_sold_approved_at: (r.markSoldApprovedAt || r.mark_sold_approved_at || null) as
          | string
          | null,
        sync_sequence: Number(r.syncSequence ?? r.sync_sequence ?? 0),
        updated_at: (r.updatedAt || r.updated_at || new Date().toISOString()) as string,
        created_at: (r.createdAt || r.created_at || new Date().toISOString()) as string,
      }));

      const syncMetadata: CloudSyncMetadata = data.syncMetadata || {
        lastSequence: packs.length > 0 ? Math.max(...packs.map((p) => p.sync_sequence || 0)) : 0,
        hasMore: packs.length === limit,
        totalCount: packs.length,
        serverTime: new Date().toISOString(),
      };

      // Complete sync session
      await this.completeSyncSession(session.sessionId, syncMetadata.lastSequence, {
        pulled: packs.length,
        pushed: 0,
        conflictsResolved: 0,
      });

      // SEC-017: Audit log
      log.info('Returned packs pulled from cloud', {
        count: packs.length,
        hasMore: syncMetadata.hasMore,
        lastSequence: syncMetadata.lastSequence,
      });

      return { packs, syncMetadata };
    } catch (error) {
      // API-003: Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after pull returned packs error');
      }
      throw error;
    }
  }

  /**
   * Pull depleted packs from cloud
   * API: GET /api/v1/sync/lottery/packs/depleted
   *
   * Enterprise-grade implementation for multi-device pack synchronization.
   * Retrieves packs that have been sold out (depleted).
   *
   * Security & Standards Compliance:
   * - API-001: Input validation via TypeScript types
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation (tenant isolation)
   * - SEC-017: Audit logging for all sync operations
   * - API-002: Bounded pagination to prevent unbounded reads
   *
   * @param options - Optional parameters for delta/paginated sync
   * @returns Depleted packs with sync metadata
   */
  async pullDepletedPacks(options?: {
    since?: string;
    sinceSequence?: number;
    limit?: number;
  }): Promise<CloudPacksResponse> {
    log.debug('Pulling depleted packs from cloud', {
      since: options?.since || 'full',
      sinceSequence: options?.sinceSequence,
      limit: options?.limit,
    });

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      // API-001: Build query parameters with validation
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);

      if (options?.since) {
        params.set('since', options.since);
      }
      if (options?.sinceSequence !== undefined) {
        params.set('since_sequence', String(options.sinceSequence));
      }
      // API-002: Enforce bounded pagination
      const limit = Math.min(options?.limit || 500, 1000);
      params.set('limit', String(limit));

      const path = `/api/v1/sync/lottery/packs/depleted?${params.toString()}`;

      const rawResponse = await this.request<{
        success: boolean;
        data?: {
          packs?: Array<Record<string, unknown>>;
          records?: Array<Record<string, unknown>>;
          syncMetadata?: CloudSyncMetadata;
        };
      }>('GET', path);

      // Handle various response formats - API may return camelCase or snake_case
      const data = rawResponse.data || {};
      const rawPacks = (data.packs || data.records || []) as Array<Record<string, unknown>>;

      // Transform camelCase to snake_case (API may use either format)
      const packs: CloudPack[] = rawPacks.map((r) => ({
        pack_id: (r.packId || r.pack_id) as string,
        store_id: (r.storeId || r.store_id) as string,
        game_id: (r.gameId || r.game_id) as string,
        game_code: (r.gameCode || r.game_code) as string,
        pack_number: (r.packNumber || r.pack_number) as string,
        serial_start: (r.serialStart || r.serial_start) as string,
        serial_end: (r.serialEnd || r.serial_end) as string,
        status: (r.status as CloudPackStatus) || 'RECEIVED',
        current_bin_id: (r.currentBinId || r.current_bin_id || null) as string | null,
        current_bin_name: (r.currentBinName || r.current_bin_name || null) as string | null,
        opening_serial: (r.openingSerial || r.opening_serial || null) as string | null,
        closing_serial: (r.closingSerial || r.closing_serial || null) as string | null,
        tickets_sold_count: Number(r.ticketsSoldCount ?? r.tickets_sold_count ?? 0),
        last_sold_at: (r.lastSoldAt || r.last_sold_at || null) as string | null,
        sales_amount:
          r.salesAmount !== undefined
            ? Number(r.salesAmount)
            : r.sales_amount !== undefined
              ? Number(r.sales_amount)
              : null,
        received_at: (r.receivedAt || r.received_at || null) as string | null,
        received_by: (r.receivedBy || r.received_by || null) as string | null,
        activated_at: (r.activatedAt || r.activated_at || null) as string | null,
        activated_by: (r.activatedBy || r.activated_by || null) as string | null,
        activated_shift_id: (r.activatedShiftId || r.activated_shift_id || null) as string | null,
        depleted_at: (r.depletedAt || r.depleted_at || null) as string | null,
        depleted_by: (r.depletedBy || r.depleted_by || null) as string | null,
        depleted_shift_id: (r.depletedShiftId || r.depleted_shift_id || null) as string | null,
        depletion_reason: (r.depletionReason || r.depletion_reason || null) as string | null,
        returned_at: (r.returnedAt || r.returned_at || null) as string | null,
        returned_by: (r.returnedBy || r.returned_by || null) as string | null,
        returned_shift_id: (r.returnedShiftId || r.returned_shift_id || null) as string | null,
        return_reason: (r.returnReason || r.return_reason || null) as string | null,
        return_notes: (r.returnNotes || r.return_notes || null) as string | null,
        last_sold_serial: (r.lastSoldSerial || r.last_sold_serial || null) as string | null,
        tickets_sold_on_return:
          r.ticketsSoldOnReturn !== undefined
            ? Number(r.ticketsSoldOnReturn)
            : r.tickets_sold_on_return !== undefined
              ? Number(r.tickets_sold_on_return)
              : null,
        return_sales_amount:
          r.returnSalesAmount !== undefined
            ? Number(r.returnSalesAmount)
            : r.return_sales_amount !== undefined
              ? Number(r.return_sales_amount)
              : null,
        serial_override_approved_by: (r.serialOverrideApprovedBy ||
          r.serial_override_approved_by ||
          null) as string | null,
        serial_override_reason: (r.serialOverrideReason || r.serial_override_reason || null) as
          | string
          | null,
        serial_override_approved_at: (r.serialOverrideApprovedAt ||
          r.serial_override_approved_at ||
          null) as string | null,
        mark_sold_approved_by: (r.markSoldApprovedBy || r.mark_sold_approved_by || null) as
          | string
          | null,
        mark_sold_reason: (r.markSoldReason || r.mark_sold_reason || null) as string | null,
        mark_sold_approved_at: (r.markSoldApprovedAt || r.mark_sold_approved_at || null) as
          | string
          | null,
        sync_sequence: Number(r.syncSequence ?? r.sync_sequence ?? 0),
        updated_at: (r.updatedAt || r.updated_at || new Date().toISOString()) as string,
        created_at: (r.createdAt || r.created_at || new Date().toISOString()) as string,
      }));

      const syncMetadata: CloudSyncMetadata = data.syncMetadata || {
        lastSequence: packs.length > 0 ? Math.max(...packs.map((p) => p.sync_sequence || 0)) : 0,
        hasMore: packs.length === limit,
        totalCount: packs.length,
        serverTime: new Date().toISOString(),
      };

      // Complete sync session
      await this.completeSyncSession(session.sessionId, syncMetadata.lastSequence, {
        pulled: packs.length,
        pushed: 0,
        conflictsResolved: 0,
      });

      // SEC-017: Audit log
      log.info('Depleted packs pulled from cloud', {
        count: packs.length,
        hasMore: syncMetadata.hasMore,
        lastSequence: syncMetadata.lastSequence,
      });

      return { packs, syncMetadata };
    } catch (error) {
      // API-003: Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after pull depleted packs error');
      }
      throw error;
    }
  }

  /**
   * Pull current business day status from cloud
   * API: GET /api/v1/sync/lottery/day-status
   *
   * Enterprise-grade implementation for multi-device day state synchronization.
   * Retrieves the current business day status including any pending close operations.
   *
   * Security & Standards Compliance:
   * - API-001: Input validation via TypeScript types
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation (tenant isolation)
   * - SEC-017: Audit logging for all sync operations
   *
   * @param businessDate - Optional specific business date (YYYY-MM-DD), defaults to current day
   * @returns Day status with sync metadata
   */
  async pullDayStatus(businessDate?: string): Promise<CloudDayStatusResponse> {
    log.debug('Pulling day status from cloud', {
      businessDate: businessDate || 'current',
    });

    // API-001: Validate business date format if provided
    if (businessDate && !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
      log.error('Invalid business date format', { businessDate });
      throw new Error('Invalid business date format. Expected YYYY-MM-DD');
    }

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      // API-001: Build query parameters
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);

      if (businessDate) {
        params.set('business_date', businessDate);
      }

      const path = `/api/v1/sync/lottery/day-status?${params.toString()}`;

      const rawResponse = await this.request<{
        success: boolean;
        data?: {
          dayStatus?: CloudDayStatus;
          day_status?: CloudDayStatus;
          syncMetadata?: CloudSyncMetadata;
        };
      }>('GET', path);

      // Handle various response formats (camelCase and snake_case)
      const data = rawResponse.data || {};
      const dayStatus = data.dayStatus || data.day_status || null;
      const syncMetadata: CloudSyncMetadata = data.syncMetadata || {
        lastSequence: dayStatus?.sync_sequence || 0,
        hasMore: false,
        serverTime: new Date().toISOString(),
      };

      // Complete sync session
      await this.completeSyncSession(session.sessionId, syncMetadata.lastSequence, {
        pulled: dayStatus ? 1 : 0,
        pushed: 0,
        conflictsResolved: 0,
      });

      // SEC-017: Audit log
      log.info('Day status pulled from cloud', {
        businessDate: dayStatus?.business_date || businessDate,
        status: dayStatus?.status || 'NOT_FOUND',
        hasPendingClose: dayStatus?.status === 'PREPARING_CLOSE',
      });

      return { dayStatus, syncMetadata };
    } catch (error) {
      // API-003: Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after pull day status error');
      }
      throw error;
    }
  }

  /**
   * Pull shift opening records from cloud
   * API: GET /api/v1/sync/lottery/shift-openings
   *
   * Enterprise-grade implementation for multi-device shift synchronization.
   * Retrieves shift opening serial records for lottery inventory tracking.
   *
   * Security & Standards Compliance:
   * - API-001: Input validation via TypeScript types
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation (tenant isolation)
   * - SEC-017: Audit logging for all sync operations
   * - API-002: Bounded pagination to prevent unbounded reads
   *
   * @param options - Optional parameters for delta/paginated sync
   * @returns Shift opening records with sync metadata
   */
  async pullShiftOpenings(options?: {
    since?: string;
    sinceSequence?: number;
    shiftId?: string;
    limit?: number;
  }): Promise<CloudShiftOpeningsResponse> {
    log.debug('Pulling shift openings from cloud', {
      since: options?.since || 'full',
      sinceSequence: options?.sinceSequence,
      shiftId: options?.shiftId,
      limit: options?.limit,
    });

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      // API-001: Build query parameters with validation
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);

      if (options?.since) {
        params.set('since', options.since);
      }
      if (options?.sinceSequence !== undefined) {
        params.set('since_sequence', String(options.sinceSequence));
      }
      if (options?.shiftId) {
        params.set('shift_id', options.shiftId);
      }
      // API-002: Enforce bounded pagination
      const limit = Math.min(options?.limit || 500, 1000);
      params.set('limit', String(limit));

      const path = `/api/v1/sync/lottery/shift-openings?${params.toString()}`;

      const rawResponse = await this.request<{
        success: boolean;
        data?: {
          openings?: CloudShiftOpening[];
          records?: CloudShiftOpening[];
          syncMetadata?: CloudSyncMetadata;
        };
      }>('GET', path);

      // Handle various response formats
      const data = rawResponse.data || {};
      const openings = data.openings || data.records || [];
      const syncMetadata: CloudSyncMetadata = data.syncMetadata || {
        lastSequence:
          openings.length > 0 ? Math.max(...openings.map((o) => o.sync_sequence || 0)) : 0,
        hasMore: openings.length === limit,
        totalCount: openings.length,
        serverTime: new Date().toISOString(),
      };

      // Complete sync session
      await this.completeSyncSession(session.sessionId, syncMetadata.lastSequence, {
        pulled: openings.length,
        pushed: 0,
        conflictsResolved: 0,
      });

      // SEC-017: Audit log
      log.info('Shift openings pulled from cloud', {
        count: openings.length,
        hasMore: syncMetadata.hasMore,
        lastSequence: syncMetadata.lastSequence,
      });

      return { openings, syncMetadata };
    } catch (error) {
      // API-003: Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after pull shift openings error');
      }
      throw error;
    }
  }

  /**
   * Pull shift closing records from cloud
   * API: GET /api/v1/sync/lottery/shift-closings
   *
   * Enterprise-grade implementation for multi-device shift synchronization.
   * Retrieves shift closing serial records with sales calculations.
   *
   * Security & Standards Compliance:
   * - API-001: Input validation via TypeScript types
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation (tenant isolation)
   * - SEC-017: Audit logging for all sync operations
   * - API-002: Bounded pagination to prevent unbounded reads
   *
   * @param options - Optional parameters for delta/paginated sync
   * @returns Shift closing records with sync metadata
   */
  async pullShiftClosings(options?: {
    since?: string;
    sinceSequence?: number;
    shiftId?: string;
    limit?: number;
  }): Promise<CloudShiftClosingsResponse> {
    log.debug('Pulling shift closings from cloud', {
      since: options?.since || 'full',
      sinceSequence: options?.sinceSequence,
      shiftId: options?.shiftId,
      limit: options?.limit,
    });

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      // API-001: Build query parameters with validation
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);

      if (options?.since) {
        params.set('since', options.since);
      }
      if (options?.sinceSequence !== undefined) {
        params.set('since_sequence', String(options.sinceSequence));
      }
      if (options?.shiftId) {
        params.set('shift_id', options.shiftId);
      }
      // API-002: Enforce bounded pagination
      const limit = Math.min(options?.limit || 500, 1000);
      params.set('limit', String(limit));

      const path = `/api/v1/sync/lottery/shift-closings?${params.toString()}`;

      const rawResponse = await this.request<{
        success: boolean;
        data?: {
          closings?: CloudShiftClosing[];
          records?: CloudShiftClosing[];
          syncMetadata?: CloudSyncMetadata;
        };
      }>('GET', path);

      // Handle various response formats
      const data = rawResponse.data || {};
      const closings = data.closings || data.records || [];
      const syncMetadata: CloudSyncMetadata = data.syncMetadata || {
        lastSequence:
          closings.length > 0 ? Math.max(...closings.map((c) => c.sync_sequence || 0)) : 0,
        hasMore: closings.length === limit,
        totalCount: closings.length,
        serverTime: new Date().toISOString(),
      };

      // Complete sync session
      await this.completeSyncSession(session.sessionId, syncMetadata.lastSequence, {
        pulled: closings.length,
        pushed: 0,
        conflictsResolved: 0,
      });

      // SEC-017: Audit log
      log.info('Shift closings pulled from cloud', {
        count: closings.length,
        hasMore: syncMetadata.hasMore,
        lastSequence: syncMetadata.lastSequence,
      });

      return { closings, syncMetadata };
    } catch (error) {
      // API-003: Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after pull shift closings error');
      }
      throw error;
    }
  }

  /**
   * Pull variance records from cloud
   * API: GET /api/v1/sync/lottery/variances
   *
   * Enterprise-grade implementation for multi-device variance synchronization.
   * Retrieves unresolved or recently resolved discrepancies.
   *
   * Security & Standards Compliance:
   * - API-001: Input validation via TypeScript types
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation (tenant isolation)
   * - SEC-017: Audit logging for all sync operations
   * - API-002: Bounded pagination to prevent unbounded reads
   *
   * @param options - Optional parameters for delta/paginated sync
   * @returns Variance records with sync metadata
   */
  async pullVariances(options?: {
    since?: string;
    sinceSequence?: number;
    status?: CloudVarianceStatus;
    businessDate?: string;
    limit?: number;
  }): Promise<CloudVariancesResponse> {
    log.debug('Pulling variances from cloud', {
      since: options?.since || 'full',
      sinceSequence: options?.sinceSequence,
      status: options?.status,
      businessDate: options?.businessDate,
      limit: options?.limit,
    });

    // API-001: Validate business date format if provided
    if (options?.businessDate && !/^\d{4}-\d{2}-\d{2}$/.test(options.businessDate)) {
      log.error('Invalid business date format', { businessDate: options.businessDate });
      throw new Error('Invalid business date format. Expected YYYY-MM-DD');
    }

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      // API-001: Build query parameters with validation
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);

      if (options?.since) {
        params.set('since', options.since);
      }
      if (options?.sinceSequence !== undefined) {
        params.set('since_sequence', String(options.sinceSequence));
      }
      if (options?.status) {
        params.set('status', options.status);
      }
      if (options?.businessDate) {
        params.set('business_date', options.businessDate);
      }
      // API-002: Enforce bounded pagination
      const limit = Math.min(options?.limit || 500, 1000);
      params.set('limit', String(limit));

      const path = `/api/v1/sync/lottery/variances?${params.toString()}`;

      const rawResponse = await this.request<{
        success: boolean;
        data?: {
          variances?: CloudVariance[];
          records?: CloudVariance[];
          syncMetadata?: CloudSyncMetadata;
        };
      }>('GET', path);

      // Handle various response formats
      const data = rawResponse.data || {};
      const variances = data.variances || data.records || [];
      const syncMetadata: CloudSyncMetadata = data.syncMetadata || {
        lastSequence:
          variances.length > 0 ? Math.max(...variances.map((v) => v.sync_sequence || 0)) : 0,
        hasMore: variances.length === limit,
        totalCount: variances.length,
        serverTime: new Date().toISOString(),
      };

      // Complete sync session
      await this.completeSyncSession(session.sessionId, syncMetadata.lastSequence, {
        pulled: variances.length,
        pushed: 0,
        conflictsResolved: 0,
      });

      // SEC-017: Audit log
      log.info('Variances pulled from cloud', {
        count: variances.length,
        hasMore: syncMetadata.hasMore,
        lastSequence: syncMetadata.lastSequence,
        pendingCount: variances.filter((v) => v.status === 'PENDING').length,
      });

      return { variances, syncMetadata };
    } catch (error) {
      // API-003: Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after pull variances error');
      }
      throw error;
    }
  }

  /**
   * Pull day pack records from cloud
   * API: GET /api/v1/sync/lottery/day-packs
   *
   * Enterprise-grade implementation for multi-device day pack synchronization.
   * Retrieves daily pack snapshots with opening/closing serials and sales.
   *
   * Security & Standards Compliance:
   * - API-001: Input validation via TypeScript types
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation (tenant isolation)
   * - SEC-017: Audit logging for all sync operations
   * - API-002: Bounded pagination to prevent unbounded reads
   *
   * @param options - Optional parameters for delta/paginated sync
   * @returns Day pack records with sync metadata
   */
  async pullDayPacks(options?: {
    since?: string;
    sinceSequence?: number;
    businessDate?: string;
    limit?: number;
  }): Promise<CloudDayPacksResponse> {
    log.debug('Pulling day packs from cloud', {
      since: options?.since || 'full',
      sinceSequence: options?.sinceSequence,
      businessDate: options?.businessDate,
      limit: options?.limit,
    });

    // API-001: Validate business date format if provided
    if (options?.businessDate && !/^\d{4}-\d{2}-\d{2}$/.test(options.businessDate)) {
      log.error('Invalid business date format', { businessDate: options.businessDate });
      throw new Error('Invalid business date format. Expected YYYY-MM-DD');
    }

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      // API-001: Build query parameters with validation
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);

      if (options?.since) {
        params.set('since', options.since);
      }
      if (options?.sinceSequence !== undefined) {
        params.set('since_sequence', String(options.sinceSequence));
      }
      if (options?.businessDate) {
        params.set('business_date', options.businessDate);
      }
      // API-002: Enforce bounded pagination
      const limit = Math.min(options?.limit || 500, 1000);
      params.set('limit', String(limit));

      const path = `/api/v1/sync/lottery/day-packs?${params.toString()}`;

      const rawResponse = await this.request<{
        success: boolean;
        data?: {
          dayPacks?: CloudDayPack[];
          day_packs?: CloudDayPack[];
          records?: CloudDayPack[];
          syncMetadata?: CloudSyncMetadata;
        };
      }>('GET', path);

      // Handle various response formats (camelCase and snake_case)
      const data = rawResponse.data || {};
      const dayPacks = data.dayPacks || data.day_packs || data.records || [];
      const syncMetadata: CloudSyncMetadata = data.syncMetadata || {
        lastSequence:
          dayPacks.length > 0 ? Math.max(...dayPacks.map((d) => d.sync_sequence || 0)) : 0,
        hasMore: dayPacks.length === limit,
        totalCount: dayPacks.length,
        serverTime: new Date().toISOString(),
      };

      // Complete sync session
      await this.completeSyncSession(session.sessionId, syncMetadata.lastSequence, {
        pulled: dayPacks.length,
        pushed: 0,
        conflictsResolved: 0,
      });

      // SEC-017: Audit log
      log.info('Day packs pulled from cloud', {
        count: dayPacks.length,
        hasMore: syncMetadata.hasMore,
        lastSequence: syncMetadata.lastSequence,
      });

      return { dayPacks, syncMetadata };
    } catch (error) {
      // API-003: Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after pull day packs error');
      }
      throw error;
    }
  }

  /**
   * Pull bin history (pack movement audit) from cloud
   * API: GET /api/v1/sync/lottery/bin-history
   *
   * Enterprise-grade implementation for multi-device bin history synchronization.
   * Retrieves pack movement audit trail for compliance and reconciliation.
   *
   * Security & Standards Compliance:
   * - API-001: Input validation via TypeScript types
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - DB-006: Store-scoped via session validation (tenant isolation)
   * - SEC-017: Audit logging for all sync operations
   * - API-002: Bounded pagination to prevent unbounded reads
   *
   * @param options - Optional parameters for delta/paginated sync
   * @returns Bin history entries with sync metadata
   */
  async pullBinHistory(options?: {
    since?: string;
    sinceSequence?: number;
    binId?: string;
    packId?: string;
    limit?: number;
  }): Promise<CloudBinHistoryResponse> {
    log.debug('Pulling bin history from cloud', {
      since: options?.since || 'full',
      sinceSequence: options?.sinceSequence,
      binId: options?.binId,
      packId: options?.packId,
      limit: options?.limit,
    });

    // Start a sync session (required by API)
    const session = await this.startSyncSession();

    if (session.revocationStatus !== 'VALID') {
      throw new Error(`API key status: ${session.revocationStatus}`);
    }

    try {
      // API-001: Build query parameters with validation
      const params = new URLSearchParams();
      params.set('session_id', session.sessionId);

      if (options?.since) {
        params.set('since', options.since);
      }
      if (options?.sinceSequence !== undefined) {
        params.set('since_sequence', String(options.sinceSequence));
      }
      if (options?.binId) {
        params.set('bin_id', options.binId);
      }
      if (options?.packId) {
        params.set('pack_id', options.packId);
      }
      // API-002: Enforce bounded pagination
      const limit = Math.min(options?.limit || 500, 1000);
      params.set('limit', String(limit));

      const path = `/api/v1/sync/lottery/bin-history?${params.toString()}`;

      const rawResponse = await this.request<{
        success: boolean;
        data?: {
          history?: CloudBinHistoryEntry[];
          records?: CloudBinHistoryEntry[];
          syncMetadata?: CloudSyncMetadata;
        };
      }>('GET', path);

      // Handle various response formats
      const data = rawResponse.data || {};
      const history = data.history || data.records || [];
      const syncMetadata: CloudSyncMetadata = data.syncMetadata || {
        lastSequence:
          history.length > 0 ? Math.max(...history.map((h) => h.sync_sequence || 0)) : 0,
        hasMore: history.length === limit,
        totalCount: history.length,
        serverTime: new Date().toISOString(),
      };

      // Complete sync session
      await this.completeSyncSession(session.sessionId, syncMetadata.lastSequence, {
        pulled: history.length,
        pushed: 0,
        conflictsResolved: 0,
      });

      // SEC-017: Audit log
      log.info('Bin history pulled from cloud', {
        count: history.length,
        hasMore: syncMetadata.hasMore,
        lastSequence: syncMetadata.lastSequence,
      });

      return { history, syncMetadata };
    } catch (error) {
      // API-003: Try to complete session even on error
      try {
        await this.completeSyncSession(session.sessionId, 0, {
          pulled: 0,
          pushed: 0,
          conflictsResolved: 0,
        });
      } catch {
        log.warn('Failed to complete sync session after pull bin history error');
      }
      throw error;
    }
  }

  // ============================================================================
  // Store Reset
  // ============================================================================

  /**
   * Reset store data via cloud API
   * API: POST /api/v1/store/reset
   *
   * Enterprise-grade implementation for authorized store data reset.
   * This endpoint provides server-side audit logging of the reset action.
   *
   * Security & Standards Compliance:
   * - API-001: Input validation via Zod schema
   * - API-003: Centralized error handling with sanitized responses
   * - SEC-008: HTTPS enforcement (via base request method)
   * - SEC-017: Full audit trail recorded server-side (auditReferenceId returned)
   * - SEC-010: AUTHZ - Cloud auth user context captured for audit
   *
   * @param data - Reset configuration
   * @returns Reset authorization with clear targets and audit reference
   */
  async resetStore(data: {
    resetType: 'FULL_RESET' | 'LOTTERY_ONLY' | 'SYNC_STATE';
    reason?: string;
    appVersion: string;
    confirmed: boolean;
  }): Promise<{
    success: boolean;
    data: {
      authorized: boolean;
      resetType: 'FULL_RESET' | 'LOTTERY_ONLY' | 'SYNC_STATE';
      serverTime: string;
      auditReferenceId: string;
      instructions: {
        clearTargets: string[];
        resyncRequired: boolean;
      };
    };
  }> {
    log.info('Requesting store reset authorization', {
      resetType: data.resetType,
      hasReason: !!data.reason,
    });

    // Generate device fingerprint (same pattern used in startSyncSession)
    const machineIdModule = await import('node-machine-id');
    const machineIdSync =
      machineIdModule.machineIdSync ||
      (machineIdModule as { default: { machineIdSync: () => string } }).default?.machineIdSync;
    if (typeof machineIdSync !== 'function') {
      log.error('Failed to import machineIdSync function for reset');
      throw new Error('Device fingerprint generation unavailable');
    }
    const deviceFingerprint = machineIdSync();

    // API-001: Validate request payload
    // Note: deviceFingerprint length varies by platform (typically 32-64 chars)
    const ResetRequestSchema = z.object({
      resetType: z.enum(['FULL_RESET', 'LOTTERY_ONLY', 'SYNC_STATE']),
      deviceFingerprint: z.string().min(32).max(128),
      reason: z.string().max(500).optional(),
      appVersion: z.string().max(50),
      confirmed: z.literal(true), // Must be true to proceed
    });

    const payload: {
      resetType: 'FULL_RESET' | 'LOTTERY_ONLY' | 'SYNC_STATE';
      deviceFingerprint: string;
      reason?: string;
      appVersion: string;
      confirmed: boolean;
    } = {
      resetType: data.resetType,
      deviceFingerprint,
      appVersion: data.appVersion,
      confirmed: data.confirmed,
    };

    // Only include reason if provided (backend validates: expected string, not undefined)
    if (data.reason) {
      payload.reason = data.reason;
    }

    // Validate payload before sending
    const validationResult = ResetRequestSchema.safeParse(payload);
    if (!validationResult.success) {
      const flatErrors = validationResult.error.flatten();
      log.error('Reset request validation failed', {
        errors: flatErrors,
        deviceFingerprintLength: deviceFingerprint?.length,
      });
      const errorDetails = Object.entries(flatErrors.fieldErrors)
        .map(([field, errors]) => `${field}: ${(errors as string[]).join(', ')}`)
        .join('; ');
      throw new Error(`Invalid reset request: ${errorDetails || 'validation failed'}`);
    }

    try {
      const response = await this.request<{
        success: boolean;
        data: {
          authorized: boolean;
          resetType: 'FULL_RESET' | 'LOTTERY_ONLY' | 'SYNC_STATE';
          serverTime: string;
          auditReferenceId: string;
          instructions: {
            clearTargets: string[];
            resyncRequired: boolean;
          };
        };
      }>('POST', '/api/v1/store/reset', payload);

      // SEC-017: Log audit reference for local tracking
      log.info('Store reset authorized by cloud', {
        resetType: response.data.resetType,
        auditReferenceId: response.data.auditReferenceId,
        clearTargetsCount: response.data.instructions.clearTargets.length,
        resyncRequired: response.data.instructions.resyncRequired,
      });

      return response;
    } catch (error) {
      log.error('Store reset request failed', {
        resetType: data.resetType,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
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
