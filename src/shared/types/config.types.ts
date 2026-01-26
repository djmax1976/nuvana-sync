/**
 * Configuration Types for Nuvana Desktop Application
 *
 * Enterprise-grade type definitions with Zod validation schemas.
 *
 * @module shared/types/config.types
 * @security SEC-014: Strict input validation schemas
 */

import { z } from 'zod';

// ============================================================================
// Validation Schemas (SEC-014: Input Validation)
// ============================================================================

/**
 * API URL validation schema
 * SEC-014: Strict allowlist for URL protocols
 * Allows HTTP for localhost/127.0.0.1 in development, requires HTTPS otherwise
 */
export const ApiUrlSchema = z
  .string()
  .min(1, 'API URL is required')
  .max(500, 'API URL too long')
  .url('Invalid URL format')
  .refine((url) => {
    // Allow HTTP for localhost/127.0.0.1 (development)
    const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1');
    if (isLocalhost) {
      return url.startsWith('http://') || url.startsWith('https://');
    }
    // Require HTTPS for all other URLs (production)
    return url.startsWith('https://');
  }, 'API URL must use HTTPS for security (HTTP only allowed for localhost)');

/**
 * API Key validation schema
 * SEC-014: Pattern validation for API keys
 */
export const ApiKeySchema = z
  .string()
  .min(1, 'API Key is required')
  .max(500, 'API Key too long')
  .regex(/^[a-zA-Z0-9_\-.]+$/, 'API Key contains invalid characters');

/**
 * Store ID validation schema
 * SEC-014: UUID or alphanumeric store IDs
 */
export const StoreIdSchema = z
  .string()
  .min(1, 'Store ID is required')
  .max(100, 'Store ID too long')
  .regex(/^[a-zA-Z0-9\-_]+$/, 'Store ID contains invalid characters');

/**
 * Safe file path validation schema
 * SEC-014: Path traversal prevention
 */
export const SafePathSchema = z
  .string()
  .max(500, 'Path too long')
  .refine((path) => !path.includes('..'), 'Path cannot contain parent directory references (..)')
  .refine((path) => !path.includes('~'), 'Path cannot contain home directory references (~)')
  .refine((path) => !/[<>"|?*]/.test(path), 'Path contains invalid characters');

/**
 * Poll interval validation schema
 * SEC-014: Bounded numeric input
 */
export const PollIntervalSchema = z
  .number()
  .int('Poll interval must be an integer')
  .min(1, 'Poll interval must be at least 1 second')
  .max(3600, 'Poll interval cannot exceed 3600 seconds (1 hour)');

/**
 * Enabled file types schema
 */
export const EnabledFileTypesSchema = z.object({
  pjr: z.boolean(),
  fgm: z.boolean(),
  msm: z.boolean(),
  fpm: z.boolean(),
  mcm: z.boolean(),
  tlm: z.boolean(),
});

/**
 * Complete configuration schema
 * API-001: Schema validation for all config inputs
 */
export const NuvanaConfigSchema = z.object({
  // Cloud connection
  apiUrl: ApiUrlSchema.or(z.literal('')),
  apiKey: z.string().max(500), // Allow empty during setup, encrypted storage
  storeId: StoreIdSchema.or(z.literal('')),

  // File watching
  watchPath: SafePathSchema.or(z.literal('')),
  archivePath: SafePathSchema.or(z.literal('')),
  errorPath: SafePathSchema.or(z.literal('')),
  pollInterval: PollIntervalSchema,

  // File type toggles
  enabledFileTypes: EnabledFileTypesSchema,

  // Behavior
  startOnLogin: z.boolean(),
  minimizeToTray: z.boolean(),
  showNotifications: z.boolean(),
  processInOrder: z.boolean(),

  // State
  isConfigured: z.boolean(),
});

/**
 * Partial configuration schema for updates
 */
export const NuvanaConfigUpdateSchema = NuvanaConfigSchema.partial();

// ============================================================================
// Type Exports
// ============================================================================

export type NuvanaConfig = z.infer<typeof NuvanaConfigSchema>;
export type NuvanaConfigUpdate = z.infer<typeof NuvanaConfigUpdateSchema>;
export type EnabledFileTypes = z.infer<typeof EnabledFileTypesSchema>;

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_CONFIG: NuvanaConfig = {
  apiUrl: '',
  apiKey: '',
  storeId: '',
  watchPath: '',
  archivePath: '',
  errorPath: '',
  pollInterval: 5,
  enabledFileTypes: {
    pjr: true,
    fgm: true,
    msm: true,
    fpm: true,
    mcm: false,
    tlm: false,
  },
  startOnLogin: true,
  minimizeToTray: true,
  showNotifications: true,
  processInOrder: false,
  isConfigured: false,
};

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate full configuration
 * @throws ZodError on validation failure
 */
export function validateConfig(data: unknown): NuvanaConfig {
  return NuvanaConfigSchema.parse(data);
}

/**
 * Safe validation that returns result object
 */
export function safeValidateConfig(data: unknown) {
  return NuvanaConfigSchema.safeParse(data);
}

/**
 * Validate configuration update
 * @throws ZodError on validation failure
 */
export function validateConfigUpdate(data: unknown): NuvanaConfigUpdate {
  return NuvanaConfigUpdateSchema.parse(data);
}

/**
 * Safe validation for config updates
 */
export function safeValidateConfigUpdate(data: unknown) {
  return NuvanaConfigUpdateSchema.safeParse(data);
}

/**
 * Validate file path for security (safe version)
 * Returns validation result object
 */
export function validateSafePath(path: string) {
  return SafePathSchema.safeParse(path);
}

/**
 * Validate file path for security (throwing version)
 * @throws ZodError on validation failure
 */
export function validateSafePathStrict(path: string): string {
  return SafePathSchema.parse(path);
}

// ============================================================================
// Test Connection Types
// ============================================================================

/**
 * Test connection result schema
 */
export const TestConnectionResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  storeInfo: z
    .object({
      name: z.string(),
      id: z.string(),
    })
    .optional(),
});

