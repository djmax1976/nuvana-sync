/**
 * shifts:getById Handler Unit Tests
 *
 * Tests for the shifts:getById IPC handler with cashier name resolution.
 * Follows the handler-capture pattern for direct invocation testing.
 *
 * Test Coverage:
 * - Cashier name resolution from usersDAL.findById
 * - Null cashier_id handling
 * - Non-existent user handling (corrupted data scenario)
 * - Tenant isolation (DB-006)
 * - Input validation (API-001)
 * - Error handling (API-003)
 *
 * Security Standards:
 * - SEC-006: Verifies parameterized queries via DAL
 * - DB-006: Verifies tenant isolation (store_id scoping)
 * - API-001: Input validation with Zod schemas
 * - API-003: Standardized error responses
 *
 * @module tests/unit/ipc/shifts.getById
 */

// Uses vitest globals (configured in vitest.config.ts)

// ============================================================================
// Hoisted mocks for handler capture
// ============================================================================
const {
  capturedHandlers,
  mockCreateErrorResponse,
  mockGetConfiguredStore,
  mockShiftsFindById,
  mockUsersFindById,
  mockLog,
} = vi.hoisted(() => ({
  capturedHandlers: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
  mockCreateErrorResponse: vi.fn((code: string, message: string) => ({ error: code, message })),
  mockGetConfiguredStore: vi.fn(),
  mockShiftsFindById: vi.fn(),
  mockUsersFindById: vi.fn(),
  mockLog: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ============================================================================
// Mock IPC registration — captures handler callbacks for direct invocation
// ============================================================================
vi.mock('../../../src/main/ipc/index', () => ({
  registerHandler: vi.fn(
    (
      channel: string,
      handler: (...args: unknown[]) => Promise<unknown>,
      _options?: unknown
    ) => {
      capturedHandlers[channel] = handler;
    }
  ),
  createErrorResponse: mockCreateErrorResponse,
  IPCErrorCodes: {
    NOT_CONFIGURED: 'NOT_CONFIGURED',
    NOT_FOUND: 'NOT_FOUND',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
    FORBIDDEN: 'FORBIDDEN',
  },
}));

// ============================================================================
// Mock DALs
// ============================================================================
vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: {
    getConfiguredStore: mockGetConfiguredStore,
  },
}));

