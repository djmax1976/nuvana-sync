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
  getCurrentUser,
} from './index';
import { lotteryGamesDAL } from '../dal/lottery-games.dal';
import { lotteryBinsDAL } from '../dal/lottery-bins.dal';
import { lotteryPacksDAL, type PackWithDetails } from '../dal/lottery-packs.dal';
import { lotteryBusinessDaysDAL } from '../dal/lottery-business-days.dal';
import { storesDAL } from '../dal/stores.dal';
import { syncQueueDAL } from '../dal/sync-queue.dal';
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
 * API-001: Input validation with Zod schema
 */
const PackFilterSchema = z.object({
  status: z.enum(['RECEIVED', 'ACTIVATED', 'SETTLED', 'RETURNED']).optional(),
  game_id: UUIDSchema.optional(),
  bin_id: UUIDSchema.optional(),
  /** Search by pack_number or game name (min 2 chars, max 100 chars for safety) */
  search: z.string().min(2).max(100).optional(),
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
 * Get configured store with state information
 * Throws error if store not configured
 */
function getStoreWithState(): { store_id: string; state_id: string | null } {
  const store = storesDAL.getConfiguredStore();
  if (!store) {
    throw new Error('Store not configured');
  }
  return { store_id: store.store_id, state_id: store.state_id };
}

/**
 * Get current business date (YYYY-MM-DD)
 */
function getCurrentBusinessDate(): string {
  return new Date().toISOString().split('T')[0];
}

// ============================================================================
// Pack Sync Payload Types and Helpers
// ============================================================================

/**
 * Pack sync payload structure
 * API-008: OUTPUT_FILTERING - Excludes internal fields (created_at, updated_at, cloud_pack_id)
 * DB-006: TENANT_ISOLATION - Includes store_id for multi-tenant sync
 * API-001: Includes game_code as required by cloud API spec
 */
interface PackSyncPayload {
  pack_id: string;
  store_id: string;
  game_id: string;
  game_code: string;
  pack_number: string;
  status: string;
  bin_id: string | null;
  opening_serial: string | null;
  closing_serial: string | null;
  tickets_sold: number;
  sales_amount: number;
  received_at: string | null;
  received_by: string | null;
  activated_at: string | null;
  activated_by: string | null;
  settled_at: string | null;
  returned_at: string | null;
}

/**
 * Build a sync payload for a pack operation
 * API-008: OUTPUT_FILTERING - Excludes internal fields (created_at, updated_at, cloud_pack_id, synced_at)
 * SEC-006: Uses structured object, not string interpolation
 * API-001: Includes game_code as required by cloud API spec
 *
 * @param pack - Pack data from DAL
 * @param gameCode - Game code from lottery_games table (required by API)
 * @param activatedBy - Optional activated_by user ID (not stored in pack record)
 * @returns Sync payload suitable for cloud sync
 */
function buildPackSyncPayload(
  pack: {
    pack_id: string;
    store_id: string;
    game_id: string;
    pack_number: string;
    status: string;
    bin_id: string | null;
    opening_serial: string | null;
    closing_serial: string | null;
    tickets_sold: number;
    sales_amount: number;
    received_at: string | null;
    received_by: string | null;
    activated_at: string | null;
    settled_at: string | null;
    returned_at: string | null;
  },
  gameCode: string,
  activatedBy?: string | null
): PackSyncPayload {
  return {
    pack_id: pack.pack_id,
    store_id: pack.store_id,
    game_id: pack.game_id,
    game_code: gameCode,
    pack_number: pack.pack_number,
    status: pack.status,
    bin_id: pack.bin_id,
    opening_serial: pack.opening_serial,
    closing_serial: pack.closing_serial,
    tickets_sold: pack.tickets_sold,
    sales_amount: pack.sales_amount,
    received_at: pack.received_at,
    received_by: pack.received_by,
    activated_at: pack.activated_at,
    activated_by: activatedBy ?? null,
    settled_at: pack.settled_at,
    returned_at: pack.returned_at,
  };
}

/**
 * Response type for lottery packs matching frontend LotteryPackResponse interface
 * API-008: OUTPUT_FILTERING - Transforms flat DAL response to nested API contract
 */
interface PackResponse {
  pack_id: string;
  game_id: string;
  pack_number: string;
  opening_serial: string | null;
  closing_serial: string | null;
  status: string;
  store_id: string;
  bin_id: string | null;
  received_at: string | null;
  activated_at: string | null;
  settled_at: string | null;
  returned_at: string | null;
  game?: {
    game_id: string;
    game_code: string;
    name: string;
    price: number | null;
    tickets_per_pack: number;
    status?: string;
  };
  bin?: {
    bin_id: string;
    bin_number: number;
    label: string | null;
  } | null;
  can_return?: boolean;
}

/**
 * Transform flat DAL PackWithDetails to nested PackResponse for API contract
 * API-008: OUTPUT_FILTERING - Ensures consistent response shape for frontend
 *
 * @param pack - Flat pack data from DAL with joined fields
 * @returns Nested response matching LotteryPackResponse interface
 */
function transformPackToResponse(pack: PackWithDetails): PackResponse {
  const response: PackResponse = {
    pack_id: pack.pack_id,
    game_id: pack.game_id,
    pack_number: pack.pack_number,
    opening_serial: pack.opening_serial,
    closing_serial: pack.closing_serial,
    status: pack.status,
    store_id: pack.store_id,
    bin_id: pack.bin_id,
    received_at: pack.received_at,
    activated_at: pack.activated_at,
    settled_at: pack.settled_at,
    returned_at: pack.returned_at,
    // SEC-010: AUTHZ - Backend determines returnability
    can_return: pack.status === 'RECEIVED' || pack.status === 'ACTIVATED',
  };

  // Build nested game object if game data exists
  if (pack.game_name !== null) {
    response.game = {
      game_id: pack.game_id,
      game_code: pack.game_code || '',
      name: pack.game_name,
      price: pack.game_price,
      tickets_per_pack: pack.game_tickets_per_pack || 0,
      status: pack.game_status || undefined,
    };
  }

  // Build nested bin object if bin data exists
  if (pack.bin_id !== null && pack.bin_number !== null) {
    response.bin = {
      bin_id: pack.bin_id,
      bin_number: pack.bin_number,
      label: pack.bin_label,
    };
  }

  return response;
}

// ============================================================================
// Game Handlers
// ============================================================================

/**
 * Get all lottery games for the store
 * Channel: lottery:getGames
 *
 * @security API-003: Sanitized error responses
 */
registerHandler(
  'lottery:getGames',
  async () => {
    try {
      const storeId = getStoreId();
      const games = lotteryGamesDAL.findActiveByStore(storeId);

      return createSuccessResponse(games);
    } catch (error) {
      // API-003: Log full error server-side, return generic message
      log.error('Failed to get games', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to retrieve games. Please try again.'
      );
    }
  },
  {
    description: 'Get all active lottery games',
  }
);

/**
 * List games filter schema
 * API-001: Input validation with Zod schema
 * SEC-014: Enum constraints for status, length limits for search
 */
const ListGamesFilterSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE', 'DISCONTINUED']).optional(),
  search: z.string().min(2).max(100).optional(),
});

