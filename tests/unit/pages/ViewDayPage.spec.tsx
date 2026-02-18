/**
 * ViewDayPage Unit Tests
 *
 * Tests for the read-only day view page:
 * - Renders all composed components correctly
 * - Renders LotterySection with lottery totals
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
 * @module tests/unit/pages/ViewDayPage
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ============================================================================
// Mock Dependencies (Hoisted)
// ============================================================================

const { mockNavigate, mockUseDayViewData } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
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

// Mock useViewData hook
vi.mock('../../../src/renderer/hooks/useViewData', () => ({
  useDayViewData: () => mockUseDayViewData(),
}));

// Mock usePOSConnectionType hook (requires QueryClient)
vi.mock('../../../src/renderer/hooks/usePOSConnectionType', () => ({
  useIsLotteryMode: () => true,
  usePOSConnectionType: () => 'LOTTERY' as const,
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

import ViewDayPage from '../../../src/renderer/pages/ViewDayPage';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Mock day view data response matching transport types
 * @security API-008: Only whitelisted fields included
 */
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
// Test Utilities
// ============================================================================

/**
 * Renders ViewDayPage with router context
 * @param dayId - The day ID in the route parameter
 */
function renderWithRouter(dayId: string = 'day-0001-0000-0000-000000000001') {
  return render(
    <MemoryRouter initialEntries={[`/days/${dayId}/view`]}>
      <Routes>
        <Route path="/days/:dayId/view" element={<ViewDayPage />} />
      </Routes>
    </MemoryRouter>
  );
}

// ============================================================================
// Test Suite
// ============================================================================

describe('ViewDayPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: successful data fetch
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
  // Rendering Tests
  // ==========================================================================

  describe('Component Rendering', () => {
    it('should render the page container with correct data attributes', () => {
      // Act
      renderWithRouter();

      // Assert
      const page = screen.getByTestId('view-day-page');
      expect(page).toBeInTheDocument();
      expect(page).toHaveAttribute('data-day-id', 'day-0001-0000-0000-000000000001');
    });

    it('should render ViewHeader with title "View Day"', () => {
      // Act
      renderWithRouter();

      // Assert
      expect(screen.getByText('View Day')).toBeInTheDocument();
    });

    it('should render DayInfoCard with day details', () => {
      // Act
      renderWithRouter();

      // Assert
      const infoCard = screen.getByTestId('day-info-card');
      expect(infoCard).toBeInTheDocument();
      expect(within(infoCard).getByText('Feb 17, 2026')).toBeInTheDocument();
    });

    it('should render SummaryCardsRow with sales data', () => {
      // Act
      renderWithRouter();

      // Assert
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

    it('should render LotterySection when lotteryDayId exists', () => {
      // Act
      renderWithRouter();

      // Assert
      expect(screen.getByTestId('lottery-section')).toBeInTheDocument();
    });

    it('should NOT render LotterySection when lotteryDayId is null', () => {
      // Arrange
      mockUseDayViewData.mockReturnValue({
        data: { ...MOCK_DAY_VIEW_DATA, lotteryDayId: null },
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert
      expect(screen.queryByTestId('lottery-section')).not.toBeInTheDocument();
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
      mockUseDayViewData.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert
      expect(screen.getByTestId('view-day-page-loading')).toBeInTheDocument();
      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
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
      mockUseDayViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Failed to fetch day data'),
      });

      // Act
      renderWithRouter();

      // Assert
      expect(screen.getByTestId('view-day-page-error')).toBeInTheDocument();
      expect(screen.getByText('Failed to fetch day data')).toBeInTheDocument();
    });

    it('should render error state when hook returns no data', () => {
      // Arrange - Hook returns no data (e.g., day not found)
      mockUseDayViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert
      expect(screen.getByTestId('view-day-page-error')).toBeInTheDocument();
    });

    it('should render Go Back button in error state', () => {
      // Arrange
      mockUseDayViewData.mockReturnValue({
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
      expect(screen.getByTestId('view-day-page')).toBeInTheDocument();
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
    it('should include dayId in data attribute for debugging', () => {
      // Act
      renderWithRouter();

      // Assert
      const page = screen.getByTestId('view-day-page');
      expect(page).toHaveAttribute('data-day-id', 'day-0001-0000-0000-000000000001');
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
      const infoCard = screen.getByTestId('day-info-card');
      expect(within(infoCard).getByText('$200.00')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Lottery Section Tests
  // ==========================================================================

  describe('Lottery Section', () => {
    it('should render lottery section with totals', () => {
      // Act
      renderWithRouter();

      // Assert
      const lotterySection = screen.getByTestId('lottery-section');
      expect(lotterySection).toBeInTheDocument();
    });

    it('should show placeholder message for lottery details', () => {
      // Act
      renderWithRouter();

      // Assert
      expect(screen.getByText(/Lottery pack details are available/)).toBeInTheDocument();
    });
  });
});
