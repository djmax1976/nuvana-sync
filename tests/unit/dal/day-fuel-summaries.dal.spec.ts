/**
 * Day Fuel Summaries DAL Unit Tests
 *
 * Enterprise-grade tests for the DayFuelSummariesDAL.
 * Tests daily fuel summary operations with MSM data support (v014 migration).
 *
 * Test Coverage Matrix:
 * - DFS-CREATE-001 through 010: Create Operation Tests
 * - DFS-UPSERT-001 through 005: Upsert/Deduplication Tests
 * - DFS-MSM-001 through 015: MSM-Specific Method Tests
 * - DFS-QUERY-001 through 010: Query Operation Tests
 * - DFS-AGG-001 through 010: Aggregation Tests
 * - DFS-DEL-001 through 005: Delete Operation Tests
 * - DFS-SEC-001 through 010: Security Tests (SEC-006, DB-006)
 * - DFS-STORE-001 through 015: Store/Date Query Tests (Phase 3 Methods)
 * - DFS-EDGE-001 through 010: Edge Case Tests
 *
 * Test Traceability:
 * - Component: src/main/dal/day-fuel-summaries.dal.ts
 * - Migration: src/main/migrations/v014_msm_fuel_data.sql
 * - Business Rules: Daily fuel aggregation with inside/outside breakdown
 *
 * @module tests/unit/dal/day-fuel-summaries.dal.spec
 * @security SEC-006: Verifies parameterized queries
 * @security DB-006: Verifies tenant isolation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock Setup - BEFORE importing DAL
// Use vi.hoisted() to ensure mock functions are available when vi.mock runs
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
// ============================================================================

const { mockPrepare, mockTransaction } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn((fn: () => void) => () => fn()),
}));

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
    randomUUID: vi.fn().mockReturnValue('mock-day-fuel-summary-uuid'),
  };
});

// Import DAL after mocks
import {
  DayFuelSummariesDAL,
  type DayFuelSummary,
  type CreateDayFuelSummaryData,
  type MSMDayFuelInput,
  type DayFuelTotals as _DayFuelTotals,
  type DayFuelByGrade as _DayFuelByGrade,
  type DayFuelSource,
} from '../../../src/main/dal/day-fuel-summaries.dal';

// ============================================================================
// Test Fixtures - Enterprise-Grade Real-World Data
// ============================================================================

/**
 * Base day fuel summary entity
 * Represents daily fuel totals for a single grade from MSM Period 1 data
 */
const mockDayFuelSummary: DayFuelSummary = {
  day_fuel_summary_id: 'dfs-001',
  day_summary_id: 'ds-001',
  fuel_grade_id: 'fg-001',
  total_volume: 1500.0,
  total_sales: 4350.0,
  total_discount: 1.25,
  cash_volume: 600.0,
  cash_sales: 1740.0,
  credit_volume: 700.0,
  credit_sales: 2030.0,
  debit_volume: 200.0,
  debit_sales: 580.0,
  inside_volume: 800.0,
  inside_amount: 2320.0,
  outside_volume: 700.0,
  outside_amount: 2030.0,
  fuel_discount_amount: 1.25,
  meter_volume: 1510.0,
  book_volume: 1500.0,
  variance_volume: 10.0,
  variance_amount: 29.0,
  fuel_source: 'MSM' as DayFuelSource,
  source_file_hash: 'daily-hash-123',
  grade_id: '001',
  grade_name: 'Regular Unleaded',
  created_at: '2026-01-15T23:59:59.000Z',
  updated_at: '2026-01-15T23:59:59.000Z',
};

/**
 * FGM-sourced day fuel summary (legacy without inside/outside)
 */
const mockFGMDayFuelSummary: DayFuelSummary = {
  ...mockDayFuelSummary,
  day_fuel_summary_id: 'dfs-fgm-001',
  fuel_source: 'FGM' as DayFuelSource,
  inside_volume: 0,
  inside_amount: 0,
  outside_volume: 0,
  outside_amount: 0,
  fuel_discount_amount: 0,
  source_file_hash: null,
};

/**
 * Multi-grade daily fuel data fixture
 * Based on typical convenience store daily fuel report
 */