export type TestConnectionResult = z.infer<typeof TestConnectionResultSchema>;

// ============================================================================
// Terminal Configuration Types (Version 7.0 - POS Terminal Binding)
// ============================================================================

/**
 * POS Connection Type enumeration
 * SEC-014: Strict allowlist validation
 *
 * Determines how the desktop app connects to the POS system:
 * - NETWORK: TCP/IP connection to POS (host:port)
 * - API: REST/HTTP API connection (base_url, api_key)
 * - WEBHOOK: POS pushes data via webhook
 * - FILE: File-based data exchange (import_path, export_path)
 * - MANUAL: No automated connection
 */
export const POSConnectionTypeSchema = z.enum(['NETWORK', 'API', 'WEBHOOK', 'FILE', 'MANUAL']);
export type POSConnectionType = z.infer<typeof POSConnectionTypeSchema>;

/**
 * POS System Type enumeration
 * SEC-014: Strict allowlist validation
 *
 * Identifies the POS system for protocol-specific handling
 */
export const POSSystemTypeSchema = z.enum([
  'GILBARCO_PASSPORT',
  'GILBARCO_NAXML', // File-based NAXML data exchange
  'VERIFONE_RUBY2',
  'VERIFONE_COMMANDER',
  'SQUARE_REST', // Square REST API
  'CLOVER_REST',
  'NCR_RADIANT',
  'INFOR_POS',
  'ORACLE_SIMPHONY',
  'CUSTOM_API',
  'FILE_BASED',
  'MANUAL',
  'MANUAL_ENTRY', // Manual data entry (no POS automation)
  'UNKNOWN',
]);
export type POSSystemType = z.infer<typeof POSSystemTypeSchema>;

/**
 * Terminal Status enumeration
 * SEC-014: Strict allowlist validation
 */
export const POSTerminalStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE', 'OFFLINE']);
export type POSTerminalStatus = z.infer<typeof POSTerminalStatusSchema>;

