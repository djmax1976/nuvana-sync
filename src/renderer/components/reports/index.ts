/**
 * Reports Components
 *
 * Exports all report-related UI components for the Reports page.
 * These components implement the shift-by-day view with collapsible accordions.
 *
 * @module renderer/components/reports
 */

// Main accordion component for day sections
export { DayAccordion } from './DayAccordion';
export type { DayAccordionProps } from './DayAccordion';

// Table component for displaying shifts
export { ShiftTable } from './ShiftTable';
export type { ShiftTableProps, ReportShift } from './ShiftTable';

// Status badge for shift status display
export { ShiftStatusBadge } from './ShiftStatusBadge';
export type { ShiftStatusBadgeProps, ReportShiftStatus } from './ShiftStatusBadge';

// Employee avatar with initials
export { EmployeeAvatar, getInitials } from './EmployeeAvatar';
export type { EmployeeAvatarProps, AvatarSize } from './EmployeeAvatar';

// Register group row for table grouping
export { RegisterGroupRow } from './RegisterGroupRow';
export type { RegisterGroupRowProps } from './RegisterGroupRow';

// Loading skeleton for day accordion
export { DayAccordionSkeleton } from './DayAccordionSkeleton';
export type { DayAccordionSkeletonProps } from './DayAccordionSkeleton';

// Empty state for reports views
export { ReportsEmptyState } from './ReportsEmptyState';
export type { ReportsEmptyStateProps, EmptyStateVariant } from './ReportsEmptyState';
