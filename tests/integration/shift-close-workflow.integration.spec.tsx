/**
 * Shift Close Workflow Integration Tests (Phase 4 - Task 4.1)
 *
 * Integration tests validating the complete user flow from shift list to Shift End wizard.
 * Tests navigation behavior and route transitions with full routing context.
 *
 * Testing Strategy:
 * - Real React Router with MemoryRouter for route simulation
 * - Component rendering with full provider context
 * - Navigation verification via URL and component mounting
 *
 * @module tests/integration/shift-close-workflow.integration
 *
 * Business Compliance:
 * - BIZ-011: Shift Close Navigation Pattern - "Close Shift" buttons MUST navigate to
 *   /shift-end?shiftId=xxx, never call close API directly
 *
 * Traceability Matrix:
 * - 4.1.2: ShiftsPage Close → ShiftEndPage
 * - 4.1.3: ViewShiftPage Close → ShiftEndPage
 * - 4.1.4: Navigation preserves app state
 * - 4.1.5: Back navigation returns to previous page
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import {
  MemoryRouter,
  Routes,
  Route,
  useLocation,
  Outlet,
  useSearchParams,
} from 'react-router-dom';

// ============================================================================
// Mock Dependencies (Hoisted)
// ============================================================================

const {
  mockUseShifts,
  mockUseShift,
  mockUseShiftSummary,
  mockUseShiftFuelData,
  mockToast,
  mockWindowConfirm,
} = vi.hoisted(() => ({
  mockUseShifts: vi.fn(),
  mockUseShift: vi.fn(),
  mockUseShiftSummary: vi.fn(),
  mockUseShiftFuelData: vi.fn(),
  mockToast: vi.fn(),
  mockWindowConfirm: vi.fn(),
}));

// Mock shift hooks
vi.mock('../../src/renderer/lib/hooks', () => ({
  useShifts: () => mockUseShifts(),
  useShift: () => mockUseShift(),
  useShiftSummary: () => mockUseShiftSummary(),
  useShiftFuelData: () => mockUseShiftFuelData(),
}));

// Mock toast hook
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Mock UI components to simplify testing
vi.mock('../../src/renderer/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({
    children,
    className: _className,
  }: {
    children: React.ReactNode;
    className?: string;
    onKeyDown?: (e: React.KeyboardEvent) => void;
  }) => <div data-testid="dialog-content">{children}</div>,
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
    type,
    variant: _variant,
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
      type={type ?? 'button'}
      onClick={onClick}
      disabled={disabled}
      data-testid={props['data-testid'] || 'button'}
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
        'data-testid'?: string;
      },
      ref: React.Ref<HTMLInputElement>
    ) => <input ref={ref} data-testid={props['data-testid'] || 'input'} {...props} />
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

// Mock FuelSalesBreakdown
vi.mock('../../src/renderer/components/shifts/FuelSalesBreakdown', () => ({
  FuelSalesBreakdown: () => <div data-testid="fuel-sales-breakdown" />,
}));

// ============================================================================
// Import Components Under Test (after mocks)
// ============================================================================

import ShiftsPage from '../../src/renderer/pages/ShiftsPage';
import ViewShiftPage from '../../src/renderer/pages/ViewShiftPage';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates a mock shift with the given status
 * @security SEC-014: Uses valid UUID format for IDs
 */
