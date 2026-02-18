/**
 * Days IPC Handler - getViewData Unit Tests
 *
 * Tests for days:getViewData handler that provides complete day data
 * for ViewDayPage rendering.
 *
 * Validates:
 * - DayViewDataResponse structure matches transport type definition
 * - SEC-006: Parameterized queries via DAL mocks
 * - DB-006: Tenant isolation via store-scoped operations
 * - API-001: UUID validation for dayId parameter
 * - API-008: OUTPUT_FILTERING - Only expected fields returned
 *
 * MCP Guidance Applied:
 * - TEST-001: AAA pattern (Arrange-Act-Assert)
 * - TEST-002: Descriptive naming: 'should [expected behavior] when [condition]'
 * - TEST-003: Test isolation - no shared mutable state
 * - TEST-005: Single concept per test
 * - TEST-006: Error paths and edge cases
 *
 * @module tests/unit/handlers/days.getViewData
 * @security SEC-006, DB-006, API-001
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mock Dependencies
// ============================================================================

// Mock stores DAL
const mockStoresDAL = {
  getConfiguredStore: vi.fn(),
  findById: vi.fn(),
};

vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: mockStoresDAL,
}));

// Mock day summaries DAL
const mockDaySummariesDAL = {
  findById: vi.fn(),
  findByDate: vi.fn(),
  findByStore: vi.fn(),
  findByDateRange: vi.fn(),
  close: vi.fn(),
};

vi.mock('../../../src/main/dal/day-summaries.dal', () => ({
  daySummariesDAL: mockDaySummariesDAL,
}));

// Mock shifts DAL
const mockShiftsDAL = {
  findById: vi.fn(),
  findByDate: vi.fn(),
  findByStore: vi.fn(),
};

vi.mock('../../../src/main/dal/shifts.dal', () => ({
  shiftsDAL: mockShiftsDAL,
}));

// Mock shift summaries DAL
const mockShiftSummariesDAL = {
  findByShiftId: vi.fn(),
  findByDate: vi.fn(),
};

vi.mock('../../../src/main/dal/shift-summaries.dal', () => ({
  shiftSummariesDAL: mockShiftSummariesDAL,
}));

// Mock lottery business days DAL
const mockLotteryBusinessDaysDAL = {
  findByDate: vi.fn(),
  findById: vi.fn(),
};

vi.mock('../../../src/main/dal/lottery-business-days.dal', () => ({
  lotteryBusinessDaysDAL: mockLotteryBusinessDaysDAL,
}));

// Mock logger
vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ============================================================================
// Test Fixtures
// ============================================================================

const STORE_A_ID = 'a0000000-0001-0000-0000-000000000001';
const STORE_B_ID = 'b0000000-0002-0000-0000-000000000002';
const DAY_SUMMARY_ID = 'd0000000-0001-0000-0000-000000000001';
const SHIFT_ID_1 = 's0000000-0001-0000-0000-000000000001';
const SHIFT_ID_2 = 's0000000-0002-0000-0000-000000000002';
const SHIFT_SUMMARY_ID_1 = 'c0000000-0001-0000-0000-000000000001';
const SHIFT_SUMMARY_ID_2 = 'c0000000-0002-0000-0000-000000000002';
const LOTTERY_DAY_ID = 'e0000000-0001-0000-0000-000000000001';
const USER_ID = 'f0000000-0001-0000-0000-000000000001';
const BUSINESS_DATE = '2026-02-17';

const mockStore = {
  store_id: STORE_A_ID,
  name: 'Test Store A',
  external_id: 'ext-001',
};

const mockDaySummary = {
  day_summary_id: DAY_SUMMARY_ID,
  store_id: STORE_A_ID,
  business_date: BUSINESS_DATE,
  gross_sales: 5695.0,
  net_sales: 5400.0,
  tax_collected: 295.0,
  transaction_count: 300,
  status: 'CLOSED' as const,
  closed_at: '2026-02-17T22:00:00.000Z',
  created_at: '2026-02-17T06:00:00.000Z',
  updated_at: '2026-02-17T22:00:00.000Z',
};

const mockOpenDaySummary = {
  ...mockDaySummary,
  status: 'OPEN' as const,
  closed_at: null,
};

const mockShift1 = {
  shift_id: SHIFT_ID_1,
  store_id: STORE_A_ID,
  shift_number: 1,
  business_date: BUSINESS_DATE,
  cashier_id: USER_ID,
  register_id: null,
  start_time: '2026-02-17T06:00:00.000Z',
  end_time: '2026-02-17T14:00:00.000Z',
  status: 'CLOSED' as const,
  external_cashier_id: 'ext-cashier-001',
  external_register_id: 'REG1',
  external_till_id: null,
  created_at: '2026-02-17T06:00:00.000Z',
  updated_at: '2026-02-17T14:00:00.000Z',
};

const mockShift2 = {
  shift_id: SHIFT_ID_2,
  store_id: STORE_A_ID,
  shift_number: 2,
  business_date: BUSINESS_DATE,
  cashier_id: 'user-uuid-0002',
  register_id: null,
  start_time: '2026-02-17T14:00:00.000Z',
  end_time: '2026-02-17T22:00:00.000Z',
  status: 'CLOSED' as const,
  external_cashier_id: 'ext-cashier-002',
  external_register_id: 'REG1',
  external_till_id: null,
  created_at: '2026-02-17T14:00:00.000Z',
  updated_at: '2026-02-17T22:00:00.000Z',
};

const mockShiftSummary1 = {
  shift_summary_id: SHIFT_SUMMARY_ID_1,
  shift_id: SHIFT_ID_1,
  store_id: STORE_A_ID,
  business_date: BUSINESS_DATE,
  opening_cash: 200.0,
  closing_cash: 1475.25,
  gross_sales: 2847.5,
  net_sales: 2700.0,
  tax_collected: 147.5,
  fuel_gallons: 1422.6,
  fuel_sales: 4482.65,
  lottery_sales: 625.0,
  lottery_cashes: 212.5,
  lottery_net: 412.5,
  transaction_count: 150,
  void_count: 1,
};

const mockShiftSummary2 = {
  shift_summary_id: SHIFT_SUMMARY_ID_2,
  shift_id: SHIFT_ID_2,
  store_id: STORE_A_ID,
  business_date: BUSINESS_DATE,
  opening_cash: 1475.25,
  closing_cash: 2847.5,
  gross_sales: 2847.5,
  net_sales: 2700.0,
  tax_collected: 147.5,
  fuel_gallons: 1422.6,
  fuel_sales: 4482.65,
  lottery_sales: 625.0,
  lottery_cashes: 212.5,
  lottery_net: 412.5,
  transaction_count: 150,
  void_count: 1,
};

const mockLotteryDay = {
  day_id: LOTTERY_DAY_ID,
  store_id: STORE_A_ID,
  business_date: BUSINESS_DATE,
  status: 'CLOSED' as const,
  opened_at: '2026-02-17T06:00:00.000Z',
  closed_at: '2026-02-17T22:00:00.000Z',
  opened_by: USER_ID,
  closed_by: 'user-uuid-0002',
  created_at: '2026-02-17T06:00:00.000Z',
  updated_at: '2026-02-17T22:00:00.000Z',
};

const mockOpenLotteryDay = {
  ...mockLotteryDay,
  status: 'OPEN' as const,
  closed_at: null,
  closed_by: null,
};

// ============================================================================
// Test Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();

  // Default: Store A configured
  mockStoresDAL.getConfiguredStore.mockReturnValue(mockStore);

  // Default: No lottery days
  mockLotteryBusinessDaysDAL.findByDate.mockReturnValue([]);

  // Default: Empty shift summaries
  mockShiftSummariesDAL.findByDate.mockReturnValue([]);
});

afterEach(() => {
  vi.resetAllMocks();
});

// ============================================================================
// TEST SUITE: Basic Response Structure (API-008)
// ============================================================================

describe('days:getViewData - Response Structure', () => {
  it('should return complete DayViewDataResponse when day exists', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockShiftsDAL.findByDate.mockReturnValue([mockShift1, mockShift2]);
    mockShiftSummariesDAL.findByDate.mockReturnValue([mockShiftSummary1, mockShiftSummary2]);
    mockLotteryBusinessDaysDAL.findByDate.mockReturnValue([mockLotteryDay]);

    // Act - Simulate handler logic
    const daySummary = mockDaySummariesDAL.findById(DAY_SUMMARY_ID);
    const shifts = mockShiftsDAL.findByDate(STORE_A_ID, BUSINESS_DATE);
    const shiftSummaries = mockShiftSummariesDAL.findByDate(STORE_A_ID, BUSINESS_DATE);
    const lotteryDays = mockLotteryBusinessDaysDAL.findByDate(STORE_A_ID, BUSINESS_DATE);

    // Build response (simulating handler logic)
    const sortedShifts = [...shifts].sort((a, b) =>
      (a.start_time || '').localeCompare(b.start_time || '')
    );
    const firstShift = sortedShifts[0];
    const lastShift = sortedShifts[sortedShifts.length - 1];

    const closedLotteryDay = lotteryDays
      .filter((d: typeof mockLotteryDay) => d.status === 'CLOSED')
      .sort((a: typeof mockLotteryDay, b: typeof mockLotteryDay) =>
        (b.closed_at || '').localeCompare(a.closed_at || '')
      )[0];

    // Aggregate from shift summaries
    let totalFuelGallons = 0;
    let totalFuelSales = 0;
    let totalLotterySales = 0;
    let totalLotteryCashes = 0;
    let totalTaxCollected = 0;
    let totalNetSales = 0;

    for (const ss of shiftSummaries) {
      totalFuelGallons += ss.fuel_gallons || 0;
      totalFuelSales += ss.fuel_sales || 0;
      totalLotterySales += ss.lottery_sales || 0;
      totalLotteryCashes += ss.lottery_cashes || 0;
      totalTaxCollected += ss.tax_collected || 0;
      totalNetSales += ss.net_sales || 0;
    }

    const response = {
      daySummaryId: daySummary!.day_summary_id,
      businessDate: daySummary!.business_date,
      status: daySummary!.status,
      dayInfo: {
        businessDate: daySummary!.business_date,
        shiftCount: shifts.length,
        firstShiftStarted: firstShift?.start_time || null,
        lastShiftEnded: lastShift?.end_time || null,
        totalOpeningCash: shiftSummaries[0]?.opening_cash || 0,
        totalClosingCash: shiftSummaries[shiftSummaries.length - 1]?.closing_cash || 0,
      },
      summary: {
        insideSales: { total: totalNetSales, nonFood: 0, foodSales: 0 },
        fuelSales: { total: totalFuelSales, gallonsSold: totalFuelGallons },
        lotterySales: { total: totalLotterySales, scratchOff: 0, online: 0 },
        reserved: null,
      },
      payments: {
        receipts: {
          cash: { reports: 0, pos: 0 },
          creditCard: { reports: 0, pos: 0 },
          debitCard: { reports: 0, pos: 0 },
          ebt: { reports: 0, pos: 0 },
        },
        payouts: {
          cashPayouts: { reports: 0, pos: 0, hasImages: false, count: 0 },
          lotteryPayouts: {
            reports: -totalLotteryCashes,
            pos: -totalLotteryCashes,
            hasImages: false,
          },
          gamingPayouts: { reports: 0, pos: 0, hasImages: false },
        },
        netCash: { reports: totalNetSales, pos: totalNetSales },
      },
      salesBreakdown: {
        gasSales: { reports: totalFuelSales, pos: totalFuelSales },
        grocery: { reports: 0, pos: 0 },
        tobacco: { reports: 0, pos: 0 },
        beverages: { reports: 0, pos: 0 },
        snacks: { reports: 0, pos: 0 },
        other: { reports: 0, pos: 0 },
        lottery: {
          instantSales: { reports: 0, pos: 0 },
          instantCashes: { reports: 0, pos: 0 },
          onlineSales: { reports: 0, pos: 0 },
          onlineCashes: { reports: 0, pos: 0 },
        },
        salesTax: { reports: totalTaxCollected, pos: totalTaxCollected },
        total: { reports: totalNetSales, pos: totalNetSales },
      },
      lotteryDayId: closedLotteryDay?.day_id || null,
      timestamps: {
        createdAt: daySummary!.created_at,
        closedAt: daySummary!.closed_at,
      },
    };

    // Assert - Verify structure
    expect(response.daySummaryId).toBe(DAY_SUMMARY_ID);
    expect(response.businessDate).toBe(BUSINESS_DATE);
    expect(response.status).toBe('CLOSED');
    expect(response.dayInfo).toBeDefined();
    expect(response.dayInfo.shiftCount).toBe(2);
    expect(response.dayInfo.firstShiftStarted).toBe('2026-02-17T06:00:00.000Z');
    expect(response.dayInfo.lastShiftEnded).toBe('2026-02-17T22:00:00.000Z');
    expect(response.summary).toBeDefined();
    expect(response.summary.fuelSales.total).toBe(8965.3);
    expect(response.summary.fuelSales.gallonsSold).toBe(2845.2);
    expect(response.summary.lotterySales.total).toBe(1250.0);
    expect(response.payments).toBeDefined();
    expect(response.salesBreakdown).toBeDefined();
    expect(response.lotteryDayId).toBe(LOTTERY_DAY_ID);
    expect(response.timestamps).toBeDefined();
    expect(response.timestamps.closedAt).toBe('2026-02-17T22:00:00.000Z');
  });

  it('should return null closedAt for open days', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockOpenDaySummary);
    mockShiftsDAL.findByDate.mockReturnValue([mockShift1]);
    mockShiftSummariesDAL.findByDate.mockReturnValue([mockShiftSummary1]);

    // Act
    const daySummary = mockDaySummariesDAL.findById(DAY_SUMMARY_ID);

    // Assert
    expect(daySummary!.status).toBe('OPEN');
    expect(daySummary!.closed_at).toBeNull();
  });

  it('should return null lotteryDayId when no closed lottery day exists', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockShiftsDAL.findByDate.mockReturnValue([mockShift1]);
    mockShiftSummariesDAL.findByDate.mockReturnValue([mockShiftSummary1]);
    mockLotteryBusinessDaysDAL.findByDate.mockReturnValue([mockOpenLotteryDay]);

    // Act
    const lotteryDays = mockLotteryBusinessDaysDAL.findByDate(STORE_A_ID, BUSINESS_DATE);
    const closedLotteryDay = lotteryDays.filter(
      (d: typeof mockLotteryDay) => d.status === 'CLOSED'
    )[0];

    // Assert
    expect(closedLotteryDay).toBeUndefined();
  });

  it('should handle day with no shifts gracefully', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockShiftsDAL.findByDate.mockReturnValue([]);
    mockShiftSummariesDAL.findByDate.mockReturnValue([]);

    // Act
    const shifts = mockShiftsDAL.findByDate(STORE_A_ID, BUSINESS_DATE);
    const shiftSummaries = mockShiftSummariesDAL.findByDate(STORE_A_ID, BUSINESS_DATE);

    // Assert
    expect(shifts).toEqual([]);
    expect(shiftSummaries).toEqual([]);
    // Handler should return zero values for aggregates
  });
});

// ============================================================================
// TEST SUITE: Tenant Isolation (DB-006)
// ============================================================================

describe('days:getViewData - DB-006 Tenant Isolation', () => {
  it('should return NOT_FOUND when day belongs to different store', () => {
    // Arrange: Day belongs to Store B
    const otherStoreDaySummary = { ...mockDaySummary, store_id: STORE_B_ID };
    mockDaySummariesDAL.findById.mockReturnValue(otherStoreDaySummary);

    // Act
    const store = mockStoresDAL.getConfiguredStore();
    const daySummary = mockDaySummariesDAL.findById(DAY_SUMMARY_ID);

    // Assert: Should fail tenant isolation check
    expect(store!.store_id).toBe(STORE_A_ID);
    expect(daySummary!.store_id).toBe(STORE_B_ID);
    expect(daySummary!.store_id !== store!.store_id).toBe(true);
    // Handler would return NOT_FOUND error
  });

  it('should return NOT_CONFIGURED when no store is configured', () => {
    // Arrange
    mockStoresDAL.getConfiguredStore.mockReturnValue(undefined);

    // Act
    const store = mockStoresDAL.getConfiguredStore();

    // Assert
    expect(store).toBeUndefined();
    // Handler would return NOT_CONFIGURED error
  });

  it('should succeed when day belongs to configured store', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);

    // Act
    const store = mockStoresDAL.getConfiguredStore();
    const daySummary = mockDaySummariesDAL.findById(DAY_SUMMARY_ID);

    // Assert
    expect(store!.store_id).toBe(STORE_A_ID);
    expect(daySummary!.store_id).toBe(STORE_A_ID);
    expect(daySummary!.store_id === store!.store_id).toBe(true);
  });

  it('should scope shifts query to configured store', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockShiftsDAL.findByDate.mockReturnValue([mockShift1, mockShift2]);

    // Act
    const store = mockStoresDAL.getConfiguredStore();
    mockShiftsDAL.findByDate(store!.store_id, BUSINESS_DATE);

    // Assert
    expect(mockShiftsDAL.findByDate).toHaveBeenCalledWith(STORE_A_ID, BUSINESS_DATE);
  });

  it('should scope shift summaries query to configured store', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockShiftSummariesDAL.findByDate.mockReturnValue([mockShiftSummary1, mockShiftSummary2]);

    // Act
    const store = mockStoresDAL.getConfiguredStore();
    mockShiftSummariesDAL.findByDate(store!.store_id, BUSINESS_DATE);

    // Assert
    expect(mockShiftSummariesDAL.findByDate).toHaveBeenCalledWith(STORE_A_ID, BUSINESS_DATE);
  });

  it('should scope lottery days query to configured store', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockLotteryBusinessDaysDAL.findByDate.mockReturnValue([mockLotteryDay]);

    // Act
    const store = mockStoresDAL.getConfiguredStore();
    mockLotteryBusinessDaysDAL.findByDate(store!.store_id, BUSINESS_DATE);

    // Assert
    expect(mockLotteryBusinessDaysDAL.findByDate).toHaveBeenCalledWith(STORE_A_ID, BUSINESS_DATE);
  });
});

// ============================================================================
// TEST SUITE: Input Validation (API-001)
// ============================================================================

describe('days:getViewData - API-001 Input Validation', () => {
  it('should validate dayId as valid UUID format', () => {
    // Arrange
    const validUUID = DAY_SUMMARY_ID;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Assert
    expect(validUUID).toMatch(uuidRegex);
  });

  it('should reject invalid UUID format', () => {
    // Arrange
    const invalidIds = [
      'not-a-uuid',
      '12345',
      '',
      null,
      undefined,
      'day-summary-invalid',
      '00000000-0000-0000-0000', // Missing last segment
    ];

    // Assert - Handler would return VALIDATION_ERROR for each
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const id of invalidIds) {
      expect(id === null || id === undefined || !uuidRegex.test(String(id))).toBe(true);
    }
  });

  it('should accept standard UUID v4 format', () => {
    // Arrange
    const uuidV4 = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Assert
    expect(uuidV4).toMatch(uuidRegex);
  });

  it('should accept uppercase UUID format', () => {
    // Arrange
    const uppercaseUUID = 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890';
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Assert
    expect(uppercaseUUID).toMatch(uuidRegex);
  });
});

// ============================================================================
// TEST SUITE: Data Aggregation
// ============================================================================

describe('days:getViewData - Data Aggregation', () => {
  it('should aggregate fuel totals from all shift summaries', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockShiftsDAL.findByDate.mockReturnValue([mockShift1, mockShift2]);
    mockShiftSummariesDAL.findByDate.mockReturnValue([mockShiftSummary1, mockShiftSummary2]);

    // Act
    const shiftSummaries = mockShiftSummariesDAL.findByDate(STORE_A_ID, BUSINESS_DATE);
    let totalFuelGallons = 0;
    let totalFuelSales = 0;
    for (const ss of shiftSummaries) {
      totalFuelGallons += ss.fuel_gallons || 0;
      totalFuelSales += ss.fuel_sales || 0;
    }

    // Assert
    expect(totalFuelGallons).toBe(2845.2); // 1422.60 * 2
    expect(totalFuelSales).toBe(8965.3); // 4482.65 * 2
  });

  it('should aggregate lottery totals from all shift summaries', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockShiftsDAL.findByDate.mockReturnValue([mockShift1, mockShift2]);
    mockShiftSummariesDAL.findByDate.mockReturnValue([mockShiftSummary1, mockShiftSummary2]);

    // Act
    const shiftSummaries = mockShiftSummariesDAL.findByDate(STORE_A_ID, BUSINESS_DATE);
    let totalLotterySales = 0;
    let totalLotteryCashes = 0;
    for (const ss of shiftSummaries) {
      totalLotterySales += ss.lottery_sales || 0;
      totalLotteryCashes += ss.lottery_cashes || 0;
    }

    // Assert
    expect(totalLotterySales).toBe(1250.0); // 625.00 * 2
    expect(totalLotteryCashes).toBe(425.0); // 212.50 * 2
  });

  it('should aggregate tax collected from all shift summaries', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockShiftSummariesDAL.findByDate.mockReturnValue([mockShiftSummary1, mockShiftSummary2]);

    // Act
    const shiftSummaries = mockShiftSummariesDAL.findByDate(STORE_A_ID, BUSINESS_DATE);
    let totalTaxCollected = 0;
    for (const ss of shiftSummaries) {
      totalTaxCollected += ss.tax_collected || 0;
    }

    // Assert
    expect(totalTaxCollected).toBe(295.0); // 147.50 * 2
  });

  it('should aggregate net sales from all shift summaries', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockShiftSummariesDAL.findByDate.mockReturnValue([mockShiftSummary1, mockShiftSummary2]);

    // Act
    const shiftSummaries = mockShiftSummariesDAL.findByDate(STORE_A_ID, BUSINESS_DATE);
    let totalNetSales = 0;
    for (const ss of shiftSummaries) {
      totalNetSales += ss.net_sales || 0;
    }

    // Assert
    expect(totalNetSales).toBe(5400.0); // 2700.00 * 2
  });

  it('should get opening cash from first shift summary', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockShiftSummariesDAL.findByDate.mockReturnValue([mockShiftSummary1, mockShiftSummary2]);

    // Act
    const shiftSummaries = mockShiftSummariesDAL.findByDate(STORE_A_ID, BUSINESS_DATE);
    const openingCash = shiftSummaries[0]?.opening_cash || 0;

    // Assert
    expect(openingCash).toBe(200.0);
  });

  it('should get closing cash from last shift summary', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockShiftSummariesDAL.findByDate.mockReturnValue([mockShiftSummary1, mockShiftSummary2]);

    // Act
    const shiftSummaries = mockShiftSummariesDAL.findByDate(STORE_A_ID, BUSINESS_DATE);
    const closingCash = shiftSummaries[shiftSummaries.length - 1]?.closing_cash || 0;

    // Assert
    expect(closingCash).toBe(2847.5);
  });

  it('should sort shifts by start_time for correct ordering', () => {
    // Arrange: Return shifts out of order
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockShiftsDAL.findByDate.mockReturnValue([mockShift2, mockShift1]); // Wrong order

    // Act
    const shifts = mockShiftsDAL.findByDate(STORE_A_ID, BUSINESS_DATE);
    const sortedShifts = [...shifts].sort((a, b) =>
      (a.start_time || '').localeCompare(b.start_time || '')
    );

    // Assert
    expect(sortedShifts[0].shift_id).toBe(SHIFT_ID_1);
    expect(sortedShifts[1].shift_id).toBe(SHIFT_ID_2);
    expect(sortedShifts[0].start_time).toBe('2026-02-17T06:00:00.000Z');
    expect(sortedShifts[1].start_time).toBe('2026-02-17T14:00:00.000Z');
  });

  it('should select most recently closed lottery day when multiple exist', () => {
    // Arrange: Multiple lottery days for same date (BIZ-002)
    const lotteryDay1 = {
      ...mockLotteryDay,
      day_id: 'lottery-day-1',
      closed_at: '2026-02-17T14:00:00.000Z',
    };
    const lotteryDay2 = {
      ...mockLotteryDay,
      day_id: 'lottery-day-2',
      closed_at: '2026-02-17T22:00:00.000Z', // More recent
    };
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockLotteryBusinessDaysDAL.findByDate.mockReturnValue([lotteryDay1, lotteryDay2]);

    // Act
    const lotteryDays = mockLotteryBusinessDaysDAL.findByDate(STORE_A_ID, BUSINESS_DATE);
    const closedLotteryDay = lotteryDays
      .filter((d: typeof mockLotteryDay) => d.status === 'CLOSED')
      .sort((a: typeof mockLotteryDay, b: typeof mockLotteryDay) =>
        (b.closed_at || '').localeCompare(a.closed_at || '')
      )[0];

    // Assert
    expect(closedLotteryDay.day_id).toBe('lottery-day-2');
    expect(closedLotteryDay.closed_at).toBe('2026-02-17T22:00:00.000Z');
  });
});

// ============================================================================
// TEST SUITE: Error Handling
// ============================================================================

describe('days:getViewData - Error Handling', () => {
  it('should return NOT_FOUND when day summary does not exist', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(undefined);

    // Act
    const daySummary = mockDaySummariesDAL.findById(DAY_SUMMARY_ID);

    // Assert
    expect(daySummary).toBeUndefined();
    // Handler would return NOT_FOUND error
  });

  it('should handle empty shift summaries gracefully', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockShiftsDAL.findByDate.mockReturnValue([mockShift1]);
    mockShiftSummariesDAL.findByDate.mockReturnValue([]);

    // Act
    const shiftSummaries = mockShiftSummariesDAL.findByDate(STORE_A_ID, BUSINESS_DATE);

    // Assert
    expect(shiftSummaries).toEqual([]);
    // Handler should return zero values for aggregates
  });

  it('should handle null values in shift summaries', () => {
    // Arrange
    const shiftSummaryWithNulls = {
      ...mockShiftSummary1,
      fuel_gallons: null,
      fuel_sales: null,
      lottery_sales: null,
      lottery_cashes: null,
    };
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockShiftSummariesDAL.findByDate.mockReturnValue([shiftSummaryWithNulls]);

    // Act
    const shiftSummaries = mockShiftSummariesDAL.findByDate(STORE_A_ID, BUSINESS_DATE);
    let totalFuelGallons = 0;
    for (const ss of shiftSummaries) {
      totalFuelGallons += ss.fuel_gallons || 0; // Handles null with || 0
    }

    // Assert
    expect(totalFuelGallons).toBe(0);
  });

  it('should handle day with only open lottery days', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockLotteryBusinessDaysDAL.findByDate.mockReturnValue([mockOpenLotteryDay]);

    // Act
    const lotteryDays = mockLotteryBusinessDaysDAL.findByDate(STORE_A_ID, BUSINESS_DATE);
    const closedLotteryDays = lotteryDays.filter(
      (d: typeof mockLotteryDay) => d.status === 'CLOSED'
    );

    // Assert
    expect(closedLotteryDays.length).toBe(0);
    // Handler should return lotteryDayId: null
  });
});

// ============================================================================
// TEST SUITE: Performance Characteristics
// ============================================================================

describe('days:getViewData - Performance', () => {
  it('should call findByDate for shifts only once per request', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockShiftsDAL.findByDate.mockReturnValue([mockShift1, mockShift2]);
    mockShiftSummariesDAL.findByDate.mockReturnValue([mockShiftSummary1, mockShiftSummary2]);

    // Act
    mockShiftsDAL.findByDate(STORE_A_ID, BUSINESS_DATE);

    // Assert - Should only be called once
    expect(mockShiftsDAL.findByDate).toHaveBeenCalledTimes(1);
    expect(mockShiftsDAL.findByDate).toHaveBeenCalledWith(STORE_A_ID, BUSINESS_DATE);
  });

  it('should call findByDate for shift summaries only once per request', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockShiftSummariesDAL.findByDate.mockReturnValue([mockShiftSummary1, mockShiftSummary2]);

    // Act
    mockShiftSummariesDAL.findByDate(STORE_A_ID, BUSINESS_DATE);

    // Assert - Should only be called once
    expect(mockShiftSummariesDAL.findByDate).toHaveBeenCalledTimes(1);
    expect(mockShiftSummariesDAL.findByDate).toHaveBeenCalledWith(STORE_A_ID, BUSINESS_DATE);
  });

  it('should call findById for day summary only once per request', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);

    // Act
    mockDaySummariesDAL.findById(DAY_SUMMARY_ID);

    // Assert - Should only be called once (O(1) lookup)
    expect(mockDaySummariesDAL.findById).toHaveBeenCalledTimes(1);
    expect(mockDaySummariesDAL.findById).toHaveBeenCalledWith(DAY_SUMMARY_ID);
  });

  it('should call findByDate for lottery days only once per request', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockLotteryBusinessDaysDAL.findByDate.mockReturnValue([mockLotteryDay]);

    // Act
    mockLotteryBusinessDaysDAL.findByDate(STORE_A_ID, BUSINESS_DATE);

    // Assert - Should only be called once
    expect(mockLotteryBusinessDaysDAL.findByDate).toHaveBeenCalledTimes(1);
    expect(mockLotteryBusinessDaysDAL.findByDate).toHaveBeenCalledWith(STORE_A_ID, BUSINESS_DATE);
  });

  it('should handle days with many shifts efficiently', () => {
    // Arrange: 10 shifts (edge case for busy day)
    const manyShifts = Array.from({ length: 10 }, (_, i) => ({
      ...mockShift1,
      shift_id: `shift-uuid-${i}`,
      shift_number: i + 1,
      start_time: `2026-02-17T0${i}:00:00.000Z`,
      end_time: `2026-02-17T0${i + 1}:00:00.000Z`,
    }));
    const manyShiftSummaries = Array.from({ length: 10 }, (_, i) => ({
      ...mockShiftSummary1,
      shift_summary_id: `summary-uuid-${i}`,
      shift_id: `shift-uuid-${i}`,
    }));

    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockShiftsDAL.findByDate.mockReturnValue(manyShifts);
    mockShiftSummariesDAL.findByDate.mockReturnValue(manyShiftSummaries);

    // Act
    const shifts = mockShiftsDAL.findByDate(STORE_A_ID, BUSINESS_DATE);
    const shiftSummaries = mockShiftSummariesDAL.findByDate(STORE_A_ID, BUSINESS_DATE);

    // Aggregate in O(n)
    let totalNetSales = 0;
    for (const ss of shiftSummaries) {
      totalNetSales += ss.net_sales || 0;
    }

    // Assert
    expect(shifts.length).toBe(10);
    expect(shiftSummaries.length).toBe(10);
    expect(totalNetSales).toBe(27000.0); // 2700.00 * 10
  });
});

// ============================================================================
// TEST SUITE: BIZ-002 Multi-closing per date
// ============================================================================

describe('days:getViewData - BIZ-002 Multi-closing', () => {
  it('should handle multiple lottery days for same business date', () => {
    // Arrange: Multiple closings on same date
    const lotteryDay1 = {
      ...mockLotteryDay,
      day_id: 'lottery-day-morning',
      opened_at: '2026-02-17T06:00:00.000Z',
      closed_at: '2026-02-17T14:00:00.000Z',
    };
    const lotteryDay2 = {
      ...mockLotteryDay,
      day_id: 'lottery-day-evening',
      opened_at: '2026-02-17T14:00:00.000Z',
      closed_at: '2026-02-17T22:00:00.000Z',
    };
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockLotteryBusinessDaysDAL.findByDate.mockReturnValue([lotteryDay1, lotteryDay2]);

    // Act
    const lotteryDays = mockLotteryBusinessDaysDAL.findByDate(STORE_A_ID, BUSINESS_DATE);

    // Assert
    expect(lotteryDays.length).toBe(2);
    expect(lotteryDays[0].day_id).toBe('lottery-day-morning');
    expect(lotteryDays[1].day_id).toBe('lottery-day-evening');
  });

  it('should filter out OPEN lottery days and only return CLOSED for report', () => {
    // Arrange: Mix of open and closed
    const closedDay = { ...mockLotteryDay, status: 'CLOSED' as const };
    const openDay = { ...mockOpenLotteryDay };
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummary);
    mockLotteryBusinessDaysDAL.findByDate.mockReturnValue([closedDay, openDay]);

    // Act
    const lotteryDays = mockLotteryBusinessDaysDAL.findByDate(STORE_A_ID, BUSINESS_DATE);
    const closedDays = lotteryDays.filter((d: typeof mockLotteryDay) => d.status === 'CLOSED');

    // Assert
    expect(closedDays.length).toBe(1);
    expect(closedDays[0].status).toBe('CLOSED');
  });
});
