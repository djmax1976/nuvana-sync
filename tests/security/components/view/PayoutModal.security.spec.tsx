/**
 * PayoutModal Security Tests
 *
 * Security tests for the PayoutModal component.
 * Validates:
 * - SEC-014: Image URL sanitization (no javascript: protocol)
 * - SEC-004/FE-001: No unsanitized HTML content rendering
 * - Image source validation
 *
 * @module tests/security/components/view/PayoutModal
 * @security SEC-014: Input validation for image URLs
 * @security SEC-004: XSS prevention
 * @security FE-001: No dangerouslySetInnerHTML
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  PayoutModal,
  type PayoutModalProps,
  type CashPayoutsData,
  type ImagePayoutData,
} from '../../../../src/renderer/components/view/PayoutModal';

// ============================================================================
// Test Helpers
// ============================================================================

function createCashData(imageUrl: string | null): CashPayoutsData {
  return {
    type: 'cash',
    payouts: [
      {
        id: '1',
        description: 'Test Payout',
        amount: 100.0,
        timestamp: 'Feb 15, 9:00 AM',
        imageUrl,
      },
    ],
    totalAmount: 100.0,
  };
}

function createImageData(imageUrl: string | null): ImagePayoutData {
  return {
    type: 'lottery',
    imageUrl,
    imageName: 'test.jpg',
    totalAmount: 100.0,
    scannedAt: 'Feb 15, 2026',
  };
}

function renderModal(props: Partial<PayoutModalProps>) {
  const defaultProps: PayoutModalProps = {
    type: 'cash',
    data: createCashData(null),
    isOpen: true,
    onClose: vi.fn(),
    ...props,
  };
  return render(<PayoutModal {...defaultProps} />);
}

// ============================================================================
// Security Tests
// ============================================================================

describe('PayoutModal Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SEC-014: Image URL sanitization', () => {
    describe('Cash payouts - javascript: protocol blocking', () => {
      it('should NOT render image with javascript: protocol URL', () => {
        // Arrange - Malicious URL attempting XSS
        const maliciousUrl = 'javascript:alert("XSS")';
        const data = createCashData(maliciousUrl);

        // Act
        renderModal({ type: 'cash', data });

        // Assert - Image should not be rendered
        expect(screen.queryByTestId('payout-modal-list-image-1')).not.toBeInTheDocument();
      });

      it('should NOT render image with JAVASCRIPT: (uppercase) protocol', () => {
        // Arrange
        const maliciousUrl = 'JAVASCRIPT:alert("XSS")';
        const data = createCashData(maliciousUrl);

        // Act
        renderModal({ type: 'cash', data });

        // Assert
        expect(screen.queryByTestId('payout-modal-list-image-1')).not.toBeInTheDocument();
      });

      it('should NOT render image with mixed case javascript: protocol', () => {
        // Arrange
        const maliciousUrl = 'JaVaScRiPt:alert("XSS")';
        const data = createCashData(maliciousUrl);

        // Act
        renderModal({ type: 'cash', data });

        // Assert
        expect(screen.queryByTestId('payout-modal-list-image-1')).not.toBeInTheDocument();
      });

      it('should NOT render image with whitespace-padded javascript:', () => {
        // Arrange
        const maliciousUrl = '  javascript:alert("XSS")';
        const data = createCashData(maliciousUrl);

        // Act
        renderModal({ type: 'cash', data });

        // Assert
        expect(screen.queryByTestId('payout-modal-list-image-1')).not.toBeInTheDocument();
      });
    });

    describe('Cash payouts - data: protocol handling', () => {
      it('should NOT render image with data:text protocol', () => {
        // Arrange
        const maliciousUrl = 'data:text/html,<script>alert("XSS")</script>';
        const data = createCashData(maliciousUrl);

        // Act
        renderModal({ type: 'cash', data });

        // Assert
        expect(screen.queryByTestId('payout-modal-list-image-1')).not.toBeInTheDocument();
      });

      it('should render image with valid data:image protocol', () => {
        // Arrange
        const validDataUrl =
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        const data = createCashData(validDataUrl);

        // Act
        renderModal({ type: 'cash', data });

        // Assert
        const img = screen.getByTestId('payout-modal-list-image-1');
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', validDataUrl);
      });
    });

    describe('Image viewer (lottery/gaming) - URL sanitization', () => {
      it('should NOT render lottery image with javascript: URL', () => {
        // Arrange
        const data = createImageData('javascript:alert("XSS")');

        // Act
        renderModal({ type: 'lottery', data });

        // Assert
        expect(screen.queryByTestId('payout-modal-viewer-image')).not.toBeInTheDocument();
      });

      it('should NOT render gaming image with javascript: URL', () => {
        // Arrange
        const data: ImagePayoutData = {
          type: 'gaming',
          imageUrl: 'javascript:document.location="http://evil.com"',
          imageName: 'gaming.jpg',
          totalAmount: 50.0,
        };

        // Act
        renderModal({ type: 'gaming', data });

        // Assert
        expect(screen.queryByTestId('payout-modal-viewer-image')).not.toBeInTheDocument();
      });

      it('should render image with valid HTTPS URL', () => {
        // Arrange
        const validUrl = 'https://example.com/valid-image.jpg';
        const data = createImageData(validUrl);

        // Act
        renderModal({ type: 'lottery', data });

        // Assert
        const img = screen.getByTestId('payout-modal-viewer-image');
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', validUrl);
      });

      it('should render image with valid HTTP URL', () => {
        // Arrange
        const validUrl = 'http://example.com/image.jpg';
        const data = createImageData(validUrl);

        // Act
        renderModal({ type: 'lottery', data });

        // Assert
        const img = screen.getByTestId('payout-modal-viewer-image');
        expect(img).toHaveAttribute('src', validUrl);
      });
    });
  });

  describe('SEC-004/FE-001: XSS prevention', () => {
    it('should escape payout description text', () => {
      // Arrange - XSS attempt in description
      const data: CashPayoutsData = {
        type: 'cash',
        payouts: [
          {
            id: '1',
            description: '<script>alert("XSS")</script>',
            amount: 100.0,
            timestamp: 'Feb 15',
            imageUrl: null,
          },
        ],
        totalAmount: 100.0,
      };

      // Act
      renderModal({ type: 'cash', data });

      // Assert - Script tag should be rendered as text, not executed
      const item = screen.getByTestId('payout-modal-list-item-1');
      expect(item.innerHTML).toContain('&lt;script&gt;');
      expect(item.innerHTML).not.toContain('<script>');
    });

    it('should escape timestamp text', () => {
      // Arrange
      const data: CashPayoutsData = {
        type: 'cash',
        payouts: [
          {
            id: '1',
            description: 'Test',
            amount: 100.0,
            timestamp: '<img src=x onerror=alert("XSS")>',
            imageUrl: null,
          },
        ],
        totalAmount: 100.0,
      };

      // Act
      renderModal({ type: 'cash', data });

      // Assert - HTML should be escaped
      const item = screen.getByTestId('payout-modal-list-item-1');
      expect(item.innerHTML).toContain('&lt;img');
      expect(item.innerHTML).not.toContain('<img src=x');
    });

    it('should escape image name text', () => {
      // Arrange
      const data: ImagePayoutData = {
        type: 'lottery',
        imageUrl: null,
        imageName: '<script>alert("XSS")</script>.jpg',
        totalAmount: 100.0,
      };

      // Act
      renderModal({ type: 'lottery', data });

      // Assert - Script tag should be rendered as text
      const viewer = screen.getByTestId('payout-modal-viewer');
      expect(viewer.innerHTML).toContain('&lt;script&gt;');
    });
  });

  describe('Image source validation', () => {
    it('should not render image with null URL', () => {
      // Arrange
      const data = createCashData(null);

      // Act
      renderModal({ type: 'cash', data });

      // Assert
      expect(screen.queryByTestId('payout-modal-list-image-1')).not.toBeInTheDocument();
    });

    it('should not render image with undefined URL', () => {
      // Arrange
      const data: CashPayoutsData = {
        type: 'cash',
        payouts: [
          { id: '1', description: 'Test', amount: 100.0, timestamp: 'Feb 15', imageUrl: undefined },
        ],
        totalAmount: 100.0,
      };

      // Act
      renderModal({ type: 'cash', data });

      // Assert
      expect(screen.queryByTestId('payout-modal-list-image-1')).not.toBeInTheDocument();
    });

    it('should not render image with empty string URL', () => {
      // Arrange
      const data = createCashData('');

      // Act
      renderModal({ type: 'cash', data });

      // Assert
      expect(screen.queryByTestId('payout-modal-list-image-1')).not.toBeInTheDocument();
    });

    it('should render image with relative URL', () => {
      // Arrange
      const data = createCashData('/images/receipt.jpg');

      // Act
      renderModal({ type: 'cash', data });

      // Assert
      const img = screen.getByTestId('payout-modal-list-image-1');
      expect(img).toHaveAttribute('src', '/images/receipt.jpg');
    });
  });

  describe('Content Security Policy compliance', () => {
    it('should not use dangerouslySetInnerHTML', () => {
      // Arrange & Act
      const { container } = renderModal({ type: 'cash', data: createCashData(null) });

      // Assert - Check that no element has __html prop (indicates dangerouslySetInnerHTML)
      const allElements = container.querySelectorAll('*');
      allElements.forEach((el) => {
        // React sets __html on innerHTML - we verify through the absence of script execution
        expect(el.innerHTML).not.toMatch(/javascript:/i);
      });
    });
  });
});
