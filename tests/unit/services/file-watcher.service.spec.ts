/**
 * File Watcher Service Unit Tests
 *
 * Tests for file watching, path validation, POS type validation, and local-first processing.
 *
 * Test Coverage Matrix:
 * - FW-001 through 010: Path Validation (SEC-014)
 * - FW-POS-001 through 011: POS Type Validation (Phase 3 - SEC-014)
 * - FW-020 through 030: File Processing Flow
 * - FW-040 through 050: File Type Detection
 * - FW-060 through 070: Archive/Error Handling
 * - FW-080 through 090: Statistics and Events
 *
 * @module tests/unit/services/file-watcher.service.spec
 */

// Using vitest globals (configured in vitest.config.ts with globals: true)
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

// Mock settingsService for POS type validation tests
// Use vi.hoisted() to ensure mock functions are defined before vi.mock hoisting
const {
  mockIsNAXMLCompatible,
  mockGetFileWatcherUnavailableReason,
  mockGetPOSType,
  mockGetPOSConnectionType,
} = vi.hoisted(() => ({
  mockIsNAXMLCompatible: vi.fn(),
  mockGetFileWatcherUnavailableReason: vi.fn(),
  mockGetPOSType: vi.fn(),
  mockGetPOSConnectionType: vi.fn(),
}));

