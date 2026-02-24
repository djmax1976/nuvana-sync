/**
 * POS Terminal Mappings DAL Unit Tests
 *
 * Tests for findById and update methods added in Phase 2.
 * Validates SEC-006 (parameterized queries) and DB-006 (tenant isolation).
 *
 * @module tests/unit/dal/pos-id-mappings.dal.spec
 *
 * Security Compliance:
 * - SEC-006: All queries use prepared statements with parameter binding
 * - DB-006: Tenant isolation enforced at caller level for findById/update
 *
 * Test Coverage:
 * - 6.2.1 through 6.2.12 per Phase 6 test plan
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted() to ensure mock functions are available when vi.mock runs
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
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

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-uuid-terminal-mapping'),
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
  POSTerminalMappingsDAL,
  type POSTerminalMapping,
} from '../../../src/main/dal/pos-id-mappings.dal';
import { CloudRegisterSchema } from '../../../src/shared/types/config.types';

describe('POSTerminalMappingsDAL', () => {
  let dal: POSTerminalMappingsDAL;

  const mockMapping: POSTerminalMapping = {
    id: 'mapping-uuid-001',
    store_id: 'store-abc-123',
    external_register_id: 'REG-001',
    terminal_type: 'REGISTER',
    description: 'Front Counter Register',
    pos_system_type: 'gilbarco',
    active: 1,
    created_at: '2026-01-15T10:00:00.000Z',
    updated_at: '2026-01-15T10:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new POSTerminalMappingsDAL();
  });

  // ==========================================================================
  // findById Tests (6.2.1 - 6.2.3)
  // ==========================================================================

  describe('findById', () => {
    // 6.2.1 - Returns mapping for valid ID
    it('6.2.1: should return mapping for valid ID', () => {
      const mockGet = vi.fn().mockReturnValue(mockMapping);
      mockPrepare.mockReturnValue({ get: mockGet });

      const result = dal.findById('mapping-uuid-001');

      expect(result).toEqual(mockMapping);
      expect(mockGet).toHaveBeenCalledWith('mapping-uuid-001');
    });

    // 6.2.2 - Returns undefined for non-existent ID
    it('6.2.2: should return undefined for non-existent ID', () => {
      const mockGet = vi.fn().mockReturnValue(undefined);
      mockPrepare.mockReturnValue({ get: mockGet });

      const result = dal.findById('nonexistent-uuid');

      expect(result).toBeUndefined();
    });

    // 6.2.3 - Uses parameterized query (SEC-006)
    it('6.2.3: should use parameterized query (SEC-006)', () => {
      const mockGet = vi.fn().mockReturnValue(mockMapping);
      mockPrepare.mockReturnValue({ get: mockGet });

      dal.findById('mapping-uuid-001');

      // Assert: query uses ? placeholder, not string interpolation
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('?'));

      // Assert: ID passed as parameter to get(), not embedded in query
      expect(mockGet).toHaveBeenCalledWith('mapping-uuid-001');
    });
  });

  // ==========================================================================
  // update Tests (6.2.4 - 6.2.10)
  // ==========================================================================

  describe('update', () => {
    // 6.2.4 - Modifies terminal_type field
    it('6.2.4: should modify terminal_type field', () => {
      const mockRun = vi.fn();
      const updatedMapping = { ...mockMapping, terminal_type: 'KIOSK' as const };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun }) // UPDATE query
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(updatedMapping) }); // findById after update

      const result = dal.update('mapping-uuid-001', { terminal_type: 'KIOSK' });

      expect(result?.terminal_type).toBe('KIOSK');
      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      expect(updateQuery).toContain('terminal_type = ?');
      expect(updateQuery).toContain('updated_at = ?');
    });

    // 6.2.5 - Modifies description field
    it('6.2.5: should modify description field', () => {
      const mockRun = vi.fn();
      const updatedMapping = { ...mockMapping, description: 'Back Office Terminal' };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(updatedMapping) });

      const result = dal.update('mapping-uuid-001', { description: 'Back Office Terminal' });

      expect(result?.description).toBe('Back Office Terminal');
      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      expect(updateQuery).toContain('description = ?');
    });

    // 6.2.6 - Modifies active status
    it('6.2.6: should modify active status', () => {
      const mockRun = vi.fn();
      const updatedMapping = { ...mockMapping, active: 0 };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(updatedMapping) });

      const result = dal.update('mapping-uuid-001', { active: 0 });

      expect(result?.active).toBe(0);
      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      expect(updateQuery).toContain('active = ?');

      // Assert: value passed as parameter (integer, not boolean)
      expect(mockRun).toHaveBeenCalledWith(
        0, // active value
        expect.any(String), // updated_at timestamp
        'mapping-uuid-001' // WHERE id = ?
      );
    });

    // 6.2.7 - Modifies multiple fields simultaneously
    it('6.2.7: should modify multiple fields simultaneously', () => {
      const mockRun = vi.fn();
      const updatedMapping = {
        ...mockMapping,
        terminal_type: 'KIOSK' as const,
        description: 'Self-Service Kiosk',
        active: 0,
      };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(updatedMapping) });

      dal.update('mapping-uuid-001', {
        terminal_type: 'KIOSK',
        description: 'Self-Service Kiosk',
        active: 0,
      });

      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      expect(updateQuery).toContain('terminal_type = ?');
      expect(updateQuery).toContain('description = ?');
      expect(updateQuery).toContain('active = ?');
      expect(updateQuery).toContain('updated_at = ?');

      // Parameters: terminal_type, description, active, updated_at, id
      expect(mockRun).toHaveBeenCalledWith(
        'KIOSK',
        'Self-Service Kiosk',
        0,
        expect.any(String), // updated_at
        'mapping-uuid-001' // WHERE id = ?
      );
    });

    // 6.2.8 - With no fields returns existing record unchanged
    it('6.2.8: should return existing record unchanged when no fields to update', () => {
      const mockGet = vi.fn().mockReturnValue(mockMapping);
      mockPrepare.mockReturnValue({ get: mockGet });

      const result = dal.update('mapping-uuid-001', {});

      // findById is called, run is NOT called (no UPDATE statement prepared)
      expect(result).toEqual(mockMapping);
      // Only one prepare call for findById, no UPDATE query
      expect(mockPrepare).toHaveBeenCalledTimes(1);
      const query = mockPrepare.mock.calls[0][0] as string;
      expect(query).toContain('SELECT');
      expect(query).not.toContain('UPDATE');
    });

    // 6.2.9 - Always sets updated_at timestamp
    it('6.2.9: should always set updated_at timestamp', () => {
      const mockRun = vi.fn();
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockMapping) });

      dal.update('mapping-uuid-001', { description: 'Updated Description' });

      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      expect(updateQuery).toContain('updated_at = ?');

      // Verify timestamp parameter is a valid ISO 8601 string
      const timestampParam = mockRun.mock.calls[0][1]; // second param: updated_at
      expect(typeof timestampParam).toBe('string');
      expect(new Date(timestampParam as string).toISOString()).toBe(timestampParam);
    });

    // 6.2.10 - Uses parameterized query (SEC-006)
    it('6.2.10: should use parameterized query (SEC-006)', () => {
      const mockRun = vi.fn();
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockMapping) });

      dal.update('mapping-uuid-001', { terminal_type: 'MOBILE' });

      // Assert: query uses only ? placeholders, no string interpolation
      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      expect(updateQuery).toContain('?');
      // Ensure no interpolated values
      expect(updateQuery).not.toContain('MOBILE');
      expect(updateQuery).not.toContain('mapping-uuid-001');
    });
  });

  // ==========================================================================
  // Tenant Isolation Tests (6.2.11 - 6.2.12)
  // DB-006: Store-scoped queries
  // ==========================================================================

  describe('Tenant Isolation (DB-006)', () => {
    // 6.2.11 - findById does not include store_id (globally unique UUID)
    it('6.2.11: findById uses globally unique UUID without store_id in query', () => {
      const mockGet = vi.fn().mockReturnValue(mockMapping);
      mockPrepare.mockReturnValue({ get: mockGet });

      dal.findById('mapping-uuid-001');

      const query = mockPrepare.mock.calls[0][0] as string;
      // Internal UUIDs are globally unique; store_id scoping enforced at caller level
      expect(query).toContain('WHERE');
      expect(query).toContain('= ?');
      // Verify query uses the primary key column
      expect(query).toContain('id');
    });

    // 6.2.12 - update does not include store_id in WHERE clause
    it('6.2.12: update scopes by ID only (caller ensures tenant isolation via findByExternalId)', () => {
      const mockRun = vi.fn();
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockMapping) });

      dal.update('mapping-uuid-001', { active: 1 });

      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      // Callers ensure tenant isolation before calling update with a valid ID
      expect(updateQuery).toContain('WHERE id = ?');
      expect(updateQuery).not.toContain('store_id');
    });
  });

  // ==========================================================================
  // Security Tests (6.7.1, 6.7.2, 6.7.3)
  // SEC-006: SQL injection prevention via parameterized queries
  // ==========================================================================

  describe('deactivateStaleCloudRegisters', () => {
    // 6.2.13 - Deactivates cloud registers not in active set
    it('6.2.13: should deactivate cloud-sourced registers not in active set', () => {
      const mockAllResults = [
        { id: 'id-1', external_register_id: 'REG-OLD' },
        { id: 'id-2', external_register_id: 'REG-CURRENT' },
      ];
      const mockAll = vi.fn().mockReturnValue(mockAllResults);
      const mockRun = vi.fn();

      mockPrepare
        .mockReturnValueOnce({ all: mockAll }) // SELECT active cloud registers
        .mockReturnValueOnce({ run: mockRun }); // UPDATE to deactivate REG-OLD

      const activeIds = new Set(['REG-CURRENT']);
      const result = dal.deactivateStaleCloudRegisters('store-001', activeIds);

      expect(result).toBe(1);
      // SELECT should query for generic pos_system_type
      const selectQuery = mockPrepare.mock.calls[0][0] as string;
      expect(selectQuery).toContain("pos_system_type = 'generic'");
      expect(selectQuery).toContain('active = 1');
      // UPDATE should use parameterized query (SEC-006)
      const updateQuery = mockPrepare.mock.calls[1][0] as string;
      expect(updateQuery).toContain('active = 0');
      expect(updateQuery).toContain('WHERE id = ? AND store_id = ?');
      expect(mockRun).toHaveBeenCalledWith(expect.any(String), 'id-1', 'store-001');
    });

    // 6.2.14 - Does not deactivate when all registers are in active set
    it('6.2.14: should not deactivate when all cloud registers are current', () => {
      const mockAllResults = [
        { id: 'id-1', external_register_id: 'REG-A' },
        { id: 'id-2', external_register_id: 'REG-B' },
      ];
      const mockAll = vi.fn().mockReturnValue(mockAllResults);

      mockPrepare.mockReturnValueOnce({ all: mockAll });

      const activeIds = new Set(['REG-A', 'REG-B']);
      const result = dal.deactivateStaleCloudRegisters('store-001', activeIds);

      expect(result).toBe(0);
      // Only the SELECT should have been prepared, no UPDATE
      expect(mockPrepare).toHaveBeenCalledTimes(1);
    });

    // 6.2.15 - Returns zero when no cloud registers exist
    it('6.2.15: should return zero when no cloud-sourced registers exist', () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValueOnce({ all: mockAll });

      const result = dal.deactivateStaleCloudRegisters('store-001', new Set(['REG-A']));

      expect(result).toBe(0);
    });

    // 6.2.16 - Store-scoped query (DB-006)
    it('6.2.16: should pass storeId to SELECT query (DB-006 tenant isolation)', () => {
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValueOnce({ all: mockAll });

      dal.deactivateStaleCloudRegisters('store-tenant-xyz', new Set());

      expect(mockAll).toHaveBeenCalledWith('store-tenant-xyz');
    });

    // 6.2.17 - Deactivates multiple stale registers in a single call
    it('6.2.17: should deactivate multiple stale registers when several are absent from cloud', () => {
      const mockAllResults = [
        { id: 'id-1', external_register_id: 'REG-STALE-A' },
        { id: 'id-2', external_register_id: 'REG-CURRENT' },
        { id: 'id-3', external_register_id: 'REG-STALE-B' },
        { id: 'id-4', external_register_id: 'REG-STALE-C' },
        { id: 'id-5', external_register_id: 'REG-ALSO-CURRENT' },
      ];
      const mockAll = vi.fn().mockReturnValue(mockAllResults);
      const mockRun = vi.fn();

      mockPrepare
        .mockReturnValueOnce({ all: mockAll }) // SELECT
        .mockReturnValueOnce({ run: mockRun }) // UPDATE id-1
        .mockReturnValueOnce({ run: mockRun }) // UPDATE id-3
        .mockReturnValueOnce({ run: mockRun }); // UPDATE id-4

      const activeIds = new Set(['REG-CURRENT', 'REG-ALSO-CURRENT']);
      const result = dal.deactivateStaleCloudRegisters('store-001', activeIds);

      expect(result).toBe(3);
      // 1 SELECT + 3 UPDATEs = 4 prepare calls
      expect(mockPrepare).toHaveBeenCalledTimes(4);
      // Verify each deactivated register ID + storeId in UPDATE params
      expect(mockRun).toHaveBeenCalledWith(expect.any(String), 'id-1', 'store-001');
      expect(mockRun).toHaveBeenCalledWith(expect.any(String), 'id-3', 'store-001');
      expect(mockRun).toHaveBeenCalledWith(expect.any(String), 'id-4', 'store-001');
    });

    // 6.2.18 - Empty activeExternalIds deactivates ALL cloud-sourced registers
    it('6.2.18: should deactivate all cloud registers when activeExternalIds is empty', () => {
      const mockAllResults = [
        { id: 'id-1', external_register_id: 'REG-A' },
        { id: 'id-2', external_register_id: 'REG-B' },
      ];
      const mockAll = vi.fn().mockReturnValue(mockAllResults);
      const mockRun = vi.fn();

      mockPrepare
        .mockReturnValueOnce({ all: mockAll })
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ run: mockRun });

      const result = dal.deactivateStaleCloudRegisters('store-001', new Set());

      expect(result).toBe(2);
      expect(mockRun).toHaveBeenCalledTimes(2);
      expect(mockRun).toHaveBeenCalledWith(expect.any(String), 'id-1', 'store-001');
      expect(mockRun).toHaveBeenCalledWith(expect.any(String), 'id-2', 'store-001');
    });

    // 6.2.19 - SQL injection in storeId is safely handled (SEC-006)
    it('6.2.19: should safely handle SQL injection in storeId via parameterized query (SEC-006)', () => {
      const sqlInjectionStoreId = "'; DROP TABLE pos_terminal_mappings;--";
      const mockAll = vi.fn().mockReturnValue([]);
      mockPrepare.mockReturnValueOnce({ all: mockAll });

      dal.deactivateStaleCloudRegisters(sqlInjectionStoreId, new Set(['REG-A']));

      // Assert: storeId is passed as a bound parameter, not interpolated
      const selectQuery = mockPrepare.mock.calls[0][0] as string;
      expect(selectQuery).not.toContain('DROP TABLE');
      expect(selectQuery).toContain('store_id = ?');
      expect(mockAll).toHaveBeenCalledWith(sqlInjectionStoreId);
    });
  });

  // ==========================================================================
  // deactivateById Tests (Phase 5 - Terminal Delete Sync)
  // SEC-006: Parameterized queries
  // DB-006: Tenant isolation via store_id
  // ==========================================================================

  describe('deactivateById', () => {
    // T-DAL-001: Should deactivate existing register and return true
    it('T-DAL-001: should deactivate existing register and return true', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deactivateById('store-tenant-001', 'mapping-uuid-001');

      expect(result).toBe(true);
      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      // SEC-006: Verify parameterized query structure
      expect(updateQuery).toContain('UPDATE pos_terminal_mappings');
      expect(updateQuery).toContain('SET active = 0');
      expect(updateQuery).toContain('updated_at = ?');
      expect(updateQuery).toContain('WHERE id = ? AND store_id = ? AND active = 1');
      // Verify parameters are passed correctly (updated_at, id, store_id)
      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String), // updated_at timestamp
        'mapping-uuid-001', // id
        'store-tenant-001' // store_id
      );
    });

    // T-DAL-002: Should return false when register not found
    it('T-DAL-002: should return false when register not found', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deactivateById('store-tenant-001', 'nonexistent-uuid');

      expect(result).toBe(false);
      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String),
        'nonexistent-uuid',
        'store-tenant-001'
      );
    });

    // T-DAL-003: Should only deactivate for matching store_id (DB-006)
    it('T-DAL-003: should include store_id in WHERE clause for tenant isolation (DB-006)', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.deactivateById('store-tenant-xyz', 'mapping-uuid-001');

      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      // DB-006: Verify store_id is part of the WHERE clause
      expect(updateQuery).toContain('store_id = ?');
      // Verify store_id is passed as parameter
      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String),
        'mapping-uuid-001',
        'store-tenant-xyz'
      );
    });

    // T-DAL-004: Should not affect other stores' registers (tenant isolation)
    it('T-DAL-004: should not affect other stores registers when store_id does not match', () => {
      // Simulate no rows affected when wrong store_id is used
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Register belongs to store-A, but we try with store-B
      const result = dal.deactivateById('store-B', 'mapping-uuid-from-store-A');

      expect(result).toBe(false);
      // Verify the query was still executed with the provided store_id
      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String),
        'mapping-uuid-from-store-A',
        'store-B'
      );
    });

    // T-DAL-005: Should handle already-inactive register gracefully
    it('T-DAL-005: should handle already-inactive register gracefully (idempotent)', () => {
      // active = 1 condition prevents update on inactive records
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deactivateById('store-tenant-001', 'already-inactive-mapping');

      expect(result).toBe(false);
      // Verify query includes active = 1 condition for idempotency
      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      expect(updateQuery).toContain('AND active = 1');
    });

    // T-DAL-006: Should use parameterized query preventing SQL injection (SEC-006)
    it('T-DAL-006: should use parameterized query preventing SQL injection (SEC-006)', () => {
      const sqlInjectionId = "'; DROP TABLE pos_terminal_mappings;--";
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.deactivateById('store-tenant-001', sqlInjectionId);

      // SEC-006: Verify the malicious payload is NOT in the query string
      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      expect(updateQuery).not.toContain('DROP TABLE');
      expect(updateQuery).not.toContain(sqlInjectionId);
      // Verify the payload is passed as a parameter (safely escaped by SQLite)
      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String),
        sqlInjectionId, // passed as parameter, not interpolated
        'store-tenant-001'
      );
    });

    // T-DAL-007: Should set updated_at timestamp on deactivation
    it('T-DAL-007: should set updated_at timestamp on deactivation', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.deactivateById('store-tenant-001', 'mapping-uuid-001');

      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      expect(updateQuery).toContain('updated_at = ?');
      // Verify timestamp is a valid ISO 8601 string
      const timestampParam = mockRun.mock.calls[0][0] as string;
      expect(() => new Date(timestampParam)).not.toThrow();
      expect(new Date(timestampParam).toISOString()).toBe(timestampParam);
    });
  });

  // ==========================================================================
  // deactivateByExternalId Tests (Phase 5 - Terminal Delete Sync)
  // SEC-006: Parameterized queries
  // DB-006: Tenant isolation via store_id
  // ==========================================================================

  describe('deactivateByExternalId', () => {
    // T-DAL-008: Should deactivate cloud-synced register by external ID
    it('T-DAL-008: should deactivate cloud-synced register by external ID', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deactivateByExternalId('store-tenant-001', 'cloud-uuid-001');

      expect(result).toBe(true);
      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      expect(updateQuery).toContain('UPDATE pos_terminal_mappings');
      expect(updateQuery).toContain('SET active = 0');
      expect(updateQuery).toContain('WHERE external_register_id = ?');
      expect(updateQuery).toContain('AND store_id = ?');
      expect(updateQuery).toContain('AND pos_system_type = ?');
      // Verify parameters (updated_at, external_register_id, store_id, pos_system_type)
      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String), // updated_at
        'cloud-uuid-001', // external_register_id
        'store-tenant-001', // store_id
        'generic' // default pos_system_type
      );
    });

    // T-DAL-009: Should filter by pos_system_type when provided
    it('T-DAL-009: should filter by pos_system_type when provided', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.deactivateByExternalId('store-tenant-001', 'REG-001', 'gilbarco');

      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String),
        'REG-001',
        'store-tenant-001',
        'gilbarco' // specified pos_system_type
      );
    });

    // T-DAL-010: Should default to 'generic' pos_system_type
    it('T-DAL-010: should default to generic pos_system_type for cloud registers', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Call without specifying pos_system_type
      dal.deactivateByExternalId('store-tenant-001', 'cloud-uuid-001');

      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String),
        'cloud-uuid-001',
        'store-tenant-001',
        'generic' // default value
      );
    });

    // T-DAL-011: Should return false for non-existent external ID
    it('T-DAL-011: should return false for non-existent external ID', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deactivateByExternalId('store-tenant-001', 'nonexistent-external-id');

      expect(result).toBe(false);
    });

    // T-DAL-012: Should enforce store_id tenant isolation (DB-006)
    it('T-DAL-012: should enforce store_id tenant isolation (DB-006)', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Try to deactivate register with wrong store_id
      const result = dal.deactivateByExternalId('wrong-store-id', 'cloud-uuid-001');

      expect(result).toBe(false);
      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      expect(updateQuery).toContain('AND store_id = ?');
    });

    // T-DAL-013: Should handle SQL injection in externalRegisterId (SEC-006)
    it('T-DAL-013: should safely handle SQL injection in externalRegisterId (SEC-006)', () => {
      const sqlInjectionPayload = "cloud-uuid'; DROP TABLE pos_terminal_mappings;--";
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.deactivateByExternalId('store-tenant-001', sqlInjectionPayload);

      // SEC-006: Verify payload is not in query string
      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      expect(updateQuery).not.toContain('DROP TABLE');
      // Verify payload is passed as parameter
      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String),
        sqlInjectionPayload,
        'store-tenant-001',
        'generic'
      );
    });

    // T-DAL-014: Should handle already-inactive register (idempotent)
    it('T-DAL-014: should handle already-inactive register gracefully (idempotent)', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deactivateByExternalId('store-tenant-001', 'already-inactive-external-id');

      expect(result).toBe(false);
      // Verify query includes active = 1 condition
      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      expect(updateQuery).toContain('AND active = 1');
    });
  });

  describe('Security Tests (SEC-006)', () => {
    // 6.7.1 - SQL injection payload in external_register_id is safely handled
    it('6.7.1: should safely handle SQL injection payload via parameterized query (SEC-006)', () => {
      const sqlInjectionPayload = "'; DROP TABLE pos_terminal_mappings;--";

      const mockGet = vi.fn().mockReturnValue(undefined); // findByExternalId returns nothing
      const mockRun = vi.fn();

      mockPrepare
        .mockReturnValueOnce({ get: mockGet }) // findByExternalId
        .mockReturnValueOnce({ run: mockRun }) // INSERT
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockMapping) }); // findById after create

      dal.getOrCreate('store-sec-001', sqlInjectionPayload, {
        terminalType: 'REGISTER',
        posSystemType: 'generic',
      });

      // Assert: INSERT query uses ? placeholders
      const insertQuery = mockPrepare.mock.calls[1][0] as string;
      expect(insertQuery).toContain('?');
      // Assert: the payload is NOT in the query string
      expect(insertQuery).not.toContain('DROP TABLE');
      // Assert: the payload is passed as a bound parameter
      // INSERT includes new v055 columns: pos_type, connection_type, connection_config
      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String), // id
        'store-sec-001', // store_id
        sqlInjectionPayload, // external_register_id (as parameter, not interpolated)
        'REGISTER', // terminal_type
        null, // description
        'generic', // pos_system_type
        expect.any(String), // created_at
        expect.any(String), // updated_at
        null, // pos_type (v055)
        null, // connection_type (v055)
        null // connection_config (v055)
      );
    });

    // 6.7.2 - Large register array does not cause out-of-memory
    it('6.7.2: should handle large register arrays without crashing', () => {
      const largeArray = Array.from({ length: 10000 }, (_, i) => ({
        external_register_id: `REG-${String(i).padStart(5, '0')}`,
        terminal_type: 'REGISTER' as const,
        description: `Register ${i}`,
        active: true,
      }));

      // Should not throw OOM or crash
      expect(() => {
        const valid = largeArray.every((r) => CloudRegisterSchema.safeParse(r).success);
        expect(valid).toBe(true);
      }).not.toThrow();

      expect(largeArray).toHaveLength(10000);
    });

    // 6.7.3 - Null-byte characters in register data
    it('6.7.3: should handle null-byte characters in external_register_id', () => {
      const nullByteInput = { external_register_id: 'REG\x001' };

      // Should not crash - either accepted or rejected cleanly
      const result = CloudRegisterSchema.safeParse(nullByteInput);

      // Zod string validation should handle this gracefully
      // The key assertion is no crash/exception
      expect(typeof result.success).toBe('boolean');
    });
  });
});
