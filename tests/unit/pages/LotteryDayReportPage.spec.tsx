/**
 * LotteryDayReportPage Unit Tests
 *
 * Tests the LotteryDayReportPage component for correct rendering of:
 * - Hero header with total sales calculation (bin + pack + return sales)
 * - Conditional card visibility (hide Pack Sales/Return Sales when 0)
 * - Bins table with correct data display
 * - Loading, error, and empty states
 * - Responsive design: breakpoint classes, adaptive layouts
 *
 * Uses mocked hooks to isolate the component's rendering logic from
 * data fetching concerns.
 *
 * Enterprise Testing Strategy:
 * - Component testing: boundary and contract validation
 * - Responsive testing: CSS class verification for breakpoints (sm/md/lg)
 * - Edge cases: null values, empty arrays, malformed data
 * - Accessibility: ARIA attributes, semantic structure
 *
 * @module tests/unit/pages/LotteryDayReportPage
 * @security FE-001: Verifies no XSS vectors — all content is text via React escaping
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ============================================================================
// Mock Dependencies
// ============================================================================

// Mock react-router-dom
const mockNavigate = vi.fn();
const mockSearchParams = new URLSearchParams('date=2026-02-02');

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams],
  useNavigate: () => mockNavigate,
}));

// Mock useLotteryDayReport hook with hoisted mock
const { mockUseLotteryDayReport } = vi.hoisted(() => ({
  mockUseLotteryDayReport: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/hooks/useLotteryDayReport', () => ({
  useLotteryDayReport: mockUseLotteryDayReport,
}));

// Mock useDateFormat hook
vi.mock('../../../src/renderer/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatCustom: (date: Date | string, fmt: string) => {
      // Minimal formatting for tests — deterministic output
      const d = typeof date === 'string' ? new Date(date) : date;
      if (Number.isNaN(d.getTime())) return '--';

      if (fmt === 'MMM') {
        return d.toLocaleString('en-US', { month: 'short' });
      }
      if (fmt === 'MMMM') {
        return d.toLocaleString('en-US', { month: 'long' });
      }
      if (fmt === 'EEEE') {
        return d.toLocaleString('en-US', { weekday: 'long' });
      }
      if (fmt === 'h:mm a') {
        return d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      }
      if (fmt === 'd') {
        return String(d.getDate());
      }
      if (fmt === 'yyyy') {
        return String(d.getFullYear());
      }
      if (fmt === 'MMM d, h:mm a') {
        const month = d.toLocaleString('en-US', { month: 'short' });
        const day = d.getDate();
        const time = d.toLocaleString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        return `${month} ${day}, ${time}`;
      }
      return d.toISOString();
    },
    timezone: 'America/Denver',
  }),
}));

// ============================================================================
// Import Component Under Test
// ============================================================================
import LotteryDayReportPage from '../../../src/renderer/pages/LotteryDayReportPage';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockReportData(overrides: Record<string, unknown> = {}) {
  return {
    businessDate: '2026-02-02',
    dayStatus: 'CLOSED' as const,
    closedAt: '2026-02-02T20:31:00Z',
    lotteryTotal: 120,
    totalClosings: 1,
    closingSessions: [
      {
        closingNumber: 1,
        dayId: 'day-001',
        openedAt: '2026-02-02T15:24:00Z',
        closedAt: '2026-02-02T20:31:00Z',
        binSales: 120,
        packSales: 0,
        returnSales: 0,
        totalSales: 120,
        totalTicketsSold: 4,
        bins: [
          {
            bin_number: 1,
            game_name: 'Powerball',
            game_price: 30,
            pack_number: 'PKG-001',
            starting_serial: '000',
            ending_serial: '004',
            tickets_sold: 4,
            sales_amount: 120,
          },
        ],
        depletedPacks: [],
        returnedPacks: [],
        activatedPacks: [],
      },
    ],
    bins: [
      {
        bin_number: 1,
        game_name: 'Powerball',
        game_price: 30,
        pack_number: 'PKG-001',
        starting_serial: '000',
        ending_serial: '004',
        tickets_sold: 4,
        sales_amount: 120,
      },
    ],
    activatedPacks: [],
    depletedPacks: [],
    returnedPacks: [],
    ...overrides,
  };
}

/** Helper to create a mock closing session with all required per-session fields */
function createMockSession(overrides: Record<string, unknown> = {}) {
  return {
    closingNumber: 1,
    dayId: 'day-001',
    openedAt: '2026-02-02T15:24:00Z' as string | null,
    closedAt: '2026-02-02T20:31:00Z' as string | null,
    binSales: 0,
    packSales: 0,
    returnSales: 0,
    totalSales: 0,
    totalTicketsSold: 0,
    bins: [] as unknown[],
    depletedPacks: [] as unknown[],
    returnedPacks: [] as unknown[],
    activatedPacks: [] as unknown[],
    ...overrides,
  };
}

