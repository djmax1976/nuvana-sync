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
export type LotteryPackStatus = 'RECEIVED' | 'ACTIVATED' | 'SETTLED' | 'RETURNED';

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
  settled: number;
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
  settled_at: string | null; // ISO 8601
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
    bin_number: number;
    label: string | null;
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
 */
export interface ActivatePackInput {
  pack_id: string;
  bin_id: string;
  opening_serial: string;
}

/**
 * Activate pack response
 */
export interface ActivatePackResponse {
  pack_id: string;
  game_id: string;
  pack_number: string;
  status: 'ACTIVATED';
  activated_at: string;
  bin_id: string;
  opening_serial: string;
  game: {
    game_id: string;
    name: string;
  };
  bin: {
    bin_id: string;
    bin_number: number;
    label: string | null;
  };
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
  status: 'SETTLED';
  settled_at: string;
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
 */
export interface FullActivatePackInput {
  pack_id: string;
  bin_id: string;
  opening_serial: string;
  shift_id?: string;
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
 */
export interface MarkPackAsSoldOutInput {
  closing_serial?: string;
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
 * Lottery bin response from IPC
 */
export interface LotteryBinResponse {
  bin_id: string;
  store_id: string;
  bin_number: number;
  label: string | null;
  status: 'ACTIVE' | 'INACTIVE';
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
 */
export interface DepletedPackDay {
  pack_id: string;
  pack_number: string;
  game_name: string;
  game_price: number;
  bin_number: number;
  activated_at: string;
  depleted_at: string;
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
  status: 'ACTIVATED' | 'SETTLED' | 'RETURNED';
}

/**
 * Returned pack information
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
  tickets_sold_on_return: number | null;
  return_sales_amount: number | null;
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
 * @param dataOrPackId - Depletion data object OR pack_id string
 * @param closingSerial - Optional closing serial (when first arg is packId)
 * @returns Depleted pack response
 */
export async function depletePack(
  dataOrPackId: DepletePackInput | string,
  closingSerial?: string
): Promise<ApiResponse<DepletePackResponse>> {
  try {
    const data =
      typeof dataOrPackId === 'string'
        ? { pack_id: dataOrPackId, closing_serial: closingSerial || '299' }
        : dataOrPackId;
    const result = await ipcClient.invoke<DepletePackResponse>('lottery:depletePack', data);
    return wrapSuccess(result);
  } catch (error) {
    return handleIPCError(error);
  }
}

/**
 * Alias for depletePack for backward compatibility
 * @param packId - Pack UUID
 * @param data - Optional closing data
 */
export async function markPackAsSoldOut(
  packId: string,
  data?: MarkPackAsSoldOutInput
): Promise<ApiResponse<DepletePackResponse>> {
  return depletePack({
    pack_id: packId,
    closing_serial: data?.closing_serial || '299', // Default to last ticket
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
 * @param storeId - Store UUID (passed for interface consistency, handler uses session)
 * @param data - Full activation data
 * @returns Activated pack response
 */
export async function activatePackFull(
  _storeId: string,
  data: FullActivatePackInput
): Promise<ApiResponse<ActivatePackResponse>> {
  // Debug logging for activation
  console.log('[ACTIVATE-FULL DEBUG] activatePackFull called with:', {
    storeId: _storeId,
    data,
  });

  try {
    // Note: store_id is derived from session in the handler via getStoreId()
    // shift_id is optional and not used by current handler (for future use)
    console.log('[ACTIVATE-FULL DEBUG] Calling ipcClient.invoke lottery:activatePack');
    const result = await ipcClient.invoke<ActivatePackResponse>('lottery:activatePack', {
      pack_id: data.pack_id,
      bin_id: data.bin_id,
      opening_serial: data.opening_serial,
    });
    console.log('[ACTIVATE-FULL DEBUG] IPC result:', result);
    return wrapSuccess(result);
  } catch (error) {
    console.error('[ACTIVATE-FULL DEBUG] IPC error:', error);
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
    await ipcClient.invoke<PrepareLotteryDayCloseResponse>('lottery:prepareDayClose', {
      closings: data.closings,
    });
    const result = await ipcClient.invoke<CommitLotteryDayCloseResponse>('lottery:commitDayClose');
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
 * @returns Commit response with final lottery totals
 */
export async function commitLotteryDayClose(): Promise<ApiResponse<CommitLotteryDayCloseResponse>> {
  try {
    const result = await ipcClient.invoke<CommitLotteryDayCloseResponse>('lottery:commitDayClose');
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

  commitDayClose: () => ipcClient.invoke<CommitLotteryDayCloseResponse>('lottery:commitDayClose'),

  cancelDayClose: () => ipcClient.invoke<CancelLotteryDayCloseResponse>('lottery:cancelDayClose'),

  // Barcode
  parseBarcode: (raw: string) =>
    ipcClient.invoke<ParsedBarcode | null>('lottery:parseBarcode', raw),
};

// ============ Export Types ============

export type { ParsedBarcode };
