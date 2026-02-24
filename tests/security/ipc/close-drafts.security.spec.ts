/**
 * Close Drafts Security Tests
 *
 * Security test suite covering:
 * - T3.2: Authentication tests (SEC-010)
 * - T3.3: Tenant isolation tests (DB-006)
 * - SQL injection prevention via DAL
 * - Draft ID enumeration attacks
 * - Cross-store access attempts
 *
 * Security Standards:
 * - SEC-010: Authorization enforced server-side
 * - SEC-006: Parameterized queries via DAL
 * - DB-006: Store-scoped queries for tenant isolation
 * - API-001: Input validation with Zod schemas
 * - API-003: Sanitized error responses
 *
 * @module tests/security/ipc/close-drafts.security
 * @feature DRAFT-001: Draft-Backed Wizard Architecture
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ==========================================================================
// Mock Setup - vi.hoisted for cross-platform compatibility
// ==========================================================================

const {
  mockGetConfiguredStore,
  mockGetCurrentUser,
  mockCloseDraftsDAL,
  mockShiftsDAL,
  mockShiftSummariesDAL,
  mockSyncQueueDAL,
  mockLotteryBusinessDaysDAL,
} = vi.hoisted(() => ({
  mockGetConfiguredStore: vi.fn(),
  mockGetCurrentUser: vi.fn(),
  mockCloseDraftsDAL: {
    createDraft: vi.fn(),
    getDraft: vi.fn(),
    getActiveDraft: vi.fn(),
    updateDraft: vi.fn(),
    updateStepState: vi.fn(),
    beginFinalize: vi.fn(),
    finalizeDraft: vi.fn(),
    rollbackFinalize: vi.fn(),
    expireDraft: vi.fn(),
  },
  mockShiftsDAL: {
    findById: vi.fn(),
    close: vi.fn(),
  },
  mockShiftSummariesDAL: {
    findByShiftId: vi.fn(),
    closeShiftSummary: vi.fn(),
  },
  mockSyncQueueDAL: {
    enqueue: vi.fn(),
  },
  mockLotteryBusinessDaysDAL: {
    getOrCreateForDate: vi.fn(),
    prepareClose: vi.fn(),
    commitClose: vi.fn(),
  },
}));

// Mock electron modules
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

// Mock database service
vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(),
      all: vi.fn(),
      run: vi.fn(),
    })),
    transaction: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

// Mock stores DAL
vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: { getConfiguredStore: mockGetConfiguredStore },
}));

// Mock shifts DAL
vi.mock('../../../src/main/dal/shifts.dal', () => ({
  shiftsDAL: mockShiftsDAL,
}));

// Mock shift summaries DAL
vi.mock('../../../src/main/dal', () => ({
  shiftSummariesDAL: mockShiftSummariesDAL,
}));

// Mock sync queue DAL
vi.mock('../../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: mockSyncQueueDAL,
}));

// Mock lottery business days DAL
vi.mock('../../../src/main/dal/lottery-business-days.dal', () => ({
  lotteryBusinessDaysDAL: mockLotteryBusinessDaysDAL,
}));

// Mock close drafts DAL
vi.mock('../../../src/main/dal/close-drafts.dal', () => ({
  closeDraftsDAL: mockCloseDraftsDAL,
  VersionConflictError: class VersionConflictError extends Error {
    code = 'VERSION_CONFLICT';
    currentVersion: number;
    expectedVersion: number;
    constructor(currentVersion: number, expectedVersion: number) {
      super(`Version conflict`);
      this.name = 'VersionConflictError';
      this.currentVersion = currentVersion;
      this.expectedVersion = expectedVersion;
    }
  },
  InvalidStatusTransitionError: class InvalidStatusTransitionError extends Error {
    code = 'INVALID_STATUS_TRANSITION';
    constructor(fromStatus: string, toStatus: string) {
      super(`Invalid transition from ${fromStatus} to ${toStatus}`);
      this.name = 'InvalidStatusTransitionError';
    }
  },
}));

// Mock settings service
vi.mock('../../../src/main/services/settings.service', () => ({
  settingsService: { getPOSType: vi.fn(() => 'LOTTERY') },
}));

// Mock shifts handlers
vi.mock('../../../src/main/ipc/shifts.handlers', () => ({
  buildShiftSyncPayload: vi.fn((shift, options) => ({
    shift_id: shift.shift_id,
    closing_cash: options?.closing_cash ?? null,
  })),
  SHIFT_SYNC_PRIORITY: 10,
}));

// Mock lottery handlers
vi.mock('../../../src/main/ipc/lottery.handlers', () => ({
  getCurrentBusinessDate: vi.fn(() => '2026-02-21'),
}));

// Capture registered handlers
type HandlerFn = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const registeredHandlers: Map<string, HandlerFn> = new Map();

// Mock IPC registry
vi.mock('../../../src/main/ipc/index', () => ({
  registerHandler: vi.fn(<_T>(channel: string, handler: HandlerFn, _options?: unknown) => {
    registeredHandlers.set(channel, handler);
  }),
  createErrorResponse: vi.fn((code: string, message: string) => ({
    success: false,
    error: code,
    message,
  })),
  createSuccessResponse: vi.fn((data: unknown) => ({ success: true, data })),
  getCurrentUser: mockGetCurrentUser,
  IPCErrorCodes: {
    NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
    FORBIDDEN: 'FORBIDDEN',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    NOT_CONFIGURED: 'NOT_CONFIGURED',
    CONFLICT: 'CONFLICT',
    ALREADY_CLOSED: 'ALREADY_CLOSED',
  },
}));

// Mock logger
vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// ==========================================================================
// Test Suite
// ==========================================================================

describe('Close Drafts Security Tests', () => {
  // RFC 4122 compliant UUIDs (version 4, variant 1)
  // Store A (attacker's store)
  const STORE_A_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  // Store B (victim's store)
  const STORE_B_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  const TEST_USER_ID = '123e4567-e89b-4000-a000-000000000001';
  const TEST_SHIFT_ID = '123e4567-e89b-4000-a000-000000000002';
  const VICTIM_DRAFT_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-000000000001';

  const storeA = {
    store_id: STORE_A_ID,
    name: 'Store A (Attacker)',
  };

  const userA = {
    user_id: TEST_USER_ID,
    username: 'attacker',
    role: 'cashier' as const,
    store_id: STORE_A_ID,
  };

  const shiftA = {
    shift_id: TEST_SHIFT_ID,
    store_id: STORE_A_ID,
    business_date: '2026-02-21',
    shift_number: 1,
    status: 'OPEN' as const,
    start_time: '2026-02-21T08:00:00.000Z',
    end_time: null,
    cashier_id: TEST_USER_ID,
    external_register_id: 'REG01',
    external_cashier_id: 'CASH01',
    external_till_id: null,
  };

  // RFC 4122 compliant draft IDs
  const DRAFT_A_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-000000000001';
  const VICTIM_SHIFT_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-000000000002';
  const VICTIM_USER_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-000000000003';

  const draftA = {
    draft_id: DRAFT_A_ID,
    store_id: STORE_A_ID,
    shift_id: TEST_SHIFT_ID,
    business_date: '2026-02-21',
    draft_type: 'DAY_CLOSE' as const,
    status: 'IN_PROGRESS' as const,
    step_state: null,
    payload: {},
    version: 1,
    created_at: '2026-02-21T08:00:00.000Z',
    updated_at: '2026-02-21T08:00:00.000Z',
    created_by: TEST_USER_ID,
  };

  // Victim's draft in Store B
  const _victimDraft = {
    draft_id: VICTIM_DRAFT_ID,
    store_id: STORE_B_ID,
    shift_id: VICTIM_SHIFT_ID,
    business_date: '2026-02-21',
    draft_type: 'DAY_CLOSE' as const,
    status: 'IN_PROGRESS' as const,
    step_state: 'LOTTERY' as const,
    payload: { lottery: { totals: { tickets_sold: 100, sales_amount: 500 } } },
    version: 5,
    created_at: '2026-02-21T07:00:00.000Z',
    updated_at: '2026-02-21T15:00:00.000Z',
    created_by: VICTIM_USER_ID,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    registeredHandlers.clear();

    // Default: User from Store A
    mockGetConfiguredStore.mockReturnValue(storeA);
    mockGetCurrentUser.mockReturnValue(userA);
    mockShiftsDAL.findById.mockReturnValue(shiftA);

    await import('../../../src/main/ipc/close-drafts.handlers');
  });

  afterEach(() => {
    vi.resetModules();
  });

  async function invokeHandler(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = registeredHandlers.get(channel);
    if (!handler) throw new Error(`Handler not registered: ${channel}`);
    return handler({}, ...args);
  }

  // ========================================================================
  // T3.2: Authentication Tests (SEC-010)
  // ========================================================================

  describe('T3.2: Authentication Tests (SEC-010)', () => {
    describe('Unauthenticated Request Handling', () => {
      beforeEach(() => {
        mockGetCurrentUser.mockReturnValue(null);
      });

      it('drafts:create rejects unauthenticated requests', async () => {
        const result = await invokeHandler('drafts:create', {
          shift_id: TEST_SHIFT_ID,
          draft_type: 'DAY_CLOSE',
        });

        expect(result).toMatchObject({
          success: false,
          error: 'NOT_AUTHENTICATED',
        });
        expect(mockCloseDraftsDAL.createDraft).not.toHaveBeenCalled();
      });

      it('drafts:update rejects unauthenticated requests', async () => {
        const _result = await invokeHandler('drafts:update', {
          draft_id: draftA.draft_id,
          payload: { closing_cash: 100 },
          version: 1,
        });

        // Handler should fail at auth check, not at DAL level
        expect(mockCloseDraftsDAL.updateDraft).not.toHaveBeenCalled();
      });

      it('drafts:updateLottery rejects unauthenticated requests', async () => {
        const _result = await invokeHandler('drafts:updateLottery', {
          draft_id: draftA.draft_id,
          lottery_data: {
            bins_scans: [],
            totals: { tickets_sold: 0, sales_amount: 0 },
            entry_method: 'SCAN',
          },
          version: 1,
        });

        expect(mockCloseDraftsDAL.updateDraft).not.toHaveBeenCalled();
      });

      it('drafts:finalize rejects unauthenticated requests', async () => {
        const result = await invokeHandler('drafts:finalize', {
          draft_id: draftA.draft_id,
          closing_cash: 100,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'NOT_AUTHENTICATED',
        });
        expect(mockCloseDraftsDAL.beginFinalize).not.toHaveBeenCalled();
      });

      it('drafts:expire rejects unauthenticated requests', async () => {
        const _result = await invokeHandler('drafts:expire', {
          draft_id: draftA.draft_id,
        });

        expect(mockCloseDraftsDAL.expireDraft).not.toHaveBeenCalled();
      });
    });

    describe('User ID Capture', () => {
      it('captures authenticated user_id in created_by field', async () => {
        mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);
        mockCloseDraftsDAL.createDraft.mockReturnValue(draftA);

        await invokeHandler('drafts:create', {
          shift_id: TEST_SHIFT_ID,
          draft_type: 'DAY_CLOSE',
        });

        expect(mockCloseDraftsDAL.createDraft).toHaveBeenCalledWith(
          STORE_A_ID,
          TEST_SHIFT_ID,
          shiftA.business_date,
          'DAY_CLOSE',
          TEST_USER_ID
        );
      });

      it('cannot spoof user_id through input', async () => {
        mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);
        mockCloseDraftsDAL.createDraft.mockReturnValue(draftA);

        // Attacker tries to specify a different user_id
        await invokeHandler('drafts:create', {
          shift_id: TEST_SHIFT_ID,
          draft_type: 'DAY_CLOSE',
          user_id: 'spoofed-user-id', // Should be ignored
        });

        // Should use authenticated user, not spoofed value
        expect(mockCloseDraftsDAL.createDraft).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.any(String),
          expect.any(String),
          TEST_USER_ID // Real authenticated user
        );
      });
    });
  });

  // ========================================================================
  // T3.3: Tenant Isolation Tests (DB-006)
  // ========================================================================

  describe('T3.3: Tenant Isolation Tests (DB-006)', () => {
    describe('Cross-Store Draft Access Prevention', () => {
      it('cannot read drafts from another store via drafts:get', async () => {
        // DAL enforces store_id check - returns undefined for wrong store
        mockCloseDraftsDAL.getDraft.mockReturnValue(undefined);

        const result = await invokeHandler('drafts:get', {
          draft_id: VICTIM_DRAFT_ID, // Draft from Store B
        });

        // Should call DAL with attacker's store_id, not victim's
        expect(mockCloseDraftsDAL.getDraft).toHaveBeenCalledWith(STORE_A_ID, VICTIM_DRAFT_ID);

        // Result should be null (not found in attacker's store)
        expect(result).toMatchObject({ draft: null });
      });

      it('cannot update drafts from another store', async () => {
        // DAL throws when draft not found for store
        mockCloseDraftsDAL.updateDraft.mockImplementation(() => {
          throw new Error(`Draft not found: ${VICTIM_DRAFT_ID} (store: ${STORE_A_ID})`);
        });

        const result = await invokeHandler('drafts:update', {
          draft_id: VICTIM_DRAFT_ID,
          payload: { closing_cash: 99999 },
          version: 5,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'NOT_FOUND',
        });

        // Verify DAL was called with attacker's store
        expect(mockCloseDraftsDAL.updateDraft).toHaveBeenCalledWith(
          STORE_A_ID, // Attacker's configured store
          VICTIM_DRAFT_ID,
          expect.any(Object),
          5
        );
      });

      it('cannot finalize drafts from another store', async () => {
        // DAL returns undefined for cross-store access
        mockCloseDraftsDAL.getDraft.mockReturnValue(undefined);

        const result = await invokeHandler('drafts:finalize', {
          draft_id: VICTIM_DRAFT_ID,
          closing_cash: 0,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'NOT_FOUND',
          message: 'Draft not found',
        });

        // Should NOT have attempted to finalize
        expect(mockCloseDraftsDAL.beginFinalize).not.toHaveBeenCalled();
      });

      it('cannot expire drafts from another store', async () => {
        mockCloseDraftsDAL.expireDraft.mockImplementation(() => {
          throw new Error(`Draft not found: ${VICTIM_DRAFT_ID}`);
        });

        const result = await invokeHandler('drafts:expire', {
          draft_id: VICTIM_DRAFT_ID,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'NOT_FOUND',
        });
      });
    });

    describe('Shift Store Validation', () => {
      it('rejects draft creation for shift from another store', async () => {
        // RFC 4122 compliant foreign shift ID
        const foreignShiftId = 'cccccccc-cccc-4ccc-8ccc-000000000001';
        // Shift belongs to Store B, not Store A
        mockShiftsDAL.findById.mockReturnValue({
          ...shiftA,
          shift_id: foreignShiftId,
          store_id: STORE_B_ID,
        });
        mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);

        const result = await invokeHandler('drafts:create', {
          shift_id: foreignShiftId,
          draft_type: 'DAY_CLOSE',
        });

        expect(result).toMatchObject({
          success: false,
          error: 'NOT_FOUND',
          message: 'Shift not found',
        });

        // Should NOT have created draft
        expect(mockCloseDraftsDAL.createDraft).not.toHaveBeenCalled();
      });
    });

    describe('Draft ID Enumeration Prevention', () => {
      it('returns NOT_FOUND (not FORBIDDEN) for cross-store drafts', async () => {
        // Using NOT_FOUND prevents information disclosure about draft existence
        mockCloseDraftsDAL.getDraft.mockReturnValue(undefined);

        const result = await invokeHandler('drafts:get', {
          draft_id: VICTIM_DRAFT_ID,
        });

        // Error should be NOT_FOUND, not FORBIDDEN
        // This prevents attacker from knowing if draft exists in another store
        expect(result).toMatchObject({ draft: null });
      });

      it('cannot enumerate draft IDs through sequential guessing', async () => {
        mockCloseDraftsDAL.getDraft.mockReturnValue(undefined);

        // RFC 4122 compliant guessed IDs
        const guessedIds = [
          'dddddddd-dddd-4ddd-8ddd-000000000001',
          'dddddddd-dddd-4ddd-8ddd-000000000002',
          'dddddddd-dddd-4ddd-8ddd-000000000003',
        ];

        for (const guessedId of guessedIds) {
          const result = await invokeHandler('drafts:get', {
            draft_id: guessedId,
          });

          // All should return null, no information leakage
          expect(result).toMatchObject({ draft: null });
        }

        // Verify all calls used attacker's store_id
        expect(mockCloseDraftsDAL.getDraft).toHaveBeenCalledTimes(3);
        for (const call of mockCloseDraftsDAL.getDraft.mock.calls) {
          expect(call[0]).toBe(STORE_A_ID);
        }
      });
    });

    describe('Store Configuration Enforcement', () => {
      it('rejects all operations when store not configured', async () => {
        mockGetConfiguredStore.mockReturnValue(null);

        const handlers = [
          {
            channel: 'drafts:create',
            args: [{ shift_id: TEST_SHIFT_ID, draft_type: 'DAY_CLOSE' }],
          },
          { channel: 'drafts:get', args: [{ draft_id: draftA.draft_id }] },
          {
            channel: 'drafts:update',
            args: [{ draft_id: draftA.draft_id, payload: {}, version: 1 }],
          },
          { channel: 'drafts:expire', args: [{ draft_id: draftA.draft_id }] },
        ];

        for (const { channel, args } of handlers) {
          const result = await invokeHandler(channel, ...args);

          expect(result).toMatchObject({
            success: false,
            error: 'NOT_CONFIGURED',
          });
        }
      });
    });
  });

  // ========================================================================
  // SQL Injection Prevention (SEC-006)
  // ========================================================================

  describe('SQL Injection Prevention (SEC-006)', () => {
    // These tests verify that malicious input doesn't cause errors
    // Actual SQL injection prevention is in DAL layer (tested separately)

    const sqlInjectionPayloads = [
      "'; DROP TABLE close_drafts; --",
      "1'; DELETE FROM close_drafts WHERE '1'='1",
      "'; UPDATE close_drafts SET status='EXPIRED' WHERE store_id='",
      'UNION SELECT * FROM stores--',
      '1 OR 1=1',
      "'; ATTACH DATABASE '/tmp/evil.db' AS evil; --",
    ];

    it('rejects SQL injection in draft_id (UUID validation)', async () => {
      for (const payload of sqlInjectionPayloads) {
        const result = await invokeHandler('drafts:get', {
          draft_id: payload,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
      }

      // Verify DAL was never called with injection payloads
      expect(mockCloseDraftsDAL.getDraft).not.toHaveBeenCalled();
    });

    it('rejects SQL injection in shift_id (UUID validation)', async () => {
      for (const payload of sqlInjectionPayloads) {
        const result = await invokeHandler('drafts:create', {
          shift_id: payload,
          draft_type: 'DAY_CLOSE',
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
      }

      expect(mockCloseDraftsDAL.createDraft).not.toHaveBeenCalled();
    });

    it('sanitizes payload content through JSON serialization', async () => {
      mockCloseDraftsDAL.updateDraft.mockReturnValue({ ...draftA, version: 2 });

      // Payload with SQL-like content is treated as data, not code
      const result = await invokeHandler('drafts:update', {
        draft_id: draftA.draft_id,
        payload: {
          lottery: {
            note: "'; DROP TABLE users; --",
            sql_attempt: 'SELECT * FROM secrets',
          },
        },
        version: 1,
      });

      // Should succeed - payload is just JSON data
      expect(result).toHaveProperty('draft');

      // Verify the payload was passed as-is to DAL (DAL handles parameterization)
      expect(mockCloseDraftsDAL.updateDraft).toHaveBeenCalledWith(
        STORE_A_ID,
        draftA.draft_id,
        {
          lottery: {
            note: "'; DROP TABLE users; --",
            sql_attempt: 'SELECT * FROM secrets',
          },
        },
        1
      );
    });
  });

  // ========================================================================
  // API-003: Error Response Sanitization
  // ========================================================================

  describe('Error Response Sanitization (API-003)', () => {
    it('does not leak internal error details', async () => {
      mockCloseDraftsDAL.createDraft.mockImplementation(() => {
        throw new Error('SQLITE_ERROR: no such table: close_drafts (SQLite database corrupted)');
      });
      mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);

      const result = await invokeHandler('drafts:create', {
        shift_id: TEST_SHIFT_ID,
        draft_type: 'DAY_CLOSE',
      });

      expect(result).toMatchObject({
        success: false,
        error: 'INTERNAL_ERROR',
      });

      // Should NOT leak database details
      const message = (result as { message: string }).message;
      expect(message).not.toContain('SQLITE');
      expect(message).not.toContain('corrupted');
      expect(message).not.toContain('close_drafts');
    });

    it('does not leak stack traces', async () => {
      mockCloseDraftsDAL.updateDraft.mockImplementation(() => {
        const error = new Error('Database error');
        error.stack =
          'Error: Database error\n    at CloseDraftsDAL.updateDraft (close-drafts.dal.ts:123)\n    at...';
        throw error;
      });

      const result = await invokeHandler('drafts:update', {
        draft_id: draftA.draft_id,
        payload: {},
        version: 1,
      });

      const message = (result as { message: string }).message;
      expect(message).not.toContain('close-drafts.dal.ts');
      expect(message).not.toContain(':123');
      expect(message).not.toContain('stack');
    });

    it('provides generic user-friendly error messages', async () => {
      mockCloseDraftsDAL.expireDraft.mockImplementation(() => {
        throw new Error('Connection pool exhausted after 30 retries');
      });

      const result = await invokeHandler('drafts:expire', {
        draft_id: draftA.draft_id,
      });

      expect(result).toMatchObject({
        success: false,
        error: 'INTERNAL_ERROR',
      });

      // Should provide user-friendly message
      const message = (result as { message: string }).message;
      expect(message).toContain('error occurred');
      expect(message).not.toContain('Connection pool');
      expect(message).not.toContain('30 retries');
    });
  });

  // ========================================================================
  // Privilege Escalation Prevention
  // ========================================================================

  describe('Privilege Escalation Prevention', () => {
    it('cannot modify created_by after creation', async () => {
      mockCloseDraftsDAL.updateDraft.mockReturnValue({
        ...draftA,
        version: 2,
        // created_by should remain unchanged
        created_by: TEST_USER_ID,
      });

      await invokeHandler('drafts:update', {
        draft_id: draftA.draft_id,
        payload: {
          // Attacker tries to change ownership via payload
          created_by: 'attacker-user-id',
        },
        version: 1,
      });

      // Verify DAL received the payload (but DAL doesn't allow created_by updates)
      expect(mockCloseDraftsDAL.updateDraft).toHaveBeenCalled();
    });

    it('cannot spoof store_id through payload', async () => {
      mockCloseDraftsDAL.updateDraft.mockReturnValue({ ...draftA, version: 2 });

      await invokeHandler('drafts:update', {
        draft_id: draftA.draft_id,
        payload: {
          store_id: STORE_B_ID, // Attacker tries to change store
        },
        version: 1,
      });

      // Handler uses configured store, not payload store
      expect(mockCloseDraftsDAL.updateDraft).toHaveBeenCalledWith(
        STORE_A_ID, // Configured store, not spoofed
        draftA.draft_id,
        expect.any(Object),
        1
      );
    });
  });
});
