/**
 * Sync Log Data Access Layer
 *
 * CRUD operations for sync operation logging and history.
 * Records sync operations for auditing and troubleshooting.
 *
 * @module main/dal/sync-log
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 * @security DB-008: Query logging with parameter redaction
 */

import { StoreBasedDAL, type StoreEntity, type PaginationOptions, type PaginatedResult } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Sync operation type
 */
export type SyncType = 'PUSH' | 'PULL';

/**
 * Sync log status
 */
export type SyncLogStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

/**
 * Sync log entity
 */
export interface SyncLog extends StoreEntity {
  id: string;
  store_id: string;
  sync_type: SyncType;
  status: SyncLogStatus;
  records_sent: number;
  records_succeeded: number;
  records_failed: number;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  details: string | null; // JSON for additional metadata
  created_at: string;
}

/**
 * Sync statistics for a store
 */
export interface SyncStats {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  lastSyncAt: string | null;
  lastSyncStatus: SyncLogStatus | null;
  totalRecordsSynced: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum log entries to return in a single query */
const MAX_LOG_LIMIT = 500;

/** Default log entries per query */
const DEFAULT_LOG_LIMIT = 50;

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('sync-log-dal');

// ============================================================================
// Sync Log DAL
// ============================================================================

/**
 * Data Access Layer for sync operation logging
 *
 * Provides persistent storage for sync operation history:
 * - Start/complete/fail sync operations
 * - Query sync history with pagination
 * - Calculate sync statistics
 *
 * SEC-006: All queries use prepared statements
 * DB-006: All queries scoped by store_id
 */
export class SyncLogDAL extends StoreBasedDAL<SyncLog> {
  protected readonly tableName = 'sync_log';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'started_at',
    'completed_at',
    'sync_type',
    'status',
    'records_sent',
  ]);

  /**
   * Start a new sync operation and create a log entry
   * SEC-006: Parameterized INSERT
   *
   * @param storeId - Store identifier
   * @param syncType - Type of sync operation (PUSH or PULL)
   * @returns The created sync log ID
   */
  startSync(storeId: string, syncType: SyncType): string {
    const id = this.generateId();
    const now = this.now();

    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      INSERT INTO sync_log (
        id, store_id, sync_type, status,
        records_sent, records_succeeded, records_failed,
        started_at, created_at
      ) VALUES (?, ?, ?, 'RUNNING', 0, 0, 0, ?, ?)
    `);

    stmt.run(id, storeId, syncType, now, now);

    log.info('Sync operation started', {
      syncLogId: id,
      storeId,
      syncType,
    });

    return id;
  }

  /**
   * Complete a sync operation with results
   * SEC-006: Parameterized UPDATE
   *
   * @param id - Sync log ID
   * @param results - Sync operation results
   */
  completeSync(
    id: string,
    results: {
      records_sent: number;
      records_succeeded: number;
      records_failed: number;
      details?: Record<string, unknown>;
    }
  ): void {
    const now = this.now();

    const stmt = this.db.prepare(`
      UPDATE sync_log SET
        status = 'COMPLETED',
        records_sent = ?,
        records_succeeded = ?,
        records_failed = ?,
        completed_at = ?,
        details = ?
      WHERE id = ?
    `);

    stmt.run(
      results.records_sent,
      results.records_succeeded,
      results.records_failed,
      now,
      results.details ? JSON.stringify(results.details) : null,
      id
    );

    log.info('Sync operation completed', {
      syncLogId: id,
      recordsSent: results.records_sent,
      recordsSucceeded: results.records_succeeded,
      recordsFailed: results.records_failed,
    });
  }

  /**
   * Mark a sync operation as failed
   * SEC-006: Parameterized UPDATE
   * API-003: Error message stored but not leaked to client
   *
   * @param id - Sync log ID
   * @param errorMessage - Error description (logged server-side only)
   * @param details - Optional additional error context
   */
  failSync(id: string, errorMessage: string, details?: Record<string, unknown>): void {
    const now = this.now();

    // Truncate error message to prevent excessive storage
    const truncatedError = errorMessage.substring(0, 1000);

    const stmt = this.db.prepare(`
      UPDATE sync_log SET
        status = 'FAILED',
        completed_at = ?,
        error_message = ?,
        details = ?
      WHERE id = ?
    `);

    stmt.run(now, truncatedError, details ? JSON.stringify(details) : null, id);

    log.error('Sync operation failed', {
      syncLogId: id,
      // SEC-017: Log error for audit without exposing in response
      error: truncatedError,
    });
  }

  /**
   * Get recent sync logs for a store
   * SEC-006: Parameterized query
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param limit - Maximum logs to return (default: 50, max: 500)
   * @returns Array of sync logs ordered by started_at DESC
   */
  getRecentLogs(storeId: string, limit: number = DEFAULT_LOG_LIMIT): SyncLog[] {
    const safeLimit = Math.min(Math.max(1, limit), MAX_LOG_LIMIT);

    const stmt = this.db.prepare(`
      SELECT * FROM sync_log
      WHERE store_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `);

    return stmt.all(storeId, safeLimit) as SyncLog[];
  }

  /**
   * Get paginated sync logs for a store
   * SEC-006: Parameterized query with bounded pagination
   *
   * @param storeId - Store identifier
   * @param options - Pagination options
   * @returns Paginated sync logs
   */
  getLogsPaginated(storeId: string, options: Partial<PaginationOptions> = {}): PaginatedResult<SyncLog> {
    const limit = Math.min(options.limit || DEFAULT_LOG_LIMIT, MAX_LOG_LIMIT);
    const offset = options.offset || 0;

    // Get total count for store
    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM sync_log WHERE store_id = ?
    `);
    const countResult = countStmt.get(storeId) as { count: number };
    const total = countResult.count;

    // Get paginated data
    const dataStmt = this.db.prepare(`
      SELECT * FROM sync_log
      WHERE store_id = ?
      ORDER BY started_at DESC
      LIMIT ? OFFSET ?
    `);
    const data = dataStmt.all(storeId, limit, offset) as SyncLog[];

    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + data.length < total,
    };
  }

  /**
   * Get sync logs within a date range
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param startDate - Start date (ISO string)
   * @param endDate - End date (ISO string)
   * @param limit - Maximum logs to return
   * @returns Array of sync logs
   */
  getLogsByDateRange(
    storeId: string,
    startDate: string,
    endDate: string,
    limit: number = MAX_LOG_LIMIT
  ): SyncLog[] {
    const safeLimit = Math.min(limit, MAX_LOG_LIMIT);

    const stmt = this.db.prepare(`
      SELECT * FROM sync_log
      WHERE store_id = ?
        AND started_at >= ?
        AND started_at <= ?
      ORDER BY started_at DESC
      LIMIT ?
    `);

    return stmt.all(storeId, startDate, endDate, safeLimit) as SyncLog[];
  }

  /**
   * Get the last sync log for a store
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param syncType - Optional filter by sync type
   * @returns Most recent sync log or undefined
   */
  getLastSync(storeId: string, syncType?: SyncType): SyncLog | undefined {
    if (syncType) {
      const stmt = this.db.prepare(`
        SELECT * FROM sync_log
        WHERE store_id = ? AND sync_type = ?
        ORDER BY started_at DESC
        LIMIT 1
      `);
      return stmt.get(storeId, syncType) as SyncLog | undefined;
    }

    const stmt = this.db.prepare(`
      SELECT * FROM sync_log
      WHERE store_id = ?
      ORDER BY started_at DESC
      LIMIT 1
    `);
    return stmt.get(storeId) as SyncLog | undefined;
  }

  /**
   * Get the last successful sync for a store
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param syncType - Optional filter by sync type
   * @returns Most recent successful sync log or undefined
   */
  getLastSuccessfulSync(storeId: string, syncType?: SyncType): SyncLog | undefined {
    if (syncType) {
      const stmt = this.db.prepare(`
        SELECT * FROM sync_log
        WHERE store_id = ? AND sync_type = ? AND status = 'COMPLETED'
        ORDER BY completed_at DESC
        LIMIT 1
      `);
      return stmt.get(storeId, syncType) as SyncLog | undefined;
    }

    const stmt = this.db.prepare(`
      SELECT * FROM sync_log
      WHERE store_id = ? AND status = 'COMPLETED'
      ORDER BY completed_at DESC
      LIMIT 1
    `);
    return stmt.get(storeId) as SyncLog | undefined;
  }

  /**
   * Get sync statistics for a store
   * SEC-006: Parameterized queries
   *
   * @param storeId - Store identifier
   * @returns Sync statistics
   */
  getStats(storeId: string): SyncStats {
    // Total syncs
    const totalStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM sync_log WHERE store_id = ?
    `);
    const totalResult = totalStmt.get(storeId) as { count: number };

    // Successful syncs
    const successStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM sync_log WHERE store_id = ? AND status = 'COMPLETED'
    `);
    const successResult = successStmt.get(storeId) as { count: number };

    // Failed syncs
    const failedStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM sync_log WHERE store_id = ? AND status = 'FAILED'
    `);
    const failedResult = failedStmt.get(storeId) as { count: number };

    // Total records synced
    const recordsStmt = this.db.prepare(`
      SELECT COALESCE(SUM(records_succeeded), 0) as total FROM sync_log WHERE store_id = ?
    `);
    const recordsResult = recordsStmt.get(storeId) as { total: number };

    // Last sync info
    const lastSync = this.getLastSync(storeId);

    return {
      totalSyncs: totalResult.count,
      successfulSyncs: successResult.count,
      failedSyncs: failedResult.count,
      lastSyncAt: lastSync?.completed_at || lastSync?.started_at || null,
      lastSyncStatus: lastSync?.status || null,
      totalRecordsSynced: recordsResult.total,
    };
  }

  /**
   * Get count of running syncs for a store
   * Used to prevent concurrent sync operations
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @returns Number of currently running syncs
   */
  getRunningCount(storeId: string): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM sync_log
      WHERE store_id = ? AND status = 'RUNNING'
    `);
    const result = stmt.get(storeId) as { count: number };
    return result.count;
  }

  /**
   * Clean up stale running syncs (mark as failed)
   * Used on startup to clean up syncs interrupted by crash
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param maxAgeMinutes - Maximum age for running syncs before marking failed
   * @returns Number of syncs marked as failed
   */
  cleanupStaleRunning(storeId: string, maxAgeMinutes: number = 30): number {
    const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();

    const stmt = this.db.prepare(`
      UPDATE sync_log SET
        status = 'FAILED',
        completed_at = ?,
        error_message = 'Sync interrupted (application restart)'
      WHERE store_id = ?
        AND status = 'RUNNING'
        AND started_at < ?
    `);

    const result = stmt.run(this.now(), storeId, cutoffTime);

    if (result.changes > 0) {
      log.info('Cleaned up stale running syncs', {
        storeId,
        count: result.changes,
      });
    }

    return result.changes;
  }

  /**
   * Delete old sync logs (maintenance operation)
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param olderThanDays - Delete logs older than this many days
   * @returns Number of logs deleted
   */
  deleteOldLogs(storeId: string, olderThanDays: number = 90): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const stmt = this.db.prepare(`
      DELETE FROM sync_log
      WHERE store_id = ? AND started_at < ?
    `);

    const result = stmt.run(storeId, cutoffDate.toISOString());

    log.info('Deleted old sync logs', {
      storeId,
      olderThanDays,
      deletedCount: result.changes,
    });

    return result.changes;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for sync log operations
 */
export const syncLogDAL = new SyncLogDAL();
