/**
 * Client Dashboard API - Electron IPC Version
 *
 * Provides functions for interacting with the local Electron main process
 * via IPC instead of HTTP calls to a remote server.
 *
 * For the standalone Electron app, all data comes from the local SQLite database
 * accessed through IPC handlers in the main process.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Company status values
 */
export type CompanyStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING';

/**
 * Store status values
 */
export type StoreStatus = 'ACTIVE' | 'INACTIVE' | 'CLOSED';

/**
 * Owned company entity for client dashboard
 */
export interface OwnedCompany {
  company_id: string;
  name: string;
  address: string | null;
  status: CompanyStatus;
  created_at: string;
  store_count: number;
}

/**
 * Owned store entity for client dashboard
 */
export interface OwnedStore {
  store_id: string;
  company_id: string;
  company_name: string;
  name: string;
  location_json: {
    address?: string;
    gps?: { lat: number; lng: number };
  } | null;
  timezone: string;
  status: StoreStatus;
  created_at: string;
}

/**
 * Dashboard statistics
 */
export interface DashboardStats {
  total_companies: number;
  total_stores: number;
  active_stores: number;
  total_employees: number;
  today_transactions: number;
}

/**
 * Today's sales data from DaySummary
 * When today has no data, returns the most recent available date's data
 */
export interface TodaySalesData {
  fuel_sales: number;
  fuel_gallons: number;
  net_sales: number;
  gross_sales: number;
  tax_collected: number;
  lottery_sales: number | null;
  lottery_net: number | null;
  transaction_count: number;
  avg_transaction: number;
  /** The actual business date of the data (may differ from today if no data for today) */
  business_date: string | null;
}

/**
 * Daily sales data for trend charts
 */
export interface DailySalesData {
  date: string;
  fuel_sales: number;
  net_sales: number;
  gross_sales: number;
  lottery_sales: number | null;
  tax_collected: number;
}

/**
 * Sales data response from /api/client/dashboard/sales
 */
export interface SalesDataResponse {
  today: TodaySalesData;
  week: DailySalesData[];
}

/**
 * Client dashboard response
 */
export interface ClientDashboardResponse {
  user: {
    id: string;
    email: string;
    name: string;
  };
  companies: OwnedCompany[];
  stores: OwnedStore[];
  stats: DashboardStats;
}

/**
 * Check if running in Electron environment with IPC available
 * electronAPI provides the generic invoke() method for IPC calls
 */
const hasIPC = typeof window !== 'undefined' && window.electronAPI !== undefined;

/**
 * Get client dashboard data
 * In Electron, returns local data from the main process via IPC
 * @returns Client dashboard data
 */
export async function getClientDashboard(): Promise<ClientDashboardResponse> {
  if (hasIPC) {
    // In Electron, we call IPC to get dashboard stats and store info
    const [stats, storeInfoResult] = await Promise.all([
      window.electronAPI.invoke<{ activeShifts?: number; todayTransactions?: number }>(
        'dashboard:getStats'
      ),
      window.electronAPI.invoke<{
        store_id?: string;
        company_id?: string;
        name?: string;
        timezone?: string;
        status?: string;
        error?: string; // Error response shape
      }>('stores:getInfo'),
    ]);

    // Build stores array from store info (handler returns snake_case fields)
    // Check for error response (has 'error' property) or missing store_id
    const storeInfo = storeInfoResult?.error ? null : storeInfoResult;
    const stores: OwnedStore[] = storeInfo?.store_id
      ? [
          {
            store_id: storeInfo.store_id,
            company_id: storeInfo.company_id || 'local-company',
            company_name: 'Local Company',
            name: storeInfo.name || 'Store',
            location_json: null,
            timezone: storeInfo.timezone || 'America/Chicago',
            status: (storeInfo.status as StoreStatus) || 'ACTIVE',
            created_at: new Date().toISOString(),
          },
        ]
      : [];

    return {
      user: {
        id: 'local-user',
        email: 'operator@store.local',
        name: 'Store Operator',
      },
      companies: [],
      stores,
      stats: {
        total_companies: 1,
        total_stores: stores.length,
        active_stores: stores.length,
        total_employees: stats?.activeShifts || 0,
        today_transactions: stats?.todayTransactions || 0,
      },
    };
  }

  // In development without Electron, return mock data
  return {
    user: {
      id: 'dev-user',
      email: 'dev@test.local',
      name: 'Development User',
    },
    companies: [],
    stores: [
      {
        store_id: 'dev-store',
        company_id: 'dev-company',
        company_name: 'Development Company',
        name: 'Development Store',
        location_json: null,
        timezone: 'America/Chicago',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
      },
    ],
    stats: {
      total_companies: 1,
      total_stores: 1,
      active_stores: 1,
      total_employees: 3,
      today_transactions: 42,
    },
  };
}

/**
 * Get stores for a specific owned company
 * @param companyId - Company UUID (must be owned by current user)
 * @returns List of stores for the company
 */
export async function getOwnedCompanyStores(companyId: string): Promise<OwnedStore[]> {
  if (!companyId) {
    throw new Error('Company ID is required');
  }

  // Return empty array for Electron standalone app
  return [];
}

/**
 * Get company details for an owned company
 * @param companyId - Company UUID (must be owned by current user)
 * @returns Company details
 */
export async function getOwnedCompany(companyId: string): Promise<OwnedCompany> {
  if (!companyId) {
    throw new Error('Company ID is required');
  }

  // Return mock company for Electron standalone app
  return {
    company_id: companyId,
    name: 'Local Company',
    address: null,
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    store_count: 1,
  };
}

