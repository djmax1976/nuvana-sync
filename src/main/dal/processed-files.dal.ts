/**
 * Processed Files Data Access Layer
 *
 * CRUD operations for tracking processed NAXML files.
 * Used for deduplication to prevent re-processing files.
 *
 * @module main/dal/processed-files
 * @security SEC-006: All queries use prepared statements
 * @security CDP-001: Uses SHA-256 hash for file integrity
 * @security DB-006: Store-scoped for tenant isolation
 */

import { StoreBasedDAL, type StoreEntity, type PaginatedResult } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * File processing status
 */
export type ProcessedFileStatus = 'SUCCESS' | 'FAILED' | 'PARTIAL';

/**
 * Processed file entity
 */
export interface ProcessedFile extends StoreEntity {
  id: string;
  store_id: string;
  file_path: string;
  file_name: string;
  file_hash: string; // SHA-256
  file_size: number;
  document_type: string;
  processed_at: string;
  record_count: number;
  status: ProcessedFileStatus;
  error_message: string | null;
  processing_duration_ms: number | null;
}

/**
 * Processed file creation data
 */
export interface CreateProcessedFileData {
  store_id: string;
  file_path: string;
  file_name: string;
  file_hash: string;
  file_size: number;
  document_type: string;
  record_count?: number;
  status?: ProcessedFileStatus;
  error_message?: string;
  processing_duration_ms?: number;
}

/**
 * File processing statistics
 */
