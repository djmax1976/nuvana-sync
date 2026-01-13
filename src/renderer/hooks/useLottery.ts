/**
 * Lottery custom hooks
 * Provides TanStack Query hooks for lottery data management
 *
 * Story: 6.10 - Lottery Management UI
 */

"use client";

import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  receivePack,
  activatePack,
  activatePackFull,
  updatePack,
  deletePack,
  getPacks,
  getPackDetails,
  getPacksByGame,
  getVariances,
  approveVariance,
  getLotteryDayBins,
  closeLotteryDay,
  markPackAsSoldOut,
  getCashierActiveShift,
  getGames,
  updateGame,
  depletePack,
  returnPack,
  type ReceivePackInput,
  type UpdatePackInput,
  type UpdateGameInput,
  type ApproveVarianceInput,
  type LotteryPackQueryFilters,
  type VarianceQueryFilters,
  type CloseLotteryDayInput,
  type MarkPackAsSoldOutInput,
  type FullActivatePackInput,
  type ReturnPackInput,
} from "../lib/api/lottery";

// ============ TanStack Query Keys ============

/**
 * Query key factory for lottery queries
 */
export const lotteryKeys = {
  all: ["lottery"] as const,
  packs: () => [...lotteryKeys.all, "packs"] as const,
  packList: (filters?: LotteryPackQueryFilters) =>
    [...lotteryKeys.packs(), "list", filters || {}] as const,
  packDetail: (packId: string | undefined) =>
    [...lotteryKeys.packs(), "detail", packId] as const,
  packsByGame: (gameId: string | undefined, storeId: string | undefined) =>
    [...lotteryKeys.packs(), "byGame", gameId, storeId] as const,
  variances: () => [...lotteryKeys.all, "variances"] as const,
  varianceList: (filters?: VarianceQueryFilters) =>
    [...lotteryKeys.variances(), "list", filters || {}] as const,
  dayBins: () => [...lotteryKeys.all, "dayBins"] as const,
  dayBinsList: (storeId: string | undefined, date?: string) =>
    [...lotteryKeys.dayBins(), storeId, date] as const,
  games: () => [...lotteryKeys.all, "games"] as const,
  gameList: () => [...lotteryKeys.games(), "list"] as const,
};

// ============ Query Hooks ============

/**
 * Hook to fetch lottery packs with filters
 * @param storeId - Store UUID (required for RLS enforcement)
 * @param filters - Query filters (status, game_id)
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with packs data
 */
export function useLotteryPacks(
  storeId: string | null | undefined,
  filters?: Omit<LotteryPackQueryFilters, "store_id">,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: lotteryKeys.packList(
      storeId ? { ...filters, store_id: storeId } : filters,
    ),
    queryFn: () =>
      getPacks(storeId ? { ...filters, store_id: storeId } : filters),
    enabled: options?.enabled !== false && !!storeId,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: 30000, // Consider data fresh for 30 seconds
    select: (response) => response.data,
  });
}

/**
 * Hook to fetch pack details by ID
 * @param packId - Pack UUID
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with pack detail data
 */
export function usePackDetails(
  packId: string | null,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: lotteryKeys.packDetail(packId ?? undefined),
    queryFn: () => getPackDetails(packId!),
    enabled: options?.enabled !== false && packId !== null,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    staleTime: 30000, // Consider data fresh for 30 seconds
    select: (response) => response.data,
  });
}

/**
 * Hook to fetch lottery variances with filters
 * @param storeId - Store UUID (required for RLS enforcement)
 * @param filters - Query filters (shift_id, pack_id, status)
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with variances data
 */
export function useLotteryVariances(
  storeId: string | null | undefined,
  filters?: Omit<VarianceQueryFilters, "store_id">,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: lotteryKeys.varianceList(
      storeId ? { ...filters, store_id: storeId } : filters,
    ),
    queryFn: () =>
      getVariances(storeId ? { ...filters, store_id: storeId } : filters),
    enabled: options?.enabled !== false && !!storeId,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: 30000, // Consider data fresh for 30 seconds
    select: (response) => response.data,
  });
}

// ============ Mutation Hooks ============

/**
 * Hook to invalidate lottery queries
 * Useful after mutations that affect lottery data
 */
