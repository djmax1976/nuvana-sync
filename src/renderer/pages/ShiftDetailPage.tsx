/**
 * Shift Detail Page
 *
 * Shows detailed information about a single shift including summary and transactions.
 *
 * @module renderer/pages/ShiftDetailPage
 */

import React from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useShift, useShiftSummary, useCloseShift } from '../lib/hooks';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';

export default function ShiftDetailPage() {
  const { shiftId } = useParams<{ shiftId: string }>();
  const navigate = useNavigate();

  const { data: shift, isLoading: shiftLoading, error: shiftError } = useShift(shiftId || null);
  const { data: summary, isLoading: summaryLoading } = useShiftSummary(shiftId || null);
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
        <Link to="/shifts" className="text-blue-600 hover:text-blue-900 text-sm">
          &larr; Back to Shifts
        </Link>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-red-800 font-medium">Error loading shift</h3>
          <p className="text-red-600 text-sm mt-1">
            {shiftError instanceof Error ? shiftError.message : 'Shift not found'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between">
        <Link to="/shifts" className="text-blue-600 hover:text-blue-900 text-sm">
          &larr; Back to Shifts
        </Link>
        {shift.status === 'OPEN' && (
          <button
            onClick={handleCloseShift}
            disabled={closeShiftMutation.isPending}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {closeShiftMutation.isPending ? 'Closing...' : 'Close Shift'}
          </button>
        )}
      </div>

      {/* Shift Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Shift #{shift.shift_number}</h2>
            <p className="text-gray-500 mt-1">{formatDate(shift.business_date)}</p>
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
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Shift Summary</h3>
        {summaryLoading ? (
          <div className="flex items-center justify-center h-24">
            <LoadingSpinner />
          </div>
        ) : summary ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <SummaryCard
              label="Total Sales"
              value={formatCurrency(summary.totalSales)}
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
        ) : (
          <p className="text-gray-500">No summary data available</p>
        )}
      </div>

      {/* Timestamps */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Timestamps</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Created:</span>{' '}
            <span className="text-gray-900">{formatDateTime(shift.created_at)}</span>
          </div>
          <div>
            <span className="text-gray-500">Updated:</span>{' '}
            <span className="text-gray-900">{formatDateTime(shift.updated_at)}</span>
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
    OPEN: 'bg-green-100 text-green-800 border-green-200',
    CLOSED: 'bg-gray-100 text-gray-800 border-gray-200',
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
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-lg font-medium text-gray-900">{value}</p>
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
    green: 'bg-green-50 border-green-200',
    blue: 'bg-blue-50 border-blue-200',
    red: 'bg-red-50 border-red-200',
  };

  return (
    <div className={`p-4 rounded-lg border ${colors[color]}`}>
      <p className="text-sm text-gray-600">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
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
  return new Date(timeStr).toLocaleTimeString(undefined, {
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
