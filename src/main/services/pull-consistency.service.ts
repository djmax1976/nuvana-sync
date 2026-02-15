/**
 * Pull Consistency Service
 *
 * Provides unified interface for idempotent pull operations with:
 * - Durable cursor/token persistence
 * - Exactly-once apply semantics
 * - Convergent state under repeated/overlapping pulls
 *
 * @module main/services/pull-consistency
 * @security SEC-006: Parameterized queries via DAL methods
 * @security DB-006: Store-scoped for tenant isolation
 * @compliance MQ-001: Idempotent message consumption
 *
 * Phase 5: Pull Consistency, Cursor Safety, and Idempotent Apply
 */

import { syncCursorsDAL, type CursorState, type UpdateCursorData } from '../dal/sync-cursors.dal';
import { syncAppliedRecordsDAL, type ApplyCheckResult } from '../dal/sync-applied-records.dal';
import { syncTimestampsDAL } from '../dal/sync-timestamps.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Pull session state for tracking a pull operation
 */
export interface PullSession {
  /** Entity type being pulled */
  entityType: string;
  /** Store ID for tenant isolation */
  storeId: string;
  /** Current cursor value for pagination */
  cursorValue: string | null;
  /** Current sequence number */
  sequenceNumber: number | null;
  /** Server time from last response */
  serverTime: string | null;
  /** Whether more pages exist */
  hasMore: boolean;
  /** Pages fetched so far */
  pagesFetched: number;
  /** Records pulled so far */
  recordsPulled: number;
  /** Records applied so far */
  recordsApplied: number;
  /** Records skipped (duplicates) */
  recordsSkipped: number;
  /** Whether this is a resumed pull */
  isResumed: boolean;
}

/**
 * Cloud record for apply checking
 */
export interface CloudRecord {
  /** Cloud record ID (pack_id, bin_id, etc.) */
  cloudRecordId: string;
  /** Full payload for hashing */
  payload: unknown;
  /** Sequence number from cloud */
  sequenceNumber?: number | null;
}

/**
 * Apply result for a single record
 */
export interface ApplyResult {
  /** Cloud record ID */
  cloudRecordId: string;
  /** Whether apply was performed */
  applied: boolean;
  /** Whether record was already applied (skipped) */
  skipped: boolean;
  /** Whether payload changed (update applied) */
  updated: boolean;
  /** Error if apply failed */
  error?: string;
}

/**
 * Batch apply result
 */
export interface BatchApplyResult {
  /** Records that should be applied */
  toApply: CloudRecord[];
  /** Records that were already applied (skipped) */
  skipped: CloudRecord[];
  /** Total records processed */
  totalProcessed: number;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('pull-consistency');

// ============================================================================
// Pull Consistency Service
// ============================================================================

/**
 * Pull Consistency Service
 *
 * Provides enterprise-grade pull consistency guarantees:
 * 1. Durable cursor persistence for resumable pulls
 * 2. Idempotent apply via payload hash tracking
 * 3. Convergent state via sequence-based filtering
 *
 * Usage pattern:
 * ```typescript
 * // Start or resume a pull session
 * const session = pullConsistencyService.startOrResumePull(storeId, 'packs_received');
 *
 * // For each page of results:
 * const toApply = pullConsistencyService.filterForApply(session, cloudRecords);
 * // ... apply records ...
 * pullConsistencyService.recordAppliedBatch(session, toApply);
 * pullConsistencyService.updateFromResponse(session, response);
 *
 * // On completion:
 * pullConsistencyService.completePull(session);
 * ```
 */
export class PullConsistencyService {
  /**
   * Start or resume a pull session
   *
   * If an incomplete cursor exists for this entity type, resumes from there.
   * Otherwise starts a fresh pull session.
   *
   * @param storeId - Store identifier for tenant isolation
   * @param entityType - Entity type to pull
   * @param forceReset - Force starting fresh (ignore existing cursor)
   * @returns Pull session state
   */
  startOrResumePull(storeId: string, entityType: string, forceReset: boolean = false): PullSession {
    // Clean up old applied records (TTL maintenance)
    try {
      syncAppliedRecordsDAL.cleanupOldRecords(storeId);
    } catch (error) {
      log.warn('Failed to cleanup old applied records', { storeId, error });
    }

    if (forceReset) {
      syncCursorsDAL.resetCursor(storeId, entityType);
    }

    // Check for incomplete cursor to resume
    const incompleteCursor = syncCursorsDAL.getIncompleteCursor(storeId, entityType);

    if (incompleteCursor) {
      log.info('Resuming incomplete pull', {
        storeId,
        entityType,
        pagesFetched: incompleteCursor.pages_fetched,
        recordsPulled: incompleteCursor.records_pulled,
        cursorValue: incompleteCursor.cursor_value ? '(present)' : null,
      });

      return {
        entityType,
        storeId,
        cursorValue: incompleteCursor.cursor_value,
        sequenceNumber: incompleteCursor.sequence_number,
        serverTime: incompleteCursor.server_time,
        hasMore: true,
        pagesFetched: incompleteCursor.pages_fetched,
        recordsPulled: incompleteCursor.records_pulled,
        recordsApplied: 0, // Reset for this session
        recordsSkipped: 0,
        isResumed: true,
      };
    }

    // Start fresh pull
    log.info('Starting fresh pull', { storeId, entityType });

    // Reset cursor to ensure clean state
    syncCursorsDAL.resetCursor(storeId, entityType);

    return {
      entityType,
      storeId,
      cursorValue: null,
      sequenceNumber: null,
      serverTime: null,
      hasMore: true,
      pagesFetched: 0,
      recordsPulled: 0,
      recordsApplied: 0,
      recordsSkipped: 0,
      isResumed: false,
    };
  }

