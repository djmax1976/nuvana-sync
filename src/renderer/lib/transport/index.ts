/**
 * Transport Abstraction Layer
 *
 * Provides a unified interface for API calls that automatically uses IPC
 * when running in Electron (local desktop app) or HTTP when in browser.
 *
 * This allows the same dashboard components and hooks to work in both:
 * - Electron desktop app (uses IPC to main process)
 * - Web browser (would use HTTP to backend - future use)
 *
 * @module renderer/lib/transport
 * @security SEC-014: Uses validated IPC channels via preload script
 */

import { ipcClient, IPCError } from '../api/ipc-client';

// ============================================================================
// Types
// ============================================================================

/**
 * Standard API response format
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: {
    code: string;
    message: string;
  };
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Transport error with code for error handling
 */
export class TransportError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(message: string, code: string = 'TRANSPORT_ERROR', status: number = 500) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
    this.status = status;
  }
}

// ============================================================================
// Transport Detection
// ============================================================================

/**
 * Check if we're running in Electron environment
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && window.electronAPI !== undefined;
}

// ============================================================================
// IPC Channel Mapping
// ============================================================================

/**
 * Maps REST-style endpoints to IPC channels
 * This allows existing API client code to work with IPC
 */
const endpointToChannel: Record<string, string> = {
  // Dashboard
  'GET /api/dashboard/stats': 'dashboard:getStats',
  'GET /api/dashboard/today-sales': 'dashboard:getTodaySales',
  'GET /api/dashboard/weekly-sales': 'dashboard:getWeeklySales',

  // Shifts
  'GET /api/shifts': 'shifts:list',
  'GET /api/shifts/:id': 'shifts:getById',
  'GET /api/shifts/:id/summary': 'shifts:getSummary',
  'GET /api/shifts/:id/lottery-summary': 'shifts:getSummary',
  'POST /api/shifts/:id/close': 'shifts:close',
  'GET /api/stores/:id/shifts/open-check': 'shifts:findOpenShifts',

  // Day Summaries
  'GET /api/day-summaries': 'daySummaries:list',
  'GET /api/day-summaries/:date': 'daySummaries:getByDate',
  'POST /api/day-summaries/:date/close': 'daySummaries:close',

  // Transactions
  'GET /api/transactions': 'transactions:list',
  'GET /api/transactions/:id': 'transactions:getById',

  // Reports
  'GET /api/reports/weekly': 'reports:weekly',
  'GET /api/reports/monthly': 'reports:monthly',
  'GET /api/reports/date-range': 'reports:dateRange',
};

/**
 * Parse endpoint pattern to extract IPC channel and parameters
 */
function matchEndpoint(
  method: string,
  url: string
): { channel: string; pathParams: Record<string, string> } | null {
  // Normalize URL (remove query string, leading slash)
  const urlPath = url.split('?')[0];

  for (const [pattern, channel] of Object.entries(endpointToChannel)) {
    const [patternMethod, patternPath] = pattern.split(' ');

    if (method.toUpperCase() !== patternMethod) continue;

    // Convert pattern to regex
    const regexPattern = patternPath.replace(/:(\w+)/g, '([^/]+)');
    const regex = new RegExp(`^${regexPattern}$`);
    const match = urlPath.match(regex);

    if (match) {
      // Extract parameter names from pattern
      const paramNames = (patternPath.match(/:(\w+)/g) || []).map((p) => p.slice(1));
      const pathParams: Record<string, string> = {};

      paramNames.forEach((name, index) => {
        pathParams[name] = match[index + 1];
      });

      return { channel, pathParams };
    }
  }

  return null;
}

// ============================================================================
// Transport Functions
// ============================================================================

/**
 * Make an API request using the appropriate transport (IPC or HTTP)
 *
 * For Electron: Routes through IPC to main process
 * For Browser: Would use HTTP fetch (not implemented yet)
 *
 * @param method - HTTP method (GET, POST, PUT, DELETE)
 * @param url - API endpoint URL
 * @param data - Request body data (for POST/PUT)
 * @param params - Query parameters
 * @returns API response
 */
export async function request<T>(
  method: string,
  url: string,
  data?: unknown,
  params?: Record<string, unknown>
): Promise<ApiResponse<T>> {
  if (isElectron()) {
    return requestViaIPC<T>(method, url, data, params);
  }

  // HTTP transport fallback (for future web version)
  throw new TransportError('HTTP transport not implemented in desktop app', 'NOT_IMPLEMENTED', 501);
}

