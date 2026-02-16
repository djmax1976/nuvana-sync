import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useClientAuth } from '@/contexts/ClientAuthContext';
import { useClientDashboard } from '@/lib/api/client-dashboard';
import { Loader2, AlertCircle, Zap, PenLine, X, Save, CalendarCheck, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useLotteryPacks,
  usePackDetails,
  useInvalidateLottery,
  useLotteryDayBins,
  useDayStatus,
  useInitializeBusinessDay,
} from '@/hooks/useLottery';
import { DayBinsTable, type BinValidationError } from '@/components/lottery/DayBinsTable';
import { validateManualEntryEnding } from '@/lib/services/lottery-closing-validation';
import { DepletedPacksSection } from '@/components/lottery/DepletedPacksSection';
import { ReturnedPacksSection } from '@/components/lottery/ReturnedPacksSection';
import { ActivatedPacksSection } from '@/components/lottery/ActivatedPacksSection';
import { EnhancedPackActivationForm } from '@/components/lottery/EnhancedPackActivationForm';
import { PackDetailsModal, type PackDetailsData } from '@/components/lottery/PackDetailsModal';
import { MarkSoldOutDialog } from '@/components/lottery/MarkSoldOutDialog';
import { ManualEntryIndicator } from '@/components/lottery/ManualEntryIndicator';
import { OnboardingModeIndicator } from '@/components/lottery/OnboardingModeIndicator';
import { ReturnPackDialog } from '@/components/lottery/ReturnPackDialog';
import { DayCloseScannerBar } from '@/components/lottery/DayCloseScannerBar';
import { PinVerificationDialog, type VerifiedUser } from '@/components/auth/PinVerificationDialog';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { useScannedBins, type ScannedBin, type ScanError } from '@/hooks/useScannedBins';
import { useNotificationSound } from '@/hooks/use-notification-sound';
import { closeLotteryDay, type LotteryPackResponse } from '@/lib/api/lottery';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { CheckCircle2, AlertTriangle } from 'lucide-react';

/**
 * Manual entry state interface
 * Tracks manual entry mode activation and authorization
 *
 * MCP Guidance Applied:
 * - FE-001: STATE_MANAGEMENT - Sensitive authorization state managed in memory
 * - SEC-010: AUTHZ - Authorization tracked with user ID for audit
 */
interface ManualEntryState {
  isActive: boolean;
  authorizedBy: {
    userId: string;
    name: string;
  } | null;
  authorizedAt: Date | null;
}

/**
 * Lottery Management Page - Day-based Bin View
 * Displays lottery bins with day-based tracking for the current business day.
 * Route: /mystore/lottery
 *
 * Story: MyStore Lottery Page Redesign
 * Story: Lottery Manual Entry Feature
 *
 * @requirements
 * - Display bins table with columns (Bin, Name, Amount, Pack #, Starting, Ending)
 * - Starting = first opening of the day OR last closing OR serial_start
 * - Ending = last closing of the day (grayed out, read-only by default)
 * - Click row to open pack details modal
 * - Collapsible depleted packs section
 * - Activate Pack button (Receive Pack moved to Inventory page)
 * - Manual Entry button: Opens auth modal, then enables inline ending serial inputs
 * - Close Day: When in manual entry mode, saves data from table inputs
 * - AC #8: All API calls use proper authentication (JWT tokens), RLS policies ensure store access only
 *
 * MCP Guidance Applied:
 * - FE-002: FORM_VALIDATION - Strict validation for 3-digit serial numbers
 * - SEC-014: INPUT_VALIDATION - Length, type, and format constraints on inputs
 * - SEC-010: AUTHZ - Permission-based access control for manual entry
 * - FE-001: STATE_MANAGEMENT - Secure state management for auth data
 */
