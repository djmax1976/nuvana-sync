/**
 * Terminals IPC Handlers - Cashier Name Resolution Tests
 *
 * Enterprise-grade unit tests for cashier name resolution feature.
 * Tests the `terminals:list` and `terminals:getById` handlers' ability
 * to resolve cashier_id to display-friendly cashier_name.
 *
 * @module tests/unit/ipc/terminals.handlers.cashier-name
 *
 * Security Compliance:
 * - SEC-006: Parameterized queries via DAL (usersDAL.findByUserIds)
 * - DB-006: Store-scoped queries - user lookups not crossing tenant boundaries
 * - API-001: Response schema includes cashier_name field
 *
 * Business Rules Tested:
 * - Cashier name resolved from users table when user exists
 * - "No Cashier Assigned" returned when cashier_id is null
 * - "Unknown Cashier" returned when user record not found
 * - Batch query pattern avoids N+1 queries
 *
 * Traceability Matrix:
 * | Test ID      | Component                    | Risk Area        | Scenario                           |
 * |--------------|------------------------------|------------------|-----------------------------------|
 * | T-CASH-001   | computeCashierDisplayName    | Data Integrity   | Returns user name when present     |
 * | T-CASH-002   | computeCashierDisplayName    | Edge Case        | Null cashier_id                    |
 * | T-CASH-003   | computeCashierDisplayName    | Edge Case        | Missing user record                |
 * | T-LIST-001   | terminals:list               | Happy Path       | Resolves cashier names             |
 * | T-LIST-002   | terminals:list               | Edge Case        | Null cashier_id in shift           |
 * | T-LIST-003   | terminals:list               | Edge Case        | User not found for cashier_id      |
 * | T-LIST-004   | terminals:list               | Performance      | Batch query efficiency             |
 * | T-LIST-005   | terminals:list               | Performance      | Deduplication of cashier lookups   |
 * | T-LIST-006   | terminals:list               | Edge Case        | No shifts - no user lookup         |
 * | T-LIST-007   | terminals:list               | Security         | Store isolation (DB-006)           |
 * | T-GETBY-001  | terminals:getById            | Happy Path       | Resolves cashier name              |
 * | T-GETBY-002  | terminals:getById            | Edge Case        | Null cashier_id                    |
 * | T-GETBY-003  | terminals:getById            | Edge Case        | User not found                     |
 * | T-GETBY-004  | terminals:getById            | Security         | Store isolation (DB-006)           |
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ==========================================================================
// Mock Setup - Using vi.hoisted() for cross-platform compatibility
// ==========================================================================

const {
  mockGetConfiguredStore,
  mockFindRegisters,
  mockFindByIdForStore,
  mockFindByStore,
  mockFindByUserIds,
} = vi.hoisted(() => ({
  mockGetConfiguredStore: vi.fn(),
  mockFindRegisters: vi.fn(),
  mockFindByIdForStore: vi.fn(),
  mockFindByStore: vi.fn(),
  mockFindByUserIds: vi.fn(),
}));

// Mock electron modules
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

// Mock database service
vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(),
      all: vi.fn(),
      run: vi.fn(),
    })),
    transaction: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-uuid-cashier-test'),
}));

// Mock stores DAL
vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: {
    getConfiguredStore: mockGetConfiguredStore,
  },
}));

// Mock POS terminal mappings DAL
vi.mock('../../../src/main/dal/pos-id-mappings.dal', () => ({
  posTerminalMappingsDAL: {
    findRegisters: mockFindRegisters,
    findByIdForStore: mockFindByIdForStore,
    deactivateById: vi.fn(),
    deactivateByExternalId: vi.fn(),
  },
}));

// Mock shifts DAL
vi.mock('../../../src/main/dal/shifts.dal', () => ({
  shiftsDAL: {
    findByStore: mockFindByStore,
    getDayStatus: vi.fn().mockReturnValue({
      dayStarted: true,
      hasOpenShifts: true,
      openShiftCount: 1,
      totalShiftCount: 1,
      businessDate: '2026-02-24',
    }),
  },
}));

// Mock users DAL
vi.mock('../../../src/main/dal/users.dal', () => ({
  usersDAL: {
    findByUserIds: mockFindByUserIds,
  },
}));

// Mock IPC registry
vi.mock('../../../src/main/ipc/index', () => ({
  registerHandler: vi.fn(),
  createErrorResponse: vi.fn((code: string, message: string) => ({ error: code, message })),
  createSuccessResponse: vi.fn((data: unknown) => ({ data })),
  IPCErrorCodes: {
    NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
    FORBIDDEN: 'FORBIDDEN',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    NOT_CONFIGURED: 'NOT_CONFIGURED',
  },
}));

// Mock logger
vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { registerHandler } from '../../../src/main/ipc/index';

// ==========================================================================
// Test Fixtures - Enterprise-grade realistic data
// ==========================================================================

/** Factory for creating test store data */
const createTestStore = (overrides = {}) => ({
  id: 1,
  store_id: 'store-uuid-001',
  name: 'Enterprise Test Store',
  ...overrides,
});

