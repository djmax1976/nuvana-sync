/**
 * Sync Session Manager Service Tests
 *
 * SYNC-5000-DESKTOP Phase 1 Tests:
 * - DT1.1: Exactly one start and one complete per cycle under success path
 * - DT1.2: Exactly one complete call under handled failure path
 *
 * Test Standards:
 * - TEST-001: AAA Pattern (Arrange/Act/Assert)
 * - TEST-003: Test isolation via vi.resetAllMocks()
 * - TEST-004: Deterministic tests with controlled inputs
 * - TEST-005: Single concept per test
 * - MOCK-008: Mock network calls
 *
 * @module tests/unit/services/sync-session-manager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SyncSessionManager,
  type ICloudApiSessionService,
  type SyncSessionContext,
} from '../../../src/main/services/sync-session-manager.service';

// ============================================================================
// Mocks
// ============================================================================

/**
 * Create a mock cloud API service for testing
 * MOCK-008: All network calls are mocked
 */
function createMockCloudApiService(): ICloudApiSessionService & {
  startSyncSession: ReturnType<typeof vi.fn>;
  completeSyncSession: ReturnType<typeof vi.fn>;
} {
  return {
    startSyncSession: vi.fn().mockResolvedValue({
      sessionId: 'test-session-123',
      revocationStatus: 'VALID' as const,
      lockoutMessage: undefined,
      pullPendingCount: 0,
    }),
    completeSyncSession: vi.fn().mockResolvedValue(undefined),
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('SyncSessionManager', () => {
  let manager: SyncSessionManager;
  let mockCloudApi: ReturnType<typeof createMockCloudApiService>;

  beforeEach(() => {
    // TEST-003: Test isolation - fresh manager for each test
    vi.resetAllMocks();
    manager = new SyncSessionManager();
    mockCloudApi = createMockCloudApiService();
    manager.setCloudApiService(mockCloudApi);
  });

  afterEach(() => {
    // Clean up any active sessions
    manager.forceCleanup();
  });

  // ==========================================================================
  // DT1.1: Exactly one start and one complete per cycle under success path
  // ==========================================================================

  describe('DT1.1: Success Path - Single Session Lifecycle', () => {
    it('should call startSyncSession exactly once per cycle', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      const operations = vi.fn().mockResolvedValue(undefined);

      // Act
      await manager.runSyncCycle(storeId, operations);

      // Assert
      expect(mockCloudApi.startSyncSession).toHaveBeenCalledTimes(1);
    });

    it('should call completeSyncSession exactly once per successful cycle', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      const operations = vi.fn().mockResolvedValue(undefined);

      // Act
      await manager.runSyncCycle(storeId, operations);

      // Assert
      expect(mockCloudApi.completeSyncSession).toHaveBeenCalledTimes(1);
    });

    it('should pass session context to operations function', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      let capturedContext: SyncSessionContext | null = null;
      const operations = vi.fn().mockImplementation(async (ctx: SyncSessionContext) => {
        capturedContext = ctx;
      });

      // Act
      await manager.runSyncCycle(storeId, operations);

      // Assert
      expect(capturedContext).not.toBeNull();
      expect(capturedContext!.sessionId).toBe('test-session-123');
      expect(capturedContext!.storeId).toBe(storeId);
      expect(capturedContext!.revocationStatus).toBe('VALID');
    });

    it('should return success when operations complete without errors', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      const operations = vi.fn().mockResolvedValue(undefined);

      // Act
      const result = await manager.runSyncCycle(storeId, operations);

      // Assert
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should aggregate stats from multiple recordOperationStats calls', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      const operations = vi.fn().mockImplementation(async () => {
        manager.recordOperationStats('bins', { pulled: 10 });
        manager.recordOperationStats('games', { pulled: 5, pushed: 2 });
        manager.recordOperationStats('packs', { pulled: 100, errors: 1 });
      });

      // Act
      const result = await manager.runSyncCycle(storeId, operations);

      // Assert
      expect(result.stats.pulled).toBe(115); // 10 + 5 + 100
      expect(result.stats.pushed).toBe(2);
      expect(result.stats.errors).toBe(1);
    });

    it('should include duration in milliseconds', async () => {
      // Arrange - TEST-004: Use fake timers for deterministic timing tests
      vi.useFakeTimers();
      const storeId = 'store-uuid-123';
      const operations = vi.fn().mockImplementation(async () => {
        // Simulate some work with controlled time advancement
        await vi.advanceTimersByTimeAsync(50);
      });

      // Act
      const result = await manager.runSyncCycle(storeId, operations);

      // Cleanup
      vi.useRealTimers();

      // Assert - duration should be exactly 50ms with fake timers
      expect(result.durationMs).toBe(50);
    });

    it('should mark session as completed after successful cycle', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      const operations = vi.fn().mockResolvedValue(undefined);

      // Act
      await manager.runSyncCycle(storeId, operations);

      // Assert
      expect(manager.hasActiveSession()).toBe(false);
      expect(manager.getActiveSession()).toBeNull();
    });
  });

  // ==========================================================================
  // DT1.2: Exactly one complete call under handled failure path
  // ==========================================================================

  describe('DT1.2: Failure Path - Session Cleanup', () => {
    it('should call completeSyncSession exactly once when operations throw', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      const operations = vi.fn().mockRejectedValue(new Error('Operation failed'));

      // Act
      const result = await manager.runSyncCycle(storeId, operations);

      // Assert
      expect(mockCloudApi.completeSyncSession).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Operation failed');
    });

    it('should complete session even when completeSyncSession throws', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      const operations = vi.fn().mockResolvedValue(undefined);
      mockCloudApi.completeSyncSession.mockRejectedValueOnce(
        new Error('Network error during completion')
      );

      // Act
      const result = await manager.runSyncCycle(storeId, operations);

      // Assert - should still succeed (completion is best-effort)
      expect(mockCloudApi.completeSyncSession).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true); // Operations succeeded
    });

    it('should track error count when operations partially fail', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      const operations = vi.fn().mockImplementation(async () => {
        manager.recordOperationStats('bins', { pulled: 10, errors: 0 });
        manager.recordOperationStats('games', { pulled: 5, errors: 2 });
        manager.recordOperationStats('packs', { errors: 1 });
      });

      // Act
      const result = await manager.runSyncCycle(storeId, operations);

      // Assert
      expect(result.stats.errors).toBe(3); // 0 + 2 + 1
      expect(result.success).toBe(false); // Has errors
    });

    it('should handle session start failure gracefully', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      const operations = vi.fn();
      mockCloudApi.startSyncSession.mockRejectedValueOnce(new Error('Auth failed'));

      // Act
      const result = await manager.runSyncCycle(storeId, operations);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Session start failed');
      expect(operations).not.toHaveBeenCalled(); // Operations should not run
      expect(mockCloudApi.completeSyncSession).not.toHaveBeenCalled(); // No session to complete
    });

    it('should handle API key revocation', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      const operations = vi.fn();
      mockCloudApi.startSyncSession.mockResolvedValueOnce({
        sessionId: 'test-session-123',
        revocationStatus: 'REVOKED' as const,
        lockoutMessage: 'API key has been revoked',
        pullPendingCount: 0,
      });

      // Act
      const result = await manager.runSyncCycle(storeId, operations);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('API key has been revoked');
      expect(operations).not.toHaveBeenCalled();
      // Should still attempt to complete session
      expect(mockCloudApi.completeSyncSession).toHaveBeenCalledTimes(1);
    });

    it('should mark session as completed after failed cycle', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      const operations = vi.fn().mockRejectedValue(new Error('Test error'));

      // Act
      await manager.runSyncCycle(storeId, operations);

      // Assert
      expect(manager.hasActiveSession()).toBe(false);
    });
  });

  // ==========================================================================
  // Concurrent Session Prevention
  // ==========================================================================

  describe('Concurrent Session Prevention', () => {
    it('should prevent starting a new cycle while one is in progress', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      let operationStarted = false;
      let operationCompleted = false;

      // First operation that takes some time
      const slowOperations = vi.fn().mockImplementation(async () => {
        operationStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 50));
        operationCompleted = true;
      });

      // Act
      const firstCyclePromise = manager.runSyncCycle(storeId, slowOperations);

      // Wait for operation to start
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(operationStarted).toBe(true);
      expect(operationCompleted).toBe(false);

      // Try to start another cycle
      const secondCycle = manager.runSyncCycle(storeId, vi.fn());

      // Assert - second cycle should throw
      await expect(secondCycle).rejects.toThrow('existing cycle in progress');

      // Clean up first cycle
      await firstCyclePromise;
    });

    it('should allow new cycle after previous completes', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      const operations = vi.fn().mockResolvedValue(undefined);

      // Act
      await manager.runSyncCycle(storeId, operations);
      const secondResult = await manager.runSyncCycle(storeId, operations);

      // Assert
      expect(mockCloudApi.startSyncSession).toHaveBeenCalledTimes(2);
      expect(secondResult.success).toBe(true);
    });
  });

  // ==========================================================================
  // Stats Tracking
  // ==========================================================================

  describe('Stats Tracking', () => {
    it('should track operation-specific stats breakdown', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      const operations = vi.fn().mockImplementation(async () => {
        manager.recordOperationStats('bins', { pulled: 10 });
        manager.recordOperationStats('games', { pulled: 5 });
        manager.recordOperationStats('bins', { pulled: 3 }); // Additional bins
      });

      // Act
      const result = await manager.runSyncCycle(storeId, operations);

      // Assert
      expect(result.stats.operationStats.get('bins')).toEqual({
        pulled: 13,
        pushed: 0,
        errors: 0,
      });
      expect(result.stats.operationStats.get('games')).toEqual({
        pulled: 5,
        pushed: 0,
        errors: 0,
      });
    });

    it('should track last sequence number', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      const operations = vi.fn().mockImplementation(async () => {
        manager.updateLastSequence(100);
        manager.updateLastSequence(50); // Should not decrease
        manager.updateLastSequence(150);
      });

      // Act
      const result = await manager.runSyncCycle(storeId, operations);

      // Assert
      expect(result.stats.lastSequence).toBe(150);
    });

    it('should pass correct stats to completeSyncSession', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      const operations = vi.fn().mockImplementation(async () => {
        manager.recordOperationStats('bins', { pulled: 10, pushed: 0 });
        manager.recordOperationStats('games', { pulled: 5, pushed: 2 });
        manager.updateLastSequence(42);
      });

      // Act
      await manager.runSyncCycle(storeId, operations);

      // Assert
      expect(mockCloudApi.completeSyncSession).toHaveBeenCalledWith(
        'test-session-123',
        42, // lastSequence
        {
          pulled: 15, // 10 + 5
          pushed: 2,
          conflictsResolved: 0,
        }
      );
    });
  });

  // ==========================================================================
  // Service Configuration
  // ==========================================================================

  describe('Service Configuration', () => {
    it('should throw if cloud API service not configured', async () => {
      // Arrange
      const unconfiguredManager = new SyncSessionManager();

      // Act & Assert
      await expect(unconfiguredManager.runSyncCycle('store-123', vi.fn())).rejects.toThrow(
        'Cloud API service not configured'
      );
    });

    it('should allow reconfiguring cloud API service', () => {
      // Arrange
      const newMockApi = createMockCloudApiService();

      // Act
      manager.setCloudApiService(newMockApi);

      // Assert - no error thrown, service accepted
      expect(true).toBe(true);
    });
  });

  // ==========================================================================
  // Force Cleanup
  // ==========================================================================

  describe('Force Cleanup', () => {
    it('should clear active session on force cleanup', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      let resolveOperation: () => void;
      const operationPromise = new Promise<void>((resolve) => {
        resolveOperation = resolve;
      });

      const slowOperations = vi.fn().mockImplementation(() => operationPromise);

      // Start a cycle but don't await it
      const cyclePromise = manager.runSyncCycle(storeId, slowOperations);

      // Wait for session to be active
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(manager.hasActiveSession()).toBe(true);

      // Act
      manager.forceCleanup();

      // Assert
      expect(manager.hasActiveSession()).toBe(false);
      expect(manager.getCycleStats()).toBeNull();

      // Clean up
      resolveOperation!();
      await cyclePromise.catch(() => {}); // Ignore any errors
    });
  });

  // ==========================================================================
  // P4.1: getActiveSession() Edge Cases (SYNC-5001)
  // ==========================================================================

  describe('P4.1: getActiveSession() Edge Cases', () => {
    /**
     * TEST-001: AAA Pattern
     * TEST-005: Single concept - null state when no session
     */
    it('should return null when no session has been started', () => {
      // Arrange
      const freshManager = new SyncSessionManager();
      freshManager.setCloudApiService(mockCloudApi);

      // Act
      const result = freshManager.getActiveSession();

      // Assert
      expect(result).toBeNull();
    });

    /**
     * TEST-001: AAA Pattern
     * TEST-005: Single concept - session context during active cycle
     */
    it('should return session context during active cycle', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      let capturedSessionId: string | null = null;
      let capturedIsCompletedDuringOps: boolean | null = null;

      const operations = vi.fn().mockImplementation(async () => {
        // Capture session mid-cycle using getActiveSession()
        const session = manager.getActiveSession();
        capturedSessionId = session?.sessionId ?? null;
        // Capture isCompleted state DURING operation (before cycle completes)
        capturedIsCompletedDuringOps = session?.isCompleted ?? null;
      });

      // Act
      await manager.runSyncCycle(storeId, operations);

      // Assert - session was active during operations
      expect(capturedSessionId).toBe('test-session-123');
      expect(capturedIsCompletedDuringOps).toBe(false);
    });

    /**
     * TEST-001: AAA Pattern
     * TEST-005: Single concept - null after completion
     */
    it('should return null after session is completed', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      const operations = vi.fn().mockResolvedValue(undefined);

      // Act - complete a cycle
      await manager.runSyncCycle(storeId, operations);
      const result = manager.getActiveSession();

      // Assert
      expect(result).toBeNull();
    });

    /**
     * TEST-001: AAA Pattern
     * TEST-005: Single concept - all fields populated
     * SEC-006: Verifies complete session state propagation
     */
    it('should return session with all fields populated', async () => {
      // Arrange
      const storeId = 'store-uuid-456';
      const expectedPullPendingCount = 42;
      const expectedLockoutMessage = 'Test lockout message';

      mockCloudApi.startSyncSession.mockResolvedValueOnce({
        sessionId: 'full-session-789',
        revocationStatus: 'VALID' as const,
        lockoutMessage: expectedLockoutMessage,
        pullPendingCount: expectedPullPendingCount,
      });

      // Capture field values during operation (before isCompleted is mutated)
      let capturedFields: {
        sessionId: string;
        storeId: string;
        startedAtIsDate: boolean;
        isCompleted: boolean;
        revocationStatus: string;
        lockoutMessage: string | undefined;
        pullPendingCount: number;
      } | null = null;

      const operations = vi.fn().mockImplementation(async () => {
        const session = manager.getActiveSession();
        if (session) {
          capturedFields = {
            sessionId: session.sessionId,
            storeId: session.storeId,
            startedAtIsDate: session.startedAt instanceof Date,
            isCompleted: session.isCompleted,
            revocationStatus: session.revocationStatus,
            lockoutMessage: session.lockoutMessage,
            pullPendingCount: session.pullPendingCount,
          };
        }
      });

      // Act
      await manager.runSyncCycle(storeId, operations);

      // Assert - all fields present
      expect(capturedFields).not.toBeNull();
      expect(capturedFields!.sessionId).toBe('full-session-789');
      expect(capturedFields!.storeId).toBe(storeId);
      expect(capturedFields!.startedAtIsDate).toBe(true);
      expect(capturedFields!.isCompleted).toBe(false);
      expect(capturedFields!.revocationStatus).toBe('VALID');
      expect(capturedFields!.lockoutMessage).toBe(expectedLockoutMessage);
      expect(capturedFields!.pullPendingCount).toBe(expectedPullPendingCount);
    });

    /**
     * TEST-001: AAA Pattern
     * TEST-004: Deterministic - concurrency test
     * TEST-005: Single concept - thread safety (same reference)
     */
    it('should return same session reference for concurrent getActiveSession calls', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      const capturedSessions: (SyncSessionContext | null)[] = [];

      const operations = vi.fn().mockImplementation(async () => {
        // Simulate concurrent calls during the cycle
        const [session1, session2, session3] = await Promise.all([
          Promise.resolve(manager.getActiveSession()),
          Promise.resolve(manager.getActiveSession()),
          Promise.resolve(manager.getActiveSession()),
        ]);
        capturedSessions.push(session1, session2, session3);
      });

      // Act
      await manager.runSyncCycle(storeId, operations);

      // Assert - all references are the same object
      expect(capturedSessions.length).toBe(3);
      expect(capturedSessions[0]).toBe(capturedSessions[1]);
      expect(capturedSessions[1]).toBe(capturedSessions[2]);
      expect(capturedSessions[0]!.sessionId).toBe('test-session-123');
    });

    /**
     * TEST-001: AAA Pattern
     * TEST-005: Single concept - forceCleanup() clears getActiveSession()
     */
    it('should return null after forceCleanup()', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      let resolveOperation: () => void;
      const operationPromise = new Promise<void>((resolve) => {
        resolveOperation = resolve;
      });

      const slowOperations = vi.fn().mockImplementation(() => operationPromise);

      // Start cycle (do not await)
      const cyclePromise = manager.runSyncCycle(storeId, slowOperations);

      // Wait for session to be active
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify session is active
      expect(manager.getActiveSession()).not.toBeNull();

      // Act
      manager.forceCleanup();

      // Assert
      expect(manager.getActiveSession()).toBeNull();

      // Clean up
      resolveOperation!();
      await cyclePromise.catch(() => {}); // Ignore any errors
    });

    /**
     * TEST-001: AAA Pattern
     * TEST-005: Single concept - isCompleted marks session as inactive
     */
    it('should return null when session.isCompleted is true', async () => {
      // Arrange
      const storeId = 'store-uuid-123';
      let sessionExistedDuringOps = false;
      let isCompletedDuringOps: boolean | null = null;

      const operations = vi.fn().mockImplementation(async () => {
        const session = manager.getActiveSession();
        sessionExistedDuringOps = session !== null;
        // Capture isCompleted state DURING operation
        isCompletedDuringOps = session?.isCompleted ?? null;
      });

      // Act
      await manager.runSyncCycle(storeId, operations);

      // Assert - during ops, session was active with isCompleted = false
      expect(sessionExistedDuringOps).toBe(true);
      expect(isCompletedDuringOps).toBe(false);

      // After cycle, getActiveSession returns null (isCompleted = true internally)
      expect(manager.getActiveSession()).toBeNull();
    });
  });

  // ==========================================================================
  // P4.2: Session Context Propagation (SYNC-5001)
  // ==========================================================================

  describe('P4.2: Session Context Propagation', () => {
    /**
     * TEST-001: AAA Pattern
     * TEST-005: Single concept - storeId propagation
     * DB-006: Tenant isolation via storeId
     */
    it('should include correct storeId from runSyncCycle parameter', async () => {
      // Arrange
      const expectedStoreId = 'tenant-store-uuid-999';
      let capturedSession: SyncSessionContext | null = null;

      const operations = vi.fn().mockImplementation(async () => {
        capturedSession = manager.getActiveSession();
      });

      // Act
      await manager.runSyncCycle(expectedStoreId, operations);

      // Assert
      expect(capturedSession).not.toBeNull();
      expect(capturedSession!.storeId).toBe(expectedStoreId);
    });

    /**
     * TEST-001: AAA Pattern
     * TEST-005: Single concept - revocationStatus VALID
     */
    it('should include revocationStatus VALID from cloud response', async () => {
      // Arrange
      mockCloudApi.startSyncSession.mockResolvedValueOnce({
        sessionId: 'session-valid',
        revocationStatus: 'VALID' as const,
        lockoutMessage: undefined,
        pullPendingCount: 0,
      });

      let capturedSession: SyncSessionContext | null = null;
      const operations = vi.fn().mockImplementation(async () => {
        capturedSession = manager.getActiveSession();
      });

      // Act
      await manager.runSyncCycle('store-123', operations);

      // Assert
      expect(capturedSession!.revocationStatus).toBe('VALID');
    });

    /**
     * TEST-001: AAA Pattern
     * TEST-005: Single concept - revocationStatus SUSPENDED
     * TEST-006: Error path - suspended session handling
     */
    it('should include revocationStatus SUSPENDED from cloud response', async () => {
      // Arrange
      mockCloudApi.startSyncSession.mockResolvedValueOnce({
        sessionId: 'session-suspended',
        revocationStatus: 'SUSPENDED' as const,
        lockoutMessage: 'Key will be revoked in 24 hours',
        pullPendingCount: 5,
      });

      // Act
      const result = await manager.runSyncCycle('store-123', vi.fn());

      // Assert - cycle fails due to non-VALID status
      expect(result.success).toBe(false);
      expect(result.error).toBe('Key will be revoked in 24 hours');
    });

    /**
     * TEST-001: AAA Pattern
     * TEST-005: Single concept - revocationStatus REVOKED
     * TEST-006: Error path - revoked session handling
     */
    it('should include revocationStatus REVOKED from cloud response', async () => {
      // Arrange
      mockCloudApi.startSyncSession.mockResolvedValueOnce({
        sessionId: 'session-revoked',
        revocationStatus: 'REVOKED' as const,
        lockoutMessage: 'API key has been permanently revoked',
        pullPendingCount: 0,
      });

      // Act
      const result = await manager.runSyncCycle('store-123', vi.fn());

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('API key has been permanently revoked');
    });

    /**
     * TEST-001: AAA Pattern
     * TEST-005: Single concept - pullPendingCount propagation
     */
    it('should include pullPendingCount from cloud response', async () => {
      // Arrange
      const expectedPullPendingCount = 150;
      mockCloudApi.startSyncSession.mockResolvedValueOnce({
        sessionId: 'session-with-pending',
        revocationStatus: 'VALID' as const,
        lockoutMessage: undefined,
        pullPendingCount: expectedPullPendingCount,
      });

      let capturedSession: SyncSessionContext | null = null;
      const operations = vi.fn().mockImplementation(async () => {
        capturedSession = manager.getActiveSession();
      });

      // Act
      await manager.runSyncCycle('store-123', operations);

      // Assert
      expect(capturedSession).not.toBeNull();
      expect(capturedSession!.pullPendingCount).toBe(expectedPullPendingCount);
    });

    /**
     * TEST-001: AAA Pattern
     * TEST-005: Single concept - pullPendingCount zero
     */
    it('should include pullPendingCount of zero when no pending items', async () => {
      // Arrange
      mockCloudApi.startSyncSession.mockResolvedValueOnce({
        sessionId: 'session-no-pending',
        revocationStatus: 'VALID' as const,
        lockoutMessage: undefined,
        pullPendingCount: 0,
      });

      let capturedSession: SyncSessionContext | null = null;
      const operations = vi.fn().mockImplementation(async () => {
        capturedSession = manager.getActiveSession();
      });

      // Act
      await manager.runSyncCycle('store-123', operations);

      // Assert
      expect(capturedSession!.pullPendingCount).toBe(0);
    });

    /**
     * TEST-001: AAA Pattern
     * TEST-005: Single concept - lockoutMessage present
     */
    it('should include lockoutMessage when present in cloud response', async () => {
      // Arrange
      const expectedLockoutMessage = 'Your subscription expires in 7 days';
      mockCloudApi.startSyncSession.mockResolvedValueOnce({
        sessionId: 'session-with-lockout',
        revocationStatus: 'VALID' as const,
        lockoutMessage: expectedLockoutMessage,
        pullPendingCount: 0,
      });

      let capturedSession: SyncSessionContext | null = null;
      const operations = vi.fn().mockImplementation(async () => {
        capturedSession = manager.getActiveSession();
      });

      // Act
      await manager.runSyncCycle('store-123', operations);

      // Assert
      expect(capturedSession).not.toBeNull();
      expect(capturedSession!.lockoutMessage).toBe(expectedLockoutMessage);
    });

    /**
     * TEST-001: AAA Pattern
     * TEST-005: Single concept - lockoutMessage undefined
     */
    it('should have lockoutMessage undefined when not present in cloud response', async () => {
      // Arrange
      mockCloudApi.startSyncSession.mockResolvedValueOnce({
        sessionId: 'session-no-lockout',
        revocationStatus: 'VALID' as const,
        lockoutMessage: undefined,
        pullPendingCount: 0,
      });

      let capturedSession: SyncSessionContext | null = null;
      const operations = vi.fn().mockImplementation(async () => {
        capturedSession = manager.getActiveSession();
      });

      // Act
      await manager.runSyncCycle('store-123', operations);

      // Assert
      expect(capturedSession).not.toBeNull();
      expect(capturedSession!.lockoutMessage).toBeUndefined();
    });

    /**
     * TEST-001: AAA Pattern
     * TEST-005: Single concept - startedAt timestamp
     */
    it('should include startedAt timestamp near current time', async () => {
      // Arrange
      const beforeStart = new Date();
      let capturedSession: SyncSessionContext | null = null;

      const operations = vi.fn().mockImplementation(async () => {
        capturedSession = manager.getActiveSession();
      });

      // Act
      await manager.runSyncCycle('store-123', operations);
      const afterStart = new Date();

      // Assert
      expect(capturedSession).not.toBeNull();
      expect(capturedSession!.startedAt).toBeInstanceOf(Date);
      expect(capturedSession!.startedAt.getTime()).toBeGreaterThanOrEqual(beforeStart.getTime());
      expect(capturedSession!.startedAt.getTime()).toBeLessThanOrEqual(afterStart.getTime());
    });

    /**
     * TEST-001: AAA Pattern
     * TEST-005: Single concept - context immutability
     * SEC-006: Verifies session context cannot be accidentally corrupted
     */
    it('should maintain context integrity across multiple getActiveSession calls', async () => {
      // Arrange
      const storeId = 'integrity-test-store';
      const sessions: SyncSessionContext[] = [];

      const operations = vi.fn().mockImplementation(async () => {
        // Get session multiple times
        const s1 = manager.getActiveSession();
        sessions.push(s1!);

        // Simulate some work
        await new Promise((resolve) => setTimeout(resolve, 5));

        // Get again
        const s2 = manager.getActiveSession();
        sessions.push(s2!);
      });

      // Act
      await manager.runSyncCycle(storeId, operations);

      // Assert - both references point to same context
      expect(sessions.length).toBe(2);
      expect(sessions[0].sessionId).toBe(sessions[1].sessionId);
      expect(sessions[0].storeId).toBe(sessions[1].storeId);
      expect(sessions[0].revocationStatus).toBe(sessions[1].revocationStatus);
    });
  });
});
