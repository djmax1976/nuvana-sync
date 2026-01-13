/**
 * Store API client functions
 * Provides functions for interacting with the store management API
 * All functions require STORE_* permissions and enforce company isolation
 *
 * Uses shared API client for consistent:
 * - 401/session expiration handling (automatic redirect to login)
 * - Error formatting with ApiError class
 * - Timeout configuration (30s default)
 * - Credential handling (httpOnly cookies)
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import apiClient from "./client";

/**
 * Store status values
 */
export type StoreStatus = "ACTIVE" | "INACTIVE" | "CLOSED";

/**
 * Location JSON structure
 */
export interface LocationJson {
  address?: string;
  gps?: { lat: number; lng: number };
}

/**
 * Store configuration type
 */
export interface StoreConfiguration {
  timezone?: string;
  location?: {
    address?: string;
  };
  operating_hours?: {
    monday?: { open?: string; close?: string; closed?: boolean };
    tuesday?: { open?: string; close?: string; closed?: boolean };
    wednesday?: { open?: string; close?: string; closed?: boolean };
    thursday?: { open?: string; close?: string; closed?: boolean };
    friday?: { open?: string; close?: string; closed?: boolean };
    saturday?: { open?: string; close?: string; closed?: boolean };
    sunday?: { open?: string; close?: string; closed?: boolean };
  };
}

/**
 * Store entity type
 */
export interface Store {
  store_id: string;
  company_id: string;
  name: string;
  location_json: LocationJson | null;
  timezone: string;
  status: StoreStatus;
  configuration?: StoreConfiguration | null;
  created_at: string;
  updated_at: string;
}

/**
 * Store login credential info (CLIENT_USER for store dashboard access)
 */
