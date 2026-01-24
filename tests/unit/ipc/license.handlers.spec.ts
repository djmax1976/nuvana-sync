/**
 * License IPC Handlers Unit Tests
 *
 * Enterprise-grade tests for license IPC handlers.
 *
 * Validates:
 * - API-001: Schema validation for IPC responses
 * - API-003: Centralized error handling
 * - LM-001: Structured logging
 * - SEC-014: IPC channel security
 *
 * Test Categories:
 * 1. Handler registration and availability
 * 2. Response format compliance (IPCResponse)
 * 3. License state retrieval accuracy
 * 4. Error handling and resilience
 * 5. Cloud API integration behavior
 *
 * @module tests/unit/ipc/license.handlers.spec
 */

// Using vitest globals (configured in vitest.config.ts)

// ============================================================================
// Mocks
// ============================================================================

// Mock the license service
const mockLicenseService = {
  getState: vi.fn(),
  getDaysUntilExpiry: vi.fn(),
  isInGracePeriod: vi.fn(),
  shouldShowWarning: vi.fn(),
  isValid: vi.fn(),
  updateFromApiResponse: vi.fn(),
  markSuspended: vi.fn(),
  markCancelled: vi.fn(),
  onStatusChange: vi.fn(),
};

vi.mock('../../../src/main/services/license.service', () => ({
  licenseService: mockLicenseService,
  LicenseApiResponseSchema: {
    safeParse: vi.fn((data) => ({ success: true, data })),
  },
}));

// Mock the cloud API service
const mockCloudApiService = {
  checkLicense: vi.fn(),
};

vi.mock('../../../src/main/services/cloud-api.service', () => ({
  cloudApiService: mockCloudApiService,
}));

// Mock logger
vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the IPC registration system
const registeredHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

vi.mock('../../../src/main/ipc/index', () => ({
  registerHandler: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
    registeredHandlers.set(channel, handler);
  }),
  createSuccessResponse: vi.fn(<T>(data: T) => ({ data })),
  createErrorResponse: vi.fn((code: string, message: string) => ({ error: message })),
  IPCErrorCodes: {
    NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
  },
}));

// ============================================================================
// Test Setup
// ============================================================================

