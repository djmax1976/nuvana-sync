/**
 * Day Accordion Skeleton Component
 *
 * Loading skeleton for the DayAccordion component.
 * Provides visual feedback during data fetching with animated placeholders.
 * Matches the exact layout of DayAccordion to prevent layout shift.
 *
 * @module renderer/components/reports/DayAccordionSkeleton
 * @security SEC-004: No user content - purely decorative skeleton
 * @performance PERF-002: Uses React.memo for optimization
 * @accessibility A11Y-001: Uses aria-hidden to hide from screen readers
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface DayAccordionSkeletonProps {
  /** Number of skeleton rows to show in the table */
  rowCount?: number;
  /** Whether to show the expanded table skeleton */
  showTable?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Test ID for testing purposes */
  'data-testid'?: string;
}

/**
 * Skeleton row component for the shift table
 * Renders a single row of skeleton cells
 */
const SkeletonTableRow = React.memo(function SkeletonTableRow({
  index: _index,
}: {
  index: number;
}) {
  return (
    <tr className="border-b border-border/30">
      {/* Register */}
      <td className="px-6 py-4">
        <div className="flex items-center gap-2.5">
          <div className="h-2 w-2 shrink-0 rounded-full skeleton" />
          <div className="h-4 w-16 skeleton rounded" />
        </div>
      </td>
      {/* Shift Number */}
      <td className="px-6 py-4">
        <div className="h-7 w-7 skeleton rounded-lg" />
      </td>
      {/* Time */}
      <td className="px-6 py-4">
        <div className="h-4 w-32 skeleton rounded" />
      </td>
      {/* Employee */}
      <td className="px-6 py-4">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 skeleton rounded-full" />
          <div className="h-4 w-24 skeleton rounded" />
        </div>
      </td>
      {/* Status */}
      <td className="px-6 py-4">
        <div className="h-6 w-20 skeleton rounded-full" />
      </td>
      {/* Action */}
      <td className="px-6 py-4">
        <div className="h-5 w-5 skeleton rounded" />
      </td>
    </tr>
  );
});

SkeletonTableRow.displayName = 'SkeletonTableRow';

/**
 * DayAccordionSkeleton Component
 *
 * Renders a loading skeleton that matches the DayAccordion layout.
 * Features:
 * - Fixed header height (min-height: 88px) matching DayAccordion
 * - Optional expanded table skeleton
 * - Smooth pulse animation for loading feedback
 *
 * Security Compliance:
 * - SEC-004: No user-generated content, purely decorative
 *
 * Performance Compliance:
 * - PERF-002: Uses React.memo for the component
 *
 * Accessibility Compliance:
 * - A11Y-001: Uses aria-hidden to hide from assistive technologies
 * - aria-busy indicates loading state for screen readers
 * - Decorative elements properly hidden
 *
 * @example
 * // Single skeleton with collapsed state
 * <DayAccordionSkeleton />
 *
 * // Expanded skeleton with table rows
 * <DayAccordionSkeleton showTable rowCount={4} />
 *
 * // Multiple skeletons for loading state
 * {[...Array(3)].map((_, i) => (
 *   <DayAccordionSkeleton key={i} showTable={i === 0} />
 * ))}
 */
export const DayAccordionSkeleton = React.memo(function DayAccordionSkeleton({
  rowCount = 3,
  showTable = false,
  className,
  'data-testid': testId,
}: DayAccordionSkeletonProps) {
  return (
    <div
      className={cn('overflow-hidden rounded-xl bg-card shadow-card', className)}
      data-testid={testId ?? 'day-accordion-skeleton'}
      aria-hidden="true"
      aria-busy="true"
      role="presentation"
    >
      {/* Header Skeleton - Fixed height matching DayAccordion */}
      <div
        className={cn(
          'flex items-center border-b border-border px-6 py-5',
          'min-h-[88px] box-border',
          'bg-gradient-to-r from-muted/50 to-card'
        )}
      >
        {/* Chevron Skeleton */}
        <div className="mr-3 h-5 w-5 shrink-0 skeleton rounded" />

        {/* Calendar Icon Skeleton */}
        <div className="mr-4 h-12 w-12 shrink-0 skeleton rounded-xl" />

        {/* Title and Summary Skeleton */}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-5 w-48 skeleton rounded" />
          <div className="h-4 w-32 skeleton rounded" />
        </div>

        {/* View Day Button Skeleton */}
        <div className="h-10 w-24 shrink-0 skeleton rounded-lg" />
      </div>

      {/* Table Skeleton - Only shown when expanded */}
      {showTable && (
        <div className="overflow-hidden">
          <table className="w-full border-collapse">
            {/* Table Header Skeleton */}
            <thead className="bg-muted/50">
              <tr>
                <th className="px-6 py-3 text-left">
                  <div className="h-3 w-16 skeleton rounded" />
                </th>
                <th className="px-6 py-3 text-left">
                  <div className="h-3 w-10 skeleton rounded" />
                </th>
                <th className="px-6 py-3 text-left">
                  <div className="h-3 w-10 skeleton rounded" />
                </th>
                <th className="px-6 py-3 text-left">
                  <div className="h-3 w-16 skeleton rounded" />
                </th>
                <th className="px-6 py-3 text-left">
                  <div className="h-3 w-12 skeleton rounded" />
                </th>
                <th className="px-6 py-3 text-left">
                  <div className="h-3 w-4 skeleton rounded" />
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Register Group Skeleton */}
              <tr className="register-group-row">
                <td colSpan={6} className="bg-muted/50 px-6 py-2">
                  <div className="h-3 w-20 skeleton rounded" />
                </td>
              </tr>
              {/* Data Rows Skeleton */}
              {Array.from({ length: rowCount }, (_, index) => (
                <SkeletonTableRow key={index} index={index} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});

DayAccordionSkeleton.displayName = 'DayAccordionSkeleton';