const multiGradeDailyData: DayFuelSummary[] = [
  {
    ...mockDayFuelSummary,
    day_fuel_summary_id: 'dfs-reg',
    grade_id: '001',
    grade_name: 'Regular Unleaded',
    total_volume: 1500.0,
    total_sales: 4350.0,
    inside_volume: 800.0,
    inside_amount: 2320.0,
    outside_volume: 700.0,
    outside_amount: 2030.0,
  },
  {
    ...mockDayFuelSummary,
    day_fuel_summary_id: 'dfs-plus',
    grade_id: '002',
    grade_name: 'Plus Unleaded',
    total_volume: 500.0,
    total_sales: 1550.0,
    inside_volume: 250.0,
    inside_amount: 775.0,
    outside_volume: 250.0,
    outside_amount: 775.0,
  },
  {
    ...mockDayFuelSummary,
    day_fuel_summary_id: 'dfs-prem',
    grade_id: '003',
    grade_name: 'Premium Unleaded',
    total_volume: 300.0,
    total_sales: 990.0,
    inside_volume: 150.0,
    inside_amount: 495.0,
    outside_volume: 150.0,
    outside_amount: 495.0,
  },
  {
    ...mockDayFuelSummary,
    day_fuel_summary_id: 'dfs-dsl',
    grade_id: '300',
    grade_name: 'Diesel',
    total_volume: 800.0,
    total_sales: 2800.0,
    inside_volume: 400.0,
    inside_amount: 1400.0,
    outside_volume: 400.0,
    outside_amount: 1400.0,
  },
];

/**
 * MSM day fuel input fixture
 * Represents parsed MSM Period 1 data ready for DAL insertion
 */
const msmDayFuelInput: MSMDayFuelInput = {
  gradeId: '001',
  gradeName: 'Regular Unleaded',
  totalVolume: 1500.0,
  totalAmount: 4350.0,
  insideVolume: 800.0,
  insideAmount: 2320.0,
  outsideVolume: 700.0,
  outsideAmount: 2030.0,
  discountAmount: 1.25,
};

// ============================================================================
// Test Suite
// ============================================================================