/**
 * Sync Status enumeration
 * SEC-014: Strict allowlist validation
 */
export const SyncStatusSchema = z.enum(['PENDING', 'SUCCESS', 'FAILED', 'IN_PROGRESS']);
export type SyncStatus = z.infer<typeof SyncStatusSchema>;

/**
 * Normalize connection config field names from camelCase to snake_case
 *
 * The cloud API may return camelCase (importPath) or snake_case (import_path).
 * This function normalizes to snake_case for internal consistency.
 *
 * IMPORTANT: This function preserves all fields - it only renames known camelCase
 * fields to snake_case. Unknown fields are passed through unchanged to support
 * API, NETWORK, and WEBHOOK connection types.
 *
 * SEC-014: Uses Object.hasOwn() for prototype pollution protection
 * API-011: Preserves unknown fields for Zod union validation (Zod rejects invalid)
 *
 * @param data - Raw connection config from cloud API
 * @returns Normalized config with snake_case field names
 */
function normalizeConnectionConfig(data: Record<string, unknown>): Record<string, unknown> {
  // SEC-014: Create clean object to prevent prototype pollution
  // Only copy own enumerable properties, explicitly excluding __proto__ and constructor
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    // SEC-014: Skip dangerous prototype properties
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    normalized[key] = data[key];
  }

  // Normalize FILE config fields: import_path / importPath
  // SEC-014: Use Object.hasOwn for safe property checks
  if (Object.hasOwn(data, 'importPath') && !Object.hasOwn(data, 'import_path')) {
    normalized.import_path = data.importPath;
    delete normalized.importPath;
  }

  // Normalize FILE config fields: export_path / exportPath
  if (Object.hasOwn(data, 'exportPath') && !Object.hasOwn(data, 'export_path')) {
    normalized.export_path = data.exportPath;
    delete normalized.exportPath;
  }

  // Normalize FILE config fields: file_format / fileFormat
  if (Object.hasOwn(data, 'fileFormat') && !Object.hasOwn(data, 'file_format')) {
    normalized.file_format = data.fileFormat;
    delete normalized.fileFormat;
  }

  // Normalize FILE config fields: poll_interval_seconds / pollIntervalSeconds / pollInterval
  if (!Object.hasOwn(data, 'poll_interval_seconds')) {
    if (Object.hasOwn(data, 'pollIntervalSeconds')) {
      normalized.poll_interval_seconds = data.pollIntervalSeconds;
      delete normalized.pollIntervalSeconds;
    } else if (Object.hasOwn(data, 'pollInterval')) {
      normalized.poll_interval_seconds = data.pollInterval;
      delete normalized.pollInterval;
    }
  }

  return normalized;
}

/**
 * File-based connection configuration schema
 * SEC-014: Path traversal prevention for file paths
 *
 * Used when connection_type === 'FILE'
 * Accepts both camelCase (from cloud API) and snake_case field names
 *
 * Note: export_path is optional for read-only ingestion scenarios
 */
export const FileConnectionConfigSchema = z.preprocess(
  // Preprocess: Normalize camelCase to snake_case
  (data) => {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return normalizeConnectionConfig(data as Record<string, unknown>);
    }
    return data;
  },
  z.object({
    /** Path where POS exports files for import - MANDATORY */
    import_path: z
      .string()
      .min(1, 'Import path is required for file-based connection')
      .max(500, 'Import path too long')
      .refine(
        (p) => !p.includes('..'),
        'Import path cannot contain parent directory references (..)'
      ),
    /** Path where app exports files for POS import - OPTIONAL for read-only */
    export_path: z
      .string()
      .max(500, 'Export path too long')
      .refine(
        (p) => !p.includes('..'),
        'Export path cannot contain parent directory references (..)'
      )
      .optional(),
    /** File format (CSV, XML, etc.) */
    file_format: z.string().max(50).optional(),
    /** Poll interval in seconds */
    poll_interval_seconds: z.number().int().min(1).max(3600).optional(),
  })
);
export type FileConnectionConfig = z.infer<typeof FileConnectionConfigSchema>;

