/**
 * MSM Outside Dispenser Records DAL Unit Tests
 *
 * Enterprise-grade test suite for MSMOutsideDispenserRecordsDAL.
 * Validates outside fuel dispenser data storage from Period 98 MSM files.
 *
 * @module tests/unit/dal/msm-outside-dispenser-records.dal.spec
 * @security SEC-006: SQL injection prevention validation
 * @security DB-006: Tenant isolation validation
 *
 * Test Coverage Matrix:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ Category          │ Test IDs    │ Coverage                              │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ CREATE Operations │ MSMO-C-001  │ Basic record creation                 │
 * │                   │ MSMO-C-002  │ Both tender types supported           │
 * │                   │ MSMO-C-003  │ Invalid tender type rejection         │
 * │                   │ MSMO-C-004  │ Optional fields handling              │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ UPSERT Operations │ MSMO-U-001  │ Insert new record                     │
 * │                   │ MSMO-U-002  │ Skip existing duplicate               │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ QUERY Operations  │ MSMO-Q-001  │ Find by unique key                    │
 * │                   │ MSMO-Q-002  │ Find by business date                 │
 * │                   │ MSMO-Q-003  │ Find by register                      │
 * │                   │ MSMO-Q-004  │ Find by shift                         │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ AGGREGATION       │ MSMO-A-001  │ Daily totals by tender type           │
 * │                   │ MSMO-A-002  │ Shift totals by tender type           │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ DELETE Operations │ MSMO-D-001  │ Delete by source file hash            │
 * │                   │ MSMO-D-002  │ Delete all for store                  │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ SEC-006 Tests     │ MSMO-S-001  │ SQL injection prevention verified     │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ DB-006 Tests      │ MSMO-T-001  │ Store isolation in queries            │
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
  randomUUID: vi.fn(() => 'test-uuid-outside-001'),
}));

// ============================================================================
// Test Imports (after mocks)
// ============================================================================

import {
  MSMOutsideDispenserRecordsDAL,
  type CreateOutsideDispenserData,
  type OutsideTenderType,
} from '../../../src/main/dal/msm-outside-dispenser-records.dal';

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_STORE_ID = 'store-msmo-001';
const TEST_BUSINESS_DATE = '2025-01-15';
const TEST_SHIFT_ID = 'shift-msmo-001';
const TEST_REGISTER_ID = 'REG-01';
const TEST_TILL_ID = 'TILL-01';
const TEST_CASHIER_ID = 'CASHIER-001';
const TEST_FILE_HASH = 'hash-msmo-abc123';

/**
 * All valid tender types for comprehensive testing
 */
const ALL_TENDER_TYPES: OutsideTenderType[] = ['outsideCredit', 'outsideDebit'];

/**
 * Create test dispenser data
 */
function createTestDispenserData(
  overrides: Partial<CreateOutsideDispenserData> = {}
): CreateOutsideDispenserData {
  return {
    store_id: TEST_STORE_ID,
    business_date: TEST_BUSINESS_DATE,
    register_id: TEST_REGISTER_ID,
    tender_type: 'outsideCredit',
    amount: 1500.0,
    transaction_count: 25,
    shift_id: TEST_SHIFT_ID,
    till_id: TEST_TILL_ID,
    cashier_id: TEST_CASHIER_ID,
    source_file_hash: TEST_FILE_HASH,
    ...overrides,
  };
}

/**
 * Create mock dispenser record
 */
