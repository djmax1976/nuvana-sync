/**
 * useScanDetector Hook
 *
 * React hook for detecting barcode scanner vs manual keyboard entry.
 * Provides real-time analysis of keystroke timing patterns.
 *
 * Story: Scan-Only Pack Reception Security
 *
 * Usage:
 * ```tsx
 * const {
 *   handleKeyDown,
 *   handleChange,
 *   result,
 *   reset,
 *   getMetrics,
 * } = useScanDetector({ expectedLength: 24 });
 *
 * <input
 *   onKeyDown={handleKeyDown}
 *   onChange={handleChange}
 *   value={value}
 * />
 * ```
 *
 * Features:
 * - Real-time keystroke tracking
 * - Statistical analysis of timing patterns
 * - Configurable detection thresholds
 * - Reset capability for new scans
 * - Metrics export for server validation
 */

import { useState, useCallback, useRef, useMemo } from "react";
import type {
  ScanDetectionConfig,
  ScanDetectionResult,
  ScanMetrics,
  KeystrokeEvent,
} from "@/types/scan-detection";
import { DEFAULT_SCAN_DETECTION_CONFIG } from "@/types/scan-detection";
import {
  analyzeScanMetrics,
  createDetectionResult,
  quickScanCheck,
} from "@/lib/utils/scan-detector";

/**
 * Hook configuration options
 */
export interface UseScanDetectorOptions {
  /**
   * Expected character count for complete input
   * @default 24
   */
  expectedLength?: number;

  /**
   * Custom detection configuration
   */
  config?: Partial<ScanDetectionConfig>;

  /**
   * Callback when manual entry is detected
   */
  onManualDetected?: (metrics: ScanMetrics) => void;

  /**
   * Callback when scan is detected
   */
  onScanDetected?: (metrics: ScanMetrics) => void;

  /**
   * Callback when input is complete (regardless of method)
   */
  onComplete?: (metrics: ScanMetrics) => void;

  /**
   * Whether detection is enabled
   * @default true
   */
  enabled?: boolean;
}

/**
 * Hook return value
 */
export interface UseScanDetectorReturn {
  /**
   * Handle keydown event - attach to input's onKeyDown
   */
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;

  /**
   * Handle input change - attach to input's onChange
   * Returns the cleaned value (digits only for numeric inputs)
   */
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => string;

  /**
   * Current detection result
   */
  result: ScanDetectionResult;

  /**
   * Reset the detector for a new scan
   */
  reset: () => void;

  /**
   * Get current metrics for submission
   */
  getMetrics: () => ScanMetrics | null;

  /**
   * Current keystroke count
   */
  keystrokeCount: number;

  /**
   * Whether input is complete (reached expected length)
   */
  isComplete: boolean;

  /**
   * Quick check result for real-time UI feedback
   */
  quickCheck: { likelyScan: boolean; confidence: number };

  /**
   * SYNCHRONOUS quick check - use this for real-time blocking during onChange
   * Returns current keystroke timing analysis without React state delay
   */
  getQuickCheckSync: () => { likelyScan: boolean; confidence: number };

  /**
   * Whether a rejection should be shown (manual entry detected after completion)
   */
  shouldReject: boolean;
}

/**
 * useScanDetector hook
 *
 * Tracks keystroke timing to detect barcode scanner vs manual entry.
 */
