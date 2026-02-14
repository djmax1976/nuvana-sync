/**
 * Day Close Access Security Tests
 *
 * Security-focused tests for day close access validation.
 *
 * Test Coverage:
 * - 1.T10: Security test - Cannot access other store's shifts
 * - Cross-tenant isolation verification
 * - PIN validation security
 *
 * Security Standards:
 * - SEC-010: Authorization enforced server-side
 * - SEC-006: Parameterized queries (no SQL injection)
 * - DB-006: Store-scoped queries for tenant isolation
 * - SEC-014: Input validation
 *
 * @module tests/security/day-close-access
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoist mock functions
const { mockGetAllOpenShifts, mockFindByPin, mockFindById, mockFindRegisters } = vi.hoisted(() => ({
  mockGetAllOpenShifts: vi.fn(),
  mockFindByPin: vi.fn(),
  mockFindById: vi.fn(),
  mockFindRegisters: vi.fn(),
}));

// Mock the logger
vi.mock('../../src/main/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the ShiftsDAL
vi.mock('../../src/main/dal/shifts.dal', () => ({
  shiftsDAL: {
    getAllOpenShifts: mockGetAllOpenShifts,
  },
}));

// Mock the UsersDAL
vi.mock('../../src/main/dal/users.dal', () => ({
  usersDAL: {
    findByPin: mockFindByPin,
    findById: mockFindById,
  },
}));

// Mock the POS Terminal Mappings DAL
vi.mock('../../src/main/dal/pos-id-mappings.dal', () => ({
  posTerminalMappingsDAL: {
    findRegisters: mockFindRegisters,
  },
}));

import {
  checkAccess,
  validateShiftConditions,
} from '../../src/main/services/day-close-access.service';

describe('Day Close Access Security', () => {
  const STORE_A = 'store-a-001';
  const STORE_B = 'store-b-002';

  // Mock shift for Store A
  const storeAShift = {
    shift_id: 'shift-a-001',
    store_id: STORE_A,
    shift_number: 1,
    business_date: '2026-02-12',
    cashier_id: 'user-a-001',
    register_id: null,
    start_time: '2026-02-12T08:00:00.000Z',
    end_time: null,
    status: 'OPEN' as const,
    external_cashier_id: null,
    external_register_id: 'REG01',
    external_till_id: null,
    created_at: '2026-02-12T08:00:00.000Z',
    updated_at: '2026-02-12T08:00:00.000Z',
  };

  // Mock shift for Store B
  const storeBShift = {
    shift_id: 'shift-b-001',
    store_id: STORE_B,
    shift_number: 1,
    business_date: '2026-02-12',
    cashier_id: 'user-b-001',
    register_id: null,
    start_time: '2026-02-12T08:00:00.000Z',
    end_time: null,
    status: 'OPEN' as const,
    external_cashier_id: null,
    external_register_id: 'REG02',
    external_till_id: null,
    created_at: '2026-02-12T08:00:00.000Z',
    updated_at: '2026-02-12T08:00:00.000Z',
  };

  // Mock user for Store A
  const storeAUser = {
    user_id: 'user-a-001',
    store_id: STORE_A,
    name: 'Store A User',
    role: 'cashier' as const,
    pin_hash: 'hashed_pin_a',
    active: 1,
    last_login_at: null,
    synced_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  // Mock user for Store B
  const storeBUser = {
    user_id: 'user-b-001',
    store_id: STORE_B,
    name: 'Store B User',
    role: 'cashier' as const,
    pin_hash: 'hashed_pin_b',
    active: 1,
    last_login_at: null,
    synced_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindRegisters.mockReturnValue([]);
    mockFindById.mockImplementation((userId: string) => {
      if (userId === storeAUser.user_id) return storeAUser;
      if (userId === storeBUser.user_id) return storeBUser;
      return undefined;
    });
  });

  describe('Cross-Tenant Isolation (DB-006)', () => {
    /**
     * 1.T10: Security test - Cannot access other store's shifts
     *
     * This test verifies that:
     * 1. DAL queries are called with the correct store_id
     * 2. A user from Store A cannot see or access shifts from Store B
     * 3. The service properly scopes all queries
     */
    it('should only see shifts for the queried store', async () => {
      // When querying Store A, should only return Store A shifts
      mockGetAllOpenShifts.mockImplementation((storeId: string) => {
        if (storeId === STORE_A) return [storeAShift];
        if (storeId === STORE_B) return [storeBShift];
        return [];
      });

      const resultA = validateShiftConditions(STORE_A);
      const resultB = validateShiftConditions(STORE_B);

      // Verify correct store was queried
      expect(mockGetAllOpenShifts).toHaveBeenCalledWith(STORE_A);
      expect(mockGetAllOpenShifts).toHaveBeenCalledWith(STORE_B);

      // Verify results are scoped correctly
      expect(resultA.activeShift?.store_id).toBe(STORE_A);
      expect(resultB.activeShift?.store_id).toBe(STORE_B);
    });

    it('should authenticate users only within their store scope', async () => {
      // findByPin is store-scoped - only finds users in that store
      mockFindByPin.mockImplementation((storeId: string, _pin: string) => {
        if (storeId === STORE_A) return storeAUser;
        if (storeId === STORE_B) return storeBUser;
        return undefined;
      });

      mockGetAllOpenShifts.mockImplementation((storeId: string) => {
        if (storeId === STORE_A) return [storeAShift];
        if (storeId === STORE_B) return [storeBShift];
        return [];
      });

      const resultA = await checkAccess(STORE_A, { pin: '1234' });

      // Verify PIN lookup is store-scoped
      expect(mockFindByPin).toHaveBeenCalledWith(STORE_A, '1234');

      // Verify result contains only Store A data
      expect(resultA.user?.userId).toBe(storeAUser.user_id);
      expect(resultA.activeShift?.shift_id).toBe(storeAShift.shift_id);
    });

    it('should not allow cross-store access even with valid PIN', async () => {
      // Store A user tries to access Store B
      // findByPin returns undefined because user doesn't exist in Store B
      mockFindByPin.mockImplementation((storeId: string, _pin: string) => {
        // Store A user's PIN only works in Store A
        if (storeId === STORE_A) return storeAUser;
        return undefined; // PIN doesn't work in other stores
      });

      mockGetAllOpenShifts.mockReturnValue([storeBShift]);

      // User tries to access Store B (not their store)
      const result = await checkAccess(STORE_B, { pin: '1234' });

      // Should fail because PIN lookup is store-scoped
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('INVALID_PIN');

      // Verify the PIN was checked against Store B (not Store A)
      expect(mockFindByPin).toHaveBeenCalledWith(STORE_B, '1234');
    });
  });

  describe('Input Validation Security (SEC-014)', () => {
    it('should handle malicious PIN inputs safely', async () => {
      mockFindByPin.mockResolvedValue(undefined);

      // SQL injection attempt - service should handle this safely
      // because DAL uses parameterized queries
      const result = await checkAccess(STORE_A, {
        pin: "'; DROP TABLE users; --" as unknown as string,
      });

      // Should simply fail authentication, not crash or inject SQL
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('INVALID_PIN');
    });

    it('should handle empty store_id safely', async () => {
      mockGetAllOpenShifts.mockReturnValue([]);
      mockFindByPin.mockResolvedValue(undefined);

      // Empty store_id
      const result = await checkAccess('', { pin: '1234' });

      // Should handle gracefully
      expect(result.allowed).toBe(false);
    });
  });

  describe('Authorization Enforcement (SEC-010)', () => {
    it('should enforce authorization server-side, not trust client claims', async () => {
      // Even if a malicious client claims to be a manager,
      // the server verifies via PIN lookup
      mockFindByPin.mockResolvedValue(storeAUser); // Returns cashier, not manager
      mockGetAllOpenShifts.mockReturnValue([
        { ...storeAShift, cashier_id: 'different-user' }, // Different cashier
      ]);

      const result = await checkAccess(STORE_A, { pin: '1234' });

      // Should deny because user is cashier and not the shift owner
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('NOT_SHIFT_OWNER');
      // Server determined user's actual role, didn't trust any client claim
      expect(result.user?.role).toBe('cashier');
    });

    it('should always check shift conditions even for managers (BR-006)', async () => {
      const manager = {
        ...storeAUser,
        user_id: 'manager-001',
        role: 'store_manager' as const,
      };
      mockFindByPin.mockResolvedValue(manager);
      mockGetAllOpenShifts.mockReturnValue([]); // No open shifts

      const result = await checkAccess(STORE_A, { pin: '9999' });

      // Manager cannot bypass BR-001 (at least one open shift)
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('NO_OPEN_SHIFTS');
    });
  });
});