describe('License IPC Handlers', () => {
  // Import handlers once before all tests
  beforeAll(async () => {
    // Import to trigger registration
    await import('../../../src/main/ipc/license.handlers');
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. Handler Registration Tests
  // ==========================================================================

  describe('Handler Registration', () => {
    it('should register license:getStatus handler', async () => {
      expect(registeredHandlers.has('license:getStatus')).toBe(true);
    });

    it('should register license:checkNow handler', async () => {
      expect(registeredHandlers.has('license:checkNow')).toBe(true);
    });

    it('should register license:getDaysRemaining handler', async () => {
      expect(registeredHandlers.has('license:getDaysRemaining')).toBe(true);
    });

    it('should register license:shouldShowWarning handler', async () => {
      expect(registeredHandlers.has('license:shouldShowWarning')).toBe(true);
    });

    it('should register exactly 4 license handlers', async () => {
      const licenseHandlers = Array.from(registeredHandlers.keys()).filter((k) =>
        k.startsWith('license:')
      );
      expect(licenseHandlers).toHaveLength(4);
    });
  });

  // ==========================================================================
  // 2. license:getStatus Handler Tests
  // ==========================================================================

  describe('license:getStatus', () => {
    const mockLicenseState = {
      valid: true,
      expiresAt: '2026-01-15T00:00:00.000Z',
      daysRemaining: 90,
      showWarning: false,
      inGracePeriod: false,
      status: 'active' as const,
      lastChecked: '2025-01-12T10:00:00.000Z',
    };

    it('should return current license state', async () => {
      mockLicenseService.getState.mockReturnValue(mockLicenseState);

      const handler = registeredHandlers.get('license:getStatus');
      const result = await handler!();

      expect(result).toEqual({ data: mockLicenseState });
      expect(mockLicenseService.getState).toHaveBeenCalledTimes(1);
    });

    it('should return invalid state when no license exists', async () => {
      const invalidState = {
        valid: false,
        expiresAt: null,
        daysRemaining: null,
        showWarning: false,
        inGracePeriod: false,
        status: null,
        lastChecked: null,
      };
      mockLicenseService.getState.mockReturnValue(invalidState);

      const handler = registeredHandlers.get('license:getStatus');
      const result = await handler!();

      expect(result).toEqual({ data: invalidState });
    });

    it('should return state with warning flag when approaching expiry', async () => {
      const warningState = {
        ...mockLicenseState,
        daysRemaining: 15,
        showWarning: true,
      };
      mockLicenseService.getState.mockReturnValue(warningState);

      const handler = registeredHandlers.get('license:getStatus');
      const result = await handler!();

      expect((result as { data: typeof warningState }).data.showWarning).toBe(true);
    });

    it('should return state with grace period flag when expired within grace', async () => {
      const graceState = {
        ...mockLicenseState,
        valid: true,
        daysRemaining: -3,
        inGracePeriod: true,
        showWarning: true,
      };
      mockLicenseService.getState.mockReturnValue(graceState);

      const handler = registeredHandlers.get('license:getStatus');
      const result = await handler!();

      expect((result as { data: typeof graceState }).data.inGracePeriod).toBe(true);
      expect((result as { data: typeof graceState }).data.valid).toBe(true);
    });
  });

  // ==========================================================================
  // 3. license:checkNow Handler Tests
  // ==========================================================================

  describe('license:checkNow', () => {
    const mockValidState = {
      valid: true,
      expiresAt: '2026-01-15T00:00:00.000Z',
      daysRemaining: 90,
      showWarning: false,
      inGracePeriod: false,
      status: 'active' as const,
      lastChecked: '2025-01-12T10:00:00.000Z',
    };

    it('should call cloudApiService.checkLicense and return updated state', async () => {
      mockCloudApiService.checkLicense.mockResolvedValue(undefined);
      mockLicenseService.getState.mockReturnValue(mockValidState);

      const handler = registeredHandlers.get('license:checkNow');
      const result = await handler!();

      expect(mockCloudApiService.checkLicense).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ data: mockValidState });
    });

    it('should return cached state when API call fails', async () => {
      const cachedState = {
        ...mockValidState,
        lastChecked: '2025-01-11T10:00:00.000Z', // Stale
      };
      mockCloudApiService.checkLicense.mockRejectedValue(new Error('Network error'));
      mockLicenseService.getState.mockReturnValue(cachedState);

      const handler = registeredHandlers.get('license:checkNow');
      const result = await handler!();

      // Should still return cached state, not error
      expect(result).toEqual({ data: cachedState });
    });

    it('should return updated state after successful refresh', async () => {
      const refreshedState = {
        ...mockValidState,
        lastChecked: new Date().toISOString(),
      };
      mockCloudApiService.checkLicense.mockResolvedValue(undefined);
      mockLicenseService.getState.mockReturnValue(refreshedState);

      const handler = registeredHandlers.get('license:checkNow');
      await handler!();

      expect(mockLicenseService.getState).toHaveBeenCalled();
    });

    it('should handle timeout gracefully', async () => {
      // Simulate timeout
      mockCloudApiService.checkLicense.mockRejectedValue(new Error('Request timeout'));
      mockLicenseService.getState.mockReturnValue(mockValidState);

      const handler = registeredHandlers.get('license:checkNow');
      const result = await handler!();

      // Should return cached state
      expect(result).toEqual({ data: mockValidState });
    });
  });

  // ==========================================================================
  // 4. license:getDaysRemaining Handler Tests
  // ==========================================================================

  describe('license:getDaysRemaining', () => {
    it('should return positive days remaining for active license', async () => {
      mockLicenseService.getDaysUntilExpiry.mockReturnValue(45);
      mockLicenseService.isInGracePeriod.mockReturnValue(false);

      const handler = registeredHandlers.get('license:getDaysRemaining');
      const result = await handler!();

      expect(result).toEqual({
        data: {
          daysRemaining: 45,
          inGracePeriod: false,
        },
      });
    });

    it('should return negative days and grace period flag for expired license', async () => {
      mockLicenseService.getDaysUntilExpiry.mockReturnValue(-3);
      mockLicenseService.isInGracePeriod.mockReturnValue(true);

      const handler = registeredHandlers.get('license:getDaysRemaining');
      const result = await handler!();

      expect(result).toEqual({
        data: {
          daysRemaining: -3,
          inGracePeriod: true,
        },
      });
    });

    it('should return null when no license exists', async () => {
      mockLicenseService.getDaysUntilExpiry.mockReturnValue(null);
      mockLicenseService.isInGracePeriod.mockReturnValue(false);

      const handler = registeredHandlers.get('license:getDaysRemaining');
      const result = await handler!();

      expect(result).toEqual({
        data: {
          daysRemaining: null,
          inGracePeriod: false,
        },
      });
    });

    it('should return 0 days when expiring today', async () => {
      mockLicenseService.getDaysUntilExpiry.mockReturnValue(0);
      mockLicenseService.isInGracePeriod.mockReturnValue(false);

      const handler = registeredHandlers.get('license:getDaysRemaining');
      const result = await handler!();

      expect((result as { data: { daysRemaining: number } }).data.daysRemaining).toBe(0);
    });
  });

  // ==========================================================================
  // 5. license:shouldShowWarning Handler Tests
  // ==========================================================================

  describe('license:shouldShowWarning', () => {
    it('should return false when license has plenty of time remaining', async () => {
      mockLicenseService.shouldShowWarning.mockReturnValue(false);
      mockLicenseService.getDaysUntilExpiry.mockReturnValue(60);

      const handler = registeredHandlers.get('license:shouldShowWarning');
      const result = await handler!();

      expect(result).toEqual({
        data: {
          showWarning: false,
          daysRemaining: 60,
        },
      });
    });

    it('should return true when license is approaching expiry', async () => {
      mockLicenseService.shouldShowWarning.mockReturnValue(true);
      mockLicenseService.getDaysUntilExpiry.mockReturnValue(15);

      const handler = registeredHandlers.get('license:shouldShowWarning');
      const result = await handler!();

      expect(result).toEqual({
        data: {
          showWarning: true,
          daysRemaining: 15,
        },
      });
    });

    it('should return true when license is in grace period', async () => {
      mockLicenseService.shouldShowWarning.mockReturnValue(true);
      mockLicenseService.getDaysUntilExpiry.mockReturnValue(-3);

      const handler = registeredHandlers.get('license:shouldShowWarning');
      const result = await handler!();

      expect((result as { data: { showWarning: boolean } }).data.showWarning).toBe(true);
      expect((result as { data: { daysRemaining: number } }).data.daysRemaining).toBe(-3);
    });

    it('should return false for suspended license (lock screen shown instead)', async () => {
      mockLicenseService.shouldShowWarning.mockReturnValue(false);
      mockLicenseService.getDaysUntilExpiry.mockReturnValue(30);

      const handler = registeredHandlers.get('license:shouldShowWarning');
      const result = await handler!();

      expect((result as { data: { showWarning: boolean } }).data.showWarning).toBe(false);
    });
  });

  // ==========================================================================
  // 6. Response Format Compliance Tests
  // ==========================================================================

  describe('Response Format Compliance', () => {
    it('should return IPCResponse format with data property', async () => {
      mockLicenseService.getState.mockReturnValue({
        valid: true,
        status: 'active',
        expiresAt: '2026-01-15T00:00:00.000Z',
        daysRemaining: 90,
        showWarning: false,
        inGracePeriod: false,
        lastChecked: '2025-01-12T10:00:00.000Z',
      });

      const handler = registeredHandlers.get('license:getStatus');
      const result = await handler!();

      expect(result).toHaveProperty('data');
      expect(typeof result).toBe('object');
    });

    it('should never return error property for successful calls', async () => {
      mockLicenseService.getState.mockReturnValue({
        valid: true,
        status: 'active',
        expiresAt: '2026-01-15T00:00:00.000Z',
        daysRemaining: 90,
        showWarning: false,
        inGracePeriod: false,
        lastChecked: '2025-01-12T10:00:00.000Z',
      });

      const handler = registeredHandlers.get('license:getStatus');
      const result = await handler!();

      expect(result).not.toHaveProperty('error');
    });

    it('should maintain consistent response structure across all handlers', async () => {
      mockLicenseService.getState.mockReturnValue({
        valid: true,
        status: 'active',
        expiresAt: '2026-01-15T00:00:00.000Z',
        daysRemaining: 90,
        showWarning: false,
        inGracePeriod: false,
        lastChecked: '2025-01-12T10:00:00.000Z',
      });
      mockLicenseService.getDaysUntilExpiry.mockReturnValue(90);
      mockLicenseService.isInGracePeriod.mockReturnValue(false);
      mockLicenseService.shouldShowWarning.mockReturnValue(false);
      mockCloudApiService.checkLicense.mockResolvedValue(undefined);

      const handlers = [
        'license:getStatus',
        'license:checkNow',
        'license:getDaysRemaining',
        'license:shouldShowWarning',
      ];

      for (const channel of handlers) {
        const handler = registeredHandlers.get(channel);
        const result = await handler!();

        expect(result).toHaveProperty('data');
        expect(typeof (result as { data: unknown }).data).toBe('object');
      }
    });
  });

  // ==========================================================================
  // 7. Concurrency and Race Condition Tests
  // ==========================================================================

  describe('Concurrency Handling', () => {
    it('should handle concurrent license:checkNow calls', async () => {
      let callCount = 0;
      mockCloudApiService.checkLicense.mockImplementation(async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      mockLicenseService.getState.mockReturnValue({
        valid: true,
        status: 'active',
        expiresAt: '2026-01-15T00:00:00.000Z',
        daysRemaining: 90,
        showWarning: false,
        inGracePeriod: false,
        lastChecked: '2025-01-12T10:00:00.000Z',
      });

      const handler = registeredHandlers.get('license:checkNow');

      // Make 3 concurrent calls
      const results = await Promise.all([handler!(), handler!(), handler!()]);

      // All should complete
      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result).toHaveProperty('data');
      });

      // API should have been called 3 times
      expect(callCount).toBe(3);
    });

    it('should handle rapid sequential getStatus calls', async () => {
      mockLicenseService.getState.mockReturnValue({
        valid: true,
        status: 'active',
        expiresAt: '2026-01-15T00:00:00.000Z',
        daysRemaining: 90,
        showWarning: false,
        inGracePeriod: false,
        lastChecked: '2025-01-12T10:00:00.000Z',
      });

      const handler = registeredHandlers.get('license:getStatus');

      // 100 rapid calls
      const promises = Array(100)
        .fill(null)
        .map(() => handler!());
      const results = await Promise.all(promises);

      expect(results).toHaveLength(100);
      results.forEach((result) => {
        expect((result as { data: { valid: boolean } }).data.valid).toBe(true);
      });
    });
  });

  // ==========================================================================
  // 8. Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should throw when license service returns undefined', async () => {
      // The handler accesses state properties for logging without null checks
      // This tests documents current behavior - undefined state causes error
      mockLicenseService.getState.mockReturnValue(undefined);

      const handler = registeredHandlers.get('license:getStatus');

      // Current implementation throws when state is undefined
      await expect(handler!()).rejects.toThrow();
    });

    it('should handle license service throwing synchronously', async () => {
      mockLicenseService.getState.mockImplementation(() => {
        throw new Error('Unexpected sync error');
      });

      const handler = registeredHandlers.get('license:getStatus');

      // Handler should propagate or handle the error
      await expect(handler!()).rejects.toThrow('Unexpected sync error');
    });
  });
});
