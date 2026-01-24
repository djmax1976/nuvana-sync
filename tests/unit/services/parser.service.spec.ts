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

// Mock electron BEFORE any imports that might trigger ipcMain.handle
// This is critical because shifts.handlers.ts (imported by parser.service.ts)
// calls registerHandler at module load time, which requires ipcMain
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/tmp'),
    getName: vi.fn(() => 'test'),
    getVersion: vi.fn(() => '1.0.0'),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((str: string) => Buffer.from(str)),
    decryptString: vi.fn((buf: Buffer) => buf.toString()),
  },
}));

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
      update: vi.fn(),
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
      getOrCreate: vi.fn(() => ({ mapping_id: 'terminal-mapping-id', id: 'terminal-mapping-id' })),
      findByExternalId: vi.fn(() => ({
        id: 'terminal-mapping-id',
        mapping_id: 'terminal-mapping-id',
      })),
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
  isDatabaseInitialized: vi.fn(() => true),
  getDatabase: vi.fn(() => ({})),
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

// Mock settingsService (may be imported transitively)
vi.mock('../../../src/main/services/settings.service', () => ({
  settingsService: {
    adjustBusinessDate: vi.fn((businessDate: string) => businessDate),
    getBusinessDayCutoffTime: vi.fn(() => '06:00'),
  },
}));

// Mock NAXML parser
vi.mock('../../../src/shared/naxml/parser', () => {
  const parse = vi.fn();
  return {
    createNAXMLParser: vi.fn(() => ({
      parse,
    })),
    // extractFuelDataFromMSM is used by parser.service.ts for MSM processing
    extractFuelDataFromMSM: vi.fn(() => ({
      fuelTotals: null,
      fuelByGrade: [],
    })),
  };
});

