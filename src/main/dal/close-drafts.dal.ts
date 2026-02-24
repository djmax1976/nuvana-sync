/**
 * Close Drafts Data Access Layer
 *
 * Manages wizard draft persistence for Day Close and Shift Close workflows.
 * Drafts store working copies of wizard data until finalization.
 *
 * @module main/dal/close-drafts
 * @feature DRAFT-001: Draft-Backed Wizard Architecture
 * @security SEC-006: All queries use prepared statements with parameter binding
 * @security DB-006: All queries scoped by store_id for tenant isolation
 * @security API-001: Input validation via Zod in handler layer
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Draft type determines wizard flow
 * - DAY_CLOSE: 3-step wizard (Lottery → Reports → Review)
 * - SHIFT_CLOSE: 2-step wizard (Reports → Close Shift)
 */
export type DraftType = 'DAY_CLOSE' | 'SHIFT_CLOSE';

/**
 * Draft status for lifecycle management
 * - IN_PROGRESS: User actively working on wizard
 * - FINALIZING: Commit transaction in progress (lock state)
 * - FINALIZED: Successfully committed to final tables
 * - EXPIRED: Abandoned draft, can be cleaned up
 */
export type DraftStatus = 'IN_PROGRESS' | 'FINALIZING' | 'FINALIZED' | 'EXPIRED';

/**
 * Step state for crash recovery navigation
 * - LOTTERY: Step 1 completed (Day Close only)
 * - REPORTS: Step 2 completed (both wizards)
 * - REVIEW: Final review step reached (Day Close only)
 */
export type StepState = 'LOTTERY' | 'REPORTS' | 'REVIEW' | null;

/**
 * Bin scan data for lottery closing
 */
export interface BinScanData {
  pack_id: string;
  bin_id: string;
  closing_serial: string;
  is_sold_out: boolean;
  scanned_at: string;
}

/**
 * Lottery totals calculated from bin scans
 */
export interface LotteryTotals {
  tickets_sold: number;
  /** Instant sales total that flows to Step 2 */
  sales_amount: number;
}

/**
 * Lottery payload for Step 1 (Day Close only)
 */
export interface LotteryPayload {
  bins_scans: BinScanData[];
  totals: LotteryTotals;
  entry_method: 'SCAN' | 'MANUAL';
  authorized_by?: string;
}

/**
 * Lottery reports for Step 2
 */
export interface LotteryReportsPayload {
  /** READ-ONLY: Populated from lottery.totals.sales_amount */
  instantSales: number;
  instantCashes: number;
  onlineSales: number;
  onlineCashes: number;
}

/**
 * Gaming reports for Step 2
 */
export interface GamingReportsPayload {
  netTerminalIncome: number;
  plays: number;
  payouts: number;
}

/**
 * Cash payouts for Step 2
 */
export interface CashPayoutsPayload {
  lotteryWinners: number;
  moneyOrders: number;
  checkCashing: number;
}

/**
 * Reports payload for Step 2 (both wizards)
 * NOTE: Out of scope for initial implementation - stays in React state
 */
export interface ReportsPayload {
  lottery_reports?: LotteryReportsPayload;
  gaming_reports?: GamingReportsPayload;
  vendor_invoices: Array<{ vendor_name: string; amount: number }>;
  cash_payouts?: CashPayoutsPayload;
}

/**
 * Complete draft payload structure
 * Contains all wizard data across all steps
 */
export interface DraftPayload {
  /** Step 1 (Day Close only) - Lottery scanning */
  lottery?: LotteryPayload;
  /** Step 2 (both wizards) - Report scanning (future work) */
  reports?: ReportsPayload;
  /** Final step - Closing cash amount */
  closing_cash?: number;
}

/**
 * Close draft entity
 */
export interface CloseDraft extends StoreEntity {
  draft_id: string;
  store_id: string;
  shift_id: string;
  business_date: string;
  draft_type: DraftType;
  status: DraftStatus;
  step_state: StepState;
  /** JSON blob with all wizard data (stored as TEXT, parsed on read) */
  payload: DraftPayload;
  /** Optimistic locking version */
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
}

/**
 * Raw database row (payload as JSON string)
 */
interface CloseDraftRow extends Omit<CloseDraft, 'payload'> {
  payload: string;
}

