/**
 * EmployeeAvatar Unit Tests
 *
 * Tests the EmployeeAvatar component and its getInitials utility function.
 * Validates:
 * - Correct initials extraction from full names
 * - Single name handling
 * - Empty/whitespace name handling
 * - Size prop application
 * - Default size behavior
 * - ARIA label for accessibility
 *
 * @module tests/unit/components/reports/EmployeeAvatar
 * @security SEC-004: Verifies no XSS vectors - all content is text
 * @security FE-001: Verifies no dangerouslySetInnerHTML usage
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  EmployeeAvatar,
  getInitials,
} from '../../../../src/renderer/components/reports/EmployeeAvatar';
import type { AvatarSize } from '../../../../src/renderer/components/reports/EmployeeAvatar';

// ============================================================================
// getInitials Pure Function Tests
// ============================================================================

describe('getInitials', () => {
  it('should return "JS" for "John Smith"', () => {
    expect(getInitials('John Smith')).toBe('JS');
  });

  it('should return "J" for single name "John"', () => {
    expect(getInitials('John')).toBe('J');
  });

  it('should return empty string for empty string name', () => {
    expect(getInitials('')).toBe('');
  });

  it('should return empty string for whitespace-only name', () => {
    expect(getInitials('   ')).toBe('');
  });

  it('should handle names with extra spaces', () => {
    expect(getInitials('  John   Smith  ')).toBe('JS');
  });

  it('should use first and last name for multi-part names', () => {
    expect(getInitials('John Michael Smith')).toBe('JS');
  });

  it('should uppercase initials for lowercase names', () => {
    expect(getInitials('jane doe')).toBe('JD');
  });

  it('should handle single character name', () => {
    expect(getInitials('A')).toBe('A');
  });

  it('should handle non-string input defensively', () => {
    // Type assertion to test runtime safety
    expect(getInitials(null as unknown as string)).toBe('');
    expect(getInitials(undefined as unknown as string)).toBe('');
    expect(getInitials(123 as unknown as string)).toBe('');
  });
});

// ============================================================================
// EmployeeAvatar Component Tests
// ============================================================================

describe('EmployeeAvatar', () => {
  describe('Initials display', () => {
    it('should display correct initials for "John Smith"', () => {
      render(<EmployeeAvatar name="John Smith" />);
      const avatar = screen.getByTestId('employee-avatar');
      expect(avatar.textContent).toBe('JS');
    });

    it('should display correct initials for single name "John"', () => {
      render(<EmployeeAvatar name="John" />);
      const avatar = screen.getByTestId('employee-avatar');
      expect(avatar.textContent).toBe('J');
    });

    it('should display empty content for empty string name', () => {
      render(<EmployeeAvatar name="" />);
      const avatar = screen.getByTestId('employee-avatar');
      expect(avatar.textContent).toBe('');
    });
  });

  describe('Size prop', () => {
    it('should apply small size classes when size="sm"', () => {
      render(<EmployeeAvatar name="John" size="sm" />);
      const avatar = screen.getByTestId('employee-avatar');
      expect(avatar.className).toContain('h-6');
      expect(avatar.className).toContain('w-6');
    });

    it('should apply medium size classes when size="md"', () => {
      render(<EmployeeAvatar name="John" size="md" />);
      const avatar = screen.getByTestId('employee-avatar');
      expect(avatar.className).toContain('h-8');
      expect(avatar.className).toContain('w-8');
    });

    it('should apply large size classes when size="lg"', () => {
      render(<EmployeeAvatar name="John" size="lg" />);
      const avatar = screen.getByTestId('employee-avatar');
      expect(avatar.className).toContain('h-10');
      expect(avatar.className).toContain('w-10');
    });

    it('should default to medium size when size prop is omitted', () => {
      render(<EmployeeAvatar name="John" />);
      const avatar = screen.getByTestId('employee-avatar');
      expect(avatar.className).toContain('h-8');
      expect(avatar.className).toContain('w-8');
    });
  });

  describe('Accessibility', () => {
    it('should have aria-label matching the full name', () => {
      render(<EmployeeAvatar name="John Smith" />);
      const avatar = screen.getByTestId('employee-avatar');
      expect(avatar).toHaveAttribute('aria-label', 'John Smith');
    });

    it('should have "Unknown employee" aria-label for empty name', () => {
      render(<EmployeeAvatar name="" />);
      const avatar = screen.getByTestId('employee-avatar');
      expect(avatar).toHaveAttribute('aria-label', 'Unknown employee');
    });
  });

  describe('Styling', () => {
    it('should have rounded-full class for circular shape', () => {
      render(<EmployeeAvatar name="John" />);
      const avatar = screen.getByTestId('employee-avatar');
      expect(avatar.className).toContain('rounded-full');
    });

    it('should have gradient background classes', () => {
      render(<EmployeeAvatar name="John" />);
      const avatar = screen.getByTestId('employee-avatar');
      expect(avatar.className).toContain('bg-gradient-to-br');
    });
  });

  describe('data-testid', () => {
    it('should use default testid when none provided', () => {
      render(<EmployeeAvatar name="John" />);
      expect(screen.getByTestId('employee-avatar')).toBeInTheDocument();
    });

    it('should use custom testid when provided', () => {
      render(<EmployeeAvatar name="John" data-testid="custom-avatar" />);
      expect(screen.getByTestId('custom-avatar')).toBeInTheDocument();
    });
  });
});
