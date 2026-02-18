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

  // Terminals
  /**
   * Terminal/register management operations
   * DB-006: All operations are store-scoped for tenant isolation
   * SEC-006: All queries use parameterized statements via DAL
   */
  terminals: {
    /**
     * List all registers for the configured store with their active shift status
     *
     * Used by DayClosePage for terminal name resolution and dropdowns.
     * Returns registers with current shift status for each.
     *
     * @returns TerminalListResponse with registers array
     * @security DB-006: Store-scoped via backend handler
     * @security SEC-006: Parameterized queries in backend
     */
    list: () => ipcClient.invoke<TerminalListResponse>('terminals:list'),
    /**
     * Deactivate a terminal mapping in the local database
     *
     * Called after successful cloud API deletion to synchronize local state.
     * The terminal is marked as inactive (active = 0), not deleted.
     *
     * @param terminalId - Terminal mapping ID or external register ID (UUID)
     * @returns DeactivateTerminalResponse with success status and message
     *
     * @security SEC-014: terminalId validated as UUID in handler
     * @security DB-006: Operation scoped to configured store
     */
    deactivate: (terminalId: string) =>
      ipcClient.invoke<DeactivateTerminalResponse>('terminals:deactivate', { terminalId }),
  },

  // Cashiers
  /**
   * Cashier/employee operations for DayClosePage
   * DB-006: All operations are store-scoped for tenant isolation
   * SEC-001: PIN hashes are never exposed in responses
   */
  cashiers: {
    /**
     * List active cashiers for the current store
     *
     * Used by DayClosePage for cashier name resolution and dropdowns.
     * Returns only active users with safe data (no PIN hash).
     *
     * @returns CashiersListResponse with cashiers array
     * @security DB-006: Store-scoped via backend handler
     * @security SEC-001: PIN hash excluded from response
     * @security SEC-006: Parameterized queries in backend
     */
    list: () => ipcClient.invoke<CashiersListResponse>('cashiers:list'),
  },

  // Store
  /**
   * Store configuration operations
   * DB-006: Returns only the configured store for this terminal
   */
  store: {
    /**
     * Get the configured store ID and name
     *
     * Used by DayClosePage for store context.
     * Returns minimal store data (ID and name only).
     *
     * @returns ConfiguredStoreResponse with store_id and name
     * @security DB-006: Returns only configured store data
     */
    getConfigured: () => ipcClient.invoke<ConfiguredStoreResponse>('store:getConfigured'),
  },

  // Shifts
  shifts: {
    list: (params?: ShiftListParams) => ipcClient.invoke<ShiftListResponse>('shifts:list', params),
    getById: (shiftId: string) => ipcClient.invoke<ShiftResponse>('shifts:getById', shiftId),
    getSummary: (shiftId: string) =>
      ipcClient.invoke<ShiftSummaryResponse>('shifts:getSummary', shiftId),
    findOpenShifts: () => ipcClient.invoke<ShiftResponse[]>('shifts:findOpenShifts'),
    /**
     * Close a shift with closing cash amount
     *
     * Updates shift status to CLOSED and records the closing cash amount.
     * Returns the closed shift with closing_cash for client confirmation.
     *
     * @param shiftId - UUID of the shift to close
     * @param closingCash - Non-negative cash amount in drawer at close
     * @returns ShiftCloseResponse with shift data and closing_cash
     *
     * @security API-001: Input validated via Zod schema in handler
     * @security SEC-014: shiftId validated as UUID in handler
     * @security DB-006: Store-scoped via backend handler
     * @security SEC-006: Parameterized queries in backend
     */
    close: (shiftId: string, closingCash: number) =>
      ipcClient.invoke<ShiftCloseResponse>('shifts:close', {
        shift_id: shiftId,
        closing_cash: closingCash,
      }),
    /**
     * Get all open shifts with resolved terminal and cashier names
     *
     * Used by DayClosePage to display which shifts need to be closed.
     * Returns open shifts with pre-resolved names for efficient display.
     *
     * @returns OpenShiftsResponse with open_shifts array containing names
     * @security DB-006: Store-scoped via backend handler
     * @security SEC-006: Parameterized queries in backend
     */
    getOpenShifts: () => ipcClient.invoke<OpenShiftsResponse>('shifts:getOpenShifts'),
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
    /**
     * Re-sync a shift to cloud with corrected payload format
     * Deletes old queue items and re-enqueues with correct field names
     */
    resync: (shiftId: string) =>
      ipcClient.invoke<{ success: boolean; message: string }>('shifts:resync', {
        shift_id: shiftId,
      }),
    /**
     * Get complete shift data for ViewShiftPage rendering
     *
     * Aggregates data from multiple tables into a single response optimized
     * for frontend rendering. Includes shift info, summary cards, payment methods,
     * and sales breakdown.
     *
     * @param shiftId - UUID of the shift to get view data for
     * @returns ShiftViewDataResponse with all data needed for ViewShiftPage
     *
     * @security DB-006: Store-scoped via backend handler
     * @security SEC-006: Parameterized queries in backend
     * @security API-001: shiftId validated as UUID in handler
     */
    getViewData: (shiftId: string) =>
      ipcClient.invoke<ShiftViewDataResponse>('shifts:getViewData', shiftId),
  },

  // Day Summaries
  daySummaries: {
    list: (params?: DaySummaryListParams) =>
      ipcClient.invoke<DaySummaryListResponse>('daySummaries:list', params),
    getByDate: (date: string) =>
      ipcClient.invoke<DaySummaryWithShiftsResponse>('daySummaries:getByDate', date),
    close: (date: string) => ipcClient.invoke<DaySummaryResponse>('daySummaries:close', date),
  },

  // Days (View Data)
  /**
   * Day view operations for read-only viewing of closed days
   * Used by ViewDayPage for comprehensive day data display
   *
   * @security DB-006: All operations store-scoped for tenant isolation
   * @security SEC-006: All queries use parameterized statements via DAL
   */
  days: {
    /**
     * Get complete day data for ViewDayPage rendering
     *
     * Aggregates data from multiple tables (day_summaries, shifts, shift_summaries,
     * lottery_business_days) into a single response optimized for frontend rendering.
     * Includes day info, summary cards, payment methods, and sales breakdown.
     *
     * @param dayId - UUID of the day summary to get view data for
     * @returns DayViewDataResponse with all data needed for ViewDayPage
     *
     * @security DB-006: Store-scoped via backend handler
     * @security SEC-006: Parameterized queries in backend
     * @security API-001: dayId validated as UUID in handler
     */
    getViewData: (dayId: string) =>
      ipcClient.invoke<DayViewDataResponse>('days:getViewData', dayId),
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
    /**
     * Get shifts grouped by day with employee and register information
     * Returns shifts for a date range with day status for determining reconciled state
     */
    getShiftsByDays: (params: { startDate: string; endDate: string; limit?: number }) =>
      ipcClient.invoke<ShiftsByDayResponse>('reports:getShiftsByDays', params),
    /**
     * Get lottery day report for a specific business date
     * Returns bin closings, activated/depleted/returned packs for the day
     */
    getLotteryDayReport: (params: { businessDate: string }) =>
      ipcClient.invoke<LotteryDayReportResponse>('reports:getLotteryDayReport', params),
  },

  // Lottery
  /**
   * Lottery onboarding and management operations
   *
   * Manages lottery business day initialization and onboarding workflow.
   * Onboarding mode allows stores to set up initial pack inventory.
   *
   * @security SEC-006: All queries use parameterized statements via DAL
   * @security DB-006: All operations store-scoped for tenant isolation
   */
  lottery: {
    /**
     * Get current onboarding status for the store
     *
     * Returns whether the store is in onboarding mode and the associated day ID.
     * Used to restore onboarding state after navigation or page reload.
     *
     * @returns OnboardingStatusResponse with is_onboarding flag and day info
     *
     * @security DB-006: Store-scoped via backend handler
     * @security SEC-006: Parameterized query in backend DAL
     */
    getOnboardingStatus: () =>
      ipcClient.invoke<OnboardingStatusResponse>('lottery:getOnboardingStatus'),

    /**
     * Complete onboarding mode for the store
     *
     * Explicitly ends onboarding mode by setting is_onboarding = 0 on the day.
     * After completion, pack activation requires existing inventory.
     *
     * @param dayId - UUID of the lottery business day to complete onboarding
     * @returns CompleteOnboardingResponse with success status
     *
     * @security SEC-010: Requires authenticated user
     * @security DB-006: Validates day belongs to store before update
     * @security SEC-014: dayId validated as UUID by Zod in backend
     * @security API-001: Input validated via Zod schema in handler
     */
    completeOnboarding: (dayId: string) =>
      ipcClient.invoke<CompleteOnboardingResponse>('lottery:completeOnboarding', {
        day_id: dayId,
      }),
  },

  // Day Close Access
  /**
   * Day close access validation operations
   *
   * Centralized access control for the day close wizard.
   * Validates shift conditions and user authorization before entry.
   *
   * @security SEC-010: Authorization enforced server-side
   * @security DB-006: All queries store-scoped for tenant isolation
   */
  dayClose: {
    /**
     * Check day close access with PIN authentication
     *
     * Validates all conditions for day close access:
     * 1. User is authenticated via PIN (BR-005)
     * 2. Exactly one open shift exists (BR-001, BR-002)
     * 3. User is shift owner OR has override role (BR-003, BR-004)
     *
     * @param input - Access check input with PIN
     * @returns DayCloseAccessResult with access decision and shift details
     *
     * @security SEC-010: Authorization decision made server-side
     * @security SEC-014: PIN validated as 4-6 digits
     * @security API-001: Input validated via Zod schema in handler
     */
    checkAccess: (input: { pin: string }) =>
      ipcClient.invoke<DayCloseAccessResult>('dayClose:checkAccess', input),
  },

  // Images (Task 3.4: Receipt image storage)
  /**
   * Receipt image operations for shift close
   *
   * Manages payout receipt images captured during shift close.
   * Images are stored on filesystem with metadata in database.
   *
   * @security SEC-006: All queries use parameterized statements via DAL
   * @security DB-006: All operations store-scoped for tenant isolation
   * @security SEC-015: Path traversal prevention
   */
  images: {
    /**
     * Upload a receipt image for a shift
     *
     * Stores the image on filesystem and creates a database record.
     * Uses SHA-256 hash for deduplication.
     *
     * @param data - Image upload data including Base64 image
     * @returns UploadImageResponse with image metadata
     *
     * @security SEC-006: Parameterized queries in backend
     * @security DB-006: Store-scoped via backend handler
     * @security SEC-014: Input validated via Zod schema
     */
    upload: (data: {
      shift_id: string;
      document_type: 'CASH_PAYOUT' | 'LOTTERY_REPORT' | 'GAMING_REPORT';
      image_data: string;
      file_name: string;
      mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
      payout_index?: number;
    }) => ipcClient.invoke<UploadImageResponse>('images:upload', data),

    /**
     * Retrieve an image by ID
     *
     * Returns the image data as Base64 encoded string.
     *
     * @param imageId - UUID of the image to retrieve
     * @returns GetImageResponse with Base64 image data
     *
     * @security DB-006: Store-scoped via backend handler
     * @security SEC-015: Path validation
     */
    get: (imageId: string) =>
      ipcClient.invoke<GetImageResponse>('images:get', { image_id: imageId }),

    /**
     * Get all images for a shift
     *
     * Returns metadata for all images associated with a shift.
     *
     * @param shiftId - UUID of the shift
     * @param documentType - Optional filter by document type
     * @returns ShiftImagesResponse with image list and counts
     *
     * @security DB-006: Store-scoped via backend handler
     */
    getByShift: (
      shiftId: string,
      documentType?: 'CASH_PAYOUT' | 'LOTTERY_REPORT' | 'GAMING_REPORT'
    ) =>
      ipcClient.invoke<ShiftImagesResponse>('images:getByShift', {
        shift_id: shiftId,
        document_type: documentType,
      }),

    /**
     * Delete an image by ID
     *
     * Removes the image file and database record.
     *
     * @param imageId - UUID of the image to delete
     * @returns Success status
     *
     * @security DB-006: Store-scoped via backend handler
     */
    delete: (imageId: string) =>
      ipcClient.invoke<{ success: boolean; message: string }>('images:delete', {
        image_id: imageId,
      }),
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

/**
 * Local shift response from shifts:getById handler
 * Maps to full Shift entity from DAL with resolved cashier name
 *
 * @security DB-006: Store-scoped via backend handler
 * @security SEC-006: Backend uses parameterized queries for all lookups
 */
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
  /** External cashier ID from POS (for reference/debugging) */
  external_cashier_id: string | null;
  /** External register ID from POS - use for terminal name lookup */
  external_register_id: string | null;
  /** External till ID from POS (for reference/debugging) */
  external_till_id: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Pre-resolved cashier name from backend
   * Eliminates need for frontend lookup - follows same pattern as shifts:getOpenShifts
   * Values: user.name if found, "No Cashier Assigned" if null, "Unknown Cashier" if user missing
   */
  cashier_name: string;
}

