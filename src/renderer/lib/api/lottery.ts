/**
 * Lottery API client functions
 * Provides functions for interacting with the lottery API via IPC
 *
 * Story: 6.10 - Lottery Management UI
 *
 * Uses IPC client for Electron desktop app:
 * - All calls go through main process IPC handlers
 * - Type-safe communication with validation
 * - Automatic error handling
 *
 * @module renderer/lib/api/lottery
 * @security SEC-014: Uses preload's allowlisted channels
 */

import { ipcClient, IPCError } from './ipc-client';
import type { ParsedBarcode } from '../../../main/services/scanner.service';

// ============ Types ============

/**
 * Scope type for lottery games
 * - STATE: Game is visible to all stores in the state
 * - STORE: Game is visible only to a specific store
 * - GLOBAL: Legacy global game (deprecated)
 *
 * Story: State-Scoped Lottery Games Phase
 */
export type GameScopeType = 'STATE' | 'STORE' | 'GLOBAL';

/**
 * Lottery pack status enum
 * SEC-014: INPUT_VALIDATION - Strict enum constraint for pack status
 */
export type LotteryPackStatus = 'RECEIVED' | 'ACTIVE' | 'DEPLETED' | 'RETURNED';

/**
 * Lottery game status enum
 * Represents the lifecycle state of a lottery game
 * SEC-014: INPUT_VALIDATION - Strict enum constraint for game status
 *
 * @value ACTIVE - Game is currently available for sale
 * @value INACTIVE - Game is temporarily unavailable
 * @value DISCONTINUED - Game is permanently retired
 */
export type LotteryGameStatus = 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';

// ============ Games Listing Types ============

/**
 * Pack counts for a game
 * API-008: OUTPUT_FILTERING - Matches backend response shape
 */
export interface GamePackCounts {
  total: number;
  received: number;
  active: number;
  depleted: number;
  returned: number;
}

/**
 * Game list item with pack counts
 * API-008: OUTPUT_FILTERING - Type-safe response interface
 */
export interface GameListItem {
  game_id: string;
  game_code: string;
  name: string;
  price: number;
  pack_value: number;
  tickets_per_pack: number | null;
  status: LotteryGameStatus;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
  pack_counts: GamePackCounts;
}

/**
 * Filters for games listing
 * SEC-014: Validated constraints match backend
 */
export interface GameListFilters {
  /** Filter by game status */
  status?: LotteryGameStatus;
  /** Search by game name or code (min 2 chars) */
  search?: string;
  /**
   * When true, only returns games that have at least one pack in inventory.
   * Used by inventory views to hide catalog games with no store inventory.
   */
  inventoryOnly?: boolean;
}

/**
 * Pagination options for games listing
 * SEC-014: Bounded pagination matches backend limits
 */
export interface GameListPagination {
  /** Number of records per page (max 100) */
  limit?: number;
  /** Number of records to skip */
  offset?: number;
  /** Sort column */
  sortBy?: 'name' | 'game_code' | 'price' | 'status' | 'created_at';
  /** Sort direction */
  sortOrder?: 'ASC' | 'DESC';
}

/**
 * Combined input for games listing
 */
export interface ListGamesInput {
  filters?: GameListFilters;
  pagination?: GameListPagination;
}

/**
 * Paginated games list response
 */
