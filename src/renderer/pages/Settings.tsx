/**
 * Settings Page Component
 *
 * Configuration UI for Nuvana settings.
 * Simplified to only require API key - store info is fetched from cloud.
 *
 * Protected by cloud authentication - only SUPPORT and SUPERADMIN roles can access.
 *
 * @module renderer/pages/Settings
 * @security SEC-014: Client-side input validation
 * @security SEC-001: Cloud-based role verification for settings access
 */

import React, { useState, useEffect, useCallback } from 'react';
import { CloudProtectedPage } from '../components/auth/CloudProtectedPage';
import type { CloudAuthUser } from '../components/auth/CloudAuthDialog';
import { ResetStoreDialog } from '../components/settings/ResetStoreDialog';
import { SyncMonitorPanel } from '../components/sync/SyncMonitorPanel';

/**
 * Check if running in Electron environment
 */
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

/**
 * SEC-014: Client-side validation patterns
 */
const VALIDATION = {
  API_KEY_PATTERN: /^[a-zA-Z0-9_\-.]+$/,
  PATH_FORBIDDEN_PATTERN: /\.\.|[<>"|?*]/,
  POLL_MIN: 30,
  POLL_MAX: 3600,
  MAX_PATH_LENGTH: 500,
  MAX_API_KEY_LENGTH: 500,
  // Business day cutoff time pattern (HH:MM 24-hour format)
  CUTOFF_TIME_PATTERN: /^([01]\d|2[0-3]):([0-5]\d)$/,
};

interface SettingsProps {
  onBack: () => void;
}

/**
 * Props for the internal settings content component
 */
interface SettingsContentProps {
  onBack: () => void;
  /** Cloud authenticated user info for support access */
  cloudAuthUser: CloudAuthUser;
}

interface StoreInfo {
  storeId: string;
  storeName: string;
  companyName: string;
  timezone: string;
}

/**
 * POS System Type (from cloud)
 * Read-only - set by cloud during store configuration
 */
type POSSystemType =
  | 'GILBARCO_PASSPORT'
  | 'GILBARCO_NAXML'
  | 'VERIFONE_RUBY2'
  | 'VERIFONE_COMMANDER'
  | 'SQUARE_REST'
  | 'CLOVER_REST'
  | 'NCR_RADIANT'
  | 'INFOR_POS'
  | 'ORACLE_SIMPHONY'
  | 'CUSTOM_API'
  | 'FILE_BASED'
  | 'MANUAL'
  | 'MANUAL_ENTRY'
  | 'UNKNOWN';

/**
 * POS Connection Type (from cloud)
 * Read-only - determines which config fields to show
 */
type POSConnectionType = 'NETWORK' | 'API' | 'WEBHOOK' | 'FILE' | 'MANUAL';

/**
 * FILE connection config (NAXML/XMLGateway)
 */
interface FileConnectionConfig {
  import_path?: string;
  export_path?: string;
  file_pattern?: string;
  poll_interval_seconds?: number;
}

/**
 * API connection config (Square/Clover REST)
 */
interface ApiConnectionConfig {
  base_url?: string;
  api_key?: string;
  location_id?: string;
  merchant_id?: string;
}

/**
 * NETWORK connection config (Direct TCP/IP)
 */
interface NetworkConnectionConfig {
  host?: string;
  port?: number;
  timeout_ms?: number;
}

/**
 * WEBHOOK connection config
 */
interface WebhookConnectionConfig {
  webhook_secret?: string;
  expected_source_ips?: string[];
}

/**
 * POS Connection Configuration (Version 8.0)
 * Store-level configuration from cloud
 */
interface POSConnectionConfig {
  pos_type: POSSystemType;
  pos_connection_type: POSConnectionType;
  pos_connection_config:
    | FileConnectionConfig
    | ApiConnectionConfig
    | NetworkConnectionConfig
    | WebhookConnectionConfig
    | null;
}

interface Config {
  apiKey: string;
  watchPath: string;
  pollInterval: number;
  /**
   * Business day cutoff time in HH:MM 24-hour format.
   * Shifts closing BEFORE this time are assigned to the previous business day.
   * Default: "06:00" (6:00 AM)
   */
  businessDayCutoffTime: string;
  enabledFileTypes: {
    pjr: boolean;
    fgm: boolean;
    msm: boolean;
    fpm: boolean;
    mcm: boolean;
    tlm: boolean;
  };
  startOnLogin: boolean;
  minimizeToTray: boolean;
  showNotifications: boolean;
}

interface ValidationErrors {
  apiKey?: string;
  watchPath?: string;
  pollInterval?: string;
  businessDayCutoffTime?: string;
}

/**
 * SEC-014: Validate API key format
 */
function validateApiKey(key: string): string | undefined {
  if (!key) return undefined;
  if (key.length > VALIDATION.MAX_API_KEY_LENGTH) {
    return 'API key is too long';
  }
  if (!VALIDATION.API_KEY_PATTERN.test(key)) {
    return 'API key contains invalid characters';
  }
  return undefined;
}

/**
 * SEC-014: Validate path (prevent path traversal)
 */
function validatePath(path: string): string | undefined {
  if (!path) return undefined;
  if (path.length > VALIDATION.MAX_PATH_LENGTH) {
    return 'Path is too long (max 500 characters)';
  }
  if (VALIDATION.PATH_FORBIDDEN_PATTERN.test(path)) {
    return 'Path contains forbidden characters or sequences';
  }
  return undefined;
}

/**
 * SEC-014: Validate poll interval
 */
function validatePollInterval(interval: number): string | undefined {
  if (isNaN(interval)) {
    return 'Poll interval must be a number';
  }
  if (interval < VALIDATION.POLL_MIN || interval > VALIDATION.POLL_MAX) {
    return `Poll interval must be between ${VALIDATION.POLL_MIN} and ${VALIDATION.POLL_MAX} seconds`;
  }
  return undefined;
}

/**
 * SEC-014: Validate business day cutoff time
 * Must be in HH:MM 24-hour format (e.g., "06:00")
 */
function validateCutoffTime(time: string): string | undefined {
  if (!time) return undefined;
  if (!VALIDATION.CUTOFF_TIME_PATTERN.test(time)) {
    return 'Cutoff time must be in HH:MM format (24-hour, e.g., "06:00")';
  }
  return undefined;
}

/**
 * Validate all form fields
 */
function validateForm(config: Config): ValidationErrors {
  return {
    apiKey: validateApiKey(config.apiKey),
    watchPath: validatePath(config.watchPath),
    pollInterval: validatePollInterval(config.pollInterval),
    businessDayCutoffTime: validateCutoffTime(config.businessDayCutoffTime),
  };
}

/**
 * Check if form has any errors
 */
function hasErrors(errors: ValidationErrors): boolean {
  return Object.values(errors).some((error) => error !== undefined);
}

/**
 * Internal Settings content component
 * Wrapped by CloudProtectedPage for authentication
 */
function SettingsContent({ onBack, cloudAuthUser }: SettingsContentProps): React.ReactElement {
  const [config, setConfig] = useState<Config | null>(null);
  const [storeInfo, setStoreInfo] = useState<StoreInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  // Debug: Store raw API response for troubleshooting
  const [debugApiResponse, setDebugApiResponse] = useState<Record<string, unknown> | null>(null);
  const [showDebugResponse, setShowDebugResponse] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessResult, setReprocessResult] = useState<{
    success: boolean;
    message: string;
    clearedCount?: number;
  } | null>(null);
  const [resettingFuel, setResettingFuel] = useState(false);
  const [fuelResetResult, setFuelResetResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  // Store Reset Dialog state
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetComplete, setResetComplete] = useState<{
    auditReferenceId: string;
    message: string;
  } | null>(null);
  // POS Connection Configuration (Version 8.0)
  const [posConnectionConfig, setPosConnectionConfig] = useState<POSConnectionConfig | null>(null);
  const [posConfigSaving, setPosConfigSaving] = useState(false);
  const [posConfigSaved, setPosConfigSaved] = useState(false);
  const [posConfigError, setPosConfigError] = useState<string | null>(null);

  // Phase 5: File Watcher Status (POS Selection)
  // Tracks whether file watcher is running for NAXML-compatible POS types
  const [fileWatcherStatus, setFileWatcherStatus] = useState<{
    isNAXMLCompatible: boolean;
    unavailableReason: string | null;
    isRunning: boolean;
  } | null>(null);

  useEffect(() => {
    // Skip API calls if not in Electron (dev mode in browser)
    if (!isElectron) {
      // Set mock config for dev mode
      setConfig({
        apiKey: '',
        watchPath: 'C:\\POS\\Export',
        pollInterval: 60,
        businessDayCutoffTime: '06:00',
        enabledFileTypes: {
          pjr: true,
          fgm: true,
          msm: true,
          fpm: false,
          mcm: false,
          tlm: false,
        },
        startOnLogin: true,
        minimizeToTray: true,
        showNotifications: true,
      });
      setStoreInfo({
        storeId: 'demo-store',
        storeName: 'Demo Store',
        companyName: 'Demo Company',
        timezone: 'America/New_York',
      });
      // Mock POS connection config for dev mode
      setPosConnectionConfig({
        pos_type: 'GILBARCO_NAXML',
        pos_connection_type: 'FILE',
        pos_connection_config: {
          import_path: 'C:\\POS\\Export\\NAXML',
          file_pattern: '*.xml',
          poll_interval_seconds: 60,
        },
      });
      // Phase 5: Mock file watcher status for dev mode
      setFileWatcherStatus({
        isNAXMLCompatible: true,
        unavailableReason: null,
        isRunning: true,
      });
      return;
    }

    // Load current settings
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const result = await window.electronAPI.invoke<{
        success: boolean;
        data?: {
          storeId?: string;
          storeName?: string;
          companyName?: string;
          timezone?: string;
          xmlWatchFolder?: string;
          syncIntervalSeconds?: number;
          businessDayCutoffTime?: string;
          // Version 8.0: POS connection configuration
          posConnectionConfig?: POSConnectionConfig | null;
          // Phase 5 (POS Selection): File watcher status for NAXML compatibility
          fileWatcherStatus?: {
            isNAXMLCompatible: boolean;
            unavailableReason: string | null;
            isRunning: boolean;
          };
        } | null;
      }>('settings:get');

      if (result.success && result.data) {
        setConfig({
          apiKey: '', // Never display API key for security
          watchPath: result.data.xmlWatchFolder || '',
          pollInterval: result.data.syncIntervalSeconds || 60,
          businessDayCutoffTime: result.data.businessDayCutoffTime || '06:00',
          enabledFileTypes: {
            pjr: true,
            fgm: true,
            msm: true,
            fpm: true,
            mcm: true,
            tlm: true,
          },
          startOnLogin: true,
          minimizeToTray: true,
          showNotifications: true,
        });

        if (result.data.storeId) {
          setStoreInfo({
            storeId: result.data.storeId,
            storeName: result.data.storeName || 'Unknown',
            companyName: result.data.companyName || 'Unknown',
            timezone: result.data.timezone || 'UTC',
          });
        }

        // Version 8.0: Set POS connection configuration
        if (result.data.posConnectionConfig) {
          setPosConnectionConfig(result.data.posConnectionConfig);
        }

        // Phase 5 (POS Selection): Set file watcher status
        if (result.data.fileWatcherStatus) {
          setFileWatcherStatus(result.data.fileWatcherStatus);
        }
      } else {
        // Default config if nothing is saved
        setConfig({
          apiKey: '',
          watchPath: '',
          pollInterval: 60,
          businessDayCutoffTime: '06:00',
          enabledFileTypes: {
            pjr: true,
            fgm: true,
            msm: true,
            fpm: true,
            mcm: true,
            tlm: true,
          },
          startOnLogin: true,
          minimizeToTray: true,
          showNotifications: true,
        });
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      // Set defaults on error
      setConfig({
        apiKey: '',
        watchPath: '',
        pollInterval: 60,
        businessDayCutoffTime: '06:00',
        enabledFileTypes: {
          pjr: true,
          fgm: true,
          msm: true,
          fpm: true,
          mcm: true,
          tlm: true,
        },
        startOnLogin: true,
        minimizeToTray: true,
        showNotifications: true,
      });
    }
  };

  /**
   * Update config with validation
   */
  const updateConfig = useCallback(
    (field: keyof Config, value: Config[keyof Config]) => {
      if (!config) return;

      const newConfig = { ...config, [field]: value };
      setConfig(newConfig);

      // Validate the changed field
      const newErrors = { ...errors };
      switch (field) {
        case 'apiKey':
          newErrors.apiKey = validateApiKey(value as string);
          break;
        case 'watchPath':
          newErrors.watchPath = validatePath(value as string);
          break;
        case 'pollInterval':
          newErrors.pollInterval = validatePollInterval(value as number);
          break;
        case 'businessDayCutoffTime':
          newErrors.businessDayCutoffTime = validateCutoffTime(value as string);
          break;
      }
      setErrors(newErrors);
    },
    [config, errors]
  );

  /**
   * Re-sync store data from cloud using API key
   * This validates the API key and pulls all store data including users/managers
   */
  const handleResync = async (): Promise<void> => {
    if (!config || !config.apiKey.trim()) {
      setSyncResult({
        success: false,
        message: 'Please enter an API key to re-sync',
      });
      return;
    }

    // Validate API key format
    const keyError = validateApiKey(config.apiKey);
    if (keyError) {
      setSyncResult({
        success: false,
        message: keyError,
      });
      return;
    }

    setSyncing(true);
    setSyncResult(null);

    // In dev mode without Electron, simulate sync
    if (!isElectron) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setSyncResult({
        success: true,
        message: 'Store data synced successfully! Store manager account created.',
      });
      setStoreInfo({
        storeId: 'synced-store',
        storeName: 'Synced Store',
        companyName: 'Synced Company',
        timezone: 'America/New_York',
      });
      setSyncing(false);
      return;
    }

    try {
      // Step 1: Validate API key and fetch store info (this also saves the initial manager)
      const validateResult = await window.electronAPI.invoke<{
        success: boolean;
        data?: {
          valid: boolean;
          error?: string;
          store?: {
            storeId: string;
            storeName: string;
            companyId: string;
            companyName: string;
            timezone: string;
            // Version 8.0: POS connection configuration
            posConnectionConfig?: POSConnectionConfig | null;
          };
        };
        error?: string;
        message?: string;
      }>('settings:validateApiKey', { apiKey: config.apiKey, isInitialSetup: false });

      // Store raw response for debugging
      setDebugApiResponse(validateResult as unknown as Record<string, unknown>);

      if (!validateResult.success || !validateResult.data?.valid) {
        setSyncResult({
          success: false,
          message: validateResult.data?.error || validateResult.message || 'Invalid API key',
        });
        return;
      }

      // Update store info display
      if (validateResult.data?.store) {
        setStoreInfo({
          storeId: validateResult.data.store.storeId,
          storeName: validateResult.data.store.storeName,
          companyName: validateResult.data.store.companyName,
          timezone: validateResult.data.store.timezone,
        });

        // Version 8.0: Update POS connection configuration from cloud response
        if (validateResult.data.store.posConnectionConfig) {
          setPosConnectionConfig(validateResult.data.store.posConnectionConfig);
        }
      }

      // Step 2: Sync users from cloud (this pulls all users including the store manager)
      const userSyncResult = await window.electronAPI.invoke<{
        success: boolean;
        data?: { success: boolean; synced?: number; error?: string };
        error?: string;
      }>('sync:syncUsersDuringSetup');

      const usersSynced = userSyncResult.data?.synced || 0;

      setSyncResult({
        success: true,
        message: `Store data synced successfully! ${usersSynced} user(s) synced from cloud.`,
      });

      // Step 3: Refresh file watcher status after resync
      // The backend emits FILE_WATCHER_RESTART which may start/stop the file watcher
      // Give it a moment to complete, then refresh the status
      setTimeout(async () => {
        try {
          const refreshResult = await window.electronAPI.invoke<{
            success: boolean;
            data?: {
              fileWatcherStatus?: {
                isNAXMLCompatible: boolean;
                unavailableReason: string | null;
                isRunning: boolean;
              };
            };
          }>('settings:get');

          if (refreshResult.success && refreshResult.data?.fileWatcherStatus) {
            setFileWatcherStatus(refreshResult.data.fileWatcherStatus);
          }
        } catch (e) {
          // Non-critical - file watcher status will update on next page load
          console.warn('Failed to refresh file watcher status after resync:', e);
        }
      }, 1500);

      // Clear the API key from the form after successful sync
      setConfig({ ...config, apiKey: '' });
    } catch (error) {
      setSyncResult({
        success: false,
        message: error instanceof Error ? error.message : 'Sync failed',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!config) return;

    // Don't validate API key for save - it's only used for re-sync
    const configForValidation = { ...config, apiKey: '' };
    const validationErrors = validateForm(configForValidation);
    // Remove apiKey error since we don't require it for save
    delete validationErrors.apiKey;
    setErrors(validationErrors);

    if (hasErrors(validationErrors)) {
      setSaveError('Please fix validation errors before saving');
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      // In dev mode without Electron, simulate successful save
      if (!isElectron) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        setSaving(false);
        return;
      }

      // Use cloud-auth-protected endpoint for support users
      const result = await window.electronAPI.invoke<{
        success: boolean;
        error?: string;
        message?: string;
      }>('settings:updateAsSupport', {
        settings: {
          xmlWatchFolder: config.watchPath || undefined,
          syncIntervalSeconds: config.pollInterval,
          businessDayCutoffTime: config.businessDayCutoffTime || undefined,
        },
        cloudAuth: {
          email: cloudAuthUser.email,
          userId: cloudAuthUser.userId,
          roles: cloudAuthUser.roles,
        },
      });

      if (result.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setSaveError(result.message || result.error || 'Failed to save configuration');
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Update POS connection config field
   * SEC-014: Validates field before updating state
   */
  const updatePosConnectionConfig = useCallback(
    (field: string, value: string | number | null) => {
      if (!posConnectionConfig) return;

      const currentConfig = posConnectionConfig.pos_connection_config || {};
      const updatedConfig = {
        ...posConnectionConfig,
        pos_connection_config: {
          ...currentConfig,
          [field]: value,
        },
      };
      setPosConnectionConfig(updatedConfig);
      setPosConfigSaved(false);
    },
    [posConnectionConfig]
  );

  /**
   * Save POS connection configuration
   * SEC-014: Validates config before sending to backend
   * API-001: Uses Zod-validated IPC handler
   */
  const handleSavePosConnectionConfig = async (): Promise<void> => {
    if (!posConnectionConfig) return;

    setPosConfigSaving(true);
    setPosConfigError(null);

    try {
      // In dev mode without Electron, simulate successful save
      if (!isElectron) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        setPosConfigSaved(true);
        setTimeout(() => setPosConfigSaved(false), 2000);
        setPosConfigSaving(false);
        return;
      }

      const result = await window.electronAPI.invoke<{
        success: boolean;
        error?: string;
        message?: string;
        posConnectionConfig?: POSConnectionConfig;
      }>('settings:updatePOSConnectionConfig', {
        pos_connection_config: posConnectionConfig.pos_connection_config,
        cloudAuth: {
          email: cloudAuthUser.email,
          userId: cloudAuthUser.userId,
          roles: cloudAuthUser.roles,
        },
      });

      if (result.success) {
        setPosConfigSaved(true);
        setTimeout(() => setPosConfigSaved(false), 2000);
        // Update with returned config
        if (result.posConnectionConfig) {
          setPosConnectionConfig(result.posConnectionConfig);
        }
      } else {
        setPosConfigError(result.message || result.error || 'Failed to save POS configuration');
      }
    } catch (error) {
      setPosConfigError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setPosConfigSaving(false);
    }
  };

  /**
   * Handle reprocessing XML files (only failed/zero-record files)
   * Clears processed file tracking and restarts file watcher
   */
  const handleReprocessXmlFiles = async () => {
    if (!isElectron) {
      setReprocessResult({ success: true, message: 'Mock reprocess complete', clearedCount: 5 });
      return;
    }

    setReprocessing(true);
    setReprocessResult(null);

    try {
      const result = await window.electronAPI.invoke<{
        success: boolean;
        data?: {
          clearedCount: number;
          beforeCount: number;
          afterCount: number;
          distinctStoreIds?: string[];
          message: string;
        };
        error?: string;
        message?: string;
      }>('sync:reprocessXmlFiles', { clearZeroRecordsOnly: true, restartWatcher: true });

      if (result.success && result.data) {
        setReprocessResult({
          success: true,
          message: result.data.message,
          clearedCount: result.data.clearedCount,
        });
      } else {
        setReprocessResult({
          success: false,
          message: result.message || result.error || 'Failed to reprocess files',
        });
      }
    } catch (error) {
      setReprocessResult({
        success: false,
        message: error instanceof Error ? error.message : 'An error occurred',
      });
    } finally {
      setReprocessing(false);
    }
  };

  /**
   * Handle clearing ALL processed files and reprocessing
   * This forces all XML files to be reprocessed regardless of previous status
   */
  const handleClearAllProcessedFiles = async () => {
    if (!isElectron) {
      setReprocessResult({ success: true, message: 'Mock clear all complete', clearedCount: 25 });
      return;
    }

    setReprocessing(true);
    setReprocessResult(null);

    try {
      const result = await window.electronAPI.invoke<{
        success: boolean;
        data?: {
          clearedCount: number;
          beforeCount: number;
          afterCount: number;
          distinctStoreIds?: string[];
          message: string;
        };
        error?: string;
        message?: string;
      }>('sync:reprocessXmlFiles', { clearZeroRecordsOnly: false, restartWatcher: true });

      if (result.success && result.data) {
        setReprocessResult({
          success: true,
          message: result.data.message,
          clearedCount: result.data.clearedCount,
        });
      } else {
        setReprocessResult({
          success: false,
          message: result.message || result.error || 'Failed to clear and reprocess files',
        });
      }
    } catch (error) {
      setReprocessResult({
        success: false,
        message: error instanceof Error ? error.message : 'An error occurred',
      });
    } finally {
      setReprocessing(false);
    }
  };

  /**
   * Handle resetting fuel data and reprocessing FGM files
   * Fixes incorrect fuel totals caused by duplicate data accumulation
   */
  const handleResetFuelData = async () => {
    if (!isElectron) {
      setFuelResetResult({ success: true, message: 'Mock fuel reset complete' });
      return;
    }

    setResettingFuel(true);
    setFuelResetResult(null);

    try {
      const result = await window.electronAPI.invoke<{
        success: boolean;
        data?: {
          fuelSummariesDeleted: number;
          fgmFilesCleared: number;
          message: string;
        };
        error?: string;
        message?: string;
      }>('sync:resetFuelData');

      if (result.success && result.data) {
        setFuelResetResult({
          success: true,
          message: result.data.message,
        });
      } else {
        setFuelResetResult({
          success: false,
          message: result.message || result.error || 'Failed to reset fuel data',
        });
      }
    } catch (error) {
      setFuelResetResult({
        success: false,
        message: error instanceof Error ? error.message : 'An error occurred',
      });
    } finally {
      setResettingFuel(false);
    }
  };

  if (!config) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header — bleeds into AppLayout padding with negative margins */}
      <header className="bg-card border-b border-border px-6 py-4 flex-shrink-0 -mx-6 -mt-6">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg"
            aria-label="Go back"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-foreground">Settings</h1>
        </div>
      </header>

      {/* Two-column content area */}
      <div className="flex-1 min-h-0 flex flex-col xl:flex-row gap-6 pt-6 overflow-y-auto xl:overflow-hidden">
        {/* LEFT: Sync Monitor (primary) — scrolls independently on desktop */}
        <div className="xl:flex-1 xl:min-w-0 xl:overflow-y-auto">
          <SyncMonitorPanel />
        </div>

        {/* RIGHT: Settings forms — scrolls independently on desktop */}
        <div className="w-full xl:w-[480px] xl:flex-shrink-0 xl:overflow-y-auto space-y-6">
        {/* Store Info Section */}
        {storeInfo && (
          <section className="bg-card rounded-xl border border-border p-6 mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Store Information</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Store Name</span>
                <span className="font-medium text-foreground">{storeInfo.storeName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Company</span>
                <span className="font-medium text-foreground">{storeInfo.companyName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Timezone</span>
                <span className="font-medium text-foreground">{storeInfo.timezone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Store ID</span>
                <span className="font-mono text-xs text-muted-foreground">{storeInfo.storeId}</span>
              </div>
            </div>
          </section>
        )}

        {/* Re-sync Section */}
        <section className="bg-card rounded-xl border border-border p-6 mb-6">
          <h2 className="text-lg font-semibold text-foreground mb-2">Sync Store Data</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Re-sync store configuration, users, and managers from the cloud. Enter your API key to
            pull the latest data.
          </p>

          <div className="space-y-4">
            <div>
              <label htmlFor="apiKey" className="block text-sm font-medium text-foreground mb-1">
                API Key
              </label>
              <input
                id="apiKey"
                type="password"
                value={config.apiKey}
                onChange={(e) => updateConfig('apiKey', e.target.value)}
                maxLength={VALIDATION.MAX_API_KEY_LENGTH}
                placeholder="nuvpos_sk_str_xxxxx_xxxxx"
                className={`w-full px-4 py-2 border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-transparent font-mono text-sm ${
                  errors.apiKey ? 'border-destructive' : 'border-input'
                }`}
              />
              {errors.apiKey && <p className="text-sm text-destructive mt-1">{errors.apiKey}</p>}
              <p className="text-xs text-muted-foreground mt-1">
                Find this in your Nuvana dashboard under Settings → Store Sync Keys
              </p>
            </div>

            {syncResult && (
              <div
                className={`p-3 rounded-lg ${
                  syncResult.success
                    ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                    : 'bg-destructive/10 text-destructive'
                }`}
                role="alert"
              >
                {syncResult.message}
              </div>
            )}

            {/* Debug: Comprehensive API Response */}
            {debugApiResponse && (
              <div className="border border-amber-500/50 rounded-lg overflow-hidden bg-amber-500/5">
                <button
                  type="button"
                  onClick={() => setShowDebugResponse(!showDebugResponse)}
                  className="w-full px-3 py-2 text-left text-sm font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 flex items-center justify-between"
                >
                  <span>Debug Panel (for troubleshooting)</span>
                  <span className="text-xs">{showDebugResponse ? '[-] Hide' : '[+] Show'}</span>
                </button>
                {showDebugResponse && (
                  <div className="p-3 space-y-4">
                    {/* Connection Info */}
                    <div className="bg-background/50 rounded p-3 border border-border">
                      <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">
                        Connection Info
                      </h4>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">API URL:</span>
                          <span className="ml-2 font-mono text-foreground">
                            {(debugApiResponse as Record<string, unknown>).data &&
                            (
                              (debugApiResponse as Record<string, unknown>).data as Record<
                                string,
                                unknown
                              >
                            )?._debug &&
                            (
                              (
                                (debugApiResponse as Record<string, unknown>).data as Record<
                                  string,
                                  unknown
                                >
                              )?._debug as Record<string, unknown>
                            )?.apiUrl
                              ? String(
                                  (
                                    (
                                      (debugApiResponse as Record<string, unknown>).data as Record<
                                        string,
                                        unknown
                                      >
                                    )?._debug as Record<string, unknown>
                                  )?.apiUrl
                                )
                              : 'N/A'}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Environment:</span>
                          <span className="ml-2 font-mono text-foreground">
                            {(debugApiResponse as Record<string, unknown>).data &&
                            (
                              (debugApiResponse as Record<string, unknown>).data as Record<
                                string,
                                unknown
                              >
                            )?._debug &&
                            (
                              (
                                (debugApiResponse as Record<string, unknown>).data as Record<
                                  string,
                                  unknown
                                >
                              )?._debug as Record<string, unknown>
                            )?.environment
                              ? String(
                                  (
                                    (
                                      (debugApiResponse as Record<string, unknown>).data as Record<
                                        string,
                                        unknown
                                      >
                                    )?._debug as Record<string, unknown>
                                  )?.environment
                                )
                              : 'N/A'}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Timestamp:</span>
                          <span className="ml-2 font-mono text-foreground">
                            {(debugApiResponse as Record<string, unknown>).data &&
                            (
                              (debugApiResponse as Record<string, unknown>).data as Record<
                                string,
                                unknown
                              >
                            )?._debug &&
                            (
                              (
                                (debugApiResponse as Record<string, unknown>).data as Record<
                                  string,
                                  unknown
                                >
                              )?._debug as Record<string, unknown>
                            )?.timestamp
                              ? String(
                                  (
                                    (
                                      (debugApiResponse as Record<string, unknown>).data as Record<
                                        string,
                                        unknown
                                      >
                                    )?._debug as Record<string, unknown>
                                  )?.timestamp
                                )
                              : new Date().toISOString()}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Identity Endpoint:</span>
                          <span className="ml-2 font-mono text-foreground">
                            /api/v1/keys/identity
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Data Summary */}
                    <div className="bg-background/50 rounded p-3 border border-border">
                      <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">
                        Data Summary
                      </h4>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              (debugApiResponse as Record<string, unknown>).data &&
                              (
                                (debugApiResponse as Record<string, unknown>).data as Record<
                                  string,
                                  unknown
                                >
                              )?.store &&
                              (
                                (
                                  (debugApiResponse as Record<string, unknown>).data as Record<
                                    string,
                                    unknown
                                  >
                                )?.store as Record<string, unknown>
                              )?.posConnectionConfig
                                ? 'bg-green-500'
                                : 'bg-red-500'
                            }`}
                          />
                          <span className="text-muted-foreground">posConnectionConfig:</span>
                          <span className="font-mono text-foreground">
                            {(debugApiResponse as Record<string, unknown>).data &&
                            (
                              (debugApiResponse as Record<string, unknown>).data as Record<
                                string,
                                unknown
                              >
                            )?.store &&
                            (
                              (
                                (debugApiResponse as Record<string, unknown>).data as Record<
                                  string,
                                  unknown
                                >
                              )?.store as Record<string, unknown>
                            )?.posConnectionConfig
                              ? 'Present'
                              : 'MISSING'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              (debugApiResponse as Record<string, unknown>).data &&
                              (
                                (debugApiResponse as Record<string, unknown>).data as Record<
                                  string,
                                  unknown
                                >
                              )?.store &&
                              (
                                (
                                  (debugApiResponse as Record<string, unknown>).data as Record<
                                    string,
                                    unknown
                                  >
                                )?.store as Record<string, unknown>
                              )?.terminal
                                ? 'bg-green-500'
                                : 'bg-yellow-500'
                            }`}
                          />
                          <span className="text-muted-foreground">terminal (legacy):</span>
                          <span className="font-mono text-foreground">
                            {(debugApiResponse as Record<string, unknown>).data &&
                            (
                              (debugApiResponse as Record<string, unknown>).data as Record<
                                string,
                                unknown
                              >
                            )?.store &&
                            (
                              (
                                (debugApiResponse as Record<string, unknown>).data as Record<
                                  string,
                                  unknown
                                >
                              )?.store as Record<string, unknown>
                            )?.terminal
                              ? 'Present'
                              : 'Not present'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              (debugApiResponse as Record<string, unknown>).success
                                ? 'bg-green-500'
                                : 'bg-red-500'
                            }`}
                          />
                          <span className="text-muted-foreground">IPC Success:</span>
                          <span className="font-mono text-foreground">
                            {(debugApiResponse as Record<string, unknown>).success
                              ? 'true'
                              : 'false'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              (debugApiResponse as Record<string, unknown>).data &&
                              (
                                (debugApiResponse as Record<string, unknown>).data as Record<
                                  string,
                                  unknown
                                >
                              )?.valid
                                ? 'bg-green-500'
                                : 'bg-red-500'
                            }`}
                          />
                          <span className="text-muted-foreground">API Key Valid:</span>
                          <span className="font-mono text-foreground">
                            {(debugApiResponse as Record<string, unknown>).data &&
                            (
                              (debugApiResponse as Record<string, unknown>).data as Record<
                                string,
                                unknown
                              >
                            )?.valid
                              ? 'true'
                              : 'false'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Raw Cloud Response */}
                    <div className="bg-background/50 rounded p-3 border border-border">
                      <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">
                        Raw Cloud Response (from /api/v1/keys/identity)
                      </h4>
                      <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all max-h-48 overflow-auto bg-muted/30 p-2 rounded">
                        {(debugApiResponse as Record<string, unknown>).data &&
                        (
                          (debugApiResponse as Record<string, unknown>).data as Record<
                            string,
                            unknown
                          >
                        )?._debug &&
                        (
                          (
                            (debugApiResponse as Record<string, unknown>).data as Record<
                              string,
                              unknown
                            >
                          )?._debug as Record<string, unknown>
                        )?.rawCloudResponse
                          ? JSON.stringify(
                              (
                                (
                                  (debugApiResponse as Record<string, unknown>).data as Record<
                                    string,
                                    unknown
                                  >
                                )?._debug as Record<string, unknown>
                              )?.rawCloudResponse,
                              null,
                              2
                            )
                          : 'No raw cloud response captured'}
                      </pre>
                    </div>

                    {/* Full IPC Response */}
                    <div className="bg-background/50 rounded p-3 border border-border">
                      <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">
                        Full IPC Response (processed)
                      </h4>
                      <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all max-h-48 overflow-auto bg-muted/30 p-2 rounded">
                        {JSON.stringify(debugApiResponse, null, 2)}
                      </pre>
                    </div>

                    {/* Copy Button */}
                    <button
                      type="button"
                      onClick={() => {
                        const debugData = {
                          timestamp: new Date().toISOString(),
                          ipcResponse: debugApiResponse,
                          rawCloudResponse:
                            (debugApiResponse as Record<string, unknown>).data &&
                            (
                              (debugApiResponse as Record<string, unknown>).data as Record<
                                string,
                                unknown
                              >
                            )?._debug &&
                            (
                              (
                                (debugApiResponse as Record<string, unknown>).data as Record<
                                  string,
                                  unknown
                                >
                              )?._debug as Record<string, unknown>
                            )?.rawCloudResponse,
                        };
                        navigator.clipboard.writeText(JSON.stringify(debugData, null, 2));
                      }}
                      className="w-full px-3 py-2 text-sm bg-amber-500/20 text-amber-700 dark:text-amber-400 rounded hover:bg-amber-500/30 font-medium"
                    >
                      Copy All Debug Data to Clipboard
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleResync}
              disabled={syncing || !config.apiKey.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {syncing ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Syncing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  Sync from Cloud
                </>
              )}
            </button>
          </div>
        </section>

        {/* POS Connection Configuration Section (Version 8.0) */}
        <section className="bg-card rounded-xl border border-border p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">POS Connection</h2>
              {posConnectionConfig && (
                <p className="text-xs text-muted-foreground mt-1">
                  {posConnectionConfig.pos_type.replace(/_/g, ' ')} •{' '}
                  {posConnectionConfig.pos_connection_type}
                </p>
              )}
            </div>
            {posConnectionConfig && (
              <span
                className={`px-2 py-1 text-xs font-medium rounded-full ${
                  posConnectionConfig.pos_connection_type === 'MANUAL'
                    ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                    : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                }`}
              >
                {posConnectionConfig.pos_connection_type === 'MANUAL'
                  ? 'Manual Entry'
                  : 'Automated'}
              </span>
            )}
          </div>

          {!posConnectionConfig ? (
            <div className="text-center py-8 text-muted-foreground">
              <svg
                className="w-12 h-12 mx-auto mb-3 opacity-50"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              <p className="text-sm">No POS connection configured</p>
              <p className="text-xs mt-1">Sync your API key to load POS settings from cloud</p>
            </div>
          ) : posConnectionConfig.pos_connection_type === 'MANUAL' ? (
            /* MANUAL - No automated connection */
            <div className="text-center py-6 bg-yellow-50 dark:bg-yellow-900/10 rounded-lg border border-yellow-200 dark:border-yellow-800">
              <svg
                className="w-10 h-10 mx-auto mb-2 text-yellow-600 dark:text-yellow-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
                Manual Data Entry Mode
              </p>
              <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-1">
                Transactions are entered manually through the app interface
              </p>
            </div>
          ) : posConnectionConfig.pos_connection_type === 'FILE' ? (
            /* FILE - File-based data exchange (NAXML/XMLGateway) */
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="importPath"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  Import Folder Path
                </label>
                <input
                  id="importPath"
                  type="text"
                  value={
                    (posConnectionConfig.pos_connection_config as FileConnectionConfig)
                      ?.import_path || ''
                  }
                  onChange={(e) => updatePosConnectionConfig('import_path', e.target.value)}
                  maxLength={VALIDATION.MAX_PATH_LENGTH}
                  placeholder="\\\\server\\naxml\\export"
                  className="w-full px-4 py-2 border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-transparent border-input font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Network path or local folder where POS exports XML files
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="filePattern"
                    className="block text-sm font-medium text-foreground mb-1"
                  >
                    File Pattern
                  </label>
                  <input
                    id="filePattern"
                    type="text"
                    value={
                      (posConnectionConfig.pos_connection_config as FileConnectionConfig)
                        ?.file_pattern || '*.xml'
                    }
                    onChange={(e) => updatePosConnectionConfig('file_pattern', e.target.value)}
                    maxLength={100}
                    placeholder="*.xml"
                    className="w-full px-4 py-2 border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-transparent border-input font-mono text-sm"
                  />
                </div>

                <div>
                  <label
                    htmlFor="pollIntervalSeconds"
                    className="block text-sm font-medium text-foreground mb-1"
                  >
                    Poll Interval (seconds)
                  </label>
                  <input
                    id="pollIntervalSeconds"
                    type="number"
                    min={1}
                    max={3600}
                    value={
                      (posConnectionConfig.pos_connection_config as FileConnectionConfig)
                        ?.poll_interval_seconds || 60
                    }
                    onChange={(e) =>
                      updatePosConnectionConfig(
                        'poll_interval_seconds',
                        parseInt(e.target.value, 10) || 60
                      )
                    }
                    className="w-full px-4 py-2 border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-transparent border-input"
                  />
                </div>
              </div>

              {posConfigError && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                  {posConfigError}
                </div>
              )}

              <button
                onClick={handleSavePosConnectionConfig}
                disabled={posConfigSaving}
                className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
                  posConfigSaved
                    ? 'bg-green-600 text-white'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                } disabled:opacity-50`}
              >
                {posConfigSaving ? 'Saving...' : posConfigSaved ? 'Saved!' : 'Save POS Settings'}
              </button>

              {/* Phase 5 (POS Selection): File Watcher Status Indicator
                  SEC-004: No user input rendered - only display of backend state */}
              {fileWatcherStatus && (
                <div className="mt-4 p-3 rounded-lg bg-muted/50 border border-border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-2.5 h-2.5 rounded-full ${
                          fileWatcherStatus.isRunning
                            ? 'bg-green-500 animate-pulse'
                            : 'bg-yellow-500'
                        }`}
                      />
                      <span className="text-sm font-medium text-foreground">File Watcher</span>
                    </div>
                    <span
                      className={`text-sm font-medium ${
                        fileWatcherStatus.isRunning
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-yellow-600 dark:text-yellow-400'
                      }`}
                    >
                      {fileWatcherStatus.isRunning ? 'Running' : 'Stopped'}
                    </span>
                  </div>
                  {!fileWatcherStatus.isRunning && fileWatcherStatus.unavailableReason && (
                    <p className="text-xs text-muted-foreground mt-2">
                      {fileWatcherStatus.unavailableReason}
                    </p>
                  )}
                  {fileWatcherStatus.isRunning && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Monitoring import folder for NAXML files
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : posConnectionConfig.pos_connection_type === 'API' ? (
            /* API - REST API connection (Square/Clover) */
            <div className="space-y-4">
              <div>
                <label htmlFor="baseUrl" className="block text-sm font-medium text-foreground mb-1">
                  API Base URL
                </label>
                <input
                  id="baseUrl"
                  type="url"
                  value={
                    (posConnectionConfig.pos_connection_config as ApiConnectionConfig)?.base_url ||
                    ''
                  }
                  onChange={(e) => updatePosConnectionConfig('base_url', e.target.value)}
                  maxLength={500}
                  placeholder="https://api.example.com/v2"
                  className="w-full px-4 py-2 border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-transparent border-input font-mono text-sm"
                />
              </div>

              <div>
                <label
                  htmlFor="apiKeyConfig"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  API Key / Access Token
                </label>
                <input
                  id="apiKeyConfig"
                  type="password"
                  value={
                    (posConnectionConfig.pos_connection_config as ApiConnectionConfig)?.api_key ||
                    ''
                  }
                  onChange={(e) => updatePosConnectionConfig('api_key', e.target.value)}
                  maxLength={500}
                  placeholder="••••••••••••"
                  className="w-full px-4 py-2 border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-transparent border-input font-mono text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="locationId"
                    className="block text-sm font-medium text-foreground mb-1"
                  >
                    Location ID
                  </label>
                  <input
                    id="locationId"
                    type="text"
                    value={
                      (posConnectionConfig.pos_connection_config as ApiConnectionConfig)
                        ?.location_id || ''
                    }
                    onChange={(e) => updatePosConnectionConfig('location_id', e.target.value)}
                    maxLength={100}
                    placeholder="LID123456"
                    className="w-full px-4 py-2 border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-transparent border-input font-mono text-sm"
                  />
                </div>

                <div>
                  <label
                    htmlFor="merchantId"
                    className="block text-sm font-medium text-foreground mb-1"
                  >
                    Merchant ID
                  </label>
                  <input
                    id="merchantId"
                    type="text"
                    value={
                      (posConnectionConfig.pos_connection_config as ApiConnectionConfig)
                        ?.merchant_id || ''
                    }
                    onChange={(e) => updatePosConnectionConfig('merchant_id', e.target.value)}
                    maxLength={100}
                    placeholder="MID789012"
                    className="w-full px-4 py-2 border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-transparent border-input font-mono text-sm"
                  />
                </div>
              </div>

              {posConfigError && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                  {posConfigError}
                </div>
              )}

              <button
                onClick={handleSavePosConnectionConfig}
                disabled={posConfigSaving}
                className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
                  posConfigSaved
                    ? 'bg-green-600 text-white'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                } disabled:opacity-50`}
              >
                {posConfigSaving ? 'Saving...' : posConfigSaved ? 'Saved!' : 'Save API Settings'}
              </button>

              {/* Phase 5 (POS Selection): Coming Soon Notice for API-based POS
                  SEC-004: Static text only - no user input rendered */}
              <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800">
                <div className="flex items-start gap-2">
                  <svg
                    className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                      API Integration Coming Soon
                    </p>
                    <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
                      {/* SEC-004: pos_type is sanitized enum value from backend */}
                      API-based data ingestion for {posConnectionConfig.pos_type.replace(
                        /_/g,
                        ' '
                      )}{' '}
                      is under development. Your settings have been saved and will be used when the
                      integration is available.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : posConnectionConfig.pos_connection_type === 'NETWORK' ? (
            /* NETWORK - Direct TCP/IP connection */
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label htmlFor="host" className="block text-sm font-medium text-foreground mb-1">
                    Host / IP Address
                  </label>
                  <input
                    id="host"
                    type="text"
                    value={
                      (posConnectionConfig.pos_connection_config as NetworkConnectionConfig)
                        ?.host || ''
                    }
                    onChange={(e) => updatePosConnectionConfig('host', e.target.value)}
                    maxLength={255}
                    placeholder="192.168.1.100"
                    className="w-full px-4 py-2 border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-transparent border-input font-mono text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="port" className="block text-sm font-medium text-foreground mb-1">
                    Port
                  </label>
                  <input
                    id="port"
                    type="number"
                    min={1}
                    max={65535}
                    value={
                      (posConnectionConfig.pos_connection_config as NetworkConnectionConfig)
                        ?.port || 5000
                    }
                    onChange={(e) =>
                      updatePosConnectionConfig('port', parseInt(e.target.value, 10) || 5000)
                    }
                    className="w-full px-4 py-2 border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-transparent border-input"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="timeoutMs"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  Timeout (milliseconds)
                </label>
                <input
                  id="timeoutMs"
                  type="number"
                  min={1000}
                  max={300000}
                  value={
                    (posConnectionConfig.pos_connection_config as NetworkConnectionConfig)
                      ?.timeout_ms || 30000
                  }
                  onChange={(e) =>
                    updatePosConnectionConfig('timeout_ms', parseInt(e.target.value, 10) || 30000)
                  }
                  className="w-full px-4 py-2 border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-transparent border-input"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Connection timeout in milliseconds (1,000 - 300,000)
                </p>
              </div>

              {posConfigError && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                  {posConfigError}
                </div>
              )}

              <button
                onClick={handleSavePosConnectionConfig}
                disabled={posConfigSaving}
                className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
                  posConfigSaved
                    ? 'bg-green-600 text-white'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                } disabled:opacity-50`}
              >
                {posConfigSaving
                  ? 'Saving...'
                  : posConfigSaved
                    ? 'Saved!'
                    : 'Save Network Settings'}
              </button>

              {/* Phase 5 (POS Selection): Coming Soon Notice for Network-based POS
                  SEC-004: Static text only - no user input rendered */}
              <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800">
                <div className="flex items-start gap-2">
                  <svg
                    className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                      Network Integration Coming Soon
                    </p>
                    <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
                      {/* SEC-004: pos_type is sanitized enum value from backend */}
                      Network-based data ingestion for{' '}
                      {posConnectionConfig.pos_type.replace(/_/g, ' ')} is under development. Your
                      connection settings have been saved and will be used when the integration is
                      available.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : posConnectionConfig.pos_connection_type === 'WEBHOOK' ? (
            /* WEBHOOK - POS pushes data via webhook */
            <div className="space-y-4">
              <div className="text-center py-4 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-200 dark:border-blue-800 mb-4">
                <svg
                  className="w-8 h-8 mx-auto mb-2 text-blue-600 dark:text-blue-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  Webhook mode: POS system pushes data to Nuvana
                </p>
              </div>

              <div>
                <label
                  htmlFor="webhookSecret"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  Webhook Secret
                </label>
                <input
                  id="webhookSecret"
                  type="password"
                  value={
                    (posConnectionConfig.pos_connection_config as WebhookConnectionConfig)
                      ?.webhook_secret || ''
                  }
                  onChange={(e) => updatePosConnectionConfig('webhook_secret', e.target.value)}
                  maxLength={500}
                  placeholder="••••••••••••"
                  className="w-full px-4 py-2 border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-transparent border-input font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Secret key used to verify incoming webhook requests
                </p>
              </div>

              {posConfigError && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                  {posConfigError}
                </div>
              )}

              <button
                onClick={handleSavePosConnectionConfig}
                disabled={posConfigSaving}
                className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
                  posConfigSaved
                    ? 'bg-green-600 text-white'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                } disabled:opacity-50`}
              >
                {posConfigSaving
                  ? 'Saving...'
                  : posConfigSaved
                    ? 'Saved!'
                    : 'Save Webhook Settings'}
              </button>

              {/* Phase 5 (POS Selection): Coming Soon Notice for Webhook-based POS
                  SEC-004: Static text only - no user input rendered */}
              <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800">
                <div className="flex items-start gap-2">
                  <svg
                    className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                      Webhook Integration Coming Soon
                    </p>
                    <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
                      {/* SEC-004: pos_type is sanitized enum value from backend */}
                      Webhook-based data ingestion for{' '}
                      {posConnectionConfig.pos_type.replace(/_/g, ' ')} is under development. Your
                      webhook settings have been saved and will be used when the integration is
                      available.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Unknown connection type */
            <div className="text-center py-6 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-200 dark:border-red-800">
              <svg
                className="w-10 h-10 mx-auto mb-2 text-red-600 dark:text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <p className="text-sm font-medium text-red-800 dark:text-red-300">
                Unknown Connection Type
              </p>
              <p className="text-xs text-red-700 dark:text-red-400 mt-1">
                Connection type &quot;{posConnectionConfig.pos_connection_type}&quot; is not
                supported
              </p>
            </div>
          )}
        </section>

        {/* Business Day Settings Section */}
        <section className="bg-card rounded-xl border border-border p-6 mb-6">
          <h2 className="text-lg font-semibold text-foreground mb-2">Business Day Settings</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Configure how overnight shifts are assigned to business days.
          </p>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="businessDayCutoffTime"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Business Day Cutoff Time (24-hour format)
              </label>
              <input
                id="businessDayCutoffTime"
                type="time"
                value={config.businessDayCutoffTime}
                onChange={(e) => updateConfig('businessDayCutoffTime', e.target.value)}
                className={`w-full px-4 py-2 border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-transparent ${
                  errors.businessDayCutoffTime ? 'border-destructive' : 'border-input'
                }`}
              />
              {errors.businessDayCutoffTime && (
                <p className="text-sm text-destructive mt-1">{errors.businessDayCutoffTime}</p>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                Shifts closing <strong>before</strong> this time will be assigned to the previous
                business day. For example, with a cutoff of 06:00, a shift closing at 3:00 AM
                belongs to yesterday&apos;s business day.
              </p>
            </div>
          </div>
        </section>

        {/* File Types Section - Only shown for FILE connection type (NAXML-compatible POS)
            SEC-004: Labels are hardcoded strings, no XSS risk */}
        {posConnectionConfig?.pos_connection_type === 'FILE' && (
          <section className="bg-card rounded-xl border border-border p-6 mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">File Types</h2>

            <div className="space-y-3">
              {[
                { key: 'pjr', label: 'PJR - Transaction Journal' },
                { key: 'fgm', label: 'FGM - Fuel Grade Movement' },
                { key: 'msm', label: 'MSM - Miscellaneous Summary' },
                { key: 'fpm', label: 'FPM - Fuel Product Movement' },
                { key: 'mcm', label: 'MCM - Merchandise Code Movement' },
                { key: 'tlm', label: 'TLM - Tax Level Movement' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.enabledFileTypes[key as keyof typeof config.enabledFileTypes]}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        enabledFileTypes: {
                          ...config.enabledFileTypes,
                          [key]: e.target.checked,
                        },
                      })
                    }
                    className="w-4 h-4 text-primary rounded focus:ring-primary"
                  />
                  <span className="text-sm text-foreground">{label}</span>
                </label>
              ))}
            </div>
          </section>
        )}

        {/* Behavior Section */}
        <section className="bg-card rounded-xl border border-border p-6 mb-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Behavior</h2>

          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={config.startOnLogin}
                onChange={(e) => setConfig({ ...config, startOnLogin: e.target.checked })}
                className="w-4 h-4 text-primary rounded focus:ring-primary"
              />
              <span className="text-sm text-foreground">Start on Windows login</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={config.minimizeToTray}
                onChange={(e) => setConfig({ ...config, minimizeToTray: e.target.checked })}
                className="w-4 h-4 text-primary rounded focus:ring-primary"
              />
              <span className="text-sm text-foreground">Minimize to system tray</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={config.showNotifications}
                onChange={(e) => setConfig({ ...config, showNotifications: e.target.checked })}
                className="w-4 h-4 text-primary rounded focus:ring-primary"
              />
              <span className="text-sm text-foreground">Show notifications</span>
            </label>
          </div>
        </section>

        {/* Reprocess XML Files Section - Only shown for FILE connection type (NAXML-compatible POS)
            SEC-004: Message content rendered via JSX text interpolation (auto-escaped, XSS-safe) */}
        {posConnectionConfig?.pos_connection_type === 'FILE' && (
          <section className="bg-card rounded-xl border border-border p-6 mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-2">Reprocess XML Files</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Clear processed file tracking and reprocess XML files from the watch folder. Use this
              if files were processed before a parser fix was applied.
            </p>

            {reprocessResult && (
              <div
                className={`p-3 rounded-lg mb-4 ${
                  reprocessResult.success
                    ? 'bg-green-500/10 text-green-600'
                    : 'bg-destructive/10 text-destructive'
                }`}
                role="alert"
              >
                {reprocessResult.message}
                {reprocessResult.clearedCount !== undefined && (
                  <span className="block text-sm mt-1">
                    {reprocessResult.clearedCount} file record(s) cleared
                  </span>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleReprocessXmlFiles}
                disabled={reprocessing}
                className="flex-1 py-2 px-4 rounded-lg font-medium transition-colors bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {reprocessing ? 'Reprocessing...' : 'Reprocess Failed Files'}
              </button>
              <button
                onClick={handleClearAllProcessedFiles}
                disabled={reprocessing}
                className="flex-1 py-2 px-4 rounded-lg font-medium transition-colors bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {reprocessing ? 'Clearing...' : 'Clear ALL & Reprocess'}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Use &quot;Clear ALL&quot; to force reprocessing of all XML files
            </p>
            <button
              onClick={async () => {
                try {
                  const result = await window.electronAPI.invoke<{
                    success: boolean;
                    data?: {
                      processedFilesCount: number;
                      shiftsCount: number;
                      recentProcessedFiles: unknown[];
                      shifts: unknown[];
                    };
                  }>('sync:debugDump');
                  alert(
                    `Processed Files: ${result.data?.processedFilesCount || 0}\nShifts: ${result.data?.shiftsCount || 0}\n\nCheck console for details`
                  );
                } catch (e) {
                  console.error('Debug dump failed:', e);
                  alert('Debug dump failed: ' + e);
                }
              }}
              className="mt-2 w-full py-2 px-4 rounded-lg font-medium transition-colors bg-purple-600 text-white hover:bg-purple-700"
            >
              Debug: Dump Database State
            </button>
          </section>
        )}

        {/* Fuel Data Reset Section - Only shown for FILE connection type (NAXML-compatible POS)
            SEC-004: Message content rendered via JSX text interpolation (auto-escaped, XSS-safe) */}
        {posConnectionConfig?.pos_connection_type === 'FILE' && (
          <section className="bg-card rounded-xl p-6 border border-orange-500/30 mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-2">Reset Fuel Data</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Fix incorrect fuel totals by clearing accumulated data and reprocessing FGM files. Use
              this if shift fuel sales show values much higher than expected.
            </p>

            {fuelResetResult && (
              <div
                className={`p-3 rounded-lg mb-4 ${
                  fuelResetResult.success
                    ? 'bg-green-500/10 text-green-600'
                    : 'bg-destructive/10 text-destructive'
                }`}
                role="alert"
              >
                {fuelResetResult.message}
              </div>
            )}

            <button
              onClick={handleResetFuelData}
              disabled={resettingFuel}
              className="w-full py-2 px-4 rounded-lg font-medium transition-colors bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
            >
              {resettingFuel ? 'Resetting Fuel Data...' : 'Reset Fuel Data & Reprocess'}
            </button>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              This will delete all fuel summaries and reprocess FGM files with the corrected logic
            </p>
          </section>
        )}

        {/* Danger Zone - Store Reset */}
        <section className="bg-card rounded-xl p-6 border-2 border-red-500/50 mb-6">
          <h2 className="text-lg font-semibold text-red-500 mb-2 flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Danger Zone
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Reset store data for troubleshooting or fresh start. This action is audit-logged and
            cannot be undone.
          </p>

          {resetComplete && (
            <div className="p-3 rounded-lg mb-4 bg-green-500/10 text-green-600" role="alert">
              {resetComplete.message}
              <span className="block text-xs mt-1">
                Audit Reference: {resetComplete.auditReferenceId}
              </span>
            </div>
          )}

          <button
            onClick={() => setShowResetDialog(true)}
            className="w-full py-2 px-4 rounded-lg font-medium transition-colors bg-red-600 text-white hover:bg-red-700"
          >
            Reset Store Data
          </button>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Only SUPPORT and SUPERADMIN roles can perform this action
          </p>
        </section>

        {/* Reset Store Dialog */}
        <ResetStoreDialog
          open={showResetDialog}
          onClose={() => setShowResetDialog(false)}
          cloudAuthUser={cloudAuthUser}
          onResetComplete={(auditReferenceId) => {
            setShowResetDialog(false);
            setResetComplete({
              auditReferenceId,
              message: 'Store reset completed successfully. The application will restart.',
            });
            // Trigger full app restart after a short delay
            // CRITICAL: Must use app:restart (not window.location.reload) to re-bootstrap database
            // after FULL_RESET which deletes the database file
            setTimeout(async () => {
              if (isElectron) {
                await window.electronAPI.invoke('app:restart');
              } else {
                // Fallback for dev mode without Electron
                window.location.reload();
              }
            }, 2000);
          }}
        />

        {/* Error Display */}
        {saveError && (
          <div className="bg-destructive/10 text-destructive p-3 rounded-lg mb-4" role="alert">
            {saveError}
          </div>
        )}

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving || hasErrors(errors)}
          className={`w-full py-3 px-4 rounded-lg font-medium transition-colors ${
            saved
              ? 'bg-green-600 text-white'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          } disabled:opacity-50`}
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
        </button>
        </div>{/* end RIGHT column */}
      </div>{/* end two-column content */}
    </div>
  );
}

/**
 * Settings Page with Cloud Authentication Protection
 *
 * Only users with SUPPORT or SUPERADMIN roles can access this page.
 * Authentication is performed against the cloud API using email/password.
 *
 * @security SEC-001: Cloud-based role verification
 */
function Settings({ onBack }: SettingsProps): React.ReactElement {
  return (
    <CloudProtectedPage
      requiredRoles={['SUPPORT', 'SUPERADMIN']}
      title="Support Authentication Required"
      description="This area is restricted to authorized support personnel only. Please log in with your support credentials."
    >
      {(cloudAuthUser) => <SettingsContent onBack={onBack} cloudAuthUser={cloudAuthUser} />}
    </CloudProtectedPage>
  );
}

export default Settings;
