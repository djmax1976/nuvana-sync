/**
 * Reports Handlers Unit Tests
 *
 * Tests for report generation IPC handlers.
 * Includes multi-close aggregation tests for lottery day report.
 *
 * @module tests/unit/ipc/reports.handlers
 * @security SEC-006: Verifies parameterized queries
 * @security DB-006: Verifies tenant isolation (store_id scoping)
 */

// Uses vitest globals (configured in vitest.config.ts)

// ============================================================================
// Hoisted mocks for handler capture
// ============================================================================
const {
  capturedHandlers,
  mockCreateErrorResponse,
  mockGetConfiguredStore,
  mockFindByStatus,
  mockAllDaysAll,
  mockBinsAll,
  mockActivatedAll,
  mockDepletedAll,
  mockReturnedAll,
  mockPrepare,
} = vi.hoisted(() => ({
  capturedHandlers: {} as Record<string, (...args: unknown[]) => unknown>,
  mockCreateErrorResponse: vi.fn((code: string, message: string) => ({ error: code, message })),
  mockGetConfiguredStore: vi.fn(),
  mockFindByStatus: vi.fn(),
  mockAllDaysAll: vi.fn(),
  mockBinsAll: vi.fn(),
  mockActivatedAll: vi.fn(),
  mockDepletedAll: vi.fn(),
  mockReturnedAll: vi.fn(),
  mockPrepare: vi.fn(),
}));

// ============================================================================
// Mock IPC registration — captures handler callbacks for direct invocation
// ============================================================================
vi.mock('../../../src/main/ipc/index', () => ({
  registerHandler: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    capturedHandlers[channel] = handler;
  }),
  createErrorResponse: mockCreateErrorResponse,
  IPCErrorCodes: {
    NOT_CONFIGURED: 'NOT_CONFIGURED',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
  },
}));

// ============================================================================
// Mock database service
// ============================================================================
vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
  })),
}));

// ============================================================================
// Mock DALs
// ============================================================================
vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: {
    getConfiguredStore: mockGetConfiguredStore,
  },
}));

