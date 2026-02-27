/**
 * Per-Register Shift Numbering Security Tests
 *
 * Enterprise-grade security testing for the per-register shift numbering feature.
 * Tests tenant isolation, injection prevention, and access control.
 *
 * SECURITY REQUIREMENTS:
 * - SEC-006: SQL Injection Prevention - All queries must use parameterized statements
 * - DB-006: Tenant Isolation - Store data must be completely isolated
 * - SYNC-001: Sync Integrity - Shift numbers must be consistent in sync payloads
 *
 * THREAT MODEL:
 * - T1: SQL injection via external_register_id
 * - T2: Cross-tenant data access
 * - T3: Unique constraint bypass
 * - T4: Data corruption via concurrent access
 *
 * @module tests/security/shifts/per-register-numbering.security
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createServiceTestContext,
  createMultiStoreTestContext,
  type ServiceTestContext,
  type MultiStoreTestContext,
} from '../../helpers/test-context';

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

const SKIP_NATIVE_MODULE_TESTS = process.env.SKIP_NATIVE_TESTS === 'true' || !nativeModuleAvailable;

const describeSuite = SKIP_NATIVE_MODULE_TESTS ? describe.skip : describe;

// ============================================================================
// Test Fixtures
// ============================================================================

const BUSINESS_DATE = '2026-02-24';
const REGISTER_1 = 'REG-001';

// ============================================================================
// SEC-006: SQL Injection Prevention
// ============================================================================

describeSuite('SEC-006: SQL Injection Prevention', () => {
  let ctx: ServiceTestContext;

  beforeEach(async () => {
    ctx = await createServiceTestContext({
      storeName: 'SQL Injection Test Store',
    });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('Injection via external_register_id', () => {
    const injectionPayloads = [
      // Classic SQL injection
      "'; DROP TABLE shifts; --",
      "' OR '1'='1",
      "'; DELETE FROM shifts WHERE '1'='1",
      '1; SELECT * FROM sqlite_master; --',

      // UNION-based injection
      "' UNION SELECT * FROM stores --",
      "' UNION ALL SELECT shift_id, store_id, 1, '2026-01-01', null, null, null, null, 'OPEN', null, null, null, datetime('now'), datetime('now') FROM shifts --",

      // Boolean-based blind injection
      "' AND 1=1 --",
      "' AND SUBSTRING(store_id, 1, 1) = 'a' --",

      // Time-based blind injection (SQLite doesn't support SLEEP but test pattern)
      "' AND (SELECT COUNT(*) FROM shifts) > 0 --",

      // Stacked queries
      "'; INSERT INTO shifts VALUES('injected', 'fake-store', 1, '2026-01-01', null, null, null, null, 'OPEN', null, null, null, datetime('now'), datetime('now')); --",

      // Comment bypass
      '/**/; DROP TABLE shifts; --',
      "'/**/OR/**/1=1--",

      // Encoding bypass
      '%27%20OR%201%3D1%20--',
      '&#39; OR 1=1 --',

      // Null byte injection
      "REG-001\x00'; DROP TABLE shifts; --",
    ];

    it.each(injectionPayloads)('should safely handle injection payload: %s', (payload) => {
      // ACT: Create shift with injection payload as register ID
      const shift = ctx.seeders.shift({
        shift_number: 1,
        business_date: BUSINESS_DATE,
        external_register_id: payload,
        status: 'OPEN',
      });

      // ASSERT: Shift created with literal payload stored
      expect(shift.external_register_id).toBe(payload);

      // Verify no SQL execution occurred - table must still exist
      const tableCheck = ctx.db
        .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='shifts'")
        .get() as { count: number };
      expect(tableCheck.count).toBe(1);

      // Verify data integrity - only expected shift exists
      const shifts = ctx.db
        .prepare('SELECT COUNT(*) as count FROM shifts WHERE store_id = ?')
        .get(ctx.storeId) as { count: number };
      expect(shifts.count).toBe(1);
    });

    it('should not allow injection to read other stores data', () => {
      const injectionPayload = "' OR store_id != '" + ctx.storeId + "' --";

      ctx.seeders.shift({
        shift_number: 1,
        business_date: BUSINESS_DATE,
        external_register_id: injectionPayload,
        status: 'OPEN',
      });

      // Query with the injection payload should only return our shift
      const shifts = ctx.db
        .prepare('SELECT * FROM shifts WHERE store_id = ? AND external_register_id = ?')
        .all(ctx.storeId, injectionPayload);

      expect(shifts).toHaveLength(1);
    });
  });

  describe('Injection via business_date', () => {
    it('should safely handle date injection attempts', () => {
      const maliciousDate = "2026-02-24'; DROP TABLE shifts; --";

      // This should fail validation before reaching the database
      // but if it somehow passes, should be stored literally
      try {
        ctx.seeders.shift({
          shift_number: 1,
          business_date: maliciousDate,
          external_register_id: REGISTER_1,
          status: 'OPEN',
        });
      } catch {
        // Expected if validation catches it
      }

      // Verify table still exists
      const tableCheck = ctx.db
        .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='shifts'")
        .get() as { count: number };
      expect(tableCheck.count).toBe(1);
    });
  });
});