/**
 * Get store details for an owned store
 * @param storeId - Store UUID (must be in a company owned by current user)
 * @returns Store details
 */
export async function getOwnedStore(storeId: string): Promise<OwnedStore> {
  if (!storeId) {
    throw new Error('Store ID is required');
  }

  // Return mock store for Electron standalone app
  return {
    store_id: storeId,
    company_id: 'local-company',
    company_name: 'Local Company',
    name: 'Local Store',
    location_json: null,
    timezone: 'America/Chicago',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
  };
}

// ============ TanStack Query Hooks ============

/**
 * Get dashboard sales data (today + 7-day trend)
 * Returns fuel sales, net sales, lottery, and transaction metrics
 * @returns Sales data for dashboard KPI cards
 */
export async function getDashboardSales(): Promise<SalesDataResponse> {
  if (hasIPC) {
    // Get today's sales from IPC
    const todaySales = await window.electronAPI.invoke('dashboard:getTodaySales');
    const weeklySales = await window.electronAPI.invoke('dashboard:getWeeklySales');

    return {
      today: (todaySales as TodaySalesData) || {
        fuel_sales: 0,
        fuel_gallons: 0,
        net_sales: 0,
        gross_sales: 0,
        tax_collected: 0,
        lottery_sales: null,
        lottery_net: null,
        transaction_count: 0,
        avg_transaction: 0,
        business_date: null,
      },
      week: (weeklySales as DailySalesData[]) || [],
    };
  }

  // Mock data for development
  return {
    today: {
      fuel_sales: 2450.5,
      fuel_gallons: 785.5,
      net_sales: 1847.25,
      gross_sales: 1956.8,
      tax_collected: 109.55,
      lottery_sales: 425.0,
      lottery_net: 34.0,
      transaction_count: 78,
      avg_transaction: 24.95,
      business_date: new Date().toISOString().split('T')[0],
    },
    week: [],
  };
}

/**
 * Query key factory for client dashboard queries
 */
export const clientDashboardKeys = {
  all: ['client-dashboard'] as const,
  dashboard: () => [...clientDashboardKeys.all, 'dashboard'] as const,
  sales: () => [...clientDashboardKeys.all, 'sales'] as const,
  companies: () => [...clientDashboardKeys.all, 'companies'] as const,
  company: (id: string) => [...clientDashboardKeys.companies(), id] as const,
  stores: () => [...clientDashboardKeys.all, 'stores'] as const,
  companyStores: (companyId: string) =>
    [...clientDashboardKeys.stores(), 'company', companyId] as const,
  store: (id: string) => [...clientDashboardKeys.stores(), id] as const,
};

// Dashboard refresh interval: 5 minutes (300,000ms)
const DASHBOARD_REFETCH_INTERVAL = 5 * 60 * 1000;

/**
 * Hook to fetch client dashboard data
 * Returns user info, owned companies, stores, and stats
 * Auto-refreshes every 5 minutes for near real-time updates
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with dashboard data
 */
export function useClientDashboard(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: clientDashboardKeys.dashboard(),
    queryFn: getClientDashboard,
    enabled: options?.enabled !== false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false, // Disable for Electron
    staleTime: 60000, // Consider data fresh for 1 minute
    refetchInterval: DASHBOARD_REFETCH_INTERVAL, // Auto-refresh every 5 minutes
  });
}

/**
 * Hook to fetch dashboard sales data (today + 7-day trend)
 * Returns fuel sales, net sales, lottery, and transaction metrics
 * Auto-refreshes every 5 minutes for near real-time updates
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with sales data
 */
export function useDashboardSales(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: clientDashboardKeys.sales(),
    queryFn: getDashboardSales,
    enabled: options?.enabled !== false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false, // Disable for Electron
    staleTime: 60000, // Consider data fresh for 1 minute
    refetchInterval: DASHBOARD_REFETCH_INTERVAL, // Auto-refresh every 5 minutes
  });
}

/**
 * Hook to fetch stores for a specific owned company
 * @param companyId - Company UUID
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with stores data
 */
export function useOwnedCompanyStores(
  companyId: string | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: clientDashboardKeys.companyStores(companyId || ''),
    queryFn: () => getOwnedCompanyStores(companyId!),
    enabled: options?.enabled !== false && !!companyId,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false, // Disable for Electron
  });
}

/**
 * Hook to fetch owned company details
 * @param companyId - Company UUID
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with company data
 */
export function useOwnedCompany(companyId: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: clientDashboardKeys.company(companyId || ''),
    queryFn: () => getOwnedCompany(companyId!),
    enabled: options?.enabled !== false && !!companyId,
  });
}

/**
 * Hook to fetch owned store details
 * @param storeId - Store UUID
 * @param options - Query options (enabled, etc.)
 * @returns TanStack Query result with store data
 */
export function useOwnedStore(storeId: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: clientDashboardKeys.store(storeId || ''),
    queryFn: () => getOwnedStore(storeId!),
    enabled: options?.enabled !== false && !!storeId,
  });
}

/**
 * Hook to invalidate client dashboard queries
 * Useful after mutations that affect dashboard data
 */
export function useInvalidateClientDashboard() {
  const queryClient = useQueryClient();

  return {
    invalidateDashboard: () =>
      queryClient.invalidateQueries({
        queryKey: clientDashboardKeys.dashboard(),
      }),
    invalidateAll: () =>
      queryClient.invalidateQueries({
        queryKey: clientDashboardKeys.all,
      }),
  };
}