/**
 * List games pagination schema
 * API-001: Input validation with Zod schema
 * SEC-014: Bounded pagination to prevent unbounded reads
 */
const ListGamesPaginationSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
  sortBy: z.enum(['name', 'game_code', 'price', 'status', 'created_at']).optional(),
  sortOrder: z.enum(['ASC', 'DESC']).optional(),
});

/**
 * Combined list games input schema
 */
const ListGamesInputSchema = z.object({
  filters: ListGamesFilterSchema.optional(),
  pagination: ListGamesPaginationSchema.optional(),
});

/**
 * Game response with pack counts
 * API-008: OUTPUT_FILTERING - Controlled response shape
 */
interface GameListItemResponse {
  game_id: string;
  game_code: string;
  name: string;
  price: number;
  pack_value: number;
  tickets_per_pack: number | null;
  status: string;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
  pack_counts: {
    total: number;
    received: number;
    active: number;
    settled: number;
    returned: number;
  };
}

/**
 * Transform game with pack counts to API response
 * API-008: OUTPUT_FILTERING - Excludes internal fields (store_id, cloud_game_id, deleted_at)
 */
function transformGameToResponse(
  game: import('../dal/lottery-games.dal').GameWithPackCounts
): GameListItemResponse {
  return {
    game_id: game.game_id,
    game_code: game.game_code,
    name: game.name,
    price: game.price,
    pack_value: game.pack_value,
    tickets_per_pack: game.tickets_per_pack,
    status: game.status,
    synced_at: game.synced_at,
    created_at: game.created_at,
    updated_at: game.updated_at,
    pack_counts: {
      total: game.total_packs,
      received: game.received_packs,
      active: game.active_packs,
      settled: game.settled_packs,
      returned: game.returned_packs,
    },
  };
}

/**
 * List lottery games with pack counts
 * Channel: lottery:listGames
 *
 * Enterprise-grade games listing with:
 * - API-001: Input validation with Zod schemas
 * - API-003: Sanitized error responses
 * - API-008: Output filtering (excludes internal fields)
 * - DB-006: Store-scoped queries via DAL
 * - SEC-006: Parameterized queries in DAL
 * - SEC-014: Bounded pagination, validated enums
 *
 * @param input - Filters and pagination options
 * @returns Paginated games list with pack counts
 */
registerHandler(
  'lottery:listGames',
  async (_event, input: unknown) => {
    try {
      const storeId = getStoreId();

      // API-001: Validate input with Zod schema
      let filters = {};
      let pagination = {};

      if (input) {
        const parseResult = ListGamesInputSchema.safeParse(input);
        if (!parseResult.success) {
          log.warn('Invalid listGames input', {
            errors: parseResult.error.issues,
          });
          return createErrorResponse(
            IPCErrorCodes.VALIDATION_ERROR,
            'Invalid filter or pagination parameters'
          );
        }
        filters = parseResult.data.filters || {};
        pagination = parseResult.data.pagination || {};
      }

      // Query games with pack counts (DB-006: store-scoped, SEC-006: parameterized)
      const result = lotteryGamesDAL.listGamesWithPackCounts(storeId, filters, pagination);

      // API-008: Transform to response shape (excludes internal fields)
      const transformedGames = result.games.map(transformGameToResponse);

      return createSuccessResponse({
        games: transformedGames,
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.hasMore,
      });
    } catch (error) {
      // API-003: Log full error server-side, return generic message
      log.error('Failed to list games', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to retrieve games. Please try again.'
      );
    }
  },
  {
    description: 'List lottery games with pack counts and pagination',
  }
);

// ============================================================================
// Bin Handlers
// ============================================================================

/**
 * Get all lottery bins for the store
 * Channel: lottery:getBins
 *
 * @security API-003: Sanitized error responses
 */
registerHandler(
  'lottery:getBins',
  async () => {
    try {
      const storeId = getStoreId();
      const bins = lotteryBinsDAL.findBinsWithPacks(storeId);

      return createSuccessResponse(bins);
    } catch (error) {
      // API-003: Log full error server-side, return generic message
      log.error('Failed to get bins', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to retrieve bins. Please try again.'
      );
    }
  },
  {
    description: 'Get all lottery bins with current packs',
  }
);

/**
 * Get lottery day bins with full pack details for day-based display
 * Channel: lottery:getDayBins
 *
 * Enterprise-grade endpoint that returns:
 * - All bins with their current activated pack details
 * - Actual opening_serial from pack records (not hardcoded)
 * - Calculated serial_end based on tickets_per_pack
 * - Business day information
 * - Recently activated, depleted, and returned packs
 *
 * @security API-003: Sanitized error responses
 * @security DB-006: Store-scoped via DAL (tenant isolation)
 * @security SEC-006: All queries use parameterized statements
 */
