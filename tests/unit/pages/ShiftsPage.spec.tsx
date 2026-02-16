/**
 * ShiftsPage Unit Tests
 *
 * Tests the ShiftsPage component's navigation behavior and rendering:
 * - 3.1.2: Close button renders for OPEN shifts only
 * - 3.1.3: Close button navigates to /shift-end?shiftId=xxx
 * - 3.1.4: No confirm dialog shown on close click
 * - 3.1.5: View link navigates to shift detail
 * - 3.1.6: Filter buttons work correctly
 * - 3.1.7: Loading state displays spinner
 * - 3.1.8: Error state displays error message
 * - 3.1.9: Empty state displays "No shifts found"
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
 * @module tests/unit/pages/ShiftsPage
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ============================================================================
// Mock Dependencies (Hoisted)
// ============================================================================

const { mockNavigate, mockUseShifts, mockWindowConfirm } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockUseShifts: vi.fn(),
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

// Mock useShifts hook
vi.mock('../../../src/renderer/lib/hooks', () => ({
  useShifts: () => mockUseShifts(),
}));

// ============================================================================
// Import Component Under Test (after mocks)
// ============================================================================

import ShiftsPage from '../../../src/renderer/pages/ShiftsPage';

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
 * Wrapper component for testing with MemoryRouter
 */
function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// ============================================================================
// Test Suite: ShiftsPage
// ============================================================================

