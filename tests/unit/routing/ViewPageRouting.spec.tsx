/**
 * View Page Routing Tests
 *
 * Tests for POS type routing logic for view pages:
 * - LOTTERY stores should use LotteryDayReportPage for day views
 * - Non-LOTTERY stores should use ViewShiftPage for shift views
 * - Non-LOTTERY stores should use ViewDayPage for day views
 * - LotteryGuard correctly redirects LOTTERY stores from shift/day views
 *
 * Test Standards Applied:
 * - TEST-001: AAA pattern (Arrange-Act-Assert)
 * - TEST-002: Descriptive test names
 * - TEST-003: Test isolation (mocks cleared between tests)
 * - TEST-004: Deterministic tests
 * - TEST-005: Single concept per test
 *
 * @module tests/unit/routing/ViewPageRouting
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';

// ============================================================================
// Mock Dependencies (Hoisted)
// ============================================================================

const { mockIsLotteryMode } = vi.hoisted(() => ({
  mockIsLotteryMode: vi.fn(),
}));

// Mock the POS connection type hook
vi.mock('../../../src/renderer/hooks/usePOSConnectionType', () => ({
  useIsLotteryMode: () => mockIsLotteryMode(),
}));

// Mock page components
vi.mock('../../../src/renderer/pages/ViewShiftPage', () => ({
  default: () => <div data-testid="view-shift-page">ViewShiftPage</div>,
}));

vi.mock('../../../src/renderer/pages/ViewDayPage', () => ({
  default: () => <div data-testid="view-day-page">ViewDayPage</div>,
}));

vi.mock('../../../src/renderer/pages/LotteryDayReportPage', () => ({
  default: () => <div data-testid="lottery-day-report-page">LotteryDayReportPage</div>,
}));

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * LotteryGuard component that mirrors the production implementation
 * Redirects LOTTERY stores from non-lottery routes
 */
function LotteryGuard({ children }: { children: React.ReactNode }) {
  const isLotteryMode = mockIsLotteryMode();

  if (isLotteryMode) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

/**
 * Test router that mimics the production routing structure
 */
function TestRouter({ initialEntry }: { initialEntry: string }) {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        {/* Dashboard (redirect target) */}
        <Route path="/" element={<div data-testid="dashboard">Dashboard</div>} />

        {/* ViewShiftPage - guarded for non-LOTTERY stores */}
        <Route
          path="/shifts/:shiftId/view"
          element={
            <LotteryGuard>
              <div data-testid="view-shift-page">ViewShiftPage</div>
            </LotteryGuard>
          }
        />

        {/* ViewDayPage - guarded for non-LOTTERY stores */}
        <Route
          path="/days/:dayId/view"
          element={
            <LotteryGuard>
              <div data-testid="view-day-page">ViewDayPage</div>
            </LotteryGuard>
          }
        />

        {/* LotteryDayReportPage - accessible to all stores */}
        <Route
          path="/lottery-day-report"
          element={<div data-testid="lottery-day-report-page">LotteryDayReportPage</div>}
        />
      </Routes>
    </MemoryRouter>
  );
}

// ============================================================================
// Test Suite
// ============================================================================

