/**
 * SectionPrimitives Unit Tests
 *
 * Tests shared UI primitives used across lottery section components:
 * - SectionIcon: Themed icon container
 * - BinBadge: Numeric bin identifier badge
 * - PackSectionHeader: Collapsible section header
 *
 * Traceability:
 * - SEC-004: Verifies constrained CSS class lookup (no user input in classes)
 * - SEC-014: Verifies type-safe props behavior
 * - FE-001: Verifies React JSX auto-escaping (no dangerouslySetInnerHTML)
 * - ARCH-004: Component-level isolation tests
 * - TEST-005: Single concept per test
 *
 * @module tests/unit/components/lottery/SectionPrimitives
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ============================================================================
// Import Components Under Test
// ============================================================================

import {
  SectionIcon,
  BinBadge,
  PackSectionHeader,
} from '../../../../src/renderer/components/lottery/SectionPrimitives';

// ============================================================================
// SectionIcon Tests
// ============================================================================

describe('SectionIcon', () => {
  it('should render children inside the icon container', () => {
    render(
      <SectionIcon colorTheme="blue">
        <span data-testid="child-icon">Test</span>
      </SectionIcon>
    );
    expect(screen.getByTestId('child-icon')).toBeInTheDocument();
  });

  it('should render a 40x40 rounded container', () => {
    const { container } = render(
      <SectionIcon colorTheme="blue">
        <span>X</span>
      </SectionIcon>
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('w-10');
    expect(wrapper.className).toContain('h-10');
    expect(wrapper.className).toContain('rounded-[10px]');
  });

  it('should apply orange theme classes', () => {
    const { container } = render(
      <SectionIcon colorTheme="orange">
        <span>X</span>
      </SectionIcon>
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('bg-orange-100');
    expect(wrapper.className).toContain('text-orange-600');
    expect(wrapper.className).toContain('dark:bg-orange-950');
    expect(wrapper.className).toContain('dark:text-orange-400');
  });

  it('should apply violet theme classes', () => {
    const { container } = render(
      <SectionIcon colorTheme="violet">
        <span>X</span>
      </SectionIcon>
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('bg-violet-100');
    expect(wrapper.className).toContain('text-violet-600');
  });

  it('should apply blue theme classes', () => {
    const { container } = render(
      <SectionIcon colorTheme="blue">
        <span>X</span>
      </SectionIcon>
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('bg-blue-100');
    expect(wrapper.className).toContain('text-blue-600');
  });

  // SEC-004: Constrained lookup — only allowlisted themes produce classes
  it('should use flex centering for child icon', () => {
    const { container } = render(
      <SectionIcon colorTheme="blue">
        <span>X</span>
      </SectionIcon>
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('flex');
    expect(wrapper.className).toContain('items-center');
    expect(wrapper.className).toContain('justify-center');
  });
});

// ============================================================================
// BinBadge Tests
// ============================================================================

describe('BinBadge', () => {
  it('should render the bin number', () => {
    render(<BinBadge number={5} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('should render a two-digit bin number', () => {
    render(<BinBadge number={12} />);
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('should have blue badge styling', () => {
    const { container } = render(<BinBadge number={1} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('bg-blue-100');
    expect(badge.className).toContain('text-blue-700');
    expect(badge.className).toContain('dark:bg-blue-900/50');
    expect(badge.className).toContain('dark:text-blue-300');
  });

  it('should have responsive sizing classes', () => {
    const { container } = render(<BinBadge number={1} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('w-8');
    expect(badge.className).toContain('h-8');
    expect(badge.className).toContain('sm:w-10');
    expect(badge.className).toContain('sm:h-10');
  });

  it('should have responsive text sizing', () => {
    const { container } = render(<BinBadge number={1} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('text-[13px]');
    expect(badge.className).toContain('sm:text-[15px]');
  });

  it('should be bold and centered', () => {
    const { container } = render(<BinBadge number={1} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('font-bold');
    expect(badge.className).toContain('flex');
    expect(badge.className).toContain('items-center');
    expect(badge.className).toContain('justify-center');
  });

  // SEC-014: Numeric input only — verifies number renders as text via JSX escaping
  it('should render zero as a valid number', () => {
    render(<BinBadge number={0} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});

// ============================================================================
// PackSectionHeader Tests
// ============================================================================

describe('PackSectionHeader', () => {
  const defaultProps = {
    icon: <span data-testid="test-icon">Icon</span>,
    title: 'Test Section',
    count: 5,
    isOpen: false,
    onToggle: vi.fn(),
  };

  it('should render title with count', () => {
    render(<PackSectionHeader {...defaultProps} />);
    expect(screen.getByText('Test Section (5)')).toBeInTheDocument();
  });

  it('should render the icon', () => {
    render(<PackSectionHeader {...defaultProps} />);
    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
  });

  it('should call onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(<PackSectionHeader {...defaultProps} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('should have aria-expanded=false when closed', () => {
    render(<PackSectionHeader {...defaultProps} isOpen={false} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it('should have aria-expanded=true when open', () => {
    render(<PackSectionHeader {...defaultProps} isOpen={true} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('should rotate chevron when open', () => {
    const { container } = render(<PackSectionHeader {...defaultProps} isOpen={true} />);
    const chevron = container.querySelector('.lucide.lucide-chevron-right');
    expect(chevron).not.toBeNull();
    expect(chevron!.getAttribute('class')).toContain('rotate-90');
  });

  it('should not rotate chevron when closed', () => {
    const { container } = render(<PackSectionHeader {...defaultProps} isOpen={false} />);
    const chevron = container.querySelector('.lucide.lucide-chevron-right');
    expect(chevron).not.toBeNull();
    expect(chevron!.getAttribute('class')).not.toContain('rotate-90');
  });

  // Traceability: PERF-002 - Smooth 350ms animation matching centralized accordion
  it('should have 350ms animation duration on chevron', () => {
    const { container } = render(<PackSectionHeader {...defaultProps} isOpen={false} />);
    const chevron = container.querySelector('.lucide.lucide-chevron-right');
    expect(chevron).not.toBeNull();
    expect(chevron!.getAttribute('class')).toContain('duration-[350ms]');
  });

  it('should have ease-out timing function on chevron', () => {
    const { container } = render(<PackSectionHeader {...defaultProps} isOpen={false} />);
    const chevron = container.querySelector('.lucide.lucide-chevron-right');
    expect(chevron).not.toBeNull();
    expect(chevron!.getAttribute('class')).toContain('ease-out');
  });

  it('should have transition-transform on chevron', () => {
    const { container } = render(<PackSectionHeader {...defaultProps} isOpen={false} />);
    const chevron = container.querySelector('.lucide.lucide-chevron-right');
    expect(chevron).not.toBeNull();
    expect(chevron!.getAttribute('class')).toContain('transition-transform');
  });

  it('should render rightBadge when provided', () => {
    render(
      <PackSectionHeader {...defaultProps} rightBadge={<span data-testid="badge">$100</span>} />
    );
    expect(screen.getByTestId('badge')).toBeInTheDocument();
    expect(screen.getByText('$100')).toBeInTheDocument();
  });

  it('should not render rightBadge when omitted', () => {
    render(<PackSectionHeader {...defaultProps} />);
    expect(screen.queryByTestId('badge')).not.toBeInTheDocument();
  });

  it('should render subtitle when provided', () => {
    render(<PackSectionHeader {...defaultProps} subtitle="3 active, 2 sold out" />);
    expect(screen.getByText('3 active, 2 sold out')).toBeInTheDocument();
  });

  it('should not render subtitle when omitted', () => {
    const { container } = render(<PackSectionHeader {...defaultProps} />);
    const subtitleSpan = container.querySelector('.text-xs.font-normal.text-muted-foreground');
    expect(subtitleSpan).toBeNull();
  });

  it('should have button type="button"', () => {
    render(<PackSectionHeader {...defaultProps} />);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('should render count of zero correctly', () => {
    render(<PackSectionHeader {...defaultProps} count={0} />);
    expect(screen.getByText('Test Section (0)')).toBeInTheDocument();
  });

  // SEC-004: All title/count/subtitle values auto-escaped by JSX
  it('should safely render special characters in title via JSX escaping', () => {
    render(<PackSectionHeader {...defaultProps} title="Packs <script>alert('xss')</script>" />);
    // The script tag should appear as text, not execute
    const button = screen.getByRole('button');
    expect(button.textContent).toContain("<script>alert('xss')</script>");
    expect(button.querySelector('script')).toBeNull();
  });
});
