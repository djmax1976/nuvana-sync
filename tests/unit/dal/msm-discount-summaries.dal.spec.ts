/**
 * MSM Discount Summaries DAL Unit Tests
 *
 * Enterprise-grade test suite for MSMDiscountSummariesDAL.
 * Validates discount data storage from MiscellaneousSummaryMovement (MSM) files.
 *
 * @module tests/unit/dal/msm-discount-summaries.dal.spec
 * @security SEC-006: SQL injection prevention validation
 * @security DB-006: Tenant isolation validation
 *
 * Test Coverage Matrix:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ Category          │ Test IDs    │ Coverage                              │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ CREATE Operations │ MSMD-C-001  │ Basic discount creation               │
 * │                   │ MSMD-C-002  │ All discount types supported          │
 * │                   │ MSMD-C-003  │ Invalid discount type rejection       │
 * │                   │ MSMD-C-004  │ Optional fields handling              │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ UPSERT Operations │ MSMD-U-001  │ Insert new record                     │
 * │                   │ MSMD-U-002  │ Skip existing duplicate               │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ QUERY Operations  │ MSMD-Q-001  │ Find by unique key                    │
 * │                   │ MSMD-Q-002  │ Find by business date                 │
 * │                   │ MSMD-Q-003  │ Find by shift                         │
 * │                   │ MSMD-Q-004  │ Get fuel discount                     │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ AGGREGATION       │ MSMD-A-001  │ Daily totals by discount type         │
 * │                   │ MSMD-A-002  │ Zero values for missing data          │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ DELETE Operations │ MSMD-D-001  │ Delete by source file hash            │
 * │                   │ MSMD-D-002  │ Delete all for store                  │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ SEC-006 Tests     │ MSMD-S-001  │ SQL injection prevention verified     │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ DB-006 Tests      │ MSMD-T-001  │ Store isolation in queries            │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

// Uses vitest globals (configured in vitest.config.ts)

// ============================================================================
// Mocks - Must be before any imports that use them
// Use vi.hoisted() to ensure mock functions are available when vi.mock runs
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
// ============================================================================

const { mockPrepare, mockExec } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockExec: vi.fn(),
}));

vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    exec: mockExec,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-discount-001'),
}));

// ============================================================================
// Test Imports (after mocks)
// ============================================================================

import {
  MSMDiscountSummariesDAL,
  type CreateMSMDiscountData,
  type MSMDiscountType,
} from '../../../src/main/dal/msm-discount-summaries.dal';

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_STORE_ID = 'store-msmd-001';
const _OTHER_STORE_ID = 'store-msmd-002';
const TEST_BUSINESS_DATE = '2025-01-15';
const TEST_SHIFT_ID = 'shift-msmd-001';
const TEST_FILE_HASH = 'hash-msmd-abc123';

/**
 * All valid discount types for comprehensive testing
 */
const ALL_DISCOUNT_TYPES: MSMDiscountType[] = [
  'statistics_discounts',
  'discount_amount_fixed',
  'discount_amount_percentage',
  'discount_promotional',
  'discount_fuel',
  'discount_store_coupons',
];

/**
 * Create test discount data
 */
function createTestDiscountData(
  overrides: Partial<CreateMSMDiscountData> = {}
): CreateMSMDiscountData {
  return {
    store_id: TEST_STORE_ID,
    business_date: TEST_BUSINESS_DATE,
    msm_period: 1,
    discount_type: 'discount_fuel',
    discount_amount: 125.5,
    discount_count: 15,
    source_file_hash: TEST_FILE_HASH,
    ...overrides,
  };
}

/**
 * Create mock discount record
 */
