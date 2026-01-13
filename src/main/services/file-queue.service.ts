/**
 * File Queue Service
 *
 * Manages a FIFO queue for file processing with retry logic.
 * Ensures files are processed sequentially to prevent database contention.
 *
 * @module main/services/file-queue
 * @security SEC-014: Path validation before processing
 */

import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Status of a queued file
 */
export type QueuedFileStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Queued file entry
 */
export interface QueuedFile {
  /** Unique queue entry ID */
  id: string;
  /** File path on disk */
  filePath: string;
  /** File name for logging */
  fileName: string;
  /** SHA-256 hash of file content */
  fileHash: string;
  /** Current status */
  status: QueuedFileStatus;
  /** Number of processing attempts */
  attempts: number;
  /** Timestamp when added to queue */
  addedAt: Date;
  /** Last attempt timestamp */
  lastAttemptAt?: Date;
  /** Error message from last failed attempt */
  lastError?: string;
}

/**
 * Queue statistics
 */
export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  totalProcessed: number;
}

/**
 * File processor function type
 */
export type FileProcessor = (filePath: string, fileHash: string) => Promise<void>;

// ============================================================================
// Constants
// ============================================================================

/** Maximum retry attempts before abandoning */
const MAX_RETRIES = 3;

/** Delay between retries in milliseconds (exponential backoff base) */
const RETRY_DELAY_BASE_MS = 1000;

/** Maximum concurrent processing (kept at 1 for SQLite safety) */
const MAX_CONCURRENT = 1;

/** Queue cleanup threshold (remove completed entries after this many) */
const CLEANUP_THRESHOLD = 100;

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('file-queue');

// ============================================================================
// File Queue Service
// ============================================================================

/**
 * File Queue Service
 *
 * Manages sequential file processing with retry logic and statistics.
 * Uses EventEmitter for status updates to renderer process.
 */
export class FileQueueService extends EventEmitter {
  private queue: Map<string, QueuedFile> = new Map();
  private processingCount = 0;
  private processor: FileProcessor | null = null;
  private totalProcessed = 0;
  private isRunning = false;

  constructor() {
    super();
  }

  /**
   * Set the file processor function
   *
   * @param processor - Function to process files
   */
  setProcessor(processor: FileProcessor): void {
    this.processor = processor;
    log.info('File processor configured');
  }

  /**
   * Add a file to the processing queue
   *
   * @param filePath - Path to the file
   * @param fileName - File name
   * @param fileHash - SHA-256 hash of file content
   * @returns Queue entry ID
   */
  enqueue(filePath: string, fileName: string, fileHash: string): string {
    // Check for duplicates by hash
    const existing = Array.from(this.queue.values()).find(
      (q) => q.fileHash === fileHash && q.status !== 'failed'
    );

    if (existing) {
      log.debug('File already in queue', { fileName, existingId: existing.id });
      return existing.id;
    }

    // Generate unique ID
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const entry: QueuedFile = {
      id,
      filePath,
      fileName,
      fileHash,
      status: 'pending',
      attempts: 0,
      addedAt: new Date(),
    };

    this.queue.set(id, entry);

    log.info('File enqueued', {
      id,
      fileName,
      queueSize: this.queue.size,
    });

    this.emit('file-enqueued', entry);

    // Trigger processing
    this.processNext();

    return id;
  }

  /**
   * Get queue entry by ID
   *
   * @param id - Queue entry ID
   * @returns Queue entry or undefined
   */
  getEntry(id: string): QueuedFile | undefined {
    return this.queue.get(id);
  }

  /**
   * Get all queue entries
   *
   * @returns Array of queue entries
   */
  getQueue(): QueuedFile[] {
    return Array.from(this.queue.values());
  }

  /**
   * Get pending files (not yet processed)
   *
   * @returns Array of pending queue entries
   */
  getPending(): QueuedFile[] {
    return Array.from(this.queue.values()).filter((q) => q.status === 'pending');
  }

  /**
   * Get failed files
   *
   * @returns Array of failed queue entries
   */
  getFailed(): QueuedFile[] {
    return Array.from(this.queue.values()).filter((q) => q.status === 'failed');
  }

  /**
   * Get queue statistics
   *
   * @returns Queue statistics
   */
  getStats(): QueueStats {
    const entries = Array.from(this.queue.values());

    return {
      pending: entries.filter((q) => q.status === 'pending').length,
      processing: entries.filter((q) => q.status === 'processing').length,
      completed: entries.filter((q) => q.status === 'completed').length,
      failed: entries.filter((q) => q.status === 'failed').length,
      totalProcessed: this.totalProcessed,
    };
  }

