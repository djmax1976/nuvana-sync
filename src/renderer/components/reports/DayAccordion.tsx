/**
 * Day Accordion Component for Reports
 *
 * Collapsible day section that displays shift data grouped by day.
 * Uses CSS Grid animation for smooth expand/collapse transitions.
 * Follows the mockup pattern with fixed header height to prevent layout shift.
 *
 * @module renderer/components/reports/DayAccordion
 * @security SEC-004: XSS prevention via React's automatic escaping
 * @security FE-001: No dangerouslySetInnerHTML, all content is text
 * @performance PERF-002: Uses React.memo and useCallback for optimization
 */

import * as React from 'react';
import { useCallback, useMemo, useId } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ShiftTable, type ReportShift } from './ShiftTable';

export interface DayAccordionProps {
  /** The date for this day section */
  date: Date;
  /** Array of shifts for this day */
  shifts: ReportShift[];
  /** Whether the accordion is expanded */
  isExpanded: boolean;
  /** Callback when the accordion toggle is clicked */
  onToggle: () => void;
  /** Callback when "View Day" button is clicked */
  onViewDay: (date: Date) => void;
  /** Callback when a shift row is clicked */
  onShiftClick?: (shift: ReportShift) => void;
  /** Additional CSS classes */
  className?: string;
  /** Test ID for testing purposes */
  'data-testid'?: string;
}

/**
 * Format date for display (e.g., "Monday, January 27, 2025")
 */
function formatDayDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Generate summary text for shifts
 * (e.g., "4 shifts across 2 registers")
 */
function getShiftSummary(shifts: ReportShift[]): string {
  const shiftCount = shifts.length;
  const uniqueRegisters = new Set(shifts.map((s) => s.registerName)).size;

  const shiftText = shiftCount === 1 ? 'shift' : 'shifts';
  const registerText = uniqueRegisters === 1 ? 'register' : 'registers';

  if (shiftCount === 0) {
    return 'No shifts';
  }

  return `${shiftCount} ${shiftText} across ${uniqueRegisters} ${registerText}`;
}

/**
 * DayAccordion Component
 *
 * Renders a collapsible section for a single day's shifts.
 * Features:
 * - Fixed header height (min-height: 88px) to prevent layout shift
 * - CSS Grid animation for smooth expand/collapse
 * - Rotating chevron indicator
 * - "View Day" button with event.stopPropagation to prevent toggle
 *
 * Security Compliance:
 * - SEC-004: XSS prevention via React's automatic escaping
 * - FE-001: No use of dangerouslySetInnerHTML
 *
 * Performance Compliance:
 * - PERF-002: Uses React.memo for the component
 * - PERF-002: Uses useMemo for expensive calculations
 * - PERF-002: Uses useCallback for event handlers
 *
 * Accessibility:
 * - aria-expanded on header button
 * - aria-controls linking header to content
 * - role="region" on content panel
 * - Keyboard support (Enter/Space to toggle)
 *
 * @example
 * <DayAccordion
 *   date={new Date('2025-01-27')}
 *   shifts={dayShifts}
 *   isExpanded={expandedDays.includes('2025-01-27')}
 *   onToggle={() => toggleDay('2025-01-27')}
 *   onViewDay={(date) => navigate(`/day/${date.toISOString()}`)}
 * />
 */
export const DayAccordion = React.memo(function DayAccordion({
  date,
  shifts,
  isExpanded,
  onToggle,
  onViewDay,
  onShiftClick,
  className,
  'data-testid': testId,
}: DayAccordionProps) {
  // Generate unique IDs for ARIA attributes
  const uniqueId = useId();
  const headerId = `day-header-${uniqueId}`;
  const contentId = `day-content-${uniqueId}`;

  // Memoize computed values
  const formattedDate = useMemo(() => formatDayDate(date), [date]);
  const summary = useMemo(() => getShiftSummary(shifts), [shifts]);

  // Event handlers with useCallback for stability
  const handleHeaderClick = useCallback(() => {
    onToggle();
  }, [onToggle]);

  const handleHeaderKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onToggle();
      }
    },
    [onToggle]
  );

  const handleViewDayClick = useCallback(
    (event: React.MouseEvent) => {
      // Prevent accordion toggle when clicking "View Day"
      event.stopPropagation();
      onViewDay(date);
    },
    [onViewDay, date]
  );

  const handleViewDayKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        onViewDay(date);
      }
    },
    [onViewDay, date]
  );

  return (
    <div
      className={cn(
        'day-group overflow-hidden rounded-xl bg-card shadow-card',
        !isExpanded && 'collapsed',
        className
      )}
      data-testid={testId ?? 'day-accordion'}
      data-expanded={isExpanded}
    >
      {/* Header - Fixed height to prevent layout shift */}
      <div
        id={headerId}
        role="button"
        tabIndex={0}
        onClick={handleHeaderClick}
        onKeyDown={handleHeaderKeyDown}
        aria-expanded={isExpanded}
        aria-controls={contentId}
        className={cn(
          'flex cursor-pointer items-center border-b border-border px-6 py-5',
          'min-h-[88px] box-border',
          'bg-gradient-to-r from-muted/50 to-card',
          'transition-colors hover:from-muted hover:to-muted/50',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
        )}
        data-testid="day-accordion-header"
      >
        {/* Collapse/Expand Chevron */}
        <ChevronDown
          className={cn(
            'mr-3 h-5 w-5 shrink-0 text-muted-foreground',
            'transition-transform duration-300 ease-out',
            !isExpanded && '-rotate-90'
          )}
          aria-hidden="true"
        />

        {/* Day Icon */}
        <div
          className={cn(
            'mr-4 flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px]',
            'bg-info text-info-foreground'
          )}
          aria-hidden="true"
        >
          <Calendar className="h-6 w-6" />
        </div>

        {/* Day Title and Summary */}
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">{formattedDate}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{summary}</p>
        </div>

        {/* View Day Button */}
        <button
          type="button"
          onClick={handleViewDayClick}
          onKeyDown={handleViewDayKeyDown}
          aria-label={`View day details for ${formattedDate}`}
          className={cn(
            'shrink-0 rounded-lg bg-info px-5 py-2.5',
            'text-[13px] font-semibold text-info-foreground',
            'transition-colors hover:bg-info/90',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
          )}
          data-testid="day-accordion-view-day-btn"
        >
          View Day
        </button>
      </div>

      {/* Collapsible Content - CSS Grid Animation */}
      <div
        id={contentId}
        role="region"
        aria-labelledby={headerId}
        className={cn(
          'table-wrapper grid transition-[grid-template-rows] duration-[350ms] ease-out',
          isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="table-inner overflow-hidden">
          <ShiftTable shifts={shifts} onShiftClick={onShiftClick} />
        </div>
      </div>
    </div>
  );
});

DayAccordion.displayName = 'DayAccordion';
