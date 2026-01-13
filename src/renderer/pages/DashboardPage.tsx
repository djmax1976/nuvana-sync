/**
 * Dashboard Page
 *
 * Main dashboard showing today's stats, sales trend, and recent activity.
 * Uses IPC hooks to fetch data from local SQLite database.
 *
 * @module renderer/pages/DashboardPage
 */

import React from 'react';
import { useDashboardStats, useTodaySales, useWeeklySales, useOpenShifts } from '../lib/hooks';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading, error: statsError } = useDashboardStats();
  const { data: todaySales, isLoading: todayLoading } = useTodaySales();
  const { data: weeklySales, isLoading: weeklyLoading } = useWeeklySales();
  const { data: openShifts } = useOpenShifts();

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (statsError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-red-800 font-medium">Error loading dashboard</h3>
        <p className="text-red-600 text-sm mt-1">
          {statsError instanceof Error ? statsError.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Today's Sales"
          value={formatCurrency(stats?.todaySales || 0)}
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          }
          color="green"
        />
        <StatCard
          title="Transactions"
          value={stats?.todayTransactions?.toString() || '0'}
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
          }
          color="blue"
        />
        <StatCard
          title="Open Shifts"
          value={stats?.openShiftCount?.toString() || '0'}
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          }
          color="yellow"
          alert={stats?.openShiftCount ? stats.openShiftCount > 0 : false}
        />
        <StatCard
          title="Pending Sync"
          value={stats?.pendingSyncCount?.toString() || '0'}
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          }
          color="purple"
        />
      </div>

      {/* Open Shifts Alert */}
      {openShifts && openShifts.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center">
            <svg
              className="w-5 h-5 text-yellow-600 mr-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span className="text-yellow-800 font-medium">
              {openShifts.length} shift{openShifts.length !== 1 ? 's' : ''} still open
            </span>
          </div>
          <p className="text-yellow-700 text-sm mt-1 ml-7">
            Close all shifts before closing the business day.
          </p>
        </div>
      )}

      {/* Weekly Sales Chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Weekly Sales Trend</h2>
        {weeklyLoading ? (
          <div className="flex items-center justify-center h-48">
            <LoadingSpinner />
          </div>
        ) : weeklySales ? (
          <WeeklySalesChart data={weeklySales.dailyData} />
        ) : (
          <p className="text-gray-500">No data available</p>
        )}
      </div>

      {/* Today's Hourly Breakdown */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Today's Sales by Hour</h2>
        {todayLoading ? (
          <div className="flex items-center justify-center h-48">
            <LoadingSpinner />
          </div>
        ) : todaySales ? (
          <HourlySalesTable data={todaySales.hourlyBreakdown} />
        ) : (
          <p className="text-gray-500">No data available</p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

interface StatCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: 'green' | 'blue' | 'yellow' | 'purple';
  alert?: boolean;
}

function StatCard({ title, value, icon, color, alert }: StatCardProps) {
  const colorClasses = {
    green: 'bg-green-100 text-green-600',
    blue: 'bg-blue-100 text-blue-600',
    yellow: 'bg-yellow-100 text-yellow-600',
    purple: 'bg-purple-100 text-purple-600',
  };

  return (
    <div
      className={`bg-white rounded-lg border p-4 min-w-0 ${
        alert ? 'border-yellow-400 ring-1 ring-yellow-400' : 'border-gray-200'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-500 truncate">{title}</p>
          <p className="text-xl sm:text-2xl font-semibold text-gray-900 mt-1 truncate">{value}</p>
        </div>
        <div className={`p-2 sm:p-3 rounded-full shrink-0 ${colorClasses[color]}`}>{icon}</div>
      </div>
    </div>
  );
}

interface WeeklySalesChartProps {
  data: Array<{ date: string; sales: number; transactions: number }>;
}

function WeeklySalesChart({ data }: WeeklySalesChartProps) {
  const maxSales = Math.max(...data.map((d) => d.sales), 1);

  return (
    <div className="space-y-3">
      {data.map((day) => (
        <div key={day.date} className="flex items-center gap-2 sm:gap-4">
          <div className="w-16 sm:w-24 text-xs sm:text-sm text-gray-600 shrink-0 truncate">
            {new Date(day.date).toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
          </div>
          <div className="flex-1 min-w-0 bg-gray-100 rounded-full h-4 overflow-hidden">
            <div
              className="bg-blue-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${(day.sales / maxSales) * 100}%` }}
            />
          </div>
          <div className="w-16 sm:w-24 text-right text-xs sm:text-sm font-medium text-gray-900 shrink-0">
            {formatCurrency(day.sales)}
          </div>
        </div>
      ))}
    </div>
  );
}

interface HourlySalesTableProps {
  data: Array<{ hour: number; sales: number; transactions: number }>;
}

function HourlySalesTable({ data }: HourlySalesTableProps) {
  // Only show hours with activity
  const activeHours = data.filter((h) => h.sales > 0 || h.transactions > 0);

  if (activeHours.length === 0) {
    return <p className="text-gray-500">No sales recorded today yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead>
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
              Hour
            </th>
            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
              Sales
            </th>
            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
              Transactions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {activeHours.map((hour) => (
            <tr key={hour.hour}>
              <td className="px-4 py-2 text-sm text-gray-900">{formatHour(hour.hour)}</td>
              <td className="px-4 py-2 text-sm text-gray-900 text-right">
                {formatCurrency(hour.sales)}
              </td>
              <td className="px-4 py-2 text-sm text-gray-900 text-right">{hour.transactions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Formatters
// ============================================================================

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

function formatHour(hour: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:00 ${period}`;
}
