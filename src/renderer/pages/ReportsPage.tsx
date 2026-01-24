/**
 * Reports Page
 *
 * Provides weekly, monthly, and custom date range reports.
 *
 * @module renderer/pages/ReportsPage
 */

import React, { useState } from 'react';
import { useWeeklyReport, useMonthlyReport, useDateRangeReport } from '../lib/hooks';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';

type ReportType = 'weekly' | 'monthly' | 'custom';

export default function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>('weekly');
  const [weekStart, setWeekStart] = useState<string>(getLastWeekStart());
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const weeklyQuery = useWeeklyReport(reportType === 'weekly' ? weekStart : null);
  const monthlyQuery = useMonthlyReport(
    reportType === 'monthly' ? year : null,
    reportType === 'monthly' ? month : null
  );
  const customQuery = useDateRangeReport(
    reportType === 'custom' ? startDate || null : null,
    reportType === 'custom' ? endDate || null : null
  );

  const activeQuery =
    reportType === 'weekly' ? weeklyQuery : reportType === 'monthly' ? monthlyQuery : customQuery;

  return (
    <div className="space-y-6">
      {/* Report Type Tabs */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex space-x-4">
          <TabButton active={reportType === 'weekly'} onClick={() => setReportType('weekly')}>
            Weekly Report
          </TabButton>
          <TabButton active={reportType === 'monthly'} onClick={() => setReportType('monthly')}>
            Monthly Report
          </TabButton>
          <TabButton active={reportType === 'custom'} onClick={() => setReportType('custom')}>
            Custom Range
          </TabButton>
        </div>

        {/* Report Parameters */}
        <div className="mt-4 pt-4 border-t border-gray-200">
          {reportType === 'weekly' && (
            <div className="flex items-center space-x-4">
              <label className="text-sm text-gray-500">Week starting:</label>
              <input
                type="date"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
                className="border rounded px-3 py-1.5 text-sm"
              />
            </div>
          )}

          {reportType === 'monthly' && (
            <div className="flex items-center space-x-4">
              <div>
                <label className="block text-sm text-gray-500 mb-1">Year</label>
                <select
                  value={year}
                  onChange={(e) => setYear(parseInt(e.target.value))}
                  className="border rounded px-3 py-1.5 text-sm"
                >
                  {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">Month</label>
                <select
                  value={month}
                  onChange={(e) => setMonth(parseInt(e.target.value))}
                  className="border rounded px-3 py-1.5 text-sm"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {new Date(2000, m - 1).toLocaleString(undefined, { month: 'long' })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {reportType === 'custom' && (
            <div className="flex items-center space-x-4">
              <div>
                <label className="block text-sm text-gray-500 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="border rounded px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="border rounded px-3 py-1.5 text-sm"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Report Content */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        {activeQuery.isLoading ? (
          <div className="flex items-center justify-center h-48">
            <LoadingSpinner size="lg" />
          </div>
        ) : activeQuery.error ? (
          <div className="text-red-600">
            {activeQuery.error instanceof Error
              ? activeQuery.error.message
              : 'Error loading report'}
          </div>
        ) : reportType === 'weekly' && weeklyQuery.data ? (
          <WeeklyReportView data={weeklyQuery.data} />
        ) : reportType === 'monthly' && monthlyQuery.data ? (
          <MonthlyReportView data={monthlyQuery.data} />
        ) : reportType === 'custom' && customQuery.data ? (
          <CustomReportView data={customQuery.data} />
        ) : (
          <div className="text-gray-500 text-center py-8">
            {reportType === 'custom' && (!startDate || !endDate)
              ? 'Select a date range to generate the report'
              : 'No data available for the selected period'}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Report Views
// ============================================================================

interface WeeklyReportProps {
  data: {
    weekStartDate: string;
    weekEndDate: string;
    dailyData: Array<{
      date: string;
      totalSales: number;
      transactionCount: number;
      fuelSales: number;
      merchandiseSales: number;
      status: 'OPEN' | 'CLOSED' | 'NO_DATA';
    }>;
    totals: {
      sales: number;
      transactions: number;
      fuelSales: number;
      merchandiseSales: number;
    };
  };
}

function WeeklyReportView({ data }: WeeklyReportProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          Week of {formatDate(data.weekStartDate)} - {formatDate(data.weekEndDate)}
        </h2>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Total Sales" value={formatCurrency(data.totals.sales)} />
        <SummaryCard label="Transactions" value={data.totals.transactions.toString()} />
        <SummaryCard label="Fuel Sales" value={formatCurrency(data.totals.fuelSales)} />
        <SummaryCard label="Merchandise" value={formatCurrency(data.totals.merchandiseSales)} />
      </div>

      {/* Daily Breakdown */}
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Day</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
              Sales
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
              Trans
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
              Fuel
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
              Merch
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {data.dailyData.map((day) => (
            <tr key={day.date}>
              <td className="px-4 py-3 text-sm text-gray-900">{formatDayDate(day.date)}</td>
              <td className="px-4 py-3 text-sm text-gray-900 text-right">
                {formatCurrency(day.totalSales)}
              </td>
              <td className="px-4 py-3 text-sm text-gray-900 text-right">{day.transactionCount}</td>
              <td className="px-4 py-3 text-sm text-gray-900 text-right">
                {formatCurrency(day.fuelSales)}
              </td>
              <td className="px-4 py-3 text-sm text-gray-900 text-right">
                {formatCurrency(day.merchandiseSales)}
              </td>
              <td className="px-4 py-3 text-center">
                <StatusBadge status={day.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface MonthlyReportProps {
  data: {
    year: number;
    month: number;
    summaries: Array<{
      date: string;
      totalSales: number;
      totalTransactions: number;
      status: 'OPEN' | 'CLOSED';
    }>;
    totals: {
      sales: number;
      transactions: number;
      closedDays: number;
      openDays: number;
    };
  };
}

function MonthlyReportView({ data }: MonthlyReportProps) {
  const monthName = new Date(data.year, data.month - 1).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">{monthName}</h2>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Total Sales" value={formatCurrency(data.totals.sales)} />
        <SummaryCard label="Transactions" value={data.totals.transactions.toString()} />
        <SummaryCard label="Closed Days" value={data.totals.closedDays.toString()} />
        <SummaryCard label="Open Days" value={data.totals.openDays.toString()} />
      </div>

      {/* Summary Table */}
      <div className="max-h-96 overflow-y-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Date
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                Sales
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                Trans
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.summaries.map((day) => (
              <tr key={day.date}>
                <td className="px-4 py-3 text-sm text-gray-900">{formatDayDate(day.date)}</td>
                <td className="px-4 py-3 text-sm text-gray-900 text-right">
                  {formatCurrency(day.totalSales)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 text-right">
                  {day.totalTransactions}
                </td>
                <td className="px-4 py-3 text-center">
                  <StatusBadge status={day.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface CustomReportProps {
  data: {
    startDate: string;
    endDate: string;
    summaries: Array<{
      date: string;
      totalSales: number;
      totalTransactions: number;
      status: 'OPEN' | 'CLOSED';
    }>;
    totals: {
      sales: number;
      transactions: number;
      dayCount: number;
    };
  };
}

function CustomReportView({ data }: CustomReportProps) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">
        {formatDate(data.startDate)} - {formatDate(data.endDate)}
      </h2>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard label="Total Sales" value={formatCurrency(data.totals.sales)} />
        <SummaryCard label="Transactions" value={data.totals.transactions.toString()} />
        <SummaryCard label="Days" value={data.totals.dayCount.toString()} />
      </div>

      {/* Summary Table */}
      <div className="max-h-96 overflow-y-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Date
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                Sales
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                Trans
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.summaries.map((day) => (
              <tr key={day.date}>
                <td className="px-4 py-3 text-sm text-gray-900">{formatDayDate(day.date)}</td>
                <td className="px-4 py-3 text-sm text-gray-900 text-right">
                  {formatCurrency(day.totalSales)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 text-right">
                  {day.totalTransactions}
                </td>
                <td className="px-4 py-3 text-center">
                  <StatusBadge status={day.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
        active ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );
}

interface SummaryCardProps {
  label: string;
  value: string;
}

function SummaryCard({ label, value }: SummaryCardProps) {
  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  );
}

interface StatusBadgeProps {
  status: 'OPEN' | 'CLOSED' | 'NO_DATA';
}

function StatusBadge({ status }: StatusBadgeProps) {
  const styles = {
    OPEN: 'bg-yellow-100 text-yellow-800',
    CLOSED: 'bg-green-100 text-green-800',
    NO_DATA: 'bg-gray-100 text-gray-500',
  };

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${styles[status]}`}>
      {status === 'NO_DATA' ? 'No Data' : status}
    </span>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function getLastWeekStart(): string {
  const date = new Date();
  date.setDate(date.getDate() - 7 - date.getDay()); // Last week's Sunday
  return date.toISOString().split('T')[0];
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDayDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}
