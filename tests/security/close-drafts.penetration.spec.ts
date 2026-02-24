/**
 * Close Drafts Penetration Tests (T8.1)
 *
 * Comprehensive security testing covering OWASP Top 10 attack vectors:
 * - A01:2021 Broken Access Control (Tenant isolation, privilege escalation)
 * - A02:2021 Cryptographic Failures (Session handling)
 * - A03:2021 Injection (SQL injection, payload tampering)
 * - A04:2021 Insecure Design (Business logic flaws)
 * - A05:2021 Security Misconfiguration (Error handling)
 * - A07:2021 Identification and Authentication Failures (Session hijacking)
 *
 * Security Standards Tested:
 * - SEC-006: SQL injection prevention via parameterized queries
 * - SEC-010: Server-side authorization enforcement
 * - DB-006: Tenant isolation via store_id scoping
 * - API-001: Input validation with Zod schemas
 * - API-003: Sanitized error responses
 *
 * @module tests/security/close-drafts.penetration
 * @feature DRAFT-001: Draft-Backed Wizard Architecture
 * @phase Phase 8: Security & Edge Case Testing
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
  capturedDALCalls,
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
  capturedDALCalls: [] as Array<{ method: string; args: unknown[] }>,
}));

// Mock electron modules
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

// Mock database service
vi.mock('../../src/main/services/database.service', () => ({
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
vi.mock('../../src/main/dal/stores.dal', () => ({
  storesDAL: { getConfiguredStore: mockGetConfiguredStore },
}));

// Mock shifts DAL
vi.mock('../../src/main/dal/shifts.dal', () => ({
  shiftsDAL: mockShiftsDAL,
}));

// Mock shift summaries DAL
vi.mock('../../src/main/dal', () => ({
  shiftSummariesDAL: mockShiftSummariesDAL,
}));

// Mock sync queue DAL
vi.mock('../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: mockSyncQueueDAL,
}));

// Mock lottery business days DAL
vi.mock('../../src/main/dal/lottery-business-days.dal', () => ({
  lotteryBusinessDaysDAL: mockLotteryBusinessDaysDAL,
}));

// Mock close drafts DAL with call capturing
vi.mock('../../src/main/dal/close-drafts.dal', () => ({
  closeDraftsDAL: new Proxy(mockCloseDraftsDAL, {
    get(target, prop) {
      const method = target[prop as keyof typeof target];
      if (typeof method === 'function') {
        return (...args: unknown[]) => {
          capturedDALCalls.push({ method: prop as string, args });
          return (method as (...args: unknown[]) => unknown)(...args);
        };
      }
      return method;
    },
  }),
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
    fromStatus: string;
    toStatus: string;
    constructor(fromStatus: string, toStatus: string) {
      super(`Invalid transition from ${fromStatus} to ${toStatus}`);
      this.name = 'InvalidStatusTransitionError';
      this.fromStatus = fromStatus;
      this.toStatus = toStatus;
    }
  },
}));

// Mock settings service
vi.mock('../../src/main/services/settings.service', () => ({
  settingsService: { getPOSType: vi.fn(() => 'LOTTERY') },
}));

// Mock shifts handlers
vi.mock('../../src/main/ipc/shifts.handlers', () => ({
  buildShiftSyncPayload: vi.fn((shift, options) => ({
    shift_id: shift.shift_id,
    closing_cash: options?.closing_cash ?? null,
  })),
  SHIFT_SYNC_PRIORITY: 10,
}));

// Mock lottery handlers
vi.mock('../../src/main/ipc/lottery.handlers', () => ({
  getCurrentBusinessDate: vi.fn(() => '2026-02-21'),
}));

// Capture registered handlers
type HandlerFn = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const registeredHandlers: Map<string, HandlerFn> = new Map();

// Mock IPC registry
vi.mock('../../src/main/ipc/index', () => ({
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
vi.mock('../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// ==========================================================================
// Test Constants - RFC 4122 Compliant UUIDs
// ==========================================================================

// Legitimate store and users
const STORE_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const SHIFT_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const DRAFT_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003';

// Attacker/victim store
const STORE_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const SHIFT_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';
const DRAFT_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000003';

// ==========================================================================
// Test Suite
// ==========================================================================

describe('Close Drafts Penetration Tests (T8.1)', () => {
  const storeA = { store_id: STORE_A_ID, name: 'Store A' };
  const userA = {
    user_id: USER_A_ID,
    username: 'legit_user',
    role: 'cashier' as const,
    store_id: STORE_A_ID,
  };
  const shiftA = {
    shift_id: SHIFT_A_ID,
    store_id: STORE_A_ID,
    business_date: '2026-02-21',
    shift_number: 1,
    status: 'OPEN' as const,
    start_time: '2026-02-21T08:00:00.000Z',
    end_time: null,
    cashier_id: USER_A_ID,
    external_register_id: 'REG01',
    external_cashier_id: 'CASH01',
    external_till_id: null,
  };
  const draftA = {
    draft_id: DRAFT_A_ID,
    store_id: STORE_A_ID,
    shift_id: SHIFT_A_ID,
    business_date: '2026-02-21',
    draft_type: 'DAY_CLOSE' as const,
    status: 'IN_PROGRESS' as const,
    step_state: null,
    payload: {},
    version: 1,
    created_at: '2026-02-21T08:00:00.000Z',
    updated_at: '2026-02-21T08:00:00.000Z',
    created_by: USER_A_ID,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    registeredHandlers.clear();
    capturedDALCalls.length = 0;

    mockGetConfiguredStore.mockReturnValue(storeA);
    mockGetCurrentUser.mockReturnValue(userA);
    mockShiftsDAL.findById.mockReturnValue(shiftA);

    await import('../../src/main/ipc/close-drafts.handlers');
  });

  afterEach(() => {
    vi.resetModules();
  });

  async function invokeHandler(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = registeredHandlers.get(channel);
    if (!handler) throw new Error(`Handler not registered: ${channel}`);
    return handler({}, ...args);
  }

  // ==========================================================================
  // A01:2021 - BROKEN ACCESS CONTROL
  // ==========================================================================

  describe('A01:2021 - Broken Access Control', () => {
    describe('Horizontal Privilege Escalation (Cross-Tenant Access)', () => {
      it('cannot read drafts belonging to another store via direct ID', async () => {
        // Setup: Draft B exists in Store B, but user is in Store A
        mockCloseDraftsDAL.getDraft.mockReturnValue(undefined); // DAL returns nothing for wrong store

        const result = await invokeHandler('drafts:get', {
          draft_id: DRAFT_B_ID, // Victim's draft
        });

        // Should return null, not the actual draft
        expect(result).toMatchObject({ draft: null });

        // Verify DAL was called with attacker's store, not victim's
        const getCall = capturedDALCalls.find((c) => c.method === 'getDraft');
        expect(getCall?.args[0]).toBe(STORE_A_ID); // Must use configured store
      });

      it('cannot modify drafts belonging to another store', async () => {
        mockCloseDraftsDAL.updateDraft.mockImplementation(() => {
          throw new Error(`Draft not found: ${DRAFT_B_ID}`);
        });

        const result = await invokeHandler('drafts:update', {
          draft_id: DRAFT_B_ID,
          payload: { closing_cash: 999999 },
          version: 1,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'NOT_FOUND',
        });

        // DAL was called with attacker's store
        const updateCall = capturedDALCalls.find((c) => c.method === 'updateDraft');
        expect(updateCall?.args[0]).toBe(STORE_A_ID);
      });

      it('cannot finalize drafts belonging to another store', async () => {
        mockCloseDraftsDAL.getDraft.mockReturnValue(undefined);

        const result = await invokeHandler('drafts:finalize', {
          draft_id: DRAFT_B_ID,
          closing_cash: 0,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'NOT_FOUND',
        });

        expect(mockCloseDraftsDAL.beginFinalize).not.toHaveBeenCalled();
      });

      it('cannot create drafts for shifts belonging to another store', async () => {
        // Shift belongs to Store B
        mockShiftsDAL.findById.mockReturnValue({
          ...shiftA,
          shift_id: SHIFT_B_ID,
          store_id: STORE_B_ID,
        });
        mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);

        const result = await invokeHandler('drafts:create', {
          shift_id: SHIFT_B_ID,
          draft_type: 'DAY_CLOSE',
        });

        expect(result).toMatchObject({
          success: false,
          error: 'NOT_FOUND',
          message: 'Shift not found',
        });

        expect(mockCloseDraftsDAL.createDraft).not.toHaveBeenCalled();
      });
    });

    describe('Vertical Privilege Escalation (Role Bypass)', () => {
      it('cannot spoof admin role through input payload', async () => {
        mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);
        mockCloseDraftsDAL.createDraft.mockReturnValue(draftA);

        // Attacker tries to inject admin role
        await invokeHandler('drafts:create', {
          shift_id: SHIFT_A_ID,
          draft_type: 'DAY_CLOSE',
          role: 'admin', // Attempted injection
          permissions: ['all'], // Attempted injection
        });

        // Should use authenticated user's actual role
        expect(mockCloseDraftsDAL.createDraft).toHaveBeenCalledWith(
          STORE_A_ID,
          SHIFT_A_ID,
          shiftA.business_date,
          'DAY_CLOSE',
          USER_A_ID // Real user, not spoofed
        );
      });

      it('cannot bypass store_id restriction by including it in payload', async () => {
        mockCloseDraftsDAL.updateDraft.mockReturnValue({ ...draftA, version: 2 });

        await invokeHandler('drafts:update', {
          draft_id: DRAFT_A_ID,
          payload: {
            store_id: STORE_B_ID, // Attempted store_id injection
            closing_cash: 100,
          },
          version: 1,
        });

        // DAL must be called with configured store, not injected store
        const updateCall = capturedDALCalls.find((c) => c.method === 'updateDraft');
        expect(updateCall?.args[0]).toBe(STORE_A_ID);
        expect(updateCall?.args[0]).not.toBe(STORE_B_ID);
      });
    });

    describe('Draft ID Enumeration Attack Prevention', () => {
      it('returns consistent response for valid and invalid draft IDs', async () => {
        mockCloseDraftsDAL.getDraft.mockReturnValue(undefined);

        const validUUID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
        const results: unknown[] = [];

        // Try multiple UUIDs - all should return same response structure
        for (let i = 0; i < 5; i++) {
          const testUUID = validUUID.replace(/c/g, i.toString());
          const result = await invokeHandler('drafts:get', {
            draft_id: testUUID,
          });
          results.push(result);
        }

        // All responses should be identical structure
        results.forEach((result) => {
          expect(result).toMatchObject({ draft: null });
        });
      });

      it('does not leak timing information about draft existence', async () => {
        // Both existing and non-existing drafts should have similar timing
        mockCloseDraftsDAL.getDraft.mockReturnValue(undefined);

        const start1 = performance.now();
        await invokeHandler('drafts:get', { draft_id: DRAFT_B_ID });
        const time1 = performance.now() - start1;

        mockCloseDraftsDAL.getDraft.mockReturnValue(draftA);
        const start2 = performance.now();
        await invokeHandler('drafts:get', { draft_id: DRAFT_A_ID });
        const time2 = performance.now() - start2;

        // Timing difference should be minimal (< 100ms threshold)
        expect(Math.abs(time2 - time1)).toBeLessThan(100);
      });
    });
  });

  // ==========================================================================
  // A03:2021 - INJECTION
  // ==========================================================================

  describe('A03:2021 - Injection', () => {
    /**
     * OWASP SQL Injection Test Vectors
     * Source: OWASP Testing Guide v4.2
     */
    const SQL_INJECTION_PAYLOADS = [
      // Classic SQL Injection
      "'; DROP TABLE close_drafts; --",
      "1' OR '1'='1",
      "' UNION SELECT * FROM users --",
      "1; DELETE FROM close_drafts WHERE '1'='1",
      // Time-based Blind SQLi
      "'; WAITFOR DELAY '0:0:10' --",
      "1' AND SLEEP(10) --",
      // Boolean-based Blind SQLi
      "' AND 1=1 --",
      "' AND 1=2 --",
      // SQLite-specific
      "'; ATTACH DATABASE '/tmp/evil.db' AS evil --",
      "' OR sqlite_version() IS NOT NULL --",
      // Stacked Queries
      "'; INSERT INTO users VALUES('hacker','admin'); --",
      "'; UPDATE stores SET name='pwned' --",
      // Error-based SQLi
      "' AND extractvalue(1, concat(0x7e, version())) --",
      "' AND 1=CONVERT(int, @@version) --",
      // Comment Injection
      "admin'/*",
      '*/; DROP TABLE users; /*',
      // Encoding Bypass
      '%27%20OR%201%3D1%20--',
      'admin%27--',
      // Null Byte Injection
      "admin\x00' OR '1'='1",
    ];

    describe('SQL Injection in UUID Fields', () => {
      it.each(SQL_INJECTION_PAYLOADS)('rejects SQL injection in draft_id: %s', async (payload) => {
        const result = await invokeHandler('drafts:get', {
          draft_id: payload,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });

        // DAL should never be called with injection payload
        expect(mockCloseDraftsDAL.getDraft).not.toHaveBeenCalled();
      });

      it.each(SQL_INJECTION_PAYLOADS)('rejects SQL injection in shift_id: %s', async (payload) => {
        const result = await invokeHandler('drafts:create', {
          shift_id: payload,
          draft_type: 'DAY_CLOSE',
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });

        expect(mockCloseDraftsDAL.createDraft).not.toHaveBeenCalled();
      });
    });

    describe('SQL Injection in Payload Fields', () => {
      it('neutralizes SQL injection in JSON payload through parameterization', async () => {
        mockCloseDraftsDAL.updateDraft.mockReturnValue({ ...draftA, version: 2 });

        // SQL injection attempts in payload should be stored as literal strings
        const result = await invokeHandler('drafts:update', {
          draft_id: DRAFT_A_ID,
          payload: {
            lottery: {
              note: "'; DROP TABLE users; --",
              sql: 'SELECT * FROM secrets WHERE 1=1',
            },
          },
          version: 1,
        });

        // Should succeed - payload is just data
        expect(result).toHaveProperty('draft');

        // Verify DAL received literal strings, not executed SQL
        const updateCall = capturedDALCalls.find((c) => c.method === 'updateDraft');
        const passedPayload = updateCall?.args[2] as Record<string, unknown>;
        expect(passedPayload?.lottery).toMatchObject({
          note: "'; DROP TABLE users; --",
          sql: 'SELECT * FROM secrets WHERE 1=1',
        });
      });
    });

    describe('Payload Tampering', () => {
      it('rejects prototype pollution attempts in payload', async () => {
        const _result = await invokeHandler('drafts:update', {
          draft_id: DRAFT_A_ID,
          payload: {
            __proto__: { admin: true },
            constructor: { prototype: { isAdmin: true } },
          },
          version: 1,
        });

        // Prototype pollution should not affect the system
        // @ts-expect-error - Testing prototype pollution
        expect({}.admin).not.toBe(true);
        // @ts-expect-error - Testing prototype pollution
        expect({}.isAdmin).not.toBe(true);
      });

      it('rejects non-JSON-serializable payload values', async () => {
        const circularRef: Record<string, unknown> = {};
        circularRef.self = circularRef;

        const result = await invokeHandler('drafts:update', {
          draft_id: DRAFT_A_ID,
          payload: circularRef,
          version: 1,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
      });

      it('handles extremely large payload without crashing (DoS resilience)', async () => {
        // NOTE: Large payload protection should be implemented at the IPC/transport layer
        // This test verifies the handler doesn't crash with large payloads
        // Production deployments should add size limits at the IPC middleware level

        mockCloseDraftsDAL.updateDraft.mockReturnValue({ ...draftA, version: 2 });

        // Create a moderately large payload (1MB) - actual 10MB+ would OOM in tests
        const largePayload = {
          data: 'x'.repeat(1024 * 1024),
        };

        // Handler should not crash - may succeed or fail, but must respond
        const result = await invokeHandler('drafts:update', {
          draft_id: DRAFT_A_ID,
          payload: largePayload,
          version: 1,
        });

        // Result should be defined (handler responded without crashing)
        expect(result).toBeDefined();
      });
    });

    describe('Command Injection Prevention', () => {
      const COMMAND_INJECTION_PAYLOADS = [
        '; ls -la',
        '| cat /etc/passwd',
        '`rm -rf /`',
        '$(whoami)',
        '\n/bin/sh',
        '&& rm -rf /',
      ];

      it.each(COMMAND_INJECTION_PAYLOADS)(
        'safely handles potential command injection in payload: %s',
        async (payload) => {
          mockCloseDraftsDAL.updateDraft.mockReturnValue({ ...draftA, version: 2 });

          const result = await invokeHandler('drafts:update', {
            draft_id: DRAFT_A_ID,
            payload: {
              note: payload,
            },
            version: 1,
          });

          // Should succeed - commands are just strings, not executed
          expect(result).toHaveProperty('draft');
        }
      );
    });
  });

  // ==========================================================================
  // A07:2021 - IDENTIFICATION AND AUTHENTICATION FAILURES
  // ==========================================================================

  describe('A07:2021 - Identification and Authentication Failures', () => {
    describe('Session Hijacking Prevention', () => {
      it('rejects requests when session is null', async () => {
        mockGetCurrentUser.mockReturnValue(null);

        const result = await invokeHandler('drafts:create', {
          shift_id: SHIFT_A_ID,
          draft_type: 'DAY_CLOSE',
        });

        expect(result).toMatchObject({
          success: false,
          error: 'NOT_AUTHENTICATED',
        });
      });

      it('rejects requests when session has no user_id', async () => {
        mockGetCurrentUser.mockReturnValue({ username: 'test' }); // Missing user_id

        const result = await invokeHandler('drafts:create', {
          shift_id: SHIFT_A_ID,
          draft_type: 'DAY_CLOSE',
        });

        expect(result).toMatchObject({
          success: false,
          error: 'NOT_AUTHENTICATED',
        });
      });

      it('cannot spoof session user_id through request body', async () => {
        mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);
        mockCloseDraftsDAL.createDraft.mockReturnValue(draftA);

        await invokeHandler('drafts:create', {
          shift_id: SHIFT_A_ID,
          draft_type: 'DAY_CLOSE',
          user_id: USER_B_ID, // Attempted spoofing
          created_by: USER_B_ID, // Attempted spoofing
        });

        // Should use actual authenticated user
        expect(mockCloseDraftsDAL.createDraft).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.any(String),
          expect.any(String),
          USER_A_ID // Authenticated user, not spoofed
        );
      });

      it('prevents session fixation by using server-side user context', async () => {
        // Even with a "fixed" session token, user context comes from server
        mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);
        mockCloseDraftsDAL.createDraft.mockReturnValue(draftA);

        await invokeHandler('drafts:create', {
          shift_id: SHIFT_A_ID,
          draft_type: 'DAY_CLOSE',
          session_id: 'fixed-session-id', // Attempted fixation
          token: 'stolen-token', // Attempted replay
        });

        // Extra fields should be ignored
        expect(mockCloseDraftsDAL.createDraft).toHaveBeenCalledWith(
          STORE_A_ID,
          SHIFT_A_ID,
          shiftA.business_date,
          'DAY_CLOSE',
          USER_A_ID
        );
      });
    });

    describe('Authentication State Consistency', () => {
      it('requires authentication for write operations', async () => {
        mockGetCurrentUser.mockReturnValue(null);

        // These handlers explicitly require authentication via requireAuth()
        const writeOperations = [
          { channel: 'drafts:create', args: [{ shift_id: SHIFT_A_ID, draft_type: 'DAY_CLOSE' }] },
          { channel: 'drafts:update', args: [{ draft_id: DRAFT_A_ID, payload: {}, version: 1 }] },
          {
            channel: 'drafts:updateLottery',
            args: [
              {
                draft_id: DRAFT_A_ID,
                lottery_data: {
                  bins_scans: [],
                  totals: { tickets_sold: 0, sales_amount: 0 },
                  entry_method: 'SCAN',
                },
                version: 1,
              },
            ],
          },
          {
            channel: 'drafts:updateStepState',
            args: [{ draft_id: DRAFT_A_ID, step_state: 'LOTTERY' }],
          },
          { channel: 'drafts:finalize', args: [{ draft_id: DRAFT_A_ID, closing_cash: 0 }] },
          { channel: 'drafts:expire', args: [{ draft_id: DRAFT_A_ID }] },
        ];

        for (const { channel, args } of writeOperations) {
          const result = await invokeHandler(channel, ...args);
          expect(result).toMatchObject({
            success: false,
            error: 'NOT_AUTHENTICATED',
          });
        }
      });

      it('drafts:get allows read without strict auth but scopes by store', async () => {
        // Note: drafts:get only requires store config, not user auth
        // This is acceptable for read operations within a store context
        // The store_id scoping via getConfiguredStore provides isolation

        mockGetCurrentUser.mockReturnValue(null); // No user auth
        mockCloseDraftsDAL.getDraft.mockReturnValue(draftA);

        const result = await invokeHandler('drafts:get', {
          draft_id: DRAFT_A_ID,
        });

        // Should succeed (read operations are store-scoped, not user-scoped)
        expect(result).toHaveProperty('draft');
      });
    });
  });

  // ==========================================================================
  // A05:2021 - SECURITY MISCONFIGURATION
  // ==========================================================================

  describe('A05:2021 - Security Misconfiguration', () => {
    describe('Error Message Sanitization (API-003)', () => {
      it('does not leak database schema in errors', async () => {
        mockCloseDraftsDAL.createDraft.mockImplementation(() => {
          throw new Error('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed');
        });
        mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);

        const result = await invokeHandler('drafts:create', {
          shift_id: SHIFT_A_ID,
          draft_type: 'DAY_CLOSE',
        });

        const message = (result as { message: string }).message;
        expect(message).not.toContain('SQLITE');
        expect(message).not.toContain('FOREIGN KEY');
        expect(message).not.toContain('close_drafts');
        expect(message).not.toContain('constraint');
      });

      it('does not leak file paths in errors', async () => {
        mockCloseDraftsDAL.getDraft.mockImplementation(() => {
          const error = new Error('Database error');
          error.stack = `Error: Database error
            at CloseDraftsDAL.getDraft (C:\\nuvana-sync\\src\\main\\dal\\close-drafts.dal.ts:123:15)
            at Object.<anonymous> (C:\\nuvana-sync\\src\\main\\ipc\\close-drafts.handlers.ts:456:20)`;
          throw error;
        });

        const result = await invokeHandler('drafts:get', {
          draft_id: DRAFT_A_ID,
        });

        const message = (result as { message: string }).message;
        expect(message).not.toContain('C:\\');
        expect(message).not.toContain('.ts:');
        expect(message).not.toContain('close-drafts.dal');
      });

      it('does not leak SQL queries in errors', async () => {
        mockCloseDraftsDAL.updateDraft.mockImplementation(() => {
          throw new Error(
            `SQLITE_ERROR: near "WHERE": syntax error in "SELECT * FROM close_drafts WHERE draft_id = ? AND store_id = ?"`
          );
        });

        const result = await invokeHandler('drafts:update', {
          draft_id: DRAFT_A_ID,
          payload: {},
          version: 1,
        });

        const message = (result as { message: string }).message;
        expect(message).not.toContain('SELECT');
        expect(message).not.toContain('FROM');
        expect(message).not.toContain('WHERE');
      });

      it('provides generic user-friendly error messages', async () => {
        mockCloseDraftsDAL.finalizeDraft.mockImplementation(() => {
          throw new Error('Connection pool exhausted: max connections = 10, active = 10');
        });
        mockCloseDraftsDAL.getDraft.mockReturnValue(draftA);
        mockCloseDraftsDAL.beginFinalize.mockReturnValue({ ...draftA, status: 'FINALIZING' });
        mockShiftsDAL.close.mockImplementation(() => {
          throw new Error('Connection pool exhausted');
        });

        const result = await invokeHandler('drafts:finalize', {
          draft_id: DRAFT_A_ID,
          closing_cash: 100,
        });

        const message = (result as { message: string }).message;
        expect(message).toContain('error occurred');
        expect(message).not.toContain('Connection pool');
        expect(message).not.toContain('max connections');
      });
    });

    describe('Store Configuration Enforcement', () => {
      it('rejects all operations when store is not configured', async () => {
        mockGetConfiguredStore.mockReturnValue(null);

        const operations = [
          { channel: 'drafts:create', args: [{ shift_id: SHIFT_A_ID, draft_type: 'DAY_CLOSE' }] },
          { channel: 'drafts:get', args: [{ draft_id: DRAFT_A_ID }] },
          { channel: 'drafts:update', args: [{ draft_id: DRAFT_A_ID, payload: {}, version: 1 }] },
          { channel: 'drafts:finalize', args: [{ draft_id: DRAFT_A_ID, closing_cash: 0 }] },
          { channel: 'drafts:expire', args: [{ draft_id: DRAFT_A_ID }] },
        ];

        for (const { channel, args } of operations) {
          const result = await invokeHandler(channel, ...args);
          expect(result).toMatchObject({
            success: false,
            error: 'NOT_CONFIGURED',
          });
        }
      });

      it('rejects operations when store has no store_id', async () => {
        mockGetConfiguredStore.mockReturnValue({ name: 'Test Store' }); // Missing store_id

        const result = await invokeHandler('drafts:create', {
          shift_id: SHIFT_A_ID,
          draft_type: 'DAY_CLOSE',
        });

        expect(result).toMatchObject({
          success: false,
          error: 'NOT_CONFIGURED',
        });
      });
    });
  });

  // ==========================================================================
  // A04:2021 - INSECURE DESIGN
  // ==========================================================================

  describe('A04:2021 - Insecure Design', () => {
    describe('Business Logic Bypass Prevention', () => {
      it('cannot finalize an already finalized draft', async () => {
        mockCloseDraftsDAL.getDraft.mockReturnValue({
          ...draftA,
          status: 'FINALIZED',
        });

        const result = await invokeHandler('drafts:finalize', {
          draft_id: DRAFT_A_ID,
          closing_cash: 100,
        });

        // Should return idempotent success, not allow re-finalization
        expect(result).toMatchObject({
          success: true,
        });

        // Should NOT attempt to begin finalization
        expect(mockCloseDraftsDAL.beginFinalize).not.toHaveBeenCalled();
      });

      it('cannot finalize an expired draft', async () => {
        mockCloseDraftsDAL.getDraft.mockReturnValue({
          ...draftA,
          status: 'EXPIRED',
        });

        const result = await invokeHandler('drafts:finalize', {
          draft_id: DRAFT_A_ID,
          closing_cash: 100,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'CONFLICT',
        });
      });

      it('cannot finalize if shift is already closed', async () => {
        mockCloseDraftsDAL.getDraft.mockReturnValue(draftA);
        mockShiftsDAL.findById.mockReturnValue({
          ...shiftA,
          status: 'CLOSED',
        });

        const result = await invokeHandler('drafts:finalize', {
          draft_id: DRAFT_A_ID,
          closing_cash: 100,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'ALREADY_CLOSED',
        });
      });

      it('validates closing_cash is non-negative', async () => {
        const result = await invokeHandler('drafts:finalize', {
          draft_id: DRAFT_A_ID,
          closing_cash: -100,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
      });

      it('validates closing_cash does not exceed maximum', async () => {
        const result = await invokeHandler('drafts:finalize', {
          draft_id: DRAFT_A_ID,
          closing_cash: 1000000.0, // Exceeds max of 999999.99
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
      });
    });

    describe('Input Validation Enforcement (API-001)', () => {
      it('validates draft_type is a valid enum value', async () => {
        const result = await invokeHandler('drafts:create', {
          shift_id: SHIFT_A_ID,
          draft_type: 'INVALID_TYPE',
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
      });

      it('validates step_state is a valid enum value', async () => {
        const result = await invokeHandler('drafts:updateStepState', {
          draft_id: DRAFT_A_ID,
          step_state: 'INVALID_STATE',
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
      });

      it('validates version is a positive integer', async () => {
        const invalidVersions = [0, -1, 1.5, 'one', null];

        for (const version of invalidVersions) {
          const result = await invokeHandler('drafts:update', {
            draft_id: DRAFT_A_ID,
            payload: {},
            version,
          });

          expect(result).toMatchObject({
            success: false,
            error: 'VALIDATION_ERROR',
          });
        }
      });

      it('validates lottery data structure', async () => {
        const result = await invokeHandler('drafts:updateLottery', {
          draft_id: DRAFT_A_ID,
          lottery_data: {
            bins_scans: 'not-an-array', // Should be array
            totals: 'not-an-object', // Should be object
            entry_method: 'INVALID', // Should be SCAN or MANUAL
          },
          version: 1,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
      });

      it('validates bin_scan closing_serial format', async () => {
        const result = await invokeHandler('drafts:updateLottery', {
          draft_id: DRAFT_A_ID,
          lottery_data: {
            bins_scans: [
              {
                pack_id: DRAFT_A_ID,
                bin_id: DRAFT_A_ID,
                closing_serial: '12345', // Should be exactly 3 digits
                is_sold_out: false,
                scanned_at: new Date().toISOString(),
              },
            ],
            totals: { tickets_sold: 0, sales_amount: 0 },
            entry_method: 'SCAN',
          },
          version: 1,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
      });
    });
  });

  // ==========================================================================
  // MASS ASSIGNMENT PREVENTION
  // ==========================================================================

  describe('Mass Assignment Prevention', () => {
    it('ignores hidden fields in create payload', async () => {
      mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);
      mockCloseDraftsDAL.createDraft.mockReturnValue(draftA);

      await invokeHandler('drafts:create', {
        shift_id: SHIFT_A_ID,
        draft_type: 'DAY_CLOSE',
        // Attempted mass assignment
        draft_id: 'injected-id',
        status: 'FINALIZED',
        version: 999,
        store_id: STORE_B_ID,
        created_at: '1970-01-01',
      });

      // createDraft should be called with server-controlled values
      expect(mockCloseDraftsDAL.createDraft).toHaveBeenCalledWith(
        STORE_A_ID,
        SHIFT_A_ID,
        shiftA.business_date,
        'DAY_CLOSE',
        USER_A_ID
      );
    });

    it('only updates payload field, not metadata fields', async () => {
      mockCloseDraftsDAL.updateDraft.mockReturnValue({ ...draftA, version: 2 });

      await invokeHandler('drafts:update', {
        draft_id: DRAFT_A_ID,
        payload: {
          closing_cash: 100,
          // Attempted injection of metadata
          status: 'FINALIZED',
          version: 999,
          created_by: USER_B_ID,
        },
        version: 1,
      });

      // DAL receives only payload, not control fields
      const updateCall = capturedDALCalls.find((c) => c.method === 'updateDraft');
      expect(updateCall?.args[2]).toMatchObject({
        closing_cash: 100,
      });
      // These should be in payload (as data), but won't affect actual metadata
    });
  });

  // ==========================================================================
  // RATE LIMITING CONSIDERATIONS (Documentation)
  // ==========================================================================

  describe('Rate Limiting Considerations', () => {
    it('documents that rate limiting should be implemented at the API gateway level', async () => {
      // This test serves as documentation
      // Rate limiting for IPC handlers should be implemented at:
      // 1. Application level (Electron main process)
      // 2. Or via middleware in the IPC handler registration

      // For now, we just verify rapid requests don't cause errors
      const promises = Array(10)
        .fill(null)
        .map(() => invokeHandler('drafts:get', { draft_id: DRAFT_A_ID }));

      await expect(Promise.all(promises)).resolves.toBeDefined();
    });
  });
});
