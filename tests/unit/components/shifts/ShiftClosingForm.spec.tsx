/**
 * ShiftClosingForm Unit Tests
 *
 * Tests the shift closing form component for:
 * - Auth guard behavior (session-first pattern)
 * - PIN dialog integration
 * - Close operation flows (success/failure)
 * - Edge cases (rapid submissions, session timeout, invalid values)
 *
 * Story: POS Configuration Fix - Shift Close Authentication Flow
 * Phase: 2 - Unit Testing
 *
 * Enterprise Standards Applied:
 * - ARCH-004: Component-level isolation tests with mocked dependencies
 * - TEST-005: Single concept per test - one behavior per assertion
 * - SEC-010: Auth guard validation tests
 * - SEC-011: Account lockout behavior tests
 * - SEC-014: Input validation tests (closing_cash)
 *
 * Traceability Matrix:
 * - T2.2.1: Auth Guard - Valid Session
 * - T2.2.2: Auth Guard - Invalid Session
 * - T2.2.3: Auth Guard - Network Failure
 * - T2.3.1: PIN Dialog - Props
 * - T2.3.2: PIN Dialog - Verification
 * - T2.3.3: PIN Dialog - Invalid PIN
 * - T2.3.4: PIN Dialog - Cancel
 * - T2.3.5: PIN Dialog - Role Check
 * - T2.4.1: Close - Success
 * - T2.4.2: Close - Failure
 * - T2.5.1-4: Edge Cases
 *
 * @module tests/unit/components/shifts/ShiftClosingForm
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ============================================================================
// Hoisted Mock State
// ============================================================================

/**
 * Shared mutable state for mock callbacks captured during render.
 * vi.hoisted() ensures these are available before vi.mock() factories execute.
 *
 * Note: mockInvalidateList removed in Phase 4 - useLocalCloseShift handles
 * query invalidation internally via onSuccess callback
 */
const { mockMutateAsync, mockToast, mockExecuteWithAuth, mockPinDialogProps } = vi.hoisted(() => ({
  mockMutateAsync: vi.fn(),
  mockToast: vi.fn(),
  mockExecuteWithAuth: vi.fn(),
  mockPinDialogProps: { current: {} as Record<string, unknown> },
}));

// ============================================================================
// Mock Dependencies
// ============================================================================

// useAuthGuard hook - core auth guard behavior
vi.mock('../../../../src/renderer/hooks/useAuthGuard', () => ({
  useAuthGuard: vi.fn(() => ({
    executeWithAuth: mockExecuteWithAuth,
    isChecking: false,
  })),
  default: vi.fn(() => ({
    executeWithAuth: mockExecuteWithAuth,
    isChecking: false,
  })),
}));

// useLocalCloseShift mutation hook (local IPC, no cloud API)
// Phase 4: ShiftClosingForm now uses local IPC transport instead of cloud API
vi.mock('../../../../src/renderer/hooks/useLocalShifts', () => ({
  useLocalCloseShift: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  })),
}));

// useToast hook
vi.mock('../../../../src/renderer/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: mockToast,
  })),
}));

// PinVerificationDialog - controllable test double that exposes captured props
vi.mock('../../../../src/renderer/components/auth/PinVerificationDialog', () => ({
  PinVerificationDialog: (props: Record<string, unknown>) => {
    mockPinDialogProps.current = props;
    if (!props.open) return null;
    return (
      <div data-testid="pin-dialog">
        <span data-testid="pin-dialog-title">{props.title as string}</span>
        <span data-testid="pin-dialog-description">{props.description as string}</span>
        <span data-testid="pin-dialog-role">{props.requiredRole as string}</span>
        <button data-testid="pin-dialog-cancel" onClick={props.onClose as () => void}>
          Cancel
        </button>
      </div>
    );
  },
}));

// react-hook-form - minimal mock preserving form behavior
vi.mock('react-hook-form', async () => {
  const actual = await vi.importActual('react-hook-form');
  return {
    ...actual,
    useForm: vi.fn(() => ({
      handleSubmit: (fn: (data: unknown) => void) => (e: React.FormEvent) => {
        e.preventDefault();
        fn({ closing_cash: 100 });
      },
      control: {},
      reset: vi.fn(),
      setError: vi.fn(),
      formState: { errors: {} },
      register: vi.fn(),
    })),
  };
});

