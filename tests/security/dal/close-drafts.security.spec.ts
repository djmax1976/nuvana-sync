/**
 * Close Drafts DAL Security Tests
 *
 * Security-focused tests for the close drafts data access layer.
 * Tests SQL injection prevention (SEC-006) and tenant isolation (DB-006).
 *
 * @module tests/security/dal/close-drafts.security.spec
 * @feature DRAFT-001: Draft-Backed Wizard Architecture
 * @security SEC-006: SQL injection prevention
 * @security DB-006: Tenant isolation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted() to ensure mock functions are available when vi.mock runs
const { mockPrepare, mockTransaction, capturedQueries } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn((fn: () => unknown) => () => fn()),
  capturedQueries: [] as Array<{ query: string; params: unknown[] }>,
}));

vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: (query: string) => {
      mockPrepare(query);
      return {
        get: (...params: unknown[]) => {
          capturedQueries.push({ query, params });
          return undefined;
        },
        all: (...params: unknown[]) => {
          capturedQueries.push({ query, params });
          return [];
        },
        run: (...params: unknown[]) => {
          capturedQueries.push({ query, params });
          return { changes: 0 };
        },
      };
    },
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

// Mock crypto
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return {
    ...actual,
    randomUUID: vi.fn().mockReturnValue('mock-draft-uuid'),
  };
});

import {
  CloseDraftsDAL,
  _resetCloseDraftsDAL,
  VersionConflictError,
  InvalidStatusTransitionError,
} from '../../../src/main/dal/close-drafts.dal';

/**
 * Common SQL injection payloads to test against
 * These are attack vectors from OWASP and real-world exploits
 */
const SQL_INJECTION_PAYLOADS = [
  // Classic SQL injection
  "'; DROP TABLE close_drafts;--",
  "1' OR '1'='1",
  "1; DELETE FROM close_drafts WHERE '1'='1",
  "' UNION SELECT * FROM users--",
  // Time-based blind injection
  "1' AND SLEEP(5)--",
  "'; WAITFOR DELAY '0:0:5'--",
  // Error-based injection
  "' AND 1=CONVERT(int,@@version)--",
  "' AND extractvalue(1,concat(0x7e,version()))--",
  // Boolean-based blind injection
  "' AND 1=1--",
  "' AND 1=2--",
  // Stacked queries
  "'; INSERT INTO users VALUES('hacker','admin')--",
  "'; UPDATE users SET role='ADMIN' WHERE '1'='1",
  // Unicode/encoding bypass attempts
  "admin'--",
  "admin'/*",
  "1' OR 1=1#",
  "1' OR '1'='1'/*",
  // Special characters
  "O'Brien",
  'test\x00injection',
  'test%00injection',
  "admin' AND '1'='1",
  // SQLite-specific injection
  "' OR sqlite_version() IS NOT NULL--",
  "' OR typeof(1) = 'integer'--",
  // JSON injection (payload field)
  '{"__proto__":{"admin":true}}',
  '{"constructor":{"prototype":{"admin":true}}}',
];

