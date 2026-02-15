/**
 * POS Terminal Mappings DAL Security Tests
 *
 * Dedicated security test suite for terminal deactivation methods.
 * Validates SEC-006 (SQL injection prevention) and DB-006 (tenant isolation).
 *
 * @module tests/unit/dal/pos-terminal-mappings.dal.security
 *
 * Security Compliance:
 * - SEC-006: SQL injection prevention via parameterized queries
 * - DB-006: Tenant isolation via store_id scoping
 *
 * Traceability Matrix:
 * - T-SEC-001: SQL injection prevention in terminalId
 * - T-SEC-002: SQL injection prevention in storeId
 * - T-SEC-003: SQL injection prevention in externalRegisterId
 * - T-SEC-004: Cross-tenant access prevention (deactivateById)
 * - T-SEC-005: Cross-tenant access prevention (deactivateByExternalId)
 * - T-SEC-006: Return false for cross-tenant attempt (not error)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// ==========================================================================
// Mock Setup
// Use vi.hoisted() to ensure mock functions are available when vi.mock runs
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
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
  v4: vi.fn().mockReturnValue('mock-uuid-security-test'),
}));

vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { POSTerminalMappingsDAL } from '../../../src/main/dal/pos-id-mappings.dal';

// ==========================================================================
// Test Suite
// ==========================================================================

describe('POSTerminalMappingsDAL Security Tests', () => {
  let dal: POSTerminalMappingsDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new POSTerminalMappingsDAL();
  });

  // ==========================================================================
  // SEC-006: SQL Injection Prevention
  // ==========================================================================

  describe('SQL Injection Prevention (SEC-006)', () => {
    // T-SEC-001: SQL injection in terminalId (deactivateById)
    describe('T-SEC-001: SQL injection in terminalId', () => {
      const sqlInjectionPayloads = [
        "'; DROP TABLE pos_terminal_mappings;--",
        '1; DELETE FROM pos_terminal_mappings WHERE 1=1;--',
        "' OR '1'='1",
        '1 UNION SELECT * FROM stores--',
        "'; UPDATE pos_terminal_mappings SET active=0 WHERE '1'='1",
        "1'; ATTACH DATABASE '/tmp/pwned.db' AS pwned;--",
        '1"; DROP TABLE users;--',
        "1' AND (SELECT COUNT(*) FROM pos_terminal_mappings) > 0--",
        '1/**/OR/**/1=1',
        '1%27%20OR%201=1--', // URL encoded
        "1' WAITFOR DELAY '0:0:5'--", // Time-based SQLi
        "1' AND 1=(SELECT 1 FROM(SELECT COUNT(*),CONCAT((SELECT table_name FROM information_schema.tables LIMIT 0,1),FLOOR(RAND(0)*2))x FROM information_schema.tables GROUP BY x)a)--",
      ];

      it.each(sqlInjectionPayloads)('should safely handle SQL injection payload: %s', (payload) => {
        const mockRun = vi.fn().mockReturnValue({ changes: 0 });
        mockPrepare.mockReturnValue({ run: mockRun });

        // Act
        dal.deactivateById('store-id', payload);

        // Assert: payload is NOT in query string (used as parameter)
        const query = mockPrepare.mock.calls[0][0] as string;
        expect(query).not.toContain('DROP');
        expect(query).not.toContain('DELETE');
        expect(query).not.toContain('UNION');
        expect(query).not.toContain('ATTACH');

        // Assert: payload is passed as bound parameter
        expect(mockRun).toHaveBeenCalledWith(
          expect.any(String), // updated_at
          payload, // id - safely passed as parameter
          'store-id' // store_id
        );
      });
    });

    // T-SEC-002: SQL injection in storeId
    describe('T-SEC-002: SQL injection in storeId', () => {
      const storeIdInjectionPayloads = [
        "store-id' OR '1'='1",
        "'; DROP TABLE stores;--",
        "store' AND (SELECT 1)=1--",
        "store' UNION SELECT password FROM users--",
      ];

      it.each(storeIdInjectionPayloads)(
        'should safely handle SQL injection in storeId: %s',
        (payload) => {
          const mockRun = vi.fn().mockReturnValue({ changes: 0 });
          mockPrepare.mockReturnValue({ run: mockRun });

          // Act
          dal.deactivateById(payload, 'valid-terminal-id');

          // Assert: storeId is passed as parameter, not interpolated
          expect(mockRun).toHaveBeenCalledWith(
            expect.any(String), // updated_at
            'valid-terminal-id', // id
            payload // storeId - safely passed as parameter
          );

          const query = mockPrepare.mock.calls[0][0] as string;
          expect(query).not.toContain(payload);
          expect(query).toContain('store_id = ?');
        }
      );
    });

    // T-SEC-003: SQL injection in externalRegisterId
    describe('T-SEC-003: SQL injection in externalRegisterId', () => {
      const externalIdInjectionPayloads = [
        "REG-001'; DROP TABLE pos_terminal_mappings;--",
        "cloud-uuid' OR 1=1--",
        "external' UNION SELECT api_key FROM settings--",
      ];

      it.each(externalIdInjectionPayloads)(
        'should safely handle SQL injection in externalRegisterId: %s',
        (payload) => {
          const mockRun = vi.fn().mockReturnValue({ changes: 0 });
          mockPrepare.mockReturnValue({ run: mockRun });

          // Act
          dal.deactivateByExternalId('store-id', payload, 'generic');

          // Assert: externalRegisterId is passed as parameter
          expect(mockRun).toHaveBeenCalledWith(
            expect.any(String), // updated_at
            payload, // externalRegisterId - safely passed as parameter
            'store-id', // storeId
            'generic' // posSystemType
          );

          const query = mockPrepare.mock.calls[0][0] as string;
          expect(query).not.toContain(payload);
          expect(query).toContain('external_register_id = ?');
        }
      );
    });

    // Verify query structure uses ONLY placeholders
    it('should use only placeholder tokens in deactivateById query', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.deactivateById('store-123', 'terminal-456');

      const query = mockPrepare.mock.calls[0][0] as string;

      // Count placeholder usage
      const placeholderCount = (query.match(/\?/g) || []).length;
      expect(placeholderCount).toBe(3); // updated_at, id, store_id

      // Ensure no direct value interpolation
      expect(query).not.toContain('store-123');
      expect(query).not.toContain('terminal-456');
    });

    it('should use only placeholder tokens in deactivateByExternalId query', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.deactivateByExternalId('store-123', 'external-456', 'gilbarco');

      const query = mockPrepare.mock.calls[0][0] as string;

      // Count placeholder usage
      const placeholderCount = (query.match(/\?/g) || []).length;
      expect(placeholderCount).toBe(4); // updated_at, external_register_id, store_id, pos_system_type

      // Ensure no direct value interpolation
      expect(query).not.toContain('store-123');
      expect(query).not.toContain('external-456');
      expect(query).not.toContain('gilbarco');
    });
  });

  // ==========================================================================
  // DB-006: Tenant Isolation
  // ==========================================================================

  describe('Tenant Isolation (DB-006)', () => {
    // T-SEC-004: Cross-tenant access prevention (deactivateById)
    it('T-SEC-004: should never deactivate register from different store via deactivateById', () => {
      // Simulate: terminal exists but belongs to different store
      // Query returns changes: 0 because store_id doesn't match
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Act: attacker tries to deactivate with their store ID
      const result = dal.deactivateById('attacker-store', 'target-terminal-id');

      // Assert: deactivation fails silently (no unauthorized action)
      expect(result).toBe(false);

      // Verify query includes store_id in WHERE clause
      const query = mockPrepare.mock.calls[0][0] as string;
      expect(query).toContain('WHERE id = ? AND store_id = ?');
    });

    // T-SEC-005: Cross-tenant access prevention (deactivateByExternalId)
    it('T-SEC-005: should never deactivate register from different store via deactivateByExternalId', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Act: attacker tries to deactivate by external ID with wrong store
      const result = dal.deactivateByExternalId('attacker-store', 'target-external-id', 'generic');

      // Assert: deactivation fails silently
      expect(result).toBe(false);

      // Verify query includes store_id in WHERE clause
      const query = mockPrepare.mock.calls[0][0] as string;
      expect(query).toContain('AND store_id = ?');
    });

    // T-SEC-006: Return false for cross-tenant attempt (not error)
    it('T-SEC-006: should return false for cross-tenant attempt (not throw error)', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Should not throw - returns false instead
      expect(() => {
        const result = dal.deactivateById('wrong-store', 'valid-terminal');
        expect(result).toBe(false);
      }).not.toThrow();

      expect(() => {
        const result = dal.deactivateByExternalId('wrong-store', 'valid-external', 'generic');
        expect(result).toBe(false);
      }).not.toThrow();
    });

    // Verify store_id is always part of the WHERE clause
    it('should always include store_id in WHERE clause for deactivateById', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.deactivateById('tenant-store', 'terminal-id');

      const query = mockPrepare.mock.calls[0][0] as string;
      expect(query).toMatch(/WHERE\s+.*store_id\s*=\s*\?/i);
    });

    it('should always include store_id in WHERE clause for deactivateByExternalId', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.deactivateByExternalId('tenant-store', 'external-id', 'generic');

      const query = mockPrepare.mock.calls[0][0] as string;
      expect(query).toMatch(/WHERE\s+.*store_id\s*=\s*\?/i);
    });
  });

  // ==========================================================================
  // Input Validation Tests (complementing Zod at IPC layer)
  // ==========================================================================

  describe('Input Type Safety', () => {
    it('should handle empty string storeId without crashing', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Should not throw
      expect(() => dal.deactivateById('', 'terminal-id')).not.toThrow();
      expect(() => dal.deactivateByExternalId('', 'external-id', 'generic')).not.toThrow();
    });

    it('should handle empty string terminalId without crashing', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      expect(() => dal.deactivateById('store-id', '')).not.toThrow();
    });

    it('should handle unicode characters in IDs', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      // Unicode in terminal ID
      expect(() => dal.deactivateById('store-id', 'terminal-日本語-🔥')).not.toThrow();

      // Verify it's passed as parameter
      expect(mockRun).toHaveBeenCalledWith(expect.any(String), 'terminal-日本語-🔥', 'store-id');
    });

    it('should handle very long ID strings', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const longId = 'a'.repeat(10000);

      expect(() => dal.deactivateById('store-id', longId)).not.toThrow();
      expect(mockRun).toHaveBeenCalledWith(expect.any(String), longId, 'store-id');
    });

    it('should handle null-byte characters in ID', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 0 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const nullByteId = 'terminal\x00id';

      expect(() => dal.deactivateById('store-id', nullByteId)).not.toThrow();
    });
  });

  // ==========================================================================
  // Schema Validation Tests (for IPC layer Zod schemas)
  // ==========================================================================

  describe('Zod Schema Validation (SEC-014)', () => {
    // Replicate the schema from terminals.handlers.ts
    const DeactivateTerminalSchema = z.object({
      terminalId: z.string().uuid('Terminal ID must be a valid UUID'),
    });

    it('should accept valid UUID format', () => {
      const validInput = { terminalId: '550e8400-e29b-41d4-a716-446655440000' };
      const result = DeactivateTerminalSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject non-UUID format', () => {
      const invalidInput = { terminalId: 'not-a-uuid' };
      const result = DeactivateTerminalSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it('should reject SQL injection payloads at schema level', () => {
      const sqlInjection = { terminalId: "'; DROP TABLE users;--" };
      const result = DeactivateTerminalSchema.safeParse(sqlInjection);
      expect(result.success).toBe(false);
    });

    it('should reject missing terminalId', () => {
      const result = DeactivateTerminalSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject null terminalId', () => {
      const result = DeactivateTerminalSchema.safeParse({ terminalId: null });
      expect(result.success).toBe(false);
    });

    it('should reject number terminalId', () => {
      const result = DeactivateTerminalSchema.safeParse({ terminalId: 12345 });
      expect(result.success).toBe(false);
    });
  });
});
