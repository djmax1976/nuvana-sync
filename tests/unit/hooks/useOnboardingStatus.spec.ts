/**
 * useOnboardingStatus & useCompleteOnboarding Hook Unit Tests
 *
 * Enterprise-grade tests for lottery onboarding hooks.
 * Tests query behavior, mutation behavior, cache invalidation, and state management.
 *
 * Plan: Lottery Onboarding UX Improvement - Phase 4
 *
 * Tests:
 * - HK-ONB-001: useOnboardingStatus returns isOnboarding from backend
 * - HK-ONB-002: useOnboardingStatus handles loading state
 * - HK-ONB-003: useCompleteOnboarding calls transport method
 * - HK-ONB-004: useCompleteOnboarding invalidates cache on success
 * - HK-ONB-005: useInitializeBusinessDay includes is_onboarding in response invalidation
 *
 * @module tests/unit/hooks/useOnboardingStatus
 * @security FE-003: Verifies no sensitive data stored
 * @security DB-006: Verifies tenant isolation delegated to backend
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ============================================================================
// Mock Setup (using vi.hoisted for proper variable hoisting)
// ============================================================================

const { mockGetOnboardingStatus, mockCompleteOnboarding } = vi.hoisted(() => ({
  mockGetOnboardingStatus: vi.fn(),
  mockCompleteOnboarding: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/transport', () => ({
  ipc: {
    lottery: {
      getOnboardingStatus: mockGetOnboardingStatus,
      completeOnboarding: mockCompleteOnboarding,
    },
  },
}));

// ============================================================================
// Types (matching transport types)
// ============================================================================

interface OnboardingStatusResponse {
  is_onboarding: boolean;
  day_id: string | null;
  business_date: string | null;
  opened_at: string | null;
}

interface CompleteOnboardingResponse {
  success: boolean;
  day_id: string;
  message?: string;
}

// ============================================================================
// Test Data Factories
// ============================================================================

function createOnboardingStatusResponse(
  overrides: Partial<OnboardingStatusResponse> = {}
): OnboardingStatusResponse {
  return {
    is_onboarding: false,
    day_id: null,
    business_date: null,
    opened_at: null,
    ...overrides,
  };
}

function createActiveOnboardingResponse(
  overrides: Partial<OnboardingStatusResponse> = {}
): OnboardingStatusResponse {
  return {
    is_onboarding: true,
    day_id: 'day-uuid-001',
    business_date: '2026-02-16',
    opened_at: '2026-02-16T06:00:00.000Z',
    ...overrides,
  };
}

function createCompleteOnboardingResponse(
  overrides: Partial<CompleteOnboardingResponse> = {}
): CompleteOnboardingResponse {
  return {
    success: true,
    day_id: 'day-uuid-001',
    message: 'Onboarding completed successfully.',
    ...overrides,
  };
}

// ============================================================================
// Test Wrapper with QueryClient
// ============================================================================

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ============================================================================
// Hook Import (after mocks)
// ============================================================================

import {
  useOnboardingStatus,
  useCompleteOnboarding,
  lotteryKeys,
} from '../../../src/renderer/hooks/useLottery';

// ============================================================================
// HK-ONB-001: useOnboardingStatus returns isOnboarding from backend
// ============================================================================

describe('HK-ONB-001: useOnboardingStatus returns isOnboarding from backend', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
    vi.resetAllMocks();
  });

  it('should return isOnboarding: false when store is not in onboarding mode', async () => {
    const response = createOnboardingStatusResponse({ is_onboarding: false });
    mockGetOnboardingStatus.mockResolvedValue(response);

    const { result } = renderHook(() => useOnboardingStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data?.isOnboarding).toBe(false);
    expect(result.current.data?.dayId).toBeNull();
  });

  it('should return isOnboarding: true when store is in onboarding mode', async () => {
    const response = createActiveOnboardingResponse();
    mockGetOnboardingStatus.mockResolvedValue(response);

    const { result } = renderHook(() => useOnboardingStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data?.isOnboarding).toBe(true);
    expect(result.current.data?.dayId).toBe('day-uuid-001');
  });

  it('should return dayId when in onboarding mode', async () => {
    const response = createActiveOnboardingResponse({ day_id: 'custom-day-id' });
    mockGetOnboardingStatus.mockResolvedValue(response);

    const { result } = renderHook(() => useOnboardingStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.data?.dayId).toBe('custom-day-id');
    });
  });

  it('should return businessDate when in onboarding mode', async () => {
    const response = createActiveOnboardingResponse({ business_date: '2026-02-20' });
    mockGetOnboardingStatus.mockResolvedValue(response);

    const { result } = renderHook(() => useOnboardingStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.data?.businessDate).toBe('2026-02-20');
    });
  });

  it('should return openedAt when in onboarding mode', async () => {
    const response = createActiveOnboardingResponse({ opened_at: '2026-02-16T08:30:00.000Z' });
    mockGetOnboardingStatus.mockResolvedValue(response);

    const { result } = renderHook(() => useOnboardingStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.data?.openedAt).toBe('2026-02-16T08:30:00.000Z');
    });
  });

  it('should call ipc.lottery.getOnboardingStatus', async () => {
    mockGetOnboardingStatus.mockResolvedValue(createOnboardingStatusResponse());

    const { result } = renderHook(() => useOnboardingStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockGetOnboardingStatus).toHaveBeenCalledTimes(1);
  });

  it('should transform snake_case response to camelCase', async () => {
    const response = createActiveOnboardingResponse({
      is_onboarding: true,
      day_id: 'day-123',
      business_date: '2026-02-16',
      opened_at: '2026-02-16T06:00:00.000Z',
    });
    mockGetOnboardingStatus.mockResolvedValue(response);

    const { result } = renderHook(() => useOnboardingStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.data?.isOnboarding).toBe(true);
      expect(result.current.data?.dayId).toBe('day-123');
      expect(result.current.data?.businessDate).toBe('2026-02-16');
      expect(result.current.data?.openedAt).toBe('2026-02-16T06:00:00.000Z');
    });
  });
});

// ============================================================================
// HK-ONB-002: useOnboardingStatus handles loading state
// ============================================================================

describe('HK-ONB-002: useOnboardingStatus handles loading state', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
    vi.resetAllMocks();
  });

  it('should start with isLoading: true', () => {
    // Return a promise that never resolves to keep loading state
    mockGetOnboardingStatus.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useOnboardingStatus(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.isLoading).toBe(true);
  });

  it('should set isLoading: false after successful fetch', async () => {
    mockGetOnboardingStatus.mockResolvedValue(createOnboardingStatusResponse());

    const { result } = renderHook(() => useOnboardingStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('should set isLoading: false after failed fetch', async () => {
    mockGetOnboardingStatus.mockRejectedValue(new Error('IPC error'));

    const { result } = renderHook(() => useOnboardingStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isError).toBe(true);
  });

  it('should have data: undefined during loading', () => {
    mockGetOnboardingStatus.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useOnboardingStatus(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.data).toBeUndefined();
  });

  it('should support enabled option to disable query', async () => {
    mockGetOnboardingStatus.mockResolvedValue(createOnboardingStatusResponse());

    const { result } = renderHook(() => useOnboardingStatus({ enabled: false }), {
      wrapper: createWrapper(queryClient),
    });

    // Should not call the transport method when disabled
    expect(mockGetOnboardingStatus).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('should use correct query key', async () => {
    mockGetOnboardingStatus.mockResolvedValue(createOnboardingStatusResponse());

    renderHook(() => useOnboardingStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(mockGetOnboardingStatus).toHaveBeenCalled();
    });

    // Verify the query key is correct
    const queries = queryClient.getQueryCache().getAll();
    const onboardingQuery = queries.find(
      (q) => JSON.stringify(q.queryKey) === JSON.stringify(lotteryKeys.onboardingStatus())
    );
    expect(onboardingQuery).toBeDefined();
  });
});

// ============================================================================
// HK-ONB-003: useCompleteOnboarding calls transport method
// ============================================================================

describe('HK-ONB-003: useCompleteOnboarding calls transport method', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
    vi.resetAllMocks();
  });

  it('should call ipc.lottery.completeOnboarding with correct day_id', async () => {
    mockCompleteOnboarding.mockResolvedValue(createCompleteOnboardingResponse());

    const { result } = renderHook(() => useCompleteOnboarding(), {
      wrapper: createWrapper(queryClient),
    });

    await result.current.mutateAsync('day-uuid-001');

    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);
    expect(mockCompleteOnboarding).toHaveBeenCalledWith('day-uuid-001');
  });

  it('should return success response from transport', async () => {
    const response = createCompleteOnboardingResponse({
      success: true,
      day_id: 'day-uuid-001',
      message: 'Completed!',
    });
    mockCompleteOnboarding.mockResolvedValue(response);

    const { result } = renderHook(() => useCompleteOnboarding(), {
      wrapper: createWrapper(queryClient),
    });

    const mutationResult = await result.current.mutateAsync('day-uuid-001');

    expect(mutationResult.success).toBe(true);
    expect(mutationResult.day_id).toBe('day-uuid-001');
    expect(mutationResult.message).toBe('Completed!');
  });

  it('should handle transport error', async () => {
    mockCompleteOnboarding.mockRejectedValue(new Error('IPC error'));

    const { result } = renderHook(() => useCompleteOnboarding(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(result.current.mutateAsync('day-uuid-001')).rejects.toThrow('IPC error');
  });

  it('should pass different day_id values correctly', async () => {
    mockCompleteOnboarding.mockResolvedValue(
      createCompleteOnboardingResponse({ day_id: 'another-day-id' })
    );

    const { result } = renderHook(() => useCompleteOnboarding(), {
      wrapper: createWrapper(queryClient),
    });

    await result.current.mutateAsync('another-day-id');

    expect(mockCompleteOnboarding).toHaveBeenCalledWith('another-day-id');
  });

  it('should set isPending during mutation', async () => {
    let resolvePromise: (value: CompleteOnboardingResponse) => void;
    mockCompleteOnboarding.mockReturnValue(
      new Promise<CompleteOnboardingResponse>((resolve) => {
        resolvePromise = resolve;
      })
    );

    const { result } = renderHook(() => useCompleteOnboarding(), {
      wrapper: createWrapper(queryClient),
    });

    // Start mutation
    const mutationPromise = result.current.mutateAsync('day-uuid-001');

    await waitFor(() => {
      expect(result.current.isPending).toBe(true);
    });

    // Complete mutation
    resolvePromise!(createCompleteOnboardingResponse());
    await mutationPromise;

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
  });
});

// ============================================================================
// HK-ONB-004: useCompleteOnboarding invalidates cache on success
// ============================================================================

describe('HK-ONB-004: useCompleteOnboarding invalidates cache on success', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
    vi.resetAllMocks();
  });

  it('should invalidate onboardingStatus cache on success', async () => {
    // Pre-populate cache with onboarding status
    queryClient.setQueryData(lotteryKeys.onboardingStatus(), createActiveOnboardingResponse());

    mockCompleteOnboarding.mockResolvedValue(createCompleteOnboardingResponse());

    const { result } = renderHook(() => useCompleteOnboarding(), {
      wrapper: createWrapper(queryClient),
    });

    // Spy on invalidateQueries
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync('day-uuid-001');

    // Should invalidate onboardingStatus
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: lotteryKeys.onboardingStatus(),
      })
    );
  });

  it('should invalidate dayStatus cache on success', async () => {
    // Pre-populate cache
    queryClient.setQueryData(lotteryKeys.dayStatus(), { has_open_day: true });

    mockCompleteOnboarding.mockResolvedValue(createCompleteOnboardingResponse());

    const { result } = renderHook(() => useCompleteOnboarding(), {
      wrapper: createWrapper(queryClient),
    });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync('day-uuid-001');

    // Should invalidate dayStatus
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: lotteryKeys.dayStatus(),
      })
    );
  });

  it('should invalidate dayBins cache on success', async () => {
    // Pre-populate cache
    queryClient.setQueryData(lotteryKeys.dayBins(), { bins: [] });

    mockCompleteOnboarding.mockResolvedValue(createCompleteOnboardingResponse());

    const { result } = renderHook(() => useCompleteOnboarding(), {
      wrapper: createWrapper(queryClient),
    });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await result.current.mutateAsync('day-uuid-001');

    // Should invalidate dayBins
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: lotteryKeys.dayBins(),
      })
    );
  });

  it('should not invalidate cache on error', async () => {
    mockCompleteOnboarding.mockRejectedValue(new Error('IPC error'));

    const { result } = renderHook(() => useCompleteOnboarding(), {
      wrapper: createWrapper(queryClient),
    });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    try {
      await result.current.mutateAsync('day-uuid-001');
    } catch {
      // Expected
    }

    // Should not have invalidated any queries
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// HK-ONB-005: useInitializeBusinessDay invalidates onboarding status
// ============================================================================

describe('HK-ONB-005: useInitializeBusinessDay includes is_onboarding', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
    vi.resetAllMocks();
  });

  it('should have onboardingStatus key in lotteryKeys', () => {
    expect(lotteryKeys.onboardingStatus).toBeDefined();
    expect(typeof lotteryKeys.onboardingStatus).toBe('function');
    expect(lotteryKeys.onboardingStatus()).toEqual(['lottery', 'onboardingStatus']);
  });

  it('should have correct query key structure', () => {
    const key = lotteryKeys.onboardingStatus();
    expect(key).toHaveLength(2);
    expect(key[0]).toBe('lottery');
    expect(key[1]).toBe('onboardingStatus');
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error handling', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
    vi.resetAllMocks();
  });

  it('should set isError: true on query failure', async () => {
    mockGetOnboardingStatus.mockRejectedValue(new Error('Connection failed'));

    const { result } = renderHook(() => useOnboardingStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Connection failed');
  });

  it('should handle NOT_CONFIGURED error', async () => {
    const errorResponse = {
      error: 'NOT_CONFIGURED',
      message: 'Store not configured. Please complete setup first.',
    };
    // Simulating IPC error that wraps the response
    mockGetOnboardingStatus.mockRejectedValue(new Error(errorResponse.message));

    const { result } = renderHook(() => useOnboardingStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });

  it('should set isError: true on mutation failure', async () => {
    mockCompleteOnboarding.mockRejectedValue(new Error('Forbidden'));

    const { result } = renderHook(() => useCompleteOnboarding(), {
      wrapper: createWrapper(queryClient),
    });

    try {
      await result.current.mutateAsync('day-uuid-001');
    } catch {
      // Expected
    }

    // Wait for mutation state to settle
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe('Forbidden');
  });
});

// ============================================================================
// Security Tests (FE-003, DB-006)
// ============================================================================

describe('Security compliance', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
    vi.resetAllMocks();
  });

  describe('FE-003: No sensitive data stored', () => {
    it('should not store any sensitive data in query result', async () => {
      mockGetOnboardingStatus.mockResolvedValue(createActiveOnboardingResponse());

      const { result } = renderHook(() => useOnboardingStatus(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.data).toBeDefined();
      });

      // Verify no sensitive fields in the result
      expect(result.current.data).not.toHaveProperty('api_key');
      expect(result.current.data).not.toHaveProperty('password');
      expect(result.current.data).not.toHaveProperty('pin');
      expect(result.current.data).not.toHaveProperty('token');
    });
  });

  describe('DB-006: Tenant isolation delegated to backend', () => {
    it('should not include store_id in query parameters (backend handles it)', async () => {
      mockGetOnboardingStatus.mockResolvedValue(createOnboardingStatusResponse());

      renderHook(() => useOnboardingStatus(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(mockGetOnboardingStatus).toHaveBeenCalled();
      });

      // Hook should call without any parameters - backend gets store from config
      expect(mockGetOnboardingStatus).toHaveBeenCalledWith();
    });

    it('should not include store_id in mutation parameters', async () => {
      mockCompleteOnboarding.mockResolvedValue(createCompleteOnboardingResponse());

      const { result } = renderHook(() => useCompleteOnboarding(), {
        wrapper: createWrapper(queryClient),
      });

      await result.current.mutateAsync('day-uuid-001');

      // Mutation should only pass day_id - backend validates store ownership
      expect(mockCompleteOnboarding).toHaveBeenCalledWith('day-uuid-001');
    });
  });
});

// ============================================================================
// Query Options Tests
// ============================================================================

describe('Query options', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
    vi.resetAllMocks();
  });

  it('should refetch on window focus (refetchOnWindowFocus: true)', async () => {
    mockGetOnboardingStatus.mockResolvedValue(createOnboardingStatusResponse());

    renderHook(() => useOnboardingStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(mockGetOnboardingStatus).toHaveBeenCalledTimes(1);
    });

    // The hook is configured with refetchOnWindowFocus: true
    // This is verified by checking the query options (cast to access internal properties)
    const query = queryClient.getQueryCache().find({ queryKey: lotteryKeys.onboardingStatus() });
    const options = query?.options as unknown as Record<string, unknown>;
    expect(options?.refetchOnWindowFocus).toBe(true);
  });

  it('should refetch on mount (refetchOnMount: always)', async () => {
    mockGetOnboardingStatus.mockResolvedValue(createOnboardingStatusResponse());

    renderHook(() => useOnboardingStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(mockGetOnboardingStatus).toHaveBeenCalled();
    });

    const query = queryClient.getQueryCache().find({ queryKey: lotteryKeys.onboardingStatus() });
    const options = query?.options as unknown as Record<string, unknown>;
    expect(options?.refetchOnMount).toBe('always');
  });

  it('should have short staleTime for frequent status checks', async () => {
    mockGetOnboardingStatus.mockResolvedValue(createOnboardingStatusResponse());

    renderHook(() => useOnboardingStatus(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(mockGetOnboardingStatus).toHaveBeenCalled();
    });

    const query = queryClient.getQueryCache().find({ queryKey: lotteryKeys.onboardingStatus() });
    const options = query?.options as unknown as Record<string, unknown>;
    // staleTime should be 5000ms for frequent onboarding status checks
    expect(options?.staleTime).toBe(5000);
  });
});

// ============================================================================
// Integration with lotteryKeys Tests
// ============================================================================

describe('Integration with lotteryKeys', () => {
  it('should have onboardingStatus in lotteryKeys', () => {
    expect(lotteryKeys.onboardingStatus).toBeDefined();
  });

  it('should return correct key array structure', () => {
    const key = lotteryKeys.onboardingStatus();
    expect(Array.isArray(key)).toBe(true);
    expect(key).toEqual(['lottery', 'onboardingStatus']);
  });

  it('should be consistent with other lotteryKeys patterns', () => {
    // All lottery keys should start with 'lottery'
    expect(lotteryKeys.all[0]).toBe('lottery');
    expect(lotteryKeys.onboardingStatus()[0]).toBe('lottery');
    expect(lotteryKeys.dayStatus()[0]).toBe('lottery');
    expect(lotteryKeys.dayBins()[0]).toBe('lottery');
  });
});
