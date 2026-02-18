/**
 * MyStoreSidebar Unit Tests
 *
 * Tests the sidebar navigation component after the Sync Monitor link removal.
 * Verifies the correct set of navigation links, active state logic, and
 * that no Sync Monitor or Settings link exists in the sidebar.
 *
 * Regression Coverage:
 * - REG-001: Sync Monitor link removed from sidebar
 * - REG-002: No Settings link in sidebar (accessible via gear icon only)
 * - REG-003: All 9 navigation links present and correct
 * - REG-004: Active state highlight logic per route
 *
 * @module tests/unit/components/layout/MyStoreSidebar
 * @security SEC-004: Verifies no XSS vectors — all content is text via React escaping
 * @security FE-005: No sensitive data exposed in DOM
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// ============================================================================
// Mock Dependencies
// ============================================================================

// Mock react-router-dom — useLocation and Link
const { mockPathname } = vi.hoisted(() => ({
  mockPathname: { value: '/' },
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: mockPathname.value }),
  Link: ({
    to,
    children,
    className,
    onClick,
    'data-testid': testId,
  }: {
    to: string;
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
    'data-testid'?: string;
  }) => (
    <a href={to} className={className} onClick={onClick} data-testid={testId}>
      {children}
    </a>
  ),
}));

// Mock logo import
vi.mock('../../../../src/renderer/assets/logo.png', () => ({
  default: 'mock-logo.png',
}));

// Mock SyncStatusIndicator
vi.mock('../../../../src/renderer/components/layout/SyncStatusIndicator', () => ({
  SyncStatusIndicator: ({ showTooltip, compact }: { showTooltip: boolean; compact: boolean }) => (
    <div
      data-testid="sync-status-indicator"
      data-show-tooltip={showTooltip}
      data-compact={compact}
    />
  ),
}));

// Mock useIsLotteryMode hook for Store Config tests
const { mockIsLotteryMode } = vi.hoisted(() => ({
  mockIsLotteryMode: { value: false },
}));

vi.mock('../../../../src/renderer/hooks/usePOSConnectionType', () => ({
  useIsLotteryMode: () => mockIsLotteryMode.value,
}));

// Import component AFTER all mocks
import { MyStoreSidebar } from '../../../../src/renderer/components/layout/MyStoreSidebar';

// ============================================================================
// Constants
// ============================================================================

/**
 * Expected navigation items in the sidebar — order matters.
 * Each entry: [data-testid, label, href]
 */
const EXPECTED_NAV_ITEMS: [string, string, string][] = [
  ['dashboard-link', 'Dashboard', '/'],
  ['clock-in-out-link', 'Clock In/Out', '/clock-in-out'],
  ['lottery-link', 'Lottery', '/lottery'],
  ['lottery-games-link', 'Lottery Inventory', '/lottery/games'],
  ['terminals-link', 'Terminals', '/terminals'],
  ['shifts-link', 'Shifts', '/shifts'],
  ['day-close-link', 'Day Close', '/day-close'],
  ['reports-link', 'Reports', '/reports'],
  ['transactions-link', 'Transactions', '/transactions'],
  ['employees-link', 'Employees', '/employees'],
];

// ============================================================================
// Tests
// ============================================================================

