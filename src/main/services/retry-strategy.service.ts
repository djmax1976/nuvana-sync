/**
 * Retry Strategy Service
 *
 * Implements enterprise-grade retry patterns with jittered exponential backoff
 * and dynamic batch-size reduction for cloud sync operations.
 *
 * Key features:
 * - Jittered exponential backoff (prevents thundering herd)
 * - Error category-aware retry policies
 * - Dynamic batch size reduction under failure conditions
 * - Rate limit (429) Retry-After header support
 *
 * @module main/services/retry-strategy
 * @security ERR-007: Error retry logic with proper categorization
 * @security API-002: Rate limiting awareness
 * @compliance SYNC-5000: Phase 4 - Retry/Backoff/Circuit Breaker Hardening
 */

import { createLogger } from '../utils/logger';
import type { ErrorCategory } from '../dal/sync-queue.dal';

// ============================================================================
// Types
// ============================================================================

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Base delay in milliseconds (default: 1000 = 1s) */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (default: 60000 = 60s) */
  maxDelayMs: number;
  /** Jitter factor (0-1, default: 0.3 = ±30% jitter) */
  jitterFactor: number;
  /** Exponential multiplier (default: 2) */
  multiplier: number;
  /** Max attempts for transient errors (default: 10) */
  maxAttemptsTransient: number;
  /** Max attempts for permanent errors (default: 5) */
  maxAttemptsPermanent: number;
  /** Max attempts for unknown errors (default: 5) */
  maxAttemptsUnknown: number;
}

/**
 * Batch size configuration
 */
export interface BatchSizeConfig {
  /** Default batch size (default: 50) */
  defaultBatchSize: number;
  /** Minimum batch size (default: 5) */
  minBatchSize: number;
  /** Maximum batch size (default: 200) */
  maxBatchSize: number;
  /** Reduction factor on failure (default: 0.5 = halve) */
  reductionFactor: number;
  /** Recovery factor on success (default: 1.2 = 20% increase) */
  recoveryFactor: number;
  /** Consecutive successes needed for recovery (default: 3) */
  recoveryThreshold: number;
}

/**
 * Retry decision result
 */
export interface RetryDecision {
  /** Whether to retry */
  shouldRetry: boolean;
  /** Delay before retry in milliseconds */
  delayMs: number;
  /** Reason for the decision */
  reason: string;
  /** Whether to dead-letter instead */
  shouldDeadLetter: boolean;
  /** Dead letter reason if applicable */
  deadLetterReason?: 'MAX_ATTEMPTS_EXCEEDED' | 'PERMANENT_ERROR' | 'STRUCTURAL_FAILURE';
}

/**
 * Batch size adjustment result
 */
export interface BatchSizeAdjustment {
  /** New batch size */
  batchSize: number;
  /** Whether size was changed */
  wasAdjusted: boolean;
  /** Direction of adjustment */
  direction: 'reduced' | 'increased' | 'unchanged';
  /** Reason for adjustment */
  reason: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Default retry configuration */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
  jitterFactor: 0.3,
  multiplier: 2,
  maxAttemptsTransient: 10, // Transient errors get extended retry
  maxAttemptsPermanent: 5,
  maxAttemptsUnknown: 5,
};

/** Default batch size configuration */
const DEFAULT_BATCH_SIZE_CONFIG: BatchSizeConfig = {
  defaultBatchSize: 50,
  minBatchSize: 5,
  maxBatchSize: 200,
  reductionFactor: 0.5,
  recoveryFactor: 1.2,
  recoveryThreshold: 3,
};

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('retry-strategy');

// ============================================================================
// Retry Strategy Service
// ============================================================================

/**
 * Retry Strategy Service
 *
 * Provides enterprise-grade retry logic with:
 * - Jittered exponential backoff
 * - Error category-aware policies
 * - Dynamic batch sizing
 */
export class RetryStrategyService {
  private readonly retryConfig: RetryConfig;
  private readonly batchConfig: BatchSizeConfig;
  private currentBatchSize: number;
  private consecutiveSuccesses: number = 0;
  private consecutiveFailures: number = 0;

