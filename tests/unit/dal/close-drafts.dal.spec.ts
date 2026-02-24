/**
 * Close Drafts DAL Unit Tests
 *
 * Comprehensive tests for the close drafts data access layer.
 * Tests CRUD operations, optimistic locking, status transitions, and payload handling.
 *
 * @module tests/unit/dal/close-drafts.dal.spec
 * @feature DRAFT-001: Draft-Backed Wizard Architecture
 * @security SEC-006: Verifies parameterized queries
 * @security DB-006: Verifies tenant isolation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted() to ensure mock functions are available when vi.mock runs
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
const { mockPrepare, mockTransaction } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn((fn: () => unknown) => () => fn()),
}));

vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

// Mock crypto
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return {
    ...actual,
    randomUUID: vi.fn().mockReturnValue('mock-draft-uuid'),
  };
});

import {
  CloseDraftsDAL,
  type CloseDraft,
  type DraftPayload,
  type DraftStatus,
  type DraftType,
  type StepState,
  VersionConflictError,
  InvalidStatusTransitionError,
  _resetCloseDraftsDAL,
} from '../../../src/main/dal/close-drafts.dal';

describe('CloseDraftsDAL', () => {
  let dal: CloseDraftsDAL;

  // Mock draft entity for testing
  const mockDraft: CloseDraft = {
    draft_id: 'draft-123',
    store_id: 'store-456',
    shift_id: 'shift-789',
    business_date: '2024-01-15',
    draft_type: 'DAY_CLOSE' as DraftType,
    status: 'IN_PROGRESS' as DraftStatus,
    step_state: null as StepState,
    payload: {},
    version: 1,
    created_at: '2024-01-15T08:00:00.000Z',
    updated_at: '2024-01-15T08:00:00.000Z',
    created_by: 'user-001',
  };

  // Mock draft row as stored in database (payload as JSON string)
  const mockDraftRow = {
    ...mockDraft,
    payload: '{}',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    _resetCloseDraftsDAL();
    dal = new CloseDraftsDAL();
  });

  // ==========================================================================
  // T2.1: CREATE TESTS
  // ==========================================================================

  describe('createDraft', () => {
    it('should create draft with all required fields', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockDraftRow) });

      const result = dal.createDraft(
        'store-456',
        'shift-789',
        '2024-01-15',
        'DAY_CLOSE',
        'user-001'
      );

      expect(result).toBeDefined();
      expect(result.draft_id).toBe('draft-123');
      expect(result.store_id).toBe('store-456');
      expect(result.shift_id).toBe('shift-789');
      expect(result.draft_type).toBe('DAY_CLOSE');
      expect(result.status).toBe('IN_PROGRESS');
      expect(result.version).toBe(1);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO close_drafts'));
      // SEC-006: Verify parameterized query (uses ?)
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('?'));
    });

    it('should initialize payload as empty object', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockDraftRow) });

      const result = dal.createDraft(
        'store-456',
        'shift-789',
        '2024-01-15',
        'DAY_CLOSE',
        'user-001'
      );

      expect(result.payload).toEqual({});
    });

    it('should generate UUID for draft_id', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({
        get: vi.fn().mockReturnValue({ ...mockDraftRow, draft_id: 'mock-draft-uuid' }),
      });

      dal.createDraft('store-456', 'shift-789', '2024-01-15', 'DAY_CLOSE', 'user-001');

      // Verify the generated UUID was used
      const callArgs = mockRun.mock.calls[0];
      expect(callArgs[0]).toBe('mock-draft-uuid');
    });

    it('should set version to 1', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockDraftRow) });

      const result = dal.createDraft(
        'store-456',
        'shift-789',
        '2024-01-15',
        'DAY_CLOSE',
        'user-001'
      );

      expect(result.version).toBe(1);
    });

    it('should set created_by from userId parameter', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const draftWithUser = { ...mockDraftRow, created_by: 'custom-user-id' };
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(draftWithUser) });

      const result = dal.createDraft(
        'store-456',
        'shift-789',
        '2024-01-15',
        'DAY_CLOSE',
        'custom-user-id'
      );

      expect(result.created_by).toBe('custom-user-id');
    });

    it('should support both DAY_CLOSE and SHIFT_CLOSE draft types', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      // Test DAY_CLOSE
      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({
        get: vi.fn().mockReturnValue({ ...mockDraftRow, draft_type: 'DAY_CLOSE' }),
      });

      const dayCloseResult = dal.createDraft(
        'store-456',
        'shift-789',
        '2024-01-15',
        'DAY_CLOSE',
        'user-001'
      );
      expect(dayCloseResult.draft_type).toBe('DAY_CLOSE');

      // Test SHIFT_CLOSE
      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({
        get: vi.fn().mockReturnValue({ ...mockDraftRow, draft_type: 'SHIFT_CLOSE' }),
      });

      const shiftCloseResult = dal.createDraft(
        'store-456',
        'shift-789',
        '2024-01-15',
        'SHIFT_CLOSE',
        'user-001'
      );
      expect(shiftCloseResult.draft_type).toBe('SHIFT_CLOSE');
    });

    it('should throw error for invalid draft type', () => {
      expect(() =>
        dal.createDraft(
          'store-456',
          'shift-789',
          '2024-01-15',
          'INVALID_TYPE' as DraftType,
          'user-001'
        )
      ).toThrow('Invalid draft type');
    });

    it('should throw error if created draft cannot be retrieved', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) });

      expect(() =>
        dal.createDraft('store-456', 'shift-789', '2024-01-15', 'DAY_CLOSE', 'user-001')
      ).toThrow('Failed to retrieve created draft');
    });
  });

  // ==========================================================================
  // T2.1: GET DRAFT TESTS
  // ==========================================================================

  describe('getDraft', () => {
    it('should retrieve draft by ID with store validation', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockDraftRow),
      });

      const result = dal.getDraft('store-456', 'draft-123');

      expect(result).toBeDefined();
      expect(result?.draft_id).toBe('draft-123');
      // DB-006: Verify store_id in WHERE clause
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('store_id = ?'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('draft_id = ?'));
    });

    it('should return undefined for non-existent draft', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.getDraft('store-456', 'nonexistent');

      expect(result).toBeUndefined();
    });

    it('should return undefined for draft in different store (DB-006)', () => {
      // Simulating different store by returning undefined (as query filters by store_id)
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.getDraft('other-store', 'draft-123');

      expect(result).toBeUndefined();
    });

    it('should parse JSON payload', () => {
      const payloadJson = JSON.stringify({
        lottery: {
          bins_scans: [],
          totals: { tickets_sold: 10, sales_amount: 100 },
          entry_method: 'SCAN',
        },
      });

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ ...mockDraftRow, payload: payloadJson }),
      });

      const result = dal.getDraft('store-456', 'draft-123');

      expect(result?.payload).toEqual({
        lottery: {
          bins_scans: [],
          totals: { tickets_sold: 10, sales_amount: 100 },
          entry_method: 'SCAN',
        },
      });
    });

    it('should handle null payload gracefully', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ ...mockDraftRow, payload: null }),
      });

      const result = dal.getDraft('store-456', 'draft-123');

      expect(result?.payload).toEqual({});
    });

    it('should handle invalid JSON payload gracefully', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ ...mockDraftRow, payload: 'invalid json{' }),
      });

      const result = dal.getDraft('store-456', 'draft-123');

      expect(result?.payload).toEqual({});
    });
  });

  // ==========================================================================
  // T2.1: GET ACTIVE DRAFT TESTS
  // ==========================================================================

  describe('getActiveDraft', () => {
    it('should find IN_PROGRESS draft for shift', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'IN_PROGRESS' }),
      });

      const result = dal.getActiveDraft('store-456', 'shift-789');

      expect(result).toBeDefined();
      expect(result?.status).toBe('IN_PROGRESS');
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("status IN ('IN_PROGRESS', 'FINALIZING')")
      );
    });

    it('should find FINALIZING draft for shift', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'FINALIZING' }),
      });

      const result = dal.getActiveDraft('store-456', 'shift-789');

      expect(result).toBeDefined();
      expect(result?.status).toBe('FINALIZING');
    });

    it('should return undefined when no active draft exists', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.getActiveDraft('store-456', 'shift-789');

      expect(result).toBeUndefined();
    });

    it('should not return FINALIZED drafts', () => {
      // Query filters for IN_PROGRESS or FINALIZING only
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.getActiveDraft('store-456', 'shift-789');

      expect(mockPrepare).toHaveBeenCalledWith(expect.not.stringContaining('FINALIZED'));
      expect(result).toBeUndefined();
    });

    it('should not return EXPIRED drafts', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.getActiveDraft('store-456', 'shift-789');

      expect(mockPrepare).toHaveBeenCalledWith(expect.not.stringContaining('EXPIRED'));
      expect(result).toBeUndefined();
    });

    it('should be store-scoped (DB-006)', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      dal.getActiveDraft('store-456', 'shift-789');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('store_id = ?'));
    });
  });

  // ==========================================================================
  // T2.1 & T2.6: UPDATE DRAFT TESTS
  // ==========================================================================

  describe('updateDraft', () => {
    it('should update draft payload with deep merge', () => {
      // Initial read
      const initialPayload = { lottery: { entry_method: 'SCAN', bins_scans: [] } };
      mockPrepare
        .mockReturnValueOnce({
          get: vi
            .fn()
            .mockReturnValue({ ...mockDraftRow, payload: JSON.stringify(initialPayload) }),
        })
        .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({
            ...mockDraftRow,
            payload: JSON.stringify({
              lottery: {
                entry_method: 'SCAN',
                bins_scans: [],
                totals: { tickets_sold: 10, sales_amount: 100 },
              },
            }),
            version: 2,
          }),
        });

      const partialPayload: Partial<DraftPayload> = {
        lottery: {
          entry_method: 'SCAN',
          bins_scans: [],
          totals: { tickets_sold: 10, sales_amount: 100 },
        },
      };

      const result = dal.updateDraft('store-456', 'draft-123', partialPayload, 1);

      expect(result).toBeDefined();
      expect(result.version).toBe(2);
      expect(result.payload.lottery?.totals?.tickets_sold).toBe(10);
    });

    it('should increment version on update', () => {
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ ...mockDraftRow, version: 5 }) })
        .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ ...mockDraftRow, version: 6 }) });

      const result = dal.updateDraft('store-456', 'draft-123', { closing_cash: 500 }, 5);

      expect(result.version).toBe(6);
    });

    it('should throw error for non-existent draft', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      expect(() => dal.updateDraft('store-456', 'nonexistent', { closing_cash: 500 }, 1)).toThrow(
        'Draft not found'
      );
    });

    it('should throw error for draft in different store (DB-006)', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      expect(() => dal.updateDraft('other-store', 'draft-123', { closing_cash: 500 }, 1)).toThrow(
        'Draft not found'
      );
    });

    it('should prevent updates to FINALIZED draft', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'FINALIZED' }),
      });

      expect(() => dal.updateDraft('store-456', 'draft-123', { closing_cash: 500 }, 1)).toThrow(
        'Cannot update draft in FINALIZED status'
      );
    });

    it('should prevent updates to EXPIRED draft', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'EXPIRED' }),
      });

      expect(() => dal.updateDraft('store-456', 'draft-123', { closing_cash: 500 }, 1)).toThrow(
        'Cannot update draft in EXPIRED status'
      );
    });

    it('should handle complex nested payload', () => {
      const complexPayload: DraftPayload = {
        lottery: {
          bins_scans: [
            {
              pack_id: 'pack-1',
              bin_id: 'bin-1',
              closing_serial: '050',
              is_sold_out: false,
              scanned_at: '2024-01-15T10:00:00Z',
            },
            {
              pack_id: 'pack-2',
              bin_id: 'bin-2',
              closing_serial: '999',
              is_sold_out: true,
              scanned_at: '2024-01-15T10:05:00Z',
            },
          ],
          totals: { tickets_sold: 100, sales_amount: 500 },
          entry_method: 'SCAN',
          authorized_by: 'manager-001',
        },
        closing_cash: 1234.56,
      };

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockDraftRow) })
        .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({
            ...mockDraftRow,
            payload: JSON.stringify(complexPayload),
            version: 2,
          }),
        });

      const result = dal.updateDraft('store-456', 'draft-123', complexPayload, 1);

      expect(result.payload.lottery?.bins_scans).toHaveLength(2);
      expect(result.payload.lottery?.totals?.sales_amount).toBe(500);
      expect(result.payload.closing_cash).toBe(1234.56);
    });

    it('should handle empty payload stored as {}', () => {
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ ...mockDraftRow, payload: '{}' }) })
        .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
        .mockReturnValueOnce({
          get: vi
            .fn()
            .mockReturnValue({ ...mockDraftRow, payload: '{"closing_cash":100}', version: 2 }),
        });

      const result = dal.updateDraft('store-456', 'draft-123', { closing_cash: 100 }, 1);

      expect(result.payload.closing_cash).toBe(100);
    });
  });

  // ==========================================================================
  // T2.2: OPTIMISTIC LOCKING TESTS
  // ==========================================================================

  describe('Optimistic Locking', () => {
    it('should throw VersionConflictError with correct version on stale update', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ ...mockDraftRow, version: 5 }),
      });

      try {
        dal.updateDraft('store-456', 'draft-123', { closing_cash: 500 }, 3);
        expect.fail('Should have thrown VersionConflictError');
      } catch (error) {
        expect(error).toBeInstanceOf(VersionConflictError);
        expect((error as VersionConflictError).currentVersion).toBe(5);
        expect((error as VersionConflictError).expectedVersion).toBe(3);
        expect((error as VersionConflictError).code).toBe('VERSION_CONFLICT');
      }
    });

    it('should succeed with correct version', () => {
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ ...mockDraftRow, version: 5 }) })
        .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ ...mockDraftRow, version: 6 }) });

      const result = dal.updateDraft('store-456', 'draft-123', { closing_cash: 500 }, 5);

      expect(result.version).toBe(6);
    });

    it('should use version in WHERE clause for concurrent safety', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ ...mockDraftRow, version: 3 }) })
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ ...mockDraftRow, version: 4 }) });

      dal.updateDraft('store-456', 'draft-123', { closing_cash: 500 }, 3);

      // Verify UPDATE includes version in WHERE clause
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('version = ?'));
    });

    it('should handle version 0 edge case', () => {
      // Version 0 should never exist (CHECK constraint version >= 1)
      // But if it somehow exists, the optimistic locking should still work
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ ...mockDraftRow, version: 1 }),
      });

      expect(() => dal.updateDraft('store-456', 'draft-123', { closing_cash: 500 }, 0)).toThrow(
        VersionConflictError
      );
    });

    it('should detect concurrent modification', () => {
      // Simulate: read version 1, another process updates to version 2, our update fails
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ ...mockDraftRow, version: 1 }) })
        .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 0 }) }) // No rows updated
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ ...mockDraftRow, version: 2 }) }); // Re-fetch shows new version

      try {
        dal.updateDraft('store-456', 'draft-123', { closing_cash: 500 }, 1);
        expect.fail('Should have thrown VersionConflictError');
      } catch (error) {
        expect(error).toBeInstanceOf(VersionConflictError);
        expect((error as VersionConflictError).currentVersion).toBe(2);
      }
    });
  });

  // ==========================================================================
  // T2.5: STATUS TRANSITION TESTS
  // ==========================================================================

  describe('Status Transitions', () => {
    describe('beginFinalize (IN_PROGRESS → FINALIZING)', () => {
      it('should transition from IN_PROGRESS to FINALIZING', () => {
        mockPrepare
          .mockReturnValueOnce({
            get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'IN_PROGRESS' }),
          })
          .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
          .mockReturnValueOnce({
            get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'FINALIZING' }),
          });

        const result = dal.beginFinalize('store-456', 'draft-123');

        expect(result.status).toBe('FINALIZING');
      });

      it('should throw for invalid transition from FINALIZED', () => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'FINALIZED' }),
        });

        expect(() => dal.beginFinalize('store-456', 'draft-123')).toThrow(
          InvalidStatusTransitionError
        );
      });
    });

    describe('finalizeDraft (FINALIZING → FINALIZED)', () => {
      it('should transition from FINALIZING to FINALIZED', () => {
        mockPrepare
          .mockReturnValueOnce({
            get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'FINALIZING' }),
          })
          .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
          .mockReturnValueOnce({
            get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'FINALIZED' }),
          });

        const result = dal.finalizeDraft('store-456', 'draft-123');

        expect(result.status).toBe('FINALIZED');
      });

      it('should throw for invalid transition from IN_PROGRESS', () => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'IN_PROGRESS' }),
        });

        expect(() => dal.finalizeDraft('store-456', 'draft-123')).toThrow(
          InvalidStatusTransitionError
        );
      });
    });

    describe('rollbackFinalize (FINALIZING → IN_PROGRESS)', () => {
      it('should transition from FINALIZING to IN_PROGRESS', () => {
        mockPrepare
          .mockReturnValueOnce({
            get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'FINALIZING' }),
          })
          .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
          .mockReturnValueOnce({
            get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'IN_PROGRESS' }),
          });

        const result = dal.rollbackFinalize('store-456', 'draft-123');

        expect(result.status).toBe('IN_PROGRESS');
      });

      it('should throw for invalid transition from FINALIZED', () => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'FINALIZED' }),
        });

        expect(() => dal.rollbackFinalize('store-456', 'draft-123')).toThrow(
          InvalidStatusTransitionError
        );
      });
    });

    describe('expireDraft (any → EXPIRED)', () => {
      it('should expire IN_PROGRESS draft', () => {
        mockPrepare
          .mockReturnValueOnce({
            get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'IN_PROGRESS' }),
          })
          .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
          .mockReturnValueOnce({
            get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'EXPIRED' }),
          });

        const result = dal.expireDraft('store-456', 'draft-123');

        expect(result.status).toBe('EXPIRED');
      });

      it('should expire FINALIZING draft', () => {
        mockPrepare
          .mockReturnValueOnce({
            get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'FINALIZING' }),
          })
          .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
          .mockReturnValueOnce({
            get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'EXPIRED' }),
          });

        const result = dal.expireDraft('store-456', 'draft-123');

        expect(result.status).toBe('EXPIRED');
      });

      it('should expire FINALIZED draft', () => {
        mockPrepare
          .mockReturnValueOnce({
            get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'FINALIZED' }),
          })
          .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
          .mockReturnValueOnce({
            get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'EXPIRED' }),
          });

        const result = dal.expireDraft('store-456', 'draft-123');

        expect(result.status).toBe('EXPIRED');
      });

      it('should return existing EXPIRED draft without update', () => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'EXPIRED' }),
        });

        const result = dal.expireDraft('store-456', 'draft-123');

        expect(result.status).toBe('EXPIRED');
        // Should only call get once (no update)
        expect(mockPrepare).toHaveBeenCalledTimes(1);
      });
    });

    describe('InvalidStatusTransitionError', () => {
      it('should have correct error properties', () => {
        const error = new InvalidStatusTransitionError('IN_PROGRESS', 'FINALIZED');

        expect(error.code).toBe('INVALID_STATUS_TRANSITION');
        expect(error.fromStatus).toBe('IN_PROGRESS');
        expect(error.toStatus).toBe('FINALIZED');
        expect(error.message).toContain('IN_PROGRESS');
        expect(error.message).toContain('FINALIZED');
      });
    });
  });

  // ==========================================================================
  // UPDATE STEP STATE TESTS
  // ==========================================================================

  describe('updateStepState', () => {
    it('should update step_state to LOTTERY', () => {
      mockPrepare
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ ...mockDraftRow, step_state: null }),
        })
        .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ ...mockDraftRow, step_state: 'LOTTERY' }),
        });

      const result = dal.updateStepState('store-456', 'draft-123', 'LOTTERY');

      expect(result.step_state).toBe('LOTTERY');
    });

    it('should update step_state to REPORTS', () => {
      mockPrepare
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ ...mockDraftRow, step_state: 'LOTTERY' }),
        })
        .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ ...mockDraftRow, step_state: 'REPORTS' }),
        });

      const result = dal.updateStepState('store-456', 'draft-123', 'REPORTS');

      expect(result.step_state).toBe('REPORTS');
    });

    it('should update step_state to REVIEW', () => {
      mockPrepare
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ ...mockDraftRow, step_state: 'REPORTS' }),
        })
        .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ ...mockDraftRow, step_state: 'REVIEW' }),
        });

      const result = dal.updateStepState('store-456', 'draft-123', 'REVIEW');

      expect(result.step_state).toBe('REVIEW');
    });

    it('should allow setting step_state to null', () => {
      mockPrepare
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ ...mockDraftRow, step_state: 'LOTTERY' }),
        })
        .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ ...mockDraftRow, step_state: null }),
        });

      const result = dal.updateStepState('store-456', 'draft-123', null);

      expect(result.step_state).toBeNull();
    });

    it('should throw for invalid step_state', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockDraftRow),
      });

      expect(() => dal.updateStepState('store-456', 'draft-123', 'INVALID' as StepState)).toThrow(
        'Invalid step state'
      );
    });

    it('should prevent updates on FINALIZED draft', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'FINALIZED' }),
      });

      expect(() => dal.updateStepState('store-456', 'draft-123', 'LOTTERY')).toThrow(
        'Cannot update step state on FINALIZED draft'
      );
    });
  });

  // ==========================================================================
  // CLEANUP TESTS
  // ==========================================================================

  describe('cleanupExpiredDrafts', () => {
    it('should delete expired drafts older than specified hours', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 5 }),
      });

      const result = dal.cleanupExpiredDrafts('store-456', 24);

      expect(result).toBe(5);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM close_drafts'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("status = 'EXPIRED'"));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('updated_at <'));
    });

    it('should return 0 when no drafts to delete', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      const result = dal.cleanupExpiredDrafts('store-456', 24);

      expect(result).toBe(0);
    });

    it('should be store-scoped (DB-006)', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      dal.cleanupExpiredDrafts('store-456', 24);

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('store_id = ?'));
    });

    it('should throw for invalid maxAgeHours', () => {
      expect(() => dal.cleanupExpiredDrafts('store-456', 0)).toThrow(
        'maxAgeHours must be positive'
      );
      expect(() => dal.cleanupExpiredDrafts('store-456', -1)).toThrow(
        'maxAgeHours must be positive'
      );
    });
  });

  describe('cleanupAllInactive', () => {
    it('should delete both EXPIRED and FINALIZED drafts', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 10 }),
      });

      const result = dal.cleanupAllInactive('store-456');

      expect(result).toBe(10);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("status IN ('EXPIRED', 'FINALIZED')")
      );
    });

    it('should be store-scoped (DB-006)', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      dal.cleanupAllInactive('store-456');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('store_id = ?'));
    });
  });

  // ==========================================================================
  // UTILITY METHODS TESTS
  // ==========================================================================

  describe('Utility Methods', () => {
    describe('hasActiveDraft', () => {
      it('should return true when active draft exists', () => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue(mockDraftRow),
        });

        const result = dal.hasActiveDraft('store-456', 'shift-789');

        expect(result).toBe(true);
      });

      it('should return false when no active draft exists', () => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue(undefined),
        });

        const result = dal.hasActiveDraft('store-456', 'shift-789');

        expect(result).toBe(false);
      });
    });

    describe('getLatestDraftForShift', () => {
      it('should return latest draft regardless of status', () => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue({ ...mockDraftRow, status: 'FINALIZED' }),
        });

        const result = dal.getLatestDraftForShift('store-456', 'shift-789');

        expect(result).toBeDefined();
        expect(result?.status).toBe('FINALIZED');
        expect(mockPrepare).toHaveBeenCalledWith(
          expect.stringContaining('ORDER BY created_at DESC')
        );
      });

      it('should return undefined when no drafts exist', () => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue(undefined),
        });

        const result = dal.getLatestDraftForShift('store-456', 'shift-789');

        expect(result).toBeUndefined();
      });
    });

    describe('countByStatus', () => {
      it('should count drafts by status', () => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue({ count: 5 }),
        });

        const result = dal.countByStatus('store-456', 'IN_PROGRESS');

        expect(result).toBe(5);
      });

      it('should return 0 when no matching drafts', () => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue({ count: 0 }),
        });

        const result = dal.countByStatus('store-456', 'EXPIRED');

        expect(result).toBe(0);
      });

      it('should throw for invalid status', () => {
        expect(() => dal.countByStatus('store-456', 'INVALID' as DraftStatus)).toThrow(
          'Invalid status'
        );
      });
    });

    describe('deleteDraft', () => {
      it('should delete draft and return true', () => {
        mockPrepare.mockReturnValue({
          run: vi.fn().mockReturnValue({ changes: 1 }),
        });

        const result = dal.deleteDraft('store-456', 'draft-123');

        expect(result).toBe(true);
      });

      it('should return false for non-existent draft', () => {
        mockPrepare.mockReturnValue({
          run: vi.fn().mockReturnValue({ changes: 0 }),
        });

        const result = dal.deleteDraft('store-456', 'nonexistent');

        expect(result).toBe(false);
      });

      it('should be store-scoped (DB-006)', () => {
        mockPrepare.mockReturnValue({
          run: vi.fn().mockReturnValue({ changes: 1 }),
        });

        dal.deleteDraft('store-456', 'draft-123');

        expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('store_id = ?'));
      });
    });

    describe('getDraftsByStore', () => {
      it('should return all drafts for store when no status filter', () => {
        mockPrepare.mockReturnValue({
          all: vi.fn().mockReturnValue([mockDraftRow, { ...mockDraftRow, draft_id: 'draft-456' }]),
        });

        const result = dal.getDraftsByStore('store-456');

        expect(result).toHaveLength(2);
      });

      it('should filter by status when provided', () => {
        mockPrepare.mockReturnValue({
          all: vi.fn().mockReturnValue([mockDraftRow]),
        });

        const result = dal.getDraftsByStore('store-456', 'IN_PROGRESS');

        expect(result).toHaveLength(1);
        expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('status = ?'));
      });

      it('should throw for invalid status filter', () => {
        expect(() => dal.getDraftsByStore('store-456', 'INVALID' as DraftStatus)).toThrow(
          'Invalid status'
        );
      });
    });
  });

  // ==========================================================================
  // SEC-006: SQL INJECTION PREVENTION TESTS
  // ==========================================================================

  describe('SEC-006: SQL Injection Prevention', () => {
    it('should use parameterized queries for all operations', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue(mockDraftRow);
      const mockAll = vi.fn().mockReturnValue([mockDraftRow]);

      mockPrepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll });

      // Execute various operations
      dal.getDraft('store-456', 'draft-123');
      dal.getActiveDraft('store-456', 'shift-789');
      dal.countByStatus('store-456', 'IN_PROGRESS');
      dal.cleanupExpiredDrafts('store-456', 24);

      // All calls should use parameterized queries
      const calls = mockPrepare.mock.calls;
      calls.forEach((call) => {
        expect(call[0]).toContain('?');
        // Should not contain direct string interpolation patterns
        expect(call[0]).not.toMatch(/\$\{.*\}/);
      });
    });
  });

  // ==========================================================================
  // T2.3: DB-006 TENANT ISOLATION TESTS
  // ==========================================================================

  describe('DB-006: Tenant Isolation', () => {
    it('should always include store_id in queries', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue(undefined),
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      // All store-scoped queries should include store_id
      dal.getDraft('store-456', 'draft-123');
      dal.getActiveDraft('store-456', 'shift-789');
      dal.getDraftsByStore('store-456');
      dal.countByStatus('store-456', 'IN_PROGRESS');
      dal.cleanupExpiredDrafts('store-456', 24);
      dal.deleteDraft('store-456', 'draft-123');

      const calls = mockPrepare.mock.calls;
      calls.forEach((call) => {
        expect(call[0]).toContain('store_id');
      });
    });

    it('should prevent cross-store draft access via getDraft', () => {
      // Query includes store_id, so accessing from wrong store returns undefined
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.getDraft('other-store', 'draft-123');

      expect(result).toBeUndefined();
    });

    it('should prevent cross-store draft update via updateDraft', () => {
      // getDraft returns undefined for wrong store
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      expect(() => dal.updateDraft('other-store', 'draft-123', { closing_cash: 500 }, 1)).toThrow(
        'Draft not found'
      );
    });

    it('should prevent cross-store status changes', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      expect(() => dal.beginFinalize('other-store', 'draft-123')).toThrow('Draft not found');
    });
  });
});
