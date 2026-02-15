/**
 * Sync Applied Records Data Access Layer
 *
 * Tracks which cloud records have been applied locally for idempotent processing.
 * Enables exactly-once apply semantics across repeated/overlapping pulls.
 *
 * @module main/dal/sync-applied-records
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 * @compliance MQ-001: Idempotent message consumption via record tracking
 *
 * Phase 5 (D5.2, D5.4): Harden local apply idempotency
 */

import { createHash } from 'crypto';
import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Applied record entity for idempotency tracking
 *
 * Records which cloud records have been applied locally.
 * Uses payload hash to detect duplicate apply attempts.
 */
export interface SyncAppliedRecord extends StoreEntity {
  id: string;
  store_id: string;
  entity_type: string;
  cloud_record_id: string;
  payload_hash: string;
  cloud_sequence: number | null;
  applied_at: string;
}

/**
 * Apply check result
 */
export interface ApplyCheckResult {
  /** Whether the record was already applied */
  alreadyApplied: boolean;
  /** Previous hash if already applied (for change detection) */
  previousHash: string | null;
  /** Whether the payload has changed since last apply */
  payloadChanged: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** TTL for applied records in milliseconds (24 hours) */
const APPLIED_RECORD_TTL_MS = 24 * 60 * 60 * 1000;

/** Maximum records to keep per entity type (rolling window) */
const MAX_RECORDS_PER_TYPE = 10000;

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('sync-applied-records-dal');

// ============================================================================
// Sync Applied Records DAL
// ============================================================================

/**
 * Data Access Layer for applied record tracking
 *
 * Provides exactly-once apply semantics by tracking which cloud records
 * have been processed locally. Uses payload hashing for change detection.
 *
 * SEC-006: All queries use prepared statements
 * DB-006: All queries scoped by store_id
 * MQ-001: Enables idempotent message processing
 */
export class SyncAppliedRecordsDAL extends StoreBasedDAL<SyncAppliedRecord> {
  protected readonly tableName = 'sync_applied_records';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set(['applied_at', 'entity_type', 'cloud_sequence']);

  /**
   * Generate SHA-256 hash of record payload
   *
   * Used for detecting changes in repeated applies.
   * Deterministic for same input across sessions.
   *
   * @param payload - Record data to hash (will be JSON.stringified)
   * @returns SHA-256 hash string
   */
  generatePayloadHash(payload: unknown): string {
    // Sort keys for deterministic hashing
    const normalized = JSON.stringify(payload, Object.keys(payload as object).sort());
    return createHash('sha256').update(normalized).digest('hex').substring(0, 32);
  }

  /**
   * Check if a record was already applied
   *
   * Returns information about previous application including change detection.
   *
   * SEC-006: Parameterized query
   * DB-006: TENANT_ISOLATION - Query scoped to store_id
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type (e.g., 'pack', 'bin')
   * @param cloudRecordId - Cloud record identifier
   * @param currentPayloadHash - Hash of current payload for change detection
   * @returns Apply check result
   */
  checkIfApplied(
    storeId: string,
    entityType: string,
    cloudRecordId: string,
    currentPayloadHash: string
  ): ApplyCheckResult {
    const stmt = this.db.prepare(`
      SELECT payload_hash FROM sync_applied_records
      WHERE store_id = ? AND entity_type = ? AND cloud_record_id = ?
    `);

    const result = stmt.get(storeId, entityType, cloudRecordId) as
      | { payload_hash: string }
      | undefined;

    if (!result) {
      return {
        alreadyApplied: false,
        previousHash: null,
        payloadChanged: false,
      };
    }

    return {
      alreadyApplied: true,
      previousHash: result.payload_hash,
      payloadChanged: result.payload_hash !== currentPayloadHash,
    };
  }

