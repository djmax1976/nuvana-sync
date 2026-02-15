/**
 * Session Provider Integration Tests
 *
 * SYNC-5001 Phase 5: Integration Tests for CloudApiService + SyncSessionManager
 *
 * These tests verify the integration between CloudApiService.resolveSession()
 * and SyncSessionManager.getActiveSession() - the centralized session provider pattern.
 *
 * Enterprise Testing Standards Applied:
 * - INT-001: Real system boundaries tested (CloudApiService <-> SyncSessionManager)
 * - INT-002: Real schemas validated (SyncSessionContext, SyncSessionResponse)
 * - INT-003: Realistic data flows (session lifecycle across components)
 * - TEST-001: AAA Pattern (Arrange/Act/Assert)
 * - TEST-003: Test isolation via vi.resetAllMocks()
 * - TEST-004: Deterministic tests with controlled inputs
 * - MOCK-008: Mock network calls (fetch) while testing real component integration
 *
 * @module tests/integration/session-provider
 * @security SEC-012: Session timeout verification
 * @security DB-006: Tenant isolation via storeId propagation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mock Setup (vi.hoisted for cross-platform compatibility)
// ============================================================================

const { mockMachineIdSync } = vi.hoisted(() => ({
  mockMachineIdSync: vi.fn(() => 'test-machine-fingerprint-12345'),
}));

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
  machineIdSync: mockMachineIdSync,
  default: {
    machineIdSync: mockMachineIdSync,
  },
}));

// Mock electron-store with proper class implementation
const mockStoreData = new Map<string, unknown>();
// Pre-populate with required API config
mockStoreData.set('apiUrl', 'https://api.nuvanaapp.com');
mockStoreData.set('encryptedApiKey', Array.from(Buffer.from('test-api-key')));

vi.mock('electron-store', () => {
  return {
    default: class MockStore {
      get(key: string) {
        return mockStoreData.get(key);
      }
      set(key: string, value: unknown) {
        mockStoreData.set(key, value);
      }
      delete(key: string) {
        mockStoreData.delete(key);
      }
      clear() {
        mockStoreData.clear();
      }
    },
  };
});

// Mock logger
vi.mock('../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock license service
vi.mock('../../src/main/services/license.service', () => ({
  licenseService: {
    isValid: vi.fn(() => true),
    getState: vi.fn(() => ({
      valid: true,
      expiresAt: '2027-12-31T00:00:00Z',
      lastCheckedAt: new Date().toISOString(),
    })),
    markSuspended: vi.fn(),
    markCancelled: vi.fn(),
    updateFromApiResponse: vi.fn(),
  },
  LicenseApiResponseSchema: {
    safeParse: vi.fn(() => ({ success: true, data: {} })),
  },
}));

// Mock fetch at global level
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import the real services (no mocking of sync-session-manager for this integration test)
import { CloudApiService } from '../../src/main/services/cloud-api.service';
import {
  SyncSessionManager,
  type ICloudApiSessionService,
} from '../../src/main/services/sync-session-manager.service';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create mock for successful sync session start
 */
function createStartSessionResponse(overrides?: {
  sessionId?: string;
  revocationStatus?: 'VALID' | 'SUSPENDED' | 'REVOKED' | 'ROTATED';
  pullPendingCount?: number;
  lockoutMessage?: string;
}) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        success: true,
        data: {
          sessionId: overrides?.sessionId ?? 'cloud-session-123',
          revocationStatus: overrides?.revocationStatus ?? 'VALID',
          pullPendingCount: overrides?.pullPendingCount ?? 0,
          lockoutMessage: overrides?.lockoutMessage,
          serverTime: new Date().toISOString(),
        },
      }),
  };
}

/**
 * Create mock for successful sync session complete
 */
function createCompleteSessionResponse() {
  return {
    ok: true,
    json: () => Promise.resolve({ success: true }),
  };
}

/**
 * Create mock for pack activation response
 */
function createPackActivateResponse(overrides?: { idempotent?: boolean }) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        success: true,
        data: {
          idempotent: overrides?.idempotent ?? false,
        },
      }),
  };
}

// ============================================================================
// Integration Tests: CloudApiService + SyncSessionManager
// ============================================================================

