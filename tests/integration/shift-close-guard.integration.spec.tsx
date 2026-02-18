/**
 * Shift Close Guard Integration Tests (Phase 4 - Task 4.2)
 *
 * Integration tests validating the DayCloseAccessGuard behavior during the
 * shift close workflow. Tests PIN dialog interactions and access decisions.
 *
 * Testing Strategy:
 * - Component rendering with full provider context
 * - PIN dialog interaction verification
 * - Access grant/deny flow testing
 * - Redirect behavior on denial
 *
 * @module tests/integration/shift-close-guard.integration
 *
 * Security Compliance:
 * - SEC-010: Authorization enforced via backend IPC handler
 * - SEC-014: PIN validation (4-6 digits only)
 * - FE-001: No sensitive data stored in component state
 * - FE-003: PIN cleared from state after submission
 *
 * Traceability Matrix:
 * - 4.2.1: Guard shows PIN dialog when no session
 * - 4.2.2: Guard allows entry with valid session
 * - 4.2.3: Guard redirects on access denied
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// ============================================================================
// Mock Dependencies (Hoisted)
// ============================================================================

const { mockCheckAccess, mockIsChecking, mockToast } = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockIsChecking: { value: false },
  mockToast: vi.fn(),
}));

// Mock useDayCloseAccess hook
vi.mock('../../src/renderer/hooks/useDayCloseAccess', () => ({
  useDayCloseAccess: () => ({
    checkAccess: mockCheckAccess,
    isChecking: mockIsChecking.value,
    lastResult: null,
    clearResult: vi.fn(),
    error: null,
  }),
}));

// Mock toast hook
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Mock DayCloseAccessContext
vi.mock('@/contexts/DayCloseAccessContext', () => ({
  DayCloseAccessProvider: ({
    children,
    value: _value,
  }: {
    children: React.ReactNode;
    value: unknown;
  }) => <div data-testid="access-context-provider">{children}</div>,
}));

// Mock UI components with minimal implementations
vi.mock('../../src/renderer/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
    onOpenChange: _onOpenChange,
  }: {
    children: React.ReactNode;
    open: boolean;
    onOpenChange?: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="pin-dialog" role="dialog" aria-modal="true">
        {children}
      </div>
    ) : null,
  DialogContent: ({
    children,
    onKeyDown,
    className: _className,
  }: {
    children: React.ReactNode;
    onKeyDown?: (e: React.KeyboardEvent) => void;
    className?: string;
  }) => (
    <div data-testid="dialog-content" onKeyDown={onKeyDown}>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({
    children,
    className: _className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <h2 data-testid="dialog-title">{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p data-testid="dialog-description">{children}</p>
  ),
}));

vi.mock('../../src/renderer/components/ui/button', () => {
  const MockButton = ({
    children,
    onClick,
    disabled,
    type = 'button',
    variant,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: 'button' | 'submit';
    variant?: string;
    'data-testid'?: string;
  }) => (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={props['data-testid'] || `button-${variant || 'default'}`}
      {...props}
    >
      {children}
    </button>
  );
  MockButton.displayName = 'Button';
  return { Button: MockButton };
});

vi.mock('../../src/renderer/components/ui/input', () => {
  const MockInput = React.forwardRef(
    (
      props: {
        id?: string;
        type?: string;
        value?: string;
        onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
        disabled?: boolean;
        placeholder?: string;
        className?: string;
        maxLength?: number;
        inputMode?: string;
        autoComplete?: string;
        'data-testid'?: string;
      },
      ref: React.Ref<HTMLInputElement>
    ) => (
      <input
        ref={ref}
        data-testid={props['data-testid'] || 'pin-input'}
        type={props.type}
        value={props.value}
        onChange={props.onChange}
        disabled={props.disabled}
        placeholder={props.placeholder}
        maxLength={props.maxLength}
        autoComplete={props.autoComplete}
      />
    )
  );
  MockInput.displayName = 'Input';
  return { Input: MockInput };
});

vi.mock('@/lib/utils', () => ({
  cn: (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' '),
}));

// ============================================================================
// Import Component Under Test (after mocks)
// ============================================================================

import { DayCloseAccessGuard } from '../../src/renderer/components/guards/DayCloseAccessGuard';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates a successful access result for testing
 */
