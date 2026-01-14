/**
 * Shift End Wizard Page
 *
 * 2-step wizard for ending a shift (separate from Day Close):
 * - Step 1: Report Scanning - Scan vendor invoices, lottery reports, gaming reports
 * - Step 2: Shift Closing - Cash reconciliation and final summary
 *
 * Route: /shift-end
 *
 * This is a SINGLE PAGE with internal step state (not separate routes).
 * Key difference from Day Close (3 steps):
 * - Shift Close does NOT include Lottery Close as a mandatory step
 * - Lottery is optional and can be done via banner button
 */

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge as _Badge } from '../components/ui/badge';
import { Clock, Loader2, AlertCircle, Check, ArrowLeft } from 'lucide-react';

import { useClientAuth } from '../contexts/ClientAuthContext';
import { useClientDashboard } from '../lib/api/client-dashboard';
import { useLotteryDayBins } from '../hooks/useLottery';
import { useShiftDetail } from '../lib/api/shifts';
import { useStoreTerminals } from '../lib/api/stores';
import { useCashiers } from '../lib/api/cashiers';
import { ShiftClosingForm } from '../components/shifts/ShiftClosingForm';
import { ShiftInfoHeader } from '../components/shifts/ShiftInfoHeader';
import {
  ShiftCloseStepIndicator,
  type ShiftCloseStep,
} from '../components/shifts/ShiftCloseStepIndicator';
import {
  CloseDayModal,
  type LotteryCloseResult,
  type ScannedBin,
} from '../components/lottery/CloseDayModal';

// Import shared shift-closing components
import {
  MoneyReceivedCard,
  SalesBreakdownCard,
  LotteryStatusBanner,
  LotterySalesDetails,
  formatBusinessDate,
  type MoneyReceivedState,
  type MoneyReceivedReportsState,
  type SalesBreakdownState,
  type SalesBreakdownReportsState,
  type LotteryStatus,
  DEFAULT_MONEY_RECEIVED_STATE,
  DEFAULT_SALES_BREAKDOWN_STATE,
} from '../components/shift-closing';

// Import Step 1 component (shared with Day Close)
import { ReportScanningStep } from '../components/day-close/ReportScanningStep';
import type { ReportScanningState } from '../components/day-close/ReportScanningStep';

// ============ TYPES ============

interface WizardState {
  currentStep: ShiftCloseStep;
  // Step 1: Report scanning data
  reportScanningData: ReportScanningState | null;
  reportScanningCompleted: boolean;
}

// ============ HELPER FUNCTIONS ============

/**
 * Determine lottery status for the banner
 */
function determineLotteryStatus(
  lotteryCompleted: boolean,
  isLotteryAlreadyClosed: boolean
): LotteryStatus {
  if (lotteryCompleted) return 'closed';
  if (isLotteryAlreadyClosed) return 'closed_earlier';
  return 'not_closed';
}

// ============ MAIN COMPONENT ============

/**
 * Shift End Wizard Page Component
 *
 * Enterprise-grade 2-step wizard for shift closing workflow.
 */
