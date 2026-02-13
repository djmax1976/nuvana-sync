/**
 * DayCloseAccessGuard Component Unit Tests
 *
 * Enterprise-grade tests for day close access guard route protection.
 * Tests PIN dialog flow, access control, redirects, and context provision.
 *
 * Plan: Centralized Day Close Access Validation - Phase 3
 *
 * Tests:
 * - 3.T1: Guard shows PIN dialog on mount
 * - 3.T2: Guard renders children when allowed
 * - 3.T3: Guard redirects when NO_OPEN_SHIFTS
 * - 3.T4: Guard redirects when MULTIPLE_OPEN_SHIFTS
 * - 3.T5: Guard redirects when NOT_SHIFT_OWNER (cashier)
 * - 3.T6: Guard allows shift_manager override
 * - 3.T7: Guard allows store_manager override
 * - 3.T8: Guard shows appropriate error message for each denial reason
 * - 3.T9: Context provides correct values to children
 * - 3.T10: PIN dialog can be cancelled (redirects back)
 *
 * @module tests/unit/components/guards/DayCloseAccessGuard
 * @security SEC-010: Verifies authorization delegated to backend
 * @security FE-001: Verifies XSS prevention via React escaping
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ============================================================================
// Mock Setup (using vi.hoisted for proper variable hoisting)
// ============================================================================

const { mockCheckAccess, mockNavigate, mockToast } = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockNavigate: vi.fn(),
  mockToast: vi.fn(),
}));

// Mock react-router-dom - no router context needed
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock useDayCloseAccess hook
vi.mock('../../../../src/renderer/hooks/useDayCloseAccess', () => ({
  useDayCloseAccess: () => ({
    checkAccess: mockCheckAccess,
    isChecking: false,
    lastResult: null,
    clearResult: vi.fn(),
    error: null,
  }),
}));

// Mock useToast hook
vi.mock('../../../../src/renderer/hooks/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
    toasts: [],
    dismiss: vi.fn(),
  }),
}));

// Mock UI components to simplify testing
vi.mock('../../../../src/renderer/components/ui/dialog', () => ({
  Dialog: ({ open, children, onOpenChange }: { open: boolean; children: React.ReactNode; onOpenChange?: (open: boolean) => void }) => {
    if (!open) return null;
    return (
      <div role="dialog" data-testid="dialog" data-open={open}>
        <button
          aria-label="close"
          data-testid="dialog-close"
          onClick={() => onOpenChange?.(false)}
        >
          Close
        </button>
        {children}
      </div>
    );
  },
  DialogContent: ({ children, onKeyDown }: { children: React.ReactNode; onKeyDown?: (e: React.KeyboardEvent) => void }) => (
    <div data-testid="dialog-content" onKeyDown={onKeyDown}>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p data-testid="dialog-description">{children}</p>
  ),
}));

vi.mock('../../../../src/renderer/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
    variant,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: 'button' | 'submit';
    variant?: string;
    [key: string]: unknown;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      type={type}
      data-variant={variant}
      {...rest}
    >
      {children}
    </button>
  ),
}));

vi.mock('../../../../src/renderer/components/ui/input', () => ({
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    (props, ref) => <input ref={ref} {...props} />
  ),
}));

vi.mock('lucide-react', () => ({
  AlertCircle: () => <span data-testid="icon-alert-circle" />,
  Lock: () => <span data-testid="icon-lock" />,
  XCircle: () => <span data-testid="icon-x-circle" />,
  Loader2: () => <span data-testid="icon-loader" />,
}));

vi.mock('../../../../src/renderer/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
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
// Component Imports (after mocks)
// ============================================================================

import { DayCloseAccessGuard } from '../../../../src/renderer/components/guards/DayCloseAccessGuard';
import { useDayCloseAccessContext } from '../../../../src/renderer/contexts/DayCloseAccessContext';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Test child component that uses the context
 */
