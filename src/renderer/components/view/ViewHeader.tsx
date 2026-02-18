/**
 * ViewHeader Component
 *
 * Read-only header component for View Shift and View Day pages.
 * Displays back navigation, title with date, and status badge.
 *
 * @module src/renderer/components/view/ViewHeader
 * @security FE-001: Uses JSX auto-escaping, no dangerouslySetInnerHTML
 * @security SEC-004: All content rendered via text nodes, XSS-safe
 */

import * as React from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

/* ============================================================================
   TYPES
   ============================================================================ */

export type ViewStatus = 'CLOSED' | 'OPEN' | 'RECONCILED';

export interface ViewHeaderProps {
  /** Main title (e.g., "View Shift #3" or "View Day") */
  title: string;
  /** Formatted date string to display as subtitle */
  date: string;
  /** Current status of the shift/day */
  status: ViewStatus;
  /** Callback when back button is clicked */
  onBack: () => void;
  /** Optional data-testid override */
  'data-testid'?: string;
  /** Optional additional className */
  className?: string;
}

/* ============================================================================
   STATUS BADGE STYLING
   ============================================================================ */

const statusStyles: Record<ViewStatus, string> = {
  CLOSED: 'bg-muted text-muted-foreground border-border',
  OPEN: 'bg-warning-light text-warning-muted border-warning/30',
  RECONCILED: 'bg-success-light text-success-muted border-success/30',
};

/* ============================================================================
   COMPONENT
   ============================================================================ */

export const ViewHeader = React.memo(function ViewHeader({
  title,
  date,
  status,
  onBack,
  'data-testid': testId = 'view-header',
  className,
}: ViewHeaderProps) {
  return (
    <div className={cn('flex items-center gap-4', className)} data-testid={testId}>
      {/* Back Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onBack}
        aria-label="Go back"
        data-testid={`${testId}-back-button`}
        className="p-2 rounded-lg hover:bg-muted transition-colors"
      >
        <ArrowLeft className="w-5 h-5" aria-hidden="true" />
      </Button>

      {/* Title and Date */}
      <div>
        <h1 className="text-2xl font-bold" data-testid={`${testId}-title`}>
          {title}
        </h1>
        <p className="text-muted-foreground text-sm" data-testid={`${testId}-date`}>
          {date}
        </p>
      </div>

      {/* Status Badge */}
      <span
        className={cn(
          'ml-auto px-4 py-1.5 text-sm font-medium rounded-full border',
          statusStyles[status] ?? statusStyles.CLOSED
        )}
        data-testid={`${testId}-status`}
        aria-label={`Status: ${status}`}
      >
        {status}
      </span>
    </div>
  );
});

ViewHeader.displayName = 'ViewHeader';

export default ViewHeader;
