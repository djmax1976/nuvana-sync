/**
 * Terminals IPC Handlers Unit Tests
 *
 * Tests for terminal-related IPC handler functionality.
 * Phase 5: Enterprise-grade tests for terminal deactivation feature.
 *
 * @module tests/unit/ipc/terminals.handlers
 *
 * Security Compliance:
 * - SEC-006: All queries use prepared statements via DAL
 * - SEC-014: UUID format validation for terminal IDs
 * - DB-006: Store-scoped queries for tenant isolation
 * - API-001: Zod schema validation on all inputs
 *
 * Traceability:
 * - T-IPC-001: Happy path deactivation
 * - T-IPC-002: Invalid input validation
 * - T-IPC-003: Store not configured
 * - T-IPC-004: Terminal not found
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ==========================================================================
// Mock Setup
// Use vi.hoisted() to ensure mock functions are available when vi.mock runs
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
// ==========================================================================

const { mockGetConfiguredStore, mockDeactivateById, mockDeactivateByExternalId } = vi.hoisted(
  () => ({
    mockGetConfiguredStore: vi.fn(),
    mockDeactivateById: vi.fn(),
    mockDeactivateByExternalId: vi.fn(),
  })
);

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
  v4: vi.fn().mockReturnValue('mock-uuid-deactivate'),
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
    deactivateById: mockDeactivateById,
    deactivateByExternalId: mockDeactivateByExternalId,
    findRegisters: vi.fn().mockReturnValue([]),
  },
}));

// Mock shifts DAL
vi.mock('../../../src/main/dal/shifts.dal', () => ({
  shiftsDAL: {
    findOpenShiftByExternalRegisterId: vi.fn().mockReturnValue(null),
    countOpenShiftsByExternalRegisterId: vi.fn().mockReturnValue(0),
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

import {
  registerHandler,
  createErrorResponse,
  IPCErrorCodes as _IPCErrorCodes,
} from '../../../src/main/ipc/index';

// Type for IPC handler results
interface IPCResult {
  data?: unknown;
  error?: string;
  message?: string;
  success?: boolean;
  terminalId?: string;
}

// Type for IPC handlers - eslint-disable needed for test flexibility
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IPCHandler = (...args: any[]) => Promise<IPCResult> | IPCResult;

// ==========================================================================
// Test Suite
// ==========================================================================

describe('Terminals IPC Handlers', () => {
  // Capture registered handlers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Map<string, any> = new Map();

  beforeEach(() => {
    vi.clearAllMocks();

    // Capture handler registrations
    vi.mocked(registerHandler).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    // Default mock: store is configured
    mockGetConfiguredStore.mockReturnValue({
      id: 1,
      store_id: 'store-uuid-001',
      name: 'Test Store',
    });

    // Re-import to trigger registrations
    vi.resetModules();
  });

  afterEach(() => {
    handlers.clear();
  });

  // ==========================================================================
  // Handler Registration Tests
  // ==========================================================================

  describe('Handler Registration', () => {
    it('should register terminals:deactivate handler', async () => {
      await import('../../../src/main/ipc/terminals.handlers');

      expect(registerHandler).toHaveBeenCalledWith(
        'terminals:deactivate',
        expect.any(Function),
        expect.objectContaining({
          description: 'Deactivate a terminal mapping in local database after cloud deletion',
        })
      );
    });

    it('should register terminals:list handler', async () => {
      await import('../../../src/main/ipc/terminals.handlers');

      expect(registerHandler).toHaveBeenCalledWith(
        'terminals:list',
        expect.any(Function),
        expect.any(Object)
      );
    });
  });

  // ==========================================================================
  // terminals:deactivate Handler Tests
  // ==========================================================================

  describe('terminals:deactivate handler', () => {
    // T-IPC-001: Happy path - deactivate by internal ID
    it('T-IPC-001: should deactivate terminal by internal ID and return success', async () => {
      mockDeactivateById.mockReturnValue(true);

      await import('../../../src/main/ipc/terminals.handlers');

      const deactivateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:deactivate');

      const handler = deactivateCall?.[1] as IPCHandler;
      const result = await handler(null, {
        terminalId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(result).toEqual({
        success: true,
        terminalId: '550e8400-e29b-41d4-a716-446655440000',
        message: 'Terminal deactivated successfully',
      });
      expect(mockDeactivateById).toHaveBeenCalledWith(
        'store-uuid-001',
        '550e8400-e29b-41d4-a716-446655440000'
      );
    });

    // T-IPC-001b: Happy path - deactivate by external ID (fallback)
    it('T-IPC-001b: should deactivate terminal by external ID when internal ID not found', async () => {
      mockDeactivateById.mockReturnValue(false);
      mockDeactivateByExternalId.mockReturnValue(true);

      await import('../../../src/main/ipc/terminals.handlers');

      const deactivateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:deactivate');

      const handler = deactivateCall?.[1] as IPCHandler;
      const result = await handler(null, {
        terminalId: '660e8400-e29b-41d4-a716-446655440001',
      });

      expect(result).toEqual({
        success: true,
        terminalId: '660e8400-e29b-41d4-a716-446655440001',
        message: 'Terminal deactivated successfully',
      });
      // Verify fallback to external ID
      expect(mockDeactivateById).toHaveBeenCalled();
      expect(mockDeactivateByExternalId).toHaveBeenCalledWith(
        'store-uuid-001',
        '660e8400-e29b-41d4-a716-446655440001',
        'generic'
      );
    });

    // T-IPC-002: Invalid input - missing terminalId
    it('T-IPC-002a: should return VALIDATION_ERROR when terminalId is missing', async () => {
      await import('../../../src/main/ipc/terminals.handlers');

      const deactivateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:deactivate');

      const handler = deactivateCall?.[1] as IPCHandler;
      await handler(null, {});

      expect(createErrorResponse).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        expect.stringContaining('Invalid terminal ID')
      );
    });

    // T-IPC-002b: Invalid input - invalid UUID format
    it('T-IPC-002b: should return VALIDATION_ERROR when terminalId is not a valid UUID', async () => {
      await import('../../../src/main/ipc/terminals.handlers');

      const deactivateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:deactivate');

      const handler = deactivateCall?.[1] as IPCHandler;
      await handler(null, { terminalId: 'not-a-valid-uuid' });

      expect(createErrorResponse).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        expect.stringContaining('Terminal ID must be a valid UUID')
      );
    });

    // T-IPC-002c: Invalid input - SQL injection attempt in UUID field
    it('T-IPC-002c: should reject SQL injection attempts via Zod validation (SEC-006)', async () => {
      await import('../../../src/main/ipc/terminals.handlers');

      const deactivateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:deactivate');

      const handler = deactivateCall?.[1] as IPCHandler;
      await handler(null, { terminalId: "'; DROP TABLE pos_terminal_mappings;--" });

      expect(createErrorResponse).toHaveBeenCalledWith('VALIDATION_ERROR', expect.any(String));
      // Verify DAL methods were NOT called (blocked at validation)
      expect(mockDeactivateById).not.toHaveBeenCalled();
      expect(mockDeactivateByExternalId).not.toHaveBeenCalled();
    });

    // T-IPC-003: Store not configured
    it('T-IPC-003: should return NOT_CONFIGURED when store is not set up', async () => {
      mockGetConfiguredStore.mockReturnValue(null);

      await import('../../../src/main/ipc/terminals.handlers');

      const deactivateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:deactivate');

      const handler = deactivateCall?.[1] as IPCHandler;
      await handler(null, { terminalId: '550e8400-e29b-41d4-a716-446655440000' });

      expect(createErrorResponse).toHaveBeenCalledWith('NOT_CONFIGURED', 'Store not configured');
    });

    // T-IPC-004: Terminal not found
    it('T-IPC-004: should return success:false when terminal not found in either lookup', async () => {
      mockDeactivateById.mockReturnValue(false);
      mockDeactivateByExternalId.mockReturnValue(false);

      await import('../../../src/main/ipc/terminals.handlers');

      const deactivateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:deactivate');

      const handler = deactivateCall?.[1] as IPCHandler;
      const result = await handler(null, {
        terminalId: '770e8400-e29b-41d4-a716-446655440002',
      });

      expect(result).toEqual({
        success: false,
        terminalId: '770e8400-e29b-41d4-a716-446655440002',
        message: 'Terminal not found or already inactive',
      });
    });

    // T-IPC-005: Idempotent - already deactivated
    it('T-IPC-005: should return success:false for already deactivated terminal (idempotent)', async () => {
      mockDeactivateById.mockReturnValue(false);
      mockDeactivateByExternalId.mockReturnValue(false);

      await import('../../../src/main/ipc/terminals.handlers');

      const deactivateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:deactivate');

      const handler = deactivateCall?.[1] as IPCHandler;
      const result = await handler(null, {
        terminalId: '880e8400-e29b-41d4-a716-446655440003',
      });

      // Not an error - gracefully handles already inactive
      expect(result).toEqual({
        success: false,
        terminalId: '880e8400-e29b-41d4-a716-446655440003',
        message: 'Terminal not found or already inactive',
      });
    });

    // T-IPC-006: Store scoping (DB-006)
    it('T-IPC-006: should scope deactivation to configured store (DB-006)', async () => {
      mockGetConfiguredStore.mockReturnValue({
        id: 1,
        store_id: 'specific-tenant-store',
        name: 'Tenant Store',
      });
      mockDeactivateById.mockReturnValue(true);

      await import('../../../src/main/ipc/terminals.handlers');

      const deactivateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:deactivate');

      const handler = deactivateCall?.[1] as IPCHandler;
      await handler(null, { terminalId: '550e8400-e29b-41d4-a716-446655440000' });

      // Verify store_id is passed to DAL method
      expect(mockDeactivateById).toHaveBeenCalledWith(
        'specific-tenant-store',
        '550e8400-e29b-41d4-a716-446655440000'
      );
    });
  });

  // ==========================================================================
  // Input Validation Tests (API-001, SEC-014)
  // ==========================================================================

  describe('Input Validation (API-001, SEC-014)', () => {
    it('should accept valid UUID format for terminalId', async () => {
      mockDeactivateById.mockReturnValue(true);

      await import('../../../src/main/ipc/terminals.handlers');

      const deactivateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:deactivate');

      const handler = deactivateCall?.[1] as IPCHandler;
      const result = await handler(null, {
        terminalId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      });

      expect(result).toHaveProperty('success', true);
    });

    it('should reject empty string terminalId', async () => {
      await import('../../../src/main/ipc/terminals.handlers');

      const deactivateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:deactivate');

      const handler = deactivateCall?.[1] as IPCHandler;
      await handler(null, { terminalId: '' });

      expect(createErrorResponse).toHaveBeenCalledWith('VALIDATION_ERROR', expect.any(String));
    });

    it('should reject non-string terminalId', async () => {
      await import('../../../src/main/ipc/terminals.handlers');

      const deactivateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:deactivate');

      const handler = deactivateCall?.[1] as IPCHandler;
      await handler(null, { terminalId: 12345 });

      expect(createErrorResponse).toHaveBeenCalled();
    });

    it('should reject null terminalId', async () => {
      await import('../../../src/main/ipc/terminals.handlers');

      const deactivateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:deactivate');

      const handler = deactivateCall?.[1] as IPCHandler;
      await handler(null, { terminalId: null });

      expect(createErrorResponse).toHaveBeenCalled();
    });

    it('should reject undefined input', async () => {
      await import('../../../src/main/ipc/terminals.handlers');

      const deactivateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:deactivate');

      const handler = deactivateCall?.[1] as IPCHandler;
      await handler(null, undefined);

      expect(createErrorResponse).toHaveBeenCalled();
    });

    it('should reject null input', async () => {
      await import('../../../src/main/ipc/terminals.handlers');

      const deactivateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:deactivate');

      const handler = deactivateCall?.[1] as IPCHandler;
      await handler(null, null);

      expect(createErrorResponse).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    it('should propagate errors from DAL methods', async () => {
      mockDeactivateById.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      await import('../../../src/main/ipc/terminals.handlers');

      const deactivateCall = vi
        .mocked(registerHandler)
        .mock.calls.find((call) => call[0] === 'terminals:deactivate');

      const handler = deactivateCall?.[1] as IPCHandler;

      await expect(
        handler(null, { terminalId: '550e8400-e29b-41d4-a716-446655440000' })
      ).rejects.toThrow('Database connection failed');
    });
  });
});
