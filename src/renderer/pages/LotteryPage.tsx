
import { useState, useMemo, useCallback } from "react";
import { useClientAuth } from "@/contexts/ClientAuthContext";
import { useClientDashboard } from "@/lib/api/client-dashboard";
import {
  Loader2,
  AlertCircle,
  Plus,
  Zap,
  PenLine,
  X,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useLotteryPacks,
  usePackReception,
  usePackDetails,
  useInvalidateLottery,
  useLotteryDayBins,
} from "@/hooks/useLottery";
import {
  DayBinsTable,
  type BinValidationError,
} from "@/components/lottery/DayBinsTable";
import { validateManualEntryEnding } from "@/lib/services/lottery-closing-validation";
import { DepletedPacksSection } from "@/components/lottery/DepletedPacksSection";
import { ReturnedPacksSection } from "@/components/lottery/ReturnedPacksSection";
import { ActivatedPacksSection } from "@/components/lottery/ActivatedPacksSection";
import { PackReceptionForm } from "@/components/lottery/PackReceptionForm";
import { EnhancedPackActivationForm } from "@/components/lottery/EnhancedPackActivationForm";
import {
  PackDetailsModal,
  type PackDetailsData,
} from "@/components/lottery/PackDetailsModal";
import { ManualEntryAuthModal } from "@/components/lottery/ManualEntryAuthModal";
import { MarkSoldOutDialog } from "@/components/lottery/MarkSoldOutDialog";
import { ManualEntryIndicator } from "@/components/lottery/ManualEntryIndicator";
import { ReturnPackDialog } from "@/components/lottery/ReturnPackDialog";
import {
  receivePack,
  closeLotteryDay,
  type LotteryPackResponse,
} from "@/lib/api/lottery";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2 } from "lucide-react";
import {
  formatBusinessDateFull,
  formatDateTimeShort,
} from "@/utils/date-format.utils";
import { useStoreTimezone } from "@/contexts/StoreContext";

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
 * - Keep Receive Pack and Activate Pack buttons
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

  // ========================================================================
  // HOOKS
  // MCP: FE-001 STATE_MANAGEMENT - Access store timezone for date formatting
  // ========================================================================
  const storeTimezone = useStoreTimezone();

  // Dialog state management
  const [receptionDialogOpen, setReceptionDialogOpen] = useState(false);
  const [activationDialogOpen, setActivationDialogOpen] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // Mark Sold Out dialog state
  const [markSoldOutDialogOpen, setMarkSoldOutDialogOpen] = useState(false);
  const [packIdToMarkSoldOut, setPackIdToMarkSoldOut] = useState<string | null>(
    null,
  );

  /**
   * Return Pack dialog state
   * MCP: FE-001 STATE_MANAGEMENT - Controlled dialog state with pack ID and data tracking
   * MCP: SEC-010 AUTHZ - ACTIVE and RECEIVED packs can be returned (enforced in dialog)
   */
  const [returnPackDialogOpen, setReturnPackDialogOpen] = useState(false);
  const [packIdToReturn, setPackIdToReturn] = useState<string | null>(null);
  const [packDataToReturn, setPackDataToReturn] =
    useState<LotteryPackResponse | null>(null);

  // Manual entry state management
  const [manualEntryAuthModalOpen, setManualEntryAuthModalOpen] =
    useState(false);
  const [manualEntryState, setManualEntryState] = useState<ManualEntryState>({
    isActive: false,
    authorizedBy: null,
    authorizedAt: null,
  });

  // Manual entry values - keyed by bin_id
  const [manualEndingValues, setManualEndingValues] = useState<
    Record<string, string>
  >({});

  // Validation errors for manual entry - keyed by bin_id
  const [validationErrors, setValidationErrors] = useState<
    Record<string, BinValidationError>
  >({});

  // Submission state for manual entry close day
  const [isSubmittingManualClose, setIsSubmittingManualClose] = useState(false);

  // Get first active store ID from user's accessible stores
  const storeId =
    dashboardData?.stores.find((s) => s.status === "ACTIVE")?.store_id ||
    dashboardData?.stores[0]?.store_id;

  // Fetch day bins data for the new table view
  const {
    data: dayBinsData,
    isLoading: dayBinsLoading,
    isError: dayBinsError,
    error: dayBinsErrorObj,
  } = useLotteryDayBins(storeId);

  // Fetch lottery packs for checking if there are RECEIVED packs (for button state)
  const { data: packs } = useLotteryPacks(storeId, { status: "RECEIVED" });

  // Fetch pack details when selected
  const { data: packDetails, isLoading: packDetailsLoading } = usePackDetails(
    selectedPackId,
    { enabled: !!selectedPackId && detailsDialogOpen },
  );

  // Mutations
  const packReceptionMutation = usePackReception();
  const { invalidateAll } = useInvalidateLottery();

  // Check if there are received packs for the Activate Pack button state
  const hasReceivedPacks = useMemo(() => {
    return (packs?.length ?? 0) > 0;
  }, [packs]);

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
    setSuccessMessage("Pack marked as sold out successfully");
    setTimeout(() => setSuccessMessage(null), 5000);
  }, [invalidateAll]);

  /**
   * Handle Return Pack button click
   * Opens the ReturnPackDialog for the selected pack
   * Finds pack data from day bins to provide immediate display without extra API call
   *
   * MCP Guidance Applied:
   * - FE-001: STATE_MANAGEMENT - Controlled dialog state with pack data
   * - SEC-014: INPUT_VALIDATION - Pack ID validated by dialog before API call
   * - SEC-010: AUTHZ - ACTIVE and RECEIVED packs can be returned (enforced server-side)
   */
  const handleReturnPackClick = useCallback(
    (packId: string) => {
      // Find the pack data from day bins to avoid extra API call
      const bin = dayBinsData?.bins.find((b) => b.pack?.pack_id === packId);
      if (bin?.pack) {
        // Transform DayBinPack to LotteryPackResponse format for the dialog
        const packData: LotteryPackResponse = {
          pack_id: bin.pack.pack_id,
          game_id: "", // Not needed for display, dialog uses game.name and game.price
          pack_number: bin.pack.pack_number,
          opening_serial: bin.pack.starting_serial,
          closing_serial: bin.pack.serial_end,
          status: "ACTIVATED", // Pack in bins is always ACTIVATED
          store_id: storeId || "",
          bin_id: bin.bin_id,
          received_at: "", // Not needed for display
          activated_at: null,
          settled_at: null,
          returned_at: null,
          game: {
            game_id: "",
            game_code: "",
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
      setReturnPackDialogOpen(true);
    },
    [dayBinsData?.bins, storeId],
  );

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
    setSuccessMessage("Pack returned successfully");
    setTimeout(() => setSuccessMessage(null), 5000);
  }, [invalidateAll]);

  const handlePackReception = async (
    data: Parameters<typeof receivePack>[0],
  ) => {
    try {
      await packReceptionMutation.mutateAsync(data);
      invalidateAll(); // Invalidate all lottery data including day bins
      setReceptionDialogOpen(false);
      setSuccessMessage("Pack received successfully");
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (error) {
      throw error; // Error handling is done in the form component
    }
  };

  /**
   * Handle successful pack activation
   * Called by EnhancedPackActivationForm onSuccess
   */
  const handleActivationSuccess = useCallback(() => {
    invalidateAll(); // Invalidate all lottery data including day bins
    setSuccessMessage("Pack activated successfully");
    setTimeout(() => setSuccessMessage(null), 5000);
  }, [invalidateAll]);

  /**
   * Handle Manual Entry button click
   * Opens the auth modal for PIN verification
   */
  const handleManualEntryClick = useCallback(() => {
    setManualEntryAuthModalOpen(true);
  }, []);

  /**
   * Handle Manual Entry authorization success
   * Called when user successfully verifies with LOTTERY_MANUAL_ENTRY permission
   */
  const handleManualEntryAuthorized = useCallback(
    (authorizedBy: { userId: string; name: string }) => {
      setManualEntryState({
        isActive: true,
        authorizedBy,
        authorizedAt: new Date(),
      });
      setManualEntryAuthModalOpen(false);

      // Clear any previous manual entry values and validation errors
      setManualEndingValues({});
      setValidationErrors({});

      toast({
        title: "Manual Entry Enabled",
        description: `Authorized by ${authorizedBy.name}. You can now enter ending serial numbers.`,
      });
    },
    [toast],
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
      title: "Manual Entry Cancelled",
      description: "Manual entry mode has been deactivated.",
    });
  }, [toast]);

  /**
   * Handle ending value change in manual entry mode
   * Called when user types in an ending serial input
   */
  const handleEndingValueChange = useCallback(
    (binId: string, value: string) => {
      setManualEndingValues((prev) => ({
        ...prev,
        [binId]: value,
      }));
    },
    [],
  );

  /**
   * Handle input complete (3 digits entered)
   * Can be used for audio feedback or other UX enhancements
   */
  const handleInputComplete = useCallback((binId: string) => {
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
      packData: { starting_serial: string; serial_end: string },
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
            [binId]: { message: result.error || "Invalid ending number" },
          };
        }
      });
    },
    [],
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
  }, [
    manualEntryState.isActive,
    dayBinsData?.bins,
    manualEndingValues,
    validationErrors,
  ]);

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

      // Submit to API with MANUAL entry method
      const response = await closeLotteryDay(storeId, {
        closings,
        entry_method: "MANUAL",
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
          title: "Lottery Closed Successfully",
          description: `Closed ${response.data.closings_created} pack(s) for business day ${response.data.business_day}`,
        });

        setSuccessMessage("Lottery closed successfully via manual entry");
        setTimeout(() => setSuccessMessage(null), 5000);
      } else {
        throw new Error("Failed to close lottery");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to close lottery";
      toast({
        title: "Close Lottery Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsSubmittingManualClose(false);
    }
  }, [
    canCloseManualEntry,
    storeId,
    dayBinsData?.bins,
    manualEndingValues,
    invalidateAll,
    toast,
  ]);

  // ============ RENDER ============
  // Loading state - waiting for auth or dashboard data
  if (authLoading || dashboardLoading) {
    return (
      <div className="space-y-6" data-testid="lottery-management-page">
        <div className="space-y-1">
          <h1 className="text-heading-2 font-bold text-foreground">
            Lottery Management
          </h1>
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
          <h1 className="text-heading-2 font-bold text-foreground">
            Lottery Management
          </h1>
          <p className="text-destructive">
            Failed to load store information:{" "}
            {dashboardErrorObj?.message || "Unknown error"}
          </p>
        </div>
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-sm font-medium text-destructive">
              Error loading dashboard
            </p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {dashboardErrorObj instanceof Error
              ? dashboardErrorObj.message
              : "An unknown error occurred"}
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
          <h1 className="text-heading-2 font-bold text-foreground">
            Lottery Management
          </h1>
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

  // Get store name and current date for subtitle
  // Use centralized timezone-aware utilities to avoid timezone drift issues
  const storeName =
    dashboardData?.stores.find((s) => s.store_id === storeId)?.name ||
    "your store";
  const currentDate = dayBinsData?.business_day?.date
    ? formatBusinessDateFull(dayBinsData.business_day.date)
    : formatBusinessDateFull(new Date().toISOString().split("T")[0]);

  // Format day start time if available using centralized utility
  const dayStartTime = dayBinsData?.business_day?.first_shift_opened_at
    ? formatDateTimeShort(
        dayBinsData.business_day.first_shift_opened_at,
        storeTimezone,
      )
    : null;

  // Convert pack details to modal format
  // Note: Convert null to undefined for location since PackDetailsData expects string | undefined
  const packDetailsForModal: PackDetailsData | null = packDetails
    ? ({
        pack_id: packDetails.pack_id,
        pack_number: packDetails.pack_number,
        serial_start: packDetails.serial_start,
        serial_end: packDetails.serial_end,
        status: packDetails.status,
        game: packDetails.game || {
          game_id: packDetails.game_id,
          name: "Unknown Game",
        },
        bin: packDetails.bin
          ? {
              bin_id: packDetails.bin.bin_id,
              name: packDetails.bin.name,
              location: packDetails.bin.location ?? undefined,
            }
          : null,
        received_at: packDetails.received_at,
        activated_at: packDetails.activated_at,
        depleted_at: packDetails.depleted_at ?? undefined,
        returned_at: packDetails.returned_at ?? undefined,
        tickets_remaining: packDetails.tickets_remaining,
        shift_openings: packDetails.shift_openings?.map((o) => ({
          opening_id: o.opening_id,
          shift_id: o.shift_id,
          opening_serial: o.opening_serial,
          created_at: o.opened_at, // API uses opened_at, component expects created_at
        })),
        shift_closings: packDetails.shift_closings?.map((c) => ({
          closing_id: c.closing_id,
          shift_id: c.shift_id,
          closing_serial: c.closing_serial,
          opening_serial: c.opening_serial,
          expected_count: c.expected_count,
          actual_count: c.actual_count,
          difference: c.difference,
          has_variance: c.has_variance,
          created_at: c.closed_at, // API uses closed_at, component expects created_at
        })),
      } as PackDetailsData)
    : null;

  return (
    <div className="space-y-6" data-testid="lottery-management-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-heading-2 font-bold text-foreground">
            Lottery Management
          </h1>
          <p className="text-muted-foreground">
            {storeName} &bull; {currentDate}
          </p>
          {dayStartTime && (
            <p className="text-sm text-muted-foreground">
              Day started: {dayStartTime}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setReceptionDialogOpen(true)}
            data-testid="receive-pack-button"
            disabled={manualEntryState.isActive}
          >
            <Plus className="mr-2 h-4 w-4" />
            Receive Pack
          </Button>

          {/* Manual Entry Button - Shows Cancel when active */}
          {manualEntryState.isActive ? (
            <Button
              onClick={handleCancelManualEntry}
              variant="destructive"
              data-testid="cancel-manual-entry-button"
            >
              <X className="mr-2 h-4 w-4" />
              Cancel Manual Entry
            </Button>
          ) : (
            <Button
              onClick={handleManualEntryClick}
              variant="outline"
              data-testid="manual-entry-button"
              disabled={!dayBinsData?.bins.some((bin) => bin.pack !== null)}
            >
              <PenLine className="mr-2 h-4 w-4" />
              Manual Entry
            </Button>
          )}

          {/* Save & Close Lottery Button - Only shown in manual entry mode */}
          {manualEntryState.isActive && (
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

          <Button
            onClick={() => setActivationDialogOpen(true)}
            variant="outline"
            data-testid="activate-pack-button"
            disabled={!hasReceivedPacks || manualEntryState.isActive}
          >
            <Zap className="mr-2 h-4 w-4" />
            Activate Pack
          </Button>
        </div>
      </div>

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
          <span className="ml-2 text-sm text-muted-foreground">
            Loading bins...
          </span>
        </div>
      )}

      {/* Day Bins Table Error State */}
      {dayBinsError && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-sm font-medium text-destructive">
              Failed to load bins
            </p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {dayBinsErrorObj instanceof Error
              ? dayBinsErrorObj.message
              : "Please try refreshing the page."}
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
            No bins configured for this store. Contact your administrator to set
            up lottery bins.
          </p>
        </div>
      )}

      {/* Pack Reception Dialog */}
      <PackReceptionForm
        storeId={storeId}
        open={receptionDialogOpen}
        onOpenChange={setReceptionDialogOpen}
        onSuccess={() => {
          invalidateAll();
        }}
      />

      {/* Pack Activation Dialog - Enhanced with search, bin selection, and auth flow */}
      <EnhancedPackActivationForm
        storeId={storeId}
        open={activationDialogOpen}
        onOpenChange={setActivationDialogOpen}
        onSuccess={handleActivationSuccess}
        dayBins={dayBinsData?.bins}
      />

      {/* Pack Details Modal */}
      <PackDetailsModal
        pack={packDetailsForModal}
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        isLoading={packDetailsLoading}
      />

      {/* Manual Entry Auth Modal */}
      {storeId && (
        <ManualEntryAuthModal
          open={manualEntryAuthModalOpen}
          onOpenChange={setManualEntryAuthModalOpen}
          storeId={storeId}
          onAuthorized={handleManualEntryAuthorized}
        />
      )}

      {/* Mark Sold Out Dialog */}
      <MarkSoldOutDialog
        open={markSoldOutDialogOpen}
        onOpenChange={setMarkSoldOutDialogOpen}
        packId={packIdToMarkSoldOut}
        onSuccess={handleMarkSoldOutSuccess}
      />

      {/* Return Pack Dialog
          MCP Guidance Applied:
          - FE-001: STATE_MANAGEMENT - Controlled dialog with pack ID and data
          - FE-002: FORM_VALIDATION - Dialog validates all inputs before API call
          - SEC-014: INPUT_VALIDATION - Serial format and range validated
          - SEC-010: AUTHZ - ACTIVE and RECEIVED packs can be returned (enforced in dialog + server)
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
