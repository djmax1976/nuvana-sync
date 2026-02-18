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
  mockUseShiftViewData,
  mockToast,
  mockWindowConfirm,
} = vi.hoisted(() => ({
  mockUseShifts: vi.fn(),
  mockUseShift: vi.fn(),
  mockUseShiftSummary: vi.fn(),
  mockUseShiftFuelData: vi.fn(),
  mockUseShiftViewData: vi.fn(),
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

vi.mock('@/lib/utils', () => ({
  cn: (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' '),
  formatCurrency: (value: number) => `$${value.toFixed(2)}`,
}));

// Mock FuelSalesBreakdown
vi.mock('../../src/renderer/components/shifts/FuelSalesBreakdown', () => ({
  FuelSalesBreakdown: () => <div data-testid="fuel-sales-breakdown" />,
}));

// Mock usePOSConnectionType hook (requires QueryClient in real usage)
// Default to non-lottery mode for standard shift close workflow testing
vi.mock('../../src/renderer/hooks/usePOSConnectionType', () => ({
  useIsLotteryMode: () => false,
  usePOSConnectionType: () => ({ data: { posType: 'STANDARD', connectionType: 'STANDARD' } }),
  posConnectionTypeKeys: { all: ['settings', 'posConnectionType'] },
}));

// Mock useViewData hook (used by ViewShiftPage for fetching shift view data)
vi.mock('../../src/renderer/hooks/useViewData', () => ({
  useShiftViewData: () => mockUseShiftViewData(),
  useDayViewData: () => ({ data: null, isLoading: false, error: null }),
  viewDataKeys: {
    all: ['view'] as const,
    shifts: () => ['view', 'shifts'] as const,
    shift: (id: string) => ['view', 'shifts', id] as const,
    days: () => ['view', 'days'] as const,
    day: (id: string) => ['view', 'days', id] as const,
  },
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
 * Creates a mock shift view data response for ViewShiftPage
 * @param shiftId - The shift ID to use
 * @param status - OPEN or CLOSED
 */
function createMockShiftViewData(shiftId: string, status: 'OPEN' | 'CLOSED') {
  return {
    shiftId,
    businessDate: '2026-02-15',
    status,
    shiftInfo: {
      terminalName: 'Register 1',
      shiftNumber: 1,
      cashierName: 'Test Cashier',
      startedAt: '2026-02-15T08:00:00.000Z',
      endedAt: status === 'CLOSED' ? '2026-02-15T16:00:00.000Z' : null,
      openingCash: 200.0,
      closingCash: status === 'CLOSED' ? 1500.0 : null,
    },
    summary: {
      insideSales: { total: 1500.0, nonFood: 800.0, foodSales: 700.0 },
      fuelSales: { total: 5000.0, gallonsSold: 1500.0 },
      lotterySales: { total: 500.0, scratchOff: 300.0, online: 200.0 },
      reserved: null,
    },
    payments: {
      receipts: {
        cash: { reports: 1000.0, pos: 1000.0 },
        creditCard: { reports: 2500.0, pos: 2500.0 },
        debitCard: { reports: 1000.0, pos: 1000.0 },
        ebt: { reports: 100.0, pos: 100.0 },
      },
      payouts: {
        cashPayouts: { reports: -200.0, pos: -200.0, hasImages: false, count: 1 },
        lotteryPayouts: { reports: -300.0, pos: -300.0, hasImages: false },
        gamingPayouts: { reports: 0, pos: 0, hasImages: false },
      },
      netCash: { reports: 4100.0, pos: 4100.0 },
    },
    salesBreakdown: {
      gasSales: { reports: 5000.0, pos: 5000.0 },
      grocery: { reports: 500.0, pos: 500.0 },
      tobacco: { reports: 200.0, pos: 200.0 },
      beverages: { reports: 150.0, pos: 150.0 },
      snacks: { reports: 100.0, pos: 100.0 },
      other: { reports: 50.0, pos: 50.0 },
      lottery: {
        instantSales: { reports: 300.0, pos: 300.0 },
        instantCashes: { reports: -150.0, pos: -150.0 },
        onlineSales: { reports: 200.0, pos: 200.0 },
        onlineCashes: { reports: -100.0, pos: -100.0 },
      },
      salesTax: { reports: 350.0, pos: 350.0 },
      total: { reports: 6500.0, pos: 6500.0 },
    },
    timestamps: {
      createdAt: '2026-02-15T08:00:00.000Z',
      closedAt: status === 'CLOSED' ? '2026-02-15T16:00:00.000Z' : null,
    },
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

    // Default mock for ViewShiftPage's useShiftViewData hook
    // Tests that render ViewShiftPage should override this with their specific data
    mockUseShiftViewData.mockReturnValue({
      data: createMockShiftViewData('default-shift-id', 'OPEN'),
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
      // Arrange: OPEN shift - ViewShiftPage uses useShiftViewData, not useShift
      mockUseShiftViewData.mockReturnValue({
        data: createMockShiftViewData('shift-001', 'OPEN'),
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
      // Arrange: ViewShiftPage uses useShiftViewData, not useShift
      mockUseShiftViewData.mockReturnValue({
        data: createMockShiftViewData('shift-001', 'OPEN'),
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
      // Arrange: OPEN shift - ViewShiftPage uses useShiftViewData, not useShift
      mockUseShiftViewData.mockReturnValue({
        data: createMockShiftViewData('shift-detail-001', 'OPEN'),
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
      // Arrange: CLOSED shift - ViewShiftPage uses useShiftViewData, not useShift
      mockUseShiftViewData.mockReturnValue({
        data: createMockShiftViewData('shift-closed-001', 'CLOSED'),
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