/**
 * Response from shifts:close handler
 * Extends ShiftResponse with closing_cash for client confirmation
 *
 * @security SEC-006: All queries use parameterized statements
 * @security DB-006: Store-scoped via backend handler
 */
export interface ShiftCloseResponse extends ShiftResponse {
  /** Cash amount in drawer at shift close (non-negative) */
  closing_cash: number;
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

// ============================================================================
// View Page Data Types (Phase 3)
// ============================================================================

/**
 * Shift info for ViewShiftPage display
 * Pre-computed and formatted for direct frontend rendering
 *
 * @security API-008: OUTPUT_FILTERING - Only includes fields needed for display
 */
export interface ShiftViewInfo {
  /** Resolved terminal name from pos_terminal_mappings */
  terminalName: string;
  /** Shift number for the day */
  shiftNumber: number;
  /** Resolved cashier name from users table */
  cashierName: string;
  /** Formatted start time for display */
  startedAt: string;
  /** Formatted end time for display, null if still open */
  endedAt: string | null;
  /** Opening cash amount */
  openingCash: number;
  /** Closing cash amount, null if still open */
  closingCash: number | null;
}

/**
 * Summary card data for ViewShiftPage
 * Contains aggregated sales by category
 */
export interface ShiftViewSummary {
  insideSales: {
    total: number;
    nonFood: number;
    foodSales: number;
  };
  fuelSales: {
    total: number;
    gallonsSold: number;
  };
  lotterySales: {
    total: number;
    scratchOff: number;
    online: number;
  };
  reserved: null;
}

/**
 * Payment methods data for ViewShiftPage
 * Contains receipts and payouts by type
 */
export interface ShiftViewPayments {
  receipts: {
    cash: { reports: number; pos: number };
    creditCard: { reports: number; pos: number };
    debitCard: { reports: number; pos: number };
    ebt: { reports: number; pos: number };
  };
  payouts: {
    cashPayouts: { reports: number; pos: number; hasImages: boolean; count: number };
    lotteryPayouts: { reports: number; pos: number; hasImages: boolean };
    gamingPayouts: { reports: number; pos: number; hasImages: boolean };
  };
  netCash: { reports: number; pos: number };
}

/**
 * Sales breakdown data for ViewShiftPage
 * Contains sales by department/category
 */
export interface ShiftViewSalesBreakdown {
  gasSales: { reports: number; pos: number };
  grocery: { reports: number; pos: number };
  tobacco: { reports: number; pos: number };
  beverages: { reports: number; pos: number };
  snacks: { reports: number; pos: number };
  other: { reports: number; pos: number };
  lottery: {
    instantSales: { reports: number; pos: number };
    instantCashes: { reports: number; pos: number };
    onlineSales: { reports: number; pos: number };
    onlineCashes: { reports: number; pos: number };
  };
  salesTax: { reports: number; pos: number };
  total: { reports: number; pos: number };
}

/**
 * Complete response from shifts:getViewData
 * All data needed to render ViewShiftPage
 *
 * @security DB-006: Store-scoped via backend handler
 * @security SEC-006: Parameterized queries in backend
 * @security API-008: Only whitelisted fields returned
 */
export interface ShiftViewDataResponse {
  shiftId: string;
  businessDate: string;
  status: 'OPEN' | 'CLOSED';
  shiftInfo: ShiftViewInfo;
  summary: ShiftViewSummary;
  payments: ShiftViewPayments;
  salesBreakdown: ShiftViewSalesBreakdown;
  /** Raw timestamps for footer calculations */
  timestamps: {
    createdAt: string;
    closedAt: string | null;
  };
  /** Optional lottery day ID for LOTTERY mode display */
  lotteryDayId: string | null;
}

// ============================================================================
// Day View Page Data Types (Phase 3)
// ============================================================================

/**
 * Day info for ViewDayPage display
 * Pre-computed and formatted for direct frontend rendering
 *
 * @security API-008: OUTPUT_FILTERING - Only includes fields needed for display
 */
export interface DayViewInfo {
  /** Business date formatted for display */
  businessDate: string;
  /** Total number of shifts for the day */
  shiftCount: number;
  /** First shift start time formatted for display */
  firstShiftStarted: string | null;
  /** Last shift end time formatted for display */
  lastShiftEnded: string | null;
  /** Total opening cash from first shift */
  totalOpeningCash: number;
  /** Total closing cash from last shift */
  totalClosingCash: number;
}

/**
 * Summary card data for ViewDayPage (aggregated from all shifts)
 */
export interface DayViewSummary {
  insideSales: {
    total: number;
    nonFood: number;
    foodSales: number;
  };
  fuelSales: {
    total: number;
    gallonsSold: number;
  };
  lotterySales: {
    total: number;
    scratchOff: number;
    online: number;
  };
  reserved: null;
}

/**
 * Payment methods data for ViewDayPage (aggregated from all shifts)
 */
export interface DayViewPayments {
  receipts: {
    cash: { reports: number; pos: number };
    creditCard: { reports: number; pos: number };
    debitCard: { reports: number; pos: number };
    ebt: { reports: number; pos: number };
  };
  payouts: {
    cashPayouts: { reports: number; pos: number; hasImages: boolean; count: number };
    lotteryPayouts: { reports: number; pos: number; hasImages: boolean };
    gamingPayouts: { reports: number; pos: number; hasImages: boolean };
  };
  netCash: { reports: number; pos: number };
}

/**
 * Sales breakdown data for ViewDayPage (aggregated from all shifts)
 */
export interface DayViewSalesBreakdown {
  gasSales: { reports: number; pos: number };
  grocery: { reports: number; pos: number };
  tobacco: { reports: number; pos: number };
  beverages: { reports: number; pos: number };
  snacks: { reports: number; pos: number };
  other: { reports: number; pos: number };
  lottery: {
    instantSales: { reports: number; pos: number };
    instantCashes: { reports: number; pos: number };
    onlineSales: { reports: number; pos: number };
    onlineCashes: { reports: number; pos: number };
  };
  salesTax: { reports: number; pos: number };
  total: { reports: number; pos: number };
}

/**
 * Complete response from days:getViewData
 * All data needed to render ViewDayPage
 *
 * @security DB-006: Store-scoped via backend handler
 * @security SEC-006: Parameterized queries in backend
 * @security API-008: Only whitelisted fields returned
 */
export interface DayViewDataResponse {
  /** Day summary ID */
  daySummaryId: string;
  /** Business date */
  businessDate: string;
  /** Day status */
  status: 'OPEN' | 'CLOSED';
  /** Day info for header/info card */
  dayInfo: DayViewInfo;
  /** Summary cards data */
  summary: DayViewSummary;
  /** Payment methods data */
  payments: DayViewPayments;
  /** Sales breakdown data */
  salesBreakdown: DayViewSalesBreakdown;
  /** Lottery business day ID for lottery components */
  lotteryDayId: string | null;
  /** Timestamps for footer */
  timestamps: {
    createdAt: string;
    closedAt: string | null;
  };
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

/**
 * Individual shift data for the shifts-by-day report
 */
export interface ShiftByDayData {
  shiftId: string;
  shiftNumber: number;
  registerName: string;
  employeeName: string;
  startTime: string;
  endTime: string | null;
  status: 'OPEN' | 'CLOSED';
}

/**
 * Day data with shifts for the shifts-by-day report
 * BIZ-003: Includes opened_at/closed_at for enterprise-grade date identification
 */
export interface DayWithShifts {
  businessDate: string;
  openedAt: string | null;
  closedAt: string | null;
  dayStatus: 'OPEN' | 'CLOSED';
  shifts: ShiftByDayData[];
}

/**
 * Response for shifts-by-day report
 * Returns shifts grouped by day with employee and register information
 */
export interface ShiftsByDayResponse {
  days: DayWithShifts[];
}

/**
 * Bin closing record in lottery day report
 */
export interface LotteryDayReportBin {
  bin_number: number;
  game_name: string;
  game_price: number;
  pack_number: string;
  starting_serial: string;
  ending_serial: string;
  tickets_sold: number;
  sales_amount: number;
}

/**
 * Activated pack in lottery day report
 */
export interface LotteryDayReportActivatedPack {
  pack_id: string;
  bin_number: number;
  game_name: string;
  game_price: number;
  pack_number: string;
  activated_at: string;
  status: 'ACTIVE' | 'DEPLETED' | 'RETURNED';
}

/**
 * Depleted pack in lottery day report
 */
export interface LotteryDayReportDepletedPack {
  pack_id: string;
  bin_number: number;
  game_name: string;
  game_price: number;
  pack_number: string;
  starting_serial: string;
  ending_serial: string;
  tickets_sold: number;
  sales_amount: number;
  depleted_at: string;
}

/**
 * Returned pack in lottery day report
 */
export interface LotteryDayReportReturnedPack {
  pack_id: string;
  bin_number: number;
  game_name: string;
  game_price: number;
  pack_number: string;
  starting_serial: string;
  ending_serial: string;
  tickets_sold: number;
  sales_amount: number;
  returned_at: string;
}

/**
 * Individual closing session within a business day
 * When a day is closed and reopened multiple times, each close produces a session.
 */
export interface DayClosingSession {
  closingNumber: number;
  dayId: string;
  openedAt: string | null;
  closedAt: string | null;
  binSales: number;
  packSales: number;
  returnSales: number;
  totalSales: number;
  totalTicketsSold: number;
  bins: LotteryDayReportBin[];
  depletedPacks: LotteryDayReportDepletedPack[];
  returnedPacks: LotteryDayReportReturnedPack[];
  activatedPacks: LotteryDayReportActivatedPack[];
}

/**
 * Full lottery day report response
 */
export interface LotteryDayReportResponse {
  businessDate: string;
  dayStatus: 'OPEN' | 'PENDING_CLOSE' | 'CLOSED' | null;
  closedAt: string | null;
  lotteryTotal: number;
  totalClosings: number;
  closingSessions: DayClosingSession[];
  bins: LotteryDayReportBin[];
  activatedPacks: LotteryDayReportActivatedPack[];
  depletedPacks: LotteryDayReportDepletedPack[];
  returnedPacks: LotteryDayReportReturnedPack[];
}

// Employee Types
export type EmployeeRole = 'store_manager' | 'shift_manager' | 'cashier';

/**
 * Employee interface
 * Note: After cloud_id consolidation (v043), user_id IS the cloud user ID
 */
export interface Employee {
  user_id: string;
  store_id: string;
  role: EmployeeRole;
  name: string;
  active: number;
  last_login_at: string | null;
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

// ============================================================================
// Terminal Types
// ============================================================================

/**
 * Request payload for terminal deactivation
 * SEC-014: terminalId must be a valid UUID (validated by Zod in handler)
 */
export interface DeactivateTerminalRequest {
  /** Terminal mapping ID or external register ID (UUID format) */
  terminalId: string;
}

/**
 * Response for terminal deactivation operation
 * Returned by terminals:deactivate IPC handler
 */
export interface DeactivateTerminalResponse {
  /** Whether the deactivation was successful */
  success: boolean;
  /** The terminal ID that was processed */
  terminalId: string;
  /** Human-readable result message */
  message: string;
}

/**
 * Register with associated shift information
 * Returned by terminals:list IPC handler
 */
export interface RegisterWithShiftStatus {
  /** Internal terminal mapping ID */
  id: string;
  /** External register ID from POS system */
  external_register_id: string;
  /** Terminal type (always REGISTER for this endpoint) */
  terminal_type: string;
  /** User-friendly description/name */
  description: string | null;
  /** Whether the register is active */
  active: boolean;
  /** Currently open shift on this register, if any */
  activeShift: ShiftResponse | null;
  /** Count of open shifts for this register */
  openShiftCount: number;
  /** When this register was first identified */
  created_at: string;
  /** When this register was last updated */
  updated_at: string;
}

/**
 * Response for terminals:list IPC handler
 */
export interface TerminalListResponse {
  /** Array of registers with shift status */
  registers: RegisterWithShiftStatus[];
  /** Total count of registers */
  total: number;
}

// ============================================================================
// Cashier Types
// ============================================================================

/**
 * Cashier info for dropdown/display
 * Returned by cashiers:list IPC handler
 */
export interface CashierInfo {
  /** User ID (UUID) */
  cashier_id: string;
  /** Display name */
  name: string;
  /** Role */
  role: string;
}

/**
 * Response for cashiers:list IPC handler
 */
export interface CashiersListResponse {
  /** Array of active cashiers */
  cashiers: CashierInfo[];
  /** Total count */
  total: number;
}

// ============================================================================
// Store Types
// ============================================================================

/**
 * Configured store response - minimal data for DayClosePage
 * Returned by store:getConfigured IPC handler
 */
export interface ConfiguredStoreResponse {
  /** Store ID (UUID) */
  store_id: string;
  /** Store name */
  name: string;
}

// ============================================================================
// Open Shifts Types
// ============================================================================

/**
 * Open shift with resolved names for DayClosePage
 * Used in shifts:getOpenShifts response
 */
export interface OpenShiftWithNames {
  /** Shift ID (UUID) */
  shift_id: string;
  /** Resolved terminal/register name */
  terminal_name: string;
  /** Resolved cashier name */
  cashier_name: string;
  /** Shift number for the day */
  shift_number: number;
  /** Shift status (always OPEN for this query) */
  status: 'OPEN' | 'CLOSED';
  /** External register ID from POS */
  external_register_id: string | null;
  /** Business date */
  business_date: string;
  /** Start time */
  start_time: string | null;
}

/**
 * Response for shifts:getOpenShifts IPC handler
 */
export interface OpenShiftsResponse {
  /** Array of open shifts with resolved names */
  open_shifts: OpenShiftWithNames[];
}

// ============================================================================
// Day Close Access Types
// ============================================================================

/**
 * Reason codes for day close access denial
 * Used by DayCloseAccessGuard to show appropriate error messages
 */
export type DayCloseAccessDenialReason =
  | 'NO_OPEN_SHIFTS'
  | 'MULTIPLE_OPEN_SHIFTS'
  | 'NOT_SHIFT_OWNER'
  | 'INVALID_PIN'
  | 'NOT_AUTHENTICATED';

/**
 * How day close access was granted
 * OWNER: User is the assigned cashier of the shift
 * OVERRIDE: User has shift_manager or store_manager role
 */
export type DayCloseAccessType = 'OWNER' | 'OVERRIDE';

/**
 * User role type for day close access
 */
export type DayCloseUserRole = 'store_manager' | 'shift_manager' | 'cashier';

/**
 * Active shift details for day close access
 * Includes resolved names for UI display
 *
 * @security DB-006: Store-scoped via backend query
 */
export interface DayCloseActiveShift {
  /** Shift ID (UUID) */
  shift_id: string;
  /** Shift number for the day */
  shift_number: number;
  /** Cashier's user ID (may be null if no cashier assigned) */
  cashier_id: string | null;
  /** Resolved cashier name */
  cashier_name: string;
  /** External register ID from POS */
  external_register_id: string | null;
  /** Resolved terminal/register name */
  terminal_name: string;
  /** Business date (YYYY-MM-DD) */
  business_date: string;
  /** Start time (ISO timestamp) */
  start_time: string | null;
}

/**
 * Authenticated user info from day close access check
 * Returned when PIN authentication succeeds
 *
 * @security SEC-001: PIN hash never exposed
 */
export interface DayCloseAccessUser {
  /** User ID (UUID) */
  userId: string;
  /** User's display name */
  name: string;
  /** User's role */
  role: DayCloseUserRole;
}

/**
 * Result of day close access check
 * Returned by dayClose:checkAccess IPC handler
 *
 * @security SEC-010: Authorization decision made server-side
 */
export interface DayCloseAccessResult {
  /** Whether access is allowed */
  allowed: boolean;