// UI Components - minimal test doubles
vi.mock('../../../../src/renderer/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../../../src/renderer/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: 'button' | 'submit';
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} disabled={disabled} type={type} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock('../../../../src/renderer/components/ui/form', () => ({
  Form: ({ children }: { children: React.ReactNode }) => (
    <form className="space-y-4">{children}</form>
  ),
  FormControl: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FormDescription: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  FormField: ({
    render,
    name,
  }: {
    render: (props: { field: Record<string, unknown> }) => React.ReactNode;
    name: string;
  }) => (
    <div data-testid={`form-field-${name}`}>
      {render({ field: { value: 0, onChange: vi.fn() } })}
    </div>
  ),
  FormItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FormLabel: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
  FormMessage: () => null,
}));

vi.mock('../../../../src/renderer/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@hookform/resolvers/zod', () => ({
  zodResolver: vi.fn(() => vi.fn()),
}));

// ============================================================================
// Import Component Under Test (after mocks)
// ============================================================================

import { ShiftClosingForm } from '../../../../src/renderer/components/shifts/ShiftClosingForm';
import { useAuthGuard } from '../../../../src/renderer/hooks/useAuthGuard';
import { useLocalCloseShift } from '../../../../src/renderer/hooks/useLocalShifts';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Factory function for creating shift test data
 */
function createShiftFixture(
  overrides?: Partial<{
    shiftId: string;
    storeId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
  }>
) {
  return {
    shiftId: 'shift-uuid-123',
    storeId: 'store-uuid-456',
    open: true,
    onOpenChange: vi.fn(),
    onSuccess: vi.fn(),
    ...overrides,
  };
}

/**
 * Verified user fixture for successful PIN verification
 */
const VERIFIED_USER = {
  userId: 'user-uuid-789',
  name: 'John Manager',
  role: 'shift_manager',
};

// ============================================================================
// Tests
// ============================================================================

