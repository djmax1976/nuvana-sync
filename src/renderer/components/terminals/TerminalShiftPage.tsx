/**
 * Terminal Shift Page Content Component
 *
 * Story 4.92: Terminal Shift Page
 *
 * Displays shift information including:
 * - Cashier name
 * - Shift start time
 * - Shift number
 * - Starting cash (read-only, set during shift start)
 * - Placeholder metrics (Total Sales, Tax, Voids)
 * - End Shift button (placeholder)
 *
 * @security
 * - SEC-001: Requires authenticated cashier session
 * - FE-001: No sensitive data exposed in UI
 */

import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DollarSign, Receipt, XCircle, CalendarCheck } from 'lucide-react';

/**
 * Props for TerminalShiftPageContent
 *
 * @property shift - Shift data including ID, timing, and cash information
 * @property cashierName - Display name of the authenticated cashier
 * @property terminalName - Human-readable terminal name for display
 *
 * @security
 * - SEC-014: Input validation - shift_id validated as UUID by backend
 * - FE-001: No sensitive data (tokens, passwords) in props
 */
interface TerminalShiftPageContentProps {
  shift: {
    shift_id: string;
    cashier_id: string;
    opened_at: string;
    shift_number: number | null;
    opening_cash: number;
  };
  cashierName: string;
  terminalName: string;
}

/**
 * Format currency for display
 * @param amount - Numeric amount to format
 * @returns Formatted currency string
 */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * TerminalShiftPageContent component
 *
 * Displays shift information with starting cash shown as read-only.
 * Starting cash is now set during shift start in the auth modal
 * and cannot be modified once the shift has begun.
 *
 * @security
 * - SEC-001: Requires authenticated cashier session
 * - FE-001: Session token managed via context, not exposed in UI
 */
export function TerminalShiftPageContent({
  shift,
  cashierName,
  terminalName,
}: TerminalShiftPageContentProps) {
  const navigate = useNavigate();

  // Format shift start date and time combined
  const shiftStartDateTime = format(new Date(shift.opened_at), "MMM d, yyyy 'at' h:mm a");

  // Format shift number for display
  const shiftNumberDisplay = shift.shift_number ? `#${shift.shift_number}` : null;

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header - Terminal Name and Shift Number */}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">{terminalName}</h1>
        {shiftNumberDisplay && (
          <span className="text-lg text-muted-foreground">Shift {shiftNumberDisplay}</span>
        )}
      </div>

      {/* Shift Information - Compact Single Line with Starting Cash */}
      <Card className="border-muted">
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
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
              <span className="font-semibold text-green-600">
                {formatCurrency(shift.opening_cash)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Metrics Card */}
      <Card>
        <CardHeader>
          <CardTitle>Transaction Metrics</CardTitle>
          <CardDescription>
            Placeholder metrics (will be populated from 3rd party POS)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Total Sales */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">Total Sales</p>
              </div>
              <p className="text-2xl font-bold">$0.00</p>
            </div>

            {/* Total Tax Collected */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">Total Tax Collected</p>
              </div>
              <p className="text-2xl font-bold">$0.00</p>
            </div>

            {/* Total Voids */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">Total Voids</p>
              </div>
              <p className="text-2xl font-bold">$0.00</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions Card */}
      <Card>
        <CardHeader>
          <CardTitle>Shift Actions</CardTitle>
          <CardDescription>Manage your shift</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col md:flex-row gap-3">
          <Button
            variant="outline"
            onClick={() => {
              navigate(`/mystore/shift-end?shiftId=${shift.shift_id}`);
            }}
            className="w-full md:w-auto"
            data-testid="end-shift-button"
          >
            End Shift
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              // Navigate to Day Close Wizard
              // The wizard has 3 steps: Lottery Close, Report Scanning, Day Close
              navigate(`/mystore/day-close?shiftId=${shift.shift_id}`);
            }}
            className="w-full md:w-auto"
            data-testid="close-day-button"
          >
            <CalendarCheck className="mr-2 h-4 w-4" />
            Close Day
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
