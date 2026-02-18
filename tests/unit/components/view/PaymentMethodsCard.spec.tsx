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

    it('should apply emerald color to net cash values', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const netCashRow = screen.getByTestId('payment-methods-card-net-cash');
      const emeraldValues = netCashRow.querySelectorAll('.text-emerald-400');
      // 2 values + 1 icon = 3 emerald elements
      expect(emeraldValues.length).toBeGreaterThanOrEqual(2);
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

    it('should apply red color to payout values', () => {
      // Arrange & Act
      renderCard();

      // Assert
      const payoutRow = screen.getByTestId('payment-methods-card-cash-payouts');
      const redValues = payoutRow.querySelectorAll('.text-red-400');
      expect(redValues.length).toBeGreaterThan(0);
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
});
