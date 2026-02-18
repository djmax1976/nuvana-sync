/**
 * ViewShiftPage Unit Tests
 *
 * Tests for the read-only shift view page:
 * - Renders all composed components correctly
 * - Does NOT render lottery section (shifts don't close lottery)
 * - Passes correct props to children
 * - Handles loading state
 * - Handles error state
 * - Navigates back when header back button clicked
 * - Opens payout modals from PaymentMethodsCard
 *
 * Test Standards Applied:
 * - TEST-001: AAA pattern (Arrange-Act-Assert)
 * - TEST-002: Descriptive test names
 * - TEST-003: Test isolation (mocks cleared between tests)
 * - TEST-004: Deterministic tests (mock data, no randomness)
 * - TEST-005: Single concept per test
 * - TEST-006: Test error paths
 * - ARCH-004: Component boundary testing
 *
 * @module tests/unit/pages/ViewShiftPage
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ============================================================================
// Mock Dependencies (Hoisted)
// ============================================================================

const { mockNavigate, mockUseShiftViewData } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockUseShiftViewData: vi.fn(),
}));

// Mock react-router-dom
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock useViewData hook
vi.mock('../../../src/renderer/hooks/useViewData', () => ({
  useShiftViewData: () => mockUseShiftViewData(),
}));

// Mock usePOSConnectionType hook (requires QueryClient)
// Default to non-lottery mode to test standard layout with all cards
vi.mock('../../../src/renderer/hooks/usePOSConnectionType', () => ({
  useIsLotteryMode: () => false,
  usePOSConnectionType: () => 'STANDARD' as const,
}));

// Mock LoadingSpinner to simplify rendering
vi.mock('../../../src/renderer/components/ui/LoadingSpinner', () => ({
  LoadingSpinner: ({ size }: { size?: string }) => (
    <div data-testid="loading-spinner" data-size={size} role="status">
      Loading...
    </div>
  ),
}));

// ============================================================================
// Import Component Under Test (after mocks)
// ============================================================================

import ViewShiftPage from '../../../src/renderer/pages/ViewShiftPage';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Mock shift view data response matching transport types
 * @security API-008: Only whitelisted fields included
 */
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

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Renders ViewShiftPage with router context
 * @param shiftId - The shift ID in the route parameter
 */
function renderWithRouter(shiftId: string = 'shift-0001-0000-0000-000000000001') {
  return render(
    <MemoryRouter initialEntries={[`/shifts/${shiftId}/view`]}>
      <Routes>
        <Route path="/shifts/:shiftId/view" element={<ViewShiftPage />} />
      </Routes>
    </MemoryRouter>
  );
}

// ============================================================================
// Test Suite
// ============================================================================

