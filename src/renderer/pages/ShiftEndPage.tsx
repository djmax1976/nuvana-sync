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
 *
 * @feature DRAFT-001: Draft-Backed Wizard Architecture
 * - All wizard data persists in SQLite via useCloseDraft hook
 * - Crash-proof: Resume from where you left off after app restart
 * - Autosave: Data saves automatically as you work (debounced 500ms)
 * - Atomic finalize: Shift close committed via draft.finalize()
 *
 * @security SEC-010: Authentication required for all operations
 * @security DB-006: All draft operations store-scoped via backend
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge as _Badge } from '../components/ui/badge';
import { Clock, Loader2, AlertCircle, Check, ArrowLeft, RotateCcw, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';

import { useLotteryDayBins } from '../hooks/useLottery';
import { useLocalStore } from '../hooks/useLocalStore';
import { useLocalShiftDetail } from '../hooks/useLocalShifts';
import { useLocalTerminals } from '../hooks/useLocalTerminals';
import { useLocalCashiers } from '../hooks/useLocalCashiers';
import { ShiftClosingForm } from '../components/shifts/ShiftClosingForm';
import { useToast } from '../hooks/use-toast';

// DRAFT-001: Draft-backed wizard architecture
import { useCloseDraft, type CrashRecoveryInfo } from '../hooks/useCloseDraft';
import type { StepState } from '../lib/transport';
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
  type MoneyReceivedPOSState,
  type SalesBreakdownState,
  type SalesBreakdownReportsState,
  type SalesBreakdownPOSState,
  type LotteryStatus,
  DEFAULT_MONEY_RECEIVED_STATE,
  DEFAULT_SALES_BREAKDOWN_STATE,
} from '../components/shift-closing';

// Import Step 1 component (shared with Day Close)
import { ReportScanningStep } from '../components/day-close/ReportScanningStep';
import type { ReportScanningState } from '../components/day-close/ReportScanningStep';

// ============ TYPES ============

type ShiftCloseWizardStep = 1 | 2;

/**
 * Map ShiftCloseWizardStep to StepState for draft persistence
 * Note: SHIFT_CLOSE only has REPORTS and REVIEW (no LOTTERY step)
 * @security DRAFT-001: Step state stored in draft for crash recovery
 */
function _wizardStepToStepState(step: ShiftCloseWizardStep): StepState {
  switch (step) {
    case 1:
      return 'REPORTS';
    case 2:
      return 'REVIEW';
    default:
      return 'REPORTS';
  }
}

/**
 * Map StepState to ShiftCloseWizardStep for crash recovery navigation
 */
function stepStateToWizardStep(stepState: StepState | null): ShiftCloseWizardStep {
  switch (stepState) {
    case 'REPORTS':
      return 1;
    case 'REVIEW':
      return 2;
    // LOTTERY step not applicable for SHIFT_CLOSE
    case 'LOTTERY':
      return 1;
    default:
      return 1;
  }
}

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

// ============ CRASH RECOVERY DIALOG ============

/**
 * CrashRecoveryDialog Component
 *
 * Shown when an existing IN_PROGRESS draft is found on page load.
 * Allows user to resume from where they left off or start fresh.
 *
 * @feature DRAFT-001: Crash recovery for wizard state
 * @security SEC-010: Authorization context preserved in draft
 */
interface CrashRecoveryDialogProps {
  open: boolean;
  recoveryInfo: CrashRecoveryInfo | null;
  onResume: () => void;
  onDiscard: () => void;
  isDiscarding: boolean;
}

function CrashRecoveryDialog({
  open,
  recoveryInfo,
  onResume,
  onDiscard,
  isDiscarding,
}: CrashRecoveryDialogProps) {
  if (!recoveryInfo?.hasDraft || !recoveryInfo.draft) {
    return null;
  }

  const lastUpdated = recoveryInfo.lastUpdated
    ? new Date(recoveryInfo.lastUpdated).toLocaleString()
    : 'Unknown';

  const stepName =
    recoveryInfo.stepState === 'REPORTS'
      ? 'Report Scanning (Step 1)'
      : recoveryInfo.stepState === 'REVIEW'
        ? 'Close Shift (Step 2)'
        : 'Step 1';

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-primary" />
            Resume Previous Session?
          </DialogTitle>
          <DialogDescription>
            You have an unfinished shift close session from a previous visit.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Card className="bg-muted/50">
            <CardContent className="pt-4">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Last saved:</dt>
                  <dd className="font-medium">{lastUpdated}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Progress:</dt>
                  <dd className="font-medium">{stepName}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={onDiscard}
            disabled={isDiscarding}
            className="w-full sm:w-auto"
            data-testid="crash-recovery-discard-btn"
          >
            {isDiscarding ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Discarding...
              </>
            ) : (
              <>
                <X className="mr-2 h-4 w-4" />
                Start Fresh
              </>
            )}
          </Button>
          <Button
            onClick={onResume}
            disabled={isDiscarding}
            className="w-full sm:w-auto"
            data-testid="crash-recovery-resume-btn"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Resume Session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ MAIN COMPONENT ============