export interface StoreLogin {
  user_id: string;
  email: string;
  name: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * @deprecated Use StoreLogin instead. This alias exists for backward compatibility.
 */
export type StoreManager = StoreLogin;

/**
 * Terminal creation input (for wizard)
 */
export interface TerminalInput {
  name: string;
  device_id?: string;
  connection_type?: "NETWORK" | "API" | "WEBHOOK" | "FILE" | "MANUAL";
  vendor_type?:
    | "GENERIC"
    | "SQUARE"
    | "CLOVER"
    | "TOAST"
    | "LIGHTSPEED"
    | "CUSTOM";
  connection_config?: Record<string, unknown>;
}

/**
 * Create store input
 */
export interface CreateStoreInput {
  name: string;
  location_json?: LocationJson;
  timezone?: string; // IANA timezone format
  status?: StoreStatus;
}

/**
 * Extended create store input (with store login and terminals)
 */
export interface CreateStoreWithLoginInput extends CreateStoreInput {
  manager?: {
    email: string;
    password: string;
  };
  terminals?: TerminalInput[];
}

/**
 * @deprecated Use CreateStoreWithLoginInput instead
 */
export type CreateStoreWithManagerInput = CreateStoreWithLoginInput;

/**
 * Extended store response (with store login and terminals)
 */
export interface CreateStoreWithLoginResponse extends Store {
  manager?: StoreLogin | null;
  terminals?: Array<{
    pos_terminal_id: string;
    name: string;
    device_id: string | null;
    connection_type: string;
    vendor_type: string;
  }>;
}

/**
 * @deprecated Use CreateStoreWithLoginResponse instead
 */
export type CreateStoreWithManagerResponse = CreateStoreWithLoginResponse;

/**
 * Update store input
 */
export interface UpdateStoreInput {
  name?: string;
  location_json?: LocationJson;
  timezone?: string; // IANA timezone format
  status?: StoreStatus;
}

/**
 * List stores response
 */
export interface ListStoresResponse {
  data: Store[];
  meta: {
    total: number;
    limit: number;
    offset: number;
  };
}

/**
 * List stores query parameters
 */
export interface ListStoresParams {
  limit?: number;
  offset?: number;
}

/**
 * Store with company info (for system admin view)
 */
export interface StoreWithCompany extends Store {
  company?: {
    name: string;
  };
}

/**
 * Validate IANA timezone format (safer implementation to avoid ReDoS)
 * Supports formats like: America/New_York, Europe/London, UTC, GMT+5, GMT-3
 */
function validateTimezone(timezone: string): boolean {
  if (timezone === "UTC") {
    return true;
  }
  if (/^GMT[+-]\d{1,2}$/.test(timezone)) {
    return true;
  }
  // Limit length to prevent ReDoS
  if (timezone.length > 50) {
    return false;
  }
  // Split and validate each segment instead of using nested quantifiers
  const parts = timezone.split("/");
  if (parts.length < 2 || parts.length > 3) {
    return false;
  }
  // Each part should contain only letters and underscores
  const segmentPattern = /^[A-Za-z_]+$/;
  return parts.every((part) => segmentPattern.test(part));
}

/**
 * Validate location JSON structure (address only, no GPS validation needed)
 */
function validateLocationJson(location: LocationJson): void {
  // No validation needed for address-only location
  return;
}

/**
 * Get all stores (System Admin only)
 * @param params - Query parameters for pagination
 * @returns List of all stores with company info
 */
export async function getAllStores(params?: ListStoresParams): Promise<{
  data: StoreWithCompany[];
  meta: { total: number; limit: number; offset: number };
}> {
  const response = await apiClient.get<{
    data: StoreWithCompany[];
    meta: { total: number; limit: number; offset: number };
  }>("/api/stores", { params });
  return response.data;
}

/**
 * Get stores accessible to the current client user
 * Uses RBAC to filter stores based on user's scope (company or store level)
 * @param params - Query parameters for pagination
 * @returns List of accessible stores with company info
 */
export async function getClientStores(params?: ListStoresParams): Promise<{
  success: boolean;
  data: StoreWithCompany[];
  meta: { total: number; limit: number; offset: number };
}> {
  const response = await apiClient.get<{
    success: boolean;
    data: StoreWithCompany[];
    meta: { total: number; limit: number; offset: number };
  }>("/api/client/stores", { params });
  return response.data;
}

/**
 * Get stores by company ID (Corporate Admin, filtered by company_id)
 * @param companyId - Company UUID
 * @param params - Query parameters for pagination
 * @returns List of stores for the company
 */
export async function getStoresByCompany(
  companyId: string,
  params?: ListStoresParams,
): Promise<ListStoresResponse> {
  if (!companyId) {
    throw new Error("Company ID is required");
  }

  const response = await apiClient.get<ListStoresResponse>(
    `/api/companies/${companyId}/stores`,
    { params },
  );
  return response.data;
}

/**
 * Get store by ID
 * @param storeId - Store UUID
 * @returns Store details
 */
export async function getStoreById(storeId: string): Promise<Store> {
  if (!storeId) {
    throw new Error("Store ID is required");
  }

  const response = await apiClient.get<Store>(`/api/stores/${storeId}`);
  return response.data;
}

/**
 * Create a new store
 * @param companyId - Company UUID
 * @param data - Store creation data
 * @returns Created store
 */
export async function createStore(
  companyId: string,
  data: CreateStoreInput,
): Promise<Store> {
  if (!companyId) {
    throw new Error("Company ID is required");
  }

  if (!data.name || data.name.trim().length === 0) {
    throw new Error("Store name is required");
  }

  if (data.name.length > 255) {
    throw new Error("Store name must be 255 characters or less");
  }

  if (data.timezone && !validateTimezone(data.timezone)) {
    throw new Error(
      "Timezone must be in IANA format (e.g., America/New_York, Europe/London)",
    );
  }

  if (data.location_json) {
    validateLocationJson(data.location_json);
  }

  const response = await apiClient.post<Store>(
    `/api/companies/${companyId}/stores`,
    data,
  );
  return response.data;
}

/**
 * Update store
 * @param storeId - Store UUID
 * @param data - Store update data
 * @returns Updated store
 */
export async function updateStore(
  storeId: string,
  data: UpdateStoreInput,
): Promise<Store> {
  if (!storeId) {
    throw new Error("Store ID is required");
  }

  if (data.name !== undefined && data.name.trim().length === 0) {
    throw new Error("Store name cannot be empty");
  }

  if (data.name !== undefined && data.name.length > 255) {
    throw new Error("Store name must be 255 characters or less");
  }

  if (data.timezone && !validateTimezone(data.timezone)) {
    throw new Error(
      "Timezone must be in IANA format (e.g., America/New_York, Europe/London)",
    );
  }

  if (data.location_json) {
    validateLocationJson(data.location_json);
  }

  const response = await apiClient.put<Store>(`/api/stores/${storeId}`, data);
  return response.data;
}

/**
 * Delete store (soft delete)
 * @param storeId - Store UUID
 */
export async function deleteStore(storeId: string): Promise<void> {
  if (!storeId) {
    throw new Error("Store ID is required");
  }

  await apiClient.delete(`/api/stores/${storeId}`);
}

// ============ TanStack Query Hooks ============

/**
 * Query key factory for store queries
 */
export const storeKeys = {
  all: ["stores"] as const,
  lists: () => [...storeKeys.all, "list"] as const,
  listAll: (params?: ListStoresParams) =>
    [...storeKeys.lists(), "all", params] as const,
  list: (companyId: string, params?: ListStoresParams) =>
    [...storeKeys.lists(), companyId, params] as const,
  details: () => [...storeKeys.all, "detail"] as const,
  detail: (id: string) => [...storeKeys.details(), id] as const,
};

/**
 * Hook to fetch all stores (System Admin only)
 * @param params - Query parameters for pagination
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with all stores data
 */
export function useAllStores(
  params?: ListStoresParams,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: storeKeys.listAll(params),
    queryFn: () => getAllStores(params),
    enabled: options?.enabled !== false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to fetch user-accessible stores
 *
 * Uses the client-specific endpoint that returns stores based on
 * the authenticated user's RBAC permissions (company or store scope).
 *
 * Enterprise Standards Applied:
 * - API-001: Type-safe response with proper TypeScript types
 * - API-003: Consistent error handling via TanStack Query
 * - FE-001: Uses httpOnly cookies for authentication (via credentials: include)
 * - RBAC: Uses /api/client/stores which filters by user's scope
 *
 * @param params - Query parameters for pagination
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with stores data
 *
 * @example
 * ```tsx
 * const { data: storesData, isLoading } = useStores();
 * const stores = storesData?.data || [];
 * ```
 */
export function useStores(
  params?: ListStoresParams,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: [...storeKeys.lists(), "client", params] as const,
    queryFn: () => getClientStores(params),
    enabled: options?.enabled !== false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: 30000, // Consider data fresh for 30 seconds
  });
}

