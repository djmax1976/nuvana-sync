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