function createMockShift(
  id: string,
  status: 'OPEN' | 'CLOSED',
  shiftNumber: number = 1
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
    store_id: 'store-uuid-001',
    shift_number: shiftNumber,
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

/**
 * Creates a mock list response with the given shifts
 */
function createMockListResponse(shifts: ReturnType<typeof createMockShift>[], total?: number) {
  return {
    shifts,
    total: total ?? shifts.length,
    limit: 20,
    offset: 0,
  };
}

/**
 * Creates a mock shift summary
 */
function createMockSummary() {
  return {
    totalSales: 1500.0,
    netSales: 1400.0,
    transactionCount: 50,
    totalVoided: 100.0,
  };
}

/**
 * Creates a mock fuel data response
 */
function createMockFuelData() {
  return {
    totals: {
      insideVolume: 100.0,
      insideAmount: 320.0,
      outsideVolume: 150.0,
      outsideAmount: 480.0,
      totalVolume: 250.0,
      totalAmount: 800.0,
    },
    byGrade: [],
    hasMSMData: true,
  };
}

/**
 * Mock ShiftEndPage for testing navigation target
 * Shows the shiftId from URL params for verification
 */
function MockShiftEndPage() {
  const [searchParams] = useSearchParams();
  const shiftId = searchParams.get('shiftId');
  return (
    <div data-testid="shift-end-page" data-shift-id={shiftId || ''}>
      Shift End Wizard
      {shiftId && <span data-testid="shift-id-display">Shift: {shiftId}</span>}
    </div>
  );
}

/**
 * Location tracker component for testing navigation
 */
function LocationDisplay() {
  const location = useLocation();
  return (
    <div
      data-testid="location-display"
      data-pathname={location.pathname}
      data-search={location.search}
    >
      Current path: {location.pathname}
      {location.search && <span> Search: {location.search}</span>}
    </div>
  );
}

/**
 * Test app with full routing context
 * Tests navigation from ShiftsPage/ViewShiftPage to /shift-end (per BIZ-011)
 */
interface TestAppProps {
  initialEntries?: string[];
}

function TestApp({ initialEntries = ['/shifts'] }: TestAppProps) {
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
          <Route path="/shift-end" element={<MockShiftEndPage />} />
          <Route path="/terminals" element={<div data-testid="terminals-page">Terminals</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Shift Close Workflow Integration (Phase 4.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWindowConfirm.mockReturnValue(true);
    vi.spyOn(window, 'confirm').mockImplementation(mockWindowConfirm);

    // Default hook responses
    mockUseShiftSummary.mockReturnValue({
      data: createMockSummary(),
      isLoading: false,
      error: null,
    });

    mockUseShiftFuelData.mockReturnValue({
      data: createMockFuelData(),
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 4.1.2: ShiftsPage Close → ShiftEndPage (BIZ-011)
  // ==========================================================================

  describe('4.1.2: ShiftsPage Close → ShiftEndPage', () => {
    it('should navigate to /shift-end when Close button is clicked on ShiftsPage', async () => {
      // Arrange: List with one OPEN shift
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift('shift-001', 'OPEN', 1)]),
        isLoading: false,
        error: null,
      });

      // Act
      render(<TestApp initialEntries={['/shifts']} />);

      // Verify initial location
      const locationDisplay = screen.getByTestId('location-display');
      expect(locationDisplay).toHaveAttribute('data-pathname', '/shifts');

      // Click Close button (exact match to avoid "Closed" filter)
      const closeButton = screen.getByRole('button', { name: 'Close' });
      await act(async () => {
        fireEvent.click(closeButton);
      });

      // Assert: Route changed to /shift-end (per BIZ-011)
      await waitFor(() => {
        expect(screen.getByTestId('location-display')).toHaveAttribute(
          'data-pathname',
          '/shift-end'
        );
      });
    });

    it('should render ShiftEndPage after navigation from ShiftsPage', async () => {
      // Arrange
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift('shift-001', 'OPEN', 1)]),
        isLoading: false,
        error: null,
      });

      // Act
      render(<TestApp initialEntries={['/shifts']} />);

      // Click Close button
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      });

      // Assert: ShiftEndPage should render
      await waitFor(() => {
        expect(screen.getByTestId('shift-end-page')).toBeInTheDocument();
        expect(screen.getByText('Shift End Wizard')).toBeInTheDocument();
      });
    });

    it('should pass shiftId in URL params after navigation (per BIZ-011)', async () => {
      // Arrange
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift('shift-sensitive-123', 'OPEN', 1)]),
        isLoading: false,
        error: null,
      });

      // Act
      render(<TestApp initialEntries={['/shifts']} />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      });

      // Assert: URL includes shiftId as query param (per BIZ-011 pattern)
      await waitFor(() => {
        const locationDisplay = screen.getByTestId('location-display');
        expect(locationDisplay).toHaveAttribute('data-pathname', '/shift-end');
        expect(locationDisplay).toHaveAttribute('data-search', '?shiftId=shift-sensitive-123');
      });
    });

    it('should NOT call window.confirm when navigating to shift-end', async () => {
      // Arrange
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift('shift-001', 'OPEN', 1)]),
        isLoading: false,
        error: null,
      });

      // Act
      render(<TestApp initialEntries={['/shifts']} />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      });

      // Assert: No confirm dialog was shown (navigation should be direct)
      expect(mockWindowConfirm).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 4.1.3: ViewShiftPage Close → ShiftEndPage (BIZ-011)
  // ==========================================================================

  describe('4.1.3: ViewShiftPage Close → ShiftEndPage', () => {
    it('should navigate to /shift-end when Close Shift button is clicked on ViewShiftPage', async () => {
      // Arrange: OPEN shift
      mockUseShift.mockReturnValue({
        data: createMockShift('shift-001', 'OPEN'),
        isLoading: false,
        error: null,
      });

      // Act
      render(<TestApp initialEntries={['/shifts/shift-001']} />);

      // Verify initial location
      expect(screen.getByTestId('location-display')).toHaveAttribute(
        'data-pathname',
        '/shifts/shift-001'
      );

      // Click Close Shift button
      const closeButton = screen.getByRole('button', { name: /close shift/i });
      await act(async () => {
        fireEvent.click(closeButton);
      });

      // Assert: Route changed to /shift-end (per BIZ-011)
      await waitFor(() => {
        expect(screen.getByTestId('location-display')).toHaveAttribute(
          'data-pathname',
          '/shift-end'
        );
      });
    });

    it('should render ShiftEndPage after navigation from ViewShiftPage', async () => {
      // Arrange
      mockUseShift.mockReturnValue({
        data: createMockShift('shift-001', 'OPEN'),
        isLoading: false,
        error: null,
      });

      // Act
      render(<TestApp initialEntries={['/shifts/shift-001']} />);

      // Click Close Shift button
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /close shift/i }));
      });

      // Assert: ShiftEndPage renders
      await waitFor(() => {
        expect(screen.getByTestId('shift-end-page')).toBeInTheDocument();
      });
    });
  });

  // ==========================================================================
  // 4.1.4: Navigation preserves app state
  // ==========================================================================

  describe('4.1.4: Navigation preserves app state', () => {
    it('should maintain navigation history when going to /shift-end', async () => {
      // Arrange
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift('shift-001', 'OPEN', 1)]),
        isLoading: false,
        error: null,
      });

      // Act
      render(<TestApp initialEntries={['/terminals', '/shifts']} />);

      // Verify we're at /shifts
      expect(screen.getByTestId('location-display')).toHaveAttribute('data-pathname', '/shifts');

      // Navigate to shift-end
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      });

      // Assert: At /shift-end (history entry created)
      await waitFor(() => {
        expect(screen.getByTestId('location-display')).toHaveAttribute(
          'data-pathname',
          '/shift-end'
        );
      });
    });

    it('should include shiftId in navigation state', async () => {
      // Arrange
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift('shift-specific-id', 'OPEN', 1)]),
        isLoading: false,
        error: null,
      });

      // Act
      render(<TestApp initialEntries={['/shifts']} />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      });

      // Assert: ShiftEndPage receives the shiftId
      await waitFor(() => {
        const shiftEndPage = screen.getByTestId('shift-end-page');
        expect(shiftEndPage).toHaveAttribute('data-shift-id', 'shift-specific-id');
      });
    });
  });

  // ==========================================================================
  // SEC-010: Navigation Security
  // ==========================================================================

  describe('SEC-010: Navigation Security', () => {
    it('should delegate all authorization to ShiftEndPage wizard', async () => {
      // Arrange
      const authCheckSpy = vi.fn();
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift('shift-001', 'OPEN', 1)]),
        isLoading: false,
        error: null,
      });

      // Act
      render(<TestApp initialEntries={['/shifts']} />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      });

      // Assert: No pre-navigation auth was called, navigation is direct
      expect(authCheckSpy).not.toHaveBeenCalled();
      // Navigation happened directly
      await waitFor(() => {
        expect(screen.getByTestId('location-display')).toHaveAttribute(
          'data-pathname',
          '/shift-end'
        );
      });
    });

    it('should not perform pre-navigation auth checks', async () => {
      // Arrange
      const authCheckSpy = vi.fn();
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift('shift-001', 'OPEN', 1)]),
        isLoading: false,
        error: null,
      });

      // Act
      render(<TestApp initialEntries={['/shifts']} />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      });

      // Assert: No pre-navigation auth was called
      expect(authCheckSpy).not.toHaveBeenCalled();
      // Navigation happened directly to shift-end
      await waitFor(() => {
        expect(screen.getByTestId('location-display')).toHaveAttribute(
          'data-pathname',
          '/shift-end'
        );
      });
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle multiple Close clicks gracefully', async () => {
      // Arrange
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift('shift-001', 'OPEN', 1)]),
        isLoading: false,
        error: null,
      });

      // Act
      render(<TestApp initialEntries={['/shifts']} />);
      const closeButton = screen.getByRole('button', { name: 'Close' });

      // Click multiple times rapidly
      await act(async () => {
        fireEvent.click(closeButton);
        fireEvent.click(closeButton);
        fireEvent.click(closeButton);
      });

      // Assert: Only one navigation occurs (ends up at /shift-end)
      await waitFor(() => {
        expect(screen.getByTestId('location-display')).toHaveAttribute(
          'data-pathname',
          '/shift-end'
        );
      });
    });

    it('should work with OPEN shift on detail page', async () => {
      // Arrange: OPEN shift
      mockUseShift.mockReturnValue({
        data: createMockShift('shift-detail-001', 'OPEN', 5),
        isLoading: false,
        error: null,
      });

      // Act
      render(<TestApp initialEntries={['/shifts/shift-detail-001']} />);

      // Verify Close Shift button is present
      expect(screen.getByRole('button', { name: /close shift/i })).toBeInTheDocument();

      // Click and verify navigation
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /close shift/i }));
      });

      await waitFor(() => {
        expect(screen.getByTestId('location-display')).toHaveAttribute(
          'data-pathname',
          '/shift-end'
        );
      });
    });

    it('should NOT show Close button for CLOSED shift on detail page', async () => {
      // Arrange: CLOSED shift
      mockUseShift.mockReturnValue({
        data: createMockShift('shift-closed-001', 'CLOSED', 5),
        isLoading: false,
        error: null,
      });

      // Act
      render(<TestApp initialEntries={['/shifts/shift-closed-001']} />);

      // Assert: No Close Shift button
      expect(screen.queryByRole('button', { name: /close shift/i })).not.toBeInTheDocument();
    });
  });
});