/**
 * Hook to fetch stores list for a company
 * @param companyId - Company UUID
 * @param params - Query parameters for pagination
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with stores data
 */
export function useStoresByCompany(
  companyId: string | undefined,
  params?: ListStoresParams,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: storeKeys.list(companyId || "", params),
    queryFn: () => getStoresByCompany(companyId!, params),
    enabled: options?.enabled !== false && !!companyId,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to fetch a single store by ID
 * @param storeId - Store UUID
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with store data
 */
export function useStore(
  storeId: string | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: storeKeys.detail(storeId || ""),
    queryFn: () => getStoreById(storeId!),
    enabled: options?.enabled !== false && !!storeId,
  });
}

/**
 * Hook to create a new store
 * @returns TanStack Query mutation for creating a store
 */
export function useCreateStore() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      companyId,
      data,
    }: {
      companyId: string;
      data: CreateStoreInput;
    }) => createStore(companyId, data),
    onSuccess: () => {
      // Invalidate ALL store queries to ensure lists refresh
      queryClient.invalidateQueries({
        queryKey: storeKeys.all,
        refetchType: "all",
      });
    },
  });
}

/**
 * Hook to update a store
 * @returns TanStack Query mutation for updating a store
 */
export function useUpdateStore() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      storeId,
      data,
    }: {
      storeId: string;
      data: UpdateStoreInput;
    }) => updateStore(storeId, data),
    onSuccess: () => {
      // Invalidate ALL store queries to ensure lists and details refresh
      queryClient.invalidateQueries({
        queryKey: storeKeys.all,
        refetchType: "all",
      });
    },
  });
}

