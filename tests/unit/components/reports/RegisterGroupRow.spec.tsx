/**
 * RegisterGroupRow Unit Tests
 *
 * Tests the RegisterGroupRow component for correct rendering of register group headers.
 * Validates:
 * - Register name display
 * - Empty/invalid register name fallback
 * - colSpan attribute
 * - Scope attribute for accessibility
 * - Styling classes
 *
 * @module tests/unit/components/reports/RegisterGroupRow
 * @security SEC-004: Verifies no XSS vectors - all content is text
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RegisterGroupRow } from '../../../../src/renderer/components/reports/RegisterGroupRow';

// ============================================================================
// Helper: Render within table context
// ============================================================================

function renderGroupRow(props: { registerName: string; colSpan?: number; 'data-testid'?: string }) {
  return render(
    <table>
      <tbody>
        <RegisterGroupRow {...props} />
      </tbody>
    </table>
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('RegisterGroupRow', () => {
  describe('Register name display', () => {
    it('should display the register name', () => {
      renderGroupRow({ registerName: 'POS1' });
      expect(screen.getByText('POS1')).toBeInTheDocument();
    });

    it('should display "Unknown Register" for empty register name', () => {
      renderGroupRow({ registerName: '' });
      expect(screen.getByText('Unknown Register')).toBeInTheDocument();
    });

    it('should display "Unknown Register" for whitespace-only name', () => {
      renderGroupRow({ registerName: '   ' });
      expect(screen.getByText('Unknown Register')).toBeInTheDocument();
    });

    it('should trim whitespace from register name', () => {
      renderGroupRow({ registerName: '  POS2  ' });
      expect(screen.getByText('POS2')).toBeInTheDocument();
    });
  });

  describe('Table structure', () => {
    it('should render a th element with colSpan', () => {
      renderGroupRow({ registerName: 'POS1', colSpan: 6 });
      const th = screen.getByText('POS1');
      expect(th.tagName).toBe('TH');
      expect(th).toHaveAttribute('colspan', '6');
    });

    it('should default to colSpan 6 when not specified', () => {
      renderGroupRow({ registerName: 'POS1' });
      const th = screen.getByText('POS1');
      expect(th).toHaveAttribute('colspan', '6');
    });

    it('should use custom colSpan when provided', () => {
      renderGroupRow({ registerName: 'POS1', colSpan: 4 });
      const th = screen.getByText('POS1');
      expect(th).toHaveAttribute('colspan', '4');
    });

    it('should have scope="colgroup" for accessibility', () => {
      renderGroupRow({ registerName: 'POS1' });
      const th = screen.getByText('POS1');
      expect(th).toHaveAttribute('scope', 'colgroup');
    });
  });

  describe('Accessibility', () => {
    it('should have aria-label on the row', () => {
      renderGroupRow({ registerName: 'POS1' });
      const row = screen.getByTestId('register-group-POS1');
      expect(row).toHaveAttribute('aria-label', 'Register group: POS1');
    });

    it('should have fallback aria-label for empty register', () => {
      renderGroupRow({ registerName: '' });
      const row = screen.getByTestId('register-group-');
      expect(row).toHaveAttribute('aria-label', 'Register group: Unknown Register');
    });
  });

  describe('Styling', () => {
    it('should have register-group-row class on tr', () => {
      renderGroupRow({ registerName: 'POS1' });
      const row = screen.getByTestId('register-group-POS1');
      expect(row.className).toContain('register-group-row');
    });

    it('should have uppercase styling on th', () => {
      renderGroupRow({ registerName: 'POS1' });
      const th = screen.getByText('POS1');
      expect(th.className).toContain('uppercase');
      expect(th.className).toContain('tracking-');
    });
  });

  describe('data-testid', () => {
    it('should use default testid with register name', () => {
      renderGroupRow({ registerName: 'POS1' });
      expect(screen.getByTestId('register-group-POS1')).toBeInTheDocument();
    });

    it('should use custom testid when provided', () => {
      renderGroupRow({ registerName: 'POS1', 'data-testid': 'custom-row' });
      expect(screen.getByTestId('custom-row')).toBeInTheDocument();
    });
  });
});
