/**
 * Error Classification Service
 *
 * Classifies sync errors to determine appropriate routing:
 * - Retry with backoff (transient errors)
 * - Dead letter immediately (permanent/structural errors)
 *
 * @module main/services/error-classifier
 * @security API-003: Error messages sanitized before classification
 * @compliance ERR-007: Error retry logic with proper categorization
 * @compliance MQ-002: Dead letter queue routing decisions
 */

import { createLogger } from '../utils/logger';
import type { ErrorCategory, DeadLetterReason } from '../dal/sync-queue.dal';

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('error-classifier');

// ============================================================================
// HTTP Status Code Classification
// ============================================================================

/**
 * HTTP status codes that indicate transient (retryable) errors
 * Per ERR-007: Only retry specific error types
 */
const TRANSIENT_HTTP_CODES = new Set([
  408, // Request Timeout
  429, // Too Many Requests (rate limit)
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]);

/**
 * HTTP status codes that indicate permanent (non-retryable) errors
 * Per MQ-002: Dead letter immediately
 */
const PERMANENT_HTTP_CODES = new Set([
  400, // Bad Request
  401, // Unauthorized (if auth is correct, this won't succeed on retry)
  403, // Forbidden
  404, // Not Found
  405, // Method Not Allowed
  409, // Conflict (duplicate)
  410, // Gone
  413, // Payload Too Large
  415, // Unsupported Media Type
  422, // Unprocessable Entity (validation error)
  451, // Unavailable For Legal Reasons
]);

// ============================================================================
// Error Pattern Classification
// ============================================================================

/**
 * Error patterns that indicate structural failures (invalid payload)
 * These will never succeed regardless of retries
 */
const STRUCTURAL_ERROR_PATTERNS = [
  /missing required field/i,
  /validation failed/i,
  /invalid payload/i,
  /schema validation/i,
  /required field .+ is missing/i,
  /cannot be null/i,
  /must be provided/i,
  /invalid format/i,
  /malformed/i,
  /parse error/i,
  /invalid json/i,
  /game not found/i,
  /game_code missing/i,
  /missing required fields/i,
  /bin_id.*missing/i,
  /opening_serial.*missing/i,
  /closing_serial.*missing/i,
  /depletion_reason.*missing/i,
  /return_reason.*missing/i,
];

/**
 * Error patterns that indicate transient failures
 */
const TRANSIENT_ERROR_PATTERNS = [
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /network error/i,
  /connection refused/i,
  /connection reset/i,
  /timeout/i,
  /temporarily unavailable/i,
  /service unavailable/i,
  /try again/i,
  /rate limit/i,
  /too many requests/i,
  /circuit breaker/i,
];

/**
 * Error patterns that indicate permanent failures
 */
const PERMANENT_ERROR_PATTERNS = [
  /not found/i,
  /does not exist/i,
  /already exists/i,
  /duplicate/i,
  /unauthorized/i,
  /forbidden/i,
  /permission denied/i,
  /access denied/i,
  /invalid credentials/i,
  /token expired/i,
  /bad request/i,
];

// ============================================================================
// Error Classification Interface
// ============================================================================

/**
 * Result of error classification
 */
export interface ErrorClassificationResult {
  /** Classified error category */
  category: ErrorCategory;
  /** Recommended action */
  action: 'RETRY' | 'DEAD_LETTER';
  /** If dead lettering, the reason to record */
  deadLetterReason?: DeadLetterReason;
  /** Whether to use extended backoff */
  extendedBackoff: boolean;
  /** Optional retry-after timestamp (for 429 responses) */
  retryAfter?: string;
}

// ============================================================================
// Error Classification Functions
// ============================================================================

/**
 * Classify an error based on HTTP status code and error message
 *
 * Per ERR-007 and MQ-002:
 * - Transient errors: retry with exponential backoff
 * - Permanent errors: dead letter immediately
 * - Structural errors: dead letter immediately (payload issues)
 * - Unknown errors: retry with extended backoff, then dead letter
 *
 * @param httpStatus - HTTP response status code (if available)
 * @param errorMessage - Error message string
 * @param retryAfterHeader - Retry-After header value (for 429 responses)
 * @returns Classification result with action recommendation
 */