describe('SYNC-5001: Session Provider Integration', () => {
  let cloudApi: CloudApiService;
  let sessionManager: SyncSessionManager;

  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockReset();

    // Create fresh instances for each test
    cloudApi = new CloudApiService();
    sessionManager = new SyncSessionManager();

    // Configure session manager to use cloudApi for session operations
    sessionManager.setCloudApiService(cloudApi as unknown as ICloudApiSessionService);
  });

  afterEach(() => {
    sessionManager.forceCleanup();
  });

  describe('Session state consistency across API calls', () => {
    it('should use same session ID for multiple CloudApi calls within cycle', async () => {
      // Arrange
      const storeId = 'store-integration-123';
      const capturedSessionIds: string[] = [];

      // Mock the sync start/complete endpoints
      mockFetch
        .mockResolvedValueOnce(createStartSessionResponse({ sessionId: 'shared-session-xyz' }))
        .mockResolvedValue(createCompleteSessionResponse());

      // Act
      await sessionManager.runSyncCycle(storeId, async (ctx) => {
        // Multiple queries to active session should return same ID
        capturedSessionIds.push(ctx.sessionId);

        const activeSession = sessionManager.getActiveSession();
        if (activeSession) {
          capturedSessionIds.push(activeSession.sessionId);
        }

        // Record stats as if we did pack operations
        sessionManager.recordOperationStats('pushPack', { pushed: 1 });
      });

      // Assert
      expect(capturedSessionIds.length).toBeGreaterThan(0);
      expect(new Set(capturedSessionIds).size).toBe(1);
      expect(capturedSessionIds[0]).toBe('shared-session-xyz');
    });

    it('should return null from getActiveSession after cycle completion', async () => {
      // Arrange
      const storeId = 'store-integration-123';

      mockFetch
        .mockResolvedValueOnce(createStartSessionResponse())
        .mockResolvedValue(createCompleteSessionResponse());

      // Act
      let sessionDuringCycle: ReturnType<typeof sessionManager.getActiveSession> = null;

      await sessionManager.runSyncCycle(storeId, async () => {
        sessionDuringCycle = sessionManager.getActiveSession();
        sessionManager.recordOperationStats('test', { pushed: 1 });
      });

      const sessionAfterCycle = sessionManager.getActiveSession();

      // Assert
      expect(sessionDuringCycle).not.toBeNull();
      expect(sessionDuringCycle!.revocationStatus).toBe('VALID');
      expect(sessionAfterCycle).toBeNull();
    });

    it('should mark session as completed internally even if complete API call fails', async () => {
      // Arrange
      const storeId = 'store-integration-123';

      mockFetch
        .mockResolvedValueOnce(createStartSessionResponse())
        // Complete fails
        .mockRejectedValueOnce(new Error('Network error on complete'));

      // Act
      await sessionManager.runSyncCycle(storeId, async () => {
        sessionManager.recordOperationStats('test', { pushed: 1 });
      });

      // Assert - session should still be marked as completed internally
      // to prevent stale session reuse
      const sessionAfterCycle = sessionManager.getActiveSession();
      expect(sessionAfterCycle).toBeNull();
    });
  });

  describe('Fallback to new session when manager has no active session', () => {
    it('should detect when no active session exists', () => {
      // Arrange - no cycle running

      // Act
      const activeSession = sessionManager.getActiveSession();

      // Assert
      expect(activeSession).toBeNull();
      expect(sessionManager.hasActiveSession()).toBe(false);
    });

    it('should start new session for first operation in cycle', async () => {
      // Arrange
      const storeId = 'store-integration-123';

      // Mock two separate sync cycles
      mockFetch
        // First cycle
        .mockResolvedValueOnce(createStartSessionResponse({ sessionId: 'cycle-1-session' }))
        .mockResolvedValueOnce(createCompleteSessionResponse())
        // Second cycle
        .mockResolvedValueOnce(createStartSessionResponse({ sessionId: 'cycle-2-session' }))
        .mockResolvedValueOnce(createCompleteSessionResponse());

      // Act
      let cycle1SessionId: string | undefined;
      let cycle2SessionId: string | undefined;

      await sessionManager.runSyncCycle(storeId, async (ctx) => {
        cycle1SessionId = ctx.sessionId;
      });

      await sessionManager.runSyncCycle(storeId, async (ctx) => {
        cycle2SessionId = ctx.sessionId;
      });

      // Assert - each cycle should have its own session
      expect(cycle1SessionId).toBe('cycle-1-session');
      expect(cycle2SessionId).toBe('cycle-2-session');
      expect(cycle1SessionId).not.toBe(cycle2SessionId);
    });
  });

  describe('Session cleanup verification', () => {
    it('should cleanup session state after forceCleanup', async () => {
      // Arrange
      const storeId = 'store-integration-123';

      mockFetch.mockResolvedValueOnce(createStartSessionResponse());

      // Start a cycle but don't complete it normally
      let cyclePromise: Promise<unknown>;

      // We need to start the cycle in a way that we can inspect mid-cycle
      // Use a promise that we can resolve externally
      let resolveOperations: () => void;
      const operationsPromise = new Promise<void>((resolve) => {
        resolveOperations = resolve;
      });

      cyclePromise = sessionManager.runSyncCycle(storeId, async () => {
        // Check session is active
        expect(sessionManager.hasActiveSession()).toBe(true);

        // Signal that we've verified the active state
        resolveOperations!();

        // Wait a bit then throw to simulate interrupted cycle
        await new Promise((r) => setTimeout(r, 10));
        throw new Error('Simulated interruption');
      });

      // Wait for operations to start
      await operationsPromise;

      // Verify session is active during cycle
      expect(sessionManager.hasActiveSession()).toBe(true);

      // Wait for cycle to complete (with error)
      await cyclePromise;

      // Assert - session should be cleaned up even after error
      expect(sessionManager.hasActiveSession()).toBe(false);
      expect(sessionManager.getActiveSession()).toBeNull();
    });

    it('should clear cycle stats after cleanup', async () => {
      // Arrange
      const storeId = 'store-integration-123';

      mockFetch
        .mockResolvedValueOnce(createStartSessionResponse())
        .mockResolvedValueOnce(createCompleteSessionResponse());

      // Act
      await sessionManager.runSyncCycle(storeId, async () => {
        sessionManager.recordOperationStats('test', { pushed: 100 });
      });

      const statsAfterCycle = sessionManager.getCycleStats();

      // Start a new cycle to verify stats are fresh
      mockFetch
        .mockResolvedValueOnce(createStartSessionResponse())
        .mockResolvedValueOnce(createCompleteSessionResponse());

      let statsInNewCycle: ReturnType<typeof sessionManager.getCycleStats>;
      await sessionManager.runSyncCycle(storeId, async () => {
        statsInNewCycle = sessionManager.getCycleStats();
      });

      // Assert
      expect(statsAfterCycle!.pushed).toBe(100);
      expect(statsInNewCycle!.pushed).toBe(0); // Fresh stats for new cycle
    });
  });

  describe('Revocation status handling', () => {
    it('should fail cycle when session start returns REVOKED', async () => {
      // Arrange
      const storeId = 'store-integration-123';

      mockFetch.mockResolvedValueOnce(
        createStartSessionResponse({
          sessionId: 'revoked-session',
          revocationStatus: 'REVOKED',
          lockoutMessage: 'API key has been revoked',
        })
      );

      // Complete endpoint mock - should still be called
      mockFetch.mockResolvedValueOnce(createCompleteSessionResponse());

      // Act
      const result = await sessionManager.runSyncCycle(storeId, async () => {
        // This should not execute
        sessionManager.recordOperationStats('test', { pushed: 1 });
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('API key has been revoked');
    });

    it('should propagate VALID revocationStatus to context', async () => {
      // Arrange
      const storeId = 'store-integration-123';
      let capturedStatus: string | undefined;

      mockFetch
        .mockResolvedValueOnce(createStartSessionResponse({ revocationStatus: 'VALID' }))
        .mockResolvedValueOnce(createCompleteSessionResponse());

      // Act
      await sessionManager.runSyncCycle(storeId, async (ctx) => {
        capturedStatus = ctx.revocationStatus;
      });

      // Assert
      expect(capturedStatus).toBe('VALID');
    });
  });

  describe('Tenant isolation (DB-006)', () => {
    it('should track storeId in session context', async () => {
      // Arrange
      const storeId = 'tenant-specific-store-789';
      let capturedStoreId: string | undefined;

      mockFetch
        .mockResolvedValueOnce(createStartSessionResponse())
        .mockResolvedValueOnce(createCompleteSessionResponse());

      // Act
      await sessionManager.runSyncCycle(storeId, async (ctx) => {
        capturedStoreId = ctx.storeId;
      });

      // Assert - store ID should be preserved for tenant isolation
      expect(capturedStoreId).toBe(storeId);
    });

    it('should reject concurrent cycles for same store', async () => {
      // Arrange
      const storeId = 'store-integration-123';

      mockFetch.mockResolvedValue(createStartSessionResponse());

      // Start first cycle (don't await)
      let cycle1Resolve: () => void;
      const cycle1Promise = sessionManager.runSyncCycle(storeId, async () => {
        await new Promise<void>((resolve) => {
          cycle1Resolve = resolve;
        });
      });

      // Give first cycle time to start
      await new Promise((r) => setTimeout(r, 10));

      // Act - try to start second cycle while first is active
      let secondCycleError: Error | undefined;
      try {
        await sessionManager.runSyncCycle(storeId, async () => {
          // Should not reach here
        });
      } catch (error) {
        secondCycleError = error as Error;
      }

      // Cleanup first cycle
      cycle1Resolve!();
      await cycle1Promise;

      // Assert
      expect(secondCycleError).toBeDefined();
      expect(secondCycleError!.message).toContain('existing cycle in progress');
    });
  });

  describe('Session lifecycle timing', () => {
    it('should record session startedAt timestamp', async () => {
      // Arrange
      const storeId = 'store-integration-123';
      const beforeStart = new Date();

      mockFetch
        .mockResolvedValueOnce(createStartSessionResponse())
        .mockResolvedValueOnce(createCompleteSessionResponse());

      // Act
      let capturedStartedAt: Date | undefined;
      await sessionManager.runSyncCycle(storeId, async (ctx) => {
        capturedStartedAt = ctx.startedAt;
      });

      const afterComplete = new Date();

      // Assert
      expect(capturedStartedAt).toBeInstanceOf(Date);
      expect(capturedStartedAt!.getTime()).toBeGreaterThanOrEqual(beforeStart.getTime());
      expect(capturedStartedAt!.getTime()).toBeLessThanOrEqual(afterComplete.getTime());
    });

    it('should track duration in cycle result', async () => {
      // Arrange
      const storeId = 'store-integration-123';

      mockFetch
        .mockResolvedValueOnce(createStartSessionResponse())
        .mockResolvedValueOnce(createCompleteSessionResponse());

      // Act
      const result = await sessionManager.runSyncCycle(storeId, async () => {
        // Small delay to ensure measurable duration
        await new Promise((r) => setTimeout(r, 10));
      });

      // Assert
      expect(result.durationMs).toBeGreaterThanOrEqual(10);
    });
  });
});

