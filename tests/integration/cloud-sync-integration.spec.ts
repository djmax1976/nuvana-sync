/**
 * Cloud Sync Integration Tests - Post ID Consolidation
 *
 * Integration tests for cloud sync operations after cloud_id consolidation.
 * Validates that sync workflows work correctly when primary ID IS the cloud ID.
 *
 * @module tests/integration/cloud-sync-integration
 * @security SEC-006: SQL injection prevention via parameterized queries
 * @security DB-006: Tenant isolation validation
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

describe.skipIf(skipTests)('Cloud Sync Integration - Post ID Consolidation', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  const TEST_STORE_ID = 'store-integration-001';

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createPostMigrationSchema();
    seedTestEnvironment();
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
        synced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES stores(store_id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS lottery_bins (
        bin_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        name TEXT NOT NULL,
        display_order INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        synced_at TEXT,
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
        synced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES stores(store_id),
        FOREIGN KEY (game_id) REFERENCES lottery_games(game_id),
        FOREIGN KEY (current_bin_id) REFERENCES lottery_bins(bin_id)
      )
    `);
  }

  function seedTestEnvironment(): void {
    const now = new Date().toISOString();

    // Create test store
    db.prepare(
      `
      INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at)
      VALUES (?, 'company-1', 'Integration Test Store', 'America/New_York', 'ACTIVE', ?, ?)
    `
    ).run(TEST_STORE_ID, now, now);

    // Create test game
    db.prepare(
      `
      INSERT INTO lottery_games (game_id, store_id, game_code, name, price, tickets_per_pack, status, created_at, updated_at)
      VALUES ('game-int-001', ?, 'GINT', 'Integration Game', 5.00, 300, 'ACTIVE', ?, ?)
    `
    ).run(TEST_STORE_ID, now, now);

    // Create test bin
    db.prepare(
      `
      INSERT INTO lottery_bins (bin_id, store_id, name, display_order, status, created_at, updated_at)
      VALUES ('bin-int-001', ?, 'Bin 1', 1, 'ACTIVE', ?, ?)
    `
    ).run(TEST_STORE_ID, now, now);
  }

  // ============================================================================
  // User Sync Workflow Tests
  // ============================================================================

  describe('User Sync Workflow', () => {
    it('should create new user from cloud data using user_id directly', () => {
      // Simulate cloud pull response - user_id IS the cloud ID
      const cloudUserData = {
        user_id: 'cloud-user-uuid-12345', // This IS the cloud ID
        store_id: TEST_STORE_ID,
        name: 'Cloud User',
        role: 'cashier',
        pin_hash: '$2b$12$cloudpinhash',
      };

      const now = new Date().toISOString();

      // Upsert logic: Check if exists, then insert or update
      const existing = db
        .prepare('SELECT 1 FROM users WHERE user_id = ?')
        .get(cloudUserData.user_id);

      if (!existing) {
        db.prepare(
          `
          INSERT INTO users (user_id, store_id, name, role, pin_hash, synced_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          cloudUserData.user_id,
          cloudUserData.store_id,
          cloudUserData.name,
          cloudUserData.role,
          cloudUserData.pin_hash,
          now,
          now,
          now
        );
      }

      // Verify creation
      const user = db
        .prepare('SELECT * FROM users WHERE user_id = ?')
        .get(cloudUserData.user_id) as {
        user_id: string;
        name: string;
        role: string;
        synced_at: string;
      };

      expect(user).toBeDefined();
      expect(user.user_id).toBe('cloud-user-uuid-12345');
      expect(user.name).toBe('Cloud User');
      expect(user.synced_at).toBe(now);
    });

    it('should update existing user from cloud data using user_id directly', () => {
      const now = new Date().toISOString();
      const cloudUserId = 'existing-cloud-user-001';

      // Create existing user
      db.prepare(
        `
        INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
        VALUES (?, ?, 'Original Name', 'cashier', '$2b$12$originalhash', ?, ?)
      `
      ).run(cloudUserId, TEST_STORE_ID, now, now);

      // Simulate cloud update
      const cloudUpdateData = {
        user_id: cloudUserId, // Same ID
        name: 'Updated Cloud Name',
        role: 'shift_manager',
        pin_hash: '$2b$12$newhash',
      };

      const laterTime = new Date(Date.now() + 1000).toISOString();

      // Update using user_id directly (which IS the cloud ID)
      db.prepare(
        `
        UPDATE users SET
          name = ?,
          role = ?,
          pin_hash = ?,
          synced_at = ?,
          updated_at = ?
        WHERE user_id = ?
      `
      ).run(
        cloudUpdateData.name,
        cloudUpdateData.role,
        cloudUpdateData.pin_hash,
        laterTime,
        laterTime,
        cloudUpdateData.user_id
      );

      // Verify update
      const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(cloudUserId) as {
        name: string;
        role: string;
        synced_at: string;
      };

      expect(user.name).toBe('Updated Cloud Name');
      expect(user.role).toBe('shift_manager');
      expect(user.synced_at).toBe(laterTime);
    });

    it('should batch upsert multiple users from cloud', () => {
      const now = new Date().toISOString();

      // Cloud sends batch of users
      const cloudUsers = [
        { user_id: 'batch-user-1', name: 'Batch User 1', role: 'cashier' },
        { user_id: 'batch-user-2', name: 'Batch User 2', role: 'cashier' },
        { user_id: 'batch-user-3', name: 'Batch User 3', role: 'shift_manager' },
      ];

      // Execute batch upsert in transaction
      const transaction = db.transaction(() => {
        for (const cloudUser of cloudUsers) {
          const existing = db
            .prepare('SELECT 1 FROM users WHERE user_id = ?')
            .get(cloudUser.user_id);

          if (existing) {
            db.prepare(
              `
              UPDATE users SET name = ?, role = ?, synced_at = ?, updated_at = ?
              WHERE user_id = ?
            `
            ).run(cloudUser.name, cloudUser.role, now, now, cloudUser.user_id);
          } else {
            db.prepare(
              `
              INSERT INTO users (user_id, store_id, name, role, pin_hash, synced_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, '$2b$12$defaulthash', ?, ?, ?)
            `
            ).run(cloudUser.user_id, TEST_STORE_ID, cloudUser.name, cloudUser.role, now, now, now);
          }
        }
      });
      transaction();

      // Verify all users created
      const users = db
        .prepare("SELECT user_id FROM users WHERE user_id LIKE 'batch-user-%'")
        .all() as Array<{ user_id: string }>;

      expect(users).toHaveLength(3);
    });
  });

  // ============================================================================
  // Pack Sync Workflow Tests
  // ============================================================================

  describe('Pack Sync Workflow', () => {
    it('should create new pack from cloud data using pack_id directly', () => {
      const now = new Date().toISOString();

      // Cloud pack data - pack_id IS the cloud ID
      const cloudPackData = {
        pack_id: 'cloud-pack-uuid-12345', // This IS the cloud ID
        store_id: TEST_STORE_ID,
        game_id: 'game-int-001',
        pack_number: 'PKG-CLOUD-001',
        status: 'RECEIVED',
      };

      // Check if exists
      const existing = db
        .prepare('SELECT 1 FROM lottery_packs WHERE pack_id = ?')
        .get(cloudPackData.pack_id);

      if (!existing) {
        db.prepare(
          `
          INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, synced_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          cloudPackData.pack_id,
          cloudPackData.store_id,
          cloudPackData.game_id,
          cloudPackData.pack_number,
          cloudPackData.status,
          now,
          now,
          now
        );
      }

      // Verify
      const pack = db
        .prepare('SELECT * FROM lottery_packs WHERE pack_id = ?')
        .get(cloudPackData.pack_id) as {
        pack_id: string;
        pack_number: string;
        status: string;
      };

      expect(pack).toBeDefined();
      expect(pack.pack_id).toBe('cloud-pack-uuid-12345');
      expect(pack.pack_number).toBe('PKG-CLOUD-001');
    });

    it('should update pack status from cloud while respecting local terminal states', () => {
      const now = new Date().toISOString();
      const packId = 'status-protection-pack';

      // Create pack in DEPLETED state locally (terminal state)
      db.prepare(
        `
        INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, depleted_at, created_at, updated_at)
        VALUES (?, ?, 'game-int-001', 'PKG-TERMINAL', 'DEPLETED', ?, ?, ?)
      `
      ).run(packId, TEST_STORE_ID, now, now, now);

      // Cloud sends RECEIVED status (stale data)
      const cloudData = {
        pack_id: packId,
        status: 'RECEIVED',
        updated_at: new Date(Date.now() + 3600000).toISOString(), // Even with newer timestamp
      };

      // Implement status protection in update
      const result = db
        .prepare(
          `
        UPDATE lottery_packs SET
          status = CASE
            WHEN status IN ('DEPLETED', 'RETURNED') THEN status  -- Terminal state locked
            WHEN status = 'ACTIVE' AND ? = 'RECEIVED' THEN status  -- Regression blocked
            ELSE ?
          END,
          synced_at = ?,
          updated_at = ?
        WHERE pack_id = ?
      `
        )
        .run(
          cloudData.status,
          cloudData.status,
          cloudData.updated_at,
          cloudData.updated_at,
          packId
        );

      expect(result.changes).toBe(1);

      // Verify status unchanged (terminal state protected)
      const pack = db.prepare('SELECT status FROM lottery_packs WHERE pack_id = ?').get(packId) as {
        status: string;
      };

      expect(pack.status).toBe('DEPLETED'); // Should remain DEPLETED
    });

    it('should allow valid status transitions from cloud', () => {
      const baseTime = new Date('2026-01-27T10:00:00.000Z').toISOString();
      const packId = 'valid-transition-pack';

      // Create pack in RECEIVED state
      db.prepare(
        `
        INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, created_at, updated_at)
        VALUES (?, ?, 'game-int-001', 'PKG-VALID', 'RECEIVED', ?, ?)
      `
      ).run(packId, TEST_STORE_ID, baseTime, baseTime);

      // Cloud sends ACTIVE status with newer timestamp
      const cloudTime = new Date('2026-01-27T12:00:00.000Z').toISOString();
      const cloudData = {
        pack_id: packId,
        status: 'ACTIVE',
        current_bin_id: 'bin-int-001',
        opening_serial: '001',
        activated_at: cloudTime,
        updated_at: cloudTime,
      };

      // Update with timestamp check
      db.prepare(
        `
        UPDATE lottery_packs SET
          status = CASE
            WHEN status IN ('DEPLETED', 'RETURNED') THEN status
            WHEN status = 'ACTIVE' AND ? = 'RECEIVED' THEN status
            WHEN ? > updated_at THEN ?
            ELSE status
          END,
          current_bin_id = COALESCE(?, current_bin_id),
          opening_serial = COALESCE(?, opening_serial),
          activated_at = COALESCE(?, activated_at),
          synced_at = ?,
          updated_at = ?
        WHERE pack_id = ?
      `
      ).run(
        cloudData.status,
        cloudData.updated_at,
        cloudData.status,
        cloudData.current_bin_id,
        cloudData.opening_serial,
        cloudData.activated_at,
        cloudData.updated_at,
        cloudData.updated_at,
        cloudData.pack_id
      );

      // Verify transition
      const pack = db
        .prepare(
          'SELECT status, current_bin_id, opening_serial FROM lottery_packs WHERE pack_id = ?'
        )
        .get(packId) as { status: string; current_bin_id: string; opening_serial: string };

      expect(pack.status).toBe('ACTIVE');
      expect(pack.current_bin_id).toBe('bin-int-001');
      expect(pack.opening_serial).toBe('001');
    });

    it('should batch sync multiple packs from cloud', () => {
      const now = new Date().toISOString();

      const cloudPacks = [
        { pack_id: 'batch-pack-1', pack_number: 'PKG-B1', status: 'RECEIVED' },
        { pack_id: 'batch-pack-2', pack_number: 'PKG-B2', status: 'RECEIVED' },
        { pack_id: 'batch-pack-3', pack_number: 'PKG-B3', status: 'RECEIVED' },
      ];

      // Batch upsert in transaction
      const transaction = db.transaction(() => {
        for (const cloudPack of cloudPacks) {
          const existing = db
            .prepare('SELECT 1 FROM lottery_packs WHERE pack_id = ?')
            .get(cloudPack.pack_id);

          if (!existing) {
            db.prepare(
              `
              INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status, synced_at, created_at, updated_at)
              VALUES (?, ?, 'game-int-001', ?, ?, ?, ?, ?)
            `
            ).run(
              cloudPack.pack_id,
              TEST_STORE_ID,
              cloudPack.pack_number,
              cloudPack.status,
              now,
              now,
              now
            );
          }
        }
      });
      transaction();

      // Verify
      const packs = db
        .prepare("SELECT pack_id FROM lottery_packs WHERE pack_id LIKE 'batch-pack-%'")
        .all() as Array<{ pack_id: string }>;

      expect(packs).toHaveLength(3);
    });
  });

  // ============================================================================
  // Bidirectional Sync Tests
  // ============================================================================

  describe('Bidirectional Sync', () => {
    it('should prepare local changes for push to cloud using user_id directly', () => {
      const now = new Date().toISOString();
      const userId = 'local-user-for-push';

      // Create user locally (user_id IS the cloud ID)
      db.prepare(
        `
        INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
        VALUES (?, ?, 'Local User', 'cashier', '$2b$12$localhash', ?, ?)
      `
      ).run(userId, TEST_STORE_ID, now, now);

      // Query for unsynchronized records (synced_at IS NULL)
      const unsynced = db
        .prepare(
          `
        SELECT user_id, store_id, name, role, pin_hash
        FROM users
        WHERE store_id = ? AND synced_at IS NULL
      `
        )
        .all(TEST_STORE_ID) as Array<{
        user_id: string;
        store_id: string;
        name: string;
        role: string;
        pin_hash: string;
      }>;

      expect(unsynced).toHaveLength(1);
      expect(unsynced[0].user_id).toBe(userId);

      // Prepare payload for cloud API - user_id IS the cloud ID
      const cloudPayload = unsynced.map((u) => ({
        user_id: u.user_id, // This is sent as the cloud ID
        store_id: u.store_id,
        name: u.name,
        role: u.role,
        pin_hash: u.pin_hash,
      }));

      expect(cloudPayload[0].user_id).toBe(userId);
    });

    it('should prepare local pack activations for push to cloud', () => {
      const baseTime = new Date('2026-01-27T08:00:00.000Z').toISOString();
      const activationTime = new Date('2026-01-27T10:00:00.000Z').toISOString();

      // Create pack locally and activate
      const packId = 'local-activated-pack';
      db.prepare(
        `
        INSERT INTO lottery_packs (pack_id, store_id, game_id, pack_number, status,
          current_bin_id, opening_serial, activated_at, created_at, updated_at)
        VALUES (?, ?, 'game-int-001', 'PKG-LOCAL', 'ACTIVE', 'bin-int-001', '001', ?, ?, ?)
      `
      ).run(packId, TEST_STORE_ID, activationTime, baseTime, activationTime);

      // Query for packs that need push (modified locally, synced_at < updated_at OR synced_at IS NULL)
      const needsPush = db
        .prepare(
          `
        SELECT pack_id, store_id, game_id, pack_number, status,
               current_bin_id, opening_serial, activated_at
        FROM lottery_packs
        WHERE store_id = ? AND (synced_at IS NULL OR synced_at < updated_at)
      `
        )
        .all(TEST_STORE_ID) as Array<{
        pack_id: string;
        status: string;
        current_bin_id: string;
        opening_serial: string;
      }>;

      expect(needsPush).toHaveLength(1);
      expect(needsPush[0].pack_id).toBe(packId);
      expect(needsPush[0].status).toBe('ACTIVE');

      // Prepare cloud payload - pack_id IS the cloud ID
      const cloudPayload = {
        pack_id: needsPush[0].pack_id, // This is sent as the cloud ID
        status: needsPush[0].status,
        current_bin_id: needsPush[0].current_bin_id,
        opening_serial: needsPush[0].opening_serial,
      };

      expect(cloudPayload.pack_id).toBe(packId);
    });

    it('should mark records as synced after successful cloud push', () => {
      const now = new Date().toISOString();
      const userId = 'sync-mark-user';

      // Create unsynced user
      db.prepare(
        `
        INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
        VALUES (?, ?, 'Sync Mark User', 'cashier', '$2b$12$hash', ?, ?)
      `
      ).run(userId, TEST_STORE_ID, now, now);

      // Verify unsynced
      const beforeMark = db
        .prepare('SELECT synced_at FROM users WHERE user_id = ?')
        .get(userId) as { synced_at: string | null };
      expect(beforeMark.synced_at).toBeNull();

      // Simulate successful cloud push - mark as synced
      const syncTime = new Date().toISOString();
      db.prepare('UPDATE users SET synced_at = ? WHERE user_id = ?').run(syncTime, userId);

      // Verify synced
      const afterMark = db.prepare('SELECT synced_at FROM users WHERE user_id = ?').get(userId) as {
        synced_at: string;
      };
      expect(afterMark.synced_at).toBe(syncTime);
    });
  });

  // ============================================================================
  // Conflict Resolution Tests
  // ============================================================================

  describe('Conflict Resolution', () => {
    it('should resolve conflicts using timestamp comparison', () => {
      const oldTime = new Date('2026-01-27T08:00:00.000Z').toISOString();
      const localTime = new Date('2026-01-27T10:00:00.000Z').toISOString();
      const cloudTime = new Date('2026-01-27T12:00:00.000Z').toISOString();

      const userId = 'conflict-user';

      // Create user with local timestamp
      db.prepare(
        `
        INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
        VALUES (?, ?, 'Local Name', 'cashier', '$2b$12$localhash', ?, ?)
      `
      ).run(userId, TEST_STORE_ID, oldTime, localTime);

      // Cloud sends update with newer timestamp
      db.prepare(
        `
        UPDATE users SET
          name = CASE WHEN ? > updated_at THEN ? ELSE name END,
          role = CASE WHEN ? > updated_at THEN ? ELSE role END,
          updated_at = CASE WHEN ? > updated_at THEN ? ELSE updated_at END
        WHERE user_id = ?
      `
      ).run(cloudTime, 'Cloud Name', cloudTime, 'shift_manager', cloudTime, cloudTime, userId);

      // Verify cloud data won (newer timestamp)
      const user = db.prepare('SELECT name, role FROM users WHERE user_id = ?').get(userId) as {
        name: string;
        role: string;
      };

      expect(user.name).toBe('Cloud Name');
      expect(user.role).toBe('shift_manager');
    });

    it('should reject stale cloud data (older timestamp)', () => {
      const oldTime = new Date('2026-01-27T08:00:00.000Z').toISOString();
      const localTime = new Date('2026-01-27T12:00:00.000Z').toISOString();
      const staleCloudTime = new Date('2026-01-27T10:00:00.000Z').toISOString();

      const userId = 'stale-conflict-user';

      // Create user with newer local timestamp
      db.prepare(
        `
        INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
        VALUES (?, ?, 'Local Name', 'shift_manager', '$2b$12$localhash', ?, ?)
      `
      ).run(userId, TEST_STORE_ID, oldTime, localTime);

      // Cloud sends update with OLDER timestamp
      db.prepare(
        `
        UPDATE users SET
          name = CASE WHEN ? > updated_at THEN ? ELSE name END,
          role = CASE WHEN ? > updated_at THEN ? ELSE role END,
          updated_at = CASE WHEN ? > updated_at THEN ? ELSE updated_at END
        WHERE user_id = ?
      `
      ).run(
        staleCloudTime,
        'Stale Cloud Name',
        staleCloudTime,
        'cashier',
        staleCloudTime,
        staleCloudTime,
        userId
      );

      // Verify local data preserved (newer timestamp)
      const user = db.prepare('SELECT name, role FROM users WHERE user_id = ?').get(userId) as {
        name: string;
        role: string;
      };

      expect(user.name).toBe('Local Name'); // Unchanged
      expect(user.role).toBe('shift_manager'); // Unchanged
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('Error Handling', () => {
    it('should rollback batch sync on partial failure', () => {
      const now = new Date().toISOString();

      const cloudUsers = [
        { user_id: 'batch-fail-1', name: 'User 1', role: 'cashier' },
        { user_id: 'batch-fail-2', name: 'User 2', role: 'invalid-role' }, // Will fail
        { user_id: 'batch-fail-3', name: 'User 3', role: 'cashier' },
      ];

      // Add role check constraint for test
      db.exec(`
        CREATE TABLE IF NOT EXISTS valid_roles (role TEXT PRIMARY KEY);
        INSERT INTO valid_roles VALUES ('cashier'), ('shift_manager'), ('store_manager');
      `);

      let transactionSucceeded = false;
      let errorOccurred = false;

      try {
        const transaction = db.transaction(() => {
          for (const cloudUser of cloudUsers) {
            // Validate role
            const validRole = db
              .prepare('SELECT 1 FROM valid_roles WHERE role = ?')
              .get(cloudUser.role);

            if (!validRole) {
              throw new Error(`Invalid role: ${cloudUser.role}`);
            }

            db.prepare(
              `
              INSERT INTO users (user_id, store_id, name, role, pin_hash, synced_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, '$2b$12$hash', ?, ?, ?)
            `
            ).run(cloudUser.user_id, TEST_STORE_ID, cloudUser.name, cloudUser.role, now, now, now);
          }
        });
        transaction();
        transactionSucceeded = true;
      } catch {
        errorOccurred = true;
      }

      expect(errorOccurred).toBe(true);
      expect(transactionSucceeded).toBe(false);

      // Verify no users were created (transaction rolled back)
      const users = db.prepare("SELECT user_id FROM users WHERE user_id LIKE 'batch-fail-%'").all();

      expect(users).toHaveLength(0);
    });

    it('should handle tenant isolation violations gracefully', () => {
      const now = new Date().toISOString();
      const WRONG_STORE_ID = 'wrong-store-id';

      // Cloud sends data for wrong store
      const cloudUserData = {
        user_id: 'tenant-violation-user',
        store_id: WRONG_STORE_ID, // Wrong store!
        name: 'Malicious User',
        role: 'cashier',
      };

      // Validation should catch this
      const storeExists = db
        .prepare('SELECT 1 FROM stores WHERE store_id = ?')
        .get(cloudUserData.store_id);

      expect(storeExists).toBeUndefined();

      // Should not insert user for non-existent store
      expect(() => {
        db.prepare(
          `
          INSERT INTO users (user_id, store_id, name, role, pin_hash, created_at, updated_at)
          VALUES (?, ?, ?, ?, '$2b$12$hash', ?, ?)
        `
        ).run(
          cloudUserData.user_id,
          cloudUserData.store_id,
          cloudUserData.name,
          cloudUserData.role,
          now,
          now
        );
      }).toThrow(/FOREIGN KEY constraint failed/);
    });
  });
});