export interface GameListResponse {
  games: GameListItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Lottery pack query filters
 */
export interface LotteryPackQueryFilters {
  store_id?: string;
  status?: LotteryPackStatus;
  game_id?: string;
  /** Search by game name or pack number (case-insensitive, min 2 chars) */
  search?: string;
}

/**
 * Lottery pack response from IPC
 * API-008: OUTPUT_FILTERING - Strict interface matching DAL output
 * SEC-014: INPUT_VALIDATION - Type-safe field definitions
 */
export interface LotteryPackResponse {
  pack_id: string;
  game_id: string;
  pack_number: string;
  opening_serial: string | null;
  closing_serial: string | null;
  status: LotteryPackStatus;
  store_id: string;
  bin_id: string | null;
  received_at: string; // ISO 8601
  activated_at: string | null; // ISO 8601
  depleted_at: string | null; // ISO 8601
  returned_at: string | null; // ISO 8601
  // Extended fields from joins (optional, populated by handler)
  game?: {
    game_id: string;
    game_code: string;
    name: string;
    price: number | null;
    tickets_per_pack: number;
    status?: LotteryGameStatus;
  };
  bin?: {
    bin_id: string;
    name: string;
    display_order: number;
  } | null;
  // Calculated field (optional)
  tickets_remaining?: number;
  /**
   * Server-side authorization flag for return eligibility
   * SEC-010: AUTHZ - Backend determines returnability, not frontend
   * Business Rule: ACTIVATED and RECEIVED packs can be returned
   */
  can_return?: boolean;
}

/**
 * Lottery pack detail response
 * Extended response for pack detail view
 */
export interface LotteryPackDetailResponse extends LotteryPackResponse {
  tickets_sold?: number;
  sales_amount?: number;
  /** Calculated last ticket serial: opening_serial + tickets_per_pack - 1 */
  serial_end?: string;
}

/**
 * Receive pack input for IPC
 */
export interface ReceivePackInput {
  game_id: string;
  pack_number: string;
  serialized_number: string;
}

/**
 * Receive pack response
 */
export interface ReceivePackResponse {
  pack_id: string;
  game_id: string;
  pack_number: string;
  status: 'RECEIVED';
  received_at: string;
  game: {
    game_id: string;
    game_code: string;
    name: string;
    price: number | null;
  };
}

/**
 * Activate pack input for IPC
 *
 * SEC-014: INPUT_VALIDATION - Type-safe interface matching backend Zod schema
 *
 * @property pack_id - UUID of the pack to activate
 * @property bin_id - UUID of the target bin
 * @property opening_serial - 3-digit serial number of first ticket
 * @property deplete_previous - When true (default), auto-deplete existing pack in bin
 */
export interface ActivatePackInput {
  pack_id: string;
  bin_id: string;
  opening_serial: string;
  /** Default true on backend - auto-deplete existing pack in bin with AUTO_REPLACED reason */
  deplete_previous?: boolean;
}

/**
 * Depleted pack info returned when bin collision auto-depletes existing pack
 * Matches cloud API format for SYNC-001 compatibility
 */
export interface DepletedPackInfo {
  pack_id: string;
  pack_number: string;
  game_name: string | null;
  depletion_reason: string;
}

/**
 * Activate pack response
 *
 * BIN-001: Response includes depletedPack when auto-depletion occurred
 * SYNC-001: depletedPack format matches cloud API for sync compatibility
 */
export interface ActivatePackResponse {
  pack_id: string;
  game_id: string;
  pack_number: string;
  status: 'ACTIVE';
  activated_at: string;
  bin_id: string;
  opening_serial: string;
  game: {
    game_id: string;
    name: string;
  };
  bin: {
    bin_id: string;
    name: string;
    display_order: number;
  };
  /** Populated when an existing pack was auto-depleted due to bin collision */
  depletedPack?: DepletedPackInfo | null;
}

/**
 * Deplete pack input
 */
export interface DepletePackInput {
  pack_id: string;
  closing_serial: string;
}

/**
 * Deplete pack response
 */
export interface DepletePackResponse {
  pack_id: string;
  pack_number: string;
  status: 'DEPLETED';
  depleted_at: string;
  closing_serial: string;
  tickets_sold: number;
  sales_amount: number;
}

/**
 * Return pack input
 * SEC-014: INPUT_VALIDATION - All fields validated by backend Zod schema
 */
export interface ReturnPackInput {
  pack_id: string;
  return_reason: string;
  /** 3-digit serial of last ticket sold before return */
  closing_serial?: string;
  notes?: string;
}

/**
 * Return pack response
 */
export interface ReturnPackResponse {
  pack_id: string;
  pack_number: string;
  status: 'RETURNED';
  returned_at: string;
  return_reason: string;
}

/**
 * Update pack input
 */
export interface UpdatePackInput {
  pack_number?: string;
  opening_serial?: string;
  closing_serial?: string;
  status?: LotteryPackStatus;
  bin_id?: string | null;
}

/**
 * Full activate pack input (with bin assignment)
 *
 * SEC-014: INPUT_VALIDATION - Type-safe interface matching backend ActivatePackSchema
 * API-001: VALIDATION - All fields validated by Zod on backend
 * BIZ-012-FIX: Supports onboarding mode where pack is created during activation
 *
 * @property pack_id - UUID of pack to activate (optional in onboarding mode)
 * @property bin_id - UUID of the target bin (required)
 * @property opening_serial - 3-digit serial number of first ticket (required)
 * @property shift_id - Optional shift UUID for audit trail
 * @property deplete_previous - When true (default), auto-deplete existing pack in bin
 *                              with reason AUTO_REPLACED for cloud sync compatibility
 * @property onboarding_mode - When true, creates pack in inventory AND activates it
 * @property game_id - UUID of game (required when onboarding_mode is true)
 * @property pack_number - 7-digit pack number (required when onboarding_mode is true)
 */
export interface FullActivatePackInput {
  /**
   * Pack UUID - optional in onboarding mode (will be generated by backend)
   * SEC-014: UUID format validated by backend
   */
  pack_id?: string;
  /** Target bin UUID (required) */
  bin_id: string;
  /** 3-digit serial number of first ticket to sell (required) */
  opening_serial: string;
  /** Shift UUID for audit trail (optional) */
  shift_id?: string;
  /** Default true on backend - auto-deplete existing pack in bin with AUTO_REPLACED reason */
  deplete_previous?: boolean;
  /**
   * BIZ-012-FIX: Onboarding mode flag
   * When true: Creates pack in inventory AND activates in single operation
   * When false (default): Requires pack to already exist in inventory
   */
  onboarding_mode?: boolean;
  /**
   * Game UUID - required when onboarding_mode is true
   * SEC-014: UUID format validated by backend
   */
  game_id?: string;
  /**
   * 7-digit pack number from barcode - required when onboarding_mode is true
   * SEC-014: Format validated as /^\d{7}$/ by backend
   */
  pack_number?: string;
}

/**
 * Update game input
 */
export interface UpdateGameInput {
  name?: string;
  price?: number;
  tickets_per_pack?: number;
  pack_value?: number;
  status?: LotteryGameStatus;
}

/**
 * Create game input
 */
export interface CreateGameInput {
  game_code: string;
  name: string;
  price: number;
  pack_value: number;
  store_id: string;
}

/**
 * Receive pack batch input
 */
export interface ReceivePackBatchInput {
  serialized_numbers: string[];
  store_id: string;
}

/**
 * Receive pack batch response
 */
export interface ReceivePackBatchResponse {
  created: ReceivePackResponse[];
  duplicates: { pack_number: string; status: string }[];
  errors: { serial: string; error: string }[];
}

/**
 * Lottery config value item
 */
export interface LotteryConfigValueItem {
  config_value_id: string;
  amount: number;
}

/**
 * Mark pack as sold out input
 *
 * SEC-014: INPUT_VALIDATION - closing_serial is REQUIRED, not optional
 * The closing_serial must be the pack's serial_end (last ticket index)
 * Hardcoding defaults like '299' is a security/correctness violation
 */
export interface MarkPackAsSoldOutInput {
  /** Required: The pack's serial_end (last ticket index, e.g., "029" for 30-ticket pack) */
  closing_serial: string;
}

/**
 * Variance query filters
 */
export interface VarianceQueryFilters {
  store_id?: string;
  shift_id?: string;
  pack_id?: string;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
}

/**
 * Variance response
 */
export interface VarianceResponse {
  variance_id: string;
  pack_id: string;
  shift_id: string;
  expected_serial: string;
  actual_serial: string;
  variance_amount: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approved_by?: string;
  approved_at?: string;
  notes?: string;
  created_at: string;
}

/**
 * Approve variance input
 */
export interface ApproveVarianceInput {
  approved: boolean;
  approved_by: string;
  notes?: string;
}

/**
 * Close lottery day input
 */
export interface CloseLotteryDayInput {
  closings: Array<{
    pack_id: string;
    closing_serial: string;
    is_sold_out?: boolean;
  }>;
  business_date?: string;
}

/**
 * Active shift response
 */
export interface ActiveShiftResponse {
  shift_id: string;
  store_id: string;
  cashier_id: string;
  started_at: string;
  status: 'OPEN' | 'CLOSED';
}

/**
 * Lottery game response from IPC
 */
export interface LotteryGameResponse {
  game_id: string;
  game_code: string;
  name: string;
  price: number | null;
  tickets_per_pack: number;
  pack_value: number | null;
  status: string;
  created_at: string;
  updated_at: string;
  /** Scope type: STATE, STORE, or GLOBAL */
  scope_type?: GameScopeType;
  /** Store UUID for STORE-scoped games */
  store_id?: string | null;
}

/**
 * Lottery bin response from IPC (cloud-aligned schema v039)
 */
export interface LotteryBinResponse {
  bin_id: string;
  store_id: string;
  name: string;
  location: string | null;
  display_order: number;
  is_active: number; // SQLite boolean: 1 = active, 0 = inactive
  created_at: string;
  updated_at: string;
  // With pack info
  pack_id?: string | null;
  pack_number?: string | null;
  game_name?: string | null;
  game_price?: number | null;
}

/**
 * API response wrapper for compatibility
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

/**
 * API error response
 */
export interface ApiError {
  success: false;
  error: string | { code: string; message: string };
  message?: string;
}

// ============ Lottery Day Types ============

/**
 * Bin with pack information for day-based view
 */
export interface DayBinPack {
  pack_id: string;
  pack_number: string;
  game_name: string;
  game_price: number;
  starting_serial: string;
  ending_serial: string | null;
  serial_end: string;
  is_first_period: boolean;
}

export interface DayBin {
  bin_id: string;
  bin_number: number;
  name: string;
  is_active: boolean;
  pack: DayBinPack | null;
}

/**
 * Business day information
 */
export interface BusinessDay {
  date: string;
  day_id: string | null;
  status: 'OPEN' | 'PENDING_CLOSE' | 'CLOSED' | null;
  first_shift_opened_at: string | null;
  last_shift_closed_at: string | null;
  shifts_count: number;
}

/**
 * Open business period information
 */
export interface OpenBusinessPeriod {
  started_at: string | null;
  last_closed_date: string | null;
  days_since_last_close: number | null;
  is_first_period: boolean;
}

/**
 * Depleted pack for the current open business period
 * Includes sales fields for reconciliation display
 */
export interface DepletedPackDay {
  pack_id: string;
  pack_number: string;
  game_name: string;
  game_price: number;
  bin_number: number;
  activated_at: string;
  depleted_at: string;
  /** Closing serial (last ticket sold) */
  closing_serial: string | null;
  /** Total tickets sold for reconciliation */
  tickets_sold_count: number;
  /** Total sales amount for reconciliation */
  sales_amount: number;
}

/**
 * Activated pack for the current open business period
 */
export interface ActivatedPackDay {
  pack_id: string;
  pack_number: string;
  game_name: string;
  game_price: number;
  bin_number: number;
  activated_at: string;
  status: 'ACTIVE' | 'DEPLETED' | 'RETURNED';
}

/**
 * Returned pack information
 * Sales fields are always numbers (0 if no sales) for reconciliation
 */
export interface ReturnedPackDay {
  pack_id: string;
  pack_number: string;
  game_name: string;
  game_price: number;
  bin_number: number;
  activated_at: string;
  returned_at: string;
  return_reason: string | null;
  return_notes: string | null;
  last_sold_serial: string | null;
  /** Total tickets sold before return - always a number (0 if none) */
  tickets_sold_on_return: number;
  /** Total sales amount before return - always a number (0 if none) */
  return_sales_amount: number;
  returned_by_name: string | null;
}

/**
 * Day close summary bin data
 */
export interface DayCloseSummaryBin {
  bin_number: number;
  pack_number: string;
  game_name: string;
  game_price: number;
  starting_serial: string;
  ending_serial: string;
  tickets_sold: number;
  sales_amount: number;
}

/**
 * Day close summary
 */
export interface DayCloseSummary {
  lottery_total: number;
  closings_count: number;
  closed_at: string | null;
  bins_closed: DayCloseSummaryBin[];
}

/**
 * Day bins response
 */
export interface DayBinsResponse {
  bins: DayBin[];
  business_day: BusinessDay;
  open_business_period: OpenBusinessPeriod;
  depleted_packs: DepletedPackDay[];
  activated_packs: ActivatedPackDay[];
  returned_packs: ReturnedPackDay[];
  day_close_summary: DayCloseSummary | null;
  /**
   * SEC-010: Backend capability flag for independent lottery close.
   *
   * - true: Store uses LOTTERY POS type, can close lottery independently
   * - false: Store uses other POS type, lottery close is part of Day Close Wizard
   *
   * Frontend uses this to determine whether to show the "Close Day" button.
   * Backend enforces this in prepareDayClose/commitDayClose handlers.
   */
  can_close_independently: boolean;
}

// ============ Day Status & Initialization Types ============

/**
 * Day status response - returned by lottery:getDayStatus
 * Used to check if initialization is needed before showing lottery UI
 *
 * Initialization logic:
 * - needs_initialization: true, is_first_ever: true → Show init screen (first time ever)
 * - needs_initialization: true, is_first_ever: false → Auto-initialize (after day close)
 * - needs_initialization: false → Day exists, show normal UI
 */
export interface DayStatusResponse {
  has_open_day: boolean;
  day: {
    day_id: string;
    business_date: string;
    status: 'OPEN' | 'PENDING_CLOSE' | 'CLOSED';
    opened_at: string;
    opened_by: string | null;
  } | null;
  today: string;
  prerequisites: {
    has_bins: boolean;
    has_games: boolean;
    bins_count: number;
    games_count: number;
  };
  needs_initialization: boolean;
  /**
   * Indicates if this is the store's first-ever lottery day.
   * - true: No lottery days have ever existed for this store (show init screen)
   * - false: Previous days exist, but no OPEN day (auto-initialize after day close)
   */
  is_first_ever: boolean;
}

/**
 * Initialize business day response - returned by lottery:initializeBusinessDay
 *
 * @property is_new - True if this day was just created, false if already existed
 * @property is_first_ever - BIZ-010: True if this is the store's first-ever lottery day
 *   When is_first_ever is true, the frontend should enter "onboarding mode" which
 *   allows scanning existing packs with their current ticket position instead of
 *   defaulting to serial '000'.
 */
export interface InitializeBusinessDayResponse {
  success: boolean;
  /** True if this day was just created, false if already existed (idempotent) */
  is_new: boolean;
  /** BIZ-010: True if this is the store's first-ever lottery day (enables onboarding mode) */
  is_first_ever: boolean;
  day: {
    day_id: string;
    business_date: string;
    status: 'OPEN';
    opened_at: string;
    opened_by: string | null;
  };
  message: string;
}

// ============ Two-Phase Day Close Types ============

/**
 * Prepare day close input
 */
export interface PrepareLotteryDayCloseInput {
  closings: Array<{
    pack_id: string;
    closing_serial: string;
    is_sold_out?: boolean;
  }>;
  /**
   * When true, bypasses POS type restriction for wizard-initiated close.
   * SEC-010: Only Day Close wizard should set this flag.
   * Business Rule: Independent lottery close blocked for non-LOTTERY POS,
   * but wizard-initiated close is allowed for all POS types.
   */
  fromWizard?: boolean;
}

/**
 * Prepare day close response
 */
export interface PrepareLotteryDayCloseResponse {
  day_id: string;
  business_date: string;
  status: 'PENDING_CLOSE';
  pending_close_expires_at: string;
  closings_count: number;
  estimated_lottery_total: number;
  bins_preview: Array<{
    bin_number: number;
    pack_number: string;
    game_name: string;
    starting_serial: string;
    closing_serial: string;
    game_price: number;
    tickets_sold: number;
    sales_amount: number;
  }>;
}

/**
 * Commit day close input
 * Required: day_id from prepareClose response
 */
export interface CommitLotteryDayCloseInput {
  day_id: string;
  /**
   * When true, bypasses POS type restriction for wizard-initiated close.
   * SEC-010: Only Day Close wizard should set this flag.
   * Business Rule: Independent lottery close blocked for non-LOTTERY POS,
   * but wizard-initiated close is allowed for all POS types.
   */
  fromWizard?: boolean;
}

/**
 * Commit day close response
 */
export interface CommitLotteryDayCloseResponse {
  day_id: string;
  business_date: string;
  closed_at: string;
  closings_created: number;
  lottery_total: number;
  bins_closed: Array<{
    bin_number: number;
    pack_number: string;
    game_name: string;
    starting_serial: string;
    closing_serial: string;
    game_price: number;
    tickets_sold: number;
    sales_amount: number;
  }>;
}

/**
 * Cancel day close response
 */
export interface CancelLotteryDayCloseResponse {
  cancelled: boolean;
  message: string;
}

// ============ Helper Functions ============

/**
 * Convert IPC error to ApiResponse format for backward compatibility
 */
function handleIPCError(error: unknown): ApiResponse<never> {
  if (error instanceof IPCError) {
    return {
      success: false,
      data: undefined as never,
      error: error.message,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    data: undefined as never,
    error: message,
  };
}

/**
 * Wrap IPC result in ApiResponse format
 */
function wrapSuccess<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    data,
  };
}

