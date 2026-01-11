/**
 * Configuration Types for Nuvana Sync Desktop Application
 *
 * Enterprise-grade type definitions with Zod validation schemas.
 *
 * @module shared/types/config.types
 * @security SEC-014: Strict input validation schemas
 */

import { z } from "zod";

// ============================================================================
// Validation Schemas (SEC-014: Input Validation)
// ============================================================================

/**
 * API URL validation schema
 * SEC-014: Strict allowlist for URL protocols
 */
export const ApiUrlSchema = z
  .string()
  .min(1, "API URL is required")
  .max(500, "API URL too long")
  .url("Invalid URL format")
  .refine(
    (url) => url.startsWith("https://"),
    "API URL must use HTTPS for security"
  );

/**
 * API Key validation schema
 * SEC-014: Pattern validation for API keys
 */
export const ApiKeySchema = z
  .string()
  .min(1, "API Key is required")
  .max(500, "API Key too long")
  .regex(
    /^[a-zA-Z0-9_\-\.]+$/,
    "API Key contains invalid characters"
  );

/**
 * Store ID validation schema
 * SEC-014: UUID or alphanumeric store IDs
 */
export const StoreIdSchema = z
  .string()
  .min(1, "Store ID is required")
  .max(100, "Store ID too long")
  .regex(
    /^[a-zA-Z0-9\-_]+$/,
    "Store ID contains invalid characters"
  );

/**
 * Safe file path validation schema
 * SEC-014: Path traversal prevention
 */
export const SafePathSchema = z
  .string()
  .max(500, "Path too long")
  .refine(
    (path) => !path.includes(".."),
    "Path cannot contain parent directory references (..)"
  )
  .refine(
    (path) => !path.includes("~"),
    "Path cannot contain home directory references (~)"
  )
  .refine(
    (path) => !/[<>"|?*]/.test(path),
    "Path contains invalid characters"
  );

/**
 * Poll interval validation schema
 * SEC-014: Bounded numeric input
 */
export const PollIntervalSchema = z
  .number()
  .int("Poll interval must be an integer")
  .min(1, "Poll interval must be at least 1 second")
  .max(3600, "Poll interval cannot exceed 3600 seconds (1 hour)");

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
export const NuvanaSyncConfigSchema = z.object({
  // Cloud connection
  apiUrl: ApiUrlSchema.or(z.literal("")),
  apiKey: z.string().max(500), // Allow empty during setup, encrypted storage
  storeId: StoreIdSchema.or(z.literal("")),

  // File watching
  watchPath: SafePathSchema.or(z.literal("")),
  archivePath: SafePathSchema.or(z.literal("")),
  errorPath: SafePathSchema.or(z.literal("")),
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
export const NuvanaSyncConfigUpdateSchema = NuvanaSyncConfigSchema.partial();

// ============================================================================
// Type Exports
// ============================================================================

export type NuvanaSyncConfig = z.infer<typeof NuvanaSyncConfigSchema>;
export type NuvanaSyncConfigUpdate = z.infer<typeof NuvanaSyncConfigUpdateSchema>;
export type EnabledFileTypes = z.infer<typeof EnabledFileTypesSchema>;

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_CONFIG: NuvanaSyncConfig = {
  apiUrl: "",
  apiKey: "",
  storeId: "",
  watchPath: "",
  archivePath: "",
  errorPath: "",
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
export function validateConfig(data: unknown): NuvanaSyncConfig {
  return NuvanaSyncConfigSchema.parse(data);
}

/**
 * Safe validation that returns result object
 */
export function safeValidateConfig(data: unknown) {
  return NuvanaSyncConfigSchema.safeParse(data);
}

/**
 * Validate configuration update
 * @throws ZodError on validation failure
 */
export function validateConfigUpdate(data: unknown): NuvanaSyncConfigUpdate {
  return NuvanaSyncConfigUpdateSchema.parse(data);
}

/**
 * Safe validation for config updates
 */
export function safeValidateConfigUpdate(data: unknown) {
  return NuvanaSyncConfigUpdateSchema.safeParse(data);
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
