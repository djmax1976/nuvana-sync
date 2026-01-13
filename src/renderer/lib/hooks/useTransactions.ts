/**
 * Transactions Query Hooks
 *
 * TanStack Query hooks for transaction data.
 * Uses IPC transport to fetch data from main process.
 *
 * @module renderer/lib/hooks/useTransactions
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ipc,
  type TransactionListParams,
  type TransactionListResponse,
  type TransactionDetailResponse,
} from '../transport';

// ============================================================================
// Query Keys
// ============================================================================

export const transactionKeys = {
  all: ['transactions'] as const,
  lists: () => [...transactionKeys.all, 'list'] as const,
  list: (params?: TransactionListParams) => [...transactionKeys.lists(), params || {}] as const,
  details: () => [...transactionKeys.all, 'detail'] as const,
  detail: (transactionId: string) => [...transactionKeys.details(), transactionId] as const,
};

// ============================================================================
// List Hooks
// ============================================================================

/**
 * Hook to fetch transactions with optional filters
 */
export function useTransactions(params?: TransactionListParams, options?: { enabled?: boolean }) {
  return useQuery<TransactionListResponse>({
    queryKey: transactionKeys.list(params),
    queryFn: () => ipc.transactions.list(params),
    enabled: options?.enabled !== false,
    staleTime: 30000, // 30 seconds
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}

// ============================================================================
// Detail Hooks
// ============================================================================

/**
 * Hook to fetch transaction by ID with line items and payments
 */
export function useTransaction(transactionId: string | null, options?: { enabled?: boolean }) {
  return useQuery<TransactionDetailResponse>({
    queryKey: transactionKeys.detail(transactionId!),
    queryFn: () => ipc.transactions.getById(transactionId!),
    enabled: options?.enabled !== false && transactionId !== null,
    staleTime: 60000, // 1 minute - transactions don't change
    refetchOnMount: true,
    refetchOnWindowFocus: false, // Don't refetch on focus since data is static
  });
}

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Hook to invalidate transaction queries
 */
export function useInvalidateTransactions() {
  const queryClient = useQueryClient();

  return {
    invalidateAll: () => queryClient.invalidateQueries({ queryKey: transactionKeys.all }),
    invalidateList: () => queryClient.invalidateQueries({ queryKey: transactionKeys.lists() }),
    invalidateDetail: (transactionId: string) =>
      queryClient.invalidateQueries({ queryKey: transactionKeys.detail(transactionId) }),
  };
}
