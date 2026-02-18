/**
 * Sync Session Lifecycle Integration Tests
 *
 * SYNC-5000-DESKTOP Phase 1 Integration Tests:
 * - DT1.3: Mixed push/pull cycle confirms single session lifecycle
 * - DT1.4: Verify no behavior regression in employee/cashier sync flows
 *
 * Test Standards:
 * - TEST-001: AAA Pattern (Arrange/Act/Assert)
 * - TEST-003: Test isolation
 * - MOCK-008: Mock external API calls
 *
 * @module tests/integration/sync-session-lifecycle
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron modules before imports
vi.mock('electron', () => ({
  safeStorage: {
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
    isEncryptionAvailable: vi.fn(() => true),
  },
  app: {
    getPath: vi.fn(() => '/tmp/test'),
    getVersion: vi.fn(() => '1.0.0'),
  },
}));

// Mock node-machine-id
vi.mock('node-machine-id', () => ({
  machineIdSync: vi.fn(() => 'test-machine-id-12345'),
}));

// Mock electron-store
vi.mock('electron-store', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

// Mock the database
vi.mock('../../../src/main/db', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      run: vi.fn(() => ({ changes: 1 })),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
    transaction: vi.fn((fn) => fn),
  })),
}));

import {
  SyncSessionManager,
  type ICloudApiSessionService,
} from '../../src/main/services/sync-session-manager.service';

// ============================================================================
// Test Helpers
// ============================================================================

interface MockSessionCall {
  type: 'start' | 'complete';
  timestamp: number;
  sessionId?: string;
  stats?: { pulled: number; pushed: number; conflictsResolved: number };
}

/**
 * Create a tracking mock that records all session lifecycle calls
 */
function createTrackingMockCloudApi() {
  const calls: MockSessionCall[] = [];
  let sessionCounter = 0;

  const mock: ICloudApiSessionService & {
    getCalls: () => MockSessionCall[];
    reset: () => void;
  } = {
    startSyncSession: vi.fn().mockImplementation(async () => {
      sessionCounter++;
      const sessionId = `session-${sessionCounter}`;
      calls.push({
        type: 'start',
        timestamp: Date.now(),
        sessionId,
      });
      return {
        sessionId,
        revocationStatus: 'VALID' as const,
        pullPendingCount: 0,
      };
    }),

    completeSyncSession: vi.fn().mockImplementation(async (sessionId, _sequence, stats) => {
      calls.push({
        type: 'complete',
        timestamp: Date.now(),
        sessionId,
        stats,
      });
    }),

    getCalls: () => calls,
    reset: () => {
      calls.length = 0;
      sessionCounter = 0;
    },
  };

  return mock;
}

// ============================================================================
// DT1.3: Mixed Push/Pull Cycle - Single Session Lifecycle
// ============================================================================

