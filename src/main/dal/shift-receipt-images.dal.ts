/**
 * Shift Receipt Images Data Access Layer
 *
 * CRUD operations for payout receipt images captured during shift close.
 * Images are stored on filesystem with metadata in database.
 *
 * Document Types:
 *   - CASH_PAYOUT: Receipt for individual cash payout
 *   - LOTTERY_REPORT: Scanned lottery terminal report
 *   - GAMING_REPORT: Scanned gaming machine report
 *
 * @module main/dal/shift-receipt-images
 * @security SEC-006: All queries use prepared statements
 * @security DB-006: Store-scoped for tenant isolation
 * @security CDP-001: Uses SHA-256 hash for file integrity
 */

import { StoreBasedDAL, type StoreEntity } from './base.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Document type for receipt images
 */
export type ReceiptDocumentType = 'CASH_PAYOUT' | 'LOTTERY_REPORT' | 'GAMING_REPORT';

/**
 * Allowed MIME types for images
 */
export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

/**
 * Shift receipt image entity
 */
export interface ShiftReceiptImage extends StoreEntity {
  id: string;
  shift_id: string;
  store_id: string;
  image_hash: string;
  file_name: string;
  file_size: number;
  mime_type: ImageMimeType;
  document_type: ReceiptDocumentType;
  payout_index: number | null;
  uploaded_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * Data for creating a new receipt image record
 */
export interface CreateReceiptImageData {
  shift_id: string;
  store_id: string;
  image_hash: string;
  file_name: string;
  file_size: number;
  mime_type: ImageMimeType;
  document_type: ReceiptDocumentType;
  payout_index?: number | null;
}

/**
 * Query result for images with file path
 */
export interface ReceiptImageWithPath extends ShiftReceiptImage {
  /** Computed file path for image retrieval */
  file_path: string;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('shift-receipt-images-dal');

// ============================================================================
// Shift Receipt Images DAL
// ============================================================================

/**
 * Data Access Layer for shift receipt images
 *
 * Manages metadata for payout receipt images captured during shift close.
 * Actual image files are stored on filesystem.
 *
 * @security SEC-006: All queries use parameterized statements
 * @security DB-006: All queries scoped to store_id
 */
export class ShiftReceiptImagesDAL extends StoreBasedDAL<ShiftReceiptImage> {
  protected readonly tableName = 'shift_receipt_images';
  protected readonly primaryKey = 'id';

  protected readonly sortableColumns = new Set([
    'uploaded_at',
    'file_name',
    'document_type',
    'file_size',
    'created_at',
  ]);

  /**
   * Create a new receipt image record
   *
   * SEC-006: Parameterized INSERT
   * DB-006: Requires store_id for tenant isolation
   *
   * @param data - Image record data
   * @returns Created record
   */
  create(data: CreateReceiptImageData): ShiftReceiptImage {
    const id = this.generateId();
    const now = this.now();

    // SEC-006: Parameterized query with ? placeholders
    const stmt = this.db.prepare(`
      INSERT INTO shift_receipt_images (
        id, shift_id, store_id, image_hash, file_name,
        file_size, mime_type, document_type, payout_index,
        uploaded_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.shift_id,
      data.store_id,
      data.image_hash,
      data.file_name,
      data.file_size,
      data.mime_type,
      data.document_type,
      data.payout_index ?? null,
      now,
      now,
      now
    );

    log.info('Receipt image created', {
      id,
      shiftId: data.shift_id,
      documentType: data.document_type,
      fileSize: data.file_size,
    });

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created receipt image record: ${id}`);
    }
    return created;
  }

