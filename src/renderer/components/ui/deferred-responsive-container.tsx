import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ResponsiveContainer, ResponsiveContainerProps } from 'recharts';

/**
 * DeferredResponsiveContainer
 *
 * A robust wrapper around Recharts' ResponsiveContainer that prevents
 * the "width(-1) and height(-1)" console warnings by:
 *
 * 1. Deferring chart rendering until container has valid dimensions
 * 2. Using multiple detection strategies (RAF, ResizeObserver, timeout fallback)
 * 3. Enforcing minimum dimensions on the wrapper to prevent zero-size containers
 * 4. Handling edge cases like hidden containers and flexbox layouts
 *
 * @security No user input is processed - pure layout component
 * @accessibility Wrapper maintains proper focus flow
 *
 * @example
 * <DeferredResponsiveContainer width="100%" height={200}>
 *   <AreaChart data={data}>...</AreaChart>
 * </DeferredResponsiveContainer>
 */

interface DeferredResponsiveContainerProps extends ResponsiveContainerProps {
  /** Fallback timeout in ms if dimension detection fails (default: 100) */
  fallbackTimeout?: number;
}

/**
 * Minimum dimension threshold for valid rendering.
 * Recharts requires dimensions > 0; we use 10 as a safe threshold.
 */
const MIN_VALID_DIMENSION = 10;

/**
 * Maximum RAF attempts before falling back to timeout.
 * Prevents infinite loops in edge cases.
 */
const MAX_RAF_ATTEMPTS = 10;

/**
 * Parse dimension prop to determine if it's a fixed pixel value.
 * This handles cases like: 200, "200", "200px", "100%", undefined
 */
function parsePixelValue(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    // Handle percentage - not a fixed pixel value
    if (value.includes('%')) return null;
    // Parse pixel value like "200" or "200px"
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Parse minWidth/minHeight to numeric values.
 * ResponsiveContainerProps allows string | number | undefined.
 */
function parseMinDimension(value: string | number | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseFloat(value) || 0;
  return 0;
}

export function DeferredResponsiveContainer({
  children,
  minWidth = 0,
  minHeight = 0,
  fallbackTimeout = 100,
  width,
  height,
  ...props
}: DeferredResponsiveContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(false);
  const rafCountRef = useRef(0);

  // Memoize dimension calculations to prevent unnecessary re-renders
  const { fixedWidth, fixedHeight, hasFixedDimensions } = useMemo(() => {
    const fw = parsePixelValue(width);
    const fh = parsePixelValue(height);
    return {
      fixedWidth: fw,
      fixedHeight: fh,
      hasFixedDimensions: fw !== null && fw > 0 && fh !== null && fh > 0,
    };
  }, [width, height]);

  // If we have fixed dimensions, start as ready immediately (no effect needed)
  const [isReady, setIsReady] = useState(() => hasFixedDimensions);

  // Update readyRef when state changes
  useEffect(() => {
    readyRef.current = isReady;
  }, [isReady]);

  /**
   * Mark container as ready for chart rendering
   */
  const markReady = useCallback(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    setIsReady(true);
  }, []);

  /**
   * Check if container has valid dimensions
   */
  const checkDimensions = useCallback((): boolean => {
    const container = containerRef.current;
    if (!container) return false;

    const rect = container.getBoundingClientRect();
    return rect.width >= MIN_VALID_DIMENSION && rect.height >= MIN_VALID_DIMENSION;
  }, []);

  useEffect(() => {
    // Skip if we already have fixed dimensions (initialized as ready)
    if (hasFixedDimensions) return;

    const container = containerRef.current;
    if (!container || readyRef.current) return;

    let resizeObserver: ResizeObserver | null = null;
    let rafId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    /**
     * Strategy 1: ResizeObserver for async dimension detection
     * This catches cases where layout settles after initial render
     */
    resizeObserver = new ResizeObserver((entries) => {
      if (readyRef.current) {
        resizeObserver?.disconnect();
        return;
      }

      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w >= MIN_VALID_DIMENSION && h >= MIN_VALID_DIMENSION) {
          markReady();
          resizeObserver?.disconnect();
          break;
        }
      }
    });
    resizeObserver.observe(container);

    /**
     * Strategy 2: RequestAnimationFrame polling for immediate detection
     * This catches cases where dimensions are available synchronously
     */
    const rafCheck = () => {
      if (readyRef.current) return;

      if (checkDimensions()) {
        markReady();
        return;
      }

      rafCountRef.current++;
      if (rafCountRef.current < MAX_RAF_ATTEMPTS) {
        rafId = requestAnimationFrame(rafCheck);
      }
    };
    rafId = requestAnimationFrame(rafCheck);

    /**
     * Strategy 3: Timeout fallback for edge cases
     * Ensures charts eventually render even in problematic layouts
     */
    timeoutId = setTimeout(() => {
      if (!readyRef.current) {
        // Force render - the container has minimum dimensions enforced
        markReady();
      }
    }, fallbackTimeout);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (timeoutId !== null) clearTimeout(timeoutId);
      resizeObserver?.disconnect();
    };
  }, [hasFixedDimensions, checkDimensions, markReady, fallbackTimeout]);

  const effectiveMinWidth = Math.max(MIN_VALID_DIMENSION, parseMinDimension(minWidth));
  const effectiveMinHeight = Math.max(MIN_VALID_DIMENSION, parseMinDimension(minHeight));

  /**
   * Compute wrapper styles that ensure positive dimensions.
   *
   * The key insight is that we need to enforce minimum dimensions
   * on the wrapper to prevent the zero-size container issue.
   * We use the passed width/height props to determine sizing strategy.
   */
  const wrapperStyle: React.CSSProperties = useMemo(
    () => ({
      // For percentage widths, fill the container
      width: typeof width === 'string' && width.includes('%') ? width : '100%',
      // For fixed heights, use that value; otherwise default to 100%
      height:
        fixedHeight !== null
          ? fixedHeight
          : typeof height === 'string' && height.includes('%')
            ? height
            : '100%',
      // Enforce minimum dimensions to prevent zero-size
      minWidth: effectiveMinWidth,
      minHeight: effectiveMinHeight,
      // Use flexbox to ensure children fill the space
      display: 'flex',
      alignItems: 'stretch',
    }),
    [width, height, fixedHeight, effectiveMinWidth, effectiveMinHeight]
  );

  // Determine the dimensions to pass to ResponsiveContainer
  const containerWidth = fixedWidth !== null ? fixedWidth : '100%';
  const containerHeight = fixedHeight !== null ? fixedHeight : '100%';

  return (
    <div ref={containerRef} style={wrapperStyle} data-deferred-container="true">
      {isReady && (
        <ResponsiveContainer
          width={containerWidth}
          height={containerHeight}
          minWidth={effectiveMinWidth}
          minHeight={effectiveMinHeight}
          {...props}
        >
          {children}
        </ResponsiveContainer>
      )}
    </div>
  );
}