export function useInvalidateLottery() {
  const queryClient = useQueryClient();

  return {
    invalidatePacks: () =>
      queryClient.invalidateQueries({ queryKey: lotteryKeys.packs() }),
    invalidatePackDetail: (packId: string) => {
      return queryClient.invalidateQueries({
        queryKey: lotteryKeys.packDetail(packId),
      });
    },
    invalidateVariances: () =>
      queryClient.invalidateQueries({ queryKey: lotteryKeys.variances() }),
    invalidateAll: () =>
      queryClient.invalidateQueries({ queryKey: lotteryKeys.all }),
  };
}

/**
 * Hook to receive a new lottery pack
 * @returns Mutation hook for pack reception
 */
export function usePackReception() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ReceivePackInput) => receivePack(data),
    onSuccess: () => {
      // Invalidate pack list queries to refresh the list
      queryClient.invalidateQueries({ queryKey: lotteryKeys.packs() });
    },
  });
}

/**
 * Hook to activate a lottery pack
 * @returns Mutation hook for pack activation
 */
export function usePackActivation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (packId: string) => activatePack(packId),
    onSuccess: (_, packId) => {
      // Invalidate pack list and detail queries to refresh after activation
      queryClient.invalidateQueries({ queryKey: lotteryKeys.packs() });
      queryClient.invalidateQueries({
        queryKey: lotteryKeys.packDetail(packId),
      });
    },
  });
}

/**
 * Hook to update a lottery pack
 * @returns Mutation hook for pack update
 */
export function useUpdatePack() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ packId, data }: { packId: string; data: UpdatePackInput }) =>
      updatePack(packId, data),
    onSuccess: (_, { packId }) => {
      // Invalidate pack list and detail queries to refresh after update
      queryClient.invalidateQueries({ queryKey: lotteryKeys.packs() });
      queryClient.invalidateQueries({
        queryKey: lotteryKeys.packDetail(packId),
      });
    },
  });
}

/**
 * Hook to delete a lottery pack
 * @returns Mutation hook for pack deletion
 */
export function useDeletePack() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (packId: string) => deletePack(packId),
    onSuccess: () => {
      // Invalidate pack list queries to refresh after deletion
      queryClient.invalidateQueries({ queryKey: lotteryKeys.packs() });
    },
  });
}

/**
 * Hook to fetch active packs by store
 * Convenience hook that filters by ACTIVE status
 * @param storeId - Store UUID (required for RLS enforcement)
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with active packs data
 */
export function useActivePacksByStore(
  storeId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  return useLotteryPacks(storeId, { status: "ACTIVE" }, options);
}

/**
 * Hook to approve a lottery variance
 * @returns Mutation hook for variance approval
 */
export function useVarianceApproval() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      shiftId,
      data,
    }: {
      shiftId: string;
      data: ApproveVarianceInput;
    }) => approveVariance(shiftId, data),
    onSuccess: () => {
      // Invalidate variance list queries to refresh after approval
      queryClient.invalidateQueries({ queryKey: lotteryKeys.variances() });
      // Also invalidate pack queries as variance approval may affect pack status
      queryClient.invalidateQueries({ queryKey: lotteryKeys.packs() });
    },
  });
}

/**
 * Hook to fetch lottery day bins for the MyStore lottery page
 * Returns bins with active packs, starting/ending serials for the business day,
 * and depleted packs for the day.
 * Story: MyStore Lottery Page Redesign
 * @param storeId - Store UUID (required for RLS enforcement)
 * @param date - Optional ISO date string (YYYY-MM-DD). Defaults to today in store timezone.
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with day bins data
 */
export function useLotteryDayBins(
  storeId: string | null | undefined,
  date?: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: lotteryKeys.dayBinsList(storeId ?? undefined, date),
    queryFn: () => getLotteryDayBins(storeId!, date),
    enabled: options?.enabled !== false && !!storeId,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: 30000, // Consider data fresh for 30 seconds
    select: (response) => response.data,
  });
}

/**
 * Hook to close lottery day
 * Records ending serials for all active packs
 * Story: Lottery Day Closing Feature
 * @returns Mutation hook for day closing
 */
export function useLotteryDayClose() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      storeId,
      data,
    }: {
      storeId: string;
      data: CloseLotteryDayInput;
    }) => closeLotteryDay(storeId, data),
    onSuccess: () => {
      // Invalidate day bins to refresh the ending serials
      queryClient.invalidateQueries({ queryKey: lotteryKeys.dayBins() });
      // Also invalidate packs list
      queryClient.invalidateQueries({ queryKey: lotteryKeys.packs() });
    },
  });
}

/**
 * Input for the mark pack as sold out mutation
 */
export interface MarkPackAsSoldOutMutationInput {
  packId: string;
  data?: MarkPackAsSoldOutInput;
}

