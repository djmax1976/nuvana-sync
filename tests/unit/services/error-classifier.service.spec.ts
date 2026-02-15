/**
 * Error Classifier Service Unit Tests
 *
 * Enterprise-grade tests for error classification logic that determines
 * retry vs dead-letter routing decisions.
 *
 * Traceability:
 * - ERR-007: Error retry logic with proper categorization
 * - MQ-002: Dead Letter Queue routing decisions
 * - API-001: Input validation
 * - API-003: Error messages sanitized before classification
 *
 * @module tests/unit/services/error-classifier.service.spec
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger to prevent console output during tests
vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import {
  classifyError,
  shouldDeadLetter,
  validatePayloadStructure,
} from '../../../src/main/services/error-classifier.service';

// ============================================================================
// classifyError() - HTTP Status Code Classification Tests
// ERR-007: Error retry logic with proper categorization
// ============================================================================

describe('Error Classifier Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('classifyError() - HTTP Status Classification', () => {
    // ========================================================================
    // Transient HTTP Status Codes (should retry)
    // ERR-007: Only retry specific error types
    // ========================================================================

    describe('Transient HTTP Status Codes', () => {
      it('should classify 429 Too Many Requests as TRANSIENT with extended backoff', () => {
        const result = classifyError(429, 'Rate limit exceeded');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
        expect(result.extendedBackoff).toBe(true);
        expect(result.deadLetterReason).toBeUndefined();
      });

      it('should parse Retry-After header with seconds value for 429', () => {
        const result = classifyError(429, 'Rate limit exceeded', '60');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
        expect(result.retryAfter).toBeDefined();

        // Should be approximately 60 seconds from now
        const retryTime = new Date(result.retryAfter!).getTime();
        const expectedTime = Date.now() + 60 * 1000;
        expect(Math.abs(retryTime - expectedTime)).toBeLessThan(1000); // 1s tolerance
      });

      it('should parse Retry-After header with HTTP date format for 429', () => {
        const futureDate = new Date(Date.now() + 120000); // 2 minutes from now
        const httpDate = futureDate.toUTCString();

        const result = classifyError(429, 'Rate limit exceeded', httpDate);

        expect(result.category).toBe('TRANSIENT');
        expect(result.retryAfter).toBeDefined();

        const retryTime = new Date(result.retryAfter!).getTime();
        expect(Math.abs(retryTime - futureDate.getTime())).toBeLessThan(1000);
      });

      it('should handle invalid Retry-After header gracefully', () => {
        const result = classifyError(429, 'Rate limit exceeded', 'invalid-value');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
        expect(result.retryAfter).toBeUndefined();
      });

      it('should classify 500 Internal Server Error as TRANSIENT', () => {
        const result = classifyError(500, 'Internal server error');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
        expect(result.extendedBackoff).toBe(false);
      });

      it('should classify 502 Bad Gateway as TRANSIENT', () => {
        const result = classifyError(502, 'Bad gateway');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify 503 Service Unavailable as TRANSIENT with extended backoff', () => {
        const result = classifyError(503, 'Service unavailable');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
        expect(result.extendedBackoff).toBe(true);
      });

      it('should classify 504 Gateway Timeout as TRANSIENT', () => {
        const result = classifyError(504, 'Gateway timeout');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify 408 Request Timeout as TRANSIENT', () => {
        const result = classifyError(408, 'Request timeout');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
      });
    });

    // ========================================================================
    // Permanent HTTP Status Codes (should dead letter)
    // MQ-002: Dead letter immediately for non-retryable errors
    // ========================================================================

    describe('Permanent HTTP Status Codes', () => {
      it('should classify 400 Bad Request as PERMANENT', () => {
        const result = classifyError(400, 'Bad request');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
        expect(result.deadLetterReason).toBe('PERMANENT_ERROR');
        expect(result.extendedBackoff).toBe(false);
      });

      it('should classify 401 Unauthorized as PERMANENT', () => {
        const result = classifyError(401, 'Unauthorized');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
        expect(result.deadLetterReason).toBe('PERMANENT_ERROR');
      });

      it('should classify 403 Forbidden as PERMANENT', () => {
        const result = classifyError(403, 'Forbidden');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify 404 Not Found as PERMANENT', () => {
        const result = classifyError(404, 'Not found');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify 405 Method Not Allowed as PERMANENT', () => {
        const result = classifyError(405, 'Method not allowed');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
      });

      // Note: 409 is now classified as CONFLICT (D4.2), see Conflict tests below
    });

    // ========================================================================
    // Conflict HTTP Status Codes (D4.2 - limited retries)
    // ========================================================================

    describe('Conflict HTTP Status Codes (D4.2)', () => {
      it('should classify 409 Conflict as CONFLICT with limited retry', () => {
        const result = classifyError(409, 'Resource already exists');

        expect(result.category).toBe('CONFLICT');
        expect(result.action).toBe('RETRY');
        expect(result.deadLetterReason).toBe('CONFLICT_ERROR');
      });

      it('should classify 409 with duplicate message as CONFLICT', () => {
        const result = classifyError(409, 'Duplicate entry for key pack_id');

        expect(result.category).toBe('CONFLICT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify 409 with concurrent update as CONFLICT', () => {
        const result = classifyError(409, 'Concurrent update detected');

        expect(result.category).toBe('CONFLICT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify 410 Gone as PERMANENT', () => {
        const result = classifyError(410, 'Resource gone');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify 413 Payload Too Large as PERMANENT', () => {
        const result = classifyError(413, 'Payload too large');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify 415 Unsupported Media Type as PERMANENT', () => {
        const result = classifyError(415, 'Unsupported media type');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify 422 Unprocessable Entity as PERMANENT', () => {
        const result = classifyError(422, 'Validation error');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify 451 Unavailable For Legal Reasons as PERMANENT', () => {
        const result = classifyError(451, 'Unavailable for legal reasons');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
      });
    });

    // ========================================================================
    // Unknown HTTP Status Codes
    // ========================================================================

    describe('Unknown/Unclassified HTTP Status Codes', () => {
      it('should classify unknown status code as UNKNOWN with retry', () => {
        const result = classifyError(418, "I'm a teapot"); // RFC 2324

        expect(result.category).toBe('UNKNOWN');
        expect(result.action).toBe('RETRY');
        expect(result.extendedBackoff).toBe(true);
      });

      it('should classify 2xx success codes as UNKNOWN (unexpected in error path)', () => {
        const result = classifyError(200, 'Success but treated as error');

        expect(result.category).toBe('UNKNOWN');
        expect(result.action).toBe('RETRY');
      });
    });
  });

  // ==========================================================================
  // classifyError() - Error Message Pattern Classification Tests
  // ERR-007: Pattern-based error classification
  // ==========================================================================

  describe('classifyError() - Error Message Pattern Classification', () => {
    // ========================================================================
    // Structural Error Patterns (dead letter immediately)
    // These errors indicate payload issues that will never succeed
    // ========================================================================

    describe('Structural Error Patterns', () => {
      it('should classify "missing required field" as STRUCTURAL', () => {
        const result = classifyError(null, 'Error: missing required field pack_number');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
        expect(result.deadLetterReason).toBe('STRUCTURAL_FAILURE');
      });

      it('should classify "validation failed" as STRUCTURAL', () => {
        const result = classifyError(null, 'Validation failed for field: game_id');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
        expect(result.deadLetterReason).toBe('STRUCTURAL_FAILURE');
      });

      it('should classify "invalid payload" as STRUCTURAL', () => {
        const result = classifyError(null, 'Invalid payload structure');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "schema validation" as STRUCTURAL', () => {
        const result = classifyError(null, 'Schema validation error: field type mismatch');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "required field X is missing" as STRUCTURAL', () => {
        const result = classifyError(null, 'Required field store_id is missing');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "cannot be null" as STRUCTURAL', () => {
        const result = classifyError(null, 'Field pack_id cannot be null');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "must be provided" as STRUCTURAL', () => {
        const result = classifyError(null, 'game_code must be provided');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "invalid format" as STRUCTURAL', () => {
        const result = classifyError(null, 'Invalid format for date field');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "malformed" as STRUCTURAL', () => {
        const result = classifyError(null, 'Malformed JSON in request body');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "parse error" as STRUCTURAL', () => {
        const result = classifyError(null, 'JSON parse error at position 45');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "invalid json" as STRUCTURAL', () => {
        const result = classifyError(null, 'Invalid JSON: unexpected token');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "game not found" as STRUCTURAL', () => {
        const result = classifyError(null, 'Game not found for game_id: abc123');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "game_code missing" as STRUCTURAL', () => {
        const result = classifyError(null, 'game_code missing from payload');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "missing required fields" (plural) as STRUCTURAL', () => {
        const result = classifyError(null, 'Missing required fields: pack_id, store_id');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "bin_id missing" (regex pattern) as STRUCTURAL', () => {
        const result = classifyError(null, 'Error: bin_id is missing for activation');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "opening_serial missing" as STRUCTURAL', () => {
        const result = classifyError(null, 'opening_serial field missing in ACTIVE pack');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "closing_serial missing" as STRUCTURAL', () => {
        const result = classifyError(null, 'closing_serial is missing for depleted pack');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "depletion_reason missing" as STRUCTURAL', () => {
        const result = classifyError(null, 'depletion_reason missing from depleted pack payload');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "return_reason missing" as STRUCTURAL', () => {
        const result = classifyError(null, 'return_reason is missing for returned pack');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
      });
    });

    // ========================================================================
    // Transient Error Patterns (should retry)
    // ========================================================================

    describe('Transient Error Patterns', () => {
      it('should classify "ECONNREFUSED" as TRANSIENT', () => {
        const result = classifyError(null, 'Error: connect ECONNREFUSED 127.0.0.1:3000');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "ECONNRESET" as TRANSIENT', () => {
        const result = classifyError(null, 'Error: read ECONNRESET');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "ETIMEDOUT" as TRANSIENT', () => {
        const result = classifyError(null, 'Error: connect ETIMEDOUT');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "ENOTFOUND" as TRANSIENT', () => {
        const result = classifyError(null, 'Error: getaddrinfo ENOTFOUND api.example.com');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "network error" as TRANSIENT', () => {
        const result = classifyError(null, 'Network error: unable to connect');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "connection refused" as TRANSIENT', () => {
        const result = classifyError(null, 'Connection refused by server');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "connection reset" as TRANSIENT', () => {
        const result = classifyError(null, 'Connection reset by peer');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "timeout" as TRANSIENT', () => {
        const result = classifyError(null, 'Request timeout after 30000ms');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "temporarily unavailable" as TRANSIENT', () => {
        const result = classifyError(null, 'Service temporarily unavailable');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "service unavailable" as TRANSIENT', () => {
        const result = classifyError(null, 'The service is unavailable, please try again');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "try again" as TRANSIENT', () => {
        const result = classifyError(null, 'Server busy, please try again later');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "rate limit" (message) as TRANSIENT', () => {
        const result = classifyError(null, 'Rate limit exceeded, slow down');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "too many requests" as TRANSIENT', () => {
        const result = classifyError(null, 'Too many requests from this IP');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "circuit breaker" as TRANSIENT', () => {
        const result = classifyError(null, 'Circuit breaker is open');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
      });
    });

    // ========================================================================
    // Permanent Error Patterns (should dead letter after retries)
    // ========================================================================

    describe('Permanent Error Patterns', () => {
      it('should classify "not found" (message) as PERMANENT', () => {
        const result = classifyError(null, 'Resource not found');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
        expect(result.deadLetterReason).toBe('PERMANENT_ERROR');
      });

      it('should classify "does not exist" as PERMANENT', () => {
        const result = classifyError(null, 'The requested entity does not exist');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
      });

      // Note: "already exists" and "duplicate" moved to Conflict Error Patterns (D4.2)

      it('should classify "unauthorized" (message) as PERMANENT', () => {
        const result = classifyError(null, 'Unauthorized: invalid API key');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "forbidden" (message) as PERMANENT', () => {
        const result = classifyError(null, 'Forbidden: insufficient permissions');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "permission denied" as PERMANENT', () => {
        const result = classifyError(null, 'Permission denied for this operation');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "access denied" as PERMANENT', () => {
        const result = classifyError(null, 'Access denied to resource');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "invalid credentials" as PERMANENT', () => {
        const result = classifyError(null, 'Invalid credentials provided');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "token expired" as PERMANENT', () => {
        const result = classifyError(null, 'JWT token expired');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should classify "bad request" (message) as PERMANENT', () => {
        const result = classifyError(null, 'Bad request: invalid parameters');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
      });
    });

    // ========================================================================
    // Conflict Error Patterns (D4.2 - limited retries, may resolve)
    // ========================================================================

    describe('Conflict Error Patterns (D4.2)', () => {
      it('should classify "already exists" as CONFLICT', () => {
        const result = classifyError(null, 'Resource already exists with this ID');

        expect(result.category).toBe('CONFLICT');
        expect(result.action).toBe('RETRY');
        expect(result.deadLetterReason).toBe('CONFLICT_ERROR');
      });

      it('should classify "duplicate" as CONFLICT', () => {
        const result = classifyError(null, 'Duplicate entry for key pack_number');

        expect(result.category).toBe('CONFLICT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "conflict" as CONFLICT', () => {
        const result = classifyError(null, 'Conflict: resource has been modified');

        expect(result.category).toBe('CONFLICT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "concurrent update" as CONFLICT', () => {
        const result = classifyError(null, 'Concurrent update detected');

        expect(result.category).toBe('CONFLICT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "version mismatch" as CONFLICT', () => {
        const result = classifyError(null, 'Version mismatch: expected v2, got v1');

        expect(result.category).toBe('CONFLICT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "optimistic lock" as CONFLICT', () => {
        const result = classifyError(null, 'Optimistic lock failure');

        expect(result.category).toBe('CONFLICT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "unique constraint" as CONFLICT', () => {
        const result = classifyError(null, 'Unique constraint violation');

        expect(result.category).toBe('CONFLICT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "duplicate key" as CONFLICT', () => {
        const result = classifyError(null, 'Duplicate key error');

        expect(result.category).toBe('CONFLICT');
        expect(result.action).toBe('RETRY');
      });

      it('should classify "record exists" as CONFLICT', () => {
        const result = classifyError(null, 'Record exists with the same identifier');

        expect(result.category).toBe('CONFLICT');
        expect(result.action).toBe('RETRY');
      });
    });

    // ========================================================================
    // Unknown/Unclassified Error Patterns
    // ========================================================================

    describe('Unknown Error Patterns', () => {
      it('should classify unrecognized error message as UNKNOWN with retry', () => {
        const result = classifyError(null, 'Something unexpected happened');

        expect(result.category).toBe('UNKNOWN');
        expect(result.action).toBe('RETRY');
        expect(result.extendedBackoff).toBe(true);
      });

      it('should classify empty error message as UNKNOWN', () => {
        const result = classifyError(null, '');

        expect(result.category).toBe('UNKNOWN');
        expect(result.action).toBe('RETRY');
      });

      it('should classify null error message as UNKNOWN', () => {
        const result = classifyError(null, null);

        expect(result.category).toBe('UNKNOWN');
        expect(result.action).toBe('RETRY');
      });

      it('should handle undefined error message', () => {
        const result = classifyError(null, undefined);

        expect(result.category).toBe('UNKNOWN');
        expect(result.action).toBe('RETRY');
      });
    });

    // ========================================================================
    // Priority: HTTP Status vs Message Pattern
    // Structural patterns take priority, then HTTP status, then message patterns
    // ========================================================================

    describe('Classification Priority', () => {
      it('should prioritize STRUCTURAL pattern over HTTP status', () => {
        // Even with 500 status, structural error should take precedence
        const result = classifyError(500, 'missing required field: pack_id');

        expect(result.category).toBe('STRUCTURAL');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should prioritize HTTP status over non-structural message patterns', () => {
        // 400 status should override transient message pattern
        const result = classifyError(400, 'try again later');

        expect(result.category).toBe('PERMANENT');
        expect(result.action).toBe('DEAD_LETTER');
      });

      it('should use message pattern when HTTP status is unknown', () => {
        const result = classifyError(418, 'connection refused');

        expect(result.category).toBe('TRANSIENT');
        expect(result.action).toBe('RETRY');
      });
    });
  });

  // ==========================================================================
  // shouldDeadLetter() - Routing Decision Tests
  // MQ-002: Configure DLQ after N retry attempts
  // ==========================================================================

  describe('shouldDeadLetter() - Routing Decisions', () => {
    const MAX_ATTEMPTS = 5;

    // ========================================================================
    // STRUCTURAL errors - immediate dead letter
    // ========================================================================

    describe('STRUCTURAL errors', () => {
      it('should dead letter STRUCTURAL errors immediately (0 attempts)', () => {
        const result = shouldDeadLetter(0, MAX_ATTEMPTS, 'STRUCTURAL');

        expect(result.shouldDeadLetter).toBe(true);
        expect(result.reason).toBe('STRUCTURAL_FAILURE');
      });

      it('should dead letter STRUCTURAL errors regardless of attempt count', () => {
        const result = shouldDeadLetter(1, MAX_ATTEMPTS, 'STRUCTURAL');

        expect(result.shouldDeadLetter).toBe(true);
        expect(result.reason).toBe('STRUCTURAL_FAILURE');
      });
    });

    // ========================================================================
    // PERMANENT errors - dead letter after max attempts
    // ========================================================================

    describe('PERMANENT errors', () => {
      it('should NOT dead letter PERMANENT error before max attempts', () => {
        const result = shouldDeadLetter(3, MAX_ATTEMPTS, 'PERMANENT');

        expect(result.shouldDeadLetter).toBe(false);
        expect(result.reason).toBeUndefined();
      });

      it('should dead letter PERMANENT error at max attempts', () => {
        const result = shouldDeadLetter(5, MAX_ATTEMPTS, 'PERMANENT');

        expect(result.shouldDeadLetter).toBe(true);
        expect(result.reason).toBe('PERMANENT_ERROR');
      });

      it('should dead letter PERMANENT error after max attempts', () => {
        const result = shouldDeadLetter(7, MAX_ATTEMPTS, 'PERMANENT');

        expect(result.shouldDeadLetter).toBe(true);
        expect(result.reason).toBe('PERMANENT_ERROR');
      });
    });

    // ========================================================================
    // CONFLICT errors - dead letter after max attempts (D4.2)
    // ========================================================================

    describe('CONFLICT errors (D4.2)', () => {
      it('should NOT dead letter CONFLICT error before max attempts', () => {
        const result = shouldDeadLetter(3, MAX_ATTEMPTS, 'CONFLICT');

        expect(result.shouldDeadLetter).toBe(false);
        expect(result.reason).toBeUndefined();
      });

      it('should dead letter CONFLICT error at max attempts', () => {
        const result = shouldDeadLetter(5, MAX_ATTEMPTS, 'CONFLICT');

        expect(result.shouldDeadLetter).toBe(true);
        expect(result.reason).toBe('CONFLICT_ERROR');
      });

      it('should dead letter CONFLICT error after max attempts', () => {
        const result = shouldDeadLetter(7, MAX_ATTEMPTS, 'CONFLICT');

        expect(result.shouldDeadLetter).toBe(true);
        expect(result.reason).toBe('CONFLICT_ERROR');
      });
    });

    // ========================================================================
    // UNKNOWN errors - dead letter after max attempts
    // ========================================================================

    describe('UNKNOWN errors', () => {
      it('should NOT dead letter UNKNOWN error before max attempts', () => {
        const result = shouldDeadLetter(3, MAX_ATTEMPTS, 'UNKNOWN');

        expect(result.shouldDeadLetter).toBe(false);
      });

      it('should dead letter UNKNOWN error at max attempts', () => {
        const result = shouldDeadLetter(5, MAX_ATTEMPTS, 'UNKNOWN');

        expect(result.shouldDeadLetter).toBe(true);
        expect(result.reason).toBe('MAX_ATTEMPTS_EXCEEDED');
      });
    });

    // ========================================================================
    // TRANSIENT errors - extended retry window (2x max attempts)
    // ERR-007: Transient errors get extended retry window
    // ========================================================================

    describe('TRANSIENT errors', () => {
      it('should NOT dead letter TRANSIENT error at max attempts (extended window)', () => {
        const result = shouldDeadLetter(5, MAX_ATTEMPTS, 'TRANSIENT');

        expect(result.shouldDeadLetter).toBe(false);
      });

      it('should NOT dead letter TRANSIENT error between max and 2x max attempts', () => {
        const result = shouldDeadLetter(7, MAX_ATTEMPTS, 'TRANSIENT');

        expect(result.shouldDeadLetter).toBe(false);
      });

      it('should dead letter TRANSIENT error at 2x max attempts', () => {
        const result = shouldDeadLetter(10, MAX_ATTEMPTS, 'TRANSIENT');

        expect(result.shouldDeadLetter).toBe(true);
        expect(result.reason).toBe('MAX_ATTEMPTS_EXCEEDED');
      });

      it('should dead letter TRANSIENT error after 2x max attempts', () => {
        const result = shouldDeadLetter(12, MAX_ATTEMPTS, 'TRANSIENT');

        expect(result.shouldDeadLetter).toBe(true);
        expect(result.reason).toBe('MAX_ATTEMPTS_EXCEEDED');
      });
    });

    // ========================================================================
    // Null error category - absolute limit (2x max attempts)
    // ========================================================================

    describe('Null error category', () => {
      it('should NOT dead letter null category before absolute limit', () => {
        const result = shouldDeadLetter(5, MAX_ATTEMPTS, null);

        expect(result.shouldDeadLetter).toBe(false);
      });

      it('should dead letter null category at absolute limit (2x max)', () => {
        const result = shouldDeadLetter(10, MAX_ATTEMPTS, null);

        expect(result.shouldDeadLetter).toBe(true);
        expect(result.reason).toBe('MAX_ATTEMPTS_EXCEEDED');
      });
    });

    // ========================================================================
    // Edge cases
    // ========================================================================

    describe('Edge cases', () => {
      it('should handle zero max attempts (edge case)', () => {
        // Even with 0 max attempts, TRANSIENT should use 2x (still 0)
        const result = shouldDeadLetter(0, 0, 'TRANSIENT');

        expect(result.shouldDeadLetter).toBe(true);
      });

      it('should handle very large attempt counts', () => {
        const result = shouldDeadLetter(1000, MAX_ATTEMPTS, 'TRANSIENT');

        expect(result.shouldDeadLetter).toBe(true);
        expect(result.reason).toBe('MAX_ATTEMPTS_EXCEEDED');
      });

      it('should handle negative attempt count (treat as 0)', () => {
        const result = shouldDeadLetter(-1, MAX_ATTEMPTS, 'PERMANENT');

        expect(result.shouldDeadLetter).toBe(false);
      });
    });
  });

  // ==========================================================================
  // validatePayloadStructure() - Payload Validation Tests
  // API-001: Input validation
  // ==========================================================================

  describe('validatePayloadStructure() - Payload Validation', () => {
    // ========================================================================
    // Pack entity validation
    // ========================================================================

    describe('Pack entity validation', () => {
      it('should validate pack CREATE without game_id or game_code as invalid', () => {
        const result = validatePayloadStructure('pack', 'CREATE', {
          pack_id: 'pk-123',
          store_id: 'st-123',
          pack_number: '001',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('game_id or game_code');
      });

      it('should validate pack CREATE without pack_number as invalid', () => {
        const result = validatePayloadStructure('pack', 'CREATE', {
          pack_id: 'pk-123',
          store_id: 'st-123',
          game_id: 'gm-123',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('pack_number');
      });

      it('should validate pack CREATE without pack_id as invalid', () => {
        const result = validatePayloadStructure('pack', 'CREATE', {
          store_id: 'st-123',
          game_id: 'gm-123',
          pack_number: '001',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('pack_id');
      });

      it('should validate pack CREATE without store_id as invalid', () => {
        const result = validatePayloadStructure('pack', 'CREATE', {
          pack_id: 'pk-123',
          game_id: 'gm-123',
          pack_number: '001',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('store_id');
      });

      it('should validate valid pack CREATE payload', () => {
        const result = validatePayloadStructure('pack', 'CREATE', {
          pack_id: 'pk-123',
          store_id: 'st-123',
          game_id: 'gm-123',
          pack_number: '001',
        });

        expect(result.valid).toBe(true);
        expect(result.missingFields).toBeUndefined();
      });

      it('should validate pack CREATE with game_code instead of game_id as valid', () => {
        const result = validatePayloadStructure('pack', 'CREATE', {
          pack_id: 'pk-123',
          store_id: 'st-123',
          game_code: '100',
          pack_number: '001',
        });

        expect(result.valid).toBe(true);
      });

      it('should validate pack ACTIVATE without bin_id as invalid', () => {
        const result = validatePayloadStructure('pack', 'ACTIVATE', {
          pack_id: 'pk-123',
          store_id: 'st-123',
          opening_serial: '000',
          activated_at: '2024-01-01T12:00:00Z',
          received_at: '2024-01-01T10:00:00Z',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('bin_id');
      });

      it('should validate pack ACTIVATE without opening_serial as invalid', () => {
        const result = validatePayloadStructure('pack', 'ACTIVATE', {
          pack_id: 'pk-123',
          store_id: 'st-123',
          bin_id: 'bn-123',
          activated_at: '2024-01-01T12:00:00Z',
          received_at: '2024-01-01T10:00:00Z',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('opening_serial');
      });

      it('should validate pack ACTIVATE without activated_at as invalid', () => {
        const result = validatePayloadStructure('pack', 'ACTIVATE', {
          pack_id: 'pk-123',
          store_id: 'st-123',
          bin_id: 'bn-123',
          opening_serial: '000',
          received_at: '2024-01-01T10:00:00Z',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('activated_at');
      });

      it('should validate pack ACTIVATE without received_at as invalid', () => {
        const result = validatePayloadStructure('pack', 'ACTIVATE', {
          pack_id: 'pk-123',
          store_id: 'st-123',
          bin_id: 'bn-123',
          opening_serial: '000',
          activated_at: '2024-01-01T12:00:00Z',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('received_at');
      });

      it('should validate valid pack ACTIVATE payload', () => {
        const result = validatePayloadStructure('pack', 'ACTIVATE', {
          pack_id: 'pk-123',
          store_id: 'st-123',
          bin_id: 'bn-123',
          opening_serial: '000',
          activated_at: '2024-01-01T12:00:00Z',
          received_at: '2024-01-01T10:00:00Z',
        });

        expect(result.valid).toBe(true);
      });

      it('should validate pack UPDATE (ACTIVE status) same as ACTIVATE', () => {
        const result = validatePayloadStructure('pack', 'UPDATE', {
          pack_id: 'pk-123',
          store_id: 'st-123',
          status: 'ACTIVE',
          bin_id: 'bn-123',
          opening_serial: '000',
          activated_at: '2024-01-01T12:00:00Z',
          received_at: '2024-01-01T10:00:00Z',
        });

        expect(result.valid).toBe(true);
      });

      it('should validate pack UPDATE (DEPLETED) without closing_serial as invalid', () => {
        const result = validatePayloadStructure('pack', 'UPDATE', {
          pack_id: 'pk-123',
          store_id: 'st-123',
          status: 'DEPLETED',
          depleted_at: '2024-01-01T18:00:00Z',
          depletion_reason: 'SOLD_OUT',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('closing_serial');
      });

      it('should validate pack UPDATE (DEPLETED) without depleted_at as invalid', () => {
        const result = validatePayloadStructure('pack', 'UPDATE', {
          pack_id: 'pk-123',
          store_id: 'st-123',
          status: 'DEPLETED',
          closing_serial: '299',
          depletion_reason: 'SOLD_OUT',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('depleted_at');
      });

      it('should validate pack UPDATE (DEPLETED) without depletion_reason as invalid', () => {
        const result = validatePayloadStructure('pack', 'UPDATE', {
          pack_id: 'pk-123',
          store_id: 'st-123',
          status: 'DEPLETED',
          closing_serial: '299',
          depleted_at: '2024-01-01T18:00:00Z',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('depletion_reason');
      });

      it('should validate valid pack UPDATE (DEPLETED) payload', () => {
        const result = validatePayloadStructure('pack', 'UPDATE', {
          pack_id: 'pk-123',
          store_id: 'st-123',
          status: 'DEPLETED',
          closing_serial: '299',
          depleted_at: '2024-01-01T18:00:00Z',
          depletion_reason: 'SOLD_OUT',
        });

        expect(result.valid).toBe(true);
      });

      it('should validate pack UPDATE (RETURNED) without returned_at as invalid', () => {
        const result = validatePayloadStructure('pack', 'UPDATE', {
          pack_id: 'pk-123',
          store_id: 'st-123',
          status: 'RETURNED',
          return_reason: 'DAMAGED',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('returned_at');
      });

      it('should validate pack UPDATE (RETURNED) without return_reason as invalid', () => {
        const result = validatePayloadStructure('pack', 'UPDATE', {
          pack_id: 'pk-123',
          store_id: 'st-123',
          status: 'RETURNED',
          returned_at: '2024-01-01T18:00:00Z',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('return_reason');
      });

      it('should validate valid pack UPDATE (RETURNED) payload', () => {
        const result = validatePayloadStructure('pack', 'UPDATE', {
          pack_id: 'pk-123',
          store_id: 'st-123',
          status: 'RETURNED',
          returned_at: '2024-01-01T18:00:00Z',
          return_reason: 'DAMAGED',
        });

        expect(result.valid).toBe(true);
      });
    });

    // ========================================================================
    // Employee entity validation
    // ========================================================================

    describe('Employee entity validation', () => {
      it('should validate employee without employee_id as invalid', () => {
        const result = validatePayloadStructure('employee', 'CREATE', {
          store_id: 'st-123',
          first_name: 'John',
          last_name: 'Doe',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('employee_id');
      });

      it('should validate employee without store_id as invalid', () => {
        const result = validatePayloadStructure('employee', 'CREATE', {
          employee_id: 'emp-123',
          first_name: 'John',
          last_name: 'Doe',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('store_id');
      });

      it('should validate employee CREATE without first_name as invalid', () => {
        const result = validatePayloadStructure('employee', 'CREATE', {
          employee_id: 'emp-123',
          store_id: 'st-123',
          last_name: 'Doe',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('first_name');
      });

      it('should validate employee CREATE without last_name as invalid', () => {
        const result = validatePayloadStructure('employee', 'CREATE', {
          employee_id: 'emp-123',
          store_id: 'st-123',
          first_name: 'John',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('last_name');
      });

      it('should validate valid employee CREATE payload', () => {
        const result = validatePayloadStructure('employee', 'CREATE', {
          employee_id: 'emp-123',
          store_id: 'st-123',
          first_name: 'John',
          last_name: 'Doe',
        });

        expect(result.valid).toBe(true);
      });

      it('should validate employee UPDATE without CREATE-only requirements', () => {
        const result = validatePayloadStructure('employee', 'UPDATE', {
          employee_id: 'emp-123',
          store_id: 'st-123',
          // first_name and last_name not required for UPDATE
        });

        expect(result.valid).toBe(true);
      });
    });

    // ========================================================================
    // Shift entity validation
    // ========================================================================

    describe('Shift entity validation', () => {
      it('should validate shift without shift_id as invalid', () => {
        const result = validatePayloadStructure('shift', 'CREATE', {
          store_id: 'st-123',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('shift_id');
      });

      it('should validate shift without store_id as invalid', () => {
        const result = validatePayloadStructure('shift', 'CREATE', {
          shift_id: 'sh-123',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('store_id');
      });

      it('should validate valid shift payload', () => {
        const result = validatePayloadStructure('shift', 'CREATE', {
          shift_id: 'sh-123',
          store_id: 'st-123',
        });

        expect(result.valid).toBe(true);
      });
    });

    // ========================================================================
    // Unknown entity type (no validation rules)
    // ========================================================================

    describe('Unknown entity type', () => {
      it('should validate unknown entity type as valid (no rules)', () => {
        const result = validatePayloadStructure('unknown_entity', 'CREATE', {
          some_field: 'value',
        });

        expect(result.valid).toBe(true);
      });
    });
  });

  // ==========================================================================
  // Security Tests
  // API-003: Error messages sanitized before classification
  // ==========================================================================

  describe('Security Tests', () => {
    describe('Input handling', () => {
      it('should handle error message with script tags safely', () => {
        const result = classifyError(null, '<script>alert("xss")</script>');

        // Should classify without executing/parsing as HTML
        expect(result.category).toBe('UNKNOWN');
        expect(result.action).toBe('RETRY');
      });

      it('should handle error message with SQL injection attempt', () => {
        const result = classifyError(null, "'; DROP TABLE users; --");

        // Should classify without SQL execution
        expect(result.category).toBe('UNKNOWN');
        expect(result.action).toBe('RETRY');
      });

      it('should handle very long error message without overflow', () => {
        const longMessage = 'a'.repeat(10000);
        const result = classifyError(null, longMessage);

        // Should handle gracefully
        expect(result.category).toBe('UNKNOWN');
        expect(result.action).toBe('RETRY');
      });

      it('should handle null HTTP status', () => {
        const result = classifyError(null, 'Some error');

        expect(result).toBeDefined();
        expect(result.category).toBeDefined();
      });

      it('should handle undefined HTTP status', () => {
        const result = classifyError(undefined, 'Some error');

        expect(result).toBeDefined();
      });

      it('should handle null and undefined error message', () => {
        const result1 = classifyError(500, null);
        const result2 = classifyError(500, undefined);

        expect(result1.category).toBe('TRANSIENT');
        expect(result2.category).toBe('TRANSIENT');
      });

      it('should handle empty string error message', () => {
        const result = classifyError(null, '');

        expect(result.category).toBe('UNKNOWN');
      });

      it('should handle both null inputs', () => {
        const result = classifyError(null, null);

        expect(result.category).toBe('UNKNOWN');
        expect(result.action).toBe('RETRY');
      });
    });

    describe('Payload validation security', () => {
      it('should handle empty payload object', () => {
        const result = validatePayloadStructure('pack', 'CREATE', {});

        expect(result.valid).toBe(false);
        expect(result.missingFields).toBeDefined();
      });

      it('should handle payload with extra unexpected fields', () => {
        const result = validatePayloadStructure('shift', 'CREATE', {
          shift_id: 'sh-123',
          store_id: 'st-123',
          malicious_field: '<script>alert("xss")</script>',
          sql_injection: "'; DROP TABLE--",
        });

        // Extra fields should be ignored, validation should pass
        expect(result.valid).toBe(true);
      });

      it('should handle payload with null values for required fields', () => {
        const result = validatePayloadStructure('pack', 'CREATE', {
          pack_id: null,
          store_id: 'st-123',
          game_id: 'gm-123',
          pack_number: '001',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('pack_id');
      });

      it('should handle payload with undefined values', () => {
        const result = validatePayloadStructure('pack', 'CREATE', {
          pack_id: undefined,
          store_id: 'st-123',
          game_id: 'gm-123',
          pack_number: '001',
        });

        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('pack_id');
      });
    });
  });

  // ==========================================================================
  // Compliance Traceability Tests
  // Explicit verification of standard compliance
  // ==========================================================================

  describe('Compliance Verification', () => {
    describe('ERR-007: Error retry logic', () => {
      it('should implement error categorization (TRANSIENT, PERMANENT, STRUCTURAL, CONFLICT, UNKNOWN) - D4.2', () => {
        const transient = classifyError(503, 'Service unavailable');
        const permanent = classifyError(404, 'Not found');
        const structural = classifyError(null, 'missing required field');
        const conflict = classifyError(409, 'Duplicate entry');
        const unknown = classifyError(null, 'something happened');

        expect(transient.category).toBe('TRANSIENT');
        expect(conflict.category).toBe('CONFLICT');
        expect(permanent.category).toBe('PERMANENT');
        expect(structural.category).toBe('STRUCTURAL');
        expect(unknown.category).toBe('UNKNOWN');
      });

      it('should provide retry action for transient errors', () => {
        const result = classifyError(503, 'Service unavailable');

        expect(result.action).toBe('RETRY');
      });

      it('should provide extended backoff for certain errors (503, 429)', () => {
        const result503 = classifyError(503, 'Service unavailable');
        const result429 = classifyError(429, 'Rate limit');

        expect(result503.extendedBackoff).toBe(true);
        expect(result429.extendedBackoff).toBe(true);
      });
    });

    describe('MQ-002: Dead Letter Queue routing', () => {
      it('should dead letter PERMANENT errors after max attempts', () => {
        const result = shouldDeadLetter(5, 5, 'PERMANENT');

        expect(result.shouldDeadLetter).toBe(true);
      });

      it('should dead letter STRUCTURAL errors immediately', () => {
        const result = shouldDeadLetter(0, 5, 'STRUCTURAL');

        expect(result.shouldDeadLetter).toBe(true);
        expect(result.reason).toBe('STRUCTURAL_FAILURE');
      });

      it('should provide extended retry for TRANSIENT errors (2x max attempts)', () => {
        const atMax = shouldDeadLetter(5, 5, 'TRANSIENT');
        const at2xMax = shouldDeadLetter(10, 5, 'TRANSIENT');

        expect(atMax.shouldDeadLetter).toBe(false);
        expect(at2xMax.shouldDeadLetter).toBe(true);
      });

      it('should return correct dead letter reasons', () => {
        const structural = shouldDeadLetter(0, 5, 'STRUCTURAL');
        const permanent = shouldDeadLetter(5, 5, 'PERMANENT');
        const conflict = shouldDeadLetter(5, 5, 'CONFLICT');
        const maxAttempts = shouldDeadLetter(5, 5, 'UNKNOWN');

        expect(structural.reason).toBe('STRUCTURAL_FAILURE');
        expect(permanent.reason).toBe('PERMANENT_ERROR');
        expect(conflict.reason).toBe('CONFLICT_ERROR');
        expect(maxAttempts.reason).toBe('MAX_ATTEMPTS_EXCEEDED');
      });
    });

    describe('API-001: Input validation', () => {
      it('should validate required fields for pack operations', () => {
        const createResult = validatePayloadStructure('pack', 'CREATE', {});
        const activateResult = validatePayloadStructure('pack', 'ACTIVATE', {});

        expect(createResult.valid).toBe(false);
        expect(activateResult.valid).toBe(false);
      });

      it('should return list of missing fields', () => {
        const result = validatePayloadStructure('pack', 'CREATE', {
          store_id: 'st-123',
        });

        expect(result.missingFields).toBeDefined();
        expect(result.missingFields!.length).toBeGreaterThan(0);
      });
    });
  });
});
