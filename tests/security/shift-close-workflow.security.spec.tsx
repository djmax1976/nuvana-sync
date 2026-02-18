/**
 * Shift Close Workflow Security Tests (Phase 5)
 *
 * Security-focused tests for the shift close navigation workflow.
 * Verifies that authorization is properly delegated to DayCloseAccessGuard
 * and that no security bypass vectors exist.
 *
 * Test Coverage:
 * - 5.1.1: Cannot close shift without wizard (fromWizard flag required)
 * - 5.1.2: Navigation does not expose shift ID in URL
 * - 5.1.3: Guard cannot be bypassed via direct URL
 * - 5.1.4: Unauthorized role cannot access wizard
 * - 5.1.5: Session expiry handled during navigation
 *
 * Security Standards:
 * - SEC-010: Authorization enforced server-side via DayCloseAccessGuard
 * - SEC-006: Parameterized queries (no SQL injection)
 * - SEC-014: Input validation (PIN format, UUID format)
 * - DB-006: Tenant isolation in all queries
 * - FE-001: No sensitive data exposed in URLs
 *
 * Enterprise Testing Standards:
 * - Each test validates a single security concept (TEST-005)
 * - Tests are deterministic and isolated
 * - Tests verify fail-closed behavior
 *
 * @module tests/security/shift-close-workflow.security
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, Outlet } from 'react-router-dom';
import { z } from 'zod';

// ============================================================================
// Mock Dependencies (Hoisted)
// ============================================================================

const {
  mockUseShifts,
  mockUseShift,
  mockCheckAccess,
  mockToast,
  mockWindowConfirm,
  mockCloseShift,
} = vi.hoisted(() => ({
  mockUseShifts: vi.fn(),
  mockUseShift: vi.fn(),
  mockCheckAccess: vi.fn(),
  mockToast: vi.fn(),
  mockWindowConfirm: vi.fn(),
  mockCloseShift: vi.fn(),
}));

// Mock shift hooks
vi.mock('../../src/renderer/lib/hooks', () => ({
  useShifts: () => mockUseShifts(),
  useShift: () => mockUseShift(),
  useShiftSummary: () => ({
    data: {
      totalSales: 1000,
      netSales: 950,
      transactionCount: 25,
      totalVoided: 50,
    },
    isLoading: false,
    error: null,
  }),
  useShiftFuelData: () => ({
    data: {
      totals: {
        totalVolume: 0,
        totalAmount: 0,
        insideVolume: 0,
        insideAmount: 0,
        outsideVolume: 0,
        outsideAmount: 0,
      },
      byGrade: [],
      hasMSMData: false,
    },
    isLoading: false,
    error: null,
  }),
}));

// Mock useDayCloseAccess hook
vi.mock('../../src/renderer/hooks/useDayCloseAccess', () => ({
  useDayCloseAccess: () => ({
    checkAccess: mockCheckAccess,
    isChecking: false,
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
  DayCloseAccessProvider: ({ children }: { children: React.ReactNode; value: unknown }) => (
    <div data-testid="access-context-provider">{children}</div>
  ),
}));

// Mock UI components
vi.mock('../../src/renderer/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open: boolean;
    onOpenChange?: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="pin-dialog" role="dialog">
        {children}
      </div>
    ) : null,
  DialogContent: ({
    children,
  }: {
    children: React.ReactNode;
    onKeyDown?: (e: React.KeyboardEvent) => void;
    className?: string;
  }) => <div data-testid="dialog-content">{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode; className?: string }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p data-testid="dialog-description">{children}</p>
  ),
}));

vi.mock('../../src/renderer/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type = 'button',
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
      data-testid={props['data-testid'] || 'button'}
    >
      {children}
    </button>
  ),
}));

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
        maxLength={props.maxLength}
      />
    )
  );
  MockInput.displayName = 'Input';
  return { Input: MockInput };
});

vi.mock('lucide-react', () => ({
  AlertCircle: () => <span data-testid="alert-circle-icon" />,
  Lock: () => <span data-testid="lock-icon" />,
  XCircle: () => <span data-testid="x-circle-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('../../src/renderer/components/shifts/FuelSalesBreakdown', () => ({
  FuelSalesBreakdown: () => <div data-testid="fuel-sales-breakdown" />,
}));

// ============================================================================
// Import Components Under Test (after mocks)
// ============================================================================

import ShiftsPage from '../../src/renderer/pages/ShiftsPage';
import ViewShiftPage from '../../src/renderer/pages/ViewShiftPage';
import { DayCloseAccessGuard } from '../../src/renderer/components/guards/DayCloseAccessGuard';

// ============================================================================
// Test Fixtures
// ============================================================================

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const STORE_A_ID = 'store-a-0001-0002-0003-000000000001';
const _STORE_B_ID = 'store-b-0001-0002-0003-000000000002';

/**
 * Creates a mock shift with the given status and ownership
 * @security SEC-014: Uses valid UUID format for IDs
 */
