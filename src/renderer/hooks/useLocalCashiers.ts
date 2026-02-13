/**
 * Local IPC Cashier Hooks
 *
 * TanStack Query hooks for cashier/employee data via local IPC transport.
 * These hooks query the local SQLite database directly without cloud API.
 *
 * Story: DayClosePage Local IPC Migration
 *
 * @module renderer/hooks/useLocalCashiers
 * @security DB-006: All queries are store-scoped via backend handlers
 * @security SEC-001: PIN hashes are never exposed in responses
 * @security SEC-006: All queries use parameterized statements in backend
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ipc, type CashiersListResponse, type CashierInfo } from '../lib/transport';

// ============================================================================
// Query Keys
// ============================================================================

/**
 * Query key factory for local cashier queries
 * Namespaced under 'local' to avoid collision with cloud API hooks
 */
export const localCashiersKeys = {
  all: ['local', 'cashiers'] as const,
  list: () => [...localCashiersKeys.all, 'list'] as const,
};

// ============================================================================
// Types
// ============================================================================

/**
 * Cashier info for dropdowns and name resolution
 * Mirrors CashierInfo from transport layer
 *
 * @security SEC-001: No PIN hash exposed
 */
export interface LocalCashier {
  /** User ID (UUID) */
  cashier_id: string;
  /** Display name */
  name: string;
  /** Role (cashier, shift_manager, store_manager) */
  role: string;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to fetch cashiers via local IPC
 *
 * Used by DayClosePage for:
 * - Cashier dropdown selection
 * - Resolving cashier names from IDs
 *
 * Returns memoized array to prevent unnecessary re-renders.
 * Only returns active users; inactive users are filtered by backend.
 *
 * @security DB-006: Store-scoped via backend handler (getConfiguredStore)
 * @security SEC-001: PIN hash excluded by backend handler
 * @security SEC-006: Parameterized queries in backend DAL
 * @performance PERF-002: Memoized transformation to stable reference
 *
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with cashiers array
 *
 * @example
 * ```tsx
 * const { data: cashiers, isLoading } = useLocalCashiers();
 *
 * // Find cashier name by ID
 * const cashierName = cashiers?.find(
 *   c => c.cashier_id === cashierId
 * )?.name ?? 'Unknown';
 * ```
 */
export function useLocalCashiers(options?: { enabled?: boolean }) {
  const query = useQuery({
    queryKey: localCashiersKeys.list(),
    queryFn: async (): Promise<CashiersListResponse> => {
      const response = await ipc.cashiers.list();
      return response;
    },
    enabled: options?.enabled !== false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 60000, // Cashiers change infrequently - 1 minute stale time
    retry: 2,
  });

  // Memoize the transformed array to prevent unnecessary re-renders
  // PERF-002: Stable reference for consumers
  const cashierData = query.data?.cashiers;
  const cashiers = useMemo((): LocalCashier[] | undefined => {
    if (!cashierData) {
      return undefined;
    }

    return cashierData.map(
      (cashier: CashierInfo): LocalCashier => ({
        cashier_id: cashier.cashier_id,
        name: cashier.name,
        role: cashier.role,
      })
    );
  }, [cashierData]);

  return {
    ...query,
    data: cashiers,
  };
}

/**
 * Hook to find a cashier by ID
 *
 * Convenience wrapper around useLocalCashiers for name resolution.
 *
 * @param cashierId - The cashier ID to look up
 * @param options - Query options (enabled, etc.)
 * @returns The matching cashier or undefined
 */
export function useCashierById(
  cashierId: string | null | undefined,
  options?: { enabled?: boolean }
) {
  const { data: cashiers, ...rest } = useLocalCashiers({
    enabled: options?.enabled !== false && !!cashierId,
  });

  const cashier = useMemo(() => {
    if (!cashiers || !cashierId) return undefined;
    return cashiers.find((c) => c.cashier_id === cashierId);
  }, [cashiers, cashierId]);

  return {
    ...rest,
    data: cashier,
  };
}