  /**
   * Check if a pull can be resumed
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @returns true if there's an incomplete cursor to resume
   */
  canResumePull(storeId: string, entityType: string): boolean {
    const cursor = syncCursorsDAL.getIncompleteCursor(storeId, entityType);
    return cursor !== null;
  }

  /**
   * Update session from cloud API response
   *
   * Persists cursor state for resumability.
   *
   * @param session - Pull session to update
   * @param nextCursor - Next cursor token from response
   * @param sequence - Sequence number from response
   * @param serverTime - Server time from response
   * @param hasMore - Whether more pages exist
   * @param recordCount - Records in this page
   */
  updateFromResponse(
    session: PullSession,
    nextCursor: string | null,
    sequence: number | null,
    serverTime: string | null,
    hasMore: boolean,
    recordCount: number
  ): void {
    // Update session state
    session.cursorValue = nextCursor;
    session.sequenceNumber = sequence;
    session.serverTime = serverTime;
    session.hasMore = hasMore;
    session.pagesFetched++;
    session.recordsPulled += recordCount;

    // Persist cursor for resumability
    syncCursorsDAL.updateFromResponse(
      session.storeId,
      session.entityType,
      nextCursor,
      sequence,
      serverTime,
      hasMore,
      recordCount
    );

    // Track sequence for convergence
    if (sequence !== null) {
      syncTimestampsDAL.setLastSeenSequence(session.storeId, session.entityType, sequence);
    }

    log.debug('Session updated from response', {
      entityType: session.entityType,
      pagesFetched: session.pagesFetched,
      recordsPulled: session.recordsPulled,
      hasMore,
    });
  }

  /**
   * Filter records for apply (idempotency check)
   *
   * Returns only records that haven't been applied yet or have changed.
   * Skips records that have already been applied with the same payload.
   *
   * Phase 5 (D5.2): Harden local apply idempotency
   *
   * @param session - Pull session
   * @param records - Cloud records to check
   * @returns Batch apply result with records to apply and skipped records
   */
  filterForApply(session: PullSession, records: CloudRecord[]): BatchApplyResult {
    const toApply: CloudRecord[] = [];
    const skipped: CloudRecord[] = [];

    for (const record of records) {
      const payloadHash = syncAppliedRecordsDAL.generatePayloadHash(record.payload);

      const checkResult = syncAppliedRecordsDAL.checkIfApplied(
        session.storeId,
        session.entityType,
        record.cloudRecordId,
        payloadHash
      );

      if (checkResult.alreadyApplied && !checkResult.payloadChanged) {
        // Already applied with same payload - skip
        skipped.push(record);
        session.recordsSkipped++;
      } else {
        // Not applied yet, or payload changed - apply
        toApply.push(record);
      }
    }

    log.debug('Filtered records for apply', {
      entityType: session.entityType,
      total: records.length,
      toApply: toApply.length,
      skipped: skipped.length,
    });

    return {
      toApply,
      skipped,
      totalProcessed: records.length,
    };
  }

  /**
   * Check if a single record should be applied
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @param cloudRecordId - Cloud record ID
   * @param payload - Record payload
   * @returns Apply check result
   */
  shouldApply(
    storeId: string,
    entityType: string,
    cloudRecordId: string,
    payload: unknown
  ): ApplyCheckResult {
    const payloadHash = syncAppliedRecordsDAL.generatePayloadHash(payload);
    return syncAppliedRecordsDAL.checkIfApplied(storeId, entityType, cloudRecordId, payloadHash);
  }

  /**
   * Record that a record was applied
   *
   * Updates idempotency tracking after successful apply.
   *
   * @param session - Pull session
   * @param record - Applied record
   */
  recordApplied(session: PullSession, record: CloudRecord): void {
    const payloadHash = syncAppliedRecordsDAL.generatePayloadHash(record.payload);

    syncAppliedRecordsDAL.recordApply(
      session.storeId,
      session.entityType,
      record.cloudRecordId,
      payloadHash,
      record.sequenceNumber ?? null
    );

    session.recordsApplied++;

    // Update applied sequence for convergence tracking
    if (record.sequenceNumber !== null && record.sequenceNumber !== undefined) {
      syncTimestampsDAL.setLastAppliedSequence(
        session.storeId,
        session.entityType,
        record.sequenceNumber
      );
    }
  }

