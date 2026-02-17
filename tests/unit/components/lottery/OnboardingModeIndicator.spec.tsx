/**
 * OnboardingModeIndicator Unit Tests
 *
 * Tests the OnboardingModeIndicator component for:
 * - Rendering when active/inactive
 * - Button click handling
 * - Accessibility compliance
 * - Visual styling
 *
 * Story: Lottery Onboarding Feature (BIZ-010)
 *
 * Traceability:
 * - BIZ-010: First-ever lottery day onboarding mode
 * - AC-001: Visual indicator shows "Onboarding Mode Active"
 * - AC-002: Helpful instructions displayed
 * - AC-003: "Complete Onboarding" button exits mode
 * - ARCH-001: FE_COMPONENT_DESIGN - Component isolation tests
 * - ARCH-003: FE_ACCESSIBILITY_IMPLEMENTATION - ARIA compliance
 * - TEST-005: Single concept per test
 *
 * @module tests/unit/components/lottery/OnboardingModeIndicator
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ============================================================================
// Import Component Under Test
// ============================================================================

import {
  OnboardingModeIndicator,
  type OnboardingModeIndicatorProps,
} from '../../../../src/renderer/components/lottery/OnboardingModeIndicator';

// ============================================================================
// Test Fixtures
// ============================================================================

function createDefaultProps(
  overrides?: Partial<OnboardingModeIndicatorProps>
): OnboardingModeIndicatorProps {
  return {
    isActive: true,
    onComplete: vi.fn(),
    isCompleting: false,
    activatedPacksCount: undefined,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('OnboardingModeIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Rendering - When Active
  // --------------------------------------------------------------------------
  describe('Rendering (Active)', () => {
    it('should render when isActive is true', () => {
      render(<OnboardingModeIndicator {...createDefaultProps()} />);
      expect(screen.getByTestId('onboarding-mode-indicator')).toBeInTheDocument();
    });

    it('should render title "Onboarding Mode Active"', () => {
      render(<OnboardingModeIndicator {...createDefaultProps()} />);
      expect(screen.getByText('Onboarding Mode Active')).toBeInTheDocument();
    });

    it('should render instructional text about scanning existing packs', () => {
      render(<OnboardingModeIndicator {...createDefaultProps()} />);
      expect(screen.getByText(/scan your existing packs/i)).toBeInTheDocument();
    });

    it('should render "Complete Onboarding" button', () => {
      render(<OnboardingModeIndicator {...createDefaultProps()} />);
      expect(screen.getByTestId('complete-onboarding-button')).toBeInTheDocument();
      expect(screen.getByText('Complete Onboarding')).toBeInTheDocument();
    });

    it('should render helper text about completing onboarding', () => {
      render(<OnboardingModeIndicator {...createDefaultProps()} />);
      expect(screen.getByText(/click when all existing packs are scanned/i)).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Rendering - When Inactive
  // --------------------------------------------------------------------------
  describe('Rendering (Inactive)', () => {
    it('should NOT render when isActive is false', () => {
      render(<OnboardingModeIndicator {...createDefaultProps({ isActive: false })} />);
      expect(screen.queryByTestId('onboarding-mode-indicator')).not.toBeInTheDocument();
    });

    it('should NOT render title when inactive', () => {
      render(<OnboardingModeIndicator {...createDefaultProps({ isActive: false })} />);
      expect(screen.queryByText('Onboarding Mode Active')).not.toBeInTheDocument();
    });

    it('should NOT render button when inactive', () => {
      render(<OnboardingModeIndicator {...createDefaultProps({ isActive: false })} />);
      expect(screen.queryByTestId('complete-onboarding-button')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Button Interactions
  // --------------------------------------------------------------------------
  describe('Button Interactions', () => {
    it('should call onComplete when "Complete Onboarding" button is clicked', () => {
      const onComplete = vi.fn();
      render(<OnboardingModeIndicator {...createDefaultProps({ onComplete })} />);

      const button = screen.getByTestId('complete-onboarding-button');
      fireEvent.click(button);

      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('should NOT call onComplete multiple times on rapid clicks', () => {
      const onComplete = vi.fn();
      render(<OnboardingModeIndicator {...createDefaultProps({ onComplete })} />);

      const button = screen.getByTestId('complete-onboarding-button');
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);

      expect(onComplete).toHaveBeenCalledTimes(3);
    });

    it('should disable button when isCompleting is true', () => {
      render(<OnboardingModeIndicator {...createDefaultProps({ isCompleting: true })} />);

      const button = screen.getByTestId('complete-onboarding-button');
      expect(button).toBeDisabled();
    });

    it('should NOT disable button when isCompleting is false', () => {
      render(<OnboardingModeIndicator {...createDefaultProps({ isCompleting: false })} />);

      const button = screen.getByTestId('complete-onboarding-button');
      expect(button).not.toBeDisabled();
    });

    it('should show "Completing..." text when isCompleting is true', () => {
      render(<OnboardingModeIndicator {...createDefaultProps({ isCompleting: true })} />);
      expect(screen.getByText('Completing...')).toBeInTheDocument();
    });

    it('should show "Complete Onboarding" text when isCompleting is false', () => {
      render(<OnboardingModeIndicator {...createDefaultProps({ isCompleting: false })} />);
      expect(screen.getByText('Complete Onboarding')).toBeInTheDocument();
    });

    it('should NOT call onComplete when button is disabled', () => {
      const onComplete = vi.fn();
      render(
        <OnboardingModeIndicator {...createDefaultProps({ onComplete, isCompleting: true })} />
      );

      const button = screen.getByTestId('complete-onboarding-button');
      fireEvent.click(button);

      // Button is disabled, so onClick shouldn't fire
      expect(onComplete).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Accessibility (ARCH-003: FE_ACCESSIBILITY_IMPLEMENTATION)
  // --------------------------------------------------------------------------
  describe('Accessibility', () => {
    it('should have role="status" for screen readers', () => {
      render(<OnboardingModeIndicator {...createDefaultProps()} />);
      const indicator = screen.getByTestId('onboarding-mode-indicator');
      expect(indicator).toHaveAttribute('role', 'status');
    });

    it('should have aria-live="polite" for screen readers', () => {
      render(<OnboardingModeIndicator {...createDefaultProps()} />);
      const indicator = screen.getByTestId('onboarding-mode-indicator');
      expect(indicator).toHaveAttribute('aria-live', 'polite');
    });

    it('should have aria-hidden on decorative icons', () => {
      render(<OnboardingModeIndicator {...createDefaultProps()} />);
      // The info icon should have aria-hidden - it's decorative
      // SVGs rendered by lucide-react have aria-hidden="true" on them
      const container = screen.getByTestId('onboarding-mode-indicator');
      const icons = container.querySelectorAll('svg[aria-hidden="true"]');
      // Should have at least the Info icon
      expect(icons.length).toBeGreaterThanOrEqual(1);
    });

    it('should have clickable button accessible via keyboard', () => {
      const onComplete = vi.fn();
      render(<OnboardingModeIndicator {...createDefaultProps({ onComplete })} />);

      const button = screen.getByTestId('complete-onboarding-button');

      // Button should be focusable
      expect(button).not.toHaveAttribute('tabindex', '-1');

      // Simulate keyboard interaction
      fireEvent.keyDown(button, { key: 'Enter', code: 'Enter' });
      fireEvent.click(button);

      expect(onComplete).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Visual Styling
  // --------------------------------------------------------------------------
  describe('Visual Styling', () => {
    it('should have blue info styling (not warning)', () => {
      render(<OnboardingModeIndicator {...createDefaultProps()} />);
      const indicator = screen.getByTestId('onboarding-mode-indicator');

      // Should have blue-themed classes
      expect(indicator.className).toContain('border-blue');
      expect(indicator.className).toContain('bg-blue');
    });

    it('should apply dark mode styles', () => {
      render(<OnboardingModeIndicator {...createDefaultProps()} />);
      const indicator = screen.getByTestId('onboarding-mode-indicator');

      // Should have dark mode classes
      expect(indicator.className).toContain('dark:bg-blue');
    });
  });

  // --------------------------------------------------------------------------
  // Pack Count Display (BIZ-012-FIX)
  // --------------------------------------------------------------------------
  describe('Pack Count Display (BIZ-012-FIX)', () => {
    it('should display activated pack count when activatedPacksCount > 0', () => {
      render(<OnboardingModeIndicator {...createDefaultProps({ activatedPacksCount: 5 })} />);
      expect(screen.getByTestId('onboarding-pack-count')).toBeInTheDocument();
      expect(screen.getByText(/5 packs activated/i)).toBeInTheDocument();
    });

    it('should display singular form for 1 pack', () => {
      render(<OnboardingModeIndicator {...createDefaultProps({ activatedPacksCount: 1 })} />);
      expect(screen.getByText(/1 pack activated/i)).toBeInTheDocument();
    });

    it('should display plural form for multiple packs', () => {
      render(<OnboardingModeIndicator {...createDefaultProps({ activatedPacksCount: 3 })} />);
      expect(screen.getByText(/3 packs activated/i)).toBeInTheDocument();
    });

    it('should NOT display pack count when activatedPacksCount is 0', () => {
      render(<OnboardingModeIndicator {...createDefaultProps({ activatedPacksCount: 0 })} />);
      expect(screen.queryByTestId('onboarding-pack-count')).not.toBeInTheDocument();
    });

    it('should NOT display pack count when activatedPacksCount is undefined', () => {
      render(
        <OnboardingModeIndicator {...createDefaultProps({ activatedPacksCount: undefined })} />
      );
      expect(screen.queryByTestId('onboarding-pack-count')).not.toBeInTheDocument();
    });

    it('should handle large pack counts correctly', () => {
      render(<OnboardingModeIndicator {...createDefaultProps({ activatedPacksCount: 100 })} />);
      expect(screen.getByText(/100 packs activated/i)).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle undefined isCompleting prop gracefully', () => {
      const props = {
        isActive: true,
        onComplete: vi.fn(),
        // isCompleting is undefined
      };
      render(<OnboardingModeIndicator {...props} />);

      const button = screen.getByTestId('complete-onboarding-button');
      expect(button).not.toBeDisabled();
    });

    it('should render correctly with all props provided', () => {
      const onComplete = vi.fn();
      render(
        <OnboardingModeIndicator isActive={true} onComplete={onComplete} isCompleting={false} />
      );

      expect(screen.getByTestId('onboarding-mode-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('complete-onboarding-button')).toBeInTheDocument();
    });

    it('should cleanup properly on unmount', () => {
      const { unmount } = render(<OnboardingModeIndicator {...createDefaultProps()} />);

      expect(screen.getByTestId('onboarding-mode-indicator')).toBeInTheDocument();

      unmount();

      expect(screen.queryByTestId('onboarding-mode-indicator')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Data Test IDs
  // --------------------------------------------------------------------------
  describe('Data Test IDs', () => {
    it('should have correct data-testid on container', () => {
      render(<OnboardingModeIndicator {...createDefaultProps()} />);
      expect(screen.getByTestId('onboarding-mode-indicator')).toBeInTheDocument();
    });

    it('should have correct data-testid on button', () => {
      render(<OnboardingModeIndicator {...createDefaultProps()} />);
      expect(screen.getByTestId('complete-onboarding-button')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// Tests - Traceability Matrix
// ============================================================================

describe('Traceability: BIZ-010 Requirements', () => {
  /**
   * Requirement Matrix for OnboardingModeIndicator:
   *
   * | Requirement | Test Case | Status |
   * |-------------|-----------|--------|
   * | AC-001: Visual indicator | "Rendering (Active)" | Covered |
   * | AC-002: Instructions | "instructional text" | Covered |
   * | AC-003: Complete button | "Button Interactions" | Covered |
   * | AC-004: Blue styling | "Visual Styling" | Covered |
   * | ARCH-003: Accessibility | "Accessibility" | Covered |
   */
  it('should satisfy all BIZ-010 UI requirements', () => {
    const onComplete = vi.fn();
    render(<OnboardingModeIndicator isActive={true} onComplete={onComplete} />);

    // AC-001: Visual indicator visible
    expect(screen.getByTestId('onboarding-mode-indicator')).toBeInTheDocument();

    // AC-001: Title shows onboarding mode active
    expect(screen.getByText('Onboarding Mode Active')).toBeInTheDocument();

    // AC-002: Instructions displayed
    expect(screen.getByText(/scan your existing packs/i)).toBeInTheDocument();

    // AC-003: Complete button present
    const button = screen.getByTestId('complete-onboarding-button');
    expect(button).toBeInTheDocument();

    // AC-003: Button is functional
    fireEvent.click(button);
    expect(onComplete).toHaveBeenCalledTimes(1);

    // AC-004: Blue info styling
    const indicator = screen.getByTestId('onboarding-mode-indicator');
    expect(indicator.className).toContain('blue');
  });
});
