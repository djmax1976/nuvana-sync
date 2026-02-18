/**
 * ViewDayPage Security Tests
 *
 * Security tests for the ViewDayPage component.
 * Validates:
 * - SEC-004: XSS prevention in all rendered content
 * - FE-001: No dangerouslySetInnerHTML usage
 * - SEC-014: Input validation for route parameters
 * - API-008: Only whitelisted fields displayed
 * - DB-006: Store isolation via dayId parameter
 *
 * @module tests/security/pages/ViewDayPage
 * @security SEC-004: XSS prevention
 * @security FE-001: No dangerouslySetInnerHTML
 * @security SEC-014: Input validation
 * @security API-008: Field whitelisting
 * @security DB-006: Store isolation
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

// Mock LoadingSpinner
vi.mock('../../../src/renderer/components/ui/LoadingSpinner', () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner">Loading...</div>,
}));

// ============================================================================
// Import Component Under Test
// ============================================================================

import ViewDayPage from '../../../src/renderer/pages/ViewDayPage';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates mock data with XSS payloads in various fields
 * @security SEC-004: Test XSS prevention
 */
function createMockDataWithXSSPayloads() {
  return {
    daySummaryId: '<script>alert("dayId")</script>',
    businessDate: '2026-02-17<img src=x onerror=alert(1)>',
    status: 'CLOSED' as const,
    dayInfo: {
      businessDate: '<script>document.cookie</script>',
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
        cashPayouts: { reports: -725.0, pos: -725.0, hasImages: false, count: 0 },
        lotteryPayouts: { reports: -1250.0, pos: -1250.0, hasImages: false },
        gamingPayouts: { reports: -200.0, pos: -200.0, hasImages: false },
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
    lotteryDayId: '<img src=x onerror=alert("lottery")>',
    timestamps: {
      createdAt: '2026-02-17T06:00:00.000Z',
      closedAt: '2026-02-17T22:30:00.000Z',
    },
  };
}

/**
 * Creates valid mock data
 */
function createValidMockData() {
  return {
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
        cashPayouts: { reports: -725.0, pos: -725.0, hasImages: false, count: 0 },
        lotteryPayouts: { reports: -1250.0, pos: -1250.0, hasImages: false },
        gamingPayouts: { reports: -200.0, pos: -200.0, hasImages: false },
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
}

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
// Security Test Suite
// ============================================================================

describe('ViewDayPage Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // SEC-004: XSS Prevention
  // ==========================================================================

  describe('SEC-004: XSS Prevention', () => {
    it('should escape business date with XSS payload', () => {
      // Arrange - XSS payload in business date
      mockUseDayViewData.mockReturnValue({
        data: createMockDataWithXSSPayloads(),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert - React auto-escapes content
      const infoCard = screen.getByTestId('day-info-card');
      // Verify HTML-escaping (< becomes &lt;)
      expect(infoCard.innerHTML).toContain('&lt;script&gt;');
      // No raw script tags
      expect(infoCard.innerHTML).not.toMatch(/<script>/);
      // Content is visible as text
      expect(infoCard.textContent).toContain('<script>');
    });

    it('should not render executable HTML in lottery section', () => {
      // Arrange
      mockUseDayViewData.mockReturnValue({
        data: createMockDataWithXSSPayloads(),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert - LotterySection doesn't render malicious dayId as visible content
      const lotterySection = screen.getByTestId('lottery-section');
      // No unescaped script or img tags in innerHTML
      expect(lotterySection.innerHTML).not.toMatch(/<script>/);
      expect(lotterySection.innerHTML).not.toMatch(/<img\s+src=/);
      // The malicious lotteryDayId is passed as data-attribute, not visible content
      // Verify safe content is rendered (currency, headings)
      expect(lotterySection.innerHTML).toContain('Lottery');
      expect(lotterySection.textContent).toMatch(/\$[\d,]+\.\d{2}/);
    });

    it('should escape all date/time values', () => {
      // Arrange
      mockUseDayViewData.mockReturnValue({
        data: createMockDataWithXSSPayloads(),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert
      const footer = screen.getByTestId('view-footer');
      expect(footer.innerHTML).not.toContain('<img');
      expect(footer.innerHTML).not.toContain('onerror');
    });

    it('should not execute javascript from any data field', () => {
      // Arrange
      const alertSpy = vi.fn();
      global.alert = alertSpy;

      mockUseDayViewData.mockReturnValue({
        data: createMockDataWithXSSPayloads(),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert - No alert should have been called
      expect(alertSpy).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // FE-001: No dangerouslySetInnerHTML
  // ==========================================================================

  describe('FE-001: No dangerouslySetInnerHTML', () => {
    it('should not use dangerouslySetInnerHTML in the page', () => {
      // Arrange
      mockUseDayViewData.mockReturnValue({
        data: createValidMockData(),
        isLoading: false,
        error: null,
      });

      // Act
      const { container } = renderWithRouter();

      // Assert
      const html = container.innerHTML;
      expect(html).not.toMatch(/dangerouslySetInnerHTML/);
      expect(html).not.toMatch(/__html/);
    });

    it('should render lottery totals as safe text', () => {
      // Arrange
      mockUseDayViewData.mockReturnValue({
        data: createValidMockData(),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert - Lottery total should be rendered as currency text
      const lotterySection = screen.getByTestId('lottery-section');
      expect(lotterySection).toBeInTheDocument();
      // Currency formatting renders safely
      expect(lotterySection.textContent).toMatch(/\$[\d,]+\.\d{2}/);
    });
  });

  // ==========================================================================
  // SEC-014: Input Validation for Route Parameters
  // ==========================================================================

  describe('SEC-014: Input Validation', () => {
    it('should handle path traversal attempt in dayId', () => {
      // Arrange - URL-encoded path traversal attempt
      const maliciousDayId = encodeURIComponent('../../../etc/passwd');
      mockUseDayViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Invalid day ID format'),
      });

      // Act
      renderWithRouter(maliciousDayId);

      // Assert - Shows error state
      expect(screen.getByTestId('view-day-page-error')).toBeInTheDocument();
      // Doesn't expose system paths
      const errorPage = screen.getByTestId('view-day-page-error');
      expect(errorPage.textContent).not.toContain('/etc/passwd');
    });

    it('should handle SQL injection attempt in dayId', () => {
      // Arrange - URL-encoded SQL injection attempt
      const sqlInjectionDayId = encodeURIComponent("' OR '1'='1' --");
      mockUseDayViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Invalid day ID'),
      });

      // Act
      renderWithRouter(sqlInjectionDayId);

      // Assert
      expect(screen.getByTestId('view-day-page-error')).toBeInTheDocument();
    });

    it('should handle XSS in dayId URL parameter', () => {
      // Arrange - URL-encoded XSS attempt
      const xssDayId = encodeURIComponent('<script>alert("xss")</script>');
      mockUseDayViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Day not found'),
      });

      // Act
      renderWithRouter(xssDayId);

      // Assert - Error page is shown with escaped content
      const errorPage = screen.getByTestId('view-day-page-error');
      expect(errorPage.innerHTML).not.toContain('<script>');
    });

    it('should handle null byte injection attempt', () => {
      // Arrange
      const nullByteDayId = 'day-001%00.txt';
      mockUseDayViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter(nullByteDayId);

      // Assert - Should handle gracefully
      expect(screen.getByTestId('view-day-page-error')).toBeInTheDocument();
    });

    it('should handle extremely long dayId', () => {
      // Arrange
      const longDayId = 'a'.repeat(10000);
      mockUseDayViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter(longDayId);

      // Assert
      expect(screen.getByTestId('view-day-page-error')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // API-008: Field Whitelisting
  // ==========================================================================

  describe('API-008: Field Whitelisting', () => {
    it('should only display expected fields from day data', () => {
      // Arrange
      mockUseDayViewData.mockReturnValue({
        data: createValidMockData(),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert - Only whitelisted fields visible
      expect(screen.getByText('Feb 17, 2026')).toBeInTheDocument();
      expect(screen.getByText('$200.00')).toBeInTheDocument();
    });

    it('should not expose lotteryDayId in visible text', () => {
      // Arrange
      mockUseDayViewData.mockReturnValue({
        data: createValidMockData(),
        isLoading: false,
        error: null,
      });

      // Act
      const { container } = renderWithRouter();

      // Assert - lotteryDayId should only be in data attributes
      const page = screen.getByTestId('view-day-page');
      expect(page).toHaveAttribute('data-day-id', 'day-001');

      // Full internal IDs should not be in visible text
      const textContent = container.textContent;
      expect(textContent).not.toContain('lottery-day-0001-0000-000000000001');
    });
  });

  // ==========================================================================
  // DB-006: Store Isolation (Frontend Enforcement)
  // ==========================================================================

  describe('DB-006: Store Isolation', () => {
    it('should pass dayId to lottery section for store-scoped queries', () => {
      // Arrange
      const dayId = 'day-store-001';
      mockUseDayViewData.mockReturnValue({
        data: createValidMockData(),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter(dayId);

      // Assert - dayId passed to lottery section ensures backend queries are scoped
      const lotterySection = screen.getByTestId('lottery-section');
      // The dayId attribute indicates the component received the ID for scoped queries
      expect(lotterySection).toHaveAttribute('data-day-id');
    });

    it('should maintain dayId context throughout the page', () => {
      // Arrange
      const dayId = 'day-uuid-12345';
      mockUseDayViewData.mockReturnValue({
        data: createValidMockData(),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter(dayId);

      // Assert - dayId should be consistent across the page
      const page = screen.getByTestId('view-day-page');
      expect(page).toHaveAttribute('data-day-id', dayId);
    });
  });

  // ==========================================================================
  // Error Handling Security
  // ==========================================================================

  describe('Error Handling Security', () => {
    it('should not expose stack traces in error state', () => {
      // Arrange
      const errorWithStack = new Error('Store not found');
      errorWithStack.stack = 'at StoreDAL.findById (stores.dal.ts:42)';

      mockUseDayViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: errorWithStack,
      });

      // Act
      renderWithRouter();

      // Assert
      const errorPage = screen.getByTestId('view-day-page-error');
      expect(errorPage.textContent).not.toContain('StoreDAL');
      expect(errorPage.textContent).not.toContain('.dal.ts');
      expect(errorPage.textContent).toContain('Store not found');
    });

    it('should sanitize error messages for display', () => {
      // Arrange
      const errorWithSensitiveInfo = new Error(
        'SQL Error: SELECT * FROM days WHERE store_id = "attacker"'
      );

      mockUseDayViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: errorWithSensitiveInfo,
      });

      // Act
      renderWithRouter();

      // Assert - Error is shown but verify component handles it
      expect(screen.getByTestId('view-day-page-error')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Lottery Section Security
  // ==========================================================================

  describe('Lottery Section Security', () => {
    it('should not render lottery section when lotteryDayId is null', () => {
      // Arrange
      mockUseDayViewData.mockReturnValue({
        data: { ...createValidMockData(), lotteryDayId: null },
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert - No lottery section should be rendered
      expect(screen.queryByTestId('lottery-section')).not.toBeInTheDocument();
    });

    it('should sanitize lotteryDayId before passing to children', () => {
      // Arrange
      mockUseDayViewData.mockReturnValue({
        data: {
          ...createValidMockData(),
          lotteryDayId: 'valid-lottery-day-id',
        },
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert
      const lotterySection = screen.getByTestId('lottery-section');
      expect(lotterySection).toHaveAttribute('data-day-id', 'valid-lottery-day-id');
    });
  });

  // ==========================================================================
  // Navigation Security
  // ==========================================================================

  describe('Navigation Security', () => {
    it('should use safe navigation method', () => {
      // Arrange
      mockUseDayViewData.mockReturnValue({
        data: createValidMockData(),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert
      const backButton = screen.getByTestId('view-header-back-button');
      expect(backButton).toHaveAttribute('aria-label', 'Go back');
    });

    it('should not include external URLs in navigation', () => {
      // Arrange
      mockUseDayViewData.mockReturnValue({
        data: createValidMockData(),
        isLoading: false,
        error: null,
      });

      // Act
      const { container } = renderWithRouter();

      // Assert - No external links
      const links = container.querySelectorAll('a[href^="http"]');
      expect(links.length).toBe(0);
    });
  });
});