export interface FileProcessingStats {
  totalFiles: number;
  successCount: number;
  failedCount: number;
  partialCount: number;
  totalRecords: number;
  totalSizeBytes: number;
  averageDurationMs: number;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('processed-files-dal');

// ============================================================================
// Processed Files DAL
// ============================================================================

/**
 * Data Access Layer for processed file tracking
 *
 * CDP-001: File hash used for integrity and deduplication
 */
export class ProcessedFilesDAL extends StoreBasedDAL<ProcessedFile> {
  protected readonly tableName = 'processed_files';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'processed_at',
    'file_name',
    'document_type',
    'status',
    'file_size',
    'record_count',
  ]);

  /**
   * Record a processed file
   * SEC-006: Parameterized INSERT
   *
   * @param data - File processing data
   * @returns Created record
   */
  recordFile(data: CreateProcessedFileData): ProcessedFile {
    const id = this.generateId();
    const now = this.now();

    const stmt = this.db.prepare(`
      INSERT INTO processed_files (
        id, store_id, file_path, file_name, file_hash,
        file_size, document_type, processed_at, record_count,
        status, error_message, processing_duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.store_id,
      data.file_path,
      data.file_name,
      data.file_hash,
      data.file_size,
      data.document_type,
      now,
      data.record_count || 0,
      data.status || 'SUCCESS',
      data.error_message || null,
      data.processing_duration_ms || null
    );

    log.info('File recorded', {
      id,
      fileName: data.file_name,
      documentType: data.document_type,
      status: data.status || 'SUCCESS',
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created processed file record: ${id}`);
    }
    return created;
  }

  /**
   * Check if a file has already been processed (by hash)
   * CDP-001: Hash-based deduplication
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param fileHash - SHA-256 hash of file
   * @returns true if file was already processed
   */
  isFileProcessed(storeId: string, fileHash: string): boolean {
    const stmt = this.db.prepare(`
      SELECT 1 FROM processed_files
      WHERE store_id = ? AND file_hash = ?
      LIMIT 1
    `);

    return stmt.get(storeId, fileHash) !== undefined;
  }

  /**
   * Find processed file by hash
   * CDP-001: Hash-based lookup
   *
   * @param storeId - Store identifier
   * @param fileHash - SHA-256 hash
   * @returns Processed file or undefined
   */
  findByHash(storeId: string, fileHash: string): ProcessedFile | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM processed_files
      WHERE store_id = ? AND file_hash = ?
    `);

    return stmt.get(storeId, fileHash) as ProcessedFile | undefined;
  }

  /**
   * Find processed files by date
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param date - Date (YYYY-MM-DD)
   * @returns Array of processed files
   */
  findByDate(storeId: string, date: string): ProcessedFile[] {
    const stmt = this.db.prepare(`
      SELECT * FROM processed_files
      WHERE store_id = ? AND DATE(processed_at) = ?
      ORDER BY processed_at DESC
    `);

    return stmt.all(storeId, date) as ProcessedFile[];
  }

  /**
   * Find processed files by date range
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param startDate - Start date
   * @param endDate - End date
   * @returns Array of processed files
   */
  findByDateRange(storeId: string, startDate: string, endDate: string): ProcessedFile[] {
    const stmt = this.db.prepare(`
      SELECT * FROM processed_files
      WHERE store_id = ? AND DATE(processed_at) >= ? AND DATE(processed_at) <= ?
      ORDER BY processed_at DESC
    `);

    return stmt.all(storeId, startDate, endDate) as ProcessedFile[];
  }

  /**
   * Find processed files by document type
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param documentType - Document type
   * @param limit - Maximum results
   * @returns Array of processed files
   */
  findByDocumentType(storeId: string, documentType: string, limit: number = 100): ProcessedFile[] {
    const stmt = this.db.prepare(`
      SELECT * FROM processed_files
      WHERE store_id = ? AND document_type = ?
      ORDER BY processed_at DESC
      LIMIT ?
    `);

    return stmt.all(storeId, documentType, limit) as ProcessedFile[];
  }

  /**
   * Find failed files for retry
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param limit - Maximum results
   * @returns Array of failed files
   */
  findFailed(storeId: string, limit: number = 100): ProcessedFile[] {
    const stmt = this.db.prepare(`
      SELECT * FROM processed_files
      WHERE store_id = ? AND status = 'FAILED'
      ORDER BY processed_at DESC
      LIMIT ?
    `);

    return stmt.all(storeId, limit) as ProcessedFile[];
  }

  /**
   * Get recent files with pagination
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param limit - Page size
   * @param offset - Skip count
   * @returns Paginated result
   */
  findRecent(
    storeId: string,
    limit: number = 50,
    offset: number = 0
  ): PaginatedResult<ProcessedFile> {
    return this.findByStore(
      storeId,
      { limit, offset },
      {
        column: 'processed_at',
        direction: 'DESC',
      }
    );
  }

  /**
   * Get file processing statistics
   * DB-006: Store-scoped aggregate query
   *
   * @param storeId - Store identifier
   * @param startDate - Optional start date filter
   * @param endDate - Optional end date filter
   * @returns Processing statistics
   */
  getStats(storeId: string, startDate?: string, endDate?: string): FileProcessingStats {
    let query = `
      SELECT
        COUNT(*) as total_files,
        SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed_count,
        SUM(CASE WHEN status = 'PARTIAL' THEN 1 ELSE 0 END) as partial_count,
        COALESCE(SUM(record_count), 0) as total_records,
        COALESCE(SUM(file_size), 0) as total_size_bytes,
        COALESCE(AVG(processing_duration_ms), 0) as avg_duration_ms
      FROM processed_files
      WHERE store_id = ?
    `;

    const params: unknown[] = [storeId];

    if (startDate && endDate) {
      query += ` AND DATE(processed_at) >= ? AND DATE(processed_at) <= ?`;
      params.push(startDate, endDate);
    }

    const stmt = this.db.prepare(query);
    const result = stmt.get(...params) as {
      total_files: number;
      success_count: number;
      failed_count: number;
      partial_count: number;
      total_records: number;
      total_size_bytes: number;
      avg_duration_ms: number;
    };

    return {
      totalFiles: result.total_files,
      successCount: result.success_count,
      failedCount: result.failed_count,
      partialCount: result.partial_count,
      totalRecords: result.total_records,
      totalSizeBytes: result.total_size_bytes,
      averageDurationMs: Math.round(result.avg_duration_ms),
    };
  }

  /**
   * Get counts by document type
   *
   * @param storeId - Store identifier
   * @returns Map of document type to count
   */
  getCountsByDocumentType(storeId: string): Map<string, number> {
    const stmt = this.db.prepare(`
      SELECT document_type, COUNT(*) as count
      FROM processed_files
      WHERE store_id = ?
      GROUP BY document_type
      ORDER BY count DESC
    `);

    const rows = stmt.all(storeId) as Array<{
      document_type: string;
      count: number;
    }>;

    return new Map(rows.map((r) => [r.document_type, r.count]));
  }

  /**
   * Delete old processed file records
   * Used for cleanup to manage database size
   *
   * @param beforeDate - Delete records processed before this date
   * @returns Number of records deleted
   */
  deleteOldRecords(beforeDate: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM processed_files
      WHERE processed_at < ?
    `);

    const result = stmt.run(beforeDate);

    log.info('Old processed file records deleted', {
      count: result.changes,
      beforeDate,
    });

    return result.changes;
  }

  /**
   * Clear processed file records to allow reprocessing
   * Used when parser fixes require re-importing files
   *
   * @param storeId - Store identifier (optional - if not provided, clears ALL stores)
   * @param options - Optional filters (by document type, date range, or with zero records)
   * @returns Number of records cleared
   */
  clearForReprocessing(
    storeId?: string,
    options?: {
      documentType?: string;
      startDate?: string;
      endDate?: string;
      zeroRecordsOnly?: boolean;
    }
  ): number {
    let query = `DELETE FROM processed_files`;
    const params: unknown[] = [];
    const conditions: string[] = [];

    // Only filter by store_id if provided
    if (storeId) {
      conditions.push(`store_id = ?`);
      params.push(storeId);
    }

    if (options?.documentType) {
      conditions.push(`document_type = ?`);
      params.push(options.documentType);
    }

    if (options?.startDate && options?.endDate) {
      conditions.push(`DATE(processed_at) >= ? AND DATE(processed_at) <= ?`);
      params.push(options.startDate, options.endDate);
    }

    if (options?.zeroRecordsOnly) {
      conditions.push(`record_count = 0`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    const stmt = this.db.prepare(query);
    const result = stmt.run(...params);

    log.info('Processed file records cleared for reprocessing', {
      storeId: storeId || 'ALL',
      options,
      count: result.changes,
    });

    return result.changes;
  }

  /**
   * Clear ALL processed file records regardless of store ID
   * Use for maintenance when store IDs may have changed
   *
   * @param options - Optional filters
   * @returns Number of records cleared
   */
  clearAllForReprocessing(options?: { zeroRecordsOnly?: boolean }): number {
    let query = `DELETE FROM processed_files`;

    if (options?.zeroRecordsOnly) {
      query += ` WHERE record_count = 0`;
    }

    const stmt = this.db.prepare(query);
    const result = stmt.run();

    log.info('ALL processed file records cleared for reprocessing', {
      zeroRecordsOnly: options?.zeroRecordsOnly || false,
      count: result.changes,
    });

    return result.changes;
  }

  /**
   * Get total count of ALL processed files regardless of store
   * Used for debugging store ID mismatches
   */
  getTotalCount(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM processed_files`);
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * Get distinct store IDs in processed_files table
   * Used for debugging store ID mismatches
   */
  getDistinctStoreIds(): string[] {
    const stmt = this.db.prepare(`SELECT DISTINCT store_id FROM processed_files`);
    const results = stmt.all() as { store_id: string }[];
    return results.map((r) => r.store_id);
  }

  /**
   * Update file status (e.g., marking failed file as resolved)
   *
   * @param id - File record ID
   * @param status - New status
   * @param errorMessage - Optional error message update
   * @returns Updated record or undefined
   */
  updateStatus(
    id: string,
    status: ProcessedFileStatus,
    errorMessage?: string
  ): ProcessedFile | undefined {
    const updates: string[] = ['status = ?'];
    const params: unknown[] = [status];

    if (errorMessage !== undefined) {
      updates.push('error_message = ?');
      params.push(errorMessage);
    }

    params.push(id);

    const stmt = this.db.prepare(`
      UPDATE processed_files SET ${updates.join(', ')} WHERE id = ?
    `);

    const result = stmt.run(...params);

    if (result.changes === 0) {
      return undefined;
    }

    return this.findById(id);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for processed files operations
 */
export const processedFilesDAL = new ProcessedFilesDAL();