  /**
   * Find all images for a shift
   *
   * SEC-006: Parameterized query
   * DB-006: Scoped to store_id
   *
   * @param storeId - Store ID for tenant isolation
   * @param shiftId - Shift ID to query
   * @returns Array of receipt images
   */
  findByShiftId(storeId: string, shiftId: string): ShiftReceiptImage[] {
    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      SELECT *
      FROM shift_receipt_images
      WHERE store_id = ? AND shift_id = ?
      ORDER BY document_type, payout_index, uploaded_at
    `);

    return stmt.all(storeId, shiftId) as ShiftReceiptImage[];
  }

  /**
   * Find images by document type for a shift
   *
   * SEC-006: Parameterized query
   * DB-006: Scoped to store_id
   *
   * @param storeId - Store ID for tenant isolation
   * @param shiftId - Shift ID to query
   * @param documentType - Document type filter
   * @returns Array of receipt images
   */
  findByDocumentType(
    storeId: string,
    shiftId: string,
    documentType: ReceiptDocumentType
  ): ShiftReceiptImage[] {
    // SEC-006: Parameterized query
    const stmt = this.db.prepare(`
      SELECT *
      FROM shift_receipt_images
      WHERE store_id = ? AND shift_id = ? AND document_type = ?
      ORDER BY payout_index, uploaded_at
    `);

    return stmt.all(storeId, shiftId, documentType) as ShiftReceiptImage[];
  }

  /**
   * Check if an image already exists (by hash)
   *
   * CDP-001: Hash-based deduplication
   * SEC-006: Parameterized query
   *
   * @param storeId - Store ID for tenant isolation
   * @param shiftId - Shift ID to check
   * @param imageHash - SHA-256 hash of image
   * @returns True if image exists
   */
  imageExists(storeId: string, shiftId: string, imageHash: string): boolean {
    const stmt = this.db.prepare(`
      SELECT 1
      FROM shift_receipt_images
      WHERE store_id = ? AND shift_id = ? AND image_hash = ?
      LIMIT 1
    `);

    const result = stmt.get(storeId, shiftId, imageHash);
    return result !== undefined;
  }

  /**
   * Find image by hash
   *
   * SEC-006: Parameterized query
   * DB-006: Scoped to store_id
   *
   * @param storeId - Store ID for tenant isolation
   * @param shiftId - Shift ID to check
   * @param imageHash - SHA-256 hash of image
   * @returns Image record or undefined
   */
  findByHash(storeId: string, shiftId: string, imageHash: string): ShiftReceiptImage | undefined {
    const stmt = this.db.prepare(`
      SELECT *
      FROM shift_receipt_images
      WHERE store_id = ? AND shift_id = ? AND image_hash = ?
    `);

    return stmt.get(storeId, shiftId, imageHash) as ShiftReceiptImage | undefined;
  }

  /**
   * Delete an image record
   *
   * SEC-006: Parameterized query
   * DB-006: Scoped to store_id
   *
   * @param storeId - Store ID for tenant isolation
   * @param imageId - Image record ID
   * @returns True if deleted
   */
  deleteImage(storeId: string, imageId: string): boolean {
    // SEC-006: Parameterized query with DB-006 tenant check
    const stmt = this.db.prepare(`
      DELETE FROM shift_receipt_images
      WHERE store_id = ? AND id = ?
    `);

    const result = stmt.run(storeId, imageId);
    const deleted = result.changes > 0;

    if (deleted) {
      log.info('Receipt image deleted', { imageId, storeId });
    }

    return deleted;
  }

  /**
   * Delete all images for a shift
   *
   * SEC-006: Parameterized query
   * DB-006: Scoped to store_id
   *
   * @param storeId - Store ID for tenant isolation
   * @param shiftId - Shift ID
   * @returns Number of images deleted
   */
  deleteByShiftId(storeId: string, shiftId: string): number {
    const stmt = this.db.prepare(`
      DELETE FROM shift_receipt_images
      WHERE store_id = ? AND shift_id = ?
    `);

    const result = stmt.run(storeId, shiftId);

    if (result.changes > 0) {
      log.info('Receipt images deleted for shift', {
        shiftId,
        storeId,
        count: result.changes,
      });
    }

    return result.changes;
  }

  /**
   * Count images for a shift
   *
   * SEC-006: Parameterized query
   *
   * @param storeId - Store ID for tenant isolation
   * @param shiftId - Shift ID
   * @returns Count of images
   */
  countByShiftId(storeId: string, shiftId: string): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM shift_receipt_images
      WHERE store_id = ? AND shift_id = ?
    `);

    const result = stmt.get(storeId, shiftId) as { count: number };
    return result.count;
  }

  /**
   * Get image counts by document type for a shift
   *
   * SEC-006: Parameterized query
   *
   * @param storeId - Store ID for tenant isolation
   * @param shiftId - Shift ID
   * @returns Counts by document type
   */
  getCountsByDocumentType(storeId: string, shiftId: string): Record<ReceiptDocumentType, number> {
    const stmt = this.db.prepare(`
      SELECT document_type, COUNT(*) as count
      FROM shift_receipt_images
      WHERE store_id = ? AND shift_id = ?
      GROUP BY document_type
    `);

    const results = stmt.all(storeId, shiftId) as Array<{
      document_type: ReceiptDocumentType;
      count: number;
    }>;

    // Initialize with zero counts
    const counts: Record<ReceiptDocumentType, number> = {
      CASH_PAYOUT: 0,
      LOTTERY_REPORT: 0,
      GAMING_REPORT: 0,
    };

    // Fill in actual counts
    for (const row of results) {
      counts[row.document_type] = row.count;
    }

    return counts;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Singleton DAL instance
 *
 * @example
 * ```typescript
 * import { shiftReceiptImagesDAL } from './shift-receipt-images.dal';
 *
 * const images = shiftReceiptImagesDAL.findByShiftId(storeId, shiftId);
 * ```
 */
export const shiftReceiptImagesDAL = new ShiftReceiptImagesDAL();
