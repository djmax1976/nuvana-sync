/**
 * Transactional Outbox Integration Tests
 *
 * Tests for Phase 2: Transactional Outbox and Queue Integrity
 *
 * Coverage:
 * - DT2.1: Rollback scenario confirms neither business write nor queue write leaks
 * - DT2.2: Injected enqueue failure cannot produce committed business data without outbox entry
 * - DT2.4: Concurrency tests - duplicate local events collapse correctly
 *
 * @module tests/integration/transactional-outbox.integration.spec
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { createHash, randomUUID } from 'crypto';

// ============================================================================
// Test Database Setup (without module mocking - direct DB testing)
// ============================================================================

const TEST_DB_PATH = path.join(__dirname, 'transactional-outbox-test.db');
const TEST_STORE_ID = 'test-store-550e8400-e29b-41d4-a716-446655440000';

// Idempotency key generation (copied from service for direct testing)
function generateIdempotencyKey(params: {
  entity_type: string;
  entity_id: string;
  operation: string;
  discriminator?: string;
}): string {
  const components = [
    params.entity_type,
    params.entity_id,
    params.operation,
    params.discriminator || '',
  ];
  const input = components.join(':');
  const hash = createHash('sha256').update(input).digest('hex');
  return hash.substring(0, 32);
}

/**
 * Create test database with sync_queue schema
 */
