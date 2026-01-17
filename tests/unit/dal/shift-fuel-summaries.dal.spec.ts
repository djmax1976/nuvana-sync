/**
 * Shift Fuel Summaries DAL Unit Tests
 *
 * Enterprise-grade tests for the ShiftFuelSummariesDAL including
 * MSM fuel data enhancements (v014 migration).
 *
 * Test Coverage Matrix:
 * - SFS-CREATE-001 through 010: Create Operation Tests
 * - SFS-UPSERT-001 through 005: Upsert/Deduplication Tests
 * - SFS-MSM-001 through 015: MSM-Specific Method Tests
 * - SFS-QUERY-001 through 010: Query Operation Tests
 * - SFS-AGG-001 through 010: Aggregation Tests
 * - SFS-DEL-001 through 005: Delete Operation Tests
 * - SFS-SEC-001 through 010: Security Tests (SEC-006, DB-006)
 * - SFS-STORE-001 through 025: Store/Date Query Tests (Phase 3 Methods)
 * - SFS-EDGE-001 through 010: Edge Case Tests
 *
 * Test Traceability:
 * - Component: src/main/dal/shift-fuel-summaries.dal.ts
 * - Migration: src/main/migrations/v014_msm_fuel_data.sql
 * - Business Rules: Fuel sales tracking with inside/outside breakdown
 *
 * @module tests/unit/dal/shift-fuel-summaries.dal.spec
 * @security SEC-006: Verifies parameterized queries
 * @security DB-006: Verifies tenant isolation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock Setup - BEFORE importing DAL
// ============================================================================

const mockPrepare = vi.fn();
const mockTransaction = vi.fn((fn) => () => fn());

vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return {
    ...actual,
    randomUUID: vi.fn().mockReturnValue('mock-fuel-summary-uuid'),
  };
});

// Import DAL after mocks
import {
  ShiftFuelSummariesDAL,
  type ShiftFuelSummary,
  type FuelTenderType,
  type FuelSource,
  type CreateShiftFuelSummaryData,
  type MSMShiftFuelInput,
  type MSMFuelTotals,
  type MSMFuelByGrade,
  type FuelGradeAggregation,
} from '../../../src/main/dal/shift-fuel-summaries.dal';

// ============================================================================
// Test Fixtures - Enterprise-Grade Real-World Data
// ============================================================================

/**
 * Base shift fuel summary entity
 * Represents a single fuel grade record within a shift
 */
const mockShiftFuelSummary: ShiftFuelSummary = {
  shift_fuel_summary_id: 'sfs-001',
  shift_summary_id: 'ss-001',
  fuel_grade_id: 'fg-001',
  tender_type: 'ALL' as FuelTenderType,
  sales_volume: 511.908,
  sales_amount: 1472.48,
  discount_amount: 0.48,
  discount_count: 1,
  transaction_count: 12,
  inside_volume: 270.6,
  inside_amount: 808.04,
  outside_volume: 241.308,
  outside_amount: 664.44,
  fuel_source: 'MSM' as FuelSource,
  msm_period: 98,
  msm_secondary_period: 0,
  till_id: '4133',
  register_id: '1',
  unit_price: 2.879,
  grade_id: '001',
  grade_name: 'Regular Unleaded',
  source_file_hash: 'abc123def456',
  created_at: '2026-01-15T14:00:00.000Z',
  updated_at: '2026-01-15T14:00:00.000Z',
};

/**
 * FGM-sourced fuel summary (legacy format without inside/outside)
 */
const mockFGMFuelSummary: ShiftFuelSummary = {
  ...mockShiftFuelSummary,
  shift_fuel_summary_id: 'sfs-fgm-001',
  fuel_source: 'FGM' as FuelSource,
  inside_volume: 0,
  inside_amount: 0,
  outside_volume: 0,
  outside_amount: 0,
  msm_period: null,
  msm_secondary_period: null,
  till_id: null,
  register_id: null,
};

/**
 * Multi-grade fuel data fixture (Regular, Plus, Premium, Diesel)
 * Based on typical convenience store fuel configuration
 */
