import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { PieChart, Pie, Cell } from 'recharts';
import { DeferredResponsiveContainer } from '../ui/deferred-responsive-container';
import { AccessibleChart, generateChartDescription } from '../ui/accessible-chart';
import { sanitizeForDisplay, formatCurrency } from '../../lib/utils/security';

/**
 * SalesByDepartment Component
 *
 * Displays a donut chart showing sales breakdown by department
 * with a center total and legend.
 *
 * Security Features:
 * - SEC-004: XSS prevention via sanitized output
 * - WCAG 2.1: Full accessibility support with chart descriptions
 *
 * Story: MyStore Dashboard Redesign
 */

// Sample sales data - will be replaced with real API data
const salesData = [
  { name: 'Fuel', value: 3245, color: '#0066FF' },
  { name: 'Beverages', value: 1892, color: '#00C853' },
  { name: 'Lottery', value: 1847, color: '#FF9800' },
  { name: 'Snacks', value: 945, color: '#9C27B0' },
  { name: 'Other', value: 523, color: '#e5e7eb' },
];

const total = salesData.reduce((sum, item) => sum + item.value, 0);

// Generate accessible description for the donut chart
const chartDescription = generateChartDescription(
  salesData.map((d) => ({ name: d.name, value: d.value })),
  'donut',
  (v) => formatCurrency(v)
);

export function SalesByDepartment() {
  return (
    <Card
      className="min-h-[340px] sm:min-h-[380px] flex flex-col"
      data-testid="sales-by-department"
      role="region"
      aria-labelledby="sales-by-department-title"
    >
      <CardHeader className="flex flex-row items-center justify-between p-3 sm:p-4 lg:p-5 border-b">
        <CardTitle id="sales-by-department-title" className="text-sm sm:text-base font-semibold">
          Sales
        </CardTitle>
        <select
          className="px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm text-muted-foreground bg-card border rounded-md cursor-pointer"
          aria-label="Select time period for sales data"
        >
          <option>Today</option>
          <option>This Week</option>
          <option>This Month</option>
        </select>
      </CardHeader>
      <CardContent className="flex-1 p-3 sm:p-4 lg:p-5">
        {/* Donut Chart with Center Label - Accessible */}
        <AccessibleChart
          title="Sales by Department"
          description={chartDescription}
          data={salesData.map((d) => ({ name: d.name, value: d.value }))}
          xKey="name"
          yKey="value"
          xLabel="Department"
          yLabel="Sales Amount"
          formatValue={(v) => formatCurrency(v)}
          height={180}
        >
          <div className="flex flex-col items-center">
            <div className="relative w-[140px] h-[140px] sm:w-[160px] sm:h-[160px] lg:w-[180px] lg:h-[180px]">
              <DeferredResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={salesData}
                    cx="50%"
                    cy="50%"
                    innerRadius="60%"
                    outerRadius="95%"
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                  >
                    {salesData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </DeferredResponsiveContainer>
              {/* Center label */}
              <div
                className="absolute inset-0 flex flex-col items-center justify-center"
                aria-hidden="true"
              >
                <span className="text-xl sm:text-2xl lg:text-3xl font-bold text-primary">
                  {formatCurrency(total / 1000)}K
                </span>
                <span className="text-[10px] sm:text-xs text-muted-foreground">Total</span>
              </div>
            </div>
          </div>
        </AccessibleChart>

        {/* Legend - Accessible */}
        <div
          className="flex flex-col gap-1.5 sm:gap-2 mt-3 sm:mt-4"
          role="list"
          aria-label="Sales breakdown by department"
        >
          {salesData.map((item) => {
            const safeName = sanitizeForDisplay(item.name);
            const formattedValue = formatCurrency(item.value);
            const percentage = ((item.value / total) * 100).toFixed(0);

            return (
              <div
                key={item.name}
                className="flex items-center justify-between text-xs sm:text-sm"
                role="listitem"
                aria-label={`${safeName}: ${formattedValue}, ${percentage}% of total`}
              >
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <div
                    className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: item.color }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{safeName}</span>
                </div>
                <span className="font-semibold ml-2">{formattedValue}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