function ChildWithContext() {
  const context = useDayCloseAccessContext();
  return (
    <div data-testid="child-content">
      <span data-testid="shift-id">{context.activeShift.shift_id}</span>
      <span data-testid="cashier-name">{context.activeShift.cashier_name}</span>
      <span data-testid="user-name">{context.user.name}</span>
      <span data-testid="access-type">{context.accessType}</span>
    </div>
  );
}

// ============================================================================
// 3.T1: Guard Shows PIN Dialog on Mount
// ============================================================================

describe('3.T1: Guard shows PIN dialog on mount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should render PIN dialog immediately on mount', () => {
    render(
      <DayCloseAccessGuard>
        <div data-testid="protected-content">Protected Content</div>
      </DayCloseAccessGuard>
    );

    // Dialog should be visible
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Day Close Authorization')).toBeInTheDocument();
  });

  it('should render PIN input field', () => {
    render(
      <DayCloseAccessGuard>
        <div>Content</div>
      </DayCloseAccessGuard>
    );

    const pinInput = screen.getByTestId('day-close-pin-input');
    expect(pinInput).toBeInTheDocument();
    expect(pinInput).toHaveAttribute('type', 'password');
    expect(pinInput).toHaveAttribute('inputmode', 'numeric');
  });

  it('should render Verify and Cancel buttons', () => {
    render(
      <DayCloseAccessGuard>
        <div>Content</div>
      </DayCloseAccessGuard>
    );

    expect(screen.getByTestId('day-close-verify-btn')).toBeInTheDocument();
    expect(screen.getByTestId('day-close-cancel-btn')).toBeInTheDocument();
  });

  it('should not render protected content initially', () => {
    render(
      <DayCloseAccessGuard>
        <div data-testid="protected-content">Protected Content</div>
      </DayCloseAccessGuard>
    );

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  it('should show description text', () => {
    render(
      <DayCloseAccessGuard>
        <div>Content</div>
      </DayCloseAccessGuard>
    );

    expect(
      screen.getByText(/Enter your PIN to access the Day Close wizard/i)
    ).toBeInTheDocument();
  });

  it('should show access requirement text', () => {
    render(
      <DayCloseAccessGuard>
        <div>Content</div>
      </DayCloseAccessGuard>
    );

    expect(screen.getByText(/Shift owner or manager access required/i)).toBeInTheDocument();
  });
});

// ============================================================================
// 3.T2: Guard Renders Children When Allowed
// ============================================================================

describe('3.T2: Guard renders children when allowed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should render children after successful PIN verification', async () => {
    const user = userEvent.setup();
    mockCheckAccess.mockResolvedValue(createAllowedResult());

    render(
      <DayCloseAccessGuard>
        <div data-testid="protected-content">Protected Content</div>
      </DayCloseAccessGuard>
    );

    // Enter PIN
    const pinInput = screen.getByTestId('day-close-pin-input');
    await user.type(pinInput, '1234');

    // Submit
    const verifyBtn = screen.getByTestId('day-close-verify-btn');
    await user.click(verifyBtn);

    // Should render protected content
    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });

    // Dialog should be gone
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should hide PIN dialog after access granted', async () => {
    const user = userEvent.setup();
    mockCheckAccess.mockResolvedValue(createAllowedResult());

    render(
      <DayCloseAccessGuard>
        <div data-testid="protected-content">Content</div>
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '1234');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('should not call navigate on successful access', async () => {
    const user = userEvent.setup();
    mockCheckAccess.mockResolvedValue(createAllowedResult());

    render(
      <DayCloseAccessGuard>
        <div data-testid="protected-content">Content</div>
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '1234');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });

    // Should NOT have redirected
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 3.T3: Guard Redirects When NO_OPEN_SHIFTS
// ============================================================================