export default function ShiftEndWizardPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shiftId = searchParams.get('shiftId');

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
  const { data: dayBinsData, isLoading: dayBinsLoading } = useLotteryDayBins(storeId);

  // Check if lottery is already closed for today
  const isLotteryAlreadyClosed = dayBinsData?.business_day?.last_shift_closed_at !== null;

  // ============ WIZARD STATE ============
  const [wizardState, setWizardState] = useState<WizardState>({
    currentStep: 1,
    reportScanningData: null,
    reportScanningCompleted: false,
  });

  // Lottery modal state (optional for Shift Close)
  const [closeDayModalOpen, setCloseDayModalOpen] = useState(false);
  const [lotteryCompleted, setLotteryCompleted] = useState(false);
  const [lotteryData, setLotteryData] = useState<LotteryCloseResult | null>(null);
  // Scanned bins state - persists when modal is closed until day is closed
  const [scannedBins, setScannedBins] = useState<ScannedBin[]>([]);

  // Shift closing form state
  const [shiftClosingFormOpen, setShiftClosingFormOpen] = useState(false);

  // Money received state (Step 2 - dual-column)
  const [moneyReceivedState, setMoneyReceivedState] = useState<MoneyReceivedState>(
    DEFAULT_MONEY_RECEIVED_STATE
  );

  // Sales breakdown state (Step 2 - dual-column)
  const [salesBreakdownState, setSalesBreakdownState] = useState<SalesBreakdownState>(
    DEFAULT_SALES_BREAKDOWN_STATE
  );

  // ============ DERIVED STATE ============
  const { currentStep, reportScanningData, reportScanningCompleted } = wizardState;

  // Determine lottery status
  const lotteryStatus = determineLotteryStatus(lotteryCompleted, isLotteryAlreadyClosed);

  // Calculate scratch off total from lottery data
  const scratchOffTotal = lotteryData?.lottery_total ?? 0;

  // ============ STEP 1 HANDLERS ============
  /**
   * Handle completion of Report Scanning step
   *
   * Transfers lottery report data from Step 1 to Step 2:
   * - Lottery cashes (instant + online) → lotteryPayouts in money received
   * - Lottery sales/cashes → sales breakdown reports columns
   */
  const handleReportScanningComplete = useCallback((data: ReportScanningState) => {
    setWizardState((prev) => ({
      ...prev,
      reportScanningData: data,
      reportScanningCompleted: true,
      currentStep: 2, // Auto-advance to step 2
    }));

    // Import report data into Step 2 state
    // Total lottery cashes (instant + online) go into money received reports as lotteryPayouts
    const totalLotteryCashes =
      (data.lotteryReports?.instantCashes ?? 0) + (data.lotteryReports?.onlineCashes ?? 0);

    setMoneyReceivedState((prev) => ({
      ...prev,
      reports: {
        ...prev.reports,
        lotteryPayouts: totalLotteryCashes,
      },
    }));

    // Lottery sales and cashes go into sales breakdown reports
    // Each field maps directly from the lottery terminal report
    setSalesBreakdownState((prev) => ({
      ...prev,
      reports: {
        ...prev.reports,
        scratchOff: data.lotteryReports?.instantSales ?? 0,
        instantCashes: data.lotteryReports?.instantCashes ?? 0,
        onlineLottery: data.lotteryReports?.onlineSales ?? 0,
        onlineCashes: data.lotteryReports?.onlineCashes ?? 0,
      },
    }));
  }, []);

  const handleReportScanningBack = useCallback(() => {
    // Navigate back to terminal shift page
    navigate(-1);
  }, [navigate]);

  // ============ STEP 2 HANDLERS ============
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

  // Handle lottery close success
  const handleLotterySuccess = useCallback((data: LotteryCloseResult) => {
    setLotteryData(data);
    setLotteryCompleted(true);
    setCloseDayModalOpen(false);

    // Update the POS scratch off value with lottery total
    setSalesBreakdownState((prev) => ({
      ...prev,
      pos: {
        ...prev.pos,
        scratchOff: data.lottery_total,
      },
    }));
  }, []);

  // Handle opening lottery modal (optional for Shift Close)
  const handleOpenLotteryModal = useCallback(() => {
    setCloseDayModalOpen(true);
  }, []);

  // Handle opening shift closing form
  const handleOpenShiftClosingForm = useCallback(() => {
    setShiftClosingFormOpen(true);
  }, []);

  // Handle shift closing success - navigate to mystore dashboard
  const handleShiftClosingSuccess = useCallback(() => {
    setShiftClosingFormOpen(false);
    navigate('/mystore');
  }, [navigate]);

  // Handle going back to step 1
  const handleStep2Back = useCallback(() => {
    setWizardState((prev) => ({
      ...prev,
      currentStep: 1,
    }));
  }, []);

  // ============ REDIRECT IF SHIFT CLOSED ============
  useEffect(() => {
    if (isShiftClosed) {
      navigate('/mystore', { replace: true });
    }
  }, [isShiftClosed, navigate]);

  // ============ LOADING STATE ============
  if (authLoading || dashboardLoading || shiftLoading || isLoadingTerminals || isLoadingCashiers) {
    return (
      <div
        className="flex items-center justify-center min-h-[400px]"
        data-testid="shift-end-wizard-loading"
      >
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // ============ ERROR STATE ============
  if (dashboardError) {
    return (
      <div className="container mx-auto p-6" data-testid="shift-end-wizard-error">
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p>Failed to load dashboard data. Please try again.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============ NO STORE STATE ============
  if (!storeId) {
    return (
      <div className="container mx-auto p-6" data-testid="shift-end-wizard-no-store">
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

  // Terminal and shift display values
  const terminalName = terminal?.name || 'Terminal';
  const shiftNumber = shiftData?.shift_number ?? null;
  const shiftStartTime = shiftData?.opened_at ?? new Date().toISOString();
  const openingCash = shiftData?.opening_cash ?? 0;

  // ============ RENDER ============
  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="shift-end-wizard">
      {/* Shared Header Component */}
      <ShiftInfoHeader
        terminalName={terminalName}
        shiftNumber={shiftNumber}
        cashierName={cashierName}
        shiftStartTime={shiftStartTime}
        openingCash={openingCash}
      />

      {/* Step Progress Indicator */}
      <ShiftCloseStepIndicator
        currentStep={currentStep}
        reportScanningCompleted={reportScanningCompleted}
      />

      {/* Main Content Area */}
      <main>
        {/* ============ STEP 1: REPORT SCANNING ============ */}
        {currentStep === 1 && (
          <div data-testid="shift-close-step-1-content">
            <ReportScanningStep
              storeId={storeId}
              onComplete={handleReportScanningComplete}
              onBack={handleReportScanningBack}
              canGoBack={true}
              initialData={reportScanningData}
            />
          </div>
        )}

        {/* ============ STEP 2: CLOSE SHIFT ============ */}
        {currentStep === 2 && (
          <div data-testid="shift-close-step-2-content" className="space-y-6">
            {/* Header */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold flex items-center gap-2">
                    <Clock className="h-7 w-7" />
                    Step 2: Close Shift
                  </h2>
                  <p className="text-muted-foreground">
                    {storeName} - {formattedDate}
                  </p>
                </div>
              </div>
            </div>

            {/* Lottery Status Banner - Optional for Shift Close */}
            {!dayBinsLoading && (
              <LotteryStatusBanner
                status={lotteryStatus}
                lotteryData={lotteryData}
                lotteryTotal={scratchOffTotal}
                isRequired={false} // Lottery is OPTIONAL for shift close
                onOpenLotteryModal={handleOpenLotteryModal}
              />
            )}

            {/* Main Content - Two Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column - Payment Methods */}
              <MoneyReceivedCard
                state={moneyReceivedState}
                onReportsChange={handleMoneyReportsChange}
              />

              {/* Right Column - Department Sales */}
              <SalesBreakdownCard
                state={salesBreakdownState}
                onReportsChange={handleSalesReportsChange}
              />
            </div>

            {/* Lottery Breakdown Details (shown after close) */}
            {lotteryData && <LotterySalesDetails data={lotteryData} />}

            {/* Action Buttons */}
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {lotteryCompleted || isLotteryAlreadyClosed
                      ? 'Lottery is closed. Complete the shift close when ready.'
                      : 'Lottery close is optional. You can complete shift close without it.'}
                  </p>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      onClick={handleStep2Back}
                      data-testid="shift-close-back-btn"
                    >
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Back
                    </Button>
                    <Button variant="outline" onClick={() => navigate('/mystore')}>
                      Cancel
                    </Button>
                    <Button
                      data-testid="complete-shift-close-btn"
                      onClick={handleOpenShiftClosingForm}
                      disabled={!shiftId}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Complete Shift Close
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      {/* Lottery Close Modal (Optional) */}
      {dayBinsData && (
        <CloseDayModal
          storeId={storeId}
          bins={dayBinsData.bins}
          open={closeDayModalOpen}
          onOpenChange={setCloseDayModalOpen}
          onSuccessWithData={handleLotterySuccess}
          scannedBins={scannedBins}
          onScannedBinsChange={setScannedBins}
        />
      )}

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
  );
}
