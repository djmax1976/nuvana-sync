/**
 * Preload Script
 *
 * Exposes a secure API to the renderer process via contextBridge.
 * This is the only way the renderer can communicate with the main process.
 *
 * @module preload
 * @security SEC-014: Type-safe IPC communication with channel allowlists
 * @security API-001: Input validation happens in main process (zod not available in preload sandbox)
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// ============================================================================
// SEC-014: Allowlisted IPC Channels - Only these channels can be invoked
// ============================================================================

/**
 * Allowed invoke channels (request/response pattern)
 * SEC-014: Explicit allowlist prevents unauthorized IPC access
 */
const ALLOWED_INVOKE_CHANNELS = [
  // Config
  'config:get',
  'config:save',
  'config:test-connection',
  // Stores
  'stores:getInfo',
  'stores:getStatus',
  'stores:isConfigured',
  // Auto-Updater
  'updater:check',
  'updater:download',
  'updater:install',
  'updater:status',
  // License
  'license:statusChanged',
  // Sync
  'sync:get-stats',
  'sync:get-recent-files',
  'sync:trigger',
  'sync:toggle-pause',
  'sync:getStatus',
  'sync:getStats',
  'sync:triggerNow',
  'sync:syncUsers',
  'sync:syncUsersDuringSetup',
  'sync:syncBins',
  'sync:syncBinsDuringSetup',
  'sync:syncGames',
  'sync:syncGamesDuringSetup',
  'sync:forceFullSync',
  'sync:getHistory',
  'sync:getHistoryPaginated',
  'sync:getPendingQueue',
  'sync:getFailedQueue',
  'sync:retryFailed',
  'sync:startEngine',
  'sync:stopEngine',
  'sync:cleanupQueue',
  // Dashboard
  'dashboard:getStats',
  'dashboard:getTodaySales',
  'dashboard:getWeeklySales',
  // Shifts
  'shifts:list',
  'shifts:getById',
  'shifts:getSummary',
  'shifts:close',
  'shifts:findOpenShifts',
  // Day Summaries
  'daySummaries:list',
  'daySummaries:getByDate',
  'daySummaries:close',
  // Transactions
  'transactions:list',
  'transactions:getById',
  // Reports
  'reports:weekly',
  'reports:monthly',
  'reports:dateRange',
  // Lottery
  'lottery:getGames',
  'lottery:getPacks',
  'lottery:getBins',
  'lottery:receivePack',
  'lottery:activatePack',
  'lottery:depletePack',
  'lottery:returnPack',
  'lottery:prepareDayClose',
  'lottery:commitDayClose',
  'lottery:cancelDayClose',
  'lottery:parseBarcode',
  // Settings
  'settings:get',
  'settings:update',
  'settings:updateDuringSetup',
  'settings:testConnection',
  'settings:validateApiKey',
  'settings:completeSetup',
  'settings:isSetupComplete',
  'settings:browseFolder',
  'settings:validateFolder',
  'settings:getStatus',
  'settings:openUserManagement',
  // Auth
  'auth:login',
  'auth:loginWithUser',
  'auth:logout',
  'auth:getCurrentUser',
  'auth:updateActivity',
  'auth:getUsers',
  'auth:hasPermission',
  'auth:hasMinimumRole',
  // License
  'license:getStatus',
  'license:checkNow',
  'license:getDaysRemaining',
  'license:shouldShowWarning',
] as const;

/**
 * Allowed event channels (one-way from main to renderer)
 * SEC-014: Explicit allowlist for event subscriptions
 */
const ALLOWED_ON_CHANNELS = [
  'sync-status',
  'sync:statusChanged',
  'sync:progress',
  'sync:usersUpdated',
  'file:processed',
  'auth:sessionExpired',
  'auth:sessionWarning',
  'scanner:input',
  'navigate',
  // Auto-Updater
  'updater:status',
  // License
  'license:statusChanged',
] as const;

type InvokeChannel = (typeof ALLOWED_INVOKE_CHANNELS)[number];
type OnChannel = (typeof ALLOWED_ON_CHANNELS)[number];

// ============================================================================
// Response Types (defined locally to avoid zod imports in preload sandbox)
// ============================================================================

// Sync types (mirrors sync.types.ts without zod)
interface SyncStats {
  filesProcessed: number;
  filesErrored: number;
  lastSyncTime: Date | null;
  isWatching: boolean;
}

interface FileRecord {
  filePath: string;
  fileName: string;
  status: 'queued' | 'processing' | 'success' | 'error';
  timestamp: Date;
  error?: string;
  documentType?: string;
}

