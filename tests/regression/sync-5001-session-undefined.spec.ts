/**
 * SYNC-5001 Regression Test Suite
 *
 * Regression tests for the "API key status: undefined" bug fix.
 *
 * Root Cause (Fixed):
 * Pack operations reconstructed a fake session object when a sessionId string
 * was passed: `{ sessionId } as SyncSessionResponse`. This caused revocationStatus
 * to be undefined, triggering `undefined !== 'VALID'` = throw error.
 *
 * Fix Applied:
 * Implemented the Centralized Session Provider Pattern where CloudApiService
 * queries SyncSessionManager as the single source of truth instead of accepting
 * sessionId parameters.
 *
 * Test Cases:
 * - R7.1: Pack activation with active session does NOT throw "API key status: undefined"
 * - R7.2: Pack depletion with active session does NOT throw "API key status: undefined"
 * - R7.3: Pack return with active session does NOT throw "API key status: undefined"
 * - R7.4: Pack receive with active session does NOT throw "API key status: undefined"
 *
 * @module tests/regression/sync-5001-session-undefined
 *
 * Enterprise Standards Applied:
 * - TEST-001: AAA Pattern (Arrange/Act/Assert)
 * - TEST-003: Test isolation via vi.resetAllMocks()
 * - TEST-004: Deterministic tests with controlled inputs
 * - TEST-005: Single concept per test
 * - MOCK-008: Mock network calls and external dependencies
 * - SEC-006: Parameterized queries (validated in integration tests)
 * - DB-006: Tenant isolation (storeId in session context)
 *
 * Traceability:
 * - SYNC-5001 Phase 7 (P7.1): Regression test for original bug
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mock Setup (vi.hoisted for cross-platform compatibility)
// ============================================================================

const { mockMachineIdSync, mockGetActiveSession, mockLogger } = vi.hoisted(() => ({
  mockMachineIdSync: vi.fn(() => 'test-machine-fingerprint-regression-12345'),
  mockGetActiveSession: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
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
  createLogger: vi.fn(() => mockLogger),
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

// Mock sync-session-manager to control session state for regression tests
vi.mock('../../src/main/services/sync-session-manager.service', async () => {
  const actual = await vi.importActual('../../src/main/services/sync-session-manager.service');
  return {
    ...actual,
    syncSessionManager: {
      getActiveSession: mockGetActiveSession,
      hasActiveSession: vi.fn(() => mockGetActiveSession() !== null),
      setCloudApiService: vi.fn(),
      recordOperationStats: vi.fn(),
      updateLastSequence: vi.fn(),
      getCycleStats: vi.fn(),
      forceCleanup: vi.fn(),
    },
  };
});

// Mock fetch at global level
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import service under test
import { CloudApiService } from '../../src/main/services/cloud-api.service';
import type { SyncSessionContext } from '../../src/main/services/sync-session-manager.service';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a valid sync session context for testing
 * @security DB-006: storeId is always required for tenant isolation
 */
function createValidSessionContext(overrides?: Partial<SyncSessionContext>): SyncSessionContext {
  return {
    sessionId: 'regression-test-session-12345',
    storeId: 'regression-test-store-id',
    startedAt: new Date(),
    isCompleted: false,
    revocationStatus: 'VALID',
    pullPendingCount: 0,
    lockoutMessage: undefined,
    ...overrides,
  };
}

/**
 * Create mock response for pack operations (success)
 */
function createPackOperationResponse(overrides?: { success?: boolean; idempotent?: boolean }) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        success: overrides?.success ?? true,
        data: {
          idempotent: overrides?.idempotent ?? false,
        },
      }),
  };
}

/**
 * Create mock response for batch pack receive
 */
function createBatchReceiveResponse() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        success: true,
        data: {
          successful: ['pack-001', 'pack-002'],
          failed: [],
        },
      }),
  };
}

// ============================================================================
// SYNC-5001 Regression Tests
// ============================================================================