describe('3.T3: Guard redirects when NO_OPEN_SHIFTS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should redirect to /terminals when no open shifts', async () => {
    const user = userEvent.setup();
    mockCheckAccess.mockResolvedValue(createDeniedResult('NO_OPEN_SHIFTS'));

    render(
      <DayCloseAccessGuard>
        <div data-testid="protected-content">Content</div>
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '1234');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/terminals', { replace: true });
    });
  });

  it('should show toast with NO_OPEN_SHIFTS message', async () => {
    const user = userEvent.setup();
    mockCheckAccess.mockResolvedValue(createDeniedResult('NO_OPEN_SHIFTS'));

    render(
      <DayCloseAccessGuard>
        <div>Content</div>
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '1234');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          title: 'No Open Shifts',
        })
      );
    });
  });

  it('should not render protected content when NO_OPEN_SHIFTS', async () => {
    const user = userEvent.setup();
    mockCheckAccess.mockResolvedValue(createDeniedResult('NO_OPEN_SHIFTS'));

    render(
      <DayCloseAccessGuard>
        <div data-testid="protected-content">Content</div>
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '1234');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });
});

// ============================================================================
// 3.T4: Guard Redirects When MULTIPLE_OPEN_SHIFTS
// ============================================================================

describe('3.T4: Guard redirects when MULTIPLE_OPEN_SHIFTS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should redirect to /terminals when multiple shifts open', async () => {
    const user = userEvent.setup();
    mockCheckAccess.mockResolvedValue(createDeniedResult('MULTIPLE_OPEN_SHIFTS'));

    render(
      <DayCloseAccessGuard>
        <div data-testid="protected-content">Content</div>
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '1234');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/terminals', { replace: true });
    });
  });

  it('should show toast with MULTIPLE_OPEN_SHIFTS message', async () => {
    const user = userEvent.setup();
    mockCheckAccess.mockResolvedValue(createDeniedResult('MULTIPLE_OPEN_SHIFTS'));

    render(
      <DayCloseAccessGuard>
        <div>Content</div>
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '1234');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          title: 'Multiple Shifts Open',
        })
      );
    });
  });
});

// ============================================================================
// 3.T5: Guard Redirects When NOT_SHIFT_OWNER (cashier)
// ============================================================================

describe('3.T5: Guard redirects when NOT_SHIFT_OWNER (cashier)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should redirect when user is not shift owner', async () => {
    const user = userEvent.setup();
    mockCheckAccess.mockResolvedValue(
      createDeniedResult('NOT_SHIFT_OWNER', {
        openShiftCount: 1,
        activeShift: createActiveShift({ cashier_id: 'other-cashier' }),
        user: createAccessUser({ userId: 'current-user', role: 'cashier' }),
      })
    );

    render(
      <DayCloseAccessGuard>
        <div data-testid="protected-content">Content</div>
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '1234');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/terminals', { replace: true });
    });
  });

  it('should show toast with NOT_SHIFT_OWNER message', async () => {
    const user = userEvent.setup();
    mockCheckAccess.mockResolvedValue(createDeniedResult('NOT_SHIFT_OWNER'));

    render(
      <DayCloseAccessGuard>
        <div>Content</div>
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '1234');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          title: 'Access Denied',
        })
      );
    });
  });
});

// ============================================================================
// 3.T6: Guard Allows shift_manager Override
// ============================================================================

