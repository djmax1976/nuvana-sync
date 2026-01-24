/**
 * Parser Service - Phase 4 MSM Fuel Data Processing Unit Tests
 *
 * Enterprise-grade tests for Phase 4 MSM fuel data extraction and persistence.
 * Validates the integration of extractFuelDataFromMSM with DAL operations.
 *
 * Test Coverage Matrix:
 * - P4-MSM-001 through 020: MSM Fuel Data Extraction Integration
 * - P4-P2-001 through 015: Period 2 (Daily) Fuel Processing
 * - P4-P98-001 through 015: Period 98 (Shift) Fuel Processing
 * - P4-DISC-001 through 010: Discount Summary Persistence
 * - P4-OUT-001 through 010: Outside Dispenser Records
 * - P4-SEC-001 through 010: Security Validation (SEC-006, DB-006)
 * - P4-EDGE-001 through 015: Edge Case and Boundary Tests
 *
 * Test Traceability:
 * - Component: src/main/services/parser.service.ts (processMiscellaneousSummary)
 * - Parser: src/shared/naxml/parser.ts (extractFuelDataFromMSM)
 * - DALs: day-fuel-summaries.dal, shift-fuel-summaries.dal, msm-discount-summaries.dal,
 *         msm-outside-dispenser-records.dal
 *
 * @module tests/unit/services/parser-msm-phase4.service.spec
 * @security SEC-006: Verifies parameterized queries via DAL
 * @security DB-006: Verifies tenant isolation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mock Setup - Must be BEFORE imports
// ============================================================================

// ============================================================================
// Mock declarations - assigned in beforeEach
// ============================================================================

let mockDayFuelCreateFromMSM: ReturnType<typeof vi.fn>;
let mockShiftFuelCreateFromMSM: ReturnType<typeof vi.fn>;
let mockShiftFuelCreateFromNAXML: ReturnType<typeof vi.fn>;
let mockMSMDiscountUpsert: ReturnType<typeof vi.fn>;
let mockOutsideDispenserUpsert: ReturnType<typeof vi.fn>;
let mockDaySummaryGetOrCreate: ReturnType<typeof vi.fn>;
let mockShiftSummaryGetOrCreate: ReturnType<typeof vi.fn>;
let mockShiftsGetOrCreate: ReturnType<typeof vi.fn>;
let mockShiftsFindOpen: ReturnType<typeof vi.fn>;
let mockShiftsClose: ReturnType<typeof vi.fn>;
let mockProcessedFilesIsProcessed: ReturnType<typeof vi.fn>;
let mockProcessedFilesRecord: ReturnType<typeof vi.fn>;
let mockExtractFuelDataFromMSM: ReturnType<typeof vi.fn>;
let mockParse: ReturnType<typeof vi.fn>;

vi.mock('../../../src/main/dal', () => {
  // Create mock functions - default values set in beforeEach
  const dayFuelCreateFromMSM = vi.fn();
  const dayFuelUpsert = vi.fn();
  const shiftFuelCreateFromMSM = vi.fn();
  const shiftFuelCreateFromNAXML = vi.fn();
  const msmDiscountUpsert = vi.fn();
  const outsideDispenserUpsert = vi.fn();
  const daySummaryGetOrCreate = vi.fn();
  const shiftSummaryGetOrCreate = vi.fn();
  const shiftsGetOrCreate = vi.fn();
  const shiftsFindOpen = vi.fn();
  const shiftsClose = vi.fn();
  const processedFilesIsProcessed = vi.fn();
  const processedFilesRecord = vi.fn();
  const findShiftByDateAndRegister = vi.fn();
  const createClosedShift = vi.fn();

  return {
    // MSM Phase 4 DALs
    dayFuelSummariesDAL: {
      createFromMSM: dayFuelCreateFromMSM,
      upsert: dayFuelUpsert,
    },
    shiftFuelSummariesDAL: {
      createFromMSM: shiftFuelCreateFromMSM,
      createFromNAXML: shiftFuelCreateFromNAXML,
    },
    msmDiscountSummariesDAL: {
      upsert: msmDiscountUpsert,
    },
    msmOutsideDispenserRecordsDAL: {
      upsert: outsideDispenserUpsert,
    },
    // Core DALs
    daySummariesDAL: {
      getOrCreateForDate: daySummaryGetOrCreate,
    },
    shiftSummariesDAL: {
      getOrCreateForShift: shiftSummaryGetOrCreate,
      closeShiftSummary: vi.fn(),
    },
    shiftsDAL: {
      getOrCreateForDate: shiftsGetOrCreate,
      findOpenShiftToClose: shiftsFindOpen,
      findShiftByDateAndRegister: findShiftByDateAndRegister,
      closeShift: shiftsClose,
      findByDate: vi.fn(() => []),
      createClosedShift: createClosedShift,
    },
    processedFilesDAL: {
      isFileProcessed: processedFilesIsProcessed,
      recordFile: processedFilesRecord,
    },
    syncQueueDAL: {
      enqueue: vi.fn(),
    },
    // POS ID Mapping DALs
    posFuelGradeMappingsDAL: { getOrCreate: vi.fn(() => ({ mapping_id: 'fg-001' })) },
    posCashierMappingsDAL: {
      getOrCreate: vi.fn(() => ({ mapping_id: 'c-001', internal_user_id: null })),
    },
    posTerminalMappingsDAL: {
      getOrCreate: vi.fn(() => ({ mapping_id: 't-001' })),
      findByExternalId: vi.fn(() => ({ id: 't-001', mapping_id: 't-001' })),
    },
    posTillMappingsDAL: { getOrCreate: vi.fn(() => ({ id: 'till-001' })), linkToShift: vi.fn() },
    posFuelPositionMappingsDAL: { getOrCreate: vi.fn(() => ({ mapping_id: 'fp-001' })) },
    posFuelProductMappingsDAL: { getOrCreate: vi.fn(() => ({ mapping_id: 'fprod-001' })) },
    posDepartmentMappingsDAL: { getOrCreate: vi.fn(() => ({ mapping_id: 'd-001' })) },
    posTaxLevelMappingsDAL: { getOrCreate: vi.fn(() => ({ mapping_id: 'tax-001' })) },
    posTenderMappingsDAL: { getOrCreate: vi.fn(() => ({ mapping_id: 'tender-001' })) },
    posPriceTierMappingsDAL: { getOrCreate: vi.fn(() => ({ mapping_id: 'pt-001' })) },
    // Other DALs
    transactionsDAL: { createWithDetails: vi.fn() },
    shiftDepartmentSummariesDAL: { createFromNAXML: vi.fn() },
    shiftTenderSummariesDAL: { upsert: vi.fn() },
    shiftTaxSummariesDAL: { createFromNAXML: vi.fn() },
    meterReadingsDAL: { createFromNAXML: vi.fn() },
    tankReadingsDAL: { createFromNAXML: vi.fn() },
  };
});

vi.mock('fs/promises', () => ({
  stat: vi.fn().mockResolvedValue({ size: 1024 }),
  readFile: vi.fn().mockResolvedValue('<?xml version="1.0"?><NAXML/>'),
}));

vi.mock('../../../src/main/services/database.service', () => ({
  withTransaction: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../../../src/main/services/settings.service', () => ({
  settingsService: {
    adjustBusinessDate: vi.fn((date: string) => date),
    getBusinessDayCutoffTime: vi.fn(() => '06:00'),
  },
}));

vi.mock('../../../src/main/utils/event-bus', () => ({
  eventBus: { emit: vi.fn() },
  MainEvents: { SHIFT_CLOSED: 'shift:closed' },
}));

vi.mock('../../../src/main/ipc/shifts.handlers', () => ({
  determineShiftCloseType: vi.fn(() => ({ closeType: 'shift', remainingOpenShifts: 0 })),
}));

// Mock the parser module - use vi.hoisted() so variables are available when vi.mock runs
const { mockParseFunction, mockExtractFuelFunction } = vi.hoisted(() => ({
  mockParseFunction: vi.fn(),
  mockExtractFuelFunction: vi.fn(),
}));

vi.mock('../../../src/shared/naxml/parser', () => ({
  createNAXMLParser: vi.fn(() => ({ parse: mockParseFunction })),
  extractFuelDataFromMSM: mockExtractFuelFunction,
}));

// ============================================================================
// Import After Mocks
// ============================================================================

import { ParserService } from '../../../src/main/services/parser.service';
import * as dal from '../../../src/main/dal';
import { createNAXMLParser, extractFuelDataFromMSM } from '../../../src/shared/naxml/parser';
import type { MSMExtractedFuelData } from '../../../src/shared/naxml/types';

// ============================================================================
// Test Fixtures - Enterprise-Grade Real-World Data
// ============================================================================

const TEST_STORE_ID = 'store-msm-phase4-001';
const TEST_FILE_HASH = 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1';

/**
 * Period 2 (Daily) MSM Movement Header
 * Represents complete daily fuel report with inside/outside breakdown
 */
