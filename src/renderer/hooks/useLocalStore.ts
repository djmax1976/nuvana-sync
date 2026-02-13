/**
 * Local IPC Store Hooks
 *
 * TanStack Query hooks for store configuration via local IPC transport.
 * These hooks query the local SQLite database directly without cloud API.
 *
 * Story: DayClosePage Local IPC Migration
 *
 * @module renderer/hooks/useLocalStore
 * @security DB-006: Returns only the configured store for this terminal
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { ipc, type ConfiguredStoreResponse } from '../lib/transport';

// ============================================================================
// Query Keys
// ============================================================================

/**
 * Query key factory for local store queries
 * Namespaced under 'local' to avoid collision with cloud API hooks
 */
export const localStoreKeys = {
  all: ['local', 'store'] as const,
  configured: () => [...localStoreKeys.all, 'configured'] as const,
};

// ============================================================================
// Types
// ============================================================================

/**
 * Configured store data for DayClosePage context
 * Minimal data - just ID and name
 */
export interface LocalStoreData {
  /** Store ID (UUID) */
  store_id: string;
  /** Store name for display */
  name: string;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to get the configured store via local IPC
 *
 * Used by DayClosePage to:
 * - Get the current store context
 * - Display store name in UI
 * - Pass store_id to other operations
 *
 * This hook replaces useClientDashboard for local-only operation.
 * The store configuration is loaded from the local settings file.
 *
 * @security DB-006: Returns only the configured store for this terminal
 *
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with store data
 *
 * @example
 * ```tsx
 * const { data: store, isLoading, error } = useLocalStore();
 *
 * if (store) {
 *   console.log(`Operating at: ${store.name}`);
 *   // Use store.store_id for other operations
 * }
 * ```
 */
export function useLocalStore(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: localStoreKeys.configured(),
    queryFn: async (): Promise<LocalStoreData> => {
      const response: ConfiguredStoreResponse = await ipc.store.getConfigured();
      return {
        store_id: response.store_id,
        name: response.name,
      };
    },
    enabled: options?.enabled !== false,
    refetchOnMount: false, // Store config rarely changes
    refetchOnWindowFocus: false,
    staleTime: Infinity, // Store config is stable during session
    gcTime: Infinity, // Keep in cache for entire session (renamed from cacheTime)
    retry: 2,
  });
}
