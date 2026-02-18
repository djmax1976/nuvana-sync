/**
 * Images IPC Handlers
 *
 * Provides image storage and retrieval endpoints for payout receipts
 * and scanned reports during shift close.
 *
 * Image Storage:
 *   - Files stored at: userData/images/{store_id}/{shift_id}/{image_hash}.{ext}
 *   - Metadata stored in shift_receipt_images table
 *   - Deduplication via SHA-256 hash
 *
 * Security:
 *   - SEC-006: All queries use parameterized statements
 *   - DB-006: Store-scoped for tenant isolation
 *   - SEC-014: Input validation with Zod
 *   - SEC-015: Path traversal prevention
 *
 * @module main/ipc/images
 */

import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { registerHandler, createErrorResponse, IPCErrorCodes } from './index';
import { storesDAL } from '../dal/stores.dal';
import { shiftsDAL } from '../dal/shifts.dal';
import {
  shiftReceiptImagesDAL,
  type ReceiptDocumentType,
  type ImageMimeType,
  type ShiftReceiptImage,
} from '../dal/shift-receipt-images.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('images-handlers');

// ============================================================================
// Constants
// ============================================================================

/** Maximum image size in bytes (10MB) */
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

/** Allowed MIME types */
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** File extension mapping */
const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// ============================================================================
// Input Validation Schemas (API-001)
// ============================================================================

/**
 * Schema for image upload request
 */
const UploadImageSchema = z.object({
  shift_id: z.string().uuid('Invalid shift ID format'),
  document_type: z.enum(['CASH_PAYOUT', 'LOTTERY_REPORT', 'GAMING_REPORT']),
  /** Base64 encoded image data */
  image_data: z.string().min(1, 'Image data is required'),
  file_name: z.string().min(1).max(255),
  mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  /** Optional payout index for CASH_PAYOUT type */
  payout_index: z.number().int().min(0).optional(),
});

/**
 * Schema for image retrieval request
 */
const GetImageSchema = z.object({
  image_id: z.string().uuid('Invalid image ID format'),
});

/**
 * Schema for shift images request
 */
const GetShiftImagesSchema = z.object({
  shift_id: z.string().uuid('Invalid shift ID format'),
  document_type: z.enum(['CASH_PAYOUT', 'LOTTERY_REPORT', 'GAMING_REPORT']).optional(),
});

// ============================================================================
// Types
// ============================================================================

interface UploadImageResponse {
  success: boolean;
  image: {
    id: string;
    image_hash: string;
    file_name: string;
    document_type: ReceiptDocumentType;
  };
  message: string;
}

interface GetImageResponse {
  success: boolean;
  image_data: string; // Base64 encoded
  mime_type: ImageMimeType;
  file_name: string;
}

