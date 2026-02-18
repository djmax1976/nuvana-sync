/**
 * Circuit Breaker Service Unit Tests
 *
 * Enterprise-grade tests for circuit breaker pattern implementation.
 * Tests state transitions, failure tracking, and recovery behavior.
 *
 * Traceability:
 * - ERR-008: Circuit breaker for external service calls
 * - LM-002: Structured metrics for monitoring
 * - SYNC-5000 Phase 4 (DT4.1, DT4.2, DT4.3)
 *
 * @module tests/unit/services/circuit-breaker.service.spec
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
  CircuitBreakerService,
  CircuitOpenError,
  type CircuitState as _CircuitState,
  type CircuitBreakerConfig,
} from '../../../src/main/services/circuit-breaker.service';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a circuit breaker with test-friendly defaults
 */
function createTestBreaker(config?: Partial<CircuitBreakerConfig>): CircuitBreakerService {
  return new CircuitBreakerService('test-breaker', {
    failureThreshold: 3,
    resetTimeoutMs: 100, // Fast timeout for testing
    failureWindowMs: 1000,
    successThreshold: 2,
    ...config,
  });
}

/**
 * Simulate multiple failures to trip the circuit
 */
function tripCircuit(breaker: CircuitBreakerService, count: number = 3): void {
  for (let i = 0; i < count; i++) {
    breaker.recordFailure('Test failure', 500);
  }
}

// ============================================================================
// Circuit Breaker State Tests
// ============================================================================

