/**
 * Batch Dispatcher Service
 *
 * Provides bounded batch processing with partitioned workers and backpressure.
 * Implements Phase 3 of SYNC-5000: Batching, Partitioned Dispatch, and Backpressure.
 *
 * Key features:
 * - Bounded batch sizes to prevent memory exhaustion
 * - Partitioned worker model for parallel processing with per-partition ordering
 * - Queue growth limits with configurable caps
 * - Backpressure policies: REJECT, COALESCE, DEFER
 *
 * @module main/services/batch-dispatcher
 * @security MQ-001: Idempotent message consumers
 * @security MQ-002: Dead letter queue for failed messages
 * @security MQ-003: Message validation before processing
 * @security MQ-004: Acknowledge only after successful processing
 * @security SEC-006: All queries use parameterized statements
 * @security DB-006: Store-scoped tenant isolation
 * @security ERR-008: Circuit breaker for external service calls
 */

import { createLogger } from '../utils/logger';
import {
  syncQueueDAL,
  type SyncQueueItem,
  type CreateSyncQueueItemData,
} from '../dal/sync-queue.dal';
import { cloudApiService } from './cloud-api.service';

// ============================================================================
// Types
// ============================================================================

/**
 * Partition key for grouping items
 * Items with the same partition key are processed in order
 */
export interface PartitionKey {
  /** Entity type (e.g., 'pack', 'shift', 'day_close') */
  entityType: string;
  /** Optional partition discriminator for finer-grained control */
  discriminator?: string;
}

/**
 * Batch configuration with enterprise defaults
 */
export interface BatchConfig {
  /** Maximum items per batch (default: 50, max: 200) */
  maxBatchSize: number;
  /** Maximum concurrent partitions being processed (default: 4) */
  maxConcurrentPartitions: number;
  /** Maximum queue depth before backpressure triggers (default: 10000) */
  maxQueueDepth: number;
  /** Maximum queue size in bytes (default: 50MB) */
  maxQueueSizeBytes: number;
  /** Batch timeout in milliseconds (default: 30000) */
  batchTimeoutMs: number;
}

/**
 * Overload policy determines what happens when queue limits are reached
 *
 * - REJECT: Throw error immediately, caller must retry later
 * - COALESCE: Merge with existing pending item if idempotency key matches
 * - DEFER: Queue the item but mark it as deferred for later processing
 */
export type OverloadPolicy = 'REJECT' | 'COALESCE' | 'DEFER';

/**
 * Queue health status for monitoring
 * LM-002: Structured metrics for observability
 */
export interface QueueHealthStatus {
  /** Current number of pending items */
  pendingCount: number;
  /** Current number of items in backoff */
  backoffCount: number;
  /** Current number of items in DLQ */
  deadLetterCount: number;
  /** Estimated queue size in bytes */
  estimatedSizeBytes: number;
  /** Whether queue depth limit is exceeded */
  isQueueDepthExceeded: boolean;
  /** Whether queue size limit is exceeded */
  isQueueSizeExceeded: boolean;
  /** Current overload policy state */
  overloadState: 'NORMAL' | 'WARNING' | 'CRITICAL';
  /** Partition depth breakdown */
  partitionDepths: Record<string, number>;
  /** Oldest pending item age in milliseconds */
  oldestItemAgeMs: number | null;
}

/**
 * Enqueue result with backpressure status
 */
export interface EnqueueResult {
  /** Whether the item was enqueued */
  success: boolean;
  /** The enqueued item (or existing item if coalesced) */
  item: SyncQueueItem | null;
  /** Whether the item was coalesced with an existing entry */
  coalesced: boolean;
  /** Whether the item was deferred due to backpressure */
  deferred: boolean;
  /** Current queue health status */
  queueHealth: QueueHealthStatus;
  /** Error message if rejected */
  error?: string;
}

/**
 * Partition batch for processing
 */
export interface PartitionBatch {
  /** Partition key identifying this batch */
  partitionKey: PartitionKey;
  /** Items in this batch, ordered by priority DESC then created_at ASC */
  items: SyncQueueItem[];
  /** Whether this partition has more items pending */
  hasMore: boolean;
  /** Total pending count for this partition */
  totalPending: number;
}