function createMockDispenserRecord(data: Partial<CreateOutsideDispenserData> = {}) {
  const testData = createTestDispenserData(data);
  return {
    outside_record_id: 'test-uuid-outside-001',
    ...testData,
    shift_id: testData.shift_id || null,
    till_id: testData.till_id || null,
    cashier_id: testData.cashier_id || null,
    transaction_count: testData.transaction_count || 0,
    source_file_hash: testData.source_file_hash || null,
    created_at: '2025-01-15T00:00:00.000Z',
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('MSMOutsideDispenserRecordsDAL', () => {
  let dal: MSMOutsideDispenserRecordsDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new MSMOutsideDispenserRecordsDAL();
  });

  // ==========================================================================
  // CREATE Operations
  // ==========================================================================

  describe('CREATE Operations', () => {
    it('MSMO-C-001: should create an outside dispenser record', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockRecord = createMockDispenserRecord();

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockRecord) });

      const data = createTestDispenserData();
      const result = dal.create(data);

      expect(result).toBeDefined();
      expect(result.outside_record_id).toBe('test-uuid-outside-001');
      expect(result.store_id).toBe(TEST_STORE_ID);
      expect(result.register_id).toBe(TEST_REGISTER_ID);
      expect(result.tender_type).toBe('outsideCredit');
      expect(result.amount).toBe(1500.0);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO msm_outside_dispenser_records')
      );
    });

    it('MSMO-C-002: should support both tender types', () => {
      ALL_TENDER_TYPES.forEach((tenderType) => {
        const mockRun = vi.fn().mockReturnValue({ changes: 1 });
        const mockRecord = createMockDispenserRecord({ tender_type: tenderType });

        mockPrepare
          .mockReturnValueOnce({ run: mockRun })
          .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockRecord) });

        const data = createTestDispenserData({ tender_type: tenderType });
        const result = dal.create(data);

        expect(result.tender_type).toBe(tenderType);
      });
    });

    it('MSMO-C-003: should reject invalid tender types', () => {
      const data = createTestDispenserData({
        tender_type: 'invalidTender' as OutsideTenderType,
      });

      expect(() => dal.create(data)).toThrow('Invalid tender type: invalidTender');
    });

    it('MSMO-C-004: should handle optional fields correctly', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockRecord = createMockDispenserRecord({
        shift_id: undefined,
        till_id: undefined,
        cashier_id: undefined,
        transaction_count: undefined,
        source_file_hash: undefined,
      });

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockRecord) });

      const data: CreateOutsideDispenserData = {
        store_id: TEST_STORE_ID,
        business_date: TEST_BUSINESS_DATE,
        register_id: TEST_REGISTER_ID,
        tender_type: 'outsideDebit',
        amount: 500.0,
      };

      const result = dal.create(data);

      expect(result.shift_id).toBeNull();
      expect(result.till_id).toBeNull();
      expect(result.cashier_id).toBeNull();
      expect(result.transaction_count).toBe(0);
      expect(result.source_file_hash).toBeNull();
    });
  });

  // ==========================================================================
  // UPSERT Operations
  // ==========================================================================

  describe('UPSERT Operations', () => {
    it('MSMO-U-001: should insert new record on upsert when no duplicate exists', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockRecord = createMockDispenserRecord();

      // First call: findByUniqueKey returns undefined
      mockPrepare.mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) });
      // Second call: INSERT
      mockPrepare.mockReturnValueOnce({ run: mockRun });
      // Third call: findById returns the new record
      mockPrepare.mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockRecord) });

      const data = createTestDispenserData();
      const result = dal.upsert(data);

      expect(result).toBeDefined();
      expect(result.outside_record_id).toBe('test-uuid-outside-001');
    });

    it('MSMO-U-002: should skip insert and return existing on duplicate', () => {
      const existingRecord = createMockDispenserRecord();

      // findByUniqueKey returns existing record
      mockPrepare.mockReturnValueOnce({ get: vi.fn().mockReturnValue(existingRecord) });

      const data = createTestDispenserData();
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
    it('MSMO-Q-001: should find by unique key', () => {
      const mockRecord = createMockDispenserRecord();
      mockPrepare.mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockRecord) });

      const result = dal.findByUniqueKey(
        TEST_STORE_ID,
        TEST_BUSINESS_DATE,
        TEST_REGISTER_ID,
        TEST_TILL_ID,
        'outsideCredit'
      );

      expect(result).toBeDefined();
      expect(result?.tender_type).toBe('outsideCredit');
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM msm_outside_dispenser_records')
      );
    });

    it('MSMO-Q-002: should find by business date', () => {
      const mockRecords = [
        createMockDispenserRecord({ tender_type: 'outsideCredit' }),
        createMockDispenserRecord({ tender_type: 'outsideDebit' }),
      ];
      mockPrepare.mockReturnValueOnce({ all: vi.fn().mockReturnValue(mockRecords) });

      const results = dal.findByBusinessDate(TEST_STORE_ID, TEST_BUSINESS_DATE);

      expect(results).toHaveLength(2);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE store_id = ? AND business_date = ?')
      );
    });

    it('MSMO-Q-003: should find by register', () => {
      const mockRecords = [createMockDispenserRecord()];
      mockPrepare.mockReturnValueOnce({ all: vi.fn().mockReturnValue(mockRecords) });

      const results = dal.findByRegister(TEST_STORE_ID, TEST_BUSINESS_DATE, TEST_REGISTER_ID);

      expect(results).toHaveLength(1);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE store_id = ? AND business_date = ? AND register_id = ?')
      );
    });

    it('MSMO-Q-004: should find by shift', () => {
      const mockRecords = [createMockDispenserRecord({ shift_id: TEST_SHIFT_ID })];
      mockPrepare.mockReturnValueOnce({ all: vi.fn().mockReturnValue(mockRecords) });

      const results = dal.findByShift(TEST_STORE_ID, TEST_SHIFT_ID);

      expect(results).toHaveLength(1);
      expect(results[0].shift_id).toBe(TEST_SHIFT_ID);
    });
  });

  // ==========================================================================
  // AGGREGATION Operations
  // ==========================================================================

  describe('AGGREGATION Operations', () => {
    it('MSMO-A-001: should calculate daily totals by tender type', () => {
      const mockTotals = {
        credit_amount: 1750.0,
        credit_count: 35,
        debit_amount: 500.0,
        debit_count: 10,
        total_amount: 2250.0,
        total_count: 45,
      };
      mockPrepare.mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockTotals) });

      const totals = dal.getDailyTotals(TEST_STORE_ID, TEST_BUSINESS_DATE);

      expect(totals.creditAmount).toBe(1750.0);
      expect(totals.creditCount).toBe(35);
      expect(totals.debitAmount).toBe(500.0);
      expect(totals.debitCount).toBe(10);
      expect(totals.totalAmount).toBe(2250.0);
      expect(totals.totalCount).toBe(45);
    });

    it('MSMO-A-002: should calculate shift totals by tender type', () => {
      const mockTotals = {
        credit_amount: 1000.0,
        credit_count: 20,
        debit_amount: 300.0,
        debit_count: 5,
        total_amount: 1300.0,
        total_count: 25,
      };
      mockPrepare.mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockTotals) });

      const totals = dal.getShiftTotals(TEST_STORE_ID, TEST_SHIFT_ID);

      expect(totals.creditAmount).toBe(1000.0);
      expect(totals.creditCount).toBe(20);
      expect(totals.debitAmount).toBe(300.0);
      expect(totals.debitCount).toBe(5);
    });
  });

  // ==========================================================================
  // DELETE Operations
  // ==========================================================================

  describe('DELETE Operations', () => {
    it('MSMO-D-001: should delete by source file hash', () => {
      mockPrepare.mockReturnValueOnce({
        run: vi.fn().mockReturnValue({ changes: 2 }),
      });

      const deleted = dal.deleteBySourceFileHash('hash-a');

      expect(deleted).toBe(2);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining(
          'DELETE FROM msm_outside_dispenser_records WHERE source_file_hash = ?'
        )
      );
    });

    it('MSMO-D-002: should delete all for store', () => {
      mockPrepare.mockReturnValueOnce({
        run: vi.fn().mockReturnValue({ changes: 5 }),
      });

      const deleted = dal.deleteAllForStore(TEST_STORE_ID);

      expect(deleted).toBe(5);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM msm_outside_dispenser_records WHERE store_id = ?')
      );
    });
  });

  // ==========================================================================
  // SEC-006: SQL Injection Prevention
  // ==========================================================================

  describe('SEC-006: SQL Injection Prevention', () => {
    it('MSMO-S-001: should use parameterized queries for all operations', () => {
      mockPrepare.mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) });

      dal.findByBusinessDate("'; DROP TABLE msm_outside_dispenser_records; --", TEST_BUSINESS_DATE);

      // Verify the SQL query uses ? placeholders, not string interpolation
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringMatching(/WHERE store_id = \? AND business_date = \?/)
      );
    });

    it('MSMO-S-002: should reject invalid tender types at application layer', () => {
      const sqlInjectionPayload = "'; DROP TABLE msm_outside_dispenser_records; --";

      expect(() => {
        dal.create(
          createTestDispenserData({
            tender_type: sqlInjectionPayload as OutsideTenderType,
          })
        );
      }).toThrow(/Invalid tender type/);
    });
  });

  // ==========================================================================
  // DB-006: Tenant Isolation
  // ==========================================================================

  describe('DB-006: Tenant Isolation', () => {
    it('MSMO-T-001: should always include store_id in queries', () => {
      mockPrepare.mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) });

      dal.findByBusinessDate(TEST_STORE_ID, TEST_BUSINESS_DATE);

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('store_id = ?'));
    });

    it('MSMO-T-002: should pass store_id as first parameter', () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValueOnce({ all: mockAll });

      dal.findByBusinessDate(TEST_STORE_ID, TEST_BUSINESS_DATE);

      expect(mockAll).toHaveBeenCalledWith(TEST_STORE_ID, TEST_BUSINESS_DATE);
    });
  });
});
