/**
 * User Sync Service
 *
 * Handles synchronization of users from cloud to local database.
 * Users are always pulled from cloud (cloud is authoritative).
 * Local users without cloud_user_id are deactivated when removed from cloud.
 *
 * Enterprise-grade implementation:
 * - Batch operations to eliminate N+1 queries
 * - Transaction-based updates for atomicity
 * - Proper tenant isolation validation
 * - Comprehensive audit logging
 *
 * @module main/services/user-sync
 * @security SEC-001: PIN hashes pulled from cloud, never plaintext PINs
 * @security DB-006: Store-scoped for tenant isolation with validation
 * @security SEC-017: Audit logging for user changes
 */

import { cloudApiService, type CloudUser } from './cloud-api.service';
import { usersDAL, type CloudUserData, type User } from '../dal/users.dal';
import { storesDAL } from '../dal/stores.dal';
import { syncQueueDAL, type SyncApiContext } from '../dal/sync-queue.dal';
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
  reactivated: number;
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
 * Enterprise-grade implementation of one-way cloud -> local sync for users:
 * 1. Pull all users from cloud (unified endpoint with proper roles)
 * 2. Batch upsert users locally (eliminates N+1 queries)
 * 3. Batch deactivate local users no longer in cloud response
 * 4. Handle status changes (active/inactive) with audit logging
 *
 * Security considerations:
 * - SEC-001: PIN hashes come pre-hashed from cloud (bcrypt)
 * - DB-006: Store ID validation prevents cross-tenant data leakage
 * - SEC-017: All user changes are audit logged
 * - Cloud is authoritative - local changes are overwritten
 *
 * Performance considerations:
 * - Single batch query to find existing users (no N+1)
 * - Transaction-based upserts for atomicity
 * - Batch deactivation in single operation
 */
