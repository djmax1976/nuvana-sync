/**
 * Day Close Wizard Page
 *
 * 3-step wizard for closing the business day:
 * - Step 1: Lottery Close - Scan all active bins to record ending serials
 * - Step 2: Report Scanning - Scan vendor invoices, lottery reports, gaming reports
 * - Step 3: Day Close - Final summary with payment methods, department sales, confirmation
 *
 * Route: /day-close
 *
 * This is a SINGLE PAGE with internal step state (not separate routes).
 * Data flows through the wizard steps - lottery totals are imported into Step 3.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { formatDateTime } from '../utils/date-format.utils';
import { useStoreTimezone } from '../contexts/StoreContext';
import { Button } from '../components/ui/button';
import { CalendarCheck, Loader2, AlertCircle, Check, ArrowRight, ArrowLeft } from 'lucide-react';

// Day Close Access Context - provides validated shift/user from guard
// SEC-010: Authorization already enforced by DayCloseAccessGuard before rendering
import { useDayCloseAccessContext } from '../contexts/DayCloseAccessContext';

// Local IPC hooks - query local SQLite directly, no cloud API dependency
import { useLocalStore } from '../hooks/useLocalStore';
import { useLotteryDayBins } from '../hooks/useLottery';
import { useIsLotteryMode } from '../hooks/usePOSConnectionType';
import { ShiftClosingForm } from '../components/shifts/ShiftClosingForm';
import {
  prepareLotteryDayClose,
  commitLotteryDayClose,
  cancelLotteryDayClose,
} from '../lib/api/lottery';
import { useToast } from '../hooks/use-toast';
import {
  DayCloseModeScanner,
  type LotteryCloseResult,
  type ScannedBin,
  type PendingClosingsData,
} from '../components/lottery/DayCloseModeScanner';

// Import shared shift-closing components for Step 3
import {
  MoneyReceivedCard,
  SalesBreakdownCard,
  LotteryStatusBanner,
  LotterySalesDetails,
  formatBusinessDate,
  type MoneyReceivedState,
  type MoneyReceivedReportsState,
  type MoneyReceivedPOSState,
  type SalesBreakdownState,
  type SalesBreakdownReportsState,
  type SalesBreakdownPOSState,
  DEFAULT_MONEY_RECEIVED_STATE,
  DEFAULT_SALES_BREAKDOWN_STATE,
} from '../components/shift-closing';

// Import Step 2 component
import { ReportScanningStep } from '../components/day-close/ReportScanningStep';
import type { ReportScanningState } from '../components/day-close/ReportScanningStep';

// Import lottery pack sections for Step 3
import { ReturnedPacksSection } from '../components/lottery/ReturnedPacksSection';
import { DepletedPacksSection } from '../components/lottery/DepletedPacksSection';
import { ActivatedPacksSection } from '../components/lottery/ActivatedPacksSection';

// ============ TYPES ============

type WizardStep = 1 | 2 | 3;

interface WizardState {
  currentStep: WizardStep;
  // Step 1: Lottery data
  lotteryCompleted: boolean;
  lotteryData: LotteryCloseResult | null;
  scannedBins: ScannedBin[];
  // Step 2: Report scanning data
  reportScanningData: ReportScanningState | null;
  // Step 3 uses shared state from shift-closing components
  // Two-phase commit tracking
  pendingLotteryDayId: string | null;
  pendingLotteryCloseExpiresAt: string | null;
  /**
   * Deferred commit data for non-LOTTERY POS types.
   * When deferCommit=true in DayCloseModeScanner, closings are stored here
   * instead of being committed immediately. Step 3 then commits via API.
   * SEC-010: fromWizard flag enables backend to allow non-LOTTERY POS closes.
   */
  pendingClosings: PendingClosingsData | null;
}

// ============ STEP INDICATOR COMPONENT ============

interface StepIndicatorProps {
  currentStep: WizardStep;
  lotteryCompleted: boolean;
  reportScanningCompleted: boolean;
}

