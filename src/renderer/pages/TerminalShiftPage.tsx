/**
 * Terminal Shift Page
 *
 * Entry point page for terminal shift management.
 * Displays shift information and provides buttons to:
 * - End Shift (2-step wizard)
 * - Close Day (3-step wizard)
 *
 * Route: /terminal/:terminalId/shift
 */

import { useParams, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { DollarSign, Receipt, XCircle, CalendarCheck, Loader2 } from "lucide-react";

import { useClientAuth } from "../contexts/ClientAuthContext";
import { useClientDashboard } from "../lib/api/client-dashboard";
import { useStoreTerminals } from "../lib/api/stores";
import { useActiveShift } from "../lib/api/shifts";

/**
 * Format currency for display
 */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export default function TerminalShiftPage() {
  const { terminalId } = useParams<{ terminalId: string }>();
  const navigate = useNavigate();

  // Auth and dashboard data
  const { isLoading: authLoading } = useClientAuth();
  const {
    data: dashboardData,
    isLoading: dashboardLoading,
    isError: dashboardError,
  } = useClientDashboard();

  // Get store ID from user's accessible stores
  const storeId =
    dashboardData?.stores.find((s) => s.status === "ACTIVE")?.store_id ||
    dashboardData?.stores[0]?.store_id;

  // Fetch terminals for the store
  const { data: terminals = [], isLoading: isLoadingTerminals } =
    useStoreTerminals(storeId, { enabled: !!storeId });

  // Find the terminal
  const terminal = terminals.find((t) => t.pos_terminal_id === terminalId);

  // Fetch the current open shift for this terminal
  const { data: shiftData, isLoading: shiftLoading } = useActiveShift(
    terminalId ?? null,
    { enabled: !!terminalId },
  );

  // Loading state
  if (authLoading || dashboardLoading || isLoadingTerminals || shiftLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading terminal shift...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (dashboardError) {
    return (
      <div className="container mx-auto p-6">
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">
              Failed to load dashboard data. Please try again.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No terminal found
  if (!terminal) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">
              Terminal not found.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No open shift
  if (!shiftData) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">
              No open shift for this terminal.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Format shift start date and time combined
  const shiftStartDateTime = format(
    new Date(shiftData.opened_at),
    "MMM d, yyyy 'at' h:mm a",
  );

  // Format shift number for display
  const shiftNumberDisplay = shiftData.shift_number
    ? `#${shiftData.shift_number}`
    : null;

  const cashierName = shiftData.cashier_name || "Unknown Cashier";

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header - Terminal Name and Shift Number */}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">{terminal.name}</h1>
        {shiftNumberDisplay && (
          <span className="text-lg text-muted-foreground">
            Shift {shiftNumberDisplay}
          </span>
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
            <div
              className="flex items-center gap-2"
              data-testid="opening-cash-display"
            >
              <span className="text-muted-foreground">Opening Cash:</span>
              <span className="font-semibold text-green-600">
                {formatCurrency(shiftData.opening_cash)}
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
                <p className="text-sm font-medium text-muted-foreground">
                  Total Sales
                </p>
              </div>
              <p className="text-2xl font-bold">$0.00</p>
            </div>

            {/* Total Tax Collected */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">
                  Total Tax Collected
                </p>
              </div>
              <p className="text-2xl font-bold">$0.00</p>
            </div>

            {/* Total Voids */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">
                  Total Voids
                </p>
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
              navigate(`/shift-end?shiftId=${shiftData.shift_id}`);
            }}
            className="w-full md:w-auto"
            data-testid="end-shift-button"
          >
            End Shift
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              navigate(`/day-close?shiftId=${shiftData.shift_id}`);
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
