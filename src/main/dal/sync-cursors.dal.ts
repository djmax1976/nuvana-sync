/**
 * Sync Cursors Data Access Layer
 *
 * Manages durable server cursor/token storage for resumable pagination.
 * Enables reliable pull operations that can resume after network failures.
 *
 * @module main/dal/sync-cursors
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 * @compliance MQ-001: Idempotent message consumption via cursor tracking
 *
 * Phase 5 (D5.1): Pull Consistency, Cursor Safety, and Idempotent Apply
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Sync cursor entity for durable pagination state
 *
 * Stores server-provided cursor tokens and sequences for resumable pulls.
 * Separate from timestamps to maintain clean separation of concerns.
 */
export interface SyncCursor extends StoreEntity {
  id: string;
  store_id: string;
  entity_type: string;
  /** Server-provided opaque cursor token */
  cursor_value: string | null;
  /** Server-provided sequence number for ordering */
  sequence_number: number | null;
  /** Server timestamp from last response */
  server_time: string | null;
  /** Whether there are more pages (SQLite 0/1) */
  has_more: number;
  /** Whether all pages were fetched (SQLite 0/1) */
  completed: number;
  /** Pages fetched in current batch */
  pages_fetched: number;
  /** Records pulled in current batch */
  records_pulled: number;
  created_at: string;
  updated_at: string;
}

/**
 * Cursor state from cloud API response
 */
export interface CursorState {
  /** Opaque cursor token for next page */
  cursorValue: string | null;
  /** Sequence number for ordering */
  sequenceNumber: number | null;
  /** Server timestamp */
  serverTime: string | null;
  /** Whether there are more pages to fetch */
  hasMore: boolean;
}

/**
 * Cursor update data
 */
export interface UpdateCursorData {
  cursorValue?: string | null;
  sequenceNumber?: number | null;
  serverTime?: string | null;
  hasMore?: boolean;
  completed?: boolean;
  pagesFetched?: number;
  recordsPulled?: number;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('sync-cursors-dal');

// ============================================================================
// Sync Cursors DAL
// ============================================================================

/**
 * Data Access Layer for sync cursor management
 *
 * Provides durable storage for server-provided pagination cursors.
 * Enables resumable pulls after network failures or app restarts.
 *
 * SEC-006: All queries use prepared statements
 * DB-006: All queries scoped by store_id
 */
export class SyncCursorsDAL extends StoreBasedDAL<SyncCursor> {
  protected readonly tableName = 'sync_cursors';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set(['created_at', 'updated_at', 'entity_type']);

  /**
   * Get the current cursor for an entity type
   *
   * SEC-006: Parameterized query
   * DB-006: TENANT_ISOLATION - Query scoped to store_id
   *
   * @param storeId - Store identifier for tenant isolation
   * @param entityType - Entity type (e.g., 'bins', 'packs_received')
   * @returns Current cursor or null if none exists
   */
  getCursor(storeId: string, entityType: string): SyncCursor | null {
    const stmt = this.db.prepare(`
      SELECT * FROM sync_cursors
      WHERE store_id = ? AND entity_type = ?
    `);

    const result = stmt.get(storeId, entityType) as SyncCursor | undefined;
    return result || null;
  }

  /**
   * Get cursor state in a convenient format
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @returns Cursor state or null
   */
  getCursorState(storeId: string, entityType: string): CursorState | null {
    const cursor = this.getCursor(storeId, entityType);
    if (!cursor) return null;

    return {
      cursorValue: cursor.cursor_value,
      sequenceNumber: cursor.sequence_number,
      serverTime: cursor.server_time,
      hasMore: cursor.has_more === 1,
    };
  }

  /**
   * Get incomplete cursor for resuming a pull
   *
   * Returns cursor only if it exists and has more pages to fetch.
   * Used at startup to resume interrupted pulls.
   *
   * SEC-006: Parameterized query
   * DB-006: TENANT_ISOLATION - Query scoped to store_id
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @returns Incomplete cursor or null
   */
  getIncompleteCursor(storeId: string, entityType: string): SyncCursor | null {
    const stmt = this.db.prepare(`
      SELECT * FROM sync_cursors
      WHERE store_id = ? AND entity_type = ?
        AND completed = 0 AND has_more = 1
    `);

    const result = stmt.get(storeId, entityType) as SyncCursor | undefined;
    return result || null;
  }

