import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

/* ============================================================================
   BADGE VARIANTS
   Consistent badge/tag styling across the application
   ============================================================================ */

const badgeVariants = cva(
  'inline-flex items-center rounded-full border font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        // Solid variants - filled background
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        success: 'border-transparent bg-success text-success-foreground',
        warning: 'border-transparent bg-warning text-warning-foreground',
        info: 'border-transparent bg-info text-info-foreground',

        // Soft variants - light background with darker text (like reference image)
        'soft-primary': 'border-transparent bg-primary-light text-primary',
        'soft-success': 'border-transparent bg-success-light text-success-muted',
        'soft-warning': 'border-transparent bg-warning-light text-warning-muted',
        'soft-destructive': 'border-transparent bg-destructive-light text-destructive-muted',
        'soft-info': 'border-transparent bg-info-light text-info-muted',
        'soft-neutral': 'border-transparent bg-muted text-muted-foreground',

        // Outline variant
        outline: 'border-border text-foreground bg-transparent',

        // Dot variants - with colored dot indicator
        'dot-success': 'border-border bg-background text-foreground',
        'dot-warning': 'border-border bg-background text-foreground',
        'dot-destructive': 'border-border bg-background text-foreground',
        'dot-info': 'border-border bg-background text-foreground',
      },
      size: {
        default: 'px-2.5 py-0.5 text-xs',
        sm: 'px-2 py-0.5 text-[10px]',
        lg: 'px-3 py-1 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {
  /** Show a dot indicator before the text */
  dot?: boolean;
  /** Color of the dot indicator */
  dotColor?: 'success' | 'warning' | 'destructive' | 'info' | 'primary' | 'neutral';
  /** Remove the badge (for use with animations) */
  removable?: boolean;
  /** Callback when remove button is clicked */
  onRemove?: () => void;
}

const dotColorClasses = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  info: 'bg-info',
  primary: 'bg-primary',
  neutral: 'bg-muted-foreground',
};

function Badge({
  className,
  variant,
  size,
  dot,
  dotColor = 'neutral',
  removable,
  onRemove,
  children,
  ...props
}: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {dot && <span className={cn('mr-1.5 h-1.5 w-1.5 rounded-full', dotColorClasses[dotColor])} />}
      {children}
      {removable && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-1 -mr-0.5 h-3.5 w-3.5 rounded-full hover:bg-foreground/20 inline-flex items-center justify-center"
          aria-label="Remove"
        >
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

/* ============================================================================
   STATUS BADGE
   Pre-configured badge for common status states
   ============================================================================ */

export type StatusType = 'active' | 'inactive' | 'pending' | 'completed' | 'failed' | 'cancelled';

const statusConfig: Record<StatusType, { variant: BadgeProps['variant']; label: string }> = {
  active: { variant: 'soft-success', label: 'Active' },
  inactive: { variant: 'soft-neutral', label: 'Inactive' },
  pending: { variant: 'soft-warning', label: 'Pending' },
  completed: { variant: 'soft-success', label: 'Completed' },
  failed: { variant: 'soft-destructive', label: 'Failed' },
  cancelled: { variant: 'soft-neutral', label: 'Cancelled' },
};

export interface StatusBadgeProps extends Omit<BadgeProps, 'variant' | 'children'> {
  status: StatusType;
  customLabel?: string;
}

function StatusBadge({ status, customLabel, ...props }: StatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <Badge variant={config.variant} {...props}>
      {customLabel || config.label}
    </Badge>
  );
}

/* ============================================================================
   COUNT BADGE
   Small badge for showing counts (notifications, items, etc.)
   ============================================================================ */

export interface CountBadgeProps extends Omit<BadgeProps, 'children'> {
  count: number;
  max?: number;
  showZero?: boolean;
}

function CountBadge({
  count,
  max = 99,
  showZero = false,
  variant = 'default',
  size = 'sm',
  ...props
}: CountBadgeProps) {
  if (count === 0 && !showZero) return null;

  const displayCount = count > max ? `${max}+` : count.toString();

  return (
    <Badge variant={variant} size={size} className="min-w-[1.25rem] justify-center" {...props}>
      {displayCount}
    </Badge>
  );
}

export { Badge, StatusBadge, CountBadge, badgeVariants };