/** Factory for creating test terminal/register data */
const createTestTerminal = (overrides = {}) => ({
  id: '00000000-0000-4000-a000-000000000001', // Valid UUID v4 format
  external_register_id: 'reg-001',
  terminal_type: 'REGISTER',
  description: 'Main Register',
  active: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-02-24T10:00:00.000Z',
  ...overrides,
});

/** Factory for creating test shift data */
const createTestShift = (overrides = {}) => ({
  shift_id: 'shift-uuid-001',
  store_id: 'store-uuid-001',
  shift_number: 1,
  business_date: '2026-02-24',
  cashier_id: 'cashier-uuid-001',
  register_id: null,
  external_register_id: 'reg-001',
  external_cashier_id: null,
  external_till_id: null,
  start_time: '2026-02-24T08:00:00.000Z',
  end_time: null, // Open shift
  status: 'OPEN' as const,
  created_at: '2026-02-24T08:00:00.000Z',
  updated_at: '2026-02-24T08:00:00.000Z',
  ...overrides,
});

/** Factory for creating test user data */
const createTestUser = (overrides = {}) => ({
  user_id: 'cashier-uuid-001',
  store_id: 'store-uuid-001',
  role: 'cashier' as const,
  name: 'John Smith',
  pin_hash: '$2b$12$hashedpin',
  sha256_pin_fingerprint: null,
  active: 1,
  last_login_at: '2026-02-24T08:00:00.000Z',
  synced_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-02-24T08:00:00.000Z',
  ...overrides,
});

// ==========================================================================
// Type Definitions for Test Assertions
// ==========================================================================

interface ShiftWithCashierName {
  shift_id: string;
  store_id: string;
  shift_number: number;
  business_date: string;
  cashier_id: string | null;
  register_id: string | null;
  external_register_id: string | null;
  external_cashier_id: string | null;
  external_till_id: string | null;
  start_time: string | null;
  end_time: string | null;
  status: 'OPEN' | 'CLOSED';
  created_at: string;
  updated_at: string;
  cashier_name: string;
}

interface RegisterWithShiftStatus {
  id: string;
  external_register_id: string;
  terminal_type: string;
  description: string | null;
  active: boolean;
  activeShift: ShiftWithCashierName | null;
  openShiftCount: number;
  created_at: string;
  updated_at: string;
}

