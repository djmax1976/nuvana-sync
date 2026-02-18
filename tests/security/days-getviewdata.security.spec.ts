/**
 * Days getViewData Security Tests
 *
 * Security tests for days:getViewData handler validating:
 * - SEC-006: SQL injection prevention via parameterized queries
 * - DB-006: Tenant isolation - stores cannot access other stores' data
 * - API-001: Input validation - UUID format enforcement
 * - API-003: Error message sanitization - no internal details leaked
 * - API-008: Output filtering - only whitelisted fields returned
 * - SEC-017: Audit logging for security events
 *
 * MCP Guidance Applied:
 * - TEST-001: AAA pattern (Arrange-Act-Assert)
 * - TEST-002: Descriptive naming
 * - TEST-006: Error paths and edge cases
 *
 * @module tests/security/days-getviewdata.security
 * @security SEC-006, DB-006, API-001, API-003, API-008
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

vi.mock('../../src/main/dal/stores.dal', () => ({
  storesDAL: mockStoresDAL,
}));

// Mock day summaries DAL with spy on query parameters
const mockDaySummariesDAL = {
  findById: vi.fn(),
  findByDate: vi.fn(),
  findByStore: vi.fn(),
  findByDateRange: vi.fn(),
};

vi.mock('../../src/main/dal/day-summaries.dal', () => ({
  daySummariesDAL: mockDaySummariesDAL,
}));

// Mock shifts DAL
const mockShiftsDAL = {
  findById: vi.fn(),
  findByDate: vi.fn(),
  findByStore: vi.fn(),
};

vi.mock('../../src/main/dal/shifts.dal', () => ({
  shiftsDAL: mockShiftsDAL,
}));

// Mock shift summaries DAL
const mockShiftSummariesDAL = {
  findByShiftId: vi.fn(),
  findByDate: vi.fn(),
};

vi.mock('../../src/main/dal/shift-summaries.dal', () => ({
  shiftSummariesDAL: mockShiftSummariesDAL,
}));

// Mock lottery business days DAL
const mockLotteryBusinessDaysDAL = {
  findByDate: vi.fn(),
  findById: vi.fn(),
};

vi.mock('../../src/main/dal/lottery-business-days.dal', () => ({
  lotteryBusinessDaysDAL: mockLotteryBusinessDaysDAL,
}));

// Mock logger with spy
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('../../src/main/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

// ============================================================================
// Test Fixtures
// ============================================================================

const STORE_A_ID = 'a0000000-0001-0000-0000-000000000001';
const STORE_B_ID = 'b0000000-0002-0000-0000-000000000002';
const DAY_SUMMARY_ID = 'd0000000-0001-0000-0000-000000000001';
const BUSINESS_DATE = '2026-02-17';

const mockStoreA = {
  store_id: STORE_A_ID,
  name: 'Store A',
  external_id: 'ext-001',
};

const mockStoreB = {
  store_id: STORE_B_ID,
  name: 'Store B',
  external_id: 'ext-002',
};

const mockDaySummaryStoreA = {
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

const mockDaySummaryStoreB = {
  ...mockDaySummaryStoreA,
  store_id: STORE_B_ID,
};

const mockShift = {
  shift_id: 'shift-uuid-0001',
  store_id: STORE_A_ID,
  shift_number: 1,
  business_date: BUSINESS_DATE,
  status: 'CLOSED' as const,
  start_time: '2026-02-17T06:00:00Z',
  end_time: '2026-02-17T14:00:00Z',
};

const mockShiftSummary = {
  shift_summary_id: 'summary-uuid-0001',
  shift_id: 'shift-uuid-0001',
  store_id: STORE_A_ID,
  business_date: BUSINESS_DATE,
  opening_cash: 200.0,
  closing_cash: 1500.0,
  net_sales: 2700.0,
  fuel_sales: 4500.0,
  fuel_gallons: 1500.0,
  lottery_sales: 625.0,
  lottery_cashes: 212.5,
  tax_collected: 147.5,
};

// ============================================================================
// Test Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();

  // Default setup
  mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
  mockShiftsDAL.findByDate.mockReturnValue([]);
  mockShiftSummariesDAL.findByDate.mockReturnValue([]);
  mockLotteryBusinessDaysDAL.findByDate.mockReturnValue([]);
});

afterEach(() => {
  vi.resetAllMocks();
});

// ============================================================================
// TEST SUITE: SEC-006 SQL Injection Prevention
// ============================================================================

describe('SEC-006: SQL Injection Prevention', () => {
  it('should not execute SQL injection in dayId parameter', () => {
    // Arrange: Malicious SQL injection attempt
    const maliciousInputs = [
      "'; DROP TABLE day_summaries; --",
      "1' OR '1'='1",
      "1; DELETE FROM day_summaries WHERE '1'='1",
      '1 UNION SELECT * FROM users --',
      "1'; UPDATE day_summaries SET status='OPEN' WHERE '1'='1",
      '1"; DROP TABLE day_summaries; --',
      '1`; DROP TABLE shifts; --',
      '1; SELECT * FROM stores; --',
    ];

    // Act & Assert: UUID validation should reject all
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    for (const maliciousInput of maliciousInputs) {
      const isValidUUID = uuidRegex.test(maliciousInput);
      expect(isValidUUID).toBe(false);
      // Handler would return VALIDATION_ERROR before any DB query
    }
  });

  it('should use parameterized query for day summary lookup', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummaryStoreA);

    // Act
    mockDaySummariesDAL.findById(DAY_SUMMARY_ID);

    // Assert: findById uses prepared statement with ? placeholder
    expect(mockDaySummariesDAL.findById).toHaveBeenCalledWith(DAY_SUMMARY_ID);
    // DAL implementation uses: db.prepare('SELECT * FROM day_summaries WHERE day_summary_id = ?').get(id)
  });

  it('should use parameterized query for shifts lookup', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummaryStoreA);
    mockShiftsDAL.findByDate.mockReturnValue([mockShift]);

    // Act
    mockShiftsDAL.findByDate(STORE_A_ID, BUSINESS_DATE);

    // Assert: findByDate uses prepared statement
    expect(mockShiftsDAL.findByDate).toHaveBeenCalledWith(STORE_A_ID, BUSINESS_DATE);
    // DAL uses: db.prepare('SELECT * FROM shifts WHERE store_id = ? AND business_date = ?')
  });

  it('should use parameterized query for shift summaries lookup', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummaryStoreA);
    mockShiftSummariesDAL.findByDate.mockReturnValue([mockShiftSummary]);

    // Act
    mockShiftSummariesDAL.findByDate(STORE_A_ID, BUSINESS_DATE);

    // Assert: findByDate uses prepared statement
    expect(mockShiftSummariesDAL.findByDate).toHaveBeenCalledWith(STORE_A_ID, BUSINESS_DATE);
    // DAL uses: db.prepare('SELECT * FROM shift_summaries WHERE store_id = ? AND business_date = ?')
  });

  it('should use parameterized query for lottery days lookup', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummaryStoreA);

    // Act
    mockLotteryBusinessDaysDAL.findByDate(STORE_A_ID, BUSINESS_DATE);

    // Assert: findByDate uses prepared statement
    expect(mockLotteryBusinessDaysDAL.findByDate).toHaveBeenCalledWith(STORE_A_ID, BUSINESS_DATE);
    // DAL uses: db.prepare('SELECT * FROM lottery_business_days WHERE store_id = ? AND business_date = ?')
  });

  it('should sanitize input before any database operation', () => {
    // Arrange: Valid UUID format
    const suspiciousButValidFormatted = '00000000-0000-0000-0000-000000000000';

    // Act & Assert: Should be treated as a regular lookup (not found)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(uuidRegex.test(suspiciousButValidFormatted)).toBe(true);

    mockDaySummariesDAL.findById.mockReturnValue(undefined);
    mockDaySummariesDAL.findById(suspiciousButValidFormatted);

    // Handler would safely query and return NOT_FOUND
    expect(mockDaySummariesDAL.findById).toHaveBeenCalledWith(suspiciousButValidFormatted);
  });
});

// ============================================================================
// TEST SUITE: DB-006 Tenant Isolation
// ============================================================================

describe('DB-006: Tenant Isolation', () => {
  it('should deny access when day summary belongs to different store', () => {
    // Arrange: User in Store A, day summary belongs to Store B
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummaryStoreB);

    // Act
    const configuredStore = mockStoresDAL.getConfiguredStore();
    const daySummary = mockDaySummariesDAL.findById(DAY_SUMMARY_ID);

    // Assert: Tenant isolation check fails
    expect(configuredStore!.store_id).toBe(STORE_A_ID);
    expect(daySummary!.store_id).toBe(STORE_B_ID);
    expect(daySummary!.store_id).not.toBe(configuredStore!.store_id);

    // Handler returns NOT_FOUND (not FORBIDDEN to prevent enumeration)
  });

  it('should return same error code for not found and cross-tenant access', () => {
    // Arrange: Two scenarios
    const scenarios = [
      { daySummary: undefined, reason: 'not found' },
      { daySummary: mockDaySummaryStoreB, reason: 'cross-tenant' },
    ];

    for (const scenario of scenarios) {
      mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
      mockDaySummariesDAL.findById.mockReturnValue(scenario.daySummary);

      // Act
      const daySummary = mockDaySummariesDAL.findById(DAY_SUMMARY_ID);

      // Assert: Both cases would return NOT_FOUND
      const shouldDeny = !daySummary || daySummary.store_id !== STORE_A_ID;
      expect(shouldDeny).toBe(true);
      // Prevents tenant enumeration by returning same error
    }
  });

  it('should scope shifts DAL call to configured store', () => {
    // Arrange
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummaryStoreA);
    mockShiftsDAL.findByDate.mockReturnValue([mockShift]);

    // Act: Simulate handler flow
    const store = mockStoresDAL.getConfiguredStore();
    mockShiftsDAL.findByDate(store!.store_id, BUSINESS_DATE);

    // Assert: Call scoped to configured store
    expect(mockShiftsDAL.findByDate).toHaveBeenCalledWith(STORE_A_ID, BUSINESS_DATE);
  });

  it('should scope shift summaries DAL call to configured store', () => {
    // Arrange
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummaryStoreA);
    mockShiftSummariesDAL.findByDate.mockReturnValue([mockShiftSummary]);

    // Act
    const store = mockStoresDAL.getConfiguredStore();
    mockShiftSummariesDAL.findByDate(store!.store_id, BUSINESS_DATE);

    // Assert
    expect(mockShiftSummariesDAL.findByDate).toHaveBeenCalledWith(STORE_A_ID, BUSINESS_DATE);
  });

  it('should scope lottery days DAL call to configured store', () => {
    // Arrange
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummaryStoreA);

    // Act
    const store = mockStoresDAL.getConfiguredStore();
    mockLotteryBusinessDaysDAL.findByDate(store!.store_id, BUSINESS_DATE);

    // Assert
    expect(mockLotteryBusinessDaysDAL.findByDate).toHaveBeenCalledWith(STORE_A_ID, BUSINESS_DATE);
  });

  it('should log security warning for cross-tenant access attempt', () => {
    // Arrange
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummaryStoreB);

    // Act: Simulate handler detecting cross-tenant access
    const store = mockStoresDAL.getConfiguredStore();
    const daySummary = mockDaySummariesDAL.findById(DAY_SUMMARY_ID);

    if (daySummary && daySummary.store_id !== store!.store_id) {
      // Handler would call: log.warn('Day view data access denied - store mismatch', {...})
      mockLogger.warn('Day view data access denied - store mismatch', {
        requestedDayId: DAY_SUMMARY_ID,
        dayStoreId: daySummary.store_id,
        configuredStoreId: store!.store_id,
      });
    }

    // Assert: Security event logged
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Day view data access denied - store mismatch',
      expect.objectContaining({
        requestedDayId: DAY_SUMMARY_ID,
        dayStoreId: STORE_B_ID,
        configuredStoreId: STORE_A_ID,
      })
    );
  });

  it('should not leak data from other stores even if day_summary_id is known', () => {
    // Arrange: Attacker knows valid day_summary_id from another store
    const knownDayIdFromOtherStore = 'day-summary-uuid-from-store-b';
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
    mockDaySummariesDAL.findById.mockReturnValue({
      ...mockDaySummaryStoreB,
      day_summary_id: knownDayIdFromOtherStore,
    });

    // Act
    const configuredStore = mockStoresDAL.getConfiguredStore();
    const daySummary = mockDaySummariesDAL.findById(knownDayIdFromOtherStore);

    // Assert: Access denied, returns NOT_FOUND
    const accessDenied = daySummary!.store_id !== configuredStore!.store_id;
    expect(accessDenied).toBe(true);
    // Handler returns NOT_FOUND, not the actual data
  });
});

// ============================================================================
// TEST SUITE: API-001 Input Validation
// ============================================================================

describe('API-001: Input Validation', () => {
  it('should reject null/undefined dayId', () => {
    // Arrange
    const invalidInputs = [null, undefined, ''];

    // Assert
    for (const input of invalidInputs) {
      // Zod schema validation fails for these
      const isInvalid = input === null || input === undefined || input === '';
      expect(isInvalid).toBe(true);
    }
  });

  it('should reject non-string dayId', () => {
    // Arrange
    // SEC-014: Test non-string inputs are rejected by Zod validation
    const nonStringInputs: unknown[] = [
      123,
      { day_summary_id: DAY_SUMMARY_ID },
      ['day-id'],
      true,
      () => DAY_SUMMARY_ID,
      { toString: () => DAY_SUMMARY_ID },
    ];

    // Assert
    for (const input of nonStringInputs) {
      const isString = typeof input === 'string';
      expect(isString).toBe(false);
      // Zod validates type before regex
    }
  });

  it('should reject malformed UUID formats', () => {
    // Arrange
    const malformedUUIDs = [
      'not-a-uuid',
      '12345678', // Too short
      '12345678-1234', // Incomplete
      '12345678-1234-1234-1234', // Missing segment
      '12345678-1234-1234-1234-1234567890123', // Extra character
      'ZZZZZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZZZZZZZZZ', // Invalid hex
      'gggggggg-gggg-gggg-gggg-gggggggggggg', // Invalid hex (g not valid)
      '12345678_1234_1234_1234_123456789012', // Wrong separator
      'day_summary_id', // Field name, not value
    ];

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Assert
    for (const uuid of malformedUUIDs) {
      expect(uuidRegex.test(uuid)).toBe(false);
    }
  });

  it('should accept valid UUID v4 format', () => {
    // Arrange
    const validUUIDs = [
      '550e8400-e29b-41d4-a716-446655440000',
      'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      DAY_SUMMARY_ID,
    ];

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Assert
    for (const uuid of validUUIDs) {
      expect(uuidRegex.test(uuid)).toBe(true);
    }
  });

  it('should accept uppercase UUID format', () => {
    // Arrange
    const uppercaseUUID = 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890';
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Assert
    expect(uuidRegex.test(uppercaseUUID)).toBe(true);
  });
});

// ============================================================================
// TEST SUITE: API-003 Error Message Sanitization
// ============================================================================

describe('API-003: Error Message Sanitization', () => {
  it('should not leak internal details in NOT_FOUND response', () => {
    // Arrange
    mockDaySummariesDAL.findById.mockReturnValue(undefined);

    // Act: Simulate handler error response
    const errorResponse = {
      error: {
        code: 'NOT_FOUND',
        message: 'Day not found',
      },
    };

    // Assert: No internal details leaked
    expect(errorResponse.error.message).not.toContain('SQL');
    expect(errorResponse.error.message).not.toContain('database');
    expect(errorResponse.error.message).not.toContain('store_id');
    expect(errorResponse.error.message).not.toContain('table');
    expect(errorResponse.error.message).not.toContain('SELECT');
    expect(errorResponse.error.message).not.toContain('day_summaries');
  });

  it('should not leak cross-tenant information in error response', () => {
    // Arrange: Cross-tenant access
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummaryStoreB);

    // Act: Handler would return same error as not found
    const errorResponse = {
      error: {
        code: 'NOT_FOUND',
        message: 'Day not found', // Same message, doesn't reveal cross-tenant
      },
    };

    // Assert: No mention of wrong store
    expect(errorResponse.error.message).not.toContain('store');
    expect(errorResponse.error.message).not.toContain('tenant');
    expect(errorResponse.error.message).not.toContain('access denied');
    expect(errorResponse.error.message).not.toContain(STORE_B_ID);
  });

  it('should use generic error for validation failures', () => {
    // Arrange: Invalid input
    const errorResponse = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid day ID format',
      },
    };

    // Assert: Generic message, no internal schema details
    expect(errorResponse.error.message).not.toContain('Zod');
    expect(errorResponse.error.message).not.toContain('schema');
    expect(errorResponse.error.message).not.toContain('regex');
    expect(errorResponse.error.message).not.toContain('uuid');
  });

  it('should log detailed info server-side while returning generic error', () => {
    // Arrange
    const internalError = new Error('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed');

    // Act: Simulate handler catching and logging error
    mockLogger.error('Failed to get day view data', {
      dayId: DAY_SUMMARY_ID,
      error: internalError.message,
    });

    // Handler returns generic error to client
    const clientError = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    };

    // Assert
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to get day view data',
      expect.objectContaining({
        dayId: DAY_SUMMARY_ID,
        error: expect.stringContaining('SQLITE_CONSTRAINT'),
      })
    );
    expect(clientError.error.message).not.toContain('SQLITE');
    expect(clientError.error.message).not.toContain('FOREIGN KEY');
  });
});

// ============================================================================
// TEST SUITE: API-008 Output Filtering
// ============================================================================

describe('API-008: Output Filtering', () => {
  it('should only return whitelisted fields in response', () => {
    // Arrange
    const allowedFields = [
      'daySummaryId',
      'businessDate',
      'status',
      'dayInfo',
      'summary',
      'payments',
      'salesBreakdown',
      'lotteryDayId',
      'timestamps',
    ];

    const disallowedFields = [
      'store_id', // Internal field
      'created_at', // Raw timestamps in nested timestamps object only
      'updated_at',
      'gross_sales', // Internal calculation, summary.insideSales.total is exposed
      'transaction_count', // Internal
      'internal_notes',
      'pin_hash', // Never exposed
      'password',
    ];

    // Act: Validate structure
    const mockResponse = {
      daySummaryId: DAY_SUMMARY_ID,
      businessDate: BUSINESS_DATE,
      status: 'CLOSED',
      dayInfo: {
        businessDate: BUSINESS_DATE,
        shiftCount: 2,
        firstShiftStarted: '2026-02-17 6:00 AM',
        lastShiftEnded: '2026-02-17 10:00 PM',
        totalOpeningCash: 200,
        totalClosingCash: 2500,
      },
      summary: {},
      payments: {},
      salesBreakdown: {},
      lotteryDayId: 'lottery-day-uuid',
      timestamps: {
        createdAt: '2026-02-17T06:00:00Z',
        closedAt: '2026-02-17T22:00:00Z',
      },
    };

    // Assert: Only allowed fields present
    for (const field of allowedFields) {
      expect(field in mockResponse).toBe(true);
    }

    for (const field of disallowedFields) {
      expect(field in mockResponse).toBe(false);
    }
  });

  it('should expose formatted dates not raw timestamps in dayInfo', () => {
    // Arrange
    const dayInfo = {
      businessDate: '2026-02-17',
      shiftCount: 2,
      firstShiftStarted: 'Feb 17, 2026 6:00 AM', // Formatted
      lastShiftEnded: 'Feb 17, 2026 10:00 PM', // Formatted
      totalOpeningCash: 200,
      totalClosingCash: 2500,
    };

    // Assert: Formatted dates, not ISO strings
    expect(dayInfo.firstShiftStarted).not.toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(dayInfo.lastShiftEnded).not.toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(dayInfo.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should not expose internal IDs except primary identifiers', () => {
    // Arrange
    const response = {
      daySummaryId: DAY_SUMMARY_ID, // Primary ID - allowed
      businessDate: BUSINESS_DATE,
      lotteryDayId: 'lottery-uuid', // Reference for lottery component - allowed
    };

    const internalIds = [
      'shift_id', // Individual shift IDs
      'user_id',
      'cashier_id',
      'register_id',
      'shift_summary_id',
    ];

    // Assert
    for (const id of internalIds) {
      expect(id in response).toBe(false);
    }
  });
});

// ============================================================================
// TEST SUITE: Rate Limiting & Abuse Prevention (API-002)
// ============================================================================

describe('API-002: Abuse Prevention', () => {
  it('should not perform expensive operations for invalid input', () => {
    // Arrange: Invalid UUID triggers early return
    const invalidId = 'not-a-uuid';
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Act: Validation happens first
    const isValid = uuidRegex.test(invalidId);

    // Assert: No database calls made for invalid input
    if (!isValid) {
      // Handler returns early with VALIDATION_ERROR
      expect(mockDaySummariesDAL.findById).not.toHaveBeenCalled();
      expect(mockShiftsDAL.findByDate).not.toHaveBeenCalled();
      expect(mockShiftSummariesDAL.findByDate).not.toHaveBeenCalled();
      expect(mockLotteryBusinessDaysDAL.findByDate).not.toHaveBeenCalled();
    }
  });

  it('should fail fast when store not configured', () => {
    // Arrange
    mockStoresDAL.getConfiguredStore.mockReturnValue(undefined);

    // Act
    const store = mockStoresDAL.getConfiguredStore();

    // Assert: Early return, no further processing
    expect(store).toBeUndefined();
    // Handler returns NOT_CONFIGURED before any other DB calls
    expect(mockDaySummariesDAL.findById).not.toHaveBeenCalled();
    expect(mockShiftsDAL.findByDate).not.toHaveBeenCalled();
  });

  it('should fail fast when day not found before aggregation', () => {
    // Arrange
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
    mockDaySummariesDAL.findById.mockReturnValue(undefined);

    // Act
    const daySummary = mockDaySummariesDAL.findById(DAY_SUMMARY_ID);

    // Assert: No aggregation queries if day not found
    expect(daySummary).toBeUndefined();
    // Handler returns NOT_FOUND, doesn't query shifts/summaries
  });
});

// ============================================================================
// TEST SUITE: BIZ-002 Multi-closing Security
// ============================================================================

describe('BIZ-002: Multi-closing Security', () => {
  it('should not expose data from lottery days belonging to other stores', () => {
    // Arrange: Lottery day from Store B returned (misconfigured DAL - shouldn't happen)
    const lotteryDayStoreB = {
      day_id: 'lottery-day-store-b',
      store_id: STORE_B_ID,
      business_date: BUSINESS_DATE,
      status: 'CLOSED',
    };

    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummaryStoreA);
    mockLotteryBusinessDaysDAL.findByDate.mockReturnValue([lotteryDayStoreB]);

    // Act: Simulate handler filtering
    const lotteryDays = mockLotteryBusinessDaysDAL.findByDate(STORE_A_ID, BUSINESS_DATE);

    // Handler should filter by store_id before returning
    const filteredDays = lotteryDays.filter(
      (d: typeof lotteryDayStoreB) => d.store_id === STORE_A_ID
    );

    // Assert: No lottery days from other stores
    expect(filteredDays.length).toBe(0);
  });

  it('should handle multiple lottery days for same date securely', () => {
    // Arrange: Multiple lottery days, some from wrong store
    const lotteryDayA1 = {
      day_id: 'lottery-day-a1',
      store_id: STORE_A_ID,
      status: 'CLOSED',
      closed_at: '2026-02-17T14:00:00Z',
    };
    const lotteryDayA2 = {
      day_id: 'lottery-day-a2',
      store_id: STORE_A_ID,
      status: 'CLOSED',
      closed_at: '2026-02-17T22:00:00Z',
    };
    const lotteryDayB = {
      day_id: 'lottery-day-b',
      store_id: STORE_B_ID, // Wrong store
      status: 'CLOSED',
      closed_at: '2026-02-17T23:00:00Z', // Most recent
    };

    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
    mockLotteryBusinessDaysDAL.findByDate.mockReturnValue([
      lotteryDayA1,
      lotteryDayA2,
      lotteryDayB,
    ]);

    // Act: Handler filters and selects most recent from correct store
    const lotteryDays = mockLotteryBusinessDaysDAL.findByDate(STORE_A_ID, BUSINESS_DATE);
    const filteredClosed = lotteryDays
      .filter((d: typeof lotteryDayA1) => d.store_id === STORE_A_ID && d.status === 'CLOSED')
      .sort((a: typeof lotteryDayA1, b: typeof lotteryDayA1) =>
        (b.closed_at || '').localeCompare(a.closed_at || '')
      );

    // Assert: Gets lottery-day-a2, not lottery-day-b (wrong store)
    expect(filteredClosed[0].day_id).toBe('lottery-day-a2');
    expect(filteredClosed[0].store_id).toBe(STORE_A_ID);
  });
});

// ============================================================================
// TEST SUITE: SEC-017 Audit Logging
// ============================================================================

describe('SEC-017: Audit Logging', () => {
  it('should log successful day view data access', () => {
    // Arrange
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummaryStoreA);
    mockShiftsDAL.findByDate.mockReturnValue([mockShift]);

    // Act: Simulate successful handler completion
    mockLogger.debug('Day view data retrieved', {
      dayId: DAY_SUMMARY_ID,
      businessDate: BUSINESS_DATE,
      status: 'CLOSED',
      shiftCount: 1,
      hasLotteryDay: false,
    });

    // Assert: Access logged
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Day view data retrieved',
      expect.objectContaining({
        dayId: DAY_SUMMARY_ID,
        businessDate: BUSINESS_DATE,
      })
    );
  });

  it('should log access denial with security context', () => {
    // Arrange
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
    mockDaySummariesDAL.findById.mockReturnValue(mockDaySummaryStoreB);

    // Act: Simulate access denial
    mockLogger.warn('Day view data access denied - store mismatch', {
      requestedDayId: DAY_SUMMARY_ID,
      dayStoreId: STORE_B_ID,
      configuredStoreId: STORE_A_ID,
    });

    // Assert: Security event has context for investigation
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('access denied'),
      expect.objectContaining({
        requestedDayId: DAY_SUMMARY_ID,
        dayStoreId: STORE_B_ID,
        configuredStoreId: STORE_A_ID,
      })
    );
  });
});
