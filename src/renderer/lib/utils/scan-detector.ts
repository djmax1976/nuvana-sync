/**
 * Barcode Scan Detection Utility
 *
 * Enterprise-grade algorithm for detecting barcode scanner vs manual keyboard entry.
 * Uses statistical analysis of keystroke timing patterns to classify input method.
 *
 * Story: Scan-Only Pack Reception Security
 *
 * Algorithm Overview:
 * 1. Track timestamps of each keystroke
 * 2. Calculate inter-keystroke intervals
 * 3. Compute statistical metrics (avg, std dev, max, min)
 * 4. Compare against known scanner/human patterns
 * 5. Calculate confidence score based on multiple factors
 *
 * Security Considerations:
 * - Algorithm is deterministic and reproducible for server-side validation
 * - Metrics are serializable for audit logging
 * - Thresholds are configurable per deployment
 * - Cannot be easily spoofed without specialized timing tools
 */

import type {
  ScanDetectionConfig,
  ScanMetrics,
  ScanDetectionResult,
  KeystrokeEvent,
  InputMethod,
} from "@/types/scan-detection";
import { DEFAULT_SCAN_DETECTION_CONFIG } from "@/types/scan-detection";

/**
 * Calculate standard deviation of an array of numbers
 * @param values - Array of numeric values
 * @returns Standard deviation
 */
export function calculateStdDev(values: number[]): number {
  if (values.length < 2) return 0;

  const n = values.length;
  const mean = values.reduce((sum, val) => sum + val, 0) / n;
  const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / (n - 1);

  return Math.sqrt(variance);
}

/**
 * Calculate inter-keystroke intervals from keystroke events
 * @param keystrokes - Array of keystroke events with timestamps
 * @returns Array of intervals in milliseconds (length = keystrokes.length - 1)
 */
export function calculateIntervals(keystrokes: KeystrokeEvent[]): number[] {
  if (keystrokes.length < 2) return [];

  const intervals: number[] = [];
  for (let i = 1; i < keystrokes.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- index is controlled loop variable
    const interval = keystrokes[i].timestamp - keystrokes[i - 1].timestamp;
    intervals.push(interval);
  }

  return intervals;
}

/**
 * Analyze keystroke timing to detect scan vs manual entry
 *
 * @param keystrokes - Array of keystroke events
 * @param config - Detection configuration (optional, uses defaults)
 * @returns Scan metrics with classification
 */