describe('3.T6: Guard allows shift_manager override', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should render children for shift_manager with OVERRIDE access', async () => {
    const user = userEvent.setup();
    mockCheckAccess.mockResolvedValue(
      createAllowedResult({
        accessType: 'OVERRIDE',
        user: createAccessUser({ role: 'shift_manager', name: 'Manager Mike' }),
      })
    );

    render(
      <DayCloseAccessGuard>
        <div data-testid="protected-content">Protected Content</div>
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '5678');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('should not show toast when shift_manager access granted', async () => {
    const user = userEvent.setup();
    mockCheckAccess.mockResolvedValue(
      createAllowedResult({
        accessType: 'OVERRIDE',
        user: createAccessUser({ role: 'shift_manager' }),
      })
    );

    render(
      <DayCloseAccessGuard>
        <div data-testid="protected-content">Content</div>
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '5678');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });

    expect(mockToast).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 3.T7: Guard Allows store_manager Override
// ============================================================================

describe('3.T7: Guard allows store_manager override', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should render children for store_manager with OVERRIDE access', async () => {
    const user = userEvent.setup();
    mockCheckAccess.mockResolvedValue(
      createAllowedResult({
        accessType: 'OVERRIDE',
        user: createAccessUser({ role: 'store_manager', name: 'Owner Susan' }),
      })
    );

    render(
      <DayCloseAccessGuard>
        <div data-testid="protected-content">Protected Content</div>
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '9999');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('should work when store_manager is not the shift owner', async () => {
    const user = userEvent.setup();
    mockCheckAccess.mockResolvedValue(
      createAllowedResult({
        accessType: 'OVERRIDE',
        activeShift: createActiveShift({ cashier_id: 'cashier-001' }),
        user: createAccessUser({ userId: 'manager-001', role: 'store_manager' }),
      })
    );

    render(
      <DayCloseAccessGuard>
        <div data-testid="protected-content">Content</div>
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '9999');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 3.T8: Guard Shows Appropriate Error Message for Each Denial Reason
// ============================================================================

describe('3.T8: Guard shows appropriate error message for each denial reason', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should show INVALID_PIN error in dialog (no redirect)', async () => {
    const user = userEvent.setup();
    mockCheckAccess.mockResolvedValue(createDeniedResult('INVALID_PIN'));

    render(
      <DayCloseAccessGuard>
        <div data-testid="protected-content">Content</div>
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '0000');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    // INVALID_PIN should show error in dialog, not redirect
    await waitFor(() => {
      // The component shows the description text for INVALID_PIN
      expect(screen.getByText(/PIN you entered is incorrect/i)).toBeInTheDocument();
    });

    // Should NOT have redirected - user can retry
    expect(mockNavigate).not.toHaveBeenCalled();
    // Should NOT have shown toast - error is in dialog
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('should allow retry after INVALID_PIN', async () => {
    const user = userEvent.setup();
    mockCheckAccess
      .mockResolvedValueOnce(createDeniedResult('INVALID_PIN'))
      .mockResolvedValueOnce(createAllowedResult());

    render(
      <DayCloseAccessGuard>
        <div data-testid="protected-content">Content</div>
      </DayCloseAccessGuard>
    );

    // First attempt - wrong PIN
    await user.type(screen.getByTestId('day-close-pin-input'), '0000');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      // The component shows the description text for INVALID_PIN
      expect(screen.getByText(/PIN you entered is incorrect/i)).toBeInTheDocument();
    });

    // Second attempt - correct PIN
    await user.clear(screen.getByTestId('day-close-pin-input'));
    await user.type(screen.getByTestId('day-close-pin-input'), '1234');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });
  });

  it('should show NO_OPEN_SHIFTS toast with correct title', async () => {
    const user = userEvent.setup();
    mockCheckAccess.mockResolvedValue(createDeniedResult('NO_OPEN_SHIFTS'));

    render(
      <DayCloseAccessGuard>
        <div>Content</div>
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '1234');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'No Open Shifts',
          description: expect.stringMatching(/no open shifts/i),
        })
      );
    });
  });

  it('should use destructive variant for all denial toasts', async () => {
    const user = userEvent.setup();
    mockCheckAccess.mockResolvedValue(createDeniedResult('MULTIPLE_OPEN_SHIFTS'));

    render(
      <DayCloseAccessGuard>
        <div>Content</div>
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '1234');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
        })
      );
    });
  });
});

// ============================================================================
// 3.T9: Context Provides Correct Values to Children
// ============================================================================