type SyncStatusEventType =
  | 'file-detected'
  | 'file-processed'
  | 'file-error'
  | 'watcher-ready'
  | 'watcher-error';

interface SyncStatusEvent {
  type: SyncStatusEventType;
  filePath?: string;
  success?: boolean;
  error?: string;
}

// Config types (mirrors config.types.ts without zod)
interface NuvanaConfig {
  store_id: string;
  api_url: string;
  api_key: string;
  watch_path: string;
  sync_interval_seconds: number;
  cloud_sync_enabled: boolean;
}

type NuvanaConfigUpdate = Partial<NuvanaConfig>;

interface TestConnectionResult {
  success: boolean;
  message: string;
  storeInfo?: {
    name: string;
    id: string;
  };
}

interface ConfigResponse {
  isConfigured: boolean;
  config: NuvanaConfig;
}

interface SaveConfigResult {
  success: boolean;
  error?: string;
}

interface TriggerSyncResult {
  success: boolean;
  error?: string;
}

interface TogglePauseResult {
  paused: boolean;
}

// Dashboard types
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

// Shift types
interface ShiftListParams {
  startDate?: string;
  endDate?: string;
  status?: 'OPEN' | 'CLOSED';
  limit?: number;
  offset?: number;
}

interface Shift {
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

interface ShiftListResponse {
  shifts: Shift[];
  total: number;
  limit: number;
  offset: number;
}

// Day Summary types
interface DaySummary {
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

interface DaySummaryListParams {
  startDate?: string;
  endDate?: string;
  status?: 'OPEN' | 'CLOSED';
  limit?: number;
  offset?: number;
}

// Transaction types
interface Transaction {
  transaction_id: string;
  store_id: string;
  shift_id: string | null;
  business_date: string;
  transaction_number: number | null;
  transaction_time: string | null;
  total_amount: number;
  voided: number;
}

interface TransactionListParams {
  startDate?: string;
  endDate?: string;
  shiftId?: string;
  minAmount?: number;
  maxAmount?: number;
  limit?: number;
  offset?: number;
}

// IPC Error Response
interface IPCErrorResponse {
  error: string;
  message: string;
}

// ============================================================================
// SEC-014: Validation Functions (without zod - basic runtime checks)
// ============================================================================

const VALID_SYNC_STATUS_TYPES: SyncStatusEventType[] = [
  'file-detected',
  'file-processed',
  'file-error',
  'watcher-ready',
  'watcher-error',
];

/**
 * SEC-014: Validate incoming IPC data before passing to callbacks
 * Note: Full zod validation happens in main process; this is a basic sanity check
 */
function validateSyncStatusEvent(data: unknown): SyncStatusEvent | null {
  if (typeof data !== 'object' || data === null) {
    console.error('[preload] Invalid sync status event: not an object');
    return null;
  }

  const event = data as Record<string, unknown>;

  if (
    typeof event.type !== 'string' ||
    !VALID_SYNC_STATUS_TYPES.includes(event.type as SyncStatusEventType)
  ) {
    console.error('[preload] Invalid sync status event type:', event.type);
    return null;
  }

  return {
    type: event.type as SyncStatusEventType,
    filePath: typeof event.filePath === 'string' ? event.filePath : undefined,
    success: typeof event.success === 'boolean' ? event.success : undefined,
    error: typeof event.error === 'string' ? event.error : undefined,
  };
}

/**
 * SEC-014: Validate navigation path against allowlist
 */
const ALLOWED_NAVIGATION_PATHS = [
  '/settings',
  '/dashboard',
  '/setup',
  '/shifts',
  '/transactions',
  '/reports',
  '/lottery',
  '/terminal',
] as const;

function validateNavigationPath(path: unknown): string | null {
  if (typeof path !== 'string') {
    console.error('[preload] Invalid navigation path received:', path);
    return null;
  }

  // SEC-014: Only allow known navigation paths
  if (!ALLOWED_NAVIGATION_PATHS.includes(path as (typeof ALLOWED_NAVIGATION_PATHS)[number])) {
    console.error('[preload] Unknown navigation path:', path);
    return null;
  }

  return path;
}

/**
 * SEC-014: Validate channel is in allowlist
 */
function isAllowedInvokeChannel(channel: string): channel is InvokeChannel {
  return ALLOWED_INVOKE_CHANNELS.includes(channel as InvokeChannel);
}

function isAllowedOnChannel(channel: string): channel is OnChannel {
  return ALLOWED_ON_CHANNELS.includes(channel as OnChannel);
}

// ============================================================================
// Type-safe API exposed to renderer process
// SEC-014: All methods use proper types instead of 'any'
// ============================================================================

export interface NuvanaAPI {
  // Config
  getConfig: () => Promise<ConfigResponse>;
  saveConfig: (config: NuvanaConfigUpdate) => Promise<SaveConfigResult>;
  testConnection: (config: Partial<NuvanaConfig>) => Promise<TestConnectionResult>;

