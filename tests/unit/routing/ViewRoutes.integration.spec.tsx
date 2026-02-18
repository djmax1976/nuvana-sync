/**
 * View Routes Integration Tests
 *
 * Tests for routing integration of View pages:
 * - /shifts/:shiftId/view renders ViewShiftPage
 * - /days/:dayId/view renders ViewDayPage
 * - Invalid IDs handled gracefully
 * - Route parameter extraction works correctly
 *
 * Test Standards Applied:
 * - TEST-001: AAA pattern (Arrange-Act-Assert)
 * - TEST-002: Descriptive test names
 * - TEST-003: Test isolation
 * - TEST-004: Deterministic tests
 * - TEST-005: Single concept per test
 * - TEST-006: Test error paths
 *
 * @module tests/integration/routing/ViewRoutes.integration
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ============================================================================
// Mock Dependencies (Hoisted)
// ============================================================================

const { mockNavigate, mockUseShiftViewData, mockUseDayViewData } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockUseShiftViewData: vi.fn(),
  mockUseDayViewData: vi.fn(),
}));

// Mock react-router-dom
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock useViewData hooks
vi.mock('../../../src/renderer/hooks/useViewData', () => ({
  useShiftViewData: (shiftId: string | undefined) => mockUseShiftViewData(shiftId),
  useDayViewData: (dayId: string | undefined) => mockUseDayViewData(dayId),
}));

// Mock usePOSConnectionType hook (requires QueryClient)
vi.mock('../../../src/renderer/hooks/usePOSConnectionType', () => ({
  useIsLotteryMode: () => false,
  usePOSConnectionType: () => 'STANDARD' as const,
}));

// Mock LoadingSpinner
vi.mock('../../../src/renderer/components/ui/LoadingSpinner', () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner">Loading...</div>,
}));

// ============================================================================
// Import Components Under Test
// ============================================================================

import ViewShiftPage from '../../../src/renderer/pages/ViewShiftPage';
import ViewDayPage from '../../../src/renderer/pages/ViewDayPage';

// ============================================================================
// Test Fixtures
// ============================================================================

const MOCK_SHIFT_DATA = {
  shiftId: 'shift-uuid-123',
  businessDate: '2026-02-17',
  status: 'CLOSED' as const,
  shiftInfo: {
    terminalName: 'Register 1',
    shiftNumber: 1,
    cashierName: 'Test Cashier',
    startedAt: '2026-02-17T06:00:00.000Z',
    endedAt: '2026-02-17T14:00:00.000Z',
    openingCash: 100.0,
    closingCash: 500.0,
  },
  summary: {
    insideSales: { total: 1000.0, nonFood: 600.0, foodSales: 400.0 },
    fuelSales: { total: 2000.0, gallonsSold: 500.0 },
    lotterySales: { total: 500.0, scratchOff: 300.0, online: 200.0 },
    reserved: null,
  },
  payments: {
    receipts: {
      cash: { reports: 1000.0, pos: 1000.0 },
      creditCard: { reports: 2000.0, pos: 2000.0 },
      debitCard: { reports: 500.0, pos: 500.0 },
      ebt: { reports: 100.0, pos: 100.0 },
    },
    payouts: {
      cashPayouts: { reports: -100.0, pos: -100.0, hasImages: false, count: 0 },
      lotteryPayouts: { reports: -200.0, pos: -200.0, hasImages: false },
      gamingPayouts: { reports: -50.0, pos: -50.0, hasImages: false },
    },
    netCash: { reports: 3250.0, pos: 3250.0 },
  },
  salesBreakdown: {
    gasSales: { reports: 2000.0, pos: 2000.0 },
    grocery: { reports: 400.0, pos: 400.0 },
    tobacco: { reports: 200.0, pos: 200.0 },
    beverages: { reports: 150.0, pos: 150.0 },
    snacks: { reports: 100.0, pos: 100.0 },
    other: { reports: 50.0, pos: 50.0 },
    lottery: {
      instantSales: { reports: 300.0, pos: 300.0 },
      instantCashes: { reports: -100.0, pos: -100.0 },
      onlineSales: { reports: 200.0, pos: 200.0 },
      onlineCashes: { reports: -50.0, pos: -50.0 },
    },
    salesTax: { reports: 100.0, pos: 100.0 },
    total: { reports: 3500.0, pos: 3500.0 },
  },
  timestamps: {
    createdAt: '2026-02-17T06:00:00.000Z',
    closedAt: '2026-02-17T14:00:00.000Z',
  },
};

const MOCK_DAY_DATA = {
  daySummaryId: 'day-uuid-456',
  businessDate: '2026-02-17',
  status: 'CLOSED' as const,
  dayInfo: {
    businessDate: 'Feb 17, 2026',
    shiftCount: 2,
    firstShiftStarted: '2026-02-17T06:00:00.000Z',
    lastShiftEnded: '2026-02-17T22:00:00.000Z',
    totalOpeningCash: 200.0,
    totalClosingCash: 1000.0,
  },
  summary: {
    insideSales: { total: 2000.0, nonFood: 1200.0, foodSales: 800.0 },
    fuelSales: { total: 4000.0, gallonsSold: 1000.0 },
    lotterySales: { total: 1000.0, scratchOff: 600.0, online: 400.0 },
    reserved: null,
  },
  payments: {
    receipts: {
      cash: { reports: 2000.0, pos: 2000.0 },
      creditCard: { reports: 4000.0, pos: 4000.0 },
      debitCard: { reports: 1000.0, pos: 1000.0 },
      ebt: { reports: 200.0, pos: 200.0 },
    },
    payouts: {
      cashPayouts: { reports: -200.0, pos: -200.0, hasImages: false, count: 0 },
      lotteryPayouts: { reports: -400.0, pos: -400.0, hasImages: false },
      gamingPayouts: { reports: -100.0, pos: -100.0, hasImages: false },
    },
    netCash: { reports: 6500.0, pos: 6500.0 },
  },
  salesBreakdown: {
    gasSales: { reports: 4000.0, pos: 4000.0 },
    grocery: { reports: 800.0, pos: 800.0 },
    tobacco: { reports: 400.0, pos: 400.0 },
    beverages: { reports: 300.0, pos: 300.0 },
    snacks: { reports: 200.0, pos: 200.0 },
    other: { reports: 100.0, pos: 100.0 },
    lottery: {
      instantSales: { reports: 600.0, pos: 600.0 },
      instantCashes: { reports: -200.0, pos: -200.0 },
      onlineSales: { reports: 400.0, pos: 400.0 },
      onlineCashes: { reports: -100.0, pos: -100.0 },
    },
    salesTax: { reports: 200.0, pos: 200.0 },
    total: { reports: 7000.0, pos: 7000.0 },
  },
  lotteryDayId: 'lottery-day-uuid-789',
  timestamps: {
    createdAt: '2026-02-17T06:00:00.000Z',
    closedAt: '2026-02-17T22:00:00.000Z',
  },
};

// ============================================================================
// Test Utilities
// ============================================================================

function renderWithRoutes(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/shifts/:shiftId/view" element={<ViewShiftPage />} />
        <Route path="/days/:dayId/view" element={<ViewDayPage />} />
        <Route path="/" element={<div data-testid="home-page">Home</div>} />
        <Route path="*" element={<div data-testid="not-found">Not Found</div>} />
      </Routes>
    </MemoryRouter>
  );
}

// ============================================================================
// Test Suite
// ============================================================================

describe('View Routes Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // ViewShiftPage Route Tests
  // ==========================================================================

  describe('/shifts/:shiftId/view Route', () => {
    it('should render ViewShiftPage for valid shift route', async () => {
      // Arrange
      mockUseShiftViewData.mockReturnValue({
        data: MOCK_SHIFT_DATA,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRoutes('/shifts/shift-uuid-123/view');

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('view-shift-page')).toBeInTheDocument();
      });
    });

    it('should extract shiftId from URL and pass to component', async () => {
      // Arrange
      const expectedShiftId = 'shift-test-12345';
      mockUseShiftViewData.mockReturnValue({
        data: MOCK_SHIFT_DATA,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRoutes(`/shifts/${expectedShiftId}/view`);

      // Assert
      await waitFor(() => {
        const page = screen.getByTestId('view-shift-page');
        expect(page).toHaveAttribute('data-shift-id', expectedShiftId);
      });
    });

    it('should call useShiftViewData with correct shiftId', async () => {
      // Arrange
      const testShiftId = 'shift-hook-test';
      mockUseShiftViewData.mockReturnValue({
        data: MOCK_SHIFT_DATA,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRoutes(`/shifts/${testShiftId}/view`);

      // Assert
      expect(mockUseShiftViewData).toHaveBeenCalledWith(testShiftId);
    });

    it('should handle UUID format shiftId', async () => {
      // Arrange
      const uuidShiftId = '550e8400-e29b-41d4-a716-446655440000';
      mockUseShiftViewData.mockReturnValue({
        data: MOCK_SHIFT_DATA,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRoutes(`/shifts/${uuidShiftId}/view`);

      // Assert
      await waitFor(() => {
        const page = screen.getByTestId('view-shift-page');
        expect(page).toHaveAttribute('data-shift-id', uuidShiftId);
      });
    });

    it('should show loading state while fetching shift data', () => {
      // Arrange
      mockUseShiftViewData.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      });

      // Act
      renderWithRoutes('/shifts/shift-loading/view');

      // Assert
      expect(screen.getByTestId('view-shift-page-loading')).toBeInTheDocument();
      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    });

    it('should show error state for invalid shiftId', () => {
      // Arrange
      mockUseShiftViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Shift not found'),
      });

      // Act
      renderWithRoutes('/shifts/invalid-shift/view');

      // Assert
      expect(screen.getByTestId('view-shift-page-error')).toBeInTheDocument();
      expect(screen.getByText('Shift not found')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // ViewDayPage Route Tests
  // ==========================================================================

  describe('/days/:dayId/view Route', () => {
    it('should render ViewDayPage for valid day route', async () => {
      // Arrange
      mockUseDayViewData.mockReturnValue({
        data: MOCK_DAY_DATA,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRoutes('/days/day-uuid-456/view');

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('view-day-page')).toBeInTheDocument();
      });
    });

    it('should extract dayId from URL and pass to component', async () => {
      // Arrange
      const expectedDayId = 'day-test-67890';
      mockUseDayViewData.mockReturnValue({
        data: MOCK_DAY_DATA,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRoutes(`/days/${expectedDayId}/view`);

      // Assert
      await waitFor(() => {
        const page = screen.getByTestId('view-day-page');
        expect(page).toHaveAttribute('data-day-id', expectedDayId);
      });
    });

    it('should call useDayViewData with correct dayId', async () => {
      // Arrange
      const testDayId = 'day-hook-test';
      mockUseDayViewData.mockReturnValue({
        data: MOCK_DAY_DATA,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRoutes(`/days/${testDayId}/view`);

      // Assert
      expect(mockUseDayViewData).toHaveBeenCalledWith(testDayId);
    });

    it('should render lottery section when lotteryDayId exists', async () => {
      // Arrange
      mockUseDayViewData.mockReturnValue({
        data: MOCK_DAY_DATA,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRoutes('/days/day-with-lottery/view');

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('lottery-section')).toBeInTheDocument();
      });
    });

    it('should NOT render lottery section when lotteryDayId is null', async () => {
      // Arrange
      mockUseDayViewData.mockReturnValue({
        data: { ...MOCK_DAY_DATA, lotteryDayId: null },
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRoutes('/days/day-no-lottery/view');

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('view-day-page')).toBeInTheDocument();
        expect(screen.queryByTestId('lottery-section')).not.toBeInTheDocument();
      });
    });

    it('should show loading state while fetching day data', () => {
      // Arrange
      mockUseDayViewData.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      });

      // Act
      renderWithRoutes('/days/day-loading/view');

      // Assert
      expect(screen.getByTestId('view-day-page-loading')).toBeInTheDocument();
    });

    it('should show error state for invalid dayId', () => {
      // Arrange
      mockUseDayViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Day not found'),
      });

      // Act
      renderWithRoutes('/days/invalid-day/view');

      // Assert
      expect(screen.getByTestId('view-day-page-error')).toBeInTheDocument();
      expect(screen.getByText('Day not found')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Route Parameter Handling
  // ==========================================================================

  describe('Route Parameter Handling', () => {
    it('should handle special characters in shiftId', async () => {
      // Arrange
      const specialId = 'shift-with-special_chars.123';
      mockUseShiftViewData.mockReturnValue({
        data: MOCK_SHIFT_DATA,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRoutes(`/shifts/${specialId}/view`);

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('view-shift-page')).toBeInTheDocument();
      });
    });

    it('should handle special characters in dayId', async () => {
      // Arrange
      const specialId = 'day-with-special_chars.456';
      mockUseDayViewData.mockReturnValue({
        data: MOCK_DAY_DATA,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRoutes(`/days/${specialId}/view`);

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('view-day-page')).toBeInTheDocument();
      });
    });
  });

  // ==========================================================================
  // Route Differentiation Tests
  // ==========================================================================

  describe('Route Differentiation', () => {
    it('should render different pages for /shifts and /days routes', async () => {
      // Arrange
      mockUseShiftViewData.mockReturnValue({
        data: MOCK_SHIFT_DATA,
        isLoading: false,
        error: null,
      });
      mockUseDayViewData.mockReturnValue({
        data: MOCK_DAY_DATA,
        isLoading: false,
        error: null,
      });

      // Act - Render shift page
      const { unmount } = renderWithRoutes('/shifts/shift-001/view');

      // Assert - Shift page
      await waitFor(() => {
        expect(screen.getByTestId('view-shift-page')).toBeInTheDocument();
        expect(screen.queryByTestId('view-day-page')).not.toBeInTheDocument();
      });

      // Cleanup and render day page
      unmount();
      renderWithRoutes('/days/day-001/view');

      // Assert - Day page
      await waitFor(() => {
        expect(screen.getByTestId('view-day-page')).toBeInTheDocument();
        expect(screen.queryByTestId('view-shift-page')).not.toBeInTheDocument();
      });
    });

    it('should render ViewShiftPage WITHOUT lottery section', async () => {
      // Arrange
      mockUseShiftViewData.mockReturnValue({
        data: MOCK_SHIFT_DATA,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRoutes('/shifts/shift-001/view');

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('view-shift-page')).toBeInTheDocument();
        expect(screen.queryByTestId('lottery-section')).not.toBeInTheDocument();
      });
    });

    it('should render ViewDayPage WITH lottery section', async () => {
      // Arrange
      mockUseDayViewData.mockReturnValue({
        data: MOCK_DAY_DATA,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRoutes('/days/day-001/view');

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('view-day-page')).toBeInTheDocument();
        expect(screen.getByTestId('lottery-section')).toBeInTheDocument();
      });
    });
  });

  // ==========================================================================
  // Error Recovery Tests
  // ==========================================================================

  describe('Error Recovery', () => {
    it('should provide Go Back button on shift error page', () => {
      // Arrange
      mockUseShiftViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Network error'),
      });

      // Act
      renderWithRoutes('/shifts/error-shift/view');

      // Assert
      const goBackButton = screen.getByRole('button', { name: /go back/i });
      expect(goBackButton).toBeInTheDocument();
    });

    it('should provide Go Back button on day error page', () => {
      // Arrange
      mockUseDayViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Network error'),
      });

      // Act
      renderWithRoutes('/days/error-day/view');

      // Assert
      const goBackButton = screen.getByRole('button', { name: /go back/i });
      expect(goBackButton).toBeInTheDocument();
    });
  });
});
