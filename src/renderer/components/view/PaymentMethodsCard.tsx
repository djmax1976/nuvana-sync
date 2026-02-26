/**
 * PaymentMethodsCard Component
 *
 * Displays payment methods (receipts and payouts) in a styled card.
 * Receipts show cash, credit, debit, EBT with two columns (Reports/POS).
 * Payouts are clickable rows that trigger modal callbacks.
 *
 * @module src/renderer/components/view/PaymentMethodsCard
 * @security FE-001: Uses JSX auto-escaping, no dangerouslySetInnerHTML
 * @security SEC-004: All content rendered via text nodes, XSS-safe
 */

import * as React from 'react';
import {
  Banknote,
  CreditCard,
  Wallet,
  Ticket,
  CircleDollarSign,
  CheckCircle,
  ChevronRight,
  ImageIcon,
  Gamepad2,
} from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';

/* ============================================================================
   TYPES
   ============================================================================ */

export interface PaymentAmounts {
  /** Amount from scanned reports */
  reports?: number | null;
  /** Amount from POS system */
  pos: number;
}

export interface ReceiptsData {
  cash: PaymentAmounts;
  creditCard: PaymentAmounts;
  debitCard: PaymentAmounts;
  ebt: PaymentAmounts;
}

export interface PayoutData {
  /** Amount from scanned reports (negative value) */
  reports: number;
  /** Amount from POS system (negative value) */
  pos: number;
  /** Whether images are attached */
  hasImages?: boolean;
  /** Number of individual payouts (for cash payouts) */
  count?: number;
}

export interface PayoutsData {
  cashPayouts: PayoutData;
  lotteryPayouts: PayoutData;
  gamingPayouts: PayoutData;
}

export interface NetCashData {
  reports: number;
  pos: number;
}

export interface PaymentMethodsData {
  receipts: ReceiptsData;
  payouts: PayoutsData;
  netCash: NetCashData;
}

export type PayoutType = 'cash' | 'lottery' | 'gaming';

export interface PaymentMethodsCardProps {
  /** Payment methods data */
  data: PaymentMethodsData;
  /** Indicates this is a read-only view */
  readOnly?: boolean;
  /** Callback when a payout row is clicked */
  onPayoutClick?: (type: PayoutType) => void;
  /** Optional data-testid override */
  'data-testid'?: string;
  /** Optional additional className */
  className?: string;
}

/* ============================================================================
   RECEIPT ROW COMPONENT
   ============================================================================ */

interface ReceiptRowProps {
  label: string;
  icon: React.ReactNode;
  iconBgClass: string;
  iconTextClass: string;
  reports: number | null | undefined;
  pos: number;
  testId: string;
}

const ReceiptRow = React.memo(function ReceiptRow({
  label,
  icon,
  iconBgClass,
  iconTextClass,
  reports,
  pos,
  testId,
}: ReceiptRowProps) {
  return (
    <div
      className="grid grid-cols-[1fr_90px_90px] gap-2 py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors items-center"
      data-testid={testId}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center',
            iconBgClass,
            iconTextClass
          )}
        >
          {icon}
        </span>
        <span className="text-sm font-medium text-card-foreground">{label}</span>
      </div>
      <div className="text-right text-sm text-muted-foreground">
        {reports != null ? formatCurrency(reports) : '—'}
      </div>
      <div className="text-right font-mono text-sm font-medium text-card-foreground">
        {formatCurrency(pos)}
      </div>
    </div>
  );
});

/* ============================================================================
   PAYOUT ROW COMPONENT
   ============================================================================ */

interface PayoutRowProps {
  label: string;
  icon: React.ReactNode;
  reports: number;
  pos: number;
  hasImages?: boolean;
  onClick: () => void;
  testId: string;
}

const PayoutRow = React.memo(function PayoutRow({
  label,
  icon,
  reports,
  pos,
  hasImages,
  onClick,
  testId,
}: PayoutRowProps) {
  // Format as negative values with parentheses
  const formatPayout = (value: number): string => {
    const absValue = Math.abs(value);
    return `(${formatCurrency(absValue)})`;
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full grid grid-cols-[1fr_90px_90px_24px] gap-2 py-2.5 px-3 rounded-lg bg-destructive-light border border-destructive/30 items-center cursor-pointer hover:bg-destructive/20 hover:border-destructive/50 transition-all group"
      data-testid={testId}
      aria-label={`View ${label} details`}
    >
      <div className="flex items-center gap-3">
        <span className="w-8 h-8 rounded-lg bg-destructive/20 text-destructive flex items-center justify-center group-hover:bg-destructive/30 transition-colors">
          {icon}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-left text-card-foreground">{label}</span>
          {hasImages && (
            <span
              className="w-5 h-5 rounded bg-muted flex items-center justify-center"
              title="Images attached"
              data-testid={`${testId}-image-indicator`}
            >
              <ImageIcon className="w-3 h-3 text-muted-foreground" />
            </span>
          )}
        </div>
      </div>
      <div className="text-right font-mono text-sm text-destructive">{formatPayout(reports)}</div>
      <div className="text-right font-mono text-sm text-destructive">{formatPayout(pos)}</div>
      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-destructive transition-colors" />
    </button>
  );
});

/* ============================================================================
   NET CASH ROW COMPONENT
   ============================================================================ */

interface NetCashRowProps {
  reports: number;
  pos: number;
  testId: string;
}

