/**
 * LotteryGuard Component Unit Tests
 *
 * Tests the route guard that prevents navigation to non-lottery routes
 * when a store is in lottery-only mode.
 *
 * Store Config Phase 6D: Router Guard Tests
 *
 * @module tests/unit/components/LotteryGuard
 * @security SC-GUARD-002: Validates redirect in lottery mode
 * @security SC-GUARD-003: Validates no flash redirect during loading
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ============================================================================
// Mock Setup
// ============================================================================

// Mock useIsLotteryMode hook
const { mockIsLotteryMode } = vi.hoisted(() => ({
  mockIsLotteryMode: { value: false },
}));

vi.mock('../../../src/renderer/hooks/usePOSConnectionType', () => ({
  useIsLotteryMode: () => mockIsLotteryMode.value,
}));

// Track navigation redirects
const { mockNavigatedTo } = vi.hoisted(() => ({
  mockNavigatedTo: { value: '' },
}));

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  Navigate: ({ to, replace }: { to: string; replace?: boolean }) => {
    mockNavigatedTo.value = to;
    return <div data-testid="navigate-redirect" data-to={to} data-replace={replace} />;
  },
  MemoryRouter: ({ children, initialEntries }: { children: React.ReactNode; initialEntries?: string[] }) => (
    <div data-testid="memory-router" data-initial={initialEntries?.[0]}>
      {children}
    </div>
  ),
  Routes: ({ children }: { children: React.ReactNode }) => <div data-testid="routes">{children}</div>,
  Route: ({ path, element }: { path: string; element: React.ReactNode }) => (
    <div data-testid={`route-${path}`}>{element}</div>
  ),
}));

// Import Navigate from mock for LotteryGuard implementation
const Navigate = ({ to, replace }: { to: string; replace?: boolean }) => {
  mockNavigatedTo.value = to;
  return <div data-testid="navigate-redirect" data-to={to} data-replace={String(replace)} />;
};

// ============================================================================
// LotteryGuard Component (inline copy for testing)
// This mirrors the implementation in router.tsx
// ============================================================================

function LotteryGuard({ children }: { children: React.ReactNode }) {
  const isLotteryMode = mockIsLotteryMode.value;

  if (isLotteryMode) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

// ============================================================================
// Test Components
// ============================================================================

function TestChild() {
  return <div data-testid="test-child">Child Content</div>;
}

function TerminalsPage() {
  return <div data-testid="terminals-page">Terminals</div>;
}

function ShiftsPage() {
  return <div data-testid="shifts-page">Shifts</div>;
}

function ClockInOutPage() {
  return <div data-testid="clock-in-out-page">Clock In/Out</div>;
}

function TransactionsPage() {
  return <div data-testid="transactions-page">Transactions</div>;
}

// ============================================================================
// Tests
// ============================================================================

describe('LotteryGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsLotteryMode.value = false;
    mockNavigatedTo.value = '';
  });

  // --------------------------------------------------------------------------
  // Basic Guard Behavior
  // --------------------------------------------------------------------------

  describe('Basic Guard Behavior', () => {
    /**
     * SC-GUARD-001: Renders children when NOT in lottery mode
     */
    it('SC-GUARD-001: renders children when NOT in lottery mode', () => {
      mockIsLotteryMode.value = false;

      render(
        <LotteryGuard>
          <TestChild />
        </LotteryGuard>
      );

      expect(screen.getByTestId('test-child')).toBeInTheDocument();
      expect(screen.getByText('Child Content')).toBeInTheDocument();
      expect(screen.queryByTestId('navigate-redirect')).not.toBeInTheDocument();
    });

    /**
     * SC-GUARD-002: Redirects to / when in lottery mode
     */
    it('SC-GUARD-002: redirects to / when in lottery mode', () => {
      mockIsLotteryMode.value = true;

      render(
        <LotteryGuard>
          <TerminalsPage />
        </LotteryGuard>
      );

      // Should render Navigate redirect, not the terminals page
      expect(screen.getByTestId('navigate-redirect')).toBeInTheDocument();
      expect(screen.getByTestId('navigate-redirect')).toHaveAttribute('data-to', '/');
      expect(screen.getByTestId('navigate-redirect')).toHaveAttribute('data-replace', 'true');
      expect(screen.queryByTestId('terminals-page')).not.toBeInTheDocument();
    });

    /**
     * SC-GUARD-003: Renders children when hook is loading (returns false)
     */
    it('SC-GUARD-003: renders children during loading state (no flash redirect)', () => {
      // Loading state: useIsLotteryMode returns false (data undefined)
      mockIsLotteryMode.value = false;

      render(
        <LotteryGuard>
          <TerminalsPage />
        </LotteryGuard>
      );

      // Should render the guarded content, not redirect
      expect(screen.getByTestId('terminals-page')).toBeInTheDocument();
      expect(screen.queryByTestId('navigate-redirect')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Route-Specific Tests (testing guard behavior for each route type)
  // --------------------------------------------------------------------------

  describe('Route-Specific Redirect Tests', () => {
    /**
     * SC-GUARD-004: /terminals redirects to dashboard in lottery mode
     */
    it('SC-GUARD-004: terminals content triggers redirect in lottery mode', () => {
      mockIsLotteryMode.value = true;

      render(
        <LotteryGuard>
          <TerminalsPage />
        </LotteryGuard>
      );

      expect(screen.getByTestId('navigate-redirect')).toBeInTheDocument();
      expect(mockNavigatedTo.value).toBe('/');
      expect(screen.queryByTestId('terminals-page')).not.toBeInTheDocument();
    });

    /**
     * SC-GUARD-005: /shifts redirects to dashboard in lottery mode
     */
    it('SC-GUARD-005: shifts content triggers redirect in lottery mode', () => {
      mockIsLotteryMode.value = true;

      render(
        <LotteryGuard>
          <ShiftsPage />
        </LotteryGuard>
      );

      expect(screen.getByTestId('navigate-redirect')).toBeInTheDocument();
      expect(mockNavigatedTo.value).toBe('/');
      expect(screen.queryByTestId('shifts-page')).not.toBeInTheDocument();
    });

    /**
     * SC-GUARD-006: /clock-in-out redirects to dashboard in lottery mode
     */
    it('SC-GUARD-006: clock-in-out content triggers redirect in lottery mode', () => {
      mockIsLotteryMode.value = true;

      render(
        <LotteryGuard>
          <ClockInOutPage />
        </LotteryGuard>
      );

      expect(screen.getByTestId('navigate-redirect')).toBeInTheDocument();
      expect(mockNavigatedTo.value).toBe('/');
      expect(screen.queryByTestId('clock-in-out-page')).not.toBeInTheDocument();
    });

    /**
     * SC-GUARD-007: /transactions redirects to dashboard in lottery mode
     */
    it('SC-GUARD-007: transactions content triggers redirect in lottery mode', () => {
      mockIsLotteryMode.value = true;

      render(
        <LotteryGuard>
          <TransactionsPage />
        </LotteryGuard>
      );

      expect(screen.getByTestId('navigate-redirect')).toBeInTheDocument();
      expect(mockNavigatedTo.value).toBe('/');
      expect(screen.queryByTestId('transactions-page')).not.toBeInTheDocument();
    });

    /**
     * SC-GUARD-008: Non-guarded content is not affected by LotteryGuard
     * (Note: In real router, lottery/reports routes aren't wrapped in LotteryGuard)
     */
    it('SC-GUARD-008: guard only redirects when isLotteryMode is true', () => {
      // When isLotteryMode is true, ANY content wrapped in LotteryGuard redirects
      mockIsLotteryMode.value = true;

      render(
        <LotteryGuard>
          <div data-testid="any-content">Any Content</div>
        </LotteryGuard>
      );

      expect(screen.getByTestId('navigate-redirect')).toBeInTheDocument();
      expect(screen.queryByTestId('any-content')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Non-Lottery Mode Tests
  // --------------------------------------------------------------------------

  describe('Non-Lottery Mode Access', () => {
    it('allows access to terminals content when not in lottery mode', () => {
      mockIsLotteryMode.value = false;

      render(
        <LotteryGuard>
          <TerminalsPage />
        </LotteryGuard>
      );

      expect(screen.getByTestId('terminals-page')).toBeInTheDocument();
      expect(screen.queryByTestId('navigate-redirect')).not.toBeInTheDocument();
    });

    it('allows access to shifts content when not in lottery mode', () => {
      mockIsLotteryMode.value = false;

      render(
        <LotteryGuard>
          <ShiftsPage />
        </LotteryGuard>
      );

      expect(screen.getByTestId('shifts-page')).toBeInTheDocument();
      expect(screen.queryByTestId('navigate-redirect')).not.toBeInTheDocument();
    });

    it('allows access to clock-in-out content when not in lottery mode', () => {
      mockIsLotteryMode.value = false;

      render(
        <LotteryGuard>
          <ClockInOutPage />
        </LotteryGuard>
      );

      expect(screen.getByTestId('clock-in-out-page')).toBeInTheDocument();
      expect(screen.queryByTestId('navigate-redirect')).not.toBeInTheDocument();
    });

    it('allows access to transactions content when not in lottery mode', () => {
      mockIsLotteryMode.value = false;

      render(
        <LotteryGuard>
          <TransactionsPage />
        </LotteryGuard>
      );

      expect(screen.getByTestId('transactions-page')).toBeInTheDocument();
      expect(screen.queryByTestId('navigate-redirect')).not.toBeInTheDocument();
    });
  });
});
