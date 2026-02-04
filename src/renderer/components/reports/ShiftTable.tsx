/**
 * Shift Table Component for Reports
 *
 * Displays shifts in a table format grouped by register.
 * Includes all required columns: Register, Shift, Time, Employee, Status, and Action.
 *
 * @module renderer/components/reports/ShiftTable
 * @security SEC-004: XSS prevention via React's automatic escaping
 * @security FE-001: No dangerouslySetInnerHTML, all content is text
 * @performance PERF-002: Uses React.memo and useCallback for optimization
 */

import * as React from 'react';
import { useCallback, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ShiftStatusBadge, type ReportShiftStatus } from './ShiftStatusBadge';
import { EmployeeAvatar } from './EmployeeAvatar';
import { RegisterGroupRow } from './RegisterGroupRow';

/**
 * Shift data structure for reports table
 */
export interface ReportShift {
  /** Unique identifier for the shift */
  id: string;
  /** Name of the register (e.g., "POS1", "POS2") */
  registerName: string;
  /** Sequential shift number within the day */
  shiftNumber: number;
  /** Shift start time */
  startTime: Date;
  /** Shift end time */
  endTime: Date;
  /** Name of the employee working the shift */
  employeeName: string;
  /** Current status of the shift */
  status: ReportShiftStatus;
}

export interface ShiftTableProps {
  /** Array of shifts to display */
  shifts: ReportShift[];
  /** Callback when a shift row is clicked */
  onShiftClick?: (shift: ReportShift) => void;
  /** Additional CSS classes */
  className?: string;
  /** Test ID for testing purposes */
  'data-testid'?: string;
}

/**
 * Register badge color mapping based on register index
 * Cycles through predefined colors for visual distinction
 */
const REGISTER_COLORS = [
  'bg-info', // Blue for first register
  'bg-chart-4', // Purple for second register
  'bg-warning', // Amber for third register
  'bg-success', // Green for fourth register
  'bg-destructive', // Red for fifth register
];

/**
 * Get a consistent color for a register based on its name
 * Uses a simple hash to assign colors deterministically
 */
function getRegisterColor(registerName: string, registerIndex: number): string {
  return REGISTER_COLORS[registerIndex % REGISTER_COLORS.length];
}

/**
 * Format time for display (e.g., "6:00 AM")
 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format time range for display (e.g., "6:00 AM → 2:00 PM")
 */
function formatTimeRange(startTime: Date, endTime: Date): string {
  return `${formatTime(startTime)} → ${formatTime(endTime)}`;
}

/**
 * Group shifts by register name
 * Returns an array of [registerName, shifts[]] tuples sorted alphabetically by register
 */
function groupShiftsByRegister(shifts: ReportShift[]): [string, ReportShift[]][] {
  const groups = new Map<string, ReportShift[]>();

  // Group shifts by register
  for (const shift of shifts) {
    const existing = groups.get(shift.registerName) ?? [];
    existing.push(shift);
    groups.set(shift.registerName, existing);
  }

  // Sort groups alphabetically by register name
  const sortedEntries = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));

  // Sort shifts within each group by shift number
  for (const [, groupShifts] of sortedEntries) {
    groupShifts.sort((a, b) => a.shiftNumber - b.shiftNumber);
  }

  return sortedEntries;
}

/**
 * Table column count for colspan calculations
 */
const TABLE_COLUMN_COUNT = 6;

/**
 * ShiftTable Component
 *
 * Renders shifts in a structured table with grouping by register.
 * Each register group has a header row followed by individual shift rows.
 *
 * Security Compliance:
 * - SEC-004: XSS prevention via React's automatic escaping
 * - FE-001: No use of dangerouslySetInnerHTML
 *
 * Performance Compliance:
 * - PERF-002: Uses React.memo for the component
 * - PERF-002: Uses useMemo for expensive grouping operations
 * - PERF-002: Uses useCallback for event handlers
 *
 * Accessibility:
 * - Proper table semantics with thead/tbody
 * - Scope attributes on headers
 * - Keyboard navigable rows
 *
 * @example
 * <ShiftTable
 *   shifts={dayShifts}
 *   onShiftClick={(shift) => navigate(`/shifts/${shift.id}`)}
 * />
 */
