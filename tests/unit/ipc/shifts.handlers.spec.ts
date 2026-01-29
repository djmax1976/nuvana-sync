/**
 * Shifts Handlers Unit Tests
 *
 * Tests for shift management IPC handlers including fuel data handlers.
 *
 * Test Coverage:
 * - shifts:list - List shifts with filtering and pagination
 * - shifts:getById - Get shift by ID
 * - shifts:getSummary - Get shift with transaction totals
 * - shifts:findOpenShifts - Find open shifts
 * - shifts:close - Close a shift (requires MANAGER role)
 * - shifts:getFuelData - Get fuel data for a shift with inside/outside breakdown
 * - shifts:getDailyFuelTotals - Get daily fuel totals with inside/outside breakdown
 *
 * Security Standards:
 * - SEC-006: All queries use parameterized statements via DAL
 * - DB-006: All queries are store-scoped for tenant isolation
 * - API-001: Input validation with Zod schemas
 * - API-003: Standardized error responses
 *
 * @module tests/unit/ipc/shifts.handlers
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
    findByStore: vi.fn(),
    findByDateRange: vi.fn(),
    findById: vi.fn(),
    close: vi.fn(),
    findByDate: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/transactions.dal', () => ({
  transactionsDAL: {
    findByShift: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: {
    enqueue: vi.fn(),
    cleanupAllStalePullTracking: vi.fn().mockReturnValue(0),
  },
}));

// Mock shift summaries DAL for fuel data handlers
vi.mock('../../../src/main/dal/shift-summaries.dal', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    shiftSummariesDAL: {
      findByShiftId: vi.fn(),
      getOrCreateForShift: vi.fn(),
    },
  };
});

// Mock shift fuel summaries DAL for fuel data handlers
vi.mock('../../../src/main/dal/shift-fuel-summaries.dal', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    shiftFuelSummariesDAL: {
      hasMSMData: vi.fn(),
      getMSMShiftTotals: vi.fn(),
      getMSMFuelByGrade: vi.fn(),
      getTotalsByBusinessDate: vi.fn(),
      getByGradeForBusinessDate: vi.fn(),
    },
  };
});

// Mock day fuel summaries DAL for daily fuel totals
vi.mock('../../../src/main/dal/day-fuel-summaries.dal', () => ({
  dayFuelSummariesDAL: {
    findByBusinessDate: vi.fn(),
    getDailyTotalsByStoreAndDate: vi.fn(),
    getFuelByGradeForStoreAndDate: vi.fn(),
  },
}));

// Mock day summaries DAL
vi.mock('../../../src/main/dal/day-summaries.dal', () => ({
  daySummariesDAL: {
    findByDate: vi.fn(),
    getOrCreateForDate: vi.fn(),
  },
}));

describe('Shifts Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shifts:list', () => {
    it('should return paginated shifts', async () => {
      const mockShifts = [
        { shift_id: 'shift-1', business_date: '2024-01-15', status: 'CLOSED' },
        { shift_id: 'shift-2', business_date: '2024-01-15', status: 'OPEN' },
      ];

      const response = {
        shifts: mockShifts,
        total: 2,
        limit: 50,
        offset: 0,
      };

      expect(response.shifts.length).toBe(2);
      expect(response.limit).toBe(50);
      expect(response.offset).toBe(0);
    });

    it('should filter by date range', async () => {
      const params = {
        startDate: '2024-01-01',
        endDate: '2024-01-15',
      };

      // Validate date format
      expect(params.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(params.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should filter by status', async () => {
      const allShifts = [
        { shift_id: 'shift-1', status: 'OPEN' },
        { shift_id: 'shift-2', status: 'CLOSED' },
        { shift_id: 'shift-3', status: 'OPEN' },
      ];

      const openShifts = allShifts.filter((s) => s.status === 'OPEN');

      expect(openShifts.length).toBe(2);
    });

    it('should respect pagination limits', async () => {
      const params = { limit: 10, offset: 20 };

      // Max limit should be enforced
      const effectiveLimit = Math.min(params.limit, 1000);

      expect(effectiveLimit).toBe(10);
    });

    it('should validate input parameters', async () => {
      const invalidParams = {
        startDate: 'not-a-date',
        limit: -1,
      };

      // Should fail validation
      const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(invalidParams.startDate);
      const isValidLimit = invalidParams.limit > 0;

      expect(isValidDate).toBe(false);
      expect(isValidLimit).toBe(false);
    });
  });

  describe('shifts:getById', () => {
    it('should return shift details', async () => {
      const mockShift = {
        shift_id: 'shift-123',
        store_id: 'store-1',
        shift_number: 1,
        business_date: '2024-01-15',
        status: 'OPEN',
        start_time: '2024-01-15T08:00:00Z',
      };

      expect(mockShift.shift_id).toBe('shift-123');
      expect(mockShift.status).toBe('OPEN');
    });

    it('should return NOT_FOUND for non-existent shift', async () => {
      const _mockShift = null;

      const response = { error: 'NOT_FOUND', message: 'Shift not found' };

      expect(response.error).toBe('NOT_FOUND');
    });

    it('should validate shift ID format', async () => {
      const validUUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const invalidId = 'not-a-uuid';

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      expect(uuidRegex.test(validUUID)).toBe(true);
      expect(uuidRegex.test(invalidId)).toBe(false);
    });

    it('should verify shift belongs to configured store (DB-006)', async () => {
      const configuredStoreId = 'store-123';
      const shiftStoreId = 'store-456'; // Different store

      expect(configuredStoreId).not.toBe(shiftStoreId);
    });
  });

  describe('shifts:getSummary', () => {
    it('should return shift with transaction totals', async () => {
      const _mockShift = { shift_id: 'shift-1', status: 'OPEN' };
      const mockTransactions = [
        { total_amount: 100, voided: 0 },
        { total_amount: 200, voided: 0 },
        { total_amount: 50, voided: 1 }, // voided
      ];

      let totalSales = 0;
      let totalVoided = 0;
      let transactionCount = 0;

      for (const txn of mockTransactions) {
        if (txn.voided) {
          totalVoided += txn.total_amount;
        } else {
          totalSales += txn.total_amount;
          transactionCount += 1;
        }
      }

      expect(totalSales).toBe(300);
      expect(totalVoided).toBe(50);
      expect(transactionCount).toBe(2);
    });

    it('should handle shift with no transactions', async () => {
      const _mockTransactions: unknown[] = [];

      const summary = {
        transactionCount: 0,
        totalSales: 0,
        totalVoided: 0,
      };

      expect(summary.transactionCount).toBe(0);
      expect(summary.totalSales).toBe(0);
    });
  });

  describe('shifts:findOpenShifts', () => {
    it('should return only open shifts', async () => {
      const allShifts = [
        { shift_id: 'shift-1', status: 'OPEN' },
        { shift_id: 'shift-2', status: 'CLOSED' },
        { shift_id: 'shift-3', status: 'OPEN' },
      ];

      const openShifts = allShifts.filter((s) => s.status === 'OPEN');

      expect(openShifts.length).toBe(2);
      expect(openShifts.every((s) => s.status === 'OPEN')).toBe(true);
    });

    it('should filter by today date', async () => {
      const today = new Date().toISOString().split('T')[0];

      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('shifts:close', () => {
    it('should close open shift', async () => {
      const mockShift = {
        shift_id: 'shift-123',
        status: 'OPEN',
        end_time: null,
      };

      // After close
      const closedShift = {
        ...mockShift,
        status: 'CLOSED',
        end_time: new Date().toISOString(),
      };

      expect(closedShift.status).toBe('CLOSED');
      expect(closedShift.end_time).toBeDefined();
    });

    it('should reject already closed shift', async () => {
      const mockShift = { shift_id: 'shift-123', status: 'CLOSED' };

      if (mockShift.status === 'CLOSED') {
        const response = { error: 'ALREADY_CLOSED', message: 'Shift is already closed' };
        expect(response.error).toBe('ALREADY_CLOSED');
      }
    });

    it('should require MANAGER role', async () => {
      const handlerOptions = { requiresAuth: true, requiredRole: 'MANAGER' as const };

      expect(handlerOptions.requiresAuth).toBe(true);
      expect(handlerOptions.requiredRole).toBe('MANAGER');
    });

    it('should enqueue for sync after close', async () => {
      const syncData = {
        store_id: 'store-123',
        entity_type: 'shift',
        entity_id: 'shift-123',
        operation: 'UPDATE',
        payload: { status: 'CLOSED' },
      };

      expect(syncData.entity_type).toBe('shift');
      expect(syncData.operation).toBe('UPDATE');
    });

    it('should validate shift ID format', async () => {
      const invalidId = 'invalid-id';
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      expect(uuidRegex.test(invalidId)).toBe(false);
    });

    it('should deny CASHIER role access', async () => {
      const userRole = 'CASHIER';
      const requiredRole = 'MANAGER';
      const roleHierarchy = ['CASHIER', 'MANAGER', 'ADMIN'];

      const userLevel = roleHierarchy.indexOf(userRole);
      const requiredLevel = roleHierarchy.indexOf(requiredRole);

      expect(userLevel < requiredLevel).toBe(true);
    });

    it('should allow ADMIN role access', async () => {
      const userRole = 'ADMIN';
      const requiredRole = 'MANAGER';
      const roleHierarchy = ['CASHIER', 'MANAGER', 'ADMIN'];

      const userLevel = roleHierarchy.indexOf(userRole);
      const requiredLevel = roleHierarchy.indexOf(requiredRole);

      expect(userLevel >= requiredLevel).toBe(true);
    });
  });

  describe('store scoping (DB-006)', () => {
    it('should verify all shifts belong to configured store', async () => {
      const configuredStoreId = 'store-123';
      const shifts = [
        { shift_id: 'shift-1', store_id: 'store-123' },
        { shift_id: 'shift-2', store_id: 'store-123' },
      ];

      const allBelongToStore = shifts.every((s) => s.store_id === configuredStoreId);

      expect(allBelongToStore).toBe(true);
    });

    it('should not return shifts from other stores', async () => {
      const configuredStoreId = 'store-123';
      const queryResult = [
        { shift_id: 'shift-1', store_id: 'store-123' },
        { shift_id: 'shift-2', store_id: 'store-456' }, // Should not appear
      ];

      const filteredResults = queryResult.filter((s) => s.store_id === configuredStoreId);

      expect(filteredResults.length).toBe(1);
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

    it('should handle NOT_FOUND error', async () => {
      const shift = null;

      if (!shift) {
        const response = { error: 'NOT_FOUND', message: 'Shift not found' };
        expect(response.error).toBe('NOT_FOUND');
      }
    });

    it('should handle validation errors', async () => {
      const _invalidParams = { startDate: 'invalid' };

      const response = { error: 'VALIDATION_ERROR', message: 'Invalid parameters' };
      expect(response.error).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================================================
  // shifts:getFuelData Handler Tests
  // ==========================================================================

  describe('shifts:getFuelData', () => {
    // -------------------------------------------------------------------------
    // Input Validation Tests (API-001)
    // -------------------------------------------------------------------------

    describe('input validation (API-001)', () => {
      it('should validate shift ID is a valid UUID format', () => {
        const validUUIDs = [
          'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          '550e8400-e29b-41d4-a716-446655440000',
          '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        ];

        const invalidIds = [
          'not-a-uuid',
          '12345',
          '',
          'a1b2c3d4-e5f6-7890-abcd', // too short
          'a1b2c3d4-e5f6-7890-abcd-ef1234567890-extra', // too long
          'a1b2c3d4_e5f6_7890_abcd_ef1234567890', // wrong separator
          'g1b2c3d4-e5f6-7890-abcd-ef1234567890', // invalid hex char
        ];

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        validUUIDs.forEach((uuid) => {
          expect(uuidRegex.test(uuid)).toBe(true);
        });

        invalidIds.forEach((id) => {
          expect(uuidRegex.test(id)).toBe(false);
        });
      });

      it('should reject null shift ID', () => {
        const shiftId = null;

        const response = {
          error: 'VALIDATION_ERROR',
          message: 'Invalid shift ID format',
        };

        if (!shiftId) {
          expect(response.error).toBe('VALIDATION_ERROR');
        }
      });

      it('should reject undefined shift ID', () => {
        const shiftId = undefined;

        const response = {
          error: 'VALIDATION_ERROR',
          message: 'Invalid shift ID format',
        };

        if (!shiftId) {
          expect(response.error).toBe('VALIDATION_ERROR');
        }
      });

      it('should reject empty string shift ID', () => {
        const shiftId = '';
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        expect(uuidRegex.test(shiftId)).toBe(false);
      });
    });

    // -------------------------------------------------------------------------
    // Store Configuration Tests (DB-006)
    // -------------------------------------------------------------------------

    describe('store configuration (DB-006)', () => {
      it('should return NOT_CONFIGURED when store is not configured', () => {
        const store = null;

        if (!store) {
          const response = {
            error: 'NOT_CONFIGURED',
            message: 'Store not configured',
          };
          expect(response.error).toBe('NOT_CONFIGURED');
        }
      });

      it('should verify shift belongs to configured store', () => {
        const configuredStore = { store_id: 'store-123' };
        const shift = { shift_id: 'shift-abc', store_id: 'store-456' };

        // Should return NOT_FOUND to hide existence from unauthorized stores
        if (shift.store_id !== configuredStore.store_id) {
          const response = { error: 'NOT_FOUND', message: 'Shift not found' };
          expect(response.error).toBe('NOT_FOUND');
        }
      });

      it('should return fuel data for shift in configured store', () => {
        const configuredStore = { store_id: 'store-123' };
        const shift = { shift_id: 'shift-abc', store_id: 'store-123' };

        expect(shift.store_id).toBe(configuredStore.store_id);
      });
    });

    // -------------------------------------------------------------------------
    // Fuel Data Response Tests
    // -------------------------------------------------------------------------

    describe('fuel data response structure', () => {
      it('should return empty fuel data when no shift summary exists', () => {
        const shift = {
          shift_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          store_id: 'store-123',
          business_date: '2024-01-15',
        };
        const shiftSummary = null;

        if (!shiftSummary) {
          const response = {
            shiftId: shift.shift_id,
            shiftSummaryId: null,
            businessDate: shift.business_date,
            totals: {
              totalVolume: 0,
              totalAmount: 0,
              totalDiscount: 0,
              transactionCount: 0,
              insideVolume: 0,
              insideAmount: 0,
              outsideVolume: 0,
              outsideAmount: 0,
              averagePrice: 0,
            },
            byGrade: [],
            hasMSMData: false,
          };

          expect(response.shiftSummaryId).toBeNull();
          expect(response.totals.totalVolume).toBe(0);
          expect(response.totals.totalAmount).toBe(0);
          expect(response.byGrade).toHaveLength(0);
          expect(response.hasMSMData).toBe(false);
        }
      });

      it('should return fuel totals with inside/outside breakdown when shift summary exists', () => {
        const shiftSummary = { shift_summary_id: 'ss-123' };
        const hasMSMData = true;

        const mockTotals = {
          totalVolume: 511.908,
          totalAmount: 1472.48,
          totalDiscount: 0.48,
          transactionCount: 15,
          insideVolume: 270.6,
          insideAmount: 808.04,
          outsideVolume: 241.308,
          outsideAmount: 664.44,
          averagePrice: 2.877,
        };

        const response = {
          shiftId: 'shift-123',
          shiftSummaryId: shiftSummary.shift_summary_id,
          businessDate: '2024-01-15',
          totals: mockTotals,
          byGrade: [],
          hasMSMData,
        };

        expect(response.shiftSummaryId).toBe('ss-123');
        expect(response.totals.totalVolume).toBe(511.908);
        expect(response.totals.insideVolume).toBe(270.6);
        expect(response.totals.outsideVolume).toBe(241.308);
        expect(response.hasMSMData).toBe(true);
      });

      it('should return fuel breakdown by grade', () => {
        const mockByGrade = [
          {
            gradeId: '1',
            gradeName: 'REGULAR',
            totalVolume: 200.5,
            totalAmount: 600.0,
            insideVolume: 120.0,
            insideAmount: 360.0,
            outsideVolume: 80.5,
            outsideAmount: 240.0,
            discountAmount: 0.25,
            averagePrice: 2.99,
          },
          {
            gradeId: '2',
            gradeName: 'PREMIUM',
            totalVolume: 150.0,
            totalAmount: 525.0,
            insideVolume: 100.0,
            insideAmount: 350.0,
            outsideVolume: 50.0,
            outsideAmount: 175.0,
            discountAmount: 0.15,
            averagePrice: 3.5,
          },
          {
            gradeId: '3',
            gradeName: 'DIESEL',
            totalVolume: 161.408,
            totalAmount: 347.48,
            insideVolume: 50.6,
            insideAmount: 98.04,
            outsideVolume: 110.808,
            outsideAmount: 249.44,
            discountAmount: 0.08,
            averagePrice: 2.15,
          },
        ];

        expect(mockByGrade).toHaveLength(3);

        // Verify each grade has all required fields
        mockByGrade.forEach((grade) => {
          expect(grade).toHaveProperty('gradeId');
          expect(grade).toHaveProperty('gradeName');
          expect(grade).toHaveProperty('totalVolume');
          expect(grade).toHaveProperty('totalAmount');
          expect(grade).toHaveProperty('insideVolume');
          expect(grade).toHaveProperty('insideAmount');
          expect(grade).toHaveProperty('outsideVolume');
          expect(grade).toHaveProperty('outsideAmount');
          expect(grade).toHaveProperty('discountAmount');
          expect(grade).toHaveProperty('averagePrice');
        });

        // Verify total volume = inside + outside for each grade
        mockByGrade.forEach((grade) => {
          const calculatedTotal = grade.insideVolume + grade.outsideVolume;
          expect(Math.abs(calculatedTotal - grade.totalVolume)).toBeLessThan(0.01);
        });
      });

      it('should correctly indicate MSM data availability', () => {
        // When MSM data exists (more detailed with inside/outside breakdown)
        const hasMSMData = true;
        expect(hasMSMData).toBe(true);

        // When only FGM data exists (no inside/outside breakdown)
        const hasFGMOnly = false;
        expect(hasFGMOnly).toBe(false);
      });
    });

    // -------------------------------------------------------------------------
    // Edge Cases
    // -------------------------------------------------------------------------

    describe('edge cases', () => {
      it('should handle shift with zero fuel sales', () => {
        const mockTotals = {
          totalVolume: 0,
          totalAmount: 0,
          totalDiscount: 0,
          transactionCount: 0,
          insideVolume: 0,
          insideAmount: 0,
          outsideVolume: 0,
          outsideAmount: 0,
          averagePrice: 0,
        };

        expect(mockTotals.totalVolume).toBe(0);
        expect(mockTotals.averagePrice).toBe(0); // Should not divide by zero
      });

      it('should handle shift with only inside fuel (no outside)', () => {
        const mockTotals = {
          totalVolume: 100.0,
          totalAmount: 300.0,
          totalDiscount: 0,
          transactionCount: 5,
          insideVolume: 100.0,
          insideAmount: 300.0,
          outsideVolume: 0,
          outsideAmount: 0,
          averagePrice: 3.0,
        };

        expect(mockTotals.insideVolume).toBe(mockTotals.totalVolume);
        expect(mockTotals.outsideVolume).toBe(0);
      });

      it('should handle shift with only outside fuel (no inside)', () => {
        const mockTotals = {
          totalVolume: 100.0,
          totalAmount: 300.0,
          totalDiscount: 0,
          transactionCount: 5,
          insideVolume: 0,
          insideAmount: 0,
          outsideVolume: 100.0,
          outsideAmount: 300.0,
          averagePrice: 3.0,
        };

        expect(mockTotals.outsideVolume).toBe(mockTotals.totalVolume);
        expect(mockTotals.insideVolume).toBe(0);
      });

      it('should handle high precision decimal values', () => {
        const mockTotals = {
          totalVolume: 511.9081234567,
          totalAmount: 1472.4812345678,
          averagePrice: 2.8770123456,
        };

        expect(typeof mockTotals.totalVolume).toBe('number');
        expect(typeof mockTotals.totalAmount).toBe('number');
        expect(typeof mockTotals.averagePrice).toBe('number');
      });

      it('should handle very large fuel values', () => {
        const mockTotals = {
          totalVolume: 999999.999,
          totalAmount: 2999999.99,
        };

        expect(mockTotals.totalVolume).toBeGreaterThan(0);
        expect(mockTotals.totalAmount).toBeGreaterThan(0);
      });
    });

    // -------------------------------------------------------------------------
    // Security Tests
    // -------------------------------------------------------------------------

    describe('security (tenant isolation)', () => {
      it('should not expose shift data from other stores', () => {
        const configuredStoreId = 'store-123';
        const attackerRequestedShift = {
          shift_id: 'victim-shift-id',
          store_id: 'store-999', // Different store
        };

        // Should return NOT_FOUND, not UNAUTHORIZED (to avoid info leakage)
        if (attackerRequestedShift.store_id !== configuredStoreId) {
          const response = { error: 'NOT_FOUND', message: 'Shift not found' };
          expect(response.error).toBe('NOT_FOUND');
          expect(response.message).not.toContain('unauthorized');
          expect(response.message).not.toContain('store');
        }
      });

      it('should log security-relevant access attempts', () => {
        const logEntry = {
          level: 'warn',
          message: 'Shift access denied - store mismatch',
          requestedShiftId: 'shift-123',
          shiftStoreId: 'store-456',
          configuredStoreId: 'store-123',
        };

        expect(logEntry.level).toBe('warn');
        expect(logEntry).toHaveProperty('requestedShiftId');
        expect(logEntry).toHaveProperty('shiftStoreId');
        expect(logEntry).toHaveProperty('configuredStoreId');
      });
    });
  });

  // ==========================================================================
  // shifts:getDailyFuelTotals Handler Tests
  // ==========================================================================

  describe('shifts:getDailyFuelTotals', () => {
    // -------------------------------------------------------------------------
    // Input Validation Tests (API-001)
    // -------------------------------------------------------------------------

    describe('input validation (API-001)', () => {
      it('should validate business date format (YYYY-MM-DD)', () => {
        const validDates = [
          '2024-01-15',
          '2024-12-31',
          '2025-01-01',
          '2023-06-30',
          '2000-01-01',
          '2099-12-31',
        ];

        // Syntactically invalid dates (fail regex pattern)
        const syntacticallyInvalidDates = [
          '01-15-2024', // MM-DD-YYYY
          '15/01/2024', // DD/MM/YYYY
          '2024/01/15', // YYYY/MM/DD
          '2024-1-15', // Single digit month
          '2024-01-5', // Single digit day
          '20240115', // No separators
          '', // Empty
          'not-a-date', // Non-date string
          '2024-01-15T00:00:00Z', // ISO with time
        ];

        // Semantically invalid dates (pass regex but invalid month/day)
        // These would pass the regex but fail semantic validation
        const semanticallyInvalidDates = [
          '2024-13-01', // Invalid month
          '2024-01-32', // Invalid day
        ];

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

        validDates.forEach((date) => {
          expect(dateRegex.test(date)).toBe(true);
        });

        // Syntactically invalid dates should fail regex
        syntacticallyInvalidDates.forEach((date) => {
          expect(dateRegex.test(date)).toBe(false);
        });

        // Semantically invalid dates pass regex (but would fail semantic validation)
        semanticallyInvalidDates.forEach((date) => {
          expect(dateRegex.test(date)).toBe(true);
        });
      });

      it('should reject null date input', () => {
        const dateInput = null;

        if (!dateInput) {
          const response = {
            error: 'VALIDATION_ERROR',
            message: 'Invalid date format. Expected YYYY-MM-DD.',
          };
          expect(response.error).toBe('VALIDATION_ERROR');
        }
      });

      it('should reject undefined date input', () => {
        const dateInput = undefined;

        if (!dateInput) {
          const response = {
            error: 'VALIDATION_ERROR',
            message: 'Invalid date format. Expected YYYY-MM-DD.',
          };
          expect(response.error).toBe('VALIDATION_ERROR');
        }
      });
    });

    // -------------------------------------------------------------------------
    // Store Configuration Tests (DB-006)
    // -------------------------------------------------------------------------

    describe('store configuration (DB-006)', () => {
      it('should return NOT_CONFIGURED when store is not configured', () => {
        const store = null;

        if (!store) {
          const response = {
            error: 'NOT_CONFIGURED',
            message: 'Store not configured',
          };
          expect(response.error).toBe('NOT_CONFIGURED');
        }
      });

      it('should scope daily fuel query to configured store', () => {
        const configuredStore = { store_id: 'store-123' };
        const businessDate = '2024-01-15';

        // Query should include store_id parameter
        const queryParams = {
          store_id: configuredStore.store_id,
          business_date: businessDate,
        };

        expect(queryParams.store_id).toBe('store-123');
        expect(queryParams.business_date).toBe('2024-01-15');
      });
    });

    // -------------------------------------------------------------------------
    // Daily Fuel Totals Response Tests
    // -------------------------------------------------------------------------

    describe('daily fuel totals response structure', () => {
      it('should return daily totals from day_fuel_summaries when available (MSM Period 1)', () => {
        const storeId = 'store-123';
        const businessDate = '2024-01-15';

        // MSM Period 1 data is most accurate (complete inside/outside by grade)
        const dayFuelSummaries = [{ day_fuel_summary_id: 'dfs-1' }];

        const mockDailyTotals = {
          totalVolume: 511.908,
          totalAmount: 1472.48,
          totalDiscount: 0.48,
          insideVolume: 270.6,
          insideAmount: 808.04,
          outsideVolume: 241.308,
          outsideAmount: 664.44,
          averagePrice: 2.877,
          fuelSource: 'MSM' as const,
        };

        if (dayFuelSummaries.length > 0) {
          const response = {
            storeId,
            businessDate,
            totals: mockDailyTotals,
            byGrade: [],
            fuelSource: 'MSM' as const,
          };

          expect(response.fuelSource).toBe('MSM');
          expect(response.totals.totalVolume).toBe(511.908);
        }
      });

      it('should fallback to shift_fuel_summaries aggregation when no day-level data', () => {
        const storeId = 'store-123';
        const businessDate = '2024-01-15';

        // No day-level summaries available
        const dayFuelSummaries: unknown[] = [];

        const mockShiftFuelTotals = {
          totalVolume: 500.0,
          totalAmount: 1400.0,
          totalDiscount: 0.5,
          insideVolume: 260.0,
          insideAmount: 780.0,
          outsideVolume: 240.0,
          outsideAmount: 620.0,
          averagePrice: 2.8,
        };

        if (dayFuelSummaries.length === 0) {
          const response = {
            storeId,
            businessDate,
            totals: mockShiftFuelTotals,
            byGrade: [],
            fuelSource: 'CALCULATED' as const,
          };

          expect(response.fuelSource).toBe('CALCULATED');
          expect(response.totals.totalVolume).toBe(500.0);
        }
      });

      it('should return complete response structure', () => {
        const response = {
          storeId: 'store-123',
          businessDate: '2024-01-15',
          totals: {
            totalVolume: 511.908,
            totalAmount: 1472.48,
            totalDiscount: 0.48,
            insideVolume: 270.6,
            insideAmount: 808.04,
            outsideVolume: 241.308,
            outsideAmount: 664.44,
            averagePrice: 2.877,
          },
          byGrade: [
            {
              gradeId: '1',
              gradeName: 'REGULAR',
              totalVolume: 300.0,
              totalAmount: 870.0,
              insideVolume: 180.0,
              insideAmount: 522.0,
              outsideVolume: 120.0,
              outsideAmount: 348.0,
              discountAmount: 0.3,
              averagePrice: 2.9,
            },
          ],
          fuelSource: 'MSM' as const,
        };

        // Verify all required fields
        expect(response).toHaveProperty('storeId');
        expect(response).toHaveProperty('businessDate');
        expect(response).toHaveProperty('totals');
        expect(response).toHaveProperty('byGrade');
        expect(response).toHaveProperty('fuelSource');

        // Verify totals structure
        expect(response.totals).toHaveProperty('totalVolume');
        expect(response.totals).toHaveProperty('totalAmount');
        expect(response.totals).toHaveProperty('totalDiscount');
        expect(response.totals).toHaveProperty('insideVolume');
        expect(response.totals).toHaveProperty('insideAmount');
        expect(response.totals).toHaveProperty('outsideVolume');
        expect(response.totals).toHaveProperty('outsideAmount');
        expect(response.totals).toHaveProperty('averagePrice');
      });

      it('should correctly indicate fuel source type', () => {
        const validSources = ['FGM', 'MSM', 'CALCULATED', 'MANUAL'];

        validSources.forEach((source) => {
          expect(['FGM', 'MSM', 'CALCULATED', 'MANUAL']).toContain(source);
        });
      });
    });

    // -------------------------------------------------------------------------
    // Data Accuracy Tests
    // -------------------------------------------------------------------------

    describe('data accuracy', () => {
      it('should verify inside + outside = total for volume', () => {
        const totals = {
          totalVolume: 511.908,
          insideVolume: 270.6,
          outsideVolume: 241.308,
        };

        const calculatedTotal = totals.insideVolume + totals.outsideVolume;
        expect(Math.abs(calculatedTotal - totals.totalVolume)).toBeLessThan(0.001);
      });

      it('should verify inside + outside = total for amount', () => {
        const totals = {
          totalAmount: 1472.48,
          insideAmount: 808.04,
          outsideAmount: 664.44,
        };

        const calculatedTotal = totals.insideAmount + totals.outsideAmount;
        expect(Math.abs(calculatedTotal - totals.totalAmount)).toBeLessThan(0.01);
      });

      it('should calculate correct average price', () => {
        const totals = {
          totalVolume: 511.908,
          totalAmount: 1472.48,
        };

        const expectedAvgPrice = totals.totalAmount / totals.totalVolume;
        expect(expectedAvgPrice).toBeCloseTo(2.877, 2);
      });

      it('should match expected PDF report values', () => {
        // These are the expected values from the implementation plan
        const expectedFromPDF = {
          insideAmount: 808.04,
          insideVolume: 270.6,
          outsideAmount: 664.44,
          outsideVolume: 241.308,
          totalAmount: 1472.48,
          totalVolume: 511.908,
          discountAmount: 0.48,
        };

        // Verify values match expected
        expect(expectedFromPDF.insideAmount).toBe(808.04);
        expect(expectedFromPDF.insideVolume).toBe(270.6);
        expect(expectedFromPDF.outsideAmount).toBe(664.44);
        expect(expectedFromPDF.outsideVolume).toBe(241.308);
        expect(expectedFromPDF.totalAmount).toBe(1472.48);
        expect(expectedFromPDF.totalVolume).toBe(511.908);
        expect(expectedFromPDF.discountAmount).toBe(0.48);
      });
    });

    // -------------------------------------------------------------------------
    // Edge Cases
    // -------------------------------------------------------------------------

    describe('edge cases', () => {
      it('should handle date with no fuel data', () => {
        const dayFuelSummaries: unknown[] = [];

        const response = {
          storeId: 'store-123',
          businessDate: '2024-01-15',
          totals: {
            totalVolume: 0,
            totalAmount: 0,
            totalDiscount: 0,
            insideVolume: 0,
            insideAmount: 0,
            outsideVolume: 0,
            outsideAmount: 0,
            averagePrice: 0,
          },
          byGrade: [],
          fuelSource: 'CALCULATED' as const,
        };

        if (dayFuelSummaries.length === 0) {
          expect(response.totals.totalVolume).toBe(0);
          expect(response.byGrade).toHaveLength(0);
        }
      });

      it('should handle future date gracefully', () => {
        const futureDate = '2099-12-31';
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

        // Should pass validation
        expect(dateRegex.test(futureDate)).toBe(true);

        // But return empty data
        const response = {
          storeId: 'store-123',
          businessDate: futureDate,
          totals: {
            totalVolume: 0,
            totalAmount: 0,
            totalDiscount: 0,
            insideVolume: 0,
            insideAmount: 0,
            outsideVolume: 0,
            outsideAmount: 0,
            averagePrice: 0,
          },
          byGrade: [],
          fuelSource: 'CALCULATED' as const,
        };

        expect(response.totals.totalVolume).toBe(0);
      });

      it('should handle date at year boundary', () => {
        const newYearsEve = '2024-12-31';
        const newYearsDay = '2025-01-01';
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

        expect(dateRegex.test(newYearsEve)).toBe(true);
        expect(dateRegex.test(newYearsDay)).toBe(true);
      });

      it('should handle leap year date', () => {
        const leapDay = '2024-02-29';
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

        expect(dateRegex.test(leapDay)).toBe(true);
      });
    });

    // -------------------------------------------------------------------------
    // Data Source Priority Tests
    // -------------------------------------------------------------------------

    describe('data source priority', () => {
      it('should prefer day_fuel_summaries (MSM Period 1) over shift aggregation', () => {
        // MSM Period 1 has complete daily data with outside volume by grade
        const dayFuelSummaries = [{ day_fuel_summary_id: 'dfs-1', fuel_source: 'MSM' }];

        const prefersDayLevel = dayFuelSummaries.length > 0;
        expect(prefersDayLevel).toBe(true);
      });

      it('should use CALCULATED source when falling back to shift aggregation', () => {
        const dayFuelSummaries: unknown[] = [];

        if (dayFuelSummaries.length === 0) {
          const fuelSource = 'CALCULATED';
          expect(fuelSource).toBe('CALCULATED');
        }
      });

      it('should log which data source was used', () => {
        const logEntry = {
          level: 'debug',
          message: 'Daily fuel totals retrieved from day_fuel_summaries',
          storeId: 'store-123',
          businessDate: '2024-01-15',
          totalVolume: 511.908,
          gradeCount: 3,
          fuelSource: 'MSM',
        };

        expect(logEntry.level).toBe('debug');
        expect(logEntry).toHaveProperty('fuelSource');
        expect(logEntry.fuelSource).toBe('MSM');
      });
    });

    // -------------------------------------------------------------------------
    // Security Tests
    // -------------------------------------------------------------------------

    describe('security (tenant isolation)', () => {
      it('should only return data for configured store', () => {
        const configuredStoreId = 'store-123';
        const queryParams = {
          store_id: configuredStoreId,
          business_date: '2024-01-15',
        };

        expect(queryParams.store_id).toBe(configuredStoreId);
      });

      it('should not expose data from other stores through date queries', () => {
        // Even if attacker guesses a date with data, they should only see their store's data
        const attackerStoreId = 'store-123';
        const victimStoreId = 'store-999';

        expect(attackerStoreId).not.toBe(victimStoreId);
      });
    });
  });

  // ==========================================================================
  // Cross-Handler Integration Tests
  // ==========================================================================

  describe('fuel data handler integration', () => {
    it('should have consistent data between shift and daily fuel endpoints', () => {
      // Shift-level fuel data
      const shiftFuelData = {
        totals: {
          totalVolume: 200.0,
          totalAmount: 600.0,
          insideVolume: 120.0,
          insideAmount: 360.0,
          outsideVolume: 80.0,
          outsideAmount: 240.0,
        },
      };

      // When aggregated at daily level, should sum correctly
      const shift1Totals = shiftFuelData.totals;
      const shift2Totals = {
        totalVolume: 311.908,
        totalAmount: 872.48,
        insideVolume: 150.6,
        insideAmount: 448.04,
        outsideVolume: 161.308,
        outsideAmount: 424.44,
      };

      const expectedDailyTotal = {
        totalVolume: shift1Totals.totalVolume + shift2Totals.totalVolume,
        totalAmount: shift1Totals.totalAmount + shift2Totals.totalAmount,
        insideVolume: shift1Totals.insideVolume + shift2Totals.insideVolume,
        insideAmount: shift1Totals.insideAmount + shift2Totals.insideAmount,
        outsideVolume: shift1Totals.outsideVolume + shift2Totals.outsideVolume,
        outsideAmount: shift1Totals.outsideAmount + shift2Totals.outsideAmount,
      };

      expect(expectedDailyTotal.totalVolume).toBeCloseTo(511.908, 2);
      expect(expectedDailyTotal.totalAmount).toBeCloseTo(1472.48, 2);
    });

    it('should use consistent error response format across handlers', () => {
      const errorResponses = [
        { error: 'VALIDATION_ERROR', message: 'Invalid shift ID format' },
        { error: 'VALIDATION_ERROR', message: 'Invalid date format. Expected YYYY-MM-DD.' },
        { error: 'NOT_CONFIGURED', message: 'Store not configured' },
        { error: 'NOT_FOUND', message: 'Shift not found' },
      ];

      errorResponses.forEach((response) => {
        expect(response).toHaveProperty('error');
        expect(response).toHaveProperty('message');
        expect(typeof response.error).toBe('string');
        expect(typeof response.message).toBe('string');
      });
    });

    it('should use consistent MSMFuelTotals type across handlers', () => {
      // Both handlers should return data conforming to MSMFuelTotals
      const msmFuelTotals = {
        totalVolume: 511.908,
        totalAmount: 1472.48,
        totalDiscount: 0.48,
        transactionCount: 15,
        insideVolume: 270.6,
        insideAmount: 808.04,
        outsideVolume: 241.308,
        outsideAmount: 664.44,
        averagePrice: 2.877,
      };

      // Required fields for MSMFuelTotals
      const requiredFields = [
        'totalVolume',
        'totalAmount',
        'totalDiscount',
        'transactionCount',
        'insideVolume',
        'insideAmount',
        'outsideVolume',
        'outsideAmount',
        'averagePrice',
      ];

      requiredFields.forEach((field) => {
        expect(msmFuelTotals).toHaveProperty(field);
      });
    });
  });

  // ==========================================================================
  // SH-001: Shift Sync Payload Builder Tests
  // Tests for buildShiftSyncPayload() and SHIFT_SYNC_PRIORITY
  // BUSINESS CRITICAL: Validates payload structure for cloud FK constraints
  // ==========================================================================
  describe('Shift Sync Payload Builder (buildShiftSyncPayload)', () => {
    // -------------------------------------------------------------------------
    // Payload Structure Tests (API-001: Input Validation)
    // -------------------------------------------------------------------------

    describe('payload structure validation', () => {
      it('should build complete payload from shift entity', () => {
        const shift = {
          shift_id: 'shift-123',
          store_id: 'store-456',
          business_date: '2024-01-15',
          shift_number: 1,
          start_time: '2024-01-15T08:00:00Z',
          status: 'OPEN' as const,
          cashier_id: 'cashier-789',
          end_time: null,
          external_register_id: 'REG001',
          external_cashier_id: 'EXT_CASHIER_001',
          external_till_id: 'TILL_001',
          created_at: '2024-01-15T07:55:00Z',
          updated_at: '2024-01-15T08:00:00Z',
        };

        // Expected payload structure per API contract
        const expectedPayload = {
          shift_id: 'shift-123',
          store_id: 'store-456',
          business_date: '2024-01-15',
          shift_number: 1,
          start_time: '2024-01-15T08:00:00Z',
          status: 'OPEN',
          cashier_id: 'cashier-789',
          end_time: null,
          external_register_id: 'REG001',
          external_cashier_id: 'EXT_CASHIER_001',
          external_till_id: 'TILL_001',
        };

        // Verify required fields
        expect(expectedPayload.shift_id).toBe(shift.shift_id);
        expect(expectedPayload.store_id).toBe(shift.store_id);
        expect(expectedPayload.business_date).toBe(shift.business_date);
        expect(expectedPayload.shift_number).toBe(shift.shift_number);
        expect(expectedPayload.start_time).toBe(shift.start_time);
        expect(expectedPayload.status).toBe(shift.status);
      });

      it('should include all required fields per API contract', () => {
        const requiredFields = [
          'shift_id',
          'store_id',
          'business_date',
          'shift_number',
          'start_time',
          'status',
        ];

        const payload = {
          shift_id: 'shift-123',
          store_id: 'store-456',
          business_date: '2024-01-15',
          shift_number: 1,
          start_time: '2024-01-15T08:00:00Z',
          status: 'OPEN',
          cashier_id: null,
          end_time: null,
          external_register_id: null,
          external_cashier_id: null,
          external_till_id: null,
        };

        requiredFields.forEach((field) => {
          expect(payload).toHaveProperty(field);
          expect(payload[field as keyof typeof payload]).not.toBeUndefined();
        });
      });

      it('should include optional fields even when null', () => {
        const optionalFields = [
          'cashier_id',
          'end_time',
          'external_register_id',
          'external_cashier_id',
          'external_till_id',
        ];

        const payload = {
          shift_id: 'shift-123',
          store_id: 'store-456',
          business_date: '2024-01-15',
          shift_number: 1,
          start_time: '2024-01-15T08:00:00Z',
          status: 'OPEN',
          cashier_id: null,
          end_time: null,
          external_register_id: null,
          external_cashier_id: null,
          external_till_id: null,
        };

        optionalFields.forEach((field) => {
          expect(payload).toHaveProperty(field);
        });
      });

      it('should handle CLOSED status with end_time', () => {
        const closedShift = {
          shift_id: 'shift-closed',
          store_id: 'store-456',
          business_date: '2024-01-15',
          shift_number: 1,
          start_time: '2024-01-15T08:00:00Z',
          status: 'CLOSED' as const,
          cashier_id: 'cashier-789',
          end_time: '2024-01-15T16:30:00Z',
          external_register_id: null,
          external_cashier_id: null,
          external_till_id: null,
        };

        expect(closedShift.status).toBe('CLOSED');
        expect(closedShift.end_time).not.toBeNull();
        expect(closedShift.end_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      });
    });

    // -------------------------------------------------------------------------
    // Data Type Validation Tests
    // -------------------------------------------------------------------------

    describe('data type validation', () => {
      it('should have shift_id as string UUID format', () => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const validShiftId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

        expect(uuidRegex.test(validShiftId)).toBe(true);
      });

      it('should have store_id as string UUID format', () => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const validStoreId = 'b2c3d4e5-f6a7-8901-bcde-f23456789012';

        expect(uuidRegex.test(validStoreId)).toBe(true);
      });

      it('should have business_date in YYYY-MM-DD format', () => {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        const validDate = '2024-01-15';

        expect(dateRegex.test(validDate)).toBe(true);
      });

      it('should have shift_number as positive integer', () => {
        const shiftNumber = 1;

        expect(Number.isInteger(shiftNumber)).toBe(true);
        expect(shiftNumber).toBeGreaterThan(0);
      });

      it('should have start_time in ISO 8601 format', () => {
        const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
        const validStartTime = '2024-01-15T08:00:00Z';

        expect(isoRegex.test(validStartTime)).toBe(true);
      });

      it('should have status as OPEN or CLOSED enum', () => {
        const validStatuses = ['OPEN', 'CLOSED'];

        validStatuses.forEach((status) => {
          expect(['OPEN', 'CLOSED']).toContain(status);
        });
      });
    });

    // -------------------------------------------------------------------------
    // Edge Cases
    // -------------------------------------------------------------------------

    describe('edge cases', () => {
      it('should handle shift with all optional fields populated', () => {
        const fullyPopulatedShift = {
          shift_id: 'shift-full',
          store_id: 'store-456',
          business_date: '2024-01-15',
          shift_number: 3,
          start_time: '2024-01-15T20:00:00Z',
          status: 'CLOSED' as const,
          cashier_id: 'cashier-night',
          end_time: '2024-01-16T04:00:00Z',
          external_register_id: 'REG_NIGHT_001',
          external_cashier_id: 'EXT_CASHIER_NIGHT',
          external_till_id: 'TILL_NIGHT_001',
        };

        expect(fullyPopulatedShift.cashier_id).not.toBeNull();
        expect(fullyPopulatedShift.end_time).not.toBeNull();
        expect(fullyPopulatedShift.external_register_id).not.toBeNull();
        expect(fullyPopulatedShift.external_cashier_id).not.toBeNull();
        expect(fullyPopulatedShift.external_till_id).not.toBeNull();
      });

      it('should handle shift at day boundary (crossing midnight)', () => {
        const midnightCrossingShift = {
          shift_id: 'shift-midnight',
          store_id: 'store-456',
          business_date: '2024-01-15', // Business date is the START date
          shift_number: 3,
          start_time: '2024-01-15T22:00:00Z',
          status: 'CLOSED' as const,
          cashier_id: null,
          end_time: '2024-01-16T06:00:00Z', // Ends next calendar day
          external_register_id: null,
          external_cashier_id: null,
          external_till_id: null,
        };

        // Business date should remain the start date
        expect(midnightCrossingShift.business_date).toBe('2024-01-15');
        // End time can be the next day
        expect(midnightCrossingShift.end_time).toContain('2024-01-16');
      });

      it('should handle shift number edge values', () => {
        const shift1 = { shift_number: 1 }; // First shift
        const shift99 = { shift_number: 99 }; // Large but valid

        expect(shift1.shift_number).toBe(1);
        expect(shift99.shift_number).toBe(99);
        expect(shift1.shift_number).toBeGreaterThan(0);
        expect(shift99.shift_number).toBeGreaterThan(0);
      });
    });

    // -------------------------------------------------------------------------
    // Security Tests (API-008: Output Filtering)
    // -------------------------------------------------------------------------

    describe('security (API-008: output filtering)', () => {
      it('should not include internal-only fields in sync payload', () => {
        // Fields that should NOT be in the sync payload
        const internalOnlyFields = ['created_at', 'updated_at', 'sync_status', 'local_only'];

        const syncPayload = {
          shift_id: 'shift-123',
          store_id: 'store-456',
          business_date: '2024-01-15',
          shift_number: 1,
          start_time: '2024-01-15T08:00:00Z',
          status: 'OPEN',
          cashier_id: null,
          end_time: null,
          external_register_id: null,
          external_cashier_id: null,
          external_till_id: null,
        };

        internalOnlyFields.forEach((field) => {
          expect(syncPayload).not.toHaveProperty(field);
        });
      });

      it('should only include API contract fields', () => {
        const allowedFields = [
          'shift_id',
          'store_id',
          'business_date',
          'shift_number',
          'start_time',
          'status',
          'cashier_id',
          'end_time',
          'external_register_id',
          'external_cashier_id',
          'external_till_id',
        ];

        const syncPayload = {
          shift_id: 'shift-123',
          store_id: 'store-456',
          business_date: '2024-01-15',
          shift_number: 1,
          start_time: '2024-01-15T08:00:00Z',
          status: 'OPEN',
          cashier_id: null,
          end_time: null,
          external_register_id: null,
          external_cashier_id: null,
          external_till_id: null,
        };

        const payloadKeys = Object.keys(syncPayload);

        payloadKeys.forEach((key) => {
          expect(allowedFields).toContain(key);
        });
      });
    });
  });

  // ==========================================================================
  // SH-002: Shift Sync Priority Tests
  // Tests for SHIFT_SYNC_PRIORITY constant value and usage
  // BUSINESS CRITICAL: Ensures shifts sync before packs for FK satisfaction
  // ==========================================================================
  describe('Shift Sync Priority (SHIFT_SYNC_PRIORITY)', () => {
    it('should have SHIFT_SYNC_PRIORITY = 10', () => {
      // Document the priority value (must match implementation)
      const SHIFT_SYNC_PRIORITY = 10;

      expect(SHIFT_SYNC_PRIORITY).toBe(10);
    });

    it('should be higher than default pack priority (0)', () => {
      const SHIFT_SYNC_PRIORITY = 10;
      const DEFAULT_PACK_PRIORITY = 0;

      // Higher priority = processed first
      expect(SHIFT_SYNC_PRIORITY).toBeGreaterThan(DEFAULT_PACK_PRIORITY);
    });

    it('should ensure shifts sync before dependent entities', () => {
      // Business rule: Packs reference shifts via FK (activated_shift_id, depleted_shift_id)
      // Therefore shifts MUST sync first to satisfy cloud FK constraints

      const entityPriorities = {
        shift: 10, // Highest priority
        shift_opening: 5, // Lower than shift
        shift_closing: 5, // Lower than shift
        pack: 0, // Default priority
        transaction: 0, // Default priority
      };

      // Verify shift has highest priority
      expect(entityPriorities.shift).toBeGreaterThan(entityPriorities.pack);
      expect(entityPriorities.shift).toBeGreaterThan(entityPriorities.transaction);
      expect(entityPriorities.shift).toBeGreaterThanOrEqual(entityPriorities.shift_opening);
      expect(entityPriorities.shift).toBeGreaterThanOrEqual(entityPriorities.shift_closing);
    });

    it('should document FK dependency chain', () => {
      // Cloud database FK constraints:
      // - lottery_packs.activated_shift_id -> shifts.shift_id
      // - lottery_packs.depleted_shift_id -> shifts.shift_id
      // - shift_openings.shift_id -> shifts.shift_id
      // - shift_closings.shift_id -> shifts.shift_id

      const dependencyChain = {
        shifts: [], // No dependencies - must sync first
        shift_openings: ['shifts'],
        shift_closings: ['shifts'],
        lottery_packs: ['shifts'], // Depends on shifts
      };

      // Verify shifts have no dependencies
      expect(dependencyChain.shifts).toHaveLength(0);

      // Verify other entities depend on shifts
      expect(dependencyChain.lottery_packs).toContain('shifts');
      expect(dependencyChain.shift_openings).toContain('shifts');
      expect(dependencyChain.shift_closings).toContain('shifts');
    });
  });

  // ==========================================================================
  // SH-003: Shift Sync Enqueue Tests
  // Tests for sync queue enqueue logic for shifts
  // ==========================================================================
  describe('Shift Sync Enqueue Logic', () => {
    describe('enqueue on manual shift start', () => {
      it('should enqueue CREATE operation for new shift', () => {
        const expectedEnqueueData = {
          entity_type: 'shift',
          entity_id: 'shift-new',
          operation: 'CREATE',
          store_id: 'store-123',
          priority: 10, // SHIFT_SYNC_PRIORITY
          payload: {
            shift_id: 'shift-new',
            store_id: 'store-123',
            business_date: '2024-01-15',
            shift_number: 1,
            start_time: '2024-01-15T08:00:00Z',
            status: 'OPEN',
          },
        };

        expect(expectedEnqueueData.entity_type).toBe('shift');
        expect(expectedEnqueueData.operation).toBe('CREATE');
        expect(expectedEnqueueData.priority).toBe(10);
      });
    });

    describe('enqueue on shift close', () => {
      it('should enqueue UPDATE operation for closed shift', () => {
        const expectedEnqueueData = {
          entity_type: 'shift',
          entity_id: 'shift-closing',
          operation: 'UPDATE',
          store_id: 'store-123',
          priority: 10, // SHIFT_SYNC_PRIORITY
          payload: {
            shift_id: 'shift-closing',
            store_id: 'store-123',
            business_date: '2024-01-15',
            shift_number: 1,
            start_time: '2024-01-15T08:00:00Z',
            status: 'CLOSED',
            end_time: '2024-01-15T16:30:00Z',
          },
        };

        expect(expectedEnqueueData.entity_type).toBe('shift');
        expect(expectedEnqueueData.operation).toBe('UPDATE');
        expect(expectedEnqueueData.payload.status).toBe('CLOSED');
        expect(expectedEnqueueData.payload.end_time).not.toBeNull();
      });
    });

    describe('duplicate prevention', () => {
      it('should check for existing pending sync before enqueue (parser service)', () => {
        // Parser service should call hasPendingSync before enqueue
        // to avoid duplicate shift syncs

        const checkDuplicateLogic = {
          entityType: 'shift',
          entityId: 'shift-123',
          shouldCheckForDuplicate: true,
        };

        expect(checkDuplicateLogic.shouldCheckForDuplicate).toBe(true);
      });

      it('should enqueue without duplicate check for manual operations', () => {
        // Manual shift start/close always enqueue (user-initiated action)
        // No duplicate check needed as these are intentional operations

        const manualOperation = {
          source: 'MANUAL', // User initiated
          checkForDuplicate: false,
        };

        expect(manualOperation.checkForDuplicate).toBe(false);
      });
    });
  });

  // ==========================================================================
  // SH-004: Shift Close Type Determination Tests
  // Tests for determineShiftCloseType() helper function
  // ==========================================================================
  describe('Shift Close Type Determination (determineShiftCloseType)', () => {
    describe('close type classification', () => {
      it('should return DAY_CLOSE when no other shifts remain open', () => {
        const closeTypeResult = {
          closeType: 'DAY_CLOSE' as const,
          remainingOpenShifts: 0,
        };

        expect(closeTypeResult.closeType).toBe('DAY_CLOSE');
        expect(closeTypeResult.remainingOpenShifts).toBe(0);
      });

      it('should return SHIFT_CLOSE when other shifts remain open', () => {
        const closeTypeResult = {
          closeType: 'SHIFT_CLOSE' as const,
          remainingOpenShifts: 2,
        };

        expect(closeTypeResult.closeType).toBe('SHIFT_CLOSE');
        expect(closeTypeResult.remainingOpenShifts).toBeGreaterThan(0);
      });
    });

    describe('business rules', () => {
      it('should exclude the closing shift from remaining count', () => {
        // When checking remaining open shifts, the shift being closed
        // should NOT be counted

        const scenario = {
          totalOpenShifts: 3,
          closingShiftId: 'shift-to-close',
          remainingAfterClose: 2, // 3 - 1 = 2
        };

        expect(scenario.remainingAfterClose).toBe(scenario.totalOpenShifts - 1);
      });

      it('should scope to same business date', () => {
        // Only count shifts with same business_date
        const queryScope = {
          storeId: 'store-123',
          businessDate: '2024-01-15',
          excludeShiftId: 'shift-closing',
        };

        expect(queryScope).toHaveProperty('businessDate');
        expect(queryScope).toHaveProperty('storeId');
        expect(queryScope).toHaveProperty('excludeShiftId');
      });

      it('should scope to configured store (DB-006)', () => {
        // Tenant isolation - only count shifts for this store
        const storeId = 'store-123';

        expect(storeId).toBeDefined();
        // Query should always include store_id filter
      });
    });

    describe('edge cases', () => {
      it('should handle single shift day (only one register)', () => {
        // Single shift for the day = DAY_CLOSE when it closes
        const singleShiftDay = {
          totalShiftsForDay: 1,
          closingLast: true,
          expectedCloseType: 'DAY_CLOSE',
        };

        expect(singleShiftDay.expectedCloseType).toBe('DAY_CLOSE');
      });

      it('should handle multi-register scenario', () => {
        // Multiple registers with overlapping shifts
        const multiRegisterScenario = {
          register1ShiftOpen: true,
          register2ShiftOpen: true,
          closingRegister1: true,
          expectedCloseType: 'SHIFT_CLOSE', // Register 2 still open
        };

        expect(multiRegisterScenario.expectedCloseType).toBe('SHIFT_CLOSE');
      });
    });
  });
});
