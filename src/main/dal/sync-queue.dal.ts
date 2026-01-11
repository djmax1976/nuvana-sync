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
 */
export type SyncOperation = 'CREATE' | 'UPDATE' | 'DELETE';

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
}

/**
 * Batch of sync items for processing
 */
export interface SyncBatch {
  items: SyncQueueItem[];
  totalPending: number;
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
   * SEC-006: Parameterized INSERT
   *
   * @param data - Item to enqueue
   * @returns Created queue item
   */
  enqueue(data: CreateSyncQueueItemData): SyncQueueItem {
    const id = this.generateId();
    const now = this.now();

    const stmt = this.db.prepare(`
      INSERT INTO sync_queue (
        id, store_id, entity_type, entity_id, operation,
        payload, priority, synced, sync_attempts, max_attempts,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
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
      now
    );

    log.debug('Sync item enqueued', {
      id,
      entityType: data.entity_type,
      entityId: data.entity_id,
      operation: data.operation,
    });

    return this.findById(id)!;
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
   * Mark an item as successfully synced
   * SEC-006: Parameterized UPDATE
   *
   * @param id - Queue item ID
   */
  markSynced(id: string): void {
    const now = this.now();

    const stmt = this.db.prepare(`
      UPDATE sync_queue SET
        synced = 1,
        synced_at = ?
      WHERE id = ?
    `);

    stmt.run(now, id);

    log.debug('Sync item marked as synced', { id });
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
   * Increment attempt count and record error
   * SEC-006: Parameterized UPDATE
   *
   * @param id - Queue item ID
   * @param error - Error message
   */
  incrementAttempts(id: string, error: string): void {
    const now = this.now();

    const stmt = this.db.prepare(`
      UPDATE sync_queue SET
        sync_attempts = sync_attempts + 1,
        last_sync_error = ?,
        last_attempt_at = ?
      WHERE id = ?
    `);

    stmt.run(error, now, id);

    log.debug('Sync attempt incremented', { id, error });
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
   * Get sync statistics for a store
   *
   * @param storeId - Store identifier
   * @returns Sync statistics
   */
  getStats(storeId: string): {
    pending: number;
    failed: number;
    syncedToday: number;
    oldestPending: string | null;
  } {
    const pending = this.getPendingCount(storeId);
    const failed = this.getFailedCount(storeId);

    // Count synced today
    const today = new Date().toISOString().split('T')[0];
    const syncedTodayStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM sync_queue
      WHERE store_id = ? AND synced = 1 AND synced_at >= ?
    `);
    const syncedResult = syncedTodayStmt.get(storeId, today) as { count: number };

    // Get oldest pending
    const oldestStmt = this.db.prepare(`
      SELECT created_at FROM sync_queue
      WHERE store_id = ? AND synced = 0
      ORDER BY created_at ASC
      LIMIT 1
    `);
    const oldestResult = oldestStmt.get(storeId) as { created_at: string } | undefined;

    return {
      pending,
      failed,
      syncedToday: syncedResult.count,
      oldestPending: oldestResult?.created_at || null,
    };
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for sync queue operations
 */
export const syncQueueDAL = new SyncQueueDAL();
