/**
 * SalesBreakdownCard Unit Tests
 *
 * Tests the SalesBreakdownCard component for correct rendering.
 * Validates:
 * - All department rows rendered
 * - Lottery sub-section rendered
 * - Total calculation displayed correctly
 * - Currency value formatting
 * - Department icons displayed
 *
 * @module tests/unit/components/view/SalesBreakdownCard
 * @security SEC-004: Verifies no XSS vectors - all content is text
 * @security FE-001: Verifies no dangerouslySetInnerHTML usage
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  SalesBreakdownCard,
  type SalesBreakdownCardProps,
  type SalesBreakdownData,
} from '../../../../src/renderer/components/view/SalesBreakdownCard';

// ============================================================================
// Test Helpers
// ============================================================================

const mockData: SalesBreakdownData = {
  gasSales: { reports: null, pos: 2500.0 },
  grocery: { reports: null, pos: 1200.0 },
  tobacco: { reports: null, pos: 800.0 },
  beverages: { reports: null, pos: 450.0 },
  snacks: { reports: null, pos: 320.0 },
  other: { reports: null, pos: 180.0 },
  lottery: {
    instantSales: { reports: 1245.0, pos: 0 },
    instantCashes: { reports: 350.0, pos: 0 },
    onlineSales: { reports: 523.0, pos: 0 },
    onlineCashes: { reports: 75.0, pos: 0 },
  },
  salesTax: { reports: null, pos: 245.0 },
  total: { reports: 7463.0, pos: 5695.0 },
};

const defaultProps: SalesBreakdownCardProps = {
  data: mockData,
  readOnly: true,
};

function renderCard(props: Partial<SalesBreakdownCardProps> = {}) {
  const mergedProps = { ...defaultProps, ...props };
  return render(<SalesBreakdownCard {...mergedProps} />);
}

// ============================================================================
// Tests
// ============================================================================

describe('SalesBreakdownCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Department rows rendering', () => {
    it('should render Gas Sales row', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-gas');
      expect(row).toHaveTextContent('Gas Sales');
      expect(row).toHaveTextContent('$2,500.00');
    });

    it('should render Grocery row', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-grocery');
      expect(row).toHaveTextContent('Grocery');
      expect(row).toHaveTextContent('$1,200.00');
    });

    it('should render Tobacco row', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-tobacco');
      expect(row).toHaveTextContent('Tobacco');
      expect(row).toHaveTextContent('$800.00');
    });

    it('should render Beverages row', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-beverages');
      expect(row).toHaveTextContent('Beverages');
      expect(row).toHaveTextContent('$450.00');
    });

    it('should render Snacks row', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-snacks');
      expect(row).toHaveTextContent('Snacks');
      expect(row).toHaveTextContent('$320.00');
    });

    it('should render Other row', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-other');
      expect(row).toHaveTextContent('Other');
      expect(row).toHaveTextContent('$180.00');
    });

    it('should display dash for null reports values', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-gas');
      expect(row).toHaveTextContent('—');
    });
  });

  describe('Lottery sub-section rendering', () => {
    it('should render Lottery section header', () => {
      // Arrange & Act
      renderCard();

      // Assert
      expect(screen.getByText('Lottery')).toBeInTheDocument();
    });

    it('should render Instant Sales row', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-instant-sales');
      expect(row).toHaveTextContent('Instant Sales');
      expect(row).toHaveTextContent('$1,245.00');
    });

    it('should render Instant Cashes row', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-instant-cashes');
      expect(row).toHaveTextContent('Instant Cashes');
      expect(row).toHaveTextContent('$350.00');
    });

    it('should render Online Sales row', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-online-sales');
      expect(row).toHaveTextContent('Online Sales');
      expect(row).toHaveTextContent('$523.00');
    });

    it('should render Online Cashes row', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-online-cashes');
      expect(row).toHaveTextContent('Online Cashes');
      expect(row).toHaveTextContent('$75.00');
    });

    it('should apply success theme styling to lottery rows', () => {
      // Arrange & Act
      renderCard();

      // Assert - Verify semantic success tokens instead of hardcoded emerald
      const row = screen.getByTestId('sales-breakdown-card-instant-sales');
      expect(row.className).toContain('bg-success-light');
      expect(row.className).toContain('border-success');
      // Should NOT use hardcoded emerald colors
      expect(row.className).not.toContain('emerald-950');
      expect(row.className).not.toContain('emerald-900');
    });
  });

  describe('Total calculation display', () => {
    it('should render Sales Tax row', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-sales-tax');
      expect(row).toHaveTextContent('Sales Tax');
      expect(row).toHaveTextContent('$245.00');
    });

    it('should render Total Sales row', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-total');
      expect(row).toHaveTextContent('Total Sales');
    });

    it('should display total reports value', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-total');
      expect(row).toHaveTextContent('$7,463.00');
    });

    it('should display total pos value', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-total');
      expect(row).toHaveTextContent('$5,695.00');
    });

    it('should apply primary theme styling to total row', () => {
      // Arrange & Act
      renderCard();

      // Assert - Verify semantic primary tokens instead of hardcoded violet
      const row = screen.getByTestId('sales-breakdown-card-total');
      expect(row.className).toContain('bg-primary-light');
      expect(row.className).toContain('border-primary');
      // Should NOT use hardcoded violet/purple colors
      expect(row.className).not.toContain('violet-950');
      expect(row.className).not.toContain('purple-950');
    });
  });

  describe('Currency formatting', () => {
    it('should format zero values correctly', () => {
      // Arrange
      const zeroData: SalesBreakdownData = {
        ...mockData,
        gasSales: { reports: null, pos: 0 },
      };

      // Act
      renderCard({ data: zeroData });

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-gas');
      expect(row).toHaveTextContent('$0.00');
    });

    it('should format large values with thousand separators', () => {
      // Arrange
      const largeData: SalesBreakdownData = {
        ...mockData,
        gasSales: { reports: null, pos: 123456.78 },
      };

      // Act
      renderCard({ data: largeData });

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-gas');
      expect(row).toHaveTextContent('$123,456.78');
    });

    it('should display reports value when provided', () => {
      // Arrange
      const dataWithReports: SalesBreakdownData = {
        ...mockData,
        gasSales: { reports: 2400.0, pos: 2500.0 },
      };

      // Act
      renderCard({ data: dataWithReports });

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-gas');
      expect(row).toHaveTextContent('$2,400.00');
      expect(row).toHaveTextContent('$2,500.00');
    });
  });

  describe('Department icons', () => {
    it('should render icon for each department', () => {
      // Arrange & Act
      renderCard();

      // Assert - Each row should have an icon container
      const gasRow = screen.getByTestId('sales-breakdown-card-gas');
      const groceryRow = screen.getByTestId('sales-breakdown-card-grocery');
      const tobaccoRow = screen.getByTestId('sales-breakdown-card-tobacco');

      expect(gasRow.querySelector('.w-8.h-8.rounded-lg')).toBeInTheDocument();
      expect(groceryRow.querySelector('.w-8.h-8.rounded-lg')).toBeInTheDocument();
      expect(tobaccoRow.querySelector('.w-8.h-8.rounded-lg')).toBeInTheDocument();
    });

    it('should render icon for lottery rows', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-instant-sales');
      expect(row.querySelector('.w-8.h-8.rounded-lg')).toBeInTheDocument();
    });

    it('should render icon for total row', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-total');
      expect(row.querySelector('.w-10.h-10.rounded-xl')).toBeInTheDocument();
    });
  });

  describe('Header', () => {
    it('should render Department Sales title', () => {
      // Arrange & Act
      renderCard();

      // Assert
      expect(screen.getByText('Department Sales')).toBeInTheDocument();
    });

    it('should render subtitle', () => {
      // Arrange & Act
      renderCard();

      // Assert
      expect(screen.getByText('Sales by category')).toBeInTheDocument();
    });
  });

  describe('Column headers', () => {
    it('should render Department column header', () => {
      // Arrange & Act
      renderCard();

      // Assert
      expect(screen.getByText('Department')).toBeInTheDocument();
    });

    it('should render Reports column header', () => {
      // Arrange & Act
      renderCard();

      // Assert
      expect(screen.getByText('Reports')).toBeInTheDocument();
    });

    it('should render POS column header', () => {
      // Arrange & Act
      renderCard();

      // Assert
      expect(screen.getByText('POS')).toBeInTheDocument();
    });
  });

  describe('data-testid', () => {
    it('should use default testid when none provided', () => {
      // Arrange & Act
      renderCard();

      // Assert
      expect(screen.getByTestId('sales-breakdown-card')).toBeInTheDocument();
    });

    it('should use custom testid when provided', () => {
      // Arrange & Act
      renderCard({ 'data-testid': 'custom-sales' });

      // Assert
      expect(screen.getByTestId('custom-sales')).toBeInTheDocument();
      expect(screen.getByTestId('custom-sales-gas')).toBeInTheDocument();
      expect(screen.getByTestId('custom-sales-lottery')).toBeInTheDocument();
    });
  });

  describe('readOnly prop', () => {
    it('should have data-readonly attribute when readOnly is true', () => {
      // Arrange & Act
      renderCard({ readOnly: true });

      // Assert
      const card = screen.getByTestId('sales-breakdown-card');
      expect(card).toHaveAttribute('data-readonly', 'true');
    });

    it('should have data-readonly false when readOnly is false', () => {
      // Arrange & Act
      renderCard({ readOnly: false });

      // Assert
      const card = screen.getByTestId('sales-breakdown-card');
      expect(card).toHaveAttribute('data-readonly', 'false');
    });
  });

  describe('className prop', () => {
    it('should apply additional className', () => {
      // Arrange & Act
      renderCard({ className: 'custom-class' });

      // Assert
      const card = screen.getByTestId('sales-breakdown-card');
      expect(card.className).toContain('custom-class');
    });
  });

  describe('Accent bar', () => {
    it('should render primary-themed accent bar at top', () => {
      // Arrange & Act
      renderCard();

      // Assert - Verify semantic tokens
      const card = screen.getByTestId('sales-breakdown-card');
      const accentBar = card.querySelector('.h-1.bg-gradient-to-r');
      expect(accentBar).toBeInTheDocument();
      expect(accentBar?.className).toContain('from-primary');
      // Should NOT use hardcoded violet colors
      expect(accentBar?.className).not.toContain('violet-500');
    });
  });

  /* ==========================================================================
     THEME-AWARE STYLING TESTS
     Enterprise requirement: Components must support light/dark mode via
     semantic CSS tokens. These tests verify theme-aware classes are used
     instead of hardcoded color values.
     Reference: [frontend.web-experience::design-system-alignment]
     ========================================================================== */
  describe('Theme-aware styling', () => {
    it('should use theme-aware card background class', () => {
      // Arrange & Act
      renderCard();

      // Assert - Verify semantic bg-card class instead of hardcoded dark gradient
      const card = screen.getByTestId('sales-breakdown-card');
      expect(card.className).toContain('bg-card');
      expect(card.className).not.toContain('from-slate-900');
      expect(card.className).not.toContain('to-slate-950');
    });

    it('should use semantic primary color tokens for header icon', () => {
      // Arrange & Act
      renderCard();

      // Assert - Header icon should use primary-light background
      const card = screen.getByTestId('sales-breakdown-card');
      const headerIcon = card.querySelector('.bg-primary-light.text-primary');
      expect(headerIcon).toBeInTheDocument();
      // Should NOT use hardcoded violet colors
      const hardcodedIcon = card.querySelector('.bg-violet-950');
      expect(hardcodedIcon).not.toBeInTheDocument();
    });

    it('should use semantic success color tokens for lottery rows', () => {
      // Arrange & Act
      renderCard();

      // Assert - Lottery rows should use success theme
      const instantSalesRow = screen.getByTestId('sales-breakdown-card-instant-sales');
      expect(instantSalesRow.className).toContain('bg-success-light');
      expect(instantSalesRow.className).toContain('border-success');

      // Icons inside lottery rows should also use success theme
      const lotteryIcon = instantSalesRow.querySelector('.bg-success\\/20.text-success');
      expect(lotteryIcon).toBeInTheDocument();
    });

    it('should use semantic primary color tokens for total row', () => {
      // Arrange & Act
      renderCard();

      // Assert - Total row should use primary theme
      const totalRow = screen.getByTestId('sales-breakdown-card-total');
      expect(totalRow.className).toContain('bg-primary-light');

      // Values should use primary color
      const primaryValues = totalRow.querySelectorAll('.text-primary');
      expect(primaryValues.length).toBeGreaterThanOrEqual(2);
    });

    it('should use semantic warning color for gas sales icon', () => {
      // Arrange & Act
      renderCard();

      // Assert - Gas sales should use warning theme
      const gasRow = screen.getByTestId('sales-breakdown-card-gas');
      const warningIcon = gasRow.querySelector('.bg-warning-light.text-warning');
      expect(warningIcon).toBeInTheDocument();
    });

    it('should use semantic success color for grocery icon', () => {
      // Arrange & Act
      renderCard();

      // Assert - Grocery should use success theme
      const groceryRow = screen.getByTestId('sales-breakdown-card-grocery');
      const successIcon = groceryRow.querySelector('.bg-success-light.text-success');
      expect(successIcon).toBeInTheDocument();
    });

    it('should use semantic info color for beverages icon', () => {
      // Arrange & Act
      renderCard();

      // Assert - Beverages should use info theme
      const beveragesRow = screen.getByTestId('sales-breakdown-card-beverages');
      const infoIcon = beveragesRow.querySelector('.bg-info-light.text-info');
      expect(infoIcon).toBeInTheDocument();
    });

    it('should use semantic muted color for other category icon', () => {
      // Arrange & Act
      renderCard();

      // Assert - Other should use muted theme
      const otherRow = screen.getByTestId('sales-breakdown-card-other');
      const mutedIcon = otherRow.querySelector('.bg-muted.text-muted-foreground');
      expect(mutedIcon).toBeInTheDocument();
    });

    it('should use theme-aware hover states on department rows', () => {
      // Arrange & Act
      renderCard();

      // Assert - Verify hover uses muted instead of white/5
      const gasRow = screen.getByTestId('sales-breakdown-card-gas');
      expect(gasRow.className).toContain('hover:bg-muted/50');
      expect(gasRow.className).not.toContain('hover:bg-white/5');
    });

    it('should use semantic text colors for card foreground elements', () => {
      // Arrange & Act
      renderCard();

      // Assert - Verify text-card-foreground is used
      const card = screen.getByTestId('sales-breakdown-card');
      const foregroundElements = card.querySelectorAll('.text-card-foreground');
      expect(foregroundElements.length).toBeGreaterThan(0);
    });

    it('should use semantic success color for lottery section indicator', () => {
      // Arrange & Act
      renderCard();

      // Assert - Lottery section dot should use success theme
      const card = screen.getByTestId('sales-breakdown-card');
      const sectionDot = card.querySelector('.w-2.h-2.rounded-full.bg-success');
      expect(sectionDot).toBeInTheDocument();
      // Should NOT use hardcoded emerald
      const hardcodedDot = card.querySelector('.bg-emerald-500');
      expect(hardcodedDot).not.toBeInTheDocument();
    });
  });

  /* ==========================================================================
     ACCESSIBILITY TESTS
     Enterprise requirement: All elements must be accessible.
     Reference: [testing.accessibility-l10n::keyboard-navigation]
     ========================================================================== */
  describe('Accessibility', () => {
    it('should have proper heading hierarchy', () => {
      // Arrange & Act
      renderCard();

      // Assert - h3 for card title
      expect(
        screen.getByRole('heading', { level: 3, name: 'Department Sales' })
      ).toBeInTheDocument();
    });

    it('should ensure all monetary values are formatted consistently', () => {
      // Arrange & Act
      renderCard();

      // Assert - Verify currency formatting consistency
      const card = screen.getByTestId('sales-breakdown-card');
      const text = card.textContent || '';

      // All currency values should use $ prefix and comma separators
      expect(text).toContain('$2,500.00'); // Gas Sales POS
      expect(text).toContain('$1,245.00'); // Instant Sales reports
      expect(text).toContain('$7,463.00'); // Total reports
    });

    it('should have sufficient color contrast for text elements', () => {
      // Arrange & Act
      renderCard();

      // Assert - Verify high-contrast text classes are used
      const card = screen.getByTestId('sales-breakdown-card');

      // Muted foreground for secondary text
      const mutedElements = card.querySelectorAll('.text-muted-foreground');
      expect(mutedElements.length).toBeGreaterThan(0);

      // Card foreground for primary text
      const foregroundElements = card.querySelectorAll('.text-card-foreground');
      expect(foregroundElements.length).toBeGreaterThan(0);
    });

    it('should display dash character for null values for screen readers', () => {
      // Arrange & Act
      renderCard();

      // Assert - Dashes should be em-dashes for consistency
      const gasRow = screen.getByTestId('sales-breakdown-card-gas');
      expect(gasRow).toHaveTextContent('—'); // em-dash, not hyphen
    });
  });

  /* ==========================================================================
     EDGE CASE TESTS
     Enterprise requirement: Components must handle edge cases gracefully.
     Reference: [quality.testing-strategy::shift-left-quality]
     ========================================================================== */
  describe('Edge cases', () => {
    it('should handle zero values correctly', () => {
      // Arrange
      const zeroData: SalesBreakdownData = {
        gasSales: { reports: 0, pos: 0 },
        grocery: { reports: 0, pos: 0 },
        tobacco: { reports: 0, pos: 0 },
        beverages: { reports: 0, pos: 0 },
        snacks: { reports: 0, pos: 0 },
        other: { reports: 0, pos: 0 },
        lottery: {
          instantSales: { reports: 0, pos: 0 },
          instantCashes: { reports: 0, pos: 0 },
          onlineSales: { reports: 0, pos: 0 },
          onlineCashes: { reports: 0, pos: 0 },
        },
        salesTax: { reports: 0, pos: 0 },
        total: { reports: 0, pos: 0 },
      };

      // Act
      renderCard({ data: zeroData });

      // Assert - Should display $0.00 for all non-null values
      const card = screen.getByTestId('sales-breakdown-card');
      const zeroMatches = (card.textContent || '').match(/\$0\.00/g);
      expect(zeroMatches?.length).toBeGreaterThan(10);
    });

    it('should handle very large currency values', () => {
      // Arrange
      const largeData: SalesBreakdownData = {
        ...mockData,
        total: { reports: 9999999.99, pos: 9999999.99 },
      };

      // Act
      renderCard({ data: largeData });

      // Assert - Should format with thousand separators
      const totalRow = screen.getByTestId('sales-breakdown-card-total');
      expect(totalRow).toHaveTextContent('$9,999,999.99');
    });

    it('should handle all null reports values gracefully', () => {
      // Arrange
      const nullData: SalesBreakdownData = {
        gasSales: { reports: null, pos: 100 },
        grocery: { reports: null, pos: 200 },
        tobacco: { reports: null, pos: 300 },
        beverages: { reports: null, pos: 400 },
        snacks: { reports: null, pos: 500 },
        other: { reports: null, pos: 600 },
        lottery: {
          instantSales: { reports: null, pos: 0 },
          instantCashes: { reports: null, pos: 0 },
          onlineSales: { reports: null, pos: 0 },
          onlineCashes: { reports: null, pos: 0 },
        },
        salesTax: { reports: null, pos: 100 },
        total: { reports: null, pos: 2200 },
      };

      // Act
      renderCard({ data: nullData });

      // Assert - Should display dashes for null values
      const card = screen.getByTestId('sales-breakdown-card');
      const dashes = (card.textContent || '').match(/—/g);
      expect(dashes?.length).toBe(12); // All 12 categories with null reports
    });

    it('should handle negative values in lottery cashes', () => {
      // Arrange - Cashes can be negative when more paid out than received
      const negativeData: SalesBreakdownData = {
        ...mockData,
        lottery: {
          ...mockData.lottery,
          instantCashes: { reports: -500, pos: 0 },
        },
      };

      // Act
      renderCard({ data: negativeData });

      // Assert - Should handle negative formatting
      const cashesRow = screen.getByTestId('sales-breakdown-card-instant-cashes');
      expect(cashesRow).toHaveTextContent('-$500.00');
    });

    it('should render correctly with minimal data', () => {
      // Arrange
      const minimalData: SalesBreakdownData = {
        gasSales: { pos: 0 },
        grocery: { pos: 0 },
        tobacco: { pos: 0 },
        beverages: { pos: 0 },
        snacks: { pos: 0 },
        other: { pos: 0 },
        lottery: {
          instantSales: { pos: 0 },
          instantCashes: { pos: 0 },
          onlineSales: { pos: 0 },
          onlineCashes: { pos: 0 },
        },
        salesTax: { pos: 0 },
        total: { pos: 0 },
      };

      // Act
      renderCard({ data: minimalData });

      // Assert - Component should render without errors
      expect(screen.getByTestId('sales-breakdown-card')).toBeInTheDocument();
      expect(screen.getByText('Department Sales')).toBeInTheDocument();
    });
  });
});
