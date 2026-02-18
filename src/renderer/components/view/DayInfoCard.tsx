/**
 * DayInfoCard Component
 *
 * Read-only card displaying business day information including date,
 * shift count, first/last shift times, and total cash values.
 *
 * @module src/renderer/components/view/DayInfoCard
 * @security FE-001: Uses JSX auto-escaping, no dangerouslySetInnerHTML
 * @security SEC-004: All content rendered via text nodes, XSS-safe
 */

import * as React from 'react';
import { cn, formatCurrency } from '../../lib/utils';
import { Card } from '../ui/card';

/* ============================================================================
   TYPES
   ============================================================================ */

export interface DayInfo {
  /** Business date formatted string (e.g., "Feb 17, 2026") */
  businessDate: string;
  /** Total number of shifts for the day */
  shiftCount: number;
  /** First shift start time formatted string */
  firstShiftStarted: string | null;
  /** Last shift end time formatted string */
  lastShiftEnded: string | null;
  /** Total opening cash from first shift */
  totalOpeningCash: number;
  /** Total closing cash from last shift */
  totalClosingCash: number;
}

export interface DayInfoCardProps {
  /** Day information to display */
  day: DayInfo;
  /** Indicates this is a read-only view (affects styling) */
  readOnly?: boolean;
  /** Optional data-testid override */
  'data-testid'?: string;
  /** Optional additional className */
  className?: string;
}

/* ============================================================================
   INFO ITEM COMPONENT
   ============================================================================ */

interface InfoItemProps {
  label: string;
  value: string | number;
  valueClassName?: string;
  testId: string;
}

const InfoItem = React.memo(function InfoItem({
  label,
  value,
  valueClassName,
  testId,
}: InfoItemProps) {
  return (
    <div className="flex items-center gap-2" data-testid={testId}>
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn('font-semibold', valueClassName)}>{value}</span>
    </div>
  );
});

/* ============================================================================
   MAIN COMPONENT
   ============================================================================ */

export const DayInfoCard = React.memo(function DayInfoCard({
  day,
  readOnly = true,
  'data-testid': testId = 'day-info-card',
  className,
}: DayInfoCardProps) {
  // Format currency values
  const openingCashFormatted = formatCurrency(day.totalOpeningCash);
  const closingCashFormatted = formatCurrency(day.totalClosingCash);

  return (
    <Card className={cn('py-3 px-4', className)} data-testid={testId} data-readonly={readOnly}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        {/* Business Date */}
        <InfoItem
          label="Business Date"
          value={day.businessDate || '—'}
          testId={`${testId}-business-date`}
        />

        {/* Shift Count */}
        <InfoItem label="Shifts" value={day.shiftCount} testId={`${testId}-shift-count`} />

        {/* First Shift Started */}
        <div className="flex items-center gap-2" data-testid={`${testId}-first-started`}>
          <span className="text-muted-foreground">First Shift:</span>
          <span className="font-medium">{day.firstShiftStarted || '—'}</span>
        </div>

        {/* Last Shift Ended */}
        <div className="flex items-center gap-2" data-testid={`${testId}-last-ended`}>
          <span className="text-muted-foreground">Last Shift:</span>
          <span className="font-medium">{day.lastShiftEnded || '—'}</span>
        </div>

        {/* Opening Cash */}
        <InfoItem
          label="Opening Cash"
          value={openingCashFormatted}
          valueClassName="text-green-500"
          testId={`${testId}-opening-cash`}
        />

        {/* Closing Cash */}
        <InfoItem
          label="Closing Cash"
          value={closingCashFormatted}
          valueClassName="text-green-500"
          testId={`${testId}-closing-cash`}
        />
      </div>
    </Card>
  );
});

DayInfoCard.displayName = 'DayInfoCard';

export default DayInfoCard;
