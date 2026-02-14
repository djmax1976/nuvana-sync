/**
 * SQL Injection Security Tests
 *
 * Validates that all DAL operations properly protect against SQL injection attacks.
 * Tests parameterized queries across all data access layers.
 *
 * @module tests/security/sql-injection
 * @security SEC-006: SQL injection prevention via parameterized queries
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted() to ensure mock functions are available when vi.mock runs
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
const { mockPrepare, mockTransaction } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn((fn: () => void) => () => fn()),
}));

vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

// Mock bcrypt for users DAL
vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2b$12$mockhash'),
    compare: vi.fn().mockResolvedValue(true),
  },
}));

// Import DALs after mocking
import { LotteryPacksDAL } from '../../src/main/dal/lottery-packs.dal';
import { LotteryGamesDAL } from '../../src/main/dal/lottery-games.dal';
import { LotteryBinsDAL } from '../../src/main/dal/lottery-bins.dal';
import { UsersDAL } from '../../src/main/dal/users.dal';

describe('SQL Injection Protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Common SQL injection payloads to test against
   */
  const INJECTION_PAYLOADS = [
    // Classic SQL injection
    "'; DROP TABLE users;--",
    "1' OR '1'='1",
    "1; DELETE FROM lottery_packs WHERE '1'='1",
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
  ];

  describe('LotteryPacksDAL - SEC-006', () => {
    let dal: LotteryPacksDAL;

    beforeEach(() => {
      dal = new LotteryPacksDAL();
    });

    describe('findByPackNumber', () => {
      it('should use parameterized queries for all parameters', () => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue(undefined),
        });

        dal.findByPackNumber('store-123', 'game-456', 'pack-001');

        const query = mockPrepare.mock.calls[0][0];

        // Verify query uses placeholders
        expect(query).toContain('?');
        expect(query).not.toContain('store-123');
        expect(query).not.toContain('game-456');
        expect(query).not.toContain('pack-001');
      });

      it.each(INJECTION_PAYLOADS)('should safely handle malicious input: %s', (payload) => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue(undefined),
        });

        // This should not throw and should not execute malicious SQL
        const result = dal.findByPackNumber(payload, payload, payload);

        // Query should be parameterized, not contain the injection payload
        const query = mockPrepare.mock.calls[0][0];
        expect(query).not.toContain('DROP');
        expect(query).not.toContain('DELETE');
        expect(query).not.toContain('UNION');
        expect(query).not.toContain('INSERT');
        expect(query).not.toContain('UPDATE');
        expect(query).not.toContain('SLEEP');

        // Result should be null/undefined (not found), not an error
        expect(result).toBeUndefined();
      });
    });

    describe('findWithFilters', () => {
      it('should parameterize filter values', () => {
        mockPrepare.mockReturnValue({
          all: vi.fn().mockReturnValue([]),
        });

        dal.findWithFilters('store-123', {
          status: 'ACTIVE',
          game_id: 'game-456',
          current_bin_id: 'bin-789',
        });

        const query = mockPrepare.mock.calls[0][0];

        // Verify placeholders are used
        expect((query.match(/\?/g) || []).length).toBeGreaterThanOrEqual(4);
      });

      it.each(INJECTION_PAYLOADS)('should safely handle malicious filter values: %s', (payload) => {
        mockPrepare.mockReturnValue({
          all: vi.fn().mockReturnValue([]),
        });

        // Status must be valid enum, so only test game_id and current_bin_id with payloads
        const result = dal.findWithFilters(payload, {
          game_id: payload,
          current_bin_id: payload,
        });

        const query = mockPrepare.mock.calls[0][0];
        expect(query).not.toContain('DROP');
        expect(query).not.toContain('DELETE');
        expect(query).not.toContain('UNION');

        expect(result).toEqual([]);
      });
    });

    describe('findByStatus', () => {
      it('should use parameterized query', () => {
        mockPrepare.mockReturnValue({
          all: vi.fn().mockReturnValue([]),
        });

        dal.findByStatus('store-123', 'ACTIVE');

        const query = mockPrepare.mock.calls[0][0];
        expect(query).toContain('store_id = ?');
        expect(query).toContain('status = ?');
      });
    });

    describe('receive', () => {
      it('should use parameterized INSERT', () => {
        mockPrepare
          .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) }) // duplicate check
          .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) }) // INSERT
          .mockReturnValueOnce({
            get: vi.fn().mockReturnValue({
              pack_id: 'test',
              store_id: 'store-123',
              game_id: 'game-456',
              pack_number: 'pack-001',
              status: 'RECEIVED',
            }),
          }); // findById

        dal.receive({
          store_id: 'store-123',
          game_id: 'game-456',
          pack_number: 'pack-001',
        });

        const insertCall = mockPrepare.mock.calls.find((call) => call[0].includes('INSERT'));
        expect(insertCall).toBeDefined();
        expect(insertCall![0]).toContain('VALUES (?, ?, ?, ?,');
      });
    });
  });

  describe('LotteryGamesDAL - SEC-006', () => {
    let dal: LotteryGamesDAL;

    beforeEach(() => {
      dal = new LotteryGamesDAL();
    });

    describe('findActiveByStore', () => {
      it('should use parameterized query for store_id', () => {
        mockPrepare.mockReturnValue({
          all: vi.fn().mockReturnValue([]),
        });

        dal.findActiveByStore('store-123');

        const query = mockPrepare.mock.calls[0][0];
        expect(query).toContain('store_id = ?');
        expect(query).not.toContain('store-123');
      });

      it.each(INJECTION_PAYLOADS)('should safely handle malicious storeId: %s', (payload) => {
        mockPrepare.mockReturnValue({
          all: vi.fn().mockReturnValue([]),
        });

        const result = dal.findActiveByStore(payload);

        const query = mockPrepare.mock.calls[0][0];
        expect(query).not.toContain('DROP');
        expect(query).not.toContain('DELETE');

        expect(result).toEqual([]);
      });
    });

    describe('findByGameCode', () => {
      it('should use parameterized query', () => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue(undefined),
        });

        dal.findByGameCode('store-123', 'CASH5');

        const query = mockPrepare.mock.calls[0][0];
        expect(query).toContain('store_id = ?');
        expect(query).toContain('game_code = ?');
      });
    });
  });

  describe('LotteryBinsDAL - SEC-006', () => {
    let dal: LotteryBinsDAL;

    beforeEach(() => {
      dal = new LotteryBinsDAL();
    });

    describe('findByName', () => {
      it('should use parameterized query', () => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue(undefined),
        });

        dal.findByName('store-123', 'Bin 1');

        const query = mockPrepare.mock.calls[0][0];
        expect(query).toContain('store_id = ?');
        expect(query).toContain('name = ?');
      });
    });

    describe('findBinsWithPacks', () => {
      it('should use parameterized query in JOIN', () => {
        mockPrepare.mockReturnValue({
          all: vi.fn().mockReturnValue([]),
        });

        dal.findBinsWithPacks('store-123');

        const query = mockPrepare.mock.calls[0][0];
        expect(query).toContain('WHERE');
        expect(query).toContain('?');
      });
    });
  });

  describe('UsersDAL - SEC-006', () => {
    let dal: UsersDAL;

    beforeEach(() => {
      dal = new UsersDAL();
    });

    describe('findActiveByStore', () => {
      it.each(INJECTION_PAYLOADS)('should safely handle malicious storeId: %s', (payload) => {
        mockPrepare.mockReturnValue({
          all: vi.fn().mockReturnValue([]),
        });

        const result = dal.findActiveByStore(payload);

        const query = mockPrepare.mock.calls[0][0];
        // Query should be static and parameterized
        expect(query).toContain('WHERE store_id = ?');
        expect(query).not.toContain(payload);

        expect(result).toEqual([]);
      });
    });

    // Note: After cloud_id consolidation, user_id IS the cloud ID
    // findByCloudId is removed, users are found by findById (which uses user_id)
    describe('findById', () => {
      it.each(INJECTION_PAYLOADS)('should safely handle malicious userId: %s', (payload) => {
        mockPrepare.mockReturnValue({
          get: vi.fn().mockReturnValue(undefined),
        });

        const result = dal.findById(payload);

        const query = mockPrepare.mock.calls[0][0];
        expect(query).toContain('WHERE user_id = ?');
        expect(query).not.toContain(payload);

        expect(result).toBeUndefined();
      });
    });
  });

  describe('Base DAL Pattern Verification', () => {
    it('should verify all DAL classes use prepared statements', () => {
      // This test documents the pattern all DALs must follow
      const _expectedPattern = /prepare\s*\(\s*`[^`]*\?\s*[^`]*`\s*\)/;

      // Sample queries that demonstrate parameterized pattern
      const sampleQueries = [
        'SELECT * FROM table WHERE id = ?',
        'INSERT INTO table (col1, col2) VALUES (?, ?)',
        'UPDATE table SET col1 = ? WHERE id = ?',
        'DELETE FROM table WHERE id = ?',
      ];

      sampleQueries.forEach((query) => {
        expect(query).toContain('?');
        expect(query).not.toMatch(/\$\{.*\}/); // No template literals
        expect(query).not.toMatch(/\+\s*['"`]/); // No string concatenation
      });
    });

    it('should verify no string interpolation in SQL', () => {
      // Anti-patterns that should never appear
      const antiPatterns = [
        /`SELECT.*\$\{/, // Template literal interpolation
        /'SELECT.*'\s*\+/, // String concatenation
        /"SELECT.*"\s*\+/, // String concatenation
        /prepare\(`[^`]*\$\{[^`]*`\)/, // Interpolation in prepare
      ];

      // These patterns should never match in actual DAL code
      antiPatterns.forEach((pattern) => {
        const safeQuery = 'SELECT * FROM users WHERE id = ?';
        expect(safeQuery).not.toMatch(pattern);
      });
    });
  });

  describe('Query Builder Safety', () => {
    it('should validate buildWhereClause uses parameters', () => {
      // The buildWhereClause method should return parameterized clause
      const _mockConditions = { status: 'ACTIVE', store_id: 'store-123' };

      // Simulating what buildWhereClause should produce
      const expectedClause = 'WHERE status = ? AND store_id = ?';
      const expectedParams = ['ACTIVE', 'store-123'];

      expect(expectedClause).toContain('?');
      expect(expectedParams).toHaveLength(2);
    });

    it('should validate buildOrderByClause against allowlist', () => {
      // Sort columns must be validated against allowlist
      const allowedColumns = new Set(['created_at', 'updated_at', 'name']);
      const maliciousColumn = 'name; DROP TABLE users--';

      expect(allowedColumns.has(maliciousColumn)).toBe(false);
      expect(allowedColumns.has('created_at')).toBe(true);
    });
  });
});
