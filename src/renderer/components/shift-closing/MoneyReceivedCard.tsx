
/**
 * Money Received Card Component
 *
 * Displays payment methods with dual-column layout:
 * - Reports Totals: Manual input for payouts only
 * - POS Totals: Read-only values from POS system
 *
 * @security
 * - FE-002: FORM_VALIDATION - Input sanitization for numeric values
 * - SEC-014: INPUT_VALIDATION - Strict numeric-only input handling
 * - FE-005: UI_SECURITY - No sensitive data exposed
 */

import { useCallback, useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DollarSign } from "lucide-react";

import {
  type MoneyReceivedState,
  type MoneyReceivedReportsState,
  type MoneyReceivedPOSState,
  type MoneyReceivedCardProps,
  calculateNetCashReports,
  calculateNetCashPOS,
} from "./types";
import { formatCurrency, sanitizeNumericInput } from "./utils";

/**
 * Simple horizontal separator
 */
function Separator({ className = "" }: { className?: string }) {
  return <hr className={`border-t border-border ${className}`} />;
}

/**
 * Column headers for the dual-column layout
 */
function ColumnHeaders() {
  return (
    <div className="grid grid-cols-[1fr_100px_100px] gap-2 pb-2 border-b border-border">
      <div className="text-sm font-medium text-muted-foreground">
        Payment Type
      </div>
      <div className="text-sm font-medium text-muted-foreground text-right">
        Reports Totals
      </div>
      <div className="text-sm font-medium text-muted-foreground text-right">
        POS Totals
      </div>
    </div>
  );
}

/**
 * Line item with dual columns - POS only (or editable POS for testing)
 */
interface POSOnlyLineItemProps {
  id: string;
  label: string;
  posValue: number;
  onPOSChange?: (value: number) => void;
  editable?: boolean;
  disabled?: boolean;
}

function POSOnlyLineItem({
  id,
  label,
  posValue,
  onPOSChange,
  editable = false,
  disabled = false,
}: POSOnlyLineItemProps) {
  // Use local state for the input value to allow free-form editing
  const [inputValue, setInputValue] = useState(posValue.toFixed(2));

  // Sync local state when posValue changes from outside
  useEffect(() => {
    setInputValue(posValue.toFixed(2));
  }, [posValue]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    // Allow typing by updating local state immediately
    setInputValue(rawValue);
  }, []);

  const handleBlur = useCallback(() => {
    if (onPOSChange) {
      const sanitized = sanitizeNumericInput(inputValue);
      onPOSChange(sanitized);
      // Format the display value on blur
      setInputValue(sanitized.toFixed(2));
    }
  }, [inputValue, onPOSChange]);

  return (
    <div
      className="grid grid-cols-[1fr_100px_100px] gap-2 py-2 items-center"
      data-testid={`money-row-${id}`}
    >
      <div className="text-sm font-medium">{label}</div>
      <div className="text-right" />
      {editable && onPOSChange ? (
        <div className="flex items-center justify-end gap-1">
          <span className="text-muted-foreground text-xs">$</span>
          <Input
            id={`pos-${id}`}
            type="text"
            inputMode="decimal"
            value={inputValue}
            onChange={handleChange}
            onBlur={handleBlur}
            disabled={disabled}
            className="w-20 h-8 text-right font-mono text-sm"
            data-testid={`money-pos-${id}`}
            aria-label={`${label} POS total`}
          />
        </div>
      ) : (
        <div className="text-right font-mono text-sm">
          {formatCurrency(posValue)}
        </div>
      )}
    </div>
  );
}

/**
 * Line item with dual columns - Both reports input and POS value
 */
interface DualColumnLineItemProps {
  id: string;
  label: string;
  reportsValue: number;
  posValue: number;
  onReportsChange?: (value: number) => void;
  isNegative?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
}

