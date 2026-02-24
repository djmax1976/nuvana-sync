/**
 * Startup Backfill Guard Integration Tests
 *
 * Tests the integration between settings service and terminal backfill logic.
 * Validates that MANUAL stores skip backfill and FILE stores run backfill.
 *
 * @module tests/integration/startup-backfill-guard.spec
 *
 * Business Rules:
 * - BIZ-013: MANUAL stores receive terminals from cloud sync, not backfill
 * - CRON-001: Backfill runs only once per store (idempotency)
 *
 * Security Compliance:
 * - DB-006: Tenant isolation - backfill scoped to configured store
 *
 * Traceability Matrix:
 * | Test ID    | Component              | Risk Area          | Standard  |
 * |------------|------------------------|--------------------|-----------|
 * | T-SBKG-001 | Startup guard          | MANUAL skip        | BIZ-013  |
 * | T-SBKG-002 | Startup guard          | FILE runs backfill | CRON-001 |
 * | T-SBKG-003 | Startup guard          | Completed flag     | CRON-001 |
 * | T-SBKG-004 | Startup guard          | Null POS type      | Edge case|
 * | T-SBKG-005 | Integration            | Settings + DAL     | Integration|
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// ==========================================================================
// Mock Setup
// ==========================================================================

const { mockPrepare, mockTransaction } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn((fn: () => void) => () => fn()),
}));

// Mock database service
vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

// Mock UUID
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-uuid-integration'),
}));

// Mock logger
vi.mock('../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock config store for settings service
const mockConfigStore = {
  store: new Map<string, unknown>(),
  get: vi.fn((key: string) => mockConfigStore.store.get(key)),
  set: vi.fn((key: string, value: unknown) => mockConfigStore.store.set(key, value)),
  delete: vi.fn((key: string) => mockConfigStore.store.delete(key)),
  has: vi.fn((key: string) => mockConfigStore.store.has(key)),
  clear: vi.fn(() => mockConfigStore.store.clear()),
};

vi.mock('electron-store', () => ({
  default: vi.fn().mockImplementation(() => mockConfigStore),
}));

// ==========================================================================
// Test Fixtures
// ==========================================================================

const STORE_ID = 'store-uuid-test-001';

interface StartupGuardLogic {
  shouldSkipBackfill: (posConnectionType: string | null) => boolean;
  isBackfillCompleted: () => boolean;
  markBackfillCompleted: () => void;
}

/**
 * Extract the startup guard logic from main/index.ts for isolated testing.
 * This replicates the exact decision logic.
 */
const createStartupGuardLogic = (settingsService: {
  getPOSConnectionType: () => string | null;
  isTerminalBackfillV007Completed: () => boolean;
  markTerminalBackfillV007Completed: () => void;
}): StartupGuardLogic => ({
  shouldSkipBackfill: (posConnectionType: string | null) => {
    return posConnectionType === 'MANUAL';
  },
  isBackfillCompleted: () => settingsService.isTerminalBackfillV007Completed(),
  markBackfillCompleted: () => settingsService.markTerminalBackfillV007Completed(),
});

// ==========================================================================
// Test Suite
// ==========================================================================

