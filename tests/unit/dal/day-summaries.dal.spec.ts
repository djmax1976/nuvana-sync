/**
 * Day Summaries DAL Unit Tests
 *
 * @module tests/unit/dal/day-summaries.dal.spec
 * @security SEC-006: Verifies parameterized queries
 * @security DB-006: Verifies tenant isolation
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
  isDatabaseInitialized: vi.fn(() => true),
}));

// Mock crypto
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return {
    ...actual,
    randomUUID: vi.fn().mockReturnValue('mock-summary-uuid'),
  };
});

import {
  DaySummariesDAL,
  type DaySummary,
  type DaySummaryStatus,
} from '../../../src/main/dal/day-summaries.dal';

describe('DaySummariesDAL', () => {
  let dal: DaySummariesDAL;

  const mockSummary: DaySummary = {
    day_summary_id: 'summary-123',
    store_id: 'store-456',
    business_date: '2024-01-15',
    shift_count: 1,
    first_shift_opened: '2024-01-15T08:00:00.000Z',
    last_shift_closed: null,
    gross_sales: 1500.0,
    returns_total: 0,
    discounts_total: 0,
    net_sales: 1500.0,
    tax_collected: 0,
    tax_exempt_sales: 0,
    taxable_sales: 1500.0,
    transaction_count: 50,
    void_count: 0,
    refund_count: 0,
    customer_count: 45,
    items_sold_count: 100,
    items_returned_count: 0,
    average_basket_size: 2,
    average_transaction_value: 30,
    status: 'OPEN' as DaySummaryStatus,
    closed_at: null,
    closed_by_user_id: null,
    notes: null,
    created_at: '2024-01-15T08:00:00.000Z',
    updated_at: '2024-01-15T08:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new DaySummariesDAL();
  });

  // ==========================================================================
  // CREATE TESTS
  // ==========================================================================

  describe('create', () => {
    it('should create day summary with all fields', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockSummary) });

      const result = dal.create({
        store_id: 'store-456',
        business_date: '2024-01-15',
        gross_sales: 1500.0,
        transaction_count: 50,
      });

      expect(result).toEqual(mockSummary);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO day_summaries')
      );
    });

    it('should use generated UUID when day_summary_id not provided', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({
        get: vi.fn().mockReturnValue({ ...mockSummary, day_summary_id: 'mock-summary-uuid' }),
      });

      dal.create({
        store_id: 'store-456',
        business_date: '2024-01-15',
      });

      expect(mockRun).toHaveBeenCalledWith(
        'mock-summary-uuid',
        expect.any(String),
        expect.any(String),
        expect.any(Number),
        expect.any(Number),
        expect.any(String),
        expect.any(String)
      );
    });

    it('should default to 0 for sales and transactions', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({
        get: vi.fn().mockReturnValue({ ...mockSummary, gross_sales: 0, transaction_count: 0 }),
      });

      dal.create({
        store_id: 'store-456',
        business_date: '2024-01-15',
      });

      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String),
        'store-456',
        '2024-01-15',
        0, // gross_sales default
        0, // transaction_count default
        expect.any(String),
        expect.any(String)
      );
    });

    it('should set status to OPEN by default', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ ...mockSummary, status: 'OPEN' }) });

      const result = dal.create({
        store_id: 'store-456',
        business_date: '2024-01-15',
      });

      expect(result.status).toBe('OPEN');
    });

    it('should throw error if created summary cannot be retrieved', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) });

      expect(() =>
        dal.create({
          store_id: 'store-456',
          business_date: '2024-01-15',
        })
      ).toThrow('Failed to retrieve created day summary');
    });
  });

  // ==========================================================================
  // UPDATE TESTS
  // ==========================================================================

  describe('update', () => {
    it('should update sales totals', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const updatedSummary = { ...mockSummary, gross_sales: 2000.0 };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(updatedSummary) });

      const result = dal.update('summary-123', { gross_sales: 2000.0 });

      expect(result?.gross_sales).toBe(2000.0);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE day_summaries SET'));
    });

    it('should return undefined for non-existent summary', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      const result = dal.update('nonexistent', { gross_sales: 100 });

      expect(result).toBeUndefined();
    });

    it('should set closed_at when closing', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const closedSummary = {
        ...mockSummary,
        status: 'CLOSED' as DaySummaryStatus,
        closed_at: '2024-01-15T22:00:00.000Z',
      };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(closedSummary) });

      const result = dal.update('summary-123', { status: 'CLOSED' });

      expect(result?.status).toBe('CLOSED');
      expect(result?.closed_at).toBeTruthy();
    });

    it('should update multiple fields at once', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const updatedSummary = {
        ...mockSummary,
        gross_sales: 2500.0,
        transaction_count: 75,
      };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(updatedSummary) });

      const result = dal.update('summary-123', {
        gross_sales: 2500.0,
        transaction_count: 75,
      });

      expect(result?.gross_sales).toBe(2500.0);
      expect(result?.transaction_count).toBe(75);
    });
  });

  // ==========================================================================
  // CLOSE TESTS
  // ==========================================================================

  describe('close', () => {
    it('should close day summary', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const closedSummary = {
        ...mockSummary,
        status: 'CLOSED' as DaySummaryStatus,
        closed_at: '2024-01-15T22:00:00.000Z',
      };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(closedSummary) });

      const result = dal.close('summary-123');

      expect(result?.status).toBe('CLOSED');
    });

    it('should return undefined for non-existent summary', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      const result = dal.close('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // FIND BY DATE TESTS - DB-006 Tenant Isolation
  // ==========================================================================

  describe('findByDate', () => {
    it('should find summary for specific store and date', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockSummary),
      });

      const result = dal.findByDate('store-456', '2024-01-15');

      expect(result).toEqual(mockSummary);
      // DB-006: Verify store_id is in query
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('store_id = ?'));
    });

    it('should return undefined when not found', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.findByDate('store-456', '2024-01-20');

      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // FIND BY DATE RANGE TESTS
  // ==========================================================================

  describe('findByDateRange', () => {
    it('should return summaries within date range', () => {
      const summaries = [
        { ...mockSummary, business_date: '2024-01-15' },
        { ...mockSummary, day_summary_id: 'summary-456', business_date: '2024-01-16' },
      ];
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(summaries),
      });

      const result = dal.findByDateRange('store-456', '2024-01-15', '2024-01-20');

      expect(result).toHaveLength(2);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('business_date >= ? AND business_date <= ?')
      );
    });

    it('should order by date ascending', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.findByDateRange('store-456', '2024-01-15', '2024-01-20');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY business_date ASC')
      );
    });

    it('should return empty array when no summaries found', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const result = dal.findByDateRange('store-456', '2024-01-15', '2024-01-20');

      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // GET OR CREATE FOR DATE TESTS
  // ==========================================================================

  describe('getOrCreateForDate', () => {
    it('should return existing summary', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockSummary),
      });

      const result = dal.getOrCreateForDate('store-456', '2024-01-15');

      expect(result).toEqual(mockSummary);
    });

    it('should create new summary when none exists', () => {
      const newSummary = { ...mockSummary, day_summary_id: 'new-summary' };

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) }) // findByDate
        .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) }) // create INSERT
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(newSummary) }); // findById

      const result = dal.getOrCreateForDate('store-456', '2024-01-15');

      expect(result).toEqual(newSummary);
    });

    it('should initialize new summary with zero totals', () => {
      const newSummary = {
        ...mockSummary,
        gross_sales: 0,
        transaction_count: 0,
      };
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) }) // findByDate
        .mockReturnValueOnce({ run: mockRun }) // create INSERT
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(newSummary) }); // findById

      const result = dal.getOrCreateForDate('store-456', '2024-01-15');

      expect(result.gross_sales).toBe(0);
      expect(result.transaction_count).toBe(0);
    });
  });

  // ==========================================================================
  // INCREMENT TOTALS TESTS
  // ==========================================================================

  describe('incrementTotals', () => {
    it('should increment sales and transaction count', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const updatedSummary = {
        ...mockSummary,
        gross_sales: 1600.0,
        transaction_count: 51,
      };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(updatedSummary) });

      const result = dal.incrementTotals('summary-123', 100.0, 1);

      expect(result?.gross_sales).toBe(1600.0);
      expect(result?.transaction_count).toBe(51);
    });

    it('should default transaction count to 1', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockSummary) });

      dal.incrementTotals('summary-123', 100.0);

      expect(mockRun).toHaveBeenCalledWith(
        100.0,
        1, // default transaction count
        expect.any(String),
        'summary-123'
      );
    });

    it('should only update open summaries', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 1 }),
        get: vi.fn().mockReturnValue(mockSummary),
      });

      dal.incrementTotals('summary-123', 100.0);

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("status = 'OPEN'"));
    });

    it('should return undefined for closed summary', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      const result = dal.incrementTotals('summary-123', 100.0);

      expect(result).toBeUndefined();
    });

    it('should use atomic increment in SQL', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockSummary) });

      dal.incrementTotals('summary-123', 100.0);

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('gross_sales = gross_sales + ?')
      );
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('transaction_count = transaction_count + ?')
      );
    });
  });

  // ==========================================================================
  // GET TOTALS FOR DATE RANGE TESTS
  // ==========================================================================

  describe('getTotalsForDateRange', () => {
    it('should return aggregated totals', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          gross_sales: 5000.0,
          transaction_count: 150,
          day_count: 5,
        }),
      });

      const result = dal.getTotalsForDateRange('store-456', '2024-01-15', '2024-01-20');

      expect(result).toEqual({
        totalSales: 5000.0,
        totalTransactions: 150,
        dayCount: 5,
      });
    });

    it('should return zeros when no data', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          gross_sales: 0,
          transaction_count: 0,
          day_count: 0,
        }),
      });

      const result = dal.getTotalsForDateRange('store-456', '2024-01-15', '2024-01-20');

      expect(result.totalSales).toBe(0);
      expect(result.totalTransactions).toBe(0);
      expect(result.dayCount).toBe(0);
    });

    it('should use COALESCE for null safety', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          gross_sales: 0,
          transaction_count: 0,
          day_count: 0,
        }),
      });

      dal.getTotalsForDateRange('store-456', '2024-01-15', '2024-01-20');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('COALESCE'));
    });
  });

  // ==========================================================================
  // GET LATEST OPEN TESTS
  // ==========================================================================

  describe('getLatestOpen', () => {
    it('should return most recent open summary', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockSummary),
      });

      const result = dal.getLatestOpen('store-456');

      expect(result).toEqual(mockSummary);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("status = 'OPEN'"));
    });

    it('should return undefined when no open summaries', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.getLatestOpen('store-456');

      expect(result).toBeUndefined();
    });

    it('should order by date descending', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockSummary),
      });

      dal.getLatestOpen('store-456');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY business_date DESC')
      );
    });
  });

  // ==========================================================================
  // COUNT BY STATUS TESTS
  // ==========================================================================

  describe('countByStatus', () => {
    it('should count open summaries', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ count: 3 }),
      });

      const result = dal.countByStatus('store-456', 'OPEN');

      expect(result).toBe(3);
    });

    it('should count closed summaries', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ count: 30 }),
      });

      const result = dal.countByStatus('store-456', 'CLOSED');

      expect(result).toBe(30);
    });

    it('should return 0 when no matches', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ count: 0 }),
      });

      const result = dal.countByStatus('store-456', 'OPEN');

      expect(result).toBe(0);
    });
  });

  // ==========================================================================
  // SECURITY TESTS - SEC-006 SQL Injection Prevention
  // ==========================================================================

  describe('SEC-006: SQL Injection Prevention', () => {
    it('should use parameterized queries for all operations', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue(mockSummary);
      const mockAll = vi.fn().mockReturnValue([mockSummary]);

      mockPrepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll });

      // Execute various operations
      dal.findByDate('store-456', '2024-01-15');
      dal.findByDateRange('store-456', '2024-01-15', '2024-01-20');
      dal.getTotalsForDateRange('store-456', '2024-01-15', '2024-01-20');
      dal.getLatestOpen('store-456');
      dal.countByStatus('store-456', 'OPEN');

      // All calls should use parameterized queries
      const calls = mockPrepare.mock.calls;
      calls.forEach((call) => {
        expect(call[0]).toContain('?');
        // Should not contain direct string interpolation patterns
        expect(call[0]).not.toMatch(/\$\{.*\}/);
      });
    });
  });

  // ==========================================================================
  // DB-006: Tenant Isolation Tests
  // ==========================================================================

  describe('DB-006: Tenant Isolation', () => {
    it('should always include store_id in queries', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue(undefined),
      });

      // All store-scoped queries should include store_id
      dal.findByDate('store-456', '2024-01-15');
      dal.findByDateRange('store-456', '2024-01-15', '2024-01-20');
      dal.getTotalsForDateRange('store-456', '2024-01-15', '2024-01-20');
      dal.getLatestOpen('store-456');
      dal.countByStatus('store-456', 'OPEN');

      const calls = mockPrepare.mock.calls;
      calls.forEach((call) => {
        expect(call[0]).toContain('store_id');
      });
    });
  });
});