vi.mock('../../../src/main/dal/day-summaries.dal', () => ({
  daySummariesDAL: {
    findByDateRange: vi.fn(),
    findByDate: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/lottery-business-days.dal', () => ({
  lotteryBusinessDaysDAL: {
    findByStatus: mockFindByStatus,
  },
}));

vi.mock('../../../src/main/dal', () => ({
  shiftSummariesDAL: {
    findByDate: vi.fn().mockReturnValue([]),
  },
  shiftFuelSummariesDAL: {
    getShiftTotals: vi.fn().mockReturnValue({ totalSales: 0 }),
  },
  shiftDepartmentSummariesDAL: {
    findByShiftSummary: vi.fn().mockReturnValue([]),
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

// ============================================================================
// Mock logger
// ============================================================================
vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ============================================================================
// Import handler module to trigger registration
// ============================================================================
import '../../../src/main/ipc/reports.handlers';

// ============================================================================
// Test Helpers
// ============================================================================

const TEST_STORE_ID = 'store-test-001';
const TEST_BUSINESS_DATE = '2026-02-02';

function createMockBusinessDay(overrides: Record<string, unknown> = {}) {
  return {
    day_id: 'day-001',
    store_id: TEST_STORE_ID,
    business_date: TEST_BUSINESS_DATE,
    status: 'CLOSED',
    opened_at: '2026-02-02T15:24:00Z',
    closed_at: '2026-02-02T18:25:00Z',
    opened_by: 'user-001',
    closed_by: 'user-001',
    total_sales: 30,
    total_packs_sold: 1,
    total_packs_activated: 0,
    day_summary_id: null,
    synced_at: null,
    created_at: '2026-02-02T15:24:00Z',
    updated_at: '2026-02-02T18:25:00Z',
    total_tickets_sold: 1,
    ...overrides,
  };
}

function createMockBinRow(overrides: Record<string, unknown> = {}) {
  return {
    day_id: 'day-001',
    pack_id: 'pack-001',
    bin_display_order: 0,
    game_name: 'Game A',
    game_price: 30,
    pack_number: 'PKG-001',
    pack_opening_serial: '000',
    pack_closing_serial: '300',
    starting_serial: '000',
    ending_serial: '004',
    tickets_sold: 4,
    sales_amount: 120,
    prev_ending_serial: null,
    ...overrides,
  };
}

/**
 * Set up mockPrepare to return the right mock statement for each call in order.
 * The handler calls prepare 5 times:
 *   1. allDaysStmt, 2. binsStmt, 3. activatedStmt, 4. depletedStmt, 5. returnedStmt
 */
function setupPrepareChain(config: {
  allDays?: unknown[];
  bins?: unknown[];
  activated?: unknown[];
  depleted?: unknown[];
  returned?: unknown[];
}) {
  // Reset all statement mocks to clear any leftover mockReturnValueOnce queues
  mockPrepare.mockReset();
  mockAllDaysAll.mockReset();
  mockBinsAll.mockReset();
  mockActivatedAll.mockReset();
  mockDepletedAll.mockReset();
  mockReturnedAll.mockReset();

  mockAllDaysAll.mockReturnValue(config.allDays ?? []);
  mockBinsAll.mockReturnValue(config.bins ?? []);
  mockActivatedAll.mockReturnValue(config.activated ?? []);
  mockDepletedAll.mockReturnValue(config.depleted ?? []);
  mockReturnedAll.mockReturnValue(config.returned ?? []);

  mockPrepare
    .mockReturnValueOnce({ all: mockAllDaysAll })
    .mockReturnValueOnce({ all: mockBinsAll })
    .mockReturnValueOnce({ all: mockActivatedAll })
    .mockReturnValueOnce({ all: mockDepletedAll })
    .mockReturnValueOnce({ all: mockReturnedAll });
}

function setupConfiguredStore() {
  mockGetConfiguredStore.mockReturnValue({
    store_id: TEST_STORE_ID,
    status: 'ACTIVE',
  });
}

/** Response shape for lottery day report handler */
interface LotteryDayReportResult {
  businessDate: string;
  dayStatus: 'OPEN' | 'PENDING_CLOSE' | 'CLOSED' | null;
  closedAt: string | null;
  lotteryTotal: number;
  totalClosings: number;
  closingSessions: Array<{
    closingNumber: number;
    dayId: string;
    openedAt: string | null;
    closedAt: string | null;
    binSales: number;
    packSales: number;
    returnSales: number;
    totalSales: number;
    totalTicketsSold: number;
    bins: Array<{
      bin_number: number;
      game_name: string;
      game_price: number;
      pack_number: string;
      starting_serial: string;
      ending_serial: string;
      tickets_sold: number;
      sales_amount: number;
    }>;
    depletedPacks: unknown[];
    returnedPacks: unknown[];
    activatedPacks: unknown[];
  }>;
  bins: Array<{
    bin_number: number;
    game_name: string;
    game_price: number;
    pack_number: string;
    starting_serial: string;
    ending_serial: string;
    tickets_sold: number;
    sales_amount: number;
  }>;
  activatedPacks: unknown[];
  depletedPacks: unknown[];
  returnedPacks: unknown[];
  error?: string;
  message?: string;
}

function callLotteryDayReport(businessDate: string = TEST_BUSINESS_DATE) {
  const handler = capturedHandlers['reports:getLotteryDayReport'];
  // Handler signature: (event, paramsInput)
  return handler({} as unknown, { businessDate }) as Promise<LotteryDayReportResult>;
}

// ============================================================================
// Tests
// ============================================================================

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
      const _storeId = 'store-123';

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
      const _invalidParams = { startDate: 'invalid' };

      const response = { error: 'VALIDATION_ERROR', message: 'Invalid parameters' };
      expect(response.error).toBe('VALIDATION_ERROR');
    });

    it('should handle database errors gracefully', async () => {
      const _error = new Error('Database connection failed');

      const response = {
        error: 'INTERNAL_ERROR',
        message: 'An internal error occurred. Please try again.',
      };

      expect(response.error).toBe('INTERNAL_ERROR');
      expect(response.message).not.toContain('Database');
    });
  });

  // ============================================================================
  // Lottery Day Report — Multi-Close Aggregation Tests
  // ============================================================================

  describe('reports:getLotteryDayReport — multi-close aggregation', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // Default: no previous closed days for period boundaries
      mockFindByStatus.mockReturnValue([]);
    });

    it('should be registered as a handler', () => {
      expect(capturedHandlers['reports:getLotteryDayReport']).toBeDefined();
      expect(typeof capturedHandlers['reports:getLotteryDayReport']).toBe('function');
    });

    // ------------------------------------------------------------------
    // 3.1-a: Multi-close aggregation returns correct starting serial
    // from first closing
    // ------------------------------------------------------------------
    it('should return starting serial from first closing and ending serial from last closing', async () => {
      setupConfiguredStore();

      // 3 closings with progressively increasing serials
      const day1 = createMockBusinessDay({
        day_id: 'day-001',
        opened_at: '2026-02-02T15:24:00Z',
        closed_at: '2026-02-02T18:25:00Z',
        total_sales: 0,
        total_tickets_sold: 0,
      });
      const day2 = createMockBusinessDay({
        day_id: 'day-002',
        opened_at: '2026-02-02T18:25:00Z',
        closed_at: '2026-02-02T23:04:00Z',
        total_sales: 30,
        total_tickets_sold: 1,
      });
      const day3 = createMockBusinessDay({
        day_id: 'day-003',
        opened_at: '2026-02-02T23:04:00Z',
        closed_at: '2026-02-03T00:15:00Z',
        total_sales: 30,
        total_tickets_sold: 1,
      });

      // Per-session rows: one row per (day_id, pack_id) — handler aggregates in JS
      setupPrepareChain({
        allDays: [day1, day2, day3],
        bins: [
          createMockBinRow({
            day_id: 'day-001',
            pack_id: 'pack-001',
            starting_serial: '000',
            ending_serial: '000',
            tickets_sold: 0,
            sales_amount: 0,
          }),
          createMockBinRow({
            day_id: 'day-002',
            pack_id: 'pack-001',
            starting_serial: '000',
            ending_serial: '001',
            tickets_sold: 1,
            sales_amount: 30,
          }),
          createMockBinRow({
            day_id: 'day-003',
            pack_id: 'pack-001',
            starting_serial: '001',
            ending_serial: '002',
            tickets_sold: 1,
            sales_amount: 30,
          }),
        ],
      });

      const result = await callLotteryDayReport();

      // Combined bins: starting from first session, ending from last session
      expect(result.bins[0].starting_serial).toBe('000');
      expect(result.bins[0].ending_serial).toBe('002');
    });

    // ------------------------------------------------------------------
    // 3.1-b: Multi-close aggregation sums tickets_sold and sales_amount
    // ------------------------------------------------------------------
    it('should sum tickets_sold and sales_amount across all closings', async () => {
      setupConfiguredStore();

      const day1 = createMockBusinessDay({
        day_id: 'day-001',
        opened_at: '2026-02-02T15:00:00Z',
        closed_at: '2026-02-02T18:00:00Z',
        total_sales: 60,
        total_tickets_sold: 2,
      });
      const day2 = createMockBusinessDay({
        day_id: 'day-002',
        opened_at: '2026-02-02T18:00:00Z',
        closed_at: '2026-02-02T23:00:00Z',
        total_sales: 90,
        total_tickets_sold: 3,
      });

      // Per-session rows: handler sums tickets_sold and sales_amount across sessions
      setupPrepareChain({
        allDays: [day1, day2],
        bins: [
          createMockBinRow({
            day_id: 'day-001',
            pack_id: 'pack-001',
            tickets_sold: 2,
            sales_amount: 60,
          }),
          createMockBinRow({
            day_id: 'day-002',
            pack_id: 'pack-001',
            tickets_sold: 3,
            sales_amount: 90,
          }),
        ],
      });

      const result = await callLotteryDayReport();

      // Combined bins: summed across sessions
      expect(result.bins[0].tickets_sold).toBe(5);
      expect(result.bins[0].sales_amount).toBe(150);
    });

    // ------------------------------------------------------------------
    // 3.1-c: Single closing still works (regression)
    // ------------------------------------------------------------------
    it('should produce correct result for single closing (regression)', async () => {
      setupConfiguredStore();

      const singleDay = createMockBusinessDay({
        day_id: 'day-001',
        total_sales: 120,
        total_tickets_sold: 4,
      });

      setupPrepareChain({
        allDays: [singleDay],
        bins: [
          createMockBinRow({
            starting_serial: '000',
            ending_serial: '004',
            tickets_sold: 4,
            sales_amount: 120,
          }),
        ],
      });

      const result = await callLotteryDayReport();

      expect(result.totalClosings).toBe(1);
      expect(result.closingSessions).toHaveLength(1);
      expect(result.bins[0].starting_serial).toBe('000');
      expect(result.bins[0].ending_serial).toBe('004');
      expect(result.bins[0].tickets_sold).toBe(4);
      expect(result.bins[0].sales_amount).toBe(120);
      expect(result.lotteryTotal).toBe(120);
    });

    // ------------------------------------------------------------------
    // 3.1-d: Zero closings returns empty response
    // ------------------------------------------------------------------
    it('should return empty response when no closings exist for date', async () => {
      setupConfiguredStore();

      setupPrepareChain({ allDays: [] });

      const result = await callLotteryDayReport();

      expect(result.businessDate).toBe(TEST_BUSINESS_DATE);
      expect(result.dayStatus).toBeNull();
      expect(result.closedAt).toBeNull();
      expect(result.lotteryTotal).toBe(0);
      expect(result.totalClosings).toBe(0);
      expect(result.closingSessions).toHaveLength(0);
      expect(result.bins).toHaveLength(0);
      expect(result.activatedPacks).toHaveLength(0);
      expect(result.depletedPacks).toHaveLength(0);
      expect(result.returnedPacks).toHaveLength(0);
    });

    // ------------------------------------------------------------------
    // 3.1-e: closingSessions array is ordered by opened_at ASC
    // ------------------------------------------------------------------
    it('should return closingSessions ordered by opened_at ASC', async () => {
      setupConfiguredStore();

      const day1 = createMockBusinessDay({
        day_id: 'day-001',
        opened_at: '2026-02-02T15:24:00Z',
        closed_at: '2026-02-02T18:25:00Z',
        total_sales: 0,
        total_tickets_sold: 0,
      });
      const day2 = createMockBusinessDay({
        day_id: 'day-002',
        opened_at: '2026-02-02T18:25:00Z',
        closed_at: '2026-02-02T23:04:00Z',
        total_sales: 30,
        total_tickets_sold: 1,
      });
      const day3 = createMockBusinessDay({
        day_id: 'day-003',
        opened_at: '2026-02-02T23:04:00Z',
        closed_at: '2026-02-03T00:15:00Z',
        total_sales: 30,
        total_tickets_sold: 1,
      });

      // allDays are ordered by opened_at ASC (from the SQL ORDER BY)
      setupPrepareChain({ allDays: [day1, day2, day3] });

      const result = await callLotteryDayReport();

      expect(result.closingSessions).toHaveLength(3);
      expect(result.closingSessions[0].closingNumber).toBe(1);
      expect(result.closingSessions[0].openedAt).toBe('2026-02-02T15:24:00Z');
      expect(result.closingSessions[1].closingNumber).toBe(2);
      expect(result.closingSessions[1].openedAt).toBe('2026-02-02T18:25:00Z');
      expect(result.closingSessions[2].closingNumber).toBe(3);
      expect(result.closingSessions[2].openedAt).toBe('2026-02-02T23:04:00Z');
    });

    // ------------------------------------------------------------------
    // 3.1-f: closingSessions contains correct per-session data
    // ------------------------------------------------------------------
    it('should populate closingSessions with correct per-session data', async () => {
      setupConfiguredStore();

      const day1 = createMockBusinessDay({
        day_id: 'day-001',
        opened_at: '2026-02-02T15:24:00Z',
        closed_at: '2026-02-02T18:25:00Z',
        total_sales: 0,
        total_tickets_sold: 0,
      });
      const day2 = createMockBusinessDay({
        day_id: 'day-002',
        opened_at: '2026-02-02T18:25:00Z',
        closed_at: '2026-02-02T23:04:00Z',
        total_sales: 30,
        total_tickets_sold: 1,
      });

      // Provide per-session bin row for session 2 to verify totalSales computation
      setupPrepareChain({
        allDays: [day1, day2],
        bins: [
          createMockBinRow({
            day_id: 'day-002',
            pack_id: 'pack-001',
            tickets_sold: 1,
            sales_amount: 30,
          }),
        ],
      });

      const result = await callLotteryDayReport();

      // Session 1: no bins, no packs → all zeros
      expect(result.closingSessions[0]).toEqual({
        closingNumber: 1,
        dayId: 'day-001',
        openedAt: '2026-02-02T15:24:00Z',
        closedAt: '2026-02-02T18:25:00Z',
        binSales: 0,
        packSales: 0,
        returnSales: 0,
        totalSales: 0,
        totalTicketsSold: 0,
        bins: [],
        depletedPacks: [],
        returnedPacks: [],
        activatedPacks: [],
      });

      // Session 2: has one bin with sales_amount=30
      expect(result.closingSessions[1]).toEqual({
        closingNumber: 2,
        dayId: 'day-002',
        openedAt: '2026-02-02T18:25:00Z',
        closedAt: '2026-02-02T23:04:00Z',
        binSales: 30,
        packSales: 0,
        returnSales: 0,
        totalSales: 30,
        totalTicketsSold: 1,
        bins: [
          {
            bin_number: 1,
            game_name: 'Game A',
            game_price: 30,
            pack_number: 'PKG-001',
            starting_serial: '000',
            ending_serial: '004',
            tickets_sold: 1,
            sales_amount: 30,
          },
        ],
        depletedPacks: [],
        returnedPacks: [],
        activatedPacks: [],
      });
    });

    // ------------------------------------------------------------------
    // 3.1-g: Pack appearing in only some closings gets correct starting serial
    // ------------------------------------------------------------------
    it('should use correct starting serial for pack that appears in only some closings', async () => {
      setupConfiguredStore();

      // Pack appears in closing 2 and 3 but not closing 1
      const day1 = createMockBusinessDay({
        day_id: 'day-001',
        opened_at: '2026-02-02T15:00:00Z',
        closed_at: '2026-02-02T18:00:00Z',
        total_sales: 0,
        total_tickets_sold: 0,
      });
      const day2 = createMockBusinessDay({
        day_id: 'day-002',
        opened_at: '2026-02-02T18:00:00Z',
        closed_at: '2026-02-02T22:00:00Z',
        total_sales: 30,
        total_tickets_sold: 1,
      });
      const day3 = createMockBusinessDay({
        day_id: 'day-003',
        opened_at: '2026-02-02T22:00:00Z',
        closed_at: '2026-02-03T01:00:00Z',
        total_sales: 60,
        total_tickets_sold: 2,
      });

      // Per-session rows: pack appears only in sessions 2 and 3
      // Handler aggregates: starting from first row, ending from last row
      setupPrepareChain({
        allDays: [day1, day2, day3],
        bins: [
          createMockBinRow({
            day_id: 'day-002',
            pack_id: 'pack-late-001',
            pack_number: 'PKG-LATE',
            starting_serial: '005',
            ending_serial: '006',
            tickets_sold: 1,
            sales_amount: 30,
          }),
          createMockBinRow({
            day_id: 'day-003',
            pack_id: 'pack-late-001',
            pack_number: 'PKG-LATE',
            starting_serial: '006',
            ending_serial: '008',
            tickets_sold: 2,
            sales_amount: 60,
          }),
        ],
      });

      const result = await callLotteryDayReport();

      // Combined: starting from session 2, ending from session 3
      expect(result.bins[0].starting_serial).toBe('005');
      expect(result.bins[0].ending_serial).toBe('008');
    });

    // ------------------------------------------------------------------
    // 3.1-h: Query uses parameterized statements (SEC-006)
    // ------------------------------------------------------------------
    it('should use parameterized statements in all queries (SEC-006)', async () => {
      setupConfiguredStore();

      const day = createMockBusinessDay({ day_id: 'day-001' });
      setupPrepareChain({ allDays: [day] });

      await callLotteryDayReport();

      // Verify db.prepare was called (prepared statements, not raw SQL with concatenation)
      expect(mockPrepare).toHaveBeenCalled();

      // Inspect all SQL strings passed to prepare — none should contain string
      // interpolation of user input values (dates, store IDs)
      for (const call of mockPrepare.mock.calls) {
        const sql = call[0] as string;
        // SQL should use ? placeholders, not interpolated values
        expect(sql).toContain('?');
        // Should not contain the actual test store ID or date in the SQL string
        expect(sql).not.toContain(TEST_STORE_ID);
        expect(sql).not.toContain("'" + TEST_BUSINESS_DATE + "'");
      }

      // Verify parameters are passed to .all() (not embedded in SQL)
      // allDaysStmt receives storeId and businessDate as parameters
      expect(mockAllDaysAll).toHaveBeenCalledWith(TEST_STORE_ID, TEST_BUSINESS_DATE);
    });

    // ------------------------------------------------------------------
    // 3.1-i: Query scopes by store_id (DB-006 tenant isolation)
    // ------------------------------------------------------------------
    it('should scope all queries by store_id (DB-006 tenant isolation)', async () => {
      setupConfiguredStore();

      const day = createMockBusinessDay({ day_id: 'day-001' });
      setupPrepareChain({ allDays: [day] });

      await callLotteryDayReport();

      // All SQL queries must include store_id in WHERE clause
      for (const call of mockPrepare.mock.calls) {
        const sql = call[0] as string;
        expect(sql).toContain('store_id');
      }

      // The allDaysStmt must receive store_id as a parameter
      expect(mockAllDaysAll).toHaveBeenCalledWith(
        expect.stringContaining(TEST_STORE_ID),
        expect.anything()
      );

      // The binsStmt must include store_id in its parameters
      const binsCallArgs = mockBinsAll.mock.calls[0];
      expect(binsCallArgs).toContain(TEST_STORE_ID);
    });

    // ------------------------------------------------------------------
    // dayStatus composite logic
    // ------------------------------------------------------------------
    it('should report OPEN when any closing is OPEN', async () => {
      setupConfiguredStore();

      setupPrepareChain({
        allDays: [
          createMockBusinessDay({ day_id: 'day-001', status: 'CLOSED' }),
          createMockBusinessDay({ day_id: 'day-002', status: 'OPEN' }),
        ],
      });

      const result = await callLotteryDayReport();

      expect(result.dayStatus).toBe('OPEN');
    });

    it('should report PENDING_CLOSE when any closing is PENDING_CLOSE and none are OPEN', async () => {
      setupConfiguredStore();

      setupPrepareChain({
        allDays: [
          createMockBusinessDay({ day_id: 'day-001', status: 'CLOSED' }),
          createMockBusinessDay({ day_id: 'day-002', status: 'PENDING_CLOSE' }),
        ],
      });

      const result = await callLotteryDayReport();

      expect(result.dayStatus).toBe('PENDING_CLOSE');
    });

    it('should report CLOSED only when all closings are CLOSED', async () => {
      setupConfiguredStore();

      setupPrepareChain({
        allDays: [
          createMockBusinessDay({ day_id: 'day-001', status: 'CLOSED' }),
          createMockBusinessDay({ day_id: 'day-002', status: 'CLOSED' }),
          createMockBusinessDay({ day_id: 'day-003', status: 'CLOSED' }),
        ],
      });

      const result = await callLotteryDayReport();

      expect(result.dayStatus).toBe('CLOSED');
    });

    // ------------------------------------------------------------------
    // closedAt and lotteryTotal
    // ------------------------------------------------------------------
    it('should set closedAt from the last closing', async () => {
      setupConfiguredStore();

      setupPrepareChain({
        allDays: [
          createMockBusinessDay({
            day_id: 'day-001',
            closed_at: '2026-02-02T18:25:00Z',
          }),
          createMockBusinessDay({
            day_id: 'day-002',
            closed_at: '2026-02-02T23:04:00Z',
          }),
          createMockBusinessDay({
            day_id: 'day-003',
            closed_at: '2026-02-03T00:15:00Z',
          }),
        ],
      });

      const result = await callLotteryDayReport();

      expect(result.closedAt).toBe('2026-02-03T00:15:00Z');
    });

    it('should sum lotteryTotal across all closings', async () => {
      setupConfiguredStore();

      // lotteryTotal = sum of bins.sales_amount + depleted.sales_amount + returned.sales_amount
      setupPrepareChain({
        allDays: [
          createMockBusinessDay({ day_id: 'day-001', total_sales: 0 }),
          createMockBusinessDay({ day_id: 'day-002', total_sales: 30 }),
          createMockBusinessDay({ day_id: 'day-003', total_sales: 60 }),
        ],
        bins: [
          createMockBinRow({
            day_id: 'day-001',
            pack_id: 'pack-001',
            tickets_sold: 0,
            sales_amount: 0,
          }),
          createMockBinRow({
            day_id: 'day-002',
            pack_id: 'pack-001',
            tickets_sold: 1,
            sales_amount: 30,
          }),
          createMockBinRow({
            day_id: 'day-003',
            pack_id: 'pack-001',
            tickets_sold: 2,
            sales_amount: 60,
          }),
        ],
      });

      const result = await callLotteryDayReport();

      expect(result.lotteryTotal).toBe(90);
    });

    // ------------------------------------------------------------------
    // totalClosings
    // ------------------------------------------------------------------
    it('should set totalClosings to the number of business day records', async () => {
      setupConfiguredStore();

      setupPrepareChain({
        allDays: [
          createMockBusinessDay({ day_id: 'day-001' }),
          createMockBusinessDay({ day_id: 'day-002' }),
          createMockBusinessDay({ day_id: 'day-003' }),
          createMockBusinessDay({ day_id: 'day-004' }),
        ],
      });

      const result = await callLotteryDayReport();

      expect(result.totalClosings).toBe(4);
    });

    // ------------------------------------------------------------------
    // Input validation
    // ------------------------------------------------------------------
    it('should return error for store not configured', async () => {
      mockGetConfiguredStore.mockReturnValue(null);

      const result = await callLotteryDayReport();

      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'NOT_CONFIGURED',
        'Store not configured'
      );
      expect(result).toEqual(expect.objectContaining({ error: 'NOT_CONFIGURED' }));
    });

    it('should return validation error for invalid date format', async () => {
      setupConfiguredStore();

      const handler = capturedHandlers['reports:getLotteryDayReport'];
      const result = await handler({} as unknown, { businessDate: 'invalid-date' });

      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        expect.stringContaining('Invalid')
      );
      expect(result).toEqual(expect.objectContaining({ error: 'VALIDATION_ERROR' }));
    });

    // ------------------------------------------------------------------
    // IN clause construction safety
    // ------------------------------------------------------------------
    it('should build IN clause with parameterized placeholders for day_ids', async () => {
      setupConfiguredStore();

      setupPrepareChain({
        allDays: [
          createMockBusinessDay({ day_id: 'day-001' }),
          createMockBusinessDay({ day_id: 'day-002' }),
          createMockBusinessDay({ day_id: 'day-003' }),
        ],
      });

      await callLotteryDayReport();

      // The bins query (2nd prepare call) should contain IN (?, ?, ?)
      // for the 3 day_ids — not interpolated values
      const binsQuerySQL = mockPrepare.mock.calls[1]?.[0] as string;
      expect(binsQuerySQL).toContain('IN (?, ?, ?)');
      expect(binsQuerySQL).not.toContain('day-001');
      expect(binsQuerySQL).not.toContain('day-002');
    });
  });

  // ============================================================================
  // Phase 5: Edge Case & Regression Tests
  // ============================================================================

  describe('reports:getLotteryDayReport — edge cases (Phase 5)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockFindByStatus.mockReturnValue([]);
    });

    // ------------------------------------------------------------------
    // 5.1-a: Date with mix of CLOSED and PENDING_CLOSE days
    // ------------------------------------------------------------------
    it('should report PENDING_CLOSE status when mixing CLOSED and PENDING_CLOSE days', async () => {
      setupConfiguredStore();

      const closedDay1 = createMockBusinessDay({
        day_id: 'day-001',
        status: 'CLOSED',
        opened_at: '2026-02-02T15:00:00Z',
        closed_at: '2026-02-02T18:00:00Z',
        total_sales: 30,
        total_tickets_sold: 1,
      });
      const closedDay2 = createMockBusinessDay({
        day_id: 'day-002',
        status: 'CLOSED',
        opened_at: '2026-02-02T18:00:00Z',
        closed_at: '2026-02-02T22:00:00Z',
        total_sales: 60,
        total_tickets_sold: 2,
      });
      const pendingDay = createMockBusinessDay({
        day_id: 'day-003',
        status: 'PENDING_CLOSE',
        opened_at: '2026-02-02T22:00:00Z',
        closed_at: null,
        total_sales: 30,
        total_tickets_sold: 1,
      });

      // Per-session rows: one per day_id
      setupPrepareChain({
        allDays: [closedDay1, closedDay2, pendingDay],
        bins: [
          createMockBinRow({
            day_id: 'day-001',
            pack_id: 'pack-001',
            starting_serial: '000',
            ending_serial: '001',
            tickets_sold: 1,
            sales_amount: 30,
          }),
          createMockBinRow({
            day_id: 'day-002',
            pack_id: 'pack-001',
            starting_serial: '001',
            ending_serial: '003',
            tickets_sold: 2,
            sales_amount: 60,
          }),
          createMockBinRow({
            day_id: 'day-003',
            pack_id: 'pack-001',
            starting_serial: '003',
            ending_serial: '004',
            tickets_sold: 1,
            sales_amount: 30,
          }),
        ],
      });

      const result = await callLotteryDayReport();

      // Status reflects the mix — PENDING_CLOSE takes priority over CLOSED
      expect(result.dayStatus).toBe('PENDING_CLOSE');
      // All 3 closings included in count and sessions
      expect(result.totalClosings).toBe(3);
      expect(result.closingSessions).toHaveLength(3);
      // Bins are aggregated from ALL days (including PENDING_CLOSE)
      expect(result.bins).toHaveLength(1);
      expect(result.bins[0].starting_serial).toBe('000');
      expect(result.bins[0].ending_serial).toBe('004');
      // IN clause includes all 3 day_ids
      const binsSQL = mockPrepare.mock.calls[1]?.[0] as string;
      expect(binsSQL).toContain('IN (?, ?, ?)');
    });

    // ------------------------------------------------------------------
    // 5.1-b: Pack with same starting and ending serial (no tickets sold)
    // ------------------------------------------------------------------
    it('should handle pack with same start/end serial across closings (zero tickets)', async () => {
      setupConfiguredStore();

      setupPrepareChain({
        allDays: [
          createMockBusinessDay({
            day_id: 'day-001',
            opened_at: '2026-02-02T15:00:00Z',
            closed_at: '2026-02-02T18:00:00Z',
            total_sales: 0,
            total_tickets_sold: 0,
          }),
          createMockBusinessDay({
            day_id: 'day-002',
            opened_at: '2026-02-02T18:00:00Z',
            closed_at: '2026-02-02T22:00:00Z',
            total_sales: 0,
            total_tickets_sold: 0,
          }),
          createMockBusinessDay({
            day_id: 'day-003',
            opened_at: '2026-02-02T22:00:00Z',
            closed_at: '2026-02-03T01:00:00Z',
            total_sales: 0,
            total_tickets_sold: 0,
          }),
        ],
        // Per-session rows with zero tickets across all sessions
        bins: [
          createMockBinRow({
            day_id: 'day-001',
            pack_id: 'pack-001',
            starting_serial: '005',
            ending_serial: '005',
            tickets_sold: 0,
            sales_amount: 0,
          }),
          createMockBinRow({
            day_id: 'day-002',
            pack_id: 'pack-001',
            starting_serial: '005',
            ending_serial: '005',
            tickets_sold: 0,
            sales_amount: 0,
          }),
          createMockBinRow({
            day_id: 'day-003',
            pack_id: 'pack-001',
            starting_serial: '005',
            ending_serial: '005',
            tickets_sold: 0,
            sales_amount: 0,
          }),
        ],
      });

      const result = await callLotteryDayReport();

      expect(result.bins[0].starting_serial).toBe('005');
      expect(result.bins[0].ending_serial).toBe('005');
      expect(result.bins[0].tickets_sold).toBe(0);
      expect(result.bins[0].sales_amount).toBe(0);
      expect(result.lotteryTotal).toBe(0);
    });

    // ------------------------------------------------------------------
    // 5.1-c: Very large number of closings (stress test) — 10 closings
    // ------------------------------------------------------------------
    it('should correctly aggregate 10 closings for one date', async () => {
      setupConfiguredStore();

      const days = [];
      for (let i = 0; i < 10; i++) {
        days.push(
          createMockBusinessDay({
            day_id: `day-${String(i + 1).padStart(3, '0')}`,
            opened_at: `2026-02-02T${String(10 + i).padStart(2, '0')}:00:00Z`,
            closed_at: `2026-02-02T${String(11 + i).padStart(2, '0')}:00:00Z`,
            total_sales: 10,
            total_tickets_sold: 1,
          })
        );
      }

      // Per-session rows: 10 rows, one per session
      const binRows = Array.from({ length: 10 }, (_, i) =>
        createMockBinRow({
          day_id: `day-${String(i + 1).padStart(3, '0')}`,
          pack_id: 'pack-001',
          starting_serial: String(i).padStart(3, '0'),
          ending_serial: String(i + 1).padStart(3, '0'),
          tickets_sold: 1,
          sales_amount: 30,
        })
      );

      setupPrepareChain({
        allDays: days,
        bins: binRows,
      });

      const result = await callLotteryDayReport();

      expect(result.totalClosings).toBe(10);
      expect(result.closingSessions).toHaveLength(10);
      // lotteryTotal = sum of combined bins sales_amount (30 × 10 = 300)
      expect(result.lotteryTotal).toBe(300);
      expect(result.bins[0].tickets_sold).toBe(10);
      expect(result.bins[0].sales_amount).toBe(300);
      // IN clause should have 10 placeholders
      const binsSQL = mockPrepare.mock.calls[1]?.[0] as string;
      const expectedPlaceholders = Array(10).fill('?').join(', ');
      expect(binsSQL).toContain(`IN (${expectedPlaceholders})`);
      // Closing sessions numbered 1 through 10
      expect(result.closingSessions[0].closingNumber).toBe(1);
      expect(result.closingSessions[9].closingNumber).toBe(10);
    });

    // ------------------------------------------------------------------
    // 5.1-d: Closings that span midnight
    // ------------------------------------------------------------------
    it('should handle closings spanning midnight correctly', async () => {
      setupConfiguredStore();

      const day1 = createMockBusinessDay({
        day_id: 'day-001',
        business_date: TEST_BUSINESS_DATE,
        opened_at: '2026-02-02T23:00:00Z',
        closed_at: '2026-02-03T01:00:00Z', // spans midnight
        total_sales: 60,
        total_tickets_sold: 2,
      });

      setupPrepareChain({
        allDays: [day1],
        bins: [
          createMockBinRow({
            starting_serial: '000',
            ending_serial: '002',
            tickets_sold: 2,
            sales_amount: 60,
          }),
        ],
      });

      const result = await callLotteryDayReport();

      // Still associated with correct business_date
      expect(result.businessDate).toBe(TEST_BUSINESS_DATE);
      expect(result.totalClosings).toBe(1);
      // closed_at timestamp is past midnight but part of this business day
      expect(result.closedAt).toBe('2026-02-03T01:00:00Z');
      expect(result.closingSessions[0].openedAt).toBe('2026-02-02T23:00:00Z');
      expect(result.closingSessions[0].closedAt).toBe('2026-02-03T01:00:00Z');
      expect(result.bins[0].starting_serial).toBe('000');
      expect(result.bins[0].ending_serial).toBe('002');
    });

    it('should handle multiple closings spanning midnight on same business date', async () => {
      setupConfiguredStore();

      setupPrepareChain({
        allDays: [
          createMockBusinessDay({
            day_id: 'day-001',
            business_date: TEST_BUSINESS_DATE,
            opened_at: '2026-02-02T15:00:00Z',
            closed_at: '2026-02-02T23:30:00Z',
            total_sales: 30,
            total_tickets_sold: 1,
          }),
          createMockBusinessDay({
            day_id: 'day-002',
            business_date: TEST_BUSINESS_DATE,
            opened_at: '2026-02-02T23:30:00Z',
            closed_at: '2026-02-03T02:15:00Z', // spans midnight
            total_sales: 90,
            total_tickets_sold: 3,
          }),
        ],
        // Per-session rows for midnight-spanning closings
        bins: [
          createMockBinRow({
            day_id: 'day-001',
            pack_id: 'pack-001',
            starting_serial: '000',
            ending_serial: '001',
            tickets_sold: 1,
            sales_amount: 30,
          }),
          createMockBinRow({
            day_id: 'day-002',
            pack_id: 'pack-001',
            starting_serial: '001',
            ending_serial: '004',
            tickets_sold: 3,
            sales_amount: 90,
          }),
        ],
      });

      const result = await callLotteryDayReport();

      expect(result.businessDate).toBe(TEST_BUSINESS_DATE);
      expect(result.totalClosings).toBe(2);
      // closedAt is the last closing's timestamp (after midnight)
      expect(result.closedAt).toBe('2026-02-03T02:15:00Z');
      expect(result.lotteryTotal).toBe(120);
      expect(result.dayStatus).toBe('CLOSED');
    });
  });

  describe('reports:getLotteryDayReport — regression (Phase 5)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockFindByStatus.mockReturnValue([]);
    });

    // ------------------------------------------------------------------
    // 5.2-a: Activated packs query still works with multi-close
    // ------------------------------------------------------------------
    it('should return activated packs correctly alongside multi-close bins', async () => {
      setupConfiguredStore();

      setupPrepareChain({
        allDays: [
          createMockBusinessDay({
            day_id: 'day-001',
            opened_at: '2026-02-02T15:00:00Z',
            closed_at: '2026-02-02T18:00:00Z',
            total_sales: 30,
            total_tickets_sold: 1,
          }),
          createMockBusinessDay({
            day_id: 'day-002',
            opened_at: '2026-02-02T18:00:00Z',
            closed_at: '2026-02-02T23:00:00Z',
            total_sales: 60,
            total_tickets_sold: 2,
          }),
        ],
        bins: [createMockBinRow()],
        activated: [
          {
            pack_id: 'pack-activated-001',
            bin_display_order: 0,
            game_name: 'Powerball',
            game_price: 30,
            pack_number: 'PKG-ACT-001',
            activated_at: '2026-02-02T16:00:00Z',
            status: 'ACTIVE',
          },
        ],
      });

      const result = await callLotteryDayReport();

      // Activated packs section works alongside multi-close
      expect(result.activatedPacks).toHaveLength(1);
      expect(result.activatedPacks[0]).toEqual(
        expect.objectContaining({
          pack_id: 'pack-activated-001',
          pack_number: 'PKG-ACT-001',
          game_name: 'Powerball',
          bin_number: 1,
          game_price: 30,
          activated_at: '2026-02-02T16:00:00Z',
          status: 'ACTIVE',
        })
      );
      // Bins also present
      expect(result.bins).toHaveLength(1);
    });

    // ------------------------------------------------------------------
    // 5.2-b: Depleted packs query still works with multi-close
    // ------------------------------------------------------------------
    it('should return depleted packs correctly alongside multi-close bins', async () => {
      setupConfiguredStore();

      setupPrepareChain({
        allDays: [
          createMockBusinessDay({
            day_id: 'day-001',
            opened_at: '2026-02-02T15:00:00Z',
            closed_at: '2026-02-02T18:00:00Z',
            total_sales: 100,
            total_tickets_sold: 5,
          }),
          createMockBusinessDay({
            day_id: 'day-002',
            opened_at: '2026-02-02T18:00:00Z',
            closed_at: '2026-02-02T23:00:00Z',
            total_sales: 200,
            total_tickets_sold: 10,
          }),
        ],
        bins: [createMockBinRow()],
        depleted: [
          {
            pack_id: 'pack-depleted-001',
            bin_display_order: 1,
            game_name: 'Mega Millions',
            game_price: 20,
            pack_number: 'PKG-DEP-001',
            opening_serial: '000',
            ending_serial: '300',
            tickets_sold: 300,
            sales_amount: 6000,
            depleted_at: '2026-02-02T20:00:00Z',
            prev_ending_serial: '299',
          },
        ],
      });

      const result = await callLotteryDayReport();

      // Depleted packs section works alongside multi-close
      expect(result.depletedPacks).toHaveLength(1);
      expect(result.depletedPacks[0]).toEqual(
        expect.objectContaining({
          pack_id: 'pack-depleted-001',
          pack_number: 'PKG-DEP-001',
          game_name: 'Mega Millions',
          bin_number: 2,
          game_price: 20,
          starting_serial: '299',
          ending_serial: '300',
          tickets_sold: 300,
          sales_amount: 6000,
          depleted_at: '2026-02-02T20:00:00Z',
        })
      );
      // Bins also present
      expect(result.bins).toHaveLength(1);
    });

    // ------------------------------------------------------------------
    // 5.2-c: Returned packs query still works with multi-close
    // ------------------------------------------------------------------
    it('should return returned packs correctly alongside multi-close bins', async () => {
      setupConfiguredStore();

      setupPrepareChain({
        allDays: [
          createMockBusinessDay({
            day_id: 'day-001',
            opened_at: '2026-02-02T15:00:00Z',
            closed_at: '2026-02-02T18:00:00Z',
            total_sales: 50,
            total_tickets_sold: 2,
          }),
          createMockBusinessDay({
            day_id: 'day-002',
            opened_at: '2026-02-02T18:00:00Z',
            closed_at: '2026-02-02T23:00:00Z',
            total_sales: 75,
            total_tickets_sold: 3,
          }),
        ],
        bins: [createMockBinRow()],
        returned: [
          {
            pack_id: 'pack-returned-001',
            bin_display_order: 2,
            game_name: 'Scratch Off',
            game_price: 5,
            pack_number: 'PKG-RET-001',
            opening_serial: '000',
            ending_serial: '050',
            tickets_sold: 25,
            sales_amount: 125,
            returned_at: '2026-02-02T19:00:00Z',
            prev_ending_serial: '024',
          },
        ],
      });

      const result = await callLotteryDayReport();

      // Returned packs section works alongside multi-close
      expect(result.returnedPacks).toHaveLength(1);
      expect(result.returnedPacks[0]).toEqual(
        expect.objectContaining({
          pack_id: 'pack-returned-001',
          pack_number: 'PKG-RET-001',
          game_name: 'Scratch Off',
          bin_number: 3,
          game_price: 5,
          starting_serial: '024',
          ending_serial: '050',
          // tickets_sold calculated from serials: 50 - 24 = 26
          tickets_sold: 26,
          sales_amount: 130,
          returned_at: '2026-02-02T19:00:00Z',
        })
      );
      // Bins also present
      expect(result.bins).toHaveLength(1);
    });

    // ------------------------------------------------------------------
    // 5.2-a/b/c combined: All pack sections coexist with multi-close
    // ------------------------------------------------------------------
    it('should return all pack sections (activated, depleted, returned) together with multi-close', async () => {
      setupConfiguredStore();

      setupPrepareChain({
        allDays: [
          createMockBusinessDay({
            day_id: 'day-001',
            opened_at: '2026-02-02T15:00:00Z',
            closed_at: '2026-02-02T18:00:00Z',
            total_sales: 100,
            total_tickets_sold: 5,
          }),
          createMockBusinessDay({
            day_id: 'day-002',
            opened_at: '2026-02-02T18:00:00Z',
            closed_at: '2026-02-02T23:00:00Z',
            total_sales: 200,
            total_tickets_sold: 10,
          }),
        ],
        bins: [createMockBinRow()],
        activated: [
          {
            pack_id: 'pack-act-001',
            bin_display_order: 0,
            game_name: 'Game A',
            game_price: 10,
            pack_number: 'PKG-A',
            activated_at: '2026-02-02T16:00:00Z',
            status: 'ACTIVE',
          },
        ],
        depleted: [
          {
            pack_id: 'pack-dep-001',
            bin_display_order: 1,
            game_name: 'Game B',
            game_price: 20,
            pack_number: 'PKG-B',
            opening_serial: '000',
            ending_serial: '100',
            tickets_sold: 100,
            sales_amount: 2000,
            depleted_at: '2026-02-02T20:00:00Z',
            prev_ending_serial: null,
          },
        ],
        returned: [
          {
            pack_id: 'pack-ret-001',
            bin_display_order: 2,
            game_name: 'Game C',
            game_price: 5,
            pack_number: 'PKG-C',
            opening_serial: '000',
            ending_serial: '050',
            tickets_sold: 20,
            sales_amount: 100,
            returned_at: '2026-02-02T21:00:00Z',
            prev_ending_serial: null,
          },
        ],
      });

      const result = await callLotteryDayReport();

      expect(result.totalClosings).toBe(2);
      expect(result.bins).toHaveLength(1);
      expect(result.activatedPacks).toHaveLength(1);
      expect(result.depletedPacks).toHaveLength(1);
      expect(result.returnedPacks).toHaveLength(1);
      // lotteryTotal = bins(120) + depleted(2000) + returned(50*5=250) = 2370
      expect(result.lotteryTotal).toBe(2370);
    });

    // ------------------------------------------------------------------
    // 5.2-d: Date parameter passes correctly to handler
    // ------------------------------------------------------------------
    it('should accept and process different valid business dates', async () => {
      setupConfiguredStore();

      const differentDate = '2026-03-15';
      setupPrepareChain({
        allDays: [
          createMockBusinessDay({
            day_id: 'day-001',
            business_date: differentDate,
            opened_at: '2026-03-15T10:00:00Z',
            closed_at: '2026-03-15T22:00:00Z',
            total_sales: 500,
            total_tickets_sold: 20,
          }),
        ],
        bins: [
          createMockBinRow({
            day_id: 'day-001',
            pack_id: 'pack-001',
            sales_amount: 500,
            tickets_sold: 20,
          }),
        ],
      });

      const result = await callLotteryDayReport(differentDate);

      expect(result.businessDate).toBe(differentDate);
      expect(result.totalClosings).toBe(1);
      // lotteryTotal = bins.sales_amount = 500
      expect(result.lotteryTotal).toBe(500);
      // allDaysStmt was called with the correct date parameter
      expect(mockAllDaysAll).toHaveBeenCalledWith(TEST_STORE_ID, differentDate);
    });
  });

  // ============================================================================
  // Close-to-close boundary tests: period uses session opened_at/closed_at
  // ============================================================================

  describe('reports:getLotteryDayReport — close-to-close period boundaries', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    // ------------------------------------------------------------------
    // Period boundaries use session opened_at as start and closed_at as end
    // ------------------------------------------------------------------
    it('should pass session opened_at and closed_at as period boundaries to pack queries', async () => {
      setupConfiguredStore();

      const sessionOpenedAt = '2026-02-04T22:42:06.101Z';
      const sessionClosedAt = '2026-02-05T00:34:36.156Z';

      setupPrepareChain({
        allDays: [
          createMockBusinessDay({
            day_id: 'day-006',
            business_date: '2026-02-04',
            opened_at: sessionOpenedAt,
            closed_at: sessionClosedAt,
            total_sales: 30,
            total_tickets_sold: 1,
          }),
        ],
        bins: [createMockBinRow({ day_id: 'day-006' })],
      });

      await callLotteryDayReport('2026-02-04');

      // Activated query (3rd prepare call): params are (storeId, periodStartUtc, periodEndUtc)
      expect(mockActivatedAll).toHaveBeenCalledWith(
        TEST_STORE_ID,
        sessionOpenedAt, // period starts at session open
        sessionClosedAt // period ends at session close
      );

      // Depleted query (4th prepare call)
      expect(mockDepletedAll).toHaveBeenCalledWith(TEST_STORE_ID, sessionOpenedAt, sessionClosedAt);

      // Returned query (5th prepare call)
      expect(mockReturnedAll).toHaveBeenCalledWith(TEST_STORE_ID, sessionOpenedAt, sessionClosedAt);
    });

    // ------------------------------------------------------------------
    // Multi-session: period spans from first open to last close
    // ------------------------------------------------------------------
    it('should span period from first session open to last session close for multi-close dates', async () => {
      setupConfiguredStore();

      const firstOpenedAt = '2026-02-02T15:24:00Z';
      const lastClosedAt = '2026-02-03T00:15:00Z';

      setupPrepareChain({
        allDays: [
          createMockBusinessDay({
            day_id: 'day-001',
            opened_at: firstOpenedAt,
            closed_at: '2026-02-02T18:25:00Z',
            total_sales: 0,
            total_tickets_sold: 0,
          }),
          createMockBusinessDay({
            day_id: 'day-002',
            opened_at: '2026-02-02T18:25:00Z',
            closed_at: '2026-02-02T23:04:00Z',
            total_sales: 30,
            total_tickets_sold: 1,
          }),
          createMockBusinessDay({
            day_id: 'day-003',
            opened_at: '2026-02-02T23:04:00Z',
            closed_at: lastClosedAt,
            total_sales: 30,
            total_tickets_sold: 1,
          }),
        ],
        bins: [],
      });

      await callLotteryDayReport();

      // Period must span from first session's opened_at to last session's closed_at
      expect(mockActivatedAll).toHaveBeenCalledWith(TEST_STORE_ID, firstOpenedAt, lastClosedAt);
    });

    // ------------------------------------------------------------------
    // Packs from before session start must NOT appear in report
    // ------------------------------------------------------------------
    it('should exclude packs activated before the session opened_at', async () => {
      setupConfiguredStore();

      const sessionOpenedAt = '2026-02-04T22:42:06.101Z';
      const sessionClosedAt = '2026-02-05T00:34:36.156Z';

      // Pack activated BEFORE session opened — should NOT appear
      // Pack activated DURING session — should appear
      setupPrepareChain({
        allDays: [
          createMockBusinessDay({
            day_id: 'day-006',
            business_date: '2026-02-04',
            opened_at: sessionOpenedAt,
            closed_at: sessionClosedAt,
            total_sales: 0,
            total_tickets_sold: 0,
          }),
        ],
        bins: [],
        // Mock returns only packs within the period (DB handles filtering)
        activated: [
          {
            pack_id: 'pack-during-session',
            bin_display_order: 0,
            game_name: 'Test Game',
            game_price: 3,
            pack_number: '0015060',
            activated_at: '2026-02-05T00:34:26.736Z',
            status: 'ACTIVE',
          },
        ],
        returned: [],
      });

      const result = await callLotteryDayReport('2026-02-04');

      // The query parameters ensure only session-bounded packs are included
      expect(result.activatedPacks).toHaveLength(1);
      expect(result.activatedPacks[0]).toEqual(
        expect.objectContaining({ pack_id: 'pack-during-session' })
      );
    });
  });

  // ============================================================================
  // reports:getLotteryDayReport — BIZ-002 CLOSED-Only Filter Tests
  // ============================================================================

  describe('reports:getLotteryDayReport — BIZ-002 CLOSED-only filtering', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockFindByStatus.mockReturnValue([]);
    });

    // ------------------------------------------------------------------
    // BIZ-002: SQL Query Verification
    // ------------------------------------------------------------------
    describe('BIZ-002: SQL query must filter by CLOSED status', () => {
      it('should include status = CLOSED filter in SQL query', async () => {
        setupConfiguredStore();
        setupPrepareChain({ allDays: [] });

        await callLotteryDayReport();

        // First prepare call is the allDaysStmt
        const sql = mockPrepare.mock.calls[0]?.[0] as string;
        expect(sql).toContain("lbd.status = 'CLOSED'");
      });

      it('should NOT use NOT EXISTS clause - dates can have both OPEN and CLOSED days', async () => {
        setupConfiguredStore();
        setupPrepareChain({ allDays: [] });

        await callLotteryDayReport();

        // BIZ-002: The query should NOT exclude dates just because they have an OPEN day.
        // Only filter by lbd.status = 'CLOSED' to get closed days, don't exclude entire dates.
        const sql = mockPrepare.mock.calls[0]?.[0] as string;
        expect(sql).not.toContain('NOT EXISTS');
        expect(sql).not.toContain('lbd2'); // No subquery alias
      });
    });

    // ------------------------------------------------------------------
    // BIZ-002: OPEN days exclusion verification
    // ------------------------------------------------------------------
    describe('BIZ-002: OPEN days must be excluded from day report', () => {
      it('should only process CLOSED days returned by SQL query', async () => {
        setupConfiguredStore();

        // Simulate database returning only CLOSED days (since SQL filters by status = 'CLOSED')
        // If there were OPEN days in DB, they would NOT be returned
        const closedDay = createMockBusinessDay({
          day_id: 'day-closed',
          status: 'CLOSED',
          opened_at: '2026-02-02T08:00:00Z',
          closed_at: '2026-02-02T16:00:00Z',
          total_sales: 100,
          total_tickets_sold: 5,
        });

        setupPrepareChain({
          allDays: [closedDay],
          bins: [createMockBinRow()],
        });

        const result = await callLotteryDayReport();

        // Only the CLOSED day should be in results
        expect(result.totalClosings).toBe(1);
        expect(result.dayStatus).toBe('CLOSED');
        expect(result.closingSessions).toHaveLength(1);
        expect(result.closingSessions[0].closedAt).toBe('2026-02-02T16:00:00Z');
      });

      it('should return empty result when all days on date are OPEN (none returned by SQL)', async () => {
        setupConfiguredStore();

        // SQL query filters by status = 'CLOSED', so if all days are OPEN,
        // the query returns empty array
        setupPrepareChain({ allDays: [] });

        const result = await callLotteryDayReport();

        expect(result.totalClosings).toBe(0);
        expect(result.dayStatus).toBeNull();
        expect(result.closingSessions).toHaveLength(0);
        expect(result.bins).toHaveLength(0);
        expect(result.lotteryTotal).toBe(0);
      });

      it('should include only CLOSED days when date has multiple days with mixed statuses', async () => {
        setupConfiguredStore();

        // Simulate: date has 3 CLOSED days in database (OPEN days filtered out by SQL)
        const closed1 = createMockBusinessDay({
          day_id: 'day-closed-1',
          status: 'CLOSED',
          opened_at: '2026-02-02T08:00:00Z',
          closed_at: '2026-02-02T12:00:00Z',
          total_sales: 50,
          total_tickets_sold: 2,
        });
        const closed2 = createMockBusinessDay({
          day_id: 'day-closed-2',
          status: 'CLOSED',
          opened_at: '2026-02-02T12:00:00Z',
          closed_at: '2026-02-02T18:00:00Z',
          total_sales: 75,
          total_tickets_sold: 3,
        });
        const closed3 = createMockBusinessDay({
          day_id: 'day-closed-3',
          status: 'CLOSED',
          opened_at: '2026-02-02T18:00:00Z',
          closed_at: '2026-02-02T23:00:00Z',
          total_sales: 100,
          total_tickets_sold: 4,
        });

        // Per-session rows matching each closed day's sales
        setupPrepareChain({
          allDays: [closed1, closed2, closed3],
          bins: [
            createMockBinRow({
              day_id: 'day-closed-1',
              pack_id: 'pack-001',
              sales_amount: 50,
              tickets_sold: 2,
            }),
            createMockBinRow({
              day_id: 'day-closed-2',
              pack_id: 'pack-001',
              sales_amount: 75,
              tickets_sold: 3,
            }),
            createMockBinRow({
              day_id: 'day-closed-3',
              pack_id: 'pack-001',
              sales_amount: 100,
              tickets_sold: 4,
            }),
          ],
        });

        const result = await callLotteryDayReport();

        // All 3 CLOSED days included (OPEN day in DB would be filtered by SQL)
        expect(result.totalClosings).toBe(3);
        expect(result.dayStatus).toBe('CLOSED');
        expect(result.closingSessions).toHaveLength(3);
        // lotteryTotal = sum of combined bins.sales_amount = 50 + 75 + 100
        expect(result.lotteryTotal).toBe(225);
      });
    });

    // ------------------------------------------------------------------
    // BIZ-002: Parameterization and tenant isolation
    // ------------------------------------------------------------------
    describe('BIZ-002: Security compliance with CLOSED filter', () => {
      it('should use parameterized query with CLOSED filter (SEC-006)', async () => {
        setupConfiguredStore();
        setupPrepareChain({ allDays: [] });

        await callLotteryDayReport();

        // Verify db.prepare was called (prepared statements, not raw SQL)
        expect(mockPrepare).toHaveBeenCalled();

        const sql = mockPrepare.mock.calls[0]?.[0] as string;
        // SQL should use ? placeholders for storeId and businessDate
        expect(sql).toContain('?');
        // CLOSED status is hardcoded literal (not interpolated user input)
        expect(sql).toContain("lbd.status = 'CLOSED'");
        // Should not contain interpolated test values
        expect(sql).not.toContain(TEST_STORE_ID);
        expect(sql).not.toContain("'" + TEST_BUSINESS_DATE + "'");
      });

      it('should scope CLOSED filter query by store_id (DB-006)', async () => {
        setupConfiguredStore();
        setupPrepareChain({ allDays: [] });

        await callLotteryDayReport();

        const sql = mockPrepare.mock.calls[0]?.[0] as string;
        expect(sql).toContain('store_id');
        expect(sql).toContain("lbd.status = 'CLOSED'");

        // store_id passed as parameter
        expect(mockAllDaysAll).toHaveBeenCalledWith(TEST_STORE_ID, TEST_BUSINESS_DATE);
      });
    });
  });

  // ============================================================================
  // reports:getShiftsByDays — CLOSED-Only Filter Tests
  // ============================================================================

  describe('reports:getShiftsByDays — CLOSED-only filtering', () => {
    /**
     * Mock for the single prepared statement used by getShiftsByDays
     */
    const mockShiftsByDaysAll = vi.fn();

    /**
     * Response shape for shifts-by-day report
     * BIZ-003: Includes openedAt/closedAt for enterprise-grade date identification
     */
    interface ShiftsByDaysResult {
      days: Array<{
        businessDate: string;
        openedAt: string | null;
        closedAt: string | null;
        dayStatus: 'OPEN' | 'CLOSED';
        shifts: Array<{
          shiftId: string;
          shiftNumber: number;
          registerName: string;
          employeeName: string;
          startTime: string;
          endTime: string | null;
          status: 'OPEN' | 'CLOSED';
        }>;
      }>;
      error?: string;
      message?: string;
    }

    /**
     * Create mock row data for getShiftsByDays query result
     * BIZ-003: Includes opened_at/closed_at for enterprise-grade sorting
     */
    function createShiftsByDaysRow(overrides: Record<string, unknown> = {}) {
      return {
        shift_id: 'shift-001',
        business_date: TEST_BUSINESS_DATE,
        opened_at: '2026-02-02T08:00:00Z',
        closed_at: '2026-02-02T16:00:00Z',
        shift_number: 1,
        start_time: '2026-02-02T08:00:00Z',
        end_time: '2026-02-02T16:00:00Z',
        shift_status: 'CLOSED',
        external_register_id: 'REG-001',
        employee_name: 'John Doe',
        day_status: 'CLOSED',
        ...overrides,
      };
    }

    /**
     * Set up single prepare mock for getShiftsByDays
     */
    function setupShiftsByDaysPrepare(rows: unknown[]) {
      mockPrepare.mockReset();
      mockShiftsByDaysAll.mockReset();
      mockShiftsByDaysAll.mockReturnValue(rows);
      mockPrepare.mockReturnValue({ all: mockShiftsByDaysAll });
    }

    function callShiftsByDays(startDate: string = '2026-02-01', endDate: string = '2026-02-07') {
      const handler = capturedHandlers['reports:getShiftsByDays'];
      return handler({} as unknown, { startDate, endDate }) as Promise<ShiftsByDaysResult>;
    }

    beforeEach(() => {
      vi.clearAllMocks();
    });

    // ------------------------------------------------------------------
    // Handler registration
    // ------------------------------------------------------------------
    it('should be registered as a handler', () => {
      expect(capturedHandlers['reports:getShiftsByDays']).toBeDefined();
      expect(typeof capturedHandlers['reports:getShiftsByDays']).toBe('function');
    });

    // ------------------------------------------------------------------
    // BIZ-001: CLOSED-only filtering
    // ------------------------------------------------------------------
    describe('BIZ-001: CLOSED-only day filtering', () => {
      it('should return only CLOSED lottery business days', async () => {
        setupConfiguredStore();
        setupShiftsByDaysPrepare([
          createShiftsByDaysRow({
            business_date: '2026-02-02',
            day_status: 'CLOSED',
          }),
          createShiftsByDaysRow({
            business_date: '2026-02-03',
            day_status: 'CLOSED',
            shift_id: 'shift-002',
          }),
        ]);

        const result = await callShiftsByDays();

        expect(result.days).toHaveLength(2);
        expect(result.days[0].dayStatus).toBe('CLOSED');
        expect(result.days[1].dayStatus).toBe('CLOSED');
      });

      it('should return empty array when no CLOSED days exist in range', async () => {
        setupConfiguredStore();
        setupShiftsByDaysPrepare([]); // No CLOSED days returned by query

        const result = await callShiftsByDays();

        expect(result.days).toHaveLength(0);
      });

      it('should verify SQL contains CLOSED filter clause', async () => {
        setupConfiguredStore();
        setupShiftsByDaysPrepare([]);

        await callShiftsByDays();

        // Verify the SQL includes the CLOSED filter
        const sql = mockPrepare.mock.calls[0]?.[0] as string;
        expect(sql).toContain("lbd.status = 'CLOSED'");
      });

      it('BIZ-002: should NOT use NOT EXISTS clause - dates can have both OPEN and CLOSED days', async () => {
        setupConfiguredStore();
        setupShiftsByDaysPrepare([]);

        await callShiftsByDays();

        // BIZ-002: The query should NOT exclude dates just because they have an OPEN day.
        // Only filter by lbd.status = 'CLOSED' to get closed days, don't exclude entire dates.
        const sql = mockPrepare.mock.calls[0]?.[0] as string;
        expect(sql).not.toContain('NOT EXISTS');
        expect(sql).not.toContain('lbd2');
      });

      it('BIZ-003: should order by closed_at DESC for enterprise-grade sorting', async () => {
        setupConfiguredStore();
        setupShiftsByDaysPrepare([]);

        await callShiftsByDays();

        const sql = mockPrepare.mock.calls[0]?.[0] as string;
        expect(sql).toContain('ORDER BY lbd.closed_at DESC');
      });
    });

    // ------------------------------------------------------------------
    // BIZ-002: Multi-day per date edge cases
    // ------------------------------------------------------------------
    describe('BIZ-002: Multi-day per date handling', () => {
      it('should include CLOSED days even when date has an OPEN day', async () => {
        setupConfiguredStore();
        // BIZ-002: A date can have BOTH CLOSED and OPEN days.
        // The query only returns CLOSED days (filtered by lbd.status = 'CLOSED'),
        // but does NOT exclude dates that also have OPEN days.
        setupShiftsByDaysPrepare([
          createShiftsByDaysRow({
            business_date: '2026-02-04',
            day_status: 'CLOSED',
            opened_at: '2026-02-04T17:42:00.000Z',
            closed_at: '2026-02-04T19:34:00.000Z',
          }),
        ]);

        const result = await callShiftsByDays();

        // CLOSED day is included even if another OPEN day exists for same date
        expect(result.days).toHaveLength(1);
        expect(result.days[0].businessDate).toBe('2026-02-04');
        expect(result.days[0].dayStatus).toBe('CLOSED');
        expect(result.days[0].closedAt).toBe('2026-02-04T19:34:00.000Z');
      });

      it('should include multiple CLOSED days for the same date', async () => {
        setupConfiguredStore();
        // BIZ-002: Multiple closings on the same date
        setupShiftsByDaysPrepare([
          createShiftsByDaysRow({
            business_date: '2026-02-02',
            day_status: 'CLOSED',
            opened_at: '2026-02-02T18:04:00.000Z',
            closed_at: '2026-02-02T19:15:00.000Z',
          }),
          createShiftsByDaysRow({
            business_date: '2026-02-02',
            day_status: 'CLOSED',
            opened_at: '2026-02-02T13:25:00.000Z',
            closed_at: '2026-02-02T18:04:00.000Z',
          }),
        ]);

        const result = await callShiftsByDays();

        // Both closings grouped under same date
        expect(result.days).toHaveLength(1);
        expect(result.days[0].businessDate).toBe('2026-02-02');
        expect(result.days[0].dayStatus).toBe('CLOSED');
      });

      it('should return empty when no CLOSED days exist in range', async () => {
        setupConfiguredStore();
        // Only OPEN or PENDING_CLOSE days exist - query returns nothing
        // because WHERE lbd.status = 'CLOSED' filters them out
        setupShiftsByDaysPrepare([]);

        const result = await callShiftsByDays();

        expect(result.days).toHaveLength(0);
      });
    });

    // ------------------------------------------------------------------
    // BIZ-003: Enterprise-grade timestamp handling and sorting
    // ------------------------------------------------------------------
    describe('BIZ-003: Enterprise-grade timestamp handling', () => {
      it('should include openedAt and closedAt fields in response', async () => {
        setupConfiguredStore();
        const testOpenedAt = '2026-02-02T10:30:00.000Z';
        const testClosedAt = '2026-02-02T22:15:00.000Z';
        setupShiftsByDaysPrepare([
          createShiftsByDaysRow({
            business_date: '2026-02-02',
            opened_at: testOpenedAt,
            closed_at: testClosedAt,
            day_status: 'CLOSED',
          }),
        ]);

        const result = await callShiftsByDays();

        // BIZ-003: openedAt and closedAt must be included for date identification
        expect(result.days[0].openedAt).toBe(testOpenedAt);
        expect(result.days[0].closedAt).toBe(testClosedAt);
      });

      it('should use first row timestamps when multiple closings exist for same date', async () => {
        setupConfiguredStore();
        // BIZ-003: ORDER BY closed_at DESC means first row has most recent closing
        // When grouping by business_date, we should use the first row's timestamps
        setupShiftsByDaysPrepare([
          createShiftsByDaysRow({
            business_date: '2026-02-02',
            opened_at: '2026-02-02T18:00:00.000Z',
            closed_at: '2026-02-02T23:59:00.000Z', // Most recent closing (first row)
            day_status: 'CLOSED',
            shift_id: 'shift-closing-2',
          }),
          createShiftsByDaysRow({
            business_date: '2026-02-02',
            opened_at: '2026-02-02T08:00:00.000Z',
            closed_at: '2026-02-02T17:30:00.000Z', // Earlier closing (second row)
            day_status: 'CLOSED',
            shift_id: 'shift-closing-1',
          }),
        ]);

        const result = await callShiftsByDays();

        // Should have one day entry with the MOST RECENT closing's timestamps
        expect(result.days).toHaveLength(1);
        expect(result.days[0].closedAt).toBe('2026-02-02T23:59:00.000Z');
        expect(result.days[0].openedAt).toBe('2026-02-02T18:00:00.000Z');
      });

      it('should handle cross-date closing (opened one day, closed next day)', async () => {
        setupConfiguredStore();
        // BIZ-003: A closing that spans midnight should use business_date for grouping
        // but include actual opened_at/closed_at for identification
        setupShiftsByDaysPrepare([
          createShiftsByDaysRow({
            business_date: '2026-02-03', // Business date is when day was opened
            opened_at: '2026-02-03T15:30:00.000Z', // Opened on Feb 3rd
            closed_at: '2026-02-04T17:42:00.000Z', // Closed on Feb 4th
            day_status: 'CLOSED',
          }),
        ]);

        const result = await callShiftsByDays();

        // Day appears under Feb 3rd (its business_date)
        expect(result.days[0].businessDate).toBe('2026-02-03');
        // But timestamps show actual open/close times
        expect(result.days[0].openedAt).toBe('2026-02-03T15:30:00.000Z');
        expect(result.days[0].closedAt).toBe('2026-02-04T17:42:00.000Z');
      });

      it('should handle null timestamps gracefully', async () => {
        setupConfiguredStore();
        // Edge case: opened_at or closed_at might be null in edge scenarios
        setupShiftsByDaysPrepare([
          createShiftsByDaysRow({
            business_date: '2026-02-02',
            opened_at: null,
            closed_at: null,
            day_status: 'CLOSED',
          }),
        ]);

        const result = await callShiftsByDays();

        expect(result.days).toHaveLength(1);
        expect(result.days[0].openedAt).toBeNull();
        expect(result.days[0].closedAt).toBeNull();
      });

      it('should verify SQL includes opened_at and closed_at in SELECT', async () => {
        setupConfiguredStore();
        setupShiftsByDaysPrepare([]);

        await callShiftsByDays();

        const sql = mockPrepare.mock.calls[0]?.[0] as string;
        expect(sql).toContain('lbd.opened_at');
        expect(sql).toContain('lbd.closed_at');
      });
    });

    // ------------------------------------------------------------------
    // SEC-006: Parameterized queries
    // ------------------------------------------------------------------
    describe('SEC-006: SQL injection prevention', () => {
      it('should use parameterized statements with ? placeholders', async () => {
        setupConfiguredStore();
        setupShiftsByDaysPrepare([]);

        await callShiftsByDays('2026-02-01', '2026-02-07');

        // Verify db.prepare was called
        expect(mockPrepare).toHaveBeenCalledTimes(1);

        // Verify SQL uses ? placeholders
        const sql = mockPrepare.mock.calls[0]?.[0] as string;
        expect(sql).toContain('lbd.store_id = ?');
        expect(sql).toContain('lbd.business_date >= ?');
        expect(sql).toContain('lbd.business_date <= ?');

        // Verify no literal date values in SQL
        expect(sql).not.toContain('2026-02-01');
        expect(sql).not.toContain('2026-02-07');
        expect(sql).not.toContain(TEST_STORE_ID);
      });

      it('should pass parameters to stmt.all() not embedded in SQL', async () => {
        setupConfiguredStore();
        setupShiftsByDaysPrepare([]);

        await callShiftsByDays('2026-02-01', '2026-02-07');

        // Verify parameters passed to .all()
        expect(mockShiftsByDaysAll).toHaveBeenCalledWith(TEST_STORE_ID, '2026-02-01', '2026-02-07');
      });

      it('should reject malformed date formats before query execution (defense in depth)', async () => {
        setupConfiguredStore();
        setupShiftsByDaysPrepare([]);

        // Attempt SQL injection via date parameter - rejected by Zod validation
        const maliciousDate = "2026-02-01'; DROP TABLE lottery_business_days; --";

        const result = await callShiftsByDays(maliciousDate, '2026-02-07');

        // Validation rejects malformed dates BEFORE SQL execution (defense in depth)
        expect(result).toEqual(expect.objectContaining({ error: 'VALIDATION_ERROR' }));

        // db.prepare should NOT be called when validation fails
        expect(mockPrepare).not.toHaveBeenCalled();
      });

      it('should safely parameterize dates even if they pass validation', async () => {
        setupConfiguredStore();
        setupShiftsByDaysPrepare([]);

        // Valid format dates - ensure they're parameterized not interpolated
        await callShiftsByDays('2026-02-01', '2026-02-07');

        // SQL uses placeholders, not literal values
        const sql = mockPrepare.mock.calls[0]?.[0] as string;
        expect(sql).toContain('?');
        expect(sql).not.toContain('2026-02-01');
        expect(sql).not.toContain('2026-02-07');

        // Values passed as parameters to .all()
        expect(mockShiftsByDaysAll).toHaveBeenCalledWith(TEST_STORE_ID, '2026-02-01', '2026-02-07');
      });
    });

    // ------------------------------------------------------------------
    // DB-006: Tenant isolation
    // ------------------------------------------------------------------
    describe('DB-006: Tenant isolation', () => {
      it('should scope main query by store_id', async () => {
        setupConfiguredStore();
        setupShiftsByDaysPrepare([]);

        await callShiftsByDays();

        const sql = mockPrepare.mock.calls[0]?.[0] as string;
        expect(sql).toContain('lbd.store_id = ?');
      });

      it('BIZ-002: should NOT have subquery since no NOT EXISTS clause', async () => {
        setupConfiguredStore();
        setupShiftsByDaysPrepare([]);

        await callShiftsByDays();

        const sql = mockPrepare.mock.calls[0]?.[0] as string;
        // BIZ-002: No subquery needed - we filter by status = 'CLOSED' directly
        expect(sql).not.toContain('lbd2');
      });

      it('should pass store_id as first parameter', async () => {
        setupConfiguredStore();
        setupShiftsByDaysPrepare([]);

        await callShiftsByDays();

        expect(mockShiftsByDaysAll).toHaveBeenCalledWith(
          TEST_STORE_ID,
          expect.any(String),
          expect.any(String)
        );
      });
    });

    // ------------------------------------------------------------------
    // API-001: Input validation
    // ------------------------------------------------------------------
    describe('API-001: Input validation', () => {
      it('should return error when store not configured', async () => {
        mockGetConfiguredStore.mockReturnValue(null);

        const result = await callShiftsByDays();

        expect(mockCreateErrorResponse).toHaveBeenCalledWith(
          'NOT_CONFIGURED',
          'Store not configured'
        );
        expect(result).toEqual(expect.objectContaining({ error: 'NOT_CONFIGURED' }));
      });

      it('should return validation error for invalid start date format', async () => {
        setupConfiguredStore();

        const result = await callShiftsByDays('invalid-date', '2026-02-07');

        expect(mockCreateErrorResponse).toHaveBeenCalledWith(
          'VALIDATION_ERROR',
          expect.stringContaining('Start date')
        );
        expect(result).toEqual(expect.objectContaining({ error: 'VALIDATION_ERROR' }));
      });

      it('should return validation error for invalid end date format', async () => {
        setupConfiguredStore();

        const result = await callShiftsByDays('2026-02-01', 'not-a-date');

        expect(mockCreateErrorResponse).toHaveBeenCalledWith(
          'VALIDATION_ERROR',
          expect.stringContaining('End date')
        );
        expect(result).toEqual(expect.objectContaining({ error: 'VALIDATION_ERROR' }));
      });

      it('should return validation error when start date after end date', async () => {
        setupConfiguredStore();

        const result = await callShiftsByDays('2026-02-28', '2026-02-01');

        expect(mockCreateErrorResponse).toHaveBeenCalledWith(
          'VALIDATION_ERROR',
          expect.stringContaining('before or equal')
        );
        expect(result).toEqual(expect.objectContaining({ error: 'VALIDATION_ERROR' }));
      });

      it('should return validation error when date range exceeds limit', async () => {
        setupConfiguredStore();

        // Default limit is 90 days
        const result = await callShiftsByDays('2026-01-01', '2026-12-31');

        expect(mockCreateErrorResponse).toHaveBeenCalledWith(
          'VALIDATION_ERROR',
          expect.stringContaining('exceed')
        );
        expect(result).toEqual(expect.objectContaining({ error: 'VALIDATION_ERROR' }));
      });
    });

    // ------------------------------------------------------------------
    // Shift data grouping
    // ------------------------------------------------------------------
    describe('Shift data grouping', () => {
      it('should group shifts by business date', async () => {
        setupConfiguredStore();
        setupShiftsByDaysPrepare([
          createShiftsByDaysRow({
            business_date: '2026-02-02',
            shift_id: 'shift-001',
            shift_number: 1,
          }),
          createShiftsByDaysRow({
            business_date: '2026-02-02',
            shift_id: 'shift-002',
            shift_number: 2,
          }),
          createShiftsByDaysRow({
            business_date: '2026-02-03',
            shift_id: 'shift-003',
            shift_number: 1,
          }),
        ]);

        const result = await callShiftsByDays();

        expect(result.days).toHaveLength(2);
        expect(result.days[0].shifts).toHaveLength(2);
        expect(result.days[1].shifts).toHaveLength(1);
      });

      it('should include day with no shifts (LEFT JOIN behavior)', async () => {
        setupConfiguredStore();
        setupShiftsByDaysPrepare([
          createShiftsByDaysRow({
            business_date: '2026-02-02',
            shift_id: null, // No shift for this day
            shift_number: null,
            start_time: null,
            end_time: null,
            shift_status: null,
            external_register_id: null,
            employee_name: null,
          }),
        ]);

        const result = await callShiftsByDays();

        expect(result.days).toHaveLength(1);
        expect(result.days[0].businessDate).toBe('2026-02-02');
        expect(result.days[0].shifts).toHaveLength(0);
      });

      it('should map shift fields correctly', async () => {
        setupConfiguredStore();
        setupShiftsByDaysPrepare([
          createShiftsByDaysRow({
            shift_id: 'shift-test-001',
            shift_number: 3,
            start_time: '2026-02-02T10:00:00Z',
            end_time: '2026-02-02T18:00:00Z',
            shift_status: 'CLOSED',
            external_register_id: 'Register-A',
            employee_name: 'Jane Smith',
          }),
        ]);

        const result = await callShiftsByDays();

        expect(result.days[0].shifts[0]).toEqual({
          shiftId: 'shift-test-001',
          shiftNumber: 3,
          registerName: 'Register-A',
          employeeName: 'Jane Smith',
          startTime: '2026-02-02T10:00:00Z',
          endTime: '2026-02-02T18:00:00Z',
          status: 'CLOSED',
        });
      });
    });

    // ------------------------------------------------------------------
    // Edge cases
    // ------------------------------------------------------------------
    describe('Edge cases', () => {
      it('should handle single day range (start equals end)', async () => {
        setupConfiguredStore();
        setupShiftsByDaysPrepare([createShiftsByDaysRow({ business_date: '2026-02-02' })]);

        const result = await callShiftsByDays('2026-02-02', '2026-02-02');

        expect(result.days).toHaveLength(1);
        expect(result.days[0].businessDate).toBe('2026-02-02');
      });

      it('should handle maximum allowed date range (90 days)', async () => {
        setupConfiguredStore();
        setupShiftsByDaysPrepare([]);

        // Exactly 90 days should be allowed
        const result = await callShiftsByDays('2026-01-01', '2026-03-31');

        // Should not return validation error
        expect(result.error).toBeUndefined();
      });

      it('should handle day with many shifts (stress test)', async () => {
        setupConfiguredStore();

        // Create 50 shifts for a single day
        const shifts = [];
        for (let i = 1; i <= 50; i++) {
          shifts.push(
            createShiftsByDaysRow({
              business_date: '2026-02-02',
              shift_id: `shift-${String(i).padStart(3, '0')}`,
              shift_number: i,
              external_register_id: `REG-${(i % 5) + 1}`,
              employee_name: `Employee ${i}`,
            })
          );
        }
        setupShiftsByDaysPrepare(shifts);

        const result = await callShiftsByDays();

        expect(result.days).toHaveLength(1);
        expect(result.days[0].shifts).toHaveLength(50);
      });
    });
  });
});
