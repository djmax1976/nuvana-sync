/**
 * Reports Page
 *
 * Shifts-by-day view with collapsible day accordions showing shift tables.
 * Exact replica of mockup-3-table-view.html: h1 header, then day group cards.
 *
 * @module renderer/pages/ReportsPage
 * @security FE-001: XSS prevention via React's automatic escaping
 * @performance PERF-002: Uses useCallback for event handlers, useMemo where needed
 * @performance PERF-003: Progressive rendering for large datasets (>50 days)
 */

import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useReportsData } from '../lib/hooks';
import { DayAccordion } from '../components/reports/DayAccordion';
import { DayAccordionSkeleton } from '../components/reports/DayAccordionSkeleton';
import { ReportsEmptyState } from '../components/reports/ReportsEmptyState';
import type { ReportShift } from '../components/reports/ShiftTable';

/**
 * Number of day accordions to render per batch for progressive rendering.
 * Prevents DOM overload when the dataset exceeds this threshold.
 */
const DAYS_RENDER_BATCH_SIZE = 50;

function getLast30DaysStart(): string {
  const date = new Date();
  date.setDate(date.getDate() - 29);
  return date.toISOString().split('T')[0];
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

export default function ReportsPage() {
  const navigate = useNavigate();

  // Date range state
  const [startDate, setStartDate] = useState<string>(getLast30DaysStart);
  const [endDate, setEndDate] = useState<string>(getToday);

  // Accordion state — track which days are explicitly toggled
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());
  // Track if user has interacted with any accordion (disables auto-expand of first)
  const [userToggled, setUserToggled] = useState(false);

  // Progressive rendering
  const [visibleDayCount, setVisibleDayCount] = useState(DAYS_RENDER_BATCH_SIZE);

  // Fetch shifts by day
  const { days, isLoading, isError, error } = useReportsData({ startDate, endDate });

  // Slice for progressive rendering
  const visibleDays = useMemo(() => days.slice(0, visibleDayCount), [days, visibleDayCount]);
  const hasMoreDays = days.length > visibleDayCount;

  // Determine if a day accordion is expanded:
  // - First day with shifts auto-expands (unless user has manually toggled)
  // - Days with no shifts are never auto-expanded
  // - Explicitly toggled days follow the Set state
  const isDayExpanded = useCallback(
    (businessDate: string, index: number, shiftCount: number) => {
      if (userToggled) {
        return expandedDays.has(businessDate);
      }
      // Auto-expand the first day only if it has shifts
      if (index === 0 && shiftCount > 0) {
        return !expandedDays.has(businessDate); // toggle off if user collapsed it
      }
      return expandedDays.has(businessDate);
    },
    [expandedDays, userToggled]
  );

  // Toggle day accordion
  const toggleDay = useCallback((businessDate: string) => {
    setUserToggled(true);
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(businessDate)) {
        next.delete(businessDate);
      } else {
        next.add(businessDate);
      }
      return next;
    });
  }, []);

  // Navigate to day close page
  const handleViewDay = useCallback(
    (date: Date) => {
      const businessDate = date.toISOString().split('T')[0];
      navigate(`/lottery-day-report?date=${businessDate}`);
    },
    [navigate]
  );

  // Navigate to shift detail
  const handleShiftClick = useCallback(
    (shift: ReportShift) => {
      navigate(`/shifts/${shift.id}`);
    },
    [navigate]
  );

  // Load more days
  const handleLoadMoreDays = useCallback(() => {
    setVisibleDayCount((prev) => prev + DAYS_RENDER_BATCH_SIZE);
  }, []);

  return (
    <div className="mx-auto max-w-[1600px]">
      {/* Page Header — exact match to mockup */}
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Reports</h1>

        {/* Date range controls — functional addition, styled to blend */}
        <div className="flex items-center gap-3">
          <label htmlFor="reports-start-date" className="text-sm text-muted-foreground">
            From
          </label>
          <input
            id="reports-start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="text-sm text-muted-foreground">to</span>
          <input
            id="reports-end-date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      {/* Day Groups — mockup: .day-group cards with 24px gap */}
      {isLoading ? (
        <div className="space-y-6" aria-live="polite" aria-busy="true">
          <span className="sr-only">Loading shift data...</span>
          <DayAccordionSkeleton showTable rowCount={3} />
          <DayAccordionSkeleton />
          <DayAccordionSkeleton />
        </div>
      ) : isError ? (
        <div className="rounded-2xl bg-card border border-border p-6 shadow-card" role="alert">
          <div className="text-destructive">
            {error instanceof Error ? error.message : 'Error loading shifts'}
          </div>
        </div>
      ) : days.length === 0 ? (
        <ReportsEmptyState variant="no-data" />
      ) : (
        <div className="space-y-6">
          {visibleDays.map((day, index) => (
            <DayAccordion
              key={day.businessDate}
              date={day.date}
              shifts={day.shifts}
              isExpanded={isDayExpanded(day.businessDate, index, day.shifts.length)}
              onToggle={() => toggleDay(day.businessDate)}
              onViewDay={handleViewDay}
              onShiftClick={handleShiftClick}
            />
          ))}

          {hasMoreDays && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={handleLoadMoreDays}
                className="rounded-lg bg-muted px-6 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Show more days ({days.length - visibleDayCount} remaining)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
