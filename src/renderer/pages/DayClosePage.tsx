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
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { formatDateTime } from '../utils/date-format.utils';
import { useStoreTimezone } from '../contexts/StoreContext';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { CalendarCheck, Loader2, AlertCircle, Check, ArrowRight, ArrowLeft } from 'lucide-react';

import { useClientAuth } from '../contexts/ClientAuthContext';
import { useClientDashboard } from '../lib/api/client-dashboard';
import { useLotteryDayBins } from '../hooks/useLottery';
import { ShiftClosingForm } from '../components/shifts/ShiftClosingForm';
import { useShiftDetail, useOpenShiftsCheck } from '../lib/api/shifts';
import { useStoreTerminals } from '../lib/api/stores';
import { useCashiers } from '../lib/api/cashiers';
import { commitLotteryDayClose, cancelLotteryDayClose } from '../lib/api/lottery';
import { useToast } from '../hooks/use-toast';
import {
  DayCloseModeScanner,
  type LotteryCloseResult,
  type ScannedBin,
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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const shiftId = searchParams.get('shiftId');

  // Check if we're in manual mode (passed from TerminalsPage)
  const isManualMode = (location.state as { isManualMode?: boolean } | null)?.isManualMode ?? false;

  // ========================================================================
  // HOOKS
  // ========================================================================
  const storeTimezone = useStoreTimezone();

  // ============ AUTH & DATA HOOKS ============
  const { isLoading: authLoading } = useClientAuth();
  const {
    data: dashboardData,
    isLoading: dashboardLoading,
    isError: dashboardError,
  } = useClientDashboard();

  // Get store ID from user's accessible stores
  const storeId =
    dashboardData?.stores.find((s) => s.status === 'ACTIVE')?.store_id ||
    dashboardData?.stores[0]?.store_id;

  // Fetch shift details to check if already closed
  const { data: shiftData, isLoading: shiftLoading } = useShiftDetail(shiftId);
  const isShiftClosed = shiftData?.status === 'CLOSED';

  // Fetch terminals for the store to get terminal name
  const { data: terminals = [], isLoading: isLoadingTerminals } = useStoreTerminals(storeId, {
    enabled: !!storeId,
  });

  // Find terminal info by ID from shift data
  const terminal = shiftData
    ? terminals.find((t) => t.pos_terminal_id === shiftData.pos_terminal_id)
    : null;

  // Get cashiers to find cashier name (fallback if not in shiftData)
  const { data: cashiers = [], isLoading: isLoadingCashiers } = useCashiers(
    storeId || '',
    { is_active: true },
    { enabled: !!storeId }
  );

  // Find cashier info from shift - prefer shiftData.cashier_name, fallback to lookup
  const cashierName =
    shiftData?.cashier_name ||
    cashiers.find((c) => c.cashier_id === shiftData?.cashier_id)?.name ||
    'Unknown Cashier';

  // Lottery day bins data
  const {
    data: dayBinsData,
    isLoading: dayBinsLoading,
    isError: dayBinsError,
  } = useLotteryDayBins(storeId);

  // Open shifts check - BUSINESS RULE: All shifts must be closed before day close
  const {
    data: openShiftsData,
    isLoading: openShiftsLoading,
    isFetched: openShiftsFetched,
  } = useOpenShiftsCheck(storeId);

  // Exclude current shift from blocking list
  const otherOpenShifts = openShiftsData?.open_shifts?.filter((s) => s.shift_id !== shiftId) ?? [];
  const hasOtherOpenShifts = otherOpenShifts.length > 0;
  const openShiftsCheckComplete = !!storeId && openShiftsFetched;

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
    if (pendingLotteryDayId && storeId) {
      setIsCommittingLottery(true);
      try {
        const result = await commitLotteryDayClose();

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

    setShiftClosingFormOpen(true);
  }, [pendingLotteryDayId, storeId, toast]);

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
  useEffect(() => {
    if (isShiftClosed) {
      navigate('/mystore', { replace: true });
    }
  }, [isShiftClosed, navigate]);

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
  if (
    authLoading ||
    dashboardLoading ||
    shiftLoading ||
    isLoadingTerminals ||
    isLoadingCashiers ||
    dayBinsLoading ||
    openShiftsLoading
  ) {
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
  if (dashboardError || dayBinsError) {
    return (
      <div className="container mx-auto p-6" data-testid="day-close-wizard-error">
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p>
                {dayBinsError
                  ? 'Failed to load lottery bins data. Please restart the backend server and try again.'
                  : 'Failed to load dashboard data. Please try again.'}
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

  // Get store name and format date
  const storeName = dashboardData?.stores.find((s) => s.store_id === storeId)?.name || 'Your Store';
  const businessDate = lotteryData?.business_date || dayBinsData?.business_day?.date;
  const formattedDate = formatBusinessDate(businessDate);

  // Transform open shifts to blocking format for DayCloseModeScanner
  const blockingShifts = otherOpenShifts.map((shift) => ({
    shift_id: shift.shift_id,
    terminal_name: shift.terminal_name,
    cashier_name: shift.cashier_name,
    shift_number: shift.shift_number,
  }));

  // Terminal and shift display values
  const terminalName = terminal?.name || 'Terminal';
  const shiftNumber = shiftData?.shift_number;
  const shiftNumberDisplay = shiftNumber ? `#${shiftNumber}` : null;
  const shiftStartDateTime = shiftData?.opened_at
    ? formatDateTime(shiftData.opened_at, storeTimezone)
    : '';
  const openingCash = shiftData?.opening_cash ?? 0;

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
              blockingShifts={blockingShifts}
              returnedPacks={dayBinsData?.returned_packs}
              depletedPacks={dayBinsData?.depleted_packs}
              activatedPacks={dayBinsData?.activated_packs}
              openBusinessPeriod={dayBinsData?.open_business_period}
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

            {/* Open Shifts Blocking Banner */}
            {openShiftsCheckComplete && hasOtherOpenShifts && (
              <Card
                className="border-destructive bg-destructive/5"
                data-testid="open-shifts-blocking-banner"
              >
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <AlertCircle className="h-6 w-6 text-destructive flex-shrink-0 mt-0.5" />
                    <div className="space-y-3">
                      <div>
                        <h3 className="font-semibold text-destructive">
                          Cannot Close Day – Open Shifts Found
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          All shifts must be closed before the day can be closed.
                        </p>
                      </div>
                      <ul className="space-y-2">
                        {otherOpenShifts.map((shift) => (
                          <li key={shift.shift_id} className="text-sm flex items-center gap-2">
                            <Badge variant="outline" className="text-amber-600 border-amber-300">
                              {shift.status}
                            </Badge>
                            <span className="font-medium">
                              {shift.terminal_name || 'Unknown Terminal'}
                            </span>
                            <span className="text-muted-foreground">•</span>
                            <span>{shift.cashier_name}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

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
                      disabled={hasOtherOpenShifts || !shiftId || isCommittingLottery}
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
            {shiftId && (
              <ShiftClosingForm
                shiftId={shiftId}
                storeId={storeId}
                open={shiftClosingFormOpen}
                onOpenChange={setShiftClosingFormOpen}
                onSuccess={handleShiftClosingSuccess}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
