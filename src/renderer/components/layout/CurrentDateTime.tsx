import { useState, useEffect, useCallback } from 'react';

/**
 * Formats a date to a short localized string
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Formats a time to a localized string with consistent formatting
 * Uses 12-hour format for better readability
 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * CurrentDateTime Component
 *
 * Displays the current date and time with live updates every minute.
 * Uses the user's locale for proper internationalization.
 *
 * @requirements
 * - Displays current date and time in the header
 * - Updates automatically every minute
 * - Responsive design with hidden elements on mobile
 */
export function CurrentDateTime() {
  const [currentTime, setCurrentTime] = useState<Date | null>(null);

  const updateTime = useCallback(() => {
    setCurrentTime(new Date());
  }, []);

  useEffect(() => {
    // Initialize time on mount (client-side only to avoid hydration mismatch)
    // Use setTimeout with 0ms to avoid synchronous setState during render
    const initTimeout = setTimeout(() => {
      updateTime();
    }, 0);

    // Calculate milliseconds until the next minute to sync updates
    const now = new Date();
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

    // Set initial timeout to sync with minute boundary
    const initialTimeout = setTimeout(() => {
      updateTime();

      // Then update every minute
      const interval = setInterval(updateTime, 60000);

      // Store interval ID for cleanup
      (
        window as Window & { __dateTimeInterval?: ReturnType<typeof setInterval> }
      ).__dateTimeInterval = interval;
    }, msUntilNextMinute);

    return () => {
      clearTimeout(initTimeout);
      clearTimeout(initialTimeout);
      const interval = (window as Window & { __dateTimeInterval?: ReturnType<typeof setInterval> })
        .__dateTimeInterval;
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [updateTime]);

  // Don't render until client-side to prevent hydration mismatch
  if (!currentTime) {
    return (
      <span
        className="text-xs text-muted-foreground"
        data-testid="current-datetime"
        aria-label="Loading date and time"
      >
        <span className="w-24 h-3 inline-block animate-pulse rounded bg-muted" />
      </span>
    );
  }

  return (
    <span
      className="text-xs text-muted-foreground whitespace-nowrap"
      data-testid="current-datetime"
      aria-live="polite"
    >
      {formatDate(currentTime)} ·{' '}
      <time dateTime={currentTime.toISOString()}>{formatTime(currentTime)}</time>
    </span>
  );
}
