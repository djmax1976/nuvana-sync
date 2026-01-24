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
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  FlaskConical,
} from 'lucide-react';
import {
  storesAPI,
  terminalsAPI,
  type RegisterWithShiftStatus,
  type ShiftClosedEvent,
} from '../lib/api/ipc-client';

// ============================================================================
// Test Mode Configuration
// Enable this flag to show the "Simulate Shift Close" button for testing
// without requiring actual 3rd party POS XML polling
// ============================================================================
const ENABLE_TEST_MODE = true; // Set to false in production

/**
 * Props for RegisterCard component
 */
interface RegisterCardProps {
  register: RegisterWithShiftStatus;
  /** Recent shift close event for this register (if any) */
  closedEvent?: ShiftClosedEvent;
  /** Callback when user initiates close flow */
  onNavigateToClose?: (event: ShiftClosedEvent) => void;
  /** Callback to simulate a shift close for testing */
  onSimulateClose?: (
    register: RegisterWithShiftStatus,
    closeType: 'SHIFT_CLOSE' | 'DAY_CLOSE'
  ) => void;
  /** Whether test mode is enabled */
  testModeEnabled?: boolean;
  /** Total number of registers with active shifts (for day close determination) */
  totalActiveShifts?: number;
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
  onSimulateClose,
  testModeEnabled,
  totalActiveShifts = 0,
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

  /**
   * Handle simulate shift close - for testing purposes
   * Determines if this should be a SHIFT_CLOSE or DAY_CLOSE based on
   * how many other registers have active shifts
   */
  const handleSimulateShiftClose = () => {
    if (onSimulateClose && register.activeShift) {
      // If this is the only active shift, it's a day close
      const closeType = totalActiveShifts <= 1 ? 'DAY_CLOSE' : 'SHIFT_CLOSE';
      onSimulateClose(register, closeType);
    }
  };

  const handleSimulateDayClose = () => {
    if (onSimulateClose && register.activeShift) {
      onSimulateClose(register, 'DAY_CLOSE');
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
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            {displayName}
          </CardTitle>
          {register.activeShift ? (
            <Badge variant="default" className="bg-green-600">
              Shift Open
            </Badge>
          ) : showClosedHighlight ? (
            <Badge
              variant="default"
              className="bg-amber-500 text-amber-950 dark:text-amber-50 animate-pulse"
            >
              {closedEvent.closeType === 'DAY_CLOSE' ? 'Ready for Day Close' : 'Shift Just Closed'}
            </Badge>
          ) : (
            <Badge variant="secondary">No Open Shift</Badge>
          )}
        </div>
        <CardDescription className="text-xs">
          Register ID: {register.external_register_id}
        </CardDescription>
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
        ) : (
          <div className="mb-4">
            <p className="text-sm text-muted-foreground">No open shift on this register</p>
          </div>
        )}

        <div className="flex gap-2">
          {register.activeShift ? (
            <Button onClick={handleViewActiveShift} className="flex-1" variant="default">
              View Active Shift
            </Button>
          ) : showClosedHighlight ? (
            <Button
              onClick={handleCompleteClose}
              className="flex-1 bg-amber-500 hover:bg-amber-600 text-amber-950"
              variant="default"
            >
              {closedEvent.closeType === 'DAY_CLOSE'
                ? 'Complete Day Close'
                : 'Complete Shift Close'}
            </Button>
          ) : (
            <Button onClick={handleViewShifts} className="flex-1" variant="outline">
              View Shift History
            </Button>
          )}
        </div>

