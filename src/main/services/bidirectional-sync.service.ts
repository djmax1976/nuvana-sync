/**
 * Bidirectional Sync Service
 *
 * Handles synchronization for reference data and pack entities:
 * - Bins: Pull-only from cloud (no push endpoint in API spec)
 * - Games: Bidirectional sync (push and pull)
 * - Packs: Pull-only for RECEIVED and ACTIVATED states (push via sync-queue)
 *
 * API spec reference:
 * - GET /api/v1/sync/lottery/bins (pull only - no POST endpoint)
 * - GET/POST /api/v1/sync/lottery/games (bidirectional)
 * - GET /api/v1/sync/lottery/packs/received (pull only)
 * - GET /api/v1/sync/lottery/packs/activated (pull only)
 *
 * @module main/services/bidirectional-sync
 * @security DB-006: Store-scoped for tenant isolation
 * @security SEC-006: Parameterized queries via DAL
 * @security API-003: Centralized error handling
 */

import { cloudApiService, type CloudGame, type CloudPack } from './cloud-api.service';
import { userSyncService } from './user-sync.service';
import { lotteryBinsDAL } from '../dal/lottery-bins.dal';
import { lotteryGamesDAL } from '../dal/lottery-games.dal';
import { lotteryPacksDAL, type LotteryPackStatus } from '../dal/lottery-packs.dal';
import { syncTimestampsDAL } from '../dal/sync-timestamps.dal';
import { syncQueueDAL, type SyncApiContext } from '../dal/sync-queue.dal';
import { storesDAL } from '../dal/stores.dal';
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

    // Create PULL queue entry for sync monitor tracking
    const pullQueueItem = syncQueueDAL.enqueue({
      store_id: storeId,
      entity_type: 'bin',
      entity_id: `pull-${Date.now()}`,
      operation: 'UPDATE',
      payload: { action: 'pull_bins', timestamp: new Date().toISOString(), lastPull },
      sync_direction: 'PULL',
    });

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

        // Cleanup stale PULL tracking items from previous failed/reset operations
        // Prevents accumulation of pending items that will never be retried
        syncQueueDAL.cleanupStalePullTracking(storeId, 'pull_bins', pullQueueItem.id);

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

      // Cleanup stale PULL tracking items from previous failed/reset operations
      // Prevents accumulation of pending items that will never be retried
      syncQueueDAL.cleanupStalePullTracking(storeId, 'pull_bins', pullQueueItem.id);

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Pull failed: ${message}`);
      log.error('Bins sync failed', { error: message });

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

    // Create PULL queue entry for sync monitor tracking
    const pullQueueItem = syncQueueDAL.enqueue({
      store_id: storeId,
      entity_type: 'game',
      entity_id: `pull-${Date.now()}`,
      operation: 'UPDATE',
      payload: { action: 'pull_games', timestamp: new Date().toISOString(), lastPull, stateId },
      sync_direction: 'PULL',
    });

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

        // Step 4: Apply cloud changes with last-write-wins
        for (const cloudGame of pullResponse.games) {
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
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown pull error';
        result.errors.push(`Pull failed: ${message}`);
        log.error('Failed to pull games', { error: message });
      }

      // Step 5: Update sync timestamp
      if (result.errors.length === 0) {
        syncTimestampsDAL.setLastPullAt(storeId, 'games', new Date().toISOString());
      }

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

      // Cleanup stale PULL tracking items from previous failed/reset operations
      // Prevents accumulation of pending items that will never be retried
      syncQueueDAL.cleanupStalePullTracking(storeId, 'pull_games', pullQueueItem.id);

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Games sync failed', { error: message });

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

    // Create PULL queue entry for sync monitor tracking
    const pullQueueItem = syncQueueDAL.enqueue({
      store_id: storeId,
      entity_type: 'pack',
      entity_id: `pull-received-${Date.now()}`,
      operation: 'UPDATE',
      payload: { action: 'pull_received_packs', timestamp: new Date().toISOString(), lastPull },
      sync_direction: 'PULL',
    });

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
        const packData = cloudPacks.map((cloudPack) =>
          this.mapCloudPackToLocal(cloudPack, storeId)
        );

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

      // Cleanup stale PULL tracking items from previous failed/reset operations
      // Prevents accumulation of pending items that will never be retried
      syncQueueDAL.cleanupStalePullTracking(storeId, 'pull_received_packs', pullQueueItem.id);

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

    // Create PULL queue entry for sync monitor tracking
    const pullQueueItem = syncQueueDAL.enqueue({
      store_id: storeId,
      entity_type: 'pack',
      entity_id: `pull-activated-${Date.now()}`,
      operation: 'UPDATE',
      payload: { action: 'pull_activated_packs', timestamp: new Date().toISOString(), lastPull },
      sync_direction: 'PULL',
    });

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
        const packData = cloudPacks.map((cloudPack) =>
          this.mapCloudPackToLocal(cloudPack, storeId)
        );

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

      // Cleanup stale PULL tracking items from previous failed/reset operations
      // Prevents accumulation of pending items that will never be retried
      syncQueueDAL.cleanupStalePullTracking(storeId, 'pull_activated_packs', pullQueueItem.id);

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
   * Sync all packs (received and activated) from cloud
   *
   * @returns Combined sync results for all pack types
   */
  async syncPacks(): Promise<{
    received: BidirectionalSyncResult;
    activated: BidirectionalSyncResult;
  }> {
    log.info('Starting full packs sync');

    const received = await this.syncReceivedPacks();
    const activated = await this.syncActivatedPacks();

    log.info('Full packs sync completed', {
      received: { pulled: received.pulled, errors: received.errors.length },
      activated: { pulled: activated.pulled, errors: activated.errors.length },
    });

    return { received, activated };
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

  // ==========================================================================
  // Full Sync
  // ==========================================================================

  /**
   * Sync all bidirectional entities (bins, games, and packs)
   *
   * @returns Combined sync results
   */
  async syncAll(): Promise<{
    bins: BidirectionalSyncResult;
    games: BidirectionalSyncResult;
    packs: {
      received: BidirectionalSyncResult;
      activated: BidirectionalSyncResult;
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
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for bidirectional sync operations
 */
export const bidirectionalSyncService = new BidirectionalSyncService();