registerHandler(
  'lottery:getDayBins',
  async () => {
    try {
      const storeId = getStoreId();
      const today = getCurrentBusinessDate();

      // Get bins with full pack details (SEC-006: parameterized query, DB-006: store-scoped)
      const dayBins = lotteryBinsDAL.getDayBinsWithFullPackDetails(storeId);

      // Get or create today's business day
      const businessDay = lotteryBusinessDaysDAL.getOrCreateForDate(storeId, today);

      // Get last closed day for business period info
      // This determines the start date for enterprise close-to-close model
      const closedDays = lotteryBusinessDaysDAL.findByStatus(storeId, 'CLOSED');
      const lastClosedDay = closedDays.length > 0 ? closedDays[0] : null;

      // Calculate days since last close
      let daysSinceLastClose: number | null = null;
      if (lastClosedDay) {
        const lastCloseDate = new Date(lastClosedDay.business_date);
        const todayDate = new Date(today);
        daysSinceLastClose = Math.floor(
          (todayDate.getTime() - lastCloseDate.getTime()) / (1000 * 60 * 60 * 24)
        );
      }

      // ========================================================================
      // Enterprise Close-to-Close Model Implementation
      // ========================================================================
      // The business period starts from the day AFTER the last closed day.
      // If no day has ever been closed, we use today as the start.
      // This ensures packs activated across multiple calendar days (before day close)
      // remain visible in the UI until the next day close.
      //
      // Example: Last close was Jan 15. Today is Jan 17.
      // - sinceDate = Jan 16 (day after last close)
      // - Shows all packs activated on Jan 16 and Jan 17
      // - Includes packs that were activated then returned/settled
      // ========================================================================

      let periodStartDate: string;
      if (lastClosedDay) {
        // Start from the day AFTER the last closed day
        const lastCloseDate = new Date(lastClosedDay.business_date);
        lastCloseDate.setDate(lastCloseDate.getDate() + 1);
        periodStartDate = lastCloseDate.toISOString().split('T')[0];
      } else {
        // No previous close - use today as start (first-ever business period)
        periodStartDate = today;
      }

      // ========================================================================
      // Optimized Queries: Push filtering to database layer
      // ========================================================================
      // Instead of fetching all packs and filtering in JavaScript, we use
      // specialized DAL methods that:
      // - Filter by date range in SQL (indexed column)
      // - Include tenant isolation (store_id in WHERE clause)
      // - Return only the data needed for this endpoint
      //
      // SEC-006: All queries use parameterized statements
      // DB-006: All queries scoped by store_id for tenant isolation
      // Performance: Date filters pushed to SQL, using indexed columns
      // ========================================================================

      // Get ALL packs activated since period start, regardless of current status
      // This is the key fix: we query by activation date, not current status
      const activatedPacksSincePeriodStart = lotteryPacksDAL.findPacksActivatedSince(
        storeId,
        periodStartDate
      );

      // Transform to API response format with current status preserved
      const recentlyActivated = activatedPacksSincePeriodStart.map((p) => ({
        pack_id: p.pack_id,
        pack_number: p.pack_number,
        game_name: p.game_name || 'Unknown Game',
        game_price: p.game_price || 0,
        bin_number: p.bin_number || 0,
        activated_at: p.activated_at || '',
        status: p.status, // Preserves current status: ACTIVATED, SETTLED, or RETURNED
      }));

      // Get depleted packs (settled since period start)
      const settledPacksSincePeriodStart = lotteryPacksDAL.findPacksSettledSince(
        storeId,
        periodStartDate
      );

      const recentlyDepleted = settledPacksSincePeriodStart.map((p) => ({
        pack_id: p.pack_id,
        pack_number: p.pack_number,
        game_name: p.game_name || 'Unknown Game',
        game_price: p.game_price || 0,
        bin_number: p.bin_number || 0,
        activated_at: p.activated_at || '',
        depleted_at: p.settled_at || '',
      }));

      // Get returned packs (returned since period start)
      const returnedPacksSincePeriodStart = lotteryPacksDAL.findPacksReturnedSince(
        storeId,
        periodStartDate
      );

      const recentlyReturned = returnedPacksSincePeriodStart.map((p) => ({
        pack_id: p.pack_id,
        pack_number: p.pack_number,
        game_name: p.game_name || 'Unknown Game',
        game_price: p.game_price || 0,
        bin_number: p.bin_number || 0,
        activated_at: p.activated_at || '',
        returned_at: p.returned_at || '',
        return_reason: null,
        return_notes: null,
        last_sold_serial: p.closing_serial,
        tickets_sold_on_return: p.tickets_sold || null,
        return_sales_amount: p.sales_amount || null,
        returned_by_name: null,
      }));

      // Construct response matching DayBinsResponse interface
      const response = {
        bins: dayBins.map((b) => ({
          bin_id: b.bin_id,
          bin_number: b.bin_number,
          name: b.name,
          is_active: b.is_active,
          pack: b.pack
            ? {
                pack_id: b.pack.pack_id,
                pack_number: b.pack.pack_number,
                game_name: b.pack.game_name,
                game_price: b.pack.game_price,
                starting_serial: b.pack.starting_serial,
                ending_serial: b.pack.ending_serial,
                serial_end: b.pack.serial_end,
                is_first_period: b.pack.is_first_period,
              }
            : null,
        })),
        business_day: {
          date: businessDay.business_date,
          day_id: businessDay.day_id,
          status: businessDay.status,
          first_shift_opened_at: businessDay.opened_at,
          last_shift_closed_at: businessDay.closed_at,
          shifts_count: 0, // TODO: Get actual shift count if needed
        },
        open_business_period: {
          started_at: businessDay.opened_at,
          last_closed_date: lastClosedDay?.business_date || null,
          days_since_last_close: daysSinceLastClose,
          is_first_period: lastClosedDay === null,
        },
        depleted_packs: recentlyDepleted,
        activated_packs: recentlyActivated,
        returned_packs: recentlyReturned,
        day_close_summary:
          businessDay.status === 'CLOSED'
            ? {
                lottery_total: businessDay.total_sales,
                closings_count: businessDay.total_packs_sold,
                closed_at: businessDay.closed_at,
                bins_closed: [], // Would need to query lottery_day_packs for full detail
              }
            : null,
      };

      log.debug('Day bins fetched', {
        storeId,
        binsCount: dayBins.length,
        periodStartDate,
        activatedCount: recentlyActivated.length,
        depletedCount: recentlyDepleted.length,
        returnedCount: recentlyReturned.length,
      });

      return createSuccessResponse(response);
    } catch (error) {
      // API-003: Log full error server-side, return generic message
      log.error('Failed to get day bins', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to retrieve day bins. Please try again.'
      );
    }
  },
  {
    description: 'Get lottery bins with full pack details for day-based display',
  }
);

// ============================================================================
// Pack Handlers
// ============================================================================

/**
 * Get lottery packs with filters
 * Channel: lottery:getPacks
 *
 * @security API-003: Sanitized error responses
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

      // API-008: Transform flat DAL response to nested API contract
      const transformedPacks = packs.map(transformPackToResponse);

      return createSuccessResponse(transformedPacks);
    } catch (error) {
      // API-003: Log full error server-side, return generic message
      log.error('Failed to get packs', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to retrieve packs. Please try again.'
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
 *
 * @security API-001: Input validation with Zod schemas
 * @security API-003: Sanitized error responses
 */
registerHandler(
  'lottery:receivePack',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = ReceivePackSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
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

      // Look up game to get game_code for sync payload
      const game = lotteryGamesDAL.findById(game_id);
      if (!game) {
        return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Game not found');
      }

      const pack = lotteryPacksDAL.receive({
        store_id: storeId,
        game_id,
        pack_number: packNum,
      });

      // SYNC-001: Enqueue pack for cloud synchronization
      // DB-006: TENANT_ISOLATION - store_id included in sync payload
      // API-008: OUTPUT_FILTERING - Uses buildPackSyncPayload to exclude internal fields
      // API-001: game_code required by cloud API spec
      syncQueueDAL.enqueue({
        store_id: storeId,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'CREATE',
        payload: buildPackSyncPayload(pack, game.game_code),
      });

      log.info('Pack received', {
        packId: pack.pack_id,
        packNumber: pack.pack_number,
        syncQueued: true,
      });

      return createSuccessResponse(pack);
    } catch (error) {
      // API-003: Log full error server-side, return generic message
      log.error('Failed to receive pack', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to receive pack. Please try again.'
      );
    }
  },
  {
    requiresAuth: true,
    description: 'Receive a new lottery pack',
  }
);

/**
 * Check if a pack already exists in inventory
 * Channel: lottery:checkPackExists
 *
 * @security API-001: Input validation with Zod schemas
 * @security API-003: Sanitized error responses
 * @security DB-006: Store-scoped via DAL
 */
