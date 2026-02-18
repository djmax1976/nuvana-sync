/**
 * SummaryCardsRow Component
 *
 * Displays 4 gradient summary cards in a row: Inside Sales, Fuel Sales,
 * Lottery Sales, and Reserved. Each card shows main value and sub-items.
 *
 * @module src/renderer/components/view/SummaryCardsRow
 * @security FE-001: Uses JSX auto-escaping, no dangerouslySetInnerHTML
 * @security SEC-004: All content rendered via text nodes, XSS-safe
 */

import * as React from 'react';
import { ShoppingBag, Flame, Ticket } from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';

/* ============================================================================
   TYPES
   ============================================================================ */

export interface InsideSalesData {
  total: number;
  nonFood: number;
  foodSales: number;
}

export interface FuelSalesData {
  total: number;
  gallonsSold: number;
}

export interface LotterySalesData {
  total: number;
  scratchOff: number;
  online: number;
}

export interface SummaryCardsData {
  insideSales: InsideSalesData;
  fuelSales: FuelSalesData;
  lotterySales: LotterySalesData;
  /** Reserved for future use - currently shows placeholder */
  reserved?: number | null;
}

export interface SummaryCardsRowProps {
  /** Summary data for all cards */
  data: SummaryCardsData;
  /** Optional data-testid override */
  'data-testid'?: string;
  /** Optional additional className */
  className?: string;
}

/* ============================================================================
   GRADIENT CARD COMPONENT
   ============================================================================ */

interface GradientCardProps {
  title: string;
  icon: React.ReactNode;
  mainValue: string;
  subItems?: Array<{ label: string; value: string }>;
  gradientClass: string;
  iconBgClass: string;
  textColorClass: string;
  testId: string;
}

const GradientCard = React.memo(function GradientCard({
  title,
  icon,
  mainValue,
  subItems,
  gradientClass,
  iconBgClass,
  textColorClass,
  testId,
}: GradientCardProps) {
  return (
    <div
      className={cn('relative overflow-hidden rounded-xl p-5 shadow-lg', gradientClass)}
      data-testid={testId}
    >
      {/* Background glow effect */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
      </div>

      {/* Card content */}
      <div className="relative z-10">
        {/* Header with icon */}
        <div className="flex items-center gap-2 mb-3">
          <span className={cn('w-5 h-5', textColorClass)} aria-hidden="true">
            {icon}
          </span>
          <span className={cn('text-sm font-medium', iconBgClass)}>{title}</span>
        </div>

        {/* Main value */}
        <p className="text-3xl font-bold text-white mb-3" data-testid={`${testId}-value`}>
          {mainValue}
        </p>

        {/* Sub-items */}
        {subItems && subItems.length > 0 && (
          <div className="space-y-1 pt-2 border-t border-white/20">
            {subItems.map((item, index) => (
              <div
                key={item.label}
                className="flex justify-between items-center"
                data-testid={`${testId}-subitem-${index}`}
              >
                <span className={cn('text-xs', textColorClass)}>{item.label}</span>
                <span className="text-sm font-medium text-white">{item.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

/* ============================================================================
   RESERVED CARD COMPONENT
   ============================================================================ */

const ReservedCard = React.memo(function ReservedCard({ testId }: { testId: string }) {
  return (
    <div
      className="relative overflow-hidden rounded-xl bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 p-5 shadow-lg border border-slate-600/30"
      data-testid={testId}
    >
      {/* Background glow effect */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-white/5 blur-2xl" />
      </div>

      {/* Centered reserved text */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full min-h-[100px]">
        <span className="text-sm text-slate-400">— Reserved —</span>
      </div>
    </div>
  );
});

/* ============================================================================
   MAIN COMPONENT
   ============================================================================ */

export const SummaryCardsRow = React.memo(function SummaryCardsRow({
  data,
  'data-testid': testId = 'summary-cards-row',
  className,
}: SummaryCardsRowProps) {
  // Memoize formatted values
  const formattedData = React.useMemo(
    () => ({
      insideSales: {
        total: formatCurrency(data.insideSales.total),
        nonFood: formatCurrency(data.insideSales.nonFood),
        foodSales: formatCurrency(data.insideSales.foodSales),
      },
      fuelSales: {
        total: formatCurrency(data.fuelSales.total),
        gallons: `${data.fuelSales.gallonsSold.toLocaleString('en-US', {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })} gal`,
      },
      lotterySales: {
        total: formatCurrency(data.lotterySales.total),
        scratchOff: formatCurrency(data.lotterySales.scratchOff),
        online: formatCurrency(data.lotterySales.online),
      },
    }),
    [data]
  );

  return (
    <div
      className={cn('grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4', className)}
      data-testid={testId}
    >
      {/* Inside Sales - Blue gradient */}
      <GradientCard
        title="Inside Sales"
        icon={<ShoppingBag className="w-5 h-5" />}
        mainValue={formattedData.insideSales.total}
        gradientClass="bg-gradient-to-br from-blue-600 via-blue-700 to-blue-900"
        iconBgClass="text-blue-100"
        textColorClass="text-blue-200"
        subItems={[
          { label: 'Non-Food', value: formattedData.insideSales.nonFood },
          { label: 'Food Sales', value: formattedData.insideSales.foodSales },
        ]}
        testId={`${testId}-inside-sales`}
      />

      {/* Fuel Sales - Amber/Orange gradient */}
      <GradientCard
        title="Fuel Sales"
        icon={<Flame className="w-5 h-5" />}
        mainValue={formattedData.fuelSales.total}
        gradientClass="bg-gradient-to-br from-amber-600 via-amber-700 to-orange-900"
        iconBgClass="text-amber-100"
        textColorClass="text-amber-200"
        subItems={[{ label: 'Gallons Sold', value: formattedData.fuelSales.gallons }]}
        testId={`${testId}-fuel-sales`}
      />

      {/* Lottery Sales - Green gradient */}
      <GradientCard
        title="Lottery Sales"
        icon={<Ticket className="w-5 h-5" />}
        mainValue={formattedData.lotterySales.total}
        gradientClass="bg-gradient-to-br from-emerald-600 via-emerald-700 to-green-900"
        iconBgClass="text-emerald-100"
        textColorClass="text-emerald-200"
        subItems={[
          { label: 'Scratch Off', value: formattedData.lotterySales.scratchOff },
          { label: 'Online', value: formattedData.lotterySales.online },
        ]}
        testId={`${testId}-lottery-sales`}
      />

      {/* Reserved - Slate gradient */}
      <ReservedCard testId={`${testId}-reserved`} />
    </div>
  );
});

SummaryCardsRow.displayName = 'SummaryCardsRow';

export default SummaryCardsRow;