  /**
   * Get all incomplete cursors for a store
   *
   * Used at startup to identify which pulls need to be resumed.
   *
   * SEC-006: Parameterized query
   * DB-006: TENANT_ISOLATION - Query scoped to store_id
   *
   * @param storeId - Store identifier
   * @returns Array of incomplete cursors
   */
  getAllIncompleteCursors(storeId: string): SyncCursor[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sync_cursors
      WHERE store_id = ? AND completed = 0 AND has_more = 1
      ORDER BY entity_type ASC
    `);

    return stmt.all(storeId) as SyncCursor[];
  }

  /**
   * Create or update cursor state
   *
   * Atomically upserts cursor data for an entity type.
   * Creates new cursor if none exists, updates existing otherwise.
   *
   * SEC-006: Parameterized query
   * DB-006: TENANT_ISOLATION - store_id in WHERE clause
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @param data - Cursor state data
   * @returns Updated cursor
   */
  upsertCursor(storeId: string, entityType: string, data: UpdateCursorData): SyncCursor {
    const existing = this.getCursor(storeId, entityType);
    const now = this.now();

    if (existing) {
      // Update existing cursor
      const stmt = this.db.prepare(`
        UPDATE sync_cursors SET
          cursor_value = ?,
          sequence_number = ?,
          server_time = ?,
          has_more = ?,
          completed = ?,
          pages_fetched = ?,
          records_pulled = ?,
          updated_at = ?
        WHERE id = ?
      `);

      stmt.run(
        data.cursorValue ?? existing.cursor_value,
        data.sequenceNumber ?? existing.sequence_number,
        data.serverTime ?? existing.server_time,
        data.hasMore !== undefined ? (data.hasMore ? 1 : 0) : existing.has_more,
        data.completed !== undefined ? (data.completed ? 1 : 0) : existing.completed,
        data.pagesFetched ?? existing.pages_fetched,
        data.recordsPulled ?? existing.records_pulled,
        now,
        existing.id
      );

      log.debug('Cursor updated', { storeId, entityType, data });

      return this.getCursor(storeId, entityType)!;
    } else {
      // Create new cursor
      const id = this.generateId();
      const stmt = this.db.prepare(`
        INSERT INTO sync_cursors (
          id, store_id, entity_type, cursor_value, sequence_number, server_time,
          has_more, completed, pages_fetched, records_pulled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        storeId,
        entityType,
        data.cursorValue ?? null,
        data.sequenceNumber ?? null,
        data.serverTime ?? null,
        data.hasMore ? 1 : 0,
        data.completed ? 1 : 0,
        data.pagesFetched ?? 0,
        data.recordsPulled ?? 0,
        now,
        now
      );

      log.debug('Cursor created', { storeId, entityType, id });

      return this.getCursor(storeId, entityType)!;
    }
  }

  /**
   * Update cursor with cloud API response
   *
   * Convenience method for updating cursor from a pull response.
   * Increments page count and adds to records pulled.
   *
   * SEC-006: Parameterized query
   * DB-006: TENANT_ISOLATION - store_id validated
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @param nextCursor - Next cursor token from response
   * @param sequence - Sequence number from response
   * @param serverTime - Server time from response
   * @param hasMore - Whether more pages exist
   * @param recordCount - Records in this page
   */
  updateFromResponse(
    storeId: string,
    entityType: string,
    nextCursor: string | null,
    sequence: number | null,
    serverTime: string | null,
    hasMore: boolean,
    recordCount: number
  ): SyncCursor {
    const existing = this.getCursor(storeId, entityType);

    const pagesFetched = (existing?.pages_fetched ?? 0) + 1;
    const recordsPulled = (existing?.records_pulled ?? 0) + recordCount;

    return this.upsertCursor(storeId, entityType, {
      cursorValue: nextCursor,
      sequenceNumber: sequence,
      serverTime,
      hasMore,
      completed: !hasMore,
      pagesFetched,
      recordsPulled,
    });
  }

  /**
   * Mark cursor as completed
   *
   * Called when all pages have been fetched successfully.
   *
   * SEC-006: Parameterized query
   * DB-006: TENANT_ISOLATION - store_id validated
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @returns true if cursor was marked complete
   */
  markCompleted(storeId: string, entityType: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE sync_cursors SET
        completed = 1,
        has_more = 0,
        updated_at = ?
      WHERE store_id = ? AND entity_type = ?
    `);

    const result = stmt.run(this.now(), storeId, entityType);

    if (result.changes > 0) {
      log.info('Cursor marked completed', { storeId, entityType });
      return true;
    }

    return false;
  }

  /**
   * Reset cursor for a new pull cycle
   *
   * Called at the start of a new pull to clear previous state.
   * Deletes the cursor so a fresh one is created.
   *
   * SEC-006: Parameterized query
   * DB-006: TENANT_ISOLATION - store_id in WHERE clause
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @returns true if cursor was reset
   */
  resetCursor(storeId: string, entityType: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM sync_cursors
      WHERE store_id = ? AND entity_type = ?
    `);

    const result = stmt.run(storeId, entityType);

    if (result.changes > 0) {
      log.debug('Cursor reset', { storeId, entityType });
      return true;
    }

    return false;
  }

  /**
   * Reset all cursors for a store
   *
   * Called when triggering a full re-sync.
   *
   * SEC-006: Parameterized query
   * DB-006: TENANT_ISOLATION - store_id in WHERE clause
   *
   * @param storeId - Store identifier
   * @returns Number of cursors reset
   */
  resetAllCursors(storeId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM sync_cursors
      WHERE store_id = ?
    `);

    const result = stmt.run(storeId);

    if (result.changes > 0) {
      log.info('All cursors reset', { storeId, count: result.changes });
    }

    return result.changes;
  }

  /**
   * Get cursor statistics for a store
   *
   * @param storeId - Store identifier
   * @returns Statistics about cursors
   */
  getCursorStats(storeId: string): {
    total: number;
    incomplete: number;
    totalRecordsPulled: number;
  } {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN completed = 0 AND has_more = 1 THEN 1 ELSE 0 END) as incomplete,
        SUM(records_pulled) as total_records_pulled
      FROM sync_cursors
      WHERE store_id = ?
    `);

    const result = stmt.get(storeId) as {
      total: number;
      incomplete: number;
      total_records_pulled: number | null;
    };

    return {
      total: result.total || 0,
      incomplete: result.incomplete || 0,
      totalRecordsPulled: result.total_records_pulled || 0,
    };
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for sync cursor operations
 */
export const syncCursorsDAL = new SyncCursorsDAL();