// ============ Games API Functions ============

/**
 * Get all active lottery games
 * IPC: lottery:getGames
 * @returns List of active lottery games
 */
export async function getGames(): Promise<ApiResponse<LotteryGameResponse[]>> {
  try {
    const data = await ipcClient.invoke<LotteryGameResponse[]>('lottery:getGames');
    return wrapSuccess(data);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * List lottery games with pack counts and pagination
 * IPC: lottery:listGames
 *
 * Enterprise-grade games listing API:
 * - SEC-014: Type-safe filters and pagination
 * - API-008: Returns games with aggregated pack counts
 *
 * @param input - Optional filters and pagination
 * @returns Paginated games list with pack counts
 */
export async function listGames(input?: ListGamesInput): Promise<ApiResponse<GameListResponse>> {
  try {
    const data = await ipcClient.invoke<GameListResponse>('lottery:listGames', input);
    return wrapSuccess(data);
  } catch (error) {
    return handleIPCError(error);
  }
}

// ============ Bins API Functions ============

/**
 * Get lottery bins for a store
 * IPC: lottery:getBins
 * @returns List of bins with pack info
 */
export async function getBins(): Promise<ApiResponse<LotteryBinResponse[]>> {
  try {
    const data = await ipcClient.invoke<LotteryBinResponse[]>('lottery:getBins');
    return wrapSuccess(data);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Get lottery bins with day-based tracking
 * Uses the new enterprise-grade lottery:getDayBins handler that returns:
 * - Full pack details with actual opening_serial (not hardcoded)
 * - Calculated serial_end based on tickets_per_pack
 * - Business day information
 * - Recently activated, depleted, and returned packs
 *
 * IPC: lottery:getDayBins
 *
 * @param _storeId - Store UUID (for interface compatibility, handler uses session)
 * @param _date - Optional date (for interface compatibility)
 * @returns Day bins response with full pack details
 */
export async function getLotteryDayBins(
  _storeId?: string,
  _date?: string
): Promise<ApiResponse<DayBinsResponse>> {
  try {
    // Call the enterprise-grade handler that provides full pack details
    // Handler derives store_id from session, date defaults to today
    const response = await ipcClient.invoke<DayBinsResponse>('lottery:getDayBins');
    return wrapSuccess(response);
  } catch (error) {
    return handleIPCError(error);
  }
}

// ============ Day Status & Initialization API Functions ============

/**
 * Get current business day status without creating one
 * IPC: lottery:getDayStatus
 *
 * Use this to check if initialization is needed before showing the lottery UI.
 * Unlike getDayBins, this does NOT auto-create a day.
 *
 * @returns Day status with initialization requirements
 */
export async function getDayStatus(): Promise<ApiResponse<DayStatusResponse>> {
  try {
    const response = await ipcClient.invoke<DayStatusResponse>('lottery:getDayStatus');
    return wrapSuccess(response);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Initialize business day explicitly
 * IPC: lottery:initializeBusinessDay
 *
 * Creates a new OPEN business day for the store. This is the explicit action
 * that starts the store's business day, replacing implicit auto-creation.
 *
 * Prerequisites (checked by handler):
 * - At least one bin must exist
 * - At least one game must exist
 * - No day can be in PENDING_CLOSE status
 * - User must be authenticated
 *
 * @returns Initialization result with new day details
 */
export async function initializeBusinessDay(): Promise<ApiResponse<InitializeBusinessDayResponse>> {
  try {
    const response = await ipcClient.invoke<InitializeBusinessDayResponse>(
      'lottery:initializeBusinessDay'
    );
    return wrapSuccess(response);
  } catch (error) {
    return handleIPCError(error);
  }
}

// ============ Packs API Functions ============

/**
 * Get lottery packs with filters
 * IPC: lottery:getPacks
 * @param filters - Query filters (store_id, status, game_id)
 * @returns Pack list response
 */
export async function getPacks(
  filters?: LotteryPackQueryFilters
): Promise<ApiResponse<LotteryPackResponse[]>> {
  try {
    const data = await ipcClient.invoke<LotteryPackResponse[]>('lottery:getPacks', filters);
    return wrapSuccess(data);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Check if a pack already exists in inventory
 * IPC: lottery:checkPackExists
 * @param storeId - Store UUID
 * @param packNumber - Pack number to check
 * @returns Response with exists flag and pack details if found
 */
export async function checkPackExists(
  storeId: string,
  packNumber: string
): Promise<ApiResponse<{ exists: boolean; pack?: LotteryPackResponse }>> {
  try {
    const result = await ipcClient.invoke<{ exists: boolean; pack?: LotteryPackResponse }>(
      'lottery:checkPackExists',
      { store_id: storeId, pack_number: packNumber }
    );
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Receive a new lottery pack via barcode scan
 * IPC: lottery:receivePack
 * @param data - Pack reception data
 * @returns Created pack response
 */
export async function receivePack(
  data: ReceivePackInput
): Promise<ApiResponse<ReceivePackResponse>> {
  try {
    const result = await ipcClient.invoke<ReceivePackResponse>('lottery:receivePack', data);
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Receive multiple lottery packs in batch
 * IPC: lottery:receivePackBatch
 * @param data - Batch reception data with serialized numbers
 * @returns Batch response with created, duplicates, and errors
 */
export async function receivePackBatch(
  data: ReceivePackBatchInput
): Promise<ApiResponse<ReceivePackBatchResponse>> {
  try {
    const result = await ipcClient.invoke<ReceivePackBatchResponse>(
      'lottery:receivePackBatch',
      data
    );
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Activate a lottery pack to a bin
 * IPC: lottery:activatePack
 * @param dataOrPackId - Activation data object OR pack_id string (for legacy compatibility)
 * @returns Activated pack response
 */
export async function activatePack(
  dataOrPackId: ActivatePackInput | string
): Promise<ApiResponse<ActivatePackResponse>> {
  try {
    // Handle legacy single-arg call (just packId) - will fail without bin_id but maintains compat
    const data =
      typeof dataOrPackId === 'string'
        ? { pack_id: dataOrPackId, bin_id: '', opening_serial: '000' }
        : dataOrPackId;
    const result = await ipcClient.invoke<ActivatePackResponse>('lottery:activatePack', data);
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Mark pack as sold out (deplete/settle)
 * IPC: lottery:depletePack
 *
 * SEC-014: INPUT_VALIDATION - closing_serial is REQUIRED
 * API-001: VALIDATION - Validates input before sending to backend
 *
 * @param data - Depletion data with pack_id and closing_serial (both required)
 * @returns Depleted pack response
 * @throws Error if closing_serial is not provided (no hardcoded defaults)
 */
export async function depletePack(
  data: DepletePackInput
): Promise<ApiResponse<DepletePackResponse>> {
  // SEC-014: Validate required fields - no hardcoded defaults allowed
  if (!data.closing_serial || typeof data.closing_serial !== 'string') {
    return {
      success: false,
      data: undefined as never,
      message: 'closing_serial is required and must be a string',
      error: 'VALIDATION_ERROR: closing_serial is required for pack depletion',
    };
  }

  // SEC-014: Validate closing_serial format (3-digit numeric string)
  if (!/^\d{3}$/.test(data.closing_serial)) {
    return {
      success: false,
      data: undefined as never,
      message: 'closing_serial must be a 3-digit numeric string (e.g., "029")',
      error: 'VALIDATION_ERROR: Invalid closing_serial format',
    };
  }

  try {
    const result = await ipcClient.invoke<DepletePackResponse>('lottery:depletePack', data);
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Mark pack as sold out (depleted)
 *
 * SEC-014: INPUT_VALIDATION - closing_serial is REQUIRED (no hardcoded defaults)
 * API-001: VALIDATION - Strict schema enforcement
 *
 * @param packId - Pack UUID
 * @param data - Required closing data with closing_serial
 * @returns Depleted pack response
 */
export async function markPackAsSoldOut(
  packId: string,
  data: MarkPackAsSoldOutInput
): Promise<ApiResponse<DepletePackResponse>> {
  // SEC-014: Validate closing_serial is provided - no hardcoded defaults
  if (!data?.closing_serial) {
    return {
      success: false,
      data: undefined as never,
      message: 'closing_serial is required to mark pack as sold out',
      error: 'VALIDATION_ERROR: closing_serial must be provided (pack serial_end)',
    };
  }

  return depletePack({
    pack_id: packId,
    closing_serial: data.closing_serial,
  });
}

/**
 * Return a lottery pack
 * IPC: lottery:returnPack
 * @param packId - Pack UUID
 * @param data - Return data (return_reason, notes)
 * @returns Returned pack response
 */
export async function returnPack(
  packId: string,
  data: Omit<ReturnPackInput, 'pack_id'>
): Promise<ApiResponse<ReturnPackResponse>> {
  try {
    const result = await ipcClient.invoke<ReturnPackResponse>('lottery:returnPack', {
      pack_id: packId,
      ...data,
    });
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Get pack details by ID
 * IPC: lottery:getPackDetails
 * @param packId - Pack UUID
 * @returns Pack detail response
 */
export async function getPackDetails(
  packId: string
): Promise<ApiResponse<LotteryPackDetailResponse>> {
  try {
    const result = await ipcClient.invoke<LotteryPackDetailResponse>('lottery:getPackDetails', {
      pack_id: packId,
    });
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Get packs filtered by game ID
 * @param gameId - Game UUID
 * @param storeId - Store UUID
 * @returns Pack list response
 */
export async function getPacksByGame(
  gameId: string,
  storeId: string
): Promise<ApiResponse<LotteryPackResponse[]>> {
  return getPacks({ game_id: gameId, store_id: storeId });
}

/**
 * Update a lottery pack
 * IPC: lottery:updatePack
 * @param packId - Pack UUID
 * @param data - Update data
 * @returns Updated pack response
 */
export async function updatePack(
  packId: string,
  data: UpdatePackInput
): Promise<ApiResponse<LotteryPackResponse>> {
  try {
    const result = await ipcClient.invoke<LotteryPackResponse>('lottery:updatePack', {
      pack_id: packId,
      ...data,
    });
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Delete a lottery pack
 * IPC: lottery:deletePack
 * @param packId - Pack UUID
 * @returns Success response
 */
export async function deletePack(packId: string): Promise<ApiResponse<{ deleted: boolean }>> {
  try {
    const result = await ipcClient.invoke<{ deleted: boolean }>('lottery:deletePack', {
      pack_id: packId,
    });
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Full pack activation (with bin assignment)
 * IPC: lottery:activatePack
 *
 * BIN-001: Supports deplete_previous flag for auto-depletion of existing pack
 * SEC-010: store_id derived from session in handler, not passed from frontend
 * SYNC-001: Response includes depletedPack info for cloud sync compatibility
 * BIZ-012-FIX: Supports onboarding_mode for first-time store setup
 *
 * @param storeId - Store UUID (passed for interface consistency, handler uses session)
 * @param data - Full activation data including optional onboarding fields
 * @returns Activated pack response with optional depletedPack info
 */
export async function activatePackFull(
  _storeId: string,
  data: FullActivatePackInput
): Promise<ApiResponse<ActivatePackResponse>> {
  try {
    // SEC-010: store_id is derived from session in the handler via getStoreId()
    // API-001: Build payload with only defined fields to avoid sending undefined values
    // BIZ-012-FIX: Include onboarding fields when onboarding_mode is true
    const payload: Record<string, unknown> = {
      bin_id: data.bin_id,
      opening_serial: data.opening_serial,
    };

    // Optional fields - only include if defined
    if (data.pack_id !== undefined) {
      payload.pack_id = data.pack_id;
    }
    if (data.deplete_previous !== undefined) {
      payload.deplete_previous = data.deplete_previous;
    }

    // BIZ-012-FIX: Onboarding mode fields
    if (data.onboarding_mode === true) {
      payload.onboarding_mode = true;
      // SEC-014: game_id and pack_number are required when onboarding_mode is true
      // Backend validates this with Zod - frontend passes through
      if (data.game_id !== undefined) {
        payload.game_id = data.game_id;
      }
      if (data.pack_number !== undefined) {
        payload.pack_number = data.pack_number;
      }
    }

    const result = await ipcClient.invoke<ActivatePackResponse>('lottery:activatePack', payload);
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Get variances with filters
 * IPC: lottery:getVariances
 * @param filters - Variance filters
 * @returns Variance list response
 */
export async function getVariances(
  filters?: VarianceQueryFilters
): Promise<ApiResponse<VarianceResponse[]>> {
  try {
    const result = await ipcClient.invoke<VarianceResponse[]>('lottery:getVariances', filters);
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Approve or reject a variance
 * IPC: lottery:approveVariance
 * @param shiftId - Shift UUID
 * @param data - Approval data
 * @returns Updated variance response
 */
export async function approveVariance(
  shiftId: string,
  data: ApproveVarianceInput
): Promise<ApiResponse<VarianceResponse>> {
  try {
    const result = await ipcClient.invoke<VarianceResponse>('lottery:approveVariance', {
      shift_id: shiftId,
      ...data,
    });
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Create a new lottery game
 * IPC: lottery:createGame
 * @param data - Game creation data
 * @returns Created game response
 */
export async function createGame(data: CreateGameInput): Promise<ApiResponse<LotteryGameResponse>> {
  try {
    const result = await ipcClient.invoke<LotteryGameResponse>('lottery:createGame', data);
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Game lookup result from cloud-first lookup
 * SEC-014: Includes status for frontend validation before pack operations
 */
export interface GameLookupResult {
  found: boolean;
  source: 'cloud' | 'local';
  game: {
    game_id: string;
    game_code: string;
    name: string;
    price: number;
    pack_value: number;
    tickets_per_pack: number | null;
    /** Game status - frontend should validate ACTIVE before pack reception */
    status: LotteryGameStatus;
  } | null;
}

/**
 * Lookup a lottery game by game code
 * Cloud-first: checks cloud, then local cache
 * IPC: lottery:lookupGameByCode
 *
 * @param gameCode - 4-digit game code
 * @returns Lookup result with game data if found
 */
export async function lookupGameByCode(gameCode: string): Promise<ApiResponse<GameLookupResult>> {
  try {
    const result = await ipcClient.invoke<GameLookupResult>('lottery:lookupGameByCode', {
      game_code: gameCode,
    });
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Update a lottery game
 * IPC: lottery:updateGame
 * @param gameId - Game UUID
 * @param data - Update data
 * @returns Updated game response
 */
export async function updateGame(
  gameId: string,
  data: UpdateGameInput
): Promise<ApiResponse<LotteryGameResponse>> {
  try {
    const result = await ipcClient.invoke<LotteryGameResponse>('lottery:updateGame', {
      game_id: gameId,
      ...data,
    });
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Get lottery configuration values (prices, pack values)
 * IPC: lottery:getConfigValues
 * @returns Config values response
 */
export async function getLotteryConfigValues(): Promise<
  ApiResponse<{
    ticket_prices: LotteryConfigValueItem[];
    pack_values: LotteryConfigValueItem[];
  }>
> {
  try {
    const result = await ipcClient.invoke<{
      ticket_prices: LotteryConfigValueItem[];
      pack_values: LotteryConfigValueItem[];
    }>('lottery:getConfigValues');
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Get active shift for a cashier
 * IPC: shifts:getActiveShift
 * @param storeId - Store UUID
 * @param cashierId - Cashier UUID
 * @returns Active shift response or null
 */
export async function getCashierActiveShift(
  storeId: string,
  cashierId: string
): Promise<ApiResponse<ActiveShiftResponse | null>> {
  try {
    const result = await ipcClient.invoke<ActiveShiftResponse | null>('shifts:getActiveShift', {
      store_id: storeId,
      cashier_id: cashierId,
    });
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Close lottery day (legacy - use prepareLotteryDayClose + commitLotteryDayClose)
 * @param storeId - Store UUID
 * @param data - Close day input
 * @returns Close response
 */
export async function closeLotteryDay(
  storeId: string,
  data: CloseLotteryDayInput
): Promise<ApiResponse<CommitLotteryDayCloseResponse>> {
  try {
    // Two-phase close for backward compatibility
    // Phase 1: Prepare - get day_id
    const prepareResult = await ipcClient.invoke<PrepareLotteryDayCloseResponse>(
      'lottery:prepareDayClose',
      { closings: data.closings }
    );

    // Phase 2: Commit - pass day_id from prepare response
    const result = await ipcClient.invoke<CommitLotteryDayCloseResponse>('lottery:commitDayClose', {
      day_id: prepareResult.day_id,
    });
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

// ============ Day Close API Functions ============

/**
 * Phase 1: Prepare lottery day close
 * IPC: lottery:prepareDayClose
 *
 * Validates closings and stores them in PENDING_CLOSE state.
 * Call commitLotteryDayClose to finalize.
 *
 * @param data - Closing data with pack_id and closing_serial pairs
 * @returns Prepare response with preview data and expiration time
 */
export async function prepareLotteryDayClose(
  data: PrepareLotteryDayCloseInput
): Promise<ApiResponse<PrepareLotteryDayCloseResponse>> {
  try {
    const result = await ipcClient.invoke<PrepareLotteryDayCloseResponse>(
      'lottery:prepareDayClose',
      data
    );
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Phase 2: Commit lottery day close
 * IPC: lottery:commitDayClose
 *
 * Atomically commits both lottery close and day close.
 * Must be called after prepareLotteryDayClose and before pending close expires.
 *
 * @param data - Input containing day_id from prepareClose response
 * @returns Commit response with final lottery totals
 */
export async function commitLotteryDayClose(
  data: CommitLotteryDayCloseInput
): Promise<ApiResponse<CommitLotteryDayCloseResponse>> {
  try {
    const result = await ipcClient.invoke<CommitLotteryDayCloseResponse>(
      'lottery:commitDayClose',
      data
    );
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Cancel pending lottery day close
 * IPC: lottery:cancelDayClose
 *
 * Reverts PENDING_CLOSE status back to OPEN. Call when user
 * cancels the day close wizard or navigates away.
 *
 * @returns Cancel response with status
 */
export async function cancelLotteryDayClose(): Promise<ApiResponse<CancelLotteryDayCloseResponse>> {
  try {
    const result = await ipcClient.invoke<CancelLotteryDayCloseResponse>('lottery:cancelDayClose');
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

// ============ Barcode Parsing API ============

/**
 * Parse a lottery barcode
 * IPC: lottery:parseBarcode
 *
 * @param raw - Raw barcode string from scanner
 * @returns Parsed barcode data
 */
export async function parseBarcode(raw: string): Promise<ApiResponse<ParsedBarcode | null>> {
  try {
    const result = await ipcClient.invoke<ParsedBarcode | null>('lottery:parseBarcode', raw);
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

// ============ Lottery IPC API Object ============

/**
 * Type-safe lottery API object for use with hooks
 */
export const lotteryAPI = {
  // Games
  getGames: () => ipcClient.invoke<LotteryGameResponse[]>('lottery:getGames'),

  // Bins
  getBins: () => ipcClient.invoke<LotteryBinResponse[]>('lottery:getBins'),

  // Day Bins (enterprise-grade handler with full pack details)
  getDayBins: () => ipcClient.invoke<DayBinsResponse>('lottery:getDayBins'),

  // Day Status & Initialization
  getDayStatus: () => ipcClient.invoke<DayStatusResponse>('lottery:getDayStatus'),
  initializeBusinessDay: () =>
    ipcClient.invoke<InitializeBusinessDayResponse>('lottery:initializeBusinessDay'),

  // Packs
  getPacks: (filters?: LotteryPackQueryFilters) =>
    ipcClient.invoke<LotteryPackResponse[]>('lottery:getPacks', filters),

  receivePack: (data: ReceivePackInput) =>
    ipcClient.invoke<ReceivePackResponse>('lottery:receivePack', data),

  receivePackBatch: (data: ReceivePackBatchInput) =>
    ipcClient.invoke<ReceivePackBatchResponse>('lottery:receivePackBatch', data),

  activatePack: (data: ActivatePackInput) =>
    ipcClient.invoke<ActivatePackResponse>('lottery:activatePack', data),

  depletePack: (data: DepletePackInput) =>
    ipcClient.invoke<DepletePackResponse>('lottery:depletePack', data),

  returnPack: (data: ReturnPackInput) =>
    ipcClient.invoke<ReturnPackResponse>('lottery:returnPack', data),

  // Day Close
  prepareDayClose: (data: PrepareLotteryDayCloseInput) =>
    ipcClient.invoke<PrepareLotteryDayCloseResponse>('lottery:prepareDayClose', data),

  commitDayClose: (data: CommitLotteryDayCloseInput) =>
    ipcClient.invoke<CommitLotteryDayCloseResponse>('lottery:commitDayClose', data),

  cancelDayClose: () => ipcClient.invoke<CancelLotteryDayCloseResponse>('lottery:cancelDayClose'),

  // Barcode
  parseBarcode: (raw: string) =>
    ipcClient.invoke<ParsedBarcode | null>('lottery:parseBarcode', raw),
};

// ============ Export Types ============

export type { ParsedBarcode };
