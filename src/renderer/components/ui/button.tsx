import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

/* ============================================================================
   BUTTON VARIANTS
   Enterprise-grade button component with consistent styling
   ============================================================================ */

const buttonVariants = cva(
  // Base styles
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Primary action button - Blue
        default:
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/80',

        // Destructive action - Red
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:bg-destructive/80',

        // Success action - Green
        success:
          'bg-success text-success-foreground shadow-sm hover:bg-success/90 active:bg-success/80',

        // Warning action - Amber
        warning:
          'bg-warning text-warning-foreground shadow-sm hover:bg-warning/90 active:bg-warning/80',

        // Outline button - Border with transparent background
        outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground active:bg-accent/80',

        // Secondary button - Subtle background
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70',

        // Ghost button - No background until hover
        ghost: 'hover:bg-accent hover:text-accent-foreground active:bg-accent/80',

        // Link style - Text only with underline
        link: 'text-primary underline-offset-4 hover:underline',

        // Soft variants - Colored background with darker text (like the image)
        'soft-primary':
          'bg-primary-light text-primary hover:bg-primary-light/80 active:bg-primary-light/70',
        'soft-success':
          'bg-success-light text-success-muted hover:bg-success-light/80 active:bg-success-light/70',
        'soft-warning':
          'bg-warning-light text-warning-muted hover:bg-warning-light/80 active:bg-warning-light/70',
        'soft-destructive':
          'bg-destructive-light text-destructive-muted hover:bg-destructive-light/80 active:bg-destructive-light/70',
        'soft-info': 'bg-info-light text-info-muted hover:bg-info-light/80 active:bg-info-light/70',
      },
      size: {
        default: 'h-10 px-4 py-2',
        xs: 'h-7 rounded-md px-2 text-xs',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-lg px-8',
        xl: 'h-12 rounded-lg px-10 text-base',
        icon: 'h-10 w-10',
        'icon-sm': 'h-8 w-8',
        'icon-xs': 'h-6 w-6 rounded-md',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading,
      leftIcon,
      rightIcon,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button';
    const isDisabled = disabled || loading;

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={isDisabled}
        {...props}
      >
        {loading && (
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {!loading && leftIcon}
        {children}
        {!loading && rightIcon}
      </Comp>
    );
  }
);
Button.displayName = 'Button';

/* ============================================================================
   ICON BUTTON
   Specialized button for icon-only actions
   ============================================================================ */

export interface IconButtonProps extends Omit<ButtonProps, 'leftIcon' | 'rightIcon' | 'children'> {
  icon: React.ReactNode;
  'aria-label': string;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, icon, size = 'icon', variant = 'ghost', ...props }, ref) => (
    <Button ref={ref} className={className} size={size} variant={variant} {...props}>
      {icon}
    </Button>
  )
);
IconButton.displayName = 'IconButton';

/* ============================================================================
   BUTTON GROUP
   For grouping related buttons together
   ============================================================================ */

export interface ButtonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  attached?: boolean;
}

const ButtonGroup = React.forwardRef<HTMLDivElement, ButtonGroupProps>(
  ({ className, attached, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'inline-flex',
        attached
          ? '[&>button]:rounded-none [&>button:first-child]:rounded-l-lg [&>button:last-child]:rounded-r-lg [&>button:not(:first-child)]:border-l-0'
          : 'gap-2',
        className
      )}
      role="group"
      {...props}
    >
      {children}
    </div>
  )
);
ButtonGroup.displayName = 'ButtonGroup';

export { Button, IconButton, ButtonGroup, buttonVariants };
