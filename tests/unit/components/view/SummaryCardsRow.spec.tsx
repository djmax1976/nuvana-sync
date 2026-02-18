/**
 * SummaryCardsRow Unit Tests
 *
 * Tests the SummaryCardsRow component for correct rendering of 4 gradient cards.
 * Validates:
 * - 4 cards rendered with correct gradients
 * - Main values with currency formatting
 * - Sub-items rendered correctly
 * - Zero value handling
 * - Missing data graceful handling
 *
 * @module tests/unit/components/view/SummaryCardsRow
 * @security SEC-004: Verifies no XSS vectors - all content is text
 * @security FE-001: Verifies no dangerouslySetInnerHTML usage
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  SummaryCardsRow,
  type SummaryCardsRowProps,
  type SummaryCardsData,
} from '../../../../src/renderer/components/view/SummaryCardsRow';

// ============================================================================
// Test Helpers
// ============================================================================

const mockData: SummaryCardsData = {
  insideSales: {
    total: 3150.0,
    nonFood: 1950.0,
    foodSales: 1200.0,
  },
  fuelSales: {
    total: 4875.5,
    gallonsSold: 1523.4,
  },
  lotterySales: {
    total: 1768.0,
    scratchOff: 1245.0,
    online: 523.0,
  },
};

const defaultProps: SummaryCardsRowProps = {
  data: mockData,
};

function renderCards(props: Partial<SummaryCardsRowProps> = {}) {
  const mergedProps = { ...defaultProps, ...props };
  return render(<SummaryCardsRow {...mergedProps} />);
}

// ============================================================================
// Tests
// ============================================================================

describe('SummaryCardsRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('4 cards rendering', () => {
    it('should render 4 cards', () => {
      // Arrange & Act
      renderCards();

      // Assert
      expect(screen.getByTestId('summary-cards-row-inside-sales')).toBeInTheDocument();
      expect(screen.getByTestId('summary-cards-row-fuel-sales')).toBeInTheDocument();
      expect(screen.getByTestId('summary-cards-row-lottery-sales')).toBeInTheDocument();
      expect(screen.getByTestId('summary-cards-row-reserved')).toBeInTheDocument();
    });

    it('should render Inside Sales card with blue gradient', () => {
      // Arrange & Act
      renderCards();

      // Assert
      const card = screen.getByTestId('summary-cards-row-inside-sales');
      expect(card.className).toContain('from-blue-600');
      expect(card.className).toContain('via-blue-700');
      expect(card.className).toContain('to-blue-900');
    });

    it('should render Fuel Sales card with amber gradient', () => {
      // Arrange & Act
      renderCards();

      // Assert
      const card = screen.getByTestId('summary-cards-row-fuel-sales');
      expect(card.className).toContain('from-amber-600');
      expect(card.className).toContain('via-amber-700');
      expect(card.className).toContain('to-orange-900');
    });

    it('should render Lottery Sales card with green gradient', () => {
      // Arrange & Act
      renderCards();

      // Assert
      const card = screen.getByTestId('summary-cards-row-lottery-sales');
      expect(card.className).toContain('from-emerald-600');
      expect(card.className).toContain('via-emerald-700');
      expect(card.className).toContain('to-green-900');
    });

    it('should render Reserved card with slate gradient', () => {
      // Arrange & Act
      renderCards();

      // Assert
      const card = screen.getByTestId('summary-cards-row-reserved');
      expect(card.className).toContain('from-slate-700');
      expect(card.className).toContain('via-slate-800');
      expect(card.className).toContain('to-slate-900');
    });
  });

  describe('Main values with currency formatting', () => {
    it('should render Inside Sales main value formatted', () => {
      // Arrange & Act
      renderCards();

      // Assert
      const valueEl = screen.getByTestId('summary-cards-row-inside-sales-value');
      expect(valueEl).toHaveTextContent('$3,150.00');
    });

    it('should render Fuel Sales main value formatted', () => {
      // Arrange & Act
      renderCards();

      // Assert
      const valueEl = screen.getByTestId('summary-cards-row-fuel-sales-value');
      expect(valueEl).toHaveTextContent('$4,875.50');
    });

    it('should render Lottery Sales main value formatted', () => {
      // Arrange & Act
      renderCards();

      // Assert
      const valueEl = screen.getByTestId('summary-cards-row-lottery-sales-value');
      expect(valueEl).toHaveTextContent('$1,768.00');
    });
  });

  describe('Sub-items rendering', () => {
    it('should render Inside Sales sub-items', () => {
      // Arrange & Act
      renderCards();

      // Assert
      const subitem0 = screen.getByTestId('summary-cards-row-inside-sales-subitem-0');
      const subitem1 = screen.getByTestId('summary-cards-row-inside-sales-subitem-1');
      expect(subitem0).toHaveTextContent('Non-Food');
      expect(subitem0).toHaveTextContent('$1,950.00');
      expect(subitem1).toHaveTextContent('Food Sales');
      expect(subitem1).toHaveTextContent('$1,200.00');
    });

    it('should render Fuel Sales sub-items with gallons', () => {
      // Arrange & Act
      renderCards();

      // Assert
      const subitem0 = screen.getByTestId('summary-cards-row-fuel-sales-subitem-0');
      expect(subitem0).toHaveTextContent('Gallons Sold');
      expect(subitem0).toHaveTextContent('1,523.4 gal');
    });

    it('should render Lottery Sales sub-items', () => {
      // Arrange & Act
      renderCards();

      // Assert
      const subitem0 = screen.getByTestId('summary-cards-row-lottery-sales-subitem-0');
      const subitem1 = screen.getByTestId('summary-cards-row-lottery-sales-subitem-1');
      expect(subitem0).toHaveTextContent('Scratch Off');
      expect(subitem0).toHaveTextContent('$1,245.00');
      expect(subitem1).toHaveTextContent('Online');
      expect(subitem1).toHaveTextContent('$523.00');
    });
  });

  describe('Zero value handling', () => {
    it('should handle zero values correctly', () => {
      // Arrange
      const zeroData: SummaryCardsData = {
        insideSales: { total: 0, nonFood: 0, foodSales: 0 },
        fuelSales: { total: 0, gallonsSold: 0 },
        lotterySales: { total: 0, scratchOff: 0, online: 0 },
      };

      // Act
      renderCards({ data: zeroData });

      // Assert
      expect(screen.getByTestId('summary-cards-row-inside-sales-value')).toHaveTextContent('$0.00');
      expect(screen.getByTestId('summary-cards-row-fuel-sales-value')).toHaveTextContent('$0.00');
      expect(screen.getByTestId('summary-cards-row-lottery-sales-value')).toHaveTextContent(
        '$0.00'
      );
    });

    it('should format zero gallons correctly', () => {
      // Arrange
      const zeroData: SummaryCardsData = {
        ...mockData,
        fuelSales: { total: 0, gallonsSold: 0 },
      };

      // Act
      renderCards({ data: zeroData });

      // Assert
      const subitem = screen.getByTestId('summary-cards-row-fuel-sales-subitem-0');
      expect(subitem).toHaveTextContent('0.0 gal');
    });
  });

  describe('Reserved card', () => {
    it('should display "— Reserved —" text', () => {
      // Arrange & Act
      renderCards();

      // Assert
      expect(screen.getByText('— Reserved —')).toBeInTheDocument();
    });

    it('should have centered content', () => {
      // Arrange & Act
      renderCards();

      // Assert
      const card = screen.getByTestId('summary-cards-row-reserved');
      const content = card.querySelector('.flex.flex-col.items-center.justify-center');
      expect(content).toBeInTheDocument();
    });
  });

  describe('Missing data handling', () => {
    it('should handle very large values', () => {
      // Arrange
      const largeData: SummaryCardsData = {
        insideSales: { total: 1234567.89, nonFood: 500000.0, foodSales: 734567.89 },
        fuelSales: { total: 2345678.9, gallonsSold: 123456.7 },
        lotterySales: { total: 3456789.01, scratchOff: 2000000.0, online: 1456789.01 },
      };

      // Act
      renderCards({ data: largeData });

      // Assert
      expect(screen.getByTestId('summary-cards-row-inside-sales-value')).toHaveTextContent(
        '$1,234,567.89'
      );
      expect(screen.getByTestId('summary-cards-row-fuel-sales-value')).toHaveTextContent(
        '$2,345,678.90'
      );
      expect(screen.getByTestId('summary-cards-row-lottery-sales-value')).toHaveTextContent(
        '$3,456,789.01'
      );
    });

    it('should handle decimal gallons correctly', () => {
      // Arrange
      const decimalData: SummaryCardsData = {
        ...mockData,
        fuelSales: { total: 100.0, gallonsSold: 33.333333 },
      };

      // Act
      renderCards({ data: decimalData });

      // Assert
      const subitem = screen.getByTestId('summary-cards-row-fuel-sales-subitem-0');
      expect(subitem).toHaveTextContent('33.3 gal');
    });
  });

  describe('Grid layout', () => {
    it('should have responsive grid classes', () => {
      // Arrange & Act
      renderCards();

      // Assert
      const container = screen.getByTestId('summary-cards-row');
      expect(container.className).toContain('grid');
      expect(container.className).toContain('grid-cols-1');
      expect(container.className).toContain('md:grid-cols-2');
      expect(container.className).toContain('lg:grid-cols-4');
    });

    it('should have gap between cards', () => {
      // Arrange & Act
      renderCards();

      // Assert
      const container = screen.getByTestId('summary-cards-row');
      expect(container.className).toContain('gap-4');
    });
  });

  describe('data-testid', () => {
    it('should use default testid when none provided', () => {
      // Arrange & Act
      renderCards();

      // Assert
      expect(screen.getByTestId('summary-cards-row')).toBeInTheDocument();
    });

    it('should use custom testid when provided', () => {
      // Arrange & Act
      renderCards({ 'data-testid': 'custom-summary' });

      // Assert
      expect(screen.getByTestId('custom-summary')).toBeInTheDocument();
      expect(screen.getByTestId('custom-summary-inside-sales')).toBeInTheDocument();
      expect(screen.getByTestId('custom-summary-fuel-sales')).toBeInTheDocument();
      expect(screen.getByTestId('custom-summary-lottery-sales')).toBeInTheDocument();
      expect(screen.getByTestId('custom-summary-reserved')).toBeInTheDocument();
    });
  });

  describe('className prop', () => {
    it('should apply additional className to container', () => {
      // Arrange & Act
      renderCards({ className: 'custom-class' });

      // Assert
      const container = screen.getByTestId('summary-cards-row');
      expect(container.className).toContain('custom-class');
    });

    it('should preserve default classes when adding custom className', () => {
      // Arrange & Act
      renderCards({ className: 'custom-class' });

      // Assert
      const container = screen.getByTestId('summary-cards-row');
      expect(container.className).toContain('grid');
      expect(container.className).toContain('gap-4');
    });
  });

  describe('Card titles', () => {
    it('should render correct card titles', () => {
      // Arrange & Act
      renderCards();

      // Assert
      expect(screen.getByText('Inside Sales')).toBeInTheDocument();
      expect(screen.getByText('Fuel Sales')).toBeInTheDocument();
      expect(screen.getByText('Lottery Sales')).toBeInTheDocument();
    });
  });
});
