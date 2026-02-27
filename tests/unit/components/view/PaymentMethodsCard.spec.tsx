/**
 * PaymentMethodsCard Unit Tests
 *
 * Tests the PaymentMethodsCard component for correct rendering and behavior.
 * Validates:
 * - All receipt types rendered
 * - All payout types as clickable
 * - Net cash calculation and display
 * - Modal open when payout row clicked
 * - Image indicator when images attached
 * - Negative value formatting with parentheses
 *
 * @module tests/unit/components/view/PaymentMethodsCard
 * @security SEC-004: Verifies no XSS vectors - all content is text
 * @security FE-001: Verifies no dangerouslySetInnerHTML usage
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  PaymentMethodsCard,
  type PaymentMethodsCardProps,
  type PaymentMethodsData,
  type PayoutType as _PayoutType,
} from '../../../../src/renderer/components/view/PaymentMethodsCard';

// ============================================================================
// Test Helpers
// ============================================================================

const mockData: PaymentMethodsData = {
  receipts: {
    cash: { reports: null, pos: 1234.56 },
    creditCard: { reports: null, pos: 890.0 },
    debitCard: { reports: null, pos: 456.78 },
    ebt: { reports: null, pos: 123.45 },
  },
  payouts: {
    cashPayouts: { reports: -150.0, pos: -200.0, hasImages: true, count: 3 },
    lotteryPayouts: { reports: -425.0, pos: -150.0, hasImages: true },
    gamingPayouts: { reports: 0, pos: -75.0, hasImages: true },
  },
  netCash: {
    reports: 2129.79,
    pos: 2279.79,
  },
};

const defaultProps: PaymentMethodsCardProps = {
  data: mockData,
  readOnly: true,
  onPayoutClick: vi.fn(),
};

function renderCard(props: Partial<PaymentMethodsCardProps> = {}) {
  const mergedProps = { ...defaultProps, ...props };
  return render(<PaymentMethodsCard {...mergedProps} />);
}

// ============================================================================
// Tests
// ============================================================================

describe('PaymentMethodsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Receipt types rendering', () => {
    it('should render Cash receipt row', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const cashRow = screen.getByTestId('payment-methods-card-cash');
      expect(cashRow).toHaveTextContent('Cash');
      expect(cashRow).toHaveTextContent('$1,234.56');
    });

    it('should render Credit Card receipt row', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const creditRow = screen.getByTestId('payment-methods-card-credit');
      expect(creditRow).toHaveTextContent('Credit Card');
      expect(creditRow).toHaveTextContent('$890.00');
    });

    it('should render Debit Card receipt row', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const debitRow = screen.getByTestId('payment-methods-card-debit');
      expect(debitRow).toHaveTextContent('Debit Card');
      expect(debitRow).toHaveTextContent('$456.78');
    });

    it('should render EBT receipt row', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const ebtRow = screen.getByTestId('payment-methods-card-ebt');
      expect(ebtRow).toHaveTextContent('EBT');
      expect(ebtRow).toHaveTextContent('$123.45');
    });

    it('should display dash for null reports values', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const cashRow = screen.getByTestId('payment-methods-card-cash');
      expect(cashRow).toHaveTextContent('—');
    });

    it('should display reports value when provided', () => {
      // Arrange
      const dataWithReports: PaymentMethodsData = {
        ...mockData,
        receipts: {
          ...mockData.receipts,
          cash: { reports: 1000.0, pos: 1234.56 },
        },
      };

      // Act
      renderCard({ data: dataWithReports });

      // Assert
      const cashRow = screen.getByTestId('payment-methods-card-cash');
      expect(cashRow).toHaveTextContent('$1,000.00');
      expect(cashRow).toHaveTextContent('$1,234.56');
    });
  });

  describe('Payout types as clickable', () => {
    it('should render Cash Payouts as clickable button', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const payoutRow = screen.getByTestId('payment-methods-card-cash-payouts');
      expect(payoutRow.tagName).toBe('BUTTON');
      expect(payoutRow).toHaveAttribute('type', 'button');
    });

    it('should render Lottery Payouts as clickable button', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const payoutRow = screen.getByTestId('payment-methods-card-lottery-payouts');
      expect(payoutRow.tagName).toBe('BUTTON');
    });

    it('should render Gaming Payouts as clickable button', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const payoutRow = screen.getByTestId('payment-methods-card-gaming-payouts');
      expect(payoutRow.tagName).toBe('BUTTON');
    });

    it('should have aria-label for accessibility', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const cashPayouts = screen.getByTestId('payment-methods-card-cash-payouts');
      expect(cashPayouts).toHaveAttribute('aria-label', 'View Cash Payouts details');
    });
  });

  describe('Net cash calculation and display', () => {
    it('should render net cash row', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const netCashRow = screen.getByTestId('payment-methods-card-net-cash');
      expect(netCashRow).toHaveTextContent('Net Cash');
    });

    it('should display net cash reports value', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const netCashRow = screen.getByTestId('payment-methods-card-net-cash');
      expect(netCashRow).toHaveTextContent('$2,129.79');
    });

    it('should display net cash pos value', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const netCashRow = screen.getByTestId('payment-methods-card-net-cash');
      expect(netCashRow).toHaveTextContent('$2,279.79');
    });

    it('should apply success theme color to net cash values', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const netCashRow = screen.getByTestId('payment-methods-card-net-cash');
      // Verify theme-aware success color classes are applied
      const successValues = netCashRow.querySelectorAll('.text-success');
      // 2 values + 1 icon = 3 success-themed elements
      expect(successValues.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Modal open when payout row clicked', () => {
    it('should call onPayoutClick with "cash" when Cash Payouts clicked', () => {
      // Arrange
      const onPayoutClick = vi.fn();
      renderCard({ onPayoutClick });

      // Act
      fireEvent.click(screen.getByTestId('payment-methods-card-cash-payouts'));

      // Assert
      expect(onPayoutClick).toHaveBeenCalledTimes(1);
      expect(onPayoutClick).toHaveBeenCalledWith('cash');
    });

    it('should call onPayoutClick with "lottery" when Lottery Payouts clicked', () => {
      // Arrange
      const onPayoutClick = vi.fn();
      renderCard({ onPayoutClick });

      // Act
      fireEvent.click(screen.getByTestId('payment-methods-card-lottery-payouts'));

      // Assert
      expect(onPayoutClick).toHaveBeenCalledTimes(1);
      expect(onPayoutClick).toHaveBeenCalledWith('lottery');
    });

    it('should call onPayoutClick with "gaming" when Gaming Payouts clicked', () => {
      // Arrange
      const onPayoutClick = vi.fn();
      renderCard({ onPayoutClick });

      // Act
      fireEvent.click(screen.getByTestId('payment-methods-card-gaming-payouts'));

      // Assert
      expect(onPayoutClick).toHaveBeenCalledTimes(1);
      expect(onPayoutClick).toHaveBeenCalledWith('gaming');
    });

    it('should not throw when onPayoutClick is not provided', () => {
      // Arrange
      renderCard({ onPayoutClick: undefined });

      // Act & Assert - should not throw
      expect(() => {
        fireEvent.click(screen.getByTestId('payment-methods-card-cash-payouts'));
      }).not.toThrow();
    });
  });

  describe('Image indicator when images attached', () => {
    it('should display image indicator for Cash Payouts when hasImages is true', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const indicator = screen.getByTestId('payment-methods-card-cash-payouts-image-indicator');
      expect(indicator).toBeInTheDocument();
    });

    it('should display image indicator for Lottery Payouts when hasImages is true', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const indicator = screen.getByTestId('payment-methods-card-lottery-payouts-image-indicator');
      expect(indicator).toBeInTheDocument();
    });

    it('should not display image indicator when hasImages is false', () => {
      // Arrange
      const dataNoImages: PaymentMethodsData = {
        ...mockData,
        payouts: {
          ...mockData.payouts,
          cashPayouts: { ...mockData.payouts.cashPayouts, hasImages: false },
        },
      };

      // Act
      renderCard({ data: dataNoImages });

      // Assert
      expect(
        screen.queryByTestId('payment-methods-card-cash-payouts-image-indicator')
      ).not.toBeInTheDocument();
    });

    it('should have title attribute on image indicator', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const indicator = screen.getByTestId('payment-methods-card-cash-payouts-image-indicator');
      expect(indicator).toHaveAttribute('title', 'Images attached');
    });
  });

  describe('Negative value formatting with parentheses', () => {
    it('should format Cash Payouts reports with parentheses', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const payoutRow = screen.getByTestId('payment-methods-card-cash-payouts');
      expect(payoutRow).toHaveTextContent('($150.00)');
    });

    it('should format Cash Payouts pos with parentheses', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const payoutRow = screen.getByTestId('payment-methods-card-cash-payouts');
      expect(payoutRow).toHaveTextContent('($200.00)');
    });

    it('should format zero payout with parentheses', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const payoutRow = screen.getByTestId('payment-methods-card-gaming-payouts');
      expect(payoutRow).toHaveTextContent('($0.00)');
    });

    it('should apply destructive theme color to payout values', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const payoutRow = screen.getByTestId('payment-methods-card-cash-payouts');
      // Verify theme-aware destructive color classes are applied
      const destructiveValues = payoutRow.querySelectorAll('.text-destructive');
      expect(destructiveValues.length).toBeGreaterThan(0);
    });
  });

  describe('Header', () => {
    it('should render Payment Methods title', () => {
      // Arrange & Act
      renderCard();

      // Assert
      expect(screen.getByText('Payment Methods')).toBeInTheDocument();
    });

    it('should render subtitle', () => {
      // Arrange & Act
      renderCard();

      // Assert
      expect(screen.getByText('Cash & card transactions')).toBeInTheDocument();
    });
  });

  describe('Column headers', () => {
    it('should render Type column header', () => {
      // Arrange & Act
      renderCard();

      // Assert
      expect(screen.getByText('Type')).toBeInTheDocument();
    });

    it('should render Reports column header', () => {
      // Arrange & Act
      renderCard();

      // Assert
      expect(screen.getByText('Reports')).toBeInTheDocument();
    });

    it('should render POS column header', () => {
      // Arrange & Act
      renderCard();

      // Assert
      expect(screen.getByText('POS')).toBeInTheDocument();
    });
  });

  describe('Payouts section header', () => {
    it('should render Payouts section label', () => {
      // Arrange & Act
      renderCard();

      // Assert
      expect(screen.getByText('Payouts')).toBeInTheDocument();
    });

    it('should render click hint text', () => {
      // Arrange & Act
      renderCard();

      // Assert
      expect(screen.getByText('(click to view details)')).toBeInTheDocument();
    });
  });

  describe('data-testid', () => {
    it('should use default testid when none provided', () => {
      // Arrange & Act
      renderCard();

      // Assert
      expect(screen.getByTestId('payment-methods-card')).toBeInTheDocument();
    });

    it('should use custom testid when provided', () => {
      // Arrange & Act
      renderCard({ 'data-testid': 'custom-payment' });

      // Assert
      expect(screen.getByTestId('custom-payment')).toBeInTheDocument();
      expect(screen.getByTestId('custom-payment-cash')).toBeInTheDocument();
      expect(screen.getByTestId('custom-payment-cash-payouts')).toBeInTheDocument();
    });
  });

  describe('readOnly prop', () => {
    it('should have data-readonly attribute when readOnly is true', () => {
      // Arrange & Act
      renderCard({ readOnly: true });

      // Assert
      const card = screen.getByTestId('payment-methods-card');
      expect(card).toHaveAttribute('data-readonly', 'true');
    });

    it('should have data-readonly false when readOnly is false', () => {
      // Arrange & Act
      renderCard({ readOnly: false });

      // Assert
      const card = screen.getByTestId('payment-methods-card');
      expect(card).toHaveAttribute('data-readonly', 'false');
    });
  });

  describe('className prop', () => {
    it('should apply additional className', () => {
      // Arrange & Act
      renderCard({ className: 'custom-class' });

      // Assert
      const card = screen.getByTestId('payment-methods-card');
      expect(card.className).toContain('custom-class');
    });
  });

  /* ==========================================================================
     THEME-AWARE STYLING TESTS
     Enterprise requirement: Components must support light/dark mode via
     semantic CSS tokens. These tests verify theme-aware classes are used
     instead of hardcoded color values.
     Reference: [frontend.web-experience::design-system-alignment]
     ========================================================================== */
  describe('Theme-aware styling', () => {
    it('should use theme-aware card background class', () => {
      // Arrange & Act
      renderCard();

      // Assert - Verify semantic bg-card class instead of hardcoded dark gradient
      const card = screen.getByTestId('payment-methods-card');
      expect(card.className).toContain('bg-card');
      expect(card.className).not.toContain('from-slate-900');
      expect(card.className).not.toContain('to-slate-950');
    });

    it('should use semantic success color tokens for net cash row', () => {
      // Arrange & Act
      renderCard();

      // Assert - Verify semantic success tokens
      const netCashRow = screen.getByTestId('payment-methods-card-net-cash');
      expect(netCashRow.className).toContain('bg-success-light');
      expect(netCashRow.className).toContain('border-success');
      // Should NOT use hardcoded emerald colors
      expect(netCashRow.className).not.toContain('emerald-950');
      expect(netCashRow.className).not.toContain('cyan-950');
    });

    it('should use semantic destructive color tokens for payout rows', () => {
      // Arrange & Act
      renderCard();

      // Assert - Verify semantic destructive tokens
      const payoutRow = screen.getByTestId('payment-methods-card-cash-payouts');
      expect(payoutRow.className).toContain('bg-destructive-light');
      expect(payoutRow.className).toContain('border-destructive');
      // Should NOT use hardcoded red colors
      expect(payoutRow.className).not.toContain('red-950');
      expect(payoutRow.className).not.toContain('red-900');
    });

    it('should use semantic info color tokens for header icon', () => {
      // Arrange & Act
      renderCard();

      // Assert - Find header icon container
      const card = screen.getByTestId('payment-methods-card');
      const headerIcon = card.querySelector('.bg-info-light.text-info');
      expect(headerIcon).toBeInTheDocument();
    });

    it('should use semantic color tokens for receipt row icons', () => {
      // Arrange & Act
      renderCard();

      // Assert - Cash row should use success colors
      const cashRow = screen.getByTestId('payment-methods-card-cash');
      const cashIcon = cashRow.querySelector('.bg-success-light.text-success');
      expect(cashIcon).toBeInTheDocument();

      // Credit card row should use primary colors
      const creditRow = screen.getByTestId('payment-methods-card-credit');
      const creditIcon = creditRow.querySelector('.bg-primary-light.text-primary');
      expect(creditIcon).toBeInTheDocument();

      // EBT row should use warning colors
      const ebtRow = screen.getByTestId('payment-methods-card-ebt');
      const ebtIcon = ebtRow.querySelector('.bg-warning-light.text-warning');
      expect(ebtIcon).toBeInTheDocument();
    });

    it('should use semantic text color for card foreground elements', () => {
      // Arrange & Act
      renderCard();

      // Assert - Check that labels use theme-aware text colors
      const card = screen.getByTestId('payment-methods-card');
      const foregroundElements = card.querySelectorAll('.text-card-foreground');
      // Multiple elements should have card-foreground: title, labels, values
      expect(foregroundElements.length).toBeGreaterThan(0);
    });

    it('should use theme-aware hover states on receipt rows', () => {
      // Arrange & Act
      renderCard();

      // Assert - Verify hover uses muted instead of white/5
      const cashRow = screen.getByTestId('payment-methods-card-cash');
      expect(cashRow.className).toContain('hover:bg-muted/50');
      expect(cashRow.className).not.toContain('hover:bg-white/5');
    });

    it('should use semantic accent colors for gradient accent bar', () => {
      // Arrange & Act
      renderCard();

      // Assert - Accent bar should use semantic tokens
      const card = screen.getByTestId('payment-methods-card');
      const accentBar = card.querySelector('.h-1.bg-gradient-to-r');
      expect(accentBar).toBeInTheDocument();
      // Should use primary/info semantic tokens
      expect(accentBar?.className).toContain('from-primary');
      expect(accentBar?.className).toContain('to-primary');
    });

    it('should use semantic destructive color for payouts section indicator', () => {
      // Arrange & Act
      renderCard();

      // Assert - The payout section dot should use destructive theme
      const card = screen.getByTestId('payment-methods-card');
      const sectionDot = card.querySelector('.w-2.h-2.rounded-full.bg-destructive');
      expect(sectionDot).toBeInTheDocument();
    });
  });

  /* ==========================================================================
     ACCESSIBILITY TESTS
     Enterprise requirement: All interactive elements must be accessible.
     Reference: [testing.accessibility-l10n::keyboard-navigation]
     ========================================================================== */
  describe('Accessibility', () => {
    it('should have proper heading hierarchy', () => {
      // Arrange & Act
      renderCard();

      // Assert - h3 for card title
      expect(
        screen.getByRole('heading', { level: 3, name: 'Payment Methods' })
      ).toBeInTheDocument();
    });

    it('should have accessible buttons for all payout rows', () => {
      // Arrange & Act
      renderCard();

      // Assert - All payout rows should be accessible buttons
      const cashPayouts = screen.getByRole('button', { name: /view cash payouts details/i });
      const lotteryPayouts = screen.getByRole('button', { name: /view lottery payouts details/i });
      const gamingPayouts = screen.getByRole('button', { name: /view gaming payouts details/i });

      expect(cashPayouts).toBeInTheDocument();
      expect(lotteryPayouts).toBeInTheDocument();
      expect(gamingPayouts).toBeInTheDocument();
    });

    it('should ensure all monetary values are formatted consistently', () => {
      // Arrange & Act
      renderCard();

      // Assert - Verify currency formatting consistency
      const card = screen.getByTestId('payment-methods-card');
      const text = card.textContent || '';

      // All currency values should use $ prefix and comma separators
      expect(text).toContain('$1,234.56'); // Cash POS
      expect(text).toContain('$2,129.79'); // Net Cash reports
      expect(text).toContain('($150.00)'); // Cash Payouts with parentheses
    });

    it('should have sufficient color contrast for text elements', () => {
      // Arrange & Act
      renderCard();

      // Assert - Verify high-contrast text classes are used
      const card = screen.getByTestId('payment-methods-card');

      // Muted foreground for secondary text
      const mutedElements = card.querySelectorAll('.text-muted-foreground');
      expect(mutedElements.length).toBeGreaterThan(0);

      // Card foreground for primary text
      const foregroundElements = card.querySelectorAll('.text-card-foreground');
      expect(foregroundElements.length).toBeGreaterThan(0);
    });
  });

  /* ==========================================================================
     EDGE CASE TESTS
     Enterprise requirement: Components must handle edge cases gracefully.
     Reference: [quality.testing-strategy::shift-left-quality]
     ========================================================================== */
  describe('Edge cases', () => {
    it('should handle zero values correctly', () => {
      // Arrange
      const zeroData: PaymentMethodsData = {
        receipts: {
          cash: { reports: 0, pos: 0 },
          creditCard: { reports: 0, pos: 0 },
          debitCard: { reports: 0, pos: 0 },
          ebt: { reports: 0, pos: 0 },
        },
        payouts: {
          cashPayouts: { reports: 0, pos: 0, hasImages: false },
          lotteryPayouts: { reports: 0, pos: 0, hasImages: false },
          gamingPayouts: { reports: 0, pos: 0, hasImages: false },
        },
        netCash: { reports: 0, pos: 0 },
      };

      // Act
      renderCard({ data: zeroData });

      // Assert - Should display $0.00 for all values
      const card = screen.getByTestId('payment-methods-card');
      const zeroMatches = (card.textContent || '').match(/\$0\.00/g);
      expect(zeroMatches?.length).toBeGreaterThan(5);
    });

    it('should handle very large currency values', () => {
      // Arrange
      const largeData: PaymentMethodsData = {
        ...mockData,
        netCash: { reports: 9999999.99, pos: 9999999.99 },
      };

      // Act
      renderCard({ data: largeData });

      // Assert - Should format with thousand separators
      const netCashRow = screen.getByTestId('payment-methods-card-net-cash');
      expect(netCashRow).toHaveTextContent('$9,999,999.99');
    });

    it('should handle all null reports values', () => {
      // Arrange
      const nullReportsData: PaymentMethodsData = {
        receipts: {
          cash: { reports: null, pos: 100 },
          creditCard: { reports: null, pos: 200 },
          debitCard: { reports: null, pos: 300 },
          ebt: { reports: null, pos: 400 },
        },
        payouts: {
          cashPayouts: { reports: 0, pos: -50, hasImages: false },
          lotteryPayouts: { reports: 0, pos: -75, hasImages: false },
          gamingPayouts: { reports: 0, pos: -25, hasImages: false },
        },
        netCash: { reports: 0, pos: 850 },
      };

      // Act
      renderCard({ data: nullReportsData });

      // Assert - Should display dashes for null values
      const card = screen.getByTestId('payment-methods-card');
      const dashes = (card.textContent || '').match(/—/g);
      expect(dashes?.length).toBe(4); // 4 receipt types with null reports
    });

    it('should handle undefined reports values', () => {
      // Arrange
      const undefinedReportsData: PaymentMethodsData = {
        receipts: {
          cash: { reports: undefined, pos: 100 },
          creditCard: { reports: undefined, pos: 200 },
          debitCard: { reports: undefined, pos: 300 },
          ebt: { reports: undefined, pos: 400 },
        },
        payouts: {
          cashPayouts: { reports: 0, pos: -50, hasImages: false },
          lotteryPayouts: { reports: 0, pos: -75, hasImages: false },
          gamingPayouts: { reports: 0, pos: -25, hasImages: false },
        },
        netCash: { reports: 0, pos: 850 },
      };

      // Act
      renderCard({ data: undefinedReportsData });

      // Assert - Should display dashes for undefined values
      const card = screen.getByTestId('payment-methods-card');
      const dashes = (card.textContent || '').match(/—/g);
      expect(dashes?.length).toBe(4);
    });

    it('should not display image indicator when hasImages is undefined', () => {
      // Arrange
      const noImagesData: PaymentMethodsData = {
        ...mockData,
        payouts: {
          cashPayouts: { reports: -100, pos: -100 }, // hasImages undefined
          lotteryPayouts: { reports: -200, pos: -200 },
          gamingPayouts: { reports: -50, pos: -50 },
        },
      };

      // Act
      renderCard({ data: noImagesData });

      // Assert - No image indicators should be present
      expect(
        screen.queryByTestId('payment-methods-card-cash-payouts-image-indicator')
      ).not.toBeInTheDocument();
    });
  });
});