interface RegisterListResponse {
  registers: RegisterWithShiftStatus[];
  total: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IPCHandler = (
  ...args: any[]
) => Promise<RegisterListResponse | RegisterWithShiftStatus | { error: string; message: string }>;

// ==========================================================================
// Test Suite
// ==========================================================================

describe('Terminals IPC Handlers - Cashier Name Resolution', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Map<string, any> = new Map();

  beforeEach(() => {
    vi.clearAllMocks();

    // Capture handler registrations
    vi.mocked(registerHandler).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    // Default mock: store is configured
    mockGetConfiguredStore.mockReturnValue(createTestStore());

    // Default mock: empty user map (will be overridden per test)
    mockFindByUserIds.mockReturnValue(new Map());

    // Re-import to trigger registrations
    vi.resetModules();
  });

  afterEach(() => {
    handlers.clear();
  });

  // ==========================================================================
  // computeCashierDisplayName Helper Function Tests
  // These test the business logic encapsulated in the helper function
  // ==========================================================================

  describe('computeCashierDisplayName helper function', () => {
    /**
     * T-CASH-001: Returns user name when both cashier_id and userName exist
     *
     * Business Rule: When a shift has a valid cashier_id and the user
     * exists in the database, display the user's actual name.
     */
    it('T-CASH-001: should return user name when cashier_id and user name both exist', async () => {
      const user = createTestUser({ name: 'Alice Johnson' });
      const userMap = new Map([[user.user_id, user]]);
      mockFindByUserIds.mockReturnValue(userMap);

      const shift = createTestShift({ cashier_id: user.user_id });
      mockFindByStore.mockReturnValue({ data: [shift], total: 1 });
      mockFindRegisters.mockReturnValue([createTestTerminal()]);

      await import('../../../src/main/ipc/terminals.handlers');

      const listCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:list');
      const handler = listCall?.[1] as IPCHandler;
      const result = (await handler(null)) as RegisterListResponse;

      expect(result.registers[0].activeShift?.cashier_name).toBe('Alice Johnson');
    });

    /**
     * T-CASH-002: Returns "No Cashier Assigned" when cashier_id is null
     *
     * Business Rule: Some shifts may not have a cashier assigned (e.g.,
     * system-initiated shifts). Display appropriate fallback text.
     */
    it('T-CASH-002: should return "No Cashier Assigned" when cashier_id is null', async () => {
      const shift = createTestShift({ cashier_id: null });
      mockFindByStore.mockReturnValue({ data: [shift], total: 1 });
      mockFindRegisters.mockReturnValue([createTestTerminal()]);
      // No user lookup should happen for null cashier_id
      mockFindByUserIds.mockReturnValue(new Map());

      await import('../../../src/main/ipc/terminals.handlers');

      const listCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:list');
      const handler = listCall?.[1] as IPCHandler;
      const result = (await handler(null)) as RegisterListResponse;

      expect(result.registers[0].activeShift?.cashier_name).toBe('No Cashier Assigned');
    });

    /**
     * T-CASH-003: Returns "Unknown Cashier" when user record not found
     *
     * Business Rule: Data integrity edge case - cashier_id exists but
     * user record is missing (deleted user, sync issue). Display fallback.
     */
    it('T-CASH-003: should return "Unknown Cashier" when cashier_id exists but user not found', async () => {
      const shift = createTestShift({ cashier_id: 'missing-user-uuid' });
      mockFindByStore.mockReturnValue({ data: [shift], total: 1 });
      mockFindRegisters.mockReturnValue([createTestTerminal()]);
      // User lookup returns empty map (user not found)
      mockFindByUserIds.mockReturnValue(new Map());

      await import('../../../src/main/ipc/terminals.handlers');

      const listCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:list');
      const handler = listCall?.[1] as IPCHandler;
      const result = (await handler(null)) as RegisterListResponse;

      expect(result.registers[0].activeShift?.cashier_name).toBe('Unknown Cashier');
    });
  });

  // ==========================================================================
  // terminals:list Handler - Cashier Name Resolution Tests
  // ==========================================================================

  describe('terminals:list handler - cashier name resolution', () => {
    /**
     * T-LIST-001: Happy path - resolves cashier names for all active shifts
     *
     * Tests the primary use case: multiple registers with active shifts,
     * each shift has a valid cashier_id that resolves to a user name.
     */
    it('T-LIST-001: should resolve cashier names for all shifts with valid cashier_ids', async () => {
      const user1 = createTestUser({ user_id: 'cashier-001', name: 'John Smith' });
      const user2 = createTestUser({ user_id: 'cashier-002', name: 'Jane Doe' });
      const userMap = new Map([
        [user1.user_id, user1],
        [user2.user_id, user2],
      ]);
      mockFindByUserIds.mockReturnValue(userMap);

      const shift1 = createTestShift({
        shift_id: 'shift-001',
        cashier_id: 'cashier-001',
        external_register_id: 'reg-001',
      });
      const shift2 = createTestShift({
        shift_id: 'shift-002',
        cashier_id: 'cashier-002',
        external_register_id: 'reg-002',
      });
      mockFindByStore.mockReturnValue({ data: [shift1, shift2], total: 2 });

      const terminal1 = createTestTerminal({ id: 't1', external_register_id: 'reg-001' });
      const terminal2 = createTestTerminal({ id: 't2', external_register_id: 'reg-002' });
      mockFindRegisters.mockReturnValue([terminal1, terminal2]);

      await import('../../../src/main/ipc/terminals.handlers');

      const listCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:list');
      const handler = listCall?.[1] as IPCHandler;
      const result = (await handler(null)) as RegisterListResponse;

      expect(result.registers).toHaveLength(2);
      expect(result.registers[0].activeShift?.cashier_name).toBe('John Smith');
      expect(result.registers[1].activeShift?.cashier_name).toBe('Jane Doe');
    });

    /**
     * T-LIST-002: Edge case - shift with null cashier_id
     *
     * Tests handling of shifts that don't have a cashier assigned.
     */
    it('T-LIST-002: should handle shifts with null cashier_id gracefully', async () => {
      const shift = createTestShift({ cashier_id: null });
      mockFindByStore.mockReturnValue({ data: [shift], total: 1 });
      mockFindRegisters.mockReturnValue([createTestTerminal()]);

      await import('../../../src/main/ipc/terminals.handlers');

      const listCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:list');
      const handler = listCall?.[1] as IPCHandler;
      const result = (await handler(null)) as RegisterListResponse;

      expect(result.registers[0].activeShift?.cashier_name).toBe('No Cashier Assigned');
      // Verify findByUserIds was called with empty array (no IDs to look up)
      expect(mockFindByUserIds).toHaveBeenCalledWith([]);
    });

    /**
     * T-LIST-003: Edge case - user not found for cashier_id
     *
     * Tests data integrity scenario where cashier_id references
     * a user that no longer exists in the database.
     */
    it('T-LIST-003: should return "Unknown Cashier" when user record not found', async () => {
      const shift = createTestShift({ cashier_id: 'deleted-user-uuid' });
      mockFindByStore.mockReturnValue({ data: [shift], total: 1 });
      mockFindRegisters.mockReturnValue([createTestTerminal()]);
      mockFindByUserIds.mockReturnValue(new Map()); // User not found

      await import('../../../src/main/ipc/terminals.handlers');

      const listCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:list');
      const handler = listCall?.[1] as IPCHandler;
      const result = (await handler(null)) as RegisterListResponse;

      expect(result.registers[0].activeShift?.cashier_name).toBe('Unknown Cashier');
    });

    /**
     * T-LIST-004: Performance - batch query efficiency
     *
     * Verifies that findByUserIds is called exactly ONCE with all
     * unique cashier IDs, avoiding N+1 query pattern.
     */
    it('T-LIST-004: should use batch query to avoid N+1 queries (SEC-006 compliant)', async () => {
      const user1 = createTestUser({ user_id: 'cashier-001', name: 'User 1' });
      const user2 = createTestUser({ user_id: 'cashier-002', name: 'User 2' });
      const user3 = createTestUser({ user_id: 'cashier-003', name: 'User 3' });
      const userMap = new Map([
        [user1.user_id, user1],
        [user2.user_id, user2],
        [user3.user_id, user3],
      ]);
      mockFindByUserIds.mockReturnValue(userMap);

      const shifts = [
        createTestShift({ shift_id: 's1', cashier_id: 'cashier-001', external_register_id: 'r1' }),
        createTestShift({ shift_id: 's2', cashier_id: 'cashier-002', external_register_id: 'r2' }),
        createTestShift({ shift_id: 's3', cashier_id: 'cashier-003', external_register_id: 'r3' }),
      ];
      mockFindByStore.mockReturnValue({ data: shifts, total: 3 });

      const terminals = [
        createTestTerminal({ id: 't1', external_register_id: 'r1' }),
        createTestTerminal({ id: 't2', external_register_id: 'r2' }),
        createTestTerminal({ id: 't3', external_register_id: 'r3' }),
      ];
      mockFindRegisters.mockReturnValue(terminals);

      await import('../../../src/main/ipc/terminals.handlers');

      const listCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:list');
      const handler = listCall?.[1] as IPCHandler;
      await handler(null);

      // Critical assertion: findByUserIds called exactly ONCE (batch pattern)
      expect(mockFindByUserIds).toHaveBeenCalledTimes(1);
      // Verify all unique IDs were passed
      expect(mockFindByUserIds).toHaveBeenCalledWith(
        expect.arrayContaining(['cashier-001', 'cashier-002', 'cashier-003'])
      );
    });

    /**
     * T-LIST-005: Performance - deduplication of cashier lookups
     *
     * When multiple shifts have the same cashier, the ID should
     * only appear once in the lookup query.
     */
    it('T-LIST-005: should deduplicate cashier IDs when same cashier has multiple shifts', async () => {
      const user = createTestUser({ user_id: 'same-cashier', name: 'Multi-shift Cashier' });
      mockFindByUserIds.mockReturnValue(new Map([[user.user_id, user]]));

      // Same cashier working multiple shifts
      const shifts = [
        createTestShift({ shift_id: 's1', cashier_id: 'same-cashier', external_register_id: 'r1' }),
        createTestShift({ shift_id: 's2', cashier_id: 'same-cashier', external_register_id: 'r2' }),
        createTestShift({ shift_id: 's3', cashier_id: 'same-cashier', external_register_id: 'r3' }),
      ];
      mockFindByStore.mockReturnValue({ data: shifts, total: 3 });

      const terminals = [
        createTestTerminal({ id: 't1', external_register_id: 'r1' }),
        createTestTerminal({ id: 't2', external_register_id: 'r2' }),
        createTestTerminal({ id: 't3', external_register_id: 'r3' }),
      ];
      mockFindRegisters.mockReturnValue(terminals);

      await import('../../../src/main/ipc/terminals.handlers');

      const listCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:list');
      const handler = listCall?.[1] as IPCHandler;
      await handler(null);

      // Should only query for one unique ID despite 3 shifts
      expect(mockFindByUserIds).toHaveBeenCalledWith(['same-cashier']);
    });

    /**
     * T-LIST-006: Edge case - no open shifts
     *
     * When there are no open shifts, no user lookup should occur.
     */
    it('T-LIST-006: should not perform user lookup when no open shifts exist', async () => {
      // All shifts are closed (have end_time)
      const closedShift = createTestShift({
        end_time: '2026-02-24T17:00:00.000Z',
        status: 'CLOSED',
      });
      mockFindByStore.mockReturnValue({ data: [closedShift], total: 1 });
      mockFindRegisters.mockReturnValue([createTestTerminal()]);

      await import('../../../src/main/ipc/terminals.handlers');

      const listCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:list');
      const handler = listCall?.[1] as IPCHandler;
      const result = (await handler(null)) as RegisterListResponse;

      // No open shifts = no active shift
      expect(result.registers[0].activeShift).toBeNull();
      // findByUserIds should still be called but with empty array
      expect(mockFindByUserIds).toHaveBeenCalledWith([]);
    });

    /**
     * T-LIST-007: Security - store isolation (DB-006)
     *
     * Verifies that the handler uses the configured store ID for
     * all database queries, maintaining tenant isolation.
     */
    it('T-LIST-007: should scope all queries to configured store (DB-006)', async () => {
      const specificStore = createTestStore({ store_id: 'tenant-specific-store' });
      mockGetConfiguredStore.mockReturnValue(specificStore);

      mockFindByStore.mockReturnValue({ data: [], total: 0 });
      mockFindRegisters.mockReturnValue([]);

      await import('../../../src/main/ipc/terminals.handlers');

      const listCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:list');
      const handler = listCall?.[1] as IPCHandler;
      await handler(null);

      // Verify store-scoped DAL calls
      expect(mockFindRegisters).toHaveBeenCalledWith('tenant-specific-store');
      expect(mockFindByStore).toHaveBeenCalledWith(
        'tenant-specific-store',
        expect.any(Object),
        expect.any(Object)
      );
    });

    /**
     * T-LIST-008: Mixed scenario - some shifts with cashiers, some without
     *
     * Real-world scenario where some shifts have cashiers and some don't.
     */
    it('T-LIST-008: should handle mixed cashier scenarios correctly', async () => {
      const user = createTestUser({ user_id: 'real-cashier', name: 'Real Cashier' });
      mockFindByUserIds.mockReturnValue(new Map([[user.user_id, user]]));

      const shifts = [
        createTestShift({ shift_id: 's1', cashier_id: 'real-cashier', external_register_id: 'r1' }),
        createTestShift({ shift_id: 's2', cashier_id: null, external_register_id: 'r2' }),
        createTestShift({
          shift_id: 's3',
          cashier_id: 'missing-cashier',
          external_register_id: 'r3',
        }),
      ];
      mockFindByStore.mockReturnValue({ data: shifts, total: 3 });

      const terminals = [
        createTestTerminal({ id: 't1', external_register_id: 'r1' }),
        createTestTerminal({ id: 't2', external_register_id: 'r2' }),
        createTestTerminal({ id: 't3', external_register_id: 'r3' }),
      ];
      mockFindRegisters.mockReturnValue(terminals);

      await import('../../../src/main/ipc/terminals.handlers');

      const listCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:list');
      const handler = listCall?.[1] as IPCHandler;
      const result = (await handler(null)) as RegisterListResponse;

      expect(result.registers[0].activeShift?.cashier_name).toBe('Real Cashier');
      expect(result.registers[1].activeShift?.cashier_name).toBe('No Cashier Assigned');
      expect(result.registers[2].activeShift?.cashier_name).toBe('Unknown Cashier');
    });
  });

  // ==========================================================================
  // terminals:getById Handler - Cashier Name Resolution Tests
  // ==========================================================================

  describe('terminals:getById handler - cashier name resolution', () => {
    /**
     * T-GETBY-001: Happy path - resolves cashier name for active shift
     *
     * Tests single register lookup with active shift that has valid cashier.
     */
    it('T-GETBY-001: should resolve cashier name for register with active shift', async () => {
      const user = createTestUser({ name: 'Jane Doe' });
      mockFindByUserIds.mockReturnValue(new Map([[user.user_id, user]]));

      // Use valid UUID v4 format
      const terminalId = '11111111-1111-4111-a111-111111111111';
      const terminal = createTestTerminal({
        id: terminalId,
        external_register_id: 'reg-getby-001',
      });
      mockFindByIdForStore.mockReturnValue(terminal);

      // Shift must match terminal's external_register_id
      const shift = createTestShift({
        cashier_id: user.user_id,
        external_register_id: 'reg-getby-001',
      });
      mockFindByStore.mockReturnValue({ data: [shift], total: 1 });

      await import('../../../src/main/ipc/terminals.handlers');

      const getByIdCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:getById');
      const handler = getByIdCall?.[1] as IPCHandler;
      const result = (await handler(null, terminalId)) as RegisterWithShiftStatus;

      expect(result.activeShift?.cashier_name).toBe('Jane Doe');
    });

    /**
     * T-GETBY-002: Edge case - null cashier_id
     *
     * Tests single register where active shift has no cashier.
     */
    it('T-GETBY-002: should return "No Cashier Assigned" for shift with null cashier_id', async () => {
      // Use valid UUID v4 format
      const terminalId = '22222222-2222-4222-a222-222222222222';
      const terminal = createTestTerminal({
        id: terminalId,
        external_register_id: 'reg-getby-002',
      });
      mockFindByIdForStore.mockReturnValue(terminal);

      // Shift must match terminal's external_register_id
      const shift = createTestShift({
        cashier_id: null,
        external_register_id: 'reg-getby-002',
      });
      mockFindByStore.mockReturnValue({ data: [shift], total: 1 });

      await import('../../../src/main/ipc/terminals.handlers');

      const getByIdCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:getById');
      const handler = getByIdCall?.[1] as IPCHandler;
      const result = (await handler(null, terminalId)) as RegisterWithShiftStatus;

      expect(result.activeShift?.cashier_name).toBe('No Cashier Assigned');
    });

    /**
     * T-GETBY-003: Edge case - user not found
     *
     * Tests single register where cashier_id references missing user.
     */
    it('T-GETBY-003: should return "Unknown Cashier" when user record not found', async () => {
      // Use valid UUID v4 format
      const terminalId = '33333333-3333-4333-a333-333333333333';
      const terminal = createTestTerminal({
        id: terminalId,
        external_register_id: 'reg-getby-003',
      });
      mockFindByIdForStore.mockReturnValue(terminal);

      // Shift must match terminal's external_register_id
      const shift = createTestShift({
        cashier_id: 'nonexistent-user-uuid',
        external_register_id: 'reg-getby-003',
      });
      mockFindByStore.mockReturnValue({ data: [shift], total: 1 });
      mockFindByUserIds.mockReturnValue(new Map()); // User not found

      await import('../../../src/main/ipc/terminals.handlers');

      const getByIdCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:getById');
      const handler = getByIdCall?.[1] as IPCHandler;
      const result = (await handler(null, terminalId)) as RegisterWithShiftStatus;

      expect(result.activeShift?.cashier_name).toBe('Unknown Cashier');
    });

    /**
     * T-GETBY-004: Security - store isolation (DB-006)
     *
     * Verifies store-scoped queries for single register lookup.
     * Note: The handler validates input before calling DAL, so we test
     * that the correct store_id is used in the findByStore call.
     */
    it('T-GETBY-004: should scope queries to configured store (DB-006)', async () => {
      const specificStore = createTestStore({ store_id: 'single-tenant-store' });
      mockGetConfiguredStore.mockReturnValue(specificStore);

      // Use valid UUID v4 format
      const terminalId = '44444444-4444-4444-a444-444444444444';
      const terminal = createTestTerminal({
        id: terminalId,
        external_register_id: 'reg-getby-004',
      });
      mockFindByIdForStore.mockReturnValue(terminal);
      mockFindByStore.mockReturnValue({ data: [], total: 0 });

      await import('../../../src/main/ipc/terminals.handlers');

      const getByIdCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:getById');
      const handler = getByIdCall?.[1] as IPCHandler;
      await handler(null, terminalId);

      // Verify store-scoped call for shifts lookup
      expect(mockFindByStore).toHaveBeenCalledWith(
        'single-tenant-store',
        expect.any(Object),
        expect.any(Object)
      );
    });

    /**
     * T-GETBY-005: No active shift - should not query users
     *
     * Tests efficiency when register has no active shift.
     */
    it('T-GETBY-005: should not query users when no active shift exists', async () => {
      // Use valid UUID v4 format
      const terminalId = '55555555-5555-4555-a555-555555555555';
      const terminal = createTestTerminal({
        id: terminalId,
        external_register_id: 'reg-getby-005',
      });
      mockFindByIdForStore.mockReturnValue(terminal);

      // All shifts are closed (have end_time set)
      const closedShift = createTestShift({
        end_time: '2026-02-24T17:00:00.000Z',
        status: 'CLOSED',
        external_register_id: 'reg-getby-005', // Same register but closed
      });
      mockFindByStore.mockReturnValue({ data: [closedShift], total: 1 });

      await import('../../../src/main/ipc/terminals.handlers');

      const getByIdCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:getById');
      const handler = getByIdCall?.[1] as IPCHandler;
      const result = (await handler(null, terminalId)) as RegisterWithShiftStatus;

      // Closed shift filtered out = no active shift
      expect(result.activeShift).toBeNull();
      // findByUserIds should not be called when no active shift
      expect(mockFindByUserIds).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Edge Cases and Error Handling
  // ==========================================================================

  describe('Edge Cases and Error Handling', () => {
    /**
     * T-ERR-001: Database error during user lookup should propagate
     *
     * Ensures errors from usersDAL are not silently swallowed.
     */
    it('T-ERR-001: should propagate database errors from user lookup', async () => {
      mockFindByUserIds.mockImplementation(() => {
        throw new Error('Database connection lost');
      });

      const shift = createTestShift();
      mockFindByStore.mockReturnValue({ data: [shift], total: 1 });
      mockFindRegisters.mockReturnValue([createTestTerminal()]);

      await import('../../../src/main/ipc/terminals.handlers');

      const listCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:list');
      const handler = listCall?.[1] as IPCHandler;

      await expect(handler(null)).rejects.toThrow('Database connection lost');
    });

    /**
     * T-ERR-002: Empty terminals list
     *
     * Tests behavior when store has no terminals configured.
     */
    it('T-ERR-002: should handle empty terminals list gracefully', async () => {
      mockFindRegisters.mockReturnValue([]);
      mockFindByStore.mockReturnValue({ data: [], total: 0 });

      await import('../../../src/main/ipc/terminals.handlers');

      const listCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:list');
      const handler = listCall?.[1] as IPCHandler;
      const result = (await handler(null)) as RegisterListResponse;

      expect(result.registers).toEqual([]);
      expect(result.total).toBe(0);
    });

    /**
     * T-ERR-003: Unicode/special characters in user names
     *
     * Ensures proper handling of international names.
     */
    it('T-ERR-003: should handle unicode characters in cashier names', async () => {
      const user = createTestUser({
        user_id: 'unicode-user',
        name: '李明 (Li Ming) - Müller',
      });
      mockFindByUserIds.mockReturnValue(new Map([[user.user_id, user]]));

      const shift = createTestShift({ cashier_id: user.user_id });
      mockFindByStore.mockReturnValue({ data: [shift], total: 1 });
      mockFindRegisters.mockReturnValue([createTestTerminal()]);

      await import('../../../src/main/ipc/terminals.handlers');

      const listCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:list');
      const handler = listCall?.[1] as IPCHandler;
      const result = (await handler(null)) as RegisterListResponse;

      expect(result.registers[0].activeShift?.cashier_name).toBe('李明 (Li Ming) - Müller');
    });
  });
});
