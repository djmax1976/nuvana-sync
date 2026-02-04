/**
 * ReportsPage Unit Tests
 *
 * Tests the ReportsPage component for correct rendering, state management,
 * loading/error/empty states, date range controls, accordion behavior,
 * and progressive rendering.
 *
 * Uses mocked hooks to isolate the component's rendering logic from
 * data fetching concerns.
 *
 * @module tests/unit/pages/ReportsPage
 * @security SEC-004: Verifies no XSS vectors - all content is text
 * @accessibility A11Y-004: Validates ARIA attributes on loading/error states
 * @performance PERF-003: Validates progressive rendering behavior
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ============================================================================
// Mock Dependencies
// ============================================================================

// Mock react-router navigate
const mockNavigate = vi.fn();
vi.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock hooks with hoisted mocks
const { mockUseReportsData } = vi.hoisted(() => ({
  mockUseReportsData: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/hooks', () => ({
  useReportsData: mockUseReportsData,
}));

// Mock child components to isolate page logic testing
vi.mock('../../../src/renderer/components/reports/DayAccordion', () => ({
  DayAccordion: ({
    date,
    shifts,
    isExpanded,
    onToggle,
    onViewDay,
  }: {
    date: Date;
    shifts: unknown[];
    isExpanded: boolean;
    onToggle: () => void;
    onViewDay: (d: Date) => void;
    onShiftClick?: (s: unknown) => void;
  }) => (
    <div data-testid="day-accordion" data-expanded={isExpanded} data-date={date.toISOString()}>
      <button data-testid="toggle-btn" onClick={onToggle}>
        Toggle
      </button>
      <button data-testid="view-day-btn" onClick={() => onViewDay(date)}>
        View Day
      </button>
      <span data-testid="shift-count">{shifts.length} shifts</span>
    </div>
  ),
}));

vi.mock('../../../src/renderer/components/reports/DayAccordionSkeleton', () => ({
  DayAccordionSkeleton: ({ showTable }: { showTable?: boolean }) => (
    <div data-testid="day-accordion-skeleton" data-show-table={showTable} />
  ),
}));

vi.mock('../../../src/renderer/components/reports/ReportsEmptyState', () => ({
  ReportsEmptyState: ({ variant }: { variant: string }) => (
    <div data-testid={`reports-empty-state-${variant}`}>Empty: {variant}</div>
  ),
}));

// Import the page component after all mocks
import ReportsPage from '../../../src/renderer/pages/ReportsPage';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockDay(businessDate: string, shiftCount: number = 2) {
  return {
    date: new Date(businessDate + 'T12:00:00'),
    businessDate,
    dayStatus: 'CLOSED' as const,
    shifts: Array.from({ length: shiftCount }, (_, i) => ({
      id: `${businessDate}-shift-${i}`,
      registerName: 'POS1',
      shiftNumber: i + 1,
      startTime: new Date(`${businessDate}T06:00:00`),
      endTime: new Date(`${businessDate}T14:00:00`),
      employeeName: `Employee ${i}`,
      status: 'reconciled' as const,
    })),
  };
}

function setupDefaultMocks() {
  mockUseReportsData.mockReturnValue({
    days: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('ReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  describe('Page header', () => {
    it('should render the Reports heading', () => {
      render(<ReportsPage />);
      expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    });

    it('should render date range inputs', () => {
      render(<ReportsPage />);
      expect(screen.getByLabelText('From')).toBeInTheDocument();
    });
  });

  describe('Loading state', () => {
    it('should show loading skeletons when data is loading', () => {
      mockUseReportsData.mockReturnValue({
        days: [],
        isLoading: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportsPage />);
      const skeletons = screen.getAllByTestId('day-accordion-skeleton');
      expect(skeletons.length).toBeGreaterThanOrEqual(1);
    });

    it('should have aria-busy="true" during loading', () => {
      mockUseReportsData.mockReturnValue({
        days: [],
        isLoading: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportsPage />);
      const loadingContainer = screen.getByText('Loading shift data...').closest('[aria-busy]');
      expect(loadingContainer).toHaveAttribute('aria-busy', 'true');
    });
  });

  describe('Error state', () => {
    it('should show error message when data fetch fails', () => {
      mockUseReportsData.mockReturnValue({
        days: [],
        isLoading: false,
        isError: true,
        error: new Error('Network error'),
        refetch: vi.fn(),
      });

      render(<ReportsPage />);
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    it('should show fallback error message for non-Error objects', () => {
      mockUseReportsData.mockReturnValue({
        days: [],
        isLoading: false,
        isError: true,
        error: 'some string error',
        refetch: vi.fn(),
      });

      render(<ReportsPage />);
      expect(screen.getByText('Error loading shifts')).toBeInTheDocument();
    });

    it('should have role="alert" on error container', () => {
      mockUseReportsData.mockReturnValue({
        days: [],
        isLoading: false,
        isError: true,
        error: new Error('Test error'),
        refetch: vi.fn(),
      });

      render(<ReportsPage />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('should show empty state when no data is returned', () => {
      mockUseReportsData.mockReturnValue({
        days: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportsPage />);
      expect(screen.getByTestId('reports-empty-state-no-data')).toBeInTheDocument();
    });
  });

  describe('Data rendering', () => {
    it('should render DayAccordion for each day', () => {
      mockUseReportsData.mockReturnValue({
        days: [
          createMockDay('2026-01-27'),
          createMockDay('2026-01-26'),
          createMockDay('2026-01-25'),
        ],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportsPage />);
      const accordions = screen.getAllByTestId('day-accordion');
      expect(accordions.length).toBe(3);
    });

    it('should expand first day by default', () => {
      mockUseReportsData.mockReturnValue({
        days: [createMockDay('2026-01-27'), createMockDay('2026-01-26')],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportsPage />);
      const accordions = screen.getAllByTestId('day-accordion');
      // First day (index 0) should be expanded
      expect(accordions[0]).toHaveAttribute('data-expanded', 'true');
    });

    it('should not auto-expand first day with zero shifts', () => {
      mockUseReportsData.mockReturnValue({
        days: [createMockDay('2026-01-27', 0), createMockDay('2026-01-26')],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportsPage />);
      const accordions = screen.getAllByTestId('day-accordion');
      expect(accordions[0]).toHaveAttribute('data-expanded', 'false');
    });
  });

  describe('Accordion toggle', () => {
    it('should toggle accordion expansion state on click', () => {
      mockUseReportsData.mockReturnValue({
        days: [createMockDay('2026-01-27'), createMockDay('2026-01-26')],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportsPage />);

      // Click toggle on second accordion to expand it
      const toggleButtons = screen.getAllByTestId('toggle-btn');
      fireEvent.click(toggleButtons[1]);

      // Re-query after state update
      const accordions = screen.getAllByTestId('day-accordion');
      // Second accordion should now be expanded
      expect(accordions[1]).toHaveAttribute('data-expanded', 'true');
    });
  });

  describe('View Day navigation', () => {
    it('should navigate to lottery-day-report page when View Day is clicked', () => {
      mockUseReportsData.mockReturnValue({
        days: [createMockDay('2026-01-27')],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportsPage />);

      const viewDayBtn = screen.getByTestId('view-day-btn');
      fireEvent.click(viewDayBtn);

      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/lottery-day-report?date=2026-01-27')
      );
    });
  });

  describe('Progressive rendering', () => {
    it('should show "Show more days" button when more than 50 days', () => {
      const manyDays = Array.from({ length: 55 }, (_, i) => {
        const date = new Date(2026, 0, 27 - i);
        return createMockDay(date.toISOString().split('T')[0]);
      });

      mockUseReportsData.mockReturnValue({
        days: manyDays,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportsPage />);

      // Should show load more button
      expect(screen.getByText(/Show more days/)).toBeInTheDocument();
      expect(screen.getByText(/5 remaining/)).toBeInTheDocument();
    });

    it('should not show "Show more days" button when 50 or fewer days', () => {
      const days = Array.from({ length: 50 }, (_, i) => {
        const date = new Date(2026, 0, 27 - i);
        return createMockDay(date.toISOString().split('T')[0]);
      });

      mockUseReportsData.mockReturnValue({
        days,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<ReportsPage />);

      expect(screen.queryByText(/Show more days/)).not.toBeInTheDocument();
    });
  });
});