/**
 * Network connection configuration schema
 * SEC-014: Strict validation for network parameters
 *
 * Used when connection_type === 'NETWORK'
 */
export const NetworkConnectionConfigSchema = z.object({
  /** Host address - MANDATORY */
  host: z.string().min(1, 'Host is required for network connection').max(255, 'Host too long'),
  /** Port number - MANDATORY */
  port: z
    .number()
    .int('Port must be an integer')
    .min(1, 'Port must be at least 1')
    .max(65535, 'Port cannot exceed 65535'),
  /** Connection timeout in milliseconds */
  timeout_ms: z.number().int().min(1000).max(120000).optional(),
});
export type NetworkConnectionConfig = z.infer<typeof NetworkConnectionConfigSchema>;

/**
 * API connection configuration schema
 * SEC-014: Strict validation for API parameters
 * SEC-008: HTTPS enforcement for non-localhost
 *
 * Used when connection_type === 'API'
 */
export const ApiConnectionConfigSchema = z.object({
  /** Base URL for API - MANDATORY */
  base_url: z
    .string()
    .min(1, 'Base URL is required for API connection')
    .max(500, 'Base URL too long')
    .url('Invalid API base URL format')
    .refine((url) => {
      const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1');
      if (isLocalhost) return true;
      return url.startsWith('https://');
    }, 'API base URL must use HTTPS for security'),
  /** API key for authentication */
  api_key: z.string().max(500).optional(),
  /** Merchant/Store ID for the API */
  merchant_id: z.string().max(100).optional(),
});
export type ApiConnectionConfig = z.infer<typeof ApiConnectionConfigSchema>;

/**
 * Webhook connection configuration schema
 * SEC-014: Strict validation for webhook parameters
 *
 * Used when connection_type === 'WEBHOOK'
 */
export const WebhookConnectionConfigSchema = z.object({
  /** Webhook URL to receive data - MANDATORY */
  webhook_url: z
    .string()
    .min(1, 'Webhook URL is required')
    .max(500, 'Webhook URL too long')
    .url('Invalid webhook URL format'),
  /** Secret for webhook signature verification */
  secret: z.string().max(500).optional(),
});
export type WebhookConnectionConfig = z.infer<typeof WebhookConnectionConfigSchema>;

/**
 * Union type for all connection configurations
 * The actual type depends on connection_type
 */
export const ConnectionConfigSchema = z.union([
  FileConnectionConfigSchema,
  NetworkConnectionConfigSchema,
  ApiConnectionConfigSchema,
  WebhookConnectionConfigSchema,
  z.null(),
]);
export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>;

/**
 * Terminal Sync Record schema
 * SEC-014: Strict input validation for all fields
 * DB-006: Store-scoped terminal configuration
 *
 * This is the complete terminal configuration received from the cloud.
 * ALL fields except device_id, last_sync_at are MANDATORY for setup to proceed.
 */
export const TerminalSyncRecordSchema = z.object({
  /** Terminal UUID - MANDATORY */
  pos_terminal_id: z
    .string()
    .min(1, 'Terminal ID is required')
    .max(100, 'Terminal ID too long')
    .regex(/^[a-zA-Z0-9\-]+$/, 'Terminal ID contains invalid characters'),

  /** Terminal display name - MANDATORY */
  name: z.string().min(1, 'Terminal name is required').max(200, 'Terminal name too long'),

  /** Device identifier (optional) */
  device_id: z.string().max(100).nullable().optional(),

  /** Connection type - MANDATORY */
  connection_type: POSConnectionTypeSchema,

  /**
   * Connection configuration - MANDATORY unless connection_type is MANUAL
   * The structure depends on connection_type:
   * - FILE: { import_path, export_path, file_format?, poll_interval_seconds? }
   * - NETWORK: { host, port, timeout_ms? }
   * - API: { base_url, api_key?, merchant_id? }
   * - WEBHOOK: { webhook_url, secret? }
   * - MANUAL: null
   */
  connection_config: ConnectionConfigSchema,

  /** POS system type - MANDATORY */
  pos_type: POSSystemTypeSchema,

  /** Terminal status - MANDATORY */
  terminal_status: POSTerminalStatusSchema,

  /** Last sync status - MANDATORY */
  sync_status: SyncStatusSchema,

  /** Last successful sync timestamp (ISO 8601) */
  last_sync_at: z.string().nullable().optional(),

  /** Last modified timestamp (ISO 8601) - MANDATORY */
  updated_at: z.string().min(1, 'Updated timestamp is required'),
});
export type TerminalSyncRecord = z.infer<typeof TerminalSyncRecordSchema>;

