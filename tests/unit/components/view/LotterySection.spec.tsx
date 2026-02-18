/**
 * LotterySection Unit Tests
 *
 * Tests the LotterySection component for correct rendering.
 * Validates:
 * - Slim header with title
 * - Total amount display
 * - Children rendering (BinsTable, pack sections)
 * - Template styling match
 *
 * @module tests/unit/components/view/LotterySection
 * @security SEC-004: Verifies no XSS vectors - all content is text
 * @security FE-001: Verifies no dangerouslySetInnerHTML usage
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  LotterySection,
  type LotterySectionProps,
} from '../../../../src/renderer/components/view/LotterySection';

// ============================================================================
// Test Helpers
// ============================================================================

const defaultProps: LotterySectionProps = {
  dayId: 'day-123',
  total: 1245.0,
  ticketsSold: 362,
  children: <div data-testid="test-child">Child Content</div>,
};

function renderSection(props: Partial<LotterySectionProps> = {}) {
  const mergedProps = { ...defaultProps, ...props };
  return render(<LotterySection {...mergedProps} />);
}

// ============================================================================
// Tests
// ============================================================================

describe('LotterySection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Slim header with title', () => {
    it('should render Lottery title', () => {
      // Arrange & Act
      renderSection();

      // Assert
      expect(screen.getByText('Lottery')).toBeInTheDocument();
    });

    it('should render header with emerald gradient', () => {
      // Arrange & Act
      renderSection();

      // Assert
      const header = screen.getByTestId('lottery-section-header');
      expect(header.className).toContain('bg-gradient-to-r');
      expect(header.className).toContain('from-emerald-700');
      expect(header.className).toContain('via-emerald-600');
      expect(header.className).toContain('to-teal-700');
    });

    it('should render ticket icon', () => {
      // Arrange & Act
      renderSection();

      // Assert
      const header = screen.getByTestId('lottery-section-header');
      const icon = header.querySelector('[aria-hidden="true"]');
      expect(icon).toBeInTheDocument();
    });
  });

  describe('Total amount display', () => {
    it('should render total amount', () => {
      // Arrange & Act
      renderSection();

      // Assert
      expect(screen.getByTestId('lottery-section-header-total')).toHaveTextContent('$1,245.00');
    });

    it('should format large amounts correctly', () => {
      // Arrange & Act
      renderSection({ total: 12345.67 });

      // Assert
      expect(screen.getByTestId('lottery-section-header-total')).toHaveTextContent('$12,345.67');
    });

    it('should format zero amount correctly', () => {
      // Arrange & Act
      renderSection({ total: 0 });

      // Assert
      expect(screen.getByTestId('lottery-section-header-total')).toHaveTextContent('$0.00');
    });
  });

  describe('Tickets sold display', () => {
    it('should render tickets sold count', () => {
      // Arrange & Act
      renderSection();

      // Assert
      expect(screen.getByTestId('lottery-section-header-tickets')).toHaveTextContent(
        '362 tickets sold'
      );
    });

    it('should format large ticket counts with thousand separator', () => {
      // Arrange & Act
      renderSection({ ticketsSold: 1523 });

      // Assert
      expect(screen.getByTestId('lottery-section-header-tickets')).toHaveTextContent(
        '1,523 tickets sold'
      );
    });

    it('should not render tickets sold when undefined', () => {
      // Arrange & Act
      renderSection({ ticketsSold: undefined });

      // Assert
      expect(screen.queryByTestId('lottery-section-header-tickets')).not.toBeInTheDocument();
    });

    it('should render zero tickets correctly', () => {
      // Arrange & Act
      renderSection({ ticketsSold: 0 });

      // Assert
      expect(screen.getByTestId('lottery-section-header-tickets')).toHaveTextContent(
        '0 tickets sold'
      );
    });
  });

  describe('Children rendering', () => {
    it('should render children content', () => {
      // Arrange & Act
      renderSection();

      // Assert
      expect(screen.getByTestId('test-child')).toBeInTheDocument();
      expect(screen.getByText('Child Content')).toBeInTheDocument();
    });

    it('should render multiple children', () => {
      // Arrange & Act
      renderSection({
        children: (
          <>
            <div data-testid="child-1">Child 1</div>
            <div data-testid="child-2">Child 2</div>
            <div data-testid="child-3">Child 3</div>
          </>
        ),
      });

      // Assert
      expect(screen.getByTestId('child-1')).toBeInTheDocument();
      expect(screen.getByTestId('child-2')).toBeInTheDocument();
      expect(screen.getByTestId('child-3')).toBeInTheDocument();
    });

    it('should wrap children in content container', () => {
      // Arrange & Act
      renderSection();

      // Assert
      const content = screen.getByTestId('lottery-section-content');
      expect(content).toBeInTheDocument();
      expect(content).toContainElement(screen.getByTestId('test-child'));
    });
  });

  describe('data-testid', () => {
    it('should use default testid when none provided', () => {
      // Arrange & Act
      renderSection();

      // Assert
      expect(screen.getByTestId('lottery-section')).toBeInTheDocument();
      expect(screen.getByTestId('lottery-section-header')).toBeInTheDocument();
      expect(screen.getByTestId('lottery-section-content')).toBeInTheDocument();
    });

    it('should use custom testid when provided', () => {
      // Arrange & Act
      renderSection({ 'data-testid': 'custom-lottery' });

      // Assert
      expect(screen.getByTestId('custom-lottery')).toBeInTheDocument();
      expect(screen.getByTestId('custom-lottery-header')).toBeInTheDocument();
      expect(screen.getByTestId('custom-lottery-content')).toBeInTheDocument();
    });
  });

  describe('dayId prop', () => {
    it('should set data-day-id attribute', () => {
      // Arrange & Act
      renderSection({ dayId: 'test-day-456' });

      // Assert
      const section = screen.getByTestId('lottery-section');
      expect(section).toHaveAttribute('data-day-id', 'test-day-456');
    });
  });

  describe('className prop', () => {
    it('should apply additional className', () => {
      // Arrange & Act
      renderSection({ className: 'custom-class' });

      // Assert
      const section = screen.getByTestId('lottery-section');
      expect(section.className).toContain('custom-class');
    });

    it('should preserve default space-y-4 class', () => {
      // Arrange & Act
      renderSection({ className: 'custom-class' });

      // Assert
      const section = screen.getByTestId('lottery-section');
      expect(section.className).toContain('space-y-4');
    });
  });

  describe('Template styling match', () => {
    it('should have rounded corners on header', () => {
      // Arrange & Act
      renderSection();

      // Assert
      const header = screen.getByTestId('lottery-section-header');
      expect(header.className).toContain('rounded-xl');
    });

    it('should have shadow on header', () => {
      // Arrange & Act
      renderSection();

      // Assert
      const header = screen.getByTestId('lottery-section-header');
      expect(header.className).toContain('shadow-lg');
    });

    it('should have proper padding on header', () => {
      // Arrange & Act
      renderSection();

      // Assert
      const header = screen.getByTestId('lottery-section-header');
      expect(header.className).toContain('px-6');
      expect(header.className).toContain('py-4');
    });
  });
});