  /**
   * Check if a record was already applied (simple check)
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @param cloudRecordId - Cloud record identifier
   * @returns true if record was already applied
   */
  wasApplied(storeId: string, entityType: string, cloudRecordId: string): boolean {
    const stmt = this.db.prepare(`
      SELECT 1 FROM sync_applied_records
      WHERE store_id = ? AND entity_type = ? AND cloud_record_id = ?
      LIMIT 1
    `);

    return stmt.get(storeId, entityType, cloudRecordId) !== undefined;
  }

  /**
   * Record that a record was applied
   *
   * Creates or updates the applied record entry.
   * Uses upsert pattern for idempotency.
   *
   * SEC-006: Parameterized query
   * DB-006: TENANT_ISOLATION - store_id in query
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @param cloudRecordId - Cloud record identifier
   * @param payloadHash - Hash of the applied payload
   * @param cloudSequence - Optional cloud sequence number
   */
  recordApply(
    storeId: string,
    entityType: string,
    cloudRecordId: string,
    payloadHash: string,
    cloudSequence: number | null = null
  ): void {
    const now = this.now();

    // Use INSERT OR REPLACE for upsert
    // SQLite UNIQUE constraint on (store_id, entity_type, cloud_record_id) handles dedup
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sync_applied_records (
        id, store_id, entity_type, cloud_record_id, payload_hash, cloud_sequence, applied_at
      ) VALUES (
        COALESCE(
          (SELECT id FROM sync_applied_records
           WHERE store_id = ? AND entity_type = ? AND cloud_record_id = ?),
          ?
        ),
        ?, ?, ?, ?, ?, ?
      )
    `);

    const newId = this.generateId();

    stmt.run(
      storeId,
      entityType,
      cloudRecordId,
      newId,
      storeId,
      entityType,
      cloudRecordId,
      payloadHash,
      cloudSequence,
      now
    );

    log.debug('Apply recorded', { storeId, entityType, cloudRecordId });
  }

  /**
   * Batch record applies for efficiency
   *
   * Records multiple applies in a single transaction.
   *
   * SEC-006: Parameterized query in transaction
   * DB-006: TENANT_ISOLATION - store_id validated
   *
   * @param storeId - Store identifier
   * @param records - Array of records to mark as applied
   */
  batchRecordApplies(
    storeId: string,
    records: Array<{
      entityType: string;
      cloudRecordId: string;
      payloadHash: string;
      cloudSequence?: number | null;
    }>
  ): void {
    if (records.length === 0) return;

    const now = this.now();

    const transaction = this.db.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO sync_applied_records (
          id, store_id, entity_type, cloud_record_id, payload_hash, cloud_sequence, applied_at
        ) VALUES (
          COALESCE(
            (SELECT id FROM sync_applied_records
             WHERE store_id = ? AND entity_type = ? AND cloud_record_id = ?),
            ?
          ),
          ?, ?, ?, ?, ?, ?
        )
      `);

