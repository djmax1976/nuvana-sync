/**
 * Sync Session Manager Service
 *
 * Manages sync session lifecycle to eliminate session churn.
 * Per SYNC-5000-DESKTOP Phase 1 requirements:
 * - One startSyncSession per full sync cycle
 * - One completeSyncSession per full sync cycle
 * - Failure-safe completion with accurate stats
 *
 * @module main/services/sync-session-manager
 * @security DB-006: Tenant isolation via store_id propagation
 * @security API-003: Centralized error handling with session cleanup
 * @security SEC-006: No user input interpolation
 */

import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Sync session state - holds active session context
 * Shared across all operations in a single sync cycle
 */
export interface SyncSessionContext {
  /** Session ID from cloud API */
  sessionId: string;
  /** Store ID for tenant isolation (DB-006) */
  storeId: string;
  /** Session start timestamp for metrics */
  startedAt: Date;
  /** Whether session has been completed */
  isCompleted: boolean;
  /** Revocation status from session start */
  revocationStatus: 'VALID' | 'SUSPENDED' | 'REVOKED' | 'ROTATED';
  /** Optional lockout message */
  lockoutMessage?: string;
  /** Pull pending count from session start */
  pullPendingCount: number;
}

/**
 * Aggregated stats for a sync cycle
 * Tracks cumulative stats across all operations
 */
export interface SyncCycleStats {
  /** Total records pulled from cloud */
  pulled: number;
  /** Total records pushed to cloud */
  pushed: number;
  /** Total conflicts resolved */
  conflictsResolved: number;
  /** Total errors encountered */
  errors: number;
  /** Last sequence number processed */
  lastSequence: number;
  /** Operation-specific breakdown for diagnostics */
  operationStats: Map<string, { pulled: number; pushed: number; errors: number }>;
}

/**
 * Result from a sync cycle execution
 */
export interface SyncCycleResult {
  /** Whether the cycle completed successfully */
  success: boolean;
  /** Aggregated stats */
  stats: SyncCycleStats;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Sync session response from cloud API
 * Duplicated here to avoid circular dependency
 * @note revocationStatus values from cloud API:
 *   - VALID: Session is valid, proceed normally
 *   - SUSPENDED: Grace period, can operate but should warn
 *   - REVOKED: Cannot operate, access denied
 *   - ROTATED: Key was rotated, need to use new key
 */
interface SyncSessionResponse {
  sessionId: string;
  revocationStatus: 'VALID' | 'SUSPENDED' | 'REVOKED' | 'ROTATED';
  lockoutMessage?: string;
  pullPendingCount: number;
}

/**
 * Cloud API service interface for session operations
 * Dependency injection interface to avoid circular imports
 */
export interface ICloudApiSessionService {
  startSyncSession(
    lastSyncSequence?: number,
    offlineDurationSeconds?: number
  ): Promise<SyncSessionResponse>;
  completeSyncSession(
    sessionId: string,
    finalSequence: number,
    stats: { pulled: number; pushed: number; conflictsResolved: number }
  ): Promise<void>;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('sync-session-manager');

// ============================================================================
// Sync Session Manager Service
// ============================================================================

/**
 * Sync Session Manager
 *
 * Manages sync session lifecycle to ensure:
 * - Exactly one startSyncSession per sync cycle
 * - Exactly one completeSyncSession per sync cycle
 * - Session reuse across all operations
 * - Failure-safe completion with accurate stats
 *
 * Usage:
 * ```typescript
 * const result = await syncSessionManager.runSyncCycle(storeId, async (ctx) => {
 *   // All operations share the same session
 *   await operation1(ctx.sessionId);
 *   await operation2(ctx.sessionId);
 *   // Stats are tracked automatically
 * });
 * ```
 */
export class SyncSessionManager {
  private cloudApiService: ICloudApiSessionService | null = null;
  private activeSession: SyncSessionContext | null = null;
  private cycleStats: SyncCycleStats | null = null;

  /**
   * Configure the cloud API service
   * Must be called before using runSyncCycle
   *
   * @param service - Cloud API service instance
   */
  setCloudApiService(service: ICloudApiSessionService): void {
    this.cloudApiService = service;
    log.info('Cloud API service configured for session management');
  }

