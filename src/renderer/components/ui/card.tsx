import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

/* ============================================================================
   CARD VARIANTS
   Enterprise-grade card component with consistent styling
   ============================================================================ */

const cardVariants = cva(
  'rounded-xl border bg-card text-card-foreground transition-all duration-200',
  {
    variants: {
      variant: {
        default: 'shadow-card hover:shadow-card-hover',
        flat: 'shadow-none',
        elevated: 'shadow-md hover:shadow-lg',
        outline: 'shadow-none border-border',
        ghost: 'border-transparent shadow-none bg-transparent',
      },
      padding: {
        default: '', // Let children handle padding
        none: '',
        sm: 'p-3',
        md: 'p-4',
        lg: 'p-6',
      },
    },
    defaultVariants: {
      variant: 'default',
      padding: 'default',
    },
  }
);

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {
  asChild?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, padding, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant, padding, className }))} {...props} />
  )
);
Card.displayName = 'Card';

/* ============================================================================
   CARD HEADER
   ============================================================================ */

const cardHeaderVariants = cva('flex flex-col space-y-1.5', {
  variants: {
    size: {
      default: 'p-6',
      sm: 'p-4',
      compact: 'p-4 pb-2',
    },
  },
  defaultVariants: {
    size: 'default',
  },
});

export interface CardHeaderProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardHeaderVariants> {}

const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, size, ...props }, ref) => (
    <div ref={ref} className={cn(cardHeaderVariants({ size, className }))} {...props} />
  )
);
CardHeader.displayName = 'CardHeader';

/* ============================================================================
   CARD TITLE
   ============================================================================ */

const cardTitleVariants = cva('font-semibold leading-none tracking-tight', {
  variants: {
    size: {
      default: 'text-2xl',
      lg: 'text-xl',
      md: 'text-lg',
      sm: 'text-base',
      xs: 'text-sm',
    },
  },
  defaultVariants: {
    size: 'default',
  },
});

export interface CardTitleProps
  extends React.HTMLAttributes<HTMLHeadingElement>, VariantProps<typeof cardTitleVariants> {}

const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, size, ...props }, ref) => (
    <h3 ref={ref} className={cn(cardTitleVariants({ size, className }))} {...props} />
  )
);
CardTitle.displayName = 'CardTitle';

/* ============================================================================
   CARD DESCRIPTION
   ============================================================================ */

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

/* ============================================================================
   CARD CONTENT
   ============================================================================ */

const cardContentVariants = cva('', {
  variants: {
    size: {
      default: 'p-6 pt-0',
      sm: 'p-4 pt-0',
      compact: 'p-4 pt-2',
      none: '',
    },
  },
  defaultVariants: {
    size: 'default',
  },
});

export interface CardContentProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardContentVariants> {}

const CardContent = React.forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, size, ...props }, ref) => (
    <div ref={ref} className={cn(cardContentVariants({ size, className }))} {...props} />
  )
);
CardContent.displayName = 'CardContent';

/* ============================================================================
   CARD FOOTER
   ============================================================================ */

const cardFooterVariants = cva('flex items-center', {
  variants: {
    size: {
      default: 'p-6 pt-0',
      sm: 'p-4 pt-0',
      compact: 'p-4 pt-2',
    },
  },
  defaultVariants: {
    size: 'default',
  },
});

export interface CardFooterProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardFooterVariants> {}

const CardFooter = React.forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, size, ...props }, ref) => (
    <div ref={ref} className={cn(cardFooterVariants({ size, className }))} {...props} />
  )
);
CardFooter.displayName = 'CardFooter';

/* ============================================================================
   STAT CARD
   Specialized card for displaying KPIs and statistics
   ============================================================================ */

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
  iconVariant?: 'primary' | 'success' | 'warning' | 'destructive' | 'info';
  trend?: {
    value: number;
    label?: string;
  };
  subtitle?: string;
}

const iconVariantStyles = {
  primary: 'bg-primary-light text-primary',
  success: 'bg-success-light text-success',
  warning: 'bg-warning-light text-warning',
  destructive: 'bg-destructive-light text-destructive',
  info: 'bg-info-light text-info',
};

const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  ({ className, title, value, icon, iconVariant = 'primary', trend, subtitle, ...props }, ref) => (
    <Card ref={ref} className={cn('p-4', className)} {...props}>
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          {trend && (
            <div className="flex items-center gap-1">
              <span
                className={cn(
                  'text-xs font-medium',
                  trend.value >= 0 ? 'text-success' : 'text-destructive'
                )}
              >
                {trend.value >= 0 ? '+' : ''}
                {trend.value}%
              </span>
              {trend.label && <span className="text-xs text-muted-foreground">{trend.label}</span>}
            </div>
          )}
        </div>
        {icon && (
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
              iconVariantStyles[iconVariant]
            )}
          >
            {icon}
          </div>
        )}
      </div>
    </Card>
  )
);
StatCard.displayName = 'StatCard';

/* ============================================================================
   DASHBOARD CARD
   Consistent wrapper for dashboard widgets
   ============================================================================ */

export interface DashboardCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  noPadding?: boolean;
}

const DashboardCard = React.forwardRef<HTMLDivElement, DashboardCardProps>(
  ({ className, title, subtitle, action, noPadding, children, ...props }, ref) => (
    <Card ref={ref} className={cn(className)} {...props}>
      {(title || action) && (
        <div className="flex items-center justify-between p-4 pb-0">
          <div>
            {title && <h3 className="text-sm font-semibold">{title}</h3>}
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className={cn(noPadding ? '' : 'p-4')}>{children}</div>
    </Card>
  )
);
DashboardCard.displayName = 'DashboardCard';

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
  StatCard,
  DashboardCard,
  cardVariants,
};