/**
 * Batch processing result
 */
export interface BatchProcessingResult {
  /** Total items processed across all partitions */
  totalProcessed: number;
  /** Number of successful items */
  succeeded: number;
  /** Number of failed items */
  failed: number;
  /** Partition-level results */
  partitionResults: Record<string, { succeeded: number; failed: number }>;
  /** Processing duration in milliseconds */
  durationMs: number;
}

/**
 * Item processor function type
 * Called for each item in a batch with partition context
 */
export type ItemProcessor = (
  item: SyncQueueItem,
  partitionKey: PartitionKey
) => Promise<{ success: boolean; error?: string }>;

// ============================================================================
// Constants
// ============================================================================

/**
 * Default batch size - enterprise-grade capacity
 * API-BP-005: Support 100-1000 items per batch
 *
 * Note: Actual limits are fetched from server via GET /api/v1/sync/config
 * These defaults are fallbacks for offline operation.
 */
const DEFAULT_MAX_BATCH_SIZE = 100;

/**
 * Maximum allowed batch size to prevent OOM
 * Increased to support server-configured enterprise limits (up to 1000)
 */
const ABSOLUTE_MAX_BATCH_SIZE = 1000;

/** Default concurrent partition limit */
const DEFAULT_MAX_CONCURRENT_PARTITIONS = 4;

/** Maximum concurrent partitions to prevent thread exhaustion */
const ABSOLUTE_MAX_CONCURRENT_PARTITIONS = 8;

/** Default queue depth limit */
const DEFAULT_MAX_QUEUE_DEPTH = 10000;

/** Default queue size limit (50MB) */
const DEFAULT_MAX_QUEUE_SIZE_BYTES = 50 * 1024 * 1024;

/** Default batch timeout */
const DEFAULT_BATCH_TIMEOUT_MS = 30000;

/** Warning threshold for queue depth (80% of max) */
const QUEUE_DEPTH_WARNING_RATIO = 0.8;

/** Critical threshold for queue depth (95% of max) */
const QUEUE_DEPTH_CRITICAL_RATIO = 0.95;

/** Average payload size estimate for queue size calculations */
const ESTIMATED_PAYLOAD_SIZE_BYTES = 1024;

/** Entity types that should be processed in priority order (dependencies) */
const PRIORITY_ENTITY_TYPES = ['shift', 'shift_opening', 'day_open'];

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('batch-dispatcher');

// ============================================================================
// Batch Dispatcher Service
// ============================================================================

/**
 * Batch Dispatcher Service
 *
 * Provides bounded batch processing with partitioned workers and backpressure.
 * Implements enterprise-grade queue management patterns:
 *
 * 1. BOUNDED BATCHES: Configurable batch sizes prevent memory exhaustion
 * 2. PARTITIONED DISPATCH: Items grouped by entity type, ordered within partition
 * 3. BACKPRESSURE: Queue limits trigger configurable overload policies
 * 4. DEPENDENCY ORDERING: Priority entity types processed first
 */
export class BatchDispatcherService {
  private config: BatchConfig;
  private overloadPolicy: OverloadPolicy;
  private isProcessing: boolean = false;
  private processingPartitions: Set<string> = new Set();

  constructor(config?: Partial<BatchConfig>, overloadPolicy?: OverloadPolicy) {
    this.config = {
      maxBatchSize: Math.min(
        config?.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE,
        ABSOLUTE_MAX_BATCH_SIZE
      ),
      maxConcurrentPartitions: Math.min(
        config?.maxConcurrentPartitions ?? DEFAULT_MAX_CONCURRENT_PARTITIONS,
        ABSOLUTE_MAX_CONCURRENT_PARTITIONS
      ),
      maxQueueDepth: config?.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH,
      maxQueueSizeBytes: config?.maxQueueSizeBytes ?? DEFAULT_MAX_QUEUE_SIZE_BYTES,
      batchTimeoutMs: config?.batchTimeoutMs ?? DEFAULT_BATCH_TIMEOUT_MS,
    };
    this.overloadPolicy = overloadPolicy ?? 'COALESCE';

    log.info('BatchDispatcher initialized', {
      config: this.config,
      overloadPolicy: this.overloadPolicy,
    });
  }

