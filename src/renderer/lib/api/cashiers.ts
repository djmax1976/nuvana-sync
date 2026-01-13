/**
 * Cashier API client functions
 * Provides functions for interacting with the cashier management API
 * All functions require CASHIER_* permissions (except authenticate)
 *
 * Uses shared API client for consistent:
 * - 401/session expiration handling (automatic redirect to login)
 * - Error formatting with ApiError class
 * - Timeout configuration (30s default)
 * - Credential handling (httpOnly cookies)
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  useQueries,
} from "@tanstack/react-query";
import apiClient, { extractData, ApiResponse } from "./client";

/**
 * Cashier entity type
 */
export interface Cashier {
  cashier_id: string;
  store_id: string;
  employee_id: string;
  name: string;
  is_active: boolean;
  hired_on: string; // ISO date string
  termination_date: string | null; // ISO date string
  created_at: string; // ISO date string
  updated_at: string; // ISO date string
  disabled_at: string | null; // ISO date string
}

/**
 * Cashier session data returned when terminal_id is provided
 */
export interface CashierSession {
  session_id: string;
  session_token: string;
  expires_at: string; // ISO date string
}

/**
 * Cashier authentication result
 * Includes session data when terminal_id was provided in the request
 */
export interface CashierAuthResult {
  cashier_id: string;
  employee_id: string;
  name: string;
  session: CashierSession | null;
}

/**
 * Input type for creating a cashier
 */
export interface CreateCashierInput {
  name: string;
  pin: string;
  hired_on: string; // ISO date string (YYYY-MM-DD)
  termination_date?: string | null;
}

/**
 * Input type for updating a cashier
 */
export interface UpdateCashierInput {
  name?: string;
  pin?: string;
  hired_on?: string;
  termination_date?: string | null;
}

/**
 * Get cashiers for a store
 * @param storeId - Store UUID
 * @param filters - Filter options (is_active)
 * @returns Array of cashiers
 */
export async function getCashiers(
  storeId: string,
  filters?: { is_active?: boolean },
): Promise<Cashier[]> {
  if (!storeId) {
    throw new Error("Store ID is required");
  }

  const response = await apiClient.get<ApiResponse<Cashier[]>>(
    `/api/stores/${storeId}/cashiers`,
    {
      params:
        filters?.is_active !== undefined
          ? { is_active: filters.is_active }
          : undefined,
    },
  );
  return extractData(response);
}

/**
 * Get a single cashier by ID
 * @param storeId - Store UUID
 * @param cashierId - Cashier UUID
 * @returns Cashier data
 */
export async function getCashierById(
  storeId: string,
  cashierId: string,
): Promise<Cashier> {
  if (!storeId) {
    throw new Error("Store ID is required");
  }
  if (!cashierId) {
    throw new Error("Cashier ID is required");
  }

  const response = await apiClient.get<ApiResponse<Cashier>>(
    `/api/stores/${storeId}/cashiers/${cashierId}`,
  );
  return extractData(response);
}

/**
 * Create a new cashier
 * @param storeId - Store UUID
 * @param data - Cashier data (name, pin, hired_on, termination_date)
 * @returns Created cashier data
 */
export async function createCashier(
  storeId: string,
  data: CreateCashierInput,
): Promise<Cashier> {
  if (!storeId) {
    throw new Error("Store ID is required");
  }

  const response = await apiClient.post<ApiResponse<Cashier>>(
    `/api/stores/${storeId}/cashiers`,
    data,
  );
  return extractData(response);
}

/**
 * Update an existing cashier
 * @param storeId - Store UUID
 * @param cashierId - Cashier UUID
 * @param data - Fields to update
 * @returns Updated cashier data
 */
export async function updateCashier(
  storeId: string,
  cashierId: string,
  data: UpdateCashierInput,
): Promise<Cashier> {
  if (!storeId) {
    throw new Error("Store ID is required");
  }
  if (!cashierId) {
    throw new Error("Cashier ID is required");
  }

  const response = await apiClient.put<ApiResponse<Cashier>>(
    `/api/stores/${storeId}/cashiers/${cashierId}`,
    data,
  );
  return extractData(response);
}

