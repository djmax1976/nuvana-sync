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
import { shiftsDAL } from '../dal/shifts.dal';
import {
  transactionalOutbox,
  generateIdempotencyKey,
} from '../services/transactional-outbox.service';
import { parseBarcode, validateBarcode } from '../services/scanner.service';
import { settingsService } from '../services/settings.service';
import { createLogger } from '../utils/logger';
import { ReturnReasonSchema } from '../../shared/types/lottery.types';
import {
  calculateTicketsRemainingFromSerials,
  calculateTicketsSold,
  calculateSalesAmount,
  formatSerial,
  getLastTicketIndex,
  CalculationModes,
} from '../../shared/lottery/ticket-calculations';

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
  status: z.enum(['RECEIVED', 'ACTIVE', 'DEPLETED', 'RETURNED']).optional(),
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
 *
 * API-001: VALIDATION - Strict schema validation for pack activation
 * SEC-014: INPUT_VALIDATION - Boolean field with safe default
 *
 * @property pack_id - UUID of the pack to activate (ignored in onboarding_mode)
 * @property bin_id - UUID of the target bin
 * @property opening_serial - 3-digit serial number of first ticket
 * @property deplete_previous - When true (default), auto-deplete existing pack in bin
 *                              with reason AUTO_REPLACED for cloud sync compatibility
 * @property onboarding_mode - When true, creates pack in inventory AND activates it
 *                             Used for first-time store setup with pre-sold packs
 * @property game_id - Required when onboarding_mode is true (to create pack)
 * @property pack_number - Required when onboarding_mode is true (7-digit pack number)
 */