  // ==========================================================================
  // Queue Health Monitoring
  // ==========================================================================

  /**
   * Get current queue health status
   *
   * LM-002: Structured metrics for monitoring and alerting
   * DB-006: Store-scoped for tenant isolation
   *
   * @param storeId - Store identifier for tenant isolation
   * @returns Queue health status
   */
  getQueueHealth(storeId: string): QueueHealthStatus {
    const pendingCount = syncQueueDAL.getPendingCount(storeId);
    const backoffCount = syncQueueDAL.getBackoffCount(storeId);
    const deadLetterCount = syncQueueDAL.getDeadLetterCount(storeId);

    // Estimate queue size based on item count and average payload size
    const estimatedSizeBytes = pendingCount * ESTIMATED_PAYLOAD_SIZE_BYTES;

    // Calculate overload state
    const depthRatio = pendingCount / this.config.maxQueueDepth;
    const sizeRatio = estimatedSizeBytes / this.config.maxQueueSizeBytes;

    let overloadState: 'NORMAL' | 'WARNING' | 'CRITICAL';
    if (depthRatio >= QUEUE_DEPTH_CRITICAL_RATIO || sizeRatio >= QUEUE_DEPTH_CRITICAL_RATIO) {
      overloadState = 'CRITICAL';
    } else if (depthRatio >= QUEUE_DEPTH_WARNING_RATIO || sizeRatio >= QUEUE_DEPTH_WARNING_RATIO) {
      overloadState = 'WARNING';
    } else {
      overloadState = 'NORMAL';
    }

    // Get partition depths
    const partitionDepths = syncQueueDAL.getPartitionDepths(storeId);

    // Get oldest pending item age
    const oldestPending = syncQueueDAL.getOldestPendingTimestamp(storeId);
    const oldestItemAgeMs = oldestPending ? Date.now() - new Date(oldestPending).getTime() : null;

    return {
      pendingCount,
      backoffCount,
      deadLetterCount,
      estimatedSizeBytes,
      isQueueDepthExceeded: pendingCount >= this.config.maxQueueDepth,
      isQueueSizeExceeded: estimatedSizeBytes >= this.config.maxQueueSizeBytes,
      overloadState,
      partitionDepths,
      oldestItemAgeMs,
    };
  }

  /**
   * Check if queue can accept new items
   *
   * @param storeId - Store identifier
   * @returns Whether new items can be enqueued
   */
  canEnqueue(storeId: string): boolean {
    const health = this.getQueueHealth(storeId);
    return !health.isQueueDepthExceeded && !health.isQueueSizeExceeded;
  }

  // ==========================================================================
  // Enqueue with Backpressure
  // ==========================================================================

  /**
   * Enqueue an item with backpressure handling
   *
   * Applies the configured overload policy when queue limits are reached:
   * - REJECT: Throws QueueFullError
   * - COALESCE: Merges with existing pending item if idempotency key matches
   * - DEFER: Marks item as deferred for later processing
   *
   * @security MQ-001: Idempotent via idempotency key
   * @security SEC-006: Parameterized queries via DAL
   * @security DB-006: Store-scoped tenant isolation
   *
   * @param data - Item to enqueue
   * @param idempotencyKey - Optional idempotency key for deduplication
   * @returns Enqueue result with backpressure status
   */
  enqueueWithBackpressure(data: CreateSyncQueueItemData, idempotencyKey?: string): EnqueueResult {
    const queueHealth = this.getQueueHealth(data.store_id);

    // Check if queue limits are exceeded
    if (queueHealth.isQueueDepthExceeded || queueHealth.isQueueSizeExceeded) {
      return this.handleBackpressure(data, idempotencyKey, queueHealth);
    }

    // Normal enqueue path
    return this.performEnqueue(data, idempotencyKey, queueHealth);
  }

