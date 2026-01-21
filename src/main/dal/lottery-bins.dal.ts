/**
 * Lottery Bins Data Access Layer
 *
 * CRUD operations for lottery bin/slot management.
 * Bins are physical locations where lottery packs are displayed.
 *
 * @module main/dal/lottery-bins
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Lottery bin entity
 * Cloud-aligned schema after v039 migration:
 * - name: Display name (replaces label)
 * - location: Physical location description
 * - display_order: UI sort order
 * - is_active: Boolean (replaces status enum)
 *
 * Note: After v037 migration, bin_id contains the cloud's UUID directly
 */
export interface LotteryBin extends StoreEntity {
  bin_id: string;
  store_id: string;
  name: string;
  location: string | null;
  display_order: number;
  is_active: number; // SQLite boolean: 1 = active, 0 = inactive
  deleted_at: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Bin creation data (cloud-aligned)
 */
export interface CreateLotteryBinData {
  bin_id?: string;
  store_id: string;
  name: string;
  location?: string;
  display_order?: number;
  is_active?: boolean;
}

/**
 * Bin update data (cloud-aligned)
 */
export interface UpdateLotteryBinData {
  name?: string;
  location?: string;
  display_order?: number;
  is_active?: boolean;
}

/**
 * Cloud bin sync data (matches cloud API schema exactly)
 * Note: After v037 migration, bin_id is the cloud's UUID (no separate cloud_bin_id)
 */
export interface CloudBinData {
  bin_id: string;
  store_id: string;
  name: string;
  location?: string;
  display_order?: number;
  is_active?: boolean;
}

/**
 * Bin with current pack information (cloud-aligned)
 */
export interface BinWithPack extends LotteryBin {
  pack_id: string | null;
  pack_number: string | null;
  game_name: string | null;
  game_price: number | null;
}

/**
 * Helper to convert SQLite integer to boolean
 */
function sqliteBoolToJs(value: number | null | undefined): boolean {
  return value === 1;
}

/**
 * Helper to convert boolean to SQLite integer
 */
function jsBoolToSqlite(value: boolean | undefined): number {
  return value === false ? 0 : 1;
}

/**
 * Full pack details for day bins display
 * SEC-014: All fields are explicitly typed
 */
export interface DayBinPackDetails {
  pack_id: string;
  pack_number: string;
  game_name: string;
  game_price: number;
  /** Actual opening serial from pack record (not hardcoded) */
  starting_serial: string;
  /** Current ending serial if set during day close */
  ending_serial: string | null;
  /** Pack's last ticket serial (tickets_per_pack - 1), padded to 3 digits */
  serial_end: string;
  /** Whether this is first period of day (no prior closing) */
  is_first_period: boolean;
  /** Pack status for UI logic */
  status: string;
  /** When pack was activated */
  activated_at: string | null;
}

/**
 * Day bin with full pack details
 * Enterprise-grade structure for day bins display
 */
export interface DayBinWithFullDetails {
  bin_id: string;
  bin_number: number;
  name: string;
  is_active: boolean;
  pack: DayBinPackDetails | null;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('lottery-bins-dal');

// ============================================================================
// Lottery Bins DAL
// ============================================================================

/**
 * Data Access Layer for lottery bin management
 *
 * SEC-006: All queries use prepared statements
 * DB-006: All queries scoped by store_id
 */
export class LotteryBinsDAL extends StoreBasedDAL<LotteryBin> {
  protected readonly tableName = 'lottery_bins';
  protected readonly primaryKey = 'bin_id';

  protected readonly sortableColumns = new Set([
    'created_at',
    'updated_at',
    'name',
    'display_order',
    'is_active',
  ]);

  /**
   * Create a new lottery bin
   * SEC-006: Parameterized INSERT
   * Cloud-aligned schema: uses name, location, display_order, is_active
   *
   * @param data - Bin creation data
   * @returns Created bin
   */
  create(data: CreateLotteryBinData): LotteryBin {
    const binId = data.bin_id || this.generateId();
    const now = this.now();

    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      INSERT INTO lottery_bins (
        bin_id, store_id, name, location, display_order, is_active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      binId,
      data.store_id,
      data.name,
      data.location || null,
      data.display_order ?? 0,
      jsBoolToSqlite(data.is_active),
      now,
      now
    );

    log.info('Lottery bin created', {
      binId,
      storeId: data.store_id,
      name: data.name,
    });

    const created = this.findById(binId);
    if (!created) {
      throw new Error(`Failed to retrieve created bin: ${binId}`);
    }
    return created;
  }

