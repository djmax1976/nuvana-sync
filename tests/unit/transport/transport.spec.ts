/**
 * Transport Layer Unit Tests
 *
 * Tests for the transport abstraction layer that maps IPC channels to API-like interface.
 * Verifies that transport methods correctly call IPC channels and handle responses.
 *
 * @module tests/unit/transport/transport.spec
 * @security Tests SEC-014 compliance (validated IPC channels via preload)
 * @security Tests DB-006 compliance (store-scoped operations)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mock Setup - Must be hoisted, so use vi.hoisted()
// ============================================================================

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(() => vi.fn()),
  once: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/api/ipc-client', () => ({
  ipcClient: {
    invoke: mocks.invoke,
    on: mocks.on,
    once: mocks.once,
  },
  isElectron: true,
  IPCError: class IPCError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'IPCError';
    }
  },
}));

// Import after mock setup
import { ipc } from '../../../src/renderer/lib/transport/index';

// ============================================================================
// Test Data Factories
// ============================================================================

function createMockOpenShiftsResponse() {
  return {
    open_shifts: [
      {
        shift_id: 'shift-uuid-1',
        terminal_name: 'Register 1',
        cashier_name: 'John Doe',
        shift_number: 1,
        status: 'OPEN' as const,
        external_register_id: 'reg-1',
        business_date: '2026-02-11',
        start_time: '2026-02-11T08:00:00.000Z',
      },
      {
        shift_id: 'shift-uuid-2',
        terminal_name: 'Register 2',
        cashier_name: 'Jane Smith',
        shift_number: 2,
        status: 'OPEN' as const,
        external_register_id: 'reg-2',
        business_date: '2026-02-11',
        start_time: '2026-02-11T09:00:00.000Z',
      },
    ],
  };
}

function createMockShiftResponse() {
  return {
    shift_id: 'shift-uuid-1',
    store_id: 'store-uuid-1',
    shift_number: 1,
    business_date: '2026-02-11',
    cashier_id: 'cashier-uuid-1',
    register_id: 'reg-1',
    start_time: '2026-02-11T08:00:00.000Z',
    end_time: null,
    status: 'OPEN' as const,
    created_at: '2026-02-11T08:00:00.000Z',
    updated_at: '2026-02-11T08:00:00.000Z',
  };
}

function createMockTerminalListResponse() {
  return {
    registers: [
      {
        id: 'mapping-uuid-1',
        external_register_id: 'reg-1',
        terminal_type: 'REGISTER',
        description: 'Main Register',
        active: true,
        activeShift: null,
        openShiftCount: 0,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-02-11T00:00:00.000Z',
      },
      {
        id: 'mapping-uuid-2',
        external_register_id: 'reg-2',
        terminal_type: 'REGISTER',
        description: 'Secondary Register',
        active: true,
        activeShift: createMockShiftResponse(),
        openShiftCount: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-02-11T00:00:00.000Z',
      },
    ],
    total: 2,
  };
}

function createMockCashiersListResponse() {
  return {
    cashiers: [
      { cashier_id: 'user-uuid-1', name: 'John Doe', role: 'cashier' },
      { cashier_id: 'user-uuid-2', name: 'Jane Smith', role: 'shift_manager' },
    ],
    total: 2,
  };
}

function createMockConfiguredStoreResponse() {
  return {
    store_id: 'store-uuid-1',
    name: 'Test Gas Station',
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Transport Layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ==========================================================================
  // shifts.getOpenShifts()
  // ==========================================================================
  describe('shifts.getOpenShifts()', () => {
    describe('happy path', () => {
      it('should call correct IPC channel shifts:getOpenShifts', async () => {
        const mockResponse = createMockOpenShiftsResponse();
        mocks.invoke.mockResolvedValue(mockResponse);

        await ipc.shifts.getOpenShifts();

        expect(mocks.invoke).toHaveBeenCalledTimes(1);
        expect(mocks.invoke).toHaveBeenCalledWith('shifts:getOpenShifts');
      });

      it('should return open shifts with resolved names', async () => {
        const mockResponse = createMockOpenShiftsResponse();
        mocks.invoke.mockResolvedValue(mockResponse);

        const result = await ipc.shifts.getOpenShifts();

        expect(result).toEqual(mockResponse);
        expect(result.open_shifts).toHaveLength(2);
        expect(result.open_shifts[0].terminal_name).toBe('Register 1');
        expect(result.open_shifts[0].cashier_name).toBe('John Doe');
      });
    });

    describe('edge cases', () => {
      it('should handle empty shifts array', async () => {
        const emptyResponse = { open_shifts: [] };
        mocks.invoke.mockResolvedValue(emptyResponse);

        const result = await ipc.shifts.getOpenShifts();

        expect(result.open_shifts).toHaveLength(0);
      });

      it('should handle shifts with null external_register_id', async () => {
        const response = {
          open_shifts: [
            {
              shift_id: 'shift-uuid-1',
              terminal_name: 'Unknown Register',
              cashier_name: 'John Doe',
              shift_number: 1,
              status: 'OPEN' as const,
              external_register_id: null,
              business_date: '2026-02-11',
              start_time: null,
            },
          ],
        };
        mocks.invoke.mockResolvedValue(response);

        const result = await ipc.shifts.getOpenShifts();

        expect(result.open_shifts[0].external_register_id).toBeNull();
      });
    });

    describe('error handling', () => {
      it('should propagate IPC errors', async () => {
        const error = new Error('IPC channel not available');
        mocks.invoke.mockRejectedValue(error);

        await expect(ipc.shifts.getOpenShifts()).rejects.toThrow(
          'IPC channel not available'
        );
      });
    });
  });

  // ==========================================================================
  // shifts.getById()
  // ==========================================================================
  describe('shifts.getById()', () => {
    describe('happy path', () => {
      it('should call correct IPC channel with shiftId', async () => {
        const mockResponse = createMockShiftResponse();
        mocks.invoke.mockResolvedValue(mockResponse);
        const shiftId = 'shift-uuid-1';

        await ipc.shifts.getById(shiftId);

        expect(mocks.invoke).toHaveBeenCalledTimes(1);
        expect(mocks.invoke).toHaveBeenCalledWith('shifts:getById', shiftId);
      });

      it('should return shift details', async () => {
        const mockResponse = createMockShiftResponse();
        mocks.invoke.mockResolvedValue(mockResponse);

        const result = await ipc.shifts.getById('shift-uuid-1');

        expect(result.shift_id).toBe('shift-uuid-1');
        expect(result.status).toBe('OPEN');
        expect(result.business_date).toBe('2026-02-11');
      });
    });

    describe('error handling', () => {
      it('should handle NOT_FOUND error', async () => {
        const error = new Error('Shift not found');
        mocks.invoke.mockRejectedValue(error);

        await expect(ipc.shifts.getById('nonexistent')).rejects.toThrow(
          'Shift not found'
        );
      });
    });
  });

  // ==========================================================================
  // terminals.list()
  // ==========================================================================
  describe('terminals.list()', () => {
    describe('happy path', () => {
      it('should call correct IPC channel terminals:list', async () => {
        const mockResponse = createMockTerminalListResponse();
        mocks.invoke.mockResolvedValue(mockResponse);

        await ipc.terminals.list();

        expect(mocks.invoke).toHaveBeenCalledTimes(1);
        expect(mocks.invoke).toHaveBeenCalledWith('terminals:list');
      });

      it('should return registers with shift status', async () => {
        const mockResponse = createMockTerminalListResponse();
        mocks.invoke.mockResolvedValue(mockResponse);

        const result = await ipc.terminals.list();

        expect(result.registers).toHaveLength(2);
        expect(result.total).toBe(2);
        expect(result.registers[0].description).toBe('Main Register');
        expect(result.registers[1].activeShift).not.toBeNull();
      });
    });

    describe('edge cases', () => {
      it('should handle empty registers array', async () => {
        const emptyResponse = { registers: [], total: 0 };
        mocks.invoke.mockResolvedValue(emptyResponse);

        const result = await ipc.terminals.list();

        expect(result.registers).toHaveLength(0);
        expect(result.total).toBe(0);
      });

      it('should handle registers with null description', async () => {
        const response = {
          registers: [
            {
              id: 'mapping-uuid-1',
              external_register_id: 'reg-1',
              terminal_type: 'REGISTER',
              description: null,
              active: true,
              activeShift: null,
              openShiftCount: 0,
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-02-11T00:00:00.000Z',
            },
          ],
          total: 1,
        };
        mocks.invoke.mockResolvedValue(response);

        const result = await ipc.terminals.list();

        expect(result.registers[0].description).toBeNull();
      });
    });

    describe('error handling', () => {
      it('should propagate NOT_CONFIGURED error', async () => {
        const error = new Error('Store not configured');
        mocks.invoke.mockRejectedValue(error);

        await expect(ipc.terminals.list()).rejects.toThrow('Store not configured');
      });
    });
  });

  // ==========================================================================
  // cashiers.list()
  // ==========================================================================
  describe('cashiers.list()', () => {
    describe('happy path', () => {
      it('should call correct IPC channel cashiers:list', async () => {
        const mockResponse = createMockCashiersListResponse();
        mocks.invoke.mockResolvedValue(mockResponse);

        await ipc.cashiers.list();

        expect(mocks.invoke).toHaveBeenCalledTimes(1);
        expect(mocks.invoke).toHaveBeenCalledWith('cashiers:list');
      });

      it('should return cashiers with role information', async () => {
        const mockResponse = createMockCashiersListResponse();
        mocks.invoke.mockResolvedValue(mockResponse);

        const result = await ipc.cashiers.list();

        expect(result.cashiers).toHaveLength(2);
        expect(result.total).toBe(2);
        expect(result.cashiers[0].name).toBe('John Doe');
        expect(result.cashiers[0].role).toBe('cashier');
        expect(result.cashiers[1].role).toBe('shift_manager');
      });
    });

    describe('edge cases', () => {
      it('should handle empty cashiers array', async () => {
        const emptyResponse = { cashiers: [], total: 0 };
        mocks.invoke.mockResolvedValue(emptyResponse);

        const result = await ipc.cashiers.list();

        expect(result.cashiers).toHaveLength(0);
        expect(result.total).toBe(0);
      });
    });

    describe('security', () => {
      it('should not expose PIN hash (SEC-001 compliance)', async () => {
        // The response should only contain safe fields
        const mockResponse = createMockCashiersListResponse();
        mocks.invoke.mockResolvedValue(mockResponse);

        const result = await ipc.cashiers.list();

        // Verify response structure only contains safe fields
        result.cashiers.forEach((cashier) => {
          expect(cashier).toHaveProperty('cashier_id');
          expect(cashier).toHaveProperty('name');
          expect(cashier).toHaveProperty('role');
          expect(cashier).not.toHaveProperty('pin_hash');
          expect(cashier).not.toHaveProperty('password');
        });
      });
    });

    describe('error handling', () => {
      it('should propagate IPC errors', async () => {
        const error = new Error('Failed to retrieve cashiers');
        mocks.invoke.mockRejectedValue(error);

        await expect(ipc.cashiers.list()).rejects.toThrow(
          'Failed to retrieve cashiers'
        );
      });
    });
  });

  // ==========================================================================
  // store.getConfigured()
  // ==========================================================================
  describe('store.getConfigured()', () => {
    describe('happy path', () => {
      it('should call correct IPC channel store:getConfigured', async () => {
        const mockResponse = createMockConfiguredStoreResponse();
        mocks.invoke.mockResolvedValue(mockResponse);

        await ipc.store.getConfigured();

        expect(mocks.invoke).toHaveBeenCalledTimes(1);
        expect(mocks.invoke).toHaveBeenCalledWith('store:getConfigured');
      });

      it('should return store ID and name', async () => {
        const mockResponse = createMockConfiguredStoreResponse();
        mocks.invoke.mockResolvedValue(mockResponse);

        const result = await ipc.store.getConfigured();

        expect(result.store_id).toBe('store-uuid-1');
        expect(result.name).toBe('Test Gas Station');
      });
    });

    describe('error handling', () => {
      it('should propagate NOT_CONFIGURED error when store not set', async () => {
        const error = new Error('Store not configured');
        mocks.invoke.mockRejectedValue(error);

        await expect(ipc.store.getConfigured()).rejects.toThrow(
          'Store not configured'
        );
      });
    });

    describe('security', () => {
      it('should only return minimal store data (DB-006 compliance)', async () => {
        const mockResponse = createMockConfiguredStoreResponse();
        mocks.invoke.mockResolvedValue(mockResponse);

        const result = await ipc.store.getConfigured();

        // Verify response only contains minimal fields (DB-006: tenant isolation)
        expect(Object.keys(result)).toEqual(['store_id', 'name']);
        expect(result).not.toHaveProperty('company_id');
        expect(result).not.toHaveProperty('api_key');
        expect(result).not.toHaveProperty('secret');
      });
    });
  });

  // ==========================================================================
  // Integration Tests (Multiple Calls)
  // ==========================================================================
  describe('multiple transport calls', () => {
    it('should handle parallel calls correctly', async () => {
      mocks.invoke
        .mockResolvedValueOnce(createMockOpenShiftsResponse())
        .mockResolvedValueOnce(createMockTerminalListResponse())
        .mockResolvedValueOnce(createMockCashiersListResponse())
        .mockResolvedValueOnce(createMockConfiguredStoreResponse());

      const [shifts, terminals, cashiers, store] = await Promise.all([
        ipc.shifts.getOpenShifts(),
        ipc.terminals.list(),
        ipc.cashiers.list(),
        ipc.store.getConfigured(),
      ]);

      expect(mocks.invoke).toHaveBeenCalledTimes(4);
      expect(shifts.open_shifts).toBeDefined();
      expect(terminals.registers).toBeDefined();
      expect(cashiers.cashiers).toBeDefined();
      expect(store.store_id).toBeDefined();
    });

    it('should handle mixed success and failure', async () => {
      mocks.invoke
        .mockResolvedValueOnce(createMockOpenShiftsResponse())
        .mockRejectedValueOnce(new Error('Terminal fetch failed'));

      const shiftsPromise = ipc.shifts.getOpenShifts();
      const terminalsPromise = ipc.terminals.list();

      const shifts = await shiftsPromise;
      await expect(terminalsPromise).rejects.toThrow('Terminal fetch failed');

      expect(shifts.open_shifts).toBeDefined();
    });
  });
});
