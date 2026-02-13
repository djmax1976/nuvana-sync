/**
 * Dashboard IPC Integration Tests
 *
 * Tests for the IPC communication between renderer and main process.
 * Validates that dashboard data flows correctly through IPC channels.
 *
 * DO NOT RUN - These tests require Electron environment
 *
 * @module tests/integration/dashboard-ipc
 */

// Uses vitest globals (configured in vitest.config.ts)

// Mock the IPC client for testing
const mockInvoke = vi.fn();

vi.mock('../../src/renderer/lib/api/ipc-client', () => ({
  ipcClient: {
    invoke: mockInvoke,
    on: vi.fn(() => () => {}),
    once: vi.fn(),
  },
  IPCError: class IPCError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

describe('Dashboard IPC Integration', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe('dashboard:getStats', () => {
    it('should return dashboard statistics', async () => {
      const mockStats = {
        todaySales: 1250.5,
        todayTransactions: 45,
        openShiftCount: 2,
        pendingSyncCount: 0,
        storeStatus: 'ACTIVE',
      };

      mockInvoke.mockResolvedValueOnce(mockStats);

      // Import after mock setup
      const { ipc } = await import('../../src/renderer/lib/transport');
      const result = await ipc.dashboard.getStats();

      expect(mockInvoke).toHaveBeenCalledWith('dashboard:getStats');
      expect(result).toEqual(mockStats);
    });

    it('should handle NOT_CONFIGURED error', async () => {
      mockInvoke.mockRejectedValueOnce({
        code: 'NOT_CONFIGURED',
        message: 'Store not configured',
      });

      const { ipc } = await import('../../src/renderer/lib/transport');

      await expect(ipc.dashboard.getStats()).rejects.toMatchObject({
        code: 'NOT_CONFIGURED',
      });
    });
  });

  describe('dashboard:getTodaySales', () => {
    it('should return hourly breakdown', async () => {
      const mockTodaySales = {
        hourlyBreakdown: [
          { hour: 8, sales: 150, transactions: 5 },
          { hour: 9, sales: 200, transactions: 8 },
          { hour: 10, sales: 180, transactions: 6 },
        ],
        totalSales: 530,
        totalTransactions: 19,
        businessDate: '2026-01-11',
      };

      mockInvoke.mockResolvedValueOnce(mockTodaySales);

      const { ipc } = await import('../../src/renderer/lib/transport');
      const result = await ipc.dashboard.getTodaySales();

      expect(mockInvoke).toHaveBeenCalledWith('dashboard:getTodaySales');
      expect(result.hourlyBreakdown).toHaveLength(3);
      expect(result.totalSales).toBe(530);
    });

    it('should return empty array for no data', async () => {
      mockInvoke.mockResolvedValueOnce({
        hourlyBreakdown: [],
        totalSales: 0,
        totalTransactions: 0,
        businessDate: '2026-01-11',
      });

      const { ipc } = await import('../../src/renderer/lib/transport');
      const result = await ipc.dashboard.getTodaySales();

      expect(result.hourlyBreakdown).toHaveLength(0);
      expect(result.totalSales).toBe(0);
    });
  });

  describe('dashboard:getWeeklySales', () => {
    it('should return 7 days of data', async () => {
      const mockWeeklySales = {
        dailyData: Array.from({ length: 7 }, (_, i) => ({
          date: `2026-01-${5 + i}`,
          sales: 1000 + i * 100,
          transactions: 30 + i * 5,
        })),
        totalSales: 7700,
        totalTransactions: 245,
      };

      mockInvoke.mockResolvedValueOnce(mockWeeklySales);

      const { ipc } = await import('../../src/renderer/lib/transport');
      const result = await ipc.dashboard.getWeeklySales();

      expect(mockInvoke).toHaveBeenCalledWith('dashboard:getWeeklySales');
      expect(result.dailyData).toHaveLength(7);
    });
  });
});

describe('Shifts IPC Integration', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe('shifts:list', () => {
    it('should return paginated shifts', async () => {
      const mockShifts = {
        shifts: [
          {
            shift_id: 'shift-1',
            store_id: 'store-1',
            shift_number: 1,
            business_date: '2026-01-11',
            status: 'OPEN',
            created_at: '2026-01-11T08:00:00Z',
            updated_at: '2026-01-11T08:00:00Z',
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      };

      mockInvoke.mockResolvedValueOnce(mockShifts);

      const { ipc } = await import('../../src/renderer/lib/transport');
      const result = await ipc.shifts.list({ limit: 20, offset: 0 });

      expect(mockInvoke).toHaveBeenCalledWith('shifts:list', { limit: 20, offset: 0 });
      expect(result.shifts).toHaveLength(1);
    });

    it('should filter by date range', async () => {
      mockInvoke.mockResolvedValueOnce({
        shifts: [],
        total: 0,
        limit: 20,
        offset: 0,
      });

      const { ipc } = await import('../../src/renderer/lib/transport');
      await ipc.shifts.list({
        startDate: '2026-01-01',
        endDate: '2026-01-07',
      });

      expect(mockInvoke).toHaveBeenCalledWith('shifts:list', {
        startDate: '2026-01-01',
        endDate: '2026-01-07',
      });
    });

    it('should filter by status', async () => {
      mockInvoke.mockResolvedValueOnce({
        shifts: [],
        total: 0,
        limit: 20,
        offset: 0,
      });

      const { ipc } = await import('../../src/renderer/lib/transport');
      await ipc.shifts.list({ status: 'OPEN' });

      expect(mockInvoke).toHaveBeenCalledWith('shifts:list', { status: 'OPEN' });
    });
  });

  describe('shifts:close', () => {
    it('should close an open shift with closing cash', async () => {
      const closedShift = {
        shift_id: 'shift-1',
        store_id: 'store-1',
        shift_number: 1,
        status: 'CLOSED',
        end_time: '2026-01-11T16:00:00Z',
        closing_cash: 250.50,
      };

      mockInvoke.mockResolvedValueOnce(closedShift);

      const { ipc } = await import('../../src/renderer/lib/transport');
      const result = await ipc.shifts.close('shift-1', 250.50);

      expect(mockInvoke).toHaveBeenCalledWith('shifts:close', {
        shift_id: 'shift-1',
        closing_cash: 250.50,
      });
      expect(result.status).toBe('CLOSED');
      expect(result.closing_cash).toBe(250.50);
    });

    it('should close shift with zero closing cash', async () => {
      const closedShift = {
        shift_id: 'shift-1',
        store_id: 'store-1',
        shift_number: 1,
        status: 'CLOSED',
        end_time: '2026-01-11T16:00:00Z',
        closing_cash: 0,
      };

      mockInvoke.mockResolvedValueOnce(closedShift);

      const { ipc } = await import('../../src/renderer/lib/transport');
      const result = await ipc.shifts.close('shift-1', 0);

      expect(mockInvoke).toHaveBeenCalledWith('shifts:close', {
        shift_id: 'shift-1',
        closing_cash: 0,
      });
      expect(result.closing_cash).toBe(0);
    });

    it('should reject already closed shift', async () => {
      mockInvoke.mockRejectedValueOnce({
        code: 'ALREADY_CLOSED',
        message: 'Shift is already closed',
      });

      const { ipc } = await import('../../src/renderer/lib/transport');

      await expect(ipc.shifts.close('shift-1', 100)).rejects.toMatchObject({
        code: 'ALREADY_CLOSED',
      });
    });

    it('should require MANAGER role', async () => {
      mockInvoke.mockRejectedValueOnce({
        code: 'FORBIDDEN',
        message: 'Insufficient permissions',
      });

      const { ipc } = await import('../../src/renderer/lib/transport');

      await expect(ipc.shifts.close('shift-1', 100)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });
});

describe('Day Summaries IPC Integration', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe('daySummaries:close', () => {
    it('should close business day', async () => {
      const closedDay = {
        summary_id: 'summary-1',
        store_id: 'store-1',
        business_date: '2026-01-11',
        status: 'CLOSED',
        closed_at: '2026-01-11T23:59:59Z',
      };

      mockInvoke.mockResolvedValueOnce(closedDay);

      const { ipc } = await import('../../src/renderer/lib/transport');
      const result = await ipc.daySummaries.close('2026-01-11');

      expect(mockInvoke).toHaveBeenCalledWith('daySummaries:close', '2026-01-11');
      expect(result.status).toBe('CLOSED');
    });

    it('should reject if open shifts exist', async () => {
      mockInvoke.mockRejectedValueOnce({
        code: 'OPEN_SHIFTS',
        message: 'Cannot close day with 2 open shift(s)',
      });

      const { ipc } = await import('../../src/renderer/lib/transport');

      await expect(ipc.daySummaries.close('2026-01-11')).rejects.toMatchObject({
        code: 'OPEN_SHIFTS',
      });
    });
  });
});

describe('Reports IPC Integration', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe('reports:weekly', () => {
    it('should return weekly report data', async () => {
      const mockReport = {
        weekStartDate: '2026-01-05',
        weekEndDate: '2026-01-11',
        dailyData: Array.from({ length: 7 }, (_, i) => ({
          date: `2026-01-${5 + i}`,
          totalSales: 1000,
          transactionCount: 30,
          fuelSales: 500,
          merchandiseSales: 500,
          status: 'CLOSED' as const,
        })),
        totals: {
          sales: 7000,
          transactions: 210,
          fuelSales: 3500,
          merchandiseSales: 3500,
        },
      };

      mockInvoke.mockResolvedValueOnce(mockReport);

      const { ipc } = await import('../../src/renderer/lib/transport');
      const result = await ipc.reports.weekly('2026-01-05');

      expect(mockInvoke).toHaveBeenCalledWith('reports:weekly', '2026-01-05');
      expect(result.dailyData).toHaveLength(7);
      expect(result.totals.sales).toBe(7000);
    });
  });

  describe('reports:monthly', () => {
    it('should return monthly report data', async () => {
      const mockReport = {
        year: 2026,
        month: 1,
        summaries: [],
        totals: {
          sales: 30000,
          transactions: 900,
          closedDays: 11,
          openDays: 0,
        },
      };

      mockInvoke.mockResolvedValueOnce(mockReport);

      const { ipc } = await import('../../src/renderer/lib/transport');
      const result = await ipc.reports.monthly({ year: 2026, month: 1 });

      expect(mockInvoke).toHaveBeenCalledWith('reports:monthly', { year: 2026, month: 1 });
      expect(result.year).toBe(2026);
      expect(result.month).toBe(1);
    });
  });

  describe('reports:dateRange', () => {
    it('should return custom range report data', async () => {
      const mockReport = {
        startDate: '2026-01-01',
        endDate: '2026-01-11',
        summaries: [],
        totals: {
          sales: 11000,
          transactions: 330,
          dayCount: 11,
        },
      };

      mockInvoke.mockResolvedValueOnce(mockReport);

      const { ipc } = await import('../../src/renderer/lib/transport');
      const result = await ipc.reports.dateRange({
        startDate: '2026-01-01',
        endDate: '2026-01-11',
      });

      expect(mockInvoke).toHaveBeenCalledWith('reports:dateRange', {
        startDate: '2026-01-01',
        endDate: '2026-01-11',
      });
      expect(result.totals.dayCount).toBe(11);
    });

    it('should reject if date range exceeds 365 days', async () => {
      mockInvoke.mockRejectedValueOnce({
        code: 'VALIDATION_ERROR',
        message: 'Date range cannot exceed 365 days',
      });

      const { ipc } = await import('../../src/renderer/lib/transport');

      await expect(
        ipc.reports.dateRange({
          startDate: '2025-01-01',
          endDate: '2026-01-11',
        })
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });
  });
});
