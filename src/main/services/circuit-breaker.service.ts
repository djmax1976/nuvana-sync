/**
 * Circuit Breaker Service
 *
 * Implements the Circuit Breaker pattern (ERR-008) for cloud API calls to prevent
 * cascade failures when downstream services are unhealthy.
 *
 * States:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Circuit is tripped, requests fail immediately without calling API
 * - HALF_OPEN: Testing recovery, limited requests allowed through
 *
 * @module main/services/circuit-breaker
 * @security ERR-008: Circuit breaker for external service calls
 * @security LM-002: Structured metrics for monitoring
 * @compliance SYNC-5000: Phase 4 - Retry/Backoff/Circuit Breaker Hardening
 */

import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Circuit breaker states
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Circuit tripped, requests fail fast
 * - HALF_OPEN: Testing recovery with limited traffic
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before circuit opens (default: 5) */
  failureThreshold: number;
  /** Time in milliseconds before attempting recovery (default: 30000 = 30s) */
  resetTimeoutMs: number;
  /** Time window in milliseconds to count failures (default: 60000 = 60s) */
  failureWindowMs: number;
  /** Number of successful requests needed to close from HALF_OPEN (default: 2) */
  successThreshold: number;
  /** HTTP status codes considered as failures (default: 500, 502, 503, 504, 429) */
  failureStatusCodes: Set<number>;
}

/**
 * Circuit breaker metrics for monitoring (LM-002)
 */
export interface CircuitBreakerMetrics {
  /** Current circuit state */
  state: CircuitState;
  /** Total failures since last reset */
  failureCount: number;
  /** Total successes since last state change */
  successCount: number;
  /** Timestamp when circuit opened (null if not open) */
  openedAt: number | null;
  /** Timestamp when state last changed */
  lastStateChangeAt: number;
  /** Total requests since startup */
  totalRequests: number;
  /** Total rejected requests (during OPEN state) */
  rejectedRequests: number;
  /** Last failure timestamp */
  lastFailureAt: number | null;
  /** Last failure reason */
  lastFailureReason: string | null;
}

/**
 * Request execution result
 */
export interface CircuitBreakerResult<T> {
  /** Whether the request was executed (false if rejected by circuit) */
  executed: boolean;
  /** Result of the request (undefined if not executed) */
  result?: T;
  /** Error if request failed (either execution error or circuit rejection) */
  error?: Error;
  /** Whether the circuit rejected this request */
  rejectedByCircuit: boolean;
  /** Current circuit state after this request */
  circuitState: CircuitState;
}

/**
 * Failure record for tracking within time window
 */
interface FailureRecord {
  timestamp: number;
  statusCode?: number;
  reason: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Default failure threshold before opening circuit */
const DEFAULT_FAILURE_THRESHOLD = 5;

/** Default reset timeout (30 seconds) */
const DEFAULT_RESET_TIMEOUT_MS = 30_000;

/** Default failure window (60 seconds) */
const DEFAULT_FAILURE_WINDOW_MS = 60_000;

/** Default success threshold to close from HALF_OPEN */
const DEFAULT_SUCCESS_THRESHOLD = 2;

/** Default HTTP status codes that count as failures */
const DEFAULT_FAILURE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/** Maximum recorded failures to prevent memory issues */
const MAX_RECORDED_FAILURES = 100;

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('circuit-breaker');

// ============================================================================
// Circuit Breaker Service
// ============================================================================

/**
 * Circuit Breaker Service
 *
 * Prevents cascade failures by failing fast when downstream services are unhealthy.
 * Automatically recovers by testing limited traffic after reset timeout.
 *
 * Usage:
 * ```typescript
 * const breaker = new CircuitBreakerService('cloud-api');
 * const result = await breaker.execute(() => fetch('/api/data'));
 * if (result.rejectedByCircuit) {
 *   // Use fallback or cached data
 * }
 * ```
 */
export class CircuitBreakerService {
  private readonly name: string;
  private readonly config: CircuitBreakerConfig;

  private state: CircuitState = 'CLOSED';
  private failureRecords: FailureRecord[] = [];
  private successCountInHalfOpen: number = 0;
  private openedAt: number | null = null;
  private lastStateChangeAt: number = Date.now();
  private totalRequests: number = 0;
  private rejectedRequests: number = 0;
  private lastFailureAt: number | null = null;
  private lastFailureReason: string | null = null;

