/**
 * Transport Layer Close Drafts Unit Tests
 *
 * Tests for the transport.drafts.* methods.
 * Verifies IPC channel invocation, parameter passing, and response handling.
 *
 * @module tests/unit/transport/drafts.transport
 * @feature DRAFT-001: Draft-Backed Wizard Architecture
 * @security SEC-014: Verifies IPC channel security
 * @security API-001: Verifies parameter structure matches handler expectations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mock Setup
// Use vi.hoisted() to ensure mock functions are available when vi.mock runs
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
// ============================================================================

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/api/ipc-client', () => ({
  ipcClient: {
    invoke: mockInvoke,
    on: vi.fn(() => () => {}),
    once: vi.fn(),
  },
  IPCError: class IPCError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

// ============================================================================
// Test Data
// ============================================================================

const _VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const STORE_ID = 'store-uuid-1234-5678-90ab-cdef12345678';
const SHIFT_ID = 'shift-uuid-1234-5678-90ab-cdef12345678';
const DRAFT_ID = 'draft-uuid-1234-5678-90ab-cdef12345678';
const USER_ID = 'user-uuid-1234-5678-90ab-cdef12345678';
const PACK_ID = 'pack-uuid-1234-5678-90ab-cdef12345678';
const BIN_ID = 'bin-uuid-1234-5678-90ab-cdef12345678';
const BUSINESS_DATE = '2026-02-21';

/**
 * Mock draft response
 */
const mockDraftResponse = {
  draft: {
    draft_id: DRAFT_ID,
    store_id: STORE_ID,
    shift_id: SHIFT_ID,
    business_date: BUSINESS_DATE,
    draft_type: 'DAY_CLOSE' as const,
    status: 'IN_PROGRESS' as const,
    step_state: null,
    payload: {},
    version: 1,
    created_at: '2026-02-21T08:00:00.000Z',
    updated_at: '2026-02-21T08:00:00.000Z',
    created_by: USER_ID,
  },
};

/**
 * Mock draft with lottery data
 */
const mockDraftWithLottery = {
  draft: {
    ...mockDraftResponse.draft,
    payload: {
      lottery: {
        bins_scans: [
          {
            pack_id: PACK_ID,
            bin_id: BIN_ID,
            closing_serial: '045',
            is_sold_out: false,
            scanned_at: '2026-02-21T10:00:00.000Z',
          },
        ],
        totals: {
          tickets_sold: 45,
          sales_amount: 45.0,
        },
        entry_method: 'SCAN' as const,
      },
    },
    version: 2,
    step_state: 'LOTTERY' as const,
  },
};

/**
 * Mock finalize response
 */
const mockFinalizeResponse = {
  success: true,
  closed_at: '2026-02-21T16:00:00.000Z',
  lottery_result: {
    closings_created: 5,
    lottery_total: 225.0,
    next_day: {
      day_id: 'next-day-uuid',
      business_date: '2026-02-22',
      status: 'OPEN',
    },
  },
  shift_result: {
    shift_id: SHIFT_ID,
    shift_number: 1,
    business_date: BUSINESS_DATE,
    closing_cash: 500.0,
  },
};

/**
 * Mock version conflict response
 */
const mockVersionConflictResponse = {
  error: 'VERSION_CONFLICT' as const,
  message: 'Version conflict: expected 1, but current is 2. Please refresh and retry.',
  current_version: 2,
  expected_version: 1,
};

// ============================================================================
// Tests: drafts.create()
// ============================================================================