export function classifyError(
  httpStatus?: number | null,
  errorMessage?: string | null,
  retryAfterHeader?: string | null
): ErrorClassificationResult {
  const message = errorMessage || '';

  // First, check for structural errors (payload issues that will never succeed)
  for (const pattern of STRUCTURAL_ERROR_PATTERNS) {
    if (pattern.test(message)) {
      log.debug('Error classified as STRUCTURAL', {
        httpStatus,
        pattern: pattern.source,
      });
      return {
        category: 'STRUCTURAL',
        action: 'DEAD_LETTER',
        deadLetterReason: 'STRUCTURAL_FAILURE',
        extendedBackoff: false,
      };
    }
  }

  // Check HTTP status code
  if (httpStatus) {
    // Rate limit - transient with Retry-After support
    if (httpStatus === 429) {
      let retryAfter: string | undefined;
      if (retryAfterHeader) {
        // Parse Retry-After header (can be seconds or HTTP date)
        const seconds = parseInt(retryAfterHeader, 10);
        if (!isNaN(seconds)) {
          retryAfter = new Date(Date.now() + seconds * 1000).toISOString();
        } else {
          // Try parsing as HTTP date
          const date = new Date(retryAfterHeader);
          if (!isNaN(date.getTime())) {
            retryAfter = date.toISOString();
          }
        }
      }

      return {
        category: 'TRANSIENT',
        action: 'RETRY',
        extendedBackoff: true,
        retryAfter,
      };
    }

    // Check for permanent HTTP errors
    if (PERMANENT_HTTP_CODES.has(httpStatus)) {
      log.debug('Error classified as PERMANENT (HTTP status)', { httpStatus });
      return {
        category: 'PERMANENT',
        action: 'DEAD_LETTER',
        deadLetterReason: 'PERMANENT_ERROR',
        extendedBackoff: false,
      };
    }

    // Check for transient HTTP errors
    if (TRANSIENT_HTTP_CODES.has(httpStatus)) {
      log.debug('Error classified as TRANSIENT (HTTP status)', { httpStatus });
      return {
        category: 'TRANSIENT',
        action: 'RETRY',
        extendedBackoff: httpStatus === 503 || httpStatus === 429,
      };
    }
  }

  // Check error message patterns for transient errors
  for (const pattern of TRANSIENT_ERROR_PATTERNS) {
    if (pattern.test(message)) {
      log.debug('Error classified as TRANSIENT (message pattern)', {
        pattern: pattern.source,
      });
      return {
        category: 'TRANSIENT',
        action: 'RETRY',
        extendedBackoff: false,
      };
    }
  }

  // Check error message patterns for permanent errors
  for (const pattern of PERMANENT_ERROR_PATTERNS) {
    if (pattern.test(message)) {
      log.debug('Error classified as PERMANENT (message pattern)', {
        pattern: pattern.source,
      });
      return {
        category: 'PERMANENT',
        action: 'DEAD_LETTER',
        deadLetterReason: 'PERMANENT_ERROR',
        extendedBackoff: false,
      };
    }
  }

  // Unknown error - retry with extended backoff, will eventually dead letter
  log.debug('Error classified as UNKNOWN', { httpStatus, message });
  return {
    category: 'UNKNOWN',
    action: 'RETRY',
    extendedBackoff: true,
  };
}

/**
 * Determine if an item should be dead-lettered based on attempts and error category
 *
 * Per ERR-007: Set maximum retry attempts (3-5)
 * Per MQ-002: Configure DLQ after N retry attempts
 *
 * Rules:
 * - STRUCTURAL errors: dead letter immediately (no retries)
 * - PERMANENT errors: dead letter after max_attempts
 * - TRANSIENT errors: keep retrying up to max_attempts * 2
 * - UNKNOWN errors: dead letter after max_attempts
 *
 * @param syncAttempts - Current sync attempt count
 * @param maxAttempts - Maximum configured attempts
 * @param errorCategory - Classified error category
 * @returns Whether the item should be dead-lettered
 */
