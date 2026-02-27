/**
 * SalesBreakdownCard Component
 *
 * Displays department sales breakdown with icons, including lottery
 * sub-section and totals. Two column layout (Reports/POS).
 *
 * @module src/renderer/components/view/SalesBreakdownCard
 * @security FE-001: Uses JSX auto-escaping, no dangerouslySetInnerHTML
 * @security SEC-004: All content rendered via text nodes, XSS-safe
 */

import * as React from 'react';
import {
  Flame,
  ShoppingBag,
  Package,
  Droplets,
  Cake,
  MoreHorizontal,
  Ticket,
  CircleDollarSign,
  Globe,
  Receipt,
  TrendingUp,
  BarChart3,
} from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';

/* ============================================================================
   TYPES
   ============================================================================ */

export interface DepartmentSale {
  /** Amount from scanned reports */
  reports?: number | null;
  /** Amount from POS system */
  pos: number;
}

export interface LotterySalesBreakdown {
  instantSales: DepartmentSale;
  instantCashes: DepartmentSale;
  onlineSales: DepartmentSale;
  onlineCashes: DepartmentSale;
}

export interface SalesBreakdownData {
  gasSales: DepartmentSale;
  grocery: DepartmentSale;
  tobacco: DepartmentSale;
  beverages: DepartmentSale;
  snacks: DepartmentSale;
  other: DepartmentSale;
  lottery: LotterySalesBreakdown;
  salesTax: DepartmentSale;
  total: DepartmentSale;
}

export interface SalesBreakdownCardProps {
  /** Sales breakdown data */
  data: SalesBreakdownData;
  /** Indicates this is a read-only view */
  readOnly?: boolean;
  /** Optional data-testid override */
  'data-testid'?: string;
  /** Optional additional className */
  className?: string;
}

/* ============================================================================
   DEPARTMENT ROW COMPONENT
   ============================================================================ */

interface DepartmentRowProps {
  label: string;
  icon: React.ReactNode;
  iconBgClass: string;
  iconTextClass: string;
  reports: number | null | undefined;
  pos: number;
  testId: string;
}

const DepartmentRow = React.memo(function DepartmentRow({
  label,
  icon,
  iconBgClass,
  iconTextClass,
  reports,
  pos,
  testId,
}: DepartmentRowProps) {
  return (
    <div
      className="grid grid-cols-[1fr_90px_90px] gap-2 py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors items-center"
      data-testid={testId}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center',
            iconBgClass,
            iconTextClass
          )}
        >
          {icon}
        </span>
        <span className="text-sm font-medium text-card-foreground">{label}</span>
      </div>
      <div className="text-right text-sm text-muted-foreground">
        {reports != null ? formatCurrency(reports) : '—'}
      </div>
      <div className="text-right font-mono text-sm font-medium text-card-foreground">
        {formatCurrency(pos)}
      </div>
    </div>
  );
});

/* ============================================================================
   LOTTERY ROW COMPONENT
   ============================================================================ */

interface LotteryRowProps {
  label: string;
  icon: React.ReactNode;
  reports: number | null | undefined;
  pos: number;
  testId: string;
}

const LotteryRow = React.memo(function LotteryRow({
  label,
  icon,
  reports,
  pos,
  testId,
}: LotteryRowProps) {
  return (
    <div
      className="grid grid-cols-[1fr_90px_90px] gap-2 py-2.5 px-3 rounded-lg bg-success-light border border-success/30 items-center"
      data-testid={testId}
    >
      <div className="flex items-center gap-3">
        <span className="w-8 h-8 rounded-lg bg-success/20 text-success flex items-center justify-center">
          {icon}
        </span>
        <span className="text-sm font-medium text-success">{label}</span>
      </div>
      <div className="text-right font-mono text-sm text-card-foreground">
        {reports != null ? formatCurrency(reports) : '—'}
      </div>
      <div className="text-right font-mono text-sm text-muted-foreground">
        {formatCurrency(pos)}
      </div>
    </div>
  );
});

/* ============================================================================
   TOTAL ROW COMPONENT
   ============================================================================ */

interface TotalRowProps {
  reports: number | null | undefined;
  pos: number;
  testId: string;
}

const TotalRow = React.memo(function TotalRow({ reports, pos, testId }: TotalRowProps) {
  return (
    <div
      className="grid grid-cols-[1fr_90px_90px] gap-2 py-4 px-4 rounded-xl bg-primary-light border border-primary/30 items-center"
      data-testid={testId}
    >
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-primary/20 text-primary flex items-center justify-center">
          <TrendingUp className="w-5 h-5" />
        </span>
        <span className="text-base font-bold text-card-foreground">Total Sales</span>
      </div>
      <div className="text-right font-bold font-mono text-primary">
        {reports != null ? formatCurrency(reports) : '—'}
      </div>
      <div className="text-right font-bold font-mono text-primary">{formatCurrency(pos)}</div>
    </div>
  );
});

/* ============================================================================
   MAIN COMPONENT
   ============================================================================ */

