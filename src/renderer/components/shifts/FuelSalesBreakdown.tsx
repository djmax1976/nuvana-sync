/**
 * Fuel Sales Breakdown Component
 *
 * Displays fuel sales data with inside (cash) and outside (credit/debit) breakdown.
 * Shows data by grade with volume and amount totals.
 *
 * @module renderer/components/shifts/FuelSalesBreakdown
 * @security SEC-004: XSS prevention via React's automatic escaping
 * @security FE-005: No sensitive data displayed - only aggregated fuel sales metrics
 */

import React from 'react';
import { Fuel, CreditCard, Banknote, TrendingDown } from 'lucide-react';
import type { MSMFuelTotals, MSMFuelByGrade } from '../../lib/transport';

// ============================================================================
// Types
// ============================================================================

interface FuelSalesBreakdownProps {
  /** Aggregated fuel totals with inside/outside breakdown */
  totals: MSMFuelTotals;
  /** Fuel breakdown by grade */
  byGrade: MSMFuelByGrade[];
  /** Whether MSM data is available (more detailed) */
  hasMSMData: boolean;
  /** Optional CSS class name */
  className?: string;
}

// ============================================================================
// Formatters
// ============================================================================

/**
 * Format currency value
 * SEC-004: Uses Intl.NumberFormat for safe, locale-aware formatting
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
 * Format volume (gallons)
 * SEC-004: Uses safe string formatting
 */
function formatGallons(volume: number): string {
  return `${volume.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} gal`;
}

/**
 * Format price per gallon
 */
function formatPricePerGallon(price: number): string {
  return `$${price.toFixed(3)}/gal`;
}

/**
 * Get display name for fuel grade
 * Maps common grade codes to human-readable names
 */
function getFuelGradeName(gradeId: string | null, gradeName: string | null): string {
  if (gradeName) return gradeName;
  if (!gradeId) return 'Unknown Grade';

  // Common fuel grade mappings
  const FUEL_GRADE_NAMES: Record<string, string> = {
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

  // eslint-disable-next-line security/detect-object-injection -- Safe: FUEL_GRADE_NAMES is a constant mapping, gradeId from validated DB data
  return FUEL_GRADE_NAMES[gradeId] || FUEL_GRADE_NAMES[gradeId.toUpperCase()] || `Grade ${gradeId}`;
}

// ============================================================================
// Sub-Components
// ============================================================================

interface FuelMetricCardProps {
  label: string;
  amount: number;
  volume: number;
  icon: React.ReactNode;
  colorClass: string;
}

function FuelMetricCard({ label, amount, volume, icon, colorClass }: FuelMetricCardProps) {
  return (
    <div className={`p-4 rounded-lg border ${colorClass}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1.5 rounded-md bg-current/10">{icon}</div>
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="space-y-1">
        <p className="text-xl font-bold text-foreground">{formatCurrency(amount)}</p>
        <p className="text-sm text-muted-foreground">{formatGallons(volume)}</p>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Fuel Sales Breakdown Component
 *
 * Displays fuel sales with inside/outside breakdown matching PDF report format:
 * - Inside (Cash): Sales at register
 * - Outside (Credit/Debit): Pay-at-pump sales
 * - Discounts: Fuel-specific discounts
 * - Total: Combined fuel sales
 */
export function FuelSalesBreakdown({
  totals,
  byGrade,
  hasMSMData,
  className = '',
}: FuelSalesBreakdownProps) {
  // Don't render if no fuel data
  if (totals.totalVolume === 0 && totals.totalAmount === 0) {
    return null;
  }

  return (
    <div className={`bg-card rounded-lg border border-border p-6 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">Fuel Sales</h3>
        {hasMSMData && (
          <span className="text-xs px-2 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">
            MSM Data
          </span>
        )}
      </div>

      {/* Summary Cards - Inside/Outside Breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <FuelMetricCard
          label="Inside (Cash)"
          amount={totals.insideAmount}
          volume={totals.insideVolume}
          icon={<Banknote className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
          colorClass="bg-blue-500/5 border-blue-500/20"
        />
        <FuelMetricCard
          label="Outside (Card)"
          amount={totals.outsideAmount}
          volume={totals.outsideVolume}
          icon={<CreditCard className="w-4 h-4 text-purple-600 dark:text-purple-400" />}
          colorClass="bg-purple-500/5 border-purple-500/20"
        />
        {totals.totalDiscount > 0 && (
          <FuelMetricCard
            label="Discounts"
            amount={-totals.totalDiscount}
            volume={0}
            icon={<TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />}
            colorClass="bg-red-500/5 border-red-500/20"
          />
        )}
        <FuelMetricCard
          label="Total Fuel"
          amount={totals.totalAmount}
          volume={totals.totalVolume}
          icon={<Fuel className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
          colorClass="bg-amber-500/5 border-amber-500/20"
        />
      </div>

      {/* Average Price */}
      {totals.averagePrice > 0 && (
        <p className="text-sm text-muted-foreground mb-4">
          Average Price:{' '}
          <span className="font-medium">{formatPricePerGallon(totals.averagePrice)}</span>
        </p>
      )}

      {/* Fuel by Grade Table */}
      {byGrade.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-medium text-muted-foreground mb-3">By Grade</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Grade</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Inside</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                    Outside
                  </th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                    Gallons
                  </th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Total</th>
                </tr>
              </thead>
              <tbody>
                {byGrade.map((grade, index) => (
                  <tr
                    key={grade.gradeId || `grade-${index}`}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                  >
                    <td className="py-2 px-3">
                      <span className="font-medium text-foreground">
                        {getFuelGradeName(grade.gradeId, grade.gradeName)}
                      </span>
                    </td>
                    <td className="text-right py-2 px-3">
                      <div>
                        <span className="text-blue-600 dark:text-blue-400">
                          {formatCurrency(grade.insideAmount)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {formatGallons(grade.insideVolume)}
                        </span>
                      </div>
                    </td>
                    <td className="text-right py-2 px-3">
                      <div>
                        <span className="text-purple-600 dark:text-purple-400">
                          {formatCurrency(grade.outsideAmount)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {formatGallons(grade.outsideVolume)}
                        </span>
                      </div>
                    </td>
                    <td className="text-right py-2 px-3 text-amber-600 dark:text-amber-400 font-medium">
                      {formatGallons(grade.totalVolume)}
                    </td>
                    <td className="text-right py-2 px-3 text-green-600 dark:text-green-400 font-medium">
                      {formatCurrency(grade.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30">
                  <td className="py-2 px-3 font-semibold text-foreground">Total</td>
                  <td className="text-right py-2 px-3">
                    <span className="font-semibold text-blue-600 dark:text-blue-400">
                      {formatCurrency(totals.insideAmount)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatGallons(totals.insideVolume)}
                    </span>
                  </td>
                  <td className="text-right py-2 px-3">
                    <span className="font-semibold text-purple-600 dark:text-purple-400">
                      {formatCurrency(totals.outsideAmount)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatGallons(totals.outsideVolume)}
                    </span>
                  </td>
                  <td className="text-right py-2 px-3 font-semibold text-amber-600 dark:text-amber-400">
                    {formatGallons(totals.totalVolume)}
                  </td>
                  <td className="text-right py-2 px-3 font-semibold text-green-600 dark:text-green-400">
                    {formatCurrency(totals.totalAmount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Discount Details */}
      {totals.totalDiscount > 0 && (
        <div className="mt-4 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Fuel Discounts Applied</span>
            <span className="font-medium text-red-600 dark:text-red-400">
              -{formatCurrency(totals.totalDiscount)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default FuelSalesBreakdown;