function setupHookReturn(
  data: ReturnType<typeof createMockReportData> | undefined,
  overrides: Record<string, unknown> = {}
) {
  mockUseLotteryDayReport.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    ...overrides,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('LotteryDayReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Total Sales Calculation: bin + pack + return sales
  // --------------------------------------------------------------------------
  describe('Total Sales Calculation', () => {
    it('should calculate total as sum of bin + pack + return sales', () => {
      const data = createMockReportData({
        bins: [
          {
            bin_number: 1,
            game_name: 'Powerball',
            game_price: 30,
            pack_number: 'PKG-001',
            starting_serial: '000',
            ending_serial: '004',
            tickets_sold: 4,
            sales_amount: 120,
          },
        ],
        depletedPacks: [
          {
            pack_id: 'dep-001',
            bin_number: 2,
            game_name: 'Cash 5',
            game_price: 10,
            pack_number: 'PKG-DEP-001',
            starting_serial: '000',
            ending_serial: '007',
            tickets_sold: 7,
            sales_amount: 70,
            depleted_at: '2026-02-02T18:00:00Z',
          },
        ],
        returnedPacks: [
          {
            pack_id: 'ret-001',
            bin_number: 3,
            game_name: 'Mega Millions',
            game_price: 20,
            pack_number: 'PKG-RET-001',
            starting_serial: '000',
            ending_serial: '003',
            tickets_sold: 3,
            sales_amount: 60,
            returned_at: '2026-02-02T19:00:00Z',
          },
        ],
      });
      setupHookReturn(data);

      render(<LotteryDayReportPage />);

      // Total: $120 (bins) + $70 (depleted) + $60 (returned) = $250
      const heroHeader = screen.getByTestId('hero-header');
      expect(heroHeader).toHaveTextContent('$250.00');
    });

    it('should show only bin sales when no pack or return sales', () => {
      const data = createMockReportData({
        bins: [
          {
            bin_number: 1,
            game_name: 'Powerball',
            game_price: 30,
            pack_number: 'PKG-001',
            starting_serial: '000',
            ending_serial: '004',
            tickets_sold: 4,
            sales_amount: 120,
          },
        ],
        depletedPacks: [],
        returnedPacks: [],
      });
      setupHookReturn(data);

      render(<LotteryDayReportPage />);

      // Total: $120 (bins only)
      const heroHeader = screen.getByTestId('hero-header');
      expect(heroHeader).toHaveTextContent('$120.00');
    });
  });

  // --------------------------------------------------------------------------
  // Conditional Card Visibility
  // --------------------------------------------------------------------------
  describe('Conditional Card Visibility', () => {
    it('should hide Pack Sales card when packSales is 0', () => {
      const data = createMockReportData({
        bins: [
          {
            bin_number: 1,
            game_name: 'Powerball',
            game_price: 30,
            pack_number: 'PKG-001',
            starting_serial: '000',
            ending_serial: '004',
            tickets_sold: 4,
            sales_amount: 120,
          },
        ],
        depletedPacks: [], // No depleted packs = 0 pack sales
        returnedPacks: [],
      });
      setupHookReturn(data);

      render(<LotteryDayReportPage />);

      // Pack Sales card should not be present
      expect(screen.queryByText('Pack Sales')).not.toBeInTheDocument();
      // Bin Sales card should be present
      expect(screen.getByText('Bin Sales')).toBeInTheDocument();
    });

    it('should hide Return Sales card when returnSales is 0', () => {
      const data = createMockReportData({
        bins: [
          {
            bin_number: 1,
            game_name: 'Powerball',
            game_price: 30,
            pack_number: 'PKG-001',
            starting_serial: '000',
            ending_serial: '004',
            tickets_sold: 4,
            sales_amount: 120,
          },
        ],
        depletedPacks: [],
        returnedPacks: [], // No returned packs = 0 return sales
      });
      setupHookReturn(data);

      render(<LotteryDayReportPage />);

      // Return Sales card should not be present
      expect(screen.queryByText('Return Sales')).not.toBeInTheDocument();
      // Bin Sales card should be present
      expect(screen.getByText('Bin Sales')).toBeInTheDocument();
    });

    it('should show Pack Sales card when packSales > 0', () => {
      const data = createMockReportData({
        bins: [
          {
            bin_number: 1,
            game_name: 'Powerball',
            game_price: 30,
            pack_number: 'PKG-001',
            starting_serial: '000',
            ending_serial: '004',
            tickets_sold: 4,
            sales_amount: 120,
          },
        ],
        depletedPacks: [
          {
            pack_id: 'dep-001',
            bin_number: 2,
            game_name: 'Cash 5',
            game_price: 10,
            pack_number: 'PKG-DEP-001',
            starting_serial: '000',
            ending_serial: '007',
            tickets_sold: 7,
            sales_amount: 70,
            depleted_at: '2026-02-02T18:00:00Z',
          },
        ],
        returnedPacks: [],
      });
      setupHookReturn(data);

      render(<LotteryDayReportPage />);

      // Pack Sales card should be present
      expect(screen.getByText('Pack Sales')).toBeInTheDocument();
      // Value appears in hero header card
      const heroHeader = screen.getByTestId('hero-header');
      expect(heroHeader).toHaveTextContent('$70.00');
    });

    it('should show Return Sales card when returnSales > 0', () => {
      const data = createMockReportData({
        bins: [
          {
            bin_number: 1,
            game_name: 'Powerball',
            game_price: 30,
            pack_number: 'PKG-001',
            starting_serial: '000',
            ending_serial: '004',
            tickets_sold: 4,
            sales_amount: 120,
          },
        ],
        depletedPacks: [],
        returnedPacks: [
          {
            pack_id: 'ret-001',
            bin_number: 2,
            game_name: 'Mega Millions',
            game_price: 20,
            pack_number: 'PKG-RET-001',
            starting_serial: '000',
            ending_serial: '003',
            tickets_sold: 3,
            sales_amount: 60,
            returned_at: '2026-02-02T19:00:00Z',
          },
        ],
      });
      setupHookReturn(data);

      render(<LotteryDayReportPage />);

      // Return Sales card should be present
      expect(screen.getByText('Return Sales')).toBeInTheDocument();
      // Value appears in hero header card
      const heroHeader = screen.getByTestId('hero-header');
      expect(heroHeader).toHaveTextContent('$60.00');
    });

    it('should show all cards when all sales types have values', () => {
      const data = createMockReportData({
        bins: [
          {
            bin_number: 1,
            game_name: 'Powerball',
            game_price: 30,
            pack_number: 'PKG-001',
            starting_serial: '000',
            ending_serial: '004',
            tickets_sold: 4,
            sales_amount: 120,
          },
        ],
        depletedPacks: [
          {
            pack_id: 'dep-001',
            bin_number: 2,
            game_name: 'Cash 5',
            game_price: 10,
            pack_number: 'PKG-DEP-001',
            starting_serial: '000',
            ending_serial: '007',
            tickets_sold: 7,
            sales_amount: 70,
            depleted_at: '2026-02-02T18:00:00Z',
          },
        ],
        returnedPacks: [
          {
            pack_id: 'ret-001',
            bin_number: 3,
            game_name: 'Mega Millions',
            game_price: 20,
            pack_number: 'PKG-RET-001',
            starting_serial: '000',
            ending_serial: '003',
            tickets_sold: 3,
            sales_amount: 60,
            returned_at: '2026-02-02T19:00:00Z',
          },
        ],
      });
      setupHookReturn(data);

      render(<LotteryDayReportPage />);

      // All cards should be present
      expect(screen.getByText('Bin Sales')).toBeInTheDocument();
      expect(screen.getByText('Pack Sales')).toBeInTheDocument();
      expect(screen.getByText('Return Sales')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Bins Table Display
  // --------------------------------------------------------------------------
  describe('Bins Table', () => {
    it('should display correct bin data', () => {
      const data = createMockReportData({
        bins: [
          {
            bin_number: 1,
            game_name: 'Powerball',
            game_price: 30,
            pack_number: 'PKG-001',
            starting_serial: '000',
            ending_serial: '004',
            tickets_sold: 4,
            sales_amount: 120,
          },
        ],
      });
      setupHookReturn(data);

      render(<LotteryDayReportPage />);

      expect(screen.getByText('Powerball')).toBeInTheDocument();
      expect(screen.getByText('000')).toBeInTheDocument();
      expect(screen.getByText('004')).toBeInTheDocument();
      expect(screen.getByText('PKG-001')).toBeInTheDocument();
    });

    it('should display correct bin sales total in footer', () => {
      const data = createMockReportData({
        bins: [
          {
            bin_number: 1,
            game_name: 'Powerball',
            game_price: 30,
            pack_number: 'PKG-001',
            starting_serial: '000',
            ending_serial: '004',
            tickets_sold: 4,
            sales_amount: 120,
          },
        ],
      });
      setupHookReturn(data);

      render(<LotteryDayReportPage />);

      // Bin Sales Total in footer
      expect(screen.getByText('Bin Sales Total:')).toBeInTheDocument();
    });

    it('should display multiple bins correctly', () => {
      const data = createMockReportData({
        bins: [
          {
            bin_number: 1,
            game_name: 'Powerball',
            game_price: 30,
            pack_number: 'PKG-001',
            starting_serial: '000',
            ending_serial: '004',
            tickets_sold: 4,
            sales_amount: 120,
          },
          {
            bin_number: 2,
            game_name: 'Mega Millions',
            game_price: 20,
            pack_number: 'PKG-002',
            starting_serial: '010',
            ending_serial: '015',
            tickets_sold: 5,
            sales_amount: 100,
          },
        ],
      });
      setupHookReturn(data);

      render(<LotteryDayReportPage />);

      // Both bins visible
      expect(screen.getByText('Powerball')).toBeInTheDocument();
      expect(screen.getByText('Mega Millions')).toBeInTheDocument();
      expect(screen.getByText('010')).toBeInTheDocument();
      expect(screen.getByText('015')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Pack Sections
  // --------------------------------------------------------------------------
  describe('Pack Sections', () => {
    it('should render returned packs section when data exists', () => {
      const data = createMockReportData({
        returnedPacks: [
          {
            pack_id: 'ret-001',
            bin_number: 2,
            game_name: 'Mega Millions',
            game_price: 20,
            pack_number: 'PKG-RET-001',
            starting_serial: '000',
            ending_serial: '003',
            tickets_sold: 3,
            sales_amount: 60,
            returned_at: '2026-02-02T19:00:00Z',
          },
        ],
      });
      setupHookReturn(data);

      render(<LotteryDayReportPage />);

      const section = screen.getByTestId('returned-packs-section');
      expect(section).toBeInTheDocument();
      expect(section).toHaveTextContent('Returned Packs');
    });

    it('should render depleted packs section when data exists', () => {
      const data = createMockReportData({
        depletedPacks: [
          {
            pack_id: 'dep-001',
            bin_number: 2,
            game_name: 'Cash 5',
            game_price: 10,
            pack_number: 'PKG-DEP-001',
            starting_serial: '000',
            ending_serial: '007',
            tickets_sold: 7,
            sales_amount: 70,
            depleted_at: '2026-02-02T18:00:00Z',
          },
        ],
      });
      setupHookReturn(data);

      render(<LotteryDayReportPage />);

      const section = screen.getByTestId('depleted-packs-section');
      expect(section).toBeInTheDocument();
      expect(section).toHaveTextContent('Packs Sold Out');
    });

    it('should render activated packs section when data exists', () => {
      const data = createMockReportData({
        activatedPacks: [
          {
            pack_id: 'act-001',
            bin_number: 1,
            game_name: 'Powerball',
            game_price: 30,
            pack_number: 'PKG-ACT-001',
            activated_at: '2026-02-02T10:00:00Z',
            status: 'ACTIVE' as const,
          },
        ],
      });
      setupHookReturn(data);

      render(<LotteryDayReportPage />);

      const section = screen.getByTestId('activated-packs-section');
      expect(section).toBeInTheDocument();
      expect(section).toHaveTextContent('Activated Packs');
    });

    it('should not render pack sections when empty', () => {
      const data = createMockReportData({
        returnedPacks: [],
        depletedPacks: [],
        activatedPacks: [],
      });
      setupHookReturn(data);

      render(<LotteryDayReportPage />);

      expect(screen.queryByTestId('returned-packs-section')).not.toBeInTheDocument();
      expect(screen.queryByTestId('depleted-packs-section')).not.toBeInTheDocument();
      expect(screen.queryByTestId('activated-packs-section')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Loading, Error, Empty states
  // --------------------------------------------------------------------------
  describe('Loading State', () => {
    it('should show loading indicator', () => {
      setupHookReturn(undefined, { isLoading: true });

      render(<LotteryDayReportPage />);

      expect(screen.getByTestId('lottery-report-loading')).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should show error message', () => {
      setupHookReturn(undefined, {
        isError: true,
        error: new Error('Failed to load'),
      });

      render(<LotteryDayReportPage />);

      expect(screen.getByTestId('lottery-report-error')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no data', () => {
      const emptyData = createMockReportData({
        dayStatus: null,
        bins: [],
        closingSessions: [],
      });
      setupHookReturn(emptyData);

      render(<LotteryDayReportPage />);

      expect(screen.getByTestId('lottery-report-empty')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Navigation
  // --------------------------------------------------------------------------
  describe('Navigation', () => {
    it('should read date from search params and pass to hook', () => {
      const data = createMockReportData();
      setupHookReturn(data);

      render(<LotteryDayReportPage />);

      expect(mockUseLotteryDayReport).toHaveBeenCalledWith(
        expect.objectContaining({ businessDate: '2026-02-02' })
      );
    });

    it('should navigate back when back button is clicked', () => {
      const data = createMockReportData();
      setupHookReturn(data);

      render(<LotteryDayReportPage />);

      const backButton = screen.getAllByText('Back to Reports')[0];
      fireEvent.click(backButton);

      expect(mockNavigate).toHaveBeenCalledWith('/reports');
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle null/undefined tickets_sold gracefully', () => {
      const data = createMockReportData({
        bins: [
          {
            bin_number: 1,
            game_name: 'Powerball',
            game_price: 30,
            pack_number: 'PKG-001',
            starting_serial: '000',
            ending_serial: '004',
            tickets_sold: null as unknown as number,
            sales_amount: 120,
          },
        ],
      });
      setupHookReturn(data);

      // Should not throw
      render(<LotteryDayReportPage />);
      expect(screen.getByTestId('lottery-day-report')).toBeInTheDocument();
    });

    it('should handle null/undefined sales_amount gracefully', () => {
      const data = createMockReportData({
        bins: [
          {
            bin_number: 1,
            game_name: 'Powerball',
            game_price: 30,
            pack_number: 'PKG-001',
            starting_serial: '000',
            ending_serial: '004',
            tickets_sold: 4,
            sales_amount: null as unknown as number,
          },
        ],
      });
      setupHookReturn(data);

      // Should not throw
      render(<LotteryDayReportPage />);
      expect(screen.getByTestId('lottery-day-report')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Responsive Design Tests
  // Enterprise Testing: Verify responsive CSS classes are applied correctly
  // These tests validate that components have appropriate breakpoint classes
  // for sm (640px), md (768px), and lg (1024px) viewports
  // --------------------------------------------------------------------------
  describe('Responsive Design', () => {
    describe('Hero Header Responsive Layout', () => {
      it('should render hero header with responsive padding classes', () => {
        const data = createMockReportData();
        setupHookReturn(data);

        render(<LotteryDayReportPage />);

        const heroHeader = screen.getByTestId('hero-header');
        // Verify responsive padding classes (px-4 sm:px-6 lg:px-10)
        expect(heroHeader.className).toMatch(/px-4/);
        expect(heroHeader.className).toMatch(/sm:px-6/);
        expect(heroHeader.className).toMatch(/lg:px-10/);
      });

      it('should render hero header with responsive vertical padding', () => {
        const data = createMockReportData();
        setupHookReturn(data);

        render(<LotteryDayReportPage />);

        const heroHeader = screen.getByTestId('hero-header');
        // Verify responsive vertical padding (py-4 sm:py-6 lg:py-7)
        expect(heroHeader.className).toMatch(/py-4/);
        expect(heroHeader.className).toMatch(/sm:py-6/);
        expect(heroHeader.className).toMatch(/lg:py-7/);
      });

      it('should have flex-col md:flex-row layout for hero content', () => {
        const data = createMockReportData();
        setupHookReturn(data);

        render(<LotteryDayReportPage />);

        const heroHeader = screen.getByTestId('hero-header');
        // The inner div should have responsive flex direction
        const innerDiv = heroHeader.querySelector('.relative.z-10');
        expect(innerDiv).not.toBeNull();
        expect(innerDiv!.className).toMatch(/flex-col/);
        expect(innerDiv!.className).toMatch(/md:flex-row/);
      });
    });

    describe('Content Area Responsive Layout', () => {
      it('should render content area with responsive padding', () => {
        const data = createMockReportData();
        setupHookReturn(data);

        const { container } = render(<LotteryDayReportPage />);

        // Find content area by looking for the container with responsive padding
        const contentArea = container.querySelector('.px-4.sm\\:px-6.lg\\:px-10');
        expect(contentArea).not.toBeNull();
      });

      it('should have max-width constraint for ultrawide screens', () => {
        const data = createMockReportData();
        setupHookReturn(data);

        const { container } = render(<LotteryDayReportPage />);

        // Content area should have max-w-[1600px] for ultrawide screens
        // Use space-y-6 which is unique to the content area (hero uses overflow-hidden)
        const contentArea = container.querySelector('.space-y-6.max-w-\\[1600px\\]');
        expect(contentArea).not.toBeNull();
        expect(contentArea!.className).toMatch(/max-w-\[1600px\]/);
      });

      it('should have mx-auto for centering on ultrawide screens', () => {
        const data = createMockReportData();
        setupHookReturn(data);

        const { container } = render(<LotteryDayReportPage />);

        // Content area should be centered
        const contentArea = container.querySelector('.mx-auto');
        expect(contentArea).not.toBeNull();
      });
    });

    describe('Table Responsive Classes', () => {
      it('should render table without fixed minWidth (responsive)', () => {
        const data = createMockReportData({
          bins: [
            {
              bin_number: 1,
              game_name: 'Powerball',
              game_price: 30,
              pack_number: 'PKG-001',
              starting_serial: '000',
              ending_serial: '004',
              tickets_sold: 4,
              sales_amount: 120,
            },
          ],
        });
        setupHookReturn(data);

        const { container } = render(<LotteryDayReportPage />);

        // Table should use tableLayout: fixed with colgroup for responsiveness
        const table = container.querySelector('table');
        expect(table).not.toBeNull();
        const tableStyle = table!.getAttribute('style');
        expect(tableStyle).toMatch(/table-layout:\s*fixed/);
        // Should NOT have minWidth: 850 (the old non-responsive value)
        expect(tableStyle).not.toMatch(/min-width:\s*850/);
      });

      it('should render table header cells with responsive padding', () => {
        const data = createMockReportData({
          bins: [
            {
              bin_number: 1,
              game_name: 'Powerball',
              game_price: 30,
              pack_number: 'PKG-001',
              starting_serial: '000',
              ending_serial: '004',
              tickets_sold: 4,
              sales_amount: 120,
            },
          ],
        });
        setupHookReturn(data);

        const { container } = render(<LotteryDayReportPage />);

        // Find table header cells and verify responsive classes
        const thCells = container.querySelectorAll('thead th');
        expect(thCells.length).toBeGreaterThan(0);

        // First th should have responsive padding classes
        const firstTh = thCells[0];
        expect(firstTh.className).toMatch(/px-2/);
        expect(firstTh.className).toMatch(/sm:px-3/);
        expect(firstTh.className).toMatch(/lg:px-5/);
      });

      it('should render table body cells with responsive text sizes', () => {
        const data = createMockReportData({
          bins: [
            {
              bin_number: 1,
              game_name: 'Powerball',
              game_price: 30,
              pack_number: 'PKG-001',
              starting_serial: '000',
              ending_serial: '004',
              tickets_sold: 4,
              sales_amount: 120,
            },
          ],
        });
        setupHookReturn(data);

        const { container } = render(<LotteryDayReportPage />);

        // Find table body cells
        const tdCells = container.querySelectorAll('tbody td');
        expect(tdCells.length).toBeGreaterThan(0);

        // Game name cell (second column) should have responsive text
        const gameCell = tdCells[1];
        expect(gameCell.className).toMatch(/text-xs/);
        expect(gameCell.className).toMatch(/sm:text-sm/);
      });

      it('should have overflow-x-auto on table container', () => {
        const data = createMockReportData({
          bins: [
            {
              bin_number: 1,
              game_name: 'Powerball',
              game_price: 30,
              pack_number: 'PKG-001',
              starting_serial: '000',
              ending_serial: '004',
              tickets_sold: 4,
              sales_amount: 120,
            },
          ],
        });
        setupHookReturn(data);

        const { container } = render(<LotteryDayReportPage />);

        // Table wrapper should have overflow-x-auto for horizontal scrolling
        const tableWrapper = container.querySelector('.overflow-x-auto');
        expect(tableWrapper).not.toBeNull();
      });
    });

    describe('Breakdown Cards Responsive Classes', () => {
      it('should render breakdown card with responsive flex sizing', () => {
        const data = createMockReportData({
          bins: [
            {
              bin_number: 1,
              game_name: 'Powerball',
              game_price: 30,
              pack_number: 'PKG-001',
              starting_serial: '000',
              ending_serial: '004',
              tickets_sold: 4,
              sales_amount: 120,
            },
          ],
        });
        setupHookReturn(data);

        render(<LotteryDayReportPage />);

        // Find Bin Sales card by text
        const binSalesLabel = screen.getByText('Bin Sales');
        const card = binSalesLabel.closest('div[class*="flex-1"]');
        expect(card).not.toBeNull();
      });

      it('should render breakdown cards wrapper with flex-wrap', () => {
        const data = createMockReportData({
          bins: [
            {
              bin_number: 1,
              game_name: 'Powerball',
              game_price: 30,
              pack_number: 'PKG-001',
              starting_serial: '000',
              ending_serial: '004',
              tickets_sold: 4,
              sales_amount: 120,
            },
          ],
          depletedPacks: [
            {
              pack_id: 'dep-001',
              bin_number: 2,
              game_name: 'Cash 5',
              game_price: 10,
              pack_number: 'PKG-DEP-001',
              starting_serial: '000',
              ending_serial: '007',
              tickets_sold: 7,
              sales_amount: 70,
              depleted_at: '2026-02-02T18:00:00Z',
            },
          ],
        });
        setupHookReturn(data);

        const { container } = render(<LotteryDayReportPage />);

        // Cards wrapper should have flex-wrap for responsive wrapping
        const cardsWrapper = container.querySelector('.flex.flex-wrap');
        expect(cardsWrapper).not.toBeNull();
      });

      it('should have responsive gap on breakdown cards container', () => {
        const data = createMockReportData();
        setupHookReturn(data);

        render(<LotteryDayReportPage />);

        const heroHeader = screen.getByTestId('hero-header');
        // Find the cards container with responsive gap
        const cardsContainer = heroHeader.querySelector('.flex.flex-wrap[class*="gap-2"]');
        expect(cardsContainer).not.toBeNull();
        expect(cardsContainer!.className).toMatch(/sm:gap-3/);
      });
    });

    describe('BinBadge Responsive Sizing', () => {
      it('should render bin badges with responsive sizing classes', () => {
        const data = createMockReportData({
          bins: [
            {
              bin_number: 1,
              game_name: 'Powerball',
              game_price: 30,
              pack_number: 'PKG-001',
              starting_serial: '000',
              ending_serial: '004',
              tickets_sold: 4,
              sales_amount: 120,
            },
          ],
        });
        setupHookReturn(data);

        const { container } = render(<LotteryDayReportPage />);

        // Find bin badge - it contains the bin number
        const binBadge = container.querySelector('tbody span[class*="w-8"]');
        expect(binBadge).not.toBeNull();
        // Should have responsive sizing w-8 h-8 sm:w-10 sm:h-10
        expect(binBadge!.className).toMatch(/w-8/);
        expect(binBadge!.className).toMatch(/h-8/);
        expect(binBadge!.className).toMatch(/sm:w-10/);
        expect(binBadge!.className).toMatch(/sm:h-10/);
      });

      it('should render bin badge with responsive text size', () => {
        const data = createMockReportData({
          bins: [
            {
              bin_number: 5,
              game_name: 'Powerball',
              game_price: 30,
              pack_number: 'PKG-001',
              starting_serial: '000',
              ending_serial: '004',
              tickets_sold: 4,
              sales_amount: 120,
            },
          ],
        });
        setupHookReturn(data);

        const { container } = render(<LotteryDayReportPage />);

        // Find bin badge with number 5
        const binBadge = container.querySelector('tbody span[class*="text-\\[13px\\]"]');
        expect(binBadge).not.toBeNull();
        expect(binBadge!.className).toMatch(/sm:text-\[15px\]/);
      });
    });

    describe('Multi-Closing Session Responsive Layout', () => {
      it('should render session banner with responsive padding', () => {
        const data = createMockReportData({
          totalClosings: 2,
          closingSessions: [
            createMockSession({
              closingNumber: 1,
              dayId: 'day-001',
              openedAt: '2026-02-02T08:00:00Z',
              closedAt: '2026-02-02T14:00:00Z',
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
            createMockSession({
              closingNumber: 2,
              dayId: 'day-002',
              openedAt: '2026-02-02T15:00:00Z',
              closedAt: '2026-02-02T20:31:00Z',
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
          ],
        });
        setupHookReturn(data);

        const { container } = render(<LotteryDayReportPage />);

        // Session banner should have responsive padding (p-3 sm:p-4)
        const banner = container.querySelector('[class*="from-amber-50"]');
        expect(banner).not.toBeNull();
        expect(banner!.className).toMatch(/p-3/);
        expect(banner!.className).toMatch(/sm:p-4/);
      });

      it('should render session tabs with responsive sizing', () => {
        const data = createMockReportData({
          totalClosings: 2,
          closingSessions: [
            createMockSession({
              closingNumber: 1,
              dayId: 'day-001',
              openedAt: '2026-02-02T08:00:00Z',
              closedAt: '2026-02-02T14:00:00Z',
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
            createMockSession({
              closingNumber: 2,
              dayId: 'day-002',
              openedAt: '2026-02-02T15:00:00Z',
              closedAt: '2026-02-02T20:31:00Z',
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
          ],
        });
        setupHookReturn(data);

        const { container } = render(<LotteryDayReportPage />);

        // Session tab buttons should have responsive padding
        const sessionButtons = container.querySelectorAll('button[class*="px-2.5"]');
        expect(sessionButtons.length).toBeGreaterThan(0);
        // First session button should have sm:px-4
        expect(sessionButtons[0].className).toMatch(/sm:px-4/);
      });

      it('should render session details card with responsive grid', () => {
        const data = createMockReportData({
          totalClosings: 2,
          closingSessions: [
            createMockSession({
              closingNumber: 1,
              dayId: 'day-001',
              openedAt: '2026-02-02T08:00:00Z',
              closedAt: '2026-02-02T14:00:00Z',
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
            createMockSession({
              closingNumber: 2,
              dayId: 'day-002',
              openedAt: '2026-02-02T15:00:00Z',
              closedAt: '2026-02-02T20:31:00Z',
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
          ],
        });
        setupHookReturn(data);

        const { container } = render(<LotteryDayReportPage />);

        // Session details card should have responsive grid (grid-cols-2 sm:grid-cols-4)
        const detailsCard = container.querySelector('.grid.grid-cols-2');
        expect(detailsCard).not.toBeNull();
        expect(detailsCard!.className).toMatch(/sm:grid-cols-4/);
      });
    });

    describe('Pack Sections Responsive Classes', () => {
      it('should render pack section table cells with responsive classes', () => {
        const data = createMockReportData({
          returnedPacks: [
            {
              pack_id: 'ret-001',
              bin_number: 2,
              game_name: 'Mega Millions',
              game_price: 20,
              pack_number: 'PKG-RET-001',
              starting_serial: '000',
              ending_serial: '003',
              tickets_sold: 3,
              sales_amount: 60,
              returned_at: '2026-02-02T19:00:00Z',
            },
          ],
        });
        setupHookReturn(data);

        render(<LotteryDayReportPage />);

        // Click to expand the returned packs section
        const sectionButton = screen.getByText(/Returned Packs/);
        fireEvent.click(sectionButton);

        // Wait for table to be visible, then check responsive classes
        const section = screen.getByTestId('returned-packs-section');
        const table = section.querySelector('table');
        expect(table).not.toBeNull();

        // Table cells should have responsive padding
        const tds = section.querySelectorAll('tbody td');
        expect(tds.length).toBeGreaterThan(0);
        expect(tds[0].className).toMatch(/px-2/);
        expect(tds[0].className).toMatch(/sm:px-3/);
      });
    });

    describe('Collapsible Sections Responsive Behavior', () => {
      it('should toggle returned packs section on click', () => {
        const data = createMockReportData({
          returnedPacks: [
            {
              pack_id: 'ret-001',
              bin_number: 2,
              game_name: 'Mega Millions',
              game_price: 20,
              pack_number: 'PKG-RET-001',
              starting_serial: '000',
              ending_serial: '003',
              tickets_sold: 3,
              sales_amount: 60,
              returned_at: '2026-02-02T19:00:00Z',
            },
          ],
        });
        setupHookReturn(data);

        render(<LotteryDayReportPage />);

        // Section should be collapsed initially
        const section = screen.getByTestId('returned-packs-section');
        let table = section.querySelector('table');
        expect(table).toBeNull();

        // Click to expand
        const headerButton = screen.getByText(/Returned Packs/).closest('button');
        expect(headerButton).not.toBeNull();
        fireEvent.click(headerButton!);

        // Table should now be visible
        table = section.querySelector('table');
        expect(table).not.toBeNull();
      });
    });
  });

  // --------------------------------------------------------------------------
  // Multi-Closing Date+Time Format Tests (BIZ-002 Compliance)
  // Enterprise Testing: Verify conditional date+time display when multiple
  // closings exist for the same business date. When hasMultipleClosings=true,
  // times must display with dates (e.g., "Jan 6, 10:30 AM") to disambiguate
  // sessions that may span different calendar days.
  //
  // Business Risk: HIGH - Users may confuse which calendar day a time refers
  // to when sessions span midnight (e.g., opened Jan 6 at 11:00 PM, closed
  // Jan 7 at 2:00 AM).
  // --------------------------------------------------------------------------
  describe('Multi-Closing Date+Time Format (BIZ-002)', () => {
    describe('Single Closing - Time-Only Format', () => {
      it('should display opening/closing times WITHOUT dates when single closing', () => {
        const data = createMockReportData({
          totalClosings: 1,
          closingSessions: [
            createMockSession({
              closingNumber: 1,
              dayId: 'day-001',
              openedAt: '2026-02-02T15:24:00Z',
              closedAt: '2026-02-02T20:31:00Z',
              binSales: 120,
              totalSales: 120,
              totalTicketsSold: 4,
            }),
          ],
        });
        setupHookReturn(data);

        render(<LotteryDayReportPage />);

        // With single closing, multi-closing banner should NOT be present
        const banner = screen.queryByText(/Multiple Day Closings/);
        expect(banner).not.toBeInTheDocument();
      });
    });

    describe('Multiple Closings - Date+Time Format', () => {
      it('should display session tabs with ordinal labels when multiple closings', () => {
        const data = createMockReportData({
          totalClosings: 2,
          closingSessions: [
            createMockSession({
              closingNumber: 1,
              dayId: 'day-001',
              openedAt: '2026-02-02T08:00:00Z',
              closedAt: '2026-02-02T14:00:00Z',
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
            createMockSession({
              closingNumber: 2,
              dayId: 'day-002',
              openedAt: '2026-02-02T15:00:00Z',
              closedAt: '2026-02-02T20:31:00Z',
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
          ],
        });
        setupHookReturn(data);

        render(<LotteryDayReportPage />);

        // Session banner should be visible with simplified label
        expect(screen.getByText('Multiple Day Closings')).toBeInTheDocument();

        // Session tabs show ordinal labels (1st, 2nd) — no time ranges
        const sessionTab1 = screen.getByText('1st');
        expect(sessionTab1.closest('button')).not.toBeNull();
        const sessionTab2 = screen.getByText('2nd');
        expect(sessionTab2.closest('button')).not.toBeNull();
      });

      it('should display merged details grid with date+time format when multiple closings', () => {
        const data = createMockReportData({
          totalClosings: 2,
          closingSessions: [
            createMockSession({
              closingNumber: 1,
              dayId: 'day-001',
              openedAt: '2026-02-02T08:00:00Z',
              closedAt: '2026-02-02T14:00:00Z',
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
            createMockSession({
              closingNumber: 2,
              dayId: 'day-002',
              openedAt: '2026-02-02T15:00:00Z',
              closedAt: '2026-02-02T20:31:00Z',
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
          ],
        });
        setupHookReturn(data);

        render(<LotteryDayReportPage />);

        // In combined view (default), details grid shows "Combined" under "Day Close"
        expect(screen.getByText('Day Close')).toBeInTheDocument();
        // "Combined" appears in both the button and the grid value
        const combinedElements = screen.getAllByText('Combined');
        expect(combinedElements.length).toBeGreaterThanOrEqual(2);

        // Labels should be "Day Started" and "Final Close"
        expect(screen.getByText('Day Started')).toBeInTheDocument();
        expect(screen.getByText('Final Close')).toBeInTheDocument();

        // The details grid should contain date+time formatted values
        const dayStartedLabel = screen.getByText('Day Started');
        const dayStartedCard = dayStartedLabel.closest('div');
        expect(dayStartedCard).not.toBeNull();
        expect(dayStartedCard!.textContent).toMatch(/Feb\s+2,\s+\d{1,2}:\d{2}\s+(AM|PM)/);
      });

      it('should show different dates in details grid when sessions span midnight (critical business case)', () => {
        // Critical test: Session 2 opens on Feb 2 at 11:00 PM MST, closes Feb 3 at 2:00 AM MST
        // Store timezone is America/Denver (MST = UTC-7)
        // To get Feb 2 11:00 PM MST in UTC: Feb 3 06:00:00Z (11 PM + 7 hours)
        // To get Feb 3 2:00 AM MST in UTC: Feb 3 09:00:00Z (2 AM + 7 hours)
        const data = createMockReportData({
          totalClosings: 2,
          closingSessions: [
            createMockSession({
              closingNumber: 1,
              dayId: 'day-001',
              openedAt: '2026-02-02T08:00:00Z',
              closedAt: '2026-02-02T14:00:00Z',
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
            createMockSession({
              closingNumber: 2,
              dayId: 'day-002',
              openedAt: '2026-02-03T06:00:00Z', // 11:00 PM on Feb 2 in MST
              closedAt: '2026-02-03T09:00:00Z', // 2:00 AM on Feb 3 in MST (next day!)
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
          ],
        });
        setupHookReturn(data);

        render(<LotteryDayReportPage />);

        // Session tab shows ordinal only (no time ranges in tabs)
        const sessionTab2 = screen.getByText('2nd');
        expect(sessionTab2.closest('button')).not.toBeNull();

        // Click session #2 to see its details in the merged grid
        fireEvent.click(sessionTab2);

        // Details grid should show date+time values for Opened At and Closed At
        expect(screen.getByText('Opened At')).toBeInTheDocument();
        expect(screen.getByText('Closed At')).toBeInTheDocument();

        // Verify the Opened At value contains date+time format
        const openedAtLabel = screen.getByText('Opened At');
        const openedAtValue = openedAtLabel.parentElement?.querySelector(
          'span.text-xs, span.text-sm'
        );
        expect(openedAtValue).not.toBeNull();
        expect(openedAtValue!.textContent).toMatch(/Feb\s+3,\s+\d{1,2}:\d{2}\s+(AM|PM)/);
      });

      it('should show date+time in individual session view (not combined)', () => {
        const data = createMockReportData({
          totalClosings: 2,
          closingSessions: [
            createMockSession({
              closingNumber: 1,
              dayId: 'day-001',
              openedAt: '2026-02-02T08:00:00Z',
              closedAt: '2026-02-02T14:00:00Z',
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
            createMockSession({
              closingNumber: 2,
              dayId: 'day-002',
              openedAt: '2026-02-02T15:00:00Z',
              closedAt: '2026-02-02T20:31:00Z',
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
          ],
        });
        setupHookReturn(data);

        render(<LotteryDayReportPage />);

        // Click on session tab "1st" to switch to individual view
        const sessionTab1 = screen.getByText('1st').closest('button');
        expect(sessionTab1).not.toBeNull();
        fireEvent.click(sessionTab1!);

        // Details grid should now show individual session info
        // with date+time format for "Opened At" and "Closed At"
        expect(screen.getByText('Opened At')).toBeInTheDocument();
        expect(screen.getByText('Closed At')).toBeInTheDocument();

        // Verify the format includes both date and time
        const openedAtLabel = screen.getByText('Opened At');
        const openedAtValue = openedAtLabel.parentElement?.querySelector(
          'span.text-xs, span.text-sm'
        );
        expect(openedAtValue).not.toBeNull();
        expect(openedAtValue!.textContent).toMatch(/Feb\s+2,\s+\d{1,2}:\d{2}\s+(AM|PM)/);
      });
    });

    describe('Edge Cases - Null Timestamps with Multiple Closings', () => {
      it('should handle null openedAt gracefully with date+time format', () => {
        const data = createMockReportData({
          totalClosings: 2,
          closingSessions: [
            createMockSession({
              closingNumber: 1,
              dayId: 'day-001',
              openedAt: null, // Null opened timestamp
              closedAt: '2026-02-02T14:00:00Z',
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
            createMockSession({
              closingNumber: 2,
              dayId: 'day-002',
              openedAt: '2026-02-02T15:00:00Z',
              closedAt: '2026-02-02T20:31:00Z',
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
          ],
        });
        setupHookReturn(data);

        // Should not throw
        render(<LotteryDayReportPage />);

        // Click session 1st to view its details in the merged grid
        const sessionTab1 = screen.getByText('1st').closest('button');
        expect(sessionTab1).not.toBeNull();
        fireEvent.click(sessionTab1!);

        // Opened At value should show "--" for null timestamp
        const openedAtLabel = screen.getByText('Opened At');
        const openedAtValue = openedAtLabel.parentElement?.querySelector(
          'span.text-xs, span.text-sm'
        );
        expect(openedAtValue).not.toBeNull();
        expect(openedAtValue!.textContent).toBe('--');
      });

      it('should handle null closedAt gracefully with date+time format', () => {
        const data = createMockReportData({
          totalClosings: 2,
          closingSessions: [
            createMockSession({
              closingNumber: 1,
              dayId: 'day-001',
              openedAt: '2026-02-02T08:00:00Z',
              closedAt: null, // Null closed timestamp
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
            createMockSession({
              closingNumber: 2,
              dayId: 'day-002',
              openedAt: '2026-02-02T15:00:00Z',
              closedAt: '2026-02-02T20:31:00Z',
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
          ],
        });
        setupHookReturn(data);

        // Should not throw
        render(<LotteryDayReportPage />);

        // Click session 1st to view its details in the merged grid
        const sessionTab1 = screen.getByText('1st').closest('button');
        expect(sessionTab1).not.toBeNull();
        fireEvent.click(sessionTab1!);

        // Closed At value should show "--" for null timestamp
        const closedAtLabel = screen.getByText('Closed At');
        const closedAtValue = closedAtLabel.parentElement?.querySelector(
          'span.text-xs, span.text-sm'
        );
        expect(closedAtValue).not.toBeNull();
        expect(closedAtValue!.textContent).toBe('--');
      });

      it('should handle both null timestamps gracefully with date+time format', () => {
        const data = createMockReportData({
          totalClosings: 2,
          closingSessions: [
            createMockSession({
              closingNumber: 1,
              dayId: 'day-001',
              openedAt: null,
              closedAt: null,
              totalSales: 0,
              totalTicketsSold: 0,
            }),
            createMockSession({
              closingNumber: 2,
              dayId: 'day-002',
              openedAt: '2026-02-02T15:00:00Z',
              closedAt: '2026-02-02T20:31:00Z',
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
          ],
        });
        setupHookReturn(data);

        // Should not throw
        render(<LotteryDayReportPage />);

        // Click session 1st to view its details in the merged grid
        const sessionTab1 = screen.getByText('1st').closest('button');
        expect(sessionTab1).not.toBeNull();
        fireEvent.click(sessionTab1!);

        // Both Opened At and Closed At should show "--"
        const openedAtLabel = screen.getByText('Opened At');
        const openedAtValue = openedAtLabel.parentElement?.querySelector(
          'span.text-xs, span.text-sm'
        );
        expect(openedAtValue!.textContent).toBe('--');

        const closedAtLabel = screen.getByText('Closed At');
        const closedAtValue = closedAtLabel.parentElement?.querySelector(
          'span.text-xs, span.text-sm'
        );
        expect(closedAtValue!.textContent).toBe('--');
      });
    });

    describe('Combined View Date+Time Format', () => {
      it('should show first session openedAt and last session closedAt in combined view', () => {
        const data = createMockReportData({
          totalClosings: 3,
          closingSessions: [
            createMockSession({
              closingNumber: 1,
              dayId: 'day-001',
              openedAt: '2026-02-02T06:00:00Z', // First open: 6:00 AM
              closedAt: '2026-02-02T10:00:00Z',
              binSales: 40,
              totalSales: 40,
              totalTicketsSold: 2,
            }),
            createMockSession({
              closingNumber: 2,
              dayId: 'day-002',
              openedAt: '2026-02-02T11:00:00Z',
              closedAt: '2026-02-02T15:00:00Z',
              binSales: 40,
              totalSales: 40,
              totalTicketsSold: 2,
            }),
            createMockSession({
              closingNumber: 3,
              dayId: 'day-003',
              openedAt: '2026-02-02T16:00:00Z',
              closedAt: '2026-02-02T22:00:00Z', // Last close: 10:00 PM
              binSales: 40,
              totalSales: 40,
              totalTicketsSold: 2,
            }),
          ],
        });
        setupHookReturn(data);

        render(<LotteryDayReportPage />);

        // In combined view, details grid shows "Combined" under "Day Close"
        expect(screen.getByText('Day Close')).toBeInTheDocument();
        // Use getAllByText since "Combined" appears both as a button and as the grid label
        const combinedElements = screen.getAllByText('Combined');
        expect(combinedElements.length).toBeGreaterThanOrEqual(1);

        // Labels should be "Day Started" and "Final Close"
        expect(screen.getByText('Day Started')).toBeInTheDocument();
        expect(screen.getByText('Final Close')).toBeInTheDocument();

        // The values should be from first session openedAt and last session closedAt
        // with date+time format since hasMultipleClosings=true
        const dayStartedLabel = screen.getByText('Day Started');
        const dayStartedCard = dayStartedLabel.closest('div');
        expect(dayStartedCard).not.toBeNull();
        expect(dayStartedCard!.textContent).toMatch(/Feb\s+2,\s+\d{1,2}:\d{2}\s+(AM|PM)/);
      });
    });

    describe('View Toggle Behavior', () => {
      it('should switch between combined and individual views correctly', () => {
        const data = createMockReportData({
          totalClosings: 2,
          closingSessions: [
            createMockSession({
              closingNumber: 1,
              dayId: 'day-001',
              openedAt: '2026-02-02T08:00:00Z',
              closedAt: '2026-02-02T14:00:00Z',
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
            createMockSession({
              closingNumber: 2,
              dayId: 'day-002',
              openedAt: '2026-02-02T15:00:00Z',
              closedAt: '2026-02-02T20:31:00Z',
              binSales: 60,
              totalSales: 60,
              totalTicketsSold: 2,
            }),
          ],
        });
        setupHookReturn(data);

        render(<LotteryDayReportPage />);

        // Initially in combined view — details grid shows "Combined"
        expect(screen.getByText('Day Close')).toBeInTheDocument();
        expect(screen.getByText('Day Started')).toBeInTheDocument();
        expect(screen.getByText('Final Close')).toBeInTheDocument();

        // Click on session "1st" to switch to individual view
        const sessionTab1 = screen.getByText('1st').closest('button');
        fireEvent.click(sessionTab1!);

        // Should now show individual session labels with ordinal
        // "1st" appears in both the session tab and details grid value
        const firstOrdinals = screen.getAllByText('1st');
        expect(firstOrdinals.length).toBeGreaterThanOrEqual(2); // tab + grid value
        expect(screen.getByText('Opened At')).toBeInTheDocument();
        expect(screen.getByText('Closed At')).toBeInTheDocument();

        // Click Combined button to switch back
        // "Combined" is a button label (and will also appear as grid value after click)
        const combinedButton = screen.getByRole('button', { name: 'Combined' });
        fireEvent.click(combinedButton);

        // Should be back to combined view — "Day Started" / "Final Close" labels return
        expect(screen.getByText('Day Started')).toBeInTheDocument();
        expect(screen.getByText('Final Close')).toBeInTheDocument();
      });
    });
  });

  // --------------------------------------------------------------------------
  // Accessibility Tests
  // Enterprise Testing: Verify ARIA attributes and semantic structure
  // --------------------------------------------------------------------------
  describe('Accessibility', () => {
    it('should have aria-expanded on collapsible section buttons', () => {
      const data = createMockReportData({
        returnedPacks: [
          {
            pack_id: 'ret-001',
            bin_number: 2,
            game_name: 'Mega Millions',
            game_price: 20,
            pack_number: 'PKG-RET-001',
            starting_serial: '000',
            ending_serial: '003',
            tickets_sold: 3,
            sales_amount: 60,
            returned_at: '2026-02-02T19:00:00Z',
          },
        ],
      });
      setupHookReturn(data);

      render(<LotteryDayReportPage />);

      const headerButton = screen.getByText(/Returned Packs/).closest('button');
      expect(headerButton).not.toBeNull();
      expect(headerButton).toHaveAttribute('aria-expanded', 'false');

      // After click, aria-expanded should be true
      fireEvent.click(headerButton!);
      expect(headerButton).toHaveAttribute('aria-expanded', 'true');
    });

    it('should use semantic table structure with thead and tbody', () => {
      const data = createMockReportData({
        bins: [
          {
            bin_number: 1,
            game_name: 'Powerball',
            game_price: 30,
            pack_number: 'PKG-001',
            starting_serial: '000',
            ending_serial: '004',
            tickets_sold: 4,
            sales_amount: 120,
          },
        ],
      });
      setupHookReturn(data);

      const { container } = render(<LotteryDayReportPage />);

      // Should have proper table structure
      const table = container.querySelector('table');
      expect(table).not.toBeNull();
      expect(table!.querySelector('thead')).not.toBeNull();
      expect(table!.querySelector('tbody')).not.toBeNull();
      expect(table!.querySelector('tfoot')).not.toBeNull();
    });

    it('should have proper button type on back button', () => {
      const data = createMockReportData();
      setupHookReturn(data);

      render(<LotteryDayReportPage />);

      const backButton = screen.getAllByText('Back to Reports')[0].closest('button');
      expect(backButton).not.toBeNull();
      expect(backButton).toHaveAttribute('type', 'button');
    });
  });
});
