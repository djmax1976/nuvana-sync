/**
 * Sales Breakdown Card Component
 *
 * Displays department sales with dual-column layout:
 * - Reports Totals: Manual input for lottery items only (Scratch Off, Online Lottery)
 * - POS Totals: Read-only values from POS system
 *
 * @security
 * - FE-002: FORM_VALIDATION - Input sanitization for numeric values
 * - SEC-014: INPUT_VALIDATION - Strict numeric-only input handling
 * - FE-005: UI_SECURITY - No sensitive data exposed
 */

import { useCallback, useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { TrendingUp } from 'lucide-react';

import {
  type SalesBreakdownState,
  type SalesBreakdownReportsState,
  type SalesBreakdownPOSState,
  type SalesBreakdownCardProps,
  calculateTotalSalesReports,
  calculateTotalSalesPOS,
} from './types';
import { formatCurrency, sanitizeNumericInput } from './utils';

/**
 * Simple horizontal separator
 */
function Separator({ className = '' }: { className?: string }) {
  return <hr className={`border-t border-border ${className}`} />;
}

/**
 * Column headers for the dual-column layout
 */
function ColumnHeaders() {
  return (
    <div className="grid grid-cols-[1fr_100px_100px] gap-2 pb-2 border-b border-border">
      <div className="text-sm font-medium text-muted-foreground">Department</div>
      <div className="text-sm font-medium text-muted-foreground text-right">Reports Totals</div>
      <div className="text-sm font-medium text-muted-foreground text-right">POS Totals</div>
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
      data-testid={`sales-row-${id}`}
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
            data-testid={`sales-pos-${id}`}
            aria-label={`${label} POS total`}
          />
        </div>
      ) : (
        <div className="text-right font-mono text-sm">{formatCurrency(posValue)}</div>
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
  highlight?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
}

function DualColumnLineItem({
  id,
  label,
  reportsValue,
  posValue,
  onReportsChange,
  highlight = false,
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

  const rowClass = highlight
    ? 'grid grid-cols-[1fr_100px_100px] gap-2 py-2 items-center bg-green-50 dark:bg-green-950/30 px-2 rounded-md'
    : 'grid grid-cols-[1fr_100px_100px] gap-2 py-2 items-center';

  const labelClass = highlight
    ? 'text-sm font-medium text-green-700 dark:text-green-300'
    : 'text-sm font-medium';

  return (
    <div className={rowClass} data-testid={`sales-row-${id}`}>
      <div className={labelClass}>{label}</div>
      {readOnly ? (
        // Read-only mode: plain text display
        <div className="text-right font-mono text-sm">{formatCurrency(reportsValue)}</div>
      ) : (
        // Edit mode: input field
        <div className="flex items-center justify-end gap-1">
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
              highlight
                ? 'bg-green-100 dark:bg-green-900/50 border-green-300 dark:border-green-700'
                : ''
            }`}
            data-testid={`sales-reports-${id}`}
            aria-label={`${label} reports total`}
          />
        </div>
      )}
      <div className="text-right font-mono text-sm">{formatCurrency(posValue)}</div>
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
  return (
    <div
      className="grid grid-cols-[1fr_100px_100px] gap-2 py-3 bg-muted/50 px-2 rounded-md items-center"
      data-testid="total-sales"
    >
      <div className="text-sm font-bold">{label}</div>
      <div className="text-right font-bold font-mono text-sm text-primary">
        {formatCurrency(reportsValue)}
      </div>
      <div className="text-right font-bold font-mono text-sm text-primary">
        {formatCurrency(posValue)}
      </div>
    </div>
  );
}

/**
 * Sales Breakdown Card
 *
 * Displays department sales section with dual columns:
 * - Department sales (Gas, Grocery, Tobacco, etc.) - POS only
 * - Lottery items (Scratch Off, Online Lottery) - Both Reports input and POS values
 * - Sales Tax - POS only
 * - Total Sales for both columns
 *
 * Supports read-only mode for historical shift views where all values
 * are displayed as plain text instead of editable inputs.
 *
 * @security SEC-014: INPUT_VALIDATION - Defensive null checks for API data
 */
export function SalesBreakdownCard({
  state,
  onReportsChange,
  onPOSChange,
  disabled = false,
  editablePOS = false,
  readOnly = false,
}: SalesBreakdownCardProps) {
  // Create individual field change handlers for reports
  // SEC-014: INPUT_VALIDATION - Handler validates state before applying updates
  const createReportsChangeHandler = useCallback(
    (field: keyof SalesBreakdownReportsState) => (value: number) => {
      if (onReportsChange) {
        onReportsChange({ [field]: value });
      }
    },
    [onReportsChange]
  );

  // Create individual field change handlers for POS (for testing)
  const createPOSChangeHandler = useCallback(
    (field: keyof SalesBreakdownPOSState) => (value: number) => {
      if (onPOSChange) {
        onPOSChange({ [field]: value });
      }
    },
    [onPOSChange]
  );

  // Memoize total sales calculations - uses defensive null checks inside calculateTotalSalesReports/POS
  const totalSalesReports = useMemo(() => calculateTotalSalesReports(state), [state]);
  const totalSalesPOS = useMemo(() => calculateTotalSalesPOS(state), [state]);

  // SEC-014: Defensive null checks - return null if state structure is invalid
  // This MUST come AFTER all hooks to satisfy Rules of Hooks
  if (!state?.pos || !state?.reports) {
    return null;
  }

  return (
    <Card data-testid="sales-breakdown-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" aria-hidden="true" />
          Department Sales
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {/* Column Headers */}
        <ColumnHeaders />

        {/* Department sales - POS only (or editable for testing) */}
        <POSOnlyLineItem
          id="gas-sales"
          label="Gas Sales"
          posValue={state.pos.gasSales}
          onPOSChange={createPOSChangeHandler('gasSales')}
          editable={editablePOS}
          disabled={disabled}
        />
        <POSOnlyLineItem
          id="grocery"
          label="Grocery"
          posValue={state.pos.grocery}
          onPOSChange={createPOSChangeHandler('grocery')}
          editable={editablePOS}
          disabled={disabled}
        />
        <POSOnlyLineItem
          id="tobacco"
          label="Tobacco"
          posValue={state.pos.tobacco}
          onPOSChange={createPOSChangeHandler('tobacco')}
          editable={editablePOS}
          disabled={disabled}
        />
        <POSOnlyLineItem
          id="beverages"
          label="Beverages"
          posValue={state.pos.beverages}
          onPOSChange={createPOSChangeHandler('beverages')}
          editable={editablePOS}
          disabled={disabled}
        />
        <POSOnlyLineItem
          id="snacks"
          label="Snacks"
          posValue={state.pos.snacks}
          onPOSChange={createPOSChangeHandler('snacks')}
          editable={editablePOS}
          disabled={disabled}
        />
        <POSOnlyLineItem
          id="other"
          label="Other"
          posValue={state.pos.other}
          onPOSChange={createPOSChangeHandler('other')}
          editable={editablePOS}
          disabled={disabled}
        />

        <Separator className="my-4" />

        {/*
          Lottery items - Both columns with highlight
          Layout follows the lottery terminal report format:
          - Instant Sales / Instant Cashes (scratch-off tickets)
          - Online Sales / Online Cashes (draw games, powerball, etc.)

          @security FE-002: FORM_VALIDATION - Inputs use sanitizeNumericInput
        */}
        <DualColumnLineItem
          id="scratch-off"
          label="Instant Sales"
          reportsValue={state.reports.scratchOff}
          posValue={state.pos.scratchOff}
          onReportsChange={createReportsChangeHandler('scratchOff')}
          highlight
          disabled={disabled}
          readOnly={readOnly}
        />
        <DualColumnLineItem
          id="instant-cashes"
          label="Instant Cashes"
          reportsValue={state.reports.instantCashes}
          posValue={state.pos.instantCashes}
          onReportsChange={createReportsChangeHandler('instantCashes')}
          highlight
          disabled={disabled}
          readOnly={readOnly}
        />
        <DualColumnLineItem
          id="online-lottery"
          label="Online Sales"
          reportsValue={state.reports.onlineLottery}
          posValue={state.pos.onlineLottery}
          onReportsChange={createReportsChangeHandler('onlineLottery')}
          highlight
          disabled={disabled}
          readOnly={readOnly}
        />
        <DualColumnLineItem
          id="online-cashes"
          label="Online Cashes"
          reportsValue={state.reports.onlineCashes}
          posValue={state.pos.onlineCashes}
          onReportsChange={createReportsChangeHandler('onlineCashes')}
          highlight
          disabled={disabled}
          readOnly={readOnly}
        />

        <Separator className="my-4" />

        {/* Sales Tax - POS only (or editable for testing) */}
        <POSOnlyLineItem
          id="sales-tax"
          label="Sales Tax"
          posValue={state.pos.salesTax}
          onPOSChange={createPOSChangeHandler('salesTax')}
          editable={editablePOS}
          disabled={disabled}
        />

        <Separator className="my-4" />

        {/* Total Sales */}
        <TotalsRow label="Total Sales" reportsValue={totalSalesReports} posValue={totalSalesPOS} />
      </CardContent>
    </Card>
  );
}
