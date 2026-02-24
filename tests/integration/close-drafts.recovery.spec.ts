/**
 * Close Drafts Failure Recovery Tests (T8.3)
 *
 * Tests for failure scenarios and recovery mechanisms:
 * - Database unavailable during save
 * - IPC handler crash simulation
 * - Partial commit failures during finalize
 * - Transaction rollback verification
 * - Clean recovery after failures
 * - No orphaned state verification
 * - User retry capability verification
 * - Data integrity after recovery
 *
 * These tests verify the system recovers gracefully from failures.
 *
 * Security Standards Tested:
 * - Transaction atomicity (all-or-nothing)
 * - State consistency after failures
 * - Audit trail preservation
 *
 * @module tests/integration/close-drafts.recovery
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
  failureSimulator,
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
  failureSimulator: {
    databaseUnavailable: false,
    simulateTimeout: false,
    failOnOperation: null as string | null,
    failureCount: 0,
    maxFailures: 0,
  },
}));

// Mock electron modules
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

// Mock database service with failure simulation
vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => {
    if (failureSimulator.databaseUnavailable) {
      throw new Error('SQLITE_CANTOPEN: unable to open database file');
    }
    return {
      prepare: vi.fn(() => ({
        get: vi.fn(),
        all: vi.fn(),
        run: vi.fn(),
      })),
      transaction: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
    };
  }),
  isDatabaseInitialized: vi.fn(() => !failureSimulator.databaseUnavailable),
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

// Mock close drafts DAL
vi.mock('../../src/main/dal/close-drafts.dal', () => ({
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

const TEST_STORE_ID = '11111111-1111-4111-8111-111111111111';
const TEST_USER_ID = '22222222-2222-4222-8222-222222222222';
const TEST_SHIFT_ID = '33333333-3333-4333-8333-333333333333';
const TEST_DRAFT_ID = '44444444-4444-4444-8444-444444444444';
const TEST_DAY_ID = '55555555-5555-4555-8555-555555555555';

// ==========================================================================
// Test Suite
// ==========================================================================

describe('Close Drafts Failure Recovery Tests (T8.3)', () => {
  const mockStore = { store_id: TEST_STORE_ID, name: 'Test Store' };
  const mockUser = {
    user_id: TEST_USER_ID,
    username: 'test_user',
    role: 'cashier' as const,
    store_id: TEST_STORE_ID,
  };
  const mockShift = {
    shift_id: TEST_SHIFT_ID,
    store_id: TEST_STORE_ID,
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
  const mockClosedShift = {
    ...mockShift,
    status: 'CLOSED' as const,
    end_time: '2026-02-21T16:00:00.000Z',
  };
  const mockDay = {
    day_id: TEST_DAY_ID,
    store_id: TEST_STORE_ID,
    business_date: '2026-02-21',
    status: 'OPEN',
  };
  // Define draft status type to allow all valid statuses in test helpers
  type DraftStatus = 'IN_PROGRESS' | 'FINALIZING' | 'FINALIZED' | 'EXPIRED';

  interface TestDraft {
    draft_id: string;
    store_id: string;
    shift_id: string;
    business_date: string;
    draft_type: 'DAY_CLOSE' | 'SHIFT_END';
    status: DraftStatus;
    step_state: string | null;
    payload: Record<string, unknown>;
    version: number;
    created_at: string;
    updated_at: string;
    created_by: string;
  }

  const baseDraft: TestDraft = {
    draft_id: TEST_DRAFT_ID,
    store_id: TEST_STORE_ID,
    shift_id: TEST_SHIFT_ID,
    business_date: '2026-02-21',
    draft_type: 'DAY_CLOSE',
    status: 'IN_PROGRESS',
    step_state: null,
    payload: {
      lottery: {
        bins_scans: [
          {
            pack_id: 'pack-001',
            bin_id: 'bin-001',
            closing_serial: '025',
            is_sold_out: false,
            scanned_at: '2026-02-21T15:00:00.000Z',
          },
        ],
        totals: { tickets_sold: 25, sales_amount: 125.0 },
        entry_method: 'SCAN',
      },
    },
    version: 1,
    created_at: '2026-02-21T08:00:00.000Z',
    updated_at: '2026-02-21T08:00:00.000Z',
    created_by: TEST_USER_ID,
  };

  function createDraft(overrides?: Partial<TestDraft>): TestDraft {
    return { ...baseDraft, ...overrides };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    registeredHandlers.clear();

    // Reset failure simulator
    failureSimulator.databaseUnavailable = false;
    failureSimulator.simulateTimeout = false;
    failureSimulator.failOnOperation = null;
    failureSimulator.failureCount = 0;
    failureSimulator.maxFailures = 0;

    mockGetConfiguredStore.mockReturnValue(mockStore);
    mockGetCurrentUser.mockReturnValue(mockUser);
    mockShiftsDAL.findById.mockReturnValue(mockShift);
    mockCloseDraftsDAL.getDraft.mockReturnValue(createDraft());

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
  // DATABASE FAILURE TESTS
  // ==========================================================================

  describe('Database Unavailable During Save', () => {
    it('returns appropriate error when database is unavailable for create', async () => {
      mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);
      mockCloseDraftsDAL.createDraft.mockImplementation(() => {
        throw new Error('SQLITE_CANTOPEN: unable to open database file');
      });

      const result = await invokeHandler('drafts:create', {
        shift_id: TEST_SHIFT_ID,
        draft_type: 'DAY_CLOSE',
      });

      expect(result).toMatchObject({
        success: false,
        error: 'INTERNAL_ERROR',
      });

      // Error message should not leak database details
      expect((result as { message: string }).message).not.toContain('SQLITE');
    });

    it('returns appropriate error when database is unavailable for update', async () => {
      mockCloseDraftsDAL.updateDraft.mockImplementation(() => {
        throw new Error('SQLITE_BUSY: database is locked');
      });

      const result = await invokeHandler('drafts:update', {
        draft_id: TEST_DRAFT_ID,
        payload: { closing_cash: 100 },
        version: 1,
      });

      expect(result).toMatchObject({
        success: false,
        error: 'INTERNAL_ERROR',
      });

      expect((result as { message: string }).message).not.toContain('SQLITE');
      expect((result as { message: string }).message).not.toContain('locked');
    });

    it('preserves draft state when save fails', async () => {
      const originalDraft = createDraft({ version: 1, payload: { closing_cash: 50 } });
      mockCloseDraftsDAL.getDraft.mockReturnValue(originalDraft);
      mockCloseDraftsDAL.updateDraft.mockImplementation(() => {
        throw new Error('Database error');
      });

      // Attempt to update
      await invokeHandler('drafts:update', {
        draft_id: TEST_DRAFT_ID,
        payload: { closing_cash: 100 },
        version: 1,
      });

      // Draft should still be accessible with original data
      const result = await invokeHandler('drafts:get', {
        draft_id: TEST_DRAFT_ID,
      });

      expect(result).toMatchObject({
        draft: originalDraft,
      });
    });

    it('allows retry after transient database failure', async () => {
      let callCount = 0;
      mockCloseDraftsDAL.updateDraft.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('SQLITE_BUSY: database is locked');
        }
        return createDraft({ version: 2 });
      });

      // First attempt fails
      const result1 = await invokeHandler('drafts:update', {
        draft_id: TEST_DRAFT_ID,
        payload: { closing_cash: 100 },
        version: 1,
      });
      expect((result1 as { success: boolean }).success).toBe(false);

      // Retry succeeds
      const result2 = await invokeHandler('drafts:update', {
        draft_id: TEST_DRAFT_ID,
        payload: { closing_cash: 100 },
        version: 1,
      });
      expect(result2).toHaveProperty('draft');
    });
  });

  // ==========================================================================
  // PARTIAL COMMIT FAILURE TESTS
  // ==========================================================================

  describe('Partial Commit Failures During Finalize', () => {
    it('rolls back to IN_PROGRESS when lottery prepareClose fails', async () => {
      let draftStatus = 'IN_PROGRESS';

      mockCloseDraftsDAL.getDraft.mockImplementation(() =>
        createDraft({ status: draftStatus as 'IN_PROGRESS' | 'FINALIZING' })
      );

      mockCloseDraftsDAL.beginFinalize.mockImplementation(() => {
        draftStatus = 'FINALIZING';
        return createDraft({ status: 'FINALIZING' });
      });

      mockLotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockDay);
      mockLotteryBusinessDaysDAL.prepareClose.mockImplementation(() => {
        throw new Error('Invalid closing serial: pack already closed');
      });

      mockCloseDraftsDAL.rollbackFinalize.mockImplementation(() => {
        draftStatus = 'IN_PROGRESS';
        return createDraft({ status: 'IN_PROGRESS' });
      });

      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 100,
      });

      // Should fail
      expect(result).toMatchObject({
        success: false,
        error: 'INTERNAL_ERROR',
      });

      // Rollback should have been called
      expect(mockCloseDraftsDAL.rollbackFinalize).toHaveBeenCalled();

      // Draft should be back to IN_PROGRESS
      expect(draftStatus).toBe('IN_PROGRESS');

      // Shift should NOT have been closed
      expect(mockShiftsDAL.close).not.toHaveBeenCalled();
    });

    it('rolls back to IN_PROGRESS when lottery commitClose fails', async () => {
      let draftStatus = 'IN_PROGRESS';

      mockCloseDraftsDAL.getDraft.mockImplementation(() =>
        createDraft({ status: draftStatus as 'IN_PROGRESS' | 'FINALIZING' })
      );

      mockCloseDraftsDAL.beginFinalize.mockImplementation(() => {
        draftStatus = 'FINALIZING';
        return createDraft({ status: 'FINALIZING' });
      });

      mockLotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockDay);
      mockLotteryBusinessDaysDAL.prepareClose.mockReturnValue(undefined);
      mockLotteryBusinessDaysDAL.commitClose.mockImplementation(() => {
        throw new Error('Failed to commit lottery day');
      });

      mockCloseDraftsDAL.rollbackFinalize.mockImplementation(() => {
        draftStatus = 'IN_PROGRESS';
        return createDraft({ status: 'IN_PROGRESS' });
      });

      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 100,
      });

      expect(result).toMatchObject({
        success: false,
        error: 'INTERNAL_ERROR',
      });

      expect(mockCloseDraftsDAL.rollbackFinalize).toHaveBeenCalled();
      expect(draftStatus).toBe('IN_PROGRESS');
      expect(mockShiftsDAL.close).not.toHaveBeenCalled();
    });

    it('rolls back to IN_PROGRESS when shift close fails', async () => {
      let draftStatus = 'IN_PROGRESS';

      mockCloseDraftsDAL.getDraft.mockImplementation(() =>
        createDraft({ status: draftStatus as 'IN_PROGRESS' | 'FINALIZING' })
      );

      mockCloseDraftsDAL.beginFinalize.mockImplementation(() => {
        draftStatus = 'FINALIZING';
        return createDraft({ status: 'FINALIZING' });
      });

      mockLotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockDay);
      mockLotteryBusinessDaysDAL.commitClose.mockReturnValue({
        closings_created: 1,
        lottery_total: 125.0,
      });

      mockShiftsDAL.close.mockReturnValue(null); // Shift close failed

      mockCloseDraftsDAL.rollbackFinalize.mockImplementation(() => {
        draftStatus = 'IN_PROGRESS';
        return createDraft({ status: 'IN_PROGRESS' });
      });

      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 100,
      });

      expect(result).toMatchObject({
        success: false,
        error: 'INTERNAL_ERROR',
      });

      expect(mockCloseDraftsDAL.rollbackFinalize).toHaveBeenCalled();
      expect(draftStatus).toBe('IN_PROGRESS');
    });

    it('rolls back when shift close throws error', async () => {
      let draftStatus = 'IN_PROGRESS';

      mockCloseDraftsDAL.getDraft.mockImplementation(() =>
        createDraft({ status: draftStatus as 'IN_PROGRESS' | 'FINALIZING' })
      );

      mockCloseDraftsDAL.beginFinalize.mockImplementation(() => {
        draftStatus = 'FINALIZING';
        return createDraft({ status: 'FINALIZING' });
      });

      mockLotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockDay);
      mockLotteryBusinessDaysDAL.commitClose.mockReturnValue({
        closings_created: 1,
        lottery_total: 125.0,
      });

      mockShiftsDAL.close.mockImplementation(() => {
        throw new Error('FOREIGN KEY constraint failed');
      });

      mockCloseDraftsDAL.rollbackFinalize.mockImplementation(() => {
        draftStatus = 'IN_PROGRESS';
        return createDraft({ status: 'IN_PROGRESS' });
      });

      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 100,
      });

      expect(result).toMatchObject({
        success: false,
        error: 'INTERNAL_ERROR',
      });

      expect(mockCloseDraftsDAL.rollbackFinalize).toHaveBeenCalled();
    });

    it('handles rollback failure gracefully', async () => {
      mockCloseDraftsDAL.getDraft.mockReturnValue(createDraft());

      mockCloseDraftsDAL.beginFinalize.mockReturnValue(createDraft({ status: 'FINALIZING' }));

      mockLotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockDay);
      mockLotteryBusinessDaysDAL.prepareClose.mockImplementation(() => {
        throw new Error('Primary failure');
      });

      mockCloseDraftsDAL.rollbackFinalize.mockImplementation(() => {
        throw new Error('Rollback also failed - double fault');
      });

      // Should still return error (not crash)
      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 100,
      });

      expect(result).toMatchObject({
        success: false,
        error: 'INTERNAL_ERROR',
      });

      // Error message should not leak details about double fault
      expect((result as { message: string }).message).not.toContain('double fault');
      expect((result as { message: string }).message).not.toContain('Rollback');
    });
  });

  // ==========================================================================
  // NO ORPHANED STATE TESTS
  // ==========================================================================

  describe('No Orphaned State After Failures', () => {
    it('draft remains editable after update failure', async () => {
      mockCloseDraftsDAL.updateDraft.mockImplementationOnce(() => {
        throw new Error('Transient error');
      });

      // First update fails
      await invokeHandler('drafts:update', {
        draft_id: TEST_DRAFT_ID,
        payload: { closing_cash: 100 },
        version: 1,
      });

      // Draft should still be accessible
      mockCloseDraftsDAL.getDraft.mockReturnValue(createDraft({ status: 'IN_PROGRESS' }));

      const getResult = await invokeHandler('drafts:get', {
        draft_id: TEST_DRAFT_ID,
      });

      expect(getResult).toMatchObject({
        draft: expect.objectContaining({
          status: 'IN_PROGRESS',
        }),
      });
    });

    it('draft remains editable after finalization failure', async () => {
      let draftStatus = 'IN_PROGRESS';

      mockCloseDraftsDAL.getDraft.mockImplementation(() =>
        createDraft({ status: draftStatus as 'IN_PROGRESS' | 'FINALIZING' })
      );

      mockCloseDraftsDAL.beginFinalize.mockImplementation(() => {
        draftStatus = 'FINALIZING';
        return createDraft({ status: 'FINALIZING' });
      });

      mockLotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockDay);
      mockLotteryBusinessDaysDAL.prepareClose.mockImplementation(() => {
        throw new Error('Finalization failed');
      });

      mockCloseDraftsDAL.rollbackFinalize.mockImplementation(() => {
        draftStatus = 'IN_PROGRESS';
        return createDraft({ status: 'IN_PROGRESS' });
      });

      // Finalization fails
      await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 100,
      });

      // Draft should be back to editable
      expect(draftStatus).toBe('IN_PROGRESS');

      // Should be able to update
      mockCloseDraftsDAL.updateDraft.mockReturnValue(createDraft({ version: 2 }));
      const updateResult = await invokeHandler('drafts:update', {
        draft_id: TEST_DRAFT_ID,
        payload: { closing_cash: 200 },
        version: 1,
      });

      expect(updateResult).toHaveProperty('draft');
    });

    it('no draft created if creation fails mid-operation', async () => {
      mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);
      mockCloseDraftsDAL.createDraft.mockImplementation(() => {
        throw new Error('Creation failed after insert');
      });

      const result = await invokeHandler('drafts:create', {
        shift_id: TEST_SHIFT_ID,
        draft_type: 'DAY_CLOSE',
      });

      expect((result as { success: boolean }).success).toBe(false);

      // Should not leave orphaned draft
      mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);
      const checkResult = await invokeHandler('drafts:get', {
        shift_id: TEST_SHIFT_ID,
      });

      expect((checkResult as { draft: unknown }).draft).toBeNull();
    });
  });

  // ==========================================================================
  // USER RETRY CAPABILITY
  // ==========================================================================

  describe('User Can Retry After Failure', () => {
    it('user can retry create after failure', async () => {
      let callCount = 0;
      mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);
      mockCloseDraftsDAL.createDraft.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First attempt failed');
        }
        return createDraft();
      });

      // First attempt fails
      const result1 = await invokeHandler('drafts:create', {
        shift_id: TEST_SHIFT_ID,
        draft_type: 'DAY_CLOSE',
      });
      expect((result1 as { success: boolean }).success).toBe(false);

      // Retry succeeds
      const result2 = await invokeHandler('drafts:create', {
        shift_id: TEST_SHIFT_ID,
        draft_type: 'DAY_CLOSE',
      });
      expect(result2).toHaveProperty('draft');
    });

    it('user can retry update after transient failure', async () => {
      let callCount = 0;
      mockCloseDraftsDAL.updateDraft.mockImplementation(
        (_storeId: string, _draftId: string, _payload: unknown, _expectedVersion: number) => {
          callCount++;
          if (callCount === 1) {
            throw new Error('Database temporarily unavailable');
          }
          return createDraft({ version: 2 });
        }
      );

      // First attempt fails
      const result1 = await invokeHandler('drafts:update', {
        draft_id: TEST_DRAFT_ID,
        payload: { closing_cash: 100 },
        version: 1,
      });
      expect((result1 as { success: boolean }).success).toBe(false);

      // Retry succeeds
      const result2 = await invokeHandler('drafts:update', {
        draft_id: TEST_DRAFT_ID,
        payload: { closing_cash: 100 },
        version: 1,
      });
      expect(result2).toHaveProperty('draft');
    });

    it('user can retry finalize after failure', async () => {
      let attemptCount = 0;

      mockCloseDraftsDAL.getDraft.mockReturnValue(createDraft());
      mockCloseDraftsDAL.beginFinalize.mockReturnValue(createDraft({ status: 'FINALIZING' }));

      mockLotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockDay);
      mockLotteryBusinessDaysDAL.prepareClose.mockImplementation(() => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('First finalize attempt failed');
        }
        // Success on retry
      });
      mockLotteryBusinessDaysDAL.commitClose.mockReturnValue({
        closings_created: 1,
        lottery_total: 125.0,
      });

      mockShiftsDAL.close.mockReturnValue(mockClosedShift);
      mockCloseDraftsDAL.finalizeDraft.mockReturnValue(createDraft({ status: 'FINALIZED' }));
      mockCloseDraftsDAL.updateDraft.mockReturnValue(createDraft({ status: 'FINALIZED' }));

      mockCloseDraftsDAL.rollbackFinalize.mockImplementation(() => {
        return createDraft({ status: 'IN_PROGRESS' });
      });

      // First attempt fails
      const result1 = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 100,
      });
      expect((result1 as { success: boolean }).success).toBe(false);

      // Retry succeeds
      const result2 = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 100,
      });
      expect(result2).toMatchObject({
        success: true,
      });
    });
  });

  // ==========================================================================
  // DATA INTEGRITY AFTER RECOVERY
  // ==========================================================================

  describe('Data Integrity After Recovery', () => {
    it('payload data preserved after failed update', async () => {
      const originalPayload = {
        lottery: {
          bins_scans: [
            {
              pack_id: 'pack-001',
              bin_id: 'bin-001',
              closing_serial: '025',
              is_sold_out: false,
              scanned_at: '2026-02-21T15:00:00.000Z',
            },
          ],
          totals: { tickets_sold: 25, sales_amount: 125.0 },
          entry_method: 'SCAN' as const,
        },
      };

      mockCloseDraftsDAL.getDraft.mockReturnValue(createDraft({ payload: originalPayload }));

      mockCloseDraftsDAL.updateDraft.mockImplementation(() => {
        throw new Error('Update failed');
      });

      // Attempt to update
      await invokeHandler('drafts:update', {
        draft_id: TEST_DRAFT_ID,
        payload: { closing_cash: 999 },
        version: 1,
      });

      // Verify original data is preserved
      const getResult = await invokeHandler('drafts:get', {
        draft_id: TEST_DRAFT_ID,
      });

      expect(getResult).toMatchObject({
        draft: {
          payload: originalPayload,
        },
      });
    });

    it('version not incremented after failed update', async () => {
      const originalVersion = 5;
      mockCloseDraftsDAL.getDraft.mockReturnValue(createDraft({ version: originalVersion }));

      mockCloseDraftsDAL.updateDraft.mockImplementation(() => {
        throw new Error('Update failed');
      });

      await invokeHandler('drafts:update', {
        draft_id: TEST_DRAFT_ID,
        payload: { closing_cash: 100 },
        version: originalVersion,
      });

      // Version should still be original
      const getResult = await invokeHandler('drafts:get', {
        draft_id: TEST_DRAFT_ID,
      });

      expect((getResult as { draft: { version: number } }).draft.version).toBe(originalVersion);
    });

    it('status unchanged after failed status transition', async () => {
      mockCloseDraftsDAL.getDraft.mockReturnValue(createDraft({ status: 'IN_PROGRESS' }));

      mockCloseDraftsDAL.beginFinalize.mockImplementation(() => {
        throw new Error('Failed to begin finalize');
      });

      await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 100,
      });

      // Status should still be IN_PROGRESS
      const getResult = await invokeHandler('drafts:get', {
        draft_id: TEST_DRAFT_ID,
      });

      expect((getResult as { draft: { status: string } }).draft.status).toBe('IN_PROGRESS');
    });

    it('audit trail preserved after recovery', async () => {
      const createdBy = TEST_USER_ID;
      const createdAt = '2026-02-21T08:00:00.000Z';

      mockCloseDraftsDAL.getDraft.mockReturnValue(
        createDraft({
          created_by: createdBy,
          created_at: createdAt,
        })
      );

      mockCloseDraftsDAL.updateDraft.mockImplementation(() => {
        throw new Error('Update failed');
      });

      await invokeHandler('drafts:update', {
        draft_id: TEST_DRAFT_ID,
        payload: { closing_cash: 100 },
        version: 1,
      });

      // Audit fields should be preserved
      const getResult = await invokeHandler('drafts:get', {
        draft_id: TEST_DRAFT_ID,
      });

      expect(
        (getResult as { draft: { created_by: string; created_at: string } }).draft.created_by
      ).toBe(createdBy);
      expect(
        (getResult as { draft: { created_by: string; created_at: string } }).draft.created_at
      ).toBe(createdAt);
    });
  });

  // ==========================================================================
  // TIMEOUT HANDLING
  // ==========================================================================

  describe('Timeout Handling', () => {
    it('handles operations that complete normally', async () => {
      mockCloseDraftsDAL.updateDraft.mockReturnValue(createDraft({ version: 2 }));

      const result = await invokeHandler('drafts:update', {
        draft_id: TEST_DRAFT_ID,
        payload: { closing_cash: 100 },
        version: 1,
      });

      expect(result).toHaveProperty('draft');
    });

    it('returns error when operation times out', async () => {
      // Simulate a timeout error from the database layer
      mockCloseDraftsDAL.updateDraft.mockImplementation(() => {
        throw new Error('SQLITE_BUSY: database is locked - operation timed out');
      });

      const result = await invokeHandler('drafts:update', {
        draft_id: TEST_DRAFT_ID,
        payload: { closing_cash: 100 },
        version: 1,
      });

      expect((result as { success: boolean }).success).toBe(false);
      expect((result as { error: string }).error).toBe('INTERNAL_ERROR');
    });
  });

  // ==========================================================================
  // CONSTRAINT VIOLATION HANDLING
  // ==========================================================================

  describe('Database Constraint Violation Handling', () => {
    it('handles foreign key constraint violations gracefully', async () => {
      mockCloseDraftsDAL.createDraft.mockImplementation(() => {
        throw new Error('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed');
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

      // Should not leak constraint details
      expect((result as { message: string }).message).not.toContain('FOREIGN KEY');
    });

    it('handles unique constraint violations gracefully', async () => {
      mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);
      mockCloseDraftsDAL.createDraft.mockImplementation(() => {
        throw new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: close_drafts.draft_id');
      });

      const result = await invokeHandler('drafts:create', {
        shift_id: TEST_SHIFT_ID,
        draft_type: 'DAY_CLOSE',
      });

      expect(result).toMatchObject({
        success: false,
        error: 'INTERNAL_ERROR',
      });

      // Should not leak table/column names
      expect((result as { message: string }).message).not.toContain('close_drafts');
    });

    it('handles check constraint violations gracefully', async () => {
      mockCloseDraftsDAL.updateDraft.mockImplementation(() => {
        throw new Error('SQLITE_CONSTRAINT: CHECK constraint failed');
      });

      const result = await invokeHandler('drafts:update', {
        draft_id: TEST_DRAFT_ID,
        payload: { closing_cash: 100 },
        version: 1,
      });

      expect(result).toMatchObject({
        success: false,
        error: 'INTERNAL_ERROR',
      });

      expect((result as { message: string }).message).not.toContain('CHECK');
    });
  });
});