function DualColumnLineItem({
  id,
  label,
  reportsValue,
  posValue,
  onReportsChange,
  isNegative = false,
  disabled = false,
  readOnly = false,
}: DualColumnLineItemProps) {
  // Use local state for the input value to allow free-form editing
  const [inputValue, setInputValue] = useState(reportsValue.toFixed(2));

  // Sync local state when reportsValue changes from outside
  useEffect(() => {
    setInputValue(reportsValue.toFixed(2));
  }, [reportsValue]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    // Allow typing by updating local state immediately
    setInputValue(rawValue);
  }, []);

  const handleBlur = useCallback(() => {
    if (onReportsChange) {
      const sanitized = sanitizeNumericInput(inputValue);
      onReportsChange(sanitized);
      // Format the display value on blur
      setInputValue(sanitized.toFixed(2));
    }
  }, [inputValue, onReportsChange]);

  return (
    <div
      className="grid grid-cols-[1fr_100px_100px] gap-2 py-2 items-center"
      data-testid={`money-row-${id}`}
    >
      <div className="text-sm font-medium">{label}</div>
      {readOnly ? (
        // Read-only mode: plain text display
        <div
          className={`text-right font-mono text-sm ${
            isNegative ? "text-red-600 dark:text-red-400" : ""
          }`}
        >
          {isNegative
            ? `(${formatCurrency(reportsValue)})`
            : formatCurrency(reportsValue)}
        </div>
      ) : (
        // Edit mode: input field
        <div className="flex items-center justify-end gap-1">
          {isNegative && (
            <span className="text-muted-foreground text-xs">(</span>
          )}
          <span className="text-muted-foreground text-xs">$</span>
          <Input
            id={`reports-${id}`}
            type="text"
            inputMode="decimal"
            value={inputValue}
            onChange={handleChange}
            onBlur={handleBlur}
            disabled={disabled}
            className={`w-20 h-8 text-right font-mono text-sm ${
              isNegative ? "text-red-600 dark:text-red-400" : ""
            }`}
            data-testid={`money-reports-${id}`}
            aria-label={`${label} reports total`}
          />
          {isNegative && (
            <span className="text-muted-foreground text-xs">)</span>
          )}
        </div>
      )}
      <div
        className={`text-right font-mono text-sm ${
          isNegative ? "text-red-600 dark:text-red-400" : ""
        }`}
      >
        {isNegative
          ? `(${formatCurrency(posValue)})`
          : formatCurrency(posValue)}
      </div>
    </div>
  );
}

/**
 * Totals row with dual columns
 */
interface TotalsRowProps {
  label: string;
  reportsValue: number;
  posValue: number;
}

function TotalsRow({ label, reportsValue, posValue }: TotalsRowProps) {
  const reportsColor =
    reportsValue < 0
      ? "text-red-600 dark:text-red-400"
      : "text-green-600 dark:text-green-400";
  const posColor =
    posValue < 0
      ? "text-red-600 dark:text-red-400"
      : "text-green-600 dark:text-green-400";

  return (
    <div
      className="grid grid-cols-[1fr_100px_100px] gap-2 py-3 bg-muted/50 px-2 rounded-md items-center"
      data-testid="net-cash-total"
    >
      <div className="text-sm font-bold">{label}</div>
      <div className={`text-right font-bold font-mono text-sm ${reportsColor}`}>
        {formatCurrency(reportsValue)}
      </div>
      <div className={`text-right font-bold font-mono text-sm ${posColor}`}>
        {formatCurrency(posValue)}
      </div>
    </div>
  );
}

/**
 * Money Received Card
 *
 * Displays payment methods section with dual columns:
 * - Payment types (Cash, Credit, Debit, EBT) - POS only
 * - Payouts (Cash, Lottery, Gaming) - Both Reports input and POS values
 * - Net Cash totals for both columns
 *
 * Supports read-only mode for historical shift views where all values
 * are displayed as plain text instead of editable inputs.
 *
 * @security SEC-014: INPUT_VALIDATION - Defensive null checks for API data
 */