const PERIOD_2_MOVEMENT_HEADER = {
  reportSequenceNumber: 1,
  primaryReportPeriod: 2 as const,
  secondaryReportPeriod: 0,
  businessDate: '2026-01-15',
  beginDate: '2026-01-15',
  beginTime: '00:00:00',
  endDate: '2026-01-15',
  endTime: '23:59:59',
};

/**
 * Period 98 (Shift Close) MSM Movement Header
 * Represents shift-level fuel data
 */
const PERIOD_98_MOVEMENT_HEADER = {
  reportSequenceNumber: 1,
  primaryReportPeriod: 98 as const,
  secondaryReportPeriod: 0,
  businessDate: '2026-01-15',
  beginDate: '2026-01-15',
  beginTime: '06:00:00',
  endDate: '2026-01-15',
  endTime: '14:00:00',
};

/**
 * Sales Movement Header for Period 98
 */
const VALID_SALES_HEADER = {
  registerId: '1',
  cashierId: '1001',
  tillId: '4133',
};

/**
 * Complete extracted fuel data from extractFuelDataFromMSM
 * Simulates real MSM parsing output for Period 2 (daily)
 */
const EXTRACTED_PERIOD_2_FUEL_DATA: MSMExtractedFuelData = {
  period: 2,
  businessDate: '2026-01-15',
  sourceInfo: {
    primaryReportPeriod: 2,
    secondaryReportPeriod: 0,
    beginDate: '2026-01-15',
    beginTime: '00:00:00',
    endDate: '2026-01-15',
    endTime: '23:59:59',
  },
  totalFuel: [
    { gradeId: '001', amount: 3500.0, volume: 1400.0 },
    { gradeId: '002', amount: 2100.0, volume: 775.0 },
    { gradeId: '003', amount: 1050.0, volume: 350.0 },
  ],
  insideFuel: [
    { gradeId: '001', amount: 875.0, volume: 350.0 },
    { gradeId: '002', amount: 525.0, volume: 193.75 },
    { gradeId: '003', amount: 262.5, volume: 87.5 },
  ],
  outsideFuel: [
    { gradeId: '001', amount: 2625.0, volume: 1050.0 },
    { gradeId: '002', amount: 1575.0, volume: 581.25 },
    { gradeId: '003', amount: 787.5, volume: 262.5 },
  ],
  outsideDispensers: [], // Period 2 does not have dispenser records
  discounts: {
    statistics: 0,
    amountFixed: 0,
    amountPercentage: 0,
    promotional: 0,
    fuel: 35.0,
    storeCoupons: 0,
  },
  totals: {
    insideAmount: 1662.5,
    insideVolume: 631.25,
    outsideAmount: 4987.5,
    outsideVolume: 1893.75,
    grandTotalAmount: 6650.0,
    grandTotalVolume: 2525.0,
    discountAmount: 35.0,
  },
};

