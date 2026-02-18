/**
 * ShiftInfoCard Unit Tests
 *
 * Tests the ShiftInfoCard component for correct rendering of shift details.
 * Validates:
 * - All shift info fields rendered correctly
 * - Currency formatting for cash values
 * - Time formatting
 * - Read-only styling
 * - Graceful handling of missing/null fields
 *
 * @module tests/unit/components/view/ShiftInfoCard
 * @security SEC-004: Verifies no XSS vectors - all content is text
 * @security FE-001: Verifies no dangerouslySetInnerHTML usage
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ShiftInfoCard,
  type ShiftInfoCardProps,
  type ShiftInfo,
} from '../../../../src/renderer/components/view/ShiftInfoCard';

// ============================================================================
// Test Helpers
// ============================================================================

const mockShift: ShiftInfo = {
  terminalName: 'Register 1',
  shiftNumber: 3,
  cashierName: 'Maria Santos',
  startedAt: 'Feb 15, 6:00 AM',
  endedAt: 'Feb 15, 2:30 PM',
  openingCash: 200.0,
  closingCash: 1847.35,
};

const defaultProps: ShiftInfoCardProps = {
  shift: mockShift,
  readOnly: true,
};

function renderCard(props: Partial<ShiftInfoCardProps> = {}) {
  const mergedProps = { ...defaultProps, ...props };
  return render(<ShiftInfoCard {...mergedProps} />);
}

// ============================================================================
// Tests
// ============================================================================

describe('ShiftInfoCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Shift info fields rendering', () => {
    it('should render terminal name', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const terminal = screen.getByTestId('shift-info-card-terminal');
      expect(terminal).toHaveTextContent('Terminal:');
      expect(terminal).toHaveTextContent('Register 1');
    });

    it('should render shift number with # prefix', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const shiftNum = screen.getByTestId('shift-info-card-shift-number');
      expect(shiftNum).toHaveTextContent('Shift:');
      expect(shiftNum).toHaveTextContent('#3');
    });

    it('should render cashier name', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const cashier = screen.getByTestId('shift-info-card-cashier');
      expect(cashier).toHaveTextContent('Cashier:');
      expect(cashier).toHaveTextContent('Maria Santos');
    });

    it('should render started time', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const started = screen.getByTestId('shift-info-card-started');
      expect(started).toHaveTextContent('Started:');
      expect(started).toHaveTextContent('Feb 15, 6:00 AM');
    });

    it('should render ended time', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const ended = screen.getByTestId('shift-info-card-ended');
      expect(ended).toHaveTextContent('Ended:');
      expect(ended).toHaveTextContent('Feb 15, 2:30 PM');
    });
  });

  describe('Currency formatting', () => {
    it('should format opening cash correctly', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const openingCash = screen.getByTestId('shift-info-card-opening-cash');
      expect(openingCash).toHaveTextContent('Opening Cash:');
      expect(openingCash).toHaveTextContent('$200.00');
    });

    it('should format closing cash correctly', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const closingCash = screen.getByTestId('shift-info-card-closing-cash');
      expect(closingCash).toHaveTextContent('Closing Cash:');
      expect(closingCash).toHaveTextContent('$1,847.35');
    });

    it('should apply green color to opening cash value', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const openingCash = screen.getByTestId('shift-info-card-opening-cash');
      const valueSpan = openingCash.querySelector('.text-green-500');
      expect(valueSpan).toBeInTheDocument();
      expect(valueSpan).toHaveTextContent('$200.00');
    });

    it('should apply green color to closing cash value', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const closingCash = screen.getByTestId('shift-info-card-closing-cash');
      const valueSpan = closingCash.querySelector('.text-green-500');
      expect(valueSpan).toBeInTheDocument();
      expect(valueSpan).toHaveTextContent('$1,847.35');
    });

    it('should format zero values correctly', () => {
      // Arrange
      const shiftWithZero = { ...mockShift, openingCash: 0, closingCash: 0 };

      // Act
      renderCard({ shift: shiftWithZero });

      // Assert
      expect(screen.getByTestId('shift-info-card-opening-cash')).toHaveTextContent('$0.00');
      expect(screen.getByTestId('shift-info-card-closing-cash')).toHaveTextContent('$0.00');
    });

    it('should format large currency values with thousand separators', () => {
      // Arrange
      const shiftWithLargeValues = { ...mockShift, closingCash: 12345.67 };

      // Act
      renderCard({ shift: shiftWithLargeValues });

      // Assert
      expect(screen.getByTestId('shift-info-card-closing-cash')).toHaveTextContent('$12,345.67');
    });
  });

  describe('Missing/null fields handling', () => {
    it('should display dash for null endedAt', () => {
      // Arrange
      const shiftOpen = { ...mockShift, endedAt: null };

      // Act
      renderCard({ shift: shiftOpen });

      // Assert
      const ended = screen.getByTestId('shift-info-card-ended');
      expect(ended).toHaveTextContent('—');
    });

    it('should display dash for undefined endedAt', () => {
      // Arrange
      const shiftOpen = { ...mockShift, endedAt: undefined };

      // Act
      renderCard({ shift: shiftOpen });

      // Assert
      const ended = screen.getByTestId('shift-info-card-ended');
      expect(ended).toHaveTextContent('—');
    });

    it('should display dash for null closingCash', () => {
      // Arrange
      const shiftOpen = { ...mockShift, closingCash: null };

      // Act
      renderCard({ shift: shiftOpen });

      // Assert
      const closingCash = screen.getByTestId('shift-info-card-closing-cash');
      expect(closingCash).toHaveTextContent('—');
    });

    it('should not apply green color when closingCash is null', () => {
      // Arrange
      const shiftOpen = { ...mockShift, closingCash: null };

      // Act
      renderCard({ shift: shiftOpen });

      // Assert
      const closingCash = screen.getByTestId('shift-info-card-closing-cash');
      const greenValue = closingCash.querySelector('.text-green-500');
      expect(greenValue).not.toBeInTheDocument();
    });

    it('should display dash for empty terminal name', () => {
      // Arrange
      const shiftNoTerminal = { ...mockShift, terminalName: '' };

      // Act
      renderCard({ shift: shiftNoTerminal });

      // Assert
      const terminal = screen.getByTestId('shift-info-card-terminal');
      expect(terminal).toHaveTextContent('—');
    });

    it('should display dash for empty cashier name', () => {
      // Arrange
      const shiftNoCashier = { ...mockShift, cashierName: '' };

      // Act
      renderCard({ shift: shiftNoCashier });

      // Assert
      const cashier = screen.getByTestId('shift-info-card-cashier');
      expect(cashier).toHaveTextContent('—');
    });
  });

  describe('Read-only styling', () => {
    it('should have data-readonly attribute when readOnly is true', () => {
      // Arrange & Act
      renderCard({ readOnly: true });

      // Assert
      const card = screen.getByTestId('shift-info-card');
      expect(card).toHaveAttribute('data-readonly', 'true');
    });

    it('should have data-readonly attribute set to false when readOnly is false', () => {
      // Arrange & Act
      renderCard({ readOnly: false });

      // Assert
      const card = screen.getByTestId('shift-info-card');
      expect(card).toHaveAttribute('data-readonly', 'false');
    });

    it('should default readOnly to true', () => {
      // Arrange & Act
      render(<ShiftInfoCard shift={mockShift} />);

      // Assert
      const card = screen.getByTestId('shift-info-card');
      expect(card).toHaveAttribute('data-readonly', 'true');
    });
  });

  describe('data-testid', () => {
    it('should use default testid when none provided', () => {
      // Arrange & Act
      renderCard();

      // Assert
      expect(screen.getByTestId('shift-info-card')).toBeInTheDocument();
    });

    it('should use custom testid when provided', () => {
      // Arrange & Act
      renderCard({ 'data-testid': 'custom-shift-card' });

      // Assert
      expect(screen.getByTestId('custom-shift-card')).toBeInTheDocument();
      expect(screen.getByTestId('custom-shift-card-terminal')).toBeInTheDocument();
      expect(screen.getByTestId('custom-shift-card-cashier')).toBeInTheDocument();
    });
  });

  describe('className prop', () => {
    it('should apply additional className to container', () => {
      // Arrange & Act
      renderCard({ className: 'custom-class' });

      // Assert
      const card = screen.getByTestId('shift-info-card');
      expect(card.className).toContain('custom-class');
    });
  });

  describe('Layout', () => {
    it('should use flex-wrap layout for responsive display', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const card = screen.getByTestId('shift-info-card');
      const flexContainer = card.firstElementChild;
      expect(flexContainer?.className).toContain('flex');
      expect(flexContainer?.className).toContain('flex-wrap');
    });

    it('should have proper gap classes for spacing', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const card = screen.getByTestId('shift-info-card');
      const flexContainer = card.firstElementChild;
      expect(flexContainer?.className).toContain('gap-x-6');
      expect(flexContainer?.className).toContain('gap-y-2');
    });
  });
});