  /**
   * Update an existing bin
   * SEC-006: Parameterized UPDATE
   * Cloud-aligned schema: uses name, location, display_order, is_active
   *
   * @param binId - Bin ID to update
   * @param data - Fields to update
   * @returns Updated bin or undefined
   */
  update(binId: string, data: UpdateLotteryBinData): LotteryBin | undefined {
    const now = this.now();

    const updates: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.location !== undefined) {
      updates.push('location = ?');
      params.push(data.location);
    }
    if (data.display_order !== undefined) {
      updates.push('display_order = ?');
      params.push(data.display_order);
    }
    if (data.is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(jsBoolToSqlite(data.is_active));
    }

    params.push(binId);

    const stmt = this.db.prepare(`
      UPDATE lottery_bins SET ${updates.join(', ')} WHERE bin_id = ?
    `);

    const result = stmt.run(...params);

    if (result.changes === 0) {
      return undefined;
    }

    log.info('Lottery bin updated', { binId });
    return this.findById(binId);
  }

  /**
   * Find active bins by store (not deleted)
   * DB-006: Store-scoped query
   * Cloud-aligned: uses is_active=1 instead of status='ACTIVE'
   *
   * @param storeId - Store identifier
   * @returns Array of active bins ordered by display_order
   */
  findActiveByStore(storeId: string): LotteryBin[] {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_bins
      WHERE store_id = ? AND is_active = 1 AND deleted_at IS NULL
      ORDER BY display_order ASC, name ASC
    `);
    return stmt.all(storeId) as LotteryBin[];
  }

  /**
   * Find all bins by store (including inactive, excluding deleted)
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @returns Array of bins ordered by display_order
   */
  findAllByStore(storeId: string): LotteryBin[] {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_bins
      WHERE store_id = ? AND deleted_at IS NULL
      ORDER BY display_order ASC, name ASC
    `);
    return stmt.all(storeId) as LotteryBin[];
  }

