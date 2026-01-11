/**
 * Preload Script
 *
 * Exposes a safe API to the renderer process via contextBridge.
 * This is the only way the renderer can communicate with the main process.
 *
 * @module preload
 * @security SEC-014: Type-safe IPC communication
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import {
  type SyncStats,
  type FileRecord,
  type SyncStatusEvent,
  SyncStatusEventSchema,
} from "../shared/types/sync.types";
import {
  type NuvanaSyncConfig,
  type NuvanaSyncConfigUpdate,
  type TestConnectionResult,
} from "../shared/types/config.types";

/**
 * Configuration response from main process
 */
interface ConfigResponse {
  isConfigured: boolean;
  config: NuvanaSyncConfig;
}

/**
 * Save config result
 */
interface SaveConfigResult {
  success: boolean;
  error?: string;
}

/**
 * Trigger sync result
 */
interface TriggerSyncResult {
  success: boolean;
  error?: string;
}

/**
 * Toggle pause result
 */
interface TogglePauseResult {
  paused: boolean;
}

/**
 * Type-safe API exposed to renderer process
 * SEC-014: All methods use proper types instead of 'any'
 */
export interface NuvanaSyncAPI {
  // Config
  getConfig: () => Promise<ConfigResponse>;
  saveConfig: (config: NuvanaSyncConfigUpdate) => Promise<SaveConfigResult>;
  testConnection: (config: Partial<NuvanaSyncConfig>) => Promise<TestConnectionResult>;

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
 * SEC-014: Validate incoming IPC data before passing to callbacks
 */
function validateSyncStatusEvent(data: unknown): SyncStatusEvent | null {
  const result = SyncStatusEventSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  console.error("[preload] Invalid sync status event received:", result.error);
  return null;
}

/**
 * SEC-014: Validate navigation path
 */
function validateNavigationPath(path: unknown): string | null {
  if (typeof path !== "string") {
    console.error("[preload] Invalid navigation path received:", path);
    return null;
  }

  // SEC-014: Only allow known navigation paths
  const allowedPaths = ["/settings", "/dashboard", "/setup"];
  if (!allowedPaths.includes(path)) {
    console.error("[preload] Unknown navigation path:", path);
    return null;
  }

  return path;
}

// Expose the API to the renderer
contextBridge.exposeInMainWorld("nuvanaSyncAPI", {
  // Config
  getConfig: (): Promise<ConfigResponse> => ipcRenderer.invoke("config:get"),

  saveConfig: (config: NuvanaSyncConfigUpdate): Promise<SaveConfigResult> =>
    ipcRenderer.invoke("config:save", config),

  testConnection: (config: Partial<NuvanaSyncConfig>): Promise<TestConnectionResult> =>
    ipcRenderer.invoke("config:test-connection", config),

  // Sync
  getStats: (): Promise<SyncStats> => ipcRenderer.invoke("sync:get-stats"),

  getRecentFiles: (): Promise<FileRecord[]> =>
    ipcRenderer.invoke("sync:get-recent-files"),

  triggerSync: (): Promise<TriggerSyncResult> =>
    ipcRenderer.invoke("sync:trigger"),

  togglePause: (): Promise<TogglePauseResult> =>
    ipcRenderer.invoke("sync:toggle-pause"),

  // Events - with validation
  onSyncStatus: (callback: (data: SyncStatusEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: unknown): void => {
      const validated = validateSyncStatusEvent(data);
      if (validated) {
        callback(validated);
      }
    };
    ipcRenderer.on("sync-status", handler);
    return () => ipcRenderer.removeListener("sync-status", handler);
  },

  onNavigate: (callback: (path: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, path: unknown): void => {
      const validated = validateNavigationPath(path);
      if (validated) {
        callback(validated);
      }
    };
    ipcRenderer.on("navigate", handler);
    return () => ipcRenderer.removeListener("navigate", handler);
  },
} satisfies NuvanaSyncAPI);

// Declare the global type
declare global {
  interface Window {
    nuvanaSyncAPI: NuvanaSyncAPI;
  }
}
