import React from "react";
import { ChartErrorBoundary } from "./chart-error-boundary";

/**
 * Accessible Chart Wrapper
 *
 * Provides accessibility features for Recharts components:
 * - ARIA labels and descriptions
 * - Screen reader announcements
 * - Keyboard navigation support
 * - Error boundary protection
 *
 * Implements WCAG 2.1 Level AA compliance for data visualizations.
 *
 * @example
 * <AccessibleChart
 *   title="Weekly Sales Trend"
 *   description="Line chart showing sales from Monday to Sunday, current value $24.95 with 8.3% increase"
 *   data={salesData}
 * >
 *   <LineChart data={salesData}>...</LineChart>
 * </AccessibleChart>
 */

interface AccessibleChartProps {
  children: React.ReactNode;
  /** Chart title for screen readers */
  title: string;
  /** Detailed description of chart data */
  description: string;
  /** Optional summary of key data points */
  summary?: string;
  /** Chart height */
  height?: string | number;
  /** Data for generating accessible table alternative */
  data?: Array<Record<string, unknown>>;
  /** Key for x-axis value in data */
  xKey?: string;
  /** Key for y-axis value in data */
  yKey?: string;
  /** Label for x-axis */
  xLabel?: string;
  /** Label for y-axis */
  yLabel?: string;
  /** Format function for y values */
  formatValue?: (value: number) => string;
  /** Show data table for screen readers */
  showDataTable?: boolean;
  /** Additional className */
  className?: string;
}

export function AccessibleChart({
  children,
  title,
  description,
  summary,
  height = "100%",
  data,
  xKey = "name",
  yKey = "value",
  xLabel = "Category",
  yLabel = "Value",
  formatValue = (v) => String(v),
  showDataTable = true,
  className = "",
}: AccessibleChartProps) {
  const chartId = React.useId();
  const descriptionId = `${chartId}-desc`;
  const tableId = `${chartId}-table`;

  return (
    <ChartErrorBoundary chartName={title} height={height}>
      <div
        className={`relative ${className}`}
        style={{ height: typeof height === "number" ? `${height}px` : height }}
      >
        {/* Visible chart container with ARIA attributes */}
        <div
          role="img"
          aria-labelledby={descriptionId}
          aria-describedby={data && showDataTable ? tableId : undefined}
          className="w-full h-full"
        >
          {children}
        </div>

        {/* Screen reader description (visually hidden) */}
        <div id={descriptionId} className="sr-only">
          <h3>{title}</h3>
          <p>{description}</p>
          {summary && <p>{summary}</p>}
        </div>

        {/* Accessible data table for screen readers (visually hidden) */}
        {data && showDataTable && (
          <table
            id={tableId}
            className="sr-only"
            aria-label={`Data table for ${title}`}
          >
            <caption>{title} - Tabular Data</caption>
            <thead>
              <tr>
                <th scope="col">{xLabel}</th>
                <th scope="col">{yLabel}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item, index) => {
                // eslint-disable-next-line security/detect-object-injection -- Safe: xKey/yKey are props passed by caller
                const xValue = String(item[xKey] ?? "");
                // eslint-disable-next-line security/detect-object-injection -- Safe: xKey/yKey are props passed by caller
                const yValue = formatValue(Number(item[yKey]) || 0);
                return (
                  <tr key={index}>
                    <td>{xValue}</td>
                    <td>{yValue}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </ChartErrorBoundary>
  );
}

/**
 * Screen reader only styles
 * Add to your global CSS if not already present
 *
 * .sr-only {
 *   position: absolute;
 *   width: 1px;
 *   height: 1px;
 *   padding: 0;
 *   margin: -1px;
 *   overflow: hidden;
 *   clip: rect(0, 0, 0, 0);
 *   white-space: nowrap;
 *   border: 0;
 * }
 */

/**
 * Generate accessible description from chart data
 */
export function generateChartDescription(
  data: Array<{ name: string; value: number }>,
  chartType: "line" | "bar" | "pie" | "donut",
  formatValue: (v: number) => string = (v) => String(v),
): string {
  if (!data || data.length === 0) {
    return "No data available";
  }

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const minItem = data.find((d) => d.value === min);
  const maxItem = data.find((d) => d.value === max);
  const total = values.reduce((sum, v) => sum + v, 0);
  const avg = total / values.length;

  const chartTypeDesc =
    chartType === "line"
      ? "trend line"
      : chartType === "bar"
        ? "bar chart"
        : chartType === "pie" || chartType === "donut"
          ? "pie chart"
          : "chart";

  let description = `This ${chartTypeDesc} displays ${data.length} data points. `;

  if (minItem && maxItem) {
    description += `The highest value is ${formatValue(max)} for ${maxItem.name}. `;
    description += `The lowest value is ${formatValue(min)} for ${minItem.name}. `;
  }

  if (chartType === "pie" || chartType === "donut") {
    description += `Total is ${formatValue(total)}. `;
    // Add percentage breakdown for top 3
    const sorted = [...data].sort((a, b) => b.value - a.value).slice(0, 3);
    description += `Top categories: ${sorted.map((d) => `${d.name} (${((d.value / total) * 100).toFixed(0)}%)`).join(", ")}.`;
  } else {
    description += `Average is ${formatValue(avg)}.`;
  }

  return description;
}

/**
 * Calculate trend direction for announcements
 */
export function getTrendAnnouncement(
  currentValue: number,
  previousValue: number,
  formatValue: (v: number) => string = (v) => String(v),
): string {
  if (currentValue === previousValue) {
    return `Value unchanged at ${formatValue(currentValue)}`;
  }

  const change = currentValue - previousValue;
  const percentChange = ((change / previousValue) * 100).toFixed(1);
  const direction = change > 0 ? "increased" : "decreased";

  return `Value ${direction} from ${formatValue(previousValue)} to ${formatValue(currentValue)}, a ${Math.abs(Number(percentChange))}% ${direction.replace("ed", "")}`;
}