export default function LotteryManagementPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useClientAuth();
  const {
    data: dashboardData,
    isLoading: dashboardLoading,
    isError: dashboardError,
    error: dashboardErrorObj,
  } = useClientDashboard();
  const { toast } = useToast();

  // FE-001: Auth guard for session-first validation (check before showing dialog)
  const { executeWithAuth } = useAuthGuard('cashier');
  // SEC-010: Auth guard for shift_manager role (required for pack returns)
  const { executeWithAuth: executeWithShiftManagerAuth } = useAuthGuard('shift_manager');

  // Dialog state management
  const [activationDialogOpen, setActivationDialogOpen] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // Mark Sold Out dialog state
  const [markSoldOutDialogOpen, setMarkSoldOutDialogOpen] = useState(false);
  const [packIdToMarkSoldOut, setPackIdToMarkSoldOut] = useState<string | null>(null);

  /**
   * Pack Activation PIN verification state
   * SEC-010: AUTHZ - PIN verification only if session invalid
   */
  const [activationPinDialogOpen, setActivationPinDialogOpen] = useState(false);

  /**
   * Business Day Initialization PIN verification state
   * SEC-010: AUTHZ - PIN verification only if session invalid
   */
  const [initializationPinDialogOpen, setInitializationPinDialogOpen] = useState(false);

  /**
   * Return Pack dialog state
   * MCP: FE-001 STATE_MANAGEMENT - Controlled dialog state with pack ID and data tracking
   * MCP: SEC-010 AUTHZ - Requires shift_manager role, enforced server-side
   */
  const [returnPackDialogOpen, setReturnPackDialogOpen] = useState(false);
  const [packIdToReturn, setPackIdToReturn] = useState<string | null>(null);
  const [packDataToReturn, setPackDataToReturn] = useState<LotteryPackResponse | null>(null);

  /**
   * Return Pack PIN verification state
   * SEC-010: AUTHZ - PIN verification only if session invalid
   * SEC-017: AUDIT_TRAILS - Shift manager required for pack returns
   */
  const [returnPackPinDialogOpen, setReturnPackPinDialogOpen] = useState(false);

  /**
   * Manual Entry PIN verification state
   * SEC-010: AUTHZ - PIN verification only if session invalid
   * SEC-017: AUDIT_TRAILS - Records user who authorized manual entry
   */
  const [manualEntryPinDialogOpen, setManualEntryPinDialogOpen] = useState(false);
  const [manualEntryState, setManualEntryState] = useState<ManualEntryState>({
    isActive: false,
    authorizedBy: null,
    authorizedAt: null,
  });

  // Manual entry values - keyed by bin_id
  const [manualEndingValues, setManualEndingValues] = useState<Record<string, string>>({});

  // Validation errors for manual entry - keyed by bin_id
  const [validationErrors, setValidationErrors] = useState<Record<string, BinValidationError>>({});

  // Submission state for manual entry close day
  const [isSubmittingManualClose, setIsSubmittingManualClose] = useState(false);

  // ============================================================================
  // Onboarding Mode State (BIZ-010)
  // Story: Lottery Onboarding Feature
  // MCP: FE-001 STATE_MANAGEMENT - Track first-ever day onboarding mode
  // ============================================================================

  /**
   * Onboarding mode state
   * When active (first-ever lottery day), scanned packs use serial_start from
   * barcode instead of defaulting to '000'. This allows new stores to accurately
   * track partially-sold packs during initial setup.
   *
   * BIZ-010: Auto-activates when is_first_ever === true after initialization
   */
  const [isOnboardingMode, setIsOnboardingMode] = useState(false);

  // ============================================================================
  // Scanner Mode State (Phase 4)
  // Story: Lottery Day Close Scanner Feature
  // MCP: FE-001 STATE_MANAGEMENT - Secure state management for scanner mode
  // ============================================================================

  /**
   * Scanner mode state
   * When active, shows the DayCloseScannerBar and enables scan-to-bin functionality
   */
  const [isScannerModeActive, setIsScannerModeActive] = useState(false);

  /**
   * Scanner mode PIN verification state
   * SEC-010: AUTHZ - PIN verification only if session invalid
   */
  const [scannerModePinDialogOpen, setScannerModePinDialogOpen] = useState(false);

  /**
   * Scanner mode cancel confirmation dialog state
   * Phase 5.5: Prevent accidental data loss when canceling with existing scans
   * MCP: FE-001 STATE_MANAGEMENT - Track confirmation dialog visibility
   */
  const [scannerCancelDialogOpen, setScannerCancelDialogOpen] = useState(false);

  /**
   * Duplicate scan replacement dialog state
   * Phase 5.2: Handle duplicate scans with re-scan option
   * MCP: FE-001 STATE_MANAGEMENT - Track pending replacement data
   */
  const [duplicateScanDialogOpen, setDuplicateScanDialogOpen] = useState(false);
  const [pendingDuplicateScan, setPendingDuplicateScan] = useState<{
    binId: string;
    binNumber: number;
    existingSerial: string;
    newSerial: string;
  } | null>(null);

  /**
   * Notification sound hook for scan feedback
   * WCAG compliant - sounds supplement visual feedback, never replace it
   */
  const { playSuccess, playError, isMuted, toggleMute } = useNotificationSound();

  // Get first active store ID from user's accessible stores
  const storeId =
    dashboardData?.stores.find((s) => s.status === 'ACTIVE')?.store_id ||
    dashboardData?.stores[0]?.store_id;

  // Check day status FIRST - determines if initialization is needed
  const {
    data: dayStatus,
    isLoading: dayStatusLoading,
    isError: dayStatusError,
  } = useDayStatus({ enabled: !!storeId });

  // Mutation for initializing business day
  const initializeBusinessDayMutation = useInitializeBusinessDay();

  // Ref to prevent duplicate auto-initialization calls
  const autoInitTriggeredRef = useRef(false);

  /**
   * Auto-initialization effect for subsequent days (after day close)
   *
   * Enterprise workflow:
   * - First ever day: Show initialization screen (user must click button)
   * - Subsequent days: Auto-create when navigating to lottery page
   *
   * This effect triggers when:
   * 1. No OPEN day exists (needs_initialization: true)
   * 2. Previous days exist (is_first_ever: false)
   * 3. Prerequisites are met (bins and games configured)
   * 4. User is authenticated
   * 5. Not already in progress
   *
   * @security SEC-010: Requires authenticated user (checked via isAuthenticated)
   * @security SEC-017: Audit trail maintained by initializeBusinessDay mutation
   */
  useEffect(() => {
    // Guard: Only proceed if we have day status data
    if (!dayStatus) return;

    // Guard: Only auto-initialize when:
    // - Initialization is needed (no OPEN day)
    // - This is NOT the first-ever day (has history)
    // - Prerequisites are met
    // - User is authenticated
    // - Not already triggered or in progress
    const shouldAutoInit =
      dayStatus.needs_initialization &&
      dayStatus.is_first_ever === false &&
      dayStatus.prerequisites.has_bins &&
      dayStatus.prerequisites.has_games &&
      isAuthenticated &&
      !autoInitTriggeredRef.current &&
      !initializeBusinessDayMutation.isPending;

    if (shouldAutoInit) {
      // Mark as triggered to prevent duplicate calls
      autoInitTriggeredRef.current = true;

      // Auto-initialize the business day
      initializeBusinessDayMutation.mutate(undefined, {
        onSuccess: (response) => {
          if (response.success && response.data) {
            toast({
              title: 'Business Day Started',
              description: `Business day for ${response.data.day.business_date} has been initialized automatically.`,
            });
          }
        },
        onError: (error) => {
          // Reset the ref so user can retry manually
          autoInitTriggeredRef.current = false;
          toast({
            title: 'Auto-initialization Failed',
            description:
              error instanceof Error ? error.message : 'Failed to initialize business day.',
            variant: 'destructive',
          });
        },
      });
    }
  }, [dayStatus, isAuthenticated, initializeBusinessDayMutation, toast]);

  // Reset auto-init ref when day status changes to has_open_day
  // This ensures the ref is fresh for the next day cycle
  useEffect(() => {
    if (dayStatus?.has_open_day) {
      autoInitTriggeredRef.current = false;
    }
  }, [dayStatus?.has_open_day]);

  // Only fetch day bins if a day exists (not needs_initialization)
  const shouldFetchDayBins = !!storeId && dayStatus?.has_open_day === true;

  // Fetch day bins data for the new table view
  const {
    data: dayBinsData,
    isLoading: dayBinsLoading,
    isError: dayBinsError,
    error: dayBinsErrorObj,
  } = useLotteryDayBins(storeId, undefined, { enabled: shouldFetchDayBins });

  // Fetch lottery packs for checking if there are RECEIVED packs (for button state)
  const { data: packs } = useLotteryPacks(storeId, { status: 'RECEIVED' });

  // Fetch pack details when selected
  const { data: packDetails, isLoading: packDetailsLoading } = usePackDetails(selectedPackId, {
    enabled: !!selectedPackId && detailsDialogOpen,
  });

  // Mutations
  const { invalidateAll } = useInvalidateLottery();

  // Check if there are received packs for the Activate Pack button state
  const hasReceivedPacks = useMemo(() => {
    return (packs?.length ?? 0) > 0;
  }, [packs]);

  // ============================================================================
  // Scanner Mode Hook & Handlers (Phase 4)
  // Story: Lottery Day Close Scanner Feature
  // ============================================================================

  /**
   * Scanned bins hook - manages scanner state, validation, and scrolling
   * MCP: FE-001 STATE_MANAGEMENT - Centralized scanner state management
   * MCP: SEC-014 INPUT_VALIDATION - Serial validation in addFromSerial
   */
  const {
    scannedBins,
    addFromSerial,
    removeScannedBin,
    clearScannedBins,
    lastScannedBinId,
    progress: _scanProgress,
    allBinsScanned,
    replaceScannedBin,
  } = useScannedBins({
    bins: dayBinsData?.bins ?? [],
    onScanSuccess: useCallback(
      (scannedBin: ScannedBin) => {
        playSuccess();
        toast({
          title: 'Bin Scanned',
          description: `Bin ${scannedBin.bin_number} - ${scannedBin.game_name} (${scannedBin.closing_serial})`,
          duration: 2000,
        });
      },
      [playSuccess, toast]
    ),
    onScanError: useCallback(
      (error: ScanError) => {
        // Phase 5.2: Handle duplicate scans with option to replace
        if (
          error.type === 'DUPLICATE_SCAN' &&
          error.existingSerial &&
          error.newSerial &&
          error.binNumber
        ) {
          // Find the bin_id from dayBinsData
          const bin = dayBinsData?.bins.find((b) => b.bin_number === error.binNumber);
          if (bin) {
            // Store pending replacement data and show dialog
            setPendingDuplicateScan({
              binId: bin.bin_id,
              binNumber: error.binNumber,
              existingSerial: error.existingSerial,
              newSerial: error.newSerial,
            });
            setDuplicateScanDialogOpen(true);
            // Play error sound to alert user
            playError();
            return;
          }
        }

        // Default error handling for other error types
        playError();
        toast({
          title: 'Scan Error',
          description: error.message,
          variant: 'destructive',
          duration: 3000,
        });
      },
      [playError, toast, dayBinsData?.bins]
    ),
  });

  /**
   * Check if Close Day button should be enabled
   * Requirements: open day exists and has active bins
   * MCP: FE-001 STATE_MANAGEMENT - Derived state for UI logic
   */
  const canEnterScannerMode = useMemo(() => {
    if (!dayBinsData?.bins) return false;
    // Must have at least one active bin with a pack
    return dayBinsData.bins.some((bin) => bin.pack !== null);
  }, [dayBinsData?.bins]);

  /**
   * Handle Close Day button click
   * SEC-010: AUTHZ - Check session first, only prompt PIN if needed
   */
  const handleCloseDayClick = useCallback(() => {
    executeWithAuth(
      () => {
        // Session valid - enter scanner mode directly
        setIsScannerModeActive(true);
        toast({
          title: 'Scanner Mode Activated',
          description: 'Scan lottery tickets to record ending serial numbers.',
        });
      },
      () => {
        // Session invalid - show PIN dialog
        setScannerModePinDialogOpen(true);
      }
    );
  }, [executeWithAuth, toast]);

  /**
   * Handle Scanner Mode PIN verification success
   * SEC-010: AUTHZ - PIN verification logs user in
   */
  const handleScannerModePinVerified = useCallback(
    (_user: VerifiedUser) => {
      setScannerModePinDialogOpen(false);
      setIsScannerModeActive(true);
      toast({
        title: 'Scanner Mode Activated',
        description: 'Scan lottery tickets to record ending serial numbers.',
      });
    },
    [toast]
  );

  /**
   * Handle barcode scan from DayCloseScannerBar
   * SEC-014: INPUT_VALIDATION - Validation delegated to useScannedBins.addFromSerial
   *
   * @param serial - 24-digit barcode string
   */
  const handleScan = useCallback(
    (serial: string) => {
      // addFromSerial handles validation, bin lookup, and state update
      // Returns false on error (hook's onScanError already called)
      addFromSerial(serial);
    },
    [addFromSerial]
  );

  /**
   * Handle scan error from ScannerInput (invalid format before parsing)
   */
  const handleScanError = useCallback(() => {
    playError();
    toast({
      title: 'Invalid Barcode',
      description: 'Scanned barcode is not a valid 24-digit lottery ticket.',
      variant: 'destructive',
      duration: 3000,
    });
  }, [playError, toast]);

  /**
   * Handle undo scan - remove a scanned bin
   * Called when user clicks a scanned row in the table
   */
  const handleUndoScan = useCallback(
    (binId: string) => {
      removeScannedBin(binId);
      toast({
        title: 'Scan Undone',
        description: 'Ending serial cleared. Scan the ticket again to re-enter.',
        duration: 2000,
      });
    },
    [removeScannedBin, toast]
  );

  /**
   * Handle cancel scanner mode
   * Phase 5.5: Shows confirmation dialog if scans exist to prevent data loss
   * MCP: FE-001 STATE_MANAGEMENT - User confirmation before destructive action
   */
  const handleCancelScannerMode = useCallback(() => {
    if (scannedBins.length > 0) {
      // Show confirmation dialog to prevent accidental data loss
      setScannerCancelDialogOpen(true);
    } else {
      // No scans to lose - exit directly
      setIsScannerModeActive(false);
      toast({
        title: 'Scanner Mode Cancelled',
        description: 'Scanner mode has been deactivated.',
      });
    }
  }, [scannedBins.length, toast]);

  /**
   * Handle confirmed cancel - actually clears data and exits scanner mode
   * Phase 5.5: Called after user confirms they want to discard scans
   */
  const handleConfirmCancelScannerMode = useCallback(() => {
    setScannerCancelDialogOpen(false);
    clearScannedBins();
    setIsScannerModeActive(false);
    toast({
      title: 'Scanner Mode Cancelled',
      description: `Discarded ${scannedBins.length} scanned bin${scannedBins.length === 1 ? '' : 's'}.`,
    });
  }, [clearScannedBins, scannedBins.length, toast]);

  /**
   * Handle duplicate scan replacement
   * Phase 5.2: Replace existing scan with new serial
   * MCP: SEC-014 INPUT_VALIDATION - Serial validated by replaceScannedBin
   */
  const handleReplaceDuplicateScan = useCallback(() => {
    if (!pendingDuplicateScan) return;

    const success = replaceScannedBin(pendingDuplicateScan.binId, pendingDuplicateScan.newSerial);

    setDuplicateScanDialogOpen(false);

    if (success) {
      playSuccess();
      toast({
        title: 'Scan Replaced',
        description: `Bin ${pendingDuplicateScan.binNumber} updated: ${pendingDuplicateScan.existingSerial} → ${pendingDuplicateScan.newSerial}`,
        duration: 2000,
      });
    } else {
      playError();
      toast({
        title: 'Replacement Failed',
        description: 'Failed to replace the scan. Please try scanning again.',
        variant: 'destructive',
      });
    }

    setPendingDuplicateScan(null);
  }, [pendingDuplicateScan, replaceScannedBin, playSuccess, playError, toast]);

  /**
   * Handle keeping the existing scan (cancel duplicate replacement)
   * Phase 5.2: User chose to keep the existing serial
   */
  const handleKeepExistingScan = useCallback(() => {
    setDuplicateScanDialogOpen(false);
    setPendingDuplicateScan(null);
    toast({
      title: 'Existing Scan Kept',
      description: 'The previous scan value was preserved.',
      duration: 2000,
    });
  }, [toast]);

  /**
   * Handle complete scanner mode
   * Maps scanned bins to manualEndingValues and enters manual entry mode for review/submit
   *
   * MCP: FE-001 STATE_MANAGEMENT - Transform scanned data to form state
   * SEC-014: INPUT_VALIDATION - Scanned serials already validated by hook
   */
  const handleCompleteScannerMode = useCallback(() => {
    if (!allBinsScanned) return;

    // Transform scannedBins to manualEndingValues format
    const endingValues: Record<string, string> = {};
    for (const scanned of scannedBins) {
      endingValues[scanned.bin_id] = scanned.closing_serial;
    }

    // Pre-populate the manual entry form with scanned values
    setManualEndingValues(endingValues);

    // Clear validation errors (scanned values are already validated)
    setValidationErrors({});

    // Exit scanner mode, keeping scanned data in table
    setIsScannerModeActive(false);

    // Enable manual entry mode so user can review and submit
    // SEC-010: AUTHZ - Use authenticated user from context for audit trail
    // SEC-017: AUDIT_TRAILS - Real user ID required for traceability
    setManualEntryState({
      isActive: true,
      authorizedBy: user ? { userId: user.id, name: user.name } : null,
      authorizedAt: new Date(),
    });

    toast({
      title: 'Scanning Complete',
      description: 'Review the ending serials and click "Save & Close Lottery" to submit.',
    });
  }, [allBinsScanned, scannedBins, user, toast]);

  // Handlers
  const handlePackDetailsClick = (packId: string) => {
    setSelectedPackId(packId);
    setDetailsDialogOpen(true);
  };

  /**
   * Handle Mark Sold button click
   * Opens the MarkSoldOutDialog for confirmation
   */
  const handleMarkSoldOutClick = useCallback((packId: string) => {
    setPackIdToMarkSoldOut(packId);
    setMarkSoldOutDialogOpen(true);
  }, []);

  /**
   * Handle successful mark sold out
   * Refreshes data and shows success message
   */
  const handleMarkSoldOutSuccess = useCallback(() => {
    invalidateAll(); // Refresh all lottery data including day bins
    setSuccessMessage('Pack marked as sold out successfully');
    setTimeout(() => setSuccessMessage(null), 5000);
  }, [invalidateAll]);

  /**
   * Prepare pack data for return dialog
   * Internal helper to extract pack data from day bins
   *
   * MCP Guidance Applied:
   * - FE-001: STATE_MANAGEMENT - Controlled dialog state with pack data
   */
  const prepareReturnPackData = useCallback(
    (packId: string) => {
      // Find the pack data from day bins to avoid extra API call
      const bin = dayBinsData?.bins.find((b) => b.pack?.pack_id === packId);
      if (bin?.pack) {
        // Transform DayBinPack to LotteryPackResponse format for the dialog
        const packData: LotteryPackResponse = {
          pack_id: bin.pack.pack_id,
          game_id: '', // Not needed for display, dialog uses game.name and game.price
          pack_number: bin.pack.pack_number,
          opening_serial: bin.pack.starting_serial,
          closing_serial: bin.pack.serial_end,
          status: 'ACTIVE', // Pack in bins is always ACTIVE
          store_id: storeId || '',
          bin_id: bin.bin_id,
          received_at: '', // Not needed for display
          activated_at: null,
          depleted_at: null,
          returned_at: null,
          game: {
            game_id: '',
            game_code: '',
            name: bin.pack.game_name,
            price: bin.pack.game_price,
            tickets_per_pack: 300, // Default value
          },
        };
        setPackDataToReturn(packData);
      } else {
        // Fallback: let dialog fetch from API
        setPackDataToReturn(null);
      }
      setPackIdToReturn(packId);
    },
    [dayBinsData?.bins, storeId]
  );

  /**
   * Handle Return Pack button click
   * SEC-010: AUTHZ - Requires shift_manager role, checks session first
   * If session valid with sufficient role, opens dialog directly
   * If session invalid, shows PIN verification dialog
   *
   * MCP Guidance Applied:
   * - FE-001: STATE_MANAGEMENT - Controlled dialog state with pack data
   * - SEC-014: INPUT_VALIDATION - Pack ID validated by dialog before API call
   * - SEC-010: AUTHZ - shift_manager role required, enforced server-side
   */
  const handleReturnPackClick = useCallback(
    (packId: string) => {
      // Store pack ID for use after auth
      prepareReturnPackData(packId);

      // SEC-010: Check session first, only prompt PIN if needed
      executeWithShiftManagerAuth(
        () => {
          // Valid session - open return dialog directly
          setReturnPackDialogOpen(true);
        },
        () => {
          // No valid session - show PIN dialog
          setReturnPackPinDialogOpen(true);
        }
      );
    },
    [prepareReturnPackData, executeWithShiftManagerAuth]
  );

  /**
   * Handle successful PIN verification for pack return
   * SEC-010: AUTHZ - User verified with shift_manager role
   * SEC-017: AUDIT_TRAILS - Session created, backend tracks user for audit
   */
  const handleReturnPackPinVerified = useCallback((_user: VerifiedUser) => {
    setReturnPackPinDialogOpen(false);
    setReturnPackDialogOpen(true);
  }, []);

  /**
   * Handle successful pack return
   * Refreshes data and shows success message
   *
   * MCP Guidance Applied:
   * - FE-001: STATE_MANAGEMENT - Clear dialog state after success
   * - API-003: ERROR_HANDLING - Success feedback to user
   */
  const handleReturnPackSuccess = useCallback(() => {
    invalidateAll(); // Refresh all lottery data including day bins
    setPackDataToReturn(null); // Clear pack data state
    setSuccessMessage('Pack returned successfully');
    setTimeout(() => setSuccessMessage(null), 5000);
  }, [invalidateAll]);

  /**
   * Handle successful pack activation
   * Called by EnhancedPackActivationForm onSuccess
   */
  const handleActivationSuccess = useCallback(() => {
    invalidateAll(); // Invalidate all lottery data including day bins
    setSuccessMessage('Pack activated successfully');
    setTimeout(() => setSuccessMessage(null), 5000);
  }, [invalidateAll]);

  /**
   * Handle Activate Pack button click
   * FE-001: Check session first, only show PIN dialog if session invalid
   */
  const handleActivatePackClick = useCallback(() => {
    executeWithAuth(
      () => {
        // Session valid - open activation dialog directly
        setActivationDialogOpen(true);
      },
      () => {
        // Session invalid - show PIN dialog
        setActivationPinDialogOpen(true);
      }
    );
  }, [executeWithAuth]);

  /**
   * Handle Pack Activation PIN verification success
   * SEC-010: AUTHZ - PIN verification logs user in, backend tracks activated_by from session
   */
  const handleActivationPinVerified = useCallback((_user: VerifiedUser) => {
    // User is now logged in (PIN dialog called auth:login)
    // Backend will get activated_by from the authenticated session
    setActivationPinDialogOpen(false);
    setActivationDialogOpen(true);
  }, []);

  /**
   * Handle Manual Entry button click
   * FE-001: Check session first, only show PIN dialog if session invalid
   */
  const handleManualEntryClick = useCallback(() => {
    executeWithAuth(
      (user) => {
        // Session valid - enable manual entry directly
        setManualEntryState({
          isActive: true,
          authorizedBy: {
            userId: user.userId,
            name: user.name,
          },
          authorizedAt: new Date(),
        });
        setManualEndingValues({});
        setValidationErrors({});
        toast({
          title: 'Manual Entry Enabled',
          description: `Authorized by ${user.name}. You can now enter ending serial numbers.`,
        });
      },
      () => {
        // Session invalid - show PIN dialog
        setManualEntryPinDialogOpen(true);
      }
    );
  }, [executeWithAuth, toast]);

  /**
   * Handle Manual Entry PIN verification success
   * SEC-010: AUTHZ - PIN verification logs user in for audit trail
   * SEC-017: AUDIT_TRAILS - Records user who authorized manual entry
   */
  const handleManualEntryPinVerified = useCallback(
    (user: VerifiedUser) => {
      setManualEntryState({
        isActive: true,
        authorizedBy: {
          userId: user.userId,
          name: user.name,
        },
        authorizedAt: new Date(),
      });
      setManualEntryPinDialogOpen(false);

      // Clear any previous manual entry values and validation errors
      setManualEndingValues({});
      setValidationErrors({});

      toast({
        title: 'Manual Entry Enabled',
        description: `Authorized by ${user.name}. You can now enter ending serial numbers.`,
      });
    },
    [toast]
  );

  /**
   * Handle cancel/exit manual entry mode
   * Clears authorization, entered values, and validation errors
   */
  const handleCancelManualEntry = useCallback(() => {
    setManualEntryState({
      isActive: false,
      authorizedBy: null,
      authorizedAt: null,
    });
    setManualEndingValues({});
    setValidationErrors({});

    toast({
      title: 'Manual Entry Cancelled',
      description: 'Manual entry mode has been deactivated.',
    });
  }, [toast]);

  /**
   * Handle ending value change in manual entry mode
   * Called when user types in an ending serial input
   */
  const handleEndingValueChange = useCallback((binId: string, value: string) => {
    setManualEndingValues((prev) => ({
      ...prev,
      [binId]: value,
    }));
  }, []);

  /**
   * Handle input complete (3 digits entered)
   * Can be used for audio feedback or other UX enhancements
   */
  const handleInputComplete = useCallback((_binId: string) => {
    // Optional: Add audio feedback or visual confirmation
    // The auto-advance is handled in DayBinsTable
  }, []);

  /**
   * Handle validation of ending serial on blur
   * Validates the 3-digit ending against pack's serial range
   * MCP: FE-002 FORM_VALIDATION - Real-time validation for immediate feedback
   */
  const handleValidateEnding = useCallback(
    async (
      binId: string,
      value: string,
      packData: { starting_serial: string; serial_end: string }
    ) => {
      const result = await validateManualEntryEnding(value, packData);

      setValidationErrors((prev) => {
        if (result.valid) {
          // Clear error for this bin if valid
          const { [binId]: _, ...rest } = prev;
          return rest;
        } else {
          // Set error for this bin
          return {
            ...prev,
            [binId]: { message: result.error || 'Invalid ending number' },
          };
        }
      });
    },
    []
  );

  /**
   * Check if all active bins have valid 3-digit ending values and no validation errors
   * Used to enable/disable the Close Day button in manual entry mode
   */
  const canCloseManualEntry = useMemo(() => {
    if (!manualEntryState.isActive || !dayBinsData?.bins) return false;

    // Cannot close if there are any validation errors
    if (Object.keys(validationErrors).length > 0) return false;

    const activeBins = dayBinsData.bins.filter((bin) => bin.pack !== null);
    if (activeBins.length === 0) return false;

    return activeBins.every((bin) => {
      const value = manualEndingValues[bin.bin_id];
      return value && /^\d{3}$/.test(value);
    });
  }, [manualEntryState.isActive, dayBinsData?.bins, manualEndingValues, validationErrors]);

  /**
   * Format the day started timestamp for display
   * SEC-014: Validates date format before processing
   * FE-001: Uses React JSX for safe rendering (auto-escaping)
   * API-008: Only displays whitelisted fields (opened_at)
   */
  const formattedDayStarted = useMemo(() => {
    // Get opened_at from dayStatus (available after initialization check passes)
    const openedAt = dayStatus?.day?.opened_at;

    // SEC-014: Strict validation - must be a non-empty string
    if (!openedAt || typeof openedAt !== 'string') {
      return null;
    }

    // SEC-014: Validate ISO 8601 date format before parsing
    const isoDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    if (!isoDatePattern.test(openedAt)) {
      return null;
    }

    try {
      const date = new Date(openedAt);

      // Validate the parsed date is valid
      if (isNaN(date.getTime())) {
        return null;
      }

      // Format: "Feb 1, 2026 7:32 PM"
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      // Defensive: return null on any parsing error
      return null;
    }
  }, [dayStatus?.day?.opened_at]);

  /**
   * Handle Close Day in manual entry mode
   * Submits the manually entered ending serial numbers
   */
  const handleManualCloseDay = useCallback(async () => {
    if (!canCloseManualEntry || !storeId || !dayBinsData?.bins) {
      return;
    }

    setIsSubmittingManualClose(true);

    try {
      // Build closings array from manual entry values
      const activeBins = dayBinsData.bins.filter((bin) => bin.pack !== null);
      const closings = activeBins.map((bin) => ({
        pack_id: bin.pack!.pack_id,
        closing_serial: manualEndingValues[bin.bin_id],
      }));

      // Submit to API
      const response = await closeLotteryDay(storeId, {
        closings,
      });

      if (response.success && response.data) {
        // Reset manual entry state and clear all validation errors
        setManualEntryState({
          isActive: false,
          authorizedBy: null,
          authorizedAt: null,
        });
        setManualEndingValues({});
        setValidationErrors({});

        // Invalidate data to refresh the table
        invalidateAll();

        toast({
          title: 'Lottery Closed Successfully',
          description: `Closed ${response.data.closings_created} pack(s) for business day ${response.data.business_date}`,
        });

        setSuccessMessage('Lottery closed successfully via manual entry');
        setTimeout(() => setSuccessMessage(null), 5000);
      } else {
        throw new Error('Failed to close lottery');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to close lottery';
      toast({
        title: 'Close Lottery Failed',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsSubmittingManualClose(false);
    }
  }, [canCloseManualEntry, storeId, dayBinsData?.bins, manualEndingValues, invalidateAll, toast]);

  /**
   * Handle Complete Onboarding button click
   * Exits onboarding mode and switches to normal operations
   *
   * BIZ-010: After onboarding, all new pack activations default to serial '000'
   */
  const handleCompleteOnboarding = useCallback(() => {
    setIsOnboardingMode(false);
    toast({
      title: 'Onboarding Complete',
      description: 'Normal operations active. New packs will start at ticket #1 by default.',
    });
  }, [toast]);

  /**
   * Handle Initialize Business Day button click
   * Requires authentication via PIN if not already logged in
   *
   * BIZ-010: Checks is_first_ever and activates onboarding mode if true
   */
  const handleInitializeBusinessDay = useCallback(() => {
    executeWithAuth(
      () => {
        // Session valid - initialize the day
        initializeBusinessDayMutation.mutate(undefined, {
          onSuccess: (response) => {
            if (response.success && response.data) {
              // BIZ-010: Check if this is the first-ever lottery day
              if (response.data.is_first_ever) {
                setIsOnboardingMode(true);
                toast({
                  title: 'Onboarding Mode Active',
                  description:
                    'Scan your existing packs. The current ticket position will be recorded.',
                  duration: 6000,
                });
              } else {
                toast({
                  title: 'Business Day Started',
                  description: `Business day for ${response.data.day.business_date} has been initialized.`,
                });
              }
              setSuccessMessage(
                'Business day initialized successfully. You can now receive and activate lottery packs.'
              );
              setTimeout(() => setSuccessMessage(null), 5000);
            }
          },
          onError: (error) => {
            toast({
              title: 'Initialization Failed',
              description:
                error instanceof Error ? error.message : 'Failed to initialize business day.',
              variant: 'destructive',
            });
          },
        });
      },
      () => {
        // Session invalid - show PIN dialog for initialization
        setInitializationPinDialogOpen(true);
      }
    );
  }, [executeWithAuth, initializeBusinessDayMutation, toast]);

  // ============ RENDER ============
  // Loading state - waiting for auth or dashboard data
  if (authLoading || dashboardLoading) {
    return (
      <div className="space-y-6" data-testid="lottery-management-page">
        <div className="space-y-1">
          <h1 className="text-heading-2 font-bold text-foreground">Lottery Management</h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // Error state - dashboard data failed to load
  if (dashboardError) {
    return (
      <div className="space-y-6" data-testid="lottery-management-page">
        <div className="space-y-1">
          <h1 className="text-heading-2 font-bold text-foreground">Lottery Management</h1>
          <p className="text-destructive">
            Failed to load store information: {dashboardErrorObj?.message || 'Unknown error'}
          </p>
        </div>
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-sm font-medium text-destructive">Error loading dashboard</p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {dashboardErrorObj instanceof Error
              ? dashboardErrorObj.message
              : 'An unknown error occurred'}
          </p>
        </div>
      </div>
    );
  }

  // No store available
  if (!storeId) {
    return (
      <div className="space-y-6" data-testid="lottery-management-page">
        <div className="space-y-1">
          <h1 className="text-heading-2 font-bold text-foreground">Lottery Management</h1>
          <p className="text-muted-foreground">No active store available</p>
        </div>
        <div className="rounded-lg border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            You need access to an active store to manage lottery packs.
          </p>
        </div>
      </div>
    );
  }

  // Day status loading
  if (dayStatusLoading) {
    return (
      <div className="space-y-6" data-testid="lottery-management-page">
        <div className="space-y-1">
          <h1 className="text-heading-2 font-bold text-foreground">Lottery Management</h1>
          <p className="text-muted-foreground">Checking business day status...</p>
        </div>
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // Day status error
  if (dayStatusError) {
    return (
      <div className="space-y-6" data-testid="lottery-management-page">
        <div className="space-y-1">
          <h1 className="text-heading-2 font-bold text-foreground">Lottery Management</h1>
          <p className="text-destructive">Failed to check business day status</p>
        </div>
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-sm font-medium text-destructive">Error loading day status</p>
          </div>
        </div>
      </div>
    );
  }

  // Auto-initializing state: Show loading when auto-initialization is in progress
  // This happens when needs_initialization is true but is_first_ever is false
  // The useEffect above handles the actual auto-initialization
  if (
    dayStatus?.needs_initialization &&
    dayStatus?.is_first_ever === false &&
    dayStatus?.prerequisites.has_bins &&
    dayStatus?.prerequisites.has_games
  ) {
    return (
      <div className="space-y-6" data-testid="lottery-management-page">
        <div className="space-y-1">
          <h1 className="text-heading-2 font-bold text-foreground">Lottery Management</h1>
          <p className="text-muted-foreground">Starting new business day...</p>
        </div>
        <div className="flex flex-col items-center justify-center p-8 space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            Automatically starting the next business day...
          </p>
        </div>
      </div>
    );
  }

  // First-ever Business Day Initialization Required
  // This screen only shows when is_first_ever is true (no lottery history exists)
  if (dayStatus?.needs_initialization && dayStatus?.is_first_ever === true) {
    const { prerequisites } = dayStatus;

    return (
      <div className="space-y-6" data-testid="lottery-management-page">
        <div className="space-y-1">
          <h1 className="text-heading-2 font-bold text-foreground">Lottery Management</h1>
          <p className="text-muted-foreground">
            Initialize your first business day to start lottery operations
          </p>
        </div>

        {/* Success Message */}
        {successMessage && (
          <Alert
            className="border-green-500/50 bg-green-50 dark:bg-green-950/20"
            data-testid="success-message"
          >
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}

        <div className="rounded-lg border bg-card p-8">
          <div className="flex flex-col items-center justify-center space-y-6">
            <div className="rounded-full bg-primary/10 p-4">
              <CalendarCheck className="h-12 w-12 text-primary" />
            </div>

            <div className="text-center space-y-2">
              <h2 className="text-xl font-semibold">Start Your First Business Day</h2>
              <p className="text-muted-foreground max-w-md">
                Welcome to lottery management! Before you can receive or activate lottery packs, you
                need to initialize your first business day. This is a one-time setup that creates an
                official record of when lottery operations began at this store.
              </p>
            </div>

            {/* Prerequisites Status */}
            <div className="w-full max-w-sm space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Lottery Bins Configured</span>
                <span className={prerequisites.has_bins ? 'text-green-600' : 'text-destructive'}>
                  {prerequisites.has_bins ? `✓ ${prerequisites.bins_count} bins` : '✗ No bins'}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Lottery Games Configured</span>
                <span className={prerequisites.has_games ? 'text-green-600' : 'text-destructive'}>
                  {prerequisites.has_games ? `✓ ${prerequisites.games_count} games` : '✗ No games'}
                </span>
              </div>
            </div>

            {/* Initialization Button */}
            <Button
              size="lg"
              onClick={handleInitializeBusinessDay}
              disabled={
                !prerequisites.has_bins ||
                !prerequisites.has_games ||
                initializeBusinessDayMutation.isPending
              }
              className="min-w-[200px]"
            >
              {initializeBusinessDayMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Initializing...
                </>
              ) : (
                <>
                  <CalendarCheck className="mr-2 h-4 w-4" />
                  Start First Business Day
                </>
              )}
            </Button>

            {/* Missing Prerequisites Warning */}
            {(!prerequisites.has_bins || !prerequisites.has_games) && (
              <Alert className="max-w-md">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {!prerequisites.has_bins && !prerequisites.has_games
                    ? 'No lottery bins or games are configured. Please sync from cloud first.'
                    : !prerequisites.has_bins
                      ? 'No lottery bins are configured. Please sync bins from cloud first.'
                      : 'No lottery games are configured. Please sync games from cloud first.'}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>

        {/* PIN Verification Dialog for Initialization */}
        <PinVerificationDialog
          open={initializationPinDialogOpen}
          onClose={() => setInitializationPinDialogOpen(false)}
          onVerified={(_user) => {
            setInitializationPinDialogOpen(false);
            // After PIN verification, trigger initialization
            initializeBusinessDayMutation.mutate(undefined, {
              onSuccess: (response) => {
                if (response.success && response.data) {
                  // BIZ-010: Check if this is the first-ever lottery day
                  if (response.data.is_first_ever) {
                    setIsOnboardingMode(true);
                    toast({
                      title: 'Onboarding Mode Active',
                      description:
                        'Scan your existing packs. The current ticket position will be recorded.',
                      duration: 6000,
                    });
                  } else {
                    toast({
                      title: 'Business Day Started',
                      description: `Business day for ${response.data.day.business_date} has been initialized.`,
                    });
                  }
                  setSuccessMessage(
                    'Business day initialized successfully. You can now receive and activate lottery packs.'
                  );
                  setTimeout(() => setSuccessMessage(null), 5000);
                }
              },
              onError: (error) => {
                toast({
                  title: 'Initialization Failed',
                  description:
                    error instanceof Error ? error.message : 'Failed to initialize business day.',
                  variant: 'destructive',
                });
              },
            });
          }}
          requiredRole="cashier"
          title="Verify PIN to Start Business Day"
          description="Enter your PIN to initialize today's business day."
        />
      </div>
    );
  }

  // Convert pack details to modal format
  // Note: Map from API response types to modal types
  // LotteryPackDetailResponse uses opening_serial for start, serial_end for pack range end
  // PackDetailsData uses serial_start/serial_end for display
  // NOTE: closing_serial is the CURRENT sales position, NOT the pack's last ticket
  const packDetailsForModal: PackDetailsData | null = packDetails
    ? ({
        pack_id: packDetails.pack_id,
        pack_number: packDetails.pack_number,
        serial_start: packDetails.opening_serial || '000',
        serial_end: packDetails.serial_end || '',
        status: packDetails.status,
        game: packDetails.game || {
          game_id: packDetails.game_id,
          name: 'Unknown Game',
        },
        bin: packDetails.bin
          ? {
              bin_id: packDetails.bin.bin_id,
              name: packDetails.bin.name || `Bin ${packDetails.bin.display_order}`,
              location: undefined,
            }
          : null,
        received_at: packDetails.received_at,
        activated_at: packDetails.activated_at,
        depleted_at: packDetails.depleted_at ?? undefined,
        returned_at: packDetails.returned_at ?? undefined,
        tickets_remaining: packDetails.tickets_remaining,
        // shift_openings and shift_closings are not available in LotteryPackDetailResponse
        shift_openings: undefined,
        shift_closings: undefined,
      } as PackDetailsData)
    : null;

  return (
    <div className="space-y-6" data-testid="lottery-management-page">
      {/* Header - Day info on left, action buttons on right */}
      <div className="flex items-center justify-between">
        {/* Left side: Day started info */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {formattedDayStarted && (
            <>
              <CalendarCheck className="h-4 w-4" />
              <span data-testid="day-started-info">Day started: {formattedDayStarted}</span>
            </>
          )}
        </div>

        {/* Right side: Action buttons */}
        <div className="flex flex-wrap gap-2">
          {/* Close Day Button - Opens scanner mode
              Story: Lottery Day Close Scanner Feature - Phase 4
              Disabled when: no active bins, manual entry active, or scanner mode already active
              SEC-010: Hidden when backend says independent close not allowed (non-lottery POS)
          */}
          {dayBinsData?.can_close_independently &&
            !isScannerModeActive &&
            !manualEntryState.isActive && (
              <Button
                onClick={handleCloseDayClick}
                variant="default"
                data-testid="close-day-button"
                disabled={!canEnterScannerMode}
              >
                <ScanLine className="mr-2 h-4 w-4" />
                Close Day
              </Button>
            )}

          {/* Manual Entry Button - Only for LOTTERY POS type (SEC-010)
              Non-lottery stores close lottery via Day Close Wizard */}
          {dayBinsData?.can_close_independently &&
            (manualEntryState.isActive ? (
              <Button
                onClick={handleCancelManualEntry}
                variant="destructive"
                data-testid="cancel-manual-entry-button"
              >
                <X className="mr-2 h-4 w-4" />
                Cancel Manual Entry
              </Button>
            ) : !isScannerModeActive ? (
              <Button
                onClick={handleManualEntryClick}
                variant="outline"
                data-testid="manual-entry-button"
                disabled={!dayBinsData?.bins.some((bin) => bin.pack !== null)}
              >
                <PenLine className="mr-2 h-4 w-4" />
                Manual Entry
              </Button>
            ) : null)}

          {/* Save & Close Lottery Button - Only shown in manual entry mode (SEC-010)
              Follows same visibility rules as Manual Entry button */}
          {dayBinsData?.can_close_independently && manualEntryState.isActive && (
            <Button
              onClick={handleManualCloseDay}
              variant="default"
              data-testid="save-close-lottery-button"
              disabled={!canCloseManualEntry || isSubmittingManualClose}
            >
              {isSubmittingManualClose ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save & Close Lottery
            </Button>
          )}

          {!isScannerModeActive && (
            <Button
              onClick={handleActivatePackClick}
              variant="outline"
              data-testid="activate-pack-button"
              disabled={!hasReceivedPacks || manualEntryState.isActive}
            >
              <Zap className="mr-2 h-4 w-4" />
              Activate Pack
            </Button>
          )}
        </div>
      </div>

      {/* Scanner Mode Bar - Sticky at top when active
          Story: Lottery Day Close Scanner Feature - Phase 4
          Shows progress, scan input, and action buttons
      */}
      {isScannerModeActive && dayBinsData && (
        <DayCloseScannerBar
          bins={dayBinsData.bins}
          scannedBins={scannedBins}
          onScan={handleScan}
          onScanError={handleScanError}
          onCancel={handleCancelScannerMode}
          onComplete={handleCompleteScannerMode}
          isMuted={isMuted}
          onToggleMute={toggleMute}
          isComplete={allBinsScanned}
          data-testid="day-close-scanner-bar"
        />
      )}

      {/* Onboarding Mode Indicator - BIZ-010 */}
      {isOnboardingMode && (
        <OnboardingModeIndicator
          isActive={isOnboardingMode}
          onComplete={handleCompleteOnboarding}
        />
      )}

      {/* Manual Entry Mode Indicator */}
      {manualEntryState.isActive && (
        <ManualEntryIndicator
          isActive={manualEntryState.isActive}
          authorizedBy={manualEntryState.authorizedBy}
          authorizedAt={manualEntryState.authorizedAt}
        />
      )}

      {/* Success Message */}
      {successMessage && (
        <Alert
          className="border-green-500/50 bg-green-50 dark:bg-green-950/20"
          data-testid="success-message"
        >
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}

      {/* Day Bins Table Loading State */}
      {dayBinsLoading && (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading bins...</span>
        </div>
      )}

      {/* Day Bins Table Error State */}
      {dayBinsError && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-sm font-medium text-destructive">Failed to load bins</p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {dayBinsErrorObj instanceof Error
              ? dayBinsErrorObj.message
              : 'Please try refreshing the page.'}
          </p>
        </div>
      )}

      {/* Day Bins Table */}
      {!dayBinsLoading && !dayBinsError && dayBinsData && (
        <>
          <DayBinsTable
            bins={dayBinsData.bins}
            onRowClick={handlePackDetailsClick}
            manualEntryMode={manualEntryState.isActive}
            endingValues={manualEndingValues}
            onEndingChange={handleEndingValueChange}
            onInputComplete={handleInputComplete}
            validationErrors={validationErrors}
            onValidateEnding={handleValidateEnding}
            onMarkSoldOut={handleMarkSoldOutClick}
            onReturnPack={handleReturnPackClick}
            // Scanner mode props (Phase 4)
            scannedBins={scannedBins}
            lastScannedBinId={lastScannedBinId}
            onUndoScan={handleUndoScan}
            scannerModeActive={isScannerModeActive}
          />

          {/* Returned Packs Section (Collapsible) - Enterprise Close-to-Close Model */}
          <ReturnedPacksSection
            returnedPacks={dayBinsData.returned_packs}
            openBusinessPeriod={dayBinsData.open_business_period}
            defaultOpen={false}
          />

          {/* Depleted Packs Section (Collapsible) - Enterprise Close-to-Close Model */}
          <DepletedPacksSection
            depletedPacks={dayBinsData.depleted_packs}
            openBusinessPeriod={dayBinsData.open_business_period}
            defaultOpen={false}
          />

          {/* Activated Packs Section (Collapsible) - Enterprise Close-to-Close Model */}
          <ActivatedPacksSection
            activatedPacks={dayBinsData.activated_packs}
            openBusinessPeriod={dayBinsData.open_business_period}
            defaultOpen={false}
          />
        </>
      )}

      {/* Empty State - No bins configured */}
      {!dayBinsLoading && !dayBinsError && dayBinsData?.bins.length === 0 && (
        <div className="rounded-lg border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No bins configured for this store. Contact your administrator to set up lottery bins.
          </p>
        </div>
      )}

      {/* Pack Activation PIN Verification Dialog
          MCP: SEC-010 AUTHZ - Verify user before allowing pack activation
          Enterprise: Backend gets activated_by from session, not frontend
      */}
      <PinVerificationDialog
        open={activationPinDialogOpen}
        onClose={() => setActivationPinDialogOpen(false)}
        onVerified={handleActivationPinVerified}
        requiredRole="cashier"
        title="Verify PIN for Pack Activation"
        description="Enter your PIN to activate lottery packs."
      />

      {/* Pack Activation Dialog - Enhanced with search, bin selection, and auth flow */}
      {/* BIZ-010: Pass onboardingMode to use scanned serial_start instead of '000' */}
      <EnhancedPackActivationForm
        storeId={storeId}
        open={activationDialogOpen}
        onOpenChange={setActivationDialogOpen}
        onSuccess={handleActivationSuccess}
        dayBins={dayBinsData?.bins}
        onboardingMode={isOnboardingMode}
      />

      {/* Pack Details Modal */}
      <PackDetailsModal
        pack={packDetailsForModal}
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        isLoading={packDetailsLoading}
      />

      {/* Manual Entry PIN Verification Dialog
          SEC-010: AUTHZ - PIN verification before enabling manual entry mode
          SEC-017: AUDIT_TRAILS - Records user who authorized manual entry
          FE-001: SESSION_CACHING - Bypasses PIN if valid session exists
      */}
      <PinVerificationDialog
        open={manualEntryPinDialogOpen}
        onClose={() => setManualEntryPinDialogOpen(false)}
        onVerified={handleManualEntryPinVerified}
        requiredRole="cashier"
        title="Verify PIN for Manual Entry"
        description="Enter your PIN to enable manual entry mode. This action will be recorded for audit purposes."
      />

      {/* Scanner Mode PIN Verification Dialog
          SEC-010: AUTHZ - PIN verification before enabling scanner mode
          SEC-017: AUDIT_TRAILS - Records user who authorized day close
          FE-001: SESSION_CACHING - Bypasses PIN if valid session exists
          Story: Lottery Day Close Scanner Feature - Phase 4
      */}
      <PinVerificationDialog
        open={scannerModePinDialogOpen}
        onClose={() => setScannerModePinDialogOpen(false)}
        onVerified={handleScannerModePinVerified}
        requiredRole="cashier"
        title="Verify PIN for Day Close"
        description="Enter your PIN to enter scanner mode for closing the lottery day."
      />

      {/* Scanner Mode Cancel Confirmation Dialog
          Phase 5.5: Prevent accidental data loss when canceling with existing scans
          MCP: FE-001 STATE_MANAGEMENT - User confirmation before destructive action
          Story: Lottery Day Close Scanner Feature - Phase 5
      */}
      <Dialog open={scannerCancelDialogOpen} onOpenChange={setScannerCancelDialogOpen}>
        <DialogContent className="sm:max-w-md" data-testid="scanner-cancel-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              Discard Scanned Data?
            </DialogTitle>
            <DialogDescription>
              You have {scannedBins.length} scanned bin{scannedBins.length === 1 ? '' : 's'}.
              Canceling will discard all scanned data and exit scanner mode. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setScannerCancelDialogOpen(false)}
              data-testid="scanner-cancel-dialog-keep"
            >
              Keep Scanning
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmCancelScannerMode}
              data-testid="scanner-cancel-dialog-discard"
            >
              Discard & Exit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate Scan Replacement Dialog
          Phase 5.2: Allow user to replace existing scan or keep it
          MCP: FE-001 STATE_MANAGEMENT - User choice for duplicate handling
          Story: Lottery Day Close Scanner Feature - Phase 5
      */}
      <Dialog open={duplicateScanDialogOpen} onOpenChange={setDuplicateScanDialogOpen}>
        <DialogContent className="sm:max-w-md" data-testid="duplicate-scan-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-blue-600" />
              Bin Already Scanned
            </DialogTitle>
            <DialogDescription>
              {pendingDuplicateScan && (
                <>
                  Bin {pendingDuplicateScan.binNumber} was already scanned with ending serial{' '}
                  <span className="font-mono font-semibold">
                    {pendingDuplicateScan.existingSerial}
                  </span>
                  .
                  <br />
                  <br />
                  Replace with new serial{' '}
                  <span className="font-mono font-semibold">{pendingDuplicateScan.newSerial}</span>?
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={handleKeepExistingScan}
              data-testid="duplicate-scan-dialog-keep"
            >
              Keep Existing ({pendingDuplicateScan?.existingSerial})
            </Button>
            <Button
              onClick={handleReplaceDuplicateScan}
              data-testid="duplicate-scan-dialog-replace"
            >
              Replace with {pendingDuplicateScan?.newSerial}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark Sold Out Dialog */}
      <MarkSoldOutDialog
        open={markSoldOutDialogOpen}
        onOpenChange={setMarkSoldOutDialogOpen}
        packId={packIdToMarkSoldOut}
        onSuccess={handleMarkSoldOutSuccess}
      />

      {/* Return Pack PIN Verification Dialog
          SEC-010: AUTHZ - PIN verification before allowing pack return
          SEC-017: AUDIT_TRAILS - Records user who authorized return
          FE-001: SESSION_CACHING - Bypasses PIN if valid session exists
      */}
      <PinVerificationDialog
        open={returnPackPinDialogOpen}
        onClose={() => setReturnPackPinDialogOpen(false)}
        onVerified={handleReturnPackPinVerified}
        requiredRole="shift_manager"
        title="Verify PIN for Pack Return"
        description="Enter your PIN to return this pack. Shift Manager access required."
      />

      {/* Return Pack Dialog
          MCP Guidance Applied:
          - FE-001: STATE_MANAGEMENT - Controlled dialog with pack ID and data
          - FE-002: FORM_VALIDATION - Dialog validates all inputs before API call
          - SEC-014: INPUT_VALIDATION - Serial format and range validated
          - SEC-010: AUTHZ - shift_manager role enforced via PIN dialog + server
          - API-003: ERROR_HANDLING - Dialog shows user-friendly error messages
      */}
      <ReturnPackDialog
        open={returnPackDialogOpen}
        onOpenChange={setReturnPackDialogOpen}
        packId={packIdToReturn}
        packData={packDataToReturn}
        onSuccess={handleReturnPackSuccess}
      />
    </div>
  );
}