vi.mock('../../../src/main/dal/shifts.dal', () => ({
  shiftsDAL: {
    findById: mockShiftsFindById,
    findByStore: vi.fn(),
    findByDateRange: vi.fn(),
    close: vi.fn(),
    findByDate: vi.fn(),
    getOrCreateForDate: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/users.dal', () => ({
  usersDAL: {
    findById: mockUsersFindById,
    findByStore: vi.fn(),
    findByPin: vi.fn(),
    verifyPin: vi.fn(),
  },
}));

// Mock other DALs that may be imported by the handler module
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

vi.mock('../../../src/main/dal/shift-summaries.dal', () => ({
  shiftSummariesDAL: {
    findByShiftId: vi.fn(),
    getOrCreateForShift: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/shift-fuel-summaries.dal', () => ({
  shiftFuelSummariesDAL: {
    hasMSMData: vi.fn(),
    getMSMShiftTotals: vi.fn(),
    getMSMFuelByGrade: vi.fn(),
    getTotalsByBusinessDate: vi.fn(),
    getByGradeForBusinessDate: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/day-fuel-summaries.dal', () => ({
  dayFuelSummariesDAL: {
    findByBusinessDate: vi.fn(),
    getDailyTotalsByStoreAndDate: vi.fn(),
    getFuelByGradeForStoreAndDate: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/day-summaries.dal', () => ({
  daySummariesDAL: {
    findByDate: vi.fn(),
    getOrCreateForDate: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/lottery-business-days.dal', () => ({
  lotteryBusinessDaysDAL: {
    findOpenDay: vi.fn(),
    getOrCreateForDate: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/pos-id-mappings.dal', () => ({
  posTerminalMappingsDAL: {
    findRegisters: vi.fn(),
    findByIdForStore: vi.fn(),
  },
}));

// ============================================================================
// Mock logger
// ============================================================================
vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: () => mockLog,
}));

// ============================================================================
// Mock auth (not required for this handler but may be imported)
// ============================================================================
vi.mock('../../../src/main/services/auth.service', () => ({
  getCurrentAuthUser: vi.fn(),
  getCurrentUser: vi.fn(),
  hasMinimumRole: vi.fn(),
}));

// ============================================================================
// Import handler module to trigger registration
// ============================================================================
import '../../../src/main/ipc/shifts.handlers';

// ============================================================================
// Test Constants
// ============================================================================
const TEST_STORE_ID = 'fef13bf7-b0bb-4717-8f54-8b55c1c5b278';
const TEST_SHIFT_ID = '8e775288-ced4-4dbb-8ced-5e4871ba398a';
const TEST_CASHIER_ID = '5e06db5d-9603-460a-933f-552165912972';
const DIFFERENT_STORE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockShift(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    shift_id: TEST_SHIFT_ID,
    store_id: TEST_STORE_ID,
    shift_number: 1,
    business_date: '2026-02-11',
    cashier_id: TEST_CASHIER_ID,
    register_id: null,
    start_time: '2026-02-11T14:30:00.000Z',
    end_time: null,
    status: 'OPEN',
    external_cashier_id: null,
    external_register_id: '1',
    external_till_id: null,
    created_at: '2026-02-11T14:30:00.000Z',
    updated_at: '2026-02-11T14:30:00.000Z',
    ...overrides,
  };
}

function createMockUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    user_id: TEST_CASHIER_ID,
    store_id: TEST_STORE_ID,
    role: 'cashier',
    name: 'Test Cashier',
    pin_hash: '$2b$12$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    active: 1,
    last_login_at: null,
    synced_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMockStore(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    store_id: TEST_STORE_ID,
    company_id: 'company-001',
    name: 'Test Store',
    timezone: 'America/New_York',
    status: 'ACTIVE',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('shifts:getById Handler', () => {
  let handler: (event: unknown, shiftId: unknown) => Promise<unknown>;

  beforeAll(() => {
    // Verify handler was captured
    handler = capturedHandlers['shifts:getById'] as typeof handler;
    expect(handler).toBeDefined();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: store is configured
    mockGetConfiguredStore.mockReturnValue(createMockStore());
  });

  // ==========================================================================
  // Cashier Name Resolution Tests
  // ==========================================================================

  describe('Cashier Name Resolution', () => {
    it('should return cashier_name when user exists', async () => {
      // Arrange
      const mockShift = createMockShift();
      const mockUser = createMockUser({ name: 'John Doe' });

      mockShiftsFindById.mockReturnValue(mockShift);
      mockUsersFindById.mockReturnValue(mockUser);

      // Act
      const result = await handler({}, TEST_SHIFT_ID);

      // Assert
      expect(result).toMatchObject({
        shift_id: TEST_SHIFT_ID,
        cashier_name: 'John Doe',
      });
      expect(mockUsersFindById).toHaveBeenCalledWith(TEST_CASHIER_ID);
    });

    it('should return "No Cashier Assigned" when cashier_id is null', async () => {
      // Arrange
      const mockShift = createMockShift({ cashier_id: null });

      mockShiftsFindById.mockReturnValue(mockShift);

      // Act
      const result = await handler({}, TEST_SHIFT_ID);

      // Assert
      expect(result).toMatchObject({
        shift_id: TEST_SHIFT_ID,
        cashier_name: 'No Cashier Assigned',
      });
      // Should NOT call usersDAL.findById when cashier_id is null
      expect(mockUsersFindById).not.toHaveBeenCalled();
    });

    it('should return "Unknown Cashier" and log warning when user not found', async () => {
      // Arrange: shift references a user that doesn't exist (corrupted data)
      const mockShift = createMockShift({ cashier_id: 'non-existent-user-id' });

      mockShiftsFindById.mockReturnValue(mockShift);
      mockUsersFindById.mockReturnValue(undefined); // User not found

      // Act
      const result = await handler({}, TEST_SHIFT_ID);

      // Assert
      expect(result).toMatchObject({
        shift_id: TEST_SHIFT_ID,
        cashier_name: 'Unknown Cashier',
      });
      expect(mockUsersFindById).toHaveBeenCalledWith('non-existent-user-id');
      // Should log warning about non-existent user
      expect(mockLog.warn).toHaveBeenCalledWith(
        'Shift references non-existent user',
        expect.objectContaining({
          shiftId: TEST_SHIFT_ID,
          cashierId: 'non-existent-user-id',
        })
      );
    });

    it('should preserve all shift fields in response', async () => {
      // Arrange
      const mockShift = createMockShift({
        shift_number: 5,
        status: 'CLOSED',
        end_time: '2026-02-11T22:00:00.000Z',
      });
      const mockUser = createMockUser({ name: 'Jane Smith' });

      mockShiftsFindById.mockReturnValue(mockShift);
      mockUsersFindById.mockReturnValue(mockUser);

      // Act
      const result = (await handler({}, TEST_SHIFT_ID)) as Record<string, unknown>;

      // Assert: all original shift fields preserved
      expect(result.shift_id).toBe(TEST_SHIFT_ID);
      expect(result.store_id).toBe(TEST_STORE_ID);
      expect(result.shift_number).toBe(5);
      expect(result.status).toBe('CLOSED');
      expect(result.end_time).toBe('2026-02-11T22:00:00.000Z');
      expect(result.cashier_id).toBe(TEST_CASHIER_ID);
      // Plus the new cashier_name
      expect(result.cashier_name).toBe('Jane Smith');
    });
  });

  // ==========================================================================
  // Tenant Isolation Tests (DB-006)
  // ==========================================================================

  describe('Tenant Isolation (DB-006)', () => {
    it('should return NOT_FOUND when shift belongs to different store', async () => {
      // Arrange: shift exists but belongs to a different store
      const mockShift = createMockShift({ store_id: DIFFERENT_STORE_ID });

      mockShiftsFindById.mockReturnValue(mockShift);
      mockGetConfiguredStore.mockReturnValue(createMockStore({ store_id: TEST_STORE_ID }));

      // Act
      const result = await handler({}, TEST_SHIFT_ID);

      // Assert: returns NOT_FOUND (not FORBIDDEN) to prevent tenant enumeration
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('NOT_FOUND', 'Shift not found');
      expect(result).toEqual({ error: 'NOT_FOUND', message: 'Shift not found' });
    });

    it('should return NOT_FOUND when store is not configured', async () => {
      // Arrange: no store configured
      mockGetConfiguredStore.mockReturnValue(null);
      mockShiftsFindById.mockReturnValue(createMockShift());

      // Act
      const result = await handler({}, TEST_SHIFT_ID);

      // Assert
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('NOT_FOUND', 'Shift not found');
      expect(result).toEqual({ error: 'NOT_FOUND', message: 'Shift not found' });
    });

    it('should succeed when shift store_id matches configured store', async () => {
      // Arrange
      const mockShift = createMockShift({ store_id: TEST_STORE_ID });
      const mockUser = createMockUser();

      mockShiftsFindById.mockReturnValue(mockShift);
      mockUsersFindById.mockReturnValue(mockUser);
      mockGetConfiguredStore.mockReturnValue(createMockStore({ store_id: TEST_STORE_ID }));

      // Act
      const result = (await handler({}, TEST_SHIFT_ID)) as Record<string, unknown>;

      // Assert: successful response
      expect(result.shift_id).toBe(TEST_SHIFT_ID);
      expect(result.cashier_name).toBe('Test Cashier');
      expect(mockCreateErrorResponse).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Input Validation Tests (API-001)
  // ==========================================================================

  describe('Input Validation (API-001)', () => {
    it('should return VALIDATION_ERROR for invalid UUID format', async () => {
      // Act
      const result = await handler({}, 'not-a-valid-uuid');

      // Assert
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        'Invalid shift ID format'
      );
      expect(result).toEqual({ error: 'VALIDATION_ERROR', message: 'Invalid shift ID format' });
      // Should NOT call DAL methods
      expect(mockShiftsFindById).not.toHaveBeenCalled();
    });

    it('should return VALIDATION_ERROR for empty string', async () => {
      // Act
      const result = await handler({}, '');

      // Assert
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        'Invalid shift ID format'
      );
      expect(result).toEqual({ error: 'VALIDATION_ERROR', message: 'Invalid shift ID format' });
    });

    it('should return VALIDATION_ERROR for null input', async () => {
      // Act
      const result = await handler({}, null);

      // Assert
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        'Invalid shift ID format'
      );
    });

    it('should return VALIDATION_ERROR for undefined input', async () => {
      // Act
      const result = await handler({}, undefined);

      // Assert
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        'Invalid shift ID format'
      );
    });

    it('should accept valid UUID format', async () => {
      // Arrange
      const validUUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      mockShiftsFindById.mockReturnValue(createMockShift({ shift_id: validUUID }));
      mockUsersFindById.mockReturnValue(createMockUser());

      // Act
      const result = (await handler({}, validUUID)) as Record<string, unknown>;

      // Assert: should proceed to query
      expect(mockShiftsFindById).toHaveBeenCalledWith(validUUID);
      expect(result.shift_id).toBe(validUUID);
    });
  });

  // ==========================================================================
  // Error Handling Tests (API-003)
  // ==========================================================================

  describe('Error Handling (API-003)', () => {
    it('should return NOT_FOUND when shift does not exist', async () => {
      // Arrange
      mockShiftsFindById.mockReturnValue(undefined);

      // Act
      const result = await handler({}, TEST_SHIFT_ID);

      // Assert
      expect(mockCreateErrorResponse).toHaveBeenCalledWith('NOT_FOUND', 'Shift not found');
      expect(result).toEqual({ error: 'NOT_FOUND', message: 'Shift not found' });
    });

    it('should handle DAL errors gracefully', async () => {
      // Arrange: DAL throws an error
      mockShiftsFindById.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      // Act & Assert
      await expect(handler({}, TEST_SHIFT_ID)).rejects.toThrow('Database connection failed');

      // Error should be logged
      expect(mockLog.error).toHaveBeenCalledWith(
        'Failed to get shift',
        expect.objectContaining({
          shiftId: TEST_SHIFT_ID,
          error: 'Database connection failed',
        })
      );
    });
  });

  // ==========================================================================
  // SEC-006 Compliance Tests (Parameterized Queries)
  // ==========================================================================

  describe('SEC-006 Compliance (Parameterized Queries)', () => {
    it('should use DAL methods that implement parameterized queries', async () => {
      // Arrange
      mockShiftsFindById.mockReturnValue(createMockShift());
      mockUsersFindById.mockReturnValue(createMockUser());

      // Act
      await handler({}, TEST_SHIFT_ID);

      // Assert: DAL methods are called (they implement parameterized queries)
      expect(mockShiftsFindById).toHaveBeenCalledWith(TEST_SHIFT_ID);
      expect(mockUsersFindById).toHaveBeenCalledWith(TEST_CASHIER_ID);
      // The DAL implementations use ? placeholders - verified in base.dal.ts
    });

    it('should never concatenate user input into queries', async () => {
      // Arrange: attempt SQL injection in shift ID
      const maliciousInput = "'; DROP TABLE shifts; --";

      // Act
      const result = await handler({}, maliciousInput);

      // Assert: input validation rejects before reaching DAL
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        'Invalid shift ID format'
      );
      // DAL should never be called with malicious input
      expect(mockShiftsFindById).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Performance Considerations
  // ==========================================================================

  describe('Performance', () => {
    it('should not call usersDAL.findById when cashier_id is null (optimization)', async () => {
      // Arrange
      mockShiftsFindById.mockReturnValue(createMockShift({ cashier_id: null }));

      // Act
      await handler({}, TEST_SHIFT_ID);

      // Assert: no unnecessary user lookup
      expect(mockUsersFindById).not.toHaveBeenCalled();
    });

    it('should perform exactly 2 DAL calls when cashier exists', async () => {
      // Arrange
      mockShiftsFindById.mockReturnValue(createMockShift());
      mockUsersFindById.mockReturnValue(createMockUser());

      // Act
      await handler({}, TEST_SHIFT_ID);

      // Assert: exactly 2 calls (shift + user)
      expect(mockShiftsFindById).toHaveBeenCalledTimes(1);
      expect(mockUsersFindById).toHaveBeenCalledTimes(1);
    });
  });
});
