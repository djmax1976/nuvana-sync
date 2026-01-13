/**
 * Dashboard Query Hooks
 *
 * TanStack Query hooks for dashboard data.
 * Uses IPC transport to fetch data from main process.
 *
 * @module renderer/lib/hooks/useDashboard
 */

import { useQuery } from '@tanstack/react-query';
import {
  ipc,
  type DashboardStatsResponse,
  type TodaySalesResponse,
  type WeeklySalesResponse,
} from '../transport';

// ============================================================================
// Query Keys
// ============================================================================

export const dashboardKeys = {
  all: ['dashboard'] as const,
  stats: () => [...dashboardKeys.all, 'stats'] as const,
  todaySales: () => [...dashboardKeys.all, 'todaySales'] as const,
  weeklySales: () => [...dashboardKeys.all, 'weeklySales'] as const,
};

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to fetch dashboard statistics
 */
export function useDashboardStats(options?: { enabled?: boolean }) {
  return useQuery<DashboardStatsResponse>({
    queryKey: dashboardKeys.stats(),
    queryFn: () => ipc.dashboard.getStats(),
    enabled: options?.enabled !== false,
    staleTime: 30000, // 30 seconds
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to fetch today's sales with hourly breakdown
 */
export function useTodaySales(options?: { enabled?: boolean }) {
  return useQuery<TodaySalesResponse>({
    queryKey: dashboardKeys.todaySales(),
    queryFn: () => ipc.dashboard.getTodaySales(),
    enabled: options?.enabled !== false,
    staleTime: 60000, // 1 minute
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to fetch weekly sales trend
 */
export function useWeeklySales(options?: { enabled?: boolean }) {
  return useQuery<WeeklySalesResponse>({
    queryKey: dashboardKeys.weeklySales(),
    queryFn: () => ipc.dashboard.getWeeklySales(),
    enabled: options?.enabled !== false,
    staleTime: 300000, // 5 minutes
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}
