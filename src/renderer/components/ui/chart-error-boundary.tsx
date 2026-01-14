import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './button';
import { Card } from './card';

/**
 * Chart Error Boundary
 *
 * Catches rendering errors in chart components and displays a graceful fallback.
 * Implements enterprise error handling patterns with retry capability.
 *
 * @example
 * <ChartErrorBoundary chartName="Sales Chart">
 *   <SalesChart data={data} />
 * </ChartErrorBoundary>
 */

interface ChartErrorBoundaryProps {
  children: ReactNode;
  /** Name of the chart for error messages */
  chartName?: string;
  /** Callback when error occurs */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  /** Custom fallback component */
  fallback?: ReactNode;
  /** Height of the fallback container */
  height?: string | number;
}

interface ChartErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

export class ChartErrorBoundary extends Component<
  ChartErrorBoundaryProps,
  ChartErrorBoundaryState
> {
  private readonly MAX_RETRIES = 2;

  constructor(props: ChartErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      retryCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ChartErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log error for monitoring
    console.error('[ChartErrorBoundary] Chart rendering failed:', {
      chartName: this.props.chartName || 'Unknown',
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
    });

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    if (this.state.retryCount < this.MAX_RETRIES) {
      this.setState((prev) => ({
        hasError: false,
        error: null,
        retryCount: prev.retryCount + 1,
      }));
    }
  };

  render(): ReactNode {
    const { hasError, error, retryCount } = this.state;
    const { children, chartName, fallback, height = '200px' } = this.props;

    if (hasError) {
      // Use custom fallback if provided
      if (fallback) {
        return fallback;
      }

      // Default error UI
      return (
        <Card
          className="flex flex-col items-center justify-center bg-muted/30 border-dashed"
          style={{
            height: typeof height === 'number' ? `${height}px` : height,
          }}
          role="alert"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-3 p-4 text-center">
            <div className="p-2 rounded-full bg-warning/10">
              <AlertTriangle className="w-5 h-5 text-warning" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Unable to load {chartName || 'chart'}
              </p>
              <p className="text-xs text-muted-foreground">
                {error?.message || 'An unexpected error occurred'}
              </p>
            </div>
            {retryCount < this.MAX_RETRIES && (
              <Button variant="outline" size="sm" onClick={this.handleRetry} className="mt-2">
                <RefreshCw className="w-3 h-3 mr-1.5" aria-hidden="true" />
                Try Again
              </Button>
            )}
            {retryCount >= this.MAX_RETRIES && (
              <p className="text-xs text-muted-foreground">
                Please refresh the page or contact support.
              </p>
            )}
          </div>
        </Card>
      );
    }

    return children;
  }
}

/**
 * Hook for manual error boundary triggering
 * Useful for catching async errors in chart data loading
 */
export function useChartError() {
  const [error, setError] = React.useState<Error | null>(null);

  const reportError = React.useCallback((err: Error) => {
    console.error('[useChartError] Error reported:', err);
    setError(err);
  }, []);

  const clearError = React.useCallback(() => {
    setError(null);
  }, []);

  // If error is set, throw it to be caught by error boundary
  if (error) {
    throw error;
  }

  return { reportError, clearError };
}