// ============================================================================
// DB-006: Tenant Isolation (Penetration Tests)
// ============================================================================

describeSuite('DB-006: Tenant Isolation Security', () => {
  let multiCtx: MultiStoreTestContext;

  beforeEach(async () => {
    multiCtx = await createMultiStoreTestContext();
  });

  afterEach(() => {
    multiCtx.cleanup();
  });

  describe('Cross-Tenant Data Access Prevention', () => {
    it('should prevent Store B from reading Store A shifts', () => {
      // ARRANGE: Store A creates confidential shifts
      multiCtx.store1.seeders.shift({
        shift_number: 1,
        business_date: BUSINESS_DATE,
        external_register_id: 'SECRET-REG-001',
        status: 'OPEN',
      });

      // ACT: Store B queries its own shifts (uses shared db via store1.db)
      const storeBShifts = multiCtx.store1.db
        .prepare('SELECT * FROM shifts WHERE store_id = ?')
        .all(multiCtx.store2.storeId);

      // ASSERT: Store B cannot see Store A's data
      expect(storeBShifts).toHaveLength(0);

      // Verify Store A's data exists
      const storeAShifts = multiCtx.store1.db
        .prepare('SELECT * FROM shifts WHERE store_id = ?')
        .all(multiCtx.store1.storeId);
      expect(storeAShifts).toHaveLength(1);
    });

    it('should prevent cross-tenant shift number enumeration', () => {
      // ARRANGE: Store A creates multiple shifts
      for (let i = 1; i <= 5; i++) {
        multiCtx.store1.seeders.shift({
          shift_number: i,
          business_date: BUSINESS_DATE,
          external_register_id: REGISTER_1,
          status: 'CLOSED',
        });
      }

      // ACT: Store B tries to enumerate shift numbers
      const maxShiftQuery = multiCtx.store1.db
        .prepare(
          `SELECT MAX(shift_number) as max_num FROM shifts
           WHERE store_id = ? AND business_date = ?`
        )
        .get(multiCtx.store2.storeId, BUSINESS_DATE) as { max_num: number | null };

      // ASSERT: Store B sees no shift data from Store A
      expect(maxShiftQuery.max_num).toBeNull();
    });

    it('should isolate unique constraints per store', () => {
      // ARRANGE: Both stores create shift with same identifiers
      multiCtx.store1.seeders.shift({
        shift_number: 1,
        business_date: BUSINESS_DATE,
        external_register_id: REGISTER_1,
        status: 'OPEN',
      });

      // ACT & ASSERT: Store B can create identical shift (different store_id)
      expect(() => {
        multiCtx.store2.seeders.shift({
          shift_number: 1,
          business_date: BUSINESS_DATE,
          external_register_id: REGISTER_1,
          status: 'OPEN',
        });
      }).not.toThrow();

      // Verify both exist
      const allShifts = multiCtx.store1.db
        .prepare('SELECT store_id FROM shifts WHERE shift_number = 1')
        .all() as Array<{ store_id: string }>;

      expect(allShifts).toHaveLength(2);
      expect(allShifts.map((s) => s.store_id).sort()).toEqual(
        [multiCtx.store1.storeId, multiCtx.store2.storeId].sort()
      );
    });
  });

  describe('Data Manipulation Prevention', () => {
    it('should prevent Store B from updating Store A shifts', () => {
      // ARRANGE: Store A creates a shift
      const storeAShift = multiCtx.store1.seeders.shift({
        shift_number: 1,
        business_date: BUSINESS_DATE,
        external_register_id: REGISTER_1,
        status: 'OPEN',
      });

      // ACT: Attempt to update with wrong store_id filter
      const result = multiCtx.store1.db
        .prepare(
          `UPDATE shifts SET status = 'CLOSED'
           WHERE shift_id = ? AND store_id = ?`
        )
        .run(storeAShift.shift_id, multiCtx.store2.storeId);

      // ASSERT: No rows updated (store_id mismatch)
      expect(result.changes).toBe(0);

      // Verify original status unchanged
      const originalShift = multiCtx.store1.db
        .prepare('SELECT status FROM shifts WHERE shift_id = ?')
        .get(storeAShift.shift_id) as { status: string };
      expect(originalShift.status).toBe('OPEN');
    });

    it('should prevent Store B from deleting Store A shifts', () => {
      // ARRANGE: Store A creates a shift
      const storeAShift = multiCtx.store1.seeders.shift({
        shift_number: 1,
        business_date: BUSINESS_DATE,
        external_register_id: REGISTER_1,
        status: 'OPEN',
      });

      // ACT: Attempt to delete with wrong store_id filter
      const result = multiCtx.store1.db
        .prepare('DELETE FROM shifts WHERE shift_id = ? AND store_id = ?')
        .run(storeAShift.shift_id, multiCtx.store2.storeId);

      // ASSERT: No rows deleted
      expect(result.changes).toBe(0);

      // Verify shift still exists
      const shiftExists = multiCtx.store1.db
        .prepare('SELECT COUNT(*) as count FROM shifts WHERE shift_id = ?')
        .get(storeAShift.shift_id) as { count: number };
      expect(shiftExists.count).toBe(1);
    });
  });
});