  /**
   * Check if a sync session is currently active
   */
  hasActiveSession(): boolean {
    return this.activeSession !== null && !this.activeSession.isCompleted;
  }

  /**
   * Get the current active session context
   * Returns null if no active session
   *
   * @security DB-006: Caller should verify storeId matches their context
   */
  getActiveSession(): SyncSessionContext | null {
    if (this.activeSession?.isCompleted) {
      return null;
    }
    return this.activeSession;
  }

  /**
   * Get the current cycle stats
   * Returns null if no active cycle
   */
  getCycleStats(): SyncCycleStats | null {
    return this.cycleStats;
  }

  /**
   * Record stats for an operation within the current cycle
   *
   * @param operationName - Name of the operation (e.g., 'pullGames', 'pushPacks')
   * @param stats - Stats from this operation
   */
  recordOperationStats(
    operationName: string,
    stats: { pulled?: number; pushed?: number; errors?: number }
  ): void {
    if (!this.cycleStats) {
      log.warn('recordOperationStats called with no active cycle', { operationName });
      return;
    }

    // Update aggregate stats
    this.cycleStats.pulled += stats.pulled || 0;
    this.cycleStats.pushed += stats.pushed || 0;
    this.cycleStats.errors += stats.errors || 0;

    // Track per-operation breakdown
    const existing = this.cycleStats.operationStats.get(operationName) || {
      pulled: 0,
      pushed: 0,
      errors: 0,
    };
    this.cycleStats.operationStats.set(operationName, {
      pulled: existing.pulled + (stats.pulled || 0),
      pushed: existing.pushed + (stats.pushed || 0),
      errors: existing.errors + (stats.errors || 0),
    });

    log.debug('Operation stats recorded', {
      operationName,
      operationStats: stats,
      cumulativeStats: {
        pulled: this.cycleStats.pulled,
        pushed: this.cycleStats.pushed,
        errors: this.cycleStats.errors,
      },
    });
  }

  /**
   * Update the last sequence number processed
   *
   * @param sequence - Sequence number from sync operation
   */
  updateLastSequence(sequence: number): void {
    if (this.cycleStats && sequence > this.cycleStats.lastSequence) {
      this.cycleStats.lastSequence = sequence;
    }
  }

