/**
 * Close Drafts Finalize Integration Tests
 *
 * Tests for the atomic finalization of close drafts:
 * - T3.5: Finalize atomicity (all-or-nothing commit)
 * - Rollback on lottery commit failure
 * - Rollback on shift close failure
 * - Status transitions during finalization
 *
 * Security Standards:
 * - SEC-010: Authorization enforced server-side
 * - DB-006: Store-scoped queries for tenant isolation
 * - SYNC-001: Sync queue integration
 *
 * @module tests/integration/close-drafts.finalize
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

// Mock close drafts DAL with error classes
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
    store_id: shift.store_id,
    business_date: shift.business_date,
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
// Test Suite
// ==========================================================================

describe('T3.5: Close Drafts Finalize Atomicity Tests', () => {
  // Test constants - RFC 4122 compliant UUIDs (version 4, variant 1)
  // Format: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
  const TEST_STORE_ID = '123e4567-e89b-4000-a000-000000000001';
  const TEST_USER_ID = '123e4567-e89b-4000-a000-000000000002';
  const TEST_SHIFT_ID = '123e4567-e89b-4000-a000-000000000003';
  const TEST_DRAFT_ID = '123e4567-e89b-4000-a000-000000000004';
  const TEST_DAY_ID = '123e4567-e89b-4000-a000-000000000005';

  const mockStore = {
    store_id: TEST_STORE_ID,
    name: 'Test Store',
  };

  const mockUser = {
    user_id: TEST_USER_ID,
    username: 'testuser',
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

  const mockDraftWithLottery = {
    draft_id: TEST_DRAFT_ID,
    store_id: TEST_STORE_ID,
    shift_id: TEST_SHIFT_ID,
    business_date: '2026-02-21',
    draft_type: 'DAY_CLOSE' as const,
    status: 'IN_PROGRESS' as const,
    step_state: 'LOTTERY' as const,
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
        totals: {
          tickets_sold: 25,
          sales_amount: 125.0,
        },
        entry_method: 'SCAN' as const,
      },
    },
    version: 3,
    created_at: '2026-02-21T08:00:00.000Z',
    updated_at: '2026-02-21T15:00:00.000Z',
    created_by: TEST_USER_ID,
  };

  const mockDay = {
    day_id: TEST_DAY_ID,
    store_id: TEST_STORE_ID,
    business_date: '2026-02-21',
    status: 'OPEN',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    registeredHandlers.clear();

    mockGetConfiguredStore.mockReturnValue(mockStore);
    mockGetCurrentUser.mockReturnValue(mockUser);
    mockShiftsDAL.findById.mockReturnValue(mockShift);
    mockCloseDraftsDAL.getDraft.mockReturnValue(mockDraftWithLottery);

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

  // ========================================================================
  // Success Cases
  // ========================================================================

  describe('Successful Finalization (All-or-Nothing Commit)', () => {
    beforeEach(() => {
      // Setup successful path
      mockCloseDraftsDAL.beginFinalize.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZING',
      });
      mockLotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockDay);
      mockLotteryBusinessDaysDAL.prepareClose.mockReturnValue(undefined);
      mockLotteryBusinessDaysDAL.commitClose.mockReturnValue({
        closings_created: 1,
        lottery_total: 125.0,
      });
      mockShiftsDAL.close.mockReturnValue(mockClosedShift);
      mockShiftSummariesDAL.findByShiftId.mockReturnValue({
        shift_summary_id: 'summary-001',
        shift_id: TEST_SHIFT_ID,
      });
      mockCloseDraftsDAL.finalizeDraft.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZED',
      });
      mockCloseDraftsDAL.updateDraft.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZED',
        version: 4,
      });
    });

    it('completes full DAY_CLOSE finalization with lottery', async () => {
      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 250.0,
      });

      expect(result).toMatchObject({
        success: true,
        closed_at: expect.any(String),
        lottery_result: {
          closings_created: 1,
          lottery_total: 125.0,
          next_day: expect.any(Object),
        },
        shift_result: {
          shift_id: TEST_SHIFT_ID,
          shift_number: 1,
          closing_cash: 250.0,
        },
      });
    });

    it('executes operations in correct order', async () => {
      const callOrder: string[] = [];

      mockCloseDraftsDAL.beginFinalize.mockImplementation(() => {
        callOrder.push('beginFinalize');
        return { ...mockDraftWithLottery, status: 'FINALIZING' };
      });

      mockLotteryBusinessDaysDAL.prepareClose.mockImplementation(() => {
        callOrder.push('prepareClose');
      });

      mockLotteryBusinessDaysDAL.commitClose.mockImplementation(() => {
        callOrder.push('commitClose');
        return { closings_created: 1, lottery_total: 125.0 };
      });

      mockShiftsDAL.close.mockImplementation(() => {
        callOrder.push('shiftClose');
        return mockClosedShift;
      });

      mockShiftSummariesDAL.closeShiftSummary.mockImplementation(() => {
        callOrder.push('closeShiftSummary');
      });

      mockSyncQueueDAL.enqueue.mockImplementation(() => {
        callOrder.push('syncEnqueue');
        return { item_id: 'queue-001' };
      });

      mockCloseDraftsDAL.finalizeDraft.mockImplementation(() => {
        callOrder.push('finalizeDraft');
        return { ...mockDraftWithLottery, status: 'FINALIZED' };
      });

      await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 250.0,
      });

      // Verify order: lock -> lottery -> shift -> sync -> finalize
      expect(callOrder).toEqual([
        'beginFinalize',
        'prepareClose',
        'commitClose',
        'shiftClose',
        'closeShiftSummary',
        'syncEnqueue',
        'finalizeDraft',
      ]);
    });

    it('enqueues shift to sync queue with closing_cash', async () => {
      await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 300.0,
      });

      expect(mockSyncQueueDAL.enqueue).toHaveBeenCalledWith({
        entity_type: 'shift',
        entity_id: TEST_SHIFT_ID,
        operation: 'UPDATE',
        store_id: TEST_STORE_ID,
        priority: 10, // SHIFT_SYNC_PRIORITY
        payload: expect.objectContaining({
          shift_id: TEST_SHIFT_ID,
          closing_cash: 300.0,
        }),
      });
    });

    it('completes SHIFT_CLOSE without lottery operations', async () => {
      // SHIFT_CLOSE draft has no lottery
      mockCloseDraftsDAL.getDraft.mockReturnValue({
        ...mockDraftWithLottery,
        draft_type: 'SHIFT_CLOSE',
        payload: {}, // No lottery data
      });

      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 100.0,
      });

      expect(result).toMatchObject({
        success: true,
        shift_result: expect.any(Object),
      });

      // Should NOT call lottery operations
      expect(mockLotteryBusinessDaysDAL.prepareClose).not.toHaveBeenCalled();
      expect(mockLotteryBusinessDaysDAL.commitClose).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Rollback Cases
  // ========================================================================

  describe('Rollback on Failure', () => {
    // Helper: Mock getDraft to return FINALIZING on second call (for rollback check)
    const setupDraftMockForRollback = () => {
      mockCloseDraftsDAL.getDraft
        .mockReturnValueOnce(mockDraftWithLottery) // First call: initial fetch
        .mockReturnValueOnce({ ...mockDraftWithLottery, status: 'FINALIZING' }); // Second call: in catch block
    };

    it('rolls back to IN_PROGRESS on lottery prepareClose failure', async () => {
      setupDraftMockForRollback();
      mockCloseDraftsDAL.beginFinalize.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZING',
      });
      mockLotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockDay);
      mockLotteryBusinessDaysDAL.prepareClose.mockImplementation(() => {
        throw new Error('Invalid closing serial for pack');
      });
      mockCloseDraftsDAL.rollbackFinalize.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'IN_PROGRESS',
      });

      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 250.0,
      });

      // Should fail
      expect(result).toMatchObject({
        success: false,
        error: 'INTERNAL_ERROR',
      });

      // Should have called rollback
      expect(mockCloseDraftsDAL.rollbackFinalize).toHaveBeenCalledWith(
        TEST_STORE_ID,
        TEST_DRAFT_ID
      );

      // Should NOT have closed shift
      expect(mockShiftsDAL.close).not.toHaveBeenCalled();
    });

    it('rolls back to IN_PROGRESS on lottery commitClose failure', async () => {
      setupDraftMockForRollback();
      mockCloseDraftsDAL.beginFinalize.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZING',
      });
      mockLotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockDay);
      mockLotteryBusinessDaysDAL.prepareClose.mockReturnValue(undefined);
      mockLotteryBusinessDaysDAL.commitClose.mockImplementation(() => {
        throw new Error('Failed to commit lottery day close');
      });
      mockCloseDraftsDAL.rollbackFinalize.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'IN_PROGRESS',
      });

      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 250.0,
      });

      expect(result).toMatchObject({
        success: false,
        error: 'INTERNAL_ERROR',
      });

      expect(mockCloseDraftsDAL.rollbackFinalize).toHaveBeenCalled();
      expect(mockShiftsDAL.close).not.toHaveBeenCalled();
    });

    it('rolls back to IN_PROGRESS on shift close failure', async () => {
      setupDraftMockForRollback();
      mockCloseDraftsDAL.beginFinalize.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZING',
      });
      mockLotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockDay);
      mockLotteryBusinessDaysDAL.prepareClose.mockReturnValue(undefined);
      mockLotteryBusinessDaysDAL.commitClose.mockReturnValue({
        closings_created: 1,
        lottery_total: 125.0,
      });
      mockShiftsDAL.close.mockReturnValue(null); // Shift close failed
      mockCloseDraftsDAL.rollbackFinalize.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'IN_PROGRESS',
      });

      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 250.0,
      });

      expect(result).toMatchObject({
        success: false,
        error: 'INTERNAL_ERROR',
      });

      expect(mockCloseDraftsDAL.rollbackFinalize).toHaveBeenCalled();
    });

    it('rolls back to IN_PROGRESS on shift close throwing error', async () => {
      setupDraftMockForRollback();
      mockCloseDraftsDAL.beginFinalize.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZING',
      });
      mockLotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockDay);
      mockLotteryBusinessDaysDAL.prepareClose.mockReturnValue(undefined);
      mockLotteryBusinessDaysDAL.commitClose.mockReturnValue({
        closings_created: 1,
        lottery_total: 125.0,
      });
      mockShiftsDAL.close.mockImplementation(() => {
        throw new Error('Database constraint violation');
      });
      mockCloseDraftsDAL.rollbackFinalize.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'IN_PROGRESS',
      });

      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 250.0,
      });

      expect(result).toMatchObject({
        success: false,
        error: 'INTERNAL_ERROR',
      });

      expect(mockCloseDraftsDAL.rollbackFinalize).toHaveBeenCalled();
    });

    it('handles rollback failure gracefully', async () => {
      // Setup getDraft to return FINALIZING on second call (so rollback is attempted)
      mockCloseDraftsDAL.getDraft
        .mockReturnValueOnce(mockDraftWithLottery)
        .mockReturnValueOnce({ ...mockDraftWithLottery, status: 'FINALIZING' });
      mockCloseDraftsDAL.beginFinalize.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZING',
      });
      mockLotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockDay);
      mockLotteryBusinessDaysDAL.prepareClose.mockImplementation(() => {
        throw new Error('Primary failure');
      });
      mockCloseDraftsDAL.rollbackFinalize.mockImplementation(() => {
        throw new Error('Rollback also failed');
      });

      // Should still return error (not crash)
      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 250.0,
      });

      expect(result).toMatchObject({
        success: false,
        error: 'INTERNAL_ERROR',
      });
    });

    it('only rolls back if draft is in FINALIZING state', async () => {
      mockCloseDraftsDAL.beginFinalize.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZING',
      });
      mockLotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockDay);
      mockLotteryBusinessDaysDAL.prepareClose.mockImplementation(() => {
        throw new Error('Failure');
      });

      // getDraft returns IN_PROGRESS on second call (simulating already rolled back elsewhere)
      mockCloseDraftsDAL.getDraft
        .mockReturnValueOnce(mockDraftWithLottery)
        .mockReturnValueOnce({ ...mockDraftWithLottery, status: 'IN_PROGRESS' });

      mockCloseDraftsDAL.rollbackFinalize.mockClear();

      await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 250.0,
      });

      // rollbackFinalize should NOT be called when status is IN_PROGRESS (not FINALIZING)
      // The implementation checks status before calling rollback
      expect(mockCloseDraftsDAL.rollbackFinalize).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Status Transition Tests
  // ========================================================================

  describe('Status Transitions During Finalization', () => {
    it('transitions IN_PROGRESS → FINALIZING at start', async () => {
      // Mock getDraft: first call returns initial, second call returns finalized version
      mockCloseDraftsDAL.getDraft
        .mockReturnValueOnce(mockDraftWithLottery)
        .mockReturnValueOnce({ ...mockDraftWithLottery, status: 'FINALIZED', version: 4 });
      mockCloseDraftsDAL.beginFinalize.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZING',
      });
      mockLotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockDay);
      mockLotteryBusinessDaysDAL.prepareClose.mockReturnValue(undefined);
      mockLotteryBusinessDaysDAL.commitClose.mockReturnValue({
        closings_created: 1,
        lottery_total: 125.0,
      });
      mockShiftsDAL.close.mockReturnValue(mockClosedShift);
      mockCloseDraftsDAL.finalizeDraft.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZED',
      });
      mockCloseDraftsDAL.updateDraft.mockReturnValue(mockDraftWithLottery);

      await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 250.0,
      });

      expect(mockCloseDraftsDAL.beginFinalize).toHaveBeenCalledWith(TEST_STORE_ID, TEST_DRAFT_ID);
    });

    it('transitions FINALIZING → FINALIZED on success', async () => {
      // Mock getDraft: first call returns initial, second call returns finalized version
      mockCloseDraftsDAL.getDraft
        .mockReturnValueOnce(mockDraftWithLottery)
        .mockReturnValueOnce({ ...mockDraftWithLottery, status: 'FINALIZED', version: 4 });
      mockCloseDraftsDAL.beginFinalize.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZING',
      });
      mockLotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockDay);
      mockLotteryBusinessDaysDAL.prepareClose.mockReturnValue(undefined);
      mockLotteryBusinessDaysDAL.commitClose.mockReturnValue({
        closings_created: 1,
        lottery_total: 125.0,
      });
      mockShiftsDAL.close.mockReturnValue(mockClosedShift);
      mockCloseDraftsDAL.finalizeDraft.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZED',
      });
      mockCloseDraftsDAL.updateDraft.mockReturnValue(mockDraftWithLottery);

      await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 250.0,
      });

      expect(mockCloseDraftsDAL.finalizeDraft).toHaveBeenCalledWith(TEST_STORE_ID, TEST_DRAFT_ID);
    });

    it('transitions FINALIZING → IN_PROGRESS on rollback', async () => {
      // Mock getDraft: first call returns initial, second call returns FINALIZING for rollback check
      mockCloseDraftsDAL.getDraft
        .mockReturnValueOnce(mockDraftWithLottery)
        .mockReturnValueOnce({ ...mockDraftWithLottery, status: 'FINALIZING' });
      mockCloseDraftsDAL.beginFinalize.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZING',
      });
      mockLotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockDay);
      mockLotteryBusinessDaysDAL.prepareClose.mockImplementation(() => {
        throw new Error('Failure');
      });
      mockCloseDraftsDAL.rollbackFinalize.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'IN_PROGRESS',
      });

      await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 250.0,
      });

      expect(mockCloseDraftsDAL.rollbackFinalize).toHaveBeenCalledWith(
        TEST_STORE_ID,
        TEST_DRAFT_ID
      );
    });
  });

  // ========================================================================
  // Edge Cases
  // ========================================================================

  describe('Edge Cases', () => {
    it('handles DAY_CLOSE with empty lottery bins gracefully', async () => {
      mockCloseDraftsDAL.getDraft.mockReturnValue({
        ...mockDraftWithLottery,
        payload: {
          lottery: {
            bins_scans: [], // Empty bins
            totals: { tickets_sold: 0, sales_amount: 0 },
            entry_method: 'SCAN',
          },
        },
      });
      mockCloseDraftsDAL.beginFinalize.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZING',
      });
      mockShiftsDAL.close.mockReturnValue(mockClosedShift);
      mockCloseDraftsDAL.finalizeDraft.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZED',
      });
      mockCloseDraftsDAL.updateDraft.mockReturnValue(mockDraftWithLottery);

      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 0,
      });

      // Should succeed (empty lottery is valid)
      expect(result).toMatchObject({
        success: true,
      });
    });

    it('handles DAY_CLOSE with no lottery payload', async () => {
      mockCloseDraftsDAL.getDraft.mockReturnValue({
        ...mockDraftWithLottery,
        payload: {}, // No lottery at all
      });
      mockCloseDraftsDAL.beginFinalize.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZING',
      });
      mockShiftsDAL.close.mockReturnValue(mockClosedShift);
      mockCloseDraftsDAL.finalizeDraft.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZED',
      });
      mockCloseDraftsDAL.updateDraft.mockReturnValue(mockDraftWithLottery);

      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 50.0,
      });

      expect(result).toMatchObject({
        success: true,
      });

      // Should NOT call lottery operations
      expect(mockLotteryBusinessDaysDAL.prepareClose).not.toHaveBeenCalled();
    });

    it('handles closing_cash of 0', async () => {
      // Mock getDraft: first call returns initial, second call returns finalized version
      mockCloseDraftsDAL.getDraft
        .mockReturnValueOnce(mockDraftWithLottery)
        .mockReturnValueOnce({ ...mockDraftWithLottery, status: 'FINALIZED', version: 4 });
      mockCloseDraftsDAL.beginFinalize.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZING',
      });
      mockLotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockDay);
      mockLotteryBusinessDaysDAL.prepareClose.mockReturnValue(undefined);
      mockLotteryBusinessDaysDAL.commitClose.mockReturnValue({
        closings_created: 1,
        lottery_total: 125.0,
      });
      mockShiftsDAL.close.mockReturnValue(mockClosedShift);
      mockCloseDraftsDAL.finalizeDraft.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZED',
      });
      mockCloseDraftsDAL.updateDraft.mockReturnValue(mockDraftWithLottery);

      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 0,
      });

      expect(result).toMatchObject({
        success: true,
        shift_result: {
          closing_cash: 0,
        },
      });
    });

    it('handles maximum closing_cash value', async () => {
      // Mock getDraft: first call returns initial, second call returns finalized version
      mockCloseDraftsDAL.getDraft
        .mockReturnValueOnce(mockDraftWithLottery)
        .mockReturnValueOnce({ ...mockDraftWithLottery, status: 'FINALIZED', version: 4 });
      mockCloseDraftsDAL.beginFinalize.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZING',
      });
      mockLotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockDay);
      mockLotteryBusinessDaysDAL.prepareClose.mockReturnValue(undefined);
      mockLotteryBusinessDaysDAL.commitClose.mockReturnValue({
        closings_created: 1,
        lottery_total: 125.0,
      });
      mockShiftsDAL.close.mockReturnValue(mockClosedShift);
      mockCloseDraftsDAL.finalizeDraft.mockReturnValue({
        ...mockDraftWithLottery,
        status: 'FINALIZED',
      });
      mockCloseDraftsDAL.updateDraft.mockReturnValue(mockDraftWithLottery);

      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 999999.99, // Maximum allowed
      });

      expect(result).toMatchObject({
        success: true,
        shift_result: {
          closing_cash: 999999.99,
        },
      });
    });
  });
});