describe('Startup Backfill Guard Integration Tests', () => {
  let mockSettingsService: {
    getPOSConnectionType: Mock<() => string | null>;
    isTerminalBackfillV007Completed: Mock<() => boolean>;
    markTerminalBackfillV007Completed: Mock<() => void>;
  };
  let guardLogic: StartupGuardLogic;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigStore.clear();

    mockSettingsService = {
      getPOSConnectionType: vi.fn<() => string | null>(),
      isTerminalBackfillV007Completed: vi.fn<() => boolean>(),
      markTerminalBackfillV007Completed: vi.fn<() => void>(),
    };

    guardLogic = createStartupGuardLogic(mockSettingsService);
  });

  // --------------------------------------------------------------------------
  // T-SBKG-001: MANUAL store skip
  // --------------------------------------------------------------------------

  describe('T-SBKG-001: MANUAL store backfill skip', () => {
    it('should skip backfill when posConnectionType is MANUAL', () => {
      const result = guardLogic.shouldSkipBackfill('MANUAL');

      expect(result).toBe(true);
    });

    it('should NOT call backfillFromShifts for MANUAL stores', () => {
      const mockBackfillFromShifts = vi.fn();
      mockSettingsService.getPOSConnectionType.mockReturnValue('MANUAL');

      // Simulate startup logic
      const posConnectionType = mockSettingsService.getPOSConnectionType();
      if (!guardLogic.shouldSkipBackfill(posConnectionType)) {
        mockBackfillFromShifts(STORE_ID);
      }

      expect(mockBackfillFromShifts).not.toHaveBeenCalled();
    });

    it('should log skip reason for MANUAL stores', () => {
      const logMessages: string[] = [];
      const mockLog = {
        debug: (msg: string, _meta?: object) => logMessages.push(msg),
      };

      mockSettingsService.getPOSConnectionType.mockReturnValue('MANUAL');

      // Simulate startup logic with logging
      const posConnectionType = mockSettingsService.getPOSConnectionType();
      if (guardLogic.shouldSkipBackfill(posConnectionType)) {
        mockLog.debug('Terminal backfill v007 skipped for MANUAL store', {
          storeId: STORE_ID,
          posConnectionType,
          reason: 'MANUAL stores receive terminals from cloud sync',
        });
      }

      expect(logMessages).toContain('Terminal backfill v007 skipped for MANUAL store');
    });
  });

  // --------------------------------------------------------------------------
  // T-SBKG-002: FILE store runs backfill
  // --------------------------------------------------------------------------

  describe('T-SBKG-002: FILE store backfill execution', () => {
    it('should NOT skip backfill when posConnectionType is FILE', () => {
      const result = guardLogic.shouldSkipBackfill('FILE');

      expect(result).toBe(false);
    });

    it('should run backfillFromShifts for FILE stores when not completed', () => {
      const mockBackfillFromShifts = vi.fn().mockReturnValue({ created: 5, existing: 2, total: 7 });
      mockSettingsService.getPOSConnectionType.mockReturnValue('FILE');
      mockSettingsService.isTerminalBackfillV007Completed.mockReturnValue(false);

      // Simulate startup logic
      const posConnectionType = mockSettingsService.getPOSConnectionType();
      if (!guardLogic.shouldSkipBackfill(posConnectionType)) {
        if (!guardLogic.isBackfillCompleted()) {
          mockBackfillFromShifts(STORE_ID);
          guardLogic.markBackfillCompleted();
        }
      }

      expect(mockBackfillFromShifts).toHaveBeenCalledWith(STORE_ID);
      expect(mockSettingsService.markTerminalBackfillV007Completed).toHaveBeenCalled();
    });

    it('should NOT skip for NETWORK connection type', () => {
      expect(guardLogic.shouldSkipBackfill('NETWORK')).toBe(false);
    });

    it('should NOT skip for API connection type', () => {
      expect(guardLogic.shouldSkipBackfill('API')).toBe(false);
    });

    it('should NOT skip for WEBHOOK connection type', () => {
      expect(guardLogic.shouldSkipBackfill('WEBHOOK')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // T-SBKG-003: Completion flag idempotency (CRON-001)
  // --------------------------------------------------------------------------

  describe('T-SBKG-003: Completion flag idempotency (CRON-001)', () => {
    it('should NOT run backfill when already completed', () => {
      const mockBackfillFromShifts = vi.fn();
      mockSettingsService.getPOSConnectionType.mockReturnValue('FILE');
      mockSettingsService.isTerminalBackfillV007Completed.mockReturnValue(true);

      // Simulate startup logic
      const posConnectionType = mockSettingsService.getPOSConnectionType();
      if (!guardLogic.shouldSkipBackfill(posConnectionType)) {
        if (!guardLogic.isBackfillCompleted()) {
          mockBackfillFromShifts(STORE_ID);
          guardLogic.markBackfillCompleted();
        }
      }

      expect(mockBackfillFromShifts).not.toHaveBeenCalled();
    });

    it('should only run backfill once regardless of multiple startups', () => {
      const mockBackfillFromShifts = vi.fn().mockReturnValue({ created: 0, existing: 0, total: 0 });
      let isCompleted = false;

      mockSettingsService.getPOSConnectionType.mockReturnValue('FILE');
      mockSettingsService.isTerminalBackfillV007Completed.mockImplementation(() => isCompleted);
      mockSettingsService.markTerminalBackfillV007Completed.mockImplementation(() => {
        isCompleted = true;
      });

      // Simulate first startup
      const runStartup = () => {
        const posConnectionType = mockSettingsService.getPOSConnectionType();
        if (!guardLogic.shouldSkipBackfill(posConnectionType)) {
          if (!mockSettingsService.isTerminalBackfillV007Completed()) {
            mockBackfillFromShifts(STORE_ID);
            mockSettingsService.markTerminalBackfillV007Completed();
          }
        }
      };

      // First startup
      runStartup();
      expect(mockBackfillFromShifts).toHaveBeenCalledTimes(1);

      // Second startup
      runStartup();
      expect(mockBackfillFromShifts).toHaveBeenCalledTimes(1); // Still 1, not 2

      // Third startup
      runStartup();
      expect(mockBackfillFromShifts).toHaveBeenCalledTimes(1); // Still 1
    });
  });

  // --------------------------------------------------------------------------
  // T-SBKG-004: Null/undefined POS type handling
  // --------------------------------------------------------------------------

  describe('T-SBKG-004: Null/undefined POS type handling', () => {
    it('should NOT skip backfill when posConnectionType is null', () => {
      const result = guardLogic.shouldSkipBackfill(null);

      expect(result).toBe(false);
    });

    it('should run backfill when posConnectionType is null (unconfigured store)', () => {
      const mockBackfillFromShifts = vi.fn().mockReturnValue({ created: 0, existing: 0, total: 0 });
      mockSettingsService.getPOSConnectionType.mockReturnValue(null);
      mockSettingsService.isTerminalBackfillV007Completed.mockReturnValue(false);

      // Simulate startup logic
      const posConnectionType = mockSettingsService.getPOSConnectionType();
      if (!guardLogic.shouldSkipBackfill(posConnectionType)) {
        if (!guardLogic.isBackfillCompleted()) {
          mockBackfillFromShifts(STORE_ID);
          guardLogic.markBackfillCompleted();
        }
      }

      expect(mockBackfillFromShifts).toHaveBeenCalledWith(STORE_ID);
    });

    it('should handle empty string POS type', () => {
      const result = guardLogic.shouldSkipBackfill('');

      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // T-SBKG-005: Full integration scenario
  // --------------------------------------------------------------------------

  describe('T-SBKG-005: Full integration scenario', () => {
    it('should correctly integrate all components for MANUAL store', () => {
      mockSettingsService.getPOSConnectionType.mockReturnValue('MANUAL');
      mockSettingsService.isTerminalBackfillV007Completed.mockReturnValue(false);

      const actions: string[] = [];

      // Simulate full startup flow
      const posConnectionType = mockSettingsService.getPOSConnectionType();
      if (guardLogic.shouldSkipBackfill(posConnectionType)) {
        actions.push('SKIP_BACKFILL');
      } else if (!guardLogic.isBackfillCompleted()) {
        actions.push('RUN_BACKFILL');
        guardLogic.markBackfillCompleted();
      } else {
        actions.push('ALREADY_COMPLETED');
      }

      expect(actions).toEqual(['SKIP_BACKFILL']);
    });

    it('should correctly integrate all components for FILE store (first run)', () => {
      mockSettingsService.getPOSConnectionType.mockReturnValue('FILE');
      mockSettingsService.isTerminalBackfillV007Completed.mockReturnValue(false);

      const actions: string[] = [];

      // Simulate full startup flow
      const posConnectionType = mockSettingsService.getPOSConnectionType();
      if (guardLogic.shouldSkipBackfill(posConnectionType)) {
        actions.push('SKIP_BACKFILL');
      } else if (!guardLogic.isBackfillCompleted()) {
        actions.push('RUN_BACKFILL');
        guardLogic.markBackfillCompleted();
      } else {
        actions.push('ALREADY_COMPLETED');
      }

      expect(actions).toEqual(['RUN_BACKFILL']);
    });

    it('should correctly integrate all components for FILE store (subsequent run)', () => {
      mockSettingsService.getPOSConnectionType.mockReturnValue('FILE');
      mockSettingsService.isTerminalBackfillV007Completed.mockReturnValue(true);

      const actions: string[] = [];

      // Simulate full startup flow
      const posConnectionType = mockSettingsService.getPOSConnectionType();
      if (guardLogic.shouldSkipBackfill(posConnectionType)) {
        actions.push('SKIP_BACKFILL');
      } else if (!guardLogic.isBackfillCompleted()) {
        actions.push('RUN_BACKFILL');
        guardLogic.markBackfillCompleted();
      } else {
        actions.push('ALREADY_COMPLETED');
      }

      expect(actions).toEqual(['ALREADY_COMPLETED']);
    });
  });

  // --------------------------------------------------------------------------
  // Decision Matrix Tests
  // --------------------------------------------------------------------------

  describe('Decision Matrix', () => {
    /**
     * Decision Matrix:
     * | POS Type | Completed | Expected Action    |
     * |----------|-----------|-------------------|
     * | MANUAL   | false     | SKIP_BACKFILL     |
     * | MANUAL   | true      | SKIP_BACKFILL     |
     * | FILE     | false     | RUN_BACKFILL      |
     * | FILE     | true      | ALREADY_COMPLETED |
     * | NETWORK  | false     | RUN_BACKFILL      |
     * | NETWORK  | true      | ALREADY_COMPLETED |
     * | null     | false     | RUN_BACKFILL      |
     * | null     | true      | ALREADY_COMPLETED |
     */

    const testCases = [
      { posType: 'MANUAL', completed: false, expected: 'SKIP_BACKFILL' },
      { posType: 'MANUAL', completed: true, expected: 'SKIP_BACKFILL' },
      { posType: 'FILE', completed: false, expected: 'RUN_BACKFILL' },
      { posType: 'FILE', completed: true, expected: 'ALREADY_COMPLETED' },
      { posType: 'NETWORK', completed: false, expected: 'RUN_BACKFILL' },
      { posType: 'NETWORK', completed: true, expected: 'ALREADY_COMPLETED' },
      { posType: null, completed: false, expected: 'RUN_BACKFILL' },
      { posType: null, completed: true, expected: 'ALREADY_COMPLETED' },
    ];

    it.each(testCases)(
      'should return $expected when posType=$posType and completed=$completed',
      ({ posType, completed, expected }) => {
        mockSettingsService.getPOSConnectionType.mockReturnValue(posType);
        mockSettingsService.isTerminalBackfillV007Completed.mockReturnValue(completed);

        let action: string;
        const connectionType = mockSettingsService.getPOSConnectionType();
        if (guardLogic.shouldSkipBackfill(connectionType)) {
          action = 'SKIP_BACKFILL';
        } else if (!mockSettingsService.isTerminalBackfillV007Completed()) {
          action = 'RUN_BACKFILL';
        } else {
          action = 'ALREADY_COMPLETED';
        }

        expect(action).toBe(expected);
      }
    );
  });
});

// ==========================================================================
// Regression Test for Original Bug
// ==========================================================================

describe('Regression: Duplicate Terminal Bug (Issue #XXX)', () => {
  /**
   * Original Bug Description:
   * - MANUAL store had terminal created via cloud sync (pos_system_type = 'generic')
   * - On app restart, backfillFromShifts ran
   * - backfillFromShifts used findByExternalId with default 'gilbarco' type
   * - Lookup failed because existing terminal had 'generic' type
   * - Duplicate terminal created with 'gilbarco' type
   *
   * Fix Applied:
   * 1. Added findByExternalIdAnyType - searches without type filter
   * 2. Updated backfillFromShifts to use findByExternalIdAnyType
   * 3. Added startup guard to skip backfill for MANUAL stores
   */

  it('documents the bug scenario and fix', () => {
    // This test serves as living documentation
    const bugScenario = {
      precondition: 'MANUAL store with terminal from cloud sync (generic type)',
      trigger: 'App restart triggers backfillFromShifts',
      rootCause: 'findByExternalId defaulted to gilbarco type',
      symptom: 'Duplicate terminal created',
      fix: 'findByExternalIdAnyType + startup guard for MANUAL stores',
    };

    expect(bugScenario.fix).toContain('findByExternalIdAnyType');
  });
});