export class UserSyncService {
  /**
   * Sync users from cloud
   * SEC-001: Receives bcrypt hashes, never plaintext PINs
   * SEC-017: Audit logs all user changes
   * DB-006: Validates store_id for tenant isolation
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
      reactivated: 0,
      errors: [],
    };

    const storeId = store.store_id;

    log.info('Starting user sync', { storeId });

    // Create PULL queue entry for sync monitor tracking
    const pullQueueItem = syncQueueDAL.enqueue({
      store_id: storeId,
      entity_type: 'user',
      entity_id: `pull-${Date.now()}`,
      operation: 'UPDATE',
      payload: { action: 'pull_users', timestamp: new Date().toISOString() },
      sync_direction: 'PULL',
    });

    const apiEndpoint = '/api/v1/sync/users';

    try {
      // Step 1: Pull users from cloud (unified endpoint with proper roles)
      const response = await cloudApiService.pullUsers();

      if (response.users.length === 0) {
        log.info('No users to sync from cloud');
        return result;
      }

      // Step 2: Separate active and inactive users
      const activeUsers = response.users.filter((u) => u.active);
      const inactiveUsers = response.users.filter((u) => !u.active);

      // Track cloud user IDs for deactivation check
      const activeCloudIds = new Set<string>(activeUsers.map((u) => u.userId));
      const allCloudIds = new Set<string>(response.users.map((u) => u.userId));

      // Step 3: Batch upsert active users
      if (activeUsers.length > 0) {
        const userData: CloudUserData[] = activeUsers.map((cloudUser) => ({
          cloud_user_id: cloudUser.userId,
          store_id: storeId, // DB-006: Always use configured store ID
          role: cloudUser.role,
          name: cloudUser.name,
          pin_hash: cloudUser.pinHash, // SEC-001: Already bcrypt hashed
        }));

        try {
          const upsertResult = usersDAL.batchUpsertFromCloud(userData, storeId);
          result.created += upsertResult.created;
          result.updated += upsertResult.updated;
          result.synced += upsertResult.created + upsertResult.updated;
          result.errors.push(...upsertResult.errors);

          // SEC-017: Audit log summary
          log.info('Active users synced', {
            created: upsertResult.created,
            updated: upsertResult.updated,
            errors: upsertResult.errors.length,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`Batch upsert failed: ${message}`);
          log.error('Batch upsert failed', { error: message });
        }
      }

      // Step 4: Handle users marked inactive in cloud
      for (const cloudUser of inactiveUsers) {
        try {
          const existing = usersDAL.findByCloudId(cloudUser.userId);
          if (existing && existing.active) {
            usersDAL.deactivate(existing.user_id);
            result.deactivated++;
            log.info('User deactivated from cloud', {
              userId: existing.user_id,
              cloudUserId: cloudUser.userId,
              name: cloudUser.name,
            });
          }
          result.synced++;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`Deactivate ${cloudUser.userId}: ${message}`);
        }
      }

      // Step 5: Handle reactivations (user was inactive locally but active in cloud)
      const existingUsersMap = usersDAL.findByCloudIds(Array.from(activeCloudIds));
      for (const cloudUser of activeUsers) {
        const existing = existingUsersMap.get(cloudUser.userId);
        if (existing && !existing.active) {
          try {
            usersDAL.reactivate(existing.user_id);
            result.reactivated++;
            log.info('User reactivated from cloud', {
              userId: existing.user_id,
              cloudUserId: cloudUser.userId,
              name: cloudUser.name,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            result.errors.push(`Reactivate ${existing.user_id}: ${message}`);
          }
        }
      }

      // Step 6: Batch deactivate local users not in cloud response
      // (users with cloud_user_id that are no longer returned by cloud)
      try {
        const deactivatedCount = usersDAL.batchDeactivateNotInCloudIds(storeId, allCloudIds);
        result.deactivated += deactivatedCount;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Batch deactivate failed: ${message}`);
        log.error('Batch deactivate failed', { error: message });
      }

      // SEC-017: Final audit log
      log.info('User sync completed', {
        synced: result.synced,
        created: result.created,
        updated: result.updated,
        deactivated: result.deactivated,
        reactivated: result.reactivated,
        errors: result.errors.length,
      });

      // Mark PULL queue item as synced with API context
      const apiContext: SyncApiContext = {
        api_endpoint: apiEndpoint,
        http_status: 200,
        response_body: JSON.stringify({
          pulled: result.synced,
          created: result.created,
          updated: result.updated,
          deactivated: result.deactivated,
          errors: result.errors.length,
        }),
      };
      syncQueueDAL.markSynced(pullQueueItem.id, apiContext);

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('User sync failed', { error: message });

      // Record PULL failure in sync queue with API context
      const httpStatus = this.extractHttpStatusFromError(message);
      const apiContext: SyncApiContext = {
        api_endpoint: apiEndpoint,
        http_status: httpStatus,
        response_body: message.substring(0, 500),
      };
      syncQueueDAL.incrementAttempts(pullQueueItem.id, message, apiContext);

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

  /**
   * Extract HTTP status code from error message
   * Looks for common patterns like "404", "500", "timeout", etc.
   *
   * @param message - Error message to parse
   * @returns HTTP status code or 0 if not found
   */
  private extractHttpStatusFromError(message: string): number {
    // Look for explicit HTTP status codes
    const statusMatch = message.match(/\b(4\d{2}|5\d{2})\b/);
    if (statusMatch) {
      return parseInt(statusMatch[1], 10);
    }

    // Map common error patterns to status codes
    if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
      return 408; // Request Timeout
    }
    if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
      return 503; // Service Unavailable
    }
    if (message.includes('unauthorized') || message.includes('Unauthorized')) {
      return 401;
    }
    if (message.includes('forbidden') || message.includes('Forbidden')) {
      return 403;
    }

    return 0; // Unknown
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for user sync operations
 */
export const userSyncService = new UserSyncService();
