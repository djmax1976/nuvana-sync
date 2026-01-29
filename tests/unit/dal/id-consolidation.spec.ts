/**
 * ID Consolidation - Business Logic Tests
 *
 * Tests that validate business logic works correctly after cloud_id consolidation.
 * After consolidation, the primary ID (user_id, pack_id, etc.) IS the cloud ID.
 *
 * @module tests/unit/dal/id-consolidation
 * @security SEC-006: All queries use parameterized statements
 * @security DB-006: Tests verify tenant isolation is maintained
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

describe.skipIf(skipTests)('ID Consolidation Business Logic', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  const TEST_STORE_ID = 'store-test-001';

  beforeEach(() => {
    // Create fresh in-memory database with post-migration schema
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    // Create post-migration schema (no cloud_*_id columns)
    createPostMigrationSchema();

    // Seed the test store
    db.prepare(
      `
      INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
      VALUES (?, 'company-1', 'Test Store', 'America/New_York', 'ACTIVE', datetime('now'), datetime('now'))
    `
    ).run(TEST_STORE_ID);
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
    // stores table
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

    // users table WITHOUT cloud_user_id
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

    // lottery_games table
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

    // lottery_bins table
    db.exec(`
      CREATE TABLE IF NOT EXISTS lottery_bins (
        bin_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        name TEXT NOT NULL,
        display_order INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES stores(store_id)
      )
    `);

    // lottery_packs table WITHOUT cloud_pack_id
    db.exec(`
      CREATE TABLE IF NOT EXISTS lottery_packs (
        pack_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        game_id TEXT NOT NULL,
        current_bin_id TEXT,
        pack_number TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'RECEIVED',
        opening_serial TEXT,
        closing_serial TEXT,
        tickets_sold_count INTEGER DEFAULT 0,
        sales_amount REAL DEFAULT 0,
        received_at TEXT,
        received_by TEXT,
        activated_at TEXT,
        activated_by TEXT,
        activated_shift_id TEXT,
        depleted_at TEXT,
        depleted_by TEXT,
        depleted_shift_id TEXT,
        depletion_reason TEXT,
        returned_at TEXT,
        returned_by TEXT,
        returned_shift_id TEXT,
        return_reason TEXT,
        return_notes TEXT,
        synced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES stores(store_id),
        FOREIGN KEY (game_id) REFERENCES lottery_games(game_id),
        FOREIGN KEY (current_bin_id) REFERENCES lottery_bins(bin_id)
      )
    `);
  }

  // ============================================================================
  // User ID Consolidation Tests
  // ============================================================================

  describe('User ID Consolidation', () => {
    it('should use user_id directly as the cloud ID for cloud sync', () => {
      const now = new Date().toISOString();
      const cloudUserId = 'cloud-user-uuid-12345'; // This IS now the user_id

      // Insert user with user_id = cloud ID
      db.prepare(
        `
        INSERT INTO users (user_id, store_id, name, role, pin_hash, synced_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(cloudUserId, TEST_STORE_ID, 'John Doe', 'cashier', '$2b$12$hash', now, now, now);

      // Retrieve by user_id (which IS the cloud ID)
      const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(cloudUserId) as {
        user_id: string;
        store_id: string;
        name: string;
      };

      expect(user).toBeDefined();
      expect(user.user_id).toBe(cloudUserId);
    });

    it('should update existing user using user_id lookup during cloud sync', () => {
      const now = new Date().toISOString();
      const cloudUserId = 'cloud-user-uuid-67890';

      // Create initial user
      db.prepare(
        `
        INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(cloudUserId, TEST_STORE_ID, 'Initial Name', 'cashier', '$2b$12$hash1', now, now);

      // Simulate cloud sync update (using user_id directly)
      const laterTime = new Date(Date.now() + 3600000).toISOString();
      db.prepare(
        `
        UPDATE users SET name = ?, role = ?, synced_at = ?, updated_at = ?
        WHERE user_id = ?
      `
      ).run('Updated Name', 'shift_manager', laterTime, laterTime, cloudUserId);

      // Verify update
      const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(cloudUserId) as {
        name: string;
        role: string;
        synced_at: string;
      };

      expect(user.name).toBe('Updated Name');
      expect(user.role).toBe('shift_manager');
      expect(user.synced_at).toBe(laterTime);
    });

    it('should maintain tenant isolation with store_id in queries - SEC DB-006', () => {
      const now = new Date().toISOString();
      const userId = 'user-cross-tenant-test';

      // Create user in test store
      db.prepare(
        `
        INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(userId, TEST_STORE_ID, 'Test User', 'cashier', '$2b$12$hash', now, now);

      // Create another store
      db.prepare(
        `
        INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
        VALUES ('other-store', 'company-2', 'Other Store', 'America/Chicago', 'ACTIVE', ?, ?)
      `
      ).run(now, now);

      // Query with wrong store_id should return nothing (tenant isolation)
      const wrongStoreResult = db
        .prepare('SELECT * FROM users WHERE user_id = ? AND store_id = ?')
        .get(userId, 'other-store');

      expect(wrongStoreResult).toBeUndefined();

      // Query with correct store_id should return the user
      const correctStoreResult = db
        .prepare('SELECT * FROM users WHERE user_id = ? AND store_id = ?')
        .get(userId, TEST_STORE_ID);

      expect(correctStoreResult).toBeDefined();
    });
  });

  // ============================================================================
  // Pack ID Consolidation Tests
  // ============================================================================

  describe('Pack ID Consolidation', () => {
    beforeEach(() => {
      const now = new Date().toISOString();

      // Seed a game for pack foreign key
      db.prepare(
        `
        INSERT INTO lottery_games (game_id, store_id, game_code, name, price, tickets_per_pack, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run('game-1', TEST_STORE_ID, 'G001', 'Test Game', 5.0, 300, 'ACTIVE', now, now);

      // Seed a bin for pack assignment
      db.prepare(
        `
        INSERT INTO lottery_bins (bin_id, store_id, name, display_order, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run('bin-1', TEST_STORE_ID, 'Bin 1', 1, 'ACTIVE', now, now);
    });

    it('should use pack_id directly as the cloud ID for cloud sync', () => {
      const now = new Date().toISOString();
      const cloudPackId = 'cloud-pack-uuid-12345'; // This IS now the pack_id

      // Insert pack with pack_id = cloud ID
      db.prepare(
        `
        INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, synced_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(cloudPackId, TEST_STORE_ID, 'game-1', 'PKG-001', 'RECEIVED', now, now, now);

      // Retrieve by pack_id (which IS the cloud ID)
      const pack = db.prepare('SELECT * FROM lottery_packs WHERE pack_id = ?').get(cloudPackId) as {
        pack_id: string;
        pack_number: string;
        status: string;
      };

      expect(pack).toBeDefined();
      expect(pack.pack_id).toBe(cloudPackId);
      expect(pack.pack_number).toBe('PKG-001');
    });

    it('should support pack lifecycle transitions using pack_id', () => {
      const now = new Date().toISOString();
      const packId = 'lifecycle-pack-001';

      // Create pack in RECEIVED status
      db.prepare(
        `
        INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, received_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'RECEIVED', ?, ?, ?)
      `
      ).run(packId, TEST_STORE_ID, 'game-1', 'PKG-LIFE', now, now, now);

      // Activate pack
      const activatedTime = new Date(Date.now() + 1000).toISOString();
      db.prepare(
        `
        UPDATE lottery_packs SET
          status = 'ACTIVE',
          current_bin_id = ?,
          opening_serial = ?,
          activated_at = ?,
          updated_at = ?
        WHERE pack_id = ?
      `
      ).run('bin-1', '001', activatedTime, activatedTime, packId);

      // Verify activation
      const activePack = db
        .prepare(
          'SELECT status, current_bin_id, opening_serial FROM lottery_packs WHERE pack_id = ?'
        )
        .get(packId) as { status: string; current_bin_id: string; opening_serial: string };

      expect(activePack.status).toBe('ACTIVE');
      expect(activePack.current_bin_id).toBe('bin-1');
      expect(activePack.opening_serial).toBe('001');

      // Deplete pack
      const depletedTime = new Date(Date.now() + 2000).toISOString();
      db.prepare(
        `
        UPDATE lottery_packs SET
          status = 'DEPLETED',
          closing_serial = ?,
          tickets_sold_count = ?,
          sales_amount = ?,
          depleted_at = ?,
          updated_at = ?
        WHERE pack_id = ?
      `
      ).run('150', 150, 750.0, depletedTime, depletedTime, packId);

      // Verify depletion
      const depletedPack = db
        .prepare(
          'SELECT status, closing_serial, tickets_sold_count, sales_amount FROM lottery_packs WHERE pack_id = ?'
        )
        .get(packId) as {
        status: string;
        closing_serial: string;
        tickets_sold_count: number;
        sales_amount: number;
      };

      expect(depletedPack.status).toBe('DEPLETED');
      expect(depletedPack.closing_serial).toBe('150');
      expect(depletedPack.tickets_sold_count).toBe(150);
      expect(depletedPack.sales_amount).toBe(750.0);
    });

    it('should find pack by pack_number + game_id as fallback lookup', () => {
      const now = new Date().toISOString();
      const packId = 'fallback-pack-001';
      const packNumber = 'PKG-FALLBACK';

      // Create pack
      db.prepare(
        `
        INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'RECEIVED', ?, ?)
      `
      ).run(packId, TEST_STORE_ID, 'game-1', packNumber, now, now);

      // Lookup by pack_number + game_id (fallback for cloud sync)
      const pack = db
        .prepare(
          'SELECT * FROM lottery_packs WHERE store_id = ? AND game_id = ? AND pack_number = ?'
        )
        .get(TEST_STORE_ID, 'game-1', packNumber) as { pack_id: string };

      expect(pack).toBeDefined();
      expect(pack.pack_id).toBe(packId);
    });
  });

  // ============================================================================
  // Batch Operations Tests
  // ============================================================================

  describe('Batch Operations with Consolidated IDs', () => {
    it('should batch lookup users by user_id (which is cloud ID)', () => {
      const now = new Date().toISOString();
      const userIds = ['user-batch-1', 'user-batch-2', 'user-batch-3'];

      // Create multiple users
      for (const userId of userIds) {
        db.prepare(
          `
          INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        ).run(userId, TEST_STORE_ID, `User ${userId}`, 'cashier', '$2b$12$hash', now, now);
      }

      // Batch lookup using IN clause - SEC-006: parameterized
      const placeholders = userIds.map(() => '?').join(', ');
      const users = db
        .prepare(`SELECT user_id, name FROM users WHERE user_id IN (${placeholders})`)
        .all(...userIds) as Array<{ user_id: string; name: string }>;

      expect(users).toHaveLength(3);
      expect(users.map((u) => u.user_id).sort()).toEqual(userIds.sort());
    });

    it('should batch lookup packs by pack_id (which is cloud ID)', () => {
      const now = new Date().toISOString();

      // Seed game first
      db.prepare(
        `
        INSERT INTO lottery_games (game_id, store_id, game_code, name, price, tickets_per_pack, status, created_at, updated_at)
        VALUES ('game-batch', ?, 'GBATCH', 'Batch Game', 5.0, 300, 'ACTIVE', ?, ?)
      `
      ).run(TEST_STORE_ID, now, now);

      const packIds = ['pack-batch-1', 'pack-batch-2', 'pack-batch-3'];

      // Create multiple packs
      for (let i = 0; i < packIds.length; i++) {
        db.prepare(
          `
          INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, created_at, updated_at)
          VALUES (?, ?, 'game-batch', ?, 'RECEIVED', ?, ?)
        `
        ).run(packIds[i], TEST_STORE_ID, `PKG-BATCH-${i}`, now, now);
      }

      // Batch lookup - SEC-006: parameterized
      const placeholders = packIds.map(() => '?').join(', ');
      const packs = db
        .prepare(
          `SELECT pack_id, pack_number FROM lottery_packs WHERE pack_id IN (${placeholders})`
        )
        .all(...packIds) as Array<{ pack_id: string; pack_number: string }>;

      expect(packs).toHaveLength(3);
      expect(packs.map((p) => p.pack_id).sort()).toEqual(packIds.sort());
    });

    it('should batch upsert users using user_id directly', () => {
      const now = new Date().toISOString();

      // Create one existing user
      db.prepare(
        `
        INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
        VALUES ('existing-user', ?, 'Existing User', 'cashier', '$2b$12$hash', ?, ?)
      `
      ).run(TEST_STORE_ID, now, now);

      // Batch upsert data (mix of existing and new)
      const upsertData = [
        { user_id: 'existing-user', name: 'Updated Existing', role: 'shift_manager' },
        { user_id: 'new-user-1', name: 'New User 1', role: 'cashier' },
        { user_id: 'new-user-2', name: 'New User 2', role: 'cashier' },
      ];

      // Use transaction for batch upsert
      const transaction = db.transaction(() => {
        for (const data of upsertData) {
          const existing = db.prepare('SELECT 1 FROM users WHERE user_id = ?').get(data.user_id);

          if (existing) {
            db.prepare(
              `
              UPDATE users SET name = ?, role = ?, updated_at = ? WHERE user_id = ?
            `
            ).run(data.name, data.role, now, data.user_id);
          } else {
            db.prepare(
              `
              INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
              VALUES (?, ?, ?, ?, '$2b$12$newhash', ?, ?)
            `
            ).run(data.user_id, TEST_STORE_ID, data.name, data.role, now, now);
          }
        }
      });
      transaction();

      // Verify results
      const allUsers = db
        .prepare('SELECT user_id, name, role FROM users ORDER BY user_id')
        .all() as Array<{ user_id: string; name: string; role: string }>;

      expect(allUsers).toHaveLength(3);

      const existingUser = allUsers.find((u) => u.user_id === 'existing-user');
      expect(existingUser?.name).toBe('Updated Existing');
      expect(existingUser?.role).toBe('shift_manager');

      const newUser1 = allUsers.find((u) => u.user_id === 'new-user-1');
      expect(newUser1?.name).toBe('New User 1');
    });
  });

  // ============================================================================
  // Sync Tracking Tests
  // ============================================================================

  describe('Sync Tracking with Consolidated IDs', () => {
    it('should track synced_at timestamp for users', () => {
      const now = new Date().toISOString();
      const userId = 'sync-tracking-user';

      // Create user without synced_at
      db.prepare(
        `
        INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(userId, TEST_STORE_ID, 'Test User', 'cashier', '$2b$12$hash', now, now);

      // Verify synced_at is null
      const beforeSync = db
        .prepare('SELECT synced_at FROM users WHERE user_id = ?')
        .get(userId) as { synced_at: string | null };
      expect(beforeSync.synced_at).toBeNull();

      // Update synced_at during cloud sync
      const syncTime = new Date().toISOString();
      db.prepare('UPDATE users SET synced_at = ? WHERE user_id = ?').run(syncTime, userId);

      // Verify synced_at is set
      const afterSync = db.prepare('SELECT synced_at FROM users WHERE user_id = ?').get(userId) as {
        synced_at: string;
      };
      expect(afterSync.synced_at).toBe(syncTime);
    });

    it('should track synced_at timestamp for packs', () => {
      const now = new Date().toISOString();
      const packId = 'sync-tracking-pack';

      // Seed game
      db.prepare(
        `
        INSERT INTO lottery_games (game_id, store_id, game_code, name, price, tickets_per_pack, status, created_at, updated_at)
        VALUES ('game-sync', ?, 'GSYNC', 'Sync Game', 5.0, 300, 'ACTIVE', ?, ?)
      `
      ).run(TEST_STORE_ID, now, now);

      // Create pack without synced_at
      db.prepare(
        `
        INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, created_at, updated_at)
        VALUES (?, ?, 'game-sync', 'PKG-SYNC', 'RECEIVED', ?, ?)
      `
      ).run(packId, TEST_STORE_ID, now, now);

      // Verify synced_at is null
      const beforeSync = db
        .prepare('SELECT synced_at FROM lottery_packs WHERE pack_id = ?')
        .get(packId) as { synced_at: string | null };
      expect(beforeSync.synced_at).toBeNull();

      // Update synced_at during cloud sync
      const syncTime = new Date().toISOString();
      db.prepare('UPDATE lottery_packs SET synced_at = ? WHERE pack_id = ?').run(syncTime, packId);

      // Verify synced_at is set
      const afterSync = db
        .prepare('SELECT synced_at FROM lottery_packs WHERE pack_id = ?')
        .get(packId) as { synced_at: string };
      expect(afterSync.synced_at).toBe(syncTime);
    });
  });
});
