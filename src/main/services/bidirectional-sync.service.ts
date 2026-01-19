/**
 * Bidirectional Sync Service
 *
 * Handles synchronization for reference data entities:
 * - Bins: Pull-only from cloud (no push endpoint in API spec)
 * - Games: Bidirectional sync (push and pull)
 *
 * API spec reference:
 * - GET /api/v1/sync/lottery/bins (pull only - no POST endpoint)
 * - GET/POST /api/v1/sync/lottery/games (bidirectional)
 *
 * @module main/services/bidirectional-sync
 * @security DB-006: Store-scoped for tenant isolation
 * @security SEC-006: Parameterized queries via DAL
 * @security API-003: Centralized error handling
 */

import { cloudApiService, type CloudGame } from './cloud-api.service';
import { lotteryBinsDAL } from '../dal/lottery-bins.dal';
import { lotteryGamesDAL } from '../dal/lottery-games.dal';
import { syncTimestampsDAL } from '../dal/sync-timestamps.dal';
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
        return result;
      }

      // Separate active and deleted bins
      const activeBins = cloudBins.filter((bin) => !bin.deleted_at);
      const deletedBins = cloudBins.filter((bin) => bin.deleted_at);

      // Track cloud IDs for deletion check
      const activeCloudIds = new Set<string>(activeBins.map((b) => b.bin_id));

      // Step 1: Batch upsert active bins (eliminates N+1)
      if (activeBins.length > 0) {
        const binData = activeBins.map((cloudBin) => ({
          cloud_bin_id: cloudBin.bin_id,
          store_id: storeId, // DB-006: Always use configured store ID
          bin_number: cloudBin.bin_number,
          label: cloudBin.label,
          status: cloudBin.status,
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
      // (bins with cloud_bin_id that are no longer in cloud response)
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

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Pull failed: ${message}`);
      log.error('Bins sync failed', { error: message });
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
    const lastPull = syncTimestampsDAL.getLastPullAt(storeId, 'games');

    log.info('Starting games sync', { storeId, lastPull: lastPull || 'full' });

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
            game_id: game.cloud_game_id || game.game_id,
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
      try {
        const pullResponse = await cloudApiService.pullGames(lastPull || undefined);

        // Step 4: Apply cloud changes with last-write-wins
        for (const cloudGame of pullResponse.games) {
          try {
            const localGame = lotteryGamesDAL.findByCloudId(cloudGame.game_id);

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
              // Upsert from cloud
              lotteryGamesDAL.upsertFromCloud({
                cloud_game_id: cloudGame.game_id,
                store_id: storeId,
                game_code: cloudGame.game_code,
                name: cloudGame.name,
                price: cloudGame.price,
                pack_value: cloudGame.pack_value,
                tickets_per_pack: cloudGame.tickets_per_pack,
                status: cloudGame.status,
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

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Games sync failed', { error: message });
      throw error;
    }
  }

  // ==========================================================================
  // Full Sync
  // ==========================================================================

  /**
   * Sync all bidirectional entities (bins and games)
   *
   * @returns Combined sync results
   */
  async syncAll(): Promise<{
    bins: BidirectionalSyncResult;
    games: BidirectionalSyncResult;
  }> {
    log.info('Starting full bidirectional sync');

    const bins = await this.syncBins();
    const games = await this.syncGames();

    log.info('Full bidirectional sync completed', {
      bins: { pushed: bins.pushed, pulled: bins.pulled },
      games: { pushed: games.pushed, pulled: games.pulled },
    });

    return { bins, games };
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
  }> {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      throw new Error('Store not configured');
    }

    log.warn('Force full sync initiated', { storeId: store.store_id });

    // Reset timestamps to trigger full sync
    syncTimestampsDAL.reset(store.store_id, 'bins');
    syncTimestampsDAL.reset(store.store_id, 'games');

    return this.syncAll();
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for bidirectional sync operations
 */
export const bidirectionalSyncService = new BidirectionalSyncService();