/**
 * Delete (soft delete) a cashier
 * @param storeId - Store UUID
 * @param cashierId - Cashier UUID
 */
export async function deleteCashier(
  storeId: string,
  cashierId: string,
): Promise<void> {
  if (!storeId) {
    throw new Error("Store ID is required");
  }
  if (!cashierId) {
    throw new Error("Cashier ID is required");
  }

  await apiClient.delete(`/api/stores/${storeId}/cashiers/${cashierId}`);
}

/**
 * Authenticate cashier by name or employee_id and PIN
 *
 * When terminalId is provided, a Cashier Session Token is created and returned.
 * This token must be included in subsequent terminal operation requests via
 * the X-Cashier-Session header.
 *
 * @param storeId - Store UUID
 * @param identifier - Name or employee_id
 * @param pin - PIN number (4 digits)
 * @param terminalId - Optional terminal UUID for creating session token
 * @returns Cashier authentication result with optional session data
 */
export async function authenticateCashier(
  storeId: string,
  identifier: { name?: string; employee_id?: string },
  pin: string,
  terminalId?: string,
): Promise<CashierAuthResult> {
  if (!storeId) {
    throw new Error("Store ID is required");
  }

  if (!identifier.name && !identifier.employee_id) {
    throw new Error("Either name or employee_id must be provided");
  }

  if (!pin || !/^\d{4}$/.test(pin)) {
    throw new Error("PIN must be exactly 4 numeric digits");
  }

  const response = await apiClient.post<ApiResponse<CashierAuthResult>>(
    `/api/stores/${storeId}/cashiers/authenticate`,
    {
      name: identifier.name,
      employee_id: identifier.employee_id,
      pin,
      terminal_id: terminalId,
    },
  );
  return extractData(response);
}

/**
 * Query keys for cashier queries
 */
export const cashierKeys = {
  all: () => ["cashiers"] as const,
  lists: () => [...cashierKeys.all(), "list"] as const,
  list: (storeId: string, filters?: { is_active?: boolean }) =>
    [...cashierKeys.lists(), storeId, filters] as const,
  details: () => [...cashierKeys.all(), "detail"] as const,
  detail: (storeId: string, cashierId: string) =>
    [...cashierKeys.details(), storeId, cashierId] as const,
};

/**
 * Hook to fetch cashiers for a store
 * @param storeId - Store UUID
 * @param filters - Filter options (is_active)
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with cashiers data
 */
export function useCashiers(
  storeId: string | undefined,
  filters?: { is_active?: boolean },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: cashierKeys.list(storeId || "", filters),
    queryFn: () => getCashiers(storeId!, filters),
    enabled: options?.enabled !== false && !!storeId,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}

/**
 * Cashier with store information for multi-store views
 */
export interface CashierWithStore extends Cashier {
  store_name: string;
}

/**
 * Hook to fetch cashiers from multiple stores and aggregate results
 * Used when user selects "All Stores" in the cashier list
 *
 * @param storeIds - Array of store UUIDs to fetch cashiers from
 * @param storeNameMap - Map of store_id to store name for display
 * @param filters - Filter options (is_active)
 * @param options - Query options (enabled, etc.)
 * @returns Combined result with aggregated cashiers from all stores
 */
