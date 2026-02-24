/**
 * POS Terminal Mappings Backfill & Type-Agnostic Lookup Tests
 *
 * Enterprise-grade test suite for the duplicate terminal bug fix.
 * Tests the new `findByExternalIdAnyType` method and `backfillFromShifts` idempotency.
 *
 * @module tests/unit/dal/pos-terminal-mappings.backfill.spec
 *
 * Security Compliance:
 * - SEC-006: SQL injection prevention via parameterized queries
 * - DB-006: Tenant isolation via store_id scoping
 *
 * Business Rules:
 * - CRON-001: Idempotency - backfill must not create duplicates
 * - BIZ-013: MANUAL stores get terminals from cloud sync, not backfill
 *
 * Traceability Matrix:
 * | Test ID    | Component              | Risk Area          | Standard  |
 * |------------|------------------------|--------------------|-----------|
 * | T-BKFL-001 | findByExternalIdAnyType | Type-agnostic lookup | SEC-006 |
 * | T-BKFL-002 | findByExternalIdAnyType | Tenant isolation   | DB-006   |
 * | T-BKFL-003 | findByExternalIdAnyType | SQL injection      | SEC-006  |
 * | T-BKFL-004 | backfillFromShifts     | Idempotency        | CRON-001 |
 * | T-BKFL-005 | backfillFromShifts     | Cross-type detect  | CRON-001 |
 * | T-BKFL-006 | backfillFromShifts     | Tenant isolation   | DB-006   |
 * | T-BKFL-007 | backfillFromShifts     | Empty shifts       | Edge case|
 * | T-BKFL-008 | backfillFromShifts     | Multiple registers | Business |
 * | T-BKFL-009 | findByExternalIdAnyType | ORDER BY created_at| Edge case|
 * | T-BKFL-010 | findByExternalIdAnyType | LIMIT 1 behavior   | Edge case|
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ==========================================================================
// Mock Setup - Use vi.hoisted() for cross-platform compatibility
// ==========================================================================

const { mockPrepare, mockTransaction } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn((fn: () => void) => () => fn()),
}));

vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-uuid-backfill-test'),
}));

vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import {
  POSTerminalMappingsDAL,
  type POSTerminalMapping,
} from '../../../src/main/dal/pos-id-mappings.dal';

// ==========================================================================
// Test Data Fixtures
// ==========================================================================

const STORE_ID_A = 'store-uuid-tenant-a';
const STORE_ID_B = 'store-uuid-tenant-b';

const createMockMapping = (overrides: Partial<POSTerminalMapping> = {}): POSTerminalMapping => ({
  id: 'mapping-uuid-001',
  store_id: STORE_ID_A,
  external_register_id: 'REG-001',
  terminal_type: 'REGISTER',
  description: 'Register 1',
  pos_system_type: 'generic',
  active: 1,
  created_at: '2026-01-15T10:00:00.000Z',
  updated_at: '2026-01-15T10:00:00.000Z',
  ...overrides,
});

// ==========================================================================
// Test Suite: findByExternalIdAnyType
// ==========================================================================

describe('POSTerminalMappingsDAL - findByExternalIdAnyType', () => {
  let dal: POSTerminalMappingsDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new POSTerminalMappingsDAL();
  });

  // --------------------------------------------------------------------------
  // T-BKFL-001: Basic functionality - returns mapping regardless of pos_system_type
  // --------------------------------------------------------------------------

  describe('T-BKFL-001: Type-agnostic lookup functionality', () => {
    it('should find mapping with pos_system_type = generic', () => {
      const genericMapping = createMockMapping({ pos_system_type: 'generic' });
      const mockGet = vi.fn().mockReturnValue(genericMapping);
      mockPrepare.mockReturnValue({ get: mockGet });

      const result = dal.findByExternalIdAnyType(STORE_ID_A, 'REG-001');

      expect(result).toEqual(genericMapping);
      expect(mockGet).toHaveBeenCalledWith(STORE_ID_A, 'REG-001');
    });

    it('should find mapping with pos_system_type = gilbarco', () => {
      const gilbarcoMapping = createMockMapping({ pos_system_type: 'gilbarco' });
      const mockGet = vi.fn().mockReturnValue(gilbarcoMapping);
      mockPrepare.mockReturnValue({ get: mockGet });

      const result = dal.findByExternalIdAnyType(STORE_ID_A, 'REG-001');

      expect(result).toEqual(gilbarcoMapping);
    });

    it('should return undefined when no mapping exists', () => {
      const mockGet = vi.fn().mockReturnValue(undefined);
      mockPrepare.mockReturnValue({ get: mockGet });

      const result = dal.findByExternalIdAnyType(STORE_ID_A, 'NONEXISTENT-REG');

      expect(result).toBeUndefined();
    });

    it('should NOT filter by pos_system_type in query', () => {
      const mockGet = vi.fn().mockReturnValue(undefined);
      mockPrepare.mockReturnValue({ get: mockGet });

      dal.findByExternalIdAnyType(STORE_ID_A, 'REG-001');

      const query = mockPrepare.mock.calls[0][0] as string;
      // Should NOT contain pos_system_type filter
      expect(query).not.toContain('pos_system_type');
      // Should contain store_id and external_register_id
      expect(query).toContain('store_id = ?');
      expect(query).toContain('external_register_id = ?');
    });
  });

  // --------------------------------------------------------------------------
  // T-BKFL-002: Tenant isolation (DB-006)
  // --------------------------------------------------------------------------

  describe('T-BKFL-002: Tenant isolation (DB-006)', () => {
    it('should only return mapping for the specified store_id', () => {
      const mockGet = vi.fn().mockReturnValue(undefined);
      mockPrepare.mockReturnValue({ get: mockGet });

      dal.findByExternalIdAnyType(STORE_ID_A, 'REG-001');

      // Verify store_id is passed as parameter
      expect(mockGet).toHaveBeenCalledWith(STORE_ID_A, 'REG-001');
    });

    it('should include store_id in WHERE clause', () => {
      const mockGet = vi.fn().mockReturnValue(undefined);
      mockPrepare.mockReturnValue({ get: mockGet });

      dal.findByExternalIdAnyType(STORE_ID_A, 'REG-001');

      const query = mockPrepare.mock.calls[0][0] as string;
      expect(query).toContain('WHERE store_id = ?');
    });

    it('should not find mapping from different store', () => {
      // Mapping exists for STORE_ID_A
      const mappingForStoreA = createMockMapping({ store_id: STORE_ID_A });
      const mockGet = vi.fn().mockImplementation((storeId: string) => {
        if (storeId === STORE_ID_A) return mappingForStoreA;
        return undefined; // Different store
      });
      mockPrepare.mockReturnValue({ get: mockGet });

      // Query with STORE_ID_B should not find it
      const result = dal.findByExternalIdAnyType(STORE_ID_B, 'REG-001');

      expect(result).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // T-BKFL-003: SQL injection prevention (SEC-006)
  // --------------------------------------------------------------------------

  describe('T-BKFL-003: SQL injection prevention (SEC-006)', () => {
    const sqlInjectionPayloads = [
      "'; DROP TABLE pos_terminal_mappings;--",
      "' OR '1'='1",
      '1 UNION SELECT * FROM stores--',
      "'; UPDATE pos_terminal_mappings SET active=0;--",
      '1/**/OR/**/1=1',
      "' AND (SELECT COUNT(*) FROM users) > 0--",
    ];

    it.each(sqlInjectionPayloads)(
      'should safely handle SQL injection in externalRegisterId: %s',
      (payload) => {
        const mockGet = vi.fn().mockReturnValue(undefined);
        mockPrepare.mockReturnValue({ get: mockGet });

        dal.findByExternalIdAnyType(STORE_ID_A, payload);

        // Assert: payload is NOT in query string
        const query = mockPrepare.mock.calls[0][0] as string;
        expect(query).not.toContain('DROP');
        expect(query).not.toContain('UNION');
        expect(query).not.toContain('UPDATE');

        // Assert: payload is passed as parameter
        expect(mockGet).toHaveBeenCalledWith(STORE_ID_A, payload);
      }
    );

    it.each(sqlInjectionPayloads)(
      'should safely handle SQL injection in storeId: %s',
      (payload) => {
        const mockGet = vi.fn().mockReturnValue(undefined);
        mockPrepare.mockReturnValue({ get: mockGet });

        dal.findByExternalIdAnyType(payload, 'REG-001');

        // Assert: payload is NOT in query string
        const query = mockPrepare.mock.calls[0][0] as string;
        expect(query).not.toContain('DROP');
        expect(query).not.toContain('UNION');

        // Assert: payload is passed as parameter
        expect(mockGet).toHaveBeenCalledWith(payload, 'REG-001');
      }
    );

    it('should use only placeholder tokens in query', () => {
      const mockGet = vi.fn().mockReturnValue(undefined);
      mockPrepare.mockReturnValue({ get: mockGet });

      dal.findByExternalIdAnyType(STORE_ID_A, 'REG-001');

      const query = mockPrepare.mock.calls[0][0] as string;
      const placeholderCount = (query.match(/\?/g) || []).length;
      expect(placeholderCount).toBe(2); // store_id, external_register_id

      // Ensure no direct value interpolation
      expect(query).not.toContain(STORE_ID_A);
      expect(query).not.toContain('REG-001');
    });
  });

  // --------------------------------------------------------------------------
  // T-BKFL-009: ORDER BY and LIMIT behavior
  // --------------------------------------------------------------------------

  describe('T-BKFL-009: ORDER BY created_at ASC behavior', () => {
    it('should order results by created_at ASC to get oldest mapping', () => {
      const mockGet = vi.fn().mockReturnValue(createMockMapping());
      mockPrepare.mockReturnValue({ get: mockGet });

      dal.findByExternalIdAnyType(STORE_ID_A, 'REG-001');

      const query = mockPrepare.mock.calls[0][0] as string;
      expect(query).toContain('ORDER BY created_at ASC');
    });

    it('should limit to 1 result', () => {
      const mockGet = vi.fn().mockReturnValue(createMockMapping());
      mockPrepare.mockReturnValue({ get: mockGet });

      dal.findByExternalIdAnyType(STORE_ID_A, 'REG-001');

      const query = mockPrepare.mock.calls[0][0] as string;
      expect(query).toContain('LIMIT 1');
    });
  });
});