/**
 * Validate terminal configuration with connection-type-specific rules
 *
 * SEC-014: Comprehensive validation ensuring:
 * 1. All mandatory fields are present
 * 2. Connection config matches connection type
 * 3. Required paths exist for FILE type
 *
 * @param data - Raw terminal data from cloud API
 * @returns Validated TerminalSyncRecord
 * @throws ZodError with detailed field-level errors
 */
export function validateTerminalConfig(data: unknown): TerminalSyncRecord {
  // First pass: basic schema validation
  const terminal = TerminalSyncRecordSchema.parse(data);

  // Second pass: connection-type-specific validation
  if (terminal.connection_type !== 'MANUAL') {
    if (!terminal.connection_config) {
      throw new z.ZodError([
        {
          code: 'custom',
          path: ['connection_config'],
          message: `Connection configuration is required for connection type '${terminal.connection_type}'`,
        },
      ]);
    }

    // Validate specific connection config based on type
    switch (terminal.connection_type) {
      case 'FILE': {
        const result = FileConnectionConfigSchema.safeParse(terminal.connection_config);
        if (!result.success) {
          throw new z.ZodError(
            result.error.issues.map((issue) => ({
              ...issue,
              path: ['connection_config', ...issue.path],
            }))
          );
        }
        break;
      }
      case 'NETWORK': {
        const result = NetworkConnectionConfigSchema.safeParse(terminal.connection_config);
        if (!result.success) {
          throw new z.ZodError(
            result.error.issues.map((issue) => ({
              ...issue,
              path: ['connection_config', ...issue.path],
            }))
          );
        }
        break;
      }
      case 'API': {
        const result = ApiConnectionConfigSchema.safeParse(terminal.connection_config);
        if (!result.success) {
          throw new z.ZodError(
            result.error.issues.map((issue) => ({
              ...issue,
              path: ['connection_config', ...issue.path],
            }))
          );
        }
        break;
      }
      case 'WEBHOOK': {
        const result = WebhookConnectionConfigSchema.safeParse(terminal.connection_config);
        if (!result.success) {
          throw new z.ZodError(
            result.error.issues.map((issue) => ({
              ...issue,
              path: ['connection_config', ...issue.path],
            }))
          );
        }
        break;
      }
    }
  }

  return terminal;
}

/**
 * Terminal validation result type
 */
export type TerminalValidationResult =
  | { success: true; data: TerminalSyncRecord }
  | { success: false; error: z.ZodError };

/**
 * Safe validation for terminal configuration
 * Returns validation result object instead of throwing
 *
 * @param data - Raw terminal data from cloud API
 * @returns Validation result with success flag and data or error
 */
export function safeValidateTerminalConfig(data: unknown): TerminalValidationResult {
  try {
    const result = validateTerminalConfig(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error };
    }
    // Wrap unexpected errors
    return {
      success: false,
      error: new z.ZodError([
        {
          code: 'custom',
          path: [],
          message: error instanceof Error ? error.message : 'Unknown validation error',
        },
      ]),
    };
  }
}

/**
 * Format terminal validation errors into user-friendly messages
 *
 * @param error - ZodError from terminal validation
 * @returns Array of user-friendly error messages
 */
export function formatTerminalValidationErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    if (path) {
      return `${path}: ${issue.message}`;
    }
    return issue.message;
  });
}

/**
 * Get missing mandatory fields from terminal validation error
 *
 * @param error - ZodError from terminal validation
 * @returns Array of missing field names
 */
