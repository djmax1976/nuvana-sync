/**
 * User Sync Service
 *
 * Handles synchronization of users from cloud to local database.
 * Users are always pulled from cloud (cloud is authoritative).
 * Local users without cloud_user_id are deactivated when removed from cloud.
 *
 * @module main/services/user-sync
 * @security SEC-001: PIN hashes pulled from cloud, never plaintext PINs
 * @security DB-006: Store-scoped for tenant isolation
 * @security SEC-017: Audit logging for user changes
 */

import { cloudApiService, type CloudUser, type StoreRole } from './cloud-api.service';
import { usersDAL, type CloudUserData, type UserRole } from '../dal/users.dal';
import { storesDAL } from '../dal/stores.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of user sync operation
 */
export interface UserSyncResult {
  synced: number;
  created: number;
  updated: number;
  deactivated: number;
  errors: string[];
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('user-sync');

// ============================================================================
// User Sync Service
// ============================================================================

/**
 * User Sync Service
 *
 * Implements one-way cloud -> local sync for users:
 * 1. Pull all active users from cloud
 * 2. Upsert each user locally (create or update)
 * 3. Deactivate local users no longer in cloud response
 *
 * Security considerations:
 * - SEC-001: PIN hashes come pre-hashed from cloud (bcrypt)
 * - Users authenticate locally against synced hashes
 * - Cloud is authoritative - local changes are overwritten
 */
export class UserSyncService {
  /**
   * Sync users from cloud
   * SEC-001: Receives bcrypt hashes, never plaintext PINs
   * SEC-017: Audit logs all user changes
   *
   * @returns Sync result with counts
   */
  async syncUsers(): Promise<UserSyncResult> {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      throw new Error('Store not configured');
    }

    const result: UserSyncResult = {
      synced: 0,
      created: 0,
      updated: 0,
      deactivated: 0,
      errors: [],
    };

    const storeId = store.store_id;

    log.info('Starting user sync', { storeId });

    try {
      // Step 1: Pull users from cloud
      const response = await cloudApiService.pullUsers();

      // Track cloud user IDs for deactivation check
      const cloudUserIds = new Set<string>();

      // Step 2: Upsert each user
      for (const cloudUser of response.users) {
        try {
          cloudUserIds.add(cloudUser.userId);

          const userData: CloudUserData = {
            cloud_user_id: cloudUser.userId,
            store_id: storeId,
            role: cloudUser.role,
            name: cloudUser.name,
            // SEC-001: PIN hash from cloud, already bcrypt hashed
            pin_hash: cloudUser.pinHash,
          };

          // Check if user exists
          const existing = usersDAL.findByCloudId(cloudUser.userId);

          if (existing) {
            // Update existing user
            usersDAL.upsertFromCloud(userData);
            result.updated++;

            // Handle active/inactive status
            if (cloudUser.active && !existing.active) {
              usersDAL.reactivate(existing.user_id);
              log.info('User reactivated from cloud', {
                userId: existing.user_id,
                name: cloudUser.name,
              });
            } else if (!cloudUser.active && existing.active) {
              usersDAL.deactivate(existing.user_id);
              log.info('User deactivated from cloud', {
                userId: existing.user_id,
                name: cloudUser.name,
              });
            }
          } else {
            // Create new user
            usersDAL.upsertFromCloud(userData);
            result.created++;

            // SEC-017: Audit log new user
            log.info('New user synced from cloud', {
              cloudUserId: cloudUser.userId,
              name: cloudUser.name,
              role: cloudUser.role,
            });
          }

          result.synced++;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`User ${cloudUser.userId}: ${message}`);
          log.error('Failed to sync user', {
            cloudUserId: cloudUser.userId,
            error: message,
          });
        }
      }

      // Step 3: Deactivate local users not in cloud response
      const localUsers = usersDAL.findActiveByStore(storeId);

      for (const localUser of localUsers) {
        // Only deactivate users that have a cloud_user_id
        // (locally created users without cloud_user_id are preserved)
        if (localUser.cloud_user_id && !cloudUserIds.has(localUser.cloud_user_id)) {
          try {
            usersDAL.deactivate(localUser.user_id);
            result.deactivated++;

            // SEC-017: Audit log deactivation
            log.info('User deactivated (removed from cloud)', {
              userId: localUser.user_id,
              cloudUserId: localUser.cloud_user_id,
              name: localUser.name,
            });
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            result.errors.push(`Deactivate ${localUser.user_id}: ${message}`);
            log.error('Failed to deactivate user', {
              userId: localUser.user_id,
              error: message,
            });
          }
        }
      }

      log.info('User sync completed', {
        synced: result.synced,
        created: result.created,
        updated: result.updated,
        deactivated: result.deactivated,
        errors: result.errors.length,
      });

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('User sync failed', { error: message });
      throw error;
    }
  }

  /**
   * Check if users need to be synced
   * Returns true if no synced users exist locally
   *
   * @returns true if sync is needed
   */
  needsSync(): boolean {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return false;
    }

    const users = usersDAL.findActiveByStore(store.store_id);

    // If no users with cloud_user_id exist, we need to sync
    return !users.some((u) => u.cloud_user_id !== null);
  }

  /**
   * Get count of synced users for a store
   *
   * @returns Count of users with cloud_user_id
   */
  getSyncedUserCount(): number {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return 0;
    }

    const users = usersDAL.findActiveByStore(store.store_id);
    return users.filter((u) => u.cloud_user_id !== null).length;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for user sync operations
 */
export const userSyncService = new UserSyncService();