  // Sync
  getStats: () => Promise<SyncStats>;
  getRecentFiles: () => Promise<FileRecord[]>;
  triggerSync: () => Promise<TriggerSyncResult>;
  togglePause: () => Promise<TogglePauseResult>;

  // Events - type-safe callbacks
  onSyncStatus: (callback: (data: SyncStatusEvent) => void) => () => void;
  onNavigate: (callback: (path: string) => void) => () => void;
}

/**
 * SEC-014: Generic IPC API with channel validation
 * Provides a secure interface for IPC communication
 */
export interface ElectronAPI {
  /** Invoke a channel with arguments (request/response) */
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;

  /** Subscribe to channel events (returns unsubscribe function) */
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;

  /** One-time event listener */
  once: (channel: string, callback: (...args: unknown[]) => void) => void;
}

// ============================================================================
// Expose API to Renderer via contextBridge
// ============================================================================

// Legacy API for backward compatibility
contextBridge.exposeInMainWorld('nuvanaAPI', {
  // Config
  getConfig: (): Promise<ConfigResponse> => ipcRenderer.invoke('config:get'),

  saveConfig: (config: NuvanaConfigUpdate): Promise<SaveConfigResult> =>
    ipcRenderer.invoke('config:save', config),

  testConnection: (config: Partial<NuvanaConfig>): Promise<TestConnectionResult> =>
    ipcRenderer.invoke('config:test-connection', config),

  // Sync
  getStats: (): Promise<SyncStats> => ipcRenderer.invoke('sync:get-stats'),

  getRecentFiles: (): Promise<FileRecord[]> => ipcRenderer.invoke('sync:get-recent-files'),

  triggerSync: (): Promise<TriggerSyncResult> => ipcRenderer.invoke('sync:trigger'),

  togglePause: (): Promise<TogglePauseResult> => ipcRenderer.invoke('sync:toggle-pause'),

  // Events - with validation
  onSyncStatus: (callback: (data: SyncStatusEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: unknown): void => {
      const validated = validateSyncStatusEvent(data);
      if (validated) {
        callback(validated);
      }
    };
    ipcRenderer.on('sync-status', handler);
    return () => ipcRenderer.removeListener('sync-status', handler);
  },

  onNavigate: (callback: (path: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, path: unknown): void => {
      const validated = validateNavigationPath(path);
      if (validated) {
        callback(validated);
      }
    };
    ipcRenderer.on('navigate', handler);
    return () => ipcRenderer.removeListener('navigate', handler);
  },
} satisfies NuvanaAPI);

// New generic API for dashboard IPC
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * SEC-014: Invoke IPC channel with validation
   * Only allowlisted channels can be invoked
   */
  invoke: <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
    if (!isAllowedInvokeChannel(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  /**
   * SEC-014: Subscribe to IPC events with validation
   * Only allowlisted channels can be subscribed to
   */
  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    if (!isAllowedOnChannel(channel)) {
      throw new Error(`IPC event channel not allowed: ${channel}`);
    }

    const subscription = (_event: IpcRendererEvent, ...args: unknown[]): void => {
      callback(...args);
    };

    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },

  /**
   * SEC-014: One-time event listener with validation
   */
  once: (channel: string, callback: (...args: unknown[]) => void): void => {
    if (!isAllowedOnChannel(channel)) {
      throw new Error(`IPC event channel not allowed: ${channel}`);
    }

    ipcRenderer.once(channel, (_event: IpcRendererEvent, ...args: unknown[]) => {
      callback(...args);
    });
  },
} satisfies ElectronAPI);

// ============================================================================
// Global Type Declarations
// ============================================================================

declare global {
  interface Window {
    nuvanaAPI: NuvanaAPI;
    electronAPI: ElectronAPI;
  }
}

// Export types for use in renderer
export type {
  ConfigResponse,
  SaveConfigResult,
  TriggerSyncResult,
  TogglePauseResult,
  DashboardStats,
  HourlyData,
  TodaySalesResponse,
  DailyData,
  WeeklySalesResponse,
  ShiftListParams,
  Shift,
  ShiftListResponse,
  DaySummary,
  DaySummaryListParams,
  Transaction,
  TransactionListParams,
  IPCErrorResponse,
};
