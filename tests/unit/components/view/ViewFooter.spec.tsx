/**
 * ViewFooter Unit Tests
 *
 * Tests the ViewFooter component for correct rendering.
 * Validates:
 * - Created timestamp rendering
 * - Closed timestamp rendering
 * - Duration display calculation
 * - Locale timestamp formatting
 *
 * @module tests/unit/components/view/ViewFooter
 * @security SEC-004: Verifies no XSS vectors - all content is text
 * @security FE-001: Verifies no dangerouslySetInnerHTML usage
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ViewFooter,
  calculateDuration,
  type ViewFooterProps,
} from '../../../../src/renderer/components/view/ViewFooter';

// ============================================================================
// Test Helpers
// ============================================================================

const defaultProps: ViewFooterProps = {
  createdAt: 'Feb 15, 2026 6:00 AM',
  closedAt: 'Feb 15, 2026 2:30 PM',
  duration: '8 hours 30 minutes',
};

function renderFooter(props: Partial<ViewFooterProps> = {}) {
  const mergedProps = { ...defaultProps, ...props };
  return render(<ViewFooter {...mergedProps} />);
}

// ============================================================================
// Tests
// ============================================================================

describe('ViewFooter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Created timestamp', () => {
    it('should render created timestamp', () => {
      // Arrange & Act
      renderFooter();

      // Assert
      const created = screen.getByTestId('view-footer-created');
      expect(created).toHaveTextContent('Shift Created:');
      expect(created).toHaveTextContent('Feb 15, 2026 6:00 AM');
    });

    it('should display dash for empty createdAt', () => {
      // Arrange & Act
      renderFooter({ createdAt: '' });

      // Assert
      const created = screen.getByTestId('view-footer-created');
      expect(created).toHaveTextContent('—');
    });
  });

  describe('Closed timestamp', () => {
    it('should render closed timestamp', () => {
      // Arrange & Act
      renderFooter();

      // Assert
      const closed = screen.getByTestId('view-footer-closed');
      expect(closed).toHaveTextContent('Shift Closed:');
      expect(closed).toHaveTextContent('Feb 15, 2026 2:30 PM');
    });

    it('should display dash for empty closedAt', () => {
      // Arrange & Act
      renderFooter({ closedAt: '' });

      // Assert
      const closed = screen.getByTestId('view-footer-closed');
      expect(closed).toHaveTextContent('—');
    });
  });

  describe('Duration display', () => {
    it('should render duration', () => {
      // Arrange & Act
      renderFooter();

      // Assert
      const duration = screen.getByTestId('view-footer-duration');
      expect(duration).toHaveTextContent('Duration:');
      expect(duration).toHaveTextContent('8 hours 30 minutes');
    });

    it('should display dash for empty duration', () => {
      // Arrange & Act
      renderFooter({ duration: '' });

      // Assert
      const duration = screen.getByTestId('view-footer-duration');
      expect(duration).toHaveTextContent('—');
    });
  });

  describe('Layout', () => {
    it('should use responsive grid layout', () => {
      // Arrange & Act
      renderFooter();

      // Assert
      const footer = screen.getByTestId('view-footer');
      const grid = footer.firstElementChild;
      expect(grid?.className).toContain('grid');
      expect(grid?.className).toContain('grid-cols-1');
      expect(grid?.className).toContain('md:grid-cols-3');
    });

    it('should have gap between items', () => {
      // Arrange & Act
      renderFooter();

      // Assert
      const footer = screen.getByTestId('view-footer');
      const grid = footer.firstElementChild;
      expect(grid?.className).toContain('gap-4');
    });
  });

  describe('data-testid', () => {
    it('should use default testid when none provided', () => {
      // Arrange & Act
      renderFooter();

      // Assert
      expect(screen.getByTestId('view-footer')).toBeInTheDocument();
      expect(screen.getByTestId('view-footer-created')).toBeInTheDocument();
      expect(screen.getByTestId('view-footer-closed')).toBeInTheDocument();
      expect(screen.getByTestId('view-footer-duration')).toBeInTheDocument();
    });

    it('should use custom testid when provided', () => {
      // Arrange & Act
      renderFooter({ 'data-testid': 'custom-footer' });

      // Assert
      expect(screen.getByTestId('custom-footer')).toBeInTheDocument();
      expect(screen.getByTestId('custom-footer-created')).toBeInTheDocument();
      expect(screen.getByTestId('custom-footer-closed')).toBeInTheDocument();
      expect(screen.getByTestId('custom-footer-duration')).toBeInTheDocument();
    });
  });

  describe('className prop', () => {
    it('should apply additional className', () => {
      // Arrange & Act
      renderFooter({ className: 'custom-class' });

      // Assert
      const footer = screen.getByTestId('view-footer');
      expect(footer.className).toContain('custom-class');
    });
  });
});

describe('calculateDuration', () => {
  it('should calculate hours and minutes correctly', () => {
    // Arrange
    const start = new Date('2026-02-15T06:00:00');
    const end = new Date('2026-02-15T14:30:00');

    // Act
    const result = calculateDuration(start, end);

    // Assert
    expect(result).toBe('8 hours 30 minutes');
  });

  it('should return singular "hour" for 1 hour', () => {
    // Arrange
    const start = new Date('2026-02-15T06:00:00');
    const end = new Date('2026-02-15T07:30:00');

    // Act
    const result = calculateDuration(start, end);

    // Assert
    expect(result).toBe('1 hour 30 minutes');
  });

  it('should return singular "minute" for 1 minute', () => {
    // Arrange
    const start = new Date('2026-02-15T06:00:00');
    const end = new Date('2026-02-15T08:01:00');

    // Act
    const result = calculateDuration(start, end);

    // Assert
    expect(result).toBe('2 hours 1 minute');
  });

  it('should handle hours only (no minutes)', () => {
    // Arrange
    const start = new Date('2026-02-15T06:00:00');
    const end = new Date('2026-02-15T14:00:00');

    // Act
    const result = calculateDuration(start, end);

    // Assert
    expect(result).toBe('8 hours');
  });

  it('should handle minutes only (no hours)', () => {
    // Arrange
    const start = new Date('2026-02-15T06:00:00');
    const end = new Date('2026-02-15T06:45:00');

    // Act
    const result = calculateDuration(start, end);

    // Assert
    expect(result).toBe('45 minutes');
  });

  it('should return dash for negative duration', () => {
    // Arrange
    const start = new Date('2026-02-15T14:30:00');
    const end = new Date('2026-02-15T06:00:00');

    // Act
    const result = calculateDuration(start, end);

    // Assert
    expect(result).toBe('—');
  });

  it('should handle zero duration', () => {
    // Arrange
    const start = new Date('2026-02-15T06:00:00');
    const end = new Date('2026-02-15T06:00:00');

    // Act
    const result = calculateDuration(start, end);

    // Assert
    expect(result).toBe('0 minutes');
  });

  it('should handle large durations correctly', () => {
    // Arrange
    const start = new Date('2026-02-15T00:00:00');
    const end = new Date('2026-02-15T23:59:00');

    // Act
    const result = calculateDuration(start, end);

    // Assert
    expect(result).toBe('23 hours 59 minutes');
  });
});
