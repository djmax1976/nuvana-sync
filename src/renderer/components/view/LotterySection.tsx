/**
 * LotterySection Component
 *
 * Wrapper component for lottery data in the View Day page.
 * Contains a slim header with "Lottery" title and total amount,
 * and renders children (BinsTable, pack sections).
 *
 * @module src/renderer/components/view/LotterySection
 * @security FE-001: Uses JSX auto-escaping, no dangerouslySetInnerHTML
 * @security SEC-004: All content rendered via text nodes, XSS-safe
 */

import * as React from 'react';
import { Ticket } from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';

/* ============================================================================
   TYPES
   ============================================================================ */

export interface LotterySectionProps {
  /** Lottery day ID for fetching data */
  dayId: string;
  /** Total lottery sales amount */
  total: number;
  /** Total tickets sold */
  ticketsSold?: number;
  /** Children components (BinsTable, pack sections) */
  children: React.ReactNode;
  /** Optional data-testid override */
  'data-testid'?: string;
  /** Optional additional className */
  className?: string;
}

/* ============================================================================
   LOTTERY HEADER COMPONENT
   ============================================================================ */

interface LotteryHeaderProps {
  total: number;
  ticketsSold?: number;
  testId: string;
}

const LotteryHeader = React.memo(function LotteryHeader({
  total,
  ticketsSold,
  testId,
}: LotteryHeaderProps) {
  return (
    <div
      className="relative overflow-hidden rounded-xl bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-700 px-6 py-4 shadow-lg"
      data-testid={testId}
    >
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-8 -left-8 h-24 w-24 rounded-full bg-teal-400/10 blur-xl" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-[10px] flex items-center justify-center bg-white/20 backdrop-blur-sm">
            <Ticket className="w-5 h-5 text-white" aria-hidden="true" />
          </span>
          <h2 className="text-xl font-bold text-white">Lottery</h2>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-white" data-testid={`${testId}-total`}>
            {formatCurrency(total)}
          </div>
          {ticketsSold != null && (
            <div className="text-xs text-emerald-100" data-testid={`${testId}-tickets`}>
              {ticketsSold.toLocaleString()} tickets sold
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

/* ============================================================================
   MAIN COMPONENT
   ============================================================================ */

export const LotterySection = React.memo(function LotterySection({
  dayId,
  total,
  ticketsSold,
  children,
  'data-testid': testId = 'lottery-section',
  className,
}: LotterySectionProps) {
  return (
    <div className={cn('space-y-4', className)} data-testid={testId} data-day-id={dayId}>
      {/* Slim Lottery Header */}
      <LotteryHeader total={total} ticketsSold={ticketsSold} testId={`${testId}-header`} />

      {/* Children: BinsTable, pack sections, etc. */}
      <div data-testid={`${testId}-content`}>{children}</div>
    </div>
  );
});

LotterySection.displayName = 'LotterySection';

export default LotterySection;