        {/* Test Mode: Direct Navigation to Wizards - Always show when test mode enabled */}
        {testModeEnabled && (
          <div className="mt-3 pt-3 border-t border-dashed border-purple-300 dark:border-purple-700">
            <div className="flex items-center gap-1 mb-2">
              <FlaskConical className="h-3 w-3 text-purple-500" />
              <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
                Test Mode - Go directly to wizard
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() =>
                  navigate('/shift-end', {
                    state: {
                      shiftId: register.activeShift?.shift_id || 'test-shift-id',
                      businessDate:
                        register.activeShift?.business_date ||
                        new Date().toISOString().split('T')[0],
                    },
                  })
                }
                size="sm"
                variant="default"
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
              >
                Shift Close Wizard
              </Button>
              <Button
                onClick={() =>
                  navigate('/day-close', {
                    state: {
                      shiftId: register.activeShift?.shift_id || 'test-shift-id',
                      businessDate:
                        register.activeShift?.business_date ||
                        new Date().toISOString().split('T')[0],
                      fromShiftClose: true,
                    },
                  })
                }
                size="sm"
                variant="default"
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
              >
                Day Close Wizard
              </Button>
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

  // Track recently closed shifts by external register ID
  // Map<externalRegisterId, ShiftClosedEvent>
  const [recentlyClosedShifts, setRecentlyClosedShifts] = useState<Map<string, ShiftClosedEvent>>(
    new Map()
  );

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
   * Handle navigation to the appropriate close wizard
   * Clears the highlight for this register after navigation
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
        navigate('/day-close', {
          state: {
            shiftId: event.shiftId,
            businessDate: event.businessDate,
            fromShiftClose: true,
          },
        });
      } else {
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
   * TEST MODE: Simulate a shift close event without requiring actual POS XML polling
   *
   * This creates a synthetic ShiftClosedEvent and adds it to the recentlyClosedShifts map,
   * which triggers the same UI behavior as if the event came from the main process.
   *
   * Note: This does NOT actually close the shift in the database - it only simulates
   * the UI flow for testing the shift/day close wizards.
   */
  const handleSimulateClose = useCallback(
    (register: RegisterWithShiftStatus, closeType: 'SHIFT_CLOSE' | 'DAY_CLOSE') => {
      if (!register.activeShift) {
        console.warn('[TerminalsPage] Cannot simulate close - no active shift');
        return;
      }

      const activeShift = register.activeShift;

      // Create synthetic ShiftClosedEvent
      const simulatedEvent: ShiftClosedEvent = {
        closeType,
        shiftId: activeShift.shift_id,
        businessDate: activeShift.business_date,
        externalRegisterId: register.external_register_id,
        externalCashierId: activeShift.cashier_id || undefined,
        shiftNumber: activeShift.shift_number,
        closedAt: new Date().toISOString(),
        isLastShiftOfDay: closeType === 'DAY_CLOSE',
        remainingOpenShifts:
          closeType === 'DAY_CLOSE'
            ? 0
            : Math.max(
                0,
                (terminalsData?.registers?.filter((r) => r.activeShift !== null).length || 1) - 1
              ),
      };

      // Add to recently closed shifts map (same behavior as real event)
      setRecentlyClosedShifts((prev) => {
        const next = new Map(prev);
        next.set(register.external_register_id, simulatedEvent);
        return next;
      });
    },
    [terminalsData?.registers]
  );

  /**
   * Subscribe to shift closed events from the main process
   * When a shift is closed via POS XML detection:
   * 1. Invalidate the terminals query to refresh shift status
   * 2. Add the event to recentlyClosedShifts to show the highlight
   */
  useEffect(() => {
    const unsubscribe = terminalsAPI.onShiftClosed((event: ShiftClosedEvent) => {
      // Invalidate terminals query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['terminals', 'list'] });

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
      {/* Test Mode Banner */}
      {ENABLE_TEST_MODE && (
        <div className="bg-purple-100 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            <div>
              <p className="text-sm font-medium text-purple-800 dark:text-purple-200">
                Test Mode Enabled
              </p>
              <p className="text-xs text-purple-600 dark:text-purple-400">
                You can simulate shift/day close events without 3rd party POS connection. Look for
                the purple "Test Mode" section on each register card with an active shift.
              </p>
            </div>
          </div>
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
              onSimulateClose={handleSimulateClose}
              testModeEnabled={ENABLE_TEST_MODE}
              totalActiveShifts={activeShiftCount}
            />
          ))}
        </div>
      )}
    </div>
  );
}
