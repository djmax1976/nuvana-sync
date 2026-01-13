/**
 * Bin Management Service
 *
 * Manages lottery bin CRUD operations with:
 * - Creation with auto-numbering
 * - Deletion with pack validation
 * - Reordering
 * - Sync queue integration
 *
 * @module main/services/bin-management
 * @security SEC-006: All database operations use parameterized queries (via DAL)
 * @security DB-006: Store-scoped operations for tenant isolation
 * @security SEC-014: Input validation with Zod schemas
 * @security LM-001: Structured logging
 */

import { z } from 'zod';
import { lotteryBinsDAL, type LotteryBin } from '../dal/lottery-bins.dal';
import { lotteryPacksDAL } from '../dal/lottery-packs.dal';
import { storesDAL } from '../dal/stores.dal';
import { syncQueueDAL } from '../dal/sync-queue.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('bin-management-service');

// ============================================================================
// Validation Schemas (SEC-014)
// ============================================================================

/**
 * Bin name validation schema
 */
const BinNameSchema = z
  .string()
  .min(1, 'Bin name is required')
  .max(50, 'Bin name cannot exceed 50 characters')
  .regex(/^[a-zA-Z0-9\s\-_]+$/, 'Bin name can only contain letters, numbers, spaces, hyphens, and underscores');

/**
 * Bin location validation schema (optional)
 */
const BinLocationSchema = z
  .string()
  .max(100, 'Location cannot exceed 100 characters')
  .regex(/^[a-zA-Z0-9\s\-_]*$/, 'Location can only contain letters, numbers, spaces, hyphens, and underscores')
  .optional();

/**
 * Create bin schema
 */
const CreateBinSchema = z.object({
  name: BinNameSchema,
  location: BinLocationSchema,
});

/**
 * Update bin schema
 */
const UpdateBinSchema = z.object({
  name: BinNameSchema.optional(),
  location: BinLocationSchema,
  display_order: z.number().int().min(1).max(200).optional(),
});

/**
 * Bin ID validation schema
 */
const BinIdSchema = z
  .string()
  .uuid('Invalid bin ID format');

/**
 * Reorder schema
 */
const ReorderSchema = z.array(BinIdSchema).min(1, 'At least one bin ID required');

// ============================================================================
// Types
// ============================================================================

/**
 * Bin creation data
 */
export interface CreateBinData {
  name: string;
  location?: string;
}

/**
 * Bin update data
 */
export interface UpdateBinData {
  name?: string;
  location?: string;
  display_order?: number;
}

/**
 * Bin with extended information
 */
export interface BinWithDetails extends LotteryBin {
  packCount: number;
  packs: Array<{
    pack_id: string;
    pack_number: string;
    game_name: string | null;
    game_price: number | null;
  }>;
}

/**
 * Bin operation result
 */
export interface BinOperationResult {
  success: boolean;
  bin?: LotteryBin;
  error?: string;
}

// ============================================================================
// Bin Management Service
// ============================================================================

/**
 * Bin Management Service
 *
 * Handles lottery bin lifecycle management with:
 * - Input validation
 * - Business rule enforcement
 * - Sync queue integration
 * - Audit logging
 *
 * @security SEC-014: All inputs validated via Zod
 * @security DB-006: All operations scoped by store
 */
export class BinManagementService {
  // ==========================================================================
  // Read Operations
  // ==========================================================================

  /**
   * Get all bins for the configured store
   *
   * Returns bins with pack counts and pack details.
   * DB-006: Automatically scoped to configured store.
   *
   * @returns Array of bins with details, or empty array if no store
   */
  getBins(): BinWithDetails[] {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      log.debug('No store configured, returning empty bins list');
      return [];
    }

    // Get all active bins for store
    const bins = lotteryBinsDAL.findActiveByStore(store.store_id);

    // Enrich with pack information
    const binsWithDetails: BinWithDetails[] = bins.map((bin) => {
      const packCount = lotteryBinsDAL.getPackCount(bin.bin_id);
      const packs = lotteryPacksDAL.findPacksWithDetails(store.store_id, {
        bin_id: bin.bin_id,
        status: 'ACTIVATED',
      });

      return {
        ...bin,
        packCount,
        packs: packs.map((p) => ({
          pack_id: p.pack_id,
          pack_number: p.pack_number,
          game_name: p.game_name,
          game_price: p.game_price,
        })),
      };
    });

    log.debug('Retrieved bins', { storeId: store.store_id, count: binsWithDetails.length });

