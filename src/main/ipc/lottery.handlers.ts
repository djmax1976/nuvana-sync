/**
 * Lottery IPC Handlers
 *
 * Handles lottery-related IPC requests from the renderer process.
 * All handlers validate input using Zod schemas per API-001.
 *
 * @module main/ipc/lottery.handlers
 * @security API-001: Input validation with Zod schemas
 * @security API-004: Authentication checks where required
 * @security DB-006: Store-scoped queries via DAL
 */

import { z } from 'zod';
import {
  registerHandler,
  createErrorResponse,
  createSuccessResponse,
  IPCErrorCodes,
} from './index';
import { lotteryGamesDAL } from '../dal/lottery-games.dal';
import { lotteryBinsDAL } from '../dal/lottery-bins.dal';
import { lotteryPacksDAL } from '../dal/lottery-packs.dal';
import { lotteryBusinessDaysDAL } from '../dal/lottery-business-days.dal';
import { storesDAL } from '../dal/stores.dal';
import { parseBarcode, validateBarcode } from '../services/scanner.service';
import { createLogger } from '../utils/logger';

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('lottery-handlers');

// ============================================================================
// Validation Schemas (API-001)
// ============================================================================

/**
 * UUID validation
 */
const UUIDSchema = z.string().uuid('Invalid UUID format');

/**
 * Serial number: 3 digits
 */
const SerialSchema = z.string().regex(/^\d{3}$/, 'Serial must be 3 digits');

/**
 * Barcode: 24 digits
 */
const BarcodeSchema = z.string().regex(/^\d{24}$/, 'Barcode must be 24 digits');

/**
 * Pack filter options
 */
const PackFilterSchema = z.object({
  status: z.enum(['RECEIVED', 'ACTIVATED', 'SETTLED', 'RETURNED']).optional(),
  game_id: UUIDSchema.optional(),
  bin_id: UUIDSchema.optional(),
});

/**
 * Receive pack input
 */
const ReceivePackSchema = z.object({
  game_id: UUIDSchema,
  pack_number: z.string().min(1).max(20),
  serialized_number: BarcodeSchema.optional(),
});

/**
 * Activate pack input
 */
const ActivatePackSchema = z.object({
  pack_id: UUIDSchema,
  bin_id: UUIDSchema,
  opening_serial: SerialSchema,
});

/**
 * Settle pack input (for manual settlement)
 */
const SettlePackSchema = z.object({
  pack_id: UUIDSchema,
  closing_serial: SerialSchema,
});

/**
 * Return pack input
 */
const ReturnPackSchema = z.object({
  pack_id: UUIDSchema,
  closing_serial: SerialSchema.optional(),
  return_reason: z.string().max(500).optional(),
});

/**
 * Day close input
 */
const PrepareCloseSchema = z.object({
  closings: z.array(
    z.object({
      pack_id: UUIDSchema,
      closing_serial: SerialSchema,
      is_sold_out: z.boolean().optional(),
    })
  ),
});

/**
 * Commit close input
 */
const CommitCloseSchema = z.object({
  day_id: UUIDSchema,
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get configured store ID
 * Throws error if store not configured
 */
function getStoreId(): string {
  const store = storesDAL.getConfiguredStore();
  if (!store) {
    throw new Error('Store not configured');
  }
  return store.store_id;
}

/**
 * Get current business date (YYYY-MM-DD)
 */
function getCurrentBusinessDate(): string {
  return new Date().toISOString().split('T')[0];
}

// ============================================================================
// Game Handlers
// ============================================================================

/**
 * Get all lottery games for the store
 * Channel: lottery:getGames
 */
registerHandler(
  'lottery:getGames',
  async () => {
    try {
      const storeId = getStoreId();
      const games = lotteryGamesDAL.findActiveByStore(storeId);

      return createSuccessResponse(games);
    } catch (error) {
      log.error('Failed to get games', { error });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to get games'
      );
    }
  },
  {
    description: 'Get all active lottery games',
  }
);

// ============================================================================
// Bin Handlers
// ============================================================================

/**
 * Get all lottery bins for the store
 * Channel: lottery:getBins
 */
registerHandler(
  'lottery:getBins',
  async () => {
    try {
      const storeId = getStoreId();
      const bins = lotteryBinsDAL.findBinsWithPacks(storeId);

      return createSuccessResponse(bins);
    } catch (error) {
      log.error('Failed to get bins', { error });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to get bins'
      );
    }
  },
  {
    description: 'Get all lottery bins with current packs',
  }
);

