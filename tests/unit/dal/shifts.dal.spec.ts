/**
 * Shifts DAL Unit Tests
 *
 * @module tests/unit/dal/shifts.dal.spec
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
    randomUUID: vi.fn().mockReturnValue('mock-shift-uuid'),
  };
});

import { ShiftsDAL, type Shift, type ShiftStatus } from '../../../src/main/dal/shifts.dal';

describe('ShiftsDAL', () => {
  let dal: ShiftsDAL;

  const mockShift: Shift = {
    shift_id: 'shift-123',
    store_id: 'store-456',
    shift_number: 1,
    business_date: '2024-01-15',
    cashier_id: 'cashier-789',
    register_id: 'register-001',
    start_time: '2024-01-15T08:00:00.000Z',
    end_time: null,
    status: 'OPEN' as ShiftStatus,
    external_cashier_id: null,
    external_register_id: null,
    external_till_id: null,
    created_at: '2024-01-15T08:00:00.000Z',
    updated_at: '2024-01-15T08:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new ShiftsDAL();
  });

  // ==========================================================================
  // CREATE TESTS
  // ==========================================================================

  describe('create', () => {
    it('should create shift with all required fields', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockShift) });

      const result = dal.create({
        store_id: 'store-456',
        shift_number: 1,
        business_date: '2024-01-15',
        cashier_id: 'cashier-789',
        register_id: 'register-001',
      });

      expect(result).toEqual(mockShift);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO shifts'));
      // SEC-006: Verify parameterized query (uses ?)
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('?'));
    });

    it('should use provided shift_id when given', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockShift) });

      dal.create({
        shift_id: 'custom-shift-id',
        store_id: 'store-456',
        shift_number: 1,
        business_date: '2024-01-15',
      });

      // Verify custom shift_id was used (first parameter)
      expect(mockRun).toHaveBeenCalled();
      const callArgs = mockRun.mock.calls[0];
      expect(callArgs[0]).toBe('custom-shift-id');
      expect(callArgs[1]).toBe('store-456');
      expect(callArgs[2]).toBe(1);
      expect(callArgs[3]).toBe('2024-01-15');
    });

    it('should generate UUID when shift_id not provided', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({
        get: vi.fn().mockReturnValue({ ...mockShift, shift_id: 'mock-shift-uuid' }),
      });

      dal.create({
        store_id: 'store-456',
        shift_number: 1,
        business_date: '2024-01-15',
      });

      // Verify generated UUID was used (from mocked uuid.v4)
      expect(mockRun).toHaveBeenCalled();
      const callArgs = mockRun.mock.calls[0];
      expect(callArgs[0]).toBe('mock-shift-uuid');
      expect(callArgs[1]).toBe('store-456');
      expect(callArgs[2]).toBe(1);
      expect(callArgs[3]).toBe('2024-01-15');
    });

    it('should set status to OPEN by default', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ ...mockShift, status: 'OPEN' }) });

      const result = dal.create({
        store_id: 'store-456',
        shift_number: 1,
        business_date: '2024-01-15',
      });

      expect(result.status).toBe('OPEN');
    });

    it('should throw error if created shift cannot be retrieved', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) });

      expect(() =>
        dal.create({
          store_id: 'store-456',
          shift_number: 1,
          business_date: '2024-01-15',
        })
      ).toThrow('Failed to retrieve created shift');
    });
  });

  // ==========================================================================
  // UPDATE TESTS
  // ==========================================================================

  describe('update', () => {
    it('should update shift fields', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const updatedShift = { ...mockShift, cashier_id: 'new-cashier' };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(updatedShift) });

      const result = dal.update('shift-123', { cashier_id: 'new-cashier' });

      expect(result?.cashier_id).toBe('new-cashier');
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE shifts SET'));
    });

    it('should return undefined for non-existent shift', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      const result = dal.update('nonexistent', { cashier_id: 'new-cashier' });

      expect(result).toBeUndefined();
    });

    it('should update multiple fields at once', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const updatedShift = {
        ...mockShift,
        cashier_id: 'new-cashier',
        register_id: 'new-register',
        status: 'CLOSED' as ShiftStatus,
      };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(updatedShift) });

      const result = dal.update('shift-123', {
        cashier_id: 'new-cashier',
        register_id: 'new-register',
        status: 'CLOSED',
      });

      expect(result?.cashier_id).toBe('new-cashier');
      expect(result?.register_id).toBe('new-register');
      expect(result?.status).toBe('CLOSED');
    });

    it('should allow setting cashier_id to null', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const updatedShift = { ...mockShift, cashier_id: null };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(updatedShift) });

      const result = dal.update('shift-123', { cashier_id: null });

      expect(result?.cashier_id).toBeNull();
    });
  });

  // ==========================================================================
  // CLOSE TESTS
  // ==========================================================================

  describe('close', () => {
    it('should close shift with current time', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const closedShift = {
        ...mockShift,
        status: 'CLOSED' as ShiftStatus,
        end_time: '2024-01-15T16:00:00.000Z',
      };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(closedShift) });

      const result = dal.close('shift-123');

      expect(result?.status).toBe('CLOSED');
      expect(result?.end_time).toBeTruthy();
    });

    it('should close shift with provided end time', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const customEndTime = '2024-01-15T18:30:00.000Z';
      const closedShift = {
        ...mockShift,
        status: 'CLOSED' as ShiftStatus,
        end_time: customEndTime,
      };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(closedShift) });

      const result = dal.close('shift-123', customEndTime);

      expect(result?.end_time).toBe(customEndTime);
    });

    it('should return undefined for non-existent shift', () => {
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
    it('should return shifts for specific store and date', () => {
      const shifts = [mockShift, { ...mockShift, shift_id: 'shift-456', shift_number: 2 }];
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(shifts),
      });

      const result = dal.findByDate('store-456', '2024-01-15');

      expect(result).toHaveLength(2);
      // DB-006: Verify store_id is in query
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('store_id = ?'));
    });

    it('should return empty array when no shifts found', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const result = dal.findByDate('store-456', '2024-01-20');

      expect(result).toEqual([]);
    });

    it('should order shifts by shift_number ascending', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.findByDate('store-456', '2024-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY shift_number ASC')
      );
    });
  });

  // ==========================================================================
  // FIND BY DATE RANGE TESTS
  // ==========================================================================

  describe('findByDateRange', () => {
    it('should return shifts within date range', () => {
      const shifts = [
        { ...mockShift, business_date: '2024-01-15' },
        { ...mockShift, shift_id: 'shift-456', business_date: '2024-01-16' },
      ];
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(shifts),
      });

      const result = dal.findByDateRange('store-456', '2024-01-15', '2024-01-20');

      expect(result).toHaveLength(2);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('business_date >= ? AND business_date <= ?')
      );
    });

    it('should order by date and shift number', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.findByDateRange('store-456', '2024-01-15', '2024-01-20');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY business_date ASC, shift_number ASC')
      );
    });
  });

  // ==========================================================================
  // GET OPEN SHIFT TESTS
  // ==========================================================================

  describe('getOpenShift', () => {
    it('should return currently open shift', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockShift),
      });

      const result = dal.getOpenShift('store-456');

      expect(result).toEqual(mockShift);
      // Uses end_time IS NULL instead of status='OPEN' (timestamps are more reliable)
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('end_time IS NULL'));
    });

    it('should return undefined when no open shift', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.getOpenShift('store-456');

      expect(result).toBeUndefined();
    });

    it('should return most recent open shift', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockShift),
      });

      dal.getOpenShift('store-456');

      // Uses start_time DESC as primary, created_at DESC as secondary
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ORDER BY start_time DESC'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('LIMIT 1'));
    });
  });

  // ==========================================================================
  // GET LATEST SHIFT TESTS
  // ==========================================================================

  describe('getLatestShift', () => {
    it('should return most recent shift regardless of status', () => {
      const closedShift = { ...mockShift, status: 'CLOSED' as ShiftStatus };
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(closedShift),
      });

      const result = dal.getLatestShift('store-456');

      expect(result).toEqual(closedShift);
      // Should NOT filter by status
      expect(mockPrepare).not.toHaveBeenCalledWith(expect.stringContaining('status ='));
    });

    it('should order by date and shift number descending', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockShift),
      });

      dal.getLatestShift('store-456');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY business_date DESC, shift_number DESC')
      );
    });
  });

  // ==========================================================================
  // GET NEXT SHIFT NUMBER TESTS
  // ==========================================================================

  describe('getNextShiftNumber', () => {
    it('should return 1 for first shift of the day', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ max_num: null }),
      });

      const result = dal.getNextShiftNumber('store-456', '2024-01-15');

      expect(result).toBe(1);
    });

    it('should return incremented number for existing shifts', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ max_num: 3 }),
      });

      const result = dal.getNextShiftNumber('store-456', '2024-01-15');

      expect(result).toBe(4);
    });

    it('should query max shift number for specific date', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ max_num: 1 }),
      });

      dal.getNextShiftNumber('store-456', '2024-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('MAX(shift_number)'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('business_date = ?'));
    });
  });

  // ==========================================================================
  // FIND BY NUMBER TESTS
  // ==========================================================================

  describe('findByNumber', () => {
    it('should find shift by store, date, and number', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockShift),
      });

      const result = dal.findByNumber('store-456', '2024-01-15', 1);

      expect(result).toEqual(mockShift);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('store_id = ? AND business_date = ? AND shift_number = ?')
      );
    });

    it('should return undefined when shift not found', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.findByNumber('store-456', '2024-01-15', 99);

      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // COUNT BY STATUS TESTS
  // ==========================================================================

  describe('countByStatus', () => {
    it('should count open shifts', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ count: 5 }),
      });

      const result = dal.countByStatus('store-456', 'OPEN');

      expect(result).toBe(5);
    });

    it('should count closed shifts', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ count: 10 }),
      });

      const result = dal.countByStatus('store-456', 'CLOSED');

      expect(result).toBe(10);
    });

    it('should return 0 when no shifts match', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ count: 0 }),
      });

      const result = dal.countByStatus('store-456', 'OPEN');

      expect(result).toBe(0);
    });
  });

  // ==========================================================================
  // GET OR CREATE FOR DATE TESTS
  // ==========================================================================

  describe('getOrCreateForDate', () => {
    it('should return existing open shift', () => {
      // findOpenShiftByRegister falls back to getOpenShiftForDate which uses get()
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockShift),
      });

      const result = dal.getOrCreateForDate('store-456', '2024-01-15');

      expect(result).toEqual(mockShift);
    });

    it('should create new shift when no open shift exists', () => {
      const newShift = { ...mockShift, shift_id: 'new-shift', shift_number: 2 };

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) }) // findOpenShiftByRegister (no open shift)
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ max_num: 1 }) }) // getNextShiftNumber
        .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) }) // create INSERT
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(newShift) }); // findById

      const result = dal.getOrCreateForDate('store-456', '2024-01-15');

      expect(result.shift_number).toBe(2);
    });

    it('should create first shift when no shifts exist for date', () => {
      const newShift = { ...mockShift, shift_id: 'new-shift', shift_number: 1 };

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) }) // findOpenShiftByRegister (no shifts)
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ max_num: null }) }) // getNextShiftNumber
        .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) }) // create INSERT
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(newShift) }); // findById

      const result = dal.getOrCreateForDate('store-456', '2024-01-15');

      expect(result.shift_number).toBe(1);
    });
  });

  // ==========================================================================
  // SECURITY TESTS - SEC-006 SQL Injection Prevention
  // ==========================================================================

  describe('SEC-006: SQL Injection Prevention', () => {
    it('should use parameterized queries for all operations', () => {
      // Test that all queries use ? placeholders
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue(mockShift);
      const mockAll = vi.fn().mockReturnValue([mockShift]);

      mockPrepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll });

      // Execute various operations
      dal.findByDate('store-456', '2024-01-15');
      dal.findByDateRange('store-456', '2024-01-15', '2024-01-20');
      dal.getOpenShift('store-456');
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
      dal.getOpenShift('store-456');
      dal.getLatestShift('store-456');
      dal.getNextShiftNumber('store-456', '2024-01-15');
      dal.findByNumber('store-456', '2024-01-15', 1);
      dal.countByStatus('store-456', 'OPEN');

      const calls = mockPrepare.mock.calls;
      calls.forEach((call) => {
        expect(call[0]).toContain('store_id');
      });
    });
  });
});