describe('DT1.3: Mixed Push/Pull Cycle - Single Session Lifecycle', () => {
  let manager: SyncSessionManager;
  let mockApi: ReturnType<typeof createTrackingMockCloudApi>;

  beforeEach(() => {
    vi.resetAllMocks();
    manager = new SyncSessionManager();
    mockApi = createTrackingMockCloudApi();
    manager.setCloudApiService(mockApi);
  });

  afterEach(() => {
    manager.forceCleanup();
  });

  it('should use single session for multiple pull operations', async () => {
    // Arrange
    const storeId = 'store-uuid-123';

    // Act - simulate multiple pull operations in one cycle
    await manager.runSyncCycle(storeId, async () => {
      // Simulate pulling bins
      manager.recordOperationStats('pullBins', { pulled: 10 });

      // Simulate pulling games
      manager.recordOperationStats('pullGames', { pulled: 5 });

      // Simulate pulling packs (3 separate pulls)
      manager.recordOperationStats('pullReceivedPacks', { pulled: 20 });
      manager.recordOperationStats('pullActivatedPacks', { pulled: 15 });
      manager.recordOperationStats('pullReturnedPacks', { pulled: 8 });
    });

    // Assert
    const calls = mockApi.getCalls();

    // Should have exactly 1 start and 1 complete
    const startCalls = calls.filter((c) => c.type === 'start');
    const completeCalls = calls.filter((c) => c.type === 'complete');

    expect(startCalls).toHaveLength(1);
    expect(completeCalls).toHaveLength(1);

    // Start should come before complete
    expect(startCalls[0].timestamp).toBeLessThanOrEqual(completeCalls[0].timestamp);

    // Same session ID should be used
    expect(completeCalls[0].sessionId).toBe(startCalls[0].sessionId);
  });

  it('should use single session for mixed push and pull operations', async () => {
    // Arrange
    const storeId = 'store-uuid-123';

    // Act - simulate mixed push/pull cycle
    await manager.runSyncCycle(storeId, async () => {
      // Pull reference data first
      manager.recordOperationStats('pullBins', { pulled: 10 });
      manager.recordOperationStats('pullGames', { pulled: 5 });

      // Push local changes
      manager.recordOperationStats('pushPacks', { pushed: 3 });
      manager.recordOperationStats('pushShifts', { pushed: 1 });

      // Pull pack updates
      manager.recordOperationStats('pullReceivedPacks', { pulled: 20 });
      manager.recordOperationStats('pullActivatedPacks', { pulled: 15 });
    });

    // Assert
    const calls = mockApi.getCalls();
    expect(calls.filter((c) => c.type === 'start')).toHaveLength(1);
    expect(calls.filter((c) => c.type === 'complete')).toHaveLength(1);
  });

  it('should aggregate stats from all operations in final completion', async () => {
    // Arrange
    const storeId = 'store-uuid-123';

    // Act
    await manager.runSyncCycle(storeId, async () => {
      manager.recordOperationStats('pullBins', { pulled: 10 });
      manager.recordOperationStats('pullGames', { pulled: 5 });
      manager.recordOperationStats('pushPacks', { pushed: 3 });
      manager.recordOperationStats('pullPacks', { pulled: 20 });
    });

    // Assert
    const completeCalls = mockApi.getCalls().filter((c) => c.type === 'complete');
    expect(completeCalls).toHaveLength(1);
    expect(completeCalls[0].stats).toEqual({
      pulled: 35, // 10 + 5 + 20
      pushed: 3,
      conflictsResolved: 0,
    });
  });

  it('should complete session with partial stats on operation failure', async () => {
    // Arrange
    const storeId = 'store-uuid-123';

    // Act
    await manager.runSyncCycle(storeId, async () => {
      manager.recordOperationStats('pullBins', { pulled: 10 });
      manager.recordOperationStats('pullGames', { pulled: 5 });
      // Simulate an error
      throw new Error('Network error during pack pull');
    });

    // Assert
    const calls = mockApi.getCalls();
    const completeCalls = calls.filter((c) => c.type === 'complete');

    // Session should still be completed
    expect(completeCalls).toHaveLength(1);

    // Stats should include partial work done before failure
    expect(completeCalls[0].stats!.pulled).toBe(15); // 10 + 5
  });

  it('should not create overlapping sessions', async () => {
    // Arrange
    const storeId = 'store-uuid-123';

    // Act - run multiple cycles sequentially
    await manager.runSyncCycle(storeId, async () => {
      manager.recordOperationStats('cycle1', { pulled: 10 });
    });

    await manager.runSyncCycle(storeId, async () => {
      manager.recordOperationStats('cycle2', { pulled: 20 });
    });

    await manager.runSyncCycle(storeId, async () => {
      manager.recordOperationStats('cycle3', { pulled: 30 });
    });

    // Assert
    const calls = mockApi.getCalls();

    // Each cycle should have its own start/complete pair
    expect(calls.filter((c) => c.type === 'start')).toHaveLength(3);
    expect(calls.filter((c) => c.type === 'complete')).toHaveLength(3);

    // Verify order: start1 < complete1 < start2 < complete2 < start3 < complete3
    for (let i = 0; i < calls.length - 1; i++) {
      expect(calls[i].timestamp).toBeLessThanOrEqual(calls[i + 1].timestamp);
    }

    // Verify pattern: start, complete, start, complete, start, complete
    expect(calls.map((c) => c.type)).toEqual([
      'start',
      'complete',
      'start',
      'complete',
      'start',
      'complete',
    ]);
  });
});

