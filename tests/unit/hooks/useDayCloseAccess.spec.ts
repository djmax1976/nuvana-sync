/**
 * useDayCloseAccess Hook Unit Tests
 *
 * Enterprise-grade tests for day close access validation hook.
 * Tests PIN authentication flow, state management, and error handling.
 *
 * Plan: Centralized Day Close Access Validation - Phase 2
 *
 * Tests:
 * - 2.T1: Hook calls transport method correctly
 * - 2.T2: Hook returns loading state during check
 * - 2.T3: Hook caches last result
 * - 2.T4: Hook clears result on clearResult()
 *
 * @module tests/unit/hooks/useDayCloseAccess
 * @security SEC-010: Verifies authorization delegated to backend
 * @security FE-003: Verifies no sensitive data stored
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ============================================================================
// Mock Setup (using vi.hoisted for proper variable hoisting)
// ============================================================================

const { mockCheckAccess } = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/transport', () => ({
  ipc: {
    dayClose: {
      checkAccess: mockCheckAccess,
    },
  },
}));

// ============================================================================
// Types (matching transport types)
// ============================================================================

type DayCloseAccessDenialReason =
  | 'NO_OPEN_SHIFTS'
  | 'MULTIPLE_OPEN_SHIFTS'
  | 'NOT_SHIFT_OWNER'
  | 'INVALID_PIN'
  | 'NOT_AUTHENTICATED';

type DayCloseAccessType = 'OWNER' | 'OVERRIDE';

type DayCloseUserRole = 'store_manager' | 'shift_manager' | 'cashier';

interface DayCloseActiveShift {
  shift_id: string;
  shift_number: number;
  cashier_id: string | null;
  cashier_name: string;
  external_register_id: string | null;
  terminal_name: string;
  business_date: string;
  start_time: string | null;
}

interface DayCloseAccessUser {
  userId: string;
  name: string;
  role: DayCloseUserRole;
}

interface DayCloseAccessResult {
  allowed: boolean;
  reasonCode?: DayCloseAccessDenialReason;
  reason?: string;
  activeShift?: DayCloseActiveShift;
  accessType?: DayCloseAccessType;
  user?: DayCloseAccessUser;
  openShiftCount: number;
}

interface _DayCloseAccessInput {
  pin: string;
}

// ============================================================================
// Test Data Factories
// ============================================================================

function createActiveShift(overrides: Partial<DayCloseActiveShift> = {}): DayCloseActiveShift {
  return {
    shift_id: 'shift-uuid-001',
    shift_number: 1,
    cashier_id: 'cashier-uuid-001',
    cashier_name: 'John Doe',
    external_register_id: 'REG-001',
    terminal_name: 'Register 1',
    business_date: '2026-02-12',
    start_time: '2026-02-12T08:00:00.000Z',
    ...overrides,
  };
}

function createAccessUser(overrides: Partial<DayCloseAccessUser> = {}): DayCloseAccessUser {
  return {
    userId: 'user-uuid-001',
    name: 'John Doe',
    role: 'cashier',
    ...overrides,
  };
}

function createAllowedResult(overrides: Partial<DayCloseAccessResult> = {}): DayCloseAccessResult {
  return {
    allowed: true,
    openShiftCount: 1,
    activeShift: createActiveShift(),
    accessType: 'OWNER',
    user: createAccessUser(),
    ...overrides,
  };
}

function createDeniedResult(
  reasonCode: DayCloseAccessDenialReason,
  overrides: Partial<DayCloseAccessResult> = {}
): DayCloseAccessResult {
  const reasons: Record<DayCloseAccessDenialReason, string> = {
    NO_OPEN_SHIFTS: 'No open shifts to close. Please start a shift first.',
    MULTIPLE_OPEN_SHIFTS: 'Cannot close day with 3 open shifts. Please close other shifts first.',
    NOT_SHIFT_OWNER:
      'You are not the assigned cashier for this shift. Only the shift owner or a manager can close this day.',
    INVALID_PIN: 'Invalid PIN. Please try again.',
    NOT_AUTHENTICATED: 'Authentication failed.',
  };

  const openShiftCount: Record<DayCloseAccessDenialReason, number> = {
    NO_OPEN_SHIFTS: 0,
    MULTIPLE_OPEN_SHIFTS: 3,
    NOT_SHIFT_OWNER: 1,
    INVALID_PIN: 0,
    NOT_AUTHENTICATED: 0,
  };

  return {
    allowed: false,
    reasonCode,
    reason: reasons[reasonCode],
    openShiftCount: openShiftCount[reasonCode],
    ...overrides,
  };
}

// ============================================================================
// Deferred Promise Helper
// ============================================================================

interface DeferredPromise<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

function createDeferredPromise<T>(): DeferredPromise<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ============================================================================
// Hook Import (after mocks)
// ============================================================================

import { useDayCloseAccess } from '../../../src/renderer/hooks/useDayCloseAccess';

// ============================================================================
// 2.T1: Hook Calls Transport Method Correctly
// ============================================================================

describe('2.T1: Hook calls transport method correctly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should call ipc.dayClose.checkAccess with correct input', async () => {
    const expectedResult = createAllowedResult();
    mockCheckAccess.mockResolvedValue(expectedResult);

    const { result } = renderHook(() => useDayCloseAccess());

    await act(async () => {
      await result.current.checkAccess('1234');
    });

    expect(mockCheckAccess).toHaveBeenCalledTimes(1);
    expect(mockCheckAccess).toHaveBeenCalledWith({ pin: '1234' });
  });

  it('should pass 4-digit PIN correctly', async () => {
    mockCheckAccess.mockResolvedValue(createAllowedResult());

    const { result } = renderHook(() => useDayCloseAccess());

    await act(async () => {
      await result.current.checkAccess('4567');
    });

    expect(mockCheckAccess).toHaveBeenCalledWith({ pin: '4567' });
  });

  it('should pass 6-digit PIN correctly', async () => {
    mockCheckAccess.mockResolvedValue(createAllowedResult());

    const { result } = renderHook(() => useDayCloseAccess());

    await act(async () => {
      await result.current.checkAccess('123456');
    });

    expect(mockCheckAccess).toHaveBeenCalledWith({ pin: '123456' });
  });

  it('should return the result from transport', async () => {
    const expectedResult = createAllowedResult({
      activeShift: createActiveShift({ shift_id: 'custom-shift-id' }),
    });
    mockCheckAccess.mockResolvedValue(expectedResult);

    const { result } = renderHook(() => useDayCloseAccess());

    let returnedResult: DayCloseAccessResult | undefined;
    await act(async () => {
      returnedResult = await result.current.checkAccess('1234');
    });

    expect(returnedResult).toEqual(expectedResult);
    expect(returnedResult?.activeShift?.shift_id).toBe('custom-shift-id');
  });

  it('should handle denied result correctly', async () => {
    const deniedResult = createDeniedResult('NOT_SHIFT_OWNER');
    mockCheckAccess.mockResolvedValue(deniedResult);

    const { result } = renderHook(() => useDayCloseAccess());

    let returnedResult: DayCloseAccessResult | undefined;
    await act(async () => {
      returnedResult = await result.current.checkAccess('1234');
    });

    expect(returnedResult?.allowed).toBe(false);
    expect(returnedResult?.reasonCode).toBe('NOT_SHIFT_OWNER');
  });

  it('should handle OWNER access type', async () => {
    const ownerResult = createAllowedResult({ accessType: 'OWNER' });
    mockCheckAccess.mockResolvedValue(ownerResult);

    const { result } = renderHook(() => useDayCloseAccess());

    let returnedResult: DayCloseAccessResult | undefined;
    await act(async () => {
      returnedResult = await result.current.checkAccess('1234');
    });

    expect(returnedResult?.accessType).toBe('OWNER');
  });

  it('should handle OVERRIDE access type', async () => {
    const overrideResult = createAllowedResult({
      accessType: 'OVERRIDE',
      user: createAccessUser({ role: 'shift_manager' }),
    });
    mockCheckAccess.mockResolvedValue(overrideResult);

    const { result } = renderHook(() => useDayCloseAccess());

    let returnedResult: DayCloseAccessResult | undefined;
    await act(async () => {
      returnedResult = await result.current.checkAccess('1234');
    });

    expect(returnedResult?.accessType).toBe('OVERRIDE');
    expect(returnedResult?.user?.role).toBe('shift_manager');
  });
});

// ============================================================================
// 2.T2: Hook Returns Loading State During Check
// ============================================================================

describe('2.T2: Hook returns loading state during check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should start with isChecking = false', () => {
    const { result } = renderHook(() => useDayCloseAccess());

    expect(result.current.isChecking).toBe(false);
  });

  it('should set isChecking = true during async operation', async () => {
    const deferred = createDeferredPromise<DayCloseAccessResult>();
    mockCheckAccess.mockReturnValue(deferred.promise);

    const { result } = renderHook(() => useDayCloseAccess());

    // Start the check but don't await
    let checkPromise: Promise<DayCloseAccessResult>;
    act(() => {
      checkPromise = result.current.checkAccess('1234');
    });

    // Should be checking now
    expect(result.current.isChecking).toBe(true);

    // Complete the operation
    await act(async () => {
      deferred.resolve(createAllowedResult());
      await checkPromise;
    });

    // Should no longer be checking
    expect(result.current.isChecking).toBe(false);
  });

  it('should set isChecking = false after successful check', async () => {
    mockCheckAccess.mockResolvedValue(createAllowedResult());

    const { result } = renderHook(() => useDayCloseAccess());

    await act(async () => {
      await result.current.checkAccess('1234');
    });

    expect(result.current.isChecking).toBe(false);
  });

  it('should set isChecking = false after failed check', async () => {
    mockCheckAccess.mockRejectedValue(new Error('IPC error'));

    const { result } = renderHook(() => useDayCloseAccess());

    await act(async () => {
      try {
        await result.current.checkAccess('1234');
      } catch {
        // Expected to throw
      }
    });

    expect(result.current.isChecking).toBe(false);
  });

  it('should set isChecking = false after denied result (not an error)', async () => {
    mockCheckAccess.mockResolvedValue(createDeniedResult('INVALID_PIN'));

    const { result } = renderHook(() => useDayCloseAccess());

    await act(async () => {
      await result.current.checkAccess('1234');
    });

    expect(result.current.isChecking).toBe(false);
  });

  it('should clear error when starting new check', async () => {
    // First check fails
    mockCheckAccess.mockRejectedValueOnce(new Error('First error'));

    const { result } = renderHook(() => useDayCloseAccess());

    await act(async () => {
      try {
        await result.current.checkAccess('1234');
      } catch {
        // Expected
      }
    });

    expect(result.current.error).not.toBeNull();

    // Start second check (deferred to observe state)
    const deferred = createDeferredPromise<DayCloseAccessResult>();
    mockCheckAccess.mockReturnValue(deferred.promise);

    let secondPromise: Promise<DayCloseAccessResult>;
    act(() => {
      secondPromise = result.current.checkAccess('5678');
    });

    // Error should be cleared when check starts
    expect(result.current.error).toBeNull();
    expect(result.current.isChecking).toBe(true);

    // Complete the operation
    await act(async () => {
      deferred.resolve(createAllowedResult());
      await secondPromise;
    });
  });
});

// ============================================================================
// 2.T3: Hook Caches Last Result
// ============================================================================

describe('2.T3: Hook caches last result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should start with lastResult = null', () => {
    const { result } = renderHook(() => useDayCloseAccess());

    expect(result.current.lastResult).toBeNull();
  });

  it('should cache successful result in lastResult', async () => {
    const expectedResult = createAllowedResult();
    mockCheckAccess.mockResolvedValue(expectedResult);

    const { result } = renderHook(() => useDayCloseAccess());

    await act(async () => {
      await result.current.checkAccess('1234');
    });

    expect(result.current.lastResult).toEqual(expectedResult);
  });

  it('should cache denied result in lastResult', async () => {
    const deniedResult = createDeniedResult('MULTIPLE_OPEN_SHIFTS');
    mockCheckAccess.mockResolvedValue(deniedResult);

    const { result } = renderHook(() => useDayCloseAccess());

    await act(async () => {
      await result.current.checkAccess('1234');
    });

    expect(result.current.lastResult).toEqual(deniedResult);
    expect(result.current.lastResult?.reasonCode).toBe('MULTIPLE_OPEN_SHIFTS');
  });

  it('should update lastResult on subsequent checks', async () => {
    const firstResult = createAllowedResult({ openShiftCount: 1 });
    const secondResult = createDeniedResult('INVALID_PIN');

    mockCheckAccess.mockResolvedValueOnce(firstResult).mockResolvedValueOnce(secondResult);

    const { result } = renderHook(() => useDayCloseAccess());

    // First check
    await act(async () => {
      await result.current.checkAccess('1234');
    });
    expect(result.current.lastResult?.allowed).toBe(true);

    // Second check
    await act(async () => {
      await result.current.checkAccess('0000');
    });
    expect(result.current.lastResult?.allowed).toBe(false);
    expect(result.current.lastResult?.reasonCode).toBe('INVALID_PIN');
  });

  it('should set lastResult = null on IPC error', async () => {
    mockCheckAccess.mockRejectedValue(new Error('IPC error'));

    const { result } = renderHook(() => useDayCloseAccess());

    await act(async () => {
      try {
        await result.current.checkAccess('1234');
      } catch {
        // Expected
      }
    });

    expect(result.current.lastResult).toBeNull();
    expect(result.current.error).not.toBeNull();
  });

  it('should preserve lastResult across renders', async () => {
    const expectedResult = createAllowedResult();
    mockCheckAccess.mockResolvedValue(expectedResult);

    const { result, rerender } = renderHook(() => useDayCloseAccess());

    await act(async () => {
      await result.current.checkAccess('1234');
    });

    // Re-render the hook
    rerender();

    // lastResult should still be there
    expect(result.current.lastResult).toEqual(expectedResult);
  });

  it('should include activeShift in cached result', async () => {
    const shift = createActiveShift({
      shift_id: 'shift-123',
      cashier_name: 'Jane Smith',
      terminal_name: 'Register 2',
    });
    const expectedResult = createAllowedResult({ activeShift: shift });
    mockCheckAccess.mockResolvedValue(expectedResult);

    const { result } = renderHook(() => useDayCloseAccess());

    await act(async () => {
      await result.current.checkAccess('1234');
    });

    expect(result.current.lastResult?.activeShift?.shift_id).toBe('shift-123');
    expect(result.current.lastResult?.activeShift?.cashier_name).toBe('Jane Smith');
    expect(result.current.lastResult?.activeShift?.terminal_name).toBe('Register 2');
  });

  it('should include user in cached result', async () => {
    const user = createAccessUser({
      userId: 'user-456',
      name: 'Manager Bob',
      role: 'shift_manager',
    });
    const expectedResult = createAllowedResult({ user, accessType: 'OVERRIDE' });
    mockCheckAccess.mockResolvedValue(expectedResult);

    const { result } = renderHook(() => useDayCloseAccess());

    await act(async () => {
      await result.current.checkAccess('1234');
    });

    expect(result.current.lastResult?.user?.userId).toBe('user-456');
    expect(result.current.lastResult?.user?.name).toBe('Manager Bob');
    expect(result.current.lastResult?.user?.role).toBe('shift_manager');
    expect(result.current.lastResult?.accessType).toBe('OVERRIDE');
  });
});

// ============================================================================
// 2.T4: Hook Clears Result on clearResult()
// ============================================================================

describe('2.T4: Hook clears result on clearResult()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should clear lastResult when clearResult() is called', async () => {
    mockCheckAccess.mockResolvedValue(createAllowedResult());

    const { result } = renderHook(() => useDayCloseAccess());

    // First, get a result
    await act(async () => {
      await result.current.checkAccess('1234');
    });
    expect(result.current.lastResult).not.toBeNull();

    // Clear it
    act(() => {
      result.current.clearResult();
    });

    expect(result.current.lastResult).toBeNull();
  });

  it('should clear error when clearResult() is called', async () => {
    mockCheckAccess.mockRejectedValue(new Error('IPC error'));

    const { result } = renderHook(() => useDayCloseAccess());

    // First, get an error
    await act(async () => {
      try {
        await result.current.checkAccess('1234');
      } catch {
        // Expected
      }
    });
    expect(result.current.error).not.toBeNull();

    // Clear it
    act(() => {
      result.current.clearResult();
    });

    expect(result.current.error).toBeNull();
  });

  it('should be safe to call clearResult() when no result exists', () => {
    const { result } = renderHook(() => useDayCloseAccess());

    // Should not throw
    expect(() => {
      act(() => {
        result.current.clearResult();
      });
    }).not.toThrow();

    expect(result.current.lastResult).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should be safe to call clearResult() multiple times', async () => {
    mockCheckAccess.mockResolvedValue(createAllowedResult());

    const { result } = renderHook(() => useDayCloseAccess());

    await act(async () => {
      await result.current.checkAccess('1234');
    });

    // Clear multiple times
    act(() => {
      result.current.clearResult();
      result.current.clearResult();
      result.current.clearResult();
    });

    expect(result.current.lastResult).toBeNull();
  });

  it('should allow new check after clearResult()', async () => {
    const firstResult = createAllowedResult({ openShiftCount: 1 });
    const secondResult = createAllowedResult({ openShiftCount: 2 });

    mockCheckAccess.mockResolvedValueOnce(firstResult).mockResolvedValueOnce(secondResult);

    const { result } = renderHook(() => useDayCloseAccess());

    // First check
    await act(async () => {
      await result.current.checkAccess('1234');
    });
    expect(result.current.lastResult?.openShiftCount).toBe(1);

    // Clear
    act(() => {
      result.current.clearResult();
    });
    expect(result.current.lastResult).toBeNull();

    // Second check
    await act(async () => {
      await result.current.checkAccess('5678');
    });
    expect(result.current.lastResult?.openShiftCount).toBe(2);
  });

  it('should not affect isChecking state', async () => {
    const deferred = createDeferredPromise<DayCloseAccessResult>();
    mockCheckAccess.mockReturnValue(deferred.promise);

    const { result } = renderHook(() => useDayCloseAccess());

    // Start check
    let checkPromise: Promise<DayCloseAccessResult>;
    act(() => {
      checkPromise = result.current.checkAccess('1234');
    });
    expect(result.current.isChecking).toBe(true);

    // Clear while checking - should not affect isChecking
    act(() => {
      result.current.clearResult();
    });
    expect(result.current.isChecking).toBe(true);

    // Complete
    await act(async () => {
      deferred.resolve(createAllowedResult());
      await checkPromise;
    });
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should set error state on IPC failure', async () => {
    mockCheckAccess.mockRejectedValue(new Error('Connection failed'));

    const { result } = renderHook(() => useDayCloseAccess());

    await act(async () => {
      try {
        await result.current.checkAccess('1234');
      } catch {
        // Expected
      }
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.message).toBe('Connection failed');
  });

  it('should throw error from checkAccess for caller handling', async () => {
    mockCheckAccess.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useDayCloseAccess());

    await expect(
      act(async () => {
        await result.current.checkAccess('1234');
      })
    ).rejects.toThrow('Network error');
  });

  it('should handle IPC error response object', async () => {
    // Handler returns createErrorResponse instead of throwing
    const errorResponse = {
      error: 'NOT_CONFIGURED',
      message: 'Store not configured. Please complete setup first.',
    };
    mockCheckAccess.mockResolvedValue(errorResponse);

    const { result } = renderHook(() => useDayCloseAccess());

    await expect(
      act(async () => {
        await result.current.checkAccess('1234');
      })
    ).rejects.toThrow('Store not configured');
  });

  it('should handle timeout errors', async () => {
    mockCheckAccess.mockRejectedValue(new Error('Request timeout'));

    const { result } = renderHook(() => useDayCloseAccess());

    await act(async () => {
      try {
        await result.current.checkAccess('1234');
      } catch {
        // Expected
      }
    });

    expect(result.current.error?.message).toBe('Request timeout');
  });

  it('should clear error on successful subsequent check', async () => {
    mockCheckAccess
      .mockRejectedValueOnce(new Error('First error'))
      .mockResolvedValueOnce(createAllowedResult());

    const { result } = renderHook(() => useDayCloseAccess());

    // First check fails
    await act(async () => {
      try {
        await result.current.checkAccess('1234');
      } catch {
        // Expected
      }
    });
    expect(result.current.error).not.toBeNull();

    // Second check succeeds
    await act(async () => {
      await result.current.checkAccess('5678');
    });
    expect(result.current.error).toBeNull();
    expect(result.current.lastResult?.allowed).toBe(true);
  });

  it('should start with error = null', () => {
    const { result } = renderHook(() => useDayCloseAccess());

    expect(result.current.error).toBeNull();
  });
});

// ============================================================================
// Security Tests (SEC-010, FE-003)
// ============================================================================

describe('Security compliance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('SEC-010: Authorization enforced server-side', () => {
    it('should delegate authorization decision to backend', async () => {
      mockCheckAccess.mockResolvedValue(createAllowedResult());

      const { result } = renderHook(() => useDayCloseAccess());

      await act(async () => {
        await result.current.checkAccess('1234');
      });

      // Hook should call backend, not make local authorization decisions
      expect(mockCheckAccess).toHaveBeenCalled();
    });

    it('should not bypass backend for any access decision', async () => {
      const deniedResult = createDeniedResult('NOT_SHIFT_OWNER');
      mockCheckAccess.mockResolvedValue(deniedResult);

      const { result } = renderHook(() => useDayCloseAccess());

      const returnedResult = await act(async () => {
        return await result.current.checkAccess('1234');
      });

      // Hook returns exactly what backend returns
      expect(returnedResult.allowed).toBe(false);
      expect(returnedResult.reasonCode).toBe('NOT_SHIFT_OWNER');
    });
  });

  describe('FE-003: No sensitive data stored', () => {
    it('should not store PIN in any state', async () => {
      mockCheckAccess.mockResolvedValue(createAllowedResult());

      const { result } = renderHook(() => useDayCloseAccess());

      await act(async () => {
        await result.current.checkAccess('1234');
      });

      // Check that lastResult doesn't contain PIN
      expect(result.current.lastResult).not.toHaveProperty('pin');

      // Verify hook state shape
      const hookState = result.current;
      expect(hookState).not.toHaveProperty('pin');
      expect(hookState).not.toHaveProperty('lastPin');
      expect(hookState).not.toHaveProperty('storedPin');
    });

    it('should not expose PIN in error state', async () => {
      mockCheckAccess.mockRejectedValue(new Error('Auth failed'));

      const { result } = renderHook(() => useDayCloseAccess());

      await act(async () => {
        try {
          await result.current.checkAccess('1234');
        } catch {
          // Expected
        }
      });

      // Error should not contain PIN
      expect(result.current.error?.message).not.toContain('1234');
    });
  });
});

// ============================================================================
// Business Rule Tests
// ============================================================================

describe('Business rule scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('BR-001: At least one active shift', () => {
    it('should return NO_OPEN_SHIFTS when no shifts exist', async () => {
      const result = createDeniedResult('NO_OPEN_SHIFTS', { openShiftCount: 0 });
      mockCheckAccess.mockResolvedValue(result);

      const { result: hookResult } = renderHook(() => useDayCloseAccess());

      const accessResult = await act(async () => {
        return await hookResult.current.checkAccess('1234');
      });

      expect(accessResult.allowed).toBe(false);
      expect(accessResult.reasonCode).toBe('NO_OPEN_SHIFTS');
      expect(accessResult.openShiftCount).toBe(0);
    });
  });

  describe('BR-002: Exactly one active shift', () => {
    it('should return MULTIPLE_OPEN_SHIFTS when more than one shift exists', async () => {
      const result = createDeniedResult('MULTIPLE_OPEN_SHIFTS', { openShiftCount: 3 });
      mockCheckAccess.mockResolvedValue(result);

      const { result: hookResult } = renderHook(() => useDayCloseAccess());

      const accessResult = await act(async () => {
        return await hookResult.current.checkAccess('1234');
      });

      expect(accessResult.allowed).toBe(false);
      expect(accessResult.reasonCode).toBe('MULTIPLE_OPEN_SHIFTS');
      expect(accessResult.openShiftCount).toBe(3);
    });
  });

  describe('BR-003: Cashier ownership', () => {
    it('should return NOT_SHIFT_OWNER when user is not cashier', async () => {
      const result = createDeniedResult('NOT_SHIFT_OWNER', {
        openShiftCount: 1,
        activeShift: createActiveShift({ cashier_id: 'other-cashier' }),
        user: createAccessUser({ userId: 'current-user' }),
      });
      mockCheckAccess.mockResolvedValue(result);

      const { result: hookResult } = renderHook(() => useDayCloseAccess());

      const accessResult = await act(async () => {
        return await hookResult.current.checkAccess('1234');
      });

      expect(accessResult.allowed).toBe(false);
      expect(accessResult.reasonCode).toBe('NOT_SHIFT_OWNER');
    });
  });

  describe('BR-004: Manager override', () => {
    it('should allow shift_manager override', async () => {
      const result = createAllowedResult({
        accessType: 'OVERRIDE',
        user: createAccessUser({ role: 'shift_manager' }),
      });
      mockCheckAccess.mockResolvedValue(result);

      const { result: hookResult } = renderHook(() => useDayCloseAccess());

      const accessResult = await act(async () => {
        return await hookResult.current.checkAccess('1234');
      });

      expect(accessResult.allowed).toBe(true);
      expect(accessResult.accessType).toBe('OVERRIDE');
      expect(accessResult.user?.role).toBe('shift_manager');
    });

    it('should allow store_manager override', async () => {
      const result = createAllowedResult({
        accessType: 'OVERRIDE',
        user: createAccessUser({ role: 'store_manager' }),
      });
      mockCheckAccess.mockResolvedValue(result);

      const { result: hookResult } = renderHook(() => useDayCloseAccess());

      const accessResult = await act(async () => {
        return await hookResult.current.checkAccess('1234');
      });

      expect(accessResult.allowed).toBe(true);
      expect(accessResult.accessType).toBe('OVERRIDE');
      expect(accessResult.user?.role).toBe('store_manager');
    });
  });

  describe('BR-005: PIN verification first', () => {
    it('should return INVALID_PIN for wrong PIN', async () => {
      const result = createDeniedResult('INVALID_PIN');
      mockCheckAccess.mockResolvedValue(result);

      const { result: hookResult } = renderHook(() => useDayCloseAccess());

      const accessResult = await act(async () => {
        return await hookResult.current.checkAccess('0000');
      });

      expect(accessResult.allowed).toBe(false);
      expect(accessResult.reasonCode).toBe('INVALID_PIN');
    });
  });
});