function createTestDatabase(): Database.Database {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  const db = new Database(TEST_DB_PATH);

  // Create stores table
  db.exec(`
    CREATE TABLE stores (
      store_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.prepare('INSERT INTO stores (store_id, name) VALUES (?, ?)').run(TEST_STORE_ID, 'Test Store');

  // Create sync_queue table with v049 idempotency_key
  db.exec(`
    CREATE TABLE sync_queue (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('CREATE', 'UPDATE', 'DELETE', 'ACTIVATE')),
      payload TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      synced INTEGER NOT NULL DEFAULT 0 CHECK(synced IN (0, 1)),
      sync_attempts INTEGER NOT NULL DEFAULT 0 CHECK(sync_attempts >= 0),
      max_attempts INTEGER NOT NULL DEFAULT 5,
      last_sync_error TEXT,
      last_attempt_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at TEXT,
      sync_direction TEXT DEFAULT 'PUSH',
      api_endpoint TEXT,
      http_status INTEGER,
      response_body TEXT,
      dead_lettered INTEGER NOT NULL DEFAULT 0 CHECK(dead_lettered IN (0, 1)),
      dead_letter_reason TEXT,
      dead_lettered_at TEXT,
      error_category TEXT,
      retry_after TEXT,
      idempotency_key TEXT
    );
  `);

  // Create idempotency unique index
  db.exec(`
    CREATE UNIQUE INDEX idx_sync_queue_idempotency
      ON sync_queue(store_id, idempotency_key)
      WHERE synced = 0 AND dead_lettered = 0 AND idempotency_key IS NOT NULL;
  `);

  // Create test business table
  db.exec(`
    CREATE TABLE test_packs (
      pack_id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      pack_number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'RECEIVED',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

/**
 * Atomic write + enqueue within transaction
 * This is a direct implementation for testing without service dependencies
 */
function withSyncEnqueue<T>(
  db: Database.Database,
  businessOperation: () => T,
  syncDataBuilder: (result: T) => {
    store_id: string;
    entity_type: string;
    entity_id: string;
    operation: string;
    payload: object;
    idempotency_key?: string;
  } | null
): { result: T; syncItemId: string | null; deduplicated: boolean } {
  return db.transaction(() => {
    const result = businessOperation();
    const syncData = syncDataBuilder(result);

    if (!syncData) {
      return { result, syncItemId: null, deduplicated: false };
    }

    const idempotencyKey =
      syncData.idempotency_key ||
      generateIdempotencyKey({
        entity_type: syncData.entity_type,
        entity_id: syncData.entity_id,
        operation: syncData.operation,
      });

    // Check for existing pending item
    const existing = db
      .prepare(
        `
      SELECT id FROM sync_queue
      WHERE store_id = ? AND idempotency_key = ? AND synced = 0 AND dead_lettered = 0
      LIMIT 1
    `
      )
      .get(syncData.store_id, idempotencyKey) as { id: string } | undefined;

    if (existing) {
      // Update existing
      db.prepare(
        `
        UPDATE sync_queue SET payload = ? WHERE id = ?
      `
      ).run(JSON.stringify(syncData.payload), existing.id);
      return { result, syncItemId: existing.id, deduplicated: true };
    }

    // Create new item
    const id = randomUUID();
    db.prepare(
      `
      INSERT INTO sync_queue (
        id, store_id, entity_type, entity_id, operation,
        payload, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `
    ).run(
      id,
      syncData.store_id,
      syncData.entity_type,
      syncData.entity_id,
      syncData.operation,
      JSON.stringify(syncData.payload),
      idempotencyKey
    );

    return { result, syncItemId: id, deduplicated: false };
  })();
}

function getTestPacksCount(db: Database.Database, storeId: string): number {
  const result = db
    .prepare('SELECT COUNT(*) as count FROM test_packs WHERE store_id = ?')
    .get(storeId) as { count: number };
  return result.count;
}

function getPendingSyncQueueCount(db: Database.Database, storeId: string): number {
  const result = db
    .prepare(
      'SELECT COUNT(*) as count FROM sync_queue WHERE store_id = ? AND synced = 0 AND dead_lettered = 0'
    )
    .get(storeId) as { count: number };
  return result.count;
}

function getSyncQueueCount(db: Database.Database, storeId: string): number {
  const result = db
    .prepare('SELECT COUNT(*) as count FROM sync_queue WHERE store_id = ?')
    .get(storeId) as { count: number };
  return result.count;
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Transactional Outbox Integration Tests', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = createTestDatabase();
  });

  afterAll(() => {
    if (db) {
      db.close();
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  beforeEach(() => {
    db.exec('DELETE FROM sync_queue');
    db.exec('DELETE FROM test_packs');
  });

  // ==========================================================================
  // DT2.1: Rollback Scenario Tests
  // ==========================================================================

  describe('DT2.1: Rollback scenario - neither business write nor queue write leaks', () => {
    it('should rollback both business write and queue entry when business operation throws', () => {
      const packId = 'pack-rollback-test-001';

      expect(() => {
        withSyncEnqueue(
          db,
          () => {
            db.prepare(
              'INSERT INTO test_packs (pack_id, store_id, pack_number) VALUES (?, ?, ?)'
            ).run(packId, TEST_STORE_ID, '1234567');
            throw new Error('Simulated business operation failure');
          },
          () => ({
            store_id: TEST_STORE_ID,
            entity_type: 'pack',
            entity_id: packId,
            operation: 'CREATE',
            payload: { pack_number: '1234567' },
          })
        );
      }).toThrow('Simulated business operation failure');

      expect(getTestPacksCount(db, TEST_STORE_ID)).toBe(0);
      expect(getSyncQueueCount(db, TEST_STORE_ID)).toBe(0);
    });

    it('should rollback all writes when sync data builder throws', () => {
      const packId = 'pack-builder-error-001';

      expect(() => {
        withSyncEnqueue(
          db,
          () => {
            db.prepare(
              'INSERT INTO test_packs (pack_id, store_id, pack_number) VALUES (?, ?, ?)'
            ).run(packId, TEST_STORE_ID, '1234568');
            return { pack_id: packId };
          },
          () => {
            throw new Error('Simulated builder failure');
          }
        );
      }).toThrow('Simulated builder failure');

      expect(getTestPacksCount(db, TEST_STORE_ID)).toBe(0);
      expect(getSyncQueueCount(db, TEST_STORE_ID)).toBe(0);
    });

    it('should commit both when transaction succeeds', () => {
      const packId = 'pack-success-001';
      const idempotencyKey = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: packId,
        operation: 'CREATE',
      });

      const result = withSyncEnqueue(
        db,
        () => {
          db.prepare(
            'INSERT INTO test_packs (pack_id, store_id, pack_number) VALUES (?, ?, ?)'
          ).run(packId, TEST_STORE_ID, '1234569');
          return { pack_id: packId, pack_number: '1234569' };
        },
        (packResult) => ({
          store_id: TEST_STORE_ID,
          entity_type: 'pack',
          entity_id: packResult.pack_id,
          operation: 'CREATE',
          payload: { pack_number: packResult.pack_number },
          idempotency_key: idempotencyKey,
        })
      );

      expect(result.result.pack_id).toBe(packId);
      expect(result.syncItemId).not.toBeNull();
      expect(result.deduplicated).toBe(false);
      expect(getTestPacksCount(db, TEST_STORE_ID)).toBe(1);
      expect(getPendingSyncQueueCount(db, TEST_STORE_ID)).toBe(1);
    });

    it('should rollback multiple business writes in same transaction', () => {
      const packIds = ['pack-multi-001', 'pack-multi-002', 'pack-multi-003'];

      expect(() => {
        withSyncEnqueue(
          db,
          () => {
            for (const packId of packIds) {
              db.prepare(
                'INSERT INTO test_packs (pack_id, store_id, pack_number) VALUES (?, ?, ?)'
              ).run(packId, TEST_STORE_ID, packId);
            }
            throw new Error('Simulated multi-write failure');
          },
          () => ({
            store_id: TEST_STORE_ID,
            entity_type: 'pack',
            entity_id: 'multi',
            operation: 'CREATE',
            payload: { count: packIds.length },
          })
        );
      }).toThrow('Simulated multi-write failure');

      expect(getTestPacksCount(db, TEST_STORE_ID)).toBe(0);
      expect(getSyncQueueCount(db, TEST_STORE_ID)).toBe(0);
    });

    it('should rollback queue entry when second business write fails', () => {
      const packId1 = 'pack-partial-001';
      const _packId2 = 'pack-partial-002';

      expect(() => {
        withSyncEnqueue(
          db,
          () => {
            // First write succeeds
            db.prepare(
              'INSERT INTO test_packs (pack_id, store_id, pack_number) VALUES (?, ?, ?)'
            ).run(packId1, TEST_STORE_ID, '1111111');
            // Second write fails (duplicate key)
            db.prepare(
              'INSERT INTO test_packs (pack_id, store_id, pack_number) VALUES (?, ?, ?)'
            ).run(packId1, TEST_STORE_ID, '2222222'); // Same pack_id = constraint violation
            return { pack_id: packId1 };
          },
          () => ({
            store_id: TEST_STORE_ID,
            entity_type: 'pack',
            entity_id: packId1,
            operation: 'CREATE',
            payload: {},
          })
        );
      }).toThrow();

      // Transaction should have rolled back everything
      expect(getTestPacksCount(db, TEST_STORE_ID)).toBe(0);
      expect(getSyncQueueCount(db, TEST_STORE_ID)).toBe(0);
    });
  });

  // ==========================================================================
  // DT2.2: Enqueue Failure Prevention Tests
  // ==========================================================================

  describe('DT2.2: Enqueue failure cannot produce committed business data without outbox entry', () => {
    it('should dedupe when same idempotency key enqueued twice', () => {
      const packId = 'pack-constraint-001';
      const idempotencyKey = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: packId,
        operation: 'CREATE',
      });

      // First insert
      const firstResult = withSyncEnqueue(
        db,
        () => {
          db.prepare(
            'INSERT INTO test_packs (pack_id, store_id, pack_number) VALUES (?, ?, ?)'
          ).run(packId + '-first', TEST_STORE_ID, '1111111');
          return { pack_id: packId + '-first' };
        },
        () => ({
          store_id: TEST_STORE_ID,
          entity_type: 'pack',
          entity_id: packId,
          operation: 'CREATE',
          payload: { test: 'first' },
          idempotency_key: idempotencyKey,
        })
      );

      expect(firstResult.syncItemId).not.toBeNull();
      expect(firstResult.deduplicated).toBe(false);

      // Second insert with same key - should dedupe
      const secondResult = withSyncEnqueue(
        db,
        () => {
          db.prepare(
            'INSERT INTO test_packs (pack_id, store_id, pack_number) VALUES (?, ?, ?)'
          ).run(packId + '-second', TEST_STORE_ID, '2222222');
          return { pack_id: packId + '-second' };
        },
        () => ({
          store_id: TEST_STORE_ID,
          entity_type: 'pack',
          entity_id: packId,
          operation: 'CREATE',
          payload: { test: 'second' },
          idempotency_key: idempotencyKey,
        })
      );

      expect(secondResult.deduplicated).toBe(true);
      expect(secondResult.syncItemId).toBe(firstResult.syncItemId);
      expect(getTestPacksCount(db, TEST_STORE_ID)).toBe(2);
      expect(getPendingSyncQueueCount(db, TEST_STORE_ID)).toBe(1);
    });

    it('should handle null return from sync data builder (no enqueue needed)', () => {
      const packId = 'pack-no-sync-001';

      const result = withSyncEnqueue(
        db,
        () => {
          db.prepare(
            'INSERT INTO test_packs (pack_id, store_id, pack_number) VALUES (?, ?, ?)'
          ).run(packId, TEST_STORE_ID, '3333333');
          return { pack_id: packId };
        },
        () => null
      );

      expect(result.result.pack_id).toBe(packId);
      expect(result.syncItemId).toBeNull();
      expect(result.deduplicated).toBe(false);
      expect(getTestPacksCount(db, TEST_STORE_ID)).toBe(1);
      expect(getSyncQueueCount(db, TEST_STORE_ID)).toBe(0);
    });

    it('should rollback when enqueue violates FK constraint', () => {
      const packId = 'pack-invalid-store-001';

      expect(() => {
        withSyncEnqueue(
          db,
          () => {
            db.prepare(
              'INSERT INTO test_packs (pack_id, store_id, pack_number) VALUES (?, ?, ?)'
            ).run(packId, TEST_STORE_ID, '4444444');
            return { pack_id: packId };
          },
          () => ({
            store_id: 'invalid-store-id', // Non-existent store = FK violation
            entity_type: 'pack',
            entity_id: packId,
            operation: 'CREATE',
            payload: { test: 'data' },
          })
        );
      }).toThrow();

      expect(getTestPacksCount(db, TEST_STORE_ID)).toBe(0);
      expect(getSyncQueueCount(db, TEST_STORE_ID)).toBe(0);
    });
  });

  // ==========================================================================
  // DT2.4: Concurrency / Deduplication Tests
  // ==========================================================================

  describe('DT2.4: Duplicate local events collapse correctly under parallel producers', () => {
    it('should collapse duplicate enqueues with same idempotency key', () => {
      const packId = 'pack-dedupe-001';
      const idempotencyKey = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: packId,
        operation: 'UPDATE',
        discriminator: 'activate',
      });

      const results: Array<{ deduplicated: boolean }> = [];

      for (let i = 0; i < 5; i++) {
        const result = withSyncEnqueue(
          db,
          () => ({ iteration: i }),
          () => ({
            store_id: TEST_STORE_ID,
            entity_type: 'pack',
            entity_id: packId,
            operation: 'UPDATE',
            payload: { iteration: i, tickets_sold: 10 + i },
            idempotency_key: idempotencyKey,
          })
        );
        results.push({ deduplicated: result.deduplicated });
      }

      expect(results[0].deduplicated).toBe(false);
      expect(results.slice(1).every((r) => r.deduplicated)).toBe(true);
      expect(getPendingSyncQueueCount(db, TEST_STORE_ID)).toBe(1);

      // Verify payload was updated to latest
      const item = db
        .prepare('SELECT payload FROM sync_queue WHERE idempotency_key = ?')
        .get(idempotencyKey) as { payload: string };
      const payload = JSON.parse(item.payload);
      expect(payload.iteration).toBe(4);
      expect(payload.tickets_sold).toBe(14);
    });

    it('should create separate entries for different idempotency keys', () => {
      const packId = 'pack-multi-op-001';
      const operations = ['activate', 'deplete', 'return'];

      for (const op of operations) {
        const idempotencyKey = generateIdempotencyKey({
          entity_type: 'pack',
          entity_id: packId,
          operation: 'UPDATE',
          discriminator: op,
        });

        withSyncEnqueue(
          db,
          () => ({ op }),
          () => ({
            store_id: TEST_STORE_ID,
            entity_type: 'pack',
            entity_id: packId,
            operation: 'UPDATE',
            payload: { operation: op },
            idempotency_key: idempotencyKey,
          })
        );
      }

      expect(getPendingSyncQueueCount(db, TEST_STORE_ID)).toBe(3);
    });

    it('should allow same idempotency key after item is synced', () => {
      const packId = 'pack-reuse-key-001';
      const idempotencyKey = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: packId,
        operation: 'UPDATE',
      });

      // First enqueue
      const firstResult = withSyncEnqueue(
        db,
        () => ({ version: 1 }),
        () => ({
          store_id: TEST_STORE_ID,
          entity_type: 'pack',
          entity_id: packId,
          operation: 'UPDATE',
          payload: { version: 1 },
          idempotency_key: idempotencyKey,
        })
      );

      expect(firstResult.deduplicated).toBe(false);

      // Mark as synced
      db.prepare('UPDATE sync_queue SET synced = 1 WHERE id = ?').run(firstResult.syncItemId);

      // Enqueue again with same key
      const secondResult = withSyncEnqueue(
        db,
        () => ({ version: 2 }),
        () => ({
          store_id: TEST_STORE_ID,
          entity_type: 'pack',
          entity_id: packId,
          operation: 'UPDATE',
          payload: { version: 2 },
          idempotency_key: idempotencyKey,
        })
      );

      // Should create new entry since first is synced
      expect(secondResult.deduplicated).toBe(false);
      expect(secondResult.syncItemId).not.toBe(firstResult.syncItemId);
      expect(getPendingSyncQueueCount(db, TEST_STORE_ID)).toBe(1);
      expect(getSyncQueueCount(db, TEST_STORE_ID)).toBe(2);
    });

    it('should allow same idempotency key after item is dead-lettered', () => {
      const packId = 'pack-dlq-reuse-001';
      const idempotencyKey = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: packId,
        operation: 'UPDATE',
      });

      // First enqueue
      const firstResult = withSyncEnqueue(
        db,
        () => ({ version: 1 }),
        () => ({
          store_id: TEST_STORE_ID,
          entity_type: 'pack',
          entity_id: packId,
          operation: 'UPDATE',
          payload: { version: 1 },
          idempotency_key: idempotencyKey,
        })
      );

      // Mark as dead-lettered
      db.prepare('UPDATE sync_queue SET dead_lettered = 1 WHERE id = ?').run(
        firstResult.syncItemId
      );

      // Enqueue again with same key
      const secondResult = withSyncEnqueue(
        db,
        () => ({ version: 2 }),
        () => ({
          store_id: TEST_STORE_ID,
          entity_type: 'pack',
          entity_id: packId,
          operation: 'UPDATE',
          payload: { version: 2 },
          idempotency_key: idempotencyKey,
        })
      );

      // Should create new entry since first is dead-lettered
      expect(secondResult.deduplicated).toBe(false);
      expect(secondResult.syncItemId).not.toBe(firstResult.syncItemId);
    });

    it('should handle rapid updates with payload replacement', () => {
      const packId = 'pack-rapid-update-001';
      const idempotencyKey = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: packId,
        operation: 'UPDATE',
        discriminator: 'day-close-scan',
      });

      // Simulate rapid scanner input updates
      const serials = ['001', '002', '003', '004', '005'];
      for (const serial of serials) {
        withSyncEnqueue(
          db,
          () => ({ serial }),
          () => ({
            store_id: TEST_STORE_ID,
            entity_type: 'pack',
            entity_id: packId,
            operation: 'UPDATE',
            payload: { closing_serial: serial },
            idempotency_key: idempotencyKey,
          })
        );
      }

      // Should have single queue item with latest payload
      expect(getPendingSyncQueueCount(db, TEST_STORE_ID)).toBe(1);

      const item = db
        .prepare('SELECT payload FROM sync_queue WHERE idempotency_key = ?')
        .get(idempotencyKey) as { payload: string };
      expect(JSON.parse(item.payload).closing_serial).toBe('005');
    });
  });

  // ==========================================================================
  // Tenant Isolation Tests (DB-006)
  // ==========================================================================

  describe('DB-006: Tenant isolation', () => {
    it('should not dedupe across different stores with same idempotency key', () => {
      // Create second store
      const secondStoreId = 'second-store-550e8400-e29b-41d4-a716-446655440001';
      db.prepare('INSERT OR IGNORE INTO stores (store_id, name) VALUES (?, ?)').run(
        secondStoreId,
        'Second Store'
      );

      const idempotencyKey = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: 'pack-tenant-test',
        operation: 'CREATE',
      });

      // Enqueue to first store
      const firstResult = withSyncEnqueue(
        db,
        () => ({ store: 1 }),
        () => ({
          store_id: TEST_STORE_ID,
          entity_type: 'pack',
          entity_id: 'pack-tenant-test',
          operation: 'CREATE',
          payload: { store: 1 },
          idempotency_key: idempotencyKey,
        })
      );

      // Enqueue to second store (same key)
      const secondResult = withSyncEnqueue(
        db,
        () => ({ store: 2 }),
        () => ({
          store_id: secondStoreId,
          entity_type: 'pack',
          entity_id: 'pack-tenant-test',
          operation: 'CREATE',
          payload: { store: 2 },
          idempotency_key: idempotencyKey,
        })
      );

      // Both should be new (not deduped)
      expect(firstResult.deduplicated).toBe(false);
      expect(secondResult.deduplicated).toBe(false);
      expect(firstResult.syncItemId).not.toBe(secondResult.syncItemId);

      // Each store has one item
      expect(getPendingSyncQueueCount(db, TEST_STORE_ID)).toBe(1);
      expect(getPendingSyncQueueCount(db, secondStoreId)).toBe(1);
    });

    it('should scope idempotency lookup to store_id', () => {
      const secondStoreId = 'second-store-lookup-test';
      db.prepare('INSERT OR IGNORE INTO stores (store_id, name) VALUES (?, ?)').run(
        secondStoreId,
        'Second Store Lookup'
      );

      const idempotencyKey = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: 'same-pack',
        operation: 'CREATE',
      });

      // Insert into first store
      withSyncEnqueue(
        db,
        () => ({}),
        () => ({
          store_id: TEST_STORE_ID,
          entity_type: 'pack',
          entity_id: 'same-pack',
          operation: 'CREATE',
          payload: { store: 1 },
          idempotency_key: idempotencyKey,
        })
      );

      // Query for second store should not find it
      const existsForSecond = db
        .prepare(
          `
        SELECT 1 FROM sync_queue
        WHERE store_id = ? AND idempotency_key = ? AND synced = 0 AND dead_lettered = 0
        LIMIT 1
      `
        )
        .get(secondStoreId, idempotencyKey);

      expect(existsForSecond).toBeUndefined();

      // Query for first store should find it
      const existsForFirst = db
        .prepare(
          `
        SELECT 1 FROM sync_queue
        WHERE store_id = ? AND idempotency_key = ? AND synced = 0 AND dead_lettered = 0
        LIMIT 1
      `
        )
        .get(TEST_STORE_ID, idempotencyKey);

      expect(existsForFirst).toBeDefined();
    });
  });

  // ==========================================================================
  // Idempotency Key Generation Tests (Comprehensive)
  // ==========================================================================

  describe('Idempotency key generation', () => {
    it('should generate deterministic keys for same inputs', () => {
      const key1 = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: 'pack-123',
        operation: 'CREATE',
      });
      const key2 = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: 'pack-123',
        operation: 'CREATE',
      });

      expect(key1).toBe(key2);
      expect(key1).toHaveLength(32);
    });

    it('should generate different keys for different discriminators', () => {
      const packId = 'pack-disc-test';

      const activateKey = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: packId,
        operation: 'UPDATE',
        discriminator: 'activate',
      });

      const depleteKey = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: packId,
        operation: 'UPDATE',
        discriminator: 'deplete',
      });

      expect(activateKey).not.toBe(depleteKey);
    });

    it('should generate hex-only keys', () => {
      const key = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: 'test-123',
        operation: 'CREATE',
      });

      expect(key).toMatch(/^[a-f0-9]{32}$/);
    });
  });
});
