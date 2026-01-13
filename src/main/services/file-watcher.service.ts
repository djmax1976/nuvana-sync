/**
 * File Watcher Service
 *
 * Monitors a directory for NAXML files using Chokidar.
 * Parses files and stores them locally via ParserService (local-first architecture).
 * Data is then queued for cloud synchronization via SyncQueueDAL.
 *
 * @module main/services/file-watcher
 * @security SEC-014: Path validation, CDP-001: SHA-256 hashing
 * @security SEC-015: File size limits enforced
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import chokidar, { FSWatcher } from 'chokidar';
import { createLogger } from '../utils/logger';
import { type NuvanaConfig, validateSafePath } from '../../shared/types/config.types';
import {
  type FileRecord,
  type SyncStats,
  type NAXMLDocumentType,
} from '../../shared/types/sync.types';
import { createParserService, type ParserService } from './parser.service';

const log = createLogger('file-watcher');

/**
 * SEC-014: Validate that a file path is safe and within allowed directories
 */
function isPathSafe(filePath: string, allowedBasePaths: string[]): boolean {
  // Normalize the path to prevent traversal attacks
  const normalizedPath = path.normalize(filePath);

  // Check for path traversal patterns
  if (normalizedPath.includes('..')) {
    log.warn('Path traversal attempt detected', {
      filePath,
      normalizedPath,
    });
    return false;
  }

  // Verify path is within allowed directories
  const isWithinAllowed = allowedBasePaths.some((basePath) => {
    const normalizedBase = path.normalize(basePath);
    return normalizedPath.startsWith(normalizedBase);
  });

  if (!isWithinAllowed) {
    log.warn('Path outside allowed directories', {
      filePath,
      allowedBasePaths,
    });
    return false;
  }

  return true;
}

/**
 * CDP-001: Generate SHA-256 hash of file content
 */
function generateFileHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export class FileWatcherService extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private config: NuvanaConfig;
  private storeId: string;
  private parserService: ParserService;
  private recentFiles: FileRecord[] = [];
  private stats: SyncStats = {
    filesProcessed: 0,
    filesErrored: 0,
    lastSyncTime: null,
    isWatching: false,
  };
  private processingQueue: Set<string> = new Set();

  /**
   * Create a FileWatcherService instance
   *
   * @param config - Application configuration
   * @param storeId - Store identifier for tenant isolation (DB-006)
   */
  constructor(config: NuvanaConfig, storeId: string) {
    super();
    this.config = config;
    this.storeId = storeId;
    this.parserService = createParserService(storeId);
  }

  /**
   * Get allowed base paths for path validation
   */
  private getAllowedPaths(): string[] {
    const paths: string[] = [];
    if (this.config.watchPath) paths.push(this.config.watchPath);
    if (this.config.archivePath) paths.push(this.config.archivePath);
    if (this.config.errorPath) paths.push(this.config.errorPath);
    return paths;
  }

  /**
   * Start watching the configured directory
   */
  start(): void {
    if (this.watcher) {
      log.info('File watcher already running');
      return;
    }

    if (!this.config.watchPath) {
      log.error('No watch path configured');
      return;
    }

    // SEC-014: Validate watch path
    const pathValidation = validateSafePath(this.config.watchPath);
    if (!pathValidation.success) {
      log.error('Invalid watch path', {
        watchPath: this.config.watchPath,
        error: pathValidation.error?.message,
      });
      return;
    }

    log.info('Starting file watcher', { watchPath: this.config.watchPath });

    this.watcher = chokidar.watch(this.config.watchPath, {
      // Use polling for network drives (more reliable)
      usePolling: true,
      interval: this.config.pollInterval * 1000,

      // Wait for files to finish writing
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100,
      },

      // Only watch XML files
      ignored: (filePath: string) => {
        const ext = path.extname(filePath).toLowerCase();
        return ext !== '.xml';
      },

      // Watch settings
      persistent: true,
      ignoreInitial: false, // Process existing files on startup
      depth: 0, // Only watch top level directory
      ignorePermissionErrors: true,
    });

    this.watcher
      .on('add', (filePath) => this.handleNewFile(filePath))
      .on('change', (filePath) => this.handleFileChange(filePath))
      .on('error', (error: unknown) =>
        this.handleError(error instanceof Error ? error : new Error(String(error)))
      )
      .on('ready', () => {
        log.info('File watcher ready');
        this.stats.isWatching = true;
        this.emit('watcher-ready');
      });
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.stats.isWatching = false;
      log.info('File watcher stopped');
    }
  }

  /**
   * Check if watcher is active
   */
  isWatching(): boolean {
    return this.stats.isWatching;
  }

  /**
   * Get sync statistics
   */
  getStats(): SyncStats {
    return { ...this.stats };
  }

  /**
   * Get recent file records
   */
  getRecentFiles(): FileRecord[] {
    return [...this.recentFiles].slice(0, 50);
  }

  /**
   * Manually process existing files in watch directory
   */
  async processExistingFiles(): Promise<void> {
    if (!this.config.watchPath) return;

    try {
      const files = await fs.readdir(this.config.watchPath);
      const xmlFiles = files.filter((f) => path.extname(f).toLowerCase() === '.xml');

      log.info('Processing existing files', { count: xmlFiles.length });

      for (const file of xmlFiles) {
        const filePath = path.join(this.config.watchPath, file);
        await this.processFile(filePath);
      }
    } catch (error) {
      log.error('Error processing existing files', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle new file detected
   */
  private async handleNewFile(filePath: string): Promise<void> {
    if (!this.isNAXMLFile(filePath)) return;

    // SEC-014: Validate file path
    if (!isPathSafe(filePath, this.getAllowedPaths())) {
      log.warn('Rejected file outside allowed paths', { filePath });
      return;
    }

    log.info('New file detected', { filePath });
    this.emit('file-detected', filePath);

    await this.processFile(filePath);
  }

  /**
   * Handle file change (shouldn't happen often for NAXML)
   */
  private async handleFileChange(filePath: string): Promise<void> {
    // For NAXML files, changes typically mean the file is still being written
    // The awaitWriteFinish option should handle this
    log.debug('File changed', { filePath });
  }

  /**
   * Handle watcher error
   */
  private handleError(error: Error): void {
    log.error('File watcher error', {
      error: error.message,
      stack: error.stack,
    });
    this.emit('watcher-error', error);
  }

  /**
   * Process a single file using local-first architecture
   * Parses XML → Stores in SQLite via DAL → Queues for cloud sync
   *
   * @security SEC-014: Path validation before processing
   * @security SEC-015: File size limits enforced by ParserService
   * @security CDP-001: SHA-256 hash for integrity/deduplication
   */
  private async processFile(filePath: string): Promise<void> {
    const fileName = path.basename(filePath);

    // SEC-014: Validate file path before processing
    if (!isPathSafe(filePath, this.getAllowedPaths())) {
      log.warn('Rejected file with unsafe path', { filePath });
      return;
    }

    // Skip if already processing
    if (this.processingQueue.has(filePath)) {
      return;
    }

    // Add to queue
    this.processingQueue.add(filePath);

    // Create file record for UI tracking
    const record: FileRecord = {
      filePath,
      fileName,
      status: 'processing',
      timestamp: new Date(),
    };
    this.addFileRecord(record);

    try {
      // CDP-001: Generate SHA-256 hash before reading full content
      const content = await fs.readFile(filePath, 'utf-8');
      const fileHash = generateFileHash(content);

      // Detect document type for UI record (ParserService also detects internally)
      const docType = this.detectDocumentType(fileName, content);
      record.documentType = docType;

      log.info('Processing file', {
        fileName,
        documentType: docType,
        fileHash: fileHash.substring(0, 16) + '...',
        sizeBytes: content.length,
      });

      // Check if this file type is enabled in config
      if (!this.isFileTypeEnabled(docType)) {
        log.info('Skipping disabled file type', { docType, fileName });
        record.status = 'success';
        record.error = 'Skipped (disabled file type)';
        this.updateFileRecord(record);
        await this.moveToArchive(filePath);
        return;
      }

      // LOCAL-FIRST: Parse and store via ParserService
      // ParserService handles: parsing, DAL storage, sync queue, processed_files tracking
      const result = await this.parserService.processFile(filePath, fileHash);

      if (result.success) {
        // Success - data stored locally and queued for sync
        record.status = 'success';
        // Cast to sync types - parser may return broader document types
        record.documentType = result.documentType as NAXMLDocumentType;
        this.stats.filesProcessed++;
        this.stats.lastSyncTime = new Date();

        log.info('File processed successfully (local-first)', {
          fileName,
          documentType: result.documentType,
          recordsCreated: result.recordsCreated,
          totalProcessed: this.stats.filesProcessed,
        });

        // Move to archive
        await this.moveToArchive(filePath);

        this.emit('file-processed', {
          filePath,
          success: true,
          documentType: result.documentType,
          recordsCreated: result.recordsCreated,
        });
      } else {
        // ParserService returned error (validation, duplicate, etc.)
        throw new Error(result.error || 'Unknown processing error');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      log.error('Error processing file', {
        fileName,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      record.status = 'error';
      record.error = errorMessage;
      this.stats.filesErrored++;

      // Move to error folder
      await this.moveToError(filePath);

      this.emit('file-error', { filePath, error: errorMessage });
    } finally {
      this.processingQueue.delete(filePath);
      this.updateFileRecord(record);
    }
  }

  /**
   * Check if file is a NAXML file we care about
   */
  private isNAXMLFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.xml') return false;

    const name = path.basename(filePath).toUpperCase();
    return (
      name.startsWith('PJR') ||
      name.startsWith('FGM') ||
      name.startsWith('MSM') ||
      name.startsWith('FPM') ||
      name.startsWith('MCM') ||
      name.startsWith('TLM') ||
      name.startsWith('ISM') ||
      name.startsWith('TPM')
    );
  }

  /**
   * Detect document type from filename or content
   * SEC-014: Returns validated NAXMLDocumentType
   */
  private detectDocumentType(fileName: string, _xml: string): NAXMLDocumentType {
    const name = fileName.toUpperCase();

    if (name.startsWith('PJR')) return 'POSJournal';
    if (name.startsWith('FGM')) return 'FuelGradeMovement';
    if (name.startsWith('MSM')) return 'MiscellaneousSummaryMovement';
    if (name.startsWith('FPM')) return 'FuelProductMovement';
    if (name.startsWith('MCM')) return 'MerchandiseCodeMovement';
    if (name.startsWith('TLM')) return 'TaxLevelMovement';
    if (name.startsWith('ISM')) return 'ItemSalesMovement';
    if (name.startsWith('TPM')) return 'TankProductMovement';

    // Fall back to Unknown (validated enum value)
    return 'Unknown';
  }

  /**
   * Check if file type is enabled in config
   */
  private isFileTypeEnabled(docType: NAXMLDocumentType): boolean {
    const typeMap: Record<string, keyof typeof this.config.enabledFileTypes> = {
      POSJournal: 'pjr',
      FuelGradeMovement: 'fgm',
      MiscellaneousSummaryMovement: 'msm',
      FuelProductMovement: 'fpm',
      MerchandiseCodeMovement: 'mcm',
      TaxLevelMovement: 'tlm',
    };

    const configKey = typeMap[docType];
    if (!configKey) return true; // Unknown types are processed

    return this.config.enabledFileTypes[configKey] ?? true;
  }

  /**
   * Move file to archive folder
   * SEC-014: Validates destination path
   */
  private async moveToArchive(filePath: string): Promise<void> {
    if (!this.config.archivePath) return;

    try {
      // SEC-014: Validate archive path
      const archiveValidation = validateSafePath(this.config.archivePath);
      if (!archiveValidation.success) {
        log.error('Invalid archive path', {
          archivePath: this.config.archivePath,
        });
        return;
      }

      await fs.mkdir(this.config.archivePath, { recursive: true });
      const fileName = path.basename(filePath);

      // SEC-014: Ensure destination is within archive path
      const destPath = path.join(this.config.archivePath, fileName);
      if (!isPathSafe(destPath, [this.config.archivePath])) {
        log.error('Archive destination path traversal attempt', {
          filePath,
          destPath,
        });
        return;
      }

      await fs.rename(filePath, destPath);
      log.info('File archived', { fileName, destPath });
    } catch (error) {
      log.error('Failed to archive file', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Move file to error folder
   * SEC-014: Validates destination path
   */
  private async moveToError(filePath: string): Promise<void> {
    if (!this.config.errorPath) return;

    try {
      // SEC-014: Validate error path
      const errorPathValidation = validateSafePath(this.config.errorPath);
      if (!errorPathValidation.success) {
        log.error('Invalid error path', { errorPath: this.config.errorPath });
        return;
      }

      await fs.mkdir(this.config.errorPath, { recursive: true });
      const fileName = path.basename(filePath);

      // SEC-014: Ensure destination is within error path
      const destPath = path.join(this.config.errorPath, fileName);
      if (!isPathSafe(destPath, [this.config.errorPath])) {
        log.error('Error destination path traversal attempt', {
          filePath,
          destPath,
        });
        return;
      }

      await fs.rename(filePath, destPath);
      log.info('File moved to error folder', { fileName, destPath });
    } catch (error) {
      log.error('Failed to move file to error folder', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Add file record to recent list
   */
  private addFileRecord(record: FileRecord): void {
    this.recentFiles.unshift(record);
    if (this.recentFiles.length > 100) {
      this.recentFiles = this.recentFiles.slice(0, 100);
    }
  }

  /**
   * Update existing file record
   */
  private updateFileRecord(record: FileRecord): void {
    const index = this.recentFiles.findIndex((r) => r.filePath === record.filePath);
    if (index !== -1) {
      this.recentFiles[index] = record;
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new FileWatcherService instance
 *
 * @param config - Application configuration
 * @param storeId - Store identifier for tenant isolation (DB-006)
 * @returns FileWatcherService instance
 *
 * @example
 * ```typescript
 * const watcher = createFileWatcherService(config, 'store-123');
 * watcher.on('file-processed', (event) => console.log('Processed:', event.filePath));
 * watcher.start();
 * ```
 */
export function createFileWatcherService(
  config: NuvanaConfig,
  storeId: string
): FileWatcherService {
  return new FileWatcherService(config, storeId);
}
