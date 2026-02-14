/**
 * Local IPC Terminal Hooks
 *
 * TanStack Query hooks for terminal/register data via local IPC transport.
 * These hooks query the local SQLite database directly without cloud API.
 *
 * Story: DayClosePage Local IPC Migration
 *
 * @module renderer/hooks/useLocalTerminals
 * @security DB-006: All queries are store-scoped via backend handlers
 * @security SEC-006: All queries use parameterized statements in backend
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { ipc, type TerminalListResponse, type RegisterWithShiftStatus } from '../lib/transport';

// ============================================================================
// Query Keys
// ============================================================================

/**
 * Query key factory for local terminal queries
 * Namespaced under 'local' to avoid collision with cloud API hooks
 */
export const localTerminalsKeys = {
  all: ['local', 'terminals'] as const,
  list: () => [...localTerminalsKeys.all, 'list'] as const,
};

// ============================================================================
// Types
// ============================================================================

/**
 * Terminal info for dropdowns and name resolution
 * Simplified from full RegisterWithShiftStatus
 */
export interface LocalTerminal {
  /** Internal terminal mapping ID */
  id: string;
  /** External register ID from POS system */
  external_register_id: string;
  /** User-friendly description/name */
  name: string;
  /** Whether the register is active */
  active: boolean;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to fetch terminals/registers via local IPC
 *
 * Used by DayClosePage for:
 * - Terminal dropdown selection
 * - Resolving terminal names from register IDs
 *
 * Returns memoized array to prevent unnecessary re-renders.
 *
 * @security DB-006: Store-scoped via backend handler (getConfiguredStore)
 * @security SEC-006: Parameterized queries in backend DAL
 * @performance PERF-002: Memoized transformation to stable reference
 *
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with terminals array
 *
 * @example
 * ```tsx
 * const { data: terminals, isLoading } = useLocalTerminals();
 *
 * // Find terminal name by external register ID
 * const terminalName = terminals?.find(
 *   t => t.external_register_id === registerId
 * )?.name ?? 'Unknown';
 * ```
 */
export function useLocalTerminals(options?: { enabled?: boolean }) {
  // Transform data using select - TanStack Query handles memoization internally
  // PERF-002: Stable reference for consumers (select only re-runs when data changes)
  const selectTerminals = useCallback(
    (response: TerminalListResponse): LocalTerminal[] | undefined => {
      if (!response?.registers) {
        return undefined;
      }
      return response.registers.map(
        (register: RegisterWithShiftStatus): LocalTerminal => ({
          id: register.id,
          external_register_id: register.external_register_id,
          name: register.description ?? `Register ${register.external_register_id}`,
          active: register.active,
        })
      );
    },
    []
  );

  return useQuery({
    queryKey: localTerminalsKeys.list(),
    queryFn: async (): Promise<TerminalListResponse> => {
      const response = await ipc.terminals.list();
      return response;
    },
    select: selectTerminals,
    enabled: options?.enabled !== false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 60000, // Terminals change infrequently - 1 minute stale time
    retry: 2,
  });
}

/**
 * Hook to find a terminal by external register ID
 *
 * Convenience wrapper around useLocalTerminals for name resolution.
 *
 * @param externalRegisterId - The external register ID to look up
 * @param options - Query options (enabled, etc.)
 * @returns The matching terminal or undefined
 */
export function useTerminalByRegisterId(
  externalRegisterId: string | null | undefined,
  options?: { enabled?: boolean }
) {
  const { data: terminals, ...rest } = useLocalTerminals({
    enabled: options?.enabled !== false && !!externalRegisterId,
  });

  const terminal = useMemo(() => {
    if (!terminals || !externalRegisterId) return undefined;
    return terminals.find((t) => t.external_register_id === externalRegisterId);
  }, [terminals, externalRegisterId]);

  return {
    ...rest,
    data: terminal,
  };
}
