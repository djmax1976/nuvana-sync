/**
 * Transport Layer Shift Close Unit Tests
 *
 * Tests for the transport.shifts.close() method.
 * Verifies IPC channel invocation, parameter passing, and response handling.
 *
 * @module tests/unit/transport/shifts.close
 * @security SEC-014: Verifies IPC channel security
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mock Setup
// ============================================================================

const mockInvoke = vi.fn();

vi.mock('../../../src/renderer/lib/api/ipc-client', () => ({
  ipcClient: {
    invoke: mockInvoke,
    on: vi.fn(() => () => {}),
    once: vi.fn(),
  },
  IPCError: class IPCError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

// ============================================================================
// Test Data
// ============================================================================

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const STORE_ID = 'store-uuid-1234-5678-90ab-cdef12345678';

const mockClosedShiftResponse = {
  shift_id: VALID_UUID,
  store_id: STORE_ID,
  shift_number: 1,
  business_date: '2026-02-12',
  cashier_id: null,
  register_id: null,
  start_time: '2026-02-12T08:00:00Z',
  end_time: '2026-02-12T16:00:00Z',
  status: 'CLOSED',
  external_cashier_id: null,
  external_register_id: 'REG-1',
  external_till_id: null,
  closing_cash: 250.5,
  created_at: '2026-02-12T08:00:00Z',
  updated_at: '2026-02-12T16:00:00Z',
};

// ============================================================================
// Tests
// ============================================================================

describe('Transport shifts.close()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('IPC Channel Invocation', () => {
    it("TEST: Invokes correct IPC channel 'shifts:close'", async () => {
      mockInvoke.mockResolvedValueOnce(mockClosedShiftResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.shifts.close(VALID_UUID, 100);

      expect(mockInvoke).toHaveBeenCalledWith('shifts:close', expect.any(Object));
    });

    it('TEST: Passes shift_id and closing_cash as object', async () => {
      mockInvoke.mockResolvedValueOnce(mockClosedShiftResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.shifts.close(VALID_UUID, 250.5);

      expect(mockInvoke).toHaveBeenCalledWith('shifts:close', {
        shift_id: VALID_UUID,
        closing_cash: 250.5,
      });
    });

    it('TEST: Uses correct parameter names (shift_id, closing_cash)', async () => {
      mockInvoke.mockResolvedValueOnce(mockClosedShiftResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      await ipc.shifts.close(VALID_UUID, 100);

      const invokeCall = mockInvoke.mock.calls[0];
      const params = invokeCall[1];

      // Verify parameter names match handler expectations
      expect(params).toHaveProperty('shift_id');
      expect(params).toHaveProperty('closing_cash');
      expect(params).not.toHaveProperty('shiftId'); // camelCase should NOT be used
      expect(params).not.toHaveProperty('closingCash');
    });
  });

  describe('Response Handling', () => {
    it('TEST: Returns response from IPC handler', async () => {
      mockInvoke.mockResolvedValueOnce(mockClosedShiftResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.shifts.close(VALID_UUID, 250.5);

      expect(result).toEqual(mockClosedShiftResponse);
      expect(result.closing_cash).toBe(250.5);
    });

    it('TEST: Propagates IPC errors correctly', async () => {
      const { IPCError } = await import('../../../src/renderer/lib/api/ipc-client');
      const error = new IPCError('NOT_FOUND', 'Shift not found');
      mockInvoke.mockRejectedValueOnce(error);

      const { ipc } = await import('../../../src/renderer/lib/transport');

      await expect(ipc.shifts.close(VALID_UUID, 100)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Shift not found',
      });
    });

    it('TEST: Handles VALIDATION_ERROR from handler', async () => {
      const { IPCError } = await import('../../../src/renderer/lib/api/ipc-client');
      const error = new IPCError('VALIDATION_ERROR', 'Invalid shift ID format');
      mockInvoke.mockRejectedValueOnce(error);

      const { ipc } = await import('../../../src/renderer/lib/transport');

      await expect(ipc.shifts.close('invalid-id', 100)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('TEST: Handles ALREADY_CLOSED error from handler', async () => {
      const { IPCError } = await import('../../../src/renderer/lib/api/ipc-client');
      const error = new IPCError('ALREADY_CLOSED', 'Shift is already closed');
      mockInvoke.mockRejectedValueOnce(error);

      const { ipc } = await import('../../../src/renderer/lib/transport');

      await expect(ipc.shifts.close(VALID_UUID, 100)).rejects.toMatchObject({
        code: 'ALREADY_CLOSED',
      });
    });
  });

  describe('Type Safety', () => {
    it('TEST: Response includes ShiftCloseResponse fields', async () => {
      mockInvoke.mockResolvedValueOnce(mockClosedShiftResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.shifts.close(VALID_UUID, 250.5);

      // Verify ShiftCloseResponse type fields
      expect(result).toHaveProperty('shift_id');
      expect(result).toHaveProperty('store_id');
      expect(result).toHaveProperty('shift_number');
      expect(result).toHaveProperty('business_date');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('end_time');
      expect(result).toHaveProperty('closing_cash');
    });

    it('TEST: closing_cash is a number type in response', async () => {
      mockInvoke.mockResolvedValueOnce(mockClosedShiftResponse);

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.shifts.close(VALID_UUID, 250.5);

      expect(typeof result.closing_cash).toBe('number');
    });
  });

  describe('Edge Cases', () => {
    it('TEST: Handles zero closing_cash', async () => {
      mockInvoke.mockResolvedValueOnce({
        ...mockClosedShiftResponse,
        closing_cash: 0,
      });

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.shifts.close(VALID_UUID, 0);

      expect(mockInvoke).toHaveBeenCalledWith('shifts:close', {
        shift_id: VALID_UUID,
        closing_cash: 0,
      });
      expect(result.closing_cash).toBe(0);
    });

    it('TEST: Handles decimal closing_cash values', async () => {
      mockInvoke.mockResolvedValueOnce({
        ...mockClosedShiftResponse,
        closing_cash: 123.45,
      });

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.shifts.close(VALID_UUID, 123.45);

      expect(mockInvoke).toHaveBeenCalledWith('shifts:close', {
        shift_id: VALID_UUID,
        closing_cash: 123.45,
      });
      expect(result.closing_cash).toBe(123.45);
    });

    it('TEST: Handles large closing_cash values', async () => {
      const largeCash = 999999.99;
      mockInvoke.mockResolvedValueOnce({
        ...mockClosedShiftResponse,
        closing_cash: largeCash,
      });

      const { ipc } = await import('../../../src/renderer/lib/transport');
      const result = await ipc.shifts.close(VALID_UUID, largeCash);

      expect(result.closing_cash).toBe(largeCash);
    });

    it('TEST: Network/IPC timeout error propagates', async () => {
      const timeoutError = new Error('IPC call timed out');
      mockInvoke.mockRejectedValueOnce(timeoutError);

      const { ipc } = await import('../../../src/renderer/lib/transport');

      await expect(ipc.shifts.close(VALID_UUID, 100)).rejects.toThrow('IPC call timed out');
    });
  });
});
