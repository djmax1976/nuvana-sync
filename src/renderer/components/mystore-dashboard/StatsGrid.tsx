import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import { Receipt, Users, Ticket, Scale, TrendingUp, Clock, CheckCircle } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { maskEmployeeName } from '../../lib/utils/security';

/**
 * StatsGrid Component
 *
 * Displays 4 key stat cards with sparkline charts:
 * 1. Average Ticket - with weekly trend line
 * 2. Active Shifts - with cashier badges
 * 3. Lottery Sales - with weekly trend line
 * 4. Lottery Variance - with variance trend line
 *
 * Security Features:
 * - SEC-004: XSS prevention via sanitized output
 * - FE-005: Employee name masking for privacy
 * - WCAG 2.1: Full accessibility support
 *
 * Story: MyStore Dashboard Redesign
 */

// Sample data for charts - will be replaced with real API data
const avgTicketData = [
  { label: 'Mon', value: 21.5 },
  { label: 'Tue', value: 22.15 },
  { label: 'Wed', value: 23.8 },
  { label: 'Thu', value: 22.95 },
  { label: 'Fri', value: 24.1 },
  { label: 'Sat', value: 26.45 },
  { label: 'Sun', value: 24.95 },
];

const lotterySalesData = [
  { label: 'Mon', value: 1520 },
  { label: 'Tue', value: 1680 },
  { label: 'Wed', value: 1890 },
  { label: 'Thu', value: 1750 },
  { label: 'Fri', value: 1620 },
  { label: 'Sat', value: 2100 },
  { label: 'Sun', value: 1847 },
];

const lotteryVarianceData = [
  { label: 'Mon', value: 0 },
  { label: 'Tue', value: -15 },
  { label: 'Wed', value: 0 },
  { label: 'Thu', value: 10 },
  { label: 'Fri', value: -5 },
  { label: 'Sat', value: 0 },
  { label: 'Sun', value: 0 },
];

// Sample active cashiers - names will be masked for display
const activeCashiers = [
  { name: 'Sarah Miller', initials: 'SM' },
  { name: 'John Davis', initials: 'JD' },
  { name: 'Mike Johnson', initials: 'MJ' },
];

/**
 * Color variants for stat card icons
 */
type IconVariant = 'primary' | 'success' | 'warning' | 'error';

const ICON_VARIANT_STYLES: Record<IconVariant, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-green-500/10 text-green-600',
  warning: 'bg-orange-500/10 text-orange-600',
  error: 'bg-red-500/10 text-red-600',
};

const CHART_COLORS: Record<IconVariant, string> = {
  primary: 'hsl(var(--primary))',
  success: '#22c55e',
  warning: '#f97316',
  error: '#ef4444',
};

const CHART_BG_COLORS: Record<IconVariant, string> = {
  primary: 'rgba(0, 102, 255, 0.1)',
  success: 'rgba(34, 197, 94, 0.1)',
  warning: 'rgba(249, 115, 22, 0.1)',
  error: 'rgba(239, 68, 68, 0.1)',
};

/**
 * Format currency value with K notation for thousands
 */
function formatCurrencyK(value: number): string {
  if (Math.abs(value) >= 1000) {
    return '$' + (value / 1000).toFixed(1) + 'k';
  }
  return (
    '$' +
    value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  );
}

/**
 * Format variance values with +/- prefix
 */
function formatVariance(value: number): string {
  if (value === 0) return '$0';
  const prefix = value > 0 ? '+$' : '-$';
  return prefix + Math.abs(value);
}

interface ChartDataPoint {
  label: string;
  value: number;
}

type ChartType = 'weekly' | 'variance';

interface StatCardProps {
  id: string;
  label: string;
  value: string;
  trend?: {
    value: string;
    isPositive: boolean;
    icon?: 'trending' | 'clock' | 'check';
  };
  icon: React.ReactNode;
  iconVariant?: IconVariant;
  chartData?: ChartDataPoint[];
  chartType?: ChartType;
  children?: React.ReactNode;
  className?: string;
}