export function getMissingTerminalFields(error: z.ZodError): string[] {
  return error.issues
    .filter((issue) => issue.code === 'invalid_type' || issue.message.includes('required'))
    .map((issue) => issue.path.join('.'))
    .filter((field) => field.length > 0);
}

// ============================================================================
// POS Connection Configuration Types (Store-Level - New Cloud API Format)
// ============================================================================

/**
 * POS Connection Configuration Schema (Store-Level)
 *
 * This is the NEW cloud API format where POS connection is at the Store level,
 * not bound to specific terminals. Terminals are now discovered dynamically
 * from POS data (e.g., RegisterID in NAXML files).
 *
 * @security SEC-014: Strict input validation for all fields
 * @security SEC-008: HTTPS enforcement for API base URLs
 *
 * Field Mapping from old terminal format:
 * - terminal.pos_type → posConnectionConfig.pos_type
 * - terminal.connection_type → posConnectionConfig.pos_connection_type
 * - terminal.connection_config → posConnectionConfig.pos_connection_config
 */
export const POSConnectionConfigSchema = z.object({
  /**
   * POS system type - identifies the POS for protocol-specific handling
   * MANDATORY
   */
  pos_type: POSSystemTypeSchema,

  /**
   * Connection type - how the desktop app connects to the POS
   * MANDATORY
   */
  pos_connection_type: POSConnectionTypeSchema,

  /**
   * Connection configuration - structure depends on pos_connection_type
   * MANDATORY unless pos_connection_type is MANUAL
   *
   * FILE: { import_path, file_pattern?, poll_interval_seconds? }
   *       (also accepts camelCase: importPath, filePattern, pollIntervalSeconds)
   * API: { base_url, api_key?, location_id?, merchant_id? }
   * NETWORK: { host, port, timeout_ms? }
   * WEBHOOK: { webhook_secret?, expected_source_ips? }
   * MANUAL: null
   */
  pos_connection_config: z.preprocess(
    // Preprocess: Normalize camelCase to snake_case for FILE config
    (data) => {
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        return normalizeConnectionConfig(data as Record<string, unknown>);
      }
      return data;
    },
    z
      .union([
        // FILE connection config (NAXML/XMLGateway)
        // Note: Accepts both camelCase (importPath) and snake_case (import_path)
        z.object({
          import_path: z
            .string()
            .min(1, 'Import path is required for file-based connection')
            .max(500, 'Import path too long')
            .refine(
              (p) => !p.includes('..'),
              'Import path cannot contain parent directory references (..)'
            ),
          export_path: z
            .string()
            .max(500, 'Export path too long')
            .refine(
              (p) => !p.includes('..'),
              'Export path cannot contain parent directory references (..)'
            )
            .optional(),
          file_pattern: z.string().max(100).optional(),
          poll_interval_seconds: z.number().int().min(1).max(3600).optional(),
        }),
        // API connection config (Square, Clover, etc.)
        z.object({
          base_url: z
            .string()
            .min(1, 'Base URL is required for API connection')
            .max(500, 'Base URL too long')
            .url('Invalid API base URL format')
            .refine((url) => {
              const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1');
              if (isLocalhost) return true;
              return url.startsWith('https://');
            }, 'API base URL must use HTTPS for security'),
          api_key: z.string().max(500).optional(),
          location_id: z.string().max(100).optional(),
          merchant_id: z.string().max(100).optional(),
        }),
        // NETWORK connection config (Direct TCP/IP)
        z.object({
          host: z
            .string()
            .min(1, 'Host is required for network connection')
            .max(255, 'Host too long'),
          port: z
            .number()
            .int('Port must be an integer')
            .min(1, 'Port must be at least 1')
            .max(65535, 'Port cannot exceed 65535'),
          timeout_ms: z.number().int().min(1000).max(120000).optional(),
        }),
        // WEBHOOK connection config
        z.object({
          webhook_secret: z.string().max(500).optional(),
          expected_source_ips: z.array(z.string().max(45)).optional(),
        }),
        // MANUAL - no config needed
        z.null(),
      ])
      .nullable()
  ),
});