const ActivatePackSchema = z.object({
  pack_id: UUIDSchema.optional(), // Optional in onboarding mode (will be generated)
  bin_id: UUIDSchema,
  opening_serial: SerialSchema,
  /** Default true ensures safety - always check for bin collisions unless explicitly disabled */
  deplete_previous: z.boolean().optional().default(true),
  /**
   * BIZ-012-FIX: Onboarding mode flag
   * When true: Creates pack in inventory AND activates in single operation
   * When false (default): Requires pack to already exist in inventory
   */
  onboarding_mode: z.boolean().optional().default(false),
  /**
   * Game ID - Required when onboarding_mode is true
   * SEC-014: UUID validation prevents injection
   */
  game_id: UUIDSchema.optional(),
  /**
   * Pack number - Required when onboarding_mode is true
   * 7-digit pack number extracted from 24-digit barcode
   */
  pack_number: z
    .string()
    .regex(/^\d{7}$/, 'Pack number must be 7 digits')
    .optional(),
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
 *
 * SEC-014: Strict input validation for return operations
 * - return_reason: Required, must be one of the valid enum values
 * - return_notes: Optional, max 500 chars for additional context
 *
 * @see shared/types/lottery.types.ts for ReturnReasonSchema definition
 */
const ReturnPackSchema = z.object({
  pack_id: UUIDSchema,
  closing_serial: SerialSchema.optional(),
  /** Required return reason - must be valid enum value */
  return_reason: ReturnReasonSchema,
  /** Optional notes for additional context (max 500 chars) */
  return_notes: z.string().max(500).optional(),
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
  /**
   * When true, bypasses POS type restriction for wizard-initiated close.
   * SEC-010: Only Day Close wizard should set this flag.
   * Business Rule: Independent lottery close blocked for non-LOTTERY POS,
   * but wizard-initiated close is allowed for all POS types.
   */
  fromWizard: z.boolean().optional().default(false),
});

/**
 * Commit close input
 */
const CommitCloseSchema = z.object({
  day_id: UUIDSchema,
  /**
   * When true, bypasses POS type restriction for wizard-initiated close.
   * SEC-010: Only Day Close wizard should set this flag.
   * Business Rule: Independent lottery close blocked for non-LOTTERY POS,
   * but wizard-initiated close is allowed for all POS types.
   */
  fromWizard: z.boolean().optional().default(false),
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
 * Get current business date (YYYY-MM-DD) in local timezone
 * Uses local date, not UTC, to match user's business day
 */
export function getCurrentBusinessDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ============================================================================
// Pack Sync Payload Types and Helpers
// ============================================================================

/**
 * Pack sync payload structure
 * API-008: OUTPUT_FILTERING - Excludes internal fields (created_at, updated_at, cloud_pack_id)
 * DB-006: TENANT_ISOLATION - Includes store_id for multi-tenant sync
 * API-001: Includes game_code as required by cloud API spec
 *
 * Shift tracking fields (v019 schema alignment):
 * - shift_id: Shift context for activation (required for cashiers, optional for managers)
 * - depleted_shift_id: Shift context for depletion/settlement
 * - returned_shift_id: Shift context for returns
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
  depleted_at: string | null;
  returned_at: string | null;
  // Serial range fields (required by activate API)
  serial_start: string; // Starting serial number (e.g., "000")
  serial_end: string; // Ending serial number (e.g., "299" for 300-ticket pack)
  // Shift tracking fields (v019 schema alignment)
  shift_id: string | null; // Activation shift context
  depleted_shift_id: string | null; // Depletion shift context
  depleted_by: string | null; // User who depleted the pack
  returned_shift_id: string | null; // Return shift context
  returned_by: string | null; // User who returned the pack
  depletion_reason: string | null; // Reason for depletion (SHIFT_CLOSE, AUTO_REPLACED, MANUAL_SOLD_OUT, POS_LAST_TICKET)
  return_reason: string | null; // Reason for return (SUPPLIER_RECALL, DAMAGED, EXPIRED, INVENTORY_ADJUSTMENT, STORE_CLOSURE)
  return_notes: string | null; // Optional notes for return context
}

/**
 * Shift context for pack sync operations
 * Used to pass shift tracking data to buildPackSyncPayload
 */
interface PackSyncShiftContext {
  /** Shift ID for activation (required for cashiers, optional for managers) */
  shift_id?: string | null;
  /** Shift ID when pack was depleted/settled */
  depleted_shift_id?: string | null;
  /** User who depleted the pack */
  depleted_by?: string | null;
  /** Shift ID when pack was returned */
  returned_shift_id?: string | null;
  /** User who returned the pack */
  returned_by?: string | null;
  /** Reason for depletion */
  depletion_reason?: string | null;
  /** Reason for return (SUPPLIER_RECALL, DAMAGED, EXPIRED, INVENTORY_ADJUSTMENT, STORE_CLOSURE) */
  return_reason?: string | null;
  /** Optional notes for return context (max 500 chars) */
  return_notes?: string | null;
}

/**
 * Build a sync payload for a pack operation
 * API-008: OUTPUT_FILTERING - Excludes internal fields (created_at, updated_at, cloud_pack_id, synced_at)
 * SEC-006: Uses structured object, not string interpolation
 * API-001: Includes game_code, serial_start, serial_end as required by cloud API spec
 *
 * v019 Schema Alignment: Now includes shift tracking fields for:
 * - Activation shift context (shift_id)
 * - Depletion shift context (depleted_shift_id, depleted_by, depletion_reason)
 * - Return shift context (returned_shift_id, returned_by, return_reason, return_notes)
 *
 * BIZ-012-SYNC-FIX: Onboarding mode serial_start handling
 * - Normal operation: serial_start is always "000" (new packs start at first ticket)
 * - Onboarding mode: serial_start uses pack.opening_serial (pre-sold packs have tickets already sold)
 *
 * @param pack - Pack data from DAL
 * @param gameCode - Game code from lottery_games table (required by API)
 * @param ticketsPerPack - Number of tickets in pack (for calculating serial_end)
 * @param activatedBy - Optional activated_by user ID
 * @param shiftContext - Optional shift tracking context for audit trail
 * @param onboardingMode - When true, use pack.opening_serial as serial_start (for pre-sold packs)
 * @returns Sync payload suitable for cloud sync
 */
function buildPackSyncPayload(
  pack: {
    pack_id: string;
    store_id: string;
    game_id: string;
    pack_number: string;
    status: string;
    /** v029 API Alignment: Uses current_bin_id */
    current_bin_id: string | null;
    opening_serial: string | null;
    closing_serial: string | null;
    /** v029 API Alignment: Uses tickets_sold_count */
    tickets_sold_count: number;
    sales_amount: number;
    received_at: string | null;
    received_by: string | null;
    activated_at: string | null;
    depleted_at: string | null;
    returned_at: string | null;
  },
  gameCode: string,
  ticketsPerPack: number | null,
  activatedBy?: string | null,
  shiftContext?: PackSyncShiftContext,
  onboardingMode?: boolean
): PackSyncPayload {
  // Calculate serial_start and serial_end
  // BIZ-012-SYNC-FIX: Onboarding packs use actual opening_serial (pre-sold position)
  // Normal packs always start at "000" (first ticket)
  // SEC-014: opening_serial is already validated by Zod schema (3-digit numeric string)
  const serialStart = onboardingMode && pack.opening_serial ? pack.opening_serial : '000';

  // Use centralized function for last ticket index - SINGLE SOURCE OF TRUTH
  // SEC-014: Validate ticketsPerPack before use - no silent fallbacks
  let serialEnd: string;
  if (ticketsPerPack === null || ticketsPerPack === undefined) {
    // This indicates missing game data - log and use safe default for backwards compatibility
    // TODO: Make this throw once all callers properly pass ticketsPerPack
    serialEnd = '299';
  } else {
    const lastIndexResult = getLastTicketIndex(ticketsPerPack);
    if (!lastIndexResult.success) {
      throw new Error(
        `Invalid ticketsPerPack (${ticketsPerPack}) in buildPackSyncPayload: ${lastIndexResult.error}`
      );
    }
    const formatted = formatSerial(lastIndexResult.value);
    if (!formatted) {
      throw new Error(`Failed to format serial_end for ticketsPerPack=${ticketsPerPack}`);
    }
    serialEnd = formatted;
  }

  // v029 API Alignment: Map DAL field names to API field names
  return {
    pack_id: pack.pack_id,
    store_id: pack.store_id,
    game_id: pack.game_id,
    game_code: gameCode,
    pack_number: pack.pack_number,
    status: pack.status,
    bin_id: pack.current_bin_id, // Map current_bin_id to API's bin_id
    opening_serial: pack.opening_serial,
    closing_serial: pack.closing_serial,
    tickets_sold: pack.tickets_sold_count, // Map tickets_sold_count to API's tickets_sold
    sales_amount: pack.sales_amount,
    received_at: pack.received_at,
    received_by: pack.received_by,
    activated_at: pack.activated_at,
    activated_by: activatedBy ?? null,
    depleted_at: pack.depleted_at,
    returned_at: pack.returned_at,
    // Serial range fields (required by activate API)
    serial_start: serialStart,
    serial_end: serialEnd,
    // Shift tracking fields (v019 schema alignment)
    shift_id: shiftContext?.shift_id ?? null,
    depleted_shift_id: shiftContext?.depleted_shift_id ?? null,
    depleted_by: shiftContext?.depleted_by ?? null,
    returned_shift_id: shiftContext?.returned_shift_id ?? null,
    returned_by: shiftContext?.returned_by ?? null,
    depletion_reason: shiftContext?.depletion_reason ?? null,
    return_reason: shiftContext?.return_reason ?? null,
    return_notes: shiftContext?.return_notes ?? null,
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
  depleted_at: string | null;
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
    name: string;
    display_order: number;
  } | null;
  can_return?: boolean;
}

/**
 * Transform flat DAL PackWithDetails to nested PackResponse for API contract
 * API-008: OUTPUT_FILTERING - Ensures consistent response shape for frontend
 * v029 API Alignment: Maps current_bin_id to bin_id for API compatibility
 *
 * @param pack - Flat pack data from DAL with joined fields
 * @returns Nested response matching LotteryPackResponse interface
 */
function transformPackToResponse(pack: PackWithDetails): PackResponse {
  // v029 API Alignment: Map current_bin_id to bin_id for API responses
  const response: PackResponse = {
    pack_id: pack.pack_id,
    game_id: pack.game_id,
    pack_number: pack.pack_number,
    opening_serial: pack.opening_serial,
    closing_serial: pack.closing_serial,
    status: pack.status,
    store_id: pack.store_id,
    bin_id: pack.current_bin_id, // Map DAL's current_bin_id to API's bin_id
    received_at: pack.received_at,
    activated_at: pack.activated_at,
    depleted_at: pack.depleted_at,
    returned_at: pack.returned_at,
    // SEC-010: AUTHZ - Backend determines returnability
    can_return: pack.status === 'RECEIVED' || pack.status === 'ACTIVE',
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
  // v029 API Alignment: Use current_bin_id for bin lookup
  // v039 Cloud-aligned: Use name and display_order
  if (pack.current_bin_id !== null && pack.bin_name !== null) {
    response.bin = {
      bin_id: pack.current_bin_id, // Map DAL's current_bin_id to API's bin_id
      name: pack.bin_name,
      display_order: pack.bin_display_order || 0,
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
  /**
   * When true, only returns games that have at least one pack in inventory.
   * Used by inventory views to hide catalog games with no store inventory.
   * SEC-014: Boolean constraint - no injection risk
   */
  inventoryOnly: z.boolean().optional(),
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
    depleted: number;
    returned: number;
  };
}

/**
 * Transform game with pack counts to API response
 * API-008: OUTPUT_FILTERING - Excludes internal fields (store_id, deleted_at)
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
      depleted: game.settled_packs,
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

      // SEC-010: Get opened_by from authenticated session (not frontend)
      // opened_by is REQUIRED by cloud API for sync, but viewing bins is allowed without auth
      const currentUser = getCurrentUser();
      const openedBy = currentUser?.user_id;

      // Get bins with full pack details (SEC-006: parameterized query, DB-006: store-scoped)
      const dayBins = lotteryBinsDAL.getDayBinsWithFullPackDetails(storeId);

      // Get or create today's business day
      // Note: If no user authenticated, day is created locally but sync won't be queued (offline-first)
      const businessDay = lotteryBusinessDaysDAL.getOrCreateForDate(storeId, today, openedBy);

      // Get most recently closed day for business period info
      // This determines the start timestamp for enterprise close-to-close model
      // Sort by closed_at DESC to correctly handle multiple closings on the same business_date
      const closedDays = lotteryBusinessDaysDAL.findByStatus(storeId, 'CLOSED');
      const lastClosedDay =
        closedDays.length > 0
          ? closedDays.reduce((latest, day) =>
              (day.closed_at ?? '') > (latest.closed_at ?? '') ? day : latest
            )
          : null;

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
      // The business period starts at the EXACT close timestamp of the last
      // closed day — not at a calendar date boundary. This prevents packs
      // activated/returned/depleted during the previous session from appearing
      // as "ghost" entries in the current open day when sessions cross midnight.
      //
      // Example 1: Last day closed at 2026-02-05T00:34:36Z. New day opens.
      // - sinceTimestamp = 2026-02-05T00:34:36Z
      // - Only shows packs with timestamps >= the close time
      // - Packs from the closed session are correctly excluded
      //
      // Example 2: No day close ever done. First pack activated Jan 10.
      // - sinceTimestamp = 2024-01-10T00:00:00
      // - Shows ALL packs ever activated/returned/settled
      // ========================================================================

      let periodStartTimestamp: string;
      if (lastClosedDay && lastClosedDay.closed_at) {
        // Close-to-close model: period starts at the exact close timestamp
        // Packs with timestamps before this belong to the closed day
        periodStartTimestamp = lastClosedDay.closed_at;
      } else {
        // No previous close — first-ever business period
        // Query for the earliest pack action date to show ALL historical data
        const earliestPackDate = lotteryPacksDAL.findEarliestPackActionDate(storeId);
        periodStartTimestamp = earliestPackDate
          ? `${earliestPackDate}T00:00:00`
          : `${today}T00:00:00`;
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
      // Uses close-to-close timestamp to exclude packs from the previous closed session
      const activatedPacksSincePeriodStart = lotteryPacksDAL.findPacksActivatedSince(
        storeId,
        periodStartTimestamp
      );

      // Transform to API response format with current status preserved
      // v039 Cloud-aligned: bin_display_order (0-indexed) maps to bin_number (1-indexed) for UI
      // Consistent with lottery-bins.dal.ts:924 transformation pattern
      const recentlyActivated = activatedPacksSincePeriodStart.map((p) => ({
        pack_id: p.pack_id,
        pack_number: p.pack_number,
        game_name: p.game_name || 'Unknown Game',
        game_price: p.game_price || 0,
        bin_number: (p.bin_display_order ?? 0) + 1,
        activated_at: p.activated_at || '',
        status: p.status, // Preserves current status: ACTIVE, DEPLETED, or RETURNED
      }));

      // Get depleted packs (settled since period start)
      const settledPacksSincePeriodStart = lotteryPacksDAL.findPacksSettledSince(
        storeId,
        periodStartTimestamp
      );

      // v039 Cloud-aligned: bin_display_order (0-indexed) maps to bin_number (1-indexed) for UI
      // Consistent with lottery-bins.dal.ts:924 transformation pattern
      // SEC-014: Include sales fields for reconciliation display
      const recentlyDepleted = settledPacksSincePeriodStart.map((p) => ({
        pack_id: p.pack_id,
        pack_number: p.pack_number,
        game_name: p.game_name || 'Unknown Game',
        game_price: p.game_price || 0,
        bin_number: (p.bin_display_order ?? 0) + 1,
        activated_at: p.activated_at || '',
        depleted_at: p.depleted_at || '',
        // Starting serial from when pack was activated (opening_serial)
        starting_serial: p.opening_serial || null,
        // Sales fields for reconciliation - use ?? to preserve 0 values
        closing_serial: p.closing_serial ?? null,
        tickets_sold_count: p.tickets_sold_count ?? 0,
        sales_amount: p.sales_amount ?? 0,
      }));

      // Get returned packs (returned since period start)
      const returnedPacksSincePeriodStart = lotteryPacksDAL.findPacksReturnedSince(
        storeId,
        periodStartTimestamp
      );

      // v039 Cloud-aligned: bin_display_order (0-indexed) maps to bin_number (1-indexed) for UI
      // Consistent with lottery-bins.dal.ts:924 transformation pattern
      // SEC-014: Use ?? to preserve 0 values (|| converts 0 to null which is incorrect)
      const recentlyReturned = returnedPacksSincePeriodStart.map((p) => ({
        pack_id: p.pack_id,
        pack_number: p.pack_number,
        game_name: p.game_name || 'Unknown Game',
        game_price: p.game_price || 0,
        bin_number: (p.bin_display_order ?? 0) + 1,
        activated_at: p.activated_at || '',
        returned_at: p.returned_at || '',
        return_reason: p.return_reason ?? null,
        return_notes: p.return_notes ?? null,
        last_sold_serial: p.closing_serial ?? null,
        // Use ?? to preserve 0 values for reconciliation
        tickets_sold_on_return: p.tickets_sold_count ?? 0,
        return_sales_amount: p.sales_amount ?? 0,
        returned_by_name: null,
      }));

      // ========================================================================
      // SEC-010: AUTHZ - Capability flag for frontend authorization
      // ========================================================================
      // Determine if independent lottery close is allowed based on POS type.
      // This flag tells the frontend whether to show the "Close Day" button.
      //
      // LOTTERY POS type → can_close_independently: true (standalone close)
      // All other POS types → can_close_independently: false (use Day Close Wizard)
      //
      // The backend enforces this in prepareDayClose/commitDayClose handlers,
      // but providing the flag allows the frontend to hide the button entirely
      // rather than showing a disabled button or letting users attempt and fail.
      // ========================================================================
      const posType = settingsService.getPOSType();
      const canCloseIndependently = posType === 'LOTTERY';

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
        // SEC-010: Capability flag - true only for LOTTERY POS type
        // Frontend uses this to determine if Close Day button should be shown
        can_close_independently: canCloseIndependently,
      };

      log.debug('Day bins fetched', {
        storeId,
        binsCount: dayBins.length,
        periodStartTimestamp,
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
 * Get pack details schema
 * API-001: Input validation with Zod schema
 */
const GetPackDetailsSchema = z.object({
  pack_id: UUIDSchema,
});

/**
 * Get detailed pack information by ID
 * Channel: lottery:getPackDetails
 *
 * Returns pack data with game, bin, and sales information for display
 * in modals and detail views (e.g., MarkSoldOutDialog).
 *
 * @security API-001: Input validation with Zod schemas
 * @security API-003: Sanitized error responses - no stack traces or DB info leaked
 * @security DB-006: TENANT_ISOLATION - Pack must belong to configured store
 * @security SEC-006: Parameterized queries via DAL
 */
registerHandler(
  'lottery:getPackDetails',
  async (_event, input: unknown) => {
    // API-001: Validate input with Zod schema
    const parseResult = GetPackDetailsSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      log.warn('getPackDetails validation failed', { errors: errorMessage });
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      const { pack_id } = parseResult.data;
      // DB-006: TENANT_ISOLATION - Get store from session, not client input
      const storeId = getStoreId();

      // DB-006: Use tenant-isolated query method
      const pack = lotteryPacksDAL.getPackWithDetailsForStore(storeId, pack_id);

      if (!pack) {
        // API-003: Generic error - don't reveal if pack exists in other store
        log.warn('Pack not found or not accessible', { packId: pack_id, storeId });
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Pack not found');
      }

      // API-008: Transform flat DAL response to nested API contract
      const response = transformPackToResponse(pack);

      // ========================================================================
      // Calculate Pack Serial Range and Tickets Remaining
      // ========================================================================
      // Uses centralized ticket-calculations utility for consistency
      // SEC-014: All calculations validated with bounds checking
      // @see shared/lottery/ticket-calculations.ts
      // ========================================================================
      let serialEnd: string | undefined;
      let ticketsRemaining: number | undefined;

      if (pack.game_tickets_per_pack && pack.game_tickets_per_pack > 0) {
        // Use centralized function for last ticket index - SINGLE SOURCE OF TRUTH
        // The last ticket index is always tickets_per_pack - 1, regardless of opening_serial
        const lastIndexResult = getLastTicketIndex(pack.game_tickets_per_pack);
        if (lastIndexResult.success) {
          const lastTicketNum = lastIndexResult.value;
          serialEnd = formatSerial(lastTicketNum) || undefined;

          // Calculate tickets remaining based on current position
          // For ACTIVE packs: use prev_ending_serial as current position
          // For DEPLETED/RETURNED: tickets_remaining = 0
          if (pack.status === 'ACTIVE') {
            // Current position = prev_ending_serial (from last closed day) or opening_serial
            // SEC-014: Both should exist for any activated pack
            const currentPosition = pack.prev_ending_serial ?? pack.opening_serial;

            if (currentPosition) {
              // Use centralized calculation utility
              // Note: calculateTicketsRemainingFromSerials takes serialStart (first ticket in pack)
              // and serialEnd (last ticket in pack), not opening_serial
              const remainingResult = calculateTicketsRemainingFromSerials(
                0, // Pack always starts at serial 0
                lastTicketNum,
                currentPosition
              );

              if (remainingResult.success) {
                ticketsRemaining = remainingResult.value;
              }
            }
          } else if (pack.status === 'DEPLETED' || pack.status === 'RETURNED') {
            ticketsRemaining = 0;
          }
        }
      }

      // Add extended detail fields for LotteryPackDetailResponse
      const detailResponse = {
        ...response,
        tickets_sold: pack.tickets_sold_count,
        sales_amount: pack.sales_amount,
        serial_end: serialEnd,
        tickets_remaining: ticketsRemaining,
      };

      log.debug('Pack details retrieved', {
        packId: pack_id,
        status: pack.status,
        openingSerial: pack.opening_serial,
        prevEndingSerial: pack.prev_ending_serial,
        serialEnd,
        ticketsRemaining,
        calculationInputs:
          pack.status === 'ACTIVE'
            ? {
                currentPosition: pack.prev_ending_serial || pack.opening_serial,
                fallbackUsed: !pack.prev_ending_serial,
              }
            : undefined,
      });
      return createSuccessResponse(detailResponse);
    } catch (error) {
      // API-003: Log full error server-side, return generic message to client
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      log.error('Failed to get pack details', {
        error: errorMessage,
        stack: errorStack,
      });

      // API-003: Never leak internal error details to client
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        'Failed to retrieve pack details. Please try again.'
      );
    }
  },
  {
    description: 'Get detailed pack information by ID',
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

      // SYNC-5000 Phase 2: Atomic business-write + enqueue via transactional outbox
      // MQ-001: Idempotency key prevents duplicate queue entries
      // SEC-006: All queries use parameterized statements within transaction
      // DB-006: TENANT_ISOLATION - store_id included in sync payload
      const {
        result: pack,
        syncItem,
        deduplicated,
      } = transactionalOutbox.withSyncEnqueue(
        // Business operation
        () =>
          lotteryPacksDAL.receive({
            store_id: storeId,
            game_id,
            pack_number: packNum,
          }),
        // Sync data builder - builds sync payload from business operation result
        (receivedPack) => ({
          store_id: storeId,
          entity_type: 'pack',
          entity_id: receivedPack.pack_id,
          operation: 'CREATE' as const,
          payload: buildPackSyncPayload(receivedPack, game.game_code, game.tickets_per_pack),
          idempotency_key: generateIdempotencyKey({
            entity_type: 'pack',
            entity_id: receivedPack.pack_id,
            operation: 'CREATE',
          }),
        })
      );

      log.info('Pack received', {
        packId: pack.pack_id,
        packNumber: pack.pack_number,
        syncQueued: !!syncItem,
        deduplicated,
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
          // Parse barcode using centralized parser (SEC-014 compliant)
          // Returns: game_code (4 digits), pack_number (7 digits), serial_start (3 digits)
          const parsed = parseBarcode(serial);
          if (!parsed) {
            errors.push({
              serial,
              error: 'Invalid barcode format',
            });
            continue;
          }
          const { game_code, pack_number } = parsed;

          // Look up game by code
          const game = lotteryGamesDAL.findByGameCode(storeId, game_code);
          if (!game) {
            errors.push({
              serial,
              error: `Game not found for code ${game_code}`,
            });
            continue;
          }

          // ========================================================================
          // SEC-014: INPUT_VALIDATION - Game Status Validation
          // ========================================================================
          // Business Rule: Packs can only be received for games with ACTIVE status.
          // Games that are INACTIVE or DISCONTINUED cannot accept new pack inventory.
          // This prevents operational errors and maintains data integrity.
          // ========================================================================
          if (game.status !== 'ACTIVE') {
            log.warn('Pack reception rejected: game is not active', {
              serial,
              gameCode: game_code,
              gameId: game.game_id,
              gameName: game.name,
              gameStatus: game.status,
              storeId,
            });
            errors.push({
              serial,
              error: `Cannot receive pack: Game "${game.name}" is ${game.status}. Only packs for ACTIVE games can be received.`,
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
          // API-001: game_code, serial_start, serial_end required by cloud API spec
          syncQueueDAL.enqueue({
            store_id: storeId,
            entity_type: 'pack',
            entity_id: pack.pack_id,
            operation: 'CREATE',
            payload: buildPackSyncPayload(pack, game.game_code, game.tickets_per_pack),
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
 * v019 Schema Alignment: Now includes role-based shift validation
 * - Cashiers MUST have an active shift to activate packs
 * - Managers CAN activate without shift (shift_id = null allowed)
 * - shift_id is captured and sent to cloud API for audit trail
 *
 * @security API-001: Input validation with Zod schemas
 * @security API-003: Sanitized error responses
 * @security SEC-010: AUTHZ - Get activated_by and shift_id from session, not frontend
 * @security DB-006: Store-scoped operations via DAL
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
      const {
        pack_id: inputPackId,
        bin_id,
        opening_serial,
        deplete_previous,
        onboarding_mode,
        game_id: inputGameId,
        pack_number: inputPackNumber,
      } = parseResult.data;
      const storeId = getStoreId();
      log.debug('Got store ID', { storeId, onboardingMode: onboarding_mode });

      // SEC-010: AUTHZ - Get user and role from authenticated session, not from frontend
      // This ensures we can't spoof who activated the packs
      const currentUser = getCurrentUser();
      const activated_by = currentUser?.user_id;
      const userRole = currentUser?.role;
      log.debug('Got current user', { activated_by, userRole });

      // ========================================================================
      // Role-Based Shift Validation (v019 Schema Alignment)
      // ========================================================================
      // Business Logic:
      // - Cashiers MUST have an active shift to activate packs
      // - Shift Managers and Store Managers CAN activate without active shift
      // - If shift exists, capture shift_id for audit trail regardless of role
      //
      // SEC-010: AUTHZ - Enforce role-based access control
      // DB-006: Store-scoped shift lookup via DAL
      // ========================================================================
      let shift_id: string | null = null;
      const openShift = shiftsDAL.getOpenShift(storeId);

      if (userRole === 'cashier') {
        // Cashiers MUST have an active shift to activate packs
        if (!openShift) {
          log.warn('Cashier attempted pack activation without active shift', {
            userId: activated_by,
            packId: inputPackId || 'onboarding', // May be undefined in onboarding mode
            storeId,
          });
          return createErrorResponse(
            IPCErrorCodes.VALIDATION_ERROR,
            'You must have an active shift to activate packs. Please start a shift first.'
          );
        }
        shift_id = openShift.shift_id;
      } else {
        // Managers can activate without shift, but capture if available
        shift_id = openShift?.shift_id || null;
      }

      log.debug('Shift validation complete', {
        userRole,
        shiftId: shift_id,
        hasOpenShift: Boolean(openShift),
      });

      // ========================================================================
      // BIZ-012-FIX: Onboarding Mode Pack Creation
      // ========================================================================
      // When onboarding_mode is true:
      // - Validate required fields (game_id, pack_number)
      // - Create pack in inventory with RECEIVED status
      // - Use the created pack_id for activation
      // This allows first-time stores to set starting ticket positions for pre-sold packs
      //
      // SEC-006: All INSERTs use parameterized queries via DAL
      // DB-006: All operations scoped to store_id
      // ========================================================================
      let pack_id = inputPackId;

      if (onboarding_mode) {
        log.info('Onboarding mode activation initiated', {
          storeId,
          binId: bin_id,
          openingSerial: opening_serial,
          gameId: inputGameId,
          packNumber: inputPackNumber,
          userId: activated_by,
        });

        // Validate required fields for onboarding mode
        if (!inputGameId) {
          log.warn('Onboarding mode: game_id is required', { storeId });
          return createErrorResponse(
            IPCErrorCodes.VALIDATION_ERROR,
            'Game ID is required for onboarding mode pack activation.'
          );
        }
        if (!inputPackNumber) {
          log.warn('Onboarding mode: pack_number is required', { storeId });
          return createErrorResponse(
            IPCErrorCodes.VALIDATION_ERROR,
            'Pack number is required for onboarding mode pack activation.'
          );
        }

        // DB-006: Validate game exists AND belongs to this store (tenant isolation)
        const onboardingGame = lotteryGamesDAL.findByIdForStore(storeId, inputGameId);
        if (!onboardingGame) {
          log.error('Onboarding mode: Game not found', {
            gameId: inputGameId,
            storeId,
          });
          return createErrorResponse(
            IPCErrorCodes.VALIDATION_ERROR,
            'Game not found for this store.'
          );
        }

        // SEC-014: Validate game status is in allowlist for activation
        if (onboardingGame.status !== 'ACTIVE') {
          log.warn('Onboarding mode: Game is not active', {
            gameId: inputGameId,
            gameName: onboardingGame.name,
            gameStatus: onboardingGame.status,
            storeId,
          });
          return createErrorResponse(
            IPCErrorCodes.VALIDATION_ERROR,
            `Cannot activate pack: Game "${onboardingGame.name}" is ${onboardingGame.status}. Only packs for ACTIVE games can be activated.`
          );
        }

        // Check if pack with same pack_number + game_id already exists for this store
        // SEC-006: Parameterized query via DAL
        // DB-006: Store-scoped query
        const existingPack = lotteryPacksDAL.findByPackNumber(
          storeId,
          inputGameId,
          inputPackNumber
        );
        if (existingPack) {
          log.warn('Onboarding mode: Pack already exists', {
            packNumber: inputPackNumber,
            existingPackId: existingPack.pack_id,
            existingStatus: existingPack.status,
            storeId,
          });
          // If pack exists and is RECEIVED, we can activate it
          if (existingPack.status === 'RECEIVED') {
            pack_id = existingPack.pack_id;
            log.info('Onboarding mode: Using existing RECEIVED pack', {
              packId: pack_id,
              packNumber: inputPackNumber,
            });
          } else {
            return createErrorResponse(
              IPCErrorCodes.VALIDATION_ERROR,
              `Pack ${inputPackNumber} already exists with status ${existingPack.status}.`
            );
          }
        } else {
          // Create the pack in inventory with RECEIVED status
          // SEC-006: Parameterized INSERT via DAL
          // DB-006: Pack associated with store_id
          const newPack = lotteryPacksDAL.receive({
            store_id: storeId,
            game_id: inputGameId,
            pack_number: inputPackNumber,
            received_by: activated_by,
          });
          pack_id = newPack.pack_id;

          log.info('Onboarding mode: Pack created in inventory', {
            packId: pack_id,
            packNumber: inputPackNumber,
            gameId: inputGameId,
            storeId,
            receivedBy: activated_by,
          });
        }
      }

      // Ensure pack_id is set (either from input or onboarding)
      if (!pack_id) {
        log.warn('Pack ID is required', { onboardingMode: onboarding_mode });
        return createErrorResponse(
          IPCErrorCodes.VALIDATION_ERROR,
          'Pack ID is required for activation.'
        );
      }

      // ========================================================================
      // Game Status Validation (SEC-014: INPUT_VALIDATION, DB-006: TENANT_ISOLATION)
      // ========================================================================
      // Business Rule: Packs can only be activated for games with ACTIVE status.
      // Games that are INACTIVE or DISCONTINUED should not allow new pack activations.
      //
      // DB-006: Use findByIdForStore() for tenant isolation - validates game belongs to store
      // SEC-014: Validate game status against allowlist before business logic executes
      // ========================================================================

      // First, get the pack to retrieve its game_id (DB-006: store-scoped lookup)
      log.debug('Looking up pack for game status validation', {
        packId: pack_id,
        storeId,
      });
      const packForGameCheck = lotteryPacksDAL.findByIdForStore(storeId, pack_id);
      log.debug('Pack lookup result for game validation', {
        packId: pack_id,
        found: !!packForGameCheck,
        packStatus: packForGameCheck?.status,
        gameId: packForGameCheck?.game_id,
      });
      if (!packForGameCheck) {
        log.warn('Pack not found for game status validation', {
          packId: pack_id,
          storeId,
        });
        return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Pack not found');
      }

      // DB-006: Validate game exists AND belongs to this store (tenant isolation)
      const game = lotteryGamesDAL.findByIdForStore(storeId, packForGameCheck.game_id);
      if (!game) {
        log.error('Game not found for pack', {
          packId: pack_id,
          gameId: packForGameCheck.game_id,
          storeId,
        });
        return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Game not found for this pack');
      }

      // SEC-014: Validate game status is in allowlist for activation
      if (game.status !== 'ACTIVE') {
        log.warn('Pack activation rejected: game is not active', {
          packId: pack_id,
          gameId: game.game_id,
          gameName: game.name,
          gameStatus: game.status,
          storeId,
          userId: activated_by,
        });
        return createErrorResponse(
          IPCErrorCodes.VALIDATION_ERROR,
          `Cannot activate pack: Game "${game.name}" is ${game.status}. Only packs for ACTIVE games can be activated.`
        );
      }

      log.debug('Game status validation passed', {
        gameId: game.game_id,
        gameName: game.name,
        gameStatus: game.status,
      });

      // ========================================================================
      // Bin Collision Detection (BIN-001: One Active Pack Per Bin)
      // ========================================================================
      // Business Rule: A bin can only have ONE active pack at a time.
      // When activating a new pack in a bin that already has an active pack,
      // the existing pack must be auto-depleted with reason AUTO_REPLACED.
      //
      // SEC-006: Parameterized queries in DAL method
      // DB-006: TENANT_ISOLATION - store_id passed to findActiveInBin
      // SYNC-001: Depleted pack sync queued BEFORE new pack sync
      // ========================================================================

      // ========================================================================
      // Pre-fetch collision data (read-only, outside transaction)
      // ========================================================================
      // Check for existing pack in bin BEFORE transaction to prepare depletion data
      // DB-006: Pass store_id for tenant isolation

      let existingPack: ReturnType<typeof lotteryPacksDAL.findActiveInBin> = undefined;
      let existingPackGame: ReturnType<typeof lotteryGamesDAL.findByIdForStore> = undefined;
      let depletionData: {
        closingSerial: string;
        ticketsSoldCount: number;
        salesAmount: number;
        startingSerial: string; // BIZ-014: Store for mid-day depletion record
      } | null = null;

      if (deplete_previous) {
        existingPack = lotteryPacksDAL.findActiveInBin(storeId, bin_id);

        if (existingPack) {
          log.info('Bin collision detected - will auto-deplete existing pack', {
            binId: bin_id,
            existingPackId: existingPack.pack_id,
            existingPackNumber: existingPack.pack_number,
            newPackId: pack_id,
            storeId,
            userId: activated_by,
          });

          // ====================================================================
          // Get full pack details including prev_ending_serial for accurate depletion
          // DB-006: TENANT_ISOLATION - Use store-scoped query
          // ====================================================================
          const existingPackDetails = lotteryPacksDAL.getPackWithDetailsForStore(
            storeId,
            existingPack.pack_id
          );

          if (!existingPackDetails) {
            log.error('Pack details not found during collision detection', {
              existingPackId: existingPack.pack_id,
              storeId,
            });
            return createErrorResponse(
              IPCErrorCodes.INTERNAL_ERROR,
              'Unable to process bin collision: pack details missing. Please contact support.'
            );
          }

          // DB-006: Get existing pack's game info for depletion calculations
          existingPackGame = lotteryGamesDAL.findByIdForStore(storeId, existingPack.game_id);

          if (!existingPackGame) {
            log.error('Game not found for existing pack during collision detection', {
              existingPackId: existingPack.pack_id,
              existingGameId: existingPack.game_id,
              storeId,
            });
            return createErrorResponse(
              IPCErrorCodes.INTERNAL_ERROR,
              'Unable to process bin collision: game data missing for existing pack. Please contact support.'
            );
          }

          // ====================================================================
          // ENTERPRISE-GRADE DEPLETION CALCULATION
          // Uses centralized ticket-calculations.ts - single source of truth
          // SEC-014: INPUT_VALIDATION - No silent fallbacks, fail if data missing
          // ====================================================================

          // Determine current position: prev_ending_serial (if closed day exists) or opening_serial
          // SEC-014: Strict validation - both should exist for any activated pack
          const currentPosition =
            existingPackDetails.prev_ending_serial ?? existingPackDetails.opening_serial;

          if (!currentPosition) {
            log.error('Pack missing required serial data for depletion calculation', {
              existingPackId: existingPack.pack_id,
              prevEndingSerial: existingPackDetails.prev_ending_serial,
              openingSerial: existingPackDetails.opening_serial,
              storeId,
            });
            return createErrorResponse(
              IPCErrorCodes.INTERNAL_ERROR,
              'Unable to process bin collision: pack serial data incomplete. Please contact support.'
            );
          }

          // SEC-014: Validate game data exists
          if (!existingPackGame.tickets_per_pack || existingPackGame.tickets_per_pack <= 0) {
            log.error('Game missing tickets_per_pack for depletion calculation', {
              gameId: existingPack.game_id,
              ticketsPerPack: existingPackGame.tickets_per_pack,
              storeId,
            });
            return createErrorResponse(
              IPCErrorCodes.INTERNAL_ERROR,
              'Unable to process bin collision: game ticket count invalid. Please contact support.'
            );
          }

          if (existingPackGame.price === null || existingPackGame.price === undefined) {
            log.error('Game missing price for depletion calculation', {
              gameId: existingPack.game_id,
              price: existingPackGame.price,
              storeId,
            });
            return createErrorResponse(
              IPCErrorCodes.INTERNAL_ERROR,
              'Unable to process bin collision: game price invalid. Please contact support.'
            );
          }

          // Use centralized function to get last ticket index - SINGLE SOURCE OF TRUTH
          const lastTicketIndexResult = getLastTicketIndex(existingPackGame.tickets_per_pack);
          if (!lastTicketIndexResult.success) {
            log.error('Failed to get last ticket index during bin collision depletion', {
              existingPackId: existingPack.pack_id,
              ticketsPerPack: existingPackGame.tickets_per_pack,
              error: lastTicketIndexResult.error,
              storeId,
            });
            return createErrorResponse(
              IPCErrorCodes.INTERNAL_ERROR,
              `Unable to calculate depletion: ${lastTicketIndexResult.error}. Please contact support.`
            );
          }
          const lastTicketIndex = lastTicketIndexResult.value;

          // Use centralized calculation: INDEX mode for depletion (closing_serial is last ticket index)
          const ticketsSoldResult = calculateTicketsSold(
            currentPosition,
            lastTicketIndex,
            CalculationModes.INDEX
          );

          if (!ticketsSoldResult.success) {
            log.error('Ticket calculation failed during bin collision depletion', {
              existingPackId: existingPack.pack_id,
              currentPosition,
              lastTicketIndex,
              error: ticketsSoldResult.error,
              storeId,
            });
            return createErrorResponse(
              IPCErrorCodes.INTERNAL_ERROR,
              `Unable to calculate depletion: ${ticketsSoldResult.error}. Please contact support.`
            );
          }

          // Use centralized calculation for sales amount
          const salesAmountResult = calculateSalesAmount(
            ticketsSoldResult.value,
            existingPackGame.price
          );

          if (!salesAmountResult.success) {
            log.error('Sales amount calculation failed during bin collision depletion', {
              existingPackId: existingPack.pack_id,
              ticketsSold: ticketsSoldResult.value,
              gamePrice: existingPackGame.price,
              error: salesAmountResult.error,
              storeId,
            });
            return createErrorResponse(
              IPCErrorCodes.INTERNAL_ERROR,
              `Unable to calculate sales amount: ${salesAmountResult.error}. Please contact support.`
            );
          }

          // Format closing serial using centralized function
          const formattedClosingSerial = formatSerial(lastTicketIndex);
          if (!formattedClosingSerial) {
            log.error('Failed to format closing serial during bin collision depletion', {
              existingPackId: existingPack.pack_id,
              lastTicketIndex,
              storeId,
            });
            return createErrorResponse(
              IPCErrorCodes.INTERNAL_ERROR,
              'Unable to format closing serial. Please contact support.'
            );
          }

          depletionData = {
            closingSerial: formattedClosingSerial,
            ticketsSoldCount: ticketsSoldResult.value,
            salesAmount: salesAmountResult.value,
            startingSerial: currentPosition, // BIZ-014: Preserve for mid-day depletion record
          };

          log.info('Depletion values calculated for bin collision', {
            existingPackId: existingPack.pack_id,
            currentPosition,
            lastTicketIndex,
            closingSerial: formattedClosingSerial,
            ticketsSold: ticketsSoldResult.value,
            salesAmount: salesAmountResult.value,
            storeId,
          });
        }
      }

      // ========================================================================
      // SYNC-5000 Phase 2: Atomic business-write + enqueue via transactional outbox
      // ========================================================================
      // MQ-001: Idempotency keys prevent duplicate queue entries
      // SEC-006: All queries use parameterized statements within transaction
      // DB-006: TENANT_ISOLATION - store_id included in sync payload
      // SYNC-001: Depleted pack sync queued BEFORE new pack activation sync
      // ========================================================================

      interface ActivationResult {
        pack: ReturnType<typeof lotteryPacksDAL.activate>;
        settledPack: ReturnType<typeof lotteryPacksDAL.settle> | null;
      }

      const { result, syncItems, deduplicatedCount } =
        transactionalOutbox.withMultipleSyncEnqueue<ActivationResult>(
          // Business operation: settle existing pack (if collision) + activate new pack
          () => {
            let settledPack: ReturnType<typeof lotteryPacksDAL.settle> | null = null;

            // If bin collision, settle existing pack first (SYNC-001: deplete before activate)
            if (existingPack && depletionData) {
              settledPack = lotteryPacksDAL.settle(existingPack.pack_id, {
                store_id: storeId,
                closing_serial: depletionData.closingSerial,
                tickets_sold_count: depletionData.ticketsSoldCount,
                sales_amount: depletionData.salesAmount,
                depleted_by: activated_by,
                depleted_shift_id: shift_id,
                depletion_reason: 'AUTO_REPLACED',
              });

              // BIZ-014: Create lottery_day_packs record for mid-day depletion
              // This ensures reports have accurate starting_serial data for AUTO_REPLACED packs
              // The record is created NOW because day close only processes ACTIVE packs
              lotteryBusinessDaysDAL.recordMidDayDepletion(
                storeId,
                existingPack.pack_id,
                existingPack.current_bin_id,
                {
                  starting_serial: depletionData.startingSerial,
                  ending_serial: depletionData.closingSerial,
                  tickets_sold: depletionData.ticketsSoldCount,
                  sales_amount: depletionData.salesAmount,
                }
              );
            }

            // Activate the new pack
            const pack = lotteryPacksDAL.activate(pack_id, {
              store_id: storeId,
              current_bin_id: bin_id,
              opening_serial,
              activated_by,
              activated_shift_id: shift_id,
            });

            // Increment daily activation count (inside transaction for atomicity)
            const today = getCurrentBusinessDate();
            lotteryBusinessDaysDAL.incrementPacksActivated(storeId, today);

            return { pack, settledPack };
          },
          // Sync data builders - order matters: depleted pack first, then activated pack
          [
            // Builder 1: Depleted pack sync (if collision occurred)
            (activationResult) => {
              if (!activationResult.settledPack || !existingPackGame) {
                return null; // No collision, no sync item
              }

              return {
                store_id: storeId,
                entity_type: 'pack',
                entity_id: activationResult.settledPack.pack_id,
                operation: 'UPDATE' as const,
                payload: buildPackSyncPayload(
                  activationResult.settledPack,
                  existingPackGame.game_code,
                  existingPackGame.tickets_per_pack,
                  null,
                  {
                    depleted_shift_id: shift_id,
                    depleted_by: activated_by,
                    depletion_reason: 'AUTO_REPLACED',
                  }
                ),
                idempotency_key: generateIdempotencyKey({
                  entity_type: 'pack',
                  entity_id: activationResult.settledPack.pack_id,
                  operation: 'UPDATE',
                  discriminator: 'deplete:AUTO_REPLACED',
                }),
              };
            },
            // Builder 2: Activated pack sync
            // BIZ-012-SYNC-FIX: Pass onboarding_mode to use correct serial_start
            (activationResult) => ({
              store_id: storeId,
              entity_type: 'pack',
              entity_id: activationResult.pack.pack_id,
              operation: 'UPDATE' as const,
              payload: buildPackSyncPayload(
                activationResult.pack,
                game.game_code,
                game.tickets_per_pack,
                activated_by,
                { shift_id },
                onboarding_mode // BIZ-012-SYNC-FIX: Onboarding uses opening_serial, normal uses '000'
              ),
              idempotency_key: generateIdempotencyKey({
                entity_type: 'pack',
                entity_id: activationResult.pack.pack_id,
                operation: 'UPDATE',
                discriminator: 'activate',
              }),
            }),
          ]
        );

      const { pack, settledPack } = result;

      // Track depleted pack info for response (nullable)
      const depletedPackInfo =
        settledPack && existingPackGame
          ? {
              pack_id: settledPack.pack_id,
              pack_number: settledPack.pack_number,
              game_name: existingPackGame.name,
              depletion_reason: 'AUTO_REPLACED',
            }
          : null;

      if (settledPack && depletionData) {
        log.info('Pack auto-depleted due to bin collision', {
          depletedPackId: settledPack.pack_id,
          depletedPackNumber: settledPack.pack_number,
          newPackId: pack_id,
          binId: bin_id,
          depletionReason: 'AUTO_REPLACED',
          ticketsSoldCount: depletionData.ticketsSoldCount,
          salesAmount: depletionData.salesAmount,
          closingSerial: depletionData.closingSerial,
          depletedBy: activated_by,
          shiftId: shift_id,
          syncQueued: true,
        });
      }

      log.info('Pack activated', {
        packId: pack.pack_id,
        binId: bin_id,
        openingSerial: opening_serial,
        activatedBy: activated_by,
        shiftId: shift_id,
        userRole,
        hadCollision: depletedPackInfo !== null,
        depletedPackId: depletedPackInfo?.pack_id || null,
        syncQueued: syncItems.filter(Boolean).length,
        deduplicatedCount,
      });

      // Return response with optional depletedPack info (matches cloud API format)
      return createSuccessResponse({
        pack,
        depletedPack: depletedPackInfo,
      });
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
 * v019 Schema Alignment: Now includes shift tracking
 * - Captures depleted_shift_id, depleted_by, and depletion_reason
 * - Sends to cloud API for audit trail
 *
 * @security API-001: Input validation with Zod schemas
 * @security API-003: Sanitized error responses
 * @security SEC-010: AUTHZ - Get depleted_by from session, not frontend
 * @security DB-006: Store-scoped operations via DAL
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

      // SEC-010: AUTHZ - Get depleted_by from authenticated session
      const currentUser = getCurrentUser();
      const depleted_by = currentUser?.user_id || null;

      // Get current shift context for audit trail (v019 schema alignment)
      const openShift = shiftsDAL.getOpenShift(storeId);
      const depleted_shift_id = openShift?.shift_id || null;

      // Get pack details for calculation
      const packDetails = lotteryPacksDAL.getPackWithDetails(pack_id);
      if (!packDetails) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Pack not found');
      }

      // DEPLETION FORMULA: For "sold out" packs, closing_serial IS the last ticket INDEX
      // Formula: (closing_serial + 1) - starting_serial = total tickets sold
      // Example: 18-ticket pack (serials 000-017), closing_serial=017
      //          (17 + 1) - 0 = 18 tickets (correct)
      // This differs from day close where closing_serial is the NEXT position to sell
      // BIZ-013: Cloud-synced packs may have opening_serial=null but serial_start set
      // SEC-014: No silent fallback to '000' - throw on missing serial data
      const effectiveStartingSerial =
        packDetails.prev_ending_serial || packDetails.opening_serial || packDetails.serial_start;

      if (!effectiveStartingSerial) {
        log.error('Pack missing starting serial data - data integrity issue', {
          pack_id,
          prev_ending_serial: packDetails.prev_ending_serial,
          opening_serial: packDetails.opening_serial,
          serial_start: packDetails.serial_start,
          storeId,
        });
        return createErrorResponse(
          IPCErrorCodes.INTERNAL_ERROR,
          'Pack is missing starting serial data. This indicates a data integrity issue. Please contact support.'
        );
      }

      if (!packDetails.game_price) {
        return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Game has no price');
      }

      const startingNum = parseInt(effectiveStartingSerial, 10);
      const closingNum = parseInt(closing_serial, 10);

      if (Number.isNaN(startingNum) || Number.isNaN(closingNum)) {
        return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, 'Invalid serial number format');
      }

      // CRITICAL: Use depletion formula (closingNum + 1) for sold out packs
      // closing_serial is the LAST ticket index, not the next position
      const ticketsSold = closingNum + 1 - startingNum;
      const salesAmount = ticketsSold * packDetails.game_price;

      if (ticketsSold < 0) {
        return createErrorResponse(
          IPCErrorCodes.VALIDATION_ERROR,
          'Closing serial cannot be less than starting serial'
        );
      }

      // Look up game to get game_code for sync payload (read-only, outside transaction)
      const game = lotteryGamesDAL.findById(packDetails.game_id);
      if (!game) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Game not found for pack');
      }

      // SYNC-5000 Phase 2: Atomic business-write + enqueue via transactional outbox
      // MQ-001: Idempotency key prevents duplicate queue entries
      // SEC-006: All queries use parameterized statements within transaction
      // DB-006: TENANT_ISOLATION - store_id included in sync payload
      const {
        result: pack,
        syncItem,
        deduplicated,
      } = transactionalOutbox.withSyncEnqueue(
        // Business operation: settle the pack
        () =>
          lotteryPacksDAL.settle(pack_id, {
            store_id: storeId,
            closing_serial,
            tickets_sold_count: ticketsSold,
            sales_amount: salesAmount,
            depleted_by,
            depleted_shift_id,
            depletion_reason: 'MANUAL_SOLD_OUT',
          }),
        // Sync data builder - builds sync payload from business operation result
        (settledPack) => ({
          store_id: storeId,
          entity_type: 'pack',
          entity_id: settledPack.pack_id,
          operation: 'UPDATE' as const,
          payload: buildPackSyncPayload(settledPack, game.game_code, game.tickets_per_pack, null, {
            depleted_shift_id,
            depleted_by,
            depletion_reason: 'MANUAL_SOLD_OUT',
          }),
          idempotency_key: generateIdempotencyKey({
            entity_type: 'pack',
            entity_id: settledPack.pack_id,
            operation: 'UPDATE',
            discriminator: 'deplete:MANUAL_SOLD_OUT',
          }),
        })
      );

      log.info('Pack depleted', {
        packId: pack.pack_id,
        storeId,
        closingSerial: closing_serial,
        ticketsSold,
        salesAmount,
        depletedBy: depleted_by,
        shiftId: depleted_shift_id,
        depletionReason: 'MANUAL_SOLD_OUT',
        syncQueued: !!syncItem,
        deduplicated,
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
 * v019 Schema Alignment: Now includes shift tracking
 * - Captures returned_shift_id and returned_by
 * - Sends to cloud API for audit trail
 *
 * @security API-001: Input validation with Zod schemas
 * @security API-003: Sanitized error responses
 * @security SEC-010: AUTHZ - Get returned_by from session, not frontend
 * @security DB-006: Store-scoped operations via DAL
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
      // Extract validated input including return reason fields
      const { pack_id, closing_serial, return_reason, return_notes } = parseResult.data;
      const storeId = getStoreId();

      // SEC-010: AUTHZ - Get returned_by from authenticated session
      const currentUser = getCurrentUser();
      const returned_by = currentUser?.user_id || null;

      // Get current shift context for audit trail (v019 schema alignment)
      const openShift = shiftsDAL.getOpenShift(storeId);
      const returned_shift_id = openShift?.shift_id || null;

      // Calculate sales if closing serial provided
      let ticketsSold: number | undefined;
      let salesAmount: number | undefined;

      if (closing_serial) {
        const sales = lotteryPacksDAL.calculateSales(pack_id, closing_serial);
        ticketsSold = sales.ticketsSold;
        salesAmount = sales.salesAmount;
      }

      // Pre-fetch pack details to get game_id for sync payload (read-only, outside transaction)
      const packDetails = lotteryPacksDAL.getPackWithDetails(pack_id);
      if (!packDetails) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Pack not found');
      }

      // Look up game to get game_code for sync payload (read-only, outside transaction)
      const game = lotteryGamesDAL.findById(packDetails.game_id);
      if (!game) {
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Game not found for pack');
      }

      // SYNC-5000 Phase 2: Atomic business-write + enqueue via transactional outbox
      // MQ-001: Idempotency key prevents duplicate queue entries
      // SEC-006: All queries use parameterized statements within transaction
      // DB-006: TENANT_ISOLATION - store_id included in sync payload
      const {
        result: pack,
        syncItem,
        deduplicated,
      } = transactionalOutbox.withSyncEnqueue(
        // Business operation: return the pack
        () =>
          lotteryPacksDAL.returnPack(pack_id, {
            store_id: storeId,
            closing_serial,
            tickets_sold_count: ticketsSold,
            sales_amount: salesAmount,
            returned_by,
            returned_shift_id,
            return_reason,
            return_notes,
          }),
        // Sync data builder - builds sync payload from business operation result
        (returnedPack) => ({
          store_id: storeId,
          entity_type: 'pack',
          entity_id: returnedPack.pack_id,
          operation: 'UPDATE' as const,
          payload: buildPackSyncPayload(returnedPack, game.game_code, game.tickets_per_pack, null, {
            returned_shift_id,
            returned_by,
            return_reason,
            return_notes,
          }),
          idempotency_key: generateIdempotencyKey({
            entity_type: 'pack',
            entity_id: returnedPack.pack_id,
            operation: 'UPDATE',
            discriminator: `return:${return_reason}`,
          }),
        })
      );

      log.info('Pack returned', {
        packId: pack.pack_id,
        storeId,
        closingSerial: closing_serial,
        returnReason: return_reason,
        returnedBy: returned_by,
        shiftId: returned_shift_id,
        syncQueued: !!syncItem,
        deduplicated,
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

      // ========================================================================
      // SEC-010: AUTHZ - Function-level authorization check
      // API-SEC-005: Enforce function-level access control based on POS type
      // ========================================================================
      // Independent lottery day close is ONLY allowed for LOTTERY POS type.
      // For all other POS types (GILBARCO, VERIFONE, SQUARE, etc.), lottery
      // close must happen through the Day Close Wizard which coordinates
      // shift close, lottery close, and day summary in a single transaction.
      //
      // Business Rule: Non-lottery stores integrate lottery close into their
      // existing day close workflow rather than allowing independent closure.
      //
      // Exception: When fromWizard=true, the call is from the Day Close wizard
      // and is allowed for all POS types. This enables deferred commit pattern
      // where lottery is scanned in Step 1 and committed in Step 3.
      // ========================================================================
      const { fromWizard } = parseResult.data;
      const posType = settingsService.getPOSType();
      if (posType !== 'LOTTERY' && !fromWizard) {
        log.warn('Independent lottery day close rejected for non-lottery POS type', {
          storeId,
          posType,
          action: 'prepareDayClose',
        });
        return createErrorResponse(
          IPCErrorCodes.FORBIDDEN,
          'Independent lottery day close is not available for this POS configuration. ' +
            'Please use the Day Close wizard to close lottery as part of the regular day close process.'
        );
      }

      // Log wizard-initiated close for audit trail
      if (fromWizard && posType !== 'LOTTERY') {
        log.info('Wizard-initiated lottery day close for non-LOTTERY POS type', {
          storeId,
          posType,
          action: 'prepareDayClose',
          fromWizard: true,
        });
      }

      // SEC-010: Get opened_by from authenticated session (not frontend)
      // opened_by is REQUIRED by the cloud API - must have a valid user UUID
      const currentUser = getCurrentUser();
      if (!currentUser?.user_id) {
        log.error('Cannot prepare day close: No authenticated user');
        return createErrorResponse(
          IPCErrorCodes.NOT_AUTHENTICATED,
          'User authentication required to open a business day.'
        );
      }
      const openedBy = currentUser.user_id;

      // Business date = current calendar date
      // Close-to-close model: Multiple business days can share the same calendar date
      // (e.g., day 1 closes at 4pm, day 2 opens immediately, both have same business_date)
      // API constraint: business_date must be within 1 day of current date
      const businessDate = today;

      // Get or create a business day for today (pass user_id for opened_by in sync payload)
      // Note: getOrCreateForDate is idempotent - returns existing OPEN day if one exists for this date
      const day = lotteryBusinessDaysDAL.getOrCreateForDate(storeId, businessDate, openedBy);

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
    // BIZ-008: Cashiers can close lottery day (2026-02-12)
    // API-SEC-005: Function-level auth aligned with frontend requirement
    // SEC-010: AUTHZ - Backend enforces same role as frontend auth guard
    requiredRole: 'cashier',
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
      const { day_id, fromWizard } = parseResult.data;

      // ========================================================================
      // SEC-010: AUTHZ - Function-level authorization check
      // Consistent with prepareDayClose - independent close only for LOTTERY POS
      //
      // Exception: When fromWizard=true, the call is from the Day Close wizard
      // and is allowed for all POS types. This enables deferred commit pattern
      // where lottery is scanned in Step 1 and committed in Step 3.
      // ========================================================================
      const posType = settingsService.getPOSType();
      if (posType !== 'LOTTERY' && !fromWizard) {
        log.warn('Independent lottery day close commit rejected for non-lottery POS type', {
          dayId: day_id,
          posType,
          action: 'commitDayClose',
        });
        return createErrorResponse(
          IPCErrorCodes.FORBIDDEN,
          'Independent lottery day close is not available for this POS configuration.'
        );
      }

      // Log wizard-initiated close for audit trail
      if (fromWizard && posType !== 'LOTTERY') {
        log.info('Wizard-initiated lottery day close commit for non-LOTTERY POS type', {
          dayId: day_id,
          posType,
          action: 'commitDayClose',
          fromWizard: true,
        });
      }

      // SEC-010: Get user ID from authenticated session
      const currentUser = getCurrentUser();
      if (!currentUser) {
        return createErrorResponse(
          IPCErrorCodes.NOT_AUTHENTICATED,
          'No authenticated user session'
        );
      }
      const userId = currentUser.user_id;

      // ========================================================================
      // DB-006: Tenant isolation - validate day_id belongs to configured store
      // BEFORE performing any operations. This prevents cross-tenant attacks
      // where an attacker from Store A attempts to close a day from Store B.
      // SEC-010: Return NOT_FOUND to avoid information disclosure about
      // existence of days in other stores.
      // ========================================================================
      const storeId = getStoreId();
      const day = lotteryBusinessDaysDAL.findByIdForStore(storeId, day_id);
      if (!day) {
        log.warn('Day close commit rejected - day not found or belongs to different store', {
          dayId: day_id,
          storeId,
          action: 'commitDayClose',
        });
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Lottery day not found');
      }

      const result = lotteryBusinessDaysDAL.commitClose(day_id, userId);

      // ========================================================================
      // BIZ-007: Auto-open next day after successful close
      // This ensures a day is always available for shifts and pack operations.
      // Uses current business date (not the closed day's date) to handle
      // midnight-crossing closures correctly.
      // SEC-010: Uses authenticated user as opened_by
      // DB-006: Store already validated above
      // ========================================================================
      const today = getCurrentBusinessDate();
      const nextDay = lotteryBusinessDaysDAL.getOrCreateForDate(storeId, today, userId);

      log.info('Day close committed and next day opened', {
        closedDayId: day_id,
        closingsCount: result.closings_created,
        totalSales: result.lottery_total,
        newDayId: nextDay.day_id,
        newDayDate: nextDay.business_date,
        newDayStatus: nextDay.status,
      });

      return createSuccessResponse({
        ...result,
        next_day: {
          day_id: nextDay.day_id,
          business_date: nextDay.business_date,
          status: nextDay.status,
        },
      });
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
    // BIZ-008: Cashiers can close lottery day (2026-02-12)
    // API-SEC-005: Function-level auth aligned with frontend requirement
    // SEC-010: AUTHZ - Backend enforces same role as frontend auth guard
    requiredRole: 'cashier',
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

      // ========================================================================
      // DB-006: Tenant isolation - validate day_id belongs to configured store
      // BEFORE performing any operations. This prevents cross-tenant attacks.
      // SEC-010: Return NOT_FOUND to avoid information disclosure.
      // ========================================================================
      const storeId = getStoreId();
      const day = lotteryBusinessDaysDAL.findByIdForStore(storeId, day_id);
      if (!day) {
        log.warn('Day close cancel rejected - day not found or belongs to different store', {
          dayId: day_id,
          storeId,
          action: 'cancelDayClose',
        });
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Lottery day not found');
      }

      lotteryBusinessDaysDAL.cancelClose(day_id);

      log.info('Day close cancelled', { dayId: day_id, storeId });

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
    // BIZ-008: Cashiers can cancel their own day close (2026-02-12)
    // API-SEC-005: Function-level auth aligned with frontend requirement
    // SEC-010: AUTHZ - Backend enforces same role as frontend auth guard
    requiredRole: 'cashier',
    description: 'Cancel pending lottery day close',
  }
);

/**
 * Re-queue day close for sync
 * Channel: lottery:requeueDayCloseSync
 *
 * Used for recovery when sync failed or was deleted from queue
 *
 * @security API-001: Input validation with Zod schemas
 * @security API-003: Sanitized error responses
 */
registerHandler(
  'lottery:requeueDayCloseSync',
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

      // SEC-004: Verify API key is configured (enterprise security requirement)
      if (!settingsService.hasApiKey()) {
        return createErrorResponse(
          IPCErrorCodes.NOT_CONFIGURED,
          'API key not configured. Please configure your store sync key.'
        );
      }

      // Get user ID from authenticated session, or use 'system' for recovery operations
      const currentUser = getCurrentUser();
      const userId = currentUser?.user_id || 'system';

      const success = lotteryBusinessDaysDAL.requeueDayCloseForSync(day_id, userId);

      log.info('Day close re-queued for sync', { dayId: day_id, userId });

      return createSuccessResponse({ requeued: success });
    } catch (error) {
      // API-003: Log full error server-side, return generic message
      log.error('Failed to re-queue day close for sync', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to re-queue day close for sync.'
      );
    }
  },
  {
    requiresAuth: false, // No user auth required - API key validation done in handler
    description: 'Re-queue closed day for sync',
  }
);

/**
 * Re-queue day open for sync
 * Channel: lottery:requeueDayOpenSync
 *
 * Used for recovery when sync failed or was deleted from queue.
 * Creates a new sync queue item with the current day data.
 *
 * @security API-001: Input validation with Zod schemas
 * @security API-003: Sanitized error responses
 * @security SEC-010: User ID from authenticated session
 */
registerHandler(
  'lottery:requeueDayOpenSync',
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

      // SEC-004: Verify API key is configured (enterprise security requirement)
      if (!settingsService.hasApiKey()) {
        return createErrorResponse(
          IPCErrorCodes.NOT_CONFIGURED,
          'API key not configured. Please configure your store sync key.'
        );
      }

      // SEC-010: Get user ID from authenticated session
      const currentUser = getCurrentUser();
      const userId = currentUser?.user_id;

      // For day_open requeue, we need a valid user ID (UUID format)
      // If no user is logged in, we'll pass undefined and the DAL will handle it
      const success = lotteryBusinessDaysDAL.requeueDayOpenForSync(day_id, userId || '');

      log.info('Day open re-queued for sync', { dayId: day_id, userId: userId || 'N/A' });

      return createSuccessResponse({ requeued: success });
    } catch (error) {
      // API-003: Log full error server-side, return generic message
      log.error('Failed to re-queue day open for sync', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to re-queue day open for sync.'
      );
    }
  },
  {
    requiresAuth: false, // No user auth required - API key validation done in handler
    description: 'Re-queue day open for sync',
  }
);

/**
 * List all business days for a store
 * Channel: lottery:listBusinessDays
 *
 * Used for debugging and data inspection
 *
 * @security SEC-006: Uses store from configured session
 * @security API-003: Sanitized error responses
 */
registerHandler(
  'lottery:listBusinessDays',
  async () => {
    try {
      const storeId = getStoreId();
      const days = lotteryBusinessDaysDAL.listAllDays(storeId);

      log.info('Listed all business days', { storeId, count: days.length });

      return createSuccessResponse({ days });
    } catch (error) {
      log.error('Failed to list business days', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to list business days.'
      );
    }
  },
  {
    requiresAuth: false,
    description: 'List all business days for debugging',
  }
);

/**
 * Delete a business day (data cleanup)
 * Channel: lottery:deleteBusinessDay
 *
 * DANGER: Destructive operation for fixing data corruption
 *
 * @security SEC-006: Uses store from configured session
 * @security API-003: Sanitized error responses
 */
registerHandler(
  'lottery:deleteBusinessDay',
  async (_event, input: unknown) => {
    const parseResult = z.object({ day_id: UUIDSchema }).safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      const { day_id } = parseResult.data;
      const result = lotteryBusinessDaysDAL.deleteBusinessDay(day_id);

      log.warn('Business day deleted via IPC', { dayId: day_id, ...result });

      return createSuccessResponse(result);
    } catch (error) {
      log.error('Failed to delete business day', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to delete business day.'
      );
    }
  },
  {
    requiresAuth: false,
    description: 'Delete business day for data cleanup',
  }
);

/**
 * Reopen a closed business day
 * Channel: lottery:reopenBusinessDay
 *
 * Used for testing and data recovery
 *
 * @security SEC-006: Uses store from configured session
 * @security API-003: Sanitized error responses
 */
registerHandler(
  'lottery:reopenBusinessDay',
  async (_event, input: unknown) => {
    const parseResult = z.object({ day_id: UUIDSchema }).safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    try {
      const { day_id } = parseResult.data;
      const day = lotteryBusinessDaysDAL.reopenDay(day_id);

      log.warn('Business day reopened via IPC', {
        dayId: day_id,
        businessDate: day.business_date,
      });

      return createSuccessResponse({ day });
    } catch (error) {
      log.error('Failed to reopen business day', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to reopen business day.'
      );
    }
  },
  {
    requiresAuth: false,
    description: 'Reopen closed business day for testing',
  }
);

/**
 * Cleanup stale business days (data maintenance)
 * Channel: lottery:cleanupStaleDays
 *
 * Deletes all business days except the most recent CLOSED one
 * Used to fix data corruption from bugs
 *
 * @security SEC-006: Uses store from configured session
 */
registerHandler(
  'lottery:cleanupStaleDays',
  async () => {
    try {
      const storeId = getStoreId();
      const days = lotteryBusinessDaysDAL.listAllDays(storeId);

      // Find the most recent CLOSED day to keep
      const closedDays = days.filter((d) => d.status === 'CLOSED');
      const keepDayId = closedDays.length > 0 ? closedDays[0].day_id : null;

      // Delete all other days
      const deleted: string[] = [];
      for (const day of days) {
        if (day.day_id !== keepDayId) {
          lotteryBusinessDaysDAL.deleteBusinessDay(day.day_id);
          deleted.push(`${day.business_date} (${day.status})`);
        }
      }

      log.warn('Stale business days cleaned up', {
        storeId,
        deletedCount: deleted.length,
        deleted,
        kept: keepDayId ? closedDays[0].business_date : 'none',
      });

      return createSuccessResponse({
        deleted,
        kept: keepDayId ? closedDays[0].business_date : null,
      });
    } catch (error) {
      log.error('Failed to cleanup stale days', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to cleanup stale days.'
      );
    }
  },
  {
    requiresAuth: false,
    description: 'Cleanup stale business days',
  }
);

/**
 * Delete ALL business days (complete reset)
 * Channel: lottery:deleteAllBusinessDays
 *
 * DANGER: Deletes ALL business days for the store - use for complete reset only
 * Also deletes associated day_open sync queue items
 *
 * @security SEC-006: Uses store from configured session
 * @security DB-006: Scoped to store_id
 */
registerHandler(
  'lottery:deleteAllBusinessDays',
  async () => {
    try {
      const storeId = getStoreId();
      const days = lotteryBusinessDaysDAL.listAllDays(storeId);

      if (days.length === 0) {
        return createSuccessResponse({
          deleted: [],
          syncQueueDeleted: 0,
          message: 'No business days to delete',
        });
      }

      // Delete all business days
      const deleted: string[] = [];
      for (const day of days) {
        lotteryBusinessDaysDAL.deleteBusinessDay(day.day_id);
        deleted.push(`${day.business_date} (${day.status})`);
      }

      // Also delete any pending day_open sync queue items for this store
      const syncQueueDeleted = syncQueueDAL.deleteByEntityType(storeId, 'day_open');

      log.warn('ALL business days deleted (complete reset)', {
        storeId,
        deletedCount: deleted.length,
        deleted,
        syncQueueDeleted,
      });

      return createSuccessResponse({
        deleted,
        syncQueueDeleted,
        message: `Deleted ${deleted.length} business days and ${syncQueueDeleted} sync queue items`,
      });
    } catch (error) {
      log.error('Failed to delete all business days', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to delete all business days.'
      );
    }
  },
  {
    requiresAuth: false,
    description: 'Delete ALL business days (complete reset)',
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
            game_id: validatedGame.game_id,
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
              status: localGame.status,
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
              status: localGame.status,
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

        if (pack.status !== 'ACTIVE') {
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

        if (pack.status !== 'ACTIVE') {
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

// ============================================================================
// Business Day Initialization Handlers
// ============================================================================

/**
 * Get current business day status without creating one
 * Channel: lottery:getDayStatus
 *
 * Returns the current day status to determine if initialization is needed.
 * Unlike getDayBins, this does NOT auto-create a day.
 *
 * @security SEC-006: Store-scoped query
 * @security API-003: Sanitized error responses
 */
registerHandler(
  'lottery:getDayStatus',
  async () => {
    try {
      const storeId = getStoreId();
      const today = getCurrentBusinessDate();

      // Check if an OPEN day exists (without creating one)
      const openDay = lotteryBusinessDaysDAL.findOpenDay(storeId);

      // Check prerequisites for initialization
      const bins = lotteryBinsDAL.findActiveByStore(storeId);
      const games = lotteryGamesDAL.findActiveByStore(storeId);

      const prerequisites = {
        has_bins: bins.length > 0,
        has_games: games.length > 0,
        bins_count: bins.length,
        games_count: games.length,
      };

      if (openDay) {
        return createSuccessResponse({
          has_open_day: true,
          day: {
            day_id: openDay.day_id,
            business_date: openDay.business_date,
            status: openDay.status,
            opened_at: openDay.opened_at,
            opened_by: openDay.opened_by,
          },
          today: today,
          prerequisites,
          needs_initialization: false,
          is_first_ever: false, // Has open day, so definitely not first ever
        });
      }

      // No OPEN day exists - check if ANY day has ever existed
      // SEC-006: Uses parameterized EXISTS query
      // DB-006: Store-scoped query
      // Performance: O(1) indexed lookup, stops at first match
      const hasHistory = lotteryBusinessDaysDAL.hasAnyDay(storeId);

      // is_first_ever determines UI behavior:
      // - true: Show initialization screen (store has never had a lottery day)
      // - false: Auto-initialize (store has history, just needs new day after close)
      const isFirstEver = !hasHistory;

      return createSuccessResponse({
        has_open_day: false,
        day: null,
        today: today,
        prerequisites,
        needs_initialization: true,
        is_first_ever: isFirstEver,
      });
    } catch (error) {
      log.error('Failed to get day status', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to get day status.'
      );
    }
  },
  {
    requiresAuth: false,
    description: 'Get current business day status without creating',
  }
);

/**
 * Initialize business day explicitly
 * Channel: lottery:initializeBusinessDay
 *
 * Creates a new OPEN business day for the store. This is the explicit action
 * that starts the store's business day, replacing implicit auto-creation.
 *
 * Prerequisites:
 * - Store must be configured and active
 * - At least one bin must exist
 * - At least one game must exist
 * - No day can be in PENDING_CLOSE status
 * - User must be authenticated (for opened_by audit trail)
 *
 * @security SEC-006: Store-scoped operations
 * @security SEC-010: Requires authenticated user for audit trail
 * @security SEC-017: Audit logging for initialization
 * @security API-003: Sanitized error responses
 */
registerHandler(
  'lottery:initializeBusinessDay',
  async () => {
    try {
      const storeId = getStoreId();
      const today = getCurrentBusinessDate();

      // SEC-010: Get user from authenticated session (REQUIRED for audit trail)
      const currentUser = getCurrentUser();
      if (!currentUser?.user_id) {
        return createErrorResponse(
          IPCErrorCodes.FORBIDDEN,
          'Authentication required to initialize business day.'
        );
      }
      const userId = currentUser.user_id;

      // ========================================================================
      // BIZ-010: First-Ever Day Detection (for Lottery Onboarding)
      // ========================================================================
      // CRITICAL: Check BEFORE creating the new day to correctly detect first-ever state
      // After creation, isFirstEverDay would return false even for the actual first day
      const isFirstEver = lotteryBusinessDaysDAL.isFirstEverDay(storeId);

      // Check if already initialized (idempotent)
      const existingOpenDay = lotteryBusinessDaysDAL.findOpenDay(storeId);
      if (existingOpenDay) {
        log.info('Business day already initialized', {
          dayId: existingOpenDay.day_id,
          businessDate: existingOpenDay.business_date,
          storeId,
          isOnboarding: existingOpenDay.is_onboarding, // BIZ-012-FIX: Log onboarding state
        });
        return createSuccessResponse({
          success: true,
          is_new: false,
          is_first_ever: false, // Existing day means not first-ever
          is_onboarding: existingOpenDay.is_onboarding, // BIZ-012-FIX: Persisted onboarding state
          day: {
            day_id: existingOpenDay.day_id,
            business_date: existingOpenDay.business_date,
            status: existingOpenDay.status,
            opened_at: existingOpenDay.opened_at,
            opened_by: existingOpenDay.opened_by,
            is_onboarding: existingOpenDay.is_onboarding, // BIZ-012-FIX: Include in day object
          },
          message: 'Business day already open.',
        });
      }

      // Check prerequisites
      const bins = lotteryBinsDAL.findActiveByStore(storeId);
      if (bins.length === 0) {
        return createErrorResponse(
          IPCErrorCodes.VALIDATION_ERROR,
          'Cannot initialize business day: No lottery bins configured. Please sync bins from cloud first.'
        );
      }

      const games = lotteryGamesDAL.findActiveByStore(storeId);
      if (games.length === 0) {
        return createErrorResponse(
          IPCErrorCodes.VALIDATION_ERROR,
          'Cannot initialize business day: No lottery games configured. Please sync games from cloud first.'
        );
      }

      // Check for pending close (must be committed or cancelled first)
      const pendingDays = lotteryBusinessDaysDAL.findByStatus(storeId, 'PENDING_CLOSE');
      if (pendingDays.length > 0) {
        return createErrorResponse(
          IPCErrorCodes.VALIDATION_ERROR,
          'Cannot initialize new day: A previous day close is pending. Please commit or cancel the pending close first.'
        );
      }

      // Create the business day using existing DAL method
      // This will also queue the day_open sync item
      const newDay = lotteryBusinessDaysDAL.getOrCreateForDate(storeId, today, userId);

      // ========================================================================
      // BIZ-012-FIX: Persist onboarding state in database
      // ========================================================================
      // When is_first_ever is true, set is_onboarding = 1 on the newly created day.
      // This persists the onboarding state so it survives navigation/page reload.
      // SEC-006: Uses parameterized UPDATE via DAL method
      // DB-006: DAL method validates store_id ownership
      // ========================================================================
      if (isFirstEver) {
        const onboardingSet = lotteryBusinessDaysDAL.setOnboardingFlag(
          storeId,
          newDay.day_id,
          true
        );
        if (!onboardingSet) {
          log.error('Failed to set onboarding flag on first-ever day', {
            dayId: newDay.day_id,
            storeId,
          });
          // Non-blocking: onboarding flag is a UX enhancement, not critical path
        } else {
          log.info('Onboarding mode activated for first-ever day', {
            dayId: newDay.day_id,
            storeId,
          });
        }
      }

      // SEC-017: Audit logging
      log.info('Business day initialized', {
        dayId: newDay.day_id,
        businessDate: newDay.business_date,
        storeId,
        initializedBy: userId,
        binsAvailable: bins.length,
        gamesAvailable: games.length,
        isFirstEver, // BIZ-010: Log for debugging onboarding scenarios
        isOnboarding: isFirstEver, // BIZ-012-FIX: Log onboarding state
      });

      return createSuccessResponse({
        success: true,
        is_new: true,
        is_first_ever: isFirstEver, // BIZ-010: Enables onboarding mode when true
        is_onboarding: isFirstEver, // BIZ-012-FIX: Persisted onboarding state
        day: {
          day_id: newDay.day_id,
          business_date: newDay.business_date,
          status: newDay.status,
          opened_at: newDay.opened_at,
          opened_by: newDay.opened_by,
          is_onboarding: isFirstEver, // BIZ-012-FIX: Include in day object
        },
        message: 'Business day initialized successfully.',
      });
    } catch (error) {
      log.error('Failed to initialize business day', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to initialize business day.'
      );
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'cashier', // Any authenticated employee can initialize the day
    description: 'Initialize business day explicitly',
  }
);

// ============================================================================
// BIZ-012-FIX: Onboarding Status Handlers
// ============================================================================

/**
 * Get onboarding status
 * Channel: lottery:getOnboardingStatus
 *
 * Returns the current onboarding state for the store.
 * Used by frontend to restore onboarding mode on page load.
 *
 * @security SEC-006: Store-scoped query via DAL
 * @security DB-006: Tenant isolation via store_id
 * @security API-003: Sanitized error responses
 */
registerHandler(
  'lottery:getOnboardingStatus',
  async () => {
    try {
      const storeId = getStoreId();

      // DB-006: Store-scoped query via DAL
      // SEC-006: Parameterized query in findOnboardingDay
      const onboardingDay = lotteryBusinessDaysDAL.findOnboardingDay(storeId);

      log.debug('Onboarding status queried', {
        storeId,
        isOnboarding: onboardingDay !== null,
        dayId: onboardingDay?.day_id || null,
      });

      return createSuccessResponse({
        is_onboarding: onboardingDay !== null,
        day_id: onboardingDay?.day_id || null,
        // Include additional context for frontend
        business_date: onboardingDay?.business_date || null,
        opened_at: onboardingDay?.opened_at || null,
      });
    } catch (error) {
      log.error('Failed to get onboarding status', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to get onboarding status.'
      );
    }
  },
  {
    requiresAuth: false, // Allow checking status without auth for page load
    description: 'Get current onboarding status for the store',
  }
);

/**
 * Complete Onboarding Schema
 * API-001: Input validation with Zod schema
 * SEC-014: UUID format validation prevents injection
 */
const CompleteOnboardingSchema = z.object({
  day_id: UUIDSchema,
});

/**
 * Complete onboarding
 * Channel: lottery:completeOnboarding
 *
 * Explicitly ends onboarding mode for the store.
 * Sets is_onboarding = 0 on the specified day record.
 *
 * @security SEC-006: Parameterized UPDATE via DAL
 * @security DB-006: Validates day belongs to store before update
 * @security SEC-010: Requires authenticated user
 * @security API-001: Zod validation rejects invalid day_id
 */
registerHandler(
  'lottery:completeOnboarding',
  async (_event, input: unknown) => {
    // API-001: Validate input
    const parseResult = CompleteOnboardingSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((e: { message: string }) => e.message)
        .join(', ');
      log.warn('completeOnboarding validation failed', { errorMessage });
      return createErrorResponse(IPCErrorCodes.VALIDATION_ERROR, errorMessage);
    }

    const { day_id } = parseResult.data;

    try {
      const storeId = getStoreId();

      // SEC-010: Get user from authenticated session for audit trail
      const currentUser = getCurrentUser();
      if (!currentUser?.user_id) {
        return createErrorResponse(
          IPCErrorCodes.FORBIDDEN,
          'Authentication required to complete onboarding.'
        );
      }

      // DB-006: Verify day belongs to this store before update
      // SEC-006: Parameterized query in findById
      const day = lotteryBusinessDaysDAL.findById(day_id);
      if (!day) {
        log.warn('completeOnboarding: Day not found', { dayId: day_id, storeId });
        return createErrorResponse(IPCErrorCodes.NOT_FOUND, 'Business day not found.');
      }

      // DB-006: Tenant isolation - verify store ownership
      if (day.store_id !== storeId) {
        log.warn('completeOnboarding: Cross-store access attempted', {
          dayId: day_id,
          dayStoreId: day.store_id,
          requestStoreId: storeId,
          userId: currentUser.user_id,
        });
        return createErrorResponse(
          IPCErrorCodes.FORBIDDEN,
          'Access denied: Day does not belong to this store.'
        );
      }

      // Validate day is currently in onboarding mode
      if (!day.is_onboarding) {
        log.info('completeOnboarding: Day is not in onboarding mode', {
          dayId: day_id,
          storeId,
        });
        return createSuccessResponse({
          success: true,
          day_id,
          message: 'Onboarding already completed.',
          was_already_complete: true,
        });
      }

      // SEC-006: Parameterized UPDATE via DAL method
      // DB-006: DAL validates store_id ownership
      const updated = lotteryBusinessDaysDAL.setOnboardingFlag(storeId, day_id, false);

      if (!updated) {
        log.error('completeOnboarding: Failed to update onboarding flag', {
          dayId: day_id,
          storeId,
        });
        return createErrorResponse(
          IPCErrorCodes.INTERNAL_ERROR,
          'Failed to complete onboarding. Please try again.'
        );
      }

      // SEC-017: Audit logging
      log.info('Onboarding completed', {
        dayId: day_id,
        storeId,
        completedBy: currentUser.user_id,
        businessDate: day.business_date,
      });

      return createSuccessResponse({
        success: true,
        day_id,
        message: 'Onboarding completed successfully.',
        was_already_complete: false,
      });
    } catch (error) {
      log.error('Failed to complete onboarding', {
        error: error instanceof Error ? error.message : 'Unknown error',
        dayId: day_id,
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to complete onboarding.'
      );
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'cashier', // Any authenticated employee can complete onboarding
    description: 'Complete onboarding mode for the store',
  }
);

// ============================================================================
// BIZ-012-SYNC-FIX: Re-queue Onboarding Packs with Correct Serial Start
// ============================================================================
// This handler re-queues all packs that were activated during onboarding
// with the correct serial_start (their opening_serial instead of '000').
// This is a one-time remediation for packs that were synced incorrectly.
// ============================================================================

/**
 * Re-queue onboarding packs with correct serial_start
 *
 * @security SEC-010: Requires store_manager role (administrative operation)
 * @security DB-006: Store-scoped via getConfiguredStore()
 * @security SEC-006: Parameterized queries via DAL
 */
registerHandler(
  'lottery:reQueueOnboardingPacks',
  async () => {
    log.info('Re-queueing onboarding packs with correct serial_start (BIZ-012-SYNC-FIX)');

    try {
      const storeId = getStoreId();
      const currentUser = getCurrentUser();

      // Find all packs with non-zero opening_serial (onboarding packs)
      // SEC-006: Parameterized query via DAL getDatabase()
      // DB-006: Store-scoped via WHERE store_id = ?
      const db = lotteryPacksDAL['db']; // Access internal db for custom query
      const query = `
        SELECT
          p.pack_id,
          p.store_id,
          p.game_id,
          p.pack_number,
          p.opening_serial,
          p.closing_serial,
          p.status,
          p.current_bin_id,
          p.tickets_sold_count,
          p.sales_amount,
          p.received_at,
          p.received_by,
          p.activated_at,
          p.activated_by,
          p.depleted_at,
          p.returned_at,
          g.game_code,
          g.name as game_name,
          g.tickets_per_pack
        FROM lottery_packs p
        JOIN lottery_games g ON p.game_id = g.game_id
        WHERE p.store_id = ?
          AND p.status IN ('ACTIVE', 'DEPLETED')
          AND p.activated_at IS NOT NULL
          AND p.opening_serial IS NOT NULL
          AND p.opening_serial != '000'
        ORDER BY p.activated_at DESC
      `;

      const packs = db.prepare(query).all(storeId) as Array<{
        pack_id: string;
        store_id: string;
        game_id: string;
        pack_number: string;
        opening_serial: string;
        closing_serial: string | null;
        status: string;
        current_bin_id: string | null;
        tickets_sold_count: number;
        sales_amount: number;
        received_at: string | null;
        received_by: string | null;
        activated_at: string | null;
        activated_by: string | null;
        depleted_at: string | null;
        returned_at: string | null;
        game_code: string;
        game_name: string;
        tickets_per_pack: number | null;
      }>;

      log.info('Found onboarding packs to re-queue', { count: packs.length });

      if (packs.length === 0) {
        return createSuccessResponse({
          success: true,
          message: 'No onboarding packs found that need re-queuing.',
          requeued: 0,
        });
      }

      // Re-queue each pack with correct serial_start
      let requeued = 0;
      const errors: Array<{ pack_id: string; error: string }> = [];

      for (const pack of packs) {
        try {
          // Build payload with onboardingMode=true to use opening_serial as serial_start
          const payload = buildPackSyncPayload(
            {
              pack_id: pack.pack_id,
              store_id: pack.store_id,
              game_id: pack.game_id,
              pack_number: pack.pack_number,
              status: pack.status,
              current_bin_id: pack.current_bin_id,
              opening_serial: pack.opening_serial,
              closing_serial: pack.closing_serial,
              tickets_sold_count: pack.tickets_sold_count,
              sales_amount: pack.sales_amount,
              received_at: pack.received_at,
              received_by: pack.received_by,
              activated_at: pack.activated_at,
              depleted_at: pack.depleted_at,
              returned_at: pack.returned_at,
            },
            pack.game_code,
            pack.tickets_per_pack,
            pack.activated_by,
            undefined, // No shift context needed for remediation
            true // onboardingMode = true to use opening_serial as serial_start
          );

          // Enqueue for sync with correct serial_start
          // Note: Using standard enqueue (no idempotency key) for one-time remediation
          syncQueueDAL.enqueue({
            store_id: storeId,
            entity_type: 'pack',
            entity_id: pack.pack_id,
            operation: 'UPDATE',
            payload,
          });

          requeued++;
          log.info('Re-queued onboarding pack', {
            packId: pack.pack_id,
            gameCode: pack.game_code,
            packNumber: pack.pack_number,
            openingSerial: pack.opening_serial,
            serialStart: payload.serial_start,
          });
        } catch (packError) {
          const errorMsg = packError instanceof Error ? packError.message : 'Unknown error';
          errors.push({ pack_id: pack.pack_id, error: errorMsg });
          log.error('Failed to re-queue onboarding pack', {
            packId: pack.pack_id,
            error: errorMsg,
          });
        }
      }

      log.info('Onboarding pack remediation complete', {
        total: packs.length,
        requeued,
        errors: errors.length,
        triggeredBy: currentUser?.user_id,
      });

      return createSuccessResponse({
        success: true,
        message: `Re-queued ${requeued} onboarding packs with correct serial_start.`,
        requeued,
        total: packs.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      log.error('Failed to re-queue onboarding packs', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return createErrorResponse(
        IPCErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Failed to re-queue onboarding packs.'
      );
    }
  },
  {
    requiresAuth: true,
    requiredRole: 'store_manager', // Administrative operation requires manager
    description: 'Re-queue onboarding packs with correct serial_start (BIZ-012-SYNC-FIX)',
  }
);

// Log handler registration
log.info('Lottery IPC handlers registered');