/**
 * Store configuration input
 */
export interface StoreConfigurationInput {
  timezone?: string; // IANA timezone format
  location?: {
    address?: string;
    gps?: { lat: number; lng: number };
  };
  operating_hours?: {
    monday?: { open?: string; close?: string; closed?: boolean };
    tuesday?: { open?: string; close?: string; closed?: boolean };
    wednesday?: { open?: string; close?: string; closed?: boolean };
    thursday?: { open?: string; close?: string; closed?: boolean };
    friday?: { open?: string; close?: string; closed?: boolean };
    saturday?: { open?: string; close?: string; closed?: boolean };
    sunday?: { open?: string; close?: string; closed?: boolean };
  };
}

/**
 * Update store configuration
 * @param storeId - Store UUID
 * @param config - Store configuration data
 * @returns Updated store
 */
export async function updateStoreConfiguration(
  storeId: string,
  config: StoreConfigurationInput,
): Promise<Store> {
  if (!storeId) {
    throw new Error("Store ID is required");
  }

  if (config.timezone && !validateTimezone(config.timezone)) {
    throw new Error(
      "Timezone must be in IANA format (e.g., America/New_York, Europe/London)",
    );
  }

  if (config.location) {
    validateLocationJson(config.location);
  }

  const response = await apiClient.put<Store>(
    `/api/stores/${storeId}/configuration`,
    config,
  );
  return response.data;
}

/**
 * Hook to update store configuration
 * @returns TanStack Query mutation for updating store configuration
 */
export function useUpdateStoreConfiguration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      storeId,
      config,
    }: {
      storeId: string;
      config: StoreConfigurationInput;
    }) => updateStoreConfiguration(storeId, config),
    onSuccess: () => {
      // Invalidate ALL store queries to ensure lists and details refresh
      queryClient.invalidateQueries({
        queryKey: storeKeys.all,
        refetchType: "all",
      });
    },
  });
}

/**
 * Hook to delete a store
 * @returns TanStack Query mutation for deleting a store
 */
export function useDeleteStore() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      storeId,
      companyId,
    }: {
      storeId: string;
      companyId: string;
    }) => deleteStore(storeId),
    onSuccess: () => {
      // Invalidate ALL store queries to ensure lists refresh
      queryClient.invalidateQueries({
        queryKey: storeKeys.all,
        refetchType: "all",
      });
    },
  });
}

/**
 * Terminal with active shift status and connection configuration
 * Story 4.82: Terminal Connection Configuration UI
 */
export interface TerminalWithStatus {
  pos_terminal_id: string;
  store_id: string;
  name: string;
  device_id: string | null;
  deleted_at: string | null;
  has_active_shift: boolean;
  /** Cashier name when there's an active shift on this terminal */
  active_shift_cashier_name: string | null;
  created_at: string;
  updated_at: string;
  // Connection fields (Story 4.82)
  connection_type?: "NETWORK" | "API" | "WEBHOOK" | "FILE" | "MANUAL";
  connection_config?: Record<string, unknown> | null;
  vendor_type?:
    | "GENERIC"
    | "SQUARE"
    | "CLOVER"
    | "TOAST"
    | "LIGHTSPEED"
    | "CUSTOM";
  terminal_status?: "ACTIVE" | "INACTIVE" | "PENDING" | "ERROR";
  last_sync_at?: string | null;
  sync_status?: "NEVER" | "SUCCESS" | "FAILED" | "IN_PROGRESS";
}