const multiGradeFuelData: ShiftFuelSummary[] = [
  {
    ...mockShiftFuelSummary,
    shift_fuel_summary_id: 'sfs-reg',
    grade_id: '001',
    grade_name: 'Regular Unleaded',
    sales_volume: 300.0,
    sales_amount: 870.0,
    inside_volume: 150.0,
    inside_amount: 435.0,
    outside_volume: 150.0,
    outside_amount: 435.0,
  },
  {
    ...mockShiftFuelSummary,
    shift_fuel_summary_id: 'sfs-plus',
    grade_id: '002',
    grade_name: 'Plus Unleaded',
    sales_volume: 100.0,
    sales_amount: 310.0,
    inside_volume: 50.0,
    inside_amount: 155.0,
    outside_volume: 50.0,
    outside_amount: 155.0,
  },
  {
    ...mockShiftFuelSummary,
    shift_fuel_summary_id: 'sfs-prem',
    grade_id: '003',
    grade_name: 'Premium Unleaded',
    sales_volume: 80.0,
    sales_amount: 264.0,
    inside_volume: 40.0,
    inside_amount: 132.0,
    outside_volume: 40.0,
    outside_amount: 132.0,
  },
  {
    ...mockShiftFuelSummary,
    shift_fuel_summary_id: 'sfs-dsl',
    grade_id: '300',
    grade_name: 'Diesel',
    sales_volume: 200.0,
    sales_amount: 700.0,
    inside_volume: 100.0,
    inside_amount: 350.0,
    outside_volume: 100.0,
    outside_amount: 350.0,
  },
];

/**
 * MSM shift fuel input fixture
 * Represents parsed MSM Period 98 data ready for DAL insertion
 */
const msmShiftFuelInput: MSMShiftFuelInput = {
  gradeId: '001',
  gradeName: 'Regular Unleaded',
  tenderType: 'ALL',
  totalVolume: 511.908,
  totalAmount: 1472.48,
  insideVolume: 270.6,
  insideAmount: 808.04,
  outsideVolume: 241.308,
  outsideAmount: 664.44,
  discountAmount: 0.48,
  discountCount: 1,
  transactionCount: 12,
  unitPrice: 2.879,
  msmPeriod: 98,
  msmSecondaryPeriod: 0,
  tillId: '4133',
  registerId: '1',
};

// ============================================================================
// Test Suite
// ============================================================================