const NetCashRow = React.memo(function NetCashRow({ reports, pos, testId }: NetCashRowProps) {
  return (
    <div
      className="grid grid-cols-[1fr_90px_90px] gap-2 py-4 px-4 rounded-xl bg-success-light border border-success/30 items-center"
      data-testid={testId}
    >
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-success/20 text-success flex items-center justify-center">
          <CheckCircle className="w-5 h-5" />
        </span>
        <span className="text-base font-bold text-card-foreground">Net Cash</span>
      </div>
      <div className="text-right font-bold font-mono text-success">{formatCurrency(reports)}</div>
      <div className="text-right font-bold font-mono text-success">{formatCurrency(pos)}</div>
    </div>
  );
});

/* ============================================================================
   MAIN COMPONENT
   ============================================================================ */

export const PaymentMethodsCard = React.memo(function PaymentMethodsCard({
  data,
  readOnly = true,
  onPayoutClick,
  'data-testid': testId = 'payment-methods-card',
  className,
}: PaymentMethodsCardProps) {
  // Handlers for payout clicks
  const handleCashPayoutClick = React.useCallback(() => {
    onPayoutClick?.('cash');
  }, [onPayoutClick]);

  const handleLotteryPayoutClick = React.useCallback(() => {
    onPayoutClick?.('lottery');
  }, [onPayoutClick]);

  const handleGamingPayoutClick = React.useCallback(() => {
    onPayoutClick?.('gaming');
  }, [onPayoutClick]);

  return (
    <div
      className={cn('relative overflow-hidden rounded-xl border border-border bg-card', className)}
      data-testid={testId}
      data-readonly={readOnly}
    >
      {/* Top accent bar */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-info to-primary" />

      {/* Header */}
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-[10px] flex items-center justify-center bg-info-light text-info">
            <Wallet className="w-5 h-5" />
          </span>
          <div>
            <h3 className="font-semibold text-lg text-card-foreground">Payment Methods</h3>
            <p className="text-xs text-muted-foreground">Cash & card transactions</p>
          </div>
        </div>
      </div>

      <div className="p-4">
        {/* Column Headers */}
        <div className="grid grid-cols-[1fr_90px_90px] gap-2 pb-3 mb-3 border-b border-border/30">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Type
          </div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right">
            Reports
          </div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right">
            POS
          </div>
        </div>

        {/* Receipts Section */}
        <div className="space-y-1" data-testid={`${testId}-receipts`}>
          <ReceiptRow
            label="Cash"
            icon={<Banknote className="w-4 h-4" />}
            iconBgClass="bg-success-light"
            iconTextClass="text-success"
            reports={data.receipts.cash.reports}
            pos={data.receipts.cash.pos}
            testId={`${testId}-cash`}
          />
          <ReceiptRow
            label="Credit Card"
            icon={<CreditCard className="w-4 h-4" />}
            iconBgClass="bg-primary-light"
            iconTextClass="text-primary"
            reports={data.receipts.creditCard.reports}
            pos={data.receipts.creditCard.pos}
            testId={`${testId}-credit`}
          />
          <ReceiptRow
            label="Debit Card"
            icon={<CreditCard className="w-4 h-4" />}
            iconBgClass="bg-accent-light"
            iconTextClass="text-accent"
            reports={data.receipts.debitCard.reports}
            pos={data.receipts.debitCard.pos}
            testId={`${testId}-debit`}
          />
          <ReceiptRow
            label="EBT"
            icon={<Ticket className="w-4 h-4" />}
            iconBgClass="bg-warning-light"
            iconTextClass="text-warning"
            reports={data.receipts.ebt.reports}
            pos={data.receipts.ebt.pos}
            testId={`${testId}-ebt`}
          />
        </div>

        {/* Payouts Section */}
        <div className="mt-4 pt-4 border-t border-border/30">
          <div className="flex items-center gap-2 mb-3 px-3">
            <span className="w-2 h-2 rounded-full bg-destructive" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Payouts
            </span>
            <span className="text-[10px] text-muted-foreground ml-auto">
              (click to view details)
            </span>
          </div>
          <div className="space-y-1" data-testid={`${testId}-payouts`}>
            <PayoutRow
              label="Cash Payouts"
              icon={<CircleDollarSign className="w-4 h-4" />}
              reports={data.payouts.cashPayouts.reports}
              pos={data.payouts.cashPayouts.pos}
              hasImages={data.payouts.cashPayouts.hasImages}
              onClick={handleCashPayoutClick}
              testId={`${testId}-cash-payouts`}
            />
            <PayoutRow
              label="Lottery Payouts"
              icon={<Ticket className="w-4 h-4" />}
              reports={data.payouts.lotteryPayouts.reports}
              pos={data.payouts.lotteryPayouts.pos}
              hasImages={data.payouts.lotteryPayouts.hasImages}
              onClick={handleLotteryPayoutClick}
              testId={`${testId}-lottery-payouts`}
            />
            <PayoutRow
              label="Gaming Payouts"
              icon={<Gamepad2 className="w-4 h-4" />}
              reports={data.payouts.gamingPayouts.reports}
              pos={data.payouts.gamingPayouts.pos}
              hasImages={data.payouts.gamingPayouts.hasImages}
              onClick={handleGamingPayoutClick}
              testId={`${testId}-gaming-payouts`}
            />
          </div>
        </div>

        {/* Net Cash Total */}
        <div className="mt-4 pt-4 border-t border-border/30">
          <NetCashRow
            reports={data.netCash.reports}
            pos={data.netCash.pos}
            testId={`${testId}-net-cash`}
          />
        </div>
      </div>
    </div>
  );
});

PaymentMethodsCard.displayName = 'PaymentMethodsCard';

export default PaymentMethodsCard;