export function shouldDeadLetter(
  syncAttempts: number,
  maxAttempts: number,
  errorCategory: ErrorCategory | null
): { shouldDeadLetter: boolean; reason?: DeadLetterReason } {
  // Structural errors are immediately dead-lettered
  if (errorCategory === 'STRUCTURAL') {
    return {
      shouldDeadLetter: true,
      reason: 'STRUCTURAL_FAILURE',
    };
  }

  // Permanent errors are dead-lettered after max attempts
  if (errorCategory === 'PERMANENT' && syncAttempts >= maxAttempts) {
    return {
      shouldDeadLetter: true,
      reason: 'PERMANENT_ERROR',
    };
  }

  // Unknown errors are dead-lettered after max attempts
  if (errorCategory === 'UNKNOWN' && syncAttempts >= maxAttempts) {
    return {
      shouldDeadLetter: true,
      reason: 'MAX_ATTEMPTS_EXCEEDED',
    };
  }

  // Transient errors get extended retry window (2x max attempts)
  // This allows recovery from extended outages
  if (errorCategory === 'TRANSIENT' && syncAttempts >= maxAttempts * 2) {
    return {
      shouldDeadLetter: true,
      reason: 'MAX_ATTEMPTS_EXCEEDED',
    };
  }

  // Items without error category that exceed absolute limit
  if (syncAttempts >= maxAttempts * 2) {
    return {
      shouldDeadLetter: true,
      reason: 'MAX_ATTEMPTS_EXCEEDED',
    };
  }

  return { shouldDeadLetter: false };
}

/**
 * Validate payload for required fields based on entity type and operation
 *
 * Returns structural failure if required fields are missing.
 * This allows early detection of items that will never sync successfully.
 *
 * @param entityType - Type of entity (pack, employee, shift, etc.)
 * @param operation - Sync operation (CREATE, UPDATE, DELETE, ACTIVATE)
 * @param payload - Parsed payload object
 * @returns Validation result
 */
export function validatePayloadStructure(
  entityType: string,
  operation: string,
  payload: Record<string, unknown>
): { valid: boolean; missingFields?: string[] } {
  const missingFields: string[] = [];

  if (entityType === 'pack') {
    // All pack operations require these base fields
    if (!payload.pack_id) missingFields.push('pack_id');
    if (!payload.store_id) missingFields.push('store_id');

    if (operation === 'CREATE') {
      if (!payload.game_id && !payload.game_code) {
        missingFields.push('game_id or game_code');
      }
      if (!payload.pack_number) missingFields.push('pack_number');
    }

    if (operation === 'ACTIVATE' || (operation === 'UPDATE' && payload.status === 'ACTIVE')) {
      if (!payload.bin_id) missingFields.push('bin_id');
      if (!payload.opening_serial) missingFields.push('opening_serial');
      if (!payload.activated_at) missingFields.push('activated_at');
      if (!payload.received_at) missingFields.push('received_at');
    }

    if (operation === 'UPDATE' && payload.status === 'DEPLETED') {
      if (!payload.closing_serial) missingFields.push('closing_serial');
      if (!payload.depleted_at) missingFields.push('depleted_at');
      if (!payload.depletion_reason) missingFields.push('depletion_reason');
    }

    if (operation === 'UPDATE' && payload.status === 'RETURNED') {
      if (!payload.returned_at) missingFields.push('returned_at');
      if (!payload.return_reason) missingFields.push('return_reason');
    }
  }

  if (entityType === 'employee') {
    if (!payload.employee_id) missingFields.push('employee_id');
    if (!payload.store_id) missingFields.push('store_id');
    if (operation === 'CREATE') {
      if (!payload.first_name) missingFields.push('first_name');
      if (!payload.last_name) missingFields.push('last_name');
    }
  }

  if (entityType === 'shift') {
    if (!payload.shift_id) missingFields.push('shift_id');
    if (!payload.store_id) missingFields.push('store_id');
  }

  return {
    valid: missingFields.length === 0,
    missingFields: missingFields.length > 0 ? missingFields : undefined,
  };
}

// ============================================================================
// Export
// ============================================================================

export const errorClassifierService = {
  classifyError,
  shouldDeadLetter,
  validatePayloadStructure,
};
