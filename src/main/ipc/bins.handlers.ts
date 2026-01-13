/**
 * Bins IPC Handlers
 *
 * Handles lottery bin management IPC requests from the renderer process.
 * All handlers validate input using Zod schemas per API-001.
 *
 * @module main/ipc/bins.handlers
 * @security API-001: Input validation with Zod schemas
 * @security API-004: Authentication/role checks for write operations
 * @security SEC-014: Input validation
 * @security SEC-017: Audit logging for bin operations
 */

import { z } from 'zod';
import {
  registerHandler,
  createErrorResponse,
  createSuccessResponse,
  IPCErrorCodes,
} from './index';
import { binManagementService } from '../services/bin-management.service';
import { createLogger } from '../utils/logger';

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('bins-handlers');

// ============================================================================
// Validation Schemas (API-001)
// ============================================================================

/**
 * Bin ID validation schema
 */
const BinIdSchema = z.string().uuid('Invalid bin ID format');

/**
 * Create bin schema
 */
const CreateBinSchema = z.object({
  name: z
    .string()
    .min(1, 'Bin name is required')
    .max(50, 'Bin name cannot exceed 50 characters'),
  location: z
    .string()
    .max(100, 'Location cannot exceed 100 characters')
    .optional(),
});

/**
 * Update bin schema
 */
const UpdateBinSchema = z.object({
  binId: BinIdSchema,
  updates: z.object({
    name: z.string().min(1).max(50).optional(),
    location: z.string().max(100).optional(),
  }),
});

/**
 * Reorder bins schema
 */
const ReorderBinsSchema = z.object({
  binIds: z.array(BinIdSchema).min(1, 'At least one bin ID required'),
});

/**
 * Bulk create schema
 */
const BulkCreateSchema = z.object({
  count: z
    .number()
    .int('Count must be an integer')
    .min(1, 'Must create at least 1 bin')
    .max(200, 'Cannot create more than 200 bins at once'),
});

// ============================================================================
// Handlers
// ============================================================================

/**
 * List all bins
 *
 * Returns all active bins for the configured store with pack details.
 * No authentication required (read-only).
 *
 * Channel: bins:list
 */
registerHandler(
  'bins:list',
  async () => {
    const bins = binManagementService.getBins();

    return createSuccessResponse(bins);
  },
  {
    description: 'Get all bins with pack details',
  }
);

/**
 * Get single bin by ID
 *
 * Returns bin with pack details.
 *
 * Channel: bins:get
 */
registerHandler(
  'bins:get',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = z.object({ binId: BinIdSchema }).safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e: { message: string }) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { binId } = parseResult.data;
    const bin = binManagementService.getBinById(binId);

    if (!bin) {
      return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Bin not found');
    }

    return createSuccessResponse(bin);
  },
  {
    description: 'Get single bin by ID',
  }
);

/**
 * Create a new bin
 *
 * Creates a bin with auto-assigned bin number.
 * Requires MANAGER role.
 *
 * Channel: bins:create
 */
registerHandler(
  'bins:create',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = CreateBinSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e: { message: string }) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const result = binManagementService.createBin(parseResult.data);

    if (!result.success) {
      log.warn('Bin creation failed', { error: result.error });
      return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, result.error || 'Creation failed');
    }

    log.info('Bin created via IPC', { binId: result.bin?.bin_id });

    return createSuccessResponse(result.bin);
  },
  {
    requiresAuth: true,
    requiredRole: 'shift_manager',
    description: 'Create new bin (MANAGER only)',
  }
);

/**
 * Update an existing bin
 *
 * Updates bin name or location.
 * Requires MANAGER role.
 *
 * Channel: bins:update
 */
registerHandler(
  'bins:update',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = UpdateBinSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e: { message: string }) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { binId, updates } = parseResult.data;
    const result = binManagementService.updateBin(binId, {
      name: updates.name,
      location: updates.location,
    });

    if (!result.success) {
      if (result.error === 'Bin not found') {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, result.error);
      }
      return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, result.error || 'Update failed');
    }

    log.info('Bin updated via IPC', { binId });

    return createSuccessResponse(result.bin);
  },
  {
    requiresAuth: true,
    requiredRole: 'shift_manager',
    description: 'Update bin (MANAGER only)',
  }
);

/**
 * Delete a bin
 *
 * Soft deletes a bin if it has no active packs.
 * Requires MANAGER role.
 *
 * Channel: bins:delete
 */
registerHandler(
  'bins:delete',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = z.object({ binId: BinIdSchema }).safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e: { message: string }) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { binId } = parseResult.data;
    const result = binManagementService.deleteBin(binId);

    if (!result.success) {
      if (result.error === 'Bin not found') {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, result.error);
      }
      // Check if it's a pack validation error
      if (result.error?.includes('active pack')) {
        return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, result.error);
      }
      return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, result.error || 'Delete failed');
    }

    log.info('Bin deleted via IPC', { binId });

    return createSuccessResponse({ success: true });
  },
  {
    requiresAuth: true,
    requiredRole: 'shift_manager',
    description: 'Delete bin (MANAGER only)',
  }
);

/**
 * Reorder bins
 *
 * Updates display order based on provided array.
 * Requires MANAGER role.
 *
 * Channel: bins:reorder
 */
registerHandler(
  'bins:reorder',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = ReorderBinsSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e: { message: string }) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { binIds } = parseResult.data;
    const result = binManagementService.reorderBins(binIds);

    if (!result.success) {
      return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, result.error || 'Reorder failed');
    }

    log.info('Bins reordered via IPC', { count: binIds.length });

    return createSuccessResponse({ success: true });
  },
  {
    requiresAuth: true,
    requiredRole: 'shift_manager',
    description: 'Reorder bins (MANAGER only)',
  }
);

/**
 * Bulk create bins
 *
 * Creates multiple bins at once.
 * Requires MANAGER role.
 *
 * Channel: bins:bulkCreate
 */
registerHandler(
  'bins:bulkCreate',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = BulkCreateSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e: { message: string }) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { count } = parseResult.data;
    const result = binManagementService.bulkCreateBins(count);

    if (!result.success) {
      return createErrorResponse(IPCErrorCodes.INTERNAL_ERROR, result.error || 'Bulk create failed');
    }

    log.info('Bins bulk created via IPC', { count: result.bins?.length });

    return createSuccessResponse({
      success: true,
      bins: result.bins,
      count: result.bins?.length,
    });
  },
  {
    requiresAuth: true,
    requiredRole: 'shift_manager',
    description: 'Bulk create bins (MANAGER only)',
  }
);

/**
 * Get bin statistics
 *
 * Returns summary statistics for bins.
 *
 * Channel: bins:stats
 */
registerHandler(
  'bins:stats',
  async () => {
    const stats = binManagementService.getStats();

    return createSuccessResponse(stats);
  },
  {
    description: 'Get bin statistics',
  }
);

// Log handler registration
log.info('Bins IPC handlers registered');
