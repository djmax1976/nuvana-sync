
/**
 * Day Close Mode Scanner Component
 *
 * Full-page scanner interface for closing lottery as part of day close workflow.
 * Replaces the modal-based approach with a persistent, scannable interface.
 *
 * Story: Lottery Day Close Enhancement - Phase 2
 *
 * Features:
 * - Floating scan bar that stays visible while scrolling
 * - 400ms debounce for scanner detection (fast input = scanner, slow = manual)
 * - Web Audio API notification sounds (success/error)
 * - Direct table row updates on successful scan
 * - Click-to-undo on scanned rows
 * - Real-time progress tracking
 * - Accessibility: ARIA labels, keyboard navigation, focus management
 *
 * MCP Guidance Applied:
 * - FE-002: FORM_VALIDATION - Strict 24-digit validation before processing
 * - SEC-014: INPUT_VALIDATION - Length, type, and format constraints
 * - SEC-004: XSS - React auto-escapes all output
 * - FE-001: STATE_MANAGEMENT - Secure state with useCallback/useMemo
 * - FE-005: UI_SECURITY - No sensitive data exposed in DOM
 *
 * @requirements
 * - Auto-focused scan input for immediate barcode scanner use
 * - Floating scan bar appears when inline input scrolls out of view
 * - Validate serial against pack ranges (ending >= starting, <= serial_end)
 * - Duplicate scan detection
 * - Sound feedback (toggleable, persisted to localStorage)
 * - All bins must be scanned before proceeding
 */

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  type ChangeEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useNotificationSound } from "@/hooks/use-notification-sound";
import {
  Loader2,
  Volume2,
  VolumeX,
  X,
  CheckCircle2,
  ArrowRight,
  Scan,
  AlertCircle,
  AlertTriangle,
  PenLine,
} from "lucide-react";
import {
  prepareLotteryDayClose,
  type DayBin,
  type PrepareLotteryDayCloseResponse,
  type ReturnedPackDay,
  type DepletedPackDay,
  type ActivatedPackDay,
  type OpenBusinessPeriod,
} from "@/lib/api/lottery";
import { parseSerializedNumber } from "@/lib/utils/lottery-serial-parser";
import { cn } from "@/lib/utils";
import { formatDateTimeShort } from "@/utils/date-format.utils";
import { useStoreTimezone } from "@/contexts/StoreContext";
import { ManualEntryAuthModal } from "@/components/lottery/ManualEntryAuthModal";
import {
  UnscannedBinWarningModal,
  type UnscannedBinInfo,
  type UnscannedBinModalResult,
  type BinDecision,
} from "@/components/lottery/UnscannedBinWarningModal";
import { validateManualEntryEnding } from "@/lib/services/lottery-closing-validation";
import { ReturnedPacksSection } from "@/components/lottery/ReturnedPacksSection";
import { DepletedPacksSection } from "@/components/lottery/DepletedPacksSection";
import { ActivatedPacksSection } from "@/components/lottery/ActivatedPacksSection";

/**
 * Scanned bin state - tracks which bins have been scanned and their ending serials
 *
 * MCP Guidance Applied:
 * - FE-001: STATE_MANAGEMENT - Track source of closing serial for correct calculation
 */
export interface ScannedBin {
  bin_id: string;
  bin_number: number;
  pack_id: string;
  pack_number: string;
  game_name: string;
  closing_serial: string;
  /**
   * True if this bin was marked as sold out (depleted).
   * Affects ticket calculation formula:
   * - Sold out: (serial_end + 1) - starting (serial_end is last index)
   * - Normal scan: ending - starting (ending is next position)
   */
  is_sold_out?: boolean;
}

/**
 * Lottery close result data passed to parent on success
 * Now includes pending close data for two-phase commit
 */
export interface LotteryCloseResult {
  /** Number of packs with closing serials */
  closings_created: number;
  /** Business day date string */
  business_day: string;
  /** Estimated lottery total (calculated from scanned serials) */
  lottery_total: number;
  /** Bin breakdown with sales calculations */
  bins_closed: PrepareLotteryDayCloseResponse["bins_preview"];
  /** Day ID for commit-close call */
  day_id?: string;
  /** Pending close expiration time */
  pending_close_expires_at?: string;
}

/**
 * Open shift info for blocking banner display
 */
export interface BlockingShiftInfo {
  shift_id: string;
  terminal_name: string | null;
  cashier_name: string;
  shift_number: number | null;
}

/**
 * Manual entry state interface
 * Tracks manual entry mode activation and authorization
 *
 * MCP Guidance Applied:
 * - FE-001: STATE_MANAGEMENT - Sensitive authorization state managed in memory
 * - SEC-010: AUTHZ - Authorization tracked with user ID for audit
 */
export interface ManualEntryState {
  isActive: boolean;
  authorizedBy: {
    userId: string;
    name: string;
  } | null;
  authorizedAt: Date | null;
}

/**
 * Validation error for a single bin
 */
interface BinValidationError {
  message: string;
}

/**
 * Pending closings data for deferred commit mode
 * Contains everything needed to call the close API later
 */
export interface PendingClosingsData {
  closings: Array<{
    pack_id: string;
    closing_serial: string;
  }>;
  entry_method: "SCAN" | "MANUAL";
  authorized_by_user_id?: string;
}

/**
 * Props interface for DayCloseModeScanner
 *
 * MCP Guidance Applied:
 * - SEC-014: INPUT_VALIDATION - Strict type definitions for component props
 * - FE-001: STATE_MANAGEMENT - Clear separation of controlled vs uncontrolled state
 */
interface DayCloseModeScannerProps {
  /** Store UUID for API calls */
  storeId: string;
  /** Bins with pack information from useLotteryDayBins hook */
  bins: DayBin[];
  /** Current shift ID - excluded from open shifts check */
  currentShiftId?: string;
  /** Callback when user cancels day close mode */
  onCancel: () => void;
  /** Callback when lottery is successfully closed with data for day-close page */
  onSuccess: (data: LotteryCloseResult) => void;
  /** Optional: External state management for scanned bins (controlled mode) */
  scannedBins?: ScannedBin[];
  /** Optional: Callback for external scanned bins state (controlled mode) */
  onScannedBinsChange?: (bins: ScannedBin[]) => void;
  /** Optional: Open shifts blocking day close (empty array = not blocked) */
  blockingShifts?: BlockingShiftInfo[];
  /**
   * Defer database commit until Step 3 completes
   * When true:
   * - Does NOT call the close API
   * - Calculates totals locally from scanned bins
   * - Returns pending closings data for the parent to commit later
   * - onPendingClosings callback is required when this is true
   */
  deferCommit?: boolean;
  /** Callback with pending closings data when deferCommit is true */
  onPendingClosings?: (data: PendingClosingsData) => void;
  /** Returned packs for the current business period (enterprise close-to-close model) */
  returnedPacks?: ReturnedPackDay[];
  /** Depleted packs for the current business period (enterprise close-to-close model) */
  depletedPacks?: DepletedPackDay[];
  /** Activated packs for the current business period (enterprise close-to-close model) */
  activatedPacks?: ActivatedPackDay[];
  /** Open business period metadata for context display */
  openBusinessPeriod?: OpenBusinessPeriod;
}

/**
 * SCAN_VALIDATION_TIMEOUT_MS - Time to wait after last keystroke before validating
 * Scanner input completes in ~120-250ms for 24 digits
 * If 400ms passes with no more input and length != 24, it's invalid
 */
const SCAN_VALIDATION_TIMEOUT_MS = 400;

/**
 * SERIAL_LENGTH - Expected length of lottery serial number
 */
const SERIAL_LENGTH = 24;

/**
 * DayCloseModeScanner component
 * Full-page scanner interface for closing lottery during day close
 */
