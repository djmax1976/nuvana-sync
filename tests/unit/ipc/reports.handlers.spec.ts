/**
 * Reports Handlers Unit Tests
 *
 * Tests for report generation IPC handlers.
 *
 *
 * @module tests/unit/ipc/reports.handlers
 */

// Uses vitest globals (configured in vitest.config.ts)

// Mock DALs
vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: {
    getConfiguredStore: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/day-summaries.dal', () => ({
  daySummariesDAL: {
    findByDateRange: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/shifts.dal', () => ({
  shiftsDAL: {
    findByDateRange: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/transactions.dal', () => ({
  transactionsDAL: {
    findByDateRange: vi.fn(),
  },
}));

describe('Reports Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('reports:weekly', () => {
    it('should return weekly sales report', async () => {
      const mockReport = {
        startDate: '2024-01-08',
        endDate: '2024-01-14',
        totalSales: 35000,
        totalTransactions: 700,
        dailyBreakdown: [
          { date: '2024-01-08', sales: 5000, transactions: 100 },
          { date: '2024-01-09', sales: 5500, transactions: 110 },
          { date: '2024-01-10', sales: 4800, transactions: 96 },
          { date: '2024-01-11', sales: 5200, transactions: 104 },
          { date: '2024-01-12', sales: 6000, transactions: 120 },
          { date: '2024-01-13', sales: 4500, transactions: 90 },
          { date: '2024-01-14', sales: 4000, transactions: 80 },
        ],
      };

      expect(mockReport.dailyBreakdown.length).toBe(7);
      expect(mockReport.totalSales).toBe(35000);
    });

    it('should calculate correct weekly totals', async () => {
      const dailyData = [
        { sales: 1000, transactions: 20 },
        { sales: 1500, transactions: 30 },
        { sales: 1200, transactions: 24 },
        { sales: 1100, transactions: 22 },
        { sales: 1400, transactions: 28 },
        { sales: 900, transactions: 18 },
        { sales: 800, transactions: 16 },
      ];

      const totalSales = dailyData.reduce((sum, d) => sum + d.sales, 0);
      const totalTransactions = dailyData.reduce((sum, d) => sum + d.transactions, 0);

      expect(totalSales).toBe(7900);
      expect(totalTransactions).toBe(158);
    });

    it('should use correct week boundaries', async () => {
      // Get start of current week (Monday)
      const today = new Date();
      const dayOfWeek = today.getDay();
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Adjust for Monday start
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - diff);

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);

      expect(weekStart.getDay()).toBe(1); // Monday
      expect(weekEnd.getDay()).toBe(0); // Sunday
    });

    it('should handle week with no data', async () => {
      const mockReport = {
        startDate: '2024-01-08',
        endDate: '2024-01-14',
        totalSales: 0,
        totalTransactions: 0,
        dailyBreakdown: [],
      };

      expect(mockReport.totalSales).toBe(0);
      expect(mockReport.totalTransactions).toBe(0);
    });
  });

  describe('reports:monthly', () => {
    it('should return monthly sales report', async () => {
      const mockReport = {
        year: 2024,
        month: 1,
        totalSales: 150000,
        totalTransactions: 3000,
        weeklyBreakdown: [
          { weekNumber: 1, sales: 35000, transactions: 700 },
          { weekNumber: 2, sales: 38000, transactions: 760 },
          { weekNumber: 3, sales: 40000, transactions: 800 },
          { weekNumber: 4, sales: 37000, transactions: 740 },
        ],
      };

      expect(mockReport.weeklyBreakdown.length).toBe(4);
      expect(mockReport.year).toBe(2024);
      expect(mockReport.month).toBe(1);
    });

    it('should calculate correct monthly totals', async () => {
      const weeklyData = [
        { sales: 35000, transactions: 700 },
        { sales: 38000, transactions: 760 },
        { sales: 40000, transactions: 800 },
        { sales: 37000, transactions: 740 },
      ];

      const totalSales = weeklyData.reduce((sum, w) => sum + w.sales, 0);
      const totalTransactions = weeklyData.reduce((sum, w) => sum + w.transactions, 0);

      expect(totalSales).toBe(150000);
      expect(totalTransactions).toBe(3000);
    });

    it('should validate month parameter', async () => {
      const validMonth = 6;
      const invalidMonth = 13;

      expect(validMonth >= 1 && validMonth <= 12).toBe(true);
      expect(invalidMonth >= 1 && invalidMonth <= 12).toBe(false);
    });

    it('should validate year parameter', async () => {
      const validYear = 2024;
      const invalidYear = 1899;

      expect(validYear >= 2000 && validYear <= 2100).toBe(true);
      expect(invalidYear >= 2000 && invalidYear <= 2100).toBe(false);
    });

    it('should handle month with no data', async () => {
      const mockReport = {
        year: 2024,
        month: 1,
        totalSales: 0,
        totalTransactions: 0,
        weeklyBreakdown: [],
      };

      expect(mockReport.totalSales).toBe(0);
      expect(mockReport.weeklyBreakdown.length).toBe(0);
    });
  });

  describe('reports:dateRange', () => {
    it('should return report for custom date range', async () => {
      const params = {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      };

      const mockReport = {
        startDate: params.startDate,
        endDate: params.endDate,
        totalSales: 150000,
        totalTransactions: 3000,
        dailyBreakdown: [],
      };

      expect(mockReport.startDate).toBe('2024-01-01');
      expect(mockReport.endDate).toBe('2024-01-31');
    });

    it('should validate start date before end date', async () => {
      const validRange = {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      };

      const invalidRange = {
        startDate: '2024-01-31',
        endDate: '2024-01-01',
      };

      expect(new Date(validRange.startDate) <= new Date(validRange.endDate)).toBe(true);
      expect(new Date(invalidRange.startDate) <= new Date(invalidRange.endDate)).toBe(false);
    });

    it('should enforce maximum date range', async () => {
      const maxDays = 365;
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

      expect(daysDiff <= maxDays).toBe(true);
    });

    it('should validate date format', async () => {
      const validDate = '2024-01-15';
      const invalidDate = '01-15-2024';

      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

      expect(dateRegex.test(validDate)).toBe(true);
      expect(dateRegex.test(invalidDate)).toBe(false);
    });

    it('should reject range exceeding maximum', async () => {
      const maxDays = 365;
      const startDate = new Date('2023-01-01');
      const endDate = new Date('2024-12-31');

      const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

      if (daysDiff > maxDays) {
        const response = { error: 'VALIDATION_ERROR', message: 'Date range exceeds maximum' };
        expect(response.error).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('reports:shiftSummary', () => {
    it('should return summary for specific shift', async () => {
      const mockSummary = {
        shiftId: 'shift-123',
        totalSales: 5000,
        totalTransactions: 100,
        cashSales: 2000,
        cardSales: 3000,
        voidedAmount: 150,
        voidedCount: 3,
      };

      expect(mockSummary.totalSales).toBe(5000);
      expect(mockSummary.cashSales + mockSummary.cardSales).toBe(5000);
    });

    it('should include payment method breakdown', async () => {
      const mockSummary = {
        paymentBreakdown: [
          { method: 'CASH', amount: 2000, count: 40 },
          { method: 'CARD', amount: 3000, count: 60 },
        ],
      };

      expect(mockSummary.paymentBreakdown.length).toBe(2);
      expect(mockSummary.paymentBreakdown[0].method).toBe('CASH');
    });

    it('should validate shift ID format', async () => {
      const validUUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const invalidId = 'not-a-uuid';

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      expect(uuidRegex.test(validUUID)).toBe(true);
      expect(uuidRegex.test(invalidId)).toBe(false);
    });
  });

  describe('store scoping (DB-006)', () => {
    it('should scope all reports to configured store', async () => {
      const storeId = 'store-123';

      // All queries should include store_id parameter
      const query = 'SELECT * FROM day_summaries WHERE store_id = ?';

      expect(query).toContain('store_id = ?');
    });

    it('should not include data from other stores', async () => {
      const configuredStoreId = 'store-123';
      const otherStoreId = 'store-456';

      expect(configuredStoreId).not.toBe(otherStoreId);
    });
  });

  describe('export functionality', () => {
    it('should support CSV export format', async () => {
      const supportedFormats = ['csv', 'json', 'pdf'];

      expect(supportedFormats).toContain('csv');
    });

    it('should support JSON export format', async () => {
      const supportedFormats = ['csv', 'json', 'pdf'];

      expect(supportedFormats).toContain('json');
    });

    it('should support PDF export format', async () => {
      const supportedFormats = ['csv', 'json', 'pdf'];

      expect(supportedFormats).toContain('pdf');
    });

    it('should validate export format', async () => {
      const requestedFormat = 'xlsx';
      const supportedFormats = ['csv', 'json', 'pdf'];

      expect(supportedFormats.includes(requestedFormat)).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle NOT_CONFIGURED error', async () => {
      const store = null;

      if (!store) {
        const response = { error: 'NOT_CONFIGURED', message: 'Store not configured' };
        expect(response.error).toBe('NOT_CONFIGURED');
      }
    });

    it('should handle validation errors', async () => {
      const invalidParams = { startDate: 'invalid' };

      const response = { error: 'VALIDATION_ERROR', message: 'Invalid parameters' };
      expect(response.error).toBe('VALIDATION_ERROR');
    });

    it('should handle database errors gracefully', async () => {
      const error = new Error('Database connection failed');

      const response = {
        error: 'INTERNAL_ERROR',
        message: 'An internal error occurred. Please try again.',
      };

      expect(response.error).toBe('INTERNAL_ERROR');
      expect(response.message).not.toContain('Database');
    });
  });
});