  /**
   * Find bin by name within a store
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param name - Bin name to search
   * @returns Bin or undefined
   */
  findByName(storeId: string, name: string): LotteryBin | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_bins
      WHERE store_id = ? AND name = ? AND deleted_at IS NULL
    `);
    return stmt.get(storeId, name) as LotteryBin | undefined;
  }

  /**
   * Find bin by cloud ID (now same as bin_id after v037 migration)
   * Used for cloud sync matching - delegates to findById
   * SEC-006: Parameterized query
   *
   * @param cloudBinId - Cloud bin identifier (same as bin_id)
   * @returns Bin or undefined
   */
  findByCloudId(cloudBinId: string): LotteryBin | undefined {
    // After v037 migration, bin_id IS the cloud's UUID
    return this.findById(cloudBinId);
  }

  /**
   * Get count of active packs in a bin
   * SEC-006: Parameterized query
   *
   * @param binId - Bin ID
   * @returns Number of active packs
   */
  getPackCount(binId: string): number {
    // v029 API Alignment: Uses current_bin_id
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM lottery_packs
      WHERE current_bin_id = ? AND status = 'ACTIVE'
    `);
    const result = stmt.get(binId) as { count: number };
    return result.count;
  }

  /**
   * Get bins with their current pack information
   * SEC-006: Parameterized query with JOIN
   * Cloud-aligned: ordered by display_order instead of bin_number
   *
   * @param storeId - Store identifier
   * @returns Array of bins with pack info
   */
  findBinsWithPacks(storeId: string): BinWithPack[] {
    // v029 API Alignment: Uses current_bin_id for JOIN
    const stmt = this.db.prepare(`
      SELECT
        b.*,
        p.pack_id,
        p.pack_number,
        g.name as game_name,
        g.price as game_price
      FROM lottery_bins b
      LEFT JOIN lottery_packs p ON p.current_bin_id = b.bin_id AND p.status = 'ACTIVE'
      LEFT JOIN lottery_games g ON p.game_id = g.game_id
      WHERE b.store_id = ? AND b.deleted_at IS NULL
      ORDER BY b.display_order ASC, b.name ASC
    `);
    return stmt.all(storeId) as BinWithPack[];
  }

  /**
   * Upsert bin from cloud sync
   * Creates if not exists, updates if exists (by bin_id which is cloud's UUID)
   * SEC-006: Parameterized queries
   * Cloud-aligned: uses name, location, display_order, is_active
   *
   * @param data - Cloud bin data
   * @returns Upserted bin
   */
  upsertFromCloud(data: CloudBinData): LotteryBin {
    // After v037 migration, bin_id IS the cloud's UUID
    const existing = this.findById(data.bin_id);
    const now = this.now();

    if (existing) {
      // Update existing bin
      const stmt = this.db.prepare(`
        UPDATE lottery_bins SET
          name = ?,
          location = ?,
          display_order = ?,
          is_active = ?,
          synced_at = ?,
          updated_at = ?
        WHERE bin_id = ?
      `);

      stmt.run(
        data.name,
        data.location || null,
        data.display_order ?? 0,
        jsBoolToSqlite(data.is_active),
        now,
        now,
        data.bin_id
      );

      log.info('Lottery bin updated from cloud', { binId: data.bin_id });
      const updated = this.findById(data.bin_id);
      if (!updated) {
        throw new Error(`Failed to retrieve updated bin from cloud: ${data.bin_id}`);
      }
      return updated;
    }

    // Create new bin using cloud's bin_id directly
    const stmt = this.db.prepare(`
      INSERT INTO lottery_bins (
        bin_id, store_id, name, location, display_order, is_active,
        synced_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      data.bin_id, // Use cloud's bin_id directly as PK
      data.store_id,
      data.name,
      data.location || null,
      data.display_order ?? 0,
      jsBoolToSqlite(data.is_active),
      now,
      now,
      now
    );

    log.info('Lottery bin created from cloud', { binId: data.bin_id });

    const created = this.findById(data.bin_id);
    if (!created) {
      throw new Error(`Failed to retrieve created bin from cloud: ${data.bin_id}`);
    }
    return created;
  }

  /**
   * Find multiple bins by bin IDs (batch operation)
   * Enterprise-grade: Eliminates N+1 queries during sync
   * SEC-006: Parameterized IN clause with placeholders
   * Performance: Single query for all IDs
   *
   * Note: After v037 migration, bin_id IS the cloud's UUID
   *
   * @param binIds - Array of bin identifiers (cloud UUIDs)
   * @returns Map of bin_id -> LotteryBin for efficient lookup
   */
  findByCloudIds(binIds: string[]): Map<string, LotteryBin> {
    const result = new Map<string, LotteryBin>();

    if (binIds.length === 0) {
      return result;
    }

    // SEC-006: Batch in chunks to avoid SQLite parameter limits (max ~999)
    const CHUNK_SIZE = 500;
    for (let i = 0; i < binIds.length; i += CHUNK_SIZE) {
      const chunk = binIds.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(', ');

      const stmt = this.db.prepare(`
        SELECT * FROM lottery_bins WHERE bin_id IN (${placeholders})
      `);

      const bins = stmt.all(...chunk) as LotteryBin[];

      for (const bin of bins) {
        result.set(bin.bin_id, bin);
      }
    }

    log.debug('Batch lookup by bin IDs', {
      requested: binIds.length,
      found: result.size,
    });

    return result;
  }

  /**
   * Batch upsert bins from cloud sync
   * Enterprise-grade: Single transaction for all bins, eliminates N+1 queries
   * SEC-006: Parameterized queries prevent SQL injection
   * DB-006: Validates store_id for tenant isolation
   * Performance: Uses transaction for atomicity and speed
   *
   * Note: After v037 migration, bin_id IS the cloud's UUID (no separate cloud_bin_id)
   *
   * @param bins - Array of cloud bin data
   * @param expectedStoreId - Expected store ID for tenant isolation validation
   * @returns Upsert result with counts
   */
  batchUpsertFromCloud(
    bins: CloudBinData[],
    expectedStoreId: string
  ): { created: number; updated: number; errors: string[] } {
    const result = { created: 0, updated: 0, errors: [] as string[] };

    if (bins.length === 0) {
      return result;
    }

    // DB-006: Validate all bins belong to expected store
    for (const bin of bins) {
      if (bin.store_id !== expectedStoreId) {
        const errorMsg = `Store ID mismatch for bin ${bin.bin_id}: expected ${expectedStoreId}, got ${bin.store_id}`;
        log.error('Tenant isolation violation in batch upsert', {
          binId: bin.bin_id,
          expectedStoreId,
          actualStoreId: bin.store_id,
        });
        result.errors.push(errorMsg);
      }
    }

    // Abort if any store_id violations
    if (result.errors.length > 0) {
      throw new Error(
        `Tenant isolation violation: ${result.errors.length} bins have wrong store_id`
      );
    }

    // Get existing bins in single batch query (eliminates N+1)
    // After v037 migration, bin_id IS the cloud's UUID
    const binIds = bins.map((b) => b.bin_id);
    const existingBins = this.findByCloudIds(binIds);

    // Execute all upserts in single transaction for atomicity
    this.withTransaction(() => {
      const now = this.now();

      // SEC-006: Prepared statements prevent SQL injection
      // After v037: use cloud's bin_id directly as PK
      // Cloud-aligned: uses name, location, display_order, is_active
      const insertStmt = this.db.prepare(`
        INSERT INTO lottery_bins (
          bin_id, store_id, name, location, display_order, is_active,
          synced_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const updateStmt = this.db.prepare(`
        UPDATE lottery_bins SET
          name = ?,
          location = ?,
          display_order = ?,
          is_active = ?,
          synced_at = ?,
          updated_at = ?
        WHERE bin_id = ?
      `);

      for (const binData of bins) {
        try {
          const existing = existingBins.get(binData.bin_id);

          if (existing) {
            // Update existing bin
            updateStmt.run(
              binData.name,
              binData.location || null,
              binData.display_order ?? 0,
              jsBoolToSqlite(binData.is_active),
              now,
              now,
              binData.bin_id
            );
            result.updated++;
          } else {
            // Create new bin using cloud's bin_id directly as PK
            insertStmt.run(
              binData.bin_id, // Cloud's UUID as bin_id
              binData.store_id,
              binData.name,
              binData.location || null,
              binData.display_order ?? 0,
              jsBoolToSqlite(binData.is_active),
              now,
              now,
              now
            );
            result.created++;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`Bin ${binData.bin_id}: ${message}`);
          log.error('Failed to upsert bin in batch', {
            binId: binData.bin_id,
            error: message,
          });
        }
      }
    });

    log.info('Batch upsert completed', {
      total: bins.length,
      created: result.created,
      updated: result.updated,
      errors: result.errors.length,
    });

    return result;
  }

  /**
   * Batch soft delete bins not in provided bin IDs
   * Enterprise-grade: Single query for deletion
   * SEC-006: Parameterized query
   * DB-006: Store-scoped for tenant isolation
   *
   * Note: After v037 migration, bin_id IS the cloud's UUID (no separate cloud_bin_id)
   *
   * @param storeId - Store identifier for tenant isolation
   * @param activeBinIds - Set of bin IDs (cloud UUIDs) that should remain active
   * @returns Number of bins soft deleted
   */
  batchSoftDeleteNotInCloudIds(storeId: string, activeBinIds: Set<string>): number {
    if (activeBinIds.size === 0) {
      // If no active bin IDs, soft delete all bins for this store that are synced
      const stmt = this.db.prepare(`
        UPDATE lottery_bins SET
          deleted_at = datetime('now'),
          updated_at = datetime('now')
        WHERE store_id = ?
          AND synced_at IS NOT NULL
          AND deleted_at IS NULL
      `);
      const result = stmt.run(storeId);

      if (result.changes > 0) {
        log.info('Batch soft deleted all cloud-synced bins', {
          storeId,
          deletedCount: result.changes,
        });
      }

      return result.changes;
    }

    // SEC-006: Batch in chunks to avoid SQLite parameter limits
    const CHUNK_SIZE = 500;
    let totalDeleted = 0;

    // First, get all synced bins for this store
    // After v037: synced bins are identified by synced_at being set
    const allBinsStmt = this.db.prepare(`
      SELECT bin_id FROM lottery_bins
      WHERE store_id = ? AND synced_at IS NOT NULL AND deleted_at IS NULL
    `);
    const allBins = allBinsStmt.all(storeId) as Array<{ bin_id: string }>;

    // Find bins to delete (in local but not in cloud response)
    const toDelete = allBins.filter((b) => !activeBinIds.has(b.bin_id)).map((b) => b.bin_id);

    if (toDelete.length === 0) {
      return 0;
    }

    // Delete in chunks
    for (let i = 0; i < toDelete.length; i += CHUNK_SIZE) {
      const chunk = toDelete.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(', ');

      const stmt = this.db.prepare(`
        UPDATE lottery_bins SET
          deleted_at = datetime('now'),
          updated_at = datetime('now')
        WHERE store_id = ?
          AND bin_id IN (${placeholders})
          AND deleted_at IS NULL
      `);

      const result = stmt.run(storeId, ...chunk);
      totalDeleted += result.changes;
    }

    if (totalDeleted > 0) {
      log.info('Batch soft deleted bins not in cloud', {
        storeId,
        deletedCount: totalDeleted,
      });
    }

    return totalDeleted;
  }

  /**
   * Soft delete a bin (set deleted_at)
   * Fails if bin has active packs
   * SEC-006: Parameterized queries
   *
   * @param binId - Bin ID to delete
   * @returns Object with success status and error message if failed
   */
  softDelete(binId: string): { success: boolean; error?: string } {
    // Check for active packs
    const packCount = this.getPackCount(binId);
    if (packCount > 0) {
      log.warn('Cannot delete bin with active packs', { binId, packCount });
      return {
        success: false,
        error: `Cannot delete bin with ${packCount} active pack(s)`,
      };
    }

    const stmt = this.db.prepare(`
      UPDATE lottery_bins SET deleted_at = ?, updated_at = ? WHERE bin_id = ? AND deleted_at IS NULL
    `);
    const now = this.now();
    const result = stmt.run(now, now, binId);

    if (result.changes > 0) {
      log.info('Lottery bin soft deleted', { binId });
      return { success: true };
    }
    return { success: false, error: 'Bin not found or already deleted' };
  }

  /**
   * Restore a soft-deleted bin
   * SEC-006: Parameterized UPDATE
   *
   * @param binId - Bin ID to restore
   * @returns true if bin was restored
   */
  restore(binId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE lottery_bins SET deleted_at = NULL, updated_at = ? WHERE bin_id = ?
    `);
    const result = stmt.run(this.now(), binId);

    if (result.changes > 0) {
      log.info('Lottery bin restored', { binId });
      return true;
    }
    return false;
  }

  /**
   * Set bin to inactive
   * SEC-006: Parameterized UPDATE
   * Cloud-aligned: uses is_active=0 instead of status='INACTIVE'
   *
   * @param binId - Bin ID
   * @returns true if bin was deactivated
   */
  deactivate(binId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE lottery_bins SET is_active = 0, updated_at = ? WHERE bin_id = ?
    `);
    const result = stmt.run(this.now(), binId);
    return result.changes > 0;
  }

  /**
   * Set bin to active
   * SEC-006: Parameterized UPDATE
   * Cloud-aligned: uses is_active=1 instead of status='ACTIVE'
   *
   * @param binId - Bin ID
   * @returns true if bin was activated
   */
  activate(binId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE lottery_bins SET is_active = 1, updated_at = ? WHERE bin_id = ?
    `);
    const result = stmt.run(this.now(), binId);
    return result.changes > 0;
  }

  /**
   * Bulk create bins for a store
   * Used during initial store setup
   * SEC-006: Parameterized queries within transaction
   * Cloud-aligned: uses name, display_order, is_active
   *
   * @param storeId - Store identifier
   * @param count - Number of bins to create
   * @returns Array of created bins
   */
  bulkCreate(storeId: string, count: number): LotteryBin[] {
    if (count <= 0 || count > 200) {
      throw new Error('Bin count must be between 1 and 200');
    }

    return this.withTransaction(() => {
      const bins: LotteryBin[] = [];
      const now = this.now();

      const stmt = this.db.prepare(`
        INSERT INTO lottery_bins (
          bin_id, store_id, name, display_order, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?)
      `);

      for (let i = 1; i <= count; i++) {
        const binId = this.generateId();
        stmt.run(binId, storeId, `Bin ${i}`, i, now, now);

        const created = this.findById(binId);
        if (created) {
          bins.push(created);
        }
      }

      log.info('Bulk created lottery bins', { storeId, count });
      return bins;
    });
  }

  /**
   * Get the next available display order for a store
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @returns Next available display order
   */
  getNextDisplayOrder(storeId: string): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(MAX(display_order), 0) + 1 as next_order
      FROM lottery_bins
      WHERE store_id = ? AND deleted_at IS NULL
    `);
    const result = stmt.get(storeId) as { next_order: number };
    return result.next_order;
  }

  /**
   * Get day bins with full pack details for lottery day display
   *
   * Enterprise-grade query that:
   * - SEC-006: Uses parameterized queries (no SQL injection)
   * - DB-006: Enforces tenant isolation via store_id
   * - Efficient single query with LEFT JOINs (no N+1)
   * - Returns actual opening_serial from pack (not hardcoded)
   * - Calculates serial_end from tickets_per_pack
   * - Cloud-aligned: uses name, display_order, is_active
   *
   * @param storeId - Store identifier (required for tenant isolation)
   * @returns Array of bins with full pack details ordered by display_order
   */
  getDayBinsWithFullPackDetails(storeId: string): DayBinWithFullDetails[] {
    log.info('[DAYBINS DEBUG] Fetching day bins', { storeId });

    // First, let's check what activated packs exist for this store
    // Support both ACTIVE (new) and ACTIVATED (legacy) during migration transition
    // v029 API Alignment: Uses current_bin_id
    const debugStmt = this.db.prepare(`
      SELECT pack_id, current_bin_id, status, store_id, opening_serial, game_id
      FROM lottery_packs
      WHERE store_id = ? AND status = 'ACTIVE'
    `);
    const activatedPacks = debugStmt.all(storeId);
    log.info('[DAYBINS DEBUG] Activated packs in store', {
      storeId,
      count: activatedPacks.length,
      packs: activatedPacks,
    });

    // Also check what bins exist
    const binsDebugStmt = this.db.prepare(`
      SELECT bin_id, name, store_id, is_active FROM lottery_bins WHERE store_id = ? AND deleted_at IS NULL
    `);
    const bins = binsDebugStmt.all(storeId);
    log.info('[DAYBINS DEBUG] Bins in store', {
      storeId,
      count: bins.length,
      bins: bins,
    });

    // SEC-006: Parameterized query prevents SQL injection
    // DB-006: Tenant isolation enforced by store_id filter on both bins AND packs
    // Performance: Single query with indexed JOINs, bounded result set
    // v029 API Alignment: Uses current_bin_id for JOIN
    // Cloud-aligned: uses name, display_order, is_active
    const stmt = this.db.prepare(`
      SELECT
        b.bin_id,
        b.display_order,
        b.name as bin_name,
        b.is_active as bin_is_active,
        p.pack_id,
        p.pack_number,
        p.opening_serial,
        p.closing_serial,
        p.status as pack_status,
        p.activated_at,
        g.name as game_name,
        COALESCE(g.price, 0) as game_price,
        COALESCE(g.tickets_per_pack, 300) as tickets_per_pack
      FROM lottery_bins b
      LEFT JOIN lottery_packs p ON p.current_bin_id = b.bin_id
        AND p.status = 'ACTIVE'
        AND p.store_id = ?
      LEFT JOIN lottery_games g ON p.game_id = g.game_id
      WHERE b.store_id = ? AND b.deleted_at IS NULL
      ORDER BY b.display_order ASC, b.name ASC
    `);

    // Execute with store_id for both pack filter and bin filter (tenant isolation)
    const rows = stmt.all(storeId, storeId) as Array<{
      bin_id: string;
      display_order: number;
      bin_name: string;
      bin_is_active: number;
      pack_id: string | null;
      pack_number: string | null;
      opening_serial: string | null;
      closing_serial: string | null;
      pack_status: string | null;
      activated_at: string | null;
      game_name: string | null;
      game_price: number;
      tickets_per_pack: number;
    }>;

    // Transform to structured response
    return rows.map((row) => {
      // Calculate serial_end: (tickets_per_pack - 1) padded to 3 digits
      // e.g., 300 tickets → serial_end = "299"
      const serialEnd = row.pack_id ? String(row.tickets_per_pack - 1).padStart(3, '0') : '000';

      return {
        bin_id: row.bin_id,
        // Cloud uses 0-indexed display_order (0-9), UI expects 1-indexed bin_number (1-10)
        bin_number: row.display_order + 1,
        name: row.bin_name,
        is_active: sqliteBoolToJs(row.bin_is_active),
        pack: row.pack_id
          ? {
              pack_id: row.pack_id,
              pack_number: row.pack_number || '',
              game_name: row.game_name || 'Unknown Game',
              game_price: row.game_price,
              // Use actual opening_serial from pack, fallback to '000' only if null
              starting_serial: row.opening_serial || '000',
              ending_serial: row.closing_serial,
              serial_end: serialEnd,
              // First period if no prior closing serial exists
              is_first_period: row.closing_serial === null,
              status: row.pack_status || 'ACTIVE',
              activated_at: row.activated_at,
            }
          : null,
      };
    });
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for lottery bin operations
 */
export const lotteryBinsDAL = new LotteryBinsDAL();