function StatCard({
  id,
  label,
  value,
  trend,
  icon,
  iconVariant = 'primary',
  chartData,
  chartType = 'weekly',
  children,
  className,
}: StatCardProps) {
  // Pre-compute chart values
  const { maxIndex, minIndex, formatValue } = (() => {
    if (!chartData || chartData.length === 0) {
      return { maxIndex: -1, minIndex: -1, formatValue: formatCurrencyK };
    }

    const values = chartData.map((d) => d.value);
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const maxIdx = values.indexOf(maxVal);
    const minIdx = values.lastIndexOf(minVal);
    const formatter = chartType === 'variance' ? formatVariance : formatCurrencyK;

    return { maxIndex: maxIdx, minIndex: minIdx, formatValue: formatter };
  })();

  // eslint-disable-next-line security/detect-object-injection -- Safe: iconVariant is typed IconVariant enum
  const chartStrokeColor = CHART_COLORS[iconVariant];
  // eslint-disable-next-line security/detect-object-injection -- Safe: iconVariant is typed IconVariant enum
  const chartFillColor = CHART_BG_COLORS[iconVariant];

  const TrendIcon =
    trend?.icon === 'clock' ? Clock : trend?.icon === 'check' ? CheckCircle : TrendingUp;

  // Generate accessible label
  const ariaLabel = `${label}: ${value}${trend ? `, ${trend.isPositive ? 'up' : 'down'} ${trend.value}` : ''}`;

  return (
    <article
      className={cn(
        'bg-card border border-border rounded-xl p-4 shadow-sm transition-shadow duration-200 hover:shadow-md',
        'flex flex-col h-[140px] min-w-0 overflow-hidden',
        className
      )}
      data-card-id={id}
      data-testid={`stat-card-${id}`}
      role="listitem"
      tabIndex={0}
      aria-label={ariaLabel}
    >
      {/* Header with label, value, trend, and icon */}
      <div className="flex justify-between items-start mb-0">
        <div className="min-w-0 flex-1">
          <span
            className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block"
            id={`label-${id}`}
          >
            {label}
          </span>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-xl font-bold text-foreground" aria-describedby={`label-${id}`}>
              {value}
            </span>
            {trend && (
              <span
                className={cn(
                  'flex items-center gap-0.5 text-[11px]',
                  trend.isPositive ? 'text-green-600' : 'text-red-500'
                )}
                aria-label={`Trend: ${trend.isPositive ? 'up' : 'down'} ${trend.value}`}
              >
                <TrendIcon className="w-3 h-3" aria-hidden="true" />
                <span>{trend.value}</span>
              </span>
            )}
          </div>
        </div>
        <div
          className={cn(
            'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0',
            // eslint-disable-next-line security/detect-object-injection -- Safe: iconVariant is typed IconVariant enum
            ICON_VARIANT_STYLES[iconVariant]
          )}
          aria-hidden="true"
        >
          {icon}
        </div>
      </div>

      {/* Chart or custom children */}
      {chartData ? (
        <div className="flex-1 mt-1" style={{ minHeight: 60 }} aria-hidden="true">
          <ResponsiveContainer width="100%" height={60}>
            <AreaChart data={chartData} margin={{ top: 18, right: 12, bottom: 0, left: 12 }}>
              <XAxis
                dataKey="label"
                axisLine={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
                tickLine={false}
                tick={{
                  fontSize: 9,
                  fill: 'hsl(var(--muted-foreground))',
                }}
                interval={0}
              />
              <YAxis domain={['dataMin - 10', 'dataMax + 10']} hide />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                formatter={(val) => {
                  const numVal = typeof val === 'number' ? val : 0;
                  return [formatValue(numVal), label];
                }}
                labelFormatter={(lbl) => lbl}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={chartStrokeColor}
                strokeWidth={2}
                fill={chartFillColor}
                dot={(props) => {
                  const { cx, cy, index } = props;
                  if (
                    typeof cx !== 'number' ||
                    typeof cy !== 'number' ||
                    typeof index !== 'number' ||
                    !chartData
                  ) {
                    return <g key="dot-invalid" />;
                  }

                  // eslint-disable-next-line security/detect-object-injection -- Safe: index is bounded by chartData.length
                  const dataValue = chartData[index].value;
                  const isMax = index === maxIndex;
                  const isMin = index === minIndex && minIndex !== maxIndex;

                  // Determine colors
                  let dotColor = chartStrokeColor;
                  let textColor = 'hsl(var(--muted-foreground))';

                  if (chartType === 'variance') {
                    // For variance charts: green for 0, red for negative, orange for positive
                    if (dataValue === 0) {
                      dotColor = '#22c55e';
                      textColor = '#22c55e';
                    } else if (dataValue < 0) {
                      dotColor = '#ef4444';
                      textColor = '#ef4444';
                    } else {
                      dotColor = '#f97316';
                      textColor = '#f97316';
                    }
                  } else if (isMax) {
                    dotColor = '#22c55e';
                    textColor = '#22c55e';
                  } else if (isMin) {
                    dotColor = '#ef4444';
                    textColor = '#ef4444';
                  }

                  // Show dot for max/min or all points in variance mode
                  const showDot = isMax || isMin || chartType === 'variance';

                  return (
                    <g key={`dot-${index}`}>
                      {showDot && (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={4}
                          fill={dotColor}
                          stroke="white"
                          strokeWidth={2}
                        />
                      )}
                      <text
                        x={cx}
                        y={cy - 8}
                        textAnchor="middle"
                        fill={textColor}
                        fontSize={9}
                        fontWeight="bold"
                      >
                        {formatValue(dataValue)}
                      </text>
                    </g>
                  );
                }}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex-1 mt-1">{children}</div>
      )}
    </article>
  );
}

export function StatsGrid() {
  return (
    <section
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      data-testid="stats-grid"
      aria-label="Store Performance Metrics"
      role="list"
    >
      {/* Average Ticket */}
      <StatCard
        id="avg-ticket"
        label="Average Ticket"
        value="$24.95"
        trend={{ value: '+8.3%', isPositive: true }}
        icon={<Receipt className="w-3.5 h-3.5" aria-hidden="true" />}
        iconVariant="primary"
        chartData={avgTicketData}
        chartType="weekly"
      />

      {/* Active Shifts */}
      <StatCard
        id="active-shifts"
        label="Active Shifts"
        value="3"
        trend={{ value: 'open', isPositive: true, icon: 'clock' }}
        icon={<Users className="w-3.5 h-3.5" aria-hidden="true" />}
        iconVariant="success"
      >
        <div className="flex flex-wrap gap-1 mt-1" role="list" aria-label="Active cashiers">
          {activeCashiers.map((cashier) => (
            <Badge
              key={cashier.initials}
              variant="success"
              className="text-[11px] px-2 py-0.5"
              role="listitem"
            >
              {/* FE-005: Mask employee names for privacy */}
              {maskEmployeeName(cashier.name)}
            </Badge>
          ))}
        </div>
      </StatCard>

      {/* Lottery Sales */}
      <StatCard
        id="lottery-sales"
        label="Lottery Sales"
        value="$1,847"
        trend={{ value: '+8.2%', isPositive: true }}
        icon={<Ticket className="w-3.5 h-3.5" aria-hidden="true" />}
        iconVariant="warning"
        chartData={lotterySalesData}
        chartType="weekly"
      />

      {/* Lottery Variance */}
      <StatCard
        id="lottery-variance"
        label="Lottery Variance"
        value="$0"
        trend={{ value: 'balanced', isPositive: true, icon: 'check' }}
        icon={<Scale className="w-3.5 h-3.5" aria-hidden="true" />}
        iconVariant="error"
        chartData={lotteryVarianceData}
        chartType="variance"
      />
    </section>
  );
}