/**
 * Get terminals for a store with active shift status
 * Story 4.8: Cashier Shift Start Flow
 * @param storeId - Store UUID
 * @returns Array of terminals with has_active_shift boolean flag
 */
export async function getStoreTerminals(
  storeId: string,
): Promise<TerminalWithStatus[]> {
  if (!storeId) {
    throw new Error("Store ID is required");
  }

  const response = await apiClient.get<TerminalWithStatus[]>(
    `/api/stores/${storeId}/terminals`,
  );
  return response.data;
}

/**
 * Hook to fetch terminals for a store
 * Story 4.8: Cashier Shift Start Flow
 * @param storeId - Store UUID
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with terminals data
 */
export function useStoreTerminals(
  storeId: string | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: [...storeKeys.details(), storeId || "", "terminals"],
    queryFn: () => getStoreTerminals(storeId!),
    enabled: options?.enabled !== false && !!storeId,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}

/**
 * Terminal entity type
 */
export interface Terminal {
  pos_terminal_id: string;
  store_id: string;
  name: string;
  device_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Create terminal input
 * Story 4.82: Terminal Connection Configuration UI
 */
export interface CreateTerminalInput {
  name: string;
  device_id?: string;
  connection_type?: "NETWORK" | "API" | "WEBHOOK" | "FILE" | "MANUAL";
  connection_config?: Record<string, unknown> | null;
  vendor_type?:
    | "GENERIC"
    | "SQUARE"
    | "CLOVER"
    | "TOAST"
    | "LIGHTSPEED"
    | "CUSTOM";
}

/**
 * Update terminal input
 * Story 4.82: Terminal Connection Configuration UI
 */
export interface UpdateTerminalInput {
  name?: string;
  device_id?: string;
  connection_type?: "NETWORK" | "API" | "WEBHOOK" | "FILE" | "MANUAL";
  connection_config?: Record<string, unknown> | null;
  vendor_type?:
    | "GENERIC"
    | "SQUARE"
    | "CLOVER"
    | "TOAST"
    | "LIGHTSPEED"
    | "CUSTOM";
}

/**
 * Create a new terminal for a store
 * @param storeId - Store UUID
 * @param data - Terminal creation data
 * @returns Created terminal
 */
export async function createTerminal(
  storeId: string,
  data: CreateTerminalInput,
): Promise<Terminal> {
  if (!storeId) {
    throw new Error("Store ID is required");
  }

  if (!data.name || data.name.trim().length === 0) {
    throw new Error("Terminal name is required");
  }

  if (data.name.length > 100) {
    throw new Error("Terminal name must be 100 characters or less");
  }

  const response = await apiClient.post<Terminal>(
    `/api/stores/${storeId}/terminals`,
    data,
  );
  return response.data;
}

/**
 * Update a terminal
 * @param storeId - Store UUID
 * @param terminalId - Terminal UUID
 * @param data - Terminal update data
 * @returns Updated terminal
 */
export async function updateTerminal(
  storeId: string,
  terminalId: string,
  data: UpdateTerminalInput,
): Promise<Terminal> {
  if (!storeId) {
    throw new Error("Store ID is required");
  }

  if (!terminalId) {
    throw new Error("Terminal ID is required");
  }

  if (data.name !== undefined && data.name.trim().length === 0) {
    throw new Error("Terminal name cannot be empty");
  }

  if (data.name !== undefined && data.name.length > 100) {
    throw new Error("Terminal name must be 100 characters or less");
  }

  const response = await apiClient.put<Terminal>(
    `/api/stores/${storeId}/terminals/${terminalId}`,
    data,
  );
  return response.data;
}

/**
 * Delete a terminal
 * @param storeId - Store UUID
 * @param terminalId - Terminal UUID
 */
export async function deleteTerminal(
  storeId: string,
  terminalId: string,
): Promise<void> {
  if (!storeId) {
    throw new Error("Store ID is required");
  }

  if (!terminalId) {
    throw new Error("Terminal ID is required");
  }

  await apiClient.delete(`/api/stores/${storeId}/terminals/${terminalId}`);
}

/**
 * Hook to create a terminal
 * @returns Mutation for creating a terminal
 */
export function useCreateTerminal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      storeId,
      data,
    }: {
      storeId: string;
      data: CreateTerminalInput;
    }) => createTerminal(storeId, data),
    onSuccess: (_, variables) => {
      // Invalidate terminals query for the store
      queryClient.invalidateQueries({
        queryKey: [...storeKeys.details(), variables.storeId, "terminals"],
        refetchType: "all",
      });
      // Also invalidate store details to refresh terminal count if needed
      queryClient.invalidateQueries({
        queryKey: storeKeys.detail(variables.storeId),
        refetchType: "all",
      });
    },
  });
}