registerHandler(
  'lottery:checkPackExists',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = z
      .object({
        store_id: UUIDSchema,
        pack_number: z.string().min(1).max(20),
      })
      .safeParse(input);

    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      const storeId = getStoreId();
      const { pack_number } = parseResult.data;

      // Search for pack by pack_number across all games in this store
      const existingPack = lotteryPacksDAL.findByPackNumberOnly(storeId, pack_number);

      if (existingPack) {
        return createSuccessResponse({
          exists: true,
          pack: {
            pack_id: existingPack.pack_id,
            pack_number: existingPack.pack_number,
            status: existingPack.status,
            game: existingPack.game_code
              ? {
                  game_code: existingPack.game_code,
                  name: existingPack.game_name,
                }
              : undefined,
          },
        });
      }

      return createSuccessResponse({
        exists: false,
      });
    } catch (error) {
      // API-003: Log full error server-side, return generic message
      log.error('Failed to check pack existence', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to check pack. Please try again.'
      );
    }
  },
  {
    description: 'Check if a pack already exists in inventory',
  }
);

/**
 * Receive multiple packs in batch
 * Channel: lottery:receivePackBatch
 *
 * Parses 24-digit serialized barcodes, looks up games by code,
 * and creates packs. Returns created, duplicates, and errors arrays.
 *
 * @security API-001: Input validation with Zod schemas
 * @security API-003: Sanitized error responses
 * @security DB-006: Store-scoped via DAL
 */
registerHandler(
  'lottery:receivePackBatch',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = z
      .object({
        serialized_numbers: z.array(BarcodeSchema).min(1, 'At least one barcode required'),
        store_id: UUIDSchema,
      })
      .safeParse(input);

    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      const storeId = getStoreId();
      const { serialized_numbers } = parseResult.data;

      // SEC-010: AUTHZ - Get received_by from authenticated session, not from frontend
      // This ensures we can't spoof who received the packs
      const currentUser = getCurrentUser();
      const received_by = currentUser?.user_id;

      // Results tracking
      const created: Array<{
        pack_id: string;
        game_id: string;
        pack_number: string;
        status: 'RECEIVED';
        received_at: string;
        game: { game_id: string; game_code: string; name: string; price: number | null };
      }> = [];
      const duplicates: Array<{ pack_number: string; status: string }> = [];
      const errors: Array<{ serial: string; error: string }> = [];

      // Process each barcode
      for (const serial of serialized_numbers) {
        try {
          // Parse barcode to extract game_code and pack_number
          // Format: positions 1-4 = game_code, 5-11 = pack_number
          const game_code = serial.substring(0, 4);
          const pack_number = serial.substring(4, 11);

          // Look up game by code
          const game = lotteryGamesDAL.findByGameCode(storeId, game_code);
          if (!game) {
            errors.push({
              serial,
              error: `Game not found for code ${game_code}`,
            });
            continue;
          }

          // Check if pack already exists
          const existingPack = lotteryPacksDAL.findByPackNumber(storeId, game.game_id, pack_number);
          if (existingPack) {
            duplicates.push({
              pack_number,
              status: existingPack.status,
            });
            continue;
          }

          // Create the pack
          // SEC-010: AUTHZ - Pass received_by for audit trail
          const pack = lotteryPacksDAL.receive({
            store_id: storeId,
            game_id: game.game_id,
            pack_number,
            received_by,
          });

          // SYNC-001: Enqueue each created pack for cloud synchronization
          // DB-006: TENANT_ISOLATION - store_id included in sync payload
          // API-008: OUTPUT_FILTERING - Uses buildPackSyncPayload to exclude internal fields
          // API-001: game_code required by cloud API spec
          syncQueueDAL.enqueue({
            store_id: storeId,
            entity_type: 'pack',
            entity_id: pack.pack_id,
            operation: 'CREATE',
            payload: buildPackSyncPayload(pack, game.game_code),
          });

          created.push({
            pack_id: pack.pack_id,
            game_id: pack.game_id,
            pack_number: pack.pack_number,
            status: 'RECEIVED',
            received_at: pack.received_at || new Date().toISOString(),
            game: {
              game_id: game.game_id,
              game_code: game.game_code,
              name: game.name,
              price: game.price,
            },
          });
        } catch (packError) {
          // Individual pack error - add to errors list
          const errorMessage = packError instanceof Error ? packError.message : 'Unknown error';
          errors.push({
            serial,
            error: errorMessage,
          });
        }
      }

      log.info('Batch pack reception completed', {
        total: serialized_numbers.length,
        created: created.length,
        duplicates: duplicates.length,
        errors: errors.length,
      });

      return createSuccessResponse({
        created,
        duplicates,
        errors,
      });
    } catch (error) {
      // API-003: Log full error server-side, return generic message
      log.error('Failed to receive pack batch', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to receive packs. Please try again.'
      );
    }
  },
  {
    requiresAuth: true,
    description: 'Receive multiple lottery packs in batch',
  }
);

/**
 * Activate a pack
 * Channel: lottery:activatePack
 *
 * @security API-001: Input validation with Zod schemas
 * @security API-003: Sanitized error responses
 * @security SEC-010: AUTHZ - Get activated_by from session, not frontend
 */