describe('Transport drafts.create()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('IPC Channel Invocation', () => {
    it("TEST: Invokes correct IPC channel 'drafts:create'", async () => {
      mockInvoke.mockResolvedValueOnce(mockDraftResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.create(SHIFT_ID, 'DAY_CLOSE');

      expect(mockInvoke).toHaveBeenCalledWith('drafts:create', expect.any(Object));
    });

    it('TEST: Passes shift_id and draft_type as object', async () => {
      mockInvoke.mockResolvedValueOnce(mockDraftResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.create(SHIFT_ID, 'DAY_CLOSE');

      expect(mockInvoke).toHaveBeenCalledWith('drafts:create', {
        shift_id: SHIFT_ID,
        draft_type: 'DAY_CLOSE',
      });
    });

    it('TEST: Uses correct parameter names (shift_id, draft_type)', async () => {
      mockInvoke.mockResolvedValueOnce(mockDraftResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.create(SHIFT_ID, 'SHIFT_CLOSE');

      const invokeCall = mockInvoke.mock.calls[0];
      const params = invokeCall[1];

      // Verify parameter names match handler expectations
      expect(params).toHaveProperty('shift_id');
      expect(params).toHaveProperty('draft_type');
      expect(params).not.toHaveProperty('shiftId'); // camelCase should NOT be used
      expect(params).not.toHaveProperty('draftType');
    });

    it('TEST: Supports both DAY_CLOSE and SHIFT_CLOSE types', async () => {
      mockInvoke.mockResolvedValue(mockDraftResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');

      await ipc.drafts.create(SHIFT_ID, 'DAY_CLOSE');
      expect(mockInvoke).toHaveBeenLastCalledWith('drafts:create', {
        shift_id: SHIFT_ID,
        draft_type: 'DAY_CLOSE',
      });

      await ipc.drafts.create(SHIFT_ID, 'SHIFT_CLOSE');
      expect(mockInvoke).toHaveBeenLastCalledWith('drafts:create', {
        shift_id: SHIFT_ID,
        draft_type: 'SHIFT_CLOSE',
      });
    });
  });

  describe('Response Handling', () => {
    it('TEST: Returns DraftResponse from IPC handler', async () => {
      mockInvoke.mockResolvedValueOnce(mockDraftResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.create(SHIFT_ID, 'DAY_CLOSE');

      expect(result).toEqual(mockDraftResponse);
      expect(result.draft.draft_id).toBe(DRAFT_ID);
    });

    it('TEST: Returns existing draft for idempotent creation', async () => {
      const existingDraft = {
        draft: {
          ...mockDraftResponse.draft,
          version: 3,
        },
      };
      mockInvoke.mockResolvedValueOnce(existingDraft);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.create(SHIFT_ID, 'DAY_CLOSE');

      expect(result.draft.version).toBe(3);
    });

    it('TEST: Propagates NOT_CONFIGURED error', async () => {
      const { IPCError } = await import('../../../src/renderer/lib/api/ipc-client');
      const error = new IPCError('NOT_CONFIGURED', 'Store not configured');
      mockInvoke.mockRejectedValueOnce(error);

      const { ipc } = await import('../../../src/renderer/lib/transport');

      await expect(ipc.drafts.create(SHIFT_ID, 'DAY_CLOSE')).rejects.toMatchObject({
        code: 'NOT_CONFIGURED',
      });
    });

    it('TEST: Propagates NOT_AUTHENTICATED error', async () => {
      const { IPCError } = await import('../../../src/renderer/lib/api/ipc-client');
      const error = new IPCError('NOT_AUTHENTICATED', 'User authentication required');
      mockInvoke.mockRejectedValueOnce(error);

      const { ipc } = await import('../../../src/renderer/lib/transport');

      await expect(ipc.drafts.create(SHIFT_ID, 'DAY_CLOSE')).rejects.toMatchObject({
        code: 'NOT_AUTHENTICATED',
      });
    });

    it('TEST: Propagates VALIDATION_ERROR for invalid UUID', async () => {
      const { IPCError } = await import('../../../src/renderer/lib/api/ipc-client');
      const error = new IPCError('VALIDATION_ERROR', 'Invalid UUID format');
      mockInvoke.mockRejectedValueOnce(error);

      const { ipc } = await import('../../../src/renderer/lib/transport');

      await expect(ipc.drafts.create('invalid-id', 'DAY_CLOSE')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });
  });

  describe('Type Safety', () => {
    it('TEST: Response includes CloseDraft fields', async () => {
      mockInvoke.mockResolvedValueOnce(mockDraftResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.create(SHIFT_ID, 'DAY_CLOSE');

      expect(result.draft).toHaveProperty('draft_id');
      expect(result.draft).toHaveProperty('store_id');
      expect(result.draft).toHaveProperty('shift_id');
      expect(result.draft).toHaveProperty('business_date');
      expect(result.draft).toHaveProperty('draft_type');
      expect(result.draft).toHaveProperty('status');
      expect(result.draft).toHaveProperty('step_state');
      expect(result.draft).toHaveProperty('payload');
      expect(result.draft).toHaveProperty('version');
      expect(result.draft).toHaveProperty('created_at');
      expect(result.draft).toHaveProperty('updated_at');
      expect(result.draft).toHaveProperty('created_by');
    });
  });
});

// ============================================================================
// Tests: drafts.get()
// ============================================================================

describe('Transport drafts.get()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('IPC Channel Invocation', () => {
    it("TEST: Invokes correct IPC channel 'drafts:get'", async () => {
      mockInvoke.mockResolvedValueOnce({ draft: mockDraftResponse.draft });

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.get(DRAFT_ID);

      expect(mockInvoke).toHaveBeenCalledWith('drafts:get', expect.any(Object));
    });

    it('TEST: Passes draft_id as parameter', async () => {
      mockInvoke.mockResolvedValueOnce({ draft: mockDraftResponse.draft });

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.get(DRAFT_ID);

      expect(mockInvoke).toHaveBeenCalledWith('drafts:get', {
        draft_id: DRAFT_ID,
      });
    });
  });

  describe('Response Handling', () => {
    it('TEST: Returns GetDraftResponse with draft', async () => {
      mockInvoke.mockResolvedValueOnce({ draft: mockDraftResponse.draft });

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.get(DRAFT_ID);

      expect(result.draft).toEqual(mockDraftResponse.draft);
    });

    it('TEST: Returns null for non-existent draft', async () => {
      mockInvoke.mockResolvedValueOnce({ draft: null });

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.get('non-existent-id');

      expect(result.draft).toBeNull();
    });

    it('TEST: Returns null for cross-tenant access attempt (DB-006)', async () => {
      // Handler should return null (not error) for cross-tenant access
      mockInvoke.mockResolvedValueOnce({ draft: null });

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.get('other-store-draft-id');

      expect(result.draft).toBeNull();
    });
  });
});

// ============================================================================
// Tests: drafts.getActive()
// ============================================================================

describe('Transport drafts.getActive()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('IPC Channel Invocation', () => {
    it("TEST: Invokes correct IPC channel 'drafts:get'", async () => {
      mockInvoke.mockResolvedValueOnce({ draft: mockDraftResponse.draft });

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.getActive(SHIFT_ID);

      expect(mockInvoke).toHaveBeenCalledWith('drafts:get', expect.any(Object));
    });

    it('TEST: Passes shift_id as parameter', async () => {
      mockInvoke.mockResolvedValueOnce({ draft: mockDraftResponse.draft });

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.getActive(SHIFT_ID);

      expect(mockInvoke).toHaveBeenCalledWith('drafts:get', {
        shift_id: SHIFT_ID,
      });
    });
  });

  describe('Response Handling', () => {
    it('TEST: Returns active draft for shift', async () => {
      mockInvoke.mockResolvedValueOnce({ draft: mockDraftResponse.draft });

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.getActive(SHIFT_ID);

      expect(result.draft?.status).toBe('IN_PROGRESS');
    });

    it('TEST: Returns null when no active draft exists', async () => {
      mockInvoke.mockResolvedValueOnce({ draft: null });

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.getActive(SHIFT_ID);

      expect(result.draft).toBeNull();
    });
  });
});