// ==========================================================================
// Test Suite: backfillFromShifts Idempotency
// ==========================================================================

describe('POSTerminalMappingsDAL - backfillFromShifts Idempotency (CRON-001)', () => {
  let dal: POSTerminalMappingsDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new POSTerminalMappingsDAL();
  });

  // --------------------------------------------------------------------------
  // T-BKFL-004: Idempotency - does not create duplicates
  // --------------------------------------------------------------------------

  describe('T-BKFL-004: Idempotency - no duplicate creation', () => {
    it('should not create mapping when one already exists with pos_system_type = generic', () => {
      // Setup: existing mapping with generic type
      const existingGenericMapping = createMockMapping({
        external_register_id: 'cloud-uuid-001',
        pos_system_type: 'generic',
      });

      // Mock debug query
      const mockDebugGet = vi
        .fn()
        .mockReturnValue({ total: 1, with_reg_id: 0, with_ext_reg_id: 1 });
      // Mock sample query
      const mockSampleAll = vi
        .fn()
        .mockReturnValue([
          { shift_id: 'shift-1', register_id: null, external_register_id: 'cloud-uuid-001' },
        ]);
      // Mock distinct register query
      const mockDistinctAll = vi.fn().mockReturnValue([{ reg_id: 'cloud-uuid-001' }]);
      // Mock findByExternalIdAnyType - RETURNS EXISTING
      const mockFindGet = vi.fn().mockReturnValue(existingGenericMapping);

      mockPrepare
        .mockReturnValueOnce({ get: mockDebugGet }) // debug stats
        .mockReturnValueOnce({ all: mockSampleAll }) // sample shifts
        .mockReturnValueOnce({ all: mockDistinctAll }) // distinct registers
        .mockReturnValueOnce({ get: mockFindGet }); // findByExternalIdAnyType

      const result = dal.backfillFromShifts(STORE_ID_A);

      // Assert: 0 created, 1 existing
      expect(result).toEqual({ created: 0, existing: 1, total: 1 });
    });

    it('should not create mapping when one already exists with pos_system_type = gilbarco', () => {
      // Setup: existing mapping with gilbarco type (from file parsing)
      const existingGilbarcoMapping = createMockMapping({
        external_register_id: 'REG-001',
        pos_system_type: 'gilbarco',
      });

      const mockDebugGet = vi
        .fn()
        .mockReturnValue({ total: 1, with_reg_id: 1, with_ext_reg_id: 0 });
      const mockSampleAll = vi
        .fn()
        .mockReturnValue([
          { shift_id: 'shift-1', register_id: 'REG-001', external_register_id: null },
        ]);
      const mockDistinctAll = vi.fn().mockReturnValue([{ reg_id: 'REG-001' }]);
      // Mock findByExternalIdAnyType - RETURNS EXISTING (gilbarco type)
      const mockFindGet = vi.fn().mockReturnValue(existingGilbarcoMapping);

      mockPrepare
        .mockReturnValueOnce({ get: mockDebugGet })
        .mockReturnValueOnce({ all: mockSampleAll })
        .mockReturnValueOnce({ all: mockDistinctAll })
        .mockReturnValueOnce({ get: mockFindGet });

      const result = dal.backfillFromShifts(STORE_ID_A);

      // Assert: 0 created, 1 existing
      expect(result).toEqual({ created: 0, existing: 1, total: 1 });
    });
  });

  // --------------------------------------------------------------------------
  // T-BKFL-005: Cross-type detection - key fix for the bug
  // --------------------------------------------------------------------------

  describe('T-BKFL-005: Cross-type detection (bug fix)', () => {
    it('should detect existing generic mapping when backfill would create gilbarco mapping', () => {
      // This is the EXACT bug scenario:
      // - Terminal exists with pos_system_type = 'generic' (from cloud sync)
      // - Backfill runs and tries to create with pos_system_type = 'gilbarco'
      // - OLD CODE: findByExternalId('gilbarco') returns undefined -> DUPLICATE!
      // - NEW CODE: findByExternalIdAnyType() returns the generic mapping -> NO DUPLICATE

      const existingGenericMapping = createMockMapping({
        external_register_id: 'cloud-uuid-terminal',
        pos_system_type: 'generic', // From cloud sync
        description: 'Register 1',
      });

      const mockDebugGet = vi
        .fn()
        .mockReturnValue({ total: 1, with_reg_id: 0, with_ext_reg_id: 1 });
      const mockSampleAll = vi
        .fn()
        .mockReturnValue([
          { shift_id: 'shift-1', register_id: null, external_register_id: 'cloud-uuid-terminal' },
        ]);
      const mockDistinctAll = vi.fn().mockReturnValue([{ reg_id: 'cloud-uuid-terminal' }]);
      // KEY: findByExternalIdAnyType finds the generic mapping
      const mockFindGet = vi.fn().mockReturnValue(existingGenericMapping);

      mockPrepare
        .mockReturnValueOnce({ get: mockDebugGet })
        .mockReturnValueOnce({ all: mockSampleAll })
        .mockReturnValueOnce({ all: mockDistinctAll })
        .mockReturnValueOnce({ get: mockFindGet });

      const result = dal.backfillFromShifts(STORE_ID_A);

      // Assert: No duplicate created!
      expect(result.created).toBe(0);
      expect(result.existing).toBe(1);
    });

    it('should create mapping only when no mapping exists with ANY pos_system_type', () => {
      const mockDebugGet = vi
        .fn()
        .mockReturnValue({ total: 1, with_reg_id: 1, with_ext_reg_id: 0 });
      const mockSampleAll = vi
        .fn()
        .mockReturnValue([
          { shift_id: 'shift-1', register_id: 'REG-NEW', external_register_id: null },
        ]);
      const mockDistinctAll = vi.fn().mockReturnValue([{ reg_id: 'REG-NEW' }]);
      // findByExternalIdAnyType returns undefined - truly new register
      const mockFindGet = vi.fn().mockReturnValue(undefined);
      // getOrCreate mocks
      const mockExternalGet = vi.fn().mockReturnValue(undefined);
      const mockInsertRun = vi.fn();
      const mockFindByIdGet = vi
        .fn()
        .mockReturnValue(createMockMapping({ external_register_id: 'REG-NEW' }));

      mockPrepare
        .mockReturnValueOnce({ get: mockDebugGet }) // debug stats
        .mockReturnValueOnce({ all: mockSampleAll }) // sample shifts
        .mockReturnValueOnce({ all: mockDistinctAll }) // distinct registers
        .mockReturnValueOnce({ get: mockFindGet }) // findByExternalIdAnyType - not found
        .mockReturnValueOnce({ get: mockExternalGet }) // getOrCreate -> findByExternalId
        .mockReturnValueOnce({ run: mockInsertRun }) // getOrCreate -> INSERT
        .mockReturnValueOnce({ get: mockFindByIdGet }); // getOrCreate -> findById

      const result = dal.backfillFromShifts(STORE_ID_A);

      // Assert: 1 created, 0 existing
      expect(result.created).toBe(1);
      expect(result.existing).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // T-BKFL-006: Tenant isolation in backfill (DB-006)
  // --------------------------------------------------------------------------

  describe('T-BKFL-006: Tenant isolation in backfill (DB-006)', () => {
    it('should only query shifts for the specified store_id', () => {
      const mockDebugGet = vi
        .fn()
        .mockReturnValue({ total: 0, with_reg_id: 0, with_ext_reg_id: 0 });
      const mockSampleAll = vi.fn().mockReturnValue([]);
      const mockDistinctAll = vi.fn().mockReturnValue([]);

      mockPrepare
        .mockReturnValueOnce({ get: mockDebugGet })
        .mockReturnValueOnce({ all: mockSampleAll })
        .mockReturnValueOnce({ all: mockDistinctAll });

      dal.backfillFromShifts(STORE_ID_A);

      // Verify debug query uses store_id
      expect(mockDebugGet).toHaveBeenCalledWith(STORE_ID_A);
      // Verify sample query uses store_id
      expect(mockSampleAll).toHaveBeenCalledWith(STORE_ID_A);
      // Verify distinct query uses store_id
      expect(mockDistinctAll).toHaveBeenCalledWith(STORE_ID_A);
    });

    it('should include store_id in all shift queries', () => {
      const mockDebugGet = vi
        .fn()
        .mockReturnValue({ total: 0, with_reg_id: 0, with_ext_reg_id: 0 });
      const mockSampleAll = vi.fn().mockReturnValue([]);
      const mockDistinctAll = vi.fn().mockReturnValue([]);

      mockPrepare
        .mockReturnValueOnce({ get: mockDebugGet })
        .mockReturnValueOnce({ all: mockSampleAll })
        .mockReturnValueOnce({ all: mockDistinctAll });

      dal.backfillFromShifts(STORE_ID_A);

      // Check all queries contain store_id = ?
      const queries = mockPrepare.mock.calls.map((call) => call[0] as string);
      queries.forEach((query) => {
        expect(query).toContain('store_id = ?');
      });
    });
  });

  // --------------------------------------------------------------------------
  // T-BKFL-007: Empty shifts edge case
  // --------------------------------------------------------------------------

  describe('T-BKFL-007: Empty shifts handling', () => {
    it('should handle store with no shifts gracefully', () => {
      const mockDebugGet = vi
        .fn()
        .mockReturnValue({ total: 0, with_reg_id: 0, with_ext_reg_id: 0 });
      const mockSampleAll = vi.fn().mockReturnValue([]);
      const mockDistinctAll = vi.fn().mockReturnValue([]);

      mockPrepare
        .mockReturnValueOnce({ get: mockDebugGet })
        .mockReturnValueOnce({ all: mockSampleAll })
        .mockReturnValueOnce({ all: mockDistinctAll });

      const result = dal.backfillFromShifts(STORE_ID_A);

      expect(result).toEqual({ created: 0, existing: 0, total: 0 });
    });

    it('should skip shifts with null/empty register IDs', () => {
      const mockDebugGet = vi
        .fn()
        .mockReturnValue({ total: 2, with_reg_id: 0, with_ext_reg_id: 0 });
      const mockSampleAll = vi.fn().mockReturnValue([
        { shift_id: 'shift-1', register_id: null, external_register_id: null },
        { shift_id: 'shift-2', register_id: '', external_register_id: '' },
      ]);
      // The DISTINCT query should filter these out
      const mockDistinctAll = vi.fn().mockReturnValue([]);

      mockPrepare
        .mockReturnValueOnce({ get: mockDebugGet })
        .mockReturnValueOnce({ all: mockSampleAll })
        .mockReturnValueOnce({ all: mockDistinctAll });

      const result = dal.backfillFromShifts(STORE_ID_A);

      expect(result).toEqual({ created: 0, existing: 0, total: 0 });
    });

    it('should skip row when reg_id is null in result', () => {
      const mockDebugGet = vi
        .fn()
        .mockReturnValue({ total: 1, with_reg_id: 0, with_ext_reg_id: 0 });
      const mockSampleAll = vi
        .fn()
        .mockReturnValue([{ shift_id: 'shift-1', register_id: null, external_register_id: null }]);
      // Query returns row with null reg_id (edge case)
      const mockDistinctAll = vi.fn().mockReturnValue([{ reg_id: null }]);

      mockPrepare
        .mockReturnValueOnce({ get: mockDebugGet })
        .mockReturnValueOnce({ all: mockSampleAll })
        .mockReturnValueOnce({ all: mockDistinctAll });

      const result = dal.backfillFromShifts(STORE_ID_A);

      // Should skip the null reg_id row
      expect(result.total).toBe(1);
      expect(result.created).toBe(0);
      expect(result.existing).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // T-BKFL-008: Multiple registers handling
  // --------------------------------------------------------------------------

  describe('T-BKFL-008: Multiple registers handling', () => {
    it('should process multiple registers correctly', () => {
      const existingMapping1 = createMockMapping({ external_register_id: 'REG-001' });

      const mockDebugGet = vi
        .fn()
        .mockReturnValue({ total: 3, with_reg_id: 3, with_ext_reg_id: 0 });
      const mockSampleAll = vi.fn().mockReturnValue([
        { shift_id: 'shift-1', register_id: 'REG-001', external_register_id: null },
        { shift_id: 'shift-2', register_id: 'REG-002', external_register_id: null },
        { shift_id: 'shift-3', register_id: 'REG-003', external_register_id: null },
      ]);
      const mockDistinctAll = vi
        .fn()
        .mockReturnValue([{ reg_id: 'REG-001' }, { reg_id: 'REG-002' }, { reg_id: 'REG-003' }]);

      // First register exists, second and third don't
      const mockFindGet = vi
        .fn()
        .mockReturnValueOnce(existingMapping1) // REG-001 exists
        .mockReturnValueOnce(undefined) // REG-002 doesn't exist
        .mockReturnValueOnce(undefined); // REG-003 doesn't exist

      // getOrCreate mocks for REG-002
      const mockGetOrCreate2Get = vi.fn().mockReturnValue(undefined);
      const mockGetOrCreate2Run = vi.fn();
      const mockGetOrCreate2FindById = vi
        .fn()
        .mockReturnValue(createMockMapping({ external_register_id: 'REG-002' }));

      // getOrCreate mocks for REG-003
      const mockGetOrCreate3Get = vi.fn().mockReturnValue(undefined);
      const mockGetOrCreate3Run = vi.fn();
      const mockGetOrCreate3FindById = vi
        .fn()
        .mockReturnValue(createMockMapping({ external_register_id: 'REG-003' }));

      mockPrepare
        .mockReturnValueOnce({ get: mockDebugGet }) // debug stats
        .mockReturnValueOnce({ all: mockSampleAll }) // sample shifts
        .mockReturnValueOnce({ all: mockDistinctAll }) // distinct registers
        // REG-001
        .mockReturnValueOnce({ get: mockFindGet }) // findByExternalIdAnyType - exists
        // REG-002 - getOrCreate path
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) }) // findByExternalIdAnyType - not found
        .mockReturnValueOnce({ get: mockGetOrCreate2Get }) // getOrCreate -> findByExternalId
        .mockReturnValueOnce({ run: mockGetOrCreate2Run }) // getOrCreate -> INSERT
        .mockReturnValueOnce({ get: mockGetOrCreate2FindById }) // getOrCreate -> findById
        // REG-003 - getOrCreate path
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) }) // findByExternalIdAnyType - not found
        .mockReturnValueOnce({ get: mockGetOrCreate3Get }) // getOrCreate -> findByExternalId
        .mockReturnValueOnce({ run: mockGetOrCreate3Run }) // getOrCreate -> INSERT
        .mockReturnValueOnce({ get: mockGetOrCreate3FindById }); // getOrCreate -> findById

      const result = dal.backfillFromShifts(STORE_ID_A);

      // Assert: 2 created, 1 existing
      expect(result).toEqual({ created: 2, existing: 1, total: 3 });
    });
  });
});

