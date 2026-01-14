/**
 * Parser Service Unit Tests
 *
 * Tests for NAXML document routing, DAL storage, and sync queue integration.
 *
 * Test Coverage Matrix:
 * - PS-001 through 010: File Processing
 * - PS-020 through 030: Document Type Routing
 * - PS-040 through 050: Security Validation (SEC-015)
 * - PS-060 through 070: Sync Queue Integration
 * - PS-080 through 090: Error Handling
 *
 * @module tests/unit/services/parser.service.spec
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Declare mock functions that will be assigned after imports
let mockIsFileProcessed: ReturnType<typeof vi.fn>;
let mockRecordFile: ReturnType<typeof vi.fn>;
let mockGetOrCreateForDate: ReturnType<typeof vi.fn>;
let mockCreateFromNAXMLFGM: ReturnType<typeof vi.fn>;
let mockCreateFromNAXMLFPM: ReturnType<typeof vi.fn>;
let mockCreateFromNAXMLMSM: ReturnType<typeof vi.fn>;
let mockCreateFromNAXMLMCM: ReturnType<typeof vi.fn>;
let mockCreateFromNAXMLTLM: ReturnType<typeof vi.fn>;
let mockBulkCreateFromNAXMLISM: ReturnType<typeof vi.fn>;
let mockCreateFromNAXMLTPM: ReturnType<typeof vi.fn>;
let mockCreateWithDetails: ReturnType<typeof vi.fn>;
let mockEnqueue: ReturnType<typeof vi.fn>;
let mockParse: ReturnType<typeof vi.fn>;

// Mock all DALs before importing - use inline vi.fn() to avoid hoisting issues
vi.mock('../../../src/main/dal', () => {
  const isFileProcessed = vi.fn();
  const recordFile = vi.fn();
  const enqueue = vi.fn();
  const createFromNAXMLFGM = vi.fn();
  const createFromNAXMLFPM = vi.fn();
  const createFromNAXMLMSM = vi.fn();
  const createFromNAXMLMCM = vi.fn();
  const createFromNAXMLTLM = vi.fn();
  const bulkCreateFromNAXMLISM = vi.fn();
  const createFromNAXMLTPM = vi.fn();
  const getOrCreateForDate = vi.fn();
  const createWithDetails = vi.fn();

  return {
    processedFilesDAL: {
      isFileProcessed,
      recordFile,
    },
    syncQueueDAL: {
      enqueue,
    },
    fuelGradeMovementsDAL: {
      createFromNAXML: createFromNAXMLFGM,
    },
    fuelProductMovementsDAL: {
      createFromNAXML: createFromNAXMLFPM,
    },
    miscellaneousSummariesDAL: {
      createFromNAXML: createFromNAXMLMSM,
    },
    merchandiseMovementsDAL: {
      createFromNAXML: createFromNAXMLMCM,
    },
    taxLevelMovementsDAL: {
      createFromNAXML: createFromNAXMLTLM,
    },
    itemSalesMovementsDAL: {
      bulkCreateFromNAXML: bulkCreateFromNAXMLISM,
    },
    tenderProductMovementsDAL: {
      createFromNAXML: createFromNAXMLTPM,
    },
    shiftsDAL: {
      getOrCreateForDate,
    },
    daySummariesDAL: {
      getOrCreateForDate: vi.fn(),
    },
    transactionsDAL: {
      createWithDetails,
    },
  };
});

// Mock file system
vi.mock('fs/promises', () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
}));

// Mock database service
vi.mock('../../../src/main/services/database.service', () => ({
  withTransaction: vi.fn((fn: () => unknown) => fn()),
}));

// Mock logger
vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock NAXML parser
vi.mock('../../../src/shared/naxml/parser', () => {
  const parse = vi.fn();
  return {
    createNAXMLParser: vi.fn(() => ({
      parse,
    })),
  };
});

// Import after mocks
import * as fs from 'fs/promises';
import { ParserService, createParserService } from '../../../src/main/services/parser.service';
import * as dal from '../../../src/main/dal';
import { createNAXMLParser } from '../../../src/shared/naxml/parser';

// ============================================================================
// Test Fixtures
// ============================================================================

const SAMPLE_FGM_PARSE_RESULT = {
  documentType: 'FuelGradeMovement',
  data: {
    movementHeader: {
      businessDate: '2025-01-15',
      primaryReportPeriod: 99,
    },
    salesMovementHeader: {},
    fgmDetails: [
      {
        fuelGradeId: 'UNLEADED',
        fgmTenderSummary: { salesAmount: 100.0 },
        fgmPositionSummary: { salesVolume: 50.0 },
      },
      {
        fuelGradeId: 'PREMIUM',
        fgmTenderSummary: { salesAmount: 150.0 },
        fgmPositionSummary: { salesVolume: 40.0 },
      },
    ],
  },
};

const SAMPLE_ISM_PARSE_RESULT = {
  documentType: 'ItemSalesMovement',
  data: {
    movementHeader: {
      businessDate: '2025-01-15',
      primaryReportPeriod: 99,
    },
    salesMovementHeader: {},
    ismDetails: [
      { itemCode: 'SKU001', itemDescription: 'Item 1', ismSalesTotals: { itemSalesAmount: 10.0 } },
      { itemCode: 'SKU002', itemDescription: 'Item 2', ismSalesTotals: { itemSalesAmount: 20.0 } },
      { itemCode: 'SKU003', itemDescription: 'Item 3', ismSalesTotals: { itemSalesAmount: 30.0 } },
    ],
  },
};

const SAMPLE_XML = '<?xml version="1.0"?><NAXML/>';

// ============================================================================
// Test Suite
// ============================================================================

describe('ParserService', () => {
  let service: ParserService;
  const TEST_STORE_ID = 'store-123';
  const TEST_FILE_HASH = 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1';

  beforeEach(() => {
    vi.clearAllMocks();

    // Get references to mocked functions from the imported modules
    mockIsFileProcessed = vi.mocked(dal.processedFilesDAL.isFileProcessed);
    mockRecordFile = vi.mocked(dal.processedFilesDAL.recordFile);
    mockEnqueue = vi.mocked(dal.syncQueueDAL.enqueue);
    mockCreateFromNAXMLFGM = vi.mocked(dal.fuelGradeMovementsDAL.createFromNAXML);
    mockCreateFromNAXMLFPM = vi.mocked(dal.fuelProductMovementsDAL.createFromNAXML);
    mockCreateFromNAXMLMSM = vi.mocked(dal.miscellaneousSummariesDAL.createFromNAXML);
    mockCreateFromNAXMLMCM = vi.mocked(dal.merchandiseMovementsDAL.createFromNAXML);
    mockCreateFromNAXMLTLM = vi.mocked(dal.taxLevelMovementsDAL.createFromNAXML);
    mockBulkCreateFromNAXMLISM = vi.mocked(dal.itemSalesMovementsDAL.bulkCreateFromNAXML);
    mockCreateFromNAXMLTPM = vi.mocked(dal.tenderProductMovementsDAL.createFromNAXML);
    mockGetOrCreateForDate = vi.mocked(dal.shiftsDAL.getOrCreateForDate);
    mockCreateWithDetails = vi.mocked(dal.transactionsDAL.createWithDetails);

    // Get parser mock - createNAXMLParser takes options object, not store ID
    const parserInstance = createNAXMLParser();
    mockParse = vi.mocked(parserInstance.parse);

    // Create service
    service = new ParserService(TEST_STORE_ID);

    // Default mock returns
    mockIsFileProcessed.mockReturnValue(false);
    mockRecordFile.mockReturnValue({ id: 'file-record-id' });
    mockGetOrCreateForDate.mockReturnValue({ shift_id: 'shift-123' });
    mockCreateFromNAXMLFGM.mockReturnValue('fgm-record-id');
    mockCreateFromNAXMLFPM.mockReturnValue(['fpm-record-id']);
    mockCreateFromNAXMLMSM.mockReturnValue('msm-record-id');
    mockCreateFromNAXMLMCM.mockReturnValue('mcm-record-id');
    mockCreateFromNAXMLTLM.mockReturnValue('tlm-record-id');
    mockBulkCreateFromNAXMLISM.mockReturnValue(3);
    mockCreateFromNAXMLTPM.mockReturnValue('tpm-record-id');
    mockCreateWithDetails.mockReturnValue({ transaction_id: 'txn-123' });
    mockEnqueue.mockReturnValue({ id: 'queue-item-id' });

    vi.mocked(fs.stat).mockResolvedValue({ size: 1024 } as unknown as Awaited<
      ReturnType<typeof fs.stat>
    >);
    vi.mocked(fs.readFile).mockResolvedValue(SAMPLE_XML);
  });

  // ==========================================================================
  // PS-001 through 010: File Processing
  // ==========================================================================

  describe('File Processing', () => {
    it('PS-001: should process file and return success result', async () => {
      mockParse.mockReturnValue(SAMPLE_FGM_PARSE_RESULT);

      const result = await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      expect(result.success).toBe(true);
      expect(result.documentType).toBe('FuelGradeMovement');
      expect(result.recordsCreated).toBe(2);
      expect(result.fileId).toBe('file-record-id');
    });

    it('PS-002: should skip duplicate files by hash', async () => {
      mockIsFileProcessed.mockReturnValue(true);

      const result = await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      expect(result.success).toBe(true);
      expect(result.error).toContain('Duplicate');
      expect(result.recordsCreated).toBe(0);
      expect(mockParse).not.toHaveBeenCalled();
    });

    it('PS-003: should record successful processing in processed_files', async () => {
      mockParse.mockReturnValue(SAMPLE_FGM_PARSE_RESULT);

      await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      expect(mockRecordFile).toHaveBeenCalledWith(
        expect.objectContaining({
          store_id: TEST_STORE_ID,
          file_hash: TEST_FILE_HASH,
          document_type: 'FuelGradeMovement',
          status: 'SUCCESS',
        })
      );
    });

    it('PS-004: should record failed processing with error message', async () => {
      mockParse.mockImplementation(() => {
        throw new Error('XML parse error');
      });

      const result = await service.processFile('/path/to/invalid.xml', TEST_FILE_HASH);

      expect(result.success).toBe(false);
      expect(result.error).toBe('XML parse error');
      expect(mockRecordFile).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FAILED',
          error_message: 'XML parse error',
        })
      );
    });

    it('PS-005: should track processing duration', async () => {
      mockParse.mockReturnValue(SAMPLE_FGM_PARSE_RESULT);

      const result = await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      expect(result.processingDurationMs).toBeGreaterThanOrEqual(0);
      expect(mockRecordFile).toHaveBeenCalledWith(
        expect.objectContaining({
          processing_duration_ms: expect.any(Number),
        })
      );
    });
  });

  // ==========================================================================
  // PS-020 through 030: Document Type Routing
  // ==========================================================================

  describe('Document Type Routing', () => {
    it('PS-020: should route FuelGradeMovement to fuelGradeMovementsDAL', async () => {
      mockParse.mockReturnValue(SAMPLE_FGM_PARSE_RESULT);

      await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      expect(mockCreateFromNAXMLFGM).toHaveBeenCalledTimes(2); // Two FGM details
      expect(mockCreateFromNAXMLFGM).toHaveBeenCalledWith(
        TEST_STORE_ID,
        '2025-01-15',
        expect.objectContaining({ fuelGradeId: 'UNLEADED' }),
        TEST_FILE_HASH,
        undefined // No shift for period 99
      );
    });

    it('PS-021: should route ItemSalesMovement to itemSalesMovementsDAL with bulk insert', async () => {
      mockParse.mockReturnValue(SAMPLE_ISM_PARSE_RESULT);

      await service.processFile('/path/to/ISM20250115.xml', TEST_FILE_HASH);

      expect(mockBulkCreateFromNAXMLISM).toHaveBeenCalledWith(
        TEST_STORE_ID,
        '2025-01-15',
        expect.arrayContaining([
          expect.objectContaining({ itemCode: 'SKU001' }),
          expect.objectContaining({ itemCode: 'SKU002' }),
          expect.objectContaining({ itemCode: 'SKU003' }),
        ]),
        TEST_FILE_HASH,
        undefined
      );
    });

    it('PS-022: should route FuelProductMovement to fuelProductMovementsDAL', async () => {
      const fpmResult = {
        documentType: 'FuelProductMovement',
        data: {
          movementHeader: { businessDate: '2025-01-15' },
          fpmDetails: [{ fuelProductId: 'PRODUCT1', fpmNonResettableTotals: [] }],
        },
      };
      mockParse.mockReturnValue(fpmResult);

      await service.processFile('/path/to/FPM20250115.xml', TEST_FILE_HASH);

      expect(mockCreateFromNAXMLFPM).toHaveBeenCalled();
    });

    it('PS-023: should route MiscellaneousSummaryMovement to miscellaneousSummariesDAL', async () => {
      const msmResult = {
        documentType: 'MiscellaneousSummaryMovement',
        data: {
          movementHeader: { businessDate: '2025-01-15' },
          salesMovementHeader: {},
          msmDetails: [{ miscellaneousSummaryCodes: { code: 'PAYOUT' }, msmSalesTotals: {} }],
        },
      };
      mockParse.mockReturnValue(msmResult);

      await service.processFile('/path/to/MSM20250115.xml', TEST_FILE_HASH);

      expect(mockCreateFromNAXMLMSM).toHaveBeenCalled();
    });

    it('PS-024: should route MerchandiseCodeMovement to merchandiseMovementsDAL', async () => {
      const mcmResult = {
        documentType: 'MerchandiseCodeMovement',
        data: {
          movementHeader: { businessDate: '2025-01-15' },
          salesMovementHeader: {},
          mcmDetails: [
            {
              merchandiseCode: { merchandiseCodeValue: { departmentId: 'DEPT1' } },
              mcmSalesTotals: {},
            },
          ],
        },
      };
      mockParse.mockReturnValue(mcmResult);

      await service.processFile('/path/to/MCM20250115.xml', TEST_FILE_HASH);

      expect(mockCreateFromNAXMLMCM).toHaveBeenCalled();
    });

    it('PS-025: should route TaxLevelMovement to taxLevelMovementsDAL', async () => {
      const tlmResult = {
        documentType: 'TaxLevelMovement',
        data: {
          movementHeader: { businessDate: '2025-01-15' },
          salesMovementHeader: {},
          tlmDetails: [{ taxLevelId: 'TAX1', tlmSalesTotals: { taxAmount: 5.0 } }],
        },
      };
      mockParse.mockReturnValue(tlmResult);

      await service.processFile('/path/to/TLM20250115.xml', TEST_FILE_HASH);

      expect(mockCreateFromNAXMLTLM).toHaveBeenCalled();
    });

    it('PS-026: should route TankProductMovement to tenderProductMovementsDAL', async () => {
      const tpmResult = {
        documentType: 'TankProductMovement',
        data: {
          movementHeader: { businessDate: '2025-01-15' },
          salesMovementHeader: {},
          tpmDetails: [
            { tankId: 'TANK1', productId: 'PROD1', tpmInventoryData: {}, tpmSalesData: {} },
          ],
        },
      };
      mockParse.mockReturnValue(tpmResult);

      await service.processFile('/path/to/TPM20250115.xml', TEST_FILE_HASH);

      expect(mockCreateFromNAXMLTPM).toHaveBeenCalled();
    });

    it('PS-027: should skip unknown document types', async () => {
      mockParse.mockReturnValue({
        documentType: 'UnknownType',
        data: {},
      });

      const result = await service.processFile('/path/to/UNKNOWN.xml', TEST_FILE_HASH);

      expect(result.recordsCreated).toBe(0);
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('PS-028: should create shift for shift-level reports (period 98)', async () => {
      const fgmShiftResult = {
        ...SAMPLE_FGM_PARSE_RESULT,
        data: {
          ...SAMPLE_FGM_PARSE_RESULT.data,
          movementHeader: {
            businessDate: '2025-01-15',
            primaryReportPeriod: 98, // Shift-level
          },
        },
      };
      mockParse.mockReturnValue(fgmShiftResult);

      await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      expect(mockGetOrCreateForDate).toHaveBeenCalledWith(TEST_STORE_ID, '2025-01-15');
      expect(mockCreateFromNAXMLFGM).toHaveBeenCalledWith(
        TEST_STORE_ID,
        '2025-01-15',
        expect.any(Object),
        TEST_FILE_HASH,
        'shift-123' // Should pass shift ID
      );
    });
  });

  // ==========================================================================
  // PS-040 through 050: Security Validation (SEC-015)
  // ==========================================================================

  describe('Security Validation (SEC-015)', () => {
    it('PS-040: should reject files exceeding 100MB size limit', async () => {
      vi.mocked(fs.stat).mockResolvedValue({
        size: 101 * 1024 * 1024, // 101MB
      } as unknown as Awaited<ReturnType<typeof fs.stat>>);

      const result = await service.processFile('/path/to/huge.xml', TEST_FILE_HASH);

      expect(result.success).toBe(false);
      expect(result.error).toContain('maximum size limit');
      expect(mockParse).not.toHaveBeenCalled();
    });

    it('PS-041: should accept files at exactly 100MB', async () => {
      vi.mocked(fs.stat).mockResolvedValue({
        size: 100 * 1024 * 1024, // Exactly 100MB
      } as unknown as Awaited<ReturnType<typeof fs.stat>>);
      mockParse.mockReturnValue(SAMPLE_FGM_PARSE_RESULT);

      const result = await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      expect(result.success).toBe(true);
      expect(mockParse).toHaveBeenCalled();
    });

    it('PS-042: should check file size before reading content', async () => {
      vi.mocked(fs.stat).mockResolvedValue({
        size: 200 * 1024 * 1024, // 200MB - over limit
      } as unknown as Awaited<ReturnType<typeof fs.stat>>);

      await service.processFile('/path/to/huge.xml', TEST_FILE_HASH);

      // fs.readFile should not be called if size check fails
      expect(fs.readFile).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // PS-060 through 070: Sync Queue Integration
  // ==========================================================================

  describe('Sync Queue Integration', () => {
    it('PS-060: should enqueue each created record for sync', async () => {
      mockParse.mockReturnValue(SAMPLE_FGM_PARSE_RESULT);

      await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // 2 FGM details = 2 enqueue calls
      expect(mockEnqueue).toHaveBeenCalledTimes(2);
      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          store_id: TEST_STORE_ID,
          entity_type: 'fuel_grade_movement',
          operation: 'CREATE',
        })
      );
    });

    it('PS-061: should enqueue ISM as batch to prevent queue explosion', async () => {
      mockParse.mockReturnValue(SAMPLE_ISM_PARSE_RESULT);

      await service.processFile('/path/to/ISM20250115.xml', TEST_FILE_HASH);

      // Should only enqueue once for the batch, not per item
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'item_sales_movement_batch',
          payload: expect.objectContaining({
            count: 3,
            fileHash: TEST_FILE_HASH,
          }),
        })
      );
    });

    it('PS-062: should not enqueue if no records created', async () => {
      mockParse.mockReturnValue({
        documentType: 'FuelGradeMovement',
        data: {
          movementHeader: { businessDate: '2025-01-15' },
          fgmDetails: [], // Empty
        },
      });

      await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('PS-063: should include correct entity_id in queue payload', async () => {
      mockCreateFromNAXMLFGM.mockReturnValue('specific-fgm-id');
      mockParse.mockReturnValue({
        documentType: 'FuelGradeMovement',
        data: {
          movementHeader: { businessDate: '2025-01-15' },
          fgmDetails: [{ fuelGradeId: 'UNLEADED' }],
        },
      });

      await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_id: 'specific-fgm-id',
        })
      );
    });
  });

  // ==========================================================================
  // PS-080 through 090: Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('PS-080: should handle file read errors', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT: file not found'));

      const result = await service.processFile('/path/to/missing.xml', TEST_FILE_HASH);

      expect(result.success).toBe(false);
      expect(result.error).toContain('file not found');
    });

    it('PS-081: should handle parser errors', async () => {
      mockParse.mockImplementation(() => {
        throw new Error('Invalid XML structure');
      });

      const result = await service.processFile('/path/to/invalid.xml', TEST_FILE_HASH);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid XML structure');
    });

    it('PS-082: should handle DAL errors during storage', async () => {
      mockParse.mockReturnValue(SAMPLE_FGM_PARSE_RESULT);
      mockCreateFromNAXMLFGM.mockImplementation(() => {
        throw new Error('Database constraint violation');
      });

      const result = await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database constraint violation');
    });

    it('PS-083: should handle stat errors', async () => {
      vi.mocked(fs.stat).mockRejectedValue(new Error('Permission denied'));

      const result = await service.processFile('/path/to/noaccess.xml', TEST_FILE_HASH);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
    });

    it('PS-084: should record failed status even when recording fails', async () => {
      mockParse.mockImplementation(() => {
        throw new Error('Parse error');
      });
      mockRecordFile.mockImplementation(() => {
        throw new Error('DB write error');
      });

      // Should not throw, but return error result
      const result = await service.processFile('/path/to/bad.xml', TEST_FILE_HASH);

      // Original error should be preserved
      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // Process Content (Direct XML)
  // ==========================================================================

  describe('processContent', () => {
    it('should process XML content directly without file system', async () => {
      mockParse.mockReturnValue(SAMPLE_FGM_PARSE_RESULT);

      const count = await service.processContent(SAMPLE_XML, TEST_FILE_HASH, 'FGM20250115.xml');

      expect(count).toBe(2);
      expect(fs.stat).not.toHaveBeenCalled();
      expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('should skip duplicate content by hash', async () => {
      mockIsFileProcessed.mockReturnValue(true);

      const count = await service.processContent(SAMPLE_XML, TEST_FILE_HASH, 'FGM20250115.xml');

      expect(count).toBe(0);
      expect(mockParse).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Factory Function
  // ==========================================================================

  describe('createParserService', () => {
    it('should create ParserService instance with store ID', () => {
      const instance = createParserService('store-456');

      expect(instance).toBeInstanceOf(ParserService);
    });
  });
});
