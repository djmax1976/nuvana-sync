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
import { createHash } from 'crypto';

// ============================================================================
// Constants
// ============================================================================

/**
 * Bcrypt cost factor
 * SEC-001: Strong cost factor for secure password hashing
 * Tuned for ~250ms hash time on production hardware
 */
const BCRYPT_ROUNDS = 12;

/**
 * Compute SHA-256 fingerprint of plain PIN for cloud uniqueness validation
 * This is computed BEFORE bcrypt hashing and sent to cloud for duplicate detection
 *
 * @param pin - Plain text PIN
 * @returns SHA-256 hex digest (64 characters)
 */
function computePinFingerprint(pin: string): string {
  return createHash('sha256').update(pin).digest('hex');
}

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
  sha256_pin_fingerprint: string | null; // SHA-256 of plain PIN for cloud uniqueness validation
  active: number; // SQLite boolean (0 or 1)
  last_login_at: string | null;
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
 * After cloud_id consolidation, user_id IS the cloud ID
 */
export interface CloudUserData {
  user_id: string;
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

    // Compute SHA-256 fingerprint for cloud PIN uniqueness validation
    // This must be computed BEFORE bcrypt hashing while we have the plain PIN
    const pinFingerprint = computePinFingerprint(data.pin);

    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      INSERT INTO users (
        user_id, store_id, role, name, pin_hash, sha256_pin_fingerprint, active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    stmt.run(userId, data.store_id, data.role, data.name, pinHash, pinFingerprint, now, now);

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

      // Compute SHA-256 fingerprint for cloud PIN uniqueness validation
      const pinFingerprint = computePinFingerprint(data.pin);
      updates.push('sha256_pin_fingerprint = ?');
      params.push(pinFingerprint);
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
   * Check if a PIN is already in use by another active user in the store
   *
   * Since PINs are bcrypt hashed, we must iterate through all active users
   * and compare the PIN against each hash. This is O(n) but necessary for security.
   *
   * SEC-001: Bcrypt comparison (timing-safe)
   * DB-006: Store-scoped query for tenant isolation
   * API-001: Business rule validation - PIN uniqueness within store
   *
   * @param storeId - Store identifier for tenant isolation
   * @param pin - Plaintext PIN to check
   * @param excludeUserId - Optional user ID to exclude (for PIN updates)
   * @returns User with matching PIN if found, undefined if PIN is available
   */
  async isPinInUse(
    storeId: string,
    pin: string,
    excludeUserId?: string
  ): Promise<User | undefined> {
    // DB-006: Get all active users for this store only
    const activeUsers = this.findActiveByStore(storeId);

    // SEC-001: Compare against each user's bcrypt hash (timing-safe)
    for (const user of activeUsers) {
      // Skip the user being updated (for PIN change scenarios)
      if (excludeUserId && user.user_id === excludeUserId) {
        continue;
      }

      const isMatch = await bcrypt.compare(pin, user.pin_hash);
      if (isMatch) {
        log.warn('PIN collision detected', {
          storeId,
          existingUserId: user.user_id,
          excludeUserId,
        });
        return user;
      }
    }

    return undefined;
  }

  /**
   * Find a user by their PIN within a store
   *
   * Since PINs are bcrypt hashed, we must iterate through all active users
   * and compare the PIN against each hash until we find a match.
   *
   * SEC-001: Bcrypt comparison (timing-safe)
   * DB-006: Store-scoped query for tenant isolation
   *
   * @param storeId - Store identifier
   * @param pin - PIN to verify
   * @returns User if found and PIN matches, undefined otherwise
   */
  async findByPin(storeId: string, pin: string): Promise<User | undefined> {
    // Get all active users for this store
    const activeUsers = this.findActiveByStore(storeId);

    // Try to match PIN against each user's hash
    for (const user of activeUsers) {
      const isMatch = await bcrypt.compare(pin, user.pin_hash);
      if (isMatch) {
        // Update last login timestamp
        this.updateLastLogin(user.user_id);
        log.info('User found by PIN', { userId: user.user_id, storeId });
        return user;
      }
    }

    log.warn('No user found matching PIN', { storeId, activeUserCount: activeUsers.length });
    return undefined;
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
   * Find multiple users by user IDs (batch operation)
   * Enterprise-grade: Eliminates N+1 queries during sync
   * SEC-006: Parameterized IN clause with placeholders
   * Performance: Single query for all user IDs
   *
   * Note: After cloud_id consolidation, user_id IS the cloud ID
   *
   * @param userIds - Array of user identifiers (which are now cloud IDs)
   * @returns Map of user_id -> User for efficient lookup
   */
  findByUserIds(userIds: string[]): Map<string, User> {
    const result = new Map<string, User>();

    if (userIds.length === 0) {
      return result;
    }

    // SEC-006: Batch in chunks to avoid SQLite parameter limits (max ~999)
    const CHUNK_SIZE = 500;
    for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
      const chunk = userIds.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(', ');

      const stmt = this.db.prepare(`
        SELECT * FROM users WHERE user_id IN (${placeholders})
      `);

      const users = stmt.all(...chunk) as User[];

      for (const user of users) {
        result.set(user.user_id, user);
      }
    }

    log.debug('Batch lookup by user IDs', {
      requested: userIds.length,
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
   * Note: After cloud_id consolidation, user_id IS the cloud ID
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
        const errorMsg = `Store ID mismatch for user ${user.user_id}: expected ${expectedStoreId}, got ${user.store_id}`;
        log.error('Tenant isolation violation in batch upsert', {
          userId: user.user_id,
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
    const userIds = users.map((u) => u.user_id);
    const existingUsers = this.findByUserIds(userIds);

    // Execute all upserts in single transaction for atomicity
    this.withTransaction(() => {
      const now = this.now();

      const insertStmt = this.db.prepare(`
        INSERT INTO users (
          user_id, store_id, role, name, pin_hash, active,
          synced_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
      `);

      const updateStmt = this.db.prepare(`
        UPDATE users SET
          role = ?,
          name = ?,
          pin_hash = ?,
          synced_at = ?,
          updated_at = ?
        WHERE user_id = ?
      `);

      for (const userData of users) {
        try {
          const existing = existingUsers.get(userData.user_id);

          if (existing) {
            // Update existing user
            updateStmt.run(
              userData.role,
              userData.name,
              userData.pin_hash,
              now,
              now,
              userData.user_id
            );
            result.updated++;
          } else {
            // Create new user - user_id is the cloud ID
            insertStmt.run(
              userData.user_id,
              userData.store_id,
              userData.role,
              userData.name,
              userData.pin_hash,
              now,
              now,
              now
            );
            result.created++;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`User ${userData.user_id}: ${message}`);
          log.error('Failed to upsert user in batch', {
            userId: userData.user_id,
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
   * Batch deactivate users not in provided user IDs
   * Enterprise-grade: Single query for deactivation
   * SEC-006: Parameterized query
   * DB-006: Store-scoped for tenant isolation
   *
   * Note: After cloud_id consolidation, user_id IS the cloud ID
   *
   * @param storeId - Store ID for tenant isolation
   * @param activeUserIds - Set of user IDs (cloud IDs) that should remain active
   * @returns Number of users deactivated
   */
  batchDeactivateNotInUserIds(storeId: string, activeUserIds: Set<string>): number {
    // Get all active users for this store
    const stmt = this.db.prepare(`
      SELECT user_id FROM users
      WHERE store_id = ? AND active = 1
    `);

    const activeUsers = stmt.all(storeId) as Array<{ user_id: string }>;

    // Find users to deactivate (not in active set from cloud)
    const toDeactivate = activeUsers.filter((u) => !activeUserIds.has(u.user_id));

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
   * Creates if not exists, updates if exists (by user_id)
   * SEC-006: Parameterized queries
   *
   * Note: After cloud_id consolidation, user_id IS the cloud ID
   *
   * @param data - Cloud user data
   * @returns Upserted user
   */
  upsertFromCloud(data: CloudUserData): User {
    const existing = this.findById(data.user_id);
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
        WHERE user_id = ?
      `);

      stmt.run(data.role, data.name, data.pin_hash, now, now, data.user_id);

      log.info('User updated from cloud', { userId: data.user_id });
      const updated = this.findById(data.user_id);
      if (!updated) {
        throw new Error(`Failed to retrieve updated user from cloud: ${data.user_id}`);
      }
      return updated;
    }

    // Create new user - user_id is the cloud ID
    const stmt = this.db.prepare(`
      INSERT INTO users (
        user_id, store_id, role, name, pin_hash, active,
        synced_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    `);

    stmt.run(data.user_id, data.store_id, data.role, data.name, data.pin_hash, now, now, now);

    log.info('User created from cloud', {
      userId: data.user_id,
    });

    const created = this.findById(data.user_id);
    if (!created) {
      throw new Error(`Failed to retrieve created user from cloud: ${data.user_id}`);
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
