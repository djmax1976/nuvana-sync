/**
 * Dashboard IPC Handlers
 *
 * Provides dashboard statistics and analytics endpoints.
 * All data is read-only and aggregated from local database.
 *
 * @module main/ipc/dashboard
 * @security DB-006: Store-scoped queries for tenant isolation
 * @security SEC-006: All queries use prepared statements
 */

import { registerHandler, createErrorResponse, IPCErrorCodes } from './index';
import { storesDAL } from '../dal/stores.dal';
import { shiftsDAL } from '../dal/shifts.dal';
import { daySummariesDAL } from '../dal/day-summaries.dal';
import { transactionsDAL } from '../dal/transactions.dal';
import { syncQueueDAL } from '../dal/sync-queue.dal';
import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

interface DashboardStats {
  todaySales: number;
  todayTransactions: number;
  openShiftCount: number;
  pendingSyncCount: number;
  storeStatus: string;
}

interface HourlyData {
  hour: number;
  sales: number;
  transactions: number;
}

interface TodaySalesResponse {
  hourlyBreakdown: HourlyData[];
  totalSales: number;
  totalTransactions: number;
  businessDate: string;
}

interface DailyData {
  date: string;
  sales: number;
  transactions: number;
}

interface WeeklySalesResponse {
  dailyData: DailyData[];
  totalSales: number;
  totalTransactions: number;
}

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('dashboard-handlers');

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get today's business date in YYYY-MM-DD format
 * Uses store timezone if available
 */
function getTodayBusinessDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get dates for the last N days (including today)
 * @param days - Number of days to include
 * @returns Array of date strings in YYYY-MM-DD format
 */
function getLastNDays(days: number): string[] {
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    dates.push(date.toISOString().split('T')[0]);
  }
  return dates;
}

// ============================================================================
// Dashboard Statistics Handler
// ============================================================================

/**
 * Get dashboard overview statistics
 * Returns key metrics for today: sales, transactions, open shifts, pending sync
 */
registerHandler<DashboardStats | ReturnType<typeof createErrorResponse>>(
  'dashboard:getStats',
  async () => {
    // DB-006: Get configured store for tenant scoping
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      log.warn('Dashboard stats requested but store not configured');
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const today = getTodayBusinessDate();

    try {
      // Get today's summary (creates one if doesn't exist for consistent UX)
      const todaySummary = daySummariesDAL.findByDate(store.store_id, today);

      // DB-006: Store-scoped queries for all data
      const openShifts = shiftsDAL
        .findByDate(store.store_id, today)
        .filter((s) => s.status === 'OPEN');

      // Get pending sync count for this store
      const pendingSync = syncQueueDAL.getPendingCount(store.store_id);

      const stats: DashboardStats = {
        todaySales: todaySummary?.gross_sales ?? 0,
        todayTransactions: todaySummary?.transaction_count ?? 0,
        openShiftCount: openShifts.length,
        pendingSyncCount: pendingSync,
        storeStatus: store.status,
      };

      log.debug('Dashboard stats retrieved', {
        storeId: store.store_id,
        todaySales: stats.todaySales,
        openShifts: stats.openShiftCount,
      });

      return stats;
    } catch (error) {
      log.error('Failed to get dashboard stats', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Get dashboard overview statistics' }
);

// ============================================================================
// Today's Sales Handler
// ============================================================================

/**
 * Get today's sales breakdown with hourly data
 * Includes total sales, transaction count, and hourly breakdown
 */
registerHandler<TodaySalesResponse | ReturnType<typeof createErrorResponse>>(
  'dashboard:getTodaySales',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    const today = getTodayBusinessDate();

    try {
      // Get day summary for totals
      const daySummary = daySummariesDAL.findByDate(store.store_id, today);

      // Get all transactions for today to calculate hourly breakdown
      // DB-006: Store-scoped query
      const transactions = transactionsDAL.findByDate(store.store_id, today);

      // Calculate hourly breakdown
      // SEC-006: Data aggregation happens in application code, not dynamic SQL
      const hourlyMap = new Map<number, { sales: number; transactions: number }>();

      // Initialize all hours with zero values
      for (let hour = 0; hour < 24; hour++) {
        hourlyMap.set(hour, { sales: 0, transactions: 0 });
      }

      // Aggregate transactions by hour
      for (const txn of transactions) {
        if (txn.voided) continue; // Skip voided transactions

        if (txn.transaction_time) {
          const hour = new Date(txn.transaction_time).getHours();
          const current = hourlyMap.get(hour) ?? { sales: 0, transactions: 0 };
          current.sales += txn.total_amount;
          current.transactions += 1;
          hourlyMap.set(hour, current);
        }
      }

      // Convert to array format
      const hourlyBreakdown: HourlyData[] = Array.from(hourlyMap.entries()).map(([hour, data]) => ({
        hour,
        sales: data.sales,
        transactions: data.transactions,
      }));

      const response: TodaySalesResponse = {
        hourlyBreakdown,
        totalSales: daySummary?.gross_sales ?? 0,
        totalTransactions: daySummary?.transaction_count ?? 0,
        businessDate: today,
      };

      log.debug('Today sales retrieved', {
        storeId: store.store_id,
        totalSales: response.totalSales,
        transactionCount: transactions.length,
      });

      return response;
    } catch (error) {
      log.error('Failed to get today sales', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Get today sales breakdown with hourly data' }
);

// ============================================================================
// Weekly Sales Handler
// ============================================================================

/**
 * Get weekly sales trend (last 7 days)
 * Returns daily totals for charting and trend analysis
 */
registerHandler<WeeklySalesResponse | ReturnType<typeof createErrorResponse>>(
  'dashboard:getWeeklySales',
  async () => {
    const store = storesDAL.getConfiguredStore();
    if (!store) {
      return createErrorResponse(IPCErrorCodes.NOT_CONFIGURED, 'Store not configured');
    }

    try {
      // Get last 7 days
      const dates = getLastNDays(7);

      // Build daily data array
      // DB-006: Each query is store-scoped
      const dailyData: DailyData[] = dates.map((date) => {
        const summary = daySummariesDAL.findByDate(store.store_id, date);
        return {
          date,
          sales: summary?.gross_sales ?? 0,
          transactions: summary?.transaction_count ?? 0,
        };
      });

      // Calculate totals
      const totalSales = dailyData.reduce((sum, d) => sum + d.sales, 0);
      const totalTransactions = dailyData.reduce((sum, d) => sum + d.transactions, 0);

      const response: WeeklySalesResponse = {
        dailyData,
        totalSales,
        totalTransactions,
      };

      log.debug('Weekly sales retrieved', {
        storeId: store.store_id,
        days: dates.length,
        totalSales,
      });

      return response;
    } catch (error) {
      log.error('Failed to get weekly sales', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  { description: 'Get weekly sales trend (last 7 days)' }
);