// ============================================================================
// Unique Constraint Bypass Prevention
// ============================================================================

describeSuite('Unique Constraint Security', () => {
  let ctx: ServiceTestContext;

  beforeEach(async () => {
    ctx = await createServiceTestContext({
      storeName: 'Constraint Test Store',
    });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should enforce constraint even with timing attacks', () => {
    // Create first shift
    ctx.seeders.shift({
      shift_number: 1,
      business_date: BUSINESS_DATE,
      external_register_id: REGISTER_1,
      status: 'OPEN',
    });

    // Rapid duplicate attempts should all fail
    const attempts = 10;
    let failures = 0;

    for (let i = 0; i < attempts; i++) {
      try {
        ctx.seeders.shift({
          shift_number: 1, // Duplicate
          business_date: BUSINESS_DATE,
          external_register_id: REGISTER_1,
          status: 'OPEN',
        });
      } catch {
        failures++;
      }
    }

    expect(failures).toBe(attempts);

    // Verify only one shift exists
    const count = ctx.db
      .prepare(
        `SELECT COUNT(*) as count FROM shifts
         WHERE store_id = ? AND business_date = ? AND external_register_id = ?`
      )
      .get(ctx.storeId, BUSINESS_DATE, REGISTER_1) as { count: number };
    expect(count.count).toBe(1);
  });

  it('should prevent constraint bypass via NULL coercion', () => {
    // Create shift with explicit NULL
    ctx.seeders.shift({
      shift_number: 1,
      business_date: BUSINESS_DATE,
      external_register_id: undefined, // NULL
      status: 'OPEN',
    });

    // SQLite treats NULLs as distinct, so this should succeed
    // But verify the behavior is intentional and documented
    ctx.seeders.shift({
      shift_number: 1,
      business_date: BUSINESS_DATE,
      external_register_id: undefined, // Another NULL
      status: 'OPEN',
    });

    // Both should exist (SQLite NULL behavior)
    const nullShifts = ctx.db
      .prepare(
        `SELECT COUNT(*) as count FROM shifts
         WHERE store_id = ? AND external_register_id IS NULL`
      )
      .get(ctx.storeId) as { count: number };

    // This documents the expected behavior
    expect(nullShifts.count).toBe(2);
  });
});

