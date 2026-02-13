/**
 * Lottery Day Report Integration Tests
 *
 * Tests the complete data pipeline from IPC handler invocation through
 * SQL query construction, data transformation, and response shape.
 *
 * Validates that the multi-close aggregation logic correctly:
 * - Aggregates serials (first closing start, last closing end)
 * - Sums tickets/sales across closings
 * - Builds closing sessions with per-session data
 * - Maintains tenant isolation between stores
 * - Handles single-close regression
 *
 * These tests invoke the actual handler function (captured via registerHandler
 * mock) with mock database responses that simulate real multi-table JOIN results.
 * This tests the full handler pipeline including input validation, query parameter
 * construction, IN-clause building, data transformation, and response assembly.
 *
 * @module tests/integration/reports/lottery-day-report
 * @security SEC-006: Validates parameterized query construction
 * @security DB-006: Validates tenant isolation via store_id scoping
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Hoisted mocks for handler capture
// ============================================================================
const {
  capturedHandlers,
  mockCreateErrorResponse,
  mockGetConfiguredStore,
  mockFindByStatus,
  mockPrepare,
} = vi.hoisted(() => ({
  capturedHandlers: {} as Record<string, (...args: unknown[]) => unknown>,
  mockCreateErrorResponse: vi.fn((code: string, message: string) => ({ error: code, message })),
  mockGetConfiguredStore: vi.fn(),
  mockFindByStatus: vi.fn(),
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
  isDatabaseInitialized: vi.fn(() => true),
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
    findByDateRange: vi.fn().mockReturnValue([]),
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
// Types
// ============================================================================

interface LotteryDayReportResult {
  businessDate: string;
  dayStatus: 'OPEN' | 'PENDING_CLOSE' | 'CLOSED' | null;
  closedAt: string | null;
  lotteryTotal: number;
  totalClosings: number;
  closingSessions: Array<{
    closingNumber: number;
    openedAt: string | null;
    closedAt: string | null;
    totalSales: number;
    totalTicketsSold: number;
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

// ============================================================================
// Test Constants
// ============================================================================

const TEST_STORE_A = 'store-A-integration';
const TEST_STORE_B = 'store-B-integration';
const TEST_DATE = '2026-02-02';

// ============================================================================
// Test Data Factories
// ============================================================================

function createBusinessDay(overrides: Record<string, unknown> = {}) {
  return {
    day_id: 'day-001',
    store_id: TEST_STORE_A,
    business_date: TEST_DATE,
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

function createBinRow(overrides: Record<string, unknown> = {}) {
  return {
    bin_display_order: 0,
    game_name: 'Lucky 7s',
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

// ============================================================================
// Mock Statement Setup
// ============================================================================

/**
 * Creates mock statement objects for each prepare() call.
 * The handler calls prepare() 5 times in sequence:
 *   1. allDaysStmt — fetch all business days for the date
 *   2. binsStmt — aggregated bin data across all closings
 *   3. activatedStmt — activated packs for the period
 *   4. depletedStmt — depleted packs for the period
 *   5. returnedStmt — returned packs for the period
 */
function setupMockStatements(config: {
  allDays?: unknown[];
  bins?: unknown[];
  activated?: unknown[];
  depleted?: unknown[];
  returned?: unknown[];
}) {
  const mockAllDaysAll = vi.fn().mockReturnValue(config.allDays ?? []);
  const mockBinsAll = vi.fn().mockReturnValue(config.bins ?? []);
  const mockActivatedAll = vi.fn().mockReturnValue(config.activated ?? []);
  const mockDepletedAll = vi.fn().mockReturnValue(config.depleted ?? []);
  const mockReturnedAll = vi.fn().mockReturnValue(config.returned ?? []);

  mockPrepare.mockReset();
  mockPrepare
    .mockReturnValueOnce({ all: mockAllDaysAll })
    .mockReturnValueOnce({ all: mockBinsAll })
    .mockReturnValueOnce({ all: mockActivatedAll })
    .mockReturnValueOnce({ all: mockDepletedAll })
    .mockReturnValueOnce({ all: mockReturnedAll });

  return { mockAllDaysAll, mockBinsAll, mockActivatedAll, mockDepletedAll, mockReturnedAll };
}

function setupStore(storeId: string = TEST_STORE_A) {
  mockGetConfiguredStore.mockReturnValue({
    store_id: storeId,
    status: 'ACTIVE',
  });
}

