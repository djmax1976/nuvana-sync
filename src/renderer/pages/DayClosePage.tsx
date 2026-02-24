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
 *
 * @feature DRAFT-001: Draft-Backed Wizard Architecture
 * - All wizard data persists in SQLite via useCloseDraft hook
 * - Crash-proof: Resume from where you left off after app restart
 * - Autosave: Data saves automatically as you work (debounced 500ms)
 * - Atomic finalize: Lottery close + shift close committed together
 *
 * @security SEC-010: Authentication required for all operations
 * @security DB-006: All draft operations store-scoped via backend
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { formatDateTime } from '../utils/date-format.utils';
import { useStoreTimezone } from '../contexts/StoreContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { CalendarCheck, Loader2, AlertCircle, Check, ArrowLeft, RotateCcw, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';

// Day Close Access Context - provides validated shift/user from guard
// SEC-010: Authorization already enforced by DayCloseAccessGuard before rendering
import { useDayCloseAccessContext } from '../contexts/DayCloseAccessContext';

// Local IPC hooks - query local SQLite directly, no cloud API dependency
import { useLocalStore } from '../hooks/useLocalStore';
import { useLotteryDayBins } from '../hooks/useLottery';
import { useIsLotteryMode } from '../hooks/usePOSConnectionType';
import { ShiftClosingForm } from '../components/shifts/ShiftClosingForm';
import { cancelLotteryDayClose } from '../lib/api/lottery';
import { useToast } from '../hooks/use-toast';

// DRAFT-001: Draft-backed wizard architecture
import { useCloseDraft, type CrashRecoveryInfo } from '../hooks/useCloseDraft';
import type { LotteryPayload, BinScanData, StepState } from '../lib/transport';
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

/**
 * Map WizardStep to StepState for draft persistence
 * @security DRAFT-001: Step state stored in draft for crash recovery
 */
function _wizardStepToStepState(step: WizardStep): StepState {
  switch (step) {
    case 1:
      return 'LOTTERY';
    case 2:
      return 'REPORTS';
    case 3:
      return 'REVIEW';
    default:
      return 'LOTTERY';
  }
}

/**
 * Map StepState to WizardStep for crash recovery navigation
 */
function stepStateToWizardStep(stepState: StepState | null): WizardStep {
  switch (stepState) {
    case 'LOTTERY':
      return 1;
    case 'REPORTS':
      return 2;
    case 'REVIEW':
      return 3;
    default:
      return 1;
  }
}

interface WizardState {
  currentStep: WizardStep;
  // Step 1: Lottery data
  lotteryCompleted: boolean;
  lotteryData: LotteryCloseResult | null;
  scannedBins: ScannedBin[];
  // Step 2: Report scanning data
  reportScanningData: ReportScanningState | null;
  // Step 3 uses shared state from shift-closing components
  // Legacy two-phase commit tracking (kept for non-draft fallback)
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
    recoveryInfo.stepState === 'LOTTERY'
      ? 'Lottery Close (Step 1)'
      : recoveryInfo.stepState === 'REPORTS'
        ? 'Report Scanning (Step 2)'
        : recoveryInfo.stepState === 'REVIEW'
          ? 'Day Close (Step 3)'
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
            You have an unfinished day close session from a previous visit.
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
                {recoveryInfo.draft.payload.lottery && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Bins scanned:</dt>
                    <dd className="font-medium">
                      {recoveryInfo.draft.payload.lottery.bins_scans.length} bin(s)
                    </dd>
                  </div>
                )}
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

