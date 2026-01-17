import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ResponsiveContainer, ResponsiveContainerProps } from 'recharts';

/**
 * DeferredResponsiveContainer
 *
 * A wrapper around Recharts' ResponsiveContainer that defers rendering
 * until the container has valid (positive) dimensions. This prevents
 * the "width(-1) and height(-1)" console warnings that occur when
 * ResponsiveContainer renders before CSS layout is complete.
 *
 * @example
 * <DeferredResponsiveContainer width="100%" height="100%">
 *   <AreaChart data={data}>...</AreaChart>
 * </DeferredResponsiveContainer>
 */
export function DeferredResponsiveContainer({
  children,
  minWidth = 0,
  minHeight = 0,
  ...props
}: ResponsiveContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);
  const hasCheckedRef = useRef(false);

  const checkAndSetReady = useCallback(() => {
    if (hasCheckedRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      hasCheckedRef.current = true;
      setIsReady(true);
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || hasCheckedRef.current) return;

    let rafId: number;
    let resizeObserver: ResizeObserver | null = null;

    // Set up ResizeObserver to detect when dimensions become valid
    resizeObserver = new ResizeObserver((entries) => {
      if (hasCheckedRef.current) {
        resizeObserver?.disconnect();
        return;
      }
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          hasCheckedRef.current = true;
          setIsReady(true);
          resizeObserver?.disconnect();
          break;
        }
      }
    });
    resizeObserver.observe(container);

    // Also check after animation frames for initial render
    const scheduleCheck = () => {
      rafId = requestAnimationFrame(() => {
        checkAndSetReady();
        if (!hasCheckedRef.current) {
          rafId = requestAnimationFrame(scheduleCheck);
        }
      });
    };
    scheduleCheck();

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
    };
  }, [checkAndSetReady]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        minWidth: 1,
        minHeight: 1,
      }}
    >
      {isReady && (
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={minWidth}
          minHeight={minHeight}
          {...props}
        >
          {children}
        </ResponsiveContainer>
      )}
    </div>
  );
}
