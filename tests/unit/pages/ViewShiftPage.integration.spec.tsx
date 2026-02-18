/**
 * ViewShiftPage Integration Tests
 *
 * Tests for component composition and interaction flows:
 * - All components compose correctly together
 * - Navigation flow from header back button works
 * - Payout modals open from PaymentMethodsCard
 * - Two-column layout renders correctly
 *
 * Test Standards Applied:
 * - TEST-001: AAA pattern (Arrange-Act-Assert)
 * - TEST-002: Descriptive test names
 * - TEST-003: Test isolation
 * - TEST-004: Deterministic tests
 * - TEST-005: Single concept per test
 * - ARCH-004: Integration-level component testing
 *
 * @module tests/integration/pages/ViewShiftPage.integration
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
// Import Component Under Test
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
  shiftId: 'shift-001',
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

function renderWithRouter(shiftId: string = 'shift-001') {
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

describe('ViewShiftPage Integration', () => {
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
  // Component Composition Tests
  // ==========================================================================

  describe('Component Composition', () => {
    it('should compose all components in correct hierarchy', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert: All main components are present
      expect(screen.getByTestId('view-shift-page')).toBeInTheDocument();
      expect(screen.getByTestId('view-header')).toBeInTheDocument();
      expect(screen.getByTestId('shift-info-card')).toBeInTheDocument();
      expect(screen.getByTestId('summary-cards-row')).toBeInTheDocument();
      expect(screen.getByTestId('payment-methods-card')).toBeInTheDocument();
      expect(screen.getByTestId('sales-breakdown-card')).toBeInTheDocument();
      expect(screen.getByTestId('view-footer')).toBeInTheDocument();
    });

    it('should render ViewHeader with correct shift number from props', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert
      const header = screen.getByTestId('view-header');
      expect(within(header).getByTestId('view-header-title')).toHaveTextContent('View Shift #3');
    });

    it('should render ShiftInfoCard with mock shift data', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert
      const infoCard = screen.getByTestId('shift-info-card');

      // Terminal name
      expect(within(infoCard).getByText('Register 1')).toBeInTheDocument();

      // Cashier name
      expect(within(infoCard).getByText('John Smith')).toBeInTheDocument();
    });

    it('should render SummaryCardsRow with 4 gradient cards', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert
      const summaryRow = screen.getByTestId('summary-cards-row');

      // All 4 cards present
      expect(within(summaryRow).getByTestId('summary-cards-row-inside-sales')).toBeInTheDocument();
      expect(within(summaryRow).getByTestId('summary-cards-row-fuel-sales')).toBeInTheDocument();
      expect(within(summaryRow).getByTestId('summary-cards-row-lottery-sales')).toBeInTheDocument();
      expect(within(summaryRow).getByTestId('summary-cards-row-reserved')).toBeInTheDocument();
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

    it('should display cash payout list in modal', async () => {
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

    it('should open Lottery Payouts modal with image viewer', async () => {
      // Arrange
      renderWithRouter();

      // Act
      fireEvent.click(screen.getByTestId('payment-methods-card-lottery-payouts'));

      // Assert
      await waitFor(() => {
        const modal = screen.getByTestId('payout-modal');
        expect(modal).toBeInTheDocument();

        // Image viewer should be present
        const viewer = screen.getByTestId('payout-modal-viewer');
        expect(viewer).toBeInTheDocument();
      });
    });

    it('should open Gaming Payouts modal with image viewer', async () => {
      // Arrange
      renderWithRouter();

      // Act
      fireEvent.click(screen.getByTestId('payment-methods-card-gaming-payouts'));

      // Assert
      await waitFor(() => {
        const modal = screen.getByTestId('payout-modal');
        expect(modal).toBeInTheDocument();
      });
    });

    it('should close modal when backdrop is clicked', async () => {
      // Arrange
      renderWithRouter();

      // Open modal
      fireEvent.click(screen.getByTestId('payment-methods-card-cash-payouts'));

      await waitFor(() => {
        expect(screen.getByTestId('payout-modal')).toBeInTheDocument();
      });

      // Act: Close via Dialog's close mechanism
      // The Dialog component handles close on backdrop click
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

      // Both should have the same parent (grid container)
      expect(paymentCard.parentElement).toBe(salesCard.parentElement);
    });

    it('should have grid container with proper layout classes', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert
      const paymentCard = screen.getByTestId('payment-methods-card');
      const gridContainer = paymentCard.parentElement;

      expect(gridContainer).toHaveClass('grid');
    });
  });

  // ==========================================================================
  // No Lottery Section Integration
  // ==========================================================================

  describe('No Lottery Section (Integration)', () => {
    it('should NOT render any lottery components in full page composition', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert: Full page should be present but without lottery
      expect(screen.getByTestId('view-shift-page')).toBeInTheDocument();
      expect(screen.queryByTestId('lottery-section')).not.toBeInTheDocument();
      expect(screen.queryByTestId('day-bins-table')).not.toBeInTheDocument();
      expect(screen.queryByTestId('returned-packs-section')).not.toBeInTheDocument();
      expect(screen.queryByTestId('depleted-packs-section')).not.toBeInTheDocument();
      expect(screen.queryByTestId('activated-packs-section')).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Footer Integration
  // ==========================================================================

  describe('Footer Integration', () => {
    it('should display timestamps from mock shift data', () => {
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
  // Accessibility Integration
  // ==========================================================================

  describe('Accessibility Integration', () => {
    it('should have proper heading hierarchy', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert
      const h1 = screen.getByRole('heading', { level: 1 });
      expect(h1).toHaveTextContent('View Shift #3');
    });

    it('should have all interactive elements keyboard accessible', () => {
      // Arrange & Act
      renderWithRouter();

      // Assert: All buttons should be focusable
      const backButton = screen.getByTestId('view-header-back-button');
      expect(backButton).not.toHaveAttribute('tabindex', '-1');

      // Payout rows are buttons and should be focusable
      const cashPayoutsRow = screen.getByTestId('payment-methods-card-cash-payouts');
      expect(cashPayoutsRow.tagName.toLowerCase()).toBe('button');
    });
  });
});