interface ShiftImagesResponse {
  images: Array<{
    id: string;
    document_type: ReceiptDocumentType;
    file_name: string;
    file_size: number;
    mime_type: ImageMimeType;
    payout_index: number | null;
    uploaded_at: string;
    has_image: boolean;
  }>;
  counts: {
    CASH_PAYOUT: number;
    LOTTERY_REPORT: number;
    GAMING_REPORT: number;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the images directory path
 * SEC-015: Uses app.getPath('userData') for safe storage
 */
function getImagesBasePath(): string {
  return path.join(app.getPath('userData'), 'images');
}

/**
 * Get the file path for an image
 * SEC-015: Validates path components to prevent traversal
 */
function getImageFilePath(
  storeId: string,
  shiftId: string,
  imageHash: string,
  mimeType: string
): string {
  // SEC-015: Validate path components (no path separators allowed)
  if (storeId.includes('/') || storeId.includes('\\')) {
    throw new Error('Invalid store ID');
  }
  if (shiftId.includes('/') || shiftId.includes('\\')) {
    throw new Error('Invalid shift ID');
  }
  if (imageHash.includes('/') || imageHash.includes('\\')) {
    throw new Error('Invalid image hash');
  }

  const extension = MIME_TO_EXTENSION[mimeType] || 'bin';
  return path.join(getImagesBasePath(), storeId, shiftId, `${imageHash}.${extension}`);
}

/**
 * Ensure directory exists for image storage
 */
function ensureDirectoryExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Calculate SHA-256 hash of buffer
 * CDP-001: Hash for integrity and deduplication
 */
function calculateHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Validate Base64 image data
 */
function decodeBase64Image(base64Data: string): { buffer: Buffer; cleanData: string } {
  // Remove data URL prefix if present
  const base64Regex = /^data:image\/(jpeg|png|webp);base64,/;
  const cleanData = base64Data.replace(base64Regex, '');

  const buffer = Buffer.from(cleanData, 'base64');
  return { buffer, cleanData };
}

// ============================================================================
// Upload Image Handler
// ============================================================================

/**
 * Upload a receipt image for a shift
 *
 * Stores the image on filesystem and creates a database record.
 * Uses SHA-256 hash for deduplication - same image returns existing record.
 *
 * Channel: images:upload
 *
 * @security SEC-006: Parameterized queries via DAL
 * @security DB-006: Store-scoped tenant isolation
 * @security SEC-014: Input validation via Zod
 * @security SEC-015: Path traversal prevention
 */
registerHandler<UploadImageResponse | ReturnType<typeof createErrorResponse>>(
  'images:upload',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = UploadImageSchema.safeParse(input);
    if (!parseResult.success) {
      log.warn('Invalid image upload input', { errors: parseResult.error.issues });
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid image upload data');
    }

    const { shift_id, document_type, image_data, file_name, mime_type, payout_index } =
      parseResult.data;

    // DB-006: Get configured store for tenant isolation
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    try {
      // Verify shift exists and belongs to store
      const shift = shiftsDAL.findById(shift_id);
      if (!shift) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Shift not found');
      }

      // DB-006: Verify shift belongs to configured store
      if (shift.store_id !== store.store_id) {
        log.warn('Image upload denied - store mismatch', {
          shiftId: shift_id,
          shiftStoreId: shift.store_id,
          configuredStoreId: store.store_id,
        });
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Shift not found');
      }

      // Decode and validate image data
      const { buffer } = decodeBase64Image(image_data);

      // Validate file size
      if (buffer.length > MAX_IMAGE_SIZE) {
        return createErrorResponse(
          IPCErrorCodes.VALIDATION_ERROR,
          `Image exceeds maximum size of ${MAX_IMAGE_SIZE / 1024 / 1024}MB`
        );
      }

      // CDP-001: Calculate hash for integrity and deduplication
      const imageHash = calculateHash(buffer);

      // Check for duplicate
      const existing = shiftReceiptImagesDAL.findByHash(store.store_id, shift_id, imageHash);
      if (existing) {
        log.debug('Image already exists, returning existing record', {
          imageId: existing.id,
          imageHash,
        });
        return {
          success: true,
          image: {
            id: existing.id,
            image_hash: existing.image_hash,
            file_name: existing.file_name,
            document_type: existing.document_type,
          },
          message: 'Image already exists',
        };
      }

      // SEC-015: Get safe file path
      const filePath = getImageFilePath(store.store_id, shift_id, imageHash, mime_type);

      // Ensure directory exists
      ensureDirectoryExists(filePath);

      // Write image to filesystem
      fs.writeFileSync(filePath, buffer);

      // Create database record
      const imageRecord = shiftReceiptImagesDAL.create({
        shift_id,
        store_id: store.store_id,
        image_hash: imageHash,
        file_name,
        file_size: buffer.length,
        mime_type: mime_type as ImageMimeType,
        document_type: document_type as ReceiptDocumentType,
        payout_index: payout_index ?? null,
      });

      log.info('Image uploaded', {
        imageId: imageRecord.id,
        shiftId: shift_id,
        documentType: document_type,
        fileSize: buffer.length,
      });

      return {
        success: true,
        image: {
          id: imageRecord.id,
          image_hash: imageRecord.image_hash,
          file_name: imageRecord.file_name,
          document_type: imageRecord.document_type,
        },
        message: 'Image uploaded successfully',
      };
    } catch (error) {
      log.error('Failed to upload image', {
        shiftId: shift_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Upload a receipt image for a shift' }
);

// ============================================================================
// Get Image Handler
// ============================================================================

/**
 * Retrieve an image by ID
 *
 * Returns the image data as Base64 encoded string.
 *
 * Channel: images:get
 *
 * @security SEC-006: Parameterized queries via DAL
 * @security DB-006: Store-scoped tenant isolation
 * @security SEC-015: Path validation
 */
registerHandler<GetImageResponse | ReturnType<typeof createErrorResponse>>(
  'images:get',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = GetImageSchema.safeParse(input);
    if (!parseResult.success) {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid image ID');
    }

    const { image_id } = parseResult.data;

    // DB-006: Get configured store for tenant isolation
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    try {
      // Find image record
      const imageRecord = shiftReceiptImagesDAL.findById(image_id);
      if (!imageRecord) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Image not found');
      }

      // DB-006: Verify image belongs to configured store
      if (imageRecord.store_id !== store.store_id) {
        log.warn('Image access denied - store mismatch', {
          imageId: image_id,
          imageStoreId: imageRecord.store_id,
          configuredStoreId: store.store_id,
        });
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Image not found');
      }

      // Get file path
      const filePath = getImageFilePath(
        store.store_id,
        imageRecord.shift_id,
        imageRecord.image_hash,
        imageRecord.mime_type
      );

      // Verify file exists
      if (!fs.existsSync(filePath)) {
        log.warn('Image file not found on disk', { imageId: image_id, filePath });
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Image file not found');
      }

      // Read and encode file
      const buffer = fs.readFileSync(filePath);
      const base64Data = buffer.toString('base64');

      return {
        success: true,
        image_data: base64Data,
        mime_type: imageRecord.mime_type,
        file_name: imageRecord.file_name,
      };
    } catch (error) {
      log.error('Failed to retrieve image', {
        imageId: image_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Retrieve an image by ID' }
);

// ============================================================================
// Get Shift Images Handler
// ============================================================================

/**
 * Get all images for a shift
 *
 * Returns metadata for all images associated with a shift.
 * Optionally filter by document type.
 *
 * Channel: images:getByShift
 *
 * @security SEC-006: Parameterized queries via DAL
 * @security DB-006: Store-scoped tenant isolation
 */
registerHandler<ShiftImagesResponse | ReturnType<typeof createErrorResponse>>(
  'images:getByShift',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = GetShiftImagesSchema.safeParse(input);
    if (!parseResult.success) {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid shift ID');
    }

    const { shift_id, document_type } = parseResult.data;

    // DB-006: Get configured store for tenant isolation
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    try {
      // Verify shift exists and belongs to store
      const shift = shiftsDAL.findById(shift_id);
      if (!shift) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Shift not found');
      }

      // DB-006: Verify shift belongs to configured store
      if (shift.store_id !== store.store_id) {
        log.warn('Shift images access denied - store mismatch', {
          shiftId: shift_id,
          shiftStoreId: shift.store_id,
          configuredStoreId: store.store_id,
        });
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Shift not found');
      }

      // Get images (optionally filtered by type)
      let images: ShiftReceiptImage[];
      if (document_type) {
        images = shiftReceiptImagesDAL.findByDocumentType(
          store.store_id,
          shift_id,
          document_type as ReceiptDocumentType
        );
      } else {
        images = shiftReceiptImagesDAL.findByShiftId(store.store_id, shift_id);
      }

      // Get counts
      const counts = shiftReceiptImagesDAL.getCountsByDocumentType(store.store_id, shift_id);

      // Check file existence for each image
      const imagesWithStatus = images.map((img) => {
        const filePath = getImageFilePath(
          store.store_id,
          img.shift_id,
          img.image_hash,
          img.mime_type
        );

        return {
          id: img.id,
          document_type: img.document_type,
          file_name: img.file_name,
          file_size: img.file_size,
          mime_type: img.mime_type,
          payout_index: img.payout_index,
          uploaded_at: img.uploaded_at,
          has_image: fs.existsSync(filePath),
        };
      });

      return {
        images: imagesWithStatus,
        counts,
      };
    } catch (error) {
      log.error('Failed to get shift images', {
        shiftId: shift_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Get all images for a shift' }
);

// ============================================================================
// Delete Image Handler
// ============================================================================

/**
 * Delete an image by ID
 *
 * Removes the image file and database record.
 *
 * Channel: images:delete
 *
 * @security SEC-006: Parameterized queries via DAL
 * @security DB-006: Store-scoped tenant isolation
 */
registerHandler<{ success: boolean; message: string } | ReturnType<typeof createErrorResponse>>(
  'images:delete',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = GetImageSchema.safeParse(input);
    if (!parseResult.success) {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid image ID');
    }

    const { image_id } = parseResult.data;

    // DB-006: Get configured store for tenant isolation
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    try {
      // Find image record
      const imageRecord = shiftReceiptImagesDAL.findById(image_id);
      if (!imageRecord) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Image not found');
      }

      // DB-006: Verify image belongs to configured store
      if (imageRecord.store_id !== store.store_id) {
        log.warn('Image delete denied - store mismatch', {
          imageId: image_id,
          imageStoreId: imageRecord.store_id,
          configuredStoreId: store.store_id,
        });
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Image not found');
      }

      // Get file path and delete file if exists
      const filePath = getImageFilePath(
        store.store_id,
        imageRecord.shift_id,
        imageRecord.image_hash,
        imageRecord.mime_type
      );

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Delete database record
      const deleted = shiftReceiptImagesDAL.deleteImage(store.store_id, image_id);

      if (deleted) {
        log.info('Image deleted', { imageId: image_id });
        return { success: true, message: 'Image deleted successfully' };
      } else {
        return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, 'Failed to delete image');
      }
    } catch (error) {
      log.error('Failed to delete image', {
        imageId: image_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Delete an image by ID' }
);
