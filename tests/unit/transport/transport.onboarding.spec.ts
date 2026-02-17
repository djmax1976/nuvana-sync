/**
 * Transport Layer Onboarding Unit Tests
 *
 * Tests for the lottery onboarding transport methods that map IPC channels
 * to the frontend API interface.
 *
 * Phase 3 of BIZ-012-FIX: Lottery Onboarding UX Improvement
 *
 * @module tests/unit/transport/transport.onboarding.spec
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
import {
  ipc,
  OnboardingStatusResponse,
  CompleteOnboardingResponse,
} from '../../../src/renderer/lib/transport/index';

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Creates a mock onboarding status response for testing
 * @param isOnboarding - Whether onboarding mode is active
 */
function createMockOnboardingStatusResponse(isOnboarding: boolean): OnboardingStatusResponse {
  if (isOnboarding) {
    return {
      is_onboarding: true,
      day_id: 'day-uuid-first-ever',
      business_date: '2026-02-16',
      opened_at: '2026-02-16T08:00:00.000Z',
    };
  }
  return {
    is_onboarding: false,
    day_id: null,
    business_date: null,
    opened_at: null,
  };
}

/**
 * Creates a mock complete onboarding response for testing
 * @param success - Whether the operation succeeded
 */
function createMockCompleteOnboardingResponse(success: boolean): CompleteOnboardingResponse {
  if (success) {
    return {
      success: true,
      day_id: 'day-uuid-first-ever',
      message: 'Onboarding completed successfully.',
    };
  }
  return {
    success: false,
    day_id: 'day-uuid-first-ever',
    message: 'Failed to complete onboarding.',
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Transport Layer - Lottery Onboarding (BIZ-012-FIX Phase 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ==========================================================================
  // TRN-ONB-001: lottery.getOnboardingStatus() calls correct IPC channel
  // ==========================================================================
  describe('lottery.getOnboardingStatus()', () => {
    describe('TRN-ONB-001: IPC channel mapping', () => {
      it('should call correct IPC channel lottery:getOnboardingStatus', async () => {
        const mockResponse = createMockOnboardingStatusResponse(false);
        mocks.invoke.mockResolvedValue(mockResponse);

        await ipc.lottery.getOnboardingStatus();

        expect(mocks.invoke).toHaveBeenCalledTimes(1);
        expect(mocks.invoke).toHaveBeenCalledWith('lottery:getOnboardingStatus');
      });
    });

    describe('happy path - onboarding active', () => {
      it('should return is_onboarding=true with day details when in onboarding', async () => {
        const mockResponse = createMockOnboardingStatusResponse(true);
        mocks.invoke.mockResolvedValue(mockResponse);

        const result = await ipc.lottery.getOnboardingStatus();

        expect(result.is_onboarding).toBe(true);
        expect(result.day_id).toBe('day-uuid-first-ever');
        expect(result.business_date).toBe('2026-02-16');
        expect(result.opened_at).toBe('2026-02-16T08:00:00.000Z');
      });
    });

    describe('happy path - not onboarding', () => {
      it('should return is_onboarding=false with null values when not in onboarding', async () => {
        const mockResponse = createMockOnboardingStatusResponse(false);
        mocks.invoke.mockResolvedValue(mockResponse);

        const result = await ipc.lottery.getOnboardingStatus();

        expect(result.is_onboarding).toBe(false);
        expect(result.day_id).toBeNull();
        expect(result.business_date).toBeNull();
        expect(result.opened_at).toBeNull();
      });
    });

    describe('error handling', () => {
      it('should propagate IPC errors', async () => {
        const error = new Error('Store not configured');
        mocks.invoke.mockRejectedValue(error);

        await expect(ipc.lottery.getOnboardingStatus()).rejects.toThrow('Store not configured');
      });

      it('should propagate internal errors', async () => {
        const error = new Error('Database connection failed');
        mocks.invoke.mockRejectedValue(error);

        await expect(ipc.lottery.getOnboardingStatus()).rejects.toThrow(
          'Database connection failed'
        );
      });
    });
  });

  // ==========================================================================
  // TRN-ONB-002: lottery.completeOnboarding() calls correct IPC channel
  // ==========================================================================
  describe('lottery.completeOnboarding()', () => {
    describe('TRN-ONB-002: IPC channel mapping', () => {
      it('should call correct IPC channel lottery:completeOnboarding with day_id', async () => {
        const mockResponse = createMockCompleteOnboardingResponse(true);
        mocks.invoke.mockResolvedValue(mockResponse);
        const dayId = 'day-uuid-first-ever';

        await ipc.lottery.completeOnboarding(dayId);

        expect(mocks.invoke).toHaveBeenCalledTimes(1);
        expect(mocks.invoke).toHaveBeenCalledWith('lottery:completeOnboarding', {
          day_id: dayId,
        });
      });
    });

    describe('happy path', () => {
      it('should return success=true when onboarding completed', async () => {
        const mockResponse = createMockCompleteOnboardingResponse(true);
        mocks.invoke.mockResolvedValue(mockResponse);

        const result = await ipc.lottery.completeOnboarding('day-uuid-first-ever');

        expect(result.success).toBe(true);
        expect(result.day_id).toBe('day-uuid-first-ever');
        expect(result.message).toBe('Onboarding completed successfully.');
      });
    });

    describe('edge cases', () => {
      it('should handle failure response', async () => {
        const mockResponse = createMockCompleteOnboardingResponse(false);
        mocks.invoke.mockResolvedValue(mockResponse);

        const result = await ipc.lottery.completeOnboarding('day-uuid-first-ever');

        expect(result.success).toBe(false);
        expect(result.day_id).toBe('day-uuid-first-ever');
      });

      it('should handle response without message', async () => {
        const mockResponse: CompleteOnboardingResponse = {
          success: true,
          day_id: 'day-uuid-first-ever',
        };
        mocks.invoke.mockResolvedValue(mockResponse);

        const result = await ipc.lottery.completeOnboarding('day-uuid-first-ever');

        expect(result.success).toBe(true);
        expect(result.message).toBeUndefined();
      });
    });

    describe('error handling', () => {
      it('should propagate FORBIDDEN error when not authenticated', async () => {
        const error = new Error('Authentication required to complete onboarding.');
        mocks.invoke.mockRejectedValue(error);

        await expect(ipc.lottery.completeOnboarding('day-uuid-1')).rejects.toThrow(
          'Authentication required to complete onboarding.'
        );
      });

      it('should propagate VALIDATION_ERROR for invalid day_id', async () => {
        const error = new Error('Invalid day_id format');
        mocks.invoke.mockRejectedValue(error);

        await expect(ipc.lottery.completeOnboarding('invalid-not-uuid')).rejects.toThrow(
          'Invalid day_id format'
        );
      });

      it('should propagate NOT_FOUND error for nonexistent day', async () => {
        const error = new Error('Day not found');
        mocks.invoke.mockRejectedValue(error);

        await expect(
          ipc.lottery.completeOnboarding('00000000-0000-0000-0000-000000000000')
        ).rejects.toThrow('Day not found');
      });
    });

    describe('security - DB-006 compliance', () => {
      it('should pass day_id correctly for backend validation', async () => {
        const mockResponse = createMockCompleteOnboardingResponse(true);
        mocks.invoke.mockResolvedValue(mockResponse);

        const dayId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        await ipc.lottery.completeOnboarding(dayId);

        // Verify day_id is passed to backend for store ownership validation
        expect(mocks.invoke).toHaveBeenCalledWith('lottery:completeOnboarding', {
          day_id: dayId,
        });
      });
    });
  });

  // ==========================================================================
  // TRN-ONB-003: Response types match expected schema
  // ==========================================================================
  describe('TRN-ONB-003: Response type schema compliance', () => {
    it('OnboardingStatusResponse has all required fields when onboarding', async () => {
      const mockResponse: OnboardingStatusResponse = {
        is_onboarding: true,
        day_id: 'day-uuid-1',
        business_date: '2026-02-16',
        opened_at: '2026-02-16T08:00:00.000Z',
      };
      mocks.invoke.mockResolvedValue(mockResponse);

      const result = await ipc.lottery.getOnboardingStatus();

      // Verify all fields present and correctly typed
      expect(typeof result.is_onboarding).toBe('boolean');
      expect(typeof result.day_id).toBe('string');
      expect(typeof result.business_date).toBe('string');
      expect(typeof result.opened_at).toBe('string');
    });

    it('OnboardingStatusResponse allows null values when not onboarding', async () => {
      const mockResponse: OnboardingStatusResponse = {
        is_onboarding: false,
        day_id: null,
        business_date: null,
        opened_at: null,
      };
      mocks.invoke.mockResolvedValue(mockResponse);

      const result = await ipc.lottery.getOnboardingStatus();

      expect(result.is_onboarding).toBe(false);
      expect(result.day_id).toBeNull();
      expect(result.business_date).toBeNull();
      expect(result.opened_at).toBeNull();
    });

    it('CompleteOnboardingResponse has required success and day_id fields', async () => {
      const mockResponse: CompleteOnboardingResponse = {
        success: true,
        day_id: 'day-uuid-1',
        message: 'Onboarding completed.',
      };
      mocks.invoke.mockResolvedValue(mockResponse);

      const result = await ipc.lottery.completeOnboarding('day-uuid-1');

      expect(typeof result.success).toBe('boolean');
      expect(typeof result.day_id).toBe('string');
      // message is optional
      if (result.message !== undefined) {
        expect(typeof result.message).toBe('string');
      }
    });
  });

  // ==========================================================================
  // Integration: Multiple transport calls
  // ==========================================================================
  describe('multiple transport calls', () => {
    it('should handle sequential getOnboardingStatus and completeOnboarding calls', async () => {
      // First call: check status
      mocks.invoke.mockResolvedValueOnce(createMockOnboardingStatusResponse(true));

      const statusResult = await ipc.lottery.getOnboardingStatus();
      expect(statusResult.is_onboarding).toBe(true);

      // Second call: complete onboarding
      mocks.invoke.mockResolvedValueOnce(createMockCompleteOnboardingResponse(true));

      const completeResult = await ipc.lottery.completeOnboarding(statusResult.day_id!);
      expect(completeResult.success).toBe(true);

      // Third call: verify status changed
      mocks.invoke.mockResolvedValueOnce(createMockOnboardingStatusResponse(false));

      const finalStatus = await ipc.lottery.getOnboardingStatus();
      expect(finalStatus.is_onboarding).toBe(false);

      expect(mocks.invoke).toHaveBeenCalledTimes(3);
    });

    it('should handle parallel calls correctly', async () => {
      mocks.invoke
        .mockResolvedValueOnce(createMockOnboardingStatusResponse(true))
        .mockResolvedValueOnce({ open_shifts: [] });

      const [onboardingStatus, openShifts] = await Promise.all([
        ipc.lottery.getOnboardingStatus(),
        ipc.shifts.getOpenShifts(),
      ]);

      expect(mocks.invoke).toHaveBeenCalledTimes(2);
      expect(onboardingStatus.is_onboarding).toBe(true);
      expect(openShifts.open_shifts).toEqual([]);
    });
  });
});