export default function DayCloseWizardPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  // SEC-010: Get validated shift/user from context (set by DayCloseAccessGuard)
  // Guard has already verified: exactly one open shift exists, user is authorized
  const { activeShift, user: _user, accessType } = useDayCloseAccessContext();
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
  const _isLotteryMode = useIsLotteryMode();

  // ========================================================================
  // DRAFT-001: Draft-backed wizard hook
  // SEC-010: All draft operations require authentication (backend enforced)
  // DB-006: All draft operations store-scoped (backend enforced)
  // ========================================================================
  const {
    draft,
    payload: draftPayload,
    isLoading: isDraftLoading,
    isSaving: _isDraftSaving,
    isFinalizing,
    isDirty: hasDraftChanges,
    error: draftError,
    updateLottery,
    updateStepState,
    finalize: finalizeDraft,
    save: saveDraft,
    discard: discardDraft,
    recoveryInfo,
  } = useCloseDraft(shiftId, 'DAY_CLOSE');

  // DEBUG: Log draft state changes
  useEffect(() => {
    console.debug('[DayClosePage] Draft state:', {
      shiftId,
      hasDraft: !!draft,
      draftId: draft?.draft_id,
      isDraftLoading,
      draftError: draftError?.message,
      payloadKeys: Object.keys(draftPayload),
      hasLottery: !!draftPayload.lottery,
    });
  }, [shiftId, draft, isDraftLoading, draftError, draftPayload]);

  // Crash recovery dialog state
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);
  const [isDiscardingDraft, setIsDiscardingDraft] = useState(false);
  const hasShownRecoveryDialog = useRef(false);

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
    pendingLotteryCloseExpiresAt: _pendingLotteryCloseExpiresAt,
    pendingClosings,
  } = wizardState;

  // ============ DRAFT-001: CRASH RECOVERY ============
  // Show recovery dialog when existing draft found on mount
  useEffect(() => {
    if (
      recoveryInfo?.hasDraft &&
      !hasShownRecoveryDialog.current &&
      !isDraftLoading &&
      !isLotteryAlreadyClosed
    ) {
      hasShownRecoveryDialog.current = true;
      setShowRecoveryDialog(true);
    }
  }, [recoveryInfo, isDraftLoading, isLotteryAlreadyClosed]);

  /**
   * Handle crash recovery resume
   * Restores wizard state from draft payload
   */
  const handleRecoveryResume = useCallback(() => {
    if (!recoveryInfo?.draft) return;

    const savedDraft = recoveryInfo.draft;
    const savedStep = stepStateToWizardStep(savedDraft.step_state);

    // Restore lottery data from draft payload
    if (savedDraft.payload.lottery) {
      const lotteryPayload = savedDraft.payload.lottery;

      // Calculate lottery total from bins_scans
      const lotteryTotal = lotteryPayload.totals.sales_amount;

      // Convert bins_scans back to scannedBins format
      const restoredScannedBins: ScannedBin[] = lotteryPayload.bins_scans.map((scan) => ({
        bin_id: scan.bin_id,
        bin_number: 0, // Will be resolved from dayBinsData
        pack_id: scan.pack_id,
        pack_number: '', // Will be resolved from dayBinsData
        game_name: '', // Will be resolved from dayBinsData
        closing_serial: scan.closing_serial,
        is_sold_out: scan.is_sold_out,
      }));

      // Resolve bin details from current dayBinsData
      if (dayBinsData?.bins) {
        restoredScannedBins.forEach((scanned) => {
          const bin = dayBinsData.bins.find((b) => b.bin_id === scanned.bin_id);
          if (bin) {
            scanned.bin_number = bin.bin_number;
            if (bin.pack) {
              scanned.pack_number = bin.pack.pack_number;
              scanned.game_name = bin.pack.game_name;
            }
          }
        });
      }

      setWizardState((prev) => ({
        ...prev,
        currentStep: savedStep,
        lotteryCompleted: savedStep > 1,
        lotteryData: {
          closings_created: lotteryPayload.bins_scans.length,
          business_date: savedDraft.business_date,
          lottery_total: lotteryTotal,
          bins_closed: [], // Will be populated if needed
        },
        scannedBins: restoredScannedBins,
      }));

      // Update sales breakdown with lottery total
      setSalesBreakdownState((prev) => ({
        ...prev,
        reports: {
          ...prev.reports,
          scratchOff: lotteryTotal,
        },
      }));
    } else {
      // No lottery data - just navigate to saved step
      setWizardState((prev) => ({
        ...prev,
        currentStep: savedStep,
      }));
    }

    setShowRecoveryDialog(false);
    toast({
      title: 'Session Resumed',
      description: 'Your previous day close session has been restored.',
    });
  }, [recoveryInfo, dayBinsData, toast]);

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
        description: 'Starting a fresh day close session.',
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

  /**
   * Convert scanned bins to LotteryPayload for draft storage
   * @security SEC-006: Data sanitized before storage
   */
  const _convertScannedBinsToLotteryPayload = useCallback(
    (
      bins: ScannedBin[],
      lotteryResult: LotteryCloseResult,
      entryMethod: 'SCAN' | 'MANUAL',
      authorizedBy?: string
    ): LotteryPayload => {
      const binScans: BinScanData[] = bins.map((bin) => ({
        pack_id: bin.pack_id,
        bin_id: bin.bin_id,
        closing_serial: bin.closing_serial,
        is_sold_out: bin.is_sold_out ?? false,
        scanned_at: new Date().toISOString(),
      }));

      return {
        bins_scans: binScans,
        totals: {
          tickets_sold: lotteryResult.bins_closed.reduce((sum, b) => sum + b.tickets_sold, 0),
          sales_amount: lotteryResult.lottery_total,
        },
        entry_method: entryMethod,
        authorized_by: authorizedBy,
      };
    },
    []
  );

  /**
   * Handle successful lottery close from Step 1
   * DRAFT-001: Saves lottery data to draft for persistence
   *
   * In deferred mode (non-LOTTERY POS types), handlePendingClosings already
   * saved the bin data with correct bin_id enrichment. We only need to update
   * the totals here to avoid overwriting with stale data.
   */
  const handleLotterySuccess = useCallback(
    (data: LotteryCloseResult) => {
      // Update wizard state
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

      // DRAFT-001: Lottery data is saved by handlePendingClosings (called before onSuccess)
      // Now that deferCommit=true for ALL modes, handlePendingClosings handles saving
      // We only update wizard state here, not draft data
      console.debug(
        '[DayClosePage] handleLotterySuccess: lottery data already saved by handlePendingClosings'
      );

      // Update step state in draft for crash recovery (only if draft exists)
      if (draft) {
        updateStepState('REPORTS').catch((err) => {
          console.warn('[DayClosePage] Failed to update step state:', err);
        });
      }
    },
    [draft, updateStepState]
  );

  /**
   * Handle scanned bins change from DayCloseModeScanner
   * Updates local state (bins are saved to draft on lottery success)
   */
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
   * DRAFT-001: Also saves to draft for persistence
   */
  const handlePendingClosings = useCallback(
    (data: PendingClosingsData) => {
      setWizardState((prev) => ({
        ...prev,
        pendingClosings: data,
      }));

      // DRAFT-001: Save pending closings lottery data to draft
      // bin_id is now included directly in closings data (no lookup needed)
      const binScans: BinScanData[] = data.closings.map((closing) => ({
        pack_id: closing.pack_id,
        bin_id: closing.bin_id || '', // Use bin_id directly from closing data
        closing_serial: closing.closing_serial,
        is_sold_out: closing.is_sold_out ?? false,
        scanned_at: new Date().toISOString(),
      }));

      // Defensive logging: Warn if bin_id was not provided (should not happen after fix)
      const missingBinIds = binScans.filter((s) => !s.bin_id);
      if (missingBinIds.length > 0) {
        console.warn('[DayClosePage] handlePendingClosings: bin_id missing from closings', {
          totalScans: binScans.length,
          missingCount: missingBinIds.length,
          missingPackIds: missingBinIds.map((s) => s.pack_id),
        });
      }

      // Use totals from data if provided, otherwise default to 0
      const lotteryPayload: LotteryPayload = {
        bins_scans: binScans,
        totals: data.totals ?? {
          tickets_sold: 0,
          sales_amount: 0,
        },
        entry_method: data.entry_method,
        authorized_by: data.authorized_by_user_id,
      };

      updateLottery(lotteryPayload);
      console.debug('[DayClosePage] handlePendingClosings: saved lottery data', {
        binsCount: binScans.length,
        withBinIds: binScans.length - missingBinIds.length,
        totals: lotteryPayload.totals,
      });
    },
    [updateLottery]
  );

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

  /**
   * Handle report scanning complete
   * DRAFT-001: Updates step state for crash recovery
   */
  const handleReportScanningComplete = useCallback(
    (data: ReportScanningState) => {
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

      // DRAFT-001: Update step state for crash recovery (only if draft exists)
      if (draft) {
        updateStepState('REVIEW').catch((err) => {
          console.warn('[DayClosePage] Failed to update step state:', err);
        });
      }
    },
    [draft, updateStepState]
  );

  /**
   * Restore scannedBins from draft payload
   * Used when navigating back to Step 1 or during crash recovery
   * @returns Restored scannedBins array or empty array if no lottery data
   */
  const restoreScannedBinsFromDraft = useCallback((): ScannedBin[] => {
    const lotteryPayload = draftPayload.lottery;
    if (!lotteryPayload?.bins_scans?.length) {
      return [];
    }

    // Convert bins_scans back to scannedBins format
    const restoredBins: ScannedBin[] = lotteryPayload.bins_scans.map((scan) => ({
      bin_id: scan.bin_id,
      bin_number: 0, // Will be resolved from dayBinsData
      pack_id: scan.pack_id,
      pack_number: '', // Will be resolved from dayBinsData
      game_name: '', // Will be resolved from dayBinsData
      closing_serial: scan.closing_serial,
      is_sold_out: scan.is_sold_out,
    }));

    // Resolve bin details from current dayBinsData
    if (dayBinsData?.bins) {
      restoredBins.forEach((scanned) => {
        const bin = dayBinsData.bins.find((b) => b.bin_id === scanned.bin_id);
        if (bin) {
          scanned.bin_number = bin.bin_number;
          if (bin.pack) {
            scanned.pack_number = bin.pack.pack_number;
            scanned.game_name = bin.pack.game_name;
          }
        }
      });
    }

    return restoredBins;
  }, [draftPayload.lottery, dayBinsData]);

  /**
   * Compute initial manual ending values from draft payload
   * DRAFT-001: Used to restore manual entry values when navigating back to Step 1
   * This is separate from scannedBins - manual entries are stored by bin_id
   */
  const initialManualEndingValues = useMemo((): Record<string, string> => {
    const lotteryPayload = draftPayload.lottery;
    if (!lotteryPayload?.bins_scans?.length) {
      return {};
    }

    const values: Record<string, string> = {};
    lotteryPayload.bins_scans.forEach((scan) => {
      if (scan.bin_id && scan.closing_serial) {
        values[scan.bin_id] = scan.closing_serial;
      }
    });

    console.debug('[DayClosePage] initialManualEndingValues computed', {
      binCount: Object.keys(values).length,
      values,
      hasDraftLottery: !!lotteryPayload,
      binsScansCount: lotteryPayload?.bins_scans?.length ?? 0,
    });

    return values;
  }, [draftPayload.lottery]);

  /**
   * Handle back navigation from Step 2
   * DRAFT-001: Restores scannedBins from draft and updates step state
   */
  const handleReportScanningBack = useCallback(() => {
    if (!isLotteryAlreadyClosed) {
      // Restore scannedBins from draft before showing Step 1
      const restoredBins = restoreScannedBinsFromDraft();

      setWizardState((prev) => ({
        ...prev,
        currentStep: 1,
        scannedBins: restoredBins,
      }));

      // DRAFT-001: Update step state for crash recovery (only if draft exists)
      if (draft) {
        updateStepState('LOTTERY').catch((err) => {
          console.warn('[DayClosePage] Failed to update step state:', err);
        });
      }
    }
  }, [isLotteryAlreadyClosed, restoreScannedBinsFromDraft, draft, updateStepState]);

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

  /**
   * Open the closing cash dialog for draft-based finalization
   * DRAFT-001: Draft.finalize() handles lottery + shift close atomically
   */
  const handleOpenClosingCashDialog = useCallback(async () => {
    // Save any pending changes to draft before showing dialog
    try {
      await saveDraft();
    } catch (err) {
      console.warn('[DayClosePage] Failed to save draft before finalize:', err);
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
   * DRAFT-001: Atomically closes lottery day and shift via draft.finalize()
   * @security SEC-010: Backend validates authorization
   * @security DB-006: Backend validates store ownership
   */
  const handleDraftFinalize = useCallback(async () => {
    const closingCash = parseClosingCash(closingCashInput);

    setIsCommittingLottery(true);
    try {
      const result = await finalizeDraft(closingCash);

      if (result.success) {
        toast({
          title: 'Day Closed Successfully',
          description: `Lottery and shift closed. ${result.lottery_result?.closings_created ?? 0} pack(s) recorded.`,
        });

        setShowClosingCashDialog(false);
        navigate('/mystore');
      } else {
        throw new Error('Failed to finalize day close');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to finalize day close';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsCommittingLottery(false);
    }
  }, [closingCashInput, parseClosingCash, finalizeDraft, toast, navigate]);

  /**
   * Legacy handler for non-draft mode (backward compatibility)
   * Opens ShiftClosingForm after committing lottery separately
   */
  const _handleOpenShiftClosingFormLegacy = useCallback(async () => {
    // ========================================================================
    // Case 1: LOTTERY POS type - immediate commit (pendingLotteryDayId exists)
    // The scanner already called prepareDayClose, we just need to commit
    // ========================================================================
    if (pendingLotteryDayId && storeId) {
      setIsCommittingLottery(true);
      try {
        // Import needed for legacy mode
        const { commitLotteryDayClose } = await import('../lib/api/lottery');
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
        const { prepareLotteryDayClose, commitLotteryDayClose } =
          await import('../lib/api/lottery');

        const prepareResult = await prepareLotteryDayClose({
          closings: pendingClosings.closings,
          fromWizard: true,
        });

        if (!prepareResult.success || !prepareResult.data) {
          throw new Error(prepareResult.message || 'Failed to prepare lottery close');
        }

        const dayId = prepareResult.data.day_id;

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

  /**
   * DRAFT-001: Always use draft-based finalization.
   * Legacy flow has been removed - draft is the only path.
   */
  const handleOpenShiftClosingForm = useCallback(async () => {
    console.debug('[DayClosePage] handleOpenShiftClosingForm', {
      hasDraft: !!draft,
      draftId: draft?.draft_id,
      hasLotteryPayload: !!draftPayload.lottery,
      binsCount: draftPayload.lottery?.bins_scans?.length ?? 0,
    });

    // Draft must exist
    if (!draft) {
      console.error('[DayClosePage] Draft not loaded');
      toast({
        title: 'Unable to Close',
        description: 'Draft not ready. Please wait a moment and try again.',
        variant: 'destructive',
      });
      return;
    }

    // Lottery data must exist in draft
    if (!draftPayload.lottery || !draftPayload.lottery.bins_scans?.length) {
      console.error('[DayClosePage] Lottery data missing from draft', {
        hasLotteryPayload: !!draftPayload.lottery,
        binsCount: draftPayload.lottery?.bins_scans?.length ?? 0,
      });
      toast({
        title: 'Unable to Close',
        description:
          'Lottery data not found. Please go back to Step 1 and complete the lottery scan.',
        variant: 'destructive',
      });
      return;
    }

    // All good - show cash dialog (finalization happens when user confirms)
    await handleOpenClosingCashDialog();
  }, [draft, draftPayload.lottery, handleOpenClosingCashDialog, toast]);

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
      // DRAFT-001: Check if draft has unsaved changes
      if (hasDraftChanges || pendingLotteryDayId) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasDraftChanges, pendingLotteryDayId]);

  // ============ LOADING STATE ============
  // Local IPC hooks - no cloud auth/dashboard loading
  // Note: Shift/terminal/cashier data comes from context (DayCloseAccessGuard)
  // DRAFT-001: Also wait for draft to load before rendering
  if (storeLoading || dayBinsLoading || isDraftLoading) {
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
              deferCommit={true}
              onPendingClosings={handlePendingClosings}
              initialManualEndingValues={initialManualEndingValues}
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
              instantSalesFromDraft={draftPayload.lottery?.totals.sales_amount}
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

            {/* Shift Closing Form Modal (Legacy Mode) */}
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

            {/* DRAFT-001: Closing Cash Dialog for Draft-Based Finalization */}
            <Dialog open={showClosingCashDialog} onOpenChange={setShowClosingCashDialog}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <CalendarCheck className="h-5 w-5 text-green-600" />
                    Complete Day Close
                  </DialogTitle>
                  <DialogDescription>
                    Enter the closing cash amount to finalize the day close. This will close both
                    the lottery day and the shift atomically.
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
                    data-testid="finalize-day-close-btn"
                  >
                    {isFinalizing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Finalizing...
                      </>
                    ) : (
                      <>
                        <Check className="mr-2 h-4 w-4" />
                        Finalize Day Close
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </main>

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
