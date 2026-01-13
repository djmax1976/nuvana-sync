/**
 * Shifts Page
 *
 * Lists all shifts with filtering and pagination.
 * Allows viewing shift details and closing open shifts.
 *
 * @module renderer/pages/ShiftsPage
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useShifts, useCloseShift } from '../lib/hooks';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import type { ShiftListParams } from '../lib/transport';

export default function ShiftsPage() {
  const [filters, setFilters] = useState<ShiftListParams>({
    limit: 20,
    offset: 0,
  });

  const { data, isLoading, error, refetch } = useShifts(filters);
  const closeShiftMutation = useCloseShift();

  const handleStatusFilter = (status: 'OPEN' | 'CLOSED' | undefined) => {
    setFilters((prev) => ({ ...prev, status, offset: 0 }));
  };

  const handleCloseShift = async (shiftId: string) => {
    if (!confirm('Are you sure you want to close this shift?')) return;

    try {
      await closeShiftMutation.mutateAsync(shiftId);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to close shift');
    }
  };

  const handleNextPage = () => {
    if (data && data.offset + data.limit < data.total) {
      setFilters((prev) => ({ ...prev, offset: (prev.offset || 0) + (prev.limit || 20) }));
    }
  };

  const handlePrevPage = () => {
    if (filters.offset && filters.offset > 0) {
      setFilters((prev) => ({
        ...prev,
        offset: Math.max(0, (prev.offset || 0) - (prev.limit || 20)),
      }));
    }
  };

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-red-800 font-medium">Error loading shifts</h3>
        <p className="text-red-600 text-sm mt-1">
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center space-x-4">
        <span className="text-sm text-gray-500">Filter by status:</span>
        <div className="flex space-x-2">
          <FilterButton
            active={filters.status === undefined}
            onClick={() => handleStatusFilter(undefined)}
          >
            All
          </FilterButton>
          <FilterButton
            active={filters.status === 'OPEN'}
            onClick={() => handleStatusFilter('OPEN')}
          >
            Open
          </FilterButton>
          <FilterButton
            active={filters.status === 'CLOSED'}
            onClick={() => handleStatusFilter('CLOSED')}
          >
            Closed
          </FilterButton>
        </div>
      </div>

      {/* Shifts Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <LoadingSpinner />
          </div>
        ) : data && data.shifts.length > 0 ? (
          <>
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Shift #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Start Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    End Time
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.shifts.map((shift) => (
                  <tr key={shift.shift_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {shift.shift_number}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(shift.business_date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge status={shift.status} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {shift.start_time ? formatTime(shift.start_time) : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {shift.end_time ? formatTime(shift.end_time) : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                      <Link
                        to={`/shifts/${shift.shift_id}`}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        View
                      </Link>
                      {shift.status === 'OPEN' && (
                        <button
                          onClick={() => handleCloseShift(shift.shift_id)}
                          disabled={closeShiftMutation.isPending}
                          className="text-red-600 hover:text-red-900 disabled:opacity-50"
                        >
                          Close
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-500">
                Showing {data.offset + 1} to{' '}
                {Math.min(data.offset + data.shifts.length, data.total)} of {data.total} shifts
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={handlePrevPage}
                  disabled={!filters.offset || filters.offset === 0}
                  className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  Previous
                </button>
                <button
                  onClick={handleNextPage}
                  disabled={data.offset + data.limit >= data.total}
                  className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="p-8 text-center text-gray-500">No shifts found</div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

interface FilterButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function FilterButton({ active, onClick, children }: FilterButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-sm rounded-full transition-colors ${
        active
          ? 'bg-blue-100 text-blue-700 font-medium'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      {children}
    </button>
  );
}

interface StatusBadgeProps {
  status: 'OPEN' | 'CLOSED';
}

function StatusBadge({ status }: StatusBadgeProps) {
  const colors = {
    OPEN: 'bg-green-100 text-green-800',
    CLOSED: 'bg-gray-100 text-gray-800',
  };

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[status]}`}>{status}</span>
  );
}

// ============================================================================
// Formatters
// ============================================================================

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(timeStr: string): string {
  return new Date(timeStr).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}
