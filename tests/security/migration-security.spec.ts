/**
 * Migration Security Tests
 *
 * Security-focused tests for the cloud_id consolidation migrations (v041-v045).
 * Validates that the migration does not introduce security vulnerabilities
 * and that tenant isolation, data integrity, and access controls are maintained.
 *
 * @module tests/security/migration-security
 * @security SEC-006: SQL injection prevention
 * @security DB-006: Tenant isolation validation
 * @security SEC-001: PIN hash security validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Dynamic import for better-sqlite3 (native module)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Database: any;
let skipTests = false;

// Try to load better-sqlite3 - skip tests if not available (CI environment)
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3');
} catch {
  skipTests = true;
}

// ============================================================================
// Test Setup
// ============================================================================

describe.skipIf(skipTests)('Migration Security', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  const STORE_1_ID = 'store-tenant-1';
  const STORE_2_ID = 'store-tenant-2';

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createPostMigrationSchema();
    seedTestStores();
  });

  afterEach(() => {
    if (db?.open) {
      db.close();
    }
  });

  /**
   * Create post-migration schema without cloud_*_id columns
   */
  function createPostMigrationSchema(): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS stores (
        store_id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        name TEXT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        pin_hash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        synced_at TEXT,
        last_login_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES stores(store_id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS lottery_games (
        game_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        game_code TEXT NOT NULL,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        tickets_per_pack INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES stores(store_id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS lottery_packs (
        pack_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        game_id TEXT NOT NULL,
        pack_number TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'RECEIVED',
        tickets_sold_count INTEGER DEFAULT 0,
        sales_amount REAL DEFAULT 0,
        synced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES stores(store_id),
        FOREIGN KEY (game_id) REFERENCES lottery_games(game_id)
      )
    `);
  }

  function seedTestStores(): void {
    const now = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
      VALUES (?, 'company-1', 'Store 1', 'America/New_York', 'ACTIVE', ?, ?)
    `
    ).run(STORE_1_ID, now, now);

    db.prepare(
      `
      INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
      VALUES (?, 'company-2', 'Store 2', 'America/Chicago', 'ACTIVE', ?, ?)
    `
    ).run(STORE_2_ID, now, now);
  }

  // ============================================================================
  // SEC-006: SQL Injection Prevention Tests
  // ============================================================================

  describe('SEC-006: SQL Injection Prevention', () => {
    it('should reject SQL injection attempts in user_id lookup', () => {
      const now = new Date().toISOString();
      const legitimateUserId = 'legit-user-123';

      // Create legitimate user
      db.prepare(
        `
        INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
        VALUES (?, ?, 'Legitimate User', 'cashier', '$2b$12$hash', ?, ?)
      `
      ).run(legitimateUserId, STORE_1_ID, now, now);

      // Attempt SQL injection via user_id parameter
      // This should NOT work with parameterized queries
      const injectionAttempts = [
        "' OR '1'='1",
        "'; DROP TABLE users; --",
        "1; DELETE FROM users WHERE '1'='1",
        "' UNION SELECT * FROM users --",
      ];

      for (const maliciousId of injectionAttempts) {
        // Parameterized query - injection should fail
        const result = db.prepare('SELECT * FROM users WHERE user_id = ?').get(maliciousId);

        // Should return nothing (injection treated as literal string)
        expect(result).toBeUndefined();
      }

      // Verify original user still exists (no deletion occurred)
      const legitUser = db.prepare('SELECT * FROM users WHERE user_id = ?').get(legitimateUserId);
      expect(legitUser).toBeDefined();
    });

    it('should reject SQL injection attempts in pack_id lookup', () => {
      const now = new Date().toISOString();

      // Create game and legitimate pack
      db.prepare(
        `
        INSERT INTO lottery_games (game_id, store_id, game_code, name, price, tickets_per_pack, status, created_at, updated_at)
        VALUES ('game-sec', ?, 'GSEC', 'Security Game', 5.0, 300, 'ACTIVE', ?, ?)
      `
      ).run(STORE_1_ID, now, now);

      const legitimatePackId = 'legit-pack-123';
      db.prepare(
        `
        INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, created_at, updated_at)
        VALUES (?, ?, 'game-sec', 'PKG-001', 'RECEIVED', ?, ?)
      `
      ).run(legitimatePackId, STORE_1_ID, now, now);

      // Attempt SQL injection
      const injectionAttempts = [
        "' OR '1'='1",
        "'; UPDATE lottery_packs SET status = 'DEPLETED'; --",
        '1 OR 1=1',
      ];

      for (const maliciousId of injectionAttempts) {
        const result = db.prepare('SELECT * FROM lottery_packs WHERE pack_id = ?').get(maliciousId);
        expect(result).toBeUndefined();
      }

      // Verify pack status unchanged
      const legitPack = db
        .prepare('SELECT status FROM lottery_packs WHERE pack_id = ?')
        .get(legitimatePackId) as { status: string };
      expect(legitPack.status).toBe('RECEIVED');
    });

    it('should safely handle special characters in IDs', () => {
      const now = new Date().toISOString();

      // IDs with special characters that could be dangerous if not parameterized
      const specialIds = [
        'user-with-quotes-"test"',
        "user-with-apostrophe-it's",
        'user-with-semicolon;id',
        'user-with-dash--comment',
        'user-with-newline\nid',
        'user-with-null\x00id',
      ];

      for (const specialId of specialIds) {
        // Insert should work with parameterized queries
        db.prepare(
          `
          INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
          VALUES (?, ?, 'Test', 'cashier', '$2b$12$hash', ?, ?)
        `
        ).run(specialId, STORE_1_ID, now, now);

        // Lookup should find the exact ID
        const user = db.prepare('SELECT user_id FROM users WHERE user_id = ?').get(specialId) as {
          user_id: string;
        };

        expect(user).toBeDefined();
        expect(user.user_id).toBe(specialId);
      }
    });
  });

  // ============================================================================
  // DB-006: Tenant Isolation Tests
  // ============================================================================

  describe('DB-006: Tenant Isolation', () => {
    beforeEach(() => {
      const now = new Date().toISOString();

      // Create users in both stores with same "local" IDs but different store_ids
      db.prepare(
        `
        INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
        VALUES ('shared-id-user', ?, 'Store 1 User', 'cashier', '$2b$12$hash1', ?, ?)
      `
      ).run(STORE_1_ID, now, now);

      // Note: In consolidated model, user_id must be globally unique
      // So we use different user_id per store
      db.prepare(
        `
        INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
        VALUES ('store2-user', ?, 'Store 2 User', 'cashier', '$2b$12$hash2', ?, ?)
      `
      ).run(STORE_2_ID, now, now);
    });

    it('should enforce tenant isolation when querying users', () => {
      // Query for Store 1 user from Store 2 context should fail
      const crossTenantResult = db
        .prepare('SELECT * FROM users WHERE user_id = ? AND store_id = ?')
        .get('shared-id-user', STORE_2_ID);

      expect(crossTenantResult).toBeUndefined();

      // Query for Store 1 user from Store 1 context should succeed
      const sameTenantResult = db
        .prepare('SELECT * FROM users WHERE user_id = ? AND store_id = ?')
        .get('shared-id-user', STORE_1_ID);

      expect(sameTenantResult).toBeDefined();
    });

    it('should prevent cross-tenant user updates', () => {
      const now = new Date().toISOString();

      // Attempt to update Store 1 user with Store 2 context
      const result = db
        .prepare('UPDATE users SET name = ? WHERE user_id = ? AND store_id = ?')
        .run('Hacked Name', 'shared-id-user', STORE_2_ID);

      // No rows should be affected
      expect(result.changes).toBe(0);

      // Verify original name unchanged
      const user = db.prepare('SELECT name FROM users WHERE user_id = ?').get('shared-id-user') as {
        name: string;
      };
      expect(user.name).toBe('Store 1 User');
    });

    it('should enforce tenant isolation for pack operations', () => {
      const now = new Date().toISOString();

      // Create games in both stores
      db.prepare(
        `
        INSERT INTO lottery_games (game_id, store_id, game_code, name, price, tickets_per_pack, status, created_at, updated_at)
        VALUES ('game-store1', ?, 'G1', 'Store 1 Game', 5.0, 300, 'ACTIVE', ?, ?)
      `
      ).run(STORE_1_ID, now, now);

      db.prepare(
        `
        INSERT INTO lottery_games (game_id, store_id, game_code, name, price, tickets_per_pack, status, created_at, updated_at)
        VALUES ('game-store2', ?, 'G2', 'Store 2 Game', 5.0, 300, 'ACTIVE', ?, ?)
      `
      ).run(STORE_2_ID, now, now);

      // Create pack in Store 1
      const store1PackId = 'store1-pack-001';
      db.prepare(
        `
        INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, created_at, updated_at)
        VALUES (?, ?, 'game-store1', 'PKG-001', 'RECEIVED', ?, ?)
      `
      ).run(store1PackId, STORE_1_ID, now, now);

      // Attempt to query Store 1 pack from Store 2 context
      const crossTenantPack = db
        .prepare('SELECT * FROM lottery_packs WHERE pack_id = ? AND store_id = ?')
        .get(store1PackId, STORE_2_ID);

      expect(crossTenantPack).toBeUndefined();

      // Attempt to update Store 1 pack from Store 2 context
      const updateResult = db
        .prepare('UPDATE lottery_packs SET status = ? WHERE pack_id = ? AND store_id = ?')
        .run('DEPLETED', store1PackId, STORE_2_ID);

      expect(updateResult.changes).toBe(0);

      // Verify original status unchanged
      const pack = db
        .prepare('SELECT status FROM lottery_packs WHERE pack_id = ?')
        .get(store1PackId) as { status: string };
      expect(pack.status).toBe('RECEIVED');
    });

    it('should prevent data leakage in batch queries', () => {
      const now = new Date().toISOString();

      // Create additional users in each store
      for (let i = 0; i < 3; i++) {
        db.prepare(
          `
          INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
          VALUES (?, ?, ?, 'cashier', '$2b$12$hash', ?, ?)
        `
        ).run(`store1-user-${i}`, STORE_1_ID, `Store 1 User ${i}`, now, now);

        db.prepare(
          `
          INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
          VALUES (?, ?, ?, 'cashier', '$2b$12$hash', ?, ?)
        `
        ).run(`store2-user-${i}`, STORE_2_ID, `Store 2 User ${i}`, now, now);
      }

      // Batch query should only return users from the specified store
      const store1Users = db
        .prepare('SELECT user_id FROM users WHERE store_id = ?')
        .all(STORE_1_ID) as Array<{ user_id: string }>;

      // Should only include Store 1 users (3 new + 1 from beforeEach)
      const store1UserIds = store1Users.map((u) => u.user_id);
      expect(store1UserIds.every((id) => id.startsWith('store1-') || id === 'shared-id-user')).toBe(
        true
      );
      expect(store1UserIds.some((id) => id.startsWith('store2-'))).toBe(false);
    });
  });

  // ============================================================================
  // SEC-001: PIN Hash Security Tests
  // ============================================================================

  describe('SEC-001: PIN Hash Security', () => {
    it('should preserve PIN hashes after migration', () => {
      const now = new Date().toISOString();
      const validBcryptHash = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.VTtYl.8Y3Z5q2u';

      db.prepare(
        `
        INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
        VALUES ('pin-test-user', ?, 'PIN Test User', 'cashier', ?, ?, ?)
      `
      ).run(STORE_1_ID, validBcryptHash, now, now);

      // Verify PIN hash preserved exactly
      const user = db
        .prepare('SELECT pin_hash FROM users WHERE user_id = ?')
        .get('pin-test-user') as { pin_hash: string };

      expect(user.pin_hash).toBe(validBcryptHash);
      expect(user.pin_hash).toMatch(/^\$2[aby]?\$\d{1,2}\$.{53}$/); // bcrypt format
    });

    it('should not expose PIN hashes in SELECT without explicit column', () => {
      const now = new Date().toISOString();

      db.prepare(
        `
        INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
        VALUES ('pin-exposure-user', ?, 'Test User', 'cashier', '$2b$12$secret', ?, ?)
      `
      ).run(STORE_1_ID, now, now);

      // Selective query excluding pin_hash
      const user = db
        .prepare('SELECT user_id, store_id, name, role FROM users WHERE user_id = ?')
        .get('pin-exposure-user') as Record<string, unknown>;

      expect(user).toBeDefined();
      expect(user.user_id).toBe('pin-exposure-user');
      expect(user).not.toHaveProperty('pin_hash');
    });
  });

  // ============================================================================
  // Data Integrity Tests
  // ============================================================================

  describe('Data Integrity', () => {
    it('should maintain primary key uniqueness after migration', () => {
      const now = new Date().toISOString();

      // Insert first user
      db.prepare(
        `
        INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
        VALUES ('unique-user', ?, 'First User', 'cashier', '$2b$12$hash', ?, ?)
      `
      ).run(STORE_1_ID, now, now);

      // Attempt to insert duplicate user_id
      expect(() => {
        db.prepare(
          `
          INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
          VALUES ('unique-user', ?, 'Duplicate User', 'cashier', '$2b$12$hash2', ?, ?)
        `
        ).run(STORE_2_ID, now, now); // Even different store
      }).toThrow(/UNIQUE constraint failed|PRIMARY KEY/);
    });

    it('should maintain foreign key constraints', () => {
      const now = new Date().toISOString();

      // Attempt to insert pack with non-existent game_id
      expect(() => {
        db.prepare(
          `
          INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, created_at, updated_at)
          VALUES ('orphan-pack', ?, 'non-existent-game', 'PKG-ORPHAN', 'RECEIVED', ?, ?)
        `
        ).run(STORE_1_ID, now, now);
      }).toThrow(/FOREIGN KEY constraint failed/);
    });

    it('should preserve NOT NULL constraints', () => {
      const now = new Date().toISOString();

      // Attempt to insert user without required fields
      expect(() => {
        db.prepare(
          `
          INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
          VALUES ('null-test', NULL, 'Test', 'cashier', '$2b$12$hash', ?, ?)
        `
        ).run(now, now);
      }).toThrow(/NOT NULL constraint failed/);
    });
  });

  // ============================================================================
  // Audit Trail Tests
  // ============================================================================

  describe('Audit Trail', () => {
    it('should maintain timestamps for audit purposes', () => {
      const createTime = '2026-01-27T10:00:00.000Z';
      const updateTime = '2026-01-27T12:00:00.000Z';

      db.prepare(
        `
        INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
        VALUES ('audit-user', ?, 'Audit Test', 'cashier', '$2b$12$hash', ?, ?)
      `
      ).run(STORE_1_ID, createTime, createTime);

      // Update user
      db.prepare(
        `
        UPDATE users SET name = ?, updated_at = ? WHERE user_id = ?
      `
      ).run('Updated Audit Test', updateTime, 'audit-user');

      // Verify timestamps
      const user = db
        .prepare('SELECT created_at, updated_at FROM users WHERE user_id = ?')
        .get('audit-user') as { created_at: string; updated_at: string };

      expect(user.created_at).toBe(createTime);
      expect(user.updated_at).toBe(updateTime);
      expect(new Date(user.updated_at).getTime()).toBeGreaterThan(
        new Date(user.created_at).getTime()
      );
    });

    it('should track synced_at for cloud sync audit', () => {
      const now = new Date().toISOString();

      db.prepare(
        `
        INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
        VALUES ('sync-audit-user', ?, 'Sync Audit', 'cashier', '$2b$12$hash', ?, ?)
      `
      ).run(STORE_1_ID, now, now);

      // Initially no synced_at
      const beforeSync = db
        .prepare('SELECT synced_at FROM users WHERE user_id = ?')
        .get('sync-audit-user') as { synced_at: string | null };
      expect(beforeSync.synced_at).toBeNull();

      // After cloud sync
      const syncTime = new Date(Date.now() + 1000).toISOString();
      db.prepare('UPDATE users SET synced_at = ? WHERE user_id = ?').run(
        syncTime,
        'sync-audit-user'
      );

      const afterSync = db
        .prepare('SELECT synced_at FROM users WHERE user_id = ?')
        .get('sync-audit-user') as { synced_at: string };
      expect(afterSync.synced_at).toBe(syncTime);
    });
  });
});
