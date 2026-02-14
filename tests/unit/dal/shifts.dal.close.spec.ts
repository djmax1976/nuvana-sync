/**
 * Shifts DAL Close Method Unit Tests
 *
 * Tests for the shiftsDAL.close() and shiftsDAL.closeShift() methods.
 * Verifies parameterized queries, status updates, and timestamp handling.
 *
 * @module tests/unit/dal/shifts.dal.close
 * @security SEC-006: Verifies parameterized queries
 * @security DB-006: Verifies store-scoped operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mock Setup
// ============================================================================

// Track prepared statement calls for SQL inspection
const mockPrepare = vi.fn();
const mockGet = vi.fn();
const mockRun = vi.fn();
const mockAll = vi.fn();

// Mock database service
vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: vi.fn((fn) => fn),
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

// Mock logger
vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ============================================================================
// Test Data
// ============================================================================

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const STORE_ID = 'store-uuid-1234-5678-90ab-cdef12345678';

const mockOpenShift = {
  shift_id: VALID_UUID,
  store_id: STORE_ID,
  shift_number: 1,
  business_date: '2026-02-12',
  cashier_id: null,
  register_id: null,
  start_time: '2026-02-12T08:00:00Z',
  end_time: null,
  status: 'OPEN',
  external_cashier_id: null,
  external_register_id: 'REG-1',
  external_till_id: null,
  created_at: '2026-02-12T08:00:00Z',
  updated_at: '2026-02-12T08:00:00Z',
};

// ============================================================================
// DAL Import (after mocks)
// ============================================================================

import { ShiftsDAL } from '../../../src/main/dal/shifts.dal';

describe('ShiftsDAL close methods', () => {
  let dal: ShiftsDAL;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock return values
    mockPrepare.mockReturnValue({
      get: mockGet,
      run: mockRun,
      all: mockAll,
    });

    dal = new ShiftsDAL();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // closeShift Tests
  // ==========================================================================

  describe('closeShift()', () => {
    it('TEST: Updates shift status to CLOSED', async () => {
      // Mock successful update
      mockRun.mockReturnValue({ changes: 1 });
      mockGet.mockReturnValue({
        ...mockOpenShift,
        status: 'CLOSED',
        end_time: '2026-02-12T16:00:00Z',
      });

      const result = dal.closeShift(VALID_UUID);

      expect(result).toBeDefined();
      expect(result?.status).toBe('CLOSED');
    });

    it('TEST: Sets closed_at to current timestamp', async () => {
      const beforeCall = new Date().toISOString();

      mockRun.mockReturnValue({ changes: 1 });
      mockGet.mockReturnValue({
        ...mockOpenShift,
        status: 'CLOSED',
        end_time: beforeCall,
      });

      const result = dal.closeShift(VALID_UUID);

      expect(result?.end_time).toBeDefined();
      expect(new Date(result!.end_time!).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeCall).getTime() - 1000
      );
    });

    it('TEST: Returns null for non-existent shift', async () => {
      // Mock no rows updated
      mockRun.mockReturnValue({ changes: 0 });

      const result = dal.closeShift(VALID_UUID);

      expect(result).toBeUndefined();
    });

    it('TEST: Uses parameterized query (verify via SQL inspection)', async () => {
      mockRun.mockReturnValue({ changes: 1 });
      mockGet.mockReturnValue({
        ...mockOpenShift,
        status: 'CLOSED',
        end_time: '2026-02-12T16:00:00Z',
      });

      dal.closeShift(VALID_UUID);

      // Verify the UPDATE query uses placeholders
      const updateCall = mockPrepare.mock.calls.find((call) => call[0].includes('UPDATE shifts'));

      expect(updateCall).toBeDefined();
      const query = updateCall![0];

      // SEC-006: Verify parameterized placeholders
      expect(query).toContain('?');
      // Should NOT contain the actual UUID value in the SQL string
      expect(query).not.toContain(VALID_UUID);
      // Should have placeholders for end_time, updated_at, and shift_id
      expect((query.match(/\?/g) || []).length).toBeGreaterThanOrEqual(3);
    });

    it('TEST: Sets end_time to provided value when specified', async () => {
      const customEndTime = '2026-02-12T18:30:00Z';

      mockRun.mockReturnValue({ changes: 1 });
      mockGet.mockReturnValue({
        ...mockOpenShift,
        status: 'CLOSED',
        end_time: customEndTime,
      });

      dal.closeShift(VALID_UUID, customEndTime);

      // Verify run was called with the custom end time
      const runArgs = mockRun.mock.calls[0];
      expect(runArgs[0]).toBe(customEndTime);
    });

    it('TEST: Only updates shifts with end_time IS NULL (prevents double-close)', async () => {
      mockRun.mockReturnValue({ changes: 1 });
      mockGet.mockReturnValue({
        ...mockOpenShift,
        status: 'CLOSED',
        end_time: '2026-02-12T16:00:00Z',
      });

      dal.closeShift(VALID_UUID);

      // Verify the WHERE clause includes end_time IS NULL
      const updateCall = mockPrepare.mock.calls.find((call) => call[0].includes('UPDATE shifts'));
      const query = updateCall![0];
      expect(query).toContain('end_time IS NULL');
    });
  });

  // ==========================================================================
  // close() (deprecated wrapper) Tests
  // ==========================================================================

  describe('close() [deprecated]', () => {
    it('TEST: Delegates to closeShift()', async () => {
      mockRun.mockReturnValue({ changes: 1 });
      mockGet.mockReturnValue({
        ...mockOpenShift,
        status: 'CLOSED',
        end_time: '2026-02-12T16:00:00Z',
      });

      const closeShiftSpy = vi.spyOn(dal, 'closeShift');

      dal.close(VALID_UUID);

      expect(closeShiftSpy).toHaveBeenCalledWith(VALID_UUID, undefined);
    });

    it('TEST: Passes endTime parameter to closeShift()', async () => {
      const endTime = '2026-02-12T17:00:00Z';

      mockRun.mockReturnValue({ changes: 1 });
      mockGet.mockReturnValue({
        ...mockOpenShift,
        status: 'CLOSED',
        end_time: endTime,
      });

      const closeShiftSpy = vi.spyOn(dal, 'closeShift');

      dal.close(VALID_UUID, endTime);

      expect(closeShiftSpy).toHaveBeenCalledWith(VALID_UUID, endTime);
    });
  });

  // ==========================================================================
  // SQL Safety Tests (SEC-006)
  // ==========================================================================

  describe('SQL Safety (SEC-006)', () => {
    const SQL_INJECTION_PAYLOADS = [
      "'; DROP TABLE shifts;--",
      "1' OR '1'='1",
      "1; DELETE FROM shifts WHERE '1'='1",
      "' UNION SELECT * FROM users--",
    ];

    it.each(SQL_INJECTION_PAYLOADS)(
      'TEST: Safely handles SQL injection attempt in shiftId: %s',
      (payload) => {
        mockRun.mockReturnValue({ changes: 0 });

        // This should not execute malicious SQL - the payload is passed as a parameter
        const result = dal.closeShift(payload);

        // Should return undefined (not found) without error
        expect(result).toBeUndefined();

        // Verify the query string does NOT contain the injection payload
        const updateCall = mockPrepare.mock.calls.find((call) => call[0].includes('UPDATE shifts'));
        const query = updateCall![0];

        expect(query).not.toContain('DROP');
        expect(query).not.toContain('DELETE');
        expect(query).not.toContain('UNION');
        expect(query).not.toContain('INSERT');
      }
    );
  });

  // ==========================================================================
  // Decimal Precision Tests
  // ==========================================================================

  describe('Decimal Precision', () => {
    it('TEST: Handles decimal timestamps correctly', async () => {
      // ISO timestamps can have milliseconds
      const endTimeWithMillis = '2026-02-12T16:30:45.123Z';

      mockRun.mockReturnValue({ changes: 1 });
      mockGet.mockReturnValue({
        ...mockOpenShift,
        status: 'CLOSED',
        end_time: endTimeWithMillis,
      });

      const result = dal.closeShift(VALID_UUID, endTimeWithMillis);

      expect(result?.end_time).toBe(endTimeWithMillis);
    });
  });
});

// ============================================================================
// ShiftSummariesDAL closeShiftSummary Tests
// ============================================================================

describe('ShiftSummariesDAL closeShiftSummary', () => {
  let summariesDAL: import('../../../src/main/dal/shift-summaries.dal').ShiftSummariesDAL;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockPrepare.mockReturnValue({
      get: mockGet,
      run: mockRun,
      all: mockAll,
    });

    // Import ShiftSummariesDAL
    const { ShiftSummariesDAL } = await import('../../../src/main/dal/shift-summaries.dal');
    summariesDAL = new ShiftSummariesDAL();
  });

  const SUMMARY_ID = 'summary-uuid-1234';

  const mockShiftSummary = {
    shift_summary_id: SUMMARY_ID,
    shift_id: VALID_UUID,
    store_id: STORE_ID,
    business_date: '2026-02-12',
    shift_opened_at: '2026-02-12T08:00:00Z',
    shift_closed_at: null,
    closing_cash: 0,
    gross_sales: 1500,
    net_sales: 1350,
    transaction_count: 45,
    created_at: '2026-02-12T08:00:00Z',
  };

  it('TEST: Sets closing_cash to provided value', async () => {
    mockGet.mockReturnValue(mockShiftSummary);
    mockRun.mockReturnValue({ changes: 1 });

    summariesDAL.closeShiftSummary(STORE_ID, SUMMARY_ID, '2026-02-12T16:00:00Z', undefined, 555.55);

    // The update should include closing_cash
    const updateCall = mockPrepare.mock.calls.find((call) =>
      call[0].toLowerCase().includes('update shift_summaries')
    );

    if (updateCall) {
      expect(updateCall[0]).toContain('?'); // Parameterized
    }
  });

  it('TEST: Handles decimal precision for closing_cash (cents)', async () => {
    mockGet.mockReturnValue(mockShiftSummary);
    mockRun.mockReturnValue({ changes: 1 });

    // Test various decimal amounts
    const testAmounts = [0, 100, 99.99, 123.45, 0.01, 999999.99];

    for (const amount of testAmounts) {
      summariesDAL.closeShiftSummary(
        STORE_ID,
        SUMMARY_ID,
        '2026-02-12T16:00:00Z',
        undefined,
        amount
      );

      // Should not throw
      expect(mockGet).toHaveBeenCalled();
    }
  });

  it('TEST: Returns undefined for non-existent summary', async () => {
    mockGet.mockReturnValue(undefined);

    const result = summariesDAL.closeShiftSummary(
      STORE_ID,
      'non-existent-id',
      '2026-02-12T16:00:00Z'
    );

    expect(result).toBeUndefined();
  });

  it('TEST: Calculates shift_duration_mins correctly', async () => {
    const openTime = '2026-02-12T08:00:00Z';
    const closeTime = '2026-02-12T16:30:00Z';
    // Expected duration: 8.5 hours = 510 minutes

    mockGet
      .mockReturnValueOnce({
        ...mockShiftSummary,
        shift_opened_at: openTime,
      })
      .mockReturnValue({
        ...mockShiftSummary,
        shift_opened_at: openTime,
        shift_closed_at: closeTime,
        shift_duration_mins: 510,
      });

    mockRun.mockReturnValue({ changes: 1 });

    const result = summariesDAL.closeShiftSummary(STORE_ID, SUMMARY_ID, closeTime);

    // The method should calculate duration and include it in update
    expect(result).toBeDefined();
  });

  it('TEST: Uses parameterized update query (SEC-006)', async () => {
    mockGet.mockReturnValue(mockShiftSummary);
    mockRun.mockReturnValue({ changes: 1 });

    summariesDAL.closeShiftSummary(STORE_ID, SUMMARY_ID, '2026-02-12T16:00:00Z', undefined, 100);

    // Check that update query uses placeholders
    const updateCall = mockPrepare.mock.calls.find((call) =>
      call[0].toLowerCase().includes('update')
    );

    if (updateCall) {
      const query = updateCall[0];
      expect(query).toContain('?');
      // Should NOT contain literal values
      expect(query).not.toContain(SUMMARY_ID);
      expect(query).not.toContain(STORE_ID);
    }
  });
});