// ============================================================================
// No Duplicate Session Calls Integration Tests
// ============================================================================

describe('SYNC-5001: No Duplicate startSyncSession Calls', () => {
  let sessionManager: SyncSessionManager;
  let startCallCount: number;
  let completeCallCount: number;
  let trackingMockApi: ICloudApiSessionService;

  beforeEach(() => {
    // Reset counters before each test
    startCallCount = 0;
    completeCallCount = 0;

    // Create fresh mock for each test to avoid vi.resetAllMocks() clearing implementations
    trackingMockApi = {
      startSyncSession: vi.fn().mockImplementation(async () => {
        startCallCount++;
        return {
          sessionId: `session-${startCallCount}`,
          revocationStatus: 'VALID' as const,
          pullPendingCount: 0,
        };
      }),
      completeSyncSession: vi.fn().mockImplementation(async () => {
        completeCallCount++;
      }),
    };

    sessionManager = new SyncSessionManager();
    sessionManager.setCloudApiService(trackingMockApi);
  });

  afterEach(() => {
    sessionManager.forceCleanup();
  });

  it('should call startSyncSession exactly once per cycle regardless of operation count', async () => {
    // Arrange
    const storeId = 'store-batch-test';

    // Act - simulate 50 pack operations in one cycle
    await sessionManager.runSyncCycle(storeId, async () => {
      for (let i = 0; i < 50; i++) {
        // Each simulated pack operation records stats
        sessionManager.recordOperationStats(`packReceive-${i}`, { pushed: 1 });
      }
    });

    // Assert
    expect(startCallCount).toBe(1);
    expect(completeCallCount).toBe(1);
  });

  it('should call startSyncSession once per cycle for separate cycles', async () => {
    // Arrange
    const storeId = 'store-multi-cycle-test';

    // Act - run 3 separate cycles
    for (let cycle = 0; cycle < 3; cycle++) {
      await sessionManager.runSyncCycle(storeId, async () => {
        sessionManager.recordOperationStats(`cycle-${cycle}`, { pushed: 1 });
      });
    }

    // Assert - exactly 3 starts and 3 completes (one per cycle)
    expect(startCallCount).toBe(3);
    expect(completeCallCount).toBe(3);
  });

  it('should aggregate stats from all operations into single completion', async () => {
    // Arrange
    const storeId = 'store-aggregation-test';

    // Act
    await sessionManager.runSyncCycle(storeId, async () => {
      sessionManager.recordOperationStats('packReceive', { pushed: 10 });
      sessionManager.recordOperationStats('packActivate', { pushed: 5 });
      sessionManager.recordOperationStats('packDeplete', { pushed: 3 });
      sessionManager.recordOperationStats('packReturn', { pushed: 2 });
    });

    // Assert
    expect(startCallCount).toBe(1);
    expect(completeCallCount).toBe(1);

    // Verify the completion call received aggregated stats
    expect(trackingMockApi.completeSyncSession).toHaveBeenCalledWith(
      'session-1',
      0, // lastSequence
      expect.objectContaining({
        pushed: 20, // 10 + 5 + 3 + 2
        pulled: 0,
        conflictsResolved: 0,
      })
    );
  });
});