describe('ShiftFuelSummariesDAL', () => {
  let dal: ShiftFuelSummariesDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new ShiftFuelSummariesDAL();
  });

  // ==========================================================================
  // SFS-CREATE: Create Operation Tests
  // ==========================================================================

  describe('create', () => {
    it('SFS-CREATE-001: should create fuel summary with all required fields', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockShiftFuelSummary) });

      const data: CreateShiftFuelSummaryData = {
        shift_summary_id: 'ss-001',
        tender_type: 'ALL',
        sales_volume: 511.908,
        sales_amount: 1472.48,
      };

      const result = dal.create(data);

      expect(result).toEqual(mockShiftFuelSummary);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO shift_fuel_summaries')
      );
      // SEC-006: Verify parameterized query
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('?'));
    });

    it('SFS-CREATE-002: should create fuel summary with MSM-specific fields (v014)', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockShiftFuelSummary) });

      const data: CreateShiftFuelSummaryData = {
        shift_summary_id: 'ss-001',
        tender_type: 'ALL',
        sales_volume: 511.908,
        sales_amount: 1472.48,
        inside_volume: 270.6,
        inside_amount: 808.04,
        outside_volume: 241.308,
        outside_amount: 664.44,
        fuel_source: 'MSM',
        msm_period: 98,
        msm_secondary_period: 0,
        till_id: '4133',
        register_id: '1',
      };

      const result = dal.create(data);

      expect(result.fuel_source).toBe('MSM');
      expect(result.inside_volume).toBe(270.6);
      expect(result.outside_volume).toBe(241.308);
      expect(result.msm_period).toBe(98);
      expect(result.till_id).toBe('4133');
    });

    it('SFS-CREATE-003: should calculate unit_price when not provided', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const resultWithPrice = { ...mockShiftFuelSummary, unit_price: 2.879 };
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(resultWithPrice) });

      const data: CreateShiftFuelSummaryData = {
        shift_summary_id: 'ss-001',
        tender_type: 'ALL',
        sales_volume: 511.908,
        sales_amount: 1472.48,
        // unit_price not provided - should be calculated
      };

      dal.create(data);

      // Verify unit_price was calculated: 1472.48 / 511.908 ≈ 2.8766
      const callArgs = mockRun.mock.calls[0];
      // unit_price is at index 9 in the INSERT
      expect(callArgs[9]).toBeCloseTo(2.8766, 2);
    });

    it('SFS-CREATE-004: should default inside/outside to 0 when not provided', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockFGMFuelSummary) });

      const data: CreateShiftFuelSummaryData = {
        shift_summary_id: 'ss-001',
        tender_type: 'ALL',
        sales_volume: 511.908,
        sales_amount: 1472.48,
      };

      dal.create(data);

      const callArgs = mockRun.mock.calls[0];
      // inside_volume (index 13), inside_amount (index 14)
      expect(callArgs[13]).toBe(0); // inside_volume
      expect(callArgs[14]).toBe(0); // inside_amount
      expect(callArgs[15]).toBe(0); // outside_volume
      expect(callArgs[16]).toBe(0); // outside_amount
    });

    it('SFS-CREATE-005: should default fuel_source to FGM when not specified', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockFGMFuelSummary) });

      const data: CreateShiftFuelSummaryData = {
        shift_summary_id: 'ss-001',
        tender_type: 'ALL',
        sales_volume: 100.0,
        sales_amount: 290.0,
      };

      dal.create(data);

      const callArgs = mockRun.mock.calls[0];
      // fuel_source is at index 17
      expect(callArgs[17]).toBe('FGM');
    });

    it('SFS-CREATE-006: should throw error if created record cannot be retrieved', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) });

      expect(() =>
        dal.create({
          shift_summary_id: 'ss-001',
          tender_type: 'ALL',
          sales_volume: 100.0,
          sales_amount: 290.0,
        })
      ).toThrow('Failed to retrieve created shift fuel summary');
    });
  });

  // ==========================================================================
  // SFS-UPSERT: Upsert/Deduplication Tests
  // ==========================================================================

  describe('upsert', () => {
    it('SFS-UPSERT-001: should create new record when none exists', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        // First call: findByShiftGradeTender - not found
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) })
        // Second call: create INSERT
        .mockReturnValueOnce({ run: mockRun })
        // Third call: findById after create
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockShiftFuelSummary) });

      const data: CreateShiftFuelSummaryData = {
        shift_summary_id: 'ss-001',
        grade_id: '001',
        tender_type: 'ALL',
        sales_volume: 511.908,
        sales_amount: 1472.48,
      };

      const result = dal.upsert(data);

      expect(result).toEqual(mockShiftFuelSummary);
      expect(mockRun).toHaveBeenCalled(); // INSERT was executed
    });

    it('SFS-UPSERT-002: should skip duplicate and return existing record', () => {
      mockPrepare.mockReturnValue({ get: vi.fn().mockReturnValue(mockShiftFuelSummary) });

      const data: CreateShiftFuelSummaryData = {
        shift_summary_id: 'ss-001',
        grade_id: '001',
        tender_type: 'ALL',
        sales_volume: 100.0, // Different values
        sales_amount: 290.0,
        source_file_hash: 'different-hash',
      };

      const result = dal.upsert(data);

      // Should return existing, not create new
      expect(result).toEqual(mockShiftFuelSummary);
      // Verify INSERT was NOT called (only findByShiftGradeTender was called)
      expect(mockPrepare).toHaveBeenCalledTimes(1);
    });

    it('SFS-UPSERT-003: should handle null fuel_grade_id correctly', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ ...mockShiftFuelSummary, fuel_grade_id: null }),
      });

      const data: CreateShiftFuelSummaryData = {
        shift_summary_id: 'ss-001',
        // fuel_grade_id not provided (null)
        tender_type: 'ALL',
        sales_volume: 100.0,
        sales_amount: 290.0,
      };

      dal.upsert(data);

      // Verify query handles IS NULL
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('fuel_grade_id IS NULL'));
    });
  });

  // ==========================================================================
  // SFS-MSM: MSM-Specific Method Tests (v014)
  // ==========================================================================

  describe('createFromMSM', () => {
    it('SFS-MSM-001: should create from MSM parsed data with inside/outside breakdown', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) }) // findByShiftGradeTender
        .mockReturnValueOnce({ run: mockRun }) // INSERT
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockShiftFuelSummary) }); // findById

      const result = dal.createFromMSM('ss-001', msmShiftFuelInput, 'file-hash-123');

      expect(result).toBe(mockShiftFuelSummary.shift_fuel_summary_id);

      // Verify MSM-specific parameters
      const callArgs = mockRun.mock.calls[0];
      expect(callArgs).toContain('MSM'); // fuel_source
      expect(callArgs).toContain(98); // msm_period
      expect(callArgs).toContain('4133'); // till_id
    });

    it('SFS-MSM-002: should set fuel_source to MSM', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) })
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockShiftFuelSummary) });

      dal.createFromMSM('ss-001', msmShiftFuelInput);

      const callArgs = mockRun.mock.calls[0];
      // fuel_source at index 17
      expect(callArgs[17]).toBe('MSM');
    });

    it('SFS-MSM-003: should include MSM period metadata', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) })
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockShiftFuelSummary) });

      dal.createFromMSM('ss-001', {
        ...msmShiftFuelInput,
        msmPeriod: 98,
        msmSecondaryPeriod: 5,
      });

      const callArgs = mockRun.mock.calls[0];
      expect(callArgs[18]).toBe(98); // msm_period
      expect(callArgs[19]).toBe(5); // msm_secondary_period
    });
  });

  describe('getMSMShiftTotals', () => {
    it('SFS-MSM-004: should return MSM fuel totals with inside/outside breakdown', () => {
      const aggregateResult = {
        total_volume: 511.908,
        total_amount: 1472.48,
        total_discount: 0.48,
        transaction_count: 12,
        inside_volume: 270.6,
        inside_amount: 808.04,
        outside_volume: 241.308,
        outside_amount: 664.44,
      };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(aggregateResult),
      });

      const result = dal.getMSMShiftTotals('ss-001');

      expect(result.totalVolume).toBe(511.908);
      expect(result.totalAmount).toBe(1472.48);
      expect(result.insideVolume).toBe(270.6);
      expect(result.insideAmount).toBe(808.04);
      expect(result.outsideVolume).toBe(241.308);
      expect(result.outsideAmount).toBe(664.44);
    });

    it('SFS-MSM-005: should calculate average price from totals', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          total_volume: 500.0,
          total_amount: 1500.0,
          total_discount: 0,
          transaction_count: 10,
          inside_volume: 250.0,
          inside_amount: 750.0,
          outside_volume: 250.0,
          outside_amount: 750.0,
        }),
      });

      const result = dal.getMSMShiftTotals('ss-001');

      expect(result.averagePrice).toBe(3.0); // 1500 / 500
    });

    it('SFS-MSM-006: should return 0 average price when volume is 0', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          total_volume: 0,
          total_amount: 0,
          total_discount: 0,
          transaction_count: 0,
          inside_volume: 0,
          inside_amount: 0,
          outside_volume: 0,
          outside_amount: 0,
        }),
      });

      const result = dal.getMSMShiftTotals('ss-001');

      expect(result.averagePrice).toBe(0);
      expect(result.totalVolume).toBe(0);
    });
  });

  describe('getMSMFuelByGrade', () => {
    it('SFS-MSM-007: should return per-grade breakdown with inside/outside', () => {
      const gradeResults = [
        {
          grade_id: '001',
          grade_name: 'Regular Unleaded',
          total_volume: 300.0,
          total_amount: 870.0,
          inside_volume: 150.0,
          inside_amount: 435.0,
          outside_volume: 150.0,
          outside_amount: 435.0,
          discount_amount: 0.24,
          average_price: 2.9,
        },
        {
          grade_id: '003',
          grade_name: 'Premium Unleaded',
          total_volume: 100.0,
          total_amount: 330.0,
          inside_volume: 50.0,
          inside_amount: 165.0,
          outside_volume: 50.0,
          outside_amount: 165.0,
          discount_amount: 0.12,
          average_price: 3.3,
        },
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(gradeResults),
      });

      const result = dal.getMSMFuelByGrade('ss-001');

      expect(result).toHaveLength(2);
      expect(result[0].gradeId).toBe('001');
      expect(result[0].insideVolume).toBe(150.0);
      expect(result[0].outsideVolume).toBe(150.0);
      expect(result[1].gradeId).toBe('003');
    });

    it('SFS-MSM-008: should order by total_amount DESC', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.getMSMFuelByGrade('ss-001');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY total_amount DESC')
      );
    });
  });

  describe('findMSMByShiftSummary', () => {
    it('SFS-MSM-009: should find only MSM-sourced records', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([mockShiftFuelSummary]),
      });

      dal.findMSMByShiftSummary('ss-001');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("fuel_source = 'MSM'"));
    });
  });

  describe('findByTillId', () => {
    it('SFS-MSM-010: should find records by till ID with store scoping', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([mockShiftFuelSummary]),
      });

      dal.findByTillId('store-456', '2026-01-15', '4133');

      // SEC-006: Parameterized
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('?'));
      // DB-006: Store-scoped via join
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ss.store_id = ?'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('sfs.till_id = ?'));
    });
  });

  describe('hasMSMData', () => {
    it('SFS-MSM-011: should return true when MSM data exists', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ 1: 1 }),
      });

      const result = dal.hasMSMData('ss-001');

      expect(result).toBe(true);
    });

    it('SFS-MSM-012: should return false when no MSM data exists', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.hasMSMData('ss-001');

      expect(result).toBe(false);
    });
  });

  describe('deleteMSMByShiftSummary', () => {
    it('SFS-MSM-013: should delete only MSM-sourced records', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 3 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deleteMSMByShiftSummary('ss-001');

      expect(result).toBe(3);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("fuel_source = 'MSM'"));
    });
  });

  // ==========================================================================
  // SFS-QUERY: Query Operation Tests
  // ==========================================================================

  describe('findByShiftGradeTender', () => {
    it('SFS-QUERY-001: should find by shift, grade, and tender type', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockShiftFuelSummary),
      });

      const result = dal.findByShiftGradeTender('ss-001', '001', 'ALL');

      expect(result).toEqual(mockShiftFuelSummary);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE shift_summary_id = ?')
      );
    });

    it('SFS-QUERY-002: should handle null fuel_grade_id with IS NULL', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ ...mockShiftFuelSummary, fuel_grade_id: null }),
      });

      dal.findByShiftGradeTender('ss-001', null, 'ALL');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('fuel_grade_id IS NULL'));
    });

    it('SFS-QUERY-003: should check both fuel_grade_id and grade_id', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockShiftFuelSummary),
      });

      dal.findByShiftGradeTender('ss-001', '001', 'ALL');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('(fuel_grade_id = ? OR grade_id = ?)')
      );
    });
  });

  describe('findByShiftSummary', () => {
    it('SFS-QUERY-004: should return all summaries for a shift', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(multiGradeFuelData),
      });

      const result = dal.findByShiftSummary('ss-001');

      expect(result).toHaveLength(4);
    });

    it('SFS-QUERY-005: should order by grade_id ASC, tender_type ASC', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.findByShiftSummary('ss-001');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY grade_id ASC, tender_type ASC')
      );
    });
  });

  // ==========================================================================
  // SFS-AGG: Aggregation Tests
  // ==========================================================================

  describe('getAggregateByGrade', () => {
    it('SFS-AGG-001: should aggregate totals by grade', () => {
      const aggregateResults = [
        {
          grade_id: '001',
          grade_name: 'Regular',
          total_volume: 300.0,
          total_sales: 900.0,
          total_discount: 0.5,
          transaction_count: 10,
          average_price: 3.0,
        },
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(aggregateResults),
      });

      const result = dal.getAggregateByGrade('ss-001');

      expect(result[0].gradeId).toBe('001');
      expect(result[0].totalVolume).toBe(300.0);
      expect(result[0].totalSales).toBe(900.0);
      expect(result[0].averagePrice).toBe(3.0);
    });

    it('SFS-AGG-002: should use COALESCE for null-safe aggregation', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.getAggregateByGrade('ss-001');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('COALESCE(fuel_grade_id, grade_id)')
      );
    });
  });

  describe('getShiftTotals', () => {
    it('SFS-AGG-003: should return shift totals', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          total_volume: 511.908,
          total_sales: 1472.48,
          total_discount: 0.48,
          transaction_count: 12,
        }),
      });

      const result = dal.getShiftTotals('ss-001');

      expect(result.totalVolume).toBe(511.908);
      expect(result.totalSales).toBe(1472.48);
      expect(result.totalDiscount).toBe(0.48);
      expect(result.transactionCount).toBe(12);
    });

    it('SFS-AGG-004: should use COALESCE for null safety', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          total_volume: 0,
          total_sales: 0,
          total_discount: 0,
          transaction_count: 0,
        }),
      });

      dal.getShiftTotals('ss-001');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('COALESCE(SUM(sales_volume), 0)')
      );
    });
  });

  // ==========================================================================
  // SFS-DEL: Delete Operation Tests
  // ==========================================================================

  describe('deleteBySourceFileHash', () => {
    it('SFS-DEL-001: should delete by source file hash', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 5 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deleteBySourceFileHash('abc123def456');

      expect(result).toBe(5);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM shift_fuel_summaries WHERE source_file_hash = ?')
      );
    });
  });

  describe('deleteByShiftSummary', () => {
    it('SFS-DEL-002: should delete all summaries for a shift', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 4 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deleteByShiftSummary('ss-001');

      expect(result).toBe(4);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM shift_fuel_summaries WHERE shift_summary_id = ?')
      );
    });
  });

  describe('deleteAllForStore', () => {
    it('SFS-DEL-003: should delete all summaries for store via subquery', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 50 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deleteAllForStore('store-456');

      expect(result).toBe(50);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE shift_summary_id IN')
      );
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT shift_summary_id FROM shift_summaries WHERE store_id = ?')
      );
    });
  });

  // ==========================================================================
  // SFS-SEC: Security Tests - SEC-006 SQL Injection Prevention
  // ==========================================================================

  describe('SEC-006: SQL Injection Prevention', () => {
    const INJECTION_PAYLOADS = [
      "'; DROP TABLE shift_fuel_summaries;--",
      "1' OR '1'='1",
      "1; DELETE FROM shift_summaries WHERE '1'='1",
      "' UNION SELECT * FROM users--",
      "admin'--",
      "'; UPDATE shift_fuel_summaries SET sales_amount=0;--",
    ];

    it.each(INJECTION_PAYLOADS)(
      'SFS-SEC-001: should safely handle malicious input: %s',
      (payload) => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue(undefined),
        });

        // Call method with injection payload
        dal.findByShiftGradeTender(payload, payload, 'ALL');

        // Verify query is parameterized
        const query = mockPrepare.mock.calls[0][0];
        expect(query).not.toContain('DROP');
        expect(query).not.toContain('DELETE');
        expect(query).not.toContain('UNION');
        expect(query).not.toContain('UPDATE');
        expect(query).toContain('?');
      }
    );

    it('SFS-SEC-002: should use parameterized queries for all create operations', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockShiftFuelSummary) });

      dal.create({
        shift_summary_id: "'; DROP TABLE--",
        tender_type: 'ALL',
        sales_volume: 100,
        sales_amount: 290,
        grade_id: "' OR '1'='1",
      });

      const query = mockPrepare.mock.calls[0][0];
      expect(query).toContain(
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      expect(query).not.toMatch(/\$\{.*\}/); // No template literal interpolation
    });

    it('SFS-SEC-003: should use parameterized queries for all delete operations', () => {
      mockPrepare.mockReturnValue({ run: vi.fn().mockReturnValue({ changes: 0 }) });

      dal.deleteBySourceFileHash("'; DROP TABLE;--");
      dal.deleteByShiftSummary("1' OR '1'='1");
      dal.deleteAllForStore("'; DELETE FROM stores;--");

      const calls = mockPrepare.mock.calls;
      calls.forEach((call) => {
        expect(call[0]).toContain('?');
        expect(call[0]).not.toMatch(/\$\{.*\}/);
      });
    });

    it('SFS-SEC-004: should use parameterized queries for aggregate operations', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          total_volume: 0,
          total_amount: 0,
          total_discount: 0,
          transaction_count: 0,
          inside_volume: 0,
          inside_amount: 0,
          outside_volume: 0,
          outside_amount: 0,
        }),
      });

      dal.getMSMShiftTotals("'; DROP TABLE;--");
      dal.getShiftTotals("1' OR '1'='1");

      const calls = mockPrepare.mock.calls;
      calls.forEach((call) => {
        expect(call[0]).toContain('WHERE shift_summary_id = ?');
      });
    });
  });

  // ==========================================================================
  // SFS-SEC: Security Tests - DB-006 Tenant Isolation
  // ==========================================================================

  describe('DB-006: Tenant Isolation', () => {
    it('SFS-SEC-005: should scope findByTillId by store_id', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.findByTillId('store-456', '2026-01-15', '4133');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ss.store_id = ?'));
    });

    it('SFS-SEC-006: should scope deleteAllForStore via shift_summaries.store_id', () => {
      mockPrepare.mockReturnValue({ run: vi.fn().mockReturnValue({ changes: 0 }) });

      dal.deleteAllForStore('store-456');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('shift_summaries WHERE store_id = ?')
      );
    });
  });

  // ==========================================================================
  // SFS-STORE: Store/Date Query Tests (Phase 3 Methods)
  // ==========================================================================

  describe('findByBusinessDate', () => {
    it('SFS-STORE-001: should find shift fuel summaries by store and business date', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(multiGradeFuelData),
      });

      const result = dal.findByBusinessDate('store-456', '2026-01-15');

      expect(result).toHaveLength(4);
      expect(result[0].grade_id).toBe('001');
      // SEC-006: Verify parameterized query
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('?'));
    });

    it('SFS-STORE-002: should join to shift_summaries for tenant isolation (DB-006)', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.findByBusinessDate('store-456', '2026-01-15');

      // DB-006: Store-scoped via join
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INNER JOIN shift_summaries'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ss.store_id = ?'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ss.business_date = ?'));
    });

    it('SFS-STORE-003: should order results by shift_summary_id, grade_id, tender_type', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.findByBusinessDate('store-456', '2026-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY ss.shift_summary_id ASC, sfs.grade_id ASC, sfs.tender_type ASC')
      );
    });

    it('SFS-STORE-004: should return empty array when no data exists', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const result = dal.findByBusinessDate('store-456', '2026-01-15');

      expect(result).toEqual([]);
    });

    it('SFS-STORE-005: should safely handle SQL injection in parameters (SEC-006)', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.findByBusinessDate("'; DROP TABLE shift_summaries;--", "2026-01-15' OR '1'='1");

      const query = mockPrepare.mock.calls[0][0];
      expect(query).not.toContain('DROP');
      expect(query).toContain('?');
    });
  });

  describe('getTotalsByBusinessDate', () => {
    it('SFS-STORE-006: should return aggregated shift totals with inside/outside', () => {
      const aggregateResult = {
        total_volume: 680.0,
        total_amount: 2144.0,
        total_discount: 0.96,
        transaction_count: 24,
        inside_volume: 340.0,
        inside_amount: 1072.0,
        outside_volume: 340.0,
        outside_amount: 1072.0,
      };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(aggregateResult),
      });

      const result = dal.getTotalsByBusinessDate('store-456', '2026-01-15');

      expect(result.totalVolume).toBe(680.0);
      expect(result.totalAmount).toBe(2144.0);
      expect(result.totalDiscount).toBe(0.96);
      expect(result.transactionCount).toBe(24);
      expect(result.insideVolume).toBe(340.0);
      expect(result.insideAmount).toBe(1072.0);
      expect(result.outsideVolume).toBe(340.0);
      expect(result.outsideAmount).toBe(1072.0);
    });

    it('SFS-STORE-007: should calculate average price from totals', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          total_volume: 500.0,
          total_amount: 1500.0,
          total_discount: 0,
          transaction_count: 10,
          inside_volume: 250.0,
          inside_amount: 750.0,
          outside_volume: 250.0,
          outside_amount: 750.0,
        }),
      });

      const result = dal.getTotalsByBusinessDate('store-456', '2026-01-15');

      expect(result.averagePrice).toBe(3.0); // 1500 / 500
    });

    it('SFS-STORE-008: should return zero average price when volume is zero', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          total_volume: 0,
          total_amount: 0,
          total_discount: 0,
          transaction_count: 0,
          inside_volume: 0,
          inside_amount: 0,
          outside_volume: 0,
          outside_amount: 0,
        }),
      });

      const result = dal.getTotalsByBusinessDate('store-456', '2026-01-15');

      expect(result.totalVolume).toBe(0);
      expect(result.averagePrice).toBe(0);
    });

    it('SFS-STORE-009: should use COALESCE for null-safe aggregation', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          total_volume: 0,
          total_amount: 0,
          total_discount: 0,
          transaction_count: 0,
          inside_volume: 0,
          inside_amount: 0,
          outside_volume: 0,
          outside_amount: 0,
        }),
      });

      dal.getTotalsByBusinessDate('store-456', '2026-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('COALESCE(SUM(sfs.sales_volume), 0)')
      );
    });

    it('SFS-STORE-010: should scope by store and date (DB-006)', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          total_volume: 0,
          total_amount: 0,
          total_discount: 0,
          transaction_count: 0,
          inside_volume: 0,
          inside_amount: 0,
          outside_volume: 0,
          outside_amount: 0,
        }),
      });

      dal.getTotalsByBusinessDate('store-456', '2026-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ss.store_id = ?'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ss.business_date = ?'));
    });
  });

  describe('getByGradeForBusinessDate', () => {
    it('SFS-STORE-011: should return per-grade breakdown with inside/outside', () => {
      const gradeResults = [
        {
          grade_id: '001',
          grade_name: 'Regular Unleaded',
          total_volume: 300.0,
          total_amount: 870.0,
          inside_volume: 150.0,
          inside_amount: 435.0,
          outside_volume: 150.0,
          outside_amount: 435.0,
          discount_amount: 0.24,
          average_price: 2.9,
        },
        {
          grade_id: '003',
          grade_name: 'Premium Unleaded',
          total_volume: 80.0,
          total_amount: 264.0,
          inside_volume: 40.0,
          inside_amount: 132.0,
          outside_volume: 40.0,
          outside_amount: 132.0,
          discount_amount: 0.12,
          average_price: 3.3,
        },
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(gradeResults),
      });

      const result = dal.getByGradeForBusinessDate('store-456', '2026-01-15');

      expect(result).toHaveLength(2);
      expect(result[0].gradeId).toBe('001');
      expect(result[0].gradeName).toBe('Regular Unleaded');
      expect(result[0].totalVolume).toBe(300.0);
      expect(result[0].insideVolume).toBe(150.0);
      expect(result[0].outsideVolume).toBe(150.0);
      expect(result[1].gradeId).toBe('003');
    });

    it('SFS-STORE-012: should order by total_amount DESC', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.getByGradeForBusinessDate('store-456', '2026-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY total_amount DESC')
      );
    });

    it('SFS-STORE-013: should use COALESCE for grade_id lookup', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.getByGradeForBusinessDate('store-456', '2026-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('COALESCE(sfs.fuel_grade_id, sfs.grade_id)')
      );
    });

    it('SFS-STORE-014: should return empty array when no grades exist', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const result = dal.getByGradeForBusinessDate('store-456', '2026-01-15');

      expect(result).toEqual([]);
    });

    it('SFS-STORE-015: should scope by store and date (DB-006)', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.getByGradeForBusinessDate('store-456', '2026-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INNER JOIN shift_summaries'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ss.store_id = ?'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ss.business_date = ?'));
    });
  });

  describe('findMSMByBusinessDate', () => {
    it('SFS-STORE-016: should find only MSM-sourced records by business date', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([mockShiftFuelSummary]),
      });

      dal.findMSMByBusinessDate('store-456', '2026-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("sfs.fuel_source = 'MSM'"));
    });

    it('SFS-STORE-017: should scope by store and date (DB-006)', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.findMSMByBusinessDate('store-456', '2026-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ss.store_id = ?'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ss.business_date = ?'));
    });

    it('SFS-STORE-018: should order results by shift and grade', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.findMSMByBusinessDate('store-456', '2026-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY ss.shift_summary_id ASC, sfs.grade_id ASC')
      );
    });

    it('SFS-STORE-019: should return empty array when no MSM data', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const result = dal.findMSMByBusinessDate('store-456', '2026-01-15');

      expect(result).toEqual([]);
    });
  });

  describe('hasMSMDataForBusinessDate', () => {
    it('SFS-STORE-020: should return true when MSM data exists for date', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ 1: 1 }),
      });

      const result = dal.hasMSMDataForBusinessDate('store-456', '2026-01-15');

      expect(result).toBe(true);
    });

    it('SFS-STORE-021: should return false when no MSM data for date', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.hasMSMDataForBusinessDate('store-456', '2026-01-15');

      expect(result).toBe(false);
    });

    it('SFS-STORE-022: should filter for MSM fuel_source', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      dal.hasMSMDataForBusinessDate('store-456', '2026-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("sfs.fuel_source = 'MSM'"));
    });

    it('SFS-STORE-023: should scope by store and date (DB-006)', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      dal.hasMSMDataForBusinessDate('store-456', '2026-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ss.store_id = ?'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ss.business_date = ?'));
    });

    it('SFS-STORE-024: should use LIMIT 1 for existence check efficiency', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      dal.hasMSMDataForBusinessDate('store-456', '2026-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('LIMIT 1'));
    });

    it('SFS-STORE-025: should safely handle SQL injection (SEC-006)', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      dal.hasMSMDataForBusinessDate("'; DROP TABLE;--", "' OR '1'='1");

      const query = mockPrepare.mock.calls[0][0];
      expect(query).not.toContain('DROP');
      expect(query).toContain('?');
    });
  });

  // ==========================================================================
  // SFS-EDGE: Edge Case Tests
  // ==========================================================================

  describe('Edge Cases', () => {
    it('SFS-EDGE-001: should handle empty result set', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const result = dal.findByShiftSummary('nonexistent-ss');

      expect(result).toEqual([]);
    });

    it('SFS-EDGE-002: should handle zero volume with non-zero amount', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({
        get: vi.fn().mockReturnValue({
          ...mockShiftFuelSummary,
          sales_volume: 0,
          sales_amount: 10.0,
          unit_price: null,
        }),
      });

      const result = dal.create({
        shift_summary_id: 'ss-001',
        tender_type: 'ALL',
        sales_volume: 0,
        sales_amount: 10.0, // Possible manual adjustment
      });

      // unit_price should be null when volume is 0
      const callArgs = mockRun.mock.calls[0];
      expect(callArgs[9]).toBeNull();
    });

    it('SFS-EDGE-003: should handle very large fuel volumes', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({
        get: vi.fn().mockReturnValue({
          ...mockShiftFuelSummary,
          sales_volume: 999999.999,
          sales_amount: 2999999.97,
        }),
      });

      const result = dal.create({
        shift_summary_id: 'ss-001',
        tender_type: 'ALL',
        sales_volume: 999999.999,
        sales_amount: 2999999.97,
      });

      expect(result.sales_volume).toBe(999999.999);
    });

    it('SFS-EDGE-004: should handle all tender types', () => {
      const tenderTypes: FuelTenderType[] = ['CASH', 'CREDIT', 'DEBIT', 'FLEET', 'OTHER', 'ALL'];

      tenderTypes.forEach((tenderType) => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue({ ...mockShiftFuelSummary, tender_type: tenderType }),
        });

        const result = dal.findByShiftGradeTender('ss-001', '001', tenderType);
        expect(result?.tender_type).toBe(tenderType);
      });
    });

    it('SFS-EDGE-005: should handle all fuel sources', () => {
      const fuelSources: FuelSource[] = ['FGM', 'MSM', 'PJR', 'MANUAL'];

      fuelSources.forEach((source) => {
        const mockRun = vi.fn().mockReturnValue({ changes: 1 });
        mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ ...mockShiftFuelSummary, fuel_source: source }),
        });

        const result = dal.create({
          shift_summary_id: 'ss-001',
          tender_type: 'ALL',
          sales_volume: 100,
          sales_amount: 300,
          fuel_source: source,
        });

        expect(result.fuel_source).toBe(source);
      });
    });

    it('SFS-EDGE-006: should handle inside-only fuel (no outside)', () => {
      const insideOnlySummary = {
        ...mockShiftFuelSummary,
        inside_volume: 500.0,
        inside_amount: 1500.0,
        outside_volume: 0,
        outside_amount: 0,
      };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(insideOnlySummary),
      });

      const result = dal.findByShiftGradeTender('ss-001', '001', 'CASH');

      expect(result?.inside_volume).toBe(500.0);
      expect(result?.outside_volume).toBe(0);
    });

    it('SFS-EDGE-007: should handle outside-only fuel (no inside)', () => {
      const outsideOnlySummary = {
        ...mockShiftFuelSummary,
        inside_volume: 0,
        inside_amount: 0,
        outside_volume: 500.0,
        outside_amount: 1500.0,
      };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(outsideOnlySummary),
      });

      const result = dal.findByShiftGradeTender('ss-001', '001', 'CREDIT');

      expect(result?.inside_volume).toBe(0);
      expect(result?.outside_volume).toBe(500.0);
    });
  });
});