    return binsWithDetails;
  }

  /**
   * Get a single bin by ID
   *
   * @param binId - Bin UUID
   * @returns Bin with details or undefined
   */
  getBinById(binId: string): BinWithDetails | undefined {
    // SEC-014: Validate bin ID format
    const idValidation = BinIdSchema.safeParse(binId);
    if (!idValidation.success) {
      log.warn('Invalid bin ID format', { binId: binId.substring(0, 8) });
      return undefined;
    }

    const bin = lotteryBinsDAL.findById(binId);
    if (!bin) {
      return undefined;
    }

    const packCount = lotteryBinsDAL.getPackCount(binId);
    const store = storesDAL.getConfiguredStore();
    const packs = store
      ? lotteryPacksDAL.findPacksWithDetails(store.store_id, {
          bin_id: binId,
          status: 'ACTIVATED',
        })
      : [];

    return {
      ...bin,
      packCount,
      packs: packs.map((p) => ({
        pack_id: p.pack_id,
        pack_number: p.pack_number,
        game_name: p.game_name,
        game_price: p.game_price,
      })),
    };
  }

  // ==========================================================================
  // Write Operations
  // ==========================================================================

  /**
   * Create a new bin
   *
   * - Validates input
   * - Auto-assigns next bin number
   * - Enqueues for cloud sync
   *
   * @param data - Bin creation data
   * @returns Created bin or error
   * @security SEC-014: Input validation
   */
  createBin(data: CreateBinData): BinOperationResult {
    // SEC-014: Validate input
    const validation = CreateBinSchema.safeParse(data);
    if (!validation.success) {
      const errorMessage = validation.error.issues.map((e: { message: string }) => e.message).join(', ');
      log.warn('Bin creation validation failed', { errors: validation.error.issues.length });
      return { success: false, error: errorMessage };
    }

    const validatedData = validation.data;

    // Get configured store
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      log.error('Cannot create bin: no store configured');
      return { success: false, error: 'Store not configured' };
    }

    try {
      // Get next bin number
      const nextBinNumber = lotteryBinsDAL.getNextBinNumber(store.store_id);

      // Create bin
      const bin = lotteryBinsDAL.create({
        store_id: store.store_id,
        bin_number: nextBinNumber,
        label: validatedData.name,
        status: 'ACTIVE',
      });

      // Enqueue for sync
      syncQueueDAL.enqueue({
        store_id: store.store_id,
        entity_type: 'lottery_bin',
        entity_id: bin.bin_id,
        operation: 'CREATE',
        payload: {
          bin_id: bin.bin_id,
          bin_number: bin.bin_number,
          label: bin.label,
          status: bin.status,
          created_at: bin.created_at,
        },
      });

      log.info('Bin created', {
        binId: bin.bin_id,
        binNumber: bin.bin_number,
        storeId: store.store_id,
      });

      return { success: true, bin };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Bin creation failed', { error: message });
      return { success: false, error: message };
    }
  }

  /**
   * Update an existing bin
   *
   * - Validates input
   * - Updates bin record
   * - Enqueues for cloud sync
   *
   * @param binId - Bin UUID
   * @param updates - Fields to update
   * @returns Updated bin or error
   * @security SEC-014: Input validation
   */
  updateBin(binId: string, updates: UpdateBinData): BinOperationResult {
    // SEC-014: Validate bin ID
    const idValidation = BinIdSchema.safeParse(binId);
    if (!idValidation.success) {
      return { success: false, error: 'Invalid bin ID format' };
    }

    // SEC-014: Validate updates
    const updateValidation = UpdateBinSchema.safeParse(updates);
    if (!updateValidation.success) {
      const errorMessage = updateValidation.error.issues.map((e: { message: string }) => e.message).join(', ');
      return { success: false, error: errorMessage };
    }

    const validatedUpdates = updateValidation.data;

    // Check bin exists
    const existingBin = lotteryBinsDAL.findById(binId);
    if (!existingBin) {
      return { success: false, error: 'Bin not found' };
    }

    try {
      // Build update object for DAL
      const dalUpdates: { bin_number?: number; label?: string; status?: 'ACTIVE' | 'INACTIVE' } = {};
      if (validatedUpdates.name !== undefined) {
        dalUpdates.label = validatedUpdates.name;
      }
      if (validatedUpdates.display_order !== undefined) {
        dalUpdates.bin_number = validatedUpdates.display_order;
      }

      // Update bin
      const updatedBin = lotteryBinsDAL.update(binId, dalUpdates);

      if (!updatedBin) {
        return { success: false, error: 'Failed to update bin' };
      }

      // Enqueue for sync
      syncQueueDAL.enqueue({
        store_id: existingBin.store_id,
        entity_type: 'lottery_bin',
        entity_id: binId,
        operation: 'UPDATE',
        payload: {
          bin_id: updatedBin.bin_id,
          bin_number: updatedBin.bin_number,
          label: updatedBin.label,
          status: updatedBin.status,
          updated_at: updatedBin.updated_at,
        },
      });

      log.info('Bin updated', { binId });

      return { success: true, bin: updatedBin };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Bin update failed', { binId, error: message });
      return { success: false, error: message };
    }
  }

  /**
   * Delete a bin
   *
   * - Validates bin has no active packs
   * - Soft deletes (sets deleted_at)
   * - Enqueues for cloud sync
   *
   * @param binId - Bin UUID
   * @returns Success or error
   * @security SEC-014: Input validation
   */
  deleteBin(binId: string): BinOperationResult {
    // SEC-014: Validate bin ID
    const idValidation = BinIdSchema.safeParse(binId);
    if (!idValidation.success) {
      return { success: false, error: 'Invalid bin ID format' };
    }

    // Check bin exists
    const existingBin = lotteryBinsDAL.findById(binId);
    if (!existingBin) {
      return { success: false, error: 'Bin not found' };
    }

    // Check for active packs (business rule)
    const packCount = lotteryBinsDAL.getPackCount(binId);
    if (packCount > 0) {
      log.warn('Cannot delete bin with active packs', { binId, packCount });
      return {
        success: false,
        error: `Cannot delete bin with ${packCount} active pack(s). Move or return packs first.`,
      };
    }

    try {
      // Soft delete
      const deleteResult = lotteryBinsDAL.softDelete(binId);

      if (!deleteResult.success) {
        return { success: false, error: deleteResult.error || 'Delete failed' };
      }

      // Enqueue for sync
      syncQueueDAL.enqueue({
        store_id: existingBin.store_id,
        entity_type: 'lottery_bin',
        entity_id: binId,
        operation: 'DELETE',
        payload: {
          bin_id: binId,
          deleted_at: new Date().toISOString(),
        },
      });

      log.info('Bin deleted', { binId, binNumber: existingBin.bin_number });

      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Bin deletion failed', { binId, error: message });
      return { success: false, error: message };
    }
  }

  /**
   * Reorder bins
   *
   * Updates display_order (bin_number) based on provided ID order.
   *
   * @param binIds - Ordered array of bin UUIDs
   * @returns Success or error
   * @security SEC-014: Input validation
   */
  reorderBins(binIds: string[]): BinOperationResult {
    // SEC-014: Validate input
    const validation = ReorderSchema.safeParse(binIds);
    if (!validation.success) {
      const errorMessage = validation.error.issues.map((e: { message: string }) => e.message).join(', ');
      return { success: false, error: errorMessage };
    }

    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return { success: false, error: 'Store not configured' };
    }

    try {
      // Update each bin's display order
      binIds.forEach((binId, index) => {
        const bin = lotteryBinsDAL.findById(binId);
        if (bin && bin.store_id === store.store_id) {
          lotteryBinsDAL.update(binId, { bin_number: index + 1 });
        }
      });

      log.info('Bins reordered', { storeId: store.store_id, count: binIds.length });

      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Bin reorder failed', { error: message });
      return { success: false, error: message };
    }
  }

  // ==========================================================================
  // Bulk Operations
  // ==========================================================================

  /**
   * Create multiple bins at once
   *
   * Used during initial store setup.
   *
   * @param count - Number of bins to create
   * @returns Array of created bins or error
   */
  bulkCreateBins(count: number): { success: boolean; bins?: LotteryBin[]; error?: string } {
    // Validate count
    if (!Number.isInteger(count) || count < 1 || count > 200) {
      return { success: false, error: 'Bin count must be between 1 and 200' };
    }

    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return { success: false, error: 'Store not configured' };
    }

    try {
      const bins = lotteryBinsDAL.bulkCreate(store.store_id, count);

      // Enqueue all for sync
      for (const bin of bins) {
        syncQueueDAL.enqueue({
          store_id: store.store_id,
          entity_type: 'lottery_bin',
          entity_id: bin.bin_id,
          operation: 'CREATE',
          payload: {
            bin_id: bin.bin_id,
            bin_number: bin.bin_number,
            label: bin.label,
            status: bin.status,
            created_at: bin.created_at,
          },
        });
      }

      log.info('Bulk bins created', { storeId: store.store_id, count: bins.length });

      return { success: true, bins };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Bulk bin creation failed', { error: message });
      return { success: false, error: message };
    }
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get bin statistics for the store
   *
   * @returns Stats object with counts
   */
  getStats(): {
    totalBins: number;
    activeBins: number;
    binsWithPacks: number;
    totalActivePacks: number;
  } {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return { totalBins: 0, activeBins: 0, binsWithPacks: 0, totalActivePacks: 0 };
    }

    const allBins = lotteryBinsDAL.findAllByStore(store.store_id);
    const activeBins = lotteryBinsDAL.findActiveByStore(store.store_id);

    let binsWithPacks = 0;
    let totalActivePacks = 0;

    for (const bin of activeBins) {
      const packCount = lotteryBinsDAL.getPackCount(bin.bin_id);
      if (packCount > 0) {
        binsWithPacks++;
        totalActivePacks += packCount;
      }
    }

    return {
      totalBins: allBins.length,
      activeBins: activeBins.length,
      binsWithPacks,
      totalActivePacks,
    };
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance for bin management operations
 */
export const binManagementService = new BinManagementService();