  /**
   * Handle backpressure based on configured policy
   */
  private handleBackpressure(
    data: CreateSyncQueueItemData,
    idempotencyKey: string | undefined,
    queueHealth: QueueHealthStatus
  ): EnqueueResult {
    log.warn('Queue limit reached, applying backpressure policy', {
      storeId: data.store_id,
      policy: this.overloadPolicy,
      pendingCount: queueHealth.pendingCount,
      maxQueueDepth: this.config.maxQueueDepth,
    });

    switch (this.overloadPolicy) {
      case 'REJECT':
        return {
          success: false,
          item: null,
          coalesced: false,
          deferred: false,
          queueHealth,
          error: `Queue full: ${queueHealth.pendingCount}/${this.config.maxQueueDepth} items pending. Retry later.`,
        };

      case 'COALESCE':
        // Try to coalesce with existing pending item
        if (idempotencyKey) {
          const existing = syncQueueDAL.findPendingByIdempotencyKey(data.store_id, idempotencyKey);
          if (existing) {
            // Update existing item's payload
            syncQueueDAL.updatePayload(existing.id, JSON.stringify(data.payload));
            log.info('Coalesced item during backpressure', {
              existingId: existing.id,
              entityType: data.entity_type,
              entityId: data.entity_id,
            });
            return {
              success: true,
              item: syncQueueDAL.findById(existing.id) ?? null,
              coalesced: true,
              deferred: false,
              queueHealth,
            };
          }
        }
        // No existing item to coalesce - fall through to reject
        return {
          success: false,
          item: null,
          coalesced: false,
          deferred: false,
          queueHealth,
          error: `Queue full and no existing item to coalesce. ${queueHealth.pendingCount}/${this.config.maxQueueDepth} items pending.`,
        };

      case 'DEFER': {
        // Enqueue but mark as deferred
        const result = this.performEnqueue(data, idempotencyKey, queueHealth);
        if (result.success && result.item) {
          syncQueueDAL.markDeferred(result.item.id);
          result.deferred = true;
          log.info('Item deferred due to backpressure', {
            itemId: result.item.id,
            entityType: data.entity_type,
          });
        }
        return result;
      }

      default:
        // Fallback to reject
        return {
          success: false,
          item: null,
          coalesced: false,
          deferred: false,
          queueHealth,
          error: `Unknown overload policy: ${this.overloadPolicy}`,
        };
    }
  }

