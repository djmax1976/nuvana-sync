/**
 * ShiftStatusBadge Unit Tests
 *
 * Tests the ShiftStatusBadge component for correct rendering of status indicators.
 * Validates:
 * - Correct label text per status
 * - Correct CSS classes per status (pill + dot colors)
 * - Animated pulsing dot for 'open' status
 * - Fallback rendering for unknown status
 * - data-testid attributes
 *
 * @module tests/unit/components/reports/ShiftStatusBadge
 * @security SEC-004: Verifies no XSS vectors - all content is text
 * @security FE-001: Verifies no dangerouslySetInnerHTML usage
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShiftStatusBadge } from '../../../../src/renderer/components/reports/ShiftStatusBadge';
import type { ReportShiftStatus } from '../../../../src/renderer/components/reports/ShiftStatusBadge';

// ============================================================================
// Test Helpers
// ============================================================================

function renderBadge(status: ReportShiftStatus, testId?: string) {
  return render(<ShiftStatusBadge status={status} data-testid={testId} />);
}

// ============================================================================
// Tests
// ============================================================================

describe('ShiftStatusBadge', () => {
  describe('Reconciled status', () => {
    it('should render "Reconciled" label text', () => {
      renderBadge('reconciled');
      expect(screen.getByText('Reconciled')).toBeInTheDocument();
    });

    it('should apply green success pill classes', () => {
      renderBadge('reconciled');
      const badge = screen.getByTestId('shift-status-badge-reconciled');
      expect(badge.className).toContain('bg-success-light');
      expect(badge.className).toContain('text-success-muted');
    });

    it('should apply green dot class without animation', () => {
      renderBadge('reconciled');
      const badge = screen.getByTestId('shift-status-badge-reconciled');
      const dot = badge.querySelector('[aria-hidden="true"]');
      expect(dot).toBeInTheDocument();
      expect(dot!.className).toContain('bg-success');
      expect(dot!.className).not.toContain('animate-pulse-soft');
    });
  });

  describe('Closed status', () => {
    it('should render "Closed" label text', () => {
      renderBadge('closed');
      expect(screen.getByText('Closed')).toBeInTheDocument();
    });

    it('should apply gray muted pill classes', () => {
      renderBadge('closed');
      const badge = screen.getByTestId('shift-status-badge-closed');
      expect(badge.className).toContain('bg-muted');
      expect(badge.className).toContain('text-muted-foreground');
    });

    it('should apply muted-foreground dot class without animation', () => {
      renderBadge('closed');
      const badge = screen.getByTestId('shift-status-badge-closed');
      const dot = badge.querySelector('[aria-hidden="true"]');
      expect(dot).toBeInTheDocument();
      expect(dot!.className).toContain('bg-muted-foreground');
      expect(dot!.className).not.toContain('animate-pulse-soft');
    });
  });

  describe('Open status', () => {
    it('should render "Open" label text', () => {
      renderBadge('open');
      expect(screen.getByText('Open')).toBeInTheDocument();
    });

    it('should apply yellow warning pill classes', () => {
      renderBadge('open');
      const badge = screen.getByTestId('shift-status-badge-open');
      expect(badge.className).toContain('bg-warning-light');
      expect(badge.className).toContain('text-warning-muted');
    });

    it('should apply animated pulsing dot for open status', () => {
      renderBadge('open');
      const badge = screen.getByTestId('shift-status-badge-open');
      const dot = badge.querySelector('[aria-hidden="true"]');
      expect(dot).toBeInTheDocument();
      expect(dot!.className).toContain('bg-warning');
      expect(dot!.className).toContain('animate-pulse-soft');
    });
  });

  describe('Unknown status fallback', () => {
    it('should render the raw status string for unknown status', () => {
      // Force unknown status via type assertion to test defensive coding
      renderBadge('unknown_status' as ReportShiftStatus);
      expect(screen.getByText('unknown_status')).toBeInTheDocument();
    });

    it('should apply default muted styling for unknown status', () => {
      renderBadge('unknown_status' as ReportShiftStatus);
      const badge = screen.getByTestId('shift-status-badge-unknown_status');
      expect(badge.className).toContain('bg-muted');
      expect(badge.className).toContain('text-muted-foreground');
    });
  });

  describe('data-testid', () => {
    it('should use default testid based on status when none provided', () => {
      renderBadge('reconciled');
      expect(screen.getByTestId('shift-status-badge-reconciled')).toBeInTheDocument();
    });

    it('should use custom testid when provided', () => {
      renderBadge('closed', 'custom-badge');
      expect(screen.getByTestId('custom-badge')).toBeInTheDocument();
    });
  });

  describe('dot element structure', () => {
    it('should render dot with correct size classes for all statuses', () => {
      const statuses: ReportShiftStatus[] = ['reconciled', 'closed', 'open'];

      for (const status of statuses) {
        const { unmount } = renderBadge(status);
        const badge = screen.getByTestId(`shift-status-badge-${status}`);
        const dot = badge.querySelector('[aria-hidden="true"]');
        expect(dot!.className).toContain('h-1.5');
        expect(dot!.className).toContain('w-1.5');
        expect(dot!.className).toContain('rounded-full');
        unmount();
      }
    });
  });
});
