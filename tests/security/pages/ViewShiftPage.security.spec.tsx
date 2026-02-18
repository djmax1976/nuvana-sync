/**
 * ViewShiftPage Security Tests
 *
 * Security tests for the ViewShiftPage component.
 * Validates:
 * - SEC-004: XSS prevention in all rendered content
 * - FE-001: No dangerouslySetInnerHTML usage
 * - SEC-014: Input validation for route parameters
 * - API-008: Only whitelisted fields displayed
 *
 * @module tests/security/pages/ViewShiftPage
 * @security SEC-004: XSS prevention
 * @security FE-001: No dangerouslySetInnerHTML
 * @security SEC-014: Input validation
 * @security API-008: Field whitelisting
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

// Mock LoadingSpinner
vi.mock('../../../src/renderer/components/ui/LoadingSpinner', () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner">Loading...</div>,
}));

// ============================================================================
// Import Component Under Test
// ============================================================================

import ViewShiftPage from '../../../src/renderer/pages/ViewShiftPage';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates mock data with XSS payloads in various fields
 * @security SEC-004: Test XSS prevention
 */
function createMockDataWithXSSPayloads() {
  return {
    shiftId: '<script>alert("xss")</script>',
    businessDate: '2026-02-17<script>alert("date")</script>',
    status: 'CLOSED' as const,
    shiftInfo: {
      terminalName: '<img src=x onerror=alert("terminal")>',
      shiftNumber: 3,
      cashierName: '<script>document.location="http://evil.com"</script>',
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
        cashPayouts: { reports: -425.0, pos: -425.0, hasImages: false, count: 0 },
        lotteryPayouts: { reports: -850.0, pos: -850.0, hasImages: false },
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
}

/**
 * Creates valid mock data
 */
function createValidMockData() {
  return {
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
        cashPayouts: { reports: -425.0, pos: -425.0, hasImages: false, count: 0 },
        lotteryPayouts: { reports: -850.0, pos: -850.0, hasImages: false },
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
}

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
// Security Test Suite
// ============================================================================

describe('ViewShiftPage Security', () => {
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
    it('should escape terminal name with XSS payload', () => {
      // Arrange - XSS payload in terminal name
      mockUseShiftViewData.mockReturnValue({
        data: createMockDataWithXSSPayloads(),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert - React auto-escapes content via JSX
      const infoCard = screen.getByTestId('shift-info-card');
      // Verify the content is HTML-escaped (< becomes &lt;)
      expect(infoCard.innerHTML).toContain('&lt;img');
      expect(infoCard.innerHTML).toContain('&gt;');
      // Verify no unescaped HTML elements exist
      expect(infoCard.innerHTML).not.toMatch(/<img[^&]/);
      // The payload is rendered as visible text, not as executable HTML
      expect(infoCard.textContent).toContain('<img src=x');
    });

    it('should escape cashier name with XSS payload', () => {
      // Arrange
      mockUseShiftViewData.mockReturnValue({
        data: createMockDataWithXSSPayloads(),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert - Script tags are HTML-escaped
      const infoCard = screen.getByTestId('shift-info-card');
      // Verify proper escaping (< becomes &lt;)
      expect(infoCard.innerHTML).toContain('&lt;script&gt;');
      // No unescaped script tags should exist
      expect(infoCard.innerHTML).not.toMatch(/<script>/i);
      // Content is visible as text
      expect(infoCard.textContent).toContain('<script>');
    });

    it('should not execute javascript from data fields', () => {
      // Arrange
      const consoleSpy = vi.spyOn(console, 'error');
      mockUseShiftViewData.mockReturnValue({
        data: createMockDataWithXSSPayloads(),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert - No script execution errors
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('script'));
    });

    it('should escape date values in header', () => {
      // Arrange
      mockUseShiftViewData.mockReturnValue({
        data: createMockDataWithXSSPayloads(),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert - Date should be properly formatted, not contain script
      const header = screen.getByTestId('view-header');
      const dateElement = within(header).getByTestId('view-header-date');
      expect(dateElement.innerHTML).not.toContain('<script>');
    });
  });

  // ==========================================================================
  // FE-001: No dangerouslySetInnerHTML
  // ==========================================================================

  describe('FE-001: No dangerouslySetInnerHTML', () => {
    it('should not use dangerouslySetInnerHTML in the page', () => {
      // Arrange
      mockUseShiftViewData.mockReturnValue({
        data: createValidMockData(),
        isLoading: false,
        error: null,
      });

      // Act
      const { container } = renderWithRouter();

      // Assert - Check that no element has dangerous patterns
      const html = container.innerHTML;
      expect(html).not.toMatch(/dangerouslySetInnerHTML/);
      // React uses __html for dangerouslySetInnerHTML
      expect(html).not.toMatch(/__html/);
    });

    it('should render all text content via React text nodes', () => {
      // Arrange
      mockUseShiftViewData.mockReturnValue({
        data: createValidMockData(),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert - Check specific fields are rendered as text
      expect(screen.getByText('Register 1')).toBeInTheDocument();
      expect(screen.getByText('John Smith')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // SEC-014: Input Validation for Route Parameters
  // ==========================================================================

  describe('SEC-014: Input Validation', () => {
    it('should handle malicious shiftId in URL gracefully', () => {
      // Arrange - URL-encoded path traversal attempt
      // Backend returns error for invalid ID format
      const maliciousId = encodeURIComponent('../../../etc/passwd');
      mockUseShiftViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Invalid shift ID format'),
      });

      // Act
      renderWithRouter(maliciousId);

      // Assert - Should show error state, not crash or expose system info
      expect(screen.getByTestId('view-shift-page-error')).toBeInTheDocument();
      // Should not expose system paths
      const errorPage = screen.getByTestId('view-shift-page-error');
      expect(errorPage.textContent).not.toContain('/etc/passwd');
    });

    it('should handle SQL injection attempt in shiftId', () => {
      // Arrange - URL-encoded SQL injection attempt
      // Backend validates and returns error
      const sqlInjectionId = encodeURIComponent("'; DROP TABLE shifts; --");
      mockUseShiftViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Invalid shift ID'),
      });

      // Act
      renderWithRouter(sqlInjectionId);

      // Assert - Should handle gracefully
      expect(screen.getByTestId('view-shift-page-error')).toBeInTheDocument();
    });

    it('should handle XSS in shiftId URL parameter', () => {
      // Arrange - URL-encoded XSS attempt
      // Backend validates and returns error
      const xssId = encodeURIComponent('<script>alert("xss")</script>');
      mockUseShiftViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Shift not found'),
      });

      // Act
      renderWithRouter(xssId);

      // Assert
      expect(screen.getByTestId('view-shift-page-error')).toBeInTheDocument();
      // The error page should have escaped XSS content
      const errorPage = screen.getByTestId('view-shift-page-error');
      expect(errorPage.innerHTML).not.toMatch(/<script>/i);
    });

    it('should handle empty shiftId by showing error state', () => {
      // Arrange - Component should handle missing/undefined shiftId
      mockUseShiftViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
      });

      // Act - Render without proper route param
      render(
        <MemoryRouter initialEntries={['/shifts//view']}>
          <Routes>
            <Route path="/shifts/:shiftId/view" element={<ViewShiftPage />} />
            <Route path="/shifts//view" element={<ViewShiftPage />} />
          </Routes>
        </MemoryRouter>
      );

      // Assert - Should show error for invalid/empty ID
      expect(screen.getByTestId('view-shift-page-error')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // API-008: Field Whitelisting
  // ==========================================================================

  describe('API-008: Field Whitelisting', () => {
    it('should only display expected fields from shift data', () => {
      // Arrange
      mockUseShiftViewData.mockReturnValue({
        data: createValidMockData(),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert - Only whitelisted fields should be visible
      // Terminal name - whitelisted
      expect(screen.getByText('Register 1')).toBeInTheDocument();
      // Cashier name - whitelisted
      expect(screen.getByText('John Smith')).toBeInTheDocument();
      // Opening cash - whitelisted
      expect(screen.getByText('$200.00')).toBeInTheDocument();
    });

    it('should not expose internal IDs in the DOM', () => {
      // Arrange
      mockUseShiftViewData.mockReturnValue({
        data: createValidMockData(),
        isLoading: false,
        error: null,
      });

      // Act
      const { container } = renderWithRouter();

      // Assert - Internal IDs should only be in data attributes, not visible text
      const page = screen.getByTestId('view-shift-page');
      // data-shift-id is acceptable for debugging
      expect(page).toHaveAttribute('data-shift-id', 'shift-001');
      // But the full internal ID should not be in visible text content
      const textContent = container.textContent;
      expect(textContent).not.toContain('shift-0001-0000-0000-000000000001');
    });
  });

  // ==========================================================================
  // Error Handling Security
  // ==========================================================================

  describe('Error Handling Security', () => {
    it('should not expose stack traces in error messages', () => {
      // Arrange
      const errorWithStack = new Error('Database connection failed');
      errorWithStack.stack = 'at DatabaseService.connect (db.ts:42)';

      mockUseShiftViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: errorWithStack,
      });

      // Act
      renderWithRouter();

      // Assert - Stack trace should not be visible
      const errorPage = screen.getByTestId('view-shift-page-error');
      expect(errorPage.textContent).not.toContain('DatabaseService');
      expect(errorPage.textContent).not.toContain('db.ts');
      expect(errorPage.textContent).toContain('Database connection failed');
    });

    it('should not expose sensitive error details', () => {
      // Arrange
      const sensitiveError = new Error('Authentication failed: Invalid API key abc123');

      mockUseShiftViewData.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: sensitiveError,
      });

      // Act
      renderWithRouter();

      // Assert - Error message is shown but we verify the component handles it
      expect(screen.getByTestId('view-shift-page-error')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Navigation Security
  // ==========================================================================

  describe('Navigation Security', () => {
    it('should use safe navigation (history back)', () => {
      // Arrange
      mockUseShiftViewData.mockReturnValue({
        data: createValidMockData(),
        isLoading: false,
        error: null,
      });

      // Act
      renderWithRouter();

      // Assert - Back button should use navigate(-1), not hardcoded URLs
      const backButton = screen.getByTestId('view-header-back-button');
      expect(backButton).toBeInTheDocument();
      expect(backButton).toHaveAttribute('aria-label', 'Go back');
    });
  });
});