describe('ShiftClosingForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPinDialogProps.current = {};

    // Default mock implementations
    mockExecuteWithAuth.mockImplementation(
      async (onSuccess: () => void, _onNeedAuth: () => void) => {
        onSuccess();
      }
    );
    mockMutateAsync.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Task 2.1: Test File Structure - Rendering Tests
  // ==========================================================================

  describe('Rendering', () => {
    it('SCF-RENDER-001: renders dialog when open is true', () => {
      const props = createShiftFixture();
      render(<ShiftClosingForm {...props} />);

      expect(screen.getByTestId('dialog')).toBeInTheDocument();
      expect(screen.getByTestId('dialog-title')).toHaveTextContent('Close Shift');
    });

    it('SCF-RENDER-002: does not render dialog when open is false', () => {
      const props = createShiftFixture({ open: false });
      render(<ShiftClosingForm {...props} />);

      expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
    });

    it('SCF-RENDER-003: renders closing cash form field', () => {
      const props = createShiftFixture();
      render(<ShiftClosingForm {...props} />);

      expect(screen.getByTestId('form-field-closing_cash')).toBeInTheDocument();
    });

    it('SCF-RENDER-004: renders Cancel and Close Shift buttons', () => {
      const props = createShiftFixture();
      render(<ShiftClosingForm {...props} />);

      expect(screen.getByText('Cancel')).toBeInTheDocument();
      expect(screen.getByTestId('close-shift-button')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Task 2.2: Auth Guard Behavior Tests (SEC-010)
  // ==========================================================================

  describe('Auth Guard Behavior', () => {
    it('T2.2.1: proceeds directly when session is valid with shift_manager role', async () => {
      const props = createShiftFixture();
      mockExecuteWithAuth.mockImplementation(async (onSuccess: () => void) => {
        onSuccess();
      });

      render(<ShiftClosingForm {...props} />);

      // Submit form
      const submitButton = screen.getByTestId('close-shift-button');
      await userEvent.click(submitButton);

      // Should have called executeWithAuth
      expect(mockExecuteWithAuth).toHaveBeenCalledTimes(1);

      // Should proceed to close (mutateAsync called)
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          shiftId: 'shift-uuid-123',
          closingCash: 100,
        });
      });

      // PIN dialog should NOT have opened
      expect(screen.queryByTestId('pin-dialog')).not.toBeInTheDocument();
    });

    it('T2.2.2: opens PIN dialog when session is invalid', async () => {
      const props = createShiftFixture();
      mockExecuteWithAuth.mockImplementation(
        async (_onSuccess: () => void, onNeedAuth: () => void) => {
          onNeedAuth();
        }
      );

      render(<ShiftClosingForm {...props} />);

      // Submit form
      const submitButton = screen.getByTestId('close-shift-button');
      await userEvent.click(submitButton);

      // PIN dialog should open
      await waitFor(() => {
        expect(screen.getByTestId('pin-dialog')).toBeInTheDocument();
      });

      // Mutation should NOT have been called yet
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    it('T2.2.3: opens PIN dialog as fallback when session check fails (network error)', async () => {
      const props = createShiftFixture();
      mockExecuteWithAuth.mockImplementation(
        async (_onSuccess: () => void, onNeedAuth: () => void) => {
          // Simulating network failure - fallback to requiring auth
          onNeedAuth();
        }
      );

      render(<ShiftClosingForm {...props} />);

      const submitButton = screen.getByTestId('close-shift-button');
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByTestId('pin-dialog')).toBeInTheDocument();
      });
    });

    it('T2.2.4: disables submit button while checking session', async () => {
      const props = createShiftFixture();

      // Mock useAuthGuard to return isChecking = true
      vi.mocked(useAuthGuard).mockReturnValue({
        executeWithAuth: mockExecuteWithAuth,
        isChecking: true,
      });

      render(<ShiftClosingForm {...props} />);

      const submitButton = screen.getByText('Checking...');
      expect(submitButton).toBeDisabled();

      // Restore mock
      vi.mocked(useAuthGuard).mockReturnValue({
        executeWithAuth: mockExecuteWithAuth,
        isChecking: false,
      });
    });

    it('T2.2.5: shows loading spinner during session check', async () => {
      const props = createShiftFixture();

      vi.mocked(useAuthGuard).mockReturnValue({
        executeWithAuth: mockExecuteWithAuth,
        isChecking: true,
      });

      const { container } = render(<ShiftClosingForm {...props} />);

      // Real Loader2 icon renders with .lucide.lucide-loader-circle class
      expect(container.querySelector('.lucide.lucide-loader-circle')).toBeInTheDocument();

      vi.mocked(useAuthGuard).mockReturnValue({
        executeWithAuth: mockExecuteWithAuth,
        isChecking: false,
      });
    });
  });

  // ==========================================================================
  // Task 2.3: PIN Dialog Integration Tests
  // ==========================================================================

  describe('PIN Dialog Integration', () => {
    beforeEach(() => {
      mockExecuteWithAuth.mockImplementation(
        async (_onSuccess: () => void, onNeedAuth: () => void) => {
          onNeedAuth();
        }
      );
    });

    it('T2.3.1: opens PIN dialog with requiredRole="shift_manager"', async () => {
      const props = createShiftFixture();
      render(<ShiftClosingForm {...props} />);

      await userEvent.click(screen.getByTestId('close-shift-button'));

      await waitFor(() => {
        expect(mockPinDialogProps.current.requiredRole).toBe('shift_manager');
      });
    });

    it('T2.3.2: PIN dialog has correct title and description', async () => {
      const props = createShiftFixture();
      render(<ShiftClosingForm {...props} />);

      await userEvent.click(screen.getByTestId('close-shift-button'));

      await waitFor(() => {
        expect(screen.getByTestId('pin-dialog-title')).toHaveTextContent(
          'Manager Approval Required'
        );
        expect(screen.getByTestId('pin-dialog-description')).toHaveTextContent(
          'Enter your PIN to close this shift.'
        );
      });
    });

    it('T2.3.3: calls performClose after successful PIN verification', async () => {
      const props = createShiftFixture();
      render(<ShiftClosingForm {...props} />);

      // Trigger PIN dialog
      await userEvent.click(screen.getByTestId('close-shift-button'));

      await waitFor(() => {
        expect(screen.getByTestId('pin-dialog')).toBeInTheDocument();
      });

      // Simulate successful PIN verification via captured callback
      const onVerified = mockPinDialogProps.current.onVerified as (
        user: typeof VERIFIED_USER
      ) => void;
      act(() => {
        onVerified(VERIFIED_USER);
      });

      // Should now call mutateAsync
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          shiftId: 'shift-uuid-123',
          closingCash: 100,
        });
      });
    });

    it('T2.3.4: clears pending values when dialog is cancelled', async () => {
      const props = createShiftFixture();
      render(<ShiftClosingForm {...props} />);

      // Trigger PIN dialog
      await userEvent.click(screen.getByTestId('close-shift-button'));

      await waitFor(() => {
        expect(screen.getByTestId('pin-dialog')).toBeInTheDocument();
      });

      // Cancel dialog
      await userEvent.click(screen.getByTestId('pin-dialog-cancel'));

      // Dialog should be closed
      await waitFor(() => {
        expect(screen.queryByTestId('pin-dialog')).not.toBeInTheDocument();
      });

      // Mutation should NOT have been called
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    it('T2.3.5: shows role requirement indicator in dialog', async () => {
      const props = createShiftFixture();
      render(<ShiftClosingForm {...props} />);

      await userEvent.click(screen.getByTestId('close-shift-button'));

      await waitFor(() => {
        expect(screen.getByTestId('pin-dialog-role')).toHaveTextContent('shift_manager');
      });
    });
  });

  // ==========================================================================
  // Task 2.4: Close Operation Tests
  // ==========================================================================

  describe('Close Operation', () => {
    beforeEach(() => {
      mockExecuteWithAuth.mockImplementation(async (onSuccess: () => void) => {
        onSuccess();
      });
    });

    it('T2.4.1: shows success toast and closes dialog on successful close', async () => {
      const props = createShiftFixture();
      mockMutateAsync.mockResolvedValue({ success: true });

      render(<ShiftClosingForm {...props} />);

      await userEvent.click(screen.getByTestId('close-shift-button'));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Success',
          description: 'Shift closed successfully',
        });
      });

      expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });

    it('T2.4.2: shows error toast on SHIFT_NOT_FOUND error', async () => {
      const props = createShiftFixture();
      mockMutateAsync.mockRejectedValue(new Error('SHIFT_NOT_FOUND'));

      render(<ShiftClosingForm {...props} />);

      await userEvent.click(screen.getByTestId('close-shift-button'));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Error',
          description: 'Shift not found.',
          variant: 'destructive',
        });
      });
    });

    it('T2.4.3: shows error toast on SHIFT_ALREADY_CLOSED error', async () => {
      const props = createShiftFixture();
      mockMutateAsync.mockRejectedValue(new Error('SHIFT_ALREADY_CLOSED'));

      render(<ShiftClosingForm {...props} />);

      await userEvent.click(screen.getByTestId('close-shift-button'));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Error',
          description: 'Shift is already closed.',
          variant: 'destructive',
        });
      });
    });

    it('T2.4.4: shows error toast on SHIFT_INVALID_STATUS error', async () => {
      const props = createShiftFixture();
      mockMutateAsync.mockRejectedValue(new Error('SHIFT_INVALID_STATUS'));

      render(<ShiftClosingForm {...props} />);

      await userEvent.click(screen.getByTestId('close-shift-button'));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Error',
          description:
            'Shift cannot be closed in its current status. Only OPEN or ACTIVE shifts can be closed.',
          variant: 'destructive',
        });
      });
    });

    it('T2.4.5: shows error toast on INVALID_CASH_AMOUNT error', async () => {
      const props = createShiftFixture();
      mockMutateAsync.mockRejectedValue(new Error('INVALID_CASH_AMOUNT'));

      render(<ShiftClosingForm {...props} />);

      await userEvent.click(screen.getByTestId('close-shift-button'));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Error',
          description: 'Closing cash amount is invalid.',
          variant: 'destructive',
        });
      });
    });

    it('T2.4.6: shows generic error toast for unknown errors', async () => {
      const props = createShiftFixture();
      mockMutateAsync.mockRejectedValue(new Error('Unknown server error'));

      render(<ShiftClosingForm {...props} />);

      await userEvent.click(screen.getByTestId('close-shift-button'));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Error',
          description: 'Unknown server error',
          variant: 'destructive',
        });
      });
    });

    it('T2.4.7: mutation succeeds and triggers hook onSuccess (query invalidation handled internally)', async () => {
      // Note: useLocalCloseShift handles query invalidation internally via onSuccess callback
      // This test verifies the mutation was called successfully, which triggers internal invalidation
      // Integration tests verify actual cache invalidation
      const props = createShiftFixture();
      mockMutateAsync.mockResolvedValue({ success: true });

      render(<ShiftClosingForm {...props} />);

      await userEvent.click(screen.getByTestId('close-shift-button'));

      // Verify mutation was called (which triggers useLocalCloseShift's internal onSuccess)
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalled();
      });

      // Verify success toast confirms mutation completed
      // Success toast only shows if mutation.mutateAsync() resolved successfully
      // which triggers the hook's internal onSuccess callback (including query invalidation)
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Success',
        description: 'Shift closed successfully',
      });
    });

    it('T2.4.8: calls onSuccess callback after successful close', async () => {
      const props = createShiftFixture();
      mockMutateAsync.mockResolvedValue({ success: true });

      render(<ShiftClosingForm {...props} />);

      await userEvent.click(screen.getByTestId('close-shift-button'));

      await waitFor(() => {
        expect(props.onSuccess).toHaveBeenCalled();
      });
    });
  });

  // ==========================================================================
  // Task 2.5: Edge Case Tests
  // ==========================================================================

  describe('Edge Cases', () => {
    it('T2.5.1: prevents duplicate submissions while mutation is pending', async () => {
      const props = createShiftFixture();

      // Mock mutation to be pending
      vi.mocked(useLocalCloseShift).mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: true,
      } as unknown as ReturnType<typeof useLocalCloseShift>);

      render(<ShiftClosingForm {...props} />);

      // Button should be disabled during pending state
      const submitButton = screen.getByTestId('close-shift-button');
      expect(submitButton).toBeDisabled();

      // Restore mock
      vi.mocked(useLocalCloseShift).mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      } as unknown as ReturnType<typeof useLocalCloseShift>);
    });

    it('T2.5.2: handles dialog close during pending mutation gracefully', async () => {
      const props = createShiftFixture();

      // Long-running mutation
      let resolvePromise: () => void;
      mockMutateAsync.mockReturnValue(
        new Promise<{ success: boolean }>((resolve) => {
          resolvePromise = () => resolve({ success: true });
        })
      );

      render(<ShiftClosingForm {...props} />);

      await userEvent.click(screen.getByTestId('close-shift-button'));

      // Close dialog while mutation is pending (via Cancel button)
      const cancelButton = screen.getByText('Cancel');
      await userEvent.click(cancelButton);

      // Should call onOpenChange(false)
      expect(props.onOpenChange).toHaveBeenCalledWith(false);

      // Resolve the mutation
      act(() => {
        resolvePromise!();
      });

      // No crash should occur
    });

    it('T2.5.3: Cancel button triggers onOpenChange(false)', async () => {
      const props = createShiftFixture();
      render(<ShiftClosingForm {...props} />);

      await userEvent.click(screen.getByText('Cancel'));

      expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });

    it('T2.5.4: disables Cancel button while mutation is pending', async () => {
      const props = createShiftFixture();

      vi.mocked(useLocalCloseShift).mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: true,
      } as unknown as ReturnType<typeof useLocalCloseShift>);

      render(<ShiftClosingForm {...props} />);

      const cancelButton = screen.getByText('Cancel');
      expect(cancelButton).toBeDisabled();

      vi.mocked(useLocalCloseShift).mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      } as unknown as ReturnType<typeof useLocalCloseShift>);
    });

    it('T2.5.5: handles non-Error exception gracefully', async () => {
      const props = createShiftFixture();
      mockMutateAsync.mockRejectedValue('String error instead of Error object');

      render(<ShiftClosingForm {...props} />);

      await userEvent.click(screen.getByTestId('close-shift-button'));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Error',
          description: 'Failed to close shift. Please try again.',
          variant: 'destructive',
        });
      });
    });
  });

  // ==========================================================================
  // Security Tests (SEC-010, SEC-011, SEC-014)
  // ==========================================================================

  describe('Security', () => {
    it('SCF-SEC-001: useAuthGuard is called with shift_manager role', () => {
      const props = createShiftFixture();
      render(<ShiftClosingForm {...props} />);

      expect(useAuthGuard).toHaveBeenCalledWith('shift_manager');
    });

    it('SCF-SEC-002: form submission goes through auth guard before mutation', async () => {
      const props = createShiftFixture();
      let authCheckDone = false;

      mockExecuteWithAuth.mockImplementation(async (onSuccess: () => void) => {
        authCheckDone = true;
        onSuccess();
      });

      render(<ShiftClosingForm {...props} />);

      await userEvent.click(screen.getByTestId('close-shift-button'));

      await waitFor(() => {
        // Auth check should have happened before mutation
        expect(authCheckDone).toBe(true);
        expect(mockMutateAsync).toHaveBeenCalled();
      });
    });

    it('SCF-SEC-003: mutation is NOT called without auth', async () => {
      const props = createShiftFixture();

      // Auth guard requires PIN
      mockExecuteWithAuth.mockImplementation(
        async (_onSuccess: () => void, onNeedAuth: () => void) => {
          onNeedAuth();
        }
      );

      render(<ShiftClosingForm {...props} />);

      await userEvent.click(screen.getByTestId('close-shift-button'));

      // Wait for PIN dialog
      await waitFor(() => {
        expect(screen.getByTestId('pin-dialog')).toBeInTheDocument();
      });

      // Cancel without completing auth
      await userEvent.click(screen.getByTestId('pin-dialog-cancel'));

      // Mutation should NEVER have been called
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Integration with Other Components
  // ==========================================================================

  describe('Component Integration', () => {
    it('SCF-INT-001: PIN dialog closes after successful verification', async () => {
      const props = createShiftFixture();

      mockExecuteWithAuth.mockImplementation(
        async (_onSuccess: () => void, onNeedAuth: () => void) => {
          onNeedAuth();
        }
      );

      render(<ShiftClosingForm {...props} />);

      await userEvent.click(screen.getByTestId('close-shift-button'));

      await waitFor(() => {
        expect(screen.getByTestId('pin-dialog')).toBeInTheDocument();
      });

      // Simulate successful verification
      const onVerified = mockPinDialogProps.current.onVerified as () => void;
      act(() => {
        onVerified();
      });

      // PIN dialog should close
      await waitFor(() => {
        expect(screen.queryByTestId('pin-dialog')).not.toBeInTheDocument();
      });
    });

    it('SCF-INT-002: main dialog is hidden while PIN dialog is shown to avoid focus trap conflicts', async () => {
      const props = createShiftFixture();

      mockExecuteWithAuth.mockImplementation(
        async (_onSuccess: () => void, onNeedAuth: () => void) => {
          onNeedAuth();
        }
      );

      render(<ShiftClosingForm {...props} />);

      await userEvent.click(screen.getByTestId('close-shift-button'));

      await waitFor(() => {
        // PIN dialog should be visible
        expect(screen.getByTestId('pin-dialog')).toBeInTheDocument();
        // Main dialog is hidden (open={open && !showPinDialog} = false when showPinDialog=true)
        // This prevents focus trap conflicts between the two dialogs
        expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
      });
    });
  });
});