export function useCashiersMultiStore(
  storeIds: string[],
  storeNameMap: Map<string, string>,
  filters?: { is_active?: boolean },
  options?: { enabled?: boolean },
) {
  const queries = useQueries({
    queries: storeIds.map((storeId) => ({
      queryKey: cashierKeys.list(storeId, filters),
      queryFn: () => getCashiers(storeId, filters),
      enabled: options?.enabled !== false && storeIds.length > 0,
      refetchOnMount: "always" as const,
      refetchOnWindowFocus: true,
    })),
  });

  // Aggregate results from all queries
  const isLoading = queries.some((q) => q.isLoading);
  const isError = queries.some((q) => q.isError);
  const error = queries.find((q) => q.error)?.error;

  // Combine all cashiers with store name
  // We use zip-like iteration since queries and storeIds have the same length/order
  const data: CashierWithStore[] = [];
  queries.forEach((query, index) => {
    const storeId = storeIds.at(index);
    if (!query?.data || !storeId) return;
    const storeName = storeNameMap.get(storeId) || "Unknown Store";
    for (const cashier of query.data) {
      data.push({
        ...cashier,
        store_name: storeName,
      });
    }
  });

  // Sort by store name, then by name
  data.sort((a, b) => {
    const storeCompare = a.store_name.localeCompare(b.store_name);
    if (storeCompare !== 0) return storeCompare;
    return a.name.localeCompare(b.name);
  });

  // Create refetch function that refetches all queries
  const refetch = () => {
    queries.forEach((q) => q.refetch());
  };

  return {
    data: data.length > 0 ? data : undefined,
    isLoading,
    isError,
    error,
    refetch,
  };
}

/**
 * Hook to authenticate cashier
 * @returns TanStack Query mutation for cashier authentication
 */
export function useAuthenticateCashier() {
  return useMutation({
    mutationFn: ({
      storeId,
      identifier,
      pin,
      terminalId,
    }: {
      storeId: string;
      identifier: { name?: string; employee_id?: string };
      pin: string;
      terminalId?: string;
    }) => authenticateCashier(storeId, identifier, pin, terminalId),
  });
}

/**
 * Hook to fetch a single cashier by ID
 * @param storeId - Store UUID
 * @param cashierId - Cashier UUID
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with cashier data
 */
export function useCashier(
  storeId: string | undefined,
  cashierId: string | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: cashierKeys.detail(storeId || "", cashierId || ""),
    queryFn: () => getCashierById(storeId!, cashierId!),
    enabled: options?.enabled !== false && !!storeId && !!cashierId,
  });
}

/**
 * Hook to create a cashier
 * @returns TanStack Query mutation for creating a cashier
 */
export function useCreateCashier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      storeId,
      data,
    }: {
      storeId: string;
      data: CreateCashierInput;
    }) => createCashier(storeId, data),
    onSuccess: (_, variables) => {
      // Invalidate ALL cashier list queries for this store (regardless of filters)
      // Using partial key match to invalidate both filtered and unfiltered queries
      // refetchType: "all" ensures queries refetch even when navigating between pages
      queryClient.invalidateQueries({
        queryKey: ["cashiers", "list", variables.storeId],
        refetchType: "all",
      });
    },
  });
}

/**
 * Hook to update a cashier
 * @returns TanStack Query mutation for updating a cashier
 */
export function useUpdateCashier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      storeId,
      cashierId,
      data,
    }: {
      storeId: string;
      cashierId: string;
      data: UpdateCashierInput;
    }) => updateCashier(storeId, cashierId, data),
    onSuccess: (_, variables) => {
      // Invalidate ALL cashier list queries for this store (regardless of filters)
      // refetchType: "all" ensures queries refetch even when navigating between pages
      queryClient.invalidateQueries({
        queryKey: ["cashiers", "list", variables.storeId],
        refetchType: "all",
      });
      queryClient.invalidateQueries({
        queryKey: cashierKeys.detail(variables.storeId, variables.cashierId),
        refetchType: "all",
      });
    },
  });
}

/**
 * Hook to delete a cashier
 * @returns TanStack Query mutation for deleting a cashier
 */
export function useDeleteCashier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      storeId,
      cashierId,
    }: {
      storeId: string;
      cashierId: string;
    }) => deleteCashier(storeId, cashierId),
    onSuccess: (_, variables) => {
      // Invalidate ALL cashier list queries for this store (regardless of filters)
      // refetchType: "all" ensures queries refetch even when navigating between pages
      queryClient.invalidateQueries({
        queryKey: ["cashiers", "list", variables.storeId],
        refetchType: "all",
      });
    },
  });
}