  /**
   * Run a complete sync cycle with consolidated session management
   *
   * This method ensures:
   * - Exactly one startSyncSession call
   * - Exactly one completeSyncSession call (even on partial failure)
   * - All operations share the same session context
   * - Stats are aggregated accurately
   *
   * @security DB-006: storeId enforced for tenant isolation
   * @security API-003: Session always completed, even on error
   *
   * @param storeId - Store ID for tenant isolation
   * @param operations - Async function containing all sync operations
   * @returns Sync cycle result with aggregated stats
   */
  async runSyncCycle(
    storeId: string,
    operations: (ctx: SyncSessionContext) => Promise<void>
  ): Promise<SyncCycleResult> {
    if (!this.cloudApiService) {
      throw new Error('Cloud API service not configured');
    }

    if (this.activeSession && !this.activeSession.isCompleted) {
      log.warn('Sync cycle requested while another is active', {
        existingSessionId: this.activeSession.sessionId,
        existingStoreId: this.activeSession.storeId,
        requestedStoreId: storeId,
      });
      throw new Error('Cannot start new sync cycle: existing cycle in progress');
    }

    const startTime = Date.now();

    // Initialize cycle stats
    this.cycleStats = {
      pulled: 0,
      pushed: 0,
      conflictsResolved: 0,
      errors: 0,
      lastSequence: 0,
      operationStats: new Map(),
    };

    log.info('Starting consolidated sync cycle', { storeId });

    // Step 1: Start session (exactly once per cycle)
    let sessionResponse: SyncSessionResponse;
    try {
      sessionResponse = await this.cloudApiService.startSyncSession();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('Failed to start sync session', { storeId, error: errorMessage });

      return {
        success: false,
        stats: this.cycleStats,
        error: `Session start failed: ${errorMessage}`,
        durationMs: Date.now() - startTime,
      };
    }

    // Initialize session context
    this.activeSession = {
      sessionId: sessionResponse.sessionId,
      storeId,
      startedAt: new Date(),
      isCompleted: false,
      revocationStatus: sessionResponse.revocationStatus,
      lockoutMessage: sessionResponse.lockoutMessage,
      pullPendingCount: sessionResponse.pullPendingCount,
    };

    log.info('Sync session started', {
      sessionId: this.activeSession.sessionId,
      storeId,
      revocationStatus: sessionResponse.revocationStatus,
      pullPendingCount: sessionResponse.pullPendingCount,
    });

    // Check revocation status
    if (sessionResponse.revocationStatus !== 'VALID') {
      log.error('API key revoked or invalid', {
        status: sessionResponse.revocationStatus,
        message: sessionResponse.lockoutMessage,
      });

      // Complete session even on revocation
      await this.completeSessionSafely('revocation');

      return {
        success: false,
        stats: this.cycleStats,
        error:
          sessionResponse.lockoutMessage || `API key status: ${sessionResponse.revocationStatus}`,
        durationMs: Date.now() - startTime,
      };
    }

    // Step 2: Run all operations with shared session context
    let operationsError: string | undefined;
    try {
      await operations(this.activeSession);
    } catch (error) {
      operationsError = error instanceof Error ? error.message : 'Unknown error';
      this.cycleStats.errors++;
      log.error('Sync operations failed', {
        sessionId: this.activeSession.sessionId,
        error: operationsError,
      });
    }

    // Step 3: Complete session (exactly once per cycle, even on error)
    await this.completeSessionSafely(operationsError ? 'error' : 'success');

    const durationMs = Date.now() - startTime;
    const success = !operationsError && this.cycleStats.errors === 0;

    log.info('Sync cycle completed', {
      sessionId: this.activeSession.sessionId,
      success,
      durationMs,
      stats: {
        pulled: this.cycleStats.pulled,
        pushed: this.cycleStats.pushed,
        conflictsResolved: this.cycleStats.conflictsResolved,
        errors: this.cycleStats.errors,
        lastSequence: this.cycleStats.lastSequence,
      },
      operationCount: this.cycleStats.operationStats.size,
    });

    return {
      success,
      stats: this.cycleStats,
      error: operationsError,
      durationMs,
    };
  }

  /**
   * Complete the active session safely, even if completion fails
   * This ensures we always attempt to clean up the server-side session
   *
   * @param reason - Why the session is being completed (for logging)
   */
  private async completeSessionSafely(reason: 'success' | 'error' | 'revocation'): Promise<void> {
    if (!this.activeSession || this.activeSession.isCompleted) {
      log.warn('completeSessionSafely called with no active session');
      return;
    }

    if (!this.cloudApiService) {
      log.error('Cannot complete session: cloud API service not configured');
      this.activeSession.isCompleted = true;
      return;
    }

    const { sessionId } = this.activeSession;
    const stats = this.cycleStats || {
      pulled: 0,
      pushed: 0,
      conflictsResolved: 0,
      lastSequence: 0,
    };

    try {
      await this.cloudApiService.completeSyncSession(sessionId, stats.lastSequence, {
        pulled: stats.pulled,
        pushed: stats.pushed,
        conflictsResolved: stats.conflictsResolved,
      });

      log.info('Sync session completed successfully', {
        sessionId,
        reason,
        stats: {
          pulled: stats.pulled,
          pushed: stats.pushed,
          conflictsResolved: stats.conflictsResolved,
        },
      });
    } catch (error) {
      // Log but don't throw - session cleanup is best-effort
      log.error('Failed to complete sync session (continuing)', {
        sessionId,
        reason,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.activeSession.isCompleted = true;
    }
  }

  /**
   * Force cleanup of any stale session (for recovery scenarios)
   * Use with caution - this abandons any in-progress operations
   */
  forceCleanup(): void {
    if (this.activeSession && !this.activeSession.isCompleted) {
      log.warn('Force cleanup of active session', {
        sessionId: this.activeSession.sessionId,
        storeId: this.activeSession.storeId,
        startedAt: this.activeSession.startedAt.toISOString(),
      });
    }

    this.activeSession = null;
    this.cycleStats = null;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for sync session management
 */
export const syncSessionManager = new SyncSessionManager();
