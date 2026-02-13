/**
 * POS Connection Type Hook
 *
 * Provides a React hook to check the store's POS connection type.
 * Used to determine if manual shift operations should be available.
 *
 * @module renderer/hooks/usePOSConnectionType
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { settingsAPI, type POSConnectionType, type POSSystemType } from '../lib/api/ipc-client';

// ============================================================================
// Query Keys
// ============================================================================

/**
 * Query key factory for POS connection type
 */
export const posConnectionTypeKeys = {
  all: ['settings', 'posConnectionType'] as const,
};

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to get the current POS connection type
 *
 * @returns Query result with connectionType
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { data, isLoading } = usePOSConnectionType();
 *   const isManual = data?.connectionType === 'MANUAL';
 *   // ...
 * }
 * ```
 */
export function usePOSConnectionType() {
  return useQuery({
    queryKey: posConnectionTypeKeys.all,
    queryFn: () => settingsAPI.getPOSConnectionType(),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes - connection type rarely changes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  });
}

/**
 * Hook to check if the store is in MANUAL mode
 *
 * @returns true if the store's POS connection type is MANUAL
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isManualMode = useIsManualMode();
 *   if (isManualMode) {
 *     // Show manual shift controls
 *   }
 * }
 * ```
 */
export function useIsManualMode(): boolean {
  const { data } = usePOSConnectionType();
  return data?.connectionType === 'MANUAL';
}

/**
 * Hook to check if the store is in LOTTERY mode
 *
 * Used to conditionally hide non-lottery features (Terminals, Shifts, Clock In/Out, Transactions)
 * in lottery-only store configurations.
 *
 * @returns true if the store's POS system type is LOTTERY
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isLotteryMode = useIsLotteryMode();
 *   if (isLotteryMode) {
 *     // Hide non-lottery features
 *   }
 * }
 * ```
 */
export function useIsLotteryMode(): boolean {
  const { data } = usePOSConnectionType();
  return data?.posType === 'LOTTERY';
}

/**
 * Export types for convenience
 */
export type { POSConnectionType, POSSystemType };
