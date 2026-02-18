/**
 * Bidirectional Sync Service
 *
 * Handles synchronization for reference data and pack entities:
 * - Bins: Pull-only from cloud (no push endpoint in API spec)
 * - Games: Bidirectional sync (push and pull)
 * - Packs: Pull-only for RECEIVED, ACTIVATED, and RETURNED states (push via sync-queue)
 *
 * API spec reference:
 * - GET /api/v1/sync/lottery/bins (pull only - no POST endpoint)
 * - GET/POST /api/v1/sync/lottery/games (bidirectional)
 * - GET /api/v1/sync/lottery/packs/received (pull only)
 * - GET /api/v1/sync/lottery/packs/activated (pull only)
 * - GET /api/v1/sync/lottery/packs/returned (pull only)
 *
 * @module main/services/bidirectional-sync
 * @security DB-006: Store-scoped for tenant isolation
 * @security SEC-006: Parameterized queries via DAL
 * @security API-003: Centralized error handling
 */

import {
  cloudApiService,
  type CloudGame,
  type CloudPack,
  type SessionAwareOptions,
} from './cloud-api.service';
import {
  syncSessionManager,
  type SyncSessionContext,
  type SyncCycleResult,
} from './sync-session-manager.service';
import { userSyncService } from './user-sync.service';
import { lotteryBinsDAL } from '../dal/lottery-bins.dal';
import { lotteryGamesDAL } from '../dal/lottery-games.dal';
import { lotteryPacksDAL, type LotteryPackStatus } from '../dal/lottery-packs.dal';
import { syncTimestampsDAL } from '../dal/sync-timestamps.dal';
import { syncQueueDAL, type SyncApiContext, type ErrorCategory } from '../dal/sync-queue.dal';
import { storesDAL } from '../dal/stores.dal';
import { usersDAL } from '../dal/users.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a bidirectional sync operation
 */
export interface BidirectionalSyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  errors: string[];
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('bidirectional-sync');

// ============================================================================
// Bidirectional Sync Service
// ============================================================================

/**
 * Bidirectional Sync Service
 *
 * Sync patterns by entity type:
 * - Bins: PULL-ONLY (cloud is authoritative, no push endpoint)
 * - Games: Bidirectional with last-write-wins conflict resolution
 *
 * For bidirectional entities:
 * 1. Push local changes to cloud
 * 2. Pull cloud changes locally
 * 3. Apply cloud changes with last-write-wins
 */
export class BidirectionalSyncService {
  // ==========================================================================
  // Bins Sync (PULL-ONLY)
  // ==========================================================================

  /**
   * Sync lottery bins from cloud (PULL-ONLY)
   *
   * Enterprise-grade implementation:
   * - Batch operations to eliminate N+1 queries
   * - Transaction-based updates for atomicity
   * - Proper tenant isolation validation
   * - Comprehensive audit logging
   *
   * Bins are cloud-managed reference data. The API only supports:
   * - GET /api/v1/sync/lottery/bins (pull)
   *
   * There is NO push endpoint for bins. Local bin changes are for
   * offline operation only; cloud data is authoritative.
   *
   * @security DB-006: Store-scoped operations for tenant isolation
   * @security SEC-006: Parameterized queries via DAL batch methods
   * @security API-003: Centralized error handling
   *
   * @returns Sync result with counts (pushed will always be 0)
   */
  async syncBins(): Promise<BidirectionalSyncResult> {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      throw new Error('Store not configured');
    }

    const result: BidirectionalSyncResult = {
      pushed: 0, // Always 0 - bins are pull-only
      pulled: 0,
      conflicts: 0,
      errors: [],
    };

    const storeId = store.store_id;
    const lastPull = syncTimestampsDAL.getLastPullAt(storeId, 'bins');

    log.info('Starting bins sync (pull-only)', { storeId, lastPull: lastPull || 'full' });

    // REUSE existing PULL tracking item if one exists, otherwise create new
    // This allows error history to accumulate on a single item for DLQ visibility
    let pullQueueItem = syncQueueDAL.getPendingPullItem(storeId, 'bin');
    if (!pullQueueItem) {
      pullQueueItem = syncQueueDAL.enqueue({
        store_id: storeId,
        entity_type: 'bin',
        entity_id: `pull-${Date.now()}`,
        operation: 'UPDATE',
        payload: { action: 'pull_bins', timestamp: new Date().toISOString(), lastPull },
        sync_direction: 'PULL',
      });
    }

    const apiEndpoint = '/api/v1/sync/lottery/bins';

