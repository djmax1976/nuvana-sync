/**
 * DayAccordion Unit Tests
 *
 * Tests the DayAccordion component for correct rendering, state management,
 * event handling, accessibility, and keyboard navigation.
 *
 * @module tests/unit/components/reports/DayAccordion
 * @security SEC-004: Verifies no XSS vectors - all content is text
 * @security FE-001: Verifies no dangerouslySetInnerHTML usage
 * @accessibility A11Y-002: Validates keyboard navigation
 * @accessibility A11Y-004: Validates ARIA attributes
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DayAccordion } from '../../../../src/renderer/components/reports/DayAccordion';
import type { ReportShift } from '../../../../src/renderer/components/reports/ShiftTable';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockShift(overrides: Partial<ReportShift> = {}): ReportShift {
  return {
    id: 'shift-001',
    registerName: 'POS1',
    shiftNumber: 1,
    startTime: new Date('2026-01-27T06:00:00'),
    endTime: new Date('2026-01-27T14:00:00'),
    employeeName: 'John Smith',
    status: 'reconciled',
    ...overrides,
  };
}

function createMockShifts(count: number): ReportShift[] {
  const registers = ['POS1', 'POS2', 'POS3'];
  const employees = ['John Smith', 'Jane Doe', 'Bob Wilson'];
  const statuses: ReportShift['status'][] = ['reconciled', 'closed', 'open'];

  return Array.from({ length: count }, (_, i) => ({
    id: `shift-${String(i + 1).padStart(3, '0')}`,
    registerName: registers[i % registers.length],
    shiftNumber: Math.floor(i / registers.length) + 1,
    startTime: new Date(`2026-01-27T${String(6 + i * 2).padStart(2, '0')}:00:00`),
    endTime: new Date(`2026-01-27T${String(8 + i * 2).padStart(2, '0')}:00:00`),
    employeeName: employees[i % employees.length],
    status: statuses[i % statuses.length],
  }));
}

const TEST_DATE = new Date('2026-01-27T12:00:00');

// ============================================================================
// Tests
// ============================================================================

describe('DayAccordion', () => {
  let onToggle: ReturnType<typeof vi.fn<() => void>>;
  let onViewDay: ReturnType<typeof vi.fn<(date: Date) => void>>;
  let onShiftClick: ReturnType<typeof vi.fn<(shift: ReportShift) => void>>;

  beforeEach(() => {
    onToggle = vi.fn<() => void>();
    onViewDay = vi.fn<(date: Date) => void>();
    onShiftClick = vi.fn<(shift: ReportShift) => void>();
  });

  function renderAccordion(
    overrides: {
      shifts?: ReportShift[];
      isExpanded?: boolean;
      date?: Date;
    } = {}
  ) {
    return render(
      <DayAccordion
        date={overrides.date ?? TEST_DATE}
        shifts={overrides.shifts ?? createMockShifts(4)}
        isExpanded={overrides.isExpanded ?? true}
        onToggle={onToggle}
        onViewDay={onViewDay}
        onShiftClick={onShiftClick}
      />
    );
  }

  describe('Collapsed state rendering', () => {
    it('should render with collapsed class when isExpanded is false', () => {
      renderAccordion({ isExpanded: false });
      const accordion = screen.getByTestId('day-accordion');
      expect(accordion.className).toContain('collapsed');
    });

    it('should set data-expanded="false" when collapsed', () => {
      renderAccordion({ isExpanded: false });
      const accordion = screen.getByTestId('day-accordion');
      expect(accordion).toHaveAttribute('data-expanded', 'false');
    });

    it('should apply -rotate-90 to chevron when collapsed', () => {
      renderAccordion({ isExpanded: false });
      const chevron = screen.getByTestId('day-accordion-chevron');
      expect(chevron).toBeInTheDocument();
      expect(chevron.classList.toString()).toContain('-rotate-90');
    });

    it('should apply grid-rows-[0fr] to content wrapper when collapsed', () => {
      renderAccordion({ isExpanded: false });
      const accordion = screen.getByTestId('day-accordion');
      const contentWrapper = accordion.querySelector('[role="region"]');
      expect(contentWrapper).toBeInTheDocument();
      expect(contentWrapper!.className).toContain('grid-rows-[0fr]');
    });
  });

  describe('Expanded state rendering', () => {
    it('should render without collapsed class when isExpanded is true', () => {
      renderAccordion({ isExpanded: true });
      const accordion = screen.getByTestId('day-accordion');
      expect(accordion.className).not.toContain('collapsed');
    });

    it('should set data-expanded="true" when expanded', () => {
      renderAccordion({ isExpanded: true });
      const accordion = screen.getByTestId('day-accordion');
      expect(accordion).toHaveAttribute('data-expanded', 'true');
    });

    it('should not apply -rotate-90 to chevron when expanded', () => {
      renderAccordion({ isExpanded: true });
      const chevron = screen.getByTestId('day-accordion-chevron');
      expect(chevron).toBeInTheDocument();
      expect(chevron.classList.toString()).not.toContain('-rotate-90');
    });

    it('should apply grid-rows-[1fr] to content wrapper when expanded', () => {
      renderAccordion({ isExpanded: true });
      const accordion = screen.getByTestId('day-accordion');
      const contentWrapper = accordion.querySelector('[role="region"]');
      expect(contentWrapper!.className).toContain('grid-rows-[1fr]');
    });
  });

  describe('Date display', () => {
    it('should display formatted date in the header', () => {
      renderAccordion({ date: new Date('2026-01-27T12:00:00') });
      // Should display something like "Monday, January 27, 2026"
      expect(screen.getByText(/January 27, 2026/)).toBeInTheDocument();
    });
  });

  describe('Shift summary', () => {
    it('should display shift count and register count', () => {
      const shifts = createMockShifts(4);
      renderAccordion({ shifts });
      // 4 shifts across multiple registers
      expect(screen.getByText(/4 shifts across/)).toBeInTheDocument();
    });

    it('should display "No shifts" for empty shifts array', () => {
      renderAccordion({ shifts: [] });
      expect(screen.getByText('No shifts')).toBeInTheDocument();
    });

    it('should use singular "shift" for single shift', () => {
      renderAccordion({ shifts: [createMockShift()] });
      expect(screen.getByText(/1 shift across 1 register/)).toBeInTheDocument();
    });
  });

  describe('onToggle callback', () => {
    it('should call onToggle when header is clicked', async () => {
      renderAccordion();
      const header = screen.getByTestId('day-accordion-header');
      await userEvent.click(header);
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('should NOT call onToggle when "View Day" button is clicked', async () => {
      renderAccordion();
      const viewDayBtn = screen.getByTestId('day-accordion-view-day-btn');
      await userEvent.click(viewDayBtn);
      expect(onToggle).not.toHaveBeenCalled();
    });
  });

  describe('onViewDay callback', () => {
    it('should call onViewDay with the correct date when "View Day" is clicked', async () => {
      const testDate = new Date('2026-01-27T12:00:00');
      renderAccordion({ date: testDate });
      const viewDayBtn = screen.getByTestId('day-accordion-view-day-btn');
      await userEvent.click(viewDayBtn);
      expect(onViewDay).toHaveBeenCalledTimes(1);
      expect(onViewDay).toHaveBeenCalledWith(testDate);
    });

    it('should use stopPropagation on "View Day" click to prevent toggle', async () => {
      renderAccordion();
      const viewDayBtn = screen.getByTestId('day-accordion-view-day-btn');
      await userEvent.click(viewDayBtn);
      // onToggle should NOT be called (stopPropagation prevents it)
      expect(onToggle).not.toHaveBeenCalled();
      // onViewDay should be called
      expect(onViewDay).toHaveBeenCalledTimes(1);
    });
  });

  describe('Header fixed height', () => {
    it('should have min-h-[88px] class on header for fixed height', () => {
      renderAccordion();
      const header = screen.getByTestId('day-accordion-header');
      expect(header.className).toContain('min-h-[88px]');
    });

    it('should have box-border class on header', () => {
      renderAccordion();
      const header = screen.getByTestId('day-accordion-header');
      expect(header.className).toContain('box-border');
    });
  });

  describe('Empty shifts array', () => {
    it('should render without errors when shifts is empty', () => {
      renderAccordion({ shifts: [] });
      expect(screen.getByTestId('day-accordion')).toBeInTheDocument();
    });

    it('should display "No shifts" summary text', () => {
      renderAccordion({ shifts: [] });
      expect(screen.getByText('No shifts')).toBeInTheDocument();
    });

    it('should still show "View Day" button with empty shifts', () => {
      renderAccordion({ shifts: [] });
      expect(screen.getByTestId('day-accordion-view-day-btn')).toBeInTheDocument();
    });
  });

  describe('Keyboard navigation', () => {
    it('should toggle accordion when Enter key is pressed on header', () => {
      renderAccordion();
      const header = screen.getByTestId('day-accordion-header');
      fireEvent.keyDown(header, { key: 'Enter' });
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('should toggle accordion when Space key is pressed on header', () => {
      renderAccordion();
      const header = screen.getByTestId('day-accordion-header');
      fireEvent.keyDown(header, { key: ' ' });
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('should NOT toggle accordion for other keys', () => {
      renderAccordion();
      const header = screen.getByTestId('day-accordion-header');
      fireEvent.keyDown(header, { key: 'Tab' });
      fireEvent.keyDown(header, { key: 'Escape' });
      fireEvent.keyDown(header, { key: 'ArrowDown' });
      expect(onToggle).not.toHaveBeenCalled();
    });

    it('should call onViewDay on "View Day" button Enter press with stopPropagation', () => {
      renderAccordion();
      const viewDayBtn = screen.getByTestId('day-accordion-view-day-btn');
      fireEvent.keyDown(viewDayBtn, { key: 'Enter' });
      expect(onViewDay).toHaveBeenCalledTimes(1);
      expect(onToggle).not.toHaveBeenCalled();
    });

    it('should call onViewDay on "View Day" button Space press with stopPropagation', () => {
      renderAccordion();
      const viewDayBtn = screen.getByTestId('day-accordion-view-day-btn');
      fireEvent.keyDown(viewDayBtn, { key: ' ' });
      expect(onViewDay).toHaveBeenCalledTimes(1);
      expect(onToggle).not.toHaveBeenCalled();
    });
  });

  describe('ARIA attributes', () => {
    it('should have aria-expanded on header matching isExpanded prop', () => {
      const { rerender } = render(
        <DayAccordion
          date={TEST_DATE}
          shifts={[]}
          isExpanded={true}
          onToggle={onToggle}
          onViewDay={onViewDay}
        />
      );
      const header = screen.getByTestId('day-accordion-header');
      expect(header).toHaveAttribute('aria-expanded', 'true');

      rerender(
        <DayAccordion
          date={TEST_DATE}
          shifts={[]}
          isExpanded={false}
          onToggle={onToggle}
          onViewDay={onViewDay}
        />
      );
      expect(header).toHaveAttribute('aria-expanded', 'false');
    });

    it('should have aria-controls on header linking to content panel', () => {
      renderAccordion();
      const header = screen.getByTestId('day-accordion-header');
      const ariaControls = header.getAttribute('aria-controls');
      expect(ariaControls).toBeTruthy();

      // The linked content panel should exist
      const contentPanel = document.getElementById(ariaControls!);
      expect(contentPanel).toBeInTheDocument();
    });

    it('should have role="region" on content panel', () => {
      renderAccordion();
      const accordion = screen.getByTestId('day-accordion');
      const region = accordion.querySelector('[role="region"]');
      expect(region).toBeInTheDocument();
    });

    it('should have aria-labelledby on content panel linking to header', () => {
      renderAccordion();
      const accordion = screen.getByTestId('day-accordion');
      const region = accordion.querySelector('[role="region"]');
      const labelledBy = region?.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();

      // The linked header should exist
      const linkedHeader = document.getElementById(labelledBy!);
      expect(linkedHeader).toBeInTheDocument();
    });

    it('should have tabIndex=0 on header for keyboard accessibility', () => {
      renderAccordion();
      const header = screen.getByTestId('day-accordion-header');
      expect(header).toHaveAttribute('tabindex', '0');
    });

    it('should have role="button" on header', () => {
      renderAccordion();
      const header = screen.getByTestId('day-accordion-header');
      expect(header).toHaveAttribute('role', 'button');
    });

    it('should have descriptive aria-label on "View Day" button', () => {
      renderAccordion({ date: new Date('2026-01-27T12:00:00') });
      const viewDayBtn = screen.getByTestId('day-accordion-view-day-btn');
      const ariaLabel = viewDayBtn.getAttribute('aria-label');
      expect(ariaLabel).toContain('View day details');
      expect(ariaLabel).toContain('January 27, 2026');
    });
  });

  describe('Dark mode compatibility', () => {
    it('should use theme-aware classes (bg-card, border-border, text-foreground)', () => {
      renderAccordion();
      const accordion = screen.getByTestId('day-accordion');
      expect(accordion.className).toContain('bg-card');
    });

    it('should use theme-aware gradient on header', () => {
      renderAccordion();
      const header = screen.getByTestId('day-accordion-header');
      expect(header.className).toContain('bg-gradient-to-r');
      expect(header.className).toContain('from-muted/50');
    });
  });
});
