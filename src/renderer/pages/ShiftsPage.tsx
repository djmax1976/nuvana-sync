/**
 * Shifts Page
 *
 * Lists all shifts with filtering and pagination.
 * Allows viewing shift details and navigating to Shift End wizard for closing open shifts.
 *
 * Navigation: Close button redirects to /shift-end?shiftId={id} which provides:
 * - Report scanning (Step 1)
 * - Shift closing with proper closing_cash input (Step 2)
 *
 * @module renderer/pages/ShiftsPage
 */

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useShifts } from '../lib/hooks';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import type { ShiftListParams } from '../lib/transport';

export default function ShiftsPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<ShiftListParams>({
    limit: 20,
    offset: 0,
  });

  const { data, isLoading, error } = useShifts(filters);

  const handleStatusFilter = (status: 'OPEN' | 'CLOSED' | undefined) => {
    setFilters((prev) => ({ ...prev, status, offset: 0 }));
  };

  /**
   * Navigate to Shift End wizard to properly close the shift.
   *
   * The wizard handles:
   * - Report scanning (Step 1)
   * - Shift closing with proper closing_cash input (Step 2)
   *
   * Route: /shift-end?shiftId={shiftId}
   */
  const handleCloseShift = (shiftId: string) => {
    navigate(`/shift-end?shiftId=${shiftId}`);
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
      <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
        <h3 className="text-destructive font-medium">Error loading shifts</h3>
        <p className="text-destructive/80 text-sm mt-1">
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center space-x-4">
        <span className="text-sm text-muted-foreground">Filter by status:</span>
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
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <LoadingSpinner />
          </div>
        ) : data && data.shifts.length > 0 ? (
          <>
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Shift #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Start Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    End Time
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-card divide-y divide-border">
                {data.shifts.map((shift) => (
                  <tr key={shift.shift_id} className="hover:bg-muted/50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground">
                      {shift.shift_number}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(shift.business_date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge status={shift.status} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {shift.start_time ? formatTime(shift.start_time) : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {shift.end_time ? formatTime(shift.end_time) : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                      <Link
                        to={`/shifts/${shift.shift_id}`}
                        className="text-primary hover:text-primary/80"
                      >
                        View
                      </Link>
                      {shift.status === 'OPEN' && (
                        <button
                          onClick={() => handleCloseShift(shift.shift_id)}
                          className="text-destructive hover:text-destructive/80"
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
            <div className="px-6 py-3 bg-muted/50 border-t border-border flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Showing {data.offset + 1} to{' '}
                {Math.min(data.offset + data.shifts.length, data.total)} of {data.total} shifts
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={handlePrevPage}
                  disabled={!filters.offset || filters.offset === 0}
                  className="px-3 py-1 text-sm border border-border rounded text-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted"
                >
                  Previous
                </button>
                <button
                  onClick={handleNextPage}
                  disabled={data.offset + data.limit >= data.total}
                  className="px-3 py-1 text-sm border border-border rounded text-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="p-8 text-center text-muted-foreground">No shifts found</div>
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
          ? 'bg-primary/10 text-primary font-medium'
          : 'bg-muted text-muted-foreground hover:bg-muted/80'
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
    OPEN: 'bg-green-500/10 text-green-600 dark:text-green-400',
    CLOSED: 'bg-muted text-muted-foreground',
  };

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[status]}`}>{status}</span>
  );
}

// ============================================================================
// Formatters
// ============================================================================

/**
 * Format a business date (YYYY-MM-DD) for display.
 *
 * CRITICAL: Business dates must be parsed as LOCAL noon, not UTC midnight.
 * Using `new Date("2026-01-09")` parses as UTC midnight, which displays
 * as Jan 8 at 7 PM in EST (UTC-5) - WRONG!
 *
 * @param dateStr - Business date in YYYY-MM-DD format
 * @returns Formatted date string (e.g., "Jan 9, 2026")
 */
function formatDate(dateStr: string): string {
  // Parse as local noon to avoid timezone edge cases
  // This ensures "2026-01-09" displays as "Jan 9, 2026" everywhere
  const localDate = new Date(dateStr + 'T12:00:00');
  return localDate.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(timeStr: string): string {
  return new Date(timeStr).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