    try {
      // Pull bins from cloud (no push - bins are cloud-managed)
      const pullResponse = await cloudApiService.pullBins(lastPull || undefined);

      log.debug('Bins pull response received', {
        binsCount: pullResponse.bins?.length ?? 0,
        totalCount: pullResponse.totalCount,
        hasBins: Array.isArray(pullResponse.bins),
      });

      const cloudBins = pullResponse.bins || [];

      if (cloudBins.length === 0) {
        log.info('No bins to sync from cloud');
        // BUG FIX: Mark PULL queue item as synced even when no bins returned
        // Previously this early return left queue items permanently pending
        const apiContext: SyncApiContext = {
          api_endpoint: apiEndpoint,
          http_status: 200,
          response_body: JSON.stringify({ pulled: 0, message: 'No bins to sync' }),
        };
        syncQueueDAL.markSynced(pullQueueItem.id, apiContext);
        return result;
      }

      // Separate active and deleted bins
      const activeBins = cloudBins.filter((bin) => !bin.deleted_at);
      const deletedBins = cloudBins.filter((bin) => bin.deleted_at);

      // Track cloud IDs for deletion check
      const activeCloudIds = new Set<string>(activeBins.map((b) => b.bin_id));

      // Step 1: Batch upsert active bins (eliminates N+1)
      // After v037 migration: bin_id IS the cloud's UUID (no separate cloud_bin_id)
      // v039 cloud-aligned schema: uses name, location, display_order, is_active
      if (activeBins.length > 0) {
        const binData = activeBins.map((cloudBin) => ({
          bin_id: cloudBin.bin_id, // Use cloud's bin_id directly as PK
          store_id: storeId, // DB-006: Always use configured store ID
          name: cloudBin.name,
          location: cloudBin.location,
          display_order: cloudBin.display_order ?? 0,
          is_active: cloudBin.is_active ?? true,
        }));

        try {
          const upsertResult = lotteryBinsDAL.batchUpsertFromCloud(binData, storeId);
          result.pulled += upsertResult.created + upsertResult.updated;
          result.errors.push(...upsertResult.errors);

          log.info('Active bins synced', {
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

      // Step 2: Handle explicitly deleted bins from cloud
      if (deletedBins.length > 0) {
        const deletedIds = deletedBins.map((b) => b.bin_id);
        const existingBins = lotteryBinsDAL.findByCloudIds(deletedIds);

        for (const cloudBin of deletedBins) {
          const localBin = existingBins.get(cloudBin.bin_id);
          if (localBin && !localBin.deleted_at) {
            const deleteResult = lotteryBinsDAL.softDelete(localBin.bin_id);
            if (deleteResult.success) {
              result.pulled++;
              log.debug('Bin soft deleted from cloud', { cloudBinId: cloudBin.bin_id });
            } else {
              result.errors.push(`Delete bin ${cloudBin.bin_id}: ${deleteResult.error}`);
            }
          }
        }
      }

      // Step 3: Batch soft delete local bins removed from cloud
      // (synced bins that are no longer in cloud response)
      try {
        const deletedCount = lotteryBinsDAL.batchSoftDeleteNotInCloudIds(storeId, activeCloudIds);
        if (deletedCount > 0) {
          log.info('Bins removed from cloud soft deleted locally', { deletedCount });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Batch delete failed: ${message}`);
        log.error('Batch delete failed', { error: message });
      }

      // Update sync timestamp on success
      if (result.errors.length === 0) {
        syncTimestampsDAL.setLastPullAt(storeId, 'bins', new Date().toISOString());
      }

      log.info('Bins sync completed (pull-only)', {
        pulled: result.pulled,
        errors: result.errors.length,
      });

      // Mark PULL queue item as synced with API context
      const apiContext: SyncApiContext = {
        api_endpoint: apiEndpoint,
        http_status: 200,
        response_body: JSON.stringify({
          pulled: result.pulled,
          errors: result.errors.length,
        }),
      };
      syncQueueDAL.markSynced(pullQueueItem.id, apiContext);
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Pull failed: ${message}`);
      log.error('Bins sync failed', { error: message });

      // Record failure - item will be retried on next sync cycle
      const httpStatus = this.extractHttpStatusFromError(message);
      const apiContext: SyncApiContext = {
        api_endpoint: apiEndpoint,
        http_status: httpStatus,
        response_body: message.substring(0, 500),
      };
      syncQueueDAL.incrementAttempts(pullQueueItem.id, message, apiContext);

      return result;
    }
  }

  // ==========================================================================
  // Games Sync
  // ==========================================================================

  /**
   * Sync lottery games bidirectionally
   * DB-006: Store-scoped operations
   *
   * @returns Sync result with counts
   */
  async syncGames(): Promise<BidirectionalSyncResult> {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      throw new Error('Store not configured');
    }

    const result: BidirectionalSyncResult = {
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      errors: [],
    };

    const storeId = store.store_id;
    const stateId = store.state_id || null; // Games are state-scoped
    const lastPull = syncTimestampsDAL.getLastPullAt(storeId, 'games');

    log.info('Starting games sync', { storeId, stateId, lastPull: lastPull || 'full' });

    // REUSE existing PULL tracking item if one exists, otherwise create new
    // This allows error history to accumulate on a single item for DLQ visibility
    let pullQueueItem = syncQueueDAL.getPendingPullItem(storeId, 'game');
    if (!pullQueueItem) {
      pullQueueItem = syncQueueDAL.enqueue({
        store_id: storeId,
        entity_type: 'game',
        entity_id: `pull-${Date.now()}`,
        operation: 'UPDATE',
        payload: { action: 'pull_games', timestamp: new Date().toISOString(), lastPull, stateId },
        sync_direction: 'PULL',
      });
    }

    const apiEndpoint = '/api/v1/sync/lottery/games';

    try {
      // Step 1: Get local changes since last pull
      const localGames = lotteryGamesDAL.findAllByStore(storeId);
      const localChanges = lastPull
        ? localGames.filter((game) => new Date(game.updated_at) > new Date(lastPull))
        : [];

      // Step 2: Push local changes to cloud
      if (localChanges.length > 0) {
        try {
          const pushData: CloudGame[] = localChanges.map((game) => ({
            game_id: game.game_id,
            game_code: game.game_code,
            name: game.name,
            price: game.price,
            pack_value: game.pack_value,
            tickets_per_pack: game.tickets_per_pack || undefined,
            status: game.status,
            updated_at: game.updated_at,
          }));

          const pushResult = await cloudApiService.pushGames(pushData);
          result.pushed = pushResult.results.filter((r) => r.status === 'synced').length;

          log.debug('Games pushed to cloud', {
            attempted: localChanges.length,
            succeeded: result.pushed,
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown push error';
          result.errors.push(`Push failed: ${message}`);
          log.error('Failed to push games', { error: message });
        }
      }

      // Step 3: Pull cloud changes
      // Use pullLotteryGames which uses the correct endpoint (/api/v1/sync/lottery/games)
      // and starts a sync session as required by the API
      try {
        const pullResponse = await cloudApiService.pullLotteryGames(stateId, lastPull || undefined);

        const cloudGames = pullResponse.games || [];

        // BUG FIX: If no local changes to push AND no cloud changes to pull,
        // mark the PULL item as synced immediately and return
        if (localChanges.length === 0 && cloudGames.length === 0) {
          log.info('No games to sync (no local changes, no cloud changes)');
          syncTimestampsDAL.setLastPullAt(storeId, 'games', new Date().toISOString());
          const apiContext: SyncApiContext = {
            api_endpoint: apiEndpoint,
            http_status: 200,
            response_body: JSON.stringify({ pushed: 0, pulled: 0, message: 'No games to sync' }),
          };
          syncQueueDAL.markSynced(pullQueueItem.id, apiContext);
          return result;
        }

        // Step 4: Apply cloud changes with last-write-wins
        for (const cloudGame of cloudGames) {
          try {
            // Use findById since game_id now matches cloud's ID directly
            const localGame = lotteryGamesDAL.findById(cloudGame.game_id);

            // Check if update is needed
            let shouldUpdate = true;
            if (localGame) {
              const cloudTime = new Date(cloudGame.updated_at);
              const localTime = new Date(localGame.updated_at);

              if (localTime >= cloudTime) {
                // Local is same or newer - skip
                shouldUpdate = false;
                result.conflicts++;
                log.debug('Skipping game (local is newer)', {
                  gameId: cloudGame.game_id,
                  cloudTime: cloudGame.updated_at,
                  localTime: localGame.updated_at,
                });
              }
            }

            if (shouldUpdate) {
              // Upsert from cloud - use game_id directly (no cloud_game_id)
              // Preserve cloud's timestamps for correct conflict resolution
              lotteryGamesDAL.upsertFromCloud({
                game_id: cloudGame.game_id,
                store_id: storeId,
                game_code: cloudGame.game_code,
                name: cloudGame.name,
                price: cloudGame.price,
                pack_value: cloudGame.pack_value,
                tickets_per_pack: cloudGame.tickets_per_pack,
                status: cloudGame.status,
                updated_at: cloudGame.updated_at,
              });
              result.pulled++;
            }
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown apply error';
            result.errors.push(`Apply game ${cloudGame.game_id}: ${message}`);
            log.error('Failed to apply game from cloud', {
              gameId: cloudGame.game_id,
              error: message,
            });
          }
        }

        // Mark synced even if cloudGames was empty but we got here (API returned successfully)
        log.debug('Games pull completed', { gamesCount: cloudGames.length });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown pull error';
        result.errors.push(`Pull failed: ${message}`);
        log.error('Failed to pull games', { error: message });

        // Record failure - item will be retried on next sync cycle
        const httpStatus = this.extractHttpStatusFromError(message);
        const apiContext: SyncApiContext = {
          api_endpoint: apiEndpoint,
          http_status: httpStatus,
          response_body: message.substring(0, 500),
        };
        syncQueueDAL.incrementAttempts(pullQueueItem.id, message, apiContext);

        // Return early - do not mark as synced after failure
        return result;
      }

      // Step 5: Update sync timestamp (only if no errors)
      syncTimestampsDAL.setLastPullAt(storeId, 'games', new Date().toISOString());

      log.info('Games sync completed', {
        pushed: result.pushed,
        pulled: result.pulled,
        conflicts: result.conflicts,
        errors: result.errors.length,
      });

      // Mark PULL queue item as synced with API context
      const apiContext: SyncApiContext = {
        api_endpoint: apiEndpoint,
        http_status: 200,
        response_body: JSON.stringify({
          pushed: result.pushed,
          pulled: result.pulled,
          conflicts: result.conflicts,
          errors: result.errors.length,
        }),
      };
      syncQueueDAL.markSynced(pullQueueItem.id, apiContext);
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Games sync failed', { error: message });

      // Record failure - item will be retried on next sync cycle
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

  // ==========================================================================
  // Packs Sync (PULL-ONLY)
  // ==========================================================================

  /**
   * Sync received packs from cloud (PULL-ONLY)
   *
   * Enterprise-grade implementation for multi-device pack synchronization.
   * Retrieves packs with RECEIVED status from other devices/systems.
   *
   * Pack sync is PULL-ONLY because:
   * - Push operations go through sync-queue for proper ordering
   * - Cloud is authoritative for pack data from other devices
   *
   * @security SEC-006: Parameterized queries via DAL batch methods
   * @security DB-006: Store-scoped operations for tenant isolation
   * @security API-003: Centralized error handling
   *
   * @returns Sync result with counts (pushed will always be 0)
   */
  async syncReceivedPacks(): Promise<BidirectionalSyncResult> {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      throw new Error('Store not configured');
    }

    const result: BidirectionalSyncResult = {
      pushed: 0, // Always 0 - packs are pull-only (push via sync-queue)
      pulled: 0,
      conflicts: 0,
      errors: [],
    };

    const storeId = store.store_id;
    const lastPull = syncTimestampsDAL.getLastPullAt(storeId, 'packs_received');

    log.info('Starting received packs sync (pull-only)', {
      storeId,
      lastPull: lastPull || 'full',
    });

    // REUSE existing PULL tracking item if one exists, otherwise create new
    // Use action-based search since both received and activated use entity_type 'pack'
    let pullQueueItem = syncQueueDAL.getPendingPullItemByAction(storeId, 'pull_received_packs');
    if (!pullQueueItem) {
      pullQueueItem = syncQueueDAL.enqueue({
        store_id: storeId,
        entity_type: 'pack',
        entity_id: `pull-received-${Date.now()}`,
        operation: 'UPDATE',
        payload: { action: 'pull_received_packs', timestamp: new Date().toISOString(), lastPull },
        sync_direction: 'PULL',
      });
    }

    const apiEndpoint = '/api/v1/sync/lottery/packs/received';

    try {
      // Pull received packs from cloud with pagination
      let hasMore = true;
      let sinceSequence: number | undefined;
      let pageCount = 0;
      const MAX_PAGES = 100; // Safety limit

      while (hasMore && pageCount < MAX_PAGES) {
        pageCount++;

        const pullResponse = await cloudApiService.pullReceivedPacks({
          since: lastPull || undefined,
          sinceSequence,
          limit: 500,
        });

        const cloudPacks = pullResponse.packs || [];

        // Debug: Log what we received from cloud
        log.info('Received packs pull response', {
          page: pageCount,
          packsReceived: cloudPacks.length,
          packDetails: cloudPacks.map((p) => ({
            pack_id: p.pack_id,
            pack_number: p.pack_number,
            status: p.status,
            game_id: p.game_id,
            current_bin_id: p.current_bin_id,
          })),
          syncMetadata: pullResponse.syncMetadata,
        });

        if (cloudPacks.length === 0 && pageCount === 1) {
          log.info('No received packs to sync from cloud');
          break;
        }

        // Map cloud packs to local format and upsert
        const mappedPacks = cloudPacks.map((cloudPack) =>
          this.mapCloudPackToLocal(cloudPack, storeId)
        );

        // API-001: Validate user FK references exist locally before DB operation
        // Cloud may have user IDs (returned_by, etc.) that don't exist in local store
        const packData = this.validateUserForeignKeysBatch(mappedPacks);

        if (packData.length > 0) {
          let upsertResult = lotteryPacksDAL.batchUpsertFromCloud(packData, storeId);

          // If there are missing games, sync games and retry
          if (upsertResult.missingGames.length > 0) {
            log.warn('Missing games detected during pack sync, triggering game sync', {
              missingGames: upsertResult.missingGames,
            });

            // Sync games from cloud
            await this.syncGames();

            // Retry pack upsert with fresh game data
            log.info('Retrying pack upsert after game sync');
            upsertResult = lotteryPacksDAL.batchUpsertFromCloud(packData, storeId);
          }

          result.pulled += upsertResult.created + upsertResult.updated;
          result.errors.push(...upsertResult.errors);

          log.debug('Received packs page synced', {
            page: pageCount,
            created: upsertResult.created,
            updated: upsertResult.updated,
            errors: upsertResult.errors.length,
          });
        }

        // Update pagination state
        hasMore = pullResponse.syncMetadata.hasMore;
        sinceSequence = pullResponse.syncMetadata.lastSequence;
      }

      if (pageCount >= MAX_PAGES) {
        log.warn('Received packs pagination hit safety limit', {
          maxPages: MAX_PAGES,
          pulled: result.pulled,
        });
      }

      // Update sync timestamp on success
      if (result.errors.length === 0) {
        syncTimestampsDAL.setLastPullAt(storeId, 'packs_received', new Date().toISOString());
      }

      log.info('Received packs sync completed (pull-only)', {
        pulled: result.pulled,
        pages: pageCount,
        errors: result.errors.length,
      });

      // Mark PULL queue item as synced with API context
      const apiContext: SyncApiContext = {
        api_endpoint: apiEndpoint,
        http_status: 200,
        response_body: JSON.stringify({
          pulled: result.pulled,
          pages: pageCount,
          errors: result.errors.length,
        }),
      };
      syncQueueDAL.markSynced(pullQueueItem.id, apiContext);
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Pull received packs failed: ${message}`);
      log.error('Received packs sync failed', { error: message });

      // Record PULL failure in sync queue with API context
      const httpStatus = this.extractHttpStatusFromError(message);
      const apiContext: SyncApiContext = {
        api_endpoint: apiEndpoint,
        http_status: httpStatus,
        response_body: message.substring(0, 500),
      };
      syncQueueDAL.incrementAttempts(pullQueueItem.id, message, apiContext);
      return result;
    }
  }

  /**
   * Sync activated packs from cloud (PULL-ONLY)
   *
   * Enterprise-grade implementation for multi-device pack synchronization.
   * Retrieves packs that have been activated with bin assignments and opening serials
   * from other devices/systems.
   *
   * @security SEC-006: Parameterized queries via DAL batch methods
   * @security DB-006: Store-scoped operations for tenant isolation
   * @security API-003: Centralized error handling
   *
   * @returns Sync result with counts (pushed will always be 0)
   */
  async syncActivatedPacks(): Promise<BidirectionalSyncResult> {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      throw new Error('Store not configured');
    }

    const result: BidirectionalSyncResult = {
      pushed: 0, // Always 0 - packs are pull-only (push via sync-queue)
      pulled: 0,
      conflicts: 0,
      errors: [],
    };

    const storeId = store.store_id;
    const lastPull = syncTimestampsDAL.getLastPullAt(storeId, 'packs_activated');

    log.info('Starting activated packs sync (pull-only)', {
      storeId,
      lastPull: lastPull || 'full',
    });

    // REUSE existing PULL tracking item if one exists, otherwise create new
    // Use action-based search since both received and activated use entity_type 'pack'
    let pullQueueItem = syncQueueDAL.getPendingPullItemByAction(storeId, 'pull_activated_packs');
    if (!pullQueueItem) {
      pullQueueItem = syncQueueDAL.enqueue({
        store_id: storeId,
        entity_type: 'pack',
        entity_id: `pull-activated-${Date.now()}`,
        operation: 'UPDATE',
        payload: { action: 'pull_activated_packs', timestamp: new Date().toISOString(), lastPull },
        sync_direction: 'PULL',
      });
    }

    const apiEndpoint = '/api/v1/sync/lottery/packs/activated';

    try {
      // Pull activated packs from cloud with pagination
      let hasMore = true;
      let sinceSequence: number | undefined;
      let pageCount = 0;
      const MAX_PAGES = 100; // Safety limit

      while (hasMore && pageCount < MAX_PAGES) {
        pageCount++;

        const pullResponse = await cloudApiService.pullActivatedPacks({
          since: lastPull || undefined,
          sinceSequence,
          limit: 500,
        });

        const cloudPacks = pullResponse.packs || [];

        // Debug: Log what we received from cloud
        log.info('Activated packs pull response', {
          page: pageCount,
          packsReceived: cloudPacks.length,
          packDetails: cloudPacks.map((p) => ({
            pack_id: p.pack_id,
            pack_number: p.pack_number,
            status: p.status,
            game_id: p.game_id,
            current_bin_id: p.current_bin_id,
          })),
          syncMetadata: pullResponse.syncMetadata,
        });

        if (cloudPacks.length === 0 && pageCount === 1) {
          log.info('No activated packs to sync from cloud');
          break;
        }

        // Map cloud packs to local format and upsert
        const mappedPacks = cloudPacks.map((cloudPack) =>
          this.mapCloudPackToLocal(cloudPack, storeId)
        );

        // API-001: Validate user FK references exist locally before DB operation
        // Cloud may have user IDs (activated_by, etc.) that don't exist in local store
        const packData = this.validateUserForeignKeysBatch(mappedPacks);

        if (packData.length > 0) {
          let upsertResult = lotteryPacksDAL.batchUpsertFromCloud(packData, storeId);

          // If there are missing games, sync games and retry
          if (upsertResult.missingGames.length > 0) {
            log.warn('Missing games detected during activated pack sync, triggering game sync', {
              missingGames: upsertResult.missingGames,
            });

            // Sync games from cloud
            await this.syncGames();

            // Retry pack upsert with fresh game data
            log.info('Retrying activated pack upsert after game sync');
            upsertResult = lotteryPacksDAL.batchUpsertFromCloud(packData, storeId);
          }

          result.pulled += upsertResult.created + upsertResult.updated;
          result.errors.push(...upsertResult.errors);

          log.debug('Activated packs page synced', {
            page: pageCount,
            created: upsertResult.created,
            updated: upsertResult.updated,
            errors: upsertResult.errors.length,
          });
        }

        // Update pagination state
        hasMore = pullResponse.syncMetadata.hasMore;
        sinceSequence = pullResponse.syncMetadata.lastSequence;
      }

      if (pageCount >= MAX_PAGES) {
        log.warn('Activated packs pagination hit safety limit', {
          maxPages: MAX_PAGES,
          pulled: result.pulled,
        });
      }

      // Update sync timestamp on success
      if (result.errors.length === 0) {
        syncTimestampsDAL.setLastPullAt(storeId, 'packs_activated', new Date().toISOString());
      }

      log.info('Activated packs sync completed (pull-only)', {
        pulled: result.pulled,
        pages: pageCount,
        errors: result.errors.length,
      });

      // Mark PULL queue item as synced with API context
      const apiContext: SyncApiContext = {
        api_endpoint: apiEndpoint,
        http_status: 200,
        response_body: JSON.stringify({
          pulled: result.pulled,
          pages: pageCount,
          errors: result.errors.length,
        }),
      };
      syncQueueDAL.markSynced(pullQueueItem.id, apiContext);
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Pull activated packs failed: ${message}`);
      log.error('Activated packs sync failed', { error: message });

      // Record PULL failure in sync queue with API context
      const httpStatus = this.extractHttpStatusFromError(message);
      const apiContext: SyncApiContext = {
        api_endpoint: apiEndpoint,
        http_status: httpStatus,
        response_body: message.substring(0, 500),
      };
      syncQueueDAL.incrementAttempts(pullQueueItem.id, message, apiContext);
      return result;
    }
  }

  /**
   * Sync returned packs from cloud (PULL-ONLY)
   *
   * Enterprise-grade implementation for multi-device pack synchronization.
   * Retrieves packs that have been marked as returned from other devices/systems.
   *
   * This method is CRITICAL for multi-device return sync:
   * - When a return is marked on another device (or cloud UI), this pulls that data
   * - Without this, returns marked elsewhere never sync to this device
   *
   * @security SEC-006: Parameterized queries via DAL batch methods
   * @security DB-006: Store-scoped operations for tenant isolation
   * @security API-003: Centralized error handling
   * @security API-002: Bounded pagination to prevent unbounded reads
   *
   * @returns Sync result with counts (pushed will always be 0)
   */
  async syncReturnedPacks(): Promise<BidirectionalSyncResult> {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      throw new Error('Store not configured');
    }

    const result: BidirectionalSyncResult = {
      pushed: 0, // Always 0 - packs are pull-only (push via sync-queue)
      pulled: 0,
      conflicts: 0,
      errors: [],
    };

    const storeId = store.store_id;
    const lastPull = syncTimestampsDAL.getLastPullAt(storeId, 'packs_returned');

    // DIAGNOSTIC: Enhanced logging for auth issue debugging
    log.info('DIAG: syncReturnedPacks STARTING', {
      storeId,
      lastPull: lastPull || 'full',
      timestamp: new Date().toISOString(),
      caller: new Error().stack?.split('\n').slice(2, 4).join(' <- ') || 'unknown',
    });

    // REUSE existing PULL tracking item if one exists, otherwise create new
    // Use action-based search since received, activated, and returned all use entity_type 'pack'
    let pullQueueItem = syncQueueDAL.getPendingPullItemByAction(storeId, 'pull_returned_packs');
    if (!pullQueueItem) {
      pullQueueItem = syncQueueDAL.enqueue({
        store_id: storeId,
        entity_type: 'pack',
        entity_id: `pull-returned-${Date.now()}`,
        operation: 'UPDATE',
        payload: { action: 'pull_returned_packs', timestamp: new Date().toISOString(), lastPull },
        sync_direction: 'PULL',
      });
    }

    const apiEndpoint = '/api/v1/sync/lottery/packs/returned';

    try {
      // Pull returned packs from cloud with pagination
      let hasMore = true;
      let sinceSequence: number | undefined;
      let pageCount = 0;
      const MAX_PAGES = 100; // Safety limit per API-002

      while (hasMore && pageCount < MAX_PAGES) {
        pageCount++;

        const pullResponse = await cloudApiService.pullReturnedPacks({
          since: lastPull || undefined,
          sinceSequence,
          limit: 500,
        });

        const cloudPacks = pullResponse.packs || [];

        // SEC-017: Audit log what we received from cloud
        log.info('Returned packs pull response', {
          page: pageCount,
          packsReceived: cloudPacks.length,
          packDetails: cloudPacks.map((p) => ({
            pack_id: p.pack_id,
            pack_number: p.pack_number,
            status: p.status,
            returned_at: p.returned_at,
            return_reason: p.return_reason,
          })),
          syncMetadata: pullResponse.syncMetadata,
        });

        if (cloudPacks.length === 0 && pageCount === 1) {
          log.info('No returned packs to sync from cloud');
          break;
        }

        // Map cloud packs to local format and upsert
        const mappedPacks = cloudPacks.map((cloudPack) =>
          this.mapCloudPackToLocal(cloudPack, storeId)
        );

        // API-001: Validate user FK references exist locally before DB operation
        // Cloud may have user IDs (returned_by, etc.) that don't exist in local store
        const fkValidatedPacks = this.validateUserForeignKeysBatch(mappedPacks);

        // API-001: Validate pack data integrity (sales_amount, tickets_sold_count)
        // CRITICAL: Returned packs MUST have valid sales data - DO NOT mask with defaults
        const { validPacks: packData, errors: validationErrors } = this.validatePackDataIntegrity(
          fkValidatedPacks,
          'returned'
        );

        // Collect validation errors for reporting
        result.errors.push(...validationErrors);

        if (packData.length > 0) {
          let upsertResult = lotteryPacksDAL.batchUpsertFromCloud(packData, storeId);

          // If there are missing games, sync games and retry
          if (upsertResult.missingGames.length > 0) {
            log.warn('Missing games detected during returned pack sync, triggering game sync', {
              missingGames: upsertResult.missingGames,
            });

            // Sync games from cloud
            await this.syncGames();

            // Retry pack upsert with fresh game data
            log.info('Retrying returned pack upsert after game sync');
            upsertResult = lotteryPacksDAL.batchUpsertFromCloud(packData, storeId);
          }

          result.pulled += upsertResult.created + upsertResult.updated;
          result.errors.push(...upsertResult.errors);

          log.debug('Returned packs page synced', {
            page: pageCount,
            created: upsertResult.created,
            updated: upsertResult.updated,
            errors: upsertResult.errors.length,
          });
        }

        // Update pagination state
        hasMore = pullResponse.syncMetadata.hasMore;
        sinceSequence = pullResponse.syncMetadata.lastSequence;
      }

      if (pageCount >= MAX_PAGES) {
        log.warn('Returned packs pagination hit safety limit', {
          maxPages: MAX_PAGES,
          pulled: result.pulled,
        });
      }

      // Update sync timestamp on success
      if (result.errors.length === 0) {
        syncTimestampsDAL.setLastPullAt(storeId, 'packs_returned', new Date().toISOString());
      }

      log.info('Returned packs sync completed (pull-only)', {
        pulled: result.pulled,
        pages: pageCount,
        errors: result.errors.length,
      });

      // Mark PULL queue item as synced with API context
      const apiContext: SyncApiContext = {
        api_endpoint: apiEndpoint,
        http_status: 200,
        response_body: JSON.stringify({
          pulled: result.pulled,
          pages: pageCount,
          errors: result.errors.length,
        }),
      };
      syncQueueDAL.markSynced(pullQueueItem.id, apiContext);
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      result.errors.push(`Pull returned packs failed: ${message}`);

      // DIAGNOSTIC: Enhanced error logging
      log.error('DIAG: syncReturnedPacks FAILED', {
        error: message,
        stack: stack?.split('\n').slice(0, 5).join(' | '),
        storeId,
        lastPull: lastPull || 'full',
        timestamp: new Date().toISOString(),
      });

      // Record PULL failure in sync queue with API context
      const httpStatus = this.extractHttpStatusFromError(message);
      const apiContext: SyncApiContext = {
        api_endpoint: apiEndpoint,
        http_status: httpStatus,
        response_body: message.substring(0, 500),
      };
      syncQueueDAL.incrementAttempts(pullQueueItem.id, message, apiContext);
      return result;
    }
  }

  /**
   * Sync all packs (received, activated, and returned) from cloud
   *
   * Sync order is intentional:
   * 1. Received packs - initial pack receipt
   * 2. Activated packs - packs put into bins for sale
   * 3. Returned packs - packs returned to vendor (terminal state)
   *
   * @returns Combined sync results for all pack types
   */
  async syncPacks(): Promise<{
    received: BidirectionalSyncResult;
    activated: BidirectionalSyncResult;
    returned: BidirectionalSyncResult;
  }> {
    const syncStartTime = Date.now();
    log.info('DIAG: syncPacks STARTING - will sync received, activated, then returned', {
      timestamp: new Date().toISOString(),
    });

    log.info('DIAG: syncPacks - Step 1/3: Starting syncReceivedPacks');
    const received = await this.syncReceivedPacks();
    log.info('DIAG: syncPacks - Step 1/3 COMPLETE: syncReceivedPacks', {
      pulled: received.pulled,
      errors: received.errors.length,
      elapsed: Date.now() - syncStartTime,
    });

    log.info('DIAG: syncPacks - Step 2/3: Starting syncActivatedPacks');
    const activated = await this.syncActivatedPacks();
    log.info('DIAG: syncPacks - Step 2/3 COMPLETE: syncActivatedPacks', {
      pulled: activated.pulled,
      errors: activated.errors.length,
      elapsed: Date.now() - syncStartTime,
    });

    log.info('DIAG: syncPacks - Step 3/3: Starting syncReturnedPacks');
    const returned = await this.syncReturnedPacks();
    log.info('DIAG: syncPacks - Step 3/3 COMPLETE: syncReturnedPacks', {
      pulled: returned.pulled,
      errors: returned.errors.length,
      elapsed: Date.now() - syncStartTime,
    });

    log.info('DIAG: syncPacks COMPLETE', {
      received: { pulled: received.pulled, errors: received.errors.length },
      activated: { pulled: activated.pulled, errors: activated.errors.length },
      returned: { pulled: returned.pulled, errors: returned.errors.length },
      totalElapsed: Date.now() - syncStartTime,
    });

    return { received, activated, returned };
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Map cloud pack data to local format for upsert
   *
   * Field names match both cloud API and local DB schema:
   * - current_bin_id: UUID of bin pack is currently in (v029 alignment)
   * - tickets_sold_count: Total tickets sold (v029 alignment)
   *
   * @security DB-006: Store ID enforced for tenant isolation
   * @security SEC-006: Direct field mapping, no user input interpolation
   *
   * @param cloudPack - Pack data from cloud API
   * @param storeId - Store ID for tenant isolation
   * @returns Pack data in local format matching lottery_packs table schema
   */
  private mapCloudPackToLocal(
    cloudPack: CloudPack,
    storeId: string
  ): {
    pack_id: string; // After cloud_id consolidation, pack_id IS the cloud ID
    store_id: string;
    game_id: string;
    pack_number: string;
    status: LotteryPackStatus;
    current_bin_id: string | null;
    opening_serial: string | null;
    closing_serial: string | null;
    serial_start: string | null;
    serial_end: string | null;
    tickets_sold_count: number | null;
    last_sold_at: string | null;
    sales_amount: number | null;
    received_at: string | null;
    received_by: string | null;
    activated_at: string | null;
    activated_by: string | null;
    activated_shift_id: string | null;
    depleted_at: string | null;
    depleted_by: string | null;
    depleted_shift_id: string | null;
    depletion_reason: string | null;
    returned_at: string | null;
    returned_by: string | null;
    returned_shift_id: string | null;
    return_reason: string | null;
    return_notes: string | null;
    last_sold_serial: string | null;
    tickets_sold_on_return: number | null;
    return_sales_amount: number | null;
    serial_override_approved_by: string | null;
    serial_override_reason: string | null;
    serial_override_approved_at: string | null;
    mark_sold_approved_by: string | null;
    mark_sold_reason: string | null;
    mark_sold_approved_at: string | null;
    created_at: string;
    updated_at: string;
  } {
    // FK field handling for cloud sync:
    //
    // PRESERVED (these entities are synced BEFORE packs in syncAll):
    // - game_id: FK to lottery_games (synced via syncGames - runs before packs)
    // - current_bin_id: FK to lottery_bins (synced via syncBins - runs before packs)
    // - received_by, activated_by, depleted_by, returned_by: FK to users
    //   Users are synced BEFORE packs in syncAll to ensure FKs resolve.
    //   These audit fields are CRITICAL business data and must be preserved.
    //
    // NULLED (these entities are created LOCALLY ONLY, not synced from cloud):
    // - activated_shift_id, depleted_shift_id, returned_shift_id: FK to shifts
    //   Shifts are created locally when a cashier starts work. They are pushed TO cloud
    //   but not pulled FROM cloud. So cloud's shift IDs won't exist locally.
    //
    // After v037 migration: bin_id IS the cloud's UUID (no cloud_bin_id mapping needed)
    // After v036 migration: game_id IS the cloud's UUID (no cloud_game_id mapping needed)
    // After v045 migration: pack_id IS the cloud's UUID (no cloud_pack_id mapping needed)
    return {
      pack_id: cloudPack.pack_id, // pack_id IS the cloud ID after consolidation
      store_id: storeId, // DB-006: Always use configured store ID for tenant isolation
      game_id: cloudPack.game_id,
      pack_number: cloudPack.pack_number,
      status: cloudPack.status as LotteryPackStatus,
      // Bins/games/users are synced from cloud BEFORE packs - preserve FK
      current_bin_id: cloudPack.current_bin_id, // After v037: bin_id IS cloud's UUID
      opening_serial: cloudPack.opening_serial,
      closing_serial: cloudPack.closing_serial,
      // Serial range fields from cloud API
      serial_start: cloudPack.serial_start,
      serial_end: cloudPack.serial_end,
      tickets_sold_count: cloudPack.tickets_sold_count,
      last_sold_at: cloudPack.last_sold_at,
      sales_amount: cloudPack.sales_amount,
      received_at: cloudPack.received_at,
      received_by: cloudPack.received_by, // FK to users - users synced BEFORE packs
      activated_at: cloudPack.activated_at,
      activated_by: cloudPack.activated_by, // FK to users - users synced BEFORE packs
      activated_shift_id: null, // FK to shifts - shifts are LOCAL ONLY, not synced from cloud
      depleted_at: cloudPack.depleted_at,
      depleted_by: cloudPack.depleted_by, // FK to users - users synced BEFORE packs
      depleted_shift_id: null, // FK to shifts - shifts are LOCAL ONLY, not synced from cloud
      depletion_reason: cloudPack.depletion_reason,
      returned_at: cloudPack.returned_at,
      returned_by: cloudPack.returned_by, // FK to users - users synced BEFORE packs
      returned_shift_id: null, // FK to shifts - shifts are LOCAL ONLY, not synced from cloud
      return_reason: cloudPack.return_reason,
      return_notes: cloudPack.return_notes,
      last_sold_serial: cloudPack.last_sold_serial,
      tickets_sold_on_return: cloudPack.tickets_sold_on_return,
      return_sales_amount:
        cloudPack.return_sales_amount !== null ? Number(cloudPack.return_sales_amount) : null,
      // Serial override approval fields (API v029 + v038 alignment)
      serial_override_approved_by: cloudPack.serial_override_approved_by,
      serial_override_reason: cloudPack.serial_override_reason,
      serial_override_approved_at: cloudPack.serial_override_approved_at,
      mark_sold_approved_by: cloudPack.mark_sold_approved_by,
      mark_sold_reason: cloudPack.mark_sold_reason,
      mark_sold_approved_at: cloudPack.mark_sold_approved_at,
      // Timestamps
      created_at: cloudPack.created_at,
      updated_at: cloudPack.updated_at,
    };
  }

  /**
   * Validate FK references exist locally for a single pack, nullify those that don't
   *
   * Cloud data may contain references from:
   * - Cloud admin users who don't sync to stores
   * - Users from other devices that haven't synced
   * - Bins that were deleted or not yet synced
   *
   * Per API-001 (VALIDATION): Validate data before database operations.
   * Per DB-006 (TENANT_ISOLATION): Only accept FKs that exist in local store context.
   *
   * @security API-001: Input validation before DB operations
   * @security DB-006: Tenant isolation - only local FKs allowed
   *
   * @param packData - Mapped pack data with potential invalid FKs
   * @returns Pack data with validated FKs (invalid ones set to null)
   */
  private validateUserForeignKeys<
    T extends {
      current_bin_id: string | null;
      received_by: string | null;
      activated_by: string | null;
      depleted_by: string | null;
      returned_by: string | null;
      serial_override_approved_by: string | null;
      mark_sold_approved_by: string | null;
    },
  >(packData: T): T {
    // Cache validated IDs to avoid repeated DB lookups (performance optimization)
    const userExistsCache = new Map<string, boolean>();

    const userExists = (userId: string | null): boolean => {
      if (!userId) return true; // null is valid (no FK reference)

      // Check cache first
      if (userExistsCache.has(userId)) {
        return userExistsCache.get(userId)!;
      }

      // Query DB - SEC-006: Uses parameterized query via DAL
      // FIX: Use != null to catch both null AND undefined (DAL returns undefined for not found)
      const exists = usersDAL.findById(userId) != null;
      userExistsCache.set(userId, exists);

      if (!exists) {
        log.warn('User FK reference not found locally, will be nullified', {
          userId,
          auditNote: 'Cloud user does not exist in local store context',
        });
      }

      return exists;
    };

    const binExists = (binId: string | null): boolean => {
      if (!binId) return true; // null is valid (no FK reference)
      // FIX: Use != null to catch both null AND undefined (DAL returns undefined for not found)
      const exists = lotteryBinsDAL.findById(binId) != null;
      if (!exists) {
        log.warn('Bin FK reference not found locally, will be nullified', {
          binId,
          auditNote: 'Cloud bin does not exist in local store context',
        });
      }
      return exists;
    };

    // Validate and nullify invalid FKs
    return {
      ...packData,
      current_bin_id: binExists(packData.current_bin_id) ? packData.current_bin_id : null,
      received_by: userExists(packData.received_by) ? packData.received_by : null,
      activated_by: userExists(packData.activated_by) ? packData.activated_by : null,
      depleted_by: userExists(packData.depleted_by) ? packData.depleted_by : null,
      returned_by: userExists(packData.returned_by) ? packData.returned_by : null,
      serial_override_approved_by: userExists(packData.serial_override_approved_by)
        ? packData.serial_override_approved_by
        : null,
      mark_sold_approved_by: userExists(packData.mark_sold_approved_by)
        ? packData.mark_sold_approved_by
        : null,
    };
  }

  /**
   * Validate all FK references for a batch of packs
   *
   * Optimized batch validation with shared caches to minimize DB queries.
   * Validates:
   * - User FKs: received_by, activated_by, depleted_by, returned_by, approval fields
   * - Bin FKs: current_bin_id
   *
   * Note: game_id is validated by DAL (missingGames check)
   * Note: shift_ids are already nulled in mapCloudPackToLocal
   *
   * @security SEC-006: Parameterized queries via DAL
   * @security API-002: Bounded operation (batch size controlled by caller)
   *
   * @param packDataArray - Array of mapped pack data
   * @returns Array with validated FKs (invalid ones set to null)
   */
  private validateUserForeignKeysBatch<
    T extends {
      current_bin_id: string | null;
      received_by: string | null;
      activated_by: string | null;
      depleted_by: string | null;
      returned_by: string | null;
      serial_override_approved_by: string | null;
      mark_sold_approved_by: string | null;
    },
  >(packDataArray: T[]): T[] {
    // Collect all unique IDs from the batch
    const allUserIds = new Set<string>();
    const allBinIds = new Set<string>();

    for (const pack of packDataArray) {
      // User FKs
      if (pack.received_by) allUserIds.add(pack.received_by);
      if (pack.activated_by) allUserIds.add(pack.activated_by);
      if (pack.depleted_by) allUserIds.add(pack.depleted_by);
      if (pack.returned_by) allUserIds.add(pack.returned_by);
      if (pack.serial_override_approved_by) allUserIds.add(pack.serial_override_approved_by);
      if (pack.mark_sold_approved_by) allUserIds.add(pack.mark_sold_approved_by);
      // Bin FKs
      if (pack.current_bin_id) allBinIds.add(pack.current_bin_id);
    }

    // DEBUG: Log all user IDs being validated with pack details
    log.info('DEBUG: validateUserForeignKeysBatch - input packs', {
      userIdsToCheck: [...allUserIds],
      binIdsToCheck: [...allBinIds],
      packCount: packDataArray.length,
      packDetails: packDataArray.map((p) => ({
        pack_number: (p as { pack_number?: string }).pack_number,
        status: (p as { status?: string }).status,
        received_by: p.received_by,
        activated_by: p.activated_by,
        depleted_by: p.depleted_by,
        returned_by: p.returned_by,
        serial_override_approved_by: p.serial_override_approved_by,
        mark_sold_approved_by: p.mark_sold_approved_by,
        current_bin_id: p.current_bin_id,
      })),
    });

    // Build user existence cache
    // SEC-006: Each findById uses parameterized query
    const userExistsCache = new Map<string, boolean>();
    const missingUsers: string[] = [];

    for (const userId of allUserIds) {
      const user = usersDAL.findById(userId);
      // FIX: Use != null to catch both null AND undefined (DAL returns undefined for not found)
      const exists = user != null;
      log.info('DEBUG: User existence check', {
        userId,
        exists,
        userName: user?.name ?? 'N/A',
      });
      userExistsCache.set(userId, exists);
      if (!exists) {
        missingUsers.push(userId);
      }
    }

    // Build bin existence cache
    const binExistsCache = new Map<string, boolean>();
    const missingBins: string[] = [];

    for (const binId of allBinIds) {
      // FIX: Use != null to catch both null AND undefined (DAL returns undefined for not found)
      const exists = lotteryBinsDAL.findById(binId) != null;
      binExistsCache.set(binId, exists);
      if (!exists) {
        missingBins.push(binId);
      }
    }

    // Log missing references once (audit trail)
    if (missingUsers.length > 0) {
      log.warn('User FK references not found locally, will be nullified', {
        missingUserIds: missingUsers,
        count: missingUsers.length,
        auditNote: 'Cloud users do not exist in local store context',
      });
    }

    if (missingBins.length > 0) {
      log.warn('Bin FK references not found locally, will be nullified', {
        missingBinIds: missingBins,
        count: missingBins.length,
        auditNote: 'Cloud bins do not exist in local store context',
      });
    }

    // Early return if nothing to validate
    if (allUserIds.size === 0 && allBinIds.size === 0) {
      return packDataArray;
    }

    // Apply validation using caches
    const validatedPacks = packDataArray.map((pack) => {
      // Calculate validated values
      const validatedReturnedBy =
        userExistsCache.get(pack.returned_by!) !== false ? pack.returned_by : null;

      // DEBUG: Log each pack's returned_by validation
      if (pack.returned_by) {
        const cacheResult = userExistsCache.get(pack.returned_by);
        log.info('DEBUG: returned_by validation', {
          pack_number: (pack as { pack_number?: string }).pack_number,
          original_returned_by: pack.returned_by,
          cacheResult,
          cacheResultType: typeof cacheResult,
          conditionResult: cacheResult !== false,
          validated_returned_by: validatedReturnedBy,
        });
      }

      return {
        ...pack,
        // Bin FK
        current_bin_id:
          binExistsCache.get(pack.current_bin_id!) !== false ? pack.current_bin_id : null,
        // User FKs
        received_by: userExistsCache.get(pack.received_by!) !== false ? pack.received_by : null,
        activated_by: userExistsCache.get(pack.activated_by!) !== false ? pack.activated_by : null,
        depleted_by: userExistsCache.get(pack.depleted_by!) !== false ? pack.depleted_by : null,
        returned_by: validatedReturnedBy,
        serial_override_approved_by:
          userExistsCache.get(pack.serial_override_approved_by!) !== false
            ? pack.serial_override_approved_by
            : null,
        mark_sold_approved_by:
          userExistsCache.get(pack.mark_sold_approved_by!) !== false
            ? pack.mark_sold_approved_by
            : null,
      };
    });

    // DEBUG: Log final validated packs
    log.info('DEBUG: validateUserForeignKeysBatch - output packs', {
      packCount: validatedPacks.length,
      packDetails: validatedPacks.map((p) => ({
        pack_number: (p as { pack_number?: string }).pack_number,
        status: (p as { status?: string }).status,
        received_by: p.received_by,
        activated_by: p.activated_by,
        depleted_by: p.depleted_by,
        returned_by: p.returned_by,
        serial_override_approved_by: p.serial_override_approved_by,
        mark_sold_approved_by: p.mark_sold_approved_by,
        current_bin_id: p.current_bin_id,
      })),
    });

    return validatedPacks;
  }

  /**
   * Validate pack data integrity for RETURNED packs
   *
   * CRITICAL: For returned packs, return-specific sales data MUST be present.
   * This validation ensures we don't silently mask data integrity issues.
   * NULL means there is an ERROR - we do NOT mask it, we REJECT and LOG.
   *
   * IMPORTANT FIELD DISTINCTION:
   * - sales_amount / tickets_sold_count: Running totals for ACTIVE packs
   * - return_sales_amount / tickets_sold_on_return: Captured at RETURN time
   *
   * For RETURNED packs, cloud should provide return_sales_amount (not sales_amount)
   *
   * Cloud handles all calculations - our job is just to validate:
   * - return_sales_amount: MUST NOT be null for RETURNED packs (null = error)
   * - return_sales_amount: MUST be >= 0
   * - tickets_sold_on_return: MUST NOT be null for RETURNED packs (null = error)
   * - tickets_sold_on_return: MUST be >= 0
   *
   * @security API-001: Input validation before DB operations
   * @security DB-002: Data integrity checks
   *
   * @param packDataArray - Array of mapped pack data
   * @param context - Sync context for error reporting ('received' | 'activated' | 'returned')
   * @returns Object with validated packs and validation errors
   */
  private validatePackDataIntegrity<
    T extends {
      pack_id: string;
      pack_number: string;
      game_id: string;
      status: LotteryPackStatus;
      sales_amount: number | null;
      tickets_sold_count: number | null;
      return_sales_amount: number | null;
      tickets_sold_on_return: number | null;
    },
  >(
    packDataArray: T[],
    context: 'received' | 'activated' | 'returned'
  ): { validPacks: T[]; errors: string[] } {
    const errors: string[] = [];
    const validPacks: T[] = [];

    for (const pack of packDataArray) {
      const packRef = `Pack ${pack.pack_number} (${pack.pack_id})`;
      let isValid = true;

      // RETURNED packs have stricter validation requirements
      // For RETURNED packs, we check return_sales_amount (not sales_amount)
      // NULL means there is an ERROR from cloud - DO NOT MASK IT
      if (context === 'returned' || pack.status === 'RETURNED') {
        // CRITICAL: return_sales_amount MUST NOT be null for returned packs
        // This is the $180 sales captured at return time
        if (pack.return_sales_amount === null || pack.return_sales_amount === undefined) {
          const errorMsg = `${packRef}: DATA_INTEGRITY_ERROR - return_sales_amount is null for RETURNED pack. Cloud API must provide this value.`;
          log.error('CRITICAL: Returned pack missing return_sales_amount', {
            packId: pack.pack_id,
            packNumber: pack.pack_number,
            status: pack.status,
            returnSalesAmount: pack.return_sales_amount,
            salesAmount: pack.sales_amount,
            ticketsSoldOnReturn: pack.tickets_sold_on_return,
            context,
            severity: 'CRITICAL',
            errorType: 'DATA_INTEGRITY_ERROR',
            resolution:
              'Investigate cloud API response - return_sales_amount must not be null for returned packs',
          });
          errors.push(errorMsg);
          isValid = false;
        }

        // CRITICAL: tickets_sold_on_return MUST NOT be null for returned packs
        if (pack.tickets_sold_on_return === null || pack.tickets_sold_on_return === undefined) {
          const errorMsg = `${packRef}: DATA_INTEGRITY_ERROR - tickets_sold_on_return is null for RETURNED pack. Cloud API must provide this value.`;
          log.error('CRITICAL: Returned pack missing tickets_sold_on_return', {
            packId: pack.pack_id,
            packNumber: pack.pack_number,
            status: pack.status,
            ticketsSoldOnReturn: pack.tickets_sold_on_return,
            ticketsSoldCount: pack.tickets_sold_count,
            context,
            severity: 'CRITICAL',
            errorType: 'DATA_INTEGRITY_ERROR',
            resolution:
              'Investigate cloud API response - tickets_sold_on_return must not be null for returned packs',
          });
          errors.push(errorMsg);
          isValid = false;
        }
      }

      // Universal validation: return_sales_amount must be >= 0 if present
      if (pack.return_sales_amount !== null && pack.return_sales_amount !== undefined) {
        if (pack.return_sales_amount < 0) {
          const errorMsg = `${packRef}: return_sales_amount cannot be negative (${pack.return_sales_amount})`;
          log.error('Pack has negative return_sales_amount', {
            packId: pack.pack_id,
            packNumber: pack.pack_number,
            returnSalesAmount: pack.return_sales_amount,
            errorType: 'VALIDATION_ERROR',
          });
          errors.push(errorMsg);
          isValid = false;
        }
      }

      // Universal validation: sales_amount must be >= 0 if present
      if (pack.sales_amount !== null && pack.sales_amount !== undefined) {
        if (pack.sales_amount < 0) {
          const errorMsg = `${packRef}: sales_amount cannot be negative (${pack.sales_amount})`;
          log.error('Pack has negative sales_amount', {
            packId: pack.pack_id,
            packNumber: pack.pack_number,
            salesAmount: pack.sales_amount,
            errorType: 'VALIDATION_ERROR',
          });
          errors.push(errorMsg);
          isValid = false;
        }
      }

      // Universal validation: tickets_sold_on_return must be >= 0 if present
      if (pack.tickets_sold_on_return !== null && pack.tickets_sold_on_return !== undefined) {
        if (pack.tickets_sold_on_return < 0) {
          const errorMsg = `${packRef}: tickets_sold_on_return cannot be negative (${pack.tickets_sold_on_return})`;
          log.error('Pack has negative tickets_sold_on_return', {
            packId: pack.pack_id,
            packNumber: pack.pack_number,
            ticketsSoldOnReturn: pack.tickets_sold_on_return,
            errorType: 'VALIDATION_ERROR',
          });
          errors.push(errorMsg);
          isValid = false;
        }
      }

      // Universal validation: tickets_sold_count must be >= 0 if present
      if (pack.tickets_sold_count !== null && pack.tickets_sold_count !== undefined) {
        if (pack.tickets_sold_count < 0) {
          const errorMsg = `${packRef}: tickets_sold_count cannot be negative (${pack.tickets_sold_count})`;
          log.error('Pack has negative tickets_sold_count', {
            packId: pack.pack_id,
            packNumber: pack.pack_number,
            ticketsSoldCount: pack.tickets_sold_count,
            errorType: 'VALIDATION_ERROR',
          });
          errors.push(errorMsg);
          isValid = false;
        }
      }

      if (isValid) {
        validPacks.push(pack);
      }
    }

    // Summary log for validation results
    if (errors.length > 0) {
      log.warn('Pack data integrity validation completed with errors', {
        context,
        totalPacks: packDataArray.length,
        validPacks: validPacks.length,
        rejectedPacks: packDataArray.length - validPacks.length,
        errorCount: errors.length,
      });
    }

    return { validPacks, errors };
  }

  // ==========================================================================
  // Full Sync
  // ==========================================================================

  /**
   * Sync all bidirectional entities with consolidated session management
   *
   * SYNC-5000-DESKTOP Phase 1: Uses a single session for all operations
   * - Exactly one startSyncSession call at the beginning
   * - Exactly one completeSyncSession call at the end
   * - All operations share the same session context
   * - Failure-safe completion with accurate stats
   *
   * Sync order is intentional for FK dependencies:
   * 1. Users - packs reference users (received_by, activated_by, etc.)
   * 2. Bins - packs reference bins (current_bin_id)
   * 3. Games - packs reference games (game_id)
   * 4. Packs (received → activated → returned)
   *
   * @security DB-006: Store-scoped via storeId propagation
   * @security API-003: Session always completed, even on error
   *
   * @returns Combined sync results with session lifecycle stats
   */
  async syncAllWithConsolidatedSession(): Promise<{
    cycleResult: SyncCycleResult;
    bins: BidirectionalSyncResult;
    games: BidirectionalSyncResult;
    packs: {
      received: BidirectionalSyncResult;
      activated: BidirectionalSyncResult;
      returned: BidirectionalSyncResult;
    };
  }> {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      throw new Error('Store not configured');
    }

    // Ensure cloudApiService is configured for session manager
    syncSessionManager.setCloudApiService(cloudApiService);

    log.info('Starting consolidated bidirectional sync (SYNC-5000 Phase 1)', {
      storeId: store.store_id,
    });

    // Initialize result containers
    let binsResult: BidirectionalSyncResult = { pushed: 0, pulled: 0, conflicts: 0, errors: [] };
    let gamesResult: BidirectionalSyncResult = { pushed: 0, pulled: 0, conflicts: 0, errors: [] };
    let packsResult = {
      received: { pushed: 0, pulled: 0, conflicts: 0, errors: [] } as BidirectionalSyncResult,
      activated: { pushed: 0, pulled: 0, conflicts: 0, errors: [] } as BidirectionalSyncResult,
      returned: { pushed: 0, pulled: 0, conflicts: 0, errors: [] } as BidirectionalSyncResult,
    };

    // Run all sync operations within a single session
    const cycleResult = await syncSessionManager.runSyncCycle(
      store.store_id,
      async (ctx: SyncSessionContext) => {
        const sessionOptions: SessionAwareOptions = { sessionId: ctx.sessionId };

        // Step 1: Sync users (FK dependency for packs)
        try {
          log.info('Syncing users before packs (FK dependency)', { sessionId: ctx.sessionId });
          await userSyncService.syncUsers();
          syncSessionManager.recordOperationStats('users', { pulled: 1 });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          log.warn('User sync failed, continuing with entity sync', { error: errorMsg });
          syncSessionManager.recordOperationStats('users', { errors: 1 });
        }

        // Step 2: Sync bins with session reuse
        try {
          binsResult = await this.syncBinsWithSession(sessionOptions);
          syncSessionManager.recordOperationStats('bins', {
            pulled: binsResult.pulled,
            errors: binsResult.errors.length,
          });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          binsResult.errors.push(`Bins sync failed: ${errorMsg}`);
          syncSessionManager.recordOperationStats('bins', { errors: 1 });
        }

        // Step 3: Sync games with session reuse
        try {
          gamesResult = await this.syncGamesWithSession(sessionOptions);
          syncSessionManager.recordOperationStats('games', {
            pulled: gamesResult.pulled,
            pushed: gamesResult.pushed,
            errors: gamesResult.errors.length,
          });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          gamesResult.errors.push(`Games sync failed: ${errorMsg}`);
          syncSessionManager.recordOperationStats('games', { errors: 1 });
        }

        // Step 4: Sync packs with session reuse (received → activated → returned)
        try {
          packsResult = await this.syncPacksWithSession(sessionOptions);
          syncSessionManager.recordOperationStats('packs_received', {
            pulled: packsResult.received.pulled,
            errors: packsResult.received.errors.length,
          });
          syncSessionManager.recordOperationStats('packs_activated', {
            pulled: packsResult.activated.pulled,
            errors: packsResult.activated.errors.length,
          });
          syncSessionManager.recordOperationStats('packs_returned', {
            pulled: packsResult.returned.pulled,
            errors: packsResult.returned.errors.length,
          });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          packsResult.received.errors.push(`Pack sync failed: ${errorMsg}`);
          syncSessionManager.recordOperationStats('packs', { errors: 1 });
        }
      }
    );

    log.info('Consolidated bidirectional sync completed (SYNC-5000 Phase 1)', {
      sessionSuccess: cycleResult.success,
      durationMs: cycleResult.durationMs,
      totalPulled: cycleResult.stats.pulled,
      totalPushed: cycleResult.stats.pushed,
      totalErrors: cycleResult.stats.errors,
      bins: { pulled: binsResult.pulled },
      games: { pushed: gamesResult.pushed, pulled: gamesResult.pulled },
      packs: {
        received: { pulled: packsResult.received.pulled },
        activated: { pulled: packsResult.activated.pulled },
        returned: { pulled: packsResult.returned.pulled },
      },
    });

    return {
      cycleResult,
      bins: binsResult,
      games: gamesResult,
      packs: packsResult,
    };
  }

  /**
   * Sync bins with an existing session (internal session-aware method)
   * Used by syncAllWithConsolidatedSession for session reuse
   */
  private async syncBinsWithSession(
    sessionOptions: SessionAwareOptions
  ): Promise<BidirectionalSyncResult> {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      throw new Error('Store not configured');
    }

    const result: BidirectionalSyncResult = {
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      errors: [],
    };

    const storeId = store.store_id;
    const lastPull = syncTimestampsDAL.getLastPullAt(storeId, 'bins');

    log.info('Syncing bins with session reuse', {
      storeId,
      lastPull: lastPull || 'full',
      sessionId: sessionOptions.sessionId,
    });

    try {
      // Pull bins with session reuse
      const pullResponse = await cloudApiService.pullBins(lastPull || undefined, sessionOptions);

      const cloudBins = pullResponse.bins || [];

      if (cloudBins.length === 0) {
        log.info('No bins to sync from cloud (session reuse)');
        return result;
      }

      // Same processing logic as syncBins()
      const activeBins = cloudBins.filter((bin) => !bin.deleted_at);
      const activeCloudIds = new Set<string>(activeBins.map((b) => b.bin_id));

      if (activeBins.length > 0) {
        const binData = activeBins.map((cloudBin) => ({
          bin_id: cloudBin.bin_id,
          store_id: storeId,
          name: cloudBin.name,
          location: cloudBin.location,
          display_order: cloudBin.display_order ?? 0,
          is_active: cloudBin.is_active ?? true,
        }));

        const upsertResult = lotteryBinsDAL.batchUpsertFromCloud(binData, storeId);
        result.pulled += upsertResult.created + upsertResult.updated;
        result.errors.push(...upsertResult.errors);
      }

      // Soft delete bins not in cloud
      const deletedCount = lotteryBinsDAL.batchSoftDeleteNotInCloudIds(storeId, activeCloudIds);
      if (deletedCount > 0) {
        log.info('Bins removed from cloud soft deleted locally', { deletedCount });
      }

      // Update timestamp on success
      if (result.errors.length === 0) {
        syncTimestampsDAL.setLastPullAt(storeId, 'bins', new Date().toISOString());
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Pull failed: ${message}`);
      throw error;
    }
  }

  /**
   * Sync games with an existing session (internal session-aware method)
   * Used by syncAllWithConsolidatedSession for session reuse
   */
  private async syncGamesWithSession(
    sessionOptions: SessionAwareOptions
  ): Promise<BidirectionalSyncResult> {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      throw new Error('Store not configured');
    }

    const result: BidirectionalSyncResult = {
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      errors: [],
    };

    const storeId = store.store_id;
    const stateId = store.state_id || null;
    const lastPull = syncTimestampsDAL.getLastPullAt(storeId, 'games');

    log.info('Syncing games with session reuse', {
      storeId,
      stateId,
      lastPull: lastPull || 'full',
      sessionId: sessionOptions.sessionId,
    });

    try {
      // Pull games with session reuse
      const pullResponse = await cloudApiService.pullLotteryGames(
        stateId,
        lastPull || undefined,
        sessionOptions
      );

      const cloudGames = pullResponse.games || [];

      // Apply cloud changes with last-write-wins
      for (const cloudGame of cloudGames) {
        try {
          const localGame = lotteryGamesDAL.findById(cloudGame.game_id);
          let shouldUpdate = true;

          if (localGame) {
            const cloudTime = new Date(cloudGame.updated_at);
            const localTime = new Date(localGame.updated_at);
            if (localTime >= cloudTime) {
              shouldUpdate = false;
              result.conflicts++;
            }
          }

          if (shouldUpdate) {
            lotteryGamesDAL.upsertFromCloud({
              game_id: cloudGame.game_id,
              store_id: storeId,
              game_code: cloudGame.game_code,
              name: cloudGame.name,
              price: cloudGame.price,
              pack_value: cloudGame.pack_value,
              tickets_per_pack: cloudGame.tickets_per_pack,
              status: cloudGame.status,
              updated_at: cloudGame.updated_at,
            });
            result.pulled++;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`Apply game ${cloudGame.game_id}: ${message}`);
        }
      }

      // Update timestamp on success
      syncTimestampsDAL.setLastPullAt(storeId, 'games', new Date().toISOString());

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Pull failed: ${message}`);
      throw error;
    }
  }

  /**
   * Sync all packs with an existing session (internal session-aware method)
   * Used by syncAllWithConsolidatedSession for session reuse
   */
  private async syncPacksWithSession(sessionOptions: SessionAwareOptions): Promise<{
    received: BidirectionalSyncResult;
    activated: BidirectionalSyncResult;
    returned: BidirectionalSyncResult;
  }> {
    const received = await this.syncReceivedPacksWithSession(sessionOptions);
    const activated = await this.syncActivatedPacksWithSession(sessionOptions);
    const returned = await this.syncReturnedPacksWithSession(sessionOptions);

    return { received, activated, returned };
  }

  /**
   * Sync received packs with an existing session
   */
  private async syncReceivedPacksWithSession(
    sessionOptions: SessionAwareOptions
  ): Promise<BidirectionalSyncResult> {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      throw new Error('Store not configured');
    }

    const result: BidirectionalSyncResult = { pushed: 0, pulled: 0, conflicts: 0, errors: [] };
    const storeId = store.store_id;
    const lastPull = syncTimestampsDAL.getLastPullAt(storeId, 'packs_received');

    try {
      let hasMore = true;
      let sinceSequence: number | undefined;
      const MAX_PAGES = 100;

      for (let page = 0; hasMore && page < MAX_PAGES; page++) {
        const pullResponse = await cloudApiService.pullReceivedPacks(
          { since: lastPull || undefined, sinceSequence, limit: 500 },
          sessionOptions
        );

        const cloudPacks = pullResponse.packs || [];
        if (cloudPacks.length === 0 && page === 0) break;

        const mappedPacks = cloudPacks.map((cp) => this.mapCloudPackToLocal(cp, storeId));
        const validatedPacks = this.validateUserForeignKeysBatch(mappedPacks);

        if (validatedPacks.length > 0) {
          const upsertResult = lotteryPacksDAL.batchUpsertFromCloud(validatedPacks, storeId);
          result.pulled += upsertResult.created + upsertResult.updated;
          result.errors.push(...upsertResult.errors);
        }

        hasMore = pullResponse.syncMetadata.hasMore;
        sinceSequence = pullResponse.syncMetadata.lastSequence;
      }

      if (result.errors.length === 0) {
        syncTimestampsDAL.setLastPullAt(storeId, 'packs_received', new Date().toISOString());
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Pull received packs failed: ${message}`);
      return result;
    }
  }

  /**
   * Sync activated packs with an existing session
   */
  private async syncActivatedPacksWithSession(
    sessionOptions: SessionAwareOptions
  ): Promise<BidirectionalSyncResult> {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      throw new Error('Store not configured');
    }

    const result: BidirectionalSyncResult = { pushed: 0, pulled: 0, conflicts: 0, errors: [] };
    const storeId = store.store_id;
    const lastPull = syncTimestampsDAL.getLastPullAt(storeId, 'packs_activated');

    try {
      let hasMore = true;
      let sinceSequence: number | undefined;
      const MAX_PAGES = 100;

      for (let page = 0; hasMore && page < MAX_PAGES; page++) {
        const pullResponse = await cloudApiService.pullActivatedPacks(
          { since: lastPull || undefined, sinceSequence, limit: 500 },
          sessionOptions
        );

        const cloudPacks = pullResponse.packs || [];
        if (cloudPacks.length === 0 && page === 0) break;

        const mappedPacks = cloudPacks.map((cp) => this.mapCloudPackToLocal(cp, storeId));
        const validatedPacks = this.validateUserForeignKeysBatch(mappedPacks);

        if (validatedPacks.length > 0) {
          const upsertResult = lotteryPacksDAL.batchUpsertFromCloud(validatedPacks, storeId);
          result.pulled += upsertResult.created + upsertResult.updated;
          result.errors.push(...upsertResult.errors);
        }

        hasMore = pullResponse.syncMetadata.hasMore;
        sinceSequence = pullResponse.syncMetadata.lastSequence;
      }

      if (result.errors.length === 0) {
        syncTimestampsDAL.setLastPullAt(storeId, 'packs_activated', new Date().toISOString());
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Pull activated packs failed: ${message}`);
      return result;
    }
  }

  /**
   * Sync returned packs with an existing session
   */
  private async syncReturnedPacksWithSession(
    sessionOptions: SessionAwareOptions
  ): Promise<BidirectionalSyncResult> {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      throw new Error('Store not configured');
    }

    const result: BidirectionalSyncResult = { pushed: 0, pulled: 0, conflicts: 0, errors: [] };
    const storeId = store.store_id;
    const lastPull = syncTimestampsDAL.getLastPullAt(storeId, 'packs_returned');

    try {
      let hasMore = true;
      let sinceSequence: number | undefined;
      const MAX_PAGES = 100;

      for (let page = 0; hasMore && page < MAX_PAGES; page++) {
        const pullResponse = await cloudApiService.pullReturnedPacks(
          { since: lastPull || undefined, sinceSequence, limit: 500 },
          sessionOptions
        );

        const cloudPacks = pullResponse.packs || [];
        if (cloudPacks.length === 0 && page === 0) break;

        const mappedPacks = cloudPacks.map((cp) => this.mapCloudPackToLocal(cp, storeId));
        const fkValidatedPacks = this.validateUserForeignKeysBatch(mappedPacks);
        const { validPacks, errors } = this.validatePackDataIntegrity(fkValidatedPacks, 'returned');
        result.errors.push(...errors);

        if (validPacks.length > 0) {
          const upsertResult = lotteryPacksDAL.batchUpsertFromCloud(validPacks, storeId);
          result.pulled += upsertResult.created + upsertResult.updated;
          result.errors.push(...upsertResult.errors);
        }

        hasMore = pullResponse.syncMetadata.hasMore;
        sinceSequence = pullResponse.syncMetadata.lastSequence;
      }

      if (result.errors.length === 0) {
        syncTimestampsDAL.setLastPullAt(storeId, 'packs_returned', new Date().toISOString());
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Pull returned packs failed: ${message}`);
      return result;
    }
  }

  /**
   * Sync all bidirectional entities (bins, games, and packs)
   *
   * Sync order is intentional for FK dependencies:
   * 1. Users - packs reference users (received_by, activated_by, etc.)
   * 2. Bins - packs reference bins (current_bin_id)
   * 3. Games - packs reference games (game_id)
   * 4. Packs (received → activated → returned)
   *
   * @deprecated Use syncAllWithConsolidatedSession() for SYNC-5000 compliance
   * @returns Combined sync results
   */
  async syncAll(): Promise<{
    bins: BidirectionalSyncResult;
    games: BidirectionalSyncResult;
    packs: {
      received: BidirectionalSyncResult;
      activated: BidirectionalSyncResult;
      returned: BidirectionalSyncResult;
    };
  }> {
    log.info('Starting full bidirectional sync');

    // Sync users FIRST - packs have FK references to users (received_by, activated_by, etc.)
    // Users must exist in local DB before packs can be inserted
    try {
      log.info('Syncing users before packs (FK dependency)');
      await userSyncService.syncUsers();
    } catch (error) {
      log.warn('User sync failed, continuing with entity sync', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    const bins = await this.syncBins();
    const games = await this.syncGames();
    const packs = await this.syncPacks();

    log.info('Full bidirectional sync completed', {
      bins: { pushed: bins.pushed, pulled: bins.pulled },
      games: { pushed: games.pushed, pulled: games.pulled },
      packs: {
        received: { pulled: packs.received.pulled },
        activated: { pulled: packs.activated.pulled },
        returned: { pulled: packs.returned.pulled },
      },
    });

    return { bins, games, packs };
  }

  /**
   * Force a full sync by resetting timestamps
   * Use with caution - will re-sync all data
   *
   * @returns Combined sync results
   */
  async forceFullSync(): Promise<{
    bins: BidirectionalSyncResult;
    games: BidirectionalSyncResult;
    packs: {
      received: BidirectionalSyncResult;
      activated: BidirectionalSyncResult;
      returned: BidirectionalSyncResult;
    };
  }> {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      throw new Error('Store not configured');
    }

    log.warn('Force full sync initiated', { storeId: store.store_id });

    // Reset timestamps to trigger full sync
    syncTimestampsDAL.reset(store.store_id, 'bins');
    syncTimestampsDAL.reset(store.store_id, 'games');
    syncTimestampsDAL.reset(store.store_id, 'packs_received');
    syncTimestampsDAL.reset(store.store_id, 'packs_activated');
    syncTimestampsDAL.reset(store.store_id, 'packs_returned');

    return this.syncAll();
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
   * Note: For Bins/Games PULL sync, all errors go to DLQ immediately regardless
   * of category. Category is for troubleshooting visibility only.
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
 * Singleton instance for bidirectional sync operations
 */
export const bidirectionalSyncService = new BidirectionalSyncService();
