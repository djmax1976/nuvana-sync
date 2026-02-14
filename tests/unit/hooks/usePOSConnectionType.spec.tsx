/**
 * usePOSConnectionType Hook Unit Tests
 *
 * Tests for POS connection type and lottery mode detection hooks.
 * Store Config Phase 6B: Validates hook behavior for UI mode detection.
 *
 * @module tests/unit/hooks/usePOSConnectionType
 * @security SC-HOOK-004: Validates loading state returns false (prevents flash)
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ============================================================================
// Mock Setup
// ============================================================================

// Mock settingsAPI.getPOSConnectionType
const mockGetPOSConnectionType = vi.fn();

vi.mock('../../../src/renderer/lib/api/ipc-client', () => ({
  settingsAPI: {
    getPOSConnectionType: () => mockGetPOSConnectionType(),
  },
}));

// Import hooks AFTER mocks
import {
  usePOSConnectionType,
  useIsLotteryMode,
  useIsManualMode,
} from '../../../src/renderer/hooks/usePOSConnectionType';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Creates a fresh QueryClient for each test
 * Prevents query cache pollution between tests
 */
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
    },
  });
}

/**
 * Wrapper component for testing hooks with React Query
 */
function createWrapper() {
  const queryClient = createTestQueryClient();
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('usePOSConnectionType Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // useIsLotteryMode Hook Tests
  // --------------------------------------------------------------------------

  describe('useIsLotteryMode', () => {
    /**
     * SC-HOOK-001: Returns true when posType === 'LOTTERY'
     */
    it('SC-HOOK-001: returns true when posType is LOTTERY', async () => {
      mockGetPOSConnectionType.mockResolvedValue({
        connectionType: 'MANUAL',
        posType: 'LOTTERY',
      });

      const { result } = renderHook(() => useIsLotteryMode(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current).toBe(true);
      });
    });

    /**
     * SC-HOOK-002: Returns false when posType !== 'LOTTERY'
     */
    it('SC-HOOK-002: returns false for non-lottery POS types', async () => {
      const nonLotteryTypes = ['GILBARCO_PASSPORT', 'MANUAL_ENTRY', 'SQUARE_REST'];

      for (const posType of nonLotteryTypes) {
        mockGetPOSConnectionType.mockResolvedValue({
          connectionType: 'FILE',
          posType,
        });

        const { result } = renderHook(() => useIsLotteryMode(), {
          wrapper: createWrapper(),
        });

        await waitFor(() => {
          expect(result.current).toBe(false);
        });
      }
    });

    /**
     * SC-HOOK-003: Returns false when posType is null (unconfigured store)
     */
    it('SC-HOOK-003: returns false when posType is null', async () => {
      mockGetPOSConnectionType.mockResolvedValue({
        connectionType: null,
        posType: null,
      });

      const { result } = renderHook(() => useIsLotteryMode(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current).toBe(false);
      });
    });

    /**
     * SC-HOOK-004: Returns false while data is loading
     * Prevents flash of hidden content during initial load
     */
    it('SC-HOOK-004: returns false during loading state', async () => {
      // Create a promise that won't resolve immediately
      let resolvePromise: (value: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockGetPOSConnectionType.mockReturnValue(pendingPromise);

      const { result } = renderHook(() => useIsLotteryMode(), {
        wrapper: createWrapper(),
      });

      // During loading, should return false
      expect(result.current).toBe(false);

      // Cleanup: resolve the promise
      resolvePromise!({ connectionType: 'MANUAL', posType: 'LOTTERY' });
    });
  });

  // --------------------------------------------------------------------------
  // useIsManualMode Regression Tests
  // --------------------------------------------------------------------------

  describe('useIsManualMode (Regression)', () => {
    /**
     * SC-HOOK-005: useIsManualMode still works correctly after adding posType
     */
    it('SC-HOOK-005: returns true when connectionType is MANUAL', async () => {
      mockGetPOSConnectionType.mockResolvedValue({
        connectionType: 'MANUAL',
        posType: 'MANUAL_ENTRY',
      });

      const { result } = renderHook(() => useIsManualMode(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current).toBe(true);
      });
    });

    it('returns false when connectionType is FILE', async () => {
      mockGetPOSConnectionType.mockResolvedValue({
        connectionType: 'FILE',
        posType: 'GILBARCO_PASSPORT',
      });

      const { result } = renderHook(() => useIsManualMode(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current).toBe(false);
      });
    });

    /**
     * SC-REG-002: Non-lottery, non-manual stores are unaffected
     */
    it('SC-REG-002: non-lottery non-manual stores return false for both hooks', async () => {
      mockGetPOSConnectionType.mockResolvedValue({
        connectionType: 'FILE',
        posType: 'GILBARCO_PASSPORT',
      });

      const wrapper = createWrapper();

      const { result: lotteryResult } = renderHook(() => useIsLotteryMode(), {
        wrapper,
      });

      const { result: manualResult } = renderHook(() => useIsManualMode(), {
        wrapper,
      });

      await waitFor(() => {
        expect(lotteryResult.current).toBe(false);
        expect(manualResult.current).toBe(false);
      });
    });
  });

  // --------------------------------------------------------------------------
  // usePOSConnectionType Base Hook Tests
  // --------------------------------------------------------------------------

  describe('usePOSConnectionType', () => {
    it('returns query result with connectionType and posType', async () => {
      mockGetPOSConnectionType.mockResolvedValue({
        connectionType: 'FILE',
        posType: 'GILBARCO_PASSPORT',
      });

      const { result } = renderHook(() => usePOSConnectionType(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual({
          connectionType: 'FILE',
          posType: 'GILBARCO_PASSPORT',
        });
      });
    });

    it('exposes isLoading state correctly', async () => {
      let resolvePromise: (value: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockGetPOSConnectionType.mockReturnValue(pendingPromise);

      const { result } = renderHook(() => usePOSConnectionType(), {
        wrapper: createWrapper(),
      });

      // Initially loading
      expect(result.current.isLoading).toBe(true);
      expect(result.current.data).toBeUndefined();

      // Resolve and check loaded state
      resolvePromise!({ connectionType: 'MANUAL', posType: 'LOTTERY' });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.data).toBeDefined();
      });
    });
  });
});