  constructor(name: string, config?: Partial<CircuitBreakerConfig>) {
    this.name = name;
    this.config = {
      failureThreshold: config?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD,
      resetTimeoutMs: config?.resetTimeoutMs ?? DEFAULT_RESET_TIMEOUT_MS,
      failureWindowMs: config?.failureWindowMs ?? DEFAULT_FAILURE_WINDOW_MS,
      successThreshold: config?.successThreshold ?? DEFAULT_SUCCESS_THRESHOLD,
      failureStatusCodes: config?.failureStatusCodes ?? DEFAULT_FAILURE_STATUS_CODES,
    };

    log.info('Circuit breaker initialized', {
      name: this.name,
      config: {
        failureThreshold: this.config.failureThreshold,
        resetTimeoutMs: this.config.resetTimeoutMs,
        failureWindowMs: this.config.failureWindowMs,
        successThreshold: this.config.successThreshold,
        failureStatusCodes: Array.from(this.config.failureStatusCodes),
      },
    });
  }

  // ==========================================================================
  // Core Methods
  // ==========================================================================

  /**
   * Execute a request through the circuit breaker
   *
   * @param operation - Async function to execute
   * @returns Execution result with circuit state
   */
  async execute<T>(operation: () => Promise<T>): Promise<CircuitBreakerResult<T>> {
    this.totalRequests++;

    // Check if circuit should transition from OPEN to HALF_OPEN
    if (this.state === 'OPEN') {
      if (this.shouldAttemptReset()) {
        this.transitionTo('HALF_OPEN');
      } else {
        // Circuit is open - reject immediately
        this.rejectedRequests++;
        log.debug('Request rejected by open circuit', {
          name: this.name,
          openedAt: this.openedAt,
          resetTimeoutMs: this.config.resetTimeoutMs,
        });
        return {
          executed: false,
          rejectedByCircuit: true,
          circuitState: this.state,
          error: new CircuitOpenError(
            `Circuit breaker [${this.name}] is OPEN. Request rejected.`,
            this.getMetrics()
          ),
        };
      }
    }

    // Execute the operation
    try {
      const result = await operation();
      this.recordSuccess();
      return {
        executed: true,
        result,
        rejectedByCircuit: false,
        circuitState: this.state,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const httpStatus = this.extractHttpStatus(err);
      this.recordFailure(err.message, httpStatus);
      return {
        executed: true,
        error: err,
        rejectedByCircuit: false,
        circuitState: this.state,
      };
    }
  }

  /**
   * Record a failure from external processing
   * Use this when errors are handled outside execute()
   *
   * @param reason - Failure reason
   * @param httpStatus - HTTP status code (if applicable)
   */
  recordFailure(reason: string, httpStatus?: number): void {
    const now = Date.now();

    // Only count failures for configured status codes (or all errors without status)
    if (httpStatus !== undefined && !this.config.failureStatusCodes.has(httpStatus)) {
      log.debug('Failure not counted - status code not in failure set', {
        name: this.name,
        httpStatus,
        failureStatusCodes: Array.from(this.config.failureStatusCodes),
      });
      return;
    }

    // Record the failure
    this.failureRecords.push({
      timestamp: now,
      statusCode: httpStatus,
      reason,
    });
    this.lastFailureAt = now;
    this.lastFailureReason = reason;

    // Trim old records to prevent memory issues
    if (this.failureRecords.length > MAX_RECORDED_FAILURES) {
      this.failureRecords = this.failureRecords.slice(-MAX_RECORDED_FAILURES);
    }

    // Clean up failures outside the window
    this.pruneOldFailures();

    // Check if we should trip the circuit
    if (this.state === 'CLOSED') {
      const recentFailures = this.countRecentFailures();
      if (recentFailures >= this.config.failureThreshold) {
        this.transitionTo('OPEN');
        log.warn('Circuit breaker opened due to failure threshold', {
          name: this.name,
          failures: recentFailures,
          threshold: this.config.failureThreshold,
          windowMs: this.config.failureWindowMs,
        });
      }
    } else if (this.state === 'HALF_OPEN') {
      // Any failure in HALF_OPEN reopens the circuit
      this.transitionTo('OPEN');
      log.warn('Circuit breaker reopened from HALF_OPEN state', {
        name: this.name,
        reason,
        httpStatus,
      });
    }
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCountInHalfOpen++;
      log.debug('Success in HALF_OPEN state', {
        name: this.name,
        successCount: this.successCountInHalfOpen,
        threshold: this.config.successThreshold,
      });

      if (this.successCountInHalfOpen >= this.config.successThreshold) {
        this.transitionTo('CLOSED');
        log.info('Circuit breaker closed after recovery', {
          name: this.name,
          successesRequired: this.config.successThreshold,
        });
      }
    }
  }

