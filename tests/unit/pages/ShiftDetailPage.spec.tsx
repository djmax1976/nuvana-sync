/**
 * ShiftDetailPage Unit Tests
 *
 * Tests the ShiftDetailPage component's navigation behavior and rendering:
 * - 3.2.2: Close Shift button renders for OPEN shifts only
 * - 3.2.3: Close Shift button hidden for CLOSED shifts
 * - 3.2.4: Close Shift button navigates to /shift-end?shiftId=xxx
 * - 3.2.5: No confirm dialog shown on close click
 * - 3.2.6: Shift header displays correct information
 * - 3.2.7: Loading state displays spinner
 * - 3.2.8: Error state displays error card
 * - 3.2.9: Shift not found displays error
 *
 * Story: Shift Workflow Fix - Phase 3 Unit Tests
 *
 * MCP Guidance Applied:
 * - TEST-001: AAA pattern (Arrange-Act-Assert)
 * - TEST-002: Descriptive test names
 * - TEST-003: Test isolation (mocks cleared between tests)
 * - TEST-004: Deterministic tests
 * - TEST-005: Single concept per test
 * - TEST-006: Test error paths
 * - ARCH-004: Component-level isolation tests
 * - Navigation delegates to ShiftEndPage for 2-step closing workflow
 *
 * @module tests/unit/pages/ShiftDetailPage
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ============================================================================
// Mock Dependencies (Hoisted)
// ============================================================================

const { mockNavigate, mockUseShift, mockUseShiftSummary, mockUseShiftFuelData, mockWindowConfirm } =
  vi.hoisted(() => ({
    mockNavigate: vi.fn(),
    mockUseShift: vi.fn(),
    mockUseShiftSummary: vi.fn(),
    mockUseShiftFuelData: vi.fn(),
    mockWindowConfirm: vi.fn(),
  }));

// Mock react-router-dom
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock shift hooks
vi.mock('../../../src/renderer/lib/hooks', () => ({
  useShift: () => mockUseShift(),
  useShiftSummary: () => mockUseShiftSummary(),
  useShiftFuelData: () => mockUseShiftFuelData(),
}));

// Mock FuelSalesBreakdown component (complex component not under test)
vi.mock('../../../src/renderer/components/shifts/FuelSalesBreakdown', () => ({
  FuelSalesBreakdown: () => <div data-testid="fuel-sales-breakdown" />,
}));

// ============================================================================
// Import Component Under Test (after mocks)
// ============================================================================

import ShiftDetailPage from '../../../src/renderer/pages/ShiftDetailPage';

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
 * Creates a mock shift summary
 */