describe('3.T9: Context provides correct values to children', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should provide activeShift to context', async () => {
    const user = userEvent.setup();
    const shift = createActiveShift({
      shift_id: 'shift-context-test',
      cashier_name: 'Jane Context',
    });
    mockCheckAccess.mockResolvedValue(createAllowedResult({ activeShift: shift }));

    render(
      <DayCloseAccessGuard>
        <ChildWithContext />
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '1234');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('shift-id')).toHaveTextContent('shift-context-test');
      expect(screen.getByTestId('cashier-name')).toHaveTextContent('Jane Context');
    });
  });

  it('should provide user to context', async () => {
    const user = userEvent.setup();
    const accessUser = createAccessUser({
      userId: 'user-context-test',
      name: 'Context User',
    });
    mockCheckAccess.mockResolvedValue(createAllowedResult({ user: accessUser }));

    render(
      <DayCloseAccessGuard>
        <ChildWithContext />
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '1234');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('user-name')).toHaveTextContent('Context User');
    });
  });

  it('should provide accessType to context for OWNER', async () => {
    const user = userEvent.setup();
    mockCheckAccess.mockResolvedValue(createAllowedResult({ accessType: 'OWNER' }));

    render(
      <DayCloseAccessGuard>
        <ChildWithContext />
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '1234');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('access-type')).toHaveTextContent('OWNER');
    });
  });

  it('should provide accessType to context for OVERRIDE', async () => {
    const user = userEvent.setup();
    mockCheckAccess.mockResolvedValue(
      createAllowedResult({
        accessType: 'OVERRIDE',
        user: createAccessUser({ role: 'shift_manager' }),
      })
    );

    render(
      <DayCloseAccessGuard>
        <ChildWithContext />
      </DayCloseAccessGuard>
    );

    await user.type(screen.getByTestId('day-close-pin-input'), '1234');
    await user.click(screen.getByTestId('day-close-verify-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('access-type')).toHaveTextContent('OVERRIDE');
    });
  });
});

// ============================================================================
// 3.T10: PIN Dialog Can Be Cancelled (Redirects Back)
// ============================================================================

describe('3.T10: PIN dialog can be cancelled (redirects back)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should redirect to /terminals when Cancel button clicked', async () => {
    const user = userEvent.setup();

    render(
      <DayCloseAccessGuard>
        <div data-testid="protected-content">Content</div>
      </DayCloseAccessGuard>
    );

    const cancelBtn = screen.getByTestId('day-close-cancel-btn');
    await user.click(cancelBtn);

    expect(mockNavigate).toHaveBeenCalledWith('/terminals', { replace: true });
  });

  it('should not render protected content after cancel', async () => {
    const user = userEvent.setup();

    render(
      <DayCloseAccessGuard>
        <div data-testid="protected-content">Content</div>
      </DayCloseAccessGuard>
    );

    await user.click(screen.getByTestId('day-close-cancel-btn'));

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  it('should not call checkAccess when cancelled', async () => {
    const user = userEvent.setup();

    render(
      <DayCloseAccessGuard>
        <div>Content</div>
      </DayCloseAccessGuard>
    );

    // Type something but don't submit - cancel instead
    await user.type(screen.getByTestId('day-close-pin-input'), '1234');
    await user.click(screen.getByTestId('day-close-cancel-btn'));

    expect(mockCheckAccess).not.toHaveBeenCalled();
  });

  it('should not show toast when cancelled', async () => {
    const user = userEvent.setup();

    render(
      <DayCloseAccessGuard>
        <div>Content</div>
      </DayCloseAccessGuard>
    );

    await user.click(screen.getByTestId('day-close-cancel-btn'));

    expect(mockToast).not.toHaveBeenCalled();
  });

  it('should handle dialog close via X button', async () => {
    const user = userEvent.setup();

    render(
      <DayCloseAccessGuard>
        <div data-testid="protected-content">Content</div>
      </DayCloseAccessGuard>
    );

    // Find and click the dialog close button
    const closeButton = screen.getByTestId('dialog-close');
    await user.click(closeButton);

    expect(mockNavigate).toHaveBeenCalledWith('/terminals', { replace: true });
  });
});