/**
 * Hook to update a terminal
 * @returns Mutation for updating a terminal
 */
export function useUpdateTerminal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      storeId,
      terminalId,
      data,
    }: {
      storeId: string;
      terminalId: string;
      data: UpdateTerminalInput;
    }) => updateTerminal(storeId, terminalId, data),
    onSuccess: (_, variables) => {
      // Invalidate terminals query for the store
      queryClient.invalidateQueries({
        queryKey: [...storeKeys.details(), variables.storeId, "terminals"],
        refetchType: "all",
      });
    },
  });
}

/**
 * Hook to delete a terminal
 * @returns Mutation for deleting a terminal
 */
export function useDeleteTerminal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      storeId,
      terminalId,
    }: {
      storeId: string;
      terminalId: string;
    }) => deleteTerminal(storeId, terminalId),
    onSuccess: (_, variables) => {
      // Invalidate terminals query for the store
      queryClient.invalidateQueries({
        queryKey: [...storeKeys.details(), variables.storeId, "terminals"],
        refetchType: "all",
      });
      // Also invalidate store details to refresh terminal count if needed
      queryClient.invalidateQueries({
        queryKey: storeKeys.detail(variables.storeId),
        refetchType: "all",
      });
    },
  });
}

// ============ Store Login API Functions ============

/**
 * Get store login credential
 * @param storeId - Store UUID
 * @returns Store login info or null if no login credential exists
 */
export async function getStoreLogin(
  storeId: string,
): Promise<StoreLogin | null> {
  if (!storeId) {
    throw new Error("Store ID is required");
  }

  try {
    const response = await apiClient.get<StoreLogin>(
      `/api/stores/${storeId}/login`,
    );
    return response.data;
  } catch (error: any) {
    // Return null if no login found (404)
    if (error.message?.includes("does not have a login")) {
      return null;
    }
    throw error;
  }
}

/**
 * @deprecated Use getStoreLogin instead
 */
export const getStoreManager = getStoreLogin;

/**
 * Create store login credential
 * @param storeId - Store UUID
 * @param data - Login creation data (email, password)
 * @returns Created login info
 */
export async function createStoreLogin(
  storeId: string,
  data: { email: string; password: string },
): Promise<StoreLogin> {
  if (!storeId) {
    throw new Error("Store ID is required");
  }

  if (!data.email || data.email.trim().length === 0) {
    throw new Error("Email is required");
  }

  if (!data.password || data.password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  const response = await apiClient.post<StoreLogin>(
    `/api/stores/${storeId}/login`,
    data,
  );
  return response.data;
}

/**
 * @deprecated Use createStoreLogin instead
 */
export const createStoreManager = createStoreLogin;

/**
 * Update store login credential
 * @param storeId - Store UUID
 * @param data - Login update data (email and/or password)
 * @returns Updated login info
 */
export async function updateStoreLogin(
  storeId: string,
  data: { email?: string; password?: string },
): Promise<StoreLogin> {
  if (!storeId) {
    throw new Error("Store ID is required");
  }

  if (!data.email && !data.password) {
    throw new Error("At least one of email or password must be provided");
  }

  const response = await apiClient.put<StoreLogin>(
    `/api/stores/${storeId}/login`,
    data,
  );
  return response.data;
}

/**
 * @deprecated Use updateStoreLogin instead
 */
export const updateStoreManager = updateStoreLogin;

/**
 * Hook to fetch store login credential
 * @param storeId - Store UUID
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with login data
 */
export function useStoreLogin(
  storeId: string | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: [...storeKeys.details(), storeId || "", "login"],
    queryFn: () => getStoreLogin(storeId!),
    enabled: options?.enabled !== false && !!storeId,
    refetchOnMount: true,
  });
}

