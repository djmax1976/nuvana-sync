/**
 * Dead Letter Queue Workflow Integration Tests
 *
 * End-to-end tests for the complete DLQ workflow:
 * Error Classification Service -> Sync Queue DAL -> DLQ operations
 *
 * These tests validate that error classification decisions correctly drive
 * DLQ routing and that the entire workflow maintains data integrity.
 *
 * Traceability:
 * - MQ-002: Dead Letter Queue workflow
 * - ERR-007: Error classification driving routing
 * - API-003: Error message handling through the pipeline
 *
 * @module tests/integration/dlq-workflow
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// ============================================================================
// Test Database Setup
// ============================================================================

// Use vi.hoisted() to ensure the database holder is available when vi.mock runs
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
const { dbHolder } = vi.hoisted(() => ({
  dbHolder: { instance: null as Database.Database | null },
}));

// Mock the database service to use our test database via the hoisted holder
vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: () => {
    if (!dbHolder.instance) {
      throw new Error('Database not initialized - test setup issue');
    }
    return dbHolder.instance;
  },
  isDatabaseInitialized: () => dbHolder.instance !== null,
}));

vi.mock('../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('uuid', () => ({
  v4: () => `workflow-uuid-${Date.now()}-${Math.random().toString(36).substring(7)}`,
}));

let db: Database.Database;

import { SyncQueueDAL, type SyncQueueItem } from '../../src/main/dal/sync-queue.dal';
import {
  classifyError,
  shouldDeadLetter,
  validatePayloadStructure,
} from '../../src/main/services/error-classifier.service';

// ============================================================================
// Database Schema
// ============================================================================

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    synced INTEGER DEFAULT 0,
    sync_attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 5,
    last_sync_error TEXT,
    last_attempt_at TEXT,
    created_at TEXT NOT NULL,
    synced_at TEXT,
    sync_direction TEXT DEFAULT 'PUSH',
    api_endpoint TEXT,
    http_status INTEGER,
    response_body TEXT,
    -- v046 DLQ fields
    dead_lettered INTEGER DEFAULT 0,
    dead_letter_reason TEXT,
    dead_lettered_at TEXT,
    error_category TEXT,
    retry_after TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sync_queue_store_synced ON sync_queue(store_id, synced);
  CREATE INDEX IF NOT EXISTS idx_sync_queue_dead_letter ON sync_queue(store_id, dead_lettered);
`;

// ============================================================================
// Helper Functions
// ============================================================================

interface TestItemOptions {
  store_id?: string;
  entity_type?: string;
  entity_id?: string;
  operation?: 'CREATE' | 'UPDATE' | 'DELETE' | 'ACTIVATE';
  payload?: object;
  max_attempts?: number;
}

function createTestItem(dal: SyncQueueDAL, options: TestItemOptions = {}): SyncQueueItem {
  const item = dal.enqueue({
    store_id: options.store_id || 'store-workflow-test',
    entity_type: options.entity_type || 'pack',
    entity_id: options.entity_id || `pack-${Date.now()}`,
    operation: options.operation || 'CREATE',
    payload: options.payload || {
      pack_id: 'pk-123',
      store_id: options.store_id || 'store-workflow-test',
      pack_number: '001',
      game_code: '100',
      game_id: 'gm-123',
      status: 'RECEIVED',
    },
  });

  // Override max_attempts if specified
  if (options.max_attempts !== undefined) {
    db.prepare('UPDATE sync_queue SET max_attempts = ? WHERE id = ?').run(
      options.max_attempts,
      item.id
    );
  }

  return item;
}

function simulateSyncAttempt(
  dal: SyncQueueDAL,
  itemId: string,
  httpStatus: number | null,
  errorMessage: string,
  apiEndpoint: string = '/api/v1/sync/lottery/packs'
): void {
  const apiContext =
    httpStatus !== null
      ? {
          api_endpoint: apiEndpoint,
          http_status: httpStatus,
          response_body: JSON.stringify({ error: errorMessage }),
        }
      : undefined;
  dal.incrementAttempts(itemId, errorMessage, apiContext);
}

// ============================================================================
// Tests
// ============================================================================

describe('DLQ Workflow Integration Tests', () => {
  let dal: SyncQueueDAL;
  const DEFAULT_MAX_ATTEMPTS = 5;

  beforeEach(() => {
    db = new Database(':memory:');
    dbHolder.instance = db;
    db.exec(SCHEMA);
    dal = new SyncQueueDAL();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    dbHolder.instance = null;
  });

  // ==========================================================================
  // Workflow 1: Permanent HTTP Error → Dead Letter After Max Attempts
  // ==========================================================================

  describe('Workflow: Permanent HTTP Error (400) → DLQ', () => {
    it('should classify 400 response and dead letter after max attempts', () => {
      const item = createTestItem(dal);
      const storeId = item.store_id;

      // Simulate sync attempts with 400 error
      for (let attempt = 1; attempt <= DEFAULT_MAX_ATTEMPTS; attempt++) {
        simulateSyncAttempt(dal, item.id, 400, 'Bad Request: Invalid pack_number');

        // Classify the error
        const classification = classifyError(400, 'Bad Request: Invalid pack_number');
        expect(classification.category).toBe('PERMANENT');
        expect(classification.action).toBe('DEAD_LETTER');

        // Update error category in DAL
        dal.updateErrorCategory(item.id, classification.category);

        // Check if should dead letter
        const currentItem = dal['findById'](item.id);
        const dlqDecision = shouldDeadLetter(
          currentItem!.sync_attempts,
          currentItem!.max_attempts,
          classification.category
        );

        if (dlqDecision.shouldDeadLetter) {
          // Move to DLQ
          dal.deadLetter({
            id: item.id,
            reason: dlqDecision.reason!,
            errorCategory: classification.category,
            error: 'Bad Request: Invalid pack_number',
          });
        }
      }

      // Verify item is in DLQ
      const dlqItems = dal.getDeadLetterItems(storeId);
      expect(dlqItems.items.some((i) => i.id === item.id)).toBe(true);
      expect(dlqItems.items[0].dead_letter_reason).toBe('PERMANENT_ERROR');
      expect(dlqItems.items[0].error_category).toBe('PERMANENT');
    });
  });

  // ==========================================================================
  // Workflow 2: Structural Error → Immediate Dead Letter
  // ==========================================================================

  describe('Workflow: Structural Error → Immediate DLQ', () => {
    it('should classify structural error and dead letter immediately', () => {
      // Create item with invalid payload (missing game_id)
      const item = createTestItem(dal, {
        payload: {
          pack_id: 'pk-123',
          store_id: 'store-workflow-test',
          pack_number: '001',
          // Missing game_id and game_code
        },
      });

      // First, validate payload structure
      const payloadValidation = validatePayloadStructure('pack', 'CREATE', {
        pack_id: 'pk-123',
        store_id: 'store-workflow-test',
        pack_number: '001',
      });

      expect(payloadValidation.valid).toBe(false);
      expect(payloadValidation.missingFields).toContain('game_id or game_code');

      // Classify as structural error
      const classification = classifyError(null, 'missing required field: game_id');
      expect(classification.category).toBe('STRUCTURAL');
      expect(classification.action).toBe('DEAD_LETTER');

      // Check DLQ decision - should be immediate
      const dlqDecision = shouldDeadLetter(0, DEFAULT_MAX_ATTEMPTS, 'STRUCTURAL');
      expect(dlqDecision.shouldDeadLetter).toBe(true);
      expect(dlqDecision.reason).toBe('STRUCTURAL_FAILURE');

      // Move to DLQ immediately
      dal.deadLetter({
        id: item.id,
        reason: dlqDecision.reason!,
        errorCategory: 'STRUCTURAL',
        error: 'missing required field: game_id',
      });

      // Verify item is in DLQ with 0 sync attempts
      const dlqItems = dal.getDeadLetterItems(item.store_id);
      const dlqItem = dlqItems.items.find((i) => i.id === item.id);
      expect(dlqItem).toBeDefined();
      expect(dlqItem!.dead_letter_reason).toBe('STRUCTURAL_FAILURE');
      expect(dlqItem!.sync_attempts).toBe(0);
    });

    it('should detect missing required fields for ACTIVATE operation', () => {
      const payloadValidation = validatePayloadStructure('pack', 'ACTIVATE', {
        pack_id: 'pk-123',
        store_id: 'store-123',
        // Missing: bin_id, opening_serial, activated_at, received_at
      });

      expect(payloadValidation.valid).toBe(false);
      expect(payloadValidation.missingFields).toContain('bin_id');
      expect(payloadValidation.missingFields).toContain('opening_serial');
    });
  });

  // ==========================================================================
  // Workflow 3: Transient Error → Extended Retry → Eventually Dead Letter
  // ==========================================================================

  describe('Workflow: Transient Error (503) → Extended Retry → DLQ', () => {
    it('should classify 503 as transient and allow extended retries', () => {
      const item = createTestItem(dal, { max_attempts: 5 });
      const storeId = item.store_id;

      // Simulate 5 attempts (normal max) - should NOT dead letter yet
      for (let attempt = 1; attempt <= 5; attempt++) {
        simulateSyncAttempt(dal, item.id, 503, 'Service Unavailable');

        const classification = classifyError(503, 'Service Unavailable');
        expect(classification.category).toBe('TRANSIENT');
        expect(classification.action).toBe('RETRY');

        dal.updateErrorCategory(item.id, classification.category);

        const currentItem = dal['findById'](item.id);
        const dlqDecision = shouldDeadLetter(
          currentItem!.sync_attempts,
          currentItem!.max_attempts,
          classification.category
        );

        // Should NOT dead letter at max_attempts for TRANSIENT
        expect(dlqDecision.shouldDeadLetter).toBe(false);
      }

      // Verify still in active queue
      let dlqCount = dal.getDeadLetterCount(storeId);
      expect(dlqCount).toBe(0);

      // Continue to 2x max attempts (10 total)
      for (let attempt = 6; attempt <= 10; attempt++) {
        simulateSyncAttempt(dal, item.id, 503, 'Service Unavailable');

        const currentItem = dal['findById'](item.id);
        const dlqDecision = shouldDeadLetter(
          currentItem!.sync_attempts,
          currentItem!.max_attempts,
          'TRANSIENT'
        );

        if (dlqDecision.shouldDeadLetter) {
          dal.deadLetter({
            id: item.id,
            reason: dlqDecision.reason!,
            errorCategory: 'TRANSIENT',
            error: 'Service Unavailable - exceeded extended retry window',
          });
          break;
        }
      }

      // Now should be in DLQ
      dlqCount = dal.getDeadLetterCount(storeId);
      expect(dlqCount).toBe(1);

      const dlqItems = dal.getDeadLetterItems(storeId);
      expect(dlqItems.items[0].dead_letter_reason).toBe('MAX_ATTEMPTS_EXCEEDED');
    });
  });

  // ==========================================================================
  // Workflow 4: Rate Limit (429) → Retry-After Handling
  // ==========================================================================

  describe('Workflow: Rate Limit (429) → Retry-After', () => {
    it('should parse Retry-After header and set retry_after timestamp', () => {
      const item = createTestItem(dal);

      // Simulate 429 with Retry-After header
      const classification = classifyError(429, 'Rate limit exceeded', '60');

      expect(classification.category).toBe('TRANSIENT');
      expect(classification.action).toBe('RETRY');
      expect(classification.extendedBackoff).toBe(true);
      expect(classification.retryAfter).toBeDefined();

      // Set retry_after in DAL
      dal.setRetryAfter(item.id, classification.retryAfter!);

      // Verify retry_after is set
      const updatedItem = dal['findById'](item.id);
      expect(updatedItem?.retry_after).toBe(classification.retryAfter);
    });
  });

  // ==========================================================================
  // Workflow 5: DLQ Restore and Retry
  // ==========================================================================

  describe('Workflow: DLQ Restore → Successful Retry', () => {
    it('should restore item from DLQ with clean state for retry', () => {
      const item = createTestItem(dal);
      const storeId = item.store_id;

      // Simulate failure and dead letter
      simulateSyncAttempt(dal, item.id, 400, 'Validation error');
      dal.updateErrorCategory(item.id, 'PERMANENT');
      dal.deadLetter({
        id: item.id,
        reason: 'PERMANENT_ERROR',
        errorCategory: 'PERMANENT',
        error: 'Validation error',
      });

      // Verify in DLQ
      expect(dal.getDeadLetterCount(storeId)).toBe(1);

      // Restore from DLQ
      const restored = dal.restoreFromDeadLetter(item.id);
      expect(restored).toBe(true);

      // Verify item is back in active queue with clean state
      const restoredItem = dal['findById'](item.id);
      expect(restoredItem?.dead_lettered).toBe(0);
      expect(restoredItem?.dead_letter_reason).toBeNull();
      expect(restoredItem?.dead_lettered_at).toBeNull();
      expect(restoredItem?.sync_attempts).toBe(0);
      expect(restoredItem?.last_sync_error).toBeNull();
      expect(restoredItem?.error_category).toBeNull();
      expect(restoredItem?.retry_after).toBeNull();

      // DLQ should be empty
      expect(dal.getDeadLetterCount(storeId)).toBe(0);
    });
  });

  // ==========================================================================
  // Workflow 6: Unknown Error → Extended Backoff → DLQ
  // ==========================================================================

  describe('Workflow: Unknown Error → Extended Backoff → DLQ', () => {
    it('should classify unknown error and dead letter after max attempts', () => {
      const item = createTestItem(dal, { max_attempts: 5 });

      // Simulate unknown error
      const classification = classifyError(null, 'Something unexpected happened');
      expect(classification.category).toBe('UNKNOWN');
      expect(classification.action).toBe('RETRY');
      expect(classification.extendedBackoff).toBe(true);

      // Simulate max attempts
      for (let attempt = 1; attempt <= 5; attempt++) {
        simulateSyncAttempt(dal, item.id, null, 'Something unexpected happened');
        dal.updateErrorCategory(item.id, 'UNKNOWN');
      }

      // Check DLQ decision at max attempts for UNKNOWN
      const currentItem = dal['findById'](item.id);
      const dlqDecision = shouldDeadLetter(
        currentItem!.sync_attempts,
        currentItem!.max_attempts,
        'UNKNOWN'
      );

      expect(dlqDecision.shouldDeadLetter).toBe(true);
      expect(dlqDecision.reason).toBe('MAX_ATTEMPTS_EXCEEDED');

      // Move to DLQ
      dal.deadLetter({
        id: item.id,
        reason: dlqDecision.reason!,
        errorCategory: 'UNKNOWN',
        error: 'Something unexpected happened',
      });

      // Verify in DLQ
      const dlqItems = dal.getDeadLetterItems(item.store_id);
      expect(dlqItems.items[0].dead_letter_reason).toBe('MAX_ATTEMPTS_EXCEEDED');
    });
  });

  // ==========================================================================
  // Workflow 7: Error Message Pattern Takes Priority
  // ==========================================================================

  describe('Workflow: Error Pattern Priority Over HTTP Status', () => {
    it('should classify structural error even with 500 status', () => {
      const item = createTestItem(dal);

      // 500 status but structural error message
      const classification = classifyError(500, 'missing required field: game_code');

      // Structural pattern should take priority
      expect(classification.category).toBe('STRUCTURAL');
      expect(classification.action).toBe('DEAD_LETTER');

      // Should dead letter immediately
      const dlqDecision = shouldDeadLetter(0, DEFAULT_MAX_ATTEMPTS, 'STRUCTURAL');
      expect(dlqDecision.shouldDeadLetter).toBe(true);
    });
  });

  // ==========================================================================
  // Workflow 8: Full Pack Lifecycle with DLQ
  // ==========================================================================

  describe('Workflow: Full Pack Lifecycle with DLQ Recovery', () => {
    it('should handle pack through CREATE failure → DLQ → restore → success', () => {
      const storeId = 'store-pack-lifecycle';

      // 1. Create pack sync item
      const packPayload = {
        pack_id: 'pk-lifecycle-test',
        store_id: storeId,
        game_id: 'gm-100',
        game_code: '100',
        pack_number: '001',
        status: 'RECEIVED',
        received_at: '2024-01-01T10:00:00Z',
      };

      const item = createTestItem(dal, {
        store_id: storeId,
        entity_id: 'pk-lifecycle-test',
        payload: packPayload,
      });

      // 2. First attempt fails with validation error
      simulateSyncAttempt(dal, item.id, 400, 'Validation failed: pack_number format');
      const classification = classifyError(400, 'Validation failed: pack_number format');
      dal.updateErrorCategory(item.id, classification.category);

      // 3. Continue attempts until max
      for (let i = 2; i <= DEFAULT_MAX_ATTEMPTS; i++) {
        simulateSyncAttempt(dal, item.id, 400, 'Validation failed');
      }

      // 4. Dead letter after max attempts
      const dlqDecision = shouldDeadLetter(DEFAULT_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 'PERMANENT');
      expect(dlqDecision.shouldDeadLetter).toBe(true);

      dal.deadLetter({
        id: item.id,
        reason: dlqDecision.reason!,
        errorCategory: 'PERMANENT',
        error: 'Validation failed: pack_number format',
      });

      // 5. Verify in DLQ with correct summary
      const dlqItems = dal.getDeadLetterItems(storeId);
      const dlqItem = dlqItems.items[0];
      expect(dlqItem.summary?.pack_number).toBe('001');
      expect(dlqItem.summary?.game_code).toBe('100');

      // 6. Admin investigates and fixes issue, then restores
      dal.restoreFromDeadLetter(item.id);

      // 7. Verify clean state
      const restoredItem = dal['findById'](item.id);
      expect(restoredItem?.sync_attempts).toBe(0);
      expect(restoredItem?.dead_lettered).toBe(0);

      // 8. Simulate successful sync
      dal.markSynced(item.id, {
        api_endpoint: '/api/v1/sync/lottery/packs',
        http_status: 201,
        response_body: '{"success":true}',
      });

      // 9. Verify item is synced
      const syncedItem = dal['findById'](item.id);
      expect(syncedItem?.synced).toBe(1);
      expect(syncedItem?.synced_at).toBeDefined();
    });
  });

  // ==========================================================================
  // Workflow 9: DLQ Stats Accuracy During Workflow
  // ==========================================================================

  describe('Workflow: DLQ Stats Accuracy', () => {
    it('should maintain accurate stats through add/restore/delete operations', () => {
      const storeId = 'store-stats-workflow';

      // Create items with different failure reasons
      const items = [
        { reason: 'PERMANENT_ERROR' as const, category: 'PERMANENT' as const, entityType: 'pack' },
        {
          reason: 'STRUCTURAL_FAILURE' as const,
          category: 'STRUCTURAL' as const,
          entityType: 'pack',
        },
        {
          reason: 'MAX_ATTEMPTS_EXCEEDED' as const,
          category: 'UNKNOWN' as const,
          entityType: 'bin',
        },
        { reason: 'MANUAL' as const, category: 'UNKNOWN' as const, entityType: 'pack' },
      ];

      const createdItems = items.map((cfg, i) => {
        const item = createTestItem(dal, {
          store_id: storeId,
          entity_id: `stats-item-${i}`,
          entity_type: cfg.entityType,
        });
        dal.deadLetter({
          id: item.id,
          reason: cfg.reason,
          errorCategory: cfg.category,
        });
        return { ...item, config: cfg };
      });

      // Verify initial stats
      let stats = dal.getDeadLetterStats(storeId);
      expect(stats.total).toBe(4);
      expect(stats.byReason.PERMANENT_ERROR).toBe(1);
      expect(stats.byReason.STRUCTURAL_FAILURE).toBe(1);
      expect(stats.byReason.MAX_ATTEMPTS_EXCEEDED).toBe(1);
      expect(stats.byReason.MANUAL).toBe(1);
      expect(stats.byEntityType.pack).toBe(3);
      expect(stats.byEntityType.bin).toBe(1);

      // Restore one item
      dal.restoreFromDeadLetter(createdItems[0].id);

      stats = dal.getDeadLetterStats(storeId);
      expect(stats.total).toBe(3);
      expect(stats.byReason.PERMANENT_ERROR).toBe(0);

      // Delete one item
      dal.deleteDeadLetterItem(createdItems[1].id);

      stats = dal.getDeadLetterStats(storeId);
      expect(stats.total).toBe(2);
      expect(stats.byReason.STRUCTURAL_FAILURE).toBe(0);

      // Verify remaining items
      const dlqItems = dal.getDeadLetterItems(storeId);
      expect(dlqItems.items.length).toBe(2);
    });
  });

  // ==========================================================================
  // Workflow 10: Network Error Recovery
  // ==========================================================================

  describe('Workflow: Network Error → Recovery → Success', () => {
    it('should handle network error retry without dead-lettering on recovery', () => {
      const item = createTestItem(dal);

      // Simulate network errors
      for (let i = 1; i <= 3; i++) {
        simulateSyncAttempt(dal, item.id, null, 'ECONNREFUSED');

        const classification = classifyError(null, 'ECONNREFUSED');
        expect(classification.category).toBe('TRANSIENT');
        dal.updateErrorCategory(item.id, classification.category);

        const currentItem = dal['findById'](item.id);
        const dlqDecision = shouldDeadLetter(
          currentItem!.sync_attempts,
          currentItem!.max_attempts,
          'TRANSIENT'
        );

        // Should not dead letter yet (transient gets extended window)
        expect(dlqDecision.shouldDeadLetter).toBe(false);
      }

      // Network recovers - mark as synced
      dal.markSynced(item.id, {
        api_endpoint: '/api/v1/sync/lottery/packs',
        http_status: 201,
      });

      // Verify successful sync despite earlier failures
      const syncedItem = dal['findById'](item.id);
      expect(syncedItem?.synced).toBe(1);
      expect(syncedItem?.sync_attempts).toBe(3); // Attempts preserved for audit
    });
  });
});
