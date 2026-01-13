
/**
 * Bin Selector Component
 * Dropdown for selecting a bin from store's configured bins
 *
 * Story: Pack Activation UX Enhancement
 *
 * Features:
 * - Shows all bins for the store
 * - Indicates if bin is currently occupied
 * - Shows bin name and number
 * - Info message when selecting occupied bin (existing pack will be marked as sold)
 *
 * MCP Guidance Applied:
 * - FE-002: FORM_VALIDATION - Controlled component with validation
 * - SEC-014: INPUT_VALIDATION - UUID validation for bin_id
 * - SEC-004: XSS - React auto-escapes output
 */

import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { DayBin } from "@/lib/api/lottery";

export interface BinSelectorProps {
  /** Available bins from day bins data */
  bins: DayBin[];
  /** Selected bin_id */
  value?: string;
  /** Callback when bin selection changes */
  onValueChange: (binId: string, bin: DayBin | null) => void;
  /** Label for the field */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Error message */
  error?: string;
  /** Test ID for the select element */
  testId?: string;
}

/**
 * BinSelector component
 * Dropdown for selecting a bin with occupation status indication
 */
export function BinSelector({
  bins,
  value,
  onValueChange,
  label = "Target Bin",
  placeholder = "Select a bin...",
  disabled = false,
  error,
  testId,
}: BinSelectorProps) {
  // Find selected bin
  const selectedBin = useMemo(
    () => bins.find((b) => b.bin_id === value) || null,
    [bins, value],
  );

  // Check if selected bin is occupied
  const isOccupied = selectedBin?.pack !== null;

  const handleChange = (binId: string) => {
    const bin = bins.find((b) => b.bin_id === binId) || null;
    onValueChange(binId, bin);
  };

  return (
    <div className="space-y-2">
      {label && <Label htmlFor="bin-select">{label}</Label>}

      <Select value={value} onValueChange={handleChange} disabled={disabled}>
        <SelectTrigger
          id="bin-select"
          className={error ? "border-red-500 focus:ring-red-500" : undefined}
          data-testid={testId}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent data-testid={testId ? `${testId}-dropdown` : undefined}>
          {bins.length === 0 ? (
            <div className="p-2 text-center text-sm text-muted-foreground">
              No bins configured
            </div>
          ) : (
            bins.map((bin) => {
              const hasActivePack = bin.pack !== null;
              return (
                <SelectItem
                  key={bin.bin_id}
                  value={bin.bin_id}
                  data-testid={
                    testId ? `${testId}-option-${bin.bin_id}` : undefined
                  }
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Bin {bin.bin_number}</span>
                    {hasActivePack && (
                      <Badge variant="secondary" className="ml-2 text-xs">
                        {bin.pack?.game_name} #{bin.pack?.pack_number}
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              );
            })
          )}
        </SelectContent>
      </Select>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Info when selected bin is occupied - existing pack will be marked as sold */}
      {isOccupied && selectedBin && (
        <Alert className="mt-2" data-testid="occupied-bin-warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Bin {selectedBin.bin_number} currently has{" "}
            <strong>{selectedBin.pack?.game_name}</strong> (Pack #
            {selectedBin.pack?.pack_number}). It will be marked as sold.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
