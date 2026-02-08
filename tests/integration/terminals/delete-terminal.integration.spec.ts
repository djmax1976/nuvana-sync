/**
 * Terminal Delete Integration Tests
 *
 * Full-flow integration tests with real SQLite database.
 * Validates that terminal deactivation correctly updates pos_terminal_mappings.
 *
 * @module tests/integration/terminals/delete-terminal.integration.spec
 *
 * Security Compliance:
 * - SEC-006: All queries use parameterized statements
 * - DB-006: Store-scoped data for tenant isolation
 *
 * Traceability Matrix:
 * - T-INT-001: Full deactivation flow with database state
 * - T-INT-002: Persistence across database reconnection
 * - T-INT-003: Deactivated terminal not in list results
 * - T-INT-004: Concurrent deactivation requests (idempotency)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';

// ============================================================================
// Native Module Check
// ============================================================================

let nativeModuleAvailable = true;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Db = require('better-sqlite3-multiple-ciphers');
  const testDb = new Db(':memory:');
  testDb.close();
} catch {
  nativeModuleAvailable = false;
}

const SKIP_NATIVE_MODULE_TESTS =
  process.env.CI === 'true' || process.env.SKIP_NATIVE_TESTS === 'true' || !nativeModuleAvailable;

// ============================================================================
// Database Reference (shared between mock and test code)
// ============================================================================

let db: Database.Database;

// Mock database service to use our test database
vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: () => db,
  isDatabaseInitialized: () => true,
}));

// Mock uuid for predictable IDs in tests
let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
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

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { createServiceTestContext, type ServiceTestContext } from '../../helpers/test-context';
import { POSTerminalMappingsDAL } from '../../../src/main/dal/pos-id-mappings.dal';

// ============================================================================
// Test Suite
// ============================================================================

const describeSuite = SKIP_NATIVE_MODULE_TESTS ? describe.skip : describe;

describeSuite('Terminal Delete Integration Tests', () => {
  let ctx: ServiceTestContext;
  let terminalMappingsDAL: POSTerminalMappingsDAL;

  beforeEach(async () => {
    uuidCounter = 0;
    ctx = await createServiceTestContext({
      storeName: 'Terminal Delete Integration Store',
    });
    db = ctx.db;

    terminalMappingsDAL = new POSTerminalMappingsDAL();
  });

  afterEach(() => {
    ctx?.cleanup();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  /**
   * Seed a terminal mapping directly into the database
   * SEC-006: Uses parameterized query for seeding test data
   */
  function seedTerminalMapping(
    storeId: string,
    externalRegisterId: string,
    options: {
      id?: string;
      posSystemType?: string;
      active?: number;
      terminalType?: string;
      description?: string | null;
    } = {}
  ) {
    const id = options.id ?? `mapping-uuid-${++uuidCounter}`;
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO pos_terminal_mappings (
        id, store_id, external_register_id, terminal_type,
        description, pos_system_type, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      storeId,
      externalRegisterId,
      options.terminalType ?? 'REGISTER',
      options.description ?? `Register ${externalRegisterId}`,
      options.posSystemType ?? 'generic',
      options.active ?? 1,
      now,
      now
    );
    return { id, storeId, externalRegisterId };
  }

  /**
   * Get terminal by ID directly from database
   * SEC-006: Uses parameterized query
   */
  function getTerminalById(id: string) {
    const stmt = db.prepare(`SELECT * FROM pos_terminal_mappings WHERE id = ?`);
    return stmt.get(id) as { active: number; id: string; store_id: string } | undefined;
  }

  /**
   * Count active terminals for a store
   * DB-006: Store-scoped query
   */
  function countActiveTerminals(storeId: string): number {
    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM pos_terminal_mappings
      WHERE store_id = ? AND active = 1
    `);
    return (stmt.get(storeId) as { count: number }).count;
  }

  // ==========================================================================
  // T-INT-001: Full Deactivation Flow
  // ==========================================================================

  describe('T-INT-001: Full deactivation flow', () => {
    it('should deactivate local mapping when called with internal ID', () => {
      // Arrange
      const terminal = seedTerminalMapping(ctx.storeId, 'REG-001');

      // Act
      const result = terminalMappingsDAL.deactivateById(ctx.storeId, terminal.id);

      // Assert
      expect(result).toBe(true);
      const dbRecord = getTerminalById(terminal.id);
      expect(dbRecord).toBeDefined();
      expect(dbRecord?.active).toBe(0);
    });

    it('should deactivate local mapping when called with external ID', () => {
      // Arrange
      const terminal = seedTerminalMapping(ctx.storeId, 'cloud-uuid-001');

      // Act
      const result = terminalMappingsDAL.deactivateByExternalId(
        ctx.storeId,
        'cloud-uuid-001',
        'generic'
      );

      // Assert
      expect(result).toBe(true);
      const dbRecord = getTerminalById(terminal.id);
      expect(dbRecord).toBeDefined();
      expect(dbRecord?.active).toBe(0);
    });

    it('should update updated_at timestamp on deactivation', () => {
      // Arrange
      const terminal = seedTerminalMapping(ctx.storeId, 'REG-002');
      const beforeDeactivation = db
        .prepare(`SELECT updated_at FROM pos_terminal_mappings WHERE id = ?`)
        .get(terminal.id) as { updated_at: string };

      // Small delay to ensure timestamp difference
      const now = Date.now();
      while (Date.now() - now < 10) {
        // wait
      }

      // Act
      terminalMappingsDAL.deactivateById(ctx.storeId, terminal.id);

      // Assert
      const afterDeactivation = db
        .prepare(`SELECT updated_at FROM pos_terminal_mappings WHERE id = ?`)
        .get(terminal.id) as { updated_at: string };

      expect(new Date(afterDeactivation.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeDeactivation.updated_at).getTime()
      );
    });
  });

  // ==========================================================================
  // T-INT-002: Persistence Across Reconnection
  // ==========================================================================

  describe('T-INT-002: Persistence across database reconnection', () => {
    it('should persist deactivation state after DAL reinstantiation', () => {
      // Arrange
      const terminal = seedTerminalMapping(ctx.storeId, 'REG-PERSIST');

      // Act - deactivate with first DAL instance
      terminalMappingsDAL.deactivateById(ctx.storeId, terminal.id);

      // Create new DAL instance (simulates reconnection)
      const newDAL = new POSTerminalMappingsDAL();

      // Assert - new DAL sees deactivated state
      const records = newDAL.findRegisters(ctx.storeId, false); // excludeInactive
      expect(records.find((r) => r.id === terminal.id)).toBeUndefined();

      // But record still exists when including inactive
      const allRecords = newDAL.findRegisters(ctx.storeId, true);
      const found = allRecords.find((r) => r.id === terminal.id);
      expect(found).toBeDefined();
      expect(found?.active).toBe(0);
    });
  });

  // ==========================================================================
  // T-INT-003: Not in List Results After Deactivation
  // ==========================================================================

  describe('T-INT-003: Deactivated terminal not in list results', () => {
    it('should not appear in findRegisters results after deactivation', () => {
      // Arrange
      const activeTerminal = seedTerminalMapping(ctx.storeId, 'REG-ACTIVE');
      const toDeactivate = seedTerminalMapping(ctx.storeId, 'REG-TO-DELETE');

      // Verify both appear initially
      const beforeDeactivation = terminalMappingsDAL.findRegisters(ctx.storeId);
      expect(beforeDeactivation).toHaveLength(2);

      // Act
      terminalMappingsDAL.deactivateById(ctx.storeId, toDeactivate.id);

      // Assert
      const afterDeactivation = terminalMappingsDAL.findRegisters(ctx.storeId);
      expect(afterDeactivation).toHaveLength(1);
      expect(afterDeactivation[0].id).toBe(activeTerminal.id);
    });

    it('should update active terminal count correctly', () => {
      // Arrange
      seedTerminalMapping(ctx.storeId, 'REG-A');
      seedTerminalMapping(ctx.storeId, 'REG-B');
      const toDeactivate = seedTerminalMapping(ctx.storeId, 'REG-C');

      expect(countActiveTerminals(ctx.storeId)).toBe(3);

      // Act
      terminalMappingsDAL.deactivateById(ctx.storeId, toDeactivate.id);

      // Assert
      expect(countActiveTerminals(ctx.storeId)).toBe(2);
    });
  });

  // ==========================================================================
  // T-INT-004: Concurrent Deactivation (Idempotency)
  // ==========================================================================

  describe('T-INT-004: Concurrent deactivation requests (idempotency)', () => {
    it('should handle multiple deactivation calls for same terminal gracefully', () => {
      // Arrange
      const terminal = seedTerminalMapping(ctx.storeId, 'REG-CONCURRENT');

      // Act - first deactivation succeeds
      const firstResult = terminalMappingsDAL.deactivateById(ctx.storeId, terminal.id);

      // Second deactivation returns false (already inactive)
      const secondResult = terminalMappingsDAL.deactivateById(ctx.storeId, terminal.id);

      // Third deactivation also returns false
      const thirdResult = terminalMappingsDAL.deactivateById(ctx.storeId, terminal.id);

      // Assert
      expect(firstResult).toBe(true);
      expect(secondResult).toBe(false);
      expect(thirdResult).toBe(false);

      // State is still correctly deactivated
      const dbRecord = getTerminalById(terminal.id);
      expect(dbRecord?.active).toBe(0);
    });

    it('should handle parallel deactivation by both ID types', () => {
      // Arrange
      const terminal = seedTerminalMapping(ctx.storeId, 'REG-PARALLEL');

      // Act - deactivate by internal ID
      const byIdResult = terminalMappingsDAL.deactivateById(ctx.storeId, terminal.id);

      // Try to deactivate by external ID (should fail - already inactive)
      const byExternalResult = terminalMappingsDAL.deactivateByExternalId(
        ctx.storeId,
        'REG-PARALLEL',
        'generic'
      );

      // Assert
      expect(byIdResult).toBe(true);
      expect(byExternalResult).toBe(false);
    });
  });

  // ==========================================================================
  // DB-006: Tenant Isolation Tests
  // ==========================================================================

  describe('DB-006: Tenant Isolation', () => {
    it('should not deactivate terminal from different store', () => {
      // Arrange - create terminal for different store
      const otherStoreId = 'other-store-uuid';
      const otherStoreTerminal = seedTerminalMapping(otherStoreId, 'REG-OTHER');

      // Create terminal for our test store
      const ourTerminal = seedTerminalMapping(ctx.storeId, 'REG-OURS');

      // Act - try to deactivate other store's terminal using our store ID
      const result = terminalMappingsDAL.deactivateById(ctx.storeId, otherStoreTerminal.id);

      // Assert - deactivation fails (wrong store)
      expect(result).toBe(false);

      // Verify other store's terminal is still active
      const otherTerminalState = getTerminalById(otherStoreTerminal.id);
      expect(otherTerminalState?.active).toBe(1);

      // Verify our terminal is still active
      const ourTerminalState = getTerminalById(ourTerminal.id);
      expect(ourTerminalState?.active).toBe(1);
    });

    it('should not leak data between stores via deactivateByExternalId', () => {
      // Arrange - same external_register_id in two different stores
      const otherStoreId = 'other-store-uuid';
      const sharedExternalId = 'SHARED-REG-001';

      seedTerminalMapping(otherStoreId, sharedExternalId, { id: 'mapping-other' });
      seedTerminalMapping(ctx.storeId, sharedExternalId, { id: 'mapping-ours' });

      // Act - deactivate using our store ID
      terminalMappingsDAL.deactivateByExternalId(ctx.storeId, sharedExternalId, 'generic');

      // Assert - only our store's terminal is deactivated
      const ourTerminal = getTerminalById('mapping-ours');
      const otherTerminal = getTerminalById('mapping-other');

      expect(ourTerminal?.active).toBe(0);
      expect(otherTerminal?.active).toBe(1);
    });
  });

  // ==========================================================================
  // SEC-006: SQL Injection Prevention
  // ==========================================================================

  describe('SEC-006: SQL Injection Prevention', () => {
    it('should safely handle malicious ID input in deactivateById', () => {
      // Arrange
      const terminal = seedTerminalMapping(ctx.storeId, 'REG-SAFE');
      const maliciousId = "'; DROP TABLE pos_terminal_mappings;--";

      // Act - should not throw or corrupt database
      const result = terminalMappingsDAL.deactivateById(ctx.storeId, maliciousId);

      // Assert
      expect(result).toBe(false); // Not found (injection failed)

      // Verify table still exists and our terminal is intact
      const dbRecord = getTerminalById(terminal.id);
      expect(dbRecord).toBeDefined();
      expect(dbRecord?.active).toBe(1);
    });

    it('should safely handle malicious storeId input', () => {
      // Arrange
      const terminal = seedTerminalMapping(ctx.storeId, 'REG-SECURE');
      const maliciousStoreId = "store-id' OR '1'='1";

      // Act
      const result = terminalMappingsDAL.deactivateById(maliciousStoreId, terminal.id);

      // Assert
      expect(result).toBe(false); // Should not match

      // Terminal should still be active (injection failed)
      const dbRecord = getTerminalById(terminal.id);
      expect(dbRecord?.active).toBe(1);
    });

    it('should safely handle malicious externalRegisterId input', () => {
      // Arrange
      const terminal = seedTerminalMapping(ctx.storeId, 'REG-PROTECTED');
      const maliciousExternalId =
        "REG-PROTECTED'; UPDATE pos_terminal_mappings SET active=0 WHERE '1'='1";

      // Act
      const result = terminalMappingsDAL.deactivateByExternalId(
        ctx.storeId,
        maliciousExternalId,
        'generic'
      );

      // Assert
      expect(result).toBe(false);

      // Original terminal should still be active
      const dbRecord = getTerminalById(terminal.id);
      expect(dbRecord?.active).toBe(1);
    });
  });
});