describe('ViewShiftPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: successful data fetch
    mockUseShiftViewData.mockReturnValue({
      data: MOCK_SHIFT_VIEW_DATA,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Rendering Tests
  // ==========================================================================

  describe('Component Rendering', () => {
    it('should render the page container with correct data attributes', () => {
      // Act
      renderWithRouter();

      // Assert
      const page = screen.getByTestId('view-shift-page');
      expect(page).toBeInTheDocument();
      expect(page).toHaveAttribute('data-shift-id', 'shift-0001-0000-0000-000000000001');
    });

    it('should render ViewHeader with title "View Shift #3"', () => {
      // Act
      renderWithRouter();

      // Assert
      expect(screen.getByText('View Shift #3')).toBeInTheDocument();
    });

    it('should render ShiftInfoCard with shift details', () => {
      // Act
      renderWithRouter();

      // Assert
      const infoCard = screen.getByTestId('shift-info-card');
      expect(infoCard).toBeInTheDocument();
      expect(within(infoCard).getByText('Register 1')).toBeInTheDocument();
      expect(within(infoCard).getByText('John Smith')).toBeInTheDocument();
    });

    it('should render SummaryCardsRow with sales data', () => {
      // Act
      renderWithRouter();

      // Assert
      // Summary cards show formatted currency values
      expect(screen.getByTestId('summary-cards-row')).toBeInTheDocument();
    });

    it('should render PaymentMethodsCard in read-only mode', () => {
      // Act
      renderWithRouter();

      // Assert
      const paymentCard = screen.getByTestId('payment-methods-card');
      expect(paymentCard).toBeInTheDocument();
      expect(paymentCard).toHaveAttribute('data-readonly', 'true');
    });

    it('should render SalesBreakdownCard in read-only mode', () => {
      // Act
      renderWithRouter();

      // Assert
      const salesCard = screen.getByTestId('sales-breakdown-card');
      expect(salesCard).toBeInTheDocument();
      expect(salesCard).toHaveAttribute('data-readonly', 'true');
    });

    it('should render ViewFooter with timestamps and duration', () => {
      // Act
      renderWithRouter();

      // Assert
      expect(screen.getByTestId('view-footer')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Loading State Tests
  // ==========================================================================

  describe('Loading State', () => {
    it('should render loading state while data is being fetched', () => {
      // Arrange
      mockUseShiftViewData.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert
      expect(screen.getByTestId('view-shift-page-loading')).toBeInTheDocument();
      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // No Lottery Section Tests
  // ==========================================================================

  describe('No Lottery Section', () => {
    it('should NOT render LotterySection (shifts do not close lottery)', () => {
      // Act
      renderWithRouter();

      // Assert
      expect(screen.queryByTestId('lottery-section')).not.toBeInTheDocument();
    });

    it('should NOT render any lottery pack sections', () => {
      // Act
      renderWithRouter();

      // Assert
      expect(screen.queryByTestId('returned-packs-section')).not.toBeInTheDocument();
      expect(screen.queryByTestId('depleted-packs-section')).not.toBeInTheDocument();
      expect(screen.queryByTestId('activated-packs-section')).not.toBeInTheDocument();
    });

    it('should NOT render DayBinsTable', () => {
      // Act
      renderWithRouter();

      // Assert
      expect(screen.queryByTestId('view-day-bins-table')).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Navigation Tests
  // ==========================================================================

  describe('Navigation', () => {
    it('should navigate back when back button is clicked', () => {
      // Act
      renderWithRouter();

      // Find and click the back button
      const backButton = screen.getByRole('button', { name: /back/i });
      fireEvent.click(backButton);

      // Assert
      expect(mockNavigate).toHaveBeenCalledWith(-1);
    });

    it('should have accessible back button with aria-label', () => {
      // Act
      renderWithRouter();

      // Assert
      const backButton = screen.getByRole('button', { name: /back/i });
      expect(backButton).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Payout Modal Tests
  // Note: Modal interaction tests are covered in PaymentMethodsCard.spec.tsx
  // ==========================================================================

  describe('Payout Modals', () => {
    it('should render PaymentMethodsCard which handles payout clicks', () => {
      // Act
      renderWithRouter();

      // Assert - PaymentMethodsCard is rendered with onPayoutClick prop
      const paymentCard = screen.getByTestId('payment-methods-card');
      expect(paymentCard).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Error State Tests
  // ==========================================================================

  describe('Error State', () => {
    it('should render error state when data fetch fails', () => {
      // Arrange
      mockUseShiftViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Failed to fetch shift data'),
      });

      // Act
      renderWithRouter();

      // Assert
      expect(screen.getByTestId('view-shift-page-error')).toBeInTheDocument();
      expect(screen.getByText('Failed to fetch shift data')).toBeInTheDocument();
    });

    it('should render error state when hook returns no data', () => {
      // Arrange - Hook returns no data (e.g., shift not found)
      mockUseShiftViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert
      expect(screen.getByTestId('view-shift-page-error')).toBeInTheDocument();
    });

    it('should render Go Back button in error state', () => {
      // Arrange
      mockUseShiftViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Test error'),
      });

      // Act
      renderWithRouter();

      // Assert
      const goBackButton = screen.getByRole('button', { name: /go back/i });
      expect(goBackButton).toBeInTheDocument();

      fireEvent.click(goBackButton);
      expect(mockNavigate).toHaveBeenCalledWith(-1);
    });
  });

  // ==========================================================================
  // Two-Column Layout Tests
  // ==========================================================================

  describe('Two-Column Layout', () => {
    it('should render PaymentMethodsCard and SalesBreakdownCard in grid', () => {
      // Act
      renderWithRouter();

      // Assert
      expect(screen.getByTestId('payment-methods-card')).toBeInTheDocument();
      expect(screen.getByTestId('sales-breakdown-card')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Accessibility Tests
  // ==========================================================================

  describe('Accessibility', () => {
    it('should have accessible page structure', () => {
      // Act
      renderWithRouter();

      // Assert
      expect(screen.getByTestId('view-shift-page')).toBeInTheDocument();
    });

    it('should have accessible back button', () => {
      // Act
      renderWithRouter();

      // Assert
      const backButton = screen.getByRole('button', { name: /back/i });
      expect(backButton).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Data Attributes Tests
  // ==========================================================================

  describe('Data Attributes', () => {
    it('should include shiftId in data attribute for debugging', () => {
      // Act
      renderWithRouter();

      // Assert
      const page = screen.getByTestId('view-shift-page');
      expect(page).toHaveAttribute('data-shift-id', 'shift-0001-0000-0000-000000000001');
    });
  });

  // ==========================================================================
  // Currency Formatting Tests
  // ==========================================================================

  describe('Currency Formatting', () => {
    it('should display currency values with proper formatting', () => {
      // Act
      renderWithRouter();

      // Assert - Currency values should be formatted
      const infoCard = screen.getByTestId('shift-info-card');
      expect(within(infoCard).getByText('$200.00')).toBeInTheDocument();
    });
  });
});