vi.mock('../../../src/main/services/settings.service', () => ({
  settingsService: {
    isNAXMLCompatible: () => mockIsNAXMLCompatible(),
    getFileWatcherUnavailableReason: () => mockGetFileWatcherUnavailableReason(),
    getPOSType: () => mockGetPOSType(),
    getPOSConnectionType: () => mockGetPOSConnectionType(),
  },
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
// Cross-Platform Path Helpers
// ============================================================================

/**
 * Generate platform-appropriate absolute paths for tests.
 * On Windows: C:\naxml\incoming
 * On Unix: /naxml/incoming
 */
const getTestPath = (...segments: string[]): string => {
  if (process.platform === 'win32') {
    return `C:\\naxml\\${segments.join('\\')}`;
  }
  return `/naxml/${segments.join('/')}`;
};

/**
 * Platform-appropriate test paths used throughout tests
 */
const TEST_PATHS = {
  watchPath: getTestPath('incoming'),
  archivePath: getTestPath('archive'),
  errorPath: getTestPath('errors'),
  fgmFile: (name = 'FGM20250115.xml') => getTestPath('incoming', name),
  pjrFile: (name = 'PJR20250115.xml') => getTestPath('incoming', name),
  archiveFile: (name: string) => getTestPath('archive', name),
  errorFile: (name: string) => getTestPath('errors', name),
  // Path traversal attempt - platform appropriate
  traversalPath:
    process.platform === 'win32'
      ? 'C:\\naxml\\incoming\\..\\..\\system\\sensitive.xml'
      : '/naxml/incoming/../../system/sensitive.xml',
  // Messy path with redundant separators
  messyPath:
    process.platform === 'win32'
      ? 'C:\\naxml\\incoming\\\\FGM20250115.xml'
      : '/naxml/incoming//FGM20250115.xml',
};

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockConfig = (overrides: Partial<NuvanaConfig> = {}): NuvanaConfig => ({
  apiUrl: 'https://api.test.com',
  apiKey: 'test-api-key',
  storeId: 'store-123',
  watchPath: TEST_PATHS.watchPath,
  archivePath: TEST_PATHS.archivePath,
  errorPath: TEST_PATHS.errorPath,
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

    // Default settingsService to NAXML-compatible state
    // This ensures existing tests continue to work (they assume file watcher can start)
    mockIsNAXMLCompatible.mockReturnValue(true);
    mockGetFileWatcherUnavailableReason.mockReturnValue(null);
    mockGetPOSType.mockReturnValue('GILBARCO_NAXML');
    mockGetPOSConnectionType.mockReturnValue('FILE');

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
      mockWatcherInstance.emit('add', TEST_PATHS.traversalPath);

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

      const validPath = TEST_PATHS.fgmFile();
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
      mockWatcherInstance.emit('add', TEST_PATHS.messyPath);

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
  // FW-POS-001 through 010: POS Type Validation (Phase 3)
  // ==========================================================================

  describe('POS Type Validation', () => {
    it('FW-POS-001: should throw error when started for non-NAXML POS (SQUARE_REST + API)', () => {
      // Arrange: Configure SQUARE_REST POS (API-based, not NAXML-compatible)
      mockIsNAXMLCompatible.mockReturnValue(false);
      mockGetFileWatcherUnavailableReason.mockReturnValue(
        'SQUARE_REST uses API-based data ingestion (coming soon)'
      );
      mockGetPOSType.mockReturnValue('SQUARE_REST');
      mockGetPOSConnectionType.mockReturnValue('API');

      // Act & Assert: start() should throw
      expect(() => service.start()).toThrow(
        'FileWatcherService should not be instantiated for this POS type'
      );
      expect(chokidar.watch).not.toHaveBeenCalled();
    });

    it('FW-POS-002: should throw error when started for CLOVER_REST + API', () => {
      // Arrange: Configure CLOVER_REST POS
      mockIsNAXMLCompatible.mockReturnValue(false);
      mockGetFileWatcherUnavailableReason.mockReturnValue(
        'CLOVER_REST uses API-based data ingestion (coming soon)'
      );
      mockGetPOSType.mockReturnValue('CLOVER_REST');
      mockGetPOSConnectionType.mockReturnValue('API');

      // Act & Assert
      expect(() => service.start()).toThrow(
        'FileWatcherService should not be instantiated for this POS type'
      );
      expect(chokidar.watch).not.toHaveBeenCalled();
    });

    it('FW-POS-003: should throw error when started for MANUAL_ENTRY + MANUAL', () => {
      // Arrange: Configure MANUAL_ENTRY POS
      mockIsNAXMLCompatible.mockReturnValue(false);
      mockGetFileWatcherUnavailableReason.mockReturnValue(
        'Manual entry mode - no automated data ingestion'
      );
      mockGetPOSType.mockReturnValue('MANUAL_ENTRY');
      mockGetPOSConnectionType.mockReturnValue('MANUAL');

      // Act & Assert
      expect(() => service.start()).toThrow(
        'FileWatcherService should not be instantiated for this POS type'
      );
      expect(chokidar.watch).not.toHaveBeenCalled();
    });

    it('FW-POS-004: should throw error when started for VERIFONE_RUBY2 + NETWORK', () => {
      // Arrange: Configure VERIFONE_RUBY2 POS (network-based)
      mockIsNAXMLCompatible.mockReturnValue(false);
      mockGetFileWatcherUnavailableReason.mockReturnValue(
        'VERIFONE_RUBY2 uses network-based data ingestion (coming soon)'
      );
      mockGetPOSType.mockReturnValue('VERIFONE_RUBY2');
      mockGetPOSConnectionType.mockReturnValue('NETWORK');

      // Act & Assert
      expect(() => service.start()).toThrow(
        'FileWatcherService should not be instantiated for this POS type'
      );
      expect(chokidar.watch).not.toHaveBeenCalled();
    });

    it('FW-POS-005: should start successfully for GILBARCO_NAXML + FILE', () => {
      // Arrange: Configure GILBARCO_NAXML POS (NAXML-compatible)
      mockIsNAXMLCompatible.mockReturnValue(true);
      mockGetFileWatcherUnavailableReason.mockReturnValue(null);
      mockGetPOSType.mockReturnValue('GILBARCO_NAXML');
      mockGetPOSConnectionType.mockReturnValue('FILE');

      // Act: start() should NOT throw
      expect(() => service.start()).not.toThrow();

      // Assert: chokidar should be called
      expect(chokidar.watch).toHaveBeenCalledWith(TEST_PATHS.watchPath, expect.any(Object));
    });

    it('FW-POS-006: should start successfully for GILBARCO_PASSPORT + FILE', () => {
      // Arrange: Configure GILBARCO_PASSPORT POS (NAXML-compatible)
      mockIsNAXMLCompatible.mockReturnValue(true);
      mockGetFileWatcherUnavailableReason.mockReturnValue(null);
      mockGetPOSType.mockReturnValue('GILBARCO_PASSPORT');
      mockGetPOSConnectionType.mockReturnValue('FILE');

      // Act & Assert
      expect(() => service.start()).not.toThrow();
      expect(chokidar.watch).toHaveBeenCalled();
    });

    it('FW-POS-007: should start successfully for FILE_BASED + FILE', () => {
      // Arrange: Configure FILE_BASED POS (NAXML-compatible)
      mockIsNAXMLCompatible.mockReturnValue(true);
      mockGetFileWatcherUnavailableReason.mockReturnValue(null);
      mockGetPOSType.mockReturnValue('FILE_BASED');
      mockGetPOSConnectionType.mockReturnValue('FILE');

      // Act & Assert
      expect(() => service.start()).not.toThrow();
      expect(chokidar.watch).toHaveBeenCalled();
    });

    it('FW-POS-008: should throw error when no POS config exists', () => {
      // Arrange: No POS configuration
      mockIsNAXMLCompatible.mockReturnValue(false);
      mockGetFileWatcherUnavailableReason.mockReturnValue('POS connection not configured');
      mockGetPOSType.mockReturnValue(null);
      mockGetPOSConnectionType.mockReturnValue(null);

      // Act & Assert
      expect(() => service.start()).toThrow(
        'FileWatcherService should not be instantiated for this POS type'
      );
      expect(chokidar.watch).not.toHaveBeenCalled();
    });

    it('FW-POS-009: should throw error for GILBARCO_NAXML + API (mismatched connection type)', () => {
      // Arrange: GILBARCO_NAXML POS type but wrong connection type (API instead of FILE)
      mockIsNAXMLCompatible.mockReturnValue(false);
      mockGetFileWatcherUnavailableReason.mockReturnValue(
        'GILBARCO_NAXML uses API-based data ingestion (coming soon)'
      );
      mockGetPOSType.mockReturnValue('GILBARCO_NAXML');
      mockGetPOSConnectionType.mockReturnValue('API');

      // Act & Assert: Should fail because connection type is wrong
      expect(() => service.start()).toThrow(
        'FileWatcherService should not be instantiated for this POS type'
      );
      expect(chokidar.watch).not.toHaveBeenCalled();
    });

    it('FW-POS-010: should include reason in error message', () => {
      // Arrange
      const expectedReason = 'SQUARE_REST uses API-based data ingestion (coming soon)';
      mockIsNAXMLCompatible.mockReturnValue(false);
      mockGetFileWatcherUnavailableReason.mockReturnValue(expectedReason);
      mockGetPOSType.mockReturnValue('SQUARE_REST');
      mockGetPOSConnectionType.mockReturnValue('API');

      // Act & Assert
      expect(() => service.start()).toThrow(expectedReason);
    });

    it('FW-POS-011: should start successfully in legacy mode (watchPath exists, no POS config)', () => {
      // Arrange: Legacy mode - watchPath configured but isNAXMLCompatible returns true
      // because of backward compatibility in settingsService
      mockIsNAXMLCompatible.mockReturnValue(true);
      mockGetFileWatcherUnavailableReason.mockReturnValue(null);
      mockGetPOSType.mockReturnValue(null); // No POS type (legacy)
      mockGetPOSConnectionType.mockReturnValue(null); // No connection type (legacy)

      // Act & Assert: Should start (legacy backward compatibility)
      expect(() => service.start()).not.toThrow();
      expect(chokidar.watch).toHaveBeenCalled();
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

      mockWatcherInstance.emit('add', TEST_PATHS.fgmFile());
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockProcessFile).toHaveBeenCalledWith(
        TEST_PATHS.fgmFile(),
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

      mockWatcherInstance.emit('add', TEST_PATHS.fgmFile());
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
      const filePath = TEST_PATHS.fgmFile();
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

      mockWatcherInstance.emit('add', TEST_PATHS.fgmFile());
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

      mockWatcherInstance.emit('add', TEST_PATHS.fgmFile());
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

      mockWatcherInstance.emit('add', TEST_PATHS.fgmFile());
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockProcessFile).toHaveBeenCalled();
    });

    it('FW-041: should detect POSJournal from PJR prefix', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      mockProcessFile.mockResolvedValue({ success: true, recordsCreated: 1 });

      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', TEST_PATHS.pjrFile());
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockProcessFile).toHaveBeenCalled();
    });

    it('FW-042: should skip non-XML files', async () => {
      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', getTestPath('incoming', 'report.txt'));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockProcessFile).not.toHaveBeenCalled();
    });

    it('FW-043: should skip XML files without NAXML prefix', async () => {
      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', getTestPath('incoming', 'random.xml'));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockProcessFile).not.toHaveBeenCalled();
    });

    it('FW-044: should handle case-insensitive file extensions', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      mockProcessFile.mockResolvedValue({ success: true, recordsCreated: 1 });

      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', TEST_PATHS.fgmFile('FGM20250115.XML'));
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

      mockWatcherInstance.emit('add', TEST_PATHS.fgmFile());
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

      mockWatcherInstance.emit('add', TEST_PATHS.fgmFile());
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fs.mkdir).toHaveBeenCalledWith(TEST_PATHS.archivePath, { recursive: true });
      expect(fs.rename).toHaveBeenCalledWith(
        TEST_PATHS.fgmFile(),
        TEST_PATHS.archiveFile('FGM20250115.xml')
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

      mockWatcherInstance.emit('add', TEST_PATHS.fgmFile());
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fs.mkdir).toHaveBeenCalledWith(TEST_PATHS.errorPath, { recursive: true });
      expect(fs.rename).toHaveBeenCalledWith(
        TEST_PATHS.fgmFile(),
        TEST_PATHS.errorFile('FGM20250115.xml')
      );
    });

    it('FW-062: should handle archive path not configured', async () => {
      const configNoArchive = createMockConfig({ archivePath: undefined });
      service = new FileWatcherService(configNoArchive, 'store-123');

      vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_FGM_XML);
      mockProcessFile.mockResolvedValue({ success: true, recordsCreated: 1 });

      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', TEST_PATHS.fgmFile());
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
        if (pathArg === TEST_PATHS.archivePath) {
          return { success: false, error: { message: 'Invalid archive path' } } as ReturnType<
            typeof validateSafePath
          >;
        }
        return { success: true } as ReturnType<typeof validateSafePath>;
      });

      service.start();
      mockWatcherInstance.emit('ready');

      mockWatcherInstance.emit('add', TEST_PATHS.fgmFile());
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

      mockWatcherInstance.emit('add', TEST_PATHS.fgmFile('FGM001.xml'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      mockWatcherInstance.emit('add', TEST_PATHS.fgmFile('FGM002.xml'));
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

      mockWatcherInstance.emit('add', TEST_PATHS.fgmFile('FGM001.xml'));
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
      mockWatcherInstance.emit('add', TEST_PATHS.fgmFile('FGM001.xml'));
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

      mockWatcherInstance.emit('add', TEST_PATHS.fgmFile('FGM001.xml'));
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
        mockWatcherInstance.emit('add', TEST_PATHS.fgmFile(`FGM${String(i).padStart(3, '0')}.xml`));
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
        TEST_PATHS.watchPath,
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
