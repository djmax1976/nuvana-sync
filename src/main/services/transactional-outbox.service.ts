/**
 * Transactional Outbox Service
 *
 * Provides atomic business-write + enqueue operations using SQLite transactions.
 * Implements the Transactional Outbox pattern to ensure data consistency between
 * business operations and sync queue entries.
 *
 * PHASE 2: Transactional Outbox and Queue Integrity (SYNC-5000)
 *
 * @module main/services/transactional-outbox
 * @security MQ-001: Idempotent message consumers via idempotency keys
 * @security SEC-006: All queries use parameterized statements
 * @security DB-006: Store-scoped tenant isolation
 */

import { createHash, randomUUID } from 'crypto';
import { getDatabase, isDatabaseInitialized, type DatabaseInstance } from './database.service';
import { createLogger } from '../utils/logger';
import type { SyncQueueItem, CreateSyncQueueItemData, SyncOperation } from '../dal/sync-queue.dal';

// ============================================================================
// Types
// ============================================================================

/**
 * Parameters for generating an idempotency key
 * MQ-001: Deterministic key generation for deduplication
 */
export interface IdempotencyKeyParams {
  /** Entity type (e.g., 'pack', 'shift', 'day_close') */
  entity_type: string;
  /** Entity identifier */
  entity_id: string;
  /** Sync operation */
  operation: SyncOperation;
  /** Optional discriminator for distinguishing similar operations */
  discriminator?: string;
}

/**
 * Extended enqueue data with idempotency key
 */
export interface EnqueueWithIdempotencyData extends CreateSyncQueueItemData {
  /** Pre-computed idempotency key (optional - will be generated if not provided) */
  idempotency_key?: string;
}

/**
 * Result of an atomic operation with enqueue
 */
export interface AtomicOperationResult<T> {
  /** Business operation result */
  result: T;
  /** Enqueued sync item (null if deduplicated) */
  syncItem: SyncQueueItem | null;
  /** Whether the item was deduplicated (existing pending entry found) */
  deduplicated: boolean;
}

/**
 * Builder function for creating sync queue data from business operation result
 */
export type SyncDataBuilder<T> = (result: T) => EnqueueWithIdempotencyData | null;

// ============================================================================
// Constants
// ============================================================================

/** Idempotency key hash algorithm */
const HASH_ALGORITHM = 'sha256';

/** Idempotency key length (truncated for storage efficiency) */
const IDEMPOTENCY_KEY_LENGTH = 32;

/** Default max retry attempts for sync items */
const DEFAULT_MAX_ATTEMPTS = 5;

/** Default priority for sync items */
const DEFAULT_PRIORITY = 0;

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('transactional-outbox');

// ============================================================================
// Idempotency Key Generation
// ============================================================================

/**
 * Generate a deterministic idempotency key from operation parameters
 *
 * MQ-001: Same operation with same parameters produces same key
 * SEC-006: Uses cryptographic hash to prevent collisions
 *
 * @param params - Parameters for key generation
 * @returns Deterministic idempotency key (32 hex chars)
 */
export function generateIdempotencyKey(params: IdempotencyKeyParams): string {
  const components = [
    params.entity_type,
    params.entity_id,
    params.operation,
    params.discriminator || '',
  ];

  const input = components.join(':');
  const hash = createHash(HASH_ALGORITHM).update(input).digest('hex');

  // Truncate to configured length for storage efficiency
  return hash.substring(0, IDEMPOTENCY_KEY_LENGTH);
}

/**
 * Generate idempotency key from sync queue data
 * Convenience wrapper for CreateSyncQueueItemData
 *
 * @param data - Sync queue item data
 * @param discriminator - Optional additional discriminator
 * @returns Idempotency key
 */
export function generateIdempotencyKeyFromData(
  data: CreateSyncQueueItemData,
  discriminator?: string
): string {
  return generateIdempotencyKey({
    entity_type: data.entity_type,
    entity_id: data.entity_id,
    operation: data.operation,
    discriminator,
  });
}

// ============================================================================
// Transactional Outbox Service
// ============================================================================

/**
 * Transactional Outbox Service
 *
 * Provides atomic business-write + enqueue operations to ensure:
 * 1. Business data and sync queue entries are committed together
 * 2. Rollback on failure removes both business data and queue entry
 * 3. Idempotency keys prevent duplicate queue entries
 *
 * @example
 * ```typescript
 * const result = transactionalOutbox.withSyncEnqueue(
 *   () => lotteryPacksDAL.receive(data),
 *   (pack) => ({
 *     store_id: storeId,
 *     entity_type: 'pack',
 *     entity_id: pack.pack_id,
 *     operation: 'CREATE',
 *     payload: buildPackSyncPayload(pack),
 *   })
 * );
 * ```
 */
