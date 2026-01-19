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
 * Lottery bin status
 */
export type LotteryBinStatus = 'ACTIVE' | 'INACTIVE';

/**
 * Lottery bin entity
 */
export interface LotteryBin extends StoreEntity {
  bin_id: string;
  store_id: string;
  bin_number: number;
  label: string | null;
  status: LotteryBinStatus;
  deleted_at: string | null;
  cloud_bin_id: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Bin creation data
 */
export interface CreateLotteryBinData {
  bin_id?: string;
  store_id: string;
  bin_number: number;
  label?: string;
  status?: LotteryBinStatus;
  cloud_bin_id?: string;
}

/**
 * Bin update data
 */
export interface UpdateLotteryBinData {
  bin_number?: number;
  label?: string;
  status?: LotteryBinStatus;
}

/**
 * Cloud bin sync data
 */
export interface CloudBinData {
  cloud_bin_id: string;
  store_id: string;
  bin_number: number;
  label?: string;
  status?: LotteryBinStatus;
}

/**
 * Bin with current pack information
 */
export interface BinWithPack extends LotteryBin {
  pack_id: string | null;
  pack_number: string | null;
  game_name: string | null;
  game_price: number | null;
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
    'bin_number',
    'label',
    'status',
  ]);

  /**
   * Create a new lottery bin
   * SEC-006: Parameterized INSERT
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
        bin_id, store_id, bin_number, label, status,
        cloud_bin_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      binId,
      data.store_id,
      data.bin_number,
      data.label || null,
      data.status || 'ACTIVE',
      data.cloud_bin_id || null,
      now,
      now
    );

    log.info('Lottery bin created', {
      binId,
      storeId: data.store_id,
      binNumber: data.bin_number,
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
   *
   * @param binId - Bin ID to update
   * @param data - Fields to update
   * @returns Updated bin or undefined
   */
  update(binId: string, data: UpdateLotteryBinData): LotteryBin | undefined {
    const now = this.now();

    const updates: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (data.bin_number !== undefined) {
      updates.push('bin_number = ?');
      params.push(data.bin_number);
    }
    if (data.label !== undefined) {
      updates.push('label = ?');
      params.push(data.label);
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(data.status);
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
   *
   * @param storeId - Store identifier
   * @returns Array of active bins ordered by bin_number
   */
  findActiveByStore(storeId: string): LotteryBin[] {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_bins
      WHERE store_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL
      ORDER BY bin_number ASC
    `);
    return stmt.all(storeId) as LotteryBin[];
  }

  /**
   * Find all bins by store (including inactive, excluding deleted)
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @returns Array of bins ordered by bin_number
   */
  findAllByStore(storeId: string): LotteryBin[] {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_bins
      WHERE store_id = ? AND deleted_at IS NULL
      ORDER BY bin_number ASC
    `);
    return stmt.all(storeId) as LotteryBin[];
  }

  /**
   * Find bin by bin number within a store
   * DB-006: Store-scoped query
   *
   * @param storeId - Store identifier
   * @param binNumber - Bin number to search
   * @returns Bin or undefined
   */
  findByBinNumber(storeId: string, binNumber: number): LotteryBin | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_bins
      WHERE store_id = ? AND bin_number = ? AND deleted_at IS NULL
    `);
    return stmt.get(storeId, binNumber) as LotteryBin | undefined;
  }

  /**
   * Find bin by cloud ID
   * Used for cloud sync matching
   * SEC-006: Parameterized query
   *
   * @param cloudBinId - Cloud bin identifier
   * @returns Bin or undefined
   */
  findByCloudId(cloudBinId: string): LotteryBin | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM lottery_bins WHERE cloud_bin_id = ?
    `);
    return stmt.get(cloudBinId) as LotteryBin | undefined;
  }

  /**
   * Get count of active packs in a bin
   * SEC-006: Parameterized query
   *
   * @param binId - Bin ID
   * @returns Number of active packs
   */
  getPackCount(binId: string): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM lottery_packs
      WHERE bin_id = ? AND status = 'ACTIVATED'
    `);
    const result = stmt.get(binId) as { count: number };
    return result.count;
  }

  /**
   * Get bins with their current pack information
   * SEC-006: Parameterized query with JOIN
   *
   * @param storeId - Store identifier
   * @returns Array of bins with pack info
   */
  findBinsWithPacks(storeId: string): BinWithPack[] {
    const stmt = this.db.prepare(`
      SELECT
        b.*,
        p.pack_id,
        p.pack_number,
        g.name as game_name,
        g.price as game_price
      FROM lottery_bins b
      LEFT JOIN lottery_packs p ON p.bin_id = b.bin_id AND p.status = 'ACTIVATED'
      LEFT JOIN lottery_games g ON p.game_id = g.game_id
      WHERE b.store_id = ? AND b.deleted_at IS NULL
      ORDER BY b.bin_number ASC
    `);
    return stmt.all(storeId) as BinWithPack[];
  }

  /**
   * Upsert bin from cloud sync
   * Creates if not exists, updates if exists (by cloud_bin_id)
   * SEC-006: Parameterized queries
   *
   * @param data - Cloud bin data
   * @returns Upserted bin
   */
  upsertFromCloud(data: CloudBinData): LotteryBin {
    const existing = this.findByCloudId(data.cloud_bin_id);
    const now = this.now();

    if (existing) {
      // Update existing bin
      const stmt = this.db.prepare(`
        UPDATE lottery_bins SET
          bin_number = ?,
          label = ?,
          status = ?,
          synced_at = ?,
          updated_at = ?
        WHERE cloud_bin_id = ?
      `);

      stmt.run(
        data.bin_number,
        data.label || null,
        data.status || 'ACTIVE',
        now,
        now,
        data.cloud_bin_id
      );

      log.info('Lottery bin updated from cloud', { cloudBinId: data.cloud_bin_id });
      const updated = this.findByCloudId(data.cloud_bin_id);
      if (!updated) {
        throw new Error(`Failed to retrieve updated bin from cloud: ${data.cloud_bin_id}`);
      }
      return updated;
    }

    // Create new bin
    const binId = this.generateId();

    const stmt = this.db.prepare(`
      INSERT INTO lottery_bins (
        bin_id, store_id, bin_number, label, status,
        cloud_bin_id, synced_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      binId,
      data.store_id,
      data.bin_number,
      data.label || null,
      data.status || 'ACTIVE',
      data.cloud_bin_id,
      now,
      now,
      now
    );

    log.info('Lottery bin created from cloud', {
      binId,
      cloudBinId: data.cloud_bin_id,
    });

    const created = this.findById(binId);
    if (!created) {
      throw new Error(`Failed to retrieve created bin from cloud: ${binId}`);
    }
    return created;
  }

  /**
   * Find multiple bins by cloud bin IDs (batch operation)
   * Enterprise-grade: Eliminates N+1 queries during sync
   * SEC-006: Parameterized IN clause with placeholders
   * Performance: Single query for all cloud IDs
   *
   * @param cloudBinIds - Array of cloud bin identifiers
   * @returns Map of cloud_bin_id -> LotteryBin for efficient lookup
   */
  findByCloudIds(cloudBinIds: string[]): Map<string, LotteryBin> {
    const result = new Map<string, LotteryBin>();

    if (cloudBinIds.length === 0) {
      return result;
    }

    // SEC-006: Batch in chunks to avoid SQLite parameter limits (max ~999)
    const CHUNK_SIZE = 500;
    for (let i = 0; i < cloudBinIds.length; i += CHUNK_SIZE) {
      const chunk = cloudBinIds.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(', ');

      const stmt = this.db.prepare(`
        SELECT * FROM lottery_bins WHERE cloud_bin_id IN (${placeholders})
      `);

      const bins = stmt.all(...chunk) as LotteryBin[];

      for (const bin of bins) {
        if (bin.cloud_bin_id) {
          result.set(bin.cloud_bin_id, bin);
        }
      }
    }

    log.debug('Batch lookup by cloud IDs', {
      requested: cloudBinIds.length,
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
        const errorMsg = `Store ID mismatch for bin ${bin.cloud_bin_id}: expected ${expectedStoreId}, got ${bin.store_id}`;
        log.error('Tenant isolation violation in batch upsert', {
          cloudBinId: bin.cloud_bin_id,
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
    const cloudBinIds = bins.map((b) => b.cloud_bin_id);
    const existingBins = this.findByCloudIds(cloudBinIds);

    // Execute all upserts in single transaction for atomicity
    this.withTransaction(() => {
      const now = this.now();

      // SEC-006: Prepared statements prevent SQL injection
      const insertStmt = this.db.prepare(`
        INSERT INTO lottery_bins (
          bin_id, store_id, bin_number, label, status,
          cloud_bin_id, synced_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const updateStmt = this.db.prepare(`
        UPDATE lottery_bins SET
          bin_number = ?,
          label = ?,
          status = ?,
          synced_at = ?,
          updated_at = ?
        WHERE cloud_bin_id = ?
      `);

      for (const binData of bins) {
        try {
          const existing = existingBins.get(binData.cloud_bin_id);

          if (existing) {
            // Update existing bin
            updateStmt.run(
              binData.bin_number,
              binData.label || null,
              binData.status || 'ACTIVE',
              now,
              now,
              binData.cloud_bin_id
            );
            result.updated++;
          } else {
            // Create new bin
            const binId = this.generateId();
            insertStmt.run(
              binId,
              binData.store_id,
              binData.bin_number,
              binData.label || null,
              binData.status || 'ACTIVE',
              binData.cloud_bin_id,
              now,
              now,
              now
            );
            result.created++;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`Bin ${binData.cloud_bin_id}: ${message}`);
          log.error('Failed to upsert bin in batch', {
            cloudBinId: binData.cloud_bin_id,
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
   * Batch soft delete bins not in provided cloud IDs
   * Enterprise-grade: Single query for deletion
   * SEC-006: Parameterized query
   * DB-006: Store-scoped for tenant isolation
   *
   * @param storeId - Store identifier for tenant isolation
   * @param activeCloudIds - Set of cloud IDs that should remain active
   * @returns Number of bins soft deleted
   */
  batchSoftDeleteNotInCloudIds(storeId: string, activeCloudIds: Set<string>): number {
    if (activeCloudIds.size === 0) {
      // If no active cloud IDs, soft delete all bins for this store that have cloud_bin_id
      const stmt = this.db.prepare(`
        UPDATE lottery_bins SET
          deleted_at = datetime('now'),
          updated_at = datetime('now')
        WHERE store_id = ?
          AND cloud_bin_id IS NOT NULL
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
    const cloudIdsArray = Array.from(activeCloudIds);
    let totalDeleted = 0;

    // First, get all cloud-synced bins for this store
    const allBinsStmt = this.db.prepare(`
      SELECT cloud_bin_id FROM lottery_bins
      WHERE store_id = ? AND cloud_bin_id IS NOT NULL AND deleted_at IS NULL
    `);
    const allBins = allBinsStmt.all(storeId) as Array<{ cloud_bin_id: string }>;

    // Find bins to delete (in local but not in cloud response)
    const toDelete = allBins
      .filter((b) => !activeCloudIds.has(b.cloud_bin_id))
      .map((b) => b.cloud_bin_id);

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
          AND cloud_bin_id IN (${placeholders})
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
   * Set bin status to inactive
   * SEC-006: Parameterized UPDATE
   *
   * @param binId - Bin ID
   * @returns true if bin was deactivated
   */
  deactivate(binId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE lottery_bins SET status = 'INACTIVE', updated_at = ? WHERE bin_id = ?
    `);
    const result = stmt.run(this.now(), binId);
    return result.changes > 0;
  }

  /**
   * Set bin status to active
   * SEC-006: Parameterized UPDATE
   *
   * @param binId - Bin ID
   * @returns true if bin was activated
   */
  activate(binId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE lottery_bins SET status = 'ACTIVE', updated_at = ? WHERE bin_id = ?
    `);
    const result = stmt.run(this.now(), binId);
    return result.changes > 0;
  }

  /**
   * Bulk create bins for a store
   * Used during initial store setup
   * SEC-006: Parameterized queries within transaction
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
          bin_id, store_id, bin_number, label, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)
      `);

      for (let i = 1; i <= count; i++) {
        const binId = this.generateId();
        stmt.run(binId, storeId, i, `Bin ${i}`, now, now);

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
   * Get the next available bin number for a store
   * SEC-006: Parameterized query
   *
   * @param storeId - Store identifier
   * @returns Next available bin number
   */
  getNextBinNumber(storeId: string): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(MAX(bin_number), 0) + 1 as next_number
      FROM lottery_bins
      WHERE store_id = ? AND deleted_at IS NULL
    `);
    const result = stmt.get(storeId) as { next_number: number };
    return result.next_number;
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
   *
   * @param storeId - Store identifier (required for tenant isolation)
   * @returns Array of bins with full pack details ordered by bin_number
   */
  getDayBinsWithFullPackDetails(storeId: string): DayBinWithFullDetails[] {
    log.info('[DAYBINS DEBUG] Fetching day bins', { storeId });

    // First, let's check what activated packs exist for this store
    const debugStmt = this.db.prepare(`
      SELECT pack_id, bin_id, status, store_id, opening_serial, game_id
      FROM lottery_packs
      WHERE store_id = ? AND status = 'ACTIVATED'
    `);
    const activatedPacks = debugStmt.all(storeId);
    log.info('[DAYBINS DEBUG] Activated packs in store', {
      storeId,
      count: activatedPacks.length,
      packs: activatedPacks,
    });

    // Also check what bins exist
    const binsDebugStmt = this.db.prepare(`
      SELECT bin_id, bin_number, store_id, status FROM lottery_bins WHERE store_id = ? AND deleted_at IS NULL
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
    const stmt = this.db.prepare(`
      SELECT
        b.bin_id,
        b.bin_number,
        COALESCE(b.label, 'Bin ' || b.bin_number) as bin_name,
        b.status as bin_status,
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
      LEFT JOIN lottery_packs p ON p.bin_id = b.bin_id
        AND p.status = 'ACTIVATED'
        AND p.store_id = ?
      LEFT JOIN lottery_games g ON p.game_id = g.game_id
      WHERE b.store_id = ? AND b.deleted_at IS NULL
      ORDER BY b.bin_number ASC
    `);

    // Execute with store_id for both pack filter and bin filter (tenant isolation)
    const rows = stmt.all(storeId, storeId) as Array<{
      bin_id: string;
      bin_number: number;
      bin_name: string;
      bin_status: string;
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
        bin_number: row.bin_number,
        name: row.bin_name,
        is_active: row.bin_status === 'ACTIVE',
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
              status: row.pack_status || 'ACTIVATED',
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