registerHandler(
  'lottery:activatePack',
  async (_event, input: unknown) => {
    log.debug('lottery:activatePack called', { input });

    // API-001: Validate input
    const parseResult = ActivatePackSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      log.debug('Validation failed', { errorMessage });
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    log.debug('Validation passed', { data: parseResult.data });

    try {
      const { pack_id, bin_id, opening_serial } = parseResult.data;
      const storeId = getStoreId();
      log.debug('Got store ID', { storeId });

      // SEC-010: AUTHZ - Get activated_by from authenticated session, not from frontend
      // This ensures we can't spoof who activated the packs
      const currentUser = getCurrentUser();
      const activated_by = currentUser?.user_id;
      log.debug('Got current user', { activated_by });

      // DB-006: Pass store_id for tenant isolation validation
      log.debug('Calling DAL.activate', {
        pack_id,
        store_id: storeId,
        bin_id,
        opening_serial,
        activated_by,
      });
      const pack = lotteryPacksDAL.activate(pack_id, {
        store_id: storeId,
        bin_id,
        opening_serial,
        activated_by,
      });
      log.debug('Pack activated successfully', { pack_id: pack.pack_id });

      // Look up game to get game_code for sync payload
      const game = lotteryGamesDAL.findById(pack.game_id);
      if (!game) {
        log.error('Game not found for pack during sync', {
          packId: pack.pack_id,
          gameId: pack.game_id,
        });
        throw new Error('Game not found for pack');
      }

      // SYNC-001: Enqueue pack activation for cloud synchronization
      // DB-006: TENANT_ISOLATION - store_id included in sync payload
      // SEC-010: AUTHZ - activated_by from session included for audit trail
      // API-008: OUTPUT_FILTERING - Uses buildPackSyncPayload to exclude internal fields
      // API-001: game_code required by cloud API spec
      syncQueueDAL.enqueue({
        store_id: storeId,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: buildPackSyncPayload(pack, game.game_code, activated_by),
      });

      // Increment daily activation count
      const today = getCurrentBusinessDate();
      lotteryBusinessDaysDAL.incrementPacksActivated(storeId, today);

      log.info('Pack activated', {
        packId: pack.pack_id,
        binId: bin_id,
        openingSerial: opening_serial,
        activatedBy: activated_by,
        syncQueued: true,
      });

      return createSuccessResponse(pack);
    } catch (error) {
      // API-003: Log full error server-side
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      log.error('Failed to activate pack', {
        error: errorMessage,
        stack: errorStack,
      });

      // Return specific error for business logic validation failures (e.g., pack already activated)
      // These are not security-sensitive and help users understand the issue
      if (
        errorMessage.includes('Pack not found') ||
        errorMessage.includes('Cannot activate pack with status') ||
        errorMessage.includes('Pack must be in RECEIVED status') ||
        errorMessage.includes('Failed to activate pack -') ||
        errorMessage.includes('Store not configured')
      ) {
        return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
      }

      // Generic error for other failures (security-sensitive)
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to activate pack. Please try again.'
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
 *
 * @security API-001: Input validation with Zod schemas
 * @security API-003: Sanitized error responses
 */
registerHandler(
  'lottery:depletePack',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = SettlePackSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      const { pack_id, closing_serial } = parseResult.data;
      const storeId = getStoreId();

      // Calculate sales before settling
      const { ticketsSold, salesAmount } = lotteryPacksDAL.calculateSales(pack_id, closing_serial);

      // DB-006: Pass store_id for tenant isolation validation
      const pack = lotteryPacksDAL.settle(pack_id, {
        store_id: storeId,
        closing_serial,
        tickets_sold: ticketsSold,
        sales_amount: salesAmount,
      });

      // Look up game to get game_code for sync payload
      const game = lotteryGamesDAL.findById(pack.game_id);
      if (!game) {
        throw new Error('Game not found for pack');
      }

      // SYNC-001: Enqueue pack depletion for cloud synchronization
      // DB-006: TENANT_ISOLATION - store_id included in sync payload
      // API-008: OUTPUT_FILTERING - Uses buildPackSyncPayload to exclude internal fields
      // API-001: game_code required by cloud API spec
      syncQueueDAL.enqueue({
        store_id: storeId,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: buildPackSyncPayload(pack, game.game_code),
      });

      log.info('Pack depleted', {
        packId: pack.pack_id,
        storeId,
        closingSerial: closing_serial,
        ticketsSold,
        salesAmount,
        syncQueued: true,
      });

      return createSuccessResponse({
        ...pack,
        tickets_sold: ticketsSold,
        sales_amount: salesAmount,
      });
    } catch (error) {
      // API-003: Log full error server-side, return generic message
      log.error('Failed to deplete pack', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to deplete pack. Please try again.'
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
 *
 * @security API-001: Input validation with Zod schemas
 * @security API-003: Sanitized error responses
 */
registerHandler(
  'lottery:returnPack',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = ReturnPackSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      const { pack_id, closing_serial } = parseResult.data;
      const storeId = getStoreId();

      // Calculate sales if closing serial provided
      let ticketsSold: number | undefined;
      let salesAmount: number | undefined;

      if (closing_serial) {
        const sales = lotteryPacksDAL.calculateSales(pack_id, closing_serial);
        ticketsSold = sales.ticketsSold;
        salesAmount = sales.salesAmount;
      }

      // DB-006: Pass store_id for tenant isolation validation
      const pack = lotteryPacksDAL.returnPack(pack_id, {
        store_id: storeId,
        closing_serial,
        tickets_sold: ticketsSold,
        sales_amount: salesAmount,
      });

      // Look up game to get game_code for sync payload
      const game = lotteryGamesDAL.findById(pack.game_id);
      if (!game) {
        throw new Error('Game not found for pack');
      }

      // SYNC-001: Enqueue pack return for cloud synchronization
      // DB-006: TENANT_ISOLATION - store_id included in sync payload
      // API-008: OUTPUT_FILTERING - Uses buildPackSyncPayload to exclude internal fields
      // API-001: game_code required by cloud API spec
      syncQueueDAL.enqueue({
        store_id: storeId,
        entity_type: 'pack',
        entity_id: pack.pack_id,
        operation: 'UPDATE',
        payload: buildPackSyncPayload(pack, game.game_code),
      });

      log.info('Pack returned', {
        packId: pack.pack_id,
        storeId,
        closingSerial: closing_serial,
        syncQueued: true,
      });

      return createSuccessResponse(pack);
    } catch (error) {
      // API-003: Log full error server-side, return generic message
      log.error('Failed to return pack', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to return pack. Please try again.'
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
 *
 * @security API-001: Input validation with Zod schemas
 * @security API-003: Sanitized error responses
 */
registerHandler(
  'lottery:prepareDayClose',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = PrepareCloseSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
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
      // API-003: Log full error server-side, return generic message
      log.error('Failed to prepare day close', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to prepare day close. Please try again.'
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
 *
 * @security API-001: Input validation with Zod schemas
 * @security API-003: Sanitized error responses
 */
registerHandler(
  'lottery:commitDayClose',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = CommitCloseSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
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
      // API-003: Log full error server-side, return generic message
      log.error('Failed to commit day close', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to commit day close. Please try again.'
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
 *
 * @security API-001: Input validation with Zod schemas
 * @security API-003: Sanitized error responses
 */
registerHandler(
  'lottery:cancelDayClose',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = z.object({ day_id: UUIDSchema }).safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      const { day_id } = parseResult.data;

      lotteryBusinessDaysDAL.cancelClose(day_id);

      log.info('Day close cancelled', { dayId: day_id });

      return createSuccessResponse({ cancelled: true });
    } catch (error) {
      // API-003: Log full error server-side, return generic message
      log.error('Failed to cancel day close', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to cancel day close. Please try again.'
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
 *
 * @security API-001: Input validation with Zod schemas
 * @security API-003: Sanitized error responses
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
      // API-003: Log full error server-side, return generic message
      log.error('Failed to parse barcode', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to parse barcode. Please try again.'
      );
    }
  },
  {
    description: 'Parse a lottery barcode',
  }
);

// ============================================================================
// Configuration Handlers
// ============================================================================

/**
 * SEC-014: Schema for validating cloud config value response
 * Validates external data before processing or storage
 */
const CloudConfigValueSchema = z.object({
  config_value_id: z.string().uuid('Invalid config_value_id format'),
  amount: z.number().positive('Amount must be positive'),
  display_order: z.number().int().min(0, 'Display order must be non-negative'),
});

/**
 * SEC-014: Schema for validating cloud config response
 */
const CloudConfigResponseSchema = z.object({
  ticket_prices: z.array(CloudConfigValueSchema),
  pack_values: z.array(CloudConfigValueSchema),
});

/**
 * SEC-014: Schema for validating cloud game lookup response
 * Validates external data before processing or storage
 */
const CloudGameSchema = z.object({
  game_id: z.string().uuid('Invalid game_id format'),
  game_code: z.string().regex(/^\d{4}$/, 'Game code must be 4 digits'),
  name: z.string().min(1).max(255),
  price: z.number().positive('Price must be positive'),
  pack_value: z.number().positive('Pack value must be positive'),
  tickets_per_pack: z.number().int().positive().nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'DISCONTINUED']),
});

/**
 * Get lottery configuration values (ticket prices and pack values)
 * Fetches from cloud if online, falls back to local cache
 * Channel: lottery:getConfigValues
 *
 * @security SEC-014: Validates cloud response before caching
 * @security API-003: Sanitized error responses
 */
registerHandler(
  'lottery:getConfigValues',
  async () => {
    try {
      const { state_id } = getStoreWithState();
      const { cloudApiService } = await import('../services/cloud-api.service');
      const { lotteryConfigValuesDAL } = await import('../dal/lottery-config-values.dal');

      // Try to fetch from cloud first (cloud is source of truth)
      // Games/config are state-scoped, so we use state_id
      try {
        const cloudResponse = await cloudApiService.fetchLotteryConfigValues(state_id);

        // SEC-014: Validate cloud response before processing
        const validationResult = CloudConfigResponseSchema.safeParse(cloudResponse);
        if (!validationResult.success) {
          log.error('Invalid cloud config response format', {
            errors: validationResult.error.issues,
          });
          throw new Error('Invalid response format from cloud');
        }

        const validatedResponse = validationResult.data;

        // Cache the validated values locally
        const configValues = [
          ...validatedResponse.ticket_prices.map((v) => ({
            config_value_id: v.config_value_id,
            config_type: 'TICKET_PRICE' as const,
            amount: v.amount,
            display_order: v.display_order,
            is_active: true,
          })),
          ...validatedResponse.pack_values.map((v) => ({
            config_value_id: v.config_value_id,
            config_type: 'PACK_VALUE' as const,
            amount: v.amount,
            display_order: v.display_order,
            is_active: true,
          })),
        ];

        if (configValues.length > 0) {
          lotteryConfigValuesDAL.bulkUpsertFromCloud(configValues);
        }

        log.info('Config values fetched from cloud and cached', {
          ticketPrices: validatedResponse.ticket_prices.length,
          packValues: validatedResponse.pack_values.length,
        });

        return createSuccessResponse(validatedResponse);
      } catch (cloudError) {
        // API-003: Log full error server-side, return sanitized message
        log.warn('Cloud unavailable for config values', {
          error: cloudError instanceof Error ? cloudError.message : 'Unknown error',
        });

        const localValues = lotteryConfigValuesDAL.getActiveConfigValues();

        if (localValues.ticket_prices.length === 0 && localValues.pack_values.length === 0) {
          return createErrorResponse(
            IPCErrorCodes.NOT_FOUND,
            'Configuration values unavailable. Please check your connection.'
          );
        }

        return createSuccessResponse(localValues);
      }
    } catch (error) {
      // API-003: Log full error, return generic message
      log.error('Failed to get config values', { error });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to retrieve configuration values'
      );
    }
  },
  {
    description: 'Get lottery configuration values (ticket prices and pack values)',
  }
);

// ============================================================================
// Game Lookup and Creation Handlers
// ============================================================================

/**
 * Lookup game by code - cloud first, then local
 * Channel: lottery:lookupGameByCode
 *
 * @security SEC-014: Validates cloud response before caching
 * @security API-003: Sanitized error responses
 */
registerHandler(
  'lottery:lookupGameByCode',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = z
      .object({
        game_code: z.string().regex(/^\d{4}$/, 'Game code must be 4 digits'),
      })
      .safeParse(input);

    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      const { game_code } = parseResult.data;
      const { store_id: storeId, state_id } = getStoreWithState();

      const { cloudApiService } = await import('../services/cloud-api.service');

      // Try cloud first with state_id for proper scoping (games are state-level)
      try {
        const cloudGame = await cloudApiService.lookupGameByCode(game_code, state_id);

        if (cloudGame) {
          // SEC-014: Validate cloud response before processing
          const validationResult = CloudGameSchema.safeParse(cloudGame);
          if (!validationResult.success) {
            log.error('Invalid cloud game response format', {
              gameCode: game_code,
              errors: validationResult.error.issues,
            });
            throw new Error('Invalid response format from cloud');
          }

          const validatedGame = validationResult.data;

          // Found in cloud - save locally and return
          const localGame = lotteryGamesDAL.upsertFromCloud({
            cloud_game_id: validatedGame.game_id,
            store_id: storeId,
            game_code: validatedGame.game_code,
            name: validatedGame.name,
            price: validatedGame.price,
            pack_value: validatedGame.pack_value,
            tickets_per_pack: validatedGame.tickets_per_pack ?? undefined,
            status: validatedGame.status,
          });

          log.info('Game found in cloud and cached locally', {
            gameCode: game_code,
            gameId: localGame.game_id,
          });

          return createSuccessResponse({
            found: true,
            source: 'cloud',
            game: {
              game_id: localGame.game_id,
              game_code: localGame.game_code,
              name: localGame.name,
              price: localGame.price,
              pack_value: localGame.pack_value,
              tickets_per_pack: localGame.tickets_per_pack,
            },
          });
        }

        // Not found in cloud - return not found
        log.debug('Game not found in cloud', { gameCode: game_code });
        return createSuccessResponse({
          found: false,
          source: 'cloud',
          game: null,
        });
      } catch (cloudError) {
        // API-003: Log full error server-side, return sanitized info
        log.warn('Cloud unavailable for game lookup, checking local only', {
          error: cloudError instanceof Error ? cloudError.message : 'Unknown error',
          stack: cloudError instanceof Error ? cloudError.stack : undefined,
        });

        const localGame = lotteryGamesDAL.findByGameCode(storeId, game_code);

        if (localGame) {
          return createSuccessResponse({
            found: true,
            source: 'local',
            game: {
              game_id: localGame.game_id,
              game_code: localGame.game_code,
              name: localGame.name,
              price: localGame.price,
              pack_value: localGame.pack_value,
              tickets_per_pack: localGame.tickets_per_pack,
            },
          });
        }

        return createSuccessResponse({
          found: false,
          source: 'local',
          game: null,
        });
      }
    } catch (error) {
      // API-003: Log full error server-side, return generic message
      log.error('Failed to lookup game by code', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to lookup game. Please try again.'
      );
    }
  },
  {
    description: 'Lookup lottery game by code (cloud-first)',
  }
);

/**
 * Create a new store-scoped lottery game
 * Channel: lottery:createGame
 *
 * @security API-001: Input validation with Zod schemas
 * @security API-003: Sanitized error responses
 * @security DB-006: Store-scoped via DAL (no direct DB access)
 */
registerHandler(
  'lottery:createGame',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = z
      .object({
        game_code: z.string().regex(/^\d{4}$/, 'Game code must be 4 digits'),
        name: z.string().min(1).max(255),
        price: z.number().positive('Price must be positive'),
        pack_value: z.number().positive('Pack value must be positive'),
      })
      .safeParse(input);

    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      const { game_code, name, price, pack_value } = parseResult.data;
      const storeId = getStoreId();

      // Validate pack_value is divisible by price
      if (pack_value % price !== 0) {
        return createErrorResponse(
          IPCErrorCodes.VALIDATION_ERROR,
          'Pack value must be evenly divisible by ticket price'
        );
      }

      const tickets_per_pack = Math.floor(pack_value / price);

      // Check if game code already exists locally
      const existingGame = lotteryGamesDAL.findByGameCode(storeId, game_code);
      if (existingGame) {
        return createErrorResponse(
          IPCErrorCodes.CONFLICT,
          `Game with code ${game_code} already exists`
        );
      }

      // Create the game locally (store-scoped, does NOT sync to cloud)
      // DB-006: Using DAL method for proper parameterized queries
      const newGame = lotteryGamesDAL.create({
        store_id: storeId,
        game_code,
        name,
        price,
        pack_value,
        tickets_per_pack,
        status: 'ACTIVE',
        // Note: No cloud_game_id - this is a local store-scoped game
      });

      log.info('Store-scoped game created', {
        gameId: newGame.game_id,
        gameCode: game_code,
        name,
        price,
        packValue: pack_value,
        ticketsPerPack: tickets_per_pack,
        storeId,
      });

      return createSuccessResponse({
        game_id: newGame.game_id,
        game_code: newGame.game_code,
        name: newGame.name,
        price: newGame.price,
        pack_value: newGame.pack_value,
        tickets_per_pack,
      });
    } catch (error) {
      // API-003: Log full error server-side, return generic message
      log.error('Failed to create game', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to create game. Please try again.'
      );
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'shift_manager',
    description: 'Create a store-scoped lottery game',
  }
);

// ============================================================================
// Shift Lottery Sync Handlers (Phase 2)
// ============================================================================

/**
 * Shift opening payload interface
 * SEC-006: Typed interface prevents arbitrary field injection
 */
interface ShiftOpeningSyncPayload {
  shift_id: string;
  store_id: string;
  openings: Array<{
    bin_id: string;
    pack_id: string;
    opening_serial: string;
  }>;
  opened_at: string;
  opened_by: string | null;
}

/**
 * Shift closing payload interface
 * SEC-006: Typed interface prevents arbitrary field injection
 */
interface ShiftClosingSyncPayload {
  shift_id: string;
  store_id: string;
  closings: Array<{
    bin_id: string;
    pack_id: string;
    closing_serial: string;
    tickets_sold: number;
    sales_amount: number;
  }>;
  closed_at: string;
  closed_by: string | null;
}

/**
 * Schema for shift opening input
 * API-001: Input validation with Zod schema
 */
const RecordShiftOpeningSchema = z.object({
  shift_id: UUIDSchema,
  openings: z
    .array(
      z.object({
        bin_id: UUIDSchema,
        pack_id: UUIDSchema,
        opening_serial: SerialSchema,
      })
    )
    .min(1, 'At least one opening is required'),
});

/**
 * Schema for shift closing input
 * API-001: Input validation with Zod schema
 */
const RecordShiftClosingSchema = z.object({
  shift_id: UUIDSchema,
  closings: z
    .array(
      z.object({
        bin_id: UUIDSchema,
        pack_id: UUIDSchema,
        closing_serial: SerialSchema,
      })
    )
    .min(1, 'At least one closing is required'),
});

/**
 * Build a shift opening sync payload
 * API-008: OUTPUT_FILTERING - Excludes internal fields
 * SEC-006: Uses structured object, not string interpolation
 *
 * @param storeId - Store ID
 * @param shiftId - Shift ID
 * @param openings - Array of bin/pack opening serials
 * @param openedBy - User ID who recorded the openings
 * @returns Sync payload suitable for cloud sync
 */
function buildShiftOpeningSyncPayload(
  storeId: string,
  shiftId: string,
  openings: Array<{
    bin_id: string;
    pack_id: string;
    opening_serial: string;
  }>,
  openedBy: string | null
): ShiftOpeningSyncPayload {
  return {
    shift_id: shiftId,
    store_id: storeId,
    openings: openings.map((o) => ({
      bin_id: o.bin_id,
      pack_id: o.pack_id,
      opening_serial: o.opening_serial,
    })),
    opened_at: new Date().toISOString(),
    opened_by: openedBy,
  };
}

/**
 * Build a shift closing sync payload
 * API-008: OUTPUT_FILTERING - Excludes internal fields
 * SEC-006: Uses structured object, not string interpolation
 *
 * @param storeId - Store ID
 * @param shiftId - Shift ID
 * @param closings - Array of bin/pack closing data with sales
 * @param closedBy - User ID who recorded the closings
 * @returns Sync payload suitable for cloud sync
 */
function buildShiftClosingSyncPayload(
  storeId: string,
  shiftId: string,
  closings: Array<{
    bin_id: string;
    pack_id: string;
    closing_serial: string;
    tickets_sold: number;
    sales_amount: number;
  }>,
  closedBy: string | null
): ShiftClosingSyncPayload {
  return {
    shift_id: shiftId,
    store_id: storeId,
    closings: closings.map((c) => ({
      bin_id: c.bin_id,
      pack_id: c.pack_id,
      closing_serial: c.closing_serial,
      tickets_sold: c.tickets_sold,
      sales_amount: c.sales_amount,
    })),
    closed_at: new Date().toISOString(),
    closed_by: closedBy,
  };
}

/**
 * Record lottery shift opening serials
 * Channel: lottery:recordShiftOpening
 *
 * Records the opening serial numbers for all active lottery packs at shift start.
 * This data is used for lottery reconciliation and variance tracking.
 *
 * Enterprise-grade implementation:
 * - API-001: Input validation with Zod schemas
 * - API-003: Sanitized error responses with correlation
 * - API-008: OUTPUT_FILTERING - Excludes internal fields from sync payload
 * - DB-006: Store-scoped via DAL (tenant isolation)
 * - SEC-006: Parameterized queries via DAL
 * - SEC-010: AUTHZ - opened_by from session, not frontend
 * - SEC-017: Audit logging for compliance
 * - SYNC-001: Enqueue for cloud synchronization
 */
registerHandler(
  'lottery:recordShiftOpening',
  async (_event, input: unknown) => {
    // API-001: Validate input with Zod schema
    const parseResult = RecordShiftOpeningSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      log.warn('Invalid shift opening input', {
        errors: parseResult.error.issues,
      });
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      const storeId = getStoreId();
      const { shift_id, openings } = parseResult.data;

      // SEC-010: AUTHZ - Get opened_by from authenticated session, not from frontend
      const currentUser = getCurrentUser();
      const openedBy = currentUser?.user_id || null;

      // Validate each pack exists, is activated, and belongs to store
      const validatedOpenings: Array<{
        bin_id: string;
        pack_id: string;
        opening_serial: string;
      }> = [];

      for (const opening of openings) {
        // DB-006: Fetch pack to validate store ownership
        const pack = lotteryPacksDAL.findById(opening.pack_id);

        if (!pack) {
          return createErrorResponse(IPCErrorCodes.NOT_FOUND, `Pack not found: ${opening.pack_id}`);
        }

        // DB-006: TENANT_ISOLATION - Verify pack belongs to configured store
        if (pack.store_id !== storeId) {
          log.warn('Pack access denied - store mismatch', {
            packId: opening.pack_id,
            packStoreId: pack.store_id,
            configuredStoreId: storeId,
          });
          return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Pack not found');
        }

        if (pack.status !== 'ACTIVATED') {
          return createErrorResponse(
            IPCErrorCodes.VALIDATION_ERROR,
            `Pack ${pack.pack_number} is not activated (status: ${pack.status})`
          );
        }

        validatedOpenings.push({
          bin_id: opening.bin_id,
          pack_id: opening.pack_id,
          opening_serial: opening.opening_serial,
        });
      }

      // Build sync payload
      // API-008: OUTPUT_FILTERING - Uses helper to exclude internal fields
      const syncPayload = buildShiftOpeningSyncPayload(
        storeId,
        shift_id,
        validatedOpenings,
        openedBy
      );

      // SYNC-001: Enqueue for cloud synchronization
      // DB-006: TENANT_ISOLATION - store_id included in sync payload
      syncQueueDAL.enqueue({
        store_id: storeId,
        entity_type: 'shift_opening',
        entity_id: shift_id,
        operation: 'CREATE',
        payload: syncPayload,
      });

      // SEC-017: Audit logging
      log.info('Shift lottery opening recorded', {
        shiftId: shift_id,
        storeId,
        openingsCount: validatedOpenings.length,
        openedBy,
        syncQueued: true,
      });

      return createSuccessResponse({
        shift_id,
        openings_recorded: validatedOpenings.length,
        opened_at: syncPayload.opened_at,
        sync_queued: true,
      });
    } catch (error) {
      // API-003: Log full error server-side, return generic message
      log.error('Failed to record shift opening', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to record shift opening. Please try again.'
      );
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'cashier', // Any authenticated employee can record openings
    description: 'Record lottery shift opening serials',
  }
);

/**
 * Record lottery shift closing serials
 * Channel: lottery:recordShiftClosing
 *
 * Records the closing serial numbers and calculated sales for all active lottery packs
 * at shift end. This data is used for lottery reconciliation and variance tracking.
 *
 * Enterprise-grade implementation:
 * - API-001: Input validation with Zod schemas
 * - API-003: Sanitized error responses with correlation
 * - API-008: OUTPUT_FILTERING - Excludes internal fields from sync payload
 * - DB-006: Store-scoped via DAL (tenant isolation)
 * - SEC-006: Parameterized queries via DAL
 * - SEC-010: AUTHZ - closed_by from session, not frontend
 * - SEC-017: Audit logging for compliance
 * - SYNC-001: Enqueue for cloud synchronization
 */
registerHandler(
  'lottery:recordShiftClosing',
  async (_event, input: unknown) => {
    // API-001: Validate input with Zod schema
    const parseResult = RecordShiftClosingSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      log.warn('Invalid shift closing input', {
        errors: parseResult.error.issues,
      });
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      const storeId = getStoreId();
      const { shift_id, closings } = parseResult.data;

      // SEC-010: AUTHZ - Get closed_by from authenticated session, not from frontend
      const currentUser = getCurrentUser();
      const closedBy = currentUser?.user_id || null;

      // Validate each pack and calculate sales
      const validatedClosings: Array<{
        bin_id: string;
        pack_id: string;
        closing_serial: string;
        tickets_sold: number;
        sales_amount: number;
      }> = [];

      let totalTicketsSold = 0;
      let totalSalesAmount = 0;

      for (const closing of closings) {
        // DB-006: Fetch pack to validate store ownership
        const pack = lotteryPacksDAL.findById(closing.pack_id);

        if (!pack) {
          return createErrorResponse(IPCErrorCodes.NOT_FOUND, `Pack not found: ${closing.pack_id}`);
        }

        // DB-006: TENANT_ISOLATION - Verify pack belongs to configured store
        if (pack.store_id !== storeId) {
          log.warn('Pack access denied - store mismatch', {
            packId: closing.pack_id,
            packStoreId: pack.store_id,
            configuredStoreId: storeId,
          });
          return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Pack not found');
        }

        if (pack.status !== 'ACTIVATED') {
          return createErrorResponse(
            IPCErrorCodes.VALIDATION_ERROR,
            `Pack ${pack.pack_number} is not activated (status: ${pack.status})`
          );
        }

        // Calculate sales for this pack
        const { ticketsSold, salesAmount } = lotteryPacksDAL.calculateSales(
          closing.pack_id,
          closing.closing_serial
        );

        validatedClosings.push({
          bin_id: closing.bin_id,
          pack_id: closing.pack_id,
          closing_serial: closing.closing_serial,
          tickets_sold: ticketsSold,
          sales_amount: salesAmount,
        });

        totalTicketsSold += ticketsSold;
        totalSalesAmount += salesAmount;
      }

      // Build sync payload with calculated sales
      // API-008: OUTPUT_FILTERING - Uses helper to exclude internal fields
      const syncPayload = buildShiftClosingSyncPayload(
        storeId,
        shift_id,
        validatedClosings,
        closedBy
      );

      // SYNC-001: Enqueue for cloud synchronization
      // DB-006: TENANT_ISOLATION - store_id included in sync payload
      syncQueueDAL.enqueue({
        store_id: storeId,
        entity_type: 'shift_closing',
        entity_id: shift_id,
        operation: 'CREATE',
        payload: syncPayload,
      });

      // SEC-017: Audit logging with sales totals
      log.info('Shift lottery closing recorded', {
        shiftId: shift_id,
        storeId,
        closingsCount: validatedClosings.length,
        totalTicketsSold,
        totalSalesAmount,
        closedBy,
        syncQueued: true,
      });

      return createSuccessResponse({
        shift_id,
        closings_recorded: validatedClosings.length,
        total_tickets_sold: totalTicketsSold,
        total_sales_amount: totalSalesAmount,
        closed_at: syncPayload.closed_at,
        sync_queued: true,
      });
    } catch (error) {
      // API-003: Log full error server-side, return generic message
      log.error('Failed to record shift closing', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to record shift closing. Please try again.'
      );
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'cashier', // Any authenticated employee can record closings
    description: 'Record lottery shift closing serials',
  }
);

// Log handler registration
log.info('Lottery IPC handlers registered');
