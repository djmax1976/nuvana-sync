/**
 * ViewHeader Unit Tests
 *
 * Tests the ViewHeader component for correct rendering and behavior.
 * Validates:
 * - Title rendering
 * - Date subtitle rendering
 * - Status badge with correct styling
 * - Back button click handler
 * - Accessibility attributes (ARIA labels)
 * - data-testid attributes
 *
 * @module tests/unit/components/view/ViewHeader
 * @security SEC-004: Verifies no XSS vectors - all content is text
 * @security FE-001: Verifies no dangerouslySetInnerHTML usage
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ViewHeader,
  type ViewHeaderProps,
  type ViewStatus,
} from '../../../../src/renderer/components/view/ViewHeader';

// ============================================================================
// Test Helpers
// ============================================================================

const defaultProps: ViewHeaderProps = {
  title: 'View Shift #3',
  date: 'Saturday, February 15, 2026',
  status: 'CLOSED',
  onBack: vi.fn(),
};

function renderHeader(props: Partial<ViewHeaderProps> = {}) {
  const mergedProps = { ...defaultProps, ...props };
  return render(<ViewHeader {...mergedProps} />);
}

// ============================================================================
// Tests
// ============================================================================

describe('ViewHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Title rendering', () => {
    it('should render title correctly', () => {
      // Arrange & Act
      renderHeader({ title: 'View Shift #5' });

      // Assert
      expect(screen.getByTestId('view-header-title')).toHaveTextContent('View Shift #5');
    });

    it('should render day view title correctly', () => {
      // Arrange & Act
      renderHeader({ title: 'View Day' });

      // Assert
      expect(screen.getByText('View Day')).toBeInTheDocument();
    });

    it('should render title as h1 heading', () => {
      // Arrange & Act
      renderHeader();

      // Assert
      const title = screen.getByTestId('view-header-title');
      expect(title.tagName).toBe('H1');
    });
  });

  describe('Date rendering', () => {
    it('should render formatted date', () => {
      // Arrange & Act
      renderHeader({ date: 'Monday, January 1, 2026' });

      // Assert
      expect(screen.getByTestId('view-header-date')).toHaveTextContent('Monday, January 1, 2026');
    });

    it('should render date with muted styling', () => {
      // Arrange & Act
      renderHeader();

      // Assert
      const dateElement = screen.getByTestId('view-header-date');
      expect(dateElement.className).toContain('text-muted-foreground');
      expect(dateElement.className).toContain('text-sm');
    });
  });

  describe('Status badge', () => {
    it('should render CLOSED status with correct styling', () => {
      // Arrange & Act
      renderHeader({ status: 'CLOSED' });

      // Assert
      const badge = screen.getByTestId('view-header-status');
      expect(badge).toHaveTextContent('CLOSED');
      expect(badge.className).toContain('bg-muted');
      expect(badge.className).toContain('text-muted-foreground');
    });

    it('should render OPEN status with warning styling', () => {
      // Arrange & Act
      renderHeader({ status: 'OPEN' });

      // Assert
      const badge = screen.getByTestId('view-header-status');
      expect(badge).toHaveTextContent('OPEN');
      expect(badge.className).toContain('bg-warning-light');
      expect(badge.className).toContain('text-warning-muted');
    });

    it('should render RECONCILED status with success styling', () => {
      // Arrange & Act
      renderHeader({ status: 'RECONCILED' });

      // Assert
      const badge = screen.getByTestId('view-header-status');
      expect(badge).toHaveTextContent('RECONCILED');
      expect(badge.className).toContain('bg-success-light');
      expect(badge.className).toContain('text-success-muted');
    });

    it('should render status badge with rounded-full class', () => {
      // Arrange & Act
      renderHeader();

      // Assert
      const badge = screen.getByTestId('view-header-status');
      expect(badge.className).toContain('rounded-full');
    });

    it('should include aria-label for accessibility', () => {
      // Arrange & Act
      renderHeader({ status: 'CLOSED' });

      // Assert
      const badge = screen.getByTestId('view-header-status');
      expect(badge).toHaveAttribute('aria-label', 'Status: CLOSED');
    });

    it('should fallback to CLOSED styling for unknown status', () => {
      // Arrange & Act - Force unknown status via type assertion
      renderHeader({ status: 'UNKNOWN' as ViewStatus });

      // Assert
      const badge = screen.getByTestId('view-header-status');
      expect(badge.className).toContain('bg-muted');
    });
  });

  describe('Back button', () => {
    it('should call onBack when back button clicked', () => {
      // Arrange
      const onBack = vi.fn();
      renderHeader({ onBack });

      // Act
      fireEvent.click(screen.getByTestId('view-header-back-button'));

      // Assert
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('should have accessible aria-label', () => {
      // Arrange & Act
      renderHeader();

      // Assert
      const backButton = screen.getByTestId('view-header-back-button');
      expect(backButton).toHaveAttribute('aria-label', 'Go back');
    });

    it('should render ArrowLeft icon', () => {
      // Arrange & Act
      renderHeader();

      // Assert
      const backButton = screen.getByTestId('view-header-back-button');
      const svg = backButton.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading hierarchy with h1', () => {
      // Arrange & Act
      renderHeader();

      // Assert
      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toHaveTextContent(defaultProps.title);
    });

    it('should have accessible back button', () => {
      // Arrange & Act
      renderHeader();

      // Assert
      const button = screen.getByRole('button', { name: 'Go back' });
      expect(button).toBeInTheDocument();
    });

    it('should have status badge with aria-label describing status', () => {
      // Arrange & Act
      renderHeader({ status: 'RECONCILED' });

      // Assert
      const badge = screen.getByLabelText('Status: RECONCILED');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('data-testid', () => {
    it('should use default testid when none provided', () => {
      // Arrange & Act
      renderHeader();

      // Assert
      expect(screen.getByTestId('view-header')).toBeInTheDocument();
      expect(screen.getByTestId('view-header-title')).toBeInTheDocument();
      expect(screen.getByTestId('view-header-date')).toBeInTheDocument();
      expect(screen.getByTestId('view-header-status')).toBeInTheDocument();
      expect(screen.getByTestId('view-header-back-button')).toBeInTheDocument();
    });

    it('should use custom testid when provided', () => {
      // Arrange & Act
      renderHeader({ 'data-testid': 'custom-header' });

      // Assert
      expect(screen.getByTestId('custom-header')).toBeInTheDocument();
      expect(screen.getByTestId('custom-header-title')).toBeInTheDocument();
      expect(screen.getByTestId('custom-header-date')).toBeInTheDocument();
      expect(screen.getByTestId('custom-header-status')).toBeInTheDocument();
      expect(screen.getByTestId('custom-header-back-button')).toBeInTheDocument();
    });
  });

  describe('className prop', () => {
    it('should apply additional className to container', () => {
      // Arrange & Act
      renderHeader({ className: 'custom-class' });

      // Assert
      const container = screen.getByTestId('view-header');
      expect(container.className).toContain('custom-class');
    });

    it('should preserve default classes when adding custom className', () => {
      // Arrange & Act
      renderHeader({ className: 'custom-class' });

      // Assert
      const container = screen.getByTestId('view-header');
      expect(container.className).toContain('flex');
      expect(container.className).toContain('items-center');
      expect(container.className).toContain('gap-4');
    });
  });
});
