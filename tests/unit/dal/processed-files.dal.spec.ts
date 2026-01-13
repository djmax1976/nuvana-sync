/**
 * Processed Files DAL Unit Tests
 *
 * @module tests/unit/dal/processed-files.dal.spec
 * @security SEC-006: Validates parameterized queries
 * @security CDP-001: Validates SHA-256 hash deduplication
 * @security DB-006: Validates store-scoped queries
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database service
const mockPrepare = vi.fn();
const mockTransaction = vi.fn((fn) => () => fn());

vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-uuid-1234'),
}));

import {
  ProcessedFilesDAL,
  type ProcessedFile,
  type ProcessedFileStatus,
} from '../../../src/main/dal/processed-files.dal';

describe('ProcessedFilesDAL', () => {
  let dal: ProcessedFilesDAL;

  const mockFile: ProcessedFile = {
    id: 'file-123',
    store_id: 'store-456',
    file_path: '/data/naxml/2024-01-01/POSLog001.xml',
    file_name: 'POSLog001.xml',
    file_hash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef12345678',
    file_size: 102400,
    document_type: 'POSLog',
    processed_at: '2024-01-01T12:00:00.000Z',
    record_count: 150,
    status: 'SUCCESS' as ProcessedFileStatus,
    error_message: null,
    processing_duration_ms: 1500,
    created_at: '2024-01-01T12:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new ProcessedFilesDAL();
  });

  describe('recordFile', () => {
    it('should create processed file record with all fields', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockFile) });

      const result = dal.recordFile({
        store_id: 'store-456',
        file_path: '/data/naxml/2024-01-01/POSLog001.xml',
        file_name: 'POSLog001.xml',
        file_hash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef12345678',
        file_size: 102400,
        document_type: 'POSLog',
        record_count: 150,
        status: 'SUCCESS',
        processing_duration_ms: 1500,
      });

      expect(result).toEqual(mockFile);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO processed_files')
      );
    });

    it('should use default values for optional fields', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockFile) });

      dal.recordFile({
        store_id: 'store-456',
        file_path: '/data/naxml/file.xml',
        file_name: 'file.xml',
        file_hash: 'hash123',
        file_size: 1024,
        document_type: 'POSLog',
      });

      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String), // id
        'store-456',
        '/data/naxml/file.xml',
        'file.xml',
        'hash123',
        1024,
        'POSLog',
        expect.any(String), // processed_at
        0, // default record_count
        'SUCCESS', // default status
        null, // default error_message
        null, // default processing_duration_ms
        expect.any(String) // created_at
      );
    });

    it('should record failed file with error message', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const failedFile = {
        ...mockFile,
        status: 'FAILED' as ProcessedFileStatus,
        error_message: 'XML parsing error at line 42',
      };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(failedFile) });

      const result = dal.recordFile({
        store_id: 'store-456',
        file_path: '/data/naxml/bad.xml',
        file_name: 'bad.xml',
        file_hash: 'hash456',
        file_size: 512,
        document_type: 'POSLog',
        status: 'FAILED',
        error_message: 'XML parsing error at line 42',
      });

      expect(result.status).toBe('FAILED');
      expect(result.error_message).toBe('XML parsing error at line 42');
    });

    it('should throw if created record cannot be retrieved', () => {
      mockPrepare
        .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) });

      expect(() =>
        dal.recordFile({
          store_id: 'store-456',
          file_path: '/data/naxml/file.xml',
          file_name: 'file.xml',
          file_hash: 'hash123',
          file_size: 1024,
          document_type: 'POSLog',
        })
      ).toThrow('Failed to retrieve created processed file record');
    });
  });

  describe('isFileProcessed', () => {
    it('should return true if file hash exists - CDP-001', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ 1: 1 }),
      });

      const result = dal.isFileProcessed('store-456', 'hash123');

      expect(result).toBe(true);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE store_id = ? AND file_hash = ?')
      );
    });

    it('should return false if file hash not found', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.isFileProcessed('store-456', 'newhash');

      expect(result).toBe(false);
    });

    it('should scope hash check to store - DB-006', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      dal.isFileProcessed('store-456', 'hash123');

      // Should check both store_id AND file_hash
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('store_id = ? AND file_hash = ?')
      );
    });
  });

  describe('findByHash', () => {
    it('should find processed file by hash - CDP-001', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockFile),
      });

      const result = dal.findByHash('store-456', mockFile.file_hash);

      expect(result).toEqual(mockFile);
    });

    it('should return undefined if not found', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.findByHash('store-456', 'nonexistent');

      expect(result).toBeUndefined();
    });
  });

  describe('findByDate', () => {
    it('should find files processed on a specific date - DB-006', () => {
      const files = [mockFile, { ...mockFile, id: 'file-124', file_name: 'POSLog002.xml' }];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(files),
      });

      const result = dal.findByDate('store-456', '2024-01-01');

      expect(result).toHaveLength(2);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE store_id = ? AND DATE(processed_at) = ?')
      );
    });

    it('should return empty array for date with no files', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const result = dal.findByDate('store-456', '2024-12-31');

      expect(result).toEqual([]);
    });
  });

  describe('findByDateRange', () => {
    it('should find files in date range - DB-006', () => {
      const files = [mockFile];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(files),
      });

      const result = dal.findByDateRange('store-456', '2024-01-01', '2024-01-31');

      expect(result).toHaveLength(1);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('DATE(processed_at) >= ? AND DATE(processed_at) <= ?')
      );
    });
  });

  describe('findByDocumentType', () => {
    it('should find files by document type - DB-006', () => {
      const posLogFiles = [mockFile];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(posLogFiles),
      });

      const result = dal.findByDocumentType('store-456', 'POSLog');

      expect(result).toHaveLength(1);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE store_id = ? AND document_type = ?')
      );
    });

    it('should respect limit parameter', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.findByDocumentType('store-456', 'POSLog', 50);

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('LIMIT ?'));
    });

    it('should use default limit of 100', () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValue({ all: mockAll });

      dal.findByDocumentType('store-456', 'POSLog');

      expect(mockAll).toHaveBeenCalledWith('store-456', 'POSLog', 100);
    });
  });

  describe('findFailed', () => {
    it('should find failed files for retry - DB-006', () => {
      const failedFile = { ...mockFile, status: 'FAILED' as ProcessedFileStatus };

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([failedFile]),
      });

      const result = dal.findFailed('store-456');

      expect(result).toHaveLength(1);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("status = 'FAILED'"));
    });

    it('should respect limit parameter', () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValue({ all: mockAll });

      dal.findFailed('store-456', 25);

      expect(mockAll).toHaveBeenCalledWith('store-456', 25);
    });
  });

  describe('findRecent', () => {
    it('should return paginated recent files', () => {
      const files = [mockFile];

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 1 }) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue(files) });

      const result = dal.findRecent('store-456', 50, 0);

      // PaginatedResult uses 'data' property, not 'items'
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should use default pagination values', () => {
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ total: 0 }) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) });

      dal.findRecent('store-456');

      // Should use findByStore with default limit/offset
      expect(mockPrepare).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return processing statistics - DB-006', () => {
      const statsResult = {
        total_files: 100,
        success_count: 95,
        failed_count: 3,
        partial_count: 2,
        total_records: 15000,
        total_size_bytes: 10485760,
        avg_duration_ms: 1234.5,
      };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(statsResult),
      });

      const result = dal.getStats('store-456');

      expect(result).toEqual({
        totalFiles: 100,
        successCount: 95,
        failedCount: 3,
        partialCount: 2,
        totalRecords: 15000,
        totalSizeBytes: 10485760,
        averageDurationMs: 1235, // Rounded
      });
    });

    it('should filter by date range when provided', () => {
      const statsResult = {
        total_files: 10,
        success_count: 10,
        failed_count: 0,
        partial_count: 0,
        total_records: 1500,
        total_size_bytes: 1048576,
        avg_duration_ms: 1000,
      };

      const mockGet = vi.fn().mockReturnValue(statsResult);
      mockPrepare.mockReturnValue({ get: mockGet });

      dal.getStats('store-456', '2024-01-01', '2024-01-31');

      expect(mockGet).toHaveBeenCalledWith('store-456', '2024-01-01', '2024-01-31');
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('DATE(processed_at) >= ? AND DATE(processed_at) <= ?')
      );
    });

    it('should handle zero stats gracefully', () => {
      const emptyStats = {
        total_files: 0,
        success_count: 0,
        failed_count: 0,
        partial_count: 0,
        total_records: 0,
        total_size_bytes: 0,
        avg_duration_ms: 0,
      };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(emptyStats),
      });

      const result = dal.getStats('store-456');

      expect(result.totalFiles).toBe(0);
      expect(result.averageDurationMs).toBe(0);
    });
  });

  describe('getCountsByDocumentType', () => {
    it('should return document type counts as Map', () => {
      const counts = [
        { document_type: 'POSLog', count: 500 },
        { document_type: 'EndOfDay', count: 30 },
        { document_type: 'PriceBook', count: 10 },
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(counts),
      });

      const result = dal.getCountsByDocumentType('store-456');

      expect(result).toBeInstanceOf(Map);
      expect(result.get('POSLog')).toBe(500);
      expect(result.get('EndOfDay')).toBe(30);
      expect(result.get('PriceBook')).toBe(10);
    });

    it('should return empty Map when no files', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const result = dal.getCountsByDocumentType('store-456');

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });
  });

  describe('deleteOldRecords', () => {
    it('should delete records before specified date', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 50 }),
      });

      const result = dal.deleteOldRecords('2023-01-01');

      expect(result).toBe(50);
      // SQL is multi-line, so check key parts separately
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM processed_files')
      );
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('processed_at < ?'));
    });

    it('should return 0 when no records match', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      const result = dal.deleteOldRecords('2020-01-01');

      expect(result).toBe(0);
    });
  });

  describe('updateStatus', () => {
    it('should update file status', () => {
      const updatedFile = { ...mockFile, status: 'PARTIAL' as ProcessedFileStatus };
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(updatedFile) });

      const result = dal.updateStatus('file-123', 'PARTIAL');

      expect(result?.status).toBe('PARTIAL');
    });

    it('should update status with error message', () => {
      const updatedFile = {
        ...mockFile,
        status: 'FAILED' as ProcessedFileStatus,
        error_message: 'Retry failed: connection timeout',
      };
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(updatedFile) });

      const result = dal.updateStatus('file-123', 'FAILED', 'Retry failed: connection timeout');

      expect(result?.status).toBe('FAILED');
      expect(result?.error_message).toBe('Retry failed: connection timeout');
    });

    it('should return undefined if file not found', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      const result = dal.updateStatus('nonexistent', 'SUCCESS');

      expect(result).toBeUndefined();
    });
  });

  describe('Security Compliance', () => {
    describe('SEC-006: Parameterized Queries', () => {
      it('should use parameterized queries for all operations', () => {
        mockPrepare.mockReturnValue({
          run: vi.fn().mockReturnValue({ changes: 1 }),
          get: vi.fn().mockReturnValue(mockFile),
          all: vi.fn().mockReturnValue([mockFile]),
        });

        // Test various operations
        dal.isFileProcessed('store-456', 'hash');
        dal.findByHash('store-456', 'hash');
        dal.findByDate('store-456', '2024-01-01');

        // All queries should use ? placeholders
        const calls = mockPrepare.mock.calls;
        for (const call of calls) {
          const query = call[0] as string;
          // Should not contain string concatenation
          expect(query).not.toMatch(/\+ *['"`]/);
          expect(query).not.toMatch(/['"`] *\+/);
        }
      });

      it('should prevent SQL injection in hash lookup', () => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue(undefined),
        });

        // Attempt SQL injection through hash
        dal.isFileProcessed('store-456', "'; DROP TABLE processed_files; --");

        const query = mockPrepare.mock.calls[0][0] as string;
        expect(query).not.toContain('DROP');
        expect(query).toContain('?');
      });
    });

    describe('CDP-001: File Integrity Hash', () => {
      it('should use file_hash for deduplication checks', () => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue({ 1: 1 }),
        });

        dal.isFileProcessed('store-456', 'sha256hash');

        expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('file_hash = ?'));
      });

      it('should support SHA-256 hash format (64 hex chars)', () => {
        // 64 hex chars = 256 bits = SHA-256
        const sha256Hash = 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456';
        expect(sha256Hash.length).toBe(64);

        mockPrepare
          .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
          .mockReturnValueOnce({
            get: vi.fn().mockReturnValue({ ...mockFile, file_hash: sha256Hash }),
          });

        const result = dal.recordFile({
          store_id: 'store-456',
          file_path: '/path/file.xml',
          file_name: 'file.xml',
          file_hash: sha256Hash,
          file_size: 1024,
          document_type: 'POSLog',
        });

        expect(result.file_hash).toBe(sha256Hash);
      });
    });

    describe('DB-006: Store Isolation', () => {
      it('should scope isFileProcessed to store_id', () => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue(undefined),
        });

        dal.isFileProcessed('store-456', 'hash');

        expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('store_id = ?'));
      });

      it('should scope findByHash to store_id', () => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue(undefined),
        });

        dal.findByHash('store-456', 'hash');

        expect(mockPrepare).toHaveBeenCalledWith(
          expect.stringContaining('store_id = ? AND file_hash = ?')
        );
      });

      it('should scope findByDate to store_id', () => {
        mockPrepare.mockReturnValue({
          all: vi.fn().mockReturnValue([]),
        });

        dal.findByDate('store-456', '2024-01-01');

        expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE store_id = ?'));
      });

      it('should scope findByDocumentType to store_id', () => {
        mockPrepare.mockReturnValue({
          all: vi.fn().mockReturnValue([]),
        });

        dal.findByDocumentType('store-456', 'POSLog');

        expect(mockPrepare).toHaveBeenCalledWith(
          expect.stringContaining('WHERE store_id = ? AND document_type = ?')
        );
      });

      it('should scope getStats to store_id', () => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue({
            total_files: 0,
            success_count: 0,
            failed_count: 0,
            partial_count: 0,
            total_records: 0,
            total_size_bytes: 0,
            avg_duration_ms: 0,
          }),
        });

        dal.getStats('store-456');

        expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE store_id = ?'));
      });

      it('should scope getCountsByDocumentType to store_id', () => {
        mockPrepare.mockReturnValue({
          all: vi.fn().mockReturnValue([]),
        });

        dal.getCountsByDocumentType('store-456');

        expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE store_id = ?'));
      });
    });
  });

  describe('File Status Workflow', () => {
    it('should track SUCCESS status for fully processed files', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const successFile = { ...mockFile, status: 'SUCCESS' as ProcessedFileStatus };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(successFile) });

      const result = dal.recordFile({
        store_id: 'store-456',
        file_path: '/path/file.xml',
        file_name: 'file.xml',
        file_hash: 'hash',
        file_size: 1024,
        document_type: 'POSLog',
        status: 'SUCCESS',
      });

      expect(result.status).toBe('SUCCESS');
    });

    it('should track FAILED status with error message', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const failedFile = {
        ...mockFile,
        status: 'FAILED' as ProcessedFileStatus,
        error_message: 'Parse error',
      };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(failedFile) });

      const result = dal.recordFile({
        store_id: 'store-456',
        file_path: '/path/file.xml',
        file_name: 'file.xml',
        file_hash: 'hash',
        file_size: 1024,
        document_type: 'POSLog',
        status: 'FAILED',
        error_message: 'Parse error',
      });

      expect(result.status).toBe('FAILED');
      expect(result.error_message).toBe('Parse error');
    });

    it('should track PARTIAL status for incomplete processing', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const partialFile = {
        ...mockFile,
        status: 'PARTIAL' as ProcessedFileStatus,
        error_message: '5 of 10 records processed',
      };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(partialFile) });

      const result = dal.recordFile({
        store_id: 'store-456',
        file_path: '/path/file.xml',
        file_name: 'file.xml',
        file_hash: 'hash',
        file_size: 1024,
        document_type: 'POSLog',
        status: 'PARTIAL',
        error_message: '5 of 10 records processed',
      });

      expect(result.status).toBe('PARTIAL');
    });
  });
});
