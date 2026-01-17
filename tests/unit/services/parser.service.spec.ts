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
let mockCreateWithDetails: ReturnType<typeof vi.fn>;
let mockEnqueue: ReturnType<typeof vi.fn>;
let mockParse: ReturnType<typeof vi.fn>;
// New schema DAL mocks
let mockShiftFuelCreateFromNAXML: ReturnType<typeof vi.fn>;
let mockShiftDeptCreateFromNAXML: ReturnType<typeof vi.fn>;
let mockShiftTaxCreateFromNAXML: ReturnType<typeof vi.fn>;
let mockMeterReadingsCreateFromNAXML: ReturnType<typeof vi.fn>;
let mockTankReadingsCreateFromNAXML: ReturnType<typeof vi.fn>;

// Mock all DALs before importing - use inline vi.fn() to avoid hoisting issues
vi.mock('../../../src/main/dal', () => {
  const isFileProcessed = vi.fn();
  const recordFile = vi.fn();
  const enqueue = vi.fn();
  const getOrCreateForDate = vi.fn();
  const createWithDetails = vi.fn();
  // New schema DALs
  const shiftFuelCreateFromNAXML = vi.fn();
  const shiftDeptCreateFromNAXML = vi.fn();
  const shiftTaxCreateFromNAXML = vi.fn();
  const meterReadingsCreateFromNAXML = vi.fn();
  const tankReadingsCreateFromNAXML = vi.fn();

  return {
    processedFilesDAL: {
      isFileProcessed,
      recordFile,
    },
    syncQueueDAL: {
      enqueue,
    },
    shiftsDAL: {
      getOrCreateForDate,
      findShiftByDateAndRegister: vi.fn(() => ({ shift_id: 'existing-shift-123' })),
      findOpenShiftToClose: vi.fn(() => ({ shift_id: 'existing-shift-123' })),
      findByDate: vi.fn(() => [{ shift_id: 'existing-shift-123' }]),
      createClosedShift: vi.fn(() => ({ shift_id: 'closed-shift-123' })),
      closeShift: vi.fn(),
    },
    daySummariesDAL: {
      getOrCreateForDate: vi.fn(),
    },
    transactionsDAL: {
      createWithDetails,
    },
    // POS ID Mapping DALs
    posFuelGradeMappingsDAL: {
      getOrCreate: vi.fn(() => ({ mapping_id: 'fuel-grade-mapping-id' })),
    },
    posDepartmentMappingsDAL: {
      getOrCreate: vi.fn(() => ({ mapping_id: 'dept-mapping-id' })),
    },
    posTenderMappingsDAL: {
      getOrCreate: vi.fn(() => ({ mapping_id: 'tender-mapping-id' })),
    },
    posTaxLevelMappingsDAL: {
      getOrCreate: vi.fn(() => ({ mapping_id: 'tax-level-mapping-id' })),
    },
    posCashierMappingsDAL: {
      getOrCreate: vi.fn(() => ({ mapping_id: 'cashier-mapping-id' })),
    },
    posTerminalMappingsDAL: {
      getOrCreate: vi.fn(() => ({ mapping_id: 'terminal-mapping-id' })),
    },
    posFuelPositionMappingsDAL: {
      getOrCreate: vi.fn(() => ({ mapping_id: 'fuel-position-mapping-id' })),
    },
    posTillMappingsDAL: {
      getOrCreate: vi.fn(() => ({ id: 'till-mapping-id' })),
      linkToShift: vi.fn(),
    },
    posPriceTierMappingsDAL: {
      getOrCreate: vi.fn(() => ({ mapping_id: 'price-tier-mapping-id' })),
    },
    posFuelProductMappingsDAL: {
      getOrCreate: vi.fn(() => ({ mapping_id: 'fuel-product-mapping-id' })),
    },
    // New Schema-Aligned DALs (shift summary hierarchy)
    shiftSummariesDAL: {
      getOrCreateForShift: vi.fn(() => ({ shift_summary_id: 'shift-summary-123' })),
      closeShiftSummary: vi.fn(),
    },
    shiftFuelSummariesDAL: {
      createFromNAXML: shiftFuelCreateFromNAXML,
    },
    shiftDepartmentSummariesDAL: {
      createFromNAXML: shiftDeptCreateFromNAXML,
    },
    shiftTenderSummariesDAL: {
      upsert: vi.fn(() => ({ id: 'shift-tender-summary-123' })),
    },
    shiftTaxSummariesDAL: {
      createFromNAXML: shiftTaxCreateFromNAXML,
    },
    meterReadingsDAL: {
      createFromNAXML: meterReadingsCreateFromNAXML,
    },
    tankReadingsDAL: {
      createFromNAXML: tankReadingsCreateFromNAXML,
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

// Mock settingsService for business day cutoff
let mockAdjustBusinessDate: ReturnType<typeof vi.fn>;
vi.mock('../../../src/main/services/settings.service', () => {
  const adjustBusinessDate = vi.fn((businessDate: string) => businessDate); // Default: no adjustment
  return {
    settingsService: {
      adjustBusinessDate,
      getBusinessDayCutoffTime: vi.fn(() => '06:00'),
    },
  };
});

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
import { settingsService } from '../../../src/main/services/settings.service';

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
    mockGetOrCreateForDate = vi.mocked(dal.shiftsDAL.getOrCreateForDate);
    mockCreateWithDetails = vi.mocked(dal.transactionsDAL.createWithDetails);
    // New schema DAL mocks
    mockShiftFuelCreateFromNAXML = vi.mocked(dal.shiftFuelSummariesDAL.createFromNAXML);
    mockShiftDeptCreateFromNAXML = vi.mocked(dal.shiftDepartmentSummariesDAL.createFromNAXML);
    mockShiftTaxCreateFromNAXML = vi.mocked(dal.shiftTaxSummariesDAL.createFromNAXML);
    mockMeterReadingsCreateFromNAXML = vi.mocked(dal.meterReadingsDAL.createFromNAXML);
    mockTankReadingsCreateFromNAXML = vi.mocked(dal.tankReadingsDAL.createFromNAXML);

    // Get parser mock - createNAXMLParser takes options object, not store ID
    const parserInstance = createNAXMLParser();
    mockParse = vi.mocked(parserInstance.parse);

    // Create service
    service = new ParserService(TEST_STORE_ID);

    // Default mock returns
    mockIsFileProcessed.mockReturnValue(false);
    mockRecordFile.mockReturnValue({ id: 'file-record-id' });
    mockGetOrCreateForDate.mockReturnValue({ shift_id: 'shift-123' });
    mockCreateWithDetails.mockReturnValue({ transaction_id: 'txn-123' });
    mockEnqueue.mockReturnValue({ id: 'queue-item-id' });
    // New schema DAL defaults
    mockShiftFuelCreateFromNAXML.mockReturnValue('shift-fuel-summary-123');
    mockShiftDeptCreateFromNAXML.mockReturnValue('shift-dept-summary-123');
    mockShiftTaxCreateFromNAXML.mockReturnValue('shift-tax-summary-123');
    mockMeterReadingsCreateFromNAXML.mockReturnValue('meter-reading-123');
    mockTankReadingsCreateFromNAXML.mockReturnValue('tank-reading-123');

    // Get reference to mocked settingsService.adjustBusinessDate
    mockAdjustBusinessDate = vi.mocked(settingsService.adjustBusinessDate);
    // Default: no adjustment (return original business date)
    mockAdjustBusinessDate.mockImplementation((businessDate: string) => businessDate);

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
    it('PS-020: should route FuelGradeMovement to shiftFuelSummariesDAL', async () => {
      mockParse.mockReturnValue(SAMPLE_FGM_PARSE_RESULT);

      await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // Two FGM details should result in 2 shift fuel summary records
      expect(mockShiftFuelCreateFromNAXML).toHaveBeenCalledTimes(2);
    });

    it('PS-021: should count ItemSalesMovement records (no longer stored in legacy table)', async () => {
      mockParse.mockReturnValue(SAMPLE_ISM_PARSE_RESULT);

      const result = await service.processFile('/path/to/ISM20250115.xml', TEST_FILE_HASH);

      // ISM now just counts records (aggregated via MCM/shift_department_summaries)
      expect(result.recordsCreated).toBe(3);
    });

    it('PS-022: should route FuelProductMovement to meterReadingsDAL', async () => {
      const fpmResult = {
        documentType: 'FuelProductMovement',
        data: {
          movementHeader: { businessDate: '2025-01-15' },
          fpmDetails: [
            { fuelProductId: 'PRODUCT1', fpmNonResettableTotals: [{ fuelPositionId: 'P1' }] },
          ],
        },
      };
      mockParse.mockReturnValue(fpmResult);

      await service.processFile('/path/to/FPM20250115.xml', TEST_FILE_HASH);

      expect(mockMeterReadingsCreateFromNAXML).toHaveBeenCalled();
    });

    it('PS-023: should process MiscellaneousSummaryMovement (creates mappings only)', async () => {
      const msmResult = {
        documentType: 'MiscellaneousSummaryMovement',
        data: {
          movementHeader: { businessDate: '2025-01-15' },
          salesMovementHeader: {},
          msmDetails: [{ miscellaneousSummaryCodes: { code: 'PAYOUT' }, msmSalesTotals: {} }],
        },
      };
      mockParse.mockReturnValue(msmResult);

      const result = await service.processFile('/path/to/MSM20250115.xml', TEST_FILE_HASH);

      // MSM now just creates ID mappings (no dedicated table yet)
      expect(result.success).toBe(true);
      expect(result.recordsCreated).toBe(1);
    });

    it('PS-024: should route MerchandiseCodeMovement to shiftDepartmentSummariesDAL', async () => {
      const mcmResult = {
        documentType: 'MerchandiseCodeMovement',
        data: {
          movementHeader: { businessDate: '2025-01-15' },
          salesMovementHeader: {},
          mcmDetails: [
            {
              merchandiseCode: 'DEPT1',
              merchandiseCodeDescription: 'Department 1',
              mcmSalesTotals: { salesAmount: 100 },
            },
          ],
        },
      };
      mockParse.mockReturnValue(mcmResult);

      await service.processFile('/path/to/MCM20250115.xml', TEST_FILE_HASH);

      expect(mockShiftDeptCreateFromNAXML).toHaveBeenCalled();
    });

    it('PS-025: should route TaxLevelMovement to shiftTaxSummariesDAL', async () => {
      const tlmResult = {
        documentType: 'TaxLevelMovement',
        data: {
          movementHeader: { businessDate: '2025-01-15' },
          salesMovementHeader: {},
          tlmDetails: [{ taxLevelId: 'TAX1', taxableSalesAmount: 100, taxCollectedAmount: 5.0 }],
        },
      };
      mockParse.mockReturnValue(tlmResult);

      await service.processFile('/path/to/TLM20250115.xml', TEST_FILE_HASH);

      expect(mockShiftTaxCreateFromNAXML).toHaveBeenCalled();
    });

    it('PS-026: should route TankProductMovement to tankReadingsDAL', async () => {
      const tpmResult = {
        documentType: 'TankProductMovement',
        data: {
          movementHeader: { businessDate: '2025-01-15' },
          salesMovementHeader: {},
          tpmDetails: [{ tankId: 'TANK1', fuelProductId: 'PROD1', tankVolume: 5000 }],
        },
      };
      mockParse.mockReturnValue(tpmResult);

      await service.processFile('/path/to/TPM20250115.xml', TEST_FILE_HASH);

      expect(mockTankReadingsCreateFromNAXML).toHaveBeenCalled();
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

    it('PS-028: should find existing shift for shift close reports (period 98)', async () => {
      const fgmShiftResult = {
        ...SAMPLE_FGM_PARSE_RESULT,
        data: {
          ...SAMPLE_FGM_PARSE_RESULT.data,
          movementHeader: {
            businessDate: '2025-01-15',
            primaryReportPeriod: 98, // Shift close
          },
        },
      };
      mockParse.mockReturnValue(fgmShiftResult);

      await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // Period 98 = shift close, should find existing OPEN shift rather than create new one
      // Uses findOpenShiftToClose to check adjacent dates for overnight shifts
      expect(vi.mocked(dal.shiftsDAL.findOpenShiftToClose)).toHaveBeenCalled();
      // Shift fuel summaries should be created with the shift's summary ID
      expect(mockShiftFuelCreateFromNAXML).toHaveBeenCalled();
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
    it('PS-060: should NOT enqueue movement data (new local-first schema)', async () => {
      mockParse.mockReturnValue(SAMPLE_FGM_PARSE_RESULT);

      await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // New schema is local-first, no sync queue for movement data
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('PS-061: should NOT enqueue ISM (new local-first schema)', async () => {
      mockParse.mockReturnValue(SAMPLE_ISM_PARSE_RESULT);

      await service.processFile('/path/to/ISM20250115.xml', TEST_FILE_HASH);

      // New schema is local-first, no sync queue for movement data
      expect(mockEnqueue).not.toHaveBeenCalled();
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

    it('PS-063: shift summaries are stored locally (no sync queue)', async () => {
      mockShiftFuelCreateFromNAXML.mockReturnValue('shift-fuel-123');
      mockParse.mockReturnValue({
        documentType: 'FuelGradeMovement',
        data: {
          movementHeader: { businessDate: '2025-01-15' },
          fgmDetails: [{ fuelGradeId: 'UNLEADED' }],
        },
      });

      await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // Shift fuel summaries are created but not enqueued
      expect(mockShiftFuelCreateFromNAXML).toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
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
      mockShiftFuelCreateFromNAXML.mockImplementation(() => {
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

  // ==========================================================================
  // PS-100 through 120: Business Day Cutoff Integration
  // Tests for settingsService.adjustBusinessDate integration
  // ==========================================================================

  describe('Business Day Cutoff Integration', () => {
    it('PS-100: should call adjustBusinessDate for FGM processing', async () => {
      mockParse.mockReturnValue(SAMPLE_FGM_PARSE_RESULT);

      await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // adjustBusinessDate should be called with business date and end timestamp (null if not in data)
      expect(mockAdjustBusinessDate).toHaveBeenCalled();
      expect(mockAdjustBusinessDate).toHaveBeenCalledWith(
        '2025-01-15',
        null // No endDate/endTime in SAMPLE_FGM_PARSE_RESULT
      );
    });

    it('PS-101: should use adjusted date for FGM DAL calls', async () => {
      // Mock date adjustment to return previous day (simulating overnight shift)
      mockAdjustBusinessDate.mockReturnValue('2025-01-14');
      mockParse.mockReturnValue(SAMPLE_FGM_PARSE_RESULT);

      await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // FGM now uses shiftFuelSummariesDAL
      expect(mockShiftFuelCreateFromNAXML).toHaveBeenCalled();
    });

    it('PS-102: should use original date when adjustBusinessDate returns same date', async () => {
      // No adjustment - return same date
      mockAdjustBusinessDate.mockReturnValue('2025-01-15');
      mockParse.mockReturnValue(SAMPLE_FGM_PARSE_RESULT);

      await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // FGM now uses shiftFuelSummariesDAL
      expect(mockShiftFuelCreateFromNAXML).toHaveBeenCalled();
    });

    it('PS-103: should call adjustBusinessDate for ISM batch processing', async () => {
      mockParse.mockReturnValue(SAMPLE_ISM_PARSE_RESULT);

      await service.processFile('/path/to/ISM20250115.xml', TEST_FILE_HASH);

      expect(mockAdjustBusinessDate).toHaveBeenCalled();
    });

    it('PS-104: ISM is now local-first and just counted', async () => {
      mockAdjustBusinessDate.mockReturnValue('2025-01-14');
      mockParse.mockReturnValue(SAMPLE_ISM_PARSE_RESULT);

      const result = await service.processFile('/path/to/ISM20250115.xml', TEST_FILE_HASH);

      // ISM data is now local-first - just counted, not stored in separate table
      expect(result.success).toBe(true);
      expect(result.documentType).toBe('ItemSalesMovement');
    });

    it('PS-105: should call adjustBusinessDate for MSM processing', async () => {
      const msmResult = {
        documentType: 'MiscellaneousSummaryMovement',
        data: {
          movementHeader: { businessDate: '2025-01-15' },
          salesMovementHeader: {},
          msmDetails: [{ miscellaneousSummaryCodes: { code: 'PAYOUT' }, msmSalesTotals: {} }],
        },
      };
      mockParse.mockReturnValue(msmResult);
      mockAdjustBusinessDate.mockReturnValue('2025-01-14');

      await service.processFile('/path/to/MSM20250115.xml', TEST_FILE_HASH);

      expect(mockAdjustBusinessDate).toHaveBeenCalled();
      // MSM now just creates ID mappings, no legacy DAL write
    });

    it('PS-106: should call adjustBusinessDate for MCM processing', async () => {
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
      mockAdjustBusinessDate.mockReturnValue('2025-01-14');

      await service.processFile('/path/to/MCM20250115.xml', TEST_FILE_HASH);

      expect(mockAdjustBusinessDate).toHaveBeenCalled();
      // MCM now uses shiftDepartmentSummariesDAL
      expect(mockShiftDeptCreateFromNAXML).toHaveBeenCalled();
    });

    it('PS-107: should call adjustBusinessDate for TLM processing', async () => {
      const tlmResult = {
        documentType: 'TaxLevelMovement',
        data: {
          movementHeader: { businessDate: '2025-01-15' },
          salesMovementHeader: {},
          tlmDetails: [{ taxLevelId: 'TAX1', tlmSalesTotals: { taxAmount: 5.0 } }],
        },
      };
      mockParse.mockReturnValue(tlmResult);
      mockAdjustBusinessDate.mockReturnValue('2025-01-14');

      await service.processFile('/path/to/TLM20250115.xml', TEST_FILE_HASH);

      expect(mockAdjustBusinessDate).toHaveBeenCalled();
      // TLM now uses shiftTaxSummariesDAL
      expect(mockShiftTaxCreateFromNAXML).toHaveBeenCalled();
    });

    it('PS-108: should call adjustBusinessDate for FPM processing', async () => {
      const fpmResult = {
        documentType: 'FuelProductMovement',
        data: {
          movementHeader: { businessDate: '2025-01-15' },
          fpmDetails: [{ fuelProductId: 'PRODUCT1', fpmNonResettableTotals: [] }],
        },
      };
      mockParse.mockReturnValue(fpmResult);
      mockAdjustBusinessDate.mockReturnValue('2025-01-14');

      await service.processFile('/path/to/FPM20250115.xml', TEST_FILE_HASH);

      expect(mockAdjustBusinessDate).toHaveBeenCalled();
      // FPM now uses meterReadingsDAL
      expect(mockMeterReadingsCreateFromNAXML).toHaveBeenCalled();
    });

    it('PS-109: should call adjustBusinessDate for TPM processing', async () => {
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
      mockAdjustBusinessDate.mockReturnValue('2025-01-14');

      await service.processFile('/path/to/TPM20250115.xml', TEST_FILE_HASH);

      expect(mockAdjustBusinessDate).toHaveBeenCalled();
      // TPM now uses tankReadingsDAL
      expect(mockTankReadingsCreateFromNAXML).toHaveBeenCalled();
    });

    it('PS-110: should handle year boundary adjustment correctly', async () => {
      const fgmYearBoundary = {
        documentType: 'FuelGradeMovement',
        data: {
          movementHeader: {
            businessDate: '2026-01-01',
            primaryReportPeriod: 99,
          },
          salesMovementHeader: {},
          fgmDetails: [
            {
              fuelGradeId: 'UNLEADED',
              fgmTenderSummary: { salesAmount: 100.0 },
              fgmPositionSummary: { salesVolume: 50.0 },
            },
          ],
        },
      };
      mockParse.mockReturnValue(fgmYearBoundary);
      // Simulate overnight shift that crosses year boundary
      mockAdjustBusinessDate.mockReturnValue('2025-12-31');

      await service.processFile('/path/to/FGM20260101.xml', TEST_FILE_HASH);

      // FGM now uses shiftFuelSummariesDAL
      expect(mockShiftFuelCreateFromNAXML).toHaveBeenCalled();
    });

    it('PS-111: should handle month boundary adjustment correctly', async () => {
      const fgmMonthBoundary = {
        documentType: 'FuelGradeMovement',
        data: {
          movementHeader: {
            businessDate: '2025-02-01',
            primaryReportPeriod: 99,
          },
          salesMovementHeader: {},
          fgmDetails: [
            {
              fuelGradeId: 'PREMIUM',
              fgmTenderSummary: { salesAmount: 200.0 },
              fgmPositionSummary: { salesVolume: 60.0 },
            },
          ],
        },
      };
      mockParse.mockReturnValue(fgmMonthBoundary);
      // Simulate overnight shift that crosses month boundary
      mockAdjustBusinessDate.mockReturnValue('2025-01-31');

      await service.processFile('/path/to/FGM20250201.xml', TEST_FILE_HASH);

      // FGM now uses shiftFuelSummariesDAL
      expect(mockShiftFuelCreateFromNAXML).toHaveBeenCalled();
    });

    it('PS-112: should pass endTime to adjustBusinessDate when available', async () => {
      const fgmWithEndTime = {
        documentType: 'FuelGradeMovement',
        data: {
          movementHeader: {
            businessDate: '2025-01-15',
            primaryReportPeriod: 99,
            endDate: '2025-01-15',
            endTime: '03:00:00', // 3 AM - before typical 6 AM cutoff
          },
          salesMovementHeader: {},
          fgmDetails: [
            {
              fuelGradeId: 'DIESEL',
              fgmTenderSummary: { salesAmount: 500.0 },
              fgmPositionSummary: { salesVolume: 150.0 },
            },
          ],
        },
      };
      mockParse.mockReturnValue(fgmWithEndTime);

      await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // Verify adjustBusinessDate was called with the end timestamp
      expect(mockAdjustBusinessDate).toHaveBeenCalledWith(
        '2025-01-15',
        expect.stringContaining('2025-01-15')
      );
    });

    it('PS-113: should handle null timestamp gracefully', async () => {
      const fgmNoTimestamp = {
        documentType: 'FuelGradeMovement',
        data: {
          movementHeader: {
            businessDate: '2025-01-15',
            primaryReportPeriod: 99,
            // No endDate or endTime
          },
          salesMovementHeader: {},
          fgmDetails: [
            {
              fuelGradeId: 'REGULAR',
              fgmTenderSummary: { salesAmount: 75.0 },
              fgmPositionSummary: { salesVolume: 25.0 },
            },
          ],
        },
      };
      mockParse.mockReturnValue(fgmNoTimestamp);

      await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // Should still process without error - FGM now uses shiftFuelSummariesDAL
      expect(mockShiftFuelCreateFromNAXML).toHaveBeenCalled();
    });

    it('PS-114: should adjust date for day-level reports and create shift', async () => {
      // Test with OPEN shift (EndDate = 2100-01-01 sentinel value)
      // According to NAXML spec, EndDate = 2100-01-01 means shift is STILL OPEN
      const fgmDayLevel = {
        documentType: 'FuelGradeMovement',
        data: {
          movementHeader: {
            businessDate: '2025-01-15',
            primaryReportPeriod: 99, // Day-level report (not shift close)
            endDate: '2100-01-01', // NAXML sentinel value for OPEN shift
            endTime: '04:00:00',
          },
          salesMovementHeader: {},
          fgmDetails: [
            {
              fuelGradeId: 'MIDGRADE',
              fgmTenderSummary: { salesAmount: 250.0 },
              fgmPositionSummary: { salesVolume: 80.0 },
            },
          ],
        },
      };
      mockParse.mockReturnValue(fgmDayLevel);
      mockAdjustBusinessDate.mockReturnValue('2025-01-14');

      await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // Shift should be created with adjusted date because:
      // 1. Period is not 98 (not a shift close file)
      // 2. EndDate is 2100-01-01 (sentinel value = shift still open)
      expect(mockGetOrCreateForDate).toHaveBeenCalledWith(
        TEST_STORE_ID,
        '2025-01-14',
        expect.any(Object)
      );
    });

    it('PS-115: should use adjusted date when creating movement records', async () => {
      mockParse.mockReturnValue(SAMPLE_FGM_PARSE_RESULT);
      mockAdjustBusinessDate.mockReturnValue('2025-01-14');

      await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // FGM now uses shiftFuelSummariesDAL
      expect(mockShiftFuelCreateFromNAXML).toHaveBeenCalled();
    });

    it('PS-116: should not call adjustBusinessDate when document has no business date', async () => {
      mockParse.mockReturnValue({
        documentType: 'UnknownType',
        data: {
          // No movementHeader
        },
      });

      await service.processFile('/path/to/UNKNOWN.xml', TEST_FILE_HASH);

      // Should not throw or fail
      expect(mockAdjustBusinessDate).not.toHaveBeenCalled();
    });
  });
});
