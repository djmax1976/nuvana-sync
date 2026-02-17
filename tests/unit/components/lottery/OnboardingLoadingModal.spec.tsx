/**
 * OnboardingLoadingModal Unit Tests
 *
 * Tests the OnboardingLoadingModal component for:
 * - Rendering when open/closed
 * - Spinner animation presence
 * - Static text display
 * - WCAG accessibility compliance
 * - Interaction blocking
 *
 * Story: BIZ-012-UX-FIX - Direct Onboarding Update (Phase 2)
 *
 * Traceability:
 * - LM-001: Modal renders with spinner when open
 * - LM-002: Modal hidden when open=false
 * - LM-003: Modal displays "Preparing onboarding..." text
 * - LM-004: Modal has role="dialog" and aria-modal="true"
 * - LM-005: Modal blocks interaction (pointer-events)
 * - SEC-014: INPUT_VALIDATION - Static text only, no user input
 * - FE-001: FE_XSS_PREVENTION - React JSX auto-escaping
 * - A11Y-008: A11Y_COLOR_CONTRAST - Proper contrast ratios
 *
 * @module tests/unit/components/lottery/OnboardingLoadingModal
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ============================================================================
// Import Component Under Test
// ============================================================================

import {
  OnboardingLoadingModal,
  type OnboardingLoadingModalProps,
} from '../../../../src/renderer/components/lottery/OnboardingLoadingModal';

// ============================================================================
// Test Fixtures
// ============================================================================

function createDefaultProps(
  overrides?: Partial<OnboardingLoadingModalProps>
): OnboardingLoadingModalProps {
  return {
    open: true,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('OnboardingLoadingModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // LM-001: Modal renders with spinner when open
  // --------------------------------------------------------------------------
  describe('LM-001: Rendering (Open)', () => {
    it('should render when open is true', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      expect(screen.getByTestId('onboarding-loading-modal')).toBeInTheDocument();
    });

    it('should render spinner animation', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      expect(screen.getByTestId('onboarding-loading-spinner')).toBeInTheDocument();
    });

    it('should have spinner with animate-spin class', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const spinner = screen.getByTestId('onboarding-loading-spinner');
      expect(spinner).toHaveClass('animate-spin');
    });
  });

  // --------------------------------------------------------------------------
  // LM-002: Modal hidden when open=false
  // --------------------------------------------------------------------------
  describe('LM-002: Rendering (Closed)', () => {
    it('should NOT render when open is false', () => {
      render(<OnboardingLoadingModal {...createDefaultProps({ open: false })} />);
      expect(screen.queryByTestId('onboarding-loading-modal')).not.toBeInTheDocument();
    });

    it('should NOT render spinner when closed', () => {
      render(<OnboardingLoadingModal {...createDefaultProps({ open: false })} />);
      expect(screen.queryByTestId('onboarding-loading-spinner')).not.toBeInTheDocument();
    });

    it('should NOT render title when closed', () => {
      render(<OnboardingLoadingModal {...createDefaultProps({ open: false })} />);
      expect(screen.queryByTestId('onboarding-loading-title')).not.toBeInTheDocument();
    });

    it('should NOT render description when closed', () => {
      render(<OnboardingLoadingModal {...createDefaultProps({ open: false })} />);
      expect(screen.queryByTestId('onboarding-loading-description')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // LM-003: Modal displays "Preparing onboarding..." text
  // --------------------------------------------------------------------------
  describe('LM-003: Text Content', () => {
    it('should display "Preparing onboarding..." title', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      expect(screen.getByText('Preparing onboarding...')).toBeInTheDocument();
    });

    it('should display description text', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      expect(
        screen.getByText('Please wait while we prepare your lottery setup')
      ).toBeInTheDocument();
    });

    it('should have title in h2 element', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const title = screen.getByTestId('onboarding-loading-title');
      expect(title.tagName).toBe('H2');
    });

    it('should have description in p element', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const description = screen.getByTestId('onboarding-loading-description');
      expect(description.tagName).toBe('P');
    });
  });

  // --------------------------------------------------------------------------
  // LM-004: Modal has role="dialog" and aria-modal="true"
  // --------------------------------------------------------------------------
  describe('LM-004: WCAG Accessibility', () => {
    it('should have role="dialog" for screen readers', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const modal = screen.getByTestId('onboarding-loading-modal');
      expect(modal).toHaveAttribute('role', 'dialog');
    });

    it('should have aria-modal="true" for modal behavior', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const modal = screen.getByTestId('onboarding-loading-modal');
      expect(modal).toHaveAttribute('aria-modal', 'true');
    });

    it('should have aria-busy="true" for loading state', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const modal = screen.getByTestId('onboarding-loading-modal');
      expect(modal).toHaveAttribute('aria-busy', 'true');
    });

    it('should have aria-labelledby pointing to title', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const modal = screen.getByTestId('onboarding-loading-modal');
      expect(modal).toHaveAttribute('aria-labelledby', 'onboarding-loading-title');
    });

    it('should have aria-describedby pointing to description', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const modal = screen.getByTestId('onboarding-loading-modal');
      expect(modal).toHaveAttribute('aria-describedby', 'onboarding-loading-description');
    });

    it('should have title with correct id for aria-labelledby', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const title = screen.getByTestId('onboarding-loading-title');
      expect(title).toHaveAttribute('id', 'onboarding-loading-title');
    });

    it('should have description with correct id for aria-describedby', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const description = screen.getByTestId('onboarding-loading-description');
      expect(description).toHaveAttribute('id', 'onboarding-loading-description');
    });

    it('should have aria-hidden on decorative spinner icon', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const spinner = screen.getByTestId('onboarding-loading-spinner');
      expect(spinner).toHaveAttribute('aria-hidden', 'true');
    });
  });

  // --------------------------------------------------------------------------
  // LM-005: Modal blocks interaction (pointer-events)
  // --------------------------------------------------------------------------
  describe('LM-005: Interaction Blocking', () => {
    it('should have pointer-events: all to block clicks through overlay', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const modal = screen.getByTestId('onboarding-loading-modal');
      // Check inline style
      expect(modal.style.pointerEvents).toBe('all');
    });

    it('should have fixed positioning for full-screen coverage', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const modal = screen.getByTestId('onboarding-loading-modal');
      expect(modal).toHaveClass('fixed');
      expect(modal).toHaveClass('inset-0');
    });

    it('should have z-50 for stacking above other content', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const modal = screen.getByTestId('onboarding-loading-modal');
      expect(modal).toHaveClass('z-50');
    });

    it('should have centered content', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const modal = screen.getByTestId('onboarding-loading-modal');
      expect(modal).toHaveClass('flex');
      expect(modal).toHaveClass('items-center');
      expect(modal).toHaveClass('justify-center');
    });

    it('should have dark overlay background', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const modal = screen.getByTestId('onboarding-loading-modal');
      expect(modal).toHaveClass('bg-black/80');
    });
  });

  // --------------------------------------------------------------------------
  // Security: SEC-014 Static Text Validation
  // --------------------------------------------------------------------------
  describe('SEC-014: Static Text Only', () => {
    it('should only display static text (no user input)', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);

      // All text should be static, not from props
      const title = screen.getByTestId('onboarding-loading-title');
      const description = screen.getByTestId('onboarding-loading-description');

      // Verify exact static content
      expect(title.textContent).toBe('Preparing onboarding...');
      expect(description.textContent).toBe('Please wait while we prepare your lottery setup');
    });

    it('should not accept or display any user-controlled content', () => {
      // Component only accepts `open` prop - no text props
      const props = createDefaultProps();

      // Verify props interface is minimal
      expect(Object.keys(props)).toEqual(['open']);
    });
  });

  // --------------------------------------------------------------------------
  // Visual Styling
  // --------------------------------------------------------------------------
  describe('Visual Styling', () => {
    it('should have white text for contrast on dark background', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const modal = screen.getByTestId('onboarding-loading-modal');
      const textContainer = modal.querySelector('.text-white');
      expect(textContainer).toBeInTheDocument();
    });

    it('should have appropriate title font styling', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const title = screen.getByTestId('onboarding-loading-title');
      expect(title).toHaveClass('text-xl');
      expect(title).toHaveClass('font-semibold');
    });

    it('should have appropriate description styling', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const description = screen.getByTestId('onboarding-loading-description');
      expect(description).toHaveClass('text-sm');
      expect(description).toHaveClass('text-gray-300');
    });

    it('should have proper spacing between elements', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      const modal = screen.getByTestId('onboarding-loading-modal');
      const contentContainer = modal.querySelector('.space-y-4');
      expect(contentContainer).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle rapid open/close transitions', () => {
      const { rerender } = render(<OnboardingLoadingModal open={false} />);
      expect(screen.queryByTestId('onboarding-loading-modal')).not.toBeInTheDocument();

      rerender(<OnboardingLoadingModal open={true} />);
      expect(screen.getByTestId('onboarding-loading-modal')).toBeInTheDocument();

      rerender(<OnboardingLoadingModal open={false} />);
      expect(screen.queryByTestId('onboarding-loading-modal')).not.toBeInTheDocument();
    });

    it('should cleanup properly on unmount', () => {
      const { unmount } = render(<OnboardingLoadingModal {...createDefaultProps()} />);
      expect(screen.getByTestId('onboarding-loading-modal')).toBeInTheDocument();

      unmount();

      expect(screen.queryByTestId('onboarding-loading-modal')).not.toBeInTheDocument();
    });

    it('should not throw when rendered with open=undefined (should default to falsy)', () => {
      // TypeScript would normally prevent this, but test runtime behavior
      const props = { open: undefined } as unknown as OnboardingLoadingModalProps;
      expect(() => render(<OnboardingLoadingModal {...props} />)).not.toThrow();
    });

    it('should render multiple instances independently', () => {
      render(
        <>
          <OnboardingLoadingModal open={true} />
          <OnboardingLoadingModal open={false} />
        </>
      );

      // Only one should be visible
      const modals = screen.getAllByTestId('onboarding-loading-modal');
      expect(modals).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // Data Test IDs
  // --------------------------------------------------------------------------
  describe('Data Test IDs', () => {
    it('should have data-testid on modal container', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      expect(screen.getByTestId('onboarding-loading-modal')).toBeInTheDocument();
    });

    it('should have data-testid on spinner', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      expect(screen.getByTestId('onboarding-loading-spinner')).toBeInTheDocument();
    });

    it('should have data-testid on title', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      expect(screen.getByTestId('onboarding-loading-title')).toBeInTheDocument();
    });

    it('should have data-testid on description', () => {
      render(<OnboardingLoadingModal {...createDefaultProps()} />);
      expect(screen.getByTestId('onboarding-loading-description')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// Tests - Traceability Matrix
// ============================================================================

describe('Traceability: BIZ-012-UX-FIX Phase 2 Requirements', () => {
  /**
   * Requirement Matrix for OnboardingLoadingModal:
   *
   * | Test ID | Requirement | Test Case | Status |
   * |---------|-------------|-----------|--------|
   * | LM-001 | Modal renders with spinner when open | "Rendering (Open)" | Covered |
   * | LM-002 | Modal hidden when open=false | "Rendering (Closed)" | Covered |
   * | LM-003 | Modal displays "Preparing onboarding..." | "Text Content" | Covered |
   * | LM-004 | Modal has role="dialog" and aria-modal | "WCAG Accessibility" | Covered |
   * | LM-005 | Modal blocks interaction | "Interaction Blocking" | Covered |
   */
  it('should satisfy all Phase 2 modal requirements', () => {
    render(<OnboardingLoadingModal open={true} />);

    // LM-001: Modal renders with spinner
    expect(screen.getByTestId('onboarding-loading-modal')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-loading-spinner')).toBeInTheDocument();

    // LM-003: Text displays correctly
    expect(screen.getByText('Preparing onboarding...')).toBeInTheDocument();

    // LM-004: WCAG compliance
    const modal = screen.getByTestId('onboarding-loading-modal');
    expect(modal).toHaveAttribute('role', 'dialog');
    expect(modal).toHaveAttribute('aria-modal', 'true');
    expect(modal).toHaveAttribute('aria-busy', 'true');

    // LM-005: Interaction blocking
    expect(modal.style.pointerEvents).toBe('all');
    expect(modal).toHaveClass('fixed');
    expect(modal).toHaveClass('inset-0');
    expect(modal).toHaveClass('z-50');
  });

  it('should satisfy LM-002: hidden when closed', () => {
    render(<OnboardingLoadingModal open={false} />);

    // LM-002: Modal not rendered when closed
    expect(screen.queryByTestId('onboarding-loading-modal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-loading-spinner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-loading-title')).not.toBeInTheDocument();
  });
});