describe('MyStoreSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.value = '/';
    mockIsLotteryMode.value = false; // Default: non-lottery mode
  });

  // --------------------------------------------------------------------------
  // Structural Rendering
  // --------------------------------------------------------------------------

  describe('Structural Rendering', () => {
    it('should render the sidebar container with data-testid', () => {
      render(<MyStoreSidebar />);
      expect(screen.getByTestId('mystore-sidebar')).toBeInTheDocument();
    });

    it('should render the NUVANA logo and brand name', () => {
      render(<MyStoreSidebar />);
      expect(screen.getByAltText('Nuvana Logo')).toBeInTheDocument();
      expect(screen.getByText('NUVANA')).toBeInTheDocument();
    });

    it('should render exactly 10 navigation links', () => {
      render(<MyStoreSidebar />);
      const nav = screen.getByRole('navigation');
      const links = within(nav).getAllByRole('link');
      expect(links).toHaveLength(10);
    });

    it('should render all expected navigation items in order', () => {
      render(<MyStoreSidebar />);
      EXPECTED_NAV_ITEMS.forEach(([testId, label, href]) => {
        const link = screen.getByTestId(testId);
        expect(link).toBeInTheDocument();
        expect(link).toHaveTextContent(label);
        expect(link).toHaveAttribute('href', href);
      });
    });

    it('should render SyncStatusIndicator in footer', () => {
      render(<MyStoreSidebar />);
      const footer = screen.getByTestId('sidebar-footer');
      expect(footer).toBeInTheDocument();
      expect(within(footer).getByTestId('sync-status-indicator')).toBeInTheDocument();
    });

    it('should pass showTooltip=true and compact=false to SyncStatusIndicator', () => {
      render(<MyStoreSidebar />);
      const indicator = screen.getByTestId('sync-status-indicator');
      expect(indicator).toHaveAttribute('data-show-tooltip', 'true');
      expect(indicator).toHaveAttribute('data-compact', 'false');
    });
  });

  // --------------------------------------------------------------------------
  // REG-001: Sync Monitor Link Removed
  // --------------------------------------------------------------------------

  describe('REG-001: Sync Monitor Link Removed', () => {
    it('should NOT render a Sync Monitor link', () => {
      render(<MyStoreSidebar />);
      expect(screen.queryByTestId('sync-link')).not.toBeInTheDocument();
      expect(screen.queryByText('Sync Monitor')).not.toBeInTheDocument();
    });

    it('should NOT render a link to /sync', () => {
      render(<MyStoreSidebar />);
      const nav = screen.getByRole('navigation');
      const links = within(nav).getAllByRole('link');
      const syncLink = links.find((link) => link.getAttribute('href') === '/sync');
      expect(syncLink).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // REG-002: No Settings Link in Sidebar
  // --------------------------------------------------------------------------

  describe('REG-002: No Settings Link in Sidebar', () => {
    it('should NOT render a Settings link', () => {
      render(<MyStoreSidebar />);
      expect(screen.queryByTestId('settings-link')).not.toBeInTheDocument();
      expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    });

    it('should NOT render a link to /settings', () => {
      render(<MyStoreSidebar />);
      const nav = screen.getByRole('navigation');
      const links = within(nav).getAllByRole('link');
      const settingsLink = links.find((link) => link.getAttribute('href') === '/settings');
      expect(settingsLink).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Active State Highlight Logic (REG-004)
  // --------------------------------------------------------------------------

  describe('Active State Highlight Logic', () => {
    const ACTIVE_CLASS = 'bg-primary';
    const INACTIVE_CLASS = 'text-muted-foreground';

    it('should highlight Dashboard when pathname is /', () => {
      mockPathname.value = '/';
      render(<MyStoreSidebar />);
      expect(screen.getByTestId('dashboard-link').className).toContain(ACTIVE_CLASS);
      expect(screen.getByTestId('lottery-link').className).toContain(INACTIVE_CLASS);
    });

    it('should highlight Dashboard when pathname is /mystore', () => {
      mockPathname.value = '/mystore';
      render(<MyStoreSidebar />);
      expect(screen.getByTestId('dashboard-link').className).toContain(ACTIVE_CLASS);
    });

    it('should highlight Lottery when pathname is /lottery', () => {
      mockPathname.value = '/lottery';
      render(<MyStoreSidebar />);
      expect(screen.getByTestId('lottery-link').className).toContain(ACTIVE_CLASS);
      expect(screen.getByTestId('dashboard-link').className).toContain(INACTIVE_CLASS);
    });

    it('should highlight Lottery Inventory when pathname is /lottery/games', () => {
      mockPathname.value = '/lottery/games';
      render(<MyStoreSidebar />);
      expect(screen.getByTestId('lottery-games-link').className).toContain(ACTIVE_CLASS);
    });

    it('should highlight Terminals for /terminals and /terminal/:id', () => {
      mockPathname.value = '/terminals';
      const { unmount } = render(<MyStoreSidebar />);
      expect(screen.getByTestId('terminals-link').className).toContain(ACTIVE_CLASS);
      unmount();

      mockPathname.value = '/terminal/abc-123';
      render(<MyStoreSidebar />);
      expect(screen.getByTestId('terminals-link').className).toContain(ACTIVE_CLASS);
    });

    it('should highlight Shifts for /shifts and /shifts/:id', () => {
      mockPathname.value = '/shifts';
      const { unmount } = render(<MyStoreSidebar />);
      expect(screen.getByTestId('shifts-link').className).toContain(ACTIVE_CLASS);
      unmount();

      mockPathname.value = '/shifts/shift-456';
      render(<MyStoreSidebar />);
      expect(screen.getByTestId('shifts-link').className).toContain(ACTIVE_CLASS);
    });

    it('should highlight Reports when pathname is /reports', () => {
      mockPathname.value = '/reports';
      render(<MyStoreSidebar />);
      expect(screen.getByTestId('reports-link').className).toContain(ACTIVE_CLASS);
    });

    it('should highlight Transactions when pathname is /transactions', () => {
      mockPathname.value = '/transactions';
      render(<MyStoreSidebar />);
      expect(screen.getByTestId('transactions-link').className).toContain(ACTIVE_CLASS);
    });

    it('should highlight Employees when pathname is /employees', () => {
      mockPathname.value = '/employees';
      render(<MyStoreSidebar />);
      expect(screen.getByTestId('employees-link').className).toContain(ACTIVE_CLASS);
    });

    it('should highlight Clock In/Out when pathname is /clock-in-out', () => {
      mockPathname.value = '/clock-in-out';
      render(<MyStoreSidebar />);
      expect(screen.getByTestId('clock-in-out-link').className).toContain(ACTIVE_CLASS);
    });

    it('should highlight Day Close when pathname is /day-close', () => {
      mockPathname.value = '/day-close';
      render(<MyStoreSidebar />);
      expect(screen.getByTestId('day-close-link').className).toContain(ACTIVE_CLASS);
    });

    it('should NOT highlight Sync Monitor or Settings for any pathname', () => {
      // Ensure no /sync or /settings active state logic remains
      for (const path of ['/sync', '/settings']) {
        mockPathname.value = path;
        const { unmount } = render(<MyStoreSidebar />);
        const nav = screen.getByRole('navigation');
        const links = within(nav).getAllByRole('link');
        // No link should have the active class for these paths
        const activeLinks = links.filter((link) => link.className.includes(ACTIVE_CLASS));
        expect(activeLinks).toHaveLength(0);
        unmount();
      }
    });
  });

  // --------------------------------------------------------------------------
  // Interaction: onNavigate Callback
  // --------------------------------------------------------------------------

  describe('onNavigate Callback', () => {
    it('should call onNavigate when a link is clicked', () => {
      const onNavigate = vi.fn();
      render(<MyStoreSidebar onNavigate={onNavigate} />);
      fireEvent.click(screen.getByTestId('lottery-link'));
      expect(onNavigate).toHaveBeenCalledTimes(1);
    });

    it('should call onNavigate for each link click', () => {
      const onNavigate = vi.fn();
      render(<MyStoreSidebar onNavigate={onNavigate} />);
      fireEvent.click(screen.getByTestId('dashboard-link'));
      fireEvent.click(screen.getByTestId('reports-link'));
      fireEvent.click(screen.getByTestId('employees-link'));
      expect(onNavigate).toHaveBeenCalledTimes(3);
    });

    it('should not throw when onNavigate is not provided', () => {
      render(<MyStoreSidebar />);
      expect(() => fireEvent.click(screen.getByTestId('dashboard-link'))).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Props: className passthrough
  // --------------------------------------------------------------------------

  describe('className Prop', () => {
    it('should merge additional className onto sidebar container', () => {
      render(<MyStoreSidebar className="custom-class" />);
      const sidebar = screen.getByTestId('mystore-sidebar');
      expect(sidebar.className).toContain('custom-class');
      // Should also retain base classes
      expect(sidebar.className).toContain('w-64');
    });
  });

  // --------------------------------------------------------------------------
  // Accessibility
  // --------------------------------------------------------------------------

  describe('Accessibility', () => {
    it('should have a nav element', () => {
      render(<MyStoreSidebar />);
      expect(screen.getByRole('navigation')).toBeInTheDocument();
    });

    it('should have aria-label on footer sync status section', () => {
      render(<MyStoreSidebar />);
      const footer = screen.getByTestId('sidebar-footer');
      expect(footer).toHaveAttribute('aria-label', 'Sync status');
    });
  });

  // --------------------------------------------------------------------------
  // Store Config: Lottery Mode Tests (Phase 6C)
  // SC-NAV-001 to SC-NAV-004: Navigation visibility in lottery mode
  // SC-SEC-002: Security - DOM does not leak hidden route info
  // --------------------------------------------------------------------------

  describe('Store Config: Lottery Mode Navigation', () => {
    /**
     * SC-NAV-001: Non-lottery mode renders all navigation links
     */
    it('SC-NAV-001: non-lottery mode renders all navigation links', () => {
      mockIsLotteryMode.value = false;
      render(<MyStoreSidebar />);

      // All 10 links should be present (including Day Close)
      expect(screen.getByTestId('dashboard-link')).toBeInTheDocument();
      expect(screen.getByTestId('clock-in-out-link')).toBeInTheDocument();
      expect(screen.getByTestId('lottery-link')).toBeInTheDocument();
      expect(screen.getByTestId('lottery-games-link')).toBeInTheDocument();
      expect(screen.getByTestId('terminals-link')).toBeInTheDocument();
      expect(screen.getByTestId('shifts-link')).toBeInTheDocument();
      expect(screen.getByTestId('day-close-link')).toBeInTheDocument();
      expect(screen.getByTestId('reports-link')).toBeInTheDocument();
      expect(screen.getByTestId('transactions-link')).toBeInTheDocument();
      expect(screen.getByTestId('employees-link')).toBeInTheDocument();

      const nav = screen.getByRole('navigation');
      const links = within(nav).getAllByRole('link');
      expect(links).toHaveLength(10);
    });

    /**
     * SC-NAV-002: Lottery mode hides Clock In/Out, Terminals, Shifts, Transactions
     */
    it('SC-NAV-002: lottery mode hides Clock In/Out, Terminals, Shifts, Day Close, Transactions', () => {
      mockIsLotteryMode.value = true;
      render(<MyStoreSidebar />);

      // These should NOT be in the document
      expect(screen.queryByTestId('clock-in-out-link')).not.toBeInTheDocument();
      expect(screen.queryByTestId('terminals-link')).not.toBeInTheDocument();
      expect(screen.queryByTestId('shifts-link')).not.toBeInTheDocument();
      expect(screen.queryByTestId('day-close-link')).not.toBeInTheDocument();
      expect(screen.queryByTestId('transactions-link')).not.toBeInTheDocument();

      // These SHOULD still be visible
      expect(screen.getByTestId('dashboard-link')).toBeInTheDocument();
      expect(screen.getByTestId('lottery-link')).toBeInTheDocument();
      expect(screen.getByTestId('lottery-games-link')).toBeInTheDocument();
      expect(screen.getByTestId('reports-link')).toBeInTheDocument();
      expect(screen.getByTestId('employees-link')).toBeInTheDocument();
    });

    /**
     * SC-NAV-003: Lottery mode does NOT hide Lottery, Lottery Inventory, Dashboard, Reports, Employees
     */
    it('SC-NAV-003: lottery mode does NOT hide lottery-relevant links', () => {
      mockIsLotteryMode.value = true;
      render(<MyStoreSidebar />);

      // Explicit positive assertion for lottery-relevant links
      const dashboardLink = screen.getByTestId('dashboard-link');
      const lotteryLink = screen.getByTestId('lottery-link');
      const inventoryLink = screen.getByTestId('lottery-games-link');
      const reportsLink = screen.getByTestId('reports-link');
      const employeesLink = screen.getByTestId('employees-link');

      expect(dashboardLink).toBeVisible();
      expect(lotteryLink).toBeVisible();
      expect(inventoryLink).toBeVisible();
      expect(reportsLink).toBeVisible();
      expect(employeesLink).toBeVisible();

      // Should have exactly 5 links in lottery mode
      const nav = screen.getByRole('navigation');
      const links = within(nav).getAllByRole('link');
      expect(links).toHaveLength(5);
    });

    /**
     * SC-NAV-004: Sidebar renders all links when hook is loading (returns false)
     */
    it('SC-NAV-004: renders all links during loading state (prevents flash)', () => {
      // During loading, useIsLotteryMode returns false (data undefined)
      mockIsLotteryMode.value = false;
      render(<MyStoreSidebar />);

      // All 10 links should be visible during loading (including Day Close)
      const nav = screen.getByRole('navigation');
      const links = within(nav).getAllByRole('link');
      expect(links).toHaveLength(10);
    });

    /**
     * SC-SEC-002: Hidden links are completely absent from DOM (not CSS hidden)
     * Security: Ensures no route information leaks to the DOM
     */
    it('SC-SEC-002: hidden links are absent from DOM, not just CSS hidden', () => {
      mockIsLotteryMode.value = true;
      render(<MyStoreSidebar />);

      // queryByTestId returns null if element doesn't exist in DOM
      // This proves the elements are not rendered at all (not display:none)
      expect(screen.queryByTestId('clock-in-out-link')).toBeNull();
      expect(screen.queryByTestId('terminals-link')).toBeNull();
      expect(screen.queryByTestId('shifts-link')).toBeNull();
      expect(screen.queryByTestId('day-close-link')).toBeNull();
      expect(screen.queryByTestId('transactions-link')).toBeNull();

      // Verify no hidden elements exist via text search
      expect(screen.queryByText('Clock In/Out')).toBeNull();
      expect(screen.queryByText('Terminals')).toBeNull();
      expect(screen.queryByText('Shifts')).toBeNull();
      expect(screen.queryByText('Day Close')).toBeNull();
      expect(screen.queryByText('Transactions')).toBeNull();
    });
  });
});
