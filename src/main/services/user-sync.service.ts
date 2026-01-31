/**
 * User Sync Service
 *
 * Handles synchronization of users from cloud to local database.
 * Users are always pulled from cloud (cloud is authoritative).
 * After cloud_id consolidation, user_id IS the cloud ID.
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
import { syncQueueDAL, type SyncApiContext, type ErrorCategory } from '../dal/sync-queue.dal';
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

    // REUSE existing PULL tracking item if one exists, otherwise create new
    // This allows error history to accumulate on a single item for DLQ visibility
    // instead of creating garbage tracking items every cycle
    let pullQueueItem = syncQueueDAL.getPendingPullItem(storeId, 'user');
    if (!pullQueueItem) {
      pullQueueItem = syncQueueDAL.enqueue({
        store_id: storeId,
        entity_type: 'user',
        entity_id: `pull-${Date.now()}`,
        operation: 'UPDATE',
        payload: { action: 'pull_users', timestamp: new Date().toISOString() },
        sync_direction: 'PULL',
      });
    }

    const apiEndpoint = '/api/v1/sync/users';

    try {
      // Step 1: Pull users from cloud (unified endpoint with proper roles)
      const response = await cloudApiService.pullUsers();

      // Defensive: Handle undefined/null users array
      const users = response?.users || [];

      if (users.length === 0) {
        log.info('No users to sync from cloud');
        // BUG FIX: Mark PULL queue item as synced even when no users returned
        // Previously this early return left queue items permanently pending
        const apiContext: SyncApiContext = {
          api_endpoint: apiEndpoint,
          http_status: 200,
          response_body: JSON.stringify({ synced: 0, message: 'No users to sync' }),
        };
        syncQueueDAL.markSynced(pullQueueItem.id, apiContext);
        return result;
      }

      // Step 2: Separate active and inactive users
      const activeUsers = users.filter((u) => u.active);
      const inactiveUsers = users.filter((u) => !u.active);

      // Track cloud user IDs for deactivation check
      const activeCloudIds = new Set<string>(activeUsers.map((u) => u.userId));
      const allCloudIds = new Set<string>(users.map((u) => u.userId));

      // Step 3: Batch upsert active users
      // Note: After cloud_id consolidation, user_id IS the cloud ID
      if (activeUsers.length > 0) {
        const userData: CloudUserData[] = activeUsers.map((cloudUser) => ({
          user_id: cloudUser.userId, // user_id IS the cloud ID after consolidation
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
      // Note: After cloud_id consolidation, user_id IS the cloud userId
      for (const cloudUser of inactiveUsers) {
        try {
          const existing = usersDAL.findById(cloudUser.userId);
          if (existing && existing.active) {
            usersDAL.deactivate(existing.user_id);
            result.deactivated++;
            log.info('User deactivated from cloud', {
              userId: existing.user_id,
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
      // Note: After cloud_id consolidation, user_id IS the cloud userId
      const existingUsersMap = usersDAL.findByUserIds(Array.from(activeCloudIds));
      for (const cloudUser of activeUsers) {
        const existing = existingUsersMap.get(cloudUser.userId);
        if (existing && !existing.active) {
          try {
            usersDAL.reactivate(existing.user_id);
            result.reactivated++;
            log.info('User reactivated from cloud', {
              userId: existing.user_id,
              name: cloudUser.name,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            result.errors.push(`Reactivate ${existing.user_id}: ${message}`);
          }
        }
      }

      // Step 6: Batch deactivate local users not in cloud response
      // Note: After cloud_id consolidation, user_id IS the cloud ID
      try {
        const deactivatedCount = usersDAL.batchDeactivateNotInUserIds(storeId, allCloudIds);
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

      // Record failure - item will be retried on next sync cycle
      // Only permanent errors (4xx) should eventually go to DLQ via normal retry exhaustion
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
   * Note: After cloud_id consolidation, all users have user_id which IS the cloud ID.
   * The presence of synced_at indicates the user was synced from cloud.
   *
   * @returns true if sync is needed
   */
  needsSync(): boolean {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return false;
    }

    const users = usersDAL.findActiveByStore(store.store_id);

    // If no users with synced_at exist, we need to sync
    // (synced_at indicates the user was pulled from cloud)
    return !users.some((u) => u.synced_at !== null);
  }

  /**
   * Get count of synced users for a store
   *
   * Note: After cloud_id consolidation, all users have user_id which IS the cloud ID.
   * The presence of synced_at indicates the user was synced from cloud.
   *
   * @returns Count of users synced from cloud
   */
  getSyncedUserCount(): number {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return 0;
    }

    const users = usersDAL.findActiveByStore(store.store_id);
    // synced_at indicates the user was pulled from cloud
    return users.filter((u) => u.synced_at !== null).length;
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

  /**
   * Classify error for DLQ routing
   *
   * Error categories per ERR-007:
   * - PERMANENT: 4xx errors (except 429) - client errors, won't succeed on retry
   * - TRANSIENT: 5xx, network errors, timeouts - may succeed on retry
   * - STRUCTURAL: Missing required fields, invalid payload
   * - UNKNOWN: Unclassified errors
   *
   * Note: For Users PULL sync, all errors go to DLQ immediately regardless of
   * category. Category is for troubleshooting visibility only.
   *
   * @param httpStatus - HTTP status code (0 if unknown)
   * @param message - Error message for pattern matching
   * @returns Error category for DLQ
   */
  private classifyError(httpStatus: number, message: string): ErrorCategory {
    // 5xx server errors and rate limits are transient
    if (httpStatus >= 500 || httpStatus === 429) {
      return 'TRANSIENT';
    }

    // 408 Request Timeout is transient (network issue, may succeed on retry)
    if (httpStatus === 408) {
      return 'TRANSIENT';
    }

    // 4xx client errors (except 429 and 408) are permanent
    if (httpStatus >= 400 && httpStatus < 500) {
      return 'PERMANENT';
    }

    // Network-related errors
    if (
      message.includes('ECONNREFUSED') ||
      message.includes('ENOTFOUND') ||
      message.includes('ETIMEDOUT') ||
      message.includes('timeout') ||
      message.includes('network')
    ) {
      return 'TRANSIENT';
    }

    // Structural errors
    if (
      message.includes('missing') ||
      message.includes('required') ||
      message.includes('invalid')
    ) {
      return 'STRUCTURAL';
    }

    return 'UNKNOWN';
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for user sync operations
 */
export const userSyncService = new UserSyncService();