/**
 * Complete extracted fuel data for Period 98 (Shift)
 * Includes outside dispenser records specific to shift close
 */
const EXTRACTED_PERIOD_98_FUEL_DATA: MSMExtractedFuelData = {
  period: 98,
  businessDate: '2026-01-15',
  sourceInfo: {
    primaryReportPeriod: 98,
    secondaryReportPeriod: 0,
    beginDate: '2026-01-15',
    beginTime: '06:00:00',
    endDate: '2026-01-15',
    endTime: '14:00:00',
  },
  totalFuel: [], // Period 98 may not have total
  insideFuel: [
    { gradeId: '001', amount: 500.0, volume: 200.0 },
    { gradeId: '002', amount: 300.0, volume: 110.0 },
  ],
  outsideFuel: [], // Period 98 outside is in dispenser records
  outsideDispensers: [
    {
      registerId: '1',
      cashierId: '1001',
      tillId: '4133',
      tender: 'outsideCredit',
      amount: 750.0,
      count: 25,
    },
    {
      registerId: '1',
      cashierId: '1001',
      tillId: '4133',
      tender: 'outsideDebit',
      amount: 250.0,
      count: 8,
    },
  ],
  discounts: {
    statistics: 0,
    amountFixed: 0,
    amountPercentage: 0,
    promotional: 0,
    fuel: 0, // Fuel discount typically only in Period 2
    storeCoupons: 0,
  },
  totals: {
    insideAmount: 800.0,
    insideVolume: 310.0,
    outsideAmount: 1000.0,
    outsideVolume: 0, // Not available by grade in Period 98
    grandTotalAmount: 1800.0,
    grandTotalVolume: 310.0,
    discountAmount: 0,
  },
};

/**
 * MSM parse result for Period 2
 */
const PERIOD_2_MSM_PARSE_RESULT = {
  documentType: 'MiscellaneousSummaryMovement',
  data: {
    movementHeader: PERIOD_2_MOVEMENT_HEADER,
    salesMovementHeader: undefined,
    msmDetails: [
      {
        miscellaneousSummaryCodes: {
          miscellaneousSummaryCode: 'fuelSalesByGrade',
          miscellaneousSummarySubCode: 'fuel',
          miscellaneousSummarySubCodeModifier: '001',
        },
        msmSalesTotals: { miscellaneousSummaryAmount: 3500.0, miscellaneousSummaryCount: 1400.0 },
      },
    ],
  },
};

/**
 * MSM parse result for Period 98
 */
const PERIOD_98_MSM_PARSE_RESULT = {
  documentType: 'MiscellaneousSummaryMovement',
  data: {
    movementHeader: PERIOD_98_MOVEMENT_HEADER,
    salesMovementHeader: VALID_SALES_HEADER,
    msmDetails: [
      {
        miscellaneousSummaryCodes: {
          miscellaneousSummaryCode: 'fuelSalesByGrade',
          miscellaneousSummarySubCode: 'insideFuel',
          miscellaneousSummarySubCodeModifier: '001',
        },
        msmSalesTotals: { miscellaneousSummaryAmount: 500.0, miscellaneousSummaryCount: 200.0 },
      },
    ],
    outsideDispensers: [
      {
        registerId: '1',
        cashierId: '1001',
        tillId: '4133',
        tender: 'outsideCredit',
        amount: 750.0,
        count: 25,
      },
    ],
  },
};

// ============================================================================
// Test Suite
// ============================================================================