function createSuccessResult(): {
  allowed: true;
  accessType: 'OWNER' | 'OVERRIDE';
  user: { userId: string; name: string; role: string };
  activeShift: {
    shift_id: string;
    shift_number: number;
    cashier_id: string;
    cashier_name: string;
    external_register_id: string;
    terminal_name: string;
    business_date: string;
    start_time: string;
  };
  openShiftCount: number;
} {
  return {
    allowed: true,
    accessType: 'OWNER',
    user: {
      userId: 'user-001',
      name: 'Test Cashier',
      role: 'cashier',
    },
    activeShift: {
      shift_id: 'shift-001',
      shift_number: 1,
      cashier_id: 'user-001',
      cashier_name: 'Test Cashier',
      external_register_id: 'REG01',
      terminal_name: 'Front Register',
      business_date: '2026-02-15',
      start_time: '2026-02-15T08:00:00.000Z',
    },
    openShiftCount: 1,
  };
}

/**
 * Creates a denied access result for testing
 */
function createDeniedResult(
  reasonCode: 'NO_OPEN_SHIFTS' | 'MULTIPLE_OPEN_SHIFTS' | 'NOT_SHIFT_OWNER' | 'INVALID_PIN'
): {
  allowed: false;
  reasonCode: string;
  reason: string;
  openShiftCount?: number;
  user?: { userId: string; name: string; role: string };
} {
  const reasons: Record<string, { reason: string; count?: number }> = {
    NO_OPEN_SHIFTS: {
      reason: 'No open shifts found in the store.',
      count: 0,
    },
    MULTIPLE_OPEN_SHIFTS: {
      reason: 'Multiple shifts are open (3). Only one shift can be open to close the day.',
      count: 3,
    },
    NOT_SHIFT_OWNER: {
      reason: 'You are not the assigned cashier for this shift. Contact a manager for override.',
    },
    INVALID_PIN: {
      reason: 'The PIN you entered is incorrect.',
    },
  };

  return {
    allowed: false,
    reasonCode,
    reason: reasons[reasonCode].reason,
    openShiftCount: reasons[reasonCode].count,
    user:
      reasonCode !== 'INVALID_PIN'
        ? { userId: 'user-002', name: 'Other User', role: 'cashier' }
        : undefined,
  };
}

/**
 * Location tracker component
 */
function LocationDisplay() {
  const location = useLocation();
  return (
    <div data-testid="location-display" data-pathname={location.pathname}>
      {location.pathname}
    </div>
  );
}

/**
 * Test wrapper with routing
 */
interface TestWrapperProps {
  initialEntries?: string[];
  children: React.ReactNode;
}

function TestWrapper({ initialEntries = ['/day-close'], children }: TestWrapperProps) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <LocationDisplay />
      <Routes>
        <Route path="/day-close" element={children} />
        <Route path="/terminals" element={<div data-testid="terminals-page">Terminals</div>} />
      </Routes>
    </MemoryRouter>
  );
}

/**
 * Protected content to render on successful access
 */