export class TransactionalOutboxService {
  /**
   * Get database instance
   * @throws Error if database is not initialized
   */
  private get db(): DatabaseInstance {
    if (!isDatabaseInitialized()) {
      throw new Error('Database not initialized. Cannot perform transactional outbox operations.');
    }
    return getDatabase();
  }

  /**
   * Execute a business operation and enqueue for sync atomically
   *
   * Both the business operation and sync queue insert happen within
   * the same SQLite transaction. If either fails, both are rolled back.
   *
   * MQ-001: Uses idempotency key for deduplication
   * SEC-006: All queries use parameterized statements
   * DB-006: Store-scoped via store_id in queue data
   *
   * @param businessOperation - Function that performs the business write
   * @param syncDataBuilder - Function that builds sync queue data from result
   * @returns Operation result with sync item info
   */
  withSyncEnqueue<T>(
    businessOperation: () => T,
    syncDataBuilder: SyncDataBuilder<T>
  ): AtomicOperationResult<T> {
    return this.db.transaction(() => {
      // Step 1: Execute business operation
      const result = businessOperation();

      // Step 2: Build sync queue data from result
      const syncData = syncDataBuilder(result);

      // Step 3: If no sync data, return result without enqueue
      if (!syncData) {
        return {
          result,
          syncItem: null,
          deduplicated: false,
        };
      }

      // Step 4: Enqueue with deduplication
      const { syncItem, deduplicated } = this.enqueueWithDedupe(syncData);

      return {
        result,
        syncItem,
        deduplicated,
      };
    })();
  }

  /**
   * Execute multiple sync enqueues atomically within one transaction
   *
   * Useful for operations that need to enqueue multiple items (e.g.,
   * auto-depletion followed by activation).
   *
   * @param businessOperation - Function that performs the business write
   * @param syncDataBuilders - Array of functions that build sync queue data
   * @returns Operation result with array of sync items
   */
  withMultipleSyncEnqueue<T>(
    businessOperation: () => T,
    syncDataBuilders: Array<SyncDataBuilder<T>>
  ): {
    result: T;
    syncItems: Array<SyncQueueItem | null>;
    deduplicatedCount: number;
  } {
    return this.db.transaction(() => {
      // Step 1: Execute business operation
      const result = businessOperation();

      // Step 2: Enqueue all sync items
      const syncItems: Array<SyncQueueItem | null> = [];
      let deduplicatedCount = 0;

      for (const builder of syncDataBuilders) {
        const syncData = builder(result);

        if (!syncData) {
          syncItems.push(null);
          continue;
        }

        const { syncItem, deduplicated } = this.enqueueWithDedupe(syncData);
        syncItems.push(syncItem);
        if (deduplicated) {
          deduplicatedCount++;
        }
      }

      return {
        result,
        syncItems,
        deduplicatedCount,
      };
    })();
  }