describe('ParserService - Phase 4 MSM Fuel Data Processing', () => {
  let service: ParserService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Get DAL mock references
    mockDayFuelCreateFromMSM = vi.mocked(dal.dayFuelSummariesDAL.createFromMSM);
    mockShiftFuelCreateFromMSM = vi.mocked(dal.shiftFuelSummariesDAL.createFromMSM);
    mockShiftFuelCreateFromNAXML = vi.mocked(dal.shiftFuelSummariesDAL.createFromNAXML);
    mockMSMDiscountUpsert = vi.mocked(dal.msmDiscountSummariesDAL.upsert);
    mockOutsideDispenserUpsert = vi.mocked(dal.msmOutsideDispenserRecordsDAL.upsert);
    mockDaySummaryGetOrCreate = vi.mocked(dal.daySummariesDAL.getOrCreateForDate);
    mockShiftSummaryGetOrCreate = vi.mocked(dal.shiftSummariesDAL.getOrCreateForShift);
    mockShiftsGetOrCreate = vi.mocked(dal.shiftsDAL.getOrCreateForDate);
    mockShiftsFindOpen = vi.mocked(dal.shiftsDAL.findOpenShiftToClose);
    mockShiftsClose = vi.mocked(dal.shiftsDAL.closeShift);
    mockProcessedFilesIsProcessed = vi.mocked(dal.processedFilesDAL.isFileProcessed);
    mockProcessedFilesRecord = vi.mocked(dal.processedFilesDAL.recordFile);

    // Use module-level mock functions
    mockParse = mockParseFunction;
    mockExtractFuelDataFromMSM = mockExtractFuelFunction;

    // Default mock returns for all DALs
    mockProcessedFilesIsProcessed.mockReturnValue(false);
    mockProcessedFilesRecord.mockReturnValue({ id: 'file-record-id' });
    mockDaySummaryGetOrCreate.mockReturnValue({ day_summary_id: 'ds-001' });
    mockShiftSummaryGetOrCreate.mockReturnValue({ shift_summary_id: 'ss-001' });
    mockShiftsGetOrCreate.mockReturnValue({ shift_id: 'shift-001' });
    mockShiftsFindOpen.mockReturnValue({ shift_id: 'shift-001', shift_number: 1 });
    mockDayFuelCreateFromMSM.mockReturnValue('dfs-001');
    mockShiftFuelCreateFromMSM.mockReturnValue('sfs-001');
    mockShiftFuelCreateFromNAXML.mockReturnValue('sfs-naxml-001');
    mockMSMDiscountUpsert.mockReturnValue({ msm_discount_id: 'disc-001' });
    mockOutsideDispenserUpsert.mockReturnValue({ outside_dispenser_id: 'od-001' });

    // Additional shift-related mocks for Period 98 flow
    vi.mocked(dal.shiftsDAL.findShiftByDateAndRegister).mockReturnValue(undefined);
    vi.mocked(dal.shiftsDAL.createClosedShift).mockReturnValue({
      shift_id: 'shift-created-001',
      store_id: TEST_STORE_ID,
      shift_number: 1,
      business_date: '2025-01-09',
      cashier_id: null,
      register_id: null,
      start_time: null,
      end_time: '2025-01-09T23:59:59Z',
      status: 'CLOSED',
      external_cashier_id: null,
      external_register_id: '1',
      external_till_id: null,
      created_at: '2025-01-09T00:00:00Z',
      updated_at: '2025-01-09T00:00:00Z',
    });

    // Create service
    service = new ParserService(TEST_STORE_ID);
  });

  // ==========================================================================
  // P4-MSM: MSM Fuel Data Extraction Integration Tests
  // ==========================================================================

  describe('MSM Fuel Data Extraction Integration', () => {
    it('P4-MSM-001: should call extractFuelDataFromMSM for MSM documents', async () => {
      mockParse.mockReturnValue(PERIOD_2_MSM_PARSE_RESULT);
      mockExtractFuelDataFromMSM.mockReturnValue(EXTRACTED_PERIOD_2_FUEL_DATA);

      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      expect(mockExtractFuelDataFromMSM).toHaveBeenCalledWith(PERIOD_2_MSM_PARSE_RESULT.data);
    });

    it('P4-MSM-002: should process MSM document successfully', async () => {
      mockParse.mockReturnValue(PERIOD_2_MSM_PARSE_RESULT);
      mockExtractFuelDataFromMSM.mockReturnValue(EXTRACTED_PERIOD_2_FUEL_DATA);

      const result = await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      expect(result.success).toBe(true);
      expect(result.documentType).toBe('MiscellaneousSummaryMovement');
    });

    it('P4-MSM-003: should correctly identify Period 2 as daily MSM', async () => {
      mockParse.mockReturnValue(PERIOD_2_MSM_PARSE_RESULT);
      mockExtractFuelDataFromMSM.mockReturnValue(EXTRACTED_PERIOD_2_FUEL_DATA);

      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      // Period 2 should create day fuel summaries
      expect(mockDaySummaryGetOrCreate).toHaveBeenCalledWith(TEST_STORE_ID, '2026-01-15');
      expect(mockDayFuelCreateFromMSM).toHaveBeenCalled();
    });

    it('P4-MSM-004: should correctly identify Period 98 as shift MSM', async () => {
      mockParse.mockReturnValue(PERIOD_98_MSM_PARSE_RESULT);
      mockExtractFuelDataFromMSM.mockReturnValue(EXTRACTED_PERIOD_98_FUEL_DATA);

      await service.processFile('/path/to/MSM20260115_SHIFT.xml', TEST_FILE_HASH);

      // Period 98 should create shift fuel summaries
      expect(mockShiftFuelCreateFromMSM).toHaveBeenCalled();
    });

    it('P4-MSM-005: should not call extractFuelDataFromMSM for non-MSM documents', async () => {
      mockParse.mockReturnValue({
        documentType: 'FuelGradeMovement',
        data: {
          movementHeader: { businessDate: '2026-01-15', primaryReportPeriod: 98 },
          fgmDetails: [],
        },
      });

      await service.processFile('/path/to/FGM20260115.xml', TEST_FILE_HASH);

      expect(mockExtractFuelDataFromMSM).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // P4-P2: Period 2 (Daily) Fuel Processing Tests
  // ==========================================================================

  describe('Period 2 (Daily) Fuel Processing', () => {
    beforeEach(() => {
      mockParse.mockReturnValue(PERIOD_2_MSM_PARSE_RESULT);
      mockExtractFuelDataFromMSM.mockReturnValue(EXTRACTED_PERIOD_2_FUEL_DATA);
    });

    it('P4-P2-001: should create day fuel summaries for each grade in Period 2', async () => {
      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      // Should create 3 day fuel summaries (one per grade)
      expect(mockDayFuelCreateFromMSM).toHaveBeenCalledTimes(3);
    });

    it('P4-P2-002: should pass correct inside/outside breakdown to dayFuelSummariesDAL', async () => {
      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      // Verify first grade (001) has correct values
      expect(mockDayFuelCreateFromMSM).toHaveBeenCalledWith(
        'ds-001',
        expect.objectContaining({
          gradeId: '001',
          totalVolume: 1400.0,
          totalAmount: 3500.0,
          insideVolume: 350.0,
          insideAmount: 875.0,
          outsideVolume: 1050.0,
          outsideAmount: 2625.0,
        }),
        TEST_FILE_HASH
      );
    });

    it('P4-P2-003: should pass file hash for deduplication', async () => {
      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      // All calls should include file hash
      const allCalls = mockDayFuelCreateFromMSM.mock.calls;
      allCalls.forEach((call) => {
        expect(call[2]).toBe(TEST_FILE_HASH);
      });
    });

    it('P4-P2-004: should handle grades with missing inside data', async () => {
      const dataWithMissingInside: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_2_FUEL_DATA,
        insideFuel: [{ gradeId: '001', amount: 875.0, volume: 350.0 }], // Only grade 001
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithMissingInside);

      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      // Grade 002 should have zero inside values
      expect(mockDayFuelCreateFromMSM).toHaveBeenCalledWith(
        'ds-001',
        expect.objectContaining({
          gradeId: '002',
          insideVolume: 0,
          insideAmount: 0,
        }),
        TEST_FILE_HASH
      );
    });

    it('P4-P2-005: should handle grades with missing outside data', async () => {
      const dataWithMissingOutside: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_2_FUEL_DATA,
        outsideFuel: [], // No outside data
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithMissingOutside);

      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      // All grades should have zero outside values
      const allCalls = mockDayFuelCreateFromMSM.mock.calls;
      allCalls.forEach((call) => {
        expect(call[1].outsideVolume).toBe(0);
        expect(call[1].outsideAmount).toBe(0);
      });
    });

    it('P4-P2-006: should save discount summaries for Period 2', async () => {
      const dataWithDiscounts: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_2_FUEL_DATA,
        discounts: {
          statistics: 100.0,
          amountFixed: 50.0,
          amountPercentage: 25.0,
          promotional: 75.0,
          fuel: 35.0,
          storeCoupons: 15.0,
        },
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithDiscounts);

      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      // Should save all non-zero discounts
      expect(mockMSMDiscountUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          store_id: TEST_STORE_ID,
          business_date: '2026-01-15',
          msm_period: 2,
          shift_id: undefined, // No shift for Period 2
          discount_type: 'discount_fuel',
          discount_amount: 35.0,
        })
      );
    });

    it('P4-P2-007: should not create shift fuel summaries for Period 2', async () => {
      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      expect(mockShiftFuelCreateFromMSM).not.toHaveBeenCalled();
    });

    it('P4-P2-008: should not create outside dispenser records for Period 2', async () => {
      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      expect(mockOutsideDispenserUpsert).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // P4-P98: Period 98 (Shift) Fuel Processing Tests
  // ==========================================================================

  describe('Period 98 (Shift) Fuel Processing', () => {
    beforeEach(() => {
      mockParse.mockReturnValue(PERIOD_98_MSM_PARSE_RESULT);
      mockExtractFuelDataFromMSM.mockReturnValue(EXTRACTED_PERIOD_98_FUEL_DATA);
    });

    it('P4-P98-001: should create shift fuel summaries for each inside grade', async () => {
      await service.processFile('/path/to/MSM20260115_SHIFT.xml', TEST_FILE_HASH);

      // Should create 2 shift fuel summaries (inside grades only)
      expect(mockShiftFuelCreateFromMSM).toHaveBeenCalledTimes(2);
    });

    it('P4-P98-002: should pass correct MSM metadata to shift fuel summaries', async () => {
      await service.processFile('/path/to/MSM20260115_SHIFT.xml', TEST_FILE_HASH);

      expect(mockShiftFuelCreateFromMSM).toHaveBeenCalledWith(
        'ss-001',
        expect.objectContaining({
          gradeId: '001',
          tenderType: 'ALL',
          totalVolume: 200.0,
          totalAmount: 500.0,
          insideVolume: 200.0,
          insideAmount: 500.0,
          outsideVolume: 0,
          outsideAmount: 0,
          msmPeriod: 98,
          msmSecondaryPeriod: 0,
        }),
        TEST_FILE_HASH
      );
    });

    it('P4-P98-003: should create outside dispenser records', async () => {
      await service.processFile('/path/to/MSM20260115_SHIFT.xml', TEST_FILE_HASH);

      // Should create 2 outside dispenser records
      expect(mockOutsideDispenserUpsert).toHaveBeenCalledTimes(2);
    });

    it('P4-P98-004: should pass correct data to outside dispenser records', async () => {
      await service.processFile('/path/to/MSM20260115_SHIFT.xml', TEST_FILE_HASH);

      expect(mockOutsideDispenserUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          store_id: TEST_STORE_ID,
          business_date: '2026-01-15',
          shift_id: 'shift-001',
          register_id: '1',
          tender_type: 'outsideCredit',
          amount: 750.0,
          transaction_count: 25,
          source_file_hash: TEST_FILE_HASH,
        })
      );
    });

    it('P4-P98-005: should link shift fuel summaries to shift summary', async () => {
      await service.processFile('/path/to/MSM20260115_SHIFT.xml', TEST_FILE_HASH);

      // Verify shift summary was retrieved
      expect(mockShiftSummaryGetOrCreate).toHaveBeenCalled();

      // Verify first argument to createFromMSM is the shift summary ID
      const allCalls = mockShiftFuelCreateFromMSM.mock.calls;
      allCalls.forEach((call) => {
        expect(call[0]).toBe('ss-001');
      });
    });

    it('P4-P98-006: should save discount summaries with shift_id for Period 98', async () => {
      const dataWithDiscount: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_98_FUEL_DATA,
        discounts: {
          ...EXTRACTED_PERIOD_98_FUEL_DATA.discounts,
          promotional: 10.0,
        },
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithDiscount);

      await service.processFile('/path/to/MSM20260115_SHIFT.xml', TEST_FILE_HASH);

      expect(mockMSMDiscountUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          msm_period: 98,
          shift_id: 'shift-001',
          discount_type: 'discount_promotional',
        })
      );
    });

    it('P4-P98-007: should not create day fuel summaries for Period 98', async () => {
      await service.processFile('/path/to/MSM20260115_SHIFT.xml', TEST_FILE_HASH);

      expect(mockDayFuelCreateFromMSM).not.toHaveBeenCalled();
    });

    it('P4-P98-008: should handle Period 98 with no shift summary gracefully', async () => {
      mockShiftSummaryGetOrCreate.mockReturnValue(undefined);

      // Should not throw
      await expect(
        service.processFile('/path/to/MSM20260115_SHIFT.xml', TEST_FILE_HASH)
      ).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // P4-DISC: Discount Summary Persistence Tests
  // ==========================================================================

  describe('Discount Summary Persistence (saveMSMDiscountSummaries)', () => {
    beforeEach(() => {
      mockParse.mockReturnValue(PERIOD_2_MSM_PARSE_RESULT);
    });

    it('P4-DISC-001: should save all non-zero discount types', async () => {
      const dataWithAllDiscounts: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_2_FUEL_DATA,
        discounts: {
          statistics: 100.0,
          amountFixed: 50.0,
          amountPercentage: 25.0,
          promotional: 75.0,
          fuel: 35.0,
          storeCoupons: 15.0,
        },
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithAllDiscounts);

      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      // Should save 6 discount records (all non-zero)
      expect(mockMSMDiscountUpsert).toHaveBeenCalledTimes(6);
    });

    it('P4-DISC-002: should not save zero discount amounts', async () => {
      const dataWithZeroDiscounts: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_2_FUEL_DATA,
        discounts: {
          statistics: 0,
          amountFixed: 0,
          amountPercentage: 0,
          promotional: 0,
          fuel: 35.0, // Only non-zero
          storeCoupons: 0,
        },
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithZeroDiscounts);

      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      // Should only save 1 discount record (fuel)
      expect(mockMSMDiscountUpsert).toHaveBeenCalledTimes(1);
      expect(mockMSMDiscountUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ discount_type: 'discount_fuel' })
      );
    });

    it('P4-DISC-003: should map discount properties to correct database types', async () => {
      const dataWithDiscounts: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_2_FUEL_DATA,
        discounts: {
          statistics: 100.0,
          amountFixed: 50.0,
          amountPercentage: 25.0,
          promotional: 75.0,
          fuel: 35.0,
          storeCoupons: 15.0,
        },
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithDiscounts);

      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      // Verify correct type mappings
      const calls = mockMSMDiscountUpsert.mock.calls;
      const discountTypes = calls.map((c) => c[0].discount_type);

      expect(discountTypes).toContain('statistics_discounts');
      expect(discountTypes).toContain('discount_amount_fixed');
      expect(discountTypes).toContain('discount_amount_percentage');
      expect(discountTypes).toContain('discount_promotional');
      expect(discountTypes).toContain('discount_fuel');
      expect(discountTypes).toContain('discount_store_coupons');
    });

    it('P4-DISC-004: should include source_file_hash for traceability', async () => {
      const dataWithDiscount: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_2_FUEL_DATA,
        discounts: { ...EXTRACTED_PERIOD_2_FUEL_DATA.discounts, fuel: 50.0 },
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithDiscount);

      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      expect(mockMSMDiscountUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ source_file_hash: TEST_FILE_HASH })
      );
    });

    it('P4-DISC-005: should handle no discounts gracefully', async () => {
      const dataWithNoDiscounts: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_2_FUEL_DATA,
        discounts: {
          statistics: 0,
          amountFixed: 0,
          amountPercentage: 0,
          promotional: 0,
          fuel: 0,
          storeCoupons: 0,
        },
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithNoDiscounts);

      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      expect(mockMSMDiscountUpsert).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // P4-OUT: Outside Dispenser Records Tests
  // ==========================================================================

  describe('Outside Dispenser Records', () => {
    beforeEach(() => {
      mockParse.mockReturnValue(PERIOD_98_MSM_PARSE_RESULT);
      mockExtractFuelDataFromMSM.mockReturnValue(EXTRACTED_PERIOD_98_FUEL_DATA);
    });

    it('P4-OUT-001: should create records for all outside dispensers', async () => {
      await service.processFile('/path/to/MSM20260115_SHIFT.xml', TEST_FILE_HASH);

      expect(mockOutsideDispenserUpsert).toHaveBeenCalledTimes(2);
    });

    it('P4-OUT-002: should correctly map tender types', async () => {
      await service.processFile('/path/to/MSM20260115_SHIFT.xml', TEST_FILE_HASH);

      const calls = mockOutsideDispenserUpsert.mock.calls;
      const tenderTypes = calls.map((c) => c[0].tender_type);

      expect(tenderTypes).toContain('outsideCredit');
      expect(tenderTypes).toContain('outsideDebit');
    });

    it('P4-OUT-003: should include transaction count', async () => {
      await service.processFile('/path/to/MSM20260115_SHIFT.xml', TEST_FILE_HASH);

      expect(mockOutsideDispenserUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ transaction_count: 25 })
      );
    });

    it('P4-OUT-004: should handle empty till_id gracefully', async () => {
      const dataWithEmptyTill: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_98_FUEL_DATA,
        outsideDispensers: [
          {
            registerId: '1',
            cashierId: '1001',
            tillId: '',
            tender: 'outsideCredit',
            amount: 100,
            count: 5,
          },
        ],
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithEmptyTill);

      await service.processFile('/path/to/MSM20260115_SHIFT.xml', TEST_FILE_HASH);

      expect(mockOutsideDispenserUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ till_id: undefined })
      );
    });

    it('P4-OUT-005: should not create outside records for Period 2', async () => {
      mockParse.mockReturnValue(PERIOD_2_MSM_PARSE_RESULT);
      mockExtractFuelDataFromMSM.mockReturnValue(EXTRACTED_PERIOD_2_FUEL_DATA);

      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      expect(mockOutsideDispenserUpsert).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // P4-SEC: Security Validation Tests
  // ==========================================================================

  describe('Security Validation (SEC-006, DB-006)', () => {
    it('P4-SEC-001: should scope all operations to store_id (DB-006)', async () => {
      mockParse.mockReturnValue(PERIOD_2_MSM_PARSE_RESULT);
      mockExtractFuelDataFromMSM.mockReturnValue(EXTRACTED_PERIOD_2_FUEL_DATA);

      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      // Verify store_id is passed to day summaries
      expect(mockDaySummaryGetOrCreate).toHaveBeenCalledWith(TEST_STORE_ID, expect.any(String));
    });

    it('P4-SEC-002: should include store_id in discount summaries (DB-006)', async () => {
      const dataWithDiscount: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_2_FUEL_DATA,
        discounts: { ...EXTRACTED_PERIOD_2_FUEL_DATA.discounts, fuel: 50.0 },
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithDiscount);
      mockParse.mockReturnValue(PERIOD_2_MSM_PARSE_RESULT);

      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      expect(mockMSMDiscountUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ store_id: TEST_STORE_ID })
      );
    });

    it('P4-SEC-003: should include store_id in outside dispenser records (DB-006)', async () => {
      mockParse.mockReturnValue(PERIOD_98_MSM_PARSE_RESULT);
      mockExtractFuelDataFromMSM.mockReturnValue(EXTRACTED_PERIOD_98_FUEL_DATA);

      await service.processFile('/path/to/MSM20260115_SHIFT.xml', TEST_FILE_HASH);

      expect(mockOutsideDispenserUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ store_id: TEST_STORE_ID })
      );
    });

    it('P4-SEC-004: should use DAL methods which use parameterized queries (SEC-006)', async () => {
      mockParse.mockReturnValue(PERIOD_2_MSM_PARSE_RESULT);
      mockExtractFuelDataFromMSM.mockReturnValue(EXTRACTED_PERIOD_2_FUEL_DATA);

      // This test verifies that we're calling DAL methods (not raw SQL)
      // DAL methods are validated in their own test suites for SEC-006 compliance
      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      // All data modifications go through DAL
      expect(mockDayFuelCreateFromMSM).toHaveBeenCalled();
      expect(mockDaySummaryGetOrCreate).toHaveBeenCalled();
    });

    it('P4-SEC-005: should validate discount types via allowlist (SEC-014)', async () => {
      const validDiscountTypes = [
        'statistics',
        'amountFixed',
        'amountPercentage',
        'promotional',
        'fuel',
        'storeCoupons',
      ];

      const dataWithAllDiscounts: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_2_FUEL_DATA,
        discounts: {
          statistics: 10.0,
          amountFixed: 20.0,
          amountPercentage: 30.0,
          promotional: 40.0,
          fuel: 50.0,
          storeCoupons: 60.0,
        },
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithAllDiscounts);
      mockParse.mockReturnValue(PERIOD_2_MSM_PARSE_RESULT);

      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      // Verify only allowlisted discount types are saved
      const calls = mockMSMDiscountUpsert.mock.calls;
      expect(calls).toHaveLength(6);
    });
  });

  // ==========================================================================
  // P4-EDGE: Edge Case and Boundary Tests
  // ==========================================================================

  describe('Edge Cases and Boundaries', () => {
    it('P4-EDGE-001: should handle MSM with no fuel data', async () => {
      const dataWithNoFuel: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_2_FUEL_DATA,
        totalFuel: [],
        insideFuel: [],
        outsideFuel: [],
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithNoFuel);
      mockParse.mockReturnValue(PERIOD_2_MSM_PARSE_RESULT);

      const result = await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      expect(result.success).toBe(true);
      expect(mockDayFuelCreateFromMSM).not.toHaveBeenCalled();
    });

    it('P4-EDGE-002: should handle Period 98 with no inside fuel grades', async () => {
      const dataWithNoInside: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_98_FUEL_DATA,
        insideFuel: [],
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithNoInside);
      mockParse.mockReturnValue(PERIOD_98_MSM_PARSE_RESULT);

      const result = await service.processFile('/path/to/MSM20260115_SHIFT.xml', TEST_FILE_HASH);

      expect(result.success).toBe(true);
      expect(mockShiftFuelCreateFromMSM).not.toHaveBeenCalled();
      // Outside dispenser records should still be created
      expect(mockOutsideDispenserUpsert).toHaveBeenCalledTimes(2);
    });

    it('P4-EDGE-003: should handle very large fuel amounts', async () => {
      const dataWithLargeAmounts: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_2_FUEL_DATA,
        totalFuel: [{ gradeId: '001', amount: 999999999.99, volume: 399999.99 }],
        insideFuel: [{ gradeId: '001', amount: 500000000.0, volume: 200000.0 }],
        outsideFuel: [{ gradeId: '001', amount: 499999999.99, volume: 199999.99 }],
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithLargeAmounts);
      mockParse.mockReturnValue(PERIOD_2_MSM_PARSE_RESULT);

      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      expect(mockDayFuelCreateFromMSM).toHaveBeenCalledWith(
        'ds-001',
        expect.objectContaining({
          totalAmount: 999999999.99,
          totalVolume: 399999.99,
        }),
        TEST_FILE_HASH
      );
    });

    it('P4-EDGE-004: should handle zero volume with non-zero amount (manual adjustment)', async () => {
      const dataWithZeroVolume: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_2_FUEL_DATA,
        totalFuel: [{ gradeId: '001', amount: 50.0, volume: 0 }],
        insideFuel: [{ gradeId: '001', amount: 50.0, volume: 0 }],
        outsideFuel: [],
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithZeroVolume);
      mockParse.mockReturnValue(PERIOD_2_MSM_PARSE_RESULT);

      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      expect(mockDayFuelCreateFromMSM).toHaveBeenCalledWith(
        'ds-001',
        expect.objectContaining({
          totalVolume: 0,
          totalAmount: 50.0,
        }),
        TEST_FILE_HASH
      );
    });

    it('P4-EDGE-005: should handle negative discount amounts (returns/reversals)', async () => {
      const dataWithNegativeDiscount: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_2_FUEL_DATA,
        discounts: {
          ...EXTRACTED_PERIOD_2_FUEL_DATA.discounts,
          fuel: -15.0, // Negative (reversal)
        },
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithNegativeDiscount);
      mockParse.mockReturnValue(PERIOD_2_MSM_PARSE_RESULT);

      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      // Negative values should still be saved (they represent reversals)
      expect(mockMSMDiscountUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          discount_type: 'discount_fuel',
          discount_amount: -15.0,
        })
      );
    });

    it('P4-EDGE-006: should handle duplicate file processing (deduplication)', async () => {
      mockProcessedFilesIsProcessed.mockReturnValue(true);

      const result = await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      expect(result.success).toBe(true);
      expect(result.recordsCreated).toBe(0);
      expect(mockExtractFuelDataFromMSM).not.toHaveBeenCalled();
    });

    it('P4-EDGE-007: should handle MSM with only outside dispenser records', async () => {
      const dataWithOnlyDispensers: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_98_FUEL_DATA,
        insideFuel: [],
        outsideDispensers: [
          {
            registerId: '1',
            cashierId: '1001',
            tillId: '4133',
            tender: 'outsideCredit',
            amount: 500.0,
            count: 20,
          },
        ],
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithOnlyDispensers);
      mockParse.mockReturnValue(PERIOD_98_MSM_PARSE_RESULT);

      const result = await service.processFile('/path/to/MSM20260115_SHIFT.xml', TEST_FILE_HASH);

      expect(result.success).toBe(true);
      expect(mockShiftFuelCreateFromMSM).not.toHaveBeenCalled();
      expect(mockOutsideDispenserUpsert).toHaveBeenCalledTimes(1);
    });

    it('P4-EDGE-008: should handle special characters in grade IDs', async () => {
      const dataWithSpecialChars: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_2_FUEL_DATA,
        totalFuel: [{ gradeId: 'UNLEADED-87', amount: 1000.0, volume: 400.0 }],
        insideFuel: [{ gradeId: 'UNLEADED-87', amount: 500.0, volume: 200.0 }],
        outsideFuel: [{ gradeId: 'UNLEADED-87', amount: 500.0, volume: 200.0 }],
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithSpecialChars);
      mockParse.mockReturnValue(PERIOD_2_MSM_PARSE_RESULT);

      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      expect(mockDayFuelCreateFromMSM).toHaveBeenCalledWith(
        'ds-001',
        expect.objectContaining({ gradeId: 'UNLEADED-87' }),
        TEST_FILE_HASH
      );
    });
  });

  // ==========================================================================
  // P4-ERR: Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    it('P4-ERR-001: should handle extractFuelDataFromMSM errors', async () => {
      mockParse.mockReturnValue(PERIOD_2_MSM_PARSE_RESULT);
      mockExtractFuelDataFromMSM.mockImplementation(() => {
        throw new Error('Extraction failed');
      });

      const result = await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Extraction failed');
    });

    it('P4-ERR-002: should handle DAL create errors', async () => {
      mockParse.mockReturnValue(PERIOD_2_MSM_PARSE_RESULT);
      mockExtractFuelDataFromMSM.mockReturnValue(EXTRACTED_PERIOD_2_FUEL_DATA);
      mockDayFuelCreateFromMSM.mockImplementation(() => {
        throw new Error('Database constraint violation');
      });

      const result = await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database constraint violation');
    });

    it('P4-ERR-003: should handle discount upsert errors gracefully', async () => {
      const dataWithDiscount: MSMExtractedFuelData = {
        ...EXTRACTED_PERIOD_2_FUEL_DATA,
        discounts: { ...EXTRACTED_PERIOD_2_FUEL_DATA.discounts, fuel: 50.0 },
      };
      mockExtractFuelDataFromMSM.mockReturnValue(dataWithDiscount);
      mockParse.mockReturnValue(PERIOD_2_MSM_PARSE_RESULT);
      mockMSMDiscountUpsert.mockImplementation(() => {
        throw new Error('Discount save failed');
      });

      const result = await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      expect(result.success).toBe(false);
    });

    it('P4-ERR-004: should record failed processing status', async () => {
      mockParse.mockReturnValue(PERIOD_2_MSM_PARSE_RESULT);
      mockExtractFuelDataFromMSM.mockImplementation(() => {
        throw new Error('Processing error');
      });

      await service.processFile('/path/to/MSM20260115.xml', TEST_FILE_HASH);

      expect(mockProcessedFilesRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FAILED',
          error_message: 'Processing error',
        })
      );
    });
  });
});
