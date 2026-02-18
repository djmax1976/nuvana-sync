/**
 * ViewFooter Component
 *
 * Displays timestamps and duration for shift/day views.
 * Shows: Created At, Closed At, Duration.
 *
 * @module src/renderer/components/view/ViewFooter
 * @security FE-001: Uses JSX auto-escaping, no dangerouslySetInnerHTML
 * @security SEC-004: All content rendered via text nodes, XSS-safe
 */

import * as React from 'react';
import { cn } from '../../lib/utils';
import { Card } from '../ui/card';

/* ============================================================================
   TYPES
   ============================================================================ */

export interface ViewFooterProps {
  /** Created/opened timestamp (formatted string) */
  createdAt: string;
  /** Closed timestamp (formatted string) */
  closedAt: string;
  /** Duration display string (e.g., "8 hours 30 minutes") */
  duration: string;
  /** Optional data-testid override */
  'data-testid'?: string;
  /** Optional additional className */
  className?: string;
}

/* ============================================================================
   HELPER: CALCULATE DURATION
   ============================================================================ */

/**
 * Calculates human-readable duration between two timestamps
 * @param startDate - Start date
 * @param endDate - End date
 * @returns Formatted duration string
 */
export function calculateDuration(startDate: Date, endDate: Date): string {
  const diffMs = endDate.getTime() - startDate.getTime();

  if (diffMs < 0) return '—';

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours === 0) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }

  if (minutes === 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }

  return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
}

/* ============================================================================
   MAIN COMPONENT
   ============================================================================ */

export const ViewFooter = React.memo(function ViewFooter({
  createdAt,
  closedAt,
  duration,
  'data-testid': testId = 'view-footer',
  className,
}: ViewFooterProps) {
  return (
    <Card className={cn('p-4', className)} data-testid={testId}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        {/* Created/Opened */}
        <div data-testid={`${testId}-created`}>
          <span className="text-muted-foreground">Shift Created:</span>
          <span className="ml-2">{createdAt || '—'}</span>
        </div>

        {/* Closed */}
        <div data-testid={`${testId}-closed`}>
          <span className="text-muted-foreground">Shift Closed:</span>
          <span className="ml-2">{closedAt || '—'}</span>
        </div>

        {/* Duration */}
        <div data-testid={`${testId}-duration`}>
          <span className="text-muted-foreground">Duration:</span>
          <span className="ml-2">{duration || '—'}</span>
        </div>
      </div>
    </Card>
  );
});

ViewFooter.displayName = 'ViewFooter';

export default ViewFooter;