  /**
   * Retry a failed file
   *
   * @param id - Queue entry ID
   * @returns true if retry was initiated
   */
  retry(id: string): boolean {
    const entry = this.queue.get(id);

    if (!entry || entry.status !== 'failed') {
      log.warn('Cannot retry: entry not found or not failed', { id });
      return false;
    }

    entry.status = 'pending';
    entry.attempts = 0;
    entry.lastError = undefined;

    log.info('File queued for retry', { id, fileName: entry.fileName });
    this.emit('file-retried', entry);

    this.processNext();
    return true;
  }

  /**
   * Retry all failed files
   *
   * @returns Number of files queued for retry
   */
  retryAllFailed(): number {
    const failed = this.getFailed();
    let count = 0;

    for (const entry of failed) {
      if (this.retry(entry.id)) {
        count++;
      }
    }

    log.info('Retrying all failed files', { count });
    return count;
  }

  /**
   * Clear completed entries from queue
   * Keeps failed entries for review
   */
  clearCompleted(): void {
    const toRemove: string[] = [];

    for (const [id, entry] of this.queue) {
      if (entry.status === 'completed') {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      this.queue.delete(id);
    }

    log.debug('Cleared completed entries', { count: toRemove.length });
  }

  /**
   * Clear all entries from queue
   * Warning: This will stop processing of pending files
   */
  clear(): void {
    const size = this.queue.size;
    this.queue.clear();
    log.info('Queue cleared', { entriesCleared: size });
    this.emit('queue-cleared');
  }

  /**
   * Stop processing (will complete current file)
   */
  stop(): void {
    this.isRunning = false;
    log.info('Queue processing stopped');
    this.emit('queue-stopped');
  }

  /**
   * Resume processing
   */
  resume(): void {
    if (!this.isRunning) {
      this.isRunning = true;
      log.info('Queue processing resumed');
      this.emit('queue-resumed');
      this.processNext();
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Process next file in queue
   */
  private async processNext(): Promise<void> {
    // Check if we can process
    if (!this.processor) {
      log.warn('No processor configured, skipping');
      return;
    }

    if (this.processingCount >= MAX_CONCURRENT) {
      return;
    }

    if (!this.isRunning) {
      this.isRunning = true;
    }

    // Find next pending file
    const pending = Array.from(this.queue.values()).find((q) => q.status === 'pending');

    if (!pending) {
      // Queue empty, cleanup completed entries if over threshold
      if (this.queue.size > CLEANUP_THRESHOLD) {
        this.clearCompleted();
      }
      return;
    }

    // Mark as processing
    pending.status = 'processing';
    pending.attempts++;
    pending.lastAttemptAt = new Date();
    this.processingCount++;

    log.info('Processing file', {
      id: pending.id,
      fileName: pending.fileName,
      attempt: pending.attempts,
    });

    this.emit('file-processing', pending);

    try {
      await this.processor(pending.filePath, pending.fileHash);

      // Success
      pending.status = 'completed';
      this.totalProcessed++;

      log.info('File processed successfully', {
        id: pending.id,
        fileName: pending.fileName,
      });

      this.emit('file-completed', pending);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      pending.lastError = errorMessage;

      if (pending.attempts >= MAX_RETRIES) {
        // Max retries exceeded
        pending.status = 'failed';

        log.error('File processing failed (max retries)', {
          id: pending.id,
          fileName: pending.fileName,
          attempts: pending.attempts,
          error: errorMessage,
        });

        this.emit('file-failed', pending);
      } else {
        // Will retry
        pending.status = 'pending';

        const delay = RETRY_DELAY_BASE_MS * Math.pow(2, pending.attempts - 1);

        log.warn('File processing failed, will retry', {
          id: pending.id,
          fileName: pending.fileName,
          attempt: pending.attempts,
          nextRetryMs: delay,
          error: errorMessage,
        });

        this.emit('file-retry-scheduled', { entry: pending, delayMs: delay });

        // Schedule retry with exponential backoff
        setTimeout(() => this.processNext(), delay);
      }
    } finally {
      this.processingCount--;
    }

    // Process next file
    if (this.isRunning) {
      // Small delay to prevent tight loop
      setTimeout(() => this.processNext(), 50);
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton file queue service instance
 */
export const fileQueueService = new FileQueueService();
