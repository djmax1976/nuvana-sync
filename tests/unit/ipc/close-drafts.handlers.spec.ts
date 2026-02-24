/**
 * Close Drafts Handlers Unit Tests
 *
 * Tests for close drafts IPC handlers covering:
 * - T3.1: Input validation (API-001)
 * - T3.4: Optimistic locking (VERSION_CONFLICT)
 * - T3.6: Idempotency patterns
 * - Handler error codes and responses
 *
 * Security Standards Tested:
 * - SEC-010: Authorization enforced server-side
 * - SEC-006: Parameterized queries via DAL
 * - DB-006: Store-scoped queries for tenant isolation
 * - API-001: Input validation with Zod schemas
 *
 * @module tests/unit/ipc/close-drafts.handlers
 * @feature DRAFT-001: Draft-Backed Wizard Architecture
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ==========================================================================
// Mock Setup - vi.hoisted for cross-platform compatibility
// ==========================================================================

const {
  mockGetConfiguredStore,
  mockGetCurrentUser,
  _mockFindShiftById,
  mockCloseDraftsDAL,
  mockShiftsDAL,
  mockShiftSummariesDAL,
  mockSyncQueueDAL,
  mockLotteryBusinessDaysDAL,
  mockSettingsService,
} = vi.hoisted(() => ({
  mockGetConfiguredStore: vi.fn(),
  mockGetCurrentUser: vi.fn(),
  _mockFindShiftById: vi.fn(),
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
  mockSettingsService: {
    getPOSType: vi.fn(),
  },
}));

// Mock electron modules
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
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
  storesDAL: {
    getConfiguredStore: mockGetConfiguredStore,
  },
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

// Mock close drafts DAL with VersionConflictError
vi.mock('../../../src/main/dal/close-drafts.dal', () => ({
  closeDraftsDAL: mockCloseDraftsDAL,
  VersionConflictError: class VersionConflictError extends Error {
    code = 'VERSION_CONFLICT';
    currentVersion: number;
    expectedVersion: number;
    constructor(currentVersion: number, expectedVersion: number) {
      super(`Version conflict: expected ${expectedVersion}, but current is ${currentVersion}`);
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
      super(`Invalid status transition from ${fromStatus} to ${toStatus}`);
      this.name = 'InvalidStatusTransitionError';
      this.fromStatus = fromStatus;
      this.toStatus = toStatus;
    }
  },
}));

// Mock settings service
vi.mock('../../../src/main/services/settings.service', () => ({
  settingsService: mockSettingsService,
}));

// Mock shifts handlers for buildShiftSyncPayload
vi.mock('../../../src/main/ipc/shifts.handlers', () => ({
  buildShiftSyncPayload: vi.fn((shift, options) => ({
    shift_id: shift.shift_id,
    store_id: shift.store_id,
    closing_cash: options?.closing_cash ?? null,
  })),
  SHIFT_SYNC_PRIORITY: 10,
}));

// Mock lottery handlers for getCurrentBusinessDate
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

describe('Close Drafts Handlers', () => {
  // Test constants - RFC 4122 compliant UUIDs (version 4, variant 1)
  // Format: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
  const TEST_STORE_ID = '123e4567-e89b-4000-a000-000000000001';
  const TEST_USER_ID = '123e4567-e89b-4000-a000-000000000002';
  const TEST_SHIFT_ID = '123e4567-e89b-4000-a000-000000000003';
  const TEST_DRAFT_ID = '123e4567-e89b-4000-a000-000000000004';

  const mockStore = {
    store_id: TEST_STORE_ID,
    name: 'Test Store',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
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
    created_at: '2026-02-21T08:00:00.000Z',
    updated_at: '2026-02-21T08:00:00.000Z',
  };

  const mockDraft = {
    draft_id: TEST_DRAFT_ID,
    store_id: TEST_STORE_ID,
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

  beforeEach(async () => {
    vi.clearAllMocks();
    registeredHandlers.clear();

    // Default mock returns
    mockGetConfiguredStore.mockReturnValue(mockStore);
    mockGetCurrentUser.mockReturnValue(mockUser);
    mockShiftsDAL.findById.mockReturnValue(mockShift);

    // Import handlers to trigger registration
    await import('../../../src/main/ipc/close-drafts.handlers');
  });

  afterEach(() => {
    vi.resetModules();
  });

  /**
   * Helper to invoke a registered handler
   */
  async function invokeHandler(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = registeredHandlers.get(channel);
    if (!handler) {
      throw new Error(`Handler not registered: ${channel}`);
    }
    return handler({}, ...args);
  }

  // ========================================================================
  // Handler Registration Tests
  // ========================================================================

  describe('Handler Registration', () => {
    it('should register all draft handlers', () => {
      expect(registeredHandlers.has('drafts:create')).toBe(true);
      expect(registeredHandlers.has('drafts:get')).toBe(true);
      expect(registeredHandlers.has('drafts:update')).toBe(true);
      expect(registeredHandlers.has('drafts:updateLottery')).toBe(true);
      expect(registeredHandlers.has('drafts:updateStepState')).toBe(true);
      expect(registeredHandlers.has('drafts:finalize')).toBe(true);
      expect(registeredHandlers.has('drafts:expire')).toBe(true);
    });
  });

  // ========================================================================
  // T3.1: Input Validation Tests (API-001)
  // ========================================================================

  describe('T3.1: Input Validation (API-001)', () => {
    describe('drafts:create', () => {
      it('should reject missing shift_id', async () => {
        const result = await invokeHandler('drafts:create', {
          draft_type: 'DAY_CLOSE',
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
      });

      it('should reject invalid shift_id format', async () => {
        const result = await invokeHandler('drafts:create', {
          shift_id: 'not-a-uuid',
          draft_type: 'DAY_CLOSE',
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
        expect((result as { message: string }).message).toContain('UUID');
      });

      it('should reject invalid draft_type', async () => {
        const result = await invokeHandler('drafts:create', {
          shift_id: TEST_SHIFT_ID,
          draft_type: 'INVALID_TYPE',
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
        // Zod enum validation message format
        expect((result as { message: string }).message).toMatch(/DAY_CLOSE|SHIFT_CLOSE/);
      });

      it('should accept valid DAY_CLOSE type', async () => {
        mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);
        mockCloseDraftsDAL.createDraft.mockReturnValue(mockDraft);

        const result = await invokeHandler('drafts:create', {
          shift_id: TEST_SHIFT_ID,
          draft_type: 'DAY_CLOSE',
        });

        expect(result).toHaveProperty('draft');
      });

      it('should accept valid SHIFT_CLOSE type', async () => {
        mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);
        const shiftCloseDraft = { ...mockDraft, draft_type: 'SHIFT_CLOSE' };
        mockCloseDraftsDAL.createDraft.mockReturnValue(shiftCloseDraft);

        const result = await invokeHandler('drafts:create', {
          shift_id: TEST_SHIFT_ID,
          draft_type: 'SHIFT_CLOSE',
        });

        expect(result).toHaveProperty('draft');
        expect((result as { draft: typeof shiftCloseDraft }).draft.draft_type).toBe('SHIFT_CLOSE');
      });
    });

    describe('drafts:get', () => {
      it('should reject when neither draft_id nor shift_id provided', async () => {
        const result = await invokeHandler('drafts:get', {});

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
        expect((result as { message: string }).message).toContain('draft_id or shift_id');
      });

      it('should reject invalid draft_id format', async () => {
        const result = await invokeHandler('drafts:get', {
          draft_id: 'invalid-uuid',
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
      });

      it('should accept valid draft_id', async () => {
        mockCloseDraftsDAL.getDraft.mockReturnValue(mockDraft);

        const result = await invokeHandler('drafts:get', {
          draft_id: TEST_DRAFT_ID,
        });

        expect(result).toHaveProperty('draft', mockDraft);
      });

      it('should accept valid shift_id', async () => {
        mockCloseDraftsDAL.getActiveDraft.mockReturnValue(mockDraft);

        const result = await invokeHandler('drafts:get', {
          shift_id: TEST_SHIFT_ID,
        });

        expect(result).toHaveProperty('draft', mockDraft);
      });
    });

    describe('drafts:update', () => {
      it('should reject missing draft_id', async () => {
        const result = await invokeHandler('drafts:update', {
          payload: {},
          version: 1,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
      });

      it('should reject missing version', async () => {
        const result = await invokeHandler('drafts:update', {
          draft_id: TEST_DRAFT_ID,
          payload: {},
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
      });

      it('should reject version less than 1', async () => {
        const result = await invokeHandler('drafts:update', {
          draft_id: TEST_DRAFT_ID,
          payload: {},
          version: 0,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
        expect((result as { message: string }).message).toContain('at least 1');
      });

      it('should reject non-integer version', async () => {
        const result = await invokeHandler('drafts:update', {
          draft_id: TEST_DRAFT_ID,
          payload: {},
          version: 1.5,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
      });
    });

    describe('drafts:updateLottery', () => {
      const validLotteryData = {
        bins_scans: [],
        totals: { tickets_sold: 0, sales_amount: 0 },
        entry_method: 'SCAN',
      };

      it('should reject invalid lottery_data structure', async () => {
        const result = await invokeHandler('drafts:updateLottery', {
          draft_id: TEST_DRAFT_ID,
          lottery_data: { invalid: 'structure' },
          version: 1,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
      });

      it('should reject negative tickets_sold', async () => {
        const result = await invokeHandler('drafts:updateLottery', {
          draft_id: TEST_DRAFT_ID,
          lottery_data: {
            ...validLotteryData,
            totals: { tickets_sold: -1, sales_amount: 0 },
          },
          version: 1,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
      });

      it('should reject negative sales_amount', async () => {
        const result = await invokeHandler('drafts:updateLottery', {
          draft_id: TEST_DRAFT_ID,
          lottery_data: {
            ...validLotteryData,
            totals: { tickets_sold: 0, sales_amount: -100 },
          },
          version: 1,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
      });

      it('should reject invalid entry_method', async () => {
        const result = await invokeHandler('drafts:updateLottery', {
          draft_id: TEST_DRAFT_ID,
          lottery_data: {
            ...validLotteryData,
            entry_method: 'INVALID',
          },
          version: 1,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
      });

      it('should accept valid lottery data', async () => {
        const updatedDraft = { ...mockDraft, payload: { lottery: validLotteryData } };
        mockCloseDraftsDAL.updateDraft.mockReturnValue(updatedDraft);

        const result = await invokeHandler('drafts:updateLottery', {
          draft_id: TEST_DRAFT_ID,
          lottery_data: validLotteryData,
          version: 1,
        });

        expect(result).toHaveProperty('draft');
      });
    });

    describe('drafts:finalize', () => {
      it('should reject missing draft_id', async () => {
        const result = await invokeHandler('drafts:finalize', {
          closing_cash: 100,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
      });

      it('should reject negative closing_cash', async () => {
        const result = await invokeHandler('drafts:finalize', {
          draft_id: TEST_DRAFT_ID,
          closing_cash: -50,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
        expect((result as { message: string }).message).toContain('non-negative');
      });

      it('should reject closing_cash exceeding maximum', async () => {
        const result = await invokeHandler('drafts:finalize', {
          draft_id: TEST_DRAFT_ID,
          closing_cash: 1000000,
        });

        expect(result).toMatchObject({
          success: false,
          error: 'VALIDATION_ERROR',
        });
        expect((result as { message: string }).message).toContain('maximum');
      });

      it('should accept valid closing_cash of 0', async () => {
        mockCloseDraftsDAL.getDraft.mockReturnValue(mockDraft);
        mockCloseDraftsDAL.beginFinalize.mockReturnValue({ ...mockDraft, status: 'FINALIZING' });
        mockShiftsDAL.close.mockReturnValue({
          ...mockShift,
          status: 'CLOSED',
          end_time: '2026-02-21T16:00:00.000Z',
        });
        mockCloseDraftsDAL.finalizeDraft.mockReturnValue({ ...mockDraft, status: 'FINALIZED' });
        mockCloseDraftsDAL.updateDraft.mockReturnValue(mockDraft);

        const result = await invokeHandler('drafts:finalize', {
          draft_id: TEST_DRAFT_ID,
          closing_cash: 0,
        });

        expect(result).toHaveProperty('success', true);
      });
    });
  });

  // ========================================================================
  // T3.4: Optimistic Locking Tests
  // ========================================================================

  describe('T3.4: Optimistic Locking', () => {
    it('should return VERSION_CONFLICT when update version mismatches', async () => {
      // Import the actual error class for instanceof check
      const { VersionConflictError } = await import('../../../src/main/dal/close-drafts.dal');
      mockCloseDraftsDAL.updateDraft.mockImplementation(() => {
        throw new VersionConflictError(3, 1);
      });

      const result = await invokeHandler('drafts:update', {
        draft_id: TEST_DRAFT_ID,
        payload: { closing_cash: 100 },
        version: 1,
      });

      expect(result).toMatchObject({
        error: 'VERSION_CONFLICT',
        current_version: 3,
        expected_version: 1,
      });
    });

    it('should return VERSION_CONFLICT on lottery update with stale version', async () => {
      const { VersionConflictError } = await import('../../../src/main/dal/close-drafts.dal');
      mockCloseDraftsDAL.updateDraft.mockImplementation(() => {
        throw new VersionConflictError(5, 2);
      });

      const result = await invokeHandler('drafts:updateLottery', {
        draft_id: TEST_DRAFT_ID,
        lottery_data: {
          bins_scans: [],
          totals: { tickets_sold: 0, sales_amount: 0 },
          entry_method: 'SCAN',
        },
        version: 2,
      });

      expect(result).toMatchObject({
        error: 'VERSION_CONFLICT',
        current_version: 5,
        expected_version: 2,
      });
    });

    it('should include helpful message for conflict resolution', async () => {
      const { VersionConflictError } = await import('../../../src/main/dal/close-drafts.dal');
      mockCloseDraftsDAL.updateDraft.mockImplementation(() => {
        throw new VersionConflictError(10, 5);
      });

      const result = await invokeHandler('drafts:update', {
        draft_id: TEST_DRAFT_ID,
        payload: {},
        version: 5,
      });

      expect((result as { message: string }).message).toContain('refresh');
      expect((result as { message: string }).message).toContain('retry');
    });

    it('should succeed with correct version', async () => {
      const updatedDraft = { ...mockDraft, version: 2, payload: { closing_cash: 150 } };
      mockCloseDraftsDAL.updateDraft.mockReturnValue(updatedDraft);

      const result = await invokeHandler('drafts:update', {
        draft_id: TEST_DRAFT_ID,
        payload: { closing_cash: 150 },
        version: 1,
      });

      expect(result).toHaveProperty('draft');
      expect((result as { draft: typeof updatedDraft }).draft.version).toBe(2);
    });
  });

  // ========================================================================
  // T3.6: Idempotency Tests
  // ========================================================================

  describe('T3.6: Idempotency', () => {
    it('drafts:create should return existing active draft if one exists', async () => {
      // First call creates draft
      mockCloseDraftsDAL.getActiveDraft.mockReturnValue(mockDraft);

      const result1 = await invokeHandler('drafts:create', {
        shift_id: TEST_SHIFT_ID,
        draft_type: 'DAY_CLOSE',
      });

      // Should NOT call createDraft since active draft exists
      expect(mockCloseDraftsDAL.createDraft).not.toHaveBeenCalled();
      expect(result1).toHaveProperty('draft', mockDraft);
    });

    it('drafts:create should create new draft when none exists', async () => {
      mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);
      mockCloseDraftsDAL.createDraft.mockReturnValue(mockDraft);

      const result = await invokeHandler('drafts:create', {
        shift_id: TEST_SHIFT_ID,
        draft_type: 'DAY_CLOSE',
      });

      expect(mockCloseDraftsDAL.createDraft).toHaveBeenCalledWith(
        TEST_STORE_ID,
        TEST_SHIFT_ID,
        mockShift.business_date,
        'DAY_CLOSE',
        TEST_USER_ID
      );
      expect(result).toHaveProperty('draft', mockDraft);
    });

    it('drafts:finalize should return success for already FINALIZED draft', async () => {
      const finalizedDraft = { ...mockDraft, status: 'FINALIZED' as const };
      mockCloseDraftsDAL.getDraft.mockReturnValue(finalizedDraft);

      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 100,
      });

      // Should not attempt to finalize again
      expect(mockCloseDraftsDAL.beginFinalize).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        success: true,
      });
    });

    it('drafts:expire on already EXPIRED draft should succeed', async () => {
      const expiredDraft = { ...mockDraft, status: 'EXPIRED' as const };
      mockCloseDraftsDAL.expireDraft.mockReturnValue(expiredDraft);

      const result = await invokeHandler('drafts:expire', {
        draft_id: TEST_DRAFT_ID,
      });

      expect(result).toHaveProperty('draft');
      expect((result as { draft: typeof expiredDraft }).draft.status).toBe('EXPIRED');
    });
  });

  // ========================================================================
  // Store Configuration Tests (DB-006)
  // ========================================================================

  describe('Store Configuration (DB-006)', () => {
    it('should return NOT_CONFIGURED when store not configured', async () => {
      mockGetConfiguredStore.mockReturnValue(null);

      const result = await invokeHandler('drafts:create', {
        shift_id: TEST_SHIFT_ID,
        draft_type: 'DAY_CLOSE',
      });

      expect(result).toMatchObject({
        success: false,
        error: 'NOT_CONFIGURED',
        message: 'Store not configured. Please complete setup first.',
      });
    });

    it('should use configured store_id for DAL calls', async () => {
      mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);
      mockCloseDraftsDAL.createDraft.mockReturnValue(mockDraft);

      await invokeHandler('drafts:create', {
        shift_id: TEST_SHIFT_ID,
        draft_type: 'DAY_CLOSE',
      });

      // Verify DAL was called with correct store_id
      expect(mockCloseDraftsDAL.getActiveDraft).toHaveBeenCalledWith(TEST_STORE_ID, TEST_SHIFT_ID);
      expect(mockCloseDraftsDAL.createDraft).toHaveBeenCalledWith(
        TEST_STORE_ID,
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String)
      );
    });
  });

  // ========================================================================
  // Authentication Tests (SEC-010)
  // ========================================================================

  describe('Authentication (SEC-010)', () => {
    it('drafts:create should fail when user not authenticated', async () => {
      mockGetCurrentUser.mockReturnValue(null);

      const result = await invokeHandler('drafts:create', {
        shift_id: TEST_SHIFT_ID,
        draft_type: 'DAY_CLOSE',
      });

      expect(result).toMatchObject({
        success: false,
        error: 'NOT_AUTHENTICATED',
      });
    });

    it('drafts:finalize should fail when user not authenticated', async () => {
      mockGetCurrentUser.mockReturnValue(null);

      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 100,
      });

      expect(result).toMatchObject({
        success: false,
        error: 'NOT_AUTHENTICATED',
      });
    });

    it('should capture user_id in draft created_by field', async () => {
      mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);
      mockCloseDraftsDAL.createDraft.mockReturnValue(mockDraft);

      await invokeHandler('drafts:create', {
        shift_id: TEST_SHIFT_ID,
        draft_type: 'DAY_CLOSE',
      });

      expect(mockCloseDraftsDAL.createDraft).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        TEST_USER_ID // created_by
      );
    });
  });

  // ========================================================================
  // Error Handling Tests (API-003)
  // ========================================================================

  describe('Error Handling (API-003)', () => {
    it('should return NOT_FOUND when shift does not exist', async () => {
      mockShiftsDAL.findById.mockReturnValue(null);
      mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);

      const result = await invokeHandler('drafts:create', {
        shift_id: TEST_SHIFT_ID,
        draft_type: 'DAY_CLOSE',
      });

      expect(result).toMatchObject({
        success: false,
        error: 'NOT_FOUND',
        message: 'Shift not found',
      });
    });

    it('should return NOT_FOUND when shift belongs to different store', async () => {
      mockShiftsDAL.findById.mockReturnValue({
        ...mockShift,
        store_id: 'different-store-id',
      });
      mockCloseDraftsDAL.getActiveDraft.mockReturnValue(null);

      const result = await invokeHandler('drafts:create', {
        shift_id: TEST_SHIFT_ID,
        draft_type: 'DAY_CLOSE',
      });

      expect(result).toMatchObject({
        success: false,
        error: 'NOT_FOUND',
        message: 'Shift not found',
      });
    });

    it('should return CONFLICT when draft is EXPIRED', async () => {
      const expiredDraft = { ...mockDraft, status: 'EXPIRED' as const };
      mockCloseDraftsDAL.getDraft.mockReturnValue(expiredDraft);

      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 100,
      });

      expect(result).toMatchObject({
        success: false,
        error: 'CONFLICT',
        message: 'Draft has expired',
      });
    });

    it('should return ALREADY_CLOSED when shift is already closed', async () => {
      const closedShift = { ...mockShift, status: 'CLOSED' as const };
      mockShiftsDAL.findById.mockReturnValue(closedShift);
      mockCloseDraftsDAL.getDraft.mockReturnValue(mockDraft);

      const result = await invokeHandler('drafts:finalize', {
        draft_id: TEST_DRAFT_ID,
        closing_cash: 100,
      });

      expect(result).toMatchObject({
        success: false,
        error: 'ALREADY_CLOSED',
        message: 'Shift is already closed',
      });
    });

    it('should handle internal errors gracefully', async () => {
      mockCloseDraftsDAL.createDraft.mockImplementation(() => {
        throw new Error('Database connection failed');
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
      // Should NOT leak error details
      expect((result as { message: string }).message).not.toContain('Database connection');
    });
  });

  // ========================================================================
  // Step State Tests
  // ========================================================================

  describe('drafts:updateStepState', () => {
    it('should accept valid step states', async () => {
      const updatedDraft = { ...mockDraft, step_state: 'LOTTERY' as const };
      mockCloseDraftsDAL.updateStepState.mockReturnValue(updatedDraft);

      const validStates = ['LOTTERY', 'REPORTS', 'REVIEW', null];

      for (const state of validStates) {
        const result = await invokeHandler('drafts:updateStepState', {
          draft_id: TEST_DRAFT_ID,
          step_state: state,
        });

        expect(result).toHaveProperty('draft');
      }
    });

    it('should reject invalid step state', async () => {
      const result = await invokeHandler('drafts:updateStepState', {
        draft_id: TEST_DRAFT_ID,
        step_state: 'INVALID_STEP',
      });

      expect(result).toMatchObject({
        success: false,
        error: 'VALIDATION_ERROR',
      });
    });
  });

  // ========================================================================
  // Expire Draft Tests
  // ========================================================================

  describe('drafts:expire', () => {
    it('should expire an IN_PROGRESS draft', async () => {
      const expiredDraft = { ...mockDraft, status: 'EXPIRED' as const };
      mockCloseDraftsDAL.expireDraft.mockReturnValue(expiredDraft);

      const result = await invokeHandler('drafts:expire', {
        draft_id: TEST_DRAFT_ID,
      });

      expect(result).toHaveProperty('draft');
      expect((result as { draft: typeof expiredDraft }).draft.status).toBe('EXPIRED');
    });

    it('should return NOT_FOUND for non-existent draft', async () => {
      mockCloseDraftsDAL.expireDraft.mockImplementation(() => {
        throw new Error('Draft not found: ' + TEST_DRAFT_ID);
      });

      const result = await invokeHandler('drafts:expire', {
        draft_id: TEST_DRAFT_ID,
      });

      expect(result).toMatchObject({
        success: false,
        error: 'NOT_FOUND',
      });
    });
  });
});