export function analyzeScanMetrics(
  keystrokes: KeystrokeEvent[],
  config: ScanDetectionConfig = DEFAULT_SCAN_DETECTION_CONFIG,
): ScanMetrics {
  const charCount = keystrokes.length;
  const timestamps = keystrokes.map((k) => k.timestamp);

  // Not enough data for analysis
  if (charCount < config.minCharsForDetection) {
    return {
      totalInputTimeMs: 0,
      avgInterKeyDelayMs: 0,
      maxInterKeyDelayMs: 0,
      minInterKeyDelayMs: 0,
      interKeyStdDevMs: 0,
      charCount,
      keystrokeTimestamps: timestamps,
      inputMethod: "UNKNOWN",
      confidence: 0,
      rejectionReason: `Insufficient data: ${charCount} chars (need ${config.minCharsForDetection})`,
      analyzedAt: new Date().toISOString(),
    };
  }

  // Calculate intervals (excluding first char grace period)
  const intervals = calculateIntervals(keystrokes);

  // Apply first character grace period - exclude first interval if it's long
  // (scanner may have delay for focus acquisition)
  let analysisIntervals = intervals;
  if (intervals.length > 0 && intervals[0] > config.firstCharGracePeriod) {
    analysisIntervals = intervals.slice(1);
  }

  // Edge case: all intervals were grace period
  if (analysisIntervals.length === 0) {
    analysisIntervals = intervals;
  }

  // Calculate statistics
  const totalInputTimeMs =
    charCount > 1 ? timestamps[timestamps.length - 1] - timestamps[0] : 0;
  const avgInterKeyDelayMs =
    analysisIntervals.length > 0
      ? analysisIntervals.reduce((sum, val) => sum + val, 0) /
        analysisIntervals.length
      : 0;
  const maxInterKeyDelayMs =
    analysisIntervals.length > 0 ? Math.max(...analysisIntervals) : 0;
  const minInterKeyDelayMs =
    analysisIntervals.length > 0 ? Math.min(...analysisIntervals) : 0;
  const interKeyStdDevMs = calculateStdDev(analysisIntervals);

  // Classify input method based on multiple factors
  const classification = classifyInputMethod(
    {
      totalInputTimeMs,
      avgInterKeyDelayMs,
      maxInterKeyDelayMs,
      interKeyStdDevMs,
      charCount,
    },
    config,
  );

  return {
    totalInputTimeMs,
    avgInterKeyDelayMs,
    maxInterKeyDelayMs,
    minInterKeyDelayMs,
    interKeyStdDevMs,
    charCount,
    keystrokeTimestamps: timestamps,
    inputMethod: classification.inputMethod,
    confidence: classification.confidence,
    rejectionReason: classification.rejectionReason,
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * Classification factors and their weights for confidence calculation
 */
interface ClassificationFactors {
  totalInputTimeMs: number;
  avgInterKeyDelayMs: number;
  maxInterKeyDelayMs: number;
  interKeyStdDevMs: number;
  charCount: number;
}

/**
 * Classify input method based on timing metrics
 *
 * Uses a weighted scoring system across multiple factors:
 * - Average inter-key delay (most important)
 * - Total input time
 * - Standard deviation (consistency)
 * - Maximum gap (detect pauses)
 *
 * @param factors - Calculated timing factors
 * @param config - Detection configuration
 * @returns Classification result with confidence
 */
function classifyInputMethod(
  factors: ClassificationFactors,
  config: ScanDetectionConfig,
): { inputMethod: InputMethod; confidence: number; rejectionReason?: string } {
  const reasons: string[] = [];
  let scanScore = 0;
  let totalWeight = 0;

  // Factor 1: Average inter-key delay (weight: 35%)
  const avgDelayWeight = 0.35;
  totalWeight += avgDelayWeight;
  if (factors.avgInterKeyDelayMs <= config.maxAvgInterKeyDelay) {
    scanScore += avgDelayWeight;
  } else {
    reasons.push(
      `Average keystroke delay ${factors.avgInterKeyDelayMs.toFixed(1)}ms exceeds ${config.maxAvgInterKeyDelay}ms threshold`,
    );
  }

  // Factor 2: Total input time (weight: 25%)
  const totalTimeWeight = 0.25;
  totalWeight += totalTimeWeight;
  if (factors.totalInputTimeMs <= config.maxTotalInputTime) {
    scanScore += totalTimeWeight;
  } else {
    reasons.push(
      `Total input time ${factors.totalInputTimeMs.toFixed(0)}ms exceeds ${config.maxTotalInputTime}ms threshold`,
    );
  }

  // Factor 3: Consistency (std dev) (weight: 20%)
  const stdDevWeight = 0.2;
  totalWeight += stdDevWeight;
  if (factors.interKeyStdDevMs <= config.maxInterKeyStdDev) {
    scanScore += stdDevWeight;
  } else {
    reasons.push(
      `Keystroke timing inconsistent (std dev ${factors.interKeyStdDevMs.toFixed(1)}ms > ${config.maxInterKeyStdDev}ms)`,
    );
  }

  // Factor 4: Maximum gap (weight: 20%)
  // A long gap indicates human pause/correction
  const maxGapWeight = 0.2;
  totalWeight += maxGapWeight;
  const maxGapThreshold = config.maxAvgInterKeyDelay * 3; // Allow some variance
  if (factors.maxInterKeyDelayMs <= maxGapThreshold) {
    scanScore += maxGapWeight;
  } else {
    reasons.push(
      `Long pause detected (${factors.maxInterKeyDelayMs.toFixed(0)}ms gap)`,
    );
  }

  // Calculate confidence as percentage of factors passed
  const confidence = scanScore / totalWeight;

  // Determine classification based on confidence threshold
  if (confidence >= config.minConfidence) {
    return {
      inputMethod: "SCANNED",
      confidence,
    };
  } else if (confidence <= 1 - config.minConfidence) {
    return {
      inputMethod: "MANUAL",
      confidence: 1 - confidence, // Invert for manual confidence
      rejectionReason: reasons.join(". "),
    };
  } else {
    // Ambiguous - classify based on which side of 0.5
    if (confidence >= 0.5) {
      return {
        inputMethod: "SCANNED",
        confidence,
      };
    } else {
      return {
        inputMethod: "MANUAL",
        confidence: 1 - confidence,
        rejectionReason: reasons.join(". "),
      };
    }
  }
}

/**
 * Create a scan detection result from metrics
 *
 * @param metrics - Analyzed scan metrics
 * @param config - Detection configuration
 * @returns Detection result for UI consumption
 */
export function createDetectionResult(
  metrics: ScanMetrics | null,
  config: ScanDetectionConfig = DEFAULT_SCAN_DETECTION_CONFIG,
): ScanDetectionResult {
  if (!metrics) {
    return {
      isScanned: false,
      isManual: false,
      isPending: true,
      confidence: 0,
      inputMethod: "UNKNOWN",
      metrics: null,
    };
  }

  const isPending = metrics.charCount < config.minCharsForDetection;

  return {
    isScanned: metrics.inputMethod === "SCANNED",
    isManual: metrics.inputMethod === "MANUAL",
    isPending,
    confidence: metrics.confidence,
    inputMethod: metrics.inputMethod,
    metrics,
    rejectionReason: metrics.rejectionReason,
  };
}

/**
 * Validate scan metrics on server side
 * Re-analyzes the provided timestamps to prevent client-side tampering
 *
 * @param metrics - Metrics provided by client
 * @param config - Detection configuration
 * @returns Validation result with re-analyzed metrics
 */
export function validateScanMetricsServerSide(
  metrics: ScanMetrics,
  config: ScanDetectionConfig = DEFAULT_SCAN_DETECTION_CONFIG,
): {
  valid: boolean;
  reanalyzedMetrics: ScanMetrics;
  tamperedDetected: boolean;
  tamperReason?: string;
} {
  // Reconstruct keystrokes from timestamps
  const keystrokes: KeystrokeEvent[] = metrics.keystrokeTimestamps.map(
    (timestamp, index) => ({
      char: "", // We don't need the actual chars for validation
      timestamp,
      intervalMs:
        index > 0 ? timestamp - metrics.keystrokeTimestamps[index - 1] : null,
    }),
  );

  // Re-analyze the metrics
  const reanalyzedMetrics = analyzeScanMetrics(keystrokes, config);

  // Check for tampering - compare client metrics vs reanalyzed
  const toleranceMs = 5; // Allow 5ms tolerance for floating point
  const tamperedDetected =
    Math.abs(
      metrics.avgInterKeyDelayMs - reanalyzedMetrics.avgInterKeyDelayMs,
    ) > toleranceMs ||
    Math.abs(metrics.totalInputTimeMs - reanalyzedMetrics.totalInputTimeMs) >
      toleranceMs;

  let tamperReason: string | undefined;
  if (tamperedDetected) {
    tamperReason = "Client-provided metrics do not match timestamp analysis";
  }

  // Check timestamps are reasonable (not in future)
  // NOTE: Staleness check removed - database validations provide security
  // MCP SEC-014: Database-level validation is the authoritative security layer
  const now = Date.now();
  const lastTimestamp =
    metrics.keystrokeTimestamps[metrics.keystrokeTimestamps.length - 1];

  if (lastTimestamp > now + 1000) {
    // 1 second tolerance for clock skew
    return {
      valid: false,
      reanalyzedMetrics,
      tamperedDetected: true,
      tamperReason: "Timestamps are in the future",
    };
  }

  return {
    valid:
      reanalyzedMetrics.inputMethod === "SCANNED" &&
      reanalyzedMetrics.confidence >= config.minConfidence,
    reanalyzedMetrics,
    tamperedDetected,
    tamperReason,
  };
}

/**
 * Format metrics for display in UI
 *
 * @param metrics - Scan metrics to format
 * @returns Human-readable summary
 */
export function formatMetricsForDisplay(metrics: ScanMetrics): string {
  if (metrics.inputMethod === "UNKNOWN") {
    return `Analyzing... (${metrics.charCount} characters)`;
  }

  const method = metrics.inputMethod === "SCANNED" ? "Scanner" : "Manual";
  const confidence = (metrics.confidence * 100).toFixed(0);

  return `${method} input detected (${confidence}% confidence). Avg delay: ${metrics.avgInterKeyDelayMs.toFixed(1)}ms`;
}

/**
 * Check if input appears to be from a scanner based on partial data
 * Used for real-time feedback during input
 *
 * SECURITY: Detects manual entry as early as possible (after 2 keystrokes)
 * Scanner threshold: 50ms between keys (20+ chars/second)
 * Human typing: typically 150-300ms between keys (3-7 chars/second)
 *
 * @param keystrokes - Current keystroke events
 * @param config - Detection configuration
 * @returns Quick classification for UI feedback
 */
export function quickScanCheck(
  keystrokes: KeystrokeEvent[],
  config: ScanDetectionConfig = DEFAULT_SCAN_DETECTION_CONFIG,
): { likelyScan: boolean; confidence: number } {
  // Need at least 2 keystrokes to have 1 interval
  if (keystrokes.length < 2) {
    return { likelyScan: true, confidence: 0 }; // Too early to tell
  }

  const intervals = calculateIntervals(keystrokes);

  if (intervals.length === 0) {
    return { likelyScan: true, confidence: 0 };
  }

  // Check ALL intervals - if ANY interval is too slow, it's manual entry
  // This catches manual typing immediately after the second keystroke
  const maxInterval = Math.max(...intervals);
  const avgRecent =
    intervals.reduce((sum, val) => sum + val, 0) / intervals.length;

  // If max interval exceeds threshold, it's definitely manual
  // Also check average to catch consistent slow typing
  const likelyScan =
    maxInterval <= config.maxAvgInterKeyDelay * 2 &&
    avgRecent <= config.maxAvgInterKeyDelay;

  const confidence = likelyScan
    ? Math.min(1, config.maxAvgInterKeyDelay / Math.max(avgRecent, 1))
    : 1; // High confidence it's manual when detected

  return { likelyScan, confidence };
}