export const ShiftTable = React.memo(function ShiftTable({
  shifts,
  onShiftClick,
  className,
  'data-testid': testId,
}: ShiftTableProps) {
  // Memoize grouped shifts to avoid recalculation on every render
  const groupedShifts = useMemo(() => groupShiftsByRegister(shifts), [shifts]);

  // Create a stable click handler
  const handleRowClick = useCallback(
    (shift: ReportShift) => {
      onShiftClick?.(shift);
    },
    [onShiftClick]
  );

  // Handle keyboard navigation for rows
  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTableRowElement>, shift: ReportShift) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onShiftClick?.(shift);
      }
    },
    [onShiftClick]
  );

  // Handle empty state
  if (shifts.length === 0) {
    return (
      <div
        className="py-8 text-center text-sm text-muted-foreground"
        data-testid={testId ?? 'shift-table-empty'}
      >
        No shifts to display
      </div>
    );
  }

  return (
    <table
      className={cn('w-full border-collapse', className)}
      data-testid={testId ?? 'shift-table'}
    >
      <thead className="bg-muted/50 border-b border-border">
        <tr>
          <th
            scope="col"
            className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground"
          >
            Register
          </th>
          <th
            scope="col"
            className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground"
          >
            Shift
          </th>
          <th
            scope="col"
            className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground"
          >
            Time
          </th>
          <th
            scope="col"
            className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground"
          >
            Employee
          </th>
          <th
            scope="col"
            className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground"
          >
            Status
          </th>
          <th
            scope="col"
            className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground"
          >
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/50">
        {groupedShifts.map(([registerName, registerShifts], registerIndex) => (
          <React.Fragment key={registerName}>
            {/* Register Group Header */}
            <RegisterGroupRow registerName={registerName} colSpan={TABLE_COLUMN_COUNT} />

            {/* Shifts in this register group */}
            {registerShifts.map((shift) => (
              <tr
                key={shift.id}
                onClick={() => handleRowClick(shift)}
                onKeyDown={(e) => handleRowKeyDown(e, shift)}
                tabIndex={onShiftClick ? 0 : undefined}
                role={onShiftClick ? 'button' : undefined}
                aria-label={
                  onShiftClick
                    ? `${shift.registerName} shift ${shift.shiftNumber}, ${shift.employeeName}`
                    : undefined
                }
                className={cn(
                  'group transition-colors',
                  onShiftClick &&
                    'cursor-pointer hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
                )}
                data-testid={`shift-row-${shift.id}`}
              >
                {/* Register Column */}
                <td className="px-6 py-4 text-sm">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        getRegisterColor(registerName, registerIndex)
                      )}
                      aria-hidden="true"
                    />
                    <span className="text-foreground">{shift.registerName}</span>
                  </div>
                </td>

                {/* Shift Number Column */}
                <td className="px-6 py-4 text-sm">
                  <span
                    className={cn(
                      'inline-flex h-7 w-7 items-center justify-center rounded-lg',
                      'bg-info-light text-info-muted font-bold text-[13px]'
                    )}
                  >
                    {shift.shiftNumber}
                  </span>
                </td>

                {/* Time Range Column */}
                <td className="px-6 py-4 text-sm">
                  <span className="font-mono text-[13px] text-muted-foreground">
                    {formatTimeRange(shift.startTime, shift.endTime)}
                  </span>
                </td>

                {/* Employee Column */}
                <td className="px-6 py-4 text-sm">
                  <div className="flex items-center gap-2.5">
                    <EmployeeAvatar name={shift.employeeName} size="md" />
                    <span className="text-foreground">{shift.employeeName}</span>
                  </div>
                </td>

                {/* Status Column */}
                <td className="px-6 py-4 text-sm">
                  <ShiftStatusBadge status={shift.status} />
                </td>

                {/* Action Column - Chevron visible on hover */}
                <td className="px-6 py-4 text-sm">
                  <span
                    className={cn(
                      'inline-flex opacity-0 transition-opacity',
                      'group-hover:opacity-100 group-focus-visible:opacity-100'
                    )}
                  >
                    <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  </span>
                </td>
              </tr>
            ))}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
});

ShiftTable.displayName = 'ShiftTable';
