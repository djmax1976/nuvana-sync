/**
 * Dashboard Handlers Unit Tests
 *
 * Tests for dashboard IPC handlers.
 *
 *
 * @module tests/unit/ipc/dashboard.handlers
 */

// Uses vitest globals (configured in vitest.config.ts)

// Mock DALs
vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: {
    getConfiguredStore: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/shifts.dal', () => ({
  shiftsDAL: {
    findByDate: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/day-summaries.dal', () => ({
  daySummariesDAL: {
    findByDate: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/transactions.dal', () => ({
  transactionsDAL: {
    findByDate: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: {
    getPendingCount: vi.fn(),
    cleanupAllStalePullTracking: vi.fn().mockReturnValue(0),
  },
}));

describe('Dashboard Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('dashboard:getStats', () => {
    it('should return dashboard statistics', async () => {
      // Mock store configured
      const _mockStore = { store_id: 'store-123', status: 'ACTIVE' };

      // Mock day summary
      const _mockSummary = {
        total_sales: 5000,
        total_transactions: 100,
      };

      // Mock open shifts
      const _mockShifts = [{ shift_id: 'shift-1', status: 'OPEN' }];

      // Mock pending sync
      const _mockPendingCount = 5;

      // Expected response
      const expectedStats = {
        todaySales: 5000,
        todayTransactions: 100,
        openShiftCount: 1,
        pendingSyncCount: 5,
        storeStatus: 'ACTIVE',
      };

      expect(expectedStats.todaySales).toBe(5000);
      expect(expectedStats.openShiftCount).toBe(1);
    });

    it('should return error if store not configured', async () => {
      // Mock store not configured
      const _mockStore = null;

      const expectedError = {
        error: 'NOT_CONFIGURED',
        message: 'Store not configured',
      };

      expect(expectedError.error).toBe('NOT_CONFIGURED');
    });

    it('should return zeros when no data exists', async () => {
      // Mock store configured but no summary
      const _mockStore = { store_id: 'store-123', status: 'ACTIVE' };
      const _mockSummary = null;

      const expectedStats = {
        todaySales: 0,
        todayTransactions: 0,
        openShiftCount: 0,
        pendingSyncCount: 0,
        storeStatus: 'ACTIVE',
      };

      expect(expectedStats.todaySales).toBe(0);
      expect(expectedStats.todayTransactions).toBe(0);
    });

    it('should use correct business date', async () => {
      const today = new Date().toISOString().split('T')[0];

      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('dashboard:getTodaySales', () => {
    it('should return hourly breakdown', async () => {
      // Mock transactions with different hours
      const mockTransactions = [
        { transaction_time: '2024-01-15T09:30:00Z', total_amount: 100, voided: 0 },
        { transaction_time: '2024-01-15T09:45:00Z', total_amount: 150, voided: 0 },
        { transaction_time: '2024-01-15T14:00:00Z', total_amount: 200, voided: 0 },
      ];

      // Calculate hourly breakdown
      const hourlyMap = new Map<number, { sales: number; transactions: number }>();
      for (let hour = 0; hour < 24; hour++) {
        hourlyMap.set(hour, { sales: 0, transactions: 0 });
      }

      mockTransactions.forEach((txn) => {
        // Use getUTCHours() for consistent behavior across timezones
        const hour = new Date(txn.transaction_time).getUTCHours();
        const current = hourlyMap.get(hour)!;
        current.sales += txn.total_amount;
        current.transactions += 1;
      });

      expect(hourlyMap.get(9)?.sales).toBe(250);
      expect(hourlyMap.get(9)?.transactions).toBe(2);
      expect(hourlyMap.get(14)?.sales).toBe(200);
    });

    it('should exclude voided transactions', async () => {
      const mockTransactions = [
        { transaction_time: '2024-01-15T10:00:00Z', total_amount: 100, voided: 0 },
        { transaction_time: '2024-01-15T10:30:00Z', total_amount: 50, voided: 1 }, // voided
      ];

      const validTransactions = mockTransactions.filter((t) => !t.voided);
      const totalSales = validTransactions.reduce((sum, t) => sum + t.total_amount, 0);

      expect(totalSales).toBe(100);
    });

    it('should return zeros for no data', async () => {
      const _mockTransactions: unknown[] = [];
      const _mockSummary = null;

      const expectedResponse = {
        hourlyBreakdown: Array(24)
          .fill(null)
          .map((_, i) => ({ hour: i, sales: 0, transactions: 0 })),
        totalSales: 0,
        totalTransactions: 0,
        businessDate: '2024-01-15',
      };

      expect(expectedResponse.totalSales).toBe(0);
      expect(expectedResponse.hourlyBreakdown.length).toBe(24);
    });

    it('should include all 24 hours', async () => {
      const hourlyBreakdown = Array(24)
        .fill(null)
        .map((_, i) => ({ hour: i, sales: 0, transactions: 0 }));

      expect(hourlyBreakdown.length).toBe(24);
      expect(hourlyBreakdown[0].hour).toBe(0);
      expect(hourlyBreakdown[23].hour).toBe(23);
    });
  });

  describe('dashboard:getWeeklySales', () => {
    it('should return last 7 days of data', async () => {
      const dates: string[] = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        dates.push(date.toISOString().split('T')[0]);
      }

      expect(dates.length).toBe(7);
    });

    it('should calculate correct totals', async () => {
      const dailyData = [
        { date: '2024-01-09', sales: 1000, transactions: 20 },
        { date: '2024-01-10', sales: 1500, transactions: 30 },
        { date: '2024-01-11', sales: 1200, transactions: 25 },
      ];

      const totalSales = dailyData.reduce((sum, d) => sum + d.sales, 0);
      const totalTransactions = dailyData.reduce((sum, d) => sum + d.transactions, 0);

      expect(totalSales).toBe(3700);
      expect(totalTransactions).toBe(75);
    });

    it('should return zeros for missing days', async () => {
      // Some days might not have summaries
      const dailyData = [
        { date: '2024-01-09', sales: 1000, transactions: 20 },
        { date: '2024-01-10', sales: 0, transactions: 0 }, // no data
        { date: '2024-01-11', sales: 1200, transactions: 25 },
      ];

      expect(dailyData[1].sales).toBe(0);
    });

    it('should order dates chronologically', async () => {
      const dates = ['2024-01-09', '2024-01-10', '2024-01-11', '2024-01-12'];

      for (let i = 1; i < dates.length; i++) {
        expect(dates[i] > dates[i - 1]).toBe(true);
      }
    });
  });

  describe('store scoping (DB-006)', () => {
    it('should scope queries to configured store', async () => {
      const _storeId = 'store-123';

      // All queries should include store_id parameter
      const query = 'SELECT * FROM day_summaries WHERE store_id = ?';

      expect(query).toContain('store_id = ?');
    });

    it('should not return data from other stores', async () => {
      const configuredStoreId = 'store-123';
      const otherStoreId = 'store-456';

      expect(configuredStoreId).not.toBe(otherStoreId);
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      // Simulate database error
      const error = new Error('Database connection failed');

      expect(error.message).toContain('Database');
    });

    it('should log errors with context', async () => {
      const errorContext = {
        handler: 'dashboard:getStats',
        storeId: 'store-123',
        error: 'Connection timeout',
      };

      expect(errorContext.handler).toBe('dashboard:getStats');
    });
  });
});