function createMockSummary() {
  return {
    totalSales: 1500.0,
    netSales: 1400.0,
    grossSales: 1550.0,
    transactionCount: 50,
    totalVoided: 100.0,
    taxCollected: 105.0,
    fuelSales: 800.0,
    fuelGallons: 250.5,
    lotteryNet: 45.0,
    departmentBreakdown: [],
    tenderBreakdown: [],
    fuelByGrade: [],
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
 * Helper to render the page with a route parameter
 */
function renderWithRouter(shiftId: string = 'shift-001') {
  return render(
    <MemoryRouter initialEntries={[`/shifts/${shiftId}`]}>
      <Routes>
        <Route path="/shifts/:shiftId" element={<ShiftDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

/**
 * Sets up default mock return values for happy path
 */
function setupDefaultMocks(shift: ReturnType<typeof createMockShift> | null = null) {
  mockUseShift.mockReturnValue({
    data: shift ?? createMockShift('shift-001', 'OPEN'),
    isLoading: false,
    error: null,
  });

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
}

// ============================================================================
// Test Suite: ShiftDetailPage
// ============================================================================

describe('ShiftDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Save original and mock window.confirm
    mockWindowConfirm.mockReturnValue(true);
    vi.spyOn(window, 'confirm').mockImplementation(mockWindowConfirm);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 3.2.2: Close Shift button renders for OPEN shifts only
  // ==========================================================================

  describe('3.2.2: Close Shift button renders for OPEN shifts only', () => {
    it('should render Close Shift button when shift status is OPEN', () => {
      // Arrange: OPEN shift
      setupDefaultMocks(createMockShift('shift-001', 'OPEN'));

      // Act
      renderWithRouter();

      // Assert: Close Shift button should be present
      const closeButton = screen.getByRole('button', { name: /close shift/i });
      expect(closeButton).toBeInTheDocument();
    });

    it('should render Close Shift button with correct styling', () => {
      // Arrange: OPEN shift
      setupDefaultMocks(createMockShift('shift-001', 'OPEN'));

      // Act
      renderWithRouter();

      // Assert: Button should have red/destructive styling
      const closeButton = screen.getByRole('button', { name: /close shift/i });
      expect(closeButton).toHaveClass('bg-red-600');
    });
  });

  // ==========================================================================
  // 3.2.3: Close Shift button hidden for CLOSED shifts
  // ==========================================================================

  describe('3.2.3: Close Shift button hidden for CLOSED shifts', () => {
    it('should NOT render Close Shift button when shift status is CLOSED', () => {
      // Arrange: CLOSED shift
      setupDefaultMocks(createMockShift('shift-001', 'CLOSED'));

      // Act
      renderWithRouter();

      // Assert: Close Shift button should NOT be present
      expect(screen.queryByRole('button', { name: /close shift/i })).not.toBeInTheDocument();
    });

    it('should still render other shift content when CLOSED', () => {
      // Arrange: CLOSED shift with specific number
      setupDefaultMocks(createMockShift('shift-001', 'CLOSED', 42));

      // Act
      renderWithRouter();

      // Assert: Shift header should still be visible
      expect(screen.getByText('Shift #42')).toBeInTheDocument();
      expect(screen.getByText('CLOSED')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // 3.2.4: Close Shift button navigates to /shift-end?shiftId=xxx
  // ==========================================================================

  describe('3.2.4: Close Shift button navigates to /shift-end', () => {
    it('should navigate to /shift-end with shiftId when Close Shift button is clicked', () => {
      // Arrange: OPEN shift
      setupDefaultMocks(createMockShift('shift-001', 'OPEN'));
      renderWithRouter();

      // Act: Click the Close Shift button
      const closeButton = screen.getByRole('button', { name: /close shift/i });
      fireEvent.click(closeButton);

      // Assert: navigate should be called with /shift-end?shiftId=xxx
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/shift-end?shiftId=shift-001');
    });

    it('should navigate without passing shift ID in state', () => {
      // Arrange: OPEN shift with specific ID
      setupDefaultMocks(createMockShift('shift-specific-id', 'OPEN'));
      renderWithRouter('shift-specific-id');

      // Act
      fireEvent.click(screen.getByRole('button', { name: /close shift/i }));

      // Assert: navigate called with just the path, no state object
      const callArgs = mockNavigate.mock.calls[0];
      expect(callArgs.length).toBe(1); // Only path, no options/state
      expect(callArgs[0]).toBe('/shift-end?shiftId=shift-specific-id');
    });

    it('should navigate to shift end wizard for proper closing workflow', () => {
      // Arrange: OPEN shift
      setupDefaultMocks(createMockShift('shift-001', 'OPEN'));
      renderWithRouter();

      // Act
      fireEvent.click(screen.getByRole('button', { name: /close shift/i }));

      // Assert: Navigation happens without client-side auth checks
      // ShiftEndPage handles the 2-step closing workflow
      expect(mockNavigate).toHaveBeenCalledWith('/shift-end?shiftId=shift-001');
    });
  });

  // ==========================================================================
  // 3.2.5: No confirm dialog shown on close click
  // ==========================================================================

  describe('3.2.5: No confirm dialog shown on close click', () => {
    it('should NOT call window.confirm when Close Shift button is clicked', () => {
      // Arrange: OPEN shift
      setupDefaultMocks(createMockShift('shift-001', 'OPEN'));
      renderWithRouter();

      // Act: Click the Close Shift button
      fireEvent.click(screen.getByRole('button', { name: /close shift/i }));

      // Assert: window.confirm should NOT be called
      expect(mockWindowConfirm).not.toHaveBeenCalled();
    });

    it('should navigate immediately without any blocking dialog', () => {
      // Arrange: OPEN shift
      setupDefaultMocks(createMockShift('shift-001', 'OPEN'));
      renderWithRouter();

      // Act
      fireEvent.click(screen.getByRole('button', { name: /close shift/i }));

      // Assert: Navigation happens immediately
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockWindowConfirm).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 3.2.6: Shift header displays correct information
  // ==========================================================================

  describe('3.2.6: Shift header displays correct information', () => {
    it('should display shift number in header', () => {
      // Arrange: Shift with specific number
      setupDefaultMocks(createMockShift('shift-001', 'OPEN', 42));

      // Act
      renderWithRouter();

      // Assert: Shift number should be displayed
      expect(screen.getByText('Shift #42')).toBeInTheDocument();
    });

    it('should display shift status badge', () => {
      // Arrange: OPEN shift
      setupDefaultMocks(createMockShift('shift-001', 'OPEN'));

      // Act
      renderWithRouter();

      // Assert: Status badge should show OPEN
      expect(screen.getByText('OPEN')).toBeInTheDocument();
    });

    it('should display CLOSED status for closed shifts', () => {
      // Arrange: CLOSED shift
      setupDefaultMocks(createMockShift('shift-001', 'CLOSED'));

      // Act
      renderWithRouter();

      // Assert: Status should show CLOSED
      expect(screen.getByText('CLOSED')).toBeInTheDocument();
    });

    it('should display business date', () => {
      // Arrange: Shift with specific business_date
      setupDefaultMocks(createMockShift('shift-001', 'OPEN'));

      // Act
      renderWithRouter();

      // Assert: Date should be displayed in the shift header section
      // Date format varies by locale/timezone; verify the date text element exists
      // by checking for a date-like pattern in the muted-foreground element under h2
      const headerSection = screen.getByRole('heading', { level: 2 });
      expect(headerSection).toBeInTheDocument();
      expect(headerSection.textContent).toContain('Shift #1');

      // The date is in a sibling p element - verify container has date-related content
      const shiftCard = headerSection.closest('.bg-card');
      expect(shiftCard).toBeInTheDocument();
      // The date element contains "2026" somewhere in the rendered content
      expect(shiftCard?.textContent).toContain('2026');
    });
  });

  // ==========================================================================
  // 3.2.7: Loading state displays spinner
  // ==========================================================================

  describe('3.2.7: Loading state displays spinner', () => {
    it('should display LoadingSpinner when shift is loading', () => {
      // Arrange: Set loading state
      mockUseShift.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      });

      // Summary and fuel hooks should also be set up (but not relevant for loading)
      mockUseShiftSummary.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });
      mockUseShiftFuelData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert: Loading spinner should be visible
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    });

    it('should NOT display shift content when loading', () => {
      // Arrange
      mockUseShift.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      });
      mockUseShiftSummary.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });
      mockUseShiftFuelData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert: Shift content should not be present
      expect(screen.queryByText(/Shift #/)).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // 3.2.8: Error state displays error card
  // ==========================================================================

  describe('3.2.8: Error state displays error card', () => {
    it('should display error card when query returns error', () => {
      // Arrange: Set error state
      mockUseShift.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Failed to load shift details'),
      });
      mockUseShiftSummary.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });
      mockUseShiftFuelData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert: Error card should be visible
      expect(screen.getByText('Error loading shift')).toBeInTheDocument();
      expect(screen.getByText('Failed to load shift details')).toBeInTheDocument();
    });

    it('should NOT display shift content when error', () => {
      // Arrange
      mockUseShift.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Error'),
      });
      mockUseShiftSummary.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });
      mockUseShiftFuelData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert: Shift content should not be present
      expect(screen.queryByText(/Shift #/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /close shift/i })).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // 3.2.9: Shift not found displays error
  // ==========================================================================

  describe('3.2.9: Shift not found displays error', () => {
    it('should display "Shift not found" when shift data is null', () => {
      // Arrange: No shift data (not loading, no error, but null data)
      mockUseShift.mockReturnValue({
        data: null,
        isLoading: false,
        error: null,
      });
      mockUseShiftSummary.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });
      mockUseShiftFuelData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter('nonexistent-shift');

      // Assert: Should show "Shift not found" message
      expect(screen.getByText('Shift not found')).toBeInTheDocument();
    });

    it('should display "Shift not found" when shift data is undefined', () => {
      // Arrange: Undefined shift data
      mockUseShift.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });
      mockUseShiftSummary.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });
      mockUseShiftFuelData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert: Should show "Shift not found" message
      expect(screen.getByText('Shift not found')).toBeInTheDocument();
    });

    it('should NOT display Close Shift button when shift not found', () => {
      // Arrange: No shift data
      mockUseShift.mockReturnValue({
        data: null,
        isLoading: false,
        error: null,
      });
      mockUseShiftSummary.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });
      mockUseShiftFuelData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert: Close Shift button should not be present
      expect(screen.queryByRole('button', { name: /close shift/i })).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Additional Tests: Summary and Fuel Data
  // ==========================================================================

  describe('Summary section', () => {
    it('should display loading spinner while summary is loading', () => {
      // Arrange: Shift loaded, summary loading
      setupDefaultMocks();
      mockUseShiftSummary.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert: Should have at least one loading spinner (in summary section)
      const spinners = screen.getAllByRole('status');
      expect(spinners.length).toBeGreaterThan(0);
    });

    it('should display "No summary data available" when summary is null', () => {
      // Arrange: Shift loaded, no summary
      setupDefaultMocks();
      mockUseShiftSummary.mockReturnValue({
        data: null,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert
      expect(screen.getByText('No summary data available')).toBeInTheDocument();
    });
  });

  describe('Navigation to Shift End Wizard', () => {
    it('should navigate immediately without any auth prompts', () => {
      // Arrange: OPEN shift
      setupDefaultMocks(createMockShift('shift-001', 'OPEN'));
      renderWithRouter();

      // Act: Click Close Shift button
      fireEvent.click(screen.getByRole('button', { name: /close shift/i }));

      // Assert: Navigation happens immediately
      // ShiftEndPage handles the 2-step closing workflow
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/shift-end?shiftId=shift-001');
    });
  });
});
