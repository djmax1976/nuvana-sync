/**
 * Sync Queue Data Access Layer
 *
 * CRUD operations for the sync queue that tracks pending cloud uploads.
 * Records are enqueued when data changes locally and dequeued after sync.
 *
 * @module main/dal/sync-queue
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Sync operation type
 * ACTIVATE: Direct activation call to /packs/activate (handles create-and-activate)
 */
export type SyncOperation = 'CREATE' | 'UPDATE' | 'DELETE' | 'ACTIVATE';

/**
 * Sync direction - whether data is being sent to or received from cloud
 */
export type SyncDirection = 'PUSH' | 'PULL';

/**
 * Sync queue item entity
 */
export interface SyncQueueItem extends StoreEntity {
  id: string;
  store_id: string;
  entity_type: string;
  entity_id: string;
  operation: SyncOperation;
  payload: string; // JSON string
  priority: number;
  synced: number; // SQLite boolean
  sync_attempts: number;
  max_attempts: number;
  last_sync_error: string | null;
  last_attempt_at: string | null;
  created_at: string;
  synced_at: string | null;
  // API call context fields (v040 migration)
  sync_direction: SyncDirection;
  api_endpoint: string | null;
  http_status: number | null;
  response_body: string | null;
}

/**
 * Sync queue item creation data
 */
export interface CreateSyncQueueItemData {
  store_id: string;
  entity_type: string;
  entity_id: string;
  operation: SyncOperation;
  payload: object;
  priority?: number;
  sync_direction?: SyncDirection;
}

/**
 * API call context for updating sync items with response details
 */
export interface SyncApiContext {
  api_endpoint: string;
  http_status: number;
  response_body?: string;
}

/**
 * Batch of sync items for processing
 */
export interface SyncBatch {
  items: SyncQueueItem[];
  totalPending: number;
}

/**
 * Sync activity item for UI display (Development/Debug Feature)
 * API-008: Only safe, non-sensitive fields exposed
 */
export interface SyncActivityItem {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: SyncOperation;
  status: 'queued' | 'failed' | 'synced';
  sync_attempts: number;
  max_attempts: number;
  last_sync_error: string | null;
  last_attempt_at: string | null;
  created_at: string;
  synced_at: string | null;
  /** Sync direction - PUSH to cloud or PULL from cloud */
  sync_direction: SyncDirection;
  /** API endpoint that was called */
  api_endpoint: string | null;
  /** HTTP response status code */
  http_status: number | null;
  /** Truncated response body for error diagnosis */
  response_body: string | null;
  /** Parsed summary from payload - only safe display fields */
  summary: {
    pack_number?: string;
    game_code?: string;
    status?: string;
  } | null;
}

/**
 * Sync activity list filter parameters for paginated queries
 * API-001: All parameters validated and bounded in implementation
 */
export interface SyncActivityListParams {
  status?: 'all' | 'queued' | 'failed' | 'synced';
  entityType?: string;
  operation?: SyncOperation;
  direction?: SyncDirection | 'all';
  limit?: number;
  offset?: number;
}

/**
 * Paginated sync activity response
 * API-008: Only safe display fields returned
 */
