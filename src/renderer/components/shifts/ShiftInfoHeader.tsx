
/**
 * Shift Info Header Component
 *
 * Shared header component for shift closing workflows (Shift Close and Day Close).
 * Displays terminal name, shift number, cashier info, start time, and opening cash.
 *
 * @security
 * - SEC-014: INPUT_VALIDATION - shift_number is a business identifier, safe for display
 * - FE-001: STATE_MANAGEMENT - No sensitive data exposed in props
 * - FE-005: UI_SECURITY - No secrets or tokens displayed
 */

import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Format currency for display
 * @param amount - Numeric amount to format
 * @returns Formatted currency string
 *
 * @security SEC-014: Input validated as number, safe for display
 */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Props for ShiftInfoHeader component
 *
 * @property terminalName - Human-readable terminal name for display
 * @property shiftNumber - Sequential shift number (null if not assigned)
 * @property cashierName - Display name of the cashier
 * @property shiftStartTime - ISO 8601 timestamp when shift started
 * @property openingCash - Starting cash amount
 *
 * @security
 * - SEC-014: All values are business identifiers, safe for display
 * - FE-001: No sensitive tokens or passwords in props
 */
export interface ShiftInfoHeaderProps {
  terminalName: string;
  shiftNumber: number | null;
  cashierName: string;
  shiftStartTime: string;
  openingCash: number;
}

/**
 * ShiftInfoHeader component
 *
 * Displays shift information in a compact, consistent format across
 * both shift close and day close workflows.
 *
 * Layout:
 * - Single card with all info on one line: Terminal, Shift#, Cashier, Started, Opening Cash
 */
export function ShiftInfoHeader({
  terminalName,
  shiftNumber,
  cashierName,
  shiftStartTime,
  openingCash,
}: ShiftInfoHeaderProps) {
  // Format shift start date and time combined
  const shiftStartDateTime = format(
    new Date(shiftStartTime),
    "MMM d, yyyy 'at' h:mm a",
  );

  // Format shift number for display
  const shiftNumberDisplay = shiftNumber ? `#${shiftNumber}` : null;

  return (
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
          <div
            className="flex items-center gap-2"
            data-testid="opening-cash-display"
          >
            <span className="text-muted-foreground">Opening Cash:</span>
            <span className="font-semibold text-green-600">
              {formatCurrency(openingCash)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