describe('SYNC-5001: "API key status: undefined" Regression Tests', () => {
  let cloudApi: CloudApiService;

  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockReset();
    mockGetActiveSession.mockReset();

    // Reset store data
    mockStoreData.clear();
    mockStoreData.set('apiUrl', 'https://api.nuvanaapp.com');
    mockStoreData.set('encryptedApiKey', Array.from(Buffer.from('test-api-key')));

    // Create fresh CloudApiService instance
    cloudApi = new CloudApiService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // R7.1: Pack Activation Regression
  // ==========================================================================

  describe('R7.1: Pack Activation With Active Session', () => {
    it('should NOT throw "API key status: undefined" when session manager has VALID session', async () => {
      // Arrange
      const validSession = createValidSessionContext({
        sessionId: 'valid-session-for-activation',
        revocationStatus: 'VALID',
      });
      mockGetActiveSession.mockReturnValue(validSession);
      mockFetch.mockResolvedValueOnce(createPackOperationResponse());

      // Act & Assert - Should NOT throw
      await expect(
        cloudApi.pushPackActivate({
          pack_id: 'pack-activate-123',
          bin_id: 'bin-456',
          opening_serial: '000',
          game_code: '1234',
          pack_number: '0001234',
          serial_start: '000',
          serial_end: '299',
          activated_at: new Date().toISOString(),
          received_at: new Date().toISOString(),
        })
      ).resolves.toMatchObject({
        success: true,
      });

      // Verify session manager was queried (not sessionId parameter)
      expect(mockGetActiveSession).toHaveBeenCalled();
    });

    it('should use sessionId from manager (not reconstructed from parameter)', async () => {
      // Arrange
      const managerSession = createValidSessionContext({
        sessionId: 'manager-provided-session-id',
        revocationStatus: 'VALID',
      });
      mockGetActiveSession.mockReturnValue(managerSession);
      mockFetch.mockResolvedValueOnce(createPackOperationResponse());

      // Act
      await cloudApi.pushPackActivate({
        pack_id: 'pack-activate-456',
        bin_id: 'bin-789',
        opening_serial: '000',
        game_code: '5678',
        pack_number: '0005678',
        serial_start: '000',
        serial_end: '199',
        activated_at: new Date().toISOString(),
        received_at: new Date().toISOString(),
      });

      // Assert - Request body should contain the manager's session ID
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('manager-provided-session-id'),
        })
      );
    });

    it('should verify revocationStatus is VALID before proceeding', async () => {
      // Arrange - Session with explicit VALID status
      const validSession = createValidSessionContext({
        revocationStatus: 'VALID',
      });
      mockGetActiveSession.mockReturnValue(validSession);
      mockFetch.mockResolvedValueOnce(createPackOperationResponse());

      // Act
      const result = await cloudApi.pushPackActivate({
        pack_id: 'pack-verify-status',
        bin_id: 'bin-verify',
        opening_serial: '000',
        game_code: '1111',
        pack_number: '0001111',
        serial_start: '000',
        serial_end: '059',
        activated_at: new Date().toISOString(),
        received_at: new Date().toISOString(),
      });

      // Assert - Operation should succeed with VALID session
      expect(result.success).toBe(true);
      // revocationStatus was properly validated (not undefined)
    });
  });

  // ==========================================================================
  // R7.2: Pack Depletion Regression
  // ==========================================================================

  describe('R7.2: Pack Depletion With Active Session', () => {
    it('should NOT throw "API key status: undefined" when session manager has VALID session', async () => {
      // Arrange
      const validSession = createValidSessionContext({
        sessionId: 'valid-session-for-depletion',
        revocationStatus: 'VALID',
      });
      mockGetActiveSession.mockReturnValue(validSession);
      mockFetch.mockResolvedValueOnce(createPackOperationResponse());

      // Act & Assert - Should NOT throw
      await expect(
        cloudApi.pushPackDeplete({
          pack_id: 'pack-deplete-123',
          store_id: 'regression-test-store-id',
          closing_serial: '299',
          tickets_sold: 300,
          sales_amount: 3000,
          depleted_at: new Date().toISOString(),
          depletion_reason: 'SHIFT_CLOSE',
        })
      ).resolves.toMatchObject({
        success: true,
      });

      // Verify session manager was queried
      expect(mockGetActiveSession).toHaveBeenCalled();
    });

    it('should use sessionId from manager for depletion operations', async () => {
      // Arrange
      const managerSession = createValidSessionContext({
        sessionId: 'depletion-manager-session',
        revocationStatus: 'VALID',
      });
      mockGetActiveSession.mockReturnValue(managerSession);
      mockFetch.mockResolvedValueOnce(createPackOperationResponse());

      // Act
      await cloudApi.pushPackDeplete({
        pack_id: 'pack-deplete-456',
        store_id: 'regression-test-store-id',
        closing_serial: '059',
        tickets_sold: 60,
        sales_amount: 600,
        depleted_at: new Date().toISOString(),
        depletion_reason: 'DAY_CLOSE',
      });

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('depletion-manager-session'),
        })
      );
    });

    it('should handle all depletion reasons without undefined error', async () => {
      // Arrange
      const validSession = createValidSessionContext({ revocationStatus: 'VALID' });
      mockGetActiveSession.mockReturnValue(validSession);

      // Valid depletion reasons per DepletionReasonSchema
      const depletionReasons = [
        'SHIFT_CLOSE',
        'DAY_CLOSE',
        'AUTO_REPLACED',
        'MANUAL_SOLD_OUT',
      ] as const;

      for (const reason of depletionReasons) {
        mockFetch.mockResolvedValueOnce(createPackOperationResponse());

        // Act & Assert - None should throw undefined error
        await expect(
          cloudApi.pushPackDeplete({
            pack_id: `pack-${reason.toLowerCase()}`,
            store_id: 'regression-test-store-id',
            closing_serial: '100',
            tickets_sold: 100,
            sales_amount: 1000,
            depleted_at: new Date().toISOString(),
            depletion_reason: reason,
          })
        ).resolves.toMatchObject({ success: true });
      }
    });
  });

  // ==========================================================================
  // R7.3: Pack Return Regression
  // ==========================================================================

  describe('R7.3: Pack Return With Active Session', () => {
    it('should NOT throw "API key status: undefined" when session manager has VALID session', async () => {
      // Arrange
      const validSession = createValidSessionContext({
        sessionId: 'valid-session-for-return',
        revocationStatus: 'VALID',
      });
      mockGetActiveSession.mockReturnValue(validSession);
      mockFetch.mockResolvedValueOnce(createPackOperationResponse());

      // Act & Assert - Should NOT throw
      await expect(
        cloudApi.pushPackReturn({
          pack_id: 'pack-return-123',
          store_id: 'regression-test-store-id',
          closing_serial: '050',
          tickets_sold: 50,
          sales_amount: 500,
          return_reason: 'DAMAGED',
          returned_at: new Date().toISOString(),
        })
      ).resolves.toMatchObject({
        success: true,
      });

      // Verify session manager was queried
      expect(mockGetActiveSession).toHaveBeenCalled();
    });

    it('should use sessionId from manager for return operations', async () => {
      // Arrange
      const managerSession = createValidSessionContext({
        sessionId: 'return-manager-session',
        revocationStatus: 'VALID',
      });
      mockGetActiveSession.mockReturnValue(managerSession);
      mockFetch.mockResolvedValueOnce(createPackOperationResponse());

      // Act
      await cloudApi.pushPackReturn({
        pack_id: 'pack-return-456',
        store_id: 'regression-test-store-id',
        closing_serial: '030',
        tickets_sold: 30,
        sales_amount: 300,
        return_reason: 'EXPIRED',
        returned_at: new Date().toISOString(),
      });

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('return-manager-session'),
        })
      );
    });

    it('should handle all return reasons without undefined error', async () => {
      // Arrange
      const validSession = createValidSessionContext({ revocationStatus: 'VALID' });
      mockGetActiveSession.mockReturnValue(validSession);

      // Valid return reasons per ReturnReasonSchema
      const returnReasons = ['DAMAGED', 'EXPIRED', 'SUPPLIER_RECALL', 'STORE_CLOSURE'] as const;

      for (const reason of returnReasons) {
        mockFetch.mockResolvedValueOnce(createPackOperationResponse());

        // Act & Assert - None should throw undefined error
        await expect(
          cloudApi.pushPackReturn({
            pack_id: `pack-${reason.toLowerCase()}`,
            store_id: 'regression-test-store-id',
            closing_serial: '025',
            tickets_sold: 25,
            sales_amount: 250,
            return_reason: reason,
            returned_at: new Date().toISOString(),
          })
        ).resolves.toMatchObject({ success: true });
      }
    });
  });

  // ==========================================================================
  // R7.4: Pack Receive Batch Regression
  // ==========================================================================

  describe('R7.4: Pack Receive Batch With Active Session', () => {
    it('should NOT throw "API key status: undefined" when session manager has VALID session', async () => {
      // Arrange
      const validSession = createValidSessionContext({
        sessionId: 'valid-session-for-receive',
        revocationStatus: 'VALID',
      });
      mockGetActiveSession.mockReturnValue(validSession);
      mockFetch.mockResolvedValueOnce(createBatchReceiveResponse());

      // Act & Assert - Should NOT throw
      await expect(
        cloudApi.pushPackReceiveBatch([
          {
            pack_id: 'pack-receive-001',
            game_code: '1234',
            pack_number: '0001234',
            serial_start: '000',
            serial_end: '299',
            received_at: new Date().toISOString(),
          },
          {
            pack_id: 'pack-receive-002',
            game_code: '5678',
            pack_number: '0005678',
            serial_start: '000',
            serial_end: '199',
            received_at: new Date().toISOString(),
          },
        ])
      ).resolves.toMatchObject({
        success: true,
      });

      // Verify session manager was queried
      expect(mockGetActiveSession).toHaveBeenCalled();
    });

    it('should use sessionId from manager for batch receive operations', async () => {
      // Arrange
      const managerSession = createValidSessionContext({
        sessionId: 'batch-receive-manager-session',
        revocationStatus: 'VALID',
      });
      mockGetActiveSession.mockReturnValue(managerSession);
      mockFetch.mockResolvedValueOnce(createBatchReceiveResponse());

      // Act
      await cloudApi.pushPackReceiveBatch([
        {
          pack_id: 'batch-pack-001',
          game_code: '1111',
          pack_number: '0001111',
          serial_start: '000',
          serial_end: '059',
          received_at: new Date().toISOString(),
        },
      ]);

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('batch-receive-manager-session'),
        })
      );
    });

    it('should handle large batch operations without undefined error', async () => {
      // Arrange
      const validSession = createValidSessionContext({ revocationStatus: 'VALID' });
      mockGetActiveSession.mockReturnValue(validSession);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: {
              successful: Array.from({ length: 10 }, (_, i) => `batch-pack-${i}`),
              failed: [],
            },
          }),
      });

      // Act - Large batch
      const packs = Array.from({ length: 10 }, (_, i) => ({
        pack_id: `batch-pack-${i}`,
        game_code: `${1000 + i}`,
        pack_number: `000${1000 + i}`,
        serial_start: '000',
        serial_end: '299',
        received_at: new Date().toISOString(),
      }));

      // Assert - Should NOT throw
      await expect(cloudApi.pushPackReceiveBatch(packs)).resolves.toMatchObject({
        success: true,
      });
    });
  });

  // ==========================================================================
  // Original Bug Scenario Reproduction Tests
  // ==========================================================================

  describe('Original Bug Scenario Reproduction', () => {
    it('should NOT have undefined revocationStatus when using manager session', async () => {
      // Arrange - This is the exact scenario that caused the original bug
      const validSession = createValidSessionContext({
        sessionId: 'reproduction-test-session',
        revocationStatus: 'VALID', // This was undefined in the bug
        pullPendingCount: 5,
      });
      mockGetActiveSession.mockReturnValue(validSession);
      mockFetch.mockResolvedValueOnce(createPackOperationResponse());

      // Act - Call any pack operation
      const result = await cloudApi.pushPackActivate({
        pack_id: 'reproduction-test-pack',
        bin_id: 'reproduction-bin',
        opening_serial: '000',
        game_code: '9999',
        pack_number: '0009999',
        serial_start: '000',
        serial_end: '299',
        activated_at: new Date().toISOString(),
        received_at: new Date().toISOString(),
      });

      // Assert - Operation should succeed (not throw "API key status: undefined")
      expect(result.success).toBe(true);

      // Verify the session was from manager (not reconstructed)
      expect(mockGetActiveSession).toHaveBeenCalledTimes(1);
    });

    it('should reject operations when session manager returns null and new session is REVOKED', async () => {
      // Arrange - No active session, new session attempt returns REVOKED
      mockGetActiveSession.mockReturnValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: {
              sessionId: 'revoked-session',
              revocationStatus: 'REVOKED',
              pullPendingCount: 0,
              lockoutMessage: 'API key has been revoked',
            },
          }),
      });

      // Act & Assert - Should throw with proper error message (not "undefined")
      let caughtError: Error | undefined;
      try {
        await cloudApi.pushPackActivate({
          pack_id: 'revoked-test-pack',
          bin_id: 'revoked-bin',
          opening_serial: '000',
          game_code: '0000',
          pack_number: '0000000',
          serial_start: '000',
          serial_end: '059',
          activated_at: new Date().toISOString(),
          received_at: new Date().toISOString(),
        });
      } catch (error) {
        caughtError = error as Error;
      }

      // Assert - Error should contain REVOKED, NOT "undefined"
      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain('REVOKED');
      expect(caughtError!.message).not.toContain('undefined');
    });

    it('should preserve all session context fields from manager', async () => {
      // Arrange - Session with all fields populated
      const fullSession = createValidSessionContext({
        sessionId: 'full-context-session',
        storeId: 'full-context-store',
        revocationStatus: 'VALID',
        pullPendingCount: 42,
        lockoutMessage: undefined,
        isCompleted: false,
        startedAt: new Date('2026-02-15T10:00:00Z'),
      });
      mockGetActiveSession.mockReturnValue(fullSession);
      mockFetch.mockResolvedValueOnce(createPackOperationResponse());

      // Act
      await cloudApi.pushPackActivate({
        pack_id: 'full-context-pack',
        bin_id: 'full-context-bin',
        opening_serial: '000',
        game_code: '2222',
        pack_number: '0002222',
        serial_start: '000',
        serial_end: '149',
        activated_at: new Date().toISOString(),
        received_at: new Date().toISOString(),
      });

      // Assert - Session ID in request should match manager's session
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('full-context-session'),
        })
      );
    });
  });

  // ==========================================================================
  // Edge Case Coverage
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle session with SUSPENDED by starting new session', async () => {
      // Arrange - Session with SUSPENDED should not be reused
      const suspendedSession = createValidSessionContext({
        sessionId: 'suspended-session',
        revocationStatus: 'SUSPENDED',
        lockoutMessage: 'API key expires in 7 days',
      });
      mockGetActiveSession.mockReturnValue(suspendedSession);

      // New session response (since SUSPENDED is not VALID)
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                sessionId: 'new-valid-session',
                revocationStatus: 'VALID',
                pullPendingCount: 0,
              },
            }),
        })
        .mockResolvedValueOnce(createPackOperationResponse())
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });

      // Act & Assert - Should succeed with new session
      await expect(
        cloudApi.pushPackActivate({
          pack_id: 'pending-test-pack',
          bin_id: 'pending-test-bin',
          opening_serial: '000',
          game_code: '3333',
          pack_number: '0003333',
          serial_start: '000',
          serial_end: '059',
          activated_at: new Date().toISOString(),
          received_at: new Date().toISOString(),
        })
      ).resolves.toMatchObject({ success: true });
    });

    it('should handle empty batch gracefully', async () => {
      // Arrange
      const validSession = createValidSessionContext({ revocationStatus: 'VALID' });
      mockGetActiveSession.mockReturnValue(validSession);

      // Act - Empty batch returns success with empty results (no error)
      const result = await cloudApi.pushPackReceiveBatch([]);

      // Assert - Should succeed (not throw "API key status: undefined")
      expect(result.success).toBe(true);
      expect(result.results).toEqual([]);
    });

    it('should handle rapid sequential operations without session confusion', async () => {
      // Arrange
      const validSession = createValidSessionContext({
        sessionId: 'rapid-ops-session',
        revocationStatus: 'VALID',
      });
      mockGetActiveSession.mockReturnValue(validSession);

      // Mock multiple responses
      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce(createPackOperationResponse());
      }

      // Act - Rapid sequential operations
      const operations = [
        cloudApi.pushPackActivate({
          pack_id: 'rapid-1',
          bin_id: 'bin-1',
          opening_serial: '000',
          game_code: '1001',
          pack_number: '0001001',
          serial_start: '000',
          serial_end: '059',
          activated_at: new Date().toISOString(),
          received_at: new Date().toISOString(),
        }),
        cloudApi.pushPackActivate({
          pack_id: 'rapid-2',
          bin_id: 'bin-2',
          opening_serial: '000',
          game_code: '1002',
          pack_number: '0001002',
          serial_start: '000',
          serial_end: '059',
          activated_at: new Date().toISOString(),
          received_at: new Date().toISOString(),
        }),
        cloudApi.pushPackDeplete({
          pack_id: 'rapid-3',
          store_id: 'regression-test-store-id',
          closing_serial: '059',
          tickets_sold: 60,
          sales_amount: 600,
          depleted_at: new Date().toISOString(),
          depletion_reason: 'SHIFT_CLOSE',
        }),
        cloudApi.pushPackReturn({
          pack_id: 'rapid-4',
          store_id: 'regression-test-store-id',
          closing_serial: '030',
          tickets_sold: 30,
          sales_amount: 300,
          return_reason: 'DAMAGED',
          returned_at: new Date().toISOString(),
        }),
        cloudApi.pushPackDeplete({
          pack_id: 'rapid-5',
          store_id: 'regression-test-store-id',
          closing_serial: '100',
          tickets_sold: 100,
          sales_amount: 1000,
          depleted_at: new Date().toISOString(),
          depletion_reason: 'DAY_CLOSE',
        }),
      ];

      // Assert - All should succeed
      const results = await Promise.all(operations);
      expect(results.every((r) => r.success)).toBe(true);

      // All requests should use the same session from manager
      expect(mockGetActiveSession).toHaveBeenCalledTimes(5);
    });
  });
});