// ============================================================================
// PIN Input Validation Tests
// ============================================================================

describe('PIN input validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should only allow numeric input', async () => {
    const user = userEvent.setup();

    render(
      <DayCloseAccessGuard>
        <div>Content</div>
      </DayCloseAccessGuard>
    );

    const pinInput = screen.getByTestId('day-close-pin-input');
    await user.type(pinInput, 'abc123def456');

    // Only digits should be in the input
    expect(pinInput).toHaveValue('123456');
  });

  it('should limit input to 6 digits', async () => {
    const user = userEvent.setup();

    render(
      <DayCloseAccessGuard>
        <div>Content</div>
      </DayCloseAccessGuard>
    );

    const pinInput = screen.getByTestId('day-close-pin-input');
    await user.type(pinInput, '12345678');

    expect(pinInput).toHaveValue('123456');
  });

  it('should disable Verify button when PIN is less than 4 digits', async () => {
    const user = userEvent.setup();

    render(
      <DayCloseAccessGuard>
        <div>Content</div>
      </DayCloseAccessGuard>
    );

    const verifyBtn = screen.getByTestId('day-close-verify-btn');

    // Initially disabled (empty)
    expect(verifyBtn).toBeDisabled();

    // Type 3 digits - still disabled
    await user.type(screen.getByTestId('day-close-pin-input'), '123');
    expect(verifyBtn).toBeDisabled();

    // Type 4th digit - now enabled
    await user.type(screen.getByTestId('day-close-pin-input'), '4');
    expect(verifyBtn).not.toBeDisabled();
  });
});

// ============================================================================
// Security Tests
// ============================================================================

describe('Security compliance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('SEC-010: Authorization enforced server-side', () => {
    it('should always call backend for authorization decision', async () => {
      const user = userEvent.setup();
      mockCheckAccess.mockResolvedValue(createAllowedResult());

      render(
        <DayCloseAccessGuard>
          <div data-testid="protected-content">Content</div>
        </DayCloseAccessGuard>
      );

      await user.type(screen.getByTestId('day-close-pin-input'), '1234');
      await user.click(screen.getByTestId('day-close-verify-btn'));

      await waitFor(() => {
        expect(mockCheckAccess).toHaveBeenCalledWith('1234');
      });
    });

    it('should not make local authorization decisions', async () => {
      const user = userEvent.setup();
      // Backend says denied
      mockCheckAccess.mockResolvedValue(createDeniedResult('NOT_SHIFT_OWNER'));

      render(
        <DayCloseAccessGuard>
          <div data-testid="protected-content">Content</div>
        </DayCloseAccessGuard>
      );

      await user.type(screen.getByTestId('day-close-pin-input'), '1234');
      await user.click(screen.getByTestId('day-close-verify-btn'));

      // Guard should respect backend decision
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalled();
      });
      expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
    });
  });

  describe('FE-001: XSS prevention', () => {
    it('should use React escaping for all displayed text', async () => {
      const user = userEvent.setup();
      // XSS attempt in user name
      const xssAttempt = '<script>alert("xss")</script>';
      mockCheckAccess.mockResolvedValue(
        createAllowedResult({
          user: createAccessUser({ name: xssAttempt }),
        })
      );

      render(
        <DayCloseAccessGuard>
          <ChildWithContext />
        </DayCloseAccessGuard>
      );

      await user.type(screen.getByTestId('day-close-pin-input'), '1234');
      await user.click(screen.getByTestId('day-close-verify-btn'));

      await waitFor(() => {
        // React should escape the script tag
        const userName = screen.getByTestId('user-name');
        expect(userName.innerHTML).not.toContain('<script>');
        expect(userName.textContent).toBe(xssAttempt);
      });
    });
  });
});
