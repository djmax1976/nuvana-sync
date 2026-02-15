/**
 * Terminals Page
 *
 * Shows all registers identified during onboarding with their active shift status.
 * Registers are sourced from pos_terminal_mappings table and joined with shift data.
 *
 * Route: /terminals
 *
 * @module renderer/pages/TerminalsPage
 * @security SEC-014: Uses IPC layer for data access
 * @security DB-006: All data is store-scoped via IPC handlers
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  Monitor,
  Loader2,
  AlertCircle,
  Clock,
  User,
  CheckCircle2,
  Play,
  StopCircle,
  Moon,
} from 'lucide-react';
import {
  storesAPI,
  terminalsAPI,
  shiftsAPI,
  type RegisterWithShiftStatus,
  type ShiftClosedEvent,
  type ManualStartShiftParams,
  type DayStatusResponse,
} from '../lib/api/ipc-client';
import { usePOSConnectionType } from '../hooks/usePOSConnectionType';
import { useToast } from '../hooks/use-toast';
import { ShiftStartDialog, type ShiftStartResult } from '../components/shifts/ShiftStartDialog';

/**
 * Props for RegisterCard component
 */
interface RegisterCardProps {
  register: RegisterWithShiftStatus;
  /** Recent shift close event for this register (if any) */
  closedEvent?: ShiftClosedEvent;
  /** Callback when user initiates close flow */
  onNavigateToClose?: (event: ShiftClosedEvent) => void;
  /** Total number of registers with active shifts (for day close determination) */
  totalActiveShifts?: number;
  /** Whether the store is in MANUAL mode */
  isManualMode?: boolean;
  /** Callback to start a manual shift */
  onManualStartShift?: (register: RegisterWithShiftStatus) => void;
  /** Callback to end a manual shift */
  onManualEndShift?: (register: RegisterWithShiftStatus) => void;
  /** Whether a manual start is in progress for this register */
  isStartingShift?: boolean;
}

/**
 * Register card component displaying register info and shift status
 * Shows registers identified during onboarding with their current shift state
 *
 * When a shift is recently closed (closedEvent present), displays:
 * - Amber highlight border/background to draw attention
 * - "Ready for Day Close" or "Shift Just Closed" badge
 * - Close time information
 * - Primary action button to navigate to wizard
 */