// ============================================================================
// Pack Handlers
// ============================================================================

/**
 * Get lottery packs with filters
 * Channel: lottery:getPacks
 */
registerHandler(
  'lottery:getPacks',
  async (_event, input: unknown) => {
    try {
      const storeId = getStoreId();

      // Validate filters if provided
      let filters = {};
      if (input) {
        const parseResult = PackFilterSchema.safeParse(input);
        if (parseResult.success) {
          filters = parseResult.data;
        }
      }

      const packs = lotteryPacksDAL.findPacksWithDetails(storeId, filters);

      return createSuccessResponse(packs);
    } catch (error) {
      log.error('Failed to get packs', { error });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to get packs'
      );
    }
  },
  {
    description: 'Get lottery packs with optional filters',
  }
);

/**
 * Receive a new pack
 * Channel: lottery:receivePack
 */
registerHandler(
  'lottery:receivePack',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = ReceivePackSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e: { message: string }) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      const storeId = getStoreId();
      const { game_id, pack_number, serialized_number } = parseResult.data;

      // If serialized number provided, parse it
      let packNum = pack_number;
      if (serialized_number) {
        const parsed = parseBarcode(serialized_number);
        if (parsed) {
          packNum = parsed.pack_number;
        }
      }

      const pack = lotteryPacksDAL.receive({
        store_id: storeId,
        game_id,
        pack_number: packNum,
      });

      log.info('Pack received', {
        packId: pack.pack_id,
        packNumber: pack.pack_number,
      });

      return createSuccessResponse(pack);
    } catch (error) {
      log.error('Failed to receive pack', { error });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to receive pack'
      );
    }
  },
  {
    requiresAuth: true,
    description: 'Receive a new lottery pack',
  }
);

/**
 * Activate a pack
 * Channel: lottery:activatePack
 */
registerHandler(
  'lottery:activatePack',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = ActivatePackSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e: { message: string }) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      const { pack_id, bin_id, opening_serial } = parseResult.data;
      const storeId = getStoreId();

      const pack = lotteryPacksDAL.activate(pack_id, {
        bin_id,
        opening_serial,
      });

      // Increment daily activation count
      const today = getCurrentBusinessDate();
      lotteryBusinessDaysDAL.incrementPacksActivated(storeId, today);

      log.info('Pack activated', {
        packId: pack.pack_id,
        binId: bin_id,
        openingSerial: opening_serial,
      });

      return createSuccessResponse(pack);
    } catch (error) {
      log.error('Failed to activate pack', { error });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to activate pack'
      );
    }
  },
  {
    requiresAuth: true,
    description: 'Activate a lottery pack in a bin',
  }
);

/**
 * Deplete (settle) a pack manually
 * Channel: lottery:depletePack
 */
registerHandler(
  'lottery:depletePack',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = SettlePackSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e: { message: string }) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      const { pack_id, closing_serial } = parseResult.data;

      // Calculate sales before settling
      const { ticketsSold, salesAmount } = lotteryPacksDAL.calculateSales(
        pack_id,
        closing_serial
      );

      const pack = lotteryPacksDAL.settle(pack_id, {
        closing_serial,
        tickets_sold: ticketsSold,
        sales_amount: salesAmount,
      });

      log.info('Pack depleted', {
        packId: pack.pack_id,
        closingSerial: closing_serial,
        ticketsSold,
        salesAmount,
      });

      return createSuccessResponse({
        ...pack,
        tickets_sold: ticketsSold,
        sales_amount: salesAmount,
      });
    } catch (error) {
      log.error('Failed to deplete pack', { error });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to deplete pack'
      );
    }
  },
  {
    requiresAuth: true,
    description: 'Mark a pack as depleted/sold out',
  }
);

/**
 * Return a pack
 * Channel: lottery:returnPack
 */