function createMockDiscountRecord(data: Partial<CreateMSMDiscountData> = {}) {
  const testData = createTestDiscountData(data);
  return {
    msm_discount_id: 'test-uuid-discount-001',
    ...testData,
    shift_id: testData.shift_id || null,
    discount_count: testData.discount_count || 0,
    source_file_hash: testData.source_file_hash || null,
    created_at: '2025-01-15T00:00:00.000Z',
    updated_at: '2025-01-15T00:00:00.000Z',
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('MSMDiscountSummariesDAL', () => {
  let dal: MSMDiscountSummariesDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new MSMDiscountSummariesDAL();
  });

  // ==========================================================================
  // CREATE Operations
  // ==========================================================================

  describe('CREATE Operations', () => {
    it('MSMD-C-001: should create a discount summary record', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockRecord = createMockDiscountRecord();

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockRecord) });

      const data = createTestDiscountData();
      const result = dal.create(data);

      expect(result).toBeDefined();
      expect(result.msm_discount_id).toBe('test-uuid-discount-001');
      expect(result.store_id).toBe(TEST_STORE_ID);
      expect(result.discount_type).toBe('discount_fuel');
      expect(result.discount_amount).toBe(125.5);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO msm_discount_summaries')
      );
    });

    it('MSMD-C-002: should support all valid discount types', () => {
      ALL_DISCOUNT_TYPES.forEach((discountType) => {
        const mockRun = vi.fn().mockReturnValue({ changes: 1 });
        const mockRecord = createMockDiscountRecord({ discount_type: discountType });

        mockPrepare
          .mockReturnValueOnce({ run: mockRun })
          .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockRecord) });

        const data = createTestDiscountData({ discount_type: discountType });
        const result = dal.create(data);

        expect(result.discount_type).toBe(discountType);
      });
    });

    it('MSMD-C-003: should reject invalid discount types', () => {
      const data = createTestDiscountData({
        discount_type: 'invalid_type' as MSMDiscountType,
      });

      expect(() => dal.create(data)).toThrow('Invalid discount type: invalid_type');
    });

    it('MSMD-C-004: should handle optional fields correctly', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockRecord = createMockDiscountRecord({
        shift_id: undefined,
        discount_count: undefined,
        source_file_hash: undefined,
      });

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockRecord) });

      const data: CreateMSMDiscountData = {
        store_id: TEST_STORE_ID,
        business_date: TEST_BUSINESS_DATE,
        msm_period: 1,
        discount_type: 'statistics_discounts',
        discount_amount: 50.0,
      };

      const result = dal.create(data);

      expect(result.shift_id).toBeNull();
      expect(result.discount_count).toBe(0);
      expect(result.source_file_hash).toBeNull();
    });
  });

  // ==========================================================================
  // UPSERT Operations
  // ==========================================================================

  describe('UPSERT Operations', () => {
    it('MSMD-U-001: should insert new record on upsert when no duplicate exists', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockRecord = createMockDiscountRecord();

      // First call: findByUniqueKey returns undefined
      mockPrepare.mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) });
      // Second call: INSERT
      mockPrepare.mockReturnValueOnce({ run: mockRun });
      // Third call: findById returns the new record
      mockPrepare.mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockRecord) });

      const data = createTestDiscountData();
      const result = dal.upsert(data);

      expect(result).toBeDefined();
      expect(result.msm_discount_id).toBe('test-uuid-discount-001');
    });

    it('MSMD-U-002: should skip insert and return existing on duplicate', () => {
      const existingRecord = createMockDiscountRecord();

      // findByUniqueKey returns existing record
      mockPrepare.mockReturnValueOnce({ get: vi.fn().mockReturnValue(existingRecord) });

      const data = createTestDiscountData();
      const result = dal.upsert(data);

      expect(result).toEqual(existingRecord);
      // Should only have called prepare once (for findByUniqueKey)
      expect(mockPrepare).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // QUERY Operations
  // ==========================================================================

  describe('QUERY Operations', () => {
    it('MSMD-Q-001: should find by unique key', () => {
      const mockRecord = createMockDiscountRecord();
      mockPrepare.mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockRecord) });

      const result = dal.findByUniqueKey(
        TEST_STORE_ID,
        TEST_BUSINESS_DATE,
        1,
        null,
        'discount_fuel'
      );

      expect(result).toBeDefined();
      expect(result?.discount_type).toBe('discount_fuel');
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM msm_discount_summaries')
      );
    });

    it('MSMD-Q-002: should find by business date', () => {
      const mockRecords = [
        createMockDiscountRecord({ discount_type: 'discount_fuel' }),
        createMockDiscountRecord({ discount_type: 'statistics_discounts' }),
      ];
      mockPrepare.mockReturnValueOnce({ all: vi.fn().mockReturnValue(mockRecords) });

      const results = dal.findByBusinessDate(TEST_STORE_ID, TEST_BUSINESS_DATE);

      expect(results).toHaveLength(2);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE store_id = ? AND business_date = ?')
      );
    });

    it('MSMD-Q-003: should find by shift', () => {
      const mockRecords = [createMockDiscountRecord({ shift_id: TEST_SHIFT_ID })];
      mockPrepare.mockReturnValueOnce({ all: vi.fn().mockReturnValue(mockRecords) });

      const results = dal.findByShift(TEST_STORE_ID, TEST_SHIFT_ID);

      expect(results).toHaveLength(1);
      expect(results[0].shift_id).toBe(TEST_SHIFT_ID);
    });

    it('MSMD-Q-004: should get fuel discount amount', () => {
      mockPrepare.mockReturnValueOnce({
        get: vi.fn().mockReturnValue({ fuel_discount: 150.0 }),
      });

      const result = dal.getFuelDiscount(TEST_STORE_ID, TEST_BUSINESS_DATE);

      expect(result).toBe(150.0);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("discount_type = 'discount_fuel'")
      );
    });
  });

  // ==========================================================================
  // AGGREGATION Operations
  // ==========================================================================

  describe('AGGREGATION Operations', () => {
    it('MSMD-A-001: should calculate daily totals by discount type', () => {
      const mockTotals = {
        statistics_discounts: 100.0,
        amount_fixed: 50.0,
        amount_percentage: 75.0,
        promotional: 200.0,
        fuel: 150.0,
        store_coupons: 25.0,
        total_amount: 600.0,
        total_count: 30,
      };
      mockPrepare.mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockTotals) });

      const totals = dal.getDailyTotals(TEST_STORE_ID, TEST_BUSINESS_DATE);

      expect(totals.statisticsDiscounts).toBe(100.0);
      expect(totals.amountFixed).toBe(50.0);
      expect(totals.amountPercentage).toBe(75.0);
      expect(totals.promotional).toBe(200.0);
      expect(totals.fuel).toBe(150.0);
      expect(totals.storeCoupons).toBe(25.0);
      expect(totals.totalAmount).toBe(600.0);
      expect(totals.totalCount).toBe(30);
    });

    it('MSMD-A-002: should return zero values for missing data', () => {
      const mockTotals = {
        statistics_discounts: 0,
        amount_fixed: 0,
        amount_percentage: 0,
        promotional: 0,
        fuel: 0,
        store_coupons: 0,
        total_amount: 0,
        total_count: 0,
      };
      mockPrepare.mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockTotals) });

      const totals = dal.getDailyTotals(TEST_STORE_ID, '2099-12-31');

      expect(totals.totalAmount).toBe(0);
      expect(totals.totalCount).toBe(0);
    });
  });

  // ==========================================================================
  // DELETE Operations
  // ==========================================================================

  describe('DELETE Operations', () => {
    it('MSMD-D-001: should delete by source file hash', () => {
      mockPrepare.mockReturnValueOnce({
        run: vi.fn().mockReturnValue({ changes: 2 }),
      });

      const deleted = dal.deleteBySourceFileHash('hash-a');

      expect(deleted).toBe(2);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM msm_discount_summaries WHERE source_file_hash = ?')
      );
    });

    it('MSMD-D-002: should delete all for store', () => {
      mockPrepare.mockReturnValueOnce({
        run: vi.fn().mockReturnValue({ changes: 5 }),
      });

      const deleted = dal.deleteAllForStore(TEST_STORE_ID);

      expect(deleted).toBe(5);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM msm_discount_summaries WHERE store_id = ?')
      );
    });
  });

  // ==========================================================================
  // SEC-006: SQL Injection Prevention
  // ==========================================================================

  describe('SEC-006: SQL Injection Prevention', () => {
    it('MSMD-S-001: should use parameterized queries for all operations', () => {
      // Test findByBusinessDate uses prepared statement
      mockPrepare.mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) });

      dal.findByBusinessDate("'; DROP TABLE msm_discount_summaries; --", TEST_BUSINESS_DATE);

      // Verify the SQL query uses ? placeholders, not string interpolation
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringMatching(/WHERE store_id = \? AND business_date = \?/)
      );
    });

    it('MSMD-S-002: should reject invalid discount types at application layer', () => {
      const sqlInjectionPayload = "'; DROP TABLE msm_discount_summaries; --";

      expect(() => {
        dal.create(
          createTestDiscountData({
            discount_type: sqlInjectionPayload as MSMDiscountType,
          })
        );
      }).toThrow(/Invalid discount type/);
    });
  });

  // ==========================================================================
  // DB-006: Tenant Isolation
  // ==========================================================================

  describe('DB-006: Tenant Isolation', () => {
    it('MSMD-T-001: should always include store_id in queries', () => {
      mockPrepare.mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) });

      dal.findByBusinessDate(TEST_STORE_ID, TEST_BUSINESS_DATE);

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('store_id = ?'));
    });

    it('MSMD-T-002: should pass store_id as first parameter', () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValueOnce({ all: mockAll });

      dal.findByBusinessDate(TEST_STORE_ID, TEST_BUSINESS_DATE);

      expect(mockAll).toHaveBeenCalledWith(TEST_STORE_ID, TEST_BUSINESS_DATE);
    });
  });
});
