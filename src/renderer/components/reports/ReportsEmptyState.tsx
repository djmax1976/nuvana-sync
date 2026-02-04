/**
 * Reports Empty State Component
 *
 * Displays a user-friendly empty state when no report data is available.
 * Provides contextual messaging and an optional action button.
 *
 * @module renderer/components/reports/ReportsEmptyState
 * @security SEC-004: XSS prevention via React's automatic escaping
 * @security FE-001: No dangerouslySetInnerHTML, all content is text
 * @accessibility A11Y-001: Descriptive text for screen readers
 */

import * as React from 'react';
import { FileText, Calendar, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export type EmptyStateVariant = 'no-data' | 'no-results' | 'select-range';

export interface ReportsEmptyStateProps {
  /** The variant that determines the icon, title, and description */
  variant: EmptyStateVariant;
  /** Optional custom title override */
  title?: string;
  /** Optional custom description override */
  description?: string;
  /** Optional action button label */
  actionLabel?: string;
  /** Optional action callback */
  onAction?: () => void;
  /** Additional CSS classes */
  className?: string;
  /** Test ID for testing purposes */
  'data-testid'?: string;
}

/**
 * Configuration for each empty state variant
 */
const VARIANT_CONFIG: Record<
  EmptyStateVariant,
  {
    Icon: React.ElementType;
    defaultTitle: string;
    defaultDescription: string;
    iconColorClass: string;
    iconBgClass: string;
  }
> = {
  'no-data': {
    Icon: FileText,
    defaultTitle: 'No shifts found',
    defaultDescription:
      'There are no shifts recorded for the selected date range. Try selecting a different period.',
    iconColorClass: 'text-muted-foreground',
    iconBgClass: 'bg-muted',
  },
  'no-results': {
    Icon: Search,
    defaultTitle: 'No results',
    defaultDescription:
      'No report data matches your current filters. Adjust the date range or report type to see results.',
    iconColorClass: 'text-info',
    iconBgClass: 'bg-info-light',
  },
  'select-range': {
    Icon: Calendar,
    defaultTitle: 'Select a date range',
    defaultDescription: 'Choose a start and end date to generate your report.',
    iconColorClass: 'text-primary',
    iconBgClass: 'bg-primary-light',
  },
};

/**
 * ReportsEmptyState Component
 *
 * Renders a visually informative empty state with an icon, title,
 * description, and optional action button. Uses the design system's
 * empty-state utility classes from globals.css.
 *
 * Security Compliance:
 * - SEC-004: XSS prevention via React's automatic escaping
 * - FE-001: No use of dangerouslySetInnerHTML
 *
 * Accessibility Compliance:
 * - A11Y-001: Icon is decorative (aria-hidden), descriptive text provided
 * - A11Y-002: Action button is keyboard accessible
 * - A11Y-006: All interactive elements have accessible names
 *
 * @example
 * <ReportsEmptyState variant="no-data" />
 * <ReportsEmptyState
 *   variant="select-range"
 *   actionLabel="Set Date Range"
 *   onAction={() => setShowPicker(true)}
 * />
 */
export const ReportsEmptyState = React.memo(function ReportsEmptyState({
  variant,
  title,
  description,
  actionLabel,
  onAction,
  className,
  'data-testid': testId,
}: ReportsEmptyStateProps) {
  const config = VARIANT_CONFIG[variant];
  const { Icon } = config;

  return (
    <div
      className={cn('empty-state', className)}
      data-testid={testId ?? `reports-empty-state-${variant}`}
    >
      {/* Icon */}
      <div
        className={cn(
          'mb-4 flex h-16 w-16 items-center justify-center rounded-2xl',
          config.iconBgClass
        )}
        aria-hidden="true"
      >
        <Icon className={cn('h-8 w-8', config.iconColorClass)} />
      </div>

      {/* Title */}
      <h3 className="empty-state-title">{title ?? config.defaultTitle}</h3>

      {/* Description */}
      <p className="empty-state-description">{description ?? config.defaultDescription}</p>

      {/* Action Button */}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className={cn(
            'mt-5 rounded-lg px-5 py-2.5 text-sm font-semibold',
            'bg-primary text-primary-foreground',
            'transition-colors hover:bg-primary/90',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
          )}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
});

ReportsEmptyState.displayName = 'ReportsEmptyState';