registerHandler(
  'lottery:returnPack',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = ReturnPackSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e: { message: string }) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      const { pack_id, closing_serial } = parseResult.data;

      // Calculate sales if closing serial provided
      let ticketsSold: number | undefined;
      let salesAmount: number | undefined;

      if (closing_serial) {
        const sales = lotteryPacksDAL.calculateSales(pack_id, closing_serial);
        ticketsSold = sales.ticketsSold;
        salesAmount = sales.salesAmount;
      }

      const pack = lotteryPacksDAL.returnPack(pack_id, {
        closing_serial,
        tickets_sold: ticketsSold,
        sales_amount: salesAmount,
      });

      log.info('Pack returned', {
        packId: pack.pack_id,
        closingSerial: closing_serial,
      });

      return createSuccessResponse(pack);
    } catch (error) {
      log.error('Failed to return pack', { error });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to return pack'
      );
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'shift_manager',
    description: 'Return a pack to distributor',
  }
);

// ============================================================================
// Day Close Handlers
// ============================================================================

/**
 * Prepare day close (Phase 1)
 * Channel: lottery:prepareDayClose
 */
registerHandler(
  'lottery:prepareDayClose',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = PrepareCloseSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e: { message: string }) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      const storeId = getStoreId();
      const today = getCurrentBusinessDate();

      // Get or create today's business day
      const day = lotteryBusinessDaysDAL.getOrCreateForDate(storeId, today);

      // Prepare close
      const result = lotteryBusinessDaysDAL.prepareClose(day.day_id, parseResult.data.closings);

      log.info('Day close prepared', {
        dayId: day.day_id,
        closingsCount: result.closings_count,
        estimatedTotal: result.estimated_lottery_total,
      });

      return createSuccessResponse(result);
    } catch (error) {
      log.error('Failed to prepare day close', { error });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to prepare day close'
      );
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'shift_manager',
    description: 'Prepare lottery day close',
  }
);

/**
 * Commit day close (Phase 2)
 * Channel: lottery:commitDayClose
 */
registerHandler(
  'lottery:commitDayClose',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = CommitCloseSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e: { message: string }) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      const { day_id } = parseResult.data;

      // TODO: Get current user ID from session
      const userId = 'system'; // Placeholder until auth context is integrated

      const result = lotteryBusinessDaysDAL.commitClose(day_id, userId);

      log.info('Day close committed', {
        dayId: day_id,
        closingsCount: result.closings_created,
        totalSales: result.lottery_total,
      });

      return createSuccessResponse(result);
    } catch (error) {
      log.error('Failed to commit day close', { error });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to commit day close'
      );
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'shift_manager',
    description: 'Commit lottery day close',
  }
);

/**
 * Cancel day close
 * Channel: lottery:cancelDayClose
 */
registerHandler(
  'lottery:cancelDayClose',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = z.object({ day_id: UUIDSchema }).safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues.map((e: { message: string }) => e.message).join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      const { day_id } = parseResult.data;

      lotteryBusinessDaysDAL.cancelClose(day_id);

      log.info('Day close cancelled', { dayId: day_id });

      return createSuccessResponse({ cancelled: true });
    } catch (error) {
      log.error('Failed to cancel day close', { error });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to cancel day close'
      );
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'shift_manager',
    description: 'Cancel pending lottery day close',
  }
);

// ============================================================================
// Barcode Handlers
// ============================================================================

/**
 * Parse a barcode
 * Channel: lottery:parseBarcode
 */
registerHandler(
  'lottery:parseBarcode',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = z.object({ barcode: z.string() }).safeParse(input);
    if (!parseResult.success) {
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Barcode is required');
    }

    try {
      const { barcode } = parseResult.data;
      const validation = validateBarcode(barcode);

      if (!validation.valid) {
        return createErrorResponse(
          IPCErrorCodes.VALIDATION_ERROR,
          validation.error || 'Invalid barcode'
        );
      }

      return createSuccessResponse(validation.parsed);
    } catch (error) {
      log.error('Failed to parse barcode', { error });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to parse barcode'
      );
    }
  },
  {
    description: 'Parse a lottery barcode',
  }
);

// Log handler registration
log.info('Lottery IPC handlers registered');
