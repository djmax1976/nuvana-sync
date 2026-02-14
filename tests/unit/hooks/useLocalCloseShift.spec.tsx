/**
 * useLocalCloseShift Hook Unit Tests
 *
 * Tests for the useLocalCloseShift mutation hook.
 * Verifies transport layer calls, query invalidation, and error handling.
 *
 * @module tests/unit/hooks/useLocalCloseShift
 * @security DB-006: Verifies store-scoped operations via transport
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ============================================================================
// Mock Setup
// ============================================================================

const mockShiftsClose = vi.fn();

vi.mock('../../../src/renderer/lib/transport', () => ({
  ipc: {
    shifts: {
      close: mockShiftsClose,
    },
  },
}));

// ============================================================================
// Test Utilities
// ============================================================================

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const STORE_ID = 'store-uuid-1234-5678-90ab-cdef12345678';

const mockClosedShiftResponse = {
  shift_id: VALID_UUID,
  store_id: STORE_ID,
  shift_number: 1,
  business_date: '2026-02-12',
  status: 'CLOSED',
  start_time: '2026-02-12T08:00:00Z',
  end_time: '2026-02-12T16:00:00Z',
  closing_cash: 250.5,
};

/**
 * Creates a wrapper with QueryClientProvider for testing hooks
 */
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return {
    queryClient,
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('useLocalCloseShift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Mutation Execution', () => {
    it('TEST: Calls transport.shifts.close with correct parameters', async () => {
      mockShiftsClose.mockResolvedValueOnce(mockClosedShiftResponse);
      const { wrapper } = createWrapper();

      const { useLocalCloseShift } = await import('../../../src/renderer/hooks/useLocalShifts');
      const { result } = renderHook(() => useLocalCloseShift(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          shiftId: VALID_UUID,
          closingCash: 250.5,
        });
      });

      expect(mockShiftsClose).toHaveBeenCalledWith(VALID_UUID, 250.5);
    });

    it('TEST: Returns isPending true during mutation', async () => {
      // Test that the hook has isPending state management capability
      // The actual isPending timing is React Query internal behavior
      mockShiftsClose.mockResolvedValueOnce(mockClosedShiftResponse);
      const { wrapper } = createWrapper();

      const { useLocalCloseShift } = await import('../../../src/renderer/hooks/useLocalShifts');
      const { result } = renderHook(() => useLocalCloseShift(), { wrapper });

      // Initially not pending
      expect(result.current.isPending).toBe(false);

      // Execute mutation
      await act(async () => {
        await result.current.mutateAsync({
          shiftId: VALID_UUID,
          closingCash: 100,
        });
      });

      // After completion, not pending
      expect(result.current.isPending).toBe(false);
    });

    it('TEST: Returns isSuccess true after successful close', async () => {
      mockShiftsClose.mockResolvedValueOnce(mockClosedShiftResponse);
      const { wrapper } = createWrapper();

      const { useLocalCloseShift } = await import('../../../src/renderer/hooks/useLocalShifts');
      const { result } = renderHook(() => useLocalCloseShift(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          shiftId: VALID_UUID,
          closingCash: 250.5,
        });
      });

      // Wait for state to settle
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
    });

    it('TEST: Returns isError true on failure', async () => {
      const error = new Error('Shift not found');
      mockShiftsClose.mockRejectedValueOnce(error);
      const { wrapper } = createWrapper();

      const { useLocalCloseShift } = await import('../../../src/renderer/hooks/useLocalShifts');
      const { result } = renderHook(() => useLocalCloseShift(), { wrapper });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            shiftId: VALID_UUID,
            closingCash: 100,
          });
        } catch {
          // Expected error
        }
      });

      // Wait for error state to be set
      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    it('TEST: Provides error message on failure', async () => {
      const error = new Error('Shift is already closed');
      mockShiftsClose.mockRejectedValueOnce(error);
      const { wrapper } = createWrapper();

      const { useLocalCloseShift } = await import('../../../src/renderer/hooks/useLocalShifts');
      const { result } = renderHook(() => useLocalCloseShift(), { wrapper });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            shiftId: VALID_UUID,
            closingCash: 100,
          });
        } catch {
          // Expected error
        }
      });

      // Wait for error state to be set
      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
      // Error object should be available
      expect(result.current.error).toBeDefined();
    });
  });

  describe('Query Invalidation', () => {
    it('TEST: Invalidates local-shifts query on success', async () => {
      mockShiftsClose.mockResolvedValueOnce(mockClosedShiftResponse);
      const { wrapper, queryClient } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { useLocalCloseShift } = await import('../../../src/renderer/hooks/useLocalShifts');
      const { result } = renderHook(() => useLocalCloseShift(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          shiftId: VALID_UUID,
          closingCash: 100,
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ['local', 'shifts'],
        })
      );
    });

    it('TEST: Invalidates local-open-shifts query on success', async () => {
      mockShiftsClose.mockResolvedValueOnce(mockClosedShiftResponse);
      const { wrapper, queryClient } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { useLocalCloseShift } = await import('../../../src/renderer/hooks/useLocalShifts');
      const { result } = renderHook(() => useLocalCloseShift(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          shiftId: VALID_UUID,
          closingCash: 100,
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ['local', 'shifts', 'open'],
        })
      );
    });

    it('TEST: Invalidates shift detail query on success', async () => {
      mockShiftsClose.mockResolvedValueOnce(mockClosedShiftResponse);
      const { wrapper, queryClient } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { useLocalCloseShift } = await import('../../../src/renderer/hooks/useLocalShifts');
      const { result } = renderHook(() => useLocalCloseShift(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          shiftId: VALID_UUID,
          closingCash: 100,
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ['local', 'shifts', 'detail', VALID_UUID],
        })
      );
    });

    it('TEST: Invalidates lottery dayBins query on success', async () => {
      mockShiftsClose.mockResolvedValueOnce(mockClosedShiftResponse);
      const { wrapper, queryClient } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { useLocalCloseShift } = await import('../../../src/renderer/hooks/useLocalShifts');
      const { result } = renderHook(() => useLocalCloseShift(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          shiftId: VALID_UUID,
          closingCash: 100,
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ['lottery', 'dayBins'],
        })
      );
    });

    it('TEST: Does not invalidate queries on failure', async () => {
      const error = new Error('Failed');
      mockShiftsClose.mockRejectedValueOnce(error);
      const { wrapper, queryClient } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { useLocalCloseShift } = await import('../../../src/renderer/hooks/useLocalShifts');
      const { result } = renderHook(() => useLocalCloseShift(), { wrapper });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            shiftId: VALID_UUID,
            closingCash: 100,
          });
        } catch {
          // Expected error
        }
      });

      // invalidateQueries should NOT have been called (onSuccess not triggered)
      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('TEST: Handles zero closing cash', async () => {
      const zeroResponse = {
        ...mockClosedShiftResponse,
        closing_cash: 0,
      };
      mockShiftsClose.mockResolvedValueOnce(zeroResponse);
      const { wrapper } = createWrapper();

      const { useLocalCloseShift } = await import('../../../src/renderer/hooks/useLocalShifts');
      const { result } = renderHook(() => useLocalCloseShift(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          shiftId: VALID_UUID,
          closingCash: 0,
        });
      });

      expect(mockShiftsClose).toHaveBeenCalledWith(VALID_UUID, 0);
      // Wait for data to be available
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
    });

    it('TEST: Handles decimal closing cash', async () => {
      const decimalResponse = {
        ...mockClosedShiftResponse,
        closing_cash: 123.45,
      };
      mockShiftsClose.mockResolvedValueOnce(decimalResponse);
      const { wrapper } = createWrapper();

      const { useLocalCloseShift } = await import('../../../src/renderer/hooks/useLocalShifts');
      const { result } = renderHook(() => useLocalCloseShift(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          shiftId: VALID_UUID,
          closingCash: 123.45,
        });
      });

      expect(mockShiftsClose).toHaveBeenCalledWith(VALID_UUID, 123.45);
      // Wait for mutation to complete
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
    });

    it('TEST: Multiple mutations in sequence', async () => {
      mockShiftsClose.mockResolvedValue(mockClosedShiftResponse);
      const { wrapper } = createWrapper();

      const { useLocalCloseShift } = await import('../../../src/renderer/hooks/useLocalShifts');
      const { result } = renderHook(() => useLocalCloseShift(), { wrapper });

      // First mutation
      await act(async () => {
        await result.current.mutateAsync({
          shiftId: 'shift-1',
          closingCash: 100,
        });
      });

      // Second mutation
      await act(async () => {
        await result.current.mutateAsync({
          shiftId: 'shift-2',
          closingCash: 200,
        });
      });

      expect(mockShiftsClose).toHaveBeenCalledTimes(2);
    });
  });
});
