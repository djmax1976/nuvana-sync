/**
 * ViewShiftPage Component
 *
 * Universal view page for shifts (both OPEN and CLOSED).
 * Composes shared components from the view/ directory.
 *
 * Route: /shifts/:shiftId
 * Applicable to: All POS types
 *
 * Behavior by POS type:
 * - LOTTERY stores: Shows only lottery section (no shift info, payments, sales)
 * - Non-LOTTERY stores: Shows full shift details
 *
 * Behavior by status:
 * - OPEN shifts: Shows "Close Shift" button that navigates to shift-end wizard
 * - CLOSED shifts: Read-only view
 *
 * @module renderer/pages/ViewShiftPage
 * @security FE-001: Uses JSX auto-escaping, no dangerouslySetInnerHTML
 * @security SEC-004: All content rendered via text nodes, XSS-safe
 * @security API-008: Only whitelisted fields displayed from data
 * @performance PERF-002: useMemo for computed values, useCallback for handlers
 */

import * as React from 'react';
import { useParams, useNavigate } from 'react-router-dom';

// Data hook
import { useShiftViewData } from '../hooks/useViewData';

// POS type detection for conditional rendering
import { useIsLotteryMode } from '../hooks/usePOSConnectionType';

// Phase 1 shared components
import { ViewHeader, type ViewStatus } from '../components/view/ViewHeader';
import { ShiftInfoCard, type ShiftInfo } from '../components/view/ShiftInfoCard';
import { SummaryCardsRow, type SummaryCardsData } from '../components/view/SummaryCardsRow';
import {
  PaymentMethodsCard,
  type PaymentMethodsData,
  type PayoutType,
} from '../components/view/PaymentMethodsCard';
import { SalesBreakdownCard, type SalesBreakdownData } from '../components/view/SalesBreakdownCard';
import { ViewFooter, calculateDuration } from '../components/view/ViewFooter';
import {
  PayoutModal,
  type PayoutModalData,
  type CashPayoutItem,
} from '../components/view/PayoutModal';
import { LotterySection } from '../components/view/LotterySection';

// UI components
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { Button } from '../components/ui/button';

// Utilities
import { formatCurrency } from '../lib/utils';

// Types from transport for type safety
import type { ShiftViewDataResponse } from '../lib/transport';

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
 * Transform IPC response to ShiftInfo component props
 * @security API-008: Only includes whitelisted display fields
 */
function transformToShiftInfo(data: ShiftViewDataResponse): ShiftInfo {
  return {
    terminalName: data.shiftInfo.terminalName,
    shiftNumber: data.shiftInfo.shiftNumber,
    cashierName: data.shiftInfo.cashierName,
    startedAt: formatDisplayDate(data.shiftInfo.startedAt),
    endedAt: formatDisplayDate(data.shiftInfo.endedAt),
    openingCash: data.shiftInfo.openingCash,
    closingCash: data.shiftInfo.closingCash,
  };
}

/**
 * Transform IPC response to SummaryCardsData component props
 * @security API-008: Only includes whitelisted display fields
 */
