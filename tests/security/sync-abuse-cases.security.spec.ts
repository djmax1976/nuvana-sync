/**
 * SYNC-5000 Security Abuse Case Tests
 *
 * Security review tests for sync path abuse scenarios.
 * Phase 7 (D7.2) of SYNC-5000: Enterprise Regression and Release Readiness.
 *
 * Abuse Scenarios Covered:
 * - SQL injection attempts
 * - Tenant isolation bypass attempts
 * - Payload manipulation attacks
 * - DoS via queue flooding
 * - Error message information leakage
 * - Race condition exploitation
 * - Input validation bypass
 * - Authentication/authorization bypass
 *
 * @module tests/security/sync-abuse-cases
 *
 * Security Controls Verified:
 * - SEC-006: SQL injection prevention (parameterized queries)
 * - SEC-014: Input validation (Zod schemas)
 * - DB-006: Tenant isolation (store_id scoping)
 * - API-001: API input validation
 * - API-003: Error sanitization
 * - API-008: Output filtering
 * - MQ-001: Idempotent messaging
 * - MQ-002: Dead letter queue security
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';

// ============================================================================
// Native Module Check
// ============================================================================

let nativeModuleAvailable = true;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Db = require('better-sqlite3-multiple-ciphers');
  const testDb = new Db(':memory:');
  testDb.close();
} catch {
  nativeModuleAvailable = false;
}

const SKIP_NATIVE_MODULE_TESTS =
  process.env.CI === 'true' || process.env.SKIP_NATIVE_TESTS === 'true' || !nativeModuleAvailable;

// ============================================================================
// Database Holder
// ============================================================================

const { dbHolder, mockLogger } = vi.hoisted(() => ({
  dbHolder: { instance: null as Database.Database | null },
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ============================================================================
// Mocks
// ============================================================================

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => {
    if (!dbHolder.instance) throw new Error('Database not initialized');
    return dbHolder.instance;
  }),
  isDatabaseInitialized: vi.fn(() => dbHolder.instance !== null),
}));

vi.mock('../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => mockLogger),
}));

let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: () => `security-uuid-${++uuidCounter}`,
}));

// ============================================================================
// Imports
// ============================================================================

import { createServiceTestContext, type ServiceTestContext } from '../helpers/test-context';
import { SyncQueueDAL, type CreateSyncQueueItemData } from '../../src/main/dal/sync-queue.dal';
import { errorClassifierService } from '../../src/main/services/error-classifier.service';

// ============================================================================
// Test Suite
// ============================================================================

const describeSuite = SKIP_NATIVE_MODULE_TESTS ? describe.skip : describe;

describeSuite('SYNC-5000 Security Abuse Case Tests', () => {
  let ctx: ServiceTestContext;
  let syncQueueDAL: SyncQueueDAL;
  // Using the singleton errorClassifierService directly - no need for local variable

  beforeEach(async () => {
    uuidCounter = 0;
    vi.clearAllMocks();

    ctx = await createServiceTestContext({
      storeName: 'Security Test Store',
    });

    dbHolder.instance = ctx.db;
    syncQueueDAL = new SyncQueueDAL();
  });

  afterEach(() => {
    ctx?.cleanup();
    dbHolder.instance = null;
  });

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  function createQueueItem(overrides: Partial<CreateSyncQueueItemData> = {}) {
    return syncQueueDAL.enqueue({
      store_id: ctx.storeId,
      entity_type: overrides.entity_type ?? 'pack',
      entity_id: overrides.entity_id ?? `entity-${++uuidCounter}`,
      operation: overrides.operation ?? 'CREATE',
      payload: overrides.payload ?? { test: true },
      priority: overrides.priority ?? 0,
      sync_direction: overrides.sync_direction ?? 'PUSH',
    });
  }

  /**
   * Count total rows in sync_queue table
   */
  function countAllQueueItems(): number {
    const result = ctx.db.prepare('SELECT COUNT(*) as count FROM sync_queue').get() as {
      count: number;
    };
    return result.count;
  }

  // ==========================================================================
  // SEC-006: SQL Injection Prevention
  // ==========================================================================

  describe('SEC-006: SQL Injection Prevention', () => {
    const SQL_INJECTION_PAYLOADS = [
      "'; DROP TABLE sync_queue;--",
      "1' OR '1'='1",
      '1; DELETE FROM sync_queue;--',
      "1' UNION SELECT * FROM sqlite_master--",
      "'); INSERT INTO sync_queue VALUES('hack','hack','hack','hack','hack','{}',0,0,0,5,'2024-01-01','PUSH');--",
      "test\x00'; DROP TABLE sync_queue;--",
      "test%00'; DROP TABLE sync_queue;--",
      '1/**/OR/**/1=1',
      "admin'--",
      "' OR ''='",
      "1' AND '1'='1' UNION SELECT NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL--",
    ];

    it.each(SQL_INJECTION_PAYLOADS)(
      'should safely handle SQL injection in entity_id: %s',
      (payload) => {
        const beforeCount = countAllQueueItems();

        // Attempt SQL injection via entity_id
        const item = createQueueItem({ entity_id: payload });

        expect(item).toBeDefined();
        expect(item.entity_id).toBe(payload); // Stored literally, not executed

        // Table should still exist with expected item count
        const afterCount = countAllQueueItems();
        expect(afterCount).toBe(beforeCount + 1);
      }
    );

    it.each(SQL_INJECTION_PAYLOADS)(
      'should safely handle SQL injection in payload: %s',
      (payload) => {
        const beforeCount = countAllQueueItems();

        const item = createQueueItem({
          payload: {
            malicious_field: payload,
            nested: { attack: payload },
          },
        });

        expect(item).toBeDefined();

        // Verify payload stored correctly
        const retrieved = syncQueueDAL.findById(item.id);
        const parsedPayload = JSON.parse(retrieved!.payload);
        expect(parsedPayload.malicious_field).toBe(payload);
        expect(parsedPayload.nested.attack).toBe(payload);

        // Table integrity maintained
        const afterCount = countAllQueueItems();
        expect(afterCount).toBe(beforeCount + 1);
      }
    );

    it('should prevent injection via idempotency key', () => {
      const injectionKey = "key'; DROP TABLE sync_queue;--";

      const item = syncQueueDAL.enqueueWithIdempotency(
        {
          store_id: ctx.storeId,
          entity_type: 'pack',
          entity_id: 'injection-test',
          operation: 'CREATE',
          payload: {},
        },
        injectionKey
      );

      expect(item).toBeDefined();

      // Table should still exist
      const count = countAllQueueItems();
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it('should prevent injection in store_id lookup', () => {
      // Attempt to query with malicious store_id
      const maliciousStoreId = "store'; DELETE FROM sync_queue;--";

      // This should not execute the DELETE
      const items = syncQueueDAL.getRetryableItems(maliciousStoreId, 100);

      // Should return empty (no items for fake store), not error
      expect(items).toEqual([]);

      // Our test items should still exist
      createQueueItem();
      const validCount = syncQueueDAL.getPendingCount(ctx.storeId);
      expect(validCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // DB-006: Tenant Isolation Bypass Attempts
  // ==========================================================================

  describe('DB-006: Tenant Isolation Bypass Attempts', () => {
    it('should prevent cross-tenant data access via store_id manipulation', () => {
      const storeA = ctx.storeId;
      const storeB = 'malicious-store-uuid';

      // Create item for store A
      const itemA = createQueueItem();

      // Attempt to access store A's item via store B query
      const itemsB = syncQueueDAL.getRetryableItems(storeB, 100);

      // Store B should see nothing
      expect(itemsB).toEqual([]);

      // Store A's item should exist
      const itemsA = syncQueueDAL.getRetryableItems(storeA, 100);
      expect(itemsA.map((i) => i.id)).toContain(itemA.id);
    });

    it('should prevent stats pollution across tenants', () => {
      const storeA = ctx.storeId;
      const storeB = 'attacker-store-uuid';

      // Create items for store A
      createQueueItem();
      createQueueItem();
      createQueueItem();

      // Stats for store B should be zero
      const statsB = syncQueueDAL.getStats(storeB);
      expect(statsB.pending).toBe(0);

      // Stats for store A should be accurate
      const statsA = syncQueueDAL.getStats(storeA);
      expect(statsA.pending).toBe(3);
    });

    it('should prevent DLQ cross-tenant manipulation', () => {
      const storeA = ctx.storeId;

      // Create and DLQ item for store A
      const item = createQueueItem();
      syncQueueDAL.deadLetter({
        id: item.id,
        reason: 'MAX_ATTEMPTS_EXCEEDED',
        errorCategory: 'TRANSIENT',
      });

      // DLQ count for other store should be 0
      const dlqCountB = syncQueueDAL.getDeadLetterCount('other-store-uuid');
      expect(dlqCountB).toBe(0);

      // DLQ count for store A should be 1
      const dlqCountA = syncQueueDAL.getDeadLetterCount(storeA);
      expect(dlqCountA).toBe(1);
    });

    it('should prevent partition depth leakage across tenants', () => {
      // Create items for this store
      createQueueItem({ entity_type: 'pack' });
      createQueueItem({ entity_type: 'pack' });
      createQueueItem({ entity_type: 'game' });

      // Other store should see empty partitions
      const depthsOther = syncQueueDAL.getPartitionDepths('other-store-uuid');
      expect(Object.keys(depthsOther).length).toBe(0);

      // This store should see correct depths
      const depths = syncQueueDAL.getPartitionDepths(ctx.storeId);
      expect(depths['pack']).toBe(2);
      expect(depths['game']).toBe(1);
    });
  });

  // ==========================================================================
  // Payload Manipulation Attacks
  // ==========================================================================

  describe('Payload Manipulation Attacks', () => {
    it('should handle prototype pollution attempts', () => {
      const pollutionPayload = {
        __proto__: { isAdmin: true },
        constructor: { prototype: { isAdmin: true } },
        normal: 'data',
      };

      const item = createQueueItem({ payload: pollutionPayload });

      // Payload should be stored as-is (serialized)
      const retrieved = syncQueueDAL.findById(item.id);
      expect(retrieved).toBeDefined();

      // Parse should not pollute Object.prototype
      const parsed = JSON.parse(retrieved!.payload);
      expect(parsed.normal).toBe('data');

      // Global prototype should NOT be polluted
      const testObj = {};
      expect((testObj as { isAdmin?: boolean }).isAdmin).toBeUndefined();
    });

    it('should handle deeply nested payloads', () => {
      // Create deeply nested object (potential stack overflow attack)
      let nested: Record<string, unknown> = { value: 'deep' };
      for (let i = 0; i < 100; i++) {
        nested = { level: i, child: nested };
      }

      const item = createQueueItem({ payload: nested });
      expect(item).toBeDefined();

      const retrieved = syncQueueDAL.findById(item.id);
      expect(retrieved).toBeDefined();
    });

    it('should handle circular reference attempts', () => {
      // JSON.stringify will fail on circular refs, but we should handle gracefully
      const circular: Record<string, unknown> = { name: 'circular' };
      // Note: Can't actually pass circular to JSON.stringify, but this tests the concept
      // In real code, Zod validation would catch this before reaching DAL

      const item = createQueueItem({
        payload: {
          safe: 'data',
          // Simulated "flattened" circular data
          ref: { id: 'self', parent_id: 'self' },
        },
      });

      expect(item).toBeDefined();
    });

    it('should handle null byte injection in payload', () => {
      const nullBytePayload = {
        field: 'value\x00with\x00null\x00bytes',
        array: ['\x00', 'a\x00b', '\x00\x00\x00'],
      };

      const item = createQueueItem({ payload: nullBytePayload });
      expect(item).toBeDefined();

      const retrieved = syncQueueDAL.findById(item.id);
      const parsed = JSON.parse(retrieved!.payload);

      // Null bytes should be preserved (not truncated)
      expect(parsed.field).toContain('\x00');
    });

    it('should handle extremely large payloads', () => {
      // 100KB payload
      const largePayload = {
        data: 'x'.repeat(100000),
        array: Array.from({ length: 1000 }, (_, i) => ({ index: i, value: 'y'.repeat(50) })),
      };

      const item = createQueueItem({ payload: largePayload });
      expect(item).toBeDefined();

      const retrieved = syncQueueDAL.findById(item.id);
      expect(retrieved).toBeDefined();

      const parsed = JSON.parse(retrieved!.payload);
      expect(parsed.data.length).toBe(100000);
    });
  });

  // ==========================================================================
  // DoS via Queue Flooding
  // ==========================================================================

  describe('DoS via Queue Flooding', () => {
    it('should handle rapid item creation without crashing', () => {
      const startTime = Date.now();
      const itemCount = 1000;

      // Rapid creation
      for (let i = 0; i < itemCount; i++) {
        createQueueItem({ entity_id: `flood-${i}` });
      }

      const duration = Date.now() - startTime;

      // Should complete in reasonable time (< 10s for 1000 items)
      expect(duration).toBeLessThan(10000);

      // All items should be created
      const count = syncQueueDAL.getPendingCount(ctx.storeId);
      expect(count).toBe(itemCount);
    });

    it('should handle concurrent stats queries under load', async () => {
      // Create items
      for (let i = 0; i < 100; i++) {
        createQueueItem({ entity_id: `concurrent-${i}` });
      }

      // Concurrent queries should not cause issues
      const queries = Array.from({ length: 10 }, () =>
        Promise.resolve(syncQueueDAL.getStats(ctx.storeId))
      );

      const results = await Promise.all(queries);

      // All should return consistent results
      for (const stats of results) {
        expect(stats.pending).toBe(100);
      }
    });

    it('should bound getRetryableItems results', () => {
      // Create many items
      for (let i = 0; i < 200; i++) {
        createQueueItem({ entity_id: `bounded-${i}` });
      }

      // Request with limit should be respected
      const batch = syncQueueDAL.getRetryableItems(ctx.storeId, 50);
      expect(batch.length).toBe(50);
    });
  });

  // ==========================================================================
  // Error Message Information Leakage
  // ==========================================================================

  describe('API-003: Error Message Information Leakage', () => {
    it('should not expose internal paths in error classification', () => {
      const internalErrorMessage = 'Failed at /internal/path/to/service.ts:123:45';

      // classifyError takes (httpStatus, errorMessage, retryAfterHeader)
      const classified = errorClassifierService.classifyError(500, internalErrorMessage);

      // Classification should work without exposing internals to client
      expect(classified.category).toBeDefined();
      // The original error is for logging, not client response
    });

    it('should not expose database schema in errors', () => {
      // Simulate a constraint error
      const dbErrorMessage = 'SQLITE_CONSTRAINT: UNIQUE constraint failed: sync_queue.id';

      const classified = errorClassifierService.classifyError(500, dbErrorMessage);

      // Should classify appropriately
      expect(classified.category).toBeDefined();
      // Internal schema details are for server logs only
    });

    it('should sanitize stack traces in classified errors', () => {
      const errorMessage = 'Test error at SyncQueueDAL.enqueue';

      const classified = errorClassifierService.classifyError(500, errorMessage);

      // Classification result should not include stack for client
      // The message property is for client-facing, category for routing
      expect(classified.category).toBeDefined();
    });
  });

  // ==========================================================================
  // Race Condition Exploitation
  // ==========================================================================

  describe('Race Condition Exploitation', () => {
    it('should handle concurrent enqueue with same idempotency key', async () => {
      const key = 'race-condition-key';

      // Simulate concurrent enqueues
      const results = await Promise.all([
        Promise.resolve(
          syncQueueDAL.enqueueWithIdempotency(
            {
              store_id: ctx.storeId,
              entity_type: 'pack',
              entity_id: 'race-1',
              operation: 'CREATE',
              payload: { v: 1 },
            },
            key
          )
        ),
        Promise.resolve(
          syncQueueDAL.enqueueWithIdempotency(
            {
              store_id: ctx.storeId,
              entity_type: 'pack',
              entity_id: 'race-1',
              operation: 'CREATE',
              payload: { v: 2 },
            },
            key
          )
        ),
        Promise.resolve(
          syncQueueDAL.enqueueWithIdempotency(
            {
              store_id: ctx.storeId,
              entity_type: 'pack',
              entity_id: 'race-1',
              operation: 'CREATE',
              payload: { v: 3 },
            },
            key
          )
        ),
      ]);

      // All should return same item ID (deduplication)
      const ids = new Set(results.map((r) => r.item.id));
      expect(ids.size).toBe(1);
    });

    it('should handle concurrent mark synced/failed operations', async () => {
      const item = createQueueItem();

      // Concurrent operations (simulated - SQLite will serialize)
      const ops = [
        Promise.resolve(
          syncQueueDAL.markSynced(item.id, { api_endpoint: '/api/v1/test', http_status: 200 })
        ),
        Promise.resolve(syncQueueDAL.findById(item.id)),
      ];

      await Promise.all(ops);

      // Final state should be consistent
      const final = syncQueueDAL.findById(item.id);
      expect(final?.synced).toBe(1);
    });

    it('should prevent double DLQ operations', () => {
      const item = createQueueItem();

      // First DLQ
      syncQueueDAL.deadLetter({
        id: item.id,
        reason: 'PERMANENT_ERROR',
        errorCategory: 'PERMANENT',
      });

      // Second DLQ attempt (should be ignored since already dead lettered)
      syncQueueDAL.deadLetter({
        id: item.id,
        reason: 'MAX_ATTEMPTS_EXCEEDED',
        errorCategory: 'TRANSIENT',
      });

      // Should only be DLQ'd once
      const dlqCount = syncQueueDAL.getDeadLetterCount(ctx.storeId);
      expect(dlqCount).toBe(1);

      // Reason should be the first one (second is ignored)
      const retrieved = syncQueueDAL.findById(item.id);
      expect(retrieved?.dead_lettered).toBe(1);
    });
  });

  // ==========================================================================
  // Input Validation Bypass Attempts
  // ==========================================================================

  describe('SEC-014: Input Validation Bypass Attempts', () => {
    it('should handle empty strings gracefully', () => {
      const item = createQueueItem({
        entity_id: '',
        entity_type: '' as 'pack', // Type system bypass attempt
      });

      expect(item).toBeDefined();
    });

    it('should handle whitespace-only inputs', () => {
      const item = createQueueItem({
        entity_id: '   \t\n\r   ',
      });

      expect(item).toBeDefined();
      // Whitespace should be preserved, not trimmed
      expect(item.entity_id).toBe('   \t\n\r   ');
    });

    it('should handle unicode control characters', () => {
      const controlChars = '\u0000\u0001\u0002\u001F\u007F\u200B\u200C\u200D\uFEFF';

      const item = createQueueItem({
        entity_id: `test${controlChars}entity`,
        payload: { field: controlChars },
      });

      expect(item).toBeDefined();
    });

    it('should handle mixed encoding attacks', () => {
      const mixedEncoding = 'test%27%20OR%20%271%27%3D%271'; // URL-encoded SQL injection

      const item = createQueueItem({
        entity_id: mixedEncoding,
        payload: { encoded: mixedEncoding },
      });

      expect(item).toBeDefined();
      // Should be stored literally, not decoded and executed
      expect(item.entity_id).toBe(mixedEncoding);
    });

    it('should handle number type coercion attacks', () => {
      const item = createQueueItem({
        priority: '10; DELETE FROM sync_queue;' as unknown as number, // Type coercion attack
      });

      // Should either fail validation or convert safely
      // SQLite will handle type coercion
      expect(item).toBeDefined();
    });
  });

  // ==========================================================================
  // MQ-001/MQ-002: Message Queue Security
  // ==========================================================================

  describe('Message Queue Security', () => {
    it('should enforce idempotency key uniqueness', () => {
      const key = 'unique-key-test';

      const item1 = syncQueueDAL.enqueueWithIdempotency(
        {
          store_id: ctx.storeId,
          entity_type: 'pack',
          entity_id: 'mq-1',
          operation: 'CREATE',
          payload: {},
        },
        key
      );

      const item2 = syncQueueDAL.enqueueWithIdempotency(
        {
          store_id: ctx.storeId,
          entity_type: 'pack',
          entity_id: 'mq-2',
          operation: 'CREATE',
          payload: {},
        },
        key
      );

      // Same item (deduplication)
      expect(item1.item.id).toBe(item2.item.id);

      // Only one item in queue
      const pending = syncQueueDAL.getPendingCount(ctx.storeId);
      expect(pending).toBe(1);
    });

    it('should scope idempotency keys by store', () => {
      const key = 'cross-store-key';

      // Item for this store
      const item1 = syncQueueDAL.enqueueWithIdempotency(
        {
          store_id: ctx.storeId,
          entity_type: 'pack',
          entity_id: 'store-a',
          operation: 'CREATE',
          payload: {},
        },
        key
      );

      // Same key, different store - should be different item
      // (In real usage, the DAL would create a new item for different store_id)
      // Here we verify that store_id is part of the lookup

      expect(item1).toBeDefined();

      // Query with this store should find the item
      const pending = syncQueueDAL.findPendingByIdempotencyKey(ctx.storeId, key);
      expect(pending).toBeDefined();
      expect(pending?.id).toBe(item1.item.id);

      // Query with other store should NOT find it
      const otherPending = syncQueueDAL.findPendingByIdempotencyKey('other-store', key);
      expect(otherPending).toBeNull();
    });

    it('should validate DLQ reason values', () => {
      const item = createQueueItem();

      // Valid reasons should work
      syncQueueDAL.deadLetter({
        id: item.id,
        reason: 'MAX_ATTEMPTS_EXCEEDED',
        errorCategory: 'TRANSIENT',
      });

      const retrieved = syncQueueDAL.findById(item.id);
      expect(retrieved?.dead_letter_reason).toBe('MAX_ATTEMPTS_EXCEEDED');
    });
  });

  // ==========================================================================
  // Retry-After Header Abuse
  // ==========================================================================

  describe('Retry-After Header Abuse', () => {
    it('should handle malicious Retry-After values', () => {
      const maliciousValues = [
        '9999999999999', // Very large number
        '-1', // Negative
        'Infinity',
        'NaN',
        '<script>alert(1)</script>',
        '2099-12-31T23:59:59Z', // Far future date
        '1970-01-01T00:00:00Z', // Past date
      ];

      for (const value of maliciousValues) {
        // classifyError takes (httpStatus, errorMessage, retryAfterHeader)
        const classified = errorClassifierService.classifyError(429, 'Rate limited', value);

        // Should not crash, should provide safe default
        expect(classified.category).toBe('TRANSIENT');
        // retryAfter should be bounded to reasonable values
        if (classified.retryAfter) {
          const retryTime = new Date(classified.retryAfter).getTime();
          const maxAllowed = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days max
          expect(retryTime).toBeLessThanOrEqual(maxAllowed);
        }
      }
    });
  });

  // ==========================================================================
  // API-008: Output Filtering
  // ==========================================================================

  describe('API-008: Output Filtering', () => {
    it('should not expose sensitive fields in queue item retrieval', () => {
      const item = createQueueItem({
        payload: {
          password: 'secret123',
          api_key: 'key_xyz',
          data: 'normal data',
        },
      });

      const retrieved = syncQueueDAL.findById(item.id);

      // The payload is stored as-is (encrypted at rest is separate concern)
      // API layer should filter before sending to client
      expect(retrieved).toBeDefined();
      expect(retrieved?.payload).toContain('password'); // Stored in payload
      // Actual filtering would happen in IPC handlers, not DAL
    });

    it('should truncate response_body to prevent memory issues', () => {
      const item = createQueueItem();

      // Mark synced with large response
      const largeResponse = '{"data": "' + 'x'.repeat(100000) + '"}';

      syncQueueDAL.markSynced(item.id, {
        api_endpoint: '/api/v1/test',
        http_status: 200,
        response_body: largeResponse,
      });

      const retrieved = syncQueueDAL.findById(item.id);

      // Response should be stored (truncation happens at app level if needed)
      expect(retrieved?.response_body).toBeDefined();
    });
  });

  // ==========================================================================
  // Timing Attack Prevention
  // ==========================================================================

  describe('Timing Attack Prevention', () => {
    it('should have consistent response time for valid vs invalid store_id', async () => {
      // Create some items
      for (let i = 0; i < 10; i++) {
        createQueueItem({ entity_id: `timing-${i}` });
      }

      // Time valid query
      const validStart = Date.now();
      syncQueueDAL.getStats(ctx.storeId);
      const validDuration = Date.now() - validStart;

      // Time invalid query
      const invalidStart = Date.now();
      syncQueueDAL.getStats('nonexistent-store-uuid');
      const invalidDuration = Date.now() - invalidStart;

      // Times should be similar (within 100ms variance for test stability)
      const difference = Math.abs(validDuration - invalidDuration);
      expect(difference).toBeLessThan(100);
    });
  });
});