/**
 * @deprecated Use useStoreLogin instead
 */
export const useStoreManager = useStoreLogin;

/**
 * Hook to create store login credential
 * @returns Mutation for creating store login
 */
export function useCreateStoreLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      storeId,
      data,
    }: {
      storeId: string;
      data: { email: string; password: string };
    }) => createStoreLogin(storeId, data),
    onSuccess: (_, variables) => {
      // Invalidate login query
      queryClient.invalidateQueries({
        queryKey: [...storeKeys.details(), variables.storeId, "login"],
        refetchType: "all",
      });
      // Also invalidate store details
      queryClient.invalidateQueries({
        queryKey: storeKeys.detail(variables.storeId),
        refetchType: "all",
      });
    },
  });
}

/**
 * @deprecated Use useCreateStoreLogin instead
 */
export const useCreateStoreManager = useCreateStoreLogin;

/**
 * Hook to update store login credential
 * @returns Mutation for updating store login
 */
export function useUpdateStoreLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      storeId,
      data,
    }: {
      storeId: string;
      data: { email?: string; password?: string };
    }) => updateStoreLogin(storeId, data),
    onSuccess: (_, variables) => {
      // Invalidate login query
      queryClient.invalidateQueries({
        queryKey: [...storeKeys.details(), variables.storeId, "login"],
        refetchType: "all",
      });
    },
  });
}

/**
 * @deprecated Use useUpdateStoreLogin instead
 */
export const useUpdateStoreManager = useUpdateStoreLogin;

// ============ Extended Store Creation with Login and Terminals ============

/**
 * Create a new store with optional store login and terminals
 * @param companyId - Company UUID
 * @param data - Extended store creation data
 * @returns Created store with login and terminals
 */
export async function createStoreWithLogin(
  companyId: string,
  data: CreateStoreWithLoginInput,
): Promise<CreateStoreWithLoginResponse> {
  if (!companyId) {
    throw new Error("Company ID is required");
  }

  if (!data.name || data.name.trim().length === 0) {
    throw new Error("Store name is required");
  }

  if (data.name.length > 255) {
    throw new Error("Store name must be 255 characters or less");
  }

  if (data.timezone && !validateTimezone(data.timezone)) {
    throw new Error(
      "Timezone must be in IANA format (e.g., America/New_York, Europe/London)",
    );
  }

  if (data.location_json) {
    validateLocationJson(data.location_json);
  }

  const response = await apiClient.post<CreateStoreWithLoginResponse>(
    `/api/companies/${companyId}/stores`,
    data,
  );
  return response.data;
}

/**
 * @deprecated Use createStoreWithLogin instead
 */
export const createStoreWithManager = createStoreWithLogin;

/**
 * Hook to create a new store with optional store login and terminals
 * @returns TanStack Query mutation for creating a store with login
 */
export function useCreateStoreWithLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      companyId,
      data,
    }: {
      companyId: string;
      data: CreateStoreWithLoginInput;
    }) => createStoreWithLogin(companyId, data),
    onSuccess: () => {
      // Invalidate ALL store queries to ensure lists refresh
      queryClient.invalidateQueries({
        queryKey: storeKeys.all,
        refetchType: "all",
      });
    },
  });
}

/**
 * @deprecated Use useCreateStoreWithLogin instead
 */
export const useCreateStoreWithManager = useCreateStoreWithLogin;