export function MoneyReceivedCard({
  state,
  onReportsChange,
  onPOSChange,
  disabled = false,
  editablePOS = false,
  readOnly = false,
}: MoneyReceivedCardProps) {
  // Create individual field change handlers for reports
  // SEC-014: INPUT_VALIDATION - Handler validates state before applying updates
  const createReportsChangeHandler = useCallback(
    (field: keyof MoneyReceivedReportsState) => (value: number) => {
      if (onReportsChange) {
        onReportsChange({ [field]: value });
      }
    },
    [onReportsChange],
  );

  // Create individual field change handlers for POS (for testing)
  const createPOSChangeHandler = useCallback(
    (field: keyof MoneyReceivedPOSState) => (value: number) => {
      if (onPOSChange) {
        onPOSChange({ [field]: value });
      }
    },
    [onPOSChange],
  );

  // Memoize net cash calculations - uses defensive null checks inside calculateNetCashReports/POS
  const netCashReports = useMemo(() => calculateNetCashReports(state), [state]);
  const netCashPOS = useMemo(() => calculateNetCashPOS(state), [state]);

  // SEC-014: Defensive null checks - return null if state structure is invalid
  // This MUST come AFTER all hooks to satisfy Rules of Hooks
  if (!state?.pos || !state?.reports) {
    return null;
  }

  return (
    <Card data-testid="money-received-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="h-5 w-5" aria-hidden="true" />
          Payment Methods
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {/* Column Headers */}
        <ColumnHeaders />

        {/* Payment types - POS only (or editable for testing) */}
        <POSOnlyLineItem
          id="cash"
          label="Cash"
          posValue={state.pos.cash}
          onPOSChange={createPOSChangeHandler("cash")}
          editable={editablePOS}
          disabled={disabled}
        />
        <POSOnlyLineItem
          id="credit-card"
          label="Credit Card"
          posValue={state.pos.creditCard}
          onPOSChange={createPOSChangeHandler("creditCard")}
          editable={editablePOS}
          disabled={disabled}
        />
        <POSOnlyLineItem
          id="debit-card"
          label="Debit Card"
          posValue={state.pos.debitCard}
          onPOSChange={createPOSChangeHandler("debitCard")}
          editable={editablePOS}
          disabled={disabled}
        />
        <POSOnlyLineItem
          id="ebt"
          label="EBT"
          posValue={state.pos.ebt}
          onPOSChange={createPOSChangeHandler("ebt")}
          editable={editablePOS}
          disabled={disabled}
        />

        <Separator className="my-4" />

        {/* Payouts section header */}
        <div className="text-sm font-semibold text-muted-foreground py-1">
          Payouts
        </div>

        {/* Payout items - Both columns */}
        <DualColumnLineItem
          id="cash-payouts"
          label="Cash Payouts"
          reportsValue={state.reports.cashPayouts}
          posValue={state.pos.cashPayouts}
          onReportsChange={createReportsChangeHandler("cashPayouts")}
          isNegative
          disabled={disabled}
          readOnly={readOnly}
        />
        <DualColumnLineItem
          id="lottery-payouts"
          label="Lottery Payouts"
          reportsValue={state.reports.lotteryPayouts}
          posValue={state.pos.lotteryPayouts}
          onReportsChange={createReportsChangeHandler("lotteryPayouts")}
          isNegative
          disabled={disabled}
          readOnly={readOnly}
        />
        <DualColumnLineItem
          id="gaming-payouts"
          label="Gaming Payouts"
          reportsValue={state.reports.gamingPayouts}
          posValue={state.pos.gamingPayouts}
          onReportsChange={createReportsChangeHandler("gamingPayouts")}
          isNegative
          disabled={disabled}
          readOnly={readOnly}
        />

        <Separator className="my-4" />

        {/* Net Cash Total */}
        <TotalsRow
          label="Net Cash"
          reportsValue={netCashReports}
          posValue={netCashPOS}
        />
      </CardContent>
    </Card>
  );
}
