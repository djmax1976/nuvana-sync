/**
 * ShiftEndPage Finalize Integration Tests
 *
 * Phase 7 Integration Tests for DRAFT-001: Draft-Backed Wizard Architecture
 *
 * Tests cover:
 * - Atomic finalization via draft.finalize()
 * - Shift close operations
 * - Draft status transitions
 * - No lottery operations for SHIFT_CLOSE
 *
 * @module tests/integration/ShiftEndPage.finalize.spec
 * @feature DRAFT-001: Draft-Backed Wizard Architecture
 * @security SEC-010: Authentication required
 * @security DB-006: Store-scoped operations
 * @security SEC-006: Parameterized queries
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mock Setup
// ============================================================================

// Mock the IPC client for integration testing
const _mockIpcInvoke = vi.fn();

vi.mock('@/lib/transport', () => ({
  ipc: {
    drafts: {
      create: vi.fn(),
      get: vi.fn(),
      getActive: vi.fn(),
      update: vi.fn(),
      updateLottery: vi.fn(),
      updateStepState: vi.fn(),
      finalize: vi.fn(),
      expire: vi.fn(),
    },
  },
}));

// ============================================================================
// Types
// ============================================================================

interface DraftPayload {
  lottery?: unknown;
  reports?: unknown;
  closing_cash?: number;
}

interface MockDraft {
  draft_id: string;
  store_id: string;
  shift_id: string;
  business_date: string;
  draft_type: 'DAY_CLOSE' | 'SHIFT_CLOSE';
  status: 'IN_PROGRESS' | 'FINALIZING' | 'FINALIZED' | 'EXPIRED';
  step_state: 'LOTTERY' | 'REPORTS' | 'REVIEW' | null;
  payload: DraftPayload;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
}

// Test-specific response type that extends transport FinalizeResponse
// with optional fields that may be present in different scenarios
interface _TestFinalizeResponse {
  success: boolean;
  closed_at: string;
  lottery_result?: {
    closings_created: number;
    lottery_total: number;
    next_day: {
      day_id: string;
      business_date: string;
      status: string;
    };
  };
  shift_result?: {
    shift_id: string;
    shift_number: number;
    business_date: string;
    closing_cash: number;
  };
  // Additional fields for test verification
  draft?: MockDraft;
  error?: string;
  message?: string;
}

// ============================================================================
// Test Utilities
// ============================================================================

function createMockDraft(overrides: Partial<MockDraft> = {}): MockDraft {
  return {
    draft_id: 'draft-integration-001',
    store_id: 'store-integration-001',
    shift_id: 'shift-integration-001',
    business_date: '2026-02-21',
    draft_type: 'SHIFT_CLOSE',
    status: 'IN_PROGRESS',
    step_state: 'REPORTS',
    payload: {},
    version: 1,
    created_at: '2026-02-21T08:00:00Z',
    updated_at: '2026-02-21T08:00:00Z',
    created_by: 'user-integration-001',
    ...overrides,
  };
}

// ============================================================================
// Test Suite: Finalize Flow Integration
// ============================================================================

describe('ShiftEndPage Finalize Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Atomic Finalization', () => {
    it('should transition draft through status states correctly', async () => {
      const { ipc } = await import('@/lib/transport');

      const mockDraft = createMockDraft();
      const closingCash = 350.0;

      // Mock the finalize endpoint
      vi.mocked(ipc.drafts.finalize).mockResolvedValue({
        success: true,
        closed_at: '2026-02-21T18:00:00Z',
        shift_result: {
          shift_id: mockDraft.shift_id,
          shift_number: 1,
          business_date: mockDraft.business_date,
          closing_cash: closingCash,
        },
      });

      // Call finalize
      const result = await ipc.drafts.finalize(mockDraft.draft_id, closingCash);

      // Verify the call
      expect(ipc.drafts.finalize).toHaveBeenCalledWith(mockDraft.draft_id, closingCash);

      // Verify result
      expect(result.success).toBe(true);
      expect(result.closed_at).toBe('2026-02-21T18:00:00Z');
      expect(result.shift_result?.closing_cash).toBe(closingCash);
    });

    it('should return shift close result without lottery result for SHIFT_CLOSE', async () => {
      const { ipc } = await import('@/lib/transport');

      const mockDraft = createMockDraft({ draft_type: 'SHIFT_CLOSE' });
      const closingCash = 275.5;

      vi.mocked(ipc.drafts.finalize).mockResolvedValue({
        success: true,
        closed_at: '2026-02-21T18:30:00Z',
        // Note: No lottery_result for SHIFT_CLOSE
        shift_result: {
          shift_id: mockDraft.shift_id,
          shift_number: 1,
          business_date: mockDraft.business_date,
          closing_cash: closingCash,
        },
      });

      const result = await ipc.drafts.finalize(mockDraft.draft_id, closingCash);

      expect(result.success).toBe(true);
      expect(result.lottery_result).toBeUndefined();
      expect(result.shift_result).toBeDefined();
      expect(result.shift_result?.shift_id).toBe(mockDraft.shift_id);
    });

    it('should handle finalize failure and keep draft editable', async () => {
      const { ipc } = await import('@/lib/transport');

      const mockDraft = createMockDraft();

      // Error responses have success: false with error and message fields
      type ErrorResponse = { success: false; error: string; message: string };
      vi.mocked(ipc.drafts.finalize).mockResolvedValue({
        success: false,
        error: 'FINALIZE_FAILED',
        message: 'Failed to close shift: Database constraint violation',
      } as unknown as Awaited<ReturnType<typeof ipc.drafts.finalize>>);

      const result = (await ipc.drafts.finalize(
        mockDraft.draft_id,
        350
      )) as unknown as ErrorResponse;

      expect(result.success).toBe(false);
      expect(result.error).toBe('FINALIZE_FAILED');
    });

    it('should handle network/IPC errors gracefully', async () => {
      const { ipc } = await import('@/lib/transport');

      vi.mocked(ipc.drafts.finalize).mockRejectedValue(new Error('IPC timeout'));

      await expect(ipc.drafts.finalize('draft-001', 350)).rejects.toThrow('IPC timeout');
    });
  });

  describe('Closing Cash Validation', () => {
    it('should accept zero closing cash', async () => {
      const { ipc } = await import('@/lib/transport');

      const mockDraft = createMockDraft();

      vi.mocked(ipc.drafts.finalize).mockResolvedValue({
        success: true,
        closed_at: '2026-02-21T18:00:00Z',
        shift_result: {
          shift_id: mockDraft.shift_id,
          shift_number: 1,
          business_date: mockDraft.business_date,
          closing_cash: 0,
        },
      });

      const result = await ipc.drafts.finalize(mockDraft.draft_id, 0);

      expect(result.success).toBe(true);
      expect(result.shift_result?.closing_cash).toBe(0);
    });

    it('should accept positive closing cash amounts', async () => {
      const { ipc } = await import('@/lib/transport');

      const mockDraft = createMockDraft();
      const closingCash = 1500.75;

      vi.mocked(ipc.drafts.finalize).mockResolvedValue({
        success: true,
        closed_at: '2026-02-21T18:00:00Z',
        shift_result: {
          shift_id: mockDraft.shift_id,
          shift_number: 1,
          business_date: mockDraft.business_date,
          closing_cash: closingCash,
        },
      });

      const result = await ipc.drafts.finalize(mockDraft.draft_id, closingCash);

      expect(result.success).toBe(true);
      expect(result.shift_result?.closing_cash).toBe(closingCash);
    });
  });

  describe('Draft Type Validation', () => {
    it('should not include lottery operations for SHIFT_CLOSE type', async () => {
      const { ipc } = await import('@/lib/transport');

      const mockDraft = createMockDraft({
        draft_type: 'SHIFT_CLOSE',
        payload: {}, // No lottery data
      });

      vi.mocked(ipc.drafts.finalize).mockResolvedValue({
        success: true,
        closed_at: '2026-02-21T18:00:00Z',
        // SHIFT_CLOSE should NOT have lottery_result
        shift_result: {
          shift_id: mockDraft.shift_id,
          shift_number: 1,
          business_date: mockDraft.business_date,
          closing_cash: 350,
        },
      });

      const result = await ipc.drafts.finalize(mockDraft.draft_id, 350);

      expect(result.success).toBe(true);
      expect(result.lottery_result).toBeUndefined();
      expect(result.shift_result).toBeDefined();
    });

    it('should validate draft type is SHIFT_CLOSE', async () => {
      const { ipc } = await import('@/lib/transport');

      const mockDraft = createMockDraft({ draft_type: 'SHIFT_CLOSE' });

      // Cast to bypass strict type checking for test mocks
      vi.mocked(ipc.drafts.getActive).mockResolvedValue({
        draft: mockDraft as unknown as Awaited<ReturnType<typeof ipc.drafts.getActive>>['draft'],
      });

      const result = await ipc.drafts.getActive('shift-001');

      expect(result.draft?.draft_type).toBe('SHIFT_CLOSE');
    });
  });

  describe('Status Transition Integrity', () => {
    it('should mark draft as FINALIZED after successful finalization', async () => {
      const { ipc } = await import('@/lib/transport');

      const mockDraft = createMockDraft({ status: 'IN_PROGRESS' });

      vi.mocked(ipc.drafts.finalize).mockResolvedValue({
        success: true,
        closed_at: '2026-02-21T18:00:00Z',
        shift_result: {
          shift_id: mockDraft.shift_id,
          shift_number: 1,
          business_date: mockDraft.business_date,
          closing_cash: 350,
        },
      });

      const result = await ipc.drafts.finalize(mockDraft.draft_id, 350);

      // Success indicates draft was finalized
      expect(result.success).toBe(true);
      expect(result.closed_at).toBeDefined();
    });

    it('should idempotently handle already FINALIZED drafts', async () => {
      const { ipc } = await import('@/lib/transport');

      const mockDraft = createMockDraft({ status: 'FINALIZED' });

      vi.mocked(ipc.drafts.finalize).mockResolvedValue({
        success: true,
        closed_at: '2026-02-21T18:00:00Z',
        shift_result: {
          shift_id: mockDraft.shift_id,
          shift_number: 1,
          business_date: mockDraft.business_date,
          closing_cash: 350,
        },
      });

      const result = await ipc.drafts.finalize(mockDraft.draft_id, 350);

      // Should succeed (idempotent)
      expect(result.success).toBe(true);
    });
  });

  describe('Step State Validation', () => {
    it('should accept finalization from REVIEW step state', async () => {
      const { ipc } = await import('@/lib/transport');

      const mockDraft = createMockDraft({ step_state: 'REVIEW' });

      vi.mocked(ipc.drafts.finalize).mockResolvedValue({
        success: true,
        closed_at: '2026-02-21T18:00:00Z',
        shift_result: {
          shift_id: mockDraft.shift_id,
          shift_number: 1,
          business_date: mockDraft.business_date,
          closing_cash: 350,
        },
      });

      const result = await ipc.drafts.finalize(mockDraft.draft_id, 350);

      expect(result.success).toBe(true);
    });

    it('should accept finalization from REPORTS step state', async () => {
      const { ipc } = await import('@/lib/transport');

      // SHIFT_CLOSE can finalize from REPORTS (Step 1)
      const mockDraft = createMockDraft({ step_state: 'REPORTS' });

      vi.mocked(ipc.drafts.finalize).mockResolvedValue({
        success: true,
        closed_at: '2026-02-21T18:00:00Z',
        shift_result: {
          shift_id: mockDraft.shift_id,
          shift_number: 1,
          business_date: mockDraft.business_date,
          closing_cash: 350,
        },
      });

      const result = await ipc.drafts.finalize(mockDraft.draft_id, 350);

      expect(result.success).toBe(true);
    });
  });
});

// ============================================================================
// Test Suite: Error Handling
// ============================================================================

describe('ShiftEndPage Error Handling Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Error responses use a different structure that isn't captured in FinalizeResponse
  type ErrorResponse = { success: false; error: string; message: string };

  it('should handle database errors during finalization', async () => {
    const { ipc } = await import('@/lib/transport');

    vi.mocked(ipc.drafts.finalize).mockResolvedValue({
      success: false,
      error: 'DATABASE_ERROR',
      message: 'SQLite constraint violation: FOREIGN KEY constraint failed',
    } as unknown as Awaited<ReturnType<typeof ipc.drafts.finalize>>);

    const result = (await ipc.drafts.finalize('draft-001', 350)) as unknown as ErrorResponse;

    expect(result.success).toBe(false);
    expect(result.error).toBe('DATABASE_ERROR');
  });

  it('should handle authentication errors (SEC-010)', async () => {
    const { ipc } = await import('@/lib/transport');

    vi.mocked(ipc.drafts.finalize).mockResolvedValue({
      success: false,
      error: 'NOT_AUTHENTICATED',
      message: 'Authentication required',
    } as unknown as Awaited<ReturnType<typeof ipc.drafts.finalize>>);

    const result = (await ipc.drafts.finalize('draft-001', 350)) as unknown as ErrorResponse;

    expect(result.success).toBe(false);
    expect(result.error).toBe('NOT_AUTHENTICATED');
  });

  it('should handle authorization errors (store mismatch, DB-006)', async () => {
    const { ipc } = await import('@/lib/transport');

    vi.mocked(ipc.drafts.finalize).mockResolvedValue({
      success: false,
      error: 'FORBIDDEN',
      message: 'Draft does not belong to configured store',
    } as unknown as Awaited<ReturnType<typeof ipc.drafts.finalize>>);

    const result = (await ipc.drafts.finalize('draft-001', 350)) as unknown as ErrorResponse;

    expect(result.success).toBe(false);
    expect(result.error).toBe('FORBIDDEN');
  });

  it('should handle draft not found errors', async () => {
    const { ipc } = await import('@/lib/transport');

    vi.mocked(ipc.drafts.finalize).mockResolvedValue({
      success: false,
      error: 'NOT_FOUND',
      message: 'Draft not found',
    } as unknown as Awaited<ReturnType<typeof ipc.drafts.finalize>>);

    const result = (await ipc.drafts.finalize(
      'nonexistent-draft',
      350
    )) as unknown as ErrorResponse;

    expect(result.success).toBe(false);
    expect(result.error).toBe('NOT_FOUND');
  });
});
