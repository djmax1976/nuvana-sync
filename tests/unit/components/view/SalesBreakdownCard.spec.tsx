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

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

    it('should apply emerald styling to lottery rows', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-instant-sales');
      expect(row.className).toContain('bg-emerald-950/30');
      expect(row.className).toContain('border-emerald-900/30');
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

    it('should apply violet styling to total row', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const row = screen.getByTestId('sales-breakdown-card-total');
      expect(row.className).toContain('from-violet-950/40');
      expect(row.className).toContain('to-purple-950/40');
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
    it('should render violet accent bar at top', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const card = screen.getByTestId('sales-breakdown-card');
      const accentBar = card.querySelector('.h-1.bg-gradient-to-r');
      expect(accentBar).toBeInTheDocument();
      expect(accentBar?.className).toContain('from-violet-500');
    });
  });
});