// ============================================================================
// Tests: drafts.update()
// ============================================================================

describe('Transport drafts.update()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('IPC Channel Invocation', () => {
    it("TEST: Invokes correct IPC channel 'drafts:update'", async () => {
      mockInvoke.mockResolvedValueOnce(mockDraftWithLottery);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.update(DRAFT_ID, { closing_cash: 100 }, 1);

      expect(mockInvoke).toHaveBeenCalledWith('drafts:update', expect.any(Object));
    });

    it('TEST: Passes draft_id, payload, and version as parameters', async () => {
      mockInvoke.mockResolvedValueOnce(mockDraftWithLottery);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const payload = { closing_cash: 250.5 };
      await ipc.drafts.update(DRAFT_ID, payload, 1);

      expect(mockInvoke).toHaveBeenCalledWith('drafts:update', {
        draft_id: DRAFT_ID,
        payload: { closing_cash: 250.5 },
        version: 1,
      });
    });

    it('TEST: Uses correct parameter names (draft_id, payload, version)', async () => {
      mockInvoke.mockResolvedValueOnce(mockDraftWithLottery);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.update(DRAFT_ID, { closing_cash: 100 }, 1);

      const invokeCall = mockInvoke.mock.calls[0];
      const params = invokeCall[1];

      expect(params).toHaveProperty('draft_id');
      expect(params).toHaveProperty('payload');
      expect(params).toHaveProperty('version');
      expect(params).not.toHaveProperty('draftId');
    });
  });

  describe('Response Handling', () => {
    it('TEST: Returns updated draft on success', async () => {
      const updatedDraft = {
        draft: {
          ...mockDraftResponse.draft,
          payload: { closing_cash: 250.5 },
          version: 2,
        },
      };
      mockInvoke.mockResolvedValueOnce(updatedDraft);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.update(DRAFT_ID, { closing_cash: 250.5 }, 1);

      // Type guard: check if it's a DraftResponse (has 'draft' property)
      if ('draft' in result && result.draft) {
        expect(result.draft.version).toBe(2);
        expect(result.draft.payload.closing_cash).toBe(250.5);
      } else {
        throw new Error('Expected DraftResponse but got VersionConflictResponse');
      }
    });

    it('TEST: Returns VERSION_CONFLICT error on stale version', async () => {
      mockInvoke.mockResolvedValueOnce(mockVersionConflictResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.update(DRAFT_ID, { closing_cash: 100 }, 1);

      expect(result).toHaveProperty('error', 'VERSION_CONFLICT');
      expect(result).toHaveProperty('current_version', 2);
      expect(result).toHaveProperty('expected_version', 1);
    });

    it('TEST: Propagates NOT_FOUND error', async () => {
      const { IPCError } = await import('../../../src/renderer/lib/api/ipc-client');
      const error = new IPCError('NOT_FOUND', 'Draft not found');
      mockInvoke.mockRejectedValueOnce(error);

      const { ipc } = await import('../../../src/renderer/lib/transport');

      await expect(ipc.drafts.update(DRAFT_ID, {}, 1)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('TEST: Propagates CONFLICT error for finalized draft', async () => {
      const { IPCError } = await import('../../../src/renderer/lib/api/ipc-client');
      const error = new IPCError('CONFLICT', 'Cannot update draft in current status');
      mockInvoke.mockRejectedValueOnce(error);

      const { ipc } = await import('../../../src/renderer/lib/transport');

      await expect(ipc.drafts.update(DRAFT_ID, {}, 1)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  describe('Payload Handling', () => {
    it('TEST: Handles empty partial payload', async () => {
      mockInvoke.mockResolvedValueOnce(mockDraftResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.update(DRAFT_ID, {}, 1);

      expect(mockInvoke).toHaveBeenCalledWith('drafts:update', {
        draft_id: DRAFT_ID,
        payload: {},
        version: 1,
      });
    });

    it('TEST: Handles complex nested payload', async () => {
      const complexPayload = {
        lottery: {
          bins_scans: [
            {
              pack_id: PACK_ID,
              bin_id: BIN_ID,
              closing_serial: '025',
              is_sold_out: false,
              scanned_at: '2026-02-21T10:00:00.000Z',
            },
          ],
          totals: {
            tickets_sold: 25,
            sales_amount: 25.0,
          },
          entry_method: 'SCAN' as const,
        },
        closing_cash: 500.0,
      };

      mockInvoke.mockResolvedValueOnce(mockDraftWithLottery);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.update(DRAFT_ID, complexPayload, 1);

      expect(mockInvoke).toHaveBeenCalledWith('drafts:update', {
        draft_id: DRAFT_ID,
        payload: complexPayload,
        version: 1,
      });
    });
  });
});

// ============================================================================
// Tests: drafts.updateLottery()
// ============================================================================

describe('Transport drafts.updateLottery()', () => {
  const lotteryData = {
    bins_scans: [
      {
        pack_id: PACK_ID,
        bin_id: BIN_ID,
        closing_serial: '045',
        is_sold_out: false,
        scanned_at: '2026-02-21T10:00:00.000Z',
      },
    ],
    totals: {
      tickets_sold: 45,
      sales_amount: 45.0,
    },
    entry_method: 'SCAN' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('IPC Channel Invocation', () => {
    it("TEST: Invokes correct IPC channel 'drafts:updateLottery'", async () => {
      mockInvoke.mockResolvedValueOnce(mockDraftWithLottery);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.updateLottery(DRAFT_ID, lotteryData, 1);

      expect(mockInvoke).toHaveBeenCalledWith('drafts:updateLottery', expect.any(Object));
    });

    it('TEST: Passes draft_id, lottery_data, and version as parameters', async () => {
      mockInvoke.mockResolvedValueOnce(mockDraftWithLottery);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.updateLottery(DRAFT_ID, lotteryData, 1);

      expect(mockInvoke).toHaveBeenCalledWith('drafts:updateLottery', {
        draft_id: DRAFT_ID,
        lottery_data: lotteryData,
        version: 1,
      });
    });

    it('TEST: Uses correct parameter names (draft_id, lottery_data, version)', async () => {
      mockInvoke.mockResolvedValueOnce(mockDraftWithLottery);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.updateLottery(DRAFT_ID, lotteryData, 1);

      const invokeCall = mockInvoke.mock.calls[0];
      const params = invokeCall[1];

      expect(params).toHaveProperty('draft_id');
      expect(params).toHaveProperty('lottery_data');
      expect(params).toHaveProperty('version');
      expect(params).not.toHaveProperty('lotteryData');
    });
  });

  describe('Response Handling', () => {
    it('TEST: Returns updated draft with lottery data', async () => {
      mockInvoke.mockResolvedValueOnce(mockDraftWithLottery);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.updateLottery(DRAFT_ID, lotteryData, 1);

      // Type guard: check if it's a DraftResponse (has 'draft' property)
      if ('draft' in result && result.draft) {
        expect(result.draft.payload.lottery).toBeDefined();
        expect(result.draft.payload.lottery?.totals.tickets_sold).toBe(45);
      } else {
        throw new Error('Expected DraftResponse but got VersionConflictResponse');
      }
    });

    it('TEST: Handles VERSION_CONFLICT response', async () => {
      mockInvoke.mockResolvedValueOnce(mockVersionConflictResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.updateLottery(DRAFT_ID, lotteryData, 1);

      expect(result).toHaveProperty('error', 'VERSION_CONFLICT');
    });

    it('TEST: Propagates VALIDATION_ERROR for invalid lottery data', async () => {
      const { IPCError } = await import('../../../src/renderer/lib/api/ipc-client');
      const error = new IPCError('VALIDATION_ERROR', 'Invalid closing serial format');
      mockInvoke.mockRejectedValueOnce(error);

      const { ipc } = await import('../../../src/renderer/lib/transport');

      await expect(ipc.drafts.updateLottery(DRAFT_ID, lotteryData, 1)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });
  });

  describe('Lottery Data Handling', () => {
    it('TEST: Handles multiple bin scans', async () => {
      const multipleScans = {
        ...lotteryData,
        bins_scans: [
          {
            pack_id: 'pack-1',
            bin_id: 'bin-1',
            closing_serial: '045',
            is_sold_out: false,
            scanned_at: '2026-02-21T10:00:00.000Z',
          },
          {
            pack_id: 'pack-2',
            bin_id: 'bin-2',
            closing_serial: '060',
            is_sold_out: true,
            scanned_at: '2026-02-21T10:01:00.000Z',
          },
        ],
        totals: {
          tickets_sold: 105,
          sales_amount: 105.0,
        },
      };

      mockInvoke.mockResolvedValueOnce(mockDraftWithLottery);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.updateLottery(DRAFT_ID, multipleScans, 1);

      expect(mockInvoke).toHaveBeenCalledWith('drafts:updateLottery', {
        draft_id: DRAFT_ID,
        lottery_data: multipleScans,
        version: 1,
      });
    });

    it('TEST: Handles MANUAL entry method with authorized_by', async () => {
      const manualEntry = {
        ...lotteryData,
        entry_method: 'MANUAL' as const,
        authorized_by: USER_ID,
      };

      mockInvoke.mockResolvedValueOnce(mockDraftWithLottery);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.updateLottery(DRAFT_ID, manualEntry, 1);

      const invokeCall = mockInvoke.mock.calls[0];
      const params = invokeCall[1];

      expect(params.lottery_data.entry_method).toBe('MANUAL');
      expect(params.lottery_data.authorized_by).toBe(USER_ID);
    });

    it('TEST: Handles empty bins_scans array', async () => {
      const emptyScans = {
        bins_scans: [],
        totals: {
          tickets_sold: 0,
          sales_amount: 0,
        },
        entry_method: 'SCAN' as const,
      };

      mockInvoke.mockResolvedValueOnce(mockDraftResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.updateLottery(DRAFT_ID, emptyScans, 1);

      expect(mockInvoke).toHaveBeenCalledWith('drafts:updateLottery', {
        draft_id: DRAFT_ID,
        lottery_data: emptyScans,
        version: 1,
      });
    });
  });
});

// ============================================================================
// Tests: drafts.updateStepState()
// ============================================================================

describe('Transport drafts.updateStepState()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('IPC Channel Invocation', () => {
    it("TEST: Invokes correct IPC channel 'drafts:updateStepState'", async () => {
      mockInvoke.mockResolvedValueOnce(mockDraftWithLottery);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.updateStepState(DRAFT_ID, 'LOTTERY');

      expect(mockInvoke).toHaveBeenCalledWith('drafts:updateStepState', expect.any(Object));
    });

    it('TEST: Passes draft_id and step_state as parameters', async () => {
      mockInvoke.mockResolvedValueOnce(mockDraftWithLottery);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.updateStepState(DRAFT_ID, 'REPORTS');

      expect(mockInvoke).toHaveBeenCalledWith('drafts:updateStepState', {
        draft_id: DRAFT_ID,
        step_state: 'REPORTS',
      });
    });
  });

  describe('Step State Values', () => {
    it('TEST: Handles LOTTERY step state', async () => {
      mockInvoke.mockResolvedValueOnce({
        draft: { ...mockDraftResponse.draft, step_state: 'LOTTERY' },
      });

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.updateStepState(DRAFT_ID, 'LOTTERY');

      expect(mockInvoke).toHaveBeenCalledWith('drafts:updateStepState', {
        draft_id: DRAFT_ID,
        step_state: 'LOTTERY',
      });
      expect(result.draft.step_state).toBe('LOTTERY');
    });

    it('TEST: Handles REPORTS step state', async () => {
      mockInvoke.mockResolvedValueOnce({
        draft: { ...mockDraftResponse.draft, step_state: 'REPORTS' },
      });

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.updateStepState(DRAFT_ID, 'REPORTS');

      expect(result.draft.step_state).toBe('REPORTS');
    });

    it('TEST: Handles REVIEW step state', async () => {
      mockInvoke.mockResolvedValueOnce({
        draft: { ...mockDraftResponse.draft, step_state: 'REVIEW' },
      });

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.updateStepState(DRAFT_ID, 'REVIEW');

      expect(result.draft.step_state).toBe('REVIEW');
    });

    it('TEST: Handles null step state', async () => {
      mockInvoke.mockResolvedValueOnce({
        draft: { ...mockDraftResponse.draft, step_state: null },
      });

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.updateStepState(DRAFT_ID, null);

      expect(mockInvoke).toHaveBeenCalledWith('drafts:updateStepState', {
        draft_id: DRAFT_ID,
        step_state: null,
      });
      expect(result.draft.step_state).toBeNull();
    });
  });
});

// ============================================================================
// Tests: drafts.finalize()
// ============================================================================

describe('Transport drafts.finalize()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('IPC Channel Invocation', () => {
    it("TEST: Invokes correct IPC channel 'drafts:finalize'", async () => {
      mockInvoke.mockResolvedValueOnce(mockFinalizeResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.finalize(DRAFT_ID, 500.0);

      expect(mockInvoke).toHaveBeenCalledWith('drafts:finalize', expect.any(Object));
    });

    it('TEST: Passes draft_id and closing_cash as parameters', async () => {
      mockInvoke.mockResolvedValueOnce(mockFinalizeResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.finalize(DRAFT_ID, 500.0);

      expect(mockInvoke).toHaveBeenCalledWith('drafts:finalize', {
        draft_id: DRAFT_ID,
        closing_cash: 500.0,
      });
    });

    it('TEST: Uses correct parameter names (draft_id, closing_cash)', async () => {
      mockInvoke.mockResolvedValueOnce(mockFinalizeResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.finalize(DRAFT_ID, 250.5);

      const invokeCall = mockInvoke.mock.calls[0];
      const params = invokeCall[1];

      expect(params).toHaveProperty('draft_id');
      expect(params).toHaveProperty('closing_cash');
      expect(params).not.toHaveProperty('draftId');
      expect(params).not.toHaveProperty('closingCash');
    });
  });

  describe('Response Handling', () => {
    it('TEST: Returns FinalizeResponse on success', async () => {
      mockInvoke.mockResolvedValueOnce(mockFinalizeResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.finalize(DRAFT_ID, 500.0);

      expect(result.success).toBe(true);
      expect(result.closed_at).toBeDefined();
    });

    it('TEST: Includes lottery_result for DAY_CLOSE drafts', async () => {
      mockInvoke.mockResolvedValueOnce(mockFinalizeResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.finalize(DRAFT_ID, 500.0);

      expect(result.lottery_result).toBeDefined();
      expect(result.lottery_result?.closings_created).toBe(5);
      expect(result.lottery_result?.lottery_total).toBe(225.0);
      expect(result.lottery_result?.next_day).toBeDefined();
    });

    it('TEST: Includes shift_result', async () => {
      mockInvoke.mockResolvedValueOnce(mockFinalizeResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.finalize(DRAFT_ID, 500.0);

      expect(result.shift_result).toBeDefined();
      expect(result.shift_result?.shift_id).toBe(SHIFT_ID);
      expect(result.shift_result?.closing_cash).toBe(500.0);
    });

    it('TEST: Handles SHIFT_CLOSE without lottery_result', async () => {
      const shiftOnlyResponse = {
        ...mockFinalizeResponse,
        lottery_result: undefined,
      };
      mockInvoke.mockResolvedValueOnce(shiftOnlyResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.finalize(DRAFT_ID, 500.0);

      expect(result.success).toBe(true);
      expect(result.lottery_result).toBeUndefined();
      expect(result.shift_result).toBeDefined();
    });

    it('TEST: Propagates NOT_FOUND error', async () => {
      const { IPCError } = await import('../../../src/renderer/lib/api/ipc-client');
      const error = new IPCError('NOT_FOUND', 'Draft not found');
      mockInvoke.mockRejectedValueOnce(error);

      const { ipc } = await import('../../../src/renderer/lib/transport');

      await expect(ipc.drafts.finalize(DRAFT_ID, 500.0)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('TEST: Propagates CONFLICT error for expired draft', async () => {
      const { IPCError } = await import('../../../src/renderer/lib/api/ipc-client');
      const error = new IPCError('CONFLICT', 'Draft has expired');
      mockInvoke.mockRejectedValueOnce(error);

      const { ipc } = await import('../../../src/renderer/lib/transport');

      await expect(ipc.drafts.finalize(DRAFT_ID, 500.0)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('TEST: Propagates ALREADY_CLOSED error', async () => {
      const { IPCError } = await import('../../../src/renderer/lib/api/ipc-client');
      const error = new IPCError('ALREADY_CLOSED', 'Shift is already closed');
      mockInvoke.mockRejectedValueOnce(error);

      const { ipc } = await import('../../../src/renderer/lib/transport');

      await expect(ipc.drafts.finalize(DRAFT_ID, 500.0)).rejects.toMatchObject({
        code: 'ALREADY_CLOSED',
      });
    });

    it('TEST: Handles idempotent finalization (already finalized)', async () => {
      const alreadyFinalizedResponse = {
        success: true,
        closed_at: '2026-02-21T15:00:00.000Z',
      };
      mockInvoke.mockResolvedValueOnce(alreadyFinalizedResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.finalize(DRAFT_ID, 500.0);

      expect(result.success).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('TEST: Handles zero closing_cash', async () => {
      mockInvoke.mockResolvedValueOnce({
        ...mockFinalizeResponse,
        shift_result: {
          ...mockFinalizeResponse.shift_result,
          closing_cash: 0,
        },
      });

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.finalize(DRAFT_ID, 0);

      expect(mockInvoke).toHaveBeenCalledWith('drafts:finalize', {
        draft_id: DRAFT_ID,
        closing_cash: 0,
      });
      expect(result.shift_result?.closing_cash).toBe(0);
    });

    it('TEST: Handles decimal closing_cash values', async () => {
      mockInvoke.mockResolvedValueOnce({
        ...mockFinalizeResponse,
        shift_result: {
          ...mockFinalizeResponse.shift_result,
          closing_cash: 123.45,
        },
      });

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.finalize(DRAFT_ID, 123.45);

      expect(result.shift_result?.closing_cash).toBe(123.45);
    });

    it('TEST: Handles large closing_cash values', async () => {
      const largeCash = 999999.99;
      mockInvoke.mockResolvedValueOnce({
        ...mockFinalizeResponse,
        shift_result: {
          ...mockFinalizeResponse.shift_result,
          closing_cash: largeCash,
        },
      });

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.finalize(DRAFT_ID, largeCash);

      expect(result.shift_result?.closing_cash).toBe(largeCash);
    });

    it('TEST: Network/IPC timeout error propagates', async () => {
      const timeoutError = new Error('IPC call timed out');
      mockInvoke.mockRejectedValueOnce(timeoutError);

      const { ipc } = await import('../../../src/renderer/lib/transport');

      await expect(ipc.drafts.finalize(DRAFT_ID, 500.0)).rejects.toThrow('IPC call timed out');
    });
  });
});

// ============================================================================
// Tests: drafts.expire()
// ============================================================================

describe('Transport drafts.expire()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('IPC Channel Invocation', () => {
    it("TEST: Invokes correct IPC channel 'drafts:expire'", async () => {
      const expiredDraft = {
        draft: { ...mockDraftResponse.draft, status: 'EXPIRED' },
      };
      mockInvoke.mockResolvedValueOnce(expiredDraft);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.expire(DRAFT_ID);

      expect(mockInvoke).toHaveBeenCalledWith('drafts:expire', expect.any(Object));
    });

    it('TEST: Passes draft_id as parameter', async () => {
      const expiredDraft = {
        draft: { ...mockDraftResponse.draft, status: 'EXPIRED' },
      };
      mockInvoke.mockResolvedValueOnce(expiredDraft);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.drafts.expire(DRAFT_ID);

      expect(mockInvoke).toHaveBeenCalledWith('drafts:expire', {
        draft_id: DRAFT_ID,
      });
    });
  });

  describe('Response Handling', () => {
    it('TEST: Returns expired draft', async () => {
      const expiredDraft = {
        draft: { ...mockDraftResponse.draft, status: 'EXPIRED' as const },
      };
      mockInvoke.mockResolvedValueOnce(expiredDraft);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.expire(DRAFT_ID);

      expect(result.draft.status).toBe('EXPIRED');
    });

    it('TEST: Handles already expired draft (idempotent)', async () => {
      const expiredDraft = {
        draft: { ...mockDraftResponse.draft, status: 'EXPIRED' as const },
      };
      mockInvoke.mockResolvedValueOnce(expiredDraft);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.drafts.expire(DRAFT_ID);

      expect(result.draft.status).toBe('EXPIRED');
    });

    it('TEST: Propagates NOT_FOUND error', async () => {
      const { IPCError } = await import('../../../src/renderer/lib/api/ipc-client');
      const error = new IPCError('NOT_FOUND', 'Draft not found');
      mockInvoke.mockRejectedValueOnce(error);

      const { ipc } = await import('../../../src/renderer/lib/transport');

      await expect(ipc.drafts.expire(DRAFT_ID)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});

// ============================================================================
// Type Safety and Interface Compliance
// ============================================================================

describe('Transport drafts Type Safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('TEST: CloseDraft interface has all required fields', async () => {
    mockInvoke.mockResolvedValueOnce(mockDraftResponse);

    const { ipc } = await import('../../../src/renderer/lib/transport');
    const result = await ipc.drafts.create(SHIFT_ID, 'DAY_CLOSE');

    // Verify all CloseDraft fields are present
    const draft = result.draft;
    expect(typeof draft.draft_id).toBe('string');
    expect(typeof draft.store_id).toBe('string');
    expect(typeof draft.shift_id).toBe('string');
    expect(typeof draft.business_date).toBe('string');
    expect(['DAY_CLOSE', 'SHIFT_CLOSE']).toContain(draft.draft_type);
    expect(['IN_PROGRESS', 'FINALIZING', 'FINALIZED', 'EXPIRED']).toContain(draft.status);
    expect(['LOTTERY', 'REPORTS', 'REVIEW', null]).toContain(draft.step_state);
    expect(typeof draft.payload).toBe('object');
    expect(typeof draft.version).toBe('number');
    expect(typeof draft.created_at).toBe('string');
    expect(typeof draft.updated_at).toBe('string');
    expect(typeof draft.created_by).toBe('string');
  });

  it('TEST: DraftPayload interface supports all optional fields', async () => {
    const fullPayload = {
      draft: {
        ...mockDraftResponse.draft,
        payload: {
          lottery: {
            bins_scans: [],
            totals: { tickets_sold: 0, sales_amount: 0 },
            entry_method: 'SCAN' as const,
          },
          reports: {
            lottery_reports: {
              instantSales: 100,
              instantCashes: 50,
              onlineSales: 75,
              onlineCashes: 25,
            },
            gaming_reports: {
              netTerminalIncome: 200,
              plays: 1000,
              payouts: 800,
            },
            vendor_invoices: [{ vendor_name: 'Vendor A', amount: 150 }],
            cash_payouts: {
              lotteryWinners: 500,
              moneyOrders: 100,
              checkCashing: 50,
            },
          },
          closing_cash: 500.0,
        },
      },
    };
    mockInvoke.mockResolvedValueOnce(fullPayload);

    const { ipc } = await import('../../../src/renderer/lib/transport');
    const result = await ipc.drafts.get(DRAFT_ID);

    // Verify payload structure
    expect(result.draft?.payload.lottery).toBeDefined();
    expect(result.draft?.payload.reports).toBeDefined();
    expect(result.draft?.payload.closing_cash).toBe(500.0);
  });

  it('TEST: FinalizeResponse interface has all required fields', async () => {
    mockInvoke.mockResolvedValueOnce(mockFinalizeResponse);

    const { ipc } = await import('../../../src/renderer/lib/transport');
    const result = await ipc.drafts.finalize(DRAFT_ID, 500.0);

    expect(typeof result.success).toBe('boolean');
    expect(typeof result.closed_at).toBe('string');

    if (result.lottery_result) {
      expect(typeof result.lottery_result.closings_created).toBe('number');
      expect(typeof result.lottery_result.lottery_total).toBe('number');
      expect(typeof result.lottery_result.next_day.day_id).toBe('string');
      expect(typeof result.lottery_result.next_day.business_date).toBe('string');
      expect(typeof result.lottery_result.next_day.status).toBe('string');
    }

    if (result.shift_result) {
      expect(typeof result.shift_result.shift_id).toBe('string');
      expect(typeof result.shift_result.shift_number).toBe('number');
      expect(typeof result.shift_result.business_date).toBe('string');
      expect(typeof result.shift_result.closing_cash).toBe('number');
    }
  });

  it('TEST: VersionConflictResponse has correct structure', async () => {
    mockInvoke.mockResolvedValueOnce(mockVersionConflictResponse);

    const { ipc } = await import('../../../src/renderer/lib/transport');
    const result = await ipc.drafts.update(DRAFT_ID, {}, 1);

    // Type guard to check if it's a version conflict
    if ('error' in result && result.error === 'VERSION_CONFLICT') {
      expect(result.error).toBe('VERSION_CONFLICT');
      expect(typeof result.message).toBe('string');
      expect(typeof result.current_version).toBe('number');
      expect(typeof result.expected_version).toBe('number');
    }
  });
});
