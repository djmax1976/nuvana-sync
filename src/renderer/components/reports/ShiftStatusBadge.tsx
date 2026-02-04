/**
 * Shift Status Badge Component for Reports
 *
 * Displays shift status with color-coded pills and animated dot indicators.
 * Follows the mockup design pattern with soft background colors and status dots.
 *
 * @module renderer/components/reports/ShiftStatusBadge
 * @security SEC-004: XSS prevention via React's automatic escaping
 * @security FE-001: No dangerouslySetInnerHTML, all content is text
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Valid status values for shifts in reports
 */
export type ReportShiftStatus = 'reconciled' | 'closed' | 'open';

export interface ShiftStatusBadgeProps {
  /** The status of the shift */
  status: ReportShiftStatus;
  /** Additional CSS classes */
  className?: string;
  /** Test ID for testing purposes */
  'data-testid'?: string;
}

/**
 * Status configuration mapping
 * Defines styling and display text for each status
 */
const STATUS_CONFIG: Record<
  ReportShiftStatus,
  {
    label: string;
    pillClasses: string;
    dotClasses: string;
    animated: boolean;
  }
> = {
  reconciled: {
    label: 'Reconciled',
    pillClasses: 'bg-success-light text-success-muted',
    dotClasses: 'bg-success',
    animated: false,
  },
  closed: {
    label: 'Closed',
    pillClasses: 'bg-muted text-muted-foreground',
    dotClasses: 'bg-muted-foreground',
    animated: false,
  },
  open: {
    label: 'Open',
    pillClasses: 'bg-warning-light text-warning-muted',
    dotClasses: 'bg-warning',
    animated: true,
  },
};

/**
 * Get display text for status
 * Provides fallback for unknown status values
 */
function getStatusLabel(status: ReportShiftStatus): string {
  return STATUS_CONFIG[status]?.label ?? status;
}

/**
 * ShiftStatusBadge Component
 *
 * Renders a pill-shaped badge with a colored dot indicator.
 * The "open" status has an animated pulsing dot to draw attention.
 *
 * Security Compliance:
 * - SEC-004: XSS prevention via React's automatic escaping
 * - FE-001: No use of dangerouslySetInnerHTML
 *
 * @example
 * <ShiftStatusBadge status="reconciled" />
 * <ShiftStatusBadge status="open" />
 */
export const ShiftStatusBadge = React.memo(function ShiftStatusBadge({
  status,
  className,
  'data-testid': testId,
}: ShiftStatusBadgeProps) {
  const config = STATUS_CONFIG[status];

  // Fallback for unknown status - defensive coding
  if (!config) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium',
          'bg-muted text-muted-foreground',
          className
        )}
        data-testid={testId ?? `shift-status-badge-${status}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        {status}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium',
        config.pillClasses,
        className
      )}
      data-testid={testId ?? `shift-status-badge-${status}`}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          config.dotClasses,
          config.animated && 'animate-pulse-soft'
        )}
        aria-hidden="true"
      />
      {getStatusLabel(status)}
    </span>
  );
});

ShiftStatusBadge.displayName = 'ShiftStatusBadge';