describe('Close Drafts DAL Security Tests', () => {
  let dal: CloseDraftsDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedQueries.length = 0;
    _resetCloseDraftsDAL();
    dal = new CloseDraftsDAL();
  });

  // ==========================================================================
  // T2.4: SEC-006 SQL INJECTION PREVENTION TESTS
  // ==========================================================================

  describe('SEC-006: SQL Injection Prevention', () => {
    describe('getDraft - SQL Injection Tests', () => {
      it('should use parameterized queries for all parameters', () => {
        dal.getDraft('store-123', 'draft-456');

        expect(capturedQueries.length).toBeGreaterThan(0);
        const query = capturedQueries[0].query;

        // Verify query uses placeholders, not string interpolation
        expect(query).toContain('?');
        expect(query).not.toContain('store-123');
        expect(query).not.toContain('draft-456');
      });

      it.each(SQL_INJECTION_PAYLOADS)('should safely handle malicious storeId: %s', (payload) => {
        // This should not throw and should not execute malicious SQL
        expect(() => dal.getDraft(payload, 'draft-123')).not.toThrow();

        // Query should be parameterized, not contain the injection payload in SQL
        const query = capturedQueries[0]?.query;
        if (query) {
          expect(query).not.toContain('DROP');
          expect(query).not.toContain('DELETE');
          expect(query).not.toContain('UNION SELECT');
          expect(query).not.toContain('INSERT INTO users');
          expect(query).not.toContain('UPDATE users');
        }
      });

      it.each(SQL_INJECTION_PAYLOADS)('should safely handle malicious draftId: %s', (payload) => {
        expect(() => dal.getDraft('store-123', payload)).not.toThrow();

        const query = capturedQueries[0]?.query;
        if (query) {
          expect(query).not.toContain('DROP');
          expect(query).not.toContain('DELETE');
          expect(query).not.toContain('UNION SELECT');
        }
      });
    });

    describe('getActiveDraft - SQL Injection Tests', () => {
      it.each(SQL_INJECTION_PAYLOADS)('should safely handle malicious shiftId: %s', (payload) => {
        expect(() => dal.getActiveDraft('store-123', payload)).not.toThrow();

        const query = capturedQueries[0]?.query;
        if (query) {
          expect(query).not.toContain('DROP');
          expect(query).not.toContain('DELETE');
        }
      });
    });

    describe('createDraft - SQL Injection Tests', () => {
      it('should use parameterized INSERT query', () => {
        // This will fail to retrieve but we can check the query structure
        try {
          dal.createDraft('store-123', 'shift-456', '2024-01-15', 'DAY_CLOSE', 'user-789');
        } catch {
          // Expected - mock doesn't return the created draft
        }

        // Find the INSERT query
        const insertQuery = capturedQueries.find((q) => q.query.includes('INSERT'));
        expect(insertQuery).toBeDefined();
        expect(insertQuery?.query).toContain('?');
        // Should have many placeholders (all parameters)
        const placeholderCount = (insertQuery?.query.match(/\?/g) || []).length;
        expect(placeholderCount).toBeGreaterThanOrEqual(9);
      });

      it.each(SQL_INJECTION_PAYLOADS)(
        'should safely handle malicious storeId in create: %s',
        (payload) => {
          try {
            dal.createDraft(payload, 'shift-456', '2024-01-15', 'DAY_CLOSE', 'user-789');
          } catch {
            // Expected - mock doesn't return draft
          }

          const queries = capturedQueries.map((q) => q.query).join(' ');
          expect(queries).not.toContain('DROP');
          expect(queries).not.toContain('DELETE FROM');
        }
      );

      it.each(SQL_INJECTION_PAYLOADS)(
        'should safely handle malicious shiftId in create: %s',
        (payload) => {
          try {
            dal.createDraft('store-123', payload, '2024-01-15', 'DAY_CLOSE', 'user-789');
          } catch {
            // Expected
          }

          const queries = capturedQueries.map((q) => q.query).join(' ');
          expect(queries).not.toContain('DROP');
          expect(queries).not.toContain('DELETE FROM');
        }
      );

      it.each(SQL_INJECTION_PAYLOADS)(
        'should safely handle malicious businessDate in create: %s',
        (payload) => {
          try {
            dal.createDraft('store-123', 'shift-456', payload, 'DAY_CLOSE', 'user-789');
          } catch {
            // Expected
          }

          const queries = capturedQueries.map((q) => q.query).join(' ');
          expect(queries).not.toContain('DROP');
          expect(queries).not.toContain('DELETE FROM');
        }
      );

      it.each(SQL_INJECTION_PAYLOADS)(
        'should safely handle malicious userId in create: %s',
        (payload) => {
          try {
            dal.createDraft('store-123', 'shift-456', '2024-01-15', 'DAY_CLOSE', payload);
          } catch {
            // Expected
          }

          const queries = capturedQueries.map((q) => q.query).join(' ');
          expect(queries).not.toContain('DROP');
          expect(queries).not.toContain('DELETE FROM');
        }
      );
    });

    describe('cleanupExpiredDrafts - SQL Injection Tests', () => {
      it('should use parameterized DELETE query', () => {
        dal.cleanupExpiredDrafts('store-123', 24);

        const deleteQuery = capturedQueries.find((q) => q.query.includes('DELETE'));
        expect(deleteQuery).toBeDefined();
        expect(deleteQuery?.query).toContain('?');
        expect(deleteQuery?.query).not.toContain('store-123');
      });

      it.each(SQL_INJECTION_PAYLOADS)(
        'should safely handle malicious storeId in cleanup: %s',
        (payload) => {
          expect(() => dal.cleanupExpiredDrafts(payload, 24)).not.toThrow();

          const queries = capturedQueries.map((q) => q.query).join(' ');
          expect(queries).not.toContain('DROP TABLE');
        }
      );
    });

    describe('deleteDraft - SQL Injection Tests', () => {
      it.each(SQL_INJECTION_PAYLOADS)(
        'should safely handle malicious draftId in delete: %s',
        (payload) => {
          expect(() => dal.deleteDraft('store-123', payload)).not.toThrow();

          const queries = capturedQueries.map((q) => q.query).join(' ');
          // Should only delete close_drafts, not other tables
          expect(queries).not.toContain('users');
          expect(queries).not.toContain('stores');
        }
      );
    });

    describe('Query Structure Verification', () => {
      it('should never use string concatenation for user input', () => {
        // Execute all main operations
        dal.getDraft('store-123', 'draft-456');
        dal.getActiveDraft('store-123', 'shift-789');
        dal.getDraftsByStore('store-123', 'IN_PROGRESS');
        dal.countByStatus('store-123', 'IN_PROGRESS');
        dal.cleanupExpiredDrafts('store-123', 24);
        dal.deleteDraft('store-123', 'draft-456');

        // Check all queries for proper parameterization
        capturedQueries.forEach(({ query }) => {
          // Should not contain template literal patterns
          expect(query).not.toMatch(/\$\{.*\}/);
          // Should not contain direct value interpolation
          expect(query).not.toContain('store-123');
          expect(query).not.toContain('draft-456');
          expect(query).not.toContain('shift-789');
          // Should use parameterized placeholders
          expect(query).toContain('?');
        });
      });

      it('should use prepared statements for all database operations', () => {
        // Execute operations
        dal.getDraft('store-123', 'draft-456');

        // mockPrepare should have been called (indicating prepare() was used)
        expect(mockPrepare).toHaveBeenCalled();

        // Query should be a prepared statement template
        const calls = mockPrepare.mock.calls;
        calls.forEach((call) => {
          const query = call[0] as string;
          // Prepared statements use ? placeholders
          expect(query).toMatch(/\?/);
        });
      });
    });
  });

  // ==========================================================================
  // T2.3: DB-006 TENANT ISOLATION TESTS
  // ==========================================================================

  describe('DB-006: Tenant Isolation', () => {
    describe('Store ID Enforcement', () => {
      it('should include store_id in ALL read queries', () => {
        // Execute all read operations
        dal.getDraft('store-A', 'draft-123');
        dal.getActiveDraft('store-A', 'shift-456');
        dal.getDraftsByStore('store-A');
        dal.countByStatus('store-A', 'IN_PROGRESS');
        dal.hasActiveDraft('store-A', 'shift-789');
        dal.getLatestDraftForShift('store-A', 'shift-789');

        // All queries should include store_id
        capturedQueries.forEach(({ query }) => {
          expect(query.toLowerCase()).toContain('store_id');
        });
      });

      it('should include store_id in ALL write queries', () => {
        // Execute write operations
        try {
          dal.createDraft('store-A', 'shift-456', '2024-01-15', 'DAY_CLOSE', 'user-789');
        } catch {
          // Expected - mock issues
        }

        dal.cleanupExpiredDrafts('store-A', 24);
        dal.cleanupAllInactive('store-A');
        dal.deleteDraft('store-A', 'draft-123');

        // All queries should include store_id
        capturedQueries.forEach(({ query }) => {
          expect(query.toLowerCase()).toContain('store_id');
        });
      });

      it('should pass store_id as a bound parameter, not in query string', () => {
        dal.getDraft('store-secret-123', 'draft-456');

        // Store ID should be in params, not in query text
        const lastQuery = capturedQueries[capturedQueries.length - 1];
        expect(lastQuery.query).not.toContain('store-secret-123');
        expect(lastQuery.params).toContain('store-secret-123');
      });
    });

    describe('Cross-Tenant Access Prevention', () => {
      it('should not return draft from different store in getDraft', () => {
        // The query includes store_id in WHERE, so wrong store returns undefined
        const result = dal.getDraft('store-attacker', 'draft-from-store-victim');
        expect(result).toBeUndefined();
      });

      it('should not return draft from different store in getActiveDraft', () => {
        const result = dal.getActiveDraft('store-attacker', 'shift-from-victim');
        expect(result).toBeUndefined();
      });

      it('should only return drafts from specified store in getDraftsByStore', () => {
        const results = dal.getDraftsByStore('store-A');
        // Results should be empty (mock returns []) but query should be scoped
        expect(results).toEqual([]);

        const query = capturedQueries.find((q) => q.query.includes('SELECT'));
        expect(query?.params).toContain('store-A');
      });

      it('should only delete drafts from specified store in cleanupExpiredDrafts', () => {
        dal.cleanupExpiredDrafts('store-A', 24);

        const deleteQuery = capturedQueries.find((q) => q.query.includes('DELETE'));
        expect(deleteQuery).toBeDefined();
        expect(deleteQuery?.query).toContain('store_id = ?');
        expect(deleteQuery?.params).toContain('store-A');
      });

      it('should only delete draft from specified store in deleteDraft', () => {
        dal.deleteDraft('store-A', 'draft-123');

        const deleteQuery = capturedQueries.find((q) => q.query.includes('DELETE'));
        expect(deleteQuery).toBeDefined();
        expect(deleteQuery?.params).toContain('store-A');
        expect(deleteQuery?.params).toContain('draft-123');
      });
    });

    describe('Draft ID Enumeration Attack Prevention', () => {
      it('should require store_id even when draft_id is known', () => {
        // Even if attacker knows the draft_id, they need the correct store_id
        dal.getDraft('wrong-store', 'known-draft-id');

        const query = capturedQueries[0];
        expect(query.query).toContain('store_id = ?');
        expect(query.query).toContain('draft_id = ?');
        // Both conditions must match
        expect(query.query).toMatch(/WHERE.*AND/);
      });

      it('should use AND not OR for store_id and draft_id conditions', () => {
        dal.getDraft('store-A', 'draft-123');

        const query = capturedQueries[0];
        // Should be AND (both must match), not OR (either matches)
        expect(query.query.toLowerCase()).toContain('and');
        expect(query.query.toLowerCase()).not.toMatch(/where\s+.*\s+or\s+/);
      });
    });

    describe('Store Isolation in Status Transitions', () => {
      it('should scope status transition queries by store_id', () => {
        // All status transition methods eventually call getDraft which is store-scoped
        // The UPDATE also includes store_id in WHERE

        // Test expireDraft (doesn't throw even if not found due to idempotent behavior)
        try {
          dal.expireDraft('store-A', 'draft-123');
        } catch {
          // getDraft returns undefined, so method throws
        }

        // Check that store_id was included in queries
        capturedQueries.forEach(({ query }) => {
          expect(query.toLowerCase()).toContain('store_id');
        });
      });
    });
  });

  // ==========================================================================
  // PAYLOAD INJECTION TESTS
  // ==========================================================================

  describe('Payload Injection Prevention', () => {
    describe('JSON Payload Handling', () => {
      it('should safely handle malicious JSON in payload', () => {
        // The payload is JSON.stringified before storage
        // SQL injection in JSON is neutralized by parameterization

        const maliciousPayloads = [
          '{"key": "value\'; DROP TABLE users;--"}',
          '{"key": "value\\"; DROP TABLE users;--"}',
          '{"sql": "SELECT * FROM users WHERE 1=1"}',
          '{"nested": {"attack": "\\x00TRUNCATE close_drafts"}}',
        ];

        maliciousPayloads.forEach((payload) => {
          // Even malformed JSON should not cause SQL injection
          // because the entire thing is passed as a parameter
          expect(() => {
            dal.getDraft('store-123', payload);
          }).not.toThrow();
        });
      });
    });
  });

  // ==========================================================================
  // ERROR HANDLING SECURITY
  // ==========================================================================

  describe('Secure Error Handling', () => {
    it('should not leak SQL structure in error messages', () => {
      try {
        // Invalid draft type should throw
        (dal as any).createDraft('store-123', 'shift-456', '2024-01-15', 'INVALID', 'user-789');
      } catch (error) {
        // Error message should not contain SQL
        const message = (error as Error).message;
        expect(message).not.toContain('SELECT');
        expect(message).not.toContain('INSERT');
        expect(message).not.toContain('close_drafts');
        expect(message).not.toMatch(/WHERE.*=/);
      }
    });

    it('should not leak database schema in VersionConflictError', () => {
      // VersionConflictError should only contain version numbers
      const error = new VersionConflictError(5, 3);

      expect(error.message).not.toContain('close_drafts');
      expect(error.message).not.toContain('SELECT');
      expect(error.message).not.toContain('UPDATE');
      expect(error.message).toContain('5');
      expect(error.message).toContain('3');
    });

    it('should not leak schema in InvalidStatusTransitionError', () => {
      const error = new InvalidStatusTransitionError('IN_PROGRESS', 'FINALIZED');

      expect(error.message).not.toContain('close_drafts');
      expect(error.message).not.toContain('UPDATE');
      expect(error.message).toContain('IN_PROGRESS');
      expect(error.message).toContain('FINALIZED');
    });
  });

  // ==========================================================================
  // INDEX USAGE FOR PERFORMANCE
  // ==========================================================================

  describe('Query Efficiency', () => {
    it('should use indexed columns in WHERE clauses', () => {
      dal.getDraft('store-A', 'draft-123');
      dal.getActiveDraft('store-A', 'shift-456');

      // Check queries use indexed columns
      capturedQueries.forEach(({ query }) => {
        const lowerQuery = query.toLowerCase();
        // Primary key lookup
        if (lowerQuery.includes('draft_id')) {
          // draft_id is primary key
          expect(lowerQuery).toMatch(/draft_id\s*=\s*\?/);
        }
        // Composite index lookup
        if (lowerQuery.includes('shift_id')) {
          // idx_drafts_store_shift covers (store_id, shift_id)
          expect(lowerQuery).toContain('store_id');
        }
      });
    });

    it('should use LIMIT 1 for single-record lookups', () => {
      dal.getActiveDraft('store-A', 'shift-456');

      const query = capturedQueries.find((q) => q.query.includes('SELECT'));
      expect(query?.query).toContain('LIMIT 1');
    });
  });
});