/**
 * Hook to mark a pack as sold out (manual depletion)
 * Story: Lottery Pack Auto-Depletion Feature
 *
 * MCP Guidance Applied:
 * - API-001: VALIDATION - Always send valid JSON body for POST requests
 * - FE-001: STATE_MANAGEMENT - Proper cache invalidation after mutation
 *
 * @returns Mutation hook for marking pack as sold out
 */
export function useMarkPackAsSoldOut() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ packId, data = {} }: MarkPackAsSoldOutMutationInput) =>
      markPackAsSoldOut(packId, data),
    onSuccess: () => {
      // Invalidate day bins to refresh the bin display (pack removed from bin)
      queryClient.invalidateQueries({ queryKey: lotteryKeys.dayBins() });
      // Also invalidate packs list to reflect status change
      queryClient.invalidateQueries({ queryKey: lotteryKeys.packs() });
    },
  });
}

// ============ Pack Search Hooks ============

/**
 * Hook to search lottery packs with debouncing
 * Story: Pack Activation UX Enhancement
 *
 * MCP Guidance Applied:
 * - DB-006: TENANT_ISOLATION - Store-scoped search
 * - SEC-006: SQL_INJECTION - Search uses Prisma parameterized queries
 *
 * @param storeId - Store UUID (required for RLS enforcement)
 * @param search - Search query (min 2 chars to trigger search)
 * @param filters - Additional query filters (status, game_id)
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with matching packs
 */
export function usePackSearch(
  storeId: string | null | undefined,
  search: string | undefined,
  filters?: Omit<LotteryPackQueryFilters, "store_id" | "search">,
  options?: { enabled?: boolean },
) {
  // Only search if we have 2+ characters
  const searchEnabled = (search?.length ?? 0) >= 2;

  return useQuery({
    queryKey: lotteryKeys.packList(
      storeId ? { ...filters, store_id: storeId, search } : filters,
    ),
    queryFn: () =>
      getPacks(storeId ? { ...filters, store_id: storeId, search } : filters),
    enabled: options?.enabled !== false && !!storeId && searchEnabled,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    staleTime: 60000, // Consider search results fresh for 1 minute
    select: (response) => response.data,
  });
}

// ============ Full Pack Activation Hooks ============

/**
 * Input for the full pack activation mutation
 */
export interface FullPackActivationMutationInput {
  storeId: string;
  data: FullActivatePackInput;
}

/**
 * Hook for full pack activation (with bin assignment)
 * Story: Pack Activation UX Enhancement
 *
 * This combines pack activation and bin assignment in a single operation.
 * Supports both cashier flow (with shift_id) and manager override (no shift_id).
 *
 * MCP Guidance Applied:
 * - FE-001: STATE_MANAGEMENT - Proper cache invalidation after mutation
 * - SEC-010: AUTHZ - Role-based shift requirement handled by backend
 *
 * @returns Mutation hook for full pack activation
 */
export function useFullPackActivation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ storeId, data }: FullPackActivationMutationInput) =>
      activatePackFull(storeId, data),
    onSuccess: () => {
      // Invalidate pack list and day bins to refresh after activation
      queryClient.invalidateQueries({ queryKey: lotteryKeys.packs() });
      queryClient.invalidateQueries({ queryKey: lotteryKeys.dayBins() });
    },
  });
}

// ============ Cashier Shift Hooks ============

/**
 * Hook to get the active shift for a cashier
 * Story: Pack Activation UX Enhancement
 *
 * MCP Guidance Applied:
 * - DB-006: TENANT_ISOLATION - Store-scoped query
 * - API-003: ERROR_HANDLING - Handles 404 when no active shift
 *
 * @param storeId - Store UUID
 * @param cashierId - Cashier UUID
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with active shift data
 */
export function useCashierActiveShift(
  storeId: string | null | undefined,
  cashierId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["shifts", "active", storeId, cashierId] as const,
    queryFn: () => getCashierActiveShift(storeId!, cashierId!),
    enabled: options?.enabled !== false && !!storeId && !!cashierId,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    retry: false, // Don't retry 404s (cashier has no active shift)
    select: (response) => response.data,
  });
}

// ============ Game Management Hooks ============

/**
 * Hook to fetch all lottery games
 * GET /api/lottery/games
 *
 * MCP Guidance Applied:
 * - DB-006: TENANT_ISOLATION - Server filters games by user access
 * - FE-001: STATE_MANAGEMENT - Proper caching with query keys
 *
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with games list
 */
