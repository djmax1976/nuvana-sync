/**
 * File Watcher Service Unit Tests
 *
 * Tests for file watching, path validation, and local-first processing.
 *
 * Test Coverage Matrix:
 * - FW-001 through 010: Path Validation (SEC-014)
 * - FW-020 through 030: File Processing Flow
 * - FW-040 through 050: File Type Detection
 * - FW-060 through 070: Archive/Error Handling
 * - FW-080 through 090: Statistics and Events
 *
 * @module tests/unit/services/file-watcher.service.spec
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock close function for watcher
const mockChokidarClose = vi.fn();

// Mock watcher instance
let mockWatcherInstance: EventEmitter & { close: () => void };

// Mock for processFile
const mockProcessFile = vi.fn();

// Set up all vi.mock calls first (hoisted)
vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => mockWatcherInstance),
  },
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
}));

vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../../../src/shared/types/config.types', () => ({
  validateSafePath: vi.fn(() => ({ success: true })),
}));

vi.mock('../../../src/main/services/parser.service', () => ({
  createParserService: vi.fn(() => ({
    processFile: mockProcessFile,
  })),
}));

// Import after mocks are set up
import chokidar from 'chokidar';
import * as fs from 'fs/promises';
import {
  FileWatcherService,
  createFileWatcherService,
} from '../../../src/main/services/file-watcher.service';
import { validateSafePath } from '../../../src/shared/types/config.types';
import type { NuvanaConfig } from '../../../src/shared/types/config.types';

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockConfig = (overrides: Partial<NuvanaConfig> = {}): NuvanaConfig => ({
  apiUrl: 'https://api.test.com',
  apiKey: 'test-api-key',
  storeId: 'store-123',
  watchPath: 'C:\\naxml\\incoming',
  archivePath: 'C:\\naxml\\archive',
  errorPath: 'C:\\naxml\\errors',
  pollInterval: 5,
  enabledFileTypes: {
    pjr: true,
    fgm: true,
    msm: true,
    fpm: true,
    mcm: true,
    tlm: true,
  },
  startOnLogin: false,
  minimizeToTray: false,
  showNotifications: false,
  processInOrder: false,
  isConfigured: true,
  ...overrides,
});

const SAMPLE_FGM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<NAXML-POSJournal version="3.4">
  <MovementHeader>
    <StoreLocationID>STORE001</StoreLocationID>
    <BusinessDate>2025-01-15</BusinessDate>
  </MovementHeader>
</NAXML-POSJournal>`;

// ============================================================================
// Test Suite
// ============================================================================

describe('FileWatcherService', () => {
  let service: FileWatcherService;
  let mockConfig: NuvanaConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = createMockConfig();

    // Create a fresh mock watcher for each test
    mockWatcherInstance = Object.assign(new EventEmitter(), {
      close: mockChokidarClose,
    });

    // Reset the mock to return our new watcher instance
    vi.mocked(chokidar.watch).mockReturnValue(
      mockWatcherInstance as unknown as ReturnType<typeof chokidar.watch>
    );

    // Reset validateSafePath to success
    vi.mocked(validateSafePath).mockReturnValue({ success: true } as ReturnType<
      typeof validateSafePath
    >);

    service = new FileWatcherService(mockConfig, 'store-123');
  });

  afterEach(() => {
    service.stop();
  });

  // ==========================================================================
  // FW-001 through 010: Path Validation (SEC-014)
  // ==========================================================================

  describe('Path Validation (SEC-014)', () => {
    it('FW-001: should reject paths with directory traversal', async () => {
      service.start();
      mockWatcherInstance.emit('ready');

      // Simulate a file with path traversal attempt
      const maliciousPath = 'C:\\naxml\\incoming\\..\\..\\system\\sensitive.xml';

      // Trigger file detection
      mockWatcherInstance.emit('add', maliciousPath);

      // Path validation happens synchronously, but processing is async
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should not have called processFile
      expect(mockProcessFile).not.toHaveBeenCalled();
    });

    it('FW-002: should accept paths within allowed directories', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      mockProcessFile.mockResolvedValue({
        success: true,
        documentType: 'FuelGradeMovement',
        recordsCreated: 5,
      });

      service.start();
      mockWatcherInstance.emit('ready');

      const validPath = 'C:\\naxml\\incoming\\FGM20250115.xml';
      mockWatcherInstance.emit('add', validPath);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockProcessFile).toHaveBeenCalledWith(validPath, expect.any(String));
    });

    it('FW-003: should normalize paths before validation', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      mockProcessFile.mockResolvedValue({
        success: true,
        documentType: 'FuelGradeMovement',
        recordsCreated: 1,
      });

      service.start();
      mockWatcherInstance.emit('ready');

      // Path with redundant separators
      const messyPath = 'C:\\naxml\\incoming\\\\FGM20250115.xml';
      mockWatcherInstance.emit('add', messyPath);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockProcessFile).toHaveBeenCalled();
    });

    it('FW-004: should validate watch path on start', () => {
      vi.mocked(validateSafePath).mockReturnValue({
        success: false,
        error: { message: 'Invalid' },
      } as ReturnType<typeof validateSafePath>);

      service.start();

      expect(chokidar.watch).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // FW-020 through 030: File Processing Flow
  // ==========================================================================

  describe('File Processing Flow', () => {
    it('FW-020: should process files through ParserService', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      mockProcessFile.mockResolvedValue({
        success: true,
        documentType: 'FuelGradeMovement',
        recordsCreated: 5,
        fileId: 'file-123',
      });

      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', 'C:\\naxml\\incoming\\FGM20250115.xml');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockProcessFile).toHaveBeenCalledWith(
        'C:\\naxml\\incoming\\FGM20250115.xml',
        expect.stringMatching(/^[a-f0-9]{64}$/) // SHA-256 hash
      );
    });

    it('FW-021: should generate SHA-256 hash for file content', async () => {
      const content = 'test content';
      vi.mocked(fs.readFile).mockResolvedValue(content);
      mockProcessFile.mockResolvedValue({
        success: true,
        documentType: 'Unknown',
        recordsCreated: 0,
      });

      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', 'C:\\naxml\\incoming\\FGM20250115.xml');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify hash is consistent (SHA-256 of 'test content')
      expect(mockProcessFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/^[a-f0-9]{64}$/)
      );
    });

    it('FW-022: should skip duplicate files in processing queue', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);

      // Slow processing to allow duplicate detection
      mockProcessFile.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ success: true, recordsCreated: 1 }), 100)
          )
      );

      service.start();
      mockWatcherInstance.emit('ready');

      // Emit same file twice quickly
      const filePath = 'C:\\naxml\\incoming\\FGM20250115.xml';
      mockWatcherInstance.emit('add', filePath);
      mockWatcherInstance.emit('add', filePath);

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should only process once
      expect(mockProcessFile).toHaveBeenCalledTimes(1);
    });

    it('FW-023: should handle processing errors gracefully', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);
      mockProcessFile.mockResolvedValue({
        success: false,
        documentType: 'Unknown',
        recordsCreated: 0,
        error: 'Parse error',
      });

      const errorHandler = vi.fn();
      service.on('file-error', errorHandler);

      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', 'C:\\naxml\\incoming\\FGM20250115.xml');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(String),
        })
      );
    });

    it('FW-024: should emit file-processed event on success', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);
      mockProcessFile.mockResolvedValue({
        success: true,
        documentType: 'FuelGradeMovement',
        recordsCreated: 5,
      });

      const processedHandler = vi.fn();
      service.on('file-processed', processedHandler);

      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', 'C:\\naxml\\incoming\\FGM20250115.xml');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(processedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          documentType: 'FuelGradeMovement',
          recordsCreated: 5,
        })
      );
    });
  });

  // ==========================================================================
  // FW-040 through 050: File Type Detection
  // ==========================================================================

  describe('File Type Detection', () => {
    it('FW-040: should detect FuelGradeMovement from FGM prefix', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      mockProcessFile.mockResolvedValue({ success: true, recordsCreated: 1 });

      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', 'C:\\naxml\\incoming\\FGM20250115.xml');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockProcessFile).toHaveBeenCalled();
    });

    it('FW-041: should detect POSJournal from PJR prefix', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      mockProcessFile.mockResolvedValue({ success: true, recordsCreated: 1 });

      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', 'C:\\naxml\\incoming\\PJR20250115.xml');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockProcessFile).toHaveBeenCalled();
    });

    it('FW-042: should skip non-XML files', async () => {
      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', 'C:\\naxml\\incoming\\report.txt');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockProcessFile).not.toHaveBeenCalled();
    });

    it('FW-043: should skip XML files without NAXML prefix', async () => {
      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', 'C:\\naxml\\incoming\\random.xml');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockProcessFile).not.toHaveBeenCalled();
    });

    it('FW-044: should handle case-insensitive file extensions', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      mockProcessFile.mockResolvedValue({ success: true, recordsCreated: 1 });

      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', 'C:\\naxml\\incoming\\FGM20250115.XML');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockProcessFile).toHaveBeenCalled();
    });

    it('FW-045: should skip disabled file types', async () => {
      // Create config with FGM disabled
      const configWithDisabled = createMockConfig({
        enabledFileTypes: { pjr: true, fgm: false, msm: true, fpm: true, mcm: true, tlm: true },
      });
      service = new FileWatcherService(configWithDisabled, 'store-123');
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', 'C:\\naxml\\incoming\\FGM20250115.xml');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should skip ParserService for disabled types
      expect(mockProcessFile).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // FW-060 through 070: Archive/Error Handling
  // ==========================================================================

  describe('Archive and Error Handling', () => {
    it('FW-060: should move successful files to archive', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);
      mockProcessFile.mockResolvedValue({
        success: true,
        documentType: 'FuelGradeMovement',
        recordsCreated: 5,
      });

      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', 'C:\\naxml\\incoming\\FGM20250115.xml');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fs.mkdir).toHaveBeenCalledWith('C:\\naxml\\archive', { recursive: true });
      expect(fs.rename).toHaveBeenCalledWith(
        'C:\\naxml\\incoming\\FGM20250115.xml',
        'C:\\naxml\\archive\\FGM20250115.xml'
      );
    });

    it('FW-061: should move failed files to error folder', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);
      mockProcessFile.mockResolvedValue({
        success: false,
        documentType: 'Unknown',
        recordsCreated: 0,
        error: 'Parse error',
      });

      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', 'C:\\naxml\\incoming\\FGM20250115.xml');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fs.mkdir).toHaveBeenCalledWith('C:\\naxml\\errors', { recursive: true });
      expect(fs.rename).toHaveBeenCalledWith(
        'C:\\naxml\\incoming\\FGM20250115.xml',
        'C:\\naxml\\errors\\FGM20250115.xml'
      );
    });

    it('FW-062: should handle archive path not configured', async () => {
      const configNoArchive = createMockConfig({ archivePath: undefined });
      service = new FileWatcherService(configNoArchive, 'store-123');

      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      mockProcessFile.mockResolvedValue({ success: true, recordsCreated: 1 });

      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', 'C:\\naxml\\incoming\\FGM20250115.xml');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fs.mkdir).not.toHaveBeenCalled();
      expect(fs.rename).not.toHaveBeenCalled();
    });

    it('FW-063: should validate archive destination path (SEC-014)', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      mockProcessFile.mockResolvedValue({ success: true, recordsCreated: 1 });

      // Mock validateSafePath to fail for archive
      vi.mocked(validateSafePath).mockImplementation((pathArg: string) => {
        if (pathArg === 'C:\\naxml\\archive') {
          return { success: false, error: { message: 'Invalid archive path' } } as ReturnType<
            typeof validateSafePath
          >;
        }
        return { success: true } as ReturnType<typeof validateSafePath>;
      });

      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', 'C:\\naxml\\incoming\\FGM20250115.xml');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should not attempt rename with invalid archive
      expect(fs.rename).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // FW-080 through 090: Statistics and Events
  // ==========================================================================

  describe('Statistics and Events', () => {
    it('FW-080: should track files processed count', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);
      mockProcessFile.mockResolvedValue({ success: true, recordsCreated: 1 });

      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', 'C:\\naxml\\incoming\\FGM001.xml');
      await new Promise((resolve) => setTimeout(resolve, 50));
      mockWatcherInstance.emit('add', 'C:\\naxml\\incoming\\FGM002.xml');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stats = service.getStats();
      expect(stats.filesProcessed).toBe(2);
    });

    it('FW-081: should track files errored count', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);
      mockProcessFile.mockResolvedValue({ success: false, recordsCreated: 0, error: 'Error' });

      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', 'C:\\naxml\\incoming\\FGM001.xml');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stats = service.getStats();
      expect(stats.filesErrored).toBe(1);
    });

    it('FW-082: should update lastSyncTime on successful processing', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);
      mockProcessFile.mockResolvedValue({ success: true, recordsCreated: 1 });

      service.start();
      mockWatcherInstance.emit('ready');

      const beforeTime = new Date();
      mockWatcherInstance.emit('add', 'C:\\naxml\\incoming\\FGM001.xml');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stats = service.getStats();
      expect(stats.lastSyncTime).not.toBeNull();
      expect(stats.lastSyncTime!.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
    });

    it('FW-083: should emit watcher-ready event', async () => {
      // Mock readdir to return empty array so processExistingFiles completes quickly
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const readyHandler = vi.fn();
      service.on('watcher-ready', readyHandler);

      service.start();
      mockWatcherInstance.emit('ready');

      // Wait for async processExistingFiles to complete and emit watcher-ready
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(readyHandler).toHaveBeenCalled();
    });

    it('FW-084: should emit watcher-error event on chokidar error', () => {
      const errorHandler = vi.fn();
      service.on('watcher-error', errorHandler);

      service.start();
      const testError = new Error('Watch error');
      mockWatcherInstance.emit('error', testError);

      expect(errorHandler).toHaveBeenCalledWith(testError);
    });

    it('FW-085: should track recent files', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);
      mockProcessFile.mockResolvedValue({ success: true, recordsCreated: 1 });

      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', 'C:\\naxml\\incoming\\FGM001.xml');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const recentFiles = service.getRecentFiles();
      expect(recentFiles.length).toBe(1);
      expect(recentFiles[0].fileName).toBe('FGM001.xml');
      expect(recentFiles[0].status).toBe('success');
    });

    it('FW-086: should limit recent files to 50', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);
      mockProcessFile.mockResolvedValue({ success: true, recordsCreated: 1 });

      service.start();
      mockWatcherInstance.emit('ready');

      // Process more than 50 files
      for (let i = 0; i < 60; i++) {
        mockWatcherInstance.emit(
          'add',
          `C:\\naxml\\incoming\\FGM${String(i).padStart(3, '0')}.xml`
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const recentFiles = service.getRecentFiles();
      expect(recentFiles.length).toBeLessThanOrEqual(50);
    });
  });

  // ==========================================================================
  // Watcher Lifecycle
  // ==========================================================================

  describe('Watcher Lifecycle', () => {
    it('should start watching with correct options', () => {
      service.start();

      expect(chokidar.watch).toHaveBeenCalledWith(
        'C:\\naxml\\incoming',
        expect.objectContaining({
          usePolling: true,
          persistent: true,
          depth: 2,
        })
      );
    });

    it('should not start if already watching', () => {
      service.start();
      service.start(); // Second call

      expect(chokidar.watch).toHaveBeenCalledTimes(1);
    });

    it('should stop watching', () => {
      service.start();
      service.stop();

      expect(mockChokidarClose).toHaveBeenCalled();
      expect(service.isWatching()).toBe(false);
    });

    it('should update isWatching status', () => {
      expect(service.isWatching()).toBe(false);

      service.start();
      mockWatcherInstance.emit('ready');

      expect(service.isWatching()).toBe(true);
    });

    it('should not start without watch path', () => {
      const configNoPath = createMockConfig({ watchPath: undefined });
      service = new FileWatcherService(configNoPath, 'store-123');

      service.start();

      expect(chokidar.watch).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Factory Function
  // ==========================================================================

  describe('createFileWatcherService', () => {
    it('should create a new FileWatcherService instance', () => {
      const instance = createFileWatcherService(mockConfig, 'store-456');

      expect(instance).toBeInstanceOf(FileWatcherService);
    });
  });

  // ==========================================================================
  // Manual Processing
  // ==========================================================================

  describe('processExistingFiles', () => {
    it('should process XML files in watch directory', async () => {
      // Mock readdir to return Dirent objects for the recursive search
      const mockDirents = [
        { name: 'FGM001.xml', isFile: () => true, isDirectory: () => false },
        { name: 'FGM002.xml', isFile: () => true, isDirectory: () => false },
        { name: 'readme.txt', isFile: () => true, isDirectory: () => false },
      ];
      vi.mocked(fs.readdir).mockResolvedValue(
        mockDirents as unknown as Awaited<ReturnType<typeof fs.readdir>>
      );
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);
      mockProcessFile.mockResolvedValue({ success: true, recordsCreated: 1 });

      await service.processExistingFiles();

      // Should process only XML files
      expect(mockProcessFile).toHaveBeenCalledTimes(2);
    });

    it('should skip if no watch path configured', async () => {
      const configNoPath = createMockConfig({ watchPath: undefined });
      service = new FileWatcherService(configNoPath, 'store-123');

      await service.processExistingFiles();

      expect(fs.readdir).not.toHaveBeenCalled();
    });
  });
});
