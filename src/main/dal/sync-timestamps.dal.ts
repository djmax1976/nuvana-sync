/**
 * Sync Timestamps Data Access Layer
 *
 * Manages timestamps for bi-directional sync operations.
 * Tracks when entities were last pushed to and pulled from cloud.
 *
 * @module main/dal/sync-timestamps
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Sync timestamp entity
 */
export interface SyncTimestamp extends StoreEntity {
  id: string;
  store_id: string;
  entity_type: string;
  last_push_at: string | null;
  last_pull_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('sync-timestamps-dal');

// ============================================================================
// Sync Timestamps DAL
// ============================================================================

/**
 * Data Access Layer for sync timestamp management
 *
 * Tracks bi-directional sync timestamps per entity type:
 * - last_push_at: When we last pushed local changes to cloud
 * - last_pull_at: When we last pulled cloud changes locally
 *
 * Used for delta sync to minimize data transfer.
 *
 * SEC-006: All queries use prepared statements
 * DB-006: All queries scoped by store_id
 */
export class SyncTimestampsDAL extends StoreBasedDAL<SyncTimestamp> {
  protected readonly tableName = 'sync_timestamps';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'entity_type',
    'last_push_at',
    'last_pull_at',
  ]);

  /**
   * Get the last push timestamp for an entity type
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type (e.g., 'bins', 'games', 'users')
   * @returns ISO timestamp string or null if never pushed
   */
  getLastPushAt(storeId: string, entityType: string): string | null {
    const stmt = this.db.prepare(`
      SELECT last_push_at FROM sync_timestamps
      WHERE store_id = ? AND entity_type = ?
    `);

    const result = stmt.get(storeId, entityType) as { last_push_at: string | null } | undefined;

    return result?.last_push_at || null;
  }

  /**
   * Set the last push timestamp for an entity type
   * SEC-006: Parameterized query (upsert pattern)
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @param timestamp - ISO timestamp string
   */
  setLastPushAt(storeId: string, entityType: string, timestamp: string): void {
    const existing = this.findByStoreAndType(storeId, entityType);
    const now = this.now();

    if (existing) {
      // Update existing record
      const stmt = this.db.prepare(`
        UPDATE sync_timestamps SET
          last_push_at = ?,
          updated_at = ?
        WHERE id = ?
      `);
      stmt.run(timestamp, now, existing.id);
    } else {
      // Insert new record
      const id = this.generateId();
      const stmt = this.db.prepare(`
        INSERT INTO sync_timestamps (
          id, store_id, entity_type, last_push_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, storeId, entityType, timestamp, now, now);
    }

    log.debug('Last push timestamp updated', { storeId, entityType, timestamp });
  }

  /**
   * Get the last pull timestamp for an entity type
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @returns ISO timestamp string or null if never pulled
   */
  getLastPullAt(storeId: string, entityType: string): string | null {
    const stmt = this.db.prepare(`
      SELECT last_pull_at FROM sync_timestamps
      WHERE store_id = ? AND entity_type = ?
    `);

    const result = stmt.get(storeId, entityType) as { last_pull_at: string | null } | undefined;

    return result?.last_pull_at || null;
  }

  /**
   * Set the last pull timestamp for an entity type
   * SEC-006: Parameterized query (upsert pattern)
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @param timestamp - ISO timestamp string
   */
  setLastPullAt(storeId: string, entityType: string, timestamp: string): void {
    const existing = this.findByStoreAndType(storeId, entityType);
    const now = this.now();

    if (existing) {
      // Update existing record
      const stmt = this.db.prepare(`
        UPDATE sync_timestamps SET
          last_pull_at = ?,
          updated_at = ?
        WHERE id = ?
      `);
      stmt.run(timestamp, now, existing.id);
    } else {
      // Insert new record
      const id = this.generateId();
      const stmt = this.db.prepare(`
        INSERT INTO sync_timestamps (
          id, store_id, entity_type, last_pull_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, storeId, entityType, timestamp, now, now);
    }

    log.debug('Last pull timestamp updated', { storeId, entityType, timestamp });
  }

  /**
   * Get sync timestamp record by store and entity type
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @returns Sync timestamp record or undefined
   */
  findByStoreAndType(storeId: string, entityType: string): SyncTimestamp | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM sync_timestamps
      WHERE store_id = ? AND entity_type = ?
    `);

    return stmt.get(storeId, entityType) as SyncTimestamp | undefined;
  }

  /**
   * Get all sync timestamps for a store
   * SEC-006: Parameterized query
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @returns Array of sync timestamp records
   */
  findAllByStore(storeId: string): SyncTimestamp[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sync_timestamps
      WHERE store_id = ?
      ORDER BY entity_type ASC
    `);

    return stmt.all(storeId) as SyncTimestamp[];
  }

  /**
   * Reset timestamps for an entity type (triggers full sync)
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type to reset
   * @returns true if reset was successful
   */
  reset(storeId: string, entityType: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE sync_timestamps SET
        last_push_at = NULL,
        last_pull_at = NULL,
        updated_at = ?
      WHERE store_id = ? AND entity_type = ?
    `);

    const result = stmt.run(this.now(), storeId, entityType);

    if (result.changes > 0) {
      log.info('Sync timestamps reset', { storeId, entityType });
      return true;
    }

    return false;
  }

  /**
   * Reset all timestamps for a store (triggers full sync of everything)
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @returns Number of entity types reset
   */
  resetAll(storeId: string): number {
    const stmt = this.db.prepare(`
      UPDATE sync_timestamps SET
        last_push_at = NULL,
        last_pull_at = NULL,
        updated_at = ?
      WHERE store_id = ?
    `);

    const result = stmt.run(this.now(), storeId);

    if (result.changes > 0) {
      log.info('All sync timestamps reset', { storeId, count: result.changes });
    }

    return result.changes;
  }

  /**
   * Delete sync timestamp record
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @returns true if deleted
   */
  deleteByType(storeId: string, entityType: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM sync_timestamps
      WHERE store_id = ? AND entity_type = ?
    `);

    const result = stmt.run(storeId, entityType);

    return result.changes > 0;
  }

  /**
   * Get summary of sync status for all entity types
   *
   * @param storeId - Store identifier
   * @returns Summary with last sync times per entity type
   */
  getSyncSummary(storeId: string): Record<
    string,
    {
      lastPushAt: string | null;
      lastPullAt: string | null;
    }
  > {
    const records = this.findAllByStore(storeId);

    const summary: Record<string, { lastPushAt: string | null; lastPullAt: string | null }> = {};

    for (const record of records) {
      summary[record.entity_type] = {
        lastPushAt: record.last_push_at,
        lastPullAt: record.last_pull_at,
      };
    }

    return summary;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for sync timestamp operations
 */
export const syncTimestampsDAL = new SyncTimestampsDAL();
