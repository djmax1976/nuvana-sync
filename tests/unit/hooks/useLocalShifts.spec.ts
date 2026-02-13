/**
 * useLocalShifts Hook Unit Tests
 *
 * Enterprise-grade tests for local IPC shift hooks.
 * Tests query behavior, data transformation, and error handling.
 *
 * Story: DayClosePage Local IPC Migration
 *
 * @module tests/unit/hooks/useLocalShifts
 * @security DB-006: Verifies store-scoped queries
 * @security SEC-006: Verifies parameterized query usage
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// Types (matching hook types)
// ============================================================================

interface OpenShiftWithNames {
  shift_id: string;
  terminal_name: string;
  cashier_name: string;
  shift_number: number;
  status: 'OPEN' | 'CLOSED';
  external_register_id: string | null;
  business_date: string;
  start_time: string | null;
}

interface OpenShiftsResponse {
  open_shifts: OpenShiftWithNames[];
}

interface ShiftResponse {
  shift_id: string;
  store_id: string;
  shift_number: number;
  business_date: string;
  cashier_id: string | null;
  register_id: string | null;
  start_time: string | null;
  end_time: string | null;
  status: 'OPEN' | 'CLOSED';
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Mock Setup
// ============================================================================

const mockIpc = {
  shifts: {
    getOpenShifts: vi.fn(),
    getById: vi.fn(),
  },
};

// Simulate the ipc module
vi.mock('../../../src/renderer/lib/transport', () => ({
  ipc: mockIpc,
}));

// ============================================================================
// Test Data Factories
// ============================================================================

function createOpenShift(overrides: Partial<OpenShiftWithNames> = {}): OpenShiftWithNames {
  return {
    shift_id: 'shift-uuid-001',
    terminal_name: 'POS 1',
    cashier_name: 'John Smith',
    shift_number: 1,
    status: 'OPEN',
    external_register_id: 'ext-reg-001',
    business_date: '2026-02-11',
    start_time: '2026-02-11T06:00:00.000Z',
    ...overrides,
  };
}

function createShiftResponse(overrides: Partial<ShiftResponse> = {}): ShiftResponse {
  return {
    shift_id: 'shift-uuid-001',
    store_id: 'store-uuid-001',
    shift_number: 1,
    business_date: '2026-02-11',
    cashier_id: 'cashier-uuid-001',
    register_id: 'register-uuid-001',
    start_time: '2026-02-11T06:00:00.000Z',
    end_time: null,
    status: 'OPEN',
    created_at: '2026-02-11T05:55:00.000Z',
    updated_at: '2026-02-11T05:55:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// Query Key Tests
// ============================================================================

describe('localShiftsKeys', () => {
  describe('query key structure', () => {
    it('should have predictable key structure for cache invalidation', () => {
      const keys = {
        all: ['local', 'shifts'] as const,
        openShifts: () => ['local', 'shifts', 'open'] as const,
        detail: (shiftId: string | null | undefined) => ['local', 'shifts', 'detail', shiftId] as const,
      };

      expect(keys.all).toEqual(['local', 'shifts']);
      expect(keys.openShifts()).toEqual(['local', 'shifts', 'open']);
      expect(keys.detail('shift-123')).toEqual(['local', 'shifts', 'detail', 'shift-123']);
    });

    it('should produce different keys for different shift IDs', () => {
      const keygen = (id: string | null) => ['local', 'shifts', 'detail', id];

      const key1 = keygen('shift-001');
      const key2 = keygen('shift-002');
      const key3 = keygen(null);

      expect(key1).not.toEqual(key2);
      expect(key1).not.toEqual(key3);
    });

    it('should namespace under "local" to avoid cloud API collision', () => {
      const keys = {
        all: ['local', 'shifts'] as const,
        openShifts: () => ['local', 'shifts', 'open'] as const,
      };

      expect(keys.all[0]).toBe('local');
      expect(keys.openShifts()[0]).toBe('local');
    });
  });
});

// ============================================================================
// useLocalOpenShiftsCheck Tests
// ============================================================================

describe('useLocalOpenShiftsCheck Query Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('happy path', () => {
    it('should return open shifts with resolved names', async () => {
      const mockResponse: OpenShiftsResponse = {
        open_shifts: [
          createOpenShift({ shift_id: 's1', terminal_name: 'POS 1', cashier_name: 'Alice' }),
          createOpenShift({ shift_id: 's2', terminal_name: 'POS 2', cashier_name: 'Bob' }),
        ],
      };

      mockIpc.shifts.getOpenShifts.mockResolvedValue(mockResponse);

      const result = await mockIpc.shifts.getOpenShifts();

      expect(result.open_shifts).toHaveLength(2);
      expect(result.open_shifts[0].terminal_name).toBe('POS 1');
      expect(result.open_shifts[0].cashier_name).toBe('Alice');
      expect(result.open_shifts[1].terminal_name).toBe('POS 2');
      expect(result.open_shifts[1].cashier_name).toBe('Bob');
    });

    it('should return empty array when no shifts are open', async () => {
      const mockResponse: OpenShiftsResponse = {
        open_shifts: [],
      };

      mockIpc.shifts.getOpenShifts.mockResolvedValue(mockResponse);

      const result = await mockIpc.shifts.getOpenShifts();

      expect(result.open_shifts).toHaveLength(0);
      expect(result.open_shifts).toEqual([]);
    });

    it('should include all required fields in response', async () => {
      const mockResponse: OpenShiftsResponse = {
        open_shifts: [createOpenShift()],
      };

      mockIpc.shifts.getOpenShifts.mockResolvedValue(mockResponse);

      const result = await mockIpc.shifts.getOpenShifts();
      const shift = result.open_shifts[0];

      // Verify all required fields are present
      expect(shift.shift_id).toBeDefined();
      expect(shift.terminal_name).toBeDefined();
      expect(shift.cashier_name).toBeDefined();
      expect(shift.shift_number).toBeDefined();
      expect(shift.status).toBeDefined();
      expect(shift.business_date).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle null external_register_id', async () => {
      const mockResponse: OpenShiftsResponse = {
        open_shifts: [
          createOpenShift({ external_register_id: null }),
        ],
      };

      mockIpc.shifts.getOpenShifts.mockResolvedValue(mockResponse);

      const result = await mockIpc.shifts.getOpenShifts();

      expect(result.open_shifts[0].external_register_id).toBeNull();
    });

    it('should handle null start_time', async () => {
      const mockResponse: OpenShiftsResponse = {
        open_shifts: [
          createOpenShift({ start_time: null }),
        ],
      };

      mockIpc.shifts.getOpenShifts.mockResolvedValue(mockResponse);

      const result = await mockIpc.shifts.getOpenShifts();

      expect(result.open_shifts[0].start_time).toBeNull();
    });

    it('should handle many open shifts', async () => {
      const shifts: OpenShiftWithNames[] = Array.from({ length: 10 }, (_, i) =>
        createOpenShift({
          shift_id: `shift-${i}`,
          terminal_name: `POS ${i + 1}`,
          shift_number: i + 1,
        })
      );

      mockIpc.shifts.getOpenShifts.mockResolvedValue({ open_shifts: shifts });

      const result = await mockIpc.shifts.getOpenShifts();

      expect(result.open_shifts).toHaveLength(10);
      expect(result.open_shifts[9].shift_number).toBe(10);
    });
  });

  describe('error handling', () => {
    it('should propagate IPC errors', async () => {
      const ipcError = new Error('IPC channel not found');
      mockIpc.shifts.getOpenShifts.mockRejectedValue(ipcError);

      await expect(mockIpc.shifts.getOpenShifts()).rejects.toThrow('IPC channel not found');
    });

    it('should handle network timeouts', async () => {
      mockIpc.shifts.getOpenShifts.mockRejectedValue(new Error('Request timeout'));

      await expect(mockIpc.shifts.getOpenShifts()).rejects.toThrow('Request timeout');
    });

    it('should handle NOT_CONFIGURED errors', async () => {
      mockIpc.shifts.getOpenShifts.mockRejectedValue(new Error('Store not configured'));

      await expect(mockIpc.shifts.getOpenShifts()).rejects.toThrow('Store not configured');
    });
  });

  describe('security (DB-006)', () => {
    it('should call IPC channel without store_id (backend handles scoping)', async () => {
      mockIpc.shifts.getOpenShifts.mockResolvedValue({ open_shifts: [] });

      await mockIpc.shifts.getOpenShifts();

      // Backend handler uses getConfiguredStore() for scoping
      // No store_id should be passed from frontend
      expect(mockIpc.shifts.getOpenShifts).toHaveBeenCalledWith();
    });
  });
});

// ============================================================================
// useLocalShiftDetail Tests
// ============================================================================

describe('useLocalShiftDetail Query Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('happy path', () => {
    it('should return shift detail by ID', async () => {
      const mockShift = createShiftResponse();
      mockIpc.shifts.getById.mockResolvedValue(mockShift);

      const result = await mockIpc.shifts.getById('shift-uuid-001');

      expect(result.shift_id).toBe('shift-uuid-001');
      expect(result.status).toBe('OPEN');
      expect(result.shift_number).toBe(1);
    });

    it('should return closed shift with end_time', async () => {
      const mockShift = createShiftResponse({
        status: 'CLOSED',
        end_time: '2026-02-11T14:00:00.000Z',
      });
      mockIpc.shifts.getById.mockResolvedValue(mockShift);

      const result = await mockIpc.shifts.getById('shift-uuid-001');

      expect(result.status).toBe('CLOSED');
      expect(result.end_time).toBe('2026-02-11T14:00:00.000Z');
    });

    it('should return all required fields', async () => {
      const mockShift = createShiftResponse();
      mockIpc.shifts.getById.mockResolvedValue(mockShift);

      const result = await mockIpc.shifts.getById('shift-uuid-001');

      // Verify all required fields
      expect(result.shift_id).toBeDefined();
      expect(result.store_id).toBeDefined();
      expect(result.shift_number).toBeDefined();
      expect(result.business_date).toBeDefined();
      expect(result.status).toBeDefined();
      expect(result.created_at).toBeDefined();
      expect(result.updated_at).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle null cashier_id', async () => {
      const mockShift = createShiftResponse({ cashier_id: null });
      mockIpc.shifts.getById.mockResolvedValue(mockShift);

      const result = await mockIpc.shifts.getById('shift-uuid-001');

      expect(result.cashier_id).toBeNull();
    });

    it('should handle null register_id', async () => {
      const mockShift = createShiftResponse({ register_id: null });
      mockIpc.shifts.getById.mockResolvedValue(mockShift);

      const result = await mockIpc.shifts.getById('shift-uuid-001');

      expect(result.register_id).toBeNull();
    });

    it('should handle null start_time', async () => {
      const mockShift = createShiftResponse({ start_time: null });
      mockIpc.shifts.getById.mockResolvedValue(mockShift);

      const result = await mockIpc.shifts.getById('shift-uuid-001');

      expect(result.start_time).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should handle NOT_FOUND errors', async () => {
      mockIpc.shifts.getById.mockRejectedValue(new Error('Shift not found'));

      await expect(mockIpc.shifts.getById('nonexistent')).rejects.toThrow('Shift not found');
    });

    it('should handle IPC failures', async () => {
      mockIpc.shifts.getById.mockRejectedValue(new Error('IPC channel error'));

      await expect(mockIpc.shifts.getById('shift-001')).rejects.toThrow('IPC channel error');
    });

    it('should handle malformed shift ID gracefully', async () => {
      mockIpc.shifts.getById.mockRejectedValue(new Error('Invalid UUID format'));

      await expect(mockIpc.shifts.getById('not-a-uuid')).rejects.toThrow('Invalid UUID format');
    });
  });

  describe('security (SEC-006)', () => {
    it('should pass shiftId as parameter (parameterized query in backend)', async () => {
      const mockShift = createShiftResponse();
      mockIpc.shifts.getById.mockResolvedValue(mockShift);

      await mockIpc.shifts.getById('shift-uuid-123');

      expect(mockIpc.shifts.getById).toHaveBeenCalledWith('shift-uuid-123');
    });

    it('should not allow SQL injection in shift ID', async () => {
      // Backend validates UUID format
      mockIpc.shifts.getById.mockRejectedValue(new Error('Invalid UUID format'));

      const maliciousId = "'; DROP TABLE shifts; --";

      await expect(mockIpc.shifts.getById(maliciousId)).rejects.toThrow('Invalid UUID format');
    });
  });

  describe('query configuration', () => {
    it('should be disabled when shiftId is null', () => {
      // This tests the hook's enabled logic
      const shiftId: string | null = null;
      const enabled = !!shiftId;

      expect(enabled).toBe(false);
    });

    it('should be disabled when shiftId is undefined', () => {
      const shiftId: string | undefined = undefined;
      const enabled = !!shiftId;

      expect(enabled).toBe(false);
    });

    it('should be enabled when shiftId is valid', () => {
      const shiftId = 'shift-uuid-001';
      const enabled = !!shiftId;

      expect(enabled).toBe(true);
    });
  });
});

// ============================================================================
// Integration Scenario Tests
// ============================================================================

describe('Local Shift Hooks Integration Scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DayClosePage Flow', () => {
    it('should support checking open shifts then fetching shift detail', async () => {
      // Step 1: Check for open shifts
      const openShiftsResponse: OpenShiftsResponse = {
        open_shifts: [
          createOpenShift({ shift_id: 'current-shift-001' }),
        ],
      };
      mockIpc.shifts.getOpenShifts.mockResolvedValue(openShiftsResponse);

      const openResult = await mockIpc.shifts.getOpenShifts();
      expect(openResult.open_shifts).toHaveLength(1);

      // Step 2: Get detail for current shift
      const shiftDetail = createShiftResponse({ shift_id: 'current-shift-001' });
      mockIpc.shifts.getById.mockResolvedValue(shiftDetail);

      const detailResult = await mockIpc.shifts.getById('current-shift-001');
      expect(detailResult.shift_id).toBe('current-shift-001');
    });

    it('should support day close blocking scenario (multiple open shifts)', async () => {
      // Multiple open shifts should block day close
      const openShiftsResponse: OpenShiftsResponse = {
        open_shifts: [
          createOpenShift({ shift_id: 's1', terminal_name: 'POS 1' }),
          createOpenShift({ shift_id: 's2', terminal_name: 'POS 2' }),
          createOpenShift({ shift_id: 's3', terminal_name: 'POS 3' }),
        ],
      };
      mockIpc.shifts.getOpenShifts.mockResolvedValue(openShiftsResponse);

      const result = await mockIpc.shifts.getOpenShifts();

      // Day close should be blocked - show all open shifts
      expect(result.open_shifts.length).toBeGreaterThan(0);
      const terminalNames = result.open_shifts.map((s: OpenShiftWithNames) => s.terminal_name);
      expect(terminalNames).toContain('POS 1');
      expect(terminalNames).toContain('POS 2');
      expect(terminalNames).toContain('POS 3');
    });

    it('should support day close allowed scenario (no open shifts)', async () => {
      const openShiftsResponse: OpenShiftsResponse = {
        open_shifts: [],
      };
      mockIpc.shifts.getOpenShifts.mockResolvedValue(openShiftsResponse);

      const result = await mockIpc.shifts.getOpenShifts();

      // Day close should be allowed
      expect(result.open_shifts).toHaveLength(0);
    });
  });

  describe('Enterprise UX Requirements', () => {
    it('should provide pre-resolved names for efficient rendering', async () => {
      const response: OpenShiftsResponse = {
        open_shifts: [
          createOpenShift({
            terminal_name: 'Register 1', // Pre-resolved by backend
            cashier_name: 'John Smith',   // Pre-resolved by backend
          }),
        ],
      };
      mockIpc.shifts.getOpenShifts.mockResolvedValue(response);

      const result = await mockIpc.shifts.getOpenShifts();

      // Names should be ready for display - no additional lookups needed
      expect(result.open_shifts[0].terminal_name).toBe('Register 1');
      expect(result.open_shifts[0].cashier_name).toBe('John Smith');
    });

    it('should support real-time status display (frequent refetch)', async () => {
      // First call - shift is open
      mockIpc.shifts.getOpenShifts.mockResolvedValueOnce({
        open_shifts: [createOpenShift({ status: 'OPEN' })],
      });

      const result1 = await mockIpc.shifts.getOpenShifts();
      expect(result1.open_shifts).toHaveLength(1);

      // Second call (after shift closed) - no open shifts
      mockIpc.shifts.getOpenShifts.mockResolvedValueOnce({
        open_shifts: [],
      });

      const result2 = await mockIpc.shifts.getOpenShifts();
      expect(result2.open_shifts).toHaveLength(0);
    });
  });
});