function StepIndicator({
  currentStep,
  lotteryCompleted,
  reportScanningCompleted,
}: StepIndicatorProps) {
  const steps = [
    { number: 1, label: 'Lottery Close', completed: lotteryCompleted },
    { number: 2, label: 'Report Scanning', completed: reportScanningCompleted },
    { number: 3, label: 'Day Close', completed: false },
  ];

  return (
    <div className="bg-card border-b px-6 py-4" data-testid="step-indicator">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          {steps.map((step, index) => (
            <div key={step.number} className="flex items-center flex-1">
              {/* Step circle and label */}
              <div className="flex items-center">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg transition-colors ${
                    step.completed
                      ? 'bg-green-600 text-white'
                      : currentStep === step.number
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                  }`}
                  data-testid={`step-${step.number}-indicator`}
                >
                  {step.completed ? <Check className="w-5 h-5" /> : step.number}
                </div>
                <span
                  className={`ml-3 font-medium ${
                    step.completed
                      ? 'text-green-600'
                      : currentStep === step.number
                        ? 'text-primary'
                        : 'text-muted-foreground'
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {/* Connecting line (not after last step) */}
              {index < steps.length - 1 && (
                <div
                  className={`flex-1 h-1 mx-4 transition-colors ${
                    step.completed ? 'bg-green-600' : 'bg-muted'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============ MAIN COMPONENT ============

export default function DayCloseWizardPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  // SEC-010: Get validated shift/user from context (set by DayCloseAccessGuard)
  // Guard has already verified: exactly one open shift exists, user is authorized
  const { activeShift, user, accessType } = useDayCloseAccessContext();
  const shiftId = activeShift.shift_id;

  // Manual mode allows direct editing of POS totals (when automatic POS sync unavailable)
  // Default to false - POS data comes from automatic sync; manual editing disabled
  // Note: Could be passed via location.state from TerminalsPage if manual override needed
  const isManualMode = false;

  // ========================================================================
  // HOOKS
  // ========================================================================
  const storeTimezone = useStoreTimezone();

  // Check if this is a LOTTERY-only POS type
  // Non-lottery POS types must use deferCommit mode for lottery close
  // (API blocks independent lottery close for non-LOTTERY POS types)
  const isLotteryMode = useIsLotteryMode();

  // ============ LOCAL IPC DATA HOOKS ============
  // DB-006: All queries are store-scoped via backend handlers
  // SEC-006: All queries use parameterized statements in backend

  // Get configured store from local settings (replaces useClientDashboard)
  const { data: localStoreData, isLoading: storeLoading, isError: storeError } = useLocalStore();

  // Get store ID from local configuration
  const storeId = localStoreData?.store_id;

  // ============ DATA FROM CONTEXT ============
  // SEC-010: Shift and user data comes from DayCloseAccessGuard
  // Guard has already verified: exactly one open shift, user is authorized
  // No need for separate shift/terminal/cashier/open-shifts queries

  // Terminal and cashier names are pre-resolved by the guard's backend handler
  const terminalName = activeShift.terminal_name || 'Terminal';
  const cashierName = activeShift.cashier_name || 'Unknown Cashier';

  // Lottery day bins data
  const {
    data: dayBinsData,
    isLoading: dayBinsLoading,
    isError: dayBinsError,
  } = useLotteryDayBins(storeId);

  // Check if lottery is already closed for today
  // Use the business_day.status field which is "CLOSED" when lottery was closed
  const isLotteryAlreadyClosed = !!dayBinsData && dayBinsData.business_day?.status === 'CLOSED';

  // ============================================================================
  // LOTTERY CLOSE DATA FROM API (Enterprise Pattern)
  // ============================================================================
  const calculatedLotteryData = useMemo((): LotteryCloseResult | null => {
    if (!isLotteryAlreadyClosed || !dayBinsData) return null;

    // Prefer pre-calculated day_close_summary from API (correct calculation data)
    const summary = dayBinsData.day_close_summary;
    if (summary && summary.bins_closed.length > 0) {
      return {
        closings_created: summary.closings_count,
        business_date: dayBinsData.business_day?.date || '',
        lottery_total: summary.lottery_total,
        bins_closed: summary.bins_closed.map((bin) => ({
          bin_number: bin.bin_number,
          pack_number: bin.pack_number,
          game_name: bin.game_name,
          closing_serial: bin.ending_serial,
          starting_serial: bin.starting_serial,
          game_price: bin.game_price,
          tickets_sold: bin.tickets_sold,
          sales_amount: bin.sales_amount,
        })),
      };
    }

    // Fallback: For backward compatibility
    const closedBins = dayBinsData.bins.filter(
      (bin) => bin.is_active && bin.pack && bin.pack.ending_serial
    );

    if (closedBins.length === 0) return null;

    console.warn('[DayClosePage] Using fallback calculation - day_close_summary not available.');

    let lotteryTotal = 0;
    const binsClosedData = closedBins.map((bin) => {
      const pack = bin.pack!;
      const startingSerialNum = parseInt(pack.starting_serial, 10);
      const closingSerialNum = parseInt(pack.ending_serial!, 10);

      if (Number.isNaN(startingSerialNum) || Number.isNaN(closingSerialNum)) {
        return {
          bin_number: bin.bin_number,
          pack_number: pack.pack_number,
          game_name: pack.game_name,
          closing_serial: pack.ending_serial!,
          starting_serial: pack.starting_serial,
          game_price: pack.game_price,
          tickets_sold: 0,
          sales_amount: 0,
        };
      }

      const ticketsSold = Math.max(0, closingSerialNum - startingSerialNum);
      const salesAmount = ticketsSold * pack.game_price;
      lotteryTotal += salesAmount;

      return {
        bin_number: bin.bin_number,
        pack_number: pack.pack_number,
        game_name: pack.game_name,
        closing_serial: pack.ending_serial!,
        starting_serial: pack.starting_serial,
        game_price: pack.game_price,
        tickets_sold: ticketsSold,
        sales_amount: salesAmount,
      };
    });

    return {
      closings_created: closedBins.length,
      business_date: dayBinsData.business_day?.date || '',
      lottery_total: lotteryTotal,
      bins_closed: binsClosedData,
    };
  }, [isLotteryAlreadyClosed, dayBinsData]);

  // ============ WIZARD STATE ============
  const [wizardState, setWizardState] = useState<WizardState>({
    currentStep: 1,
    lotteryCompleted: false,
    lotteryData: null,
    scannedBins: [],
    reportScanningData: null,
    pendingLotteryDayId: null,
    pendingLotteryCloseExpiresAt: null,
    pendingClosings: null,
  });

  // Loading state for committing lottery close
  const [isCommittingLottery, setIsCommittingLottery] = useState(false);

  // Shift closing form state (Step 3)
  const [shiftClosingFormOpen, setShiftClosingFormOpen] = useState(false);

  // Money received state (Step 3 - dual-column)
  const [moneyReceivedState, setMoneyReceivedState] = useState<MoneyReceivedState>(
    DEFAULT_MONEY_RECEIVED_STATE
  );

  // Sales breakdown state (Step 3 - dual-column)
  const [salesBreakdownState, setSalesBreakdownState] = useState<SalesBreakdownState>(
    DEFAULT_SALES_BREAKDOWN_STATE
  );

  // ============ DERIVED STATE ============
  const {
    currentStep,
    lotteryCompleted,
    lotteryData,
    scannedBins,
    reportScanningData,
    pendingLotteryDayId,
    pendingLotteryCloseExpiresAt,
    pendingClosings,
  } = wizardState;

  // If lottery was already closed before wizard started, skip to step 2
  // and populate lotteryData from calculated values
  useEffect(() => {
    if (isLotteryAlreadyClosed && !lotteryCompleted && currentStep === 1) {
      setWizardState((prev) => ({
        ...prev,
        currentStep: 2,
        lotteryCompleted: true,
        lotteryData: calculatedLotteryData,
      }));

      if (calculatedLotteryData) {
        setSalesBreakdownState((prev) => ({
          ...prev,
          reports: {
            ...prev.reports,
            scratchOff: calculatedLotteryData.lottery_total,
          },
        }));
      }
    }
  }, [isLotteryAlreadyClosed, lotteryCompleted, currentStep, calculatedLotteryData]);

  // Calculate scratch off total from lottery data
  const scratchOffTotal = lotteryData?.lottery_total ?? 0;

  // Report scanning completed when data exists
  const reportScanningCompleted = reportScanningData !== null;

  // ============ STEP 1 HANDLERS ============
  const handleLotterySuccess = useCallback((data: LotteryCloseResult) => {
    setWizardState((prev) => ({
      ...prev,
      lotteryCompleted: true,
      lotteryData: data,
      currentStep: 2,
      pendingLotteryDayId: data.day_id || null,
      pendingLotteryCloseExpiresAt: data.pending_close_expires_at || null,
    }));

    setSalesBreakdownState((prev) => ({
      ...prev,
      reports: {
        ...prev.reports,
        scratchOff: data.lottery_total,
      },
    }));
  }, []);

  const handleScannedBinsChange = useCallback((bins: ScannedBin[]) => {
    setWizardState((prev) => ({
      ...prev,
      scannedBins: bins,
    }));
  }, []);

  /**
   * Handle pending closings data from DayCloseModeScanner in deferred commit mode.
   * SEC-010: This data will be committed with fromWizard=true in Step 3.
   * Called when deferCommit=true (non-LOTTERY POS types).
   */
  const handlePendingClosings = useCallback((data: PendingClosingsData) => {
    setWizardState((prev) => ({
      ...prev,
      pendingClosings: data,
    }));
  }, []);

  const handleLotteryCancel = useCallback(async () => {
    if (pendingLotteryDayId && storeId) {
      try {
        await cancelLotteryDayClose();
      } catch {
        // Ignore errors - will auto-expire
      }
    }
    navigate('/mystore');
  }, [pendingLotteryDayId, storeId, navigate]);

  // ============ STEP 2 HANDLERS ============
  const handleReportScanningComplete = useCallback((data: ReportScanningState) => {
    setWizardState((prev) => ({
      ...prev,
      reportScanningData: data,
      currentStep: 3,
    }));

    const totalLotteryCashes =
      (data.lotteryReports?.instantCashes ?? 0) + (data.lotteryReports?.onlineCashes ?? 0);

    setMoneyReceivedState((prev) => ({
      ...prev,
      reports: {
        ...prev.reports,
        lotteryPayouts: totalLotteryCashes,
      },
    }));

    setSalesBreakdownState((prev) => ({
      ...prev,
      reports: {
        ...prev.reports,
        instantCashes: data.lotteryReports?.instantCashes ?? 0,
        onlineLottery: data.lotteryReports?.onlineSales ?? 0,
        onlineCashes: data.lotteryReports?.onlineCashes ?? 0,
      },
    }));
  }, []);

  const handleReportScanningBack = useCallback(() => {
    if (!isLotteryAlreadyClosed) {
      setWizardState((prev) => ({
        ...prev,
        currentStep: 1,
      }));
    }
  }, [isLotteryAlreadyClosed]);

  // ============ STEP 3 HANDLERS ============
  const handleMoneyReportsChange = useCallback((changes: Partial<MoneyReceivedReportsState>) => {
    setMoneyReceivedState((prev) => ({
      ...prev,
      reports: { ...prev.reports, ...changes },
    }));
  }, []);

  const handleSalesReportsChange = useCallback((changes: Partial<SalesBreakdownReportsState>) => {
    setSalesBreakdownState((prev) => ({
      ...prev,
      reports: { ...prev.reports, ...changes },
    }));
  }, []);

  // Manual Mode: POS data change handlers (only used when isManualMode is true)
  const handleMoneyPOSChange = useCallback((changes: Partial<MoneyReceivedPOSState>) => {
    setMoneyReceivedState((prev) => ({
      ...prev,
      pos: { ...prev.pos, ...changes },
    }));
  }, []);

  const handleSalesPOSChange = useCallback((changes: Partial<SalesBreakdownPOSState>) => {
    setSalesBreakdownState((prev) => ({
      ...prev,
      pos: { ...prev.pos, ...changes },
    }));
  }, []);

  const handleOpenShiftClosingForm = useCallback(async () => {
    // ========================================================================
    // Case 1: LOTTERY POS type - immediate commit (pendingLotteryDayId exists)
    // The scanner already called prepareDayClose, we just need to commit
    // ========================================================================
    if (pendingLotteryDayId && storeId) {
      setIsCommittingLottery(true);
      try {
        // Pass day_id from prepare response to commit
        const result = await commitLotteryDayClose({ day_id: pendingLotteryDayId });

        if (result.success) {
          toast({
            title: 'Lottery Closed',
            description: `Lottery day closed successfully. ${result.data?.closings_created || 0} pack(s) recorded.`,
          });

          setWizardState((prev) => ({
            ...prev,
            pendingLotteryDayId: null,
            pendingLotteryCloseExpiresAt: null,
          }));
        } else {
          throw new Error('Failed to commit lottery close');
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to finalize lottery close';
        toast({
          title: 'Error',
          description: errorMessage,
          variant: 'destructive',
        });
        setIsCommittingLottery(false);
        return;
      }
      setIsCommittingLottery(false);
    }

    // ========================================================================
    // Case 2: Non-LOTTERY POS type - deferred commit (pendingClosings exists)
    // SEC-010: fromWizard=true bypasses POS type restriction in backend
    // BIZ-007: Backend auto-opens next day after commit
    // ========================================================================
    if (pendingClosings && !pendingLotteryDayId && storeId) {
      setIsCommittingLottery(true);
      try {
        // Phase 1: Prepare - validates and stores pending data
        // SEC-010: fromWizard=true allows non-LOTTERY POS types
        const prepareResult = await prepareLotteryDayClose({
          closings: pendingClosings.closings,
          fromWizard: true,
        });

        if (!prepareResult.success || !prepareResult.data) {
          throw new Error(prepareResult.message || 'Failed to prepare lottery close');
        }

        const dayId = prepareResult.data.day_id;

        // Phase 2: Commit - applies settlements, sets CLOSED status
        // SEC-010: fromWizard=true allows non-LOTTERY POS types
        // BIZ-007: Backend auto-opens next day after successful commit
        const commitResult = await commitLotteryDayClose({
          day_id: dayId,
          fromWizard: true,
        });

        if (commitResult.success) {
          toast({
            title: 'Lottery Closed',
            description: `Lottery day closed successfully. ${commitResult.data?.closings_created || 0} pack(s) recorded.`,
          });

          setWizardState((prev) => ({
            ...prev,
            pendingClosings: null,
          }));
        } else {
          throw new Error('Failed to commit lottery close');
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to finalize lottery close';
        toast({
          title: 'Error',
          description: errorMessage,
          variant: 'destructive',
        });
        setIsCommittingLottery(false);
        return;
      }
      setIsCommittingLottery(false);
    }

    setShiftClosingFormOpen(true);
  }, [pendingLotteryDayId, pendingClosings, storeId, toast]);

  const handleShiftClosingSuccess = useCallback(() => {
    setShiftClosingFormOpen(false);
    navigate('/mystore');
  }, [navigate]);

  const handleStep3Back = useCallback(() => {
    setWizardState((prev) => ({
      ...prev,
      currentStep: 2,
    }));
  }, []);

  const handleCancelWizard = useCallback(async () => {
    if (!confirm('Are you sure you want to cancel? All progress will be lost.')) {
      return;
    }

    if (pendingLotteryDayId && storeId) {
      try {
        await cancelLotteryDayClose();
      } catch {
        // Don't block navigation
      }
    }

    navigate('/mystore');
  }, [pendingLotteryDayId, storeId, navigate]);

  // ============ REDIRECT IF SHIFT CLOSED ============
  // Note: DayCloseAccessGuard already validates exactly one open shift exists (BR-001, BR-002)
  // This redirect is no longer needed as the guard prevents access if conditions aren't met

  // ============ CLEANUP ON PAGE UNLOAD ============
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingLotteryDayId && storeId) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [pendingLotteryDayId, storeId]);

  // ============ LOADING STATE ============
  // Local IPC hooks - no cloud auth/dashboard loading
  // Note: Shift/terminal/cashier data comes from context (DayCloseAccessGuard)
  // Only store config and lottery bins need loading checks
  if (storeLoading || dayBinsLoading) {
    return (
      <div
        className="flex items-center justify-center min-h-[400px]"
        data-testid="day-close-wizard-loading"
      >
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // ============ ERROR STATE ============
  // Local IPC error handling
  if (storeError || dayBinsError) {
    return (
      <div className="container mx-auto p-6" data-testid="day-close-wizard-error">
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p>
                {dayBinsError
                  ? 'Failed to load lottery bins data. Please restart the backend server and try again.'
                  : 'Failed to load store data. Ensure the store is configured and try again.'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============ NO STORE STATE ============
  if (!storeId) {
    return (
      <div className="container mx-auto p-6" data-testid="day-close-wizard-no-store">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">
              No store available. Please contact your administrator.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Get store name from local configuration and format date
  const storeName = localStoreData?.name || 'Your Store';
  const businessDate = lotteryData?.business_date || dayBinsData?.business_day?.date;
  const formattedDate = formatBusinessDate(businessDate);

  // ============ CONTEXT-PROVIDED SHIFT VALUES ============
  // SEC-010: Shift data validated by DayCloseAccessGuard before rendering
  // BR-001, BR-002: Guard already verified exactly one open shift exists
  // No blocking shifts check needed - guard prevents entry if conditions aren't met

  // Shift display values from context (pre-resolved by guard's backend handler)
  const shiftNumber = activeShift.shift_number;
  const shiftNumberDisplay = shiftNumber ? `#${shiftNumber}` : null;
  const shiftStartDateTime = activeShift.start_time
    ? formatDateTime(activeShift.start_time, storeTimezone)
    : '';
  // Opening cash not available from context - would need separate query
  // Display 0 as fallback; could be enhanced to fetch from shift summary if needed
  const openingCash = 0;

  // Format currency helper
  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  // ============ RENDER ============
  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="day-close-wizard">
      {/* Header - All shift info in one card on one line */}
      <Card className="border-muted" data-testid="shift-info-header">
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Terminal:</span>
              <span className="font-semibold">{terminalName}</span>
            </div>
            {shiftNumberDisplay && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Shift:</span>
                <span className="font-semibold">{shiftNumberDisplay}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Cashier:</span>
              <span className="font-semibold">{cashierName}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Started:</span>
              <span className="font-medium">{shiftStartDateTime}</span>
            </div>
            <div className="flex items-center gap-2" data-testid="opening-cash-display">
              <span className="text-muted-foreground">Opening Cash:</span>
              <span className="font-semibold text-green-600">{formatCurrency(openingCash)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step Progress Indicator */}
      <StepIndicator
        currentStep={currentStep}
        lotteryCompleted={lotteryCompleted || isLotteryAlreadyClosed}
        reportScanningCompleted={reportScanningCompleted}
      />

      {/* Main Content Area */}
      <main>
        {/* ============ STEP 1: LOTTERY CLOSE ============ */}
        {currentStep === 1 && (
          <div data-testid="step-1-content">
            <DayCloseModeScanner
              storeId={storeId}
              bins={dayBinsData?.bins ?? []}
              currentShiftId={shiftId || undefined}
              onCancel={handleLotteryCancel}
              onSuccess={handleLotterySuccess}
              scannedBins={scannedBins}
              onScannedBinsChange={handleScannedBinsChange}
              returnedPacks={dayBinsData?.returned_packs}
              depletedPacks={dayBinsData?.depleted_packs}
              activatedPacks={dayBinsData?.activated_packs}
              openBusinessPeriod={dayBinsData?.open_business_period}
              deferCommit={!isLotteryMode}
              onPendingClosings={handlePendingClosings}
            />
          </div>
        )}

        {/* ============ STEP 2: REPORT SCANNING ============ */}
        {currentStep === 2 && (
          <div data-testid="step-2-content">
            <ReportScanningStep
              storeId={storeId}
              onComplete={handleReportScanningComplete}
              onBack={handleReportScanningBack}
              canGoBack={!isLotteryAlreadyClosed}
              initialData={reportScanningData}
            />
          </div>
        )}

        {/* ============ STEP 3: DAY CLOSE ============ */}
        {currentStep === 3 && (
          <div data-testid="step-3-content" className="space-y-6">
            {/* Header */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-3xl font-bold flex items-center gap-2">
                    <CalendarCheck className="h-8 w-8" />
                    Step 3: Close Day
                  </h1>
                  <p className="text-muted-foreground">
                    {storeName} - {formattedDate}
                  </p>
                </div>
              </div>
            </div>

            {/* Lottery Status Banner */}
            <LotteryStatusBanner
              status={pendingLotteryDayId ? 'pending' : 'closed'}
              lotteryData={lotteryData}
              lotteryTotal={scratchOffTotal}
              isRequired={true}
            />

            {/* Note: Open Shifts Blocking Banner removed (Phase 4, Task 4.3)
                DayCloseAccessGuard now validates exactly one open shift exists (BR-001, BR-002)
                before allowing access to this page. No redundant check needed. */}

            {/* Main Content - Two Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column - Payment Methods */}
              <MoneyReceivedCard
                state={moneyReceivedState}
                onReportsChange={handleMoneyReportsChange}
                editablePOS={isManualMode}
                onPOSChange={isManualMode ? handleMoneyPOSChange : undefined}
              />

              {/* Right Column - Department Sales */}
              <SalesBreakdownCard
                state={salesBreakdownState}
                onReportsChange={handleSalesReportsChange}
                editablePOS={isManualMode}
                onPOSChange={isManualMode ? handleSalesPOSChange : undefined}
              />
            </div>

            {/* Lottery Breakdown Details */}
            {lotteryData && <LotterySalesDetails data={lotteryData} />}

            {/* Pack Sections */}
            {((dayBinsData?.returned_packs && dayBinsData.returned_packs.length > 0) ||
              (dayBinsData?.depleted_packs && dayBinsData.depleted_packs.length > 0) ||
              (dayBinsData?.activated_packs && dayBinsData.activated_packs.length > 0)) && (
              <div className="space-y-4" data-testid="step3-packs-sections">
                {dayBinsData?.returned_packs && dayBinsData.returned_packs.length > 0 && (
                  <ReturnedPacksSection
                    returnedPacks={dayBinsData.returned_packs}
                    openBusinessPeriod={dayBinsData.open_business_period}
                    defaultOpen={false}
                  />
                )}

                {dayBinsData?.depleted_packs && dayBinsData.depleted_packs.length > 0 && (
                  <DepletedPacksSection
                    depletedPacks={dayBinsData.depleted_packs}
                    openBusinessPeriod={dayBinsData.open_business_period}
                    defaultOpen={false}
                  />
                )}

                {dayBinsData?.activated_packs && dayBinsData.activated_packs.length > 0 && (
                  <ActivatedPacksSection
                    activatedPacks={dayBinsData.activated_packs}
                    openBusinessPeriod={dayBinsData.open_business_period}
                    defaultOpen={false}
                  />
                )}
              </div>
            )}

            {/* Action Buttons */}
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {pendingLotteryDayId
                      ? 'Lottery scanned and ready. Click Complete Day Close to finalize lottery and shift.'
                      : 'Lottery is closed. Complete the day close when ready.'}
                  </p>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      onClick={handleStep3Back}
                      disabled={isCommittingLottery}
                    >
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Back
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleCancelWizard}
                      disabled={isCommittingLottery}
                    >
                      Cancel
                    </Button>
                    <Button
                      disabled={isCommittingLottery}
                      data-testid="complete-day-close-btn"
                      onClick={handleOpenShiftClosingForm}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      {isCommittingLottery ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Finalizing Lottery...
                        </>
                      ) : (
                        <>
                          <Check className="mr-2 h-4 w-4" />
                          Complete Day Close
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Shift Closing Form Modal */}
            {/* SEC-010: Pass preAuthorizedOverride when user came from guard with manager role */}
            {shiftId && (
              <ShiftClosingForm
                shiftId={shiftId}
                storeId={storeId}
                open={shiftClosingFormOpen}
                onOpenChange={setShiftClosingFormOpen}
                onSuccess={handleShiftClosingSuccess}
                preAuthorizedOverride={accessType === 'OVERRIDE'}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