describe('DayFuelSummariesDAL', () => {
  let dal: DayFuelSummariesDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new DayFuelSummariesDAL();
  });

  // ==========================================================================
  // DFS-CREATE: Create Operation Tests
  // ==========================================================================

  describe('create', () => {
    it('DFS-CREATE-001: should create day fuel summary with all required fields', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockDayFuelSummary) });

      const data: CreateDayFuelSummaryData = {
        day_summary_id: 'ds-001',
        total_volume: 1500.0,
        total_sales: 4350.0,
      };

      const result = dal.create(data);

      expect(result).toEqual(mockDayFuelSummary);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO day_fuel_summaries')
      );
      // SEC-006: Verify parameterized query
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('?'));
    });

    it('DFS-CREATE-002: should create day fuel summary with MSM-specific fields (v014)', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockDayFuelSummary) });

      const data: CreateDayFuelSummaryData = {
        day_summary_id: 'ds-001',
        total_volume: 1500.0,
        total_sales: 4350.0,
        inside_volume: 800.0,
        inside_amount: 2320.0,
        outside_volume: 700.0,
        outside_amount: 2030.0,
        fuel_source: 'MSM',
        fuel_discount_amount: 1.25,
      };

      const result = dal.create(data);

      expect(result.fuel_source).toBe('MSM');
      expect(result.inside_volume).toBe(800.0);
      expect(result.outside_volume).toBe(700.0);
    });

    it('DFS-CREATE-003: should default inside/outside to 0 when not provided', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockFGMDayFuelSummary) });

      const data: CreateDayFuelSummaryData = {
        day_summary_id: 'ds-001',
        total_volume: 1500.0,
        total_sales: 4350.0,
      };

      dal.create(data);

      const callArgs = mockRun.mock.calls[0];
      // Check inside/outside defaults
      expect(callArgs[12]).toBe(0); // inside_volume
      expect(callArgs[13]).toBe(0); // inside_amount
      expect(callArgs[14]).toBe(0); // outside_volume
      expect(callArgs[15]).toBe(0); // outside_amount
    });

    it('DFS-CREATE-004: should default fuel_source to FGM when not specified', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockFGMDayFuelSummary) });

      const data: CreateDayFuelSummaryData = {
        day_summary_id: 'ds-001',
        total_volume: 1500.0,
        total_sales: 4350.0,
      };

      dal.create(data);

      const callArgs = mockRun.mock.calls[0];
      // fuel_source at index 17
      expect(callArgs[17]).toBe('FGM');
    });

    it('DFS-CREATE-005: should throw error if created record cannot be retrieved', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) });

      expect(() =>
        dal.create({
          day_summary_id: 'ds-001',
          total_volume: 1500.0,
          total_sales: 4350.0,
        })
      ).toThrow('Failed to retrieve created day fuel summary');
    });

    it('DFS-CREATE-006: should include reconciliation fields when provided', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockDayFuelSummary) });

      const data: CreateDayFuelSummaryData = {
        day_summary_id: 'ds-001',
        total_volume: 1500.0,
        total_sales: 4350.0,
        meter_volume: 1510.0,
        book_volume: 1500.0,
        variance_volume: 10.0,
        variance_amount: 29.0,
      };

      dal.create(data);

      const callArgs = mockRun.mock.calls[0];
      // meter_volume at index 19
      expect(callArgs[19]).toBe(1510.0);
      expect(callArgs[20]).toBe(1500.0); // book_volume
      expect(callArgs[21]).toBe(10.0); // variance_volume
      expect(callArgs[22]).toBe(29.0); // variance_amount
    });
  });

  // ==========================================================================
  // DFS-UPSERT: Upsert/Deduplication Tests
  // ==========================================================================

  describe('upsert', () => {
    it('DFS-UPSERT-001: should create new record when none exists', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        // First call: findByDaySummaryAndGrade - not found
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) })
        // Second call: create INSERT
        .mockReturnValueOnce({ run: mockRun })
        // Third call: findById after create
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockDayFuelSummary) });

      const data: CreateDayFuelSummaryData = {
        day_summary_id: 'ds-001',
        grade_id: '001',
        total_volume: 1500.0,
        total_sales: 4350.0,
      };

      const result = dal.upsert(data);

      expect(result).toEqual(mockDayFuelSummary);
      expect(mockRun).toHaveBeenCalled(); // INSERT was executed
    });

    it('DFS-UPSERT-002: should skip duplicate and return existing record', () => {
      mockPrepare.mockReturnValue({ get: vi.fn().mockReturnValue(mockDayFuelSummary) });

      const data: CreateDayFuelSummaryData = {
        day_summary_id: 'ds-001',
        grade_id: '001',
        total_volume: 2000.0, // Different values
        total_sales: 6000.0,
        source_file_hash: 'different-hash',
      };

      const result = dal.upsert(data);

      // Should return existing, not create new
      expect(result).toEqual(mockDayFuelSummary);
      // Verify INSERT was NOT called
      expect(mockPrepare).toHaveBeenCalledTimes(1);
    });

    it('DFS-UPSERT-003: should handle null fuel_grade_id correctly', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ ...mockDayFuelSummary, fuel_grade_id: null }),
      });

      const data: CreateDayFuelSummaryData = {
        day_summary_id: 'ds-001',
        // fuel_grade_id not provided (null)
        total_volume: 1500.0,
        total_sales: 4350.0,
      };

      dal.upsert(data);

      // Verify query handles IS NULL
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('fuel_grade_id IS NULL'));
    });
  });

  // ==========================================================================
  // DFS-MSM: MSM-Specific Method Tests (v014)
  // ==========================================================================

  describe('createFromMSM', () => {
    it('DFS-MSM-001: should create from MSM Period 1 parsed data', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) }) // findByDaySummaryAndGrade
        .mockReturnValueOnce({ run: mockRun }) // INSERT
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockDayFuelSummary) }); // findById

      const result = dal.createFromMSM('ds-001', msmDayFuelInput, 'file-hash-123');

      expect(result).toBe(mockDayFuelSummary.day_fuel_summary_id);

      // Verify MSM-specific parameters
      const callArgs = mockRun.mock.calls[0];
      expect(callArgs).toContain('MSM'); // fuel_source
    });

    it('DFS-MSM-002: should set fuel_source to MSM', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) })
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockDayFuelSummary) });

      dal.createFromMSM('ds-001', msmDayFuelInput);

      const callArgs = mockRun.mock.calls[0];
      // fuel_source at index 17
      expect(callArgs[17]).toBe('MSM');
    });

    it('DFS-MSM-003: should store grade_id and grade_name from input', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) })
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockDayFuelSummary) });

      dal.createFromMSM('ds-001', {
        ...msmDayFuelInput,
        gradeId: '003',
        gradeName: 'Premium Unleaded',
      });

      const callArgs = mockRun.mock.calls[0];
      expect(callArgs[23]).toBe('003'); // grade_id
      expect(callArgs[24]).toBe('Premium Unleaded'); // grade_name
    });
  });

  describe('getMSMDailyTotals', () => {
    it('DFS-MSM-004: should return MSM daily totals with inside/outside breakdown', () => {
      const aggregateResult = {
        total_volume: 3100.0,
        total_amount: 9690.0,
        total_discount: 2.5,
        inside_volume: 1600.0,
        inside_amount: 4990.0,
        outside_volume: 1500.0,
        outside_amount: 4700.0,
        fuel_source: 'MSM',
      };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(aggregateResult),
      });

      const result = dal.getMSMDailyTotals('ds-001');

      expect(result.totalVolume).toBe(3100.0);
      expect(result.totalAmount).toBe(9690.0);
      expect(result.insideVolume).toBe(1600.0);
      expect(result.insideAmount).toBe(4990.0);
      expect(result.outsideVolume).toBe(1500.0);
      expect(result.outsideAmount).toBe(4700.0);
      expect(result.fuelSource).toBe('MSM');
    });

    it('DFS-MSM-005: should calculate average price from totals', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          total_volume: 1000.0,
          total_amount: 3000.0,
          total_discount: 0,
          inside_volume: 500.0,
          inside_amount: 1500.0,
          outside_volume: 500.0,
          outside_amount: 1500.0,
          fuel_source: 'MSM',
        }),
      });

      const result = dal.getMSMDailyTotals('ds-001');

      expect(result.averagePrice).toBe(3.0); // 3000 / 1000
    });

    it('DFS-MSM-006: should return default values when no data exists', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.getMSMDailyTotals('ds-nonexistent');

      expect(result.totalVolume).toBe(0);
      expect(result.totalAmount).toBe(0);
      expect(result.averagePrice).toBe(0);
      expect(result.fuelSource).toBe('FGM');
    });
  });

  describe('getMSMFuelByGrade', () => {
    it('DFS-MSM-007: should return per-grade breakdown with inside/outside', () => {
      const gradeResults = [
        {
          grade_id: '001',
          grade_name: 'Regular Unleaded',
          total_volume: 1500.0,
          total_amount: 4350.0,
          inside_volume: 800.0,
          inside_amount: 2320.0,
          outside_volume: 700.0,
          outside_amount: 2030.0,
          discount_amount: 1.0,
          average_price: 2.9,
        },
        {
          grade_id: '003',
          grade_name: 'Premium Unleaded',
          total_volume: 300.0,
          total_amount: 990.0,
          inside_volume: 150.0,
          inside_amount: 495.0,
          outside_volume: 150.0,
          outside_amount: 495.0,
          discount_amount: 0.25,
          average_price: 3.3,
        },
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(gradeResults),
      });

      const result = dal.getMSMFuelByGrade('ds-001');

      expect(result).toHaveLength(2);
      expect(result[0].gradeId).toBe('001');
      expect(result[0].insideVolume).toBe(800.0);
      expect(result[0].outsideVolume).toBe(700.0);
      expect(result[1].gradeId).toBe('003');
    });

    it('DFS-MSM-008: should order by total_amount DESC', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.getMSMFuelByGrade('ds-001');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY total_amount DESC')
      );
    });
  });

  describe('hasMSMData', () => {
    it('DFS-MSM-009: should return true when MSM data exists', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ 1: 1 }),
      });

      const result = dal.hasMSMData('ds-001');

      expect(result).toBe(true);
    });

    it('DFS-MSM-010: should return false when no MSM data exists', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.hasMSMData('ds-001');

      expect(result).toBe(false);
    });
  });

  describe('deleteMSMByDaySummary', () => {
    it('DFS-MSM-011: should delete only MSM-sourced records', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 4 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deleteMSMByDaySummary('ds-001');

      expect(result).toBe(4);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("fuel_source = 'MSM'"));
    });
  });

  // ==========================================================================
  // DFS-QUERY: Query Operation Tests
  // ==========================================================================

  describe('findByDaySummaryAndGrade', () => {
    it('DFS-QUERY-001: should find by day summary and grade', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockDayFuelSummary),
      });

      const result = dal.findByDaySummaryAndGrade('ds-001', '001');

      expect(result).toEqual(mockDayFuelSummary);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE day_summary_id = ?'));
    });

    it('DFS-QUERY-002: should handle null fuel_grade_id with IS NULL', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ ...mockDayFuelSummary, fuel_grade_id: null }),
      });

      dal.findByDaySummaryAndGrade('ds-001', null);

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('fuel_grade_id IS NULL'));
    });

    it('DFS-QUERY-003: should check both fuel_grade_id and grade_id', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockDayFuelSummary),
      });

      dal.findByDaySummaryAndGrade('ds-001', '001');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('(fuel_grade_id = ? OR grade_id = ?)')
      );
    });
  });

  describe('findByDaySummary', () => {
    it('DFS-QUERY-004: should return all summaries for a day', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(multiGradeDailyData),
      });

      const result = dal.findByDaySummary('ds-001');

      expect(result).toHaveLength(4);
    });

    it('DFS-QUERY-005: should order by grade_id ASC', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.findByDaySummary('ds-001');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ORDER BY grade_id ASC'));
    });
  });

  describe('findByStoreAndDateRange', () => {
    it('DFS-QUERY-006: should find by store and date range with join', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(multiGradeDailyData),
      });

      dal.findByStoreAndDateRange('store-456', '2026-01-01', '2026-01-31');

      // DB-006: Store-scoped via join
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ds.store_id = ?'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INNER JOIN day_summaries'));
    });

    it('DFS-QUERY-007: should enforce max limit of 1000', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.findByStoreAndDateRange('store-456', '2026-01-01', '2026-01-31', 5000);

      // Should use LIMIT 1000, not 5000
      const mockAll = mockPrepare.mock.results[0]?.value?.all;
      if (mockAll) {
        const callArgs = mockAll.mock.calls[0];
        expect(callArgs[3]).toBe(1000);
      }
    });

    it('DFS-QUERY-008: should use default limit of 100', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.findByStoreAndDateRange('store-456', '2026-01-01', '2026-01-31');

      const query = mockPrepare.mock.calls[0][0];
      expect(query).toContain('LIMIT ?');
    });
  });

  // ==========================================================================
  // DFS-DEL: Delete Operation Tests
  // ==========================================================================

  describe('deleteBySourceFileHash', () => {
    it('DFS-DEL-001: should delete by source file hash', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 4 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deleteBySourceFileHash('daily-hash-123');

      expect(result).toBe(4);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM day_fuel_summaries WHERE source_file_hash = ?')
      );
    });
  });

  describe('deleteByDaySummary', () => {
    it('DFS-DEL-002: should delete all summaries for a day', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 4 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deleteByDaySummary('ds-001');

      expect(result).toBe(4);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM day_fuel_summaries WHERE day_summary_id = ?')
      );
    });
  });

  describe('deleteAllForStore', () => {
    it('DFS-DEL-003: should delete all summaries for store via subquery', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 120 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deleteAllForStore('store-456');

      expect(result).toBe(120);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE day_summary_id IN'));
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT day_summary_id FROM day_summaries WHERE store_id = ?')
      );
    });
  });

  // ==========================================================================
  // DFS-SEC: Security Tests - SEC-006 SQL Injection Prevention
  // ==========================================================================

  describe('SEC-006: SQL Injection Prevention', () => {
    const INJECTION_PAYLOADS = [
      "'; DROP TABLE day_fuel_summaries;--",
      "1' OR '1'='1",
      "1; DELETE FROM day_summaries WHERE '1'='1",
      "' UNION SELECT * FROM users--",
      "admin'--",
      "'; UPDATE day_fuel_summaries SET total_sales=0;--",
    ];

    it.each(INJECTION_PAYLOADS)(
      'DFS-SEC-001: should safely handle malicious input: %s',
      (payload) => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue(undefined),
        });

        // Call method with injection payload
        dal.findByDaySummaryAndGrade(payload, payload);

        // Verify query is parameterized
        const query = mockPrepare.mock.calls[0][0];
        expect(query).not.toContain('DROP');
        expect(query).not.toContain('DELETE');
        expect(query).not.toContain('UNION');
        expect(query).not.toContain('UPDATE');
        expect(query).toContain('?');
      }
    );

    it('DFS-SEC-002: should use parameterized queries for all create operations', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockDayFuelSummary) });

      dal.create({
        day_summary_id: "'; DROP TABLE--",
        total_volume: 100,
        total_sales: 290,
        grade_id: "' OR '1'='1",
      });

      const query = mockPrepare.mock.calls[0][0];
      expect(query).toContain('VALUES (?, ?, ?'); // Parameterized
      expect(query).not.toMatch(/\$\{.*\}/); // No template literal interpolation
    });

    it('DFS-SEC-003: should use parameterized queries for all delete operations', () => {
      mockPrepare.mockReturnValue({ run: vi.fn().mockReturnValue({ changes: 0 }) });

      dal.deleteBySourceFileHash("'; DROP TABLE;--");
      dal.deleteByDaySummary("1' OR '1'='1");
      dal.deleteAllForStore("'; DELETE FROM stores;--");

      const calls = mockPrepare.mock.calls;
      calls.forEach((call) => {
        expect(call[0]).toContain('?');
        expect(call[0]).not.toMatch(/\$\{.*\}/);
      });
    });
  });

  // ==========================================================================
  // DFS-SEC: Security Tests - DB-006 Tenant Isolation
  // ==========================================================================

  describe('DB-006: Tenant Isolation', () => {
    it('DFS-SEC-004: should scope findByStoreAndDateRange by store_id', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.findByStoreAndDateRange('store-456', '2026-01-01', '2026-01-31');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ds.store_id = ?'));
    });

    it('DFS-SEC-005: should scope deleteAllForStore via day_summaries.store_id', () => {
      mockPrepare.mockReturnValue({ run: vi.fn().mockReturnValue({ changes: 0 }) });

      dal.deleteAllForStore('store-456');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('day_summaries WHERE store_id = ?')
      );
    });
  });

  // ==========================================================================
  // DFS-STORE: Store/Date Query Tests (Phase 3 Methods)
  // ==========================================================================

  describe('findByBusinessDate', () => {
    it('DFS-STORE-001: should find fuel summaries by store and business date', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(multiGradeDailyData),
      });

      const result = dal.findByBusinessDate('store-456', '2026-01-15');

      expect(result).toHaveLength(4);
      expect(result[0].grade_id).toBe('001');
      // SEC-006: Verify parameterized query
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('?'));
    });

    it('DFS-STORE-002: should join to day_summaries for tenant isolation (DB-006)', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.findByBusinessDate('store-456', '2026-01-15');

      // DB-006: Store-scoped via join
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INNER JOIN day_summaries'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ds.store_id = ?'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ds.business_date = ?'));
    });

    it('DFS-STORE-003: should order results by grade_id ASC', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.findByBusinessDate('store-456', '2026-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY dfs.grade_id ASC')
      );
    });

    it('DFS-STORE-004: should return empty array when no data exists', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const result = dal.findByBusinessDate('store-456', '2026-01-15');

      expect(result).toEqual([]);
    });

    it('DFS-STORE-005: should safely handle SQL injection in parameters (SEC-006)', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.findByBusinessDate("'; DROP TABLE day_summaries;--", "2026-01-15' OR '1'='1");

      const query = mockPrepare.mock.calls[0][0];
      expect(query).not.toContain('DROP');
      expect(query).toContain('?');
    });
  });

  describe('getDailyTotalsByStoreAndDate', () => {
    it('DFS-STORE-006: should return aggregated daily totals with inside/outside', () => {
      const aggregateResult = {
        total_volume: 3100.0,
        total_amount: 9690.0,
        total_discount: 5.0,
        inside_volume: 1600.0,
        inside_amount: 4990.0,
        outside_volume: 1500.0,
        outside_amount: 4700.0,
        fuel_source: 'MSM',
      };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(aggregateResult),
      });

      const result = dal.getDailyTotalsByStoreAndDate('store-456', '2026-01-15');

      expect(result.totalVolume).toBe(3100.0);
      expect(result.totalAmount).toBe(9690.0);
      expect(result.totalDiscount).toBe(5.0);
      expect(result.insideVolume).toBe(1600.0);
      expect(result.insideAmount).toBe(4990.0);
      expect(result.outsideVolume).toBe(1500.0);
      expect(result.outsideAmount).toBe(4700.0);
      expect(result.fuelSource).toBe('MSM');
    });

    it('DFS-STORE-007: should calculate average price from totals', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          total_volume: 1000.0,
          total_amount: 3000.0,
          total_discount: 0,
          inside_volume: 500.0,
          inside_amount: 1500.0,
          outside_volume: 500.0,
          outside_amount: 1500.0,
          fuel_source: 'MSM',
        }),
      });

      const result = dal.getDailyTotalsByStoreAndDate('store-456', '2026-01-15');

      expect(result.averagePrice).toBe(3.0); // 3000 / 1000
    });

    it('DFS-STORE-008: should return default values when no data exists', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          total_volume: 0,
          total_amount: 0,
          total_discount: 0,
          inside_volume: 0,
          inside_amount: 0,
          outside_volume: 0,
          outside_amount: 0,
          fuel_source: null,
        }),
      });

      const result = dal.getDailyTotalsByStoreAndDate('store-456', '2026-01-15');

      expect(result.totalVolume).toBe(0);
      expect(result.averagePrice).toBe(0);
      expect(result.fuelSource).toBe('FGM'); // Default
    });

    it('DFS-STORE-009: should use COALESCE for null-safe aggregation', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          total_volume: 0,
          total_amount: 0,
          total_discount: 0,
          inside_volume: 0,
          inside_amount: 0,
          outside_volume: 0,
          outside_amount: 0,
          fuel_source: 'FGM',
        }),
      });

      dal.getDailyTotalsByStoreAndDate('store-456', '2026-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('COALESCE(SUM(dfs.total_volume), 0)')
      );
    });

    it('DFS-STORE-010: should scope by store and date (DB-006)', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          total_volume: 0,
          total_amount: 0,
          total_discount: 0,
          inside_volume: 0,
          inside_amount: 0,
          outside_volume: 0,
          outside_amount: 0,
          fuel_source: 'FGM',
        }),
      });

      dal.getDailyTotalsByStoreAndDate('store-456', '2026-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ds.store_id = ?'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ds.business_date = ?'));
    });
  });

  describe('getFuelByGradeForStoreAndDate', () => {
    it('DFS-STORE-011: should return per-grade breakdown with inside/outside', () => {
      const gradeResults = [
        {
          grade_id: '001',
          grade_name: 'Regular Unleaded',
          total_volume: 1500.0,
          total_amount: 4350.0,
          inside_volume: 800.0,
          inside_amount: 2320.0,
          outside_volume: 700.0,
          outside_amount: 2030.0,
          discount_amount: 1.0,
          average_price: 2.9,
        },
        {
          grade_id: '003',
          grade_name: 'Premium Unleaded',
          total_volume: 300.0,
          total_amount: 990.0,
          inside_volume: 150.0,
          inside_amount: 495.0,
          outside_volume: 150.0,
          outside_amount: 495.0,
          discount_amount: 0.25,
          average_price: 3.3,
        },
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(gradeResults),
      });

      const result = dal.getFuelByGradeForStoreAndDate('store-456', '2026-01-15');

      expect(result).toHaveLength(2);
      expect(result[0].gradeId).toBe('001');
      expect(result[0].gradeName).toBe('Regular Unleaded');
      expect(result[0].totalVolume).toBe(1500.0);
      expect(result[0].insideVolume).toBe(800.0);
      expect(result[0].outsideVolume).toBe(700.0);
      expect(result[1].gradeId).toBe('003');
    });

    it('DFS-STORE-012: should order by total_amount DESC', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.getFuelByGradeForStoreAndDate('store-456', '2026-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY total_amount DESC')
      );
    });

    it('DFS-STORE-013: should use COALESCE for grade_id lookup', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.getFuelByGradeForStoreAndDate('store-456', '2026-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('COALESCE(dfs.fuel_grade_id, dfs.grade_id)')
      );
    });

    it('DFS-STORE-014: should return empty array when no grades exist', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const result = dal.getFuelByGradeForStoreAndDate('store-456', '2026-01-15');

      expect(result).toEqual([]);
    });

    it('DFS-STORE-015: should scope by store and date (DB-006)', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.getFuelByGradeForStoreAndDate('store-456', '2026-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INNER JOIN day_summaries'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ds.store_id = ?'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ds.business_date = ?'));
    });
  });

  // ==========================================================================
  // DFS-EDGE: Edge Case Tests
  // ==========================================================================

  describe('Edge Cases', () => {
    it('DFS-EDGE-001: should handle empty result set', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const result = dal.findByDaySummary('nonexistent-ds');

      expect(result).toEqual([]);
    });

    it('DFS-EDGE-002: should handle zero volume with non-zero amount', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({
        get: vi.fn().mockReturnValue({
          ...mockDayFuelSummary,
          total_volume: 0,
          total_sales: 50.0, // Manual adjustment
        }),
      });

      const result = dal.create({
        day_summary_id: 'ds-001',
        total_volume: 0,
        total_sales: 50.0,
      });

      expect(result.total_volume).toBe(0);
      expect(result.total_sales).toBe(50.0);
    });

    it('DFS-EDGE-003: should handle very large fuel volumes (daily totals)', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({
        get: vi.fn().mockReturnValue({
          ...mockDayFuelSummary,
          total_volume: 50000.0, // Large daily volume
          total_sales: 150000.0,
        }),
      });

      const result = dal.create({
        day_summary_id: 'ds-001',
        total_volume: 50000.0,
        total_sales: 150000.0,
      });

      expect(result.total_volume).toBe(50000.0);
    });

    it('DFS-EDGE-004: should handle all fuel sources', () => {
      const fuelSources: DayFuelSource[] = ['FGM', 'MSM', 'CALCULATED', 'MANUAL'];

      fuelSources.forEach((source) => {
        const mockRun = vi.fn().mockReturnValue({ changes: 1 });
        mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ ...mockDayFuelSummary, fuel_source: source }),
        });

        const result = dal.create({
          day_summary_id: 'ds-001',
          total_volume: 100,
          total_sales: 300,
          fuel_source: source,
        });

        expect(result.fuel_source).toBe(source);
      });
    });

    it('DFS-EDGE-005: should handle inside-only daily fuel', () => {
      const insideOnlySummary = {
        ...mockDayFuelSummary,
        inside_volume: 1500.0,
        inside_amount: 4350.0,
        outside_volume: 0,
        outside_amount: 0,
      };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(insideOnlySummary),
      });

      const result = dal.findByDaySummaryAndGrade('ds-001', '001');

      expect(result?.inside_volume).toBe(1500.0);
      expect(result?.outside_volume).toBe(0);
    });

    it('DFS-EDGE-006: should handle variance calculations', () => {
      const varianceSummary = {
        ...mockDayFuelSummary,
        meter_volume: 1510.0,
        book_volume: 1500.0,
        variance_volume: 10.0, // 10 gallon variance
        variance_amount: 29.0, // ~$29 value
      };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(varianceSummary),
      });

      const result = dal.findByDaySummaryAndGrade('ds-001', '001');

      expect(result?.variance_volume).toBe(10.0);
      expect(result?.meter_volume).toBeGreaterThan(result?.book_volume ?? 0);
    });
  });
});
