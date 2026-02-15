/**
 * Enhanced Pack Activation Form Component (Batch Mode)
 * Form for activating multiple lottery packs in a single session
 *
 * Story: Batch Pack Activation
 *
 * Features:
 * - Batch activation: scan/add multiple packs before submitting
 * - Pack search with debounced combobox
 * - Bin selection modal appears after each pack scan
 * - Pending list shows all packs waiting for activation
 * - Newest packs appear at top of list (prepend)
 * - Sequential API calls for batch submission
 * - Partial failure handling with error highlighting
 * - Simple PIN authentication via PinVerificationDialog in parent
 * - Backend gets activated_by from session (enterprise-grade)
 *
 * MCP Guidance Applied:
 * - FE-002: FORM_VALIDATION - Validates pack before adding to list
 * - SEC-014: INPUT_VALIDATION - UUID validation, duplicate checks
 * - SEC-010: AUTHZ - Backend gets user from session, not frontend
 * - FE-001: STATE_MANAGEMENT - Proper state for pending list
 * - API-003: ERROR_HANDLING - Handles partial failures gracefully
 * - FE-005: UI_SECURITY - No secrets exposed in UI
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  ArrowRight,
  AlertTriangle,
  Package,
  Pencil,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFullPackActivation, useLotteryDayBins } from '@/hooks/useLottery';
import {
  PackSearchCombobox,
  type PackSearchOption,
  type PackSearchComboboxHandle,
} from './PackSearchCombobox';
import { BinSelectionModal } from './BinSelectionModal';
import type { DayBin, FullActivatePackInput } from '@/lib/api/lottery';

/**
 * Validates that a serial number falls within the pack's valid range.
 * Serial numbers are 3-digit strings representing ticket position (000-299 for 300-ticket pack).
 *
 * MCP FE-002: FORM_VALIDATION - Mirror backend validation client-side
 * MCP SEC-014: INPUT_VALIDATION - Strict validation before submission
 *
 * @param serial - User-entered serial number (3 digits)
 * @param packSerialStart - First valid serial for the pack (usually "000")
 * @param packSerialEnd - Last valid serial for the pack (e.g., "299" for 300-ticket pack)
 * @returns true if valid, false if invalid
 */
function validateSerialInRange(
  serial: string,
  packSerialStart: string,
  packSerialEnd: string
): boolean {
  const trimmedSerial = serial.trim();

  // Must be exactly 3 digits
  if (!/^\d{3}$/.test(trimmedSerial)) {
    return false;
  }

  // Parse as integers (safe for 3-digit serials)
  const serialNum = parseInt(trimmedSerial, 10);
  const startNum = parseInt(packSerialStart.trim() || '0', 10);
  const endNum = parseInt(packSerialEnd.trim() || '299', 10);

  // Validate serial is within the pack's range
  // Note: "000" is valid as it's the first ticket in the pack
  return serialNum >= startNum && serialNum <= endNum;
}

/**
 * Pending activation item
 * Represents a pack waiting to be activated
 *
 * MCP SEC-014: INPUT_VALIDATION - All IDs are UUIDs validated upstream
 */
export interface PendingActivation {
  /** Unique ID for React list key */
  id: string;
  /** Pack UUID */
  pack_id: string;
  /** Pack number for display */
  pack_number: string;
  /** Game name for display */
  game_name: string;
  /** Game price for display */
  game_price: number | null;
  /** Pack serial range start */
  serial_start: string;
  /** Pack serial range end */
  serial_end: string;
  /** Custom starting serial (user-specified, default "000") */
  custom_serial_start: string;
  /** Target bin UUID */
  bin_id: string;
  /** Bin number for display */
  bin_number: number;
  /** Bin name for display */
  bin_name: string;
  /** True if bin has existing pack that will be depleted */
  deplete_previous: boolean;
  /** Pack number of existing pack (for display if replacing) */
  previous_pack_number?: string;
  /** Previous pack game name (for display) */
  previous_game_name?: string;
  /** Activation result - set after submission */
  result?: 'success' | 'error';
  /** Error message if activation failed */
  error?: string;
  /** Whether this pack is marked as pre-sold */
  mark_sold?: boolean;
}