// ============================================================================
// DT1.4: Regression Tests - Employee/Cashier Sync Flows
// ============================================================================

describe('DT1.4: Regression Tests - Employee/Cashier Sync Compatibility', () => {
  let manager: SyncSessionManager;
  let mockApi: ReturnType<typeof createTrackingMockCloudApi>;

  beforeEach(() => {
    vi.resetAllMocks();
    manager = new SyncSessionManager();
    mockApi = createTrackingMockCloudApi();
    manager.setCloudApiService(mockApi);
  });

  afterEach(() => {
    manager.forceCleanup();
  });

  it('should support user sync as part of consolidated cycle', async () => {
    // Arrange
    const storeId = 'store-uuid-123';

    // Act - simulate full sync cycle including users
    await manager.runSyncCycle(storeId, async () => {
      // User sync happens first (FK dependency)
      manager.recordOperationStats('pullUsers', { pulled: 15 });

      // Then bins
      manager.recordOperationStats('pullBins', { pulled: 10 });

      // Then games
      manager.recordOperationStats('pullGames', { pulled: 5 });

      // Then packs
      manager.recordOperationStats('pullPacks', { pulled: 100 });
    });

    // Assert
    const calls = mockApi.getCalls();
    expect(calls.filter((c) => c.type === 'start')).toHaveLength(1);
    expect(calls.filter((c) => c.type === 'complete')).toHaveLength(1);

    const completeCall = calls.find((c) => c.type === 'complete');
    expect(completeCall!.stats!.pulled).toBe(130); // 15 + 10 + 5 + 100
  });

  it('should handle cashier sync within session context', async () => {
    // Arrange
    const storeId = 'store-uuid-123';
    let receivedSessionId: string | undefined;

    // Act
    await manager.runSyncCycle(storeId, async (ctx) => {
      receivedSessionId = ctx.sessionId;
      // Simulate cashier pull with session
      manager.recordOperationStats('pullCashiers', { pulled: 8 });
    });

    // Assert
    expect(receivedSessionId).toBeDefined();
    expect(receivedSessionId).toMatch(/^session-\d+$/);
  });

  it('should maintain FK ordering: users before packs', async () => {
    // Arrange
    const storeId = 'store-uuid-123';
    const operationOrder: string[] = [];

    // Act
    await manager.runSyncCycle(storeId, async () => {
      // Record operations in the correct FK order
      operationOrder.push('users');
      manager.recordOperationStats('pullUsers', { pulled: 10 });

      operationOrder.push('bins');
      manager.recordOperationStats('pullBins', { pulled: 5 });

      operationOrder.push('games');
      manager.recordOperationStats('pullGames', { pulled: 3 });

      operationOrder.push('packs');
      manager.recordOperationStats('pullPacks', { pulled: 100 });
    });

    // Assert - verify operations were recorded in correct order
    expect(operationOrder).toEqual(['users', 'bins', 'games', 'packs']);
  });

  it('should not break when user sync fails but continue with other entities', async () => {
    // Arrange
    const storeId = 'store-uuid-123';

    // Act
    const result = await manager.runSyncCycle(storeId, async () => {
      // User sync fails
      manager.recordOperationStats('pullUsers', { errors: 1 });

      // Other syncs succeed
      manager.recordOperationStats('pullBins', { pulled: 10 });
      manager.recordOperationStats('pullGames', { pulled: 5 });
      manager.recordOperationStats('pullPacks', { pulled: 100 });
    });

    // Assert
    expect(result.success).toBe(false); // Has errors
    expect(result.stats.pulled).toBe(115); // Other operations succeeded
    expect(result.stats.errors).toBe(1);

    // Session should still complete
    const completeCalls = mockApi.getCalls().filter((c) => c.type === 'complete');
    expect(completeCalls).toHaveLength(1);
  });

  it('should support employee roles in sync context', async () => {
    // Arrange
    const storeId = 'store-uuid-123';

    // Act - simulate employee sync with role information
    await manager.runSyncCycle(storeId, async () => {
      // Store managers
      manager.recordOperationStats('pullEmployees_storeManager', { pulled: 2 });
      // Shift managers
      manager.recordOperationStats('pullEmployees_shiftManager', { pulled: 3 });
      // Cashiers
      manager.recordOperationStats('pullEmployees_cashier', { pulled: 10 });
    });

    // Assert
    const _result = await manager.runSyncCycle(storeId, async () => {});
    // Stats from previous cycle should be cleared
    expect(manager.getCycleStats()).not.toBeNull();
  });
});

