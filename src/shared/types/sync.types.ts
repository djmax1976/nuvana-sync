/**
 * Sync Types for Nuvana Desktop Application
 *
 * Type definitions for sync operations and file processing.
 *
 * @module shared/types/sync.types
 * @security SEC-014: Strict input validation schemas
 */

import { z } from 'zod';

// ============================================================================
// Document Type Definitions
// ============================================================================

/**
 * NAXML document types supported by the sync service
 * SEC-014: Strict allowlist for document types
 */
export const NAXMLDocumentTypeSchema = z.enum([
  'POSJournal',
  'FuelGradeMovement',
  'MiscellaneousSummaryMovement',
  'FuelProductMovement',
  'MerchandiseCodeMovement',
  'TaxLevelMovement',
  'ItemSalesMovement',
  'TankProductMovement',
  'Unknown',
]);

export type NAXMLDocumentType = z.infer<typeof NAXMLDocumentTypeSchema>;

// ============================================================================
// File Record Types
// ============================================================================

/**
 * File processing status
 */
export const FileStatusSchema = z.enum(['queued', 'processing', 'success', 'error']);

export type FileStatus = z.infer<typeof FileStatusSchema>;

/**
 * File record schema for tracking processed files
 */
export const FileRecordSchema = z.object({
  filePath: z.string(),
  fileName: z.string().max(255),
  status: FileStatusSchema,
  timestamp: z.date(),
  error: z.string().optional(),
  documentType: NAXMLDocumentTypeSchema.optional(),
});

export type FileRecord = z.infer<typeof FileRecordSchema>;

// ============================================================================
// Sync Stats Types
// ============================================================================

/**
 * Sync statistics schema
 */
export const SyncStatsSchema = z.object({
  filesProcessed: z.number().int().min(0),
  filesErrored: z.number().int().min(0),
  lastSyncTime: z.date().nullable(),
  isWatching: z.boolean(),
});

export type SyncStats = z.infer<typeof SyncStatsSchema>;

// ============================================================================
// Upload Payload Types
// ============================================================================

/**
 * SHA-256 hash validation (64 hex characters)
 */
export const FileHashSchema = z.string().regex(/^[a-f0-9]{64}$/i, 'Invalid SHA-256 hash format');

/**
 * Upload payload schema
 * API-001: Strict validation for API payloads
 */
export const UploadPayloadSchema = z.object({
  documentType: NAXMLDocumentTypeSchema,
  data: z.unknown(),
  fileName: z
    .string()
    .min(1, 'File name is required')
    .max(255, 'File name too long')
    .regex(/^[\w\-. ]+\.xml$/i, 'Invalid file name format'),
  fileHash: FileHashSchema,
});

export type UploadPayload = z.infer<typeof UploadPayloadSchema>;

/**
 * Upload response schema
 */
export const UploadResponseSchema = z.object({
  success: z.boolean(),
  syncLogId: z.string().uuid().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

export type UploadResponse = z.infer<typeof UploadResponseSchema>;

/**
 * Test connection response schema
 */
export const TestConnectionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  storeInfo: z
    .object({
      name: z.string(),
      id: z.string(),
    })
    .optional(),
});

export type TestConnectionResponse = z.infer<typeof TestConnectionResponseSchema>;

// ============================================================================
// IPC Message Types
// ============================================================================

/**
 * Sync status event types
 */
export const SyncStatusEventTypeSchema = z.enum([
  'file-detected',
  'file-processed',
  'file-error',
  'watcher-ready',
  'watcher-error',
]);

export type SyncStatusEventType = z.infer<typeof SyncStatusEventTypeSchema>;

/**
 * Sync status event payload
 */
export const SyncStatusEventSchema = z.object({
  type: SyncStatusEventTypeSchema,
  filePath: z.string().optional(),
  success: z.boolean().optional(),
  error: z.string().optional(),
});

export type SyncStatusEvent = z.infer<typeof SyncStatusEventSchema>;

// ============================================================================
// Validation Functions
// ============================================================================

export function validateUploadPayload(data: unknown): UploadPayload {
  return UploadPayloadSchema.parse(data);
}

export function safeValidateUploadPayload(data: unknown) {
  return UploadPayloadSchema.safeParse(data);
}

export function validateUploadResponse(data: unknown): UploadResponse {
  return UploadResponseSchema.parse(data);
}

export function validateFileRecord(data: unknown): FileRecord {
  return FileRecordSchema.parse(data);
}

export function validateSyncStats(data: unknown): SyncStats {
  return SyncStatsSchema.parse(data);
}

// ============================================================================
// Sync Queue Entity Types
// ============================================================================

/**
 * Valid sync entity types that have corresponding cloud API push endpoints
 *
 * API-001: VALIDATION - Whitelist of entity types with valid push endpoints
 * API-008: OUTPUT_FILTERING - Only these types should be enqueued for sync
 *
 * Based on api.md specification (Section 4: PUSH DATA):
 * - pack: /api/v1/sync/lottery/packs/receive, activate, deplete, return, move
 * - shift_opening: /api/v1/sync/lottery/shift/open
 * - shift_closing: /api/v1/sync/lottery/shift/close
 * - day_open: /api/v1/sync/lottery/day/open
 * - day_close: /api/v1/sync/lottery/day/prepare-close, commit-close, cancel-close
 * - variance_approval: /api/v1/sync/lottery/variances/approve
 *
 * Entity types WITHOUT push endpoints (pull-only or unsupported):
 * - employee: Cloud-managed, pulled from cloud, never pushed
 * - lottery_bin: Pulled from cloud via /api/v1/sync/lottery/bins
 * - day_summary: Calculated server-side, no push endpoint
 * - shift: No dedicated push endpoint (use shift_opening/shift_closing)
 *
 * @security SEC-014: Strict type validation prevents invalid entity types
 */
export const ValidSyncEntityTypeSchema = z.enum([
  'pack',
  'shift_opening',
  'shift_closing',
  'day_open',
  'day_close',
  'variance_approval',
  'transaction',
]);

export type ValidSyncEntityType = z.infer<typeof ValidSyncEntityTypeSchema>;

/**
 * Array of valid sync entity types for runtime validation
 * Used by sync-queue.dal.ts to validate entity types before enqueue
 */
export const VALID_SYNC_ENTITY_TYPES: readonly ValidSyncEntityType[] = [
  'pack',
  'shift_opening',
  'shift_closing',
  'day_open',
  'day_close',
  'variance_approval',
  'transaction',
] as const;

/**
 * Type guard to check if an entity type is valid for sync
 * API-001: VALIDATION - Runtime check before enqueue
 *
 * @param entityType - Entity type to validate
 * @returns true if entity type has a valid cloud API push endpoint
 */
export function isValidSyncEntityType(entityType: string): entityType is ValidSyncEntityType {
  return VALID_SYNC_ENTITY_TYPES.includes(entityType as ValidSyncEntityType);
}