  /** Reason code if denied */
  reasonCode?: DayCloseAccessDenialReason;

  /** Human-readable reason if denied */
  reason?: string;

  /** The active shift (if exactly one exists) */
  activeShift?: DayCloseActiveShift;

  /** How access was granted */
  accessType?: DayCloseAccessType;

  /** The authenticated user */
  user?: DayCloseAccessUser;

  /** Open shift count (for UI messaging) */
  openShiftCount: number;
}

/**
 * Input for day close access check
 * SEC-014: PIN must be 4-6 digits
 */
export interface DayCloseAccessInput {
  /** PIN for authentication (4-6 digits) */
  pin: string;
}

// ============================================================================
// Lottery Onboarding Types (BIZ-012-FIX)
// ============================================================================

/**
 * Response from lottery:getOnboardingStatus IPC handler
 *
 * Returns the current onboarding state for the store.
 * Used by frontend to restore onboarding mode on page load/navigation.
 *
 * @security DB-006: Response is store-scoped via backend query
 */
export interface OnboardingStatusResponse {
  /** Whether the store is currently in onboarding mode */
  is_onboarding: boolean;
  /** Day ID of the onboarding day (null if not in onboarding) */
  day_id: string | null;
  /** Business date of the onboarding day (null if not in onboarding) */
  business_date: string | null;
  /** When the onboarding day was opened (null if not in onboarding) */
  opened_at: string | null;
}

/**
 * Response from lottery:completeOnboarding IPC handler
 *
 * Returned when onboarding mode is explicitly ended by user action.
 * After this, normal inventory requirements apply for pack activation.
 *
 * @security SEC-010: Requires authenticated user (verified in backend)
 * @security DB-006: Day ownership validated in backend
 */
export interface CompleteOnboardingResponse {
  /** Whether the operation succeeded */
  success: boolean;
  /** The day ID that was updated */
  day_id: string;
  /** Human-readable result message */
  message?: string;
}

// ============================================================================
// Image Storage Types (Task 3.4)
// ============================================================================

/**
 * Document type for receipt images
 */
export type ReceiptDocumentType = 'CASH_PAYOUT' | 'LOTTERY_REPORT' | 'GAMING_REPORT';

/**
 * Allowed MIME types for images
 */
export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

/**
 * Response from images:upload IPC handler
 *
 * Returned when an image is successfully uploaded or already exists.
 *
 * @security DB-006: Response is store-scoped via backend handler
 */
export interface UploadImageResponse {
  /** Whether the upload was successful */
  success: boolean;
  /** Image metadata */
  image: {
    /** Image record ID (UUID) */
    id: string;
    /** SHA-256 hash of image for deduplication */
    image_hash: string;
    /** Original filename */
    file_name: string;
    /** Document type (CASH_PAYOUT, LOTTERY_REPORT, GAMING_REPORT) */
    document_type: ReceiptDocumentType;
  };
  /** Human-readable result message */
  message: string;
}

/**
 * Response from images:get IPC handler
 *
 * Returns Base64 encoded image data for display.
 *
 * @security DB-006: Response is store-scoped via backend handler
 */
export interface GetImageResponse {
  /** Whether the retrieval was successful */
  success: boolean;
  /** Base64 encoded image data */
  image_data: string;
  /** MIME type of the image */
  mime_type: ImageMimeType;
  /** Original filename */
  file_name: string;
}

/**
 * Image metadata for list responses
 */
export interface ShiftImageInfo {
  /** Image record ID (UUID) */
  id: string;
  /** Document type */
  document_type: ReceiptDocumentType;
  /** Original filename */
  file_name: string;
  /** File size in bytes */
  file_size: number;
  /** MIME type */
  mime_type: ImageMimeType;
  /** Optional payout index for CASH_PAYOUT */
  payout_index: number | null;
  /** When the image was uploaded (ISO timestamp) */
  uploaded_at: string;
  /** Whether the image file exists on disk */
  has_image: boolean;
}

/**
 * Response from images:getByShift IPC handler
 *
 * Returns all images associated with a shift.
 *
 * @security DB-006: Response is store-scoped via backend handler
 */
export interface ShiftImagesResponse {
  /** Array of image metadata */
  images: ShiftImageInfo[];
  /** Count of images by document type */
  counts: {
    CASH_PAYOUT: number;
    LOTTERY_REPORT: number;
    GAMING_REPORT: number;
  };
}