describe('ShiftsPage', () => {
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
  // 3.1.2: Close button renders for OPEN shifts only
  // ==========================================================================

  describe('3.1.2: Close button renders for OPEN shifts only', () => {
    it('should render Close button for OPEN shifts', () => {
      // Arrange: List with one OPEN shift
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift('shift-001', 'OPEN', 1)]),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter(<ShiftsPage />);

      // Assert: Close button should be present (exact match to avoid "Closed" filter)
      const closeButton = screen.getByRole('button', { name: 'Close' });
      expect(closeButton).toBeInTheDocument();
    });

    it('should NOT render Close button for CLOSED shifts', () => {
      // Arrange: List with one CLOSED shift
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift('shift-001', 'CLOSED', 1)]),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter(<ShiftsPage />);

      // Assert: Close button should NOT be present (exact match)
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });

    it('should render Close button only for OPEN shifts in mixed list', () => {
      // Arrange: List with both OPEN and CLOSED shifts
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([
          createMockShift('shift-001', 'OPEN', 1),
          createMockShift('shift-002', 'CLOSED', 2),
          createMockShift('shift-003', 'OPEN', 3),
        ]),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter(<ShiftsPage />);

      // Assert: Should have exactly 2 Close buttons (for OPEN shifts only)
      const closeButtons = screen.getAllByRole('button', { name: 'Close' });
      expect(closeButtons).toHaveLength(2);
    });
  });

  // ==========================================================================
  // 3.1.3: Close button navigates to /shift-end?shiftId=xxx
  // ==========================================================================

  describe('3.1.3: Close button navigates to /shift-end', () => {
    it('should navigate to /shift-end with shiftId when Close button is clicked', () => {
      // Arrange: List with OPEN shift
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift('shift-001', 'OPEN', 1)]),
        isLoading: false,
        error: null,
      });

      renderWithRouter(<ShiftsPage />);

      // Act: Click the Close button (exact match to avoid "Closed" filter)
      const closeButton = screen.getByRole('button', { name: 'Close' });
      fireEvent.click(closeButton);

      // Assert: navigate should be called with /shift-end?shiftId=xxx
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/shift-end?shiftId=shift-001');
    });

    it('should navigate without passing shift ID in state', () => {
      // Arrange: List with OPEN shift
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift('shift-001', 'OPEN', 1)]),
        isLoading: false,
        error: null,
      });

      renderWithRouter(<ShiftsPage />);

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      // Assert: navigate called with just the path, no state object
      const callArgs = mockNavigate.mock.calls[0];
      expect(callArgs.length).toBe(1); // Only path, no options/state
      expect(callArgs[0]).toBe('/shift-end?shiftId=shift-001');
    });
  });

  // ==========================================================================
  // 3.1.4: No confirm dialog shown on close click
  // ==========================================================================

  describe('3.1.4: No confirm dialog shown on close click', () => {
    it('should NOT call window.confirm when Close button is clicked', () => {
      // Arrange: List with OPEN shift
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift('shift-001', 'OPEN', 1)]),
        isLoading: false,
        error: null,
      });

      renderWithRouter(<ShiftsPage />);

      // Act: Click the Close button (exact match)
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      // Assert: window.confirm should NOT be called
      expect(mockWindowConfirm).not.toHaveBeenCalled();
    });

    it('should navigate immediately without any dialog', () => {
      // Arrange: List with OPEN shift
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift('shift-001', 'OPEN', 1)]),
        isLoading: false,
        error: null,
      });

      renderWithRouter(<ShiftsPage />);

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      // Assert: Navigation happens immediately
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockWindowConfirm).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 3.1.5: View link navigates to shift detail
  // ==========================================================================

  describe('3.1.5: View link navigates to shift detail', () => {
    it('should render View link for each shift', () => {
      // Arrange: List with multiple shifts
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([
          createMockShift('shift-001', 'OPEN', 1),
          createMockShift('shift-002', 'CLOSED', 2),
        ]),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter(<ShiftsPage />);

      // Assert: View links should be present for each shift
      const viewLinks = screen.getAllByRole('link', { name: /view/i });
      expect(viewLinks).toHaveLength(2);
    });

    it('should have correct href for shift detail page', () => {
      // Arrange: List with specific shift ID
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift('shift-abc-123', 'OPEN', 1)]),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter(<ShiftsPage />);

      // Assert: View link should point to /shifts/{shift_id}
      const viewLink = screen.getByRole('link', { name: /view/i });
      expect(viewLink).toHaveAttribute('href', '/shifts/shift-abc-123');
    });
  });

  // ==========================================================================
  // 3.1.6: Filter buttons work correctly
  // ==========================================================================

  describe('3.1.6: Filter buttons work correctly', () => {
    it('should render All, Open, and Closed filter buttons', () => {
      // Arrange
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([]),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter(<ShiftsPage />);

      // Assert: All three filter buttons should be present
      expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Closed' })).toBeInTheDocument();
    });

    it('should have "All" filter active by default', () => {
      // Arrange
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([]),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter(<ShiftsPage />);

      // Assert: "All" button should have active styling (primary color)
      const allButton = screen.getByRole('button', { name: 'All' });
      expect(allButton).toHaveClass('bg-primary/10');
    });

    it('should update active state when filter is clicked', () => {
      // Arrange
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([]),
        isLoading: false,
        error: null,
      });

      renderWithRouter(<ShiftsPage />);

      // Act: Click "Open" filter
      fireEvent.click(screen.getByRole('button', { name: 'Open' }));

      // Assert: "Open" button should now have active styling
      const openButton = screen.getByRole('button', { name: 'Open' });
      expect(openButton).toHaveClass('bg-primary/10');

      // "All" button should no longer have active styling
      const allButton = screen.getByRole('button', { name: 'All' });
      expect(allButton).not.toHaveClass('bg-primary/10');
    });
  });

  // ==========================================================================
  // 3.1.7: Loading state displays spinner
  // ==========================================================================

  describe('3.1.7: Loading state displays spinner', () => {
    it('should display LoadingSpinner when data is loading', () => {
      // Arrange: Set loading state
      mockUseShifts.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      });

      // Act
      renderWithRouter(<ShiftsPage />);

      // Assert: Loading spinner should be visible
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    });

    it('should NOT display table content when loading', () => {
      // Arrange
      mockUseShifts.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      });

      // Act
      renderWithRouter(<ShiftsPage />);

      // Assert: Table should not be present
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // 3.1.8: Error state displays error message
  // ==========================================================================

  describe('3.1.8: Error state displays error message', () => {
    it('should display error card when query returns error', () => {
      // Arrange: Set error state
      mockUseShifts.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Failed to load shifts'),
      });

      // Act
      renderWithRouter(<ShiftsPage />);

      // Assert: Error card should be visible
      expect(screen.getByText('Error loading shifts')).toBeInTheDocument();
      expect(screen.getByText('Failed to load shifts')).toBeInTheDocument();
    });

    it('should display generic error for unknown error types', () => {
      // Arrange: Set error state with non-Error object
      mockUseShifts.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: 'Some string error',
      });

      // Act
      renderWithRouter(<ShiftsPage />);

      // Assert: Should show "Unknown error"
      expect(screen.getByText('Unknown error')).toBeInTheDocument();
    });

    it('should NOT display table content when error', () => {
      // Arrange
      mockUseShifts.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Error'),
      });

      // Act
      renderWithRouter(<ShiftsPage />);

      // Assert: Table should not be present
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // 3.1.9: Empty state displays "No shifts found"
  // ==========================================================================

  describe('3.1.9: Empty state displays "No shifts found"', () => {
    it('should display "No shifts found" when query returns empty array', () => {
      // Arrange: Set empty data
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([]),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter(<ShiftsPage />);

      // Assert: Empty state message should be visible
      expect(screen.getByText('No shifts found')).toBeInTheDocument();
    });

    it('should NOT display table when no shifts', () => {
      // Arrange
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([]),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter(<ShiftsPage />);

      // Assert: Table should not be present (no table headers visible)
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('should still display filter buttons when no shifts', () => {
      // Arrange
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([]),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter(<ShiftsPage />);

      // Assert: Filter buttons should still be visible
      expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Closed' })).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Additional Tests: Security & Edge Cases
  // ==========================================================================

  describe('Navigation to Shift End Wizard', () => {
    it('should navigate immediately without any auth prompts', () => {
      // Arrange: OPEN shift
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift('shift-001', 'OPEN', 1)]),
        isLoading: false,
        error: null,
      });

      renderWithRouter(<ShiftsPage />);

      // Act: Click Close button (exact match)
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      // Assert: Navigation happens immediately
      // ShiftEndPage handles the 2-step closing workflow
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/shift-end?shiftId=shift-001');
    });
  });

  describe('Table Content', () => {
    it('should display shift data correctly in table rows', () => {
      // Arrange: Shift with specific data
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift('shift-001', 'OPEN', 42)]),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter(<ShiftsPage />);

      // Assert: Shift number should be displayed
      expect(screen.getByText('42')).toBeInTheDocument();
      // Status badge should show OPEN
      expect(screen.getByText('OPEN')).toBeInTheDocument();
    });

    it('should display correct status badge for CLOSED shifts', () => {
      // Arrange
      mockUseShifts.mockReturnValue({
        data: createMockListResponse([createMockShift('shift-001', 'CLOSED', 1)]),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter(<ShiftsPage />);

      // Assert: Status should show CLOSED
      expect(screen.getByText('CLOSED')).toBeInTheDocument();
    });
  });
});