  constructor(retryConfig?: Partial<RetryConfig>, batchConfig?: Partial<BatchSizeConfig>) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
    this.batchConfig = { ...DEFAULT_BATCH_SIZE_CONFIG, ...batchConfig };
    this.currentBatchSize = this.batchConfig.defaultBatchSize;

    log.info('RetryStrategy initialized', {
      retryConfig: this.retryConfig,
      batchConfig: this.batchConfig,
    });
  }

  // ==========================================================================
  // Backoff Calculation
  // ==========================================================================

  /**
   * Calculate jittered exponential backoff delay
   *
   * Formula: baseDelay * (multiplier ^ attempt) * (1 + random * jitter)
   *
   * Example with defaults (baseDelay=1000, multiplier=2, jitter=0.3):
   * - Attempt 0: 1000ms * 1 * (0.7-1.3) = 700-1300ms
   * - Attempt 1: 1000ms * 2 * (0.7-1.3) = 1400-2600ms
   * - Attempt 2: 1000ms * 4 * (0.7-1.3) = 2800-5200ms
   * - Attempt 3: 1000ms * 8 * (0.7-1.3) = 5600-10400ms
   * - Attempt 4: 1000ms * 16 * (0.7-1.3) = 11200-20800ms
   * - Attempt 5+: capped at maxDelayMs * (0.7-1.3)
   *
   * @param attempt - Current attempt number (0-based)
   * @param errorCategory - Error category for policy selection
   * @returns Delay in milliseconds
   */
  calculateBackoffDelay(attempt: number, errorCategory?: ErrorCategory | null): number {
    // Base exponential delay: baseDelay * multiplier^attempt
    const exponentialDelay =
      this.retryConfig.baseDelayMs * Math.pow(this.retryConfig.multiplier, attempt);

    // Cap at maximum delay
    const cappedDelay = Math.min(exponentialDelay, this.retryConfig.maxDelayMs);

    // Apply jitter: multiply by (1 - jitter) to (1 + jitter)
    // This spreads retries to prevent thundering herd
    const jitterRange = this.retryConfig.jitterFactor;
    const jitterMultiplier = 1 - jitterRange + Math.random() * 2 * jitterRange;

    // Extended backoff for unknown errors
    const categoryMultiplier = errorCategory === 'UNKNOWN' ? 1.5 : 1;

    const finalDelay = Math.round(cappedDelay * jitterMultiplier * categoryMultiplier);

    log.debug('Calculated backoff delay', {
      attempt,
      errorCategory,
      exponentialDelay,
      cappedDelay,
      jitterMultiplier: jitterMultiplier.toFixed(2),
      finalDelay,
    });

    return finalDelay;
  }

  /**
   * Calculate retry timestamp based on backoff delay
   *
   * @param attempt - Current attempt number
   * @param errorCategory - Error category
   * @returns ISO 8601 timestamp for next retry
   */
  calculateRetryAfter(attempt: number, errorCategory?: ErrorCategory | null): string {
    const delayMs = this.calculateBackoffDelay(attempt, errorCategory);
    return new Date(Date.now() + delayMs).toISOString();
  }

  // ==========================================================================
  // Retry Decision
  // ==========================================================================

  /**
   * Make a retry decision based on error category and attempt count
   *
   * Policy by error category (ERR-007):
   * - STRUCTURAL: Never retry, dead-letter immediately
   * - PERMANENT: Dead-letter after maxAttemptsPermanent
   * - TRANSIENT: Retry up to maxAttemptsTransient with extended backoff
   * - UNKNOWN: Retry up to maxAttemptsUnknown with extended backoff
   *
   * @param syncAttempts - Current sync attempt count
   * @param maxAttempts - Configured max attempts for this item
   * @param errorCategory - Classified error category
   * @param retryAfter - Optional server-specified retry timestamp
   * @returns Retry decision
   */
  makeRetryDecision(
    syncAttempts: number,
    maxAttempts: number,
    errorCategory: ErrorCategory | null,
    retryAfter?: string | null
  ): RetryDecision {
    // STRUCTURAL errors: never retry
    if (errorCategory === 'STRUCTURAL') {
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Structural error - payload invalid, will never succeed',
        shouldDeadLetter: true,
        deadLetterReason: 'STRUCTURAL_FAILURE',
      };
    }

    // Determine max attempts based on error category
    let effectiveMaxAttempts: number;
    switch (errorCategory) {
      case 'TRANSIENT':
        // Transient errors get extended retry (2x normal)
        effectiveMaxAttempts = Math.max(maxAttempts * 2, this.retryConfig.maxAttemptsTransient);
        break;
      case 'PERMANENT':
        effectiveMaxAttempts = Math.min(maxAttempts, this.retryConfig.maxAttemptsPermanent);
        break;
      case 'CONFLICT':
        // D4.2: CONFLICT errors get limited retries (same as PERMANENT)
        effectiveMaxAttempts = Math.min(maxAttempts, this.retryConfig.maxAttemptsPermanent);
        break;
      case 'UNKNOWN':
      default:
        effectiveMaxAttempts = Math.min(maxAttempts, this.retryConfig.maxAttemptsUnknown);
    }

    // Check if we've exceeded max attempts
    if (syncAttempts >= effectiveMaxAttempts) {
      // D4.2: Return category-specific dead letter reasons
      let deadLetterReason:
        | 'MAX_ATTEMPTS_EXCEEDED'
        | 'PERMANENT_ERROR'
        | 'STRUCTURAL_FAILURE'
        | 'CONFLICT_ERROR';
      switch (errorCategory) {
        case 'PERMANENT':
          deadLetterReason = 'PERMANENT_ERROR';
          break;
        case 'CONFLICT':
          deadLetterReason = 'CONFLICT_ERROR';
          break;
        default:
          deadLetterReason = 'MAX_ATTEMPTS_EXCEEDED';
      }

      return {
        shouldRetry: false,
        delayMs: 0,
        reason: `Max attempts exceeded (${syncAttempts}/${effectiveMaxAttempts}) for ${errorCategory || 'UNKNOWN'} error`,
        shouldDeadLetter: true,
        deadLetterReason,
      };
    }

    // Calculate delay
    let delayMs: number;
    let reason: string;

    // Respect server-specified Retry-After (for 429 responses)
    if (retryAfter) {
      const retryTime = new Date(retryAfter).getTime();
      const now = Date.now();
      if (retryTime > now) {
        delayMs = retryTime - now;
        reason = `Server-specified Retry-After: ${retryAfter}`;
      } else {
        // Retry-After has passed, use calculated backoff
        delayMs = this.calculateBackoffDelay(syncAttempts, errorCategory);
        reason = `Retry-After passed, using backoff: ${delayMs}ms`;
      }
    } else {
      delayMs = this.calculateBackoffDelay(syncAttempts, errorCategory);
      reason = `Jittered backoff: ${delayMs}ms (attempt ${syncAttempts + 1}/${effectiveMaxAttempts})`;
    }

    return {
      shouldRetry: true,
      delayMs,
      reason,
      shouldDeadLetter: false,
    };
  }

  /**
   * Check if an item is ready for retry based on timing
   *
   * @param lastAttemptAt - Timestamp of last attempt
   * @param syncAttempts - Current attempt count
   * @param errorCategory - Error category
   * @param retryAfter - Optional server-specified retry time
   * @returns Whether the item is ready for retry
   */
  isReadyForRetry(
    lastAttemptAt: string | null,
    syncAttempts: number,
    errorCategory: ErrorCategory | null,
    retryAfter: string | null
  ): boolean {
    // First attempt - always ready
    if (syncAttempts === 0 || !lastAttemptAt) {
      return true;
    }

    const now = Date.now();

    // If there's a server-specified retry_after, respect it
    if (retryAfter) {
      const retryTime = new Date(retryAfter).getTime();
      if (now < retryTime) {
        return false;
      }
    }

    // Check calculated backoff
    const backoffDelay = this.calculateBackoffDelay(syncAttempts, errorCategory);
    const lastAttemptTime = new Date(lastAttemptAt).getTime();
    const nextRetryTime = lastAttemptTime + backoffDelay;

    return now >= nextRetryTime;
  }

  // ==========================================================================
  // Dynamic Batch Sizing
  // ==========================================================================

  /**
   * Get current batch size
   */
  getCurrentBatchSize(): number {
    return this.currentBatchSize;
  }

  /**
   * Record successful batch processing
   * May increase batch size after consecutive successes
   */
  recordBatchSuccess(): BatchSizeAdjustment {
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;

    // Check if we should recover batch size
    if (
      this.consecutiveSuccesses >= this.batchConfig.recoveryThreshold &&
      this.currentBatchSize < this.batchConfig.defaultBatchSize
    ) {
      const newSize = Math.min(
        Math.ceil(this.currentBatchSize * this.batchConfig.recoveryFactor),
        this.batchConfig.defaultBatchSize
      );

      if (newSize > this.currentBatchSize) {
        const oldSize = this.currentBatchSize;
        this.currentBatchSize = newSize;
        this.consecutiveSuccesses = 0;

        log.info('Batch size increased after recovery', {
          oldSize,
          newSize,
          consecutiveSuccesses: this.batchConfig.recoveryThreshold,
        });

        return {
          batchSize: newSize,
          wasAdjusted: true,
          direction: 'increased',
          reason: `Recovery after ${this.batchConfig.recoveryThreshold} consecutive successes`,
        };
      }
    }

    return {
      batchSize: this.currentBatchSize,
      wasAdjusted: false,
      direction: 'unchanged',
      reason: 'Success recorded, no adjustment needed',
    };
  }

  /**
   * Record failed batch processing
   * Reduces batch size to improve success rate
   *
   * @param failureRatio - Ratio of failed items in batch (0-1)
   */
  recordBatchFailure(failureRatio: number = 1): BatchSizeAdjustment {
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;

    // Only reduce if failure ratio is significant
    if (failureRatio < 0.5 && this.consecutiveFailures < 2) {
      return {
        batchSize: this.currentBatchSize,
        wasAdjusted: false,
        direction: 'unchanged',
        reason: `Failure ratio ${(failureRatio * 100).toFixed(0)}% below threshold`,
      };
    }

    // Calculate new size based on failure severity
    const reductionFactor =
      failureRatio > 0.8
        ? this.batchConfig.reductionFactor * 0.5 // Severe failure: reduce more
        : this.batchConfig.reductionFactor;

    const newSize = Math.max(
      Math.floor(this.currentBatchSize * reductionFactor),
      this.batchConfig.minBatchSize
    );

    if (newSize < this.currentBatchSize) {
      const oldSize = this.currentBatchSize;
      this.currentBatchSize = newSize;

      log.warn('Batch size reduced due to failures', {
        oldSize,
        newSize,
        failureRatio: (failureRatio * 100).toFixed(0) + '%',
        consecutiveFailures: this.consecutiveFailures,
      });

      return {
        batchSize: newSize,
        wasAdjusted: true,
        direction: 'reduced',
        reason: `Reduced due to ${(failureRatio * 100).toFixed(0)}% failure rate`,
      };
    }

    return {
      batchSize: this.currentBatchSize,
      wasAdjusted: false,
      direction: 'unchanged',
      reason: 'Already at minimum batch size',
    };
  }

  /**
   * Reset batch size to default
   */
  resetBatchSize(): void {
    this.currentBatchSize = this.batchConfig.defaultBatchSize;
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures = 0;

    log.info('Batch size reset to default', {
      batchSize: this.currentBatchSize,
    });
  }

  /**
   * Set batch size manually (bounded by config limits)
   */
  setBatchSize(size: number): number {
    const boundedSize = Math.max(
      this.batchConfig.minBatchSize,
      Math.min(size, this.batchConfig.maxBatchSize)
    );

    this.currentBatchSize = boundedSize;
    return boundedSize;
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get retry strategy statistics
   */
  getStats(): {
    currentBatchSize: number;
    consecutiveSuccesses: number;
    consecutiveFailures: number;
    config: {
      retry: RetryConfig;
      batch: BatchSizeConfig;
    };
  } {
    return {
      currentBatchSize: this.currentBatchSize,
      consecutiveSuccesses: this.consecutiveSuccesses,
      consecutiveFailures: this.consecutiveFailures,
      config: {
        retry: this.retryConfig,
        batch: this.batchConfig,
      },
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Default retry strategy instance
 */
export const retryStrategy = new RetryStrategyService();
