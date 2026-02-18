/**
 * ViewDayPage Component
 *
 * Read-only view page for closed business days.
 * Composes shared components from the view/ directory.
 * Includes lottery section with REAL data via dayId parameter.
 *
 * Route: /days/:dayId/view
 * Applicable to: All POS types EXCEPT LOTTERY
 * (LOTTERY stores use LotteryDayReportPage instead)
 *
 * @module renderer/pages/ViewDayPage
 * @security FE-001: Uses JSX auto-escaping, no dangerouslySetInnerHTML
 * @security SEC-004: All content rendered via text nodes, XSS-safe
 * @security API-008: Only whitelisted fields displayed from data
 * @performance PERF-002: useMemo for computed values, useCallback for handlers
 */

import * as React from 'react';
import { useParams, useNavigate } from 'react-router-dom';

// Data hook
import { useDayViewData } from '../hooks/useViewData';

// Utilities
import { formatCurrency } from '../lib/utils';

// Phase 1 shared components
import { ViewHeader, type ViewStatus } from '../components/view/ViewHeader';
import { DayInfoCard, type DayInfo } from '../components/view/DayInfoCard';
import { SummaryCardsRow, type SummaryCardsData } from '../components/view/SummaryCardsRow';
import {
  PaymentMethodsCard,
  type PaymentMethodsData,
  type PayoutType,
} from '../components/view/PaymentMethodsCard';
import { SalesBreakdownCard, type SalesBreakdownData } from '../components/view/SalesBreakdownCard';
import { LotterySection } from '../components/view/LotterySection';
import { ViewFooter, calculateDuration } from '../components/view/ViewFooter';
import {
  PayoutModal,
  type PayoutModalData,
  type CashPayoutItem,
} from '../components/view/PayoutModal';

// Note: Lottery bin/pack components (DayBinsTable, ReturnedPacksSection, etc.)
// require separate data hooks not implemented in this phase.
// The LotterySection wrapper is rendered with basic totals from day view data.

// UI components
import { LoadingSpinner } from '../components/ui/LoadingSpinner';

// Types from transport for type safety
import type { DayViewDataResponse } from '../lib/transport';

/* ============================================================================
   HELPER FUNCTIONS
   ============================================================================ */

/**
 * Format ISO date string to display format
 * @security FE-001: Returns plain string, no HTML
 */
function formatDisplayDate(isoDate: string | null): string {
  if (!isoDate) return '—';
  try {
    const date = new Date(isoDate);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '—';
  }
}

/**
 * Format ISO date string to header format (e.g., "Monday, February 17, 2026")
 * @security FE-001: Returns plain string, no HTML
 */