export function useLotteryGames(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: lotteryKeys.gameList(),
    queryFn: () => getGames(),
    enabled: options?.enabled !== false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: 30000, // Consider data fresh for 30 seconds
    select: (response) => response.data,
  });
}

/**
 * Hook to fetch packs filtered by game ID
 * GET /api/lottery/packs?game_id={gameId}&store_id={storeId}
 *
 * MCP Guidance Applied:
 * - DB-006: TENANT_ISOLATION - Store-scoped query
 * - FE-001: STATE_MANAGEMENT - Proper caching with query keys
 *
 * @param gameId - Game UUID to filter packs
 * @param storeId - Store UUID for RLS enforcement
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with packs for the game
 */
export function usePacksByGame(
  gameId: string | null | undefined,
  storeId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: lotteryKeys.packsByGame(
      gameId ?? undefined,
      storeId ?? undefined,
    ),
    queryFn: () => getPacksByGame(gameId!, storeId!),
    enabled: options?.enabled !== false && !!gameId && !!storeId,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: 30000, // Consider data fresh for 30 seconds
    select: (response) => response.data,
  });
}

/**
 * Hook to update a lottery game
 * PUT /api/lottery/games/:gameId
 *
 * MCP Guidance Applied:
 * - API-001: VALIDATION - Server validates all input fields
 * - API-009: IDOR - Server validates ownership via store access
 * - FE-001: STATE_MANAGEMENT - Proper cache invalidation after mutation
 *
 * @returns Mutation hook for game update
 */
export function useUpdateGame() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ gameId, data }: { gameId: string; data: UpdateGameInput }) =>
      updateGame(gameId, data),
    onSuccess: () => {
      // Invalidate games list to refresh after update
      queryClient.invalidateQueries({ queryKey: lotteryKeys.games() });
      // Also invalidate packs as game info may be embedded in pack responses
      queryClient.invalidateQueries({ queryKey: lotteryKeys.packs() });
    },
  });
}

/**
 * Hook to mark a pack as depleted (sold out)
 * POST /api/lottery/packs/:packId/deplete
 *
 * MCP Guidance Applied:
 * - API-001: VALIDATION - Server validates pack status and ownership
 * - DB-006: TENANT_ISOLATION - Server enforces store-level isolation
 * - FE-001: STATE_MANAGEMENT - Proper cache invalidation after mutation
 *
 * @returns Mutation hook for pack depletion
 */
export function useDepletePack() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      packId,
      closingSerial,
    }: {
      packId: string;
      closingSerial?: string;
    }) => depletePack(packId, closingSerial),
    onSuccess: (_, { packId }) => {
      // Invalidate packs list to refresh after depletion
      queryClient.invalidateQueries({ queryKey: lotteryKeys.packs() });
      // Invalidate pack detail
      queryClient.invalidateQueries({
        queryKey: lotteryKeys.packDetail(packId),
      });
      // Invalidate day bins to refresh the bin display
      queryClient.invalidateQueries({ queryKey: lotteryKeys.dayBins() });
    },
  });
}

// ============ Pack Return Hooks ============

/**
 * Input for the return pack mutation
 * Story: Lottery Pack Return Feature
 */
export interface ReturnPackMutationInput {
  packId: string;
  data: ReturnPackInput;
}

/**
 * Hook to return a lottery pack to supplier
 * POST /api/lottery/packs/:packId/return
 * Story: Lottery Pack Return Feature
 *
 * Business Rules:
 * - RECEIVED packs can be returned directly
 * - ACTIVE packs require manager approval (data.manager_approved_by)
 * - DEPLETED and already RETURNED packs cannot be returned
 *
 * MCP Guidance Applied:
 * - FE-001: STATE_MANAGEMENT - Proper cache invalidation after mutation
 * - API-001: VALIDATION - Server validates all input fields
 * - DB-006: TENANT_ISOLATION - Server enforces store-level isolation
 *
 * @returns Mutation hook for pack return
 */
export function useReturnPack() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ packId, data }: ReturnPackMutationInput) =>
      returnPack(packId, data),
    onSuccess: (_, { packId }) => {
      // Invalidate packs list to refresh after return
      queryClient.invalidateQueries({ queryKey: lotteryKeys.packs() });
      // Invalidate pack detail
      queryClient.invalidateQueries({
        queryKey: lotteryKeys.packDetail(packId),
      });
      // Invalidate day bins in case pack was active in a bin
      queryClient.invalidateQueries({ queryKey: lotteryKeys.dayBins() });
    },
  });
}