function RegisterCard({
  register,
  closedEvent,
  onNavigateToClose,
  totalActiveShifts = 0,
  isManualMode = false,
  onManualStartShift,
  onManualEndShift,
  isStartingShift = false,
}: RegisterCardProps) {
  const navigate = useNavigate();

  const handleViewShifts = () => {
    // Navigate to shifts page with register filter
    navigate('/shifts', { state: { registerId: register.external_register_id } });
  };

  const handleViewActiveShift = () => {
    if (register.activeShift) {
      navigate(`/shifts/${register.activeShift.shift_id}`);
    }
  };

  const handleCompleteClose = () => {
    if (closedEvent && onNavigateToClose) {
      onNavigateToClose(closedEvent);
    }
  };

  // Generate display name: use description if set, otherwise format from external_register_id
  const displayName =
    register.description ||
    (register.external_register_id === '1'
      ? 'Main Register'
      : `Register ${register.external_register_id}`);

  // Determine if this card should show the "just closed" highlight
  // Show when closedEvent is present AND no active shift (shift has been closed)
  const showClosedHighlight = closedEvent && !register.activeShift;

  // Format the close time for display
  const formatCloseTime = (isoString: string): string => {
    try {
      return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'Unknown';
    }
  };

  return (
    <Card
      className={`transition-colors ${
        showClosedHighlight
          ? 'border-amber-500 border-2 bg-amber-50 dark:bg-amber-950/20 shadow-lg shadow-amber-100 dark:shadow-amber-900/20'
          : 'hover:border-primary/50'
      }`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <Monitor className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
            <span className="truncate">{displayName}</span>
          </CardTitle>
          {register.activeShift ? (
            <Badge variant="default" className="bg-green-600 text-xs flex-shrink-0">
              Shift Open
            </Badge>
          ) : showClosedHighlight ? (
            <Badge
              variant="default"
              className="bg-amber-500 text-amber-950 dark:text-amber-50 animate-pulse text-xs flex-shrink-0"
            >
              {closedEvent.closeType === 'DAY_CLOSE' ? 'Day Close' : 'Shift Closed'}
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs flex-shrink-0">
              No Shift
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {register.activeShift ? (
          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>
                Shift #{register.activeShift.shift_number} - Started{' '}
                {register.activeShift.start_time
                  ? new Date(register.activeShift.start_time).toLocaleTimeString()
                  : 'N/A'}
              </span>
            </div>
            {register.activeShift.cashier_id && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="h-4 w-4" />
                <span>Cashier ID: {register.activeShift.cashier_id}</span>
              </div>
            )}
          </div>
        ) : showClosedHighlight ? (
          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
              <CheckCircle2 className="h-4 w-4" />
              <span>
                Shift #{closedEvent.shiftNumber} closed at {formatCloseTime(closedEvent.closedAt)}
              </span>
            </div>
            {closedEvent.remainingOpenShifts > 0 && (
              <p className="text-xs text-muted-foreground">
                {closedEvent.remainingOpenShifts} other shift
                {closedEvent.remainingOpenShifts !== 1 ? 's' : ''} still open today
              </p>
            )}
            {closedEvent.isLastShiftOfDay && (
              <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                This is the last shift of the day - ready for day close
              </p>
            )}
          </div>
        ) : null}

        <div className="flex gap-2">
          {register.activeShift ? (
            <Button
              onClick={handleViewActiveShift}
              className="flex-1 text-xs sm:text-sm"
              variant="default"
            >
              View Active Shift
            </Button>
          ) : showClosedHighlight ? (
            <Button
              onClick={handleCompleteClose}
              className="flex-1 bg-amber-500 hover:bg-amber-600 text-amber-950 text-xs sm:text-sm"
              variant="default"
            >
              {closedEvent.closeType === 'DAY_CLOSE'
                ? 'Complete Day Close'
                : 'Complete Shift Close'}
            </Button>
          ) : null}
        </div>

        {/* Manual Mode: Start/End Shift Buttons */}
        {isManualMode && (
          <div className="mt-3 pt-3 border-t border-dashed border-blue-300 dark:border-blue-700">
            <div className="flex gap-2">
              {register.activeShift ? (
                <Button
                  onClick={() => onManualEndShift?.(register)}
                  variant="destructive"
                  className="flex-1 text-xs sm:text-sm"
                >
                  <StopCircle className="mr-2 h-4 w-4" />
                  End Shift
                </Button>
              ) : (
                <Button
                  onClick={() => onManualStartShift?.(register)}
                  disabled={isStartingShift}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white text-xs sm:text-sm"
                >
                  {isStartingShift ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  {isStartingShift ? 'Starting...' : 'Start Shift'}
                </Button>
              )}
            </div>
          </div>
        )}

        {register.openShiftCount > 1 && (
          <p className="text-xs text-muted-foreground mt-3 text-center">
            {register.openShiftCount} open shifts on this register
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function TerminalsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Track recently closed shifts by external register ID
  // Map<externalRegisterId, ShiftClosedEvent>
  const [recentlyClosedShifts, setRecentlyClosedShifts] = useState<Map<string, ShiftClosedEvent>>(
    new Map()
  );

  // Track which register is currently starting a shift (for loading state)
  const [startingShiftRegisterId, setStartingShiftRegisterId] = useState<string | null>(null);

  // State for shift start dialog
  const [shiftStartDialogOpen, setShiftStartDialogOpen] = useState(false);
  const [selectedRegisterForStart, setSelectedRegisterForStart] =
    useState<RegisterWithShiftStatus | null>(null);
  const [shiftStartError, setShiftStartError] = useState<string | null>(null);

  // Check if store is in MANUAL mode
  const { data: posConnectionData } = usePOSConnectionType();
  const isManualMode = posConnectionData?.connectionType === 'MANUAL';

  // Get store info via IPC
  const {
    data: storeInfo,
    isLoading: storeLoading,
    isError: storeError,
  } = useQuery({
    queryKey: ['stores', 'info'],
    queryFn: () => storesAPI.getInfo(),
    retry: 1,
  });

  // Get all registers with their active shift status
  // This queries pos_terminal_mappings joined with shifts
  const {
    data: terminalsData,
    isLoading: terminalsLoading,
    isError: terminalsError,
  } = useQuery({
    queryKey: ['terminals', 'list'],
    queryFn: () => terminalsAPI.list(),
    retry: 1,
  });

  /**
   * Get day status from backend - AUTHORITATIVE source for day close visibility
   *
   * BUSINESS RULE: The Day Close button should ONLY be rendered when
   * hasOpenShifts === true. This MUST come from the backend, NOT computed
   * locally from frontend data.
   *
   * @security DB-006: Backend enforces store-scoped tenant isolation
   */
  const { data: dayStatusData } = useQuery<DayStatusResponse>({
    queryKey: ['terminals', 'dayStatus'],
    queryFn: () => terminalsAPI.getDayStatus(),
    retry: 1,
    // Only fetch when in manual mode (day close button only shows in manual mode)
    enabled: isManualMode,
  });

  // Manual start shift mutation
  const startShiftMutation = useMutation({
    mutationFn: (params: ManualStartShiftParams) => shiftsAPI.manualStart(params),
    onSuccess: () => {
      // Invalidate both terminals list and day status to reflect new shift
      queryClient.invalidateQueries({ queryKey: ['terminals', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['terminals', 'dayStatus'] });
      toast({
        title: 'Shift Started',
        description: 'New shift is now open',
      });
      // Close dialog and reset state
      setShiftStartDialogOpen(false);
      setSelectedRegisterForStart(null);
      setStartingShiftRegisterId(null);
      setShiftStartError(null);
    },
    onError: (error: Error) => {
      // Show error in dialog (not toast) so user can retry with correct PIN
      setShiftStartError(error.message);
      setStartingShiftRegisterId(null);
    },
  });

  /**
   * Handle navigation to the appropriate close wizard
   * Clears the highlight for this register after navigation
   *
   * For DAY_CLOSE:
   * - DayCloseAccessGuard handles PIN verification and access control
   * - Guard provides validated shift/user data via context
   * - No state needed in navigation
   *
   * For SHIFT_CLOSE:
   * - Navigates to shift-end wizard with shift context
   * - Shift context is needed for the wizard to load the correct shift
   *
   * @security SEC-010: Day close authorization enforced by backend via guard
   */
  const handleNavigateToClose = useCallback(
    (event: ShiftClosedEvent) => {
      // Clear the highlight for this register
      setRecentlyClosedShifts((prev) => {
        const next = new Map(prev);
        if (event.externalRegisterId) {
          next.delete(event.externalRegisterId);
        }
        return next;
      });

      // Navigate to appropriate wizard based on close type
      if (event.closeType === 'DAY_CLOSE') {
        // Guard handles all validation and context - just navigate
        navigate('/day-close');
      } else {
        // Shift-end wizard still needs shift context
        navigate('/shift-end', {
          state: {
            shiftId: event.shiftId,
            businessDate: event.businessDate,
          },
        });
      }
    },
    [navigate]
  );

  /**
   * MANUAL MODE: Start a shift manually
   * Opens dialog for cashier selection and PIN entry
   */
  const handleManualStartShift = useCallback((register: RegisterWithShiftStatus) => {
    setSelectedRegisterForStart(register);
    setShiftStartError(null);
    setShiftStartDialogOpen(true);
  }, []);

  /**
   * Handle shift start from dialog
   * Called when cashier is authenticated via PIN
   */
  const handleShiftStartConfirm = useCallback(
    (result: ShiftStartResult) => {
      if (!selectedRegisterForStart) return;

      setStartingShiftRegisterId(selectedRegisterForStart.external_register_id);
      // Employee is identified by their unique PIN - no userId needed
      startShiftMutation.mutate({
        pin: result.pin,
        externalRegisterId: selectedRegisterForStart.external_register_id,
      });
    },
    [selectedRegisterForStart, startShiftMutation]
  );

  /**
   * Close the shift start dialog
   */
  const handleShiftStartDialogClose = useCallback(() => {
    setShiftStartDialogOpen(false);
    setSelectedRegisterForStart(null);
    setShiftStartError(null);
  }, []);

  /**
   * MANUAL MODE: End a shift manually
   * Always navigates to shift-end wizard (not day close)
   */
  const handleManualEndShift = useCallback(
    (register: RegisterWithShiftStatus) => {
      if (!register.activeShift) {
        console.warn('[TerminalsPage] Cannot end shift - no active shift');
        return;
      }

      const activeShift = register.activeShift;

      // End Shift always goes to shift-end wizard
      // Day Close is a separate action via the Day Close button
      navigate('/shift-end', {
        state: {
          shiftId: activeShift.shift_id,
          businessDate: activeShift.business_date,
          isManualMode: true, // Flag for manual data entry
        },
      });
    },
    [navigate]
  );

  /**
   * MANUAL MODE: Start the day close process
   *
   * Navigates to day-close wizard. The DayCloseAccessGuard handles:
   * - PIN verification and user authentication
   * - Shift condition validation (exactly one open shift)
   * - Access control (shift owner or manager override)
   * - Providing validated shift/user data via context
   *
   * @see DayCloseAccessGuard for access validation logic
   * @security SEC-010: Authorization enforced by backend via guard
   */
  const handleManualDayClose = useCallback(() => {
    // Guard handles all validation and context - just navigate
    navigate('/day-close');
  }, [navigate]);

  /**
   * Subscribe to shift closed events from the main process
   * When a shift is closed via POS XML detection:
   * 1. Invalidate the terminals query to refresh shift status
   * 2. Invalidate the day status query to update Day Close button visibility
   * 3. Add the event to recentlyClosedShifts to show the highlight
   */
  useEffect(() => {
    const unsubscribe = terminalsAPI.onShiftClosed((event: ShiftClosedEvent) => {
      // Invalidate terminals query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['terminals', 'list'] });
      // Invalidate day status to update Day Close button visibility (backend-driven)
      queryClient.invalidateQueries({ queryKey: ['terminals', 'dayStatus'] });

      // Add to recently closed shifts map (keyed by external register ID)
      if (event.externalRegisterId) {
        setRecentlyClosedShifts((prev) => {
          const next = new Map(prev);
          next.set(event.externalRegisterId!, event);
          return next;
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [queryClient]);

  // Loading state
  if (storeLoading || terminalsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading registers...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (storeError || terminalsError) {
    return (
      <div className="space-y-6" data-testid="terminals-page">
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p>Failed to load register data. Please try again.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Get registers from API response
  const registers = terminalsData?.registers || [];

  // Count active shifts
  const activeShiftCount = registers.filter((r) => r.activeShift !== null).length;

  const storeName = storeInfo?.name || 'Store';

  return (
    <div className="space-y-6" data-testid="terminals-page">
      {/*
        Day Close button - ONLY rendered when backend confirms open shifts exist

        BUSINESS RULE: Button visibility is determined by backend's hasOpenShifts flag.
        This ensures the UI accurately reflects server-side business state.
        DO NOT compute this locally - always use backend-provided dayStatusData.

        @security DB-006: Backend enforces store-scoped tenant isolation
      */}
      {isManualMode && dayStatusData?.hasOpenShifts && (
        <div className="flex justify-end">
          <Button
            onClick={handleManualDayClose}
            variant="outline"
            className="border-amber-500 text-amber-700 hover:bg-amber-100 dark:border-amber-400 dark:text-amber-400 dark:hover:bg-amber-900/30"
          >
            <Moon className="mr-2 h-4 w-4" />
            Day Close
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Monitor className="h-6 w-6" />
            Registers
          </h1>
          <p className="text-muted-foreground mt-1">
            {storeName} - {registers.length} register
            {registers.length !== 1 ? 's' : ''}
            {activeShiftCount > 0 && (
              <span className="ml-2 text-green-600">
                ({activeShiftCount} active shift
                {activeShiftCount !== 1 ? 's' : ''})
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Registers Grid */}
      {registers.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">
              No registers found. Registers are identified when POS data is first synced during
              onboarding. Ensure your store has been configured and data has been processed.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {registers.map((register) => (
            <RegisterCard
              key={register.id}
              register={register}
              closedEvent={recentlyClosedShifts.get(register.external_register_id)}
              onNavigateToClose={handleNavigateToClose}
              totalActiveShifts={activeShiftCount}
              isManualMode={isManualMode}
              onManualStartShift={handleManualStartShift}
              onManualEndShift={handleManualEndShift}
              isStartingShift={startingShiftRegisterId === register.external_register_id}
            />
          ))}
        </div>
      )}

      {/* Shift Start Dialog */}
      <ShiftStartDialog
        open={shiftStartDialogOpen}
        registerName={
          selectedRegisterForStart?.description ||
          `Register ${selectedRegisterForStart?.external_register_id || ''}`
        }
        onClose={handleShiftStartDialogClose}
        onStart={handleShiftStartConfirm}
        isLoading={startShiftMutation.isPending}
        error={shiftStartError}
      />
    </div>
  );
}