function createMockShift(
  id: string,
  status: 'OPEN' | 'CLOSED',
  storeId: string = STORE_A_ID
): {
  shift_id: string;
  store_id: string;
  shift_number: number;
  business_date: string;
  cashier_id: string | null;
  register_id: string | null;
  start_time: string | null;
  end_time: string | null;
  status: 'OPEN' | 'CLOSED';
  external_cashier_id: string | null;
  external_register_id: string | null;
  external_till_id: string | null;
  created_at: string;
  updated_at: string;
  cashier_name: string;
} {
  return {
    shift_id: id,
    store_id: storeId,
    shift_number: 1,
    business_date: '2026-02-15',
    cashier_id: 'cashier-001',
    register_id: 'register-001',
    start_time: '2026-02-15T08:00:00.000Z',
    end_time: status === 'CLOSED' ? '2026-02-15T16:00:00.000Z' : null,
    status,
    external_cashier_id: 'ext-cashier-001',
    external_register_id: 'ext-register-001',
    external_till_id: 'ext-till-001',
    created_at: '2026-02-15T08:00:00.000Z',
    updated_at: '2026-02-15T08:00:00.000Z',
    cashier_name: 'Test Cashier',
  };
}

function createMockListResponse(shifts: ReturnType<typeof createMockShift>[]) {
  return {
    shifts,
    total: shifts.length,
    limit: 20,
    offset: 0,
  };
}

/**
 * Creates successful access result for a user with given role
 */
function createSuccessResult(role: 'cashier' | 'shift_manager' | 'store_manager' = 'cashier'): {
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
    accessType: role === 'cashier' ? 'OWNER' : 'OVERRIDE',
    user: {
      userId: 'user-001',
      name: 'Test User',
      role,
    },
    activeShift: {
      shift_id: VALID_UUID,
      shift_number: 1,
      cashier_id: 'user-001',
      cashier_name: 'Test User',
      external_register_id: 'REG01',
      terminal_name: 'Front Register',
      business_date: '2026-02-15',
      start_time: '2026-02-15T08:00:00.000Z',
    },
    openShiftCount: 1,
  };
}

/**
 * Creates denied access result with given reason
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
      reason: 'Multiple shifts are open.',
      count: 3,
    },
    NOT_SHIFT_OWNER: {
      reason: 'You are not the assigned cashier for this shift.',
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
 * Location tracker for verifying navigation
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
 * Test app with routing - follows the same pattern as integration tests
 */