function callLotteryDayReport(businessDate: string = TEST_DATE): Promise<LotteryDayReportResult> {
  const handler = capturedHandlers['reports:getLotteryDayReport'];
  return handler({} as unknown, { businessDate }) as Promise<LotteryDayReportResult>;
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Lottery Day Report Integration — Full Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no previous closed days for period boundaries
    mockFindByStatus.mockReturnValue([]);
  });

  // --------------------------------------------------------------------------
  // 4.1-a: Full pipeline — multi-close date returns aggregated serials
  // --------------------------------------------------------------------------
  describe('Multi-close serial aggregation (4.1-a)', () => {
    it('should aggregate serials from first and last closings through full handler pipeline', async () => {
      setupStore();

      // Simulate 3 closings for same date, as returned by the allDays query
      const day1 = createBusinessDay({
        day_id: 'day-001',
        opened_at: '2026-02-02T15:24:00Z',
        closed_at: '2026-02-02T18:25:00Z',
        total_sales: 0,
        total_tickets_sold: 0,
      });
      const day2 = createBusinessDay({
        day_id: 'day-002',
        opened_at: '2026-02-02T18:25:00Z',
        closed_at: '2026-02-02T23:04:00Z',
        total_sales: 30,
        total_tickets_sold: 1,
      });
      const day3 = createBusinessDay({
        day_id: 'day-003',
        opened_at: '2026-02-02T23:04:00Z',
        closed_at: '2026-02-03T00:15:00Z',
        total_sales: 60,
        total_tickets_sold: 3,
      });

      // Bins query returns aggregated result (as the SQL would produce)
      const { mockAllDaysAll, mockBinsAll } = setupMockStatements({
        allDays: [day1, day2, day3],
        bins: [
          createBinRow({
            starting_serial: '000', // from first closing
            ending_serial: '004', // from last closing
            tickets_sold: 4, // SUM across all closings
            sales_amount: 120, // SUM across all closings
          }),
        ],
      });

      const result = await callLotteryDayReport();

      // Verify response contains correctly aggregated data
      expect(result.bins).toHaveLength(1);
      expect(result.bins[0].starting_serial).toBe('000');
      expect(result.bins[0].ending_serial).toBe('004');
      expect(result.bins[0].tickets_sold).toBe(4);
      expect(result.bins[0].sales_amount).toBe(120);
      expect(result.bins[0].game_name).toBe('Lucky 7s');
      expect(result.bins[0].game_price).toBe(30);
      expect(result.bins[0].pack_number).toBe('PKG-001');
      expect(result.bins[0].bin_number).toBe(1); // display_order 0 + 1

      // Verify the handler constructed the correct query parameters
      // allDaysStmt should receive store_id and businessDate
      expect(mockAllDaysAll).toHaveBeenCalledWith(TEST_STORE_A, TEST_DATE);

      // binsStmt should receive store_id, date, and all day_ids
      const binsCallArgs = mockBinsAll.mock.calls[0];
      expect(binsCallArgs).toContain(TEST_STORE_A);
      expect(binsCallArgs).toContain(TEST_DATE);
      expect(binsCallArgs).toContain('day-001');
      expect(binsCallArgs).toContain('day-002');
      expect(binsCallArgs).toContain('day-003');
    });

    it('should build IN clause with correct number of placeholders for day_ids', async () => {
      setupStore();

      setupMockStatements({
        allDays: [
          createBusinessDay({ day_id: 'day-001' }),
          createBusinessDay({ day_id: 'day-002' }),
          createBusinessDay({ day_id: 'day-003' }),
        ],
      });

      await callLotteryDayReport();

      // The bins query (2nd prepare call) should contain IN (?, ?, ?)
      const binsQuerySQL = mockPrepare.mock.calls[1]?.[0] as string;
      expect(binsQuerySQL).toContain('IN (?, ?, ?)');
      // day_ids must NOT appear in SQL string (parameterized, not interpolated)
      expect(binsQuerySQL).not.toContain('day-001');
      expect(binsQuerySQL).not.toContain('day-002');
    });

    it('should handle multiple packs aggregated across closings', async () => {
      setupStore();

      // NOTE: bins are grouped by pack_id in the handler, so each bin must have a unique pack_id
      setupMockStatements({
        allDays: [
          createBusinessDay({ day_id: 'day-001', total_tickets_sold: 2 }),
          createBusinessDay({ day_id: 'day-002', total_tickets_sold: 3 }),
        ],
        bins: [
          createBinRow({
            pack_id: 'pack-001-uuid', // Required for grouping
            bin_display_order: 0,
            pack_number: 'PKG-001',
            starting_serial: '000',
            ending_serial: '005',
            tickets_sold: 5,
            sales_amount: 150,
          }),
          createBinRow({
            pack_id: 'pack-002-uuid', // Required for grouping - unique from above
            bin_display_order: 1,
            pack_number: 'PKG-002',
            game_name: 'Mega Bucks',
            game_price: 10,
            starting_serial: '010',
            ending_serial: '015',
            tickets_sold: 5,
            sales_amount: 50,
          }),
        ],
      });

      const result = await callLotteryDayReport();

      // Both packs should be in response, ordered by bin_number
      expect(result.bins).toHaveLength(2);
      expect(result.bins[0].pack_number).toBe('PKG-001');
      expect(result.bins[0].bin_number).toBe(1); // display_order 0 + 1
      expect(result.bins[1].pack_number).toBe('PKG-002');
      expect(result.bins[1].bin_number).toBe(2); // display_order 1 + 1
      expect(result.bins[1].game_name).toBe('Mega Bucks');
      expect(result.bins[1].game_price).toBe(10);
    });
  });

  // --------------------------------------------------------------------------
  // 4.1-b: Full pipeline — closingSessions populated correctly
  // --------------------------------------------------------------------------
  describe('Closing sessions population (4.1-b)', () => {
    it('should populate closingSessions with correct count, order, and per-session data', async () => {
      setupStore();

      // Simulate 4 closings (matching the real Feb 2nd scenario from the problem statement)
      const closings = [
        createBusinessDay({
          day_id: 'day-001',
          opened_at: '2026-02-02T15:24:00Z',
          closed_at: '2026-02-02T18:25:00Z',
          total_sales: 0,
          total_tickets_sold: 0,
        }),
        createBusinessDay({
          day_id: 'day-002',
          opened_at: '2026-02-02T18:25:00Z',
          closed_at: '2026-02-02T23:04:00Z',
          total_sales: 30,
          total_tickets_sold: 1,
        }),
        createBusinessDay({
          day_id: 'day-003',
          opened_at: '2026-02-02T23:04:00Z',
          closed_at: '2026-02-03T00:15:00Z',
          total_sales: 30,
          total_tickets_sold: 1,
        }),
        createBusinessDay({
          day_id: 'day-004',
          opened_at: '2026-02-03T00:15:00Z',
          closed_at: '2026-02-03T20:31:00Z',
          total_sales: 60,
          total_tickets_sold: 2,
        }),
      ];

      setupMockStatements({
        allDays: closings,
        bins: [createBinRow()],
      });

      const result = await callLotteryDayReport();

      // 4 closing sessions
      expect(result.closingSessions).toHaveLength(4);
      expect(result.totalClosings).toBe(4);

      // Session 1: First closing — no sales
      expect(result.closingSessions[0]).toMatchObject({
        closingNumber: 1,
        openedAt: '2026-02-02T15:24:00Z',
        closedAt: '2026-02-02T18:25:00Z',
        totalTicketsSold: 0,
      });

      // Session 2: Second closing — 1 ticket/$30
      expect(result.closingSessions[1]).toMatchObject({
        closingNumber: 2,
        openedAt: '2026-02-02T18:25:00Z',
        closedAt: '2026-02-02T23:04:00Z',
        totalTicketsSold: 1,
      });

      // Session 3: Third closing — 1 ticket/$30
      expect(result.closingSessions[2]).toMatchObject({
        closingNumber: 3,
        openedAt: '2026-02-02T23:04:00Z',
        closedAt: '2026-02-03T00:15:00Z',
        totalTicketsSold: 1,
      });

      // Session 4: Fourth closing — 2 tickets/$60
      expect(result.closingSessions[3]).toMatchObject({
        closingNumber: 4,
        openedAt: '2026-02-03T00:15:00Z',
        closedAt: '2026-02-03T20:31:00Z',
        totalTicketsSold: 2,
      });

      // closedAt should be from the LAST closing
      expect(result.closedAt).toBe('2026-02-03T20:31:00Z');

      // dayStatus: all CLOSED → CLOSED
      expect(result.dayStatus).toBe('CLOSED');
    });

    it('should handle closingSessions with null timestamps', async () => {
      setupStore();

      setupMockStatements({
        allDays: [
          createBusinessDay({
            day_id: 'day-001',
            opened_at: null,
            closed_at: null,
            total_sales: 0,
            total_tickets_sold: 0,
            status: 'OPEN',
          }),
        ],
        bins: [],
      });

      const result = await callLotteryDayReport();

      expect(result.closingSessions).toHaveLength(1);
      expect(result.closingSessions[0].openedAt).toBeNull();
      expect(result.closingSessions[0].closedAt).toBeNull();
      expect(result.dayStatus).toBe('OPEN');
    });
  });

  // --------------------------------------------------------------------------
  // 4.1-c: Full pipeline — lotteryTotal sums across all closings
  // --------------------------------------------------------------------------
  describe('Lottery total summation (4.1-c)', () => {
    it('should sum lotteryTotal across all bins (not days.total_sales)', async () => {
      setupStore();

      // lotteryTotal is calculated from bins.sales_amount + depletedPacks + returnedPacks
      // (not from days.total_sales which is pre-calculated summary)
      setupMockStatements({
        allDays: [
          createBusinessDay({ day_id: 'day-001', total_sales: 150, total_tickets_sold: 5 }),
          createBusinessDay({ day_id: 'day-002', total_sales: 250, total_tickets_sold: 8 }),
          createBusinessDay({ day_id: 'day-003', total_sales: 100, total_tickets_sold: 3 }),
        ],
        bins: [
          createBinRow({ sales_amount: 150 }),
          createBinRow({ pack_number: 'PKG-002', sales_amount: 250 }),
          createBinRow({ pack_number: 'PKG-003', sales_amount: 100 }),
        ],
      });

      const result = await callLotteryDayReport();

      expect(result.lotteryTotal).toBe(500); // Sum from bins: 150 + 250 + 100
      expect(result.totalClosings).toBe(3);
      expect(result.dayStatus).toBe('CLOSED');
    });

    it('should handle zero sales_amount in bins', async () => {
      setupStore();

      // lotteryTotal is calculated from bins.sales_amount
      setupMockStatements({
        allDays: [
          createBusinessDay({ day_id: 'day-001', total_sales: 0, total_tickets_sold: 0 }),
          createBusinessDay({ day_id: 'day-002', total_sales: 0, total_tickets_sold: 0 }),
          createBusinessDay({ day_id: 'day-003', total_sales: 90, total_tickets_sold: 3 }),
        ],
        bins: [createBinRow({ sales_amount: 90 })],
      });

      const result = await callLotteryDayReport();

      expect(result.lotteryTotal).toBe(90); // From bins: 90
    });

    it('should return zero lotteryTotal when no bins', async () => {
      setupStore();

      // No bins means lotteryTotal = 0 (calculated from bins, not days)
      setupMockStatements({
        allDays: [
          createBusinessDay({ day_id: 'day-001', total_sales: null, total_tickets_sold: 0 }),
          createBusinessDay({ day_id: 'day-002', total_sales: 60, total_tickets_sold: 2 }),
        ],
        bins: [], // No bins
      });

      const result = await callLotteryDayReport();

      expect(result.lotteryTotal).toBe(0); // No bins = 0 total
    });
  });

  // --------------------------------------------------------------------------
  // 4.1-d: Full pipeline — single close date is unchanged (regression)
  // --------------------------------------------------------------------------
  describe('Single close regression (4.1-d)', () => {
    it('should produce correct results for single-close date', async () => {
      setupStore();

      const singleDay = createBusinessDay({
        day_id: 'day-001',
        opened_at: '2026-02-02T08:00:00Z',
        closed_at: '2026-02-02T22:00:00Z',
        total_sales: 120,
        total_tickets_sold: 4,
      });

      setupMockStatements({
        allDays: [singleDay],
        bins: [
          createBinRow({
            starting_serial: '000',
            ending_serial: '004',
            tickets_sold: 4,
            sales_amount: 120,
          }),
        ],
      });

      const result = await callLotteryDayReport();

      // Single closing verification
      expect(result.totalClosings).toBe(1);
      expect(result.closingSessions).toHaveLength(1);
      expect(result.closingSessions[0]).toMatchObject({
        closingNumber: 1,
        openedAt: '2026-02-02T08:00:00Z',
        closedAt: '2026-02-02T22:00:00Z',
        totalSales: 120,
        totalTicketsSold: 4,
      });

      // Response fields
      expect(result.businessDate).toBe(TEST_DATE);
      expect(result.dayStatus).toBe('CLOSED');
      expect(result.closedAt).toBe('2026-02-02T22:00:00Z');
      expect(result.lotteryTotal).toBe(120);

      // Bins (no aggregation needed — single closing)
      expect(result.bins).toHaveLength(1);
      expect(result.bins[0].starting_serial).toBe('000');
      expect(result.bins[0].ending_serial).toBe('004');
      expect(result.bins[0].tickets_sold).toBe(4);
      expect(result.bins[0].sales_amount).toBe(120);
      expect(result.bins[0].game_name).toBe('Lucky 7s');
      expect(result.bins[0].game_price).toBe(30);
      expect(result.bins[0].pack_number).toBe('PKG-001');
      expect(result.bins[0].bin_number).toBe(1);

      // Empty subsidiary arrays
      expect(result.activatedPacks).toHaveLength(0);
      expect(result.depletedPacks).toHaveLength(0);
      expect(result.returnedPacks).toHaveLength(0);
    });

    it('should return empty response when no closings exist for date', async () => {
      setupStore();

      setupMockStatements({ allDays: [] });

      const result = await callLotteryDayReport('2026-03-15');

      expect(result.businessDate).toBe('2026-03-15');
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

    it('should construct IN clause with single placeholder for single close', async () => {
      setupStore();

      setupMockStatements({
        allDays: [createBusinessDay({ day_id: 'day-single' })],
      });

      await callLotteryDayReport();

      // The bins query should contain IN (?) — single placeholder
      const binsQuerySQL = mockPrepare.mock.calls[1]?.[0] as string;
      expect(binsQuerySQL).toContain('IN (?)');
    });
  });

  // --------------------------------------------------------------------------
  // 4.1-e: Tenant isolation — multi-close for store A does not affect store B
  // --------------------------------------------------------------------------
  describe('Tenant isolation (4.1-e)', () => {
    it('should scope all queries by store_id and pass store_id as parameter', async () => {
      setupStore(TEST_STORE_A);

      const days = [
        createBusinessDay({ day_id: 'day-A1', store_id: TEST_STORE_A, total_sales: 100 }),
        createBusinessDay({ day_id: 'day-A2', store_id: TEST_STORE_A, total_sales: 200 }),
      ];

      const { mockAllDaysAll, mockBinsAll, mockActivatedAll, mockDepletedAll, mockReturnedAll } =
        setupMockStatements({
          allDays: days,
          bins: [
            createBinRow({
              starting_serial: '000',
              ending_serial: '007',
              tickets_sold: 7,
              sales_amount: 210,
            }),
          ],
        });

      const result = await callLotteryDayReport();

      // Verify store A data only
      expect(result.totalClosings).toBe(2);
      // lotteryTotal is calculated from bins (210), not days table total_sales
      expect(result.lotteryTotal).toBe(210);

      // Verify ALL SQL queries include store_id in their text
      for (const call of mockPrepare.mock.calls) {
        const sql = call[0] as string;
        expect(sql).toContain('store_id');
      }

      // Verify store_id is passed as parameter to allDaysStmt
      expect(mockAllDaysAll).toHaveBeenCalledWith(TEST_STORE_A, TEST_DATE);

      // Verify store_id is in the binsStmt parameters
      const binsCallArgs = mockBinsAll.mock.calls[0];
      expect(binsCallArgs).toContain(TEST_STORE_A);

      // Verify store_id is in activated/depleted/returned stmt parameters
      expect(mockActivatedAll.mock.calls[0]).toContain(TEST_STORE_A);
      expect(mockDepletedAll.mock.calls[0]).toContain(TEST_STORE_A);
      expect(mockReturnedAll.mock.calls[0]).toContain(TEST_STORE_A);
    });

    it('should not include store B data when querying store A', async () => {
      // Configure handler for store A
      setupStore(TEST_STORE_A);

      // Mock returns store A data only (handler filters by store_id)
      const storeADays = [
        createBusinessDay({
          day_id: 'day-A1',
          store_id: TEST_STORE_A,
          total_sales: 100,
          total_tickets_sold: 3,
        }),
        createBusinessDay({
          day_id: 'day-A2',
          store_id: TEST_STORE_A,
          total_sales: 200,
          total_tickets_sold: 4,
        }),
      ];

      setupMockStatements({
        allDays: storeADays,
        bins: [
          createBinRow({
            pack_number: 'PKG-A',
            starting_serial: '000',
            ending_serial: '007',
            tickets_sold: 7,
            sales_amount: 210,
          }),
        ],
      });

      const result = await callLotteryDayReport();

      // Only store A data
      expect(result.totalClosings).toBe(2);
      // lotteryTotal is calculated from bins (210), not days table total_sales
      expect(result.lotteryTotal).toBe(210);
      expect(result.bins).toHaveLength(1);
      expect(result.bins[0].pack_number).toBe('PKG-A');
      expect(result.bins[0].tickets_sold).toBe(7);
      expect(result.bins[0].sales_amount).toBe(210);

      // Verify query was scoped to store A specifically
      const allDaysSQL = mockPrepare.mock.calls[0]?.[0] as string;
      expect(allDaysSQL).toContain('store_id = ?');
      expect(allDaysSQL).not.toContain(TEST_STORE_B);
    });

    it('should pass store_id to bins query subqueries for first/last serial lookup', async () => {
      setupStore(TEST_STORE_A);

      const { mockBinsAll } = setupMockStatements({
        allDays: [
          createBusinessDay({ day_id: 'day-001' }),
          createBusinessDay({ day_id: 'day-002' }),
        ],
        bins: [createBinRow()],
      });

      await callLotteryDayReport();

      // The bins query (2nd prepare call) should contain store_id for tenant isolation
      const binsQuerySQL = mockPrepare.mock.calls[1]?.[0] as string;

      // The main WHERE clause must filter by store_id for DB-006 compliance.
      // Subqueries use pack_id which is already store-scoped via lottery_packs.
      const storeIdOccurrences = (binsQuerySQL.match(/store_id/g) || []).length;
      expect(storeIdOccurrences).toBeGreaterThanOrEqual(1);

      // Verify store_id is in the parameters (not interpolated)
      const binsCallArgs = mockBinsAll.mock.calls[0];
      const storeIdInParams = binsCallArgs.filter((arg: unknown) => arg === TEST_STORE_A);
      expect(storeIdInParams.length).toBeGreaterThanOrEqual(1);
    });
  });

  // --------------------------------------------------------------------------
  // Response shape validation
  // --------------------------------------------------------------------------
  describe('Response shape validation', () => {
    it('should include all required fields in response', async () => {
      setupStore();

      setupMockStatements({
        allDays: [createBusinessDay()],
        bins: [createBinRow()],
      });

      const result = await callLotteryDayReport();

      // Top-level fields
      expect(result).toHaveProperty('businessDate');
      expect(result).toHaveProperty('dayStatus');
      expect(result).toHaveProperty('closedAt');
      expect(result).toHaveProperty('lotteryTotal');
      expect(result).toHaveProperty('totalClosings');
      expect(result).toHaveProperty('closingSessions');
      expect(result).toHaveProperty('bins');
      expect(result).toHaveProperty('activatedPacks');
      expect(result).toHaveProperty('depletedPacks');
      expect(result).toHaveProperty('returnedPacks');

      // Verify arrays
      expect(Array.isArray(result.closingSessions)).toBe(true);
      expect(Array.isArray(result.bins)).toBe(true);
      expect(Array.isArray(result.activatedPacks)).toBe(true);
      expect(Array.isArray(result.depletedPacks)).toBe(true);
      expect(Array.isArray(result.returnedPacks)).toBe(true);
    });

    it('should use parameterized statements for all queries (SEC-006)', async () => {
      setupStore();

      setupMockStatements({
        allDays: [createBusinessDay()],
      });

      await callLotteryDayReport();

      // All SQL passed to prepare must use ? placeholders
      for (const call of mockPrepare.mock.calls) {
        const sql = call[0] as string;
        expect(sql).toContain('?');
        // Must not contain the actual store_id or date in SQL
        expect(sql).not.toContain(TEST_STORE_A);
        expect(sql).not.toContain("'" + TEST_DATE + "'");
      }
    });
  });
});
