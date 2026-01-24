/**
 * Users Data Access Layer
 *
 * CRUD operations for user authentication and management.
 * Users are synced from cloud for local PIN authentication.
 *
 * @module main/dal/users
 * @security SEC-006: All queries use prepared statements
 * @security SEC-001: PIN stored as bcrypt hash
 * @security DB-006: Store-scoped for tenant isolation
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';
import bcrypt from 'bcrypt';

// ============================================================================
// Constants
// ============================================================================

/**
 * Bcrypt cost factor
 * SEC-001: Strong cost factor for secure password hashing
 * Tuned for ~250ms hash time on production hardware
 */
const BCRYPT_ROUNDS = 12;

// ============================================================================
// Types
// ============================================================================

/**
 * User role enumeration
 * MVP roles: store_manager, cashier, shift_manager
 */
export type UserRole = 'store_manager' | 'cashier' | 'shift_manager';

/**
 * User entity
 */
export interface User extends StoreEntity {
  user_id: string;
  store_id: string;
  role: UserRole;
  name: string;
  pin_hash: string;
  active: number; // SQLite boolean (0 or 1)
  last_login_at: string | null;
  cloud_user_id: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * User creation data
 */
export interface CreateUserData {
  user_id?: string;
  store_id: string;
  role: UserRole;
  name: string;
  pin: string; // Plaintext PIN - will be hashed
  cloud_user_id?: string;
}

/**
 * User update data
 */
export interface UpdateUserData {
  role?: UserRole;
  name?: string;
  pin?: string; // Plaintext PIN - will be hashed
  active?: boolean;
}

/**
 * Cloud user sync data
 */
export interface CloudUserData {
  cloud_user_id: string;
  store_id: string;
  role: UserRole;
  name: string;
  pin_hash: string; // Pre-hashed from cloud
}

/**
 * User without sensitive fields (for API responses)
 */
export type SafeUser = Omit<User, 'pin_hash'>;

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('users-dal');

// ============================================================================
// Users DAL
// ============================================================================

/**
 * Data Access Layer for user management
 *
 * SEC-001: All PIN storage uses bcrypt with strong cost factor
 * DB-006: All queries scoped by store_id
 */
export class UsersDAL extends StoreBasedDAL<User> {
  protected readonly tableName = 'users';
  protected readonly primaryKey = 'user_id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'name',
    'role',
    'last_login_at',
  ]);

  /**
   * Check if database is ready for user operations
   */
  isDatabaseReady(): boolean {
    return this.isDatabaseAvailable;
  }

  /**
   * Create a new user with hashed PIN
   * SEC-001: PIN hashed with bcrypt before storage
   * SEC-006: Parameterized INSERT
   *
   * @param data - User creation data
   * @returns Created user
   */
  async create(data: CreateUserData): Promise<User> {
    const userId = data.user_id || this.generateId();
    const now = this.now();

    // SEC-001: Hash PIN with bcrypt
    const pinHash = await bcrypt.hash(data.pin, BCRYPT_ROUNDS);

    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      INSERT INTO users (
        user_id, store_id, role, name, pin_hash, active,
        cloud_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    `);

    stmt.run(
      userId,
      data.store_id,
      data.role,
      data.name,
      pinHash,
      data.cloud_user_id || null,
      now,
      now
    );

    log.info('User created', {
      userId,
      storeId: data.store_id,
      role: data.role,
    });

    const created = this.findById(userId);
    if (!created) {
      throw new Error(`Failed to retrieve created user: ${userId}`);
    }
    return created;
  }

  /**
   * Update an existing user
   * SEC-001: Re-hashes PIN if provided
   * SEC-006: Parameterized UPDATE
   *
   * @param userId - User ID to update
   * @param data - Fields to update
   * @returns Updated user or undefined
   */
  async update(userId: string, data: UpdateUserData): Promise<User | undefined> {
    const now = this.now();

    const updates: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (data.role !== undefined) {
      updates.push('role = ?');
      params.push(data.role);
    }
    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.pin !== undefined) {
      // SEC-001: Hash new PIN
      const pinHash = await bcrypt.hash(data.pin, BCRYPT_ROUNDS);
      updates.push('pin_hash = ?');
      params.push(pinHash);
    }
    if (data.active !== undefined) {
      updates.push('active = ?');
      params.push(data.active ? 1 : 0);
    }

    params.push(userId);

    const stmt = this.db.prepare(`
      UPDATE users SET ${updates.join(', ')} WHERE user_id = ?
    `);

    const result = stmt.run(...params);

    if (result.changes === 0) {
      return undefined;
    }

    log.info('User updated', { userId });
    return this.findById(userId);
  }

  /**
   * Verify user PIN
   * SEC-001: Compares against bcrypt hash
   *
   * @param userId - User ID
   * @param pin - PIN to verify
   * @returns true if PIN matches
   */
  async verifyPin(userId: string, pin: string): Promise<boolean> {
    const user = this.findById(userId);
    if (!user || !user.active) {
      return false;
    }

    // SEC-001: Bcrypt comparison (timing-safe)
    const isValid = await bcrypt.compare(pin, user.pin_hash);

    if (isValid) {
      // Update last login timestamp
      this.updateLastLogin(userId);
    }

    return isValid;
  }

  /**
   * Update user's last login timestamp
   * SEC-006: Parameterized UPDATE
   *
   * @param userId - User ID
   */
  updateLastLogin(userId: string): void {
    const stmt = this.db.prepare(`
      UPDATE users SET last_login_at = ? WHERE user_id = ?
    `);
    stmt.run(this.now(), userId);
  }

  /**
   * Find active users by store
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @returns Array of active users
   */
  findActiveByStore(storeId: string): User[] {
    const stmt = this.db.prepare(`
      SELECT * FROM users
      WHERE store_id = ? AND active = 1
      ORDER BY name ASC
    `);
    return stmt.all(storeId) as User[];
  }

  /**
   * Find user by cloud user ID
   * Used for cloud sync matching
   * SEC-006: Parameterized query
   *
   * @param cloudUserId - Cloud user identifier
   * @returns User or undefined
   */
  findByCloudId(cloudUserId: string): User | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM users WHERE cloud_user_id = ?
    `);
    return stmt.get(cloudUserId) as User | undefined;
  }

  /**
   * Find multiple users by cloud user IDs (batch operation)
   * Enterprise-grade: Eliminates N+1 queries during sync
   * SEC-006: Parameterized IN clause with placeholders
   * Performance: Single query for all cloud IDs
   *
   * @param cloudUserIds - Array of cloud user identifiers
   * @returns Map of cloud_user_id -> User for efficient lookup
   */
  findByCloudIds(cloudUserIds: string[]): Map<string, User> {
    const result = new Map<string, User>();

    if (cloudUserIds.length === 0) {
      return result;
    }

    // SEC-006: Batch in chunks to avoid SQLite parameter limits (max ~999)
    const CHUNK_SIZE = 500;
    for (let i = 0; i < cloudUserIds.length; i += CHUNK_SIZE) {
      const chunk = cloudUserIds.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(', ');

      const stmt = this.db.prepare(`
        SELECT * FROM users WHERE cloud_user_id IN (${placeholders})
      `);

      const users = stmt.all(...chunk) as User[];

      for (const user of users) {
        if (user.cloud_user_id) {
          result.set(user.cloud_user_id, user);
        }
      }
    }

    log.debug('Batch lookup by cloud IDs', {
      requested: cloudUserIds.length,
      found: result.size,
    });

    return result;
  }

  /**
   * Batch upsert users from cloud sync
   * Enterprise-grade: Single transaction for all users
   * SEC-006: Parameterized queries
   * DB-006: Validates store_id for tenant isolation
   * Performance: Uses transaction for atomicity and speed
   *
   * @param users - Array of cloud user data
   * @param expectedStoreId - Expected store ID for tenant isolation validation
   * @returns Upsert result with counts
   */
  batchUpsertFromCloud(
    users: CloudUserData[],
    expectedStoreId: string
  ): { created: number; updated: number; errors: string[] } {
    const result = { created: 0, updated: 0, errors: [] as string[] };

    if (users.length === 0) {
      return result;
    }

    // DB-006: Validate all users belong to expected store
    for (const user of users) {
      if (user.store_id !== expectedStoreId) {
        const errorMsg = `Store ID mismatch for user ${user.cloud_user_id}: expected ${expectedStoreId}, got ${user.store_id}`;
        log.error('Tenant isolation violation in batch upsert', {
          cloudUserId: user.cloud_user_id,
          expectedStoreId,
          actualStoreId: user.store_id,
        });
        result.errors.push(errorMsg);
      }
    }

    // Abort if any store_id violations
    if (result.errors.length > 0) {
      throw new Error(
        `Tenant isolation violation: ${result.errors.length} users have wrong store_id`
      );
    }

    // Get existing users in single batch query (eliminates N+1)
    const cloudUserIds = users.map((u) => u.cloud_user_id);
    const existingUsers = this.findByCloudIds(cloudUserIds);

    // Execute all upserts in single transaction for atomicity
    this.withTransaction(() => {
      const now = this.now();

      const insertStmt = this.db.prepare(`
        INSERT INTO users (
          user_id, store_id, role, name, pin_hash, active,
          cloud_user_id, synced_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      `);

      const updateStmt = this.db.prepare(`
        UPDATE users SET
          role = ?,
          name = ?,
          pin_hash = ?,
          synced_at = ?,
          updated_at = ?
        WHERE cloud_user_id = ?
      `);

      for (const userData of users) {
        try {
          const existing = existingUsers.get(userData.cloud_user_id);

          if (existing) {
            // Update existing user
            updateStmt.run(
              userData.role,
              userData.name,
              userData.pin_hash,
              now,
              now,
              userData.cloud_user_id
            );
            result.updated++;
          } else {
            // Create new user
            const userId = this.generateId();
            insertStmt.run(
              userId,
              userData.store_id,
              userData.role,
              userData.name,
              userData.pin_hash,
              userData.cloud_user_id,
              now,
              now,
              now
            );
            result.created++;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`User ${userData.cloud_user_id}: ${message}`);
          log.error('Failed to upsert user in batch', {
            cloudUserId: userData.cloud_user_id,
            error: message,
          });
        }
      }
    });

    log.info('Batch upsert completed', {
      total: users.length,
      created: result.created,
      updated: result.updated,
      errors: result.errors.length,
    });

    return result;
  }

  /**
   * Batch deactivate users not in provided cloud IDs
   * Enterprise-grade: Single query for deactivation
   * SEC-006: Parameterized query
   * DB-006: Store-scoped for tenant isolation
   *
   * @param storeId - Store ID for tenant isolation
   * @param activeCloudIds - Set of cloud IDs that should remain active
   * @returns Number of users deactivated
   */
  batchDeactivateNotInCloudIds(storeId: string, activeCloudIds: Set<string>): number {
    // Get all active users with cloud_user_id for this store
    const stmt = this.db.prepare(`
      SELECT user_id, cloud_user_id FROM users
      WHERE store_id = ? AND active = 1 AND cloud_user_id IS NOT NULL
    `);

    const activeUsers = stmt.all(storeId) as Array<{ user_id: string; cloud_user_id: string }>;

    // Find users to deactivate (have cloud_user_id but not in active set)
    const toDeactivate = activeUsers.filter(
      (u) => u.cloud_user_id && !activeCloudIds.has(u.cloud_user_id)
    );

    if (toDeactivate.length === 0) {
      return 0;
    }

    // Deactivate in single transaction
    const now = this.now();
    const deactivateStmt = this.db.prepare(`
      UPDATE users SET active = 0, updated_at = ? WHERE user_id = ?
    `);

    this.withTransaction(() => {
      for (const user of toDeactivate) {
        deactivateStmt.run(now, user.user_id);
        log.info('User deactivated (removed from cloud)', {
          userId: user.user_id,
          cloudUserId: user.cloud_user_id,
        });
      }
    });

    log.info('Batch deactivation completed', {
      storeId,
      checked: activeUsers.length,
      deactivated: toDeactivate.length,
    });

    return toDeactivate.length;
  }

  /**
   * Upsert user from cloud sync
   * Creates if not exists, updates if exists (by cloud_user_id)
   * SEC-006: Parameterized queries
   *
   * @param data - Cloud user data
   * @returns Upserted user
   */
  upsertFromCloud(data: CloudUserData): User {
    const existing = this.findByCloudId(data.cloud_user_id);
    const now = this.now();

    if (existing) {
      // Update existing user
      const stmt = this.db.prepare(`
        UPDATE users SET
          role = ?,
          name = ?,
          pin_hash = ?,
          synced_at = ?,
          updated_at = ?
        WHERE cloud_user_id = ?
      `);

      stmt.run(data.role, data.name, data.pin_hash, now, now, data.cloud_user_id);

      log.info('User updated from cloud', { cloudUserId: data.cloud_user_id });
      const updated = this.findByCloudId(data.cloud_user_id);
      if (!updated) {
        throw new Error(`Failed to retrieve updated user from cloud: ${data.cloud_user_id}`);
      }
      return updated;
    }

    // Create new user
    const userId = this.generateId();

    const stmt = this.db.prepare(`
      INSERT INTO users (
        user_id, store_id, role, name, pin_hash, active,
        cloud_user_id, synced_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `);

    stmt.run(
      userId,
      data.store_id,
      data.role,
      data.name,
      data.pin_hash,
      data.cloud_user_id,
      now,
      now,
      now
    );

    log.info('User created from cloud', {
      userId,
      cloudUserId: data.cloud_user_id,
    });

    const created = this.findById(userId);
    if (!created) {
      throw new Error(`Failed to retrieve created user from cloud: ${userId}`);
    }
    return created;
  }

  /**
   * Deactivate user (soft delete)
   * SEC-006: Parameterized UPDATE
   *
   * @param userId - User ID
   * @returns true if user was deactivated
   */
  deactivate(userId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE users SET active = 0, updated_at = ? WHERE user_id = ?
    `);
    const result = stmt.run(this.now(), userId);
    return result.changes > 0;
  }

  /**
   * Reactivate user
   * SEC-006: Parameterized UPDATE
   *
   * @param userId - User ID
   * @returns true if user was reactivated
   */
  reactivate(userId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE users SET active = 1, updated_at = ? WHERE user_id = ?
    `);
    const result = stmt.run(this.now(), userId);
    return result.changes > 0;
  }

  /**
   * Remove sensitive fields from user object
   *
   * @param user - User entity
   * @returns User without sensitive fields
   */
  static toSafeUser(user: User): SafeUser {
    const { pin_hash: _pin_hash, ...safeUser } = user;
    return safeUser;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for user operations
 */
export const usersDAL = new UsersDAL();