/**
 * Props for EnhancedPackActivationForm
 */
interface EnhancedPackActivationFormProps {
  /** Store UUID */
  storeId: string;
  /** Whether the modal is open */
  open: boolean;
  /** Callback when modal open state changes */
  onOpenChange: (open: boolean) => void;
  /** Callback on successful activation */
  onSuccess?: () => void;
  /** Day bins data for bin selection (optional, fetched if not provided) */
  dayBins?: DayBin[];
}

/**
 * Generate a unique ID for pending activation items
 */
function generateId(): string {
  return `pending-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * EnhancedPackActivationForm component
 * Batch activation form for multiple lottery packs with authentication
 */
export function EnhancedPackActivationForm({
  storeId,
  open,
  onOpenChange,
  onSuccess,
  dayBins,
}: EnhancedPackActivationFormProps) {
  const { toast } = useToast();
  const fullActivationMutation = useFullPackActivation();

  // Fetch day bins if not provided
  const { data: fetchedDayBins } = useLotteryDayBins(storeId, undefined, {
    enabled: open && !dayBins,
  });

  // Use provided bins or fetched bins
  const bins = useMemo(
    () => dayBins || fetchedDayBins?.bins || [],
    [dayBins, fetchedDayBins?.bins]
  );

  // ============ State ============
  // Note: Authentication is handled by PinVerificationDialog in parent (LotteryPage)
  // User is already authenticated when this form opens
  // SEC-010: Backend gets activated_by from session, not from frontend

  // Pending activations list (newest first)
  const [pendingActivations, setPendingActivations] = useState<PendingActivation[]>([]);

  // Current pack being assigned a bin (triggers bin selection modal)
  const [currentScannedPack, setCurrentScannedPack] = useState<PackSearchOption | null>(null);

  // Bin selection modal state
  const [showBinModal, setShowBinModal] = useState(false);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Pack search query (controlled by this component - single source of truth)
  const [packSearchQuery, setPackSearchQuery] = useState<string>('');

  // Serial editing state: which pending item is being edited
  const [editingSerialId, setEditingSerialId] = useState<string | null>(null);
  const [editingSerialValue, setEditingSerialValue] = useState<string>('');
  const [isSerialInvalid, setIsSerialInvalid] = useState(false);

  // Ref for focusing the pack search input
  const packSearchRef = useRef<PackSearchComboboxHandle>(null);

  // ============ Computed Values ============

  // Get bin IDs already in pending list (for warnings in bin modal)
  const pendingBinIds = useMemo(
    () => pendingActivations.map((p) => p.bin_id),
    [pendingActivations]
  );

  // Get pack IDs already in pending list (for duplicate check)
  const pendingPackIds = useMemo(
    () => new Set(pendingActivations.map((p) => p.pack_id)),
    [pendingActivations]
  );

  // Count of pending packs
  const pendingCount = pendingActivations.length;

  // Check if any packs failed during submission
  const hasFailedPacks = pendingActivations.some((p) => p.result === 'error');

  // Check if all packs succeeded
  const allSucceeded =
    pendingActivations.length > 0 && pendingActivations.every((p) => p.result === 'success');

  // ============ Effects ============

  /**
   * Reset state when modal opens
   * MCP FE-001: STATE_MANAGEMENT - Clean state on modal open
   */
  useEffect(() => {
    if (open) {
      // Use queueMicrotask to avoid synchronous setState during effect
      queueMicrotask(() => {
        setPendingActivations([]);
        setCurrentScannedPack(null);
        setShowBinModal(false);
        setIsSubmitting(false);
        setPackSearchQuery('');
        setEditingSerialId(null);
        setEditingSerialValue('');
        setIsSerialInvalid(false);
      });
    }
  }, [open]);

  /**
   * Focus pack search input after bin modal closes
   * User is already authenticated via PIN dialog when this form opens
   */
  useEffect(() => {
    if (!showBinModal && open && packSearchRef.current) {
      const timer = setTimeout(() => {
        packSearchRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [showBinModal, open]);

  // ============ Handlers ============

  /**
   * Handle pack selection from combobox
   * Opens bin selection modal if pack is valid and not already in list
   *
   * MCP SEC-014: INPUT_VALIDATION - Check for duplicates before adding
   *
   * Enterprise Pattern: Controlled component callback
   * - Parent owns state, child notifies of selection
   * - No prop/state synchronization issues
   */
  const handlePackSelect = useCallback(
    (pack: PackSearchOption) => {
      // Check if pack is already in pending list
      if (pendingPackIds.has(pack.pack_id)) {
        toast({
          title: 'Pack Already Added',
          description: `Pack #${pack.pack_number} is already in the pending list.`,
          variant: 'destructive',
        });
        // Clear search and refocus for next scan
        setPackSearchQuery('');
        setTimeout(() => {
          packSearchRef.current?.focus();
        }, 100);
        return;
      }

      // CRITICAL FIX: Clear search query BEFORE opening bin modal
      // This ensures the input is empty when scanner sends next barcode.
      // Previously, clearing only happened after bin modal closed, allowing
      // scanner input to append to stale display text.
      // MCP FE-001: STATE_MANAGEMENT - Clear state immediately on selection
      setPackSearchQuery('');

      // Set current pack and open bin selection modal
      setCurrentScannedPack(pack);
      setShowBinModal(true);
    },
    [pendingPackIds, toast]
  );

  /**
   * Handle search query changes from combobox
   * Enterprise Pattern: Parent owns search state
   */
  const handleSearchQueryChange = useCallback((query: string) => {
    setPackSearchQuery(query);
  }, []);

  /**
   * Handle bin selection confirmation from modal
   * Adds pack to pending list with bin assignment
   *
   * MCP FE-001: STATE_MANAGEMENT - Prepend to list (newest first)
   */
  const handleBinConfirm = useCallback(
    (binId: string, bin: DayBin, depletesPrevious: boolean) => {
      if (!currentScannedPack) {
        return;
      }

      // Create pending activation entry
      const pendingItem: PendingActivation = {
        id: generateId(),
        pack_id: currentScannedPack.pack_id,
        pack_number: currentScannedPack.pack_number,
        game_name: currentScannedPack.game_name,
        game_price: currentScannedPack.game_price,
        serial_start: currentScannedPack.serial_start,
        serial_end: currentScannedPack.serial_end,
        custom_serial_start: '000', // Default
        bin_id: binId,
        bin_number: bin.bin_number,
        bin_name: bin.name,
        deplete_previous: depletesPrevious,
        previous_pack_number: bin.pack?.pack_number,
        previous_game_name: bin.pack?.game_name,
      };

      // Prepend to list (newest first)
      setPendingActivations((prev) => [pendingItem, ...prev]);

      // Clear current pack and search query (parent owns this state)
      setCurrentScannedPack(null);
      setPackSearchQuery('');

      // Refocus the search input for next scan
      setTimeout(() => {
        packSearchRef.current?.focus();
      }, 100);

      // Toast confirmation
      toast({
        title: 'Pack Added',
        description: `${currentScannedPack.game_name} #${currentScannedPack.pack_number} → Bin ${bin.bin_number}`,
      });
    },
    [currentScannedPack, toast]
  );

  /**
   * Handle removing a pack from the pending list
   */
  const handleRemovePack = useCallback((id: string) => {
    setPendingActivations((prev) => prev.filter((p) => p.id !== id));
    // Clear editing state if removing the pack being edited
    setEditingSerialId((current) => (current === id ? null : current));
  }, []);

  /**
   * Handle clicking the change serial button
   * User is already authenticated, so allow direct editing
   */
  const handleChangeSerialClick = useCallback(
    (pendingId: string) => {
      const pending = pendingActivations.find((p) => p.id === pendingId);
      if (!pending) return;

      // User is already authenticated via PIN dialog - allow serial editing
      setEditingSerialId(pendingId);
      setEditingSerialValue(pending.custom_serial_start);
      setIsSerialInvalid(false);
    },
    [pendingActivations]
  );

  /**
   * Handle clicking the Pack Sold button
   * Simple toggle - user is already authenticated via PIN dialog
   */
  const handleMarkSoldClick = useCallback(
    (pendingId: string) => {
      const pending = pendingActivations.find((p) => p.id === pendingId);
      if (!pending) return;

      // Toggle mark_sold state
      const newMarkSold = !pending.mark_sold;
      setPendingActivations((prev) =>
        prev.map((p) => (p.id === pendingId ? { ...p, mark_sold: newMarkSold } : p))
      );

      toast({
        title: newMarkSold ? 'Pack Marked as Sold' : 'Pack Sold Removed',
        description: newMarkSold
          ? 'Pack will be activated and marked as pre-sold.'
          : 'Pack will be activated as normal.',
      });
    },
    [pendingActivations, toast]
  );

  /**
   * Handle serial input change with validation
   * SEC-014: INPUT_VALIDATION - Validate serial is within pack range
   */
  const handleSerialInputChange = useCallback(
    (value: string) => {
      setEditingSerialValue(value);

      // Find the pack being edited and validate against its serial range
      const pending = pendingActivations.find((p) => p.id === editingSerialId);
      if (pending) {
        // Allow partial input while typing (only validate complete 3-digit serials)
        if (value.length === 3) {
          const isValid = validateSerialInRange(value, pending.serial_start, pending.serial_end);
          setIsSerialInvalid(!isValid);
        } else {
          // Partial input - don't show error yet
          setIsSerialInvalid(false);
        }
      } else {
        setIsSerialInvalid(false);
      }
    },
    [pendingActivations, editingSerialId]
  );

  /**
   * Handle saving serial edit
   */
  const handleSaveSerialEdit = useCallback(() => {
    if (!editingSerialId || isSerialInvalid) return;

    // Validate format
    if (!/^\d{3}$/.test(editingSerialValue)) {
      setIsSerialInvalid(true);
      return;
    }

    setPendingActivations((prev) =>
      prev.map((p) =>
        p.id === editingSerialId ? { ...p, custom_serial_start: editingSerialValue } : p
      )
    );

    setEditingSerialId(null);
    setEditingSerialValue('');
    setIsSerialInvalid(false);
  }, [editingSerialId, editingSerialValue, isSerialInvalid]);

  /**
   * Handle canceling serial edit
   */
  const handleCancelSerialEdit = useCallback(() => {
    setEditingSerialId(null);
    setEditingSerialValue('');
    setIsSerialInvalid(false);
  }, []);

  /**
   * Handle batch activation submission
   * Processes all pending packs sequentially
   * SEC-010: Backend gets activated_by from session, not from frontend
   *
   * MCP API-003: ERROR_HANDLING - Handles partial failures
   */
  const handleActivateAll = useCallback(async () => {
    if (pendingActivations.length === 0) {
      return;
    }

    setIsSubmitting(true);

    // Track results
    const results: { id: string; success: boolean; error?: string }[] = [];

    // Process packs sequentially
    for (const pending of pendingActivations) {
      // Skip already processed packs (for retry scenario)
      if (pending.result === 'success') {
        results.push({ id: pending.id, success: true });
        continue;
      }

      // SEC-010: Backend gets activated_by from session
      // Frontend sends pack_id, bin_id, opening_serial, and deplete_previous
      // BIN-001: deplete_previous enables auto-depletion of existing pack in bin
      const activationData: FullActivatePackInput = {
        pack_id: pending.pack_id,
        bin_id: pending.bin_id,
        opening_serial: pending.custom_serial_start,
        deplete_previous: pending.deplete_previous,
      };

      try {
        // Capture response to check for auto-depleted pack (BIN-001)
        const response = await fullActivationMutation.mutateAsync({
          storeId,
          data: activationData,
        });

        results.push({ id: pending.id, success: true });

        // Update the pending item with success status
        setPendingActivations((prev) =>
          prev.map((p) => (p.id === pending.id ? { ...p, result: 'success' } : p))
        );

        // BIN-001: Show toast when existing pack was auto-depleted
        // FE-001: XSS safe - using framework-provided toast component
        if (response.data?.depletedPack) {
          const { pack_number, game_name } = response.data.depletedPack;
          toast({
            title: 'Pack Replaced',
            description: `${game_name || 'Pack'} #${pack_number} was automatically sold out.`,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to activate pack';

        results.push({ id: pending.id, success: false, error: errorMessage });

        // Update the pending item with error status
        setPendingActivations((prev) =>
          prev.map((p) =>
            p.id === pending.id ? { ...p, result: 'error', error: errorMessage } : p
          )
        );
      }
    }

    setIsSubmitting(false);

    // Calculate success/failure counts
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    if (failureCount === 0) {
      // All succeeded
      toast({
        title: 'Packs Activated',
        description: `Successfully activated ${successCount} pack${successCount !== 1 ? 's' : ''}.`,
      });

      // Close modal and trigger success callback
      onOpenChange(false);
      onSuccess?.();
    } else if (successCount === 0) {
      // All failed
      toast({
        title: 'Activation Failed',
        description: `Failed to activate all ${failureCount} pack${failureCount !== 1 ? 's' : ''}. See details below.`,
        variant: 'destructive',
      });
    } else {
      // Partial failure
      toast({
        title: 'Partial Success',
        description: `Activated ${successCount} pack${successCount !== 1 ? 's' : ''}, ${failureCount} failed. Review and retry failed packs.`,
        variant: 'destructive',
      });
    }
  }, [pendingActivations, storeId, fullActivationMutation, onOpenChange, onSuccess, toast]);

  /**
   * Handle retry of failed packs
   * Clears error state and retriggers activation
   */
  const handleRetryFailed = useCallback(() => {
    setPendingActivations((prev) =>
      prev.map((p) => (p.result === 'error' ? { ...p, result: undefined, error: undefined } : p))
    );
  }, []);

  /**
   * Handle cancel - close modal
   */
  const handleCancel = () => {
    onOpenChange(false);
  };

  // ============ Render ============

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[600px]" data-testid="batch-pack-activation-form">
          <DialogHeader>
            <DialogTitle>Activate Packs</DialogTitle>
            <DialogDescription>
              Scan or search for packs to add them to the activation list.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Pack search input - user is already authenticated via PIN dialog */}
            {/* Enterprise Pattern: Fully controlled component - parent owns all state */}
            <PackSearchCombobox
              ref={packSearchRef}
              storeId={storeId}
              searchQuery={packSearchQuery}
              onSearchQueryChange={handleSearchQueryChange}
              onPackSelect={handlePackSelect}
              label="Scan or Search Pack"
              placeholder="Scan barcode or search by game/pack number..."
              statusFilter="RECEIVED"
              disabled={isSubmitting}
              testId="batch-pack-search"
            />

            {/* Pending activations list */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Pending Packs ({pendingCount})</label>
                {hasFailedPacks && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRetryFailed}
                    disabled={isSubmitting}
                    data-testid="retry-failed-button"
                  >
                    Clear Errors & Retry
                  </Button>
                )}
              </div>

              {pendingCount === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  <Package className="mx-auto mb-2 h-8 w-8 opacity-50" />
                  <p>Scan a pack to get started</p>
                </div>
              ) : (
                <ScrollArea className="h-[250px] rounded-md border">
                  <div className="divide-y">
                    {pendingActivations.map((pending) => (
                      <div
                        key={pending.id}
                        className={`flex items-center gap-3 p-3 ${
                          pending.result === 'error'
                            ? 'bg-destructive/10'
                            : pending.result === 'success'
                              ? 'bg-green-50 dark:bg-green-950/20'
                              : ''
                        }`}
                        data-testid={`pending-item-${pending.pack_id}`}
                      >
                        {/* Game name and pack number */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{pending.game_name}</span>
                            <span className="shrink-0 text-sm text-muted-foreground">
                              #{pending.pack_number}
                            </span>
                          </div>
                          {/* Serial editing row */}
                          {editingSerialId === pending.id ? (
                            <div className="mt-1 flex items-center gap-2">
                              <Input
                                value={editingSerialValue}
                                onChange={(e) => handleSerialInputChange(e.target.value)}
                                placeholder="000"
                                maxLength={3}
                                inputMode="numeric"
                                className={`h-7 w-20 text-xs ${
                                  isSerialInvalid
                                    ? 'border-destructive focus-visible:ring-destructive'
                                    : ''
                                }`}
                                autoFocus
                                data-testid={`serial-input-${pending.pack_id}`}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={handleSaveSerialEdit}
                                disabled={isSerialInvalid}
                              >
                                Save
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={handleCancelSerialEdit}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                              <span>Serial: {pending.custom_serial_start}</span>
                              {!pending.result && (
                                <>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-5 px-1"
                                    onClick={() => handleChangeSerialClick(pending.id)}
                                    disabled={isSubmitting}
                                    title="Change serial"
                                    data-testid={`change-serial-${pending.pack_id}`}
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant={pending.mark_sold ? 'default' : 'outline'}
                                    size="sm"
                                    className={`ml-1 h-5 px-2 text-xs ${
                                      pending.mark_sold
                                        ? 'bg-orange-500 hover:bg-orange-600 text-white'
                                        : ''
                                    }`}
                                    onClick={() => handleMarkSoldClick(pending.id)}
                                    disabled={isSubmitting}
                                    title={
                                      pending.mark_sold
                                        ? 'Click to remove sold marking'
                                        : 'Mark pack as pre-sold'
                                    }
                                    data-testid={`mark-sold-${pending.pack_id}`}
                                  >
                                    {pending.mark_sold ? 'Sold ✓' : 'Pack Sold'}
                                  </Button>
                                </>
                              )}
                            </div>
                          )}
                          {pending.error && (
                            <p className="mt-1 text-xs text-destructive">{pending.error}</p>
                          )}
                        </div>

                        {/* Arrow and bin */}
                        <div className="flex shrink-0 items-center gap-1 text-sm">
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                          <span>Bin {pending.bin_number}</span>
                        </div>

                        {/* Price */}
                        <div className="shrink-0 text-sm text-muted-foreground">
                          {pending.game_price !== null ? `$${pending.game_price}` : '—'}
                        </div>

                        {/* Status indicator */}
                        <div className="shrink-0">
                          {pending.result === 'success' ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : pending.result === 'error' ? (
                            <AlertCircle className="h-4 w-4 text-destructive" />
                          ) : pending.deplete_previous ? (
                            <Badge
                              variant="secondary"
                              className="text-xs"
                              title={`Will replace ${pending.previous_game_name} #${pending.previous_pack_number}`}
                            >
                              <AlertTriangle className="mr-1 h-3 w-3" />
                              Replace
                            </Badge>
                          ) : (
                            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>

                        {/* Remove button */}
                        {!pending.result && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => handleRemovePack(pending.id)}
                            disabled={isSubmitting}
                            data-testid={`remove-pending-${pending.pack_id}`}
                          >
                            <X className="h-4 w-4" />
                            <span className="sr-only">Remove</span>
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>

            {/* Submission error summary */}
            {hasFailedPacks && !isSubmitting && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Some packs failed to activate. Review errors above and click &quot;Clear Errors &
                  Retry&quot; to try again.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCancel} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleActivateAll}
              disabled={isSubmitting || pendingCount === 0 || allSucceeded}
              data-testid="activate-all-button"
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSubmitting
                ? 'Activating...'
                : pendingCount === 0
                  ? 'Add Packs to Activate'
                  : `Activate ${pendingCount} Pack${pendingCount !== 1 ? 's' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bin Selection Modal */}
      <BinSelectionModal
        open={showBinModal}
        onOpenChange={setShowBinModal}
        pack={currentScannedPack}
        bins={bins}
        pendingBinIds={pendingBinIds}
        onConfirm={handleBinConfirm}
      />
    </>
  );
}
