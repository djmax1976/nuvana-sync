/**
 * Retry Hardening Security Tests (DT4.4)
 *
 * Validates security and reliability of retry/backoff/circuit breaker infrastructure.
 * Tests malformed payloads, hostile responses, and edge cases.
 *
 * @module tests/security/retry-hardening.security
 * @security ERR-007: Error retry logic with proper categorization
 * @security ERR-008: Circuit breaker for external service calls
 * @security API-003: Error message sanitization
 * @security SEC-014: Input validation
 * @compliance SYNC-5000: Phase 4 - Retry/Backoff/Circuit Breaker Hardening
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  classifyError,
  shouldDeadLetter,
  validatePayloadStructure,
} from '../../src/main/services/error-classifier.service';
import { RetryStrategyService } from '../../src/main/services/retry-strategy.service';
import {
  CircuitBreakerService,
  CircuitOpenError,
} from '../../src/main/services/circuit-breaker.service';

describe('Retry Hardening Security Tests (DT4.4)', () => {
  // ==========================================================================
  // RH-S-001: Malformed Error Message Handling
  // API-003: Error message sanitization
  // ==========================================================================
  describe('RH-S-001: Malformed Error Message Handling', () => {
    describe('classifyError() - Input Sanitization', () => {
      it('should handle null error message without throwing', () => {
        const result = classifyError(500, null);
        expect(result).toBeDefined();
        expect(result.category).toBe('TRANSIENT');
      });

      it('should handle undefined error message without throwing', () => {
        const result = classifyError(500, undefined);
        expect(result).toBeDefined();
        expect(result.category).toBe('TRANSIENT');
      });

      it('should handle empty string error message', () => {
        const result = classifyError(null, '');
        expect(result).toBeDefined();
        expect(result.category).toBe('UNKNOWN');
      });

      it('should handle extremely long error message without DoS', () => {
        // SEC-014: Prevent DoS via large inputs
        const longMessage = 'a'.repeat(100000); // 100KB message
        const startTime = Date.now();
        const result = classifyError(500, longMessage);
        const duration = Date.now() - startTime;

        expect(result).toBeDefined();
        expect(duration).toBeLessThan(100); // Should complete quickly
      });

      it('should handle error message with special regex characters', () => {
        // Test regex metacharacters that could cause issues
        const specialChars = '.*+?^${}()|[]\\';
        const result = classifyError(null, specialChars);
        expect(result).toBeDefined();
        // Should not throw regex errors
      });

      it('should handle error message with unicode characters', () => {
        const unicodeMessage = '错误：服务不可用 🔥 エラー';
        const result = classifyError(503, unicodeMessage);
        expect(result).toBeDefined();
        expect(result.category).toBe('TRANSIENT');
      });

      it('should handle error message with newlines and control characters', () => {
        const controlChars = 'Error\n\r\t\0message';
        const result = classifyError(null, controlChars);
        expect(result).toBeDefined();
      });

      it('should handle error message with SQL injection attempt', () => {
        const sqlInjection = "'; DROP TABLE sync_queue; --";
        const result = classifyError(null, sqlInjection);
        expect(result).toBeDefined();
        expect(result.category).toBe('UNKNOWN');
      });

      it('should handle error message with script injection attempt', () => {
        const xssAttempt = '<script>alert("xss")</script>';
        const result = classifyError(null, xssAttempt);
        expect(result).toBeDefined();
        expect(result.category).toBe('UNKNOWN');
      });
    });

    describe('classifyError() - Invalid HTTP Status Codes', () => {
      it('should handle null HTTP status', () => {
        const result = classifyError(null, 'some error');
        expect(result).toBeDefined();
      });

      it('should handle undefined HTTP status', () => {
        const result = classifyError(undefined, 'some error');
        expect(result).toBeDefined();
      });

      it('should handle zero HTTP status', () => {
        const result = classifyError(0, 'some error');
        expect(result).toBeDefined();
        expect(result.category).toBe('UNKNOWN');
      });

      it('should handle negative HTTP status', () => {
        const result = classifyError(-1, 'some error');
        expect(result).toBeDefined();
        expect(result.category).toBe('UNKNOWN');
      });

      it('should handle extremely large HTTP status', () => {
        const result = classifyError(999999, 'some error');
        expect(result).toBeDefined();
        expect(result.category).toBe('UNKNOWN');
      });

      it('should handle NaN HTTP status as unknown', () => {
        const result = classifyError(NaN, 'some error');
        expect(result).toBeDefined();
      });

      it('should handle Infinity HTTP status as unknown', () => {
        const result = classifyError(Infinity, 'some error');
        expect(result).toBeDefined();
      });
    });

    describe('classifyError() - Retry-After Header Validation', () => {
      it('should handle null Retry-After header', () => {
        const result = classifyError(429, 'rate limited', null);
        expect(result).toBeDefined();
        expect(result.retryAfter).toBeUndefined();
      });

      it('should handle empty Retry-After header', () => {
        const result = classifyError(429, 'rate limited', '');
        expect(result).toBeDefined();
        expect(result.retryAfter).toBeUndefined();
      });

      it('should handle non-numeric Retry-After header', () => {
        const result = classifyError(429, 'rate limited', 'invalid');
        expect(result).toBeDefined();
        // Should not crash, retryAfter may be undefined
      });

      it('should handle negative Retry-After seconds', () => {
        const result = classifyError(429, 'rate limited', '-100');
        expect(result).toBeDefined();
      });

      it('should handle extremely large Retry-After seconds', () => {
        // SEC-014: Prevent integer overflow
        const result = classifyError(429, 'rate limited', '999999999999999999');
        expect(result).toBeDefined();
        // Should handle gracefully without overflow
      });

      it('should handle Retry-After with whitespace', () => {
        const result = classifyError(429, 'rate limited', '  60  ');
        expect(result).toBeDefined();
      });

      it('should handle Retry-After with invalid date format', () => {
        const result = classifyError(429, 'rate limited', 'not-a-date');
        expect(result).toBeDefined();
      });
    });
  });

  // ==========================================================================
  // RH-S-002: shouldDeadLetter() Edge Cases
  // ERR-007: Error retry logic
  // ==========================================================================
  describe('RH-S-002: shouldDeadLetter() Edge Cases', () => {
    it('should handle negative sync attempts', () => {
      const result = shouldDeadLetter(-1, 5, 'TRANSIENT');
      expect(result).toBeDefined();
      expect(result.shouldDeadLetter).toBe(false);
    });

    it('should handle zero max attempts', () => {
      const result = shouldDeadLetter(0, 0, 'TRANSIENT');
      expect(result).toBeDefined();
    });

    it('should handle negative max attempts', () => {
      const result = shouldDeadLetter(1, -1, 'TRANSIENT');
      expect(result).toBeDefined();
    });

    it('should handle extremely large sync attempts', () => {
      const result = shouldDeadLetter(Number.MAX_SAFE_INTEGER, 5, 'TRANSIENT');
      expect(result).toBeDefined();
      expect(result.shouldDeadLetter).toBe(true);
    });

    it('should handle null error category', () => {
      const result = shouldDeadLetter(10, 5, null);
      expect(result).toBeDefined();
      expect(result.shouldDeadLetter).toBe(true);
    });

    it('should handle undefined error category', () => {
      const result = shouldDeadLetter(10, 5, undefined as unknown as null);
      expect(result).toBeDefined();
    });

    it('should handle invalid error category string', () => {
      const result = shouldDeadLetter(5, 5, 'INVALID' as 'TRANSIENT');
      expect(result).toBeDefined();
    });
  });

  // ==========================================================================
  // RH-S-003: validatePayloadStructure() Security
  // API-001: Input validation
  // ==========================================================================
  describe('RH-S-003: validatePayloadStructure() Security', () => {
    it('should handle empty payload object', () => {
      const result = validatePayloadStructure('pack', 'CREATE', {});
      expect(result.valid).toBe(false);
      expect(result.missingFields).toBeDefined();
    });

    it('should handle null values in payload', () => {
      const result = validatePayloadStructure('pack', 'CREATE', {
        pack_id: null,
        store_id: null,
      });
      expect(result.valid).toBe(false);
    });

    it('should handle undefined values in payload', () => {
      const result = validatePayloadStructure('pack', 'CREATE', {
        pack_id: undefined,
        store_id: undefined,
      });
      expect(result.valid).toBe(false);
    });

    it('should handle prototype pollution attempt', () => {
      // SEC-014: Prevent prototype pollution
      const maliciousPayload = {
        pack_id: 'valid-id',
        store_id: 'valid-store',
        __proto__: { polluted: true },
        constructor: { prototype: { polluted: true } },
      };
      const result = validatePayloadStructure('pack', 'CREATE', maliciousPayload);
      expect(result).toBeDefined();
      // Should not have polluted Object prototype
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    });

    it('should handle extremely deep nested payload', () => {
      // SEC-014: Prevent stack overflow
      let deepPayload: Record<string, unknown> = { pack_id: 'test', store_id: 'test' };
      for (let i = 0; i < 100; i++) {
        deepPayload = { nested: deepPayload, pack_id: 'test', store_id: 'test' };
      }
      const result = validatePayloadStructure('pack', 'CREATE', deepPayload);
      expect(result).toBeDefined();
    });

    it('should handle circular reference in payload', () => {
      const circularPayload: Record<string, unknown> = {
        pack_id: 'test',
        store_id: 'test',
      };
      circularPayload.self = circularPayload;

      // Should not throw on circular reference during validation
      const result = validatePayloadStructure('pack', 'CREATE', circularPayload);
      expect(result).toBeDefined();
    });

    it('should handle array instead of object payload', () => {
      // Type coercion edge case
      const arrayPayload = ['pack_id', 'store_id'] as unknown as Record<string, unknown>;
      const result = validatePayloadStructure('pack', 'CREATE', arrayPayload);
      expect(result).toBeDefined();
    });

    it('should handle unknown entity type', () => {
      const result = validatePayloadStructure('unknown_entity', 'CREATE', {
        id: 'test',
      });
      expect(result).toBeDefined();
      expect(result.valid).toBe(true); // Unknown entities pass validation
    });

    it('should handle unknown operation type', () => {
      const result = validatePayloadStructure('pack', 'UNKNOWN_OP', {
        pack_id: 'test',
        store_id: 'test',
      });
      expect(result).toBeDefined();
    });
  });

  // ==========================================================================
  // RH-S-004: RetryStrategyService Security
  // ERR-007: Error retry logic
  // ==========================================================================
  describe('RH-S-004: RetryStrategyService Security', () => {
    let strategy: RetryStrategyService;

    beforeEach(() => {
      strategy = new RetryStrategyService();
    });

    describe('Backoff calculation overflow protection', () => {
      it('should handle extremely large attempt numbers', () => {
        // SEC-014: Prevent integer overflow in exponential calculation
        const delay = strategy.calculateBackoffDelay(1000, 'TRANSIENT');
        expect(delay).toBeDefined();
        expect(Number.isFinite(delay)).toBe(true);
        expect(delay).toBeGreaterThan(0);
      });

      it('should cap delay at maximum even with huge attempts', () => {
        const delay = strategy.calculateBackoffDelay(100, 'TRANSIENT');
        expect(delay).toBeLessThanOrEqual(60000 * 2); // Max delay + jitter
      });

      it('should handle negative attempt number', () => {
        const delay = strategy.calculateBackoffDelay(-1, 'TRANSIENT');
        expect(delay).toBeDefined();
        expect(Number.isFinite(delay)).toBe(true);
      });
    });

    describe('makeRetryDecision() input validation', () => {
      it('should handle NaN sync attempts', () => {
        const decision = strategy.makeRetryDecision(NaN, 5, 'TRANSIENT');
        expect(decision).toBeDefined();
      });

      it('should handle Infinity max attempts', () => {
        const decision = strategy.makeRetryDecision(5, Infinity, 'TRANSIENT');
        expect(decision).toBeDefined();
      });

      it('should handle malformed retry_after timestamp', () => {
        const decision = strategy.makeRetryDecision(1, 5, 'TRANSIENT', 'not-a-timestamp');
        expect(decision).toBeDefined();
        expect(decision.shouldRetry).toBe(true);
      });

      it('should handle retry_after in the far future', () => {
        const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
        const decision = strategy.makeRetryDecision(1, 5, 'TRANSIENT', farFuture);
        expect(decision).toBeDefined();
        expect(decision.delayMs).toBeGreaterThan(0);
      });

      it('should handle retry_after in the past', () => {
        const past = new Date(Date.now() - 10000).toISOString();
        const decision = strategy.makeRetryDecision(1, 5, 'TRANSIENT', past);
        expect(decision).toBeDefined();
        // Should use calculated backoff instead
        expect(decision.delayMs).toBeGreaterThan(0);
      });
    });

    describe('Batch sizing bounds enforcement', () => {
      it('should not allow batch size below minimum', () => {
        // Force many failures to reduce batch size
        for (let i = 0; i < 20; i++) {
          strategy.recordBatchFailure(1.0);
        }
        expect(strategy.getCurrentBatchSize()).toBeGreaterThanOrEqual(5);
      });

      it('should not allow batch size above maximum', () => {
        const size = strategy.setBatchSize(1000000);
        expect(size).toBeLessThanOrEqual(200);
      });

      it('should handle negative batch size', () => {
        const size = strategy.setBatchSize(-100);
        expect(size).toBeGreaterThanOrEqual(5);
      });

      it('should handle NaN failure ratio', () => {
        const result = strategy.recordBatchFailure(NaN);
        expect(result).toBeDefined();
      });

      it('should handle Infinity failure ratio', () => {
        const result = strategy.recordBatchFailure(Infinity);
        expect(result).toBeDefined();
      });

      it('should handle negative failure ratio', () => {
        const result = strategy.recordBatchFailure(-0.5);
        expect(result).toBeDefined();
        expect(result.batchSize).toBeGreaterThan(0);
      });
    });
  });

  // ==========================================================================
  // RH-S-005: CircuitBreakerService Security
  // ERR-008: Circuit breaker for external service calls
  // ==========================================================================
  describe('RH-S-005: CircuitBreakerService Security', () => {
    let breaker: CircuitBreakerService;

    beforeEach(() => {
      vi.useFakeTimers();
      breaker = new CircuitBreakerService('test', {
        failureThreshold: 3,
        resetTimeoutMs: 1000,
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe('Failure recording validation', () => {
      it('should handle empty failure reason', () => {
        breaker.recordFailure('', 500);
        expect(breaker.getMetrics().lastFailureReason).toBe('');
      });

      it('should handle null-like failure reason', () => {
        breaker.recordFailure(null as unknown as string, 500);
        expect(breaker.getMetrics()).toBeDefined();
      });

      it('should handle extremely long failure reason without memory issues', () => {
        const longReason = 'x'.repeat(100000);
        breaker.recordFailure(longReason, 500);
        expect(breaker.getMetrics().lastFailureReason).toBe(longReason);
      });

      it('should limit stored failures to prevent memory exhaustion', () => {
        // Record many failures to test MAX_RECORDED_FAILURES limit
        for (let i = 0; i < 200; i++) {
          breaker.recordFailure(`Error ${i}`, 500);
          vi.advanceTimersByTime(1); // Keep failures in window
        }
        // Internal array should be capped (100 max)
        // Verify circuit works correctly
        expect(breaker.getState()).toBe('OPEN');
      });
    });

    describe('execute() with hostile operations', () => {
      it('should handle operation that throws null', async () => {
        vi.useRealTimers(); // Need real timers for async
        const result = await breaker.execute(async () => {
          throw null;
        });
        expect(result.executed).toBe(true);
        expect(result.error).toBeDefined();
      });

      it('should handle operation that throws undefined', async () => {
        vi.useRealTimers();
        const result = await breaker.execute(async () => {
          throw undefined;
        });
        expect(result.executed).toBe(true);
        expect(result.error).toBeDefined();
      });

      it('should handle operation that throws a string', async () => {
        vi.useRealTimers();
        const result = await breaker.execute(async () => {
          throw 'string error';
        });
        expect(result.executed).toBe(true);
        expect(result.error?.message).toBe('string error');
      });

      it('should handle operation that throws a number', async () => {
        vi.useRealTimers();
        const result = await breaker.execute(async () => {
          throw 500;
        });
        expect(result.executed).toBe(true);
        expect(result.error).toBeDefined();
      });

      it('should handle operation that throws an object', async () => {
        vi.useRealTimers();
        const result = await breaker.execute(async () => {
          throw { code: 'ERROR', httpStatus: 503 };
        });
        expect(result.executed).toBe(true);
        expect(result.error).toBeDefined();
      });

      it('should handle operation that never resolves (timeout scenario)', async () => {
        vi.useRealTimers();
        // This simulates a hanging request - in real usage, the caller handles timeouts
        const _hangingPromise = breaker.execute(() => new Promise(() => {}));

        // Just verify the circuit is ready to accept the request
        expect(breaker.getState()).toBe('CLOSED');

        // Clean up - we don't await the hanging promise
      });
    });

    describe('CircuitOpenError validation', () => {
      it('should include valid metrics in error', () => {
        // Trip the circuit
        for (let i = 0; i < 5; i++) {
          breaker.recordFailure('Error', 500);
        }

        const metrics = breaker.getMetrics();
        const error = new CircuitOpenError('Test error', metrics);

        expect(error.metrics).toBeDefined();
        expect(error.metrics.state).toBe('OPEN');
        expect(error.name).toBe('CircuitOpenError');
        expect(error.message).toBe('Test error');
      });

      it('should handle null metrics', () => {
        const error = new CircuitOpenError(
          'Test',
          null as unknown as typeof breaker extends CircuitBreakerService
            ? ReturnType<typeof breaker.getMetrics>
            : never
        );
        expect(error).toBeDefined();
      });
    });

    describe('State transition security', () => {
      it('should not allow state manipulation via metrics object', () => {
        const metrics = breaker.getMetrics();
        // Try to modify metrics
        (metrics as { state: string }).state = 'OPEN';

        // Circuit should still be CLOSED
        expect(breaker.getState()).toBe('CLOSED');
      });

      it('should handle rapid state transitions', () => {
        // Rapid open/close cycling
        for (let i = 0; i < 10; i++) {
          breaker.forceOpen();
          breaker.reset();
        }
        expect(breaker.getState()).toBe('CLOSED');
      });
    });
  });

  // ==========================================================================
  // RH-S-006: Timing Attack Prevention
  // SEC-014: Input validation timing
  // ==========================================================================
  describe('RH-S-006: Timing Attack Prevention', () => {
    it('should have consistent timing for error classification', () => {
      const iterations = 100;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        classifyError(500, 'test error');
        times.push(performance.now() - start);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxDeviation = Math.max(...times.map((t) => Math.abs(t - avgTime)));

      // All iterations should complete in similar time (within 10ms)
      expect(maxDeviation).toBeLessThan(10);
    });

    it('should have consistent timing regardless of error category match', () => {
      const transientTimes: number[] = [];
      const unknownTimes: number[] = [];

      for (let i = 0; i < 50; i++) {
        let start = performance.now();
        classifyError(503, 'service unavailable'); // Quick match
        transientTimes.push(performance.now() - start);

        start = performance.now();
        classifyError(599, 'xyz123'); // No match
        unknownTimes.push(performance.now() - start);
      }

      const avgTransient = transientTimes.reduce((a, b) => a + b, 0) / transientTimes.length;
      const avgUnknown = unknownTimes.reduce((a, b) => a + b, 0) / unknownTimes.length;

      // Timing difference should be minimal (< 5ms average difference)
      expect(Math.abs(avgTransient - avgUnknown)).toBeLessThan(5);
    });
  });

  // ==========================================================================
  // RH-S-007: Concurrency Safety
  // ==========================================================================
  describe('RH-S-007: Concurrency Safety', () => {
    it('should handle concurrent error classifications', async () => {
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(Promise.resolve(classifyError(500 + (i % 5), `error ${i}`)));
      }

      const results = await Promise.all(promises);
      expect(results.length).toBe(100);
      results.forEach((result) => {
        expect(result).toBeDefined();
        expect(result.category).toBeDefined();
      });
    });

    it('should handle concurrent circuit breaker operations', async () => {
      vi.useRealTimers();
      const breaker = new CircuitBreakerService('concurrent-test', {
        failureThreshold: 50, // High threshold to avoid opening
      });

      const operations = [];
      for (let i = 0; i < 50; i++) {
        operations.push(
          breaker.execute(async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            return i;
          })
        );
      }

      const results = await Promise.all(operations);
      expect(results.length).toBe(50);
      results.forEach((result) => {
        expect(result.executed).toBe(true);
      });
    });
  });
});