function transformToSummaryData(data: ShiftViewDataResponse): SummaryCardsData {
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
function transformToPaymentData(data: ShiftViewDataResponse): PaymentMethodsData {
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
function transformToSalesData(data: ShiftViewDataResponse): SalesBreakdownData {
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

export default function ViewShiftPage() {
  const { shiftId } = useParams<{ shiftId: string }>();
  const navigate = useNavigate();

  // Check if store is in LOTTERY-only mode
  const isLotteryMode = useIsLotteryMode();

  // Fetch shift view data via IPC
  const { data, isLoading, error } = useShiftViewData(shiftId);

  // State for payout modal
  const [payoutModalOpen, setPayoutModalOpen] = React.useState(false);
  const [payoutModalType, setPayoutModalType] = React.useState<PayoutType>('cash');

  // Navigation callback
  const handleBack = React.useCallback(() => {
    navigate(-1);
  }, [navigate]);

  /**
   * Navigate to Shift End wizard to close the shift.
   * Route: /shift-end?shiftId={shiftId}
   * @security SEC-010: Authorization enforced by ShiftEndPage
   */
  const handleCloseShift = React.useCallback(() => {
    if (shiftId) {
      navigate(`/shift-end?shiftId=${shiftId}`);
    }
  }, [navigate, shiftId]);

  // Payout modal handlers
  const handlePayoutClick = React.useCallback((type: PayoutType) => {
    setPayoutModalType(type);
    setPayoutModalOpen(true);
  }, []);

  const handlePayoutModalClose = React.useCallback(() => {
    setPayoutModalOpen(false);
  }, []);

  // Transform IPC data to component props - memoized for performance (PERF-002)
  const shiftInfo = React.useMemo(() => (data ? transformToShiftInfo(data) : null), [data]);

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

  // Loading state
  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center min-h-[400px]"
        data-testid="view-shift-page-loading"
      >
        <div className="flex flex-col items-center gap-4">
          <LoadingSpinner size="lg" />
          <p className="text-muted-foreground">Loading shift details...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !shiftId || !data) {
    return (
      <div className="max-w-[1200px] mx-auto p-6" data-testid="view-shift-page-error">
        <div className="rounded-lg bg-card border border-destructive p-6">
          <p className="text-destructive">
            {error instanceof Error
              ? error.message
              : !shiftId
                ? 'Invalid or missing shift ID.'
                : 'Failed to load shift data.'}
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

  // Determine if shift is open (can be closed)
  const isOpen = data.status === 'OPEN';

  // For LOTTERY-only stores, show only lottery section
  if (isLotteryMode) {
    return (
      <div
        className="min-h-screen bg-muted/30 pb-8"
        data-testid="view-shift-page"
        data-shift-id={shiftId}
        data-lottery-mode="true"
      >
        <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-6 max-w-[1600px] mx-auto">
          {/* Header */}
          <ViewHeader
            title={`View Shift #${data.shiftInfo.shiftNumber}`}
            date={formattedDate}
            status={data.status as ViewStatus}
            onBack={handleBack}
          />

          {/* LOTTERY SECTION - Only section shown for LOTTERY stores */}
          {data.lotteryDayId && (
            <LotterySection
              dayId={data.lotteryDayId}
              total={summaryData?.lotterySales.total ?? 0}
              ticketsSold={0}
            >
              <div className="rounded-lg bg-card border p-6 text-center text-muted-foreground">
                <p>Lottery pack details are available on the Lottery management page.</p>
                <p className="text-sm mt-2">
                  Lottery sales total: {formatCurrency(summaryData?.lotterySales.total ?? 0)}
                </p>
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
      </div>
    );
  }

  // Standard view for non-LOTTERY stores
  return (
    <div
      className="min-h-screen bg-muted/30 pb-8"
      data-testid="view-shift-page"
      data-shift-id={shiftId}
    >
      {/* Page Content */}
      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-6 max-w-[1600px] mx-auto">
        {/* Header with optional Close Shift action */}
        <div className="flex items-start justify-between gap-4">
          <ViewHeader
            title={`View Shift #${data.shiftInfo.shiftNumber}`}
            date={formattedDate}
            status={data.status as ViewStatus}
            onBack={handleBack}
          />
          {isOpen && (
            <Button
              variant="destructive"
              onClick={handleCloseShift}
              className="shrink-0"
              data-testid="close-shift-button"
            >
              Close Shift
            </Button>
          )}
        </div>

        {/* Shift Info Card */}
        {shiftInfo && <ShiftInfoCard shift={shiftInfo} readOnly />}

        {/* Summary Cards Row */}
        {summaryData && <SummaryCardsRow data={summaryData} />}

        {/* Two Column Layout: Payment Methods + Sales Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {paymentData && (
            <PaymentMethodsCard data={paymentData} readOnly onPayoutClick={handlePayoutClick} />
          )}
          {salesData && <SalesBreakdownCard data={salesData} readOnly />}
        </div>

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

ViewShiftPage.displayName = 'ViewShiftPage';