export type POSConnectionConfig = z.infer<typeof POSConnectionConfigSchema>;

/**
 * Validate POS connection configuration with connection-type-specific rules
 *
 * SEC-014: Comprehensive validation ensuring:
 * 1. All mandatory fields are present
 * 2. Connection config matches connection type
 * 3. Required paths/URLs exist for respective types
 *
 * @param data - Raw POS connection config from cloud API
 * @returns Validated POSConnectionConfig
 * @throws ZodError with detailed field-level errors
 */
export function validatePOSConnectionConfig(data: unknown): POSConnectionConfig {
  // First pass: basic schema validation
  const config = POSConnectionConfigSchema.parse(data);

  // Second pass: connection-type-specific validation
  if (config.pos_connection_type !== 'MANUAL') {
    if (!config.pos_connection_config) {
      throw new z.ZodError([
        {
          code: 'custom',
          path: ['pos_connection_config'],
          message: `Connection configuration is required for connection type '${config.pos_connection_type}'`,
        },
      ]);
    }

    // Validate specific config based on type
    switch (config.pos_connection_type) {
      case 'FILE': {
        const fileConfig = config.pos_connection_config as { import_path?: string };
        if (!fileConfig.import_path) {
          throw new z.ZodError([
            {
              code: 'custom',
              path: ['pos_connection_config', 'import_path'],
              message: 'Import path is required for FILE connection type',
            },
          ]);
        }
        break;
      }
      case 'API': {
        const apiConfig = config.pos_connection_config as { base_url?: string };
        if (!apiConfig.base_url) {
          throw new z.ZodError([
            {
              code: 'custom',
              path: ['pos_connection_config', 'base_url'],
              message: 'Base URL is required for API connection type',
            },
          ]);
        }
        break;
      }
      case 'NETWORK': {
        const netConfig = config.pos_connection_config as { host?: string; port?: number };
        if (!netConfig.host || netConfig.port === undefined) {
          throw new z.ZodError([
            {
              code: 'custom',
              path: ['pos_connection_config'],
              message: 'Host and port are required for NETWORK connection type',
            },
          ]);
        }
        break;
      }
      // WEBHOOK doesn't have mandatory fields in config
    }
  }

  return config;
}

/**
 * Safe validation for POS connection configuration
 * Returns validation result object instead of throwing
 *
 * @param data - Raw POS connection config from cloud API
 * @returns Validation result with success flag and data or error
 */
export function safeValidatePOSConnectionConfig(
  data: unknown
): { success: true; data: POSConnectionConfig } | { success: false; error: z.ZodError } {
  try {
    const result = validatePOSConnectionConfig(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error };
    }
    return {
      success: false,
      error: new z.ZodError([
        {
          code: 'custom',
          path: [],
          message: error instanceof Error ? error.message : 'Unknown validation error',
        },
      ]),
    };
  }
}

/**
 * Format POS connection validation errors into user-friendly messages
 *
 * @param error - ZodError from POS connection validation
 * @returns Array of user-friendly error messages
 */
export function formatPOSConnectionValidationErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    if (path) {
      return `${path}: ${issue.message}`;
    }
    return issue.message;
  });
}

/**
 * Convert old terminal config format to new POSConnectionConfig format
 *
 * This function provides backward compatibility by mapping the old
 * terminal-level config to the new store-level POS connection config.
 *
 * @param terminal - Old TerminalSyncRecord format
 * @returns POSConnectionConfig in new format
 */
export function convertTerminalToPOSConnectionConfig(
  terminal: TerminalSyncRecord
): POSConnectionConfig {
  // Type assertion is safe here because the connection_config structures are compatible
  // The old terminal format's connection_config is a subset of the new POSConnectionConfig
  return {
    pos_type: terminal.pos_type,
    pos_connection_type: terminal.connection_type,
    pos_connection_config:
      terminal.connection_config as POSConnectionConfig['pos_connection_config'],
  };
}