/**
 * Make request via Electron IPC
 */
async function requestViaIPC<T>(
  method: string,
  url: string,
  data?: unknown,
  params?: Record<string, unknown>
): Promise<ApiResponse<T>> {
  const matched = matchEndpoint(method, url);

  if (!matched) {
    throw new TransportError(
      `No IPC channel mapped for: ${method} ${url}`,
      'CHANNEL_NOT_FOUND',
      404
    );
  }

  const { channel, pathParams } = matched;

  // Combine path params, query params, and body data
  const ipcArgs: unknown = {
    ...pathParams,
    ...params,
    ...(data && typeof data === 'object' ? data : {}),
  };

  try {
    const result = await ipcClient.invoke<T>(channel, ipcArgs);

    // Wrap result in standard API response format
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    if (error instanceof IPCError) {
      throw new TransportError(error.message, error.code, getStatusFromCode(error.code));
    }
    throw error;
  }
}

/**
 * Map error codes to HTTP status codes
 */
function getStatusFromCode(code: string): number {
  const statusMap: Record<string, number> = {
    NOT_FOUND: 404,
    NOT_AUTHENTICATED: 401,
    FORBIDDEN: 403,
    VALIDATION_ERROR: 400,
    NOT_CONFIGURED: 400,
    ALREADY_CLOSED: 409,
    OPEN_SHIFTS: 409,
    INTERNAL_ERROR: 500,
  };
  return statusMap[code] || 500;
}

// ============================================================================
// Direct IPC Helpers (for new code using IPC natively)
// ============================================================================

/**
 * Direct IPC invoke for components that want to use IPC directly
 * Provides better typing than going through REST-style mapping
 */
export const ipc = {
  // Dashboard
  dashboard: {
    getStats: () => ipcClient.invoke<DashboardStatsResponse>('dashboard:getStats'),
    getTodaySales: () => ipcClient.invoke<TodaySalesResponse>('dashboard:getTodaySales'),
    getWeeklySales: () => ipcClient.invoke<WeeklySalesResponse>('dashboard:getWeeklySales'),
  },

  // Employees
  employees: {
    list: () => ipcClient.invoke<EmployeeListResponse>('employees:list'),
    create: (data: CreateEmployeeRequest) =>
      ipcClient.invoke<CreateEmployeeResponse>('employees:create', data),
    update: (data: UpdateEmployeeRequest) =>
      ipcClient.invoke<UpdateEmployeeResponse>('employees:update', data),
    updatePin: (data: UpdatePinRequest) =>
      ipcClient.invoke<UpdatePinResponse>('employees:updatePin', data),
    deactivate: (userId: string) =>
      ipcClient.invoke<ToggleStatusResponse>('employees:deactivate', { userId }),
    reactivate: (userId: string) =>
      ipcClient.invoke<ToggleStatusResponse>('employees:reactivate', { userId }),
  },

  // Shifts
  shifts: {
    list: (params?: ShiftListParams) => ipcClient.invoke<ShiftListResponse>('shifts:list', params),
    getById: (shiftId: string) => ipcClient.invoke<ShiftResponse>('shifts:getById', shiftId),
    getSummary: (shiftId: string) =>
      ipcClient.invoke<ShiftSummaryResponse>('shifts:getSummary', shiftId),
    findOpenShifts: () => ipcClient.invoke<ShiftResponse[]>('shifts:findOpenShifts'),
    close: (shiftId: string) => ipcClient.invoke<ShiftResponse>('shifts:close', shiftId),
    /**
     * Get fuel data for a specific shift with inside/outside breakdown
     * Returns MSM-sourced data when available
     */
    getFuelData: (shiftId: string) =>
      ipcClient.invoke<ShiftFuelDataResponse>('shifts:getFuelData', shiftId),
    /**
     * Get daily fuel totals for a business date with inside/outside breakdown
     * Returns aggregated data from day_fuel_summaries or shift_fuel_summaries
     */
    getDailyFuelTotals: (businessDate: string) =>
      ipcClient.invoke<DailyFuelTotalsResponse>('shifts:getDailyFuelTotals', businessDate),
  },

  // Day Summaries
  daySummaries: {
    list: (params?: DaySummaryListParams) =>
      ipcClient.invoke<DaySummaryListResponse>('daySummaries:list', params),
    getByDate: (date: string) =>
      ipcClient.invoke<DaySummaryWithShiftsResponse>('daySummaries:getByDate', date),
    close: (date: string) => ipcClient.invoke<DaySummaryResponse>('daySummaries:close', date),
  },

  // Transactions
  transactions: {
    list: (params?: TransactionListParams) =>
      ipcClient.invoke<TransactionListResponse>('transactions:list', params),
    getById: (transactionId: string) =>
      ipcClient.invoke<TransactionDetailResponse>('transactions:getById', transactionId),
  },

  // Reports
  reports: {
    weekly: (weekStartDate: string) =>
      ipcClient.invoke<WeeklyReportResponse>('reports:weekly', weekStartDate),
    monthly: (params: { year: number; month: number }) =>
      ipcClient.invoke<MonthlyReportResponse>('reports:monthly', params),
    dateRange: (params: { startDate: string; endDate: string }) =>
      ipcClient.invoke<DateRangeReportResponse>('reports:dateRange', params),
  },
};