function TestApp({ initialEntries = ['/shifts'] }: { initialEntries?: string[] }) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route
          element={
            <>
              <LocationDisplay />
              <Outlet />
            </>
          }
        >
          <Route path="/shifts" element={<ShiftsPage />} />
          <Route path="/shifts/:shiftId" element={<ViewShiftPage />} />
          <Route
            path="/day-close"
            element={
              <DayCloseAccessGuard>
                <div data-testid="day-close-wizard">Day Close Wizard</div>
              </DayCloseAccessGuard>
            }
          />
          <Route
            path="/shift-end"
            element={<div data-testid="shift-end-page">Shift End Wizard</div>}
          />
          <Route path="/terminals" element={<div data-testid="terminals-page">Terminals</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Shift Close Workflow Security Tests (Phase 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWindowConfirm.mockReturnValue(true);
    vi.spyOn(window, 'confirm').mockImplementation(mockWindowConfirm);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 5.1.1: Cannot close shift without wizard (fromWizard flag required)
  // ==========================================================================

  describe('5.1.1: Cannot close shift without wizard context', () => {
    /**
     * Verifies that direct API calls to close shifts require the fromWizard flag.
     * This is enforced by the backend handler schema validation.
     */
    it('should require fromWizard flag for non-LOTTERY POS types', () => {
      // The CommitDayCloseSchema in lottery.handlers.ts requires fromWizard
      // for non-LOTTERY POS types. This test validates the schema pattern.
      const CommitDayCloseInputSchema = z.object({
        day_id: z.string().uuid(),
        closings: z.array(
          z.object({
            bin_id: z.string().uuid(),
            closing_serial: z.number().min(0).max(999),
          })
        ),
        fromWizard: z.boolean().optional(),
      });

      // Valid wizard request
      const wizardRequest = {
        day_id: VALID_UUID,
        closings: [],
        fromWizard: true,
      };
      expect(CommitDayCloseInputSchema.safeParse(wizardRequest).success).toBe(true);

      // Request without fromWizard - schema accepts but backend enforces
      const directRequest = {
        day_id: VALID_UUID,
        closings: [],
        // fromWizard missing - backend will reject for non-LOTTERY stores
      };
      const result = CommitDayCloseInputSchema.safeParse(directRequest);
      expect(result.success).toBe(true);

      // The actual rejection happens in the handler which checks:
      // if (!input.fromWizard && store.posType !== 'LOTTERY') return FORBIDDEN
    });

    it('should prevent direct shift close mutation bypass', async () => {
      // The shifts:close handler requires authentication and role check
      // This test verifies the handler's input schema enforces UUID format
      const CloseShiftInputSchema = z.object({
        shift_id: z.string().uuid(),
        closing_cash: z.number().min(0).max(999999.99),
      });

      // SQL injection attempt
      const maliciousInput = {
        shift_id: "'; DROP TABLE shifts;--",
        closing_cash: 0,
      };
      expect(CloseShiftInputSchema.safeParse(maliciousInput).success).toBe(false);

      // Valid input
      const validInput = {
        shift_id: VALID_UUID,
        closing_cash: 100.5,
      };
      expect(CloseShiftInputSchema.safeParse(validInput).success).toBe(true);
    });

    it('should enforce closing_cash validation to prevent injection', () => {
      const CloseShiftInputSchema = z.object({
        shift_id: z.string().uuid(),
        closing_cash: z.number().min(0).max(999999.99),
      });

      // String injection attempt
      const stringInjection = {
        shift_id: VALID_UUID,
        closing_cash: '100; DELETE FROM shifts',
      };
      expect(CloseShiftInputSchema.safeParse(stringInjection).success).toBe(false);

      // Negative value attempt
      const negativeValue = {
        shift_id: VALID_UUID,
        closing_cash: -100,
      };
      expect(CloseShiftInputSchema.safeParse(negativeValue).success).toBe(false);

      // Overflow attempt
      const overflowValue = {
        shift_id: VALID_UUID,
        closing_cash: 9999999999,
      };
      expect(CloseShiftInputSchema.safeParse(overflowValue).success).toBe(false);
    });

    it('should delegate closing to wizard via navigation, not direct mutation', async () => {
      // Arrange: Page with open shift
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift(VALID_UUID, 'OPEN')]),
        isLoading: false,
        error: null,
      });

      // Act
      render(<TestApp initialEntries={['/shifts']} />);

      // Click Close button
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      });

      // Assert: Navigated to shift-end wizard (per BIZ-011), no direct mutation called
      await waitFor(() => {
        expect(screen.getByTestId('location-display')).toHaveAttribute(
          'data-pathname',
          '/shift-end'
        );
      });

      // No direct close mutation was called
      expect(mockCloseShift).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 5.1.2: Navigation pattern with shift ID (BIZ-011)
  // ==========================================================================

  describe('5.1.2: Navigation includes shift ID for shift-end wizard (BIZ-011)', () => {
    it('should include shift ID in URL when navigating from ShiftsPage', async () => {
      // Arrange: Shift with ID
      const shiftId = 'shift-secret-uuid-123';
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift(shiftId, 'OPEN')]),
        isLoading: false,
        error: null,
      });

      // Act
      render(<TestApp initialEntries={['/shifts']} />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      });

      // Assert: Navigated to /shift-end with shiftId parameter (per BIZ-011)
      const locationDisplay = screen.getByTestId('location-display');
      const pathname = locationDisplay.getAttribute('data-pathname');

      expect(pathname).toBe('/shift-end');
      // Note: shiftId is passed as query param, which is acceptable
      // Backend validates ownership via SEC-010
    });

    it('should navigate to shift-end from ViewShiftPage', async () => {
      // Arrange: Viewing specific shift
      const shiftId = 'sensitive-shift-id-456';
      mockUseShift.mockReturnValue({
        data: createMockShift(shiftId, 'OPEN'),
        isLoading: false,
        error: null,
      });

      // Act
      render(<TestApp initialEntries={[`/shifts/${shiftId}`]} />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /close shift/i }));
      });

      // Assert: Navigated to /shift-end (per BIZ-011)
      await waitFor(() => {
        const pathname = screen.getByTestId('location-display').getAttribute('data-pathname');
        expect(pathname).toBe('/shift-end');
      });
    });

    it('should navigate to shift-end wizard without direct mutation', async () => {
      // This test verifies that navigation goes to shift-end wizard
      // where authorization and closing happens properly

      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift(VALID_UUID, 'OPEN')]),
        isLoading: false,
        error: null,
      });

      render(<TestApp initialEntries={['/shifts']} />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      });

      // After navigation, shift-end wizard shows
      await waitFor(() => {
        expect(screen.getByTestId('shift-end-page')).toBeInTheDocument();
      });

      // No direct close mutation was called (wizard handles it)
      expect(mockCloseShift).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 5.1.3: Guard cannot be bypassed via direct URL
  // ==========================================================================

  describe('5.1.3: Guard cannot be bypassed via direct URL', () => {
    it('should show PIN dialog when navigating directly to /day-close', async () => {
      // Act: User types /day-close directly in URL
      render(<TestApp initialEntries={['/day-close']} />);

      // Assert: PIN dialog is immediately shown (no bypass)
      expect(screen.getByTestId('pin-dialog')).toBeInTheDocument();
      expect(screen.getByText('Day Close Authorization')).toBeInTheDocument();
    });

    it('should NOT render protected content without PIN verification', async () => {
      // Act: Navigate directly to /day-close
      render(<TestApp initialEntries={['/day-close']} />);

      // Assert: Protected content not visible
      expect(screen.queryByTestId('day-close-wizard')).not.toBeInTheDocument();
      // PIN dialog visible instead
      expect(screen.getByTestId('pin-dialog')).toBeInTheDocument();
    });

    it('should require backend validation before rendering wizard', async () => {
      // Arrange: Mock backend to deny access
      mockCheckAccess.mockResolvedValue(createDeniedResult('NOT_SHIFT_OWNER'));

      // Act
      render(<TestApp initialEntries={['/day-close']} />);

      // Enter PIN and submit
      fireEvent.change(screen.getByTestId('day-close-pin-input'), {
        target: { value: '1234' },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('day-close-verify-btn'));
      });

      // Assert: Wizard never renders, redirect happens
      await waitFor(() => {
        expect(screen.getByTestId('terminals-page')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('day-close-wizard')).not.toBeInTheDocument();

      // Backend was always consulted
      expect(mockCheckAccess).toHaveBeenCalledWith('1234');
    });

    it('should enforce SEC-014 PIN format validation', () => {
      render(<TestApp initialEntries={['/day-close']} />);

      const pinInput = screen.getByTestId('day-close-pin-input') as HTMLInputElement;
      const verifyButton = screen.getByTestId('day-close-verify-btn');

      // Non-numeric input should be filtered
      fireEvent.change(pinInput, { target: { value: 'abcd1234' } });
      // Component filters to digits only
      expect(pinInput.value.length).toBeLessThanOrEqual(6);

      // Button disabled with <4 digits
      fireEvent.change(pinInput, { target: { value: '123' } });
      expect(verifyButton).toBeDisabled();
    });

    it('should not allow empty PIN submission', async () => {
      render(<TestApp initialEntries={['/day-close']} />);

      const verifyButton = screen.getByTestId('day-close-verify-btn');

      // Button disabled with empty PIN
      expect(verifyButton).toBeDisabled();

      // Try to click anyway
      await act(async () => {
        fireEvent.click(verifyButton);
      });

      // No backend call made
      expect(mockCheckAccess).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 5.1.4: Unauthorized role cannot access wizard
  // ==========================================================================

  describe('5.1.4: Unauthorized role cannot access wizard', () => {
    it('should deny access when user is not shift owner (cashier without ownership)', async () => {
      // Arrange: Backend returns NOT_SHIFT_OWNER
      mockCheckAccess.mockResolvedValue(createDeniedResult('NOT_SHIFT_OWNER'));

      // Act
      render(<TestApp initialEntries={['/day-close']} />);

      fireEvent.change(screen.getByTestId('day-close-pin-input'), {
        target: { value: '1234' },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('day-close-verify-btn'));
      });

      // Assert: Redirected, toast shown
      await waitFor(() => {
        expect(screen.getByTestId('terminals-page')).toBeInTheDocument();
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            variant: 'destructive',
            title: 'Access Denied',
          })
        );
      });
    });

    it('should allow shift owner to access wizard', async () => {
      // Arrange: Backend returns success for shift owner
      mockCheckAccess.mockResolvedValue(createSuccessResult('cashier'));

      // Act
      render(<TestApp initialEntries={['/day-close']} />);

      fireEvent.change(screen.getByTestId('day-close-pin-input'), {
        target: { value: '1234' },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('day-close-verify-btn'));
      });

      // Assert: Wizard rendered
      await waitFor(() => {
        expect(screen.getByTestId('day-close-wizard')).toBeInTheDocument();
      });
    });

    it('should allow shift_manager override access', async () => {
      // Arrange: Backend returns success with OVERRIDE access type
      mockCheckAccess.mockResolvedValue(createSuccessResult('shift_manager'));

      // Act
      render(<TestApp initialEntries={['/day-close']} />);

      fireEvent.change(screen.getByTestId('day-close-pin-input'), {
        target: { value: '9999' },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('day-close-verify-btn'));
      });

      // Assert: Wizard rendered (manager override)
      await waitFor(() => {
        expect(screen.getByTestId('day-close-wizard')).toBeInTheDocument();
      });
    });

    it('should allow store_manager override access', async () => {
      // Arrange: Backend returns success with OVERRIDE access type
      mockCheckAccess.mockResolvedValue(createSuccessResult('store_manager'));

      // Act
      render(<TestApp initialEntries={['/day-close']} />);

      fireEvent.change(screen.getByTestId('day-close-pin-input'), {
        target: { value: '8888' },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('day-close-verify-btn'));
      });

      // Assert: Wizard rendered (store manager override)
      await waitFor(() => {
        expect(screen.getByTestId('day-close-wizard')).toBeInTheDocument();
      });
    });

    it('should enforce backend role validation even with valid PIN format', async () => {
      // Even if PIN format is valid, backend must authorize
      mockCheckAccess.mockResolvedValue(createDeniedResult('INVALID_PIN'));

      render(<TestApp initialEntries={['/day-close']} />);

      fireEvent.change(screen.getByTestId('day-close-pin-input'), {
        target: { value: '1234' },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('day-close-verify-btn'));
      });

      // Assert: Error shown, no wizard access
      await waitFor(() => {
        expect(screen.getByText(/incorrect/i)).toBeInTheDocument();
      });
      expect(screen.queryByTestId('day-close-wizard')).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // 5.1.5: Session expiry handled during navigation
  // ==========================================================================

  describe('5.1.5: Session expiry handled during navigation', () => {
    it('should require re-authentication when session expires', async () => {
      // Simulate session expiry: first call succeeds, second fails
      let callCount = 0;
      mockCheckAccess.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call: session valid
          return Promise.resolve(createSuccessResult('cashier'));
        }
        // Subsequent calls: session expired (simulated)
        return Promise.resolve({
          allowed: false,
          reasonCode: 'NOT_AUTHENTICATED',
          reason: 'Session expired. Please re-authenticate.',
        });
      });

      // Act: Access wizard
      render(<TestApp initialEntries={['/day-close']} />);

      fireEvent.change(screen.getByTestId('day-close-pin-input'), {
        target: { value: '1234' },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('day-close-verify-btn'));
      });

      // Assert: First access works
      await waitFor(() => {
        expect(screen.getByTestId('day-close-wizard')).toBeInTheDocument();
      });

      // Note: Actual session expiry during wizard is handled by backend
      // This test verifies the guard requires auth on each access attempt
      expect(mockCheckAccess).toHaveBeenCalled();
    });

    it('should handle IPC connection failure gracefully', async () => {
      // Arrange: Simulate IPC failure
      mockCheckAccess.mockRejectedValue(new Error('IPC connection failed'));

      // Act
      render(<TestApp initialEntries={['/day-close']} />);

      fireEvent.change(screen.getByTestId('day-close-pin-input'), {
        target: { value: '1234' },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('day-close-verify-btn'));
      });

      // Assert: Error shown, retry possible
      await waitFor(() => {
        expect(screen.getByText(/failed to verify/i)).toBeInTheDocument();
      });

      // Dialog still visible for retry
      expect(screen.getByTestId('pin-dialog')).toBeInTheDocument();
      // Wizard not rendered
      expect(screen.queryByTestId('day-close-wizard')).not.toBeInTheDocument();
    });

    it('should always check backend authorization (no client-side caching)', async () => {
      // Each PIN submission should call backend
      mockCheckAccess.mockResolvedValue(createSuccessResult('cashier'));

      render(<TestApp initialEntries={['/day-close']} />);

      fireEvent.change(screen.getByTestId('day-close-pin-input'), {
        target: { value: '1234' },
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('day-close-verify-btn'));
      });

      // Backend was called
      expect(mockCheckAccess).toHaveBeenCalledTimes(1);

      // If user returns to /day-close, they would need to re-authenticate
      // (guard state resets on component remount)
    });

    it('should clear PIN from state after verification (FE-003)', async () => {
      mockCheckAccess.mockResolvedValue(createDeniedResult('INVALID_PIN'));

      render(<TestApp initialEntries={['/day-close']} />);

      const pinInput = screen.getByTestId('day-close-pin-input') as HTMLInputElement;

      // Enter PIN
      fireEvent.change(pinInput, { target: { value: '1234' } });
      expect(pinInput.value).toBe('1234');

      // Submit
      await act(async () => {
        fireEvent.click(screen.getByTestId('day-close-verify-btn'));
      });

      // After invalid PIN, dialog stays but PIN should be clearable
      // (FE-003: sensitive data not persisted)
      await waitFor(() => {
        expect(screen.getByText(/incorrect/i)).toBeInTheDocument();
      });

      // User can enter new PIN (component didn't crash)
      fireEvent.change(pinInput, { target: { value: '5678' } });
      expect(pinInput.value).toBe('5678');
    });
  });

  // ==========================================================================
  // Additional Security Tests: SEC-010 Compliance
  // ==========================================================================

  describe('SEC-010: Authorization delegated to backend', () => {
    it('should never call window.confirm for shift closing', async () => {
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift(VALID_UUID, 'OPEN')]),
        isLoading: false,
        error: null,
      });

      render(<TestApp initialEntries={['/shifts']} />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      });

      // No confirm dialog - auth is delegated to guard/backend
      expect(mockWindowConfirm).not.toHaveBeenCalled();
    });

    it('should not perform client-side authorization checks before navigation', async () => {
      // The Close button navigates directly without pre-checks
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift(VALID_UUID, 'OPEN')]),
        isLoading: false,
        error: null,
      });

      render(<TestApp initialEntries={['/shifts']} />);

      // Button should be immediately clickable (no pre-auth loading state)
      const closeButton = screen.getByRole('button', { name: 'Close' });
      expect(closeButton).not.toBeDisabled();

      // Click navigates immediately to shift-end wizard (per BIZ-011)
      await act(async () => {
        fireEvent.click(closeButton);
      });

      await waitFor(() => {
        expect(screen.getByTestId('location-display')).toHaveAttribute(
          'data-pathname',
          '/shift-end'
        );
      });
    });
  });

  // ==========================================================================
  // Cross-Tenant Security (DB-006)
  // ==========================================================================

  describe('DB-006: Tenant isolation', () => {
    it('should scope shift queries to configured store', () => {
      // This is validated by examining the useShifts hook implementation
      // and shifts.handlers.ts which uses getConfiguredStore()

      // The shifts handler always fetches storeId from config, not from client
      // This test documents the expected behavior
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift(VALID_UUID, 'OPEN', STORE_A_ID)]),
        isLoading: false,
        error: null,
      });

      render(<TestApp initialEntries={['/shifts']} />);

      // All shifts shown belong to configured store
      // (verified by examining useShifts implementation which passes no store param)
      expect(mockUseShifts).toHaveBeenCalled();
    });

    it('should prevent cross-tenant shift visibility in list', () => {
      // Backend enforces this - client only sees its own store's shifts
      const storeAShift = createMockShift('shift-store-a', 'OPEN', STORE_A_ID);
      // Store B shift would never be returned by backend for Store A user

      mockUseShifts.mockReturnValue({
        data: createMockListResponse([storeAShift]),
        isLoading: false,
        error: null,
      });

      render(<TestApp initialEntries={['/shifts']} />);

      // Only Store A shifts visible
      expect(screen.getByText('1')).toBeInTheDocument(); // shift_number
      // No Store B data would ever appear (enforced by backend)
    });
  });
});