      for (const record of records) {
        const newId = this.generateId();
        stmt.run(
          storeId,
          record.entityType,
          record.cloudRecordId,
          newId,
          storeId,
          record.entityType,
          record.cloudRecordId,
          record.payloadHash,
          record.cloudSequence ?? null,
          now
        );
      }
    });

    transaction();

    log.debug('Batch applies recorded', { storeId, count: records.length });
  }

  /**
   * Get the highest applied sequence for an entity type
   *
   * Used for convergent apply to skip records with lower sequences.
   *
   * SEC-006: Parameterized query
   * DB-006: TENANT_ISOLATION - Query scoped to store_id
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @returns Highest sequence number or null
   */
  getHighestAppliedSequence(storeId: string, entityType: string): number | null {
    const stmt = this.db.prepare(`
      SELECT MAX(cloud_sequence) as max_seq FROM sync_applied_records
      WHERE store_id = ? AND entity_type = ?
    `);

    const result = stmt.get(storeId, entityType) as { max_seq: number | null } | undefined;
    return result?.max_seq ?? null;
  }

  /**
   * Cleanup old applied records
   *
   * Removes records older than TTL to prevent unbounded growth.
   * Should be called periodically (e.g., at startup or after sync).
   *
   * SEC-006: Parameterized query
   * DB-006: TENANT_ISOLATION - Query scoped to store_id
   *
   * @param storeId - Store identifier
   * @param maxAgeMs - Maximum age in milliseconds (default: 24 hours)
   * @returns Number of records deleted
   */
  cleanupOldRecords(storeId: string, maxAgeMs: number = APPLIED_RECORD_TTL_MS): number {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();

    const stmt = this.db.prepare(`
      DELETE FROM sync_applied_records
      WHERE store_id = ? AND applied_at < ?
    `);

    const result = stmt.run(storeId, cutoff);

    if (result.changes > 0) {
      log.info('Cleaned up old applied records', { storeId, deletedCount: result.changes });
    }

    return result.changes;
  }

  /**
   * Cleanup excess records per entity type
   *
   * Maintains a rolling window of recent records.
   * Deletes oldest records when limit is exceeded.
   *
   * SEC-006: Parameterized query
   * DB-006: TENANT_ISOLATION - Query scoped to store_id
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @param maxRecords - Maximum records to keep (default: 10000)
   * @returns Number of records deleted
   */
  cleanupExcessRecords(
    storeId: string,
    entityType: string,
    maxRecords: number = MAX_RECORDS_PER_TYPE
  ): number {
    // First count current records
    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM sync_applied_records
      WHERE store_id = ? AND entity_type = ?
    `);

    const countResult = countStmt.get(storeId, entityType) as { cnt: number };
    const excess = countResult.cnt - maxRecords;

    if (excess <= 0) return 0;

    // Delete oldest excess records
    const deleteStmt = this.db.prepare(`
      DELETE FROM sync_applied_records
      WHERE id IN (
        SELECT id FROM sync_applied_records
        WHERE store_id = ? AND entity_type = ?
        ORDER BY applied_at ASC
        LIMIT ?
      )
    `);

    const result = deleteStmt.run(storeId, entityType, excess);

    if (result.changes > 0) {
      log.info('Cleaned up excess applied records', {
        storeId,
        entityType,
        deletedCount: result.changes,
      });
    }

    return result.changes;
  }

  /**
   * Get statistics about applied records
   *
   * @param storeId - Store identifier
   * @returns Statistics per entity type
   */
  getStats(
    storeId: string
  ): Record<string, { count: number; oldestAt: string | null; newestAt: string | null }> {
    const stmt = this.db.prepare(`
      SELECT
        entity_type,
        COUNT(*) as count,
        MIN(applied_at) as oldest_at,
        MAX(applied_at) as newest_at
      FROM sync_applied_records
      WHERE store_id = ?
      GROUP BY entity_type
    `);

    const results = stmt.all(storeId) as Array<{
      entity_type: string;
      count: number;
      oldest_at: string | null;
      newest_at: string | null;
    }>;

    const stats: Record<
      string,
      { count: number; oldestAt: string | null; newestAt: string | null }
    > = {};

    for (const row of results) {
      stats[row.entity_type] = {
        count: row.count,
        oldestAt: row.oldest_at,
        newestAt: row.newest_at,
      };
    }

    return stats;
  }

  /**
   * Delete all applied records for a store
   *
   * Used when triggering a full re-sync to clear idempotency state.
   *
   * SEC-006: Parameterized query
   * DB-006: TENANT_ISOLATION - Query scoped to store_id
   *
   * @param storeId - Store identifier
   * @returns Number of records deleted
   */
  deleteAll(storeId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM sync_applied_records
      WHERE store_id = ?
    `);

    const result = stmt.run(storeId);

    if (result.changes > 0) {
      log.info('All applied records deleted', { storeId, count: result.changes });
    }

    return result.changes;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for applied records operations
 */
export const syncAppliedRecordsDAL = new SyncAppliedRecordsDAL();