function formatHeaderDate(isoDate: string | null): string {
  if (!isoDate) return '—';
  try {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

/**
 * Transform IPC response to DayInfo component props
 * @security API-008: Only includes whitelisted display fields
 */
function transformToDayInfo(data: DayViewDataResponse): DayInfo {
  return {
    businessDate: data.dayInfo.businessDate,
    shiftCount: data.dayInfo.shiftCount,
    firstShiftStarted: data.dayInfo.firstShiftStarted
      ? formatDisplayDate(data.dayInfo.firstShiftStarted)
      : null,
    lastShiftEnded: data.dayInfo.lastShiftEnded
      ? formatDisplayDate(data.dayInfo.lastShiftEnded)
      : null,
    totalOpeningCash: data.dayInfo.totalOpeningCash,
    totalClosingCash: data.dayInfo.totalClosingCash,
  };
}

/**
 * Transform IPC response to SummaryCardsData component props
 * @security API-008: Only includes whitelisted display fields
 */
function transformToSummaryData(data: DayViewDataResponse): SummaryCardsData {
  return {
    insideSales: {
      total: data.summary.insideSales.total,
      nonFood: data.summary.insideSales.nonFood,
      foodSales: data.summary.insideSales.foodSales,
    },
    fuelSales: {
      total: data.summary.fuelSales.total,
      gallonsSold: data.summary.fuelSales.gallonsSold,
    },
    lotterySales: {
      total: data.summary.lotterySales.total,
      scratchOff: data.summary.lotterySales.scratchOff,
      online: data.summary.lotterySales.online,
    },
    reserved: null,
  };
}

/**
 * Transform IPC response to PaymentMethodsData component props
 * @security API-008: Only includes whitelisted display fields
 */
function transformToPaymentData(data: DayViewDataResponse): PaymentMethodsData {
  return {
    receipts: {
      cash: {
        reports: data.payments.receipts.cash.reports,
        pos: data.payments.receipts.cash.pos,
      },
      creditCard: {
        reports: data.payments.receipts.creditCard.reports,
        pos: data.payments.receipts.creditCard.pos,
      },
      debitCard: {
        reports: data.payments.receipts.debitCard.reports,
        pos: data.payments.receipts.debitCard.pos,
      },
      ebt: {
        reports: data.payments.receipts.ebt.reports,
        pos: data.payments.receipts.ebt.pos,
      },
    },
    payouts: {
      cashPayouts: {
        reports: data.payments.payouts.cashPayouts.reports,
        pos: data.payments.payouts.cashPayouts.pos,
        hasImages: data.payments.payouts.cashPayouts.hasImages,
        count: data.payments.payouts.cashPayouts.count,
      },
      lotteryPayouts: {
        reports: data.payments.payouts.lotteryPayouts.reports,
        pos: data.payments.payouts.lotteryPayouts.pos,
        hasImages: data.payments.payouts.lotteryPayouts.hasImages,
      },
      gamingPayouts: {
        reports: data.payments.payouts.gamingPayouts.reports,
        pos: data.payments.payouts.gamingPayouts.pos,
        hasImages: data.payments.payouts.gamingPayouts.hasImages,
      },
    },
    netCash: {
      reports: data.payments.netCash.reports,
      pos: data.payments.netCash.pos,
    },
  };
}

/**
 * Transform IPC response to SalesBreakdownData component props
 * @security API-008: Only includes whitelisted display fields
 */
function transformToSalesData(data: DayViewDataResponse): SalesBreakdownData {
  return {
    gasSales: {
      reports: data.salesBreakdown.gasSales.reports,
      pos: data.salesBreakdown.gasSales.pos,
    },
    grocery: {
      reports: data.salesBreakdown.grocery.reports,
      pos: data.salesBreakdown.grocery.pos,
    },
    tobacco: {
      reports: data.salesBreakdown.tobacco.reports,
      pos: data.salesBreakdown.tobacco.pos,
    },
    beverages: {
      reports: data.salesBreakdown.beverages.reports,
      pos: data.salesBreakdown.beverages.pos,
    },
    snacks: {
      reports: data.salesBreakdown.snacks.reports,
      pos: data.salesBreakdown.snacks.pos,
    },
    other: {
      reports: data.salesBreakdown.other.reports,
      pos: data.salesBreakdown.other.pos,
    },
    lottery: {
      instantSales: {
        reports: data.salesBreakdown.lottery.instantSales.reports,
        pos: data.salesBreakdown.lottery.instantSales.pos,
      },
      instantCashes: {
        reports: data.salesBreakdown.lottery.instantCashes.reports,
        pos: data.salesBreakdown.lottery.instantCashes.pos,
      },
      onlineSales: {
        reports: data.salesBreakdown.lottery.onlineSales.reports,
        pos: data.salesBreakdown.lottery.onlineSales.pos,
      },
      onlineCashes: {
        reports: data.salesBreakdown.lottery.onlineCashes.reports,
        pos: data.salesBreakdown.lottery.onlineCashes.pos,
      },
    },
    salesTax: {
      reports: data.salesBreakdown.salesTax.reports,
      pos: data.salesBreakdown.salesTax.pos,
    },
    total: {
      reports: data.salesBreakdown.total.reports,
      pos: data.salesBreakdown.total.pos,
    },
  };
}

/* ============================================================================
   COMPONENT
   ============================================================================ */

export default function ViewDayPage() {
  const { dayId } = useParams<{ dayId: string }>();
  const navigate = useNavigate();

  // Fetch day view data via IPC
  const { data, isLoading, error } = useDayViewData(dayId);

  // State for payout modal
  const [payoutModalOpen, setPayoutModalOpen] = React.useState(false);
  const [payoutModalType, setPayoutModalType] = React.useState<PayoutType>('cash');

  // Navigation callback
  const handleBack = React.useCallback(() => {
    navigate(-1);
  }, [navigate]);

  // Payout modal handlers
  const handlePayoutClick = React.useCallback((type: PayoutType) => {
    setPayoutModalType(type);
    setPayoutModalOpen(true);
  }, []);

  const handlePayoutModalClose = React.useCallback(() => {
    setPayoutModalOpen(false);
  }, []);

  // Transform IPC data to component props - memoized for performance (PERF-002)
  const dayInfo = React.useMemo(() => (data ? transformToDayInfo(data) : null), [data]);

  const summaryData = React.useMemo(() => (data ? transformToSummaryData(data) : null), [data]);

  const paymentData = React.useMemo(() => (data ? transformToPaymentData(data) : null), [data]);

  const salesData = React.useMemo(() => (data ? transformToSalesData(data) : null), [data]);

  // Compute payout modal data based on type
  const payoutModalData: PayoutModalData = React.useMemo(() => {
    if (!paymentData) {
      return {
        type: 'cash',
        payouts: [] as CashPayoutItem[],
        totalAmount: 0,
      };
    }

    if (payoutModalType === 'cash') {
      // TODO: Fetch actual cash payout items via images:getByShift
      // For now, return empty array - will be populated in Phase 3.5
      return {
        type: 'cash',
        payouts: [] as CashPayoutItem[],
        totalAmount: paymentData.payouts.cashPayouts.reports,
      };
    }
    return {
      type: payoutModalType,
      imageUrl: null, // Will be populated via images:getByShift
      imageName: payoutModalType === 'lottery' ? 'Lottery Report' : 'Gaming Report',
      totalAmount:
        payoutModalType === 'lottery'
          ? paymentData.payouts.lotteryPayouts.reports
          : paymentData.payouts.gamingPayouts.reports,
      scannedAt: data?.timestamps.closedAt ? formatDisplayDate(data.timestamps.closedAt) : '—',
    };
  }, [payoutModalType, paymentData, data]);

  // Format date for header
  const formattedDate = React.useMemo(() => {
    return data ? formatHeaderDate(data.businessDate) : '—';
  }, [data]);

  // Compute duration from timestamps
  const duration = React.useMemo(() => {
    if (!data?.timestamps.createdAt || !data?.timestamps.closedAt) {
      return '—';
    }
    const start = new Date(data.timestamps.createdAt);
    const end = new Date(data.timestamps.closedAt);
    return calculateDuration(start, end);
  }, [data]);

  // Compute lottery totals from summary data
  const lotteryTotal = React.useMemo(() => (data ? data.summary.lotterySales.total : 0), [data]);

  // Loading state
  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center min-h-[400px]"
        data-testid="view-day-page-loading"
      >
        <div className="flex flex-col items-center gap-4">
          <LoadingSpinner size="lg" />
          <p className="text-muted-foreground">Loading day details...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !dayId || !data) {
    return (
      <div className="max-w-[1200px] mx-auto p-6" data-testid="view-day-page-error">
        <div className="rounded-lg bg-card border border-destructive p-6">
          <p className="text-destructive">
            {error instanceof Error
              ? error.message
              : !dayId
                ? 'Invalid or missing day ID.'
                : 'Failed to load day data.'}
          </p>
          <button
            type="button"
            onClick={handleBack}
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 pb-8" data-testid="view-day-page" data-day-id={dayId}>
      {/* Page Content */}
      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <ViewHeader
          title="View Day"
          date={formattedDate}
          status={data.status as ViewStatus}
          onBack={handleBack}
        />

        {/* Day Info Card */}
        {dayInfo && <DayInfoCard day={dayInfo} readOnly />}

        {/* Summary Cards Row */}
        {summaryData && <SummaryCardsRow data={summaryData} />}

        {/* Two Column Layout: Payment Methods + Sales Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {paymentData && (
            <PaymentMethodsCard data={paymentData} readOnly onPayoutClick={handlePayoutClick} />
          )}
          {salesData && <SalesBreakdownCard data={salesData} readOnly />}
        </div>

        {/* LOTTERY SECTION - Shows lottery totals from day view data */}
        {data.lotteryDayId && (
          <LotterySection
            dayId={data.lotteryDayId}
            total={lotteryTotal}
            ticketsSold={0} // Computed by lottery components from real data
          >
            {/* Note: Lottery bin/pack tables require separate data hooks.
                For now, show summary totals in the LotterySection header.
                Full bin/pack details available on LotteryPage for active day. */}
            <div className="rounded-lg bg-card border p-6 text-center text-muted-foreground">
              <p>Lottery pack details are available on the Lottery management page.</p>
              <p className="text-sm mt-2">Lottery sales total: {formatCurrency(lotteryTotal)}</p>
            </div>
          </LotterySection>
        )}

        {/* Footer */}
        <ViewFooter
          createdAt={formatDisplayDate(data.timestamps.createdAt)}
          closedAt={formatDisplayDate(data.timestamps.closedAt)}
          duration={duration}
        />
      </div>

      {/* Payout Modal */}
      <PayoutModal
        type={payoutModalType}
        data={payoutModalData}
        isOpen={payoutModalOpen}
        onClose={handlePayoutModalClose}
      />
    </div>
  );
}

ViewDayPage.displayName = 'ViewDayPage';