export const SalesBreakdownCard = React.memo(function SalesBreakdownCard({
  data,
  readOnly = true,
  'data-testid': testId = 'sales-breakdown-card',
  className,
}: SalesBreakdownCardProps) {
  return (
    <div
      className={cn('relative overflow-hidden rounded-xl border border-border bg-card', className)}
      data-testid={testId}
      data-readonly={readOnly}
    >
      {/* Top accent bar */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-accent to-primary" />

      {/* Header */}
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-[10px] flex items-center justify-center bg-primary-light text-primary">
            <BarChart3 className="w-5 h-5" />
          </span>
          <div>
            <h3 className="font-semibold text-lg text-card-foreground">Department Sales</h3>
            <p className="text-xs text-muted-foreground">Sales by category</p>
          </div>
        </div>
      </div>

      <div className="p-4">
        {/* Column Headers */}
        <div className="grid grid-cols-[1fr_90px_90px] gap-2 pb-3 mb-3 border-b border-border/30">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Department
          </div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right">
            Reports
          </div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right">
            POS
          </div>
        </div>

        {/* Department Items */}
        <div className="space-y-1" data-testid={`${testId}-departments`}>
          <DepartmentRow
            label="Gas Sales"
            icon={<Flame className="w-4 h-4" />}
            iconBgClass="bg-warning-light"
            iconTextClass="text-warning"
            reports={data.gasSales.reports}
            pos={data.gasSales.pos}
            testId={`${testId}-gas`}
          />
          <DepartmentRow
            label="Grocery"
            icon={<ShoppingBag className="w-4 h-4" />}
            iconBgClass="bg-success-light"
            iconTextClass="text-success"
            reports={data.grocery.reports}
            pos={data.grocery.pos}
            testId={`${testId}-grocery`}
          />
          <DepartmentRow
            label="Tobacco"
            icon={<Package className="w-4 h-4" />}
            iconBgClass="bg-warning-light"
            iconTextClass="text-warning"
            reports={data.tobacco.reports}
            pos={data.tobacco.pos}
            testId={`${testId}-tobacco`}
          />
          <DepartmentRow
            label="Beverages"
            icon={<Droplets className="w-4 h-4" />}
            iconBgClass="bg-info-light"
            iconTextClass="text-info"
            reports={data.beverages.reports}
            pos={data.beverages.pos}
            testId={`${testId}-beverages`}
          />
          <DepartmentRow
            label="Snacks"
            icon={<Cake className="w-4 h-4" />}
            iconBgClass="bg-destructive-light"
            iconTextClass="text-destructive"
            reports={data.snacks.reports}
            pos={data.snacks.pos}
            testId={`${testId}-snacks`}
          />
          <DepartmentRow
            label="Other"
            icon={<MoreHorizontal className="w-4 h-4" />}
            iconBgClass="bg-muted"
            iconTextClass="text-muted-foreground"
            reports={data.other.reports}
            pos={data.other.pos}
            testId={`${testId}-other`}
          />
        </div>

        {/* Lottery Section */}
        <div className="mt-4 pt-4 border-t border-border/30">
          <div className="flex items-center gap-2 mb-3 px-3">
            <span className="w-2 h-2 rounded-full bg-success" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Lottery
            </span>
          </div>
          <div className="space-y-1" data-testid={`${testId}-lottery`}>
            <LotteryRow
              label="Instant Sales"
              icon={<Ticket className="w-4 h-4" />}
              reports={data.lottery.instantSales.reports}
              pos={data.lottery.instantSales.pos}
              testId={`${testId}-instant-sales`}
            />
            <LotteryRow
              label="Instant Cashes"
              icon={<CircleDollarSign className="w-4 h-4" />}
              reports={data.lottery.instantCashes.reports}
              pos={data.lottery.instantCashes.pos}
              testId={`${testId}-instant-cashes`}
            />
            <LotteryRow
              label="Online Sales"
              icon={<Globe className="w-4 h-4" />}
              reports={data.lottery.onlineSales.reports}
              pos={data.lottery.onlineSales.pos}
              testId={`${testId}-online-sales`}
            />
            <LotteryRow
              label="Online Cashes"
              icon={<CircleDollarSign className="w-4 h-4" />}
              reports={data.lottery.onlineCashes.reports}
              pos={data.lottery.onlineCashes.pos}
              testId={`${testId}-online-cashes`}
            />
          </div>
        </div>

        {/* Sales Tax */}
        <div className="mt-4 pt-4 border-t border-border/30">
          <DepartmentRow
            label="Sales Tax"
            icon={<Receipt className="w-4 h-4" />}
            iconBgClass="bg-slate-800/50"
            iconTextClass="text-slate-400"
            reports={data.salesTax.reports}
            pos={data.salesTax.pos}
            testId={`${testId}-sales-tax`}
          />
        </div>

        {/* Total Sales */}
        <div className="mt-4 pt-4 border-t border-border/30">
          <TotalRow reports={data.total.reports} pos={data.total.pos} testId={`${testId}-total`} />
        </div>
      </div>
    </div>
  );
});

SalesBreakdownCard.displayName = 'SalesBreakdownCard';

export default SalesBreakdownCard;
