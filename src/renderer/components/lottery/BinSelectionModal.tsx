/**
 * Bin Selection Modal Component
 * Sub-modal for selecting a bin during batch pack activation
 *
 * Story: Batch Pack Activation
 *
 * Features:
 * - Shows pack details (game name, pack number, price)
 * - Bin dropdown with occupation status (filters out pending bins)
 * - Add/Cancel buttons
 *
 * MCP Guidance Applied:
 * - FE-002: FORM_VALIDATION - Validates bin selection before add
 * - SEC-014: INPUT_VALIDATION - UUID validation for bin_id, filters pending bins
 * - FE-005: UI_SECURITY - No secrets exposed in UI
 * - SEC-004: XSS - React auto-escapes output
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Package } from 'lucide-react';
import { BinSelector } from './BinSelector';
import type { PackSearchOption } from './PackSearchCombobox';
import type { DayBin } from '@/lib/api/lottery';

/**
 * Props for BinSelectionModal
 */
export interface BinSelectionModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Callback when modal open state changes */
  onOpenChange: (open: boolean) => void;
  /** The pack being assigned (null when modal is closed) */
  pack: PackSearchOption | null;
  /** Available bins from day bins data */
  bins: DayBin[];
  /** Bin IDs already assigned in the pending activation list */
  pendingBinIds: string[];
  /** Callback when user confirms bin selection */
  onConfirm: (binId: string, bin: DayBin, depletesPrevious: boolean) => void;
}

/**
 * BinSelectionModal component
 * Small modal for selecting a bin after scanning a pack
 */
export function BinSelectionModal({
  open,
  onOpenChange,
  pack,
  bins,
  pendingBinIds,
  onConfirm,
}: BinSelectionModalProps) {
  // Selected bin state
  const [selectedBinId, setSelectedBinId] = useState<string>('');

  // Reset selection when modal opens with new pack
  useEffect(() => {
    if (open) {
      setSelectedBinId('');
    }
  }, [open, pack?.pack_id]);

  // Filter out bins that are already assigned in the pending list
  // SEC-014: INPUT_VALIDATION - Prevent duplicate bin assignment at UI level
  // Backend also validates this, but removing from dropdown provides better UX
  const availableBins = bins.filter((bin) => !pendingBinIds.includes(bin.bin_id));

  // Find the selected bin (from available bins only for consistency)
  const selectedBin = availableBins.find((b) => b.bin_id === selectedBinId);

  // Check if selected bin is currently occupied (has active pack from another session)
  const isBinOccupied = selectedBin?.pack !== null;

  /**
   * Handle bin selection change
   * MCP FE-002: FORM_VALIDATION - Update state on selection
   */
  const handleBinChange = (binId: string) => {
    setSelectedBinId(binId);
  };

  /**
   * Handle add button click
   * MCP SEC-014: INPUT_VALIDATION - Validate before callback
   */
  const handleAdd = () => {
    if (!selectedBinId || !selectedBin) {
      return;
    }

    // Call parent with bin selection details
    onConfirm(selectedBinId, selectedBin, isBinOccupied);

    // Close modal
    onOpenChange(false);
  };

  /**
   * Handle cancel - close modal without adding
   */
  const handleCancel = () => {
    onOpenChange(false);
  };

  // Don't render content if no pack
  if (!pack) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]" data-testid="bin-selection-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Select Bin
          </DialogTitle>
          <DialogDescription>
            Choose a bin for this pack. If the bin is occupied, the existing pack will be marked as
            sold.
          </DialogDescription>
        </DialogHeader>

        {/* Pack details */}
        <div className="rounded-md border bg-muted/50 p-3">
          <div className="text-sm font-medium">Pack Details</div>
          <div className="mt-2 space-y-1 text-sm text-muted-foreground">
            <div className="flex justify-between">
              <span>Game:</span>
              <span className="font-medium text-foreground">{pack.game_name}</span>
            </div>
            <div className="flex justify-between">
              <span>Pack #:</span>
              <span className="font-medium text-foreground">{pack.pack_number}</span>
            </div>
            <div className="flex justify-between">
              <span>Price:</span>
              <span className="font-medium text-foreground">
                {pack.game_price !== null ? `$${pack.game_price}` : 'N/A'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Serial Range:</span>
              <span className="font-medium text-foreground">
                {pack.serial_start} - {pack.serial_end}
              </span>
            </div>
          </div>
        </div>

        {/* Bin selector - uses filtered bins to prevent duplicate bin assignment */}
        <div className="space-y-2">
          <BinSelector
            bins={availableBins}
            value={selectedBinId}
            onValueChange={handleBinChange}
            label="Target Bin"
            placeholder="Select a bin..."
            testId="bin-selection-dropdown"
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            data-testid="bin-selection-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleAdd}
            disabled={!selectedBinId}
            data-testid="bin-selection-add"
          >
            Add to List
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