export function useScanDetector(
  options: UseScanDetectorOptions = {},
): UseScanDetectorReturn {
  const {
    expectedLength = 24,
    config: customConfig,
    onManualDetected,
    onScanDetected,
    onComplete,
    enabled = true,
  } = options;

  // Merge custom config with defaults
  const config = useMemo<ScanDetectionConfig>(
    () => ({
      ...DEFAULT_SCAN_DETECTION_CONFIG,
      expectedCharCount: expectedLength,
      ...customConfig,
    }),
    [expectedLength, customConfig],
  );

  // State
  const [keystrokes, setKeystrokes] = useState<KeystrokeEvent[]>([]);
  const [result, setResult] = useState<ScanDetectionResult>(() =>
    createDetectionResult(null, config),
  );
  const [isComplete, setIsComplete] = useState(false);

  // Refs for callbacks to avoid stale closures
  const callbacksRef = useRef({ onManualDetected, onScanDetected, onComplete });
  callbacksRef.current = { onManualDetected, onScanDetected, onComplete };

  // Track the last keystroke timestamp
  const lastKeystrokeRef = useRef<number | null>(null);

  // CRITICAL: Store keystrokes in ref for SYNCHRONOUS access in real-time detection
  // React state updates are async, but we need immediate access for timing analysis
  const keystrokesRef = useRef<KeystrokeEvent[]>([]);

  /**
   * Handle keydown event
   * Records keystroke timing for analysis
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!enabled) return;

      // Only track printable characters (digits for barcode)
      const key = e.key;
      if (!/^\d$/.test(key)) return;

      const now = performance.now() + performance.timeOrigin; // High precision timestamp
      const lastTimestamp = lastKeystrokeRef.current;
      const intervalMs = lastTimestamp !== null ? now - lastTimestamp : null;

      lastKeystrokeRef.current = now;

      const newKeystroke: KeystrokeEvent = {
        char: key,
        timestamp: now,
        intervalMs,
      };

      // CRITICAL: Update ref SYNCHRONOUSLY for real-time detection
      keystrokesRef.current = [...keystrokesRef.current, newKeystroke];

      setKeystrokes((prev) => {
        const updated = [...prev, newKeystroke];

        // Analyze after we have enough data
        if (updated.length >= config.minCharsForDetection) {
          const metrics = analyzeScanMetrics(updated, config);
          const detectionResult = createDetectionResult(metrics, config);
          setResult(detectionResult);

          // Check if complete
          if (updated.length >= config.expectedCharCount) {
            setIsComplete(true);

            // Fire callbacks
            callbacksRef.current.onComplete?.(metrics);

            if (metrics.inputMethod === "MANUAL") {
              callbacksRef.current.onManualDetected?.(metrics);
            } else if (metrics.inputMethod === "SCANNED") {
              callbacksRef.current.onScanDetected?.(metrics);
            }
          }
        }

        return updated;
      });
    },
    [enabled, config],
  );

  /**
   * Handle input change
   * Cleans input to digits only and tracks value
   */
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): string => {
      const rawValue = e.target.value;
      const cleanedValue = rawValue.replace(/\D/g, ""); // Digits only

      // If value was cleared or shortened, reset detector
      if (cleanedValue.length < keystrokes.length) {
        // User deleted characters - reset
        setKeystrokes([]);
        setResult(createDetectionResult(null, config));
        setIsComplete(false);
        lastKeystrokeRef.current = null;
      }

      return cleanedValue;
    },
    [keystrokes.length, config],
  );

  /**
   * Reset detector for new scan
   */
  const reset = useCallback(() => {
    setKeystrokes([]);
    keystrokesRef.current = []; // Also reset the ref
    setResult(createDetectionResult(null, config));
    setIsComplete(false);
    lastKeystrokeRef.current = null;
  }, [config]);

  /**
   * Get metrics for submission
   */
  const getMetrics = useCallback((): ScanMetrics | null => {
    if (keystrokes.length < config.minCharsForDetection) {
      return null;
    }
    return analyzeScanMetrics(keystrokes, config);
  }, [keystrokes, config]);

  /**
   * Quick check for real-time UI feedback (uses React state - may be stale)
   */
  const quickCheck = useMemo(
    () => quickScanCheck(keystrokes, config),
    [keystrokes, config],
  );

  /**
   * SYNCHRONOUS quick check using ref - for real-time blocking
   * This is called during onChange and must have current data
   */
  const getQuickCheckSync = useCallback((): {
    likelyScan: boolean;
    confidence: number;
  } => {
    return quickScanCheck(keystrokesRef.current, config);
  }, [config]);

  /**
   * Whether rejection should be shown
   * Only show after input is complete and manual entry was detected
   */
  const shouldReject = useMemo(
    () => isComplete && result.isManual,
    [isComplete, result.isManual],
  );

  return {
    handleKeyDown,
    handleChange,
    result,
    reset,
    getMetrics,
    getQuickCheckSync, // NEW: synchronous check for real-time blocking
    keystrokeCount: keystrokes.length,
    isComplete,
    quickCheck,
    shouldReject,
  };
}

/**
 * Create a mock scan detector for testing
 * Simulates instant scan input
 */
export function createMockScanDetector(
  value: string,
  config: ScanDetectionConfig = DEFAULT_SCAN_DETECTION_CONFIG,
): ScanMetrics {
  const timestamps: number[] = [];
  const baseTime = Date.now();

  // Simulate scanner timing (10ms between characters)
  for (let i = 0; i < value.length; i++) {
    timestamps.push(baseTime + i * 10);
  }

  const keystrokes: KeystrokeEvent[] = value.split("").map((char, index) => ({
    char,
    // eslint-disable-next-line security/detect-object-injection -- index is controlled loop variable
    timestamp: timestamps[index],
    // eslint-disable-next-line security/detect-object-injection -- index is controlled loop variable
    intervalMs: index > 0 ? timestamps[index] - timestamps[index - 1] : null,
  }));

  return analyzeScanMetrics(keystrokes, config);
}

/**
 * Create a mock manual entry detector for testing
 * Simulates slow keyboard input
 */
export function createMockManualDetector(
  value: string,
  config: ScanDetectionConfig = DEFAULT_SCAN_DETECTION_CONFIG,
): ScanMetrics {
  const timestamps: number[] = [];
  const baseTime = Date.now();

  // Simulate human typing (200-400ms between characters with variance)
  let currentTime = baseTime;
  for (let i = 0; i < value.length; i++) {
    timestamps.push(currentTime);
    currentTime += 200 + Math.random() * 200; // 200-400ms
  }

  const keystrokes: KeystrokeEvent[] = value.split("").map((char, index) => ({
    char,
    // eslint-disable-next-line security/detect-object-injection -- index is controlled loop variable
    timestamp: timestamps[index],
    // eslint-disable-next-line security/detect-object-injection -- index is controlled loop variable
    intervalMs: index > 0 ? timestamps[index] - timestamps[index - 1] : null,
  }));

  return analyzeScanMetrics(keystrokes, config);
}
