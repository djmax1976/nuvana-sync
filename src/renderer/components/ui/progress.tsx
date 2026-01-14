import * as React from 'react';
import { cn } from '../../lib/utils';

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
  'aria-label'?: string;
}

/**
 * Progress - Simple progress bar component
 *
 * @description A horizontal progress indicator that shows completion status.
 * Uses CSS custom properties for theming.
 *
 * @accessibility Includes proper ARIA attributes for screen readers
 */
const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, max = 100, 'aria-label': ariaLabel, ...props }, ref) => {
    const percentage = Math.min(100, Math.max(0, (value / max) * 100));

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={ariaLabel}
        className={cn(
          'relative h-2 w-full overflow-hidden rounded-full bg-secondary/20',
          className
        )}
        {...props}
      >
        <div
          className="h-full bg-primary transition-all duration-300 ease-in-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    );
  }
);

Progress.displayName = 'Progress';

export { Progress };
export type { ProgressProps };
