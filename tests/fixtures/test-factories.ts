/**
 * Test Factory Functions
 *
 * Enterprise-grade type-safe factory functions for test fixtures.
 * These ensure tests always use valid type values and complete objects.
 *
 * @module tests/fixtures/test-factories
 *
 * WHY THIS EXISTS:
 * - Prevents type mismatches in test mocks (e.g., 'SQUARE' vs 'SQUARE_REST')
 * - Provides complete default values for complex types
 * - Single source of truth for test data - changes propagate automatically
 * - TypeScript will catch errors at compile time, not CI runtime
 */

import type { ValidateApiKeyResponse } from '../../src/main/services/cloud-api.service';
import type { ApiKeyValidationResult } from '../../src/main/services/settings.service';
import type {
  POSSystemType,
  POSConnectionType,
  POSConnectionConfig,
} from '../../src/shared/types/config.types';

// =============================================================================
// POS System Type Constants
// =============================================================================
// ALWAYS import these instead of using string literals in tests!
// This ensures compile-time type checking catches invalid values.

export const POS_TYPES = {
  GILBARCO_PASSPORT: 'GILBARCO_PASSPORT',
  GILBARCO_NAXML: 'GILBARCO_NAXML',
  VERIFONE_RUBY2: 'VERIFONE_RUBY2',
  VERIFONE_COMMANDER: 'VERIFONE_COMMANDER',
  SQUARE_REST: 'SQUARE_REST', // Note: NOT 'SQUARE'
  CLOVER_REST: 'CLOVER_REST', // Note: NOT 'CLOVER'
  NCR_RADIANT: 'NCR_RADIANT',
  INFOR_POS: 'INFOR_POS',
  ORACLE_SIMPHONY: 'ORACLE_SIMPHONY',
  CUSTOM_API: 'CUSTOM_API',
  FILE_BASED: 'FILE_BASED',
  MANUAL: 'MANUAL',
  MANUAL_ENTRY: 'MANUAL_ENTRY',
  UNKNOWN: 'UNKNOWN',
} as const satisfies Record<string, POSSystemType>;

export const POS_CONNECTION_TYPES = {
  FILE: 'FILE',
  API: 'API',
  NETWORK: 'NETWORK',
  WEBHOOK: 'WEBHOOK',
  MANUAL: 'MANUAL',
} as const satisfies Record<string, POSConnectionType>;

// =============================================================================
// ValidateApiKeyResponse Factory
// =============================================================================

type ValidateApiKeyResponseOverrides = Partial<ValidateApiKeyResponse> & {
  posConnectionConfig?: Partial<POSConnectionConfig>;
  lottery?: Partial<ValidateApiKeyResponse['lottery']>;
};

/**
 * Creates a complete ValidateApiKeyResponse with type-safe defaults.
 *
 * @example
 * ```ts
 * // Minimal usage - gets all required defaults
 * const response = createValidateApiKeyResponse();
 *
 * // With overrides - type-safe partial updates
 * const response = createValidateApiKeyResponse({
 *   storeId: 'my-store',
 *   posConnectionConfig: { pos_type: POS_TYPES.SQUARE_REST },
 * });
 * ```
 */
export function createValidateApiKeyResponse(
  overrides: ValidateApiKeyResponseOverrides = {}
): ValidateApiKeyResponse {
  const { posConnectionConfig: posConfigOverrides, lottery: lotteryOverrides, ...rest } = overrides;

  return {
    valid: true,
    storeId: 'test-store-id',
    storeName: 'Test Store',
    storePublicId: 'test-store-public-id',
    companyId: 'test-company-id',
    companyName: 'Test Company',
    timezone: 'America/New_York',
    stateCode: 'NY',
    features: [],
    offlinePermissions: [],
    offlineToken: 'test-offline-token',
    offlineTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    lottery: {
      enabled: false,
      binCount: 0,
      ...lotteryOverrides,
    },
    posConnectionConfig: createPOSConnectionConfig(posConfigOverrides),
    ...rest,
  };
}

// =============================================================================
// POSConnectionConfig Factory
// =============================================================================

type POSConnectionConfigOverrides = Partial<POSConnectionConfig>;

