/**
 * Barcode Scan Detection Types
 *
 * Enterprise-grade types for detecting barcode scanner vs manual keyboard entry.
 * Used to enforce scan-only input for lottery pack reception.
 *
 * Story: Scan-Only Pack Reception Security
 *
 * Security Considerations:
 * - Client-side detection provides UX feedback
 * - Server-side validation provides security enforcement
 * - Metrics are logged for audit trail
 * - Configurable thresholds support different scanner models
 */

/**
 * Input method classification
 */
export type InputMethod = "SCANNED" | "MANUAL" | "UNKNOWN";

/**
 * Configuration for scan detection thresholds
 * These values are based on empirical testing of various barcode scanners
 */
export interface ScanDetectionConfig {
  /**
   * Maximum average inter-keystroke delay for scan classification (ms)
   * Barcode scanners typically have 5-30ms between characters
   * Human typing averages 150-300ms between keystrokes
   * @default 50
   */
  maxAvgInterKeyDelay: number;

  /**
   * Maximum total input time for complete barcode entry (ms)
   * For 24 characters: scanners take 50-150ms, humans take 3000-7000ms
   * @default 500
   */
  maxTotalInputTime: number;

  /**
   * Maximum standard deviation of keystroke intervals (ms)
   * Scanners have very consistent timing (low std dev)
   * Humans have variable timing (high std dev)
   * @default 30
   */
  maxInterKeyStdDev: number;

  /**
   * Minimum characters required before detection analysis begins
   * Need enough samples for statistical significance
   * @default 8
   */
  minCharsForDetection: number;

  /**
   * Grace period for first character delay (ms)
   * Allows for scanner focus acquisition time
   * @default 500
   */
  firstCharGracePeriod: number;

  /**
   * Minimum confidence threshold for scan classification (0-1)
   * Higher values = stricter detection
   * @default 0.85
   */
  minConfidence: number;

  /**
   * Expected character count for valid barcode
   * @default 24
   */
  expectedCharCount: number;
}

/**
 * Default configuration based on enterprise barcode scanner testing
 */
export const DEFAULT_SCAN_DETECTION_CONFIG: ScanDetectionConfig = {
  maxAvgInterKeyDelay: 50,
  maxTotalInputTime: 500,
  maxInterKeyStdDev: 30,
  minCharsForDetection: 8,
  firstCharGracePeriod: 500,
  minConfidence: 0.85,
  expectedCharCount: 24,
};

/**
 * Metrics collected during input for scan detection analysis
 */
export interface ScanMetrics {
  /**
   * Total time from first to last keystroke (ms)
   */
  totalInputTimeMs: number;

  /**
   * Average time between consecutive keystrokes (ms)
   */
  avgInterKeyDelayMs: number;

  /**
   * Maximum gap between any two consecutive keystrokes (ms)
   * Useful for detecting pauses/corrections
   */
  maxInterKeyDelayMs: number;

  /**
   * Minimum gap between any two consecutive keystrokes (ms)
   */
  minInterKeyDelayMs: number;

  /**
   * Standard deviation of inter-keystroke delays (ms)
   * Low values indicate consistent scanner input
   */
  interKeyStdDevMs: number;

  /**
   * Number of characters entered
   */
  charCount: number;

  /**
   * Raw timestamps of each keystroke (ms since epoch)
   * Used for server-side validation and audit
   */
  keystrokeTimestamps: number[];

  /**
   * Classified input method
   */
  inputMethod: InputMethod;

  /**
   * Confidence score for the classification (0-1)
   * Higher values indicate more certain classification
   */
  confidence: number;

  /**
   * Human-readable reason if input was rejected as manual entry
   */
  rejectionReason?: string;

  /**
   * Timestamp when analysis was performed (ISO string)
   */
  analyzedAt: string;
}

/**
 * Result of scan detection analysis
 */
export interface ScanDetectionResult {
  /**
   * Whether the input appears to be from a barcode scanner
   */
  isScanned: boolean;

  /**
   * Whether the input appears to be manual keyboard entry
   */
  isManual: boolean;

  /**
   * Whether detection is still pending (not enough data)
   */
  isPending: boolean;

  /**
   * Confidence score for the classification (0-1)
   */
  confidence: number;

  /**
   * Classified input method
   */
  inputMethod: InputMethod;

  /**
   * Detailed metrics (available after analysis)
   */
  metrics: ScanMetrics | null;

  /**
   * Human-readable rejection reason (if manual entry detected)
   */
  rejectionReason?: string;
}

/**
 * Keystroke event data for tracking
 */
export interface KeystrokeEvent {
  /**
   * Character that was entered
   */
  char: string;

  /**
   * Timestamp when key was pressed (ms since epoch)
   */
  timestamp: number;

  /**
   * Time since previous keystroke (ms), null for first keystroke
   */
  intervalMs: number | null;
}

/**
 * State managed by the useScanDetector hook
 */
export interface ScanDetectorState {
  /**
   * Array of keystroke events
   */
  keystrokes: KeystrokeEvent[];

  /**
   * Current detection result
   */
  result: ScanDetectionResult;

  /**
   * Whether input is currently active
   */
  isActive: boolean;

  /**
   * Current input value
   */
  currentValue: string;
}

/**
 * API request payload including scan metrics
 * Used when submitting pack reception with scan validation
 */
export interface ScanValidatedRequest {
  /**
   * The serialized numbers being submitted
   */
  serialized_numbers: string[];

  /**
   * Store ID for the reception
   */
  store_id: string;

  /**
   * Scan metrics for each serialized number (parallel arrays)
   * Required for server-side validation
   */
  scan_metrics: ScanMetrics[];
}

/**
 * Server-side validation result
 */
export interface ServerScanValidationResult {
  /**
   * Whether all scans passed validation
   */
  valid: boolean;

  /**
   * Array of validation results per serial number
   */
  results: Array<{
    serial: string;
    valid: boolean;
    inputMethod: InputMethod;
    rejectionReason?: string;
  }>;
}

/**
 * Audit log entry for scan validation
 */
export interface ScanAuditLogEntry {
  /**
   * Unique audit ID
   */
  id: string;

  /**
   * When the validation occurred
   */
  timestamp: Date;

  /**
   * Store where pack was scanned
   */
  storeId: string;

  /**
   * User who performed the scan
   */
  userId: string;

  /**
   * The serial number that was scanned/entered
   */
  serialNumber: string;

  /**
   * Detected input method
   */
  inputMethod: InputMethod;

  /**
   * Whether the input was accepted
   */
  accepted: boolean;

  /**
   * Reason for rejection (if not accepted)
   */
  rejectionReason?: string;

  /**
   * Full scan metrics for analysis
   */
  metrics: ScanMetrics;

  /**
   * Client IP address
   */
  clientIp?: string;

  /**
   * Client user agent
   */
  userAgent?: string;
}
