/**
 * Retry Strategy Service Unit Tests
 *
 * Tests for jittered exponential backoff and dynamic batch sizing.
 *
 * Traceability:
 * - ERR-007: Error retry logic with proper categorization
 * - API-002: Rate limiting via backoff
 * - SYNC-5000 Phase 4 (D4.3)
 *
 * @module tests/unit/services/retry-strategy.service.spec
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import {
  RetryStrategyService,
  type RetryConfig as _RetryConfig,
  type BatchSizeConfig as _BatchSizeConfig,
} from '../../../src/main/services/retry-strategy.service';

// ============================================================================
// Test Setup
// ============================================================================

describe('Retry Strategy Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ==========================================================================
  // Jittered Exponential Backoff Tests (D4.3)
  // ==========================================================================

  describe('Jittered Exponential Backoff (D4.3)', () => {
    describe('calculateBackoffDelay()', () => {
      it('should calculate exponential base delay', () => {
        const strategy = new RetryStrategyService({ jitterFactor: 0 });

        // With no jitter, should be exactly exponential
        const delay0 = strategy.calculateBackoffDelay(0);
        const delay1 = strategy.calculateBackoffDelay(1);
        const delay2 = strategy.calculateBackoffDelay(2);

        expect(delay0).toBe(1000); // 1000 * 2^0 = 1000
        expect(delay1).toBe(2000); // 1000 * 2^1 = 2000
        expect(delay2).toBe(4000); // 1000 * 2^2 = 4000
      });

      it('should cap delay at maxDelayMs', () => {
        const strategy = new RetryStrategyService({
          jitterFactor: 0,
          maxDelayMs: 10000,
        });

        const delay10 = strategy.calculateBackoffDelay(10);

        expect(delay10).toBe(10000); // Capped at max
      });

      it('should apply jitter to spread retries', () => {
        const strategy = new RetryStrategyService({ jitterFactor: 0.3 });
        const delays: number[] = [];

        // Run multiple times to get variance
        for (let i = 0; i < 100; i++) {
          delays.push(strategy.calculateBackoffDelay(2));
        }

        // Should have variance due to jitter
        const min = Math.min(...delays);
        const max = Math.max(...delays);
        expect(max - min).toBeGreaterThan(0);

        // All should be within ±30% of base (4000ms)
        const base = 4000;
        const lowerBound = base * 0.7;
        const upperBound = base * 1.3;
        expect(Math.min(...delays)).toBeGreaterThanOrEqual(lowerBound);
        expect(Math.max(...delays)).toBeLessThanOrEqual(upperBound);
      });

      it('should apply extended backoff for UNKNOWN errors', () => {
        const strategy = new RetryStrategyService({ jitterFactor: 0 });

        const normalDelay = strategy.calculateBackoffDelay(2, 'TRANSIENT');
        const unknownDelay = strategy.calculateBackoffDelay(2, 'UNKNOWN');

        // UNKNOWN should be 1.5x the normal delay
        expect(unknownDelay).toBe(normalDelay * 1.5);
      });

      it('should handle null error category as normal', () => {
        const strategy = new RetryStrategyService({ jitterFactor: 0 });

        const normalDelay = strategy.calculateBackoffDelay(2, null);
        const transientDelay = strategy.calculateBackoffDelay(2, 'TRANSIENT');

        expect(normalDelay).toBe(transientDelay);
      });
    });

    describe('calculateRetryAfter()', () => {
      it('should return ISO 8601 timestamp', () => {
        const strategy = new RetryStrategyService({ jitterFactor: 0 });
        const now = Date.now();
        vi.setSystemTime(now);

        const retryAfter = strategy.calculateRetryAfter(2);

        expect(retryAfter).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
        expect(new Date(retryAfter).getTime()).toBeGreaterThan(now);
      });

      it('should return timestamp based on backoff delay', () => {
        const strategy = new RetryStrategyService({
          jitterFactor: 0,
          baseDelayMs: 1000,
        });
        const now = Date.now();
        vi.setSystemTime(now);

        const retryAfter = strategy.calculateRetryAfter(2);
        const expectedTime = now + 4000; // 1000 * 2^2

        expect(new Date(retryAfter).getTime()).toBe(expectedTime);

        vi.useRealTimers();
      });
    });
  });

  // ==========================================================================
  // Retry Decision Tests
  // ==========================================================================

  describe('makeRetryDecision()', () => {
    describe('STRUCTURAL errors', () => {
      it('should never retry STRUCTURAL errors', () => {
        const strategy = new RetryStrategyService();
        const decision = strategy.makeRetryDecision(0, 5, 'STRUCTURAL');

        expect(decision.shouldRetry).toBe(false);
        expect(decision.shouldDeadLetter).toBe(true);
        expect(decision.deadLetterReason).toBe('STRUCTURAL_FAILURE');
      });

      it('should dead letter STRUCTURAL even at attempt 0', () => {
        const strategy = new RetryStrategyService();
        const decision = strategy.makeRetryDecision(0, 5, 'STRUCTURAL');

        expect(decision.shouldDeadLetter).toBe(true);
      });
    });

    describe('PERMANENT errors', () => {
      it('should retry PERMANENT errors before max attempts', () => {
        const strategy = new RetryStrategyService();
        const decision = strategy.makeRetryDecision(2, 5, 'PERMANENT');

        expect(decision.shouldRetry).toBe(true);
        expect(decision.shouldDeadLetter).toBe(false);
      });

      it('should dead letter PERMANENT errors at max attempts', () => {
        const strategy = new RetryStrategyService();
        const decision = strategy.makeRetryDecision(5, 5, 'PERMANENT');

        expect(decision.shouldRetry).toBe(false);
        expect(decision.shouldDeadLetter).toBe(true);
        expect(decision.deadLetterReason).toBe('PERMANENT_ERROR');
      });
    });

    describe('CONFLICT errors', () => {
      it('should retry CONFLICT errors before max attempts', () => {
        const strategy = new RetryStrategyService();
        const decision = strategy.makeRetryDecision(2, 5, 'CONFLICT');

        expect(decision.shouldRetry).toBe(true);
        expect(decision.shouldDeadLetter).toBe(false);
      });

      it('should dead letter CONFLICT errors at max attempts', () => {
        const strategy = new RetryStrategyService();
        const decision = strategy.makeRetryDecision(5, 5, 'CONFLICT');

        expect(decision.shouldRetry).toBe(false);
        expect(decision.shouldDeadLetter).toBe(true);
        expect(decision.deadLetterReason).toBe('CONFLICT_ERROR');
      });
    });

    describe('TRANSIENT errors', () => {
      it('should retry TRANSIENT errors with extended window', () => {
        const strategy = new RetryStrategyService();
        const decision = strategy.makeRetryDecision(5, 5, 'TRANSIENT');

        // At max attempts, TRANSIENT should still retry (extended window)
        expect(decision.shouldRetry).toBe(true);
        expect(decision.shouldDeadLetter).toBe(false);
      });

      it('should dead letter TRANSIENT at 2x max attempts', () => {
        const strategy = new RetryStrategyService();
        const decision = strategy.makeRetryDecision(10, 5, 'TRANSIENT');

        expect(decision.shouldRetry).toBe(false);
        expect(decision.shouldDeadLetter).toBe(true);
        expect(decision.deadLetterReason).toBe('MAX_ATTEMPTS_EXCEEDED');
      });
    });

    describe('UNKNOWN errors', () => {
      it('should retry UNKNOWN errors before max attempts', () => {
        const strategy = new RetryStrategyService();
        const decision = strategy.makeRetryDecision(2, 5, 'UNKNOWN');

        expect(decision.shouldRetry).toBe(true);
      });

      it('should dead letter UNKNOWN at max attempts', () => {
        const strategy = new RetryStrategyService();
        const decision = strategy.makeRetryDecision(5, 5, 'UNKNOWN');

        expect(decision.shouldRetry).toBe(false);
        expect(decision.shouldDeadLetter).toBe(true);
        expect(decision.deadLetterReason).toBe('MAX_ATTEMPTS_EXCEEDED');
      });
    });

    describe('Retry-After handling', () => {
      it('should use server-specified retry_after when valid', () => {
        const strategy = new RetryStrategyService({ jitterFactor: 0 });
        const futureTime = new Date(Date.now() + 60000).toISOString();

        const decision = strategy.makeRetryDecision(2, 5, 'TRANSIENT', futureTime);

        expect(decision.shouldRetry).toBe(true);
        expect(decision.delayMs).toBeGreaterThan(50000); // ~60s
        expect(decision.reason).toContain('Server-specified');
      });

      it('should use calculated backoff when retry_after has passed', () => {
        const strategy = new RetryStrategyService({ jitterFactor: 0 });
        const pastTime = new Date(Date.now() - 10000).toISOString();

        const decision = strategy.makeRetryDecision(2, 5, 'TRANSIENT', pastTime);

        expect(decision.shouldRetry).toBe(true);
        expect(decision.delayMs).toBe(4000); // Calculated backoff
        expect(decision.reason).toContain('Retry-After passed');
      });
    });
  });

  // ==========================================================================
  // isReadyForRetry Tests
  // ==========================================================================

  describe('isReadyForRetry()', () => {
    it('should return true for first attempt', () => {
      const strategy = new RetryStrategyService();

      expect(strategy.isReadyForRetry(null, 0, null, null)).toBe(true);
    });

    it('should respect retry_after timestamp', () => {
      const strategy = new RetryStrategyService();
      const lastAttempt = new Date().toISOString();
      const futureRetry = new Date(Date.now() + 60000).toISOString();

      expect(strategy.isReadyForRetry(lastAttempt, 1, 'TRANSIENT', futureRetry)).toBe(false);
    });

    it('should allow retry when retry_after has passed', () => {
      const strategy = new RetryStrategyService();
      const lastAttempt = new Date(Date.now() - 10000).toISOString();
      const pastRetry = new Date(Date.now() - 5000).toISOString();

      expect(strategy.isReadyForRetry(lastAttempt, 1, 'TRANSIENT', pastRetry)).toBe(true);
    });

    it('should check backoff timing when no retry_after', () => {
      const strategy = new RetryStrategyService({
        baseDelayMs: 1000,
        jitterFactor: 0,
      });

      // Last attempt 500ms ago, backoff should be 2000ms (2^1)
      const lastAttempt = new Date(Date.now() - 500).toISOString();
      expect(strategy.isReadyForRetry(lastAttempt, 1, 'TRANSIENT', null)).toBe(false);

      // Last attempt 3000ms ago
      const oldAttempt = new Date(Date.now() - 3000).toISOString();
      expect(strategy.isReadyForRetry(oldAttempt, 1, 'TRANSIENT', null)).toBe(true);
    });
  });

  // ==========================================================================
  // Dynamic Batch Sizing Tests (D4.3)
  // ==========================================================================

  describe('Dynamic Batch Sizing (D4.3)', () => {
    describe('recordBatchSuccess()', () => {
      it('should track consecutive successes', () => {
        const strategy = new RetryStrategyService();

        strategy.recordBatchSuccess();
        strategy.recordBatchSuccess();

        expect(strategy.getStats().consecutiveSuccesses).toBe(2);
      });

      it('should reset consecutive failures on success', () => {
        const strategy = new RetryStrategyService();

        strategy.recordBatchFailure(1);
        strategy.recordBatchSuccess();

        expect(strategy.getStats().consecutiveFailures).toBe(0);
      });

      it('should increase batch size after recovery threshold', () => {
        const strategy = new RetryStrategyService(
          {},
          {
            defaultBatchSize: 50,
            recoveryThreshold: 3,
            recoveryFactor: 1.2,
          }
        );

        // Reduce batch size first
        strategy.recordBatchFailure(1);
        const reducedSize = strategy.getCurrentBatchSize();

        // Recover with successes
        for (let i = 0; i < 3; i++) {
          strategy.recordBatchSuccess();
        }

        expect(strategy.getCurrentBatchSize()).toBeGreaterThan(reducedSize);
      });

      it('should not exceed default batch size during recovery', () => {
        const strategy = new RetryStrategyService(
          {},
          {
            defaultBatchSize: 50,
            recoveryThreshold: 3,
          }
        );

        // Many successes
        for (let i = 0; i < 10; i++) {
          strategy.recordBatchSuccess();
        }

        expect(strategy.getCurrentBatchSize()).toBeLessThanOrEqual(50);
      });
    });

    describe('recordBatchFailure()', () => {
      it('should reduce batch size on failure', () => {
        const strategy = new RetryStrategyService(
          {},
          {
            defaultBatchSize: 50,
            reductionFactor: 0.5,
          }
        );

        // Use failureRatio 0.7 (>= 0.5 threshold, but <= 0.8 severe threshold)
        // This applies the base reductionFactor (0.5), so 50 * 0.5 = 25
        const result = strategy.recordBatchFailure(0.7);

        expect(result.wasAdjusted).toBe(true);
        expect(result.direction).toBe('reduced');
        expect(strategy.getCurrentBatchSize()).toBe(25);
      });

      it('should not reduce below minimum batch size', () => {
        const strategy = new RetryStrategyService(
          {},
          {
            defaultBatchSize: 50,
            minBatchSize: 5,
            reductionFactor: 0.5,
          }
        );

        // Multiple failures
        for (let i = 0; i < 10; i++) {
          strategy.recordBatchFailure(1);
        }

        expect(strategy.getCurrentBatchSize()).toBe(5);
      });

      it('should reduce more aggressively for high failure ratio', () => {
        const strategy = new RetryStrategyService(
          {},
          {
            defaultBatchSize: 100,
            reductionFactor: 0.5,
          }
        );

        // 90% failure should reduce more
        strategy.recordBatchFailure(0.9);

        expect(strategy.getCurrentBatchSize()).toBeLessThan(50);
      });

      it('should not reduce for low failure ratio', () => {
        const strategy = new RetryStrategyService(
          {},
          {
            defaultBatchSize: 50,
          }
        );

        // Low failure ratio, first failure
        const result = strategy.recordBatchFailure(0.1);

        expect(result.wasAdjusted).toBe(false);
        expect(result.direction).toBe('unchanged');
      });

      it('should reset consecutive successes on failure', () => {
        const strategy = new RetryStrategyService();

        strategy.recordBatchSuccess();
        strategy.recordBatchSuccess();
        strategy.recordBatchFailure(1);

        expect(strategy.getStats().consecutiveSuccesses).toBe(0);
      });
    });

    describe('resetBatchSize()', () => {
      it('should reset to default batch size', () => {
        const strategy = new RetryStrategyService(
          {},
          {
            defaultBatchSize: 50,
          }
        );

        strategy.recordBatchFailure(1);
        strategy.recordBatchFailure(1);

        strategy.resetBatchSize();

        expect(strategy.getCurrentBatchSize()).toBe(50);
      });

      it('should reset consecutive counters', () => {
        const strategy = new RetryStrategyService();

        strategy.recordBatchFailure(1);
        strategy.recordBatchSuccess();

        strategy.resetBatchSize();

        const stats = strategy.getStats();
        expect(stats.consecutiveSuccesses).toBe(0);
        expect(stats.consecutiveFailures).toBe(0);
      });
    });

    describe('setBatchSize()', () => {
      it('should set batch size within bounds', () => {
        const strategy = new RetryStrategyService(
          {},
          {
            minBatchSize: 5,
            maxBatchSize: 200,
          }
        );

        expect(strategy.setBatchSize(100)).toBe(100);
        expect(strategy.getCurrentBatchSize()).toBe(100);
      });

      it('should clamp to minimum', () => {
        const strategy = new RetryStrategyService(
          {},
          {
            minBatchSize: 5,
          }
        );

        expect(strategy.setBatchSize(1)).toBe(5);
      });

      it('should clamp to maximum', () => {
        const strategy = new RetryStrategyService(
          {},
          {
            maxBatchSize: 200,
          }
        );

        expect(strategy.setBatchSize(500)).toBe(200);
      });
    });
  });

  // ==========================================================================
  // Statistics Tests
  // ==========================================================================

  describe('getStats()', () => {
    it('should return complete statistics', () => {
      const strategy = new RetryStrategyService();
      const stats = strategy.getStats();

      expect(stats).toHaveProperty('currentBatchSize');
      expect(stats).toHaveProperty('consecutiveSuccesses');
      expect(stats).toHaveProperty('consecutiveFailures');
      expect(stats).toHaveProperty('config');
      expect(stats.config).toHaveProperty('retry');
      expect(stats.config).toHaveProperty('batch');
    });

    it('should reflect current state', () => {
      const strategy = new RetryStrategyService();

      strategy.recordBatchSuccess();
      strategy.recordBatchSuccess();

      const stats = strategy.getStats();
      expect(stats.consecutiveSuccesses).toBe(2);
      expect(stats.consecutiveFailures).toBe(0);
    });
  });

  // ==========================================================================
  // Configuration Tests
  // ==========================================================================

  describe('Configuration', () => {
    it('should use custom retry config', () => {
      const strategy = new RetryStrategyService({
        baseDelayMs: 500,
        maxDelayMs: 5000,
        jitterFactor: 0,
        multiplier: 3,
      });

      const delay = strategy.calculateBackoffDelay(2);
      expect(delay).toBe(4500); // 500 * 3^2 = 4500
    });

    it('should use custom batch config', () => {
      const strategy = new RetryStrategyService(
        {},
        {
          defaultBatchSize: 100,
        }
      );

      expect(strategy.getCurrentBatchSize()).toBe(100);
    });

    it('should merge partial configs with defaults', () => {
      const strategy = new RetryStrategyService({ baseDelayMs: 500 }, { minBatchSize: 10 });

      const stats = strategy.getStats();
      expect(stats.config.retry.baseDelayMs).toBe(500);
      expect(stats.config.retry.maxDelayMs).toBe(60000); // default
      expect(stats.config.batch.minBatchSize).toBe(10);
      expect(stats.config.batch.defaultBatchSize).toBe(50); // default
    });
  });
});