export function DayCloseModeScanner({
  storeId,
  bins,
  currentShiftId,
  onCancel,
  onSuccess,
  scannedBins: externalScannedBins,
  onScannedBinsChange,
  blockingShifts = [],
  returnedPacks,
  depletedPacks,
  activatedPacks,
  openBusinessPeriod,
}: DayCloseModeScannerProps) {
  const { toast } = useToast();
  const { playSuccess, playError, isMuted, toggleMute } =
    useNotificationSound();

  // ========================================================================
  // HOOKS
  // MCP: FE-001 STATE_MANAGEMENT - Access store timezone for date formatting
  // ========================================================================
  const storeTimezone = useStoreTimezone();

  // Ref for 400ms scan validation timer
  const scanValidationTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ============ STATE MANAGEMENT ============
  // Controlled vs uncontrolled pattern for scanned bins
  const [internalScannedBins, setInternalScannedBins] = useState<ScannedBin[]>(
    [],
  );
  const isControlled = externalScannedBins !== undefined;
  const scannedBins = isControlled ? externalScannedBins : internalScannedBins;

  // Keep refs to avoid stale closures
  const externalScannedBinsRef = useRef(externalScannedBins);
  const onScannedBinsChangeRef = useRef(onScannedBinsChange);
  useEffect(() => {
    externalScannedBinsRef.current = externalScannedBins;
    onScannedBinsChangeRef.current = onScannedBinsChange;
  }, [externalScannedBins, onScannedBinsChange]);

  // Wrapper for setting scanned bins - handles controlled/uncontrolled
  const setScannedBins = useCallback(
    (updater: ScannedBin[] | ((prev: ScannedBin[]) => ScannedBin[])) => {
      if (isControlled) {
        const currentBins = externalScannedBinsRef.current ?? [];
        const newValue =
          typeof updater === "function" ? updater(currentBins) : updater;
        onScannedBinsChangeRef.current?.(newValue);
      } else {
        setInternalScannedBins(updater);
      }
    },
    [isControlled],
  );

  const [inputValue, setInputValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showFloatingBar, setShowFloatingBar] = useState(false);
  const [lastScannedBinId, setLastScannedBinId] = useState<string | null>(null);

  // Manual entry state management
  const [manualEntryAuthModalOpen, setManualEntryAuthModalOpen] =
    useState(false);
  const [manualEntryState, setManualEntryState] = useState<ManualEntryState>({
    isActive: false,
    authorizedBy: null,
    authorizedAt: null,
  });

  // Manual entry values - keyed by bin_id (3-digit ending serials)
  const [manualEndingValues, setManualEndingValues] = useState<
    Record<string, string>
  >({});

  // Validation errors for manual entry - keyed by bin_id
  const [validationErrors, setValidationErrors] = useState<
    Record<string, BinValidationError>
  >({});

  // Track bins with pending validation (validation in flight)
  // Prevents race condition where button enables before validation completes
  const [pendingValidations, setPendingValidations] = useState<Set<string>>(
    new Set(),
  );

  // Validation error modal state
  const [validationErrorModal, setValidationErrorModal] = useState<{
    open: boolean;
    binNumber: number | null;
    message: string;
  }>({ open: false, binNumber: null, message: "" });

  // Unscanned bin warning modal state
  // Shown when user tries to proceed with bins that have no ending serial
  const [unscannedBinWarningModal, setUnscannedBinWarningModal] = useState<{
    open: boolean;
    unscannedBins: UnscannedBinInfo[];
  }>({ open: false, unscannedBins: [] });

  // Refs for DOM
  const inlineInputRef = useRef<HTMLInputElement>(null);
  const floatingInputRef = useRef<HTMLInputElement>(null);
  const inlineScanSectionRef = useRef<HTMLDivElement>(null);

  // Refs for manual entry input focus management
  const manualInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const hasAppliedManualFocus = useRef(false);
  const prevManualEntryMode = useRef(manualEntryState.isActive);

  // ============ COMPUTED VALUES ============
  // Get bins with active packs (need scanning)
  const activeBins = useMemo(
    () => bins.filter((bin) => bin.is_active && bin.pack),
    [bins],
  );

  // Get pending bins (not yet scanned)
  const pendingBins = useMemo(
    () =>
      activeBins.filter(
        (bin) => !scannedBins.find((scanned) => scanned.bin_id === bin.bin_id),
      ),
    [activeBins, scannedBins],
  );

  // Progress percentage
  const progressPercent = useMemo(() => {
    if (activeBins.length === 0) return 0;
    return Math.round((scannedBins.length / activeBins.length) * 100);
  }, [scannedBins.length, activeBins.length]);

  // Can proceed to next step? (either all scanned OR all manual entries valid)
  const allBinsScanned =
    activeBins.length > 0 && scannedBins.length === activeBins.length;

  // Get sorted active bin IDs for focus management
  const sortedActiveBinIds = useMemo(
    () =>
      [...activeBins]
        .sort((a, b) => a.bin_number - b.bin_number)
        .map((bin) => bin.bin_id),
    [activeBins],
  );

  // Check if all active bins have valid 3-digit ending values in manual entry mode
  // Bins that were scanned already have their values; remaining bins need manual input
  // Also ensures no pending validations are in flight (prevents race condition)
  const canCloseManualEntry = useMemo(() => {
    if (!manualEntryState.isActive) return false;
    if (Object.keys(validationErrors).length > 0) return false;
    if (pendingValidations.size > 0) return false; // Wait for validations to complete
    if (activeBins.length === 0) return false;

    return activeBins.every((bin) => {
      // Check if this bin was already scanned
      const scannedBin = scannedBins.find((s) => s.bin_id === bin.bin_id);
      if (scannedBin) return true; // Already has a valid closing serial

      // Otherwise check manual entry value
      const value = manualEndingValues[bin.bin_id];
      return value && /^\d{3}$/.test(value);
    });
  }, [
    manualEntryState.isActive,
    activeBins,
    scannedBins,
    manualEndingValues,
    validationErrors,
    pendingValidations,
  ]);

  // Is scanning blocked by open shifts?
  const isBlocked = blockingShifts.length > 0;

  /**
   * Get bins that have no ending serial (neither scanned nor manually entered)
   * Used to determine if warning modal should be shown before proceeding
   */
  const binsWithoutEnding = useMemo((): UnscannedBinInfo[] => {
    return activeBins
      .filter((bin) => {
        // Check if this bin was scanned
        const wasScanned = scannedBins.some((s) => s.bin_id === bin.bin_id);
        if (wasScanned) return false;

        // In manual entry mode, check if there's a valid 3-digit value
        if (manualEntryState.isActive) {
          const manualValue = manualEndingValues[bin.bin_id];
          if (manualValue && /^\d{3}$/.test(manualValue)) return false;
        }

        // Bin has no ending serial
        return true;
      })
      .map((bin) => ({
        bin_id: bin.bin_id,
        bin_number: bin.bin_number,
        pack_id: bin.pack!.pack_id,
        pack_number: bin.pack!.pack_number,
        game_name: bin.pack!.game_name,
        game_price: bin.pack!.game_price,
        starting_serial: bin.pack!.starting_serial,
        serial_end: bin.pack!.serial_end,
      }));
  }, [activeBins, scannedBins, manualEntryState.isActive, manualEndingValues]);

  // ============ SCROLL DETECTION FOR FLOATING BAR ============
  useEffect(() => {
    const handleScroll = () => {
      if (!inlineScanSectionRef.current) return;
      const rect = inlineScanSectionRef.current.getBoundingClientRect();
      const isHidden = rect.bottom < 0;
      setShowFloatingBar(isHidden);

      // Focus floating input when bar appears
      if (isHidden && floatingInputRef.current) {
        floatingInputRef.current.focus();
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // ============ CLEANUP ============
  useEffect(() => {
    return () => {
      if (scanValidationTimerRef.current) {
        clearTimeout(scanValidationTimerRef.current);
      }
    };
  }, []);

  // ============ AUTO-FOCUS ON MOUNT ============
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      inlineInputRef.current?.focus();
    }, 150);
    return () => clearTimeout(timeoutId);
  }, []);

  // ============ CLEAR FLASH ANIMATION ============
  useEffect(() => {
    if (lastScannedBinId) {
      const timeoutId = setTimeout(() => {
        setLastScannedBinId(null);
      }, 800);
      return () => clearTimeout(timeoutId);
    }
  }, [lastScannedBinId]);

  // ============ MANUAL ENTRY MODE FOCUS MANAGEMENT ============
  // Focus first unscanned bin input when manual entry mode is activated
  useEffect(() => {
    const wasJustActivated =
      manualEntryState.isActive && !prevManualEntryMode.current;
    prevManualEntryMode.current = manualEntryState.isActive;

    if (!manualEntryState.isActive) {
      hasAppliedManualFocus.current = false;
      return;
    }

    if (
      wasJustActivated &&
      !hasAppliedManualFocus.current &&
      sortedActiveBinIds.length > 0
    ) {
      hasAppliedManualFocus.current = true;

      // Find first bin that hasn't been scanned yet
      const firstUnscannedBinId = sortedActiveBinIds.find(
        (binId) => !scannedBins.find((s) => s.bin_id === binId),
      );

      if (firstUnscannedBinId) {
        setTimeout(() => {
          const firstInput = manualInputRefs.current.get(firstUnscannedBinId);
          if (firstInput) {
            firstInput.focus();
          }
        }, 100);
      }
    }
  }, [manualEntryState.isActive, sortedActiveBinIds, scannedBins]);

  /**
   * Clear input and refocus for next scan
   * MCP: FE-001 STATE_MANAGEMENT - Clean state transitions
   */
  const clearInputAndFocus = useCallback(
    (inputRef: React.RefObject<HTMLInputElement | null>) => {
      setInputValue("");
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    },
    [],
  );

  /**
   * Check if a pack number matches a returned pack
   *
   * SEC-014: INPUT_VALIDATION - Strict type validation before comparison
   * FE-001: STATE_MANAGEMENT - Pure function with no side effects
   *
   * @param packNumber - The pack number to check (validated 11-digit string)
   * @returns The matching ReturnedPackDay or undefined if not found
   */
  const findReturnedPack = useCallback(
    (packNumber: string): ReturnedPackDay | undefined => {
      // SEC-014: Validate input type before processing
      if (typeof packNumber !== "string" || packNumber.length === 0) {
        return undefined;
      }

      // SEC-014: Validate returnedPacks array exists and is an array
      if (!Array.isArray(returnedPacks) || returnedPacks.length === 0) {
        return undefined;
      }

      // Find matching returned pack with strict equality check
      return returnedPacks.find(
        (pack) =>
          typeof pack.pack_number === "string" &&
          pack.pack_number === packNumber,
      );
    },
    [returnedPacks],
  );

  /**
   * Format returned pack date for user display
   *
   * SEC-014: INPUT_VALIDATION - Validate date string before parsing
   * FE-005: UI_SECURITY - Safe date formatting without exposing internal data
   *
   * @param isoDateString - ISO date string from returned_at field
   * @returns Formatted date string or fallback text
   */
  const formatReturnedDate = useCallback(
    (isoDateString: string): string => {
      // SEC-014: Validate input is a non-empty string
      if (typeof isoDateString !== "string" || isoDateString.length === 0) {
        return "earlier today";
      }

      try {
        // Use centralized timezone-aware formatting utility
        return formatDateTimeShort(isoDateString, storeTimezone);
      } catch {
        // SEC-014: Fail safely with fallback value
        return "earlier today";
      }
    },
    [storeTimezone],
  );

  /**
   * Process a complete 24-digit serial number
   * MCP: FE-002 FORM_VALIDATION, SEC-014 INPUT_VALIDATION
   */
  const processSerial = useCallback(
    (serial: string, inputRef: React.RefObject<HTMLInputElement | null>) => {
      // Validate format
      if (!/^\d{24}$/.test(serial)) {
        return; // Not complete yet
      }

      try {
        // Parse serial client-side
        const parsed = parseSerializedNumber(serial);
        const packNumber = parsed.pack_number;
        const closingSerial = parsed.serial_start; // Positions 12-14

        // Find matching bin by pack number
        const matchingBin = activeBins.find(
          (bin) => bin.pack && bin.pack.pack_number === packNumber,
        );

        if (!matchingBin || !matchingBin.pack) {
          // SEC-014: Check if pack was returned before showing generic error
          // This provides specific user guidance instead of confusing "not found" message
          const returnedPack = findReturnedPack(packNumber);

          if (returnedPack) {
            // Pack exists but was returned - show specific error with context
            // FE-005: UI_SECURITY - Only display necessary info (game name, date)
            // Do not expose internal IDs or sensitive return details
            const returnedDate = formatReturnedDate(returnedPack.returned_at);
            playError();
            toast({
              title: "Pack already returned",
              description: `${returnedPack.game_name} (Pack ${packNumber}) was returned on ${returnedDate}. See Returned Packs section above.`,
              variant: "destructive",
            });
            clearInputAndFocus(inputRef);
            return;
          }

          // Truly not found - pack doesn't exist in active bins or returned packs
          playError();
          toast({
            title: "Pack not found",
            description: `No active pack matching ${packNumber}`,
            variant: "destructive",
          });
          clearInputAndFocus(inputRef);
          return;
        }

        // Check if already scanned
        const alreadyScanned = scannedBins.find(
          (scanned) => scanned.bin_id === matchingBin.bin_id,
        );
        if (alreadyScanned) {
          playError();
          toast({
            title: "Duplicate scan",
            description: `Bin ${matchingBin.bin_number} has already been scanned`,
            variant: "destructive",
          });
          clearInputAndFocus(inputRef);
          return;
        }

        // Validate closing serial range
        const closingSerialNum = parseInt(closingSerial, 10);
        const startingSerialNum = parseInt(
          matchingBin.pack.starting_serial,
          10,
        );
        const serialEndNum = parseInt(matchingBin.pack.serial_end, 10);

        if (closingSerialNum < startingSerialNum) {
          playError();
          toast({
            title: "Invalid ending serial",
            description: `Ending ${closingSerial} is less than starting ${matchingBin.pack.starting_serial}`,
            variant: "destructive",
          });
          clearInputAndFocus(inputRef);
          return;
        }

        if (closingSerialNum > serialEndNum) {
          playError();
          toast({
            title: "Invalid ending serial",
            description: `Ending ${closingSerial} exceeds pack max ${matchingBin.pack.serial_end}`,
            variant: "destructive",
          });
          clearInputAndFocus(inputRef);
          return;
        }

        // Success! Add to scanned list
        const newScannedBin: ScannedBin = {
          bin_id: matchingBin.bin_id,
          bin_number: matchingBin.bin_number,
          pack_id: matchingBin.pack.pack_id,
          pack_number: matchingBin.pack.pack_number,
          game_name: matchingBin.pack.game_name,
          closing_serial: closingSerial,
        };

        setScannedBins((prev) =>
          [...prev, newScannedBin].sort((a, b) => a.bin_number - b.bin_number),
        );
        setLastScannedBinId(matchingBin.bin_id);
        clearInputAndFocus(inputRef);

        // Success feedback
        playSuccess();
        toast({
          title: "Bin scanned",
          description: `Bin ${matchingBin.bin_number} - ${matchingBin.pack.game_name} (${closingSerial})`,
        });

        // Scroll row into view
        const row = document.getElementById(`bin-row-${matchingBin.bin_id}`);
        if (row) {
          row.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Invalid serial format";
        playError();
        toast({
          title: "Invalid serial",
          description: errorMessage,
          variant: "destructive",
        });
        clearInputAndFocus(inputRef);
      }
    },
    [
      activeBins,
      scannedBins,
      setScannedBins,
      toast,
      clearInputAndFocus,
      playSuccess,
      playError,
      findReturnedPack,
      formatReturnedDate,
    ],
  );

  /**
   * Handle input change with simple 400ms debounce validation
   * - If input stops for 400ms and length != 24, show error
   * - If length > 24, show error immediately
   * - On error: clear input and refocus
   */
  const handleInputChange = useCallback(
    (
      e: ChangeEvent<HTMLInputElement>,
      inputRef: React.RefObject<HTMLInputElement | null>,
    ) => {
      const value = e.target.value;
      // Only allow digits
      const cleanedValue = value.replace(/\D/g, "");

      // Clear any pending validation timer
      if (scanValidationTimerRef.current) {
        clearTimeout(scanValidationTimerRef.current);
        scanValidationTimerRef.current = null;
      }

      // Handle numeric input
      if (cleanedValue.length > 0) {
        // Too long - reject immediately
        if (cleanedValue.length > SERIAL_LENGTH) {
          playError();
          toast({
            title: "Invalid input. Please scan again.",
            variant: "destructive",
          });
          setInputValue("");
          setTimeout(() => inputRef.current?.focus(), 50);
          return;
        }

        setInputValue(cleanedValue);

        // If exactly 24 digits, process immediately
        if (cleanedValue.length === SERIAL_LENGTH) {
          processSerial(cleanedValue, inputRef);
          return;
        }

        // Start 400ms timer - if no more input comes and length != 24, show error
        const capturedLength = cleanedValue.length;
        scanValidationTimerRef.current = setTimeout(() => {
          if (capturedLength !== SERIAL_LENGTH) {
            playError();
            toast({
              title: "Invalid input. Please scan again.",
              variant: "destructive",
            });
            setInputValue("");
            setTimeout(() => inputRef.current?.focus(), 50);
          }
        }, SCAN_VALIDATION_TIMEOUT_MS);
      } else {
        setInputValue(cleanedValue);
      }
    },
    [processSerial, toast, playError],
  );

  /**
   * Remove scanned bin (undo)
   */
  const handleRemoveBin = useCallback(
    (binId: string) => {
      setScannedBins((prev) => prev.filter((bin) => bin.bin_id !== binId));
      inlineInputRef.current?.focus();
    },
    [setScannedBins],
  );

  // ============ MANUAL ENTRY HANDLERS ============

  /**
   * Handle Manual Entry button click
   * Opens the auth modal for PIN verification
   */
  const handleManualEntryClick = useCallback(() => {
    setManualEntryAuthModalOpen(true);
  }, []);

  /**
   * Handle Manual Entry authorization success
   * Pre-populate manual entry values with already-scanned bin values
   */
  const handleManualEntryAuthorized = useCallback(
    (authorizedBy: { userId: string; name: string }) => {
      // Pre-populate manualEndingValues with scanned bin values
      const prePopulatedValues: Record<string, string> = {};
      scannedBins.forEach((scannedBin) => {
        prePopulatedValues[scannedBin.bin_id] = scannedBin.closing_serial;
      });

      setManualEntryState({
        isActive: true,
        authorizedBy,
        authorizedAt: new Date(),
      });
      setManualEntryAuthModalOpen(false);
      setManualEndingValues(prePopulatedValues);
      setValidationErrors({});
      setPendingValidations(new Set());

      toast({
        title: "Manual Entry Enabled",
        description: `Authorized by ${authorizedBy.name}. You can now enter ending serial numbers.`,
      });
    },
    [scannedBins, toast],
  );

  /**
   * Handle cancel/exit manual entry mode
   */
  const handleCancelManualEntry = useCallback(() => {
    setManualEntryState({
      isActive: false,
      authorizedBy: null,
      authorizedAt: null,
    });
    setManualEndingValues({});
    setValidationErrors({});
    setPendingValidations(new Set());

    toast({
      title: "Manual Entry Cancelled",
      description: "Manual entry mode has been deactivated.",
    });
  }, [toast]);

  /**
   * Store manual input ref for focus management
   */
  const setManualInputRef = useCallback(
    (binId: string, element: HTMLInputElement | null) => {
      if (element) {
        manualInputRefs.current.set(binId, element);
      } else {
        manualInputRefs.current.delete(binId);
      }
    },
    [],
  );

  /**
   * Handle manual ending value change
   * Only allows numeric input, max 3 digits, validates on 3 digits, auto-advances focus
   * MCP: SEC-014 INPUT_VALIDATION - Strict format constraints
   * MCP: FE-002 FORM_VALIDATION - Validate immediately when complete input detected
   */
  const handleManualEndingChange = useCallback(
    (binId: string, value: string) => {
      // Strip non-numeric characters
      const sanitizedValue = value.replace(/\D/g, "");
      // Enforce max length of 3 digits
      const truncatedValue = sanitizedValue.slice(0, 3);

      setManualEndingValues((prev) => ({
        ...prev,
        [binId]: truncatedValue,
      }));

      // When 3 digits entered: validate immediately, then auto-advance focus
      if (truncatedValue.length === 3) {
        // Find the bin to get pack data for validation
        const bin = activeBins.find((b) => b.bin_id === binId);
        if (bin?.pack) {
          // Mark this bin as having validation in progress
          setPendingValidations((prev) => new Set(prev).add(binId));

          // Validate immediately when 3 digits entered (don't wait for blur)
          validateManualEntryEnding(truncatedValue, {
            starting_serial: bin.pack.starting_serial,
            serial_end: bin.pack.serial_end,
          }).then((result) => {
            // Remove from pending validations
            setPendingValidations((prev) => {
              const next = new Set(prev);
              next.delete(binId);
              return next;
            });

            if (result.valid) {
              // Clear any existing error for this bin
              setValidationErrors((prev) => {
                const { [binId]: _, ...rest } = prev;
                return rest;
              });
            } else {
              // Set error state and show modal
              const errorMessage = result.error || "Invalid ending number";
              setValidationErrors((prev) => ({
                ...prev,
                [binId]: { message: errorMessage },
              }));
              setValidationErrorModal({
                open: true,
                binNumber: bin.bin_number,
                message: errorMessage,
              });
            }
          });
        }

        // Auto-advance to next bin that needs input (not scanned, and after current bin)
        const currentIndex = sortedActiveBinIds.indexOf(binId);
        if (currentIndex !== -1) {
          for (let i = currentIndex + 1; i < sortedActiveBinIds.length; i++) {
            // eslint-disable-next-line security/detect-object-injection -- Array index access is safe with controlled loop
            const nextBinId = sortedActiveBinIds[i];
            // Skip bins that were already scanned
            if (scannedBins.find((s) => s.bin_id === nextBinId)) {
              continue;
            }
            const nextInput = manualInputRefs.current.get(nextBinId);
            if (nextInput) {
              setTimeout(() => nextInput.focus(), 50);
              break;
            }
          }
        }
      } else {
        // Clear error when user is typing (less than 3 digits)
        setValidationErrors((prev) => {
          const { [binId]: _, ...rest } = prev;
          return rest;
        });
      }
    },
    [sortedActiveBinIds, scannedBins, activeBins],
  );

  /**
   * Handle manual input blur - validate ending serial against pack range
   * Shows validation error in a modal dialog to avoid layout disruption
   * MCP: FE-002 FORM_VALIDATION - Validate on blur for immediate feedback
   */
  const handleManualInputBlur = useCallback(
    async (
      binId: string,
      binNumber: number,
      value: string,
      pack: { starting_serial: string; serial_end: string },
    ) => {
      // Only validate if we have 3 digits (complete entry)
      if (value.length !== 3) return;

      const result = await validateManualEntryEnding(value, {
        starting_serial: pack.starting_serial,
        serial_end: pack.serial_end,
      });

      if (result.valid) {
        // Clear any existing error for this bin
        setValidationErrors((prev) => {
          const { [binId]: _, ...rest } = prev;
          return rest;
        });
      } else {
        // Set error state and show modal
        const errorMessage = result.error || "Invalid ending number";
        setValidationErrors((prev) => ({
          ...prev,
          [binId]: { message: errorMessage },
        }));
        // Show error in modal
        setValidationErrorModal({
          open: true,
          binNumber,
          message: errorMessage,
        });
      }
    },
    [],
  );

  /**
   * Submit closing data to API (scan mode)
   * Now uses two-phase commit: prepare-close stores pending data,
   * actual commit happens in Step 3 when day close is confirmed.
   * MCP: API-001 VALIDATION - Validated data to backend
   */
  const handleSubmit = useCallback(async () => {
    if (!allBinsScanned) {
      toast({
        title: "Incomplete scan",
        description: "Please scan all active bins before closing lottery",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // SEC-014: Include is_sold_out flag for correct backend calculation
      // Sold-out packs use depletion formula: (serial_end + 1) - starting
      // Normal scans use standard formula: ending - starting
      const closings = scannedBins.map((bin) => ({
        pack_id: bin.pack_id,
        closing_serial: bin.closing_serial,
        is_sold_out: bin.is_sold_out === true,
      }));

      // Phase 1: Prepare close - validates and stores pending data
      // Does NOT commit lottery records - that happens in Step 3
      const response = await prepareLotteryDayClose({
        closings,
      });

      if (response.success && response.data) {
        playSuccess();
        // No toast needed - page transition provides visual confirmation

        // Reset state and notify parent with prepare response data
        setScannedBins([]);
        setInputValue("");
        onSuccess({
          closings_created: response.data.closings_count,
          business_day: response.data.business_date,
          lottery_total: response.data.estimated_lottery_total,
          bins_closed: response.data.bins_preview,
          day_id: response.data.day_id,
          pending_close_expires_at: response.data.pending_close_expires_at,
        });
      } else {
        throw new Error("Failed to prepare lottery close");
      }
    } catch (error) {
      playError();

      // Check for specific error codes
      const apiError = error as {
        code?: string;
        message?: string;
      };

      if (apiError.code === "SHIFTS_STILL_OPEN") {
        toast({
          title: "Cannot Close Lottery",
          description:
            "All shifts must be closed before lottery can be closed.",
          variant: "destructive",
        });
      } else {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Failed to prepare lottery close";
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    allBinsScanned,
    scannedBins,
    setScannedBins,
    storeId,
    currentShiftId,
    toast,
    onSuccess,
    playSuccess,
    playError,
  ]);

  /**
   * Submit closing data from manual entry mode to API
   * Now uses two-phase commit: prepare-close stores pending data,
   * actual commit happens in Step 3 when day close is confirmed.
   * Combines already-scanned bins with manually entered values
   * Includes audit trail with authorizing user
   */
  const handleManualSubmit = useCallback(async () => {
    if (!canCloseManualEntry) {
      toast({
        title: "Incomplete entry",
        description: "Please enter valid 3-digit ending serials for all bins",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // Build closings array: combine scanned bins + manually entered values
      // SEC-014: Include is_sold_out flag for correct backend calculation
      const closings = activeBins.map((bin) => {
        // Check if this bin was scanned
        const scannedBin = scannedBins.find((s) => s.bin_id === bin.bin_id);
        if (scannedBin) {
          return {
            pack_id: scannedBin.pack_id,
            closing_serial: scannedBin.closing_serial,
            is_sold_out: scannedBin.is_sold_out === true,
          };
        }
        // Otherwise use manual entry value (manual entries are never sold-out)
        return {
          pack_id: bin.pack!.pack_id,
          closing_serial: manualEndingValues[bin.bin_id],
          is_sold_out: false,
        };
      });

      // Phase 1: Prepare close - validates and stores pending data
      // Does NOT commit lottery records - that happens in Step 3
      const response = await prepareLotteryDayClose({
        closings,
      });

      if (response.success && response.data) {
        playSuccess();
        // No toast needed - page transition provides visual confirmation

        // Reset all state and notify parent with prepare response data
        setScannedBins([]);
        setInputValue("");
        setManualEntryState({
          isActive: false,
          authorizedBy: null,
          authorizedAt: null,
        });
        setManualEndingValues({});
        setValidationErrors({});
        setPendingValidations(new Set());

        onSuccess({
          closings_created: response.data.closings_count,
          business_day: response.data.business_date,
          lottery_total: response.data.estimated_lottery_total,
          bins_closed: response.data.bins_preview,
          day_id: response.data.day_id,
          pending_close_expires_at: response.data.pending_close_expires_at,
        });
      } else {
        throw new Error("Failed to prepare lottery close");
      }
    } catch (error) {
      playError();

      const apiError = error as { code?: string; message?: string };
      if (apiError.code === "SHIFTS_STILL_OPEN") {
        toast({
          title: "Cannot Close Lottery",
          description:
            "All shifts must be closed before lottery can be closed.",
          variant: "destructive",
        });
      } else {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Failed to prepare lottery close";
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    canCloseManualEntry,
    activeBins,
    scannedBins,
    setScannedBins,
    manualEndingValues,
    manualEntryState.authorizedBy,
    storeId,
    currentShiftId,
    toast,
    onSuccess,
    playSuccess,
    playError,
  ]);

  /**
   * Handle result from UnscannedBinWarningModal
   * Processes user decisions for bins without ending serials
   *
   * MCP Guidance Applied:
   * - FE-002: FORM_VALIDATION - Validate decisions before processing
   * - SEC-014: INPUT_VALIDATION - Strict validation of user choices
   */
  const handleUnscannedBinModalResult = useCallback(
    (result: UnscannedBinModalResult) => {
      // Process any sold out decisions - add directly to scannedBins (not manual entry)
      if (result.decisions && result.decisions.length > 0) {
        // Add sold out bins to scannedBins so they show green on main page
        // Mark as is_sold_out so calculateTotalSales uses depletion formula
        const newScannedBins: ScannedBin[] = result.decisions.map(
          (decision) => ({
            bin_id: decision.bin_id,
            bin_number: decision.bin_number,
            pack_id: decision.pack_id,
            pack_number: decision.pack_number,
            game_name: decision.game_name,
            closing_serial: decision.ending_serial,
            is_sold_out: true, // Use depletion formula: (serial_end + 1) - starting
          }),
        );

        setScannedBins((prev) =>
          [...prev, ...newScannedBins].sort(
            (a, b) => a.bin_number - b.bin_number,
          ),
        );
        // No toast needed - green highlighting in table provides visual confirmation
      }

      setUnscannedBinWarningModal({ open: false, unscannedBins: [] });

      // If returning to scan, focus back on scan input
      if (result.returnToScan) {
        setTimeout(() => {
          inlineInputRef.current?.focus();
        }, 100);
      }
    },
    [setScannedBins],
  );

  /**
   * Handle attempt to proceed when bins have no ending serial
   * Opens the warning modal to get user decisions
   */
  const handleProceedWithUnscannedBins = useCallback(() => {
    if (binsWithoutEnding.length > 0) {
      setUnscannedBinWarningModal({
        open: true,
        unscannedBins: binsWithoutEnding,
      });
    }
  }, [binsWithoutEnding]);

  /**
   * Calculate tickets sold using serial difference
   *
   * Formula: tickets_sold = ending_serial - starting_serial
   *
   * The starting serial represents the NEXT ticket to be sold (first unsold),
   * and the ending serial represents the NEXT ticket to be sold after sales.
   * The difference gives the exact count of tickets sold during the period.
   *
   * Serial Position Semantics:
   * - Starting serial: Position of the first ticket available for sale
   * - Ending serial: Position after the last ticket sold (next available)
   *
   * Examples:
   * - Starting: 0, Ending: 0 = 0 tickets sold (no sales, still at position 0)
   * - Starting: 0, Ending: 1 = 1 ticket sold (ticket #0 sold, now at position 1)
   * - Starting: 0, Ending: 15 = 15 tickets sold (tickets #0-14 sold)
   * - Starting: 5, Ending: 10 = 5 tickets sold (tickets #5-9 sold)
   * - Starting: 0, Ending: 50 = 50 tickets sold (full 50-ticket pack)
   *
   * @param endingSerial - The ending serial position (3 digits, e.g., "015")
   * @param startingSerial - The starting serial position (3 digits, e.g., "000")
   * @returns Number of tickets sold (never negative, 0 for invalid input)
   *
   * MCP Guidance Applied:
   * - SEC-014: INPUT_VALIDATION - Strict numeric validation with NaN guard and bounds check
   * - FE-001: STATE_MANAGEMENT - Pure function with no side effects, memoized with useCallback
   * - API-003: ERROR_HANDLING - Returns 0 for invalid input (fail-safe for UI calculations)
   * - FE-020: REACT_OPTIMIZATION - useCallback prevents unnecessary re-renders
   */
  const calculateTicketsSold = useCallback(
    (endingSerial: string, startingSerial: string): number => {
      // SEC-014: Validate input types before processing
      if (
        typeof endingSerial !== "string" ||
        typeof startingSerial !== "string"
      ) {
        return 0;
      }

      // SEC-014: Parse with explicit radix to prevent octal interpretation
      const endingNum = parseInt(endingSerial, 10);
      const startingNum = parseInt(startingSerial, 10);

      // SEC-014: Strict NaN validation using Number.isNaN (not global isNaN)
      // This handles empty strings, non-numeric input, null coercion, etc.
      if (Number.isNaN(endingNum) || Number.isNaN(startingNum)) {
        return 0;
      }

      // SEC-014: Validate serial range (reasonable bounds check)
      const MAX_SERIAL = 999;
      if (
        endingNum < 0 ||
        endingNum > MAX_SERIAL ||
        startingNum < 0 ||
        startingNum > MAX_SERIAL
      ) {
        return 0;
      }

      // Calculate tickets sold: ending - starting
      // This gives the exact count of tickets sold during the period
      // Example: starting=0, ending=15 means tickets 0-14 were sold = 15 tickets
      const ticketsSold = endingNum - startingNum;

      // Ensure non-negative result (ending should never be less than starting)
      // Math.max provides defense-in-depth against data integrity issues
      return Math.max(0, ticketsSold);
    },
    [],
  );

  /**
   * Calculate tickets sold for DEPLETED packs (manual or auto sold-out)
   *
   * Formula: tickets_sold = (serial_end + 1) - starting_serial
   *
   * IMPORTANT: This function is specifically for DEPLETION scenarios where:
   * 1. Manual depletion - user marks pack as "sold out"
   * 2. Auto depletion - new pack activated in same bin, old pack auto-closes
   *
   * In depletion cases, serial_end represents the LAST ticket INDEX (e.g., "029" for
   * a 30-ticket pack), NOT the next position. Therefore we add 1 to convert from
   * last-index to count.
   *
   * @param serialEnd - The pack's last ticket INDEX (3 digits, e.g., "029" for 30-ticket pack)
   * @param startingSerial - The starting serial position (3 digits, e.g., "000")
   * @returns Number of tickets sold (never negative, 0 for invalid input)
   *
   * MCP Guidance Applied:
   * - SEC-014: INPUT_VALIDATION - Strict numeric validation with NaN guard and bounds check
   * - FE-001: STATE_MANAGEMENT - Pure function with no side effects, memoized with useCallback
   * - API-003: ERROR_HANDLING - Returns 0 for invalid input (fail-safe for UI calculations)
   * - FE-020: REACT_OPTIMIZATION - useCallback prevents unnecessary re-renders
   */
  const calculateTicketsSoldForDepletion = useCallback(
    (serialEnd: string, startingSerial: string): number => {
      // SEC-014: Validate input types before processing
      if (typeof serialEnd !== "string" || typeof startingSerial !== "string") {
        return 0;
      }

      // SEC-014: Parse with explicit radix to prevent octal interpretation
      const serialEndNum = parseInt(serialEnd, 10);
      const startingNum = parseInt(startingSerial, 10);

      // SEC-014: Strict NaN validation using Number.isNaN (not global isNaN)
      if (Number.isNaN(serialEndNum) || Number.isNaN(startingNum)) {
        return 0;
      }

      // SEC-014: Validate serial range (reasonable bounds check)
      const MAX_SERIAL = 999;
      if (
        serialEndNum < 0 ||
        serialEndNum > MAX_SERIAL ||
        startingNum < 0 ||
        startingNum > MAX_SERIAL
      ) {
        return 0;
      }

      // Depletion formula: (serial_end + 1) - starting = tickets sold
      // serial_end is the LAST ticket index, so +1 converts to count
      // Example: serial_end=29, starting=0 → (29+1)-0 = 30 tickets (full 30-ticket pack)
      const ticketsSold = serialEndNum + 1 - startingNum;

      // Ensure non-negative result
      return Math.max(0, ticketsSold);
    },
    [],
  );

  /**
   * Calculate total lottery sales from scanned bins + manual entry values
   *
   * Uses different formulas based on bin type:
   * - Normal scan/manual entry: ending - starting
   * - Sold out (depletion): (serial_end + 1) - starting
   */
  const calculateTotalSales = useMemo(() => {
    return activeBins.reduce((total, bin) => {
      if (!bin.pack) return total;

      // First check scanned bins
      const scannedBin = scannedBins.find((s) => s.bin_id === bin.bin_id);
      let closingSerial: string | undefined;
      let isSoldOut = false;

      if (scannedBin) {
        closingSerial = scannedBin.closing_serial;
        isSoldOut = scannedBin.is_sold_out === true;
      } else if (manualEntryState.isActive && manualEndingValues[bin.bin_id]) {
        closingSerial = manualEndingValues[bin.bin_id];
      }

      if (!closingSerial || closingSerial.length !== 3) return total;

      // Use correct formula based on whether bin was marked sold out
      // Sold out: (serial_end + 1) - starting (closing_serial IS serial_end)
      // Normal: ending - starting (closing_serial is next position)
      const ticketsSold = isSoldOut
        ? calculateTicketsSoldForDepletion(
            closingSerial,
            bin.pack.starting_serial,
          )
        : calculateTicketsSold(closingSerial, bin.pack.starting_serial);

      return total + ticketsSold * bin.pack.game_price;
    }, 0);
  }, [
    activeBins,
    scannedBins,
    manualEntryState.isActive,
    manualEndingValues,
    calculateTicketsSold,
    calculateTicketsSoldForDepletion,
  ]);

  // ============ RENDER ============
  return (
    <div className="relative" data-testid="day-close-mode-scanner">
      {/* Floating Scan Bar (Fixed at top when scrolled) */}
      <div
        className={cn(
          "fixed top-0 left-0 right-0 z-40 bg-primary text-primary-foreground shadow-lg transition-transform duration-300",
          showFloatingBar ? "translate-y-0" : "-translate-y-full",
        )}
        data-testid="floating-scan-bar"
      >
        <div className="max-w-7xl mx-auto px-6 py-3">
          <div className="flex items-center gap-4">
            {/* Title */}
            <div className="flex items-center gap-2 shrink-0">
              <Scan className="w-5 h-5" />
              <span className="font-semibold">Close Lottery</span>
            </div>

            {/* Input */}
            <div className="flex-1 relative">
              <Input
                ref={floatingInputRef}
                type="text"
                value={inputValue}
                onChange={(e) => handleInputChange(e, floatingInputRef)}
                placeholder="Scan barcode..."
                maxLength={SERIAL_LENGTH}
                disabled={isSubmitting}
                className="w-full text-lg font-mono bg-white text-foreground border-2 border-white focus:border-primary/50"
                data-testid="floating-serial-input"
                aria-label="Scan lottery serial number"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
                {inputValue.length}/{SERIAL_LENGTH}
              </span>
            </div>

            {/* Counter */}
            <div className="text-center px-3 shrink-0">
              <div className="text-2xl font-bold">
                {scannedBins.length}/{activeBins.length}
              </div>
              <div className="text-xs opacity-80">Scanned</div>
            </div>

            {/* Sound Toggle */}
            <button
              type="button"
              onClick={toggleMute}
              className="p-2 hover:bg-primary/80 rounded-md shrink-0"
              title={isMuted ? "Enable scan sounds" : "Disable scan sounds"}
              aria-label={
                isMuted ? "Enable scan sounds" : "Disable scan sounds"
              }
              data-testid="floating-sound-toggle"
            >
              {isMuted ? (
                <VolumeX className="w-6 h-6" />
              ) : (
                <Volume2 className="w-6 h-6" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Blocking Banner - Open Shifts Prevent Day Close */}
      {isBlocked && (
        <div
          className="mb-4 rounded-lg border-2 border-destructive bg-destructive/10 p-4"
          data-testid="open-shifts-blocking-banner"
          role="alert"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <AlertCircle
              className="h-6 w-6 text-destructive flex-shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <h3 className="font-semibold text-destructive">
                Cannot Close Day – Open Shifts Found
              </h3>
              {blockingShifts.map((shift) => (
                <p
                  key={shift.shift_id}
                  className="text-sm text-muted-foreground"
                >
                  {shift.terminal_name || "Unknown Terminal"} • Shift #
                  {shift.shift_number || "?"} • {shift.cashier_name}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div
        className={cn(
          "bg-card rounded-lg border overflow-hidden flex flex-col min-h-[400px]",
          isBlocked && "opacity-60 pointer-events-none",
        )}
      >
        {/* Sticky Header with scan input - stays at top when scrolling */}
        <div className="sticky top-0 z-20 bg-card border-b shadow-sm">
          {/* Title and controls */}
          <div className="px-6 py-4 border-b bg-muted/30">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">
                  Close Lottery
                  {manualEntryState.isActive && (
                    <span className="ml-2 text-sm font-normal text-amber-600 dark:text-amber-400">
                      (Manual Entry Mode)
                    </span>
                  )}
                </h2>
                <p className="text-muted-foreground">
                  {isBlocked
                    ? "Scanning disabled – close all shifts first"
                    : manualEntryState.isActive
                      ? `Manual entry enabled by ${manualEntryState.authorizedBy?.name}. Enter 3-digit ending serials.`
                      : "Scan the barcode on the current ticket of each active bin"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-muted-foreground">
                  <span className="text-lg font-bold text-primary">
                    {scannedBins.length}
                  </span>
                  /{activeBins.length} scanned
                </span>

                {/* Manual Entry Button - only show when not in manual mode */}
                {!manualEntryState.isActive && !isBlocked && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleManualEntryClick}
                    disabled={isSubmitting}
                    data-testid="manual-entry-button"
                  >
                    <PenLine className="mr-2 h-4 w-4" />
                    Manual Entry
                  </Button>
                )}

                {/* Cancel Manual Entry Button */}
                {manualEntryState.isActive && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelManualEntry}
                    disabled={isSubmitting}
                    data-testid="cancel-manual-entry-button"
                  >
                    <X className="mr-2 h-4 w-4" />
                    Exit Manual Mode
                  </Button>
                )}

                <button
                  type="button"
                  onClick={toggleMute}
                  className="p-2 hover:bg-muted rounded-md"
                  title={isMuted ? "Enable scan sounds" : "Disable scan sounds"}
                  aria-label={
                    isMuted ? "Enable scan sounds" : "Disable scan sounds"
                  }
                  data-testid="inline-sound-toggle"
                >
                  {isMuted ? (
                    <VolumeX className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <Volume2 className="w-5 h-5 text-green-600" />
                  )}
                </button>
              </div>
            </div>

            {/* Inline Scan Input - hide in manual entry mode */}
            {!manualEntryState.isActive && (
              <div ref={inlineScanSectionRef} className="mt-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 relative">
                    <Input
                      ref={inlineInputRef}
                      type="text"
                      value={inputValue}
                      onChange={(e) => handleInputChange(e, inlineInputRef)}
                      placeholder="Scan barcode..."
                      maxLength={SERIAL_LENGTH}
                      disabled={isSubmitting}
                      className="w-full text-lg font-mono"
                      data-testid="inline-serial-input"
                      aria-label="Scan 24-digit barcode"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono">
                      {inputValue.length}/{SERIAL_LENGTH}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Progress Bar */}
          <div className="px-6 py-3 bg-muted/10">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">Progress</span>
              <Progress value={progressPercent} className="flex-1" />
              <span className="text-sm text-muted-foreground">
                {progressPercent}%
              </span>
            </div>
          </div>
        </div>

        {/* Bins Table - scrollable content */}
        <div className="overflow-x-auto flex-1">
          <table className="w-full">
            <thead className="bg-card border-b sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                  Bin
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                  Game
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                  Price
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                  Pack #
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                  Starting
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase min-w-[5.5rem]">
                  Ending
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">
                  Sold
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {activeBins.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <AlertCircle className="h-8 w-8 text-muted-foreground/50" />
                      <p className="font-medium">No Active Bins</p>
                      <p className="text-sm">
                        There are no bins with active lottery packs to close.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
              {activeBins
                .sort((a, b) => a.bin_number - b.bin_number)
                .map((bin) => {
                  const scannedBin = scannedBins.find(
                    (s) => s.bin_id === bin.bin_id,
                  );
                  const isScanned = !!scannedBin;
                  const isJustScanned = lastScannedBinId === bin.bin_id;

                  // Get manual entry value and validation error
                  const manualValue = manualEndingValues[bin.bin_id] || "";
                  const validationError = validationErrors[bin.bin_id];
                  const hasError = !!validationError;

                  // Calculate sold and amount from either scanned or manual entry
                  let ticketsSold = 0;
                  let salesAmount = 0;
                  let closingSerial: string | undefined;

                  if (isScanned && bin.pack) {
                    closingSerial = scannedBin.closing_serial;
                  } else if (
                    manualEntryState.isActive &&
                    manualValue.length === 3 &&
                    bin.pack
                  ) {
                    closingSerial = manualValue;
                  }

                  if (closingSerial && bin.pack) {
                    // Use correct formula based on whether bin was marked sold out
                    const isSoldOut = scannedBin?.is_sold_out === true;
                    ticketsSold = isSoldOut
                      ? calculateTicketsSoldForDepletion(
                          closingSerial,
                          bin.pack.starting_serial,
                        )
                      : calculateTicketsSold(
                          closingSerial,
                          bin.pack.starting_serial,
                        );
                    salesAmount = ticketsSold * bin.pack.game_price;
                  }

                  const hasValidEntry = !!closingSerial;

                  return (
                    <tr
                      key={bin.bin_id}
                      id={`bin-row-${bin.bin_id}`}
                      className={cn(
                        "transition-colors h-14",
                        isScanned && !manualEntryState.isActive
                          ? "bg-green-50 dark:bg-green-950/20 cursor-pointer hover:bg-green-100 dark:hover:bg-green-950/30"
                          : manualEntryState.isActive && hasValidEntry
                            ? "bg-green-50 dark:bg-green-950/20"
                            : "hover:bg-muted/50",
                        isJustScanned && "animate-pulse",
                        manualEntryState.isActive &&
                          !isScanned &&
                          "bg-amber-50/30 dark:bg-amber-950/10",
                      )}
                      onClick={() =>
                        !manualEntryState.isActive &&
                        isScanned &&
                        handleRemoveBin(bin.bin_id)
                      }
                      title={
                        !manualEntryState.isActive && isScanned
                          ? "Click to undo scan"
                          : undefined
                      }
                      data-testid={`bin-row-${bin.bin_id}`}
                    >
                      <td className="px-4 py-3 font-mono font-semibold">
                        {bin.bin_number}
                      </td>
                      <td className="px-4 py-3">{bin.pack?.game_name}</td>
                      <td className="px-4 py-3">
                        ${bin.pack?.game_price.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {bin.pack?.pack_number}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {bin.pack?.starting_serial}
                      </td>
                      <td className="px-4 py-3 font-mono min-w-[5.5rem]">
                        {/* In manual entry mode, show editable inputs for unscanned bins */}
                        {manualEntryState.isActive && !isScanned && bin.pack ? (
                          <div className="flex flex-col gap-1">
                            <Input
                              ref={(el) => setManualInputRef(bin.bin_id, el)}
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              maxLength={3}
                              value={manualValue}
                              onChange={(e) =>
                                handleManualEndingChange(
                                  bin.bin_id,
                                  e.target.value,
                                )
                              }
                              onBlur={() =>
                                handleManualInputBlur(
                                  bin.bin_id,
                                  bin.bin_number,
                                  manualValue,
                                  {
                                    starting_serial: bin.pack!.starting_serial,
                                    serial_end: bin.pack!.serial_end,
                                  },
                                )
                              }
                              onClick={(e) => e.stopPropagation()}
                              placeholder="000"
                              disabled={isSubmitting}
                              className={cn(
                                "w-16 h-8 text-center font-mono font-bold text-sm",
                                hasError
                                  ? "border-red-500 bg-red-50 dark:bg-red-950/20 focus:border-red-500 focus:ring-red-500"
                                  : manualValue.length === 3
                                    ? "border-green-500 bg-green-50 dark:bg-green-950/20"
                                    : "border-amber-500 bg-amber-50/50 dark:bg-amber-950/20",
                              )}
                              data-testid={`manual-ending-input-${bin.bin_id}`}
                              aria-label={`Ending serial for bin ${bin.bin_number}`}
                              aria-invalid={hasError}
                            />
                          </div>
                        ) : isScanned ||
                          (manualEntryState.isActive &&
                            manualValue.length === 3) ? (
                          <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400 font-bold min-w-[4rem]">
                            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                            {isScanned
                              ? scannedBin.closing_serial
                              : manualValue}
                          </span>
                        ) : (
                          <span className="inline-block min-w-[4rem] text-muted-foreground">
                            ---
                          </span>
                        )}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right",
                          hasValidEntry ? "" : "text-muted-foreground",
                        )}
                      >
                        {hasValidEntry ? ticketsSold : "-"}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right font-semibold",
                          hasValidEntry
                            ? "text-green-600 dark:text-green-400"
                            : "text-muted-foreground",
                        )}
                      >
                        {hasValidEntry ? `$${salesAmount.toFixed(2)}` : "-"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
            {/* Show footer when we have any valid entries (scanned or manual) */}
            {(scannedBins.length > 0 ||
              (manualEntryState.isActive &&
                Object.keys(manualEndingValues).some(
                  // eslint-disable-next-line security/detect-object-injection -- Object key from Object.keys is safe
                  (id) => manualEndingValues[id]?.length === 3,
                ))) && (
              <tfoot className="bg-muted/50 font-semibold">
                <tr>
                  <td colSpan={6} className="px-4 py-3 text-right">
                    Total Lottery Sales:
                  </td>
                  <td className="px-4 py-3 text-right">
                    {/* Calculate total tickets sold from all sources */}
                    {activeBins.reduce((total, bin) => {
                      if (!bin.pack) return total;
                      const scannedBin = scannedBins.find(
                        (s) => s.bin_id === bin.bin_id,
                      );
                      let closingSerial: string | undefined;
                      if (scannedBin) {
                        closingSerial = scannedBin.closing_serial;
                      } else if (
                        manualEntryState.isActive &&
                        manualEndingValues[bin.bin_id]?.length === 3
                      ) {
                        closingSerial = manualEndingValues[bin.bin_id];
                      }
                      if (!closingSerial) return total;
                      // Check if bin was marked sold out - use depletion formula
                      const isSoldOut = scannedBin?.is_sold_out === true;
                      // Serial difference: tickets_sold = ending - starting (normal)
                      // Depletion: tickets_sold = (serial_end + 1) - starting
                      const ticketsSold = isSoldOut
                        ? calculateTicketsSoldForDepletion(
                            closingSerial,
                            bin.pack.starting_serial,
                          )
                        : calculateTicketsSold(
                            closingSerial,
                            bin.pack.starting_serial,
                          );
                      return total + ticketsSold;
                    }, 0)}
                  </td>
                  <td className="px-4 py-3 text-right text-lg text-green-600 dark:text-green-400">
                    ${calculateTotalSales.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* All Scanned Success Banner (scan mode only) */}
        {!manualEntryState.isActive && allBinsScanned && (
          <div
            className="px-6 py-3 bg-green-50 dark:bg-green-950/20 border-t border-green-200 dark:border-green-800"
            data-testid="all-scanned-banner"
          >
            <p className="text-center font-medium text-green-700 dark:text-green-400 flex items-center justify-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              All bins scanned - Ready to close lottery
            </p>
          </div>
        )}

        {/* Manual Entry Ready Banner */}
        {manualEntryState.isActive && canCloseManualEntry && (
          <div
            className="px-6 py-3 bg-green-50 dark:bg-green-950/20 border-t border-green-200 dark:border-green-800"
            data-testid="manual-entry-ready-banner"
          >
            <p className="text-center font-medium text-green-700 dark:text-green-400 flex items-center justify-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              All ending serials entered - Ready to close lottery
            </p>
          </div>
        )}

        {/* ============================================================================
         * DEPLETED & ACTIVATED PACKS SECTIONS
         * Enterprise close-to-close business day model
         *
         * MCP Guidance Applied:
         * - FE-001: STATE_MANAGEMENT - Props passed from parent, no local state needed
         * - SEC-014: INPUT_VALIDATION - Components handle null/empty gracefully
         * - SEC-004: XSS - React auto-escapes all output in child components
         * ============================================================================ */}
        {(returnedPacks && returnedPacks.length > 0) ||
        (depletedPacks && depletedPacks.length > 0) ||
        (activatedPacks && activatedPacks.length > 0) ? (
          <div
            className="px-6 py-4 space-y-4 border-t"
            data-testid="packs-sections-container"
          >
            {/* Returned Packs Section - Before Depleted Packs */}
            {returnedPacks && returnedPacks.length > 0 && (
              <ReturnedPacksSection
                returnedPacks={returnedPacks}
                openBusinessPeriod={openBusinessPeriod}
                defaultOpen={false}
              />
            )}

            {/* Depleted Packs Section */}
            {depletedPacks && depletedPacks.length > 0 && (
              <DepletedPacksSection
                depletedPacks={depletedPacks}
                openBusinessPeriod={openBusinessPeriod}
                defaultOpen={false}
              />
            )}

            {/* Activated Packs Section */}
            {activatedPacks && activatedPacks.length > 0 && (
              <ActivatedPacksSection
                activatedPacks={activatedPacks}
                openBusinessPeriod={openBusinessPeriod}
                defaultOpen={false}
              />
            )}
          </div>
        ) : null}

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t bg-muted/30 flex justify-between items-center">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isSubmitting}
            data-testid="cancel-day-close-button"
          >
            <X className="mr-2 h-4 w-4" />
            Cancel
          </Button>

          {/* Submit button area - shows different buttons based on state */}
          <div className="flex items-center gap-2">
            {/* Show warning button when bins have no ending serial */}
            {binsWithoutEnding.length > 0 && !isSubmitting && (
              <Button
                onClick={handleProceedWithUnscannedBins}
                variant="outline"
                className="border-amber-500 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                data-testid="resolve-unscanned-bins-button"
              >
                <AlertTriangle className="mr-2 h-4 w-4" />
                {binsWithoutEnding.length} Bin
                {binsWithoutEnding.length > 1 ? "s" : ""} Need Attention
              </Button>
            )}

            {/* Submit button - different behavior for scan vs manual mode */}
            {manualEntryState.isActive ? (
              <Button
                onClick={handleManualSubmit}
                disabled={isSubmitting || !canCloseManualEntry}
                data-testid="close-lottery-manual-button"
                className={cn(
                  canCloseManualEntry
                    ? "bg-green-600 hover:bg-green-700 text-white"
                    : "",
                )}
              >
                {isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Close Lottery (Manual)
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !allBinsScanned}
                data-testid="close-lottery-button"
                className={cn(
                  allBinsScanned
                    ? "bg-green-600 hover:bg-green-700 text-white"
                    : "",
                )}
              >
                {isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Close Lottery & Continue
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Manual Entry Auth Modal */}
      <ManualEntryAuthModal
        open={manualEntryAuthModalOpen}
        onOpenChange={setManualEntryAuthModalOpen}
        storeId={storeId}
        onAuthorized={handleManualEntryAuthorized}
      />

      {/* Validation Error Modal */}
      <Dialog
        open={validationErrorModal.open}
        onOpenChange={(open) =>
          setValidationErrorModal((prev) => ({ ...prev, open }))
        }
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Invalid Ending Serial
            </DialogTitle>
            <DialogDescription>
              {validationErrorModal.binNumber !== null && (
                <span className="block mb-2 font-semibold">
                  Bin #{validationErrorModal.binNumber}
                </span>
              )}
              {validationErrorModal.message}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() =>
                setValidationErrorModal({
                  open: false,
                  binNumber: null,
                  message: "",
                })
              }
              data-testid="validation-error-modal-ok-button"
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unscanned Bin Warning Modal */}
      <UnscannedBinWarningModal
        open={unscannedBinWarningModal.open}
        onOpenChange={(open) =>
          setUnscannedBinWarningModal((prev) => ({ ...prev, open }))
        }
        unscannedBins={unscannedBinWarningModal.unscannedBins}
        onConfirm={handleUnscannedBinModalResult}
        onCancel={() =>
          setUnscannedBinWarningModal({ open: false, unscannedBins: [] })
        }
      />
    </div>
  );
}