  /**
   * Check if an HTTP status should trigger failure recording
   *
   * @param httpStatus - HTTP status code
   * @returns Whether this status counts as a failure
   */
  isFailureStatus(httpStatus: number): boolean {
    return this.config.failureStatusCodes.has(httpStatus);
  }

  // ==========================================================================
  // State Management
  // ==========================================================================

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit breaker metrics (LM-002)
   */
  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failureCount: this.countRecentFailures(),
      successCount: this.successCountInHalfOpen,
      openedAt: this.openedAt,
      lastStateChangeAt: this.lastStateChangeAt,
      totalRequests: this.totalRequests,
      rejectedRequests: this.rejectedRequests,
      lastFailureAt: this.lastFailureAt,
      lastFailureReason: this.lastFailureReason,
    };
  }

  /**
   * Manually reset the circuit breaker to CLOSED state
   * Use for administrative override or recovery
   */
  reset(): void {
    this.transitionTo('CLOSED');
    this.failureRecords = [];
    log.info('Circuit breaker manually reset', { name: this.name });
  }

  /**
   * Force the circuit to OPEN state
   * Use for administrative override or preemptive protection
   */
  forceOpen(): void {
    this.transitionTo('OPEN');
    log.warn('Circuit breaker force-opened', { name: this.name });
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const previousState = this.state;
    this.state = newState;
    this.lastStateChangeAt = Date.now();

    if (newState === 'OPEN') {
      this.openedAt = Date.now();
      this.successCountInHalfOpen = 0;
    } else if (newState === 'HALF_OPEN') {
      this.successCountInHalfOpen = 0;
    } else if (newState === 'CLOSED') {
      this.openedAt = null;
      this.successCountInHalfOpen = 0;
      this.failureRecords = [];
    }

    log.info('Circuit breaker state changed', {
      name: this.name,
      from: previousState,
      to: newState,
    });
  }

  /**
   * Check if enough time has passed to attempt recovery
   */
  private shouldAttemptReset(): boolean {
    if (this.openedAt === null) return false;
    return Date.now() - this.openedAt >= this.config.resetTimeoutMs;
  }

  /**
   * Count failures within the time window
   */
  private countRecentFailures(): number {
    const cutoff = Date.now() - this.config.failureWindowMs;
    return this.failureRecords.filter((f) => f.timestamp >= cutoff).length;
  }

  /**
   * Remove failures outside the time window
   */
  private pruneOldFailures(): void {
    const cutoff = Date.now() - this.config.failureWindowMs;
    this.failureRecords = this.failureRecords.filter((f) => f.timestamp >= cutoff);
  }

  /**
   * Extract HTTP status from error if available
   */
  private extractHttpStatus(error: Error): number | undefined {
    // Check for CloudApiError pattern
    if (
      'httpStatus' in error &&
      typeof (error as { httpStatus: unknown }).httpStatus === 'number'
    ) {
      return (error as { httpStatus: number }).httpStatus;
    }

    // Check for common patterns in error message
    const statusMatch = error.message.match(/\b([45]\d{2})\b/);
    if (statusMatch) {
      return parseInt(statusMatch[1], 10);
    }

    return undefined;
  }
}

// ============================================================================
// Custom Error Types
// ============================================================================

/**
 * Error thrown when circuit breaker rejects a request
 */
export class CircuitOpenError extends Error {
  public readonly metrics: CircuitBreakerMetrics;

  constructor(message: string, metrics: CircuitBreakerMetrics) {
    super(message);
    this.name = 'CircuitOpenError';
    this.metrics = metrics;
    Object.setPrototypeOf(this, CircuitOpenError.prototype);
  }
}

// ============================================================================
// Singleton Instances
// ============================================================================

/**
 * Circuit breaker for cloud API calls
 * Shared instance for all cloud API operations
 */
export const cloudApiCircuitBreaker = new CircuitBreakerService('cloud-api', {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  failureWindowMs: 60_000,
  successThreshold: 2,
  failureStatusCodes: new Set([429, 500, 502, 503, 504]),
});

/**
 * Circuit breaker for sync operations
 * Slightly more tolerant for sync failures
 */
export const syncCircuitBreaker = new CircuitBreakerService('sync', {
  failureThreshold: 8,
  resetTimeoutMs: 45_000,
  failureWindowMs: 120_000,
  successThreshold: 3,
  failureStatusCodes: new Set([429, 500, 502, 503, 504]),
});