  /**
   * Record batch of applied records
   *
   * Efficient batch recording for multiple applies.
   *
   * @param session - Pull session
   * @param records - Applied records
   */
  recordAppliedBatch(session: PullSession, records: CloudRecord[]): void {
    if (records.length === 0) return;

    const batchData = records.map((record) => ({
      entityType: session.entityType,
      cloudRecordId: record.cloudRecordId,
      payloadHash: syncAppliedRecordsDAL.generatePayloadHash(record.payload),
      cloudSequence: record.sequenceNumber ?? null,
    }));

    syncAppliedRecordsDAL.batchRecordApplies(session.storeId, batchData);

    session.recordsApplied += records.length;

    // Update applied sequence to highest in batch
    const maxSequence = Math.max(
      ...records.map((r) => r.sequenceNumber ?? -1).filter((s) => s >= 0)
    );
    if (maxSequence >= 0) {
      syncTimestampsDAL.setLastAppliedSequence(session.storeId, session.entityType, maxSequence);
    }

    log.debug('Batch apply recorded', {
      entityType: session.entityType,
      count: records.length,
      maxSequence,
    });
  }

  /**
   * Complete a pull session
   *
   * Marks cursor as completed and updates timestamps.
   *
   * @param session - Pull session to complete
   */
  completePull(session: PullSession): void {
    // Mark cursor as completed
    syncCursorsDAL.markCompleted(session.storeId, session.entityType);

    // Update pull timestamp
    if (session.serverTime) {
      syncTimestampsDAL.setLastPullAt(session.storeId, session.entityType, session.serverTime);
    } else {
      syncTimestampsDAL.setLastPullAt(
        session.storeId,
        session.entityType,
        new Date().toISOString()
      );
    }

    log.info('Pull completed', {
      entityType: session.entityType,
      pagesFetched: session.pagesFetched,
      recordsPulled: session.recordsPulled,
      recordsApplied: session.recordsApplied,
      recordsSkipped: session.recordsSkipped,
      isResumed: session.isResumed,
    });
  }

  /**
   * Abort a pull session
   *
   * Preserves cursor state for later resumption.
   * Does NOT mark as completed.
   *
   * @param session - Pull session to abort
   * @param error - Error that caused abort
   */
  abortPull(session: PullSession, error?: string): void {
    log.warn('Pull aborted', {
      entityType: session.entityType,
      pagesFetched: session.pagesFetched,
      recordsPulled: session.recordsPulled,
      recordsApplied: session.recordsApplied,
      error,
    });

    // Cursor state is already persisted, so it can be resumed later
    // No additional action needed
  }

  /**
   * Get pull statistics for a store
   *
   * @param storeId - Store identifier
   * @returns Statistics about pull state
   */
  getPullStats(storeId: string): {
    cursors: { total: number; incomplete: number; totalRecordsPulled: number };
    appliedRecords: Record<
      string,
      { count: number; oldestAt: string | null; newestAt: string | null }
    >;
    sequenceGaps: Record<string, number | null>;
  } {
    const cursorStats = syncCursorsDAL.getCursorStats(storeId);
    const appliedStats = syncAppliedRecordsDAL.getStats(storeId);

    // Get sequence gaps per entity type
    const timestamps = syncTimestampsDAL.findAllByStore(storeId);
    const sequenceGaps: Record<string, number | null> = {};

    for (const ts of timestamps) {
      sequenceGaps[ts.entity_type] = syncTimestampsDAL.getSequenceGap(storeId, ts.entity_type);
    }

    return {
      cursors: cursorStats,
      appliedRecords: appliedStats,
      sequenceGaps,
    };
  }

  /**
   * Check if entity type is caught up
   *
   * @param storeId - Store identifier
   * @param entityType - Entity type
   * @returns true if all seen records have been applied
   */
  isCaughtUp(storeId: string, entityType: string): boolean {
    return syncTimestampsDAL.isCaughtUp(storeId, entityType);
  }

  /**
   * Reset all pull state for a store
   *
   * Used when triggering a full re-sync.
   *
   * @param storeId - Store identifier
   */
  resetAllPullState(storeId: string): void {
    syncCursorsDAL.resetAllCursors(storeId);
    syncAppliedRecordsDAL.deleteAll(storeId);

    log.info('All pull state reset', { storeId });
  }

  /**
   * Get all entity types with incomplete pulls
   *
   * Used at startup to identify what needs resumption.
   *
   * @param storeId - Store identifier
   * @returns Entity types that have incomplete pulls
   */
  getIncompletePulls(storeId: string): string[] {
    const cursors = syncCursorsDAL.getAllIncompleteCursors(storeId);
    return cursors.map((c) => c.entity_type);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for pull consistency operations
 */
export const pullConsistencyService = new PullConsistencyService();
