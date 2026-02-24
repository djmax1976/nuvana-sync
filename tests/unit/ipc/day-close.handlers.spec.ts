/**
 * Day Close Handlers Unit Tests
 *
 * Tests for day close IPC handlers.
 *
 * Test Coverage:
 * - 1.T8: IPC handler enforces store isolation (DB-006)
 * - 1.T9: IPC handler validates input (API-001)
 * - Handler returns correct error codes
 *
 * Security Standards:
 * - SEC-010: Authorization enforced server-side
 * - SEC-006: Parameterized queries via DAL
 * - DB-006: Store-scoped queries for tenant isolation
 * - API-001: Input validation with Zod schemas
 *
 * @module tests/unit/ipc/day-close.handlers
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ==========================================================================
// Mock Setup
// Use vi.hoisted() to ensure mock functions are available when vi.mock runs
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
// ==========================================================================

// Hoist mock functions for cross-platform compatibility
const { mockGetConfiguredStore, mockCheckAccess } = vi.hoisted(() => ({
  mockGetConfiguredStore: vi.fn(),
  mockCheckAccess: vi.fn(),
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

// Mock stores DAL
vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: {
    getConfiguredStore: mockGetConfiguredStore,
  },
}));

// Mock day close access service
vi.mock('../../../src/main/services/day-close-access.service', () => ({
  checkAccess: mockCheckAccess,
}));

// Capture registered handlers
type HandlerFn = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const registeredHandlers: Map<string, HandlerFn> = new Map();

// Mock IPC registry - capture handler function
vi.mock('../../../src/main/ipc/index', () => ({
  registerHandler: vi.fn(<_T>(channel: string, handler: HandlerFn, _options?: unknown) => {
    registeredHandlers.set(channel, handler);
  }),
  createErrorResponse: vi.fn((code: string, message: string) => ({
    success: false,
    error: code,
    message,
  })),
  createSuccessResponse: vi.fn((data: unknown) => ({ success: true, data })),
  setCurrentUser: vi.fn(), // Required for successful access flow
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

describe('Day Close Handlers', () => {
  const TEST_STORE_ID = 'store-test-123';
  const mockStore = {
    store_id: TEST_STORE_ID,
    name: 'Test Store',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    registeredHandlers.clear();

    // Import handlers to trigger registration
    await import('../../../src/main/ipc/day-close.handlers');
  });

  afterEach(() => {
    vi.resetModules();
  });

  /**
   * Helper to invoke a registered handler
   */
  async function invokeHandler(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = registeredHandlers.get(channel);
    if (!handler) {
      throw new Error(`Handler not registered: ${channel}`);
    }
    return handler({}, ...args);
  }

  describe('Handler Registration', () => {
    it('should register dayClose:checkAccess handler', () => {
      expect(registeredHandlers.has('dayClose:checkAccess')).toBe(true);
    });
  });

  describe('dayClose:checkAccess', () => {
    /**
     * 1.T8: IPC handler enforces store isolation (DB-006)
     */
    it('should return NOT_CONFIGURED when store is not configured', async () => {
      mockGetConfiguredStore.mockReturnValue(null);

      const result = await invokeHandler('dayClose:checkAccess', { pin: '1234' });

      expect(result).toEqual({
        success: false,
        error: 'NOT_CONFIGURED',
        message: 'Store not configured. Please complete setup first.',
      });
    });

    /**
     * 1.T9: IPC handler validates input (API-001)
     */
    it('should validate PIN is at least 4 digits', async () => {
      mockGetConfiguredStore.mockReturnValue(mockStore);

      const result = await invokeHandler('dayClose:checkAccess', { pin: '123' });

      expect(result).toMatchObject({
        success: false,
        error: 'VALIDATION_ERROR',
      });
      expect((result as { message: string }).message).toContain('4 digits');
    });

    it('should validate PIN is at most 6 digits', async () => {
      mockGetConfiguredStore.mockReturnValue(mockStore);

      const result = await invokeHandler('dayClose:checkAccess', { pin: '1234567' });

      expect(result).toMatchObject({
        success: false,
        error: 'VALIDATION_ERROR',
      });
      expect((result as { message: string }).message).toContain('6 digits');
    });

    it('should validate PIN contains only digits', async () => {
      mockGetConfiguredStore.mockReturnValue(mockStore);

      const result = await invokeHandler('dayClose:checkAccess', { pin: '12ab' });

      expect(result).toMatchObject({
        success: false,
        error: 'VALIDATION_ERROR',
      });
      expect((result as { message: string }).message).toContain('digits');
    });

    it('should return validation error for missing pin', async () => {
      mockGetConfiguredStore.mockReturnValue(mockStore);

      const result = await invokeHandler('dayClose:checkAccess', {});

      expect(result).toMatchObject({
        success: false,
        error: 'VALIDATION_ERROR',
      });
    });

    it('should call service with correct store_id for tenant isolation', async () => {
      mockGetConfiguredStore.mockReturnValue(mockStore);
      mockCheckAccess.mockResolvedValue({
        allowed: true,
        openShiftCount: 1,
        accessType: 'OWNER',
        user: { userId: 'user-1', name: 'Test User', role: 'cashier' },
      });

      await invokeHandler('dayClose:checkAccess', { pin: '1234' });

      expect(mockCheckAccess).toHaveBeenCalledWith(TEST_STORE_ID, { pin: '1234' });
    });

    it('should return service result on success', async () => {
      mockGetConfiguredStore.mockReturnValue(mockStore);
      const serviceResult = {
        allowed: true,
        openShiftCount: 1,
        accessType: 'OWNER' as const,
        activeShift: {
          shift_id: 'shift-001',
          shift_number: 1,
          cashier_id: 'user-1',
          cashier_name: 'John Doe',
          external_register_id: 'REG01',
          terminal_name: 'Front Register',
          business_date: '2026-02-12',
          start_time: '2026-02-12T08:00:00.000Z',
        },
        user: { userId: 'user-1', name: 'John Doe', role: 'cashier' as const },
      };
      mockCheckAccess.mockResolvedValue(serviceResult);

      const result = await invokeHandler('dayClose:checkAccess', { pin: '1234' });

      expect(result).toEqual(serviceResult);
    });

    it('should return service denial reasons correctly', async () => {
      mockGetConfiguredStore.mockReturnValue(mockStore);
      const denialResult = {
        allowed: false,
        reasonCode: 'NO_OPEN_SHIFTS' as const,
        reason: 'No open shifts to close.',
        openShiftCount: 0,
      };
      mockCheckAccess.mockResolvedValue(denialResult);

      const result = await invokeHandler('dayClose:checkAccess', { pin: '1234' });

      expect(result).toEqual(denialResult);
    });

    it('should handle service errors gracefully (API-003)', async () => {
      mockGetConfiguredStore.mockReturnValue(mockStore);
      mockCheckAccess.mockRejectedValue(new Error('Database connection failed'));

      const result = await invokeHandler('dayClose:checkAccess', { pin: '1234' });

      expect(result).toMatchObject({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'An error occurred while checking access. Please try again.',
      });
    });
  });
});