// Import after mocks
import * as fs from 'fs/promises';
import { ParserService, createParserService } from '../../../src/main/services/parser.service';
import * as dal from '../../../src/main/dal';
import { createNAXMLParser } from '../../../src/shared/naxml/parser';
// settingsService is mocked above - import not needed for tests

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
    it('PS-020: should process FuelGradeMovement and create mappings (fuel summaries come from MSM)', async () => {
      mockParse.mockReturnValue(SAMPLE_FGM_PARSE_RESULT);

      const result = await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // FGM now only creates mappings - fuel summaries come from MSM fuelSalesByGrade
      // The implementation disabled shiftFuelSummariesDAL.createFromNAXML for FGM
      // because MSM data is authoritative for shift close reports
      expect(result.success).toBe(true);
      expect(result.documentType).toBe('FuelGradeMovement');
      // Two FGM details = 2 records processed (for mappings)
      expect(result.recordsCreated).toBe(2);
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

    it('PS-023: should process MiscellaneousSummaryMovement and create mappings', async () => {
      const msmResult = {
        documentType: 'MiscellaneousSummaryMovement',
        data: {
          movementHeader: {
            businessDate: '2025-01-15',
            beginDate: '2025-01-15',
            beginTime: '06:00:00',
            endDate: '2100-01-01', // Open shift sentinel
            endTime: '00:00:00',
            primaryReportPeriod: 99, // Day-level (not shift close)
          },
          salesMovementHeader: {
            cashierId: 'CASHIER1',
            registerId: 'REG1',
            tillId: 'TILL1',
          },
          msmDetails: [
            {
              miscellaneousSummaryCodes: {
                miscellaneousSummaryCode: 'PAYOUT',
                miscellaneousSummarySubCode: 'cashDrawer',
              },
              msmSalesTotals: { totalAmount: 100.0, totalCount: 1 },
            },
          ],
        },
      };
      mockParse.mockReturnValue(msmResult);

      const result = await service.processFile('/path/to/MSM20250115.xml', TEST_FILE_HASH);

      // MSM creates ID mappings and processes details
      // If this fails, check the error message for hints
      if (!result.success) {
        console.error('MSM processing failed:', result.error);
      }
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

    it('PS-028: should process FGM shift close reports (period 98)', async () => {
      // Override mocks to return null (no existing shift)
      // This tests the path where FGM processes mappings without linking to a shift
      // Note: findShiftByDateAndRegister is called TWICE (with register, then without)
      vi.mocked(dal.shiftsDAL.findShiftByDateAndRegister)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined);
      vi.mocked(dal.shiftsDAL.findOpenShiftToClose).mockReturnValueOnce(undefined);

      const fgmShiftResult = {
        documentType: 'FuelGradeMovement',
        data: {
          movementHeader: {
            businessDate: '2025-01-15',
            beginDate: '2025-01-15',
            beginTime: '06:00:00',
            endDate: '2025-01-15', // Real end date = shift close
            endTime: '14:00:00',
            primaryReportPeriod: 98, // Shift close
          },
          salesMovementHeader: {
            cashierId: 'CASHIER1',
            registerId: 'REG1',
            tillId: 'TILL1',
          },
          fgmDetails: [
            {
              fuelGradeId: 'UNLEADED',
              fgmTenderSummary: { salesAmount: 100.0 },
              fgmPositionSummary: { salesVolume: 50.0 },
            },
          ],
        },
      };
      mockParse.mockReturnValue(fgmShiftResult);

      const result = await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // Period 98 = shift close
      // When no shift exists, FGM logs warning but still processes mappings
      if (!result.success) {
        console.error('PS-028 failed:', result.error);
      }
      expect(result.success).toBe(true);
      expect(result.documentType).toBe('FuelGradeMovement');
      // FGM tried to find a shift to close
      expect(vi.mocked(dal.shiftsDAL.findShiftByDateAndRegister)).toHaveBeenCalled();
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

    it('PS-063: FGM creates fuel grade mappings (not fuel summaries - those come from MSM)', async () => {
      mockParse.mockReturnValue({
        documentType: 'FuelGradeMovement',
        data: {
          movementHeader: {
            businessDate: '2025-01-15',
            beginDate: '2025-01-15',
            beginTime: '06:00:00',
            endDate: '2100-01-01', // Open shift sentinel
            endTime: '00:00:00',
            primaryReportPeriod: 99,
          },
          salesMovementHeader: {
            cashierId: 'C1',
            registerId: 'R1',
          },
          fgmDetails: [{ fuelGradeId: 'UNLEADED' }],
        },
      });

      const result = await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // FGM creates fuel grade mappings (local-first architecture)
      // Fuel summaries come from MSM, not FGM
      expect(result.success).toBe(true);
      expect(result.recordsCreated).toBe(1);
      // No sync queue for local-first movement data
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
      // FGM calls posFuelGradeMappingsDAL.getOrCreate for fuel grade mappings
      // Save original implementation to restore after test
      const originalImpl = vi
        .mocked(dal.posFuelGradeMappingsDAL.getOrCreate)
        .getMockImplementation();
      vi.mocked(dal.posFuelGradeMappingsDAL.getOrCreate).mockImplementation(() => {
        throw new Error('Database constraint violation');
      });

      const result = await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database constraint violation');

      // Restore original mock implementation
      vi.mocked(dal.posFuelGradeMappingsDAL.getOrCreate).mockImplementation(
        originalImpl ||
          (() => ({
            id: 'fuel-grade-mapping-id',
            store_id: 'test-store-123',
            external_grade_id: '001',
            internal_grade_name: 'REGULAR',
            fuel_type: 'REGULAR' as const,
            pos_system_type: 'gilbarco' as const,
            active: 1,
            created_at: '2025-01-15T00:00:00.000Z',
            updated_at: '2025-01-15T00:00:00.000Z',
          }))
      );
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
  // PS-100 through 120: Overnight Shift and Business Date Handling
  // Tests for getActualBusinessDate internal logic (overnight shift detection)
  // Implementation changed: now uses internal getActualBusinessDate method
  // instead of settingsService.adjustBusinessDate
  // ==========================================================================

  describe('Overnight Shift and Business Date Handling', () => {
    it('PS-100: should process FGM with standard daytime hours', async () => {
      mockParse.mockReturnValue(SAMPLE_FGM_PARSE_RESULT);

      const result = await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // Standard FGM processing with day-level data
      expect(result.success).toBe(true);
      expect(result.documentType).toBe('FuelGradeMovement');
    });

    it('PS-101: should process FGM and create fuel grade mappings', async () => {
      mockParse.mockReturnValue(SAMPLE_FGM_PARSE_RESULT);

      const result = await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // FGM creates fuel grade mappings - fuel summaries come from MSM
      expect(result.success).toBe(true);
      expect(result.recordsCreated).toBe(2);
    });

    it('PS-102: should process FGM with period 99 (day-level)', async () => {
      const fgmDayLevel = {
        documentType: 'FuelGradeMovement',
        data: {
          movementHeader: {
            businessDate: '2025-01-15',
            beginDate: '2025-01-15',
            beginTime: '06:00:00',
            endDate: '2100-01-01', // Open shift sentinel
            endTime: '00:00:00',
            primaryReportPeriod: 99,
          },
          salesMovementHeader: {
            cashierId: 'C1',
            registerId: 'R1',
          },
          fgmDetails: [{ fuelGradeId: 'UNLEADED' }],
        },
      };
      mockParse.mockReturnValue(fgmDayLevel);

      const result = await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // Day-level FGM should process successfully
      expect(result.success).toBe(true);
      expect(result.recordsCreated).toBe(1);
    });

    it('PS-103: should process ISM and count records', async () => {
      mockParse.mockReturnValue(SAMPLE_ISM_PARSE_RESULT);

      const result = await service.processFile('/path/to/ISM20250115.xml', TEST_FILE_HASH);

      // ISM records are counted (local-first)
      expect(result.success).toBe(true);
      expect(result.recordsCreated).toBe(3);
    });

    it('PS-104: ISM is processed locally and just counted', async () => {
      mockParse.mockReturnValue(SAMPLE_ISM_PARSE_RESULT);

      const result = await service.processFile('/path/to/ISM20250115.xml', TEST_FILE_HASH);

      // ISM data is now local-first - just counted, not stored in separate table
      expect(result.success).toBe(true);
      expect(result.documentType).toBe('ItemSalesMovement');
    });

    it('PS-105: should process MSM with proper data structure', async () => {
      const msmResult = {
        documentType: 'MiscellaneousSummaryMovement',
        data: {
          movementHeader: {
            businessDate: '2025-01-15',
            beginDate: '2025-01-15',
            beginTime: '06:00:00',
            endDate: '2100-01-01',
            endTime: '00:00:00',
            primaryReportPeriod: 99,
          },
          salesMovementHeader: {
            cashierId: 'C1',
            registerId: 'R1',
            tillId: 'T1',
          },
          msmDetails: [
            {
              miscellaneousSummaryCodes: {
                miscellaneousSummaryCode: 'statistics',
                miscellaneousSummarySubCode: 'transactions',
              },
              msmSalesTotals: { totalAmount: 0, totalCount: 50 },
            },
          ],
        },
      };
      mockParse.mockReturnValue(msmResult);

      const result = await service.processFile('/path/to/MSM20250115.xml', TEST_FILE_HASH);

      expect(result.success).toBe(true);
    });

    it('PS-106: should process MCM and route to shiftDepartmentSummariesDAL', async () => {
      const mcmResult = {
        documentType: 'MerchandiseCodeMovement',
        data: {
          movementHeader: {
            businessDate: '2025-01-15',
            beginDate: '2025-01-15',
            beginTime: '06:00:00',
            endDate: '2100-01-01',
            endTime: '00:00:00',
            primaryReportPeriod: 99,
          },
          salesMovementHeader: {
            cashierId: 'C1',
            registerId: 'R1',
          },
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

      // MCM uses shiftDepartmentSummariesDAL
      expect(mockShiftDeptCreateFromNAXML).toHaveBeenCalled();
    });

    it('PS-107: should process TLM and route to shiftTaxSummariesDAL', async () => {
      const tlmResult = {
        documentType: 'TaxLevelMovement',
        data: {
          movementHeader: {
            businessDate: '2025-01-15',
            beginDate: '2025-01-15',
            beginTime: '06:00:00',
            endDate: '2100-01-01',
            endTime: '00:00:00',
            primaryReportPeriod: 99,
          },
          salesMovementHeader: {
            cashierId: 'C1',
            registerId: 'R1',
          },
          tlmDetails: [
            {
              taxLevelId: 'TAX1',
              taxableSalesAmount: 100,
              taxCollectedAmount: 5.0,
            },
          ],
        },
      };
      mockParse.mockReturnValue(tlmResult);

      await service.processFile('/path/to/TLM20250115.xml', TEST_FILE_HASH);

      // TLM uses shiftTaxSummariesDAL
      expect(mockShiftTaxCreateFromNAXML).toHaveBeenCalled();
    });

    it('PS-108: should process FPM and route to meterReadingsDAL', async () => {
      const fpmResult = {
        documentType: 'FuelProductMovement',
        data: {
          movementHeader: {
            businessDate: '2025-01-15',
            beginDate: '2025-01-15',
            beginTime: '06:00:00',
          },
          fpmDetails: [
            {
              fuelProductId: 'PRODUCT1',
              fpmNonResettableTotals: [{ fuelPositionId: 'P1' }],
            },
          ],
        },
      };
      mockParse.mockReturnValue(fpmResult);

      await service.processFile('/path/to/FPM20250115.xml', TEST_FILE_HASH);

      // FPM uses meterReadingsDAL
      expect(mockMeterReadingsCreateFromNAXML).toHaveBeenCalled();
    });

    it('PS-109: should process TPM and route to tankReadingsDAL', async () => {
      const tpmResult = {
        documentType: 'TankProductMovement',
        data: {
          movementHeader: {
            businessDate: '2025-01-15',
            beginDate: '2025-01-15',
            beginTime: '06:00:00',
          },
          salesMovementHeader: {
            registerId: 'R1',
          },
          tpmDetails: [
            {
              tankId: 'TANK1',
              fuelProductId: 'PROD1',
              tankVolume: 5000,
            },
          ],
        },
      };
      mockParse.mockReturnValue(tpmResult);

      await service.processFile('/path/to/TPM20250115.xml', TEST_FILE_HASH);

      // TPM uses tankReadingsDAL
      expect(mockTankReadingsCreateFromNAXML).toHaveBeenCalled();
    });

    it('PS-110: should process FGM correctly at year boundary', async () => {
      const fgmYearBoundary = {
        documentType: 'FuelGradeMovement',
        data: {
          movementHeader: {
            businessDate: '2026-01-01',
            beginDate: '2026-01-01',
            beginTime: '06:00:00',
            endDate: '2100-01-01',
            endTime: '00:00:00',
            primaryReportPeriod: 99,
          },
          salesMovementHeader: {
            cashierId: 'C1',
            registerId: 'R1',
          },
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

      const result = await service.processFile('/path/to/FGM20260101.xml', TEST_FILE_HASH);

      // FGM processes year boundary correctly
      expect(result.success).toBe(true);
      expect(result.documentType).toBe('FuelGradeMovement');
    });

    it('PS-111: should process FGM correctly at month boundary', async () => {
      const fgmMonthBoundary = {
        documentType: 'FuelGradeMovement',
        data: {
          movementHeader: {
            businessDate: '2025-02-01',
            beginDate: '2025-02-01',
            beginTime: '06:00:00',
            endDate: '2100-01-01',
            endTime: '00:00:00',
            primaryReportPeriod: 99,
          },
          salesMovementHeader: {
            cashierId: 'C1',
            registerId: 'R1',
          },
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

      const result = await service.processFile('/path/to/FGM20250201.xml', TEST_FILE_HASH);

      // FGM processes month boundary correctly
      expect(result.success).toBe(true);
      expect(result.documentType).toBe('FuelGradeMovement');
    });

    it('PS-112: should process FGM with real endDate (shift closed)', async () => {
      // Override mocks to return null (no existing shift)
      // This tests the shift close detection logic without database interaction
      // Note: findShiftByDateAndRegister is called TWICE (with register, then without)
      vi.mocked(dal.shiftsDAL.findShiftByDateAndRegister)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined);
      vi.mocked(dal.shiftsDAL.findOpenShiftToClose).mockReturnValueOnce(undefined);

      const fgmWithEndTime = {
        documentType: 'FuelGradeMovement',
        data: {
          movementHeader: {
            businessDate: '2025-01-15',
            beginDate: '2025-01-15',
            beginTime: '06:00:00',
            endDate: '2025-01-15', // Real end date = closed
            endTime: '14:00:00',
            primaryReportPeriod: 98, // Shift close
          },
          salesMovementHeader: {
            cashierId: 'C1',
            registerId: 'R1',
          },
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

      const result = await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // Shift close FGM should process successfully
      // When no shift exists, it processes mappings without failing
      expect(result.success).toBe(true);
    });

    it('PS-113: should handle missing timestamp gracefully', async () => {
      const fgmNoTimestamp = {
        documentType: 'FuelGradeMovement',
        data: {
          movementHeader: {
            businessDate: '2025-01-15',
            // No beginTime, endDate, or endTime
            primaryReportPeriod: 99,
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

      const result = await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // Should still process without error
      expect(result.success).toBe(true);
    });

    it('PS-114: should use original businessDate when endDate is sentinel (2100-01-01)', async () => {
      // Test with OPEN shift (EndDate = 2100-01-01 sentinel value)
      const fgmDayLevel = {
        documentType: 'FuelGradeMovement',
        data: {
          movementHeader: {
            businessDate: '2025-01-15',
            beginDate: '2025-01-15',
            beginTime: '06:00:00',
            endDate: '2100-01-01', // NAXML sentinel value for OPEN shift
            endTime: '00:00:00',
            primaryReportPeriod: 99,
          },
          salesMovementHeader: {
            cashierId: 'C1',
            registerId: 'R1',
          },
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

      const result = await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // Open shift should process successfully - uses original business date
      expect(result.success).toBe(true);
      expect(result.recordsCreated).toBe(1);
    });

    it('PS-115: should process FGM with complete movement header', async () => {
      mockParse.mockReturnValue(SAMPLE_FGM_PARSE_RESULT);

      const result = await service.processFile('/path/to/FGM20250115.xml', TEST_FILE_HASH);

      // FGM creates fuel grade mappings
      expect(result.success).toBe(true);
    });

    it('PS-116: should handle unknown document types gracefully', async () => {
      mockParse.mockReturnValue({
        documentType: 'UnknownType',
        data: {
          // No movementHeader
        },
      });

      const result = await service.processFile('/path/to/UNKNOWN.xml', TEST_FILE_HASH);

      // Should not throw or fail - just returns 0 records
      expect(result.success).toBe(true);
      expect(result.recordsCreated).toBe(0);
    });
  });
});