export interface SyncActivityListResponse {
  items: SyncActivityItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Detailed sync statistics including breakdowns
 * API-008: OUTPUT_FILTERING - Uses clear, mutually exclusive count definitions
 *
 * Count semantics:
 * - pending: Total unsynced items (queued + failed) - for backward compatibility
 * - queued: Items still being retried (sync_attempts < max_attempts)
 * - failed: Items that exceeded max retries (sync_attempts >= max_attempts)
 *
 * Invariant: queued + failed = pending
 */
export interface SyncDetailedStats {
  /** Total unsynced items (queued + failed) - backward compatible */
  pending: number;
  /** Items still being retried */
  queued: number;
  /** Items that exceeded max retry attempts */
  failed: number;
  syncedToday: number;
  syncedTotal: number;
  oldestPending: string | null;
  newestSync: string | null;
  byEntityType: Array<{
    entity_type: string;
    pending: number;
    queued: number;
    failed: number;
    synced: number;
  }>;
  byOperation: Array<{
    operation: string;
    pending: number;
    queued: number;
    failed: number;
    synced: number;
  }>;
  /** Breakdown by sync direction (PUSH/PULL) */
  byDirection: Array<{
    direction: SyncDirection;
    pending: number;
    queued: number;
    failed: number;
    synced: number;
    syncedToday: number;
  }>;
}

// ============================================================================
// Constants
// ============================================================================

/** Default batch size for sync operations */
const DEFAULT_BATCH_SIZE = 100;

/** Maximum batch size to prevent memory issues */
const MAX_BATCH_SIZE = 500;

/** Default maximum retry attempts */
const DEFAULT_MAX_ATTEMPTS = 5;

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('sync-queue-dal');

// ============================================================================
// Sync Queue DAL
// ============================================================================

/**
 * Data Access Layer for sync queue management
 *
 * The sync queue implements a reliable outbound sync pattern:
 * 1. Changes are enqueued immediately (CREATE/UPDATE/DELETE)
 * 2. Sync worker processes items in batches
 * 3. Successful items are marked synced
 * 4. Failed items are retried with exponential backoff
 */
export class SyncQueueDAL extends StoreBasedDAL<SyncQueueItem> {
  protected readonly tableName = 'sync_queue';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'synced_at',
    'priority',
    'sync_attempts',
    'entity_type',
  ]);

  /**
   * Enqueue a new item for sync
   * SEC-006: Parameterized INSERT with validated direction
   *
   * @param data - Item to enqueue
   * @returns Created queue item
   */
  enqueue(data: CreateSyncQueueItemData): SyncQueueItem {
    const id = this.generateId();
    const now = this.now();

    // SEC-006: Validate sync_direction against allowlist
    const ALLOWED_DIRECTIONS: SyncDirection[] = ['PUSH', 'PULL'];
    const direction: SyncDirection =
      data.sync_direction && ALLOWED_DIRECTIONS.includes(data.sync_direction)
        ? data.sync_direction
        : 'PUSH';

    const stmt = this.db.prepare(`
      INSERT INTO sync_queue (
        id, store_id, entity_type, entity_id, operation,
        payload, priority, synced, sync_attempts, max_attempts,
        created_at, sync_direction
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.store_id,
      data.entity_type,
      data.entity_id,
      data.operation,
      JSON.stringify(data.payload),
      data.priority || 0,
      DEFAULT_MAX_ATTEMPTS,
      now,
      direction
    );

    log.debug('Sync item enqueued', {
      id,
      entityType: data.entity_type,
      entityId: data.entity_id,
      operation: data.operation,
      direction,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created sync queue item: ${id}`);
    }
    return created;
  }

  /**
   * Get unsynced items for processing
   * Returns items ordered by priority (desc) then created_at (asc)
   * SEC-006: Parameterized query
   *
   * @param limit - Maximum items to return
   * @returns Array of unsynced items
   */
  getUnsynced(limit: number = DEFAULT_BATCH_SIZE): SyncQueueItem[] {
    const safeLimit = Math.min(limit, MAX_BATCH_SIZE);

    const stmt = this.db.prepare(`
      SELECT * FROM sync_queue
      WHERE synced = 0 AND sync_attempts < max_attempts
      ORDER BY priority DESC, created_at ASC
      LIMIT ?
    `);

    return stmt.all(safeLimit) as SyncQueueItem[];
  }

  /**
   * Get unsynced items for a specific store
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param limit - Maximum items to return
   * @returns Array of unsynced items for store
   */
  getUnsyncedByStore(storeId: string, limit: number = DEFAULT_BATCH_SIZE): SyncQueueItem[] {
    const safeLimit = Math.min(limit, MAX_BATCH_SIZE);

    const stmt = this.db.prepare(`
      SELECT * FROM sync_queue
      WHERE store_id = ? AND synced = 0 AND sync_attempts < max_attempts
      ORDER BY priority DESC, created_at ASC
      LIMIT ?
    `);

    return stmt.all(storeId, safeLimit) as SyncQueueItem[];
  }

  /**
   * Get a batch of items for sync processing
   * Includes total pending count for progress tracking
   *
   * @param storeId - Store identifier
   * @param batchSize - Batch size
   * @returns Batch with items and total count
   */
  getBatch(storeId: string, batchSize: number = DEFAULT_BATCH_SIZE): SyncBatch {
    const items = this.getUnsyncedByStore(storeId, batchSize);
    const totalPending = this.getPendingCount(storeId);

    return { items, totalPending };
  }

  /**
   * Mark an item as successfully synced with optional API context
   * SEC-006: Parameterized UPDATE
   * API-008: Response body truncated for storage safety
   *
   * @param id - Queue item ID
   * @param apiContext - Optional API call context for troubleshooting
   */
  markSynced(id: string, apiContext?: SyncApiContext): void {
    const now = this.now();

    // API-008: Truncate response body to avoid storing excessive data
    const truncatedResponseBody = apiContext?.response_body
      ? apiContext.response_body.substring(0, 500)
      : null;

    const stmt = this.db.prepare(`
      UPDATE sync_queue SET
        synced = 1,
        synced_at = ?,
        last_attempt_at = ?,
        api_endpoint = COALESCE(?, api_endpoint),
        http_status = COALESCE(?, http_status),
        response_body = COALESCE(?, response_body)
      WHERE id = ?
    `);

    stmt.run(
      now,
      now,
      apiContext?.api_endpoint || null,
      apiContext?.http_status || null,
      truncatedResponseBody,
      id
    );

    log.debug('Sync item marked as synced', {
      id,
      apiEndpoint: apiContext?.api_endpoint,
      httpStatus: apiContext?.http_status,
    });
  }

  /**
   * Mark multiple items as synced (batch operation)
   * SEC-006: Parameterized query
   *
   * @param ids - Array of queue item IDs
   */
  markManySynced(ids: string[]): void {
    if (ids.length === 0) return;

    const now = this.now();
    const placeholders = ids.map(() => '?').join(', ');

    const stmt = this.db.prepare(`
      UPDATE sync_queue SET
        synced = 1,
        synced_at = ?
      WHERE id IN (${placeholders})
    `);

    stmt.run(now, ...ids);

    log.debug('Sync items marked as synced', { count: ids.length });
  }

  /**
   * Increment attempt count and record error with API context
   * SEC-006: Parameterized UPDATE
   * API-008: Response body truncated to 500 chars for storage safety
   *
   * @param id - Queue item ID
   * @param error - Error message
   * @param apiContext - Optional API call context for troubleshooting
   */
  incrementAttempts(id: string, error: string, apiContext?: SyncApiContext): void {
    const now = this.now();

    // API-008: Truncate response body to avoid storing excessive data
    const truncatedResponseBody = apiContext?.response_body
      ? apiContext.response_body.substring(0, 500)
      : null;

    const stmt = this.db.prepare(`
      UPDATE sync_queue SET
        sync_attempts = sync_attempts + 1,
        last_sync_error = ?,
        last_attempt_at = ?,
        api_endpoint = COALESCE(?, api_endpoint),
        http_status = COALESCE(?, http_status),
        response_body = COALESCE(?, response_body)
      WHERE id = ?
    `);

    stmt.run(
      error,
      now,
      apiContext?.api_endpoint || null,
      apiContext?.http_status || null,
      truncatedResponseBody,
      id
    );

    log.debug('Sync attempt incremented', {
      id,
      error,
      apiEndpoint: apiContext?.api_endpoint,
      httpStatus: apiContext?.http_status,
    });
  }

  /**
   * Get count of pending (unsynced) items
   *
   * @param storeId - Optional store identifier for scoped count
   * @returns Count of pending items
   */
  getPendingCount(storeId?: string): number {
    if (storeId) {
      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM sync_queue
        WHERE store_id = ? AND synced = 0
      `);
      const result = stmt.get(storeId) as { count: number };
      return result.count;
    }

    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM sync_queue WHERE synced = 0
    `);
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * Get count of failed items (exceeded max attempts)
   *
   * @param storeId - Optional store identifier
   * @returns Count of failed items
   */
  getFailedCount(storeId?: string): number {
    if (storeId) {
      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM sync_queue
        WHERE store_id = ? AND synced = 0 AND sync_attempts >= max_attempts
      `);
      const result = stmt.get(storeId) as { count: number };
      return result.count;
    }

    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM sync_queue
      WHERE synced = 0 AND sync_attempts >= max_attempts
    `);
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * Get count of queued items (still retryable, not permanently failed)
   * SEC-006: Parameterized query with validated store_id
   * DB-006: TENANT_ISOLATION - Query is scoped to store
   *
   * @param storeId - Store identifier for tenant isolation
   * @returns Count of queued items that can still be retried
   */
  getQueuedCount(storeId: string): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM sync_queue
      WHERE store_id = ? AND synced = 0 AND sync_attempts < max_attempts
    `);
    const result = stmt.get(storeId) as { count: number };
    return result.count;
  }

  /**
   * Get mutually exclusive sync counts for accurate UI display
   * Returns counts that do NOT overlap - queued + failed = total pending
   *
   * SEC-006: All queries use parameterized statements
   * DB-006: TENANT_ISOLATION - All queries scoped to store_id
   * API-008: OUTPUT_FILTERING - Returns accurate, non-misleading data
   *
   * @param storeId - Store identifier for tenant isolation
   * @returns Object with mutually exclusive counts
   */
  getExclusiveCounts(storeId: string): {
    queued: number;
    failed: number;
    totalPending: number;
    syncedToday: number;
  } {
    // Single optimized query to get all counts in one database round-trip
    // Performance: Avoids N+1 pattern by combining counts
    const stmt = this.db.prepare(`
      SELECT
        SUM(CASE WHEN synced = 0 AND sync_attempts < max_attempts THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN synced = 0 AND sync_attempts >= max_attempts THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN synced = 0 THEN 1 ELSE 0 END) as total_pending,
        SUM(CASE WHEN synced = 1 AND synced_at >= date('now', 'localtime') THEN 1 ELSE 0 END) as synced_today
      FROM sync_queue
      WHERE store_id = ?
    `);

    const result = stmt.get(storeId) as {
      queued: number | null;
      failed: number | null;
      total_pending: number | null;
      synced_today: number | null;
    };

    return {
      queued: result.queued ?? 0,
      failed: result.failed ?? 0,
      totalPending: result.total_pending ?? 0,
      syncedToday: result.synced_today ?? 0,
    };
  }

  /**
   * Get failed items for review
   *
   * @param storeId - Store identifier
   * @param limit - Maximum items to return
   * @returns Array of failed items
   */
  getFailedItems(storeId: string, limit: number = 100): SyncQueueItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sync_queue
      WHERE store_id = ? AND synced = 0 AND sync_attempts >= max_attempts
      ORDER BY created_at DESC
      LIMIT ?
    `);

    return stmt.all(storeId, limit) as SyncQueueItem[];
  }

  /**
   * Retry failed items by resetting attempt count
   *
   * @param ids - Array of item IDs to retry
   */
  retryFailed(ids: string[]): void {
    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(', ');

    const stmt = this.db.prepare(`
      UPDATE sync_queue SET
        sync_attempts = 0,
        last_sync_error = NULL
      WHERE id IN (${placeholders})
    `);

    stmt.run(...ids);

    log.info('Failed items reset for retry', { count: ids.length });
  }

  /**
   * Delete all pending (unsynced) items for a store
   * USE WITH CAUTION: This will permanently remove items from the queue
   *
   * @param storeId - Store identifier
   * @param entityType - Optional entity type filter
   * @returns Number of items deleted
   */
  deletePending(storeId: string, entityType?: string): number {
    let stmt;
    let result;

    if (entityType) {
      stmt = this.db.prepare(`
        DELETE FROM sync_queue
        WHERE store_id = ? AND synced = 0 AND entity_type = ?
      `);
      result = stmt.run(storeId, entityType);
    } else {
      stmt = this.db.prepare(`
        DELETE FROM sync_queue
        WHERE store_id = ? AND synced = 0
      `);
      result = stmt.run(storeId);
    }

    log.warn('Pending sync items deleted', {
      storeId,
      entityType: entityType || 'all',
      count: result.changes,
    });

    return result.changes;
  }

  /**
   * Reset ALL pending items to be immediately retryable
   * This clears sync_attempts and last_attempt_at so items escape backoff
   *
   * @param storeId - Store identifier
   * @returns Number of items reset
   */
  resetAllPending(storeId: string): number {
    const stmt = this.db.prepare(`
      UPDATE sync_queue SET
        sync_attempts = 0,
        last_attempt_at = NULL,
        last_sync_error = NULL
      WHERE store_id = ? AND synced = 0
    `);

    const result = stmt.run(storeId);

    log.info('All pending items reset for immediate retry', {
      storeId,
      count: result.changes,
    });

    return result.changes;
  }

  /**
   * Delete synced items older than specified date
   * Used for queue cleanup
   *
   * @param beforeDate - Delete items synced before this date
   * @returns Number of items deleted
   */
  deleteOldSynced(beforeDate: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM sync_queue
      WHERE synced = 1 AND synced_at < ?
    `);

    const result = stmt.run(beforeDate);

    log.info('Old synced items deleted', { count: result.changes, beforeDate });

    return result.changes;
  }

  /**
   * Delete a specific sync queue item by ID
   * SEC-006: Parameterized DELETE
   *
   * @param id - Queue item ID
   * @returns true if item was deleted, false if not found
   */
  deleteById(id: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM sync_queue
      WHERE id = ?
    `);

    const result = stmt.run(id);

    if (result.changes > 0) {
      log.info('Sync queue item deleted', { id });
      return true;
    }

    return false;
  }

  /**
   * Check if an entity has pending sync
   *
   * @param entityType - Entity type
   * @param entityId - Entity ID
   * @returns true if pending sync exists
   */
  hasPendingSync(entityType: string, entityId: string): boolean {
    const stmt = this.db.prepare(`
      SELECT 1 FROM sync_queue
      WHERE entity_type = ? AND entity_id = ? AND synced = 0
      LIMIT 1
    `);

    return stmt.get(entityType, entityId) !== undefined;
  }

  /**
   * Get retryable items with exponential backoff
   * Items are eligible for retry based on their attempt count and time since last attempt
   *
   * Backoff schedule (in seconds):
   * - Attempt 0: immediate
   * - Attempt 1: 2s delay
   * - Attempt 2: 4s delay
   * - Attempt 3: 8s delay
   * - Attempt 4: 16s delay
   * - Attempt 5: 32s delay
   * - Attempt 6+: 60s delay (capped)
   *
   * SEC-006: Parameterized query
   * API-002: Built-in rate limiting via backoff
   * PERF: Scans all candidates to avoid missing items buried deep in queue
   *
   * @param storeId - Store identifier
   * @param limit - Maximum items to return
   * @returns Array of retryable items
   */
  getRetryableItems(storeId: string, limit: number = DEFAULT_BATCH_SIZE): SyncQueueItem[] {
    const safeLimit = Math.min(limit, MAX_BATCH_SIZE);
    const now = new Date();

    // SQLite doesn't have POWER function, so we calculate backoff in application layer
    // Get ALL unsynced items that haven't exceeded max attempts (no artificial limit)
    // This ensures we don't miss items buried deep in the queue due to backoff filtering
    // IMPORTANT: Only return PUSH items (sync_direction IS NULL or 'PUSH')
    // PULL tracking items are handled separately by bidirectional-sync.service
    const stmt = this.db.prepare(`
      SELECT * FROM sync_queue
      WHERE store_id = ? AND synced = 0 AND sync_attempts < max_attempts
        AND (sync_direction IS NULL OR sync_direction = 'PUSH')
      ORDER BY priority DESC, created_at ASC
    `);

    const allItems = stmt.all(storeId) as SyncQueueItem[];

    // Filter items based on exponential backoff
    const retryableItems: SyncQueueItem[] = [];

    for (const item of allItems) {
      if (retryableItems.length >= safeLimit) break;

      // First attempt or never attempted
      if (item.sync_attempts === 0 || !item.last_attempt_at) {
        retryableItems.push(item);
        continue;
      }

      // Calculate backoff delay in seconds: min(2^attempts, 60)
      const backoffSeconds = Math.min(Math.pow(2, item.sync_attempts), 60);
      const lastAttempt = new Date(item.last_attempt_at);
      const nextRetryTime = new Date(lastAttempt.getTime() + backoffSeconds * 1000);

      if (now >= nextRetryTime) {
        retryableItems.push(item);
      }
    }

    log.debug('Got retryable items with backoff', {
      storeId,
      totalCandidates: allItems.length,
      retryable: retryableItems.length,
      inBackoff: allItems.length - retryableItems.length,
    });

    return retryableItems;
  }

  /**
   * Get count of items currently in backoff (waiting for retry delay)
   * These are items that:
   * - Have not exceeded max_attempts (still retryable)
   * - Have a last_attempt_at within the backoff window
   *
   * SEC-006: Parameterized query
   * DB-006: TENANT_ISOLATION - Query scoped to store_id
   *
   * @param storeId - Store identifier
   * @returns Count of items in backoff
   */
  getBackoffCount(storeId: string): number {
    const now = new Date();

    // Get all retryable PUSH items to count those in backoff
    // Excludes PULL tracking items which are handled separately
    const stmt = this.db.prepare(`
      SELECT sync_attempts, last_attempt_at FROM sync_queue
      WHERE store_id = ? AND synced = 0 AND sync_attempts < max_attempts
        AND sync_attempts > 0 AND last_attempt_at IS NOT NULL
        AND (sync_direction IS NULL OR sync_direction = 'PUSH')
    `);

    const items = stmt.all(storeId) as Array<{
      sync_attempts: number;
      last_attempt_at: string;
    }>;

    let inBackoff = 0;
    for (const item of items) {
      const backoffSeconds = Math.min(Math.pow(2, item.sync_attempts), 60);
      const lastAttempt = new Date(item.last_attempt_at);
      const nextRetryTime = new Date(lastAttempt.getTime() + backoffSeconds * 1000);

      if (now < nextRetryTime) {
        inBackoff++;
      }
    }

    return inBackoff;
  }

  /**
   * Reset items stuck in backoff for extended period
   * Clears sync_attempts for items that have been in backoff too long
   * This prevents items from being perpetually delayed
   *
   * SEC-006: Parameterized query
   * DB-006: TENANT_ISOLATION - Query scoped to store_id
   *
   * @param storeId - Store identifier
   * @param maxBackoffMinutes - Reset items in backoff longer than this (default 2 minutes)
   * @returns Number of items reset
   */
  resetStuckInBackoff(storeId: string, maxBackoffMinutes: number = 2): number {
    const cutoffTime = new Date(Date.now() - maxBackoffMinutes * 60 * 1000);

    // Reset PUSH items that:
    // 1. Are not synced
    // 2. Haven't exceeded max attempts (still retryable)
    // 3. Have sync_attempts > 0 (have been tried)
    // 4. Last attempt was before the cutoff time
    // 5. Are PUSH items (not PULL tracking items)
    const stmt = this.db.prepare(`
      UPDATE sync_queue SET
        sync_attempts = 0,
        last_attempt_at = NULL,
        last_sync_error = NULL
      WHERE store_id = ?
        AND synced = 0
        AND sync_attempts < max_attempts
        AND sync_attempts > 0
        AND last_attempt_at IS NOT NULL
        AND last_attempt_at < ?
        AND (sync_direction IS NULL OR sync_direction = 'PUSH')
    `);

    const result = stmt.run(storeId, cutoffTime.toISOString());

    if (result.changes > 0) {
      log.info('Reset items stuck in backoff', {
        storeId,
        maxBackoffMinutes,
        resetCount: result.changes,
      });
    }

    return result.changes;
  }

  /**
   * Clean up synced items older than specified days
   * Maintenance operation to prevent unbounded queue growth
   * SEC-006: Parameterized query
   *
   * @param olderThanDays - Delete items synced more than this many days ago
   * @returns Number of items deleted
   */
  cleanupSynced(olderThanDays: number = 7): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const stmt = this.db.prepare(`
      DELETE FROM sync_queue
      WHERE synced = 1
      AND synced_at < ?
    `);

    const result = stmt.run(cutoffDate.toISOString());

    log.info('Cleaned up old synced items', {
      olderThanDays,
      deletedCount: result.changes,
    });

    return result.changes;
  }

  /**
   * Delete ALL sync queue records (for FULL_RESET)
   * SEC-006: Static DELETE with no user input (safe pattern)
   * SEC-017: Only called during authorized FULL_RESET operations
   *
   * WARNING: This is a destructive operation that removes ALL sync queue data.
   * This serves as a safety net for FULL_RESET in case CASCADE deletion
   * from stores table does not trigger properly.
   *
   * @returns Number of records deleted
   */
  deleteAll(): number {
    // SEC-006: Static query with no user input - safe pattern
    const stmt = this.db.prepare('DELETE FROM sync_queue');
    const result = stmt.run();

    log.warn('All sync queue records deleted for FULL_RESET', {
      deletedCount: result.changes,
    });

    return result.changes;
  }

  // ==========================================================================
  // Sync Activity Monitor Methods (Development/Debug Feature)
  // ==========================================================================

  /**
   * Get queued items for sync activity monitor
   * Shows items currently waiting to be synced (pending + failed)
   *
   * SEC-006: Parameterized query
   * DB-006: Store-scoped query
   * API-008: Returns only safe display fields, no sensitive payload data
   *
   * @param storeId - Store identifier for tenant isolation
   * @param limit - Maximum items to return (bounded to 50)
   * @returns Array of sync activity items
   */
  getQueuedItemsForActivity(storeId: string, limit: number = 20): SyncActivityItem[] {
    const safeLimit = Math.min(Math.max(1, limit), 50);

    const stmt = this.db.prepare(`
      SELECT id, entity_type, entity_id, operation, payload,
             sync_attempts, max_attempts, last_sync_error, last_attempt_at,
             created_at, synced_at, sync_direction, api_endpoint, http_status, response_body
      FROM sync_queue
      WHERE store_id = ? AND synced = 0
      ORDER BY priority DESC, created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(storeId, safeLimit) as Array<{
      id: string;
      entity_type: string;
      entity_id: string;
      operation: SyncOperation;
      payload: string;
      sync_attempts: number;
      max_attempts: number;
      last_sync_error: string | null;
      last_attempt_at: string | null;
      created_at: string;
      synced_at: string | null;
      sync_direction: SyncDirection;
      api_endpoint: string | null;
      http_status: number | null;
      response_body: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      operation: row.operation,
      status: (row.sync_attempts >= row.max_attempts ? 'failed' : 'queued') as 'failed' | 'queued',
      sync_attempts: row.sync_attempts,
      max_attempts: row.max_attempts,
      last_sync_error: row.last_sync_error ? row.last_sync_error.substring(0, 100) : null,
      last_attempt_at: row.last_attempt_at,
      created_at: row.created_at,
      synced_at: row.synced_at,
      sync_direction: row.sync_direction || 'PUSH',
      api_endpoint: row.api_endpoint,
      http_status: row.http_status,
      response_body: row.response_body,
      summary: this.extractPayloadSummary(row.payload),
    }));
  }

  /**
   * Get recently synced items for sync activity monitor
   * Shows last N items that completed sync successfully
   *
   * SEC-006: Parameterized query
   * DB-006: Store-scoped query
   * API-008: Returns only safe display fields
   *
   * @param storeId - Store identifier for tenant isolation
   * @param limit - Maximum items to return (bounded to 10)
   * @returns Array of recently synced items
   */
  getRecentlySyncedForActivity(storeId: string, limit: number = 10): SyncActivityItem[] {
    const safeLimit = Math.min(Math.max(1, limit), 10);

    const stmt = this.db.prepare(`
      SELECT id, entity_type, entity_id, operation, payload,
             sync_attempts, max_attempts, last_sync_error, last_attempt_at,
             created_at, synced_at, sync_direction, api_endpoint, http_status, response_body
      FROM sync_queue
      WHERE store_id = ? AND synced = 1
      ORDER BY synced_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(storeId, safeLimit) as Array<{
      id: string;
      entity_type: string;
      entity_id: string;
      operation: SyncOperation;
      payload: string;
      sync_attempts: number;
      max_attempts: number;
      last_sync_error: string | null;
      last_attempt_at: string | null;
      created_at: string;
      synced_at: string | null;
      sync_direction: SyncDirection;
      api_endpoint: string | null;
      http_status: number | null;
      response_body: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      operation: row.operation,
      status: 'synced' as const,
      sync_attempts: row.sync_attempts,
      max_attempts: row.max_attempts,
      last_sync_error: null, // Synced items don't need error display
      last_attempt_at: row.last_attempt_at,
      created_at: row.created_at,
      synced_at: row.synced_at,
      sync_direction: row.sync_direction || 'PUSH',
      api_endpoint: row.api_endpoint,
      http_status: row.http_status,
      response_body: row.response_body,
      summary: this.extractPayloadSummary(row.payload),
    }));
  }

  /**
   * Extract safe summary fields from payload for UI display
   * API-008: Only whitelisted fields extracted, no sensitive data exposed
   *
   * @param payload - JSON payload string
   * @returns Safe summary object or null on parse failure
   */
  private extractPayloadSummary(
    payload: string
  ): { pack_number?: string; game_code?: string; status?: string } | null {
    try {
      const parsed = JSON.parse(payload);

      // API-008: Only extract safe display fields
      return {
        pack_number: typeof parsed.pack_number === 'string' ? parsed.pack_number : undefined,
        game_code: typeof parsed.game_code === 'string' ? parsed.game_code : undefined,
        status: typeof parsed.status === 'string' ? parsed.status : undefined,
      };
    } catch {
      // Log parse failure but don't expose internal error
      log.debug('Failed to parse payload for activity summary', {
        payloadLength: payload.length,
      });
      return null;
    }
  }

  // ==========================================================================
  // Sync Monitor Page Methods (Full Page with Pagination)
  // ==========================================================================

  /**
   * Get paginated sync activity items for the full Sync Monitor page
   * Supports filtering by status, entity type, and operation
   *
   * SEC-006: Parameterized queries with validated identifiers
   * DB-006: Store-scoped queries for tenant isolation
   * API-001: Input validation with bounds checking
   * API-008: Only safe display fields returned, no sensitive payload data
   *
   * @param storeId - Store identifier for tenant isolation
   * @param params - Filter and pagination parameters
   * @returns Paginated sync activity items
   */
  getActivityPaginated(
    storeId: string,
    params: SyncActivityListParams = {}
  ): SyncActivityListResponse {
    // API-001: Validate and bound pagination parameters
    const limit = Math.min(Math.max(1, params.limit || 50), 100);
    const offset = Math.max(0, params.offset || 0);
    const status = params.status || 'all';

    // SEC-006: Validate entity type against allowlist to prevent injection
    const ALLOWED_ENTITY_TYPES = ['pack', 'game', 'bin', 'shift', 'user'];
    const entityType =
      params.entityType && ALLOWED_ENTITY_TYPES.includes(params.entityType)
        ? params.entityType
        : undefined;

    // SEC-006: Validate operation against allowlist
    const ALLOWED_OPERATIONS: SyncOperation[] = ['CREATE', 'UPDATE', 'DELETE', 'ACTIVATE'];
    const operation =
      params.operation && ALLOWED_OPERATIONS.includes(params.operation)
        ? params.operation
        : undefined;

    // SEC-006: Validate direction against allowlist
    const ALLOWED_DIRECTIONS: SyncDirection[] = ['PUSH', 'PULL'];
    const direction =
      params.direction && ALLOWED_DIRECTIONS.includes(params.direction as SyncDirection)
        ? (params.direction as SyncDirection)
        : undefined;

    // Build WHERE clause based on filters
    const conditions: string[] = ['store_id = ?'];
    const queryParams: (string | number)[] = [storeId];

    // Status filter
    if (status === 'queued') {
      conditions.push('synced = 0 AND sync_attempts < max_attempts');
    } else if (status === 'failed') {
      conditions.push('synced = 0 AND sync_attempts >= max_attempts');
    } else if (status === 'synced') {
      conditions.push('synced = 1');
    }
    // 'all' has no additional condition

    // Entity type filter
    if (entityType) {
      conditions.push('entity_type = ?');
      queryParams.push(entityType);
    }

    // Operation filter
    if (operation) {
      conditions.push('operation = ?');
      queryParams.push(operation);
    }

    // Direction filter (SEC-006: validated above)
    if (direction) {
      // Handle NULL values: treat NULL as 'PUSH' for backward compatibility
      if (direction === 'PUSH') {
        conditions.push('(sync_direction = ? OR sync_direction IS NULL)');
      } else {
        conditions.push('sync_direction = ?');
      }
      queryParams.push(direction);
    }

    const whereClause = conditions.join(' AND ');

    // SEC-006: Parameterized count query
    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as total FROM sync_queue WHERE ${whereClause}
    `);
    const countResult = countStmt.get(...queryParams) as { total: number };
    const total = countResult.total;

    // SEC-006: Parameterized data query with pagination
    // Includes API context fields for troubleshooting (v040 migration)
    const dataStmt = this.db.prepare(`
      SELECT id, entity_type, entity_id, operation, payload,
             sync_attempts, max_attempts, last_sync_error,
             last_attempt_at, created_at, synced_at, synced,
             sync_direction, api_endpoint, http_status, response_body
      FROM sync_queue
      WHERE ${whereClause}
      ORDER BY
        CASE WHEN synced = 0 THEN 0 ELSE 1 END,
        CASE WHEN synced = 0 AND sync_attempts >= max_attempts THEN 0 ELSE 1 END,
        created_at DESC
      LIMIT ? OFFSET ?
    `);

    const rows = dataStmt.all(...queryParams, limit, offset) as Array<{
      id: string;
      entity_type: string;
      entity_id: string;
      operation: SyncOperation;
      payload: string;
      sync_attempts: number;
      max_attempts: number;
      last_sync_error: string | null;
      last_attempt_at: string | null;
      created_at: string;
      synced_at: string | null;
      synced: number;
      sync_direction: SyncDirection;
      api_endpoint: string | null;
      http_status: number | null;
      response_body: string | null;
    }>;

    // API-008: Transform to safe display format
    const items: SyncActivityItem[] = rows.map((row) => {
      let itemStatus: 'queued' | 'failed' | 'synced';
      if (row.synced === 1) {
        itemStatus = 'synced';
      } else if (row.sync_attempts >= row.max_attempts) {
        itemStatus = 'failed';
      } else {
        itemStatus = 'queued';
      }

      return {
        id: row.id,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        operation: row.operation,
        status: itemStatus,
        sync_attempts: row.sync_attempts,
        max_attempts: row.max_attempts,
        last_sync_error: row.last_sync_error ? row.last_sync_error.substring(0, 200) : null,
        last_attempt_at: row.last_attempt_at,
        created_at: row.created_at,
        synced_at: row.synced_at,
        // API context fields (v040)
        sync_direction: row.sync_direction || 'PUSH',
        api_endpoint: row.api_endpoint,
        http_status: row.http_status,
        response_body: row.response_body,
        summary: this.extractPayloadSummary(row.payload),
      };
    });

    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    };
  }

  /**
   * Get detailed sync statistics for the Sync Monitor page
   * Includes breakdown by entity type and operation with mutually exclusive counts
   *
   * SEC-006: Parameterized queries prevent SQL injection
   * DB-006: Store-scoped queries ensure tenant isolation
   * API-008: OUTPUT_FILTERING - Returns accurate, non-misleading counts
   *
   * Count definitions (mutually exclusive):
   * - pending: Total unsynced (queued + failed) - for backward compatibility
   * - queued: Items still being retried (sync_attempts < max_attempts)
   * - failed: Items that exceeded max retries (sync_attempts >= max_attempts)
   *
   * @param storeId - Store identifier
   * @returns Detailed sync statistics with mutually exclusive counts
   */
  getDetailedStats(storeId: string): SyncDetailedStats {
    const basicStats = this.getStats(storeId);

    // Total synced count
    const syncedTotalStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM sync_queue
      WHERE store_id = ? AND synced = 1
    `);
    const syncedTotalResult = syncedTotalStmt.get(storeId) as { count: number };

    // Newest sync timestamp
    const newestSyncStmt = this.db.prepare(`
      SELECT synced_at FROM sync_queue
      WHERE store_id = ? AND synced = 1
      ORDER BY synced_at DESC
      LIMIT 1
    `);
    const newestSyncResult = newestSyncStmt.get(storeId) as { synced_at: string } | undefined;

    // Breakdown by entity type with mutually exclusive counts
    // pending = total unsynced (queued + failed), queued = retryable, failed = exceeded max
    const byEntityTypeStmt = this.db.prepare(`
      SELECT
        entity_type,
        SUM(CASE WHEN synced = 0 THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN synced = 0 AND sync_attempts < max_attempts THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN synced = 0 AND sync_attempts >= max_attempts THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN synced = 1 THEN 1 ELSE 0 END) as synced
      FROM sync_queue
      WHERE store_id = ?
      GROUP BY entity_type
      ORDER BY entity_type
    `);
    const byEntityType = byEntityTypeStmt.all(storeId) as Array<{
      entity_type: string;
      pending: number;
      queued: number;
      failed: number;
      synced: number;
    }>;

    // Breakdown by operation with mutually exclusive counts
    const byOperationStmt = this.db.prepare(`
      SELECT
        operation,
        SUM(CASE WHEN synced = 0 THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN synced = 0 AND sync_attempts < max_attempts THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN synced = 0 AND sync_attempts >= max_attempts THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN synced = 1 THEN 1 ELSE 0 END) as synced
      FROM sync_queue
      WHERE store_id = ?
      GROUP BY operation
      ORDER BY operation
    `);
    const byOperation = byOperationStmt.all(storeId) as Array<{
      operation: string;
      pending: number;
      queued: number;
      failed: number;
      synced: number;
    }>;

    // Breakdown by sync direction (PUSH/PULL) with synced today counts
    // SEC-006: Parameterized query with store_id scoping
    // Treats NULL sync_direction as 'PUSH' for backward compatibility
    const byDirectionStmt = this.db.prepare(`
      SELECT
        COALESCE(sync_direction, 'PUSH') as direction,
        SUM(CASE WHEN synced = 0 THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN synced = 0 AND sync_attempts < max_attempts THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN synced = 0 AND sync_attempts >= max_attempts THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN synced = 1 THEN 1 ELSE 0 END) as synced,
        SUM(CASE WHEN synced = 1 AND synced_at >= date('now', 'localtime') THEN 1 ELSE 0 END) as synced_today
      FROM sync_queue
      WHERE store_id = ?
      GROUP BY COALESCE(sync_direction, 'PUSH')
      ORDER BY direction
    `);
    const byDirectionRaw = byDirectionStmt.all(storeId) as Array<{
      direction: string;
      pending: number;
      queued: number;
      failed: number;
      synced: number;
      synced_today: number;
    }>;

    // Ensure we always have both PUSH and PULL entries, even with 0 counts
    const byDirection: SyncDetailedStats['byDirection'] = ['PUSH', 'PULL'].map((dir) => {
      const found = byDirectionRaw.find((d) => d.direction === dir);
      return {
        direction: dir as SyncDirection,
        pending: found?.pending ?? 0,
        queued: found?.queued ?? 0,
        failed: found?.failed ?? 0,
        synced: found?.synced ?? 0,
        syncedToday: found?.synced_today ?? 0,
      };
    });

    return {
      ...basicStats,
      syncedTotal: syncedTotalResult.count,
      newestSync: newestSyncResult?.synced_at || null,
      byEntityType,
      byOperation,
      byDirection,
    };
  }

  /**
   * Get sync statistics for a store
   * SEC-006: All queries use parameterized statements
   * DB-006: TENANT_ISOLATION - All queries scoped to store_id
   * API-008: OUTPUT_FILTERING - Returns accurate counts with clear semantics
   *
   * Returns:
   * - pending: Total unsynced items (queued + failed) - for backward compatibility
   * - queued: Items still retryable (sync_attempts < max_attempts)
   * - failed: Items that exceeded max retries (sync_attempts >= max_attempts)
   * - syncedToday: Items successfully synced today
   *
   * Note: queued + failed = pending (mutually exclusive counts)
   *
   * @param storeId - Store identifier
   * @returns Sync statistics with mutually exclusive counts
   */
  getStats(storeId: string): {
    pending: number;
    queued: number;
    failed: number;
    syncedToday: number;
    oldestPending: string | null;
  } {
    // Use optimized single-query method to avoid multiple database round-trips
    const exclusiveCounts = this.getExclusiveCounts(storeId);

    // Get oldest pending - separate query as it returns a different data type
    const oldestStmt = this.db.prepare(`
      SELECT created_at FROM sync_queue
      WHERE store_id = ? AND synced = 0
      ORDER BY created_at ASC
      LIMIT 1
    `);
    const oldestResult = oldestStmt.get(storeId) as { created_at: string } | undefined;

    return {
      pending: exclusiveCounts.totalPending, // Backward compatible: total unsynced
      queued: exclusiveCounts.queued, // NEW: items still retryable
      failed: exclusiveCounts.failed, // Items exceeded max retries
      syncedToday: exclusiveCounts.syncedToday,
      oldestPending: oldestResult?.created_at || null,
    };
  }

  /**
   * Cleanup stale PULL tracking items for a specific action type
   *
   * PULL tracking items are created each time a PULL operation runs with unique
   * entity_ids (e.g., "pull-1706537000000"). If a PULL fails and gets auto-reset,
   * the old item sits forever because subsequent PULL operations create NEW items.
   *
   * This method removes old pending PULL items of a specific action type after
   * a successful PULL, preventing accumulation of stale tracking items.
   *
   * SEC-006: Parameterized DELETE query - no string concatenation with user input
   * DB-006: TENANT_ISOLATION - Query scoped to store_id
   * PERF: Uses idx_sync_queue_direction index (store_id, sync_direction, created_at)
   * SAFETY: Excludes the current PULL item and only deletes items older than 5 seconds
   *         to prevent race conditions with concurrent operations
   *
   * @param storeId - Store identifier for tenant isolation
   * @param actionPattern - Action to match in payload (e.g., 'pull_bins', 'pull_games')
   * @param excludeId - ID of current PULL item to exclude from cleanup
   * @returns Number of stale items deleted
   */
  cleanupStalePullTracking(storeId: string, actionPattern: string, excludeId: string): number {
    // SEC-006: Allowlist validation for actionPattern to prevent injection via JSON LIKE
    const ALLOWED_ACTIONS = [
      'pull_bins',
      'pull_games',
      'pull_received_packs',
      'pull_activated_packs',
    ];

    if (!ALLOWED_ACTIONS.includes(actionPattern)) {
      log.warn('Invalid actionPattern for PULL cleanup - rejected', {
        storeId,
        actionPattern,
        allowed: ALLOWED_ACTIONS,
      });
      return 0;
    }

    // Calculate cutoff time (5 seconds ago) to prevent race conditions
    // with items being created/processed concurrently
    const cutoffTime = new Date(Date.now() - 5000).toISOString();

    // SEC-006: Parameterized query with validated actionPattern
    // PERF: Uses idx_sync_queue_direction (store_id, sync_direction, created_at)
    // Query plan: Index scan on (store_id, sync_direction) then filter by conditions
    const stmt = this.db.prepare(`
      DELETE FROM sync_queue
      WHERE store_id = ?
        AND sync_direction = 'PULL'
        AND synced = 0
        AND id != ?
        AND created_at < ?
        AND payload LIKE ?
    `);

    // Build LIKE pattern: matches JSON containing the action
    // Example: '%"action":"pull_bins"%' matches {"action":"pull_bins",...}
    const likePattern = `%"action":"${actionPattern}"%`;

    const result = stmt.run(storeId, excludeId, cutoffTime, likePattern);

    if (result.changes > 0) {
      log.info('Cleaned up stale PULL tracking items', {
        storeId,
        actionPattern,
        deletedCount: result.changes,
        excludedId: excludeId,
      });
    }

    return result.changes;
  }

  /**
   * Cleanup ALL stale PULL tracking items for a store
   *
   * Called at startup to clear accumulated PULL tracking items that will never
   * be retried. This is a one-time bulk cleanup that removes all pending PULL
   * items older than the specified age.
   *
   * SEC-006: Parameterized DELETE query
   * DB-006: TENANT_ISOLATION - Query scoped to store_id
   * PERF: Uses idx_sync_queue_direction index (store_id, sync_direction, created_at)
   *
   * @param storeId - Store identifier for tenant isolation
   * @param maxAgeMinutes - Delete PULL items older than this (default: 10 minutes)
   * @returns Number of stale items deleted
   */
  cleanupAllStalePullTracking(storeId: string, maxAgeMinutes: number = 10): number {
    // Calculate cutoff time
    const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();

    // SEC-006: Parameterized query
    // Delete all pending PULL tracking items older than cutoff
    // These are tracking-only items that will never be retried
    const stmt = this.db.prepare(`
      DELETE FROM sync_queue
      WHERE store_id = ?
        AND sync_direction = 'PULL'
        AND synced = 0
        AND created_at < ?
    `);

    const result = stmt.run(storeId, cutoffTime);

    if (result.changes > 0) {
      log.info('Cleaned up all stale PULL tracking items at startup', {
        storeId,
        maxAgeMinutes,
        deletedCount: result.changes,
      });
    }

    return result.changes;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for sync queue operations
 */
export const syncQueueDAL = new SyncQueueDAL();