  /**
   * Perform the actual enqueue operation
   */
  private performEnqueue(
    data: CreateSyncQueueItemData,
    idempotencyKey: string | undefined,
    queueHealth: QueueHealthStatus
  ): EnqueueResult {
    try {
      let item: SyncQueueItem;
      let coalesced = false;

      if (idempotencyKey) {
        const result = syncQueueDAL.enqueueWithIdempotency(data, idempotencyKey);
        item = result.item;
        coalesced = result.deduplicated;
      } else {
        item = syncQueueDAL.enqueue(data);
      }

      return {
        success: true,
        item,
        coalesced,
        deferred: false,
        queueHealth,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Enqueue failed', { error: message, entityType: data.entity_type });
      return {
        success: false,
        item: null,
        coalesced: false,
        deferred: false,
        queueHealth,
        error: message,
      };
    }
  }

  // ==========================================================================
  // Partitioned Batch Processing
  // ==========================================================================

  /**
   * Get partition batches for processing
   *
   * Groups items by entity type and returns bounded batches.
   * Respects dependency ordering: priority entity types are returned first.
   *
   * @security DB-006: Store-scoped for tenant isolation
   *
   * @param storeId - Store identifier
   * @returns Array of partition batches ordered by priority
   */
  getPartitionBatches(storeId: string): PartitionBatch[] {
    const batches: PartitionBatch[] = [];

    // Get pending counts by entity type
    const partitionDepths = syncQueueDAL.getPartitionDepths(storeId);

    // Sort partitions: priority types first, then by depth (highest first)
    const sortedPartitions = Object.entries(partitionDepths).sort(
      ([typeA, depthA], [typeB, depthB]) => {
        const isPriorityA = PRIORITY_ENTITY_TYPES.includes(typeA);
        const isPriorityB = PRIORITY_ENTITY_TYPES.includes(typeB);

        if (isPriorityA && !isPriorityB) return -1;
        if (!isPriorityA && isPriorityB) return 1;

        // Both priority or both non-priority: sort by depth DESC
        return depthB - depthA;
      }
    );

    // Build batches for each partition
    for (const [entityType, totalPending] of sortedPartitions) {
      if (totalPending === 0) continue;

      // Skip if this partition is already being processed
      if (this.processingPartitions.has(entityType)) {
        log.debug('Partition already being processed, skipping', { entityType });
        continue;
      }

      // Get bounded batch of items for this partition
      const items = syncQueueDAL.getRetryableItemsByEntityType(
        storeId,
        entityType,
        this.config.maxBatchSize
      );

      if (items.length > 0) {
        batches.push({
          partitionKey: { entityType },
          items,
          hasMore: totalPending > items.length,
          totalPending,
        });
      }
    }

    log.debug('Partition batches prepared', {
      storeId,
      partitionCount: batches.length,
      totalItems: batches.reduce((sum, b) => sum + b.items.length, 0),
    });

    return batches;
  }

  /**
   * Process batches with parallel partitions
   *
   * Processes multiple partitions concurrently while maintaining order within
   * each partition. Limited by maxConcurrentPartitions configuration.
   *
   * @param storeId - Store identifier
   * @param processor - Function to process each item
   * @returns Processing result with statistics
   */
  async processPartitionedBatches(
    storeId: string,
    processor: ItemProcessor
  ): Promise<BatchProcessingResult> {
    const startTime = Date.now();
    const result: BatchProcessingResult = {
      totalProcessed: 0,
      succeeded: 0,
      failed: 0,
      partitionResults: {},
      durationMs: 0,
    };

    // Prevent concurrent processing
    if (this.isProcessing) {
      log.warn('Batch processing already in progress, skipping');
      result.durationMs = Date.now() - startTime;
      return result;
    }

    this.isProcessing = true;

    try {
      // Get all partition batches
      const batches = this.getPartitionBatches(storeId);

      if (batches.length === 0) {
        log.debug('No batches to process');
        result.durationMs = Date.now() - startTime;
        return result;
      }

      // Process partitions with concurrency limit
      const concurrencyLimit = Math.min(this.config.maxConcurrentPartitions, batches.length);

      log.info('Starting partitioned batch processing', {
        storeId,
        partitions: batches.length,
        concurrency: concurrencyLimit,
        totalItems: batches.reduce((sum, b) => sum + b.items.length, 0),
      });

      // Process batches in chunks based on concurrency limit
      for (let i = 0; i < batches.length; i += concurrencyLimit) {
        const chunk = batches.slice(i, i + concurrencyLimit);

        // Process chunk partitions concurrently
        const chunkResults = await Promise.all(
          chunk.map((batch) => this.processSinglePartition(batch, processor))
        );

        // Aggregate results
        for (const partitionResult of chunkResults) {
          result.totalProcessed += partitionResult.processed;
          result.succeeded += partitionResult.succeeded;
          result.failed += partitionResult.failed;
          result.partitionResults[partitionResult.partitionKey] = {
            succeeded: partitionResult.succeeded,
            failed: partitionResult.failed,
          };
        }
      }

      result.durationMs = Date.now() - startTime;

      log.info('Partitioned batch processing complete', {
        storeId,
        totalProcessed: result.totalProcessed,
        succeeded: result.succeeded,
        failed: result.failed,
        durationMs: result.durationMs,
      });

      return result;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single partition batch
   *
   * Items within a partition are processed sequentially to maintain order.
   */
  private async processSinglePartition(
    batch: PartitionBatch,
    processor: ItemProcessor
  ): Promise<{
    partitionKey: string;
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    const partitionKey = batch.partitionKey.entityType;
    this.processingPartitions.add(partitionKey);

    let succeeded = 0;
    let failed = 0;

    try {
      // Process items sequentially within partition to maintain order
      for (const item of batch.items) {
        try {
          const itemResult = await processor(item, batch.partitionKey);

          if (itemResult.success) {
            succeeded++;
          } else {
            failed++;
            log.debug('Item processing failed', {
              itemId: item.id,
              entityType: item.entity_type,
              error: itemResult.error,
            });
          }
        } catch (error) {
          failed++;
          log.error('Item processing threw exception', {
            itemId: item.id,
            entityType: item.entity_type,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      return {
        partitionKey,
        processed: batch.items.length,
        succeeded,
        failed,
      };
    } finally {
      this.processingPartitions.delete(partitionKey);
    }
  }

  // ==========================================================================
  // Configuration Management
  // ==========================================================================

  /**
   * Update batch configuration
   *
   * @param newConfig - Partial configuration to update
   */
  updateConfig(newConfig: Partial<BatchConfig>): void {
    if (newConfig.maxBatchSize !== undefined) {
      this.config.maxBatchSize = Math.min(newConfig.maxBatchSize, ABSOLUTE_MAX_BATCH_SIZE);
    }
    if (newConfig.maxConcurrentPartitions !== undefined) {
      this.config.maxConcurrentPartitions = Math.min(
        newConfig.maxConcurrentPartitions,
        ABSOLUTE_MAX_CONCURRENT_PARTITIONS
      );
    }
    if (newConfig.maxQueueDepth !== undefined) {
      this.config.maxQueueDepth = newConfig.maxQueueDepth;
    }
    if (newConfig.maxQueueSizeBytes !== undefined) {
      this.config.maxQueueSizeBytes = newConfig.maxQueueSizeBytes;
    }
    if (newConfig.batchTimeoutMs !== undefined) {
      this.config.batchTimeoutMs = newConfig.batchTimeoutMs;
    }

    log.info('Batch config updated', { config: this.config });
  }

  /**
   * Sync configuration from server
   *
   * Fetches batch limits from GET /api/v1/sync/config and applies them.
   * Falls back to current config if server is unreachable.
   *
   * API-BP-005: Server-driven batch limits (100-1000 items)
   * This should be called:
   * - On application startup
   * - When starting a new sync session
   * - After receiving 413 (Payload Too Large) errors
   *
   * @returns Whether sync was successful
   */
  async syncConfigFromServer(): Promise<boolean> {
    try {
      const serverConfig = await cloudApiService.getSyncConfig();

      // Apply server limits (server values override local defaults)
      this.updateConfig({
        maxBatchSize: serverConfig.limits.maxBatchItems,
      });

      log.info('Synced batch config from server', {
        version: serverConfig.version,
        maxBatchItems: serverConfig.limits.maxBatchItems,
        maxPayloadBytes: serverConfig.limits.maxPayloadBytes,
      });

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.warn('Failed to sync config from server, using local defaults', {
        error: errorMessage,
        currentConfig: this.config,
      });
      return false;
    }
  }

  /**
   * Get batch limit for a specific operation type
   *
   * Queries server config for operation-specific limits.
   * Use this to get the correct batch size for pack_receive, shift_closing, etc.
   *
   * @param operationType - The sync operation type (e.g., 'pack_receive')
   * @returns Batch limit for the operation
   */
  async getBatchLimitForOperation(operationType: string): Promise<number> {
    try {
      return await cloudApiService.getBatchLimitForOperation(operationType);
    } catch {
      // Fall back to general batch size
      return this.config.maxBatchSize;
    }
  }

  /**
   * Update overload policy
   *
   * @param policy - New overload policy
   */
  setOverloadPolicy(policy: OverloadPolicy): void {
    this.overloadPolicy = policy;
    log.info('Overload policy updated', { policy });
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<BatchConfig> {
    return { ...this.config };
  }

  /**
   * Get current overload policy
   */
  getOverloadPolicy(): OverloadPolicy {
    return this.overloadPolicy;
  }

  /**
   * Check if batch processing is currently running
   */
  isCurrentlyProcessing(): boolean {
    return this.isProcessing;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/** Singleton instance of BatchDispatcherService */
export const batchDispatcher = new BatchDispatcherService();