/**
 * Shift End Wizard Page Component
 *
 * Enterprise-grade 2-step wizard for shift closing workflow.
 *
 * @feature DRAFT-001: Draft-backed wizard with crash recovery
 * @security SEC-010: All draft operations require authentication
 * @security DB-006: All draft operations store-scoped
 */
export default function ShiftEndWizardPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const shiftId = searchParams.get('shiftId');

  // Check if we're in manual mode (passed from TerminalsPage)
  const isManualMode = (location.state as { isManualMode?: boolean } | null)?.isManualMode ?? false;

  // ============ LOCAL IPC HOOKS ============
  // Use local IPC hooks for offline-first operation (no cloud API calls)
  const { data: storeData, isLoading: storeLoading, isError: storeError } = useLocalStore();

  // Get store ID from local configuration
  const storeId = storeData?.store_id;

  // Fetch shift details to check if already closed
  const { data: shiftData, isLoading: shiftLoading } = useLocalShiftDetail(shiftId);
  const isShiftClosed = shiftData?.status === 'CLOSED';

  // Fetch terminals for the store to get terminal name
  const { data: terminals = [], isLoading: isLoadingTerminals } = useLocalTerminals();

  // Find terminal info by ID from shift data (uses external_register_id)
  const terminal = shiftData
    ? terminals.find((t) => t.external_register_id === shiftData.external_register_id)
    : null;

  // Get cashiers to find cashier name (fallback if not in shiftData)
  const { data: cashiers = [], isLoading: isLoadingCashiers } = useLocalCashiers();

  // Find cashier info from shift - prefer shiftData.cashier_name, fallback to lookup
  const cashierName =
    shiftData?.cashier_name ||
    cashiers.find((c) => c.cashier_id === shiftData?.cashier_id)?.name ||
    'Unknown Cashier';

  // Lottery day bins data
  const { data: dayBinsData, isLoading: dayBinsLoading } = useLotteryDayBins(storeId);

  // Check if lottery is already closed for today
  const isLotteryAlreadyClosed = dayBinsData?.business_day?.last_shift_closed_at !== null;

  // ========================================================================
  // DRAFT-001: Draft-backed wizard hook
  // SEC-010: All draft operations require authentication (backend enforced)
  // DB-006: All draft operations store-scoped (backend enforced)
  // ========================================================================
  const {
    draft,
    payload: _draftPayload,
    isLoading: isDraftLoading,
    isSaving: _isDraftSaving,
    isFinalizing,
    isDirty: hasDraftChanges,
    error: _draftError,
    updateStepState,
    finalize: finalizeDraft,
    save: saveDraft,
    discard: discardDraft,
    recoveryInfo,
  } = useCloseDraft(shiftId, 'SHIFT_CLOSE');

  // Crash recovery dialog state
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);
  const [isDiscardingDraft, setIsDiscardingDraft] = useState(false);
  const hasShownRecoveryDialog = useRef(false);

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

  // ============ DRAFT-001: CRASH RECOVERY ============
  // Show recovery dialog when existing draft found on mount
  useEffect(() => {
    if (recoveryInfo?.hasDraft && !hasShownRecoveryDialog.current && !isDraftLoading) {
      hasShownRecoveryDialog.current = true;
      setShowRecoveryDialog(true);
    }
  }, [recoveryInfo, isDraftLoading]);

  /**
   * Handle crash recovery resume
   * Restores wizard state from draft step_state
   */
  const handleRecoveryResume = useCallback(() => {
    if (!recoveryInfo?.draft) return;

    const savedDraft = recoveryInfo.draft;
    const savedStep = stepStateToWizardStep(savedDraft.step_state);

    // Navigate to the saved step
    setWizardState((prev) => ({
      ...prev,
      currentStep: savedStep as ShiftCloseStep,
      reportScanningCompleted: savedStep > 1,
    }));

    setShowRecoveryDialog(false);
    toast({
      title: 'Session Resumed',
      description: 'Your previous shift close session has been restored.',
    });
  }, [recoveryInfo, toast]);

  /**
   * Handle crash recovery discard
   * Expires the draft and starts fresh
   */
  const handleRecoveryDiscard = useCallback(async () => {
    setIsDiscardingDraft(true);
    try {
      await discardDraft();
      setShowRecoveryDialog(false);
      toast({
        title: 'Session Discarded',
        description: 'Starting a fresh shift close session.',
      });
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to discard previous session. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsDiscardingDraft(false);
    }
  }, [discardDraft, toast]);

  // Determine lottery status
  const lotteryStatus = determineLotteryStatus(lotteryCompleted, isLotteryAlreadyClosed);

  // Calculate scratch off total from lottery data
  const scratchOffTotal = lotteryData?.lottery_total ?? 0;

  // ========================================================================
  // DRAFT-001: Closing Cash Dialog State
  // For draft-based finalization, we collect closing_cash then call draft.finalize()
  // ========================================================================
  const [showClosingCashDialog, setShowClosingCashDialog] = useState(false);
  const [closingCashInput, setClosingCashInput] = useState('');
  const closingCashInputRef = useRef<HTMLInputElement>(null);

  /**
   * Parse and validate closing cash input
   * @security SEC-014: Input validation with sanitization
   */
  const parseClosingCash = useCallback((value: string): number => {
    const cleaned = value.replace(/[^0-9.]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) || parsed < 0 ? 0 : parsed;
  }, []);

  // ============ STEP 1 HANDLERS ============
  /**
   * Handle completion of Report Scanning step
   *
   * Transfers lottery report data from Step 1 to Step 2:
   * - Lottery cashes (instant + online) → lotteryPayouts in money received
   * - Lottery sales/cashes → sales breakdown reports columns
   *
   * DRAFT-001: Updates step state for crash recovery
   */
  const handleReportScanningComplete = useCallback(
    (data: ReportScanningState) => {
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

      // Lottery cashes go into sales breakdown reports
      // Each field maps directly from the lottery terminal report
      // NOTE: scratchOff (instantSales) is NOT set here because:
      // - Shift Close has no lottery step (showInstantSales=false)
      // - instantSales is guaranteed to be 0 from ReportScanningStep (SEC-014)
      // - scratchOff remains at default 0 for Shift Close
      setSalesBreakdownState((prev) => ({
        ...prev,
        reports: {
          ...prev.reports,
          // scratchOff intentionally not set - Shift Close has no lottery scanning
          instantCashes: data.lotteryReports?.instantCashes ?? 0,
          onlineLottery: data.lotteryReports?.onlineSales ?? 0,
          onlineCashes: data.lotteryReports?.onlineCashes ?? 0,
        },
      }));

      // DRAFT-001: Update step state for crash recovery
      updateStepState('REVIEW').catch((err) => {
        console.warn('[ShiftEndPage] Failed to update step state:', err);
      });
    },
    [updateStepState]
  );

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

  /**
   * Open the closing cash dialog for draft-based finalization
   * DRAFT-001: Draft.finalize() handles shift close atomically
   */
  const handleOpenClosingCashDialog = useCallback(async () => {
    // Save any pending changes to draft before showing dialog
    try {
      await saveDraft();
    } catch (err) {
      console.warn('[ShiftEndPage] Failed to save draft before finalize:', err);
    }

    setClosingCashInput('');
    setShowClosingCashDialog(true);

    // Focus input after dialog opens
    setTimeout(() => {
      closingCashInputRef.current?.focus();
    }, 100);
  }, [saveDraft]);

  /**
   * Handle draft finalization with closing cash
   * DRAFT-001: Atomically closes shift via draft.finalize()
   * @security SEC-010: Backend validates authorization
   * @security DB-006: Backend validates store ownership
   */
  const handleDraftFinalize = useCallback(async () => {
    const closingCash = parseClosingCash(closingCashInput);

    try {
      const result = await finalizeDraft(closingCash);

      if (result.success) {
        toast({
          title: 'Shift Closed Successfully',
          description: 'Your shift has been closed and recorded.',
        });

        setShowClosingCashDialog(false);
        navigate('/mystore');
      } else {
        throw new Error('Failed to finalize shift close');
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to finalize shift close';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  }, [closingCashInput, parseClosingCash, finalizeDraft, toast, navigate]);

  /**
   * Handle opening shift closing form
   * Uses draft-based finalization when draft is available, falls back to legacy
   */
  const handleOpenShiftClosingForm = useCallback(async () => {
    // DRAFT-001: Use draft-based finalization when draft is available
    if (draft) {
      await handleOpenClosingCashDialog();
      return;
    }

    // Fallback to legacy flow
    setShiftClosingFormOpen(true);
  }, [draft, handleOpenClosingCashDialog]);

  // Handle shift closing success - navigate to mystore dashboard
  const handleShiftClosingSuccess = useCallback(() => {
    setShiftClosingFormOpen(false);
    navigate('/mystore');
  }, [navigate]);

  /**
   * Handle going back to step 1
   * DRAFT-001: Updates step state for crash recovery
   */
  const handleStep2Back = useCallback(() => {
    setWizardState((prev) => ({
      ...prev,
      currentStep: 1,
    }));

    // DRAFT-001: Update step state for crash recovery
    updateStepState('REPORTS').catch((err) => {
      console.warn('[ShiftEndPage] Failed to update step state:', err);
    });
  }, [updateStepState]);

  // ============ REDIRECT IF SHIFT CLOSED ============
  useEffect(() => {
    if (isShiftClosed) {
      navigate('/mystore', { replace: true });
    }
  }, [isShiftClosed, navigate]);

  // ============ CLEANUP ON PAGE UNLOAD ============
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // DRAFT-001: Check if draft has unsaved changes
      if (hasDraftChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasDraftChanges]);

  // ============ LOADING STATE ============
  // DRAFT-001: Also wait for draft to load before rendering
  if (storeLoading || shiftLoading || isLoadingTerminals || isLoadingCashiers || isDraftLoading) {
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
  if (storeError) {
    return (
      <div className="container mx-auto p-6" data-testid="shift-end-wizard-error">
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p>Failed to load store data. Please try again.</p>
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
  const storeName = storeData?.name || 'Your Store';
  const businessDate = lotteryData?.business_date || dayBinsData?.business_day?.date;
  const formattedDate = formatBusinessDate(businessDate);

  // Terminal and shift display values
  const terminalName = terminal?.name || 'Terminal';
  const shiftNumber = shiftData?.shift_number ?? null;
  const shiftStartTime = shiftData?.start_time ?? new Date().toISOString();
  const openingCash = 0; // Local ShiftResponse doesn't include opening_cash

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
              showInstantSales={false}
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

      {/* Shift Closing Form Modal (Legacy Mode) */}
      {shiftId && (
        <ShiftClosingForm
          shiftId={shiftId}
          storeId={storeId}
          open={shiftClosingFormOpen}
          onOpenChange={setShiftClosingFormOpen}
          onSuccess={handleShiftClosingSuccess}
        />
      )}

      {/* DRAFT-001: Closing Cash Dialog for Draft-Based Finalization */}
      <Dialog open={showClosingCashDialog} onOpenChange={setShowClosingCashDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-green-600" />
              Complete Shift Close
            </DialogTitle>
            <DialogDescription>
              Enter the closing cash amount to finalize the shift close.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <label htmlFor="closing-cash-input" className="block text-sm font-medium mb-2">
              Closing Cash Amount
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                $
              </span>
              <Input
                ref={closingCashInputRef}
                id="closing-cash-input"
                type="text"
                inputMode="decimal"
                value={closingCashInput}
                onChange={(e) => setClosingCashInput(e.target.value)}
                placeholder="0.00"
                className="pl-8 font-mono text-lg"
                data-testid="closing-cash-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isFinalizing) {
                    handleDraftFinalize();
                  }
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Count all cash in the drawer and enter the total amount.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowClosingCashDialog(false)}
              disabled={isFinalizing}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDraftFinalize}
              disabled={isFinalizing}
              className="bg-green-600 hover:bg-green-700 text-white"
              data-testid="finalize-shift-close-btn"
            >
              {isFinalizing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Finalizing...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Finalize Shift Close
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DRAFT-001: Crash Recovery Dialog */}
      <CrashRecoveryDialog
        open={showRecoveryDialog}
        recoveryInfo={recoveryInfo}
        onResume={handleRecoveryResume}
        onDiscard={handleRecoveryDiscard}
        isDiscarding={isDiscardingDraft}
      />
    </div>
  );
}