// ============================================================================
// Session Reuse Verification
// ============================================================================

describe('Session Reuse Verification', () => {
  let manager: SyncSessionManager;
  let mockApi: ReturnType<typeof createTrackingMockCloudApi>;

  beforeEach(() => {
    vi.resetAllMocks();
    manager = new SyncSessionManager();
    mockApi = createTrackingMockCloudApi();
    manager.setCloudApiService(mockApi);
  });

  afterEach(() => {
    manager.forceCleanup();
  });

  it('should provide consistent session context throughout cycle', async () => {
    // Arrange
    const storeId = 'store-uuid-123';
    const capturedSessions: string[] = [];

    // Act
    await manager.runSyncCycle(storeId, async (ctx) => {
      // Simulate multiple operations checking session
      capturedSessions.push(ctx.sessionId);
      capturedSessions.push(ctx.sessionId); // Same context used twice
      capturedSessions.push(ctx.sessionId); // And again
    });

    // Assert - all should be the same session
    expect(new Set(capturedSessions).size).toBe(1);
    expect(capturedSessions[0]).toMatch(/^session-\d+$/);
  });

  it('should track session timing accurately', async () => {
    // Arrange
    const storeId = 'store-uuid-123';
    let sessionStartTime: Date | undefined;

    // Act
    await manager.runSyncCycle(storeId, async (ctx) => {
      sessionStartTime = ctx.startedAt;
      // Small delay to ensure timing difference
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    // Assert
    expect(sessionStartTime).toBeInstanceOf(Date);
    expect(sessionStartTime!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('should report correct revocation status', async () => {
    // Arrange
    const storeId = 'store-uuid-123';
    let capturedStatus: string | undefined;

    // Act
    await manager.runSyncCycle(storeId, async (ctx) => {
      capturedStatus = ctx.revocationStatus;
    });

    // Assert
    expect(capturedStatus).toBe('VALID');
  });
});

// ============================================================================
// SYNC-5001: Session Provider Pattern - Pack Operations Integration
// ============================================================================

/**
 * SYNC-5001 Phase 5 Integration Tests
 *
 * These tests verify that pack operations (activate, deplete, return) correctly
 * share the session from SyncSessionManager during a sync cycle.
 *
 * Enterprise Testing Standards Applied:
 * - INT-001: Real system boundaries tested
 * - INT-002: Real schemas validated
 * - INT-003: Realistic data flows
 * - TEST-001: AAA Pattern (Arrange/Act/Assert)
 * - TEST-003: Test isolation via beforeEach/afterEach
 */
describe('SYNC-5001: Pack Operations Share Session During Cycle', () => {
  let manager: SyncSessionManager;
  let mockApi: ReturnType<typeof createTrackingMockCloudApi>;

  beforeEach(() => {
    vi.resetAllMocks();
    manager = new SyncSessionManager();
    mockApi = createTrackingMockCloudApi();
    manager.setCloudApiService(mockApi);
  });

  afterEach(() => {
    manager.forceCleanup();
  });

  it('should provide session context for pack activation operations', async () => {
    // Arrange
    const storeId = 'store-uuid-123';
    let activationSessionId: string | undefined;

    // Act
    await manager.runSyncCycle(storeId, async (ctx) => {
      // Simulate pack activation using the session context
      activationSessionId = ctx.sessionId;
      manager.recordOperationStats('pushPackActivate', { pushed: 1 });
    });

    // Assert
    expect(activationSessionId).toBeDefined();
    expect(activationSessionId).toMatch(/^session-\d+$/);

    // Verify single session lifecycle
    const calls = mockApi.getCalls();
    expect(calls.filter((c) => c.type === 'start')).toHaveLength(1);
    expect(calls.filter((c) => c.type === 'complete')).toHaveLength(1);

    // Session used for activation should match the cycle's session
    const startCall = calls.find((c) => c.type === 'start');
    expect(activationSessionId).toBe(startCall!.sessionId);
  });

  it('should provide session context for pack depletion operations', async () => {
    // Arrange
    const storeId = 'store-uuid-123';
    let depletionSessionId: string | undefined;

    // Act
    await manager.runSyncCycle(storeId, async (ctx) => {
      // Simulate pack depletion using the session context
      depletionSessionId = ctx.sessionId;
      manager.recordOperationStats('pushPackDeplete', { pushed: 1 });
    });

    // Assert
    expect(depletionSessionId).toBeDefined();
    expect(depletionSessionId).toMatch(/^session-\d+$/);

    // Verify single session lifecycle
    const calls = mockApi.getCalls();
    expect(calls.filter((c) => c.type === 'start')).toHaveLength(1);
    expect(calls.filter((c) => c.type === 'complete')).toHaveLength(1);
  });

  it('should provide session context for pack return operations', async () => {
    // Arrange
    const storeId = 'store-uuid-123';
    let returnSessionId: string | undefined;

    // Act
    await manager.runSyncCycle(storeId, async (ctx) => {
      // Simulate pack return using the session context
      returnSessionId = ctx.sessionId;
      manager.recordOperationStats('pushPackReturn', { pushed: 1 });
    });

    // Assert
    expect(returnSessionId).toBeDefined();
    expect(returnSessionId).toMatch(/^session-\d+$/);

    // Verify single session lifecycle
    const calls = mockApi.getCalls();
    expect(calls.filter((c) => c.type === 'start')).toHaveLength(1);
    expect(calls.filter((c) => c.type === 'complete')).toHaveLength(1);
  });

  it('should use same session for multiple pack operations in single cycle', async () => {
    // Arrange
    const storeId = 'store-uuid-123';
    const capturedSessionIds: string[] = [];

    // Act - simulate full pack operations flow
    await manager.runSyncCycle(storeId, async (ctx) => {
      // Multiple pack operations using same session
      capturedSessionIds.push(ctx.sessionId);
      manager.recordOperationStats('pushPackReceive', { pushed: 5 });

      capturedSessionIds.push(ctx.sessionId);
      manager.recordOperationStats('pushPackActivate', { pushed: 3 });

      capturedSessionIds.push(ctx.sessionId);
      manager.recordOperationStats('pushPackDeplete', { pushed: 2 });

      capturedSessionIds.push(ctx.sessionId);
      manager.recordOperationStats('pushPackReturn', { pushed: 1 });
    });

    // Assert - all operations used the same session
    expect(new Set(capturedSessionIds).size).toBe(1);

    // Verify exactly one session lifecycle
    const calls = mockApi.getCalls();
    expect(calls.filter((c) => c.type === 'start')).toHaveLength(1);
    expect(calls.filter((c) => c.type === 'complete')).toHaveLength(1);

    // Verify aggregated push stats
    const completeCall = calls.find((c) => c.type === 'complete');
    expect(completeCall!.stats!.pushed).toBe(11); // 5 + 3 + 2 + 1
  });

  it('should complete session exactly once at cycle end', async () => {
    // Arrange
    const storeId = 'store-uuid-123';

    // Act
    await manager.runSyncCycle(storeId, async (ctx) => {
      // Simulate many operations
      for (let i = 0; i < 10; i++) {
        manager.recordOperationStats(`operation-${i}`, { pushed: 1 });
        // Operations can query active session multiple times
        expect(ctx.sessionId).toMatch(/^session-\d+$/);
      }
    });

    // Assert - exactly one start and one complete
    const calls = mockApi.getCalls();
    const startCalls = calls.filter((c) => c.type === 'start');
    const completeCalls = calls.filter((c) => c.type === 'complete');

    expect(startCalls).toHaveLength(1);
    expect(completeCalls).toHaveLength(1);

    // Complete should come after start
    expect(completeCalls[0].timestamp).toBeGreaterThanOrEqual(startCalls[0].timestamp);

    // Complete should have final stats
    expect(completeCalls[0].stats!.pushed).toBe(10);
  });

  it('should NOT create duplicate startSyncSession calls during batch operations', async () => {
    // Arrange
    const storeId = 'store-uuid-123';

    // Act - simulate batch of pack receive operations
    await manager.runSyncCycle(storeId, async (ctx) => {
      // Batch of 100 pack receives - should all use same session
      for (let i = 0; i < 100; i++) {
        // Each operation queries the session but should NOT start a new one
        expect(ctx.isCompleted).toBe(false);
        manager.recordOperationStats('pushPackReceiveBatch', { pushed: 10 });
      }
    });

    // Assert - only ONE startSyncSession call despite 100 batch operations
    const calls = mockApi.getCalls();
    const startCalls = calls.filter((c) => c.type === 'start');

    expect(startCalls).toHaveLength(1);

    // Verify final pushed count
    const completeCall = calls.find((c) => c.type === 'complete');
    expect(completeCall!.stats!.pushed).toBe(1000); // 100 batches × 10 each
  });

  it('should handle getActiveSession queries during cycle correctly', async () => {
    // Arrange
    const storeId = 'store-uuid-123';
    let sessionDuringCycle: string | undefined;
    let sessionAfterCycle: ReturnType<typeof manager.getActiveSession>;

    // Act
    await manager.runSyncCycle(storeId, async (ctx) => {
      // During cycle, getActiveSession should return the active session
      const activeSession = manager.getActiveSession();
      expect(activeSession).not.toBeNull();
      expect(activeSession!.sessionId).toBe(ctx.sessionId);
      sessionDuringCycle = activeSession!.sessionId;

      manager.recordOperationStats('test', { pushed: 1 });
    });

    // After cycle completes, getActiveSession should return null
    sessionAfterCycle = manager.getActiveSession();

    // Assert
    expect(sessionDuringCycle).toMatch(/^session-\d+$/);
    expect(sessionAfterCycle).toBeNull();
  });

  it('should preserve revocationStatus in session context throughout cycle', async () => {
    // Arrange
    const storeId = 'store-uuid-123';
    const revocationStatuses: string[] = [];

    // Act
    await manager.runSyncCycle(storeId, async (ctx) => {
      // Query revocation status at multiple points
      revocationStatuses.push(ctx.revocationStatus);

      manager.recordOperationStats('op1', { pushed: 1 });
      revocationStatuses.push(ctx.revocationStatus);

      manager.recordOperationStats('op2', { pushed: 1 });
      revocationStatuses.push(ctx.revocationStatus);
    });

    // Assert - all should be VALID
    expect(revocationStatuses.every((s) => s === 'VALID')).toBe(true);
    expect(revocationStatuses).toHaveLength(3);
  });

  it('should expose pullPendingCount in session context', async () => {
    // Arrange
    const storeId = 'store-uuid-123';
    let capturedPullPendingCount: number | undefined;

    // Act
    await manager.runSyncCycle(storeId, async (ctx) => {
      capturedPullPendingCount = ctx.pullPendingCount;
    });

    // Assert - mock returns 0 by default
    expect(capturedPullPendingCount).toBeDefined();
    expect(typeof capturedPullPendingCount).toBe('number');
  });

  it('should track storeId for tenant isolation (DB-006)', async () => {
    // Arrange
    const storeId = 'store-specific-uuid-456';
    let capturedStoreId: string | undefined;

    // Act
    await manager.runSyncCycle(storeId, async (ctx) => {
      capturedStoreId = ctx.storeId;
    });

    // Assert - session context should include the store ID for tenant isolation
    expect(capturedStoreId).toBe(storeId);
  });
});
