/**
 * Bidirectional Sync Service
 *
 * Implements bi-directional synchronization for entities that need
 * to be managed both locally and from the cloud (bins, games).
 *
 * Uses last-write-wins conflict resolution strategy.
 *
 * @module main/services/bidirectional-sync
 * @security DB-006: Store-scoped for tenant isolation
 * @security SEC-006: Parameterized queries via DAL
 * @security API-003: Centralized error handling
 */

import { cloudApiService, type CloudBin, type CloudGame } from './cloud-api.service';
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
 * Implements push-then-pull sync pattern:
 * 1. Push local changes to cloud
 * 2. Pull cloud changes locally
 * 3. Apply cloud changes with last-write-wins conflict resolution
 *
 * Conflict Resolution:
 * - Cloud always wins on conflicts (last-write-wins)
 * - If local updated_at > cloud updated_at, local change was already pushed
 * - If cloud updated_at > local updated_at, cloud wins
 */
export class BidirectionalSyncService {
  // ==========================================================================
  // Bins Sync
  // ==========================================================================

  /**
   * Sync lottery bins bidirectionally
   * DB-006: Store-scoped operations
   *
   * @returns Sync result with counts
   */
  async syncBins(): Promise<BidirectionalSyncResult> {
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

    log.info('Starting bins sync', { storeId, lastPull: lastPull || 'full' });

    try {
      // Step 1: Get local changes since last pull
      const localBins = lotteryBinsDAL.findAllByStore(storeId);
      const localChanges = lastPull
        ? localBins.filter((bin) => new Date(bin.updated_at) > new Date(lastPull))
        : [];

      // Step 2: Push local changes to cloud
      if (localChanges.length > 0) {
        try {
          const pushData: CloudBin[] = localChanges.map((bin) => ({
            bin_id: bin.cloud_bin_id || bin.bin_id,
            store_id: bin.store_id,
            bin_number: bin.bin_number,
            label: bin.label || undefined,
            status: bin.status,
            updated_at: bin.updated_at,
            deleted_at: bin.deleted_at || undefined,
          }));

          const pushResult = await cloudApiService.pushBins(pushData);
          result.pushed = pushResult.results.filter((r) => r.status === 'synced').length;

          log.debug('Bins pushed to cloud', {
            attempted: localChanges.length,
            succeeded: result.pushed,
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown push error';
          result.errors.push(`Push failed: ${message}`);
          log.error('Failed to push bins', { error: message });
        }
      }

      // Step 3: Pull cloud changes
      try {
        const pullResponse = await cloudApiService.pullBins(lastPull || undefined);

        log.debug('Bins pull response received', {
          binsCount: pullResponse.bins?.length ?? 0,
          totalCount: pullResponse.totalCount,
          hasBins: Array.isArray(pullResponse.bins),
          firstBin: pullResponse.bins?.[0] ? JSON.stringify(pullResponse.bins[0]) : 'none',
        });

        // Step 4: Apply cloud changes with last-write-wins
        for (const cloudBin of pullResponse.bins || []) {
          try {
            const localBin = lotteryBinsDAL.findByCloudId(cloudBin.bin_id);

            // Check if update is needed
            let shouldUpdate = true;
            if (localBin) {
              const cloudTime = new Date(cloudBin.updated_at);
              const localTime = new Date(localBin.updated_at);

              if (localTime >= cloudTime) {
                // Local is same or newer - skip (already pushed or conflict)
                shouldUpdate = false;
                result.conflicts++;
                log.debug('Skipping bin (local is newer)', {
                  binId: cloudBin.bin_id,
                  cloudTime: cloudBin.updated_at,
                  localTime: localBin.updated_at,
                });
              }
            }

            if (shouldUpdate) {
              if (cloudBin.deleted_at) {
                // Handle deletion
                lotteryBinsDAL.softDelete(localBin?.bin_id || cloudBin.bin_id);
              } else {
                // Upsert from cloud
                lotteryBinsDAL.upsertFromCloud({
                  cloud_bin_id: cloudBin.bin_id,
                  store_id: storeId,
                  bin_number: cloudBin.bin_number,
                  label: cloudBin.label,
                  status: cloudBin.status,
                });
              }
              result.pulled++;
            }
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown apply error';
            result.errors.push(`Apply bin ${cloudBin.bin_id}: ${message}`);
            log.error('Failed to apply bin from cloud', {
              binId: cloudBin.bin_id,
              error: message,
            });
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown pull error';
        result.errors.push(`Pull failed: ${message}`);
        log.error('Failed to pull bins', { error: message });
      }

      // Step 5: Update sync timestamp
      if (result.errors.length === 0) {
        syncTimestampsDAL.setLastPullAt(storeId, 'bins', new Date().toISOString());
      }

      log.info('Bins sync completed', {
        pushed: result.pushed,
        pulled: result.pulled,
        conflicts: result.conflicts,
        errors: result.errors.length,
      });

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Bins sync failed', { error: message });
      throw error;
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
