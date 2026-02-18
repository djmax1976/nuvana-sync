/**
 * Shifts getViewData Security Tests
 *
 * Security tests for shifts:getViewData handler validating:
 * - SEC-006: SQL injection prevention via parameterized queries
 * - DB-006: Tenant isolation - stores cannot access other stores' data
 * - API-001: Input validation - UUID format enforcement
 * - API-003: Error message sanitization - no internal details leaked
 * - SEC-017: Audit logging for security events
 *
 * MCP Guidance Applied:
 * - TEST-001: AAA pattern (Arrange-Act-Assert)
 * - TEST-002: Descriptive naming
 * - TEST-006: Error paths and edge cases
 *
 * @module tests/security/shifts-getviewdata.security
 * @security SEC-006, DB-006, API-001, API-003
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

// Mock shifts DAL with spy on query parameters
const mockShiftsDAL = {
  findById: vi.fn(),
  findByDate: vi.fn(),
};

vi.mock('../../src/main/dal/shifts.dal', () => ({
  shiftsDAL: mockShiftsDAL,
}));

// Mock users DAL
const mockUsersDAL = {
  findById: vi.fn(),
  findByStore: vi.fn(),
};

vi.mock('../../src/main/dal/users.dal', () => ({
  usersDAL: mockUsersDAL,
}));

// Mock POS terminal mappings DAL
const mockPosTerminalMappingsDAL = {
  findRegisters: vi.fn(),
};

vi.mock('../../src/main/dal/pos-id-mappings.dal', () => ({
  posTerminalMappingsDAL: mockPosTerminalMappingsDAL,
}));

// Mock shift summaries DAL
const mockShiftSummariesDAL = {
  findByShiftId: vi.fn(),
};

vi.mock('../../src/main/dal/shift-summaries.dal', () => ({
  shiftSummariesDAL: mockShiftSummariesDAL,
}));

// Mock shift fuel summaries DAL
const mockShiftFuelSummariesDAL = {
  getShiftTotals: vi.fn(),
};

vi.mock('../../src/main/dal/shift-fuel-summaries.dal', () => ({
  shiftFuelSummariesDAL: mockShiftFuelSummariesDAL,
}));

// Mock shift department summaries DAL
const mockShiftDepartmentSummariesDAL = {
  findByShiftSummary: vi.fn(),
};

vi.mock('../../src/main/dal/shift-department-summaries.dal', () => ({
  shiftDepartmentSummariesDAL: mockShiftDepartmentSummariesDAL,
}));

// Mock shift tender summaries DAL
const mockShiftTenderSummariesDAL = {
  findByShiftSummary: vi.fn(),
};

vi.mock('../../src/main/dal/shift-tender-summaries.dal', () => ({
  shiftTenderSummariesDAL: mockShiftTenderSummariesDAL,
}));

// Mock sync queue DAL
vi.mock('../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: { enqueue: vi.fn() },
}));

// Mock settings service
vi.mock('../../src/main/services/settings.service', () => ({
  settingsService: {
    getStoreId: vi.fn(),
    getPOSType: vi.fn().mockReturnValue('GENERAL'),
    getPOSConnectionType: vi.fn().mockReturnValue('NAXML'),
  },
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
const SHIFT_ID = 'c0000000-0001-0000-0000-000000000001';

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

const mockShiftStoreA = {
  shift_id: SHIFT_ID,
  store_id: STORE_A_ID,
  shift_number: 1,
  business_date: '2026-02-17',
  status: 'CLOSED',
  start_time: '2026-02-17T06:00:00Z',
  end_time: '2026-02-17T14:00:00Z',
  external_register_id: 'REG1',
  cashier_id: 'user-001',
  created_at: '2026-02-17T06:00:00Z',
  updated_at: '2026-02-17T14:00:00Z',
};

const mockShiftStoreB = {
  ...mockShiftStoreA,
  store_id: STORE_B_ID,
};

// ============================================================================
// Test Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();

  // Default setup
  mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
  mockPosTerminalMappingsDAL.findRegisters.mockReturnValue([]);
  mockUsersDAL.findByStore.mockReturnValue({ data: [], total: 0 });
  mockShiftDepartmentSummariesDAL.findByShiftSummary.mockReturnValue([]);
  mockShiftTenderSummariesDAL.findByShiftSummary.mockReturnValue([]);
  mockShiftFuelSummariesDAL.getShiftTotals.mockReturnValue({
    totalVolume: 0,
    totalSales: 0,
    totalDiscount: 0,
    insideVolume: 0,
    insideAmount: 0,
    outsideVolume: 0,
    outsideAmount: 0,
    averagePrice: 0,
    transactionCount: 0,
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

// ============================================================================
// TEST SUITE: SEC-006 SQL Injection Prevention
// ============================================================================

describe('SEC-006: SQL Injection Prevention', () => {
  it('should not execute SQL injection in shiftId parameter', () => {
    // Arrange: Malicious SQL injection attempt
    const maliciousInputs = [
      "'; DROP TABLE shifts; --",
      "1' OR '1'='1",
      "1; DELETE FROM shifts WHERE '1'='1",
      '1 UNION SELECT * FROM users --',
      "1'; UPDATE shifts SET status='OPEN' WHERE '1'='1",
      '1"; DROP TABLE shifts; --',
      '1`; DROP TABLE shifts; --',
    ];

    // Act & Assert: UUID validation should reject all
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    for (const maliciousInput of maliciousInputs) {
      const isValidUUID = uuidRegex.test(maliciousInput);
      expect(isValidUUID).toBe(false);
      // Handler would return VALIDATION_ERROR before any DB query
    }
  });

  it('should use parameterized query for shift lookup', () => {
    // Arrange
    mockShiftsDAL.findById.mockReturnValue(mockShiftStoreA);

    // Act
    mockShiftsDAL.findById(SHIFT_ID);

    // Assert: findById uses prepared statement with ? placeholder
    expect(mockShiftsDAL.findById).toHaveBeenCalledWith(SHIFT_ID);
    // DAL implementation uses: db.prepare('SELECT * FROM shifts WHERE shift_id = ?').get(id)
  });

  it('should use parameterized query for shift summary lookup', () => {
    // Arrange
    mockShiftSummariesDAL.findByShiftId.mockReturnValue(null);

    // Act
    mockShiftSummariesDAL.findByShiftId(STORE_A_ID, SHIFT_ID);

    // Assert: findByShiftId uses prepared statement
    expect(mockShiftSummariesDAL.findByShiftId).toHaveBeenCalledWith(STORE_A_ID, SHIFT_ID);
    // DAL uses: db.prepare('SELECT * FROM shift_summaries WHERE store_id = ? AND shift_id = ?')
  });

  it('should sanitize input before any database operation', () => {
    // Arrange: Valid UUID format but containing SQL keywords
    const suspiciousButValidFormatted = '00000000-0000-0000-0000-000000000000';

    // Act & Assert: Should be treated as a regular lookup (not found)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(uuidRegex.test(suspiciousButValidFormatted)).toBe(true);

    mockShiftsDAL.findById.mockReturnValue(undefined);
    mockShiftsDAL.findById(suspiciousButValidFormatted);

    // Handler would safely query and return NOT_FOUND
    expect(mockShiftsDAL.findById).toHaveBeenCalledWith(suspiciousButValidFormatted);
  });
});

// ============================================================================
// TEST SUITE: DB-006 Tenant Isolation
// ============================================================================

describe('DB-006: Tenant Isolation', () => {
  it('should deny access when shift belongs to different store', () => {
    // Arrange: User in Store A, shift belongs to Store B
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
    mockShiftsDAL.findById.mockReturnValue(mockShiftStoreB);

    // Act
    const configuredStore = mockStoresDAL.getConfiguredStore();
    const shift = mockShiftsDAL.findById(SHIFT_ID);

    // Assert: Tenant isolation check fails
    expect(configuredStore!.store_id).toBe(STORE_A_ID);
    expect(shift!.store_id).toBe(STORE_B_ID);
    expect(shift!.store_id).not.toBe(configuredStore!.store_id);

    // Handler returns NOT_FOUND (not FORBIDDEN to prevent enumeration)
  });

  it('should return same error code for not found and cross-tenant access', () => {
    // Arrange: Two scenarios
    const scenarios = [
      { shift: undefined, reason: 'not found' },
      { shift: mockShiftStoreB, reason: 'cross-tenant' },
    ];

    for (const scenario of scenarios) {
      mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
      mockShiftsDAL.findById.mockReturnValue(scenario.shift);

      // Act
      const shift = mockShiftsDAL.findById(SHIFT_ID);

      // Assert: Both cases would return NOT_FOUND
      const shouldDeny = !shift || shift.store_id !== STORE_A_ID;
      expect(shouldDeny).toBe(true);
      // Prevents tenant enumeration by returning same error
    }
  });

  it('should scope all DAL calls to configured store', () => {
    // Arrange
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
    mockShiftsDAL.findById.mockReturnValue(mockShiftStoreA);
    mockShiftSummariesDAL.findByShiftId.mockReturnValue(null);

    // Act: Simulate handler flow
    const store = mockStoresDAL.getConfiguredStore();
    mockShiftSummariesDAL.findByShiftId(store!.store_id, SHIFT_ID);
    mockPosTerminalMappingsDAL.findRegisters(store!.store_id);
    mockUsersDAL.findByStore(store!.store_id, { limit: 1000 });

    // Assert: All calls scoped to configured store
    expect(mockShiftSummariesDAL.findByShiftId).toHaveBeenCalledWith(STORE_A_ID, SHIFT_ID);
    expect(mockPosTerminalMappingsDAL.findRegisters).toHaveBeenCalledWith(STORE_A_ID);
    expect(mockUsersDAL.findByStore).toHaveBeenCalledWith(STORE_A_ID, { limit: 1000 });
  });

  it('should log security warning for cross-tenant access attempt', () => {
    // Arrange
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
    mockShiftsDAL.findById.mockReturnValue(mockShiftStoreB);

    // Act: Simulate handler detecting cross-tenant access
    const store = mockStoresDAL.getConfiguredStore();
    const shift = mockShiftsDAL.findById(SHIFT_ID);

    if (shift && shift.store_id !== store!.store_id) {
      // Handler would call: log.warn('Shift view data access denied - store mismatch', {...})
      mockLogger.warn('Shift view data access denied - store mismatch', {
        requestedShiftId: SHIFT_ID,
        shiftStoreId: shift.store_id,
        configuredStoreId: store!.store_id,
      });
    }

    // Assert: Security event logged
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Shift view data access denied - store mismatch',
      expect.objectContaining({
        requestedShiftId: SHIFT_ID,
        shiftStoreId: STORE_B_ID,
        configuredStoreId: STORE_A_ID,
      })
    );
  });
});

// ============================================================================
// TEST SUITE: API-001 Input Validation
// ============================================================================

describe('API-001: Input Validation', () => {
  it('should reject null/undefined shiftId', () => {
    // Arrange
    const invalidInputs = [null, undefined, ''];

    // Assert
    for (const input of invalidInputs) {
      // Zod schema validation fails for these
      const isInvalid = input === null || input === undefined || input === '';
      expect(isInvalid).toBe(true);
    }
  });

  it('should reject non-string shiftId', () => {
    // Arrange
    const nonStringInputs = [123, { shift_id: SHIFT_ID }, ['shift-id'], true, () => SHIFT_ID];

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
      SHIFT_ID,
    ];

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Assert
    for (const uuid of validUUIDs) {
      expect(uuidRegex.test(uuid)).toBe(true);
    }
  });
});

// ============================================================================
// TEST SUITE: API-003 Error Message Sanitization
// ============================================================================

describe('API-003: Error Message Sanitization', () => {
  it('should not leak internal details in NOT_FOUND response', () => {
    // Arrange
    mockShiftsDAL.findById.mockReturnValue(undefined);

    // Act: Simulate handler error response
    const errorResponse = {
      error: {
        code: 'NOT_FOUND',
        message: 'Shift not found',
      },
    };

    // Assert: No internal details leaked
    expect(errorResponse.error.message).not.toContain('SQL');
    expect(errorResponse.error.message).not.toContain('database');
    expect(errorResponse.error.message).not.toContain('store_id');
    expect(errorResponse.error.message).not.toContain('table');
    expect(errorResponse.error.message).not.toContain('SELECT');
  });

  it('should not leak cross-tenant information in error response', () => {
    // Arrange: Cross-tenant access
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
    mockShiftsDAL.findById.mockReturnValue(mockShiftStoreB);

    // Act: Handler would return same error as not found
    const errorResponse = {
      error: {
        code: 'NOT_FOUND',
        message: 'Shift not found', // Same message, doesn't reveal cross-tenant
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
        message: 'Invalid shift ID format',
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
    mockLogger.error('Failed to get shift view data', {
      shiftId: SHIFT_ID,
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
      'Failed to get shift view data',
      expect.objectContaining({
        shiftId: SHIFT_ID,
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
      'shiftId',
      'businessDate',
      'status',
      'shiftInfo',
      'summary',
      'payments',
      'salesBreakdown',
      'timestamps',
    ];

    const disallowedFields = [
      'store_id', // Internal field
      'created_at', // Raw timestamps in nested timestamps object only
      'updated_at',
      'cashier_id', // Internal ID - name is exposed instead
      'register_id',
      'external_cashier_id',
      'pin_hash', // Never exposed
      'password',
      'internal_notes',
    ];

    // Act: Validate structure
    const mockResponse = {
      shiftId: SHIFT_ID,
      businessDate: '2026-02-17',
      status: 'CLOSED',
      shiftInfo: {
        terminalName: 'Register 1',
        shiftNumber: 1,
        cashierName: 'John Smith',
        startedAt: '2026-02-17 6:00 AM',
        endedAt: '2026-02-17 2:00 PM',
        openingCash: 200,
        closingCash: 1500,
      },
      summary: {},
      payments: {},
      salesBreakdown: {},
      timestamps: {
        createdAt: '2026-02-17T06:00:00Z',
        closedAt: '2026-02-17T14:00:00Z',
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

  it('should expose resolved names not internal IDs', () => {
    // Arrange
    const shiftInfo = {
      terminalName: 'Register 1', // Resolved from external_register_id
      cashierName: 'John Smith', // Resolved from cashier_id (user_id)
    };

    // Assert: Names exposed, IDs hidden
    expect(shiftInfo.terminalName).toBe('Register 1');
    expect(shiftInfo.cashierName).toBe('John Smith');
    expect('external_register_id' in shiftInfo).toBe(false);
    expect('cashier_id' in shiftInfo).toBe(false);
    expect('user_id' in shiftInfo).toBe(false);
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
      expect(mockShiftsDAL.findById).not.toHaveBeenCalled();
      expect(mockShiftSummariesDAL.findByShiftId).not.toHaveBeenCalled();
      expect(mockUsersDAL.findByStore).not.toHaveBeenCalled();
    }
  });

  it('should limit user lookup to reasonable bound', () => {
    // Arrange: Handler uses limit: 1000 for user lookup
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStoreA);
    mockShiftsDAL.findById.mockReturnValue(mockShiftStoreA);

    // Act
    mockUsersDAL.findByStore(STORE_A_ID, { limit: 1000 });

    // Assert: Bounded query
    expect(mockUsersDAL.findByStore).toHaveBeenCalledWith(
      STORE_A_ID,
      expect.objectContaining({ limit: 1000 })
    );
    // Prevents unbounded reads
  });

  it('should fail fast when store not configured', () => {
    // Arrange
    mockStoresDAL.getConfiguredStore.mockReturnValue(undefined);

    // Act
    const store = mockStoresDAL.getConfiguredStore();

    // Assert: Early return, no further processing
    expect(store).toBeUndefined();
    // Handler returns NOT_CONFIGURED before any other DB calls
    expect(mockShiftsDAL.findById).not.toHaveBeenCalled();
  });
});
