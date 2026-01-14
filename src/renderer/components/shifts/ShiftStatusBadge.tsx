/**
 * Shift Status Badge Component
 * Displays shift status with color-coded badges
 *
 * Story: 4.7 - Shift Management UI
 */

import { Badge } from '@/components/ui/badge';
import type { ShiftStatus } from '@/lib/api/shifts';
import { cn } from '@/lib/utils';

interface ShiftStatusBadgeProps {
  status: ShiftStatus;
  shiftId: string;
  className?: string;
}

/**
 * Get badge variant based on shift status
 * OPEN=green (success), CLOSING=yellow (warning), CLOSED=gray (secondary), VARIANCE_REVIEW=red (destructive)
 */
function getStatusVariant(
  status: ShiftStatus
): 'success' | 'warning' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'OPEN':
      return 'success';
    case 'CLOSING':
      return 'warning';
    case 'CLOSED':
      return 'secondary';
    case 'VARIANCE_REVIEW':
      return 'destructive';
    default:
      return 'outline';
  }
}

/**
 * Get display text for shift status
 */
function getStatusText(status: ShiftStatus): string {
  switch (status) {
    case 'NOT_STARTED':
      return 'Not Started';
    case 'OPEN':
      return 'Open';
    case 'ACTIVE':
      return 'Active';
    case 'CLOSING':
      return 'Closing';
    case 'RECONCILING':
      return 'Reconciling';
    case 'CLOSED':
      return 'Closed';
    case 'VARIANCE_REVIEW':
      return 'Variance Review';
    default:
      return status;
  }
}

export function ShiftStatusBadge({ status, shiftId, className }: ShiftStatusBadgeProps) {
  const variant = getStatusVariant(status);
  const text = getStatusText(status);

  return (
    <Badge
      variant={variant}
      className={cn(className)}
      data-testid={`shift-status-badge-${shiftId}`}
    >
      {text}
    </Badge>
  );
}