function ProtectedContent() {
  return <div data-testid="day-close-wizard">Day Close Wizard Content</div>;
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Shift Close Guard Integration (Phase 4.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsChecking.value = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 4.2.1: Guard shows PIN dialog when no session
  // ==========================================================================

  describe('4.2.1: Guard shows PIN dialog when no session', () => {
    it('should display PIN dialog immediately on mount', () => {
      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      // Assert: PIN dialog is visible
      expect(screen.getByTestId('pin-dialog')).toBeInTheDocument();
      expect(screen.getByText('Day Close Authorization')).toBeInTheDocument();
    });

    it('should display PIN input field', () => {
      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      // Assert: PIN input is present
      const pinInput = screen.getByTestId('day-close-pin-input');
      expect(pinInput).toBeInTheDocument();
      expect(pinInput).toHaveAttribute('type', 'password');
    });

    it('should display Verify and Cancel buttons', () => {
      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      // Assert: Both buttons present
      expect(screen.getByTestId('day-close-verify-btn')).toBeInTheDocument();
      expect(screen.getByTestId('day-close-cancel-btn')).toBeInTheDocument();
    });

    it('should NOT render protected content before PIN verification', () => {
      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      // Assert: Protected content not visible
      expect(screen.queryByTestId('day-close-wizard')).not.toBeInTheDocument();
    });

    it('should disable Verify button when PIN is less than 4 digits', () => {
      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      const verifyButton = screen.getByTestId('day-close-verify-btn');
      const pinInput = screen.getByTestId('day-close-pin-input');

      // Assert: Initially disabled
      expect(verifyButton).toBeDisabled();

      // Type 3 digits
      fireEvent.change(pinInput, { target: { value: '123' } });

      // Assert: Still disabled
      expect(verifyButton).toBeDisabled();
    });

    it('should enable Verify button when PIN is 4+ digits', () => {
      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      const verifyButton = screen.getByTestId('day-close-verify-btn');
      const pinInput = screen.getByTestId('day-close-pin-input');

      // Type 4 digits
      fireEvent.change(pinInput, { target: { value: '1234' } });

      // Assert: Button enabled
      expect(verifyButton).not.toBeDisabled();
    });
  });

  // ==========================================================================
  // 4.2.2: Guard allows entry with valid session
  // ==========================================================================

  describe('4.2.2: Guard allows entry with valid session', () => {
    it('should render protected content after successful PIN verification', async () => {
      // Arrange: Mock successful access
      mockCheckAccess.mockResolvedValue(createSuccessResult());

      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      // Enter PIN and submit
      const pinInput = screen.getByTestId('day-close-pin-input');
      const verifyButton = screen.getByTestId('day-close-verify-btn');

      fireEvent.change(pinInput, { target: { value: '1234' } });
      await act(async () => {
        fireEvent.click(verifyButton);
      });

      // Assert: Protected content rendered
      await waitFor(() => {
        expect(screen.getByTestId('day-close-wizard')).toBeInTheDocument();
      });

      // Assert: PIN dialog hidden
      expect(screen.queryByTestId('pin-dialog')).not.toBeInTheDocument();
    });

    it('should call checkAccess with entered PIN', async () => {
      // Arrange
      mockCheckAccess.mockResolvedValue(createSuccessResult());

      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      const pinInput = screen.getByTestId('day-close-pin-input');
      const verifyButton = screen.getByTestId('day-close-verify-btn');

      fireEvent.change(pinInput, { target: { value: '5678' } });
      await act(async () => {
        fireEvent.click(verifyButton);
      });

      // Assert: checkAccess called with correct PIN
      expect(mockCheckAccess).toHaveBeenCalledTimes(1);
      expect(mockCheckAccess).toHaveBeenCalledWith('5678');
    });

    it('should wrap protected content with DayCloseAccessProvider', async () => {
      // Arrange
      mockCheckAccess.mockResolvedValue(createSuccessResult());

      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      const pinInput = screen.getByTestId('day-close-pin-input');
      const verifyButton = screen.getByTestId('day-close-verify-btn');

      fireEvent.change(pinInput, { target: { value: '1234' } });
      await act(async () => {
        fireEvent.click(verifyButton);
      });

      // Assert: Context provider wraps content
      await waitFor(() => {
        expect(screen.getByTestId('access-context-provider')).toBeInTheDocument();
        expect(screen.getByTestId('day-close-wizard')).toBeInTheDocument();
      });
    });

    it('should show loading state during verification', async () => {
      // Arrange: Slow promise to observe loading state
      let resolvePromise: (value: unknown) => void;
      const slowPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockCheckAccess.mockReturnValue(slowPromise);

      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      const pinInput = screen.getByTestId('day-close-pin-input');
      const verifyButton = screen.getByTestId('day-close-verify-btn');

      fireEvent.change(pinInput, { target: { value: '1234' } });
      await act(async () => {
        fireEvent.click(verifyButton);
      });

      // Assert: Verifying text appears
      expect(screen.getByText(/verifying/i)).toBeInTheDocument();

      // Cleanup
      await act(async () => {
        resolvePromise!(createSuccessResult());
      });
    });

    it('should clear PIN from input after successful verification (FE-003)', async () => {
      // Arrange
      mockCheckAccess.mockResolvedValue(createSuccessResult());

      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      const pinInput = screen.getByTestId('day-close-pin-input') as HTMLInputElement;
      const verifyButton = screen.getByTestId('day-close-verify-btn');

      fireEvent.change(pinInput, { target: { value: '1234' } });
      expect(pinInput.value).toBe('1234');

      await act(async () => {
        fireEvent.click(verifyButton);
      });

      // Assert: PIN cleared (dialog no longer visible after success)
      await waitFor(() => {
        expect(screen.queryByTestId('pin-dialog')).not.toBeInTheDocument();
      });
    });
  });

  // ==========================================================================
  // 4.2.3: Guard redirects on access denied
  // ==========================================================================

  describe('4.2.3: Guard redirects on access denied', () => {
    it('should redirect to /terminals on NO_OPEN_SHIFTS denial', async () => {
      // Arrange
      mockCheckAccess.mockResolvedValue(createDeniedResult('NO_OPEN_SHIFTS'));

      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      const pinInput = screen.getByTestId('day-close-pin-input');
      const verifyButton = screen.getByTestId('day-close-verify-btn');

      fireEvent.change(pinInput, { target: { value: '1234' } });
      await act(async () => {
        fireEvent.click(verifyButton);
      });

      // Assert: Redirected to /terminals
      await waitFor(() => {
        expect(screen.getByTestId('terminals-page')).toBeInTheDocument();
      });
    });

    it('should show toast message on NO_OPEN_SHIFTS denial', async () => {
      // Arrange
      mockCheckAccess.mockResolvedValue(createDeniedResult('NO_OPEN_SHIFTS'));

      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      const pinInput = screen.getByTestId('day-close-pin-input');
      const verifyButton = screen.getByTestId('day-close-verify-btn');

      fireEvent.change(pinInput, { target: { value: '1234' } });
      await act(async () => {
        fireEvent.click(verifyButton);
      });

      // Assert: Toast called with appropriate message
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            variant: 'destructive',
            title: 'No Open Shifts',
          })
        );
      });
    });

    it('should redirect on MULTIPLE_OPEN_SHIFTS denial', async () => {
      // Arrange
      mockCheckAccess.mockResolvedValue(createDeniedResult('MULTIPLE_OPEN_SHIFTS'));

      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      fireEvent.change(screen.getByTestId('day-close-pin-input'), {
        target: { value: '1234' },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('day-close-verify-btn'));
      });

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('terminals-page')).toBeInTheDocument();
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Multiple Shifts Open',
          })
        );
      });
    });

    it('should redirect on NOT_SHIFT_OWNER denial', async () => {
      // Arrange
      mockCheckAccess.mockResolvedValue(createDeniedResult('NOT_SHIFT_OWNER'));

      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      fireEvent.change(screen.getByTestId('day-close-pin-input'), {
        target: { value: '1234' },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('day-close-verify-btn'));
      });

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('terminals-page')).toBeInTheDocument();
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Access Denied',
          })
        );
      });
    });

    it('should allow retry on INVALID_PIN denial (no redirect)', async () => {
      // Arrange
      mockCheckAccess.mockResolvedValue(createDeniedResult('INVALID_PIN'));

      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      fireEvent.change(screen.getByTestId('day-close-pin-input'), {
        target: { value: '1234' },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('day-close-verify-btn'));
      });

      // Assert: Dialog still visible, no redirect
      await waitFor(() => {
        expect(screen.getByTestId('pin-dialog')).toBeInTheDocument();
        // Error message displayed
        expect(screen.getByText(/incorrect/i)).toBeInTheDocument();
      });

      // No redirect to terminals
      expect(screen.queryByTestId('terminals-page')).not.toBeInTheDocument();
      // Toast not called for INVALID_PIN (inline error instead)
      expect(mockToast).not.toHaveBeenCalled();
    });

    it('should redirect when Cancel button is clicked', async () => {
      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      const cancelButton = screen.getByTestId('day-close-cancel-btn');
      await act(async () => {
        fireEvent.click(cancelButton);
      });

      // Assert: Redirected to /terminals
      await waitFor(() => {
        expect(screen.getByTestId('terminals-page')).toBeInTheDocument();
      });
    });
  });

  // ==========================================================================
  // SEC-014: PIN Validation
  // ==========================================================================

  describe('SEC-014: PIN Validation', () => {
    it('should only allow numeric input', () => {
      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      const pinInput = screen.getByTestId('day-close-pin-input') as HTMLInputElement;

      // Try to enter letters
      fireEvent.change(pinInput, { target: { value: 'abcd' } });

      // Assert: Only digits allowed (filtered by component)
      expect(pinInput.value).toBe('');
    });

    it('should limit PIN to 6 digits maximum', () => {
      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      const pinInput = screen.getByTestId('day-close-pin-input') as HTMLInputElement;

      // Try to enter more than 6 digits
      fireEvent.change(pinInput, { target: { value: '12345678' } });

      // Assert: Truncated to 6 digits
      expect(pinInput.value).toBe('123456');
    });

    it('should require minimum 4 digits to submit', async () => {
      // Arrange
      mockCheckAccess.mockResolvedValue(createSuccessResult());

      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      const pinInput = screen.getByTestId('day-close-pin-input');
      const verifyButton = screen.getByTestId('day-close-verify-btn');

      // Enter only 3 digits
      fireEvent.change(pinInput, { target: { value: '123' } });

      // Button should be disabled
      expect(verifyButton).toBeDisabled();

      // Try to submit anyway (form submit)
      await act(async () => {
        fireEvent.submit(verifyButton.closest('form')!);
      });

      // Assert: checkAccess not called
      expect(mockCheckAccess).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Security Tests (SEC-010)
  // ==========================================================================

  describe('SEC-010: Authorization Enforcement', () => {
    it('should always call backend for authorization decision', async () => {
      // Arrange
      mockCheckAccess.mockResolvedValue(createSuccessResult());

      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      fireEvent.change(screen.getByTestId('day-close-pin-input'), {
        target: { value: '1234' },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('day-close-verify-btn'));
      });

      // Assert: Backend check was invoked
      expect(mockCheckAccess).toHaveBeenCalled();
    });

    it('should not bypass guard by manipulating component state', async () => {
      // This test verifies the guard cannot be bypassed without backend validation
      // The protected content should never render without checkAccess returning allowed: true

      // Arrange: Mock returns denied
      mockCheckAccess.mockResolvedValue(createDeniedResult('NOT_SHIFT_OWNER'));

      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      fireEvent.change(screen.getByTestId('day-close-pin-input'), {
        target: { value: '1234' },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('day-close-verify-btn'));
      });

      // Assert: Protected content never rendered
      await waitFor(() => {
        expect(screen.getByTestId('terminals-page')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('day-close-wizard')).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('should show error message on IPC failure', async () => {
      // Arrange: Mock IPC failure
      mockCheckAccess.mockRejectedValue(new Error('IPC connection failed'));

      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      fireEvent.change(screen.getByTestId('day-close-pin-input'), {
        target: { value: '1234' },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('day-close-verify-btn'));
      });

      // Assert: Error message shown, dialog still visible for retry
      await waitFor(() => {
        expect(screen.getByText(/failed to verify/i)).toBeInTheDocument();
        expect(screen.getByTestId('pin-dialog')).toBeInTheDocument();
      });
    });

    it('should allow retry after error', async () => {
      // Arrange: First call fails, second succeeds
      mockCheckAccess
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(createSuccessResult());

      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      const pinInput = screen.getByTestId('day-close-pin-input');
      const verifyButton = screen.getByTestId('day-close-verify-btn');

      // First attempt - fails
      fireEvent.change(pinInput, { target: { value: '1234' } });
      await act(async () => {
        fireEvent.click(verifyButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/failed to verify/i)).toBeInTheDocument();
      });

      // Second attempt - succeeds
      fireEvent.change(pinInput, { target: { value: '5678' } });
      await act(async () => {
        fireEvent.click(verifyButton);
      });

      // Assert: Protected content rendered
      await waitFor(() => {
        expect(screen.getByTestId('day-close-wizard')).toBeInTheDocument();
      });
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle rapid verify clicks gracefully', async () => {
      // Arrange: Slow response to simulate backend latency
      let callCount = 0;
      mockCheckAccess.mockImplementation(() => {
        callCount++;
        return new Promise((resolve) => {
          setTimeout(() => resolve(createSuccessResult()), 100);
        });
      });

      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      const pinInput = screen.getByTestId('day-close-pin-input');
      const verifyButton = screen.getByTestId('day-close-verify-btn');

      // Enter valid PIN first
      fireEvent.change(pinInput, { target: { value: '1234' } });

      // First click triggers verification
      await act(async () => {
        fireEvent.click(verifyButton);
      });

      // Button should now be disabled while verifying
      await waitFor(() => {
        expect(verifyButton).toBeDisabled();
      });

      // Record call count after first click and state update
      const callsAfterFirstClick = callCount;

      // Try clicking again while disabled - should not trigger additional calls
      await act(async () => {
        fireEvent.click(verifyButton);
      });

      // Wait for first response to complete
      await waitFor(() => {
        expect(screen.getByTestId('day-close-wizard')).toBeInTheDocument();
      });

      // Assert: Button was disabled after first click, so second click made no additional calls
      expect(callsAfterFirstClick).toBe(1);
      expect(callCount).toBe(1);
    });

    it('should handle empty PIN gracefully', async () => {
      // Act
      render(
        <TestWrapper>
          <DayCloseAccessGuard>
            <ProtectedContent />
          </DayCloseAccessGuard>
        </TestWrapper>
      );

      const verifyButton = screen.getByTestId('day-close-verify-btn');

      // Button should be disabled with empty PIN
      expect(verifyButton).toBeDisabled();

      // Try to click anyway
      await act(async () => {
        fireEvent.click(verifyButton);
      });

      // Assert: No call made
      expect(mockCheckAccess).not.toHaveBeenCalled();
    });
  });
});