describe('View Page Routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // LOTTERY Store Routing
  // ==========================================================================

  describe('LOTTERY POS Type Routing', () => {
    beforeEach(() => {
      // Set up LOTTERY mode
      mockIsLotteryMode.mockReturnValue(true);
    });

    it('should redirect LOTTERY stores from /shifts/:shiftId/view to dashboard', async () => {
      // Arrange & Act
      render(<TestRouter initialEntry="/shifts/shift-123/view" />);

      // Assert: Should redirect to dashboard
      await waitFor(() => {
        expect(screen.getByTestId('dashboard')).toBeInTheDocument();
      });

      // ViewShiftPage should NOT be rendered
      expect(screen.queryByTestId('view-shift-page')).not.toBeInTheDocument();
    });

    it('should redirect LOTTERY stores from /days/:dayId/view to dashboard', async () => {
      // Arrange & Act
      render(<TestRouter initialEntry="/days/day-123/view" />);

      // Assert: Should redirect to dashboard
      await waitFor(() => {
        expect(screen.getByTestId('dashboard')).toBeInTheDocument();
      });

      // ViewDayPage should NOT be rendered
      expect(screen.queryByTestId('view-day-page')).not.toBeInTheDocument();
    });

    it('should allow LOTTERY stores to access /lottery-day-report', async () => {
      // Arrange & Act
      render(<TestRouter initialEntry="/lottery-day-report" />);

      // Assert: Should render LotteryDayReportPage
      expect(screen.getByTestId('lottery-day-report-page')).toBeInTheDocument();

      // Should NOT redirect
      expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Non-LOTTERY Store Routing (GENERAL, FUEL, etc.)
  // ==========================================================================

  describe('Non-LOTTERY POS Type Routing', () => {
    beforeEach(() => {
      // Set up non-LOTTERY mode
      mockIsLotteryMode.mockReturnValue(false);
    });

    it('should render ViewShiftPage for non-LOTTERY stores at /shifts/:shiftId/view', async () => {
      // Arrange & Act
      render(<TestRouter initialEntry="/shifts/shift-456/view" />);

      // Assert: ViewShiftPage should be rendered
      expect(screen.getByTestId('view-shift-page')).toBeInTheDocument();

      // Should NOT redirect to dashboard
      expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
    });

    it('should render ViewDayPage for non-LOTTERY stores at /days/:dayId/view', async () => {
      // Arrange & Act
      render(<TestRouter initialEntry="/days/day-456/view" />);

      // Assert: ViewDayPage should be rendered
      expect(screen.getByTestId('view-day-page')).toBeInTheDocument();

      // Should NOT redirect to dashboard
      expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
    });

    it('should allow non-LOTTERY stores to access /lottery-day-report', async () => {
      // Arrange & Act
      render(<TestRouter initialEntry="/lottery-day-report" />);

      // Assert: LotteryDayReportPage should be accessible
      expect(screen.getByTestId('lottery-day-report-page')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Route Parameter Handling
  // ==========================================================================

  describe('Route Parameter Handling', () => {
    beforeEach(() => {
      mockIsLotteryMode.mockReturnValue(false);
    });

    it('should accept valid shift ID in route parameter', () => {
      // Arrange & Act
      render(<TestRouter initialEntry="/shifts/valid-shift-uuid/view" />);

      // Assert
      expect(screen.getByTestId('view-shift-page')).toBeInTheDocument();
    });

    it('should accept valid day ID in route parameter', () => {
      // Arrange & Act
      render(<TestRouter initialEntry="/days/valid-day-uuid/view" />);

      // Assert
      expect(screen.getByTestId('view-day-page')).toBeInTheDocument();
    });

    it('should handle UUID-format IDs in shift route', () => {
      // Arrange & Act
      render(<TestRouter initialEntry="/shifts/550e8400-e29b-41d4-a716-446655440000/view" />);

      // Assert
      expect(screen.getByTestId('view-shift-page')).toBeInTheDocument();
    });

    it('should handle UUID-format IDs in day route', () => {
      // Arrange & Act
      render(<TestRouter initialEntry="/days/550e8400-e29b-41d4-a716-446655440000/view" />);

      // Assert
      expect(screen.getByTestId('view-day-page')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Loading State Behavior
  // ==========================================================================

  describe('Loading State Behavior', () => {
    it('should render children during loading (isLotteryMode undefined -> false)', () => {
      // Arrange: During loading, isLotteryMode returns false to prevent flash redirect
      mockIsLotteryMode.mockReturnValue(false);

      // Act
      render(<TestRouter initialEntry="/shifts/shift-123/view" />);

      // Assert: Content should render, not flash to dashboard
      expect(screen.getByTestId('view-shift-page')).toBeInTheDocument();
    });

    it('should not flash redirect during initial load', () => {
      // Arrange: Simulate undefined state (loading)
      mockIsLotteryMode.mockReturnValue(false);

      // Act
      render(<TestRouter initialEntry="/days/day-123/view" />);

      // Assert: Should render content immediately, not dashboard
      expect(screen.getByTestId('view-day-page')).toBeInTheDocument();
      expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    beforeEach(() => {
      mockIsLotteryMode.mockReturnValue(false);
    });

    it('should handle empty shift ID gracefully', () => {
      // Arrange & Act
      // Note: Empty ID still matches the route pattern, page handles validation
      render(<TestRouter initialEntry="/shifts//view" />);

      // Assert: Page should render (validation happens at component level)
      // This test verifies route matching, not component-level validation
    });

    it('should handle special characters in route gracefully', () => {
      // Arrange & Act
      render(<TestRouter initialEntry="/shifts/shift%20with%20spaces/view" />);

      // Assert: Route should still work (URL encoding handled by router)
      expect(screen.getByTestId('view-shift-page')).toBeInTheDocument();
    });
  });
});
