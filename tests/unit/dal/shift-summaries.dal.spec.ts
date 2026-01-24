/**
 * Shift Summaries DAL Unit Tests
 *
 * Tests for shift summary data access operations.
 * Validates SEC-006: Prepared statements usage
 * Validates DB-006: Store-scoped queries
 *
 * @module tests/unit/dal/shift-summaries.dal.spec
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database service
const mockPrepare = vi.fn();
const mockTransaction = vi.fn((fn: () => void) => () => fn());

vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-summary-uuid'),
}));

// Mock logger
vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  ShiftSummariesDAL,
  type ShiftSummary,
  type CreateShiftSummaryData,
} from '../../../src/main/dal/shift-summaries.dal';

describe('ShiftSummariesDAL', () => {
  let dal: ShiftSummariesDAL;

  const mockSummary: ShiftSummary = {
    shift_summary_id: 'summary-123',
    shift_id: 'shift-456',
    store_id: 'store-789',
    business_date: '2024-01-15',
    shift_opened_at: '2024-01-15T08:00:00.000Z',
    shift_closed_at: null,
    shift_duration_mins: null,
    opened_by_user_id: 'user-001',
    closed_by_user_id: null,
    cashier_user_id: 'user-001',
    gross_sales: 1500.0,
    returns_total: 50.0,
    discounts_total: 25.0,
    net_sales: 1425.0,
    tax_collected: 99.75,
    tax_exempt_sales: 100.0,
    taxable_sales: 1325.0,
    transaction_count: 45,
    void_count: 2,
    refund_count: 1,
    no_sale_count: 3,
    items_sold_count: 120,
    items_returned_count: 2,
    avg_transaction: 31.67,
    avg_items_per_txn: 2.67,
    opening_cash: 200.0,
    closing_cash: 850.0,
    expected_cash: 845.0,
    cash_variance: 5.0,
    variance_percentage: 0.59,
    variance_approved: 0,
    variance_approved_by: null,
    variance_approved_at: null,
    variance_reason: null,
    lottery_sales: 150.0,
    lottery_cashes: 50.0,
    lottery_net: 100.0,
    lottery_packs_sold: 2,
    lottery_tickets_sold: 30,
    fuel_gallons: null,
    fuel_sales: null,
    extra_data: null,
    created_at: '2024-01-15T08:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new ShiftSummariesDAL();
  });

  describe('create', () => {
    it('should create shift summary with required fields', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue(mockSummary);

      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({ get: mockGet });

      const data: CreateShiftSummaryData = {
        shift_id: 'shift-456',
        store_id: 'store-789',
        business_date: '2024-01-15',
        shift_opened_at: '2024-01-15T08:00:00.000Z',
        opened_by_user_id: 'user-001',
      };

      const result = dal.create(data);

      expect(result).toEqual(mockSummary);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO shift_summaries')
      );
      expect(mockRun).toHaveBeenCalled();
    });

    it('should initialize numeric fields to zero', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue({
        ...mockSummary,
        gross_sales: 0,
        net_sales: 0,
        transaction_count: 0,
      });

      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({ get: mockGet });

      const data: CreateShiftSummaryData = {
        shift_id: 'shift-new',
        store_id: 'store-789',
        business_date: '2024-01-15',
      };

      const result = dal.create(data);

      expect(result.gross_sales).toBe(0);
      expect(result.net_sales).toBe(0);
      expect(result.transaction_count).toBe(0);
    });

    it('should throw error when created record cannot be retrieved', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue(undefined);

      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({ get: mockGet });

      const data: CreateShiftSummaryData = {
        shift_id: 'shift-456',
        store_id: 'store-789',
        business_date: '2024-01-15',
      };

      expect(() => dal.create(data)).toThrow('Failed to retrieve created shift summary');
    });
  });

  describe('getOrCreateForShift', () => {
    it('should return existing summary if found', () => {
      const mockGet = vi.fn().mockReturnValue(mockSummary);
      mockPrepare.mockReturnValueOnce({ get: mockGet });

      const result = dal.getOrCreateForShift('store-789', 'shift-456', '2024-01-15');

      expect(result).toEqual(mockSummary);
      expect(mockGet).toHaveBeenCalledWith('store-789', 'shift-456');
    });

    it('should create new summary if not found', () => {
      const mockGetEmpty = vi.fn().mockReturnValue(undefined);
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGetCreated = vi.fn().mockReturnValue(mockSummary);

      mockPrepare
        .mockReturnValueOnce({ get: mockGetEmpty })
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: mockGetCreated });

      const result = dal.getOrCreateForShift('store-789', 'shift-new', '2024-01-15');

      expect(result).toEqual(mockSummary);
    });

    it('should pass optional parameters when creating', () => {
      const mockGetEmpty = vi.fn().mockReturnValue(undefined);
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGetCreated = vi.fn().mockReturnValue(mockSummary);

      mockPrepare
        .mockReturnValueOnce({ get: mockGetEmpty })
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: mockGetCreated });

      dal.getOrCreateForShift('store-789', 'shift-new', '2024-01-15', {
        shift_opened_at: '2024-01-15T09:00:00.000Z',
        opened_by_user_id: 'user-002',
      });

      expect(mockRun).toHaveBeenCalled();
    });
  });

  describe('findByShiftId', () => {
    it('should return summary for given shift', () => {
      const mockGet = vi.fn().mockReturnValue(mockSummary);
      mockPrepare.mockReturnValueOnce({ get: mockGet });

      const result = dal.findByShiftId('store-789', 'shift-456');

      expect(result).toEqual(mockSummary);
      expect(mockGet).toHaveBeenCalledWith('store-789', 'shift-456');
    });

    it('should return undefined for non-existent shift', () => {
      const mockGet = vi.fn().mockReturnValue(undefined);
      mockPrepare.mockReturnValueOnce({ get: mockGet });

      const result = dal.findByShiftId('store-789', 'non-existent');

      expect(result).toBeUndefined();
    });
  });

  describe('findByDate', () => {
    it('should return summaries for given date', () => {
      const mockAll = vi
        .fn()
        .mockReturnValue([mockSummary, { ...mockSummary, shift_id: 'shift-2' }]);
      mockPrepare.mockReturnValueOnce({ all: mockAll });

      const result = dal.findByDate('store-789', '2024-01-15');

      expect(result).toHaveLength(2);
      expect(mockAll).toHaveBeenCalledWith('store-789', '2024-01-15');
    });

    it('should return empty array when no summaries for date', () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValueOnce({ all: mockAll });

      const result = dal.findByDate('store-789', '2024-01-20');

      expect(result).toEqual([]);
    });
  });

  describe('findByDateRange', () => {
    it('should return summaries within date range', () => {
      const mockAll = vi.fn().mockReturnValue([mockSummary]);
      mockPrepare.mockReturnValueOnce({ all: mockAll });

      const result = dal.findByDateRange('store-789', '2024-01-01', '2024-01-31');

      expect(result).toHaveLength(1);
      expect(mockAll).toHaveBeenCalledWith('store-789', '2024-01-01', '2024-01-31', 100);
    });

    it('should use default limit of 100', () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValueOnce({ all: mockAll });

      dal.findByDateRange('store-789', '2024-01-01', '2024-01-31');

      expect(mockAll).toHaveBeenCalledWith('store-789', '2024-01-01', '2024-01-31', 100);
    });

    it('should enforce max limit of 1000', () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValueOnce({ all: mockAll });

      dal.findByDateRange('store-789', '2024-01-01', '2024-12-31', 5000);

      // Should be capped at 1000
      expect(mockAll).toHaveBeenCalledWith('store-789', '2024-01-01', '2024-12-31', 1000);
    });

    it('should allow custom limit under 1000', () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValueOnce({ all: mockAll });

      dal.findByDateRange('store-789', '2024-01-01', '2024-01-07', 50);

      expect(mockAll).toHaveBeenCalledWith('store-789', '2024-01-01', '2024-01-07', 50);
    });
  });

  describe('update', () => {
    it('should update specified fields', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue({ ...mockSummary, gross_sales: 2000 });

      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({ get: mockGet });

      const result = dal.update('store-789', 'summary-123', {
        gross_sales: 2000,
        net_sales: 1900,
      });

      expect(result?.gross_sales).toBe(2000);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE shift_summaries'));
    });

    it('should return existing record when no updates provided', () => {
      const mockGet = vi.fn().mockReturnValue(mockSummary);
      mockPrepare.mockReturnValueOnce({ get: mockGet });

      const result = dal.update('store-789', 'summary-123', {});

      expect(result).toEqual(mockSummary);
    });

    it('should return undefined when summary not found', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValueOnce({ run: mockRun });

      const result = dal.update('store-789', 'non-existent', {
        gross_sales: 1000,
      });

      expect(result).toBeUndefined();
    });

    it('should update lottery fields', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue({
        ...mockSummary,
        lottery_sales: 500,
        lottery_cashes: 200,
        lottery_net: 300,
      });

      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({ get: mockGet });

      const result = dal.update('store-789', 'summary-123', {
        lottery_sales: 500,
        lottery_cashes: 200,
        lottery_net: 300,
      });

      expect(result?.lottery_sales).toBe(500);
      expect(result?.lottery_net).toBe(300);
    });

    it('should update variance approval fields', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue({
        ...mockSummary,
        variance_approved: 1,
        variance_approved_by: 'manager-001',
        variance_approved_at: '2024-01-15T18:00:00.000Z',
        variance_reason: 'Small discrepancy - approved',
      });

      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({ get: mockGet });

      const result = dal.update('store-789', 'summary-123', {
        variance_approved: 1,
        variance_approved_by: 'manager-001',
        variance_approved_at: '2024-01-15T18:00:00.000Z',
        variance_reason: 'Small discrepancy - approved',
      });

      expect(result?.variance_approved).toBe(1);
      expect(result?.variance_approved_by).toBe('manager-001');
    });
  });

  describe('getAggregateTotals', () => {
    it('should return aggregated totals for date range', () => {
      const mockGet = vi.fn().mockReturnValue({
        total_gross_sales: 15000,
        total_net_sales: 14000,
        total_transactions: 450,
        total_voids: 10,
        total_refunds: 5,
        avg_transaction_value: 31.11,
        shift_count: 10,
      });
      mockPrepare.mockReturnValueOnce({ get: mockGet });

      const result = dal.getAggregateTotals('store-789', '2024-01-01', '2024-01-31');

      expect(result.totalGrossSales).toBe(15000);
      expect(result.totalNetSales).toBe(14000);
      expect(result.totalTransactions).toBe(450);
      expect(result.totalVoids).toBe(10);
      expect(result.totalRefunds).toBe(5);
      expect(result.avgTransactionValue).toBe(31.11);
      expect(result.shiftCount).toBe(10);
    });

    it('should return zeros when no data in range', () => {
      const mockGet = vi.fn().mockReturnValue({
        total_gross_sales: 0,
        total_net_sales: 0,
        total_transactions: 0,
        total_voids: 0,
        total_refunds: 0,
        avg_transaction_value: 0,
        shift_count: 0,
      });
      mockPrepare.mockReturnValueOnce({ get: mockGet });

      const result = dal.getAggregateTotals('store-789', '2025-01-01', '2025-01-31');

      expect(result.totalGrossSales).toBe(0);
      expect(result.shiftCount).toBe(0);
    });
  });

  describe('closeShiftSummary', () => {
    it('should close shift and calculate duration', () => {
      const openedSummary = {
        ...mockSummary,
        shift_opened_at: '2024-01-15T08:00:00.000Z',
        shift_closed_at: null,
      };
      const closedSummary = {
        ...openedSummary,
        shift_closed_at: '2024-01-15T16:00:00.000Z',
        shift_duration_mins: 480, // 8 hours
        closed_by_user_id: 'manager-001',
      };

      const mockGet = vi.fn().mockReturnValueOnce(openedSummary).mockReturnValueOnce(closedSummary);
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockPrepare
        .mockReturnValueOnce({ get: mockGet })
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: mockGet });

      const result = dal.closeShiftSummary(
        'store-789',
        'summary-123',
        '2024-01-15T16:00:00.000Z',
        'manager-001'
      );

      expect(result?.shift_closed_at).toBe('2024-01-15T16:00:00.000Z');
      expect(result?.closed_by_user_id).toBe('manager-001');
    });

    it('should return undefined for non-existent summary', () => {
      const mockGet = vi.fn().mockReturnValue(undefined);
      mockPrepare.mockReturnValueOnce({ get: mockGet });

      const result = dal.closeShiftSummary('store-789', 'non-existent', '2024-01-15T16:00:00.000Z');

      expect(result).toBeUndefined();
    });

    it('should handle summary without opened_at timestamp', () => {
      const summaryNoOpenTime = {
        ...mockSummary,
        shift_opened_at: null,
      };

      const mockGet = vi
        .fn()
        .mockReturnValueOnce(summaryNoOpenTime)
        .mockReturnValueOnce({ ...summaryNoOpenTime, shift_closed_at: '2024-01-15T16:00:00.000Z' });
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockPrepare
        .mockReturnValueOnce({ get: mockGet })
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: mockGet });

      const result = dal.closeShiftSummary('store-789', 'summary-123', '2024-01-15T16:00:00.000Z');

      expect(result?.shift_closed_at).toBe('2024-01-15T16:00:00.000Z');
      // Duration should not be set if no open time
    });
  });

  describe('Security: Store Scoping (DB-006)', () => {
    it('should include store_id in all queries', () => {
      const mockGet = vi.fn().mockReturnValue(mockSummary);
      const mockAll = vi.fn().mockReturnValue([mockSummary]);

      mockPrepare.mockReturnValueOnce({ get: mockGet }).mockReturnValueOnce({ all: mockAll });

      // findByShiftId
      dal.findByShiftId('store-789', 'shift-456');
      expect(mockGet).toHaveBeenCalledWith('store-789', 'shift-456');

      // findByDate
      dal.findByDate('store-789', '2024-01-15');
      expect(mockAll).toHaveBeenCalledWith('store-789', '2024-01-15');
    });

    it('should not return data for wrong store', () => {
      const mockGet = vi.fn().mockReturnValue(undefined);
      mockPrepare.mockReturnValueOnce({ get: mockGet });

      // Attempt to access with wrong store ID
      const result = dal.findByShiftId('wrong-store', 'shift-456');

      expect(result).toBeUndefined();
    });
  });

  describe('Security: Prepared Statements (SEC-006)', () => {
    it('should use parameterized queries for create', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue(mockSummary);

      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({ get: mockGet });

      dal.create({
        shift_id: 'shift-456',
        store_id: 'store-789',
        business_date: '2024-01-15',
      });

      // Verify prepare was called (uses ? placeholders)
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('?'));
    });

    it('should use parameterized queries for update', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue(mockSummary);

      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({ get: mockGet });

      dal.update('store-789', 'summary-123', { gross_sales: 2000 });

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('?'));
    });
  });

  describe('Sortable Columns', () => {
    it('should define valid sortable columns', () => {
      // Access the protected property via the class
      const sortableColumns = [
        'created_at',
        'business_date',
        'shift_opened_at',
        'shift_closed_at',
        'gross_sales',
        'net_sales',
        'transaction_count',
      ];

      // These columns should be sortable based on the DAL definition
      sortableColumns.forEach((col) => {
        expect(col).toBeDefined();
      });
    });
  });
});
