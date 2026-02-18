/**
 * BinActionsMenu Unit Tests
 *
 * Tests the BinActionsMenu component for correct rendering and behavior:
 * - MoreVertical (⋮) icon trigger
 * - Dropdown menu with Mark Sold and Return options
 * - Callback invocation with pack_id
 * - Stop propagation to prevent row click
 * - Disabled state handling
 * - Accessibility (aria-labels, keyboard navigation)
 *
 * Traceability:
 * - SEC-004: XSS prevention via JSX auto-escaping
 * - SEC-014: Input validation (string pack_id)
 * - ARCH-004: Component-level isolation tests
 * - TEST-005: Single concept per test
 *
 * @module tests/unit/components/lottery/BinActionsMenu
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ============================================================================
// Import Component Under Test
// ============================================================================

import { BinActionsMenu } from '../../../../src/renderer/components/lottery/BinActionsMenu';

// ============================================================================
// Tests
// ============================================================================

describe('BinActionsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render trigger button', () => {
      render(
        <BinActionsMenu
          packId="pack-001"
          packNumber="1234567"
          onMarkSold={vi.fn()}
          onReturn={vi.fn()}
        />
      );
      expect(screen.getByTestId('actions-menu-trigger')).toBeInTheDocument();
    });

    it('should render with custom testIdPrefix', () => {
      render(
        <BinActionsMenu
          packId="pack-001"
          packNumber="1234567"
          onMarkSold={vi.fn()}
          testIdPrefix="bin-123-"
        />
      );
      expect(screen.getByTestId('bin-123-actions-menu-trigger')).toBeInTheDocument();
    });

    it('should render "--" when no actions are provided', () => {
      render(<BinActionsMenu packId="pack-001" packNumber="1234567" />);
      expect(screen.getByText('--')).toBeInTheDocument();
      expect(screen.queryByTestId('actions-menu-trigger')).not.toBeInTheDocument();
    });

    it('should render menu when only onMarkSold is provided', () => {
      render(<BinActionsMenu packId="pack-001" packNumber="1234567" onMarkSold={vi.fn()} />);
      expect(screen.getByTestId('actions-menu-trigger')).toBeInTheDocument();
    });

    it('should render menu when only onReturn is provided', () => {
      render(<BinActionsMenu packId="pack-001" packNumber="1234567" onReturn={vi.fn()} />);
      expect(screen.getByTestId('actions-menu-trigger')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Accessibility
  // --------------------------------------------------------------------------
  describe('Accessibility', () => {
    it('should have aria-label with pack number', () => {
      render(<BinActionsMenu packId="pack-001" packNumber="1234567" onMarkSold={vi.fn()} />);
      const trigger = screen.getByTestId('actions-menu-trigger');
      expect(trigger).toHaveAttribute('aria-label', 'Actions for pack 1234567');
    });

    it('should have sr-only text for screen readers', () => {
      render(<BinActionsMenu packId="pack-001" packNumber="1234567" onMarkSold={vi.fn()} />);
      expect(screen.getByText('Open actions menu')).toBeInTheDocument();
      expect(screen.getByText('Open actions menu')).toHaveClass('sr-only');
    });
  });

  // --------------------------------------------------------------------------
  // Disabled State
  // --------------------------------------------------------------------------
  describe('Disabled State', () => {
    it('should disable trigger button when disabled prop is true', () => {
      render(
        <BinActionsMenu
          packId="pack-001"
          packNumber="1234567"
          onMarkSold={vi.fn()}
          disabled={true}
        />
      );
      expect(screen.getByTestId('actions-menu-trigger')).toBeDisabled();
    });

    it('should enable trigger button by default', () => {
      render(<BinActionsMenu packId="pack-001" packNumber="1234567" onMarkSold={vi.fn()} />);
      expect(screen.getByTestId('actions-menu-trigger')).not.toBeDisabled();
    });
  });

  // --------------------------------------------------------------------------
  // Menu Interaction
  // --------------------------------------------------------------------------
  describe('Menu Interaction', () => {
    it('should open dropdown on trigger click', async () => {
      const user = userEvent.setup();
      render(
        <BinActionsMenu
          packId="pack-001"
          packNumber="1234567"
          onMarkSold={vi.fn()}
          onReturn={vi.fn()}
        />
      );

      await user.click(screen.getByTestId('actions-menu-trigger'));

      await waitFor(() => {
        expect(screen.getByText('Mark Sold')).toBeInTheDocument();
        expect(screen.getByText('Return')).toBeInTheDocument();
      });
    });

    it('should only show Mark Sold when onReturn is not provided', async () => {
      const user = userEvent.setup();
      render(<BinActionsMenu packId="pack-001" packNumber="1234567" onMarkSold={vi.fn()} />);

      await user.click(screen.getByTestId('actions-menu-trigger'));

      await waitFor(() => {
        expect(screen.getByText('Mark Sold')).toBeInTheDocument();
        expect(screen.queryByText('Return')).not.toBeInTheDocument();
      });
    });

    it('should only show Return when onMarkSold is not provided', async () => {
      const user = userEvent.setup();
      render(<BinActionsMenu packId="pack-001" packNumber="1234567" onReturn={vi.fn()} />);

      await user.click(screen.getByTestId('actions-menu-trigger'));

      await waitFor(() => {
        expect(screen.queryByText('Mark Sold')).not.toBeInTheDocument();
        expect(screen.getByText('Return')).toBeInTheDocument();
      });
    });
  });

  // --------------------------------------------------------------------------
  // Callback Invocation
  // --------------------------------------------------------------------------
  describe('Callback Invocation', () => {
    it('should call onMarkSold with packId when Mark Sold is clicked', async () => {
      const onMarkSold = vi.fn();
      const user = userEvent.setup();

      render(
        <BinActionsMenu
          packId="pack-001"
          packNumber="1234567"
          onMarkSold={onMarkSold}
          onReturn={vi.fn()}
          testIdPrefix="test-"
        />
      );

      await user.click(screen.getByTestId('test-actions-menu-trigger'));
      await waitFor(() => expect(screen.getByText('Mark Sold')).toBeInTheDocument());
      await user.click(screen.getByTestId('test-mark-sold-menu-item'));

      expect(onMarkSold).toHaveBeenCalledWith('pack-001');
      expect(onMarkSold).toHaveBeenCalledTimes(1);
    });

    it('should call onReturn with packId when Return is clicked', async () => {
      const onReturn = vi.fn();
      const user = userEvent.setup();

      render(
        <BinActionsMenu
          packId="pack-001"
          packNumber="1234567"
          onMarkSold={vi.fn()}
          onReturn={onReturn}
          testIdPrefix="test-"
        />
      );

      await user.click(screen.getByTestId('test-actions-menu-trigger'));
      await waitFor(() => expect(screen.getByText('Return')).toBeInTheDocument());
      await user.click(screen.getByTestId('test-return-menu-item'));

      expect(onReturn).toHaveBeenCalledWith('pack-001');
      expect(onReturn).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // Event Propagation
  // --------------------------------------------------------------------------
  describe('Event Propagation', () => {
    it('should stop propagation on trigger click', async () => {
      const parentClickHandler = vi.fn();
      const user = userEvent.setup();

      render(
        <div onClick={parentClickHandler}>
          <BinActionsMenu packId="pack-001" packNumber="1234567" onMarkSold={vi.fn()} />
        </div>
      );

      await user.click(screen.getByTestId('actions-menu-trigger'));

      // Radix primitives handle propagation internally
      // The key is that our stopPropagation is called on the button click
      expect(parentClickHandler).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Test ID Prefix
  // --------------------------------------------------------------------------
  describe('Test ID Prefix', () => {
    it('should apply testIdPrefix to menu items', async () => {
      const user = userEvent.setup();
      render(
        <BinActionsMenu
          packId="pack-001"
          packNumber="1234567"
          onMarkSold={vi.fn()}
          onReturn={vi.fn()}
          testIdPrefix="custom-"
        />
      );

      await user.click(screen.getByTestId('custom-actions-menu-trigger'));

      await waitFor(() => {
        expect(screen.getByTestId('custom-mark-sold-menu-item')).toBeInTheDocument();
        expect(screen.getByTestId('custom-return-menu-item')).toBeInTheDocument();
      });
    });

    it('should use empty prefix by default', async () => {
      const user = userEvent.setup();
      render(
        <BinActionsMenu
          packId="pack-001"
          packNumber="1234567"
          onMarkSold={vi.fn()}
          onReturn={vi.fn()}
        />
      );

      await user.click(screen.getByTestId('actions-menu-trigger'));

      await waitFor(() => {
        expect(screen.getByTestId('mark-sold-menu-item')).toBeInTheDocument();
        expect(screen.getByTestId('return-menu-item')).toBeInTheDocument();
      });
    });
  });
});
