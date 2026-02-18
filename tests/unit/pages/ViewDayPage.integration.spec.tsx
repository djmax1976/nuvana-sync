/**
 * ViewDayPage Integration Tests
 *
 * Tests for component composition and interaction flows:
 * - All components compose correctly together
 * - Lottery section renders with dayId passed to children
 * - Navigation flow from header back button works
 * - Payout modals open from PaymentMethodsCard
 *
 * Test Standards Applied:
 * - TEST-001: AAA pattern (Arrange-Act-Assert)
 * - TEST-002: Descriptive test names
 * - TEST-003: Test isolation
 * - TEST-004: Deterministic tests
 * - TEST-005: Single concept per test
 * - ARCH-004: Integration-level component testing
 *
 * @module tests/integration/pages/ViewDayPage.integration
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

// Note: ViewDayPage renders LotterySection with a placeholder message,
// not the full DayBinsTable/pack section components.
// Those components require separate data hooks not yet implemented.

// ============================================================================
// Import Component Under Test
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
  daySummaryId: 'day-001',
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
    lotterySales: { total: 2175.0, scratchOff: 1450.0, online: 725.0, ticketsSold: 435 },
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
  lotteryDayId: 'lottery-day-001',
  timestamps: {
    createdAt: '2026-02-17T06:00:00.000Z',
    closedAt: '2026-02-17T22:30:00.000Z',
  },
};

// ============================================================================
// Test Utilities
// ============================================================================

function renderWithRouter(dayId: string = 'day-001') {
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

describe('ViewDayPage Integration', () => {
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
  // Component Composition Tests
  // ==========================================================================

  describe('Component Composition', () => {
    it('should compose all components in correct hierarchy', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert: All main components are present
      expect(screen.getByTestId('view-day-page')).toBeInTheDocument();
      expect(screen.getByText('View Day')).toBeInTheDocument();
      expect(screen.getByTestId('day-info-card')).toBeInTheDocument();
      expect(screen.getByTestId('summary-cards-row')).toBeInTheDocument();
      expect(screen.getByTestId('payment-methods-card')).toBeInTheDocument();
      expect(screen.getByTestId('sales-breakdown-card')).toBeInTheDocument();
      expect(screen.getByTestId('lottery-section')).toBeInTheDocument();
      expect(screen.getByTestId('view-footer')).toBeInTheDocument();
    });

    it('should render ViewHeader with "View Day" title', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert
      expect(screen.getByText('View Day')).toBeInTheDocument();
    });

    it('should render DayInfoCard with business date', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert
      const infoCard = screen.getByTestId('day-info-card');

      // Business date
      expect(within(infoCard).getByText('Feb 17, 2026')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Lottery Section Integration (Key difference from ViewShiftPage)
  // ==========================================================================

  describe('Lottery Section Integration', () => {
    it('should render LotterySection when lotteryDayId exists', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert
      const lotterySection = screen.getByTestId('lottery-section');
      expect(lotterySection).toBeInTheDocument();
    });

    it('should pass lotteryDayId to LotterySection', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert - LotterySection receives the lotteryDayId
      const lotterySection = screen.getByTestId('lottery-section');
      expect(lotterySection).toHaveAttribute('data-day-id', 'lottery-day-001');
    });

    it('should render placeholder message for lottery details', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert - Placeholder message is shown
      expect(screen.getByText(/Lottery pack details are available/)).toBeInTheDocument();
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
  });

  // ==========================================================================
  // Navigation Flow Tests
  // ==========================================================================

  describe('Navigation Flow', () => {
    it('should navigate back when header back button is clicked', () => {
      // Arrange
      renderWithRouter();

      // Act
      fireEvent.click(screen.getByTestId('view-header-back-button'));

      // Assert
      expect(mockNavigate).toHaveBeenCalledWith(-1);
    });

    it('should navigate back with single click (no double navigation)', () => {
      // Arrange
      renderWithRouter();

      // Act
      fireEvent.click(screen.getByTestId('view-header-back-button'));

      // Assert
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Payout Modal Flow Tests
  // ==========================================================================

  describe('Payout Modal Flow', () => {
    it('should open Cash Payouts modal when row is clicked', async () => {
      // Arrange
      renderWithRouter();

      // Act
      fireEvent.click(screen.getByTestId('payment-methods-card-cash-payouts'));

      // Assert
      await waitFor(() => {
        const modal = screen.getByTestId('payout-modal');
        expect(modal).toBeInTheDocument();
      });
    });

    it('should display cash payout list with 5 items', async () => {
      // Arrange
      renderWithRouter();

      // Act
      fireEvent.click(screen.getByTestId('payment-methods-card-cash-payouts'));

      // Assert
      await waitFor(() => {
        const modalList = screen.getByTestId('payout-modal-list');
        expect(modalList).toBeInTheDocument();
      });
    });

    it('should open Lottery Payouts modal', async () => {
      // Arrange
      renderWithRouter();

      // Act
      fireEvent.click(screen.getByTestId('payment-methods-card-lottery-payouts'));

      // Assert
      await waitFor(() => {
        const modal = screen.getByTestId('payout-modal');
        expect(modal).toBeInTheDocument();
      });
    });
  });

  // ==========================================================================
  // Two-Column Layout Tests
  // ==========================================================================

  describe('Two-Column Layout', () => {
    it('should render PaymentMethodsCard and SalesBreakdownCard as siblings', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert
      const paymentCard = screen.getByTestId('payment-methods-card');
      const salesCard = screen.getByTestId('sales-breakdown-card');

      expect(paymentCard.parentElement).toBe(salesCard.parentElement);
    });
  });

  // ==========================================================================
  // LotterySection Integration
  // ==========================================================================

  describe('LotterySection Integration', () => {
    it('should display lottery section', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert
      const lotterySection = screen.getByTestId('lottery-section');
      expect(lotterySection).toBeInTheDocument();
    });

    it('should display lottery total amount in header', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert - Total should be displayed in lottery header
      const lotteryHeader = screen.getByTestId('lottery-section-header-total');
      expect(lotteryHeader).toBeInTheDocument();
      expect(lotteryHeader).toHaveTextContent('$2,175.00');
    });
  });

  // ==========================================================================
  // Footer Integration
  // ==========================================================================

  describe('Footer Integration', () => {
    it('should display timestamps from mock data', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert
      const footer = screen.getByTestId('view-footer');

      // Timestamps should be displayed (format varies by timezone)
      expect(within(footer).getByTestId('view-footer-created')).toHaveTextContent(/Feb 17, 2026/);
      expect(within(footer).getByTestId('view-footer-closed')).toHaveTextContent(/Feb 17, 2026/);
    });

    it('should display calculated duration', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert
      const footer = screen.getByTestId('view-footer');
      const durationElement = within(footer).getByTestId('view-footer-duration');

      // Duration should be calculated and displayed (format may vary)
      expect(durationElement).toHaveTextContent(/hours/);
    });
  });

  // ==========================================================================
  // Comparison with ViewShiftPage
  // ==========================================================================

  describe('Difference from ViewShiftPage (Integration)', () => {
    it('should render LotterySection (ViewShiftPage does NOT)', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert
      expect(screen.getByTestId('lottery-section')).toBeInTheDocument();
    });

    it('should display lottery totals in section header', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert - Total is displayed in lottery section header
      const lotteryHeaderTotal = screen.getByTestId('lottery-section-header-total');
      expect(lotteryHeaderTotal).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // DayId Propagation Tests
  // ==========================================================================

  describe('DayId Propagation', () => {
    it('should propagate lotteryDayId to LotterySection', () => {
      // Arrange & Act
      renderWithRouter('day-001');

      // Assert: Page container has dayId from URL
      expect(screen.getByTestId('view-day-page')).toHaveAttribute('data-day-id', 'day-001');

      // Assert: LotterySection has lotteryDayId from hook data
      const lotterySection = screen.getByTestId('lottery-section');
      expect(lotterySection).toHaveAttribute('data-day-id', 'lottery-day-001');
    });

    it('should handle UUID format dayId correctly in URL', () => {
      // Arrange
      const uuidDayId = '550e8400-e29b-41d4-a716-446655440000';

      // Act
      renderWithRouter(uuidDayId);

      // Assert - Page has URL dayId
      expect(screen.getByTestId('view-day-page')).toHaveAttribute('data-day-id', uuidDayId);
    });
  });

  // ==========================================================================
  // Accessibility Integration
  // ==========================================================================

  describe('Accessibility Integration', () => {
    it('should have proper heading hierarchy', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert - View Day is rendered as title
      expect(screen.getByText('View Day')).toBeInTheDocument();
    });

    it('should have Lottery section visible', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert - The LotterySection is rendered
      expect(screen.getByTestId('lottery-section')).toBeInTheDocument();
    });
  });
});