// ==========================================================================
// Test Suite: Security Tests for New Methods
// ==========================================================================

describe('POSTerminalMappingsDAL - Backfill Security Tests', () => {
  let dal: POSTerminalMappingsDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new POSTerminalMappingsDAL();
  });

  // --------------------------------------------------------------------------
  // Edge Cases and Boundary Conditions
  // --------------------------------------------------------------------------

  describe('Edge Cases', () => {
    it('should handle unicode characters in external_register_id', () => {
      const mockGet = vi.fn().mockReturnValue(undefined);
      mockPrepare.mockReturnValue({ get: mockGet });

      const unicodeId = 'REG-日本語-🔥-emoji';
      expect(() => dal.findByExternalIdAnyType(STORE_ID_A, unicodeId)).not.toThrow();
      expect(mockGet).toHaveBeenCalledWith(STORE_ID_A, unicodeId);
    });

    it('should handle very long external_register_id', () => {
      const mockGet = vi.fn().mockReturnValue(undefined);
      mockPrepare.mockReturnValue({ get: mockGet });

      const longId = 'R'.repeat(1000);
      expect(() => dal.findByExternalIdAnyType(STORE_ID_A, longId)).not.toThrow();
      expect(mockGet).toHaveBeenCalledWith(STORE_ID_A, longId);
    });

    it('should handle null-byte characters', () => {
      const mockGet = vi.fn().mockReturnValue(undefined);
      mockPrepare.mockReturnValue({ get: mockGet });

      const nullByteId = 'REG\x00001';
      expect(() => dal.findByExternalIdAnyType(STORE_ID_A, nullByteId)).not.toThrow();
    });

    it('should handle empty string external_register_id', () => {
      const mockGet = vi.fn().mockReturnValue(undefined);
      mockPrepare.mockReturnValue({ get: mockGet });

      expect(() => dal.findByExternalIdAnyType(STORE_ID_A, '')).not.toThrow();
    });

    it('should handle empty string store_id', () => {
      const mockGet = vi.fn().mockReturnValue(undefined);
      mockPrepare.mockReturnValue({ get: mockGet });

      expect(() => dal.findByExternalIdAnyType('', 'REG-001')).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Query Structure Validation
  // --------------------------------------------------------------------------

  describe('Query Structure Validation', () => {
    it('findByExternalIdAnyType should have correct query structure', () => {
      const mockGet = vi.fn().mockReturnValue(undefined);
      mockPrepare.mockReturnValue({ get: mockGet });

      dal.findByExternalIdAnyType(STORE_ID_A, 'REG-001');

      const query = mockPrepare.mock.calls[0][0] as string;

      // Verify required clauses
      expect(query).toContain('SELECT');
      expect(query).toContain('FROM pos_terminal_mappings');
      expect(query).toContain('WHERE');
      expect(query).toContain('store_id = ?');
      expect(query).toContain('external_register_id = ?');
      expect(query).toContain('ORDER BY created_at ASC');
      expect(query).toContain('LIMIT 1');

      // Verify NO pos_system_type filter
      expect(query).not.toContain('pos_system_type');
    });
  });
});

// ==========================================================================
// Test Suite: Integration with Startup Guard
// ==========================================================================

describe('POSTerminalMappingsDAL - Startup Guard Integration Context', () => {
  let _dal: POSTerminalMappingsDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    _dal = new POSTerminalMappingsDAL();
  });

  describe('Context: MANUAL store scenario (documented for integration tests)', () => {
    /**
     * Integration test context:
     * For MANUAL stores, the startup code in main/index.ts should:
     * 1. Check posConnectionType === 'MANUAL'
     * 2. Skip backfillFromShifts entirely
     *
     * This prevents any possibility of duplicate creation for MANUAL stores.
     * The actual startup guard test is in integration/startup-backfill.spec.ts
     */
    it('documents that backfill should be skipped for MANUAL stores', () => {
      // This test serves as documentation
      // The actual startup guard is tested in integration tests
      expect(true).toBe(true);
    });
  });

  describe('Context: FILE-based store scenario', () => {
    /**
     * For FILE-based stores (Gilbarco, Verifone):
     * - backfillFromShifts should run (if not previously completed)
     * - Should use findByExternalIdAnyType to prevent duplicates
     * - Created mappings will have pos_system_type = 'gilbarco'
     */
    it('documents FILE store backfill behavior', () => {
      expect(true).toBe(true);
    });
  });
});