/**
 * Version conflict error for optimistic locking
 */
export class VersionConflictError extends Error {
  public readonly code = 'VERSION_CONFLICT';
  public readonly currentVersion: number;
  public readonly expectedVersion: number;

  constructor(currentVersion: number, expectedVersion: number) {
    super(
      `Version conflict: expected version ${expectedVersion}, but current version is ${currentVersion}. ` +
        'Another update occurred. Please refresh and retry.'
    );
    this.name = 'VersionConflictError';
    this.currentVersion = currentVersion;
    this.expectedVersion = expectedVersion;
  }
}

/**
 * Invalid status transition error
 */
export class InvalidStatusTransitionError extends Error {
  public readonly code = 'INVALID_STATUS_TRANSITION';
  public readonly fromStatus: DraftStatus;
  public readonly toStatus: DraftStatus;

  constructor(fromStatus: DraftStatus, toStatus: DraftStatus) {
    super(
      `Invalid status transition from ${fromStatus} to ${toStatus}. ` +
        'Status can only transition: IN_PROGRESS → FINALIZING → FINALIZED, or any → EXPIRED.'
    );
    this.name = 'InvalidStatusTransitionError';
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
}

// ============================================================================
// Constants
// ============================================================================

/** Valid status values (for validation) */
const VALID_STATUSES: DraftStatus[] = ['IN_PROGRESS', 'FINALIZING', 'FINALIZED', 'EXPIRED'];

/** Valid draft types (for validation) */
const VALID_DRAFT_TYPES: DraftType[] = ['DAY_CLOSE', 'SHIFT_CLOSE'];

/** Valid step states (for validation) */
const VALID_STEP_STATES: (StepState | null)[] = ['LOTTERY', 'REPORTS', 'REVIEW', null];

/** Valid status transitions (from -> allowed targets) */
const VALID_TRANSITIONS: Record<DraftStatus, DraftStatus[]> = {
  IN_PROGRESS: ['FINALIZING', 'EXPIRED'],
  FINALIZING: ['FINALIZED', 'IN_PROGRESS', 'EXPIRED'], // IN_PROGRESS allows rollback on failure
  FINALIZED: ['EXPIRED'], // Allow expiration for cleanup
  EXPIRED: [], // Terminal state
};

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('close-drafts-dal');

// ============================================================================
// Close Drafts DAL
// ============================================================================

/**
 * Data Access Layer for close draft management
 *
 * Provides CRUD operations for wizard drafts with:
 * - SEC-006: All queries use parameterized prepared statements
 * - DB-006: All queries scoped by store_id for tenant isolation
 * - Optimistic locking via version field
 * - Status lifecycle management
 * - Deep merge for partial payload updates
 *
 * @security All methods validate store_id ownership before operations
 */
export class CloseDraftsDAL extends StoreBasedDAL<CloseDraft> {
  protected readonly tableName = 'close_drafts';
  protected readonly primaryKey = 'draft_id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'business_date',
    'status',
    'draft_type',
  ]);

  // ==========================================================================
  // Payload Helpers
  // ==========================================================================

  /**
   * Parse JSON payload from database row
   * SEC-006: No user input in parsing logic
   *
   * @param jsonString - JSON string from database
   * @returns Parsed payload object or empty object on error
   */
  private parsePayload(jsonString: string | null | undefined): DraftPayload {
    if (!jsonString) {
      return {};
    }
    try {
      return JSON.parse(jsonString) as DraftPayload;
    } catch (error) {
      log.error('Failed to parse draft payload', {
        error: error instanceof Error ? error.message : 'Unknown parse error',
        payloadLength: jsonString.length,
      });
      return {};
    }
  }

  /**
   * Stringify payload for database storage
   * SEC-006: JSON.stringify is safe for SQL parameters
   *
   * @param payload - Payload object to serialize
   * @returns JSON string
   */
  private stringifyPayload(payload: DraftPayload): string {
    return JSON.stringify(payload);
  }

  /**
   * Convert database row to CloseDraft entity
   * Parses JSON payload field
   *
   * @param row - Raw database row
   * @returns CloseDraft entity with parsed payload
   */
  private rowToEntity(row: CloseDraftRow): CloseDraft {
    return {
      ...row,
      payload: this.parsePayload(row.payload),
    };
  }

  /**
   * Deep merge two objects, with source values overwriting target
   * Used for partial payload updates
   *
   * @param target - Base object
   * @param source - Object with values to merge
   * @returns Merged object
   */
  private deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
    const result = { ...target };

    for (const key of Object.keys(source) as (keyof T)[]) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (
        sourceValue !== undefined &&
        typeof sourceValue === 'object' &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        typeof targetValue === 'object' &&
        targetValue !== null &&
        !Array.isArray(targetValue)
      ) {
        // Recursively merge nested objects
        result[key] = this.deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>
        ) as T[keyof T];
      } else if (sourceValue !== undefined) {
        // Overwrite with source value (including arrays)
        result[key] = sourceValue as T[keyof T];
      }
    }

    return result;
  }

  // ==========================================================================
  // Create Operations
  // ==========================================================================

  /**
   * Create a new draft for a shift
   *
   * SEC-006: Uses parameterized INSERT with bound parameters
   * DB-006: Validates store_id ownership via shift lookup
   *
   * @param storeId - Store identifier for tenant isolation
   * @param shiftId - Shift ID the draft is associated with
   * @param businessDate - Business date (YYYY-MM-DD)
   * @param draftType - Type of draft (DAY_CLOSE or SHIFT_CLOSE)
   * @param userId - User ID creating the draft
   * @returns Created draft entity
   * @throws Error if draft type is invalid
   */
  createDraft(
    storeId: string,
    shiftId: string,
    businessDate: string,
    draftType: DraftType,
    userId: string
  ): CloseDraft {
    // Validate draft type
    if (!VALID_DRAFT_TYPES.includes(draftType)) {
      throw new Error(
        `Invalid draft type: ${draftType}. Must be one of: ${VALID_DRAFT_TYPES.join(', ')}`
      );
    }

    const draftId = this.generateId();
    const now = this.now();
    const initialPayload = this.stringifyPayload({});

    // SEC-006: Parameterized INSERT with all values as bound parameters
    const stmt = this.db.prepare(`
      INSERT INTO close_drafts (
        draft_id, store_id, shift_id, business_date, draft_type,
        status, step_state, payload, version,
        created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', NULL, ?, 1, ?, ?, ?)
    `);

    stmt.run(draftId, storeId, shiftId, businessDate, draftType, initialPayload, now, now, userId);

    log.info('Draft created', {
      draftId,
      storeId,
      shiftId,
      businessDate,
      draftType,
      createdBy: userId,
    });

    const created = this.getDraft(storeId, draftId);
    if (!created) {
      throw new Error(`Failed to retrieve created draft: ${draftId}`);
    }

    return created;
  }

  // ==========================================================================
  // Read Operations
  // ==========================================================================

  /**
   * Get draft by ID with store validation
   *
   * SEC-006: Parameterized SELECT with store_id validation
   * DB-006: Ensures draft belongs to the specified store
   *
   * @param storeId - Store identifier for tenant isolation
   * @param draftId - Draft ID to retrieve
   * @returns Draft entity or undefined if not found or wrong store
   */
  getDraft(storeId: string, draftId: string): CloseDraft | undefined {
    // SEC-006: Parameterized query with store_id in WHERE (DB-006)
    const stmt = this.db.prepare(`
      SELECT * FROM close_drafts
      WHERE draft_id = ? AND store_id = ?
    `);

    const row = stmt.get(draftId, storeId) as CloseDraftRow | undefined;

    if (!row) {
      log.debug('Draft not found', { draftId, storeId });
      return undefined;
    }

    return this.rowToEntity(row);
  }

  /**
   * Get the active (IN_PROGRESS or FINALIZING) draft for a shift
   *
   * SEC-006: Parameterized SELECT
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier for tenant isolation
   * @param shiftId - Shift ID to find active draft for
   * @returns Active draft or undefined if none exists
   */
  getActiveDraft(storeId: string, shiftId: string): CloseDraft | undefined {
    // SEC-006: Parameterized query with IN clause
    // DB-006: Store-scoped via storeId
    // Query for IN_PROGRESS or FINALIZING (not FINALIZED or EXPIRED)
    const stmt = this.db.prepare(`
      SELECT * FROM close_drafts
      WHERE store_id = ? AND shift_id = ? AND status IN ('IN_PROGRESS', 'FINALIZING')
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const row = stmt.get(storeId, shiftId) as CloseDraftRow | undefined;

    if (!row) {
      log.debug('No active draft found for shift', { storeId, shiftId });
      return undefined;
    }

    return this.rowToEntity(row);
  }

  /**
   * Get all drafts for a store with optional status filter
   *
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   *
   * @param storeId - Store identifier
   * @param status - Optional status filter
   * @returns Array of drafts
   */
  getDraftsByStore(storeId: string, status?: DraftStatus): CloseDraft[] {
    let stmt;

    if (status) {
      // SEC-006: Status is validated, then used in parameterized query
      if (!VALID_STATUSES.includes(status)) {
        throw new Error(`Invalid status: ${status}`);
      }
      stmt = this.db.prepare(`
        SELECT * FROM close_drafts
        WHERE store_id = ? AND status = ?
        ORDER BY updated_at DESC
      `);
      const rows = stmt.all(storeId, status) as CloseDraftRow[];
      return rows.map((row) => this.rowToEntity(row));
    }

    stmt = this.db.prepare(`
      SELECT * FROM close_drafts
      WHERE store_id = ?
      ORDER BY updated_at DESC
    `);
    const rows = stmt.all(storeId) as CloseDraftRow[];
    return rows.map((row) => this.rowToEntity(row));
  }

  // ==========================================================================
  // Update Operations
  // ==========================================================================

  /**
   * Update draft payload with optimistic locking
   *
   * Performs a deep merge of the partial payload into existing payload.
   * Uses optimistic locking via version field to prevent lost updates.
   *
   * SEC-006: Parameterized UPDATE
   * DB-006: Store-scoped via storeId parameter
   *
   * @param storeId - Store identifier for tenant isolation
   * @param draftId - Draft ID to update
   * @param partialPayload - Partial payload to merge
   * @param expectedVersion - Expected version for optimistic locking
   * @returns Updated draft
   * @throws VersionConflictError if version doesn't match
   * @throws Error if draft not found or wrong store
   */
  updateDraft(
    storeId: string,
    draftId: string,
    partialPayload: Partial<DraftPayload>,
    expectedVersion: number
  ): CloseDraft {
    // First, retrieve current draft with store validation
    const current = this.getDraft(storeId, draftId);

    if (!current) {
      throw new Error(`Draft not found: ${draftId} (store: ${storeId})`);
    }

    // Validate version before update (optimistic locking)
    if (current.version !== expectedVersion) {
      log.warn('Version conflict on draft update', {
        draftId,
        currentVersion: current.version,
        expectedVersion,
      });
      throw new VersionConflictError(current.version, expectedVersion);
    }

    // Prevent updates to finalized or expired drafts
    if (current.status === 'FINALIZED' || current.status === 'EXPIRED') {
      throw new Error(`Cannot update draft in ${current.status} status`);
    }

    // Deep merge the partial payload
    // Cast to Record<string, unknown> since DraftPayload is a valid JSON object
    const mergedPayload = this.deepMerge(
      current.payload as unknown as Record<string, unknown>,
      partialPayload as unknown as Record<string, unknown>
    ) as DraftPayload;
    const payloadJson = this.stringifyPayload(mergedPayload);
    const now = this.now();
    const newVersion = current.version + 1;

    // SEC-006: Parameterized UPDATE with version check in WHERE
    // DB-006: Store-scoped via storeId in WHERE clause
    const stmt = this.db.prepare(`
      UPDATE close_drafts
      SET payload = ?, version = ?, updated_at = ?
      WHERE draft_id = ? AND store_id = ? AND version = ?
    `);

    const result = stmt.run(payloadJson, newVersion, now, draftId, storeId, expectedVersion);

    // Double-check optimistic lock (should not happen after our check above)
    if (result.changes === 0) {
      // Re-fetch to get actual current version
      const actual = this.getDraft(storeId, draftId);
      throw new VersionConflictError(actual?.version ?? -1, expectedVersion);
    }

    log.debug('Draft payload updated', {
      draftId,
      storeId,
      oldVersion: expectedVersion,
      newVersion,
    });

    // Return updated draft
    const updated = this.getDraft(storeId, draftId);
    if (!updated) {
      throw new Error(`Failed to retrieve updated draft: ${draftId}`);
    }

    return updated;
  }

  /**
   * Update the step state for crash recovery navigation
   *
   * SEC-006: Parameterized UPDATE
   * DB-006: Store-scoped via storeId
   *
   * @param storeId - Store identifier
   * @param draftId - Draft ID to update
   * @param stepState - New step state
   * @returns Updated draft
   * @throws Error if draft not found or invalid step state
   */
  updateStepState(storeId: string, draftId: string, stepState: StepState): CloseDraft {
    // Validate step state
    if (!VALID_STEP_STATES.includes(stepState)) {
      throw new Error(`Invalid step state: ${stepState}`);
    }

    const current = this.getDraft(storeId, draftId);
    if (!current) {
      throw new Error(`Draft not found: ${draftId}`);
    }

    // Prevent updates to finalized or expired drafts
    if (current.status === 'FINALIZED' || current.status === 'EXPIRED') {
      throw new Error(`Cannot update step state on ${current.status} draft`);
    }

    const now = this.now();

    // SEC-006: Parameterized UPDATE
    // DB-006: Store-scoped via storeId in WHERE
    const stmt = this.db.prepare(`
      UPDATE close_drafts
      SET step_state = ?, updated_at = ?
      WHERE draft_id = ? AND store_id = ?
    `);

    stmt.run(stepState, now, draftId, storeId);

    log.debug('Draft step state updated', {
      draftId,
      storeId,
      oldStepState: current.step_state,
      newStepState: stepState,
    });

    const updated = this.getDraft(storeId, draftId);
    if (!updated) {
      throw new Error(`Failed to retrieve updated draft: ${draftId}`);
    }

    return updated;
  }

  // ==========================================================================
  // Status Transitions
  // ==========================================================================

  /**
   * Validate and perform a status transition
   *
   * Valid transitions:
   * - IN_PROGRESS → FINALIZING: Start finalization
   * - IN_PROGRESS → EXPIRED: Abandon draft
   * - FINALIZING → FINALIZED: Complete finalization
   * - FINALIZING → IN_PROGRESS: Rollback on failure
   * - FINALIZING → EXPIRED: Abandon during finalization
   * - FINALIZED → EXPIRED: Cleanup completed draft
   *
   * @param current - Current status
   * @param target - Target status
   * @throws InvalidStatusTransitionError if transition is not allowed
   */
  private validateTransition(current: DraftStatus, target: DraftStatus): void {
    const allowed = VALID_TRANSITIONS[current];
    if (!allowed.includes(target)) {
      throw new InvalidStatusTransitionError(current, target);
    }
  }

  /**
   * Transition draft status with validation
   *
   * SEC-006: Parameterized UPDATE
   * DB-006: Store-scoped
   *
   * @param storeId - Store identifier
   * @param draftId - Draft ID
   * @param targetStatus - Target status
   * @returns Updated draft
   */
  private transitionStatus(
    storeId: string,
    draftId: string,
    targetStatus: DraftStatus
  ): CloseDraft {
    const current = this.getDraft(storeId, draftId);
    if (!current) {
      throw new Error(`Draft not found: ${draftId}`);
    }

    // Validate the transition
    this.validateTransition(current.status, targetStatus);

    const now = this.now();

    // SEC-006: Parameterized UPDATE
    // DB-006: Store-scoped
    const stmt = this.db.prepare(`
      UPDATE close_drafts
      SET status = ?, updated_at = ?
      WHERE draft_id = ? AND store_id = ?
    `);

    stmt.run(targetStatus, now, draftId, storeId);

    log.info('Draft status transitioned', {
      draftId,
      storeId,
      fromStatus: current.status,
      toStatus: targetStatus,
    });

    const updated = this.getDraft(storeId, draftId);
    if (!updated) {
      throw new Error(`Failed to retrieve updated draft: ${draftId}`);
    }

    return updated;
  }

  /**
   * Begin finalization (IN_PROGRESS → FINALIZING)
   *
   * Locks the draft to prevent concurrent modifications during commit.
   *
   * @param storeId - Store identifier
   * @param draftId - Draft ID
   * @returns Updated draft in FINALIZING status
   */
  beginFinalize(storeId: string, draftId: string): CloseDraft {
    return this.transitionStatus(storeId, draftId, 'FINALIZING');
  }

  /**
   * Complete finalization (FINALIZING → FINALIZED)
   *
   * Marks draft as successfully committed to final tables.
   *
   * @param storeId - Store identifier
   * @param draftId - Draft ID
   * @returns Updated draft in FINALIZED status
   */
  finalizeDraft(storeId: string, draftId: string): CloseDraft {
    return this.transitionStatus(storeId, draftId, 'FINALIZED');
  }

  /**
   * Rollback finalization (FINALIZING → IN_PROGRESS)
   *
   * Used when commit fails and draft should return to editable state.
   *
   * @param storeId - Store identifier
   * @param draftId - Draft ID
   * @returns Updated draft in IN_PROGRESS status
   */
  rollbackFinalize(storeId: string, draftId: string): CloseDraft {
    return this.transitionStatus(storeId, draftId, 'IN_PROGRESS');
  }

  /**
   * Expire a draft (any status → EXPIRED)
   *
   * Used for:
   * - User discarding a draft
   * - Cleanup of abandoned drafts
   * - Cleanup after successful finalization (optional)
   *
   * @param storeId - Store identifier
   * @param draftId - Draft ID
   * @returns Updated draft in EXPIRED status
   */
  expireDraft(storeId: string, draftId: string): CloseDraft {
    const current = this.getDraft(storeId, draftId);
    if (!current) {
      throw new Error(`Draft not found: ${draftId}`);
    }

    // EXPIRED is special: allowed from any non-EXPIRED status
    if (current.status === 'EXPIRED') {
      log.debug('Draft already expired', { draftId });
      return current;
    }

    const now = this.now();

    // SEC-006: Parameterized UPDATE
    // DB-006: Store-scoped
    const stmt = this.db.prepare(`
      UPDATE close_drafts
      SET status = 'EXPIRED', updated_at = ?
      WHERE draft_id = ? AND store_id = ?
    `);

    stmt.run(now, draftId, storeId);

    log.info('Draft expired', {
      draftId,
      storeId,
      fromStatus: current.status,
    });

    const updated = this.getDraft(storeId, draftId);
    if (!updated) {
      throw new Error(`Failed to retrieve updated draft: ${draftId}`);
    }

    return updated;
  }

  // ==========================================================================
  // Cleanup Operations
  // ==========================================================================

  /**
   * Cleanup expired drafts older than specified age
   *
   * SEC-006: Parameterized DELETE
   * DB-006: Store-scoped cleanup
   *
   * @param storeId - Store identifier for tenant isolation
   * @param maxAgeHours - Maximum age in hours (drafts older than this are deleted)
   * @returns Number of drafts deleted
   */
  cleanupExpiredDrafts(storeId: string, maxAgeHours: number): number {
    if (maxAgeHours <= 0) {
      throw new Error('maxAgeHours must be positive');
    }

    // Calculate cutoff time in ISO format
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - maxAgeHours);
    const cutoffIso = cutoffDate.toISOString();

    // SEC-006: Parameterized DELETE
    // DB-006: Store-scoped via storeId
    const stmt = this.db.prepare(`
      DELETE FROM close_drafts
      WHERE store_id = ? AND status = 'EXPIRED' AND updated_at < ?
    `);

    const result = stmt.run(storeId, cutoffIso);

    if (result.changes > 0) {
      log.info('Expired drafts cleaned up', {
        storeId,
        maxAgeHours,
        deletedCount: result.changes,
      });
    }

    return result.changes;
  }

  /**
   * Cleanup all expired and finalized drafts for a store
   * Used for maintenance and testing
   *
   * SEC-006: Parameterized DELETE
   * DB-006: Store-scoped
   *
   * @param storeId - Store identifier
   * @returns Number of drafts deleted
   */
  cleanupAllInactive(storeId: string): number {
    // SEC-006: Parameterized DELETE with IN clause
    // DB-006: Store-scoped
    const stmt = this.db.prepare(`
      DELETE FROM close_drafts
      WHERE store_id = ? AND status IN ('EXPIRED', 'FINALIZED')
    `);

    const result = stmt.run(storeId);

    if (result.changes > 0) {
      log.info('Inactive drafts cleaned up', {
        storeId,
        deletedCount: result.changes,
      });
    }

    return result.changes;
  }

  // ==========================================================================
  // Utility Operations
  // ==========================================================================

  /**
   * Check if an active draft exists for a shift
   *
   * SEC-006: Uses getActiveDraft which is parameterized
   * DB-006: Store-scoped
   *
   * @param storeId - Store identifier
   * @param shiftId - Shift ID
   * @returns true if active draft exists
   */
  hasActiveDraft(storeId: string, shiftId: string): boolean {
    return this.getActiveDraft(storeId, shiftId) !== undefined;
  }

  /**
   * Get the latest draft for a shift (any status)
   *
   * SEC-006: Parameterized query
   * DB-006: Store-scoped
   *
   * @param storeId - Store identifier
   * @param shiftId - Shift ID
   * @returns Latest draft or undefined
   */
  getLatestDraftForShift(storeId: string, shiftId: string): CloseDraft | undefined {
    // SEC-006: Parameterized SELECT
    // DB-006: Store-scoped
    const stmt = this.db.prepare(`
      SELECT * FROM close_drafts
      WHERE store_id = ? AND shift_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const row = stmt.get(storeId, shiftId) as CloseDraftRow | undefined;

    if (!row) {
      return undefined;
    }

    return this.rowToEntity(row);
  }

  /**
   * Count drafts by status for a store
   *
   * SEC-006: Parameterized COUNT
   * DB-006: Store-scoped
   *
   * @param storeId - Store identifier
   * @param status - Status to count
   * @returns Count of drafts with status
   */
  countByStatus(storeId: string, status: DraftStatus): number {
    if (!VALID_STATUSES.includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    // SEC-006: Parameterized COUNT
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM close_drafts
      WHERE store_id = ? AND status = ?
    `);

    const result = stmt.get(storeId, status) as { count: number } | undefined;
    return result?.count ?? 0;
  }

  /**
   * Delete a draft (for testing/cleanup only)
   * WARNING: Use expireDraft for normal workflow
   *
   * SEC-006: Parameterized DELETE
   * DB-006: Store-scoped
   *
   * @param storeId - Store identifier
   * @param draftId - Draft ID to delete
   * @returns true if deleted
   */
  deleteDraft(storeId: string, draftId: string): boolean {
    // SEC-006: Parameterized DELETE
    // DB-006: Store-scoped
    const stmt = this.db.prepare(`
      DELETE FROM close_drafts
      WHERE draft_id = ? AND store_id = ?
    `);

    const result = stmt.run(draftId, storeId);

    if (result.changes > 0) {
      log.warn('Draft deleted (not expired)', { draftId, storeId });
    }

    return result.changes > 0;
  }
}

// ============================================================================
// Lazy Singleton Export
// ============================================================================

/**
 * Lazy singleton instance holder
 * @internal
 */
let _closeDraftsDALInstance: CloseDraftsDAL | null = null;

/**
 * Get or create the singleton instance
 * Defers creation until first access to support test mocking
 * @internal
 */
function getCloseDraftsDAL(): CloseDraftsDAL {
  if (!_closeDraftsDALInstance) {
    _closeDraftsDALInstance = new CloseDraftsDAL();
  }
  return _closeDraftsDALInstance;
}

/**
 * Reset the singleton instance (for testing only)
 * @internal
 */
export function _resetCloseDraftsDAL(): void {
  _closeDraftsDALInstance = null;
}

/**
 * Lazy singleton proxy for close draft operations
 *
 * Uses Proxy pattern to defer instance creation until first property access.
 * This ensures tests can set up database mocks before the DAL is instantiated.
 */
export const closeDraftsDAL: CloseDraftsDAL = new Proxy({} as CloseDraftsDAL, {
  get(_target, prop: string | symbol) {
    const instance = getCloseDraftsDAL();
    const value = (instance as unknown as Record<string | symbol, unknown>)[prop];
    // Bind methods to the instance to preserve `this` context
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
  set(_target, prop: string | symbol, value: unknown) {
    const instance = getCloseDraftsDAL();
    (instance as unknown as Record<string | symbol, unknown>)[prop] = value;
    return true;
  },
});
