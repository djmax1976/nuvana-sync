/**
 * Shift Detail Page
 *
 * Shows detailed information about a single shift including summary and transactions.
 *
 * @module renderer/pages/ShiftDetailPage
 */

import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useShift, useShiftSummary, useCloseShift, useShiftFuelData } from '../lib/hooks';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { FuelSalesBreakdown } from '../components/shifts/FuelSalesBreakdown';

export default function ShiftDetailPage() {
  const { shiftId } = useParams<{ shiftId: string }>();
  const navigate = useNavigate();

  const { data: shift, isLoading: shiftLoading, error: shiftError } = useShift(shiftId || null);
  const { data: summary, isLoading: summaryLoading } = useShiftSummary(shiftId || null);
  const { data: fuelData, isLoading: fuelLoading } = useShiftFuelData(shiftId || null);
  const closeShiftMutation = useCloseShift();

  const handleCloseShift = async () => {
    if (!shiftId || !confirm('Are you sure you want to close this shift?')) return;

    try {
      await closeShiftMutation.mutateAsync(shiftId);
      navigate('/shifts');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to close shift');
    }
  };

  if (shiftLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (shiftError || !shift) {
    return (
      <div className="space-y-4">
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
          <h3 className="text-destructive font-medium">Error loading shift</h3>
          <p className="text-destructive/80 text-sm mt-1">
            {shiftError instanceof Error ? shiftError.message : 'Shift not found'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Close Shift Action */}
      {shift.status === 'OPEN' && (
        <div className="flex justify-end">
          <button
            onClick={handleCloseShift}
            disabled={closeShiftMutation.isPending}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {closeShiftMutation.isPending ? 'Closing...' : 'Close Shift'}
          </button>
        </div>
      )}

      {/* Shift Header */}
      <div className="bg-card rounded-lg border border-border p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Shift #{shift.shift_number}</h2>
            <p className="text-muted-foreground mt-1">{formatDate(shift.business_date)}</p>
          </div>
          <StatusBadge status={shift.status} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-6">
          <InfoItem
            label="Start Time"
            value={shift.start_time ? formatTime(shift.start_time) : '-'}
          />
          <InfoItem label="End Time" value={shift.end_time ? formatTime(shift.end_time) : '-'} />
          <InfoItem label="Cashier ID" value={shift.cashier_id || '-'} />
          <InfoItem label="Register" value={shift.register_id || '-'} />
        </div>
      </div>

      {/* Shift Summary */}
      <div className="bg-card rounded-lg border border-border p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">Shift Summary</h3>
        {summaryLoading ? (
          <div className="flex items-center justify-center h-24">
            <LoadingSpinner />
          </div>
        ) : summary ? (
          <div className="space-y-6">
            {/* Primary Sales Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SummaryCard
                label="Net Sales"
                value={formatCurrency(summary.netSales ?? summary.totalSales)}
                color="green"
              />
              <SummaryCard
                label="Transactions"
                value={summary.transactionCount.toString()}
                color="blue"
              />
              <SummaryCard
                label="Voided Amount"
                value={formatCurrency(summary.totalVoided)}
                color="red"
              />
            </div>

            {/* Secondary Metrics - Fuel, Tax, Lottery */}
            {(summary.grossSales ||
              summary.taxCollected ||
              summary.fuelSales ||
              summary.lotteryNet) && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {summary.grossSales !== undefined && (
                  <SummaryCardSmall
                    label="Gross Sales"
                    value={formatCurrency(summary.grossSales)}
                  />
                )}
                {summary.taxCollected !== undefined && (
                  <SummaryCardSmall
                    label="Tax Collected"
                    value={formatCurrency(summary.taxCollected)}
                  />
                )}
                {summary.fuelSales !== undefined && (
                  <SummaryCardSmall
                    label="Fuel Sales"
                    value={`${formatCurrency(summary.fuelSales)} (${formatGallons(summary.fuelGallons ?? 0)})`}
                  />
                )}
                {summary.lotteryNet !== undefined && (
                  <SummaryCardSmall
                    label="Lottery Net"
                    value={formatCurrency(summary.lotteryNet)}
                  />
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">No summary data available</p>
        )}
      </div>

      {/* Department Breakdown */}
      {summary?.departmentBreakdown && summary.departmentBreakdown.length > 0 && (
        <div className="bg-card rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Sales by Department</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">
                    Department
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">
                    Net Sales
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">
                    Transactions
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.departmentBreakdown.map((dept) => (
                  <tr key={dept.departmentCode} className="border-b border-border/50">
                    <td className="py-3 px-4">
                      <span className="font-medium text-foreground">
                        {dept.departmentName || dept.departmentCode}
                      </span>
                      {dept.departmentName && (
                        <span className="text-muted-foreground ml-2">({dept.departmentCode})</span>
                      )}
                    </td>
                    <td className="text-right py-3 px-4 font-medium text-green-600 dark:text-green-400">
                      {formatCurrency(dept.netSales)}
                    </td>
                    <td className="text-right py-3 px-4 text-muted-foreground">
                      {dept.transactionCount}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30">
                  <td className="py-3 px-4 font-semibold text-foreground">Total</td>
                  <td className="text-right py-3 px-4 font-semibold text-green-600 dark:text-green-400">
                    {formatCurrency(
                      summary.departmentBreakdown.reduce((sum, d) => sum + d.netSales, 0)
                    )}
                  </td>
                  <td className="text-right py-3 px-4 font-semibold text-muted-foreground">
                    {summary.departmentBreakdown.reduce((sum, d) => sum + d.transactionCount, 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Tender Breakdown */}
      {summary?.tenderBreakdown && summary.tenderBreakdown.length > 0 && (
        <div className="bg-card rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Payment Methods</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">
                    Tender Type
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Amount</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">
                    Transactions
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.tenderBreakdown.map((tender) => (
                  <tr key={tender.tenderCode} className="border-b border-border/50">
                    <td className="py-3 px-4">
                      <span className="font-medium text-foreground">
                        {tender.tenderDisplayName || formatTenderCode(tender.tenderCode)}
                      </span>
                    </td>
                    <td className="text-right py-3 px-4 font-medium text-blue-600 dark:text-blue-400">
                      {formatCurrency(tender.netAmount)}
                    </td>
                    <td className="text-right py-3 px-4 text-muted-foreground">
                      {tender.transactionCount}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30">
                  <td className="py-3 px-4 font-semibold text-foreground">Total</td>
                  <td className="text-right py-3 px-4 font-semibold text-blue-600 dark:text-blue-400">
                    {formatCurrency(
                      summary.tenderBreakdown.reduce((sum, t) => sum + t.netAmount, 0)
                    )}
                  </td>
                  <td className="text-right py-3 px-4 font-semibold text-muted-foreground">
                    {summary.tenderBreakdown.reduce((sum, t) => sum + t.transactionCount, 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Fuel Sales with Inside/Outside Breakdown */}
      {fuelLoading ? (
        <div className="bg-card rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Fuel Sales</h3>
          <div className="flex items-center justify-center h-24">
            <LoadingSpinner />
          </div>
        </div>
      ) : fuelData && (fuelData.totals.totalVolume > 0 || fuelData.totals.totalAmount > 0) ? (
        <FuelSalesBreakdown
          totals={fuelData.totals}
          byGrade={fuelData.byGrade}
          hasMSMData={fuelData.hasMSMData}
        />
      ) : summary?.fuelByGrade && summary.fuelByGrade.length > 0 ? (
        /* Fallback to legacy fuel display if no MSM data */
        <div className="bg-card rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Fuel Sales by Grade</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Grade</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">
                    Gallons
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Sales</th>
                </tr>
              </thead>
              <tbody>
                {summary.fuelByGrade.map((fuel, index) => (
                  <tr key={`${fuel.gradeId}-${index}`} className="border-b border-border/50">
                    <td className="py-3 px-4">
                      <span className="font-medium text-foreground">
                        {fuel.gradeName || formatFuelGradeId(fuel.gradeId)}
                      </span>
                    </td>
                    <td className="text-right py-3 px-4 font-medium text-amber-600 dark:text-amber-400">
                      {formatGallons(fuel.volumeSold)}
                    </td>
                    <td className="text-right py-3 px-4 font-medium text-green-600 dark:text-green-400">
                      {formatCurrency(fuel.amountSold)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30">
                  <td className="py-3 px-4 font-semibold text-foreground">Total</td>
                  <td className="text-right py-3 px-4 font-semibold text-amber-600 dark:text-amber-400">
                    {formatGallons(summary.fuelByGrade.reduce((sum, f) => sum + f.volumeSold, 0))}
                  </td>
                  <td className="text-right py-3 px-4 font-semibold text-green-600 dark:text-green-400">
                    {formatCurrency(summary.fuelByGrade.reduce((sum, f) => sum + f.amountSold, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : null}

      {/* Debug Data Section - Shows raw fuel data for troubleshooting */}
      {fuelData && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">🔍 Debug: Raw Fuel Data</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Shift ID: <code className="bg-muted px-2 py-1 rounded">{shiftId}</code>
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="p-3 bg-blue-500/10 rounded">
              <p className="text-xs text-muted-foreground">Inside Volume</p>
              <p className="font-mono font-bold">{fuelData.totals.insideVolume.toFixed(3)} gal</p>
            </div>
            <div className="p-3 bg-blue-500/10 rounded">
              <p className="text-xs text-muted-foreground">Inside Amount</p>
              <p className="font-mono font-bold">${fuelData.totals.insideAmount.toFixed(2)}</p>
            </div>
            <div className="p-3 bg-purple-500/10 rounded">
              <p className="text-xs text-muted-foreground">Outside Volume (est.)</p>
              <p className="font-mono font-bold">{fuelData.totals.outsideVolume.toFixed(3)} gal</p>
            </div>
            <div className="p-3 bg-purple-500/10 rounded">
              <p className="text-xs text-muted-foreground">Outside Amount</p>
              <p className="font-mono font-bold">${fuelData.totals.outsideAmount.toFixed(2)}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <div className="p-3 bg-amber-500/10 rounded">
              <p className="text-xs text-muted-foreground">Total Volume</p>
              <p className="font-mono font-bold">{fuelData.totals.totalVolume.toFixed(3)} gal</p>
            </div>
            <div className="p-3 bg-green-500/10 rounded">
              <p className="text-xs text-muted-foreground">Total Amount</p>
              <p className="font-mono font-bold">${fuelData.totals.totalAmount.toFixed(2)}</p>
            </div>
            <div className="p-3 bg-muted rounded">
              <p className="text-xs text-muted-foreground">Has MSM Data</p>
              <p className="font-mono font-bold">{fuelData.hasMSMData ? 'YES' : 'NO'}</p>
            </div>
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium">
              Show Grade Breakdown (click to expand)
            </summary>
            <pre className="mt-2 p-3 bg-muted rounded text-xs overflow-auto max-h-60">
              {JSON.stringify(fuelData.byGrade, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {/* Timestamps */}
      <div className="bg-card rounded-lg border border-border p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">Timestamps</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Created:</span>{' '}
            <span className="text-foreground">{formatDateTime(shift.created_at)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Updated:</span>{' '}
            <span className="text-foreground">{formatDateTime(shift.updated_at)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

interface StatusBadgeProps {
  status: 'OPEN' | 'CLOSED';
}

function StatusBadge({ status }: StatusBadgeProps) {
  const styles = {
    OPEN: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
    CLOSED: 'bg-muted text-muted-foreground border-border',
  };

  return (
    <span className={`px-4 py-2 text-sm font-medium rounded-full border ${styles[status]}`}>
      {status}
    </span>
  );
}

interface InfoItemProps {
  label: string;
  value: string;
}

function InfoItem({ label, value }: InfoItemProps) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-lg font-medium text-foreground">{value}</p>
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: string;
  color: 'green' | 'blue' | 'red';
}

function SummaryCard({ label, value, color }: SummaryCardProps) {
  const colors = {
    green: 'bg-green-500/10 border-green-500/20',
    blue: 'bg-blue-500/10 border-blue-500/20',
    red: 'bg-red-500/10 border-red-500/20',
  };

  const textColors = {
    green: 'text-green-600 dark:text-green-400',
    blue: 'text-blue-600 dark:text-blue-400',
    red: 'text-red-600 dark:text-red-400',
  };

  return (
    <div className={`p-4 rounded-lg border ${colors[color]}`}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${textColors[color]}`}>{value}</p>
    </div>
  );
}

interface SummaryCardSmallProps {
  label: string;
  value: string;
}

function SummaryCardSmall({ label, value }: SummaryCardSmallProps) {
  return (
    <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold text-foreground mt-0.5">{value}</p>
    </div>
  );
}

// ============================================================================
// Formatters
// ============================================================================

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(timeStr: string): string {
  return new Date(timeStr).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

function formatGallons(gallons: number): string {
  return `${gallons.toLocaleString(undefined, { maximumFractionDigits: 1 })} gal`;
}

function formatTenderCode(code: string): string {
  // Convert tender codes like "outsideCredit" to "Outside Credit"
  const formatted = code
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();

  // Handle common abbreviations
  const abbreviations: Record<string, string> = {
    Cash: 'Cash',
    'Outside Credit': 'Credit Card',
    'Outside Debit': 'Debit Card',
    Fleet: 'Fleet Card',
    Check: 'Check',
    Ebt: 'EBT',
    'Gift Card': 'Gift Card',
  };

  return abbreviations[formatted] || formatted;
}

function formatFuelGradeId(gradeId: string): string {
  // Map common fuel grade IDs to display names
  const fuelGrades: Record<string, string> = {
    '001': 'Regular Unleaded',
    '002': 'Mid-Grade',
    '003': 'Premium',
    '004': 'Diesel',
    '005': 'E85',
    '300': 'Diesel',
    '1': 'Regular',
    '2': 'Mid-Grade',
    '3': 'Premium',
    '4': 'Diesel',
    REG: 'Regular',
    MID: 'Mid-Grade',
    PREM: 'Premium',
    DSL: 'Diesel',
    REGULAR: 'Regular',
    PREMIUM: 'Premium',
    DIESEL: 'Diesel',
  };

  return fuelGrades[gradeId] || fuelGrades[gradeId.toUpperCase()] || `Grade ${gradeId}`;
}