describe('Circuit Breaker Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  // ==========================================================================
  // Initial State Tests
  // ==========================================================================

  describe('Initial State', () => {
    it('should start in CLOSED state', () => {
      const breaker = createTestBreaker();

      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should have zero metrics initially', () => {
      const breaker = createTestBreaker();
      const metrics = breaker.getMetrics();

      expect(metrics.failureCount).toBe(0);
      expect(metrics.successCount).toBe(0);
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.rejectedRequests).toBe(0);
      expect(metrics.openedAt).toBeNull();
    });
  });

  // ==========================================================================
  // State Transition Tests (ERR-008)
  // ==========================================================================

  describe('State Transitions (ERR-008)', () => {
    describe('CLOSED to OPEN', () => {
      it('should open circuit after failure threshold is reached', () => {
        const breaker = createTestBreaker({ failureThreshold: 3 });

        breaker.recordFailure('Error 1', 500);
        expect(breaker.getState()).toBe('CLOSED');

        breaker.recordFailure('Error 2', 503);
        expect(breaker.getState()).toBe('CLOSED');

        breaker.recordFailure('Error 3', 502);
        expect(breaker.getState()).toBe('OPEN');
      });

      it('should track openedAt timestamp when circuit opens', () => {
        const breaker = createTestBreaker({ failureThreshold: 2 });
        const now = Date.now();

        tripCircuit(breaker, 2);

        const metrics = breaker.getMetrics();
        expect(metrics.openedAt).toBe(now);
      });

      it('should only count failures with configured status codes', () => {
        const breaker = createTestBreaker({
          failureThreshold: 2,
          failureStatusCodes: new Set([500, 503]),
        });

        // These should not count (404 not in failure codes)
        breaker.recordFailure('Not found', 404);
        breaker.recordFailure('Not found', 404);
        breaker.recordFailure('Not found', 404);

        expect(breaker.getState()).toBe('CLOSED');

        // These should count
        breaker.recordFailure('Server error', 500);
        expect(breaker.getState()).toBe('CLOSED');

        breaker.recordFailure('Service unavailable', 503);
        expect(breaker.getState()).toBe('OPEN');
      });

      it('should count failures without status code', () => {
        const breaker = createTestBreaker({ failureThreshold: 2 });

        breaker.recordFailure('Network error');
        breaker.recordFailure('Connection refused');

        expect(breaker.getState()).toBe('OPEN');
      });
    });

    describe('OPEN to HALF_OPEN', () => {
      it('should transition to HALF_OPEN after reset timeout', async () => {
        const breaker = createTestBreaker({ resetTimeoutMs: 100 });
        tripCircuit(breaker);

        expect(breaker.getState()).toBe('OPEN');

        // Advance time past reset timeout
        vi.advanceTimersByTime(100);

        // Execute a request to trigger state check
        await breaker.execute(() => Promise.resolve('success'));

        expect(breaker.getState()).toBe('HALF_OPEN');
      });

      it('should reject requests while circuit is open', async () => {
        const breaker = createTestBreaker();
        tripCircuit(breaker);

        const result = await breaker.execute(() => Promise.resolve('should not run'));

        expect(result.executed).toBe(false);
        expect(result.rejectedByCircuit).toBe(true);
        expect(result.error).toBeInstanceOf(CircuitOpenError);
        expect(result.circuitState).toBe('OPEN');
      });

      it('should track rejected requests count', async () => {
        const breaker = createTestBreaker();
        tripCircuit(breaker);

        await breaker.execute(() => Promise.resolve());
        await breaker.execute(() => Promise.resolve());
        await breaker.execute(() => Promise.resolve());

        const metrics = breaker.getMetrics();
        expect(metrics.rejectedRequests).toBe(3);
      });
    });

    describe('HALF_OPEN to CLOSED', () => {
      it('should close circuit after success threshold in HALF_OPEN', async () => {
        const breaker = createTestBreaker({
          resetTimeoutMs: 100,
          successThreshold: 2,
        });
        tripCircuit(breaker);

        // Move to HALF_OPEN
        vi.advanceTimersByTime(100);

        // First success
        await breaker.execute(() => Promise.resolve('success 1'));
        expect(breaker.getState()).toBe('HALF_OPEN');

        // Second success - should close
        await breaker.execute(() => Promise.resolve('success 2'));
        expect(breaker.getState()).toBe('CLOSED');
      });

      it('should clear failure records when circuit closes', async () => {
        const breaker = createTestBreaker({
          resetTimeoutMs: 100,
          successThreshold: 1,
        });
        tripCircuit(breaker);

        vi.advanceTimersByTime(100);
        await breaker.execute(() => Promise.resolve('success'));

        const metrics = breaker.getMetrics();
        expect(metrics.failureCount).toBe(0);
      });
    });

    describe('HALF_OPEN to OPEN', () => {
      it('should reopen circuit on any failure in HALF_OPEN', async () => {
        const breaker = createTestBreaker({ resetTimeoutMs: 100 });
        tripCircuit(breaker);

        // Move to HALF_OPEN
        vi.advanceTimersByTime(100);
        await breaker.execute(() => Promise.resolve('success'));

        expect(breaker.getState()).toBe('HALF_OPEN');

        // Any failure should reopen
        await breaker.execute(() => Promise.reject(new Error('Failure!')));

        expect(breaker.getState()).toBe('OPEN');
      });

      it('should reset openedAt timestamp when reopening', async () => {
        const breaker = createTestBreaker({ resetTimeoutMs: 100 });
        tripCircuit(breaker);

        const firstOpenTime = breaker.getMetrics().openedAt;

        vi.advanceTimersByTime(100);
        await breaker.execute(() => Promise.resolve('success'));

        vi.advanceTimersByTime(50);
        await breaker.execute(() => Promise.reject(new Error('Fail')));

        const secondOpenTime = breaker.getMetrics().openedAt;
        expect(secondOpenTime).toBeGreaterThan(firstOpenTime!);
      });
    });
  });

  // ==========================================================================
  // Failure Window Tests
  // ==========================================================================

  describe('Failure Window', () => {
    it('should only count failures within the time window', () => {
      const breaker = createTestBreaker({
        failureThreshold: 3,
        failureWindowMs: 1000,
      });

      // Record 2 failures at t=0
      breaker.recordFailure('Error 1', 500);
      breaker.recordFailure('Error 2', 500);

      // Move past the ENTIRE window so first 2 failures expire
      vi.advanceTimersByTime(1100);

      // Now record 2 more failures - only these should count
      breaker.recordFailure('Error 3', 500);
      breaker.recordFailure('Error 4', 500);

      // Circuit should still be CLOSED (only 2 failures in current window, threshold is 3)
      expect(breaker.getMetrics().failureCount).toBe(2);
      expect(breaker.getState()).toBe('CLOSED');

      // One more failure should trip the circuit
      breaker.recordFailure('Error 5', 500);
      expect(breaker.getState()).toBe('OPEN');
    });

    it('should trip circuit when threshold reached within window', () => {
      const breaker = createTestBreaker({
        failureThreshold: 3,
        failureWindowMs: 1000,
      });

      breaker.recordFailure('Error 1', 500);
      vi.advanceTimersByTime(200);
      breaker.recordFailure('Error 2', 500);
      vi.advanceTimersByTime(200);
      breaker.recordFailure('Error 3', 500);

      expect(breaker.getState()).toBe('OPEN');
    });
  });

  // ==========================================================================
  // Execute Method Tests
  // ==========================================================================

  describe('execute() Method', () => {
    it('should execute operation and return result when circuit is closed', async () => {
      const breaker = createTestBreaker();
      const result = await breaker.execute(() => Promise.resolve('success'));

      expect(result.executed).toBe(true);
      expect(result.result).toBe('success');
      expect(result.rejectedByCircuit).toBe(false);
    });

    it('should increment total requests counter', async () => {
      const breaker = createTestBreaker();

      await breaker.execute(() => Promise.resolve());
      await breaker.execute(() => Promise.resolve());
      await breaker.execute(() => Promise.resolve());

      expect(breaker.getMetrics().totalRequests).toBe(3);
    });

    it('should record failure when operation throws', async () => {
      const breaker = createTestBreaker();

      const result = await breaker.execute(() => Promise.reject(new Error('Operation failed')));

      expect(result.executed).toBe(true);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Operation failed');
      expect(breaker.getMetrics().failureCount).toBe(1);
    });

    it('should extract HTTP status from error with httpStatus property', async () => {
      const breaker = createTestBreaker();

      class HttpError extends Error {
        httpStatus: number;
        constructor(message: string, status: number) {
          super(message);
          this.httpStatus = status;
        }
      }

      await breaker.execute(() => Promise.reject(new HttpError('Server error', 500)));

      expect(breaker.getMetrics().failureCount).toBe(1);
    });

    it('should extract HTTP status from error message', async () => {
      const breaker = createTestBreaker();

      await breaker.execute(() => Promise.reject(new Error('Request failed with status 503')));

      expect(breaker.getMetrics().failureCount).toBe(1);
    });
  });

  // ==========================================================================
  // Manual Control Tests
  // ==========================================================================

  describe('Manual Control', () => {
    it('should allow manual reset to CLOSED', () => {
      const breaker = createTestBreaker();
      tripCircuit(breaker);

      expect(breaker.getState()).toBe('OPEN');

      breaker.reset();

      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.getMetrics().failureCount).toBe(0);
    });

    it('should allow force open', () => {
      const breaker = createTestBreaker();

      expect(breaker.getState()).toBe('CLOSED');

      breaker.forceOpen();

      expect(breaker.getState()).toBe('OPEN');
    });
  });

  // ==========================================================================
  // Metrics Tests (LM-002)
  // ==========================================================================

  describe('Metrics (LM-002)', () => {
    it('should track last failure timestamp', () => {
      const breaker = createTestBreaker();
      const now = Date.now();

      breaker.recordFailure('Error', 500);

      const metrics = breaker.getMetrics();
      expect(metrics.lastFailureAt).toBe(now);
    });

    it('should track last failure reason', () => {
      const breaker = createTestBreaker();

      breaker.recordFailure('Network timeout', 500);

      const metrics = breaker.getMetrics();
      expect(metrics.lastFailureReason).toBe('Network timeout');
    });

    it('should track state change timestamp', () => {
      const breaker = createTestBreaker();
      const initialTime = breaker.getMetrics().lastStateChangeAt;

      vi.advanceTimersByTime(1000);
      tripCircuit(breaker);

      expect(breaker.getMetrics().lastStateChangeAt).toBeGreaterThan(initialTime);
    });

    it('should return complete metrics object', () => {
      const breaker = createTestBreaker();
      tripCircuit(breaker);

      const metrics = breaker.getMetrics();

      expect(metrics).toEqual({
        state: 'OPEN',
        failureCount: expect.any(Number),
        successCount: 0,
        openedAt: expect.any(Number),
        lastStateChangeAt: expect.any(Number),
        totalRequests: 0,
        rejectedRequests: 0,
        lastFailureAt: expect.any(Number),
        lastFailureReason: 'Test failure',
      });
    });
  });

  // ==========================================================================
  // isFailureStatus Tests
  // ==========================================================================

  describe('isFailureStatus()', () => {
    it('should return true for configured failure status codes', () => {
      const breaker = createTestBreaker({
        failureStatusCodes: new Set([500, 502, 503, 504, 429]),
      });

      expect(breaker.isFailureStatus(500)).toBe(true);
      expect(breaker.isFailureStatus(502)).toBe(true);
      expect(breaker.isFailureStatus(503)).toBe(true);
      expect(breaker.isFailureStatus(504)).toBe(true);
      expect(breaker.isFailureStatus(429)).toBe(true);
    });

    it('should return false for non-failure status codes', () => {
      const breaker = createTestBreaker({
        failureStatusCodes: new Set([500, 502, 503, 504, 429]),
      });

      expect(breaker.isFailureStatus(200)).toBe(false);
      expect(breaker.isFailureStatus(400)).toBe(false);
      expect(breaker.isFailureStatus(404)).toBe(false);
      expect(breaker.isFailureStatus(422)).toBe(false);
    });
  });

  // ==========================================================================
  // CircuitOpenError Tests
  // ==========================================================================

  describe('CircuitOpenError', () => {
    it('should include circuit metrics', async () => {
      const breaker = createTestBreaker();
      tripCircuit(breaker);

      const result = await breaker.execute(() => Promise.resolve());

      expect(result.error).toBeInstanceOf(CircuitOpenError);
      const error = result.error as CircuitOpenError;
      expect(error.metrics).toBeDefined();
      expect(error.metrics.state).toBe('OPEN');
    });

    it('should have descriptive message', async () => {
      const breaker = new CircuitBreakerService('my-service');
      tripCircuit(breaker, 5);

      const result = await breaker.execute(() => Promise.resolve());

      expect(result.error?.message).toContain('my-service');
      expect(result.error?.message).toContain('OPEN');
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle rapid failure recording', () => {
      const breaker = createTestBreaker({ failureThreshold: 100 });

      for (let i = 0; i < 100; i++) {
        breaker.recordFailure(`Error ${i}`, 500);
      }

      expect(breaker.getState()).toBe('OPEN');
    });

    it('should handle success recording in CLOSED state', () => {
      const breaker = createTestBreaker();

      // Success in CLOSED state should not change anything
      breaker.recordSuccess();
      breaker.recordSuccess();

      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should handle non-Error throws', async () => {
      const breaker = createTestBreaker();

      const result = await breaker.execute(() => Promise.reject('string error'));

      expect(result.executed).toBe(true);
      expect(result.error?.message).toBe('string error');
    });

    it('should limit recorded failures to prevent memory issues', () => {
      const breaker = createTestBreaker({
        failureThreshold: 1000,
        failureWindowMs: 60000,
      });

      // Record many failures
      for (let i = 0; i < 200; i++) {
        breaker.recordFailure(`Error ${i}`, 500);
      }

      // Should not have memory issues - failures are trimmed
      const metrics = breaker.getMetrics();
      expect(metrics.failureCount).toBeLessThanOrEqual(100);
    });
  });

  // ==========================================================================
  // Integration with 429/503 Responses (DT4.2)
  // ==========================================================================

  describe('Integration with Rate Limit Responses (DT4.2)', () => {
    it('should trip circuit on repeated 429 responses', () => {
      const breaker = createTestBreaker({ failureThreshold: 3 });

      breaker.recordFailure('Rate limited', 429);
      breaker.recordFailure('Rate limited', 429);
      expect(breaker.getState()).toBe('CLOSED');

      breaker.recordFailure('Rate limited', 429);
      expect(breaker.getState()).toBe('OPEN');
    });

    it('should trip circuit on repeated 503 responses', () => {
      const breaker = createTestBreaker({ failureThreshold: 3 });

      breaker.recordFailure('Service unavailable', 503);
      breaker.recordFailure('Service unavailable', 503);
      expect(breaker.getState()).toBe('CLOSED');

      breaker.recordFailure('Service unavailable', 503);
      expect(breaker.getState()).toBe('OPEN');
    });

    it('should trip circuit on mixed 429/503 responses', () => {
      const breaker = createTestBreaker({ failureThreshold: 3 });

      breaker.recordFailure('Rate limited', 429);
      breaker.recordFailure('Service unavailable', 503);
      breaker.recordFailure('Rate limited', 429);

      expect(breaker.getState()).toBe('OPEN');
    });
  });

  // ==========================================================================
  // Recovery Path Tests (DT4.3)
  // ==========================================================================

  describe('Half-Open Recovery Path (DT4.3)', () => {
    it('should allow test requests in HALF_OPEN state', async () => {
      const breaker = createTestBreaker({ resetTimeoutMs: 100 });
      tripCircuit(breaker);

      vi.advanceTimersByTime(100);

      const result = await breaker.execute(() => Promise.resolve('test'));

      expect(result.executed).toBe(true);
      expect(result.result).toBe('test');
    });

    it('should resume normal throughput after recovery', async () => {
      const breaker = createTestBreaker({
        resetTimeoutMs: 100,
        successThreshold: 2,
      });
      tripCircuit(breaker);

      // Move to HALF_OPEN
      vi.advanceTimersByTime(100);

      // Two successes to close
      await breaker.execute(() => Promise.resolve('success 1'));
      await breaker.execute(() => Promise.resolve('success 2'));

      expect(breaker.getState()).toBe('CLOSED');

      // Should handle normal traffic now
      for (let i = 0; i < 10; i++) {
        const result = await breaker.execute(() => Promise.resolve(`request ${i}`));
        expect(result.executed).toBe(true);
        expect(result.rejectedByCircuit).toBe(false);
      }
    });

    it('should track success count in HALF_OPEN state', async () => {
      const breaker = createTestBreaker({
        resetTimeoutMs: 100,
        successThreshold: 3,
      });
      tripCircuit(breaker);

      vi.advanceTimersByTime(100);

      await breaker.execute(() => Promise.resolve('s1'));
      expect(breaker.getMetrics().successCount).toBe(1);

      await breaker.execute(() => Promise.resolve('s2'));
      expect(breaker.getMetrics().successCount).toBe(2);

      await breaker.execute(() => Promise.resolve('s3'));
      expect(breaker.getState()).toBe('CLOSED');
    });
  });
});