/**
 * Creates a complete POSConnectionConfig with type-safe defaults.
 *
 * @example
 * ```ts
 * // Default: Gilbarco Passport with FILE connection
 * const config = createPOSConnectionConfig();
 *
 * // Square REST API connection
 * const config = createPOSConnectionConfig({
 *   pos_type: POS_TYPES.SQUARE_REST,
 *   pos_connection_type: POS_CONNECTION_TYPES.API,
 *   pos_connection_config: { base_url: 'https://api.squareup.com' },
 * });
 * ```
 */
export function createPOSConnectionConfig(
  overrides: POSConnectionConfigOverrides = {}
): POSConnectionConfig {
  const posType = overrides.pos_type ?? POS_TYPES.GILBARCO_PASSPORT;
  const connectionType = overrides.pos_connection_type ?? POS_CONNECTION_TYPES.FILE;

  // Provide appropriate default config based on connection type
  let defaultConnectionConfig: Record<string, unknown>;
  if (connectionType === 'FILE') {
    defaultConnectionConfig = { import_path: 'C:\\NAXML\\Export' };
  } else if (connectionType === 'API') {
    defaultConnectionConfig = { base_url: 'https://api.example.com' };
  } else {
    defaultConnectionConfig = {};
  }

  return {
    pos_type: posType,
    pos_connection_type: connectionType,
    pos_connection_config: overrides.pos_connection_config ?? defaultConnectionConfig,
  } as POSConnectionConfig;
}

// =============================================================================
// ApiKeyValidationResult Factory
// =============================================================================

type ApiKeyValidationResultOverrides = Partial<Omit<ApiKeyValidationResult, 'store'>> & {
  store?: ValidateApiKeyResponseOverrides | null;
};

/**
 * Creates a complete ApiKeyValidationResult (return type of validateAndSaveApiKey).
 *
 * @example
 * ```ts
 * // Successful validation
 * const result = createApiKeyValidationResult({
 *   valid: true,
 *   store: { storeId: 'my-store' },
 * });
 *
 * // Failed validation
 * const result = createApiKeyValidationResult({
 *   valid: false,
 *   error: 'Invalid API key',
 * });
 * ```
 */
export function createApiKeyValidationResult(
  overrides: ApiKeyValidationResultOverrides = {}
): ApiKeyValidationResult {
  const { store: storeOverrides, ...rest } = overrides;

  return {
    valid: true,
    store: storeOverrides === null ? undefined : createValidateApiKeyResponse(storeOverrides),
    ...rest,
  };
}

// =============================================================================
// AppSettings Factory
// =============================================================================

export interface AppSettingsOverrides {
  storeId?: string;
  storeName?: string;
  companyId?: string;
  companyName?: string;
  timezone?: string;
  features?: string[];
  xmlWatchFolder?: string;
  syncIntervalSeconds?: number;
  businessDayCutoffTime?: string;
  lottery?: { enabled: boolean; binCount: number };
  setupCompletedAt?: string | null;
  posConnectionConfig?: POSConnectionConfigOverrides;
}

/**
 * Creates AppSettings object with type-safe defaults.
 *
 * @example
 * ```ts
 * // Square POS settings
 * const settings = createAppSettings({
 *   posConnectionConfig: {
 *     pos_type: POS_TYPES.SQUARE_REST,
 *     pos_connection_type: POS_CONNECTION_TYPES.API,
 *     pos_connection_config: { base_url: 'https://api.squareup.com' },
 *   },
 * });
 * ```
 */
export function createAppSettings(overrides: AppSettingsOverrides = {}) {
  const { posConnectionConfig: posConfigOverrides, ...rest } = overrides;

  return {
    storeId: 'test-store-id',
    storeName: 'Test Store',
    companyId: 'test-company-id',
    companyName: 'Test Company',
    timezone: 'America/New_York',
    features: [],
    xmlWatchFolder: '',
    syncIntervalSeconds: 60,
    businessDayCutoffTime: '06:00',
    lottery: { enabled: false, binCount: 0 },
    setupCompletedAt: null,
    posConnectionConfig: createPOSConnectionConfig(posConfigOverrides),
    ...rest,
  };
}
