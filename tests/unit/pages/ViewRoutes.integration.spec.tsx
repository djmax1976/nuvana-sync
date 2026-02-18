/**
 * ViewRoutes Integration Tests
 *
 * Integration tests verifying route configuration for view pages.
 * Tests that routes are correctly registered and render the expected components.
 *
 * Routes Tested:
 * - /shifts/:shiftId/view -> ViewShiftPage
 * - /days/:dayId/view -> ViewDayPage
 *
 * Test Standards Applied:
 * - TEST-001: AAA pattern (Arrange-Act-Assert)
 * - TEST-002: Descriptive test names
 * - TEST-003: Test isolation
 * - TEST-004: Deterministic tests
 *
 * @module tests/unit/pages/ViewRoutes.integration
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ============================================================================
// Mock Dependencies (Hoisted)
// ============================================================================

const { mockUseShiftViewData, mockUseDayViewData } = vi.hoisted(() => ({
  mockUseShiftViewData: vi.fn(),
  mockUseDayViewData: vi.fn(),
}));

// Mock useViewData hook
vi.mock('../../../src/renderer/hooks/useViewData', () => ({
  useShiftViewData: () => mockUseShiftViewData(),
  useDayViewData: () => mockUseDayViewData(),
}));

// Mock usePOSConnectionType hook (requires QueryClient)
vi.mock('../../../src/renderer/hooks/usePOSConnectionType', () => ({
  useIsLotteryMode: () => false,
  usePOSConnectionType: () => 'STANDARD' as const,
}));

// Mock LoadingSpinner
vi.mock('../../../src/renderer/components/ui/LoadingSpinner', () => ({
  LoadingSpinner: ({ size }: { size?: string }) => (
    <div data-testid="loading-spinner" data-size={size} role="status">
      Loading...
    </div>
  ),
}));

// ============================================================================
// Import Components Under Test (after mocks)
// ============================================================================

import ViewShiftPage from '../../../src/renderer/pages/ViewShiftPage';
import ViewDayPage from '../../../src/renderer/pages/ViewDayPage';

// ============================================================================
// Test Fixtures
// ============================================================================

const MOCK_SHIFT_VIEW_DATA = {
  shiftId: 'shift-0001-0000-0000-000000000001',
  businessDate: '2026-02-17',
  status: 'CLOSED' as const,
  shiftInfo: {
    terminalName: 'Register 1',
    shiftNumber: 3,
    cashierName: 'John Smith',
    startedAt: '2026-02-17T06:00:00.000Z',
    endedAt: '2026-02-17T14:30:00.000Z',
    openingCash: 200.0,
    closingCash: 1475.25,
  },
  summary: {
    insideSales: { total: 2847.5, nonFood: 1523.75, foodSales: 1323.75 },
    fuelSales: { total: 8965.3, gallonsSold: 2845.2 },
    lotterySales: { total: 1250.0, scratchOff: 850.0, online: 400.0 },
    reserved: null,
  },
  payments: {
    receipts: {
      cash: { reports: 2150.0, pos: 2147.5 },
      creditCard: { reports: 5420.0, pos: 5418.25 },
      debitCard: { reports: 1875.0, pos: 1875.0 },
      ebt: { reports: 245.0, pos: 245.0 },
    },
    payouts: {
      cashPayouts: { reports: -425.0, pos: -425.0, hasImages: true, count: 3 },
      lotteryPayouts: { reports: -850.0, pos: -850.0, hasImages: true },
      gamingPayouts: { reports: -125.0, pos: -125.0, hasImages: false },
    },
    netCash: { reports: 8290.0, pos: 8285.75 },
  },
  salesBreakdown: {
    gasSales: { reports: 8965.3, pos: 8962.5 },
    grocery: { reports: 1125.0, pos: 1123.75 },
    tobacco: { reports: 675.5, pos: 675.5 },
    beverages: { reports: 425.0, pos: 424.5 },
    snacks: { reports: 312.5, pos: 312.5 },
    other: { reports: 185.0, pos: 185.0 },
    lottery: {
      instantSales: { reports: 850.0, pos: 850.0 },
      instantCashes: { reports: -425.0, pos: -425.0 },
      onlineSales: { reports: 400.0, pos: 400.0 },
      onlineCashes: { reports: -175.0, pos: -175.0 },
    },
    salesTax: { reports: 542.75, pos: 542.75 },
    total: { reports: 12481.05, pos: 12476.5 },
  },
  timestamps: {
    createdAt: '2026-02-17T06:00:00.000Z',
    closedAt: '2026-02-17T14:30:00.000Z',
  },
};

const MOCK_DAY_VIEW_DATA = {
  daySummaryId: 'day-0001-0000-0000-000000000001',
  businessDate: '2026-02-17',
  status: 'CLOSED' as const,
  dayInfo: {
    businessDate: 'Feb 17, 2026',
    shiftCount: 3,
    firstShiftStarted: '2026-02-17T06:00:00.000Z',
    lastShiftEnded: '2026-02-17T22:30:00.000Z',
    totalOpeningCash: 200.0,
    totalClosingCash: 2850.75,
  },
  summary: {
    insideSales: { total: 4525.0, nonFood: 2415.5, foodSales: 2109.5 },
    fuelSales: { total: 15420.8, gallonsSold: 4892.5 },
    lotterySales: { total: 2175.0, scratchOff: 1450.0, online: 725.0 },
    reserved: null,
  },
  payments: {
    receipts: {
      cash: { reports: 4250.0, pos: 4247.5 },
      creditCard: { reports: 10840.0, pos: 10836.5 },
      debitCard: { reports: 3750.0, pos: 3750.0 },
      ebt: { reports: 490.0, pos: 490.0 },
    },
    payouts: {
      cashPayouts: { reports: -725.0, pos: -725.0, hasImages: true, count: 5 },
      lotteryPayouts: { reports: -1250.0, pos: -1250.0, hasImages: true },
      gamingPayouts: { reports: -200.0, pos: -200.0, hasImages: true },
    },
    netCash: { reports: 17155.0, pos: 17149.0 },
  },
  salesBreakdown: {
    gasSales: { reports: 15420.8, pos: 15418.0 },
    grocery: { reports: 1850.0, pos: 1848.5 },
    tobacco: { reports: 1125.5, pos: 1125.5 },
    beverages: { reports: 750.0, pos: 749.0 },
    snacks: { reports: 525.0, pos: 525.0 },
    other: { reports: 350.0, pos: 350.0 },
    lottery: {
      instantSales: { reports: 1450.0, pos: 1450.0 },
      instantCashes: { reports: -625.0, pos: -625.0 },
      onlineSales: { reports: 725.0, pos: 725.0 },
      onlineCashes: { reports: -275.0, pos: -275.0 },
    },
    salesTax: { reports: 892.5, pos: 892.5 },
    total: { reports: 22263.8, pos: 22258.5 },
  },
  lotteryDayId: 'lottery-day-0001-0000-000000000001',
  timestamps: {
    createdAt: '2026-02-17T06:00:00.000Z',
    closedAt: '2026-02-17T22:30:00.000Z',
  },
};

// ============================================================================
// Test Suite
// ============================================================================

describe('ViewRoutes Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseShiftViewData.mockReturnValue({
      data: MOCK_SHIFT_VIEW_DATA,
      isLoading: false,
      error: null,
    });
    mockUseDayViewData.mockReturnValue({
      data: MOCK_DAY_VIEW_DATA,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Route: /shifts/:shiftId/view
  // ==========================================================================

  describe('/shifts/:shiftId/view route', () => {
    it('should render ViewShiftPage when navigating to /shifts/:shiftId/view', () => {
      // Arrange
      const shiftId = 'shift-0001-0000-0000-000000000001';

      // Act
      render(
        <MemoryRouter initialEntries={[`/shifts/${shiftId}/view`]}>
          <Routes>
            <Route path="/shifts/:shiftId/view" element={<ViewShiftPage />} />
          </Routes>
        </MemoryRouter>
      );

      // Assert
      expect(screen.getByTestId('view-shift-page')).toBeInTheDocument();
      expect(screen.getByTestId('view-shift-page')).toHaveAttribute('data-shift-id', shiftId);
    });

    it('should extract shiftId from route params', () => {
      // Arrange
      const shiftId = 'a1b2c3d4-0000-0000-0000-000000000000';

      // Act
      render(
        <MemoryRouter initialEntries={[`/shifts/${shiftId}/view`]}>
          <Routes>
            <Route path="/shifts/:shiftId/view" element={<ViewShiftPage />} />
          </Routes>
        </MemoryRouter>
      );

      // Assert
      const page = screen.getByTestId('view-shift-page');
      expect(page).toHaveAttribute('data-shift-id', shiftId);
    });

    it('should render ViewHeader with shift title', () => {
      // Act
      render(
        <MemoryRouter initialEntries={['/shifts/shift-0001/view']}>
          <Routes>
            <Route path="/shifts/:shiftId/view" element={<ViewShiftPage />} />
          </Routes>
        </MemoryRouter>
      );

      // Assert
      expect(screen.getByText(/View Shift/)).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Route: /days/:dayId/view
  // ==========================================================================

  describe('/days/:dayId/view route', () => {
    it('should render ViewDayPage when navigating to /days/:dayId/view', () => {
      // Arrange
      const dayId = 'day-0001-0000-0000-000000000001';

      // Act
      render(
        <MemoryRouter initialEntries={[`/days/${dayId}/view`]}>
          <Routes>
            <Route path="/days/:dayId/view" element={<ViewDayPage />} />
          </Routes>
        </MemoryRouter>
      );

      // Assert
      expect(screen.getByTestId('view-day-page')).toBeInTheDocument();
      expect(screen.getByTestId('view-day-page')).toHaveAttribute('data-day-id', dayId);
    });

    it('should extract dayId from route params', () => {
      // Arrange
      const dayId = 'a1b2c3d4-0000-0000-0000-000000000000';

      // Act
      render(
        <MemoryRouter initialEntries={[`/days/${dayId}/view`]}>
          <Routes>
            <Route path="/days/:dayId/view" element={<ViewDayPage />} />
          </Routes>
        </MemoryRouter>
      );

      // Assert
      const page = screen.getByTestId('view-day-page');
      expect(page).toHaveAttribute('data-day-id', dayId);
    });

    it('should render ViewHeader with day title', () => {
      // Act
      render(
        <MemoryRouter initialEntries={['/days/day-0001/view']}>
          <Routes>
            <Route path="/days/:dayId/view" element={<ViewDayPage />} />
          </Routes>
        </MemoryRouter>
      );

      // Assert
      expect(screen.getByText('View Day')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Route Isolation Tests
  // ==========================================================================

  describe('Route Isolation', () => {
    it('should NOT render ViewDayPage on shift view route', () => {
      // Act
      render(
        <MemoryRouter initialEntries={['/shifts/shift-001/view']}>
          <Routes>
            <Route path="/shifts/:shiftId/view" element={<ViewShiftPage />} />
            <Route path="/days/:dayId/view" element={<ViewDayPage />} />
          </Routes>
        </MemoryRouter>
      );

      // Assert
      expect(screen.queryByTestId('view-day-page')).not.toBeInTheDocument();
      expect(screen.getByTestId('view-shift-page')).toBeInTheDocument();
    });

    it('should NOT render ViewShiftPage on day view route', () => {
      // Act
      render(
        <MemoryRouter initialEntries={['/days/day-001/view']}>
          <Routes>
            <Route path="/shifts/:shiftId/view" element={<ViewShiftPage />} />
            <Route path="/days/:dayId/view" element={<ViewDayPage />} />
          </Routes>
        </MemoryRouter>
      );

      // Assert
      expect(screen.queryByTestId('view-shift-page')).not.toBeInTheDocument();
      expect(screen.getByTestId('view-day-page')).toBeInTheDocument();
    });
  });
});
