/**
 * ShiftInfoCard Component
 *
 * Read-only card displaying shift information including terminal, cashier,
 * shift number, start/end times, and opening/closing cash values.
 *
 * @module src/renderer/components/view/ShiftInfoCard
 * @security FE-001: Uses JSX auto-escaping, no dangerouslySetInnerHTML
 * @security SEC-004: All content rendered via text nodes, XSS-safe
 */

import * as React from 'react';
import { cn, formatCurrency } from '../../lib/utils';
import { Card } from '../ui/card';

/* ============================================================================
   TYPES
   ============================================================================ */

export interface ShiftInfo {
  /** Terminal name (e.g., "Register 1") */
  terminalName: string;
  /** Shift number */
  shiftNumber: number;
  /** Cashier name */
  cashierName: string;
  /** Shift start time formatted string */
  startedAt: string;
  /** Shift end time formatted string (optional if still open) */
  endedAt?: string | null;
  /** Opening cash amount in cents or dollars */
  openingCash: number;
  /** Closing cash amount in cents or dollars (optional if still open) */
  closingCash?: number | null;
}

export interface ShiftInfoCardProps {
  /** Shift information to display */
  shift: ShiftInfo;
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

export const ShiftInfoCard = React.memo(function ShiftInfoCard({
  shift,
  readOnly = true,
  'data-testid': testId = 'shift-info-card',
  className,
}: ShiftInfoCardProps) {
  // Format currency values
  const openingCashFormatted = formatCurrency(shift.openingCash);
  const closingCashFormatted = shift.closingCash != null ? formatCurrency(shift.closingCash) : '—';

  return (
    <Card className={cn('py-3 px-4', className)} data-testid={testId} data-readonly={readOnly}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        {/* Terminal */}
        <InfoItem
          label="Terminal"
          value={shift.terminalName || '—'}
          testId={`${testId}-terminal`}
        />

        {/* Shift Number */}
        <InfoItem label="Shift" value={`#${shift.shiftNumber}`} testId={`${testId}-shift-number`} />

        {/* Cashier */}
        <InfoItem label="Cashier" value={shift.cashierName || '—'} testId={`${testId}-cashier`} />

        {/* Started At */}
        <div className="flex items-center gap-2" data-testid={`${testId}-started`}>
          <span className="text-muted-foreground">Started:</span>
          <span className="font-medium">{shift.startedAt || '—'}</span>
        </div>

        {/* Ended At */}
        <div className="flex items-center gap-2" data-testid={`${testId}-ended`}>
          <span className="text-muted-foreground">Ended:</span>
          <span className="font-medium">{shift.endedAt || '—'}</span>
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
          valueClassName={shift.closingCash != null ? 'text-green-500' : undefined}
          testId={`${testId}-closing-cash`}
        />
      </div>
    </Card>
  );
});

ShiftInfoCard.displayName = 'ShiftInfoCard';

export default ShiftInfoCard;