  /**
   * Enqueue a sync item with deduplication check
   *
   * If an existing pending item with the same idempotency key exists,
   * updates its payload instead of creating a duplicate.
   *
   * MQ-001: Idempotent enqueue via idempotency key
   * SEC-006: Parameterized INSERT and UPDATE
   *
   * @param data - Sync queue item data with optional idempotency key
   * @returns Enqueued or updated item with dedupe flag
   */
  enqueueWithDedupe(data: EnqueueWithIdempotencyData): {
    syncItem: SyncQueueItem;
    deduplicated: boolean;
  } {
    // Generate idempotency key if not provided
    const idempotencyKey = data.idempotency_key || generateIdempotencyKeyFromData(data);

    // Check for existing pending item with same idempotency key
    // SEC-006: Parameterized query
    const existingStmt = this.db.prepare(`
      SELECT * FROM sync_queue
      WHERE store_id = ?
        AND idempotency_key = ?
        AND synced = 0
        AND dead_lettered = 0
      LIMIT 1
    `);

    const existing = existingStmt.get(data.store_id, idempotencyKey) as SyncQueueItem | undefined;

    if (existing) {
      // Update existing item's payload instead of creating duplicate
      // SEC-006: Parameterized UPDATE
      const now = new Date().toISOString();
      const updateStmt = this.db.prepare(`
        UPDATE sync_queue SET
          payload = ?,
          updated_at = ?
        WHERE id = ?
      `);

      updateStmt.run(JSON.stringify(data.payload), now, existing.id);

      log.debug('Deduplicated sync queue item (updated existing)', {
        idempotencyKey,
        existingId: existing.id,
        entityType: data.entity_type,
        entityId: data.entity_id,
      });

      // Re-fetch updated item
      const updatedItem = this.findById(existing.id);
      if (!updatedItem) {
        throw new Error(`Failed to retrieve updated sync queue item: ${existing.id}`);
      }

      return {
        syncItem: updatedItem,
        deduplicated: true,
      };
    }

    // Create new item with idempotency key
    const id = this.generateId();
    const now = new Date().toISOString();

    // Determine direction and max attempts
    const direction = data.sync_direction || 'PUSH';
    const maxAttempts = direction === 'PULL' ? 2 : DEFAULT_MAX_ATTEMPTS;

    // SEC-006: Parameterized INSERT
    const insertStmt = this.db.prepare(`
      INSERT INTO sync_queue (
        id, store_id, entity_type, entity_id, operation,
        payload, priority, synced, sync_attempts, max_attempts,
        created_at, sync_direction, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
    `);

    insertStmt.run(
      id,
      data.store_id,
      data.entity_type,
      data.entity_id,
      data.operation,
      JSON.stringify(data.payload),
      data.priority || DEFAULT_PRIORITY,
      maxAttempts,
      now,
      direction,
      idempotencyKey
    );

    log.debug('Sync item enqueued with idempotency key', {
      id,
      idempotencyKey,
      entityType: data.entity_type,
      entityId: data.entity_id,
      operation: data.operation,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created sync queue item: ${id}`);
    }

    return {
      syncItem: created,
      deduplicated: false,
    };
  }

  /**
   * Atomic enqueue within an existing transaction context
   *
   * Use this when you need to enqueue from within another transaction.
   * Does NOT start a new transaction.
   *
   * @param data - Sync queue item data
   * @returns Created sync queue item
   */
  enqueueAtomic(data: EnqueueWithIdempotencyData): SyncQueueItem {
    const { syncItem } = this.enqueueWithDedupe(data);
    return syncItem;
  }

  /**
   * Check if an idempotency key already exists in the pending queue
   *
   * @param storeId - Store identifier
   * @param idempotencyKey - Idempotency key to check
   * @returns true if pending item exists
   */
  hasPendingIdempotencyKey(storeId: string, idempotencyKey: string): boolean {
    const stmt = this.db.prepare(`
      SELECT 1 FROM sync_queue
      WHERE store_id = ?
        AND idempotency_key = ?
        AND synced = 0
        AND dead_lettered = 0
      LIMIT 1
    `);

    return stmt.get(storeId, idempotencyKey) !== undefined;
  }

  /**
   * Find pending item by idempotency key
   *
   * @param storeId - Store identifier
   * @param idempotencyKey - Idempotency key
   * @returns Pending item or null
   */
  findPendingByIdempotencyKey(storeId: string, idempotencyKey: string): SyncQueueItem | null {
    const stmt = this.db.prepare(`
      SELECT * FROM sync_queue
      WHERE store_id = ?
        AND idempotency_key = ?
        AND synced = 0
        AND dead_lettered = 0
      LIMIT 1
    `);

    const result = stmt.get(storeId, idempotencyKey) as SyncQueueItem | undefined;
    return result || null;
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Generate UUID for new sync queue item
   */
  private generateId(): string {
    return randomUUID();
  }

  /**
   * Find sync queue item by ID
   */
  private findById(id: string): SyncQueueItem | undefined {
    const stmt = this.db.prepare('SELECT * FROM sync_queue WHERE id = ?');
    return stmt.get(id) as SyncQueueItem | undefined;
  }
}

// ============================================================================
// Lazy Singleton Export
// ============================================================================

/**
 * Lazy singleton instance holder
 * @internal
 */
let _instance: TransactionalOutboxService | null = null;

/**
 * Get or create the singleton instance
 * @internal
 */
function getInstance(): TransactionalOutboxService {
  if (!_instance) {
    _instance = new TransactionalOutboxService();
  }
  return _instance;
}

/**
 * Reset the singleton instance (for testing only)
 * @internal
 */
export function _resetTransactionalOutbox(): void {
  _instance = null;
}

/**
 * Lazy singleton proxy for transactional outbox operations
 */
export const transactionalOutbox: TransactionalOutboxService = new Proxy(
  {} as TransactionalOutboxService,
  {
    get(_target, prop: string | symbol) {
      const instance = getInstance();
      const value = (instance as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof value === 'function') {
        return value.bind(instance);
      }
      return value;
    },
  }
);