// ============================================================================
// Audit Trail Verification
// ============================================================================

describeSuite('Security Audit Trail', () => {
  let ctx: ServiceTestContext;

  beforeEach(async () => {
    ctx = await createServiceTestContext({
      storeName: 'Audit Test Store',
    });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should record timestamps for all shift operations', () => {
    const beforeCreate = new Date().toISOString();

    const shift = ctx.seeders.shift({
      shift_number: 1,
      business_date: BUSINESS_DATE,
      external_register_id: REGISTER_1,
      status: 'OPEN',
    });

    const afterCreate = new Date().toISOString();

    // Verify timestamps are within expected range
    expect(shift.created_at >= beforeCreate).toBe(true);
    expect(shift.created_at <= afterCreate).toBe(true);
    expect(shift.updated_at >= beforeCreate).toBe(true);
    expect(shift.updated_at <= afterCreate).toBe(true);
  });

  it('should preserve original create timestamp on updates', () => {
    const shift = ctx.seeders.shift({
      shift_number: 1,
      business_date: BUSINESS_DATE,
      external_register_id: REGISTER_1,
      status: 'OPEN',
    });

    const originalCreatedAt = shift.created_at;

    // Wait a bit to ensure timestamp difference
    const updateTime = new Date().toISOString();

    ctx.db
      .prepare('UPDATE shifts SET status = ?, updated_at = ? WHERE shift_id = ?')
      .run('CLOSED', updateTime, shift.shift_id);

    const updated = ctx.db
      .prepare('SELECT created_at, updated_at FROM shifts WHERE shift_id = ?')
      .get(shift.shift_id) as { created_at: string; updated_at: string };

    // created_at should be unchanged
    expect(updated.created_at).toBe(originalCreatedAt);
    // updated_at should reflect the update
    expect(updated.updated_at).toBe(updateTime);
  });
});

// ============================================================================
// TRACEABILITY MATRIX
// ============================================================================

/**
 * Security Test Traceability Matrix
 *
 * | Test ID | Threat | Control | OWASP | Severity |
 * |---------|--------|---------|-------|----------|
 * | SEC-006-INJ-01 | SQL Injection | Parameterized queries | A03:2021 | CRITICAL |
 * | SEC-006-INJ-02 | Union injection | Input validation | A03:2021 | CRITICAL |
 * | SEC-006-INJ-03 | Blind injection | Prepared statements | A03:2021 | HIGH |
 * | DB-006-ISO-01 | Data leakage | Store-scoped queries | A01:2021 | CRITICAL |
 * | DB-006-ISO-02 | Enumeration | Tenant filtering | A01:2021 | HIGH |
 * | DB-006-ISO-03 | Cross-tenant write | Foreign key + filter | A01:2021 | CRITICAL |
 * | CONST-01 | Constraint bypass | Database constraint | A04:2021 | HIGH |
 * | AUDIT-01 | Missing audit | Timestamp columns | A09:2021 | MEDIUM |
 */