// ============================================================================
// Response Types (for direct IPC usage)
// ============================================================================

export interface DashboardStatsResponse {
  todaySales: number;
  todayTransactions: number;
  openShiftCount: number;
  pendingSyncCount: number;
  storeStatus: string;
}

export interface HourlyData {
  hour: number;
  sales: number;
  transactions: number;
}

export interface TodaySalesResponse {
  hourlyBreakdown: HourlyData[];
  totalSales: number;
  totalTransactions: number;
  businessDate: string;
}

export interface DailyData {
  date: string;
  sales: number;
  transactions: number;
}

export interface WeeklySalesResponse {
  dailyData: DailyData[];
  totalSales: number;
  totalTransactions: number;
}

export interface ShiftResponse {
  shift_id: string;
  store_id: string;
  shift_number: number;
  business_date: string;
  cashier_id: string | null;
  register_id: string | null;
  start_time: string | null;
  end_time: string | null;
  status: 'OPEN' | 'CLOSED';
  created_at: string;
  updated_at: string;
}

export interface ShiftListParams {
  startDate?: string;
  endDate?: string;
  status?: 'OPEN' | 'CLOSED';
  limit?: number;
  offset?: number;
}

export interface ShiftListResponse {
  shifts: ShiftResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface DepartmentBreakdown {
  departmentCode: string;
  departmentName: string | null;
  netSales: number;
  transactionCount: number;
}

export interface TenderBreakdown {
  tenderCode: string;
  tenderDisplayName: string | null;
  netAmount: number;
  transactionCount: number;
}

export interface FuelByGrade {
  gradeId: string;
  gradeName: string | null;
  volumeSold: number;
  amountSold: number;
}

/**
 * MSM fuel totals with inside/outside breakdown
 * Matches data from MSM (MiscellaneousSummaryMovement) files
 */
export interface MSMFuelTotals {
  totalVolume: number;
  totalAmount: number;
  totalDiscount: number;
  transactionCount: number;
  insideVolume: number;
  insideAmount: number;
  outsideVolume: number;
  outsideAmount: number;
  averagePrice: number;
}

/**
 * MSM fuel breakdown by grade with inside/outside split
 */
export interface MSMFuelByGrade {
  gradeId: string | null;
  gradeName: string | null;
  totalVolume: number;
  totalAmount: number;
  insideVolume: number;
  insideAmount: number;
  outsideVolume: number;
  outsideAmount: number;
  discountAmount: number;
  averagePrice: number;
}

/**
 * Shift fuel data response with inside/outside breakdown
 */
export interface ShiftFuelDataResponse {
  shiftId: string;
  shiftSummaryId: string | null;
  businessDate: string;
  totals: MSMFuelTotals;
  byGrade: MSMFuelByGrade[];
  hasMSMData: boolean;
}

/**
 * Daily fuel totals response with inside/outside breakdown
 */
export interface DailyFuelTotalsResponse {
  storeId: string;
  businessDate: string;
  totals: {
    totalVolume: number;
    totalAmount: number;
    totalDiscount: number;
    insideVolume: number;
    insideAmount: number;
    outsideVolume: number;
    outsideAmount: number;
    averagePrice: number;
  };
  byGrade: MSMFuelByGrade[];
  fuelSource: 'FGM' | 'MSM' | 'CALCULATED' | 'MANUAL';
}

export interface ShiftSummaryResponse {
  shift: ShiftResponse;
  transactionCount: number;
  totalSales: number;
  totalVoided: number;
  // Enhanced summary data from shift_summaries table
  grossSales?: number;
  netSales?: number;
  taxCollected?: number;
  fuelGallons?: number;
  fuelSales?: number;
  lotteryNet?: number;
  departmentBreakdown?: DepartmentBreakdown[];
  tenderBreakdown?: TenderBreakdown[];
  fuelByGrade?: FuelByGrade[];
}

export interface DaySummaryResponse {
  summary_id: string;
  store_id: string;
  business_date: string;
  total_sales: number;
  total_transactions: number;
  status: 'OPEN' | 'CLOSED';
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DaySummaryListParams {
  startDate?: string;
  endDate?: string;
  status?: 'OPEN' | 'CLOSED';
  limit?: number;
  offset?: number;
}

export interface DaySummaryListResponse {
  summaries: DaySummaryResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface DaySummaryWithShiftsResponse {
  summary: DaySummaryResponse;
  shifts: ShiftResponse[];
}

export interface TransactionResponse {
  transaction_id: string;
  store_id: string;
  shift_id: string | null;
  business_date: string;
  transaction_number: number | null;
  transaction_time: string | null;
  total_amount: number;
  voided: number;
}

export interface TransactionListParams {
  startDate?: string;
  endDate?: string;
  shiftId?: string;
  minAmount?: number;
  maxAmount?: number;
  limit?: number;
  offset?: number;
}

export interface TransactionListResponse {
  transactions: TransactionResponse[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface TransactionLineItem {
  line_item_id: string;
  line_number: number;
  item_code: string | null;
  description: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
}

export interface TransactionPayment {
  payment_id: string;
  payment_type: string;
  amount: number;
}

export interface TransactionDetailResponse extends TransactionResponse {
  lineItems: TransactionLineItem[];
  payments: TransactionPayment[];
}

export interface DailyReportData {
  date: string;
  totalSales: number;
  transactionCount: number;
  fuelSales: number;
  merchandiseSales: number;
  status: 'OPEN' | 'CLOSED' | 'NO_DATA';
}

export interface WeeklyReportResponse {
  weekStartDate: string;
  weekEndDate: string;
  dailyData: DailyReportData[];
  totals: {
    sales: number;
    transactions: number;
    fuelSales: number;
    merchandiseSales: number;
  };
}

export interface MonthlyReportResponse {
  year: number;
  month: number;
  summaries: Array<{
    date: string;
    totalSales: number;
    totalTransactions: number;
    status: 'OPEN' | 'CLOSED';
  }>;
  totals: {
    sales: number;
    transactions: number;
    closedDays: number;
    openDays: number;
  };
}

export interface DateRangeReportResponse {
  startDate: string;
  endDate: string;
  summaries: Array<{
    date: string;
    totalSales: number;
    totalTransactions: number;
    status: 'OPEN' | 'CLOSED';
  }>;
  totals: {
    sales: number;
    transactions: number;
    dayCount: number;
  };
}

// Employee Types
export type EmployeeRole = 'store_manager' | 'shift_manager' | 'cashier';

export interface Employee {
  user_id: string;
  store_id: string;
  role: EmployeeRole;
  name: string;
  active: number;
  last_login_at: string | null;
  cloud_user_id: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmployeeListResponse {
  employees: Employee[];
  total: number;
}

export interface CreateEmployeeRequest {
  name: string;
  role: 'cashier' | 'shift_manager';
  pin: string;
  confirmPin: string;
}

export interface CreateEmployeeResponse {
  employee: Employee;
}

export interface UpdateEmployeeRequest {
  userId: string;
  name?: string;
  role?: 'cashier' | 'shift_manager';
}

export interface UpdateEmployeeResponse {
  employee: Employee;
}

export interface UpdatePinRequest {
  userId: string;
  currentPin: string;
  newPin: string;
  confirmPin: string;
}

export interface UpdatePinResponse {
  success: boolean;
  message: string;
}

export interface ToggleStatusResponse {
  success: boolean;
  message: string;
}
