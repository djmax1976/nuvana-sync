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
 *
 * Phase 5 (D5.1): Extended with sequence tracking for convergent apply
 */
export interface SyncTimestamp extends StoreEntity {
  id: string;
  store_id: string;
  entity_type: string;
  last_push_at: string | null;
  last_pull_at: string | null;
  /** Phase 5: Highest sequence number successfully applied locally */
  last_applied_sequence: number | null;
  /** Phase 5: Highest sequence number seen from cloud (may be ahead of applied) */
  last_seen_sequence: number | null;
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

  // ==========================================================================
  // Phase 5 (D5.1): Sequence Tracking Methods
  // ==========================================================================

  /**
   * Get the last applied sequence for an entity type
   *
   * Phase 5: Used for convergent apply to skip already-processed records.
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @returns Sequence number or null if never applied
   */
  getLastAppliedSequence(storeId: string, entityType: string): number | null {
    const stmt = this.db.prepare(`
      SELECT last_applied_sequence FROM sync_timestamps
      WHERE store_id = ? AND entity_type = ?
    `);

    const result = stmt.get(storeId, entityType) as
      | { last_applied_sequence: number | null }
      | undefined;

    return result?.last_applied_sequence ?? null;
  }

  /**
   * Set the last applied sequence for an entity type
   *
   * Phase 5: Updates only if the new sequence is higher (monotonic).
   * SEC-006: Parameterized query (upsert pattern)
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @param sequence - Sequence number to record
   */
  setLastAppliedSequence(storeId: string, entityType: string, sequence: number): void {
    const existing = this.findByStoreAndType(storeId, entityType);
    const now = this.now();

    if (existing) {
      // Only update if new sequence is higher (monotonic progress)
      const currentSeq = existing.last_applied_sequence ?? -1;
      if (sequence <= currentSeq) {
        log.debug('Skipping sequence update - not higher than current', {
          storeId,
          entityType,
          currentSeq,
          newSeq: sequence,
        });
        return;
      }

      const stmt = this.db.prepare(`
        UPDATE sync_timestamps SET
          last_applied_sequence = ?,
          updated_at = ?
        WHERE id = ? AND (last_applied_sequence IS NULL OR last_applied_sequence < ?)
      `);
      stmt.run(sequence, now, existing.id, sequence);
    } else {
      // Insert new record
      const id = this.generateId();
      const stmt = this.db.prepare(`
        INSERT INTO sync_timestamps (
          id, store_id, entity_type, last_applied_sequence, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, storeId, entityType, sequence, now, now);
    }

    log.debug('Last applied sequence updated', { storeId, entityType, sequence });
  }

  /**
   * Get the last seen sequence for an entity type
   *
   * Phase 5: Tracks highest sequence from cloud (may be ahead of applied).
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @returns Sequence number or null
   */
  getLastSeenSequence(storeId: string, entityType: string): number | null {
    const stmt = this.db.prepare(`
      SELECT last_seen_sequence FROM sync_timestamps
      WHERE store_id = ? AND entity_type = ?
    `);

    const result = stmt.get(storeId, entityType) as
      | { last_seen_sequence: number | null }
      | undefined;

    return result?.last_seen_sequence ?? null;
  }

  /**
   * Set the last seen sequence for an entity type
   *
   * Phase 5: Updates only if the new sequence is higher.
   * SEC-006: Parameterized query (upsert pattern)
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @param sequence - Sequence number seen
   */
  setLastSeenSequence(storeId: string, entityType: string, sequence: number): void {
    const existing = this.findByStoreAndType(storeId, entityType);
    const now = this.now();

    if (existing) {
      const currentSeq = existing.last_seen_sequence ?? -1;
      if (sequence <= currentSeq) {
        return; // Already seen a higher sequence
      }

      const stmt = this.db.prepare(`
        UPDATE sync_timestamps SET
          last_seen_sequence = ?,
          updated_at = ?
        WHERE id = ? AND (last_seen_sequence IS NULL OR last_seen_sequence < ?)
      `);
      stmt.run(sequence, now, existing.id, sequence);
    } else {
      const id = this.generateId();
      const stmt = this.db.prepare(`
        INSERT INTO sync_timestamps (
          id, store_id, entity_type, last_seen_sequence, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, storeId, entityType, sequence, now, now);
    }

    log.debug('Last seen sequence updated', { storeId, entityType, sequence });
  }

  /**
   * Update both sequences atomically
   *
   * Phase 5: Convenience method for updating both sequence values at once.
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @param appliedSequence - Highest applied sequence
   * @param seenSequence - Highest seen sequence
   */
  updateSequences(
    storeId: string,
    entityType: string,
    appliedSequence: number,
    seenSequence: number
  ): void {
    const existing = this.findByStoreAndType(storeId, entityType);
    const now = this.now();

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE sync_timestamps SET
          last_applied_sequence = CASE
            WHEN ? > COALESCE(last_applied_sequence, -1) THEN ?
            ELSE last_applied_sequence
          END,
          last_seen_sequence = CASE
            WHEN ? > COALESCE(last_seen_sequence, -1) THEN ?
            ELSE last_seen_sequence
          END,
          updated_at = ?
        WHERE id = ?
      `);
      stmt.run(appliedSequence, appliedSequence, seenSequence, seenSequence, now, existing.id);
    } else {
      const id = this.generateId();
      const stmt = this.db.prepare(`
        INSERT INTO sync_timestamps (
          id, store_id, entity_type, last_applied_sequence, last_seen_sequence,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, storeId, entityType, appliedSequence, seenSequence, now, now);
    }

    log.debug('Sequences updated', { storeId, entityType, appliedSequence, seenSequence });
  }

  /**
   * Get sequence gap (seen - applied)
   *
   * Phase 5: Indicates how many records are pending apply.
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @returns Gap count or null if no data
   */
  getSequenceGap(storeId: string, entityType: string): number | null {
    const record = this.findByStoreAndType(storeId, entityType);
    if (!record) return null;

    const applied = record.last_applied_sequence ?? 0;
    const seen = record.last_seen_sequence ?? 0;

    return Math.max(0, seen - applied);
  }

  /**
   * Check if entity type is caught up
   *
   * Phase 5: Returns true if applied sequence equals seen sequence.
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @returns true if caught up (or no data)
   */
  isCaughtUp(storeId: string, entityType: string): boolean {
    const gap = this.getSequenceGap(storeId, entityType);
    return gap === null || gap === 0;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for sync timestamp operations
 */
export const syncTimestampsDAL = new SyncTimestampsDAL();
