/**
 * Day Close Access Service Unit Tests
 *
 * Tests for centralized day close access validation.
 *
 * Test Coverage:
 * - 1.T1: Service returns `NO_OPEN_SHIFTS` when 0 shifts open
 * - 1.T2: Service returns `MULTIPLE_OPEN_SHIFTS` when 2+ shifts open
 * - 1.T3: Service returns `allowed: true` for shift owner
 * - 1.T4: Service returns `allowed: true` for shift_manager override
 * - 1.T5: Service returns `allowed: true` for store_manager override
 * - 1.T6: Service returns `NOT_SHIFT_OWNER` for non-owner cashier
 * - 1.T7: Service returns `INVALID_PIN` for wrong PIN
 *
 * Security Standards:
 * - SEC-010: Authorization decisions made server-side
 * - SEC-006: Parameterized queries via DAL
 * - DB-006: Store-scoped queries for tenant isolation
 *
 * @module tests/unit/services/day-close-access
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
vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the ShiftsDAL
vi.mock('../../../src/main/dal/shifts.dal', () => ({
  shiftsDAL: {
    getAllOpenShifts: mockGetAllOpenShifts,
  },
}));

// Mock the UsersDAL
vi.mock('../../../src/main/dal/users.dal', () => ({
  usersDAL: {
    findByPin: mockFindByPin,
    findById: mockFindById,
  },
}));

// Mock the POS Terminal Mappings DAL
vi.mock('../../../src/main/dal/pos-id-mappings.dal', () => ({
  posTerminalMappingsDAL: {
    findRegisters: mockFindRegisters,
  },
}));

import {
  validateShiftConditions,
  validateUserAccess,
  checkAccess,
  type DayCloseAccessResult as _DayCloseAccessResult,
} from '../../../src/main/services/day-close-access.service';

describe('Day Close Access Service', () => {
  const TEST_STORE_ID = 'store-test-123';

  // Mock shift data
  const mockShift = {
    shift_id: 'shift-001',
    store_id: TEST_STORE_ID,
    shift_number: 1,
    business_date: '2026-02-12',
    cashier_id: 'user-cashier-001',
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

  // Mock user data - shift owner (cashier)
  const mockCashierOwner = {
    user_id: 'user-cashier-001',
    store_id: TEST_STORE_ID,
    name: 'John Cashier',
    role: 'cashier' as const,
    pin_hash: 'hashed_pin',
    sha256_pin_fingerprint: 'fingerprint_cashier_001',
    active: 1,
    last_login_at: null,
    synced_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  // Mock user data - different cashier (not owner)
  const mockOtherCashier = {
    user_id: 'user-cashier-002',
    store_id: TEST_STORE_ID,
    name: 'Jane Other',
    role: 'cashier' as const,
    pin_hash: 'hashed_pin_2',
    sha256_pin_fingerprint: 'fingerprint_cashier_002',
    active: 1,
    last_login_at: null,
    synced_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  // Mock user data - shift_manager
  const mockShiftManager = {
    user_id: 'user-manager-001',
    store_id: TEST_STORE_ID,
    name: 'Mike Manager',
    role: 'shift_manager' as const,
    pin_hash: 'hashed_pin_mgr',
    sha256_pin_fingerprint: 'fingerprint_manager_001',
    active: 1,
    last_login_at: null,
    synced_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  // Mock user data - store_manager
  const mockStoreManager = {
    user_id: 'user-store-mgr-001',
    store_id: TEST_STORE_ID,
    name: 'Susan Store Manager',
    role: 'store_manager' as const,
    pin_hash: 'hashed_pin_store_mgr',
    sha256_pin_fingerprint: 'fingerprint_store_mgr_001',
    active: 1,
    last_login_at: null,
    synced_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  // Mock terminal data
  const mockTerminals = [
    {
      mapping_id: 'mapping-001',
      store_id: TEST_STORE_ID,
      external_register_id: 'REG01',
      description: 'Front Register',
      active: 1,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindRegisters.mockReturnValue(mockTerminals);
    mockFindById.mockImplementation((userId: string) => {
      if (userId === mockCashierOwner.user_id) return mockCashierOwner;
      if (userId === mockOtherCashier.user_id) return mockOtherCashier;
      if (userId === mockShiftManager.user_id) return mockShiftManager;
      if (userId === mockStoreManager.user_id) return mockStoreManager;
      return undefined;
    });
  });

  describe('validateShiftConditions', () => {
    /**
     * 1.T1: Service returns `NO_OPEN_SHIFTS` when 0 shifts open
     */
    it('should return NO_OPEN_SHIFTS when no shifts are open (BR-001)', () => {
      mockGetAllOpenShifts.mockReturnValue([]);

      const result = validateShiftConditions(TEST_STORE_ID);

      expect(result.valid).toBe(false);
      expect(result.reasonCode).toBe('NO_OPEN_SHIFTS');
      expect(result.openShiftCount).toBe(0);
      expect(result.activeShift).toBeUndefined();
    });

    /**
     * 1.T2: Service returns `MULTIPLE_OPEN_SHIFTS` when 2+ shifts open
     */
    it('should return MULTIPLE_OPEN_SHIFTS when multiple shifts are open (BR-002)', () => {
      const secondShift = { ...mockShift, shift_id: 'shift-002', shift_number: 2 };
      mockGetAllOpenShifts.mockReturnValue([mockShift, secondShift]);

      const result = validateShiftConditions(TEST_STORE_ID);

      expect(result.valid).toBe(false);
      expect(result.reasonCode).toBe('MULTIPLE_OPEN_SHIFTS');
      expect(result.openShiftCount).toBe(2);
      expect(result.activeShift).toBeUndefined();
    });

    it('should return valid with activeShift when exactly one shift is open', () => {
      mockGetAllOpenShifts.mockReturnValue([mockShift]);

      const result = validateShiftConditions(TEST_STORE_ID);

      expect(result.valid).toBe(true);
      expect(result.openShiftCount).toBe(1);
      expect(result.activeShift).toEqual(mockShift);
      expect(result.reasonCode).toBeUndefined();
    });
  });

  describe('validateUserAccess', () => {
    /**
     * 1.T3: Service returns `allowed: true` for shift owner
     */
    it('should grant OWNER access when user is the shift cashier (BR-003)', () => {
      const result = validateUserAccess(mockCashierOwner, mockShift);

      expect(result.canAccess).toBe(true);
      expect(result.accessType).toBe('OWNER');
    });

    /**
     * 1.T4: Service returns `allowed: true` for shift_manager override
     */
    it('should grant OVERRIDE access for shift_manager (BR-004)', () => {
      const result = validateUserAccess(mockShiftManager, mockShift);

      expect(result.canAccess).toBe(true);
      expect(result.accessType).toBe('OVERRIDE');
    });

    /**
     * 1.T5: Service returns `allowed: true` for store_manager override
     */
    it('should grant OVERRIDE access for store_manager (BR-004)', () => {
      const result = validateUserAccess(mockStoreManager, mockShift);

      expect(result.canAccess).toBe(true);
      expect(result.accessType).toBe('OVERRIDE');
    });

    /**
     * 1.T6: Service returns `NOT_SHIFT_OWNER` for non-owner cashier
     */
    it('should deny access for non-owner cashier', () => {
      const result = validateUserAccess(mockOtherCashier, mockShift);

      expect(result.canAccess).toBe(false);
      expect(result.accessType).toBeUndefined();
    });
  });

  describe('checkAccess', () => {
    /**
     * 1.T7: Service returns `INVALID_PIN` for wrong PIN
     */
    it('should return INVALID_PIN when PIN does not match any user', async () => {
      mockFindByPin.mockResolvedValue(undefined);

      const result = await checkAccess(TEST_STORE_ID, { pin: '9999' });

      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('INVALID_PIN');
      expect(result.openShiftCount).toBe(0); // Don't reveal count on auth failure
    });

    it('should grant access for shift owner with valid PIN', async () => {
      mockFindByPin.mockResolvedValue(mockCashierOwner);
      mockGetAllOpenShifts.mockReturnValue([mockShift]);

      const result = await checkAccess(TEST_STORE_ID, { pin: '1234' });

      expect(result.allowed).toBe(true);
      expect(result.accessType).toBe('OWNER');
      expect(result.user?.userId).toBe(mockCashierOwner.user_id);
      expect(result.activeShift?.shift_id).toBe(mockShift.shift_id);
      expect(result.activeShift?.terminal_name).toBe('Front Register');
      expect(result.activeShift?.cashier_name).toBe('John Cashier');
    });

    it('should grant OVERRIDE access for shift_manager', async () => {
      mockFindByPin.mockResolvedValue(mockShiftManager);
      mockGetAllOpenShifts.mockReturnValue([mockShift]);

      const result = await checkAccess(TEST_STORE_ID, { pin: '5678' });

      expect(result.allowed).toBe(true);
      expect(result.accessType).toBe('OVERRIDE');
      expect(result.user?.role).toBe('shift_manager');
    });

    it('should deny access for non-owner cashier even with valid PIN', async () => {
      mockFindByPin.mockResolvedValue(mockOtherCashier);
      mockGetAllOpenShifts.mockReturnValue([mockShift]);

      const result = await checkAccess(TEST_STORE_ID, { pin: '1111' });

      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('NOT_SHIFT_OWNER');
      expect(result.user?.userId).toBe(mockOtherCashier.user_id);
      expect(result.activeShift).toBeDefined();
    });

    it('should deny access for managers when no shifts are open (BR-006)', async () => {
      mockFindByPin.mockResolvedValue(mockShiftManager);
      mockGetAllOpenShifts.mockReturnValue([]);

      const result = await checkAccess(TEST_STORE_ID, { pin: '5678' });

      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('NO_OPEN_SHIFTS');
      // User should still be included so frontend knows who authenticated
      expect(result.user?.userId).toBe(mockShiftManager.user_id);
    });

    it('should deny access for managers when multiple shifts are open (BR-006)', async () => {
      const secondShift = { ...mockShift, shift_id: 'shift-002' };
      mockFindByPin.mockResolvedValue(mockStoreManager);
      mockGetAllOpenShifts.mockReturnValue([mockShift, secondShift]);

      const result = await checkAccess(TEST_STORE_ID, { pin: '9999' });

      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe('MULTIPLE_OPEN_SHIFTS');
      expect(result.openShiftCount).toBe(2);
    });

    it('should resolve terminal name from external_register_id', async () => {
      mockFindByPin.mockResolvedValue(mockCashierOwner);
      mockGetAllOpenShifts.mockReturnValue([mockShift]);

      const result = await checkAccess(TEST_STORE_ID, { pin: '1234' });

      expect(result.activeShift?.terminal_name).toBe('Front Register');
      expect(mockFindRegisters).toHaveBeenCalledWith(TEST_STORE_ID);
    });

    it('should fallback to default terminal name when not found', async () => {
      mockFindRegisters.mockReturnValue([]);
      mockFindByPin.mockResolvedValue(mockCashierOwner);
      mockGetAllOpenShifts.mockReturnValue([mockShift]);

      const result = await checkAccess(TEST_STORE_ID, { pin: '1234' });

      expect(result.activeShift?.terminal_name).toBe('Register REG01');
    });

    it('should handle shift with no external_register_id', async () => {
      const shiftNoRegister = { ...mockShift, external_register_id: null };
      mockFindByPin.mockResolvedValue(mockCashierOwner);
      mockGetAllOpenShifts.mockReturnValue([shiftNoRegister]);

      const result = await checkAccess(TEST_STORE_ID, { pin: '1234' });

      expect(result.activeShift?.terminal_name).toBe('Unknown Register');
    });

    it('should handle shift with no cashier assigned', async () => {
      const shiftNoCashier = { ...mockShift, cashier_id: null };
      // Manager can still close a shift with no cashier
      mockFindByPin.mockResolvedValue(mockShiftManager);
      mockGetAllOpenShifts.mockReturnValue([shiftNoCashier]);

      const result = await checkAccess(TEST_STORE_ID, { pin: '5678' });

      expect(result.allowed).toBe(true);
      expect(result.accessType).toBe('OVERRIDE');
      expect(result.activeShift?.cashier_name).toBe('No Cashier Assigned');
    });
  });

  describe('Security - SEC-006 & DB-006', () => {
    it('should call DAL with correct store_id for tenant isolation', async () => {
      mockFindByPin.mockResolvedValue(mockCashierOwner);
      mockGetAllOpenShifts.mockReturnValue([mockShift]);

      await checkAccess(TEST_STORE_ID, { pin: '1234' });

      expect(mockFindByPin).toHaveBeenCalledWith(TEST_STORE_ID, '1234');
      expect(mockGetAllOpenShifts).toHaveBeenCalledWith(TEST_STORE_ID);
      expect(mockFindRegisters).toHaveBeenCalledWith(TEST_STORE_ID);
    });
  });
});
